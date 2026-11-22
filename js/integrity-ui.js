/* ============================================================================
   Research Workstation — integrity-ui.js
   Review tab: surfaces integrity.js results to the writer.
   Three panels: Writing patterns | Plagiarism self-check | Citation audit.

   This is a SELF-CHECK tool. It flags the user's own draft for weak patterns
   and accidental plagiarism against their own source library, and suggests
   fixes the user applies themselves. It never rewrites to evade detection,
   never strips metadata, never promises "undetectable" output.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, saveState, formatCitation, inText } = RW;

  let lastReport = null;

  function render(){
    const c = $("#content");
    const hasDraft = State.draft && State.draft.trim();
    c.innerHTML = `
      <div class="notice notice-advisory"><span class="ic">ℹ️</span><div>
        <b>Self-check, not a verdict.</b> This reviews your own draft against your own source library and flags weak writing patterns (the same patterns external detectors key on, framed here as quality issues) and accidental plagiarism in its four common forms. It <b>does not</b> classify text as "AI" or "human," does not rewrite to evade detection, and does not promise any output will pass any external service. Use it to revise, not to disguise.
      </div></div>

      <div class="card">
        <div class="between mb-sm">
          <div>
            <div class="small muted">Draft to review</div>
            <strong id="reviewDraftStatus">${hasDraft ? `${State.draft.length.toLocaleString()} chars · ${State.draft.split(/\\n\\s*\\n/).filter(Boolean).length} paragraphs` : "no draft yet"}</strong>
          </div>
          <div class="flex gap-sm wrap">
            <button class="btn btn-sm" id="loadFromWorkspace">⬆ Use Workspace draft</button>
            <button class="btn btn-sm" id="pasteDraft">📋 Paste draft</button>
            <button class="btn btn-sm" id="archiveDraft">💾 Archive snapshot</button>
          </div>
        </div>
        <textarea class="textarea" id="reviewInput" style="min-height:140px" placeholder="Paste your draft here, or click 'Use Workspace draft'. Then run the review.">${esc(State.draft || "")}</textarea>
        <div class="flex gap-sm wrap mt">
          <button class="btn btn-primary" id="runReview">🔍 Run integrity review</button>
          <button class="btn" id="tagAiHelp">Tag AI-generated span</button>
          <span class="small muted" style="align-self:center">Wrap AI-generated text in <code>[AI-GENERATED]…[/AI-GENERATED]</code> so the uncredited-use check can remind you to disclose it.</span>
        </div>
      </div>

      <div id="reviewOut"></div>
    `;
    wire(c, hasDraft);
  }

  function wire(c, hasDraft){
    $("#loadFromWorkspace", c).addEventListener("click", ()=>{
      $("#reviewInput", c).value = State.draft || "";
      toast("Loaded from Workspace.", "info");
    });
    $("#pasteDraft", c).addEventListener("click", ()=>{
      navigator.clipboard.readText().then(t=>{
        if(t){ $("#reviewInput", c).value = t; toast("Pasted from clipboard.","success"); }
        else toast("Clipboard empty.","info");
      }).catch(()=> toast("Clipboard read blocked — paste manually (Ctrl+V).","error"));
    });
    $("#archiveDraft", c).addEventListener("click", ()=>{
      const text = $("#reviewInput", c).value.trim();
      if(!text){ toast("Nothing to archive.","error"); return; }
      const title = prompt("Snapshot title (for self-plagiarism tracking across sessions):", "Draft "+new Date().toLocaleDateString());
      if(title === null) return;
      // temporarily set State.draft so archiveCurrentDraft picks it up
      const prev = State.draft;
      State.draft = text;
      const entry = RW.Integrity.archiveCurrentDraft(title);
      State.draft = prev; saveState();
      toast(`Archived as "${entry.title}". Future reviews will check new drafts against it for self-plagiarism.`, "success");
    });
    $("#runReview", c).addEventListener("click", ()=>{
      const text = $("#reviewInput", c).value;
      if(!text.trim()){ toast("Paste or load a draft first.","error"); return; }
      const btn = $("#runReview", c);
      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Analyzing…`;
      // defer so spinner paints
      setTimeout(()=>{
        try{
          lastReport = RW.Integrity.analyzeAll(text);
          renderReport(lastReport, text);
        }catch(e){
          $("#reviewOut", c).innerHTML = `<div class="notice notice-danger"><span class="ic">⚠️</span><div>Review failed: ${esc(e.message)}</div></div>`;
          console.error(e);
        }finally{ btn.disabled = false; btn.innerHTML = "🔍 Run integrity review"; }
      }, 30);
    });
    $("#tagAiHelp", c).addEventListener("click", ()=>{
      const ta = $("#reviewInput", c);
      const start = ta.selectionStart, end = ta.selectionEnd;
      if(start === end){ toast("Select text first, then click 'Tag AI-generated span'.","info"); return; }
      const before = ta.value.slice(0, start);
      const sel = ta.value.slice(start, end);
      const after = ta.value.slice(end);
      ta.value = before + "[AI-GENERATED]" + sel + "[/AI-GENERATED]" + after;
      toast("Tagged. The review will remind you to disclose AI use.","info");
    });
  }

  function renderReport(report, text){
    const out = $("#reviewOut");
    const w = report.writing.summary;
    const p = report.plagiarism.summary || { total:0, byForm:{} };
    const ci = report.citations.summary;
    out.innerHTML = `
      <div class="row">
        <div class="card"><div class="small muted">Writing flags</div><div style="font-size:24px;font-weight:700">${w.flagCount}</div><div class="small muted">${w.bySev.high} high · ${w.bySev.med} med · ${w.bySev.low} low</div></div>
        <div class="card"><div class="small muted">Plagiarism matches</div><div style="font-size:24px;font-weight:700;color:${p.total?'var(--warning)':'var(--success)'}">${p.total}</div><div class="small muted">${Object.entries(p.byForm||{}).map(([k,v])=>`${formLabel(k)}: ${v}`).join(" · ") || "none"}</div></div>
        <div class="card"><div class="small muted">Citations found</div><div style="font-size:24px;font-weight:700">${ci.total}</div><div class="small muted">${ci.inLibrary} in library · ${ci.notInLibrary+ci.unresolved} unresolved</div></div>
        <div class="card"><div class="small muted">Corpus size</div><div style="font-size:24px;font-weight:700">${report.plagiarism.corpusSize||0}</div><div class="small muted">sources compared against</div></div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">✍️ Writing-pattern review</h3>
        <div class="small muted mb">Weak patterns reviewers and detectors both key on. Fix them to improve the writing — not to "pass" anything. Highlights show the exact span.</div>
        ${renderWritingFlags(report.writing)}
      </div>

      <div class="card">
        <h3 style="margin-top:0">📋 Plagiarism self-check</h3>
        <div class="small muted mb">Compares your draft against sources in your library (uploaded PDFs, collected papers, scraped resources${(State.pastDrafts&&State.pastDrafts.length)?`, ${State.pastDrafts.length} archived draft(s)`:""}). ${report.plagiarism.note ? esc(report.plagiarism.note) : ""}</div>
        ${renderPlagiarismMatches(report.plagiarism)}
      </div>

      <div class="card">
        <h3 style="margin-top:0">📖 Citation audit</h3>
        <div class="small muted mb">Every DOI / arXiv ID / URL / inline citation found in the draft, checked against your library. Unresolved = the reference isn't in your library (could be a real citation you haven't collected, or a hallucinated one).</div>
        ${renderCitationAudit(report.citations)}
      </div>

      <div class="card">
        <h3 style="margin-top:0">📌 Reviewer-ready summary</h3>
        <div class="small muted mb">Paste this into your methods/limitations section to disclose how you used this tool. Honest disclosure is the strongest protection against false suspicion.</div>
        <textarea class="textarea mono" style="min-height:120px;font-size:12px" id="disclosureText">${esc(buildDisclosure(report))}</textarea>
        <button class="btn btn-sm mt" id="copyDisclosure">📋 Copy</button>
      </div>
    `;
    wireReportActions(report);
  }

  function renderWritingFlags(writing){
    if(!writing.summary.flagCount) return `<div class="empty" style="padding:20px">✓ No weak patterns flagged. (This doesn't mean the writing is good — it means none of the ~7 patterns we check appeared.)</div>`;
    return writing.paras.flatMap(pr => pr.flags.map(f => ({...f, paraIdx:pr.idx, paraText:pr.text})))
      .sort((a,b)=> sevRank(b.sev)-sevRank(a.sev))
      .map(f => `
        <div class="card" style="background:var(--surface-2);padding:10px;margin-bottom:8px">
          <div class="flex gap-sm wrap mb-sm">
            <span class="badge ${sevBadge(f.sev)}">${f.sev.toUpperCase()}</span>
            <span class="badge badge-muted">¶${f.paraIdx+1}</span>
            <strong>${esc(f.label)}</strong>
          </div>
          <div class="small muted mb-sm">Why: ${esc(f.why)}</div>
          <div class="small mb-sm"><b>Suggested fix:</b> ${esc(f.fix)}</div>
          ${f.detail ? `<div class="small muted mono">↳ ${esc(f.detail)}</div>` : ""}
          <details class="mt-sm"><summary>Show flagged passage</summary>
            <div class="small mono" style="background:var(--surface);padding:8px;border-radius:4px;border-left:3px solid var(--warning);white-space:pre-wrap">${esc(f.paraText.slice(Math.max(0,f.start-30), f.end+30))}</div>
          </details>
        </div>
      `).join("");
  }

  function renderPlagiarismMatches(plag){
    const ms = plag.matches || [];
    if(!ms.length) return `<div class="empty" style="padding:20px">✓ No plagiarism matches against your library. (Only checks sources you've collected; doesn't cover the open internet.)</div>`;
    return ms.map(m => `
      <div class="card" style="background:var(--surface-2);padding:10px;margin-bottom:8px">
        <div class="flex gap-sm wrap mb-sm">
          <span class="badge ${formBadge(m.form)}">${formLabel(m.form).toUpperCase()}</span>
          <span class="badge ${sevBadge(m.sev)}">${m.sev.toUpperCase()}</span>
          ${m.sourceKind ? `<span class="badge badge-muted">${esc(m.sourceKind)}</span>` : ""}
          ${m.similarity ? `<span class="badge badge-muted">sim ${(m.similarity*100).toFixed(0)}%</span>` : ""}
          ${m.matchedShingles ? `<span class="badge badge-muted">${m.matchedShingles}/${m.totalShingles} 5-grams</span>` : ""}
        </div>
        <div class="small muted mb-sm"><b>Your draft:</b> ${esc(m.draftSentence || m.excerpt || "")}</div>
        ${m.sourceSentence ? `<div class="small muted mb-sm"><b>Source passage:</b> ${esc(m.sourceSentence)}</div>` : ""}
        ${m.sourceTitle ? `<div class="small muted mb-sm"><b>From:</b> ${esc(m.sourceTitle)}${m.sourceYear?", "+m.sourceYear:""}${m.sourceVenue?" · "+esc(m.sourceVenue):""}${m.sourceUrl?` · <a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener">↗</a>`:""}</div>` : ""}
        <div class="small"><b>Suggested fix:</b> ${esc(m.fix)}</div>
      </div>
    `).join("");
  }

  function renderCitationAudit(ca){
    if(!ca.summary.total) return `<div class="empty" style="padding:20px">No citations (DOIs, arXiv IDs, URLs, or inline (Author, year) markers) detected in the draft.</div>`;
    return `
      <table>
        <tr><th>Type</th><th>Value</th><th>Status</th><th>Action</th></tr>
        ${ca.citations.map((cit,i) => `
          <tr>
            <td><span class="badge badge-muted">${cit.type}</span></td>
            <td class="mono small">${esc(cit.value)}</td>
            <td>${renderCitStatus(cit)}</td>
            <td>${cit.type==="doi" ? `<button class="btn btn-sm" data-verify-doi="${i}">Verify online</button>` : "—"}</td>
          </tr>
        `).join("")}
      </table>
      <div class="small muted mt"><b>Legend:</b> ✓ in library = matches a paper/citation you collected · ? unresolved = not found in your library (collect it or verify it exists) · ✗ online 404 = CrossRef has no record — likely hallucinated.</div>
    `;
  }

  function renderCitStatus(cit){
    if(cit.status === "in_library") return `<span class="badge badge-success">✓ in library</span>`;
    if(cit.status === "not_in_library") return `<span class="badge badge-warning">? not in library</span>`;
    if(cit.status === "unresolved") return `<span class="badge badge-warning">? unresolved</span>`;
    return `<span class="badge badge-muted">${cit.status}</span>`;
  }

  function buildDisclosure(report){
    const w = report.writing.summary, p = report.plagiarism.summary||{}, ci = report.citations.summary;
    return `Methods note (suggested disclosure):

"This work was prepared using the Research Workstation self-check tool, which
(a) flagged ${w.flagCount} writing-pattern issues (uniform sentence rhythm,
generic phrases, low lexical diversity, missing specifics, long sentences)
that the author revised; (b) compared the draft against ${report.plagiarism.corpusSize||0}
sources in the author's personal library and flagged ${p.total||0} potential
plagiarism matches (${Object.entries(p.byForm||{}).map(([k,v])=>`${v} ${formLabel(k)}`).join(", ")||"none"}),
each of which the author reviewed and either quoted with citation, paraphrased
with citation, or removed; and (c) audited ${ci.total} in-text citations,
finding ${ci.inLibrary} resolved against the author's library and ${ci.notInLibrary+ci.unresolved}
unresolved (verified manually). No generative-AI text was used in the final
manuscript unless explicitly tagged and disclosed above."
    `.trim();
  }

  function wireReportActions(report){
    $("#copyDisclosure")?.addEventListener("click", ()=>{
      const t = $("#disclosureText").value;
      navigator.clipboard.writeText(t).then(()=> toast("Disclosure copied.","success"));
    });
    $$("[data-verify-doi]").forEach(b => b.addEventListener("click", async ()=>{
      const idx = parseInt(b.dataset.verifyDoi);
      const cit = report.citations.citations[idx];
      if(!cit) return;
      b.disabled = true; b.innerHTML = `<span class="spinner"></span>`;
      const r = await RW.Integrity.verifyDoiOnline(cit.value);
      b.disabled = false;
      if(r.verified){
        b.outerHTML = `<span class="badge badge-success">✓ verified online</span>`;
        toast("DOI verified against CrossRef.","success");
      } else {
        b.outerHTML = `<span class="badge badge-danger">✗ ${esc(r.reason||"not found")}</span>`;
        toast("DOI not verified: "+(r.reason||"not found"),"error", 5000);
      }
    }));
  }

  function formLabel(k){
    return ({
      direct_copy: "direct copy",
      improper_paraphrase: "improper paraphrase",
      uncredited_ai: "uncredited AI/media",
      self_plagiarism: "self-plagiarism",
    })[k] || k;
  }
  function formBadge(k){
    return ({
      direct_copy: "badge-danger",
      improper_paraphrase: "badge-warning",
      uncredited_ai: "badge-advisory",
      self_plagiarism: "badge-warning",
    })[k] || "badge-muted";
  }
  function sevRank(s){ return {high:3, med:2, low:1}[s] || 0; }
  function sevBadge(s){ return {high:"badge-danger", med:"badge-warning", low:"badge-muted"}[s] || "badge-muted"; }

  Object.assign(RW, { IntegrityUI: { render } });
})();
