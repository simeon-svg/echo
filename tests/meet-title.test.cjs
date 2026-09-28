const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(text = '') {
    this.textContent = text; this.children = []; this.attributes = {}; this.events = {};
    this.dataset = {}; this.hidden = false; this.disabled = false;
  }
  getAttribute(name) { return this.attributes[name] || null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getClientRects() { return [1]; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  append(...children) { this.children.push(...children); }
  querySelector(selector) {
    if (selector === '.NWpY1d') return this.speaker;
    if (selector === '.ygicle') return this.caption;
    return null;
  }
  querySelectorAll(selector) { return selector === '.nMcdL' ? this.rows || [] : []; }
}

test('new unnamed meetings use a date-at-time title and the account name for You', async () => {
  const leave = new Element(); leave.setAttribute('aria-label', 'Leave call');
  const captionsButton = new Element(); captionsButton.setAttribute('aria-label', 'Turn off captions');
  const account = new Element(); account.setAttribute('aria-label', 'Google Account: Alex Johnson (alex@example.com)');
  const region = new Element();
  const row = new Element(); row.speaker = new Element('You'); row.caption = new Element('Hello');
  region.rows = [row];
  const document = {
    title: 'Meet — Meet', body: new Element(),
    querySelector(selector) { return selector.includes('Captions') ? region : null; },
    querySelectorAll(selector) {
      if (selector === 'button[aria-label]') return [leave, captionsButton];
      if (selector === '[aria-label]') return [account];
      return [];
    },
    addEventListener() {},
  };
  const saved = [];
  const overlayButton = () => new Element();
  const context = vm.createContext({
    document, window: { addEventListener() {} },
    getComputedStyle: () => ({ visibility: 'visible' }),
    MutationObserver: class { observe() {} },
    setInterval() {}, setTimeout(callback) { callback(); return 1; }, clearTimeout() {},
    structuredClone, crypto: require('node:crypto').webcrypto,
    chrome: {
      storage: { local: { get: async defaults => defaults }, onChanged: { addListener() {} } },
      runtime: { sendMessage: async message => {
        if (message.type === 'beginCall') return { ok: true, value: { callId: 'call', meetUrl: 'https://meet.google.com/abc' } };
        if (message.type === 'create' || message.type === 'save') saved.push(structuredClone(message.session));
        return { ok: true, value: undefined };
      } },
    },
    createMeetOverlay: () => ({ host: new Element(), panel: new Element(), handle: new Element(), status: new Element(),
      toggle: overlayButton(), stop: overlayButton(), history: overlayButton(), notify() {}, setButton() {} }),
    MeetChatNotice: class { send() {} },
    MeetCaptionParser: class {
      constructor() { this.blocks = []; this.blocked = new Set(); }
      boundary() {}
      update(rows) {
        if (!this.blocks.length && rows.length) this.blocks = [{ speaker: rows[0].speaker, timestamp: Date.now(), text: rows[0].text }];
        return rows.length > 0;
      }
    },
    Element,
  });
  vm.runInContext(fs.readFileSync('content/meet.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  const session = saved.at(-1);
  const date = new Date(session.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  assert.equal(session.title, `${date} at ${time}`);
  assert.deepEqual(session.participants, ['Alex Johnson']);
  assert.equal(session.blocks[0].speaker, 'Alex Johnson');
});
