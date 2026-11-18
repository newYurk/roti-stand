#!/usr/bin/env node
'use strict';
// v0 step 5 — the second evening (docs/v0-step5-second-evening.md): the evening number n is kept across
// evenings; the shelf and the notebook survive a new evening; bananas are a bunch for two roti that runs
// out (2 → 1 → gone), jam is a jar for three (touch the jar, lead a finger over the cut roti; the level drops
// by steps); a gift of the same kind refills; Som the next day comes with an empty jar (after jam) or earlier
// and knocking at once (after a nod); the notebook pages back; the night frame of evening 2+ shows yesterday
// small beside today; the radio restart keeps the shelf and the notebook, the wipe is in the stand panel only.
// Pure Node/vm with the mocks of model-regression.cjs: stand.js and every script of index.html after it
// (counter-item, drizzle, banana, egg, evening, guest, notebook, night, shelf) run in ONE context in the
// order of index.html. Every action of the player goes through the stand's real window touch handlers.
// This is not a browser: how the shelf, the stripe and the small cards look is a live question.
//   node prototype/dough-closeup/checks/second-evening-regression.cjs path/to/stand.js [--only S1,S3]
// ALWAYS pass the stand.js of the checkout under test as the first argument. Report:
// runs/checks/second-evening-results.json of the checkout (runs/ is not in git).
// Script shortcuts, named where used: the dough of every ball is set to the stretch target; S2–S7 start from
// saves written by script (saveNight, saveMid); S5 writes seven finished evenings by script.
// The helpers down to endEvening are the ones of night-regression.cjs (kept in step by hand).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const H = require('./model-regression.cjs');
const { boot, lcg } = H;
// the scripts index.html loads after stand.js, in its order (drizzle.js is the jam gesture here)
const sideScripts = ['counter-item.js', 'drizzle.js', 'banana.js', 'egg.js', 'evening.js', 'guest.js', 'notebook.js', 'night.js', 'shelf.js'].map(f => ({ file: path.join(path.dirname(H.sourcePath), f), src: fs.readFileSync(path.join(path.dirname(H.sourcePath), f), 'utf8') }));
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
const FRAME = 'step(1/60); bananaUpdate(1/60); eggUpdate(1/60); drizzleUpdate(1/60); eveningUpdate(1/60);';   // what loop() runs besides drawing (eveningUpdate calls guestUpdate)
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
// Merge with the frying batch (build 79): an open sheet no longer browns, so a roti folded and served at once is
// RAW and Som refuses it. As in guest-regression.cjs, the folded envelope fries on until its steel side is
// «бледное» (model time, a few seconds); the answer for such a roti is a nod, as these checks expect.
const PALE = 'fryStep(meanCook())>=1';
function finish(h, crisp) { if (!h.run('envelopeDone()')) envelope(h); if (!h.run(PALE)) until(h, PALE); toTable(h); cut(h); if (crisp !== undefined) h.run(`dishCrisp=${crisp}`); }
// a 700 px/s flick from the right edge turns the finished envelope (as in guest-regression.cjs)
function flick(h, v = 700) {
  const e = h.J(`(()=>{const b=dishBounds();return [__harness.dishToClient({x:b.right-0.02,y:(b.top+b.bottom)/2}),__harness.dishToClient({x:b.right+0.5,y:(b.top+b.bottom)/2})]})()`);
  const a = e[0], dir = Math.sign(e[1].x - a.x) || 1, pts = [{ x: a.x, y: a.y, t: 0 }];
  for (let i = 1; i <= 9; i++) pts.push({ x: a.x + dir * v * i / 60, y: a.y, t: 120 + i * 1000 / 60 });
  pts.push({ ...pts.at(-1), t: pts.at(-1).t + 1 });
  drive(h, pts, { settle: 50 });
}
const nextBall = h => { tap(h, h.spots().bowl); assert.equal(h.eve().ball, true, 'a ball is taken from the bowl'); };
const FRESH = { v: 1, here: false, gone: false, knocked: false, answers: [], gifts: [], taken: 0 };

// ── notebook helpers ──────────────────────────────────────────────────────────────────────────
function nb(opts) {
  const h = guest(opts);
  h.n = () => h.J('notebookSpots()');
  h.NB = () => h.J('NB');
  h.nev = () => h.J('gestures.filter(g=>g.kind==="notebook").map(g=>g.event+(g.how?":"+g.how:"")+(g.to?":"+g.to:""))');
  return h;
}
const reloadN = (h, opts = {}) => nb({ storage: [...h.storage], ...opts });
// a whole ball from a stretched sheet to the release at `to` (default: the counter)
function ball(h, to) { onPan(h); finish(h); serve(h, typeof to === 'function' ? to() : to); }
// canvases made after this call answer toDataURL with a fake JPEG whose weight is kb(q) kilobytes
function fakeShots(h, kbOfQ) {
  h.context.__kb = kbOfQ; h.context.__shots = [];
  h.run(`{const mk=document.createElement;document.createElement=tag=>{const n=mk(tag);
    if(tag==="canvas") n.toDataURL=(type,q)=>{__shots.push(q);return "data:image/jpeg;base64,"+"A".repeat(Math.ceil(__kb(q)*1024*4/3));};return n;};}`);
}
const pastEvening = (i, n = 2) => ({ ts: `2026-11-0${i}T12:00:00.000Z`, snaps: Array.from({ length: n }, (_, k) => ({ to: k ? 'counter' : 'som', img: null, crisp: i, step: 1, ts: `2026-11-0${i}T12:0${k}:00.000Z` })) });
const saveWith = evenings => [['roti_evening', JSON.stringify({ v: 1, lamp: false, ballsLeft: 3, rotiDone: 0, lid: false, over: false, ball: false, notebook: { v: 1, cur: false, peeked: false, evenings, events: [] } })]];
const cookNow = h => h.J('{dry:dishSideMean("dry","contactWeights"),cook:dishSideMean("cook","contactWeights"),t:dish.panTime}');


