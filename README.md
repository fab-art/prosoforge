# ProseForge

**Academic `.docx` Sanitizer & Multi-Agent Structural Rewriter**

A 100% client-side Progressive Web App that unpacks an academic `.docx`, scrubs
author/generator metadata, locks every citation and statistical value behind
numbered placeholders, then runs a 5-agent pipeline — coordinated by a
state-machine orchestrator inside a Web Worker — to structurally rewrite body
paragraphs using a WebGPU-accelerated LLM (`@mlc-ai/web-llm`). All processing
happens in the browser. No data ever leaves the user's device.

---

## Highlights

- **5 specialized micro-agents** in a state-machine orchestrator:
  1. `.docx` XML Extractor & Metadata Scrubber (deterministic)
  2. Unicode Sanitizer & Entity/Citation Masker (deterministic)
  3. Triage & Author Style Profiler (deterministic math, 30–50% inference skip)
  4. Structural Rewriter & Rhythm Critic (WebGPU LLM, with deterministic critic pass)
  5. Integrity Auditor & `.docx` XML Rebuilder (deterministic guardrail)
- **Citation & numeric locking.** Every `(Author, Year)`, `[1]`, `p < 0.05`,
  `n = 142`, `42.8%`, `500mg`, year, and decimal is replaced with a numbered
  placeholder before the LLM sees the text. Agent 5 verifies 100% survive the
  rewrite verbatim; otherwise it auto-retries once, then falls back to the
  sanitized original and flags the paragraph for manual review.
- **Metadata scrubbing.** `dc:creator`, `cp:lastModifiedBy`, `Application`,
  `Company`, `TotalTime`, etc. are blanked in `docProps/core.xml` and
  `docProps/app.xml` before repack.
- **Strict extraction.** Tables, headings, footnotes/endnotes, equations
  (`<m:oMath>`), TOC/Caption/Bibliography styles, and headers/footers are
  skipped during paragraph extraction — but left untouched in the document so
  formatting is never corrupted.
- **Innovations baked in:**
  - **IndexedDB checkpoint persistence** — every completed paragraph is
    auto-saved; refresh the tab mid-thesis and you resume from the exact
    paragraph.
  - **Thermal & memory pacing** — micro-yields (`requestIdleCallback`/
    `setTimeout`) between paragraphs and per-paragraph `resetChat()` so
    KV-cache VRAM never bloats across a 50+ page document.
  - **Smart paragraph batching & critic pass** — the rewriter has a deterministic
    critic that re-runs the LLM if AI clichés reappear or sentence-length
    variance collapses.
  - **Deterministic post-LLM typographic polish** — fixes spacing around
    restored citations.
- **Side-by-side diff inspector** — click any paragraph to Accept, Revert,
  Re-roll, or Manually Edit before exporting.
- **One-click export** — rebuilt `.docx` (metadata-scrubbed, citations
  restored) plus an optional `.json` or Markdown audit report.

---

## Tech Stack

| Concern | Choice |
| --- | --- |
| Framework | Vite + React 18 + TypeScript (strict) |
| Styling | Tailwind CSS + `lucide-react` |
| LLM runtime | `@mlc-ai/web-llm` (WebGPU, in a Web Worker) |
| .docx I/O | `jszip` + native `DOMParser`/`XMLSerializer` |
| Diffing | `diff` (word-level side-by-side) |
| PWA | `vite-plugin-pwa` (Workbox, with model CDN exclude rules) |

Default model: `Qwen2.5-3B-Instruct-q4f16_1-MLC` (~2.4 GB VRAM). Alternatives:
`Llama-3.2-3B-Instruct-q4f16_1-MLC`, `gemma-2-2b-it-q4f16_1-MLC`.

---

## Project Layout

```
proseforge/
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
├── vercel.json                 # SPA rewrites + COOP/COEP headers
├── vite.config.ts              # PWA config w/ model-CDN cache exclusion
├── public/
│   ├── favicon.svg
│   └── robots.txt
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── vite-env.d.ts
    ├── types/
    │   └── index.ts            # All shared types (incl. LockedPlaceholders)
    ├── utils/
    │   ├── citations.ts        # Agent 2 placeholder lock/restore/verify
    │   ├── db.ts               # IndexedDB checkpoint persistence
    │   ├── diff.ts             # Word-level diff helper for UI
    │   ├── docx.ts             # Unpack / scrub / parse / repack OpenXML
    │   ├── style.ts            # Burstiness + AI-tell profiling
    │   └── unicode.ts          # Invisible char strip + typographic norm
    ├── agents/
    │   ├── extractor.ts        # Agent 1
    │   ├── sanitizer.ts        # Agent 2
    │   ├── triage.ts           # Agent 3
    │   ├── rewriter.ts         # Agent 4 (LLM + critic)
    │   └── auditor.ts          # Agent 5 (verify, restore, rebuild)
    ├── workers/
    │   └── pipelineWorker.ts   # Orchestrator + WebLLM engine
    ├── hooks/
    │   └── usePipelineWorker.ts
    └── components/
        ├── HardwareBar.tsx     # WebGPU detection + model selector
        ├── SetupDrawer.tsx     # Upload + style sample + glossary + intensity
        ├── Telemetry.tsx       # Live agent stage + metrics
        ├── DiffInspector.tsx   # Side-by-side diff + accept/revert/reroll/edit
        └── ExportPanel.tsx     # Download .docx + audit .json/.md
```

