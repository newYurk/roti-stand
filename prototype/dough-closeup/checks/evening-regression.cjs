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
function envelope(h, sides = [2, 3, 0, 1]) {
  for (const k of sides) {
    const e = h.J(`(()=>{const E=dish.env,a=${k}<2?E.u:E.v,s=${k}%2?-1:1,d={x:a.x*s,y:a.y*s},hk=E.h[${k}];
      const hu=dish.hull.reduce((m,p)=>Math.max(m,(p.x-E.c.x)*d.x+(p.y-E.c.y)*d.y),0)/hk;
      return [__harness.dishToClient({x:E.c.x+d.x*hk*hu*.97,y:E.c.y+d.y*hk*hu*.97}),__harness.dishToClient(E.c)]})()`);
    const a = e[0], m = e[1], b = { x: a.x + (m.x - a.x) * 0.85, y: a.y + (m.y - a.y) * 0.85 };
    drive(h, line(a, b, { v: 170, hold: 150, stop: 60, seed: k + 3 }));
  }
  if (sides.length < 4) return;
  assert.equal(h.run('dish.folds'), 4, 'four folds');
  assert.equal(h.run('envelopeDone()'), true, 'the envelope is done');
}
// the line the player reads: one drawn frame, then #live
const liveNow = h => { h.tick(1, 1 / 60, true); return h.nodes.get('live').textContent; };
// a real flick from the right edge of the envelope outward: v CSS px/s, 60 Hz, released on the move
function flick(h, v = 700) {
  const e = h.J(`(()=>{const b=dishBounds();return [__harness.dishToClient({x:b.right-0.02,y:(b.top+b.bottom)/2}),__harness.dishToClient({x:b.right+0.5,y:(b.top+b.bottom)/2})]})()`);
  const a = e[0], dir = Math.sign(e[1].x - a.x) || 1, pts = [{ x: a.x, y: a.y, t: 0 }];
  for (let i = 1; i <= 9; i++) pts.push({ x: a.x + dir * v * i / 60, y: a.y, t: 120 + i * 1000 / 60 });
  pts.push({ ...pts.at(-1), t: pts.at(-1).t + 1 });
  drive(h, pts, { settle: 50 });
}
function toTable(h) {
  const c = h.J('(()=>{const b=dishBounds();return __harness.dishToClient({x:(b.left+b.right)/2,y:(b.top+b.bottom)/2})})()'), w = h.spots().work;
  drive(h, line(c, w, { v: 320, hold: 60 }), { settle: 60 });
  assert.equal(h.run('dish.mode'), 'cut', 'the envelope carried by the middle lies on the table');
}
const rotiBox = h => h.J(`(()=>{const b=dish.cutBounds,up=tableLiftCanvas()*cv.getBoundingClientRect().height/cv.height,
  P=(x,y)=>{const q=__harness.dishToClient({x,y});return {x:q.x,y:q.y-up}};
  return {c:P(dish.cutCenter.x,dish.cutCenter.y),l:P(b.left,dish.cutCenter.y),r:P(b.right,dish.cutCenter.y),t:P(dish.cutCenter.x,b.top),b:P(dish.cutCenter.x,b.bottom)}})()`);
