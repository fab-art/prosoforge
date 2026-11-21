// ============================================================================
// unicode.ts — Agent 2 helpers for invisible format characters & AI artifacts
// ============================================================================

/**
 * Strip invisible Unicode format characters (Category Cf) that leak author
 * fingerprints and disrupt diff alignment. Specifically:
 *  - Zero-width spaces & joiners: U+200B–U+200F, U+2060
 *  - BOM: U+FEFF
 *  - Soft hyphen: U+00AD
 *  - Bidirectional override marks: U+202A–U+202E
 *  - Other invisible Cf marks: U+2061–U+2064, U+2066–U+206F
 */
export function stripInvisible(text: string): string {
  // eslint-disable-next-line no-misleading-character-class
  return text.replace(
    /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\u00AD]/g,
    ""
  );
}

/**
 * Normalize AI-typical typographic artifacts back to clean ASCII punctuation.
 * Curly quotes -> straight quotes; em/en dashes -> hyphen-minus.
 * Em-dashes are a hallmark of LLM prose — collapsing them is both a stylistic
 * and a fingerprint-reduction measure.
 */
export function normalizeTypographic(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/\u00A9/g, "(c)")
    .replace(/\u00AE/g, "(R)")
    .replace(/\u2122/g, "(TM)");
}

/**
 * Collapse runs of whitespace introduced by the above stripping (e.g. multiple
 * spaces where a zero-width space used to live between two visible chars).
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

/** Full Agent 2 deterministic pre-sanitization sweep. */
export function sanitizeText(text: string): string {
  return collapseWhitespace(normalizeTypographic(stripInvisible(text)));
}
