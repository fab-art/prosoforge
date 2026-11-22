/* ============================================================================
   Research Workstation — simgraph.js
   PHASE 3a of the feature roadmap: reverse-engineering of **Connected Papers**
   (and ResearchRabbit's "similar work" concept).

   Connected Papers' mechanism: given a seed paper, build a graph of its most
   related papers where similarity comes from their GPT-generated "Similarity
   Analysis of Primary Sources" (SAPS) over co-references; node size = local
   citations; node color = publication year; edges = similarity strength.

   Our version — the **Similarity Graph**:
   - Seed → OpenAlex: seed's referenced_works + its citing works form the pool.
   - Candidate details fetched in ONE batched call (`filter=openalex_id:W1|W2|…`).
   - Similarity = cosine over shared referenced_works (bibliographic coupling).
     Connected Papers uses a trained semantic model; we use transparent
     co-reference math and say so in the UI.
   - Node size = cited_by_count, node color = publication year (old → dark,
     new → light, like theirs), edge thickness = similarity.
   - Deterministic spring-embedder layout (no library, no network).

   Honest limits (mirrored in UI): bibliographic coupling favors papers that
   share a citation list; brand-new papers (few references indexed) may be
   underrepresented. Not semantic similarity.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};

  const SELECT_FIELDS = "id,display_name,publication_year,primary_location,referenced_works,cited_by_count";

  /* Cosine similarity between two binary reference-id sets: |A∩B| / sqrt(|A|·|B|) */
  function similarity(refsA, refsB){
    if(!refsA || !refsB || !refsA.size || !refsB.size) return 0;
    const [small, big] = refsA.size <= refsB.size ? [refsA, refsB] : [refsB, refsA];
    let inter = 0;
    for(const r of small) if(big.has(r)) inter++;
    return inter / Math.sqrt(refsA.size * refsB.size);
  }

  /* Deterministic spring-embedder (Fruchterman–Reingold style).
     Returns [{x,y}] normalized to the [0,1]² box. */
  function layout(n, edges, iterations=280){
    const W = 1000, H = 700;
    const k = Math.sqrt((W*H) / Math.max(n,1)) * 0.85; // ideal edge length
    const pos = new Array(n);
    // deterministic init: place on a circle ordered by year
    for(let i=0;i<n;i++){
      const a = (i/n) * Math.PI * 2;
      pos[i] = { x: W/2 + Math.cos(a)*(W*0.33), y: H/2 + Math.sin(a)*(H*0.33) };
    }
    const adj = edges.map(e=>[e.a, e.b, e.sim]);
    const cooling = (it) => 1 - it/iterations;
    for(let it=0; it<iterations; it++){
      const disp = new Array(n).fill(null).map(()=>({x:0,y:0}));
      const temp = 22 * cooling(it) + 1;
      // repulsion (all pairs)
      for(let i=0;i<n;i++){
        for(let j=i+1;j<n;j++){
          let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
          let d2 = dx*dx + dy*dy;
          if(d2 < 1){ // degenerate overlap — nudge apart deterministically
            dx = ((i*7 + j*13) % 20 - 10) + 0.5;
            dy = ((i*11 + j*3) % 16 - 8) + 0.5;
            d2 = dx*dx + dy*dy;
          }
          if(d2 > (W*W)) continue;
          const f = (k*k) / d2;
          const d = Math.sqrt(d2);
          const fx = (dx/d)*f, fy = (dy/d)*f;
          disp[i].x += fx; disp[i].y += fy;
          disp[j].x -= fx; disp[j].y -= fy;
        }
      }
      // attraction (edges, weighted by similarity)
      for(const [a,b,s] of adj){
        let dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
        const d = Math.max(Math.sqrt(dx*dx+dy*dy), 1);
        const f = (d*d)/(k*1.6) * (0.4 + s);
        const fx = (dx/d)*f, fy = (dy/d)*f;
        disp[a].x -= fx; disp[a].y -= fy;
        disp[b].x += fx; disp[b].y += fy;
      }
      // gentle center gravity
      for(let i=0;i<n;i++){
        disp[i].x += (W/2 - pos[i].x) * 0.0025;
        disp[i].y += (H/2 - pos[i].y) * 0.0025;
      }
      // apply with temperature cap
      for(let i=0;i<n;i++){
        const dl = Math.max(Math.sqrt(disp[i].x*disp[i].x + disp[i].y*disp[i].y), 0.001);
        const capped = Math.min(dl, temp);
        pos[i].x += (disp[i].x/dl)*capped;
        pos[i].y += (disp[i].y/dl)*capped;
        pos[i].x = Math.max(30, Math.min(W-30, pos[i].x));
        pos[i].y = Math.max(30, Math.min(H-30, pos[i].y));
      }
    }
    // normalize to [0,1]
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    pos.forEach(p=>{ minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x); minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y); });
    const spanX = Math.max(maxX-minX, 1), spanY = Math.max(maxY-minY, 1);
    return pos.map(p=>({ x:(p.x-minX)/spanX, y:(p.y-minY)/spanY }));
  }

  /* Parse an OpenAlex work (selected fields) into a graph candidate. */
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

  /* Build the graph for a seed paper.
     opts: { citers: 12, refs: 12, minSim: 0.12, maxEdgesPerNode: 5 } */
  async function buildGraph(seedPaper, opts={}){
    const { citers=12, refs=12, minSim=0.12, maxEdgesPerNode=5 } = opts;
    const oaFetch = RW.CiteContext.oaFetch;
    const oaId = await RW.CiteContext.resolveOpenAlexId(seedPaper);

    // 1) seed details (includes its reference list)
    const seedWork = await oaFetch(`https://api.openalex.org/works/${oaId}?select=${SELECT_FIELDS}`);
    const seedNode = toNode(seedWork, true);

    // 2) citing works (candidates)
    const citersData = await oaFetch(
      `https://api.openalex.org/works?filter=cites:${oaId}&per-page=${citers}&sort=cited_by_count:desc&select=${SELECT_FIELDS}`);
    const candidates = (citersData.results||[]).map(w=>toNode(w,false));

    // 3) seed's references (candidates too — Connected Papers shows prior work)
    const seedRefIds = [...seedNode.refs].slice(0, refs);
    if(seedRefIds.length){
      const refData = await oaFetch(
        `https://api.openalex.org/works?filter=openalex_id:${seedRefIds.join("|")}&per-page=50&select=${SELECT_FIELDS}`);
      (refData.results||[]).forEach(w=>candidates.push(toNode(w,false)));
    }

    // dedupe candidates (by id), drop seed duplicates
    const nodes = [seedNode];
    const seen = new Set([seedNode.id]);
    candidates.forEach(c=>{
      if(!c.id || seen.has(c.id)) return;
      seen.add(c.id); nodes.push(c);
    });
    if(nodes.length < 2) throw new Error("Not enough connected works in OpenAlex to build a graph for this seed.");

    // 4) pairwise similarity → edges (cap per node)
    const edges = [];
    const degree = new Array(nodes.length).fill(0);
    for(let i=0;i<nodes.length;i++){
      const cand = [];
      for(let j=i+1;j<nodes.length;j++){
        const sim = similarity(nodes[i].refs, nodes[j].refs);
        if(sim >= minSim) cand.push({ a:i, b:j, sim });
      }
      cand.sort((x,y)=>y.sim-x.sim);
      for(const e of cand){
        if(degree[e.a] >= maxEdgesPerNode || degree[e.b] >= maxEdgesPerNode) continue;
        edges.push(e); degree[e.a]++; degree[e.b]++;
      }
    }
    // 5) layout
    const positions = layout(nodes.length, edges);
    nodes.forEach((nd,i)=>{ nd.x = positions[i].x; nd.y = positions[i].y; nd.degree = degree[i]; });

    return {
      seed: seedNode,
      nodes, edges,
      stats: { nodes: nodes.length, edges: edges.length, pool: candidates.length },
      builtAt: Date.now(),
    };
  }

  Object.assign(RW, { SimGraph: { buildGraph, similarity, layout } });
})();
