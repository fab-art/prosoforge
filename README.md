# Research Workstation

A free, open, in-browser research assistant — an answerthis.ai-style "upload a paper and chat with it" tool, combined with a full literature-review and thesis-writing workspace. **Everything runs client-side: no account, no backend, your documents never leave the browser.** LLM inference is local via [WebLLM](https://github.com/MLC-AI/web-llm) (WebGPU).

## Features

### answerthis.ai core (the "Upload & Chat" landing)
- **📄 Upload a PDF** (or `.txt` / `.md`) → text is extracted **client-side** with PDF.js → chat with the document.
- **💬 Paper Q&A** grounded in retrieved context. Uses WebLLM if a model is loaded; otherwise falls back to honest keyword-overlap retrieval that says *"this source does not address your question"* rather than guessing.

### Literature review workspace
- **🔍 Literature Search** across 6 free APIs: CrossRef, OpenAlex, Semantic Scholar, arXiv, PubMed, DOAJ. Deduped by title. Manual-entry fallback for paywalled/CSP-blocked papers.
- **🔭 Research Gap Finder** — heuristic flags for recency, geographic concentration, self-reported limitation language, abstract coverage, source diversity. Labeled **ADVISORY**.
- **✍️ AI Writer** — drafts a paragraph grounded **strictly** in your collected papers (and optionally uploaded PDFs). WebLLM synthesis with `[n]` inline citations → real APA/MLA/Chicago in-text citations. Fallback: verbatim-quote scaffold ranked by keyword overlap. Labeled **DRAFT — verify & rewrite**.
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
| Literature search queries → academic APIs (CrossRef, OpenAlex, Semantic Scholar, arXiv, PubMed, DOAJ) | Your draft, notes, citations, uploaded PDF text, scraped resources |
| Scrape URLs → chosen CORS proxy (r.jina.ai / allorigins) | WebLLM model weights & inference |
| WebLLM model download (one-time) → HuggingFace CDN | Everything else |

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
    ├── chat.js            # unified Q&A over papers/docs/resources
    ├── gap.js             # research gap heuristics
    ├── writer.js          # RAG grounded drafting
    ├── workspace.js       # draft editor + style checks
    ├── notes.js           # resource & idea board
    ├── cleaner.js          # document hygiene + AI-tells advisory
    ├── checks.js          # checks summary rollup
    ├── search-ui.js       # literature search view
    ├── citations-ui.js    # citation manager view
    ├── scraper-ui.js      # web scraper view
    ├── upload.js          # answerthis.ai-style upload + chat landing
    ├── settings.js        # model picker + settings view
    └── app.js             # router + init (loaded last)
```

## Known limitations

- **Abstract-only** for API papers (no full-text from search; upload the PDF for full text).
- **Keyword heuristics ≠ semantic understanding** — the gap finder and fallback chat are pattern matchers, and the UI says so.
- **API/CSP-dependent** — some sources may be blocked in certain networks; manual entry exists for exactly this.
- **WebLLM model size** — first load is a large download; subsequent loads are cached.
- **Small-scale LLMs** — a 1B model is not GPT-4. Outputs are starting scaffolds, not finished prose. That's why every output is labeled DRAFT.

## License & ethics

Built as a transparent, inspectable alternative to black-box AI research tools. Per the PRD's "No dark patterns" rule, **no feature helps disguise AI-authored text as human-written or evade detection**. The Document Cleaner does legitimate copy-editing only; the AI-tells panel surfaces patterns for the writer to revise themselves.

Use responsibly. Verify every AI-generated claim against the original sources before relying on it.
