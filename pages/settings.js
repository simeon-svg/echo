import { DEFAULT_AI_PROMPT } from "./transcript-export.js";
import { initPageShell } from "./page-shell.js";
import { confirmAction, notify, request } from "./shared.js";
import { clearBackupDirectory, getBackupDirectory, setBackupDirectory } from "../storage/storage.js";

const $ = selector => document.querySelector(selector);
initPageShell();
const DEFAULT_ANNOUNCE_MESSAGE = "Quick heads-up: I'm saving a text transcript of this call using Meet's live captions, just for my notes. It stays on my device; no audio or video is recorded.";
const fields = { autoStart: $("#auto-start"), announceRecording: $("#announce-recording"), includeAiPrompt: $("#include-ai-prompt") };
const aiPromptControls = $("#ai-prompt-controls");
const aiPrompt = $("#ai-prompt");
const announceMessageControls = $("#announce-message-controls");
const announceMessage = $("#announce-message");
const displayName = $("#display-name");
let directoryHandle = null;
let busy = false;
const inIncognito = !!chrome.extension?.inIncognitoContext;

function updateAnnouncementMessageVisibility() {
  announceMessageControls.hidden = !fields.announceRecording.checked;
}

function updateAiPromptVisibility() {
  aiPromptControls.hidden = !fields.includeAiPrompt.checked;
}
async function saveAiPrompt() {
  const value = aiPrompt.value.trim() || DEFAULT_AI_PROMPT;
  aiPrompt.disabled = true;
  try {
    await chrome.storage.local.set({ aiPrompt: value });
    aiPrompt.value = value;
    notify("Setting saved.");
  } catch (error) { notify(error.message, "error"); }
  finally { aiPrompt.disabled = false; }
}

async function savePreference(key, field) {
  const value = field.checked;
  field.disabled = true;
  try { await chrome.storage.local.set({ [key]: value }); notify("Setting saved."); }
  catch (error) { field.checked = !value; notify(error.message, "error"); }
  finally { field.disabled = false; }
}
async function saveAnnouncementMessage() {
  const value = announceMessage.value.trim() || DEFAULT_ANNOUNCE_MESSAGE;
  announceMessage.value = value;
  try { await chrome.storage.local.set({ announceMessage: value }); notify("Setting saved."); }
  catch (error) { notify(error.message, "error"); }
}
async function saveDisplayName() {
  const value = displayName.value.trim().slice(0, 100);
  displayName.disabled = true;
  try {
    await chrome.storage.local.set({ displayName: value });
    displayName.value = value;
    notify("Setting saved.");
  } catch (error) { notify(error.message, "error"); }
  finally { displayName.disabled = false; }
}
async function refreshBackupStatus() {
  const [status, handle] = await Promise.all([request("backupFolderStatus"), inIncognito ? null : getBackupDirectory()]);
  directoryHandle = handle;
  $("#backup-enabled").checked = status.enabled;
  $("#backup-controls").hidden = !status.enabled;
  $("#backup-status").textContent = !status.folderName ? "No folder selected."
    : status.permission === "granted" ? `Connected to ${status.folderName}/Echo Backups.`
      : `Access to ${status.folderName} needs to be restored. Choose “Allow on every visit” when Chrome asks.`;
  $("#backup-last").textContent = status.lastSuccess
    ? `Last successful backup: ${new Date(status.lastSuccess).toLocaleString()}` : "No successful backups yet.";
  $("#reconnect-folder").hidden = inIncognito || !status.folderName || status.permission === "granted";
  $("#reconnect-folder").textContent = "Grant folder access";
  $("#backup-now").disabled = !status.enabled || status.permission !== "granted";
  $("#disconnect-folder").disabled = !status.folderName;
  $("#choose-folder").textContent = status.folderName ? "Change folder" : "Choose folder";
  $("#choose-folder").hidden = inIncognito;
  $("#disconnect-folder").hidden = inIncognito;
  $("#incognito-backup-controls").hidden = !inIncognito;
}
async function backupWarningAccepted() {
  const { backupPrivacyAcknowledged = false } = await chrome.storage.local.get({ backupPrivacyAcknowledged: false });
  if (backupPrivacyAcknowledged) return true;
  const accepted = await confirmAction({
    title: "Back up conversations as readable TXT files?",
    message: "Backup TXT files are not encrypted. Anyone with access to the selected folder can read them.",
    confirmLabel: "Continue",
    cancelLabel: "Cancel",
  });
  if (accepted) await chrome.storage.local.set({ backupPrivacyAcknowledged: true });
  return accepted;
}
async function enableWithHandle(handle, changedFolder) {
  directoryHandle = handle;
  if (changedFolder) {
    await setBackupDirectory(handle);
    await chrome.storage.local.remove(["backupLastSuccess", "backupProblemActive"]);
  }
  const backfill = await confirmAction({
    title: changedFolder ? "Back up existing conversations?" : "Bring backups up to date?",
    message: changedFolder
      ? "Echo can create TXT backups for all existing conversations in the selected folder now."
      : "Echo can update every conversation that is not currently backed up.",
    confirmLabel: "Back up now",
    cancelLabel: "Only future conversations",
  });
  const result = await request("backupEnable", { enabled: true, backfill });
  if (result.failed) notify(`${result.failed} conversation${result.failed === 1 ? "" : "s"} could not be backed up.`, "error");
  else if (result.waiting) notify(`${result.waiting} conversation${result.waiting === 1 ? " is" : "s are"} waiting for folder access.`);
  else notify(backfill ? "Backup folder connected and existing conversations processed." : "Automatic backup enabled.");
}
async function chooseFolder() {
  if (!window.showDirectoryPicker) throw new Error("Folder backup requires a current version of Chrome.");
  // The picker must be the first prompt so it keeps the original user activation.
  const handle = await window.showDirectoryPicker({ mode: "readwrite", id: "echo-backups" });
  if (!await backupWarningAccepted()) return false;
  await enableWithHandle(handle, true);
  return true;
}
async function reconnectFolder() {
  if (!directoryHandle) return chooseFolder();
  const permission = await directoryHandle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("Backup folder access was not granted.");
  const result = await request("backupEnable", { enabled: true, backfill: true });
  if (result.failed) notify(`${result.failed} conversation${result.failed === 1 ? "" : "s"} could not be backed up.`, "error");
  else if (result.waiting) notify(`${result.waiting} conversation${result.waiting === 1 ? " is" : "s are"} still waiting for folder access.`);
  else notify("Backup folder reconnected and conversations brought up to date.");
  return true;
}
async function withBusy(work) {
  if (busy) return;
  busy = true;
  $("#backup-controls").classList.add("busy");
  try { await work(); }
  catch (error) {
    if (error?.name !== "AbortError") notify(error.message, "error");
  } finally {
    busy = false;
    $("#backup-controls").classList.remove("busy");
    await refreshBackupStatus().catch(error => notify(error.message, "error"));
  }
}
async function load() {
  try {
    const settings = await chrome.storage.local.get({ autoStart: true, announceRecording: true, announceMessage: DEFAULT_ANNOUNCE_MESSAGE, displayName: "", includeAiPrompt: false, aiPrompt: DEFAULT_AI_PROMPT });
    aiPrompt.value = settings.aiPrompt || DEFAULT_AI_PROMPT;
    aiPrompt.disabled = false;
    displayName.value = settings.displayName || "";
    displayName.disabled = false;
    announceMessage.value = settings.announceMessage || DEFAULT_ANNOUNCE_MESSAGE;
    for (const [key, field] of Object.entries(fields)) {
      field.checked = settings[key]; field.disabled = false;
      field.addEventListener("change", async () => {
        if (key === "announceRecording") updateAnnouncementMessageVisibility();
        if (key === "includeAiPrompt") updateAiPromptVisibility();
        await savePreference(key, field);
        if (key === "announceRecording") updateAnnouncementMessageVisibility();
        if (key === "includeAiPrompt") updateAiPromptVisibility();
      });
    }
    updateAnnouncementMessageVisibility();
    updateAiPromptVisibility();
    directoryHandle = inIncognito ? null : await getBackupDirectory();
    $("#backup-enabled").disabled = false;
    await refreshBackupStatus();
  } catch (error) { notify(error.message, "error"); }
}

