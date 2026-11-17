#!/usr/bin/env node
'use strict';
// v0 step 3 — the notebook (docs/v0-step3-notebook.md): every served roti leaves a snapshot with who
// ate it (Som or the counter) in the evening save; the notebook lies on the cart by the radio, a touch
// opens the sheet, a touch anywhere closes it; while it is open frying stands (fryHold) and Som waits;
// it opens by itself once per evening — after Som's first answer, for 1.2 s; arrows and swipes page
// through the last 7 evenings; the screen wake lock is held while the lamp is lit.
// Pure Node/vm with the mocks of model-regression.cjs: stand.js, banana.js, egg.js, evening.js,
// guest.js and notebook.js run in ONE context in the order of index.html. Every action of the player
// goes through the stand's real window touch handlers. This is not a browser: the mock canvas has no
// toDataURL, so real JPEG weight and the look of the pages are live questions (N1 fakes toDataURL to
// check the 30 KB rule only).
//   node prototype/dough-closeup/checks/notebook-regression.cjs path/to/stand.js [--only N1,N3]
// ALWAYS pass the stand.js of the checkout under test as the first argument. Report:
// runs/checks/notebook-results.json of the checkout (runs/ is not in git).
// Script shortcuts, named where used: the dough of every ball is set to the stretch target (as in
// guest-regression.cjs); past evenings for paging are written into the save by script.
// The helpers below are the ones of guest-regression.cjs (kept in step by hand).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const H = require('./model-regression.cjs');
const { boot, lcg } = H;
// the scripts index.html loads after stand.js, in its order (drizzle.js and counter-item.js draw only)
const sideScripts = ['banana.js', 'egg.js', 'evening.js', 'guest.js', 'notebook.js'].map(f => ({ file: path.join(path.dirname(H.sourcePath), f), src: fs.readFileSync(path.join(path.dirname(H.sourcePath), f), 'utf8') }));
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

// ── checks ────────────────────────────────────────────────────────────────────────────────────
test('N1', 'every serve leaves a snapshot with who ate it; it is in the evening save and survives a reload; a shot over 30 KB is recompressed', () => {
  const h = nb(); light(h);
  assert.deepEqual(h.NB(), { v: 1, cur: false, peeked: false, evenings: [] });
  fakeShots(h, q => q >= 0.7 ? 41 : q >= 0.5 ? 29.5 : 12);
  onPan(h); arrive(h); finish(h); serve(h, h.gs().som);
  let N = h.NB();
  assert.equal(N.cur, true); assert.equal(N.evenings.length, 1);
  assert.equal(N.evenings[0].snaps.length, 1); assert.equal(N.evenings[0].snaps[0].to, 'som');
  const img = N.evenings[0].snaps[0].img;
  assert.ok(img.startsWith('data:image/jpeg;base64,'));
  assert.deepEqual(h.context.__shots, [0.72, 0.58], 'the 41 KB shot is tried again at a lower quality');
  const kb = h.run('nbKb(NB.evenings[0].snaps[0].img)');
  assert.ok(kb <= 30 && kb > 29, `kept at ${kb} KB`);
  assert.deepEqual(h.J('gestures.slice(-6).map(g=>g.kind+(g.event?"/"+g.event:""))'), ['serve', 'pan', 'guest/serve', 'guest/answer', 'notebook/snap', 'evening/serve'], 'the snapshot is taken before the stand is reset');
  assert.equal(h.saved().notebook.evenings[0].snaps[0].img, img, 'saved in roti_evening');
  sec(h, 5);
  // the second roti goes to the counter; no shot fits 30 KB → the record stays without a picture
  fakeShots(h, () => 64);
  nextBall(h); onPan(h); finish(h); serve(h, h.spots().counter);
  N = h.NB();
  assert.deepEqual(N.evenings[0].snaps.map(s => s.to), ['som', 'counter']);
  assert.equal(N.evenings[0].snaps[1].img, null); assert.equal(h.context.__shots.length, 4, 'all four qualities were tried');
  assert.equal(typeof N.evenings[0].snaps[1].crisp, 'number'); assert.equal(typeof N.evenings[0].snaps[1].step, 'number');
  const r = reloadN(h);
  assert.deepEqual(r.NB(), N, 'the notebook survives a reload');
  assert.deepEqual(r.J('notebookEvening().map(s=>s.to)'), ['som', 'counter']);
  // the exported log carries no pictures
  const log = JSON.parse(h.run('playLogText()'));
  assert.equal(JSON.stringify(log.evening.notebook).includes('base64'), false);
  assert.deepEqual(log.evening.notebook.state.evenings[0].snaps.map(s => s.to), ['som', 'counter']);
  // Node's mock canvas has no toDataURL: the serve still goes through, the record has no picture
  const p = nb(); light(p); ball(p);
  assert.equal(p.eve().rotiDone, 1); assert.deepEqual(p.NB().evenings[0].snaps.map(s => [s.to, s.img]), [['counter', null]]);
  assert.deepEqual(p.errors, []);
  // the stand mode has no notebook
  const d = nb({ search: '?dev=1' }); tap(d, d.n().item); assert.equal(d.n().open, 0);
  return { summary: `shot qualities tried ${h.context.__shots.slice(0, 2).join(', ')} → ${kb} KB kept; events ${h.nev().join(' ')}` };
});

