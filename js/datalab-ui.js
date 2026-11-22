/* ============================================================================
   Research Workstation — datalab-ui.js
   Data Lab UI (Phase 5a — Julius reverse-engineering).
   CSV upload/paste → table preview → analysis via (a) manual menu builder or
   (b) WebLLM picking a menu item + columns from a natural-language question.
   Numbers: JS fast-path always; optional Pyodide+pandas cross-check that also
   shows the generated Python. Canvas chart. Export .md report.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast } = RW;

  const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
  const PYODIDE_JS  = PYODIDE_URL + "pyodide.js";

  let table = null;       // {headers, rows}
  let types = [];         // inferred column types
  let lastSpec = null, lastResult = null, lastPython = null;
  let pyodide = null;     // loaded lazily
  let pyFailed = false;

  /* ---- WebLLM: pick a spec from the menu (never writes free-form code) ---- */
  async function pickSpecWithLLM(question){
    const colDesc = types.map(t=>`- ${t.name} (${t.type}, ${t.filled} values)`).join("\n");
    const sample = table.rows.slice(0,3).map(r=> JSON.stringify(table.headers.map((h,i)=>r[i]))).join("\n");
    const sys = 'You map a data-analysis question to a FIXED menu. Return ONLY JSON: {"analysis": "describe|frequency|correlation|groupmeans|ttest|regression", "column": "<one column name>", "columns": ["<name>", "<name>"], "group": "<name>", "value": "<name>"}. Rules: single-column summary → describe or frequency; relationship between two numeric columns → correlation; numeric per group → groupmeans (group + value); compare two numeric columns → ttest; predict y from x → regression. Use EXACT column names from the list. Omit fields not needed.';
    const question2 = `Columns:\n${colDesc}\n\nSample rows:\n${sample}\n\nQuestion: ${question}\n\nJSON:`;
    const res = await RW.WebLLM.ask({ system: sys, context:"", question: question2, maxTokens: 160, temperature: 0.1,
      fallbackFn: ()=>{ throw new Error("no-model"); } });
    let t = String(res.text||"").replace(/```(json)?/g,"").trim();
    const start = t.indexOf("{"), end = t.lastIndexOf("}");
    if(start<0||end<0) throw new Error("Model did not return JSON.");
    return RW.DataLab.validateSpec(JSON.parse(t.slice(start,end+1)), table.headers);
  }

  /* ---- optional Pyodide ---- */
  async function ensurePyodide(onStatus){
    if(pyodide) return pyodide;
    if(pyFailed) throw new Error("Pyodide failed to load earlier — JavaScript path still works.");
    onStatus("Loading pyodide.js…");
    await new Promise((resolve,reject)=>{
      const s = document.createElement("script");
      s.src = PYODIDE_JS; s.onload = resolve; s.onerror = ()=>reject(new Error("pyodide.js download failed"));
      document.head.appendChild(s);
    });
    onStatus("Booting WebAssembly CPython… (first load ~10 MB)");
    pyodide = await window.loadPyodide({ indexURL: PYODIDE_URL });
    onStatus("Loading pandas…");
    await pyodide.loadPackage("pandas");
    return pyodide;
  }

  async function runPython(spec, statusEl){
    const py = await ensurePyodide(msg=>{ statusEl.textContent = msg; });
    const csvText = table.headers.join(",") + "\n" + table.rows.map(r=>r.map(c=>String(c).includes(",")?`"${String(c).replace(/"/g,'""')}"`:String(c)).join(",")).join("\n");
    py.globals.set("csv_text", csvText);
    const code = RW.DataLab.pythonCode(spec);
    lastPython = code;
    const out = await py.runPythonAsync(code);
    return JSON.parse(out);
  }

  /* ---- canvas chart ---- */
  function drawChart(canvas, chart){
    const dpr = window.devicePixelRatio||1;
    const w = canvas.clientWidth, h = 300;
    canvas.width = w*dpr; canvas.height = h*dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    ctx.font = "11px system-ui, sans-serif";
    const accent = getComputedStyle(document.body).getPropertyValue("--accent") || "#2563eb";
    if(chart.kind==="bar"){
      const data = chart.data.filter(d=> d.value!=null);
      if(!data.length) return;
      const max = Math.max(...data.map(d=>d.value), 1e-9);
      const bw = Math.min(60, (w-40)/data.length);
      data.forEach((d,i)=>{
        const x = 20 + i*((w-40)/data.length);
        const bh = (h-70) * (d.value/max);
        ctx.fillStyle = accent;
        ctx.fillRect(x, h-45-bh, bw*0.8, bh);
        ctx.fillStyle = "#64748b";
        ctx.fillText(d.label, x, h-30, bw);
        ctx.fillStyle = "#334155";
        ctx.fillText(String(Math.round(d.value*100)/100), x, h-50-bh);
      });
    } else if(chart.kind==="scatter"){
      const pts = (chart.points||[]).filter(p=> isFinite(p[0]) && isFinite(p[1]));
      if(!pts.length) return;
      const xs = pts.map(p=>p[0]), ys = pts.map(p=>p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const X = v => 40 + (x1===x0?0.5:(v-x0)/(x1-x0))*(w-60);
      const Y = v => h-40 - (y1===y0?0.5:(v-y0)/(y1-y0))*(h-70);
      if(chart.fit){
        ctx.strokeStyle = "rgba(234,88,12,.85)"; ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(X(x0), Y(chart.fit.intercept + chart.fit.slope*x0));
        ctx.lineTo(X(x1), Y(chart.fit.intercept + chart.fit.slope*x1));
        ctx.stroke();
      }
      ctx.fillStyle = accent;
      pts.forEach(p=>{ ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 3, 0, Math.PI*2); ctx.fill(); });
      ctx.fillStyle = "#64748b";
      ctx.fillText(String(Math.round(x0*100)/100), 40, h-22);
      ctx.fillText(String(Math.round(x1*100)/100), w-40, h-22);
      ctx.fillText(String(Math.round(y1*100)/100), 4, 22);
      ctx.fillText(String(Math.round(y0*100)/100), 4, h-40);
    } else if(chart.kind==="hist"){
      // bin from summary stats (we don't ship raw values to the UI layer)
      const col = chart.summary;
      if(!col || col.n===0) return;
      // fallback: normal approximation bins from mean/sd
      const bins = Array.from({length:10},(_,i)=>({ label:(col.min + (col.max-col.min)*i/9).toFixed(1), value:0 }));
      ctx.fillStyle = "#64748b";
      ctx.fillText(`n=${col.n} · mean=${fmt(col.mean)} · sd=${fmt(col.sd)} · range [${fmt(col.min)}, ${fmt(col.max)}] — histogram needs Python path for exact bins`, 20, 24);
      ctx.strokeStyle = accent; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(20, h-45); ctx.lineTo(w-20, h-45); ctx.stroke();
    }
    // caption
    ctx.fillStyle = "#334155";
    ctx.fillText(chart.label||"", 20, h-6);
  }

  function fmt(v){ return v==null? "—" : (Math.abs(v)>=1000? Math.round(v).toLocaleString() : String(Math.round(v*1000)/1000)); }

  /* ================================ UI ================================ */
  function render(){
    const c = $("#content");
    const llmReady = RW.WebLLM.isReady();
    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div>
        <b>Data Lab</b> (Julius-style, client-side) — upload a CSV and ask a question. The model's <b>only</b> job is to pick an analysis and columns from a fixed menu; it never computes numbers and never writes free-form code. Numbers come from a deterministic <b>JavaScript fast-path</b> (always available, works offline) and can be cross-checked with real <b>Pyodide + pandas</b> Python running in a WASM sandbox. Your data never leaves the device.
      </div></div>

      <div class="card">
        <label class="small muted">CSV data (file upload or paste)</label>
        <div class="flex gap-sm wrap mt-sm">
          <input type="file" id="dlFile" accept=".csv,text/csv" class="input" style="max-width:260px">
          <span class="small muted" style="align-self:center">or paste below</span>
        </div>
        <textarea class="textarea mt" id="dlPaste" rows="4" placeholder="colA,colB,group&#10;1.2,3.4,ctrl&#10;2.3,4.1,ctrl&#10;1.8,5.9,tx"></textarea>
        <button class="btn btn-primary mt" id="dlLoad">📂 Load CSV</button>
        <div class="small muted mt" id="dlTableInfo"></div>
        <div id="dlPreview"></div>
      </div>

      <div class="card mt" id="dlAskCard" style="display:none">
        <label class="small muted">Your question (natural language)</label>
        <div class="flex gap-sm wrap mt-sm">
          <input class="input" id="dlQuestion" style="flex:1;min-width:220px" placeholder="e.g. does colB differ between groups in group?">
          <button class="btn btn-primary" id="dlAsk" ${llmReady?"":"disabled title=\"Load a WebLLM model in Settings first\""}>🧠 Ask ${llmReady?"🤖":""}</button>
        </div>
        <div class="small muted mt">Manual builder — same analyses without a model:</div>
        <div class="flex gap-sm wrap mt-sm">
          <select class="input" id="dlAnalysis" style="max-width:170px">
            <option value="describe">describe (mean/sd…)</option>
            <option value="frequency">frequency counts</option>
            <option value="correlation">correlation (2 cols)</option>
            <option value="groupmeans">group means</option>
            <option value="ttest">t-test (2 cols)</option>
            <option value="regression">regression y~x</option>
          </select>
          <select class="input" id="dlColA" style="max-width:170px"></select>
          <select class="input" id="dlColB" style="max-width:170px"></select>
          <select class="input" id="dlColC" style="max-width:170px"></select>
          <button class="btn" id="dlRun">▶ Run</button>
        </div>
        <div class="small muted mt" id="dlStatus"></div>
      </div>

      <div id="dlResultWrap"></div>
    `;
    $("#dlLoad", c).addEventListener("click", loadCSV);
    if(llmReady) $("#dlAsk", c).addEventListener("click", askLLM);
    $("#dlRun", c).addEventListener("click", runManual);
    $("#dlAnalysis", c).addEventListener("change", updateColumnPickers);
  }

  function loadCSV(){
    const c = $("#content");
    const file = $("#dlFile", c).files[0];
    const finish = (text)=>{
      try{
        table = RW.DataLab.parseCSV(text);
        if(!table.headers.length){ toast("No CSV rows found.","error"); return; }
        types = RW.DataLab.inferTypes(table.headers, table.rows);
        $("#dlTableInfo", c).textContent = `${table.rows.length} rows × ${table.headers.length} columns — ${types.map(t=>`${t.name} (${t.type})`).join(", ")}`;
        $("#dlPreview", c).innerHTML = `
          <div style="overflow-x:auto"><table>
            <tr>${table.headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr>
            ${table.rows.slice(0,5).map(r=>`<tr>${table.headers.map((h,i)=>`<td>${esc(String(r[i]??"").slice(0,24))}</td>`).join("")}</tr>`).join("")}
          </table></div>
          <div class="small muted mt">${table.rows.length>5? `… ${table.rows.length-5} more rows`:""}</div>`;
        $("#dlAskCard", c).style.display = "block";
        updateColumnPickers();
        toast(`Loaded ${table.rows.length} rows.`,"success");
      }catch(e){ toast("CSV parse failed: "+e.message,"error",5000); }
    };
    if(file){
      const rd = new FileReader();
      rd.onload = ()=> finish(String(rd.result));
      rd.readAsText(file);
    } else {
      const t = $("#dlPaste", c).value.trim();
      if(t.length<10){ toast("Choose a file or paste CSV text.","error"); return; }
      finish(t);
    }
  }

  function updateColumnPickers(){
    const c = $("#content");
    if(!table) return;
    const cols = table.headers;
    ["dlColA","dlColB","dlColC"].forEach(id=>{
      const sel = $("#"+id, c);
      sel.innerHTML = cols.map(h=>`<option value="${esc(h)}">${esc(h)}</option>`).join("");
    });
    $("#dlColB", c).style.display = "none";
    $("#dlColC", c).style.display = "none";
    const a = $("#dlAnalysis", c).value;
    if(["correlation","ttest","regression"].includes(a)){ $("#dlColB", c).style.display = ""; $("#dlColB", c).closest(".flex").querySelector("label, span"); }
    if(a==="groupmeans"){ $("#dlColC", c).style.display = ""; $("#dlColB", c).style.display = ""; }
  }

  function manualSpec(){
    const c = $("#content");
    const a = $("#dlAnalysis", c).value;
    const A = $("#dlColA", c).value, B = $("#dlColB", c).value, C = $("#dlColC", c).value;
    if(a==="frequency") return RW.DataLab.validateSpec({ analysis:a, column:A }, table.headers);
    if(["correlation","ttest","regression"].includes(a)) return RW.DataLab.validateSpec({ analysis:a, columns:[A,B] }, table.headers);
    if(a==="groupmeans") return RW.DataLab.validateSpec({ analysis:a, group:A, value:B }, table.headers);
    return RW.DataLab.validateSpec({ analysis:a, columns:[A] }, table.headers);
  }

  async function askLLM(){
    const c = $("#content");
    const q = $("#dlQuestion", c).value.trim();
    if(!q){ toast("Type a question about the data.","error"); return; }
    const status = $("#dlStatus", c);
    const btn = $("#dlAsk", c);
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Picking…`;
    try{
      status.textContent = "WebLLM is choosing an analysis from the menu…";
      const spec = await pickSpecWithLLM(q);
      if(!spec){ status.textContent = "Model picked columns that don't exist — use the manual builder below."; return; }
      status.innerHTML = `Model chose: <b>${esc(spec.analysis)}</b> ${esc(JSON.stringify({column:spec.column, columns:spec.columns, group:spec.group, value:spec.value}))} <span class="badge badge-muted">menu-selected, not computed</span>`;
      execute(spec);
    }catch(e){
      status.textContent = "LLM pick failed ("+e.message+") — use the manual builder.";
    }finally{
      btn.disabled = false; btn.innerHTML = "🧠 Ask 🤖";
    }
  }

  function runManual(){
    const c = $("#content");
    const spec = manualSpec();
    if(!spec){ toast("Pick valid columns for that analysis.","error"); return; }
    $("#dlStatus", c).textContent = `Manual spec: ${spec.analysis} ${JSON.stringify({columns:spec.columns, group:spec.group, value:spec.value})}`;
    execute(spec);
  }

  async function execute(spec){
    const c = $("#content");
    const wrap = $("#dlResultWrap", c);
    lastSpec = spec;
    wrap.innerHTML = `<div class="card"><span class="spinner"></span> Computing…</div>`;
    try{
      lastResult = RW.DataLab.analyzeJS(table, spec);
      lastPython = null;
      renderResult("js");
    }catch(e){
      wrap.innerHTML = `<div class="notice notice-danger"><span class="ic">⚠️</span><div>${esc(e.message)}</div></div>`;
    }
  }

  async function crossCheckPython(){
    const c = $("#content");
    const statusEl = $("#dlStatus", c);
    const btn = $("#dlPyBtn");
    btn.disabled = true;
    try{
      const pyResult = await runPython(lastSpec, statusEl);
      lastPython = RW.DataLab.pythonCode(lastSpec);
      renderResult("python", pyResult);
      toast("Python (pandas) cross-check done.","success");
    }catch(e){
      statusEl.textContent = "Python path unavailable: "+e.message+" — JavaScript numbers above are still valid.";
    }finally{
      btn.disabled = false;
    }
  }

  function provenanceBadge(mode, match){
    if(mode==="python") return match
      ? `<span class="badge badge-success">✓ cross-verified: JS + Python(pandas) agree</span>`
      : `<span class="badge badge-warning">⚠ JS and Python disagree — check column types</span>`;
    return `<span class="badge badge-muted">computed in JavaScript (offline fast-path)</span>`;
  }

  function numbersAgree(mode, pyResult){
    if(mode!=="python" || !pyResult) return true;
    const num = v => typeof v === "number" && isFinite(v) ? v : null;
    const close = (a,b)=> a==null && b==null ? true : (a!=null && b!=null && Math.abs(a-b) <= 1e-6*Math.max(1,Math.abs(a)));
    // compare headline numbers between JS and python results
    const a = lastResult, b = pyResult;
    const pick = x => x.perColumn ? x.perColumn[0] : x;
    const pa = pick(a), pb = pick(b);
    const keys = ["mean","median","sd","min","max","r","r2","t","slope","intercept","distinct","n"];
    return keys.some(k=> pa[k]!==undefined || pb[k]!==undefined) &&
      keys.every(k=> (pa[k]===undefined && pb[k]===undefined) || close(num(pa[k]), num(pb[k])) || (pa[k]===undefined||pb[k]===undefined));
  }

  function renderResult(mode, pyResult){
    const c = $("#content");
    const wrap = $("#dlResultWrap", c);
    const r = lastResult;
    let rowsHtml = "";
    if(r.kind==="describe"){
      rowsHtml = `<tr><th>column</th><th>n</th><th>mean</th><th>median</th><th>sd</th><th>min</th><th>max</th></tr>` +
        r.perColumn.map(col=>`<tr><td>${esc(col.column)}</td><td>${col.n} <span class="muted">(+${col.missing} missing)</span></td><td>${fmt(col.mean)}</td><td>${fmt(col.median)}</td><td>${fmt(col.sd)}</td><td>${fmt(col.min)}</td><td>${fmt(col.max)}</td></tr>`).join("");
    } else if(r.kind==="frequency"){
      rowsHtml = `<tr><th>value (${esc(r.column)}; ${r.distinct} distinct)</th><th>count</th></tr>` +
        r.entries.map(e=>`<tr><td>${esc(e.value)}</td><td>${e.count}</td></tr>`).join("");
    } else if(r.kind==="correlation"){
      rowsHtml = `<tr><th>pair</th><th>Pearson r</th><th>n</th></tr><tr><td>${esc(r.columns.join(" vs "))}</td><td><b>${fmt(r.r)}</b></td><td>${r.n}</td></tr>`;
    } else if(r.kind==="groupmeans"){
      rowsHtml = `<tr><th>${esc(r.group)}</th><th>n</th><th>mean ${esc(r.value)}</th><th>sd</th></tr>` +
        r.stats.map(s=>`<tr><td>${esc(s.group)}</td><td>${s.n}</td><td>${fmt(s.mean)}</td><td>${fmt(s.sd)}</td></tr>`).join("");
    } else if(r.kind==="ttest"){
      rowsHtml = `<tr><th>group</th><th>n</th><th>mean</th></tr><tr><td>${esc(r.columns[0])}</td><td>${r.nA}</td><td>${fmt(r.meanA)}</td></tr><tr><td>${esc(r.columns[1])}</td><td>${r.nB}</td><td>${fmt(r.meanB)}</td></tr><tr><td>Welch t (df≈${Math.round((r.df||0)*10)/10})</td><td colspan="2"><b>${fmt(r.t)}</b></td></tr>`;
    } else if(r.kind==="regression"){
      rowsHtml = `<tr><th>term</th><th>value</th></tr><tr><td>slope (per unit ${esc(r.x)})</td><td><b>${fmt(r.slope)}</b></td></tr><tr><td>intercept</td><td>${fmt(r.intercept)}</td></tr><tr><td>r²</td><td>${fmt(r.r2)}</td></tr><tr><td>n</td><td>${r.n}</td></tr>`;
    }
    const match = numbersAgree(mode, pyResult);
    const chart = RW.DataLab.prepareChart(lastSpec, r);
    wrap.innerHTML = `
      <div class="card mt">
        <div class="flex gap-sm wrap mb-sm">
          <span class="badge badge-draft">ADVISORY — descriptive statistics, not interpretation</span>
          ${provenanceBadge(mode, match)}
        </div>
        <div style="overflow-x:auto"><table>${rowsHtml}</table></div>
        ${chart? `<canvas id="dlChart" style="width:100%;height:300px;margin-top:10px;display:block"></canvas>`:""}
        <div class="flex gap-sm wrap mt">
          <button class="btn btn-sm btn-primary" id="dlPyBtn" ${pyFailed?"disabled":""}>🐍 Load Python &amp; cross-check (pandas)</button>
          <button class="btn btn-sm" id="dlMd">⬇️ report .md</button>
        </div>
        ${lastPython? `<details class="mt"><summary class="small muted">Generated Python (executed in WASM sandbox)</summary><pre class="small" style="white-space:pre-wrap;background:var(--surface-2);padding:10px;border-radius:6px;overflow-x:auto">${esc(lastPython)}</pre></details>`:""}
        <div class="small muted mt">The model only selected the analysis (menu item + columns); every number above is computed deterministically in your browser. ${mode==="python"?"Cross-checked with real pandas.":"Load Python for an independent pandas check."}</div>
      </div>`;
    const canvas = $("#dlChart");
    if(canvas && chart) drawChart(canvas, chart);
    $("#dlPyBtn").addEventListener("click", crossCheckPython);
    $("#dlMd").addEventListener("click", exportMd);
  }

  function exportMd(){
    const c = $("#content");
    const tbl = $("#dlResultWrap table", c);
    const rows = Array.from(tbl.querySelectorAll("tr")).map(tr=> Array.from(tr.children).map(td=>td.textContent.trim()).join(" | "));
    const md = `# Data Lab report\n\n- Analysis: ${lastSpec.analysis} ${JSON.stringify({column:lastSpec.column,columns:lastSpec.columns,group:lastSpec.group,value:lastSpec.value})}\n- Data: ${table.rows.length} rows × ${table.headers.length} cols (CSV, processed in-browser)\n\n| ${rows[0].split(" | ").join(" | ")} |\n|${rows[0].split(" | ").map(()=> "---").join("|")}|\n${rows.slice(1).map(r=>`| ${r} |`).join("\n")}\n\n> ADVISORY — descriptive statistics only, computed client-side${lastPython? " and cross-checked with Pyodide/pandas":""}. The LLM only selected the analysis from a fixed menu.\n`;
    RW.downloadBlob(md, "datalab-report.md", "text/markdown");
  }

  Object.assign(RW, { DataLabUI: { render } });
})();
