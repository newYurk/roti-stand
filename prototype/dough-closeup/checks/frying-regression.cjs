#!/usr/bin/env node
'use strict';
// Batch «ЖАРКА», build 78 (playtest 17.11.2026, items 1–7 of runs/playtest-2026-11-17/SUMMARY.md):
// frying is short, visible and can be spoiled. What this file holds:
//   F1 times: «приготовленное» on the steel side ~20 s, «горелое» ~60 s; a flip in time is the fast path;
//   F2 one ladder for the words of the stand and for Aunt Som; the line names only what is seen;
//   F3 the flick on the finished envelope: 575 px/s, a near miss is shown, never a fifth fold;
//   F4 margarine: a puddle on bare steel, a stroke from the block is never a fold, 3 strokes — crunch
//      (also right after the folds, on both screens); a raw roti refused by Som goes back on the tava;
//   F5 the look: the browning rim, the burnt colour, the open sheet turning matte, smoothed patches.
// Pure Node/vm with the mocks of model-regression.cjs, as guest-regression.cjs: stand.js, banana.js,
// egg.js, evening.js and guest.js in ONE context; every action of the player goes through the stand's
// real window touch handlers. This is not a browser: how it LOOKS is checked live, by screenshots.
//   node prototype/dough-closeup/checks/frying-regression.cjs path/to/stand.js [--only F1,F3]
// ALWAYS pass the stand.js of the checkout under test as the first argument. Report:
// runs/checks/frying-results.json of the checkout (runs/ is not in git).
// The helpers below are the ones of guest-regression.cjs (kept in step by hand).
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
// script shortcuts for the colour of the roti: every side set to c / the side on the steel and the side
// seen from above set apart (dry is set to 1: colour without dryness does not exist in the model)
const cookAll = (h, c) => h.run(`for(const t of dish.thermal) if(t){t.dry[0]=t.dry[1]=1;t.cook[0]=t.cook[1]=${c};}`);
const cookSides = (h, bottom, top) => h.run(`for(let i=0;i<dish.thermal.length;i++){const t=dish.thermal[i];if(!t)continue;t.dry[0]=t.dry[1]=1;
  for(let s=0;s<2;s++){ if(dish.contactWeights[i][s]) t.cook[s]=${bottom}; else if(dish.topWeights[i][s]) t.cook[s]=${top}; }}`);
// a real flick from the edge of the envelope outward: v CSS px/s, 60 Hz, released on the move
function flick(h, v = 700) {
  const e = h.J(`(()=>{const b=dishBounds();return [__harness.dishToClient({x:b.right-0.02,y:(b.top+b.bottom)/2}),__harness.dishToClient({x:b.right+0.5,y:(b.top+b.bottom)/2})]})()`);
  const a = e[0], dir = Math.sign(e[1].x - a.x) || 1, pts = [{ x: a.x, y: a.y, t: 0 }];
  for (let i = 1; i <= 9; i++) pts.push({ x: a.x + dir * v * i / 60, y: a.y, t: 120 + i * 1000 / 60 });
  pts.push({ ...pts.at(-1), t: pts.at(-1).t + 1 });
  drive(h, pts, { settle: 50 });
}
const nextBall = h => { tap(h, h.spots().bowl); assert.equal(h.eve().ball, true, 'a ball is taken from the bowl'); };
const FRESH = { v: 1, here: false, gone: false, knocked: false, answers: [], gifts: [], taken: 0 };


const J = (h, code) => h.J(code);
const live = h => h.run('dish.message');
const panRows = h => h.J('gestures.filter(g=>g.kind==="pan").map(g=>g.outcome)');
const lastPan = h => h.J('(g=>({outcome:g.outcome,speed:g.speed,folds:g.folds,flips:g.flips}))(gestures.filter(g=>g.kind==="pan").at(-1))');
// a stroke from the edge of the dish: side 'right' | 'left' | 'top' | 'bottom'; dir 'out' | 'in'; v CSS px/s; released on the move
function edgeStroke(h, { side = 'right', dir = 'out', v = 700, n = 9, to = null } = {}) {
  const e = h.J(`(()=>{const b=dishBounds(),cx=(b.left+b.right)/2,cy=(b.top+b.bottom)/2;
    const S={right:[b.right,cy,1,0],left:[b.left,cy,-1,0],top:[cx,b.top,0,-1],bottom:[cx,b.bottom,0,1]}['${side}'];
    return [__harness.dishToClient({x:S[0]-S[2]*0.02,y:S[1]-S[3]*0.02}),__harness.dishToClient({x:S[0]+S[2]*0.5,y:S[1]+S[3]*0.5}),__harness.dishToClient({x:cx,y:cy})]})()`);
  const a = e[0], q = to || (dir === 'out' ? e[1] : e[2]), L = Math.hypot(q.x - a.x, q.y - a.y), ux = (q.x - a.x) / L, uy = (q.y - a.y) / L;
  const pts = [{ x: a.x, y: a.y, t: 0 }];
  const steps = to ? Math.ceil(L / (v / 60)) : n;
  for (let i = 1; i <= steps; i++) pts.push({ x: a.x + ux * v * i / 60, y: a.y + uy * v * i / 60, t: 120 + i * 1000 / 60 });
  pts.push({ ...pts.at(-1), t: pts.at(-1).t + 1 });
  drive(h, pts, { settle: 0 });
}
// margarine: one touch from the block, then along the points (client px)
function smear(h, pts, { settle = 0 } = {}) {
  const B = h.J('(()=>{const b=butterSpot();return __harness.toClient(b.x,b.y)})()');
  const out = [{ x: B.x, y: B.y, t: 0 }]; let t = 100, prev = B;
  for (const q of pts) { const n = Math.ceil(Math.hypot(q.x - prev.x, q.y - prev.y) / 7); for (let i = 1; i <= n; i++) { t += 1000 / 60; out.push({ x: prev.x + (q.x - prev.x) * i / n, y: prev.y + (q.y - prev.y) * i / n, t }); } prev = q; }
  out.push({ ...out.at(-1), t: t + 20 }); drive(h, out, { settle });
}
const corners = (h, k = 1.12) => h.J(`(()=>{const b=dishBounds(),cx=(b.left+b.right)/2,cy=(b.top+b.bottom)/2,hw=(b.right-b.left)/2*${k},hh=(b.bottom-b.top)/2*${k};
  return [[1,-1],[-1,-1],[-1,1],[1,1]].map(([sx,sy])=>__harness.dishToClient({x:cx+sx*hw,y:cy+sy*hh}))})()`);
