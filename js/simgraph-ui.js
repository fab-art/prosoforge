/* ============================================================================
   Research Workstation — simgraph-ui.js
   Similarity Graph UI (Phase 3a — Connected Papers reverse-engineering).
   Seed picker → OpenAlex graph build → canvas force layout. Hover = tooltip,
   click = node panel (details + collect). Node color = year, size = citations,
   edge thickness = bibliographic-coupling similarity. Honest labels everywhere.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, saveState } = RW;

  let graph = null;        // last built graph
  let screen = { nodes: [], dpr: 1, w: 0, h: 0 };
  let hovered = -1, selected = -1;

  function yearColor(year, minYear, maxYear){
    if(!year) return "var(--muted)";
    const t = maxYear === minYear ? 1 : (year - minYear) / (maxYear - minYear);
    // old = deep indigo → new = bright cyan-white (Connected Papers-style gradient)
    const hue = 255 - t * 75;
    const sat = 62 - t * 18;
    const light = 38 + t * 34;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  }

  function render(){
    const c = $("#content");
    const eligible = RW.CiteContext.eligiblePapers();
    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div>
        <b>Similarity Graph</b> — pick a seed paper; we fetch its references and citing works from OpenAlex and draw the literature around it, like Connected Papers: <b>node size</b> = citations, <b>node color</b> = publication year (old → dark, new → bright), <b>edge thickness</b> = similarity. <b>How similarity is computed:</b> shared references (bibliographic coupling, cosine) — transparent math, not a trained semantic model like Connected Papers' SAPS; very new papers with few indexed references may be underrepresented. Three API calls per graph.
      </div></div>

      <div class="card">
        <label class="small muted">Seed paper (${eligible.length} of ${(State.papers||[]).length} library papers have a DOI / OpenAlex ID)</label>
        ${eligible.length ? `
          <select class="input" id="sgSeed" style="width:100%">
            ${eligible.map(p => `<option value="${esc(p.id)}">${esc((p.title||"untitled").slice(0,90))} (${p.year||"—"})</option>`).join("")}
          </select>
          <div class="flex gap-sm wrap mt">
            <label class="small muted" style="align-self:center">Graph size:</label>
            <select id="sgSize" class="input" style="max-width:110px">
              <option value="8,8">compact (~17 nodes)</option>
              <option value="12,12" selected>standard (~25 nodes)</option>
              <option value="18,15">large (~34 nodes)</option>
            </select>
            <button class="btn btn-primary" id="sgBuild">🕸 Build graph</button>
          </div>
          <div class="small muted mt" id="sgStatus"></div>
        ` : `
          <div class="empty" style="padding:18px">No eligible seed papers. Collect papers with a DOI via <b>Literature Search</b> first.</div>
        `}
      </div>

      <div class="flex gap mt wrap" id="sgVizWrap" style="display:none;align-items:flex-start">
        <div class="card" style="flex:1;min-width:300px;position:relative;padding:6px">
          <canvas id="sgCanvas" style="width:100%;display:block;touch-action:none" height="560"></canvas>
          <div id="sgTip" class="small" style="position:absolute;display:none;pointer-events:none;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 10px;box-shadow:var(--shadow);max-width:260px;z-index:5"></div>
          <div class="small muted" style="padding:4px 8px" id="sgLegend"></div>
        </div>
        <div class="card" style="flex:0 0 260px;min-width:240px" id="sgPanel">
          <div class="small muted">Click a node for details</div>
        </div>
      </div>
    `;
    if(eligible.length) $("#sgBuild", c).addEventListener("click", build);
    if(graph) drawAll(c);
    wireCanvas(c);
  }

  async function build(){
    const c = $("#content");
    const sel = $("#sgSeed", c);
    const seed = (State.papers||[]).find(p => p.id === sel.value);
    if(!seed){ toast("Pick a seed paper.","error"); return; }
    const [citers, refs] = $("#sgSize", c).value.split(",").map(Number);
    const status = $("#sgStatus", c);
    const btn = $("#sgBuild", c);
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Building…`;
    try{
      status.textContent = "Resolving seed in OpenAlex…";
      graph = await RW.SimGraph.buildGraph(seed, { citers, refs });
      status.textContent = `Built: ${graph.stats.nodes} nodes, ${graph.stats.edges} edges (pool: ${graph.stats.pool} candidates). Hover to inspect, click for details.`;
      selected = -1; hovered = -1;
      drawAll(c);
      if(!graph.edges.length){
        status.textContent += " ⚠ No similarity edges above threshold — the retrieved works share few references.";
      }
    }catch(e){
      status.textContent = "";
      $("#sgVizWrap", c).style.display = "none";
      toast(e.message, "error", 6000);
      $("#sgPanel", c).innerHTML = `<div class="small" style="color:var(--danger)">⚠ ${esc(e.message)}</div>`;
    }finally{
      btn.disabled = false; btn.innerHTML = "🕸 Build graph";
    }
  }

  /* ---- canvas rendering + interaction ---- */
  function drawAll(c){
    const wrap = $("#sgVizWrap", c);
    if(!wrap || !graph) return;
    wrap.style.display = "flex";
    const canvas = $("#sgCanvas", c);
    const years = graph.nodes.map(n=>n.year).filter(Boolean);
    const minYear = Math.min(...years), maxYear = Math.max(...years);
    $("#sgLegend", c).innerHTML = `🕸 ${graph.stats.nodes} nodes · ${graph.stats.edges} edges · seed: <b>${esc((graph.seed.title||"").slice(0,60))}</b> · size = citations · color = year (${minYear}→${maxYear})`;
    paint(canvas, minYear, maxYear);
    if(selected >= 0) showPanel(graph.nodes[selected]);
    else $("#sgPanel", c).innerHTML = `<div class="small muted">Click a node for details</div>`;
  }

  function paint(canvas, minYear, maxYear){
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = 560;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    const pad = { l:16, r:16, t:16, b:16 };
    const X = x => pad.l + x * (w - pad.l - pad.r);
    const Y = y => pad.t + y * (h - pad.t - pad.b);

    screen = { nodes: [], dpr, w, h };

    // edges
    graph.edges.forEach(e=>{
      const a = graph.nodes[e.a], b = graph.nodes[e.b];
      ctx.strokeStyle = `rgba(125,135,160,${0.2 + e.sim*0.6})`;
      ctx.lineWidth = 0.6 + e.sim*2.6;
      ctx.beginPath(); ctx.moveTo(X(a.x),Y(a.y)); ctx.lineTo(X(b.x),Y(b.y)); ctx.stroke();
    });
    // nodes
    graph.nodes.forEach((n,i)=>{
      const r = nodeRadius(n);
      const col = n.isSeed ? "#eab308" : yearColor(n.year, minYear, maxYear);
      ctx.beginPath();
      ctx.arc(X(n.x), Y(n.y), r, 0, Math.PI*2);
      ctx.fillStyle = col; ctx.fill();
      if(n.isSeed){
        ctx.lineWidth = 2.4; ctx.strokeStyle = "#facc15";
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), r+3.5, 0, Math.PI*2); ctx.stroke();
      }
      if(i===selected){
        ctx.lineWidth = 2.2; ctx.strokeStyle = "var(--primary,#3b82f6)";
        ctx.strokeStyle = "#3b82f6";
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), r+3, 0, Math.PI*2); ctx.stroke();
      }
      if(i===hovered || i===selected || n.degree>=5 || n.citedByCount>=300 || n.isSeed){
        ctx.font = "600 10.5px system-ui, sans-serif";
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text") || "#334";
        const t = (n.title||"").slice(0, 34) + ((n.title||"").length>34?"…":"");
        ctx.fillText(t, X(n.x)+r+3, Y(n.y)+3.5);
      }
      screen.nodes[i] = { x:X(n.x), y:Y(n.y), r };
    });
  }

  function nodeRadius(n){
    return 4 + Math.min(15, Math.log10(1 + (n.citedByCount||0)) * 4.2);
  }

  function wireCanvas(c){
    const canvas = $("#sgCanvas", c);
    if(!canvas) return;
    const tip = $("#sgTip", c);
    const pick = (mx, my)=>{
      let best = -1, bestD = 1e9;
      screen.nodes.forEach((p,i)=>{
        const d = Math.hypot(p.x-mx, p.y-my);
        if(d <= p.r+7 && d < bestD){ bestD = d; best = i; }
      });
      return best;
    };
    canvas.addEventListener("mousemove", e=>{
      if(!graph) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const i = pick(mx, my);
      if(i !== hovered){
        hovered = i;
        const years = graph.nodes.map(n=>n.year).filter(Boolean);
        paint(canvas, Math.min(...years), Math.max(...years));
      }
      if(i >= 0){
        const n = graph.nodes[i];
        const simToSeed = n.isSeed ? 1 : RW.SimGraph.similarity(graph.seed.refs, n.refs).toFixed(2);
        tip.style.display = "block";
        tip.style.left = Math.min(mx+14, screen.w-270) + "px";
        tip.style.top = (my+14) + "px";
        tip.innerHTML = `<b>${esc((n.title||"").slice(0,80))}</b><br><span class="muted">${n.year||"?"} · ${n.citedByCount} citations · sim-to-seed ${simToSeed}</span>`;
        canvas.style.cursor = "pointer";
      } else { tip.style.display = "none"; canvas.style.cursor = "default"; }
    });
    canvas.addEventListener("mouseleave", ()=>{
      tip.style.display = "none"; hovered = -1;
      if(graph){ const years = graph.nodes.map(n=>n.year).filter(Boolean); paint(canvas, Math.min(...years), Math.max(...years)); }
    });
    canvas.addEventListener("click", e=>{
      if(!graph) return;
      const rect = canvas.getBoundingClientRect();
      const i = pick(e.clientX - rect.left, e.clientY - rect.top);
      selected = (i===selected ? -1 : i);
      const years = graph.nodes.map(n=>n.year).filter(Boolean);
      paint(canvas, Math.min(...years), Math.max(...years));
      if(selected >= 0) showPanel(graph.nodes[selected]);
      else $("#sgPanel", c).innerHTML = `<div class="small muted">Click a node for details</div>`;
    });
  }

  function showPanel(n){
    const c = $("#content");
    const panel = $("#sgPanel", c);
    if(!panel || !n) return;
    const collected = State.papers.find(p => p.id === "oa-"+n.id);
    const simToSeed = n.isSeed ? "1.00 (seed)" : RW.SimGraph.similarity(graph.seed.refs, n.refs).toFixed(2);
    panel.innerHTML = `
      <div class="small muted mb-sm">${n.isSeed ? "🌱 Seed paper" : "Related paper"}</div>
      <div style="font-weight:700" class="small mb-sm">${esc(n.title)}</div>
      <div class="small muted">${n.year||"?"} · ${esc(n.venue||"venue unknown")}</div>
      <div class="small mt-sm">📊 ${n.citedByCount} citations · 🔗 ${n.degree} graph edges · similarity-to-seed <b>${simToSeed}</b> (shared refs)</div>
      ${n.doi?`<div class="small mono muted mt-sm">DOI ${esc(n.doi)}</div>`:""}
      <div class="flex gap-sm mt wrap">
        ${n.url?`<a class="btn btn-sm" href="${esc(n.url)}" target="_blank" rel="noopener">↗ Open</a>`:""}
        ${collected
          ? `<span class="badge badge-success">✓ in library</span>`
          : `<button class="btn btn-sm btn-primary" id="sgCollect">＋ Collect</button>`}
      </div>
    `;
    const btn = panel.querySelector("#sgCollect");
    if(btn) btn.addEventListener("click", ()=>{
      State.papers.push({
        id: "oa-"+n.id, source:"openalex", title:n.title, authors:[],
        year:n.year, venue:n.venue, doi:n.doi, url:n.url,
        abstract:"", tldr:"", collected:true, addedAt:Date.now(),
      });
      saveState(); RW.refreshCounts(); showPanel(n);
      toast("Added to library (no abstract from graph — open in Literature Search for details).","success",5000);
    });
  }

  Object.assign(RW, { SimGraphUI: { render } });
})();
