/* ============================================================================
   Research Workstation — scraper.js
   Web scraper: fetches a URL via a CORS proxy (r.jina.ai recommended,
   allorigins fallback, or direct for CORS-enabled sites), strips nav/scripts,
   extracts readable text, and saves it as a chat-able resource.
   For fair-use research reading only — respect site ToS & robots.txt.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, saveState, uid } = RW;

  async function scrapeUrl(rawUrl){
    const url = (rawUrl||"").trim();
    if(!/^https?:\/\//.test(url)) throw new Error("URL must start with http:// or https://");
    const mode = State.settings.scrapeProxy || "jina";
    let endpoint;
    if(mode==="jina"){
      endpoint = `https://r.jina.ai/${url}`;
    } else if(mode==="allorigins"){
      endpoint = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    } else { // direct
      endpoint = url;
    }
    const res = await fetch(endpoint);
    if(!res.ok) throw new Error("Proxy returned HTTP "+res.status);
    const text = await res.text();
    let clean = text;
    let title = rawUrl;

    if(mode==="jina"){
      // jina returns markdown; first "Title:" line if present
      const firstLine = text.split("\n").find(l=>l.trim().toLowerCase().startsWith("title:"));
      if(firstLine) title = firstLine.replace(/^title:\s*/i,"").trim();
      // strip common jina markdown headers we don't need
      clean = text.replace(/^Title:.*$/im, "")
                   .replace(/^URL Source:.*$/im, "")
                   .replace(/^Markdown Content:.*$/im, "")
                   .replace(/^Published Time:.*$/im, "")
                   .trim();
    } else {
      // HTML — extract readable text via DOMParser
      if(text.trim().startsWith("<")){
        try{
          const doc = new DOMParser().parseFromString(text, "text/html");
          doc.querySelectorAll("script,style,noscript,nav,footer,header,aside,form,iframe").forEach(e=>e.remove());
          const titleEl = doc.querySelector("title");
          if(titleEl && titleEl.textContent.trim()) title = titleEl.textContent.trim();
          const main = doc.querySelector("main, article, [role=main]") || doc.body;
          if(main){
            clean = Array.from(main.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre"))
              .map(e=>e.textContent.trim())
              .filter(t=>t.length>0)
              .join("\n\n");
          } else {
            clean = doc.body ? doc.body.textContent.replace(/\s+/g," ").trim() : text;
          }
        }catch(e){ /* keep raw */ }
      }
    }
    return {
      url,
      title: title.slice(0, 200),
      text: clean.slice(0, 80000), // cap to avoid localStorage overflow
      fetchedAt: Date.now(),
      mode,
    };
  }

  function addResource(result){
    const resource = { id: "scrape-"+uid(), ...result };
    State.resources.push(resource);
    saveState();
    return resource;
  }
  function removeResource(id){
    State.resources = State.resources.filter(r=>r.id!==id);
    saveState();
  }
  function getResource(id){ return State.resources.find(r=>r.id===id); }

  Object.assign(RW, {
    Scraper: { scrapeUrl, addResource, removeResource, getResource }
  });
})();
