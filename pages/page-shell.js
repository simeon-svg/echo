import { createNotificationCenter } from "./notification-center.js";
import { notify, request, setNotificationHandler, isOpen } from "./shared.js";
import { relatedRecordings, possibleRecordings } from "../storage/calls.js";

// Each page uses the same feed. Session storage keeps activity across navigation.
export function initPageShell({ merge } = {}) {
  let relationships = [];
  const pending = new Set();
  let lastError = "";
  const groups = calls => [
    ...[...relatedRecordings(calls)].map(([key, calls]) => ({ key, calls, certain: true })),
    ...[...possibleRecordings(calls)].map(([key, calls]) => ({ key, calls, certain: false })),
  ];
  const update = () => center.updateRelationships(relationships.map(item => ({ ...item, busy: pending.has(item.key) })));
  async function refreshSuggestions() {
    try {
      relationships = groups(await request("list")); update(); lastError = "";
    } catch (error) {
      if (error.message !== lastError) notify(error.message, "error");
      lastError = error.message;
    }
  }
  async function mergeSuggestion({ key, certain }, ids) {
    if (pending.has(key)) return;
    pending.add(key); update();
    try {
      const current = groups(await request("list")).find(item => item.key === key && item.certain === certain);
      if (!current || ids.length < 2 || ids.some(id => !current.calls.some(call => call.id === id))
        || (certain && ids.length !== current.calls.length)) throw new Error("These recordings have changed. Review the updated suggestion.");
      if (current.calls.some(isOpen)) throw new Error("Stop recording before merging these recordings.");
      const result = await request("merge", { ids, ...(certain ? { relatedMeetingId: key } : { possibleGroupKey: key }), deleteBackups: false });
      notify(result.backupWarning || `${ids.length} recordings merged.`, result.backupWarning ? "error" : "success");
      await refreshSuggestions();
      const currentId = new URLSearchParams(location.search).get("id");
      if (ids.includes(currentId)) location.href = `transcript.html?id=${encodeURIComponent(result.id)}`;
    } catch (error) {
      notify(error.message, "error"); await refreshSuggestions();
    } finally { pending.delete(key); update(); }
  }
  const center = createNotificationCenter({ merge: merge || mergeSuggestion });
  setNotificationHandler(center.notify);
  if (!merge) {
    refreshSuggestions();
    window.addEventListener("focus", refreshSuggestions);
    setInterval(() => { if (!document.hidden) refreshSuggestions(); }, 5000);
  }
  return center;
}
