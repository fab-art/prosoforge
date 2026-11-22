/* ============================================================================
   Research Workstation — citecontext-ui.js
   Citation Context UI (Phase 2b — Scite-lite reverse-engineering).
   Pick a paper → fetch citing works from OpenAlex → classify each citing
   paper's abstract as supporting / contrasting / mentioning with matched
   quotes. Abstract-level approximation, labeled as such.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast } = RW;

  let lastRun = null; // { targetId, stats, results }

  const V_META = {
    supporting:  { badge:"badge-success", icon:"✅", label:"Citing paper reads as SUPPORTING" },
    contrasting: { badge:"badge-danger",  icon:"⛔", label:"Citing paper reads as CONTRASTING" },
    mentioning:  { badge:"badge-muted",   icon:"💬", label:"Cites without directional language" },
  };

  function render(){
    const c = $("#content");
    const eligible = RW.CiteContext.eligiblePapers();
    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div>
        <b>Citation Context (Scite-lite)</b> — for a paper you choose, fetch its citing works from OpenAlex and classify each citing paper's <i>abstract</i> as supporting / contrasting / mentioning, with the exact sentence and cue shown. <b>This is an approximation:</b> Scite-class tools read the full citing article; we read only the citing abstract, and verdicts are transparent keyword cues — always check the actual paper before citing this anywhere.
      </div></div>

      <div class="card">
        <label class="small muted">Pick a paper (${eligible.length} of ${(State.papers||[]).length} in your library have a DOI / OpenAlex ID)</label>
        ${eligible.length ? `
          <select class="input" id="ccPaper" style="width:100%">
            ${eligible.map(p => `<option value="${esc(p.id)}">${esc((p.title||"untitled").slice(0,90))} (${p.year||"—"})</option>`).join("")}
          </select>
          <div class="flex gap-sm wrap mt">
            <label class="small muted" style="align-self:center">Max citing papers:</label>
            <select id="ccMax" class="input" style="max-width:90px"><option>25</option><option selected>50</option><option>100</option></select>
            <button class="btn btn-primary" id="ccRun">🔗 Fetch &amp; classify citing papers</button>
          </div>
          <div class="small muted mt" id="ccStatus"></div>
        ` : `
          <div class="empty" style="padding:18px">No eligible papers. Collect papers with a DOI via <b>Literature Search</b> (OpenAlex or Semantic Scholar sources), then come back.</div>
        `}
      </div>

      <div id="ccOut"></div>
    `;
    if(eligible.length) $("#ccRun", c).addEventListener("click", run);
    if(lastRun) drawResults(c);
  }

  async function run(){
    const c = $("#content");
    const sel = $("#ccPaper", c);
    const paper = (State.papers||[]).find(p => p.id === sel.value);
    if(!paper){ toast("Pick a paper first.","error"); return; }
    const max = parseInt($("#ccMax", c).value, 10);
    const status = $("#ccStatus", c);
    const btn = $("#ccRun", c);
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Fetching…`;
    status.textContent = "Resolving OpenAlex ID + fetching citing works (1 API call)…";
    try{
      const citing = await RW.CiteContext.fetchCitingWorks(paper, max);
      status.textContent = `Fetched ${citing.length} citing works — classifying…`;
      const { results, stats } = RW.CiteContext.classifyCitations(paper, citing);
      lastRun = { targetId: paper.id, targetTitle: paper.title, stats, results, targetYear: paper.year };
      drawResults(c);
      status.textContent = `Done: ${citing.length} citing papers classified.`;
    }catch(e){
      $("#ccOut", c).innerHTML = `<div class="notice notice-danger"><span class="ic">⚠️</span><div>${esc(e.message)}</div></div>`;
      status.textContent = "";
    }finally{
      btn.disabled = false; btn.innerHTML = "🔗 Fetch &amp; classify citing papers";
    }
  }

  function drawResults(c){
    const out = $("#ccOut", c);
    if(!lastRun){ out.innerHTML = ""; return; }
    const { stats, targetTitle, targetYear } = lastRun;
    const order = { contrasting:0, supporting:1, mentioning:2 };
    const sorted = [...lastRun.results].sort((a,b)=>order[a.verdict]-order[b.verdict]);

    out.innerHTML = `
      <div class="card">
        <div class="small muted">Citation context for</div>
        <strong>${esc(targetTitle||"")} ${targetYear ? "("+targetYear+")" : ""}</strong>
        <div class="flex gap-sm wrap mt">
          <span class="badge badge-success">✅ ${stats.supporting} supporting</span>
          <span class="badge badge-danger">⛔ ${stats.contrasting} contrasting</span>
          <span class="badge badge-muted">💬 ${stats.mentioning} mentioning</span>
          <span class="badge badge-muted">of ${stats.total} citing papers analyzed</span>
        </div>
        <div class="small muted mt"><b>Reminder:</b> abstract-level, keyword-cue based. A citing paper may support the target in the body text even if its abstract is neutral — "mentioning" is the safe default, not a negative finding.</div>
      </div>
      ${sorted.map(r => `
        <div class="card" style="padding:10px">
          <div class="flex gap-sm wrap mb-sm" style="align-items:center">
            <span class="badge ${V_META[r.verdict].badge}">${V_META[r.verdict].icon} ${r.verdict}</span>
            <strong class="small" style="flex:1;min-width:200px">${esc(r.title)}</strong>
            <span class="small muted">${r.year||""}</span>
            ${r.url ? `<a class="small" href="${esc(r.url)}" target="_blank" rel="noopener">↗</a>` : ""}
          </div>
          ${r.matched.length ? r.matched.map(m => `
            <div class="small mb-sm" style="background:var(--surface-2);border-left:3px solid ${m.kind==="contrast"?"var(--danger)":"var(--success)"};padding:8px;border-radius:4px">"${esc(m.sentence.length>240 ? m.sentence.slice(0,239)+"…" : m.sentence)}" <span class="muted">— cue: ${esc(m.cue)}</span></div>
          `).join("") : `<div class="small muted">No directional cues in abstract — treated as a plain citation.</div>`}
        </div>
      `).join("")}
    `;
  }

  Object.assign(RW, { CiteContextUI: { render } });
})();
