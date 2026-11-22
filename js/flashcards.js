/* ============================================================================
   Research Workstation — flashcards.js
   PHASE 4b of the feature roadmap: reverse-engineering of **Scholarcy**
   (article → structured flashcards: summary, key claims, methods, limitations,
   glossary, reference extracts).

   Scholarcy's mechanism: NLP pipeline over the full PDF producing summary
   cards + reference extracts, paid and closed.

   Our version — deterministic first (works with NO model loaded):
   - Section splitting by header lines (Abstract / Methods / Results /
     Discussion / Limitations / References …), falling back to "body".
   - Card extractors per type, each carrying its **source sentences verbatim**
     (Scholarcy's known weakness is cells you can't trace — we always show
     where a card came from).
   - Abbreviation glossary via a strict "expansion (ABBR)" regex.
   - Optional WebLLM refinement: the model rewrites fronts/backs as JSON,
     tagged 🤖 AI-refined, appended (never overwriting heuristic cards).
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { sentencesOf, contentTokens, wordsOf } = RW;

  // Header words that start a section (title-case-ish short line, no period).
  const SECTION_NAMES = [
    "abstract","summary","keywords","introduction","background","related work",
    "literature review","objective","objectives","aim","aims","materials and methods",
    "method","methods","methodology","methods and materials","study design","results","findings",
    "results and discussion","discussion","limitations","strengths and limitations",
    "conclusion","conclusions","implications","applications","future work",
    "acknowledgments","acknowledgements","funding","conflicts of interest",
    "declarations","appendix","supplementary material","references","bibliography"
  ];

  const HEADER_RE = new RegExp(
    "^\\s*(?:\\d+\\.?\\s*)?(?:\\d+\\.\\d+\\s*)?(" +
    SECTION_NAMES.map(s=>s.replace(/ /g,"\\s+")).join("|") +
    ")\\s*:??\\s*$", "i");

  const FINDING_CUES = /\b(we (found|show|demonstrate|report|observe)|our (results|findings|analysis) (show|indicate|suggest|reveal)|results (show|indicate|suggest|demonstrate|reveal)|significant(ly)? (higher|lower|increase|decreas\w+|reduc\w+|improv\w+|effect|difference|association|correlation|relationship|positive|negative)|p\s*[<=>]\s*0?\.\d+|\b(\d+(\.\d+)?)\s*(%|percent)|strong(ly)? (associat\w+|correlat\w+|predict\w+)|conclude|demonstrat\w+|effect size|outperform\w*)/i;
  const AIM_CUES = /\b(this (study|paper|work) (examines|investigates|analy[sz]es|assesses|explores|aims)|the (aim|objective|purpose) of|we (investigate|examine|assess|aim|ask)|research question|we sought)/i;
  const LIMIT_CUES = /\b(limitation\w*|caveat\w*|however,|caution|future (research|studies|work|directions)|should be interpreted (with )?caution|cannot (generaliz|conclude|infer)|small sample|single[- ]site|cross[- ]sectional design|self[- ]reported|selection bias|confound\w*)/i;
  const METHOD_CUES = /\b(participants|respondents|sample of|cohort|survey(ed)?|questionnaire|randomi[sz]ed|randomly assigned|experimental|quasi[- ]experimental|interview\w*|observations?|dataset|regression|logistic|ANOVA|t[- ]test|chi[- ]square|meta[- ]analysis|systematic review|machine learning|model (was|were) (trained|fit|built)|cross[- ]validation|simulation)\b/i;

  /* Split a document into sections by header lines. Returns [{name, text}]. */
  function splitSections(text){
    const lines = String(text||"").split(/\r?\n|\f/);
    const sections = [];
    let cur = { name:"body", lines:[] };
    lines.forEach(line=>{
      const t = line.trim();
      // header: matches known section name, short, no sentence punctuation
      if(t.length < 70 && !/[.!?;,]$/.test(t) && HEADER_RE.test(t)){
        if(cur.lines.length || sections.length) sections.push(cur);
        cur = { name: t.replace(/\s+/g," ").replace(/:$/,"").toLowerCase(), lines: [] };
      } else {
        cur.lines.push(line);
      }
    });
    sections.push(cur);
    // merge consecutive same-name sections, drop empties
    const out = [];
    sections.forEach(s=>{
      const text2 = s.lines.join("\n").trim();
      if(!text2) return;
      const last = out[out.length-1];
      if(last && last.name === s.name) last.text += "\n" + text2;
      else out.push({ name: s.name, text: text2 });
    });
    return out.length ? out : [{ name:"body", text:String(text||"").trim() }];
  }

  function sectionOf(sections, names){
    for(const n of names){
      const s = sections.find(x=>x.name===n || x.name.startsWith(n));
      if(s && s.text) return s;
    }
    return null;
  }

  function bodyText(sections){
    const s = sectionOf(sections, ["abstract"]);
    if(s) return s.text;
    return sections.map(x=>x.text).join("\n\n");
  }

  /* Strict abbreviation extraction: "expansion (ABBR)" pairs. */
  function extractAbbreviations(text, max=12){
    const re = /([A-Z][A-Za-z][A-Za-z\s\-]{2,48}?)\s*\(([A-Z][A-Z0-9]{1,7}s?)\)/g;
    const found = new Map();
    let m;
    while((m = re.exec(String(text||"")))){
      const abbr = m[2].trim();
      const expansion = m[1].trim().replace(/\s+/g," ");
      if(abbr.length < 2) continue;
      if(!found.has(abbr)) found.set(abbr, expansion);
      if(found.size >= max) break;
    }
    return Array.from(found.entries()).map(([abbr, expansion])=>({ abbr, expansion }));
  }

  const ACADEMIC_NOISE = new Set(["study","results","result","method","methods","paper","analysis","data","based","using","however","among","between","during","across","also","both","each","than","thus","therefore","while","significant","significantly","model","models","figure","table","section","proposed","propose","show","shown","effects","effect","value","values","different","following","respectively","available","human","compared","compares","respect","rate","time","number","total","high","higher","low","lower","used","use","using","given","test","tests"]);

  function extractKeywords(text, n=6){
    const freq = new Map();
    contentTokens(text).forEach(t=>{
      if(ACADEMIC_NOISE.has(t)) return;
      freq.set(t, (freq.get(t)||0)+1);
    });
    return Array.from(freq.entries())
      .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))
      .slice(0, n).map(e=>e[0]);
  }

  /* Rank sentences by cue hits (+ numeric evidence bonus). */
  function topSentences(text, cueRe, max=3, boost=/\d/){
    return sentencesOf(text)
      .map(s=>({ s, hits: (s.match(new RegExp(cueRe.source,"gi"))||[]).length + (boost.test(s)?0.5:0) }))
      .filter(x=>x.hits>0)
      .sort((a,b)=>b.hits-a.hits || a.s.length-b.s.length)
      .slice(0, max)
      .map(x=>x.s);
  }

  function firstSentences(text, max=2){
    return sentencesOf(text).slice(0, max);
  }

  /* Build a flashcard deck from a paper or document. Deterministic. */
  function buildDeck(src){
    // src: { title, year, text, kind: "paper"|"document"|"paste", sourceLabel }
    const sections = splitSections(src.text||"");
    const abs = sectionOf(sections, ["abstract"]);
    const abstractText = abs ? abs.text : "";
    const cards = [];
    const add = (kind, front, back, section, source)=> cards.push({ kind, front, back, section, source, ai:false });

    // TL;DR
    const tldrSents = firstSentences(abstractText || bodyText(sections), 2);
    if(tldrSents.length) add("tldr","TL;DR — what is this about?", tldrSents.join(" "), abs?"abstract":"body", tldrSents);

    // Objective
    const aimZone = abstractText || sectionOf(sections,["introduction"])?.text || bodyText(sections);
    const aims = topSentences(aimZone, AIM_CUES, 1);
    if(aims.length) add("aim","Research objective", aims.join(" "), abs?"abstract":"intro", aims);

    // Methods
    const meth = sectionOf(sections, ["methods","methodology","materials and methods","method","methods and materials","study design","literature review","related work"]);
    const methSents = meth ? firstSentences(meth.text, 3) : topSentences(bodyText(sections), METHOD_CUES, 2);
    if(methSents.length){
      // sample sizes can appear in the abstract even when Methods exists — scan all
      const nAll = [...new Set(((src.text||"").match(/\bn\s*=\s*\d+\b/gi)||[]))];
      add("methods","Methods", methSents.join(" ") + (nAll.length? `\n\nSample size mentioned: ${nAll.join(", ")}`:""), meth?meth.name:"body", methSents);
    } else {
      add("methods","Methods","No method-like sentences found — the abstract may not describe the design.", "—", []);
    }

    // Key findings
    const findingZone = [sectionOf(sections,["results","findings","results and discussion","discussion","conclusion","conclusions"])?.text || "", bodyText(sections)].join("\n");
    const finds = topSentences(findingZone, FINDING_CUES, 3);
    if(finds.length) add("findings","Key findings", finds.map(s=>"• "+s).join("\n"), "results/conclusion", finds);
    else add("findings","Key findings","No explicit finding cues detected (e.g. \"results show\", \"significantly\", p-values). Verify manually.","—",[]);

    // Limitations
    const limZone = sectionOf(sections,["limitations","strengths and limitations","discussion","conclusion","conclusions"])?.text || bodyText(sections);
    const lims = topSentences(limZone, LIMIT_CUES, 2);
    if(lims.length) add("limitations","Limitations & caveats", lims.map(s=>"• "+s).join("\n"), "limitations/discussion", lims);

    // Keywords
    const kw = extractKeywords(((src.title||"")+" "+(abstractText||src.text||"")).slice(0, 3000), 6);
    if(kw.length) add("keywords","Keywords", kw.join(", "), "deterministic", []);

    // Abbreviation glossary
    const abbrs = extractAbbreviations(src.text||"", 12);
    if(abbrs.length) add("abbrev","Abbreviations", abbrs.map(a=>`${a.abbr} — ${a.expansion}`).join("\n"), "deterministic", []);

    // References (docs only — abstracts don't carry them)
    const refs = sectionOf(sections, ["references","bibliography"]);
    if(refs){
      const refLines = refs.text.split(/\n+/).map(l=>l.trim()).filter(l=>l.length>25);
      add("refs",`References (${refLines.length} indexed lines)`, refLines.slice(0,3).join("\n") + (refLines.length>3? "\n… (open the original PDF for the full list)":""), "references", refLines.slice(0,3));
    }

    return {
      id: RW.uid(),
      title: src.title || "Untitled",
      year: src.year || null,
      sourceKind: src.kind,
      sourceLabel: src.sourceLabel || "",
      cards,
      createdAt: Date.now(),
      aiRefined: false,
      abstractLevel: !abs && (src.kind==="paper"),
    };
  }

  /* ---- optional WebLLM refinement → extra AI cards (never overwrite) ---- */
  async function refineWithLLM(deck, text){
    const srcForModel = (text||"").slice(0, 4500);
    const sys = "You produce study flashcards. Return ONLY a JSON array, no prose, no markdown fences. Each item: {\"front\": \"short question or label\", \"back\": \"the answer, grounded ONLY in the given text\"}. 3-6 cards covering the most important claims, methods and limitations.";
    const question = `Text:\n${srcForModel}\n\nProduce the JSON array of flashcards now.`;
    const res = await RW.WebLLM.ask({ system: sys, question, maxTokens: 700, temperature: 0.3,
      fallbackFn: ()=>{ throw new Error("no-model"); } });
    return parseAICards(res.text);
  }

  function parseAICards(raw){
    if(!raw) throw new Error("Model returned nothing.");
    let t = String(raw).replace(/```(json)?/gi,"").trim();
    const start = t.indexOf("["), end = t.lastIndexOf("]");
    if(start<0 || end<0) throw new Error("No JSON array found in model output.");
    let arr;
    try{ arr = JSON.parse(t.slice(start, end+1)); }
    catch(e){ throw new Error("Model JSON was malformed — keep the deterministic cards."); }
    return arr
      .filter(c=>c && typeof c.front==="string" && typeof c.back==="string")
      .slice(0, 8)
      .map(c=>({ kind:"ai", front:c.front.slice(0,140), back:c.back.slice(0,600), section:"WebLLM", source:[], ai:true }));
  }

  /* ---- exports ---- */
  function deckToMarkdown(deck){
    const L = [];
    L.push(`# 🎴 Flashcards — ${deck.title}${deck.year? " ("+deck.year+")":""}`);
    L.push(``);
    L.push(`> Source kind: ${deck.sourceKind}${deck.sourceLabel? " — "+deck.sourceLabel:""} · generated ${new Date(deck.createdAt).toLocaleString()} · ${deck.abstractLevel? "ABSTRACT-LEVEL (no full text)": "full text"}${deck.aiRefined? " · AI-refined cards included (🤖)": ""}`);
    L.push(``);
    deck.cards.forEach(c=>{
      L.push(`## ${c.front}`);
      L.push(`${c.back}`);
      L.push(``);
      L.push(`*section: ${c.section}${c.ai? " · 🤖 AI-refined — verify before use":""}*`);
      L.push(``);
    });
    return L.join("\n");
  }

  function csvCell(s){ return '"' + String(s||"").replace(/"/g,'""') + '"'; }
  function deckToCSV(deck){
    const rows = [["front","back","section","origin","source"]];
    deck.cards.forEach(c=>{
      rows.push([c.front, c.back, c.section, c.ai?"AI-refined":"deterministic", c.source.join(" ")]);
    });
    return rows.map(r=>r.map(csvCell).join(",")).join("\n");
  }

  Object.assign(RW, {
    Flashcards: {
      buildDeck, splitSections, extractAbbreviations, extractKeywords,
      topSentences, refineWithLLM, parseAICards, deckToMarkdown, deckToCSV,
      SECTION_NAMES, HEADER_RE, FINDING_CUES, AIM_CUES, LIMIT_CUES, METHOD_CUES,
    }
  });
})();
