const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Small DOM adapter: run the real page's render, checkbox and export handlers.
class Element {
  constructor(tag, text = '', className = '') {
    this.tag = tag; this.textContent = text; this.className = className; this.children = [];
    this.dataset = {}; this.style = { setProperty() {} }; this.events = {}; this.attributes = {};
    this.classList = { add: name => { this.className += ' ' + name; }, toggle: () => {} };
  }
  append(...children) { this.children.push(...children); children.forEach(c => { c.parentNode = this; }); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  before(child) { child.parentNode = this.parentNode || this; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  async fire(name) { for (const callback of this.events[name] || []) await callback({ target: this, preventDefault() {} }); }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tag === selector) ? [child] : [],
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  click() { return this.fire('click'); }
}
async function page() {
  const nodes = new Map();
  const query = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element('div')); return nodes.get(selector); };
  const fixture = { title: 'Test', status: 'completed', startTime: 1, endTime: 10, participants: ['Alice', 'Bob'], blocks: [
    { id: 1, speaker: 'Alice', timestamp: 1, text: 'First sentence.' },
    { id: 2, speaker: 'Alice', timestamp: 2, text: 'Same speaker continuation.' },
    { id: 3, speaker: 'Bob', timestamp: 3, text: 'Exclude this reply.' },
    { id: 4, speaker: 'Alice', timestamp: 4, text: 'Last reply.' },
  ] };
  let copied = '', downloaded;
  const document = { querySelector: query, querySelectorAll: selector => query('#blocks').querySelectorAll(selector),
    createElement: tag => new Element(tag), body: new Element('body') };
  const context = vm.createContext({ document, location: { search: '?id=test' }, URLSearchParams, Blob,
    URL: { createObjectURL: blob => { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} },
    navigator: { clipboard: { writeText: async text => { copied = text; } } },
    request: async () => structuredClone(fixture), time: String, date: String, minutes: () => 1,
    plainText: () => '', isOpen: () => false, statusDot: () => null, notify() {},
    node: (tag, text, className) => new Element(tag, text, className),
    iconButton: label => { const b = new Element('button'); b.setAttribute('aria-label', label); return b; },
    setInterval() {}, setTimeout() {}, console,
  });
  vm.runInContext(fs.readFileSync('pages/transcript.js', 'utf8').replace(/^import .*;\n/gm, ''), context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, query, copied: () => copied, downloaded: () => downloaded,
    turns: () => query('#blocks').querySelectorAll('.speaker-turn'),
    execute: code => vm.runInContext(code, context) };
}
test('select all then uncheck the middle turn excludes it from both clipboard and TXT', async () => {
  const p = await page();
  await p.execute('selectAll.checked = true; selectAll.fire("change")');
  const middle = p.turns()[1].querySelector('input'); middle.checked = false; await middle.fire('change');
  await p.execute('copySelected.fire("click")');
  assert.match(p.copied(), /First sentence/);
  assert.match(p.copied(), /Same speaker continuation/);
  assert.match(p.copied(), /Last reply/);
  assert.doesNotMatch(p.copied(), /Exclude this reply/);
  await p.execute('downloadSelected.fire("click")');
  assert.equal(await p.downloaded().text(), p.copied());
});
test('selecting only the first turn copies that turn, including all its paragraphs', async () => {
  const p = await page();
  const first = p.turns()[0].querySelector('input'); first.checked = true; await first.fire('change');
  await p.execute('copySelected.fire("click")');
  assert.match(p.copied(), /First sentence/);
  assert.match(p.copied(), /Same speaker continuation/);
  assert.doesNotMatch(p.copied(), /Last reply|Exclude this reply/);
});
test('selection survives render and can be cleared completely', async () => {
  const p = await page();
  for (const index of [0, 2]) {
    const check = p.turns()[index].querySelector('input'); check.checked = true; await check.fire('change');
  }
  p.execute('render()');
  assert.deepEqual(p.turns().map(turn => turn.querySelector('input').checked), [true, false, true]);
  await p.execute('copySelected.fire("click")');
  assert.match(p.copied(), /First sentence/); assert.match(p.copied(), /Last reply/);
  assert.doesNotMatch(p.copied(), /Exclude this reply/);
  await p.execute('selectAll.checked = false; selectAll.fire("change")');
  assert.equal(p.execute('selectedText()'), '');
  assert.equal(p.execute('copySelected.disabled && downloadSelected.disabled'), true);
});
