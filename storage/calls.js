// Resolve personal names only for presentation/export; never rewrite durable sessions.
// Legacy aliases are supported only when no explicit self identity was captured.
export function withDisplayName(call, value) {
  const name = typeof value === "string" ? value.trim().slice(0, 100) : "";
  if (!name) return call;
  const self = block => block.isSelf === true ||
    (block.isSelf == null && ["You", "Вие"].includes(block.speaker.trim()));
  const selfNames = new Set(call.blocks.filter(self).map(block => block.speaker));
  const otherNames = new Set(call.blocks.filter(block => !self(block)).map(block => block.speaker));
  const blocks = call.blocks.map(block => self(block) ? { ...block, isSelf: true, speaker: name } : block);
  const participants = [...new Set([
    ...call.participants.map(speaker => selfNames.has(speaker) && !otherNames.has(speaker) ? name : speaker),
    ...blocks.map(block => block.speaker),
  ])];
  return { ...call, blocks, participants };
}

// Sessions remain separate durable records; the UI presents their call as one conversation.
export const callIdOf = session => session.callId || session.id;
// A turn ends on a speaker change, a recording boundary, or a known caption gap.
export function bookmarkTurnAnchor(session, blockId) {
  let index = session.blocks.findIndex(block => block.id === blockId);
  if (index < 0) return null;
  while (index > 0) {
    const current = session.blocks[index], previous = session.blocks[index - 1];
    if (previous.speaker !== current.speaker || previous.segmentId !== current.segmentId ||
      (session.gaps || []).some(gap => gap.timestamp >= previous.timestamp && gap.timestamp <= current.timestamp)) break;
    index--;
  }
  return session.blocks[index];
}
export function turnBookmarks(session) {
  const result = [], turns = new Map();
  for (const original of [...(session.bookmarks || [])].sort((a, b) => a.timestamp - b.timestamp)) {
    const anchor = original.blockId == null ? null : bookmarkTurnAnchor(session, original.blockId);
    const key = anchor ? anchor.id : `unanchored:${original.id}`;
    const existing = turns.get(key);
    if (existing) {
      existing.text = [existing.text, original.text].filter(text => text.trim()).join("\n\n");
      existing.aliasIds = [...(existing.aliasIds || []), original.id, ...(original.aliasIds || [])];
      // Existing live drafts belong to the combined text; subsequent comments append to it.
      delete existing.noteDrafts; delete existing.baseText;
    } else {
      const note = { ...original, blockId: anchor?.id ?? original.blockId };
      turns.set(key, note); result.push(note);
    }
  }
  return result;
}
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
    const meetUrl = first.meetUrl && segments.every(s => s.meetUrl === first.meetUrl) ? first.meetUrl : null;
    const meetingId = first.meetingId && segments.every(s => s.meetingId === first.meetingId) ? first.meetingId : null;
    const status = segments.some(s => s.status === "recording") ? "recording"
      : segments.some(s => s.status === "paused") ? "paused"
      : segments.some(s => s.status === "interrupted") ? "interrupted" : "completed";
    const endTime = ["recording", "paused"].includes(status) ? null
      : Math.max(...segments.map(s => s.endTime || s.updatedAt || s.startTime));
    return { ...first, id, meetingId, meetUrl, title: segments.find(s => s.renamed)?.title || first.title,
      status, endTime, updatedAt: Math.max(...segments.map(s => s.updatedAt || s.startTime)),
      duration: (endTime || last.updatedAt || last.startTime) - first.startTime,
      participants: [...new Set(segments.flatMap(s => s.participants))],
      blocks: segments.flatMap(s => s.blocks.map(b => ({ ...b, segmentId: s.id, segmentEndTime: s.endTime || s.updatedAt }))).sort((a, b) => a.timestamp - b.timestamp),
      bookmarks: segments.flatMap(s => turnBookmarks(s).map(b => ({ ...b, segmentId: s.id }))).sort((a, b) => a.timestamp - b.timestamp),
      gaps: segments.flatMap((s, index) => {
        const gaps = (s.gaps || []).map(g => ({ ...g, segmentId: s.id, endTime: g.endTime ?? s.endTime ?? s.updatedAt }));
        const next = segments[index + 1], end = s.endTime || s.updatedAt || s.startTime;
        const interrupted = s.status === "interrupted" || ["navigation", "tab closed"].includes(s.reason);
        if (interrupted) gaps.push({ kind: "interrupted", timestamp: end, endTime: next && next.startTime > end ? next.startTime : null, segmentId: s.id });
        if (s.reason === "stopped") gaps.push({ kind: "stopped", timestamp: s.endTime || s.updatedAt || s.startTime, endTime: null, segmentId: s.id });
        if (s.status === "paused") gaps.push({ kind: "paused", timestamp: s.updatedAt || s.startTime, endTime: null, segmentId: s.id });
        if (!interrupted && next && next.startTime > end) gaps.push({ kind: "paused", timestamp: end, endTime: next.startTime, segmentId: s.id });
        return gaps;
      }).sort((a, b) => a.timestamp - b.timestamp),
      segmentIds: segments.map(s => s.id), segmentCount: segments.length };
  }).sort((a, b) => b.startTime - a.startTime);
}

// Only explicit meeting identities qualify; a reused Meet URL is not a call identity.
export function relatedRecordings(calls) {
  const groups = new Map();
  for (const call of calls) {
    if (!call.meetingId) continue;
    if (!groups.has(call.meetingId)) groups.set(call.meetingId, []);
    groups.get(call.meetingId).push(call);
  }
  for (const [id, members] of groups) if (members.length < 2) groups.delete(id);
  return groups;
}

