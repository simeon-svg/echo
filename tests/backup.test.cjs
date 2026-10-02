const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(permission = 'granted') {
  let currentPermission = permission;
  const states = new Map();
  const preferences = { backupEnabled: true, backupProblemActive: false };
  const notifications = [];
  class File {
    async createWritable() {
      return { write: async value => { this.contents = value; }, close: async () => {}, abort: async () => {} };
    }
  }
  class Directory {
    constructor(name) { this.name = name; this.directories = new Map(); this.files = new Map(); }
    async queryPermission() { return currentPermission; }
    async getDirectoryHandle(name, { create } = {}) {
      if (!this.directories.has(name)) {
        if (!create) { const error = new Error('Missing'); error.name = 'NotFoundError'; throw error; }
        this.directories.set(name, new Directory(name));
      }
      return this.directories.get(name);
    }
    async getFileHandle(name, { create } = {}) {
      if (!this.files.has(name)) {
        if (!create) { const error = new Error('Missing'); error.name = 'NotFoundError'; throw error; }
        this.files.set(name, new File());
      }
      return this.files.get(name);
    }
    async removeEntry(name) {
      if (!this.files.delete(name)) { const error = new Error('Missing'); error.name = 'NotFoundError'; throw error; }
    }
  }
  const root = new Directory('Documents');
  const chrome = {
    storage: { local: {
      async get(defaults) { return { ...defaults, ...preferences }; },
      async set(values) { Object.assign(preferences, values); },
    } },
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    action: { async setBadgeText(value) { preferences.badge = value.text; }, async setBadgeBackgroundColor() {} },
    notifications: { async create(id, options) { notifications.push({ id, ...options }); }, async clear() {} },
  };
  const context = vm.createContext({
    chrome, console, Date,
    allBackupStates: async () => [...states.values()],
    deleteBackupCallState: async id => states.delete(id),
    getBackupCallState: async id => states.get(id),
    getBackupDirectory: async () => root,
    saveBackupCallState: async (id, state) => states.set(id, { ...state, callId: id }),
  });
  const source = fs.readFileSync('storage/backup.js', 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '').replace(/export /g, '') +
    '\nglobalThis.backupApi = { monthOf, safeFileName, backupText, removeCallBackup, syncCalls, withBackupStatus };';
  vm.runInContext(fs.readFileSync('storage/calls.js', 'utf8').replace(/export /g, ''), context);
  vm.runInContext(source, context);
  const call = { id: 'call-123', title: 'Weekly / Sync', startTime: new Date(2026, 8, 28, 10).getTime(),
    endTime: new Date(2026, 8, 28, 10, 30).getTime(), updatedAt: 200, status: 'completed', participants: ['Jane'],
    blocks: [{ speaker: 'Jane', timestamp: new Date(2026, 8, 28, 10, 1).getTime(), text: 'Hello' }] };
  return { ...context.backupApi, call, root, states, preferences, notifications,
    setPermission(value) { currentPermission = value; } };
}

test('writes one readable TXT into Echo Backups and the start month', async () => {
  const t = setup();
  const result = await t.syncCalls([t.call], { force: true });
  assert.equal(result.backed, 1);
  const month = t.root.directories.get('Echo Backups').directories.get('2026-09');
  const name = 'Weekly _ Sync -- call-123.txt';
  assert.equal(month.files.has(name), true);
  assert.match(month.files.get(name).contents, /Echo ID: call-123/);
  assert.match(month.files.get(name).contents, /Jane — .*\nHello/);
  assert.equal(t.states.get('call-123').status, 'backed');
});

test('renaming writes the new filename and removes the previous one while retaining the ID', async () => {
  const t = setup();
  await t.syncCalls([t.call], { force: true });
  const renamed = { ...t.call, title: 'Planning', updatedAt: 300 };
  await t.syncCalls([renamed], { force: true });
  const files = t.root.directories.get('Echo Backups').directories.get('2026-09').files;
  assert.deepEqual([...files.keys()], ['Planning -- call-123.txt']);
});

test('a denied folder becomes a per-conversation failure and raises one incident', async () => {
  const t = setup('denied');
  const result = await t.syncCalls([t.call], { force: true });
  assert.equal(result.failed, 1);
  const [presented] = await t.withBackupStatus([t.call]);
  assert.equal(presented.backup.status, 'failed');
  assert.equal(t.preferences.badge, '!');
  assert.equal(t.notifications.filter(item => item.id === 'echo-backup-problem').length, 1);
});

