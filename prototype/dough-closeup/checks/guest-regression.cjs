#!/usr/bin/env node
'use strict';
// v0 step 2 — Aunt Som, the first guest (docs/v0-step2-aunt-som.md): she comes while the first roti
// fries, knocks on the tava, knocks again on every new frying step, takes the roti released over her
// picture and answers honestly by the stand's crisp (dishCrisp): >= 5 crunch, otherwise a nod; leaves
// a gift on the shelf, sits, takes the second roti, leaves; the third roti goes to the counter.
// Pure Node/vm with the mocks of model-regression.cjs: stand.js, banana.js, egg.js, evening.js and
// guest.js run in ONE context in the order of index.html. Every action of the player goes through
// the stand's real window touch handlers; this is not a browser and says nothing about look or feel
// (whether nod and crunch read apart by the eye is a live question, not this file's).
//   node prototype/dough-closeup/checks/guest-regression.cjs path/to/stand.js [--only G1,G3]
// ALWAYS pass the stand.js of the checkout under test as the first argument. Report:
// runs/checks/guest-results.json of the checkout (runs/ is not in git).
// Script shortcuts, named where used: the dough of every ball is set to the stretch target (as V5 of
// evening-regression.cjs does); the crisp of a roti is SET by script before it is served (the stand
// grows it only from margarine under a dry sheet — G7 measures that by touches, without a shortcut).
// The helpers below are the ones of evening-regression.cjs (kept in step by hand).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const H = require('./model-regression.cjs');
const { boot, lcg } = H;
// the scripts index.html loads after stand.js, in its order (drizzle.js and counter-item.js draw only)
const sideScripts = ['banana.js', 'egg.js', 'evening.js', 'guest.js'].map(f => ({ file: path.join(path.dirname(H.sourcePath), f), src: fs.readFileSync(path.join(path.dirname(H.sourcePath), f), 'utf8') }));
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
const FRAME = 'step(1/60); bananaUpdate(1/60); eggUpdate(1/60); eveningUpdate(1/60);';   // what loop() runs besides drawing (eveningUpdate calls guestUpdate)
const W = 390, HH = 844;