// ── night helpers ─────────────────────────────────────────────────────────────────────────────
function night(opts) {
  const h = nb(opts);
  h.ns = () => h.J('nightSpots()');
  h.NGT = () => h.J('NGT');
  h.ngt = () => h.J('gestures.filter(g=>g.kind==="night").map(g=>g.event+(g.how?":"+g.how:""))');
  h.serves = () => h.J('eveningExport().events.filter(e=>e.event==="serve").map(e=>e.to||"counter")');
  // what is DRAWN, not what the code counts: ellipses recorded from the canvas while evening.js draws its lower layer
  h.drawn = code => h.J(`(()=>{const keep=ctx.ellipse,out=[];ctx.ellipse=(x,y,rx,ry)=>out.push({fill:ctx.fillStyle,stroke:ctx.strokeStyle,x,y,rx,ry});
    try{${code}}finally{ctx.ellipse=keep}return out})()`);
  // roti-coloured ellipses inside the counter
  h.onCounter = () => { const C = h.J('eveGeo().counter'); return h.drawn('eveningDraw(ctx,1,1,0);').filter(e => e.fill === '#c9a15a' && e.x >= C.x0 && e.x <= C.x1 && e.y >= C.y0 && e.y <= C.y1).length; };
  return h;
}
const reloadD = (h, opts = {}) => night({ storage: [...h.storage], ...opts });
const snapOf = (to, k) => ({ to, img: null, crisp: 1, step: 1, ts: `2026-11-17T12:0${k}:00.000Z` });
// script shortcut: a save with `done` roti served (to Som, as far as she takes them) and the next ball in work; Som has left
function saveAt(done, { gone = true } = {}) {
  const answers = Array.from({ length: Math.min(2, done) }, (_, i) => ({ ballNo: i + 1, crisp: 1, step: 1, answer: 'nod' }));
  return [['roti_evening', JSON.stringify({ v: 1, lamp: true, ballsLeft: 3 - done - 1, rotiDone: done, lid: false, over: false, ball: true,
    guest: { v: 1, here: false, gone, knocked: true, answers, gifts: answers.map(() => 'bananas'), taken: answers.length, events: [] },
    notebook: { v: 1, cur: done > 0, peeked: true, evenings: done > 0 ? [{ ts: '2026-11-17T12:00:00.000Z', snaps: answers.map((_, k) => snapOf('som', k)) }] : [], events: [] } })]];
}
// a carry of the cut roti by hand, in pieces: grab() takes it by the middle, go() moves the finger, drop() releases
function grab(h) { const c = rotiBox(h).c; h.touch('start', 't1', c.x, c.y); h.frames(6); return { x: c.x, y: c.y }; }
function go(h, from, to, v = 420) {
  const L = Math.hypot(to.x - from.x, to.y - from.y), n = Math.max(1, Math.ceil(L / (v / 60)));
  for (let i = 1; i <= n; i++) { h.touch('move', 't1', from.x + (to.x - from.x) * i / n, from.y + (to.y - from.y) * i / n); h.frames(1); }
  return { x: to.x, y: to.y };
}
function drop(h, at) { h.frames(3); h.touch('end', 't1', at.x, at.y); h.frames(30); }
const fur_under = h => { const o = h.drawn('nightDrawUnder(ctx,1,1,eveGeo());'); assert.ok(o.length && o[0].fill === '#d9d2c0', 'the lower layer starts with fur, not with a silhouette'); return o.filter(e => e.fill === '#d9d2c0').length; };
const endEvening = h => { const S = h.spots(); assert.equal(S.lidHome, true, 'the lid waits on the table'); drive(h, line(S.lid, S.pan, { v: 300 })); assert.equal(h.eve().over, true); };

// ── shelf helpers ─────────────────────────────────────────────────────────────────────────────
function shelf(opts) {
  const h = night(opts);
  h.sh = () => h.J('shelfSpots()');
  h.SHF = () => h.J('SHF');
  h.shev = () => h.J('gestures.filter(g=>g.kind==="shelf").map(g=>g.event+":"+g.item)');
  h.rects = code => h.J(`(()=>{const keep=ctx.fillRect,out=[];ctx.fillRect=(x,y,w,h)=>out.push({fill:ctx.fillStyle,x,y,w,h});
    try{${code}}finally{ctx.fillRect=keep}return out})()`);
  // what is DRAWN on the shelf: yellow bananas (ellipses), the red of the jam (its height in px), jar glasses
  h.shelfDrawn = () => {
    const e = h.drawn('shelfDraw(ctx,1,1,eveGeo());'), r = h.rects('shelfDraw(ctx,1,1,eveGeo());');
    return { bananas: e.filter(x => x.fill === '#e3c04a').length, red: Math.round(r.filter(x => x.fill === '#a8402c').reduce((s, x) => s + x.h, 0) * 10) / 10,
      glasses: r.filter(x => x.fill === '#8b7f6e' && x.h > 10).length, lids: r.filter(x => x.fill === '#d9d2c0').length };
  };
  return h;
}
const reloadS = (h, opts = {}) => shelf({ storage: [...h.storage], ...opts });
const answersOf = kinds => kinds.map((answer, i) => ({ ballNo: i + 1, crisp: 1, step: answer === 'crunch' ? 2 : 1, answer }));
// script shortcut: a save of a FINISHED evening n (night frame) — Som answered `kinds`, the shelf holds `sh`
function saveNight(kinds, { n = 1, sh = {}, pages = 1 } = {}) {
  const answers = answersOf(kinds), gifts = kinds.map(k => k === 'crunch' ? 'jam' : 'bananas');
  const evenings = Array.from({ length: pages }, (_, i) => ({ ts: `2026-11-1${i}T12:00:00.000Z`, snaps: ['som', 'som', 'dog'].map((to, k) => snapOf(to, k)) }));
  return [['roti_evening', JSON.stringify({ v: 1, lamp: false, ballsLeft: 0, rotiDone: 3, lid: true, over: true, ball: false, n,
    guest: { v: 1, here: false, gone: true, knocked: true, answers, gifts, taken: answers.length, events: [] },
    notebook: { v: 1, cur: true, peeked: true, evenings, events: [] },
    night: { v: 1, dog: 1, shown: true, events: [] },
    shelf: { v: 1, n, bananas: 0, jam: 0, jar: false, empty: false, banBall: 0, jamBall: 0, som: { jar: false, early: false }, jarIn: null, begun: true, events: [], ...sh } })]];
}
// script shortcut: a save of evening n with the lamp lit, `done` roti served and the next ball in work; Som has left for the evening
function saveMid(done, { n = 2, sh = {}, gone = true, som = { jar: false, early: false } } = {}) {
  return [['roti_evening', JSON.stringify({ v: 1, lamp: true, ballsLeft: 3 - done - 1, rotiDone: done, lid: false, over: false, ball: true, n,
    guest: { v: 1, here: false, gone, knocked: false, answers: [], gifts: [], taken: 0, events: [] },
    notebook: { v: 1, cur: false, peeked: true, evenings: [{ ts: '2026-11-16T12:00:00.000Z', snaps: ['som', 'som', 'dog'].map((to, k) => snapOf(to, k)) }], events: [] },
    shelf: { v: 1, n, bananas: 0, jam: 0, jar: false, empty: false, banBall: 0, jamBall: 0, som, jarIn: som.jar ? 'wait' : null, begun: true, events: [], ...sh } })]];
}
const sheetMid = h => h.J('(()=>{const b=dishBounds();return __harness.dishToClient({x:(b.left+b.right)/2,y:(b.top+b.bottom)/2})})()');
// build 85: one tap lays a heap of 10–14 slices, the second tap pours the egg — banana slices are counted by kind
const bananasOn = h => h.run('(dish.filling||[]).filter(f=>(f.kind||"banana")==="banana").length');
const eggOn = h => h.run('(dish.filling||[]).filter(f=>f.kind==="egg").length');
const heap = n => n >= 10 && n <= 14;
// a jam stroke: a finger led across the cut roti lying on the table (inside it, a little off the cut line)
function jamStroke(h, dy = 0.3, v = 260) {
  const B = rotiBox(h), y = B.c.y + (B.b.y - B.c.y) * dy, a = { x: B.l.x + (B.c.x - B.l.x) * 0.3, y }, b = { x: B.r.x - (B.r.x - B.c.x) * 0.3, y };
  drive(h, line(a, b, { v, hold: 60 }), { settle: 12 });
}
const lump = h => { tap(h, h.spots().lump); };

