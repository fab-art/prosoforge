# Feature Roadmap — Reverse-Engineering 15 Research Tools

Goal: replicate the *mechanism* of each commercial tool with free/open, client-side
components + small local LLMs (WebLLM), improved where the commercial versions are
weak (lock-in, cloud-only, non-exportable, ungrounded output). Features land **one
at a time**, each tested before the next starts.

Replacement stack (all free, no server required):

| Need | Component |
|---|---|
| Paper metadata / abstracts / refs | OpenAlex, Semantic Scholar Graph API, CrossRef, arXiv, PubMed E-utilities, DOAJ (all free APIs, CORS-enabled) |
| Small LLM | WebLLM (MLC) in-browser via WebGPU — Llama-3.2-1B/3B, Qwen2.5-1.5B class |
| Grounded Q&A / RAG | local chunking + TF-IDF/BM25 scoring over uploaded PDFs (already built) |
| Graphs / maps | `<canvas>` force-directed layout (hand-rolled, no dependency) |
| Audio overviews | Web Speech API `SpeechSynthesis` (built into browsers, free) |
| Data analysis | Pyodide (CPython → WASM) from CDN, charts via canvas |
| Persistence | localStorage / IndexedDB, full JSON export |

Status legend: ✅ built · 🟡 partial (extension needed) · ⬜ not started

---

## Group A — Literature Discovery & Evidence Extraction

### 1. Consensus ✅ BUILT (Phase 2)
- **Mechanism:** takes a yes/no research question, searches ~200M+ papers, classifies
  each study's evidence relative to the question, shows an agreement meter
  (yes/no/maybe) with direct quotes from abstracts.
- **Weaknesses:** yes/no framing only; abstract-level evidence; paid tiers.
- **Our replacement — Agreement Meter (`consensus.js` + UI):** DONE. Direction-aware
  keyword classifier (supports / contradicts / mixed / inconclusive / off-topic) with
  harm-null exception ("no significant adverse effects" ≠ contradiction), stem-tolerant
  relevance gate, donut meter over decisive papers, per-paper quotes + cue list, WebLLM
  re-check for uncertain cards (AI-tagged).

### 2. Elicit ✅→🟡 (Phase 1 — **BUILDING NOW**)
- **Mechanism:** systematic-review automation — screen papers against
  inclusion/exclusion criteria, extract methodology/outcomes/sample into
  customizable comparison columns, one row per paper, CSV/BibTeX export.
- **Weaknesses:** extraction often from abstract only; cells not always traceable
  to a source sentence; closed, paid.
- **Our replacement (Phase 1 — Evidence Matrix):** built on our existing library.
  Preset extraction columns (study design, population, sample size, methodology,
  findings, outcomes, limitations) + custom columns. **Deterministic heuristic
  extractors** pick the source sentence for every cell (works with no model); WebLLM
  refines on demand. Every cell carries its source sentence; user-editable (AI never
  overwrites edits). Keyword screening with visible matched-keyword reasons.
  CSV export. Fully client-side.

### 3. Semantic Scholar TLDRs ✅ BUILT (Phase 3)
- **Mechanism:** free AI search over 200M+ papers; model-generated one-sentence
  TLDRs; influential-citation counts.
- **Our version:** S2 search results now carry the `tldr` field natively (shown as a
  chip on result cards); other sources get a per-paper "🧾 TL;DR" button →
  `fetchTLDR` by DOI (title-search fallback), cached into the library entry.
  `influentialCitationCount` badges: still open (needs the field in S2 results).

### 4. Undermind ✅ BUILT (Phase 5 — Deep Search loop, `deepsearch.js` + UI)
- **Mechanism:** agentic iterative search — decomposes a hard question, runs
  successive refined queries, follows citation chains, reassesses results each round.
- **Our replacement — Deep Search loop:** round 0 = deterministic seed queries; then
  N rounds where WebLLM looks at what was found and proposes 3 NEW queries aimed at
  gaps (deterministic missing-terms gap-finder without a model). Each query runs
  through the existing 6-API search. **Every paper records which queries found it
  and in which round** (provenance shown per result); dedupe by normalized title
  across rounds. Deterministic coverage stats (distinct sources, year spread,
  question-term coverage with missing terms named). Results framed as **leads, not
  exhaustive coverage**; report exportable as .md.

---

## Group B — Citation Analysis & Mapping

### 5. Scite ✅ BUILT as "Scite-lite" (Phase 2) — abstract-level approximation
- **Mechanism:** "Smart Citations" — a model classifies each citation instance in
  full text as supporting / contrasting / mentioning. Needs their trained corpus.
- **Our approximation — Citation Context (`citecontext.js` + UI):** DONE. Pulls
  citing works from OpenAlex (`filter=cites:`, polite-pool mailto, 429 retry), then
  classifies *citing-paper abstracts* vs. the target with transparent cue regexes
  (supporting / contrasting / mentioning) — matched sentence + cue shown per verdict.
