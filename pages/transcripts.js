import { exportText } from "./transcript-export.js";
import { initPageShell } from "./page-shell.js";
import { backupStatusDot, confirmDeletion, confirmMerge, request, minutes, node, shortDate, time, plainText, iconButton, isOpen, statusDot, notify } from "./shared.js";
import { prepareBackupAccess, requestBackupAccess } from "./backup-access.js";
import { reviewMerge } from "./merge-review.js";
import { relatedRecordings, possibleRecordings } from "../storage/calls.js";
const $ = selector => document.querySelector(selector);
const list = $("#list"), search = $("#search"), message = $("#message");
const PAGE_SIZE = 20;
let currentPage = 1;
let sessions = [];
let fingerprint = "";
const selected = new Set();
const mergingMeetings = new Set();
const notificationCenter = initPageShell({ merge: mergeRelationship });
function matchingCalls() {
  const needle = search.value.trim().toLocaleLowerCase();
  return !needle ? sessions : sessions.filter(s => [s.title, ...s.participants, ...s.blocks.map(b => b.text), ...(s.bookmarks || []).map(n => n.text)].join(" ").toLocaleLowerCase().includes(needle));
}
function selection() {
  const matches = matchingCalls();
  const selectAll = $("#select-all-calls");
  selectAll.checked = matches.length > 0 && matches.every(call => selected.has(call.id));
  selectAll.indeterminate = selected.size > 0 && !selectAll.checked;
  selectAll.disabled = !matches.length && !selected.size;
  selectAll.setAttribute("aria-label", selected.size ? "Clear all selected calls" : "Select all matching calls");
  selectAll.title = selected.size ? "Clear all selected calls" : "Select all matching calls across pages";
  $("#bulk").classList.toggle("bulk-idle", !selected.size);
  $("#clear-selection").disabled = !selected.size;
  $("#selection-count").textContent = `${selected.size} selected`;
  const active = sessions.some(s => selected.has(s.id) && isOpen(s));
  $("#merge").disabled = selected.size < 2 || active;
  $("#bulk-delete").disabled = !selected.size || active;
  $("#merge").title = active ? "Stop recording first" : selected.size < 2 ? "Select at least two calls" : "Combine selected calls";
  $("#bulk-delete").title = active ? "Stop recording first" : "Delete selected calls";
  list.classList.toggle("selection-active", !!selected.size);
  list.querySelectorAll(".call-row").forEach(row => {
    const checked = selected.has(row.dataset.id);
    row.classList.toggle("selected", checked);
    row.querySelectorAll("input")[0].checked = checked;
  });
}
async function run(work) { try { await work(); } catch (e) { message.textContent = ""; notify(e.message, "error"); } }
function renderPagination(total) {
  const pagination = $("#pagination");
  pagination.replaceChildren();
  pagination.hidden = total <= 1;
  if (total <= 1) return;
  const addButton = (label, page, accessibleLabel, disabled = false) => {
    const button = node("button", label);
    button.type = "button";
    button.disabled = disabled;
    button.setAttribute("aria-label", accessibleLabel);
    if (page === currentPage && label !== "←" && label !== "→") button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => {
      currentPage = page; render();
      // Keep keyboard navigation in the pager after its buttons are rebuilt.
      const replacement = Array.from(pagination.children).find(child => child.getAttribute("aria-label") === accessibleLabel);
      const active = Array.from(pagination.children).find(child => child.getAttribute("aria-current") === "page");
      (replacement?.disabled ? active : replacement)?.focus();
    });
    pagination.append(button);
  };
  addButton("←", currentPage - 1, "Previous page", currentPage === 1);
  const pages = new Set([1, total]);
  // A bounded window keeps the controls compact even for large histories.
  const start = Math.max(1, Math.min(currentPage - 1, total - 2));
  for (let page = start; page <= Math.min(total, start + 2); page++) pages.add(page);
  let previous = 0;
  for (const page of [...pages].sort((a, b) => a - b)) {
    if (previous && page > previous + 1) {
      const gap = node("span", "…", "pagination-gap");
      gap.setAttribute("aria-hidden", "true"); pagination.append(gap);
    }
    addButton(String(page), page, `Page ${page}`);
    previous = page;
  }
  addButton("→", currentPage + 1, "Next page", currentPage === total);
}
function render() {
  const matches = matchingCalls();
  const totalPages = Math.ceil(matches.length / PAGE_SIZE);
  currentPage = Math.max(1, Math.min(currentPage, totalPages));
  const visible = matches.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  list.replaceChildren();
  for (const id of selected) if (!sessions.some(s => s.id === id)) selected.delete(id);
  message.textContent = matches.length ? "" : sessions.length ? "No matching calls." : "No calls yet. Join a Google Meet call to begin.";
  message.classList.toggle("empty-state", !matches.length);
  const relationships = new Map();
  for (const [key, calls] of relatedRecordings(sessions)) {
    for (const call of calls) relationships.set(call.id, { key, calls, certain: true });
  }
  for (const [key, calls] of possibleRecordings(sessions)) {
    for (const call of calls) relationships.set(call.id, { key, calls, certain: false });
  }
  notificationCenter.updateRelationships([...new Map([...relationships.values()].map(item => [`${item.certain}:${item.key}`, { ...item, busy: mergingMeetings.has(item.key) }])).values()]);
  const shownActions = new Set();
  for (const s of visible) {
    const relationship = relationships.get(s.id);
    const row = node("div", undefined, "call-row"); row.dataset.id = s.id;
    const check = node("input"); check.type = "checkbox"; check.checked = selected.has(s.id);
    check.setAttribute("aria-label", `Select ${s.title}`);
    check.addEventListener("change", () => { check.checked ? selected.add(s.id) : selected.delete(s.id); selection(); });
    const checkArea = node("label", undefined, "call-selection"); checkArea.append(check);
    const link = node("a", undefined, "call-link"); link.href = `transcript.html?id=${encodeURIComponent(s.id)}`; link.title = s.title;
    const title = node("div", undefined, "call-title"); title.append(node("h2", s.title));
    if (s.bookmarks?.length) {
      const notes = s.bookmarks.filter(n => n.text.trim()).length;
      const badge = node("span", undefined, "bookmark-count");
      badge.append(iconButton("Bookmarks", "bookmark").children[0], node("span", `${s.bookmarks.length}${notes ? ` · ${notes} note${notes === 1 ? "" : "s"}` : ""}`));
      badge.title = `${s.bookmarks.length} bookmarks · ${notes} personal author notes`; badge.setAttribute("aria-label", badge.title);
      title.append(badge);
    }
    const dot = statusDot(s.status); if (dot) title.append(dot);
    const count = s.participants.length;
    const meta = node("p", `${shortDate(s.startTime)} · ${time(s.startTime)} · ${minutes(s)} min · ${count} participant${count === 1 ? "" : "s"}`, "muted call-meta");
    meta.title = s.participants.join(", "); link.append(title, meta);
    const content = node("div", undefined, "call-content"); content.append(link);
    if (relationship) {
      row.classList.add("related-row");
      if (!relationship.certain) row.classList.add("possible-row");
      const hint = node("div", undefined, "call-relationship");
      hint.append(node("span", `${relationship.certain ? "Same call" : "Possible same call"} · ${relationship.calls.length} recordings`));
      if (!shownActions.has(relationship.key)) {
        shownActions.add(relationship.key);
        const button = node("button", relationship.certain ? "Merge" : "Review", "related-merge");
        button.type = "button";
        button.disabled = relationship.calls.some(isOpen) || mergingMeetings.has(relationship.key);
        button.title = relationship.calls.some(isOpen) ? "Stop recording first"
          : relationship.certain ? "Merge all recordings from this call. Original backup files are kept."
          : "Review suggested recordings before choosing which to merge.";
        button.addEventListener("click", () => mergeRelationship(relationship));
        hint.append(button);
      }
      content.append(hint);
    }
    const actions = [
      { label: "Copy Transcript", icon: "copy", run: () => run(async () => { await navigator.clipboard.writeText(await exportText(plainText(s))); notify(`Transcript copied: ${s.title}`); }) },
      { label: "Download TXT", icon: "download", run: () => run(async () => {
        const url = URL.createObjectURL(new Blob([await exportText(plainText(s))], { type: "text/plain;charset=utf-8" }));
        const a = node("a"); a.href = url; a.download = `${s.title.replace(/[^a-z0-9\-_ ]/gi, "_")}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
        notify(`TXT download started: ${s.title}`);
      }) },
      { label: "Delete Call", icon: "delete", danger: true, disabled: isOpen(s), run: () => run(async () => {
        if (s.hasBackup) await prepareBackupAccess();
        const decision = await confirmDeletion({ label: s.title, backupAvailable: !!s.hasBackup, beforeDeleteBackup: requestBackupAccess });
        if (decision.confirmed) {
          const result = await request("delete", { id: s.id, deleteBackup: decision.deleteBackup });
          if (result.backupWarning) notify(`The conversation was deleted, but its backup remains: ${result.backupWarning}`, "error");
          else notify(`Conversation deleted: ${s.title}`);
          selected.delete(s.id); await refresh();
        }
      }) },
    ];
    const menu = node("div", undefined, "call-actions");
    for (const action of actions) {
      const button = iconButton(action.label, action.icon);
      button.disabled = !!action.disabled;
      if (action.danger) button.classList.add("danger");
      button.addEventListener("click", action.run); menu.append(button);
    }
    const backupDot = backupStatusDot(s.backup, () => run(async () => {
      if (s.backup.status === "permission-required") {
        await requestBackupAccess();
        const result = await request("backupAll");
        if (result.failed) notify(`${result.failed} conversation${result.failed === 1 ? "" : "s"} could not be backed up.`, "error");
        else if (result.waiting) notify(`${result.waiting} conversation${result.waiting === 1 ? " is" : "s are"} still waiting for folder access.`);
        else notify(result.backed ? `${result.backed} pending conversation${result.backed === 1 ? "" : "s"} backed up.` : "All conversations are backed up.");
      } else {
        const result = await request("backupOne", { id: s.id });
        if (result.status === "permission-required") notify("The conversation is waiting for folder access.");
        else notify("Conversation backed up.");
      }
      await refresh();
    }));
    row.append(checkArea, content, ...(backupDot ? [backupDot] : []), menu);
    row.addEventListener("click", event => {
      if (!event.target.closest("input, button, details, a, label")) location.href = link.href;
    });
    list.append(row);
  }
  selection();
  renderPagination(totalPages);
}
async function mergeRelationship({ key, calls, certain }, chosenIds) {
  if (mergingMeetings.has(key) || calls.some(isOpen)) return;
  mergingMeetings.add(key); render();
  try {
    await run(async () => {
      const ids = chosenIds || (certain ? calls.map(call => call.id) : await reviewMerge(calls));
      if (ids && (ids.length < 2 || ids.some(id => !calls.some(call => call.id === id)))) throw new Error("Select at least two recordings from this suggestion.");
      if (!ids) return;
      const relationship = certain ? { relatedMeetingId: key } : { possibleGroupKey: key };
      const result = await request("merge", { ids, ...relationship, deleteBackups: false });
      if (result.backupWarning) notify(result.backupWarning, "error");
      else notify(`${ids.length} recordings merged.`);
      for (const id of ids) selected.delete(id);
      await refresh();
    });
  } finally { mergingMeetings.delete(key); render(); }
}
async function refresh() {
  await run(async () => {
    const fresh = await request("list");
    if (fresh.some(call => call.backup?.status === "permission-required")) await prepareBackupAccess();
    const next = JSON.stringify(fresh);
    if (next === fingerprint) return;
    fingerprint = next; sessions = fresh; render();
  });
}
$("#merge").addEventListener("click", () => run(async () => {
  const chosen = sessions.filter(call => selected.has(call.id));
  const ids = chosen.map(call => call.id);
  const backupAvailable = chosen.some(call => !!call.hasBackup);
  if (backupAvailable) await prepareBackupAccess();
  const decision = await confirmMerge({ count: chosen.length, backupAvailable, beforeDeleteBackups: requestBackupAccess });
  if (decision.confirmed) {
    const result = await request("merge", { ids, deleteBackups: decision.deleteBackups });
    if (result.backupWarning) notify(`The conversations were merged, but some original backups remain:\n${result.backupWarning}`, "error");
    else notify(`${ids.length} recordings merged.`);
    selected.clear(); await refresh();
  }
}));
$("#bulk-delete").addEventListener("click", () => run(async () => {
  const chosen = sessions.filter(call => selected.has(call.id));
  const ids = chosen.map(call => call.id);
  const backupAvailable = chosen.some(call => !!call.hasBackup);
  if (backupAvailable) await prepareBackupAccess();
  const decision = await confirmDeletion({ label: "", count: ids.length, backupAvailable, beforeDeleteBackup: requestBackupAccess });
  if (decision.confirmed) {
    const result = await request("deleteMany", { ids, deleteBackup: decision.deleteBackup });
    if (result.backupWarning) notify(`The conversations were deleted, but some backups remain:\n${result.backupWarning}`, "error");
    else notify(`${ids.length} conversations deleted.`);
    selected.clear(); await refresh();
  }
}));
$("#select-all-calls").addEventListener("change", () => {
  if (selected.size) selected.clear();
  else for (const call of matchingCalls()) selected.add(call.id);
  selection();
});
$("#clear-selection").addEventListener("click", () => { selected.clear(); render(); });
search.addEventListener("input", () => { currentPage = 1; render(); });
window.addEventListener("focus", refresh);
refresh();
setInterval(() => {
  if (!document.hidden && !list.contains(document.activeElement)) refresh();
}, 5000);
