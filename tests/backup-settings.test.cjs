const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor() {
    this.checked = false; this.disabled = false; this.hidden = false; this.textContent = '';
    this.listeners = {}; this.classList = { add() {}, remove() {} };
  }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  async fire(name) { for (const callback of this.listeners[name] || []) await callback({ target: this, preventDefault() {} }); }
}

async function setup() {
  const ids = ['settings', 'auto-start', 'announce-recording', 'backup-enabled', 'backup-controls', 'backup-status',
    'backup-last', 'reconnect-folder', 'backup-now', 'disconnect-folder', 'choose-folder'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const notices = [];
  const dialogs = [];
  let activeGesture = false, pickerCalls = 0, nativeConfirmCalls = 0, savedHandle = null;
  const handle = { name: 'Documents', async requestPermission() { return 'granted'; } };
  const context = vm.createContext({
    console, setTimeout, clearTimeout,
    document: { querySelector: selector => elements[selector.slice(1)] },
    window: { async showDirectoryPicker() {
      pickerCalls++;
      if (!activeGesture) throw new Error("Failed to execute 'showDirectoryPicker' on 'Window': Must be handling a user gesture to show a file picker.");
      activeGesture = false;
      return handle;
    } },
    confirm() { nativeConfirmCalls++; activeGesture = false; return true; },
    async confirmAction(options) { dialogs.push(options); return true; },
    notify(message, kind) { notices.push({ message, kind }); },
    request: async type => type === 'backupFolderStatus'
      ? { enabled: false, folderName: null, permission: 'missing', lastSuccess: null }
      : { backed: 0, failed: 0 },
    clearBackupDirectory: async () => {}, getBackupDirectory: async () => null,
    setBackupDirectory: async value => { savedHandle = value; },
    chrome: { storage: { local: { async get(defaults) { return defaults; }, async set() {}, async remove() {} }, onChanged: { addListener() {} } } },
  });
  const source = fs.readFileSync('pages/settings.js', 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return {
    notices, dialogs, elements, pickerCalls: () => pickerCalls, nativeConfirmCalls: () => nativeConfirmCalls,
    savedHandle: () => savedHandle,
    async enableBackup() {
      elements['backup-enabled'].checked = true;
      activeGesture = true;
      await elements['backup-enabled'].fire('change');
    },
  };
}

test('the first backup toggle opens the directory picker within the original user gesture', async () => {
  const page = await setup();
  await page.enableBackup();
  assert.equal(page.pickerCalls(), 1);
  assert.ok(page.savedHandle(), page.notices.map(item => item.message).join('\n'));
  assert.equal(page.notices.some(item => item.message.includes('Must be handling a user gesture')), false);
  assert.equal(page.nativeConfirmCalls(), 0);
  assert.deepEqual(page.dialogs.map(dialog => dialog.title), [
    'Back up conversations as readable TXT files?',
    'Back up existing conversations?',
  ]);
});