- **Hard limit (stated in UI):** true full-text, instance-level citation sentiment is
  not replicable without their dataset. Abstract-level only; papers need DOI/OpenAlex ID.

### 6. ResearchRabbit ⬜ (Phase 3 — Collection maps)
- **Mechanism:** seed papers → similar-work discovery via citation networks; visual
  collections; co-author maps; free but closed.
- **Our replacement:** collections in our library; "find similar" = bibliographic
  coupling via OpenAlex `referenced_works`; canvas force-graph of papers + authors.

### 7. Connected Papers ✅ BUILT (Phase 3 — Similarity Graph, `simgraph.js` + UI)
- **Mechanism:** builds a similarity graph around a seed using co-citation +
  bibliographic coupling (shared references); node size = citations, position =
  similarity, shading = year.
- **Our version:** seed → OpenAlex; pool = seed's references + its citing works,
  fetched in 3 API calls (seed details, `cites:` query, one batched
  `openalex_id:W1|W2|…` call). Similarity = cosine over shared reference sets
  (bibliographic coupling — transparent math, not their trained SAPS model).
  Canvas force-layout (deterministic spring embedder), node size = citations,
  color = year gradient, edge thickness = similarity; hover tooltip + click panel
  with one-click Collect. Limits stated in UI: coupling favors papers sharing
  citation lists; brand-new papers underrepresented.

### 8. Litmaps ✅ BUILT (Phase 4 — Citation Timeline, `litmaps.js` + UI)
- **Mechanism:** citation networks layered over time; email alerts when new papers
  cite your core set.
- **Our replacement — Citation Timeline:** seed → OpenAlex in 3 API calls (seed,
  its citers, citers-of-citers). Depth = BFS distance from the seed over real
  citation edges (layer ① = direct citers, ② = citers-of-citers, gen-2 papers
  that also cite the seed collapse to layer ①). Canvas: x = year, y = depth band,
  node size = citations, color = year gradient. Edge data is real (each node's
  indexed reference list), but paged — the map is a **sample** of the network,
  stated in the UI.
- **Alerts:** a pure PWA has no server, so instead of email push there is a manual
  "🔔 Check now" that diffs recent OpenAlex citing works against a per-seed
  snapshot in localStorage (first run stores a baseline; later runs report
  newly-appeared citers with one-click Collect).

---

## Group C — Document & PDF Analysis

### 9. NotebookLM ✅ BUILT (Phase 4 — Audio Overview, `audio.js`)
- **Mechanism:** grounded Q&A strictly over uploaded sources with inline citations;
  podcast-style audio overviews.
- **Status:** grounded Q&A over uploaded PDFs was already built (Paper Q&A + RAG).
  Phase 4 added the **Audio Overview**: a two-host dialogue script (Host asks,
  Expert answers) written by WebLLM from the source text — or composed
  deterministically from our flashcard extractors (TL;DR / methods / findings /
  limitations) when no model is loaded. Played with Web Speech `SpeechSynthesis`
  (two distinct system voices), play/pause/stop, rate control, current-line
  highlight, editable script, .txt export, pinnable to the Resource Board.
  Honest limits in UI: system TTS ≠ NotebookLM studio audio; script is a draft.

### 10. SciSpace ✅ BUILT (Phase 4 — Explain selection, `explain.js`)
- **Mechanism:** reading copilot — explains highlighted equations/tables/jargon
  inside PDFs.
