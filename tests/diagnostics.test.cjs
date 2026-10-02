const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(controls = {}) {
  const context = vm.createContext({ Date, Blob, console,
    chrome: { runtime: { getManifest: () => ({ version: '1.6.0' }) } },
    document: { visibilityState: 'visible', title: 'PRIVATE_TITLE' },
    navigator: { userAgent: 'Mozilla/5.0 Chrome/140.0.0.0', language: 'bg-BG' },
    MeetAdapter: { diagnostics: () => controls },
  });
  vm.runInContext(fs.readFileSync('content/diagnostics.js', 'utf8'), context);
  return { diagnostics: context.createMeetDiagnostics(), context };
}
test('diagnostic report exports only allowed fields and sanitized error codes', () => {
  const t = setup({ leave: { found: true, candidates: 1, label: 'PRIVATE_NAME' }, raw: 'PRIVATE_DOM' });
  t.diagnostics.update({ mode: 'recording', active: true, available: true, blocks: 7, captionRows: 2,
    title: 'PRIVATE_TITLE', transcript: 'PRIVATE_TEXT', participants: ['PRIVATE_NAME'],
    announceMessage: 'PRIVATE_ANNOUNCEMENT', url: 'PRIVATE_URL', saveError: 'PRIVATE_ERROR' });
  t.diagnostics.failure('save', { name: 'PRIVATE_NAME', message: 'PRIVATE_ERROR PRIVATE_URL', stack: 'PRIVATE_STACK chrome-extension://PRIVATE_ID/content/meet.js:123:4' });
  t.diagnostics.saved();
  const report = t.diagnostics.report();
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
  assert.equal(report.extensionVersion, '1.6.0');
  assert.equal(report.environment.chromiumVersion, '140.0.0.0');
  assert.equal(report.state.blocks, 7);
  assert.equal(report.state.saveFailures, 1);
  assert.ok(report.state.lastSaveAt);
  assert.equal(report.events.at(-1).name, 'Error');
  assert.equal(report.events.at(-1).code, 'operation-failed');
  assert.equal(report.events.at(-1).frames[0].file, 'content/meet.js');
  assert.equal(report.events.at(-1).frames[0].line, 123);
});
test('diagnostic history stays bounded and repeated errors are coalesced', () => {
  const { diagnostics } = setup();
  for (let n = 0; n < 300; n++) diagnostics.update({ mode: n % 2 ? 'paused' : 'recording' });
  assert.equal(diagnostics.report().events.length, 100);
  for (let n = 0; n < 50; n++) diagnostics.failure('scan', new TypeError('PRIVATE_MESSAGE'));
  assert.equal(diagnostics.report().events.length, 100);
  assert.equal(diagnostics.report().events.at(-1).count, 50);
});
test('export survives invalidated extension context and failed Meet detection', () => {
  const t = setup();
  t.context.chrome.runtime.getManifest = () => { throw new Error('PRIVATE_ERROR'); };
  t.context.MeetAdapter.diagnostics = () => { throw new Error('PRIVATE_DOM'); };
  const report = t.diagnostics.report();
  assert.equal(report.extensionVersion, '1.6.0', 'the injected version remains available after context invalidation');
  assert.equal(report.detectionFailed, true);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
});
