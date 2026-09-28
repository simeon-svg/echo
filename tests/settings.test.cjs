const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function meet(preferences) {
  let captions = false, notices = 0, enabled = 0, onChange;
  const saved = [], intervals = [];
  const element = () => ({ dataset: {}, events: {}, setAttribute() {}, addEventListener(name, fn) { this.events[name] = fn; } });
  const overlay = Object.fromEntries(['host', 'panel', 'handle', 'status', 'toggle', 'stop', 'history'].map(key => [key, element()]));
  overlay.notify = () => {};
  overlay.setButton = (button, label) => { button.label = label; };
  const button = (label, click) => ({ getClientRects: () => [1], getAttribute: () => label, click });
  const region = { getClientRects: () => [1], querySelectorAll: () => [] };
  const context = vm.createContext({
    chrome: {
      storage: { local: { get: async defaults => ({ ...defaults, ...preferences }) }, onChanged: { addListener(fn) { onChange = fn; } } },
      runtime: { sendMessage: async message => {
        if (message.type === 'create') saved.push(message.session);
        return { ok: true, value: message.type === 'beginCall' ? { callId: 'call' } : undefined };
      } },
    },
    document: { title: 'Meet — Test', body: {}, addEventListener() {}, querySelector: () => captions ? region : null,
      querySelectorAll: () => [button('Leave call'), captions
        ? button('Turn off captions', () => { captions = false; })
        : button('Turn on captions', () => { captions = true; enabled++; })] },
    window: { addEventListener() {} }, getComputedStyle: () => ({ visibility: 'visible' }),
    createMeetOverlay: () => overlay,
    MeetChatNotice: class { constructor() { this.warning = ''; } send() { notices++; } },
    MeetCaptionParser: class { constructor() { this.blocks = []; this.blocked = new Set(); } boundary() {} update() { return false; } },
    MutationObserver: class { observe() {} },
    setInterval(fn) { intervals.push(fn); }, setTimeout() {}, clearTimeout() {},
    structuredClone, crypto: require('node:crypto').webcrypto, console,
  });
  await vm.runInContext(fs.readFileSync('content/meet.js', 'utf8'), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { overlay, saved, notices: () => notices, enabled: () => enabled,
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