// ── boot: stand.js, then evening.js in the same context ───────────────────────────────────────
function evening({ storage = [], search = '', w = W, hh = HH } = {}) {
  const h = boot(TUNE, w, hh, { storage });
  h.context.location.search = search;
  h.context.document.readyState = 'complete';
  for (const s of sideScripts) vm.runInContext(s.src, h.context, { filename: s.file, timeout: 10000 });
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
function serve(h, to) {
  const B = rotiBox(h);
  to = to || h.spots().counter;
  drive(h, line(B.c, to, { v: 420, hold: 80 }), { settle: 30 });
}


// ── guest helpers ─────────────────────────────────────────────────────────────────────────────
function guest(opts) {
  const h = evening(opts);
  h.g = () => h.J('GST');
  h.gs = () => h.J('guestSpots()');
  h.gev = () => h.J('gestures.filter(g=>g.kind==="guest").map(g=>g.event)');
  h.grows = () => h.J('gestures.filter(g=>g.kind==="guest")');
  h.pic = () => h.run('guestPic()');
  return h;
}
const reloadG = (h, opts = {}) => guest({ storage: [...h.storage], ...opts });
const sec = (h, s) => h.frames(Math.round(s * 60));
const fryNow = h => h.J('{t:dish.panTime,cook:meanCook(),dry:meanDry(),crisp:dishCrisp}');
// frames until cond (a stand expression) is true; returns the frames spent
function until(h, cond, max = 60 * 400) { let n = 0; while (!h.run(cond) && n < max) { h.frames(1); n++; } assert.ok(h.run(cond), `waited ${n} frames for ${cond}`); return n; }
function onPan(h) { stretched(h); toPan(h); }
function arrive(h) { until(h, 'GST.here'); until(h, 'guestPic()===2'); until(h, 'guestPic()===1'); }
function finish(h, crisp) { envelope(h); toTable(h); cut(h); if (crisp !== undefined) h.run(`dishCrisp=${crisp}`); }
const nextBall = h => { tap(h, h.spots().bowl); assert.equal(h.eve().ball, true, 'a ball is taken from the bowl'); };
const FRESH = { v: 1, here: false, gone: false, answers: [], gifts: [], taken: 0 };

// ── checks ────────────────────────────────────────────────────────────────────────────────────
test('G1', 'Som comes on the first ball by frying, not earlier; knocks after 1.5 s for 1.2 s; the tava jumps 2 px twice', () => {
  const h = guest(); light(h);
  assert.deepEqual(h.g(), FRESH);
  stretched(h); sec(h, 12);
  assert.equal(h.g().here, false, 'dough on the table for 12 s: no guest');
  toPan(h);
  const t0 = fryNow(h);
  assert.ok(t0.t < 8 && t0.cook < 0.08, 'just laid'); assert.equal(h.g().here, false, 'not before 8 s of frying');
  let n = 0; while (!h.g().here && n < 900) { h.frames(1); n++; }
  const at = fryNow(h);
  assert.equal(h.g().here, true); assert.ok(at.t >= 8 && at.t < 8.05, `arrives at 8 s of frying (pan time ${at.t})`);
  assert.equal(h.pic(), 1, 'picture 1: waiting');
  assert.equal(h.eve().ballsLeft, 2, 'on the first ball');
  // 1.5 s later the knock: picture 2 for 1.2 s, two 2 px jumps of the tava, then picture 1 again
  const wait = until(h, 'guestPic()===2');
  const shake = []; let knock = 0;
  while (h.pic() === 2 && knock < 200) { shake.push(h.run('panKnock')); h.frames(1); knock++; }
  const pulses = shake.filter((v, i) => v > 0 && !(shake[i - 1] > 0)).length;
  assert.ok(Math.abs(wait / 60 - 1.5) < 0.05, `knock 1.5 s after arrival (${(wait / 60).toFixed(2)} s)`);
  assert.ok(Math.abs(knock / 60 - 1.2) < 0.05, `the knock lasts 1.2 s (${(knock / 60).toFixed(2)} s)`);
  assert.equal(pulses, 2, 'the tava jumps twice');
  assert.equal(Math.max(...shake), 2 * h.run('eveGeo().u'), '2 px');
  assert.equal(h.run('panKnock'), 0); assert.equal(h.pic(), 1);
  assert.deepEqual(h.gev(), ['arrive', 'knock']);
  const rows = h.grows();
  assert.equal(rows[0].ballNo, 1); assert.equal(rows[0].kind, 'guest'); assert.equal(typeof rows[1].crisp, 'number');
  // the other way in: the bottom reaches «бледное» before 8 s (cook set by script)
  const q = guest(); light(q); onPan(q);
  q.run('for(const t of dish.thermal) if(t){t.dry[0]=t.dry[1]=1;t.cook[0]=t.cook[1]=0.09;}'); q.frames(2);
  assert.ok(fryNow(q).t < 8); assert.equal(q.g().here, true, 'a pale bottom brings her before 8 s');
  // the stand mode has no guest
  const d = guest({ search: '?dev=1' }); d.run('stepNo=3;reset();'); d.frames(600);
  assert.equal(d.g().here, false); assert.equal(d.run('panKnock'), 0);
  h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0, 'frames draw without errors');
  return { summary: `arrived at pan time ${at.t.toFixed(2)} s; knock after ${(wait / 60).toFixed(2)} s for ${(knock / 60).toFixed(2)} s; ${pulses} jumps of ${Math.max(...shake)} px` };
});