const wet = (h, min) => h.run(`fatMap?Array.from(fatMap).filter(v=>v>${min}).length:0`);
const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
// Build 85b: the tap lays the real heap (12 slices) — the filling's effect on frying is capped at ~3 slices
// (FILL_FRY_SLICES in stand.js), so the model times hold with it. `egg` adds the second tap (the egg over the heap).
function fried(h, { banana = true, egg = false } = {}) { light(h); onPan(h); if (banana) tap(h, h.spots().pan); if (egg) tap(h, h.spots().pan); envelope(h); }

test('F1', 'times by the model: the steel side is «приготовленное» in ~20 s and «горелое» in ~60 s; without a flip the top of a quickly folded envelope stays raw; after a flick the new bottom is «бледное» within seconds', () => {
  const h = guest(); fried(h);
  const heap = h.J('(dish.filling||[]).map(f=>f.kind||"banana")').join(',');
  assert.ok(/banana/.test(heap), `the tap laid the heap (${heap})`);
  const folded = h.run('dish.panTime'), at = {};
  for (const [s, name] of [[1, 'pale'], [2, 'cooked'], [3, 'fried'], [4, 'burnt']]) { until(h, `fryStep(meanCook())>=${s}`, 60 * 120); at[name] = +h.run('dish.panTime').toFixed(1); }
  assert.ok(at.cooked >= 13 && at.cooked <= 24, `«приготовленное» at 13–24 s of pan time (${at.cooked})`);
  assert.ok(at.burnt >= 45 && at.burnt <= 70, `«горелое» at 45–70 s (${at.burnt})`);
  assert.ok(at.burnt - at.cooked >= 30, 'more than half a minute between «приготовленное» and «горелое»');
  // the heap and the egg over it (two taps): the same windows — a heap must not make frying longer (build 85b)
  const e = guest(); fried(e, { egg: true });
  const fill = e.J('(dish.filling||[]).map(f=>f.kind||"banana")'), nb = fill.filter(k => k === 'banana').length, ne = fill.filter(k => k === 'egg').length;
  assert.ok(nb >= 10 && ne >= 1, `two taps: heap and egg (${nb}+${ne})`);
  const ate = {}; for (const [s, name] of [[2, 'cooked'], [4, 'burnt']]) { until(e, `fryStep(meanCook())>=${s}`, 60 * 120); ate[name] = +e.run('dish.panTime').toFixed(1); }
  assert.ok(ate.cooked >= 13 && ate.cooked <= 24, `heap+egg: «приготовленное» at 13–24 s (${ate.cooked})`);
  assert.ok(ate.burnt >= 45 && ate.burnt <= 70, `heap+egg: «горелое» at 45–70 s (${ate.burnt})`);
  const topNoFlip = h.run('dishSideMean("cook","topWeights")');
  assert.equal(h.run(`fryStep(${topNoFlip})`), 0, `never flipped: the top is still raw at ${at.burnt} s (${topNoFlip.toFixed(3)})`);
  assert.equal(h.run('guestVerdict(meanCook(),dishSideMean("cook","topWeights"),0)'), 'burnt');
  assert.ok(h.run('COOK_CAP') > h.run('FRY_STEPS[3]'), 'the colour goes on past «горелое»');
  // the flip in time
  const q = guest(); fried(q);
  until(q, 'fryStep(meanCook())>=2'); const tA = q.run('dish.panTime');
  assert.equal(q.run('guestVerdict(meanCook(),dishSideMean("cook","topWeights"),0)'), 'nod', 'one side done, the other raw: a nod');
  edgeStroke(q, { v: 700 }); q.frames(40); assert.equal(q.run('dish.flips'), 1);
  const t0 = q.run('dish.panTime'); until(q, 'fryStep(meanCook())>=1'); const tB = q.run('dish.panTime') - t0;
  assert.ok(tB <= 10, `the new bottom is «бледное» ${tB.toFixed(1)} s after the flip`);
  assert.equal(q.run('guestVerdict(meanCook(),dishSideMean("cook","topWeights"),0)'), 'nod', 'second side «бледное»: still a nod…');
  assert.equal(q.run('guestVerdict(meanCook(),dishSideMean("cook","topWeights"),5)'), 'crunch', '…a crunch with margarine under the edge');
  until(q, 'fryStep(meanCook())>=2'); const tB2 = q.run('dish.panTime') - t0;
  assert.ok(tB2 <= 22, `the second side is «приготовленное» ${tB2.toFixed(1)} s after the flip`);
  assert.equal(q.run('guestVerdict(meanCook(),dishSideMean("cook","topWeights"),0)'), 'crunch', 'both sides «приготовленное»: crunch');
  // the lazy path (review of the batch, 17.11): an open sheet left on the steel for 25 s and folded only then.
  // It used to fry from below, the folds brought the fried underside up, and «wait, then fold» gave both sides
  // «приготовленное» with no flip — faster than the honest way. Now the open sheet stays below «бледное».
  const o = guest(); light(o); onPan(o); tap(o, o.spots().pan); sec(o, 25);
  const openCook = o.run('meanCook()'), openMax = o.run('Math.max(...dish.thermal.filter(Boolean).map(t=>Math.max(t.cook[0],t.cook[1])))');
  assert.equal(o.run(`fryStep(${openCook})`), 0, `open sheet, 25 s on the steel: still below «бледное» (${openCook.toFixed(3)})`);
  assert.ok(openMax <= o.run('OPEN_COOK_CAP') + o.run('DOME_SCORCH') + 1e-9, `no spot of it is browned past the cap (${openMax.toFixed(3)})`);
  assert.ok(o.run('OPEN_COOK_CAP') < o.run('FRY_STEPS[0]'));
  envelope(o); const lazyT = o.run('dish.panTime'), lazy = o.J('guestSides()');
  assert.equal(o.run(`fryStep(${lazy.top})`), 0, `folded late: the top is raw (${lazy.top.toFixed(3)}), not the fried underside`);
  assert.notEqual(o.run(`guestVerdict(${lazy.bottom},${lazy.top},0)`), 'crunch', 'no crunch right after the late folds');
  until(o, 'fryStep(meanCook())>=3', 60 * 120);
  assert.equal(o.run('fryStep(dishSideMean("cook","topWeights"))'), 0, 'and never without a flip: the bottom is «зажаренное», the top still raw');
  assert.equal(o.run('guestVerdict(meanCook(),dishSideMean("cook","topWeights"),9)'), 'nod', 'margarine does not replace the flip either');
  assert.equal(o.run('fryHint()').startsWith('поджарилось'), false);
  // undoing a fold of a browned envelope does not wipe its colour
  const u = guest(); fried(u); until(u, 'fryStep(meanCook())>=2'); const before = u.run('meanCook()');
  u.run('undoDish()'); u.frames(30); assert.equal(u.run('envelopeDone()'), false);
  assert.ok(u.run('Math.max(...dish.thermal.filter(Boolean).map(t=>Math.max(t.cook[0],t.cook[1])))') >= before, 'the cap stops the browning, it does not lower it');
  h.tick(2, 1 / 60, true); q.tick(2, 1 / 60, true); o.tick(2, 1 / 60, true); assert.equal(h.run('loopErrs') + q.run('loopErrs') + o.run('loopErrs'), 0);
  return { summary: `heap ${heap.split(',').length} slices; folded at ${folded.toFixed(1)} s; steel side: бледное ${at.pale} s, приготовленное ${at.cooked} s, зажаренное ${at.fried} s, горелое ${at.burnt} s of pan time; flip at ${tA.toFixed(1)} s → new bottom бледное +${tB.toFixed(1)} s (crunch with margarine at ${(tA + tB).toFixed(1)} s), приготовленное +${tB2.toFixed(1)} s (crunch at ${(tA + tB2).toFixed(1)} s); open sheet 25 s → colour ${openCook.toFixed(3)} (cap ${o.run('OPEN_COOK_CAP')}); folded at ${lazyT.toFixed(1)} s: bottom ${lazy.bottom.toFixed(3)}, top ${lazy.top.toFixed(3)}, no crunch without a flip; heap ${nb} + egg ${ne}: приготовленное ${ate.cooked} s, горелое ${ate.burnt} s (filling factor ${e.run('fillFryK()').toFixed(3)})` };
});