- **Our replacement:** a floating selection toolbar (✨ Explain · 🧩 Simplify ·
  📖 Glossary) mounted on the extracted **page viewer** (opened from 📄 page chips
  in chat answers) and on the **Paper Q&A log**. Explain/Simplify use WebLLM with
  the full page (or the selected source's text) as context, plain-language, and
  say when context is insufficient; without a model a deterministic fallback shows
  the containing sentences + detected jargon. The glossary is deterministic per
  document (abbrev pairs, repeated acronyms, rare long words) with optional WebLLM
  definitions, cached per document id. Honest limits: we explain *extracted text*,
  not rendered equations/figures.

### 11. ChatPDF ✅ page anchors BUILT (Phase 3)
- **Mechanism:** chat with one/many PDFs, citations clickable to exact page.
- **Our version:** the chunker now chunks PDF documents **per page**; context
  labels include "— p. N" (so the model cites pages faithfully) and answers carry
  clickable `📄 p. N` chips → a page-viewer modal showing that page's extracted
  text with prev/next navigation. Honest limit (stated in modal): raw PDFs aren't
  persisted in localStorage, so the viewer shows extracted page text, not a
  rasterized page.

### 12. Scholarcy ✅ BUILT (Phase 4 — Flashcards, `flashcards.js` + UI)
- **Mechanism:** turns articles into structured flashcards: key claims, findings,
  methods, limitations, reference extracts.
- **Our replacement:** deterministic section splitting (Abstract / Methods /
  Results / Discussion / Limitations / References) + cue-based extractors → a deck
  per paper (TL;DR, objective, methods + sample sizes, key findings, limitations,
  keywords, abbreviation glossary, reference counts). **Every card shows its
  section and its verbatim source sentences** (Scholarcy's known weakness is
  untraceable cells). Optional 🤖 WebLLM refinement **appends** AI cards — never
  overwrites. Flip-card study grid, decks persist in localStorage, exports
  Markdown + CSV, summary can be pinned to the Resource Board. Library papers are
  abstract-level (labeled); uploaded documents use full text.

---

## Group D — Data Analysis, Writing & Review

### 13. Julius AI ✅ BUILT (Phase 5 — Data Lab, `datalab.js` + UI)
- **Mechanism:** upload spreadsheets, natural-language → generated Python/R,
  executed server-side, charts returned.
- **Our replacement — Data Lab:** CSV parsing + column-type inference (deterministic).
  The LLM's ONLY job is to pick an analysis and columns from a **fixed menu**
  (describe / frequency / correlation / group means / Welch t-test / OLS regression)
  — it never computes numbers and never writes free-form code (stated in UI).
  Numbers come from a **deterministic JavaScript fast-path** (always available) and
  can be **cross-checked with real Pyodide + pandas** executing generated, readable
  Python templates in a WASM sandbox — the UI shows agreement and the exact code.
  Canvas charts. No data leaves the device; Pyodide+pandas (~10–15 MB) load on
  demand and are optional. Python only, not R.

### 14. Jenni AI ✅ BUILT (Phase 5 — Write Pad, `jenni.js`)
- **Mechanism:** sentence autocompletion while writing; in-text citation insertion
  from a large corpus/library checks.
- **Our replacement — Write Pad:** pause typing and WebLLM proposes ONE continuation
  sentence grounded in the top-2 library abstracts (Tab/click to accept). Without a
  model the suggester offers a **verbatim library quote + real in-text citation**
  (honest "quote, don't invent"). `@@` anywhere opens a library picker that inserts
  a formatted APA/MLA/Chicago citation and registers it for export. **Every accepted
  insertion is recorded in an AI-assist log** — assisted spans are visible, never
  hidden. Export .md with references + the transparency log.

### 15. Paperpal ✅ BUILT (Phase 5 — consistency suite, `paperpal.js` + UI)
- **Mechanism:** academic language editing, consistency/terminology checks,
  submission-readiness suite.
- **Our replacement — consistency suite (deterministic, no model needed):**
  6 rules — abbreviation definitions/casing/first-use, unit & percent spacing
  variants, UK-vs-US spelling families, hyphenation variants, bare "eg/ie" style,
  lowercased section headers. Mechanical autofix follows **majority style** and the
  chosen UK/US dialect, with undo; abbreviation unification is reported, never
  auto-merged. Optional WebLLM grammar pass runs on **one paragraph at a time** and
  returns per-suggestion accept/reject (AI never edits silently; accepted edits are
  logged). Save back to the Thesis Workspace or export the report.

---

## Honest limits (stated in-app, not hidden)

1. **Abstract-level evidence.** API results give abstracts, not full text. Claims
   extracted from abstracts are labeled as such; full-text analysis only for
   user-uploaded PDFs / OA full text we can fetch.
2. **Citation sentiment.** Scite-style full-text classification can't be replicated
   without their corpus; our abstract-level approximation is explicitly labeled.
3. **No push alerts.** PWA-only → manual check-for-new-citations instead of email alerts
   (Citation Timeline).
4. **Small-model quality ceiling.** 1B models are weak JSON/prose generators; every
   AI output is a draft the user edits, and heuristic paths always exist when the
   model is off/absent (flashcards, audio scripts and explanations all have
   deterministic fallbacks).
5. **R not Python.** Data Lab executes Python (Pyodide); R users export CSV.
6. **Extracted text, not pixels.** Explain/Flashcards work on extracted text —
   figures and rendered equations are outside reach; audio uses system
   SpeechSynthesis voices, which vary by OS/browser.

## Build order

| Phase | Feature | Status |
|---|---|---|
| 1 | Elicit → **Evidence Matrix** (extraction + screening + CSV) | ✅ built |
| 2 | Consensus → **Agreement Meter** · **Scite-lite citation context** | ✅ built |
| 3 | Connected Papers/Rabbit **similarity graph** · **S2 TLDR badges** · **ChatPDF page anchors** | ✅ built |
| 4 | Scholarcy **flashcards** · SciSpace **explain selection** · NotebookLM **audio overview** · Litmaps **citation timeline + manual alerts** | ✅ built |
| 5 | Julius **Data Lab (Pyodide)** · Jenni **Write Pad** · Paperpal **consistency suite** · Undermind **Deep Search loop** | ✅ built |

**All 15 reverse-engineered tools now have working, honest replacements.** 🎉
Possible phase 6 polish (non-blocking): PRISMA 2020 flow generator, Zotero CSL
round-trip export, multi-agent pipeline, more analysis types in the Data Lab.
