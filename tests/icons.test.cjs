const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('browser icon PNG dimensions match their declared display sizes', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  for (const icons of [manifest.icons, manifest.action.default_icon]) {
    for (const [size, path] of Object.entries(icons)) {
      const png = fs.readFileSync(path);
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(png.readUInt32BE(16), Number(size), `${path} width`);
      assert.equal(png.readUInt32BE(20), Number(size), `${path} height`);
    }
  }
});
