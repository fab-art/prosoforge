/* ============================================================================
   Research Workstation — webllm.js
   WebLLM integration: loads a small LLM in-browser (via @mlc-ai/web-llm CDN),
   exposes a unified ask() that falls back to keyword retrieval when no model
   is loaded. All generation is local — no API keys, no server.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, toast, $ } = RW;

  // Curated model list (small + likely to download in reasonable time on
  // consumer hardware). Sizes are approximate download sizes.
  const MODELS = [
    { id:"Llama-3.2-1B-Instruct-q4f32_1-MLC", name:"Llama 3.2 1B", size:"~0.8 GB", note:"Smallest, fastest" },
    { id:"Llama-3.2-3B-Instruct-q4f16_1-MLC", name:"Llama 3.2 3B", size:"~1.8 GB", note:"Balanced" },
    { id:"Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name:"Qwen 2.5 1.5B", size:"~1.0 GB", note:"Multilingual" },
    { id:"Phi-3.5-mini-instruct-q4f16_1-MLC", name:"Phi 3.5 mini", size:"~2.2 GB", note:"Reasoning" },
    { id:"gemma-2-2b-it-q4f16_1-MLC", name:"Gemma 2 2B", size:"~1.4 GB", note:"Google" },
    { id:"SmolLM2-1.7B-Instruct-q4f16_1-MLC", name:"SmolLM2 1.7B", size:"~1.0 GB", note:"Lightweight" },
  ];

  let engine = null;
  let loading = false;
  let loadProgress = 0;
  let lastError = null;

  const WEBLLM_CDN = "https://esm.sh/@mlc-ai/web-llm@0.2.78";

  function statusEl(){ return $("#llmStatus"); }

  function setStatus(state, text){
    const el = statusEl();
    if(!el) return;
    el.className = "llm-status " + (state||"");
    const dot = el.querySelector(".dot") || (()=>{ const d=document.createElement("span"); d.className="dot"; el.insertBefore(d, el.firstChild); return d; })();
    el.innerHTML = `<span class="dot"></span> WebLLM: ${text}`;
  }

  function isReady(){ return !!engine && State.settings.webllmEnabled; }
  function isLoading(){ return loading; }
  function getModel(){ return State.settings.webllmModel; }
  function getModels(){ return MODELS; }

  // Dynamically import WebLLM from CDN (only when user opts in).
  async function ensureLib(){
    if(window.webllm) return window.webllm;
    try{
      const mod = await import(WEBLLM_CDN);
      window.webllm = mod;
      return mod;
    }catch(e){
      lastError = e.message;
      throw new Error("Could not load WebLLM library from CDN: "+e.message);
    }
  }

  async function load(modelId, onProgress){
    if(loading) { toast("Already loading a model…","info"); return; }
    if(engine && State.settings.webllmModel===modelId) { toast("Model already loaded.","info"); return; }
    loading = true;
    const progressCb = (report)=>{
      loadProgress = report.progress;
      const pct = Math.round(report.progress*100);
      setStatus("loading", `downloading ${pct}% — ${report.text||""}`);
      if(onProgress) onProgress(report);
    };
    try{
      setStatus("loading", "loading library…");
      const webllm = await ensureLib();
      setStatus("loading", "initializing model…");
      const useWorker = typeof Worker !== "undefined";
      engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: progressCb,
        ...(useWorker ? {} : {})
      });
      State.settings.webllmModel = modelId;
      State.settings.webllmEnabled = true;
      RW.saveState();
      setStatus("ok", `ready — ${shortName(modelId)}`);
      toast("WebLLM model loaded. Chat will now use local LLM.","success");
    }catch(e){
      lastError = e.message;
      setStatus("error", "failed — see console");
      toast("WebLLM load failed: "+e.message, "error", 6000);
      console.error("WebLLM load error:", e);
      State.settings.webllmEnabled = false;
    }finally{
      loading = false;
    }
  }

  async function unload(){
    if(engine){ try{ await engine.unload(); }catch(e){} }
    engine = null;
    State.settings.webllmEnabled = false;
    RW.saveState();
    setStatus("", "not loaded");
    toast("WebLLM model unloaded.","info");
  }

  function shortName(id){
    const m = MODELS.find(m=>m.id===id);
    return m? m.name : id;
  }

  // ---- unified ask(): LLM if loaded, else keyword fallback ----
  // opts: { system, context, question, maxTokens, temperature, stream, onToken, fallbackFn }
  async function ask(opts){
    const { system, context, question, maxTokens=400, temperature=0.3, stream=false, onToken, fallbackFn } = opts;
    if(isReady() && engine){
      // Build a grounded prompt
      const sys = system || "You are a careful research assistant. Answer using ONLY the provided context. If the context does not address the question, say 'The provided text does not address this question.' Do not invent facts, citations, or details.";
      const userMsg = context
        ? `Context:\n${context}\n\nQuestion: ${question}\n\nAnswer (grounded in the context above only):`
        : `Question: ${question}\n\nAnswer:`;
      try{
        if(stream){
          const chunks = [];
          const streamResp = await engine.chat.completions.create({
            messages:[
              {role:"system", content: sys},
              {role:"user", content: userMsg}
            ],
            temperature, max_tokens: maxTokens, stream: true,
          });
          for await(const chunk of streamResp){
            const delta = chunk.choices?.[0]?.delta?.content || "";
            if(delta){ chunks.push(delta); if(onToken) onToken(delta); }
          }
          return { text: chunks.join(""), source:"webllm", model: getModel() };
        } else {
          const resp = await engine.chat.completions.create({
            messages:[
              {role:"system", content: sys},
              {role:"user", content: userMsg}
            ],
            temperature, max_tokens: maxTokens,
          });
          return { text: resp.choices?.[0]?.message?.content || "", source:"webllm", model: getModel() };
        }
      }catch(e){
        console.warn("WebLLM inference failed, falling back:", e);
        toast("LLM error — using keyword fallback.","error");
      }
    }
    // keyword fallback
    if(fallbackFn){ return { text: fallbackFn(), source:"keyword" }; }
    return { text: "", source:"none" };
  }

  // ---- grounding: build a context string from top-k most relevant chunks ----
  // chunks: [{text, ...}] ; query: string ; k: number
  function rankChunks(chunks, query, k=4){
    const qTokens = new Set(RW.contentTokens(query));
    if(!qTokens.size) return chunks.slice(0, k);
    return chunks.map(c=>{
      const cTokens = new Set(RW.contentTokens(c.text));
      let overlap = 0;
      for(const t of qTokens) if(cTokens.has(t)) overlap++;
      return { c, score: qTokens.size? overlap/qTokens.size : 0, overlap };
    }).sort((a,b)=>b.score-a.score || b.overlap-a.overlap)
      .slice(0, k)
      .map(x=>x.c);
  }

  // Split a long doc into ~sentence-window chunks for retrieval.
  function chunkText(text, windowSize=4){
    const sents = RW.sentencesOf(text);
    const chunks = [];
    for(let i=0; i<sents.length; i+=windowSize){
      chunks.push({ text: sents.slice(i, i+windowSize).join(" "), idx: i });
    }
    return chunks;
  }

  function init(){
    if(State.settings.webllmEnabled && State.settings.webllmModel){
      setStatus("", `enabled — click to load ${shortName(State.settings.webllmModel)}`);
      // we do NOT auto-load (large download) — user triggers from Settings or Chat
    } else {
      setStatus("", "not loaded");
    }
  }

  Object.assign(RW, {
    WebLLM: {
      MODELS, load, unload, ask, rankChunks, chunkText,
      isReady, isLoading, getModel, getModels, init, setStatus, shortName,
    }
  });
})();
