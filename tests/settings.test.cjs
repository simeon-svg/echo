const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function meet(preferences, language = 'en', faults = {}) {
  let captions = false, notices = 0, enabled = 0, disabled = 0, onChange;
  const saved = [], writes = [], intervals = [], timers = new Map(), downloads = [], messages = [], notifications = [];
  let nextTimer = 0;
  let now = Date.now();
  class ClockDate extends Date { static now() { return now; } }
  let captionRows = [];
  const element = () => ({ dataset: {}, events: {}, setAttribute() {}, addEventListener(name, fn) { this.events[name] = fn; } });
  const overlay = Object.fromEntries(['host', 'panel', 'handle', 'status', 'toggle', 'history', 'diagnostics'].map(key => [key, element()]));
  overlay.notify = (message, kind) => notifications.push({ message, kind });
  overlay.setProblem = message => { overlay.problem = message; };
  overlay.setButton = (button, label) => { button.label = label; };
  const button = (label, click) => {
    const names = { 'Leave call': 'CQylAd', 'Turn off captions': 'RrG0hf', 'Turn on captions': 'RrG0hf' };
    const translated = { 'Leave call': 'Напускане на обаждането', 'Turn off captions': 'Изключване на надписите', 'Turn on captions': 'Включване на надписите' };
    return { getClientRects: () => [1], getAttribute: key => key === 'aria-label' ? (language === 'bg' ? translated[label] : label) : key === 'jsname' && language === 'bg' ? names[label] : null, querySelectorAll: () => [], click };
  };
  const region = { getClientRects: () => [1], querySelectorAll: () => [] };
  const context = vm.createContext({
    chrome: {
      storage: { local: { get: async defaults => { if (faults.storage) throw new Error('Extension context invalidated'); return { ...defaults, ...preferences }; } }, onChanged: { addListener(fn) { onChange = fn; } } },
      runtime: { getManifest: () => ({ version: '1.4.0' }), sendMessage: async message => {
        messages.push(message);
        if (['create', 'save'].includes(message.type) && faults.finalized) return { ok: false, code: 'SESSION_FINALIZED', error: 'This session was finalized after interruption. Stop and start a new transcript.' };
        if (['create', 'save'].includes(message.type) && faults.saveFailure) return { ok: false, error: 'Local save failed' };
        if (message.type === 'create') saved.push(message.session);
        if (['create', 'save'].includes(message.type)) writes.push(message.session);
        if (message.type === 'save' && faults.saveGate) await faults.saveGate;
        if (message.type === 'save' && faults.finalizedAfterGate) return { ok: false, code: 'SESSION_FINALIZED', error: 'This session was finalized after interruption. Stop and start a new transcript.' };
        return { ok: true, value: message.type === 'beginCall' ? { callId: require('node:crypto').randomUUID() } : undefined };
      } },
    },
    Date: ClockDate, Blob, URL: { createObjectURL: blob => { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    document: { documentElement: { append() {} }, createElement: () => ({ click() {}, remove() {} }), title: 'Meet — Test', body: {}, addEventListener() {}, querySelector: () => captions ? region : null,
      querySelectorAll: selector => faults.controls ? [] : selector === (language === 'bg' ? '[role="region"][jscontroller="KPn5nb"]' : '[role="region"][aria-label="Captions"]') ? (captions ? [region] : []) : selector === 'button' ? [button('Leave call'), captions
        ? button('Turn off captions', () => { captions = false; disabled++; })
        : button('Turn on captions', () => { captions = !faults.captionEnable; enabled++; })] : [] },
    window: { addEventListener() {} }, getComputedStyle: () => ({ visibility: 'visible' }),
    createMeetOverlay: () => overlay,
    MeetChatNotice: class { constructor() { this.warning = ''; } send() { notices++; } },
    MeetCaptionParser: class { constructor() { this.blocks = []; this.blocked = new Set(); } boundary() {} update() { return false; } },
    MutationObserver: class { observe() {} },
    setInterval(fn) { intervals.push(fn); }, setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); },
    structuredClone, crypto: require('node:crypto').webcrypto, console,
  });
  vm.runInContext(fs.readFileSync('content/meet-adapter.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('content/captions.js', 'utf8'), context);
  context.MeetAdapter.captionRows = () => captionRows;
  const normalInCall = context.MeetAdapter.isInCall;
  context.MeetAdapter.isInCall = () => { if (faults.scan) throw new Error('Unsupported Meet layout'); return normalInCall(); };
  vm.runInContext(fs.readFileSync('content/diagnostics.js', 'utf8'), context);
  await vm.runInContext(fs.readFileSync('content/meet.js', 'utf8'), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { overlay, saved, writes, downloads, messages, notifications, advance(milliseconds) { now += milliseconds; }, rows(value) { captionRows = value; }, notices: () => notices, enabled: () => enabled, captions: () => captions, disabled: () => disabled,
    turnOffCaptions() { captions = false; },
    async flushSaves() { const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn()); await settle(); },
    async heartbeat() { intervals[1](); await settle(); },
    async scan() { intervals[0](); await settle(); },
    async click(name) { await overlay[name].events.click(); await settle(); },
    change(key, value) { onChange({ [key]: { newValue: value } }, 'local'); },
  };
}

test('defaults automatically enable captions, record, and announce once across segments', async () => {
  const page = await meet({});
  await page.scan();
  assert.equal(page.saved.length, 1);
  assert.equal(page.notices(), 1);
  await page.click('toggle'); await page.click('toggle');
  assert.equal(page.saved.length, 2);
  assert.equal(page.notices(), 1);
});

test('widget stays visible with a persistent problem when no Meet controls are recognized, then recovers', async () => {
  const faults = { controls: true };
  const page = await meet({ announceRecording: false }, 'bg', faults);
  await page.scan(); await page.scan();
  assert.equal(page.overlay.host.hidden, false);
  assert.match(page.overlay.problem, /Join a meeting/);
  assert.equal(page.overlay.toggle.disabled, true);
  assert.equal(page.saved.length, 0);
  faults.controls = false;
  await page.scan(); await page.scan();
  assert.equal(page.saved.length, 1);
  assert.equal(page.overlay.problem, '');
});

test('startup errors still leave a visible widget and specific reload instructions', async () => {
  const page = await meet({}, 'en', { storage: true });
  assert.equal(page.overlay.host.hidden, false);
  assert.match(page.overlay.problem, /Echo could not start.*Reload/);
  assert.equal(page.overlay.toggle.disabled, true);
  assert.equal(page.overlay.panel.dataset.state, 'error');
});

test('DOM scan exceptions are displayed and a successful later scan clears them', async () => {
  const faults = { scan: true };
  const page = await meet({ announceRecording: false }, 'bg', faults);
  await page.scan();
  assert.match(page.overlay.problem, /Echo cannot read this meeting/);
  assert.equal(page.overlay.host.hidden, false);
  assert.equal(page.saved.length, 0);
  faults.scan = false;
  await page.scan(); await page.scan();
  assert.equal(page.saved.length, 1);
  assert.equal(page.overlay.problem, '');
});

test('Bulgarian Meet uses one start/stop button and keeps captions enabled', async () => {
  const page = await meet({ announceRecording: false }, 'bg');
  await page.scan();
  assert.equal(page.saved.length, 1);
  assert.equal(page.enabled(), 1);
  assert.equal(page.overlay.toggle.label, 'Stop recording');
  assert.equal(page.overlay.toggle.dataset.recording, 'true');
  await page.click('toggle');
  assert.equal(page.overlay.toggle.label, 'Start recording');
  assert.equal(page.overlay.toggle.dataset.recording, 'false');
  assert.equal(page.writes.at(-1).status, 'completed');
  assert.equal(page.writes.at(-1).reason, 'stopped');
  assert.ok(page.writes.at(-1).endTime);
  await page.scan();
  assert.equal(page.saved.length, 1, 'auto-start does not restart after Stop');
  await page.click('toggle'); await page.scan();
  assert.equal(page.saved.length, 2);
  assert.notEqual(page.saved[0].id, page.saved[1].id);
  assert.notEqual(page.saved[0].callId, page.saved[1].callId);
  assert.equal(page.saved[0].meetingId, page.saved[1].meetingId);
  assert.equal(page.enabled(), 1);
  assert.equal(page.disabled(), 0);
});

test('manual mode leaves captions off and creates nothing until Start, with chat disabled', async () => {
  const page = await meet({ autoStart: false, announceRecording: false });
  await page.scan(); await page.scan();
  assert.equal(page.enabled(), 0);
  assert.equal(page.saved.length, 0);
  assert.match(page.overlay.toggle.label, /Start/);
  assert.equal(page.overlay.toggle.disabled, false);
  await page.click('toggle'); await page.scan();
  assert.equal(page.saved.length, 1);
  assert.equal(page.notices(), 0);
  page.change('announceRecording', true);
  await page.click('toggle'); await page.click('toggle');
  assert.equal(page.saved.length, 2);
  assert.equal(page.notices(), 0, 'enabling announcements later must not announce a subsequent segment');
});

test('automatic recording and chat announcements are independent preferences', async () => {
  const automatic = await meet({ autoStart: true, announceRecording: false });
  await automatic.scan();
  assert.equal(automatic.saved.length, 1); assert.equal(automatic.notices(), 0);
  const manual = await meet({ autoStart: false, announceRecording: true });
  await manual.click('toggle'); await manual.scan();
  assert.equal(manual.saved.length, 1); assert.equal(manual.notices(), 1);
});

test('starting again turns captions back on if switched off after Stop', async () => {
  const page = await meet({ announceRecording: false });
  await page.scan();
  await page.click('toggle');
  page.turnOffCaptions();
  await page.scan();
  assert.equal(page.captions(), false, 'stopped recording does not force captions on');
  await page.click('toggle'); await page.scan();
  assert.equal(page.captions(), true);
  assert.equal(page.enabled(), 2);
  assert.equal(page.disabled(), 0);
  assert.equal(page.saved.length, 2);
});

test('single control stays visible and is disabled outside the meeting', async () => {
  const faults = { controls: true };
  const page = await meet({ autoStart: false }, 'en', faults);
  assert.notEqual(page.overlay.toggle.hidden, true);
  assert.equal(page.overlay.toggle.disabled, true);
  faults.controls = false;
  await page.scan();
  assert.equal(page.overlay.toggle.disabled, false);
  await page.click('toggle'); await page.scan();
  await page.click('toggle');
  assert.equal(page.overlay.toggle.disabled, false, 'Start remains available after Stop');
});

test('new recording excludes old and stopped speech and preserves the completed entry', async () => {
  const page = await meet({ announceRecording: false });
  await page.scan();
  page.rows([{ id: 'old', speaker: 'Alice', text: 'First recording' }]);
  await page.scan();
  await page.click('toggle');
  const first = structuredClone(page.writes.at(-1));
  page.rows([{ id: 'old', speaker: 'Alice', text: 'First recording private stopped words' }]);
  await page.scan(); await page.heartbeat(); await page.flushSaves();
  assert.deepEqual(page.writes.at(-1), first, 'stopped speech is never persisted');
  await page.click('toggle');
  assert.equal(page.overlay.panel.dataset.state, 'recording');
  page.rows([
    { id: 'old', speaker: 'Alice', text: 'First recording private stopped words' },
    { id: 'new', speaker: 'Bob', text: 'Second recording' },
  ]);
  await page.scan();
  await page.click('toggle');
  assert.equal(page.overlay.panel.dataset.state, 'stopped');
  assert.equal(page.saved.length, 2);
  assert.deepEqual(first.blocks.map(block => block.text), ['First recording']);
  assert.deepEqual(page.writes.at(-1).blocks.map(block => block.text), ['Second recording']);
  assert.notEqual(first.callId, page.writes.at(-1).callId);
});

test('slow storage coalesces caption snapshots and does not accumulate heartbeats', async () => {
  let release;
  const faults = {};
  const page = await meet({ announceRecording: false }, 'en', faults);
  await page.scan();
  faults.saveGate = new Promise(resolve => { release = resolve; });
  page.rows([{ id: 'row', speaker: 'Alice', text: 'First words' }]);
  await page.scan(); await page.flushSaves();
  for (let n = 0; n < 20; n++) {
    page.rows([{ id: 'row', speaker: 'Alice', text: `First words revision ${n}` }]);
    await page.scan(); await page.flushSaves(); await page.heartbeat();
  }
  assert.equal(page.writes.length, 2, 'only initial creation and one in-flight caption snapshot');
  release(); delete faults.saveGate;
  await new Promise(resolve => setImmediate(resolve));
  await page.flushSaves();
  assert.equal(page.writes.length, 3, 'one latest snapshot replaces all intermediate changes');
  assert.equal(page.writes.at(-1).blocks.at(-1).text, 'First words revision 19');
});


test('Stop preserves the final caption snapshot while an earlier save is blocked', async () => {
  let release;
  const faults = {};
  const page = await meet({ announceRecording: false }, 'en', faults);
  await page.scan();
  faults.saveGate = new Promise(resolve => { release = resolve; });
  page.rows([{ id: 'row', speaker: 'Alice', text: 'First words' }]);
  await page.scan(); await page.flushSaves();
  page.rows([{ id: 'row', speaker: 'Alice', text: 'First words and the final sentence' }]);
  await page.scan();
  const stopped = page.click('toggle');
  assert.equal(page.overlay.toggle.disabled, true);
  await page.click('toggle');
  assert.equal(page.saved.length, 1, 'clicks during final save do not create another recording');
  release(); delete faults.saveGate;
  await stopped;
  assert.equal(page.writes.at(-1).status, 'completed');
  assert.equal(page.writes.at(-1).blocks.at(-1).text, 'First words and the final sentence');
});


test('diagnostics can be downloaded after startup failure without extension messaging', async () => {
  const page = await meet({}, 'en', { storage: true });
  await page.click('diagnostics');
  assert.equal(page.downloads.length, 1);
  const report = JSON.parse(await page.downloads[0].text());
  assert.equal(report.state.mode, 'error');
  assert.ok(report.events.some(event => event.source === 'startup' && event.code === 'extension-disconnected'));
  assert.equal(report.controls.leave.found, true);
});


test('Stop cancels a start waiting for captions and leaves manual Start available', async () => {
  const faults = { captionEnable: true };
  const page = await meet({ autoStart: false, announceRecording: false }, 'en', faults);
  await page.click('toggle');
  assert.equal(page.overlay.toggle.label, 'Stop recording');
  assert.equal(page.overlay.toggle.disabled, false);
  assert.equal(page.saved.length, 0);
  await page.click('toggle');
  delete faults.captionEnable;
  await page.scan();
  assert.equal(page.overlay.toggle.label, 'Start recording');
  assert.equal(page.saved.length, 0);
  await page.click('toggle'); await page.scan();
  assert.equal(page.saved.length, 1);
});

test('failed final save is retried before creating another recording', async () => {
  const faults = {};
  const page = await meet({ announceRecording: false }, 'en', faults);
  await page.scan();
  page.rows([{ id: 'row', speaker: 'Alice', text: 'Keep these words' }]);
  await page.scan();
  faults.saveFailure = true;
  await page.click('toggle');
  assert.equal(page.overlay.toggle.label, 'Retry Save');
  assert.equal(page.saved.length, 1);
  await page.click('toggle');
  assert.equal(page.overlay.toggle.label, 'Retry Save');
  assert.equal(page.saved.length, 1);
  delete faults.saveFailure;
  await page.click('toggle');
  assert.equal(page.overlay.toggle.label, 'Start recording');
  assert.equal(page.writes.at(-1).status, 'completed');
  assert.equal(page.writes.at(-1).blocks[0].text, 'Keep these words');
  assert.equal(page.saved.length, 1);
  await page.click('toggle');
  assert.equal(page.saved.length, 2);
});


test('joining another call creates a new meeting identity even in the same tab', async () => {
  const faults = {};
  const page = await meet({ announceRecording: false }, 'en', faults);
  await page.scan();
  faults.controls = true;
  await page.scan(); page.advance(3000); await page.scan();
  faults.controls = false;
  await page.scan(); await page.scan();
  assert.equal(page.saved.length, 2);
  assert.ok(page.saved[0].meetingId);
  assert.notEqual(page.saved[0].meetingId, page.saved[1].meetingId);
});


test('a finalized recording stops stale heartbeats and offers a fresh Start instead of Retry Save', async () => {
  const faults = {};
  const page = await meet({ announceRecording: false }, 'en', faults);
  await page.scan();
  const original = page.saved[0];
  faults.finalized = true;
  await page.heartbeat();
  assert.equal(page.overlay.toggle.label, 'Start recording');
  assert.equal(page.overlay.panel.dataset.state, 'stopped');
  assert.match(page.overlay.problem, /Start recording/);
  assert.equal(page.notifications.filter(n => n.kind === 'error').length, 1);
  const count = page.messages.length;
  await page.heartbeat(); await page.heartbeat();
  assert.equal(page.messages.length, count, 'closed transcripts are never retried by the heartbeat');
  faults.finalized = false;
  await page.click('toggle');
  assert.equal(page.saved.length, 2);
  assert.notEqual(page.saved[1].id, original.id);
  assert.equal(page.overlay.panel.dataset.state, 'recording');
  assert.equal(page.overlay.problem, '');
});


test('queued snapshots stop after a finalized-session response without repeated requests or warnings', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const faults = {};
  const page = await meet({ announceRecording: false }, 'en', faults);
  await page.scan();
  faults.saveGate = gate;
  await page.heartbeat();
  const stopping = page.click('toggle');
  faults.finalizedAfterGate = true;
  release(); await stopping;
  assert.equal(page.messages.filter(message => message.type === 'save').length, 1);
  assert.equal(page.notifications.filter(n => n.kind === 'error').length, 1);
  assert.equal(page.overlay.toggle.label, 'Start recording');
  assert.equal(page.overlay.panel.dataset.state, 'stopped');
  faults.saveGate = null; faults.finalizedAfterGate = false;
  await page.click('toggle');
  assert.equal(page.saved.length, 2);
});


test('missing captions persist one gap, close on recovery, and keep it separate from speech', async () => {
  const faults = {};
  const page = await meet({ announceRecording: false }, 'en', faults);
  await page.scan();
  page.rows([{ id: 'old', speaker: 'Alice', text: 'Before gap' }]);
  await page.scan(); await page.flushSaves();
  faults.captionEnable = true;
  page.advance(6000); page.turnOffCaptions();
  await page.scan(); await page.flushSaves();
  assert.equal(page.writes.at(-1).gaps.length, 1);
  assert.equal(page.writes.at(-1).gaps[0].endTime, null);
  page.advance(2000); await page.scan(); await page.flushSaves();
  assert.equal(page.writes.at(-1).gaps.length, 1);
  faults.captionEnable = false;
  page.advance(6000); await page.scan();
  page.advance(1000); await page.scan(); await page.flushSaves();
  assert.ok(page.writes.at(-1).gaps[0].endTime > page.writes.at(-1).gaps[0].timestamp);
  page.rows([{ id: 'new', speaker: 'Bob', text: 'After gap' }]);
  await page.scan(); await page.flushSaves();
  assert.deepEqual(page.writes.at(-1).blocks.map(b => b.text), ['Before gap', 'After gap']);
});


test('recordings persist self identity independently of the captured account name', async () => {
  const page = await meet({ announceRecording: false });
  await page.scan();
  page.rows([{ id: 'self', speaker: 'Alex', isSelf: true, text: 'My words' },
    { id: 'other', speaker: 'Alex', isSelf: false, text: 'Their words' }]);
  await page.scan();
  await page.flushSaves();
  await page.click('toggle');
  const last = page.writes.at(-1);
  assert.deepEqual(Array.from(last.blocks, b => b.isSelf), [true, false]);
});