test('G2', 'a knock on every new frying step (hint, 0.8 s); no hint twice for one step', () => {
  const h = guest(); light(h); onPan(h); arrive(h);
  h.run('COOK_RATE=FRY_RATES[40]');   // script shortcut: the fast frying preset of the stand panel, to pass the steps sooner
  const seen = []; let frames = 0, hintFrames = 0, last = h.gev().length;
  while (h.run('guestCookStep()') < 3 && frames < 60 * 240) {
    h.frames(1); frames++;
    const ev = h.grows();
    if (ev.length > last) { last = ev.length; const r = ev.at(-1); seen.push(`${r.event}@${r.bottom}`); hintFrames = 0; while (h.pic() === 2) { h.frames(1); frames++; hintFrames++; } }
  }
  sec(h, 2);
  { const ev = h.grows(); if (ev.length > last) { last = ev.length; seen.push(`${ev.at(-1).event}@${ev.at(-1).bottom}`); } }
  assert.deepEqual(seen, ['hint@бледное', 'hint@приготовленное', 'hint@зажаренное'], 'one hint per step');
  assert.ok(Math.abs(hintFrames / 60 - 0.8) < 0.05, `a hint lasts 0.8 s (${(hintFrames / 60).toFixed(2)} s)`);
  sec(h, 10); assert.equal(h.gev().length, last, 'no more knocks on the same step');
  return { summary: `${seen.join(' → ')}; hint ${(hintFrames / 60).toFixed(2)} s; ${(frames / 60).toFixed(0)} s of frying at the fast preset` };
});

test('G3', 'released over her picture — hers; lower, on the counter band — the counter; beside her — the counter', () => {
  // (a) over her
  const h = guest(); light(h); onPan(h); arrive(h); finish(h);
  assert.equal(h.run('eveningLive("Разрезов: 1 · режь дальше или «заново»")'), 'нарезано · унеси наверх — гостье или на стойку');
  const G = h.gs();
  assert.ok(G.som.y < h.spots().counter.y, 'she is above the counter');
  serve(h, G.som);
  assert.equal(h.eve().rotiDone, 1); assert.equal(h.g().taken, 1); assert.equal(h.g().answers.length, 1);
  assert.equal(h.run('gestures.filter(g=>g.kind==="evening").at(-1).to'), 'som');
  assert.deepEqual(h.J('gestures.slice(-5).map(g=>g.kind+(g.event?"/"+g.event:"")+(g.outcome?"/"+g.outcome:""))'),
    ['serve', 'pan/serve-carry', 'guest/serve', 'guest/answer', 'evening/serve']);
  // (b) on the counter band, right under her
  const c = guest(); light(c); onPan(c); arrive(c); finish(c);
  serve(c, { x: c.gs().som.x, y: c.spots().counter.y });
  assert.equal(c.eve().rotiDone, 1); assert.equal(c.g().taken, 0); assert.equal(c.g().answers.length, 0); assert.equal(c.g().here, true, 'she still waits');
  assert.equal(c.pic(), 1);
  // (c) at her height but beside her picture (under the lamp)
  const b = guest(); light(b); onPan(b); arrive(b); finish(b);
  const Z = b.gs().zone; serve(b, { x: Z.x1 + 14, y: b.gs().som.y });
  assert.equal(b.eve().rotiDone, 1); assert.equal(b.g().taken, 0, 'beside her is the counter');
  // (d) she is not there yet: the same spot is the counter
  const e = guest(); light(e); stretched(e); toPan(e); envelope(e);
  const pt = e.run('dish.panTime'); toTable(e); cut(e);
  assert.equal(e.g().here, false, `the fast script folds before she comes (pan time ${pt.toFixed(1)} s)`);
  serve(e, e.gs().som); assert.equal(e.eve().rotiDone, 1); assert.equal(e.g().taken, 0);
  return { summary: `her zone x ${Math.round(G.zone.x0)}…${Math.round(G.zone.x1)}, y ≤ ${Math.round(G.zone.y1)}; counter band below to ${Math.round(h.spots().counterBottom)}` };
});

