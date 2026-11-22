/* ============================================================================
   Research Workstation — deepsearch.js
   PHASE 5d of the roadmap: reverse-engineering of **Undermind** (agentic,
   iterative deep search: decompose a hard question, run refined query rounds,
   reassess, report).

   Undermind's mechanism: multi-round agentic search with query refinement
   against a large corpus.

   Our version — the **Deep Search loop**:
   - Round 0: deterministic seed queries from the question (top terms).
   - Rounds 1..N: WebLLM looks at what was found and proposes 3 NEW queries
     aimed at gaps; without a model, deterministic gap-terms queries. Each
     query runs through our existing 6-API search (RW.Search.runSearch).
   - Every paper records WHICH queries found it (provenance) and in which
     round; papers are deduped by normalized title across rounds.
   - Coverage stats (deterministic): distinct sources, year spread, fraction
     of question terms covered by ≥1 result.

   Honest limits (mirrored in UI): results are LEADS, not exhaustive coverage;
   the loop is bounded by a small model's query imagination; ~3-5 API calls
   per round across 6 free APIs.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { contentTokens, sentencesOf } = RW;

  const PER_QUERY = 8;

  /* Round-0 seeds: the question itself + a distilled keyword query. */
  function seedQueries(question){
    const q = String(question||"").trim();
    const terms = Array.from(new Set(contentTokens(q))).slice(0, 5);
    const distilled = terms.join(" ");
    const seeds = [q];
    if(distinctNorm(distilled, q)) seeds.push(distilled);
    return seeds.filter(Boolean).slice(0,3);
  }

  function norm(s){ return RW.normalizeTitle ? RW.normalizeTitle(s) : String(s||"").toLowerCase(); }
  function distinctNorm(a, b){ return a.trim().toLowerCase() !== b.trim().toLowerCase(); }

  /* Run one list of queries; returns [{paper, foundBy:[q,...], round}] merged
     into an existing index (dedupe by normalized title). */
  async function runQueries(queries, index, round, sources){
    const results = [];
    for(const q of queries){
      const found = await RW.Search.runSearch(q, sources);
      results.push({ query: q, hits: found.length });
      found.forEach(p=>{
        const key = norm(p.title||"");
        if(!key) return;
        const existing = index.get(key);
        if(existing){
          if(!existing.foundBy.includes(q)) existing.foundBy.push(q);
        } else {
          index.set(key, { paper: p, foundBy: [q], round });
        }
      });
    }
    return results; // per-query hit counts for the round log
  }

  /* Deterministic coverage stats over the found papers. */
  function coverageStats(question, papers){
    const qTokens = new Set(contentTokens(question));
    const bySource = new Map();
    let yearMin = null, yearMax = null;
    const covered = new Set();
    papers.forEach(p=>{
      bySource.set(p.source, (bySource.get(p.source)||0)+1);
      const yr = parseInt(p.year,10);
      if(yr){ if(yearMin==null||yr<yearMin) yearMin=yr; if(yearMax==null||yr>yearMax) yearMax=yr; }
      const hay = new Set(contentTokens((p.title||"")+" "+(p.abstract||"")));
      qTokens.forEach(t=>{ if(hay.has(t)) covered.add(t); });
    });
    return {
      count: papers.length,
      sources: Array.from(bySource.entries()).map(([k,v])=>({ source:k, n:v })).sort((a,b)=>b.n-a.n),
      yearMin, yearMax,
      termCoverage: qTokens.size ? covered.size/qTokens.size : 0,
      coveredTerms: Array.from(covered),
      missingTerms: Array.from(qTokens).filter(t=>!covered.has(t)),
    };
  }

  /* Next-round queries. LLM when available; deterministic fallback targets
     the question terms that NO found paper covered yet. */
  function fallbackQueries(question, papers){
    const cov = coverageStats(question, papers);
    const missing = cov.missingTerms.slice(0,3);
    const terms = Array.from(new Set(contentTokens(question))).slice(0,4);
    const qs = [];
    if(missing.length>=1) qs.push(terms.concat(missing).join(" "));
    if(missing.length>=2) qs.push(`systematic review ${missing.join(" ")}`);
    qs.push(`${terms.join(" ")} limitations challenges`);
    return [...new Set(qs)].slice(0,3);
  }

  async function proposeQueries(question, papers){
    if(RW.WebLLM.isReady()){
      try{
        const sample = papers.slice(0, 10).map((p,i)=>`${i+1}. ${p.title}`).join("\n");
        const cov = coverageStats(question, papers);
        const sys = "You refine literature-search queries. Given a research question and the titles already found, propose 3 NEW, DIFFERENT search queries that probe UNCOVERED angles (methods, populations, contradictions, reviews). Return ONLY the 3 queries, one per line, no numbering, no quotes.";
        const question2 = `Research question: ${question}\n\nAlready found (${papers.length} papers):\n${sample}\n\nMissing question terms: ${cov.missingTerms.join(", ")||"(none)"}\n\n3 new queries:`;
        const res = await RW.WebLLM.ask({ system: sys, context:"", question: question2, maxTokens: 120, temperature: 0.7, fallbackFn: ()=>{ throw new Error("no-model"); } });
        const qs = String(res.text||"").split(/\n+/).map(s=>s.replace(/^[\d\-•.\s"]+|["\s]+$/g,"").trim()).filter(s=>s.length>8).slice(0,3);
        if(qs.length) return { queries: qs, by: "ai" };
      }catch(e){ /* fall through to deterministic */ }
    }
    return { queries: fallbackQueries(question, papers), by: "deterministic" };
  }

  /* Full loop. onProgress({round, phase, detail}) for UI status. */
  async function deepSearch(question, opts={}){
    const rounds = Math.max(1, Math.min(opts.rounds||2, 4));
    const sources = opts.sources || State.settings.sources;
    const index = new Map();
    const roundLog = [];

    // round 0: seeds
    const seeds = seedQueries(question);
    onProgress(opts, { round:0, phase:"run", detail:`seeds: ${seeds.join(" | ")}` });
    const r0 = await runQueries(seeds, index, 0, sources);
    roundLog.push({ round:0, by:"seed", queries:seeds, hits:r0 });

    for(let r=1; r<=rounds; r++){
      const papers = Array.from(index.values()).map(v=>v.paper);
      onProgress(opts, { round:r, phase:"propose", detail:`${papers.length} papers so far` });
      const { queries, by } = await proposeQueries(question, papers);
      onProgress(opts, { round:r, phase:"run", detail:`${by}: ${queries.join(" | ")}` });
      const hits = await runQueries(queries, index, r, sources);
      roundLog.push({ round:r, by, queries, hits });
    }

    const papers = Array.from(index.values());
    return {
      question,
      papers: papers.sort((a,b)=>((b.paper.year||0)-(a.paper.year||0)) || (b.foundBy.length-a.foundBy.length)),
      roundLog,
      coverage: coverageStats(question, papers.map(v=>v.paper)),
      finishedAt: Date.now(),
    };
  }

  function onProgress(opts, evt){ if(opts.onProgress) opts.onProgress(evt); }

  /* Markdown report: which queries found which papers. */
  function reportMd(result){
    const L = [`# Deep Search report`, ``, `**Question:** ${result.question}`, ``,
      `**Coverage:** ${result.coverage.count} papers · ${result.coverage.sources.map(s=>`${s.source}(${s.n})`).join(", ")} · years ${result.coverage.yearMin||"—"}–${result.coverage.yearMax||"—"} · term coverage ${(result.coverage.termCoverage*100).toFixed(0)}%${result.coverage.missingTerms.length? ` (missing: ${result.coverage.missingTerms.join(", ")})`:""}`, ``];
    L.push(`**Query rounds:**`);
    result.roundLog.forEach(r=>{
      L.push(`- Round ${r.round} (${r.by}): ${r.queries.map(q=>`"${q}" → ${r.hits.find(h=>h.query===q)?.hits ?? 0} hits`).join(", ")}`);
    });
    L.push(``, `**Leads (not exhaustive coverage):**`, ``);
    result.papers.forEach(v=>{
      L.push(`- [R${v.round}] ${v.paper.title}${v.paper.year? ` (${v.paper.year})`:""} ${v.paper.doi? `doi:${v.paper.doi}`:""} — found by: ${v.foundBy.map(q=>`"${q}"`).join(" & ")}`);
    });
    L.push(``, `> Generated client-side via 6 free academic APIs + optional WebLLM query refinement. These are leads for a full review, not a systematic search.`);
    return L.join("\n");
  }

  Object.assign(RW, {
    DeepSearch: {
      deepSearch, seedQueries, runQueries, coverageStats,
      fallbackQueries, proposeQueries, reportMd,
    }
  });
})();
