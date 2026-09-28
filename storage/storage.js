/* IndexedDB belongs to the extension origin, not meet.google.com. */
let database;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("meet-transcripts", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("sessions")) request.result.createObjectStore("sessions", { keyPath: "id" });
      if (!request.result.objectStoreNames.contains("backupState")) request.result.createObjectStore("backupState", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}
export async function query(mode, operation, storeName = "sessions") {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = operation(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error || request?.error);
    tx.onabort = () => reject(tx.error || new Error("Local storage transaction aborted"));
  });
}
export const allSessions = () => query("readonly", s => s.getAll());
export const getSession = id => query("readonly", s => s.get(id));
export const saveSession = session => query("readwrite", s => s.put(session));
export const deleteSession = id => query("readwrite", s => s.delete(id));

const backupKey = id => `call:${id}`;
const backupQuery = (mode, operation) => query(mode, operation, "backupState");
export const getBackupDirectory = async () => (await backupQuery("readonly", s => s.get("directory")))?.handle || null;
export const setBackupDirectory = handle => backupQuery("readwrite", store => {
  store.clear();
  return store.put({ key: "directory", handle });
});
export const clearBackupDirectory = () => backupQuery("readwrite", store => store.clear());
export const getBackupCallState = id => backupQuery("readonly", store => store.get(backupKey(id)));
export const saveBackupCallState = (id, state) => backupQuery("readwrite", store => store.put({ ...state, key: backupKey(id), callId: id }));
export const deleteBackupCallState = id => backupQuery("readwrite", store => store.delete(backupKey(id)));
export const allBackupStates = async () => (await backupQuery("readonly", store => store.getAll())).filter(item => item.key.startsWith("call:"));
