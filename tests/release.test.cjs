const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('the latest changelog release matches the version Chrome installs', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const latest = fs.readFileSync('CHANGELOG.md', 'utf8').match(/^## (\d+\.\d+\.\d+)/m)?.[1];
  assert.equal(latest, manifest.version);
});
