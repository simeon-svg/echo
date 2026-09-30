const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const records = new Map();
  let historyReads = 0;
  let now = Date.now();
  class ClockDate extends Date { static now() { return now; } }
  const forgottenBackups = [], removedBackups = [], syncedCalls = [], createdAlarms = [];
  const event = () => ({ addListener(fn) { this.fire = fn; } });
  const chrome = {
    runtime: { onMessage: event(), onStartup: event(), onInstalled: event(), getURL: path => `chrome-extension://test/${path}` },
    tabs: { onRemoved: event(), onUpdated: event(), create: async () => {} },
    action: { onClicked: event() }, alarms: { onAlarm: event(), get: async () => undefined, create: async (...args) => createdAlarms.push(args) },
    storage: { local: { set: async () => {}, get: async defaults => defaults } },
  };
  const context = vm.createContext({ chrome, console, Date: ClockDate, URL, crypto: require("node:crypto").webcrypto,
    allSessions: async () => { historyReads++; return structuredClone([...records.values()]); },
    openSessions: async () => structuredClone([...records.values()].filter(s => ["recording", "paused"].includes(s.status))),
    sessionsForTab: async id => structuredClone([...records.values()].filter(s => s.tabId === id)),
    sessionsForCall: async id => structuredClone([...records.values()].filter(s => (s.callId || s.id) === id)),
    saveSessions: async sessions => { for (const s of sessions) records.set(s.id, structuredClone(s)); },
    deleteSessions: async ids => { for (const id of ids) records.delete(id); },
    getSession: async id => structuredClone(records.get(id)),
    saveSession: async s => records.set(s.id, structuredClone(s)),
    deleteSession: async id => records.delete(id),
    backupFolderStatus: async () => ({ enabled: false }),
    forgetCallBackup: async id => forgottenBackups.push(id), refreshBackupAlert: async () => {},
    removeCallBackup: async call => { removedBackups.push(call.id); return null; },
    syncCalls: async calls => { syncedCalls.push(...structuredClone(calls)); return { backed: calls.length, failed: 0 }; }, syncOne: async () => ({}),
    withBackupStatus: async calls => calls,
  });
  vm.runInContext(fs.readFileSync('storage/calls.js', 'utf8').replace(/export /g, ''), context);
  const code = fs.readFileSync('background/service-worker.js', 'utf8').replace(/^import[\s\S]*?;\n/gm, '');
  vm.runInContext(code, context);
  const meet = { tab: { id: 7 }, url: 'https://meet.google.com/abc-defg-hij' };
  const page = { tab: { id: 8 }, url: 'chrome-extension://test/pages/transcript.html' };
  const send = (message, sender = meet) => new Promise(resolve => chrome.runtime.onMessage.fire(message, sender, resolve));
  const drain = () => vm.runInContext('queue', context);
  const session = { id: 'one', token: 'doc-one', title: 'Test', startTime: Date.now() - 10000,
    status: 'recording', participants: ['You'], blocks: [{ speaker: 'You', timestamp: Date.now(), text: 'Hello' }] };
  return { records, createdAlarms,
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

test('start/stop segments form one call, including rename and combined export data', async () => {
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