test('N2', 'a touch on the notebook opens the sheet, a touch anywhere closes it; while open the lamp, bowl and table are silent; the radio keeps its own spot', () => {
  const h = nb();
  let S = h.n();
  assert.equal(S.open, 0); assert.equal(h.run('notebookOpen()'), false);
  const E = h.spots();
  assert.ok(S.item.x > E.radio.x + 20, 'the notebook lies to the right of the radio');
  // before the lamp: the notebook opens (yesterday's things can be touched), the lamp under it is silent
  tap(h, S.item);
  assert.equal(h.n().open, 1); assert.equal(h.run('notebookOpen()'), true);
  h.frames(20); assert.equal(h.n().anim, 1, 'the sheet is fully out after 0.18 s');
  assert.equal(h.run('eveningLive("x")'), '', 'no words while it is open');
  tap(h, E.lamp); assert.equal(h.eve().lamp, false, 'the touch closed the notebook, the lamp did not light');
  assert.equal(h.n().open, 0); h.frames(20); assert.equal(h.n().anim, 0);
  light(h); assert.equal(h.eve().lamp, true);
  // the radio still opens by its own spot; the notebook does not open under the radio sheet
  tap(h, E.radio); assert.equal(h.nodes.get('radioSheet').hidden, false); assert.equal(h.n().open, 0);
  tap(h, S.item); assert.equal(h.n().open, 0, 'under the radio sheet the notebook is silent');
  h.nodes.get('evClose').fire('click');
  // a touch between the radio and the notebook goes to the nearer one
  const mid = (E.radio.x + S.item.x) / 2;
  tap(h, { x: mid + 3, y: S.item.y }); assert.equal(h.n().open, 1); tap(h, E.work); assert.equal(h.n().open, 0);
  tap(h, { x: mid - 3, y: S.item.y }); assert.equal(h.n().open, 0); assert.equal(h.nodes.get('radioSheet').hidden, false);
  h.nodes.get('evClose').fire('click');
  // open over a ball in work: the table, the bowl and the tava do not answer
  stretched(h);
  tap(h, S.item); assert.equal(h.n().open, 1);
  h.frames(20);
  const n0 = h.run('gestures.filter(g=>g.kind!=="notebook").length'), sheet = h.n().sheet;
  assert.ok(sheet.y0 > h.spots().counterBottom, 'the sheet leaves Som and the counter in view');
  h.touch('start', 't1', E.work.x, E.work.y); h.frames(3);
  assert.equal(h.run('action.state'), 'RESTING', 'the dough under the sheet is not touched');
  h.touch('end', 't1', E.work.x, E.work.y); h.frames(3);
  assert.equal(h.n().open, 0, 'that touch closed it');
  assert.equal(h.run('gestures.filter(g=>g.kind!=="notebook").length'), n0);
  // drawing: closed, sliding, open — without errors
  tap(h, S.item); h.tick(2, 1 / 60, true); h.frames(20); h.tick(2, 1 / 60, true);
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  assert.deepEqual(h.nev().slice(0, 4), ['open:touch', 'close:touch', 'open:touch', 'close:touch']);
  assert.equal(typeof h.J('gestures.filter(g=>g.kind==="notebook"&&g.event==="close")[0].seconds'), 'number');
  assert.equal(h.saved().notebook.events.length, h.nev().length, 'the notebook journal is in the save');
  return { summary: `item at ${Math.round(S.item.x)},${Math.round(S.item.y)} (radio ${Math.round(E.radio.x)}); sheet top ${Math.round(sheet.y0)}, height ${Math.round(sheet.h)}; events ${h.nev().join(' ')}` };
});

