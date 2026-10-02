const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(faults = {}) {
  const records = faults.records || new Map();
  const openedTabs = [];
  const openedWindows = [];
  const errors = [];
  let historyReads = 0;
  let now = Date.now();
  class ClockDate extends Date { static now() { return now; } }
  const forgottenBackups = [], removedBackups = [], syncedCalls = [], createdAlarms = [];
  const event = () => ({ addListener(fn) { this.fire = fn; } });
  const chrome = {
    extension: { inIncognitoContext: !!faults.incognito },
    runtime: { onMessage: event(), onStartup: event(), onInstalled: event(), getURL: path => `chrome-extension://test/${path}` },
    tabs: { onRemoved: event(), onUpdated: event(), create: async options => { openedTabs.push(structuredClone(options)); return { id: 99, ...options }; } },
    windows: { getAll: async () => faults.windows || [{ id: 21, incognito: false }], create: async options => { openedWindows.push(structuredClone(options)); return { id: 100, ...options }; } },
    action: { onClicked: event() }, alarms: { onAlarm: event(), get: async () => undefined, create: async (...args) => createdAlarms.push(args) },
    storage: faults.storage || { onChanged: event(), local: { set: async () => {}, get: async defaults => defaults, remove: async () => {} } },
  };
  const context = vm.createContext({ chrome, console: { ...console, error: (...args) => errors.push(args) }, Date: ClockDate, URL, setTimeout, clearTimeout, crypto: require("node:crypto").webcrypto,
    allSessions: async () => { historyReads++; return structuredClone([...records.values()]); },
    openSessions: async () => structuredClone([...records.values()].filter(s => ["recording", "paused"].includes(s.status))),
    sessionsForTab: async id => structuredClone([...records.values()].filter(s => s.tabId === id)),
    sessionsForCall: async id => structuredClone([...records.values()].filter(s => (s.callId || s.id) === id)),
    saveSessions: async sessions => { for (const s of sessions) records.set(s.id, structuredClone(s)); },
    deleteSessions: async ids => { for (const id of ids) records.delete(id); },
    getSession: async id => structuredClone(records.get(id)),
    saveSession: async s => { if (faults.saveFailure) throw new Error("IndexedDB write failed"); records.set(s.id, structuredClone(s)); },
    deleteSession: async id => records.delete(id),
    backupFolderStatus: async () => ({ enabled: false }),
    forgetCallBackup: async id => forgottenBackups.push(id), refreshBackupAlert: async () => {},
    removeCallBackup: async call => { removedBackups.push(call.id); return null; },
    syncCalls: async calls => { syncedCalls.push(...structuredClone(calls)); return { backed: calls.length, failed: 0 }; }, syncOne: async () => ({}),
    withBackupStatus: async calls => calls,
  });
  vm.runInContext(fs.readFileSync('storage/calls.js', 'utf8').replace(/export /g, ''), context);
  vm.runInContext(fs.readFileSync('background/incognito.js', 'utf8').replace(/export /g, ''), context);
  const code = fs.readFileSync('background/service-worker.js', 'utf8').replace(/^import[\s\S]*?;\n/gm, '');
  vm.runInContext(code, context);
  const meet = { tab: { id: 7 }, url: 'https://meet.google.com/abc-defg-hij' };
  const page = { tab: { id: 8 }, url: 'chrome-extension://test/pages/transcript.html' };
  const send = (message, sender = meet) => new Promise(resolve => chrome.runtime.onMessage.fire(message, sender, resolve));
  const drain = () => vm.runInContext('queue', context);
  const session = { id: 'one', token: 'doc-one', title: 'Test', startTime: Date.now() - 10000,
    status: 'recording', participants: ['You'], blocks: [{ speaker: 'You', timestamp: Date.now(), text: 'Hello' }] };
  return { records, errors, createdAlarms, openedTabs, openedWindows,
    advance: milliseconds => { now += milliseconds; },
    blockQueue: promise => { context.blocker = promise; vm.runInContext('serial(() => blocker)', context); }, historyReads: () => historyReads, chrome, send, page, session, drain, forgottenBackups, removedBackups, syncedCalls };
}

test('paused transcript is completed on tab closure and late writes cannot reopen it', async () => {
  const t = setup();
  assert.equal((await t.send({ type: 'create', session: { ...t.session, status: 'paused' } })).ok, true);
  t.chrome.tabs.onRemoved.fire(7);
  await t.drain();
  assert.equal(t.records.get('one').status, 'completed');
  assert.equal(t.records.get('one').blocks[0].text, 'Hello');
  const late = await t.send({ type: 'create', session: t.session });
  assert.equal(late.ok, false);
  assert.equal(t.records.get('one').status, 'completed');
});

