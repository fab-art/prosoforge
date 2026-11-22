/* ============================================================================
   Research Workstation — settings.js
   Settings view: WebLLM model picker + load/unload, search sources,
   citation style, scrape proxy, data export/import, privacy summary.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, saveState, refreshCounts, downloadBlob } = RW;

  function render(){
    const c = $("#content");
    const models = RW.WebLLM.getModels();
    const currentModel = State.settings.webllmModel;
    const ready = RW.WebLLM.isReady();
    c.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0">🧠 WebLLM (in-browser LLM)</h3>
        <div class="notice notice-info"><span class="ic">🔒</span><div>WebLLM downloads a small language model into your browser and runs it locally with WebGPU. The first load downloads model weights (~0.8–2.5 GB depending on model) and caches them. After that, chat and synthesis work fully offline — no API key, no server, your text never leaves the browser. Requires a WebGPU-capable browser (Chrome/Edge 113+, or Safari 18+).</div></div>
        <label>Select a model</label>
        <div class="model-grid" id="modelGrid">
          ${models.map(m=>`
            <div class="model-card ${m.id===currentModel?'selected':''}" data-model="${esc(m.id)}">
              <b>${esc(m.name)}</b>
              <small>${esc(m.size)}</small>
              <small class="muted">${esc(m.note)}</small>
              ${m.id===currentModel?'<div class="badge badge-muted mt">selected</div>':''}
            </div>
          `).join("")}
        </div>
        <div class="flex gap-sm wrap mt">
          <button class="btn btn-primary" id="loadModel" ${RW.WebLLM.isLoading()?'disabled':''}>${RW.WebLLM.isLoading()?'Loading…':(ready?'Reload model':'Load model')}</button>
          ${ready?`<button class="btn btn-danger" id="unloadModel">Unload model</button>`:""}
        </div>
        <div id="loadStatus"></div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">🔍 Literature search sources</h3>
        <div class="row wrap" id="srcToggles">
          ${Object.keys(RW.SOURCE_LABELS).map(k=>`
            <label class="checkbox-row"><input type="checkbox" data-src="${k}" ${State.settings.sources[k]?"checked":""}> ${RW.SOURCE_LABELS[k]}</label>
          `).join("")}
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">⚙️ Defaults</h3>
        <div class="row">
          <div class="field"><label>Default citation style</label>
            <select class="select" id="defStyle">
              <option value="apa" ${State.settings.citationStyle==='apa'?'selected':''}>APA</option>
              <option value="mla" ${State.settings.citationStyle==='mla'?'selected':''}>MLA</option>
              <option value="chicago" ${State.settings.citationStyle==='chicago'?'selected':''}>Chicago</option>
            </select>
          </div>
          <div class="field"><label>Default scrape proxy</label>
            <select class="select" id="defProxy">
              <option value="jina" ${State.settings.scrapeProxy==='jina'?'selected':''}>r.jina.ai</option>
              <option value="allorigins" ${State.settings.scrapeProxy==='allorigins'?'selected':''}>allorigins.win</option>
              <option value="direct" ${State.settings.scrapeProxy==='direct'?'selected':''}>Direct</option>
            </select>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">💾 Data</h3>
        <div class="small muted mb">All your data lives in this browser's localStorage. Export a backup, or wipe everything.</div>
        <div class="flex gap-sm wrap">
          <button class="btn" id="exportData">⬇ Export all data (.json)</button>
          <button class="btn" id="importData">⬆ Import data</button>
          <button class="btn btn-danger" id="wipeData">🗑 Wipe all data</button>
        </div>
        <input type="file" id="importFile" accept=".json,application/json" class="hidden">
        <div class="small muted mt">Storage used: <code id="storageUsed">—</code></div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">🔒 Privacy summary</h3>
        <table>
          <tr><th>What leaves your browser</th><td>Only: literature search queries → academic APIs (CrossRef, OpenAlex, Semantic Scholar, arXiv, PubMed, DOAJ); scrape URLs → chosen CORS proxy.</td></tr>
          <tr><th>What stays local</th><td>Your draft, notes, citations, uploaded PDFs (extracted text), scraped resources, WebLLM model & inference.</td></tr>
          <tr><th>Account / tracking</th><td>None. No login, no analytics, no cookies beyond localStorage.</td></tr>
          <tr><th>WebLLM</th><td>Model weights download from HuggingFace via the WebLLM CDN; inference is 100% local.</td></tr>
        </table>
      </div>
    `;
    wire(c);
    updateStorageUsed();
  }

  function wire(c){
    // model picker
    $$('[data-model]', c).forEach(card=> card.addEventListener("click", ()=>{
      const id = card.dataset.model;
      State.settings.webllmModel = id; saveState();
      $$('[data-model]', c).forEach(x=>x.classList.toggle("selected", x.dataset.model===id));
      toast("Model set to "+RW.WebLLM.shortName(id)+". Click 'Load model' to download & activate.","info");
    }));
    $("#loadModel", c).addEventListener("click", async ()=>{
      const id = State.settings.webllmModel;
      const btn = $("#loadModel", c);
      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Loading…`;
      const status = $("#loadStatus", c);
      await RW.WebLLM.load(id, (report)=>{
        const pct = Math.round((report.progress||0)*100);
        status.innerHTML = `<div class="progress-bar"><div style="width:${pct}%"></div></div><div class="small muted">${esc(report.text||'')} — ${pct}%</div>`;
      });
      btn.disabled = false; btn.innerHTML = ready()?'Reload model':'Load model';
      // refresh view to show unload button if ready
      render();
    });
    $("#unloadModel", c)?.addEventListener("click", async ()=>{
      await RW.WebLLM.unload(); render();
    });
    // sources
    $$('[data-src]', c).forEach(cb=> cb.addEventListener("change", e=>{
      State.settings.sources[e.target.dataset.src] = e.target.checked; saveState();
    }));
    // defaults
    $("#defStyle", c).addEventListener("change", e=>{ State.settings.citationStyle = e.target.value; saveState(); });
    $("#defProxy", c).addEventListener("change", e=>{ State.settings.scrapeProxy = e.target.value; saveState(); });
    // data
    $("#exportData", c).addEventListener("click", ()=>{
      const data = JSON.stringify(RW.State, null, 2);
      downloadBlob(data, "research-workstation-backup.json", "application/json");
      toast("Backup exported.","success");
    });
    $("#importData", c).addEventListener("click", ()=> $("#importFile", c).click());
    $("#importFile", c).addEventListener("change", async (e)=>{
      const file = e.target.files[0];
      if(!file) return;
      try{
        const text = await file.text();
        const data = JSON.parse(text);
        // merge top-level data keys
        ["papers","notes","citations","resources","documents","draft","settings","activePaperId","activeDocId"].forEach(k=>{
          if(data[k]!==undefined) RW.State[k] = data[k];
        });
        saveState(); refreshCounts();
        toast("Data imported.","success");
        render();
      }catch(err){ toast("Import failed: "+err.message, "error"); }
    });
    $("#wipeData", c).addEventListener("click", ()=>{
      if(!confirm("Wipe ALL local data (papers, notes, citations, documents, draft, settings)? This cannot be undone.")) return;
      localStorage.removeItem(RW.LS_KEY);
      // also unload model
      if(RW.WebLLM.isReady()) RW.WebLLM.unload();
      location.reload();
    });
  }
  function ready(){ return RW.WebLLM.isReady(); }

  function updateStorageUsed(){
    try{
      const raw = localStorage.getItem(RW.LS_KEY) || "";
      const kb = (raw.length/1024).toFixed(1);
      const el = $("#storageUsed");
      if(el) el.textContent = `${kb} KB`;
    }catch(e){}
  }

  Object.assign(RW, { Settings: { render } });
})();
