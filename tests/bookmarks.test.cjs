const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function widget() {
  const timers = new Map(); let next = 0;
  class Element {
    constructor() { this.children = []; this.attributes = {}; this.dataset = {}; this.events = {}; this.value = ''; this.focusCount = 0; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    attachShadow() { return new Element(); }
    addEventListener(name, callback) { this.events[name] = callback; }
    focus() { this.focusCount++; this.events.focus?.(); }
  }
  const context = vm.createContext({
    document: { addEventListener() {}, createElement: () => new Element(), createElementNS: () => new Element(), documentElement: new Element() },
    window: { addEventListener() {} },
    setTimeout(fn, milliseconds) { assert.ok([1500, 5000].includes(milliseconds)); timers.set(++next, { fn, milliseconds }); return next; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(fs.readFileSync('content/overlay.js', 'utf8'), context);
  const overlay = context.createMeetOverlay();
  const footer = overlay.noteEditor.children[2];
  return { ...overlay, done: footer.children[2], retry: footer.children[1], noteStatus: footer.children[0], close: overlay.noteEditor.children[0].children[1], saved: overlay.noteEditor.children[0].children[0],
    expire(milliseconds) { for (const [id, timer] of [...timers]) { if (milliseconds != null && timer.milliseconds !== milliseconds) continue; timers.delete(id); timer.fn(); } },
    drain: () => new Promise(resolve => setImmediate(resolve)) };
}

test('optional note hides after five seconds without taking focus, but focused or typed notes remain', async () => {
  const w = widget();
  w.showNote(async () => {});
  assert.equal(w.noteEditor.hidden, false);
  assert.equal(w.noteInput.focusCount, 0);
  w.expire();
  assert.equal(w.noteEditor.hidden, true);
  assert.equal(w.bookmark.focusCount, 0);
  w.showNote(async () => {});
  w.noteInput.focus(); w.expire();
  assert.equal(w.noteEditor.hidden, false);
  w.done.events.click();
  assert.equal(w.noteEditor.hidden, true);
  w.showNote(async () => {});
  w.noteInput.value = 'Keep my draft'; w.noteInput.events.input();
  w.expire(); await w.drain();
  assert.equal(w.noteEditor.hidden, false);
  assert.equal(w.noteStatus.textContent, 'Saved privately');
  w.showNote(async () => {}, true);
  assert.equal(w.noteInput.focusCount, 2, 'keyboard activation focuses the editor');
});

test('failed saves retain the note and serialize retry before dismissing', async () => {
  const w = widget(); const texts = []; let failing = true;
  w.showNote(async text => { texts.push(text); if (failing) throw new Error('offline'); });
  w.noteInput.value = 'Do not lose this'; w.noteInput.events.input();
  w.done.events.click();
  assert.equal(w.noteEditor.hidden, false, 'pending writes cannot be dismissed');
  await w.drain(); w.done.events.click();
  assert.equal(w.noteEditor.hidden, false, 'failed writes stay editable');
  assert.equal(w.retry.hidden, false);
  failing = false; w.retry.events.click(); await w.drain();
  assert.deepEqual(texts, ['Do not lose this', 'Do not lose this']);
  assert.equal(w.retry.hidden, true);
  w.done.events.click(); assert.equal(w.noteEditor.hidden, true);
});

test('clipboard and TXT preserve segment anchors with repeated block IDs and quote author text', () => {
  const context = vm.createContext({ Date });
  vm.runInContext(fs.readFileSync('storage/calls.js', 'utf8').replace(/export /g, ''), context);
  vm.runInContext(fs.readFileSync('pages/shared.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
  const common = { title: 'Call', startTime: 1000, endTime: 4000, updatedAt: 4000, status: 'completed', participants: ['A'] };
  context.sessions = [
    { ...common, id: 'a', callId: 'merged', blocks: [{ id: 1, timestamp: 1000, speaker: 'A', text: 'First reply' }], bookmarks: [] },
    { ...common, id: 'b', callId: 'merged', startTime: 2000, blocks: [{ id: 1, timestamp: 2000, speaker: 'A', text: 'Second reply' }],
      bookmarks: [{ id: 'n', blockId: 1, timestamp: 2001, text: 'Decision\nAlice — this is still my note' }] },
  ];
  const text = vm.runInContext('plainText(groupCalls(sessions)[0])', context);
  assert.ok(text.indexOf('Second reply') < text.indexOf('[AUTHOR NOTE'));
  assert.match(text, /\[AUTHOR NOTE — .*\]\n> Decision\n> Alice — this is still my note/);
  assert.doesNotMatch(text, /\nAlice — this is still my note/);
});


test('bookmark panel replaces notifications and restores its saved text when switching back', async () => {
  const w = widget(); const saved = [];
  const notifications = w.panel.children.find(child => child.className === 'notifications');
  w.notificationToggle.events.click(); assert.equal(notifications.hidden, false);
  w.showNote(async text => saved.push(text));
  assert.equal(notifications.hidden, true);
  assert.equal(w.notificationToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(w.saved.textContent, 'Bookmark saved');
  assert.equal(w.noteStatus.textContent, '');
  w.noteInput.value = 'Keep this note'; w.noteInput.events.input();
  w.notificationToggle.events.click();
  assert.equal(w.noteEditor.hidden, true); assert.equal(notifications.hidden, false);
  assert.equal(w.bookmark.getAttribute('aria-expanded'), 'false');
  await w.drain();
  assert.deepEqual(saved, ['Keep this note']);
  assert.equal(w.resumeNote(), true);
  assert.equal(notifications.hidden, true); assert.equal(w.noteEditor.hidden, false);
  assert.equal(w.noteInput.value, 'Keep this note');
  w.expire(5000); assert.equal(w.noteEditor.hidden, false);
  w.close.events.click(); assert.equal(w.noteEditor.hidden, true);
});

test('bookmark icon fills for 1.5 seconds after saving and then returns to its outline', () => {
  const w = widget();
  const outline = w.bookmark.children[0].children[0].getAttribute('d');
  w.showNote(async () => {});
  assert.equal(w.bookmark.dataset.saved, 'true');
  assert.notEqual(w.bookmark.children[0].children[0].getAttribute('d'), outline);
  w.expire(1500);
  assert.equal(w.bookmark.dataset.saved, 'false');
  assert.equal(w.bookmark.children[0].children[0].getAttribute('d'), outline);
  assert.equal(w.noteEditor.hidden, false, 'icon feedback does not dismiss the note');
  w.showNote(async () => {}); w.expire(1500);
  assert.equal(w.bookmark.dataset.saved, 'false', 'feedback also works for subsequent bookmarks');
});


test('top-right close preserves a failed note for reopening and retry', async () => {
  const w = widget();
  w.showNote(async () => { throw new Error('offline'); });
  w.noteInput.value = 'Recover this draft'; w.noteInput.events.input();
  await w.drain();
  w.close.events.click(); assert.equal(w.noteEditor.hidden, true);
  assert.equal(w.resumeNote(), true);
  assert.equal(w.noteInput.value, 'Recover this draft');
  assert.equal(w.retry.hidden, false);
});


test('live bookmark confirms saving and waits for an explicit Add Note click', async () => {
  const w = widget(); const saved = [];
  w.showBookmark(async text => saved.push(text));
  assert.equal(w.noteEditor.hidden, false);
  assert.equal(w.noteInput.hidden, true);
  assert.equal(w.noteAdd.hidden, false);
  assert.equal(w.noteInput.focusCount, 0);
  assert.equal(w.noteAdd.textContent, "Add Note");
  w.noteAdd.events.click();
  assert.equal(w.noteInput.hidden, false);
  assert.equal(w.noteAdd.hidden, true);
  assert.equal(w.noteInput.focusCount, 1);
  w.expire(5000); assert.equal(w.noteEditor.hidden, false);
  w.noteInput.value = 'Optional note'; w.noteInput.events.input(); await w.drain();
  assert.deepEqual(saved, ['Optional note']);
});
