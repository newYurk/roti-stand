#!/usr/bin/env node
'use strict';
// v0 step 1 — the evening frame without a guest (docs/v0-step1-evening-frame.md): lamp, bowl of
// three balls, roti carried to the counter, lid (end and pause), autosave, radio. Pure Node/vm, the
// same mocks as model-regression.cjs: stand.js is booted, then evening.js is run in the SAME context
// (the way index.html loads it after stand.js). Every action of the player goes through the stand's
// real window touch handlers (h.touch); this is not a browser and says nothing about look or feel.
//   node prototype/dough-closeup/checks/evening-regression.cjs path/to/stand.js [--only V1,V3]
// ALWAYS pass the stand.js of the checkout under test as the first argument (evening.js is taken
// from the same folder). Report: runs/checks/evening-results.json of the checkout (runs/ is not in git).
// V3 makes one whole ball by touches (flatten → stretch → tava → envelope → table → cut → counter).
// In V5 the second and third balls skip flattening and stretching (the sheet is set to the stretch
// target by script, as dishOnPan() of envelope-regression.cjs does); everything else is touches.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const H = require('./model-regression.cjs');
const { boot, lcg } = H;
const eveningPath = path.join(path.dirname(H.sourcePath), 'evening.js');
const eveningSrc = fs.readFileSync(eveningPath, 'utf8');
// banana.js and egg.js wrap the stand's onDown/onMove/onUp (index.html loads them before evening.js):
// they are loaded here too, otherwise the check would not see who gets a touch first.
const sideScripts = ['banana.js', 'egg.js'].map(f => ({ file: path.join(path.dirname(H.sourcePath), f), src: fs.readFileSync(path.join(path.dirname(H.sourcePath), f), 'utf8') }));
const args = process.argv.slice(3);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',')) : null; })();
const results = [];
function test(id, name, fn) {
  if (only && !only.has(id)) return;
  const t0 = Date.now();
  try { const result = fn() || {}; results.push({ id, name, status: 'PASS', seconds: (Date.now() - t0) / 1000, result }); }
  catch (err) { results.push({ id, name, status: 'FAIL', seconds: (Date.now() - t0) / 1000, error: err.stack, result: err.partial }); }
  const r = results.at(-1);
  console.log(`${r.status} ${id} ${name} (${r.seconds.toFixed(1)} s)` + (r.status === 'FAIL' ? `\n     ${String(r.error).split('\n').slice(0, 3).join('\n     ')}` : ''));
  if (r.result && r.result.summary) console.log('     ' + r.result.summary);
}
const TUNE = { com: 100, creep: 100, brk: 100 };
const FRAME = 'step(1/60); bananaUpdate(1/60); eggUpdate(1/60); eveningUpdate(1/60);';   // what loop() runs besides drawing
const W = 390, HH = 844;

