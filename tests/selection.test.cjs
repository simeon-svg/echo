const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Small DOM adapter: run the real page's render, checkbox and export handlers.
class Element {
  constructor(tag, text = '', className = '') {
    this.tag = tag; this.textContent = text; this.className = className; this.children = [];
    this.dataset = {}; this.style = { setProperty() {} }; this.events = {}; this.attributes = {};
    this.classList = { add: name => { this.className += ' ' + name; }, remove: name => { this.className = this.className.split(' ').filter(c => c !== name).join(' '); }, toggle: () => {} };
  }
  append(...children) { this.children.push(...children); children.forEach(c => { c.parentNode = this; }); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  before(child) { child.parentNode = this.parentNode || this; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  async fire(name, event = {}) { for (const callback of this.events[name] || []) await callback({ target: this, preventDefault() {}, ...event }); }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tag === selector) ? [child] : [],
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return selector.startsWith(".") && this.className.split(" ").includes(selector.slice(1)) ? this : this.parentNode?.closest(selector) || null; }
  getBoundingClientRect() { return { top: this.top ?? 100, height: 180 }; }
  contains(target) { return this === target || this.children.some(child => child.contains(target)); }
  scrollIntoView(options) { this.scrolled = options; }
  focus() { this.focused = true; }
  click() { return this.fire('click'); }
}
async function page(options = {}) {
  const nodes = new Map();
  const query = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element('div')); return nodes.get(selector); };
  const fixture = { title: 'Test', status: 'completed', startTime: 1, endTime: 10, participants: ['Alice', 'Bob'], blocks: [
    { id: 1, speaker: 'Alice', timestamp: 1, text: 'First sentence.' },
    { id: 2, speaker: 'Alice', timestamp: 2, text: 'Same speaker continuation.' },
    { id: 3, speaker: 'Bob', timestamp: 3, text: 'Exclude this reply.' },
    { id: 4, speaker: 'Alice', timestamp: 4, text: 'Last reply.' },
  ] };
  Object.assign(fixture, options.fixture || {});
  fixture.gaps = options.gaps || [];
  fixture.bookmarks = options.bookmarks || [];
  fixture.hasBackup = !!options.backup;
  const notices = [], requests = [], storageListeners = [], intervals = [];
  let displayName = options.displayName || '';
  let copied = '', downloaded;
  const document = { querySelector: query, querySelectorAll: selector => query('#blocks').querySelectorAll(selector),
    createElement: tag => new Element(tag), body: new Element('body') };
  const browserWindow = new Element("window"); browserWindow.scrollY = 0;
  const context = vm.createContext({ window: browserWindow, initPageShell() {}, document, location: { search: '?id=test' }, URLSearchParams, Blob,
    URL: { createObjectURL: blob => { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} },
    navigator: { clipboard: { writeText: async text => { copied = text; } } },
    request: async (type, values) => {
      requests.push({ type, ...values });
      if (type === 'bookmarkAdd') {
        const note = { id: 'created-'+fixture.bookmarks.length, blockId: values.blockId, segmentId: values.segmentId, timestamp: fixture.blocks.find(b => b.id === values.blockId).timestamp, text: '' };
        fixture.bookmarks.push(note); return structuredClone(note);
      }
      if (type === 'bookmarkUpdate') fixture.bookmarks.find(n => n.id === values.bookmarkId).text = values.text;
      if (type === 'bookmarkDelete') fixture.bookmarks = fixture.bookmarks.filter(n => n.id !== values.bookmarkId);
      return type === "get" ? context.withDisplayName(structuredClone(fixture), displayName) : structuredClone(fixture);
    },
    confirmAction: async () => true, time: String, date: String, minutes: () => 1,
    plainText: call => call.title, isOpen: () => false, statusDot: () => null, notify: message => notices.push(message),
    prepareBackupAccess: async () => { if (options.permissionError) throw new Error(options.permissionError); },
    node: (tag, text, className) => new Element(tag, text, className),
    iconButton: label => { const b = new Element('button'); b.setAttribute('aria-label', label); b.append(new Element('svg')); return b; },
    chrome: { storage: { local: { async get(defaults) { return { ...defaults, ...options.preferences }; } }, onChanged: { addListener: listener => storageListeners.push(listener) } } },
    setInterval(callback) { intervals.push(callback); }, setTimeout() {}, console,
  });
  vm.runInContext(fs.readFileSync('pages/transcript-export.js', 'utf8').replace(/export /g, ''), context);
  vm.runInContext(fs.readFileSync('storage/calls.js', 'utf8').replace(/export /g, ''), context);
  vm.runInContext(fs.readFileSync('pages/transcript.js', 'utf8').replace(/^import .*;\n/gm, ''), context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, query, notices, requests, browserWindow, copied: () => copied, downloaded: () => downloaded,
    turns: () => query('#blocks').querySelectorAll('.speaker-turn'),
    execute: code => vm.runInContext(code, context),
    async changeName(value) {
      const oldValue = displayName; displayName = value;
      storageListeners.forEach(listener => listener({ displayName: { oldValue, newValue: value } }, 'local'));
      await new Promise(resolve => setImmediate(resolve));
    },
    async tick() { intervals.forEach(callback => callback()); await new Promise(resolve => setImmediate(resolve)); },
  };
}
test('opening and rerendering an old interrupted transcript does not announce a new interruption', async () => {
  const p = await page({ fixture: { status: 'interrupted' }, gaps: [{ kind: 'interrupted', timestamp: 10 }] });
  await p.execute('render()');
  assert.deepEqual(p.notices, []);
  assert.match(p.query('#blocks').querySelector('.recording-gap').textContent, /Recording interrupted/);
});

