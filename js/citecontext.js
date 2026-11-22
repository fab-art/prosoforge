/* ============================================================================
   Research Workstation — citecontext.js
   PHASE 2b of the feature roadmap: reverse-engineering of **Scite** (Smart
   Citations) — deliberately labeled "Scite-lite".

   Scite's mechanism: a model classifies each citation *instance* in full text
   as supporting / contrasting / mentioning, over ~1B citation statements.
   That needs their proprietary trained corpus — we cannot replicate full-text
   sentiment at scale, and we say so in the UI instead of pretending.

   Our approximation:
   - Pull a paper's citing works from OpenAlex (free, `filter=cites:`).
   - Classify each CITING PAPER's abstract against the target's title+abstract
     with transparent cue regexes:
       supporting   — "consistent with", "builds on", "replicates", "extends"…
       contrasting  — "in contrast", "failed to replicate", "at odds with"…
       mentioning   — cites the work without directional language.
   - Every verdict shows the matched sentence + the cue that fired.

   Honest limits (mirrored in UI): abstract-level, paper-level (not
   instance-level), and only for papers with a DOI / OpenAlex ID.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { sentencesOf, contentTokens } = RW;

  const SUPPORT_CUES_RE = /\b(consistent with|in line with|aligns? with|in agreement with|similar to (our|previous|prior|these|earlier)|confirm\w*|corroborat\w+|support\w* (our|the|these|this|previous|prior|earlier)|further support\w*|extend\w*|builds? (on|upon)|replicat\w+|validat\w+|echo\w*|underscor\w+|in accord\w*|converg\w+ (evidence|with))\b/i;

  const CONTRAST_CUES_RE = /\b(in contrast|contrary to|inconsistent with|conflict\w+|discrepan\w+|challenge\w*|contradict\w*|failed to replicate|fail\w* to (support|confirm|replicate)|not (support\w*|confirm\w*)|unlike (previous|earlier|prior|these)|question\w* the|at odds with|divergen\w+|differs? from|cast doubt)\b/i;

  /* OpenAlex fetch with polite-pool mailto + one retry on 429 (shared-IP rate limits). */
  async function oaFetch(url, tries=2){
    const sep = url.includes("?") ? "&" : "?";
    let lastErr = null;
    for(let i=0;i<tries;i++){
      const r = await fetch(url + sep + "mailto=research-workstation@example.org");
      if(r.ok) return r.json();
      if(r.status === 429){
        lastErr = new Error("OpenAlex rate limit hit (HTTP 429) — waiting 2s and retrying once…");
        if(i < tries-1) await new Promise(res => setTimeout(res, 2000));
        continue;
      }
      throw new Error("OpenAlex request failed (HTTP " + r.status + ").");
    }
    throw lastErr || new Error("OpenAlex request failed.");
  }

  /* Resolve the OpenAlex work ID (W…) for a library paper. */
  async function resolveOpenAlexId(paper){
    if(paper.id && String(paper.id).startsWith("oa-")){
      const w = String(paper.id).slice(3);
      if(/^W\d+/.test(w) || /^\d+/.test(w)) return "W" + String(w).replace(/^W/,"");
    }
    if(paper.doi){
      const j = await oaFetch(`https://api.openalex.org/works/doi:${encodeURIComponent(paper.doi)}?select=id`);
      return (j.id||"").split("/").pop() || null;
    }
    throw new Error("This paper has no DOI or OpenAlex ID. Collect it via OpenAlex/Semantic Scholar search, or add its DOI in the Citation Manager.");
  }

  /* Fetch citing works from OpenAlex. Returns array of paper-like objects. */
  async function fetchCitingWorks(paper, max=50){
    const oaId = await resolveOpenAlexId(paper);
    const perPage = Math.min(max, 200);
    const j = await oaFetch(`https://api.openalex.org/works?filter=cites:${oaId}&per-page=${perPage}&sort=cited_by_count:desc`);
    return (j.results||[]).map(w => ({
      id: (w.id||"").split("/").pop(),
      title: w.display_name || "untitled",
      year: w.publication_year || null,
      venue: (w.primary_location?.source?.display_name) || "",
      doi: w.doi ? w.doi.replace("https://doi.org/","") : "",
      url: w.doi || w.landing_page_url || (w.primary_location?.landing_page_url || ""),
      citedByCount: w.cited_by_count || 0,
      abstract: RW.Search.reconstructAbstract(w.abstract_inverted_index) || "",
    }));
  }

  /* Classify one citing paper's abstract against the target paper. */
  function classifyCitation(target, citing){
    const targetTokens = contentTokens((target.title||"") + " " + (target.abstract||"").slice(0, 900));
    const tgtSet = new Set(targetTokens);
    const sents = sentencesOf(citing.abstract || "");
    const matched = [];
    let supportHits = 0, contrastHits = 0;
    sents.forEach(s => {
      const sup = s.match(SUPPORT_CUES_RE);
      const con = s.match(CONTRAST_CUES_RE);
      // sentence must reference the target's topic (≥2 shared content tokens)
      const stoks = contentTokens(s);
      const shared = stoks.filter(t => tgtSet.has(t)).length;
      if(sup && shared >= 2){ supportHits++; matched.push({ sentence: s, cue: sup[0], kind: "support" }); }
      if(con && shared >= 2){ contrastHits++; matched.push({ sentence: s, cue: con[0], kind: "contrast" }); }
    });
    let verdict = "mentioning";
    if(contrastHits > 0 && contrastHits >= supportHits) verdict = "contrasting";
    else if(supportHits > 0) verdict = "supporting";
    // keep at most 2 matched sentences for display
    return {
      citingId: citing.id, title: citing.title, year: citing.year,
      venue: citing.venue, doi: citing.doi, url: citing.url,
      citedByCount: citing.citedByCount,
      verdict, matched: matched.slice(0, 2),
      supportHits, contrastHits,
      abstractLen: citing.abstract.length,
    };
  }

  function classifyCitations(target, citingPapers){
    const results = (citingPapers||[]).map(c => classifyCitation(target, c));
    const stats = {
      total: results.length,
      supporting: results.filter(r => r.verdict === "supporting").length,
      contrasting: results.filter(r => r.verdict === "contrasting").length,
      mentioning: results.filter(r => r.verdict === "mentioning").length,
    };
    return { results, stats };
  }

  /* Papers in the library that can be analyzed (need DOI or oa- id). */
  function eligiblePapers(){
    return (RW.State.papers||[]).filter(p => p.doi || String(p.id||"").startsWith("oa-"));
  }

  Object.assign(RW, {
    CiteContext: {
      fetchCitingWorks, classifyCitations, classifyCitation, resolveOpenAlexId, eligiblePapers, oaFetch,
      SUPPORT_CUES_RE, CONTRAST_CUES_RE,
    }
  });
})();
