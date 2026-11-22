/* ============================================================================
   Research Workstation — matrix-ui.js
   Evidence Matrix UI (Phase 1 — Elicit reverse-engineering).
   Builder → extraction → editable comparison table with per-cell source
   sentences, keyword screening badges, CSV export, saved matrices.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, downloadBlob } = RW;

  let working = null; // matrix being built/edited in this session

  function render(){
    const c = $("#content");
    const papers = RW.Matrix.usablePapers();
    const saved = State.matrices || [];
    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div>
        <b>Evidence Matrix</b> — systematic-review extraction (an Elicit-style workflow, local &amp; free). Cells are extracted from <b>title + abstract</b> by transparent keyword heuristics and every cell shows the sentence it came from; the WebLLM model can refine cells if loaded. You can edit any cell — AI never overwrites your edits. Screening is keyword matching with visible reasons, not a verdict.
      </div></div>

      ${saved.length ? `
      <div class="card">
        <h3 style="margin-top:0">💾 Saved matrices (${saved.length})</h3>
        <table><tr><th>Name</th><th>Papers</th><th>Columns</th><th>Created</th><th></th></tr>
        ${saved.map(m => `
          <tr>
            <td><a href="#" class="loadMatrix" data-id="${m.id}">${esc(m.name)}</a></td>
            <td>${m.paperIds.length}</td><td>${m.columns.length}</td>
            <td class="small muted">${new Date(m.createdAt).toLocaleDateString()}</td>
            <td><button class="btn btn-sm btn-danger delMatrix" data-id="${m.id}">✕</button></td>
          </tr>`).join("")}
        </table>
      </div>` : ""}

      <div class="card">
        <h3 style="margin-top:0">🧪 1 · Choose papers</h3>
        <div class="small muted mb">${papers.length} papers in your library${papers.length ? " — " + papers.filter(p=>(p.abstract||"").length>40).length + " have abstracts usable for extraction" : ""}. <b>Collect papers in Literature Search first</b> if this is empty.</div>
        <input class="input" id="paperFilter" placeholder="Filter papers by title…">
        <div id="paperList" style="max-height:260px;overflow-y:auto;margin-top:8px"></div>
        <div class="flex gap-sm mt">
          <button class="btn btn-sm" id="selAll">Select all</button>
          <button class="btn btn-sm" id="selNone">Clear</button>
          <span class="small muted" style="align-self:center" id="selCount">0 selected</span>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">📊 2 · Choose columns</h3>
        <div class="grid2" id="colChoices">
          ${Object.entries(RW.Matrix.EXTRACTORS).map(([id,x]) => `
            <label class="check"><input type="checkbox" value="${id}" ${["design","method","findings","limitations"].includes(id)?"checked":""}> <b>${esc(x.label)}</b> <span class="small muted">— ${esc(x.hint)}</span></label>
          `).join("")}
        </div>
        <div class="mt">
          <div class="small muted mb-sm">Custom columns (comma-separated) — left empty for you to fill:</div>
          <input class="input" id="customCols" placeholder="e.g. Theory used, Region, Funding source">
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">🔎 3 · Screening criteria (optional)</h3>
        <div class="small muted mb">Keyword matching against title+abstract. Include = must mention at least half these terms; any exclude term rejects. Reasons shown per row.</div>
        <div class="grid2">
          <div><label class="small muted">Include terms</label><textarea class="textarea" id="critInc" style="min-height:60px" placeholder="e.g. randomized, adults, depression"></textarea></div>
          <div><label class="small muted">Exclude terms</label><textarea class="textarea" id="critExc" style="min-height:60px" placeholder="e.g. animal, review, preprint"></textarea></div>
        </div>
      </div>

      <div class="card">
        <div class="flex gap-sm wrap">
          <button class="btn btn-primary" id="buildMatrix">⚙️ Build matrix</button>
          <input class="input" id="matrixName" style="max-width:280px" placeholder="Matrix name (e.g. RCTs on CBT for insomnia)">
          <button class="btn" id="saveMatrixBtn" disabled>💾 Save to library</button>
          <button class="btn" id="exportCsvBtn" disabled>⬇ Export CSV</button>
          <button class="btn" id="aiRefineBtn" disabled title="Requires WebLLM model loaded in Settings">✨ AI-refine empty cells</button>
        </div>
        <div id="matrixOut" class="mt"></div>
      </div>
    `;
    wire(c, papers);
  }

  function wire(c, papers){
    const selected = new Set();

    function drawPaperList(){
      const q = ($("#paperFilter", c).value||"").toLowerCase();
      const list = papers.filter(p => !q || (p.title||"").toLowerCase().includes(q));
      $("#paperList", c).innerHTML = list.length ? list.slice(0, 80).map(p => `
        <label class="check paperRow" data-id="${p.id}">
          <input type="checkbox" class="selPaper" data-id="${p.id}" ${selected.has(p.id)?"checked":""}>
          <span><b>${esc((p.title||"untitled").slice(0,110))}</b>
          <span class="small muted"> ${p.year||""} ${p.abstract ? "· has abstract" : "· title only"}</span></span>
        </label>`).join("") : `<div class="empty" style="padding:12px">No papers match.</div>`;
      $$(".selPaper", c).forEach(cb => cb.addEventListener("change", () => {
        if(cb.checked) selected.add(cb.dataset.id); else selected.delete(cb.dataset.id);
        updateCount();
      }));
      updateCount();
    }
    function updateCount(){ $("#selCount", c).textContent = selected.size + " selected"; }
    $("#paperFilter", c).addEventListener("input", drawPaperList);
    $("#selAll", c).addEventListener("click", () => { papers.slice(0,80).forEach(p=>selected.add(p.id)); drawPaperList(); });
    $("#selNone", c).addEventListener("click", () => { selected.clear(); drawPaperList(); });
    drawPaperList();

    $("#buildMatrix", c).addEventListener("click", () => {
      if(!selected.size){ toast("Select at least one paper.","error"); return; }
      const kinds = $$("#colChoices input:checked", c).map(i => i.value);
      if(!kinds.length && !$("#customCols", c).value.trim()){ toast("Pick at least one column.","error"); return; }
      const custom = $("#customCols", c).value.split(",").map(s=>s.trim()).filter(Boolean);
      const chosen = papers.filter(p => selected.has(p.id));
      working = RW.Matrix.createMatrix({
        name: $("#matrixName", c).value.trim() || "Untitled matrix",
        papers: chosen, columnKinds: kinds, customColumns: custom,
        criteria: { include: $("#critInc", c).value, exclude: $("#critExc", c).value },
      });
      drawMatrix(c);
      $("#saveMatrixBtn", c).disabled = false;
      $("#exportCsvBtn", c).disabled = false;
      $("#aiRefineBtn", c).disabled = !(RW.WebLLM && RW.WebLLM.isReady());
      if(RW.WebLLM && RW.WebLLM.isReady() === false){
        $("#aiRefineBtn", c).title = "WebLLM not loaded — enable it in Settings";
      }
      toast(`Matrix built: ${chosen.length} papers × ${working.columns.length} columns.`,"success");
    });

    $("#saveMatrixBtn", c).addEventListener("click", () => {
      if(!working) return;
      working.name = $("#matrixName", c).value.trim() || working.name;
      RW.Matrix.saveMatrix(working);
      toast("Saved. Reload the page to see it in Saved matrices.","success");
      render();
    });

    $("#exportCsvBtn", c).addEventListener("click", () => {
      if(!working) return;
      const csv = RW.Matrix.toCSV(working, RW.Matrix.papersByIdMap());
      const name = (working.name||"matrix").replace(/[^\w-]+/g,"_").slice(0,40);
      downloadBlob(csv, `evidence-matrix-${name}.csv`, "text/csv");
      toast("CSV downloaded.","success");
    });

    $("#aiRefineBtn", c).addEventListener("click", async () => {
      if(!working) return;
      const btn = $("#aiRefineBtn", c);
      btn.disabled = true;
      const targets = [];
      working.paperIds.forEach(pid => working.columns.forEach(col => {
        const cell = working.rows[pid]?.[col.id];
        if(cell && !cell.value && !cell.edited) targets.push({pid, col});
      }));
      if(!targets.length){ toast("No empty (unedited) cells to refine.","info"); btn.disabled=false; return; }
      const byId = RW.Matrix.papersByIdMap();
      let done = 0;
      for(const t of targets){
        const paper = byId[t.pid]; if(!paper) continue;
        btn.innerHTML = `<span class="spinner"></span> ${done}/${targets.length}`;
        try{
          const r = await RW.Matrix.refineCellWithAI(working, paper, t.col);
          if(r){ const cell = working.rows[t.pid][t.col.id]; cell.value = r.value; cell.ai = true; }
        }catch(e){ console.warn("refine failed", e); }
        done++;
      }
      btn.disabled = false; btn.innerHTML = "✨ AI-refine empty cells";
      drawMatrix(c);
      toast(`AI refinement finished (${done} cells processed — empty results stay empty).`,"success");
    });

    $$(".loadMatrix", c).forEach(a => a.addEventListener("click", e => {
      e.preventDefault();
      const m = (State.matrices||[]).find(x => x.id === a.dataset.id);
      if(!m) return;
      working = m;
      $("#matrixName", c).value = m.name;
      drawMatrix(c);
      $("#saveMatrixBtn", c).disabled = false;
      $("#exportCsvBtn", c).disabled = false;
      $("#aiRefineBtn", c).disabled = !(RW.WebLLM && RW.WebLLM.isReady());
    }));
    $$(".delMatrix", c).forEach(b => b.addEventListener("click", () => {
      RW.Matrix.deleteMatrix(b.dataset.id);
      toast("Matrix deleted.","info");
      render();
    }));

    drawMatrix(c); // re-draw if a matrix was loaded then view re-rendered
  }

  /* ---------------- table drawing + cell editing ---------------- */
  function drawMatrix(c){
    const out = $("#matrixOut", c);
    if(!working){ out.innerHTML = ""; return; }
    const byId = RW.Matrix.papersByIdMap();
    const stats = RW.Matrix.matrixStats(working);
    const screened = Object.keys(working.screening||{}).length > 0;

    let html = `
      <div class="flex gap-sm wrap mb-sm">
        <span class="badge badge-muted">${working.paperIds.length} papers</span>
        <span class="badge badge-muted">${working.columns.length} columns</span>
        <span class="badge ${stats.filled===stats.total?"badge-success":"badge-warning"}">${stats.filled}/${stats.total} cells filled</span>
        ${stats.ai ? `<span class="badge badge-advisory">${stats.ai} AI-refined</span>` : ""}
        ${stats.edited ? `<span class="badge badge-success">${stats.edited} edited by you</span>` : ""}
      </div>
      <div style="overflow-x:auto"><table class="matrixTable">
      <tr><th style="position:sticky;left:0;background:var(--surface);min-width:220px">Paper</th>
      ${working.columns.map(col => `<th>${esc(col.label)}</th>`).join("")}
      ${screened ? "<th>Screening</th>" : ""}</tr>
    `;
    working.paperIds.forEach(pid => {
      const p = byId[pid] || {};
      const row = working.rows[pid] || {};
      const scr = screened ? working.screening[pid] : null;
      html += `<tr>
        <td style="position:sticky;left:0;background:var(--surface);max-width:240px">
          <b class="small">${esc((p.title||"(paper no longer in library)").slice(0,120))}</b>
          <div class="small muted">${p.year||""} ${p.authors && p.authors.length ? "· "+esc(p.authors[0]) : ""}</div>
        </td>`;
      working.columns.forEach(col => {
        const cell = row[col.id] || {};
        html += `
        <td class="matrixCell" data-pid="${pid}" data-col="${col.id}">
          <div class="cellVal small" contenteditable="true" data-ph="${col.kind==="custom"?"fill in…":""}">${esc(cell.value||"")}</div>
          ${cell.value ? `<details class="cellSrc"><summary class="small muted">source</summary><div class="small muted" style="white-space:pre-wrap">${esc(cell.source||"")}</div></details>` : ""}
          <div class="small cellTags" style="margin-top:4px">
            ${cell.ai ? `<span class="badge badge-advisory">AI — verify</span>` : ""}
            ${cell.edited ? `<span class="badge badge-success">edited</span>` : ""}
          </div>
        </td>`;
      });
      if(screened){
        const cls = { include:"badge-success", exclude:"badge-danger", maybe:"badge-warning" }[scr.verdict] || "badge-muted";
        html += `<td><span class="badge ${cls}">${scr.verdict}</span><div class="small muted" style="max-width:180px">${esc(scr.reason)}</div></td>`;
      }
      html += `</tr>`;
    });
    html += `</table></div>
      <div class="small muted mt">Click a cell to edit. Click "source" to see the exact sentence each extraction came from. AI-refined cells are tagged — verify each before use.</div>`;
    out.innerHTML = html;

    // cell editing — mark edited, never silently lost
    $$(".cellVal", out).forEach(el => el.addEventListener("blur", () => {
      const pid = el.closest(".matrixCell").dataset.pid;
      const colId = el.closest(".matrixCell").dataset.col;
      const cell = working.rows[pid]?.[colId];
      if(!cell) return;
      const v = el.textContent.trim();
      if(v !== (cell.value||"")){
        cell.value = v; cell.edited = true; cell.ai = false;
        drawMatrix(c);
        toast("Cell updated — marked as edited by you.","info", 1800);
      }
    }));
  }

  Object.assign(RW, { MatrixUI: { render } });
})();
