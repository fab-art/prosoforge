/* ============================================================================
   Research Workstation — matrix.js
   PHASE 1 of the feature roadmap: reverse-engineering of **Elicit**.

   Elicit's mechanism: systematic-review automation — screen papers against
   inclusion/exclusion criteria, extract methodology/outcomes/sample size into
   customizable comparison columns (one row per paper), export CSV/BibTeX.

   Our improved replacement — the **Evidence Matrix**:
   - Deterministic heuristic extractors pick each cell's text AND the source
     sentence it came from (works with no model, fully transparent).
   - Optional WebLLM refinement per cell, clearly flagged `ai`.
   - User edits are NEVER overwritten by AI.
   - Keyword screening with visible matched-keyword reasons (not a black box).
   - CSV export. Everything client-side.

   Differences from Elicit (stated in UI): extraction works on title+abstract
   unless a full-text PDF for the paper was uploaded; screening is keyword-
   heuristic with visible reasons, not an opaque classifier.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, sentencesOf, wordsOf, uid, saveState, STOPWORDS } = RW;

  /* ----------------------------------------------------------------------- *
   * Extraction columns — preset extractors.
   * Each extractor takes sentences (title+abstract split) + paper metadata
   * and returns { value, source } or null. Pure functions, deterministic.
   * ----------------------------------------------------------------------- */

  function pickBest(sents, scoreFn, max=2, maxLen=260){
    const scored = sents.map(s => ({s, n: scoreFn(s)})).filter(x => x.n > 0)
      .sort((a,b) => b.n - a.n).slice(0, max);
    if(!scored.length) return null;
    const vals = scored.map(x => x.s.trim());
    let value = vals.join(" ");
    if(value.length > maxLen) value = value.slice(0, maxLen - 1).trimEnd() + "…";
    return { value, source: vals[0] };
  }

  const DESIGN_RE = /\b(randomi[sz]ed|randomly assigned|controlled trial|\brct\b|double[- ]blind|placebo|cohort|case[- ]control|cross[- ]sectional|longitudinal|prospective|retrospective|systematic review|meta[- ]analysis|scoping review|narrative review|survey|questionnaire|semi[- ]structured interview|qualitative|mixed[- ]methods|grounded theory|ethnograph\w*|simulation|monte carlo|experimental|quasi[- ]experimental|observational|protocol study|benchmark|ablation study|case study|pilot study|feasibility study)\b/i;

  function extractDesign(sents, paper){
    const hit = pickBest(sents, s => (s.match(new RegExp(DESIGN_RE.source, "gi"))||[]).length);
    if(hit) return hit;
    if(/meta[- ]analysis|systematic review/i.test(paper.venue||"")) return { value:"Review (venue hint)", source:paper.venue };
    return null;
  }

  const POPULATION_RE = /\b(participants|patients|subjects|respondents|volunteers|adults|older adults|children|adolescents|infants|men|women|undergraduates?|students|teachers|physicians|nurses|mice|rats|cell lines|in vitro|in vivo|dataset|data set|corpus|tweets?|documents?|firms?|households?|countries)\b/i;
  const N_RE = /\b(n\s*=\s*\d+|\d[\d,]*\s+(participants|subjects|patients|users|respondents|adults|children|students|samples|papers|studies|articles|tweets|documents|households|firms))\b/i;

  function extractPopulation(sents, paper){
    const hit = pickBest(sents, s => {
      let n = 0;
      if(POPULATION_RE.test(s)) n += 1;
      if(N_RE.test(s)) n += 2;
      return n;
    });
    return hit;
  }

  function extractSample(sents, paper){
    // Prefer an explicit "n = 123" anywhere; else sentence with a number + sample noun.
    const joined = sents.join(" ");
    const m = joined.match(new RegExp(N_RE.source, "i"));
    if(m){
      const idx = joined.indexOf(m[0]);
      const sentence = sents.find(s => s.includes(m[0])) || joined.slice(Math.max(0, idx-80), idx+80);
      return { value: m[0].trim(), source: sentence.trim().slice(0, 200) };
    }
    const hit = pickBest(sents, s => /\b(sample|participants|respondents)\b/i.test(s) && /\d/.test(s) ? 2 : 0, 1);
    return hit;
  }

  const METHOD_RE = /\b(we (propose|introduce|present|develop|design|conduct\w*|use|apply|employ|train|fine[- ]?tune|evaluate|implement|construct|estimate|measure|simulate|model|interview\w*|analyz\w*|analys\w*|review\w*|collect\w*)|methodology|our (method|approach|framework|pipeline|algorithm|model|procedure)|deep learning|machine learning|regression\w*|classifier|neural network|transformer|\bllm\b|natural language processing|thematic analysis|content analysis|difference[- ]in[- ]differences|instrumental variable)\b/i;

  function extractMethod(sents, paper){
    return pickBest(sents, s => (s.match(new RegExp(METHOD_RE.source, "gi"))||[]).length, 2);
  }

  const FINDINGS_RE = /\b(we (found|find|show\w*|demonstrat\w*|report\w*|observ\w*|reveal\w*)|(results?|findings?|experiments?) (show\w*|indicat\w*|demonstrat\w*|suggest\w*|reveal\w*)|our (results|findings|experiments|analysis)|achiev\w*|outperform\w*|significant\w* (improvement|reduction|increase|gain|effect|association|correlation|difference)|improv\w+|reduc\w+|increas\w+|associated with|correlated with|no significant|not significant|surprisingly|in contrast to)\b/i;

  function extractFindings(sents, paper){
    return pickBest(sents, s => (s.match(new RegExp(FINDINGS_RE.source, "gi"))||[]).length, 2, 300);
  }

  const OUTCOME_RE = /\b(effect size|odds ratio|relative risk|hazard ratio|confidence interval|95% ci|p\s*[<=]\s*0?\.\d+|p\s*<\s*0?\.0\d+|\br\s*=\s*-?\d|\bd\s*=\s*\d|\bcohen'?s d\b|correlation coefficient|accuracy|precision|recall|f1|auc|bleu|rouge|yield|revenue|mortality|incidence|prevalence)\b/i;

  function extractOutcome(sents, paper){
    return pickBest(sents, s => (s.match(new RegExp(OUTCOME_RE.source, "gi"))||[]).length, 2);
  }

  const LIMIT_RE = /\b(limitation\w*|caveat|however|nevertheless|future (work|research|studies|directions)|remains? (unclear|uncertain|unexplored)|small sample|single[- ]center|single[- ]site|self[- ]reported?|response bias|selection bias|confound\w*|generaliz\w+|cannot (generalize|conclude|rule out)|should be interpreted with caution|exploratory)\b/i;

  function extractLimitations(sents, paper){
    return pickBest(sents, s => (s.match(new RegExp(LIMIT_RE.source, "gi"))||[]).length, 2);
  }

  const EXTRACTORS = {
    design:   { label:"Study design",      fn: extractDesign,    hint:"RCT, cohort, review, survey…" },
    population:{ label:"Population / data", fn: extractPopulation, hint:"Who/what was studied" },
    sample:   { label:"Sample size",       fn: extractSample,    hint:"n = …" },
    method:   { label:"Methodology",       fn: extractMethod,    hint:"How they did it" },
    findings: { label:"Key findings",      fn: extractFindings,  hint:"What they showed" },
    outcome:  { label:"Outcomes / effect", fn: extractOutcome,   hint:"Effect sizes, p-values, metrics" },
    limitations:{ label:"Limitations",     fn: extractLimitations, hint:"Stated caveats" },
  };

  /* ----------------------------------------------------------------------- *
   * Screening — keyword heuristics with visible reasons.
   * criteria: { include:"free text", exclude:"free text" }
   * ----------------------------------------------------------------------- */
  function criteriaKeywords(text){
    return ((text||"").toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || [])
      .filter(w => !STOPWORDS.has(w));
  }

  function screenPaper(paper, criteria){
    const text = ((paper.title||"") + " " + (paper.abstract||"")).toLowerCase();
    const inc = criteriaKeywords(criteria.include);
    const exc = criteriaKeywords(criteria.exclude);
    const incHits = inc.filter(k => text.includes(k));
    const excHits = exc.filter(k => text.includes(k));
    let verdict, reason;
    if(excHits.length){
      verdict = "exclude";
      reason = "matched exclude terms: " + excHits.join(", ");
    } else if(inc.length && incHits.length >= Math.max(1, Math.ceil(inc.length * 0.5))){
      verdict = "include";
      reason = "matched " + incHits.length + "/" + inc.length + " include terms: " + incHits.join(", ");
    } else if(incHits.length){
      verdict = "maybe";
      reason = "partial include match: " + incHits.join(", ");
    } else {
      verdict = "maybe";
      reason = "no criteria terms matched — review manually";
    }
    return { verdict, reason, incHits, excHits };
  }

  /* ----------------------------------------------------------------------- *
   * Matrix creation
   * ----------------------------------------------------------------------- */
  function paperSentences(paper){
    return sentencesOf(((paper.title||"") + ". " + (paper.abstract||"")).trim());
  }

  function createMatrix({ name, papers, columnKinds, customColumns, criteria }){
    const columns = columnKinds.map(k => ({ id:k, label:EXTRACTORS[k].label, kind:"preset" }));
    (customColumns||[]).forEach(cc => columns.push({ id: uid(), label:cc, kind:"custom" }));
    const criteriaObj = { include: criteria?.include || "", exclude: criteria?.exclude || "" };
    const matrix = {
      id: uid(), name: name || "Untitled matrix", createdAt: Date.now(),
      paperIds: papers.map(p => p.id), columns, criteria: criteriaObj,
      rows: {}, screening: {},
    };
    papers.forEach(p => {
      const sents = paperSentences(p);
      const row = {};
      columns.forEach(c => {
        if(c.kind === "preset"){
          const r = EXTRACTORS[c.id].fn(sents, p);
          row[c.id] = r ? { value:r.value, source:r.source, edited:false, ai:false }
                        : { value:"", source:"", edited:false, ai:false, empty:true };
        } else {
          row[c.id] = { value:"", source:"", edited:false, ai:false, custom:true };
        }
      });
      matrix.rows[p.id] = row;
      if(criteriaObj.include || criteriaObj.exclude){
        matrix.screening[p.id] = screenPaper(p, criteriaObj);
      }
    });
    return matrix;
  }

  /* ----------------------------------------------------------------------- *
   * Optional WebLLM refinement — one cell at a time, plain text out.
   * Never overwrites user-edited cells (guarded by caller).
   * ----------------------------------------------------------------------- */
  async function refineCellWithAI(matrix, paper, column, opts){
    if(!RW.WebLLM || !RW.WebLLM.isReady()) return null;
    const sents = paperSentences(paper);
    const context = sents.join("\n").slice(0, 4000);
    const res = await RW.WebLLM.ask({
      system: "You extract structured data from a single scientific paper's abstract. Answer with ONE short factual phrase (max 25 words) directly from the text. If the text does not contain the information, reply exactly: NOT FOUND. No preamble.",
      context,
      question: `Extract "${column.label}" from this paper. ${opts?.hint ? "Hint: " + opts.hint : ""}`,
      maxTokens: 80, temperature: 0.1,
      fallbackFn: () => "",
    });
    if(res.source !== "webllm") return null;
    let text = (res.text||"").trim().replace(/^["']|["']$/g, "");
    if(!text || /not found|does not/i.test(text)) return null;
    return { value: text.slice(0, 200), ai: true };
  }

  /* ----------------------------------------------------------------------- *
   * Persistence
   * ----------------------------------------------------------------------- */
  function saveMatrix(m){
    if(!State.matrices) State.matrices = [];
    const i = State.matrices.findIndex(x => x.id === m.id);
    if(i >= 0) State.matrices[i] = m; else State.matrices.push(m);
    saveState();
  }
  function deleteMatrix(id){
    State.matrices = (State.matrices||[]).filter(m => m.id !== id);
    saveState();
  }

  /* ----------------------------------------------------------------------- *
   * CSV export
   * ----------------------------------------------------------------------- */
  function csvEscape(v){
    const s = String(v==null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(matrix, papersById){
    const header = ["Paper", "Year", ...matrix.columns.map(c => c.label)];
    if(matrix.screening && Object.keys(matrix.screening).length) header.push("Screening", "Screening note");
    const lines = [header.map(csvEscape).join(",")];
    matrix.paperIds.forEach(pid => {
      const p = papersById[pid] || {};
      const row = matrix.rows[pid] || {};
      const cells = [p.title || "(deleted paper)", p.year || ""];
      matrix.columns.forEach(c => cells.push(row[c.id]?.value || ""));
      if(matrix.screening && matrix.screening[pid]){
        cells.push(matrix.screening[pid].verdict, matrix.screening[pid].reason);
      }
      lines.push(cells.map(csvEscape).join(","));
    });
    return lines.join("\n");
  }

  /* ----------------------------------------------------------------------- *
   * Public helpers for the UI
   * ----------------------------------------------------------------------- */
  function usablePapers(){
    // papers with some abstract text to extract from
    return (State.papers||[]).filter(p => (p.abstract||"").length > 40 || (p.title||"").length > 0);
  }
  function papersByIdMap(){
    const map = {};
    (State.papers||[]).forEach(p => map[p.id] = p);
    return map;
  }
  function matrixStats(matrix){
    let total=0, filled=0, ai=0, edited=0;
    matrix.paperIds.forEach(pid => {
      const row = matrix.rows[pid]||{};
      matrix.columns.forEach(c => {
        total++;
        const cell = row[c.id];
        if(cell && cell.value){ filled++; if(cell.ai) ai++; if(cell.edited) edited++; }
      });
    });
    return { total, filled, ai, edited };
  }

  Object.assign(RW, {
    Matrix: {
      EXTRACTORS, createMatrix, screenPaper, refineCellWithAI,
      saveMatrix, deleteMatrix, toCSV, usablePapers, papersByIdMap, matrixStats,
      criteriaKeywords,
    }
  });
})();