test('an empty interrupted transcript does not show a recovery notification', async () => {
  const p = await page({ fixture: { status: 'interrupted', participants: [], blocks: [] } });
  assert.deepEqual(p.notices, []);
});

test('saved interrupted transcripts have no red status dot or recovered tooltip', () => {
  const context = vm.createContext({ node: (tag, text, className) => new Element(tag, text, className) });
  const source = fs.readFileSync('pages/shared.js', 'utf8');
  vm.runInContext(source.slice(source.indexOf('export function statusDot'), source.indexOf('export function backupStatusDot')).replace('export ', ''), context);
  assert.equal(vm.runInContext('statusDot("interrupted")', context), null);
  assert.equal(vm.runInContext('statusDot("recording").title', context), 'Recording');
});

test('select all then uncheck the middle turn excludes it from both clipboard and TXT', async () => {
  const p = await page();
  await p.execute('selectAll.checked = true; selectAll.fire("change")');
  const middle = p.turns()[1].querySelector('input'); middle.checked = false; await middle.fire('change');
  await p.execute('copySelected.fire("click")');
  assert.match(p.copied(), /First sentence/);
  assert.match(p.copied(), /Same speaker continuation/);
  assert.match(p.copied(), /Last reply/);
  assert.doesNotMatch(p.copied(), /Exclude this reply/);
  await p.execute('downloadSelected.fire("click")');
  assert.equal(await p.downloaded().text(), p.copied());
});
test('selecting only the first turn copies that turn, including all its paragraphs', async () => {
  const p = await page();
  const first = p.turns()[0].querySelector('input'); first.checked = true; await first.fire('change');
  await p.execute('copySelected.fire("click")');
  assert.match(p.copied(), /First sentence/);
  assert.match(p.copied(), /Same speaker continuation/);
  assert.doesNotMatch(p.copied(), /Last reply|Exclude this reply/);
});
test('selection survives render and can be cleared completely', async () => {
  const p = await page();
  for (const index of [0, 2]) {
    const check = p.turns()[index].querySelector('input'); check.checked = true; await check.fire('change');
  }
  p.execute('render()');
  assert.deepEqual(p.turns().map(turn => turn.querySelector('input').checked), [true, false, true]);
  await p.execute('copySelected.fire("click")');
  assert.match(p.copied(), /First sentence/); assert.match(p.copied(), /Last reply/);
  assert.doesNotMatch(p.copied(), /Exclude this reply/);
  await p.execute('selectAll.checked = false; selectAll.fire("change")');
  assert.equal(p.execute('selectedText()'), '');
  assert.equal(p.execute('copySelected.disabled && downloadSelected.disabled'), true);
});


test('Select all updates existing turns instead of rebuilding the transcript DOM', async () => {
  const p = await page();
  const before = p.turns();
  await p.execute('selectAll.checked = true; selectAll.fire("change")');
  assert.equal(p.turns()[0], before[0]);
  assert.ok(p.turns().every(turn => turn.querySelector('input').checked));
});

test('backup preparation errors during deletion are shown to the user', async () => {
  const p = await page({ backup: true, permissionError: 'Folder could not be read' });
  await p.query('#timeline').querySelector('.map-actions').children[2].fire('click');
  assert.deepEqual(p.notices, ['Folder could not be read']);
});


