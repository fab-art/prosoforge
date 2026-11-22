/* ============================================================================
   Research Workstation — writer.js
   AI Writer: drafts a paragraph on a user topic, grounded strictly in
   collected papers (+ uploaded docs if included). Two modes:
     - WebLLM ready: grounded RAG synthesis with inline citations.
     - Fallback: keyword-ranked assembly of real abstract sentences (verbatim quote scaffold).
   Either way: labeled DRAFT — rewrite in your own words before use.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, contentTokens, sentencesOf, formatCitation, inText } = RW;

  // Gather usable sources (papers with abstracts + optionally documents).
  function gatherSources(includeDocs){
    const sources = [];
    State.papers.forEach(p=>{
      if(p.abstract && p.abstract.length>30){
        sources.push({ kind:"paper", id:p.id, title:p.title, text:p.abstract, paper:p });
      }
    });
    if(includeDocs){
      State.documents.forEach(d=>{
        if(d.text && d.text.length>30){
          sources.push({ kind:"document", id:d.id, title:d.name, text:d.text, paper:{ id:d.id, source:"pdf", title:d.name, authors:[], year:null, venue:"(uploaded PDF)", doi:"", url:"" } });
        }
      });
    }
    return sources;
  }

  // Rank sources by topic overlap
  function rankSources(sources, topic){
    const qTokens = new Set(contentTokens(topic));
    if(!qTokens.size) return sources.slice(0,4);
    return sources.map(s=>{
      const sTokens = new Set(contentTokens(s.title+" "+s.text));
      let overlap = 0;
      for(const t of qTokens) if(sTokens.has(t)) overlap++;
      return { s, overlap, coverage: qTokens.size? overlap/qTokens.size : 0 };
    }).sort((a,b)=>b.overlap-a.overlap || b.coverage-a.coverage);
  }

  // ---- Keyword fallback draft (verbatim sentence scaffold) ----
  function buildKeywordDraft(topic, style, maxPapers, includeDocs){
    const sources = gatherSources(includeDocs);
    const scored = rankSources(sources, topic).filter(x=>x.overlap>0).slice(0, maxPapers);
    if(!scored.length) return { paragraph:"", refs:[], note:"No papers in your library share keywords with this topic. Collect more relevant literature first." };
    const refs = [];
    const sentences = [];
    scored.forEach((x, idx)=>{
      const p = x.s.paper;
      const sents = sentencesOf(x.s.text);
      if(!sents.length) return;
      const best = sents.map(s=>{
        const sTokens = new Set(contentTokens(s));
        let o = 0; for(const t of new Set(contentTokens(topic))) if(sTokens.has(t)) o++;
        return { s, score:o };
      }).sort((a,b)=>b.score-a.score)[0];
      if(best && best.score>0){
        sentences.push({ text:best.s, paper:p });
        refs.push({ n:idx+1, paper:p });
      }
    });
    if(!sentences.length) return { paragraph:"", refs:[], note:"No relevant sentences found in your papers for this topic." };
    const transitions = ["For example,","Relatedly,","In addition,","Earlier work shows that","Specifically,"];
    const para = sentences.map((s,i)=>{
      const cite = inText(s.paper, style);
      const lead = i===0 ? "Prior work bears on this topic. " : (transitions[i%transitions.length]+" ");
      const stext = s.text.replace(/\.$/,"");
      return `${lead}${stext} ${cite}.`;
    }).join(" ");
    return { paragraph:para, refs, note:null, mode:"keyword" };
  }

  // ---- WebLLM grounded synthesis draft ----
  async function buildLLMDraft(topic, style, maxPapers, includeDocs){
    const sources = gatherSources(includeDocs);
    const scored = rankSources(sources, topic).filter(x=>x.overlap>0).slice(0, maxPapers);
    if(!scored.length) return { paragraph:"", refs:[], note:"No papers in your library share keywords with this topic. Collect more relevant literature first.", mode:"llm" };
    const refs = scored.map((x,i)=>({ n:i+1, paper:x.s.paper }));
    // Build context with numbered source labels so the LLM can cite [n]
    const context = scored.map((x,i)=>{
      const p = x.s.paper;
      const authorYear = inText(p, style);
      return `[${i+1}] ${authorYear} — "${p.title}"\n${x.s.text.slice(0, 1500)}`;
    }).join("\n\n---\n\n");
    const sys = `You are a careful research assistant writing a literature-review paragraph. Use ONLY the provided sources, each labeled [1], [2], etc. Write one cohesive paragraph (4-7 sentences) that synthesizes what the sources say about the topic. Insert inline citations as [1], [2], etc. at the end of the relevant sentence. Do NOT invent facts, numbers, or sources not in the context. If the sources are insufficient, say so. Style: ${style.toUpperCase()}.`;
    const userMsg = `Topic: ${topic}\n\nSources:\n${context}\n\nWrite the synthesis paragraph now (with [n] inline citations):`;
    const result = await RW.WebLLM.ask({
      system: sys, context:"", question: userMsg,
      maxTokens: 500, temperature: 0.3,
    });
    // Post-process: replace [n] with proper in-text citations
    let paragraph = result.text;
    const citeMap = {};
    refs.forEach(r=>{ citeMap[r.n] = inText(r.paper, style); });
    paragraph = paragraph.replace(/\[(\d+)\]/g, (m, n)=>{
      const c = citeMap[n];
      return c ? ` ${c}` : m;
    });
    return { paragraph: paragraph.trim(), refs, note:null, mode:"llm", model: result.model };
  }

  function buildDraft(topic, style, maxPapers, includeDocs){
    if(RW.WebLLM.isReady()) return buildLLMDraft(topic, style, maxPapers, includeDocs);
    return Promise.resolve(buildKeywordDraft(topic, style, maxPapers, includeDocs));
  }

  function render(){
    const c = $("#content");
    if(!State.papers.length && !State.documents.length){
      c.innerHTML = `<div class="empty"><span class="ic">✍️</span><div>Collect papers or upload a document first — the AI Writer only drafts from your library, never invents sources.</div></div>`;
      return;
    }
    c.innerHTML = `
      <div class="notice notice-draft"><span class="ic">⚠️</span><div><b>DRAFT output — rewrite in your own words before use.</b> ${RW.WebLLM.isReady()?`Generated by a local LLM grounded in your papers; `:``}Every cited claim traces to a real source in your library. Verify against the original papers before relying on anything.</div></div>
      <div class="card">
        <div class="field">
          <label>Topic / argument to draft about</label>
          <input class="input" id="wTopic" placeholder="e.g. effectiveness of retrieval-augmented generation in reducing hallucinations">
        </div>
        <div class="row">
          <div class="field"><label>Citation style</label>
            <select class="select" id="wStyle">
              <option value="apa" ${State.settings.citationStyle==='apa'?'selected':''}>APA</option>
              <option value="mla" ${State.settings.citationStyle==='mla'?'selected':''}>MLA</option>
              <option value="chicago" ${State.settings.citationStyle==='chicago'?'selected':''}>Chicago (author-date)</option>
            </select>
          </div>
          <div class="field"><label>Max sources to cite</label>
            <input class="input" id="wMax" type="number" value="4" min="1" max="10">
          </div>
        </div>
        <label class="checkbox-row"><input type="checkbox" id="wDocs"> Include uploaded PDFs in grounding (uses full extracted text)</label>
        <button class="btn btn-primary mt" id="wDraft">✍️ Draft paragraph</button>
      </div>
      <div id="wOut"></div>
    `;
    $("#wStyle", c).addEventListener("change", e=>{ State.settings.citationStyle=e.target.value; RW.saveState(); });
    $("#wDraft", c).addEventListener("click", async ()=>{
      const topic = $("#wTopic", c).value.trim();
      if(!topic){ RW.toast("Enter a topic.","error"); return; }
      const style = $("#wStyle", c).value;
      const maxPapers = parseInt($("#wMax", c).value)||4;
      const includeDocs = $("#wDocs", c).checked;
      const btn = $("#wDraft", c);
      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Drafting…`;
      try{
        const draft = await buildDraft(topic, style, maxPapers, includeDocs);
        $("#wOut", c).innerHTML = renderDraft(draft, topic);
        wireDraftActions(draft, topic);
      }catch(e){
        $("#wOut", c).innerHTML = `<div class="notice notice-danger"><span class="ic">⚠️</span><div>Draft failed: ${esc(e.message)}</div></div>`;
      }finally{
        btn.disabled = false; btn.innerHTML = "✍️ Draft paragraph";
      }
    });
  }

  function renderDraft(draft, topic){
    if(draft.note) return `<div class="card"><div class="notice notice-advisory"><span class="ic">ℹ️</span><div>${esc(draft.note)}</div></div></div>`;
    const refList = draft.refs.map(r=>`<li style="margin-bottom:6px"><span class="badge badge-muted">${r.n}</span> <span>${esc(formatCitation(r.paper, draft.style||State.settings.citationStyle))}</span></li>`).join("");
    const modeBadge = draft.mode==="llm" ? `<span class="badge badge-advisory">LLM synthesis</span>` : `<span class="badge badge-muted">keyword scaffold</span>`;
    return `
      <div class="card">
        <div class="flex gap-sm wrap mb-sm">
          <span class="badge badge-draft">DRAFT — verify &amp; rewrite</span>
          ${modeBadge}
          <span class="badge badge-muted">${draft.refs.length} sources</span>
          <span class="badge badge-muted">${(draft.style||State.settings.citationStyle).toUpperCase()}</span>
        </div>
        <div class="paper-abstract" style="font-size:14px;border-left:3px solid var(--draft-border);padding:8px 14px;background:var(--draft-bg);color:var(--draft-text);border-radius:0 6px 6px 0;white-space:pre-wrap">${esc(draft.paragraph)}</div>
        <div class="mt small muted">Topic: <i>${esc(topic)}</i></div>
        <h4 class="mt">References</h4>
        <ol style="padding-left:20px;margin:6px 0">${refList}</ol>
        <div class="flex gap-sm wrap mt">
          <button class="btn btn-sm" id="copyDraft">📋 Copy text</button>
          <button class="btn btn-sm" id="sendDraft">📝 Send to Thesis Workspace</button>
          <button class="btn btn-sm" id="exportMd">⬇ Export .md</button>
        </div>
        <div class="small muted mt">⚠️ ${draft.mode==="llm" ? "LLM-synthesized — verify each claim against the cited paper's abstract/full text." : "Each cited sentence is a near-verbatim quote from the source abstract, ranked by keyword overlap."} This is a starting scaffold, not a finished synthesis — rewrite it in your own voice.</div>
      </div>
    `;
  }

  function wireDraftActions(draft, topic){
    const c = $("#content");
    const style = draft.style || State.settings.citationStyle;
    $("#copyDraft", c)?.addEventListener("click", ()=>{
      const text = draft.paragraph + "\n\nReferences\n" + draft.refs.map(r=>`${r.n}. ${formatCitation(r.paper, style)}`).join("\n");
      navigator.clipboard.writeText(text).then(()=>RW.toast("Copied to clipboard.","success"));
    });
    $("#sendDraft", c)?.addEventListener("click", ()=>{
      const text = `${draft.paragraph}\n\nReferences\n${draft.refs.map(r=>r.n+". "+formatCitation(r.paper, style)).join("\n")}\n\n`;
      State.draft = (State.draft? State.draft+"\n\n":"") + text;
      RW.saveState();
      RW.toast("Added to Thesis Workspace.","success");
      RW.navigate("workspace");
    });
    $("#exportMd", c)?.addEventListener("click", ()=>{
      const md = `# Draft: ${topic}\n\n> ⚠️ DRAFT — verify & rewrite in your own words before use.\n\n${draft.paragraph}\n\n## References\n\n${draft.refs.map(r=>`${r.n}. ${formatCitation(r.paper, style)}`).join("\n")}\n`;
      RW.downloadBlob(md, "draft.md", "text/markdown");
      RW.toast("Exported.","success");
    });
  }

  Object.assign(RW, { Writer: { render, buildDraft } });
})();
