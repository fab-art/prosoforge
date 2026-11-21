// ============================================================================
// Agent 5: Integrity Auditor & .docx XML Rebuilder (Deterministic Guardrail)
// ============================================================================
// Verifies 100% of citation/numeric placeholders survived the rewrite, that
// word count stays within ±15%, restores originals, runs typographic polish,
// writes the rewritten text back into word/document.xml, and repacks the .docx.
// On audit failure: auto-retry Agent 4 once; if still failing, revert to the
// sanitized original paragraph and mark it Flagged for Manual Review.

import type { ExtractedParagraph } from "../types";
import {
  restoreEntities,
  verifyPlaceholders,
  typographicPolish,
} from "../utils/citations";
import { countWords } from "../utils/style";
import { writeParagraphText, serializeDocument, repackDocx } from "../utils/docx";
import type { UnpackedDocx } from "../utils/docx";
import { runRewriter, type LlmEngine } from "./rewriter";
import type { ModelId, RewriteIntensity, StyleProfile } from "../types";

export interface AuditorContext {
  unpacked: UnpackedDocx;
  modelId: ModelId;
  intensity: RewriteIntensity;
  styleProfile: StyleProfile | null;
  engine: LlmEngine;
  filename: string;
  /** Called after each paragraph is audited, with the updated paragraph. */
  onParagraph?: (p: ExtractedParagraph) => void;
}

export interface AuditResult {
  paragraph: ExtractedParagraph;
  node: Element;
  auditPassed: boolean;
}

/**
 * Audit + rebuild a single paragraph. Mutates the live DOM node so that the
 * final repack contains the rewritten text. Returns the updated paragraph.
 */
export async function auditAndRebuildParagraph(
  paragraph: ExtractedParagraph,
  previousParagraph: ExtractedParagraph | null,
  ctx: AuditorContext,
  nodes: Element[]
): Promise<AuditResult> {
  const node = nodes[paragraph.index];
  if (!node) {
    return {
      paragraph: { ...paragraph, status: "flagged", flagReason: "missing DOM node" },
      node: node as unknown as Element,
      auditPassed: false,
    };
  }

  // Skipped paragraphs (Agent 3 said no rewrite): keep sanitized original text.
  if (paragraph.status === "skipped" || !paragraph.metrics?.shouldRewrite) {
    const restored = typographicPolish(
      restoreEntities(paragraph.sanitizedText, paragraph.placeholders)
    );
    const updated: ExtractedParagraph = {
      ...paragraph,
      outputText: restored,
      auditPassed: true,
      status: "skipped",
    };
    writeParagraphText(node, restored);
    ctx.onParagraph?.(updated);
    return { paragraph: updated, node, auditPassed: true };
  }

  // Run Agent 4 (possibly twice if the critic triggers).
  const rewriterOut = await runRewriter({
    paragraph,
    previousParagraph,
    intensity: ctx.intensity,
    modelId: ctx.modelId,
    styleProfile: ctx.styleProfile,
    engine: ctx.engine,
  });

  let rewritten = rewriterOut.rewritten;
  const phCheck = verifyPlaceholders(rewritten, paragraph.placeholders);

  // Word count drift check (±15%).
  const origWords = paragraph.metrics?.wordCount ?? countWords(paragraph.sanitizedText);
  const newWords = countWords(rewritten);
  const withinBounds = origWords === 0 || Math.abs(newWords - origWords) / origWords <= 0.15;

  let auditPassed = phCheck.allPresent && withinBounds;
  let flagReason: string | undefined;

  // Auto-retry once on placeholder drop with a stricter prompt.
  if (!auditPassed) {
    const retryOut = await runRewriter({
      paragraph,
      previousParagraph,
      intensity: ctx.intensity,
      modelId: ctx.modelId,
      styleProfile: ctx.styleProfile,
      engine: ctx.engine,
    });
    rewritten = retryOut.rewritten;
    const retryPh = verifyPlaceholders(rewritten, paragraph.placeholders);
    const retryWords = countWords(rewritten);
    const retryBounds =
      origWords === 0 || Math.abs(retryWords - origWords) / origWords <= 0.15;
    auditPassed = retryPh.allPresent && retryBounds;
    if (!auditPassed) {
      flagReason = retryPh.missing.length
        ? `placeholders dropped: ${retryPh.missing.join(", ")}`
        : `word count drift (${retryWords} vs ${origWords})`;
    }
  }

  // Fallback: revert to sanitized original so data is never corrupted.
  if (!auditPassed) {
    const restored = typographicPolish(
      restoreEntities(paragraph.sanitizedText, paragraph.placeholders)
    );
    const updated: ExtractedParagraph = {
      ...paragraph,
      outputText: restored,
      status: "flagged",
      flagReason,
      auditPassed: false,
      llmPasses: rewriterOut.passes + 1,
    };
    writeParagraphText(node, restored);
    ctx.onParagraph?.(updated);
    return { paragraph: updated, node, auditPassed: false };
  }

  // Success: restore real citations/numerics and polish.
  const restored = typographicPolish(
    restoreEntities(rewritten, paragraph.placeholders)
  );
  const updated: ExtractedParagraph = {
    ...paragraph,
    outputText: restored,
    status: "rewritten",
    auditPassed: true,
    llmPasses: rewriterOut.passes,
  };
  writeParagraphText(node, restored);
  ctx.onParagraph?.(updated);
  return { paragraph: updated, node, auditPassed: true };
}

/** Serialize + repack the final .docx into a downloadable Blob. */
export async function rebuildDocx(
  unpacked: UnpackedDocx
): Promise<Blob> {
  const dom = (unpacked as UnpackedDocx & { __dom?: Document }).__dom;
  if (!dom) {
    throw new Error("Document DOM not attached to unpacked payload.");
  }
  const xml = serializeDocument(dom);
  unpacked.zip.file("word/document.xml", xml);
  return await repackDocx(unpacked.zip);
}
