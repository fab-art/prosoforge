// ============================================================================
// citations.ts — Agent 2 deterministic entity/citation masker
// ============================================================================
// Before any LLM sees a paragraph, every immutable academic element is
// replaced with a numbered placeholder ([[CIT_1]], [[NUM_1]], [[TERM_1]]).
// The Auditor (Agent 5) verifies all placeholders survive the rewrite verbatim,
// then restores the original values.

import type { LockedPlaceholders } from "../types";
export type { LockedPlaceholders };

let counter = 0;
function nextId(prefix: "CIT" | "NUM" | "TERM"): string {
  counter += 1;
  return `[[${prefix}_${counter}]]`;
}

/** Reset the global placeholder counter (called once per document). */
export function resetPlaceholderCounter(): void {
  counter = 0;
}

// ---------------------------------------------------------------------------
// Regex catalog. Order matters: more specific patterns first so a numeric
// percentage isn't captured by the catch-all number rule.
// ---------------------------------------------------------------------------
const RE = {
  // APA/Harvard narrative: "Smith (2020)" or "Smith and Jones (2020)".
  narrativeCitation: /\b([A-Z][a-zA-Z'’-]+(?:\s+(?:and|&|et al\.?)\s+[A-Z][a-zA-Z'’-]+)?)\s*\((\d{4}[a-z]?)\)/g,
  // Parenthetical: "(Smith, 2020)", "(Smith et al., 2020)", "(Smith & Jones, 2020, p. 12)"
  parenCitation: /\((?:[A-Z][a-zA-Z'’-]+(?:\s+(?:and|&|et al\.?)\s+[A-Z][a-zA-Z'’-]+)?,?\s+\d{4}[a-z]?(?:,\s+[pn]\.\s*\d+)?(?:;\s*[A-Z][a-zA-Z'’-]+,?\s+\d{4}[a-z]?)*)\)/g,
  // IEEE / numeric bracketed: [1] [1, 2] [1-4] [1, 3-5]
  bracketNumeric: /\[(\d+(?:\s*[-,]\s*\d+)*)\]/g,
  // p-values: p < 0.05, p=.001, p ≤ .04
  pValue: /\bp\s*[<>=≤]\s*\.?\d+(?:\.\d+)?\b/gi,
  // Sample sizes: n = 142, N=2,500
  sampleSize: /\b[nN]\s*=\s*\d[\d,]*\b/g,
  // Percentages: 42.8%
  percent: /\b\d+(?:\.\d+)?\s*%/g,
  // Units with numbers: 500mg, 3.2kg, 12 mL, 40 °C
  units: /\b\d+(?:[.,]\d+)?\s?(?:mg|g|kg|mL|L|µL|mm|cm|m|km|°C|°F|ms|s|min|hr|Hz|kHz|MHz|GHz|mol|mM|µM|IU|U\/mL|ng\/mL|pg\/mL|cfu|kb|bp|Mb)\b/gi,
  // Years standalone (4-digit, with optional era): "2020", "in 1998"
  year: /\b(1[5-9]\d{2}|20\d{2})\b/g,
  // Numeric with decimals (catch-all after the above): 3.14, 0.001
  number: /\b\d+(?:[.,]\d+)?\b/g,
} as const;

/**
 * Mask every immutable academic entity in `text` with stable placeholders.
 * Returns the masked text and a map back to the originals.
 *
 * Terms are masked FIRST so user glossary strings (e.g. "Bevacizumab",
 * "RNA-seq") survive intact even if they contain digits or punctuation that
 * would otherwise match a numeric rule.
 */
export function lockEntities(
  text: string,
  glossaryTerms: string[] = []
): { masked: string; placeholders: LockedPlaceholders } {
  resetPlaceholderCounter();
  const map: Record<string, string> = {};
  const citations: string[] = [];
  const numerics: string[] = [];
  const terms: string[] = [];

  let out = text;

  // 1) User glossary terms — longest-first to avoid partial masking.
  const sortedTerms = [...glossaryTerms]
    .filter((t) => t.trim().length > 1)
    .sort((a, b) => b.length - a.length);
  for (const term of sortedTerms) {
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${safe}\\b`, "g");
    out = out.replace(re, () => {
      const id = nextId("TERM");
      map[id] = term;
      terms.push(id);
      return id;
    });
  }

  // 2) Citations
  out = out.replace(RE.narrativeCitation, (m) => {
    const id = nextId("CIT");
    map[id] = m;
    citations.push(id);
    return id;
  });
  out = out.replace(RE.parenCitation, (m) => {
    const id = nextId("CIT");
    map[id] = m;
    citations.push(id);
    return id;
  });
  out = out.replace(RE.bracketNumeric, (m) => {
    const id = nextId("CIT");
    map[id] = m;
    citations.push(id);
    return id;
  });

  // 3) Numerics / stats / units
  const numericPatterns = [
    RE.pValue,
    RE.sampleSize,
    RE.percent,
    RE.units,
    RE.year,
    RE.number,
  ];
  for (const re of numericPatterns) {
    out = out.replace(re, (m) => {
      const id = nextId("NUM");
      map[id] = m;
      numerics.push(id);
      return id;
    });
  }

  return {
    masked: out,
    placeholders: { map, citations, numerics, terms },
  };
}

/**
 * Restore every placeholder in `text` to its original value.
 * Optionally run typographic polish on spacing around restored citations.
 */
export function restoreEntities(
  text: string,
  placeholders: LockedPlaceholders
): string {
  let out = text;
  // Iterate over all entries (terms + citations + numerics share the same map).
  for (const [token, original] of Object.entries(placeholders.map)) {
    // Tokens look like [[CIT_1]] — escape the brackets for RegExp.
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "g"), original);
  }
  return out;
}

/** Verify all citation/numeric placeholders survived the rewrite verbatim. */
export function verifyPlaceholders(
  rewritten: string,
  placeholders: LockedPlaceholders
): { allPresent: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const token of [...placeholders.citations, ...placeholders.numerics]) {
    if (!rewritten.includes(token)) missing.push(token);
  }
  return { allPresent: missing.length === 0, missing };
}

/**
 * Deterministic post-LLM typographic polish. Fixes spacing around restored
 * citations, e.g. " (Smith, 2020) ." -> " (Smith, 2020)." and " ," -> ",".
 */
export function typographicPolish(text: string): string {
  return text
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}