// Build 80: «нарезано» is three edge-to-edge cuts of two directions (1 + 2); one cut no longer serves.
function cut(h) {
  const B = rotiBox(h), w = B.r.x - B.l.x, dx = w * 0.2, dy = (B.b.y - B.t.y) * 0.2;
  drive(h, line({ x: B.l.x - dx, y: B.c.y }, { x: B.r.x + dx, y: B.c.y }, { v: 380, hold: 60 }));
  assert.equal(h.run('dish.cuts.length'), 1, 'one cut through the envelope');
  assert.equal(h.run('cutEnough()'), false, 'one cut is not «нарезано»');
  for (const k of [-1, 1]) drive(h, line({ x: B.c.x + k * w / 6, y: B.t.y - dy }, { x: B.c.x + k * w / 6, y: B.b.y + dy }, { v: 380, hold: 60 }));
  assert.equal(h.run('dish.cuts.length'), 3, 'three cuts, each from edge to edge');
  assert.equal(h.run('cutEnough()'), true, 'two across one: «нарезано»');
}
function serve(h, { short = false } = {}) {
  const B = rotiBox(h), S = h.spots();
  // short: released at the rim of the tava, not reaching the counter. (It used to be the middle of the tava; since
  // the review fixes of the frying batch, 17.11, the middle of the tava takes the roti back to fry on — V3 below.)
  const to = short === 'pan' ? { x: S.pan.x, y: S.pan.y } : short ? { x: S.pan.x - S.panR * 0.93, y: S.pan.y } : { x: S.counter.x, y: S.counter.y };
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
  // Changed in build 80: the words of the game are written by the stand itself — one short line (LINE_MAX), no
  // egg, no percent, no arrows — so the table of replacements is down to the two lines of the stand's tear prediction.
  const words = h.J(`["порвался без предсказания — жми «сейчас порвётся», пока тянешь","лист уже порван — предсказывать нечего, жми «заново»"].map(m=>eveningLive(m))`);
  for (const w of words) assert.ok(typeof w === 'string' && w.length && w.length <= h.run('LINE_MAX') && !/яйц|заново|жми|сейчас порвётся/.test(w), `plain words instead of stand wording: ${w}`);
  assert.equal(h.run('eveningLive("сырое · подсыхает")'), null, 'other stand lines pass through');
  assert.equal(h.run('dish.message'), 'коснись середины — ляжет банан', 'no egg in the evening (it was «Положи банан и яйцо…»)');
  envelope(h); toTable(h);
  // an uncut roti led from its middle to the counter is neither a cut nor a serve
  // Build 88 (visible gesture): the uncut roti does not lift at all — the stroke is a knife stroke that fails, nothing pops up.
  serve(h);
  assert.equal(h.run('dish.cuts.length'), 0, 'no cut by a carry to the counter'); assert.equal(h.eve().rotiDone, 0);
  assert.equal(h.run('dish.mode'), 'cut', 'still on the table'); assert.ok(!/^serve|pan-back/.test(h.run('gestures.at(-1).outcome') || ''), 'not lifted');
  assert.equal(h.run('dish.message'), 'режь от края до края', 'no «сначала разрежь»');
  cut(h);
  serve(h, { short: true });
  assert.equal(h.run('!!dish'), true, 'released at the rim of the tava: the roti stays on the table');
  assert.equal(h.run('gestures.at(-1).outcome'), 'serve-back'); assert.equal(h.run('dish.mode'), 'cut');
  assert.equal(h.eve().rotiDone, 0);
  // released over the middle of the tava: it goes back to fry on, whole; then to the table and cut again
  serve(h, { short: 'pan' });
  assert.equal(h.run('gestures.at(-1).outcome'), 'pan-back'); assert.equal(h.run('dish.mode'), 'fold'); assert.equal(h.run('phase'), 'PAN');
  assert.equal(h.run('dish.cuts.length'), 0); assert.equal(h.eve().rotiDone, 0); assert.equal(h.eve().ball, true);
  toTable(h); cut(h);
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

// ── build 80: the way in and the hints (playtest of 17.11, items 11, 12, 16, 17) ─────────────────────────
test('V9', 'the unlit lamp swings by itself every 5 s and at any touch in the dark; it hangs still once lit; no words', () => {
  const h = evening(); const S0 = h.spots();
  assert.equal(S0.swings, 0); assert.equal(S0.swing, 0, 'it hangs still at the very start');
  let peak = 0, first = null; const starts = [];
  for (let f = 1; f <= 60 * 13; f++) {
    const n = h.spots().swings; h.frames(1); const S = h.spots();
    if (S.swings > n) starts.push(f / 60);
    peak = Math.max(peak, Math.abs(S.swing)); if (first === null && S.swing !== 0) first = f / 60;
  }
  assert.ok(starts.length === 3 && [1.5, 6.5, 11.5].every((t, i) => Math.abs(starts[i] - t) < 0.1), `by itself: 1.5 s after the start, then every 5 s (${starts.map(t => t.toFixed(2)).join(', ')})`);
  assert.ok(peak > 0.08 && peak <= 0.16, `a small swing (${peak.toFixed(3)} rad)`);
  assert.equal(h.run('eveningLive("")'), '', 'no words'); assert.equal(h.eve().lamp, false);
  // a touch in the dark, anywhere but the lamp: a bigger swing at once
  h.frames(60 * 2); assert.equal(h.spots().swing, 0, 'it hangs still between the swings');
  let tapPeak = 0; const n1 = h.spots().swings; tap(h, h.spots().bowl);
  assert.equal(h.spots().swings, n1 + 1, 'the bowl in the dark swings the lamp'); assert.equal(h.eve().lamp, false);
  for (let f = 0; f < 60; f++) { h.frames(1); tapPeak = Math.max(tapPeak, Math.abs(h.spots().swing)); }
  assert.ok(tapPeak > peak * 1.5, `the touch swings it harder than it swings itself (${tapPeak.toFixed(3)} > ${peak.toFixed(3)})`);
  const n2 = h.spots().swings; tap(h, h.spots().pan); assert.equal(h.spots().swings, n2 + 1, 'the tava too');
  h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0, 'the swinging lamp draws');
  // lit: still
  light(h); assert.equal(h.eve().lamp, true); const n3 = h.spots().swings;
  h.frames(60 * 8); assert.equal(h.spots().swing, 0); assert.equal(h.spots().swings, n3, 'a lit lamp does not swing');
  assert.deepEqual(h.errors, []);
  return { summary: `self swings at ${starts.map(t => t.toFixed(1)).join(', ')} s, peak ${peak.toFixed(3)} rad; touch peak ${tapPeak.toFixed(3)} rad` };
});