test('G4', 'crisp 4.9 → nod and bananas, 5.0 → crunch and jam; the answer holds 2.5 s; the gift survives a reload', () => {
  const out = [];
  for (const [crisp, answer, gift, pic] of [[4.94, 'nod', 'bananas', 3], [4.95, 'crunch', 'jam', 4], [0, 'nod', 'bananas', 3], [12, 'crunch', 'jam', 4]]) {
    const h = guest(); light(h); onPan(h); arrive(h); finish(h, crisp);   // script shortcut: the crisp is set, not fried
    serve(h, h.gs().som);
    const a = h.g().answers[0];
    assert.equal(a.answer, answer, `crisp ${crisp} → ${answer}`); assert.equal(a.crisp, +crisp.toFixed(1)); assert.equal(a.ballNo, 1);
    assert.equal(a.crisp, h.run('gestures.filter(g=>g.kind==="serve").at(-1).crisp'), 'the same number as the stand card');
    assert.deepEqual(h.g().gifts, [gift]); assert.equal(h.pic(), pic, `picture ${pic}`);
    assert.equal(h.gs().sat, false, 'the view does not move while she answers');
    const left = h.run('gAnswer'); let n = 0; while (h.pic() === pic && n < 400) { h.frames(1); n++; }
    const held = (2.5 - left) + n / 60;
    assert.ok(Math.abs(held - 2.5) < 0.05, `the answer holds 2.5 s (${held.toFixed(2)} s)`);
    assert.equal(h.pic(), 1); assert.equal(h.gs().sat, true, 'she sits after the answer'); assert.equal(h.g().here, true);
    const row = h.grows().at(-1);
    assert.equal(row.event, 'answer'); assert.equal(row.answer, answer); assert.equal(row.crisp, a.crisp); assert.equal(row.ballNo, 1);
    assert.deepEqual(h.saved().guest.gifts, [gift], 'saved in roti_evening');
    const r = reloadG(h);
    assert.deepEqual(r.g().gifts, [gift], 'the gift is on the shelf after a reload'); assert.equal(r.g().here, true); assert.equal(r.gs().sat, true);
    assert.equal(r.eve().rotiDone, 1); assert.equal(r.g().taken, 1);
    r.tick(3, 1 / 60, true); assert.equal(r.run('loopErrs'), 0);
    out.push(`${a.crisp}→${answer}/${gift}`);
  }
  return { summary: out.join(' · ') + '; held 2.5 s; gift after reload' };
});

test('G5', 'second ball — hers again, hints go on; after the second answer she leaves; the third roti goes to the counter', () => {
  const h = guest(); light(h); onPan(h); arrive(h); finish(h, 0);
  serve(h, h.gs().som); sec(h, 3);
  nextBall(h); onPan(h);
  assert.equal(h.pic(), 1); assert.equal(h.gs().sat, true);
  h.run('COOK_RATE=FRY_RATES[40]'); const n0 = h.gev().length;   // script shortcut: fast frying preset
  until(h, 'guestCookStep()>=1'); h.frames(2);
  assert.equal(h.grows().at(-1).event, 'hint'); assert.equal(h.grows().at(-1).ballNo, 2, 'she knocks on the second ball too');
  assert.equal(h.gev().length, n0 + 1); until(h, 'guestPic()===1');
  finish(h, 7.2); serve(h, h.gs().som);
  assert.deepEqual(h.g().answers.map(a => a.answer), ['nod', 'crunch'], 'the second answer is honest too');
  assert.deepEqual(h.g().gifts, ['bananas', 'jam']); assert.equal(h.pic(), 4); assert.equal(h.g().here, true);
  sec(h, 2.6);
  assert.equal(h.g().here, false, 'she leaves after the second answer'); assert.equal(h.g().gone, true); assert.equal(h.pic(), 0);
  assert.equal(h.grows().at(-1).event, 'leave'); assert.equal(h.grows().at(-1).why, 'answered');
  // third ball: no guest, the same release point is the counter
  nextBall(h); onPan(h); sec(h, 12);
  assert.equal(h.g().here, false, 'she does not come back on the third ball');
  finish(h, 9); serve(h, h.gs().som);
  assert.equal(h.eve().rotiDone, 3); assert.equal(h.g().taken, 2); assert.equal(h.g().answers.length, 2);
  assert.equal(h.run('gestures.filter(g=>g.kind==="evening").at(-1).to'), undefined);
  assert.equal(h.spots().lidHome, true, 'the lid appears: the evening ends as in step 1');
  const events = h.gev();
  const S = h.spots(); drive(h, line(S.lid, S.pan, { v: 300 }));
  assert.equal(h.eve().over, true); assert.equal(h.run('eveningLive("")'), 'вечер окончен · три роти');
  assert.deepEqual(h.g().gifts, ['bananas', 'jam'], 'the gifts stay on the shelf of the finished evening');
  h.tick(3, 1 / 60, true);
  tap(h, h.spots().lump);
  assert.deepEqual(h.g(), FRESH, 'a new evening starts without her and without gifts');
  // she was given nothing: she leaves when the third ball is taken
  const q = guest(); light(q); onPan(q); arrive(q); finish(q); serve(q); nextBall(q); onPan(q); finish(q); serve(q);
  assert.equal(q.g().here, true); assert.equal(q.eve().rotiDone, 2);
  nextBall(q); q.frames(2);
  assert.equal(q.g().here, false); assert.equal(q.grows().at(-1).why, 'third-ball');
  h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  return { summary: `events ${events.join(' ')}` };
});

