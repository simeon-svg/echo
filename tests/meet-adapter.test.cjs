const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const fixture = require('./fixtures/meet-bg.json');

class Node {
  constructor(tag, attributes = {}, children = [], text = '') {
    this.tagName = tag.toUpperCase(); this.attributes = attributes;
    this.children = children; this.textContent = text; this.shown = true;
    this.clicks = 0; children.forEach(c => { c.parentElement = this; });
  }
  getAttribute(key) { return this.attributes[key] ?? null; }
  getClientRects() { return this.shown ? [1] : []; }
  click() { this.clicks++; }
  matches(selector) {
    return selector.split(',').some(s => {
      s = s.trim();
      const tag = s.match(/^[a-z]+/i)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      const cls = s.match(/\.([\w-]+)/)?.[1];
      if (cls && !(this.attributes.class || '').split(/\s+/).includes(cls)) return false;
      return [...s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, k, v]) =>
        v === undefined ? this.getAttribute(k) !== null : this.getAttribute(k) === v);
    });
  }
  querySelectorAll(selector) {
    return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
}
function setup(label = 'bg') {
  const button = key => new Node('button', { ...fixture[key].attributes, ...(label === 'bg' ? {} : { 'aria-label': label }) },
    fixture[key].icons.map(icon => new Node('i', { class: 'google-symbols notranslate', 'aria-hidden': 'true' }, [], icon)));
  const leave = button('leave'), captions = button('captions'), chat = button('chat');
  const row = new Node('div', { class: 'nMcdL' }, [new Node('span', { class: 'NWpY1d' }, [], 'Вие'), new Node('div', { class: 'ygicle' }, [], 'Hello')]);
  const region = new Node('div', { ...fixture.region.attributes, ...(label === 'bg' ? {} : { 'aria-label': label }) }, [row]);
  const body = new Node('body', {}, [leave, captions, chat, region]);
  const context = vm.createContext({ document: body, getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) });
  vm.runInContext(fs.readFileSync('content/meet-adapter.js', 'utf8'), context);
  return { adapter: context.MeetAdapter, body, leave, captions, chat, region, row, Node };
}
test('captured Bulgarian controls and caption structure work with any translated labels', () => {
  for (const label of ['bg', 'Leave call', '任意の翻訳', '']) {
    const t = setup(label);
    assert.equal(t.adapter.isInCall(), true);
    assert.equal(t.adapter.captionRegion(), t.region);
    assert.equal(t.adapter.captionsEnabled(), true);
    assert.equal(t.adapter.chatButton(), t.chat);
    assert.equal(t.adapter.captionRows()[0].text, 'Hello');
    assert.equal(t.adapter.captionRows()[0].speaker, 'You');
    t.adapter.setCaptionsEnabled(true); assert.equal(t.captions.clicks, 0);
    t.adapter.setCaptionsEnabled(false); assert.equal(t.captions.clicks, 1);
    t.region.shown = false;
    assert.equal(t.adapter.captionsEnabled(), false);
    t.adapter.setCaptionsEnabled(true); assert.equal(t.captions.clicks, 2);
  }
});
test('unknown or ambiguous controls are never clicked, including localized decoys', () => {
  const t = setup();
  t.body.children.push(new Node('button', { ...fixture.captions.attributes }));
  t.adapter.setCaptionsEnabled(false);
  assert.equal(t.captions.clicks, 0);
  t.leave.shown = false; assert.equal(t.adapter.isInCall(), false);
  t.body.children.pop();
  t.captions.attributes.jsname = 'changed'; t.captions.children = [];
  assert.equal(t.adapter.captionButton(), null);
});
test('caption row identities survive updates and names other than local aliases are preserved', () => {
  const t = setup();
  const id = t.adapter.captionRows()[0].id;
  t.row.children[0].textContent = 'Мария'; t.row.children[1].textContent = 'Здравей';
  const next = t.adapter.captionRows()[0];
  assert.equal(next.id, id); assert.equal(next.speaker, 'Мария'); assert.equal(next.text, 'Здравей');
});

test('technical controls work without aria-label attributes or any caption rows', () => {
  const t = setup();
  for (const node of [t.leave, t.captions, t.chat, t.region]) delete node.attributes['aria-label'];
  t.region.children = [];
  assert.equal(t.adapter.isInCall(), true);
  assert.equal(t.adapter.captionsEnabled(), true);
  assert.equal(t.adapter.chatButton(), t.chat);
});