test('V10', 'one short line at a time: no percent, no arrow, no «лепесток», no egg; a hint goes for the rest of the evening once its gesture has worked; a tap on the edge of the sheet twitches it (drawing only)', () => {
  const h = evening(); light(h); const seen = [];
  const say = (want, why) => { const m = liveNow(h); seen.push(m); if (want !== undefined) assert.equal(m, want, why); return m; };
  say('прижми кусок и веди пальцем', 'ball 1, lump');
  flatten(h); say('палец на край — и мах наружу', 'ball 1, thin disc');
  // a tap on the edge: the edge twitches in the drawing, the nodes do not move
  { const e = h.J('(()=>{const c=centerOfSheet(),R=sheetRadius();return __harness.toClient(c.x+R*0.97,c.y)})()');
    const sum = () => h.run('(()=>{let s=0;for(let i=0;i<N;i++)s+=px[i]*31+py[i]*17;return s})()'), s0 = sum();
    h.touch('start', 't1', e.x, e.y); h.frames(3); h.touch('end', 't1', e.x, e.y);
    assert.equal(h.run('!!twitch'), true, 'a tap on the edge starts a twitch'); let far = 0, t = 0;
    while (h.run('!!twitch') && t < 60) { h.frames(1); t++; far = Math.max(far, h.run('(()=>{rimDraw();let m=0;if(twitch)for(const i of twitch.ids)m=Math.max(m,Math.hypot(dX[i]-px[i],dY[i]-py[i]));return m/gsCss()*0+m})()') / h.run('sheetRadius()')); }
    assert.ok(far > 0.03, `the drawn edge moves by ${(far * 100).toFixed(1)} % of the radius`); assert.ok(t >= 15 && t <= 22, `for about a third of a second (${t} frames)`);
    assert.equal(sum(), s0, 'the nodes of the sheet did not move: the sheet does not grow from taps'); assert.equal(h.run('stepNo'), 2);
    seen.twitch = `${(far * 100).toFixed(1)} % of the radius, ${t} frames`; }
  stretch(h); say('готово — за середину и на таву', 'ball 1, stretched');
  toPan(h); say('коснись середины — ляжет банан');
  tap(h, h.spots().pan); { const n = h.run('dish.filling.length'); assert.ok(n >= 10 && n <= 14, `a tap in the middle lays the banana heap (${n} slices; build 85)`); } say('веди от края к середине');
  envelope(h, [2, 3]); say('теперь две другие стороны'); envelope(h, [0, 1]); assert.equal(h.run('envelopeDone()'), true); say('', 'build 88: no «конверт готов» — the envelope is seen');
  h.frames(60 * 3); say('', 'both sides raw: silence');
  while (h.run('fryStep(meanCook())') < 2) h.frames(10);
  h.frames(3); say('', 'build 88: no «край румяный — мах от края» — touching the edge lifts the corner');
  flick(h); assert.equal(h.run('dish.flips'), 1); say();
  toTable(h); say('режь от края до края');
  cut(h); say('нарезано — за середину и неси');
  assert.deepEqual(Object.keys(h.J('learned')).sort(), ['banana', 'carry', 'cut', 'flat', 'flip', 'fold', 'pull', 'table']);
  serve(h); assert.equal(h.eve().rotiDone, 1); assert.equal(h.run('learned.serve'), 1);
  // a reload keeps what was learned this evening
  assert.equal(reload(h).run('learned.fold'), 1, 'learned hints survive a reload');
  // ball 2: every gesture that has worked is silent; the slap never worked (the sheet was pulled) — its hint stays
  tap(h, h.spots().bowl); assert.equal(h.eve().ball, true);
  say('', 'ball 2, lump: no «прижми»');
  flatten(h); say('палец на край — и мах наружу', 'the slap has not worked yet this evening');
  stretch(h); say('', 'ball 2, stretched: no «за середину и на таву»');
  toPan(h); say('', 'ball 2: no «коснись середины»');
  envelope(h, [2, 3]); say(''); envelope(h, [0, 1]); say('', 'build 88: no «конверт готов»');
  while (h.run('fryStep(meanCook())') < 2) h.frames(10);
  h.frames(160); say('', 'build 88: the browned edge is shown by the lifted corner, not by a line');
  flick(h); toTable(h); say('', 'ball 2: no «режь от края до края»');
  cut(h); say('нарезано', 'ball 2: «нарезано» alone');
  for (const m of seen) {
    assert.ok(m.length <= h.run('LINE_MAX'), `at most ${h.run('LINE_MAX')} characters: «${m}» (${m.length})`);
    assert.ok(!/%|→|лепесток|рваный|яйц|·|\n/.test(m), `one plain message: «${m}»`);
  }
  // Review of build 80 — «теперь другой край — по кругу» only for the SAME edge (closer than 20°): slaps 30° apart
  // go round and never read it (the limit was 56.6°, and a player going round by 30–45° was told to change the edge);
  // touching the edge does not change the line (it used to blink «держишь край — махни наружу» on every tap).
  { const q = evening(); light(q); flatten(q); const base = Math.PI / 8, lines = [], kinds = [];
    const slapAt = deg => { const r = H.stroke(q, { angle: base + deg * Math.PI / 180, speed: 9, dist: 1.3, hz: 60, jitter: 1, seed: 7 + deg, hold: 150 }); kinds.push(r.kind); q.frames(20); lines.push(liveNow(q)); return q.run('sameSlapN'); };
    assert.equal(slapAt(0), 1); assert.equal(slapAt(30), 1, '30° from the last slap: another edge'); assert.equal(slapAt(60), 1); assert.equal(slapAt(25), 1, '35° back: another edge');
    assert.ok(kinds.every(k => k === 'slap'), `all four are slaps: ${kinds.join(' ')}`);
    assert.ok(lines.every(m => m !== 'теперь другой край — по кругу'), `round by 30°: ${lines.join(' | ')}`);
    if (q.run('stepNo') === 2) {
      assert.equal(slapAt(25), 2, 'the same spot again'); const n = slapAt(35); assert.equal(n, 3, '10° away is the same edge');
      if (q.run('stepNo') === 2) { assert.equal(lines.at(-1), 'теперь другой край — по кругу');
        const e = q.J(`(()=>{const c=centerOfSheet();rimProfile(c);const a=${base},r=rimProf[rimBin(a)];return __harness.toClient(c.x+Math.cos(a)*r,c.y+Math.sin(a)*r)})()`);
        q.touch('start', 't1', e.x, e.y); q.frames(4); const held = liveNow(q), state = q.run('action.state'); q.touch('end', 't1', e.x, e.y); q.frames(30);
        assert.equal(state, 'ARMED'); assert.equal(held, 'теперь другой край — по кругу', 'the line does not change while the edge is held'); } }
    seen.slaps = `${kinds.length} slaps, sameSlapN ${q.run('sameSlapN')}`; assert.deepEqual(q.errors, []); }
  // a new evening: the hints are back
  h.run('eveNewEvening("check")'); h.frames(2); assert.deepEqual(h.J('learned'), {}); light(h); say('прижми кусок и веди пальцем', 'a new evening teaches again');
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  const uniq = [...new Set(seen.filter(Boolean))];
  return { summary: `${uniq.length} different lines, longest ${Math.max(...uniq.map(m => m.length))} characters; twitch ${seen.twitch}; round the sheet: ${seen.slaps}; lines: ${uniq.join(' | ')}` };
});

