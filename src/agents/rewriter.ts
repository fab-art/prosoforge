// ============================================================================
// Agent 4: Structural Rewriter & Rhythm Critic (WebLLM Engine)
// ============================================================================
// Builds ultra-focused prompts per paragraph (style constraints + 2-sentence
// continuity context + masked target paragraph). Runs an LLM pass, then a
// deterministic critic pass: if the output reintroduces AI clichés or collapses
// sentence-length variance, run a stricter second pass. Conversation state is
// reset per paragraph so KV-cache VRAM never bloats across long documents.

import type {
  ExtractedParagraph,
  ModelId,
  RewriteIntensity,
  StyleProfile,
  ParagraphMetrics,
} from "../types";
import { AI_CLICHES, countWords, splitSentences } from "../utils/style";
import { verifyPlaceholders } from "../utils/citations";

export interface LlmEngine {
  /** Run a single-shot chat completion. */
  complete(
    systemPrompt: string,
    userPrompt: string,
    onToken?: (t: string) => void
  ): Promise<string>;
  /** Reset KV-cache / chat state between paragraphs. */
  resetChat(): void;
}

export interface RewriterInput {
  paragraph: ExtractedParagraph;
  previousParagraph?: ExtractedParagraph | null;
  intensity: RewriteIntensity;
  modelId: ModelId;
  styleProfile: StyleProfile | null;
  engine: LlmEngine;
}

export interface RewriterOutput {
  rewritten: string;
  passes: number;
  criticTriggered: boolean;
  reason?: string;
}

const INTENSITY_DIRECTIVES: Record<RewriteIntensity, string> = {
  conservative:
    "Rewrite conservatively. Vary sentence openings and lengths. Keep the original meaning and order of every claim.",
  balanced:
    "Restructure sentences to break flat AI cadence. Reorder clauses for natural rhythm, keep all facts and every placeholder unchanged.",
  deep:
    "Deep structural rewrite: recombine and reorder sentences, vary syntax aggressively, introduce natural burstiness while preserving every fact and placeholder verbatim.",
};

/**
 * Build the LLM user prompt. Stays compact on purpose — 3B/4B models do best
 * with short, focused prompts.
 */
function buildUserPrompt(p: RewriterInput): string {
  const { paragraph, previousParagraph, intensity, styleProfile } = p;

  const styleLine = styleProfile
    ? `Match this author voice: avg sentence length ~${styleProfile.avgSentenceLength.toFixed(
        0
      )} words, length stddev ~${styleProfile.sentenceLengthStdDev.toFixed(
        1
      )}, passive-voice ratio ~${(styleProfile.passiveRatio * 100).toFixed(0)}%.`
    : "Vary sentence lengths aggressively to defeat uniform AI cadence.";

  // Continuity: last 2 sentences of the preceding paragraph (read-only).
  let contextLine = "No prior context (first paragraph).";
  if (previousParagraph && previousParagraph.outputText) {
    const prevSentences = splitSentences(previousParagraph.outputText);
    const tail = prevSentences.slice(-2).join(" ");
    if (tail) contextLine = `Immediately before this: "${tail}"`;
  }

  const metrics = paragraph.metrics;
  const clicheLine =
    metrics && metrics.aiClicheList.length > 0
      ? `Avoid these AI clichés entirely: ${[
          ...new Set(metrics.aiClicheList),
        ].slice(0, 8).join(", ")}.`
      : "Do not use AI-style transitional clichés (furthermore, moreover, delve, tapestry, underscore, pivotal, in conclusion, landscape, testament).";

  return [
    INTENSITY_DIRECTIVES[intensity],
    styleLine,
    clicheLine,
    contextLine,
    "",
    `IMPORTANT: every token that looks like [[CIT_*]] or [[NUM_*]] or [[TERM_*]] is a locked placeholder. Copy them verbatim into your output. Do not alter, merge, drop, or reorder placeholders.`,
    `Output ONLY the rewritten paragraph. No preamble, no explanation.`,
    "",
    "PARAGRAPH:",
    paragraph.sanitizedText,
  ].join("\n");
}

