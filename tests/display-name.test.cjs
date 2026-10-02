const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('storage/calls.js', 'utf8').replace(/export /g, '') + '\nglobalThis.api = { withDisplayName, transcriptBody, possibleRecordings };', context);
const { withDisplayName, transcriptBody, possibleRecordings } = context.api;

test('self markers override captured names without renaming another participant of the same name', () => {
  const call = { participants: ['Alex', 'You', 'Вие', 'Guest'], updatedAt: 7, blocks: [
    { speaker: 'Alex', isSelf: true, text: 'Mine', timestamp: 1 },
    { speaker: 'Alex', isSelf: false, text: 'Theirs', timestamp: 2 },
    { speaker: 'You', isSelf: false, text: 'An actual participant named You', timestamp: 3 },
    { speaker: 'Вие', text: 'Legacy self reply', timestamp: 4 },
  ] };
  const before = JSON.stringify(call);
  const view = withDisplayName(call, '  Симеон  ');
  assert.deepEqual(Array.from(view.blocks, b => b.speaker), ['Симеон', 'Alex', 'You', 'Симеон']);
  assert.deepEqual(Array.from(view.participants), ['Alex', 'You', 'Симеон', 'Guest']);
  assert.match(transcriptBody(view, String), /Симеон — 1\nMine/);
  assert.match(transcriptBody(view, String), /Alex — 2\nTheirs/);
  assert.equal(view.updatedAt, 7);
  assert.equal(JSON.stringify(call), before);
  assert.equal(withDisplayName(call, '').blocks[0].speaker, 'Alex');
  assert.equal(withDisplayName(call, '   ').blocks[3].speaker, 'Вие');
});

test('historical real names remain unchanged without self markers', () => {
  const call = { participants: ['Alex'], blocks: [{ speaker: 'Alex', text: 'Old reply' }] };
  assert.equal(withDisplayName(call, 'New name').blocks[0].speaker, 'Alex');
});


test('a shared personal name does not create a false merge suggestion', () => {
  const common = { status: 'completed', meetUrl: 'https://meet.google.com/abc-defg-hij', startTime: 1000, endTime: 2000 };
  const calls = [
    { ...common, id: 'a', tabId: 1, participants: ['You', 'Alice'], blocks: [{ speaker: 'You' }, { speaker: 'Alice' }] },
    { ...common, id: 'b', tabId: 2, participants: ['You', 'Bob'], blocks: [{ speaker: 'You' }, { speaker: 'Bob' }] },
  ].map(call => withDisplayName(call, 'Симеон'));
  assert.equal(possibleRecordings(calls).size, 0);
});