test('a prompt-state folder waits for access without reporting a backup failure', async () => {
  const t = setup('prompt');
  const result = await t.syncCalls([t.call], { force: true });
  assert.equal(result.failed, 0);
  assert.equal(result.waiting, 1);
  const [presented] = await t.withBackupStatus([t.call]);
  assert.equal(presented.backup.status, 'permission-required');
  assert.match(presented.backup.error, /folder access/i);
  assert.equal(t.preferences.badge, '!');
  assert.equal(t.notifications.filter(item => item.id === 'echo-backup-permission').length, 1);

  t.setPermission('granted');
  const resumed = await t.syncCalls([t.call], { force: true });
  assert.equal(resumed.backed, 1);
  assert.equal(resumed.waiting, 0);
  assert.equal(t.states.get('call-123').status, 'backed');
});

test('an edited conversation is pending until its current version is written', async () => {
  const t = setup();
  await t.syncCalls([t.call], { force: true });
  const [presented] = await t.withBackupStatus([{ ...t.call, updatedAt: 500 }]);
  assert.equal(presented.backup.status, 'pending');
});

test('a backup deletion waiting for permission remains queued and is retried after access returns', async () => {
  const t = setup();
  await t.syncCalls([t.call], { force: true });
  t.setPermission('prompt');
  const warning = await t.removeCallBackup(t.call);
  assert.match(warning, /folder access/i);
  assert.equal(t.states.get('call-123').status, 'cleanup-permission-required');
  t.setPermission('granted');
  await t.syncCalls([], { force: true });
  assert.equal(t.states.has('call-123'), false);
  const files = t.root.directories.get('Echo Backups').directories.get('2026-09').files;
  assert.equal(files.size, 0);
});


test('automatic TXT backups retain explicit author-note labels and separate bookmark markers', () => {
  const t = setup();
  t.call.blocks[0].id = 1;
  t.call.bookmarks = [
    { id: 'note', blockId: 1, timestamp: t.call.startTime + 60000, text: 'Follow up\nTomorrow' },
    { id: 'mark', blockId: null, timestamp: t.call.startTime, text: '' },
  ];
  const text = t.backupText(t.call);
  assert.match(text, /\[AUTHOR NOTE — .*\]\n> Follow up\n> Tomorrow/);
  assert.match(text, /\[BOOKMARK — /);
  assert.ok(text.indexOf('[BOOKMARK') < text.indexOf('Jane —'));
  assert.ok(text.indexOf('Hello') < text.indexOf('[AUTHOR NOTE'));
});


test('personal name changes update views without rewriting backups; later edits use the current name', async () => {
  const t = setup();
  t.call.participants = ['You', 'Jane'];
  t.call.blocks.unshift({ speaker: 'You', timestamp: t.call.startTime, text: 'My reply' });
  await t.syncCalls([t.call]);
  const files = t.root.directories.get('Echo Backups').directories.get('2026-09').files;
  const original = [...files.values()][0].contents;
  const stateBefore = JSON.stringify(t.states.get(t.call.id));
  t.preferences.displayName = 'Симеон';
  const views = await t.withBackupStatus([t.call]);
  assert.equal(views[0].blocks[0].speaker, 'Симеон');
  assert.deepEqual(Array.from(views[0].participants), ['Симеон', 'Jane']);
  assert.equal(views[0].backup.status, 'backed');
  assert.equal(views[0].updatedAt, t.call.updatedAt);
  assert.equal((await t.syncCalls([t.call])).backed, 0);
  assert.equal([...files.values()][0].contents, original);
  assert.equal(JSON.stringify(t.states.get(t.call.id)), stateBefore);
  assert.equal(t.call.blocks[0].speaker, 'You');
  await t.syncCalls([{ ...t.call, title: 'Renamed call', updatedAt: 300 }]);
  assert.equal(files.size, 1);
  assert.match([...files.values()][0].contents, /Симеон — .*\nMy reply/);
  t.preferences.displayName = 'New name';
  await t.syncCalls([{ ...t.call, updatedAt: 400, blocks: t.call.blocks.map(b => ({ ...b, text: b.text + ' edited' })) }]);
  assert.match([...files.values()][0].contents, /New name — .*\nMy reply edited/);
  t.preferences.displayName = 'Manual regeneration';
  await t.syncCalls([t.call], { force: true });
  assert.match([...files.values()][0].contents, /Manual regeneration —/);
});

test('personal names are used in views even when automatic backup is disabled', async () => {
  const t = setup();
  t.preferences.backupEnabled = false;
  t.preferences.displayName = 'Me';
  t.call.participants = ['You'];
  t.call.blocks[0] = { ...t.call.blocks[0], speaker: 'You' };
  const [view] = await t.withBackupStatus([t.call]);
  assert.equal(view.blocks[0].speaker, 'Me');
  assert.equal(view.participants[0], 'Me');
  assert.equal(t.root.directories.size, 0);
});
