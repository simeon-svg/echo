import { allSessions, getSession, saveSession, deleteSession } from "../storage/storage.js";
import { callIdOf, groupCalls } from "../storage/calls.js";

// Serialize writes so a late heartbeat cannot undo Stop or a title edit.
let queue = Promise.resolve();
function serial(work) {
  const result = queue.then(work);
  queue = result.catch(error => console.error("Meet Transcript local storage:", error.message));
  return result;
}
const open = s => s.status === "recording" || s.status === "paused";
async function finalize(tabId, reason, status = "completed", token) {
  for (const s of await allSessions()) {
    if (s.tabId !== tabId || !open(s) || (token && s.token !== token)) continue;
    s.status = status;
    s.endTime = reason === "interrupted" ? s.updatedAt : Date.now();
    s.duration = Math.max(0, s.endTime - s.startTime);
    s.reason = reason;
    await saveSession(s);
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const meet = sender.tab && /^https:\/\/meet\.google\.com\//.test(sender.url || "");
  const page = !sender.tab && sender.url?.startsWith(chrome.runtime.getURL("pages/"));
  // Extension pages can also be normal Chrome tabs.
  const ownPage = page || sender.url?.startsWith(chrome.runtime.getURL("pages/"));
  if (!meet && !ownPage) return;
  serial(async () => {
    if (meet) {
      const tabId = sender.tab.id;
      if (message.type === "beginCall") {
        const meetUrl = new URL(sender.url).origin + new URL(sender.url).pathname;
        const recent = (await allSessions()).filter(s => s.meetUrl === meetUrl && s.tabId === tabId)
          .sort((a, b) => b.startTime - a.startTime)[0];
        const continuing = recent && Date.now() - (recent.endTime || recent.updatedAt) < 30 * 60000 &&
          (open(recent) || ["stopped", "navigation"].includes(recent.reason));
        return { callId: continuing ? callIdOf(recent) : crypto.randomUUID(), meetUrl };
      }
      if (message.type === "history") return chrome.tabs.create({ url: chrome.runtime.getURL("pages/transcripts.html") });
      if (message.type === "finish") {
        await finalize(tabId, message.reason || "left", "completed", message.token);
        return true;
      }
      if (!["create", "save"].includes(message.type)) throw new Error("Unknown Meet message");
      const incoming = message.session;
      if (!incoming || typeof incoming.id !== "string" || !Array.isArray(incoming.blocks) ||
          !["recording", "paused", "completed"].includes(incoming.status)) throw new Error("Invalid session");
      const existing = await getSession(incoming.id);
      if (!existing && message.type !== "create") throw new Error("Transcript no longer exists. Start a new transcript.");
      if (existing && (existing.tabId !== tabId || existing.token !== incoming.token)) throw new Error("Session mismatch");
      if (existing && !open(existing)) {
        if (incoming.status === "completed") return true;
        throw new Error("This session was finalized after interruption. Stop and start a new transcript.");
      }
      // Preserve an edited title and prevent deleted sessions from reappearing.
      const s = { ...incoming, tabId, updatedAt: Date.now() };
      if (existing?.callId) s.callId = existing.callId;
      const renamed = existing?.renamed ? existing : (await allSessions()).find(item => callIdOf(item) === callIdOf(s) && item.renamed);
      if (renamed) { s.title = renamed.title; s.renamed = true; }
      await saveSession(s);
      return true;
    }
    const sessions = await allSessions();
    const calls = groupCalls(sessions);
    if (message.type === "list") return calls;
    if (message.type === "deleteMany") {
      const selected = calls.filter(call => message.ids?.includes(call.id));
      if (!selected.length) throw new Error("No calls selected");
      if (selected.some(open)) throw new Error("Stop recording before deleting selected calls");
      for (const call of selected) for (const id of call.segmentIds) await deleteSession(id);
      return true;
    }
    if (message.type === "merge") {
      const selected = calls.filter(call => message.ids?.includes(call.id));
      if (selected.length < 2) throw new Error("Select at least two calls to merge");
      if (selected.some(open)) throw new Error("Stop recording before merging calls");
      const target = selected.reduce((a, b) => a.startTime < b.startTime ? a : b);
      const ids = new Set(selected.flatMap(call => call.segmentIds));
      for (const s of sessions.filter(s => ids.has(s.id))) {
        s.callId = target.id; s.title = target.title; s.renamed = true; await saveSession(s);
      }
      return target.id;
    }
    const call = calls.find(s => s.id === message.id || s.segmentIds.includes(message.id));
    if (message.type === "get") return call || null;
    if (!call) throw new Error("Transcript no longer exists");
    const members = sessions.filter(s => call.segmentIds.includes(s.id));
    if (message.type === "rename") {
      for (const s of members) {
        s.title = String(message.title).trim().slice(0, 300) || s.title;
        s.renamed = true; await saveSession(s);
      }
      return groupCalls(members)[0];
    }
    if (message.type === "delete") {
      if (open(call)) throw new Error("Stop this transcript before deleting it");
      for (const s of members) await deleteSession(s.id);
      return true;
    }
    throw new Error("Unknown message");
  }).then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("pages/transcripts.html") }));
chrome.tabs.onRemoved.addListener(tabId => serial(() => finalize(tabId, "tab closed")));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") serial(() => finalize(tabId, "navigation"));
  else if (change.discarded) serial(() => finalize(tabId, "interrupted", "interrupted"));
});
chrome.runtime.onStartup.addListener(() => serial(async () => {
  for (const s of await allSessions()) if (open(s)) await finalize(s.tabId, "interrupted", "interrupted");
}));
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("recover", { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== "recover") return;
  serial(async () => {
    for (const s of await allSessions()) {
      if (!open(s) || Date.now() - s.updatedAt < 120000) continue;
      // Missing heartbeat includes crashed/disabled/reloaded extension contexts.
      // Preserve the last durable snapshot, with an explicitly uncertain end time.
      await finalize(s.tabId, "interrupted", "interrupted", s.token);
    }
  });
});
