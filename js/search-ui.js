/* ============================================================================
   Research Workstation — search-ui.js
   Render logic for the Literature Search view. Uses RW.Search (adapters)
   and RW.State. Includes manual entry modal for CSP-blocked papers.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, saveState, refreshCounts, SOURCE_LABELS } = RW;

  let lastResults = [];

  function render(){
    const c = $("#content");
    c.innerHTML = `
      <div class="card">
        <label>Search query</label>
        <div class="flex">
          <input class="input" id="q" placeholder="e.g. large language models for education">
          <button class="btn btn-primary" id="searchBtn">🔍 Search</button>
        </div>
        <div class="mt">
          <label>Sources</label>
          <div class="row wrap" id="srcToggles">
            ${Object.keys(SOURCE_LABELS).map(k=>`
              <label class="checkbox-row"><input type="checkbox" data-src="${k}" ${State.settings.sources[k]?"checked":""}> ${SOURCE_LABELS[k]}</label>
            `).join("")}
          </div>
        </div>
        <div class="small muted mt">Papers persist in your browser. Manual entry lets you add papers blocked by CSP or paywalls. Only your query leaves the browser.</div>
      </div>
      <div id="searchStatus"></div>
      <div class="between mb">
        <h3 style="margin:0">Results <span class="badge badge-muted" id="resCount">0</span></h3>
        <div class="flex gap-sm">
          <button class="btn btn-sm" id="addManual">+ Manual entry</button>
          <button class="btn btn-sm btn-danger" id="clearPapers">Clear all</button>
        </div>
      </div>
      <div id="results"></div>
    `;
    $$('[data-src]', c).forEach(cb=> cb.addEventListener("change", e=>{
      State.settings.sources[e.target.dataset.src] = e.target.checked; saveState();
    }));
    const doSearch = async ()=>{
      const q = $("#q", c).value.trim();
      if(!q){ toast("Enter a query.","error"); return; }
      const status = $("#searchStatus", c);
      const btn = $("#searchBtn", c);
      btn.disabled = true;
      const n = Object.keys(State.settings.sources).filter(k=>State.settings.sources[k]).length;
      status.innerHTML = `<div class="notice notice-info"><span class="spinner"></span><div>Searching ${n} source(s)… Only your query leaves the browser.</div></div>`;
      try{
        const results = await RW.Search.runSearch(q, State.settings.sources);
        lastResults = results;
        renderResults(results);
        $("#resCount", c).textContent = results.length;
        status.innerHTML = `<div class="notice notice-info"><span class="ic">✅</span><div>Found ${results.length} papers (deduplicated by title). ${results.filter(r=>State.papers.find(p=>p.id===r.id)).length} already in your library.</div></div>`;
      }catch(e){
        status.innerHTML = `<div class="notice notice-danger"><span class="ic">⚠️</span><div>Search failed: ${esc(e.message)}. Try again or use Manual entry.</div></div>`;
      }finally{ btn.disabled = false; }
    };
    $("#searchBtn", c).addEventListener("click", doSearch);
    $("#q", c).addEventListener("keydown", e=>{ if(e.key==="Enter") doSearch(); });
    $("#clearPapers", c).addEventListener("click", ()=>{
      if(confirm("Remove all papers from your library? This cannot be undone.")){
        State.papers = []; saveState(); RW.refreshCounts(); renderResults([]);
        $("#resCount", c).textContent = "0";
      }
    });
    $("#addManual", c).addEventListener("click", renderManualEntry);
    // default: show already-collected library
    renderResults(State.papers);
    $("#resCount", c).textContent = State.papers.length;
  }

  let currentPapers = [];

  function renderResults(papers){
    const box = $("#results");
    currentPapers = papers;
    if(!papers.length){
      box.innerHTML = `<div class="empty"><span class="ic">📭</span><div>No papers yet. Search above or add one manually.</div></div>`;
      return;
    }
    box.innerHTML = papers.map(renderPaperCard).join("");
    $$('[data-collect]', box).forEach(b=> b.addEventListener("click", ()=>{
      const id = b.dataset.collect;
      const p = papers.find(x=>x.id===id);
      if(!p) return;
      if(State.papers.find(x=>x.id===id)){
        State.papers = State.papers.filter(x=>x.id!==id);
        toast("Removed from library.","info");
      } else {
        State.papers.push({ ...p, collected:true, addedAt:Date.now() });
        toast("Added to library.","success");
      }
      saveState(); RW.refreshCounts(); renderResults(papers);
    }));
    $$('[data-chat]', box).forEach(b=> b.addEventListener("click", ()=>{
      State.activePaperId = b.dataset.chat; RW.navigate("chat");
    }));
    // Phase 3: per-paper TLDR fetch from Semantic Scholar
    $$('[data-tldr]', box).forEach(b=> b.addEventListener("click", async ()=>{
      const p = currentPapers.find(x=>x.id===b.dataset.tldr);
      if(!p) return;
      b.disabled = true; b.innerHTML = `<span class="spinner"></span>`;
      try{
        const { tldr } = await RW.Search.fetchTLDR(p);
        if(tldr){
          p.tldr = tldr;
          const stored = State.papers.find(x=>x.id===p.id);
          if(stored){ stored.tldr = tldr; saveState(); }
        } else {
          toast("Semantic Scholar has no TLDR for this paper.","info");
        }
      }catch(err){ toast(err.message,"error"); }
      renderResults(currentPapers);
    }));
  }

  function renderPaperCard(p){
    const collected = State.papers.find(x=>x.id===p.id);
    const abbr = (p.abstract||"").slice(0,280);
    const src = p.source || "manual";
    const label = SOURCE_LABELS[src] || src;
    return `<div class="card card-hover">
      <div class="between">
        <div style="flex:1;min-width:0">
          <div class="flex gap-sm wrap mb-sm">
            <span class="source-pill src-${src}">${esc(label)}</span>
            ${p.year?`<span class="badge badge-muted">${p.year}</span>`:""}
            ${p.doi?`<span class="badge badge-muted mono">DOI</span>`:""}
          </div>
          <div class="paper-title" data-chat="${esc(p.id)}">${esc(p.title)}</div>
          <div class="paper-meta">${(p.authors||[]).slice(0,4).join("; ")}${(p.authors&&p.authors.length>4)?` … +${p.authors.length-4}`:""}</div>
          ${p.venue?`<div class="paper-meta">${esc(p.venue)}</div>`:""}
        </div>
        <button class="btn btn-sm ${collected?'btn-danger':'btn-primary'}" data-collect="${esc(p.id)}">${collected?'✕ Remove':'+ Collect'}</button>
      </div>
      ${abbr?`<div class="paper-abstract">${esc(abbr)}${p.abstract&&p.abstract.length>280?'…':''}</div>`:"<div class='paper-abstract muted'><em>No abstract available.</em></div>"}
      ${p.tldr?`<div class="tldr-chip small"><b>TL;DR</b> ${esc(p.tldr)} <span class="muted">— Semantic Scholar</span></div>`:""}
      <div class="flex gap-sm mt wrap">
        ${p.url?`<a class="btn btn-sm" href="${esc(p.url)}" target="_blank" rel="noopener">↗ Open</a>`:""}
        <button class="btn btn-sm" data-chat="${esc(p.id)}">💬 Chat</button>
        ${!p.tldr&&(p.doi||p.title)?`<button class="btn btn-sm" data-tldr="${esc(p.id)}" title="Fetch a one-sentence TLDR from Semantic Scholar">🧾 TL;DR</button>`:""}
      </div>
    </div>`;
  }

  function renderManualEntry(){
    const modal = document.createElement("div");
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px";
    modal.innerHTML = `<div class="card" style="max-width:560px;width:100%;max-height:90vh;overflow:auto">
      <div class="between mb"><h3 style="margin:0">Manual Paper Entry</h3><button class="btn btn-ghost btn-sm" id="closeM">✕</button></div>
      <div class="field"><label>Title *</label><input class="input" id="mTitle"></div>
      <div class="field"><label>Authors (one per line; "Last, First")</label><textarea class="textarea" id="mAuthors" rows="3" placeholder="Smith, John&#10;Doe, Jane"></textarea></div>
      <div class="row">
        <div class="field"><label>Year</label><input class="input" id="mYear" type="number"></div>
        <div class="field"><label>DOI</label><input class="input" id="mDoi"></div>
      </div>
      <div class="field"><label>Venue / Journal</label><input class="input" id="mVenue"></div>
      <div class="field"><label>URL</label><input class="input" id="mUrl"></div>
      <div class="field"><label>Abstract</label><textarea class="textarea" id="mAbstract" rows="4" placeholder="Paste the paper's abstract here"></textarea></div>
      <div class="flex"><button class="btn btn-primary" id="saveM">Add to library</button></div>
    </div>`;
    document.body.appendChild(modal);
    const close = ()=> modal.remove();
    modal.addEventListener("click", e=>{ if(e.target===modal) close(); });
    $("#closeM", modal).addEventListener("click", close);
    $("#saveM", modal).addEventListener("click", ()=>{
      const title = $("#mTitle", modal).value.trim();
      if(!title){ toast("Title is required.","error"); return; }
      const authors = $("#mAuthors", modal).value.split("\n").map(s=>s.trim()).filter(Boolean);
      const paper = {
        id:"manual-"+RW.uid(), source:"manual",
        title, authors,
        year: parseInt($("#mYear", modal).value) || null,
        doi: $("#mDoi", modal).value.trim(),
        venue: $("#mVenue", modal).value.trim(),
        url: $("#mUrl", modal).value.trim(),
        abstract: $("#mAbstract", modal).value.trim(),
        collected:true, addedAt:Date.now()
      };
      State.papers.push(paper); saveState(); RW.refreshCounts();
      toast("Paper added to library.","success");
      close(); render();
    });
  }

  Object.assign(RW, { SearchUI: { render, renderResults, renderManualEntry } });
})();