test('G6', 'the lid pause freezes her: no knock under the lid, the knock comes after; an answer is not lost by a hidden page or a reload', () => {
  const h = guest(); light(h); onPan(h); until(h, 'GST.here'); sec(h, 0.5);
  assert.deepEqual(h.gev(), ['arrive']);
  h.visibility(true); assert.equal(h.eve().lid, true); h.visibility(false);
  sec(h, 10);
  assert.deepEqual(h.gev(), ['arrive'], 'no knock under the lid for 10 s'); assert.equal(h.pic(), 1); assert.equal(h.run('panKnock'), 0);
  const off = () => { const S = h.spots(); drive(h, line(S.lid, { x: S.lid.x + S.panR * 0.9, y: S.lid.y + 60 }, { v: 300 }), { settle: 0 }); assert.equal(h.eve().lid, false); };
  off();
  const n = until(h, 'guestPic()===2');
  assert.ok(n / 60 < 1.1, `the knock comes after the rest of its wait (${(n / 60).toFixed(2)} s)`);
  assert.deepEqual(h.gev(), ['arrive', 'knock']);
  // a hint under the lid waits too
  until(h, 'guestPic()===1');
  h.visibility(true); h.visibility(false);
  h.run('for(const t of dish.thermal) if(t){t.dry[0]=t.dry[1]=1;t.cook[0]=t.cook[1]=0.3;}');   // script: the roti is past «приготовленное»
  sec(h, 5); assert.deepEqual(h.gev(), ['arrive', 'knock'], 'no hint under the lid');
  off(); h.frames(3);
  assert.equal(h.gev().at(-1), 'hint', 'the hint comes when the lid is off');
  until(h, 'guestPic()===1');
  // the answer: a hidden page stops the frames, 10 s pass, the answer is still on show and holds its time
  finish(h, 6); serve(h, h.gs().som);
  assert.equal(h.pic(), 4);
  const left = h.run('gAnswer');
  h.visibility(true); assert.equal(h.eve().lid, false, 'nothing fries: no lid'); h.advance(10000); h.visibility(false);
  assert.equal(h.pic(), 4, 'the answer is still shown'); assert.equal(h.run('gAnswer'), left);
  // a reload in the middle of the answer keeps the answer, the gift and her
  const r = reloadG(h);
  assert.deepEqual(r.g().answers.map(a => a.answer), ['crunch']); assert.deepEqual(r.g().gifts, ['jam']); assert.equal(r.g().here, true);
  // a reload in the middle of the second answer: both are kept, she is gone
  sec(h, 3); nextBall(h); onPan(h); finish(h, 1); serve(h, h.gs().som);
  const r2 = reloadG(h);
  assert.deepEqual(r2.g().answers.map(a => a.answer), ['crunch', 'nod']); assert.deepEqual(r2.g().gifts, ['jam', 'bananas']);
  assert.equal(r2.g().here, false); assert.equal(r2.g().gone, true);
  return { summary: `10 s under the lid: no knock; knock ${(n / 60).toFixed(2)} s after the lid is off; answer time left ${left.toFixed(2)} s before and after 10 s of a hidden page` };
});

