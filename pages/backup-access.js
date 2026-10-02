import { getBackupDirectory } from "../storage/storage.js";
import { request } from "./shared.js";

let directoryHandle = null;
let sharedPermission = null;

// Call before opening a confirmation dialog so its final button can use a fresh user gesture.
export async function prepareBackupAccess() {
  if (globalThis.chrome?.extension?.inIncognitoContext) {
    sharedPermission = (await request("backupFolderStatus")).permission;
    return null;
  }
  directoryHandle = await getBackupDirectory();
  return directoryHandle;
}

export async function requestBackupAccess() {
  if (globalThis.chrome?.extension?.inIncognitoContext) {
    if (sharedPermission === "granted") return true;
    await request("openRegularSettings");
    throw new Error("Grant backup folder access in the regular Echo Settings window, then try again.");
  }
  const handle = directoryHandle;
  if (!handle) throw new Error("Choose a backup folder in Settings first.");
  // Keep this as the first permission-sensitive operation in the click handler.
  // requestPermission() resolves immediately when access is already granted.
  const permission = await handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("Backup folder access was not granted. Choose “Allow on every visit” to avoid repeated prompts.");
  return true;
}