test('V11', 'the fourth fold: with three sides folded, a stroke inward that starts in the outer third of the open side — deeper than the edge band — folds it and never carries the roti; outward from the same spot it is still a carry; no flip advice before the fourth fold', () => {
  const start = (h, f, k = 1) => h.J(`(()=>{const E=dish.env,d=envSide(E,${k}),q={x:E.c.x+d.x*E.h[${k}]*${f},y:E.c.y+d.y*E.h[${k}]*${f}};
    let hu=0; for(let s=0;s<=1.3;s+=0.005) if(onMaterial({x:E.c.x+d.x*E.h[${k}]*s,y:E.c.y+d.y*E.h[${k}]*s},0)) hu=s;   // where the material ends on the axis of the side
    return {a:__harness.dishToClient(q),c:__harness.dishToClient(E.c),open:openSideAt(q),hu}})()`);
  const three = (sides = [2, 3, 0]) => { const h = evening(); light(h); stretched(h); toPan(h); envelope(h, sides); assert.equal(h.run('envDoneCount()'), 3); return h; };
  const lastPan = h => h.J('gestures.filter(g=>g.kind==="pan").at(-1)');
  // (a) 0.72 of the half-width: inside the outer third, outside the edge band (the «middle», where a carry starts)
  const h = three(), P = start(h, 0.72);
  assert.equal(P.open, 1, 'the spot is in the outer third of the open side');
  h.touch('start', 't1', P.a.x, P.a.y); assert.equal(h.run('dishGesture.zone'), 'middle', 'deeper than the edge band: until build 80 a move from here was a carry'); h.touch('end', 't1', P.a.x, P.a.y); h.frames(5);
  h.run('for(const t of dish.thermal) if(t){t.dry[0]=t.dry[1]=1;t.cook[0]=t.cook[1]=0.3;}'); h.frames(3);   // script: «приготовленное» on both sides
  assert.equal(h.run('fryHint()'), null, 'three folds: the frying line is silent — no «переверни» before the fourth fold');
  const b = { x: P.a.x + (P.c.x - P.a.x) * 0.6, y: P.a.y + (P.c.y - P.a.y) * 0.6 };
  drive(h, line(P.a, b, { v: 170, hold: 150, stop: 60, seed: 5 }));
  const r = h.J('gestures.filter(g=>g.kind==="pan").at(-1)');
  assert.equal(r.outcome, 'fold', `an inward stroke from the outer third folds (${r.outcome})`); assert.equal(r.outerThird, true); assert.equal(r.side, 1);
  assert.equal(h.run('envelopeDone()'), true, 'the fourth side is folded'); assert.equal(h.run('dish.folds'), 4); assert.equal(h.run('dish.mode'), 'fold');
  // a short one too: 16 px inward is enough («any inward move»)
  const s = three(), Q = start(s, 0.72), dir = Math.sign(Q.c.x - Q.a.x);
  drive(s, line(Q.a, { x: Q.a.x + dir * 16, y: Q.a.y }, { v: 120, hold: 150, stop: 60, seed: 6 }));
  assert.equal(s.run('envelopeDone()'), true, 'a 16 px move inward folds the side');
  // (b) from the same spot outward, down to the table: still a carry
  const c = three(), R = start(c, 0.72), w = c.spots().work;
  drive(c, line(R.a, w, { v: 320, hold: 60 }), { settle: 60 });
  assert.equal(c.run('dish.mode'), 'cut', 'outward from the outer third: the roti is carried to the table'); assert.equal(c.run('envDoneCount()'), 3);
  // (c) from the true middle inward: a carry that comes back, as before
  const m = three(), M = start(m, 0.2);
  assert.equal(M.open, -1);
  drive(m, line(M.a, { x: M.a.x + (M.c.x - M.a.x) + Math.sign(M.c.x - M.a.x) * 40, y: M.a.y }, { v: 170, hold: 60 }), { settle: 40 });
  assert.equal(m.J('gestures.filter(g=>g.kind==="pan").at(-1)').outcome, 'carry-back'); assert.equal(m.run('envDoneCount()'), 3);
  // (d) Review of build 80 — the EDGE BAND of the open side (0.93 and 0.98 of its half-width; there the old foldPlan
  // decided: 12–24 px inward did nothing, 45 px made a free fold and the envelope stayed «3 of 4»). Any inward
  // stroke longer than the dead zone folds the side.
  const band = [];
  for (const f of [0.93, 0.98]) for (const px of [16, 24, 45]) {
    const e = three(), E = start(e, f), dir = Math.sign(E.c.x - E.a.x);
    e.touch('start', 't1', E.a.x, E.a.y); assert.equal(e.run('dishGesture.zone'), 'edge', `${f} of the half-width is the edge band`); e.touch('end', 't1', E.a.x, E.a.y); e.frames(5);
    drive(e, line(E.a, { x: E.a.x + dir * px, y: E.a.y }, { v: 170, hold: 150, stop: 60, seed: px }));
    const g = lastPan(e); band.push(`${f}/${px}px ${g.outcome}`);
    assert.equal(g.outcome, 'fold', `${f} h, ${px} px inward: ${g.outcome}`); assert.equal(g.side, 1); assert.equal(e.run('envelopeDone()'), true); assert.deepEqual(e.errors, []);
  }
  // (e) after a free fold of the open side its edge has moved inward (script shortcut for the fold itself: until this
  // review a 45 px stroke from the rim made it, now such a stroke folds the side); a 30 px stroke from the new edge
  // folds the side — the envelope closes
  const fr = three();
  assert.equal(fr.run('(()=>{const E=dish.env,d=envSide(E,1),h=E.h[1];return foldDish({x:E.c.x+d.x*h,y:E.c.y+d.y*h},{x:E.c.x+d.x*h*0.62,y:E.c.y+d.y*h*0.62},0.3,-1)})()'), true, 'a free fold of the open side');
  fr.frames(5); assert.equal(fr.run('envDoneCount()'), 3); assert.equal(fr.run('dish.folds'), 4);
  const F1 = start(fr, 0.5); assert.ok(F1.hu < 1, `the free fold moved the edge inward (${F1.hu.toFixed(2)} of the half-width)`);
  { const A = start(fr, F1.hu * 0.97), dir = Math.sign(A.c.x - A.a.x); drive(fr, line(A.a, { x: A.a.x + dir * 30, y: A.a.y }, { v: 170, hold: 150, stop: 60, seed: 10 })); }
  assert.equal(lastPan(fr).outcome, 'fold', `30 px from the new edge: ${lastPan(fr).outcome}`); assert.equal(lastPan(fr).side, 1); assert.equal(fr.run('envelopeDone()'), true, 'after a free fold a 30 px stroke from the edge closes the envelope');
  // (f) the FAR side open, the roti grabbed in its outer third and led down to the table: a carry, not a fold
  // (the finger starts inward along that side, so the gesture began as its fold — review of build 80)
  const far = three([2, 0, 1]), FA = start(far, 0.75, 3); assert.equal(FA.open, 3);
  drive(far, line(FA.a, far.spots().work, { v: 320, hold: 60 }), { settle: 60 });
  assert.equal(far.run('dish.mode'), 'cut', `led from the far side to the table: the roti is carried (${lastPan(far).outcome})`); assert.equal(far.run('envDoneCount()'), 3); assert.equal(lastPan(far).outcome, 'remove');
  // and a deep fold stroke from the far side that stops ON the roti is still the fold
  const deep = three([2, 0, 1]), DA = start(deep, 0.75, 3);
  drive(deep, line(DA.a, { x: DA.c.x, y: DA.c.y + (DA.c.y - DA.a.y) * 0.3 }, { v: 170, hold: 150, stop: 60, seed: 11 }));
  assert.equal(lastPan(deep).outcome, 'fold', `a deep stroke from the far side: ${JSON.stringify(lastPan(deep))}`); assert.equal(deep.run('envelopeDone()'), true);
  assert.deepEqual(h.errors.concat(s.errors, c.errors, m.errors, fr.errors, far.errors, deep.errors), []);
  return { summary: `0.72 h inward → ${r.outcome} side ${r.side} (${r.path_css} px at ${r.speed} px/s); 16 px inward → fold; to the table → carry; from the middle → carry-back; edge band: ${band.join(', ')}; after a free fold (edge at ${F1.hu.toFixed(2)} h) 30 px → envelope done; far side → table: ${lastPan(far).outcome}; far side deep stroke → fold` };
});

