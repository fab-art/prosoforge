/* ============================================================================
   Research Workstation — audio.js
   PHASE 4c of the feature roadmap: reverse-engineering of **NotebookLM's**
   Audio Overview — a podcast-style two-host dialogue about your source.

   NotebookLM's mechanism: cloud TTS with lifelike voices reading an LLM-written
   dialogue script about the user's uploaded sources.

   Our version:
   - Script: WebLLM writes a two-speaker dialogue grounded ONLY in the source
     text (A = host asks, B = expert answers). Without a model, a deterministic
     builder composes the same structure from our flashcard extractors
     (TL;DR / methods / findings / limitations) — always works.
   - Voice: Web Speech API `SpeechSynthesis` — built into every browser, free,
     fully local. Two different system voices for the two speakers.
   - Player: play / pause / stop, rate control, current-line highlight.
   - Script is editable before playing; exportable as .txt; pinnable to the
     Resource Board.

   Honest limits (mirrored in UI): system TTS quality varies by OS/browser and
   is not NotebookLM-grade audio; the script is a DRAFT grounded in abstract or
   extracted text — nothing beyond the source is invented.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast } = RW;

  /* ---- script generation: deterministic fallback ---- */
  function buildScriptFallback(src){
    const d = RW.Flashcards.buildDeck({ title:src.title, year:src.year, text:src.text, kind:src.kind, sourceLabel:src.sourceLabel });
    const get = kind => (d.cards.find(c=>c.kind===kind)||{}).back || "";
    const tldr = get("tldr") || "The text doesn't include a clear summary sentence.";
    const methods = get("methods");
    const findings = get("findings");
    const limits = get("limitations");
    const kw = get("keywords");
    const turns = [];
    const T = (speaker, text)=> turns.push({ speaker, text });
    T("A", `Welcome back to Research Rundown — your two-minute tour of one paper. Today: ${src.title}${src.year? ", published "+src.year : ""}.`);
    T("B", `Right — here's the short version: ${tldr}`);
    T("A", `How did they actually study this?`);
    T("B", methods && !methods.startsWith("No method") ? methods : `The available text doesn't describe the method in detail — you'd need the full paper for that. What we can say is what the study reports as its focus.`);
    T("A", `So what did they find?`);
    T("B", findings && !findings.startsWith("No explicit") ? findings.replace(/^• /gm, "First, ") : `The text doesn't state explicit findings with strong cues, so treat the abstract's framing carefully.`);
    T("A", `Any caveats before someone cites this?`);
    T("B", limits ? limits.replace(/^• /gm, "") : `Nothing in the text flags specific limitations — but no flag is not the same as no limitations. Read the discussion section of the original before relying on it.`);
    T("A", `Good reminder. Quick keywords for this one: ${kw || "not extractable"}. That's our rundown — as always, this overview is generated from the text you supplied, so verify against the original paper.`);
    return turns;
  }

  /* ---- script generation: WebLLM (optional) ---- */
  async function buildScriptLLM(src){
    const textForModel = (src.text||"").slice(0, 4000);
    const sys = "You write podcast dialogue scripts. Two speakers: A is the host who asks short questions; B is the expert who answers using ONLY the provided text. Return ONLY the script, alternating lines that each start with 'A:' or 'B:'. 8-10 lines total. Do not invent facts, numbers or citations beyond the text.";
    const question = `Source title: ${src.title}${src.year? " ("+src.year+")" : ""}\n\nText:\n${textForModel}\n\nWrite the dialogue now.`;
    const res = await RW.WebLLM.ask({ system: sys, question, maxTokens: 650, temperature: 0.5,
      fallbackFn: ()=>{ throw new Error("no-model"); } });
    const turns = parseScript(res.text);
    if(turns.length < 4) throw new Error("Model script too short — use the deterministic one.");
    return turns;
  }

  /* Parse "A: …" / "B: …" lines (script box is editable). */
  function parseScript(text){
    const turns = [];
    let last = "A";
    String(text||"").split(/\n+/).map(l=>l.trim()).filter(Boolean).forEach(line=>{
      const m = line.match(/^([AB])[:.]\s*(.+)$/);
      if(m){ turns.push({ speaker:m[1], text:m[2].trim() }); last = m[1]; }
      else { last = last==="A" ? "B" : "A"; turns.push({ speaker:last, text:line }); }
    });
    return turns;
  }

  function scriptToText(turns){ return turns.map(t=>`${t.speaker}: ${t.text}`).join("\n"); }

  /* ---- SpeechSynthesis voices: two distinct ones, deterministic pick ---- */
  function pickVoices(){
    if(!window.speechSynthesis || !window.speechSynthesis.getVoices) return null;
    const voices = window.speechSynthesis.getVoices();
    if(!voices.length) return null;
    const en = voices.filter(v=>/^en/i.test(v.lang));
    const pool = en.length ? en : voices;
    // prefer voices with distinct names for the two roles
    const female = pool.find(v=>/female|samantha|zira|susan|karen|moira|serena|victoria|allison/i.test(v.name));
    const male = pool.find(v=>/male|daniel|alex|david|fred|thomas|rishi|aaron/i.test(v.name));
    const A = female || pool[0];
    const B = male || pool.find(v=>v!==A && v.voiceURI!==A.voiceURI) || A;
    return { A, B };
  }

  /* ================================ UI ================================ */
  let turns = [];          // current script
  let scriptSource = "";   // provenance label of current script
  let playing = false, paused = false, lineIdx = -1;

  function render(){
    const c = $("#content");
    const papers = (State.papers||[]).filter(p=>p.abstract && p.abstract.length>30);
    const docs = State.documents||[];
    const llmReady = RW.WebLLM.isReady();

    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div>
        <b>Audio Overview</b> (NotebookLM-style) — turn a source into a two-host podcast dialogue and listen to it with your browser's built-in voices. The script is written by WebLLM when a model is loaded (tagged 🤖 DRAFT), or composed deterministically from our extractors when not. <b>Honest limits:</b> system TTS quality varies by OS/browser and isn't NotebookLM-grade studio audio; the script is grounded only in the abstract or extracted text — verify against the original.
      </div></div>

      <div class="card">
        <label class="small muted">Source</label>
        <select class="input" id="aoSource" style="width:100%">
          <option value="paste">✍️ Paste text</option>
          ${docs.length? `<option value="doc">📄 Uploaded document (${docs.length})</option>`:""}
          ${papers.length? `<option value="paper">📚 Library paper — abstract only (${papers.length})</option>`:""}
        </select>
        <div id="aoSrcZone" class="mt"></div>
        <button class="btn btn-primary mt" id="aoGen">📝 Generate script ${llmReady? "🤖" : "(deterministic)"}</button>
        <div class="small muted mt" id="aoStatus">${llmReady? "WebLLM ready — the script will be AI-generated (still a DRAFT)." : "No WebLLM model loaded — script composed deterministically (always works)."}</div>
      </div>

      <div class="card mt" id="aoScriptCard" style="display:none">
        <div class="between mb-sm wrap" style="gap:8px">
          <div><b>🎙️ Script</b> <span class="badge badge-muted" id="aoProv"></span></div>
          <div class="flex gap-sm wrap">
            <button class="btn btn-sm" id="aoPlay">▶ Play</button>
            <button class="btn btn-sm" id="aoPause">⏸ Pause</button>
            <button class="btn btn-sm" id="aoStop">⏹ Stop</button>
            <button class="btn btn-sm" id="aoTXT">⬇️ .txt</button>
            <button class="btn btn-sm" id="aoPin">📌 Pin to board</button>
          </div>
        </div>
        <div class="small muted mb-sm" id="aoVoiceInfo"></div>
        <div class="flex gap-sm wrap mb-sm" style="align-items:center">
          <label class="small muted">Rate</label>
          <input type="range" id="aoRate" min="0.7" max="1.4" step="0.05" value="1" style="max-width:140px">
          <span class="small" id="aoRateVal">1.0×</span>
        </div>
        <div class="field"><label>Script (editable — lines starting "A:" / "B:")</label>
          <textarea class="textarea" id="aoScript" rows="10"></textarea></div>
        <button class="btn btn-sm mt" id="aoReparse">↺ Re-parse edited script</button>
        <div class="ao-log mt" id="aoLog"></div>
      </div>
    `;
    renderSrcZone();
    $("#aoSource", c).addEventListener("change", renderSrcZone);
    $("#aoGen", c).addEventListener("click", generate);
    $("#aoPlay", c).addEventListener("click", play);
    $("#aoPause", c).addEventListener("click", pauseResume);
    $("#aoStop", c).addEventListener("click", stop);
    $("#aoTXT", c).addEventListener("click", exportTxt);
    $("#aoPin", c).addEventListener("click", pinToBoard);
    $("#aoReparse", c).addEventListener("click", ()=>{
      const t = parseScript($("#aoScript", c).value);
      if(!t.length){ toast("Nothing to parse in the script box.","error"); return; }
      turns = t; renderLog(); toast(`Re-parsed: ${t.length} lines.`,"info",2000);
    });
    $("#aoRate", c).addEventListener("input", e=>{ $("#aoRateVal", c).textContent = parseFloat(e.target.value).toFixed(2)+"×"; });
    if(window.speechSynthesis){
      window.speechSynthesis.onvoiceschanged = ()=> updateVoiceInfo();
    }
    updateVoiceInfo();
  }

  function renderSrcZone(){
    const c = $("#content");
    const zone = $("#aoSrcZone", c);
    const mode = $("#aoSource", c).value;
    if(mode==="paste"){
      zone.innerHTML = `<div class="field"><label>Paste article text</label><textarea class="textarea" id="aoPaste" rows="5" placeholder="Paste the paper text here…"></textarea></div>`;
    } else if(mode==="doc"){
      zone.innerHTML = `<select class="input" id="aoDoc">${(State.documents||[]).map(d=>`<option value="${esc(d.id)}">📄 ${esc(d.name)}</option>`).join("")}</select>`;
    } else {
      zone.innerHTML = `<select class="input" id="aoPaper">${(State.papers||[]).filter(p=>p.abstract).map(p=>`<option value="${esc(p.id)}">📚 ${esc((p.title||"untitled").slice(0,80))} (${p.year||"—"})</option>`).join("")}</select>
        <div class="small muted mt">Abstract-level overview — upload the PDF in <b>Upload &amp; Chat</b> for a full-text one.</div>`;
    }
  }

  async function generate(){
    const c = $("#content");
    const mode = $("#aoSource", c).value;
    let src = null;
    if(mode==="paste"){
      const t = $("#aoPaste", c).value.trim();
      if(t.length<120){ toast("Paste at least a paragraph of text.","error"); return; }
      src = { title:"Pasted text", year:null, text:t, kind:"paste", sourceLabel:"pasted text" };
    } else if(mode==="doc"){
      const d = (State.documents||[]).find(x=>x.id===$("#aoDoc", c).value);
      if(!d){ toast("Pick a document.","error"); return; }
      src = { title:d.name, year:null, text:d.text||"", kind:"document", sourceLabel:"uploaded document" };
    } else {
      const p = (State.papers||[]).find(x=>x.id===$("#aoPaper", c).value);
      if(!p){ toast("Pick a paper.","error"); return; }
      src = { title:p.title, year:p.year, text:(p.abstract||"")+(p.tldr? " TL;DR: "+p.tldr : ""), kind:"paper", sourceLabel:"library abstract" };
    }
    const btn = $("#aoGen", c);
    const status = $("#aoStatus", c);
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Writing…`;
    try{
      if(RW.WebLLM.isReady()){
        status.textContent = "WebLLM is writing the dialogue…";
        turns = await buildScriptLLM(src);
        scriptSource = "ai-draft";
      } else {
        turns = buildScriptFallback(src);
        scriptSource = "deterministic";
      }
      $("#aoScriptCard", c).style.display = "block";
      $("#aoScript", c).value = scriptToText(turns);
      $("#aoProv", c).textContent = scriptSource==="ai-draft" ? "🤖 WebLLM draft — verify" : "deterministic (no model)";
      renderLog();
      updateVoiceInfo();
      toast("Script ready — press ▶ to listen.","success");
    }catch(e){
      // LLM path failed → deterministic safety net
      turns = buildScriptFallback(src);
      scriptSource = "deterministic";
      $("#aoScriptCard", c).style.display = "block";
      $("#aoScript", c).value = scriptToText(turns);
      $("#aoProv", c).textContent = "deterministic (LLM failed: "+e.message.slice(0,60)+")";
      renderLog();
      status.textContent = "LLM script failed — composed the deterministic script instead.";
    }finally{
      btn.disabled = false; btn.innerHTML = "📝 Generate script " + (RW.WebLLM.isReady()? "🤖" : "(deterministic)");
    }
  }

  function renderLog(){
    const c = $("#content");
    const log = $("#aoLog", c);
    if(!log) return;
    log.innerHTML = turns.map((t,i)=>`
      <div class="ao-line spk-${t.speaker}" data-ao-line="${i}">
        <div class="who">${t.speaker==="A"? "🎙️ Host (A)" : "🎓 Expert (B)"}</div>
        <div class="small">${esc(t.text)}</div>
      </div>`).join("");
  }

  function updateVoiceInfo(){
    const c = $("#content");
    const el = $("#aoVoiceInfo", c);
    if(!el) return;
    if(!window.speechSynthesis || !window.speechSynthesis.getVoices){
      el.innerHTML = `<span class="badge badge-danger">SpeechSynthesis unavailable in this browser</span> — you can still export the script.`;
      return;
    }
    const v = pickVoices();
    el.innerHTML = v
      ? `Voices: <b>A</b> = ${esc(v.A.name)} · <b>B</b> = ${esc(v.B.name)} ${v.B===v.A? "(only one voice available — same voice for both speakers)" : ""}`
      : `System voices not yet enumerated — they will load when you press Play.`;
  }

  /* ---- player ---- */
  function stopEngine(){ try{ window.speechSynthesis.cancel(); }catch(e){} }
  function highlight(i){
    const c = $("#content");
    const log = $("#aoLog", c);
    if(!log) return;
    $$(".ao-line", log).forEach(el=> el.classList.toggle("active", +el.dataset.aoLine === i));
    const cur = log.querySelector(`[data-ao-line="${i}"]`);
    if(cur) cur.scrollIntoView({ block:"nearest", behavior:"smooth" });
  }

  function play(){
    if(!window.speechSynthesis || !window.speechSynthesis.getVoices){ toast("SpeechSynthesis is not available in this browser.","error"); return; }
    if(paused){ window.speechSynthesis.resume(); paused = false; playing = true; return; }
    stopEngine();
    const startAt = lineIdx >= 0 ? lineIdx : 0;
    const v = pickVoices();
    const rate = parseFloat($("#aoRate").value) || 1;
    playing = true;
    const speakLine = (i)=>{
      if(!playing || i >= turns.length){ playing = false; lineIdx = -1; highlight(-1); return; }
      lineIdx = i; highlight(i);
      const t = turns[i];
      const u = new SpeechSynthesisUtterance(t.text);
      if(v && v[t.speaker]) u.voice = v[t.speaker];
      u.rate = rate; u.pitch = t.speaker==="A" ? 1.05 : 0.95;
      u.onend = ()=> speakLine(i+1);
      u.onerror = ()=>{ playing = false; highlight(-1); };
      window.speechSynthesis.speak(u);
    };
    speakLine(startAt);
  }

  function pauseResume(){
    if(!window.speechSynthesis || !window.speechSynthesis.getVoices) return;
    if(!playing) { toast("Nothing is playing.","info",1800); return; }
    if(paused){ window.speechSynthesis.resume(); paused = false; }
    else { window.speechSynthesis.pause(); paused = true; }
  }

  function stop(){
    playing = false; paused = false; lineIdx = -1;
    stopEngine(); highlight(-1);
  }

  function exportTxt(){
    if(!turns.length){ toast("Generate a script first.","error"); return; }
    RW.downloadBlob(`Audio Overview script\n\n${scriptToText(turns)}\n`, "audio-overview.txt", "text/plain");
  }

  function pinToBoard(){
    if(!turns.length){ toast("Generate a script first.","error"); return; }
    State.notes.push({ id: RW.uid(), title: "🎙️ Audio Overview script", body: scriptToText(turns).slice(0,3800), tags:["audio-overview"], createdAt: Date.now() });
    saveState(); RW.refreshCounts();
    toast("Script pinned to the Resource Board.","success");
  }

  Object.assign(RW, { Audio: { render, buildScriptFallback, buildScriptLLM, parseScript, scriptToText, pickVoices } });
})();