test('speaker selection and section copy include explicitly labelled author notes', async () => {
  const p = await page({ bookmarks: [{ id: 'note', blockId: 1, timestamp: 1, text: 'Private decision\nFollow up' }] });
  assert.equal(p.query('#blocks').querySelectorAll('.author-note').length, 1);
  const first = p.turns()[0].querySelector('input'); first.checked = true; await first.fire('change');
  await p.execute('copySelected.fire("click")');
  assert.match(p.copied(), /\[AUTHOR NOTE — 1\]\n> Private decision\n> Follow up/);
  assert.doesNotMatch(p.copied(), /Exclude this reply/);
  await p.turns()[0].querySelector('.turn-copy').fire('click');
  assert.match(p.copied(), /\[AUTHOR NOTE — 1\]/);
  await p.execute('downloadSelected.fire("click")');
  assert.match(await p.downloaded().text(), /AUTHOR NOTE/);
});


test('conversation map jumps to the actual reply and author note', async () => {
  const p = await page({ bookmarks: [{ id: 'note', blockId: 3, timestamp: 3, text: 'Decision' }] });
  const map = p.query('#timeline');
  const speech = map.querySelector(".map-details").querySelectorAll('.map-speech');
  assert.equal(speech.length, 3);
  await speech[1].fire('click');
  const replies = p.query('#blocks').querySelectorAll('.reply');
  // Tracks group by speaker: third Alice marker navigates to her final reply.
  assert.equal(replies[3].focused, true);
  await map.querySelector('.map-note').fire('click');
  assert.equal(p.query('#blocks').querySelector('.author-note').focused, true);
  assert.equal(map.querySelector('.map-participant').title, 'Alice');
  assert.match(map.querySelector(".map-stat").textContent, /^\d+%$/);
});

test('one speaker turn appears once and fills the map from its first to last words', async () => {
  const p = await page({ fixture: {
    startTime: 0, endTime: 100000, participants: ['You'],
    blocks: [
      { id: 1, speaker: 'You', timestamp: 10000, speechMs: 1000, text: 'First' },
      { id: 2, speaker: 'You', timestamp: 20000, speechMs: 1000, text: 'Second' },
      { id: 3, speaker: 'You', timestamp: 30000, speechMs: 1000, text: 'Third' },
    ],
  }});
  assert.equal(p.turns().length, 1);
  const marks = p.query('#timeline').querySelector('.map-details').querySelectorAll('.map-speech');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].style.left, '0%');
  assert.equal(marks[0].style.width, '100%');
});

test('speech tracks end at the last words and preserve silence inside the conversation', async () => {
  const p = await page({ fixture: {
    startTime: 1000, endTime: 101000, participants: ['Alice', 'Simeon Zhelev'],
    blocks: [
      { id: 1, speaker: 'Alice', timestamp: 1000, speechMs: 20000, text: 'Opening' },
      { id: 2, speaker: 'Simeon Zhelev', timestamp: 91000, speechMs: 1000, text: 'Yes' },
    ],
  }});
  const rows = p.query('#timeline').querySelector('.map-details').querySelectorAll('.map-row');
  const first = rows[0].querySelector('.map-speech'), last = rows[1].querySelector('.map-speech');
  assert.equal(parseFloat(first.style.width), 20000 / 91000 * 100);
  assert.equal(parseFloat(last.style.left), 90000 / 91000 * 100);
  assert.ok(Math.abs(parseFloat(last.style.width) - 1000 / 91000 * 100) < 1e-12, 'the final reply keeps its actual duration');
  assert.equal(parseFloat(last.style.left) + parseFloat(last.style.width), 100, 'recording time after the last words is trimmed');
  const combined = p.query('#timeline').querySelector('.map-combined').querySelectorAll('.map-speech');
  assert.deepEqual(combined.map(mark => mark.style.width), [first.style.width, last.style.width]);
});

test('known gaps split same-speaker turns and survive selected exports', async () => {
  const p = await page({ gaps: [{ kind: 'captions', timestamp: 2, endTime: 2 }] });
  assert.equal(p.turns().length, 4);
  assert.match(p.query('#blocks').querySelector('.recording-gap').textContent, /Captions unavailable/);
  await p.execute('selectAll.checked = true; selectAll.fire("change")');
  await p.execute('copySelected.fire("click")');
  assert.match(p.copied(), /RECORDING GAP.*Captions unavailable/);
  assert.equal(p.query('#timeline').querySelector('.map-gap-label').textContent, 'Gaps');
  await p.query('#timeline').querySelector('.map-gap').fire('click');
  assert.equal(p.query('#blocks').querySelector('.recording-gap').focused, true);
});


