/* ============================================================================
   Research Workstation — citations-ui.js
   Render logic for the Citation Manager view. Manual entry + import-from-library
   + APA/MLA/Chicago auto-formatting via RW.formatCitation / RW.inText.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, saveState, refreshCounts, formatCitation, inText, normalizeTitle, uid } = RW;

  function render(){
    const c = $("#content");
    c.innerHTML = `
      <div class="card">
        <div class="row">
          <div class="field"><label>Title *</label><input class="input" id="cTitle"></div>
          <div class="field" style="max-width:120px"><label>Year</label><input class="input" id="cYear" type="number"></div>
        </div>
        <div class="field"><label>Authors (one per line; "Last, First")</label><textarea class="textarea" id="cAuthors" rows="3" placeholder="Smith, John"></textarea></div>
        <div class="row">
          <div class="field"><label>Venue / Journal</label><input class="input" id="cVenue"></div>
          <div class="field"><label>DOI</label><input class="input" id="cDoi"></div>
        </div>
        <div class="field"><label>URL</label><input class="input" id="cUrl"></div>
        <div class="flex gap-sm wrap">
          <button class="btn btn-primary" id="addCite">+ Add citation</button>
          <button class="btn btn-sm" id="importFromLibrary">⬆ Import from library</button>
        </div>
      </div>
      <div class="card">
        <div class="between mb-sm">
          <h3 style="margin:0">Reference list</h3>
          <div class="flex gap-sm">
            <select class="select" id="citeStyle" style="max-width:140px">
              <option value="apa" ${State.settings.citationStyle==='apa'?'selected':''}>APA</option>
              <option value="mla" ${State.settings.citationStyle==='mla'?'selected':''}>MLA</option>
              <option value="chicago" ${State.settings.citationStyle==='chicago'?'selected':''}>Chicago</option>
            </select>
            <button class="btn btn-sm" id="copyAll">📋 Copy all</button>
            <button class="btn btn-sm btn-danger" id="clearCites">Clear</button>
          </div>
        </div>
        <div id="citeList"></div>
      </div>
    `;
    $("#citeStyle", c).addEventListener("change", e=>{ State.settings.citationStyle = e.target.value; saveState(); renderCiteList(); });
    $("#addCite", c).addEventListener("click", ()=>{
      const title = $("#cTitle", c).value.trim();
      if(!title){ toast("Title required.","error"); return; }
      const authors = $("#cAuthors", c).value.split("\n").map(s=>s.trim()).filter(Boolean);
      State.citations.push({
        id: uid(), title, authors,
        year: parseInt($("#cYear", c).value) || null,
        venue: $("#cVenue", c).value.trim(),
        doi: $("#cDoi", c).value.trim(),
        url: $("#cUrl", c).value.trim()
      });
      saveState(); RW.refreshCounts();
      ["cTitle","cAuthors","cYear","cVenue","cDoi","cUrl"].forEach(id=> $("#"+id, c).value="");
      renderCiteList();
      toast("Citation added.","success");
    });
    $("#importFromLibrary", c).addEventListener("click", ()=>{
      const existing = State.citations.map(c=> normalizeTitle(c.title));
      let added = 0;
      State.papers.forEach(p=>{
        if(!existing.includes(normalizeTitle(p.title))){
          State.citations.push({
            id: uid(), title:p.title, authors:p.authors||[], year:p.year,
            venue:p.venue||"", doi:p.doi||"", url:p.url||"", fromPaper:p.id
          });
          added++;
        }
      });
      saveState(); RW.refreshCounts(); renderCiteList();
      toast(added? `Imported ${added} citation(s).` : "Nothing new to import.", added? "success" : "info");
    });
    $("#copyAll", c).addEventListener("click", ()=>{
      const style = State.settings.citationStyle;
      const text = State.citations.map((c,i)=> `${i+1}. ${formatCitation(c, style)}`).join("\n");
      navigator.clipboard.writeText(text).then(()=> toast("Copied.","success"));
    });
    $("#clearCites", c).addEventListener("click", ()=>{
      if(confirm("Clear all citations?")){ State.citations = []; saveState(); RW.refreshCounts(); renderCiteList(); }
    });
    renderCiteList();
  }

  function renderCiteList(){
    const box = $("#citeList");
    if(!box) return;
    if(!State.citations.length){ box.innerHTML = `<div class="empty" style="padding:20px">No citations yet. Add one above or import from your paper library.</div>`; return; }
    const style = State.settings.citationStyle;
    box.innerHTML = State.citations.map((c,i)=>`
      <div class="card" style="background:var(--surface-2);padding:12px;margin-bottom:8px">
        <div class="between mb-sm">
          <span class="badge badge-muted">${i+1}</span>
          <button class="btn btn-ghost btn-sm btn-danger" data-del="${c.id}">✕</button>
        </div>
        <div style="margin-bottom:6px">${esc(formatCitation(c, style))}</div>
        <div class="small muted">In-text: <code>${esc(inText(c, style))}</code></div>
      </div>
    `).join("");
    $$('[data-del]', box).forEach(b=> b.addEventListener("click", ()=>{
      State.citations = State.citations.filter(c=>c.id!==b.dataset.del);
      saveState(); RW.refreshCounts(); renderCiteList();
    }));
  }

  Object.assign(RW, { CitationsUI: { render, renderCiteList } });
})();