test('G7', 'honest crisp by touches: frying alone gives none; margarine led round the folded roti grows it to 5 (measured)', () => {
  const h = guest(); light(h); onPan(h); envelope(h);
  const B = h.J('(()=>{const b=butterSpot();return __harness.toClient(b.x,b.y)})()');
  const bb = h.J('(()=>{const b=dishBounds();return [__harness.dishToClient({x:b.left,y:b.top}),__harness.dishToClient({x:b.right,y:b.bottom})]})()');
  const cx = (bb[0].x + bb[1].x) / 2, cy = (bb[0].y + bb[1].y) / 2, hw = (bb[1].x - bb[0].x) / 2, hh = (bb[1].y - bb[0].y) / 2;
  const lap = k => {   // one touch: from the margarine piece along the edge of the envelope (k of its half-size)
    const pts = [{ x: B.x, y: B.y, t: 0 }]; let t = 100, prev = B;
    for (const [sx, sy] of [[1, -1], [-1, -1], [-1, 1], [1, 1], [1, -1]]) {
      const q = { x: cx + sx * hw * k, y: cy + sy * hh * k }, n = Math.ceil(Math.hypot(q.x - prev.x, q.y - prev.y) / 6);
      for (let i = 1; i <= n; i++) { t += 1000 / 60; pts.push({ x: prev.x + (q.x - prev.x) * i / n, y: prev.y + (q.y - prev.y) * i / n, t }); }
      prev = q;
    }
    pts.push({ ...pts.at(-1), t: t + 20 }); drive(h, pts, { settle: 0 });
  };
  const a = fryNow(h); sec(h, 20); const b = fryNow(h);
  assert.equal(b.crisp, a.crisp, 'frying alone does not grow the crisp');
  let laps = 0; while (h.run('dishCrisp') < 5 && laps < 200) { lap(0.92); laps++; }
  const c = fryNow(h);
  assert.ok(c.crisp >= 5, `the crisp reaches 5 by margarine (${c.crisp.toFixed(2)} after ${laps} laps)`);
  return { summary: `20 s of frying without margarine: crisp ${a.crisp.toFixed(2)}→${b.crisp.toFixed(2)}; margarine round the envelope: crisp 5 after ${laps} laps = ${(c.t - b.t).toFixed(0)} s of leading (${((c.crisp - b.crisp) / (c.t - b.t)).toFixed(3)} per s), pan time ${c.t.toFixed(0)} s, bottom ${h.run('cookWord(meanCook())')}` };
});

test('G8', 'layout at 390×844 and 375×667: her picture is above the counter, between shelf and lamp; every picture and both gifts draw', () => {
  const out = [];
  for (const [w, hh] of [[390, 844], [375, 667]]) {
    const h = guest({ w, hh }); light(h);
    const G = h.gs(), S = h.spots();
    assert.ok(G.slot.x > 0 && G.slot.x + G.slot.w < w && G.slot.y > 0, 'the slot is inside the screen');
    assert.ok(Math.abs(G.slot.y + G.slot.h - (S.counter.y - (S.counterBottom - S.counter.y))) < 4, 'the slot stands on the top edge of the counter');
    assert.ok(G.zone.x1 < S.lamp.x - 10, 'the lamp is to the right of her'); assert.ok(G.shelf.x < G.zone.x0, 'the shelf is to the left of her');
    assert.equal(G.pictures, false, 'placeholders (no Image in Node)');
    onPan(h); until(h, 'GST.here'); h.tick(2, 1 / 60, true);
    until(h, 'guestPic()===2'); h.tick(2, 1 / 60, true);
    until(h, 'guestPic()===1'); finish(h, 0); serve(h, h.gs().som); assert.equal(h.pic(), 3); h.tick(2, 1 / 60, true);
    sec(h, 3); nextBall(h); onPan(h); finish(h, 8); serve(h, h.gs().som); assert.equal(h.pic(), 4); h.tick(2, 1 / 60, true);
    assert.equal(h.run('loopErrs'), 0, 'all four pictures and the shelf draw without errors'); assert.deepEqual(h.errors, []);
    out.push(`${w}×${hh}: slot ${Math.round(G.slot.w)}×${Math.round(G.slot.h)} at ${Math.round(G.slot.x)},${Math.round(G.slot.y)}`);
  }
  return { summary: out.join(' · ') };
});

const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\nguest: ${passed}/${results.length} passed`);
try {
  const dir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'guest-results.json'), JSON.stringify({ source: H.sourcePath, sha256: H.sourceSha256, passed, total: results.length, results }, null, 2));
} catch (e) { console.log('report not written: ' + e.message); }
process.exit(passed === results.length ? 0 : 1);
