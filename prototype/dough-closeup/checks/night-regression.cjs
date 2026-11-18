#!/usr/bin/env node
'use strict';
// v0 step 4 — the third ball and the night (docs/v0-step4-night.md): a dog sleeps under the cart at the
// bottom left; a cut roti released over it goes to the dog (evening serve to:"dog", a snapshot marked
// "dog") — from the third ball on, and earlier whenever Som does not take the roti; the only hint is the
// pose (head up while the roti in the hand is above the lower third of the screen); after the lid the
// night frame shows the three snapshots of the evening with who got each, the shelf with the gifts and the
// dough lump, no words; an app opened after a closed evening opens on the same night frame.
// Pure Node/vm with the mocks of model-regression.cjs: stand.js, banana.js, egg.js, evening.js, guest.js,
// notebook.js and night.js run in ONE context in the order of index.html. Every action of the player goes
// through the stand's real window touch handlers. This is not a browser: how the dog and the cards look is
// a live question.
//   node prototype/dough-closeup/checks/night-regression.cjs path/to/stand.js [--only D1,D3]
// ALWAYS pass the stand.js of the checkout under test as the first argument. Report:
// runs/checks/night-results.json of the checkout (runs/ is not in git).
// Script shortcuts, named where used: the dough of every ball is set to the stretch target (as in
// guest-regression.cjs); D1, D4 and D5 start from a save written by script (a third ball in work, Som gone).
// The helpers below are the ones of notebook-regression.cjs (kept in step by hand).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const H = require('./model-regression.cjs');
const { boot, lcg } = H;
// the scripts index.html loads after stand.js, in its order (drizzle.js and counter-item.js draw only)
const sideScripts = ['banana.js', 'egg.js', 'evening.js', 'guest.js', 'notebook.js', 'night.js'].map(f => ({ file: path.join(path.dirname(H.sourcePath), f), src: fs.readFileSync(path.join(path.dirname(H.sourcePath), f), 'utf8') }));
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