test('V12', 'a cut counts only from edge to edge; «нарезано» after three cuts of two directions (1 + 2 or 2 + 2); before that the roti is not served; a board lies under the roti on the table', () => {
  const h = evening(); light(h); stretched(h); toPan(h); envelope(h); toTable(h);
  const B = rotiBox(h), w = B.r.x - B.l.x, hh = B.b.y - B.t.y, msg = () => h.run('dish.message');
  // the board: under the whole roti, inside the work zone
  { const Bd = h.J('boardRect()'), Z = h.J('zone("work")'), cb = h.J('(()=>{const p=dishPose(),b=dish.cutBounds;return {x0:p.x+b.left*p.scale,x1:p.x+b.right*p.scale,y0:p.y+b.top*p.scale,y1:p.y+b.bottom*p.scale}})()');
    assert.ok(Bd.x0 < cb.x0 && Bd.x1 > cb.x1 && Bd.y0 < cb.y0 && Bd.y1 > cb.y1, 'the board is under the whole roti');
    assert.ok(Bd.x0 >= Z.x && Bd.x1 <= Z.x + Z.w && Bd.y0 >= Z.y && Bd.y1 <= Z.y + Z.h, 'and inside the work zone');
    h.tick(2, 1 / 60, true); assert.equal(h.run('loopErrs'), 0); }
  // a scratch: 30 % of the width in the middle of the roti
  drive(h, line({ x: B.c.x - w * 0.15, y: B.c.y }, { x: B.c.x + w * 0.15, y: B.c.y }, { v: 380, hold: 60 }));
  assert.equal(h.run('dish.cuts.length'), 0, 'a 30 % scratch is not a cut'); assert.equal(msg(), 'режь от края до края');
  // from outside to the middle: not a cut either
  drive(h, line({ x: B.l.x - w * 0.2, y: B.c.y }, { x: B.c.x + w * 0.1, y: B.c.y }, { v: 380, hold: 60 }));
  assert.equal(h.run('dish.cuts.length'), 0, 'a stroke that ends in the middle is not a cut');
  // a finger that starts and ends a little inside the edge (8 % of the width): a cut, and it goes through the whole roti
  drive(h, line({ x: B.l.x + w * 0.08, y: B.c.y - hh * 0.17 }, { x: B.r.x - w * 0.08, y: B.c.y - hh * 0.17 }, { v: 380, hold: 60 }));
  assert.equal(h.run('dish.cuts.length'), 1, 'almost edge to edge counts');
  { const k = h.J('(()=>{const c=dish.cuts[0],b=dish.cutBounds;return {len:Math.hypot(c.b.x-c.a.x,c.b.y-c.a.y),w:b.right-b.left}})()'); assert.ok(k.len > k.w, `the cut runs through the whole roti (${k.len.toFixed(2)} > ${k.w.toFixed(2)})`); }
  assert.equal(msg(), 'ещё рез'); assert.equal(h.run('cutEnough()'), false);
  // one cut: led from the middle to the counter it is not served
  // Build 88 (visible gesture): a roti with one cut does not lift — no «сначала дорежь», the line keeps the state of the cutting.
  serve(h); assert.equal(h.eve().rotiDone, 0, 'one cut does not serve'); assert.equal(msg(), 'ещё рез'); assert.equal(h.run('dish.cuts.length'), 1);
  h.frames(160); assert.equal(liveNow(h), 'ещё рез', 'the line is the state of the cutting');
  // a second cut along the first: two of one direction — «теперь поперёк»
  drive(h, line({ x: B.l.x - w * 0.2, y: B.c.y + hh * 0.17 }, { x: B.r.x + w * 0.2, y: B.c.y + hh * 0.17 }, { v: 380, hold: 60 }));
  assert.equal(h.run('dish.cuts.length'), 2); assert.deepEqual(h.J('cutFamilies()'), [2, 0]); assert.equal(msg(), 'теперь поперёк'); assert.equal(h.run('cutEnough()'), false);
  serve(h); assert.equal(h.eve().rotiDone, 0, 'two cuts of one direction do not serve');
  // across: 2 + 1 is «нарезано»
  drive(h, line({ x: B.c.x - w / 6, y: B.t.y - hh * 0.2 }, { x: B.c.x - w / 6, y: B.b.y + hh * 0.2 }, { v: 380, hold: 60 }));
  assert.deepEqual(h.J('cutFamilies()'), [2, 1]); assert.equal(h.run('cutEnough()'), true); assert.equal(msg(), 'нарезано — за середину и неси');
  // build 85: «нарезано» slides the roti onto the paper tray at the near edge — the fourth cut is aimed at it there
  { const T = rotiBox(h), tw = T.r.x - T.l.x, th = T.b.y - T.t.y;
    assert.equal(h.run('dish.tray'), true, '«нарезано»: the roti is on the tray');
    drive(h, line({ x: T.c.x + tw / 6, y: T.t.y - th * 0.2 }, { x: T.c.x + tw / 6, y: T.b.y + th * 0.2 }, { v: 380, hold: 60 })); }
  assert.deepEqual(h.J('cutFamilies()'), [2, 2], '2 + 2: the nine squares of the street vendor'); assert.equal(h.run('dish.cuts.length'), 4);
  h.tick(2, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  serve(h); assert.equal(h.eve().rotiDone, 1, 'cut through, it is served');
  // 1 + 1 is not enough; a diagonal is a direction like any other
  const d = evening(); light(d); stretched(d); toPan(d); envelope(d); toTable(d);
  const D = rotiBox(d), dw = D.r.x - D.l.x, dh = D.b.y - D.t.y;
  drive(d, line({ x: D.l.x - dw * 0.2, y: D.c.y }, { x: D.r.x + dw * 0.2, y: D.c.y }, { v: 380, hold: 60 }));
  drive(d, line({ x: D.c.x - dw / 6, y: D.t.y - dh * 0.2 }, { x: D.c.x - dw / 6, y: D.b.y + dh * 0.2 }, { v: 380, hold: 60 }));
  assert.deepEqual(d.J('cutFamilies()'), [1, 1]); assert.equal(d.run('cutEnough()'), false); assert.equal(d.run('dish.message'), 'ещё один рез');
  drive(d, line({ x: D.l.x - dw * 0.15, y: D.t.y - dh * 0.15 }, { x: D.r.x + dw * 0.15, y: D.b.y + dh * 0.15 }, { v: 380, hold: 60 }));
  assert.equal(d.run('dish.cuts.length'), 3, 'a diagonal from corner to corner is a cut'); assert.equal(d.run('cutEnough()'), true);
  // Review of build 80 — corners sliced off are not cuts: three strokes, each taking 20 % of the sides at a corner
  // (they used to give «нарезано» on a whole roti)
  const k = evening(); light(k); stretched(k); toPan(k); envelope(k); toTable(k);
  const K = rotiBox(k), kw = K.r.x - K.l.x, kh = K.b.y - K.t.y;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1]]) {
    const cx = sx < 0 ? K.l.x : K.r.x, cy = sy < 0 ? K.t.y : K.b.y, p = { x: cx - sx * kw * 0.2, y: cy }, q = { x: cx, y: cy - sy * kh * 0.2 };
    drive(k, line({ x: p.x + (p.x - q.x) * 0.4, y: p.y + (p.y - q.y) * 0.4 }, { x: q.x + (q.x - p.x) * 0.4, y: q.y + (q.y - p.y) * 0.4 }, { v: 380, hold: 60 }));
  }
  assert.equal(k.run('dish.cuts.length'), 0, 'a sliced corner is not a cut'); assert.equal(k.run('cutEnough()'), false); assert.equal(k.run('dish.message'), 'режь от края до края');
  // Build 88 (visible gesture, spec part 2): until it is cut the roti does not lift from the table — to the counter,
  // short of it, to the tava: it stays on the table, no line pops up, no way back to the tava (was: «сначала разрежь»,
  // serve-uncut, pan-back with «снова на таве», build 80–87). A stroke from the middle is just a knife stroke that fails.
  const pan = h => (h.J('gestures.filter(g=>g.kind==="pan").at(-1)') || {}).outcome;
  for (const how of [undefined, { short: true }, { short: 'pan' }]) {
    serve(k, how); assert.equal(k.eve().rotiDone, 0); assert.equal(k.run('dish.mode'), 'cut', 'stays on the table');
    assert.equal(k.run('dish.message'), 'режь от края до края'); assert.ok(!/^serve|pan-back/.test(pan(k) || ''), `not lifted (${pan(k)})`);
  }
  // one cut, then towards the tava: still on the table, the cut stays
  { const B1 = rotiBox(k), w1 = B1.r.x - B1.l.x; drive(k, line({ x: B1.l.x - w1 * 0.2, y: B1.c.y }, { x: B1.r.x + w1 * 0.2, y: B1.c.y }, { v: 380, hold: 60 })); }
  assert.equal(k.run('dish.cuts.length'), 1); serve(k, { short: 'pan' });
  assert.notEqual(pan(k), 'pan-back', 'a roti with one cut does not go back to the tava'); assert.equal(k.run('dish.mode'), 'cut'); assert.equal(k.run('dish.cuts.length'), 1);
  assert.deepEqual(h.errors.concat(d.errors, k.errors), []);
  return { summary: `three sliced corners → 0 cuts; uncut and one cut: not lifted, stays on the table (build 88); scratch 30 % → no cut; 8 % inside both edges → a full cut; 1 cut and 2 along → not served; 2 + 1 → «нарезано»; 2 + 2 → 4 cuts; 1 + 1 → «ещё один рез», + diagonal → «нарезано»` };
});

const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\nevening: ${passed}/${results.length} passed`);
try {
  const dir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'evening-results.json'), JSON.stringify({ source: H.sourcePath, sha256: H.sourceSha256, passed, total: results.length, results }, null, 2));
} catch (e) { console.log('report not written: ' + e.message); }
process.exit(passed === results.length ? 0 : 1);
