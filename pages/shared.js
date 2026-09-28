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
  more: "M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  copy: "M16 1H4a2 2 0 0 0-2 2v14h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11z",
  delete: "M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zm2-10h8v10H8zm7-6-1-1h-4L9 3H4v2h16V3z",
  download: "M11 3h2v9l3-3 1.4 1.4L12 16l-5.4-5.6L8 9l3 3zM5 18h14v3H5z",
  edit: "m3 17.3 11-11 3.7 3.7-11 11H3zm13-13 1.7-1.7a1 1 0 0 1 1.4 0L21.4 5a1 1 0 0 1 0 1.4L19.7 8z",
  check: "m9 16.2-4.2-4.2L3.4 13.4 9 19l12-12-1.4-1.4z",
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
export function actionMenu(label, actions) {
  const details = node("details", undefined, "action-menu");
  const summary = node("summary", undefined, "icon-button");
  summary.setAttribute("aria-label", label); summary.title = label;
  summary.append(iconButton(label, "more").firstChild);
  const popover = node("div", undefined, "menu-popover");
  for (const action of actions) {
    const button = iconButton(action.label, action.icon);
    button.className = `menu-item${action.danger ? " danger" : ""}`;
    button.append(node("span", action.label)); button.disabled = !!action.disabled;
    if (action.disabled) button.title = "Stop recording first";
    button.addEventListener("click", () => { details.open = false; action.run(); });
    popover.append(button);
  }
  details.append(summary, popover);
  details.addEventListener("toggle", () => {
    if (details.open) document.querySelectorAll("details.action-menu[open]").forEach(other => { if (other !== details) other.open = false; });
  });
  return details;
}
document.addEventListener("pointerdown", event => {
  document.querySelectorAll("details.action-menu[open]").forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") document.querySelectorAll("details.action-menu[open]").forEach(menu => { menu.open = false; menu.querySelector("summary").focus(); });
});
