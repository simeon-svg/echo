import { backupStatusDot, confirmDeletion, confirmMerge, request, minutes, node, shortDate, time, plainText, iconButton, isOpen, statusDot, notify } from "./shared.js";
import { prepareBackupAccess, requestBackupAccess } from "./backup-access.js";
const $ = selector => document.querySelector(selector);
const list = $("#list"), search = $("#search"), message = $("#message");
let sessions = [];
let fingerprint = "";
const selected = new Set();
function selection() {
  $("#bulk").hidden = !selected.size;
  $("#selection-count").textContent = `${selected.size} selected`;
  const active = sessions.some(s => selected.has(s.id) && isOpen(s));
  $("#merge").disabled = selected.size < 2 || active;
  $("#bulk-delete").disabled = active;
  $("#merge").title = active ? "Stop recording first" : selected.size < 2 ? "Select at least two calls" : "Combine selected calls";
  $("#bulk-delete").title = active ? "Stop recording first" : "Delete selected calls";
  list.classList.toggle("selection-active", !!selected.size);
  list.querySelectorAll(".call-row").forEach(row => row.classList.toggle("selected", selected.has(row.dataset.id)));
}
async function run(work) { try { await work(); } catch (e) { message.textContent = ""; notify(e.message, "error"); } }
function render() {
  const needle = search.value.trim().toLocaleLowerCase();
  const matches = sessions.filter(s => [s.title, ...s.participants, ...s.blocks.map(b => b.text)].join(" ").toLocaleLowerCase().includes(needle));
  list.replaceChildren();
  for (const id of selected) if (!sessions.some(s => s.id === id)) selected.delete(id);
  message.textContent = matches.length ? "" : sessions.length ? "No matching calls." : "No calls yet. Join a Google Meet call to begin.";
  for (const s of matches) {
    const row = node("div", undefined, "call-row"); row.dataset.id = s.id;
    const check = node("input"); check.type = "checkbox"; check.checked = selected.has(s.id);
    check.setAttribute("aria-label", `Select ${s.title}`);
    check.addEventListener("change", () => { check.checked ? selected.add(s.id) : selected.delete(s.id); selection(); });
    const checkArea = node("label", undefined, "call-selection"); checkArea.append(check);
    const link = node("a", undefined, "call-link"); link.href = `transcript.html?id=${encodeURIComponent(s.id)}`;
    const title = node("div", undefined, "call-title"); title.append(node("h2", s.title));
    const dot = statusDot(s.status); if (dot) title.append(dot);
    const count = s.participants.length;
    const meta = node("p", `${shortDate(s.startTime)} · ${time(s.startTime)} · ${minutes(s)} min · ${count} participant${count === 1 ? "" : "s"}`, "muted");
    meta.title = s.participants.join(", "); link.append(title, meta);
    const actions = [
      { label: "Copy Transcript", icon: "copy", run: () => run(async () => { await navigator.clipboard.writeText(plainText(s)); notify("Transcript copied."); }) },
      { label: "Download TXT", icon: "download", run: () => {
        const url = URL.createObjectURL(new Blob([plainText(s)], { type: "text/plain;charset=utf-8" }));
        const a = node("a"); a.href = url; a.download = `${s.title.replace(/[^a-z0-9\-_ ]/gi, "_")}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      } },
      { label: "Delete Call", icon: "delete", danger: true, disabled: isOpen(s), run: async () => {
        if (s.hasBackup) await prepareBackupAccess();
        const decision = await confirmDeletion({ label: s.title, backupAvailable: !!s.hasBackup, beforeDeleteBackup: requestBackupAccess });
        if (decision.confirmed) run(async () => {
          const result = await request("delete", { id: s.id, deleteBackup: decision.deleteBackup });
          if (result.backupWarning) notify(`The conversation was deleted, but its backup remains: ${result.backupWarning}`, "error");
          selected.delete(s.id); await refresh();
        });
      } },
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
    row.append(checkArea, link, ...(backupDot ? [backupDot] : []), menu);
    row.addEventListener("click", event => {
      if (!event.target.closest("input, button, details, a, label")) location.href = link.href;
    });
    list.append(row);
  }
  selection();
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
$("#merge").addEventListener("click", async () => {
  const chosen = sessions.filter(call => selected.has(call.id));
  const backupAvailable = chosen.some(call => !!call.hasBackup);
  if (backupAvailable) await prepareBackupAccess();
  const decision = await confirmMerge({ count: chosen.length, backupAvailable, beforeDeleteBackups: requestBackupAccess });
  if (decision.confirmed) run(async () => {
    const result = await request("merge", { ids: [...selected], deleteBackups: decision.deleteBackups });
    if (result.backupWarning) notify(`The conversations were merged, but some original backups remain:\n${result.backupWarning}`, "error");
    selected.clear(); await refresh();
  });
});
$("#bulk-delete").addEventListener("click", async () => {
  const chosen = sessions.filter(call => selected.has(call.id));
  const backupAvailable = chosen.some(call => !!call.hasBackup);
  if (backupAvailable) await prepareBackupAccess();
  const decision = await confirmDeletion({ label: "", count: selected.size, backupAvailable, beforeDeleteBackup: requestBackupAccess });
  if (decision.confirmed) run(async () => {
    const result = await request("deleteMany", { ids: [...selected], deleteBackup: decision.deleteBackup });
    if (result.backupWarning) notify(`The conversations were deleted, but some backups remain:\n${result.backupWarning}`, "error");
    selected.clear(); await refresh();
  });
});
$("#clear-selection").addEventListener("click", () => { selected.clear(); render(); });
search.addEventListener("input", render);
window.addEventListener("focus", () => { if (!list.querySelector("details[open]")) refresh(); });
refresh();
setInterval(() => {
  if (!document.hidden && !list.contains(document.activeElement) && !list.querySelector("details[open]")) refresh();
}, 5000);
