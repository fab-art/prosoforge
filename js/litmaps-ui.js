/* ============================================================================
   Research Workstation — litmaps-ui.js
   Citation Timeline UI (Phase 4a — Litmaps reverse-engineering).
   Seed picker → OpenAlex 3-generation fetch → time-layered canvas: x = year,
   y = citation depth from the seed (you → direct citers → citers-of-citers),
   node size = citations, color = year. Plus the manual "check for new citing
   papers" alert (a PWA has no server → no push; the diff is manual, stated).
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, saveState } = RW;

  let timeline = null;      // last built timeline
  let screen = { nodes: [], w: 0, h: 0 };
  let hovered = -1, selected = -1;
  let alertSeedId = null;   // seed whose alert card is shown

  function yearColor(year, minYear, maxYear){
    if(!year) return "#8892aa";
    const t = maxYear === minYear ? 1 : (year - minYear) / (maxYear - minYear);
    const hue = 255 - t * 75;
    const sat = 62 - t * 18;
    const light = 38 + t * 34;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  }

  function render(){
    const c = $("#content");
    const eligible = RW.CiteContext.eligiblePapers();
    const snapshots = State.litmapsSnapshots || {};
    const nSnap = Object.keys(snapshots).length;
    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div>
        <b>Citation Timeline</b> (Litmaps-style) — pick a seed paper; we fetch its citing works and the works citing <i>them</i> from OpenAlex and layer the network over time: <b>x = year</b>, <b>y = citation distance</b> from your seed (layer ① cites it directly, layer ② cites the citers), <b>node size</b> = citations, <b>color</b> = year. Edge data is real (each node's indexed reference list) but paged — this is a <b>sample</b> of the network, not the complete graph. Papers with no indexed year are listed but not drawn.
      </div></div>

      <div class="card">
        <label class="small muted">Seed paper (${eligible.length} of ${(State.papers||[]).length} library papers have a DOI / OpenAlex ID)</label>
        ${eligible.length ? `
          <select class="input" id="lmSeed" style="width:100%">
            ${eligible.map(p => `<option value="${esc(p.id)}">${esc((p.title||"untitled").slice(0,90))} (${p.year||"—"})</option>`).join("")}
          </select>
          <div class="flex gap-sm wrap mt">
            <label class="small muted" style="align-self:center">Direct citers:</label>
            <select id="lmSize" class="input" style="max-width:150px">
              <option value="40">compact (~40)</option>
              <option value="60" selected>standard (~60)</option>
              <option value="100">large (~100)</option>
            </select>
            <button class="btn btn-primary" id="lmBuild">🗺 Build timeline</button>
          </div>
          <div class="small muted mt" id="lmStatus"></div>
        ` : `
          <div class="empty" style="padding:18px">No eligible seed papers. Collect papers with a DOI via <b>Literature Search</b> first.</div>
        `}
      </div>

      <div class="flex gap mt wrap" id="lmVizWrap" style="display:none;align-items:flex-start">
        <div class="card" style="flex:1;min-width:300px;position:relative;padding:6px">
          <canvas id="lmCanvas" style="width:100%;display:block;touch-action:none" height="560"></canvas>
          <div id="lmTip" class="small" style="position:absolute;display:none;pointer-events:none;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 10px;box-shadow:var(--shadow);max-width:260px;z-index:5"></div>
          <div class="small muted" style="padding:4px 8px" id="lmLegend"></div>
        </div>
        <div class="card" style="flex:0 0 260px;min-width:240px" id="lmPanel">
          <div class="small muted">Click a node for details</div>
        </div>
      </div>

      <div class="card mt" id="lmAlertCard" style="display:none">
        <div class="between mb-sm">
          <div><b>🔔 New-citing-paper check</b> <span class="badge badge-muted">manual</span></div>
          <button class="btn btn-primary btn-sm" id="lmCheck">🔔 Check now</button>
        </div>
        <div class="small muted">A pure PWA has no server, so there are no push/email alerts. Instead, we diff OpenAlex citing works against your last snapshot for <b id="lmAlertTitle">this seed</b> whenever you ask. First run stores a baseline.</div>
        <div class="small mt" id="lmAlertResult"></div>
      </div>
    `;
    if(eligible.length) $("#lmBuild", c).addEventListener("click", build);
    if(timeline) drawAll(c);
    wireCanvas(c);
    const checkBtn = $("#lmCheck", c);
    if(checkBtn) checkBtn.addEventListener("click", checkAlerts);
  }

  async function build(){
    const c = $("#content");
    const sel = $("#lmSeed", c);
    const seed = (State.papers||[]).find(p => p.id === sel.value);
    if(!seed){ toast("Pick a seed paper.","error"); return; }
    const citers = parseInt($("#lmSize", c).value, 10);
    const status = $("#lmStatus", c);
    const btn = $("#lmBuild", c);
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Building…`;
    try{
      status.textContent = "Resolving seed in OpenAlex…";
      timeline = await RW.Litmaps.buildTimeline(seed, { citers });
      selected = -1; hovered = -1;
      status.textContent = `Built: ${timeline.stats.gen1} direct citers, ${timeline.stats.gen2} citers-of-citers, ${timeline.stats.edges} citation edges among them (3 API calls).` +
        (timeline.stats.noYear ? ` ${timeline.stats.noYear} work(s) have no indexed year and are listed but not drawn.` : "");
      alertSeedId = seed.id;
      showAlertCard(seed);
      drawAll(c);
    }catch(e){
      status.textContent = "";
      $("#lmVizWrap", c).style.display = "none";
      toast(e.message, "error", 6000);
    }finally{
      btn.disabled = false; btn.innerHTML = "🗺 Build timeline";
    }
  }

  /* ---- manual alert check ---- */
  async function checkAlerts(){
    const c = $("#content");
    const out = $("#lmAlertResult", c);
    const seed = (State.papers||[]).find(p => p.id === alertSeedId);
    if(!seed){ toast("Build a timeline first.","error"); return; }
    const btn = $("#lmCheck", c);
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Checking…`;
    try{
      // fetch recent citers (newest first) — enough coverage for a diff
      const recent = await RW.Litmaps.fetchGen1(seed, { limit: 100, sort:"publication_year" });
      lastDiffNodes = recent; // kept for the Collect buttons in the results list
      const res = RW.Litmaps.diffCitingPapers(seed.id, recent);
      if(res.firstRun){
        out.innerHTML = `<span class="badge badge-success">baseline stored</span> <span class="small">${res.known} recent citing works are now known. Next check will report anything newer that appears.</span>`;
      } else if(!res.added.length){
        out.innerHTML = `<span class="badge badge-success">no new citing papers</span> <span class="small muted">Checked ${new Date(res.checkedNow).toLocaleString()} · last check ${res.lastChecked? new Date(res.lastChecked).toLocaleString() : "—"}</span>`;
      } else {
        out.innerHTML = `
          <div class="mb-sm"><span class="badge badge-warning">🔔 ${res.added.length} new citing paper${res.added.length>1?"s":""}</span> <span class="small muted">since ${new Date(res.lastChecked).toLocaleString()}</span></div>
          ${res.added.slice(0,12).map(n=>`
            <div class="between small" style="padding:3px 0;border-bottom:1px dashed var(--border)">
              <span style="min-width:0">${esc((n.title||"").slice(0,80))} <span class="muted">(${n.year||"?"})</span></span>
              <button class="btn btn-sm" data-lm-collect="${esc(n.id)}">＋ Collect</button>
            </div>`).join("")}
          ${res.added.length>12? `<div class="small muted mt-sm">…and ${res.added.length-12} more (check again later or raise the citer limit).</div>`:""}
        `;
        wireCollectButtons(out);
      }
    }catch(e){
      out.innerHTML = `<span class="small" style="color:var(--danger)">⚠ ${esc(e.message)}</span>`;
    }finally{
      btn.disabled = false; btn.innerHTML = "🔔 Check now";
    }
  }

  function wireCollectButtons(root){
    $$("[data-lm-collect]", root).forEach(b=>{
      b.addEventListener("click", ()=>{
        // the alert check returned full node objects, kept on last diff; simplest: refetch-less collect via title cache
        const n = lastDiffNodes.find(x=>x.id===b.dataset.lmCollect);
        if(n) collectNode(n, b);
      });
    });
  }

  let lastDiffNodes = [];

  function showAlertCard(seed){
    const c = $("#content");
    const card = $("#lmAlertCard", c);
    if(!card) return;
    card.style.display = "block";
    $("#lmAlertTitle", c).textContent = (seed.title||"").slice(0,70);
    const snap = RW.Litmaps.getSnapshot(seed.id);
    const out = $("#lmAlertResult", c);
    if(snap) out.innerHTML = `<span class="small muted">Last checked ${new Date(snap.lastChecked).toLocaleString()} · ${snap.ids.length} citing works known.</span>`;
    else out.innerHTML = `<span class="small muted">No snapshot yet — the first check stores a baseline.</span>`;
  }

  /* ---- canvas rendering + interaction ---- */
  function drawAll(c){
    const wrap = $("#lmVizWrap", c);
    if(!wrap || !timeline) return;
    wrap.style.display = "flex";
    const canvas = $("#lmCanvas", c);
    const years = timeline.nodes.map(n=>n.year).filter(Boolean);
    const minYear = Math.min(...years), maxYear = Math.max(...years);
    $("#lmLegend", c).innerHTML = `🗺 ${timeline.nodes.length} nodes · ${timeline.stats.edges} edges · seed: <b>${esc((timeline.seed.title||"").slice(0,60))}</b> · x = year (${minYear}→${maxYear}) · y = citation distance · size = citations`;
    paint(canvas, minYear, maxYear);
    if(selected >= 0) showPanel(timeline.nodes[selected], timeline.depth[selected]);
    else $("#lmPanel", c).innerHTML = `<div class="small muted">Click a node for details</div>`;
  }

  function bandLabel(d){
    if(d===0) return "🌱 seed";
    if(d===1) return "① cite the seed directly";
    if(d===2) return "② cite the citers";
    return `③+ deeper (${d} hops)`;
  }

  function paint(canvas, minYear, maxYear){
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = 560;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    const pad = { l:14, r:14, t:12, b:26 };
    const X = x => pad.l + x * (w - pad.l - pad.r);
    const Y = y => pad.t + y * (h - pad.t - pad.b);

    screen = { nodes: [], w, h };

    // year axis ticks
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted") || "#889";
    const span = Math.max(maxYear - minYear, 1);
    const step = span > 30 ? 10 : span > 14 ? 5 : span > 7 ? 2 : 1;
    for(let yr = Math.ceil(minYear/step)*step; yr <= maxYear; yr += step){
      const x = X((yr - minYear)/span);
      ctx.fillText(String(yr), x-14, h-8);
      ctx.strokeStyle = "rgba(125,135,160,.18)";
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h-pad.b); ctx.stroke();
    }

    // depth band labels (left edge)
    const maxDepth = Math.max(...timeline.nodes.map((n,i)=>timeline.depth[i]), 2);
    for(let d=0; d<=maxDepth; d++){
      const bandH = 0.86 / (maxDepth + 1);
      const yMid = 0.11 + d*bandH + bandH*0.5;
      ctx.fillStyle = d===0 ? "#b45309" : "#64748b";
      ctx.font = d===0 ? "600 11px system-ui, sans-serif" : "10px system-ui, sans-serif";
      ctx.fillText(bandLabel(d), pad.l + 4, Y(yMid) - bandH*(h-pad.t-pad.b)/2 + 10);
    }

    // edges (citing → cited)
    timeline.edges.forEach(({from,to})=>{
      const a = timeline.nodes[from], b = timeline.nodes[to];
      if(a.x==null || b.x==null) return;
      ctx.strokeStyle = "rgba(125,135,160,.16)";
      ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(X(a.x),Y(a.y)); ctx.lineTo(X(b.x),Y(b.y)); ctx.stroke();
    });

    // nodes
    timeline.nodes.forEach((n,i)=>{
      if(n.x==null) return;
      const d = timeline.depth[i];
      const r = n.isSeed ? 9 : 4 + Math.min(12, Math.log10(1 + (n.citedByCount||0)) * 4);
      const col = n.isSeed ? "#eab308" : yearColor(n.year, minYear, maxYear);
      ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), r, 0, Math.PI*2);
      ctx.fillStyle = col; ctx.fill();
      if(n.isSeed){
        ctx.lineWidth = 2.4; ctx.strokeStyle = "#facc15";
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), r+4, 0, Math.PI*2); ctx.stroke();
      }
      if(i===selected){
        ctx.lineWidth = 2.2; ctx.strokeStyle = "#3b82f6";
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), r+3, 0, Math.PI*2); ctx.stroke();
      }
      if(i===hovered || i===selected || n.citedByCount>=200 || n.isSeed){
        ctx.font = "600 10.5px system-ui, sans-serif";
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text") || "#334";
        const t = (n.title||"").slice(0, 34) + ((n.title||"").length>34?"…":"");
        ctx.fillText(t, X(n.x)+r+3, Y(n.y)+3.5);
      }
      screen.nodes[i] = { x:X(n.x), y:Y(n.y), r };
    });
  }

  function wireCanvas(c){
    const canvas = $("#lmCanvas", c);
    if(!canvas) return;
    const tip = $("#lmTip", c);
    const repaint = ()=>{ const years = timeline.nodes.map(n=>n.year).filter(Boolean); paint(canvas, Math.min(...years), Math.max(...years)); };
    const pick = (mx, my)=>{
      let best = -1, bestD = 1e9;
      screen.nodes.forEach((p,i)=>{
        if(!p) return;
        const d = Math.hypot(p.x-mx, p.y-my);
        if(d <= p.r+7 && d < bestD){ bestD = d; best = i; }
      });
      return best;
    };
    canvas.addEventListener("mousemove", e=>{
      if(!timeline) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const i = pick(mx, my);
      if(i !== hovered){ hovered = i; repaint(); }
      if(i >= 0){
        const n = timeline.nodes[i];
        tip.style.display = "block";
        tip.style.left = Math.min(mx+14, screen.w-270) + "px";
        tip.style.top = (my+14) + "px";
        tip.innerHTML = `<b>${esc((n.title||"").slice(0,80))}</b><br><span class="muted">${n.year||"?"} · ${n.citedByCount} citations · ${esc(bandLabel(timeline.depth[i]))}</span>`;
        canvas.style.cursor = "pointer";
      } else { tip.style.display = "none"; canvas.style.cursor = "default"; }
    });
    canvas.addEventListener("mouseleave", ()=>{ tip.style.display = "none"; hovered = -1; if(timeline) repaint(); });
    canvas.addEventListener("click", e=>{
      if(!timeline) return;
      const rect = canvas.getBoundingClientRect();
      const i = pick(e.clientX - rect.left, e.clientY - rect.top);
      selected = (i===selected ? -1 : i);
      repaint();
      if(selected >= 0) showPanel(timeline.nodes[selected], timeline.depth[selected]);
      else $("#lmPanel", c).innerHTML = `<div class="small muted">Click a node for details</div>`;
    });
  }

  function collectNode(n, btn){
    State.papers.push({
      id: "oa-"+n.id, source:"openalex", title:n.title, authors:[],
      year:n.year, venue:n.venue, doi:n.doi, url:n.url,
      abstract:"", tldr:"", collected:true, addedAt:Date.now(),
    });
    saveState(); RW.refreshCounts();
    if(btn){ btn.outerHTML = `<span class="badge badge-success">✓ in library</span>`; }
    toast("Added to library.","success",2400);
  }

  function showPanel(n, depth){
    const c = $("#content");
    const panel = $("#lmPanel", c);
    if(!panel || !n) return;
    const collected = State.papers.find(p => p.id === "oa-"+n.id);
    panel.innerHTML = `
      <div class="small muted mb-sm">${n.isSeed ? "🌱 Seed paper" : esc(bandLabel(depth))}</div>
      <div style="font-weight:700" class="small mb-sm">${esc(n.title)}</div>
      <div class="small muted">${n.year||"?"} · ${esc(n.venue||"venue unknown")}</div>
      <div class="small mt-sm">📊 ${n.citedByCount} citations</div>
      ${n.doi?`<div class="small mono muted mt-sm">DOI ${esc(n.doi)}</div>`:""}
      <div class="flex gap-sm mt wrap">
        ${n.url?`<a class="btn btn-sm" href="${esc(n.url)}" target="_blank" rel="noopener">↗ Open</a>`:""}
        ${collected ? `<span class="badge badge-success">✓ in library</span>` : `<button class="btn btn-sm btn-primary" id="lmCollect">＋ Collect</button>`}
      </div>
      ${!n.isSeed ? `<div class="small muted mt-sm">After collecting, run <b>Citation Context</b> on it to see how it talks about this work.</div>`:""}
    `;
    const btn = panel.querySelector("#lmCollect");
    if(btn) btn.addEventListener("click", ()=> collectNode(n, btn));
  }

  Object.assign(RW, { LitmapsUI: { render } });
})();