// ── checks ────────────────────────────────────────────────────────────────────────────────────
test('D1', 'third ball: the dog sleeps, lifts its head once the roti in the hand is above the lower third and keeps it up; released over the dog the roti is its — serve to:"dog", a snapshot marked dog, nothing on the counter; it eats, then sleeps; the count survives a reload', () => {
  const h = night({ storage: saveAt(2) });
  assert.equal(h.eve().ball, true); assert.equal(h.ns().pose, 0); assert.equal(h.ns().wants, true, 'third ball: the dog takes it');
  onPan(h); envelope(h); toTable(h);
  // an uncut roti cannot be given, and a stroke from its middle into the dog's corner is an ordinary cut stroke
  // (review of step 4: it was refused with "cut first"); the same stroke up to the counter is still refused
  { const c = rotiBox(h).c; drive(h, line(c, h.spots().counter, { v: 420, hold: 80 }), { settle: 30 }); }
  assert.match(h.run('dish.message'), /^Сначала разрежь/, 'uncut, from the middle to the counter: "cut first"'); assert.equal(h.run('dish.cuts.length'), 0);
  h.run('dish.message=""');
  { const c = rotiBox(h).c; drive(h, line(c, h.ns().dog, { v: 420, hold: 80 }), { settle: 30 }); }
  assert.doesNotMatch(h.run('dish.message'), /^Сначала разрежь/, 'uncut, from the middle to the dog: not refused');
  assert.equal(h.run('dish.cuts.length'), 1, 'it cuts, as before step 4');
  assert.equal(h.eve().rotiDone, 2, 'an uncut roti is not served to the dog'); assert.equal(h.run('dish.mode'), 'cut'); assert.equal(h.NGT().dog, 0);
  assert.equal(h.run('eveningLive("Разрезов: 1")'), 'нарезано · возьми за середину и неси', 'no "to the counter" in the words while the dog takes the roti too');
  const S = h.ns();
  { const r = h.J('(()=>{const r=cv.getBoundingClientRect();return {top:r.top,height:r.height}})()'); S.lookY = r.top + r.height * 2 / 3; }   // the line of the spec, counted here — not read from night.js
  let p = grab(h);
  assert.ok(p.y > S.lookY, `the roti lies in the lower third (${p.y.toFixed(0)} > ${S.lookY.toFixed(0)})`);
  p = go(h, p, { x: p.x, y: S.lookY + 12 });
  assert.equal(h.run('nightCarried()'), true, 'the roti is in the hand'); assert.equal(h.ns().pose, 0, 'below the line the dog sleeps');
  p = go(h, p, { x: p.x, y: S.lookY - 14 }); h.frames(2);
  assert.equal(h.ns().pose, 1, 'above the lower third the dog lifts its head');
  p = go(h, p, { x: p.x, y: S.lookY + 60 }); h.frames(2);
  assert.equal(h.ns().pose, 1, 'the head stays up while the roti is in the hand');
  assert.equal(h.run('eveningLive(dish.message)'), 'в руке — неси и отпусти');
  // over the roti the dog is drawn on a flat dark silhouette of itself, a little wider (the fur is nearly the colour of the roti)
  { const o = h.drawn('nightDrawOver(ctx,1,1,eveGeo());'), dark = o.filter(e => e.fill === '#1d150e'), fur = o.filter(e => e.fill === '#d9d2c0');
    assert.ok(fur.length >= 5 && o.length % 2 === 0, `the dog is drawn over the roti (${o.length} ellipses)`);
    const half = o.length / 2; assert.ok(o.slice(0, half).every(e => e.fill === '#1d150e'), 'first the whole pose in the dark colour');
    for (let i = 0; i < half; i++) { assert.ok(Math.abs(o[i].x - o[half + i].x) < 1e-6 && o[i].rx > o[half + i].rx + 1 && o[i].ry > o[half + i].ry + 1, 'each dark shape is wider than its own'); }
    assert.ok(dark.length > half); }
  assert.equal(h.drawn('nightDrawUnder(ctx,1,1,eveGeo());').filter(e => e.fill === '#d9d2c0').length, fur_under(h), 'under the table layer the dog has no silhouette');
  assert.deepEqual(h.ngt(), ['look'], 'one look per carry');
  p = go(h, p, S.dog); drop(h, p);
  assert.equal(h.eve().rotiDone, 3); assert.equal(h.eve().ball, false);
  assert.deepEqual(h.serves(), ['dog']); assert.equal(h.NGT().dog, 1); assert.equal(h.onCounter(), 0, 'nothing of it lies on the counter');
  const snaps = h.NB().evenings.at(-1).snaps; assert.equal(snaps.length, 3); assert.equal(snaps[2].to, 'dog');
  assert.deepEqual(h.J('gestures.slice(-5).map(g=>g.kind+(g.event?"/"+g.event:""))'), ['serve', 'pan', 'night/eat', 'notebook/snap', 'evening/serve'], 'the dog and the snapshot come before the stand is reset');
  assert.equal(h.ns().pose, 2, 'it eats');
  sec(h, 1.8); assert.equal(h.ns().pose, 2); sec(h, 0.4); assert.equal(h.ns().pose, 0, 'and sleeps again 2.5 s after the release (0.5 s went by in drop)');
  assert.equal(h.saved().night.dog, 1); assert.equal(h.saved().notebook.evenings.at(-1).snaps[2].to, 'dog');
  const r = reloadD(h);
  assert.equal(r.NGT().dog, 1, 'the count survives a reload'); assert.equal(r.onCounter(), 0); assert.equal(r.NB().evenings.at(-1).snaps[2].to, 'dog');
  assert.equal(r.spots().lidHome, true, 'the bowl is empty: the lid waits');
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: `look line ${S.lookY.toFixed(0)} px, dog at ${S.dog.x.toFixed(0)},${S.dog.y.toFixed(0)}; journal ${h.ngt().join(', ')}` };
});

