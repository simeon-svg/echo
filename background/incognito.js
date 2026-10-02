// Split processes cannot use runtime messaging with each other. chrome.storage.local
// is shared and wakes the regular worker, which alone owns durable IndexedDB writes.
const prefix = "echo:incognito-request:";
const timeout = 120000;
export const IncognitoBridge = {
  send(command) {
    const key = prefix + crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        chrome.storage.onChanged.removeListener(receive);
        chrome.storage.local.remove(key).catch(() => {});
        if (result.ok) resolve(result.value);
        else reject(Object.assign(new Error(result.error || "Cannot access shared history"), { code: result.code }));
      };
      const receive = (changes, area) => {
        if (area === "local" && changes[key]?.newValue?.state === "complete") finish(changes[key].newValue.result);
      };
      const timer = setTimeout(() => finish({ ok: false, error: "Shared history did not respond. Reload Echo before trying again." }), timeout);
      chrome.storage.onChanged.addListener(receive);
      chrome.storage.local.set({ [key]: { state: "pending", createdAt: Date.now(), command } }).catch(error => finish({ ok: false, error: error.message }));
    });
  },
  install(execute) {
    const running = new Set();
    async function accept(key, entry, recovering = false) {
      if (!key.startsWith(prefix) || !entry || running.has(key)) return;
      if (Date.now() - entry.createdAt > timeout) { await chrome.storage.local.remove(key); return; }
      if (entry.state === "complete") return;
      // A restart during a mutation must not replay a merge, bookmark, or deletion.
      if (entry.state === "processing" && !recovering) return;
      running.add(key);
      let result;
      try {
        if (entry.state !== "pending") throw new Error("Shared history was interrupted. Refresh to check whether the action completed.");
        await chrome.storage.local.set({ [key]: { ...entry, state: "processing" } });
        const value = await execute(entry.command);
        result = { ok: true, value };
      } catch (error) {
        result = { ok: false, error: error.message, ...(error.code ? { code: error.code } : {}) };
      }
      try { await chrome.storage.local.set({ [key]: { state: "complete", createdAt: entry.createdAt, result } }); }
      finally { running.delete(key); }
    }
    const receive = (changes, area) => {
      if (area !== "local") return;
      for (const [key, change] of Object.entries(changes)) {
        if (change.newValue) accept(key, change.newValue).catch(error => console.error("Echo shared history:", error.message));
      }
    };
    chrome.storage.onChanged.addListener(receive);
    const recover = async () => {
      const values = await chrome.storage.local.get(null);
      await Promise.all(Object.entries(values || {}).filter(([key]) => key.startsWith(prefix)).map(([key, entry]) => accept(key, entry, true)));
    };
    recover().catch(error => console.error("Echo shared history:", error.message));
    return recover;
  },
};
