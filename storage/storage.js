/* IndexedDB belongs to the extension origin, not meet.google.com. */
let database;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("meet-transcripts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sessions", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}
export async function query(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", mode);
    const request = operation(tx.objectStore("sessions"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || new Error("Local storage transaction aborted"));
  });
}
export const allSessions = () => query("readonly", s => s.getAll());
export const getSession = id => query("readonly", s => s.get(id));
export const saveSession = session => query("readwrite", s => s.put(session));
export const deleteSession = id => query("readwrite", s => s.delete(id));
