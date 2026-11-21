// ============================================================================
// docx.ts — .docx OpenXML unpack/repack, metadata scrub, & paragraph I/O
// ============================================================================
// Uses JSZip + @xmldom/xmldom (a pure-JS W3C DOM that works inside Web Workers,
// where the browser's native DOMParser/XMLSerializer are unavailable). We
// preserve EVERY XML namespace and never destroy formatting: tables, headings,
// footnotes, equations, headers and footers are strictly skipped during
// paragraph extraction but left untouched in the document so the rebuilt .docx
// is byte-faithful except for the body paragraph text runs we replace.

import JSZip from "jszip";
import {
  DOMParser,
  XMLSerializer,
  type Element as XmlElement,
  type Document as XmlDocument,
  type Node as XmlNode,
} from "@xmldom/xmldom";

// Re-export so other modules (auditor, worker) don't have to depend on or
// import @xmldom/xmldom types directly — they get the right DOM type via
// the docx module's public surface.
export type Element = XmlElement;
export type Document = XmlDocument;
export type Node = XmlNode;

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

// Shared parser/serializer instances. @xmldom/xmldom is reentrant and safe
// to reuse across documents.
const parser = new DOMParser();
const serializer = new XMLSerializer();

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

// ---------------------------------------------------------------------------
// xmldom helpers
// ---------------------------------------------------------------------------
// @xmldom/xmldom does not implement getElementsByTagNameNS reliably for the
// default Word namespace, so we walk descendants by localName instead. We also
// avoid relying on getElementsByClassName / classList — neither exists.

/** Walk all descendant ELEMENT nodes whose localName matches `name`. */
function getDescendantsByLocalName(
  root: Node,
  name: string
): Element[] {
  const out: Element[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 1) {
      const el = node as Element;
      if (el.localName === name || el.nodeName === name) out.push(el);
    }
    for (let i = 0; i < node.childNodes.length; i++) {
      walk(node.childNodes[i]!);
    }
  };
  walk(root);
  return out;
}

/** Find the first descendant element by localName. */
function firstByLocalName(root: Node, name: string): Element | null {
  return getDescendantsByLocalName(root, name)[0] ?? null;
}

/** Read a `w:val` attribute, supporting both prefixed and namespace-qualified forms. */
function getWVal(el: Element): string | null {
  return el.getAttribute("w:val") ?? el.getAttribute(NS.w + ":val") ?? null;
}

/** Scrub identifying/generator metadata from core.xml & app.xml in place. */
export function scrubMetadata(doc: UnpackedDocx): string[] {
  const scrubbed: string[] = [];

  // ---- core.xml ----
  if (doc.coreXml) {
    const dom = parser.parseFromString(doc.coreXml, "application/xml");
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
    ];
    for (const tag of coreProps) {
      const nodes = dom.getElementsByTagName(tag);
      // Iterate backwards because we mutate live lists.
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes.item(i);
        if (!n) continue;
        n.textContent = "ProseForge";
        scrubbed.push(tag);
      }
    }
    const lastMod = dom.getElementsByTagName("cp:lastModifiedBy").item(0);
    if (lastMod) lastMod.textContent = "ProseForge";
    doc.zip.file(
      "docProps/core.xml",
      serializer.serializeToString(dom)
    );
  }

  // ---- app.xml ----
  if (doc.appXml) {
    const dom = parser.parseFromString(doc.appXml, "application/xml");
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
        const n = nodes.item(i);
        if (!n) continue;
        // Application stays as a neutral label; others go blank.
        n.textContent = tag === "Application" ? "ProseForge" : "";
        scrubbed.push(tag);
      }
    }
    doc.zip.file(
      "docProps/app.xml",
      serializer.serializeToString(dom)
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
  const dom = parser.parseFromString(documentXml, "application/xml");

  // xmldom does not surface parse errors as <parsererror> nodes; check the
  // document element instead.
  if (!dom.documentElement) {
    throw new Error("word/document.xml is not well-formed XML.");
  }

  const paragraphs: ExtractedParagraphInternal[] = [];
  const body = firstByLocalName(dom, "body");
  if (!body) {
    throw new Error("word/document.xml has no <w:body> element.");
  }

  // Iterate DIRECT children of body so we can detect tbl / sectPr boundaries.
  let index = 0;
  for (let i = 0; i < body.childNodes.length; i++) {
    const childNode = body.childNodes[i]!;
    if (childNode.nodeType !== 1) continue; // skip text/whitespace
    const child = childNode as Element;

    if (child.localName === "tbl") continue; // Skip tables.
    if (child.localName === "sectPr") continue; // Section properties.
    if (child.localName !== "p") continue; // Only paragraphs flow.

    if (containsEquation(child)) continue; // Skip paragraphs with equations.

    const styleId = getParagraphStyleId(child);
    if (styleId && SKIP_STYLE_IDS.has(styleId)) continue;

    // Skip paragraphs that embed footnote/endnote references — those live in
    // footnotes.xml / endnotes.xml so a body <w:p> with these is rare but we
    // still defensively check.
    if (hasFootnoteReference(child)) continue;

    const text = extractParagraphText(child);
    if (text.trim().length === 0) continue;

    paragraphs.push({
      index,
      text,
      xml: serializer.serializeToString(child),
      node: child,
    });
    index++;
  }

  return { dom, paragraphs };
}