// ── boot: stand.js, then evening.js in the same context ───────────────────────────────────────
function evening({ storage = [], search = '', w = W, hh = HH } = {}) {
  const h = boot(TUNE, w, hh, { storage });
  h.context.location.search = search;
  h.context.document.readyState = 'complete';
  for (const s of sideScripts) vm.runInContext(s.src, h.context, { filename: s.file, timeout: 10000 });
  vm.runInContext(eveningSrc, h.context, { filename: eveningPath, timeout: 10000 });
  h.J = code => JSON.parse(h.run(`JSON.stringify(${code})`));
  h.eve = () => h.J('EVE');
  h.spots = () => h.J('eveningSpots()');
  h.saved = () => JSON.parse(h.storage.get('roti_evening') || 'null');
  h.events = () => h.J('gestures.filter(g=>g.kind==="evening").map(g=>g.event)');
  h.frames = (n = 1) => { for (let i = 0; i < n; i++) { h.advance(1000 / 60); h.run(FRAME); } };
  return h;
}
const reload = (h, opts = {}) => evening({ storage: [...h.storage], ...opts });
const tap = (h, p, id = 't1') => { h.touch('start', id, p.x, p.y); h.frames(3); h.touch('end', id, p.x, p.y); h.frames(3); };
// pts: [{x,y,t}] in client px and ms from touchstart; frames at 60 Hz in between; the last point is the release.
function drive(h, pts, { settle = 40 } = {}) {
  const t0 = h.getTime(); let next = 1000 / 60;
  const to = t => { const d = t0 + t - h.getTime(); if (d > 0) h.advance(d); };
  h.touch('start', 't1', pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    while (next <= p.t) { to(next); h.run(FRAME); next += 1000 / 60; }
    to(p.t); h.touch(i === pts.length - 1 ? 'end' : 'move', 't1', p.x, p.y);
  }
  h.frames(settle);
}
// A straight stroke a → b at v CSS px/s, 60 Hz, ±1 px jitter, `hold` ms before the first move.
function line(a, b, { v = 300, hold = 120, stop = 40, seed = 1 } = {}) {
  const rnd = lcg(seed), L = Math.hypot(b.x - a.x, b.y - a.y), T = L / v * 1000, pts = [{ x: a.x, y: a.y, t: 0 }];
  for (let t = 8; t < T; t += 1000 / 60) pts.push({ x: a.x + (b.x - a.x) * t / T + 2 * rnd(), y: a.y + (b.y - a.y) * t / T + 2 * rnd(), t: hold + t });
  pts.push({ x: b.x, y: b.y, t: hold + T }); pts.push({ x: b.x, y: b.y, t: hold + T + stop });
  return pts;
}
const light = h => tap(h, h.spots().lamp);

// ── one ball by touches ───────────────────────────────────────────────────────────────────────
function flatten(h) {
  let holds = 0;
  while (h.run('stepNo') === 1 && holds < 12) {
    const c = h.J('__harness.toClient(centerOfSheet().x,centerOfSheet().y)');
    h.touch('start', 't1', c.x, c.y); h.frames(170); h.touch('end', 't1', c.x, c.y); h.frames(10); holds++;
  }
  assert.equal(h.run('stepNo'), 2, 'pressing the lump leads to step 2');
  return holds;
}
function stretch(h) {
  let n = 0;
  for (; n < 40 && h.run('stepNo') === 2; n++) {
    assert.equal(h.run('action.state'), 'RESTING');
    H.stroke(h, { angle: Math.PI / 8 + n * Math.PI / 4, speed: 1.5, dist: 2.4, hz: 60, jitter: 1, seed: n + 1 });
    h.frames(20);
  }
  assert.equal(h.run('stepNo'), 3, `the sheet reaches step 3 by slow pulls (did ${n})`);
  return n;
}
// script shortcut for the dough work of balls 2 and 3: a stretched square sheet on the table
function stretched(h) {
  h.run('stepNo=3;reset();'); h.frames(2);
  h.run('{const c=centerOfSheet(),R=sheetRadius();for(let i=0;i<N;i++){const x=px[i]-c.x,y=py[i]-c.y,k=targetAt(Math.atan2(y,x))/R;px[i]=prx[i]=c.x+x*k;py[i]=pry[i]=c.y+y*k;}}');
  h.frames(2);
}
function toPan(h) {
  const c = h.J('__harness.toClient(centerOfSheet().x,centerOfSheet().y)'), p = h.spots().pan;
  drive(h, line(c, p, { v: 320, hold: 100 }), { settle: 90 });
  assert.equal(h.run('phase'), 'PAN', 'the sheet carried by the middle lies on the tava');
  assert.equal(h.run('!!dish&&dish.mode'), 'fold');
}
function envelope(h) {
  for (const k of [2, 3, 0, 1]) {
    const e = h.J(`(()=>{const E=dish.env,a=${k}<2?E.u:E.v,s=${k}%2?-1:1,d={x:a.x*s,y:a.y*s},hk=E.h[${k}];
      const hu=dish.hull.reduce((m,p)=>Math.max(m,(p.x-E.c.x)*d.x+(p.y-E.c.y)*d.y),0)/hk;
      return [__harness.dishToClient({x:E.c.x+d.x*hk*hu*.97,y:E.c.y+d.y*hk*hu*.97}),__harness.dishToClient(E.c)]})()`);
    const a = e[0], m = e[1], b = { x: a.x + (m.x - a.x) * 0.85, y: a.y + (m.y - a.y) * 0.85 };
    drive(h, line(a, b, { v: 170, hold: 150, stop: 60, seed: k + 3 }));
  }
  assert.equal(h.run('dish.folds'), 4, 'four folds');
  assert.equal(h.run('envelopeDone()'), true, 'the envelope is done');
}
function toTable(h) {
  const c = h.J('(()=>{const b=dishBounds();return __harness.dishToClient({x:(b.left+b.right)/2,y:(b.top+b.bottom)/2})})()'), w = h.spots().work;
  drive(h, line(c, w, { v: 320, hold: 60 }), { settle: 60 });
  assert.equal(h.run('dish.mode'), 'cut', 'the envelope carried by the middle lies on the table');
}
const rotiBox = h => h.J(`(()=>{const b=dish.cutBounds,up=tableLiftCanvas()*cv.getBoundingClientRect().height/cv.height,
  P=(x,y)=>{const q=__harness.dishToClient({x,y});return {x:q.x,y:q.y-up}};
  return {c:P(dish.cutCenter.x,dish.cutCenter.y),l:P(b.left,dish.cutCenter.y),r:P(b.right,dish.cutCenter.y),t:P(dish.cutCenter.x,b.top),b:P(dish.cutCenter.x,b.bottom)}})()`);