const SYSTEM_PROMPT = [
  "You are ProseForge-Rewrite, a structural rewriting engine for academic prose.",
  "Your sole job: rewrite the given paragraph to read like a human expert, defeating AI-tell signals.",
  "Rules (non-negotiable):",
  "1. Preserve meaning, order of claims, and ALL placeholders [[CIT_*]] [[NUM_*]] [[TERM_*]] verbatim.",
  "2. Vary sentence lengths; aim for stddev of sentence lengths >= 5.",
  "3. Avoid AI clichés: " +
    AI_CLICHES.slice(0, 20).join(", ") +
    ".",
  "4. Do NOT add citations, statistics, headings, or commentary.",
  "5. Output the rewritten paragraph only. No quotes, no labels, no markdown.",
].join("\n");

/** Critic: deterministic regex+math check on the LLM output. */
export function criticPass(
  rewritten: string,
  originalMetrics: ParagraphMetrics | null
): { triggered: boolean; reason?: string } {
  const lower = rewritten.toLowerCase();
  for (const c of AI_CLICHES) {
    const re = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    if (re.test(lower)) {
      return { triggered: true, reason: `AI cliche present: "${c}"` };
    }
  }
  // Sentence-length variance must not collapse to a uniform AI cadence.
  const sentences = splitSentences(rewritten);
  if (sentences.length >= 3) {
    const lens = sentences.map((s) => countWords(s));
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const variance =
      lens.reduce((a, n) => a + (n - mean) ** 2, 0) / lens.length;
    const sd = Math.sqrt(variance);
    if (sd < 2.5) {
      return { triggered: true, reason: `Flat sentence variance (sd=${sd.toFixed(2)})` };
    }
  }
  // Word count must not balloon/shrink beyond ±15% (Auditor double-checks too).
  const originalWords = originalMetrics?.wordCount ?? countWords(rewritten);
  const newWords = countWords(rewritten);
  if (originalWords > 0) {
    const ratio = newWords / originalWords;
    if (ratio < 0.7 || ratio > 1.35) {
      return { triggered: true, reason: `Word count drifted ${((ratio - 1) * 100).toFixed(0)}%` };
    }
  }
  return { triggered: false };
}

/** Strip surrounding quotes / labels LLMs sometimes add. */
function cleanLlmOutput(raw: string): string {
  let out = raw.trim();
  // Strip leading "PARAGRAPH:" or "Rewritten:" labels.
  out = out.replace(/^(paragraph|rewritten|output|result)\s*[:：]\s*/i, "");
  // Strip wrapping quotes if both sides.
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("```") && out.endsWith("```"))
  ) {
    out = out.replace(/^["```]+/, "").replace(/["```]+$/, "").trim();
  }
  // Collapse runs of newlines into a single space for paragraph text.
  out = out.replace(/\s*\n\s*/g, " ").trim();
  return out;
}

/**
 * Run Agent 4 on one paragraph. Includes the critic pass and one optional
 * stricter re-run if the critic is triggered.
 */
export async function runRewriter(input: RewriterInput): Promise<RewriterOutput> {
  const { engine, paragraph } = input;

  // Pass 1.
  engine.resetChat();
  const userPrompt1 = buildUserPrompt(input);
  const raw1 = await engine.complete(SYSTEM_PROMPT, userPrompt1);
  let rewritten = cleanLlmOutput(raw1);

  // Quick check: did placeholders survive? If not, the critic will catch it.
  const phCheck = verifyPlaceholders(rewritten, paragraph.placeholders);
  const critic1 = criticPass(rewritten, paragraph.metrics);

  if (!critic1.triggered && phCheck.allPresent) {
    return { rewritten, passes: 1, criticTriggered: false };
  }

  // Pass 2: stricter.
  engine.resetChat();
  const stricterSystem = SYSTEM_PROMPT + "\n6. This is your SECOND attempt. The first failed because: " + (critic1.reason ?? (phCheck.missing.length > 0 ? `placeholders dropped: ${phCheck.missing.join(", ")}` : "unknown")) + ". Be extremely careful.";
  const userPrompt2 =
    buildUserPrompt(input) +
    "\n\nCRITICAL: Your previous attempt failed review. Re-emit every placeholder verbatim. Vary sentence length.";
  const raw2 = await engine.complete(stricterSystem, userPrompt2);
  rewritten = cleanLlmOutput(raw2);

  return {
    rewritten,
    passes: 2,
    criticTriggered: true,
    reason: critic1.reason ?? "placeholder drop",
  };
}
