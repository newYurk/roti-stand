#!/usr/bin/env node
'use strict';
// v0 step 2 — Aunt Som, the first guest (docs/v0-step2-aunt-som.md): she comes while the first roti
// fries, knocks on the tava, knocks again on every new frying step, takes the roti released over her
// picture and answers honestly by the ladder she knocks by (the stand's fryStep) and by BOTH sides of
// the roti (build 78, the stand's fryVerdict): both sides at least «приготовленное» — crunch; the same if
// one is «приготовленное», the other at least «бледное» and the stand's crisp dishCrisp >= 5 (margarine
// under the edge stands for frying the second side through); both sides raw — she shakes her head
// and does not take it; a burnt side — a nod, no jam; otherwise a nod; leaves
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
// Changed with the review fixes of the frying batch (17.11): an open sheet no longer browns (OPEN_COOK_CAP, below
// «бледное» — see frying-regression F1), so «the sheet lay open while she came, then fold and serve» is a RAW roti
// now and she refuses it. Where a test only needs a roti she takes, the folded envelope fries on until its steel
// side is «бледное» (model time, a few seconds) — the answer for such a roti is a nod, as before.
const PALE = 'fryStep(meanCook())>=1';
function finish(h, crisp) { if (!h.run('envelopeDone()')) envelope(h); if (!h.run(PALE)) until(h, PALE); toTable(h); cut(h); if (crisp !== undefined) h.run(`dishCrisp=${crisp}`); }
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

test('G2', 'a knock on every new frying step (hint, 0.8 s); no hint twice for one step; between the steps only the repeat of build 80 («again»)', () => {
  // the sheet lies open while she comes (it does not brown: OPEN_COOK_CAP), then it is folded — the steps start there
  const h = guest(); light(h); onPan(h); arrive(h); assert.equal(h.run('guestCookStep()'), 0, 'open sheet: no step, no knock'); envelope(h);
  assert.equal(h.run('guestCookStep()'), 0, 'just folded: still below «бледное»');
  h.run('COOK_RATE=FRY_RATES[40]');   // script shortcut: the fast frying preset of the stand panel, to pass the steps sooner
  const seen = [], lasts = []; let frames = 0, hintFrames = 0, last = h.gev().length;
  while (h.run('guestCookStep()') < 3 && frames < 60 * 240) {
    h.frames(1); frames++;
    const ev = h.grows();
    if (ev.length > last) { last = ev.length; const r = ev.at(-1); seen.push(`${r.event}@${r.bottom}`); hintFrames = 0; while (h.pic() === 2) { h.frames(1); frames++; hintFrames++; } lasts.push({ event: r.event, s: hintFrames / 60 }); }
  }
  sec(h, 2);
  { const ev = h.grows(); if (ev.length > last) { last = ev.length; seen.push(`${ev.at(-1).event}@${ev.at(-1).bottom}`); } }
  // Changed in build 80: an unflipped roti makes her knock again every GUEST_AGAIN_S (G9), so «again» rows now stand
  // between the hints. The hints themselves are counted as before: exactly one per step.
  assert.deepEqual(seen.filter(x => !x.startsWith('again@')), ['hint@бледное', 'hint@приготовленное', 'hint@зажаренное'], 'one hint per step');
  assert.ok(seen.every(x => /^(hint|again)@/.test(x)), `only hints and repeats: ${seen.join(' ')}`);
  // Review of build 80: the length is checked for EVERY knock by its kind (it was «0.8 or 1.2 s» of the last one, whatever it was).
  assert.ok(lasts.length >= 3);
  for (const k of lasts) assert.ok(Math.abs(k.s - (k.event === 'hint' ? 0.8 : 1.2)) < 0.05, `a hint lasts 0.8 s, a repeat 1.2 s: ${k.event} ${k.s.toFixed(2)} s`);
  { const n0 = h.gev().length; sec(h, 12); assert.ok(h.gev().slice(n0).every(e => e === 'again'), 'no more hints on the same step — only the repeat'); last = h.gev().length; }
  return { summary: `${seen.join(' → ')}; lengths ${lasts.map(k => `${k.event} ${k.s.toFixed(2)}`).join(', ')} s; ${(frames / 60).toFixed(0)} s of frying at the fast preset` };
});