test('map ranks speakers by participation, shows four, and expands the rest', async () => {
  const p = await page({ fixture: {
    startTime: 0, endTime: 100000, participants: ['A','B','C','D','E','F'],
    blocks: ['A','B','C','D','E','F'].map((speaker, i) => ({ id:i, speaker, timestamp:i*10000, speechMs:(i+1)*1000, text:'Speech' }))
  }});
  const details = p.query('#timeline').querySelector('.map-details');
  const rows = details.querySelectorAll('.map-row');
  assert.deepEqual(rows.map(row => row.querySelector('.map-speaker-name').textContent), ['F','E','D','C','B','A']);
  assert.deepEqual(rows.map(row => !!row.hidden), [false,false,false,false,true,true]);
  const more = details.querySelector('.map-more');
  await more.fire('click');
  assert.ok(rows.every(row => !row.hidden));
  assert.equal(more.attributes['aria-expanded'], 'true');
  p.execute('render()');
  assert.ok(p.query('#timeline').querySelector('.map-details').querySelectorAll('.map-extra').every(row => !row.hidden));
});

test('many notes occupy one timeline row with timestamps and previews on markers', async () => {
  const p = await page({ bookmarks: Array.from({ length: 12 }, (_, i) => ({ id: 'n'+i, timestamp:i, text:'Note '+i })) });
  const details = p.query('#timeline').querySelector('.map-details');
  assert.equal(details.querySelectorAll('.map-notes').length, 1);
  const notes = details.querySelector('.map-notes').querySelectorAll('.map-note');
  assert.equal(notes.length, 12);
  assert.match(notes[5].title, /5 · Note 5/);
  assert.ok(notes.every(note => note.querySelector('svg')));
});

test('sticky map opens on hover or button, then downward scroll collapses even under the pointer', async () => {
  const p = await page();
  const map = p.query('#timeline');
  p.query('#timeline-start').top = 0;
  p.browserWindow.scrollY = 100;
  await p.browserWindow.fire('scroll');
  assert.equal(map.dataset.compact, 'true');
  const header = map.querySelector('.map-header');
  assert.equal(header.children[0], map.querySelector('.map-toggle'));
  assert.equal(header.children.at(-1), map.querySelector('.map-actions'));
  assert.equal(map.querySelector('.map-details').hidden, true);
  await map.fire('pointerenter', { pointerType: 'mouse' });
  assert.equal(map.dataset.compact, 'false');
  p.browserWindow.scrollY = 120; await p.browserWindow.fire('scroll');
  assert.equal(map.dataset.compact, 'true');
  await map.querySelector('.map-toggle').fire('click');
  assert.equal(map.dataset.compact, 'false');
  await map.fire('pointerleave');
  assert.equal(map.dataset.compact, 'false', 'button expansion remains until scrolling');
  p.browserWindow.scrollY = 130; await p.browserWindow.fire('scroll');
  assert.equal(map.dataset.compact, 'true');
  p.query('#timeline-start').top = 30;
  p.browserWindow.scrollY = 0; await p.browserWindow.fire('scroll');
  assert.equal(map.dataset.sticky, 'false');
  assert.equal(map.querySelector('.map-details').hidden, false);
  assert.equal(p.query('#timeline-spacer').style.height, '0px');
});


test('reply bookmark saves a marker without opening the personal note editor', async () => {
  const p = await page();
  await p.turns()[0].querySelector('.turn-bookmark').fire('click');
  const card = p.query('#blocks').querySelector('.author-note');
  assert.equal(card.querySelector('.note-form'), null);
  assert.ok(card.querySelector('.note-add'));
  assert.equal(p.execute('noteEditing'), false);
  await card.querySelector('.note-add').fire('click');
  assert.ok(card.querySelector('textarea'));
  const area = card.querySelector('textarea'); area.value = 'Keep the decision';
  await card.querySelector('.note-save').fire('click');
  const saved = p.query('#blocks').querySelector('.author-note');
  assert.equal(saved.querySelector('.note-text').textContent, 'Keep the decision');
  assert.ok(saved.querySelector('.bookmark-delete'));
  assert.equal(saved.querySelector('.note-delete'), null);
  assert.ok(saved.querySelector('.note-edit'));
  assert.equal(saved.querySelectorAll('button').length, 2, 'only edit note and delete bookmark');
  await p.query('#blocks').querySelector('.bookmark-delete').fire('click');
  assert.equal(p.query('#blocks').querySelector('.author-note'), null);
  assert.equal(p.requests.at(-2).type, 'bookmarkDelete');
});

