// ============================================================================
// Agent 1: .docx XML Extractor & Metadata Scrubber (Deterministic)
// ============================================================================
// Unpacks the uploaded .docx, scrubs generator/author metadata from
// docProps/core.xml and docProps/app.xml, parses word/document.xml preserving
// every XML namespace, and extracts body <w:p> paragraphs while strictly
// skipping tables, headings, footnotes/endnotes, equations, headers/footers,
// and paragraphs styled as TOC/Caption/Bibliography.

import type { UnpackedDocx } from "../utils/docx";
import {
  unpackDocx,
  scrubMetadata,
  parseDocumentBody,
  totalWordCount,
} from "../utils/docx";
import type { ExtractedParagraph } from "../types";

export interface ExtractorInput {
  docxBlob: ArrayBuffer;
  filename: string;
}

export interface ExtractorOutput {
  unpacked: UnpackedDocx;
  scrubbedFields: string[];
  paragraphs: ExtractedParagraph[];
  totalWords: number;
}

export async function runExtractor(
  input: ExtractorInput
): Promise<ExtractorOutput> {
  const unpacked = await unpackDocx(input.docxBlob);
  const scrubbedFields = scrubMetadata(unpacked);
  const { dom, paragraphs } = parseDocumentBody(unpacked.documentXml);

  const extracted: ExtractedParagraph[] = paragraphs.map((p) => ({
    index: p.index,
    text: p.text,
    sanitizedText: "",
    outputText: "",
    xml: p.xml,
    placeholders: { map: {}, citations: [], numerics: [], terms: [] },
    metrics: null,
    status: "pending",
  }));

  // Attach the DOM + nodes for Agent 5 reuse via the unpacked payload.
  (unpacked as UnpackedDocx & { __dom?: Document; __nodes?: Element[] }).__dom =
    dom;
  (unpacked as UnpackedDocx & { __dom?: Document; __nodes?: Element[] }).__nodes =
    paragraphs.map((p) => p.node);

  return {
    unpacked,
    scrubbedFields,
    paragraphs: extracted,
    totalWords: totalWordCount(paragraphs),
  };
}
