import { IncognitoBridge } from "./incognito.js";
import { allSessions, getSession, saveSession, saveSessions, deleteSessions, openSessions, sessionsForCall, sessionsForTab } from "../storage/storage.js";
import { callIdOf, groupCalls, relatedRecordings, possibleRecordings, bookmarkTurnAnchor, turnBookmarks } from "../storage/calls.js";
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
  queue = result.catch(error => {
    // The caller handles an ended recording by offering a fresh Start.
    // Keep unexpected storage failures visible in Chrome's extension errors.
    if (error.code !== "SESSION_FINALIZED") console.error("Meet Transcript local storage:", error.message);
  });
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
    (s.gaps == null || (Array.isArray(s.gaps) && s.gaps.every(g => g && ["captions", "paused", "interrupted"].includes(g.kind) && Number.isFinite(g.timestamp) && (g.endTime == null || (Number.isFinite(g.endTime) && g.endTime >= g.timestamp))))) &&
    ["recording", "paused", "completed"].includes(s.status) &&
    (s.meetingId == null || (typeof s.meetingId === "string" && s.meetingId.length > 0)) &&
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
async function bookmarkAction(message, members) {
  const target = members.find(s => s.id === message.segmentId) || (members.length === 1 ? members[0] : null);
  if (!target) throw new Error("Recording segment no longer exists");
  const notes = target.bookmarks = turnBookmarks(target);
  if (message.type === "bookmarkAdd") {
    if (message.blockId != null && !target.blocks.some(b => b.id === message.blockId)) throw new Error("Reply no longer exists");
    const block = message.blockId == null ? null : bookmarkTurnAnchor(target, message.blockId);
    const timestamp = message.live ? Math.max(target.startTime, Math.min(Date.now(), Number.isFinite(message.timestamp) ? message.timestamp : Date.now())) : (block?.timestamp || Date.now());
    let note = block && notes.find(note => note.blockId === block.id);
    if (!note) {
      note = { id: crypto.randomUUID(), timestamp, blockId: block?.id ?? null, text: "" }; notes.push(note);
    }
    target.updatedAt = Math.max(Date.now(), (target.updatedAt || 0) + 1);
    await saveSession(target);
    if (!open(target)) await syncCalls(groupCalls(members), { force: true });
    return message.live ? { ...note, commentId: crypto.randomUUID() } : note;
  }
  const note = notes.find(n => n.id === message.bookmarkId || n.aliasIds?.includes(message.bookmarkId));
  if (!note) throw new Error("Bookmark no longer exists");
  if (message.type === "bookmarkUpdate") {
    if (typeof message.text !== "string" || message.text.length > 10000) throw new Error("Note must be at most 10,000 characters");
    if (message.live && message.commentId != null) {
      if (typeof message.commentId !== "string" || !message.commentId || message.commentId.length > 100) throw new Error("Invalid note draft");
      const drafts = (note.noteDrafts || []).filter(draft => draft.id !== message.commentId);
      const prior = (note.noteDrafts || []).findIndex(draft => draft.id === message.commentId);
      const draft = { id: message.commentId, text: message.text };
      if (prior < 0) drafts.push(draft); else drafts.splice(prior, 0, draft);
      const baseText = note.baseText ?? note.text;
      const combined = [baseText, ...drafts.map(draft => draft.text)].filter(text => text.trim()).join("\n\n");
      if (combined.length > 10000) throw new Error("Combined note must be at most 10,000 characters");
      note.baseText = baseText; note.noteDrafts = drafts; note.text = combined;
    } else {
      note.text = message.text; delete note.baseText; delete note.noteDrafts;
    }
  } else target.bookmarks = notes.filter(n => n !== note);
  target.updatedAt = Math.max(Date.now(), (target.updatedAt || 0) + 1);
  await saveSession(target);
  if (!open(target)) await syncCalls(groupCalls(members), { force: true });
  return note;
}
const bookmarkTypes = ["bookmarkAdd", "bookmarkUpdate", "bookmarkDelete"];
function openHistory(tab) {
  return chrome.tabs.create({
    url: chrome.runtime.getURL("pages/transcripts.html"),
    ...(Number.isInteger(tab?.windowId) && tab.windowId >= 0 ? { windowId: tab.windowId } : {}),
  });
}
async function openRegularSettings() {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const target = windows.find(window => !window.incognito);
  const url = chrome.runtime.getURL("pages/settings.html");
  return target ? chrome.tabs.create({ url, windowId: target.id }) : chrome.windows.create({ url, incognito: false });
}
function handleMessage(message, sender) {
  const meet = sender.tab && /^https:\/\/meet\.google\.com\//.test(sender.url || "");
  // Extension pages can also be normal Chrome tabs.
  const ownPage = sender.url?.startsWith(chrome.runtime.getURL("pages/"));
  if (!meet && !ownPage) return;
  return serial(async () => {
    if (meet) {
      const tabId = sender.tab.id;
      if (message.type === "beginCall") {
        const meetUrl = new URL(sender.url).origin + new URL(sender.url).pathname;
        // Each start creates a separate history entry, including in the same Meet.
        return { callId: crypto.randomUUID(), meetUrl };
      }
      if (message.type === "history") return openHistory(sender.tab);
      if (message.type === "finish") {
        await finalize(tabId, message.reason || "left", "completed", message.token);
        return true;
      }
      if (bookmarkTypes.includes(message.type)) {
        const target = await getSession(message.segmentId);
        if (!target || target.tabId !== tabId || target.token !== message.token) throw new Error("Session mismatch");
        return bookmarkAction({ ...message, live: true }, [target]);
      }
      if (!["create", "save"].includes(message.type)) throw new Error("Unknown Meet message");
      const incoming = message.session;
      if (!validSession(incoming)) throw new Error("Invalid session");
      const existing = await getSession(incoming.id);
      if (!existing && message.type !== "create") throw new Error("Transcript no longer exists. Start a new transcript.");
      if (existing && (existing.tabId !== tabId || existing.token !== incoming.token)) throw new Error("Session mismatch");
      if (existing && !open(existing)) {
        if (incoming.status === "completed") return true;
        throw Object.assign(new Error("This session was finalized after interruption. Stop and start a new transcript."), { code: "SESSION_FINALIZED" });
      }
      // Preserve an edited title and prevent deleted sessions from reappearing.
      const s = { ...incoming, callId: incoming.callId || incoming.id, tabId, incognito: !!sender.tab.incognito, updatedAt: Date.now(),
        meetUrl: new URL(sender.url).origin + new URL(sender.url).pathname };
      s.bookmarks = existing?.bookmarks || [];
      if (existing?.callId) s.callId = existing.callId;
      if (existing) s.meetingId = existing.meetingId || null;
      const renamed = existing?.renamed ? existing : (await sessionsForCall(callIdOf(s))).find(item => item.renamed);
      if (renamed) { s.title = renamed.title; s.renamed = true; }
      await saveSession(s);
      if (s.status === "completed") {
        const call = groupCalls(await sessionsForCall(callIdOf(s)))[0];
        if (call) await syncCalls([call]);
      }
      return true;
    }
    if (message.type === "openRegularSettings") return openRegularSettings();
    if (message.type === "backupFolderStatus") return backupFolderStatus();
    const singleCall = ["get", "rename", "delete", "backupOne", ...bookmarkTypes].includes(message.type);
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
      if (message.relatedMeetingId !== undefined) {
        const related = relatedRecordings(calls).get(message.relatedMeetingId);
        if (!related || related.length !== selected.length || selected.some(call => !related.includes(call))) {
          throw new Error("These related recordings have changed. Refresh and try again.");
        }
      }
      if (message.possibleGroupKey !== undefined) {
        const possible = possibleRecordings(calls).get(message.possibleGroupKey);
        if (!possible || selected.some(call => !possible.includes(call))) {
          throw new Error("These suggested recordings have changed. Review them again before merging.");
        }
      }
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
    if (bookmarkTypes.includes(message.type)) return bookmarkAction(message, members);
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
  });
}
const inIncognito = !!chrome.extension?.inIncognitoContext;
const trustedSender = sender => !!sender.tab && /^https:\/\/meet\.google\.com\//.test(sender.url || "") || sender.url?.startsWith(chrome.runtime.getURL("pages/"));
const sharedCommand = (message, sender) => ({ kind: "message", message, sender: { url: sender.url, tab: sender.tab ? { id: sender.tab.id, windowId: sender.tab.windowId, incognito: true } : undefined } });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!trustedSender(sender)) return;
  const local = message.type === "history" || message.type === "beginCall";
  const result = inIncognito && !local ? IncognitoBridge.send(sharedCommand(message, sender)) : handleMessage(message, sender);
  result.then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message, ...(error.code ? { code: error.code } : {}) }));
  return true;
});
const recoverSharedRequests = !inIncognito ? IncognitoBridge.install(command => {
  if (command?.kind === "message" && command.sender?.tab?.incognito && trustedSender(command.sender)) return handleMessage(command.message, command.sender);
  // Incognito extension pages may have no tab (for example an options window).
  if (command?.kind === "message" && !command.sender?.tab && command.sender?.url?.startsWith(chrome.runtime.getURL("pages/"))) return handleMessage(command.message, command.sender);
  if (command?.kind === "finalize" && Number.isInteger(command.tabId) && ["tab closed", "navigation", "interrupted"].includes(command.reason)) {
    return serial(async () => {
      const sessions = await sessionsForTab(command.tabId);
      if (sessions.some(session => !session.incognito)) throw new Error("Invalid incognito session");
      return finalize(command.tabId, command.reason, command.reason === "interrupted" ? "interrupted" : "completed");
    });
  }
  throw new Error("Invalid shared-history request");
}) : null;
function finalizeFromTab(tabId, reason, status = "completed") {
  if (inIncognito) return IncognitoBridge.send({ kind: "finalize", tabId, reason }).catch(error => console.error("Echo shared history:", error.message));
  return serial(() => finalize(tabId, reason, status));
}
chrome.action.onClicked.addListener(tab => openHistory(tab));
chrome.tabs.onRemoved.addListener(tabId => finalizeFromTab(tabId, "tab closed"));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") finalizeFromTab(tabId, "navigation");
  else if (change.discarded) finalizeFromTab(tabId, "interrupted", "interrupted");
});
chrome.runtime.onStartup.addListener(() => serial(async () => {
  if (inIncognito) return;
  const tabs = new Set((await openSessions()).filter(s => !s.incognito).map(s => s.tabId));
  for (const tabId of tabs) await finalize(tabId, "interrupted", "interrupted");
}));
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("recover", { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== "recover" || inIncognito) return;
  recoverSharedRequests().catch(error => console.error("Echo shared history:", error.message));
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