test('rename survives concurrent content saves; active delete is rejected', async () => {
  const t = setup();
  await t.send({ type: 'create', session: t.session });
  await t.send({ type: 'rename', id: 'one', title: 'Renamed' }, t.page);
  await t.send({ type: 'create', session: t.session });
  assert.equal(t.records.get('one').title, 'Renamed');
  assert.equal((await t.send({ type: 'delete', id: 'one' }, t.page)).ok, false);
  await t.send({ type: 'save', session: { ...t.session, status: 'completed' } });
  assert.equal((await t.send({ type: 'delete', id: 'one' }, t.page)).ok, true);
  assert.equal(t.records.size, 0);
});

test('startup preserves unfinished transcripts as interrupted', async () => {
  const t = setup();
  await t.send({ type: 'create', session: t.session });
  t.chrome.runtime.onStartup.fire();
  await t.drain();
  const recovered = t.records.get('one');
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.endTime, recovered.updatedAt);
  assert.equal(recovered.blocks.length, 1);
});

test('navigation completes and a new session is independent', async () => {
  const t = setup();
  await t.send({ type: 'create', session: t.session });
  t.chrome.tabs.onUpdated.fire(7, { status: 'loading' });
  await t.drain();
  await t.send({ type: 'create', session: { ...t.session, id: 'two', token: 'doc-two', blocks: [] } });
  assert.equal(t.records.get('one').status, 'completed');
  assert.equal(t.records.get('two').status, 'recording');
  assert.equal(t.records.get('two').blocks.length, 0);
});

test('missing heartbeats recover both recording and paused sessions', async () => {
  const t = setup();
  await t.send({ type: 'create', session: { ...t.session, status: 'paused' } });
  t.records.get('one').updatedAt = Date.now() - 180000;
  t.chrome.alarms.onAlarm.fire({ name: 'recover' });
  await t.drain();
  assert.equal(t.records.get('one').status, 'interrupted');
});

test('late save cannot resurrect a deleted transcript', async () => {
  const t = setup();
  await t.send({ type: 'create', session: t.session });
  await t.send({ type: 'save', session: { ...t.session, status: 'completed' } });
  await t.send({ type: 'delete', id: 'one' }, t.page);
  assert.equal((await t.send({ type: 'save', session: t.session })).ok, false);
  assert.equal(t.records.size, 0);
});

test('legacy grouped segments retain rename and combined export data', async () => {
  const t = setup();
  const call = (await t.send({ type: 'beginCall' })).value;
  await t.send({ type: 'create', session: { ...t.session, ...call } });
  await t.send({ type: 'save', session: { ...t.session, ...call, status: 'completed', reason: 'stopped', endTime: Date.now() } });
  await t.send({ type: 'rename', id: call.callId, title: 'One conversation' }, t.page);
  await t.send({ type: 'create', session: { ...t.session, ...call, id: 'two', token: 'two', startTime: Date.now(), blocks: [{ speaker: 'Jane', text: 'Second segment', timestamp: Date.now() }] } });
  const calls = (await t.send({ type: 'list' }, t.page)).value;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].segmentCount, 2);
  assert.equal(calls[0].blocks.length, 2);
  assert.equal(calls[0].title, 'One conversation');
  assert.equal(calls[0].status, 'recording');
  assert.equal((await t.send({ type: 'delete', id: call.callId }, t.page)).ok, false);
});

test('manual merge creates a new conversation identity and preserves original backup files by default', async () => {
  const t = setup();
  await t.send({ type: 'create', session: { ...t.session, status: 'completed' } });
  await t.send({ type: 'create', session: { ...t.session, id: 'two', token: 'two', status: 'completed' } });
  const merged = await t.send({ type: 'merge', ids: ['one', 'two'] }, t.page);
  assert.equal(merged.ok, true);
  assert.notEqual(merged.value.id, 'one');
  assert.notEqual(merged.value.id, 'two');
  assert.equal(t.records.size, 2);
  assert.deepEqual([...t.records.values()].map(record => record.callId), [merged.value.id, merged.value.id]);
  assert.deepEqual(t.forgottenBackups.sort(), ['one', 'two']);
  assert.deepEqual(t.removedBackups, []);
  assert.equal(t.syncedCalls.at(-1).id, merged.value.id);
  assert.equal((await t.send({ type: 'list' }, t.page)).value.length, 1);
  assert.equal((await t.send({ type: 'get', id: 'two' }, t.page)).value.blocks.length, 2);
  await t.send({ type: 'delete', id: merged.value.id }, t.page);
  assert.equal(t.records.size, 0);
});

