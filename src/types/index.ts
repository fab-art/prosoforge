// ============================================================================
// ProseForge — Shared Type Definitions
// ============================================================================
// All cross-module types live here. Workers, agents, and UI import from here.
// Keep this file free of runtime code so it can be safely tree-shaken.

/** Which model the WebGPU engine should load. */
export type ModelId =
  | "Qwen2.5-3B-Instruct-q4f16_1-MLC"
  | "Llama-3.2-3B-Instruct-q4f16_1-MLC"
  | "gemma-2-2b-it-q4f16_1-MLC";

/** How aggressively Agent 4 rewrites each paragraph. */
export type RewriteIntensity = "conservative" | "balanced" | "deep";

/** Stage of the orchestrator state-machine currently executing. */
export type AgentStage =
  | "idle"
  | "extracting"
  | "sanitizing"
  | "triaging"
  | "rewriting"
  | "auditing"
  | "rebuilding"
  | "complete"
  | "error";

/** Status of an individual paragraph through the pipeline. */
export type ParagraphStatus =
  | "pending"
  | "skipped"
  | "rewritten"
  | "flagged"
  | "rerun";

/** Locked placeholder bundle produced by Agent 2 and consumed by Agent 5. */
export interface LockedPlaceholders {
  /** Placeholder token -> original substring. e.g. "[[CIT_1]]" -> "(Smith, 2020)" */
  map: Record<string, string>;
  /** Citation tokens (CIT_*) — must survive verbatim. */
  citations: string[];
  /** Numeric tokens (NUM_*) — must survive verbatim. */
  numerics: string[];
  /** Term tokens (TERM_*) — user glossary. */
  terms: string[];
}

/**
 * A single body paragraph as extracted from word/document.xml.
 * Carries its own pPr/rPr serialization so Agent 5 can rebuild verbatim.
 */
export interface ExtractedParagraph {
  /** Stable 0-based index in document order. */
  index: number;
  /** Original (unsanitized) plain text of all <w:t> nodes joined. */
  text: string;
  /** Sanitized text with placeholders locked in. */
  sanitizedText: string;
  /** Final output text (after rewrite + citation restore). */
  outputText: string;
  /** Serialized <w:p> XML (Agent 1 original). */
  xml: string;
  /** Map of placeholder token -> real citation/value (Agent 2). */
  placeholders: LockedPlaceholders;
  /** Triage metrics (Agent 3). */
  metrics: ParagraphMetrics | null;
  /** Triage verdict. */
  status: ParagraphStatus;
  /** If flagged, why (Auditor). */
  flagReason?: string;
  /** Citation/numeric placeholders verified present post-rewrite. */
  auditPassed?: boolean;
  /** Number of LLM passes applied (for telemetry). */
  llmPasses?: number;
  /** Was this paragraph batched with neighbors? */
  batched?: boolean;
}

/** Per-paragraph burstiness/AI-tell metrics from Agent 3. */
export interface ParagraphMetrics {
  wordCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  sentenceLengthStdDev: number;
  passiveRatio: number;
  aiClicheCount: number;
  aiClicheList: string[];
  shouldRewrite: boolean;
  skipReason?: "too_short" | "human_bursty" | "no_cliches";
}

/** Author style baseline computed from a sample. */
export interface StyleProfile {
  wordCount: number;
  avgSentenceLength: number;
  sentenceLengthStdDev: number;
  passiveRatio: number;
}

/** ============================================================================
 * Worker <-> Main thread message protocol.
 * ==========================================================================*/
export type WorkerRequest =
  | {
      type: "init";
      modelId: ModelId;
      intensity: RewriteIntensity;
      styleSample?: string;
      glossaryTerms?: string[];
    }
  | {
      type: "process";
      docxBlob: ArrayBuffer;
      filename: string;
      intensity: RewriteIntensity;
      styleSample?: string;
      glossaryTerms?: string[];
    }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancel" }
  | { type: "reroll"; paragraphIndex: number }
  | { type: "clearModel" }
  | { type: "restoreCheckpoint"; filename: string }
  | { type: "resumeProcessing"; filename: string };

export type WorkerResponse =
  | { type: "log"; message: string; level?: "info" | "warn" | "error" }
  | { type: "gpu"; supported: boolean; reason?: string }
  | {
      type: "modelProgress";
      progress: number;
      text: string;
      timeElapsed?: number;
    }
  | { type: "modelReady"; modelId: ModelId; vramMB: number }
  | {
      type: "docStats";
      totalWords: number;
      totalParagraphs: number;
      citationsLocked: number;
      estimatedSeconds: number;
    }
  | { type: "stage"; stage: AgentStage }
  | {
      type: "paragraphUpdate";
      index: number;
      paragraph: ExtractedParagraph;
    }
  | {
      type: "telemetry";
      processed: number;
      total: number;
      currentStage: AgentStage;
      burstinessDelta: number;
      aiTellReduction: number;
    }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "cancelled" }
  | { type: "complete"; docxBlob: ArrayBuffer; auditReport: AuditReport }
  | { type: "error"; message: string; recoverable?: boolean };

/** Aggregate audit data for the exportable report. */
export interface AuditReport {
  filename: string;
  generatedAt: string;
  modelId: ModelId;
  intensity: RewriteIntensity;
  totalParagraphs: number;
  rewritten: number;
  skipped: number;
  flagged: number;
  citationsLocked: number;
  citationsVerified: number;
  avgBurstinessDelta: number;
  avgAiTellReduction: number;
  paragraphs: Array<{
    index: number;
    status: ParagraphStatus;
    before: string;
    after: string;
    placeholders: LockedPlaceholders;
    metrics: ParagraphMetrics | null;
    auditPassed?: boolean;
    flagReason?: string;
  }>;
}