test('G3', 'released over her picture — hers; lower, on the counter band — the counter; beside her — the counter', () => {
  // (a) over her
  const h = guest(); light(h); onPan(h); arrive(h); finish(h);
  // Changed in build 80: she has no words of her own — the line is the stand's, one short line that does not say
  // whom to carry to (it was «нарезано · за середину и наверх — гостье или на стойку», two lines at 375 px).
  assert.equal(h.run('typeof guestLive'), 'undefined'); assert.equal(h.run('eveningLive(dish.message)'), null, 'the stand line passes through');
  assert.equal(h.run('dish.message'), 'нарезано — за середину и неси'); assert.ok(h.run('dish.message.length<=LINE_MAX'));
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
  // (c) at her height: anywhere from the left end of the counter to the lamp is hers (the roti in hand
  // hides her picture); under the lamp it is the counter
  const b = guest(); light(b); onPan(b); arrive(b); finish(b);
  const Z = b.gs().zone, slot = b.gs().slot;
  assert.ok(Z.x0 < slot.x - 60 && Z.x1 > slot.x + slot.w + 15, 'her zone is wider than her picture');
  serve(b, { x: Z.x1 + 14, y: b.gs().som.y });
  assert.equal(b.eve().rotiDone, 1); assert.equal(b.g().taken, 0, 'under the lamp is the counter');
  const b2 = guest(); light(b2); onPan(b2); arrive(b2); finish(b2);
  serve(b2, { x: Z.x1 - 6, y: 30 });
  assert.equal(b2.g().taken, 1, 'beside her picture, above the counter: hers');
  const b3 = guest(); light(b3); onPan(b3); arrive(b3); finish(b3);
  serve(b3, { x: Z.x0 + 30, y: b3.gs().som.y });
  assert.equal(b3.g().taken, 1, 'far to the left of her picture, above the counter: hers');
  // while the cut roti is carried she is drawn over it (guestCarried), and not otherwise
  const d = guest(); light(d); onPan(d); arrive(d); finish(d);
  assert.equal(d.run('guestCarried()'), false);
  { const B = rotiBox(d), to = d.gs().som; d.touch('start', 't1', B.c.x, B.c.y); d.frames(6);
    for (let i = 1; i <= 20; i++) { d.touch('move', 't1', B.c.x + (to.x - B.c.x) * i / 20, B.c.y + (to.y - B.c.y) * i / 20); d.frames(1); }
    assert.equal(d.run('guestCarried()'), true, 'the roti is in the hand'); d.tick(2, 1 / 60, true); assert.equal(d.run('loopErrs'), 0);
    d.touch('end', 't1', to.x, to.y); d.frames(10); }
  assert.equal(d.g().taken, 1); assert.equal(d.run('guestCarried()'), false);
  // (d) she is not there yet: the same spot is the counter
  const e = guest(); light(e); stretched(e); toPan(e); envelope(e);
  const pt = e.run('dish.panTime'); toTable(e); cut(e);
  assert.equal(e.g().here, false, `the fast script folds before she comes (pan time ${pt.toFixed(1)} s)`);
  serve(e, e.gs().som); assert.equal(e.eve().rotiDone, 1); assert.equal(e.g().taken, 0);
  return { summary: `her zone x ${Math.round(G.zone.x0)}…${Math.round(G.zone.x1)}, y ≤ ${Math.round(G.zone.y1)}; counter band below to ${Math.round(h.spots().counterBottom)}` };
});