// ── checks ────────────────────────────────────────────────────────────────────────────────────
test('S1', 'evening 1 → night → lump → evening 2 by touches: n is 2, the shelf and the notebook stay, three balls in the bowl; the journal has begin with n and the shelf; the notebook pages back to yesterday', () => {
  const h = shelf(); light(h);
  assert.equal(h.SHF().n, 1); assert.equal(h.saved().n, 1, 'roti_evening keeps n');
  assert.deepEqual(h.shelfDrawn(), { bananas: 0, red: 0, glasses: 0, lids: 0 }, 'evening 1 starts with an empty shelf: nothing is drawn');
  assert.equal(h.sh().bananaOk, false, 'no bananas on the shelf — no banana on the sheet');
  // ball 1: a short fry → nod → bananas
  onPan(h);
  { const c = sheetMid(h); tap(h, c); assert.equal(bananasOn(h), 0, 'evening 1, empty shelf: a touch of the middle lays no banana'); }
  arrive(h); finish(h); serve(h, h.gs().som);
  assert.deepEqual(h.g().answers.map(a => a.answer), ['nod']);
  assert.equal(h.SHF().bananas, 2, 'her bananas are a bunch for two roti'); assert.equal(h.shelfDrawn().bananas, 2);
  sec(h, 6); if (h.n().open) tap(h, h.n().leftPage);
  // ball 2: fried to «приготовленное» → crunch → jam
  // build 79: crunch needs BOTH sides «приготовленное» — fold, fry, flip, fry the second side
  nextBall(h); onPan(h); envelope(h); until(h, 'guestCookStep()>=2'); h.frames(2); until(h, 'guestPic()===1'); flick(h, 700); assert.equal(h.run('dish.flips'), 1);
  until(h, 'guestCookStep()>=2'); h.frames(2); until(h, 'guestPic()===1'); finish(h); serve(h, h.gs().som);
  assert.deepEqual(h.g().answers.map(a => a.answer), ['nod', 'crunch']);
  assert.equal(h.SHF().jam, 3); assert.equal(h.SHF().jar, true);
  sec(h, 6); if (h.n().open) tap(h, h.n().leftPage);
  nextBall(h); ball(h, () => h.ns().dog);
  assert.equal(h.eve().rotiDone, 3);
  endEvening(h); h.frames(3);
  assert.equal(h.ns().frame, true); assert.equal(h.ns().past.length, 0, 'the night of evening 1 has no yesterday');
  const before = { sh: h.shelfDrawn(), pages: h.NB().evenings.length, snaps: h.NB().evenings[0].snaps.map(s => s.to) };
  assert.deepEqual(before.sh, { bananas: 2, red: 19, glasses: 1, lids: 1 }, 'the night shelf: a bunch of two and a full jar');
  lump(h);
  assert.equal(h.SHF().n, 2, 'the lump starts evening 2'); assert.equal(h.saved().n, 2); assert.equal(h.saved().shelf.n, 2);
  assert.equal(h.eve().ballsLeft, 3, 'three balls in the bowl'); assert.equal(h.eve().over, false); assert.equal(h.eve().lamp, false);
  assert.deepEqual(h.shelfDrawn(), before.sh, 'the shelf is as it was'); assert.equal(h.SHF().bananas, 2); assert.equal(h.SHF().jam, 3);
  assert.equal(h.NB().evenings.length, 1); assert.deepEqual(h.NB().evenings[0].snaps.map(s => s.to), before.snaps, 'the notebook page of yesterday is in place');
  assert.deepEqual(h.g().gifts, [], 'today Som has given nothing yet'); assert.deepEqual(h.SHF().som, { jar: true, early: true }, 'what she did yesterday is remembered for today');
  const r = reloadS(h);
  assert.equal(r.SHF().n, 2, 'n survives a reload'); assert.deepEqual(r.shelfDrawn(), before.sh); assert.equal(r.NB().evenings.length, 1);
  light(r); r.frames(2);
  const begin = r.J('gestures.filter(g=>g.kind==="evening"&&g.event==="begin").at(-1)');
  assert.equal(begin.n, 2); assert.deepEqual(begin.shelf, { bananas: 2, jam: 3, jar: true, emptyJar: false }); assert.equal(begin.som, 'jar+early');
  assert.equal(h.J('gestures.filter(g=>g.kind==="evening"&&g.event==="begin")[0].n'), 1, 'evening 1 logged its begin too');
  // the notebook: today's page is empty, the arrow back leads to yesterday's three
  tap(r, r.n().item); r.frames(20);
  assert.equal(r.n().open, 1); assert.equal(r.n().pages, 2); assert.equal(r.n().snaps.length, 0);
  assert.ok(r.n().prev, 'there is a way back'); tap(r, r.n().prev);
  assert.deepEqual(r.n().snaps.map(s => s.to), before.snaps, 'yesterday: its roti and who got each');
  tap(r, r.n().leftPage);
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []); assert.deepEqual(r.errors, []);
  return { summary: `evening 1: ${before.snaps.join(', ')}; shelf at night ${JSON.stringify(before.sh)}; evening 2 begins with ${JSON.stringify(begin.shelf)}, Som ${begin.som}` };
});