test('N3', 'while the notebook is open frying stands for 10 s and Som does not come or knock; closed — frying goes on; a hidden page closes it and the lid takes over', () => {
  const h = nb(); light(h); onPan(h); h.frames(60);
  const a = cookNow(h);
  assert.ok(a.t < 8, 'she has not come yet');
  tap(h, h.n().item);
  assert.equal(h.n().open, 1); assert.equal(h.run('fryHold'), true);
  h.frames(600);
  const b = cookNow(h);
  assert.deepEqual({ ...b, t: +b.t.toFixed(3) }, { ...a, t: +a.t.toFixed(3) }, 'nothing fries for 10 s');
  assert.equal(h.g().here, false, 'Som does not come while it is open');
  tap(h, h.spots().work);
  assert.equal(h.n().open, 0); assert.equal(h.run('fryHold'), false); assert.equal(h.eve().lid, false);
  h.frames(600);
  const c = cookNow(h);
  assert.ok(c.t - b.t > 9.9 && (c.dry > b.dry || c.cook > b.cook), 'frying goes on after it is closed');
  assert.equal(h.g().here, true, 'and she comes');
  // her knock does not run under the open notebook: the tava stands, the knock comes after
  const q = nb(); light(q); onPan(q); until(q, 'GST.here');
  tap(q, q.n().item); sec(q, 5);
  assert.equal(q.pic(), 1); assert.equal(q.run('panKnock'), 0); assert.deepEqual(q.gev(), ['arrive']);
  tap(q, q.spots().work); until(q, 'guestPic()===2', 200);
  assert.deepEqual(q.gev(), ['arrive', 'knock']);
  // hidden page with the notebook open: it closes, the lid lies on the frying tava and holds on
  tap(q, q.n().item); assert.equal(q.n().open, 1);
  q.visibility(true);
  assert.equal(q.n().open, 0); assert.equal(q.eve().lid, true); assert.equal(q.run('fryHold'), true);
  q.visibility(false);
  assert.equal(q.nev().at(-1), 'close:hidden');
  // under the lid the notebook still opens and closing it keeps the lid's pause
  tap(q, q.n().item); assert.equal(q.n().open, 1); tap(q, q.spots().work);
  assert.equal(q.n().open, 0); assert.equal(q.run('fryHold'), true, 'the lid still holds the frying');
  return { summary: `open 10 s: dry ${a.dry.toFixed(4)}→${b.dry.toFixed(4)}, cook ${a.cook.toFixed(4)}→${b.cook.toFixed(4)}, pan time ${a.t.toFixed(2)}→${b.t.toFixed(2)} s; closed 10 s: pan time ${c.t.toFixed(2)} s, cook ${c.cook.toFixed(4)}` };
});