function cut(h) {
  const B = rotiBox(h), dx = (B.r.x - B.l.x) * 0.2;
  drive(h, line({ x: B.l.x - dx, y: B.c.y }, { x: B.r.x + dx, y: B.c.y }, { v: 380, hold: 60 }));
  assert.equal(h.run('dish.cuts.length'), 1, 'one cut through the envelope');
}
function serve(h, { short = false } = {}) {
  const B = rotiBox(h), S = h.spots();
  const to = short ? { x: S.pan.x, y: S.pan.y } : { x: S.counter.x, y: S.counter.y };
  drive(h, line(B.c, to, { v: 420, hold: 80 }), { settle: 30 });
}
function ballByScriptAndTouches(h) { stretched(h); toPan(h); envelope(h); toTable(h); cut(h); serve(h); }

// ── checks ────────────────────────────────────────────────────────────────────────────────────
test('V1', 'fresh start: lamp unlit, the table is silent, the stand panel is hidden; ?dev=1 shows it', () => {
  const h = evening();
  assert.deepEqual(h.eve(), { v: 1, lamp: false, ballsLeft: 3, rotiDone: 0, lid: false, over: false, ball: false });
  assert.equal(h.nodes.get('panel').hidden, true, 'panel hidden in the game mode');
  assert.equal(h.run('sheetHidden'), true, 'no dough on the table');
  assert.equal(h.run('eveningLive()'), '', 'no words before the lamp');
  const S = h.spots(), n0 = h.run('gestures.length');
  for (const p of [S.work, S.bowl, S.pan, S.counter]) { drive(h, line(p, { x: p.x + 60, y: p.y - 40 }, { v: 600 })); tap(h, p); }
  assert.equal(h.run('action.state'), 'RESTING');
  assert.equal(h.run('gestures.length'), n0, 'no gesture is recorded before the lamp');
  assert.deepEqual(h.eve(), { v: 1, lamp: false, ballsLeft: 3, rotiDone: 0, lid: false, over: false, ball: false });
  h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0, 'frames draw without errors');
  const d = evening({ search: '?dev=1' });
  assert.equal(d.nodes.get('panel').hidden, false, 'panel visible with ?dev=1');
  assert.equal(d.run('eveningActive()'), false);
  assert.equal(d.run('sheetHidden'), false, 'the stand lump is on the table in the stand mode');
  const c = d.J('__harness.toClient(centerOfSheet().x,centerOfSheet().y)');
  d.touch('start', 't1', c.x, c.y); assert.equal(d.run('action.state'), 'ARMED', 'the stand answers touches in the stand mode'); d.touch('end', 't1', c.x, c.y);
  d.tick(3, 1 / 60, true); assert.equal(d.run('loopErrs'), 0);
  return { summary: `panel hidden=${h.nodes.get('panel').hidden}, ?dev=1 hidden=${d.nodes.get('panel').hidden}; 8 touches before the lamp → 0 gestures` };
});

