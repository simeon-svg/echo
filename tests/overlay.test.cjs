const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('notifications stack outside the controls, dismiss independently, and expire after ten seconds', () => {
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
  const timers = new Map(); let next = 0;
  const context = vm.createContext({
    document: { createElement: () => new Element(), createElementNS: () => new Element(), documentElement: new Element() },
    window: { addEventListener() {} },
    setTimeout(callback, delay) { const id = ++next; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(fs.readFileSync('content/overlay.js', 'utf8'), context);
  const overlay = context.createMeetOverlay();
  const originalControls = [...overlay.panel.children];
  overlay.notify('Recording started'); overlay.notify('Message could not be sent', 'error');
  const stack = overlay.host.shadow.children.find(item => item.className === 'notifications');
  assert.equal(stack.children.length, 2);
  assert.deepEqual(overlay.panel.children, originalControls);
  assert.equal(stack.children[1].attributes.role, 'alert');
  assert.ok([...timers.values()].every(timer => timer.delay === 10000));
  stack.children[0].children[1].events.click();
  assert.equal(stack.children.length, 1);
  assert.equal(timers.size, 1);
  [...timers.values()][0].callback();
  assert.equal(stack.children.length, 0);
});
