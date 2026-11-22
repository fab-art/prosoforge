/* ============================================================================
   Research Workstation — app.js
   Router, init, theme, sidebar, navigation. Loaded last (after all modules
   have attached to window.RW).
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, loadState, saveState, $, $$ } = RW;

  const ROUTES = {
    upload:    { title:"Upload & Chat",            render: ()=>RW.Upload.render() },
    search:    { title:"Literature Search",        render: ()=>RW.SearchUI.render() },
    deepsearch:{ title:"Deep Search",              render: ()=>RW.DeepSearchUI.render() },
    chat:      { title:"Paper Q&A",                render: ()=>RW.Chat.render() },
    audio:     { title:"Audio Overview",           render: ()=>RW.Audio.render() },
    gap:       { title:"Research Gap Finder",      render: ()=>RW.Gap.render() },
    matrix:    { title:"Evidence Matrix",           render: ()=>RW.MatrixUI.render() },
    consensus: { title:"Agreement Meter",           render: ()=>RW.ConsensusUI.render() },
    citecontext: { title:"Citation Context",        render: ()=>RW.CiteContextUI.render() },
    simgraph:  { title:"Similarity Graph",          render: ()=>RW.SimGraphUI.render() },
    timeline:  { title:"Citation Timeline",         render: ()=>RW.LitmapsUI.render() },
    flashcards:{ title:"Flashcards",                render: ()=>RW.FlashcardsUI.render() },
    writer:    { title:"AI Writer",                 render: ()=>RW.Writer.render() },
    pad:       { title:"Write Pad (autocomplete)", render: ()=>RW.Jenni.render() },
    workspace: { title:"Thesis Workspace",         render: ()=>RW.Workspace.render() },
    notes:     { title:"Resource & Idea Board",    render: ()=>RW.Notes.render() },
    citations: { title:"Citation Manager",          render: ()=>RW.CitationsUI.render() },
    scraper:   { title:"Web Scraper",              render: ()=>RW.ScraperUI.render() },
    cleaner:   { title:"Document Cleaner",         render: ()=>RW.Cleaner.render() },
    review:    { title:"Integrity Review",          render: ()=>RW.IntegrityUI.render() },
    checks:    { title:"Checks Summary",           render: ()=>RW.Checks.render() },
    paperpal:  { title:"Paperpal Consistency",     render: ()=>RW.PaperpalUI.render() },
    datalab:   { title:"Data Lab",                 render: ()=>RW.DataLabUI.render() },
    settings:  { title:"Settings",                  render: ()=>RW.Settings.render() },
  };

  function navigate(route){
    if(!ROUTES[route]) route = "upload";
    State.currentRoute = route;
    $$(".nav-btn").forEach(b=> b.classList.toggle("active", b.dataset.route===route));
    const r = ROUTES[route];
    $("#viewTitle").textContent = r.title;
    $("#topActions").innerHTML = "";
    $("#content").innerHTML = "";
    try{ r.render(); }catch(e){ console.error("Route render error:", e); $("#content").innerHTML = `<div class="notice notice-danger"><span class="ic">⚠️</span><div>Failed to render ${r.title}: ${e.message}</div></div>`; }
    closeSidebar();
    window.scrollTo(0, 0);
  }

  function refreshCounts(){
    const set = (id, n)=>{ const el = $("#"+id); if(el) el.textContent = n; };
    set("cnt-papers", State.papers.length);
    set("cnt-notes", State.notes.length);
    set("cnt-cites", State.citations.length);
    set("cnt-scrape", State.resources.length);
  }

  function initTheme(){
    const saved = localStorage.getItem("rw.theme");
    const theme = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    $("#themeIcon").textContent = theme==="dark" ? "☀️" : "🌙";
    $("#themeLabel").textContent = theme==="dark" ? "Light mode" : "Dark mode";
  }
  function toggleTheme(){
    const cur = document.documentElement.dataset.theme;
    const next = cur==="dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("rw.theme", next);
    $("#themeIcon").textContent = next==="dark" ? "☀️" : "🌙";
    $("#themeLabel").textContent = next==="dark" ? "Light mode" : "Dark mode";
  }
  function openSidebar(){ $("#sidebar").classList.add("open"); $("#scrim").classList.add("show"); }
  function closeSidebar(){ $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("show"); }

  function registerSW(){
    if("serviceWorker" in navigator){
      window.addEventListener("load", ()=>{
        navigator.serviceWorker.register("sw.js").catch(e=>{
          console.warn("SW registration failed:", e);
        });
      });
    }
  }

  function init(){
    loadState();
    initTheme();
    $$(".nav-btn").forEach(b=> b.addEventListener("click", ()=> navigate(b.dataset.route)));
    $("#themeToggle").addEventListener("click", toggleTheme);
    $("#menuToggle").addEventListener("click", openSidebar);
    $("#scrim").addEventListener("click", closeSidebar);
    refreshCounts();
    RW.WebLLM.init();
    navigate(State.currentRoute || "upload");
    registerSW();
  }

  Object.assign(RW, { navigate, refreshCounts, initTheme, toggleTheme, openSidebar, closeSidebar, ROUTES });
  document.addEventListener("DOMContentLoaded", init);
})();
