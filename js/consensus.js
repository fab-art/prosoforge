/* ============================================================================
   Research Workstation — consensus.js
   PHASE 2a of the feature roadmap: reverse-engineering of **Consensus**.

   Consensus's mechanism: take a yes/no research question, search scholarly
   databases, classify each study's evidence relative to the question, show an
   agreement meter (yes / no / maybe) with direct quotes from abstracts.

   Our improved replacement — the **Agreement Meter**:
   - Reuses our multi-API search engine (user's enabled sources, free).
   - Verdict classifier: deterministic keyword-direction heuristics on
     title+abstract. EVERY verdict shows the sentence that drove it and the
     matched cues — no black box.
   - Direction-aware: "Does X reduce Y?" counts a significant reduction as
     support and a significant increase as contradiction; non-directional
     questions ("Is X associated with Y?") count any significant effect as
     support and explicit null results as contradiction.
   - Off-topic abstracts are gated out of the meter, listed separately.
   - Optional WebLLM re-check for inconclusive/mixed papers, tagged `ai`.

   Honest limits (mirrored in UI): verdicts are abstract-level keyword
   heuristics, not a substitute for reading the papers. The meter is a map of
   the literature you retrieved, not ground truth.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { sentencesOf, contentTokens, STOPWORDS } = RW;

  /* ---- question direction ---- */
  const Q_DECREASE_RE = /\b(reduce|reduces|reduced|lower|lowers|decrease|decreases|prevent|prevents|mitigate|mitigates|diminish|diminishes|alleviate|alleviates|attenuate|protect|protects|reverse|reverses|slow|slows)\b/i;
  const Q_INCREASE_RE = /\b(improve|improves|enhance|enhances|increase|increases|boost|boosts|raise|raises|promote|promotes|strengthen|strengthens|help|helps|benefit|benefits|accelerate|accelerates)\b/i;

  /* ---- evidence cues in abstracts ---- */
  const POS_EVIDENCE_RE = /\b(statistically significant|significant(ly)?\s+(improv\w+|reduc\w+|increas\w+|associat\w+|effect\w*|benefit\w*|differen\w+|positiv\w+|negativ\w+|gains?|declines?)|positive(ly)?\s+(effect\w*|association|correlation|relationship|impact\w*|result\w*)|efficacy|effective(ly)?|favorable|beneficial|superior(ity)?|outperform\w*|therapeutic (effect|benefit)|strong(ly)? (associat|correlat|predict)\w+|mediat\w+|moderat\w+)\b/i;

  const NEG_EVIDENCE_RE = /\b(no significant|not (statistically )?significant(ly)?|no (effect\w*|difference\w*|association\w*|correlation\w*|evidence|reduction|improvement|benefit\w*|advantage|clear (effect|benefit))|did not (reduce|improve|increase|differ|show|affect|significantly|yield|produce|result)|failed to (replicate|show|detect|find|demonstrate|observe)|ineffective|no benefit|unrelated to|not (associated|correlated|related) with|null (effect|result\w*|finding\w*))\b/i;

  /* ---- direction words inside abstracts ---- */
  const DECREASE_WORDS_RE = /\b(reduc\w*|lower\w*|decreas\w*|prevent\w*|protect\w*|mitigat\w*|alleviat\w*|attenuat\w*|fewer|improv\w*)\b/i;
  const INCREASE_WORDS_RE = /\b(increas\w*|higher|elevat\w*|boost\w*|promot\w*|worsen\w*|exacerbat\w*|adverse)\b/i;

  /* Null results about harms/safety ("no significant adverse effects") do NOT
     contradict an efficacy claim — they usually accompany one. */
  const HARM_NULL_RE = /\b(adverse|side[- ]effect\w*|safety|tolerabilit\w*|harms?|toxicit\w*|complication\w*)\b/i;

  function parseQuestion(q){
    const direction = Q_DECREASE_RE.test(q) ? "decrease" : Q_INCREASE_RE.test(q) ? "increase" : "any";
    return {
      text: q.trim(),
      direction,
      tokens: contentTokens(q),
      dirLabel: direction === "any" ? "any effect" : direction === "decrease" ? "a reduction" : "an increase",
    };
  }

  /* Relevance: how much of the question does the abstract actually talk about?
     Stem-tolerant: "reduce" matches "reduction/reduces/reducing". */
  function stem(t){
    const s = t.replace(/(ing|ed|ion|ions|es|s|e)$/, "");
    return s.length >= 4 ? s : t;
  }
  function relevance(question, paper){
    const text = ((paper.title||"") + " " + (paper.abstract||"")).toLowerCase();
    const hits = question.tokens.filter(t => text.includes(t) || text.includes(stem(t)));
    return { hits, score: question.tokens.length ? hits.length / question.tokens.length : 0 };
  }

  function isOnTopic(rel){
    // at least 2 question terms (or ≥40% of them) must appear
    return rel.hits.length >= 2 || rel.score >= 0.4;
  }

  /* Find the decisive sentence(s) in an abstract. */
  function evidenceSentences(abstract, direction){
    const sents = sentencesOf(abstract||"");
    const pos = [], neg = [], dirMatch = [], dirOppose = [];
    const dec = direction === "increase" ? DECREASE_WORDS_RE : DECREASE_WORDS_RE; // opposite of increase is decrease
    sents.forEach(s => {
      if(POS_EVIDENCE_RE.test(s)) pos.push(s);
      if(NEG_EVIDENCE_RE.test(s)) neg.push(s);
      if(DECREASE_WORDS_RE.test(s)) dirMatch.push(s);
      if(INCREASE_WORDS_RE.test(s)) dirOppose.push(s);
    });
    return { pos, neg, dirMatch, dirOppose };
  }

  function trimQuote(s, n=220){
    if(!s) return "";
    s = s.trim();
    return s.length > n ? s.slice(0, n-1).trimEnd() + "…" : s;
  }

  function classifyOne(question, paper){
    const rel = relevance(question, paper);
    const base = {
      paperId: paper.id, title: paper.title, year: paper.year,
      venue: paper.venue||"", url: paper.url||"", doi: paper.doi||"",
      relevance: rel, onTopic: isOnTopic(rel), verdict: "inconclusive",
      quote: "", cues: [], source: "heuristic",
    };
    if(!base.onTopic){
      base.verdict = "off_topic";
      base.quote = trimQuote((paper.abstract||paper.title||"").slice(0, 180));
      base.cues = rel.hits.slice(0, 5).map(h => "term:" + h);
      return base;
    }
    const ev = evidenceSentences(paper.abstract, question.direction);
    base.cues = [];
    if(ev.pos.length) base.cues.push("evidence of effect");
    if(ev.neg.length) base.cues.push("null result");
    if(ev.dirMatch.length) base.cues.push("direction-consistent wording");
    if(ev.dirOppose.length) base.cues.push("opposite-direction wording");

    const hasPos = ev.pos.length > 0, hasNeg = ev.neg.length > 0;
    const dirMatch = ev.dirMatch.length > 0, dirOppose = ev.dirOppose.length > 0;

    if(question.direction === "any"){
      // null results about harms/safety don't contradict an efficacy claim
      const negOnOutcome = ev.neg.filter(s => !HARM_NULL_RE.test(s));
      if(hasPos && negOnOutcome.length){ base.verdict = "mixed"; base.quote = trimQuote(ev.pos[0]) + "  vs.  " + trimQuote(negOnOutcome[0]); }
      else if(hasPos){ base.verdict = "supports"; base.quote = trimQuote(ev.pos[0]); }
      else if(negOnOutcome.length){ base.verdict = "contradicts"; base.quote = trimQuote(negOnOutcome[0]); }
      else if(hasNeg){ base.verdict = "supports"; base.quote = trimQuote(ev.pos[0] || (paper.abstract||"").slice(0,180)); }
      else { base.verdict = "inconclusive"; base.quote = trimQuote((paper.abstract||"").slice(0, 180)); }
    } else {
      const dirMatchRe = question.direction === "decrease" ? DECREASE_WORDS_RE : INCREASE_WORDS_RE;
      const dirOpposeRe = question.direction === "decrease" ? INCREASE_WORDS_RE : DECREASE_WORDS_RE;
      // null results about harms/safety don't contradict the outcome claim
      const negOnOutcome = ev.neg.filter(s => !HARM_NULL_RE.test(s));
      // decisive sentences: pos evidence whose direction wording agrees/opposes the question
      const supportSent = ev.pos.find(s => dirMatchRe.test(s) && !dirOpposeRe.test(s)) || null;
      const opposeSent  = ev.pos.find(s => dirOpposeRe.test(s) && !dirMatchRe.test(s)) || null;
      if(supportSent && opposeSent){
        base.verdict = "mixed"; base.quote = trimQuote(supportSent) + "  vs.  " + trimQuote(opposeSent);
      } else if(supportSent && negOnOutcome.length){
        // effect claimed AND an explicit null result on the outcome.
        // Same sentence ("reduced anxiety but no effect on stress") is itself mixed;
        // different sentences → show both.
        base.verdict = "mixed";
        base.quote = negOnOutcome[0] === supportSent ? trimQuote(supportSent) : trimQuote(supportSent) + "  vs.  " + trimQuote(negOnOutcome[0]);
      }
      else if(supportSent){ base.verdict = "supports"; base.quote = trimQuote(supportSent); }
      else if(opposeSent){ base.verdict = "contradicts"; base.quote = trimQuote(opposeSent); }
      else if(negOnOutcome.length){ base.verdict = "contradicts"; base.quote = trimQuote(negOnOutcome[0]); }
      else if(hasNeg){ base.verdict = "contradicts"; base.quote = trimQuote(ev.neg[0]); }
      else if(hasPos){ base.verdict = "supports"; base.quote = trimQuote(ev.pos[0]); }
      else { base.verdict = "inconclusive"; base.quote = trimQuote((paper.abstract||"").slice(0, 180)); }
    }
    return base;
  }

  function classify(questionText, papers){
    const q = parseQuestion(questionText);
    const verdicts = (papers||[]).map(p => classifyOne(q, p));
    const onTopic = verdicts.filter(v => v.verdict !== "off_topic");
    const stats = {
      total: verdicts.length,
      supports: verdicts.filter(v => v.verdict === "supports").length,
      contradicts: verdicts.filter(v => v.verdict === "contradicts").length,
      mixed: verdicts.filter(v => v.verdict === "mixed").length,
      inconclusive: verdicts.filter(v => v.verdict === "inconclusive").length,
      offTopic: verdicts.filter(v => v.verdict === "off_topic").length,
    };
    const decisive = stats.supports + stats.contradicts + stats.mixed;
    stats.decisive = decisive;
    stats.pctYes = decisive ? Math.round(stats.supports / decisive * 100) : 0;
    stats.pctNo  = decisive ? Math.round(stats.contradicts / decisive * 100) : 0;
    stats.pctMixed = decisive ? 100 - stats.pctYes - stats.pctNo : 0;
    return { question: q, verdicts, stats };
  }

  /* Optional WebLLM re-check for a single paper. Returns ai-tagged verdict or null. */
  async function reclassifyWithAI(questionText, paper){
    if(!RW.WebLLM || !RW.WebLLM.isReady()) return null;
    const res = await RW.WebLLM.ask({
      system: "You classify evidence from a scientific abstract relative to a yes/no research question. Reply with EXACTLY ONE WORD: SUPPORTS, CONTRADICTS, MIXED, INCONCLUSIVE, or OFFTOPIC. No explanation.",
      context: `Title: ${paper.title||""}\nAbstract: ${(paper.abstract||"").slice(0,2500)}`,
      question: `Research question: "${questionText}" — does this abstract's evidence support, contradict, or not address the question?`,
      maxTokens: 8, temperature: 0.0,
      fallbackFn: () => "",
    });
    if(res.source !== "webllm") return null;
    const w = (res.text||"").trim().toUpperCase();
    const m = w.match(/SUPPORTS?|CONTRADICTS?|MIXED|INCONCLUSIVE|OFFTOPIC/);
    if(!m) return null;
    const verdict = m[0] === "SUPPORT" ? "SUPPORTS" : m[0] === "CONTRADICT" ? "CONTRADICTS" : m[0];
    return { verdict: verdict.toLowerCase(), ai: true };
  }

  Object.assign(RW, {
    Consensus: {
      parseQuestion, classify, classifyOne, reclassifyWithAI, relevance,
      POS_EVIDENCE_RE, NEG_EVIDENCE_RE, DECREASE_WORDS_RE, INCREASE_WORDS_RE, HARM_NULL_RE,
    }
  });
})();
