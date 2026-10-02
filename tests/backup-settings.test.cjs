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
  const ids = ['include-ai-prompt', 'ai-prompt-controls', 'ai-prompt', 'display-name', 'settings', 'auto-start', 'announce-recording', 'announce-message-controls', 'announce-message', 'backup-enabled', 'backup-controls', 'backup-status',
    'backup-last', 'incognito-backup-controls', 'manage-backup-regular', 'reconnect-folder', 'backup-now', 'disconnect-folder', 'choose-folder'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const notices = [];
  const requests = [];
  const dialogs = [];
  const savedSettings = [];
  let activeGesture = false, pickerCalls = 0, nativeConfirmCalls = 0, savedHandle = null;
  const handle = { name: 'Documents', async requestPermission() { return 'granted'; } };
  const backupStatus = { enabled: initialStatus.enabled ?? false, folderName: initialStatus.folderName ?? null,
    permission: initialStatus.permission ?? 'missing', lastSuccess: null };
  const context = vm.createContext({ initPageShell() {},
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
    request: async (type, values) => { requests.push({ type, values }); return type === 'backupFolderStatus'
      ? backupStatus
      : type === 'backupEnable' ? (backupStatus.enabled = !!values.enabled, { backed: 0, failed: 0 })
      : { backed: 0, failed: 0 }; },
    clearBackupDirectory: async () => {}, getBackupDirectory: async () => null,
    setBackupDirectory: async value => { savedHandle = value; },
    chrome: { extension: { inIncognitoContext: !!initialStatus.incognito }, storage: { local: { async get(defaults) { return { ...defaults, includeAiPrompt: initialStatus.includeAiPrompt ?? false, aiPrompt: initialStatus.aiPrompt ?? defaults.aiPrompt, displayName: initialStatus.displayName || "" }; }, async set(values) { if (initialStatus.failPreference && "includeAiPrompt" in values) throw new Error("Save failed"); savedSettings.push(values); }, async remove() {} }, onChanged: { addListener() {} } } },
  });
  const source = fs.readFileSync('pages/settings.js', 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInContext(fs.readFileSync('pages/transcript-export.js', 'utf8').replace(/export /g, ''), context);
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return {
    notices, dialogs, elements, savedSettings, requests, pickerCalls: () => pickerCalls, nativeConfirmCalls: () => nativeConfirmCalls,
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

test('incognito Settings uses the shared granted backup folder without selecting a temporary one', async () => {
  const page = await setup({ incognito: true, folderName: 'Documents', permission: 'granted' });
  await page.enableBackup();
  assert.equal(page.pickerCalls(), 0);
  assert.equal(page.elements['backup-enabled'].checked, true);
  assert.equal(page.elements['choose-folder'].hidden, true);
  assert.equal(page.elements['disconnect-folder'].hidden, true);
  assert.equal(page.elements['incognito-backup-controls'].hidden, false);
  assert.equal(page.requests.some(item => item.type === 'backupEnable' && item.values.enabled), true);
});
test('incognito Settings opens regular Settings when a backup folder needs permission', async () => {
  const page = await setup({ incognito: true, permission: 'missing' });
  await page.enableBackup();
  assert.equal(page.pickerCalls(), 0);
  assert.equal(page.elements['backup-enabled'].checked, false);
  assert.equal(page.requests.some(item => item.type === 'openRegularSettings'), true);
});


test('personal name saves trimmed text without requesting any backup operation', async () => {
  const page = await setup({ enabled: true, folderName: 'Documents', permission: 'granted' });
  assert.equal(page.elements['display-name'].value, '');
  assert.equal(page.elements['display-name'].disabled, false);
  const requestsBefore = page.requests.length;
  page.elements['display-name'].value = '  Симеон  ';
  await page.elements['display-name'].fire('change');
  assert.equal(page.savedSettings.at(-1).displayName, 'Симеон');
  assert.equal(page.elements['display-name'].value, 'Симеон');
  assert.equal(page.requests.length, requestsBefore);
  page.elements['display-name'].value = '   ';
  await page.elements['display-name'].fire('change');
  assert.equal(page.savedSettings.at(-1).displayName, '');
});


test('settings reloads the saved personal name', async () => {
  const page = await setup({ displayName: 'Симеон' });
  assert.equal(page.elements['display-name'].value, 'Симеон');
});


test('AI prompt is opt-in, reveals the supplied default, and keeps edits when disabled', async () => {
  const p = await setup();
  assert.equal(p.elements['include-ai-prompt'].checked, false);
  assert.equal(p.elements['ai-prompt-controls'].hidden, true);
  assert.match(p.elements['ai-prompt'].value, /^Analyze the meeting transcript below/);
  assert.match(p.elements['ai-prompt'].value, /unreliable speaker attribution/);
  p.elements['include-ai-prompt'].checked = true;
  await p.elements['include-ai-prompt'].fire('change');
  assert.equal(p.elements['ai-prompt-controls'].hidden, false);
  p.elements['ai-prompt'].value = '  Custom prompt\nSecond line  ';
  await p.elements['ai-prompt'].fire('change');
  assert.equal(p.savedSettings.at(-1).aiPrompt, 'Custom prompt\nSecond line');
  p.elements['include-ai-prompt'].checked = false;
  await p.elements['include-ai-prompt'].fire('change');
  assert.equal(p.elements['ai-prompt-controls'].hidden, true);
  assert.equal(p.elements['ai-prompt'].value, 'Custom prompt\nSecond line');
});

test('AI prompt reloads saved preferences, restores the default for empty input, and rolls back failed toggles', async () => {
  const p = await setup({ includeAiPrompt: true, aiPrompt: 'Saved prompt', failPreference: true });
  assert.equal(p.elements['ai-prompt-controls'].hidden, false);
  assert.equal(p.elements['ai-prompt'].value, 'Saved prompt');
  p.elements['ai-prompt'].value = '   ';
  await p.elements['ai-prompt'].fire('change');
  assert.match(p.savedSettings.at(-1).aiPrompt, /^Analyze the meeting transcript below/);
  p.elements['include-ai-prompt'].checked = false;
  await p.elements['include-ai-prompt'].fire('change');
  assert.equal(p.elements['include-ai-prompt'].checked, true);
  assert.equal(p.elements['ai-prompt-controls'].hidden, false);
});
