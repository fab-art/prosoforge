/* ============================================================================
   Research Workstation — notes.js
   Resource & Idea Board: tagged, searchable free-form notes.
   Local persistence only (localStorage).
============================================================================ */
(function(){
  "use strict";
  const RW = window.RW = window.RW || {};
  const { State, $, $$, esc, uid, debounce, saveState } = RW;

  function render(){
    const c = $("#content");
    c.innerHTML = `
      <div class="card">
        <div class="row">
          <div class="field"><label>Title</label><input class="input" id="noteTitle" placeholder="Idea, todo, or reference"></div>
          <div class="field" style="max-width:200px"><label>Tag(s)</label><input class="input" id="noteTags" placeholder="ch1, methods"></div>
        </div>
        <div class="field"><label>Content</label><textarea class="textarea" id="noteBody" rows="3" placeholder="What's the note?"></textarea></div>
        <button class="btn btn-primary" id="addNote">+ Add note</button>
      </div>
      <div class="card">
        <div class="between mb-sm">
          <input class="input" id="noteSearch" placeholder="🔍 Search notes…" style="flex:1">
        </div>
        <div id="noteList"></div>
      </div>
    `;
    const refresh = ()=> renderNoteList($("#noteSearch", c).value);
    $("#addNote", c).addEventListener("click", ()=>{
      const title = $("#noteTitle", c).value.trim();
      const body = $("#noteBody", c).value.trim();
      const tags = $("#noteTags", c).value.split(",").map(s=>s.trim()).filter(Boolean);
      if(!title && !body){ RW.toast("Add a title or content.","error"); return; }
      State.notes.push({ id: uid(), title, body, tags, createdAt: Date.now() });
      saveState(); RW.refreshCounts();
      $("#noteTitle", c).value=""; $("#noteBody", c).value=""; $("#noteTags", c).value="";
      refresh();
      RW.toast("Note saved.","success");
    });
    $("#noteSearch", c).addEventListener("input", debounce(refresh, 200));
    refresh();
  }

  function renderNoteList(filter){
    const box = $("#noteList");
    let notes = State.notes.slice().sort((a,b)=>b.createdAt-a.createdAt);
    if(filter){
      const f = filter.toLowerCase();
      notes = notes.filter(n=> (n.title+" "+n.body+" "+(n.tags||[]).join(" ")).toLowerCase().includes(f));
    }
    if(!notes.length){ box.innerHTML = `<div class="empty" style="padding:20px">No notes yet.</div>`; return; }
    box.innerHTML = notes.map(n=>`
      <div class="card card-hover">
        <div class="between mb-sm">
          <strong>${esc(n.title||"(untitled)")}</strong>
          <button class="btn btn-ghost btn-sm btn-danger" data-del="${n.id}">✕</button>
        </div>
        <div class="small" style="white-space:pre-wrap">${esc(n.body)}</div>
        ${(n.tags&&n.tags.length)?`<div class="mt">${n.tags.map(t=>`<span class="tag">#${esc(t)}</span>`).join("")}</div>`:""}
        <div class="small muted mt">${new Date(n.createdAt).toLocaleString()}</div>
      </div>
    `).join("");
    $$('[data-del]', box).forEach(b=> b.addEventListener("click", ()=>{
      State.notes = State.notes.filter(n=>n.id!==b.dataset.del);
      saveState(); RW.refreshCounts(); renderNoteList($("#noteSearch").value);
    }));
  }

  Object.assign(RW, { Notes: { render } });
})();
