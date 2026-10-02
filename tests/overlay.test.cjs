const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('notification badge opens on demand, dismisses messages, and keeps its button visible', () => {
  class Element {
    constructor() { this.children = []; this.attributes = {}; this.dataset = {}; this.events = {}; }
    append(...items) { this.children.push(...items); items.forEach(item => item.parent = this); }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    attachShadow() { return this.shadow = new Element(); }
    addEventListener(name, callback) { this.events[name] = callback; }
    remove() { this.parent.children = this.parent.children.filter(item => item !== this); }
  }
  const documentEvents = {};
  const context = vm.createContext({
    document: { addEventListener(name, callback) { documentEvents[name] = callback; }, createElement: () => new Element(), createElementNS: () => new Element(), documentElement: new Element() },
    window: { addEventListener() {} },
  });
  vm.runInContext(fs.readFileSync('content/overlay.js', 'utf8'), context);
  const overlay = context.createMeetOverlay();
  const bar = overlay.panel.children.find(item => item.className === 'bar');
  assert.equal(bar.children.length, 5, 'handle, recording, bookmark, history, notifications');
  assert.equal(bar.children[1], overlay.toggle);
  assert.equal(overlay.stop, undefined);
  assert.equal(overlay.toggle.className, 'recording-toggle');
  assert.equal(overlay.toggle.getAttribute('aria-label'), 'Start recording');
  const dot = overlay.toggle.children.find(item => item.className === 'dot');
  assert.ok(dot);
  assert.equal(dot.getAttribute('aria-hidden'), 'true');
  assert.equal(overlay.handle.children.some(item => item.className === 'dot'), false);
  overlay.setButton(overlay.toggle, 'Stop recording', 'stop');
  assert.equal(overlay.toggle.children.at(-1), dot, 'the status dot survives recording changes');
  overlay.setButton(overlay.toggle, 'Start recording', 'play');
  assert.equal(overlay.toggle.children.at(-1), dot);
  const stack = overlay.panel.children.find(item => item.className === 'notifications');
  const count = () => overlay.notificationToggle.children[1].textContent;
  assert.equal(overlay.notificationToggle.hidden, false);
  overlay.notificationToggle.events.click();
  assert.equal(stack.hidden, false, 'the empty panel can be opened');
  assert.equal(stack.children[1], overlay.diagnostics);
  assert.equal(overlay.diagnostics.title, 'No transcript text or participant names. Attach this file to your bug report.');
  overlay.notificationToggle.events.click();
  overlay.setProblem('Please join a meeting');
  overlay.notify('Recording started');
  assert.equal(stack.children[1], overlay.diagnostics, 'diagnostics remains available when messages exist');
  assert.equal(count(), '2');
  assert.equal(stack.hidden, true, 'new messages stay hidden until requested');
  assert.equal(overlay.notificationToggle.hidden, false);
  overlay.notificationToggle.events.click();
  assert.equal(stack.hidden, false);
  assert.equal(overlay.notificationToggle.attributes['aria-expanded'], 'true');
  documentEvents.click({ composedPath: () => [overlay.host] });
  assert.equal(stack.hidden, false, 'clicks inside the widget keep the panel open');
  documentEvents.click({ composedPath: () => [] });
  assert.equal(stack.hidden, true, 'clicks outside close the panel');
  assert.equal(count(), '2', 'outside clicks preserve messages');
  assert.equal(overlay.notificationToggle.attributes['aria-expanded'], 'false');
  overlay.notificationToggle.events.click();
  stack.children.find(item => item.className === "notification").children[0].events.click();
  assert.equal(count(), '1');
  overlay.setProblem('Please join a meeting');
  assert.equal(count(), '1', 'polling must not reopen a dismissed condition');
  stack.children[0].children[1].events.click();
  assert.equal(overlay.notificationToggle.hidden, false);
  assert.equal(stack.hidden, true);
  assert.equal(count(), '1', 'closing the panel keeps existing messages');
  overlay.notify('A new message');
  assert.equal(count(), '2');
  assert.equal(overlay.notificationToggle.hidden, false);
  assert.equal(stack.hidden, true, 'new notifications stay closed until requested');
  overlay.notificationToggle.events.click();
  overlay.host.events.keydown({ key: 'Escape' });
  assert.equal(stack.hidden, true);
  assert.equal(count(), '2', 'closing the panel preserves pending messages');
  overlay.setProblem('');
  overlay.setProblem('Please join a meeting');
  assert.equal(count(), '3', 'a resolved condition can recur');
  overlay.notify('A new message');
  assert.equal(count(), '3', 'duplicate active messages do not inflate the badge');
  overlay.notificationToggle.events.click();
  stack.children[0].children[1].events.click();
  assert.equal(count(), '3', 'the panel close button never clears notifications');
  overlay.notificationToggle.events.click();
  for (const message of [...stack.children].filter(item => item.className === 'notification')) {
    message.children[0].events.click();
  }
  assert.equal(count(), '0');
  assert.equal(overlay.notificationToggle.hidden, false);
  overlay.setProblem('Please join a meeting');
  assert.equal(count(), '0', 'dismissing individual messages also suppresses active polling');
});