test('F2', 'one ladder and plain words: the line says nothing about frying until the envelope is done, never «можно начинку» or «→ сырое»; silent when the steel side is done (build 88: the lifted corner shows it); what it calls ready is a crunch for Som', () => {
  const h = guest(); light(h); onPan(h);
  const seen = new Set(), note = () => { const m = live(h); if (m) seen.add(m); };
  for (let i = 0; i < 60; i++) { h.frames(1); note(); }
  assert.equal(h.run('fryHint()'), null, 'open sheet: no frying words');
  tap(h, h.spots().pan); envelope(h);
  assert.equal(h.run('envelopeDone()'), true);
  h.frames(160); note();
  // changed after the review of 17.11: the line used to say «мах от края — перевернуть» from the first second,
  // calling to flip a roti raw on both sides. Now it is silent until the rim is browned.
  assert.equal(h.run('fryHint()'), '', 'both sides raw: nothing to do with the hands, the line is silent');
  assert.equal(live(h), '');
  until(h, 'fryStep(meanCook())>=2'); h.frames(2); note();
  // Build 88 (visible gesture): «край румяный — мах от края» is gone — touching the edge lifts the corner and shows the browned underside.
  assert.equal(live(h), '', 'the steel side is done: the line stays silent, the object shows it');
  edgeStroke(h, { v: 700 }); for (let i = 0; i < 40; i++) { h.frames(1); note(); }
  assert.equal(h.run('learned.flip'), 1, 'the flick is learned (build 80: learned.flip, was flipLearned)');
  let ready = null, n = 0;
  while (n++ < 60 * 40) { h.frames(1); note(); if (live(h).startsWith('поджарилось')) { ready = h.J('guestSides()'); break; } }
  assert.ok(ready, 'the line says it is ready');
  assert.equal(h.run(`guestVerdict(${ready.bottom},${ready.top},0)`), 'crunch', 'ready by the line = crunch for Som (the same thresholds)');
  assert.ok(ready.bottom >= h.run('FRY_STEPS[1]') && ready.bottom < h.run('FRY_STEPS[1]') + 0.02, 'said the moment the second side is «приготовленное»');
  assert.equal(h.run('fryVerdict(0.3,0.1,5)'), 'crunch'); assert.equal(h.run('fryVerdict(0.3,0.1,4.9)'), 'nod'); assert.equal(h.run('fryVerdict(0.3,0.05,9)'), 'nod');
  until(h, 'fryStep(meanCook())>=4', 60 * 120); h.frames(2); note();
  assert.equal(live(h), 'край чёрный — горит');
  assert.ok(lum(h.J('cookColor([227,213,178],FRY_STEPS[3])')) < 60, 'and at «горелое» the colour IS black, not dark brown');
  const all = [...seen];
  for (const m of all) assert.ok(!/можно начинку|→|сырое|подсыхает|дальше темнеть/.test(m), `no old frying words: ${m}`);
  for (const m of all) assert.ok(m !== 'мах от края — перевернуть', 'no call to flip a raw roti');
  for (const m of all.filter(m => /край|поджарилось/.test(m))) assert.ok(m.length <= 36, `one short line (36 characters fit one line at 375 px with the guest): ${m} (${m.length})`);
  // the ladder is one
  assert.deepEqual(h.J('[0,0.079,0.08,0.279,0.28,0.549,0.55,1.099,1.1,1.4].map(c=>cookWord(c)+"/"+guestStepOf(c))'),
    ['сырое/0', 'сырое/0', 'бледное/1', 'бледное/1', 'приготовленное/2', 'приготовленное/2', 'зажаренное/3', 'зажаренное/3', 'горелое/4', 'горелое/4']);
  // a new evening teaches the flick again
  h.run('eveNewEvening("check")'); h.frames(2); assert.deepEqual(h.J('learned'), {}, 'a new evening: every hint is back');
  for (const m of all) assert.ok(m.length <= h.run('LINE_MAX'), `one short line, at most ${h.run('LINE_MAX')} characters (build 80): ${m} (${m.length})`);
  return { summary: `lines seen: ${all.filter(m => !/завёрнуто|две другие/.test(m)).join(' | ')}` };
});

