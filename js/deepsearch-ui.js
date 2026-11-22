/* ============================================================================
   Research Workstation — deepsearch-ui.js
   Deep Search UI (Phase 5d — Undermind reverse-engineering).
   Question → N query rounds (WebLLM-refined or deterministic) → results with
   per-paper provenance (which query found it, which round) + deterministic
   coverage stats. Collect-all / export report .md.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, saveState } = RW;

  let result = null;
  let running = false;

  function render(){
    const c = $("#content");
    const llmReady = RW.WebLLM.isReady();
    const enabledSources = Object.entries(State.settings.sources||{}).filter(([,v])=>v).map(([k])=>k);
    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div>
        <b>Deep Search</b> (Undermind-style) — give a hard research question; the loop runs successive query rounds through all six free academic APIs: round 0 = seed queries, then WebLLM (or deterministic gap-finder without a model) proposes <b>new queries aimed at what's missing</b>. Every paper shows <b>which queries found it and when</b>. Honest limits: results are <b>leads, not exhaustive coverage</b>; bounded by a small model's query imagination; a 2-round run fires ~6–10 API calls.
      </div></div>

      <div class="card">
        <label class="small muted">Research question</label>
        <input class="input" id="dsQuestion" style="width:100%" placeholder="e.g. does spaced repetition outperform massed practice for complex problem-solving?">
        <div class="flex gap-sm wrap mt">
          <label class="small muted" style="align-self:center">Rounds:</label>
          <select class="input" id="dsRounds" style="max-width:110px">
            <option value="1">1 (quick)</option>
            <option value="2" selected>2 (standard)</option>
            <option value="3">3 (deep)</option>
          </select>
          <span class="small muted" style="align-self:center">sources: ${enabledSources.length? esc(enabledSources.join(", ")) : "⚠ none enabled"}</span>
          <button class="btn btn-primary" id="dsRun" ${enabledSources.length?"":"disabled title=\"Enable at least one API source in Settings\""}>🌀 Run deep search</button>
        </div>
        <div class="small muted mt" id="dsStatus">${llmReady? "WebLLM ready — rounds will be AI-refined (tagged per round)." : "No model loaded — rounds use the deterministic gap-finder (still effective)."}</div>
        <div id="dsRoundLog" class="small mt"></div>
      </div>

      <div id="dsResult"></div>
    `;
    $("#dsRun", c).addEventListener("click", run);
  }

  async function run(){
    const c = $("#content");
    const q = $("#dsQuestion", c).value.trim();
    if(q.length<15){ toast("Give a real research question (15+ chars).","error"); return; }
    const rounds = parseInt($("#dsRounds", c).value,10);
    const btn = $("#dsRun", c);
    const status = $("#dsStatus", c);
    const logBox = $("#dsRoundLog", c);
    btn.disabled = true; running = true;
    try{
      result = await RW.DeepSearch.deepSearch(q, { rounds, sources: State.settings.sources, onProgress: evt=>{
        status.innerHTML = `<span class="spinner"></span> Round ${evt.round} · ${evt.phase}… <span class="muted">${esc(evt.detail||"")}</span>`;
        logBox.innerHTML += `<div>▸ <b>R${evt.round}</b> ${evt.phase}: ${esc(evt.detail||"")}</div>`;
      }});
      logBox.innerHTML += `<div>▸ <b>done</b>: ${result.papers.length} papers · term coverage ${(result.coverage.termCoverage*100).toFixed(0)}%</div>`;
      status.textContent = `Finished: ${result.papers.length} unique papers in ${result.roundLog.length} round(s).`;
      renderResult();
    }catch(e){
      status.textContent = "Deep search failed: "+e.message;
      toast(e.message,"error",5000);
    }finally{
      btn.disabled = false; running = false;
    }
  }

  function renderResult(){
    const c = $("#content");
    const box = $("#dsResult", c);
    if(!result) return;
    const cov = result.coverage;
    box.innerHTML = `
      <div class="card mt">
        <div class="flex gap-sm wrap mb-sm">
          <span class="badge badge-draft">ADVISORY — leads, not exhaustive coverage</span>
          <span class="badge badge-muted">${cov.count} papers</span>
          <span class="badge badge-muted">${cov.sources.map(s=>`${s.source}·${s.n}`).join(", ")||"no sources"}</span>
          <span class="badge badge-muted">years ${cov.yearMin||"—"}–${cov.yearMax||"—"}</span>
          <span class="badge ${cov.termCoverage>=0.8?"badge-success":"badge-warning"}">term coverage ${(cov.termCoverage*100).toFixed(0)}%</span>
        </div>
        ${cov.missingTerms.length? `<div class="small muted mb-sm">Question terms with NO hit in any result: <b>${esc(cov.missingTerms.join(", "))}</b> — run another round or add these terms manually in Literature Search.</div>`:""}
        <div class="flex gap-sm wrap mb-sm">
          <button class="btn btn-sm btn-primary" id="dsCollectAll">＋ Collect all (${result.papers.length})</button>
          <button class="btn btn-sm" id="dsMd">⬇️ report .md</button>
        </div>
        <div style="max-height:520px;overflow:auto">
        ${result.papers.map((v,i)=>`
          <div class="small" style="padding:6px 0;border-bottom:1px dashed var(--border)">
            <div><b>${esc((v.paper.title||"untitled").slice(0,110))}</b> <span class="muted">(${v.paper.year||"—"})</span> <span class="badge badge-muted">R${v.round}</span></div>
            <div class="muted">found by: ${v.foundBy.map(q=>`“${esc(q.slice(0,60))}${q.length>60?"…":""}”`).join(" · ")}</div>
            ${v.paper.abstract? `<div class="muted mt-sm">${esc(v.paper.abstract.slice(0,180))}…</div>`:""}
          </div>`).join("")}
        </div>
        <div class="small muted mt">Dedupe by normalized title across rounds. Repeated "found by" = the same paper answered multiple queries (usually a strong lead).</div>
      </div>`;
    $("#dsCollectAll", box).addEventListener("click", collectAll);
    $("#dsMd", box).addEventListener("click", ()=>{
      RW.downloadBlob(RW.DeepSearch.reportMd(result), "deep-search-report.md", "text/markdown");
      toast("Report exported.","success");
    });
  }

  function collectAll(){
    const c = $("#content");
    let added = 0;
    result.papers.forEach(v=>{
      const p = v.paper;
      const dup = State.papers.find(x=> RW.normalizeTitle(x.title||"")===RW.normalizeTitle(p.title||""));
      if(dup) return;
      State.papers.push({ ...p, collected:true, addedAt:Date.now() });
      added++;
    });
    saveState(); RW.refreshCounts();
    toast(`${added} papers added to library (${result.papers.length-added} already there).`,"success",4000);
  }

  Object.assign(RW, { DeepSearchUI: { render } });
})();
