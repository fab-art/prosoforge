/* ============================================================================
   Research Workstation — workspace.js
   Thesis Workspace: draft editor with live per-paragraph style checks.
   Advisory only — never auto-edits. Flags: sentence-length uniformity (σ),
   AI-cliché phrases, passive-voice density.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, sentencesOf, wordsOf, mean, stdev, debounce } = RW;

  const CLICHES = [
    "in today's fast-paced world","in conclusion","it is important to note","plays a crucial role",
    "delves into","sheds light on","navigates the complexities","in the realm of","tapestry of",
    "ever-evolving","ever-changing","dynamic landscape","multifaceted","holistic approach",
    "it is worth noting","needless to say","when it comes to","the bottom line is","at the end of the day",
    "a myriad of","a plethora of","harness the power","leverage","unlock the potential",
    "in the digital age","seamlessly","robust","cutting-edge","state-of-the-art","game-changer",
    "paradigm shift","synergy","synergistic","unprecedented","groundbreaking","revolutionary",
    "pave the way","shedding light","spearhead","usher in","resonate with","at the forefront",
  ];
  const PASSIVE_HINTS = /\b(is|are|was|were|be|been|being)\s+(\w+ed|written|shown|seen|done|made|taken|given|found|considered|observed|reported|demonstrated|evaluated|analyzed|examined|conducted|performed|obtained|derived|proposed|developed|designed|implemented|applied|used|adopted|employed)\b/gi;

  function checkParagraph(p){
    const sents = sentencesOf(p);
    const lens = sents.map(s=>wordsOf(s).length);
    const wordCount = wordsOf(p).length;
    const stdevLen = stdev(lens);
    const flags = [];
    if(sents.length>=3 && stdevLen<2.5){
      flags.push({sev:"med", label:`Uniform sentence length (σ ${stdevLen.toFixed(1)})`});
    }
    if(sents.length>=3 && stdevLen>10){
      flags.push({sev:"low", label:`Variable sentence length (σ ${stdevLen.toFixed(1)})`});
    }
    const lower = p.toLowerCase();
    const found = CLICHES.filter(c=> lower.includes(c));
    if(found.length){
      flags.push({sev:"high", label:`${found.length} cliché phrase${found.length!==1?'s':''}: ${found.slice(0,2).map(esc).join(", ")}${found.length>2?'…':''}`});
    }
    const passiveMatches = (p.match(PASSIVE_HINTS)||[]).length;
    const passiveDensity = sents.length? passiveMatches/sents.length : 0;
    if(sents.length>=2 && passiveDensity>0.5){
      flags.push({sev:"med", label:`High passive density (${Math.round(passiveDensity*100)}%)`});
    }
    return { flags, wordCount, sentenceCount:sents.length, stdevLen, cliches:found, passiveMatches, passiveDensity };
  }

  function render(){
    const c = $("#content");
    c.innerHTML = `
      <div class="card">
        <div class="between mb-sm">
          <h3 style="margin:0">Draft</h3>
          <div class="flex gap-sm wrap">
            <button class="btn btn-sm" id="loadDraft">Load saved</button>
            <button class="btn btn-sm" id="saveDraft">💾 Save</button>
            <button class="btn btn-sm" id="exportMd">⬇ .md</button>
            <button class="btn btn-sm" id="exportHtml">⬇ .html</button>
            <button class="btn btn-sm" id="exportTxt">⬇ .txt</button>
            <button class="btn btn-sm btn-danger" id="clearDraft">Clear</button>
          </div>
        </div>
        <textarea class="textarea" id="draftArea" style="min-height:200px" placeholder="Paste your draft here, or send a paragraph from the AI Writer. Style checks run on each paragraph as you type."></textarea>
        <div class="notice notice-advisory mt"><span class="ic">ℹ️</span><div><b>Advisory signals only.</b> Style checks flag sentence-length uniformity, AI-cliché phrases, and passive-voice density. They never auto-edit. Many valid academic sentences use passive voice — investigate, don't blindly fix.</div></div>
      </div>
      <div class="between mb"><h3 style="margin:0">Per-paragraph checks</h3><span class="badge badge-muted" id="paraCount">0 paragraphs</span></div>
      <div id="paraList"></div>
    `;
    const area = $("#draftArea", c);
    area.value = State.draft || "";
    const update = ()=>{
      State.draft = area.value; RW.saveState();
      renderParas(area.value);
    };
    const debouncedUpdate = debounce(update, 400);
    area.addEventListener("input", debouncedUpdate);
    $("#saveDraft", c).addEventListener("click", ()=>{ State.draft=area.value; RW.saveState(); RW.toast("Draft saved.","success"); });
    $("#loadDraft", c).addEventListener("click", ()=>{ area.value=State.draft||""; renderParas(area.value); RW.toast("Loaded.","info"); });
    $("#clearDraft", c).addEventListener("click", ()=>{ if(confirm("Clear the draft?")){ area.value=""; State.draft=""; RW.saveState(); renderParas(""); } });
    $("#exportMd", c).addEventListener("click", ()=> exportDraft(area.value, "md"));
    $("#exportHtml", c).addEventListener("click", ()=> exportDraft(area.value, "html"));
    $("#exportTxt", c).addEventListener("click", ()=> exportDraft(area.value, "txt"));
    renderParas(area.value);
  }

  function renderParas(text){
    const paras = text.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
    $("#paraCount").textContent = `${paras.length} paragraph${paras.length!==1?'s':''}`;
    const box = $("#paraList");
    if(!paras.length){ box.innerHTML = `<div class="empty" style="padding:20px">Start typing above. Paragraphs are split on blank lines.</div>`; return; }
    box.innerHTML = paras.map((p,i)=>{
      const f = checkParagraph(p);
      const cls = f.flags.length? "flagged" : "clean";
      return `<div class="ws-para ${cls}">
        <div class="flex gap-sm wrap" style="margin-bottom:4px">
          <span class="badge badge-muted">¶${i+1}</span>
          ${f.flags.length? f.flags.map(fl=>`<span class="badge ${fl.sev==='high'?'badge-danger':fl.sev==='med'?'badge-warning':'badge-muted'}">${esc(fl.label)}</span>`).join("") : `<span class="badge badge-success">✓ clean</span>`}
          <span class="small muted" style="margin-left:auto">${f.wordCount} words · ${f.sentenceCount} sentences · σ-len ${f.stdevLen.toFixed(1)}</span>
        </div>
        <textarea>${esc(p)}</textarea>
      </div>`;
    }).join("");
    $$(".ws-para textarea", box).forEach(()=>{
      // note: we don't bind per-paragraph edits back to state to avoid conflicts
      // with the master textarea; the master textarea is the source of truth.
    });
  }

  function exportDraft(text, fmt){
    const stamp = new Date().toISOString().slice(0,10);
    let blob, name;
    if(fmt==="md"){
      const md = `# Research Draft — ${stamp}\n\n> Generated in Research Workstation. Verify all citations against source papers.\n\n${text}\n`;
      blob = new Blob([md], {type:"text/markdown"}); name="research-draft.md";
    } else if(fmt==="html"){
      const body = text.split(/\n\s*\n/).filter(Boolean).map(p=>`<p>${esc(p).replace(/\n/g,"<br>")}</p>`).join("\n");
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Research Draft ${stamp}</title><style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;line-height:1.6;padding:0 20px}p{text-indent:0;margin:0 0 1em}</style></head><body>${body}</body></html>`;
      blob = new Blob([html], {type:"text/html"}); name="research-draft.html";
    } else {
      blob = new Blob([text], {type:"text/plain"}); name="research-draft.txt";
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download=name; a.click();
    URL.revokeObjectURL(a.href);
    RW.toast("Exported.","success");
  }

  Object.assign(RW, { Workspace: { render, checkParagraph, CLICHES, PASSIVE_HINTS } });
})();