test('F3', 'the flick on the finished envelope: 700 px/s turns it (850 on an open sheet as before); 450 px/s — the edge lifts and drops back, nothing changes; a fast inward stroke turns, never folds; folds stay 4; no «на стол» advice after a failed flick', () => {
  // open sheet: the old threshold
  const o = guest(); light(o); onPan(o);
  edgeStroke(o, { v: 700 }); o.frames(40); assert.equal(o.run('dish.flips'), 0, 'open sheet, 700 px/s outward: no flip (threshold 850)');
  edgeStroke(o, { v: 1000 }); o.frames(40); assert.equal(o.run('dish.flips'), 1, 'open sheet, 1000 px/s: flip');
  const out = [];
  const h = guest(); fried(h);
  // near miss
  const faces = 'dish.faces';
  h.run('globalThis.__f0=dish.faces');
  edgeStroke(h, { v: 450 });
  let r = lastPan(h);
  assert.equal(r.outcome, 'flip-almost', `450 px/s (measured ${r.speed}): «almost»`);
  assert.equal(h.run('!!dishFlight&&dishFlight.almost'), true, 'the edge is in the air');
  h.tick(2, 1 / 60, true);
  assert.notEqual(live(h), 'на стол — бери за середину');
  h.frames(30);
  assert.equal(h.run('dishFlight'), null, 'and drops back'); assert.equal(h.run('dish.flips'), 0); assert.equal(h.run('dish.faces===__f0'), true, 'the material did not change');
  out.push(`450→${r.outcome} (${r.speed} px/s)`);
  // a failed fast flick that ends over the table: no «на стол»
  const w = h.spots().work;
  edgeStroke(h, { side: 'bottom', v: 450, to: { x: w.x, y: w.y } });
  r = lastPan(h); h.frames(30);
  assert.ok(r.outcome === 'flip-almost' || r.outcome === 'none'); assert.equal(h.run('dish.flips'), 0);
  assert.notEqual(live(h), 'на стол — бери за середину', 'no «на стол» advice right after a failed flick');
  // a slow drag from the edge to the table still gets the advice
  edgeStroke(h, { side: 'bottom', v: 150, to: { x: w.x, y: w.y } }); h.frames(2);
  assert.equal(live(h), 'на стол — бери за середину', 'a slow drag from the edge to the table: the advice');
  assert.equal(h.run('dish.folds'), 4);
  // inward strokes on the finished envelope: slow — nothing, fast — a flip; never a fold
  edgeStroke(h, { dir: 'in', v: 170, n: 14 }); h.frames(40);
  assert.equal(h.run('dish.folds'), 4, 'a slow inward stroke is not a fifth fold'); assert.equal(h.run('dish.flips'), 0);
  for (const v of [500, 560]) { edgeStroke(h, { dir: 'in', v, n: 7 }); h.frames(40); assert.equal(h.run('dish.folds'), 4, `inward ${v} px/s: no fold`); assert.equal(h.run('dish.flips'), 0); }
  edgeStroke(h, { dir: 'in', v: 726, n: 7 }); h.frames(40);
  r = lastPan(h);
  assert.equal(r.outcome, 'flip', 'a fast inward stroke (726 px/s, the playtest case) turns the envelope'); assert.equal(h.run('dish.folds'), 4); assert.equal(h.run('dish.flips'), 1);
  // threshold: 600 turns, 540 does not
  edgeStroke(h, { v: 540 }); h.frames(40); assert.equal(h.run('dish.flips'), 1, '540 px/s: not yet');
  edgeStroke(h, { v: 610 }); h.frames(40); assert.equal(h.run('dish.flips'), 2, '610 px/s: a flip');
  out.push('540 no / 610 yes; inward 726 → flip');
  assert.equal(h.run('FLICK_ENV_CSS'), 575); assert.equal(h.run('FLICK_MIN_CSS'), 850);
  // the cap on free folds
  assert.equal(h.run('foldCapped({side:-1,anchor:{x:0,y:0},target:{x:0,y:0}})'), null, 'no free fold when there are four');
  assert.equal(h.run('foldCapped({side:2})').side, 2, 'a snapped side is always allowed');
  assert.ok(!panRows(h).slice(4).includes('fold'), 'no fold after the four sides');
  h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  return { summary: out.join(' · ') };
});

