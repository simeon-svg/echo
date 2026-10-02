const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(preferences = {}) {
  const context = vm.createContext({ chrome: { storage: { local: {
    async get(defaults) { return { ...defaults, ...preferences }; },
  } } } });
  for (const path of ['storage/calls.js', 'pages/shared.js', 'storage/backup.js', 'pages/transcript-export.js']) {
    const source = fs.readFileSync(path, 'utf8').replace(/^import [\s\S]*?;\n/gm, '').replace(/export /g, '');
    vm.runInContext(path === 'storage/backup.js' ? `{ ${source}\nglobalThis.backupText = backupText; }` : source, context);
  }
  return { exportText: text => vm.runInContext(`exportText(${JSON.stringify(text)})`, context),
    defaultPrompt: vm.runInContext('DEFAULT_AI_PROMPT', context), context };
}

test('default exports remain unchanged; enabled exports use the full default or a custom prompt', async () => {
  const preferences = {};
  const p = setup(preferences);
  const text = 'Title\n\nAlice — 12:00\nTranscript body';
  assert.equal(await p.exportText(text), text);
  preferences.includeAiPrompt = true;
  assert.equal(await p.exportText(text), `${p.defaultPrompt}\n\n---\n\nTranscript:\n\n${text}`);
  preferences.aiPrompt = '  Custom prompt\nSecond line  ';
  assert.equal(await p.exportText(text), `Custom prompt\nSecond line\n\n---\n\nTranscript:\n\n${text}`);
  assert.equal(await p.exportText(''), '');
  preferences.aiPrompt = '  ';
  assert.ok((await p.exportText(text)).startsWith(p.defaultPrompt));
});

test('whole transcript exports include the prompt without adding it to backups or stored calls', async () => {
  const p = setup({ includeAiPrompt: true, aiPrompt: 'CUSTOM AI INSTRUCTIONS' });
  const call = { id: 'test', title: 'Meeting', startTime: 1, endTime: 60001, status: 'completed', participants: ['Alice'], blocks: [{ speaker: 'Alice', timestamp: 1, text: 'Original content' }] };
  const before = JSON.stringify(call);
  p.context.call = call;
  const text = vm.runInContext('plainText(call)', p.context);
  assert.equal(await p.exportText(text), `CUSTOM AI INSTRUCTIONS\n\n---\n\nTranscript:\n\n${text}`);
  const backup = vm.runInContext('backupText(call)', p.context);
  assert.match(backup, /Original content/);
  assert.doesNotMatch(backup, /CUSTOM AI INSTRUCTIONS|Transcript:/);
  assert.equal(JSON.stringify(call), before);
});
