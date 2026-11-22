/* ============================================================================
   Research Workstation — litmaps.js
   PHASE 4a of the feature roadmap: reverse-engineering of **Litmaps** (temporal
   citation maps + new-citation alerts).

   Litmaps' mechanism: a seed paper's citation network layered over time, plus
   email alerts when new papers cite your "core set". Alerts need a server —
   a pure PWA cannot push, so our check is a manual diff (stated in UI).

   Our version — the **Citation Timeline**:
   - Seed → OpenAlex. Three API calls:
       1) seed details (year, references)
       2) generation-1: works citing the seed (`filter=cites:`)
       3) generation-2: works citing the top gen-1 citers (`cites:W1|W2|…`)
   - Depth = BFS distance from the seed over real citation edges (gen-2 papers
     that also cite the seed collapse to depth 1). Layers like Litmaps:
     0 = the seed · 1 = cite it directly · 2 = cite the citers.
   - Layout: x = publication year, y = depth band, deterministic jitter inside
     bands (hash of id) so re-renders are stable. Node size = citations.
   - Edge data is REAL (each node's `referenced_works` decides its edges), not
     inferred — but bounded by what the API pages return, so the map is a
     *sample* of the network, not the complete graph. Stated in UI.

   Honest limits (mirrored in UI): sample not census; abstract-free nodes have
   no year and are skipped from the canvas; alerts are manual ("check" button),
   snapshots stored in localStorage per seed.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};

  const SELECT_FIELDS = "id,display_name,publication_year,primary_location,referenced_works,cited_by_count";
  // How many gen-1 citers double as seeds for the generation-2 query.
  const GEN2_SEEDS = 20;
  const GEN2_PER_PAGE = 100;

  /* Parse an OpenAlex work (selected fields) into a timeline node. */
  function toNode(w, isSeed){
    return {
      id: (w.id||"").split("/").pop(),
      title: w.display_name || "(untitled)",
      year: w.publication_year || null,
      venue: (w.primary_location?.source?.display_name) || "",
      doi: w.doi ? w.doi.replace("https://doi.org/","") : "",
      url: w.doi || w.primary_location?.landing_page_url || "",
      citedByCount: w.cited_by_count || 0,
      refs: new Set((w.referenced_works||[]).map(r=>String(r).split("/").pop())),
      isSeed: !!isSeed,
    };
  }

  /* Fetch generation-1 citing works (sorted, capped). */
  async function fetchGen1(seedPaper, { limit=100, sort="cited_by_count" }={}){
    const oaId = await RW.CiteContext.resolveOpenAlexId(seedPaper);
    const data = await RW.CiteContext.oaFetch(
      `https://api.openalex.org/works?filter=cites:${oaId}&per-page=${Math.min(limit,200)}&sort=${sort}:desc&select=${SELECT_FIELDS}`);
    return (data.results||[]).map(w=>toNode(w,false));
  }

  /* Build the layered timeline for a seed paper. */
  async function buildTimeline(seedPaper, opts={}){
    const { citers=60 } = opts;
    const oaFetch = RW.CiteContext.oaFetch;
    const oaId = await RW.CiteContext.resolveOpenAlexId(seedPaper);

    // 1) seed details
    const seedWork = await oaFetch(`https://api.openalex.org/works/${oaId}?select=${SELECT_FIELDS}`);
    const seed = toNode(seedWork, true);

    // 2) generation-1 citers
    const gen1 = await fetchGen1(seedPaper, { limit: citers, sort:"cited_by_count" });

    // 3) generation-2: citing the top gen-1 citers
    const gen1Ids = gen1.slice(0, GEN2_SEEDS).map(n=>n.id);
    let gen2raw = [];
    if(gen1Ids.length){
      const g2 = await oaFetch(
        `https://api.openalex.org/works?filter=cites:${gen1Ids.join("|")}&per-page=${GEN2_PER_PAGE}&sort=cited_by_count:desc&select=${SELECT_FIELDS}`);
      gen2raw = (g2.results||[]).map(w=>toNode(w,false));
    }

    // assemble node set (dedupe; gen2 nodes that are also gen1 collapse to gen1)
    const byId = new Map();
    gen1.forEach(n=>byId.set(n.id, n));
    const gen2 = [];
    gen2raw.forEach(n=>{ if(!byId.has(n.id)){ byId.set(n.id, n); gen2.push(n); } });
    const nodes = [seed, ...gen1, ...gen2];
    const idx = new Map(nodes.map((n,i)=>[n.id, i]));

    // real edges: each node → every node-set work it references
    const edges = [];
    nodes.forEach((n,i)=>{
      n.refs.forEach(r=>{
        const j = idx.get(r);
        if(j!==undefined && j!==i) edges.push({ from:i, to:j }); // i cites j
      });
    });

    // depth layers: BFS from seed over reverse citation edges (who cites whom)
    const depth = computeDepths(nodes, edges, 0);
    assignLayout(nodes, depth);

    const stats = {
      gen1: gen1.length, gen2: gen2.length,
      edges: edges.length,
      noYear: nodes.filter(n=>!n.isSeed && !n.year).length,
    };
    return { seed, nodes, edges, depth, stats, builtAt: Date.now() };
  }

  /* BFS distance from the seed over "cited-by" direction: depth 1 = direct
     citers, depth 2 = works citing the citers, … Nodes with no path (shouldn't
     occur) get Infinity and are excluded by the UI. */
  function computeDepths(nodes, edges, seedIdx){
    const depth = new Array(nodes.length).fill(Infinity);
    depth[seedIdx] = 0;
    // reverse adjacency: cited → citing
    const citing = nodes.map(()=>[]);
    edges.forEach(({from,to})=> citing[to].push(from));
    const queue = [seedIdx];
    while(queue.length){
      const cur = queue.shift();
      for(const nxt of citing[cur]){
        if(depth[nxt] === Infinity){ depth[nxt] = depth[cur] + 1; queue.push(nxt); }
      }
    }
    return depth;
  }

  /* Layout: x = year (with intra-year jitter), y = depth band. Deterministic
     via a hash of the node id — re-renders are stable. Mutates nodes (x,y). */
  function assignLayout(nodes, depth){
    const years = nodes.map(n=>n.year).filter(Boolean);
    const minYear = Math.min(...years), maxYear = Math.max(...years);
    const span = Math.max(maxYear - minYear, 1);
    const maxDepth = Math.max(...nodes.map((n,i)=>depth[i]), 3);
    nodes.forEach((n,i)=>{
      if(n.isSeed){ n.x = 0.5; n.y = 0.07; return; }
      if(!n.year || depth[i] === Infinity){ n.x = null; n.y = null; return; }
      const h = hashId(n.id);
      const yearFrac = (n.year - minYear) / span;
      // jitter inside the year column, ±0.6 of one column's width
      const colW = 1/span;
      n.x = Math.min(0.995, Math.max(0.005, yearFrac + ((h % 100)/100 - 0.5) * colW * 0.6));
      // depth band top→bottom, jitter inside band
      const band = Math.min(depth[i], maxDepth);
      const bandH = 0.86 / (maxDepth + 1);
      n.y = 0.11 + band*bandH + bandH*0.5 + (((h>>7) % 100)/100 - 0.5) * bandH * 0.5;
    });
    return { minYear, maxYear, maxDepth };
  }

  function hashId(id){
    let h = 0;
    const s = String(id||"");
    for(let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  /* ---- manual alerts (Litmaps' email alerts can't exist without a server) ----
     A snapshot of citing-work ids is stored per seed; "check" refetches the
     most recent citers and diffs. Returns the new papers since last check. */
  function snapshotKey(seedId){ return "lm:" + seedId; }

  function getSnapshot(seedId){
    return (RW.State.litmapsSnapshots||{})[snapshotKey(seedId)] || null;
  }

  function saveSnapshot(seedId, ids){
    RW.State.litmapsSnapshots = RW.State.litmapsSnapshots || {};
    RW.State.litmapsSnapshots[snapshotKey(seedId)] = { ids: ids.slice(0, 500), lastChecked: Date.now() };
    RW.saveState();
  }

  /* Diff a fresh id list against the stored snapshot.
     First run → establishes baseline, no "new" papers reported. */
  function diffCitingPapers(seedId, freshNodes){
    const prev = getSnapshot(seedId);
    const freshIds = freshNodes.map(n=>n.id);
    const prevSet = new Set(prev ? prev.ids : []);
    const added = prev ? freshNodes.filter(n=>!prevSet.has(n.id)) : [];
    saveSnapshot(seedId, freshIds);
    return {
      firstRun: !prev,
      added,
      lastChecked: prev ? prev.lastChecked : null,
      checkedNow: Date.now(),
      known: freshIds.length,
    };
  }

  Object.assign(RW, {
    Litmaps: {
      buildTimeline, fetchGen1, computeDepths, assignLayout, hashId,
      getSnapshot, saveSnapshot, diffCitingPapers, snapshotKey,
    }
  });
})();
