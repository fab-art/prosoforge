// ============================================================================
// style.ts — Agent 3 burstiness & AI-tell profiling (deterministic math)
// ============================================================================

import type { ParagraphMetrics, StyleProfile } from "../types";

/** AI-typical transitional clichés. Lowercase match, word-boundary aware. */
export const AI_CLICHES = [
  "furthermore",
  "moreover",
  "additionally",
  "in addition",
  "delve",
  "delved",
  "tapestry",
  "crucial",
  "underscore",
  "underscores",
  "underscored",
  "pivotal",
  "in conclusion",
  "landscape",
  "testament",
  "navigating",
  "navigate",
  "realm",
  "nuanced",
  "robust",
  "seamless",
  "seamlessly",
  "intricate",
  "holistic",
  "leverage",
  "leverages",
  "leveraging",
  "paradigm",
  "synergy",
  "empower",
  "empowers",
  "unleash",
  "unlock",
  "transformative",
  "indispensable",
  "paramount",
  "noteworthy",
  "it is worth noting",
  "plays a crucial role",
  "plays a pivotal role",
  "stands as a testament",
  "sheds light",
];

// Passive-voice heuristic: (be/have) + past participle (-ed) OR known irregulars.
const PASSIVE_RE =
  /\b(?:is|are|was|were|be|been|being|has|have|had)\s+(?:[a-z]+ed|known|done|made|taken|seen|given|shown|written|held|found|built|sent|kept|told|paid|said|put|set|read|drawn|caught|taught|driven|thrown|grown|worn|broken|chosen|forgotten|ridden|woven|beaten|bidden|beheld|foreseen)\b/gi;

const SENTENCE_SPLIT_RE = /[^.!?]+[.!?]+(?:["'’”\)\]]+)?|\S+$/g;

/** Tokenize a paragraph into sentences (best-effort, ignores common abbreviations). */
export function splitSentences(text: string): string[] {
  // Protect common abbreviations from splitting.
  const protectedText = text
    .replace(/\b(e\.g|i\.e|et al|vs|approx|ca|cf|Fig|Eq|No|vol|p|pp|ed|eds)\./gi, "$1<DOT>")
    .replace(/\b([A-Z])\./g, "$1<DOT>");
  return (protectedText.match(SENTENCE_SPLIT_RE) ?? [protectedText])
    .map((s) => s.replace(/<DOT>/g, ".").trim())
    .filter((s) => s.length > 0);
}

function stddev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance =
    nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

export function countWords(text: string): number {
  const m = text.trim().match(/\b[\w'-]+\b/g);
  return m ? m.length : 0;
}

/**
 * Compute a per-paragraph metrics profile.
 * `style` is the optional author baseline; if present, we use its stddev as
 * the human benchmark — paragraphs within 30% of it count as "human bursty".
 */
export function profileParagraph(
  text: string,
  style?: StyleProfile,
  minWords = 25
): ParagraphMetrics {
  const wordCount = countWords(text);
  const sentences = splitSentences(text);
  const sentenceCount = Math.max(sentences.length, 1);
  const sentenceLengths = sentences.map(countWords);
  const avgSentenceLength = wordCount / sentenceCount;
  const sentenceLengthStdDev = stddev(sentenceLengths);

  const passiveMatches = text.match(PASSIVE_RE) ?? [];
  const passiveRatio = passiveMatches.length / sentenceCount;

  const lower = text.toLowerCase();
  const aiClicheList: string[] = [];
  for (const c of AI_CLICHES) {
    const re = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const hits = (lower.match(re) ?? []).length;
    for (let i = 0; i < hits; i++) aiClicheList.push(c);
  }
  const aiClicheCount = aiClicheList.length;

  // Skip logic (Agent 3 smart routing).
  let shouldRewrite = true;
  let skipReason: ParagraphMetrics["skipReason"] | undefined;
  if (wordCount < minWords) {
    shouldRewrite = false;
    skipReason = "too_short";
  } else if (aiClicheCount === 0) {
    // No clichés — check burstiness against author baseline.
    const targetStdDev = style?.sentenceLengthStdDev ?? 6.5;
    if (sentenceLengthStdDev >= targetStdDev * 0.7) {
      shouldRewrite = false;
      skipReason = "human_bursty";
    } else {
      skipReason = "no_cliches";
    }
  }

  return {
    wordCount,
    sentenceCount,
    avgSentenceLength,
    sentenceLengthStdDev,
    passiveRatio,
    aiClicheCount,
    aiClicheList,
    shouldRewrite,
    skipReason,
  };
}

/** Compute the author style profile from a sample of their writing. */
export function profileAuthorStyle(sample: string): StyleProfile | null {
  const wordCount = countWords(sample);
  if (wordCount < 50) return null; // need at least a paragraph or two.
  const sentences = splitSentences(sample);
  if (sentences.length < 2) return null;
  const sentenceLengths = sentences.map(countWords);
  const avgSentenceLength = wordCount / sentences.length;
  const sentenceLengthStdDev = stddev(sentenceLengths);
  const passiveMatches = sample.match(PASSIVE_RE) ?? [];
  const passiveRatio = passiveMatches.length / sentences.length;
  return {
    wordCount,
    avgSentenceLength,
    sentenceLengthStdDev,
    passiveRatio,
  };
}
