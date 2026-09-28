const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CaptionParser } = require('../content/captions.js');
const row = (text, id = 1, speaker = 'You') => ({ id, speaker, text });

test('real Meet punctuation correction and cumulative row replace partials', () => {
  const p = new CaptionParser();
  p.update([row("Okay. Do I speak? Sounds good. Perfect! I'm.")], 1000);
  p.update([row("Okay. Do I speak? Sounds good. Perfect! I'm talking.")], 1332);
  assert.equal(p.blocks.length, 1);
  assert.equal(p.blocks[0].text, "Okay. Do I speak? Sounds good. Perfect! I'm talking.");
  assert.equal(p.blocks[0].timestamp, 1000);
});
test('incremental sentences produce one block', () => {
  const p = new CaptionParser();
  ['We should', 'We should probably', 'We should probably launch', 'We should probably launch in November.']
    .forEach((text, i) => p.update([row(text)], i * 100));
  assert.deepEqual(p.blocks.map(b => b.text), ['We should probably launch in November.']);
});
test('speaker changes and new rows remain separate', () => {
  const p = new CaptionParser();
  p.update([row('Hello.')], 1);
  p.update([row('Hello.'), row('Hi!', 2, 'Jane')], 2);
  p.update([row('Next thought.', 3)], 3);
  assert.deepEqual(p.blocks.map(b => b.speaker), ['You', 'Jane', 'You']);
});
test('pause/resume never includes a lingering paused row', () => {
  const p = new CaptionParser();
  p.update([row('Before pause')], 1);
  p.boundary([row('Before pause secret paused words')]);
  p.update([row('Before pause secret paused words resumed words')], 10);
  p.update([], 11);
  p.update([row('Fresh resumed speech', 2)], 12);
  assert.deepEqual(p.blocks.map(b => b.text), ['Before pause', 'Fresh resumed speech']);
});
test('meaningful pause splits cumulative text without duplicating prefix', () => {
  const p = new CaptionParser();
  p.update([row('First sentence.')], 1000);
  p.update([row('First sentence. Next')], 6000);
  p.update([row('First sentence. Next sentence.')], 6100);
  assert.deepEqual(p.blocks.map(b => b.text), ['First sentence.', 'Next sentence.']);
});
test('rolling captions retain removed prefix', () => {
  const p = new CaptionParser();
  p.update([row('One two three four')], 1000);
  p.update([row('three four five six')], 1200);
  assert.equal(p.blocks[0].text, 'One two three four five six');
  p.update([row('three four five six seven')], 1300);
  assert.equal(p.blocks[0].text, 'One two three four five six seven');
});
test('non-Latin text and repeated observations are preserved without duplicates', () => {
  const p = new CaptionParser();
  p.update([row('Здравей свят.')], 1);
  assert.equal(p.update([row('Здравей свят.')], 2), false);
  assert.equal(p.blocks[0].text, 'Здравей свят.');
});
test('speech intentionally repeated after Resume is kept in a fresh row', () => {
  const p = new CaptionParser();
  p.update([row('Before pause')], 1);
  p.boundary([row('Repeated phrase')]);
  p.update([], 2);
  p.update([row('Repeated phrase after resume', 2)], 3);
  assert.equal(p.blocks[1].text, 'Repeated phrase after resume');
});
