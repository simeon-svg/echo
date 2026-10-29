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

// Sanitized structure from the user's October 1 Meet embedded-chat capture.
function embeddedEditor(draft = '') {
  let sent = 0;
  const field = {
    textContent: draft, isContentEditable: true, getClientRects: () => [1],
    getAttribute: name => ({ jsname: 'yrriRe', role: 'textbox', contenteditable: 'true' })[name] || null,
    focus() {}, dispatchEvent() { send.disabled = !field.textContent.trim(); },
  };
  const body = { innerText: '' };
  const send = {
    disabled: !draft, getClientRects: () => [1],
    getAttribute: name => ({ jsname: 'GBTyxb', 'aria-label': 'Send message' })[name] || null,
    querySelectorAll: () => [],
    click() { sent++; body.innerText = field.textContent; field.textContent = ''; },
  };
  const context = vm.createContext({ Event: class {}, InputEvent: class {}, setTimeout,
    getComputedStyle: () => ({ visibility: 'visible' }),
    document: { body, querySelectorAll: selector => selector === '[contenteditable="true"][role="textbox"][jsname="yrriRe"]' ? [field] : selector === 'button' ? [send] : [] },
  });
  vm.runInContext(fs.readFileSync('content/meet-adapter.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('content/chat.js', 'utf8'), context);
  return { context, field, notice: vm.runInContext('new MeetChatNotice()', context), count: () => sent };
}
test('the captured embedded Chat editor sends the recording announcement', async () => {
  const t = embeddedEditor();
  await t.notice.send(() => true, () => {});
  assert.equal(t.count(), 1);
  assert.equal(t.notice.warning, '');
});

test('embedded Chat preserves drafts and never sends after the call ends', async () => {
  for (const [draft, active] of [['Unfinished client message', true], ['', false]]) {
    const t = embeddedEditor(draft);
    await t.notice.send(() => active, () => {});
    assert.equal(t.count(), 0);
    assert.equal(t.field.textContent, draft);
    assert.match(t.notice.warning, /draft|Call ended/);
  }
});

function framedChat({ draft = '', ready = true, wrongOrigin = false, dropResult = false, framePath = '/u/2/embed/space/example' } = {}) {
  const child = embeddedEditor(draft);
  let elapsed = 0;
  const parents = new Set(), children = new Set();
  const parentWindow = { addEventListener: (_, fn) => parents.add(fn), removeEventListener: (_, fn) => parents.delete(fn),
    postMessage(data) { if (dropResult && data.type === 'result') return; queueMicrotask(() => { for (const fn of parents) fn({ data, source: childWindow, origin: wrongOrigin ? 'https://example.com' : 'https://chat.google.com' }); }); } };
  const childWindow = { parent: parentWindow, addEventListener: (_, fn) => children.add(fn),
    postMessage(data) { queueMicrotask(() => { for (const fn of children) fn({ data, source: parentWindow, origin: 'https://meet.google.com' }); }); } };
  const frame = { src: `https://chat.google.com${framePath}?origin=https%3A%2F%2Fmeet.google.com`, contentWindow: childWindow,
    isConnected: true, getClientRects: () => [1] };
  const query = child.context.document.querySelectorAll;
  child.context.document.querySelectorAll = selector => ready ? query(selector) : [];
  Object.assign(child.context, { window: childWindow, location: { origin: 'https://chat.google.com', href: frame.src }, URL });
  vm.runInContext(fs.readFileSync('content/chat-bridge.js', 'utf8'), child.context);
  const parent = vm.createContext({ window: parentWindow, location: { origin: 'https://meet.google.com' },
    URL, crypto: require('node:crypto').webcrypto, Date: { now: () => elapsed }, setInterval, clearInterval, setTimeout,
    getComputedStyle: () => ({ visibility: 'visible' }),
    document: { querySelectorAll: selector => selector === 'iframe' ? [frame] : [] },
  });
  for (const file of ['meet-adapter', 'chat', 'chat-bridge']) vm.runInContext(fs.readFileSync(`content/${file}.js`, 'utf8'), parent);
  return { child, frame, parent, notice: vm.runInContext('new MeetChatNotice("Recording notice")', parent),
    ready() { ready = true; }, advance(ms) { elapsed += ms; },
    forge(data, origin = 'https://example.com', source = parentWindow) { for (const fn of children) fn({ data, origin, source }); },
    listeners: () => parents.size,
  };
}
test('the Meet page sends one announcement through the captured cross-origin Chat iframe', async () => {
  const t = framedChat();
  await Promise.all([t.notice.send(() => true, () => {}), t.notice.send(() => true, () => {})]);
  assert.equal(t.child.count(), 1);
  assert.equal(t.notice.warning, '');
  assert.equal(t.listeners(), 0);
});
test('the iframe bridge waits for a delayed chat composer', async () => {
  const t = framedChat({ ready: false });
  setTimeout(() => t.ready(), 150);
  await t.notice.send(() => true, () => {});
  assert.equal(t.child.count(), 1);
  assert.equal(t.notice.warning, '');
});
test('the iframe bridge reports an existing draft without sending or changing it', async () => {
  const t = framedChat({ draft: 'Keep this draft' });
  await t.notice.send(() => true, () => {});
  assert.equal(t.child.count(), 0);
  assert.equal(t.child.field.textContent, 'Keep this draft');
  assert.match(t.notice.warning, /draft/);
});
test('ending the call while waiting for Chat cancels the announcement', async () => {
  const t = framedChat({ ready: false });
  let active = true;
  setTimeout(() => { active = false; t.ready(); }, 30);
  await t.notice.send(() => active, () => {});
  assert.equal(t.child.count(), 0);
  assert.match(t.notice.warning, /Call ended/);
  assert.equal(t.listeners(), 0);
});
test('the Chat helper ignores messages from a different origin or a different parent', async () => {
  const t = framedChat();
  const data = { channel: 'echo-meet-chat-v1', id: 'forged', type: 'send', message: 'Do not send' };
  t.forge(data);
  t.forge(data, 'https://meet.google.com', {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(t.child.count(), 0);
});

test('a missing trusted confirmation reports uncertainty and never retries the send', async () => {
  const t = framedChat({ wrongOrigin: true });
  // Wrong-origin readiness replies must not trigger a send.
  setTimeout(() => t.advance(10001), 30);
  await t.notice.send(() => true, () => {});
  assert.equal(t.child.count(), 0);
  assert.match(t.notice.warning, /not be confirmed/);
  assert.equal(t.listeners(), 0);
  await t.notice.send(() => true, () => {});
  assert.equal(t.child.count(), 0);
});
test('native rich-text insertion updates the composer and enables Send', async () => {
  const t = embeddedEditor();
  let nativeInsertions = 0;
  t.context.window = { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) };
  t.context.document.createRange = () => ({ selectNodeContents() {} });
  t.context.document.execCommand = (command, _, text) => {
    assert.equal(command, 'insertText'); nativeInsertions++;
    t.field.textContent = text; t.field.dispatchEvent(); return true;
  };
  await t.notice.send(() => true, () => {});
  assert.equal(nativeInsertions, 1);
  assert.equal(t.count(), 1);
  assert.equal(t.notice.warning, '');
});
test('the iframe helper never sends a duplicate request ID twice', async () => {
  const t = framedChat();
  const data = { channel: 'echo-meet-chat-v1', id: 'repeat', type: 'send', message: 'Recording notice' };
  // Use the known, trusted parent obtained from the frame context.
  t.forge(data, 'https://meet.google.com', t.child.context.window.parent);
  t.forge(data, 'https://meet.google.com', t.child.context.window.parent);
  await new Promise(resolve => setImmediate(resolve));
  t.forge(data, 'https://meet.google.com', t.child.context.window.parent);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(t.child.count(), 1);
});

test('a lost result after sending is uncertain and never causes a second announcement', async () => {
  const t = framedChat({ dropResult: true });
  setTimeout(() => t.advance(20001), 30);
  await t.notice.send(() => true, () => {});
  assert.equal(t.child.count(), 1);
  assert.match(t.notice.warning, /not be confirmed/);
  await t.notice.send(() => true, () => {});
  assert.equal(t.child.count(), 1);
});

test('an already opening chat panel is not toggled closed while its composer loads', async () => {
  const t = setup();
  let expanded = true, ready = false, clicks = 0;
  const open = { getAttribute: key => key === 'aria-expanded' ? String(expanded) : null,
    click() { clicks++; expanded = !expanded; } };
  t.context.MeetAdapter.chatInput = () => ready && expanded ? t.field : null;
  t.context.MeetAdapter.chatButton = () => open;
  // Accelerate polling while retaining the delayed-composer sequence.
  t.context.setTimeout = resolve => { ready = true; queueMicrotask(resolve); };
  await t.notice.send(() => true, () => {});
  assert.equal(clicks, 0);
  assert.equal(t.count(), 1);
  assert.equal(t.notice.warning, '');
});


test('Meet recognizes the account-neutral embedded Chat URL used in October', async () => {
  const t = framedChat({ framePath: '/embed/space/example' });
  assert.equal(t.parent.MeetEmbeddedChat.frame(), t.frame);
  await t.notice.send(() => true, () => {});
  assert.equal(t.child.count(), 1);
  assert.equal(t.notice.warning, '');
});

test('embedded chat URL variants still reject unrelated paths and origins', () => {
  const t = framedChat();
  for (const url of [
    'https://example.com/embed/space/example?origin=https://meet.google.com',
    'https://chat.google.com/embed/space/example?origin=https://example.com',
    'https://chat.google.com/embed/space/example/extra?origin=https://meet.google.com',
    'https://chat.google.com/u/not-an-account/embed/space/example?origin=https://meet.google.com',
    'https://chat.google.com/embed/space/example',
  ]) {
    t.frame.src = url;
    assert.equal(t.parent.MeetEmbeddedChat.frame(), null);
  }
});

test('the embedded helper is registered for both observed Google Chat URL variants', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const helper = manifest.content_scripts.find(script => script.all_frames);
  assert.ok(helper.matches.includes('https://chat.google.com/u/*/embed/space/*'));
  assert.ok(helper.matches.includes('https://chat.google.com/embed/space/*'));
});
