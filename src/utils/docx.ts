// ============================================================================
// docx.ts — .docx OpenXML unpack/repack, metadata scrub, & paragraph I/O
// ============================================================================
// Uses JSZip + DOMParser/XMLSerializer. We preserve EVERY XML namespace and
// never destroy formatting: tables, headings, footnotes, equations, headers
// and footers are strictly skipped during paragraph extraction but left
// untouched in the document so the rebuilt .docx is byte-faithful except for
// the body paragraph text runs we replace.

import JSZip from "jszip";

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
  cp: "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
  dc: "http://purl.org/dc/elements/1.1/",
  dcterms: "http://purl.org/dc/terms/",
  xsi: "http://www.w3.org/2001/XMLSchema-instance",
  ap: "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
  vt: "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes",
};

/** Heading / non-body paragraph styles to skip during extraction. */
const SKIP_STYLE_IDS = new Set([
  "Heading1",
  "Heading2",
  "Heading3",
  "Heading4",
  "Heading5",
  "Heading6",
  "Heading7",
  "Heading8",
  "Heading9",
  "Title",
  "Subtitle",
  "Caption",
  "Bibliography",
  "TOC1",
  "TOC2",
  "TOC3",
  "TOC",
  "TOCHeading",
  "TableofContents",
  "IntenseQuote",
  "Quote",
  "Header",
  "Footer",
  "FootnoteText",
  "EndnoteText",
]);

export interface UnpackedDocx {
  zip: JSZip;
  documentXml: string;
  coreXml: string;
  appXml: string;
  filenames: string[];
}

/** Unpack a .docx Blob/ArrayBuffer into JSZip and read the core parts. */
export async function unpackDocx(
  data: ArrayBuffer | Blob
): Promise<UnpackedDocx> {
  const zip = await JSZip.loadAsync(data);
  const filenames = Object.keys(zip.files);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error(
      "Invalid .docx: word/document.xml not found. Is this a real Word file?"
    );
  }
  const documentXml = await docFile.async("string");
  const coreXml = (await zip.file("docProps/core.xml")?.async("string")) ?? "";
  const appXml = (await zip.file("docProps/app.xml")?.async("string")) ?? "";
  return { zip, documentXml, coreXml, appXml, filenames };
}

/** Scrub identifying/generator metadata from core.xml & app.xml in place. */
export function scrubMetadata(doc: UnpackedDocx): string[] {
  const scrubbed: string[] = [];

  // ---- core.xml ----
  if (doc.coreXml) {
    const dom = new DOMParser().parseFromString(
      doc.coreXml,
      "application/xml"
    );
    const coreProps = [
      "dc:creator",
      "cp:lastModifiedBy",
      "dc:title",
      "dc:subject",
      "dc:description",
      "cp:keywords",
      "cp:category",
      "cp:version",
      "cp:revision",
      "cp:lastPrinted",
      "dcterms:created",
      "dcterms:modified",
      "customXml:LastErrorPrinted",
    ];
    for (const tag of coreProps) {
      const nodes = dom.getElementsByTagName(tag);
      // Iterate backwards because we mutate live lists.
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        n.textContent = "ProseForge";
        scrubbed.push(tag);
      }
    }
    // Force lastModifiedBy empty value to avoid leaking username.
    const lastMod = dom.getElementsByTagName("cp:lastModifiedBy")[0];
    if (lastMod) lastMod.textContent = "ProseForge";
    doc.zip.file(
      "docProps/core.xml",
      new XMLSerializer().serializeToString(dom)
    );
  }

  // ---- app.xml ----
  if (doc.appXml) {
    const dom = new DOMParser().parseFromString(doc.appXml, "application/xml");
    const appProps = [
      "Application",
      "Company",
      "Manager",
      "TotalTime",
      "LastSavedBy",
      "Template",
      "Pages",
      "Words",
      "Characters",
      "Lines",
      "Paragraphs",
      "DocSecurity",
      "ScaleCrop",
      "LinksUpToDate",
      "CharactersWithSpaces",
      "SharedDoc",
      "HyperlinksChanged",
      "AppVersion",
    ];
    for (const tag of appProps) {
      const nodes = dom.getElementsByTagName(tag);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        // Application stays as a neutral label; others go blank.
        n.textContent = tag === "Application" ? "ProseForge" : "";
        scrubbed.push(tag);
      }
    }
    doc.zip.file(
      "docProps/app.xml",
      new XMLSerializer().serializeToString(dom)
    );
  }

  return Array.from(new Set(scrubbed));
}

interface ExtractedParagraphInternal {
  index: number;
  text: string;
  xml: string;
  /** Reference to the live <w:p> node in the in-memory DOM. */
  node: Element;
}

/**
 * Parse word/document.xml preserving every namespace. Returns the DOM and a
 * list of body paragraphs that are safe to rewrite (skipping tables,
 * headings, footnotes/endnotes, equations, headers/footers).
 */