test('manual merge can explicitly remove both original backup files', async () => {
  const t = setup();
  await t.send({ type: 'create', session: { ...t.session, status: 'completed' } });
  await t.send({ type: 'create', session: { ...t.session, id: 'two', token: 'two', status: 'completed' } });
  const merged = await t.send({ type: 'merge', ids: ['one', 'two'], deleteBackups: true }, t.page);
  assert.equal(merged.ok, true);
  assert.deepEqual(t.removedBackups.sort(), ['one', 'two']);
  assert.deepEqual(t.forgottenBackups, []);
  assert.equal(merged.value.backupWarning, null);
});

test('bulk delete rejects the whole selection if any call is still active', async () => {
  const t = setup();
  await t.send({ type: 'create', session: { ...t.session, status: 'completed' } });
  await t.send({ type: 'create', session: { ...t.session, id: 'two', token: 'two' } });
  const rejected = await t.send({ type: 'deleteMany', ids: ['one', 'two'] }, t.page);
  assert.equal(rejected.ok, false);
  assert.equal(t.records.size, 2);
  await t.send({ type: 'save', session: { ...t.session, id: 'two', token: 'two', status: 'completed' } });
  assert.equal((await t.send({ type: 'deleteMany', ids: ['one', 'two'] }, t.page)).ok, true);
  assert.equal(t.records.size, 0);
});


test('normal transcript saves do not load the entire saved history', async () => {
  const t = setup();
  await t.send({ type: 'create', session: t.session });
  const before = t.historyReads();
  await t.send({ type: 'save', session: t.session });
  assert.equal(t.historyReads(), before);
});

test('malformed transcript data cannot poison the call listing', async () => {
  const t = setup();
  for (const invalid of [{ participants: null }, { startTime: 'yesterday' }, { blocks: [{}] }, { token: null }]) {
    assert.equal((await t.send({ type: 'create', session: { ...t.session, ...invalid } })).ok, false);
  }
  assert.equal(t.records.size, 0);
  assert.equal((await t.send({ type: 'list' }, t.page)).ok, true);
});

test('bulk actions reject missing IDs before changing any conversation', async () => {
  const t = setup();
  await t.send({ type: 'create', session: { ...t.session, status: 'completed' } });
  await t.send({ type: 'create', session: { ...t.session, id: 'two', status: 'completed' } });
  assert.equal((await t.send({ type: 'merge', ids: ['one', 'two', 'missing'] }, t.page)).ok, false);
  assert.equal((await t.send({ type: 'deleteMany', ids: ['one', 'missing'] }, t.page)).ok, false);
  assert.equal(t.records.size, 2);
  assert.equal(t.forgottenBackups.length, 0);
});

test('renaming marks the transcript as changed for backup versioning', async () => {
  const t = setup();
  await t.send({ type: 'create', session: { ...t.session, status: 'completed' } });
  t.records.get('one').updatedAt = 1;
  await t.send({ type: 'rename', id: 'one', title: 'New title' }, t.page);
  assert.ok(t.records.get('one').updatedAt > 1);
});


test('worker startup restores the recovery alarm if Chrome cleared it', async () => {
  const t = setup();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(t.createdAlarms.length, 1);
  assert.equal(t.createdAlarms[0][0], 'recover');
  assert.equal(t.createdAlarms[0][1].periodInMinutes, 1);
});


test('recovery and single-call reads do not scan the full history', async () => {
  const t = setup();
  await t.send({ type: 'create', session: t.session });
  const before = t.historyReads();
  await t.send({ type: 'get', id: 'one' }, t.page);
  await t.send({ type: 'backupFolderStatus' }, t.page);
  t.chrome.alarms.onAlarm.fire({ name: 'recover' });
  await t.drain();
  t.chrome.tabs.onRemoved.fire(99);
  await t.drain();
  assert.equal(t.historyReads(), before);
});