test('V2', 'lamp → ball 1 on the table, 2 in the bowl; the bowl is silent mid-roti', () => {
  const h = evening(); light(h);
  const e = h.eve();
  assert.equal(e.lamp, true); assert.equal(e.ball, true); assert.equal(e.ballsLeft, 2);
  assert.equal(h.run('sheetHidden'), false); assert.equal(h.run('stepNo'), 1);
  assert.deepEqual(h.events(), ['lamp', 'ball']);
  tap(h, h.spots().bowl); tap(h, h.spots().lamp);
  assert.equal(h.eve().ballsLeft, 2, 'the bowl does not answer while a ball is in work');
  assert.deepEqual(h.events(), ['lamp', 'ball']);
  const s = h.saved();
  assert.equal(s.v, 1); assert.equal(s.lamp, true); assert.equal(s.ballsLeft, 2); assert.equal(s.rotiDone, 0); assert.equal(s.lid, false);
  h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  return { summary: `after the lamp: ballsLeft=${e.ballsLeft}, step ${h.run('stepNo')}, saved stage ${s.stage}` };
});

let afterOne = null;   // storage after the first roti — V4 reloads it
test('V3', 'a whole ball by touches: flatten → stretch → tava → envelope → table → cut → counter = serve', () => {
  const h = evening(); light(h);
  const holds = flatten(h), pulls = stretch(h);
  assert.equal(h.saved().stage, 'step3', 'the step change is saved');
  toPan(h);
  // the stand's wording about buttons the game does not have is replaced by plain words
  const words = h.J(`["Положи банан и яйцо, потом заверни края","Банан · клади дальше, лей яйцо или заверни края","Банан на месте · яйцо или заверни края",
    "На столе · режь прямым движением","Разрезов: 1 · режь дальше или «заново»","порвался без предсказания — жми «сейчас порвётся», пока тянешь",
    "лист уже порван — предсказывать нечего, жми «заново»"].map(m=>eveningLive(m))`);
  for (const w of words) assert.ok(typeof w === 'string' && w.length && !/яйц|заново|жми|сейчас порвётся/.test(w), `plain words instead of stand wording: ${w}`);
  assert.equal(h.run('eveningLive("сырое · подсыхает")'), null, 'other stand lines pass through');
  envelope(h); toTable(h);
  // an uncut roti led from its middle to the counter is neither a cut nor a serve
  serve(h);
  assert.equal(h.run('dish.cuts.length'), 0, 'no cut by a carry to the counter'); assert.equal(h.eve().rotiDone, 0);
  assert.match(h.run('dish.message'), /Сначала разрежь/);
  cut(h);
  serve(h, { short: true });
  assert.equal(h.run('!!dish'), true, 'released over the tava: the roti stays on the table');
  assert.equal(h.run('gestures.at(-1).outcome'), 'serve-back');
  assert.equal(h.eve().rotiDone, 0);
  serve(h);
  const e = h.eve();
  assert.equal(e.rotiDone, 1); assert.equal(e.ballsLeft, 2); assert.equal(e.ball, false);
  assert.equal(h.run('!!dish'), false, 'the table is free'); assert.equal(h.run('sheetHidden'), true);
  const kinds = h.J('gestures.slice(-3).map(g=>g.kind+(g.outcome?"/"+g.outcome:"")+(g.event?"/"+g.event:""))');
  assert.deepEqual(kinds, ['serve', 'pan/serve-carry', 'evening/serve'], 'serve is logged as the old «подать» did');
  assert.deepEqual(h.events(), ['lamp', 'ball', 'serve']);
  // free table: the dough does not answer, the bowl gives the next ball
  const S = h.spots(); tap(h, S.work); assert.equal(h.run('action.state'), 'RESTING');
  // the bowl hint waits for 6 s of standing still; a touch anywhere starts the wait again
  assert.equal(h.run('eveningLive("")'), '');
  h.frames(420); assert.equal(h.run('eveningLive("")'), 'следующий шарик — в миске');
  tap(h, S.work); assert.equal(h.run('eveningLive("")'), '', 'touching the screen is not idling');
  afterOne = [...h.storage];
  tap(h, S.bowl);
  assert.equal(h.eve().ballsLeft, 1); assert.equal(h.eve().ball, true); assert.equal(h.run('sheetHidden'), false);
  return { summary: `${holds} holds, ${pulls} pulls; journal tail ${kinds.join(' → ')}; bowl after serve 2, after the next ball 1` };
});

