/* ============================================================================
   Research Workstation — checks.js
   Checks Summary: rollup of Thesis Workspace style flags across the whole
   draft. Descriptive only — not a quality verdict.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, esc, mean } = RW;

  function render(){
    const c = $("#content");
    if(!State.draft || !State.draft.trim()){
      c.innerHTML = `<div class="empty"><span class="ic">✅</span><div>Nothing to check yet. Add a draft in the Thesis Workspace.</div><button class="btn btn-primary mt" onclick="RW.navigate('workspace')">Go to Workspace</button></div>`;
      return;
    }
    const paras = State.draft.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
    const checks = paras.map(p=> RW.Workspace.checkParagraph(p));
    const total = checks.length;
    const flagged = checks.filter(c=>c.flags.length).length;
    const allFlags = checks.flatMap((c,i)=> c.flags.map(f=>({...f, para:i+1})));
    const byType = {};
    allFlags.forEach(f=>{ byType[f.label] = (byType[f.label]||0)+1; });
    const avgLen = mean(checks.map(c=>c.stdevLen));
    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div><b>Advisory rollup.</b> Aggregated style signals across your whole draft. Numbers are descriptive — high flag counts suggest reviewing your style, not a verdict on quality.</div></div>
      <div class="row">
        <div class="card"><div class="small muted">Paragraphs</div><div style="font-size:28px;font-weight:700">${total}</div></div>
        <div class="card"><div class="small muted">Flagged</div><div style="font-size:28px;font-weight:700;color:var(--warning)">${flagged}</div></div>
        <div class="card"><div class="small muted">Clean</div><div style="font-size:28px;font-weight:700;color:var(--success)">${total-flagged}</div></div>
        <div class="card"><div class="small muted">Avg σ-len</div><div style="font-size:28px;font-weight:700">${avgLen.toFixed(1)}</div></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Flag breakdown</h3>
        ${Object.keys(byType).length? `<table><tr><th>Flag</th><th>Count</th></tr>${Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td><b>${v}</b></td></tr>`).join("")}</table>` : `<span class="badge badge-success">✓ No flags across ${total} paragraphs</span>`}
      </div>
      <div class="card">
        <h3 style="margin-top:0">Per-paragraph status</h3>
        <table><tr><th>#</th><th>Words</th><th>Sentences</th><th>σ-len</th><th>Flags</th></tr>
        ${checks.map((c,i)=>`<tr><td>${i+1}</td><td>${c.wordCount}</td><td>${c.sentenceCount}</td><td>${c.stdevLen.toFixed(1)}</td><td>${c.flags.length? c.flags.map(f=>`<span class="badge ${f.sev==='high'?'badge-danger':f.sev==='med'?'badge-warning':'badge-muted'}" style="margin:1px">${esc(f.label)}</span>`).join("") : `<span class="badge badge-success">✓</span>`}</td></tr>`).join("")}
        </table>
      </div>
      <button class="btn btn-primary" onclick="RW.navigate('workspace')">Edit draft</button>
    `;
  }

  Object.assign(RW, { Checks: { render } });
})();
