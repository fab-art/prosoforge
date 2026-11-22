/* ============================================================================
   Research Workstation — paperpal.js
   PHASE 5c of the roadmap: reverse-engineering of **Paperpal** (academic
   language editing, consistency/terminology checks, submission readiness).

   Paperpal's mechanism: cloud language engine over the manuscript.

   Our version — **deterministic consistency checks** (no model needed):
   1. Abbreviation consistency — one ABBR defined with two expansions, used
      before its definition, or case-variant spellings (GAD vs gad).
   2. Unit spacing — "5 ms" vs "5ms" mixed; "50 %" vs "50%" mixed.
   3. UK/US spelling families — "colour" and "color" in the same document.
   4. Hyphenation variants — "dataset" vs "data set", "e-mail" vs "email"…
   5. Bare "eg"/"ie" vs "e.g."/"i.e." styles mixed.
   6. Lowercased section headers ("introduction" alone on a line).
   + `autofix(text, {dialect})` applies only the mechanical fixes (majority
     style wins; dialect picks UK/US spelling). Optional WebLLM grammar pass
     lives in paperpal-ui.js with per-suggestion accept/reject.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};

  const UNITS = "ms|s|min|hrs?|kg|g|mg|µg|ug|mL|ml|L|km|cm|mm|nm|Hz|kHz|MHz|°C|kcal|kcal/mol";

  const SPELLING_PAIRS = [
    ["colour","color"],["colours","colors"],["coloured","colored"],["colourful","colorful"],
    ["behaviour","behavior"],["behaviours","behaviors"],["behavioural","behavioral"],
    ["favour","favor"],["favoured","favored"],["favourable","favorable"],
    ["honour","honor"],["honoured","honored"],["labour","labor"],
    ["neighbour","neighbor"],["neighbourhood","neighborhood"],["humour","humor"],
    ["centre","center"],["centres","centers"],["metre","meter"],["metres","meters"],
    ["theatre","theater"],["fibre","fiber"],["litre","liter"],["litres","liters"],
    ["defence","defense"],["offence","offense"],["licence","license"],
    ["practise","practice"],["grey","gray"],
    ["organise","organize"],["organised","organized"],["organising","organizing"],
    ["organisation","organization"],["organisations","organizations"],
    ["recognise","recognize"],["recognised","recognized"],
    ["analyse","analyze"],["analysed","analyzed"],["analysing","analyzing"],
    ["optimise","optimize"],["minimise","minimize"],["maximise","maximize"],
    ["prioritise","prioritize"],["summarise","summarize"],["summarised","summarized"],
    ["travelling","traveling"],["modelled","modeled"],["cancelled","canceled"],
    ["programme","program"],
  ];

  const HYPHEN_PAIRS = [
    ["e-mail","email"],["data set","dataset"],["data-sets","datasets"],["data sets","datasets"],
    ["web site","website"],["web-site","website"],["e-learning","elearning"],
    ["on-line","online"],["co-author","coauthor"],["co-authors","coauthors"],
    ["re-write","rewrite"],["co-operate","cooperate"],
  ];

  /* ---- 1) abbreviations ---- */
  function checkAbbrevConsistency(text){
    const t = String(text||"");
    const findings = [];
    const defined = new Map(); // abbr → [expansions]
    const pairRe = /([A-Z][A-Za-z][A-Za-z\s\-]{2,48}?)\s*\(([A-Z][A-Z0-9]{1,8}s?)\)/g;
    let m;
    while((m = pairRe.exec(t))){
      const abbr = m[2], exp = m[1].trim().replace(/\s+/g," ");
      if(!defined.has(abbr)) defined.set(abbr, []);
      defined.get(abbr).push(exp);
    }
    defined.forEach((exps, abbr)=>{
      const uniq = [...new Set(exps.map(e=>e.toLowerCase()))];
      if(uniq.length>1){
        findings.push({ rule:"abbrev", message:`"${abbr}" is defined with ${uniq.length} different expansions ("${exps[0]}" vs "${exps[1]}"). Pick one and use it everywhere.`, snippet:`${abbr}`, suggestion:"unify expansion" });
      }
    });
    // used before first definition / case variants
    defined.forEach((_, abbr)=>{
      const firstDef = t.indexOf(abbr+")")>=0 ? pairPos(t, abbr) : -1;
      const useRe = new RegExp("\\b"+abbr.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","g");
      let firstUse = -1, mm;
      while((mm = useRe.exec(t))){ firstUse = mm.index; break; }
      if(firstDef>0 && firstUse>=0 && firstUse < firstDef-1){
        findings.push({ rule:"abbrev", message:`"${abbr}" is used before it is defined. Define abbreviations at first use.`, snippet: t.slice(Math.max(0,firstUse-30), firstUse+abbr.length+10).replace(/\s+/g," "), suggestion:"define at first use" });
      }
      const lowerRe = new RegExp("\\b"+abbr.toLowerCase()+"\\b");
      if(lowerRe.test(t)){
        findings.push({ rule:"abbrev", message:`Case variant "${abbr.toLowerCase()}" appears alongside "${abbr}". Keep the casing consistent.`, snippet:abbr.toLowerCase(), suggestion:"unify casing" });
      }
    });
    return findings;
  }
  function pairPos(t, abbr){
    const re = new RegExp("\\(" + abbr.replace(/[.*+?^${}()|[\]\\]/g,"\\$&") + "\\)");
    const m = re.exec(t);
    return m ? m.index : -1;
  }

  /* ---- 2) unit spacing ---- */
  function checkUnitSpacing(text){
    const t = String(text||"");
    const findings = [];
    const spaced = new Map(), tight = new Map();
    const re = new RegExp("(\\d[\\d.,]*)\\s?(" + UNITS + ")\\b","g");
    let m;
    while((m = re.exec(t))){
      const hasSpace = /\s/.test(m[1].slice(-1)) || /\s/.test((m[0].match(/[\d.,]+\s*/)||[""])[0].slice(-1));
      const map = hasSpace ? spaced : tight;
      const u = m[2];
      map.set(u, (map.get(u)||0)+1);
    }
    const all = new Set([...spaced.keys(), ...tight.keys()]);
    all.forEach(u=>{
      const a = spaced.get(u)||0, b = tight.get(u)||0;
      if(a>0 && b>0){
        findings.push({ rule:"units", message:`Mixed spacing for unit "${u}": ${a}× "N ${u}" vs ${b}× "N${u}". Journals want one style.`, snippet:`${u}`, suggestion:"normalize spacing" });
      }
    });
    // percent sign
    const pctSpaced = (t.match(/\d\s%/g)||[]).length;
    const pctTight = (t.match(/\d%(?!\d)/g)||[]).length;
    if(pctSpaced && pctTight){
      findings.push({ rule:"units", message:`Mixed percent style: ${pctSpaced}× "50 %" vs ${pctTight}× "50%". Pick one.`, snippet:"%", suggestion:"normalize percent" });
    }
    return findings;
  }

  /* ---- 3) UK/US spelling ---- */
  function checkSpellingMix(text){
    const t = String(text||"").toLowerCase();
    const findings = [];
    const ukHits = new Map(), usHits = new Map();
    SPELLING_PAIRS.forEach(([uk, us])=>{
      const ukN = (t.match(new RegExp("\\b"+uk+"\\b","g"))||[]).length;
      const usN = (t.match(new RegExp("\\b"+us+"\\b","g"))||[]).length;
      if(ukN) ukHits.set(uk, ukN);
      if(usN) usHits.set(us, usN);
    });
    SPELLING_PAIRS.forEach(([uk, us])=>{
      if(ukHits.has(uk) && usHits.has(us)){
        findings.push({ rule:"spelling", message:`UK/US spelling mix: "${uk}" and "${us}" both appear. Choose one dialect (UK or US) for the whole manuscript.`, snippet:`${uk} / ${us}`, suggestion:"pick dialect" });
      }
    });
    return findings;
  }

  /* ---- 4) hyphenation variants ---- */
  function checkHyphenation(text){
    const t = String(text||"").toLowerCase();
    const findings = [];
    HYPHEN_PAIRS.forEach(([a, b])=>{
      const reA = new RegExp("\\b"+a.replace(/[-]/g,"[- ]?")+"\\b","g");
      const nA = (t.match(reA)||[]).length;
      const nB = (t.match(new RegExp("\\b"+b+"\\b","g"))||[]).length;
      if(nA && nB){
        findings.push({ rule:"hyphen", message:`Hyphenation variant: "${a}" (${nA}×) and "${b}" (${nB}×) both appear. Use one form.`, snippet:`${a} / ${b}`, suggestion:"normalize" });
      }
    });
    return findings;
  }

  /* ---- 5) eg / ie style ---- */
  function checkEGIE(text){
    const t = String(text||"");
    const findings = [];
    const bareEg = (t.match(/\beg[.,\s]/g)||[]).length;
    const bareIe = (t.match(/\bie[.,\s]/g)||[]).length;
    const dottedEg = (t.match(/\be\.g\./g)||[]).length;
    const dottedIe = (t.match(/\bi\.e\./g)||[]).length;
    if(bareEg || bareIe){
      findings.push({ rule:"egie", message:`Bare "eg${bareIe?'/ie':''}" form(s) found (${bareEg} eg, ${bareIe} ie) — formal writing uses "e.g." / "i.e.".`, snippet:"eg/ie", suggestion:"add periods" });
    }
    if(dottedEg && /\beg[.,\s]/.test(t)){
      findings.push({ rule:"egie", message:`Mixed "e.g." and "eg" styles.`, snippet:"e.g. vs eg", suggestion:"normalize" });
    }
    if(dottedIe && /\bie[.,\s]/.test(t)){
      findings.push({ rule:"egie", message:`Mixed "i.e." and "ie" styles.`, snippet:"i.e. vs ie", suggestion:"normalize" });
    }
    return findings;
  }

  /* ---- 6) lowercase section headers ---- */
  function checkSectionCase(text){
    const names = (RW.Flashcards && RW.Flashcards.SECTION_NAMES) ||
      ["abstract","introduction","background","methods","results","discussion","conclusion","limitations","references"];
    const findings = [];
    String(text||"").split(/\r?\n/).forEach(line=>{
      const t = line.trim();
      if(t.length>=2 && t.length<70 && !/[.!?;,]$/.test(t) && names.includes(t.toLowerCase()) && t[0] === t.toLowerCase()[0] && /[a-z]/.test(t[0])){
        findings.push({ rule:"heading", message:`Section header "${t}" is lowercased — capitalize ("${t[0].toUpperCase()+t.slice(1)}").`, snippet:t, suggestion:"capitalize" });
      }
    });
    return findings;
  }

  function runAllChecks(text){
    return {
      abbrev: checkAbbrevConsistency(text),
      units: checkUnitSpacing(text),
      spelling: checkSpellingMix(text),
      hyphen: checkHyphenation(text),
      egie: checkEGIE(text),
      heading: checkSectionCase(text),
    };
  }

  /* ---- mechanical autofix (majority style / chosen dialect) ---- */
  function autofix(text, opts={}){
    const dialect = opts.dialect || "us";
    const out = String(text||"");
    const changes = [];

    // eg / ie
    let fixed = out.replace(/\beg(?=[.,\s)])/g,"e.g.").replace(/\bie(?=[.,\s)])/g,"i.e.");
    if(fixed!==out) changes.push({ rule:"egie", n: countDiff(out, fixed) });

    // unit spacing → majority style per unit
    fixed = fixUnitSpacing(fixed, changes);

    // hyphenation → majority variant
    fixed = fixHyphenation(fixed, changes);

    // spelling → chosen dialect
    if(opts.fixSpelling){
      let after = fixed;
      SPELLING_PAIRS.forEach(([uk, us])=>{
        const [from, to] = dialect==="us" ? [uk, us] : [us, uk];
        after = after.replace(new RegExp("\\b"+from+"\\b","g"), to);
      });
      if(after!==fixed){ changes.push({ rule:"spelling", n: countDiff(fixed, after), note:"dialect: "+dialect }); fixed = after; }
    }

    // lowercase section headers → capitalized
    const names = (RW.Flashcards && RW.Flashcards.SECTION_NAMES)||[];
    if(names.length){
      fixed = fixed.split(/\r?\n/).map(line=>{
        const t = line.trim();
        if(names.includes(t.toLowerCase()) && t && t[0]===t.toLowerCase()[0]){
          return line.replace(t, t[0].toUpperCase()+t.slice(1));
        }
        return line;
      }).join("\n");
    }
    return { text: fixed, changes };
  }

  function countDiff(a, b){
    // rough count of changed positions (word-level diff approximation)
    const aw = a.split(/\s+/), bw = b.split(/\s+/);
    let n = 0;
    for(let i=0;i<Math.max(aw.length, bw.length);i++) if(aw[i]!==bw[i]) n++;
    return n;
  }

  function fixUnitSpacing(text, changes){
    const re = new RegExp("(\\d[\\d.,]*)\\s?(" + UNITS + ")\\b","g");
    const votes = { space:0, tight:0 };
    let m; const reCount = new RegExp(re.source,"g");
    while((m = reCount.exec(text))){
      if(/\s/.test(m[0].slice(m[1].length, m[1].length+1))) votes.space++; else votes.tight++;
    }
    if(votes.space && votes.tight){
      const target = votes.space >= votes.tight ? "space" : "tight";
      const after = text.replace(re, (full, num, unit)=>{
        const spaced = /\s/.test(full.slice(num.length, num.length+1));
        if(target==="space" && !spaced) return num + " " + unit;
        if(target==="tight" && spaced) return num + unit;
        return full;
      });
      changes.push({ rule:"units", n: countDiff(text, after), note:`→ "${target==="space"?"N unit":"Nunit"}" (majority)` });
      return after;
    }
    return text;
  }

  function fixHyphenation(text, changes){
    let after = text;
    const applied = [];
    HYPHEN_PAIRS.forEach(([a, b])=>{
      const reA = new RegExp("\\b"+a.replace(/-/g,"[- ]?")+"\\b","gi");
      const nA = (after.match(reA)||[]).length;
      const nB = (after.match(new RegExp("\\b"+b+"\\b","gi"))||[]).length;
      if(nA && nB){
        // majority wins: keep whichever is more frequent
        const [from, to] = nA >= nB ? [a, b] : [b, a];
        const fromRe = new RegExp("\\b"+from.replace(/[-]/g,"[- ]?")+"\\b","g");
        after = after.replace(fromRe, to);
        applied.push(`${from}→${to}`);
      }
    });
    if(applied.length) changes.push({ rule:"hyphen", note: applied.join(", ") });
    return after;
  }

  Object.assign(RW, {
    Paperpal: {
      runAllChecks, checkAbbrevConsistency, checkUnitSpacing, checkSpellingMix,
      checkHyphenation, checkEGIE, checkSectionCase, autofix,
      SPELLING_PAIRS, HYPHEN_PAIRS,
    }
  });
})();
