const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('merge requests backup permission from the Merge button user gesture', async () => {
  const created = [];
  class Element {
    constructor(tag, text = '') {
      this.tagName = tag.toUpperCase(); this.textContent = text; this.children = []; this.listeners = {};
      this.attributes = {}; this.checked = false; this.className = '';
      created.push(this);
    }
    append(...children) { this.children.push(...children); children.forEach(child => { child.parentNode = this; }); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    async fire(name) { for (const callback of this.listeners[name] || []) await callback({ preventDefault() {}, stopPropagation() {} }); }
    showModal() {} close() {} remove() {}
  }
  const body = new Element('body');
  const context = vm.createContext({
    document: { body, createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag),
      addEventListener() {}, querySelectorAll: () => [] },
    setTimeout, clearTimeout, Date,
  });
  vm.runInContext(fs.readFileSync('pages/shared.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
  let activeGesture = false, permissionRequests = 0;
  const resultPromise = context.confirmMerge({
    count: 2, backupAvailable: true,
    beforeDeleteBackups: async () => {
      permissionRequests++;
      assert.equal(activeGesture, true, 'permission request must run directly from the Merge click');
    },
  });
  created.find(element => element.tagName === 'INPUT').checked = true;
  const merge = created.find(element => element.tagName === 'BUTTON' && element.textContent === 'Merge');
  activeGesture = true;
  await merge.fire('click');
  activeGesture = false;
  const result = await resultPromise;
  assert.equal(permissionRequests, 1);
  assert.deepEqual({ ...result }, { confirmed: true, deleteBackups: true });
});

test('prepared backup access restores a prompt-state handle from the confirmation click', async () => {
  let activeGesture = false, queries = 0, requests = 0;
  const handle = {
    async queryPermission() { queries++; return 'prompt'; },
    async requestPermission() {
      requests++;
      if (!activeGesture) throw new Error('requestPermission lost its user gesture');
      return 'granted';
    },
  };
  const context = vm.createContext({ getBackupDirectory: async () => handle });
  const source = fs.readFileSync('pages/backup-access.js', 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^import .*;\n/gm, '').replace(/export /g, '') +
    '\nglobalThis.backupAccess = { prepareBackupAccess, requestBackupAccess };';
  vm.runInContext(source, context);
  await context.backupAccess.prepareBackupAccess();
  activeGesture = true;
  await context.backupAccess.requestBackupAccess();
  activeGesture = false;
  assert.equal(requests, 1);
  assert.equal(queries, 0, 'requestPermission must be the first permission operation in the click handler');
});

test('a permission-required backup indicator is an actionable button', async () => {
  const created = [];
  class Element {
    constructor(tag, text = '') {
      this.tagName = tag.toUpperCase(); this.textContent = text; this.listeners = {}; this.attributes = {};
      created.push(this);
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    async fire(name) {
      for (const callback of this.listeners[name] || []) await callback({ preventDefault() {}, stopPropagation() {} });
    }
  }
  const context = vm.createContext({
    document: { createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag), addEventListener() {} },
    setTimeout, clearTimeout, Date,
  });
  vm.runInContext(fs.readFileSync('pages/shared.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
  let grants = 0;
  const dot = context.backupStatusDot({ status: 'permission-required', error: 'Folder access required' }, () => { grants++; });
  assert.equal(dot.tagName, 'BUTTON');
  assert.match(dot.title, /grant folder access/i);
  await dot.fire('click');
  assert.equal(grants, 1);
});

test('Echo confirmation dialogs resolve from their own styled controls', async () => {
  const created = [];
  class Element {
    constructor(tag, text = '') {
      this.tagName = tag.toUpperCase(); this.textContent = text; this.children = []; this.listeners = {};
      this.attributes = {}; this.className = '';
      created.push(this);
    }
    append(...children) { this.children.push(...children); children.forEach(child => { child.parentNode = this; }); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    async fire(name) { for (const callback of this.listeners[name] || []) await callback({ preventDefault() {} }); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() { this.removed = true; }
  }
  const body = new Element('body');
  const context = vm.createContext({
    document: { body, createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag), addEventListener() {} },
    setTimeout, clearTimeout, Date,
  });
  vm.runInContext(fs.readFileSync('pages/shared.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
  const resultPromise = context.confirmAction({
    title: 'Back up existing conversations?', message: 'Echo can process them now.',
    confirmLabel: 'Back up now', cancelLabel: 'Only future conversations',
  });
  const dialog = created.find(element => element.tagName === 'DIALOG');
  assert.equal(dialog.open, true);
  assert.equal(created.some(element => element.textContent === 'Back up existing conversations?'), true);
  const confirm = created.find(element => element.tagName === 'BUTTON' && element.textContent === 'Back up now');
  await confirm.fire('click');
  assert.equal(await resultPromise, true);
  assert.equal(dialog.removed, true);
});

test('Echo message dialogs replace native alerts with one styled acknowledgement', async () => {
  const created = [];
  class Element {
    constructor(tag, text = '') {
      this.tagName = tag.toUpperCase(); this.textContent = text; this.children = []; this.listeners = {};
      this.className = ''; this.attributes = {}; created.push(this);
    }
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    async fire(name) { for (const callback of this.listeners[name] || []) await callback({ preventDefault() {} }); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() { this.removed = true; }
  }
  const context = vm.createContext({
    document: { body: new Element('body'), createElement: tag => new Element(tag),
      createElementNS: (_namespace, tag) => new Element(tag), addEventListener() {} },
    setTimeout, clearTimeout, Date,
  });
  vm.runInContext(fs.readFileSync('pages/shared.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
  const closed = context.showMessageDialog({
    title: 'Backup file was kept', message: 'The local conversation was deleted, but its TXT backup remains.',
  });
  const buttons = created.filter(element => element.tagName === 'BUTTON');
  assert.deepEqual(buttons.map(button => button.textContent), ['OK']);
  await buttons[0].fire('click');
  await closed;
});

test('incognito backup deletion uses shared permission or opens regular Settings', async () => {
  for (const permission of ['granted', 'prompt']) {
    const requests = [];
    const context = vm.createContext({ chrome: { extension: { inIncognitoContext: true } },
      getBackupDirectory: async () => { throw new Error('Must not read temporary incognito handles'); },
      request: async type => { requests.push(type); return { permission }; },
    });
    vm.runInContext(fs.readFileSync('pages/backup-access.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '') + '\nglobalThis.access = { prepareBackupAccess, requestBackupAccess };', context);
    await context.access.prepareBackupAccess();
    if (permission === 'granted') assert.equal(await context.access.requestBackupAccess(), true);
    else await assert.rejects(context.access.requestBackupAccess(), /regular Echo Settings/);
    assert.equal(requests.includes('openRegularSettings'), permission !== 'granted');
  }
});
