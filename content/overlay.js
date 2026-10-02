(() => {
  "use strict";
  const paths = {
    bookmark: "M6 3h12v19l-6-4-6 4V3zm2 2v13l4-2.7 4 2.7V5z",
    bookmarkFilled: "M6 3h12v19l-6-4-6 4V3z",
    play: "M8 5v14l11-7z",
    stop: "M6 6h12v12H6z",
    history: "M4 4h16v16H4V4zm2 2v12h12V6H6zm2 2h8v2H8V8zm0 4h8v2H8v-2zm0 4h5v1H8v-1z",
    retry: "M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3z",
    bell: "M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1z",
    grip: "M8 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  };
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", paths[name]); svg.append(path); return svg;
  }
  function setButton(button, label, name) {
    if (button.getAttribute("aria-label") === label) return;
    button.setAttribute("aria-label", label); button.title = label;
    const dot = Array.from(button.children).find(child => child.className === "dot");
    button.replaceChildren(icon(name));
    if (dot) button.append(dot);
  }
  globalThis.createMeetOverlay = () => {
    const host = document.createElement("div"); host.id = "local-meet-transcript";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `:host {position:fixed;left:20px;bottom:24px;width:200px;height:48px;z-index:2147483647;max-width:calc(100vw - 16px)}
      * {box-sizing:border-box} section {display:flex;flex-direction:column;position:absolute;bottom:0;left:0;width:100%;color:#f1f3f4;background:rgba(32,33,36,.38);backdrop-filter:blur(10px);
        border:0;border-radius:28px;padding:6px 8px;
        font:13px/1.4 "Google Sans",Arial,sans-serif;box-shadow:0 2px 12px #0002;max-width:440px}
      :host([data-notification-direction="below"]) section {top:0;bottom:auto}
      :host([data-notification-direction="below"]) .bar {order:-1}
      :host([data-notification-direction="below"]) .notifications {padding-top:6px;padding-bottom:6px}
      .bar {display:flex;align-items:center;gap:6px} .handle {display:flex;align-items:center;gap:6px;
        cursor:grab;touch-action:none;user-select:none;min-width:0;padding:6px 0;flex:0 0 auto}
      .handle:active {cursor:grabbing} .handle>svg {width:16px;flex-shrink:0;color:#bdc1c6}
      .dot {position:absolute;top:-3px;right:-3px;width:16px;height:16px;border-radius:8px;background:#9aa0a6}
      [data-state="recording"] .dot {background:#57d68d}
      [data-state="stopped"] .dot {background:#9aa0a6}
      [data-state="error"] .dot {background:#f28b82}
      p {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      button {display:grid;place-items:center;
        height:36px;width:36px;flex-shrink:0;border:0;border-radius:50%;color:#e8eaed;
        background:rgba(60,64,67,.75);cursor:pointer;padding:8px;transition:background .15s}
      button:not(:disabled):hover {background:#5f6368} button:not(:disabled):active {background:#73777b}
      button.recording-toggle {position:relative;background:#188038;color:#fff} button.recording-toggle:not(:disabled):hover {background:#137333}
      button.recording-toggle[data-recording="true"] {background:rgba(234,67,53,.9);color:#fff} button.recording-toggle[data-recording="true"]:not(:disabled):hover {background:#c5221f}
      button:disabled {opacity:.4;cursor:default} svg {width:20px;height:20px;fill:currentColor}
      :focus-visible {outline:2px solid #a8c7fa;outline-offset:3px;border-radius:8px}
      .notifications {display:flex;flex-direction:column;gap:6px;padding-bottom:6px;max-height:var(--notification-space,calc(100vh - 88px));overflow:auto}
      .notification-header {display:flex;align-items:center;justify-content:space-between;padding:4px 8px;color:#f1f3f4;font:12px/1.4 Arial,sans-serif;background:transparent}
      .notification-header button {margin-right:-6px;width:22px;height:22px;padding:0;font-size:18px;background:transparent}
      .notification-toggle {position:relative}.badge {position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:#a8c7fa;color:#202124;font:10px/16px Arial,sans-serif;text-align:center}
      .diagnostic-download {width:100%;height:auto;border-radius:8px;font:12px/1.4 Arial,sans-serif;padding:4px 8px;background:rgba(60,64,67,.5)}
      .notification {padding:8px;border-radius:12px;background:transparent;color:#f1f3f4;
        font:12px/1.45 Arial,sans-serif;border:0;overflow-wrap:anywhere}
      .notification button {float:right;margin:-2px -2px 2px 6px;width:22px;height:22px;padding:0;font-size:18px;background:transparent}
      .notification[data-kind="info"] {background:rgba(40,55,75,.38)}
      .notification[data-kind="success"] {background:rgba(36,64,48,.38)}
      .notification[data-kind="warning"] {background:rgba(75,60,34,.38)}
      .notification[data-kind="error"] {background:rgba(75,40,40,.38)}
      .note-editor {width:100%;max-width:calc(100vw - 32px);padding:10px;background:#202124;border-radius:14px;margin-bottom:8px}
      .note-header {display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px}
      .note-header button {width:22px;height:22px;padding:0;font-size:18px;background:transparent}
      .bookmark-saved {font-size:13px;font-weight:600;color:#81e5a5}
      .bookmark-toggle {transition:color .25s,background .15s}.bookmark-toggle[data-saved="true"] {color:#81e5a5}
      .note-editor textarea {width:100%;min-height:70px;resize:vertical;background:#303134;color:#fff;border:1px solid #5f6368;border-radius:6px;padding:8px;font:13px/1.4 Arial,sans-serif}
      .note-footer {display:flex;align-items:center;gap:6px;font-size:11px}.note-footer span {flex:1}.note-footer button {width:auto;height:28px;border-radius:6px;font-size:12px}
      .note-editor .note-add {width:100%;height:32px;border-radius:6px;font-size:12px;background:#fff4cc;color:#79591a}
      [hidden] {display:none!important}`;
    const panel = document.createElement("section"); panel.setAttribute("aria-label", "Meet transcript controls");
    const bar = document.createElement("div"); bar.className = "bar";
    const handle = document.createElement("div"); handle.className = "handle"; handle.tabIndex = 0;
    handle.setAttribute("role", "button"); handle.setAttribute("aria-label", "Move transcript controls. Drag or use arrow keys.");
    handle.title = "Drag to move · Arrow keys to adjust";
    const dot = document.createElement("span"); dot.className = "dot"; dot.setAttribute("aria-hidden", "true");
    const status = document.createElement("p"); status.setAttribute("role", "status");
    handle.append(icon("grip"), status);
    const toggle = document.createElement("button"), history = document.createElement("button");
    toggle.className = "recording-toggle";
    setButton(toggle, "Start recording", "play");
    toggle.append(dot);
    setButton(history, "History", "history");
    const bookmark = document.createElement("button");
    bookmark.className = "bookmark-toggle";
    setButton(bookmark, "Bookmark this moment", "bookmark"); bookmark.disabled = true;
    bookmark.setAttribute("aria-controls", "echo-note-editor"); bookmark.setAttribute("aria-expanded", "false");
    const noteEditor = document.createElement("div"); noteEditor.className = "note-editor"; noteEditor.id = "echo-note-editor"; noteEditor.hidden = true;
    const noteHeader = document.createElement("div"); noteHeader.className = "note-header";
    const bookmarkSaved = document.createElement("span"); bookmarkSaved.className = "bookmark-saved"; bookmarkSaved.textContent = "Bookmark saved"; bookmarkSaved.setAttribute("role", "status");
    const noteClose = document.createElement("button"); noteClose.textContent = "×";
    noteClose.setAttribute("aria-label", "Close bookmark note"); noteClose.title = "Close bookmark note";
    noteHeader.append(bookmarkSaved, noteClose);
    const noteInput = document.createElement("textarea"); noteInput.id = "echo-note-text"; noteInput.maxLength = 10000; noteInput.placeholder = "Add a note…"; noteInput.setAttribute("aria-label", "Personal note");
    const noteFooter = document.createElement("div"); noteFooter.className = "note-footer";
    const noteStatus = document.createElement("span"); noteStatus.setAttribute("role", "status");
    const noteDone = document.createElement("button"); noteDone.textContent = "Done";
    const noteRetry = document.createElement("button"); noteRetry.textContent = "Retry"; noteRetry.hidden = true;
    noteFooter.append(noteStatus, noteRetry, noteDone); noteEditor.append(noteHeader, noteInput, noteFooter);
    const noteAdd = document.createElement("button"); noteAdd.type = "button"; noteAdd.className = "note-add";
    noteAdd.textContent = "Add Note"; noteAdd.hidden = true; noteEditor.append(noteAdd);
    noteAdd.addEventListener("focus", () => { noteFocused = true; clearTimeout(noteTimer); });
    noteAdd.addEventListener("click", () => {
      clearTimeout(noteTimer); noteAdd.hidden = true; noteInput.hidden = noteFooter.hidden = false;
      noteFocused = true; noteInput.focus?.();
    });
    let noteTimer, noteChange, noteQueue = Promise.resolve(), noteFocused = false, notePending = 0, noteSuspended = false, bookmarkFeedbackTimer;
    function suspendNote() {
      clearTimeout(noteTimer); noteSuspended = true; noteEditor.hidden = true;
      bookmark.setAttribute("aria-expanded", "false");
    }
    function closeNote(returnFocus = true) {
      if (notePending || !noteRetry.hidden) return;
      noteSuspended = false;
      clearTimeout(noteTimer); noteEditor.hidden = true; bookmark.setAttribute("aria-expanded", "false"); if (returnFocus) bookmark.focus?.();
    }
    function saveNote() {
      clearTimeout(noteTimer);
      const text = noteInput.value, change = noteChange;
      notePending++; noteStatus.textContent = "Saving…"; noteDone.disabled = true;
      noteQueue = noteQueue.catch(() => {}).then(() => change(text)).then(() => {
        noteStatus.textContent = "Saved privately"; noteRetry.hidden = true;
      }, () => {
        noteStatus.textContent = "Could not save. Retry."; noteRetry.hidden = false;
      }).finally(() => { notePending--; noteDone.disabled = notePending > 0; });
    }
    noteInput.addEventListener("focus", () => { noteFocused = true; clearTimeout(noteTimer); });
    noteInput.addEventListener("input", saveNote);
    noteRetry.addEventListener("click", saveNote);
    noteDone.addEventListener("click", closeNote);
    noteClose.addEventListener("click", () => {
      if (notePending || !noteRetry.hidden) { suspendNote(); bookmark.focus?.(); }
      else closeNote();
    });
    noteInput.addEventListener("keydown", event => {
      if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) { event.preventDefault(); closeNote(); }
    });
    function bookmarkFeedback() {
      clearTimeout(bookmarkFeedbackTimer);
      bookmark.dataset.saved = "true"; bookmark.replaceChildren(icon("bookmarkFilled"));
      bookmarkFeedbackTimer = setTimeout(() => {
        bookmark.dataset.saved = "false"; bookmark.replaceChildren(icon("bookmark"));
      }, 1500);
    }
    function resumeNote() {
      if (!noteSuspended) return false;
      noteSuspended = false; noteEditor.hidden = false; bookmark.setAttribute("aria-expanded", "true");
      notifications.hidden = true; updateNotifications();
      if (noteInput.hidden) noteAdd.focus?.(); else noteInput.focus?.();
      return true;
    }
    function showNote(change, keyboard = false) {
      notifications.hidden = true; updateNotifications(); noteSuspended = false; bookmarkFeedback();
      noteAdd.hidden = true; noteInput.hidden = noteFooter.hidden = false;
      clearTimeout(noteTimer); noteChange = change; noteInput.value = ""; noteEditor.hidden = false;
      noteFocused = false; noteRetry.hidden = true; noteStatus.textContent = "";
      bookmark.setAttribute("aria-expanded", "true");
      noteTimer = setTimeout(() => { if (!noteFocused && !noteInput.value) closeNote(false); }, 5000);
      if (keyboard) noteInput.focus?.();
    }
    function showBookmark(change) {
      showNote(change);
      noteInput.hidden = noteFooter.hidden = true; noteAdd.hidden = false;
    }
    const notificationToggle = document.createElement("button"); notificationToggle.className = "notification-toggle";
    notificationToggle.append(icon("bell")); notificationToggle.hidden = false;
    notificationToggle.setAttribute("aria-controls", "echo-notifications");
    notificationToggle.setAttribute("aria-expanded", "false");
    const badge = document.createElement("span"); badge.className = "badge"; badge.setAttribute("aria-hidden", "true");
    notificationToggle.append(badge);
    const notifications = document.createElement("div"); notifications.className = "notifications";
    notifications.id = "echo-notifications"; notifications.hidden = true;
    notifications.setAttribute("aria-label", "Transcript notifications");
    const messageHeader = document.createElement("div"); messageHeader.className = "notification-header";
    const heading = document.createElement("span"); heading.textContent = "Notifications";
    const closePanel = document.createElement("button"); closePanel.textContent = "×";
    closePanel.setAttribute("aria-label", "Close notifications"); closePanel.title = "Close notifications";
    messageHeader.append(heading, closePanel); notifications.append(messageHeader);
    const diagnostics = document.createElement("button"); diagnostics.className = "diagnostic-download"; diagnostics.type = "button";
    diagnostics.textContent = "Download diagnostics";
    diagnostics.title = "No transcript text or participant names. Attach this file to your bug report.";
    notifications.append(diagnostics);
    const messages = new Map();
    function updateNotifications() {
      const count = messages.size;
      badge.hidden = count === 0;
      badge.textContent = String(count);
      notificationToggle.setAttribute("aria-label", `${count} notification${count === 1 ? "" : "s"}`);
      notificationToggle.title = `${count} notification${count === 1 ? "" : "s"}`;
      notificationToggle.setAttribute("aria-expanded", String(!notifications.hidden));
    }
    notificationToggle.addEventListener("click", () => {
      if (notifications.hidden && !noteEditor.hidden) {
        // Keep the note and its save callback available when switching panels.
        suspendNote();
      }
      notifications.hidden = !notifications.hidden;
      updateNotifications();
    });
    closePanel.addEventListener("click", () => {
      notifications.hidden = true; updateNotifications(); notificationToggle.focus?.();
    });
    document.addEventListener("click", event => {
      // Clicks inside the closed shadow root include its host in the event path.
      if (!notifications.hidden && !event.composedPath().includes(host)) {
        notifications.hidden = true; updateNotifications();
      }
    }, true);
    host.addEventListener("keydown", event => {
      if (event.key === "Escape" && !notifications.hidden) {
        notifications.hidden = true; updateNotifications(); notificationToggle.focus?.();
      }
    });
    function notify(message, kind = "info") {
      if (messages.has(message)) return messages.get(message);
      const toast = document.createElement("div"); toast.className = "notification"; toast.dataset.kind = kind;
      const text = document.createElement("span"); text.textContent = message;
      const close = document.createElement("button"); close.textContent = "×";
      close.setAttribute("aria-label", "Dismiss notification");
      const dismiss = () => {
        if (messages.get(message) !== dismiss) return;
        toast.remove(); messages.delete(message);
        if (!messages.size) { notifications.hidden = true; notificationToggle.focus?.(); }
        updateNotifications();
      };
      messages.set(message, dismiss);
      close.addEventListener("click", dismiss);
      toast.append(close, text); notifications.append(toast);
      updateNotifications();
      return dismiss;
    }
    let currentProblem = "", dismissProblem;
    function setProblem(message) {
      // Polling the same condition must not reopen a message the user dismissed.
      // Clearing/changing the condition starts a new occurrence.
      if (message === currentProblem) return;
      dismissProblem?.();
      currentProblem = message;
      dismissProblem = message ? notify(message, "error") : undefined;
    }
    bar.append(handle, toggle, bookmark, history, notificationToggle); panel.append(notifications, noteEditor, bar); shadow.append(style, panel);
    updateNotifications();
    document.documentElement.append(host); host.hidden = false;
    // Store distances from the nearest edges, independently of viewport clamping.
    // A temporarily smaller window must not overwrite the user's placement.
    let placement = { horizontal: "left", vertical: "bottom", x: 20, y: 24 };
    function applyPlacement() {
      const rect = host.getBoundingClientRect();
      const x = placement.horizontal === "left" ? placement.x : innerWidth - rect.width - placement.x;
      const y = placement.vertical === "top" ? placement.y : innerHeight - rect.height - placement.y;
      const left = Math.max(8, Math.min(x, innerWidth - rect.width - 8));
      const top = Math.max(8, Math.min(y, innerHeight - rect.height - 8));
      host.style.right = "auto"; host.style.bottom = "auto";
      host.style.left = `${left}px`; host.style.top = `${top}px`;
      const above = Math.max(0, top - 8);
      const below = Math.max(0, innerHeight - top - rect.height - 8);
      host.dataset.notificationDirection = below > above ? "below" : "above";
      host.style.setProperty("--notification-space", `${Math.max(above, below)}px`);
    }
    function position(x, y, snap = false) {
      const rect = host.getBoundingClientRect();
      x = Math.max(8, Math.min(x, innerWidth - rect.width - 8));
      y = Math.max(8, Math.min(y, innerHeight - rect.height - 8));
      const right = innerWidth - rect.width - x;
      const bottom = innerHeight - rect.height - y;
      const horizontal = x <= right ? "left" : "right";
      const vertical = y <= bottom ? "top" : "bottom";
      const corner = snap && Math.min(x, right) <= 44 && Math.min(y, bottom) <= 44;
      placement = { horizontal, vertical,
        x: corner ? 20 : Math.min(x, right), y: corner ? 20 : Math.min(y, bottom) };
      applyPlacement();
    }
    let drag;
    handle.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      const rect = host.getBoundingClientRect();
      drag = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      handle.setPointerCapture(e.pointerId); e.preventDefault();
    });
    handle.addEventListener("pointermove", e => { if (drag) position(e.clientX - drag.x, e.clientY - drag.y, true); });
    handle.addEventListener("pointerup", () => { drag = null; });
    handle.addEventListener("lostpointercapture", () => { drag = null; });
    handle.addEventListener("keydown", e => {
      const deltas = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] };
      if (!deltas[e.key]) return;
      e.preventDefault(); const rect = host.getBoundingClientRect(), step = e.shiftKey ? 40 : 10;
      position(rect.left + deltas[e.key][0] * step, rect.top + deltas[e.key][1] * step);
    });
    window.addEventListener("resize", () => {
      if (!host.hidden) applyPlacement();
    });
    return { host, panel, handle, status, notify, toggle, history, setButton, setProblem, notificationToggle, diagnostics, bookmark, noteEditor, noteInput, noteAdd, showNote, showBookmark, resumeNote };
  };
})();
