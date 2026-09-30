/* IndexedDB belongs to the extension origin, not meet.google.com. */
let database;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open("meet-transcripts", 3);
    request.onblocked = () => {
      blocked = true; database = null;
      reject(new Error("Close other Echo pages and reload this page to finish updating local storage."));
    };
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("sessions")) request.result.createObjectStore("sessions", { keyPath: "id" });
      if (!request.result.objectStoreNames.contains("backupState")) request.result.createObjectStore("backupState", { keyPath: "key" });
      const sessions = request.transaction.objectStore("sessions");
      if (!sessions.indexNames.contains("callId")) sessions.createIndex("callId", "callId");
      if (!sessions.indexNames.contains("tabId")) sessions.createIndex("tabId", "tabId");
      if (!sessions.indexNames.contains("status")) sessions.createIndex("status", "status");
      const cursor = sessions.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (!row.value.callId) row.update({ ...row.value, callId: row.value.id });
        row.continue();
      };
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); database = null; };
      db.onclose = () => { database = null; };
      resolve(db);
    };
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}
export async function query(mode, operation, storeName = "sessions") {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let request;
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error || request?.error);
    tx.onabort = () => reject(tx.error || new Error("Local storage transaction aborted"));
    try { request = operation(tx.objectStore(storeName)); }
    catch (error) { tx.abort(); reject(error); }
  });
}
export const allSessions = () => query("readonly", s => s.getAll());
export const getSession = id => query("readonly", s => s.get(id));
export const sessionsForCall = id => query("readonly", s => s.index("callId").getAll(id));
export const sessionsForTab = id => query("readonly", s => s.index("tabId").getAll(id));
export const openSessions = async () => (await Promise.all(["recording", "paused"].map(status =>
  query("readonly", s => s.index("status").getAll(status))))).flat();
export const saveSession = session => query("readwrite", s => s.put({ ...session, callId: session.callId || session.id }));
// One transaction per user action: a failed write must not leave a partial merge or rename.
export const saveSessions = sessions => query("readwrite", store => {
  for (const session of sessions) store.put({ ...session, callId: session.callId || session.id });
});
export const deleteSessions = ids => query("readwrite", store => {
  for (const id of ids) store.delete(id);
});

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
