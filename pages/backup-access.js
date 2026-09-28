import { getBackupDirectory } from "../storage/storage.js";

let directoryHandle = null;

// Call before opening a confirmation dialog so its final button can use a fresh user gesture.
export async function prepareBackupAccess() {
  directoryHandle = await getBackupDirectory();
  return directoryHandle;
}

export async function requestBackupAccess() {
  const handle = directoryHandle;
  if (!handle) throw new Error("Choose a backup folder in Settings first.");
  // Keep this as the first permission-sensitive operation in the click handler.
  // requestPermission() resolves immediately when access is already granted.
  const permission = await handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("Backup folder access was not granted. Choose “Allow on every visit” to avoid repeated prompts.");
  return true;
}
