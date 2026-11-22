/* ============================================================================
   Research Workstation — gap.js
   Research Gap Finder: heuristic pattern-matching over collected papers'
   abstracts + uploaded document text. Flags recency, geographic context,
   self-reported limitation language, abstract coverage, source diversity.
   Clearly labeled ADVISORY — not analytical judgment.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, esc, sentencesOf, SOURCE_LABELS } = RW;

  const LIMITATION_PATTERNS = [
    /\bwe\s+(did not|could not|cannot)\b/i, /\bfuture research\b/i, /\bfuture work\b/i,
    /\blimitation[s]?\b/i, /\blimitation of (this|our|the) study\b/i, /\bfurther research\b/i,
    /\bmore research (is )?needed\b/i, /\bremains? (unclear|unknown|to be)\b/i,
    /\bour study (is )?limited\b/i, /\bunder-studied\b/i, /\bnot yet (been )?investigated\b/i,
    /\bsmall sample\b/i, /\bself[- ]reported\b/i, /\bsingle[- ]center\b/i, /\bcross[- ]sectional\b/i,
    /\bfurther investigation\b/i, /\bbeyond the scope\b/i, /\bwarrant(s)? further\b/i,
  ];
  const GEO_TERMS = /\b(USA|United States|UK|United Kingdom|Europe|Germany|France|China|Japan|India|Africa|Nigeria|Kenya|Brazil|Canada|Australia|Asia|Latin America|Middle East|low- and middle-income|LMIC|Global South|developing countries)\b/g;

  function computeGaps(papers){
    const total = papers.length;
    const docs = State.documents;
    const years = papers.map(p=>p.year).filter(y=>y);
    const yearRange = years.length? [Math.min(...years), Math.max(...years)] : [null,null];
    const nowYear = new Date().getFullYear();
    const recentCount = papers.filter(p=>p.year && p.year>=nowYear-2).length;
    const withAbstract = papers.filter(p=>(p.abstract||"").length>30).length;
    const sources = new Set(papers.map(p=>p.source));
    const gaps = [];

    if(years.length && recentCount/Math.max(years.length,1)<0.2){
      gaps.push({sev:"med", title:"Recency gap", html:`Only <b>${recentCount}</b> of ${years.length} dated papers were published in the last 3 years. Your set may under-represent current state-of-the-art.`});
    }
    const geo = {};
    papers.forEach(p=>{
      const m = (p.abstract||"").match(GEO_TERMS) || [];
      m.forEach(g=>{ const k=g.toLowerCase(); geo[k]=(geo[k]||0)+1; });
    });
    const geoEntries = Object.entries(geo).sort((a,b)=>b[1]-a[1]);
    if(geoEntries.length){
      const topGeo = geoEntries.slice(0,3).map(([k,v])=>`${k} (${v})`).join(", ");
      gaps.push({sev:"low", title:"Geographic concentration", html:`Most abstracts that mention a region reference: <b>${topGeo}</b>. ${geoEntries.length} distinct regions appear. Consider whether findings generalize to contexts not represented.`});
    } else {
      gaps.push({sev:"med", title:"Geographic context unknown", html:`None of the abstracts mention specific regions. The literature may be context-agnostic, OR the context may simply not be reported — you cannot tell from abstracts alone.`});
    }
    const limitations = [];
    papers.forEach(p=>{
      const sents = sentencesOf(p.abstract||"");
      const matches = sents.filter(s=> LIMITATION_PATTERNS.some(re=>re.test(s)));
      if(matches.length) limitations.push({paperId:p.id, paperTitle:p.title, year:p.year, matches});
    });
    if(limitations.length){
      gaps.push({sev:"low", title:"Self-reported limitations", html:`<b>${limitations.length}</b> papers explicitly use limitation/future-research language. These are the most promising leads for a genuine research gap — but read the full papers, not just the matched sentences.`});
    }
    if(withAbstract < total*0.6){
      gaps.push({sev:"high", title:"Insufficient abstract coverage", html:`Only <b>${withAbstract}</b> of ${total} papers have a usable abstract. Gap detection and grounded drafting will be unreliable. Collect fuller records or upload the PDFs.`});
    }
    if(sources.size===1 && total>0){
      gaps.push({sev:"low", title:"Single-source set", html:`All papers came from one database (<b>${SOURCE_LABELS[papers[0].source]||papers[0].source}</b>). Other databases may index different venues, languages, or disciplines.`});
    }
    if(!total && docs.length){
      gaps.push({sev:"med", title:"No API papers, only uploads", html:`You have ${docs.length} uploaded document(s) but no papers from literature search. Cross-reference with the broader literature before drawing conclusions.`});
    }
    return { total, yearRange, recentCount, withAbstract, sourceCount: sources.size, recencyFlag: recentCount<2, gaps, limitations };
  }

  function render(){
    const c = $("#content");
    const papers = State.papers;
    if(!papers.length && !State.documents.length){
      c.innerHTML = `<div class="empty"><span class="ic">🔭</span><div>Collect some papers or upload a document first to detect research gaps.</div></div>`;
      return;
    }
    const report = computeGaps(papers);
    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">⚠️</span><div><b>Advisory only.</b> These are heuristic pattern matches over abstracts — not analytical judgments. Use them as starting points for your own review, not as findings.</div></div>
      <div class="card">
        <h3 style="margin-top:0">Coverage at a glance</h3>
        <table>
          <tr><th>Papers in library</th><td>${report.total}</td></tr>
          <tr><th>Uploaded documents</th><td>${State.documents.length}</td></tr>
          <tr><th>Year range</th><td>${report.yearRange[0]||"—"} – ${report.yearRange[1]||"—"}</td></tr>
          <tr><th>Papers in last 3 years</th><td>${report.recentCount} <span class="badge ${report.recencyFlag?'badge-warning':'badge-success'}">${report.recencyFlag?'⚠️ few recent':'✓ recent coverage'}</span></td></tr>
          <tr><th>With usable abstract</th><td>${report.withAbstract}</td></tr>
          <tr><th>Unique sources</th><td>${report.sourceCount}</td></tr>
        </table>
      </div>
      <div class="card">
        <h3 style="margin-top:0">🔍 Possible gaps flagged</h3>
        ${report.gaps.length? report.gaps.map(g=>`
          <div class="card" style="background:var(--surface-2)">
            <div class="flex gap-sm wrap mb-sm"><span class="badge ${g.sev==='high'?'badge-danger':g.sev==='med'?'badge-warning':'badge-muted'}">${g.sev.toUpperCase()}</span><strong>${esc(g.title)}</strong></div>
            <div>${g.html}</div>
          </div>
        `).join("") : '<div class="empty" style="padding:20px">No heuristic gaps flagged.</div>'}
      </div>
      <div class="card">
        <h3 style="margin-top:0">📄 Self-reported limitations extracted</h3>
        ${report.limitations.length? report.limitations.map(l=>`
          <div style="margin-bottom:10px;border-left:2px solid var(--border-strong);padding-left:10px">
            <div class="small muted">${esc(l.paperTitle)} (${l.year||"n.d."})</div>
            <div>${l.matches.map(m=>`…${esc(m)}…`).join(" &nbsp;|&nbsp; ")}</div>
          </div>
        `).join("") : '<div class="empty" style="padding:20px">No self-reported limitation language detected.</div>'}
      </div>
    `;
  }

  Object.assign(RW, { Gap: { render, computeGaps } });
})();