test('a recovery check delayed behind backup work does not falsely interrupt a fresh session', async () => {
  const t = setup();
  await t.send({ type: 'create', session: t.session });
  let release;
  t.blockQueue(new Promise(resolve => { release = resolve; }));
  t.chrome.alarms.onAlarm.fire({ name: 'recover' });
  t.advance(180000);
  release(); await t.drain();
  assert.equal(t.records.get('one').status, 'recording');
});


test('each recording start in the same Meet creates an independent history entry', async () => {
  const t = setup();
  const first = (await t.send({ type: 'beginCall' })).value;
  await t.send({ type: 'create', session: { ...t.session, ...first } });
  await t.send({ type: 'save', session: { ...t.session, ...first, status: 'completed', reason: 'stopped', endTime: Date.now() } });
  await t.send({ type: 'rename', id: first.callId, title: 'First recording' }, t.page);
  const second = (await t.send({ type: 'beginCall' })).value;
  assert.notEqual(first.callId, second.callId);
  assert.equal(first.meetUrl, second.meetUrl);
  await t.send({ type: 'create', session: { ...t.session, ...second, id: 'two', token: 'two', blocks: [] } });
  const calls = (await t.send({ type: 'list' }, t.page)).value;
  assert.equal(calls.length, 2);
  const completed = calls.find(call => call.id === first.callId);
  const recording = calls.find(call => call.id === second.callId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.title, 'First recording');
  assert.equal(completed.blocks[0].text, 'Hello');
  assert.equal(recording.status, 'recording');
  assert.equal(recording.title, 'Test');
  assert.equal(recording.blocks.length, 0);
  assert.equal((await t.send({ type: 'delete', id: first.callId }, t.page)).ok, true);
  assert.equal(t.records.get('two').status, 'recording');
});

const relatedFixture = (t, id, meetingId = 'meeting') => ({ ...t.session, id, token: id,
  callId: id, meetingId, status: 'completed', reason: 'stopped', endTime: Date.now() });

test('related merge combines complete entries chronologically and keeps original backups', async () => {
  const t = setup();
  await t.send({ type: 'create', session: { ...relatedFixture(t, 'first'), startTime: 1,
    blocks: [{ speaker: 'Alice', timestamp: 1, text: 'First recording' }] } });
  await t.send({ type: 'create', session: { ...relatedFixture(t, 'second'), startTime: 2,
    blocks: [{ speaker: 'Bob', timestamp: 2, text: 'Second recording' }] } });
  const result = await t.send({ type: 'merge', ids: ['second', 'first'], relatedMeetingId: 'meeting' }, t.page);
  assert.equal(result.ok, true);
  const calls = (await t.send({ type: 'list' }, t.page)).value;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].meetingId, 'meeting');
  assert.deepEqual(Array.from(calls[0].blocks, block => block.text), ['First recording', 'Second recording']);
  assert.deepEqual(t.removedBackups, []);
  assert.deepEqual(t.forgottenBackups.sort(), ['first', 'second']);
});

test('related merge rejects another meeting, an active recording, and stale partial groups', async () => {
  const t = setup();
  await t.send({ type: 'create', session: relatedFixture(t, 'first') });
  await t.send({ type: 'create', session: relatedFixture(t, 'second') });
  await t.send({ type: 'create', session: relatedFixture(t, 'other', 'other-meeting') });
  assert.equal((await t.send({ type: 'merge', ids: ['first', 'other'], relatedMeetingId: 'meeting' }, t.page)).ok, false);
  await t.send({ type: 'create', session: { ...relatedFixture(t, 'third'), status: 'recording', endTime: null } });
  assert.equal((await t.send({ type: 'merge', ids: ['first', 'second'], relatedMeetingId: 'meeting' }, t.page)).ok, false);
  assert.equal((await t.send({ type: 'merge', ids: ['first', 'second', 'third'], relatedMeetingId: 'meeting' }, t.page)).ok, false);
  assert.equal(t.records.size, 4);
  assert.deepEqual(t.forgottenBackups, []);
});

test('manual merges across different meetings do not create false related suggestions', async () => {
  const t = setup();
  await t.send({ type: 'create', session: relatedFixture(t, 'first') });
  await t.send({ type: 'create', session: relatedFixture(t, 'second', 'other-meeting') });
  await t.send({ type: 'merge', ids: ['first', 'second'] }, t.page);
  const calls = (await t.send({ type: 'list' }, t.page)).value;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].meetingId, null);
});