test('V4', 'reload mid-evening → the same evening (2 balls, lamp lit); an unfinished ball restarts as a lump', () => {
  // (a) mid-roti: ball 1 is on the tava
  const h = evening(); light(h); stretched(h); toPan(h);
  assert.equal(h.saved().stage, 'fold');
  const r = reload(h), e = r.eve();
  assert.equal(e.lamp, true); assert.equal(e.ballsLeft, 2); assert.equal(e.rotiDone, 0); assert.equal(e.ball, true);
  assert.equal(r.run('!!dish'), false); assert.equal(r.run('stepNo'), 1); assert.equal(r.run('phase'), 'TABLE'); assert.equal(r.run('sheetHidden'), false);
  assert.equal(r.nodes.get('panel').hidden, true);
  // (b) between balls: one roti done (storage of V3, when it ran)
  let between = 'skipped (V3 did not run)';
  if (afterOne) {
    const b = evening({ storage: afterOne }), eb = b.eve();
    assert.equal(eb.lamp, true); assert.equal(eb.ballsLeft, 2); assert.equal(eb.rotiDone, 1); assert.equal(eb.ball, false);
    assert.equal(b.run('sheetHidden'), true);
    between = `lamp ${eb.lamp}, balls ${eb.ballsLeft}, roti ${eb.rotiDone}`;
  }
  // a wrong version is ignored
  const bad = evening({ storage: [['roti_evening', JSON.stringify({ v: 2, lamp: true, ballsLeft: 0 })]] });
  assert.equal(bad.eve().lamp, false); assert.equal(bad.eve().ballsLeft, 3);
  return { summary: `mid-roti reload: lamp ${e.lamp}, balls ${e.ballsLeft}, lump at step ${r.run('stepNo')}; between balls: ${between}` };
});

test('V5', 'three roti → lid; lid onto the tava → evening over; touching the lump → a new evening, 3 in the bowl', () => {
  const h = evening(); light(h);
  const sky = [h.run('Math.min(3,EVE.rotiDone)')];
  for (let i = 0; i < 3; i++) {
    if (i) { tap(h, h.spots().bowl); assert.equal(h.eve().ball, true, `ball ${i + 1} taken from the bowl`); }
    assert.equal(h.spots().lidHome, false, 'no lid before the last roti is served');
    ballByScriptAndTouches(h);
    assert.equal(h.eve().rotiDone, i + 1); sky.push(h.run('Math.min(3,EVE.rotiDone)'));
  }
  assert.deepEqual(sky, [0, 1, 2, 3], 'the sky step follows the roti');
  let S = h.spots();
  assert.equal(h.eve().ballsLeft, 0); assert.equal(S.lidHome, true, 'the lid appears');
  tap(h, S.bowl); assert.equal(h.eve().ball, false, 'the empty bowl gives nothing');
  // nothing fries at the end of the evening: a hidden page or a reload does not put the lid on the tava
  h.visibility(true); h.visibility(false);
  assert.equal(h.eve().lid, false); assert.equal(h.spots().lidHome, true, 'the lid still waits on the table');
  { const r0 = reload(h); assert.equal(r0.eve().lid, false); assert.equal(r0.spots().lidHome, true); assert.equal(r0.run('fryHold'), false); }
  // the lid dropped short of the tava goes back
  drive(h, line(S.lid, { x: S.lid.x + 30, y: S.lid.y - 20 }, { v: 300 }));
  assert.equal(h.eve().over, false);
  drive(h, line(S.lid, S.pan, { v: 300 }));
  let e = h.eve();
  assert.equal(e.over, true); assert.equal(e.lid, true); assert.equal(e.lamp, false);
  assert.equal(h.run('eveningLive("")'), 'вечер окончен · три роти');
  assert.deepEqual(h.events().slice(-2), ['serve', 'lid-end']);
  const r = reload(h); assert.equal(r.eve().over, true, 'the finished evening survives a reload');
  S = h.spots(); tap(h, S.pan); assert.equal(h.eve().over, true, 'only the lump starts the next evening');
  tap(h, S.lump);
  e = h.eve();
  assert.deepEqual(e, { v: 1, lamp: false, ballsLeft: 3, rotiDone: 0, lid: false, over: false, ball: false });
  light(h); assert.equal(h.eve().ballsLeft, 2);
  h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  return { summary: `sky steps ${sky.join('→')}; events ${h.events().join(' ')}` };
});

