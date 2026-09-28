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

async function setup(initialStatus = {}) {
  const ids = ['settings', 'auto-start', 'announce-recording', 'announce-message-controls', 'announce-message', 'backup-enabled', 'backup-controls', 'backup-status',
    'backup-last', 'reconnect-folder', 'backup-now', 'disconnect-folder', 'choose-folder'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const notices = [];
  const dialogs = [];
  const savedSettings = [];
  let activeGesture = false, pickerCalls = 0, nativeConfirmCalls = 0, savedHandle = null;
  const handle = { name: 'Documents', async requestPermission() { return 'granted'; } };
  const backupStatus = { enabled: initialStatus.enabled ?? false, folderName: initialStatus.folderName ?? null,
    permission: initialStatus.permission ?? 'missing', lastSuccess: null };
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
    request: async (type, values) => type === 'backupFolderStatus'
      ? backupStatus
      : type === 'backupEnable' ? (backupStatus.enabled = !!values.enabled, { backed: 0, failed: 0 })
      : { backed: 0, failed: 0 },
    clearBackupDirectory: async () => {}, getBackupDirectory: async () => null,
    setBackupDirectory: async value => { savedHandle = value; },
    chrome: { storage: { local: { async get(defaults) { return defaults; }, async set(values) { savedSettings.push(values); }, async remove() {} }, onChanged: { addListener() {} } } },
  });
  const source = fs.readFileSync('pages/settings.js', 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return {
    notices, dialogs, elements, savedSettings, pickerCalls: () => pickerCalls, nativeConfirmCalls: () => nativeConfirmCalls,
    savedHandle: () => savedHandle,
    async enableBackup() {
      elements['backup-enabled'].checked = true;
      activeGesture = true;
      await elements['backup-enabled'].fire('change');
    },
    async disableBackup() {
      elements['backup-enabled'].checked = false;
      await elements['backup-enabled'].fire('change');
    },
    async disableAnnouncements() {
      elements['announce-recording'].checked = false;
      await elements['announce-recording'].fire('change');
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

test('disabling automatic backup hides the folder controls but keeps the folder connected', async () => {
  const page = await setup({ enabled: true, folderName: 'Documents', permission: 'granted' });
  assert.equal(page.elements['backup-controls'].hidden, false);
  await page.disableBackup();
  assert.equal(page.elements['backup-controls'].hidden, true);
  assert.equal(page.elements['backup-enabled'].checked, false);
});

test('announcement message is visible when enabled and saves custom text', async () => {
  const page = await setup();
  assert.equal(page.elements['announce-message-controls'].hidden, false);
  assert.match(page.elements['announce-message'].value, /Quick heads-up/);
  page.elements['announce-message'].value = 'Custom announcement';
  await page.elements['announce-message'].fire('change');
  assert.equal(page.savedSettings.at(-1).announceMessage, 'Custom announcement');
  await page.disableAnnouncements();
  assert.equal(page.elements['announce-message-controls'].hidden, true);
});