test('N4', 'it opens by itself once per evening: after Som\'s first answer, for 1.2 s; a touch then closes it and reaches the table; not after the second answer, not after a reload, not for a counter roti', () => {
  const h = nb(); light(h);
  onPan(h); arrive(h); finish(h); serve(h, h.gs().som);
  assert.equal(h.n().open, 0, 'not during her answer');
  let n = 0; while (!h.n().open && n < 400) { h.frames(1); n++; }
  assert.equal(h.n().open, 2, 'it peeks open');
  assert.equal(h.pic(), 1, 'her answer has been shown in full');
  assert.equal(h.run('fryHold'), true);
  let m = 0; while (h.n().open && m < 400) { h.frames(1); m++; }
  assert.ok(Math.abs(m / 60 - 1.2) < 0.05, `open for 1.2 s (${(m / 60).toFixed(2)} s)`);
  assert.equal(h.run('fryHold'), false);
  assert.deepEqual(h.nev(), ['snap:som', 'open:peek', 'close:auto']);
  assert.equal(h.NB().peeked, true); assert.equal(h.saved().notebook.peeked, true);
  sec(h, 5); assert.equal(h.n().open, 0, 'never again by itself');
  // not after a reload
  const r = reloadN(h); sec(r, 5); assert.equal(r.n().open, 0); assert.deepEqual(r.nev(), ['snap:som', 'open:peek', 'close:auto'], 'no second peek after a reload');
  // not after the second answer
  nextBall(h); onPan(h); until(h, 'guestPic()===1&&GST.here'); finish(h); serve(h, h.gs().som);
  assert.equal(h.g().answers.length, 2); sec(h, 6);
  assert.deepEqual(h.nev(), ['snap:som', 'open:peek', 'close:auto', 'snap:som']);
  // a touch during the peek closes it and goes on to the scene: the bowl gives the next ball
  const p = nb(); light(p); onPan(p); arrive(p); finish(p); serve(p, p.gs().som);
  until(p, 'notebookSpots().open===2'); p.frames(6);
  tap(p, p.spots().bowl);
  assert.equal(p.n().open, 0); assert.equal(p.eve().ball, true, 'the peek does not eat the touch');
  assert.deepEqual(p.nev(), ['snap:som', 'open:peek', 'close:pass']);
  // a finger on the screen holds the peek back; it comes when the finger is lifted
  const f = nb(); light(f); onPan(f); arrive(f); finish(f); serve(f, f.gs().som);
  nextBall(f); const w = f.spots().work;
  f.touch('start', 't1', w.x, w.y); sec(f, 5);
  assert.equal(f.n().open, 0, 'not under a finger');
  f.touch('end', 't1', w.x, w.y); f.frames(3);
  assert.equal(f.n().open, 2);
  // a roti put on the counter (Som did not get it) does not open it
  const c = nb(); light(c); ball(c); sec(c, 6);
  assert.deepEqual(c.nev(), ['snap:counter']);
  // the next evening it may open once again
  assert.equal(h.run('(notebookNewEvening("lump",true),NB.peeked)'), false);
  return { summary: `peek ${(n / 60).toFixed(2)} s after the serve, open ${(m / 60).toFixed(2)} s; events ${h.nev().join(' ')}` };
});

