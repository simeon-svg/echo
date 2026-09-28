const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const records = new Map();
  const event = () => ({ addListener(fn) { this.fire = fn; } });
  const chrome = {
    runtime: { onMessage: event(), onStartup: event(), onInstalled: event(), getURL: path => `chrome-extension://test/${path}` },
    tabs: { onRemoved: event(), onUpdated: event(), create: async () => {} },
    action: { onClicked: event() }, alarms: { onAlarm: event(), create: async () => {} },
  };
  const context = vm.createContext({ chrome, console, Date, URL, crypto: require("node:crypto").webcrypto,
    allSessions: async () => structuredClone([...records.values()]),
    getSession: async id => structuredClone(records.get(id)),
    saveSession: async s => records.set(s.id, structuredClone(s)),
    deleteSession: async id => records.delete(id),
  });
  vm.runInContext(fs.readFileSync('storage/calls.js', 'utf8').replace(/export /g, ''), context);
  const code = fs.readFileSync('background/service-worker.js', 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInContext(code, context);
  const meet = { tab: { id: 7 }, url: 'https://meet.google.com/abc-defg-hij' };
  const page = { tab: { id: 8 }, url: 'chrome-extension://test/pages/transcript.html' };
  const send = (message, sender = meet) => new Promise(resolve => chrome.runtime.onMessage.fire(message, sender, resolve));
  const drain = () => vm.runInContext('queue', context);
  const session = { id: 'one', token: 'doc-one', title: 'Test', startTime: Date.now() - 10000,
    status: 'recording', participants: ['You'], blocks: [{ speaker: 'You', timestamp: Date.now(), text: 'Hello' }] };
  return { records, chrome, send, page, session, drain };
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

test('manual merge preserves old sessions and deletes all segments together', async () => {
  const t = setup();
  await t.send({ type: 'create', session: { ...t.session, status: 'completed' } });
  await t.send({ type: 'create', session: { ...t.session, id: 'two', token: 'two', status: 'completed' } });
  const merged = await t.send({ type: 'merge', ids: ['one', 'two'] }, t.page);
  assert.equal(merged.ok, true);
  assert.equal(t.records.size, 2);
  assert.equal((await t.send({ type: 'list' }, t.page)).value.length, 1);
  assert.equal((await t.send({ type: 'get', id: 'two' }, t.page)).value.blocks.length, 2);
  await t.send({ type: 'delete', id: merged.value }, t.page);
  assert.equal(t.records.size, 0);
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
