# Research Workstation

A free, open, in-browser research assistant — an answerthis.ai-style "upload a paper and chat with it" tool, combined with a full literature-review and thesis-writing workspace. **Everything runs client-side: no account, no backend, your documents never leave the browser.** LLM inference is local via [WebLLM](https://github.com/MLC-AI/web-llm) (WebGPU).

## Features

### answerthis.ai core (the "Upload & Chat" landing)
- **📄 Upload a PDF** (or `.txt` / `.md`) → text is extracted **client-side** with PDF.js → chat with the document.
- **💬 Paper Q&A** grounded in retrieved context. Uses WebLLM if a model is loaded; otherwise falls back to honest keyword-overlap retrieval that says *"this source does not address your question"* rather than guessing. Answers carry clickable `📄 p. N` chips → a page-text viewer where you can **select any passage → ✨ Explain / 🧩 Simplify / 📖 Glossary** (SciSpace-style reading copilot on extracted text).

### Literature review workspace
- **🔍 Literature Search** across 6 free APIs: CrossRef, OpenAlex, Semantic Scholar, arXiv, PubMed, DOAJ. Deduped by title. Manual-entry fallback for paywalled/CSP-blocked papers. S2 results carry their native TLDR chip.
- **🌀 Deep Search** — Undermind-style iterative loop: seed queries, then new rounds aimed at what's missing (WebLLM-refined, or a deterministic gap-finder without a model). Every paper shows **which queries found it and in which round**; deterministic coverage stats name the question terms with no hits. Results are framed as **leads, not exhaustive coverage**.
- **🔭 Research Gap Finder** — heuristic flags for recency, geographic concentration, self-reported limitation language, abstract coverage, source diversity. Labeled **ADVISORY**.
- **🔬 Evidence Matrix** — Elicit-style extraction & screening (Phase 1).
- **⚖️ Agreement Meter** — Consensus-style yes/no evidence meter (Phase 2).
- **🔗 Citation Context** — Scite-lite supporting/contrasting/mentioning classification of citing abstracts, with matched cue sentences (Phase 2).
- **🕸️ Similarity Graph** — Connected Papers-style bibliographic-coupling graph on a hand-rolled canvas force layout (Phase 3).
- **🗺️ Citation Timeline** — Litmaps-style: citation layers over time (seed → ① direct citers → ② citers-of-citers; x = year, node size = citations, color = year) + a **manual** "🔔 check for new citing papers" alert that diffs OpenAlex against your last snapshot (a pure PWA has no server → no push, and the UI says so).
- **🎴 Flashcards** — Scholarcy-style study decks from any paper/document: TL;DR, objective, methods + sample sizes, key findings, limitations, keywords, abbreviation glossary, reference extracts. **Every card carries its verbatim source sentences.** Optional WebLLM refinement appends 🤖 AI cards (never overwrites). Flip-card grid, decks persist, Markdown/CSV export, pin to the board.
- **🎧 Audio Overview** — NotebookLM-style two-host podcast dialogue about your source, written by WebLLM (or composed deterministically without a model) and read aloud with two built-in browser voices. Play/pause/stop, rate control, editable script, .txt export, pin to the board.
- **✍️ AI Writer** — drafts a paragraph grounded **strictly** in your collected papers (and optionally uploaded PDFs). WebLLM synthesis with `[n]` inline citations → real APA/MLA/Chicago in-text citations. Fallback: verbatim-quote scaffold ranked by keyword overlap. Labeled **DRAFT — verify & rewrite**.
- **🪄 Write Pad** — Jenni-style drafting: pause and WebLLM proposes one continuation sentence grounded in your library (Tab to accept); type `@@` to insert a formatted citation from your library. Without a model it offers verbatim library quotes + real citations instead. Every accepted insertion is recorded in an **AI-assist log** — nothing AI-written hides in your text. Export .md with references + transparency log.
- **🧪 Data Lab** — Julius-style analysis with your data staying on the device: load a CSV, ask a question; the model's only job is to pick an analysis and columns from a fixed menu (describe / frequency / correlation / group means / t-test / regression) — it never computes numbers or writes free-form code. Numbers come from a deterministic JavaScript fast-path and can be cross-checked with real **Pyodide + pandas** in a WASM sandbox (generated Python shown). Canvas charts, .md report.
- **🎓 Paperpal** — deterministic consistency suite: abbreviation definitions & casing, unit/percent spacing, UK-vs-US spelling families, hyphenation variants, "eg/ie" style, lowercased headers. Mechanical autofix follows majority style + your chosen dialect, with undo. Optional WebLLM grammar pass on one paragraph at a time with **per-suggestion accept/reject** (logged).
- **📝 Thesis Workspace** — draft editor with live per-paragraph style checks (sentence-length uniformity, AI-cliché phrases, passive-voice density). Advisory only, never auto-edits. Export to `.md` / `.html` / `.txt`.
- **📌 Resource & Idea Board** — tagged, searchable notes. localStorage only.
- **📖 Citation Manager** — manual entry + one-click import from your paper library; APA/MLA/Chicago auto-formatting with serial commas.
- **🕷️ Web Scraper** — fetch any URL via a CORS proxy (r.jina.ai recommended), extract readable text, save as a chat-able resource.
- **🧹 Document Cleaner** — legitimate copy-editing (whitespace, smart quotes, spacing) + an advisory "AI-tells" panel. **NOT an evasion tool**: it will never strip metadata or disguise AI authorship.
- **✅ Checks Summary** — rollup of workspace flags across the whole draft.

### Honesty by design (PRD §7 "No dark patterns")
Every AI/heuristic output wears a visible **DRAFT** or **ADVISORY** badge and an explanatory notice. The AI Writer quotes source sentences verbatim with citations — it never paraphrases into plausibly-human prose, never strips metadata, never fabricates sources.

## Privacy

| What leaves your browser | What stays local |
|---|---|
| Literature search queries → academic APIs (CrossRef, OpenAlex, Semantic Scholar, arXiv, PubMed, DOAJ) | Your draft, notes, citations, uploaded PDF text, scraped resources, CSV data |
| Scrape URLs → chosen CORS proxy (r.jina.ai / allorigins) | WebLLM model weights & inference |
| WebLLM model download (one-time) → HuggingFace CDN | Data Lab: CSV + all computed numbers (JS fast-path; optional Pyodide/pandas run locally in WASM) |

No login, no analytics, no cookies beyond localStorage.

## Deploy to Vercel

This is a **static site** — no build step, no server functions.

### Option A: drag-and-drop (fastest)
1. Unzip `research-workstation-pwa.zip`.
2. Go to [vercel.com/new](https://vercel.com/new).
3. Drag the unzipped folder onto the page.
4. Click **Deploy**. Done.

### Option B: Git
1. Unzip, `cd` into the folder, `git init && git add . && git commit -m "init"`.
2. Push to a GitHub/GitLab/Bitbucket repo.
3. In Vercel, **New Project** → import the repo. Framework preset: **Other**. Build command: *(none)*. Output directory: *(root)*. Deploy.

### Option C: Vercel CLI
```bash
npm i -g vercel
cd research-workstation-pwa
vercel deploy --prod
```

`vercel.json` is included with security headers, `cleanUrls`, and correct `Content-Type` / `Service-Worker-Allowed` for `sw.js` and `manifest.json`.

## Status

All 15 reverse-engineered tools have working replacements — see `ROADMAP.md` for the per-tool mechanism notes and honest limits.

## Run locally

No dependencies. Just serve the folder over HTTP (service workers require http(s), not `file://`):

```bash
cd research-workstation-pwa
python3 -m http.server 8080
# open http://localhost:8080
```

Or open `index.html` directly for a quick look (PWA/offline features won't register, but the app works).

## Using WebLLM (the in-browser LLM)

1. Go to **Settings → WebLLM**.
2. Pick a model (Llama 3.2 1B is smallest/fastest, ~0.8 GB).
3. Click **Load model**. The first load downloads weights and caches them.
4. Once loaded, **Paper Q&A** and **AI Writer** use local LLM synthesis. Without a model loaded, they use the keyword-retrieval fallback (still fully functional, just less sophisticated).

**Requires a WebGPU-capable browser:** Chrome/Edge 113+, or Safari 18+. If WebGPU is unavailable, the app still works in keyword mode.

## Install as a PWA

Once deployed (or served over https), the browser's install prompt lets you add Research Workstation to your home screen / desktop. It works offline after first load (app shell is cached; WebLLM model, once downloaded, is also cached).

## Project structure

```
research-workstation-pwa/
├── index.html              # app shell + script tags
├── manifest.json           # PWA manifest
├── vercel.json             # Vercel config + security headers
├── sw.js                   # service worker (offline cache)
├── .gitignore
├── README.md              # this file
├── css/
│   └── app.css            # all styles (light/dark theme, responsive)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-maskable-512.png
│   └── icon-32.png
└── js/
    ├── utils.js           # shared namespace, state, persistence, helpers
    ├── webllm.js          # WebLLM loader + unified ask() with keyword fallback
    ├── citations.js       # APA/MLA/Chicago formatters
    ├── search.js          # 6 API adapters + dedupe
    ├── pdf.js             # PDF.js upload + text extraction
    ├── scraper.js         # CORS-proxy web scraper
    ├── chat.js            # unified Q&A + page viewer (ChatPDF anchors)
    ├── gap.js             # research gap heuristics
    ├── matrix.js          # Evidence Matrix extraction/screening (Elicit)
    ├── consensus.js       # Agreement Meter evidence classification (Consensus)
    ├── citecontext.js     # Scite-lite citation-context classification
    ├── simgraph.js        # bibliographic-coupling similarity graph (Connected Papers)
    ├── litmaps.js         # citation timeline layers + alert diffs (Litmaps)
    ├── flashcards.js      # deterministic flashcard extractors (Scholarcy)
    ├── audio.js           # two-host dialogue + SpeechSynthesis player (NotebookLM)
    ├── explain.js         # selection explain/simplify + glossary (SciSpace)
    ├── writer.js          # RAG grounded drafting
    ├── workspace.js       # draft editor + style checks
    ├── notes.js           # resource & idea board
    ├── cleaner.js          # document hygiene + AI-tells advisory
    ├── checks.js          # checks summary rollup
    ├── integrity.js       # integrity review engine
    ├── search-ui.js       # literature search view
    ├── citations-ui.js    # citation manager view
    ├── scraper-ui.js      # web scraper view
    ├── upload.js          # answerthis.ai-style upload + chat landing
    ├── integrity-ui.js    # integrity review view
    ├── matrix-ui.js       # evidence matrix view
    ├── consensus-ui.js    # agreement meter view
    ├── citecontext-ui.js  # citation context view
    ├── simgraph-ui.js     # similarity graph canvas view
    ├── litmaps-ui.js      # citation timeline canvas view
    ├── flashcards-ui.js   # flashcards view
    ├── datalab.js         # CSV parsing, stats, JS fast-path, Python templates (Julius)
    ├── datalab-ui.js      # data lab view (Pyodide loader, canvas charts)
    ├── jenni.js           # write pad: completions, @@ cite-insert, assist log (Jenni)
    ├── paperpal.js        # deterministic consistency checks + autofix (Paperpal)
    ├── paperpal-ui.js     # consistency suite view + grammar pass
    ├── deepsearch.js      # iterative query loop with provenance (Undermind)
    ├── deepsearch-ui.js   # deep search view
    ├── settings.js        # model picker + settings view
    └── app.js             # router + init (loaded last)
```

## Known limitations

- **Abstract-only** for API papers (no full-text from search; upload the PDF for full text). Flashcards built from library papers are labeled abstract-level.
- **Keyword heuristics ≠ semantic understanding** — the gap finder, fallback chat and deterministic extractors are pattern matchers, and the UI says so.
- **API/CSP-dependent** — some sources may be blocked in certain networks; manual entry exists for exactly this.
- **WebLLM model size** — first load is a large download; subsequent loads are cached.
- **Small-scale LLMs** — a 1B model is not GPT-4. Outputs are starting scaffolds, not finished prose. That's why every output is labeled DRAFT.
- **Timeline is a sample** — the Citation Timeline draws what OpenAlex pages return, not the complete citation graph.
- **Manual alerts** — no push/email alerts are possible without a server; the check button diffs on demand.
- **System voices** — Audio Overview uses built-in SpeechSynthesis voices; quality varies by OS/browser and won't match NotebookLM's studio audio.
- **Deep Search = leads** — the loop fires bounded API calls per round and is limited by a small model's query imagination; it is not a systematic search.
- **Data Lab** — CSV only (Excel files need exporting first); the optional Pyodide+pandas add-on downloads ~10–15 MB on first use; the LLM selects analyses from a fixed menu and never computes numbers.
- **Grammar pass** — the WebLLM grammar check runs on one paragraph at a time (small-model context limits); deterministic consistency checks have no such limit.

## License & ethics

Built as a transparent, inspectable alternative to black-box AI research tools. Per the PRD's "No dark patterns" rule, **no feature helps disguise AI-authored text as human-written or evade detection**. The Document Cleaner does legitimate copy-editing only; the AI-tells panel surfaces patterns for the writer to revise themselves.

Use responsibly. Verify every AI-generated claim against the original sources before relying on it.
