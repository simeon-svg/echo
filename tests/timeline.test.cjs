const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { CaptionParser } = require('../content/captions.js');
function model() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync('storage/calls.js', 'utf8').replace(/export /g, ''), context);
  return code => vm.runInContext(code, context);
}
test('merged segments preserve caption gaps, recording breaks, interruption and note anchors', () => {
  const run = model();
  const text = run(`transcriptBody(groupCalls([
    { id:'a', callId:'c', startTime:0, endTime:10000, updatedAt:10000, status:'interrupted', participants:['A'],
      blocks:[{id:1,speaker:'A',timestamp:1000,text:'Before'}], gaps:[{kind:'captions',timestamp:2000,endTime:3000}], bookmarks:[] },
    { id:'b', callId:'c', startTime:20000, endTime:30000, updatedAt:30000, status:'completed', participants:['A'],
      blocks:[{id:1,speaker:'A',timestamp:21000,text:'After'}], bookmarks:[{id:'n',blockId:1,timestamp:21001,text:'Decision'}] }
  ])[0], String)`);
  assert.match(text, /Captions unavailable · 2000–3000/);
  assert.match(text, /Recording interrupted.*10000–20000/);
  assert.equal((text.match(/RECORDING GAP/g) || []).length, 2, 'caption gap and one combined interruption interval');
  assert.ok(text.indexOf('After') < text.indexOf('AUTHOR NOTE'));
});
test('speech estimates exclude gaps, segment ends and trailing silence; percentages use captured speech', () => {
  const run = model();
  const stats = run(`speakingStats({startTime:0,endTime:100000,participants:['A','B','Silent'],
    blocks:[{speaker:'A',timestamp:1000,segmentId:'a',segmentEndTime:2500,text:'one two three four five six'},
      {speaker:'B',timestamp:5000,segmentId:'b',speechMs:2000,text:'one'}],
    gaps:[{segmentId:'a',kind:'captions',timestamp:2000,endTime:5000}]})`);
  assert.equal(stats.total, 3000);
  assert.equal(stats.participants[0].duration, 1000);
  assert.equal(stats.participants[1].duration, 2000);
  assert.equal(stats.participants[2].percent, 0);
  assert.ok(Math.abs(stats.participants.reduce((sum, p) => sum + p.percent, 0) - 100) < 1e-10);
});
test('standalone interruptions and ordinary recording pauses remain distinct', () => {
  const run = model();
  const gaps = run(`groupCalls([
    {id:'a',callId:'c',startTime:1,endTime:10,updatedAt:10,status:'completed',participants:[],blocks:[]},
    {id:'b',callId:'c',startTime:20,endTime:30,updatedAt:30,status:'interrupted',participants:[],blocks:[]}
  ])[0].gaps`);
  assert.equal(gaps.length, 2);
  assert.equal(gaps[0].kind, 'paused');
  assert.equal(gaps[0].endTime, 20);
  assert.equal(gaps[1].kind, 'interrupted');
  assert.equal(gaps[1].endTime, null);
});
test('caption timing stops accumulating for unchanged rows and bounds long silent intervals', () => {
  const parser = new CaptionParser();
  parser.update([{id:'r',speaker:'A',text:'Hello'}], 1000);
  parser.update([{id:'r',speaker:'A',text:'Hello there'}], 2000);
  assert.equal(parser.blocks[0].speechMs, 1400);
  assert.equal(parser.update([{id:'r',speaker:'A',text:'Hello there'}], 60000), false);
  assert.equal(parser.blocks[0].speechMs, 1400);
  parser.update([{id:'r',speaker:'A',text:'Hello there again'}], 61000);
  assert.equal(parser.blocks.length, 2);
  assert.equal(parser.blocks[1].speechMs, 400);
});

test('legacy bookmarks in one speaker turn render as one bookmark with combined text', () => {
  const run = model();
  const call = run(`groupCalls([{
    id:'segment', startTime:0, endTime:10000, updatedAt:10000, status:'completed', participants:['You'],
    blocks:[
      { id:1, speaker:'You', timestamp:1000, text:'One' },
      { id:2, speaker:'You', timestamp:2000, text:'Two' },
      { id:3, speaker:'You', timestamp:3000, text:'Three' }
    ],
    bookmarks:[
      { id:'b1', blockId:1, timestamp:1001, text:'first' },
      { id:'b2', blockId:2, timestamp:2001, text:'second' },
      { id:'b3', blockId:3, timestamp:3001, text:'third' }
    ]
  }])[0]`);
  assert.equal(call.bookmarks.length, 1);
  assert.equal(call.bookmarks[0].blockId, 1);
  assert.match(call.bookmarks[0].text, /first/);
  assert.match(call.bookmarks[0].text, /second/);
  assert.match(call.bookmarks[0].text, /third/);
});
