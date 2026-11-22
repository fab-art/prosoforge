/* ============================================================================
   Research Workstation — datalab.js
   PHASE 5a of the feature roadmap: reverse-engineering of **Julius AI**
   (natural-language data analysis).

   Julius' mechanism: upload spreadsheets → LLM writes Python/R → executed on
   their servers → charts returned. Your data leaves the device.

   Our version — the **Data Lab**:
   - CSV parsing + column-type inference (deterministic, no deps).
   - A **constrained analysis menu** (describe / frequency / correlation /
     group means / Welch t-test / OLS regression). The LLM's only job is to
     pick a menu item and columns from your question — it NEVER computes
     numbers and NEVER writes free-form code (1B models can't be trusted with
     either; we say so in the UI).
   - Numbers are computed **twice, deterministically**: a JavaScript fast-path
     (works offline, always available) and — when you click "Load Python" —
     real Pyodide + pandas executing generated, readable Python templates in
     a WebAssembly sandbox. Nothing leaves the device (a genuine improvement
     over Julius for sensitive data). Python only, not R.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};

  /* ---- RFC4180-ish CSV parser (quotes, embedded commas/newlines) ---- */
  function parseCSV(text){
    const rows = [];
    let row = [], field = "", inQ = false;
    const t = String(text||"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
    for(let i=0;i<t.length;i++){
      const ch = t[i];
      if(inQ){
        if(ch === '"'){
          if(t[i+1] === '"'){ field += '"'; i++; }
          else inQ = false;
        } else field += ch;
      } else if(ch === '"'){ inQ = true; }
      else if(ch === ","){ row.push(field); field = ""; }
      else if(ch === "\n"){ row.push(field); field = ""; if(row.length>1 || row[0]!=="") rows.push(row); row = []; }
      else field += ch;
    }
    row.push(field);
    if(row.length>1 || row[0]!=="") rows.push(row);
    if(!rows.length) return { headers: [], rows: [] };
    const headers = rows[0].map((h,i)=> String(h||"").trim() || `col${i+1}`);
    const data = rows.slice(1).filter(r=> r.some(c=> String(c).trim()!==""));
    return { headers, rows: data };
  }

  /* Column type inference: number / date / categorical */
  function inferTypes(headers, rows){
    return headers.map((h,ci)=>{
      let n=0, num=0, date=0, total=0;
      rows.forEach(r=>{
        const v = String(r[ci]??"").trim();
        if(!v) return;
        total++;
        if(v!=="" && !isNaN(Number(v.replace(/,/g,""))) && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$|^-?\d+(,\d{3})+(\.\d+)?$/.test(v.replace(/,/g,""))){ num++; n++; }
        else if(!isNaN(Date.parse(v)) && /\d{4}|\d{1,2}[:/]\d{1,2}/.test(v)){ date++; n++; }
      });
      const type = total===0 ? "empty" : (date/total >= 0.7 && date>=num ? "date" : num/total >= 0.7 ? "number" : "categorical");
      return { name: h, type, filled: total };
    });
  }

  function numericColumn(rows, colIdx){
    return rows.map(r=> Number(String(r[colIdx]??"").replace(/,/g,"")))
      .filter(v=> !isNaN(v) && isFinite(v));
  }

  /* ---- JS statistics (the always-available fast path) ---- */
  function jsStats(values){
    const v = values.filter(x=>!isNaN(x)).sort((a,b)=>a-b);
    const n = v.length;
    if(!n) return { n:0, missing:values.length, mean:null, median:null, sd:null, min:null, max:null };
    const mean = v.reduce((a,b)=>a+b,0)/n;
    const sd = n>1 ? Math.sqrt(v.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(n-1)) : 0;
    const median = n%2 ? v[(n-1)/2] : (v[n/2-1]+v[n/2])/2;
    return { n, missing: values.length-n, mean, median, sd, min:v[0], max:v[n-1] };
  }

  function pearson(xs, ys){
    const n = Math.min(xs.length, ys.length);
    if(n<3) return null;
    const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
    let sxy=0, sxx=0, syy=0;
    for(let i=0;i<n;i++){ const dx=xs[i]-mx, dy=ys[i]-my; sxy+=dx*dy; sxx+=dx*dx; syy+=dy*dy; }
    return (sxx && syy) ? sxy/Math.sqrt(sxx*syy) : null;
  }

  /* Welch's two-sample t-test */
  function welchT(a, b){
    if(a.length<2 || b.length<2) return null;
    const mA = a.reduce((x,y)=>x+y,0)/a.length, mB = b.reduce((x,y)=>x+y,0)/b.length;
    const vA = a.reduce((x,y)=>x+(y-mA)*(y-mA),0)/(a.length-1);
    const vB = b.reduce((x,y)=>x+(y-mB)*(y-mB),0)/(b.length-1);
    const se = Math.sqrt(vA/a.length + vB/b.length);
    if(!se) return null;
    const t = (mA-mB)/se;
    const df = Math.pow(vA/a.length + vB/b.length, 2) /
      ( (vA*vA)/(a.length*a.length*(a.length-1)) + (vB*vB)/(b.length*b.length*(b.length-1)) );
    return { t, df, meanA:mA, meanB:mB, nA:a.length, nB:b.length };
  }

  /* OLS simple regression y = a + b·x */
  function olsXY(xs, ys){
    const n = Math.min(xs.length, ys.length);
    if(n<3) return null;
    const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
    let sxy=0, sxx=0;
    for(let i=0;i<n;i++){ sxy+=(xs[i]-mx)*(ys[i]-my); sxx+=(xs[i]-mx)*(xs[i]-mx); }
    if(!sxx) return null;
    const b = sxy/sxx, a = my - b*mx;
    const r2 = (sxx && (ys.reduce((s,y)=>s+(y-my)*(y-my),0))) ? Math.pow(sxy,2)/(sxx * ys.reduce((s,y)=>s+(y-my)*(y-my),0)) : 0;
    return { intercept:a, slope:b, r2, n };
  }

  /* Execute a validated spec against the table — JS fast path.
     spec: {analysis, column?, columns?, group?, value?, a?, b?} (column = index) */
  function analyzeJS(table, spec){
    const { headers, rows } = table;
    const idx = name => headers.indexOf(name);
    const asNum = name => numericColumn(rows, idx(name));
    switch(spec.analysis){
      case "describe": {
        const cols = spec.columns || [spec.column];
        return { kind:"describe", perColumn: cols.map(c=>({ column:c, type:(inferTypes([c], rows.map(r=>[r[idx(c)]]))[0]||{}).type, ...jsStats(asNum(c)) })) };
      }
      case "frequency": {
        const ci = idx(spec.column);
        const counts = new Map();
        rows.forEach(r=>{ const v = String(r[ci]??"").trim()||"(missing)"; counts.set(v,(counts.get(v)||0)+1); });
        const entries = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 20)
          .map(([value,count])=>({ value, count }));
        return { kind:"frequency", column:spec.column, distinct: counts.size, entries };
      }
      case "correlation": {
        const [cx, cy] = spec.columns;
        const xi = idx(cx), yi = idx(cy);
        const pairs = rows.map(r=>[Number(String(r[xi]??"").replace(/,/g,"")), Number(String(r[yi]??"").replace(/,/g,""))])
          .filter(p=> !isNaN(p[0]) && !isNaN(p[1]));
        const r = pearson(pairs.map(p=>p[0]), pairs.map(p=>p[1]));
        return { kind:"correlation", columns:spec.columns, r, n:pairs.length, pairs: pairs.slice(0,400) };
      }
      case "groupmeans": {
        const gi = idx(spec.group), vi = idx(spec.value);
        const groups = new Map();
        rows.forEach(r=>{
          const g = String(r[gi]??"").trim()||"(missing)";
          const v = Number(String(r[vi]??"").replace(/,/g,""));
          if(!isNaN(v)){ if(!groups.has(g)) groups.set(g,[]); groups.get(g).push(v); }
        });
        const stats = Array.from(groups.entries()).map(([group, vals])=>({ group, n:vals.length, mean: jsStats(vals).mean, sd: jsStats(vals).sd }))
          .sort((a,b)=>b.n-a.n).slice(0, 12);
        return { kind:"groupmeans", group:spec.group, value:spec.value, stats };
      }
      case "ttest": {
        const [ca, cb] = spec.columns;
        const res = welchT(asNum(ca), asNum(cb));
        return { kind:"ttest", columns:spec.columns, ...res };
      }
      case "regression": {
        const [cx, cy] = spec.columns;
        const xi = idx(cx), yi = idx(cy);
        const pairs = rows.map(r=>[Number(String(r[xi]??"").replace(/,/g,"")), Number(String(r[yi]??"").replace(/,/g,""))])
          .filter(p=> !isNaN(p[0]) && !isNaN(p[1]));
        const res = olsXY(pairs.map(p=>p[0]), pairs.map(p=>p[1]));
        return { kind:"regression", x:cx, y:cy, ...res, pairs: pairs.slice(0,400) };
      }
      default: throw new Error("Unknown analysis: "+spec.analysis);
    }
  }

  /* ---- generated Python (Pyodide + pandas) — deterministic templates ---- */
  function pythonCode(spec, filename="data.csv"){
    const q = s => JSON.stringify(String(s));
    switch(spec.analysis){
      case "describe":
        return `import io, json, pandas as pd
df = pd.read_csv(io.StringIO(csv_text))
cols = [${(spec.columns||[spec.column]).map(c=>q(c)).join(", ")}]
num = df[cols].apply(pd.to_numeric, errors="coerce")
res = {c: {"n": int(num[c].notna().sum()), "mean": None if num[c].isna().all() else float(num[c].mean()),
      "median": None if num[c].isna().all() else float(num[c].median()),
      "sd": None if num[c].isna().all() else float(num[c].std()),
      "min": None if num[c].isna().all() else float(num[c].min()),
      "max": None if num[c].isna().all() else float(num[c].max())} for c in cols}
json.dumps(res)`;
      case "frequency":
        return `import io, json, pandas as pd
df = pd.read_csv(io.StringIO(csv_text))
s = df[${q(spec.column)}].astype(str)
res = {"distinct": int(s.nunique()), "entries": [{"value": k, "count": int(v)} for k, v in s.value_counts().head(20).items()]}
json.dumps(res)`;
      case "correlation":
        return `import io, json, pandas as pd
df = pd.read_csv(io.StringIO(csv_text))
x = pd.to_numeric(df[${q(spec.columns[0])}], errors="coerce")
y = pd.to_numeric(df[${q(spec.columns[1])}], errors="coerce")
ok = x.notna() & y.notna()
r = float(x[ok].corr(y[ok]))
json.dumps({"r": r, "n": int(ok.sum())})`;
      case "groupmeans":
        return `import io, json, pandas as pd
df = pd.read_csv(io.StringIO(csv_text))
g = df.groupby(df[${q(spec.group)}].astype(str))[${q(spec.value)}]
g = g.apply(pd.to_numeric, errors="coerce")
res = [{"group": k, "n": int(v.notna().sum()), "mean": None if v.isna().all() else float(v.mean()), "sd": None if v.isna().all() else float(v.std())}
       for k, v in g]
res = sorted(res, key=lambda d: -d["n"])[:12]
json.dumps(res)`;
      case "ttest":
        return `import io, json, pandas as pd
df = pd.read_csv(io.StringIO(csv_text))
a = pd.to_numeric(df[${q(spec.columns[0])}], errors="coerce").dropna()
b = pd.to_numeric(df[${q(spec.columns[1])}], errors="coerce").dropna()
res = {"meanA": float(a.mean()), "meanB": float(b.mean()), "nA": int(len(a)), "nB": int(len(b)),
       "t": float((a.mean()-b.mean())/((a.var(ddof=1)/len(a) + b.var(ddof=1)/len(b))**0.5))}
json.dumps(res)`;
      case "regression":
        return `import io, json, pandas as pd
df = pd.read_csv(io.StringIO(csv_text))
x = pd.to_numeric(df[${q(spec.columns[0])}], errors="coerce")
y = pd.to_numeric(df[${q(spec.columns[1])}], errors="coerce")
ok = x.notna() & y.notna()
x, y = x[ok], y[ok]
xm, ym = x.mean(), y.mean()
b = float(((x-xm)*(y-ym)).sum() / ((x-xm)**2).sum())
a = float(ym - b*xm)
r2 = float((( (x-xm)*(y-ym) ).sum()**2) / (((x-xm)**2).sum() * ((y-ym)**2).sum()))
json.dumps({"intercept": a, "slope": b, "r2": r2, "n": int(ok.sum())})`;
      default: throw new Error("Unknown analysis: "+spec.analysis);
    }
  }

  /* ---- chart data prep for the canvas renderer ---- */
  function prepareChart(spec, result){
    switch(result.kind){
      case "frequency": return { kind:"bar", label:result.column, data: result.entries.map(e=>({ label:String(e.value).slice(0,14), value:e.count })) };
      case "groupmeans": return { kind:"bar", label:`mean ${result.value} by ${result.group}`, data: result.stats.map(s=>({ label:String(s.group).slice(0,14), value:s.mean })) };
      case "correlation": return { kind:"scatter", label:`${result.columns[0]} vs ${result.columns[1]}`, points: result.pairs };
      case "regression": return { kind:"scatter", label:`${result.y} ~ ${result.x}`, points: result.pairs, fit:{ slope:result.slope, intercept:result.intercept } };
      case "describe": {
        const col = result.perColumn[0];
        if(!col || col.n===0) return null;
        return { kind:"hist", label: col.column, data: col.raw || null, summary:col };
      }
      default: return null;
    }
  }

  /* Validate that an LLM-proposed spec references real columns. */
  function validateSpec(spec, headers){
    if(!spec || !spec.analysis) return null;
    const valid = ["describe","frequency","correlation","groupmeans","ttest","regression"];
    if(!valid.includes(spec.analysis)) return null;
    const fix = name => headers.find(h=>h.toLowerCase()===String(name||"").toLowerCase());
    if(spec.analysis==="frequency" || spec.analysis==="groupmeans"){
      spec.column = fix(spec.column); spec.group = fix(spec.group); spec.value = fix(spec.value);
      if(spec.analysis==="frequency" && !spec.column) return null;
      if(spec.analysis==="groupmeans" && (!spec.group || !spec.value)) return null;
      return spec;
    }
    const cols = (spec.columns||[]).map(fix).filter(Boolean);
    if(spec.analysis==="describe"){ return cols.length? {analysis:"describe", columns:cols} : null; }
    // two-column analyses
    if(cols.length<2) return null;
    return { analysis: spec.analysis, columns: cols.slice(0,2) };
  }

  Object.assign(RW, {
    DataLab: {
      parseCSV, inferTypes, numericColumn, jsStats, pearson, welchT, olsXY,
      analyzeJS, pythonCode, prepareChart, validateSpec,
    }
  });
})();