test('D2', 'while Som waits for her roti the dog sleeps and does not take it: released over the dog the roti stays on the table; Som gone — the dog takes the second ball too', () => {
  const h = night(); light(h);
  onPan(h); arrive(h); finish(h);
  assert.equal(h.g().here, true); assert.equal(h.ns().wants, false, 'Som is here and has no roti yet: the dog does not take it');
  const S = h.ns();
  let p = grab(h); p = go(h, p, { x: p.x, y: S.lookY - 40 }); h.frames(2);
  assert.equal(h.run('nightCarried()'), true); assert.equal(h.ns().pose, 0, 'no hint while the roti is hers');
  p = go(h, p, S.dog); drop(h, p);
  assert.equal(h.eve().rotiDone, 0, 'not served'); assert.equal(h.eve().ball, true); assert.equal(h.run('dish.mode'), 'cut'); assert.equal(h.NGT().dog, 0);
  assert.equal(h.J('gestures.filter(g=>g.kind==="pan").at(-1).outcome'), 'serve-back', 'the stand logs a carry that ended nowhere');
  assert.equal(h.run('nightLive(dish.message)'), null, 'while the roti is hers the words stay the stand\'s and Som\'s');
  serve(h, h.gs().som);
  assert.deepEqual(h.serves(), ['som']); sec(h, 5);
  // second ball: she is still here → hers; script shortcut: she has left → the dog takes it
  nextBall(h); onPan(h); finish(h);
  assert.equal(h.g().here, true); assert.equal(h.ns().wants, false);
  h.run('guestLeave("test")');
  assert.equal(h.ns().wants, true, 'Som is gone: the dog takes the second roti');
  { const B = rotiBox(h); serve(h, { x: B.c.x + 30, y: B.c.y + 20 }); }   // a short carry released on the table: not served, and the words do not send it "to the counter"
  assert.equal(h.eve().rotiDone, 1); assert.match(h.run('dish.message'), /^Неси выше/);
  assert.equal(h.run('eveningLive(dish.message)'), 'роти на столе · возьми за середину и неси');
  serve(h, h.ns().dog);
  assert.deepEqual(h.serves(), ['som', 'dog']); assert.equal(h.NGT().dog, 1); assert.equal(h.onCounter(), 0);
  assert.deepEqual(h.errors, []);
  return { summary: `serves ${h.serves().join(', ')}; night journal ${h.ngt().join(', ')}` };
});

test('D3', 'a whole evening by touches — Som, Som, the dog; three soft roti and two nods are a normal night: after the lid the frame shows three snapshots with who got each, the bananas on the shelf, the lump and no words; a reload opens the same frame; the lump starts the next evening clean', () => {
  const h = night(); light(h);
  onPan(h); arrive(h); finish(h); serve(h, h.gs().som); sec(h, 5);
  assert.equal(h.ns().frame, false);
  nextBall(h); onPan(h); finish(h); serve(h, h.gs().som); sec(h, 5);
  assert.deepEqual(h.g().answers.map(a => a.answer), ['nod', 'nod'], 'two soft roti: two nods');
  nextBall(h); assert.equal(h.ns().wants, true);
  onPan(h); finish(h); serve(h, h.ns().dog); sec(h, 3);
  assert.deepEqual(h.serves(), ['som', 'som', 'dog']);
  assert.equal(h.run('eveningLive("")'), '', 'no idle words before 6 s');
  endEvening(h); h.frames(3);
  const F = h.ns();
  assert.equal(F.frame, true); assert.deepEqual(F.cards.map(c => c.to), ['som', 'som', 'dog']);
  assert.deepEqual(F.gifts, ['bananas', 'bananas'], 'the shelf holds what she left');
  assert.equal(h.run('eveningLive("")'), '', 'the night frame has no words'); assert.equal(h.run('eveningLive("Разрезов")'), '');
  assert.equal(F.pose, 0, 'the dog sleeps'); assert.equal(h.run('fryHold'), true);
  assert.deepEqual(h.ngt().slice(-1), ['frame:lid']);
  const row = h.J('gestures.filter(g=>g.kind==="night").at(-1)');
  assert.deepEqual(row.to, ['som', 'som', 'dog']); assert.deepEqual(row.gifts, ['bananas', 'bananas']);
  h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  // touches elsewhere do nothing; the notebook still opens
  tap(h, h.spots().bowl); tap(h, h.spots().lamp); tap(h, h.ns().dog); tap(h, F.cards[1]);
  assert.equal(h.eve().over, true); assert.equal(h.ns().frame, true);
  // critic 12: opened again after the evening was closed — the night frame, not dusk
  const r = reloadD(h); r.frames(3);
  assert.equal(r.eve().over, true); assert.equal(r.eve().lamp, false);
  const R = r.ns();
  assert.equal(R.frame, true); assert.deepEqual(R.cards.map(c => c.to), ['som', 'som', 'dog']); assert.deepEqual(R.gifts, ['bananas', 'bananas']);
  assert.equal(r.run('eveningLive("")'), ''); assert.equal(r.NGT().dog, 1);
  assert.deepEqual(r.J('nightExport().events.map(e=>e.event+(e.how?":"+e.how:""))').slice(-2), ['frame:lid', 'frame:load']);
  r.tick(3, 1 / 60, true); assert.equal(r.run('loopErrs'), 0);
  tap(r, r.spots().lump); r.frames(3);
  assert.deepEqual(r.eve(), { v: 1, lamp: false, ballsLeft: 3, rotiDone: 0, lid: false, over: false, ball: false });
  assert.equal(r.ns().frame, false); assert.deepEqual(r.ns().cards, []); assert.deepEqual(r.NGT(), { v: 1, dog: 0, shown: false });
  assert.deepEqual(r.g(), FRESH, 'the shelf is empty again (memory between evenings is step 5)');
  assert.equal(r.NB().evenings.length, 1, 'the evening stays as a notebook page'); assert.equal(r.NB().cur, false);
  assert.equal(r.saved().night.dog, 0);
  const again = reloadD(r); assert.equal(again.ns().frame, false, 'dusk after the lump, also after a reload');
  assert.deepEqual(h.errors, []); assert.deepEqual(r.errors, []);
  return { summary: `cards ${F.cards.map(c => c.to).join(', ')} · gifts ${F.gifts.join(', ')} · card ${F.cards[0].s.toFixed(0)} px` };
});

