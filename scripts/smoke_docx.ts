// Smoke test: build a tiny in-memory .docx (the minimal OpenXML package),
// run it through unpackDocx -> scrubMetadata -> parseDocumentBody ->
// writeParagraphText -> serializeDocument -> repackDocx, and assert that
// everything round-trips cleanly. This catches the "DOMParser is not defined"
// class of worker-runtime errors before we ship.

import {
  unpackDocx,
  scrubMetadata,
  parseDocumentBody,
  writeParagraphText,
  serializeDocument,
  repackDocx,
} from "../src/utils/docx.ts";
import JSZip from "jszip";

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>This is a heading and should be skipped</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:jc w:val="both"/></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t>The quick (Smith, 2020) brown fox jumps over p &lt; 0.05 lazy dog.</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>table cell</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:p>
      <w:r><w:t>Second body paragraph with 42.8% increase and 500mg dose.</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">  spaced text  </w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
  <dc:creator>John Doe</dc:creator>
  <cp:lastModifiedBy>John Doe</cp:lastModifiedBy>
  <dcterms:created>2024-01-01T00:00:00Z</dcterms:created>
</cp:coreProperties>`;

const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Microsoft Office Word</Application>
  <Company>Acme Corp</Company>
  <TotalTime>120</TotalTime>
</Properties>`;

async function main() {
  // Build a minimal valid .docx zip.
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  zip.file("word/document.xml", documentXml);
  zip.file("docProps/core.xml", coreXml);
  zip.file("docProps/app.xml", appXml);
  const buf = await zip.generateAsync({ type: "arraybuffer" });

  // Unpack.
  const unpacked = await unpackDocx(buf);
  console.log("✓ unpackDocx:", unpacked.filenames.length, "files");

  // Scrub metadata.
  const scrubbed = scrubMetadata(unpacked);
  console.log("✓ scrubMetadata:", scrubbed.join(", "));

  // Parse body.
  const { dom, paragraphs } = parseDocumentBody(unpacked.documentXml);
  console.log("✓ parseDocumentBody:", paragraphs.length, "paragraphs extracted");
  for (const p of paragraphs) {
    const preview = p.text.length > 70 ? p.text.slice(0, 70) + "..." : p.text;
    console.log(`  ¶${p.index + 1}: "${preview}"`);
  }
  if (paragraphs.length !== 3) {
    throw new Error(`Expected 3 paragraphs (heading + table skipped), got ${paragraphs.length}`);
  }

  // Write back a new text into each paragraph.
  const newtexts = [
    "The swift (Smith, 2020) vulpine vaults over p < 0.05 lazy hound.",
    "Second body paragraph with 42.8% growth and 500mg dosage.",
    "tidy text",
  ];
  paragraphs.forEach((p, i) => writeParagraphText(p.node, newtexts[i]));
  console.log("✓ writeParagraphText: wrote 3 paragraphs back");

  // Serialize and check the new text is present (XML-escaped form, since
  // xmldom correctly escapes <, &, etc. on serialization). Order matters:
  // escape & first to avoid double-escaping.
  const serialized = serializeDocument(dom);
  const escaped = newtexts.map((t) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  );
  for (const t of escaped) {
    if (!serialized.includes(t)) {
      throw new Error(`Serialized XML is missing: "${t}"`);
    }
  }
  console.log("✓ serializeDocument: all rewritten texts present");

  // Check that the heading paragraph (skipped) is still intact.
  if (!serialized.includes("This is a heading and should be skipped")) {
    throw new Error("Heading paragraph text was lost — should have been preserved untouched.");
  }
  console.log("✓ heading preserved");

  // Repack and verify it's a valid zip with the new document.xml.
  unpacked.zip.file("word/document.xml", serialized);
  const blob = await repackDocx(unpacked.zip);
  const rezip = await JSZip.loadAsync(await blob.arrayBuffer());
  const finalXml = await rezip.file("word/document.xml").async("string");
  if (!finalXml.includes(escaped[0])) {
    throw new Error("Repacked .docx is missing the rewritten text.");
  }
  console.log("✓ repackDocx: round-trip verified, blob size =", blob.size, "bytes");

  // Verify scrubbed metadata.
  const finalCore = await rezip.file("docProps/core.xml").async("string");
  if (finalCore.includes("John Doe")) {
    throw new Error("dc:creator/lastModifiedBy was not scrubbed.");
  }
  const finalApp = await rezip.file("docProps/app.xml").async("string");
  if (finalApp.includes("Acme Corp") || finalApp.includes("Microsoft Office Word")) {
    throw new Error("Application/Company was not scrubbed.");
  }
  console.log("✓ metadata scrubbed (no John Doe, no Acme Corp)");

  console.log("\nALL CHECKS PASSED ✅");
}

main().catch((e) => {
  console.error("❌ SMOKE TEST FAILED:", e);
  process.exit(1);
});
