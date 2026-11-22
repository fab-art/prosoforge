/* ============================================================================
   Research Workstation — upload.js
   The answerthis.ai-style landing module: upload a PDF (or paste text),
   extract it client-side via PDF.js, then chat with the document using
   WebLLM (grounded RAG) or keyword retrieval fallback.
   This is the default route ("Upload & Chat").
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, toast, saveState } = RW;

  function render(){
    const c = $("#content");
    const docs = State.documents;
    c.innerHTML = `
      <div class="card">
        <div class="dropzone" id="dropzone">
          <span class="ic">📄</span>
          <div><b>Drop a PDF here</b>, or click to browse</div>
          <div class="small muted mt">.pdf, .txt, .md — extracted locally with PDF.js. Your file never leaves the browser.</div>
          <input type="file" id="fileInput" accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain">
        </div>
        <details class="mt"><summary>Or paste text manually</summary>
          <div class="row mt">
            <div class="field"><label>Title</label><input class="input" id="pasteTitle" placeholder="Document title"></div>
          </div>
          <div class="field"><label>Text</label><textarea class="textarea" id="pasteText" rows="5" placeholder="Paste the document text here"></textarea></div>
          <button class="btn btn-primary" id="pasteBtn">+ Add as document</button>
        </details>
      </div>

      ${docs.length? `
        <div class="card">
          <div class="between mb-sm">
            <h3 style="margin:0">Your documents (${docs.length})</h3>
            <button class="btn btn-sm btn-danger" id="clearDocs">Clear all</button>
          </div>
          <div id="docList"></div>
        </div>
        <div class="card">
          <div class="between mb-sm">
            <h3 style="margin:0">Chat with selected document</h3>
            <button class="btn btn-sm" id="openChat">Open full Q&amp;A →</button>
          </div>
          <div class="chat-box" style="height:320px">
            <div class="chat-log" id="miniChatLog"></div>
            <div class="chat-input-row">
              <input class="input" id="miniChatInput" placeholder="Ask about this document…" autocomplete="off">
              <button class="btn btn-primary" id="miniChatSend">Send</button>
            </div>
          </div>
        </div>
      ` : ""}
    `;
    wireUpload(c);
    if(docs.length){
      renderDocList(c);
      wireMiniChat(c);
    }
  }

  function wireUpload(c){
    const dz = $("#dropzone", c);
    const input = $("#fileInput", c);
    dz.addEventListener("click", ()=> input.click());
    dz.addEventListener("dragover", e=>{ e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", ()=> dz.classList.remove("drag"));
    dz.addEventListener("drop", e=>{
      e.preventDefault(); dz.classList.remove("drag");
      if(e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
    input.addEventListener("change", e=>{ if(e.target.files.length) handleFiles(e.target.files); });
    $("#pasteBtn", c)?.addEventListener("click", ()=>{
      const title = $("#pasteTitle", c).value.trim() || "Pasted text";
      const text = $("#pasteText", c).value.trim();
      if(!text){ toast("Paste some text first.","error"); return; }
      const file = { name: title+".txt", type:"text/plain", size: text.length, text };
      addDoc(file);
    });
    $("#clearDocs", c)?.addEventListener("click", ()=>{
      if(confirm("Remove all uploaded documents? Their extracted text will be deleted from this browser.")){
        State.documents = []; State.activeDocId = null; saveState(); RW.refreshCounts(); render();
      }
    });
  }

  async function handleFiles(fileList){
    for(const file of Array.from(fileList)){
      await addDoc(file);
    }
  }

  async function addDoc(file){
    const status = document.createElement("div");
    status.className = "notice notice-info";
    status.innerHTML = `<span class="spinner"></span> <div>Extracting text from <b>${esc(file.name)}</b>…</div>`;
    $("#content").insertBefore(status, $("#content").firstChild);
    try{
      let onProgress = null;
      if(file.type==="application/pdf" || /\.pdf$/i.test(file.name)){
        onProgress = (p)=>{ status.innerHTML = `<span class="spinner"></span> <div>Extracting <b>${esc(file.name)}</b>… ${Math.round(p*100)}%</div>`; };
      }
      const doc = await RW.PDF.addDocument(file, onProgress);
      if(doc){
        State.activeDocId = doc.id;
        saveState(); RW.refreshCounts();
        status.remove();
        toast(`Added "${doc.name}" (${doc.numPages} page(s), ${doc.text.length} chars).`, "success");
        render();
      } else {
        status.remove();
      }
    }catch(e){
      status.remove();
      toast("Failed: "+e.message, "error", 5000);
    }
  }

  function renderDocList(c){
    const box = $("#docList", c);
    box.innerHTML = State.documents.map(d=>`
      <div class="doc-item ${d.id===State.activeDocId?'active':''}" data-doc="${esc(d.id)}">
        <span class="ic">${d.type==="application/pdf"||/\.pdf$/i.test(d.name)?"📕":"📄"}</span>
        <div class="info">
          <b>${esc(d.name)}</b>
          <small>${d.numPages} page(s) · ${d.text.length.toLocaleString()} chars · added ${new Date(d.addedAt).toLocaleDateString()}</small>
        </div>
        <button class="btn btn-ghost btn-sm btn-danger" data-del-doc="${esc(d.id)}">✕</button>
      </div>
    `).join("");
    $$('[data-doc]', box).forEach(el=> el.addEventListener("click", e=>{
      if(e.target.closest('[data-del-doc]')) return;
      State.activeDocId = el.dataset.doc; saveState(); render();
    }));
    $$('[data-del-doc]', box).forEach(b=> b.addEventListener("click", ()=>{
      RW.PDF.removeDocument(b.dataset.delDoc); RW.refreshCounts(); render();
    }));
  }

  function wireMiniChat(c){
    const log = $("#miniChatLog", c);
    const doc = RW.PDF.getActiveDoc();
    if(!doc) return;
    log.innerHTML = `<div class="chat-msg bot">Loaded <b>${esc(doc.name)}</b>. ${RW.WebLLM.isReady()? 'WebLLM grounded RAG active.' : 'Keyword retrieval (load a WebLLM model in Settings for synthesis).'} Ask anything about this document.</div>`;
    const send = async ()=>{
      const q = $("#miniChatInput", c).value.trim();
      if(!q) return;
      $("#miniChatInput", c).value = "";
      log.innerHTML += `<div class="chat-msg user">${esc(q)}</div>`;
      const thinking = document.createElement("div");
      thinking.className = "chat-msg bot";
      thinking.innerHTML = `<span class="spinner"></span> ${RW.WebLLM.isReady()?'Generating…':'Retrieving…'}`;
      log.appendChild(thinking);
      log.scrollTop = log.scrollHeight;
      try{
        const result = await RW.Chat.answer(q, { sourceId: doc.id });
        thinking.remove();
        const cls = result.source.startsWith("webllm") ? "bot" : "bot draft";
        let meta = "";
        if(result.source==="keyword") meta = `<div class="src">Keyword overlap: ${result.overlap||0}/${result.total||0} keywords.</div>`;
        else if(result.source==="keyword-none") meta = `<div class="src">No keyword overlap — saying so rather than guessing.</div>`;
        else if(result.source.startsWith("webllm")) meta = `<div class="src">Generated by ${RW.WebLLM.shortName(result.model||'')} (local). Verify against the document.</div>`;
        log.innerHTML += `<div class="chat-msg ${cls}">${esc(result.text)}${meta}</div>`;
      }catch(e){
        thinking.remove();
        log.innerHTML += `<div class="chat-msg bot draft">Error: ${esc(e.message)}</div>`;
      }
      log.scrollTop = log.scrollHeight;
    };
    $("#miniChatSend", c).addEventListener("click", send);
    $("#miniChatInput", c).addEventListener("keydown", e=>{ if(e.key==="Enter") send(); });
    $("#openChat", c).addEventListener("click", ()=>{ RW.navigate("chat"); });
  }

  Object.assign(RW, { Upload: { render } });
})();
