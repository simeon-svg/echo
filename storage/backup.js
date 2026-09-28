import {
  allBackupStates,
  deleteBackupCallState,
  getBackupCallState,
  getBackupDirectory,
  saveBackupCallState,
} from "./storage.js";

export const BACKUP_ROOT = "Echo Backups";
const complete = call => ["completed", "interrupted"].includes(call.status);
const versionOf = call => call.updatedAt || call.endTime || call.startTime;
const pad = value => String(value).padStart(2, "0");
export const monthOf = call => {
  const date = new Date(call.startTime);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
};
export const safeFileName = call => {
  const cleaned = String(call.title || "Untitled conversation")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "").trim();
  // Keep ample room for a UUID on filesystems with a 255-byte filename limit.
  const title = [...(cleaned || "Untitled conversation")].slice(0, 48).join("").replace(/[. ]+$/g, "") || "Untitled conversation";
  const id = String(call.id).replace(/[^a-z0-9-]/gi, "_");
  return `${title} -- ${id}.txt`;
};
const displayDate = at => new Date(at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const displayTime = at => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const minutes = call => Math.max(0, Math.round(((call.endTime || call.updatedAt || Date.now()) - call.startTime) / 60000));
export function backupText(call) {
  return `${call.title}\nEcho ID: ${call.id}\n${displayDate(call.startTime)}\n${displayTime(call.startTime)}–${displayTime(call.endTime || call.updatedAt)}\nDuration: ${minutes(call)} minutes\nStatus: ${call.status}\n\nParticipants:\n${call.participants.join("\n")}\n\n---\n\n` +
    call.blocks.map(block => `${block.speaker} — ${displayTime(block.timestamp)}\n${block.text}`).join("\n\n") + "\n";
}

async function writableDirectory() {
  const handle = await getBackupDirectory();
  if (!handle) throw new Error("Choose a backup folder in Settings.");
  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission === "prompt") {
    const error = new Error("Backup folder access is required. Click the amber backup indicator to grant access.");
    error.name = "BackupPermissionRequiredError";
    throw error;
  }
  if (permission !== "granted") throw new Error("Backup folder access was denied. Reconnect it in Settings.");
  return handle;
}
async function monthDirectory(parent, month, create) {
  const root = await parent.getDirectoryHandle(BACKUP_ROOT, { create });
  return root.getDirectoryHandle(month, { create });
}
async function removeFile(parent, month, filename) {
  try {
    const directory = await monthDirectory(parent, month, false);
    await directory.removeEntry(filename);
  } catch (error) {
    if (error?.name !== "NotFoundError") throw error;
  }
}
async function writeCall(call) {
  const previous = await getBackupCallState(call.id);
  try {
    const parent = await writableDirectory();
    const month = monthOf(call), filename = safeFileName(call);
    const directory = await monthDirectory(parent, month, true);
    const file = await directory.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(backupText(call));
      await writable.close();
    } catch (error) {
      if (writable.abort) await writable.abort().catch(() => {});
      throw error;
    }
    if (previous?.filename && (previous.filename !== filename || previous.month !== month)) {
      await removeFile(parent, previous.month, previous.filename);
    }
    const backedAt = Date.now();
    await saveBackupCallState(call.id, { status: "backed", version: versionOf(call), backedAt, month, filename });
    await chrome.storage.local.set({ backupLastSuccess: backedAt });
    return { callId: call.id, status: "backed" };
  } catch (error) {
    await saveBackupCallState(call.id, {
      ...(previous || {}), status: error.name === "BackupPermissionRequiredError" ? "permission-required" : "failed",
      failedAt: Date.now(), attemptedVersion: versionOf(call), error: error.message,
    });
    return { callId: call.id, status: error.name === "BackupPermissionRequiredError" ? "permission-required" : "failed", error: error.message };
  }
}

async function notify(id, title, message) {
  if (!chrome.notifications?.create) return;
  await chrome.notifications.create(id, {
    type: "basic", iconUrl: chrome.runtime.getURL("icons/echo-128.png"), title, message,
  });
}
export async function refreshBackupAlert(announceResolution = true) {
  const { backupEnabled = false, backupProblemActive = false } = await chrome.storage.local.get({
    backupEnabled: false, backupProblemActive: false,
  });
  const states = backupEnabled ? await allBackupStates() : [];
  const failed = states.some(state => ["failed", "cleanup-failed"].includes(state.status));
  const waiting = !failed && states.some(state => ["permission-required", "cleanup-permission-required"].includes(state.status));
  const problem = failed ? "failed" : waiting ? "permission" : false;
  if (chrome.action?.setBadgeText) {
    await chrome.action.setBadgeText({ text: problem ? "!" : "" });
    if (problem && chrome.action.setBadgeBackgroundColor) {
      await chrome.action.setBadgeBackgroundColor({ color: failed ? "#b42318" : "#b7791f" });
    }
  }
  if (problem && backupProblemActive !== problem) {
    await chrome.storage.local.set({ backupProblemActive: problem });
    if (waiting) {
      if (chrome.notifications?.clear) await chrome.notifications.clear("echo-backup-problem");
      await notify("echo-backup-permission", "Echo backup is waiting", "Folder access is required. Click an amber backup indicator, or grant access in Settings.");
      return;
    }
    if (chrome.notifications?.clear) await chrome.notifications.clear("echo-backup-permission");
    await notify("echo-backup-problem", "Echo backup needs attention", "Some conversations could not be backed up. Reconnect the folder in Settings.");
  } else if (!problem && backupProblemActive) {
    await chrome.storage.local.set({ backupProblemActive: false });
    if (chrome.notifications?.clear) {
      await chrome.notifications.clear("echo-backup-problem");
      await chrome.notifications.clear("echo-backup-permission");
    }
    if (announceResolution && backupEnabled) await notify("echo-backup-restored", "Echo backup is up to date", "All conversations are backed up again.");
  }
}

