const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(tag, text = '', className = '') {
    this.tag = tag; this.textContent = text; this.className = className;
    this.children = []; this.events = {}; this.dataset = {}; this.attributes = {};
    this.value = ''; this.classList = { toggle() {}, add: name => { this.className += ' ' + name; } };
  }
  append(...children) { this.children.push(...children); children.forEach(child => { child.parent = this; }); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  focus() { this.focused = true; }
  click() {}
  addEventListener(name, callback) { this.events[name] = callback; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...((selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tag === selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  contains() { return false; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
}
const recording = (id, meetingId = 'meeting', status = 'completed') => ({
  id, meetingId, title: id, status, startTime: 1, endTime: 2,
  participants: [], blocks: [], meetUrl: 'https://meet.google.com/abc-defg-hij',
});
async function page(initial, options = {}) {
  let calls = initial;
  const nodes = new Map(), requests = [], notices = [];
  let notificationHandler, copied = '', downloaded;
  const documentEvents = {}, windowEvents = {};
  const query = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new Element('div'));
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: query, body: new Element('body'), addEventListener: (name, callback) => { documentEvents[name] = callback; } }, window: { addEventListener: (name, callback) => { windowEvents[name] = callback; } },
    node: (tag, text, className) => new Element(tag, text, className),
    iconButton: label => new Element('button', label),
    isOpen: call => ['recording', 'paused'].includes(call.status),
    statusDot: () => null, backupStatusDot: () => null,
    shortDate: () => 'Oct 1', time: () => '12:00', minutes: () => 1,
    notify: (text, kind) => { notices.push(text); notificationHandler?.(text, kind); },
    setNotificationHandler: handler => { notificationHandler = handler; },
    prepareBackupAccess: async () => {},
    requestBackupAccess: async () => {},
    confirmMerge: () => { throw new Error('Related merge must require only one click'); },
    request: async (type, data) => {
      if (type === 'list') return structuredClone(calls);
      requests.push({ type, ...data });
      if (options.gate) await options.gate;
      if (options.error) throw new Error(options.error);
      if (type === 'delete') { calls = calls.filter(call => call.id !== data.id); return { backupWarning: null }; }
      calls = [recording('merged', data.relatedMeetingId || null), ...calls.filter(call => !data.ids.includes(call.id))];
      return { id: 'merged', backupWarning: null };
    },
    plainText: call => call.title,
    navigator: { clipboard: { writeText: async text => { copied = text; if (options.clipboardError) throw new Error(options.clipboardError); } } },
    URL: { createObjectURL: blob => { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} }, Blob, setTimeout() {},
    confirmDeletion: async () => ({ confirmed: true, deleteBackup: false }),
    location: { search: options.search || "" }, URLSearchParams, sessionStorage: options.storage,
    chrome: { storage: { local: { async get(defaults) { return { ...defaults, ...options.preferences }; } } } },
    setInterval() {}, console,
  });
  vm.runInContext(fs.readFileSync('pages/transcript-export.js', 'utf8').replace(/export /g, ''), context);
  query('#notifications-panel').hidden = true;
  vm.runInContext(fs.readFileSync('pages/notification-center.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
  vm.runInContext(fs.readFileSync('storage/calls.js', 'utf8').replace(/export /g, ''), context);
  vm.runInContext(fs.readFileSync('pages/merge-review.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
  vm.runInContext(fs.readFileSync('pages/page-shell.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
  if (options.internal) vm.runInContext('const notificationCenter = initPageShell();', context);
  else vm.runInContext(fs.readFileSync('pages/transcripts.js', 'utf8').replace(/^import .*;\n/gm, ''), context);
  await new Promise(resolve => setImmediate(resolve));
  return { copied: () => copied, downloaded: () => downloaded, query, requests, notices, documentEvents, windowEvents, location: context.location, replaceCalls: fresh => { calls = fresh; },
    hints: () => query('#list').querySelectorAll('.call-relationship'),
    rows: () => query('#list').querySelectorAll('.call-row'),
    dialogs: () => context.document.body.querySelectorAll('dialog'),
    buttons: () => query('#list').querySelectorAll('.related-merge'),
    execute: code => vm.runInContext(code, context),
  };
}

test('listing keeps separate rows and merges a certain same-call relationship with one click', async () => {
  const p = await page([recording('one'), recording('other', 'another'), recording('two')]);
  assert.equal(p.hints().length, 2);
  assert.equal(p.query('#list').children.length, 3, 'every recording stays a separate list row');
  assert.deepEqual(p.rows().map(row => row.dataset.id), ['one', 'other', 'two'], 'relationships preserve listing order');
  assert.equal(p.buttons()[0].textContent, 'Merge');
  await p.buttons()[0].events.click();
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].type, 'merge');
  assert.deepEqual(Array.from(p.requests[0].ids), ['one', 'two']);
  assert.equal(p.requests[0].relatedMeetingId, 'meeting');
  assert.equal(p.requests[0].deleteBackups, false);
  assert.equal(p.hints().length, 0);
  assert.equal(p.query('#list').querySelectorAll('.call-row').length, 2);
});

test('search keeps the full group count and merges related entries hidden by search', async () => {
  const p = await page([recording('one'), recording('two'), recording('three')]);
  p.query('#search').value = 'one';
  p.execute('render()');
  assert.equal(p.rows().length, 1);
  assert.equal(p.hints()[0].children[0].textContent, 'Same call · 3 recordings');
  await p.buttons()[0].events.click();
  assert.deepEqual(Array.from(p.requests[0].ids), ['one', 'two', 'three']);
});

test('same URL alone does not group legacy transcripts or different meetings', async () => {
  const p = await page([recording('one', null), recording('two', null), recording('three', 'third'), recording('four', 'fourth')]);
  assert.equal(p.hints().length, 0);
});

test('related merge stays disabled while any group member is recording', async () => {
  const p = await page([recording('one'), recording('two', 'meeting', 'recording')]);
  assert.equal(p.buttons()[0].disabled, true);
  await p.buttons()[0].events.click();
  assert.equal(p.requests.length, 0);
});

test('slow merges prevent double submissions and failures keep entries available', async () => {
  let release;
  const options = { gate: new Promise(resolve => { release = resolve; }), error: 'Storage failed' };
  const p = await page([recording('one'), recording('two')], options);
  const merge = p.buttons()[0].events.click();
  assert.equal(p.buttons()[0].disabled, true);
  await p.buttons()[0].events.click();
  assert.equal(p.requests.length, 1);
  release(); await merge;
  assert.equal(p.buttons()[0].disabled, false);
  assert.equal(p.rows().length, 2);
  assert.deepEqual(p.notices, ['Storage failed']);
});


const historical = (id, start = 0, end = start + 60000) => ({
  ...recording(id, null), startTime: start, endTime: end, participants: ['Alice'], tabId: 7,
});
function inference(calls) {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync('storage/calls.js', 'utf8').replace(/export /g, ''), context);
  return context.possibleRecordings(calls);
}

test('historical inference requires the same room, nearby times and participant or tab evidence', () => {
  assert.equal(inference([historical('one'), historical('two', 120000)]).size, 1);
  assert.equal(inference([historical('one'), historical('two', 32 * 60000)]).size, 0);
  assert.equal(inference([historical('one'), { ...historical('two', 120000), meetUrl: 'https://meet.google.com/xyz-abcd-efg' }]).size, 0);
  assert.equal(inference([historical('one'), { ...historical('two', 120000), participants: ['Bob'] }]).size, 0);
  assert.equal(inference([{ ...historical('one'), participants: [] }, { ...historical('two', 120000), participants: [] }]).size, 1);
  assert.equal(inference([{ ...historical('one'), participants: ['You'] }, { ...historical('two', 120000), participants: ['You'], tabId: 8 }]).size, 0);
  assert.equal(inference([historical('one'), { ...historical('two', 120000), meetingId: 'known' }]).size, 0);
  assert.equal(inference([historical('one'), { ...historical('two', 120000), endTime: null }]).size, 0);
});

test('historical inference does not chain unrelated participants or span distant calls', () => {
  assert.equal(inference([
    historical('one'), { ...historical('two', 120000), participants: ['Alice', 'Bob'] },
    { ...historical('three', 240000), participants: ['Bob'] },
  ]).values().next().value.length, 2);
  assert.equal(inference([historical('one'), historical('two', 0, 9 * 60 * 60000)]).size, 0);
});

test('historical Review preselects entries and merges only the chosen recordings', async () => {
  const p = await page([historical('one'), historical('two', 120000), historical('three', 240000)]);
  assert.equal(p.buttons()[0].textContent, 'Review');
  assert.match(p.hints()[0].children[0].textContent, /Possible same call/);
  const review = p.buttons()[0].events.click();
  assert.equal(p.requests.length, 0, 'opening review never performs a merge');
  const dialog = p.dialogs()[0];
  const checks = dialog.querySelectorAll('input');
  assert.ok(checks.every(check => check.checked));
  checks[2].checked = false; checks[2].events.change();
  const merge = dialog.querySelectorAll('button').find(button => button.textContent.startsWith('Merge selected'));
  assert.equal(merge.textContent, 'Merge selected (2)');
  merge.events.click(); await review;
  assert.deepEqual(Array.from(p.requests[0].ids).sort(), ['one', 'two']);
  assert.ok(p.requests[0].possibleGroupKey);
  assert.equal(p.requests[0].deleteBackups, false);
  assert.ok(p.rows().some(row => row.dataset.id === 'three'));
});

test('review prevents merging one entry and Cancel or Escape leaves all entries intact', async () => {
  const p = await page([historical('one'), historical('two', 120000)]);
  let review = p.buttons()[0].events.click();
  let dialog = p.dialogs()[0];
  const checks = dialog.querySelectorAll('input');
  checks[1].checked = false; checks[1].events.change();
  const merge = dialog.querySelectorAll('button').find(button => button.textContent.startsWith('Merge selected'));
  assert.equal(merge.disabled, true);
  merge.events.click();
  assert.equal(p.requests.length, 0);
  dialog.querySelectorAll('button').find(button => button.textContent === 'Cancel').events.click();
  await review;
  assert.equal(p.rows().length, 2);
  review = p.buttons()[0].events.click(); dialog = p.dialogs()[0];
  dialog.events.cancel({ preventDefault() {} }); await review;
  assert.equal(p.requests.length, 0);
  assert.equal(p.dialogs().length, 0);
});

test('pagination shows 20 calls per page, numbered controls and disabled boundary arrows', async () => {
  const p = await page(Array.from({ length: 45 }, (_, i) => recording(`call-${i}`, null)));
  const pager = p.query('#pagination');
  const button = label => pager.children.find(child => child.attributes['aria-label'] === label);
  assert.equal(p.rows().length, 20);
  assert.equal(button('Previous page').disabled, true);
  assert.equal(button('Page 1').attributes['aria-current'], 'page');
  button('Next page').events.click();
  assert.deepEqual(p.rows().map(row => row.dataset.id), Array.from({ length: 20 }, (_, i) => `call-${i + 20}`));
  assert.equal(button('Page 2').attributes['aria-current'], 'page');
  assert.equal(button('Next page').focused, true);
  button('Page 3').events.click();
  assert.equal(p.rows().length, 5);
  assert.equal(button('Next page').disabled, true);
  button('Previous page').events.click();
  assert.equal(p.rows()[0].dataset.id, 'call-20');
});

test('search covers every page and resets pagination, including no results and empty history', async () => {
  const calls = Array.from({ length: 41 }, (_, i) => recording(`call-${i}`, null));
  calls[40].blocks = [{ text: 'unique transcript phrase' }];
  const p = await page(calls);
  p.query('#pagination').children.find(child => child.attributes['aria-label'] === 'Page 3').events.click();
  p.query('#search').value = 'unique transcript phrase';
  p.query('#search').events.input();
  assert.deepEqual(p.rows().map(row => row.dataset.id), ['call-40']);
  assert.equal(p.query('#pagination').hidden, true);
  p.query('#search').value = 'nothing matches';
  p.query('#search').events.input();
  assert.equal(p.rows().length, 0);
  assert.equal(p.query('#message').textContent, 'No matching calls.');
  p.query('#search').value = '';
  p.query('#search').events.input();
  assert.equal(p.rows()[0].dataset.id, 'call-0');
  const empty = await page([]);
  assert.equal(empty.query('#message').textContent, 'No calls yet. Join a Google Meet call to begin.');
  assert.equal(empty.query('#pagination').hidden, true);
});

test('cross-page selection survives navigation and shrinking history clamps to the last page', async () => {
  const p = await page(Array.from({ length: 21 }, (_, i) => recording(`call-${i}`, null)));
  const first = p.query('#list').querySelectorAll('input')[0];
  first.checked = true; first.events.change();
  p.query('#pagination').children.find(child => child.attributes['aria-label'] === 'Next page').events.click();
  const last = p.query('#list').querySelectorAll('input')[0];
  last.checked = true; last.events.change();
  assert.equal(p.query('#selection-count').textContent, '2 selected');
  p.query('#pagination').children.find(child => child.attributes['aria-label'] === 'Previous page').events.click();
  assert.equal(p.query('#list').querySelectorAll('input')[0].checked, true);
  p.execute('currentPage = 2; sessions = sessions.slice(0, 20); render();');
  assert.equal(p.rows().length, 20);
  assert.equal(p.rows()[0].dataset.id, 'call-0');
  assert.equal(p.query('#pagination').hidden, true);
  assert.equal(p.query('#selection-count').textContent, '1 selected');
});

test('large histories use a bounded page window and related actions remain available on later pages', async () => {
  const calls = Array.from({ length: 2000 }, (_, i) => recording(`call-${i}`, null));
  calls[0].meetingId = calls[21].meetingId = 'same-call';
  const p = await page(calls);
  p.execute('currentPage = 50; render();');
  const pager = p.query('#pagination');
  assert.deepEqual(pager.children.filter(child => child.tag === 'button').map(child => child.textContent), ['←', '1', '49', '50', '51', '100', '→']);
  p.execute('currentPage = 2; render();');
  assert.equal(p.buttons().length, 1);
  await p.buttons()[0].events.click();
  assert.deepEqual(Array.from(p.requests[0].ids), ['call-0', 'call-21']);
});

test('notification history retains messages, tracks unread activity, and closes with Escape', async () => {
  const p = await page([]);
  p.execute('notify("Transcript copied."); notify("Download started.");');
  assert.equal(p.query('#notifications-badge').textContent, '2');
  assert.equal(p.query('#notifications-panel').hidden, true);
  assert.equal(p.query('#notifications-feed').querySelectorAll('.notification-entry').length, 2);
  p.query('#notifications-toggle').events.click();
  assert.equal(p.query('#notifications-panel').hidden, false);
  assert.equal(p.query('#notifications-toggle').attributes['aria-expanded'], 'true');
  assert.equal(p.query('#notifications-badge').hidden, true);
  p.execute('notify("Conversation deleted.");');
  assert.equal(p.query('#notifications-feed').querySelectorAll('.notification-entry').length, 3);
  assert.equal(p.query('#notifications-badge').hidden, true);
  p.documentEvents.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(p.query('#notifications-panel').hidden, true);
  assert.equal(p.query('#notifications-toggle').focused, true);
  p.execute('notify("Could not merge.", "error");');
  assert.equal(p.query('#notifications-badge').textContent, '1');
  assert.equal(p.query('#notifications-feed').querySelectorAll('.error').length, 1);
  p.query('#notifications-clear').events.click();
  assert.equal(p.query('#notifications-feed').querySelectorAll('.notification-entry').length, 0);
  assert.equal(p.query('#notifications-badge').hidden, true);
});

test('merge notifications deduplicate, preserve expansion, and remove stale suggestions', async () => {
  const p = await page([recording('one'), recording('two')]);
  const suggestions = () => p.query('#notifications-feed').querySelectorAll('.notification-suggestion');
  assert.equal(suggestions().length, 1);
  assert.equal(p.query('#notifications-badge').textContent, '1');
  const initial = suggestions()[0];
  initial.open = true; initial.events.toggle();
  p.execute('render(); render();');
  assert.equal(suggestions()[0], initial, 'unchanged suggestions keep their DOM and focus');
  p.execute('notify("Copied.");');
  assert.equal(suggestions()[0].open, true);
  p.query('#notifications-clear').events.click();
  assert.equal(suggestions().length, 1, 'clearing activity keeps actionable suggestions');
  await p.query('#notifications-feed').querySelectorAll('.notification-merge')[0].events.click();
  assert.equal(p.requests.length, 1);
  assert.deepEqual(Array.from(p.requests[0].ids), ['one', 'two']);
  assert.equal(p.requests[0].deleteBackups, false);
  assert.equal(suggestions().length, 0);
  assert.equal(p.query('#notifications-feed').querySelectorAll('.notification-entry').length, 1);
});

test('possible merge notification supports inline selection without a second review dialog', async () => {
  const p = await page([historical('one'), historical('two', 120000), historical('three', 240000)]);
  const feed = p.query('#notifications-feed');
  const checks = feed.querySelectorAll('input');
  checks[2].checked = false; checks[2].events.change();
  const merge = feed.querySelectorAll('.notification-merge')[0];
  assert.equal(merge.disabled, false);
  checks[1].checked = false; checks[1].events.change();
  assert.equal(merge.disabled, true);
  checks[1].checked = true; checks[1].events.change();
  await merge.events.click();
  assert.equal(p.dialogs().length, 0);
  assert.deepEqual(Array.from(p.requests[0].ids), ['one', 'two']);
  assert.equal(typeof p.requests[0].possibleGroupKey, 'string');
});

test('notification merge blocks active recordings, double submission and retains failures', async () => {
  const active = await page([recording('one'), recording('two', 'meeting', 'recording')]);
  assert.equal(active.query('#notifications-feed').querySelectorAll('.notification-merge')[0].disabled, true);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const p = await page([recording('one'), recording('two')], { gate, error: 'Merge failed' });
  const merge = p.query('#notifications-feed').querySelectorAll('.notification-merge')[0];
  const pending = merge.events.click();
  await merge.events.click();
  assert.equal(p.requests.length, 1);
  release(); await pending;
  assert.equal(p.query('#notifications-feed').querySelectorAll('.notification-suggestion').length, 1);
  assert.equal(p.query('#notifications-feed').querySelectorAll('.notification-merge')[0].disabled, false);
  assert.equal(p.query('#notifications-feed').querySelectorAll('.error').length, 1);
});

test('notification activity is bounded and unseen removed suggestions clear the badge', async () => {
  const p = await page([recording('one'), recording('two')]);
  p.execute('sessions = []; render();');
  assert.equal(p.query('#notifications-badge').hidden, true);
  p.execute('for (let i = 0; i < 105; i++) notify(`Activity ${i}`);');
  assert.equal(p.query('#notifications-feed').querySelectorAll('.notification-entry').length, 100);
  assert.equal(p.query('#notifications-badge').textContent, '100');
});

test('copy, download, delete and clipboard failures go into notification activity', async () => {
  const p = await page([recording('one', null)]);
  const actions = p.query('#list').querySelectorAll('.call-actions')[0].children;
  await actions[0].events.click();
  await actions[1].events.click();
  await actions[2].events.click();
  assert.deepEqual(p.notices, ['Transcript copied: one', 'TXT download started: one', 'Conversation deleted: one']);
  assert.equal(p.query('#notifications-feed').querySelectorAll('.notification-entry').length, 3);
  assert.equal(p.rows().length, 0);
  const failure = await page([recording('one', null)], { clipboardError: 'Clipboard unavailable' });
  await failure.query('#list').querySelectorAll('.call-actions')[0].children[0].events.click();
  assert.equal(failure.query('#notifications-feed').querySelectorAll('.error').length, 1);
});

test('outside click closes the panel while a detached child click keeps it open', async () => {
  const p = await page([]);
  p.query('#notifications-toggle').events.click();
  p.documentEvents.click({ target: { closest: () => null }, composedPath: () => [p.query('#notifications-panel')] });
  assert.equal(p.query('#notifications-panel').hidden, false);
  p.documentEvents.click({ target: { closest: () => null }, composedPath: () => [] });
  assert.equal(p.query('#notifications-panel').hidden, true);
});

test('bulk toolbar disables actions for empty selection and select all spans pages without rebuilding rows', async () => {
  const p = await page(Array.from({ length: 25 }, (_, i) => recording(`call-${i}`, null)));
  const all = p.query('#select-all-calls');
  assert.equal(p.query('#merge').disabled, true);
  assert.equal(p.query('#bulk-delete').disabled, true);
  assert.equal(p.query('#clear-selection').disabled, true);
  assert.equal(all.disabled, false);
  assert.equal(all.checked, false);
  assert.equal(all.indeterminate, false);
  const rows = p.rows();
  all.checked = true; all.events.change();
  assert.equal(p.query('#selection-count').textContent, '25 selected');
  assert.equal(all.checked, true);
  assert.equal(all.indeterminate, false);
  assert.equal(p.query('#bulk-delete').disabled, false);
  assert.equal(p.query('#merge').disabled, false);
  assert.equal(p.rows()[0], rows[0]);
  assert.equal(p.query('#list').querySelectorAll('input').every(check => check.checked), true);
  p.query('#pagination').children.find(child => child.attributes['aria-label'] === 'Next page').events.click();
  assert.equal(p.query('#list').querySelectorAll('input').every(check => check.checked), true);
  const one = p.query('#list').querySelectorAll('input')[0];
  one.checked = false; one.events.change();
  assert.equal(all.checked, false);
  assert.equal(all.indeterminate, true);
  assert.equal(p.query('#selection-count').textContent, '24 selected');
  // Native mixed checkboxes become checked before firing change; our mixed-state click clears.
  all.checked = true; all.indeterminate = false; all.events.change();
  assert.equal(p.query('#selection-count').textContent, '0 selected');
  assert.equal(all.checked, false);
  assert.equal(all.indeterminate, false);
  assert.equal(p.query('#list').querySelectorAll('input').some(check => check.checked), false);
  assert.equal(p.query('#bulk-delete').disabled, true);
});

test('Select all follows search results and can clear a selection hidden by the current search', async () => {
  const p = await page([recording('Alpha one', null), recording('Alpha two', null), recording('Beta', null)]);
  const all = p.query('#select-all-calls');
  p.query('#search').value = 'Alpha'; p.query('#search').events.input();
  all.events.change();
  assert.equal(p.query('#selection-count').textContent, '2 selected');
  assert.equal(all.checked, true);
  p.query('#search').value = ''; p.query('#search').events.input();
  assert.equal(all.indeterminate, true);
  assert.equal(p.query('#list').querySelectorAll('input')[2].checked, false);
  p.query('#search').value = 'no results'; p.query('#search').events.input();
  assert.equal(all.disabled, false, 'hidden selections can still be cleared');
  assert.equal(all.indeterminate, true);
  all.events.change();
  assert.equal(p.query('#selection-count').textContent, '0 selected');
  assert.equal(all.disabled, true);
});

test('Select all blocks merge and deletion for active calls and recomputes after removed calls', async () => {
  const p = await page([recording('one', null), recording('two', null, 'recording')]);
  const all = p.query('#select-all-calls');
  all.events.change();
  assert.equal(p.query('#merge').disabled, true);
  assert.equal(p.query('#bulk-delete').disabled, true);
  assert.equal(p.query('#clear-selection').disabled, false);
  p.execute('sessions = sessions.slice(0, 1); render();');
  assert.equal(p.query('#selection-count').textContent, '1 selected');
  assert.equal(all.checked, true);
  assert.equal(p.query('#bulk-delete').disabled, false);
  all.events.change();
  assert.equal(p.query('#bulk-delete').disabled, true);
  const empty = await page([]);
  assert.equal(empty.query('#select-all-calls').disabled, true);
  assert.equal(empty.query('#merge').disabled, true);
  assert.equal(empty.query('#bulk-delete').disabled, true);
  assert.equal(empty.query('#clear-selection').disabled, true);
});

function memoryNotificationStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

test('notification activity and read status survive navigation between Calls and internal pages', async () => {
  const storage = memoryNotificationStorage();
  const calls = [recording('one'), recording('two')];
  const listing = await page(calls, { storage });
  listing.execute('notify("Transcript copied.");');
  assert.equal(listing.query('#notifications-badge').textContent, '2');
  const settings = await page(calls, { storage, internal: true });
  assert.equal(settings.query('#notifications-feed').querySelectorAll('.notification-entry').length, 1);
  assert.equal(settings.query('#notifications-badge').textContent, '2', 'suggestions are not counted twice on navigation');
  settings.query('#notifications-toggle').events.click();
  settings.execute('notify("Setting saved.");');
  const transcript = await page(calls, { storage, internal: true, search: '?id=one' });
  assert.equal(transcript.query('#notifications-badge').hidden, true);
  assert.equal(transcript.query('#notifications-feed').querySelectorAll('.notification-entry').length, 2);
  transcript.execute('notify("Conversation deleted.");');
  const back = await page([], { storage });
  assert.equal(back.query('#notifications-badge').textContent, '1');
  assert.equal(back.query('#notifications-feed').querySelectorAll('.notification-entry').length, 3);
  back.query('#notifications-clear').events.click();
  const cleared = await page([], { storage, internal: true });
  assert.equal(cleared.query('#notifications-feed').querySelectorAll('.notification-entry').length, 0);
});

test('internal pages merge suggestions and open the merged transcript when the viewed call is included', async () => {
  const storage = memoryNotificationStorage();
  const p = await page([recording('one'), recording('two')], { internal: true, storage, search: '?id=one' });
  await p.query('#notifications-feed').querySelectorAll('.notification-merge')[0].events.click();
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].relatedMeetingId, 'meeting');
  assert.equal(p.requests[0].deleteBackups, false);
  assert.equal(p.location.href, 'transcript.html?id=merged');
  assert.equal(p.query('#notifications-feed').querySelectorAll('.notification-suggestion').length, 0);
  const next = await page([], { internal: true, storage });
  assert.equal(next.query('#notifications-feed').querySelectorAll('.notification-entry').length, 1);
});

test('internal merge revalidates stale suggestions before mutation and refreshes their details', async () => {
  const p = await page([recording('one'), recording('two')], { internal: true });
  p.replaceCalls([recording('one'), recording('two'), recording('three')]);
  await p.query('#notifications-feed').querySelectorAll('.notification-merge')[0].events.click();
  assert.equal(p.requests.length, 0);
  assert.equal(p.query('#notifications-feed').querySelectorAll('.error').length, 1);
  assert.equal(p.query('#notifications-feed').querySelectorAll('input').length, 3);
  assert.equal(p.query('#notifications-feed').querySelectorAll('.notification-merge')[0].disabled, false);
});

test('internal-page inferred merge supports a subset and leaves Settings in place', async () => {
  const p = await page([historical('one'), historical('two', 120000), historical('three', 240000)], { internal: true });
  const feed = p.query('#notifications-feed');
  const last = feed.querySelectorAll('input')[2]; last.checked = false; last.events.change();
  await feed.querySelectorAll('.notification-merge')[0].events.click();
  assert.deepEqual(Array.from(p.requests[0].ids), ['one', 'two']);
  assert.equal(typeof p.requests[0].possibleGroupKey, 'string');
  assert.equal(p.location.href, undefined);
});

test('notification storage failures do not prevent activity or actions', async () => {
  const storage = { getItem() { throw new Error('Unavailable'); }, setItem() { throw new Error('Unavailable'); } };
  const p = await page([], { storage, internal: true });
  p.execute('notify("Setting saved.");');
  assert.equal(p.query('#notifications-feed').querySelectorAll('.notification-entry').length, 1);
  p.query('#notifications-toggle').events.click();
  assert.equal(p.query('#notifications-badge').hidden, true);
});


test('listing copy and download apply the current AI prompt preference', async () => {
  const preferences = { includeAiPrompt: true, aiPrompt: 'Summarize the call' };
  const p = await page([recording('one', null)], { preferences });
  const actions = p.query('#list').querySelectorAll('.call-actions')[0].children;
  await actions[0].events.click();
  await actions[1].events.click();
  assert.equal(p.copied(), 'Summarize the call\n\n---\n\nTranscript:\n\none');
  assert.equal(await p.downloaded().text(), p.copied());
  preferences.includeAiPrompt = false;
  await actions[0].events.click();
  assert.equal(p.copied(), 'one');
});