test('V6', 'visibilitychange hidden → lid on the tava, frying stands for 10 s; lid carried off → frying goes on', () => {
  const h = evening(); light(h); stretched(h);
  // dough on the table, nothing on the tava: a hidden page lays no lid
  h.visibility(true); h.visibility(false);
  assert.equal(h.eve().lid, false); assert.equal(h.run('fryHold'), false);
  toPan(h);
  h.frames(60);
  // the stand's automatic filling: a touch in the middle of the open sheet lays banana slices
  tap(h, h.spots().pan); const slices = h.run('dish.filling.length');
  assert.ok(slices > 0, 'a touch in the middle of the open sheet lays banana');
  h.frames(60);
  const cook = () => h.J('{dry:dishSideMean("dry","contactWeights"),cook:dishSideMean("cook","contactWeights"),t:dish.panTime}');
  const a = cook();
  h.visibility(true);
  assert.equal(h.eve().lid, true); assert.equal(h.run('fryHold'), true);
  assert.equal(h.saved().lid, true);
  h.visibility(false);
  h.frames(600);
  const b = cook();
  assert.deepEqual(b, a, 'nothing fries under the lid for 10 s');
  // under the lid the tava and the table do not answer
  const S = h.spots(), n0 = h.run('gestures.length');
  tap(h, S.work); tap(h, S.bowl); tap(h, S.pan);
  assert.equal(h.run('gestures.length'), n0); assert.equal(h.run('dishGesture'), null);
  assert.equal(h.run('dish.filling.length'), slices, 'no banana is laid through the lid');
  // a reload restarts the ball as a lump on the table: nothing fries, so the lid is not on
  const r = reload(h); assert.equal(r.run('phase'), 'TABLE'); assert.equal(r.eve().lid, false); assert.equal(r.run('fryHold'), false);
  // a short move leaves the lid on; carried to the side it comes off
  drive(h, line(S.lid, { x: S.lid.x + 20, y: S.lid.y + 10 }, { v: 300 }));
  assert.equal(h.eve().lid, true, 'a short move keeps the lid on');
  drive(h, line(S.lid, { x: S.lid.x + S.panR * 0.9, y: S.lid.y + 60 }, { v: 300 }));
  assert.equal(h.eve().lid, false); assert.equal(h.run('fryHold'), false);
  h.frames(600);
  const c = cook();
  assert.ok(c.t - b.t > 9.9 && (c.dry > b.dry || c.cook > b.cook), 'frying goes on after the lid is off');
  assert.deepEqual(h.events(), ['lamp', 'ball', 'lid-pause', 'lid-off']);
  // before the lamp and after the end a hidden page lays no lid
  const f = evening(); f.visibility(true); assert.equal(f.eve().lid, false);
  return { summary: `under the lid 10 s: dry ${a.dry.toFixed(4)}→${b.dry.toFixed(4)}, cook ${a.cook.toFixed(4)}→${b.cook.toFixed(4)}, pan time ${a.t.toFixed(2)}→${b.t.toFixed(2)} s; after the lid 10 s: dry ${c.dry.toFixed(4)}, cook ${c.cook.toFixed(4)}, pan time ${c.t.toFixed(2)} s` };
});