---

## Local Development

```bash
npm install
npm run dev          # http://localhost:5173
```

> **WebGPU requirement.** Use Chrome/Edge 113+ (desktop) or any browser with
> WebGPU enabled. If `navigator.gpu` is missing, the UI shows a clear message.

### Production Build

```bash
npm run build        # tsc -b && vite build  →  ./dist
npm run preview      # serve the production bundle locally
```

The build is verified to compile with **zero TypeScript errors** and produces a
valid production bundle including the PWA service worker.

---

## Deploy to Vercel

The repo is zero-config Vercel-ready. Two options:

### Option A — CLI

```bash
npm i -g vercel
vercel              # preview deployment
vercel --prod       # production deployment
```

### Option B — Dashboard

1. Push this folder to a GitHub/GitLab/Bitbucket repo.
2. In Vercel → **Add New → Project** → import the repo.
3. Framework preset: **Vite**. Build command `npm run build`, output dir `dist`.
4. Click **Deploy**. Vercel reads `vercel.json` automatically.

### `vercel.json` (included)

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "credentialless" },
        { "key": "Cross-Origin-Resource-Policy", "value": "cross-origin" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    }
  ]
}
```

The `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
credentialless` pair enables `SharedArrayBuffer` (used by WebLLM for some
models) while still permitting the cross-origin model CDN fetches from
`huggingface.co` / `raw.githubusercontent.com` / `mlc-ai`. The PWA's Workbox
runtime caching is explicitly configured **never** to cache or purge those
endpoints — model shards live in IndexedDB / Cache API under WebLLM's own
control.

---

## How the Pipeline Works

```
.docx upload
   │
   ▼
[Agent 1] unpack (JSZip) → scrub metadata → parse word/document.xml
   │     (skip tables, headings, footnotes, equations, TOC/Caption)
   ▼
[Agent 2] strip invisible Unicode Cf → normalize AI typographic artifacts
   │     → lock citations/numerics/glossary behind [[CIT_*]] [[NUM_*]] [[TERM_*]]
   ▼
[Agent 3] profile author style (optional) → score burstiness + AI-cliche density
   │     → smart routing: skip paragraphs <25 words or already human-bursty
   ▼
[Agent 4] per-paragraph WebGPU LLM rewrite (style + 2-sentence continuity context)
   │     → critic pass: re-run if AI clichés reappear or variance collapses
   ▼
[Agent 5] verify 100% of placeholders survived → ±15% word-count check
   │     → restore originals → typographic polish → write back into <w:t>
   │     → on failure: retry once, else revert to sanitized original + flag
   ▼
repack .docx → download Blob + audit report (.json / .md)
```

After every paragraph, Agent 5 checkpoints the result to IndexedDB so a tab
refresh resumes from the exact paragraph without losing WebGPU work.

---

## Audit Report

Each export includes a structured audit trail:

- Total / rewritten / skipped / flagged counts
- Citations locked vs. verified
- Average burstiness delta and AI-tell reduction
- Per-paragraph before/after text, placeholders, metrics, and flag reasons

Available as `.json` (machine-readable) or `.md` (human-readable).

---

## Privacy

**No backend.** The `.docx`, its text, your author style sample, your glossary
terms, and all LLM inference stay in your browser. The only network traffic is
the one-time model shard download from the WebLLM CDN (cached in IndexedDB for
subsequent runs). You can verify this by opening DevTools → Network during a
run.

---

## Browser Support

| Browser | Status |
| --- | --- |
| Chrome 113+ (desktop) | ✅ Full WebGPU |
| Edge 113+ (desktop) | ✅ Full WebGPU |
| Brave / Arc / Opera | ✅ if Chromium 113+ |
| Safari 17+ (macOS 14+) | ⚠️ experimental WebGPU (`feature=WebGPU`) |
| Firefox | ⚠️ WebGPU behind `dom.features.webgpu.enabled` |
| iOS / Android Chrome | ⚠️ WebGPU rolling out; results vary |

---

## License

MIT — see `LICENSE` field in `package.json`. No warranty. Always verify
rewritten academic prose yourself before submission; ProseForge is a writing
aid, not a substitute for human judgement.
