/* ============================================================
   Synapse — AI-powered universal notes app
   Vanilla HTML/CSS/JS front end talking to the Spring Boot API.
   ============================================================ */
(function () {
  "use strict";

  const API = "/api";

  /* ---------------- DOM refs ---------------- */
  const el = (id) => document.getElementById(id);

  const sidebarEl = el("sidebar");
  const sidebarToggleBtn = el("sidebar-toggle");
  const themeToggleBtn = el("theme-toggle");
  const aiStatusEl = el("ai-status");

  const newNoteBtn = el("new-note-btn");
  const quickCaptureBtn = el("quick-capture-btn");
  const askNotesBtn = el("ask-notes-btn");
  const addFolderBtn = el("add-folder-btn");
  const folderTreeEl = el("folder-tree");
  const tagCloudEl = el("tag-cloud");

  const countAll = el("count-all"), countFav = el("count-fav"), countArch = el("count-arch"), countTrash = el("count-trash");

  const searchInput = el("search-input");
  const filterCategory = el("filter-category");
  const filterFavorite = el("filter-favorite");
  const filterFiles = el("filter-files");
  const layoutBtns = document.querySelectorAll("[data-layout]");

  const viewNotes = el("view-notes"), viewGraph = el("view-graph"), viewDashboard = el("view-dashboard");
  const viewTitle = el("view-title");
  const noteGrid = el("note-grid");
  const notesEmpty = el("notes-empty");

  const graphCanvas = el("graph-canvas");
  const graphEmpty = el("graph-empty");
  const dashGrid = el("dash-grid");

  const editorOverlay = el("editor-overlay");
  const titleInputRef = el("title-input"); // "ref" — direct DOM handle, focused imperatively like React's useRef
  const contentEditorRef = el("content-editor");
  const saveIndicator = el("save-indicator");
  const pinBtn = el("pin-btn"), favoriteBtn = el("favorite-btn"), archiveBtn = el("archive-btn");
  const historyBtn = el("history-btn"), exportBtn = el("export-btn"), deleteNoteBtn = el("delete-note-btn"), closeEditorBtn = el("close-editor-btn");
  const folderSelect = el("folder-select"), tagsInput = el("tags-input"), categorySelect = el("category-select");
  const linkPreviewsEl = el("link-previews");
  const attachmentsListEl = el("attachments-list");
  const fileInput = el("file-input");
  const voiceBtn = el("voice-btn");

  const aiOutputEl = el("ai-output");
  const aiAskInput = el("ai-ask-input"), aiAskBtn = el("ai-ask-btn");

  const historyOverlay = el("history-overlay"), historyListEl = el("history-list"), closeHistoryBtn = el("close-history-btn");
  const exportOverlay = el("export-overlay"), closeExportBtn = el("close-export-btn");
  const quickOverlay = el("quick-overlay"), quickText = el("quick-text"), quickSaveBtn = el("quick-save-btn"),
        quickVoiceBtn = el("quick-voice-btn"), quickFileInput = el("quick-file-input"), quickFileName = el("quick-file-name"),
        closeQuickBtn = el("close-quick-btn");
  const askOverlay = el("ask-overlay"), askThread = el("ask-thread"), askInput = el("ask-input"), askSendBtn = el("ask-send-btn"), closeAskBtn = el("close-ask-btn");
  const folderOverlay = el("folder-overlay"), folderNameInput = el("folder-name-input"), folderParentSelect = el("folder-parent-select"),
        saveFolderBtn = el("save-folder-btn"), closeFolderBtn = el("close-folder-btn");

  const toastEl = el("toast");

  /* ---------------- State ---------------- */
  const state = {
    notes: [],
    folders: [],
    view: "notes",
    activeFolderId: null,
    activeTag: null,
    layout: "grid",
    search: "",
    filters: { category: "", favorite: false, hasFiles: false },
    activeNoteId: null,
    saveTimer: null,
    quickFile: null,
    linkPreviewCache: new Map(),
    liveAiEnabled: false,
  };

  /* ---------------- Generic helpers ---------------- */

  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => (toastEl.hidden = true), 3200);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function formatTime(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  async function api(path, options) {
    const res = await fetch(API + path, {
      headers: options && options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      let msg = "Request failed (" + res.status + ")";
      try {
        const body = await res.json();
        if (body && body.message) msg = body.message;
      } catch (e) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /* ============================================================
     Init
     ============================================================ */

  async function init() {
    applyStoredTheme();
    try {
      const status = await api("/notes/ai/status");
      state.liveAiEnabled = !!(status && status.liveAiEnabled);
    } catch (e) {}
    aiStatusEl.textContent = state.liveAiEnabled ? "Live AI connected" : "Offline AI";

    await Promise.all([loadFolders(), loadNotes()]);
    renderSidebarCounts();
    renderFolderTree();
    renderTagCloud();
    renderCurrentView();

    wireEvents();
  }

  async function loadNotes() {
    state.notes = (await api("/notes")) || [];
  }
  async function loadFolders() {
    state.folders = (await api("/folders")) || [];
    const options = ['<option value="">No folder</option>'].concat(
      state.folders.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`)
    );
    folderSelect.innerHTML = options.join("");
    folderParentSelect.innerHTML = ['<option value="">Top level</option>']
      .concat(state.folders.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`))
      .join("");
  }

  /* ============================================================
     Sidebar: nav / folders / tags
     ============================================================ */

  function renderSidebarCounts() {
    const active = state.notes.filter((n) => !n.deletedAt);
    countAll.textContent = active.length ? " " + active.length : "";
    countFav.textContent = active.filter((n) => n.favorite).length ? " " + active.filter((n) => n.favorite).length : "";
    countArch.textContent = active.filter((n) => n.archived).length ? " " + active.filter((n) => n.archived).length : "";
  }

  function renderFolderTree() {
    const byParent = new Map();
    state.folders.forEach((f) => {
      const key = f.parentId || "root";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(f);
    });

    function renderLevel(parentKey, depth) {
      const items = byParent.get(parentKey) || [];
      return items
        .map((f) => {
          const children = renderLevel(f.id, depth + 1);
          return `<li class="folder-item${depth > 0 ? " sub" : ""}${state.activeFolderId === f.id ? " active" : ""}" data-folder-id="${f.id}">
            <span class="fname">${depth > 0 ? "↳ " : "📁 "}${escapeHtml(f.name)}</span>
            <button class="icon-btn tiny danger folder-delete-btn" data-folder-id="${f.id}" title="Delete folder" aria-label="Delete folder">🗑</button>
          </li>${children}`;
        })
        .join("");
    }

    folderTreeEl.innerHTML = renderLevel("root", 0);

    folderTreeEl.querySelectorAll(".folder-item").forEach((li) => {
      li.addEventListener("click", () => {
        state.view = "folder";
        state.activeFolderId = Number(li.dataset.folderId);
        setActiveNav(null);
        renderFolderTree();
        renderCurrentView();
      });
      const deleteBtn = li.querySelector(".folder-delete-btn");
      if (deleteBtn) {
        deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const folderId = Number(deleteBtn.dataset.folderId);
          const folder = state.folders.find((f) => f.id === folderId);
          const name = folder ? folder.name : "this folder";
          const ok = confirm(`Delete "${name}"? Any notes or subfolders inside will be moved to the top level, not deleted.`);
          if (!ok) return;
          try {
            await api("/folders/" + folderId, { method: "DELETE" });
            if (state.activeFolderId === folderId) {
              state.view = "notes";
              state.activeFolderId = null;
              setActiveNav("notes");
            }
            await Promise.all([loadFolders(), loadNotes()]);
            renderSidebarCounts();
            renderFolderTree();
            renderTagCloud();
            renderCurrentView();
            toast("Folder deleted");
          } catch (err) {
            toast("Couldn't delete that folder");
          }
        });
      }
      li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("drop-target"); });
      li.addEventListener("dragleave", () => li.classList.remove("drop-target"));
      li.addEventListener("drop", async (e) => {
        e.preventDefault();
        li.classList.remove("drop-target");
        const noteId = e.dataTransfer.getData("text/note-id");
        if (!noteId) return;
        try {
          await api(`/notes/${noteId}/move?folderId=${li.dataset.folderId}`, { method: "PATCH" });
          await loadNotes();
          renderCurrentView();
          toast("Note moved to folder");
        } catch (err) {
          toast("Couldn't move the note");
        }
      });
    });
  }

  function renderTagCloud() {
    const counts = new Map();
    state.notes.filter((n) => !n.deletedAt).forEach((n) => (n.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    tagCloudEl.innerHTML = tags
      .map(([t]) => `<button class="tag-pill${state.activeTag === t ? " active" : ""}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`)
      .join("");
    tagCloudEl.querySelectorAll(".tag-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeTag = state.activeTag === btn.dataset.tag ? null : btn.dataset.tag;
        renderTagCloud();
        renderCurrentView();
      });
    });
  }

  function setActiveNav(view) {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  }

  /* ============================================================
     View switching + notes grid
     ============================================================ */

  function renderCurrentView() {
    viewNotes.hidden = true;
    viewGraph.hidden = true;
    viewDashboard.hidden = true;

    if (state.view === "graph") {
      viewGraph.hidden = false;
      loadAndRenderGraph();
      return;
    }
    if (state.view === "dashboard") {
      viewDashboard.hidden = false;
      loadAndRenderDashboard();
      return;
    }
    viewNotes.hidden = false;
    renderNotesView();
  }

  async function fetchNotesForView() {
    if (state.search.trim()) {
      const params = new URLSearchParams({ q: state.search });
      if (state.filters.category) params.set("category", state.filters.category);
      if (state.filters.favorite) params.set("favorite", "true");
      if (state.filters.hasFiles) params.set("hasFiles", "true");
      if (state.activeTag) params.set("tag", state.activeTag);
      return (await api("/notes/search?" + params.toString())) || [];
    }
    if (state.view === "favorites") return (await api("/notes/favorites")) || [];
    if (state.view === "archive") return (await api("/notes/archived")) || [];
    if (state.view === "trash") return (await api("/notes/trash")) || [];
    if (state.view === "folder" && state.activeFolderId) return (await api("/notes/folder/" + state.activeFolderId)) || [];
    return state.notes.filter((n) => !n.deletedAt);
  }

  async function renderNotesView() {
    let notes = await fetchNotesForView();

    if (state.activeTag && !state.search.trim()) {
      notes = notes.filter((n) => (n.tags || []).includes(state.activeTag));
    }
    if (state.filters.category && !state.search.trim()) {
      notes = notes.filter((n) => n.category === state.filters.category);
    }
    if (state.filters.favorite && !state.search.trim()) {
      notes = notes.filter((n) => n.favorite);
    }

    const titles = {
      notes: "All notes", favorites: "Favorites", archive: "Archive",
      trash: "Trash", folder: folderName(state.activeFolderId),
    };
    viewTitle.textContent = state.search.trim() ? `Results for “${state.search}”` : (titles[state.view] || "Notes");

    notesEmpty.hidden = notes.length !== 0;
    noteGrid.innerHTML = "";
    noteGrid.className = "note-grid" + (state.layout === "list" ? " layout-list" : "");

    notes.forEach((note, i) => {
      const card = document.createElement("div");
      card.className = "note-card";
      card.style.animationDelay = Math.min(i * 35, 300) + "ms";
      card.draggable = state.view !== "trash";
      const preview = (note.contentHtml || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const tagsHtml = (note.tags || []).slice(0, 4).map((t) => `<span>#${escapeHtml(t)}</span>`).join("");
      const attCount = note._attCount || "";

      card.innerHTML = `
        <div class="note-card-top">
          <h3>${escapeHtml(note.title || "Untitled note")}</h3>
          <div class="note-card-badges">
            ${note.pinned ? "<span title='Pinned'>📌</span>" : ""}
            ${note.favorite ? "<span title='Favorite'>⭐</span>" : ""}
          </div>
        </div>
        <p>${escapeHtml(preview) || "No content yet"}</p>
        <div class="note-card-footer">
          <div class="note-card-tags">${tagsHtml}</div>
          <time>${formatTime(note.updatedAt)}</time>
        </div>`;

      card.addEventListener("click", () => {
        if (state.view === "trash") { openTrashActions(note); return; }
        openEditor(note.id);
      });
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/note-id", note.id);
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));

      noteGrid.appendChild(card);
    });
  }

  function folderName(id) {
    const f = state.folders.find((f) => f.id === id);
    return f ? f.name : "Folder";
  }

  async function openTrashActions(note) {
    const restore = confirm(`Restore "${note.title}" from Trash? Choose Cancel to permanently delete it instead.`);
    try {
      if (restore) {
        await api(`/notes/${note.id}/restore`, { method: "POST" });
        toast("Note restored");
      } else {
        const confirmPermanent = confirm("Permanently delete this note? This cannot be undone.");
        if (!confirmPermanent) return;
        await api(`/notes/${note.id}/permanent`, { method: "DELETE" });
        toast("Note permanently deleted");
      }
      await loadNotes();
      renderCurrentView();
      renderSidebarCounts();
    } catch (e) {
      toast("Something went wrong");
    }
  }

  /* ============================================================
     Note editor
     ============================================================ */

  async function createAndOpenNote(initial) {
    const draft = Object.assign({ title: "Untitled note", contentHtml: "" }, initial || {});
    const created = await api("/notes", { method: "POST", body: JSON.stringify(draft) });
    await loadNotes();
    renderSidebarCounts();
    openEditor(created.id);
  }

  let currentNote = null;

  async function openEditor(id) {
    try {
      currentNote = await api("/notes/" + id);
    } catch (e) {
      toast("Couldn't load that note");
      return;
    }
    state.activeNoteId = id;

    titleInputRef.value = currentNote.title || "";
    contentEditorRef.innerHTML = currentNote.contentHtml || "";
    folderSelect.value = currentNote.folderId || "";
    categorySelect.value = currentNote.category || "";
    tagsInput.value = (currentNote.tags || []).join(", ");
    pinBtn.classList.toggle("active", !!currentNote.pinned);
    favoriteBtn.classList.toggle("active", !!currentNote.favorite);
    archiveBtn.classList.toggle("active", !!currentNote.archived);
    saveIndicator.textContent = "Saved " + formatTime(currentNote.updatedAt);
    aiOutputEl.innerHTML = "";

    editorOverlay.hidden = false;
    renderAttachments();
    scanAndRenderLinkPreviews();

    // Imperative focus via the DOM ref, right after opening — the vanilla-JS
    // equivalent of calling inputRef.current.focus() in React.
    titleInputRef.focus();
    titleInputRef.select();
  }

  function closeEditor() {
    editorOverlay.hidden = true;
    currentNote = null;
    state.activeNoteId = null;
    loadNotes().then(() => { renderSidebarCounts(); renderTagCloud(); renderFolderTree(); renderCurrentView(); });
  }

  function queueAutosave() {
    saveIndicator.textContent = "Saving…";
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveCurrentNote, 600);
  }

  async function saveCurrentNote() {
    if (!state.activeNoteId) return;
    const tags = tagsInput.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    const body = {
      title: titleInputRef.value.trim() || "Untitled note",
      contentHtml: contentEditorRef.innerHTML,
      folderId: folderSelect.value ? Number(folderSelect.value) : null,
      tags: tags,
      category: categorySelect.value || null,
    };
    try {
      currentNote = await api("/notes/" + state.activeNoteId, { method: "PUT", body: JSON.stringify(body) });
      saveIndicator.textContent = "Saved " + formatTime(currentNote.updatedAt);
      scanAndRenderLinkPreviews();
    } catch (e) {
      saveIndicator.textContent = "Couldn't save — retrying…";
    }
  }

  async function toggleNoteFlag(flag, btn) {
    if (!state.activeNoteId) return;
    const endpoint = { pin: "pin", favorite: "favorite", archive: "archive" }[flag];
    currentNote = await api(`/notes/${state.activeNoteId}/${endpoint}`, { method: "PATCH" });
    btn.classList.toggle("active", !!currentNote[flag === "pin" ? "pinned" : flag]);
    toast(flag[0].toUpperCase() + flag.slice(1) + " updated");
  }

  async function deleteCurrentNote() {
    if (!state.activeNoteId) return;
    if (!confirm("Move this note to Trash?")) return;
    await api("/notes/" + state.activeNoteId, { method: "DELETE" });
    toast("Moved to Trash");
    closeEditor();
  }

  /* ---------------- Rich block editor toolbar ---------------- */

  function execCmd(command, value) {
    contentEditorRef.focus();
    document.execCommand(command, false, value);
    queueAutosave();
  }

  function insertHtmlAtCursor(html) {
    contentEditorRef.focus();
    const sel = window.getSelection();
    let range;
    if (sel && sel.rangeCount && contentEditorRef.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      range = sel.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(contentEditorRef);
      range.collapse(false);
    }
    range.deleteContents();
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const frag = document.createDocumentFragment();
    let node, lastNode;
    while ((node = wrapper.firstChild)) lastNode = frag.appendChild(node);
    range.insertNode(frag);
    if (lastNode) {
      const newRange = document.createRange();
      newRange.setStartAfter(lastNode);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
    queueAutosave();
  }

  function handleBlockInsert(type) {
    switch (type) {
      case "h2": execCmd("formatBlock", "<h2>"); break;
      case "h3": execCmd("formatBlock", "<h3>"); break;
      case "quote": execCmd("formatBlock", "<blockquote>"); break;
      case "code": insertHtmlAtCursor("<pre><code>// your code</code></pre><p><br></p>"); break;
      case "checklist": insertHtmlAtCursor(`<div class="checklist-item" data-checked="false" contenteditable="false"><input type="checkbox" /><span contenteditable="true">New item</span></div><p><br></p>`); break;
      case "table": insertHtmlAtCursor(`<table><tbody><tr><td>Header 1</td><td>Header 2</td></tr><tr><td>Row 1</td><td></td></tr><tr><td>Row 2</td><td></td></tr></tbody></table><p><br></p>`); break;
      case "image": promptInsertImage(); break;
      case "link": promptInsertLink(); break;
    }
  }

  async function promptInsertImage() {
    const url = window.prompt("Paste an image URL (Cancel to upload a file instead):");
    if (url) { insertHtmlAtCursor(`<img src="${escapeHtml(url)}" alt="image" />`); return; }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files[0];
      if (!file || !state.activeNoteId) return;
      try {
        const uploaded = await uploadAttachment(state.activeNoteId, file);
        insertHtmlAtCursor(`<img src="/api/attachments/${uploaded.id}/download" alt="${escapeHtml(uploaded.originalName)}" />`);
        renderAttachments();
      } catch (e) {
        toast("Image upload failed");
      }
    };
    input.click();
  }

  function promptInsertLink() {
    const url = window.prompt("Paste a website, YouTube, Google Maps, or document link:");
    if (!url) return;
    insertHtmlAtCursor(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a> `);
    scanAndRenderLinkPreviews();
  }

  /* ---------------- Link previews ---------------- */

  function extractUrls(html) {
    const text = (html || "").replace(/<[^>]*>/g, " ");
    const matches = text.match(/https?:\/\/[^\s<>"')]+/g) || [];
    return [...new Set(matches)].slice(0, 8);
  }

  async function scanAndRenderLinkPreviews() {
    const urls = extractUrls(contentEditorRef.innerHTML);
    linkPreviewsEl.innerHTML = "";
    for (const url of urls) {
      let preview = state.linkPreviewCache.get(url);
      if (!preview) {
        try {
          preview = await api("/link-preview?url=" + encodeURIComponent(url));
          state.linkPreviewCache.set(url, preview);
        } catch (e) {
          continue;
        }
      }
      renderLinkCard(preview);
    }
  }

  function renderLinkCard(p) {
    let html;
    if (p.type === "youtube" || p.type === "map") {
      html = `<div class="link-card" style="flex-direction:column;align-items:stretch;">
        <iframe src="${p.embedUrl}" allowfullscreen loading="lazy"></iframe>
        <div class="link-body"><div class="link-title">${escapeHtml(p.title)}</div><div class="link-domain">${escapeHtml(p.domain || "")}</div></div>
      </div>`;
    } else {
      html = `<a class="link-card" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">
        ${p.image ? `<img src="${escapeHtml(p.image)}" alt="" />` : ""}
        <div class="link-body">
          <div class="link-title">${escapeHtml(p.title || p.url)}</div>
          <div class="link-domain">${escapeHtml(p.siteName || p.domain || "")}</div>
        </div>
      </a>`;
    }
    linkPreviewsEl.insertAdjacentHTML("beforeend", html);
  }

  /* ---------------- Attachments ---------------- */

  async function uploadAttachment(noteId, file) {
    const form = new FormData();
    form.append("file", file);
    return api(`/notes/${noteId}/attachments`, { method: "POST", body: form });
  }

  async function renderAttachments() {
    if (!state.activeNoteId) return;
    const list = (await api(`/notes/${state.activeNoteId}/attachments`)) || [];
    attachmentsListEl.innerHTML = list
      .map(
        (a) => `<li>
          <span class="att-name">📄 ${escapeHtml(a.originalName)}</span>
          <span class="att-size">${formatBytes(a.sizeBytes)}</span>
          <a class="icon-btn tiny" href="/api/attachments/${a.id}/download" target="_blank" title="Open / download">⤓</a>
          <button class="icon-btn tiny danger" data-att-id="${a.id}" title="Remove">✕</button>
        </li>`
      )
      .join("");
    attachmentsListEl.querySelectorAll("[data-att-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api("/attachments/" + btn.dataset.attId, { method: "DELETE" });
        renderAttachments();
      });
    });
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 KB";
    const kb = bytes / 1024;
    return kb < 1024 ? kb.toFixed(0) + " KB" : (kb / 1024).toFixed(1) + " MB";
  }

  /* ---------------- AI Assistant ---------------- */

  function renderAiTextResult(result) {
    const tag = result.live ? '<span class="live-tag">Live AI</span>' : '<span class="offline-tag">Offline AI</span>';
    const note = result.note ? `<div style="color:var(--text-faint);font-size:11px;margin-bottom:6px;">${escapeHtml(result.note)}</div>` : "";
    aiOutputEl.innerHTML = tag + note + `<div>${escapeHtml(result.text || "")}</div>`;
  }

  function renderAiListResult(result, heading) {
    const tag = result.live ? '<span class="live-tag">Live AI</span>' : '<span class="offline-tag">Offline AI</span>';
    const items = (result.list || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("");
    aiOutputEl.innerHTML = tag + `<ul style="margin:4px 0 0;padding-left:18px;">${items || "<li>Nothing to show yet.</li>"}</ul>`;
  }

  async function runAiAction(action) {
    if (!state.activeNoteId) return;
    aiOutputEl.innerHTML = "Thinking…";
    try {
      if (action === "summarize") renderAiTextResult(await api(`/notes/${state.activeNoteId}/ai/summarize`, { method: "POST" }));
      else if (action === "rewrite") renderAiTextResult(await api(`/notes/${state.activeNoteId}/ai/rewrite`, { method: "POST" }));
      else if (action === "key-points") renderAiListResult(await api(`/notes/${state.activeNoteId}/ai/key-points`, { method: "POST" }));
      else if (action === "checklist") {
        const result = await api(`/notes/${state.activeNoteId}/ai/checklist`, { method: "POST" });
        renderAiListResult(result);
        if (result.list && result.list.length && confirm("Insert this checklist into the note?")) {
          const html = result.list.map((i) => `<div class="checklist-item" data-checked="false" contenteditable="false"><input type="checkbox" /><span contenteditable="true">${escapeHtml(i)}</span></div>`).join("");
          contentEditorRef.insertAdjacentHTML("beforeend", html);
          queueAutosave();
        }
      } else if (action === "suggest-meta") {
        const result = await api(`/notes/${state.activeNoteId}/ai/suggest-meta`, { method: "POST" });
        const meta = result.meta || {};
        const tag = result.live ? '<span class="live-tag">Live AI</span>' : '<span class="offline-tag">Offline AI</span>';
        aiOutputEl.innerHTML = tag + `<div><b>Title:</b> ${escapeHtml(meta.title || "")}</div><div><b>Category:</b> ${escapeHtml(meta.category || "")}</div><div><b>Tags:</b> ${(meta.tags || []).map(escapeHtml).join(", ")}</div>`;
        if (confirm("Apply these suggestions to the note?")) {
          if (meta.title) titleInputRef.value = meta.title;
          if (meta.category) categorySelect.value = meta.category;
          if (meta.tags && meta.tags.length) tagsInput.value = meta.tags.join(", ");
          queueAutosave();
        }
      }
    } catch (e) {
      aiOutputEl.textContent = "The AI assistant couldn't process this right now.";
    }
  }

  async function askAboutNote() {
    const question = aiAskInput.value.trim();
    if (!question || !state.activeNoteId) return;
    aiOutputEl.innerHTML = "Thinking…";
    try {
      const result = await api(`/notes/${state.activeNoteId}/ai/ask`, { method: "POST", body: JSON.stringify({ question }) });
      renderAiTextResult(result);
    } catch (e) {
      aiOutputEl.textContent = "Couldn't answer that right now.";
    }
    aiAskInput.value = "";
  }

  async function convertNote(format) {
    if (!state.activeNoteId) return;
    aiOutputEl.innerHTML = "Converting…";
    try {
      const result = await api(`/notes/${state.activeNoteId}/ai/convert?format=${format}`);
      const meta = result.meta || {};
      if (format === "table") {
        const rows = (meta.rows || []).map((r) => `<tr><td>${escapeHtml(r.item)}</td><td>${escapeHtml(r.detail)}</td></tr>`).join("");
        aiOutputEl.innerHTML = `<table class="ai-table">${rows}</table>`;
      } else if (format === "timeline") {
        const items = (meta.steps || []).map((s) => `<li><b>${escapeHtml(s.label)}</b> — ${escapeHtml(s.text)}</li>`).join("");
        aiOutputEl.innerHTML = `<ul class="ai-timeline">${items}</ul>`;
      } else if (format === "flashcards") {
        const cards = (meta.cards || [])
          .map((c) => `<div class="flashcard"><div class="q">${escapeHtml(c.question)}</div><div class="a">${escapeHtml(c.answer)}</div></div>`)
          .join("");
        aiOutputEl.innerHTML = cards || "Not enough content for flashcards yet.";
        aiOutputEl.querySelectorAll(".flashcard").forEach((card) => card.addEventListener("click", () => card.classList.toggle("flipped")));
      } else if (format === "outline") {
        const items = (meta.outline || []).map((o, i) => `<li>${i + 1}. ${escapeHtml(o)}</li>`).join("");
        aiOutputEl.innerHTML = `<ul style="list-style:none;padding:0;">${items}</ul>`;
      }
    } catch (e) {
      aiOutputEl.textContent = "Couldn't convert this note right now.";
    }
  }

  /* ---------------- Version history ---------------- */

  async function openHistory() {
    if (!state.activeNoteId) return;
    const versions = (await api(`/notes/${state.activeNoteId}/versions`)) || [];
    historyListEl.innerHTML = versions.length
      ? versions.map((v) => `<li><span>${escapeHtml(v.titleSnapshot || "Untitled")} · ${formatTime(v.savedAt)}</span><button data-version-id="${v.id}">Restore</button></li>`).join("")
      : "<li>No earlier versions yet — they appear as you keep editing.</li>";
    historyListEl.querySelectorAll("[data-version-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        currentNote = await api(`/notes/${state.activeNoteId}/versions/${btn.dataset.versionId}/restore`, { method: "POST" });
        titleInputRef.value = currentNote.title;
        contentEditorRef.innerHTML = currentNote.contentHtml || "";
        historyOverlay.hidden = true;
        toast("Version restored");
      });
    });
    historyOverlay.hidden = false;
  }

  /* ---------------- Export ---------------- */

  function htmlToMarkdown(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    function walk(node) {
      let out = "";
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) { out += child.textContent; return; }
        const tag = child.tagName ? child.tagName.toLowerCase() : "";
        const inner = walk(child);
        if (tag === "h2") out += "\n## " + inner + "\n";
        else if (tag === "h3") out += "\n### " + inner + "\n";
        else if (tag === "blockquote") out += "\n> " + inner + "\n";
        else if (tag === "pre") out += "\n```\n" + child.textContent + "\n```\n";
        else if (tag === "li") out += "\n- " + inner;
        else if (tag === "b" || tag === "strong") out += "**" + inner + "**";
        else if (tag === "i" || tag === "em") out += "_" + inner + "_";
        else if (tag === "img") out += `\n![${child.alt || "image"}](${child.src})\n`;
        else if (tag === "a") out += `[${inner}](${child.href})`;
        else if (tag === "p" || tag === "div") out += inner + "\n";
        else out += inner;
      });
      return out;
    }
    return walk(div).replace(/\n{3,}/g, "\n\n").trim();
  }

  function htmlToPlainText(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return (div.textContent || "").replace(/\s+\n/g, "\n").trim();
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function exportNote(format) {
    if (!currentNote) return;
    const title = titleInputRef.value || "note";
    const safeName = title.replace(/[^a-z0-9]+/gi, "_").toLowerCase();

    if (format === "pdf") {
      try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const text = htmlToPlainText(contentEditorRef.innerHTML);
        doc.setFontSize(16);
        doc.text(title, 14, 18);
        doc.setFontSize(11);
        const lines = doc.splitTextToSize(text, 180);
        doc.text(lines, 14, 30);
        doc.save(safeName + ".pdf");
      } catch (e) {
        toast("PDF export needs an internet connection to load its library.");
      }
    } else if (format === "docx") {
      const htmlDoc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
        <body><h1>${escapeHtml(title)}</h1>${contentEditorRef.innerHTML}</body></html>`;
      downloadBlob(htmlDoc, safeName + ".doc", "application/msword");
    } else if (format === "txt") {
      downloadBlob(title + "\n\n" + htmlToPlainText(contentEditorRef.innerHTML), safeName + ".txt", "text/plain");
    } else if (format === "md") {
      downloadBlob("# " + title + "\n\n" + htmlToMarkdown(contentEditorRef.innerHTML), safeName + ".md", "text/markdown");
    } else if (format === "print") {
      window.print();
    } else if (format === "share") {
      const link = location.origin + "/share.html?id=" + state.activeNoteId;
      navigator.clipboard ? navigator.clipboard.writeText(link).then(() => toast("Shareable link copied")) : toast(link);
    }
    exportOverlay.hidden = true;
  }

  /* ---------------- Voice to text ---------------- */

  function makeRecognizer(onResult) {
    const Recognizer = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognizer) { toast("Voice input isn't supported in this browser — try Chrome."); return null; }
    const rec = new Recognizer();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript;
      onResult(text.trim());
    };
    return rec;
  }

  let editorRecognizer = null;
  function toggleEditorVoice() {
    if (editorRecognizer) { editorRecognizer.stop(); editorRecognizer = null; voiceBtn.classList.remove("active"); return; }
    editorRecognizer = makeRecognizer((text) => insertHtmlAtCursor(escapeHtml(text) + " "));
    if (editorRecognizer) { editorRecognizer.start(); voiceBtn.classList.add("active"); }
  }

  let quickRecognizer = null;
  function toggleQuickVoice() {
    if (quickRecognizer) { quickRecognizer.stop(); quickRecognizer = null; quickVoiceBtn.classList.remove("active"); return; }
    quickRecognizer = makeRecognizer((text) => (quickText.value = (quickText.value + " " + text).trim()));
    if (quickRecognizer) { quickRecognizer.start(); quickVoiceBtn.classList.add("active"); }
  }

  /* ---------------- Quick capture ---------------- */

  function openQuickCapture() {
    quickText.value = "";
    quickFileName.textContent = "";
    state.quickFile = null;
    quickOverlay.hidden = false;
    setTimeout(() => quickText.focus(), 50);
  }

  async function saveQuickCapture() {
    const text = quickText.value.trim();
    if (!text && !state.quickFile) { toast("Nothing to save yet"); return; }
    const firstLine = text.split("\n")[0].slice(0, 60) || "Quick note";
    const paragraphs = text.split("\n").filter(Boolean).map((l) => `<p>${escapeHtml(l)}</p>`).join("");
    try {
      const created = await api("/notes", { method: "POST", body: JSON.stringify({ title: firstLine, contentHtml: paragraphs }) });
      if (state.quickFile) await uploadAttachment(created.id, state.quickFile);
      await loadNotes();
      renderSidebarCounts();
      renderCurrentView();
      quickOverlay.hidden = true;
      toast("Saved to your notes");
    } catch (e) {
      toast("Couldn't save that — try again");
    }
  }

  /* ---------------- Ask My Notes ---------------- */

  function openAskOverlay() {
    askOverlay.hidden = false;
    setTimeout(() => askInput.focus(), 50);
  }

  function addAskBubble(text, cls, matches) {
    const bubble = document.createElement("div");
    bubble.className = "ask-bubble " + cls;
    bubble.innerHTML = escapeHtml(text);
    if (matches && matches.length) {
      const row = document.createElement("div");
      row.className = "matches";
      matches.forEach((m) => {
        const span = document.createElement("span");
        span.textContent = m.title;
        span.addEventListener("click", () => { askOverlay.hidden = true; openEditor(m.id); });
        row.appendChild(span);
      });
      bubble.appendChild(row);
    }
    askThread.appendChild(bubble);
    askThread.scrollTop = askThread.scrollHeight;
  }

  async function sendAskQuestion() {
    const question = askInput.value.trim();
    if (!question) return;
    addAskBubble(question, "user");
    askInput.value = "";
    try {
      const result = await api("/notes/ask", { method: "POST", body: JSON.stringify({ question }) });
      const meta = result.meta || {};
      const matches = (meta.matchedNoteIds || []).map((id, i) => ({ id, title: (meta.matchedTitles || [])[i] || "Note" }));
      addAskBubble(meta.answer || "I couldn't find anything about that.", "ai", matches);
    } catch (e) {
      addAskBubble("Something went wrong answering that.", "ai");
    }
  }

  /* ---------------- Folders ---------------- */

  function openFolderModal() {
    folderNameInput.value = "";
    folderOverlay.hidden = false;
    setTimeout(() => folderNameInput.focus(), 50);
  }

  async function saveFolder() {
    const name = folderNameInput.value.trim();
    if (!name) return;
    const parentId = folderParentSelect.value ? Number(folderParentSelect.value) : null;
    await api("/folders", { method: "POST", body: JSON.stringify({ name, parentId }) });
    await loadFolders();
    renderFolderTree();
    folderOverlay.hidden = true;
    toast("Folder created");
  }

  /* ============================================================
     Knowledge graph (custom lightweight force layout on <canvas>)
     ============================================================ */

  const CATEGORY_COLORS = {
    Work: "#3d7bfd", Personal: "#14b8a6", Study: "#e0a530", Finance: "#e35a5a",
    Health: "#2fb5a3", Travel: "#c17fd6", Ideas: "#6f7fe0", Shopping: "#d68a3e",
  };

  let graphNodes = [], graphEdges = [], graphAnimId = null, graphDragging = null;

  async function loadAndRenderGraph() {
  try {
    const data = await api("/notes/graph");

    if (!data || !data.nodes || data.nodes.length === 0) {
      graphEmpty.hidden = false;
      cancelAnimationFrame(graphAnimId);

      const ctx = graphCanvas.getContext("2d");
      ctx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
      return;
    }

    graphEmpty.hidden = true;

    // Get the actual graph container size
    const rect = graphCanvas.parentElement.getBoundingClientRect();

    // Give the canvas a safe minimum size
    const width = Math.max(rect.width, 600);
    const height = Math.max(rect.height, 500);

    // Set the real canvas drawing size
    graphCanvas.width = width;
    graphCanvas.height = height;

    // Create graph nodes
    graphNodes = data.nodes.map((n) => ({
      ...n,
      title: String(n.title || "Untitled note"),

      // Start nodes around the center
      x: width / 2 + (Math.random() - 0.5) * width * 0.6,
      y: height / 2 + (Math.random() - 0.5) * height * 0.6,

      vx: 0,
      vy: 0,
    }));

    graphEdges = data.edges || [];

    // Stop previous animation
    cancelAnimationFrame(graphAnimId);

    let ticks = 0;

    function tick() {
      const W = graphCanvas.width;
      const H = graphCanvas.height;

      // ---------------- REPULSION ----------------
      for (let i = 0; i < graphNodes.length; i++) {
        for (let j = i + 1; j < graphNodes.length; j++) {
          const a = graphNodes[i];
          const b = graphNodes[j];

          let dx = a.x - b.x;
          let dy = a.y - b.y;

          let dist = Math.sqrt(dx * dx + dy * dy) || 1;

          const force = 1400 / (dist * dist);

          dx /= dist;
          dy /= dist;

          a.vx += dx * force;
          a.vy += dy * force;

          b.vx -= dx * force;
          b.vy -= dy * force;
        }
      }

      // ---------------- EDGE ATTRACTION ----------------
      graphEdges.forEach((e) => {
        const a = graphNodes.find((n) => n.id === e.source);
        const b = graphNodes.find((n) => n.id === e.target);

        if (!a || !b) return;

        let dx = b.x - a.x;
        let dy = b.y - a.y;

        let dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const target = 140;

        const force =
          (dist - target) *
          0.02 *
          Math.min(e.strength || 1, 3);

        dx /= dist;
        dy /= dist;

        a.vx += dx * force;
        a.vy += dy * force;

        b.vx -= dx * force;
        b.vy -= dy * force;
      });

      // ---------------- CENTER + MOVE ----------------
      graphNodes.forEach((n) => {
        if (n === graphDragging) {
          n.vx = 0;
          n.vy = 0;
          return;
        }

        // Keep nodes near the center
        n.vx += (W / 2 - n.x) * 0.0015;
        n.vy += (H / 2 - n.y) * 0.0015;

        // Friction
        n.vx *= 0.82;
        n.vy *= 0.82;

        // Move
        n.x += n.vx;
        n.y += n.vy;

        // Keep nodes inside canvas
        n.x = Math.max(24, Math.min(W - 24, n.x));
        n.y = Math.max(24, Math.min(H - 24, n.y));
      });

      // Draw graph
      drawGraph();

      ticks++;

      if (ticks < 260 || graphDragging) {
        graphAnimId = requestAnimationFrame(tick);
      }
    }

    // Start graph animation
    tick();

  } catch (error) {
    console.error("Knowledge graph error:", error);

    cancelAnimationFrame(graphAnimId);

    graphEmpty.hidden = false;
    graphEmpty.textContent = "Unable to load knowledge graph.";

    const ctx = graphCanvas.getContext("2d");
    ctx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
  }
}
  function drawGraph() {
    const ctx = graphCanvas.getContext("2d");
    const W = graphCanvas.width, H = graphCanvas.height;
    ctx.clearRect(0, 0, W, H);

    graphEdges.forEach((e) => {
      const a = graphNodes.find((n) => n.id === e.source);
      const b = graphNodes.find((n) => n.id === e.target);
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = "rgba(124,92,255," + Math.min(0.15 + e.strength * 0.12, 0.6) + ")";
      ctx.lineWidth = Math.min(1 + e.strength, 4);
      ctx.stroke();
    });

    graphNodes.forEach((n) => {
      const degree = graphEdges.filter((e) => e.source === n.id || e.target === n.id).length;
      const r = 9 + Math.min(degree * 2.2, 14);
      const color = CATEGORY_COLORS[n.category] || "#8891a7";
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = "500 11px Inter, sans-serif";
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text").trim() || "#e9edf5";
      const title = String(n.title || "Untitled note");
const label = title.length > 18 ? title.slice(0, 18) + "…" : title;
      ctx.fillText(label, n.x + r + 6, n.y + 4);
    });
  }

  function graphNodeAt(x, y) {
    return graphNodes.find((n) => Math.hypot(n.x - x, n.y - y) < 16);
  }

  function wireGraphInteraction() {
    let downPos = null;
    graphCanvas.addEventListener("mousedown", (e) => {
      const rect = graphCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const node = graphNodeAt(x, y);
      downPos = { x, y, node };
      if (node) { graphDragging = node; graphAnimId && cancelAnimationFrame(graphAnimId); requestAnimationFrame(function loop() { drawGraph(); if (graphDragging) requestAnimationFrame(loop); }); }
    });
    graphCanvas.addEventListener("mousemove", (e) => {
      if (!graphDragging) return;
      const rect = graphCanvas.getBoundingClientRect();
      graphDragging.x = e.clientX - rect.left;
      graphDragging.y = e.clientY - rect.top;
    });
    window.addEventListener("mouseup", (e) => {
      if (downPos && downPos.node) {
        const rect = graphCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const moved = Math.hypot(x - downPos.x, y - downPos.y) > 6;
        if (!moved) openEditor(downPos.node.id);
      }
      graphDragging = null;
      downPos = null;
    });
  }

  /* ============================================================
     Dashboard
     ============================================================ */

  async function loadAndRenderDashboard() {
    const d = await api("/notes/dashboard");
    const categories = Object.entries(d.byCategory || {});
    const maxCat = Math.max(1, ...categories.map(([, v]) => v));

    dashGrid.innerHTML = `
      <div class="dash-card"><h4>Total notes</h4><div class="dash-stat">${d.totalNotes}</div></div>
      <div class="dash-card"><h4>Favorites</h4><div class="dash-stat">${d.totalFavorites}</div></div>
      <div class="dash-card"><h4>Archived</h4><div class="dash-stat">${d.totalArchived}</div></div>
      <div class="dash-card"><h4>Attachments</h4><div class="dash-stat">${d.totalAttachments}</div></div>

      <div class="dash-card" style="grid-column: span 2;">
        <h4>Notes by category</h4>
        ${categories.map(([cat, count]) => `
          <div class="dash-bar-row"><span style="width:90px;">${escapeHtml(cat)}</span>
          <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${(count / maxCat) * 100}%"></div></div>
          <span>${count}</span></div>`).join("") || "<p style='color:var(--text-muted)'>No categorized notes yet.</p>"}
      </div>

      <div class="dash-card">
        <h4>Most-used tags</h4>
        <div class="tag-cloud">${(d.topTags || []).map((t) => `<span class="tag-pill">#${escapeHtml(t.tag)} · ${t.count}</span>`).join("") || "<span style='color:var(--text-muted)'>No tags yet</span>"}</div>
      </div>

      <div class="dash-card">
        <h4>Recent activity</h4>
        <ul class="dash-list" id="dash-recent"></ul>
      </div>

      <div class="dash-card">
        <h4>Favorite notes</h4>
        <ul class="dash-list" id="dash-favorites"></ul>
      </div>

      <div class="dash-card">
        <h4>Recently attached files</h4>
        <ul class="dash-list" id="dash-files"></ul>
      </div>

      <div class="dash-card">
        <h4>Knowledge graph</h4>
        <p style="color:var(--text-muted);font-size:12.8px;">See how your notes connect through shared tags and topics.</p>
        <button class="btn-ghost" id="dash-open-graph">Open graph view</button>
      </div>
    `;

    const recentUl = el("dash-recent");
    (d.recentActivity || []).forEach((n) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(n.title)}</span><time style="color:var(--text-faint);font-size:11px;">${formatTime(n.updatedAt)}</time>`;
      li.addEventListener("click", () => openEditor(n.id));
      recentUl.appendChild(li);
    });
    const favUl = el("dash-favorites");
    (d.favorites || []).forEach((n) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>⭐ ${escapeHtml(n.title)}</span>`;
      li.addEventListener("click", () => openEditor(n.id));
      favUl.appendChild(li);
    });
    const filesUl = el("dash-files");
    (d.recentFiles || []).forEach((f) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>📎 ${escapeHtml(f.originalName)}</span>`;
      li.addEventListener("click", () => window.open("/api/attachments/" + f.id + "/download", "_blank"));
      filesUl.appendChild(li);
    });
    el("dash-open-graph").addEventListener("click", () => { state.view = "graph"; setActiveNav("graph"); renderCurrentView(); });
  }

  /* ============================================================
     Theme
     ============================================================ */

  function applyStoredTheme() {
    const stored = localStorage.getItem("synapse.theme") || "dark";
    document.body.dataset.theme = stored;
    themeToggleBtn.textContent = stored === "dark" ? "🌙" : "☀️";
  }
  function toggleTheme() {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = next;
    localStorage.setItem("synapse.theme", next);
    themeToggleBtn.textContent = next === "dark" ? "🌙" : "☀️";
  }

  /* ============================================================
     Event wiring
     ============================================================ */

  function wireEvents() {
    newNoteBtn.addEventListener("click", () => createAndOpenNote());
    quickCaptureBtn.addEventListener("click", openQuickCapture);
    askNotesBtn.addEventListener("click", openAskOverlay);
    addFolderBtn.addEventListener("click", openFolderModal);
    themeToggleBtn.addEventListener("click", toggleTheme);
    sidebarToggleBtn.addEventListener("click", () => sidebarEl.classList.toggle("open"));

    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.view = btn.dataset.view;
        state.activeFolderId = null;
        state.search = "";
        searchInput.value = "";
        setActiveNav(btn.dataset.view);
        renderCurrentView();
        sidebarEl.classList.remove("open");
      });
    });

    let searchDebounce;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => { state.search = searchInput.value; renderCurrentView(); }, 300);
    });

    filterCategory.addEventListener("change", () => { state.filters.category = filterCategory.value; renderCurrentView(); });
    filterFavorite.addEventListener("click", () => {
      state.filters.favorite = !state.filters.favorite;
      filterFavorite.dataset.active = String(state.filters.favorite);
      renderCurrentView();
    });
    filterFiles.addEventListener("click", () => {
      state.filters.hasFiles = !state.filters.hasFiles;
      filterFiles.dataset.active = String(state.filters.hasFiles);
      renderCurrentView();
    });
    layoutBtns.forEach((btn) => btn.addEventListener("click", () => {
      state.layout = btn.dataset.layout;
      layoutBtns.forEach((b) => b.classList.toggle("active", b === btn));
      renderNotesView();
    }));

    // Editor
    closeEditorBtn.addEventListener("click", closeEditor);
    titleInputRef.addEventListener("input", queueAutosave);
    contentEditorRef.addEventListener("input", queueAutosave);
    contentEditorRef.addEventListener("change", (e) => {
      if (e.target.matches && e.target.matches(".checklist-item input[type=checkbox]")) {
        e.target.closest(".checklist-item").dataset.checked = e.target.checked;
        queueAutosave();
      }
    });
    folderSelect.addEventListener("change", queueAutosave);
    categorySelect.addEventListener("change", queueAutosave);
    tagsInput.addEventListener("change", () => { queueAutosave(); renderTagCloud(); });

    pinBtn.addEventListener("click", () => toggleNoteFlag("pin", pinBtn));
    favoriteBtn.addEventListener("click", () => toggleNoteFlag("favorite", favoriteBtn));
    archiveBtn.addEventListener("click", () => toggleNoteFlag("archive", archiveBtn));
    deleteNoteBtn.addEventListener("click", deleteCurrentNote);
    historyBtn.addEventListener("click", openHistory);
    closeHistoryBtn.addEventListener("click", () => (historyOverlay.hidden = true));
    exportBtn.addEventListener("click", () => (exportOverlay.hidden = false));
    closeExportBtn.addEventListener("click", () => (exportOverlay.hidden = true));
    document.querySelectorAll("[data-export]").forEach((b) => b.addEventListener("click", () => exportNote(b.dataset.export)));

    document.querySelectorAll("#editor-toolbar button").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.cmd) execCmd(btn.dataset.cmd);
        else if (btn.dataset.block) handleBlockInsert(btn.dataset.block);
        else if (btn.dataset.action === "voice") toggleEditorVoice();
      });
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file || !state.activeNoteId) return;
      try { await uploadAttachment(state.activeNoteId, file); renderAttachments(); toast("File attached"); }
      catch (e) { toast("Upload failed"); }
      fileInput.value = "";
    });

    document.querySelectorAll(".ai-btn").forEach((b) => b.addEventListener("click", () => runAiAction(b.dataset.ai)));
    aiAskBtn.addEventListener("click", askAboutNote);
    aiAskInput.addEventListener("keydown", (e) => { if (e.key === "Enter") askAboutNote(); });
    document.querySelectorAll(".convert-chips button").forEach((b) => b.addEventListener("click", () => convertNote(b.dataset.format)));

    // Quick capture
    closeQuickBtn.addEventListener("click", () => (quickOverlay.hidden = true));
    quickSaveBtn.addEventListener("click", saveQuickCapture);
    quickVoiceBtn.addEventListener("click", toggleQuickVoice);
    quickFileInput.addEventListener("change", () => {
      state.quickFile = quickFileInput.files[0] || null;
      quickFileName.textContent = state.quickFile ? state.quickFile.name : "";
    });

    // Ask my notes
    closeAskBtn.addEventListener("click", () => (askOverlay.hidden = true));
    askSendBtn.addEventListener("click", sendAskQuestion);
    askInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendAskQuestion(); });

    // Folder modal
    closeFolderBtn.addEventListener("click", () => (folderOverlay.hidden = true));
    saveFolderBtn.addEventListener("click", saveFolder);

    // Global shortcuts
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); createAndOpenNote(); }
      if (e.key === "Escape") {
        [editorOverlay, historyOverlay, exportOverlay, quickOverlay, askOverlay, folderOverlay].forEach((o) => {
          if (!o.hidden && o !== editorOverlay) o.hidden = true;
        });
      }
    });

    window.addEventListener("resize", () => { if (state.view === "graph" && !viewGraph.hidden) loadAndRenderGraph(); });

    wireGraphInteraction();
  }

  init();
})();