test('S2', 'bananas: a bunch for two roti — 2 → 1 → gone as drawn; many slices on one roti cost one; the third touch of the middle lays nothing and the roti can still be made plain', () => {
  const h = shelf({ storage: saveMid(0, { sh: { bananas: 2 } }) });
  assert.equal(h.shelfDrawn().bananas, 2);
  const seen = [];
  for (let i = 0; i < 2; i++) {
    if (i) nextBall(h);
    onPan(h); h.frames(3);
    // build 80: the stand writes the hint line itself (one short line), evening.js no longer rewrites it
    const c = sheetMid(h); tap(h, c);
    assert.ok(heap(bananasOn(h)), `roti ${i + 1}: a touch of the middle lays a banana heap (${bananasOn(h)} slices)`);
    const laid = bananasOn(h);
    assert.equal(h.SHF().bananas, 1 - i, 'the first slice takes one banana off the bunch');
    tap(h, { x: c.x + 26, y: c.y + 4 }); tap(h, { x: c.x - 26, y: c.y - 4 });
    assert.equal(bananasOn(h), laid, 'more taps lay no more banana'); assert.ok(eggOn(h) > 0, 'the second tap pours the egg'); assert.equal(h.SHF().bananas, 1 - i, '… and cost nothing more');
    seen.push(h.shelfDrawn().bananas);
    finish(h); serve(h); assert.equal(h.eve().rotiDone, i + 1);
  }
  assert.deepEqual(seen, [1, 0], 'drawn: two → one → none');
  assert.deepEqual(h.shelfDrawn(), { bananas: 0, red: 0, glasses: 0, lids: 0 }, 'the empty bunch is gone, and the bare shelf with it');
  assert.equal(h.sh().bunchAt, null);
  assert.deepEqual(h.shev(), ['use:bananas', 'use:bananas', 'empty:bananas']);
  nextBall(h); onPan(h); h.frames(3);
  const c = sheetMid(h); tap(h, c); tap(h, { x: c.x + 20, y: c.y });
  assert.equal(bananasOn(h), 0, 'the third roti: a touch of the middle lays no banana'); assert.equal(h.run('canPlaceBanana()'), false);
  assert.equal(h.run('eveningLive("Положи банан и яйцо, потом заверни края")'), 'заверни четыре стороны к середине', 'the words do not promise a banana');
  assert.equal(h.run('eveningLive("сырое · шипит, можно начинку")'), 'сырое · шипит', 'nor a filling');
  finish(h); serve(h);
  assert.equal(h.eve().rotiDone, 3, 'a plain roti is always possible');
  const r = reloadS(h); assert.equal(r.SHF().bananas, 0); assert.equal(r.shelfDrawn().bananas, 0);
  // the stand panel (?dev=1) is not rationed
  const d = shelf({ search: '?dev=1' }); assert.equal(d.run('shelfBananaOk()'), true);
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: `drawn bananas after each roti: 2 → ${seen.join(' → ')}; journal ${h.shev().join(', ')}` };
});