test('D4', 'the counter works as before on the third ball (card "counter", the roti lies on the counter); the dog can eat two roti of one evening', () => {
  const h = night({ storage: saveAt(2) });
  onPan(h); finish(h); serve(h);
  assert.deepEqual(h.serves(), ['counter']); assert.equal(h.NGT().dog, 0); assert.equal(h.onCounter(), 1);
  assert.equal(h.ns().pose, 0, 'the dog was not fed');
  endEvening(h); h.frames(3);
  assert.deepEqual(h.ns().cards.map(c => c.to), ['som', 'som', 'counter']);
  // Som came and left without a roti (script: the save says she is gone) — the first two roti go to the dog, the third to the counter
  const d = night({ storage: saveAt(0) });
  assert.equal(d.ns().wants, true);
  onPan(d); sec(d, 10); assert.equal(d.g().here, false, 'gone means gone');
  finish(d); serve(d, d.ns().dog); sec(d, 3);
  nextBall(d); onPan(d); finish(d); serve(d, d.ns().dog); sec(d, 3);
  nextBall(d); onPan(d); finish(d); serve(d);
  assert.deepEqual(d.serves(), ['dog', 'dog', 'counter']); assert.equal(d.NGT().dog, 2); assert.equal(d.onCounter(), 1);
  endEvening(d); d.frames(3);
  const F = d.ns();
  assert.deepEqual(F.cards.map(c => c.to), ['dog', 'dog', 'counter']); assert.deepEqual(F.gifts, [], 'no gifts: the shelf is not drawn');
  d.tick(3, 1 / 60, true); assert.equal(d.run('loopErrs'), 0); assert.deepEqual(d.errors, []); assert.deepEqual(h.errors, []);
  return { summary: `counter night ${h.ns().cards.map(c => c.to).join(', ')} · dog night ${F.cards.map(c => c.to).join(', ')}` };
});

