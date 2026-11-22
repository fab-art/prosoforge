/* ============================================================================
   Research Workstation — integrity.js
   Integrity Review engine. THREE analyzers, all framed as self-check / advisory:

   1. Writing-pattern review
      Flags the same weak-writing patterns detectors key on (flat sentence-length
      variance, repetitive openers, generic hedges, formulaic transitions) — but
      presented as writing-quality issues with concrete revision suggestions.
      NOT a binary "is this AI" verdict (those are unreliable per peer-reviewed
      research). The highlight clears when the user revises.

   2. Plagiarism self-check (the four common forms)
      Checks the user's OWN draft against their OWN source library (uploaded
      PDFs, cited papers, scraped resources, and prior saved drafts):
        - Direct copying:        n-gram (word-shingle) match
        - Improper paraphrasing: token-set Jaccard similarity on sentence pairs
        - Uncredited media/AI:   user tags AI-generated spans; tool reminds to
                                  acknowledge in methods/acknowledgements
        - Self-plagiarism:       match against prior drafts archived in State
      Every match shows the source passage side-by-side and a suggested fix.

   3. Citation audit
      Validates every DOI/arXiv ID/URL found in the draft against the user's
      library and (optionally) HEAD-checks against CrossRef/arXiv. Flags
      hallucinated or unverified references before submission.

   Design rule: this module never rewrites text to evade detection, never strips
   metadata, and never promises "100% undetectable" output. It surfaces issues
   for the writer to fix. That is what responsible self-check tools do.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, sentencesOf, wordsOf, contentTokens, mean, stdev, normalizeTitle } = RW;

  /* ----------------------------------------------------------------------- *
   * 1. WRITING-PATTERN REVIEW
   * ----------------------------------------------------------------------- */

  const GENERIC_HEDGES = [
    "it is important to note", "it is worth noting", "it should be noted",
    "needless to say", "as one might expect", "generally speaking",
    "in general", "for the most part", "to a large extent", "to some extent",
    "plays a crucial role", "plays a pivotal role", "plays a key role",
    "plays a vital role", "in today's fast-paced world", "in the modern era",
    "in the digital age", "delve into", "delves into", "delving into",
    "tapestry of", "in the realm of", "navigate the complexities",
    "navigating the complexities", "shed light on", "sheds light on",
    "harness the power", "harnessing the power", "unlock the potential",
    "unlocking the potential", "at the forefront of", "pave the way",
    "paving the way", "paradigm shift", "cutting-edge", "state-of-the-art",
    "groundbreaking", "revolutionary", "game-changing", "seamless",
    "leverage", "synergy", "synergistic", "unprecedented", "multifaceted",
    "holistic approach", "robust framework",
  ];

  const REPETITIVE_TRANSITIONS = [
    "furthermore", "moreover", "additionally", "consequently",
    "subsequently", "nevertheless", "nonetheless", "accordingly",
    "thus", "hence", "therefore",
  ];

  // Sentence openers we count to detect repetition (first 1-3 tokens lowercased).
  function openerOf(sentence){
    const toks = (sentence.toLowerCase().match(/[a-z']+/g) || []).slice(0, 3);
    return toks.join(" ");
  }

  // Analyze a paragraph; returns flags with span info (start/end char offsets
  // within the paragraph) so the UI can highlight exact passages.
  function analyzeParagraph(para, paraIdx, allParas){
    const flags = [];
    if(!para || !para.trim()) return flags;
    const sents = sentencesOf(para);
    const lens = sents.map(s => wordsOf(s).length);
    const wordCount = wordsOf(para).length;

    // (a) Uniform sentence length — flat rhythm is weak writing AND a tell.
    if(sents.length >= 3){
      const sd = stdev(lens);
      const avg = mean(lens);
      // coefficient of variation — robust to absolute length
      const cv = avg > 0 ? sd / avg : 0;
      if(cv < 0.35 && lens.length >= 3){
        const start = para.indexOf(sents[0]);
        flags.push({
          type:"uniform_length", sev:"med",
          start, end: start + sents[sents.length-1].length,
          label:`Uniform sentence rhythm (σ/μ = ${cv.toFixed(2)})`,
          why:"All sentences are nearly the same length. Real expository prose varies length to signal emphasis and structure.",
          fix:"Break one long sentence into two short ones, or combine two short ones with a semicolon. Let at least one sentence run 25+ words.",
          detail:`Sentence lengths: ${lens.join(", ")} words.`,
        });
      }
      // (b) Highly variable length — not weak per se, but worth a check.
      else if(cv > 1.2){
        flags.push({
          type:"variable_length", sev:"low",
          start:0, end:para.length,
          label:`Highly variable sentence length (σ/μ = ${cv.toFixed(2)})`,
          why:"Large length swings can read as choppy. Usually fine, but check the short sentences aren't fragments.",
          fix:"Read aloud. If a short sentence lands as deliberate emphasis, keep it. If it's a fragment, expand it.",
          detail:`Sentence lengths: ${lens.join(", ")} words.`,
        });
      }
    }

    // (c) Repetitive openers — e.g. three sentences all starting with "Furthermore,"
    //     We track both the first-word opener (catches repeated transitions like
    //     "Furthermore, X. Furthermore, Y.") and the 3-token opener (catches
    //     identical first clauses). Either counts.
    if(sents.length >= 2){
      const openers3 = sents.map(openerOf);
      const openers1 = sents.map(s => {
        const t = (s.toLowerCase().match(/[a-z']+/g) || [])[0] || "";
        return t;
      });
      const openerCounts = {};
      openers3.forEach(o => { if(o) openerCounts[o] = (openerCounts[o]||0)+1; });
      openers1.forEach(o => { if(o) openerCounts["word:"+o] = (openerCounts["word:"+o]||0)+1; });
      const dup = Object.entries(openerCounts)
        .filter(([_,n])=>n>=2)
        .sort((a,b)=>b[1]-a[1]);
      dup.forEach(([opener, n]) => {
        const isWord = opener.startsWith("word:");
        const key = isWord ? opener.slice(5) : opener;
        // find first occurrence to anchor the highlight
        const idx = isWord
          ? sents.findIndex(s => openers1[sents.indexOf(s)] === key)
          : sents.findIndex(s => openerOf(s) === key);
        const start = idx >= 0 ? para.indexOf(sents[idx]) : 0;
        flags.push({
          type:"repetitive_opener", sev: n>=3 ? "high" : "med",
          start, end: start + sents[idx].length,
          label:`Opener "${isWord ? key : key.split(" ")[0]}" used ${n}× in this paragraph`,
          why:"Starting consecutive sentences with the same transition is formulaic and flattens voice.",
          fix:`Rewrite at least one to begin with the subject or a contrast. E.g. replace one "${isWord ? key : key.split(" ")[0].replace(/,$/, "")}" with "By contrast," or delete it and lead with the claim.`,
        });
      });
    }

    // (d) Generic hedges / cliché phrases — exact-phrase match
    const lower = para.toLowerCase();
    GENERIC_HEDGES.forEach(phrase => {
      let from = 0;
      let idx;
      while((idx = lower.indexOf(phrase, from)) !== -1){
        flags.push({
          type:"cliche", sev:"high",
          start: idx, end: idx + phrase.length,
          label:`Generic phrase: "${phrase}"`,
          why:"This is a stock phrase that adds no information. Detectors and reviewers both flag it.",
          fix:`Replace with a concrete statement. E.g. "plays a crucial role" → say exactly what it does. "It is important to note" → delete it and state the point directly.`,
        });
        from = idx + phrase.length;
      }
    });

    // (e) Low lexical diversity (type-token ratio) on long paragraphs
    if(wordCount >= 40){
      const toks = wordsOf(para);
      const unique = new Set(toks);
      const ttr = toks.length ? unique.size / toks.length : 1;
      if(ttr < 0.45){
        flags.push({
          type:"low_ttr", sev:"med",
          start:0, end:para.length,
          label:`Low lexical diversity (TTR ${ttr.toFixed(2)})`,
          why:"You reuse the same words heavily. This reads as thin and is correlated with formulaic writing.",
          fix:"Vary vocabulary where possible, or tighten the paragraph — sometimes repetition means the paragraph says less than its length suggests.",
          detail:`Unique words: ${unique.size} of ${toks.length}.`,
        });
      }
    }

    // (f) Absence of concrete specifics — no numbers, no proper nouns, no dates
    if(wordCount >= 30){
      const hasNumber = /\b\d+(\.\d+)?%?\b/.test(para);
      const hasProperNoun = /\b[A-Z][a-z]{2,}\b/.test(para.slice(1)); // skip sentence-initial
      const hasYear = /\b(19|20)\d{2}\b/.test(para);
      if(!hasNumber && !hasProperNoun && !hasYear){
        flags.push({
          type:"no_specifics", sev:"med",
          start:0, end:para.length,
          label:"No concrete specifics",
          why:"This paragraph has no numbers, dates, named entities, or examples. Abstract claims are weaker than grounded ones.",
          fix:"Add at least one concrete detail: a specific number, a named study, a date, or a quoted phrase from a source in your library.",
        });
      }
    }

    // (g) Run-on / overly long sentence
    if(lens.length){
      const longSents = sents.map((s,i)=>({s, i, n:lens[i]})).filter(x=>x.n > 45);
      longSents.forEach(({s,i,n}) => {
        const start = para.indexOf(s);
        flags.push({
          type:"long_sentence", sev:"med",
          start, end: start + s.length,
          label:`Long sentence (${n} words)`,
          why:"Sentences over ~40 words are hard to parse. Reviewers and readers lose the thread.",
          fix:"Split at a logical hinge (often a comma + 'which' or 'because'). Read it aloud — if you run out of breath, split it.",
        });
      });
    }

    return flags;
  }

  function analyzeWriting(text){
    const paras = (text||"").split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
    const paraResults = paras.map((p, i) => {
      const flags = analyzeParagraph(p, i, paras);
      // attach paragraph text + offset so the UI can place highlights globally
      return { idx:i, text:p, flags };
    });
    const allFlags = paraResults.flatMap(r => r.flags);
    const summary = {
      paragraphCount: paras.length,
      flagCount: allFlags.length,
      byType: groupBy(allFlags, f=>f.type),
      bySev: {
        high: allFlags.filter(f=>f.sev==="high").length,
        med:  allFlags.filter(f=>f.sev==="med").length,
        low:  allFlags.filter(f=>f.sev==="low").length,
      },
    };
    return { paras: paraResults, summary };
  }

  /* ----------------------------------------------------------------------- *
   * 2. PLAGIARISM SELF-CHECK
   * ----------------------------------------------------------------------- *
   * Compares the user's draft against their OWN source library:
   *   - State.documents (uploaded PDFs/text)
   *   - State.papers (collected abstracts)
   *   - State.resources (scraped web pages)
   *   - State.pastDrafts (archived previous drafts — for self-plagiarism)
   * No external services. All comparison is local.
   */

  // Build the corpus the self-check runs against.
  function buildCorpus(){
    const corpus = [];
    State.documents.forEach(d => {
      corpus.push({
        kind:"document", id:d.id, title:d.name || "uploaded document",
        text:d.text || "", authors:[], year:null, venue:"", url:""
      });
    });
    State.papers.forEach(p => {
      corpus.push({
        kind:"paper", id:p.id, title:p.title, text:p.abstract || "",
        authors:p.authors||[], year:p.year, venue:p.venue||"", url:p.url||"", doi:p.doi||""
      });
    });
    State.resources.forEach(r => {
      corpus.push({
        kind:"scrape", id:r.id, title:r.title || r.url, text:r.text || "",
        authors:[], year:null, venue:r.url||"", url:r.url||""
      });
    });
    (State.pastDrafts || []).forEach(d => {
      corpus.push({
        kind:"pastDraft", id:d.id, title:d.title || "previous draft",
        text:d.text || "", authors:["(you)"], year:null, venue:"your prior draft", url:""
      });
    });
    return corpus.filter(c => c.text && c.text.length > 30);
  }

  // Word n-gram shingles for direct-copy detection.
  function shingles(text, n=5){
    const toks = (text || "").toLowerCase().match(/[a-z0-9'-]+/g) || [];
    const out = [];
    for(let i=0; i+n<=toks.length; i++){
      out.push(toks.slice(i, i+n).join(" "));
    }
    return out;
  }

  // Sentence-level token-set Jaccard similarity (lightweight, no embeddings).
  function jaccard(aTokens, bTokens){
    if(!aTokens.length || !bTokens.length) return 0;
    const aSet = new Set(aTokens);
    const bSet = new Set(bTokens);
    let inter = 0;
    for(const t of aSet){ if(bSet.has(t)) inter++; }
    return inter / (aSet.size + bSet.size - inter);
  }

  // Find direct-copy matches: 5-gram shingles shared between a draft sentence
  // and any corpus source. Returns matches with the source + matched span.
  function findDirectCopyMatches(draftSents, corpus){
    const matches = [];
    const SHINGLE_N = 5;
    // Build a per-source shingle map
    const sourceShingles = corpus.map(src => ({
      src,
      shingles: new Set(shingles(src.text, SHINGLE_N)),
    }));
    draftSents.forEach((sent, sIdx) => {
      const sentShingles = shingles(sent, SHINGLE_N);
      if(sentShingles.length < 2) return;
      sourceShingles.forEach(({src, shingles: srcSet}) => {
        const overlap = sentShingles.filter(s => srcSet.has(s));
        if(overlap.length === 0) return;
        // Require at least 1 shared 5-gram to count as a direct-copy hit.
        // Compute the matched substring from the first shared shingle.
        const firstShingle = overlap[0];
        const matchIdx = sent.toLowerCase().indexOf(firstShingle.split(" ").slice(0,2).join(" "));
        matches.push({
          form: "direct_copy",
          sev: overlap.length >= 3 ? "high" : "med",
          draftSentenceIdx: sIdx,
          draftSentence: sent,
          draftMatchStart: Math.max(0, matchIdx),
          draftMatchEnd: Math.min(sent.length, matchIdx + firstShingle.length + 20),
          sourceId: src.id,
          sourceKind: src.kind,
          sourceTitle: src.title,
          sourceAuthors: src.authors,
          sourceYear: src.year,
          sourceVenue: src.venue,
          sourceUrl: src.url,
          sourceDoi: src.doi,
          matchedShingles: overlap.length,
          totalShingles: sentShingles.length,
          overlapRatio: overlap.length / sentShingles.length,
          fix: src.kind === "pastDraft"
            ? "You are reusing text from a previous draft. Cite your prior work (self-citation) or rewrite in fresh words."
            : "Quote the matched text directly (with quotation marks) and cite the source. If you paraphrase instead, rewrite more substantially and still cite.",
        });
      });
    });
    return matches;
  }

  // Find improper-paraphrase matches: sentence pairs with high token-set
  // similarity but no shared 5-gram (so it's a paraphrase, not a copy).
  function findParaphraseMatches(draftSents, corpus){
    const matches = [];
    const SIM_THRESHOLD = 0.55; // Jaccard on content tokens
    draftSents.forEach((sent, sIdx) => {
      const sentTokens = contentTokens(sent);
      if(sentTokens.length < 6) return;
      corpus.forEach(src => {
        // split source into sentences, compare each
        const srcSents = sentencesOf(src.text);
        srcSents.forEach(ss => {
          const ssTokens = contentTokens(ss);
          if(ssTokens.length < 6) return;
          // quick filter: must share at least 4 content tokens
          const sentSet = new Set(sentTokens);
          const shared = ssTokens.filter(t => sentSet.has(t)).length;
          if(shared < 4) return;
          const sim = jaccard(sentTokens, ssTokens);
          if(sim >= SIM_THRESHOLD){
            // exclude if this is actually a direct copy (already caught above)
            const sentShingles = new Set(shingles(sent, 5));
            const srcShingles = new Set(shingles(ss, 5));
            let directOverlap = 0;
            for(const s of sentShingles){ if(srcShingles.has(s)) directOverlap++; }
            if(directOverlap > 0) return; // leave to direct-copy detector
            matches.push({
              form: "improper_paraphrase",
              sev: sim >= 0.75 ? "high" : "med",
              draftSentenceIdx: sIdx,
              draftSentence: sent,
              draftMatchStart: 0,
              draftMatchEnd: sent.length,
              sourceId: src.id,
              sourceKind: src.kind,
              sourceTitle: src.title,
              sourceAuthors: src.authors,
              sourceYear: src.year,
              sourceVenue: src.venue,
              sourceUrl: src.url,
              sourceDoi: src.doi,
              sourceSentence: ss,
              similarity: sim,
              sharedTokens: shared,
              fix: src.kind === "pastDraft"
                ? "This is close to your prior wording. Rewrite substantially AND cite your previous work."
                : "This paraphrase is too close to the source. Either (a) quote directly with citation, or (b) rewrite using your own sentence structure and vocabulary, then cite.",
            });
          }
        });
      });
    });
    return matches;
  }

  // Uncredited media / AI output: user-tagged spans in the draft.
  // The draft text uses a marker convention: [AI-GENERATED]...[/AI-GENERATED]
  // and [AI-IMAGE: description] / [AI-DATA: description].
  // We surface these as reminders to acknowledge in methods/acknowledgements.
  const AI_BLOCK_RE = /\[AI-GENERATED\]([\s\S]*?)\[\/AI-GENERATED\]/g;
  const AI_MEDIA_RE = /\[(AI-IMAGE|AI-DATA|AI-TABLE|AI-CODE):([^\]]+)\]/g;

  function findUncreditedAI(text){
    const matches = [];
    let m;
    AI_BLOCK_RE.lastIndex = 0;
    while((m = AI_BLOCK_RE.exec(text)) !== null){
      matches.push({
        form: "uncredited_ai",
        sev: "med",
        start: m.index,
        end: m.index + m[0].length,
        kind: "AI-generated text",
        excerpt: m[1].trim().slice(0, 120),
        fix: "Acknowledge AI assistance in your methods or acknowledgements section, per your institution's policy. Most journals require disclosure of generative-AI use for any substantive content.",
      });
    }
    AI_MEDIA_RE.lastIndex = 0;
    while((m = AI_MEDIA_RE.exec(text)) !== null){
      matches.push({
        form: "uncredited_ai",
        sev: "high",
        start: m.index,
        end: m.index + m[0].length,
        kind: m[1].replace("AI-", "").toLowerCase(),
        excerpt: m[2].trim().slice(0, 120),
        fix: `You tagged this as AI-generated ${m[1].replace("AI-","").toLowerCase()}. Acknowledge it explicitly in the figure/table caption and in the methods section, and verify you have the rights to use it.`,
      });
    }
    return matches;
  }

  // Self-plagiarism: reuse of prior drafts. Same shingle approach but scoped to
  // pastDraft sources; reported under its own form for clarity.
  function findSelfPlagiarism(draftSents, corpus){
    const pastDrafts = corpus.filter(c => c.kind === "pastDraft");
    if(!pastDrafts.length) return [];
    const matches = findDirectCopyMatches(draftSents, pastDrafts);
    return matches.map(m => ({...m, form: "self_plagiarism"}))
      .concat(findParaphraseMatches(draftSents, pastDrafts).map(m => ({...m, form:"self_plagiarism"})));
  }

  function analyzePlagiarism(text){
    const draftSents = sentencesOf(text);
    const corpus = buildCorpus();
    if(!corpus.length){
      return { matches: [], note: "No sources in your library to compare against. Upload PDFs, collect papers, or scrape sources first, then re-run." };
    }
    const direct = findDirectCopyMatches(draftSents, corpus)
      .filter(m => m.sourceKind !== "pastDraft");
    const paraphrase = findParaphraseMatches(draftSents, corpus)
      .filter(m => m.sourceKind !== "pastDraft");
    const self = findSelfPlagiarism(draftSents, corpus);
    const uncredited = findUncreditedAI(text);
    const matches = [...direct, ...paraphrase, ...self, ...uncredited];
    const summary = {
      total: matches.length,
      byForm: groupBy(matches, m => m.form),
    };
    return { matches, summary, corpusSize: corpus.length };
  }

  /* ----------------------------------------------------------------------- *
   * 3. CITATION AUDIT
   * ----------------------------------------------------------------------- *
   * Scans the draft for citation markers and DOIs/URLs, then checks each
   * against the user's library. Optionally HEAD-checks DOIs against CrossRef
   * (network call — only when the user opts in).
   */

  const DOI_RE = /\b10\.\d{4,9}\/[^\s)"',]+/g;
  const ARXIV_RE = /\b(arXiv:)?(\d{4}\.\d{4,5}(v\d+)?)\b/g;
  const URL_RE = /https?:\/\/[^\s)"']+/g;
  const INLINE_CITE_RE = /\(([^()]*?\d{4}[a-z]?)\)/g; // APA/MLA-ish (Author, year)

  function extractCitations(text){
    const found = [];
    let m;
    DOI_RE.lastIndex = 0;
    while((m = DOI_RE.exec(text)) !== null){
      found.push({ type:"doi", value:m[0].replace(/[.,;]$/,""), start:m.index, end:m.index+m[0].length });
    }
    ARXIV_RE.lastIndex = 0;
    while((m = ARXIV_RE.exec(text)) !== null){
      const v = m[2];
      found.push({ type:"arxiv", value:v, start:m.index, end:m.index+m[0].length });
    }
    URL_RE.lastIndex = 0;
    while((m = URL_RE.exec(text)) !== null){
      found.push({ type:"url", value:m[0].replace(/[.,;)]$/,""), start:m.index, end:m.index+m[0].length });
    }
    INLINE_CITE_RE.lastIndex = 0;
    while((m = INLINE_CITE_RE.exec(text)) !== null){
      found.push({ type:"inline", value:m[1].trim(), start:m.index, end:m.index+m[0].length });
    }
    return found;
  }

  // Match an extracted citation against the user's library.
  function matchCitationToLibrary(cit){
    const lib = [...State.papers, ...State.citations];
    if(cit.type === "doi"){
      const hit = lib.find(p => (p.doi||"").toLowerCase() === cit.value.toLowerCase());
      return hit ? { status:"in_library", ref:hit } : { status:"not_in_library" };
    }
    if(cit.type === "arxiv"){
      const hit = lib.find(p => (p.url||"").includes(cit.value) || (p.id||"").includes(cit.value));
      return hit ? { status:"in_library", ref:hit } : { status:"not_in_library" };
    }
    if(cit.type === "url"){
      const hit = lib.find(p => (p.url||"").toLowerCase() === cit.value.toLowerCase());
      return hit ? { status:"in_library", ref:hit } : { status:"not_in_library" };
    }
    if(cit.type === "inline"){
      // try to match author + year against library
      const yearMatch = cit.value.match(/\b(1[89]\d{2}|20\d{2})\b/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;
      const nameHints = cit.value.toLowerCase().split(/[,&]|\bet al\.?/)[0].trim().split(/\s+/);
      const hit = lib.find(p => {
        const authorsLower = (p.authors||[]).join(" ").toLowerCase();
        return nameHints.some(h => h.length > 2 && authorsLower.includes(h));
      });
      return hit ? { status:"in_library", ref:hit } : { status:"unresolved", hint:{year} };
    }
    return { status:"unknown" };
  }

  // Optional: HEAD-check a DOI against CrossRef. Returns {verified:boolean, error?}.
  // Network call — only invoked when the user clicks "Verify online".
  async function verifyDoiOnline(doi){
    try{
      const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { method:"GET" });
      if(res.ok) return { verified:true };
      if(res.status === 404) return { verified:false, reason:"CrossRef has no record of this DOI." };
      return { verified:false, reason:`CrossRef returned HTTP ${res.status}.` };
    }catch(e){
      return { verified:false, reason:"Network error: "+e.message };
    }
  }

  function analyzeCitations(text){
    const cits = extractCitations(text);
    const results = cits.map(c => ({ ...c, ...matchCitationToLibrary(c) }));
    const summary = {
      total: results.length,
      inLibrary: results.filter(r=>r.status==="in_library").length,
      notInLibrary: results.filter(r=>r.status==="not_in_library").length,
      unresolved: results.filter(r=>r.status==="unresolved").length,
    };
    return { citations: results, summary };
  }

  /* ----------------------------------------------------------------------- *
   * Drafts archive (for self-plagiarism across writing sessions)
   * ----------------------------------------------------------------------- */
  function archiveCurrentDraft(title){
    if(!State.draft || !State.draft.trim()) return null;
    if(!State.pastDrafts) State.pastDrafts = [];
    const entry = {
      id: "draft-"+Date.now().toString(36),
      title: title || "Untitled draft",
      text: State.draft,
      archivedAt: Date.now(),
    };
    State.pastDrafts.push(entry);
    // keep at most 20 archived drafts
    if(State.pastDrafts.length > 20) State.pastDrafts = State.pastDrafts.slice(-20);
    RW.saveState();
    return entry;
  }
  function listPastDrafts(){ return State.pastDrafts || []; }
  function removePastDraft(id){
    if(!State.pastDrafts) return;
    State.pastDrafts = State.pastDrafts.filter(d => d.id !== id);
    RW.saveState();
  }

  /* ----------------------------------------------------------------------- *
   * Helpers
   * ----------------------------------------------------------------------- */
  function groupBy(arr, keyFn){
    const out = {};
    arr.forEach(x => { const k = keyFn(x); out[k] = (out[k]||0)+1; });
    return out;
  }

  // Run all three analyzers and return a combined report.
  function analyzeAll(text){
    return {
      writing: analyzeWriting(text),
      plagiarism: analyzePlagiarism(text),
      citations: analyzeCitations(text),
      generatedAt: Date.now(),
    };
  }

  Object.assign(RW, {
    Integrity: {
      analyzeWriting, analyzeParagraph, analyzePlagiarism, analyzeCitations, analyzeAll,
      extractCitations, matchCitationToLibrary, verifyDoiOnline,
      archiveCurrentDraft, listPastDrafts, removePastDraft,
      buildCorpus, shingles, jaccard,
      GENERIC_HEDGES, REPETITIVE_TRANSITIONS,
    }
  });
})();