test('S3', 'jam: touch the jar, lead a finger over the cut roti — a jam stripe; three roti empty the jar, the level drops by steps; a second stripe on the same roti is free; the empty jar is put away by a touch', () => {
  const h = shelf({ storage: saveMid(0, { sh: { jam: 3, jar: true } }) });
  const levels = [h.shelfDrawn().red];
  for (let i = 0; i < 3; i++) {
    if (i) nextBall(h);
    onPan(h); envelope(h);
    tap(h, h.sh().jarAt); assert.equal(h.sh().armed, false, 'on the tava the jar does not answer');
    toTable(h);
    if (i === 0) { tap(h, h.sh().jarAt); assert.equal(h.sh().armed, false, 'an uncut roti takes no jam'); }
    cut(h);
    assert.equal(h.sh().jamCan, true);
    tap(h, h.sh().jarAt);
    assert.equal(h.sh().armed, true, 'the jar is touched: jam in the hand'); assert.equal(h.run('drizzleModeOn'), true);
    assert.equal(h.run('eveningLive(dish.message)'), 'варенье · проведи пальцем по роти');
    assert.ok(h.rects('shelfDraw(ctx,1,1,eveGeo());').some(r => r.fill === '#d9d2c0' && r.y < h.J('eveGeo().u') * 0 + h.J('guestShelf(eveGeo()).y') - 28), 'the lid is drawn lifted while the jam is in the hand');
    const cuts = h.run('dish.cuts.length');
    jamStroke(h);
    assert.equal(h.run('dish.cuts.length'), cuts, 'the jam stroke does not cut');
    assert.equal(h.run('drizzleStrokes'), 1, 'one stripe lies on the roti'); assert.equal(h.sh().armed, false, 'one stroke per touch of the jar');
    assert.equal(h.run('drizzleModeOn'), false);
    assert.equal(h.SHF().jam, 2 - i, 'the first stripe on a roti takes one step off the jar');
    levels.push(h.shelfDrawn().red);
    if (i === 0) {   // a second stripe on the same roti is free; the stripe is jam-coloured and flat
      tap(h, h.sh().jarAt); assert.equal(h.sh().armed, true); jamStroke(h, -0.35, 1100);   // a fast stroke after a slow one
      assert.equal(h.run('drizzleStrokes'), 2); assert.equal(h.SHF().jam, 2, 'the second stripe costs nothing');
      const widths = h.J(`(()=>{const out=[],k=ctx.stroke;ctx.stroke=()=>out.push(ctx.lineWidth);try{drizzleDraw(ctx)}finally{ctx.stroke=k}return out})()`);
      assert.ok(widths.length >= 2 && widths.every(w => w === widths[0]) && widths[0] >= 4, `a slow and a fast stripe are one width (${widths.join(',')})`);
      h.stripeW = widths[0];
      const strokes = h.J(`(()=>{const out=[],k=ctx.stroke;ctx.stroke=()=>out.push(ctx.strokeStyle);try{drizzleDraw(ctx)}finally{ctx.stroke=k}return out})()`);
      assert.ok(strokes.includes('#a8402c'), `the stripe is drawn in the jam colour (${strokes.join(',')})`);
      assert.equal(h.run('_drops.length+_falls.length'), 0, 'no beads, no falling drops');
      // a new cut after the jam keeps the stripes on the roti
      const B = rotiBox(h); drive(h, line({ x: B.c.x, y: B.t.y - 14 }, { x: B.c.x, y: B.b.y + 14 }, { v: 380, hold: 60 }));
      assert.equal(h.run('dish.cuts.length'), cuts + 1); h.frames(3);
      assert.ok(h.J('_trails.flatMap(t=>t.pts).filter(p=>p&&!p.break).every(p=>dish.faces[p.face]&&dish.faces[p.face].kind==="dough"&&pointInFace(dish.faces[p.face].points,p.x,p.y))'), 'every point of the stripes still lies in its piece');
      assert.equal(h.run('drizzleStrokes'), 2, 'both stripes are still there');
    }
    if (i === 2) {   // jam in the hand does not swallow a touch of the radio, the notebook or the jar: the jam goes back, the touch goes through
      const st = () => [h.SHF().jam, h.SHF().jar, h.run('drizzleStrokes'), h.shev().at(-1)], was = st();
      assert.deepEqual(was, [0, true, 1, 'empty:jam']);
      tap(h, h.sh().jarAt); assert.equal(h.sh().armed, true, 'this roti already has jam: the empty jar still gives a free stripe');
      tap(h, h.spots().radio); assert.equal(h.sh().armed, false, 'radio touched: the jam is back in the jar'); assert.equal(h.nodes.get('radioSheet').hidden, false, 'and the radio opens');
      h.run('eveRadio(false)'); h.frames(2);
      tap(h, h.sh().jarAt); assert.equal(h.sh().armed, true);
      tap(h, h.sh().jarAt); assert.equal(h.sh().armed, false, 'a second touch of the jar puts the jam back'); assert.equal(h.run('drizzleModeOn'), false);
      tap(h, h.sh().jarAt); assert.equal(h.sh().armed, true);
      tap(h, h.n().item); h.frames(20); assert.equal(h.n().open, 1, 'the notebook opens with the jam in the hand'); assert.equal(h.sh().armed, false);
      tap(h, h.n().leftPage); h.frames(20); assert.equal(h.n().open, 0);
      assert.deepEqual(st(), was, 'nothing spent, nothing drawn, the jar is not put away');
    }
    if (i === 1) {   // in the hand the stripe goes with the roti; under the open notebook it is not drawn
      const at = () => h.J(`(()=>{const out=[],m=ctx.moveTo;ctx.moveTo=(x,y)=>out.push({x,y});try{drizzleDraw(ctx)}finally{ctx.moveTo=m}return out[0]||null})()`);
      const a0 = at(); let p = grab(h); p = go(h, p, { x: p.x, y: p.y - 150 }); h.frames(2);
      assert.equal(h.run('nightCarried()'), true); const a1 = at(), k = h.J('cv.height/cv.getBoundingClientRect().height');
      assert.ok(a0.y - a1.y > 120 * k, `the stripe is drawn ${((a0.y - a1.y) / k).toFixed(0)} px higher with the roti carried 150 px up`);
      p = go(h, p, { x: p.x + 30, y: p.y + 160 }); drop(h, p); assert.equal(h.run('dish.mode'), 'cut', 'put back on the table');
      tap(h, h.n().item); h.frames(20); assert.equal(h.n().open, 1); assert.equal(at(), null, 'no stripe over the open notebook');
      tap(h, h.n().leftPage); h.frames(20); assert.ok(at(), 'the notebook is closed: the stripe is back');
    }
    serve(h); assert.equal(h.eve().rotiDone, i + 1); assert.equal(h.run('drizzleStrokes'), 0, 'the next roti is clean');
  }
  assert.deepEqual(levels, [19, 12.7, 6.3, 0], 'the level as drawn: full, two thirds, one third, empty');
  assert.equal(h.SHF().jam, 0); assert.equal(h.SHF().jar, true, 'the empty jar stays on the shelf');
  assert.deepEqual(h.shev(), ['use:jam', 'use:jam', 'use:jam', 'empty:jam']);
  assert.equal(h.shelfDrawn().glasses, 1);
  assert.equal(h.rects('shelfDraw(ctx,1,1,eveGeo());').filter(x => x.fill === '#3a2c1e').length, 3, 'three level marks on the jar');
  tap(h, h.sh().jarAt);
  assert.equal(h.SHF().jar, false, 'a touch puts the empty jar away'); assert.equal(h.shelfDrawn().glasses, 0); assert.equal(h.shev().at(-1), 'putaway:jar');
  // the notebook is not blocked by the touches of the jar (no finger is left hanging)
  tap(h, h.n().item); h.frames(20); assert.equal(h.n().open, 1, 'the notebook opens after the jam'); tap(h, h.n().leftPage);
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: `red of the jar, px: ${levels.join(' → ')}; stripe width ${h.stripeW.toFixed(1)} canvas px at 260 and 1100 px/s; journal ${h.shev().join(', ')}` };
});

test('S4', 'Som the next day: after a jam evening she comes with the empty jar (picture 1 with a jar), it lands on the shelf, a touch puts it away; after a nod evening she comes on the 5th second of frying and knocks at once', () => {
  // control: an ordinary evening — when she comes and when she knocks
  const c = shelf(); light(c); onPan(c);
  const c0 = until(c, 'GST.here'); const cT = c.run('dish.panTime'); const cK = until(c, 'guestPic()===2');
  assert.equal(c.run('gestures.filter(g=>g.kind==="guest"&&g.event==="arrive")[0].state'), undefined);
  // yesterday: a crunch → jam
  const h = shelf({ storage: saveNight(['crunch'], { sh: { jam: 3, jar: true } }) });
  lump(h); assert.equal(h.SHF().n, 2); assert.deepEqual(h.SHF().som, { jar: true, early: false }); assert.equal(h.SHF().jarIn, 'wait');
  light(h); onPan(h); until(h, 'GST.here');
  const hT = h.run('dish.panTime');
  assert.equal(h.sh().somJar, true, 'she is here with the jar'); assert.equal(h.pic(), 1);
  assert.equal(h.grows().find(g => g.event === 'arrive').state, 'jar');
  const S = h.gs().slot, inHand = () => h.rects('guestDraw(ctx,1,1,eveGeo());').filter(r => r.fill === '#8b7f6e' && r.x > S.x && r.x < S.x + S.w && r.h > 10);
  assert.equal(inHand().length, 1, 'picture 1 is drawn with an empty jar in her hand'); assert.equal(h.SHF().empty, false);
  const r = reloadS(h); assert.equal(r.SHF().jarIn, 'hand', 'the jar in her hand survives a reload');
  until(h, 'SHF.empty'); const landed = h.run('dish.panTime') - hT;
  assert.ok(landed > 2.9 && landed < 3.2, `the jar lands on the shelf after 3 s (${landed.toFixed(2)})`);
  assert.equal(inHand().length, 0, 'her hand is empty again'); assert.equal(h.sh().jarIn, 'shelf');
  assert.equal(h.shelfDrawn().glasses, 2, 'the empty jar stands next to the full one'); assert.equal(h.shelfDrawn().red, 19);
  assert.ok(h.sh().emptyAt.x > h.sh().jarAt.x + 20, 'side by side');
  tap(h, h.sh().emptyAt);
  assert.equal(h.SHF().empty, false, 'a touch puts the empty jar away'); assert.equal(h.shelfDrawn().glasses, 1); assert.equal(h.SHF().jam, 3, 'the full one is untouched');
  assert.deepEqual(h.shev(), ['bring:empty-jar', 'putaway:empty-jar']);
  // yesterday: a nod → bananas
  const e = shelf({ storage: saveNight(['nod'], { sh: { bananas: 2 } }) });
  lump(e); assert.deepEqual(e.SHF().som, { jar: false, early: true });
  light(e); onPan(e); until(e, 'GST.here');
  const eT = e.run('dish.panTime'), eK = until(e, 'guestPic()===2');
  assert.ok(eT >= 5 && eT < 5.1, `she comes on the 5th second of frying (${eT.toFixed(2)} s)`);
  assert.ok(cT >= 7.9, `the ordinary evening: on the 8th (${cT.toFixed(2)} s)`);
  assert.ok(eK <= 2, `and knocks at once (${eK} frames)`); assert.ok(cK >= 85, `ordinarily after 1.5 s (${cK} frames)`);
  assert.equal(e.grows().find(g => g.event === 'arrive').state, 'early'); assert.equal(e.sh().somJar, false);
  // a restart of the same evening from the radio keeps today's Som
  e.run('eveNewEvening("radio")'); assert.equal(e.SHF().n, 2); assert.deepEqual(e.SHF().som, { jar: false, early: true });
  for (const x of [c, h, e]) { assert.equal(x.run('loopErrs'), 0); assert.deepEqual(x.errors, []); }
  return { summary: `ordinary: arrives at ${cT.toFixed(2)} s, knocks ${cK} frames later; after a nod: ${eT.toFixed(2)} s and ${eK} frames; after jam: jar in hand ${landed.toFixed(2)} s, then on the shelf` };
});