test('G4', 'the answer follows the frying ladder and BOTH sides: one side «приготовленное» and the other less → nod; flipped and both «приготовленное» → crunch and jam; flipped, the second side «бледное» and the stand crisp >= 5 → crunch too; raw → refused, no gift; burnt → nod, no jam; 2.5 s; the gift survives a reload', () => {
  const out = [];
  // the verdict as a table (numbers are the mean colour of the side on the steel, of the side seen from above, the crisp)
  for (const [b, t, crisp, v] of [[0.05, 0.05, 0, 'raw'], [0.05, 0.02, 9, 'raw'], [0.10, 0.02, 0, 'nod'], [0.30, 0.02, 0, 'nod'], [0.60, 0.07, 0, 'nod'],
    [0.30, 0.08, 0, 'nod'], [0.09, 0.30, 0, 'nod'], [0.30, 0.28, 0, 'crunch'], [0.60, 0.60, 0, 'crunch'], [0.10, 0.10, 0, 'nod'], [0.10, 0.10, 9, 'nod'],
    [0.30, 0.02, 9, 'nod'], [0.30, 0.08, 4.9, 'nod'], [0.30, 0.08, 5, 'crunch'], [0.09, 0.30, 5, 'crunch'],
    [1.10, 0.30, 0, 'burnt'], [0.30, 1.20, 9, 'burnt']]) {
    const h0 = out.h || (out.h = guest());
    assert.equal(h0.run(`guestVerdict(${b},${t},${crisp})`), v, `bottom ${b}, top ${t}, crisp ${crisp} → ${v}`);
  }
  delete out.h;
  assert.deepEqual(guest().J('[0.05,0.08,0.28,0.55,1.10].map(c=>[guestStepOf(c),fryStep(c),cookWord(c)])'),
    [[0, 0, 'сырое'], [1, 1, 'бледное'], [2, 2, 'приготовленное'], [3, 3, 'зажаренное'], [4, 4, 'горелое']], 'her ladder is the ladder of the stand');
  // fry: 'short' — taken off right after her first knock; 'done' — fried on until her hint at «приготовленное», never
  // flipped; 'flip' — the same, then flipped by a real flick (700 px/s) and fried until her hint at «приготовленное»
  // of the second side; 'flip-pale' — flipped and taken off when the second side is «бледное».
  // crisp: undefined — as fried (0 without margarine); a number — SET by script.
  for (const [fry, crisp, answer, gift, pic] of [['short', undefined, 'nod', 'bananas', 3], ['done', undefined, 'nod', 'bananas', 3], ['flip', undefined, 'crunch', 'jam', 4],
    ['flip-pale', undefined, 'nod', 'bananas', 3], ['flip-pale', 4.94, 'nod', 'bananas', 3], ['flip-pale', 4.95, 'crunch', 'jam', 4], ['done', 9, 'nod', 'bananas', 3]]) {
    // 'done' and 'flip' fold at once, as quick hands do (the envelope is ready ~7 s after the sheet lands): the top
    // of the envelope is then raw. A sheet left open for ~12 s has its future top «бледное» already — measured in
    // frying-regression.cjs F1.
    const h = guest(); light(h); onPan(h);
    if (fry !== 'short') envelope(h);
    arrive(h);
    let flipS = null;
    if (fry !== 'short') {
      until(h, 'guestCookStep()>=2'); h.frames(2);
      assert.equal(h.grows().at(-1).event, 'hint'); assert.equal(h.grows().at(-1).bottom, 'приготовленное', 'her knock at this step is the «ready» sign');
      until(h, 'guestPic()===1');
    }
    if (fry.startsWith('flip')) {
      const t0 = h.run('dish.panTime'), n0 = h.gev().length;
      flick(h, 700); assert.equal(h.run('dish.flips'), 1, 'a 700 px/s flick turns the finished envelope');
      until(h, `guestCookStep()>=${fry === 'flip' ? 2 : 1}`); h.frames(2); flipS = h.run('dish.panTime') - t0;
      assert.equal(h.grows().at(-1).event, 'hint', 'she knocks at the steps of the second side too');
      assert.equal(h.gev().length, n0 + (fry === 'flip' ? 2 : 1));
      until(h, 'guestPic()===1');
    }
    if (h.run('dish.folds') < 4) { envelope(h); until(h, PALE); }   // 'short': folded late, taken off as soon as the steel side is «бледное»
    const sides = h.J('guestSides()');
    toTable(h); cut(h); if (crisp !== undefined) h.run(`dishCrisp=${crisp}`);
    serve(h, h.gs().som);
    const a = h.g().answers[0];
    assert.equal(a.answer, answer, `${fry}, crisp ${crisp} → ${answer}`); assert.equal(a.ballNo, 1);
    assert.equal(a.crisp, crisp === undefined ? 0 : +crisp.toFixed(1));
    assert.equal(a.crisp, h.run('gestures.filter(g=>g.kind==="serve").at(-1).crisp'), 'the same number as the stand card');
    assert.equal(a.step, Math.max(h.run(`fryStep(${sides.bottom})`), h.run(`fryStep(${sides.top})`)), 'the step of the answer is the higher of the two sides');
    if (fry === 'short') assert.ok(a.step >= 1 && h.run(`fryStep(${sides.top})`) < 2, `a short fry: the top is not «приготовленное» (steel side step ${a.step})`); else assert.ok(a.step >= 2);
    if (fry === 'done') assert.equal(h.run(`fryStep(${sides.top})`), 0, 'never flipped: the top is raw — a nod, not a crunch, with any crisp');
    assert.equal(h.run(`fryVerdict(${sides.bottom},${sides.top},${a.crisp})`), answer, 'the verdict of the stand is her answer');
    assert.deepEqual(h.g().gifts, [gift]); assert.equal(h.pic(), pic, `picture ${pic}`);
    assert.equal(h.gs().low, false, 'the view does not move while she answers');
    const left = h.run('gAnswer'); let n = 0; while (h.pic() === pic && n < 400) { h.frames(1); n++; }
    const held = (2.5 - left) + n / 60;
    assert.ok(Math.abs(held - 2.5) < 0.05, `the answer holds 2.5 s (${held.toFixed(2)} s)`);
    assert.equal(h.pic(), 1); assert.equal(h.gs().sat, true, 'she sits after the answer'); assert.equal(h.gs().low, true); assert.equal(h.g().here, true);
    const row = h.grows().at(-1);
    assert.equal(row.event, 'answer'); assert.equal(row.answer, answer); assert.equal(row.crisp, a.crisp); assert.equal(row.step, a.step); assert.equal(row.ballNo, 1);
    assert.equal(typeof h.grows().at(-2).panSeconds, 'number', 'the serve row keeps the seconds on the tava');
    assert.deepEqual(h.saved().guest.gifts, [gift], 'saved in roti_evening');
    const r = reloadG(h);
    assert.deepEqual(r.g().gifts, [gift], 'the gift is on the shelf after a reload'); assert.equal(r.g().here, true); assert.equal(r.gs().sat, true);
    assert.equal(r.eve().rotiDone, 1); assert.equal(r.g().taken, 1);
    r.tick(3, 1 / 60, true); assert.equal(r.run('loopErrs'), 0);
    out.push(`${fry}/${a.crisp}/step ${a.step}→${answer}/${gift}` + (flipS !== null ? ` (${flipS.toFixed(1)} s after the flick)` : ''));
  }
  // raw: both sides below «бледное» — she shakes her head, takes nothing, the roti stays on the table; a crisp does not help
  for (const crisp of [0, 9]) {
    const m = guest(); light(m); onPan(m); arrive(m); finish(m, crisp);
    cookAll(m, 0.05);   // script: the sides read raw
    const before = m.eve().rotiDone;
    serve(m, m.gs().som);
    assert.equal(m.g().taken, 0, 'a raw roti is not taken'); assert.deepEqual(m.g().answers, []); assert.deepEqual(m.g().gifts, [], 'no gift');
    assert.equal(m.eve().rotiDone, before, 'the evening does not count it'); assert.equal(m.run('dish.mode'), 'cut', 'the roti is still on the table');
    assert.equal(m.grows().at(-1).event, 'refuse'); assert.equal(m.run('gestures.filter(g=>g.kind==="pan").at(-1).outcome'), 'serve-refused');
    assert.equal(m.pic(), 1, 'picture 1'); assert.equal(m.g().here, true, 'she still waits');
    const turns = []; for (let i = 0; i < 80; i++) { turns.push(m.gs().head); m.frames(1); m.tick(1, 1 / 60, true); }
    assert.ok(Math.max(...turns) > 0.5 && Math.min(...turns) < -0.5, 'her head turns both ways');
    assert.equal(m.gs().head, 0, 'and comes to rest in 1.1 s'); assert.equal(m.run('loopErrs'), 0);
    serve(m);   // the counter takes it without a word
    assert.equal(m.eve().rotiDone, before + 1); assert.equal(m.g().taken, 0);
  }
  out.push('raw → refused, stays on the table, counter takes it');
  // burnt: a nod, bananas, no jam — even with a crisp
  {
    const m = guest(); light(m); onPan(m); arrive(m); finish(m, 9);
    cookSides(m, 1.2, 0.3);   // script: the side on the steel is burnt
    serve(m, m.gs().som);
    assert.equal(m.g().answers[0].answer, 'nod'); assert.equal(m.g().answers[0].burnt, true); assert.deepEqual(m.g().gifts, ['bananas'], 'burnt: no jam');
    assert.equal(m.grows().at(-1).verdict, 'burnt'); assert.equal(m.pic(), 3);
    out.push('burnt → nod/bananas');
  }
  return { summary: out.join(' · ') + '; held 2.5 s; gift after reload' };
});