// Historical recordings have no shared meeting identity. Suggest, never certify,
// matching rooms within 30 minutes, with shared participants or the same tab.
export function possibleRecordings(calls) {
  const rooms = new Map(), groups = new Map();
  const limit = 8 * 60 * 60000;
  const names = call => {
    const selfNames = new Set((call.blocks || []).filter(block => block.isSelf === true).map(block => block.speaker));
    const otherNames = new Set((call.blocks || []).filter(block => block.isSelf !== true).map(block => block.speaker));
    return new Set((call.participants || []).filter(name => !selfNames.has(name) || otherNames.has(name))
      .map(name => name.trim().toLocaleLowerCase()).filter(name => name && !["you", "ти", "вие"].includes(name)));
  };
  const compatible = (a, b) => {
    const left = names(a), right = names(b);
    return left.size && right.size ? [...left].some(name => right.has(name))
      : Number.isInteger(a.tabId) && a.tabId === b.tabId;
  };
  for (const call of calls) {
    if (call.meetingId || !["completed", "interrupted"].includes(call.status) ||
      !Number.isFinite(call.startTime) || !Number.isFinite(call.endTime) ||
      call.endTime < call.startTime || call.endTime - call.startTime > limit ||
      !/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i.test(call.meetUrl || "")) continue;
    const room = call.meetUrl.replace(/\/$/, "").toLowerCase();
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room).push(call);
  }
  const add = group => {
    if (group.length > 1) groups.set(JSON.stringify(group.map(call => call.id).sort()), group);
  };
  for (const members of rooms.values()) {
    members.sort((a, b) => a.startTime - b.startTime);
    let group = [], end = 0;
    for (const call of members) {
      if (group.length && (call.startTime - end > 30 * 60000 ||
        Math.max(end, call.endTime) - group[0].startTime > limit ||
        !group.every(member => compatible(member, call)))) {
        add(group); group = []; end = 0;
      }
      group.push(call); end = Math.max(end, call.endTime);
    }
    add(group);
  }
  return groups;
}

// Place notes beside their stable segment/block anchor, even if live captions grow.
export function transcriptEntries(call) {
  const notes = call.bookmarks || [];
  const entries = [], placed = new Set();
  let turnBlocks = [];
  for (let index = 0; index < call.blocks.length; index++) {
    const block = call.blocks[index], next = call.blocks[index + 1];
    for (const note of notes) {
      if (!placed.has(note.id) && note.blockId == null && note.timestamp <= block.timestamp) {
        entries.push({ note }); placed.add(note.id);
      }
    }
    entries.push({ block }); turnBlocks.push(block);
    const endsTurn = !next || next.speaker !== block.speaker || next.segmentId !== block.segmentId ||
      (call.gaps || []).some(gap => gap.timestamp >= block.timestamp && gap.timestamp <= next.timestamp);
    if (endsTurn) {
      for (const note of notes) {
        if (!placed.has(note.id) && note.blockId != null && turnBlocks.some(b => note.blockId === b.id && note.segmentId === b.segmentId)) {
          entries.push({ note }); placed.add(note.id);
        }
      }
      turnBlocks = [];
    }
  }
  for (const note of notes) if (!placed.has(note.id)) entries.push({ note });
  for (const gap of call.gaps || []) {
    const index = entries.findIndex(entry => (entry.block || entry.note || entry.gap).timestamp >= gap.timestamp);
    if (index < 0) entries.push({ gap });
    else entries.splice(index, 0, { gap });
  }
  return entries;
}
export function gapLabel(gap, formatTime) {
  const label = { stopped: "Recording stopped", paused: "Recording paused / not recorded", captions: "Captions unavailable", interrupted: "Recording interrupted — final moments may be missing" }[gap.kind] || "Recording gap";
  return `${label} · ${formatTime(gap.timestamp)}${gap.endTime != null ? `–${formatTime(gap.endTime)}` : gap.kind === "stopped" ? "" : " · end unknown"}`;
}

// Captions provide an estimate, not audio measurements. Old blocks use 150 words/minute,
// bounded by the next reply, known gaps and the end of their own recording segment.
export function speakingStats(call) {
  const totals = new Map((call.participants || []).map(name => [name, 0]));
  const spans = call.blocks.map((block, index) => {
    const next = call.blocks.slice(index + 1).find(b => b.segmentId === block.segmentId && b.timestamp > block.timestamp);
    const segmentEnd = call.gaps?.find(g => g.segmentId === block.segmentId && g.timestamp >= block.timestamp)?.timestamp;
    const limit = Math.max(0, Math.min(next?.timestamp ?? Infinity, segmentEnd ?? Infinity, block.segmentEndTime || call.endTime || call.updatedAt || Infinity) - block.timestamp);
    let duration = Number.isFinite(block.speechMs) ? Math.max(0, block.speechMs) : block.text.trim().split(/\s+/u).filter(Boolean).length * 400;
    duration = Math.min(duration, limit);
    totals.set(block.speaker, (totals.get(block.speaker) || 0) + duration);
    return { block, duration };
  });
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return { spans, total, participants: [...totals].map(([name, duration]) => ({ name, duration, percent: total ? duration / total * 100 : 0 })) };
}
export function transcriptBody(call, formatTime) {
  return transcriptEntries(call).map(({ block, note, gap }) => gap ? `[RECORDING GAP — ${gapLabel(gap, formatTime)}]` : block
    ? `${block.speaker} — ${formatTime(block.timestamp)}\n${block.text}`
    : `[${note.text.trim() ? "AUTHOR NOTE" : "BOOKMARK"} — ${formatTime(note.timestamp)}]${note.text.trim() ? `\n${note.text.split("\n").map(line => `> ${line}`).join("\n")}` : ""}`
  ).join("\n\n");
}
