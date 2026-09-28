const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('settings page presents auto-save as a note for every setting', () => {
  const html = fs.readFileSync('pages/settings.html', 'utf8');
  const note = 'All settings on this page save automatically.';
  const noteIndex = html.indexOf(note);
  const backupSectionEnd = html.indexOf('</section>', html.indexOf('id="backup-controls"'));

  assert.notEqual(noteIndex, -1);
  assert.ok(noteIndex > backupSectionEnd, 'the note must appear after the backup folder section');
  assert.doesNotMatch(html, /Changes save automatically\./);
});
