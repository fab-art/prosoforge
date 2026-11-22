/* ============================================================================
   Research Workstation — consensus-ui.js
   Agreement Meter UI (Phase 2a — Consensus reverse-engineering).
   Question → search (existing engine) → per-paper verdicts → donut meter +
   quote cards. Deterministic heuristics; optional WebLLM re-check, AI-tagged.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast } = RW;

  let lastRun = null;

  const VERDICT_META = {
    supports:    { label:"Supports",    badge:"badge-success", icon:"✅" },
    contradicts: { label:"Contradicts", badge:"badge-danger",  icon:"⛔" },
    mixed:       { label:"Mixed",       badge:"badge-warning", icon:"🔀" },
    inconclusive:{ label:"Inconclusive",badge:"badge-muted",   icon:"❔" },
    off_topic:   { label:"Off topic",   badge:"badge-muted",   icon:"🚫" },
  };

  function render(){
    const c = $("#content");
    const libCount = (State.papers||[]).length;
    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div>
        <b>Agreement Meter</b> — ask a yes/no research question; each retrieved paper's abstract is classified as <b>supporting / contradicting / mixed / inconclusive</b> with the exact sentence that drove the verdict. Verdicts are transparent keyword-direction heuristics (e.g. "significant reduction" vs. "no significant effect"), not an oracle — read the quotes and the papers. This summarizes the literature you retrieved; it is not evidence itself.
      </div></div>

      <div class="card">
        <label class="small muted">Research question (yes/no phrasing works best)</label>
        <input class="input" id="cqInput" style="width:100%" placeholder='e.g. "Does mindfulness meditation reduce stress?" or "Is REM sleep associated with memory consolidation?"'>
        <div class="flex gap-sm wrap mt">
          <label class="small muted" style="align-self:center">Max papers to classify:</label>
          <select id="cqMax" class="input" style="max-width:90px"><option>15</option><option selected>25</option><option>40</option><option>60</option></select>
          <button class="btn btn-primary" id="cqRun">🔍 Search &amp; classify</button>
          <label class="check"><input type="checkbox" id="cqUseLib"> <span class="small">use my library (${libCount} papers) instead of searching</span></label>
        </div>
        <div class="small muted mt" id="cqStatus"></div>
      </div>

      <div id="cqOut"></div>
    `;
    $("#cqRun", c).addEventListener("click", run);
    if(lastRun) drawResults(c);
  }

  async function run(){
    const c = $("#content");
    const q = $("#cqInput", c).value.trim();
    if(!q){ toast("Enter a research question.","error"); return; }
    const max = parseInt($("#cqMax", c).value, 10);
    const useLib = $("#cqUseLib", c).checked;
    const status = $("#cqStatus", c);
    const btn = $("#cqRun", c);
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Working…`;

    try{
      let papers;
      if(useLib){
        papers = (State.papers||[]).filter(p => (p.abstract||"").length > 40).slice(0, max);
        status.textContent = `Classifying ${papers.length} library papers…`;
      } else {
        status.textContent = "Searching across your enabled sources…";
        const found = await RW.Search.runSearch(q, State.settings.sources);
        papers = found.filter(p => (p.abstract||"").length > 40).slice(0, max);
        status.textContent = `Search returned ${found.length} papers; classifying ${papers.length} with abstracts…`;
      }
      if(!papers.length){
        $("#cqOut", c).innerHTML = `<div class="empty" style="padding:24px">No papers with abstracts. ${useLib ? "Collect papers in Literature Search first." : "Check your internet connection / enabled sources in Settings."}</div>`;
        return;
      }
      lastRun = RW.Consensus.classify(q, papers);
      drawResults(c);
    }catch(e){
      $("#cqOut", c).innerHTML = `<div class="notice notice-danger"><span class="ic">⚠️</span><div>${esc(e.message)}</div></div>`;
    }finally{
      btn.disabled = false; btn.innerHTML = "🔍 Search &amp; classify";
    }
  }

  function drawResults(c){
    const { question, verdicts, stats } = lastRun;
    const out = $("#cqOut", c);
    const decisive = stats.decisive;
    const pct = (n) => decisive ? Math.round(n/decisive*100) : 0;
    const yes = pct(stats.supports), no = pct(stats.contradicts);
    const order = { supports:0, contradicts:1, mixed:2, inconclusive:3, off_topic:4 };
    const sorted = [...verdicts].sort((a,b) => order[a.verdict]-order[b.verdict]);

    out.innerHTML = `
      <div class="card">
        <div class="flex gap wrap" style="align-items:center">
          <div style="position:relative;width:120px;height:120px;flex:0 0 auto">
            <div style="width:120px;height:120px;border-radius:50%;background:conic-gradient(var(--success) 0 ${yes}%, var(--danger) ${yes}% ${yes+no}%, var(--warning) ${yes+no}% 100%)"></div>
            <div style="position:absolute;inset:18px;border-radius:50%;background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center">
              <div style="font-size:22px;font-weight:800">${decisive ? yes + "%" : "—"}</div>
              <div class="small muted">agree</div>
            </div>
          </div>
          <div style="flex:1;min-width:220px">
            <div class="small muted">Research question</div>
            <div style="font-weight:700;margin-bottom:8px">${esc(question.text)}</div>
            <div class="small">${/\breduce|improve|increase/i.test(question.text) ? "Directional — expects "+esc(question.dirLabel) : "Non-directional — any significant effect counts"}</div>
            <div class="flex gap-sm wrap mt">
              <span class="badge badge-success">✅ ${stats.supports} supports (${yes}%)</span>
              <span class="badge badge-danger">⛔ ${stats.contradicts} contradict (${no}%)</span>
              <span class="badge badge-warning">🔀 ${stats.mixed} mixed (${pct(stats.mixed)}%)</span>
              <span class="badge badge-muted">❔ ${stats.inconclusive} inconclusive</span>
              ${stats.offTopic ? `<span class="badge badge-muted">🚫 ${stats.offTopic} off-topic</span>` : ""}
            </div>
          </div>
        </div>
        <div class="small muted mt"><b>How to read this:</b> percentages are over <i>decisive</i> papers only (supports + contradicts + mixed). Inconclusive and off-topic papers are excluded from the meter but listed below. Sample = the ${stats.total} papers retrieved by your search — not the whole literature.</div>
      </div>

      ${sorted.map((v, i) => card(v, i)).join("")}
    `;
    wireAI(c);
  }

  function card(v, i){
    const m = VERDICT_META[v.verdict] || VERDICT_META.inconclusive;
    const quoteHtml = v.verdict === "off_topic"
      ? `<div class="small muted">Shares too few question terms — excluded from the meter. Abstract starts: "${esc(v.quote)}"</div>`
      : `<div class="small" style="background:var(--surface-2);border-left:3px solid var(--border);padding:8px;border-radius:4px">"${esc(v.quote)}"</div>`;
    return `
      <div class="card" style="padding:10px">
        <div class="flex gap-sm wrap mb-sm" style="align-items:center">
          <span class="badge ${m.badge}">${m.icon} ${m.label}${v.ai ? " (AI)" : ""}</span>
          <strong style="flex:1;min-width:200px" class="small">${esc(v.title||"untitled")}</strong>
          <span class="small muted">${v.year||""}</span>
          ${v.url ? `<a class="small" href="${esc(v.url)}" target="_blank" rel="noopener">↗</a>` : ""}
        </div>
        ${quoteHtml}
        <div class="flex gap-sm wrap mt-sm" style="align-items:center">
          <span class="small muted">cues: ${v.cues.length ? esc(v.cues.join(", ")) : "none matched"}</span>
          ${(v.verdict==="inconclusive"||v.verdict==="mixed") ? `<button class="btn btn-sm aiRecheck" data-idx="${i}" title="Requires WebLLM loaded in Settings">✨ AI re-check</button>` : ""}
        </div>
      </div>
    `;
  }

  function wireAI(c){
    $$(".aiRecheck", c).forEach(b => b.addEventListener("click", async () => {
      const v = lastRun.verdicts[parseInt(b.dataset.idx, 10)];
      if(!v) return;
      if(!RW.WebLLM || !RW.WebLLM.isReady()){ toast("WebLLM not loaded — enable in Settings, or rely on the heuristic verdict.","info"); return; }
      b.disabled = true; b.innerHTML = `<span class="spinner"></span>`;
      const paper = (State.papers||[]).find(p => p.id === v.paperId) || v;
      const r = await RW.Consensus.reclassifyWithAI(lastRun.question.text, paper);
      b.disabled = false; b.innerHTML = "✨ AI re-check";
      if(r){
        v.verdict = r.verdict; v.ai = true; v.source = "webllm";
        v.quote = "AI verdict — verify against the abstract yourself. " + v.quote;
        recountStats();
        drawResults(c);
        toast("AI re-check applied (tagged).","success");
      } else {
        toast("AI returned no usable verdict — heuristic verdict kept.","info");
      }
    }));
  }

  function recountStats(){
    const vs = lastRun.verdicts;
    const s = lastRun.stats;
    s.supports = vs.filter(v=>v.verdict==="supports").length;
    s.contradicts = vs.filter(v=>v.verdict==="contradicts").length;
    s.mixed = vs.filter(v=>v.verdict==="mixed").length;
    s.inconclusive = vs.filter(v=>v.verdict==="inconclusive").length;
    s.offTopic = vs.filter(v=>v.verdict==="off_topic").length;
    s.decisive = s.supports + s.contradicts + s.mixed;
    s.pctYes = s.decisive ? Math.round(s.supports/s.decisive*100) : 0;
    s.pctNo = s.decisive ? Math.round(s.contradicts/s.decisive*100) : 0;
    s.pctMixed = s.decisive ? 100 - s.pctYes - s.pctNo : 0;
  }

  Object.assign(RW, { ConsensusUI: { render } });
})();
