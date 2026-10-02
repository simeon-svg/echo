import { node, shortDate, time, minutes, isOpen } from "./shared.js";

// Transcript contents never enter the notification feed. Activity survives page navigation in this tab.
export function createNotificationCenter({ merge, storage = typeof sessionStorage === "undefined" ? null : sessionStorage }) {
  const button = document.querySelector("#notifications-toggle");
  const panel = document.querySelector("#notifications-panel");
  const feed = document.querySelector("#notifications-feed");
  const badge = document.querySelector("#notifications-badge");
  const live = document.querySelector("#notifications-status");
  let saved = {};
  try { saved = JSON.parse(storage?.getItem("echo-notifications") || "{}") || {}; } catch {}
  const history = (Array.isArray(saved.history) ? saved.history : []).filter(entry => entry && typeof entry.id === "string"
    && typeof entry.message === "string" && Number.isFinite(entry.at) && ["success", "error", "info"].includes(entry.kind)).slice(0, 100);
  const suggestions = new Map();
  const unread = new Set((Array.isArray(saved.unread) ? saved.unread : []).filter(id => typeof id === "string"));
  const knownSignatures = new Map((Array.isArray(saved.signatures) ? saved.signatures : []).filter(item => Array.isArray(item) && item.length === 2 && item.every(value => typeof value === "string")));
  let sequence = Number.isSafeInteger(saved.sequence) && saved.sequence >= 0 ? saved.sequence : 0;
  const persist = () => {
    try { storage?.setItem("echo-notifications", JSON.stringify({ history, unread: [...unread], signatures: [...knownSignatures], sequence })); } catch {}
  };
  let relationshipFingerprint = "";
  const updateBadge = () => {
    badge.hidden = !unread.size;
    badge.textContent = String(unread.size);
    button.setAttribute("aria-label", unread.size ? `Notifications (${unread.size} unread)` : "Notifications");
  };
  const close = (restoreFocus = false) => {
    panel.hidden = true; button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  };
  button.addEventListener("click", () => {
    if (!panel.hidden) { close(); return; }
    panel.hidden = false; button.setAttribute("aria-expanded", "true");
    unread.clear(); updateBadge(); persist();
    document.querySelector("#notifications-close").focus();
  });
  document.querySelector("#notifications-close").addEventListener("click", () => close(true));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) { event.preventDefault(); close(true); }
  });
  document.addEventListener("click", event => {
    const path = event.composedPath();
    if (!panel.hidden && !path.includes(panel) && !path.includes(button)
      && !event.target.closest("dialog")) close();
  });
  document.querySelector("#notifications-clear").addEventListener("click", () => {
    for (const entry of history) unread.delete(entry.id);
    history.length = 0; render(); persist();
  });
  function render() {
    feed.replaceChildren();
    document.querySelector("#notifications-clear").disabled = !history.length;
    for (const suggestion of suggestions.values()) {
      const { relationship, choices } = suggestion;
      const { calls, certain } = relationship;
      const details = node("details", undefined, "notification-suggestion");
      details.open = suggestion.open;
      details.addEventListener("toggle", () => { suggestion.open = details.open; });
      const summary = node("summary", `${calls.length} recordings ${certain ? "from the same call" : "may belong to the same call"}`);
      const body = node("div", undefined, "notification-suggestion-body");
      body.append(node("p", certain ? "These recordings belong to one conversation." : "Matching Meet links, times and participants suggest one conversation. Choose which recordings to merge.", "muted"));
      const action = node("button", "Merge selected", "primary-action notification-merge");
      action.type = "button";
      const update = () => {
        action.disabled = choices.size < 2 || calls.some(isOpen) || suggestion.busy || relationship.busy;
        action.textContent = suggestion.busy || relationship.busy ? "Merging…" : `${certain ? "Merge recordings" : "Merge selected"} (${choices.size})`;
        action.title = calls.some(isOpen) ? "Stop recording first" : "Merge selected recordings; original backup files are kept";
      };
      for (const call of [...calls].sort((a, b) => a.startTime - b.startTime)) {
        const option = node("label", undefined, "merge-review-item");
        const check = node("input"); check.type = "checkbox"; check.checked = choices.has(call.id);
        check.disabled = certain || suggestion.busy || relationship.busy || calls.some(isOpen);
        check.setAttribute("aria-label", `Include ${call.title}`);
        check.addEventListener("change", () => { check.checked ? choices.add(call.id) : choices.delete(call.id); update(); });
        const description = node("span");
        const link = node("a", call.title); link.href = `transcript.html?id=${encodeURIComponent(call.id)}`;
        description.append(link, node("span", `${shortDate(call.startTime)} · ${time(call.startTime)}–${time(call.endTime || call.updatedAt)} · ${minutes(call)} min`, "muted"));
        if (call.participants.length) description.append(node("span", call.participants.join(", "), "muted"));
        option.append(check, description); body.append(option);
      }
      body.append(node("p", "Original backup files are kept.", "muted"));
      if (calls.some(isOpen)) body.append(node("p", "Stop recording before merging these recordings.", "muted"));
      action.addEventListener("click", async () => {
        if (action.disabled) return;
        suggestion.busy = true; update();
        body.querySelectorAll("input").forEach(input => { input.disabled = true; });
        try { await merge(relationship, [...choices]); }
        finally { suggestion.busy = false; render(); }
      });
      update(); body.append(action); details.append(summary, body); feed.append(details);
    }
    for (const entry of history) {
      const card = node("article", undefined, `notification-entry ${entry.kind}`);
      card.append(node("p", entry.message), node("time", time(entry.at), "muted"));
      feed.append(card);
    }
    if (!suggestions.size && !history.length) feed.append(node("p", "No notifications yet.", "notification-empty muted"));
    updateBadge();
  }
  render();
  return {
    notify(message, kind = "success") {
      const entry = { id: `action-${++sequence}`, message, kind, at: Date.now() };
      history.unshift(entry);
      if (panel.hidden) unread.add(entry.id);
      if (history.length > 100) unread.delete(history.pop().id);
      live.textContent = message;
      render(); persist();
    },
    updateRelationships(relationships) {
      const fingerprint = JSON.stringify(relationships.map(({ key, certain, busy, calls }) => [key, certain, busy,
        calls.map(({ id, title, startTime, endTime, updatedAt, participants, status }) => ({ id, title, startTime, endTime, updatedAt, participants, status }))]));
      if (fingerprint === relationshipFingerprint) return;
      relationshipFingerprint = fingerprint;
      const retained = new Set();
      for (const relationship of relationships) {
        const id = `${relationship.certain ? "certain" : "possible"}:${relationship.key}`;
        retained.add(id);
        const signature = relationship.calls.map(call => call.id).sort().join("\n");
        const previous = suggestions.get(id);
        if (!previous || previous.signature !== signature) {
          suggestions.set(id, { relationship, signature, choices: new Set(relationship.calls.map(call => call.id)), open: previous?.open || false, busy: false });
          if (panel.hidden && knownSignatures.get(id) !== signature) unread.add(id);
        } else previous.relationship = relationship;
        knownSignatures.set(id, signature);
      }
      for (const id of suggestions.keys()) if (!retained.has(id)) { suggestions.delete(id); unread.delete(id); }
      for (const id of knownSignatures.keys()) if (!retained.has(id)) knownSignatures.delete(id);
      for (const id of unread) if ((id.startsWith("certain:") || id.startsWith("possible:")) && !retained.has(id)) unread.delete(id);
      render(); persist();
    },
  };
}