test('F4', 'margarine: a stroke from the block over bare steel leaves a puddle that spreads and is gone in seconds; the block shrinks; a stroke from the block is never a fold; three strokes along the edge of the envelope — crunch; a stroke far from the roti gives almost nothing', () => {
  const out = [];
  // bare steel: the ball is still on the table / the table is free
  for (const free of [false, true]) {
    const h = guest(); light(h);
    if (free) { stretched(h); toPan(h); finish(h); serve(h); assert.equal(h.eve().ball, false, 'the table is free'); h.frames(600); }
    assert.equal(h.run('!!fatMap'), false);
    const P = h.spots().pan, R = h.spots().panR, b0 = h.run('butterLeft');
    smear(h, [{ x: P.x + R * 0.1, y: P.y - R * 0.1 }, { x: P.x - R * 0.5, y: P.y + R * 0.05 }]);
    assert.equal(h.run('!!fatMap'), true, 'a puddle on bare steel'); assert.equal(h.run('!!dish'), false);
    const w0 = wet(h, 0.02), peak0 = h.run('Math.max(...fatMap)');
    h.frames(45); const w1 = wet(h, 0.02);
    assert.ok(w1 > w0, `it spreads: ${w0} → ${w1} cells in 0.75 s`);
    h.tick(2, 1 / 60, true);
    let n = 0; while (h.run('!!fatMap') && n < 60 * 20) { h.frames(1); n++; }
    const gone = (n + 45) / 60;
    assert.ok(gone >= 2 && gone <= 12, `gone in 2–12 s (${gone.toFixed(1)} s)`);
    assert.ok(h.run('butterLeft') < b0, 'the block got smaller');
    assert.equal(h.run('loopErrs'), 0);
    out.push(`${free ? 'free table' : 'ball on the table'}: ${w0}→${w1} cells, gone in ${gone.toFixed(1)} s, block ${h.run('butterLeft').toFixed(2)}`);
  }
  // a stroke from the block is never a fold, even with the sheet under the finger
  {
    const h = guest(); light(h); onPan(h);
    h.run('globalThis.__om=onMaterial; onMaterial=()=>true;');   // script: as if the edge of the sheet lay on the block
    const c = h.J('__harness.dishToClient({x:0,y:0})');
    smear(h, [c]); h.frames(20);
    h.run('onMaterial=__om;');
    assert.equal(h.run('dish.folds'), 0, 'a stroke from the block to the middle of the sheet folds nothing'); assert.equal(h.run('dish.flips'), 0);
    assert.ok(!panRows(h).includes('fold'));
    const E = h.J('(()=>{const b=dishBounds();return __harness.dishToClient({x:b.right-0.02,y:(b.top+b.bottom)/2})})()');
    smear(h, [E, c]); h.frames(20); assert.equal(h.run('dish.folds'), 0);
  }
  // crunch by the hands
  // Changed after the review of 17.11. The old case waited for meanDry()>0.9 and 200 frames after every stroke
  // and got 8.42; live, three strokes right after quick folds gave 2.72–3.97 < 5. Now the crisp is counted by
  // the share of the edge that fizzes (edgeFat — what the player sees), dryness does not cut it, and the case
  // below is the hard one: three strokes RIGHT after the folds, 2 s and 0.4 s apart, near and far from the
  // edge, on both screens, the sheet still wet (script: dry set low, as after folds in 6 s).
  for (const [w, hh] of [[390, 844], [375, 667]]) for (const [k, pause] of [[1.12, 2], [1.3, 2], [1.02, 2], [1.12, 0.4]]) {
    const e = guest({ w, hh }); fried(e);
    e.run('for(const t of dish.thermal) if(t){t.dry[0]=Math.min(t.dry[0],0.5);t.dry[1]=Math.min(t.dry[1],0.5);}');
    const C = corners(e, k), got = [];
    for (const seg of [[C[0], C[1]], [C[0], C[3]], [C[3], C[2]]]) {
      smear(e, seg); if (!got.length) assert.ok(e.run('fatUnder') > 0.15, `the edge fizzes at once (${e.run('fatUnder').toFixed(2)} of it)`);
      e.frames(Math.round(pause * 60)); got.push(+e.run('dishCrisp').toFixed(2));
    }
    e.frames(240); got.push(+e.run('dishCrisp').toFixed(2));
    assert.ok(got[0] < e.run('FRY_CRISP'), `${w}px k=${k}: one stroke is not the crunch (${got[0]})`);
    assert.ok(got[3] >= e.run('FRY_CRISP'), `${w}px k=${k} pause ${pause}s: three early strokes reach the crunch (${got.join(' → ')})`);
    assert.equal(e.run('dish.folds'), 4); assert.equal(e.run('loopErrs'), 0);
    out.push(`${w}/${k}/${pause}s: ${got.join('→')}`);
  }
  const h = guest(); fried(h);
  const K = corners(h, 1.12);
  const far = h.J('(()=>{const b=butterSpot();return [__harness.toClient(panC.x-(b.x-panC.x)*0.9,panC.y-(b.y-panC.y)*0.9)]})()');
  const b0 = h.run('butterLeft');
  const crisp = []; let prev = 0;
  for (const seg of [[K[0], K[1]], [K[0], K[3]], [K[3], K[2]]]) {
    smear(h, seg); h.tick(2, 1 / 60, true); h.frames(200);
    assert.ok(Math.abs(h.run('crispSheen()') - Math.min(1, h.run('dishCrisp') / h.run('FRY_CRISP'))) < 1e-9, 'the sheen of the edge shows the crisp gathered so far');
    const c = h.run('dishCrisp'); crisp.push(+(c - prev).toFixed(2)); prev = c;
    assert.equal(h.run('dish.folds'), 4, 'a stroke along the edge never folds');
  }
  assert.ok(crisp[0] < 5, `one stroke is not enough (${crisp[0]})`);
  assert.ok(prev >= 5, `three strokes along the edge reach the crunch (${prev.toFixed(2)})`);
  assert.equal(h.run('crispWord(+dishCrisp.toFixed(1))'), 'сильно хрустит');
  // her knock has an answer the hands can do: margarine + a flip, without waiting for the second side to fry through
  until(h, 'fryStep(meanCook())>=2'); assert.equal(h.run('guestVerdict(meanCook(),dishSideMean("cook","topWeights"),+dishCrisp.toFixed(1))'), 'nod', 'not flipped yet: the top is raw');
  edgeStroke(h, { v: 700 }); h.frames(40); assert.equal(h.run('dish.flips'), 1);
  const tf = h.run('dish.panTime'); until(h, 'fryStep(meanCook())>=1');
  assert.equal(h.run('guestVerdict(meanCook(),dishSideMean("cook","topWeights"),+dishCrisp.toFixed(1))'), 'crunch', 'flipped, the second side «бледное», crisp 5: crunch');
  assert.equal(live(h).startsWith('поджарилось') || (h.frames(200), live(h).startsWith('поджарилось')), true, 'and the line says so');
  out.push(`margarine + flip: crunch ${(h.run('dish.panTime') - tf).toFixed(1)} s after the flip, pan time ${h.run('dish.panTime').toFixed(1)} s`);
  assert.ok(h.run('butterLeft') < b0 - 0.05 && h.run('butterLeft') >= h.run('BUTTER_MIN'), 'the block shrinks, but never to nothing');
  // far from the roti
  const q = guest(); fried(q);
  const P = q.spots().pan, R = q.spots().panR, B = q.J('(()=>{const b=butterSpot();return __harness.toClient(b.x,b.y)})()');
  smear(q, [{ x: B.x - R * 0.25, y: B.y + R * 0.02 }]); q.frames(300);
  assert.ok(q.run('dishCrisp') < 1, `a dab at the rim, far from the roti: crisp ${q.run('dishCrisp').toFixed(2)}`);
  for (let i = 0; i < 400 && q.run('butterLeft') > q.run('BUTTER_MIN'); i++) smear(q, [{ x: B.x - R * 0.25, y: B.y + R * 0.02 }]);
  assert.equal(q.run('butterLeft'), q.run('BUTTER_MIN'), 'the block stops at its smallest');
  q.run('eveNewEvening("check")'); q.frames(2); assert.equal(q.run('butterLeft'), 1, 'a new evening — a new block');
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  out.push(`strokes along the edge: +${crisp.join(' +')} = ${prev.toFixed(2)}; block ${h.run('butterLeft').toFixed(2)}`);
  return { summary: out.join(' · ') };
});

