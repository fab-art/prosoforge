/* ============================================================================
   Research Workstation — pdf.js
   Upload PDFs and extract text client-side using PDF.js (CDN).
   This is the answerthis.ai core feature: "upload a paper, then chat with it".
   Extracted text becomes a "document" the chat module can ground answers in.
   Supports .pdf and .txt; other formats fall back to manual paste.
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, saveState, toast, uid } = RW;

  // PDF.js from CDN (Mozilla). v3.x legacy build is UMD-compatible and works
  // without a bundler. We set the workerSrc to the matching version.
  const PDFJS_VER = "3.11.174";
  const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/pdf.min.js`;
  const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/pdf.worker.min.js`;

  let pdfjsReady = false;
  let pdfjsLoading = null;

  async function ensurePdfjs(){
    if(pdfjsReady) return window.pdfjsLib;
    if(pdfjsLoading) return pdfjsLoading;
    pdfjsLoading = (async ()=>{
      try{
        // load script tag
        await new Promise((resolve, reject)=>{
          const s = document.createElement("script");
          s.src = PDFJS_CDN; s.onload = resolve; s.onerror = ()=>reject(new Error("Failed to load PDF.js library"));
          document.head.appendChild(s);
        });
        if(!window.pdfjsLib) throw new Error("PDF.js did not initialize");
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        pdfjsReady = true;
        return window.pdfjsLib;
      }catch(e){
        pdfjsLoading = null;
        throw e;
      } finally {
        // allow re-entry on success path is unnecessary; keep cached
      }
    })();
    return pdfjsLoading;
  }

  // Extract text from a PDF File. Returns { text, pages, meta }
  async function extractPdf(file, onProgress){
    const pdfjsLib = await ensurePdfjs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const numPages = pdf.numPages;
    const pageTexts = [];
    for(let i=1; i<=numPages; i++){
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Reconstruct lines heuristically: group items by their y position.
      const items = content.items;
      let lastY = null; let line = "";
      const lines = [];
      for(const it of items){
        const y = it.transform[5];
        if(lastY === null) lastY = y;
        if(Math.abs(y - lastY) > 2){
          if(line.trim()) lines.push(line.trim());
          line = "";
          lastY = y;
        }
        line += it.str;
        if(it.hasEOL){ if(line.trim()) lines.push(line.trim()); line=""; lastY=null; }
      }
      if(line.trim()) lines.push(line.trim());
      pageTexts.push(lines.join("\n"));
      if(onProgress) onProgress(i/numPages);
    }
    // try metadata
    let meta = {};
    try{
      const m = await pdf.getMetadata();
      const info = m.info || {};
      meta = {
        title: info.Title, author: info.Author,
        subject: info.Subject, keywords: info.Keywords,
        creator: info.Creator, producer: info.Producer,
      };
    }catch(e){ /* ignore */ }
    return {
      text: pageTexts.join("\n\n\f\n\n"), // form feed between pages
      pages: pageTexts,
      meta,
      numPages
    };
  }

  async function extractText(file){
    // plain text
    if(file.type.startsWith("text/") || /\.(txt|md|markdown|csv)$/i.test(file.name)){
      return { text: await file.text(), pages: [await file.text()], meta: {}, numPages: 1 };
    }
    // PDF
    if(file.type==="application/pdf" || /\.pdf$/i.test(file.name)){
      return await extractPdf(file);
    }
    throw new Error("Unsupported file type. Use .pdf, .txt, .md, or paste text manually.");
  }

  // Add a document to state. fileOrText can be a File or a {name,text} object.
  async function addDocument(file, onProgress){
    const name = file.name || "pasted-text.txt";
    const size = file.size || (file.text? file.text.length : 0);
    let extracted;
    try{
      extracted = await extractText(file, onProgress);
    }catch(e){
      toast("Extraction failed: "+e.message, "error", 5000);
      return null;
    }
    const doc = {
      id: "doc-"+uid(),
      name,
      size,
      type: file.type || (file.text? "text/plain" : "unknown"),
      text: extracted.text,
      pages: extracted.pages,
      numPages: extracted.numPages,
      meta: extracted.meta,
      addedAt: Date.now(),
    };
    State.documents.push(doc);
    saveState();
    return doc;
  }

  function removeDocument(id){
    State.documents = State.documents.filter(d=>d.id!==id);
    if(State.activeDocId===id) State.activeDocId = null;
    saveState();
  }

  function getDocument(id){ return State.documents.find(d=>d.id===id); }
  function getActiveDoc(){ return State.documents.find(d=>d.id===State.activeDocId) || State.documents[0]; }

  Object.assign(RW, {
    PDF: { extractPdf, extractText, addDocument, removeDocument, getDocument, getActiveDoc, ensurePdfjs }
  });
})();
