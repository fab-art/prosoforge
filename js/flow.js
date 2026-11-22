/* ============================================================================
   Research Workstation — flow.js
   Guided research flow: ordered step list, landing/home page, stepper banner
   + prev/next footer injected around each flow step's rendered content.
   Pure additive layer — does not touch any existing tool module.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { $, esc, State } = RW;

  // Canonical research flow, in order. `route` must match a key in app.js ROUTES.
  const STEPS = [
    { route:"gap",        n:1,  group:"Scope the gap",            icon:"🔭", title:"Research Gap Finder",
      blurb:"Start here. Name your topic area and surface heuristic gap signals (recency, geography, source diversity, self-reported limitations) before you spend hours searching." },
    { route:"search",     n:2,  group:"Scope the gap",            icon:"🔍", title:"Literature Search",
      blurb:"Search 6 free academic APIs at once and build your working paper library." },
    { route:"deepsearch", n:3,  group:"Scope the gap",            icon:"🌀", title:"Deep Search",
      blurb:"Run an iterative, gap-aware search loop that targets what your library is still missing." },
    { route:"upload",     n:4,  group:"Read & collect evidence",  icon:"📄", title:"Upload & Chat",
      blurb:"Upload PDFs or text and chat with them directly, grounded in the extracted text." },
    { route:"matrix",     n:5,  group:"Read & collect evidence",  icon:"🔬", title:"Evidence Matrix",
      blurb:"Screen and extract methodology, sample size, findings and limitations into one comparison table." },
    { route:"consensus",  n:6,  group:"Read & collect evidence",  icon:"⚖️", title:"Agreement Meter",
      blurb:"Check whether the literature agrees, disagrees, or is mixed on a yes/no question." },
    { route:"citecontext",n:7,  group:"Read & collect evidence",  icon:"🔗", title:"Citation Context",
      blurb:"See whether later papers support, contradict, or merely mention your key sources." },
    { route:"simgraph",   n:8,  group:"Read & collect evidence",  icon:"🕸️", title:"Similarity Graph",
      blurb:"Visualize how your collected papers cluster by bibliographic coupling." },
    { route:"timeline",   n:9,  group:"Read & collect evidence",  icon:"🗺️", title:"Citation Timeline",
      blurb:"See how citations of your seed papers have grown over time, layer by layer." },
    { route:"flashcards", n:10, group:"Read & collect evidence",  icon:"🎴", title:"Flashcards",
      blurb:"Turn any paper into a study deck: objective, methods, findings, limitations, glossary." },
    { route:"writer",     n:11, group:"Write",                    icon:"✍️", title:"AI Writer",
      blurb:"Draft paragraphs grounded strictly in your collected library, with real in-text citations." },
    { route:"pad",        n:12, group:"Write",                    icon:"🪄", title:"Write Pad",
      blurb:"Write with grounded sentence suggestions and one-keystroke citation insertion." },
    { route:"workspace",  n:13, group:"Write",                    icon:"📝", title:"Thesis Workspace",
      blurb:"Draft in a full editor with live style checks for sentence uniformity and passive voice." },
    { route:"paperpal",   n:14, group:"Polish & verify",          icon:"🎓", title:"Paperpal Consistency",
      blurb:"Catch abbreviation, spelling-dialect, unit-spacing and style inconsistencies." },
    { route:"cleaner",    n:15, group:"Polish & verify",          icon:"🧹", title:"Document Cleaner",
      blurb:"Tidy whitespace and smart quotes, and review an advisory 'AI tells' panel." },
    { route:"review",     n:16, group:"Polish & verify",          icon:"🛡️", title:"Integrity Review",
      blurb:"A final self-plagiarism and consistency pass against your own earlier drafts." },
    { route:"checks",     n:17, group:"Polish & verify",          icon:"✅", title:"Checks Summary",
      blurb:"One rollup of every flag raised across the workspace before you submit." },
  ];

  const STEP_BY_ROUTE = {};
  STEPS.forEach(s=> STEP_BY_ROUTE[s.route] = s);

  function isFlowRoute(route){ return !!STEP_BY_ROUTE[route]; }
  function stepIndex(route){ return STEPS.findIndex(s=>s.route===route); }

  function stepperHTML(route){
    const idx = stepIndex(route);
    const items = STEPS.map((s,i)=>{
      const cls = i===idx ? "current" : (i<idx ? "done" : "");
      return `<button class="fs-item ${cls}" data-goto="${s.route}" title="${esc(s.title)}"><span class="dot"></span>${s.n}. ${esc(s.title)}</button>`;
    }).join("");
    return `<div class="flow-stepper">${items}</div>`;
  }

  function bannerHTML(step){
    return `<div class="flow-banner"><span class="ft">Research flow · step ${step.n} of ${STEPS.length} · ${esc(step.group)}</span></div>`;
  }

  function footerHTML(route){
    const idx = stepIndex(route);
    const prev = STEPS[idx-1], next = STEPS[idx+1];
    const prevBtn = prev ? `<button class="btn" data-goto="${prev.route}">← ${esc(prev.title)}</button>` : `<button class="btn" data-goto="home">← Back to home</button>`;
    const nextBtn = next ? `<button class="btn btn-primary" data-goto="${next.route}">${esc(next.title)} →</button>` : `<button class="btn btn-primary" data-goto="home">Finish → Back to home</button>`;
    return `<div class="flow-nav-footer">${prevBtn}${nextBtn}</div>`;
  }

  // Wrap a step's rendered content with the stepper banner (prepended) and
  // the prev/next footer (appended). Called from app.js's navigate().
  function decorate(route){
    const step = STEP_BY_ROUTE[route];
    if(!step) return;
    const content = $("#content");
    const top = document.createElement("div");
    top.innerHTML = bannerHTML(step) + stepperHTML(route);
    content.insertBefore(top, content.firstChild);
    const bottom = document.createElement("div");
    bottom.innerHTML = footerHTML(route);
    content.appendChild(bottom);
    content.querySelectorAll("[data-goto]").forEach(b=>{
      b.addEventListener("click", ()=> RW.navigate(b.dataset.goto));
    });
  }

  function featureCard(ic, title, desc){
    return `<div class="feature-card"><span class="ic">${ic}</span><b>${esc(title)}</b><span>${esc(desc)}</span></div>`;
  }

  function renderHome(){
    const papers = State.papers.length, notes = State.notes.length, docs = State.documents.length;
    const started = papers>0 || docs>0 || (State.draft && State.draft.length>0);
    const continueRoute = started ? (State.currentRoute && isFlowRoute(State.currentRoute) ? State.currentRoute : "search") : "gap";
    const continueStep = STEP_BY_ROUTE[continueRoute] || STEPS[0];

    const groups = [];
    let lastGroup = null;
    STEPS.forEach(s=>{
      if(s.group !== lastGroup){ groups.push({group:s.group, steps:[]}); lastGroup = s.group; }
      groups[groups.length-1].steps.push(s);
    });

    const overviewHTML = groups.map(g=>`
      <div class="section-head"><h2>${esc(g.group)}</h2></div>
      <div class="flow-overview">
        ${g.steps.map(s=>`
          <div class="flow-overview-step" data-goto="${s.route}">
            <div class="n">Step ${s.n}</div>
            <div class="t">${s.icon} ${esc(s.title)}</div>
            <div class="d">${esc(s.blurb)}</div>
          </div>`).join("")}
      </div>`).join("");

    const html = `
      <div class="hero">
        <div class="eyebrow">FREE · IN-BROWSER · PRIVATE BY DESIGN</div>
        <h1>Your research, start to finish.</h1>
        <p>A single guided flow — from finding a research gap to a polished, checked draft — built on free literature APIs and an in-browser AI. Nothing you upload ever leaves this device.</p>
        <div class="hero-actions">
          <button class="btn btn-primary" data-goto="gap">🔭 Start a new research flow</button>
          ${started ? `<button class="btn" data-goto="${continueStep.route}">Continue: ${esc(continueStep.title)} →</button>` : ``}
        </div>
      </div>

      <div class="section-head"><h2>Your workspace</h2><span>${papers} papers · ${docs} documents · ${notes} notes saved</span></div>
      <div class="feature-grid mb">
        ${featureCard("🔍","Literature Search", papers ? `${papers} papers collected so far` : "No papers collected yet — step 2 of the flow")}
        ${featureCard("📄","Uploaded documents", docs ? `${docs} document${docs===1?"":"s"} ready to chat with` : "No documents uploaded yet")}
        ${featureCard("📝","Thesis draft", (State.draft&&State.draft.length) ? `${State.draft.length.toLocaleString()} characters drafted` : "No draft started yet")}
      </div>

      ${overviewHTML}

      <div class="section-head"><h2>Why it's different</h2></div>
      <div class="feature-grid">
        ${featureCard("🪪","Honest by design","Every AI or heuristic output carries a visible DRAFT or ADVISORY badge — nothing is presented as settled fact.")}
        ${featureCard("🔒","Private by default","Documents, drafts, notes and citations stay in your browser. Only search queries and scrape URLs leave the device.")}
        ${featureCard("🧠","Works with or without AI","Every tool has a deterministic fallback, so you get useful output even with WebLLM switched off.")}
      </div>
    `;
    $("#content").innerHTML = html;
    $("#content").querySelectorAll("[data-goto]").forEach(b=>{
      b.addEventListener("click", ()=> RW.navigate(b.dataset.goto));
    });
  }

  Object.assign(RW, { Flow: { STEPS, STEP_BY_ROUTE, isFlowRoute, stepIndex, decorate, renderHome } });
})();
