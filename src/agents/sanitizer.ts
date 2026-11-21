// ============================================================================
// Agent 2: Unicode Sanitizer & Entity/Citation Masker (Deterministic)
// ============================================================================
// Runs the deterministic pre-LLM sweep over every extracted paragraph:
//   1. Strip invisible Unicode Cf characters.
//   2. Normalize AI typographic artifacts (curly quotes, em-dashes).
//   3. Lock citations/numerics/glossary terms behind numbered placeholders.
// The placeholders survive the LLM rewrite untouched, and Agent 5 verifies
// every one of them is present before restoring the originals.

import { sanitizeText } from "../utils/unicode";
import { lockEntities } from "../utils/citations";
import type { ExtractedParagraph } from "../types";

export interface SanitizerInput {
  paragraphs: ExtractedParagraph[];
  glossaryTerms: string[];
}

export interface SanitizerOutput {
  paragraphs: ExtractedParagraph[];
  citationsLocked: number;
}

export function runSanitizer(input: SanitizerInput): SanitizerOutput {
  let citationsLocked = 0;
  const paragraphs = input.paragraphs.map((p) => {
    const sanitized = sanitizeText(p.text);
    const { masked, placeholders } = lockEntities(sanitized, input.glossaryTerms);
    citationsLocked += placeholders.citations.length + placeholders.numerics.length;
    return {
      ...p,
      sanitizedText: masked,
      outputText: masked,
      placeholders,
    };
  });
  return { paragraphs, citationsLocked };
}