test('S5', 'a new gift of the same kind refills, not adds; after 7 evenings the shelf has not grown', () => {
  const h = shelf({ storage: saveMid(0, { sh: { bananas: 1, jam: 1, jar: true } }) });
  h.run('shelfGift("bananas")'); assert.equal(h.SHF().bananas, 2, 'one banana left + a new bunch = one full bunch');
  h.run('shelfGift("bananas")'); assert.equal(h.SHF().bananas, 2);
  h.run('shelfGift("jam")'); h.run('shelfGift("jam")'); assert.equal(h.SHF().jam, 3); assert.equal(h.SHF().jar, true);
  h.frames(40);                                            // the gifts land on the shelf
  assert.deepEqual(h.shelfDrawn(), { bananas: 2, red: 19, glasses: 1, lids: 1 }, 'one bunch and one jar are drawn');
  assert.deepEqual(h.shev(), ['refill:bananas', 'refill:bananas', 'refill:jam', 'refill:jam']);
  // seven evenings in a row; script shortcut: every evening is written as finished with a nod and a crunch from Som (GST), her gifts go through shelfGift as in guestServe
  const g = shelf();
  const sizes = [];
  for (let n = 1; n <= 7; n++) {
    light(g); g.frames(2);
    g.run(`for(const a of ["nod","crunch"]){GST.answers.push({ballNo:1,crisp:1,step:1,answer:a});GST.gifts.push(GUEST_GIFT[a]);shelfGift(GUEST_GIFT[a]);}`);
    g.frames(40);              // the gifts land on the shelf
    g.run('SHF.empty=true;');   // the worst case: she has put an empty jar on the shelf and nobody put it away
    g.run('for(let i=0;i<3;i++) notebookSnap("counter"); EVE.ballsLeft=0; EVE.rotiDone=3; EVE.ball=false; eveLidEnd();'); g.frames(3);
    assert.equal(g.eve().over, true); assert.equal(g.SHF().n, n);
    const d = g.shelfDrawn(); sizes.push(d.bananas + '/' + d.glasses);
    assert.ok(g.SHF().bananas <= 2 && g.SHF().jam <= 3, 'never more than one bunch and one jar');
    assert.deepEqual(d, { bananas: 2, red: 19, glasses: 2, lids: 2 }, `night ${n}: a bunch, a jar and at most one empty jar`);
    lump(g);
  }
  assert.equal(g.SHF().n, 8); assert.equal(g.saved().n, 8);
  const F = g.J('(()=>{const G=eveGeo(),F=guestShelf(G);return {x0:F.x0,x1:F.x0+F.w,u:G.u}})()'), S = g.J('shelfGeo(eveGeo())');
  assert.ok(S.empty.x + 9 * F.u <= S.x1 + 0.5 && S.bunch.x - 12 * F.u >= F.x0 - 0.5, 'three places fit on the shelf plank');
  assert.ok(S.x1 <= g.J('(()=>{const G=eveGeo();return G.radio.x0+G.radio.w+48*G.u})()') + 0.5 && (S.empty.x - S.jar.x) / F.u >= 30 - 1e-6, 'the plank ends before the night cards; the jars stand 30 apart');
  assert.equal(g.NB().evenings.length, 7, 'the notebook keeps seven evenings');
  assert.ok(g.storage.get('roti_evening').length < 20000, 'the save does not grow without the pictures');
  assert.deepEqual(g.errors, []);
  return { summary: `seven nights, drawn bananas/jars: ${sizes.join(' ')}; n after the seventh lump ${g.SHF().n}` };
});

