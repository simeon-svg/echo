const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(draft = '', language = 'en') {
  let sent = 0;
  class Textarea {
    get value() { return this.current || ''; }
    set value(value) { this.current = value; }
    getClientRects() { return [1]; }
    dispatchEvent() {}
  }
  const field = new Textarea(); field.value = draft;
  const body = { innerText: '' };
  const send = { disabled: false, getClientRects: () => [1], getAttribute: name => name === 'aria-label' ? (language === 'bg' ? 'Изпратете съобщение' : 'Send a message') : name === 'jsname' && language === 'bg' ? 'SoqoBf' : null,
    querySelectorAll: () => language === 'bg' ? [{ textContent: 'send' }] : [], click() { sent++; body.innerText = field.value; field.value = ''; } };
  const context = vm.createContext({ HTMLTextAreaElement: Textarea, Event: class {}, setTimeout,
    getComputedStyle: () => ({ visibility: 'visible' }),
    document: { body, querySelectorAll: selector => selector === (language === 'bg' ? 'textarea[jsname="YPqjbf"]' : 'textarea[aria-label="Send a message"]') ? [field] : selector === 'button' ? [send] : [] } });
  vm.runInContext(fs.readFileSync('content/meet-adapter.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('content/chat.js', 'utf8'), context);
  return { context, notice: vm.runInContext('new MeetChatNotice()', context), field, count: () => sent, message: () => body.innerText };
}
test('notice sends once even when start is requested concurrently or repeatedly', async () => {
  const t = setup();
  await Promise.all([t.notice.send(() => true, () => {}), t.notice.send(() => true, () => {})]);
  await t.notice.send(() => true, () => {});
  assert.equal(t.count(), 1);
  assert.equal(t.notice.warning, '');
});
test('an existing chat draft is never overwritten or sent', async () => {
  const t = setup('My unfinished message');
  await t.notice.send(() => true, () => {});
  assert.equal(t.count(), 0);
  assert.equal(t.field.value, 'My unfinished message');
  assert.match(t.notice.warning, /draft/);
});
test('a call ending before sending cannot transmit a notice', async () => {
  const t = setup();
  await t.notice.send(() => false, () => {});
  assert.equal(t.count(), 0);
  assert.equal(t.field.value, '');
});

test('notice sends the user-customized message', async () => {
  const t = setup();
  const notice = vm.runInContext('new MeetChatNotice("Custom announcement")', t.context);
  await notice.send(() => true, () => {});
  assert.equal(t.count(), 1);
  assert.equal(t.message(), 'Custom announcement');
  assert.equal(t.field.value, '');
});

test('Bulgarian chat sends once through technical selectors', async () => {
  const t = setup('', 'bg');
  await t.notice.send(() => true, () => {});
  await t.notice.send(() => true, () => {});
  assert.equal(t.count(), 1);
  assert.equal(t.notice.warning, '');
});

test('Bulgarian chat preserves an existing user draft', async () => {
  const t = setup('Моята чернова', 'bg');
  await t.notice.send(() => true, () => {});
  assert.equal(t.count(), 0);
  assert.equal(t.field.value, 'Моята чернова');
  assert.match(t.notice.warning, /draft/);
});