test('G5', 'second ball — hers again, hints go on; after the second answer she leaves; the third roti goes to the counter', () => {
  const h = guest(); light(h); onPan(h); arrive(h); finish(h, 0);
  serve(h, h.gs().som); sec(h, 3);
  nextBall(h); onPan(h); envelope(h);   // folded: an open sheet does not brown, she would have nothing to knock at
  assert.equal(h.pic(), 1); assert.equal(h.gs().sat, true);
  h.run('COOK_RATE=FRY_RATES[40]'); const n0 = h.gev().length;   // script shortcut: fast frying preset
  until(h, 'guestCookStep()>=1'); h.frames(2);
  assert.equal(h.grows().at(-1).event, 'hint'); assert.equal(h.grows().at(-1).ballNo, 2, 'she knocks on the second ball too');
  assert.equal(h.gev().length, n0 + 1); until(h, 'guestPic()===1');
  cookSides(h, 0.3, 0.1);   // script: the steel side «приготовленное», the top «бледное» — with the crisp below it is a crunch
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
  // the lid in the middle of a knock: the tava stands still, she just waits; the knock goes on after
  until(h, 'panKnock>0'); const age = h.run('gKnock');
  h.visibility(true); h.visibility(false); h.frames(2);
  assert.equal(h.eve().lid, true); assert.equal(h.run('panKnock'), 0, 'no jump of the tava under the lid'); assert.equal(h.pic(), 1, 'picture 1 under the lid');
  assert.equal(h.run('eveningLive("")'), 'крышка — сдвинь её в сторону', 'one short lid line, with her or without (build 80)');
  sec(h, 4); assert.equal(h.run('gKnock'), age, 'the knock is frozen, not lost');
  off(); h.frames(1); assert.equal(h.pic(), 2, 'the knock goes on when the lid is off');
  until(h, 'guestPic()===1');
  // a reload between her coming and the first knock, and in the middle of it: the main knock is not eaten
  {
    const a = guest(); light(a); onPan(a); until(a, 'GST.here'); sec(a, 0.3);
    const r0 = reloadG(a);
    assert.equal(r0.g().here, true); assert.equal(r0.g().knocked, false); assert.equal(r0.pic(), 1);
    sec(r0, 5); assert.deepEqual(r0.gev(), ['arrive'], 'nothing fries after the reload (the ball is a lump again): no knock yet');
    onPan(r0); until(r0, 'guestPic()===2');
    const w = r0.run('dish.panTime');
    assert.ok(Math.abs(w - 1.5) < 0.1, `the main knock comes 1.5 s into the next frying (${w.toFixed(2)} s)`);
    assert.deepEqual(r0.gev(), ['arrive', 'knock']);
    sec(r0, 0.5); assert.equal(r0.g().knocked, false, 'not counted until it is over');
    const r1 = reloadG(r0); onPan(r1); until(r1, 'guestPic()===2'); until(r1, 'guestPic()===1');
    assert.deepEqual(r1.gev(), ['arrive', 'knock', 'knock'], 'a knock cut by a reload is knocked again');
    assert.equal(r1.g().knocked, true); assert.equal(r1.saved().guest.knocked, true);
    const r3 = reloadG(r1); onPan(r3); sec(r3, 4);
    assert.equal(r3.gev().filter(e => e === 'knock').length, 2, 'a finished main knock is not repeated after a reload');
  }
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
  sec(h, 3); nextBall(h); onPan(h); cookAll(h, 0.1); finish(h, 1); serve(h, h.gs().som);   // script: pale on both sides (a raw roti she would not take)
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
    assert.ok(G.zone.x1 < S.lamp.x - 10, 'the lamp is to the right of her'); assert.ok(G.shelf.x + 37 < G.slot.x, 'the shelf is to the left of her picture');
    assert.equal(G.pictures, false, 'placeholders (no Image in Node)');
    assert.ok(G.slot.h >= 108, `her picture is at least 108 px tall (${G.slot.h.toFixed(0)})`);
    assert.ok(G.sit > 6 && G.sit < G.slot.h * 0.1, 'sitting is a small part of the picture, not a fixed 20 px');
    onPan(h); until(h, 'GST.here'); h.tick(2, 1 / 60, true);
    until(h, 'guestPic()===2'); h.tick(2, 1 / 60, true);
    until(h, 'guestPic()===1'); finish(h, 0); serve(h, h.gs().som); assert.equal(h.pic(), 3); h.tick(2, 1 / 60, true);
    sec(h, 3); assert.equal(h.gs().low, true, 'she sits'); h.tick(2, 1 / 60, true);
    nextBall(h); onPan(h); cookAll(h, 0.3); finish(h, 8); serve(h, h.gs().som); assert.equal(h.pic(), 4); h.tick(2, 1 / 60, true);   // script: «приготовленное» on both sides
    assert.equal(h.gs().low, false, 'the second answer is shown at full height, not behind the counter');
    assert.equal(h.run('loopErrs'), 0, 'all four pictures and the shelf draw without errors'); assert.deepEqual(h.errors, []);
    out.push(`${w}×${hh}: slot ${Math.round(G.slot.w)}×${Math.round(G.slot.h)} at ${Math.round(G.slot.x)},${Math.round(G.slot.y)}`);
  }
  return { summary: out.join(' · ') };
});

