/* ============================================================================
   Research Workstation — cleaner.js
   Document Cleaner: hygiene fixes (whitespace, smart quotes, double spaces,
   spacing before punctuation) + an advisory "AI-tells" panel that flags common
   AI phrasing patterns. It does NOT strip identifying metadata, NOT randomize
   text to evade detection, and NOT disguise AI authorship — that would
   violate the project's no-dark-patterns rule. It only does legitimate
   copy-editing and surfaces style signals for the writer to act on.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, downloadBlob } = RW;

  // Each rule: { id, label, desc, apply(str)->str, advisory? }
  // Hygiene rules transform text; advisory rules only report.
  const HYGIENE_RULES = [
    { id:"smartquotes", label:"Normalize quotes & dashes", desc:"Convert smart quotes/curly apostrophes and em/en dashes to plain ASCII.",
      apply: s => s
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\u2026/g, "...")
    },
    { id:"doublespace", label:"Collapse multiple spaces", desc:"Replace runs of 2+ spaces with a single space.",
      apply: s => s.replace(/  +/g, " ")
    },
    { id:"spacebefore", label:"Remove space before punctuation", desc:"Strip spaces before commas, periods, semicolons, colons.",
      apply: s => s.replace(/\s+([,.;:!?])/g, "$1")
    },
    { id:"spaceafter", label:"Ensure space after punctuation", desc:"Add a space after . , ; : ? ! if missing before a word.",
      apply: s => s.replace(/([,.;:!?])(?=[A-Za-z])/g, "$1 ")
    },
    { id:"trailingws", label:"Trim trailing whitespace per line", desc:"Remove trailing spaces/tabs on each line.",
      apply: s => s.split("\n").map(l=>l.replace(/[\t ]+$/,"")).join("\n")
    },
    { id:"blanklines", label:"Collapse 3+ blank lines", desc:"Reduce runs of 3+ blank lines to a single blank line.",
      apply: s => s.replace(/\n{3,}/g, "\n\n")
    },
    { id:"nbsp", label:"Replace non-breaking spaces", desc:"Convert U+00A0 and other Unicode spaces to regular spaces.",
      apply: s => s.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    },
    { id:"tabs", label:"Convert tabs to spaces", desc:"Replace tab characters with a single space.",
      apply: s => s.replace(/\t/g, " ")
    },
    { id:"zerowidth", label:"Strip zero-width / BOM chars", desc:"Remove U+200B U+200C U+200D U+FEFF and similar invisible chars.",
      apply: s => s.replace(/[\u200B\u200C\u200D\uFEFF\u2060]/g, "")
    },
  ];

  // Advisory-only: detect common AI-tell phrasing (does NOT auto-edit).
  const AI_TELL_PATTERNS = [
    { re:/\bdelve(s)? into\b/gi, label:"'delve into'" },
    { re:/\btapestry of\b/gi, label:"'tapestry of'" },
    { re:/\bin the realm of\b/gi, label:"'in the realm of'" },
    { re:/\bnavigat(e|es|ing) (the )?complexit(y|ies)\b/gi, label:"'navigate complexities'" },
    { re:/\bplays? a (crucial|pivotal|vital|key) role\b/gi, label:"'plays a crucial role'" },
    { re:/\bharness(ing|es)? the power of\b/gi, label:"'harness the power of'" },
    { re:/\bunlock(s|ed|ing)? (the )?potential\b/gi, label:"'unlock potential'" },
    { re:/\b(in today'?s|in the modern) (fast-paced|digital|ever-evolving) world\b/gi, label:"'in today's fast-paced world'" },
    { re:/\b(groundbreaking|revolutionary|game-changing|cutting-edge|state-of-the-art)\b/gi, label:"hype adjective" },
    { re:/\b(it is (important|worth noting) (that|to note))\b/gi, label:"'it is important to note'" },
    { re:/\b(in conclusion|to summarize|in summary),?\s*$/gim, label:"formulaic closer" },
    { re:/\bparadigm shift\b/gi, label:"'paradigm shift'" },
    { re:/\bsynerg(y|istic)\b/gi, label:"'synergy'" },
    { re:/\b(moreover|furthermore|additionally),\s/gi, label:"overused transition (check density)" },
  ];

  function applyHygiene(text, ruleIds){
    let out = text;
    for(const rule of HYGIENE_RULES){
      if(ruleIds.includes(rule.id)) out = rule.apply(out);
    }
    return out;
  }

  function detectTells(text){
    const hits = [];
    for(const t of AI_TELL_PATTERNS){
      const m = text.match(t.re);
      if(m && m.length) hits.push({ label:t.label, count:m.length });
    }
    return hits;
  }

  function render(){
    const c = $("#content");
    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">⚠️</span><div><b>This is a hygiene tool, not an evasion tool.</b> It fixes whitespace, quotes, and spacing; it flags common AI-tell phrasing so the writer can revise it themselves. It will <b>never</b> strip author metadata, randomize text to evade detection, or disguise AI authorship — doing so would facilitate academic dishonesty, which this project explicitly refuses.</div></div>
      <div class="card">
        <h3 style="margin-top:0">Paste your text</h3>
        <textarea class="textarea" id="cleanInput" style="min-height:160px" placeholder="Paste a paragraph or full document here. Hygiene rules run on demand; AI-tells are reported below for you to revise."></textarea>
        <div class="mt">
          <label>Hygiene rules to apply</label>
          <div class="row wrap" id="ruleToggles">
            ${HYGIENE_RULES.map(r=>`<label class="checkbox-row"><input type="checkbox" data-rule="${r.id}" checked> ${esc(r.label)}</label>`).join("")}
          </div>
        </div>
        <div class="flex gap-sm wrap mt">
          <button class="btn btn-primary" id="cleanBtn">🧹 Clean text</button>
          <button class="btn" id="pasteFromDraft">⬆ Use Thesis Workspace draft</button>
          <button class="btn" id="sendToWorkspace" disabled>📝 Send result to Workspace</button>
          <button class="btn" id="downloadTxt" disabled>⬇ Download .txt</button>
        </div>
        <details class="mt"><summary>What each rule does</summary>
          <table><tr><th>Rule</th><th>Description</th></tr>
          ${HYGIENE_RULES.map(r=>`<tr><td>${esc(r.label)}</td><td>${esc(r.desc)}</td></tr>`).join("")}
          </table>
        </details>
      </div>
      <div id="cleanOut"></div>
    `;
    let lastResult = "";
    $("#cleanBtn", c).addEventListener("click", ()=>{
      const input = $("#cleanInput", c).value;
      if(!input.trim()){ toast("Paste some text first.","error"); return; }
      const ids = $$('[data-rule]:checked', c).map(el=>el.dataset.rule);
      const cleaned = applyHygiene(input, ids);
      const tells = detectTells(input);
      lastResult = cleaned;
      $("#sendToWorkspace", c).disabled = false;
      $("#downloadTxt", c).disabled = false;
      $("#cleanOut", c).innerHTML = `
        <div class="card">
          <h3 style="margin-top:0">Result</h3>
          <div class="small muted mb">Before: ${input.length} chars → After: ${cleaned.length} chars (Δ ${cleaned.length-input.length})</div>
          <textarea class="textarea" id="cleanResult" style="min-height:160px;font-family:var(--mono);font-size:13px">${esc(cleaned)}</textarea>
        </div>
        <div class="card">
          <h3 style="margin-top:0">AI-tell advisory ${tells.length?`<span class="badge badge-warning">${tells.length} found</span>`:`<span class="badge badge-success">none detected</span>`}</h3>
          ${tells.length? `
            <div class="small muted mb">These are common AI phrasing patterns. They appear in human writing too, so this is <b>not</b> a detection verdict — revise only if they read as formulaic in your context.</div>
            <table><tr><th>Pattern</th><th>Occurrences</th></tr>
              ${tells.map(t=>`<tr><td>${esc(t.label)}</td><td><b>${t.count}</b></td></tr>`).join("")}
            </table>
          ` : `<div class="small muted">No common AI-tell phrases detected. (This does not mean the text is human-written — it means none of the ~14 patterns we check appeared.)</div>`}
        </div>
      `;
    });
    $("#pasteFromDraft", c).addEventListener("click", ()=>{
      $("#cleanInput", c).value = State.draft || "";
      toast("Loaded from Workspace draft.","info");
    });
    $("#sendToWorkspace", c).addEventListener("click", ()=>{
      if(!lastResult) return;
      const result = $("#cleanResult", c).value;
      State.draft = (State.draft? State.draft+"\n\n":"") + result;
      RW.saveState();
      toast("Sent to Thesis Workspace.","success");
      RW.navigate("workspace");
    });
    $("#downloadTxt", c).addEventListener("click", ()=>{
      const result = $("#cleanResult", c).value;
      downloadBlob(result, "cleaned-text.txt", "text/plain");
      toast("Downloaded.","success");
    });
  }

  Object.assign(RW, { Cleaner: { render, applyHygiene, detectTells, HYGIENE_RULES, AI_TELL_PATTERNS } });
})();