test('F5', 'the look, as numbers: the rim of the top takes the colour of the steel side and creeps inward; no rim once the top is the darker side; burnt is darker than fried; the open sheet turns matte in 2–3 s; patches over the filling are smoothed for the eye, not in the cut', () => {
  const h = guest(); fried(h);
  const probe = `(()=>{const L=dishLook();let edge=null,mid=null;
    for(const f of dish.faces){ if(f.kind!=="dough"||!dish.topWeights[f.source][f.turned?0:1]) continue; const R=rimDist(f,dish.hull);
      const c=dishCookColor(f),l=0.299*c[0]+0.587*c[1]+0.114*c[2];
      if(!edge||R.d<edge.d) edge={d:R.d,c}; if(!mid||l>mid.l) mid={l,c}; }
    return {rim:L.rim,rimW:L.rimW,bot:L.bot,top:L.top,edge:edge.c,mid:mid.c}})()`;
  const p0 = h.J(probe);
  until(h, 'fryStep(meanCook())>=1'); const p1 = h.J(probe);
  until(h, 'fryStep(meanCook())>=2'); const p2 = h.J(probe);
  until(h, 'fryStep(meanCook())>=3'); const p3 = h.J(probe);
  until(h, 'fryStep(meanCook())>=4', 60 * 120); const p4 = h.J(probe);
  assert.equal(p2.rim, true, 'the rim is on while the steel side is darker than the top');
  assert.ok(p1.rimW < p2.rimW && p2.rimW < p3.rimW, `the rim creeps inward: ${[p1, p2, p3].map(p => p.rimW.toFixed(3)).join(' → ')}`);
  const L = [p0, p1, p2, p3, p4].map(p => lum(p.edge));
  assert.ok(L[1] <= L[0], 'at «бледное» the edge is barely tinted');
  for (let i = 2; i < L.length; i++) assert.ok(L[i] < L[i - 1] - 8, `from «приготовленное» on the edge darkens with every step: ${L.map(v => v.toFixed(0)).join(' → ')}`);
  assert.ok(lum(p2.mid) > lum(p2.edge) + 20, 'inside the rim the top stays pale: it is the rim that tells');
  assert.ok(lum(p4.edge) < 95, `burnt reads dark (${lum(p4.edge).toFixed(0)})`);
  assert.ok(p2.edge[0] - p2.edge[2] > p0.edge[0] - p0.edge[2] + 40, 'and warm: gold, not grey');
  // after a flip the top is the browned side itself: no rim
  const q = guest(); fried(q); until(q, 'fryStep(meanCook())>=2');
  q.run('startFlip({x:1,y:0},{x:0,y:0})'); q.frames(40);
  assert.equal(q.run('dishLook().rim'), false, 'flipped: what is seen is the fried side, no rim');
  // smoothed patches over the filling on the seen side; the cut keeps the true layers.
  // Build 85b: measured on the faces paler than the side's mean (that is what PATCH_SMOOTH pulls; the darker contact
  // spots are not touched by design). With the heap capped at ~3 slices those patches are mild and the side's spread
  // is mostly the dark contact spots, so the whole-side sd no longer tells the smoothing apart (printed for the record).
  const sd = `(()=>{const L=dishLook(),a=[],b=[],A=[],B=[];for(const f of dish.faces){ if(f.kind!=="dough"||!dish.topWeights[f.source][f.turned?0:1]) continue;
      const t=dish.thermal[f.source]; if(!t) continue; const v=t.cook[f.turned?0:1]*(0.55+0.8*(t.contact||1));
      const c=dishCookColor(f),o=dishCookColor(f,undefined,false),lc=0.299*c[0]+0.587*c[1]+0.114*c[2],lo=0.299*o[0]+0.587*o[1]+0.114*o[2];
      A.push(lc); B.push(lo); if(v<L.top){ a.push(lc); b.push(lo); } }
    const sd=v=>{const m=v.reduce((s,x)=>s+x,0)/v.length;return Math.sqrt(v.reduce((s,x)=>s+(x-m)*(x-m),0)/v.length)};
    return {seen:sd(a),own:sd(b),n:a.length,all:A.length,seenAll:sd(A),ownAll:sd(B)}})()`;
  const s = q.J(sd);
  assert.ok(s.n >= 20, `there are pale patches over the filling (${s.n} faces of ${s.all})`);
  assert.ok(s.seen < s.own * 0.8, `the pale patches are evener for the eye than the raw numbers (sd ${s.seen.toFixed(1)} vs ${s.own.toFixed(1)})`);
  // the colour scale
  // changed after the review of 17.11: the scale reaches black at «горелое» (1.12; it used to creep there by 1.3,
  // and «край чёрный — горит» stood over a dark brown rim), then stays black
  const scale = h.J('[0,0.2,0.4,0.6,0.8,1.0,1.06,1.12].map(c=>cookColor([227,213,178],c))').map(lum);
  for (let i = 1; i < scale.length; i++) assert.ok(scale[i] < scale[i - 1], 'darker with every step of colour, past «зажаренное» too');
  assert.equal(lum(h.J('cookColor([227,213,178],1.4)')), scale.at(-1), 'black stays black');
  // the open sheet: translucent → matte
  const o = guest(); light(o); onPan(o);
  const set = () => o.run('(()=>{let s=0,n=0;for(const f of dish.faces) if(f.kind==="dough"){s+=doughSet(f);n++;} return s/n})()');
  const s0 = set(); assert.ok(s0 < 0.85, `just laid (1.5 s of settling in the script): still translucent (${s0.toFixed(2)})`); assert.ok(o.run("SET_RAW") < 0.65);
  let n = 0; while (set() < 0.97 && n < 600) { o.frames(1); n++; }
  const matte = o.run('dish.panTime');
  assert.ok(matte >= 1.2 && matte <= 4, `matte ${matte.toFixed(1)} s after landing`);
  o.tick(2, 1 / 60, true); h.tick(2, 1 / 60, true); q.tick(2, 1 / 60, true);
  assert.equal(o.run('loopErrs') + h.run('loopErrs') + q.run('loopErrs'), 0);
  return { summary: `rim width ${[p1, p2, p3].map(p => p.rimW.toFixed(2)).join(' → ')} of the roti; edge luminance by step ${L.map(v => v.toFixed(0)).join(' → ')}, middle at «приготовленное» ${lum(p2.mid).toFixed(0)}; pale patches (${s.n} of ${s.all} faces) sd ${s.seen.toFixed(1)} vs ${s.own.toFixed(1)}, whole seen side ${s.seenAll.toFixed(1)} vs ${s.ownAll.toFixed(1)}; matte in ${matte.toFixed(1)} s (from ${s0.toFixed(2)})` };
});

