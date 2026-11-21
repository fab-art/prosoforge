// ============================================================================
// pipelineWorker.ts — Web Worker: WebLLM engine + state-machine Orchestrator
// ============================================================================
// Runs all heavy XML parsing + LLM execution off the main React thread so the
// UI never freezes. Coordinates the 5 agents through a clean state machine:
//
//   idle -> extracting -> sanitizing -> triaging -> rewriting -> auditing
//        -> rebuilding -> complete
//
// Innovations baked in:
//   - IndexedDB checkpoint persistence (per-paragraph resume after refresh).
//   - Thermal/memory pacing: micro-yields (setTimeout / requestIdleCallback)
//     + WebLLM chat reset between paragraphs to prevent OOM/throttling.
//   - Smart paragraph batching for ultra-short paragraphs.
//   - Pause / resume / cancel controls.

/// <reference lib="webworker" />

import {
  CreateMLCEngine,
  type MLCEngine,
  type InitProgressReport,
  type ChatCompletionMessageParam,
} from "@mlc-ai/web-llm";
import type {
  WorkerRequest,
  WorkerResponse,
  ModelId,
  RewriteIntensity,
  ExtractedParagraph,
  AuditReport,
  AgentStage,
} from "../types";
import type { LlmEngine } from "../agents/rewriter";
import { runExtractor } from "../agents/extractor";
import { runSanitizer } from "../agents/sanitizer";
import { runTriage } from "../agents/triage";
import {
  auditAndRebuildParagraph,
  rebuildDocx,
  type AuditorContext,
} from "../agents/auditor";
import {
  saveParagraphCheckpoint,
  loadCheckpoint,
  saveMeta,
  loadMeta,
  clearCheckpoint,
} from "../utils/db";

// ---------------------------------------------------------------------------
// Engine config
// ---------------------------------------------------------------------------
const MODEL_CONFIG: Record<
  ModelId,
  { id: string; label: string; vramMB: number; ctx: number }
> = {
  "Qwen2.5-3B-Instruct-q4f16_1-MLC": {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 3B Instruct",
    vramMB: 2400,
    ctx: 4096,
  },
  "Llama-3.2-3B-Instruct-q4f16_1-MLC": {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B Instruct",
    vramMB: 2500,
    ctx: 4096,
  },
  "gemma-2-2b-it-q4f16_1-MLC": {
    id: "gemma-2-2b-it-q4f16_1-MLC",
    label: "Gemma 2 2B IT",
    vramMB: 2000,
    ctx: 4096,
  },
};

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
let engine: MLCEngine | null = null;
let currentModelId: ModelId | null = null;
let intensity: RewriteIntensity = "balanced";
let styleSample: string | undefined;
let glossaryTerms: string[] = [];

// Pipeline control
let paused = false;
let cancelled = false;
let processing = false;

// Per-document working set (kept in module scope so pause/resume/reroll can
// reach them across message boundaries without re-marshalling).
interface DocState {
  filename: string;
  unpacked: ReturnType<typeof runExtractor> extends Promise<infer T>
    ? T extends { unpacked: infer U }
      ? U
      : never
    : never;
  paragraphs: ExtractedParagraph[];
  nodes: Element[];
  totalWords: number;
  processed: number;
}
let docState: DocState | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function post(msg: WorkerResponse): void {
  (self as unknown as Worker).postMessage(msg);
}

function log(message: string, level: "info" | "warn" | "error" = "info"): void {
  post({ type: "log", message, level });
}

function setStage(stage: AgentStage): void {
  post({ type: "stage", stage });
}

/** Detect WebGPU availability. */
function detectGpu(): { supported: boolean; reason?: string } {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return {
      supported: false,
      reason:
        "WebGPU is not available in this browser. Use the latest Chrome/Edge (113+) on desktop, or enable WebGPU flags in about:flags.",
    };
  }
  return { supported: true };
}

/** Yield to the event loop so the browser can paint / GC. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** Block until the user resumes after a pause. */
async function awaitResume(): Promise<void> {
  while (paused && !cancelled) {
    await new Promise((r) => setTimeout(r, 150));
  }
  if (cancelled) throw new Error("cancelled");
}

/**
 * WebLLM-backed LlmEngine implementation. Conversation state is reset per
 * paragraph by calling `engine.chat.completions.create` with a fresh
 * message list and resetting chat after each call.
 */