test('saved meeting identity cannot be changed by a later snapshot', async () => {
  const t = setup();
  await t.send({ type: 'create', session: { ...relatedFixture(t, 'first'), status: 'recording' } });
  await t.send({ type: 'save', session: { ...relatedFixture(t, 'first', 'wrong-meeting'), status: 'recording' } });
  assert.equal(t.records.get('first').meetingId, 'meeting');
});

const historicalFixture = (t, id, startTime) => ({ ...t.session, id, token: id, callId: id,
  status: 'completed', participants: ['Alice'], startTime, endTime: startTime + 60000, reason: 'stopped' });
const suggestionKey = ids => JSON.stringify([...ids].sort());

test('reviewed historical merge combines only chosen entries and retains backups', async () => {
  const t = setup();
  for (const [id, start] of [['first', 1], ['second', 120001], ['third', 240001]]) {
    await t.send({ type: 'create', session: historicalFixture(t, id, start) });
  }
  const result = await t.send({ type: 'merge', ids: ['first', 'second'],
    possibleGroupKey: suggestionKey(['first', 'second', 'third']), deleteBackups: false }, t.page);
  assert.equal(result.ok, true);
  const calls = (await t.send({ type: 'list' }, t.page)).value;
  assert.equal(calls.length, 2);
  assert.equal(t.records.get('third').callId, 'third');
  assert.equal(calls.find(call => call.id === result.value.id).segmentCount, 2);
  assert.equal(calls.find(call => call.id === result.value.id).meetingId, null, 'a guess never becomes a certain meeting identity');
  assert.deepEqual(t.removedBackups, []);
});

test('historical merge rejects stale suggestions or entries outside the reviewed group', async () => {
  const t = setup();
  await t.send({ type: 'create', session: historicalFixture(t, 'first', 1) });
  await t.send({ type: 'create', session: historicalFixture(t, 'second', 120001) });
  const key = suggestionKey(['first', 'second']);
  await t.send({ type: 'create', session: historicalFixture(t, 'third', 240001) });
  assert.equal((await t.send({ type: 'merge', ids: ['first', 'second'], possibleGroupKey: key }, t.page)).ok, false);
  await t.send({ type: 'create', session: { ...historicalFixture(t, 'other', 360001), participants: ['Bob'] } });
  assert.equal((await t.send({ type: 'merge', ids: ['first', 'other'],
    possibleGroupKey: suggestionKey(['first', 'second', 'third']) }, t.page)).ok, false);
  assert.equal(t.records.size, 4);
  assert.deepEqual(t.forgottenBackups, []);
});

test('private bookmarks survive stale caption snapshots, Stop, page edits and merge', async () => {
  const t = setup();
  const first = { ...t.session, blocks: [{ ...t.session.blocks[0], id: 1 }] };
  await t.send({ type: 'create', session: first });
  const add = await t.send({ type: 'bookmarkAdd', segmentId: first.id, token: first.token, blockId: 1, timestamp: first.startTime + 1000 });
  assert.equal(add.ok, true);
  const bookmarkId = add.value.id;
  assert.equal(add.value.timestamp, first.startTime + 1000);
  await t.send({ type: 'bookmarkUpdate', segmentId: first.id, token: first.token, bookmarkId, text: 'My follow-up' });
  await t.send({ type: 'save', session: { ...first, bookmarks: [] } });
  assert.equal(t.records.get(first.id).bookmarks[0].text, 'My follow-up');
  await t.send({ type: 'save', session: { ...first, status: 'completed' } });
  await t.send({ type: 'bookmarkUpdate', segmentId: first.id, token: first.token, bookmarkId, text: 'After Stop' });
  assert.equal(t.records.get(first.id).bookmarks[0].text, 'After Stop');
  assert.equal(t.syncedCalls.at(-1).bookmarks[0].text, 'After Stop');
  await t.send({ type: 'bookmarkUpdate', id: first.id, segmentId: first.id, bookmarkId, text: 'Edited from transcript' }, t.page);
  const anchor = structuredClone(t.records.get(first.id).bookmarks[0]);
  await t.send({ type: 'bookmarkUpdate', id: first.id, segmentId: first.id, bookmarkId, text: '' }, t.page);
  assert.deepEqual(t.records.get(first.id).bookmarks[0], { ...anchor, text: '' }, 'deleting personal text preserves the bookmark and its immutable anchor');
  await t.send({ type: 'bookmarkUpdate', id: first.id, segmentId: first.id, bookmarkId, text: 'Edited from transcript' }, t.page);
  const second = { ...first, id: 'two', token: 'second-token', status: 'completed' };
  await t.send({ type: 'create', session: second });
  const merge = await t.send({ type: 'merge', ids: ['one', 'two'] }, t.page);
  assert.equal(merge.ok, true);
  const call = (await t.send({ type: 'get', id: merge.value.id }, t.page)).value;
  assert.equal(call.bookmarks[0].text, 'Edited from transcript');
  assert.equal(call.bookmarks[0].segmentId, 'one');
  assert.equal(call.bookmarks[0].blockId, 1);
  assert.equal((await t.send({ type: 'bookmarkDelete', id: call.id, segmentId: 'one', bookmarkId }, t.page)).ok, true);
  assert.equal(t.records.get('one').bookmarks.length, 0);
});