announceMessage.addEventListener("change", saveAnnouncementMessage);
aiPrompt.addEventListener("change", saveAiPrompt);
displayName.addEventListener("change", saveDisplayName);

$("#backup-enabled").addEventListener("change", event => withBusy(async () => {
  if (!event.target.checked) {
    await request("backupEnable", { enabled: false });
    notify("Automatic backup disabled. Existing files were left unchanged.");
    return;
  }
  if (inIncognito) {
    const status = await request("backupFolderStatus");
    if (status.permission !== "granted") {
      event.target.checked = status.enabled;
      await request("openRegularSettings");
      return;
    }
    await request("backupEnable", { enabled: true, backfill: true });
    notify("Automatic backup enabled.");
    return;
  }
  if (!directoryHandle) {
    const chosen = await chooseFolder();
    if (!chosen) event.target.checked = false;
  } else await reconnectFolder();
}));
$("#choose-folder").addEventListener("click", () => withBusy(chooseFolder));
$("#manage-backup-regular").addEventListener("click", () => withBusy(async () => { await request("openRegularSettings"); }));
$("#reconnect-folder").addEventListener("click", () => withBusy(reconnectFolder));
$("#backup-now").addEventListener("click", () => withBusy(async () => {
  const result = await request("backupAll");
  if (result.failed) notify(`${result.failed} conversation${result.failed === 1 ? "" : "s"} could not be backed up.`, "error");
  else if (result.waiting) notify(`${result.waiting} conversation${result.waiting === 1 ? " is" : "s are"} waiting for folder access.`);
  else notify(result.backed ? `${result.backed} conversation${result.backed === 1 ? "" : "s"} backed up.` : "All conversations are already backed up.");
}));
$("#disconnect-folder").addEventListener("click", () => withBusy(async () => {
  await request("backupEnable", { enabled: false });
  await clearBackupDirectory();
  directoryHandle = null;
  await chrome.storage.local.remove(["backupLastSuccess", "backupProblemActive"]);
  notify("Backup folder disconnected. Existing files were left unchanged.");
}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && !busy && (changes.backupEnabled || changes.backupLastSuccess || changes.backupProblemActive)) {
    refreshBackupStatus().catch(error => notify(error.message, "error"));
  }
});
$("#settings").addEventListener("submit", event => event.preventDefault());
load();
