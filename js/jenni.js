/* ============================================================================
   Research Workstation — jenni.js
   PHASE 5b of the feature roadmap: reverse-engineering of **Jenni AI**
   (inline sentence autocompletion + in-text citation insertion).

   Jenni's mechanism: Tab-to-accept sentence completions while writing;
   citation insertion from a large corpus; paid.

   Our version — the **Write Pad**:
   - Autocomplete: when you pause typing, WebLLM proposes ONE continuation
     sentence grounded in your library (top-2 abstracts by keyword overlap).
     Tab or click accepts it. **Every accepted completion is logged** in an
     AI-assist log — assisted spans are visible, not hidden.
   - Without a model: the fallback suggestion is a verbatim sentence from
     your library + a real in-text citation (honest "quote, don't invent").
   - `@@` cite-insert: typing @@ anywhere opens a library picker; choosing a
     paper inserts a properly formatted in-text citation (APA/MLA/Chicago)
     and registers it for the export's reference list.
   - Export: .md with the pad text + formatted references + the assist log.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, saveState, contentTokens, inText, formatCitation } = RW;

  /* ---- pure logic (unit-tested) ---- */

  // Top-N library abstracts by keyword overlap with the current paragraph.
  function groundingFor(text, papers, n=2){
    const recent = String(text||"").slice(-400);
    const qTokens = new Set(contentTokens(recent));
    if(!qTokens.size) return [];
    return (papers||[])
      .filter(p=>p.abstract && p.abstract.length>30)
      .map(p=>{
        const sTokens = new Set(contentTokens(p.title+" "+p.abstract));
        let o = 0; for(const t of qTokens) if(sTokens.has(t)) o++;
        return { p, overlap:o };
      })
      .filter(x=>x.overlap>0)
      .sort((a,b)=>b.overlap-a.overlap)
      .slice(0,n);
  }

  function completionPrompt(text, grounding){
    const context = grounding.map((g,i)=>`[${i+1}] ${inText(g.p, State.settings.citationStyle)} — "${g.p.title}": ${g.p.abstract.slice(0,700)}`).join("\n\n");
    const system = "You continue an academic draft by exactly ONE sentence (max 35 words). Match the draft's register and tense. Use ONLY the supplied library context if you reference findings; otherwise connect or transition without inventing facts, numbers or citations. Return ONLY the sentence — no quotes, no preamble.";
    const question = `Draft so far:\n${String(text||"").slice(-700)}\n\n${context? "Library context:\n"+context+"\n\n":""}Write the next sentence now.`;
    return { system, question };
  }

  // No-model fallback: best verbatim sentence from the grounded papers.
  function fallbackSuggestion(text, papers){
    const grounding = groundingFor(text, papers, 1);
    if(!grounding.length) return null;
    const p = grounding[0].p;
    const sents = RW.sentencesOf(p.abstract);
    const qTokens = new Set(contentTokens(String(text||"").slice(-300)));
    const best = sents.map(s=>{
      const sTokens = new Set(contentTokens(s));
      let o = 0; for(const t of qTokens) if(sTokens.has(t)) o++;
      return { s, o };
    }).sort((a,b)=>b.o-a.o)[0];
    if(!best || best.o===0) return null;
    return { kind:"quote", sentence: best.s, paper: p };
  }

  // Insert a suggestion at the caret position.
  function insertAtCaret(text, caret, insertion){
    const before = String(text).slice(0, caret);
    const after = String(text).slice(caret);
    const afterTrim = after.replace(/^\s+/, "");
    let glue = "";
    const trimmed = before.replace(/\s+$/,"");
    if(trimmed && !/[.!?…:]$/.test(trimmed)) glue = " ";
    // trailing separator only when text continues after the insertion
    const needsTrailing = afterTrim.length>0 && /^[A-Za-z0-9“"(']/.test(afterTrim);
    const newText = trimmed + glue + insertion + (needsTrailing ? " " : "") + afterTrim;
    const newCaret = (trimmed + glue + insertion + (needsTrailing ? " " : "")).length;
    return { text: newText, caret: newCaret };
  }

  // Detect "@@" right before the caret.
  function atAtBeforeCaret(text, caret){
    return String(text).slice(0, caret).endsWith("@@");
  }

  function logEntry(kind, model, text){
    return { at: Date.now(), kind, model: model||"—", text: String(text||"").slice(0,300) };
  }

  function padToMarkdown(padText, refs, style, log){
    const L = [`# Write Pad draft`, ``, padText || "*(empty)*", ``];
    if(refs && refs.length){
      L.push(`## References`, ``);
      refs.forEach((r,i)=> L.push(`${i+1}. ${formatCitation(r, style)}`));
      L.push(``);
    }
    if(log && log.length){
      L.push(`## AI-assist log (transparency)`, ``);
      log.forEach(e=> L.push(`- ${new Date(e.at).toLocaleString()} — ${e.kind} (${e.model}): "${e.text.slice(0,120)}${e.text.length>120?"…":""}"`));
    }
    return L.join("\n");
  }

  /* ================================ UI ================================ */
  let suggestion = null;    // {kind:"ai"|"quote", sentence, paper?, model?}
  let pickerOpen = false;

  function render(){
    const c = $("#content");
    const llmReady = RW.WebLLM.isReady();
    c.innerHTML = `
      <div class="notice notice-draft"><span class="ic">⚠️</span><div>
        <b>Write Pad</b> (Jenni-style) — write here with two assists: pause and WebLLM proposes <b>one</b> continuation sentence (press <b>Tab</b> to accept), or type <code>@@</code> to insert a formatted citation from your library. Without a model, the suggester offers <b>verbatim library quotes</b> with real citations instead. Every accepted insertion is recorded in the <b>AI-assist log</b> below — nothing AI-written hides in your text.
      </div></div>

      <div class="card">
        <div class="flex gap-sm wrap between mb-sm" style="align-items:center">
          <label class="small muted">Draft text (autosaved in this browser)</label>
          <span class="flex gap-sm">
            <select class="input" id="jnStyle" style="max-width:130px">
              <option value="apa" ${State.settings.citationStyle==='apa'?'selected':''}>APA</option>
              <option value="mla" ${State.settings.citationStyle==='mla'?'selected':''}>MLA</option>
              <option value="chicago" ${State.settings.citationStyle==='chicago'?'selected':''}>Chicago</option>
            </select>
            <button class="btn btn-sm" id="jnSuggest" ${llmReady?"":"title=\"No model loaded — will offer library quotes\""}>✨ Suggest next sentence</button>
          </span>
        </div>
        <textarea class="textarea" id="jnPad" rows="14" placeholder="Start writing. Pause mid-sentence for a suggestion, or type @@ to cite a paper from your library…">${esc(State.jenniPad||"")}</textarea>
        <div id="jnSuggBox" style="display:none" class="rw-explain-box"></div>
        <div class="flex gap-sm wrap mt">
          <button class="btn btn-sm" id="jnMd">⬇️ .md (with references)</button>
          <button class="btn btn-sm" id="jnCopy">📋 Copy</button>
          <button class="btn btn-sm" id="jnSend">📝 Send to Thesis Workspace</button>
          <button class="btn btn-sm btn-danger" id="jnClear">🗑 Clear pad</button>
        </div>
      </div>

      <div class="card mt">
        <div class="between mb-sm"><b>Citation picker</b> <span class="small muted">trigger: type <code>@@</code> in the pad</span></div>
        <div id="jnPickerZone"></div>
      </div>

      <div class="card mt">
        <div class="between mb-sm">
          <b>🧾 AI-assist log <span class="badge badge-muted">${(State.jenniLog||[]).length}</span></b>
          <button class="btn btn-sm btn-danger" id="jnClearLog">Clear log</button>
        </div>
        <div id="jnLogList"></div>
      </div>
    `;
    $("#jnStyle", c).addEventListener("change", e=>{ State.settings.citationStyle = e.target.value; saveState(); renderPicker(); });
    $("#jnSuggest", c).addEventListener("click", suggest);
    $("#jnMd", c).addEventListener("click", exportMd);
    $("#jnCopy", c).addEventListener("click", ()=>{
      navigator.clipboard.writeText($("#jnPad", c).value).then(()=>toast("Copied.","success"));
    });
    $("#jnSend", c).addEventListener("click", ()=>{
      const t = $("#jnPad", c).value.trim();
      if(!t){ toast("Pad is empty.","error"); return; }
      State.draft = (State.draft? State.draft+"\n\n":"") + t;
      saveState(); toast("Sent to Thesis Workspace.","success"); RW.navigate("workspace");
    });
    $("#jnClear", c).addEventListener("click", ()=>{
      if(!confirm("Clear the pad text?")) return;
      State.jenniPad = ""; $("#jnPad", c).value = ""; saveState();
    });
    $("#jnClearLog", c).addEventListener("click", ()=>{
      State.jenniLog = []; saveState(); renderLogList(); refreshLogBadge();
    });
    const pad = $("#jnPad", c);
    pad.addEventListener("input", RW.debounce(()=>{
      State.jenniPad = pad.value; saveState();
      hideSuggestion();
      checkAtAt(pad);
      maybeAutoSuggest(pad);
    }, 350));
    pad.addEventListener("keydown", e=>{
      if(e.key==="Tab" && suggestion){
        e.preventDefault();
        acceptSuggestion();
      }
    });
    renderLogList();
    renderPicker();
  }

  function padEl(){ return $("#jnPad"); }

  function checkAtAt(pad){
    if(atAtBeforeCaret(pad.value, pad.selectionStart)){ renderPicker(true); toast("Pick a paper to cite (@@ replaced).","info",2600); }
  }

  let autoTimer = null;
  function maybeAutoSuggest(pad){
    if(!RW.WebLLM.isReady()) return;
    clearTimeout(autoTimer);
    const val = pad.value;
    const caret = pad.selectionStart;
    const sinceDot = val.slice(0, caret).split(/(?<=[.!?])\s+/).pop()||"";
    if(sinceDot.trim().length < 12) return; // too early in the sentence
    autoTimer = setTimeout(()=> suggest(), 900);
  }

  async function suggest(){
    const pad = padEl();
    if(!pad) return;
    const btn = $("#jnSuggest");
    btn.disabled = true;
    try{
      const text = pad.value.slice(0, pad.selectionStart);
      if(RW.WebLLM.isReady()){
        const grounding = groundingFor(text, State.papers);
        const { system, question } = completionPrompt(text, grounding);
        const res = await RW.WebLLM.ask({ system, context:"", question, maxTokens: 90, temperature: 0.6,
          fallbackFn: ()=>{ throw new Error("no-model"); } });
        const sentence = String(res.text||"").trim().replace(/^["“']|["”']$/g,"");
        if(!sentence || sentence.length<8) throw new Error("empty suggestion");
        suggestion = { kind:"ai", sentence, model: res.model||State.settings.webllmModel };
      } else {
        const s = fallbackSuggestion(text, State.papers);
        if(!s){ toast("No library abstract overlaps this text — collect related papers first.","error",4000); return; }
        suggestion = { kind:"quote", sentence: s.sentence, paper: s.paper };
      }
      showSuggestion();
    }catch(e){
      toast("Suggestion failed: "+e.message,"error",3500);
    }finally{
      btn.disabled = false;
    }
  }

  function showSuggestion(){
    const box = $("#jnSuggBox");
    if(!box || !suggestion) return;
    box.style.display = "block";
    box.innerHTML = suggestion.kind==="ai"
      ? `<div class="tagline">✨ Next sentence — <b>Tab</b> to accept · AI draft (model: ${esc(suggestion.model)}) · logged on accept</div><div>${esc(suggestion.sentence)}</div><div class="mt-sm"><button class="btn btn-sm btn-primary" id="jnAccept">Tab ⇥ Accept</button> <button class="btn btn-sm" id="jnDismiss">✕ Dismiss</button></div>`
      : `<div class="tagline">📚 Verbatim quote from your library — inserting adds the citation (no model needed)</div><div>“${esc(suggestion.sentence)}” <span class="muted small">— ${esc(inText(suggestion.paper, State.settings.citationStyle))}</span></div><div class="mt-sm"><button class="btn btn-sm btn-primary" id="jnAccept">⇥ Insert quote + citation</button> <button class="btn btn-sm" id="jnDismiss">✕ Dismiss</button></div>`;
    $("#jnAccept").addEventListener("click", acceptSuggestion);
    $("#jnDismiss").addEventListener("click", hideSuggestion);
    if(suggestion.kind==="ai") $("#jnAccept").textContent = "Tab ⇥ Accept";
  }

  function hideSuggestion(){
    suggestion = null;
    const box = $("#jnSuggBox");
    if(box){ box.style.display = "none"; box.innerHTML = ""; }
  }

  function acceptSuggestion(){
    const pad = padEl();
    if(!pad || !suggestion) return;
    const caret = pad.selectionStart;
    let insertion = suggestion.sentence;
    if(suggestion.kind==="quote"){
      const cite = inText(suggestion.paper, State.settings.citationStyle);
      insertion = `“${suggestion.sentence}” ${cite}`;
      addRef(suggestion.paper);
    }
    const res = insertAtCaret(pad.value, caret, insertion);
    pad.value = res.text;
    pad.selectionStart = pad.selectionEnd = res.caret;
    State.jenniPad = pad.value;
    State.jenniLog = State.jenniLog||[];
    State.jenniLog.unshift(logEntry(suggestion.kind==="ai" ? "ai-completion" : "cited-quote", suggestion.model||"none", insertion));
    if(State.jenniLog.length>60) State.jenniLog.length = 60;
    saveState();
    hideSuggestion();
    renderLogList(); refreshLogBadge();
    toast("Inserted — logged in the AI-assist log.","success",2200);
    pad.focus();
  }

  function refreshLogBadge(){
    const c = $("#content");
    const b = $("#jnLogList");
    if(!b) return;
    const badge = document.querySelector(".card .badge-muted");
    // badge refresh is cosmetic; simplest is to re-render the log card header text
  }

  /* ---- @@ picker ---- */
  function renderPicker(filterMode){
    const zone = $("#jnPickerZone");
    if(!zone) return;
    const papers = (State.papers||[]);
    if(!papers.length){ zone.innerHTML = `<div class="empty" style="padding:14px">No papers in the library yet — collect some via Literature Search.</div>`; return; }
    zone.innerHTML = `
      <input class="input" id="jnPickFilter" placeholder="🔍 Filter papers…" style="max-width:320px">
      <div id="jnPickList" class="mt" style="max-height:220px;overflow:auto"></div>`;
    const list = ()=> {
      const f = ($("#jnPickFilter").value||"").toLowerCase();
      const shown = papers.filter(p=> (p.title||"").toLowerCase().includes(f)).slice(0, 30);
      $("#jnPickList").innerHTML = shown.map(p=>`
        <div class="between small" style="padding:4px 0;border-bottom:1px dashed var(--border)">
          <span style="min-width:0">📚 ${esc((p.title||"untitled").slice(0,80))} <span class="muted">(${p.year||"—"})</span></span>
          <button class="btn btn-sm" data-jn-cite="${esc(p.id)}">${esc(inText(p, State.settings.citationStyle))}</button>
        </div>`).join("") || `<div class="small muted">No matches.</div>`;
      $$("[data-jn-cite]", $("#jnPickList")).forEach(b=> b.addEventListener("click", ()=> insertCite(b.dataset.jnCite)));
    };
    $("#jnPickFilter").addEventListener("input", RW.debounce(list, 150));
    list();
  }

  function insertCite(paperId){
    const pad = padEl();
    const p = (State.papers||[]).find(x=>x.id===paperId);
    if(!pad || !p) return;
    const caret = pad.selectionStart;
    const cite = inText(p, State.settings.citationStyle) ;
    if(atAtBeforeCaret(pad.value, caret)){
      pad.value = pad.value.slice(0, caret-2) + cite + pad.value.slice(caret);
      pad.selectionStart = pad.selectionEnd = caret - 2 + cite.length;
    } else {
      const res = insertAtCaret(pad.value, caret, cite);
      pad.value = res.text; pad.selectionStart = pad.selectionEnd = res.caret;
    }
    State.jenniPad = pad.value;
    addRef(p);
    saveState();
    toast("Citation inserted.","success",2000);
    pad.focus();
  }

  function addRef(p){
    State.jenniRefs = State.jenniRefs||[];
    if(!State.jenniRefs.some(r=>r.id===p.id)) State.jenniRefs.push(p);
  }

  function renderLogList(){
    const box = $("#jnLogList");
    if(!box) return;
    const log = State.jenniLog||[];
    if(!log.length){ box.innerHTML = `<div class="small muted">No assisted insertions yet. Accepted completions and inserted quotes appear here.</div>`; return; }
    box.innerHTML = log.map(e=>`
      <div class="between small" style="padding:4px 0;border-bottom:1px dashed var(--border)">
        <span style="min-width:0">${e.kind==="ai-completion"?'<span class="badge badge-warning">AI</span>':'<span class="badge badge-muted">quote</span>'} ${esc(e.text.slice(0,110))}${e.text.length>110?"…":""}</span>
        <span class="muted" style="flex:none">${new Date(e.at).toLocaleTimeString()} · ${esc(e.model)}</span>
      </div>`).join("");
  }

  function exportMd(){
    const pad = padEl();
    const md = padToMarkdown(pad? pad.value : (State.jenniPad||""), State.jenniRefs||[], State.settings.citationStyle, State.jenniLog||[]);
    RW.downloadBlob(md, "write-pad-draft.md", "text/markdown");
    toast("Exported with references + assist log.","success");
  }

  Object.assign(RW, {
    Jenni: {
      render, groundingFor, completionPrompt, fallbackSuggestion,
      insertAtCaret, atAtBeforeCaret, logEntry, padToMarkdown,
    }
  });
})();
