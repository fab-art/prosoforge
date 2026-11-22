/* ============================================================================
   Research Workstation — flashcards-ui.js
   Flashcards UI (Phase 4b — Scholarcy reverse-engineering).
   Source picker (paper abstract / uploaded document / pasted text) →
   deterministic deck build → flip-card study view + optional WebLLM refinement
   (AI cards appended, tagged). Exports: Markdown, CSV. Decks persist in
   State.flashcards; a summary note can be pinned to the Resource Board.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, saveState } = RW;

  let deck = null;          // deck in view
  let srcText = "";         // text the deck was built from (for AI refine)

  function render(){
    const c = $("#content");
    const papers = (State.papers||[]).filter(p=>p.abstract && p.abstract.length>30);
    const docs = State.documents||[];
    const decks = State.flashcards||[];

    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div>
        <b>Flashcards</b> (Scholarcy-style) — turn a paper or document into a study deck: TL;DR, objective, methods, key findings, limitations, keywords, abbreviation glossary, reference extracts. <b>Deterministic first:</b> the heuristic path needs no model; every card shows the section it came from and its <b>verbatim source sentences</b>. Optional 🤖 WebLLM refinement <b>appends</b> AI cards (tagged, editable, never overwriting). Library papers are <b>abstract-level</b> — upload the PDF for full-text cards.
      </div></div>

      <div class="card">
        <label class="small muted">Source</label>
        <select class="input" id="fcSource" style="width:100%">
          <option value="paste">✍️ Paste text</option>
          ${docs.length? `<option value="doc">📄 Uploaded document (${docs.length})</option>`:""}
          ${papers.length? `<option value="paper">📚 Library paper — abstract only (${papers.length})</option>`:""}
        </select>
        <div id="fcSrcZone" class="mt"></div>
        <button class="btn btn-primary mt" id="fcBuild">🎴 Build deck</button>
        <div class="small muted mt" id="fcStatus"></div>
      </div>

      <div id="fcDeckWrap" class="mt"></div>

      <div class="card mt">
        <div class="between mb-sm"><b>Saved decks <span class="badge badge-muted">${decks.length}</span></b></div>
        <div id="fcDeckList"></div>
      </div>
    `;
    renderSrcZone();
    $("#fcSource", c).addEventListener("change", renderSrcZone);
    $("#fcBuild", c).addEventListener("click", build);
    renderDeck();
    renderDeckList();
  }

  function renderSrcZone(){
    const c = $("#content");
    const zone = $("#fcSrcZone", c);
    const mode = $("#fcSource", c).value;
    if(mode==="paste"){
      zone.innerHTML = `
        <div class="field"><label>Paste article text (abstract, or the whole paper)</label>
        <textarea class="textarea" id="fcPaste" rows="6" placeholder="Paste the paper text here…"></textarea></div>`;
    } else if(mode==="doc"){
      zone.innerHTML = `<select class="input" id="fcDoc">${(State.documents||[]).map(d=>`<option value="${esc(d.id)}">📄 ${esc(d.name)}</option>`).join("")}</select>
        <div class="small muted mt">Full extracted text (PDF pages are used; references only exist if the PDF includes them).</div>`;
    } else {
      zone.innerHTML = `<select class="input" id="fcPaper">${(State.papers||[]).filter(p=>p.abstract).map(p=>`<option value="${esc(p.id)}">📚 ${esc((p.title||"untitled").slice(0,80))} (${p.year||"—"})</option>`).join("")}</select>
        <div class="small muted mt">Abstract-level only — cards will say so. Upload the PDF in <b>Upload &amp; Chat</b> for full-text decks.</div>`;
    }
  }

  async function build(){
    const c = $("#content");
    const mode = $("#fcSource", c).value;
    let src = null;
    if(mode==="paste"){
      const t = $("#fcPaste", c).value.trim();
      if(t.length < 120){ toast("Paste at least a paragraph of text.","error"); return; }
      src = { title:"Pasted text", year:null, text:t, kind:"paste", sourceLabel:"pasted text" };
    } else if(mode==="doc"){
      const d = (State.documents||[]).find(x=>x.id===$("#fcDoc", c).value);
      if(!d){ toast("Pick a document.","error"); return; }
      src = { title:d.name, year:null, text:d.text||"", kind:"document", sourceLabel:"uploaded document" };
    } else {
      const p = (State.papers||[]).find(x=>x.id===$("#fcPaper", c).value);
      if(!p){ toast("Pick a paper.","error"); return; }
      src = { title:p.title, year:p.year, text:(p.abstract||"")+" "+(p.tldr? " TL;DR: "+p.tldr : ""), kind:"paper", sourceLabel:"library abstract" };
    }
    const btn = $("#fcBuild", c);
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Building…`;
    try{
      deck = RW.Flashcards.buildDeck(src);
      srcText = src.text;
      State.flashcards = State.flashcards||[];
      State.flashcards.unshift(deck);
      if(State.flashcards.length > 25) State.flashcards.length = 25;
      saveState();
      renderDeck(); renderDeckList();
      $("#fcStatus", c).textContent = `Deck built: ${deck.cards.length} cards${deck.abstractLevel? " (abstract-level)":""}. Saved below.`;
      toast("Deck ready — saved in this browser.","success");
    }catch(e){
      toast(e.message,"error",5000);
    }finally{
      btn.disabled = false; btn.innerHTML = "🎴 Build deck";
    }
  }

  function renderDeck(){
    const c = $("#content");
    const wrap = $("#fcDeckWrap", c);
    if(!wrap) return;
    if(!deck){ wrap.innerHTML = ""; return; }
    const llmReady = RW.WebLLM.isReady();
    wrap.innerHTML = `
      <div class="card">
        <div class="between mb-sm wrap" style="gap:8px">
          <div style="min-width:0"><b>🎴 ${esc(deck.title)}</b> ${deck.year?`<span class="muted small">(${esc(deck.year)})</span>`:""} ${deck.abstractLevel?`<span class="badge badge-warning">abstract-level</span>`:`<span class="badge badge-success">full text</span>`}</div>
          <div class="flex gap-sm wrap">
            <button class="btn btn-sm" id="fcFlipAll">🔄 Flip all</button>
            <button class="btn btn-sm" id="fcAI" ${llmReady?"":"disabled title=\"Load a WebLLM model in Settings first\""}>🤖 AI refine</button>
            <button class="btn btn-sm" id="fcMD">⬇️ .md</button>
            <button class="btn btn-sm" id="fcCSV">⬇️ .csv</button>
            <button class="btn btn-sm" id="fcPin">📌 Pin to board</button>
          </div>
        </div>
        ${!llmReady? `<div class="small muted mb-sm">🤖 AI refine needs a WebLLM model (Settings). The deterministic deck below works without one.</div>`:""}
        <div class="small muted mb-sm">Click a card to flip it. ${deck.cards.length} cards.</div>
        <div class="fc-grid" id="fcGrid">
          ${deck.cards.map((card,i)=>`
            <div class="fc-card" data-i="${i}" tabindex="0">
              <div class="fc-inner">
                <div class="fc-face fc-front">
                  <div class="small muted">${esc(kindLabel(card.kind))}</div>
                  <div>${esc(card.front)}</div>
                  <div class="small muted mt">click to flip ↻</div>
                </div>
                <div class="fc-face fc-back">
                  <div class="small" style="white-space:pre-wrap">${esc(card.back)}</div>
                  <div class="small muted mt">§ ${esc(card.section)}${card.ai? " · 🤖 AI-refined — verify":""}</div>
                  ${card.source && card.source.length? `<details class="small mt-sm"><summary class="muted">source sentences</summary><div class="muted" style="white-space:pre-wrap">${esc(card.source.join("\n"))}</div></details>`:""}
                </div>
              </div>
            </div>`).join("")}
        </div>
      </div>
    `;
    $$(".fc-card", wrap).forEach(el=>{
      el.addEventListener("click", ()=> el.classList.toggle("flipped"));
      el.addEventListener("keydown", e=>{ if(e.key===" "||e.key==="Enter"){ e.preventDefault(); el.classList.toggle("flipped"); } });
    });
    $("#fcFlipAll", wrap).addEventListener("click", ()=>{
      const cards = $$(".fc-card", wrap);
      const anyFront = cards.some(el=>!el.classList.contains("flipped"));
      cards.forEach(el=> el.classList.toggle("flipped", anyFront));
    });
    $("#fcMD", wrap).addEventListener("click", ()=>{
      RW.downloadBlob(RW.Flashcards.deckToMarkdown(deck), `flashcards-${deck.id}.md`, "text/markdown");
    });
    $("#fcCSV", wrap).addEventListener("click", ()=>{
      RW.downloadBlob(RW.Flashcards.deckToCSV(deck), `flashcards-${deck.id}.csv`, "text/csv");
    });
    $("#fcPin", wrap).addEventListener("click", pinToBoard);
    const aiBtn = $("#fcAI", wrap);
    if(aiBtn && llmReady) aiBtn.addEventListener("click", aiRefine);
  }

  function kindLabel(k){
    return { tldr:"summary", aim:"objective", methods:"methods", findings:"findings",
      limitations:"limitations", keywords:"keywords", abbrev:"glossary",
      refs:"references", ai:"🤖 AI card" }[k] || k;
  }

  async function aiRefine(){
    const c = $("#content");
    const btn = $("#fcAI", c);
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Refining…`;
    try{
      const aiCards = await RW.Flashcards.refineWithLLM(deck, srcText);
      if(aiCards.length){
        deck.cards.push(...aiCards);
        deck.aiRefined = true;
        const saved = (State.flashcards||[]).find(d=>d.id===deck.id);
        if(saved){ saved.cards = deck.cards; saved.aiRefined = true; }
        saveState();
        renderDeck(); renderDeckList();
        toast(`${aiCards.length} AI cards appended (tagged 🤖). Verify before use.`,"success",5000);
      } else toast("Model produced no usable cards — deterministic deck kept.","error");
    }catch(e){
      toast(e.message,"error",5000);
    }finally{
      btn.disabled = false; btn.innerHTML = "🤖 AI refine";
    }
  }

  function pinToBoard(){
    const body = deck.cards.map(c2=>`■ ${c2.front}\n${c2.back}`).join("\n\n");
    State.notes.push({
      id: RW.uid(),
      title: `🎴 Flashcards — ${deck.title}`,
      body: body.slice(0, 3800),
      tags: ["flashcards"],
      createdAt: Date.now(),
    });
    saveState(); RW.refreshCounts();
    toast("Summary note pinned to the Resource Board.","success");
  }

  function renderDeckList(){
    const c = $("#content");
    const box = $("#fcDeckList", c);
    if(!box) return;
    const decks = State.flashcards||[];
    if(!decks.length){ box.innerHTML = `<div class="empty" style="padding:16px">No decks yet.</div>`; return; }
    box.innerHTML = decks.map(d=>`
      <div class="between small" style="padding:6px 0;border-bottom:1px dashed var(--border)">
        <span style="min-width:0">🎴 ${esc((d.title||"untitled").slice(0,70))} <span class="muted">· ${d.cards.length} cards${d.aiRefined?" · 🤖":""} · ${new Date(d.createdAt).toLocaleDateString()}</span></span>
        <span class="flex gap-sm">
          <button class="btn btn-sm" data-fc-load="${d.id}">Load</button>
          <button class="btn btn-sm btn-danger" data-fc-del="${d.id}">✕</button>
        </span>
      </div>`).join("");
    $$("[data-fc-load]", box).forEach(b=> b.addEventListener("click", ()=>{
      deck = (State.flashcards||[]).find(d=>d.id===b.dataset.fcLoad);
      if(deck){ srcText = ""; renderDeck(); toast("Deck loaded.","info",1800); }
    }));
    $$("[data-fc-del]", box).forEach(b=> b.addEventListener("click", ()=>{
      State.flashcards = (State.flashcards||[]).filter(d=>d.id!==b.dataset.fcDel);
      if(deck && deck.id===b.dataset.fcDel) deck = null;
      saveState(); renderDeck(); renderDeckList();
    }));
  }

  Object.assign(RW, { FlashcardsUI: { render } });
})();