test('S6', '«начать вечер заново» in the radio restarts the current evening and keeps the shelf and the notebook; everything is wiped only by the button of the stand panel', () => {
  const h = shelf({ storage: saveMid(1, { n: 3, sh: { bananas: 1, jam: 2, jar: true, empty: true } }) });
  ball(h); assert.equal(h.eve().rotiDone, 2);
  const before = { sh: h.shelfDrawn(), pages: h.NB().evenings.length, first: JSON.stringify(h.NB().evenings[0]) };
  assert.equal(before.pages, 2, 'yesterday and today');
  tap(h, h.spots().radio); assert.equal(h.nodes.get('radioSheet').hidden, false);
  h.nodes.get('evRestart').fire('click'); h.nodes.get('evRestart').fire('click'); h.frames(3);
  assert.equal(h.eve().lamp, false); assert.equal(h.eve().ballsLeft, 3); assert.equal(h.eve().rotiDone, 0, 'the evening starts over');
  assert.equal(h.SHF().n, 3, 'the same evening, not the next'); assert.equal(h.saved().n, 3);
  assert.deepEqual(h.shelfDrawn(), before.sh, 'the shelf is untouched'); assert.deepEqual([h.SHF().bananas, h.SHF().jam, h.SHF().empty], [1, 2, true]);
  assert.equal(JSON.stringify(h.NB().evenings[0]), before.first, 'yesterday\'s page is untouched');
  assert.equal(h.NB().evenings.length, 1, 'only the page of the restarted evening starts afresh (step 3)');
  // a finished evening restarted from the radio: its page stays too
  const f = shelf({ storage: saveNight(['nod'], { n: 2, pages: 2, sh: { bananas: 2 } }) });
  f.run('eveNewEvening("radio")'); assert.equal(f.SHF().n, 2); assert.equal(f.NB().evenings.length, 2); assert.equal(f.SHF().bananas, 2);
  // a full notebook (7 finished evenings): a roti served and the evening restarted from the radio — all 7 pages stay
  const full = JSON.parse(saveMid(0, { n: 8 })[0][1]);
  full.notebook.evenings = Array.from({ length: 7 }, (_, i) => ({ ts: `2026-11-1${i}T12:00:00.000Z`, n: i + 1, snaps: ['som', 'som', 'dog'].map((to, k) => snapOf(to, k)) }));
  let p = shelf({ storage: [['roti_evening', JSON.stringify(full)]] });
  const seven = JSON.stringify(p.NB().evenings);
  ball(p); assert.equal(p.eve().rotiDone, 1); assert.equal(p.NB().evenings.length, 8, 'seven finished evenings and today');
  assert.equal(p.NB().evenings[7].n, 8, 'the page carries the number of its evening');
  p = reloadS(p); assert.equal(p.NB().evenings.length, 8, 'a reload keeps all eight'); assert.equal(p.n().pages, 8);
  p.run('eveNewEvening("radio")'); p.frames(2);
  assert.equal(JSON.stringify(p.NB().evenings), seven, 'the restart drops today\'s page only: the seven past evenings are all there');
  p.run('notebookSnap("counter"); EVE.ballsLeft=0; EVE.rotiDone=3; EVE.ball=false; eveLidEnd();'); p.frames(2); lump(p);
  assert.equal(p.SHF().n, 9); assert.equal(p.NB().evenings.length, 7, 'a finished evening pushes the oldest page out'); assert.equal(p.NB().evenings[6].n, 8);
  // Som's empty jar and the restart: delivered — not brought again (on the shelf or put away); still in her hand — brought again
  for (const [jarIn, empty, want] of [['shelf', true, 'shelf'], ['shelf', false, 'shelf'], ['hand', false, 'wait'], ['wait', false, 'wait']]) {
    const j = shelf({ storage: saveMid(0, { n: 2, som: { jar: true, early: false }, sh: { jarIn, empty } }) });
    j.run('eveNewEvening("radio")'); j.frames(2);
    assert.deepEqual([j.SHF().jarIn, j.SHF().empty], [want, empty], `restart with the jar «${jarIn}»: ${want}`);
    light(j); j.frames(3);
    const b = j.J('gestures.filter(g=>g.kind==="evening"&&g.event==="begin").at(-1)');
    assert.equal(b.n, 2); assert.equal(b.again, true, 'the journal marks the second begin of the same evening');
    assert.equal(j.shev().filter(e => e === 'bring:empty-jar').length, 0, 'no second bring');
  }
  { const j = shelf({ storage: saveNight(['nod'], { n: 1 }) }); lump(j); light(j); j.frames(3);
    assert.equal(j.J('"again" in gestures.filter(g=>g.kind==="evening"&&g.event==="begin").at(-1)'), false, 'a new evening is not «again»'); }
  // a finished evening restarted from the radio leaves a second page with the same n: yesterday is still the evening before
  const y = JSON.parse(saveNight(['nod'], { n: 2, pages: 2 })[0][1]);
  y.notebook.evenings.forEach((e, i) => { e.n = i + 1; });
  const yy = shelf({ storage: [['roti_evening', JSON.stringify(y)]] });
  yy.run('eveNewEvening("radio")'); light(yy); yy.frames(2); yy.run('notebookSnap("counter")');
  assert.deepEqual(yy.NB().evenings.map(e => e.n), [1, 2, 2]);
  assert.equal(JSON.stringify(yy.J('notebookYesterday()')), JSON.stringify(yy.NB().evenings[0].snaps), 'yesterday is the page of evening 1, not the first run of evening 2');
  // the wipe button exists, is hidden outside the stand panel by CSS, asks twice and wipes everything
  const css = fs.readFileSync(path.join(path.dirname(H.sourcePath), 'stand.css'), 'utf8');
  assert.match(css, /html:not\(\.dev\) #evWipe\{ display:none; \}/, 'the wipe button is hidden in the game');
  const w = h.nodes.get('evWipe'); assert.ok(w, 'index.html has the wipe button');
  w.fire('click'); assert.equal(h.SHF().bananas, 1, 'one press wipes nothing'); assert.match(w.textContent, /точно/);
  w.fire('click'); h.frames(2);
  assert.deepEqual([h.SHF().n, h.SHF().bananas, h.SHF().jam, h.SHF().jar, h.SHF().empty], [1, 0, 0, false, false], 'the shelf and the count of evenings are wiped');
  assert.equal(h.NB().evenings.length, 0, 'the notebook is wiped'); assert.equal(h.saved().n, 1); assert.equal(h.saved().notebook.evenings.length, 0);
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: `restart from the radio on evening 3: n stays 3, shelf ${JSON.stringify(before.sh)} kept, yesterday's page kept; wipe → n 1, empty shelf, empty notebook` };
});

