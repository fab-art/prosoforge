/* ============================================================================
   Research Workstation — scraper-ui.js
   Render logic for the Web Scraper view. Uses RW.Scraper. Lets the user
   fetch a URL via a chosen CORS proxy, extract readable text, save it as a
   resource, and chat with it. Fair-use reading only.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, saveState, refreshCounts } = RW;

  function render(){
    const c = $("#content");
    c.innerHTML = `
      <div class="card">
        <div class="field">
          <label>URL to scrape</label>
          <div class="flex">
            <input class="input" id="scrapeUrl" placeholder="https://example.com/article">
            <button class="btn btn-primary" id="scrapeBtn">🕷️ Scrape</button>
          </div>
        </div>
        <div class="field">
          <label>CORS proxy (pick by availability — some are blocked in some networks)</label>
          <select class="select" id="proxySel" style="max-width:340px">
            <option value="jina" ${State.settings.scrapeProxy==='jina'?'selected':''}>r.jina.ai (recommended — readable text)</option>
            <option value="allorigins" ${State.settings.scrapeProxy==='allorigins'?'selected':''}>allorigins.win (raw HTML)</option>
            <option value="direct" ${State.settings.scrapeProxy==='direct'?'selected':''}>Direct fetch (CORS-enabled sites only)</option>
          </select>
        </div>
        <div class="notice notice-info"><span class="ic">🔒</span><div>Only the URL you enter leaves your browser (to a public proxy). Scraped text is stored locally. Respect the target site's terms of service and robots.txt — use this for fair-use research reading, not bulk harvesting.</div></div>
      </div>
      <div id="scrapeStatus"></div>
      <div class="between mb">
        <h3 style="margin:0">Saved resources <span class="badge badge-muted" id="resCount">${State.resources.length}</span></h3>
        <button class="btn btn-sm btn-danger" id="clearScrapes">Clear all</button>
      </div>
      <div id="scrapeList"></div>
    `;
    $("#proxySel", c).addEventListener("change", e=>{ State.settings.scrapeProxy = e.target.value; saveState(); });
    $("#scrapeBtn", c).addEventListener("click", async ()=>{
      const url = $("#scrapeUrl", c).value.trim();
      if(!url){ toast("Enter a URL.","error"); return; }
      const status = $("#scrapeStatus", c);
      const btn = $("#scrapeBtn", c);
      btn.disabled = true;
      status.innerHTML = `<div class="notice notice-info"><span class="spinner"></span><div>Fetching <code>${esc(url)}</code> via ${State.settings.scrapeProxy}…</div></div>`;
      try{
        const result = await RW.Scraper.scrapeUrl(url);
        RW.Scraper.addResource(result);
        RW.refreshCounts();
        status.innerHTML = `<div class="notice notice-success"><span class="ic">✅</span><div>Scraped ${result.text.length} chars from <b>${esc(result.title)}</b></div></div>`;
        renderScrapeList();
        toast("Saved scraped resource.","success");
      }catch(e){
        status.innerHTML = `<div class="notice notice-danger"><span class="ic">⚠️</span><div>Scrape failed: ${esc(e.message)}. Try a different proxy, or paste the text manually as a note.</div></div>`;
      }finally{ btn.disabled = false; }
    });
    $("#clearScrapes", c).addEventListener("click", ()=>{
      if(confirm("Clear all scraped resources?")){ State.resources = []; saveState(); RW.refreshCounts(); renderScrapeList(); }
    });
    renderScrapeList();
  }

  function renderScrapeList(){
    const box = $("#scrapeList");
    if(!box) return;
    const count = $("#resCount");
    if(count) count.textContent = State.resources.length;
    if(!State.resources.length){ box.innerHTML = `<div class="empty" style="padding:20px">No scraped resources yet. Enter a URL above.</div>`; return; }
    box.innerHTML = State.resources.map(r=>`
      <div class="card card-hover">
        <div class="between mb-sm">
          <div>
            <span class="source-pill src-scrape">scraped</span>
            <strong>${esc(r.title)}</strong>
          </div>
          <div class="flex gap-sm">
            <button class="btn btn-sm" data-chat-scrape="${r.id}">💬 Chat</button>
            <button class="btn btn-sm btn-danger" data-del="${r.id}">✕</button>
          </div>
        </div>
        <div class="small muted mb"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a> · ${r.text.length} chars · ${r.mode}</div>
        <details><summary>Show text</summary><pre class="small mono" style="max-height:300px;overflow:auto;white-space:pre-wrap;background:var(--surface-2);padding:8px;border-radius:4px">${esc(r.text.slice(0,4000))}${r.text.length>4000?'\n…':''}</pre></details>
      </div>
    `).join("");
    $$('[data-del]', box).forEach(b=> b.addEventListener("click", ()=>{
      RW.Scraper.removeResource(b.dataset.del); RW.refreshCounts(); renderScrapeList();
    }));
    $$('[data-chat-scrape]', box).forEach(b=> b.addEventListener("click", ()=>{
      State.activePaperId = b.dataset.chatScrape; RW.navigate("chat");
    }));
  }

  Object.assign(RW, { ScraperUI: { render, renderScrapeList } });
})();