test('N5', 'paging: arrows and swipes between evenings, an arrow only where there is an evening; the eighth evening pushes the first out', () => {
  const h = nb({ storage: saveWith([1, 2, 3].map(i => pastEvening(i))) });
  tap(h, h.n().item); h.frames(20);
  let S = h.n();
  assert.equal(S.pages, 4, 'three past evenings and this one'); assert.equal(S.page, 3, 'it opens on this evening');
  assert.deepEqual(S.snaps, [], 'nothing served yet: the right page is empty, no frames');
  assert.equal(S.next, null, 'no arrow forward'); assert.ok(S.prev, 'an arrow back');
  tap(h, S.prev); S = h.n();
  assert.equal(S.open, 1, 'the arrow does not close it'); assert.equal(S.page, 2);
  assert.deepEqual(S.snaps.map(s => s.to), ['som', 'counter']);
  assert.ok(S.next && S.prev);
  // swipe right → the evening before; swipe left → the next one
  const y = S.sheet.y0 + S.sheet.h * 0.4;
  drive(h, line({ x: 120, y }, { x: 260, y }, { v: 500, hold: 30 }), { settle: 5 }); assert.equal(h.n().page, 1);
  drive(h, line({ x: 120, y }, { x: 260, y }, { v: 500, hold: 30 }), { settle: 5 }); assert.equal(h.n().page, 0);
  assert.equal(h.n().prev, null, 'the first evening has no arrow back');
  drive(h, line({ x: 120, y }, { x: 260, y }, { v: 500, hold: 30 }), { settle: 5 });
  assert.equal(h.n().page, 0); assert.equal(h.n().open, 1, 'a swipe past the end changes nothing and does not close');
  drive(h, line({ x: 260, y }, { x: 120, y }, { v: 500, hold: 30 }), { settle: 5 }); assert.equal(h.n().page, 1);
  tap(h, h.n().next); assert.equal(h.n().page, 2);
  // a vertical move is a touch: it closes
  drive(h, line({ x: 200, y }, { x: 205, y: y + 90 }, { v: 500, hold: 30 }), { settle: 5 }); assert.equal(h.n().open, 0);
  tap(h, h.n().item); assert.equal(h.n().page, 3, 'it opens on this evening again');
  tap(h, { x: 200, y: 60 });
  assert.deepEqual(h.nev().filter(e => e === 'page').length, 5);
  h.tick(2, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  // seven past evenings in the save; one roti tonight → the oldest is gone
  const e = nb({ storage: saveWith([1, 2, 3, 4, 5, 6, 7].map(i => pastEvening(i))) });
  assert.equal(e.NB().evenings.length, 7);
  light(e); ball(e);
  const N = e.NB();
  assert.equal(N.evenings.length, 7, 'seven evenings are kept');
  assert.equal(N.evenings[0].ts, pastEvening(2).ts, 'the first one is pushed out');
  assert.deepEqual(N.evenings[6].snaps.map(s => s.to), ['counter']);
  assert.ok(N.evenings.reduce((s, x) => s + x.snaps.length, 0) <= 21);
  // nine evenings in a save (written by an older rule or by hand) are cut to seven on load; a broken record is dropped
  const big = nb({ storage: saveWith([1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => pastEvening(i, i === 9 ? 5 : 2)).concat([{ ts: 'x', snaps: [{ to: 'dog' }] }])) });
  assert.equal(big.NB().evenings.length, 7); assert.equal(big.NB().evenings.at(-1).snaps.length, 3);
  return { summary: `pages ${S.pages}; kept ${N.evenings.length} evenings, ${N.evenings.reduce((s, x) => s + x.snaps.length, 0)} snapshots after the eighth` };
});

test('N6', '«начать вечер заново» mid-evening erases this evening\'s snapshots and keeps the past ones; a finished evening stays as a page', () => {
  const h = nb({ storage: saveWith([pastEvening(1)]) }); light(h);
  ball(h);
  assert.equal(h.NB().evenings.length, 2); assert.equal(h.NB().cur, true);
  tap(h, h.spots().radio); h.nodes.get('evRestart').fire('click'); h.nodes.get('evRestart').fire('click');
  let N = h.NB();
  assert.equal(N.cur, false); assert.equal(N.evenings.length, 1, 'tonight\'s page is gone');
  assert.equal(N.evenings[0].ts, pastEvening(1).ts, 'the past evening stays');
  assert.equal(h.saved().notebook.evenings.length, 1);
  // a whole evening to the lid, then the lump: the finished evening is a page, the new one starts empty
  light(h);
  for (let i = 0; i < 3; i++) { if (i) nextBall(h); ball(h); }
  assert.deepEqual(h.J('notebookEvening().map(s=>s.to)'), ['counter', 'counter', 'counter']);
  let S = h.spots(); drive(h, line(S.lid, S.pan, { v: 300 }));
  assert.equal(h.eve().over, true);
  // the notebook opens at night too; the lump under the sheet does not start the evening
  tap(h, h.n().item); assert.equal(h.n().open, 1); assert.equal(h.n().snaps.length, 3);
  tap(h, S.lump); assert.equal(h.n().open, 0); assert.equal(h.eve().over, true);
  tap(h, S.lump);
  assert.equal(h.eve().over, false);
  N = h.NB();
  assert.equal(N.cur, false); assert.equal(N.evenings.length, 2); assert.equal(N.evenings[1].snaps.length, 3);
  assert.deepEqual(h.J('notebookEvening()'), []);
  tap(h, h.n().item); S = h.n();
  assert.equal(S.pages, 3); assert.deepEqual(S.snaps, []); tap(h, S.prev); assert.equal(h.n().snaps.length, 3);
  // restart from the radio after a finished evening keeps that evening too
  const f = reloadN(h); light(f); ball(f);
  f.run('eveLidEnd()'); tap(f, f.spots().radio); f.nodes.get('evRestart').fire('click'); f.nodes.get('evRestart').fire('click');
  assert.equal(f.NB().evenings.length, 3, 'a finished evening is not erased by the radio');
  return { summary: `after restart ${1} evening kept; after a full evening ${N.evenings.length} pages, tonight empty` };
});

test('N7', 'screen wake lock: asked when the lamp is lit, asked again after the page comes back, released at the end of the evening; harmless without navigator.wakeLock or when refused', () => {
  // the mock answers at once (a thenable that calls back synchronously)
  const mock = h => {
    const W = { asked: [], released: 0, locks: [] };
    h.context.navigator.wakeLock = { request(type) { W.asked.push(type); const lock = { listeners: [], release() { W.released++; }, addEventListener(t, f) { this.listeners.push(f); } }; W.locks.push(lock); return { then(ok) { ok(lock); } }; } };
    return W;
  };
  const h = nb(); const W = mock(h);
  tap(h, h.spots().bowl); assert.deepEqual(W.asked, [], 'not before the lamp');
  light(h);
  assert.deepEqual(W.asked, ['screen'], 'asked when the lamp is lit');
  assert.equal(h.run('!!eveWake'), true);
  stretched(h); h.frames(120); h.run('eveSave();eveSave();');
  assert.equal(W.asked.length, 1, 'held once, not asked again');
  // the page is hidden: the system releases the lock itself; back — asked again
  h.visibility(true); W.locks[0].listeners.forEach(f => f());
  assert.equal(h.run('!!eveWake'), false); assert.equal(W.asked.length, 1, 'not asked while hidden');
  h.visibility(false);
  assert.equal(W.asked.length, 2, 'asked again when the page is visible'); assert.equal(h.run('!!eveWake'), true);
  // the evening is over → released
  h.run('EVE.ball=false;EVE.ballsLeft=0;EVE.rotiDone=3;eveFreshLump();sheetHidden=true;eveSave();');   // script shortcut: three roti done
  const S = h.spots(); assert.equal(S.lidHome, true);
  const before = W.released;
  drive(h, line(S.lid, S.pan, { v: 300 }));
  assert.equal(h.eve().over, true); assert.equal(W.released, before + 1, 'released when the lamp goes out'); assert.equal(h.run('!!eveWake'), false);
  tap(h, h.spots().lump); assert.equal(W.asked.length, 2, 'dusk: not asked');
  light(h); assert.equal(W.asked.length, 3, 'the next evening asks again');
  // a reload with the lamp lit asks at once
  const r = reloadN(h, {}); assert.equal(r.eve().lamp, true);
  const W2 = mock(r); r.run('eveSave()'); assert.deepEqual(W2.asked, ['screen']);
  // the stand mode does not hold the screen
  const d = nb({ search: '?dev=1' }); const W3 = mock(d); d.run('EVE.lamp=true;eveSave()'); assert.deepEqual(W3.asked, []);
  // no wakeLock at all (the mock navigator is {}), a refusal, a throw: nothing breaks
  const p = nb(); light(p); assert.equal(p.eve().lamp, true); assert.deepEqual(p.errors, []);
  const q = nb(); let refused = 0;
  q.context.navigator.wakeLock = { request() { refused++; return { then(ok, no) { no(new Error('NotAllowedError')); } }; } };
  light(q); stretched(q); assert.equal(q.eve().lamp, true); assert.equal(q.run('!!eveWake'), false); assert.ok(refused >= 1);
  const t = nb(); t.context.navigator.wakeLock = { request() { throw new Error('boom'); } };
  light(t); assert.equal(t.eve().lamp, true); assert.deepEqual(t.errors, []);
  return { summary: `asked ${W.asked.length} times (lamp, back from hidden, next evening), released ${W.released}; refusals survived ${refused}` };
});

test('N8', '390×844 and 375×667: the notebook lies on the counter clear of the radio and of Som, the sheet and its cells stay inside the canvas, everything draws', () => {
  const out = [];
  for (const [w, hh] of [[390, 844], [375, 667]]) {
    const h = nb({ w, hh, storage: saveWith([pastEvening(1, 3)]) }); light(h);
    const S = h.n(), E = h.spots(), G = h.gs();
    assert.ok(S.itemBox.x >= E.radio.x + 20 && S.itemBox.x + S.itemBox.w <= G.slot.x, `the notebook sits between the radio and her picture (${S.itemBox.x.toFixed(0)}…${(S.itemBox.x + S.itemBox.w).toFixed(0)}, slot from ${G.slot.x.toFixed(0)})`);
    assert.ok(S.itemBox.y + S.itemBox.h <= E.counter.y, 'it stands on the top edge of the counter');
    assert.ok(S.itemBox.w >= 28 && S.itemBox.h >= 20);
    tap(h, S.item); h.frames(20); tap(h, h.n().prev);
    const O = h.n();
    assert.equal(O.snaps.length, 3);
    assert.ok(O.sheet.x0 >= 0 && O.sheet.x1 <= w && O.sheet.y0 > E.counterBottom && Math.abs(O.sheet.y0 + O.sheet.h - hh) < 1, 'the sheet lies at the bottom, under the counter');
    for (const s of O.snaps) {
      assert.ok(s.s >= 84, `a snapshot is at least 84 px (${s.s.toFixed(0)})`);
      assert.ok(s.x - s.s / 2 > w / 2 && s.x + s.s / 2 < O.sheet.x1 - 30 && s.y - s.s / 2 > O.sheet.y0 && s.y + s.s / 2 < hh - 30, 'inside the right page, above the arrows');
    }
    assert.ok(O.snaps[1].y - O.snaps[0].y >= O.snaps[0].s, 'snapshots do not overlap');
    assert.ok(O.leftPage.x < w / 2);
    h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
    out.push(`${w}×${hh}: item ${Math.round(S.itemBox.x)}…${Math.round(S.itemBox.x + S.itemBox.w)} × ${Math.round(S.itemBox.y)}…${Math.round(S.itemBox.y + S.itemBox.h)}, sheet top ${Math.round(O.sheet.y0)}, snapshot ${Math.round(O.snaps[0].s)} px`);
  }
  return { summary: out.join(' · ') };
});

const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\nnotebook: ${passed}/${results.length} passed`);
try {
  const dir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'notebook-results.json'), JSON.stringify({ source: H.sourcePath, sha256: H.sourceSha256, passed, total: results.length, results }, null, 2));
} catch (e) { console.log('report not written: ' + e.message); }
process.exit(passed === results.length ? 0 : 1);
