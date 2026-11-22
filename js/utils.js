/* ============================================================================
   Research Workstation — utils.js
   Shared namespace, state, persistence, helpers, toasts, text utilities.
   Loaded first; all other modules attach to window.RW.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};

  const LS_KEY = "researchWorkstation.v2";

  const State = {
    papers: [],        // collected papers from search
    notes: [],         // resource/idea board notes
    citations: [],     // manual citation entries
    resources: [],     // scraped web resources
    documents: [],     // uploaded PDF/text documents
    draft: "",         // thesis workspace text
    pastDrafts: [],    // archived draft snapshots (for self-plagiarism check)
    settings: {
      sources: { crossref:true, openalex:true, semantic:true, arxiv:true, pubmed:false, doaj:false },
      citationStyle: "apa",
      scrapeProxy: "jina",
      webllmModel: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
      webllmEnabled: false,
    },
    activePaperId: null,
    activeDocId: null,
    currentRoute: "upload",
  };

  function loadState(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return;
      const s = JSON.parse(raw);
      // shallow-merge top-level keys (don't clobber functions, only data)
      ["papers","notes","citations","resources","documents","draft","pastDrafts","settings","activePaperId","activeDocId","currentRoute"].forEach(k=>{
        if(s[k]!==undefined) State[k]=s[k];
      });
      if(!State.pastDrafts) State.pastDrafts = [];
      if(!State.settings) State.settings = {sources:{},citationStyle:"apa",scrapeProxy:"jina",webllmModel:"Llama-3.2-1B-Instruct-q4f32_1-MLC",webllmEnabled:false};
      if(!State.settings.sources) State.settings.sources = {crossref:true,openalex:true,semantic:true,arxiv:true,pubmed:false,doaj:false};
      if(!State.settings.webllmModel) State.settings.webllmModel = "Llama-3.2-1B-Instruct-q4f32_1-MLC";
    }catch(e){ console.warn("loadState failed", e); }
  }
  function saveState(){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(State)); }
    catch(e){
      console.warn("saveState failed", e);
      // localStorage likely full — try saving without documents (which can be large)
      try{
        const lite = {...State, documents: State.documents.map(d=>({id:d.id,name:d.name,size:d.size,type:d.type,addedAt:d.addedAt, charCount:d.text?.length||0}))};
        localStorage.setItem(LS_KEY, JSON.stringify(lite));
        toast("Storage full — document text not persisted (metadata kept). Re-upload after restart.","error",5000);
      }catch(e2){
        toast("Storage blocked — changes may not persist.","error");
      }
    }
  }

  // ---- DOM helpers ----
  const $ = (sel, root=document)=>root.querySelector(sel);
  const $$ = (sel, root=document)=>Array.from(root.querySelectorAll(sel));
  const esc = (s)=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const uid = ()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  const debounce = (fn, ms=300)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

  function toast(msg, type="info", ms=3200){
    const el = document.createElement("div");
    el.className = "toast "+type; el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(()=>{ el.style.opacity="0"; setTimeout(()=>el.remove(), 300); }, ms);
  }

  // ---- text utilities ----
  function normalizeTitle(t){ return (t||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim(); }
  function dedupePapers(list){
    const seen = new Map();
    for(const p of list){
      const key = normalizeTitle(p.title);
      if(!key) continue;
      if(!seen.has(key)) seen.set(key, p);
      else if(!seen.get(key).abstract && p.abstract) seen.set(key, p);
    }
    return Array.from(seen.values());
  }
  function sentencesOf(text){
    if(!text) return [];
    const parts = text.replace(/\s+/g," ").match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];
    return parts.map(s=>s.trim()).filter(Boolean);
  }
  function wordsOf(text){ return (text||"").toLowerCase().split(/[^a-z0-9'-]+/).filter(w=>w.length>1); }
  function mean(a){ return a.length? a.reduce((x,y)=>x+y,0)/a.length : 0; }
  function stdev(a){ if(a.length<2) return 0; const m=mean(a); return Math.sqrt(mean(a.map(x=>(x-m)**2))); }

  const STOPWORDS = new Set(("the a an and or but in on at to for of with by from is are was were be been being this that these those it its as into such which who whom whose what when where why how not no can could should would may might must will shall do does did has have had i we you they he she them us our your their").split(" "));
  function contentTokens(text){ return wordsOf(text).filter(w=>!STOPWORDS.has(w) && w.length>2); }

  function stripTags(s){ return (s||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(); }

  // ---- export helpers ----
  function downloadBlob(content, filename, mime){
    const blob = new Blob([content], {type: mime});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    URL.revokeObjectURL(a.href);
  }

  // expose
  Object.assign(RW, {
    State, loadState, saveState,
    $, $$, esc, uid, debounce, toast,
    normalizeTitle, dedupePapers, sentencesOf, wordsOf, mean, stdev,
    STOPWORDS, contentTokens, stripTags,
    downloadBlob, LS_KEY,
    SOURCE_LABELS: {crossref:"CrossRef", openalex:"OpenAlex", semantic:"Semantic Scholar", arxiv:"arXiv", pubmed:"PubMed", doaj:"DOAJ"},
  });
})();
