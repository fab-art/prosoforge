/* ============================================================================
   Research Workstation — paperpal-ui.js
   Paperpal UI (Phase 5c). Source = Thesis Workspace draft or pasted text.
   Deterministic consistency checks → findings grouped by rule with counts;
   mechanical autofix (majority style + chosen UK/US dialect) with undo;
   optional WebLLM grammar pass on ONE paragraph with per-suggestion
   accept/reject (AI never edits silently). Save back to the Workspace / .md.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, saveState } = RW;

  let workText = "";      // working copy being reviewed/fixed
  let origin = "draft";   // "draft" | "paste"
  let findings = null;

  const RULE_META = {
    abbrev:  { icon:"🔤", label:"Abbreviation consistency" },
    units:   { icon:"📏", label:"Unit & percent spacing" },
    spelling:{ icon:"🇬🇧", label:"UK/US spelling mix" },
    hyphen:  { icon:"➖", label:"Hyphenation variants" },
    egie:    { icon:"✍️", label:"e.g. / i.e. style" },
    heading: { icon:"🔠", label:"Section header case" },
  };

  function render(){
    const c = $("#content");
    const hasDraft = !!(State.draft && State.draft.trim());
    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div>
        <b>Paperpal-style consistency checks</b> — deterministic, no model needed: abbreviation definitions &amp; casing, unit/percent spacing, UK-vs-US spelling families, hyphenation variants, "eg/ie" style, lowercased section headers. Mechanical fixes win by <b>majority style</b> and respect your chosen dialect; the optional 🤖 grammar pass works on <b>one paragraph at a time</b> and you accept/reject each suggestion — nothing is edited silently.
      </div></div>

      <div class="card">
        <label class="small muted">Text to review</label>
        <select class="input" id="ppSource" style="max-width:340px">
          <option value="draft" ${hasDraft?"":"disabled"}>📝 Thesis Workspace draft ${hasDraft?`(${State.draft.length} chars)`:"(empty)"}</option>
          <option value="paste">✍️ Paste text</option>
        </select>
        <textarea class="textarea mt" id="ppPaste" rows="7" style="display:none" placeholder="Paste a manuscript section…"></textarea>
        <div class="flex gap-sm wrap mt">
          <button class="btn btn-primary" id="ppRun">🔎 Run consistency checks</button>
          <span class="flex gap-sm" style="align-items:center">
            <label class="small muted">Dialect for spelling fixes:</label>
            <select class="input" id="ppDialect" style="max-width:150px">
              <option value="us">American (US)</option>
              <option value="uk">British (UK)</option>
            </select>
          </span>
        </div>
        <div class="small muted mt" id="ppStatus"></div>
      </div>

      <div id="ppFindings"></div>
      <div id="ppGrammar"></div>
    `;
    $("#ppSource", c).addEventListener("change", e=>{
      $("#ppPaste", c).style.display = e.target.value==="paste" ? "block" : "none";
    });
    $("#ppRun", c).addEventListener("click", run);
  }

  function loadText(){
    origin = $("#ppSource").value;
    if(origin==="draft"){
      if(!State.draft || !State.draft.trim()){ toast("The Workspace draft is empty — paste text instead.","error"); return null; }
      workText = State.draft;
    } else {
      const t = $("#ppPaste").value.trim();
      if(t.length<60){ toast("Paste at least a paragraph (60+ chars).","error"); return null; }
      workText = t;
    }
    return workText;
  }

  function run(){
    const c = $("#content");
    const text = loadText();
    if(text==null) return;
    findings = RW.Paperpal.runAllChecks(text);
    const total = Object.values(findings).reduce((a,f)=>a+f.length,0);
    $("#ppStatus", c).textContent = `${total} finding(s) across 6 rules · ${text.split(/\s+/).length} words.`;
    renderFindings(total);
    renderGrammar();
  }

  function renderFindings(total){
    const c = $("#content");
    const box = $("#ppFindings", c);
    if(!total){
      box.innerHTML = `<div class="card mt"><span class="badge badge-success">✓ All six consistency rules pass</span><div class="small muted mt">This is a consistency check, not a proofread — meaning and citations are yours to verify.</div></div>`;
      return;
    }
    box.innerHTML = `
      <div class="card mt">
        <div class="between mb-sm wrap" style="gap:8px">
          <b>Findings</b>
          <div class="flex gap-sm wrap">
            <button class="btn btn-sm btn-primary" id="ppFix">🧹 Apply mechanical fixes</button>
            <button class="btn btn-sm" id="ppUndo" disabled>↩ Undo</button>
          </div>
        </div>
        ${Object.entries(findings).filter(([,f])=>f.length).map(([rule, list])=>`
          <details open class="mt-sm">
            <summary class="small"><b>${RULE_META[rule].icon} ${RULE_META[rule].label}</b> <span class="badge badge-warning">${list.length}</span></summary>
            <div class="mt-sm">${list.map(f=>`
              <div class="small" style="padding:5px 0;border-bottom:1px dashed var(--border)">
                ${esc(f.message)} ${f.note?`<span class="muted">(${esc(f.note)})</span>`:""}
              </div>`).join("")}</div>
          </details>`).join("")}
        <div class="small muted mt">Fixes are conservative: majority style wins; spelling follows your dialect; abbreviation unification is reported but not auto-merged (choose the right expansion yourself).</div>
      </div>`;
    let undoText = null;
    $("#ppFix", box).addEventListener("click", ()=>{
      undoText = workText;
      const res = RW.Paperpal.autofix(workText, { dialect: $("#ppDialect").value, fixSpelling:true });
      workText = res.text;
      const note = res.changes.map(ch=>`${ch.rule}${ch.note? " "+ch.note : ""}`).join(", ") || "nothing to change";
      $("#ppStatus").textContent = `Applied: ${note}. Re-run checks to confirm.`;
      $("#ppUndo").disabled = false;
      findings = RW.Paperpal.runAllChecks(workText);
      const t2 = Object.values(findings).reduce((a,f)=>a+f.length,0);
      renderFindings(t2);
      renderGrammar();
      toast(`Fixes applied (${res.changes.length} rules).`,"success");
    });
    $("#ppUndo", box).addEventListener("click", ()=>{
      if(undoText!=null){ workText = undoText; run(); toast("Reverted.","info",1800); }
    });
  }

  /* ---- optional WebLLM grammar pass (one paragraph, accept/reject each) ---- */
  async function renderGrammar(){
    const c = $("#content");
    const box = $("#ppGrammar", c);
    const paras = workText.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
    if(!paras.length){ box.innerHTML=""; return; }
    const llmReady = RW.WebLLM.isReady();
    box.innerHTML = `
      <div class="card mt">
        <div class="between mb-sm wrap" style="gap:8px">
          <b>🤖 Grammar pass (optional, WebLLM)</b>
          <span class="flex gap-sm" style="align-items:center">
            <select class="input" id="ppPara" style="max-width:80px">${paras.map((p,i)=>`<option value="${i}">¶ ${i+1}</option>`).join("")}</select>
            <button class="btn btn-sm btn-primary" id="ppGramRun" ${llmReady?"":"disabled title=\"Load a WebLLM model in Settings first\""}>Check paragraph</button>
          </span>
        </div>
        <div class="small muted">${llmReady? "The model reviews ONE paragraph and returns suggestions — you accept or reject each one; nothing is applied automatically." : "Needs a WebLLM model (Settings). The deterministic checks above work without one."}</div>
        <div id="ppGramOut" class="mt"></div>
      </div>`;
    if(llmReady) $("#ppGramRun", box).addEventListener("click", ()=> grammarPass(paras));
  }

  async function grammarPass(paras){
    const out = $("#ppGramOut");
    const paraIdx = parseInt($("#ppPara").value,10);
    const para = paras[paraIdx];
    if(!para || para.length>2200){ out.innerHTML = `<div class="small muted">Paragraph too long for a 1B model — split it first (≤2200 chars).</div>`; return; }
    out.innerHTML = `<span class="spinner"></span> Reviewing ¶ ${paraIdx+1}…`;
    const sys = 'You are an academic copy editor. Review the paragraph for grammar, awkward phrasing and clarity. Return ONLY a JSON array: [{"original":"exact substring from the paragraph","suggestion":"improved version","reason":"max 12 words"}]. Max 6 items. If the paragraph is fine, return [].';
    let suggestions;
    try{
      const res = await RW.WebLLM.ask({ system: sys, context:"", question:`Paragraph:\n${para}\n\nJSON suggestions:`, maxTokens: 550, temperature: 0.2, fallbackFn: ()=>{ throw new Error("no-model"); } });
      const t = String(res.text||"").replace(/```(json)?/g,"").trim();
      const s = t.indexOf("["), e = t.lastIndexOf("]");
      if(s<0||e<0) throw new Error("no JSON array in output");
      suggestions = JSON.parse(t.slice(s,e+1))
        .filter(x=>x && typeof x.original==="string" && typeof x.suggestion==="string")
        .filter(x=> workText.includes(x.original))
        .slice(0,6);
    }catch(err){
      out.innerHTML = `<div class="small" style="color:var(--danger)">Grammar pass failed: ${esc(err.message)} — deterministic findings above are unaffected.</div>`;
      return;
    }
    if(!suggestions.length){ out.innerHTML = `<span class="badge badge-success">✓ Model found no issues in ¶ ${paraIdx+1}</span>`; return; }
    out.innerHTML = `<div class="small muted mb-sm">${suggestions.length} suggestion(s) — accept applies to the working copy:</div>` +
      suggestions.map((s,i)=>`
        <div class="small" style="padding:6px 0;border-bottom:1px dashed var(--border)" data-pp-sugg="${i}">
          <div>❌ <s>${esc(s.original.slice(0,160))}</s></div>
          <div>✅ ${esc(s.suggestion.slice(0,200))} <span class="muted">— ${esc(s.reason||"")}</span></div>
          <div class="flex gap-sm mt-sm"><button class="btn btn-sm btn-primary" data-pp-acc="${i}">✅ Accept</button><button class="btn btn-sm" data-pp-rej="${i}">✖ Reject</button></div>
        </div>`).join("");
    suggestions.forEach((s,i)=>{
      out.querySelector(`[data-pp-acc="${i}"]`).addEventListener("click", ()=>{
        if(workText.includes(s.original)){
          workText = workText.replace(s.original, s.suggestion);
          State.jenniLog = State.jenniLog||[];
          State.jenniLog.unshift({ at:Date.now(), kind:"paperpal-grammar", model:State.settings.webllmModel, text:s.suggestion.slice(0,200) });
          saveState();
          toast("Applied to working copy (logged).","success");
        }
        const row = out.querySelector(`[data-pp-sugg="${i}"]`);
        if(row){ row.style.opacity = ".45"; row.querySelectorAll("button").forEach(b=>b.disabled=true); }
      });
      out.querySelector(`[data-pp-rej="${i}"]`).addEventListener("click", ()=>{
        const row = out.querySelector(`[data-pp-sugg="${i}"]`);
        if(row) row.style.display = "none";
      });
    });
    // save-back controls
    if(!$("#ppSaveBack")){
      const bar = document.createElement("div");
      bar.className = "flex gap-sm wrap mt";
      bar.id = "ppSaveBack";
      bar.innerHTML = `<button class="btn btn-sm btn-primary" id="ppToWorkspace">📝 Save back to Thesis Workspace</button><button class="btn btn-sm" id="ppMd">⬇️ report .md</button>`;
      $("#ppGrammar", $("#content")).appendChild(bar);
      bar.querySelector("#ppToWorkspace").addEventListener("click", ()=>{
        if(origin==="draft"){ State.draft = workText; saveState(); toast("Workspace draft updated (undo available in Workspace history? — keep a copy).","success",5000); }
        else { RW.downloadBlob(workText, "paperpal-cleaned.txt", "text/plain"); }
      });
      bar.querySelector("#ppMd").addEventListener("click", ()=>{
        const md = `# Paperpal consistency report\n\n${Object.entries(findings).filter(([,f])=>f.length).map(([rule,list])=>`## ${RULE_META[rule].label} (${list.length})\n${list.map(f=>"- "+f.message).join("\n")}`).join("\n\n") || "All rules passed."}\n`;
        RW.downloadBlob(md, "paperpal-report.md", "text/markdown");
      });
    }
  }

  Object.assign(RW, { PaperpalUI: { render } });
})();