test('repeated bookmarks in one speaker turn reuse one marker and append live comments', async () => {
  const t = setup();
  const first = { ...t.session, blocks: [
    { id: 1, speaker: 'You', timestamp: t.session.startTime + 1000, text: 'First' },
    { id: 2, speaker: 'You', timestamp: t.session.startTime + 2000, text: 'Second' },
  ] };
  await t.send({ type: 'create', session: first });
  const a = await t.send({ type: 'bookmarkAdd', segmentId: first.id, token: first.token, blockId: 1, live: true, timestamp: first.startTime + 1000 });
  const b = await t.send({ type: 'bookmarkAdd', segmentId: first.id, token: first.token, blockId: 2, live: true, timestamp: first.startTime + 2000 });
  assert.equal(a.value.id, b.value.id);
  assert.equal(t.records.get(first.id).bookmarks.length, 1);
  await t.send({ type: 'bookmarkUpdate', segmentId: first.id, token: first.token, bookmarkId: a.value.id, commentId: a.value.commentId, text: 'First comment' });
  await t.send({ type: 'bookmarkUpdate', segmentId: first.id, token: first.token, bookmarkId: b.value.id, commentId: b.value.commentId, text: 'Second comment' });
  assert.match(t.records.get(first.id).bookmarks[0].text, /First comment/);
  assert.match(t.records.get(first.id).bookmarks[0].text, /Second comment/);
});

test('bookmark mutations reject other tabs, invalid replies and invalid note text', async () => {
  const t = setup();
  await t.send({ type: 'create', session: t.session });
  const message = { type: 'bookmarkAdd', segmentId: 'one', token: 'doc-one', blockId: null };
  assert.equal((await t.send(message, { tab: { id: 999 }, url: 'https://meet.google.com/abc-defg-hij' })).ok, false);
  assert.equal((await t.send({ ...message, token: 'wrong' })).ok, false);
  assert.equal((await t.send({ ...message, blockId: 999 })).ok, false);
  const add = await t.send(message);
  assert.equal(add.ok, true, 'a moment can be bookmarked before any captions');
  assert.equal(add.value.blockId, null);
  assert.equal((await t.send({ ...message, type: 'bookmarkUpdate', bookmarkId: add.value.id, text: 42 })).ok, false);
  assert.equal((await t.send({ ...message, type: 'bookmarkUpdate', bookmarkId: add.value.id, text: 'x'.repeat(10001) })).ok, false);
});


test('finalized recording rejects a late save with a recoverable code without Chrome error logging', async () => {
  const t = setup();
  await t.send({ type: 'create', session: t.session });
  t.advance(180000);
  t.chrome.alarms.onAlarm.fire({ name: 'recover' });
  await t.drain();
  const before = structuredClone(t.records.get('one'));
  const reply = await t.send({ type: 'save', session: t.session });
  assert.equal(reply.ok, false);
  assert.match(reply.error, /finalized after interruption/);
  assert.equal(reply.code, 'SESSION_FINALIZED');
  assert.deepEqual(t.records.get('one'), before);
  assert.equal(t.errors.length, 0);
});


test('unexpected storage failures still reach Chrome error logging and the caller', async () => {
  const t = setup({ saveFailure: true });
  const reply = await t.send({ type: 'create', session: t.session });
  assert.equal(reply.ok, false);
  assert.equal(reply.error, 'IndexedDB write failed');
  assert.equal(t.errors.length, 1);
  assert.equal(t.errors[0][1], 'IndexedDB write failed');
  assert.equal(t.records.size, 0);
});