test('S7', 'the night frame of evening 2 shows today with yesterday small beside it — three small cards without marks; evening 1 has none; a save of build 78 (no shelf block) carries its gifts over', () => {
  for (const [w, hh] of [[390, 844], [375, 667]]) {
    const h = shelf({ storage: saveNight(['nod', 'crunch'], { n: 2, pages: 2, sh: { bananas: 2, jam: 3, jar: true } }), w, hh }); h.frames(3);
    const N = h.ns(); assert.equal(N.frame, true); assert.equal(N.cards.length, 3); assert.equal(N.past.length, 3, 'yesterday: three cards');
    assert.ok(N.past.every(p => Math.abs(p.s - N.cards[0].s) < 1e-6), `yesterday is the same size (${N.past[0].s.toFixed(0)} against ${N.cards[0].s.toFixed(0)} px)`);
    assert.ok(N.past.every((p, i) => Math.abs(p.x - N.cards[i].x) < 1e-6), 'in the same columns as today');
    assert.ok(N.past[0].y > N.cards[0].markY, 'yesterday is a row below today');
    const F = h.J('(()=>{const G=eveGeo(),F=guestShelf(G),k=cv.getBoundingClientRect().width/cv.width;return {x1:(F.x0+F.w)*k,lamp:(G.lamp.x-G.lamp.s*1.15)*k,cy0:G.counter.y0*k}})()');
    assert.ok(N.past[0].x >= F.x1 && N.past[2].x + N.past[2].s <= F.lamp, `${w}×${hh}: the rows stand between the shelf and the lamp`);
    assert.ok(N.past[2].y + N.past[2].s <= F.cy0 && N.cards[0].markY <= F.cy0, 'above the counter');
    // marks (who got it) are drawn for today only: two Som (her cloth) and a dog; yesterday has no marks
    const cloth = h.drawn('nightDraw(ctx,1,1,eveGeo());').filter(e => e.fill === '#8a4b3c').length;
    assert.equal(cloth, 2, 'two Som marks — today\'s; yesterday has no marks');
    // yesterday is dimmed: a dark overlay sits over each yesterday card
    const pastCards = h.J('(()=>{const R=nightRow(eveGeo());return R.past.length})()');
    assert.equal(pastCards, 3);
    assert.equal(h.ngt().at(-1), 'frame:load'); assert.deepEqual(h.J('gestures.filter(g=>g.kind==="night").at(-1).yesterday'), ['som', 'som', 'dog']);
    assert.equal(h.run('eveningLive("")'), '', 'no words');
    if (w === 390) h.summary = `390×844: today ${N.cards[0].s.toFixed(0)} px, yesterday ${N.past[0].s.toFixed(0)} px`;
    else h.summary = `375×667: today ${N.cards[0].s.toFixed(0)} px, yesterday ${N.past[0].s.toFixed(0)} px`;
    results.sizes = (results.sizes || []).concat(h.summary);
    assert.deepEqual(h.errors, []);
  }
  const one = shelf({ storage: saveNight(['nod'], { n: 1, pages: 1 }) }); one.frames(3);
  assert.equal(one.ns().past.length, 0, 'evening 1: no yesterday');
  // a save written by build 78: no shelf, no n — the gifts of that evening are on the shelf, n is 1
  const old = JSON.parse(saveNight(['nod', 'crunch'])[0][1]); delete old.shelf; delete old.n;
  const o = shelf({ storage: [['roti_evening', JSON.stringify(old)]] }); o.frames(2);
  assert.deepEqual([o.SHF().n, o.SHF().bananas, o.SHF().jam, o.SHF().jar], [1, 2, 3, true]); assert.equal(o.saved().n, 1);
  return { summary: results.sizes.join(' · ') };
});

test('S8', 'without shelf.js the evening goes as in step 4 (bananas are not rationed, gifts on Som\'s shelf, the save keeps the shelf block); the build is 80', () => {
  const h0 = shelf({ storage: saveMid(0, { n: 4, sh: { bananas: 2, jam: 1, jar: true } }) });
  const s = h0.saved();
  const h = boot(TUNE, W, HH, { storage: [...h0.storage] });
  h.context.location.search = ''; h.context.document.readyState = 'complete';
  for (const f of sideScripts.filter(x => !x.file.endsWith('shelf.js'))) vm.runInContext(f.src, h.context, { filename: f.file, timeout: 10000 });
  h.J = code => JSON.parse(h.run(`JSON.stringify(${code})`)); h.eve = () => h.J('EVE'); h.spots = () => h.J('eveningSpots()');
  h.saved = () => JSON.parse(h.storage.get('roti_evening') || 'null');
  h.frames = (n = 1) => { for (let i = 0; i < n; i++) { h.advance(1000 / 60); h.run(FRAME); } };
  assert.equal(h.run('typeof shelfDraw'), 'undefined');
  onPan(h); h.frames(3); tap(h, sheetMid(h));
  assert.ok(heap(bananasOn(h)), 'no shelf.js: the banana heap is laid as before');
  finish(h); serve(h); assert.equal(h.eve().rotiDone, 1);
  assert.deepEqual(h.saved().shelf, s.shelf, 'the shelf block of the save is not lost'); assert.equal(h.saved().n, 4);
  const bn = h0.run('BUILD').match(/· (\d+)$/)[1];
  const html = fs.readFileSync(path.join(path.dirname(H.sourcePath), 'index.html'), 'utf8');
  assert.match(html, /night\.js\?v=[^"]*"><\/script>\s*<script src="shelf\.js\?v=[^"]*"/, 'index.html loads shelf.js after night.js');
  assert.match(html, new RegExp('stand\\.js\\?v=[^"]*b' + bn + '[a-z]?"'));   // a letter: a fix round of the same build (85b)
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: 'evening.js + guest.js + notebook.js + night.js alone: banana laid, save.shelf and n kept; BUILD ' + h0.run('BUILD').split('·').pop().trim() };
});

test('S9', 'the gift flies from Som to its shelf place in one straight move of 0.6 s and is saved at once — a reload mid-flight does not lose it', () => {
  const h = shelf(); light(h);
  onPan(h); arrive(h); finish(h); serve(h, h.gs().som);          // a short fry → nod → bananas
  assert.equal(h.g().answers[0].answer, 'nod');
  assert.equal(h.SHF().bananas, 2, 'the bunch is on the shelf at once (saved)');
  const f = h.sh().flight;
  assert.ok(f && f.gift === 'bananas' && f.dur === 0.6, 'the gift is flying');
  assert.ok(f.t < f.dur, 'still on the way');
  const S = h.J('shelfGeo(eveGeo())'), G = h.J('guestSlot(eveGeo())');
  assert.ok(Math.hypot(f.from.x - (G.x0 + G.w / 2), f.from.y - (G.y0 + G.h * 0.6)) < 1e-6, 'starts at Som');
  assert.ok(Math.hypot(f.to.x - S.bunch.x, f.to.y - S.bunch.y) < 1e-6, 'goes to the bunch place');
  // a reload mid-flight: the gift is not lost, and after the reload the flight is over
  const r = reloadS(h);
  assert.equal(r.SHF().bananas, 2, 'the gift survives the reload');
  assert.equal(r.sh().flight, null, 'after a reload the flight is over');
  assert.equal(r.shelfDrawn().bananas, 2, 'and the bunch is drawn on the shelf');
  // in h the flight finishes by itself: gone, the bunch sits on the shelf
  sec(h, 0.5);
  assert.equal(h.sh().flight, null, 'the flight is over after 0.6 s');
  assert.equal(h.shelfDrawn().bananas, 2);
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: `gift flies ${f.dur} s from Som to the bunch place; saved at once, kept across a reload` };
});

const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\nsecond-evening: ${passed}/${results.length} passed`);
try {
  const dir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'second-evening-results.json'), JSON.stringify({ source: H.sourcePath, sha256: H.sourceSha256, passed, total: results.length, results }, null, 2));
} catch (e) { console.log('report not written: ' + e.message); }
process.exit(passed === results.length ? 0 : 1);
