// ============================================================================
// Agent 3: Triage & Author Style Profiler (Deterministic Math)
// ============================================================================
// Computes burstiness (sentence-length stddev), passive-voice ratio, and
// AI-cliche density for every paragraph, then decides which paragraphs are
// worth sending to the LLM (saving 30-50% of WebGPU inference time).

import {
  profileParagraph,
  profileAuthorStyle,
} from "../utils/style";
import type { ExtractedParagraph, StyleProfile, ParagraphStatus } from "../types";

export interface TriageInput {
  paragraphs: ExtractedParagraph[];
  styleSample?: string;
  intensity: "conservative" | "balanced" | "deep";
}

export interface TriageOutput {
  paragraphs: ExtractedParagraph[];
  styleProfile: StyleProfile | null;
  toRewrite: number;
  toSkip: number;
}

export function runTriage(input: TriageInput): TriageOutput {
  const styleProfile = input.styleSample
    ? profileAuthorStyle(input.styleSample)
    : null;

  // Intensity scaling: higher intensity lowers the "human bursty" threshold so
  // more paragraphs get rewritten even if they look already-human.
  const minWordsByIntensity =
    input.intensity === "conservative" ? 25 : input.intensity === "balanced" ? 22 : 18;

  let toRewrite = 0;
  let toSkip = 0;

  const paragraphs = input.paragraphs.map((p) => {
    const metrics = profileParagraph(p.sanitizedText, styleProfile ?? undefined, minWordsByIntensity);
    const status: ParagraphStatus = metrics.shouldRewrite ? "pending" : "skipped";
    if (metrics.shouldRewrite) toRewrite++;
    else toSkip++;
    return {
      ...p,
      metrics,
      status,
    };
  });

  return { paragraphs, styleProfile, toRewrite, toSkip };
}