test('the toolbar icon opens Echo in the originating normal or incognito window', async () => {
  for (const incognito of [false, true]) {
    const t = setup();
    await t.chrome.action.onClicked.fire({ id: 12, windowId: incognito ? 42 : 21, incognito });
    assert.equal(t.openedTabs.length, 1);
    assert.equal(t.openedTabs[0].windowId, incognito ? 42 : 21);
    assert.equal(t.openedTabs[0].url, 'chrome-extension://test/pages/transcripts.html');
  }
});
test('Meet History opens Echo in the sender window even when another window is focused', async () => {
  for (const incognito of [false, true]) {
    const t = setup();
    const result = await t.send({ type: 'history' }, { tab: { id: 7, windowId: incognito ? 42 : 21, incognito }, url: 'https://meet.google.com/abc-defg-hij' });
    assert.equal(result.ok, true);
    assert.equal(t.openedTabs.length, 1);
    assert.equal(t.openedTabs[0].windowId, incognito ? 42 : 21);
    assert.equal(t.openedTabs[0].url, 'chrome-extension://test/pages/transcripts.html');
  }
});

function storageBus() {
  const values = {};
  const subscribers = new Set();
  function endpoint() {
    const listeners = new Set(); subscribers.add(listeners);
    const notify = changes => { queueMicrotask(() => { for (const group of subscribers) for (const fn of group) fn(structuredClone(changes), 'local'); }); };
    return { onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }, disconnect() { subscribers.delete(listeners); },
      local: {
        async get(keys) {
          if (keys == null) return structuredClone(values);
          if (typeof keys === 'object' && !Array.isArray(keys)) return structuredClone({ ...keys, ...Object.fromEntries(Object.keys(keys).filter(key => key in values).map(key => [key, values[key]])) });
          return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in values).map(key => [key, values[key]])));
        },
        async set(entries) { const changes = {}; for (const [key, value] of Object.entries(entries)) { changes[key] = { oldValue: values[key], newValue: structuredClone(value) }; values[key] = structuredClone(value); } notify(changes); },
        async remove(keys) { const changes = {}; for (const key of Array.isArray(keys) ? keys : [keys]) { if (!(key in values)) continue; changes[key] = { oldValue: values[key] }; delete values[key]; } notify(changes); },
      },
    };
  }
  return { endpoint, values };
}
const privateMeet = { tab: { id: 42, windowId: 6, incognito: true }, url: 'https://meet.google.com/abc-defg-hij' };
const privatePage = { tab: { id: 43, windowId: 6, incognito: true }, url: 'chrome-extension://test/pages/transcripts.html' };
test('split workers save and read incognito calls from the durable shared history after incognito closes', async () => {
  const bus = storageBus();
  const regular = setup({ storage: bus.endpoint() });
  const privateStorage = bus.endpoint();
  const privateWorker = setup({ incognito: true, storage: privateStorage });
  const normalSession = { ...regular.session, id: 'normal' };
  await regular.send({ type: 'create', session: normalSession });
  await regular.send({ type: 'save', session: { ...normalSession, status: 'completed' } });
  assert.equal((await privateWorker.send({ type: 'create', session: privateWorker.session }, privateMeet)).ok, true);
  assert.equal(privateWorker.records.size, 0, 'no transcript goes into temporary incognito IndexedDB');
  assert.equal(regular.records.get('one').incognito, true);
  const list = await privateWorker.send({ type: 'list' }, privatePage);
  assert.equal(list.ok, true);
  assert.equal(list.value.length, 2, 'normal and incognito conversations share the listing');
  const closed = privateWorker.chrome.tabs.onRemoved.fire(42);
  await closed;
  assert.equal(regular.records.get('one').status, 'completed');
  privateStorage.disconnect();
  assert.equal((await regular.send({ type: 'list' }, regular.page)).value.length, 2);
  const reopened = setup({ incognito: true, storage: bus.endpoint() });
  assert.equal((await reopened.send({ type: 'list' }, privatePage)).value.length, 2);
  assert.equal(Object.keys(bus.values).filter(key => key.startsWith('echo:incognito-request:')).length, 0, 'mailbox does not retain transcript payloads');
});
test('normal page edits and incognito caption saves share one write queue and preserve rename and notes', async () => {
  const bus = storageBus();
  const regular = setup({ storage: bus.endpoint() });
  const privateWorker = setup({ incognito: true, storage: bus.endpoint() });
  await privateWorker.send({ type: 'create', session: privateWorker.session }, privateMeet);
  await Promise.all([
    regular.send({ type: 'rename', id: 'one', title: 'Shared edit' }, regular.page),
    privateWorker.send({ type: 'save', session: privateWorker.session }, privateMeet),
  ]);
  const marked = await privateWorker.send({ type: 'bookmarkAdd', segmentId: 'one', token: 'doc-one', live: true }, privateMeet);
  assert.equal(marked.ok, true);
  await privateWorker.send({ type: 'save', session: privateWorker.session }, privateMeet);
  assert.equal(regular.records.get('one').title, 'Shared edit');
  assert.equal(regular.records.get('one').bookmarks.length, 1);
});
test('regular startup leaves live incognito calls alone and shared terminal errors retain their code', async () => {
  const bus = storageBus();
  const regular = setup({ storage: bus.endpoint() });
  const privateWorker = setup({ incognito: true, storage: bus.endpoint() });
  await privateWorker.send({ type: 'create', session: privateWorker.session }, privateMeet);
  regular.chrome.runtime.onStartup.fire(); await regular.drain();
  assert.equal(regular.records.get('one').status, 'recording');
  await privateWorker.chrome.tabs.onUpdated.fire(42, { status: 'loading' });
  const late = await privateWorker.send({ type: 'save', session: privateWorker.session }, privateMeet);
  assert.equal(late.ok, false);
  assert.equal(late.code, 'SESSION_FINALIZED');
  assert.equal(regular.records.get('one').status, 'completed');
});
test('a restarted regular worker does not replay an uncertain incognito mutation', async () => {
  const bus = storageBus();
  const storage = bus.endpoint();
  await storage.local.set({ 'echo:incognito-request:interrupted': { state: 'processing', createdAt: Date.now(), command: { kind: 'message', message: { type: 'bookmarkAdd' }, sender: privateMeet } } });
  const regular = setup({ storage });
  await new Promise(resolve => setImmediate(resolve));
  const response = bus.values['echo:incognito-request:interrupted'];
  assert.equal(response.state, 'complete');
  assert.equal(response.result.ok, false);
  assert.match(response.result.error, /interrupted/);
  assert.equal(regular.records.size, 0);
});

