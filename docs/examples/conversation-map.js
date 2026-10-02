// Local preview fixture. Uses the real transcript page without writing to Echo storage.
const participants = ['Simeon Zhelev', 'Kevin Wilgenbusch', 'Jacob Wessel', 'Alexandra Petrova', 'Daniel Ivanov', 'Maria Georgieva', 'Christopher Alexander Anderson', 'Elena Dimitrova'];
const percentages = [28, 20, 16, 12, 9, 7, 5, 3];
const startTime = new Date('2026-10-01T14:00:00Z').getTime();
const blocks = [];
let timestamp = startTime;
for (let round = 0; round < 5; round++) {
  const order = round % 2 ? [3, 0, 5, 1, 7, 2, 6, 4] : [0, 2, 1, 4, 3, 6, 5, 7];
  for (const speaker of order) {
    const speechMs = percentages[speaker] * 1200000 / 100 / 5;
    blocks.push({ id: blocks.length + 1, segmentId: 'demo', speaker: participants[speaker], timestamp, speechMs,
      text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.' });
    timestamp += speechMs;
  }
}
const call = {
  id: 'conversation-map-demo', title: 'Conversation map demo · 8 participants · 20 minutes',
  status: 'completed', startTime, endTime: timestamp, updatedAt: timestamp,
  participants, blocks, gaps: [],
  bookmarks: [3, 9, 15, 22, 29, 36].map((blockId, i) => ({
    id: `demo-note-${i}`, blockId, segmentId: 'demo', timestamp: blocks[blockId - 1].timestamp,
    text: i % 2 ? '' : 'Lorem ipsum — example note.',
  })),
};
globalThis.chrome = { runtime: { async sendMessage(message) {
  if (message.type === 'list') return { ok: true, value: [structuredClone(call)] };
  if (message.type === 'rename') call.title = message.title;
  if (message.type === 'bookmarkAdd') {
    const block = blocks.find(block => block.id === message.blockId);
    let note = call.bookmarks.find(note => note.blockId === block.id);
    if (!note) {
      note = { id: crypto.randomUUID(), blockId: block.id, segmentId: 'demo', timestamp: block.timestamp, text: '' };
      call.bookmarks.push(note);
    }
    return { ok: true, value: structuredClone(note) };
  }
  if (message.type === 'bookmarkUpdate') call.bookmarks.find(note => note.id === message.bookmarkId).text = message.text;
  if (message.type === 'bookmarkDelete') call.bookmarks = call.bookmarks.filter(note => note.id !== message.bookmarkId);
  if (message.type === 'delete') return { ok: false, error: 'This is a preview. Reload the page to reset the example.' };
  return { ok: true, value: structuredClone(call) };
} } };
await import('../../pages/transcript.js');
document.querySelectorAll('a.back, a.settings-link').forEach(link => link.hidden = true);