test('D5', '390×844 and 375×667: the dog lies in the bottom left corner clear of the bowl and of the roti on the table; the night cards stand in a row between the shelf and the lamp above the counter; every pose and the frame draw', () => {
  const out = [];
  for (const [w, hh] of [[390, 844], [375, 667]]) {
    const h = night({ w, hh, storage: saveAt(2) });
    onPan(h); finish(h);
    const S = h.ns(), E = h.spots(), B = rotiBox(h);
    const D = S.dogBox;
    assert.ok(D.x >= 0 && D.y + D.h <= hh && D.w >= 60 && D.h >= 30, `the dog is on the screen (${D.w.toFixed(0)}×${D.h.toFixed(0)})`);
    const bowlLeft = h.J('(()=>{const G=eveGeo(),r=cv.getBoundingClientRect();return r.left+(G.bowl.x-G.bowl.rx*1.15)*r.width/cv.width})()');
    assert.ok(D.x + D.w <= bowlLeft, `left of the bowl's touch zone (${(D.x + D.w).toFixed(0)} ≤ ${bowlLeft.toFixed(0)})`);
    assert.ok(S.zone.x1 < B.l.x || S.zone.y0 > B.b.y, 'the zone of the dog does not reach the roti on the table');
    assert.ok(S.zone.y0 > E.work.y && S.zone.y0 > S.lookY, 'the zone is below the middle of the table and inside the lower third');
    for (const pose of [0, 1, 2]) { h.run(`nLook=${pose === 1};nEat=${pose === 2 ? 1 : 0}`); h.tick(1, 1 / 600, true); assert.equal(h.ns().pose, pose === 1 ? 0 : pose); }
    // (pose 1 needs a roti in the hand: nightUpdate drops it — drawn by hand here)
    h.run('nLook=true;{const G=eveGeo();nightDogDraw(ctx,1,1,G);nightDrawOver(ctx,1,1,G);}nLook=false;nEat=0');
    serve(h, S.dog); endEvening(h); h.frames(3);
    const F = h.ns(), G = h.gs(), C = F.cards;
    assert.equal(C.length, 3);
    const lampLeft = h.J('(()=>{const G=eveGeo(),r=cv.getBoundingClientRect();return r.left+(G.lamp.x-G.lamp.s*1.15)*r.width/cv.width})()');
    const shelfRight = h.J('(()=>{const G=eveGeo(),F=guestShelf(G),r=cv.getBoundingClientRect();return r.left+(F.x0+F.w)*r.width/cv.width})()');
    assert.ok(C[0].x >= shelfRight && C[2].x + C[2].s <= lampLeft, `between the shelf and the lamp (${C[0].x.toFixed(0)}…${(C[2].x + C[2].s).toFixed(0)} in ${shelfRight.toFixed(0)}…${lampLeft.toFixed(0)})`);
    assert.ok(C[0].s >= 44, `a card is at least 44 px (${C[0].s.toFixed(0)})`);
    assert.ok(C[1].x - C[0].x >= C[0].s + 4 && C[2].x - C[1].x >= C[1].s + 4, 'cards do not overlap');
    const counterTop = h.J('(()=>{const G=eveGeo(),r=cv.getBoundingClientRect();return r.top+G.counter.y0*r.height/cv.height})()');
    assert.ok(C[0].y >= 28 && C[0].markY + 12 <= counterTop, `cards and marks stand above the counter (${C[0].y.toFixed(0)}…${(C[0].markY + 12).toFixed(0)} ≤ ${counterTop.toFixed(0)})`);
    assert.ok(Math.hypot(E.lump.x - w / 2, 0) < 2 && E.lump.y > counterTop, 'the lump is on the table');
    h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
    out.push(`${w}×${hh}: dog ${Math.round(D.x)}…${Math.round(D.x + D.w)} × ${Math.round(D.y)}…${Math.round(D.y + D.h)}, cards ${Math.round(C[0].s)} px at ${Math.round(C[0].x)}…${Math.round(C[2].x + C[2].s)} × ${Math.round(C[0].y)}…${Math.round(C[0].markY + 12)}, counter top ${Math.round(counterTop)}`);
  }
  return { summary: out.join(' · ') };
});

test('D6', 'without night.js the evening is the one of step 3: the old closing line, a roti released at the bottom is not served, and the saved night block is carried through', () => {
  const store = saveAt(2); const s = JSON.parse(store[0][1]); s.night = { v: 1, dog: 0, shown: false, events: [] };
  const h = boot(TUNE, W, HH, { storage: [['roti_evening', JSON.stringify(s)]] });
  h.context.location.search = ''; h.context.document.readyState = 'complete';
  for (const f of sideScripts.filter(x => !x.file.endsWith('night.js'))) vm.runInContext(f.src, h.context, { filename: f.file, timeout: 10000 });
  h.J = code => JSON.parse(h.run(`JSON.stringify(${code})`)); h.eve = () => h.J('EVE'); h.spots = () => h.J('eveningSpots()');
  h.saved = () => JSON.parse(h.storage.get('roti_evening') || 'null');
  h.frames = (n = 1) => { for (let i = 0; i < n; i++) { h.advance(1000 / 60); h.run(FRAME); } };
  assert.equal(h.run('typeof nightDraw'), 'undefined');
  onPan(h); finish(h);
  serve(h, { x: 58, y: HH - 36 });
  assert.equal(h.eve().rotiDone, 2, 'no dog: a release at the bottom left serves nothing');
  serve(h);
  assert.equal(h.eve().rotiDone, 3);
  assert.deepEqual(h.saved().night, s.night, 'the night block of the save is not lost');
  const S = h.spots(); drive(h, line(S.lid, S.pan, { v: 300 }));
  assert.equal(h.eve().over, true); assert.equal(h.run('eveningLive("")'), 'вечер окончен · три роти');
  h.tick(3, 1 / 60, true); assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: 'evening.js + guest.js + notebook.js alone: old closing line, save.night kept' };
});