test('shared-history requests reject unrelated senders and clear expired mailbox data', async () => {
  const bus = storageBus();
  const storage = bus.endpoint();
  await storage.local.set({
    'echo:incognito-request:untrusted': { state: 'pending', createdAt: Date.now(), command: { kind: 'message', message: { type: 'create' }, sender: { ...privateMeet, url: 'https://example.com/' } } },
    'echo:incognito-request:expired': { state: 'pending', createdAt: Date.now() - 120001, command: {} },
  });
  const regular = setup({ storage });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bus.values['echo:incognito-request:untrusted'].result.ok, false);
  assert.equal(bus.values['echo:incognito-request:expired'], undefined);
  assert.equal(regular.records.size, 0);
});
test('incognito history edits and deletes regular conversations through the same durable worker', async () => {
  const bus = storageBus();
  const regular = setup({ storage: bus.endpoint() });
  const privateWorker = setup({ incognito: true, storage: bus.endpoint() });
  await regular.send({ type: 'create', session: regular.session });
  await regular.send({ type: 'save', session: { ...regular.session, status: 'completed' } });
  await privateWorker.send({ type: 'rename', id: 'one', title: 'Edited in incognito' }, privatePage);
  assert.equal(regular.records.get('one').title, 'Edited in incognito');
  const deletion = await privateWorker.send({ type: 'delete', id: 'one' }, privatePage);
  assert.equal(deletion.ok, true);
  assert.equal(regular.records.size, 0);
  assert.equal(privateWorker.records.size, 0);
});

test('incognito folder access targets a regular Settings window, creating one when needed', async () => {
  for (const windows of [[{ id: 6, incognito: true }, { id: 21, incognito: false }], []]) {
    const bus = storageBus();
    const regular = setup({ storage: bus.endpoint(), windows });
    const privateWorker = setup({ incognito: true, storage: bus.endpoint() });
    assert.equal((await privateWorker.send({ type: 'openRegularSettings' }, privatePage)).ok, true);
    if (windows.length) {
      assert.equal(regular.openedTabs[0].windowId, 21);
      assert.equal(regular.openedWindows.length, 0);
    } else {
      assert.equal(regular.openedWindows[0].incognito, false);
      assert.equal(regular.openedWindows[0].url, 'chrome-extension://test/pages/settings.html');
    }
    assert.equal(privateWorker.openedTabs.length, 0);
    assert.equal(privateWorker.openedWindows.length, 0);
  }
});
