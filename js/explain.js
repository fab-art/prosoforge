/* ============================================================================
   Research Workstation — explain.js
   PHASE 4d of the feature roadmap: reverse-engineering of **SciSpace**
   (reading copilot — explains highlighted passages, defines jargon).

   SciSpace's mechanism: a cloud copilot that explains the equation/table/
   jargon you highlight inside a PDF.

   Our version — mounted on text surfaces we already have (the extracted page
   viewer opened from 📄 page chips, and the Paper Q&A log):
   - Select text → floating bar: ✨ Explain · 🧩 Simplify · 📖 Glossary.
   - Explain / Simplify: WebLLM explains the passage using the surrounding
     text (the full page, or the chat message) as context, plain-language.
     Without a model: deterministic fallback shows the containing sentences
     and any jargon detected in the selection, and says so.
   - Glossary: per-document jargon — deterministic "expansion (ABBR)" pairs +
     repeated ALL-CAPS tokens + rare long words; WebLLM adds definitions when
     loaded. Cached per document id.

   Honest limits (mirrored in UI): we explain *extracted text*, not rendered
   equations/figures; PDFs are not persisted, so explanations happen in the
   session they belong to.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { $, $$, esc, toast } = RW;

  const COMMON_WORDS = new Set(("also only well when then thus therefore however moreover furthermore between among because although though while during within without across about into over under again very much more most less least such other another same own said says say make made makes using used use based given different important results result study analysis data figure table section paper model effect effects value values number time high higher low lower total than that this these those with from which their there here where what when who how why not but and for are was were has have had can could should would may might must will shall does did been being").split(" "));

  /* Deterministic jargon detection: abbrev pairs + repeated acronyms + rare long words. */
  function extractJargon(text, max=12){
    const t = String(text||"");
    const out = [];
    const seen = new Set();
    // 1) "expansion (ABBR)" pairs — highest confidence
    const pairRe = /([A-Za-z][A-Za-z\s\-]{2,48}?)\s*\(([A-Z][A-Z0-9]{1,7}s?)\)/g;
    let m;
    while((m = pairRe.exec(t))){
      const abbr = m[2].trim();
      if(!seen.has(abbr)){ seen.add(abbr); out.push({ term:abbr, def:m[1].trim().replace(/\s+/g," ") }); }
      if(out.length >= max) return out.slice(0, max);
    }
    // 2) repeated ALL-CAPS tokens (appear ≥2 times)
    const caps = new Map();
    (t.match(/\b[A-Z]{3,12}s?\b/g)||[]).forEach(w=>caps.set(w,(caps.get(w)||0)+1));
    Array.from(caps.entries())
      .filter(([w,c])=>c>=2 && !seen.has(w))
      .sort((a,b)=>b[1]-a[1])
      .slice(0, 6)
      .forEach(([w])=>{ if(!seen.has(w)){ seen.add(w); out.push({ term:w, def:null }); } });
    // 3) rare long words (≥13 chars, not common English)
    const words = new Map();
    (t.toLowerCase().match(/[a-z]{13,}/g)||[]).forEach(w=>words.set(w,(words.get(w)||0)+1));
    Array.from(words.entries())
      .filter(([w,c])=>c>=1 && !COMMON_WORDS.has(w) && !seen.has(w))
      .sort((a,b)=>b[1]-a[1] || b[0].length-a[0].length)
      .slice(0, 4)
      .forEach(([w])=>{ if(!seen.has(w)){ seen.add(w); out.push({ term:w, def:null }); } });
    return out.slice(0, max);
  }

  /* The sentence(s) containing a selection — deterministic fallback core. */
  function sentencesAround(text, selection){
    const sents = RW.sentencesOf(String(text||""));
    const needle = String(selection||"").trim().toLowerCase().slice(0, 120);
    if(!needle) return [];
    return sents.filter(s=>s.toLowerCase().includes(needle.slice(0, 60))).slice(0, 3);
  }

  /* ---- floating selection toolbar ---- */
  const glossCache = new Map(); // docId → jargon list

  function mount(container, opts={}){
    if(!container) return;
    // avoid double-mount on the same element
    if(container.__rwExplain) return;
    container.__rwExplain = true;

    const state = {
      getContext: opts.getContext || (()=> container.textContent || ""),
      docId: opts.docId || null,
      lastSel: "",
    };

    const bar = document.createElement("div");
    bar.id = "rwSelBar";
    bar.style.display = "none";
    bar.innerHTML = `
      <button class="btn btn-primary btn-sm" data-act="explain">✨ Explain</button>
      <button class="btn btn-sm" data-act="simplify">🧩 Simplify</button>
      <button class="btn btn-sm" data-act="glossary">📖 Glossary</button>`;
    document.body.appendChild(bar);

    function hideBar(){ bar.style.display = "none"; }
    function positionBar(){
      const selObj = document.getSelection();
      if(!selObj.rangeCount) return hideBar();
      const rect = selObj.getRangeAt(0).getBoundingClientRect();
      bar.style.left = Math.max(8, Math.min(window.innerWidth - 240, rect.left)) + "px";
      bar.style.top = (rect.bottom + 6 + window.scrollY) + "px";
      bar.style.display = "flex";
    }

    function onCheck(){
      if(!container.isConnected){ document.removeEventListener("selectionchange", onCheck); bar.remove(); container.__rwExplain = false; return; }
      const selObj = document.getSelection();
      if(!selObj || selObj.isCollapsed){ hideBar(); return; }
      const node = selObj.anchorNode;
      if(!node || (node!==container && !container.contains(node))){ hideBar(); return; }
      const text = String(selObj).trim();
      if(text.length < 3){ hideBar(); return; }
      state.lastSel = text;
      positionBar();
    }

    document.addEventListener("selectionchange", onCheck);
    container.addEventListener("mouseup", onCheck);
    container.addEventListener("touchend", ()=> setTimeout(onCheck, 60));

    bar.addEventListener("mousedown", e=>{ e.preventDefault(); }); // keep the selection alive

    bar.addEventListener("click", async e=>{
      const btn = e.target.closest("[data-act]");
      if(!btn) return;
      const act = btn.dataset.act;
      if(act==="glossary"){ await showGlossary(container, state); return; }
      const sel = state.lastSel;
      if(!sel){ toast("Select a passage first.","error"); return; }
      await showExplanation(container, state, sel, act);
    });
  }

  /* Output box inserted right after the text container. */
  function makeBox(container, title){
    $$(".rw-explain-box", container.parentNode).forEach(b=>b.remove());
    const box = document.createElement("div");
    box.className = "rw-explain-box";
    box.innerHTML = `
      <div class="between"><div class="tagline">${esc(title)}</div><button class="btn btn-ghost btn-sm" data-close="1">✕</button></div>
      <div class="rw-explain-body small">…</div>`;
    box.querySelector("[data-close]").addEventListener("click", ()=> box.remove());
    if(container.nextSibling) container.parentNode.insertBefore(box, container.nextSibling);
    else container.parentNode.appendChild(box);
    return box;
  }

  function deterministicExplanation(state, sel, mode){
    const ctx = state.getContext();
    const sents = sentencesAround(ctx, sel);
    const jargon = extractJargon(sel, 5);
    const label = mode==="explain" ? "✨ Explanation (deterministic — no model)" : "🧩 Simplification (deterministic — no model)";
    const lines = [];
    if(mode==="simplify" && sents.length){
      lines.push(`Original sentence(s):`);
      sents.forEach(s=>lines.push(`• ${s}`));
    }
    if(jargon.length){
      lines.push(`Jargon detected in your selection:`);
      jargon.forEach(j=>lines.push(`• ${j.term}${j.def? " — "+j.def : ""}`));
    }
    lines.push(mode==="explain"
      ? `Load a WebLLM model in Settings for a real plain-language explanation. Meanwhile: the sentences above are the passage in its original context — no model rewrote them.`
      : `A 1B-class local model (Settings → WebLLM) can rewrite this in simpler words. Nothing above was machine-rewritten.`);
    return { title: label, html: lines.map(l=>`<div>${esc(l)}</div>`).join(""), ai:false };
  }

  async function showExplanation(container, state, sel, mode){
    const box = makeBox(container, mode==="explain" ? "✨ Explain selection" : "🧩 Simplify selection");
    const body = box.querySelector(".rw-explain-body");
    if(!RW.WebLLM.isReady()){
      const det = deterministicExplanation(state, sel, mode);
      box.querySelector(".tagline").textContent = det.title;
      body.innerHTML = det.html;
      return;
    }
    body.innerHTML = `<span class="spinner"></span> ${mode==="explain" ? "Explaining" : "Simplifying"} with WebLLM…`;
    const ctx = String(state.getContext()||"").slice(0, 3500);
    const sys = mode==="explain"
      ? "You explain academic passages in plain language (CEFR B1). Explain ONLY the quoted passage, using the surrounding text as context. Max 120 words. If the context is insufficient, say exactly what can and cannot be concluded. Never invent facts."
      : "Rewrite the quoted passage in simple English (CEFR B1), preserving meaning exactly. Keep technical terms, each followed by a very short gloss in parentheses. Max 100 words. Do not add information.";
    const question = `Surrounding text:\n${ctx}\n\nPassage: "${sel.slice(0, 800)}"\n\n${mode==="explain" ? "Explain" : "Simplify"} the passage now.`;
    try{
      const res = await RW.WebLLM.ask({ system: sys, question, maxTokens: 380, temperature: 0.3,
        fallbackFn: ()=>{ throw new Error("no-model"); } });
      box.querySelector(".tagline").textContent = `${mode==="explain"?"✨ Explanation":"🧩 Simplification"} — 🤖 WebLLM draft (verify against the source)`;
      body.innerHTML = `<div style="white-space:pre-wrap">${esc(res.text.trim())}</div>`;
    }catch(e){
      const det = deterministicExplanation(state, sel, mode);
      box.querySelector(".tagline").textContent = det.title + " (LLM error)";
      body.innerHTML = det.html;
    }
  }

  async function showGlossary(container, state){
    const box = makeBox(container, "📖 Document glossary (jargon in this text)");
    const body = box.querySelector(".rw-explain-body");
    const ctx = String(state.getContext()||"");
    const cacheKey = state.docId || ("adhoc:" + (ctx.length % 5000));
    let jargon = glossCache.get(cacheKey);
    if(!jargon){ jargon = extractJargon(ctx, 12); glossCache.set(cacheKey, jargon); }
    if(!jargon.length){
      body.innerHTML = `<div>No obvious jargon detected (no abbreviations, repeated acronyms or rare long words). This may be a short or very plain text.</div>`;
      return;
    }
    if(!RW.WebLLM.isReady()){
      body.innerHTML = jargon.map(j=>`<div>• <b>${esc(j.term)}</b>${j.def? " — "+esc(j.def) : " — (no expansion found in text)"}</div>`).join("") +
        `<div class="muted mt-sm">Deterministic detection (no model). Load a WebLLM model in Settings for one-line definitions.</div>`;
      return;
    }
    body.innerHTML = `<span class="spinner"></span> Defining ${jargon.length} terms with WebLLM…`;
    const terms = jargon.map(j=>j.term).join(", ");
    const sys = "For each term in the list, give ONE line: 'term — definition (max 15 words)'. Use the surrounding text to disambiguate; if a term is not academic jargon, write 'common word'. Output only the lines.";
    const question = `Terms: ${terms}\n\nSurrounding text:\n${ctx.slice(0, 3000)}\n\nDefinitions:`;
    try{
      const res = await RW.WebLLM.ask({ system: sys, question, maxTokens: 500, temperature: 0.2,
        fallbackFn: ()=>{ throw new Error("no-model"); } });
      body.innerHTML = `<div style="white-space:pre-wrap">${esc(res.text.trim())}</div><div class="muted mt-sm">🤖 WebLLM draft — verify specialized definitions.</div>`;
    }catch(e){
      body.innerHTML = jargon.map(j=>`<div>• <b>${esc(j.term)}</b>${j.def? " — "+esc(j.def) : ""}</div>`).join("") +
        `<div class="muted mt-sm">LLM error — showing deterministic detections only.</div>`;
    }
  }

  Object.assign(RW, { Explain: { mount, extractJargon, sentencesAround } });
})();
