const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function meet(preferences, language = 'en', faults = {}) {
  let captions = false, notices = 0, enabled = 0, disabled = 0, onChange;
  const saved = [], writes = [], intervals = [];
  let captionRows = [];
  const element = () => ({ dataset: {}, events: {}, setAttribute() {}, addEventListener(name, fn) { this.events[name] = fn; } });
  const overlay = Object.fromEntries(['host', 'panel', 'handle', 'status', 'toggle', 'stop', 'history'].map(key => [key, element()]));
  overlay.notify = () => {};
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
        if (message.type === 'create') saved.push(message.session);
        if (['create', 'save'].includes(message.type)) writes.push(message.session);
        return { ok: true, value: message.type === 'beginCall' ? { callId: 'call' } : undefined };
      } },
    },
    document: { title: 'Meet — Test', body: {}, addEventListener() {}, querySelector: () => captions ? region : null,
      querySelectorAll: selector => faults.controls ? [] : selector === (language === 'bg' ? '[role="region"][jscontroller="KPn5nb"]' : '[role="region"][aria-label="Captions"]') ? (captions ? [region] : []) : selector === 'button' ? [button('Leave call'), captions
        ? button('Turn off captions', () => { captions = false; disabled++; })
        : button('Turn on captions', () => { captions = true; enabled++; })] : [] },
    window: { addEventListener() {} }, getComputedStyle: () => ({ visibility: 'visible' }),
    createMeetOverlay: () => overlay,
    MeetChatNotice: class { constructor() { this.warning = ''; } send() { notices++; } },
    MeetCaptionParser: class { constructor() { this.blocks = []; this.blocked = new Set(); } boundary() {} update() { return false; } },
    MutationObserver: class { observe() {} },
    setInterval(fn) { intervals.push(fn); }, setTimeout() {}, clearTimeout() {},
    structuredClone, crypto: require('node:crypto').webcrypto, console,
  });
  vm.runInContext(fs.readFileSync('content/meet-adapter.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('content/captions.js', 'utf8'), context);
  context.MeetAdapter.captionRows = () => captionRows;
  const normalInCall = context.MeetAdapter.isInCall;
  context.MeetAdapter.isInCall = () => { if (faults.scan) throw new Error('Unsupported Meet layout'); return normalInCall(); };
  await vm.runInContext(fs.readFileSync('content/meet.js', 'utf8'), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { overlay, saved, writes, rows(value) { captionRows = value; }, notices: () => notices, enabled: () => enabled, captions: () => captions, disabled: () => disabled,
    turnOffCaptions() { captions = false; },
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
  await page.click('stop'); await page.click('toggle');
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

test('Bulgarian Meet starts automatically and captions stay enabled across Pause/Resume', async () => {
  const page = await meet({ announceRecording: false }, 'bg');
  await page.scan();
  assert.equal(page.saved.length, 1);
  assert.equal(page.enabled(), 1);
  await page.click('toggle');
  assert.match(page.overlay.toggle.label, /Resume/);
  await page.scan();
  assert.equal(page.captions(), true, 'pausing leaves captions on');
  assert.equal(page.disabled(), 0);
  await page.click('toggle'); await page.scan();
  assert.equal(page.enabled(), 1);
  assert.match(page.overlay.toggle.label, /Pause/);
  await page.click('stop'); await page.click('toggle'); await page.scan(); await page.scan();
  assert.equal(page.saved.length, 2);
  assert.equal(page.enabled(), 1);
  assert.equal(page.disabled(), 0, 'starting a new segment never switches captions off');
});

test('manual mode leaves captions off and creates nothing until Play, with chat disabled', async () => {
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
  await page.click('stop'); await page.click('toggle');
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

 test('resume turns captions back on if the user switched them off during pause', async () => {
  const page = await meet({ announceRecording: false });
  await page.scan();
  await page.click('toggle');
  page.turnOffCaptions();
  await page.scan();
  assert.equal(page.captions(), false, 'paused recording does not force captions on');
  await page.click('toggle');
  assert.equal(page.captions(), true);
  assert.equal(page.enabled(), 2);
  assert.equal(page.disabled(), 0);
});

test('stop stays visible and is disabled when unavailable', async () => {
  const page = await meet({ autoStart: false });
  assert.notEqual(page.overlay.stop.hidden, true);
  assert.equal(page.overlay.stop.disabled, true);
  await page.click('toggle'); await page.scan();
  assert.equal(page.overlay.stop.disabled, false);
  await page.click('stop');
  assert.notEqual(page.overlay.stop.hidden, true);
  assert.equal(page.overlay.stop.disabled, true);
});

test('recording indicator turns green after resume while stale paused rows remain', async () => {
  const page = await meet({ announceRecording: false });
  await page.scan();
  page.rows([{ id: 'old', speaker: 'Alice', text: 'Before pause' }]);
  await page.scan();
  await page.click('toggle');
  page.rows([{ id: 'old', speaker: 'Alice', text: 'Before pause private paused words' }]);
  await page.scan();
  await page.click('toggle');
  assert.equal(page.overlay.panel.dataset.state, 'recording');
  page.rows([
    { id: 'old', speaker: 'Alice', text: 'Before pause private paused words' },
    { id: 'new', speaker: 'Bob', text: 'After resume' },
  ]);
  await page.scan();
  await page.click('stop');
  assert.equal(page.overlay.panel.dataset.state, 'stopped');
  assert.deepEqual(page.writes.at(-1).blocks.map(block => block.text), ['Before pause', 'After resume']);
});