test('F6', 'the refusal is not a dead end: a raw cut roti refused by Som is carried back to the middle of the tava and fries on (the cuts are undone, colour and crisp stay); dropped at the rim of the tava it stays on the table; fried through and flipped, she takes it', () => {
  const out = [];
  for (const [w, hh] of [[390, 844], [375, 667]]) {
    const h = guest({ w, hh }); light(h); onPan(h); arrive(h); envelope(h);
    cookAll(h, 0.05);   // script: the sides read raw
    h.run('dishCrisp=1.5');
    toTable(h); cut(h);
    const before = h.eve().rotiDone;
    serve(h, h.gs().som);
    assert.equal(lastPan(h).outcome, 'serve-refused'); assert.equal(live(h), 'сырое — верни на таву'); assert.equal(h.run('dish.mode'), 'cut');
    const P = h.spots().pan, R = h.spots().panR;
    serve(h, { x: P.x - R * 0.93, y: P.y });
    assert.equal(lastPan(h).outcome, 'serve-back', 'released at the rim of the tava: still on the table'); assert.equal(h.run('dish.mode'), 'cut');
    serve(h, P);
    assert.equal(lastPan(h).outcome, 'pan-back'); assert.equal(h.run('dish.mode'), 'fold'); assert.equal(h.run('phase'), 'PAN');
    assert.equal(h.run('dish.cuts.length'), 0, 'whole again'); assert.equal(h.run('dish.folds'), 4); assert.equal(h.run('envelopeDone()'), true);
    assert.equal(h.eve().rotiDone, before, 'the evening did not count it'); assert.equal(h.eve().ball, true);
    assert.equal(h.run('dishCrisp'), 1.5, 'the crisp stays with the roti');
    assert.notEqual(live(h), 'снова на таве', 'build 88: no «снова на таве» line — the roti is visibly on the tava');
    const t0 = h.run('dish.panTime');
    until(h, 'fryStep(meanCook())>=2'); const side = h.run('dish.panTime') - t0;
    edgeStroke(h, { v: 700 }); h.frames(40); assert.equal(h.run('dish.flips'), 1);
    until(h, 'fryVerdict(meanCook(),dishSideMean("cook","topWeights"),0)==="crunch"');
    toTable(h); cut(h); serve(h, h.gs().som);
    assert.equal(h.g().taken, 1, 'now she takes it'); assert.equal(h.g().answers.at(-1).answer, 'crunch'); assert.equal(h.eve().rotiDone, before + 1);
    h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
    out.push(`${w}px: back on the tava, «приготовленное» +${side.toFixed(1)} s, then crunch`);
  }
  return { summary: out.join(' · ') };
});

const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\nfrying: ${passed}/${results.length} passed`);
try {
  const dir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'frying-results.json'), JSON.stringify({ source: H.sourcePath, sha256: H.sourceSha256, passed, total: results.length, results }, null, 2));
} catch (e) { console.log('report not written: ' + e.message); }
process.exit(passed === results.length ? 0 : 1);