test('V7', 'radio: the sheet opens by touch; sound is off by default and toggles there; restart needs two presses; stand panel', () => {
  const h = evening(); light(h);
  const sheet = h.nodes.get('radioSheet');
  assert.equal(sheet.hidden, true);
  assert.equal(h.run('soundOn'), false, 'sound is off by default');
  tap(h, h.spots().radio);
  assert.equal(sheet.hidden, false, 'the radio opens the sheet');
  assert.match(h.nodes.get('evBuild').textContent, new RegExp('сборка ' + h.run('BUILD').match(/(\d+)$/)[1]));
  // while the sheet is open the field does not answer
  tap(h, h.spots().bowl); assert.equal(h.eve().ballsLeft, 2);
  h.nodes.get('sound').fire('click'); assert.equal(h.run('soundOn'), true); assert.equal(h.nodes.get('sound').textContent, 'звук: вкл');
  h.nodes.get('sound').fire('click'); assert.equal(h.run('soundOn'), false);
  h.nodes.get('evRestart').fire('click');
  assert.equal(h.eve().lamp, true, 'one press does not restart'); assert.equal(sheet.hidden, false);
  h.nodes.get('evRestart').fire('click');
  assert.deepEqual(h.eve(), { v: 1, lamp: false, ballsLeft: 3, rotiDone: 0, lid: false, over: false, ball: false });
  assert.equal(sheet.hidden, true); assert.equal(h.run('sheetHidden'), true);
  assert.deepEqual(h.events(), ['lamp', 'ball', 'radio', 'restart']);
  // «панель стенда» shows the panel and switches the frame off; again — back to the evening
  light(h);
  tap(h, h.spots().radio); h.nodes.get('evPanel').fire('click');
  assert.equal(h.nodes.get('panel').hidden, false); assert.equal(h.run('eveningActive()'), false); assert.equal(sheet.hidden, true);
  h.nodes.get('radioBtn').fire('click'); assert.equal(sheet.hidden, false, 'the panel has a «радио» button');
  h.nodes.get('evPanel').fire('click');
  assert.equal(h.nodes.get('panel').hidden, true); assert.equal(h.run('eveningActive()'), true);
  assert.equal(h.eve().ballsLeft, 2); assert.equal(h.eve().ball, true);
  const log = JSON.parse(h.run('playLogText()'));
  assert.equal(log.evening.state.ballsLeft, 2); assert.ok(log.evening.events.length >= 6);
  return { summary: `events ${h.events().join(' ')}; exported evening events ${log.evening.events.length}` };
});

test('V8', 'small portrait 375×667 and landscape 844×390: the frame lays out inside the canvas, lamp and bowl answer', () => {
  const out = [];
  for (const [w, hh] of [[375, 667], [844, 390]]) {
    const h = evening({ w, hh }), S = h.spots();
    for (const k of ['lamp', 'radio', 'bowl', 'counter', 'pan', 'work']) assert.ok(S[k].x > 0 && S[k].x < w && S[k].y > 0 && S[k].y < hh, `${k} is inside ${w}×${hh}`);
    assert.ok(S.counterBottom < S.pan.y, 'the counter is above the middle of the tava');
    light(h); assert.equal(h.eve().ballsLeft, 2);
    h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
    out.push(`${w}×${hh}: lamp ${Math.round(S.lamp.x)},${Math.round(S.lamp.y)} bowl ${Math.round(S.bowl.x)},${Math.round(S.bowl.y)} counter bottom ${Math.round(S.counterBottom)}`);
  }
  return { summary: out.join(' · ') };
});

const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\nevening: ${passed}/${results.length} passed`);
try {
  const dir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'evening-results.json'), JSON.stringify({ source: H.sourcePath, sha256: H.sourceSha256, passed, total: results.length, results }, null, 2));
} catch (e) { console.log('report not written: ' + e.message); }
process.exit(passed === results.length ? 0 : 1);