test('localized chat input and send control ignore other textareas and ambiguous sends', () => {
  const t = setup();
  const field = new Node('textarea', { jsname: 'YPqjbf', 'aria-label': 'Изпратете съобщение' });
  const send = new Node('button', { jsname: 'SoqoBf', 'aria-label': 'Изпратете съобщение' }, [new Node('i', { class: 'google-symbols notranslate' }, [], 'send')]);
  t.body.children.push(field, send, new Node('textarea', { 'aria-label': 'Other form' }));
  assert.equal(t.adapter.chatInput(), field);
  assert.equal(t.adapter.chatSendButton(), send);
  t.body.children.push(new Node('textarea', { jsname: 'YPqjbf' }));
  assert.equal(t.adapter.chatInput(), null);
  t.body.children.push(new Node('button', { jsname: 'SoqoBf' }, [new Node('i', { class: 'google-symbols notranslate' }, [], 'send')]));
  assert.equal(t.adapter.chatSendButton(), null);
});


test('diagnostics distinguish ambiguous controls without exporting their text or clicking them', () => {
  const t = setup();
  t.body.children.push(new Node('button', { jsname: 'CQylAd', 'aria-label': 'PRIVATE_LABEL' }, [], 'PRIVATE_TEXT'));
  const report = t.adapter.diagnostics();
  assert.equal(report.leave.candidates, 2);
  assert.equal(report.leave.found, false);
  assert.equal(report.captions.found, true);
  assert.equal(t.leave.clicks, 0);
  assert.equal(t.captions.clicks, 0);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|Hello|Вие/);
});


test('self identity is preserved when Meet resolves the account name', () => {
  const t = setup();
  t.body.children.push(new Node('div', { 'aria-label': 'Google Account: Alex (alex@example.com)' }));
  const own = t.adapter.captionRows()[0];
  assert.equal(own.isSelf, true);
  assert.equal(own.speaker, 'Alex');
  t.row.children[0].textContent = 'Alex';
  const other = t.adapter.captionRows()[0];
  assert.equal(other.isSelf, false);
  assert.equal(other.speaker, 'Alex');
});

test('manually enabled captions remain available when the toolbar button disappears', () => {
  const t = setup();
  t.captions.shown = false;
  assert.equal(t.adapter.captionButton(), null);
  assert.equal(t.adapter.captionsEnabled(), true);
  assert.equal(t.adapter.captionRows()[0].text, 'Hello');
  assert.equal(t.adapter.setCaptionsEnabled(true), false);
  t.region.shown = false;
  assert.equal(t.adapter.captionsEnabled(), false);
});

test('October captions menu opens first, then enables live captions without toggling speech translation', () => {
  const t = setup();
  t.region.shown = false;
  t.captions.shown = false;
  const menu = new Node('button', { 'aria-label': '任意の翻訳', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-pressed': 'false' },
    [new Node('i', { class: 'google-symbols notranslate' }, [], 'translate_cc')]);
  const translation = new Node('button', { jsname: 'YpX94b' });
  t.body.children.push(menu, translation);
  assert.equal(t.adapter.captionButton(), menu);
  assert.equal(t.adapter.setCaptionsEnabled(true), true);
  assert.equal(menu.clicks, 1);
  menu.attributes['aria-expanded'] = 'true';
  assert.equal(t.adapter.setCaptionsEnabled(true), false, 'do not close the menu while its controls load');
  t.captions.shown = true;
  t.captions.children = [new Node('i', { class: 'google-symbols notranslate' }, [], 'check')];
  assert.equal(t.adapter.setCaptionsEnabled(true), true);
  assert.equal(t.captions.clicks, 1);
  assert.equal(translation.clicks, 0);
  t.region.shown = true;
  t.captions.shown = false;
  assert.equal(t.adapter.captionsEnabled(), true);
  assert.equal(t.adapter.setCaptionsEnabled(true), false);
  assert.equal(menu.clicks, 1);
});

test('duplicate caption menus or toggles remain ambiguous and cannot be clicked', () => {
  const t = setup();
  t.region.shown = false;
  t.captions.shown = false;
  const menu = () => new Node('button', { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
    [new Node('i', { class: 'google-symbols notranslate' }, [], 'translate_cc')]);
  const first = menu(), second = menu();
  t.body.children.push(first, second);
  assert.equal(t.adapter.captionButton(), null);
  assert.equal(t.adapter.setCaptionsEnabled(true), false);
  assert.equal(first.clicks + second.clicks, 0);
  assert.equal(t.adapter.diagnostics().captions.candidates, 2);
  second.shown = false;
  t.captions.shown = true;
  t.body.children.push(new Node('button', { jsname: 'RrG0hf' }));
  assert.equal(t.adapter.captionButton(), null, 'ambiguous toggles must not fall back to the menu');
  assert.equal(t.adapter.setCaptionsEnabled(true), false);
});