/** Detect <m:oMath> in any descendant. */
function containsEquation(p: Element): boolean {
  return getDescendantsByLocalName(p, "oMath").length > 0;
}

/** Detect footnote/endnote references in any descendant. */
function hasFootnoteReference(p: Element): boolean {
  return (
    getDescendantsByLocalName(p, "footnoteReference").length > 0 ||
    getDescendantsByLocalName(p, "endnoteReference").length > 0
  );
}

/** Read the pStyle val from <w:pPr><w:pStyle w:val="..."/></w:pPr>. */
function getParagraphStyleId(p: Element): string | null {
  const pPr = firstByLocalName(p, "pPr");
  if (!pPr) return null;
  const pStyle = firstByLocalName(pPr, "pStyle");
  if (!pStyle) return null;
  return getWVal(pStyle);
}

/** Concatenate all <w:t> nodes inside a paragraph, preserving order. */
function extractParagraphText(p: Element): string {
  const ts = getDescendantsByLocalName(p, "t");
  let out = "";
  for (const t of ts) {
    if (isInsideDeleted(t, p)) continue;
    out += t.textContent ?? "";
  }
  return out;
}

/** Walk up parents and stop at `root`. Returns true if t is inside a tracked
 * deletion (w:del). */
function isInsideDeleted(t: Element, root: Element): boolean {
  let cur: Node | null = t;
  while (cur && cur !== root) {
    if (cur.nodeType === 1) {
      const el = cur as Element;
      if (el.localName === "del" || el.nodeName === "del") return true;
    }
    cur = cur.parentNode;
  }
  return false;
}

/**
 * Write the rewritten text back into the paragraph's <w:t> nodes while
 * preserving all formatting. Strategy:
 *   - If the paragraph has at least one <w:t>, replace the first one's text
 *     and empty the rest, so rPr formatting on the first run carries through.
 *   - Otherwise: create a fresh <w:r><w:t xml:space="preserve">…</w:t></w:r>
 *     inside the paragraph, after any existing <w:pPr>.
 */
export function writeParagraphText(p: Element, newText: string): void {
  const ts = getDescendantsByLocalName(p, "t");
  if (ts.length === 0) {
    // No runs to update — append a fresh run.
    const doc = p.ownerDocument;
    if (!doc) return;
    const r = doc.createElementNS(NS.w, "w:r");
    const t = doc.createElementNS(NS.w, "w:t");
    t.setAttribute("xml:space", "preserve");
    t.appendChild(doc.createTextNode(newText));
    r.appendChild(t);
    p.appendChild(r);
    return;
  }
  const first = ts[0]!;
  // Clear existing children of the first <w:t> and set new text.
  while (first.firstChild) first.removeChild(first.firstChild);
  first.appendChild(
    (first.ownerDocument ?? p.ownerDocument)!.createTextNode(newText)
  );
  // Empty (but keep) the rest so structure stays valid.
  for (let i = 1; i < ts.length; i++) {
    const t = ts[i]!;
    while (t.firstChild) t.removeChild(t.firstChild);
  }
  // Ensure xml:space="preserve" on the first <w:t> so leading/trailing
  // spaces in the rewrite are honored.
  if (!first.getAttribute("xml:space")) {
    first.setAttribute("xml:space", "preserve");
  }
}

/** Serialize the whole document back into a string ready to be zipped. */
export function serializeDocument(dom: Document): string {
  const root = dom.documentElement;
  if (!root) {
    throw new Error("Cannot serialize: document has no root element.");
  }
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    serializer.serializeToString(root)
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

// Re-export helpers so the auditor (which re-writes via writeParagraphText
// during checkpoint resume) can access them without a dynamic import.
export { writeParagraphText as _writeParagraphText };