test('D7', 'the snapshot of a roti given to Som keeps her answer, and the mark under it is her answer face: nod (level mouth, head tilted), crunch (closed eyes, crumbs); an old snapshot without an answer keeps the old mark', () => {
  const h = night(); light(h);
  onPan(h); arrive(h); finish(h); serve(h, h.gs().som);          // short fry → nod
  assert.deepEqual(h.g().answers.map(a => a.answer), ['nod']);
  const snaps = h.NB().evenings.at(-1).snaps;
  assert.equal(snaps[0].to, 'som'); assert.equal(snaps[0].answer, 'nod', 'the snapshot keeps the answer');
  // the mark under a Som snapshot draws her answer face, the old mark has no features
  const mark = ans => h.J(`(()=>{const E=[],R=[],S=[],k={ellipse:ctx.ellipse,stroke:ctx.stroke,rotate:ctx.rotate,fillRect:ctx.fillRect};
    ctx.ellipse=(x,y,rx,ry)=>{E.push({f:ctx.fillStyle,x,y,rx,ry})};ctx.rotate=a=>R.push(a);ctx.stroke=()=>S.push(1);
    try{nbMark(ctx,1,1,"som",100,100,1,${ans === null ? 'null' : JSON.stringify(ans)})}finally{Object.assign(ctx,k)}return {E,R,S}})()`);
  const mNod = mark('nod');
  assert.deepEqual(mNod.R, [0.16], 'the nod head is tilted');
  assert.equal(mNod.E.filter(e => e.f === '#1d150e' && e.rx < 1.4).length, 2, 'two open eyes');
  assert.equal(mNod.S.length, 3, 'two earrings + one level mouth');
  const mCrunch = mark('crunch');
  assert.deepEqual(mCrunch.R, [], 'no tilt on the crunch');
  assert.equal(mCrunch.E.filter(e => e.f === '#f0c674').length, 6, 'crumbs');
  assert.equal(mCrunch.E.filter(e => e.f === '#1d150e').length, 0, 'no open eyes — the eyes are closed');
  assert.equal(mCrunch.S.length, 5, 'two earrings + two closed eyes + a smile');
  const mOld = mark(null);
  assert.deepEqual(mOld.R, [], 'the old mark is not tilted');
  assert.equal(mOld.E.filter(e => e.f === '#f0c674').length, 0);
  assert.equal(mOld.E.filter(e => e.f === '#1d150e').length, 0, 'the old mark has no face features');
  assert.equal(mOld.S.length, 2, 'only the earrings');
  const r = reloadD(h);
  assert.equal(r.NB().evenings.at(-1).snaps[0].answer, 'nod', 'the answer survives a reload');
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: `answer kept on the snapshot: ${snaps[0].answer}; nod: tilt + open eyes + level mouth, crunch: crumbs + closed eyes, old: neutral` };
});

// ── night with shelf.js (for the yesterday row, step 5): shelf.js loads last, after night.js ──
const shelfScript = { file: path.join(path.dirname(H.sourcePath), 'shelf.js'), src: fs.readFileSync(path.join(path.dirname(H.sourcePath), 'shelf.js'), 'utf8') };
function nightShelf(opts = {}) {
  const h = night(opts);
  vm.runInContext(shelfScript.src, h.context, { filename: shelfScript.file, timeout: 10000 });
  return h;
}