test('G9', 'build 80 — the knock is seen at the tava: she leans, the arm reaches over the counter and the marks flash there (build 89: at the edge of the roti nearest to her while it is not flipped, not at the far rim); it repeats after 8 s of waiting over a FOLDED roti (never over an open sheet) until the roti is flipped or taken off; her eyes follow the roti and the folding finger; a roti carried past her onto the counter turns her head', () => {
  const h = guest(); light(h); onPan(h); until(h, 'GST.here');
  // the main knock: arm at the rim of the tava, marks only around the two hits, she leans
  until(h, 'guestPic()===2');
  const S = h.spots(); let hits = 0, marks = 0, frames = 0, markNoHit = 0, rim = null, lean = 0;
  while (h.pic() === 2) {
    const G = h.gs(); assert.ok(G.arm, 'the arm is out while she knocks'); rim = G.arm.at; lean = G.lean;
    if (G.arm.hit) { hits++; assert.ok(G.knock > 0, 'the tava jumps on the hit'); assert.ok(G.arm.marks, 'marks on every hit'); }
    if (G.arm.marks) marks++; if (G.arm.marks && !G.arm.hit) markNoHit++;
    h.frames(1); frames++;
  }
  assert.ok(rim.y > S.counterBottom + 4 && rim.y < S.pan.y && Math.abs(rim.x - S.pan.x) <= S.panR, `the marks are on the tava, below the counter, on her side (${rim.x.toFixed(0)},${rim.y.toFixed(0)}; counter bottom ${S.counterBottom.toFixed(0)}, tava ${S.pan.x.toFixed(0)},${S.pan.y.toFixed(0)})`);
  assert.ok(hits >= 12 && marks > hits && markNoHit >= 12, `marks outlast the hits (${hits} hit frames, ${marks} mark frames)`);
  assert.ok(lean > 5, `she leans to the tava while knocking (${lean} px)`); assert.equal(h.gs().arm, null, 'no arm between knocks'); assert.equal(h.gs().lean, 0);
  h.tick(2, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  // Changed in the review of build 80: an OPEN sheet cannot be flipped, so she does not repeat the knock over it
  // (it was «again» every 9.2 s while the player laid the banana and folded). The repeat starts at the finished envelope.
  const n0 = h.gev().length; sec(h, 25);
  assert.deepEqual(h.gev().slice(n0), [], 'open sheet: no repeat of the knock');
  // while a side is being folded her eyes go to the finger (three sides by strokes, the fourth move by move)
  envelope(h, [2, 3, 0]);
  { const e = h.J(`(()=>{const E=dish.env,d=envSide(E,1);return [__harness.dishToClient({x:E.c.x+d.x*E.h[1]*.97,y:E.c.y}),__harness.dishToClient(E.c)]})()`), rest = h.gs().gaze;
    h.touch('start', 't1', e[0].x, e[0].y); h.frames(6);
    for (let i = 1; i <= 12; i++) { h.touch('move', 't1', e[0].x + (e[1].x - e[0].x) * i / 14, e[0].y); h.frames(1); if (i === 2) { const at = h.gs().gaze; assert.ok(Math.abs(at.x - rest.x) > 0.1, `folding: her eyes go to the finger at the edge (gaze x ${rest.x} → ${at.x})`); } }
    h.touch('end', 't1', e[0].x + (e[1].x - e[0].x) * 12 / 14, e[0].y); h.frames(30); assert.equal(h.run('envelopeDone()'), true); }
  // folded, not flipped: the knock repeats after 8 s of waiting, again and again (a hint of a new step restarts the wait)
  const n1a = h.gev().length; let t = 0; const at = [];
  while (at.length < 2 && t < 60 * 60) { h.frames(1); t++; const ev = h.gev().slice(n1a); if (ev.filter(e => e === 'again').length > at.length) at.push(t / 60); }
  { const ev = h.gev().slice(n1a); assert.ok(ev.every(e => e === 'again' || e === 'hint'), ev.join(' ')); assert.equal(ev.filter(e => e === 'again').length, 2);
    const i0 = ev.indexOf('again'), between = ev.slice(i0 + 1, ev.lastIndexOf('again')).length;
    assert.ok(at[0] >= 8 - 0.1, `not earlier than 8 s after the fold (${at[0].toFixed(2)})`);
    if (!between) assert.ok(Math.abs(at[1] - at[0] - 9.2) < 0.1, `every 8 s + 1.2 s of knocking (${at.map(x => x.toFixed(2)).join(', ')})`); }
  until(h, 'guestPic()===1'); h.tick(2, 1 / 60, true);
  // eyes: down at the tava while the roti lies there
  const g0 = h.gs().gaze; assert.ok(g0.y > 0.9 && Math.abs(g0.x) < 0.35, `she looks down at the roti on the tava (${g0.x},${g0.y})`);
  // flipped: no more repeats (the hints of the new side go on)
  cookSides(h, 0.2, 0.02); flick(h, 700); assert.equal(h.run('dish.flips'), 1);
  // in the air over the tava (script shortcut: startFlip, the same entry the flick uses): her eyes and head go up after it
  { assert.equal(h.run('startFlip({x:1,y:0},{x:0,y:0})'), true); h.frames(13); const up = h.gs().gaze, k = h.run('guestFlipUp()');
    assert.ok(k > 0.8 && up.y < g0.y - 0.15, `the roti in the air: she looks up after it (gaze y ${g0.y} → ${up.y}, head up ${k.toFixed(2)})`);
    h.tick(2, 1 / 60, true); h.frames(40); assert.equal(h.run('dish.flips'), 2); assert.equal(h.run('guestFlipUp()'), 0); flick(h, 700); assert.equal(h.run('dish.flips'), 3); }
  const n1 = h.gev().length; sec(h, 20);
  assert.ok(!h.gev().slice(n1).includes('again'), `no repeat after the flip: ${h.gev().slice(n1).join(' ')}`);
  // taken off the tava: nothing; the eyes go with the roti in the hand, and on the counter she turns her head after it
  const b = guest(); light(b); onPan(b); arrive(b); finish(b);
  const n2 = b.gev().length; sec(b, 12); assert.deepEqual(b.gev().slice(n2), [], 'a roti on the table: she does not knock');
  { const B = rotiBox(b), SB = b.spots(), to = { x: SB.counter.x - 110, y: SB.counter.y };
    const down = b.gs().gaze; assert.ok(down.y > 0.9, 'the roti on the table: eyes down');
    b.touch('start', 't1', B.c.x, B.c.y); b.frames(6);
    for (let i = 1; i <= 20; i++) { b.touch('move', 't1', B.c.x + (to.x - B.c.x) * i / 20, B.c.y + (to.y - B.c.y) * i / 20); b.frames(1); }
    const up = b.gs().gaze; assert.ok(up.x < -0.25 && up.y < down.y - 0.3, `the eyes follow the roti in the hand (${down.x},${down.y} → ${up.x},${up.y})`);
    b.touch('end', 't1', to.x, to.y); b.frames(12); }
  assert.equal(b.eve().rotiDone, 1); assert.equal(b.g().taken, 0, 'on the counter band: the counter');
  assert.equal(b.gev().at(-1), 'watch'); const W = b.gs();
  assert.equal(W.watchDir, -1, 'the first counter roti lies to her left'); assert.ok(W.head < -0.9, `her head is turned after it (${W.head})`);
  b.tick(2, 1 / 60, true); assert.equal(b.run('loopErrs'), 0);
  sec(b, 2.5); assert.equal(b.gs().head, 0, 'and turns back');
  // given to her: no «watch»
  const c = guest(); light(c); onPan(c); arrive(c); finish(c); serve(c, c.gs().som);
  assert.ok(!c.gev().includes('watch')); assert.deepEqual(h.errors.concat(b.errors, c.errors), []);
  return { summary: `knock: ${hits} hit frames, marks ${marks} frames at ${rim.x.toFixed(0)},${rim.y.toFixed(0)} (counter bottom ${S.counterBottom.toFixed(0)}); lean ${lean} px; open sheet 25 s: no repeat; after the fold repeats at ${at.map(x => x.toFixed(1)).join(' s, ')} s; gaze tava ${g0.x},${g0.y}; watch dir ${W.watchDir}, head ${W.head}` };
});

// Build 89 (docs/som-points-batch-spec.md): she knocks at the PALEST place of the roti's edge, not at the rim, and
// shakes her head once at a roti taken to the table with its visible side raw.
// Script shortcuts, named: the colours of the sides are set by script (cookSides / a gradient by face position);
// one knock after the flip is started by script (guestKnock — the same entry as her «again»), because after a flip
// she no longer repeats.
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function knockFrames(h) {                    // the frames of one knock: the arm and the marks
  until(h, 'guestPic()===2'); const out = [];
  while (h.pic() === 2) { const G = h.gs(); if (G.arm) out.push(G.arm); h.frames(1); }
  return out;
}
test('G10', 'build 89 — the knock marks lie at the palest point of the roti edge (nearer to it than to the rim; not flipped — the edge nearest to her) and her arm is out; raw visible side taken to the table → one «no» (0.6 s, two shakes, then she looks at the tava); cooked → none; taken again → one more; serving and the answer unchanged', () => {
  const out = [];
  // not flipped: the main knock goes to the edge of the roti nearest to her
  const h = guest(); light(h); onPan(h); until(h, 'GST.here');
  { const A = knockFrames(h), S = h.spots(); assert.ok(A.length > 30, 'the arm is out for the whole knock');
    const k = A.find(a => a.marks), E = k.pale.edge, ys = E.map(q => q.y), y0 = Math.min(...ys), y1 = Math.max(...ys);
    assert.ok(k.at.y <= y0 + (y1 - y0) * 0.2 && k.at.y < S.pan.y, `not flipped: the marks at the edge on her side (y ${k.at.y.toFixed(0)}, edge ${y0.toFixed(0)}…${y1.toFixed(0)}, tava ${S.pan.y.toFixed(0)})`);
    assert.ok(E.some(q => dist(q, k.at) < 1), 'the marks are at a point of the roti edge');
    out.push(`not flipped: marks at y ${k.at.y.toFixed(0)} of edge ${y0.toFixed(0)}…${y1.toFixed(0)}`); }
  // flipped: every side «бледное», one place of the edge paler (the colour of the visible side of the top layer
  // there, set by script) — the marks go to it; two places in turn: the edge nearest to the player, the leftmost
  envelope(h); flick(h, 700); assert.equal(h.run('dish.flips'), 1);
  let E0 = null;
  { h.run('guestKnock(GUEST_KNOCK_S,"again")'); h.frames(1); E0 = knockFrames(h).find(a => a.marks).pale.edge; }
  for (const [name, pick] of [['nearest the player', E => E.reduce((m, q) => q.y > m.y ? q : m)], ['leftmost', E => E.reduce((m, q) => q.x < m.x ? q : m)]]) {
    const q0 = pick(E0);
    h.run(`for(const t of dish.thermal) if(t){t.dry[0]=t.dry[1]=1;t.cook[0]=t.cook[1]=0.5;} dish.thermal[${q0.src}].cook[${q0.side}]=0.12;`);
    h.run('guestKnock(GUEST_KNOCK_S,"again")'); h.frames(1);
    const A = knockFrames(h), k = A.find(a => a.marks), E = k.pale.edge;
    const pale = E.reduce((m, q) => q.cook < m.cook ? q : m), rimD = dist(k.at, k.rim), paleD = dist(k.at, pale);
    assert.ok(A.every(a => a.at.x === k.at.x && a.at.y === k.at.y), 'one place for the whole knock');
    assert.ok(k.pale.cook <= 0.12 + 1e-9 && pale.cook <= 0.12 + 1e-9, `the marked point is the palest of the edge (${k.pale.cook}, palest ${pale.cook})`);
    assert.ok(paleD < rimD, `nearer to the palest point (${paleD.toFixed(1)} px) than to the rim (${rimD.toFixed(1)} px)`);
    assert.ok(dist(k.at, q0) < 40, `at the place made pale (${name}: ${dist(k.at, q0).toFixed(1)} px from it)`);
    out.push(`pale ${name}: marks ${k.at.x.toFixed(0)},${k.at.y.toFixed(0)} — ${paleD.toFixed(1)} px from the palest point, ${rimD.toFixed(1)} px from the rim`);
  }
  assert.equal(h.run('loopErrs'), 0); h.tick(2, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  // the «no»: raw visible side to the table — one; back to the tava and off again — one more; then cut and serve: the answer as before
  const m = guest(); light(m); onPan(m); arrive(m); envelope(m); until(m, PALE);
  cookSides(m, 0.5, 0.02);   // script: the steel side «приготовленное», the visible side raw
  const n0 = m.gev().length;
  { const c0 = m.J('(()=>{const b=dishBounds();return __harness.dishToClient({x:(b.left+b.right)/2,y:(b.top+b.bottom)/2})})()');
    drive(m, line(c0, m.spots().work, { v: 320, hold: 60 }), { settle: 0 }); m.frames(1); }   // toTable, but watched from the release on
  assert.equal(m.run('dish.mode'), 'cut', 'on the table');
  assert.deepEqual(m.gev().slice(n0), ['no'], 'raw on the table: one «no»');
  const row = m.grows().at(-1); assert.equal(row.top, 'сырое'); assert.equal(row.flips, 0);
  { const turns = [], looks = []; let t = 0;
    while (t < 100) { const G = m.gs(); turns.push(G.head); looks.push({ ...G.gaze, no: G.noLook }); m.frames(1); t++; if (t === 3) m.tick(1, 1 / 60, true); }
    let flipsSign = 0; for (let i = 1; i < turns.length; i++) if (Math.sign(turns[i]) && Math.sign(turns[i]) !== Math.sign(turns[i - 1]) && turns[i - 1]) flipsSign++;
    const last = turns.map((v, i) => [v, i]).filter(([v]) => Math.abs(v) > 0.05).at(-1)[1];
    assert.ok(Math.max(...turns) > 0.5 && Math.min(...turns) < -0.5, 'her head turns both ways');
    assert.ok(last <= 37, `the shake is over in 0.6 s (last turn at frame ${last})`); assert.ok(flipsSign >= 3 && flipsSign <= 4, `two shakes (${flipsSign} sign changes)`);
    const S = m.spots(), at = looks[50], tab = looks[99];
    assert.ok(at.y > 0.9 && Math.abs(at.x) < 0.35, `after the shake she looks at the tava (${at.x},${at.y})`);
    assert.ok(at.no > 0 && tab.no === 0, `the look at the tava lasts 0.6 + 1 s (left ${at.no} s at frame 50, ${tab.no} at frame 99)`);   // the tava and the table are both «down» from her: the look is checked by its timer
    out.push(`no: head ${Math.max(...turns).toFixed(2)}/${Math.min(...turns).toFixed(2)}, still after ${last} frames`); }
  sec(m, 3); assert.deepEqual(m.gev().slice(n0), ['no'], 'only once for one removal');
  serve(m, m.spots().pan); assert.equal(m.run('dish.mode'), 'fold', 'back on the tava');
  const n1 = m.gev().length; toTable(m);
  assert.deepEqual(m.gev().slice(n1).filter(e => e === 'no'), ['no'], 'taken off again: one more «no»');
  cut(m); serve(m, m.gs().som);
  assert.equal(m.g().answers.length, 1, 'served: she takes it'); assert.equal(m.g().answers[0].answer, 'nod'); assert.deepEqual(m.g().gifts, ['bananas'], 'one side cooked, the other raw — a nod and bananas, as before');
  assert.equal(m.gev().filter(e => e === 'no').length, 2);
  // cooked visible side to the table: none
  const c = guest(); light(c); onPan(c); arrive(c); envelope(c); until(c, PALE);
  cookSides(c, 0.5, 0.5); const n2 = c.gev().length; toTable(c); sec(c, 2);
  assert.ok(!c.gev().slice(n2).includes('no'), `cooked on the table: no «no» (${c.gev().slice(n2).join(' ')})`);
  assert.deepEqual(h.errors.concat(m.errors, c.errors), []);
  return { summary: out.join('; ') + '; raw → no, again → no, served → nod/bananas; cooked → none' };
});

const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\nguest: ${passed}/${results.length} passed`);
try {
  const dir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'guest-results.json'), JSON.stringify({ source: H.sourcePath, sha256: H.sourceSha256, passed, total: results.length, results }, null, 2));
} catch (e) { console.log('report not written: ' + e.message); }
process.exit(passed === results.length ? 0 : 1);
