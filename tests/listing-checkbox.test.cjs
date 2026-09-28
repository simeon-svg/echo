const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function declarationsFor(css, selector) {
  const block = css.match(new RegExp(`\\${selector} \\{([^}]*)\\}`));
  assert.ok(block, `missing CSS rule for ${selector}`);
  return block[1];
}

test('listing checkboxes are 20px with a 10px click area around them', () => {
  const css = fs.readFileSync('styles/app.css', 'utf8');
  const area = declarationsFor(css, '.call-selection');
  const checkbox = declarationsFor(css, '.call-selection>input');
  const listing = fs.readFileSync('pages/transcripts.js', 'utf8');

  assert.match(area, /width:60px/);
  assert.match(area, /height:60px/);
  assert.match(area, /margin:-20px/);
  assert.match(checkbox, /width:20px/);
  assert.match(checkbox, /height:20px/);
  assert.match(listing, /node\("label", undefined, "call-selection"\)/);
  assert.match(listing, /input, button, details, a, label/);
});