test('D8', 'the night frame of the second evening shows yesterday as a separate row below today, the same size, dimmed and without marks', () => {
  const snap = (to, k) => ({ to, img: null, crisp: 1, step: 1, ts: `2026-11-17T12:0${k}:00.000Z` });
  const store = [['roti_evening', JSON.stringify({ v: 1, lamp: false, ballsLeft: 0, rotiDone: 3, lid: true, over: true, ball: false, n: 2,
    guest: { v: 1, here: false, gone: true, knocked: true, answers: [], gifts: [], taken: 0, events: [] },
    notebook: { v: 1, cur: true, peeked: true, evenings: [
      { ts: '2026-11-16T12:00:00.000Z', n: 1, snaps: ['som', 'som', 'dog'].map((to, k) => snap(to, k)) },
      { ts: '2026-11-17T12:00:00.000Z', n: 2, snaps: ['som', 'dog', 'counter'].map((to, k) => snap(to, k)) } ], events: [] },
    night: { v: 1, dog: 0, shown: true, events: [] },
    shelf: { v: 1, n: 2, bananas: 0, jam: 0, jar: false, empty: false, banBall: 0, jamBall: 0, som: { jar: false, early: false }, jarIn: null, begun: true, events: [] } })]];
  for (const [w, hh] of [[390, 844], [375, 667]]) {
    const h = nightShelf({ storage: store, w, hh }); h.frames(3);
    const N = h.ns();
    assert.equal(N.frame, true); assert.equal(N.cards.length, 3); assert.equal(N.past.length, 3, 'three yesterday cards');
    assert.ok(N.past.every((p, i) => Math.abs(p.s - N.cards[i].s) < 1e-6), `yesterday is the same size (${N.past[0].s.toFixed(0)} = ${N.cards[0].s.toFixed(0)} px on ${w}×${hh})`);
    assert.ok(N.past.every((p, i) => Math.abs(p.x - N.cards[i].x) < 1e-6), 'the same columns as today');
    assert.ok(N.past[0].y > N.cards[0].markY, 'yesterday is a row below today');
    const cy0 = h.J('(()=>{const G=eveGeo(),r=cv.getBoundingClientRect();return r.top+G.counter.y0*r.height/cv.height})()');
    assert.ok(N.past[2].y + N.past[2].s <= cy0, 'above the counter');
    // marks for today only; yesterday cards carry a dim overlay
    const cloth = h.drawn('nightDraw(ctx,1,1,eveGeo());').filter(e => e.fill === '#8a4b3c').length;
    assert.equal(cloth, 1, 'one Som mark — today\'s; yesterday has no marks');
    const over = h.J('(()=>{const out=[],k=ctx.fillRect;ctx.fillRect=(x,y,w,h)=>{out.push({f:ctx.fillStyle,x,y,w,h})};try{nightDraw(ctx,1,1,eveGeo())}finally{ctx.fillRect=k}return out.filter(r=>r.f==="rgba(8,6,10,0.45)")})()');
    assert.equal(over.length, 3, 'three dim overlays, one per yesterday card');
    assert.deepEqual(h.errors, []);
  }
  return { summary: 'yesterday: a dimmed row below today, same size, no marks' };
});

test('D9', 'after the night the new evening starts with an empty counter, while the snapshot of a counter roti keeps its stand mark', () => {
  const h = night({ storage: saveAt(2) });           // third ball in work, two soft roti given to Som
  onPan(h); finish(h); serve(h);                      // the third roti goes to the counter
  assert.equal(h.onCounter(), 1, 'the third roti lies on the counter');
  endEvening(h); h.frames(3);
  assert.deepEqual(h.ns().cards.map(c => c.to), ['som', 'som', 'counter']);
  assert.equal(h.onCounter(), 1, 'at night the counter still shows it');
  // the snapshot of a counter roti keeps the stand mark
  const m = h.J('(()=>{const out=[],k=ctx.fillRect;ctx.fillRect=(x,y,w,h)=>out.push({f:ctx.fillStyle,x,y,w,h});try{nbMark(ctx,1,1,"counter",100,100,1)}finally{ctx.fillRect=k}return out})()');
  assert.ok(m.some(r => r.f === '#3a2c1e' && r.w >= 20), 'the stand mark is drawn under the snapshot');
  // the lump starts the new evening: the counter is empty
  tap(h, h.spots().lump); h.frames(3);
  assert.equal(h.eve().over, false); assert.equal(h.onCounter(), 0, 'the new evening starts with an empty counter');
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: 'counter: 1 at night → 0 in the new evening; the stand mark stays on the snapshot' };
});

const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\nnight: ${passed}/${results.length} passed`);
try {
  const dir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'night-results.json'), JSON.stringify({ source: H.sourcePath, sha256: H.sourceSha256, passed, total: results.length, results }, null, 2));
} catch (e) { console.log('report not written: ' + e.message); }
process.exit(passed === results.length ? 0 : 1);