function makeWebLlmEngine(mlc: MLCEngine): LlmEngine {
  return {
    async complete(systemPrompt, userPrompt, onToken) {
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
      // Streaming completion: lets us feed tokens to UI + keeps memory bounded.
      const chunks: string[] = [];
      const stream = await mlc.chat.completions.create({
        stream: true,
        messages,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 1024,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          chunks.push(delta);
          onToken?.(delta);
        }
      }
      return chunks.join("");
    },
    resetChat() {
      // Reset KV-cache & message history so memory does not bloat across
      // a long 50+ page document.
      try {
        mlc.resetChat();
      } catch {
        /* ignore — some model versions throw if no chat exists */
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Model lifecycle
// ---------------------------------------------------------------------------
async function initModel(modelId: ModelId): Promise<LlmEngine> {
  if (engine && currentModelId === modelId) {
    return makeWebLlmEngine(engine);
  }
  if (engine) {
    try {
      await engine.unload();
    } catch {
      /* ignore */
    }
    engine = null;
    currentModelId = null;
  }

  const cfg = MODEL_CONFIG[modelId];
  log(`Loading model: ${cfg.label} (~${cfg.vramMB} MB VRAM)...`);
  const mlc = await CreateMLCEngine(cfg.id, {
    initProgressCallback: (r: InitProgressReport) => {
      post({
        type: "modelProgress",
        progress: r.progress,
        text: r.text,
        timeElapsed: r.timeElapsed,
      });
    },
  });
  engine = mlc;
  currentModelId = modelId;
  post({ type: "modelReady", modelId, vramMB: cfg.vramMB });
  return makeWebLlmEngine(mlc);
}

async function clearModel(): Promise<void> {
  if (engine) {
    try {
      await engine.unload();
    } catch {
      /* ignore */
    }
    engine = null;
    currentModelId = null;
    log("Model unloaded and WebLLM cache cleared.");
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
async function runPipeline(
  docxBlob: ArrayBuffer,
  filename: string
): Promise<void> {
  if (processing) {
    log("Already processing — ignoring duplicate request.", "warn");
    return;
  }
  processing = true;
  cancelled = false;
  paused = false;

  try {
    // --- Agent 1: Extractor + metadata scrub ---
    setStage("extracting");
    log(`Unpacking "${filename}" and scrubbing metadata...`);
    const extracted = await runExtractor({ docxBlob, filename });
    docState = {
      filename,
      unpacked: extracted.unpacked,
      paragraphs: [],
      nodes: (extracted.unpacked as unknown as { __nodes?: Element[] }).__nodes ?? [],
      totalWords: extracted.totalWords,
      processed: 0,
    };
    log(
      `Extracted ${extracted.paragraphs.length} body paragraphs (${extracted.totalWords} words). ` +
        `Scrubbed: ${extracted.scrubbedFields.join(", ") || "none"}.`
    );

    // --- Agent 2: Sanitizer + citation locking ---
    setStage("sanitizing");
    const sanitized = runSanitizer({
      paragraphs: extracted.paragraphs,
      glossaryTerms,
    });
    docState.paragraphs = sanitized.paragraphs;

    // --- Agent 3: Triage ---
    setStage("triaging");
    const triaged = runTriage({
      paragraphs: sanitized.paragraphs,
      styleSample,
      intensity,
    });
    docState.paragraphs = triaged.paragraphs;
    log(
      `Triage: ${triaged.toRewrite} to rewrite, ${triaged.toSkip} skipped (human-bursty or too short).`
    );

    // Persist meta so a refresh can resume.
    await saveMeta({
      filename,
      docxBlob,
      totalParagraphs: triaged.paragraphs.length,
      intensity,
      modelId: currentModelId ?? "Qwen2.5-3B-Instruct-q4f16_1-MLC",
      createdAt: Date.now(),
    });

    // Estimate processing time (~0.8s per rewritten paragraph on a 3B model).
    const estSeconds = Math.round(triaged.toRewrite * 0.8);
    post({
      type: "docStats",
      totalWords: extracted.totalWords,
      totalParagraphs: triaged.paragraphs.length,
      citationsLocked: sanitized.citationsLocked,
      estimatedSeconds: estSeconds,
    });

    // Resume from checkpoint if present.
    const checkpoint = await loadCheckpoint(filename);
    let startIdx = 0;
    if (checkpoint) {
      startIdx = checkpoint.index + 1;
      // Apply the saved paragraph back into the working set.
      const saved = checkpoint.paragraph as ExtractedParagraph;
      if (saved && docState.paragraphs[saved.index]) {
        docState.paragraphs[saved.index] = saved;
        if (saved.outputText && docState.nodes[saved.index]) {
          // Re-write the saved output into the DOM so a final rebuild is correct.
          // (DOM was re-parsed by Agent 1; saved text is the truth.)
          try {
            const { writeParagraphText } = await import("../utils/docx");
            writeParagraphText(docState.nodes[saved.index], saved.outputText);
          } catch {
            /* ignore */
          }
        }
      }
      log(`Resuming from checkpoint at paragraph ${startIdx}.`);
    }

    // --- Agent 4 + 5: Rewrite + Audit per paragraph ---
    if (!engine || !currentModelId) {
      throw new Error(
        "Model not loaded. Select a model and let it finish downloading first."
      );
    }
    const llm = makeWebLlmEngine(engine);
    const ctx: AuditorContext = {
      unpacked: extracted.unpacked,
      modelId: currentModelId,
      intensity,
      styleProfile: triaged.styleProfile,
      engine: llm,
      filename,
      onParagraph: (p) => {
        if (docState) docState.paragraphs[p.index] = p;
        post({ type: "paragraphUpdate", index: p.index, paragraph: p });
      },
    };

    setStage("rewriting");
    let burstinessSum = 0;
    let aiTellSum = 0;
    let counted = 0;

    for (let i = startIdx; i < docState.paragraphs.length; i++) {
      await awaitResume();
      if (cancelled) throw new Error("cancelled");

      const p = docState.paragraphs[i];
      const prev =
        i > 0 ? docState.paragraphs[i - 1] : null;

      // Telemetry: burstiness delta & AI-tell reduction.
      const beforeAiTell = p.metrics?.aiClicheCount ?? 0;
      const beforeStdDev = p.metrics?.sentenceLengthStdDev ?? 0;

      setStage("rewriting");
      try {
        await auditAndRebuildParagraph(p, prev, ctx, docState.nodes);
      } catch (err) {
        log(
          `Paragraph ${i} audit error: ${(err as Error).message}`,
          "error"
        );
        // Fall back to sanitized original so the run keeps going.
        const fallback = { ...p, outputText: p.sanitizedText, status: "flagged" as const, flagReason: (err as Error).message };
        ctx.onParagraph?.(fallback);
      }

      // After audit, recompute metrics on the output for telemetry.
      const updated = docState.paragraphs[i];
      const { profileParagraph } = await import("../utils/style");
      const afterMetrics = profileParagraph(updated.outputText);
      burstinessSum += Math.max(0, afterMetrics.sentenceLengthStdDev - beforeStdDev);
      aiTellSum += Math.max(0, beforeAiTell - afterMetrics.aiClicheCount);
      counted++;

      // Checkpoint + yield for thermal pacing.
      await saveParagraphCheckpoint(filename, i, updated);
      docState.processed = i + 1;
      post({
        type: "telemetry",
        processed: i + 1,
        total: docState.paragraphs.length,
        currentStage: "rewriting",
        burstinessDelta: counted ? burstinessSum / counted : 0,
        aiTellReduction: counted ? aiTellSum / counted : 0,
      });

      // Thermal pacing: yield between paragraphs.
      await yieldToBrowser();
      llm.resetChat();
    }

    // --- Rebuild ---
    setStage("rebuilding");
    log("Rebuilding .docx archive...");
    const blob = await rebuildDocx(extracted.unpacked);

    // Build audit report.
    const report = buildAuditReport(filename, docState.paragraphs, counted ? burstinessSum / counted : 0, counted ? aiTellSum / counted : 0);

    const buf = await blob.arrayBuffer();
    post({ type: "complete", docxBlob: buf, auditReport: report });
    await clearCheckpoint(filename);
    setStage("complete");
    log("Pipeline complete.");
  } catch (err) {
    if ((err as Error).message === "cancelled") {
      post({ type: "cancelled" });
      setStage("idle");
    } else {
      log(`Pipeline error: ${(err as Error).message}`, "error");
      post({ type: "error", message: (err as Error).message, recoverable: false });
      setStage("error");
    }
  } finally {
    processing = false;
  }
}

function buildAuditReport(
  filename: string,
  paragraphs: ExtractedParagraph[],
  burstinessDelta: number,
  aiTellReduction: number
): AuditReport {
  let rewritten = 0;
  let skipped = 0;
  let flagged = 0;
  let citationsLocked = 0;
  let citationsVerified = 0;
  for (const p of paragraphs) {
    if (p.status === "rewritten") rewritten++;
    else if (p.status === "skipped") skipped++;
    else if (p.status === "flagged") flagged++;
    citationsLocked += p.placeholders.citations?.length ?? 0;
    if (p.auditPassed) citationsVerified += p.placeholders.citations?.length ?? 0;
  }
  return {
    filename,
    generatedAt: new Date().toISOString(),
    modelId: currentModelId ?? "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    intensity,
    totalParagraphs: paragraphs.length,
    rewritten,
    skipped,
    flagged,
    citationsLocked,
    citationsVerified,
    avgBurstinessDelta: burstinessDelta,
    avgAiTellReduction: aiTellReduction,
    paragraphs: paragraphs.map((p) => ({
      index: p.index,
      status: p.status,
      before: p.text,
      after: p.outputText,
      placeholders: p.placeholders,
      metrics: p.metrics,
      auditPassed: p.auditPassed,
      flagReason: p.flagReason,
    })),
  };
}

// ---------------------------------------------------------------------------
// Single-paragraph reroll (UI "Re-roll Paragraph" button)
// ---------------------------------------------------------------------------
async function rerollParagraph(
  paragraphIndex: number
): Promise<void> {
  if (!docState || !engine || !currentModelId) {
    post({ type: "error", message: "No active document or model.", recoverable: true });
    return;
  }
  try {
    const p = docState.paragraphs[paragraphIndex];
    const prev =
      paragraphIndex > 0 ? docState.paragraphs[paragraphIndex - 1] : null;
    const llm = makeWebLlmEngine(engine);
    const ctx: AuditorContext = {
      unpacked: docState.unpacked,
      modelId: currentModelId,
      intensity,
      styleProfile: null,
      engine: llm,
      filename: docState.filename,
      onParagraph: (updated) => {
        if (docState) docState.paragraphs[updated.index] = updated;
        post({ type: "paragraphUpdate", index: updated.index, paragraph: updated });
      },
    };
    // Force re-rewrite by resetting status to pending.
    const target: ExtractedParagraph = {
      ...p,
      status: "pending",
      metrics: p.metrics ? { ...p.metrics, shouldRewrite: true } : p.metrics,
    };
    await auditAndRebuildParagraph(target, prev, ctx, docState.nodes);
    log(`Re-rolled paragraph ${paragraphIndex}.`);
  } catch (err) {
    post({ type: "error", message: `Reroll failed: ${(err as Error).message}`, recoverable: true });
  }
}

// ---------------------------------------------------------------------------
// Resume from checkpoint (after a refresh)
// ---------------------------------------------------------------------------
async function resumeFromCheckpoint(filename: string): Promise<void> {
  const meta = await loadMeta(filename);
  if (!meta) {
    post({ type: "error", message: "No checkpoint found for this file.", recoverable: true });
    return;
  }
  log(`Resuming processing for "${filename}"...`);
  await runPipeline(meta.docxBlob, filename);
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init": {
        const gpu = detectGpu();
        post({ type: "gpu", supported: gpu.supported, reason: gpu.reason });
        if (gpu.supported) {
          intensity = msg.intensity;
          styleSample = msg.styleSample;
          glossaryTerms = msg.glossaryTerms ?? [];
          await initModel(msg.modelId);
        }
        break;
      }
      case "process": {
        intensity = msg.intensity;
        styleSample = msg.styleSample;
        glossaryTerms = msg.glossaryTerms ?? [];
        await runPipeline(msg.docxBlob, msg.filename);
        break;
      }
      case "pause": {
        paused = true;
        post({ type: "paused" });
        break;
      }
      case "resume": {
        paused = false;
        post({ type: "resumed" });
        break;
      }
      case "cancel": {
        cancelled = true;
        paused = false;
        break;
      }
      case "reroll": {
        await rerollParagraph(msg.paragraphIndex);
        break;
      }
      case "clearModel": {
        await clearModel();
        break;
      }
      case "restoreCheckpoint": {
        // Just surface what's available; the UI shows a resume button.
        const ck = await loadCheckpoint(msg.filename);
        const meta = await loadMeta(msg.filename);
        if (ck && meta) {
          log(
            `Checkpoint found: ${meta.totalParagraphs} paragraphs, last completed #${ck.index}.`
          );
        } else {
          log(`No checkpoint for "${msg.filename}".`, "warn");
        }
        break;
      }
      case "resumeProcessing": {
        await resumeFromCheckpoint(msg.filename);
        break;
      }
      default: {
        const _exhaustive: never = msg;
        void _exhaustive;
      }
    }
  } catch (err) {
    post({
      type: "error",
      message: (err as Error).message,
      recoverable: true,
    });
  }
};

// Surface WebGPU status on first load.
const gpu0 = detectGpu();
post({ type: "gpu", supported: gpu0.supported, reason: gpu0.reason });
