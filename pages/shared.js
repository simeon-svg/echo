export async function request(type, values = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...values });
  if (!result?.ok) throw new Error(result?.error || "Cannot access local transcripts");
  return result.value;
}
export const time = at => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
export const date = at => new Date(at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
export const minutes = s => Math.max(0, Math.round(((s.endTime || s.updatedAt || Date.now()) - s.startTime) / 60000));
export function plainText(s) {
  return `${s.title}\n${date(s.startTime)}\n${time(s.startTime)}–${time(s.endTime || s.updatedAt)}\nDuration: ${minutes(s)} minutes\nStatus: ${s.status}\n\nParticipants:\n${s.participants.join("\n")}\n\n---\n\n` +
    s.blocks.map(b => `${b.speaker} — ${time(b.timestamp)}\n${b.text}`).join("\n\n") + "\n";
}
export function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
let notifications;
export function notify(message, kind = "success") {
  if (!notifications) {
    notifications = node("div", undefined, "page-notifications");
    notifications.setAttribute("aria-label", "Notifications");
    document.body.append(notifications);
  }
  const toast = node("div", undefined, `page-notification ${kind}`);
  toast.setAttribute("role", kind === "error" ? "alert" : "status");
  const close = node("button", "×", "notification-close");
  close.type = "button"; close.setAttribute("aria-label", "Dismiss notification");
  const timer = setTimeout(() => toast.remove(), 10000);
  close.addEventListener("click", () => { clearTimeout(timer); toast.remove(); });
  toast.append(node("span", message), close);
  notifications.append(toast);
}
const iconPaths = {
  copy: "M16 1H4a2 2 0 0 0-2 2v14h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11z",
  delete: "M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zm2-10h8v10H8zm7-6-1-1h-4L9 3H4v2h16V3z",
  download: "M11 3h2v9l3-3 1.4 1.4L12 16l-5.4-5.6L8 9l3 3zM5 18h14v3H5z",
  edit: "m3 17.3 11-11 3.7 3.7-11 11H3zm13-13 1.7-1.7a1 1 0 0 1 1.4 0L21.4 5a1 1 0 0 1 0 1.4L19.7 8z",
};
export function iconButton(label, name) {
  const button = node("button", undefined, "icon-button");
  button.type = "button"; button.title = label; button.setAttribute("aria-label", label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d", iconPaths[name]);
  svg.append(path); button.append(svg); return button;
}
export const isOpen = s => ["recording", "paused"].includes(s.status);
export const shortDate = at => new Date(at).toLocaleDateString("en-US", {
  month: "short", day: "numeric", ...(new Date(at).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
export function statusDot(status) {
  if (status === "completed") return null;
  const labels = { recording: "Recording", paused: "Paused", processing: "Processing", interrupted: "Interrupted — saved transcript recovered", failed: "Failed" };
  const el = node("span", undefined, `status-dot ${status}`);
  el.title = labels[status] || status; el.setAttribute("aria-label", el.title); el.setAttribute("role", "img");
  return el;
}
export function backupStatusDot(backup, retry) {
  if (!backup) return null;
  const labels = {
    backed: "Backed up",
    pending: "Backup pending",
    "permission-required": "Backup is waiting for folder access. Click to grant folder access and back up all pending conversations",
    failed: `Backup failed${backup.error ? `: ${backup.error}` : ""}. Click to try again`,
  };
  const actionable = ["failed", "permission-required"].includes(backup.status);
  const el = node(actionable ? "button" : "span", undefined, `backup-dot ${backup.status}`);
  if (actionable) el.type = "button";
  const last = backup.backedAt ? ` Last successful backup: ${new Date(backup.backedAt).toLocaleString()}.` : "";
  el.title = `${labels[backup.status] || backup.status}.${last}`;
  el.setAttribute("aria-label", el.title);
  if (actionable) el.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); retry(); });
  else el.setAttribute("role", "img");
  return el;
}
export function confirmAction({ title, message, confirmLabel = "Continue", cancelLabel = "Cancel", danger = false }) {
  return new Promise(resolve => {
    const dialog = node("dialog", undefined, "confirm-dialog");
    const form = node("form"); form.method = "dialog";
    form.append(node("h2", title), node("p", message, "muted dialog-message"));
    const actions = node("div", undefined, "dialog-actions");
    const confirm = node("button", confirmLabel, danger ? "danger primary-danger" : "primary-action"); confirm.type = "button";
    let cancel = null;
    if (cancelLabel) { cancel = node("button", cancelLabel); cancel.type = "button"; actions.append(cancel); }
    actions.append(confirm); form.append(actions); dialog.append(form); document.body.append(dialog);
    const finish = result => { dialog.close(); dialog.remove(); resolve(result); };
    if (cancel) cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
    dialog.showModal();
  });
}
export async function showMessageDialog({ title, message, buttonLabel = "OK" }) {
  await confirmAction({ title, message, confirmLabel: buttonLabel, cancelLabel: null });
}
export function confirmDeletion({ label, count = 1, backupAvailable = false, beforeDeleteBackup }) {
  return new Promise(resolve => {
    const dialog = node("dialog", undefined, "confirm-dialog");
    const form = node("form"); form.method = "dialog";
    form.append(node("h2", count === 1 ? `Delete “${label}”?` : `Delete ${count} conversations?`),
      node("p", count === 1 ? "This permanently removes the conversation and all its recording segments from Echo." : "This permanently removes the selected conversations and all their recording segments from Echo.", "muted"));
    const checkbox = node("input"); checkbox.type = "checkbox";
    if (backupAvailable) {
      const option = node("label", undefined, "delete-backup-option");
      option.append(checkbox, node("span", count === 1 ? "Also delete its backup TXT file" : "Also delete their backup TXT files"));
      form.append(option);
    }
    const errorMessage = node("p", undefined, "dialog-error"); errorMessage.hidden = true; errorMessage.setAttribute("role", "alert");
    form.append(errorMessage);
    const actions = node("div", undefined, "dialog-actions");
    const cancel = node("button", "Cancel"); cancel.type = "button";
    const remove = node("button", "Delete", "danger primary-danger"); remove.type = "button";
    actions.append(cancel, remove); form.append(actions); dialog.append(form); document.body.append(dialog);
    const finish = result => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.addEventListener("click", () => finish({ confirmed: false, deleteBackup: false }));
    remove.addEventListener("click", async () => {
      remove.disabled = true; errorMessage.hidden = true;
      try {
        if (backupAvailable && checkbox.checked && beforeDeleteBackup) await beforeDeleteBackup();
        finish({ confirmed: true, deleteBackup: backupAvailable && checkbox.checked });
      } catch (error) {
        errorMessage.textContent = error.message; errorMessage.hidden = false; remove.disabled = false;
      }
    });
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish({ confirmed: false, deleteBackup: false }); });
    dialog.showModal();
  });
}
export function confirmMerge({ count, backupAvailable = false, beforeDeleteBackups }) {
  return new Promise(resolve => {
    const dialog = node("dialog", undefined, "confirm-dialog");
    const form = node("form"); form.method = "dialog";
    form.append(node("h2", `Merge ${count} conversations?`),
      node("p", "Echo will create a new merged conversation with a new ID. Original backup files are kept unless you choose to delete them. If Chrome asks for access, choose “Allow on every visit”.", "muted"));
    const checkbox = node("input"); checkbox.type = "checkbox";
    if (backupAvailable) {
      const option = node("label", undefined, "delete-backup-option");
      option.append(checkbox, node("span", "Also delete the original backup TXT files"));
      form.append(option);
    }
    const errorMessage = node("p", undefined, "dialog-error"); errorMessage.hidden = true; errorMessage.setAttribute("role", "alert");
    form.append(errorMessage);
    const actions = node("div", undefined, "dialog-actions");
    const cancel = node("button", "Cancel"); cancel.type = "button";
    const merge = node("button", "Merge", "primary-action"); merge.type = "button";
    actions.append(cancel, merge); form.append(actions); dialog.append(form); document.body.append(dialog);
    const finish = result => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.addEventListener("click", () => finish({ confirmed: false, deleteBackups: false }));
    merge.addEventListener("click", async () => {
      merge.disabled = true; errorMessage.hidden = true;
      try {
        if (backupAvailable && checkbox.checked && beforeDeleteBackups) await beforeDeleteBackups();
        finish({ confirmed: true, deleteBackups: backupAvailable && checkbox.checked });
      } catch (error) {
        errorMessage.textContent = error.message; errorMessage.hidden = false; merge.disabled = false;
      }
    });
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish({ confirmed: false, deleteBackups: false }); });
    dialog.showModal();
  });
}
