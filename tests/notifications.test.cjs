const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function declarationsFor(css, selector) {
  const block = css.match(new RegExp(`\\${selector} \\{([^}]*)\\}`));
  assert.ok(block, `missing CSS rule for ${selector}`);
  return block[1];
}

test('page notification shadows have room at the stack edges and do not double up between toasts', () => {
  const css = fs.readFileSync('styles/app.css', 'utf8');
  const stack = declarationsFor(css, '.page-notifications');
  const toast = declarationsFor(css, '.page-notification');

  assert.match(stack, /padding:\s*\d+px/);
  assert.match(stack, /overflow:\s*visible/);
  assert.match(toast, /box-shadow:\s*none/);
  assert.match(stack, /filter:\s*drop-shadow\(/);
});
