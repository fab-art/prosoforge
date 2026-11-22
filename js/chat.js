/* ============================================================================
   Research Workstation — chat.js
   Unified Q&A over papers (abstracts), uploaded documents (full PDF text),
   and scraped web resources. Uses WebLLM with grounded context if loaded;
   falls back to keyword-overlap retrieval (honest "not addressed" fallback).
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, contentTokens, sentencesOf } = RW;

  // Collect all "sources" the chat can answer from.
  // Returns [{ kind, id, title, text, ...meta }]
  function gatherSources(){
    const sources = [];
    State.papers.forEach(p=>{
      if(p.abstract && p.abstract.length>30){
        sources.push({ kind:"paper", id:p.id, title:p.title, text:p.abstract, authors:p.authors, year:p.year, source:p.source, venue:p.venue, doi:p.doi, url:p.url });
      }
    });
    State.documents.forEach(d=>{
      sources.push({ kind:"document", id:d.id, title:d.name, text:d.text, pages:d.pages, numPages:d.numPages, meta:d.meta });
    });
    State.resources.forEach(r=>{
      sources.push({ kind:"scrape", id:r.id, title:r.title, text:r.text, url:r.url });
    });
    return sources;
  }

  // Keyword-based fallback answer for one source's text.
  function keywordAnswer(text, question){
    if(!text || text.length<20) return null;
    const sents = sentencesOf(text);
    if(!sents.length) return null;
    const qTokens = new Set(contentTokens(question));
    if(!qTokens.size) return null;
    const scored = sents.map((s,i)=>{
      const sTokens = new Set(contentTokens(s));
      let overlap = 0;
      for(const t of qTokens) if(sTokens.has(t)) overlap++;
      return { s, i, overlap, score: qTokens.size? overlap/qTokens.size : 0 };
    }).sort((a,b)=>b.score-a.score || b.overlap-a.overlap);
    const top = scored[0];
    if(!top || top.overlap===0) return null;
    const best = scored.filter(x=>x.overlap===top.overlap).slice(0,3);
    let answer = top.s;
    if(best.length>1){
      answer += "\n\nOther possibly relevant sentences:\n" + best.slice(1).map(b=>"• "+b.s).join("\n");
    }
    return { answer, overlap: top.overlap, total: qTokens.size, sentence: top.s };
  }

  // Which page of a page-aware source does a sentence come from? (keyword path)
  function pageOfText(src, needle){
    if(!src || !src.pages || !src.pages.length || !needle) return null;
    const idx = (src.text||"").indexOf(needle.slice(0,80));
    if(idx<0) return null;
    let acc = 0;
    for(let i=0;i<src.pages.length;i++){
      acc += src.pages[i].length + 5; // 5 = "\n\n\f\n\n" separator between pages
      if(idx < acc) return i+1;
    }
    return null;
  }

  // Build a grounded context string from top-k ranked chunks across sources.
  // PDF documents are chunked PER PAGE so every chunk carries a page number —
  // the context labels include "— p. N" (models cite pages faithfully when the
  // label says so) and used chunks produce clickable page anchors (ChatPDF-style).
  function buildContext(sources, question, maxChars=6000){
    const qTokens = new Set(contentTokens(question));
    if(!qTokens.size) return { context:"", used:[], anchors:[] };
    const chunks = [];
    const window = 3;
    sources.forEach(src=>{
      if(src.kind==="document" && src.pages && src.pages.length){
        // page-aware chunking: each chunk is bound to one page
        src.pages.forEach((pageText, pi)=>{
          const sents = sentencesOf(pageText);
          for(let i=0; i<sents.length; i+=window){
            const text = sents.slice(i, i+window).join(" ");
            if(text.length<10) continue;
            const cTokens = new Set(contentTokens(text));
            let overlap = 0;
            for(const t of qTokens) if(cTokens.has(t)) overlap++;
            if(overlap===0) continue;
            chunks.push({ text, src, page: pi+1, score: overlap/qTokens.size, overlap, idx:i });
          }
        });
      } else {
        const sents = sentencesOf(src.text);
        for(let i=0; i<sents.length; i+=window){
          const text = sents.slice(i, i+window).join(" ");
          if(text.length<10) continue;
          const cTokens = new Set(contentTokens(text));
          let overlap = 0;
          for(const t of qTokens) if(cTokens.has(t)) overlap++;
          if(overlap===0) continue;
          chunks.push({ text, src, page: null, score: overlap/qTokens.size, overlap, idx:i });
        }
      }
    });
    chunks.sort((a,b)=>b.score-a.score || b.overlap-a.overlap);
    const used = [];
    const anchors = [];
    let ctx = "";
    for(const c of chunks){
      const label = c.page ? `${c.src.kind}: ${c.src.title} — p. ${c.page}` : `${c.src.kind}: ${c.src.title}`;
      const addition = `[${label}]\n${c.text}\n\n`;
      if(ctx.length + addition.length > maxChars) break;
      ctx += addition;
      if(!used.find(u=>u.id===c.src.id)) used.push(c.src);
      if(c.page && !anchors.find(a=>a.srcId===c.src.id && a.page===c.page)){
        anchors.push({ srcId:c.src.id, title:c.src.title, page:c.page });
      }
    }
    anchors.sort((a,b)=>a.page-b.page);
    return { context: ctx, used, anchors };
  }

  // Main entry: answer a question. opts.sourceId restricts to one source.
  async function answer(question, opts={}){
    const { sourceId, stream, onToken } = opts;
    let sources = gatherSources();
    if(sourceId) sources = sources.filter(s=>s.id===sourceId);
    if(!sources.length) return { text:"No sources available to answer from. Collect papers, upload a PDF, or scrape a URL first.", source:"none", used:[] };

    // If LLM ready, use grounded RAG
    if(RW.WebLLM.isReady()){
      const { context, used, anchors } = buildContext(sources, question);
      if(!context.trim()){
        return { text:"None of your sources share keywords with this question, so I have no grounded context to answer from. Try rephrasing, or collect/upload more relevant material.", source:"webllm-empty", used:[], anchors:[] };
      }
      const sys = "You are a careful research assistant. Answer the user's question using ONLY the provided context. Each context block is labeled with its source. Quote or paraphrase faithfully. If the context does not address the question, say: 'The provided sources do not address this question.' Do NOT invent facts, citations, page numbers, or details not in the context. Keep answers concise.";
      const userMsg = `Context:\n${context}\n\nQuestion: ${question}\n\nAnswer (grounded only in the context above):`;
      const result = await RW.WebLLM.ask({
        system: sys, context:"", question: userMsg,
        maxTokens: 500, temperature: 0.2,
        stream, onToken,
      });
      return { text: result.text, source: result.source, model: result.model, used, anchors };
    }

    // Fallback: keyword retrieval, honest when no overlap
    if(sources.length===1){
      const r = keywordAnswer(sources[0].text, question);
      if(!r) return { text:`This source does not appear to address your question. None of its sentences share keywords with: "${question}"`, source:"keyword-none", used: [sources[0]], anchors:[] };
      const page = pageOfText(sources[0], r.sentence);
      const anchors = page ? [{ srcId:sources[0].id, title:sources[0].title, page }] : [];
      return { text: r.answer, source:"keyword", used:[sources[0]], overlap:r.overlap, total:r.total, anchors };
    }
    // multi-source fallback: pick best source's best sentence
    const scored = sources.map(s=>{
      const r = keywordAnswer(s.text, question);
      return { s, r, score: r? r.overlap : 0 };
    }).filter(x=>x.r).sort((a,b)=>b.score-a.score);
    if(!scored.length) return { text:"None of your sources share keywords with this question. Saying so rather than guessing.", source:"keyword-none", used:[], anchors:[] };
    const top = scored[0];
    const kwPage = pageOfText(top.s, top.r.sentence);
    const kwAnchors = kwPage ? [{ srcId:top.s.id, title:top.s.title, page:kwPage }] : [];
    return {
      text: `${top.r.answer}\n\n(Source: ${top.s.title}${top.s.year?", "+top.s.year:""})`,
      source:"keyword",
      used:[top.s],
      overlap: top.r.overlap, total: top.r.total,
      anchors: kwAnchors
    };
  }

  // ---- render the Paper/Doc Q&A view ----
  function render(){
    const c = $("#content");
    const sources = gatherSources();
    c.innerHTML = `
      <div class="card">
        <div class="between">
          <div style="min-width:0">
            <div class="small muted">Question about</div>
            <strong id="qaSourceTitle">All sources</strong>
          </div>
          <select class="select" id="qaSourceSel" style="max-width:340px">
            <option value="">All sources (${sources.length})</option>
            ${sources.map(s=>`<option value="${esc(s.id)}">${esc(s.kind)}: ${esc(s.title.slice(0,70))}${s.title.length>70?'…':''}</option>`).join("")}
          </select>
        </div>
        <div class="small muted mt">Papers use abstract only; uploaded PDFs use full extracted text; scraped URLs use extracted page text.</div>
      </div>
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div><b>${RW.WebLLM.isReady()?'WebLLM grounded RAG':'Heuristic retrieval (keyword overlap)'}</b>. ${RW.WebLLM.isReady()?'Answers are generated by a local LLM grounded in retrieved context — still verify against original sources.':'Load a WebLLM model in Settings for real LLM synthesis. Until then, the bot pulls the most relevant sentence by keyword overlap and says so when a source does not address your question.'}</div></div>
      <div class="card chat-box">
        <div class="chat-log" id="chatLog"></div>
        <div class="chat-input-row">
          <input class="input" id="qaInput" placeholder="Ask a question about your sources…" autocomplete="off">
          <button class="btn btn-primary" id="qaSend">Send</button>
        </div>
      </div>
    `;
    const sel = $("#qaSourceSel", c);
    if(State.activePaperId) sel.value = State.activePaperId;
    else if(State.activeDocId) sel.value = State.activeDocId;
    const updateTitle = ()=>{
      const id = sel.value;
      const s = id? sources.find(x=>x.id===id) : null;
      $("#qaSourceTitle", c).textContent = s? `${s.kind}: ${s.title}` : `All sources (${sources.length})`;
    };
    sel.addEventListener("change", updateTitle);
    updateTitle();
    const log = $("#chatLog", c);
    log.innerHTML = `<div class="chat-msg bot">${sources.length? `Loaded ${sources.length} source(s). Ask away — ${RW.WebLLM.isReady()?'WebLLM':'keyword retrieval'} mode.` : 'No sources yet. Collect papers, upload a PDF, or scrape a URL first.'}</div>`;
    const send = async ()=>{
      const q = $("#qaInput", c).value.trim();
      if(!q) return;
      $("#qaInput", c).value = "";
      const sourceId = sel.value || null;
      log.innerHTML += `<div class="chat-msg user">${esc(q)}</div>`;
      const thinking = document.createElement("div");
      thinking.className = "chat-msg bot";
      thinking.innerHTML = `<span class="spinner"></span> ${RW.WebLLM.isReady()?'Generating…':'Retrieving…'}`;
      log.appendChild(thinking);
      log.scrollTop = log.scrollHeight;
      try{
        const result = await answer(q, { sourceId });
        thinking.remove();
        const cls = result.source.startsWith("webllm") || result.source==="keyword" ? "bot" : "bot draft";
        let meta = "";
        if(result.source==="keyword") meta = `<div class="src">Keyword overlap: ${result.overlap}/${result.total} question keywords matched. ${result.used.length? 'From: '+result.used[0].title : ''}</div>`;
        else if(result.source==="keyword-none") meta = `<div class="src">Zero keyword overlap — saying so rather than guessing.</div>`;
        else if(result.source==="webllm"||result.source==="webllm-empty") meta = `<div class="src">Generated by ${RW.WebLLM.shortName(result.model||'')} (local WebLLM). ${result.used.length? `Grounded in ${result.used.length} source(s).` : ''} Verify against originals.</div>`;
        let anchorsHtml = "";
        if(result.anchors && result.anchors.length){
          anchorsHtml = `<div class="page-anchors">` + result.anchors.map(a=>
            `<button class="btn btn-sm page-anchor" data-src="${esc(a.srcId)}" data-page="${a.page}" title="Open page ${a.page} (extracted text)">📄 p. ${a.page}</button>`
          ).join("") + `</div>`;
        }
        log.innerHTML += `<div class="chat-msg ${cls}">${esc(result.text)}${meta}${anchorsHtml}</div>`;
      }catch(e){
        thinking.remove();
        log.innerHTML += `<div class="chat-msg bot draft">Error: ${esc(e.message)}</div>`;
      }
      log.scrollTop = log.scrollHeight;
    };
    $("#qaSend", c).addEventListener("click", send);
    $("#qaInput", c).addEventListener("keydown", e=>{ if(e.key==="Enter") send(); });
    // clickable page anchors → viewer modal
    log.addEventListener("click", e=>{
      const b = e.target.closest(".page-anchor");
      if(b) openPageViewer(b.dataset.src, parseInt(b.dataset.page,10));
    });
    // SciSpace-style "explain any answer text" (Phase 4): select text in the log
    if(RW.Explain) RW.Explain.mount(log, { getContext: ()=> $("#qaInput", c) ? gatherContextForExplain(sel.value) : "" });
  }

  // Surrounding context for the explain toolbar in the Q&A view: the selected
  // source's text (or all sources' text if "All sources" is chosen).
  function gatherContextForExplain(sourceId){
    const sources = gatherSources().filter(s=> sourceId ? s.id===sourceId : true);
    return sources.map(s=>s.text).join("\n\n").slice(0, 6000);
  }

  /* Page viewer: show a document page's extracted text — the target of a
     clickable "p. N" anchor under a chat answer (ChatPDF-style navigation).
     Raw PDFs are not persisted in localStorage (too large), so we show the
     extracted page text rather than a rasterized page; the modal says so. */
  function openPageViewer(srcId, page){
    const doc = State.documents.find(d=>d.id===srcId);
    if(!doc || !doc.pages || !doc.pages.length){ toast("Page text not available for this document.","error"); return; }
    page = Math.min(Math.max(1, page), doc.pages.length);
    const modal = document.createElement("div");
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:210;display:flex;align-items:center;justify-content:center;padding:16px";
    modal.innerHTML = `<div class="card page-viewer" style="max-width:680px;width:100%;max-height:88vh;display:flex;flex-direction:column">
      <div class="between mb-sm">
        <div style="min-width:0"><strong>${esc(doc.name)}</strong> <span class="badge badge-muted pv-badge">p. ${page} / ${doc.pages.length}</span></div>
        <button class="btn btn-ghost btn-sm" data-close="1">✕</button>
      </div>
      <div class="pv-text small" style="flex:1;overflow:auto;white-space:pre-wrap;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:12px"></div>
      <div class="flex gap-sm mt-sm between wrap">
        <button class="btn btn-sm" data-nav="-1" ${page<=1?"disabled":""}>← Prev page</button>
        <span class="small muted">extracted page text — reached via a 📄 chip in a chat answer</span>
        <button class="btn btn-sm" data-nav="1" ${page>=doc.pages.length?"disabled":""}>Next page →</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const pane = modal.querySelector(".pv-text");
    let curPage = page;
    const show = p => { curPage = p; pane.textContent = doc.pages[p-1] || "(empty page)"; };
    show(page);
    // SciSpace-style reading copilot on the page text (Phase 4)
    if(RW.Explain) RW.Explain.mount(pane, { getContext: ()=> doc.pages[curPage-1] || "", docId: doc.id });
    modal.addEventListener("click", e=>{
      if(e.target===modal || e.target.closest("[data-close]")){ modal.remove(); return; }
      const nav = e.target.closest("[data-nav]");
      if(nav && !nav.disabled){
        page = Math.min(Math.max(1, page + parseInt(nav.dataset.nav,10)), doc.pages.length);
        show(page);
        modal.querySelector(".pv-badge").textContent = `p. ${page} / ${doc.pages.length}`;
        modal.querySelector("[data-nav='-1']").disabled = page<=1;
        modal.querySelector("[data-nav='1']").disabled = page>=doc.pages.length;
      }
    });
  }

  Object.assign(RW, { Chat: { render, answer, gatherSources, buildContext, keywordAnswer, pageOfText, openPageViewer } });
})();