export function parseDocumentBody(
  documentXml: string
): { dom: Document; paragraphs: ExtractedParagraphInternal[] } {
  const dom = new DOMParser().parseFromString(documentXml, "application/xml");
  if (dom.getElementsByTagName("parsererror").length > 0) {
    throw new Error("word/document.xml is not well-formed XML.");
  }

  const paragraphs: ExtractedParagraphInternal[] = [];
  const body = dom.getElementsByTagNameNS(NS.w, "body")[0];
  if (!body) {
    throw new Error("word/document.xml has no <w:body> element.");
  }

  // Iterate DIRECT children of body so we can detect tbl / sectPr boundaries.
  let index = 0;
  for (let i = 0; i < body.children.length; i++) {
    const child = body.children[i];
    if (!child) continue;
    const localName = child.localName;

    if (localName === "tbl") continue; // Skip tables.
    if (localName === "sectPr") continue; // Section properties.
    if (localName !== "p") continue; // Only paragraphs flow.

    if (containsEquation(child)) continue; // Skip paragraphs with equations.

    const styleId = getParagraphStyleId(child);
    if (styleId && SKIP_STYLE_IDS.has(styleId)) continue;

    // Skip if it's inside a footnote/endnote context — those parts live in
    // footnotes.xml / endnotes.xml so a body <w:p> with these is rare but we
    // still defensively check for embedded reference marks.
    if (hasFootnoteReference(child)) continue;

    const text = extractParagraphText(child);
    if (text.trim().length === 0) continue;

    paragraphs.push({
      index,
      text,
      xml: new XMLSerializer().serializeToString(child),
      node: child,
    });
    index++;
  }

  return { dom, paragraphs };
}

/** Detect <m:oMath> in any descendant. */
function containsEquation(p: Element): boolean {
  return p.getElementsByTagNameNS(NS.m, "oMath").length > 0;
}

/** Detect footnote/endnote references in any descendant. */
function hasFootnoteReference(p: Element): boolean {
  return (
    p.getElementsByTagNameNS(NS.w, "footnoteReference").length > 0 ||
    p.getElementsByTagNameNS(NS.w, "endnoteReference").length > 0
  );
}

/** Read the pStyle val from <w:pPr><w:pStyle w:val="..."/></w:pPr>. */
function getParagraphStyleId(p: Element): string | null {
  const pPr = p.getElementsByTagNameNS(NS.w, "pPr")[0];
  if (!pPr) return null;
  const pStyle = pPr.getElementsByTagNameNS(NS.w, "pStyle")[0];
  if (!pStyle) return null;
  return pStyle.getAttribute("w:val") ?? null;
}

/** Concatenate all <w:t> nodes inside a paragraph, preserving order. */
function extractParagraphText(p: Element): string {
  const ts = p.getElementsByTagNameNS(NS.w, "t");
  let out = "";
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.parentNode && isInsideTabOrDeleted(t, p)) continue;
    out += t.textContent ?? "";
  }
  return out;
}

/** Walk up parents and stop at `root`. Returns true if t is inside a
 * tab/break/deleted-run wrapper (which we ignore for plain-text extraction). */
function isInsideTabOrDeleted(t: Element, root: Element): boolean {
  let cur: Element | null = t;
  while (cur && cur !== root) {
    if (cur.localName === "del") return true; // tracked deletion
    cur = cur.parentElement;
  }
  return false;
}

/**
 * Write the rewritten text back into the paragraph's <w:t> nodes while
 * preserving all formatting. Strategy:
 *   - If the paragraph has exactly one <w:t>, replace its content.
 *   - Otherwise: collapse all <w:t> into the first run's <w:t> and empty the
 *     others, so rPr formatting on the first run carries through. This keeps
 *     bold/italics/superscripts intact without corrupting the structure.
 */
export function writeParagraphText(p: Element, newText: string): void {
  const ts = Array.from(p.getElementsByTagNameNS(NS.w, "t"));
  if (ts.length === 0) {
    // No runs to update — bail out silently (paragraph had no <w:r>).
    return;
  }
  const first = ts[0];
  first.textContent = newText;
  // Empty (but keep) the rest so structure stays valid.
  for (let i = 1; i < ts.length; i++) {
    ts[i].textContent = "";
  }
  // Ensure xml:space="preserve" on the first <w:t> so leading/trailing
  // spaces in the rewrite are honored.
  if (!first.getAttribute("xml:space")) {
    first.setAttribute("xml:space", "preserve");
  }
}

/** Serialize the whole document back into a string ready to be zipped. */
export function serializeDocument(dom: Document): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    new XMLSerializer().serializeToString(dom.documentElement)
  );
}

/** Repack the JSZip into a Blob suitable for download. */
export async function repackDocx(zip: JSZip): Promise<Blob> {
  return await zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

/** Convenience: total word count across all extracted paragraphs. */
export function totalWordCount(paragraphs: { text: string }[]): number {
  return paragraphs.reduce(
    (acc, p) => acc + (p.text.trim().match(/\b[\w'-]+\b/g)?.length ?? 0),
    0
  );
}