function movableOverlay() {
  let context;
  const listeners = {};
  class Element {
    constructor() {
      this.children = []; this.attributes = {}; this.dataset = {}; this.events = {};
      this.style = { setProperty(key, value) { this[key] = value; } };
    }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    attachShadow() { return new Element(); }
    addEventListener(name, callback) { this.events[name] = callback; }
    setPointerCapture() {}
    getBoundingClientRect() {
      return { width: 158, height: 48,
        left: this.style.left ? parseFloat(this.style.left) : 20,
        top: this.style.top ? parseFloat(this.style.top) : context.innerHeight - 48 - 24 };
    }
  }
  context = vm.createContext({ innerWidth: 1000, innerHeight: 800,
    document: { addEventListener() {}, createElement: () => new Element(), createElementNS: () => new Element(), documentElement: new Element() },
    window: { addEventListener(name, callback) { listeners[name] = callback; } },
  });
  vm.runInContext(fs.readFileSync('content/overlay.js', 'utf8'), context);
  const overlay = context.createMeetOverlay();
  return { overlay,
    drag(x, y) {
      const rect = overlay.host.getBoundingClientRect();
      overlay.handle.events.pointerdown({ button: 0, pointerId: 1, clientX: rect.left, clientY: rect.top, preventDefault() {} });
      overlay.handle.events.pointermove({ clientX: x, clientY: y });
      overlay.handle.events.pointerup();
    },
    resize(width, height) { context.innerWidth = width; context.innerHeight = height; listeners.resize(); },
  };
}

test('dragging near each corner snaps to 20px from both edges', () => {
  const page = movableOverlay();
  for (const [x, y, left, top] of [
    [30, 35, 20, 20], [800, 30, 822, 20],
    [25, 725, 20, 732], [800, 730, 822, 732],
  ]) {
    page.drag(x, y);
    const rect = page.overlay.host.getBoundingClientRect();
    assert.equal(rect.left, left);
    assert.equal(rect.top, top);
  }
  page.drag(300, 400);
  assert.equal(page.overlay.host.getBoundingClientRect().left, 300, 'free placement outside corners');
  assert.equal(page.overlay.host.getBoundingClientRect().top, 400);
});

test('resize preserves bottom and right offsets, including after temporary clamping', () => {
  const page = movableOverlay();
  page.drag(800, 730);
  page.resize(700, 500);
  assert.equal(page.overlay.host.getBoundingClientRect().left, 522);
  assert.equal(page.overlay.host.getBoundingClientRect().top, 432);
  page.resize(1000, 800);
  assert.equal(page.overlay.host.getBoundingClientRect().left, 822);
  assert.equal(page.overlay.host.getBoundingClientRect().top, 732);
  page.drag(600, 400); // 242px from right, 352px from bottom.
  page.resize(300, 200);
  assert.equal(page.overlay.host.getBoundingClientRect().left, 8);
  assert.equal(page.overlay.host.getBoundingClientRect().top, 8);
  page.resize(1000, 800);
  assert.equal(page.overlay.host.getBoundingClientRect().left, 600);
  assert.equal(page.overlay.host.getBoundingClientRect().top, 400);
});


test('notifications use space below top corners and above bottom corners without moving controls', () => {
  const page = movableOverlay();
  page.overlay.notify('A pending message');
  for (const x of [30, 800]) {
    page.drag(x, 30);
    const before = page.overlay.host.getBoundingClientRect();
    assert.equal(page.overlay.host.dataset.notificationDirection, 'below');
    assert.equal(page.overlay.host.style['--notification-space'], '724px');
    page.overlay.notificationToggle.events.click();
    assert.deepEqual(page.overlay.host.getBoundingClientRect(), before);
    page.overlay.notificationToggle.events.click();
    page.drag(x, 730);
    assert.equal(page.overlay.host.dataset.notificationDirection, 'above');
    assert.equal(page.overlay.host.style['--notification-space'], '724px');
  }
  page.drag(300, 350);
  assert.equal(page.overlay.host.dataset.notificationDirection, 'below');
  page.resize(1000, 500);
  assert.equal(page.overlay.host.dataset.notificationDirection, 'above');
  page.resize(1000, 800);
  assert.equal(page.overlay.host.dataset.notificationDirection, 'below');
});
