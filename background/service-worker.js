import { allSessions, getSession, saveSession, saveSessions, deleteSessions, openSessions, sessionsForCall, sessionsForTab } from "../storage/storage.js";
import { callIdOf, groupCalls } from "../storage/calls.js";
import {
  backupFolderStatus,
  forgetCallBackup,
  refreshBackupAlert,
  removeCallBackup,
  syncCalls,
  syncOne,
  withBackupStatus,
} from "../storage/backup.js";

// Serialize writes so a late heartbeat cannot undo Stop or a title edit.
let queue = Promise.resolve();
function serial(work) {
  const result = queue.then(work);
  queue = result.catch(error => console.error("Meet Transcript local storage:", error.message));
  return result;
}
const open = s => s.status === "recording" || s.status === "paused";
function validSession(s) {
  return s && typeof s.id === "string" && s.id.length > 0 &&
    typeof s.token === "string" && s.token.length > 0 && typeof s.title === "string" &&
    Number.isFinite(s.startTime) && (s.endTime == null || Number.isFinite(s.endTime)) &&
    Array.isArray(s.participants) && s.participants.every(name => typeof name === "string") &&
    Array.isArray(s.blocks) && s.blocks.every(block => block && typeof block.speaker === "string" &&
      typeof block.text === "string" && Number.isFinite(block.timestamp)) &&
    ["recording", "paused", "completed"].includes(s.status) &&
    (s.callId == null || (typeof s.callId === "string" && s.callId.length > 0));
}
function selectedCalls(calls, ids) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new Error("Invalid call selection");
  const wanted = new Set(ids);
  const selected = calls.filter(call => wanted.has(call.id));
  if (selected.length !== wanted.size) throw new Error("Some selected conversations no longer exist. Refresh and try again.");
  return selected;
}
async function callMembers(id) {
  const session = await getSession(id);
  return sessionsForCall(session ? callIdOf(session) : id);
}
async function finalize(tabId, reason, status = "completed", token) {
  const affected = new Set();
  const changed = [];
  for (const s of await sessionsForTab(tabId)) {
    if (s.tabId !== tabId || !open(s) || (token && s.token !== token)) continue;
    s.status = status;
    s.endTime = reason === "interrupted" ? s.updatedAt : Date.now();
    s.duration = Math.max(0, s.endTime - s.startTime);
    s.reason = reason;
    changed.push(s);
    affected.add(callIdOf(s));
  }
  if (affected.size) {
    await saveSessions(changed);
    const members = (await Promise.all([...affected].map(sessionsForCall))).flat();
    const calls = groupCalls(members);
    await syncCalls(calls);
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const meet = sender.tab && /^https:\/\/meet\.google\.com\//.test(sender.url || "");
  // Extension pages can also be normal Chrome tabs.
  const ownPage = sender.url?.startsWith(chrome.runtime.getURL("pages/"));
  if (!meet && !ownPage) return;
  serial(async () => {
    if (meet) {
      const tabId = sender.tab.id;
      if (message.type === "beginCall") {
        const meetUrl = new URL(sender.url).origin + new URL(sender.url).pathname;
        const recent = (await sessionsForTab(tabId)).filter(s => s.meetUrl === meetUrl)
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
      if (!validSession(incoming)) throw new Error("Invalid session");
      const existing = await getSession(incoming.id);
      if (!existing && message.type !== "create") throw new Error("Transcript no longer exists. Start a new transcript.");
      if (existing && (existing.tabId !== tabId || existing.token !== incoming.token)) throw new Error("Session mismatch");
      if (existing && !open(existing)) {
        if (incoming.status === "completed") return true;
        throw new Error("This session was finalized after interruption. Stop and start a new transcript.");
      }
      // Preserve an edited title and prevent deleted sessions from reappearing.
      const s = { ...incoming, callId: incoming.callId || incoming.id, tabId, updatedAt: Date.now(),
        meetUrl: new URL(sender.url).origin + new URL(sender.url).pathname };
      if (existing?.callId) s.callId = existing.callId;
      const renamed = existing?.renamed ? existing : (await sessionsForCall(callIdOf(s))).find(item => item.renamed);
      if (renamed) { s.title = renamed.title; s.renamed = true; }
      await saveSession(s);
      if (s.status === "completed") {
        const call = groupCalls(await sessionsForCall(callIdOf(s)))[0];
        if (call) await syncCalls([call]);
      }
      return true;
    }
    if (message.type === "backupFolderStatus") return backupFolderStatus();
    const singleCall = ["get", "rename", "delete", "backupOne"].includes(message.type);
    const sessions = singleCall ? await callMembers(message.id) : await allSessions();
    const calls = groupCalls(sessions);
    if (message.type === "list") return withBackupStatus(calls);
    if (message.type === "backupEnable") {
      await chrome.storage.local.set({ backupEnabled: !!message.enabled });
      if (!message.enabled) {
        await refreshBackupAlert(false);
        return { backed: 0, failed: 0 };
      }
      return message.backfill ? syncCalls(calls, { force: true }) : syncCalls([], { force: false });
    }
    if (message.type === "backupAll") return syncCalls(calls, { force: true });
    if (message.type === "backupOne") {
      const selected = calls.find(call => call.id === message.id);
      if (!selected) throw new Error("Transcript no longer exists");
      return syncOne(selected);
    }
    if (message.type === "deleteMany") {
      const selected = selectedCalls(calls, message.ids);
      if (!selected.length) throw new Error("No calls selected");
      if (selected.some(open)) throw new Error("Stop recording before deleting selected calls");
      const warnings = [];
      for (const call of selected) {
        if (message.deleteBackup) {
          const warning = await removeCallBackup(call);
          if (warning) warnings.push(`${call.title}: ${warning}`);
        } else await forgetCallBackup(call.id);
      }
      await deleteSessions(selected.flatMap(call => call.segmentIds));
      await refreshBackupAlert(false);
      return { backupWarning: warnings.join("\n") || null };
    }
    if (message.type === "merge") {
      const selected = selectedCalls(calls, message.ids);
      if (selected.length < 2) throw new Error("Select at least two calls to merge");
      if (selected.some(open)) throw new Error("Stop recording before merging calls");
      const target = selected.reduce((a, b) => a.startTime < b.startTime ? a : b);
      const mergedId = crypto.randomUUID();
      const warnings = [];
      for (const call of selected) {
        if (message.deleteBackups) {
          const warning = await removeCallBackup(call);
          if (warning) warnings.push(`${call.title}: ${warning}`);
        } else await forgetCallBackup(call.id);
      }
      const ids = new Set(selected.flatMap(call => call.segmentIds));
      const changedAt = Date.now();
      const members = sessions.filter(s => ids.has(s.id)).map(s => ({ ...s,
        callId: mergedId, title: target.title, renamed: true, updatedAt: Math.max(changedAt, (s.updatedAt || 0) + 1) }));
      await saveSessions(members);
      const merged = groupCalls(members)[0];
      if (merged) await syncCalls([merged], { force: true });
      return { id: mergedId, backupWarning: warnings.join("\n") || null };
    }
    const call = calls.find(s => s.id === message.id || s.segmentIds.includes(message.id));
    if (message.type === "get") return call ? (await withBackupStatus([call]))[0] : null;
    if (!call) throw new Error("Transcript no longer exists");
    const members = sessions.filter(s => call.segmentIds.includes(s.id));
    if (message.type === "rename") {
      if (typeof message.title !== "string") throw new Error("Invalid title");
      const changedAt = Date.now();
      for (const s of members) {
        s.title = message.title.trim().slice(0, 300) || s.title;
        s.renamed = true; s.updatedAt = Math.max(changedAt, (s.updatedAt || 0) + 1);
      }
      await saveSessions(members);
      const renamed = groupCalls(members)[0];
      await syncCalls([renamed], { force: true });
      return (await withBackupStatus([renamed]))[0];
    }
    if (message.type === "delete") {
      if (open(call)) throw new Error("Stop this transcript before deleting it");
      let backupWarning = null;
      if (message.deleteBackup) backupWarning = await removeCallBackup(call);
      else await forgetCallBackup(call.id);
      await deleteSessions(members.map(s => s.id));
      await refreshBackupAlert(false);
      return { backupWarning };
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
  const tabs = new Set((await openSessions()).map(s => s.tabId));
  for (const tabId of tabs) await finalize(tabId, "interrupted", "interrupted");
}));
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("recover", { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== "recover") return;
  const observedAt = Date.now();
  serial(async () => {
    for (const s of await openSessions()) {
      // Time spent waiting behind a backup is not a missed Meet heartbeat.
      if (!open(s) || observedAt - s.updatedAt < 120000) continue;
      // Missing heartbeat includes crashed/disabled/reloaded extension contexts.
      // Preserve the last durable snapshot, with an explicitly uncertain end time.
      await finalize(s.tabId, "interrupted", "interrupted", s.token);
    }
  });
});
// Important alarms may disappear across browser restarts or extension updates.
// Check at every worker start without resetting an existing alarm's schedule.
chrome.alarms.get("recover").then(alarm => {
  if (!alarm) return chrome.alarms.create("recover", { periodInMinutes: 1 });
}).catch(error => console.error("Echo recovery alarm:", error.message));