export async function syncCalls(calls, { force = false } = {}) {
  const { backupEnabled = false } = await chrome.storage.local.get({ backupEnabled: false });
  if (!backupEnabled) return { backed: 0, failed: 0, results: [] };
  const cleanup = await retryPendingCleanup();
  const results = [];
  for (const call of calls.filter(complete)) {
    const state = await getBackupCallState(call.id);
    if (!force && state?.status === "backed" && state.version >= versionOf(call)) continue;
    results.push(await writeCall(call));
  }
  await refreshBackupAlert();
  return {
    backed: results.filter(result => result.status === "backed").length,
    failed: results.filter(result => result.status === "failed").length + cleanup.failed,
    waiting: results.filter(result => result.status === "permission-required").length + (cleanup.waiting || 0),
    results, cleanup,
  };
}
export async function syncOne(call) {
  if (!complete(call)) throw new Error("This conversation can be backed up after it ends.");
  const result = await writeCall(call);
  await refreshBackupAlert();
  if (result.status === "failed") throw new Error(result.error);
  return result;
}
export async function removeCallBackup(call) {
  const state = await getBackupCallState(call.id);
  const month = state?.month || monthOf(call), filename = state?.filename || safeFileName(call);
  try {
    const parent = await writableDirectory();
    await removeFile(parent, month, filename);
    await deleteBackupCallState(call.id);
    return null;
  } catch (error) {
    const status = error.name === "BackupPermissionRequiredError" ? "cleanup-permission-required" : "cleanup-failed";
    await saveBackupCallState(call.id, { ...(state || {}), status, month, filename,
      failedAt: Date.now(), error: error.message });
    return error.message;
  }
}
async function retryPendingCleanup() {
  const pending = (await allBackupStates()).filter(state => ["cleanup-failed", "cleanup-permission-required"].includes(state.status));
  if (!pending.length) return { deleted: 0, failed: 0, waiting: 0 };
  let deleted = 0, failed = 0, waiting = 0;
  for (const state of pending) {
    try {
      const parent = await writableDirectory();
      await removeFile(parent, state.month, state.filename);
      await deleteBackupCallState(state.callId);
      deleted++;
    } catch (error) {
      const status = error.name === "BackupPermissionRequiredError" ? "cleanup-permission-required" : "cleanup-failed";
      if (status === "cleanup-permission-required") waiting++;
      else failed++;
      await saveBackupCallState(state.callId, { ...state, status, failedAt: Date.now(), error: error.message });
    }
  }
  return { deleted, failed, waiting };
}
export async function forgetCallBackup(id) { await deleteBackupCallState(id); }
export async function withBackupStatus(calls) {
  const { backupEnabled = false } = await chrome.storage.local.get({ backupEnabled: false });
  const states = new Map((await allBackupStates()).map(state => [state.callId, state]));
  if (!backupEnabled) return calls.map(call => ({ ...call, hasBackup: !!states.get(call.id)?.filename }));
  return calls.map(call => {
    const state = states.get(call.id);
    const status = ["permission-required", "cleanup-permission-required"].includes(state?.status) ? "permission-required"
      : ["failed", "cleanup-failed"].includes(state?.status) ? "failed"
      : state?.status === "backed" && state.version >= versionOf(call) ? "backed" : "pending";
    return { ...call, hasBackup: !!state?.filename,
      backup: { status, backedAt: state?.backedAt || null, error: state?.error || null } };
  });
}
export async function backupFolderStatus() {
  const [{ backupEnabled = false, backupLastSuccess = null }, handle] = await Promise.all([
    chrome.storage.local.get({ backupEnabled: false, backupLastSuccess: null }), getBackupDirectory(),
  ]);
  let permission = "missing";
  if (handle) {
    try { permission = await handle.queryPermission({ mode: "readwrite" }); }
    catch { permission = "denied"; }
  }
  return { enabled: backupEnabled, folderName: handle?.name || null, permission, lastSuccess: backupLastSuccess };
}
