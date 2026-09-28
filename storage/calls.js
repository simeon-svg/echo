// Sessions remain separate durable records; the UI presents their call as one conversation.
export const callIdOf = session => session.callId || session.id;
export function groupCalls(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const id = callIdOf(session);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(session);
  }
  return [...groups].map(([id, segments]) => {
    segments.sort((a, b) => a.startTime - b.startTime);
    const first = segments[0], last = segments[segments.length - 1];
    const status = segments.some(s => s.status === "recording") ? "recording"
      : segments.some(s => s.status === "paused") ? "paused"
      : segments.some(s => s.status === "interrupted") ? "interrupted" : "completed";
    const endTime = ["recording", "paused"].includes(status) ? null
      : Math.max(...segments.map(s => s.endTime || s.updatedAt || s.startTime));
    return { ...first, id, title: segments.find(s => s.renamed)?.title || first.title,
      status, endTime, updatedAt: Math.max(...segments.map(s => s.updatedAt || s.startTime)),
      duration: (endTime || last.updatedAt || last.startTime) - first.startTime,
      participants: [...new Set(segments.flatMap(s => s.participants))],
      blocks: segments.flatMap(s => s.blocks.map(b => ({ ...b, segmentId: s.id }))).sort((a, b) => a.timestamp - b.timestamp),
      segmentIds: segments.map(s => s.id), segmentCount: segments.length };
  }).sort((a, b) => b.startTime - a.startTime);
}
