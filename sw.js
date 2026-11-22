/* ============================================================================
   Research Workstation — sw.js
   Service worker for offline PWA caching. Caches the app shell (HTML/CSS/JS)
   for offline use; uses a network-first strategy for API/proxy calls (since
   those need fresh data) and cache-first for static assets.

   Note: WebLLM model weights and PDF.js are loaded from CDN on demand; they
   are NOT precached (too large). Once fetched, the browser HTTP cache handles
   them. The app itself works offline after first load.
============================================================================ */
const CACHE_VERSION = "rw-v9-2026-11-guided-flow";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/app.css",
  "./js/utils.js",
  "./js/webllm.js",
  "./js/citations.js",
  "./js/search.js",
  "./js/pdf.js",
  "./js/scraper.js",
  "./js/chat.js",
  "./js/gap.js",
  "./js/matrix.js",
  "./js/consensus.js",
  "./js/citecontext.js",
  "./js/simgraph.js",
  "./js/litmaps.js",
  "./js/flashcards.js",
  "./js/audio.js",
  "./js/explain.js",
  "./js/datalab.js",
  "./js/jenni.js",
  "./js/paperpal.js",
  "./js/deepsearch.js",
  "./js/writer.js",
  "./js/workspace.js",
  "./js/notes.js",
  "./js/cleaner.js",
  "./js/checks.js",
  "./js/integrity.js",
  "./js/search-ui.js",
  "./js/citations-ui.js",
  "./js/scraper-ui.js",
  "./js/upload.js",
  "./js/integrity-ui.js",
  "./js/matrix-ui.js",
  "./js/consensus-ui.js",
  "./js/citecontext-ui.js",
  "./js/simgraph-ui.js",
  "./js/litmaps-ui.js",
  "./js/flashcards-ui.js",
  "./js/datalab-ui.js",
  "./js/paperpal-ui.js",
  "./js/deepsearch-ui.js",
  "./js/settings.js",
  "./js/flow.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event)=>{
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache=> cache.addAll(APP_SHELL)).catch(e=>{
      console.warn("SW install: some assets failed to cache", e);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event)=>{
  event.waitUntil(
    caches.keys().then(keys=> Promise.all(
      keys.filter(k=>k!==CACHE_VERSION).map(k=> caches.delete(k))
    )).then(()=> self.clients.claim())
  );
});

self.addEventListener("fetch", (event)=>{
  const req = event.request;
  // Only handle GET
  if(req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isAppShellAsset = isSameOrigin && (
    APP_SHELL.includes(url.pathname) ||
    APP_SHELL.includes("./"+url.pathname) ||
    url.pathname === "/" ||
    url.pathname === "/index.html"
  );

  // App shell: cache-first (instant offline load)
  if(isAppShellAsset){
    event.respondWith(
      caches.match(req).then(cached=> cached || fetch(req).then(resp=>{
        const copy = resp.clone();
        caches.open(CACHE_VERSION).then(c=>c.put(req, copy));
        return resp;
      }).catch(()=> caches.match("./index.html")))
    );
    return;
  }

  // Cross-origin (academic APIs, CORS proxies, CDNs like PDF.js/WebLLM):
  // network-first, fall back to cache. We do NOT cache API responses by
  // default (they change), but if the network is down we'll serve whatever
  // we have.
  if(!isSameOrigin){
    event.respondWith(
      fetch(req).then(resp=>{
        // Cache successful CDN responses (e.g. PDF.js lib) for offline reuse,
        // but not transient API JSON.
        if(resp.ok && (url.hostname.includes("cdn.jsdelivr") || url.hostname.includes("esm.sh"))){
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then(c=> c.put(req, copy));
        }
        return resp;
      }).catch(()=> caches.match(req).then(c=> c || new Response("Offline and no cached copy.", {status:503})))
    );
    return;
  }

  // Default: try network, fall back to cache
  event.respondWith(
    fetch(req).catch(()=> caches.match(req).then(c=> c || caches.match("./index.html")))
  );
});