test('speaker section action only adds a bookmark; Add Note explicitly opens its editor', async () => {
  const p = await page();
  assert.equal(p.turns()[0].querySelector('.turn-note'), null);
  await p.turns()[0].querySelector('.turn-bookmark').fire('click');
  assert.equal(p.execute('noteEditing'), false);
  const card = p.query('#blocks').querySelector('.author-note');
  assert.equal(card.querySelector('.note-add').textContent, 'Add Note');
  await card.querySelector('.note-add').fire('click');
  assert.equal(p.execute('noteEditing'), true);
  assert.ok(card.querySelector('.note-form'));
  await card.querySelector('.note-cancel').fire('click');
  assert.equal(p.execute('noteEditing'), false);
  assert.ok(p.query('#blocks').querySelector('.author-note').querySelector('.note-add'));
});


test('a personal-name change refreshes every speaker surface in an already open completed transcript', async () => {
  const p = await page({ fixture: { participants: ['You', 'Bob'], blocks: [
    { id: 1, speaker: 'You', isSelf: true, timestamp: 1, text: 'My reply' },
    { id: 2, speaker: 'Bob', isSelf: false, timestamp: 2, text: 'Their reply' },
  ] } });
  assert.equal(p.turns()[0].querySelector('h2').textContent, 'You');
  await p.changeName('Симеон Голд');
  assert.equal(p.turns()[0].querySelector('h2').textContent, 'Симеон Голд');
  assert.equal(p.turns()[0].querySelector('.avatar').textContent, 'СГ');
  assert.equal(p.turns()[0].querySelector('.speaker-check').attributes['aria-label'], 'Select Симеон Голд section');
  assert.equal(p.turns()[1].querySelector('h2').textContent, 'Bob');
  const map = p.query('#timeline');
  assert.ok(map.querySelectorAll('.map-speaker-name').some(label => label.textContent === 'Симеон Голд'));
  assert.ok(map.querySelectorAll('.map-speech').some(mark => (mark.attributes['aria-label'] || '').includes('Симеон Голд')));
  await p.changeName('');
  assert.equal(p.turns()[0].querySelector('h2').textContent, 'You');
  assert.equal(p.turns()[0].querySelector('.avatar').textContent, 'Y');
});


test('personal-name refresh waits until an unfinished note draft is no longer being edited', async () => {
  const p = await page({ fixture: { participants: ['You'], blocks: [
    { id: 1, speaker: 'You', timestamp: 1, text: 'My reply' },
  ] } });
  p.execute('noteEditing = true');
  await p.changeName('Симеон');
  await p.tick();
  assert.equal(p.turns()[0].querySelector('h2').textContent, 'You');
  p.execute('noteEditing = false');
  await p.tick();
  assert.equal(p.turns()[0].querySelector('h2').textContent, 'Симеон');
});


test('AI prompt is prepended once to copied speaker sections and selected TXT exports', async () => {
  const preferences = { includeAiPrompt: true, aiPrompt: 'Summarize this meeting.' };
  const p = await page({ preferences });
  await p.turns()[0].querySelector('.turn-copy').fire('click');
  assert.ok(p.copied().startsWith('Summarize this meeting.\n\n---\n\nTranscript:\n\n'));
  assert.match(p.copied(), /First sentence/);
  await p.execute('selectAll.checked = true; selectAll.fire("change")');
  await p.execute('copySelected.fire("click")');
  await p.execute('downloadSelected.fire("click")');
  assert.equal(await p.downloaded().text(), p.copied());
  assert.equal(p.copied().split('Summarize this meeting.').length, 2);
  preferences.aiPrompt = 'Updated prompt';
  await p.execute('copySelected.fire("click")');
  assert.ok(p.copied().startsWith('Updated prompt\n'));
  preferences.includeAiPrompt = false;
  await p.execute('copySelected.fire("click")');
  assert.doesNotMatch(p.copied(), /Updated prompt|Transcript:/);
});


test('whole transcript copy and download apply the AI prompt in the details page', async () => {
  const p = await page({ preferences: { includeAiPrompt: true, aiPrompt: 'Summarize the call' } });
  const actions = await p.execute('transcriptActions()');
  await actions.children[0].fire('click');
  await actions.children[1].fire('click');
  assert.equal(p.copied(), 'Summarize the call\n\n---\n\nTranscript:\n\nTest');
  assert.equal(await p.downloaded().text(), p.copied());
});
