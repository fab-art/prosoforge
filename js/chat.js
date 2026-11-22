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
      sources.push({ kind:"document", id:d.id, title:d.name, text:d.text, numPages:d.numPages, meta:d.meta });
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

  // Build a grounded context string from top-k ranked chunks across sources.
  function buildContext(sources, question, maxChars=6000){
    const qTokens = new Set(contentTokens(question));
    if(!qTokens.size) return { context:"", used:[] };
    // chunk each source into sentence-windows
    const chunks = [];
    sources.forEach(src=>{
      const sents = sentencesOf(src.text);
      const window = 3;
      for(let i=0; i<sents.length; i+=window){
        const text = sents.slice(i, i+window).join(" ");
        if(text.length<10) continue;
        const cTokens = new Set(contentTokens(text));
        let overlap = 0;
        for(const t of qTokens) if(cTokens.has(t)) overlap++;
        if(overlap===0) continue;
        chunks.push({ text, src, score: overlap/qTokens.size, overlap, idx:i });
      }
    });
    chunks.sort((a,b)=>b.score-a.score || b.overlap-a.overlap);
    const used = [];
    let ctx = "";
    for(const c of chunks){
      const addition = `[${c.src.kind}: ${c.src.title}]\n${c.text}\n\n`;
      if(ctx.length + addition.length > maxChars) break;
      ctx += addition;
      if(!used.find(u=>u.id===c.src.id)) used.push(c.src);
    }
    return { context: ctx, used };
  }

  // Main entry: answer a question. opts.sourceId restricts to one source.
  async function answer(question, opts={}){
    const { sourceId, stream, onToken } = opts;
    let sources = gatherSources();
    if(sourceId) sources = sources.filter(s=>s.id===sourceId);
    if(!sources.length) return { text:"No sources available to answer from. Collect papers, upload a PDF, or scrape a URL first.", source:"none", used:[] };

    // If LLM ready, use grounded RAG
    if(RW.WebLLM.isReady()){
      const { context, used } = buildContext(sources, question);
      if(!context.trim()){
        return { text:"None of your sources share keywords with this question, so I have no grounded context to answer from. Try rephrasing, or collect/upload more relevant material.", source:"webllm-empty", used:[] };
      }
      const sys = "You are a careful research assistant. Answer the user's question using ONLY the provided context. Each context block is labeled with its source. Quote or paraphrase faithfully. If the context does not address the question, say: 'The provided sources do not address this question.' Do NOT invent facts, citations, page numbers, or details not in the context. Keep answers concise.";
      const userMsg = `Context:\n${context}\n\nQuestion: ${question}\n\nAnswer (grounded only in the context above):`;
      const result = await RW.WebLLM.ask({
        system: sys, context:"", question: userMsg,
        maxTokens: 500, temperature: 0.2,
        stream, onToken,
      });
      return { text: result.text, source: result.source, model: result.model, used };
    }

    // Fallback: keyword retrieval, honest when no overlap
    if(sources.length===1){
      const r = keywordAnswer(sources[0].text, question);
      if(!r) return { text:`This source does not appear to address your question. None of its sentences share keywords with: "${question}"`, source:"keyword-none", used: [sources[0]] };
      return { text: r.answer, source:"keyword", used:[sources[0]], overlap:r.overlap, total:r.total };
    }
    // multi-source fallback: pick best source's best sentence
    const scored = sources.map(s=>{
      const r = keywordAnswer(s.text, question);
      return { s, r, score: r? r.overlap : 0 };
    }).filter(x=>x.r).sort((a,b)=>b.score-a.score);
    if(!scored.length) return { text:"None of your sources share keywords with this question. Saying so rather than guessing.", source:"keyword-none", used:[] };
    const top = scored[0];
    return {
      text: `${top.r.answer}\n\n(Source: ${top.s.title}${top.s.year?", "+top.s.year:""})`,
      source:"keyword",
      used:[top.s],
      overlap: top.r.overlap, total: top.r.total
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
        log.innerHTML += `<div class="chat-msg ${cls}">${esc(result.text)}${meta}</div>`;
      }catch(e){
        thinking.remove();
        log.innerHTML += `<div class="chat-msg bot draft">Error: ${esc(e.message)}</div>`;
      }
      log.scrollTop = log.scrollHeight;
    };
    $("#qaSend", c).addEventListener("click", send);
    $("#qaInput", c).addEventListener("keydown", e=>{ if(e.key==="Enter") send(); });
  }

  Object.assign(RW, { Chat: { render, answer, gatherSources, buildContext, keywordAnswer } });
})();
