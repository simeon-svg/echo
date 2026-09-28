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

test('announcement message control matches the backup subsetting style', () => {
  const css = fs.readFileSync('styles/app.css', 'utf8');
  const label = css.match(/\.settings-subcontrol label \{([^}]*)\}/)?.[1] || '';
  const textarea = css.match(/\.settings-subcontrol textarea \{([^}]*)\}/)?.[1] || '';

  assert.match(css, /\.settings-subcontrol\+\.setting-row \{border-top:1px solid #eceee9\}/);
  assert.match(label, /font-size:14px/);
  assert.match(label, /font-weight:600/);
  assert.match(textarea, /font:inherit/);
  assert.match(textarea, /font-size:16px/);
  assert.match(textarea, /padding:10px 12px/);
  assert.match(textarea, /border-radius:8px/);
});
