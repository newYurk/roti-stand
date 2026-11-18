#!/usr/bin/env node
'use strict';
// Build 85 — the serving batch (docs/serving-batch-spec.md): the filling by taps (one tap of the middle of the open
// sheet pours a square heap of 10–14 banana slices into the dashed square, the second tap the egg; a short tap is the
// filling, a led or held finger goes to the stand as before — a carry, a press), the paper tray (a roti «нарезано»
// slides onto it by itself), the condensed milk (a touch of the bottle by the tray takes it, a finger led over the
// roti lays a thin white stripe — drizzle.js as the jam, flat; the stripe goes up with the tray), the roti in the hand
// (about 60 % of its size, hanging 40 px above the finger; the release is judged by the finger).
// Pure Node/vm with the mocks of model-regression.cjs: stand.js and every script of index.html after it (counter-item,
// drizzle, banana, egg, evening, guest, notebook, night, shelf, milk) run in ONE context in the order of index.html.
// Every action of the player goes through the stand's real window touch handlers. This is not a browser: how the
// heap, the tray, the bottle and the stripe LOOK is a live question (the owner looks at the frames herself).
//   node prototype/dough-closeup/checks/serving-regression.cjs path/to/stand.js [--only P1,P3]
// Script shortcuts, named where used: the dough of every ball is set to the stretch target (stretched); evenings
// start from saves written by script (saveMid); the fry waits model time until «бледное».
// The helpers down to serve() are copied from second-evening-regression.cjs (kept in step by hand).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const H = require('./model-regression.cjs');
const { boot, lcg } = H;
// the scripts index.html loads after stand.js, in its order (drizzle.js is the jam gesture here)
const sideScripts = ['counter-item.js', 'drizzle.js', 'banana.js', 'egg.js', 'evening.js', 'guest.js', 'notebook.js', 'night.js', 'shelf.js', 'milk.js'].map(f => ({ file: path.join(path.dirname(H.sourcePath), f), src: fs.readFileSync(path.join(path.dirname(H.sourcePath), f), 'utf8') }));
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

const until = (h, cond, max = 60 * 400) => { let n = 0; while (!h.run(cond) && n < max) { h.frames(1); n++; } assert.ok(h.run(cond), `waited ${n} frames for ${cond}`); return n; };
const onPan = h => { stretched(h); toPan(h); };
const PALE = 'fryStep(meanCook())>=1';
function finish(h) { if (!h.run('envelopeDone()')) envelope(h); if (!h.run(PALE)) until(h, PALE); toTable(h); cut(h); h.frames(30); }
const snapOf = (to, k) => ({ to, img: null, crisp: 1, step: 1, ts: `2026-11-17T12:0${k}:00.000Z` });
function saveMid(done, { n = 2, sh = {} } = {}) {
  return [['roti_evening', JSON.stringify({ v: 1, lamp: true, ballsLeft: 3 - done - 1, rotiDone: done, lid: false, over: false, ball: true, n,
    guest: { v: 1, here: false, gone: true, knocked: false, answers: [], gifts: [], taken: 0, events: [] },
    notebook: { v: 1, cur: false, peeked: true, evenings: [{ ts: '2026-11-16T12:00:00.000Z', snaps: ['som', 'som', 'dog'].map((to, k) => snapOf(to, k)) }], events: [] },
    shelf: { v: 1, n, bananas: 0, jam: 0, jar: false, empty: false, banBall: 0, jamBall: 0, som: { jar: false, early: false }, jarIn: null, begun: true, events: [], ...sh } })]];
}
const sheetMid = h => h.J('(()=>{const b=dishBounds();return __harness.dishToClient({x:(b.left+b.right)/2,y:(b.top+b.bottom)/2})})()');
const kinds = h => h.J('(()=>{const F=dish.filling||[];return {banana:F.filter(f=>(f.kind||"banana")==="banana").length,egg:F.filter(f=>f.kind==="egg").length}})()');
const panLog = h => h.J('gestures.filter(g=>g.kind==="pan").map(g=>g.outcome)');
// a milk stroke across the roti on the tray, a little off the cut lines
function milkStroke(h, dy = 0.3, v = 260) {
  const B = rotiBox(h), y = B.c.y + (B.b.y - B.c.y) * dy, a = { x: B.l.x + (B.c.x - B.l.x) * 0.3, y }, b = { x: B.r.x - (B.r.x - B.c.x) * 0.3, y };
  drive(h, line(a, b, { v, hold: 60 }), { settle: 12 });
}
function go(h, from, to, v = 420) {
  const L = Math.hypot(to.x - from.x, to.y - from.y), n = Math.max(1, Math.ceil(L / (v / 60)));
  for (let i = 1; i <= n; i++) { h.touch('move', 't1', from.x + (to.x - from.x) * i / n, from.y + (to.y - from.y) * i / n); h.frames(1); }
  return { x: to.x, y: to.y };
}
// where the carried roti is drawn: centre of the roti and the shown scale against the scale on the table
const shown = h => h.J(`(()=>{const p=dishShownPose(),t=dishPose(),c=dish.cutCenter,r=cv.getBoundingClientRect();
  const X=p.x+c.x*p.scale,Y=p.y+c.y*p.scale;return {x:r.left+prX(X,Y)*r.width/cv.width,y:r.top+prY(X,Y)*r.height/cv.height,k:p.scale/t.scale}})()`);

// ── checks ────────────────────────────────────────────────────────────────────────────────────
test('P1', 'one tap of the middle of the open sheet pours a square heap of 10–14 banana slices inside the dashed square; it costs one banana of the bunch; one undo takes the whole heap', () => {
  const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }) });
  onPan(h); h.frames(3);
  const c = sheetMid(h); tap(h, c);
  const k = kinds(h);
  assert.ok(k.banana >= 10 && k.banana <= 14, `10–14 slices (${k.banana})`); assert.equal(k.egg, 0, 'the first tap is the banana only');
  const G = h.J(`(()=>{const E=dish.env,out=[];for(const f of dish.filling){const a=(f.x-E.c.x)*E.u.x+(f.y-E.c.y)*E.u.y,q=(f.x-E.c.x)*E.v.x+(f.y-E.c.y)*E.v.y;
    out.push({a,q,in:a+f.radius<=E.h[0]/2&&a-f.radius>=-E.h[1]/2&&q+f.radius<=E.h[2]/2&&q-f.radius>=-E.h[3]/2})}return out})()`);
  assert.ok(G.every(g => g.in), 'every slice lies wholly inside the dashed square');
  const ext = v => Math.max(...v) - Math.min(...v), su = ext(G.map(g => g.a)), sv = ext(G.map(g => g.q)), ratio = su / sv;
  assert.ok(ratio > 0.75 && ratio < 1.33, `a square heap, not a strip (${su.toFixed(3)} × ${sv.toFixed(3)})`);
  assert.equal(h.J('SHF').bananas, 1, 'the heap takes one banana off the bunch');
  h.run('undoDish()'); assert.equal(kinds(h).banana, 0, 'one undo takes the whole heap');
  tap(h, c); assert.ok(kinds(h).banana >= 10, 'the heap again'); assert.equal(h.J('SHF').bananas, 1, '… on the same roti it costs nothing more');
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: `${k.banana} slices, heap ${su.toFixed(3)} × ${sv.toFixed(3)} (ratio ${ratio.toFixed(2)}); bunch 2 → 1` };
});

test('P2', 'the second tap pours the egg over the heap; the third tap lays nothing; with no bananas on the shelf the first tap is the egg; the egg is not rationed', () => {
  const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }) });
  onPan(h); h.frames(3);
  const c = sheetMid(h); tap(h, c); const k1 = kinds(h);
  tap(h, c); const k2 = kinds(h);
  assert.equal(k2.banana, k1.banana, 'the second tap lays no more banana'); assert.ok(k2.egg >= 3, `the egg (${k2.egg} puddles)`);
  const over = h.J(`(()=>{const B=dish.filling.filter(f=>f.kind!=="egg"),E=dish.filling.filter(f=>f.kind==="egg");
    const x0=Math.min(...B.map(f=>f.x-f.radius)),x1=Math.max(...B.map(f=>f.x+f.radius)),y0=Math.min(...B.map(f=>f.y-f.radius)),y1=Math.max(...B.map(f=>f.y+f.radius));
    const last=dish.faces.filter(f=>f.kind==="filling").at(-1);
    return {inHeap:E.every(e=>e.x>=x0&&e.x<=x1&&e.y>=y0&&e.y<=y1),top:last.fill}})()`);
  assert.ok(over.inHeap, 'every puddle of the egg lies over the heap'); assert.equal(over.top, 'egg', 'the egg lies on top of the banana');
  tap(h, c); assert.deepEqual(kinds(h), k2, 'the third tap lays nothing');
  // no bananas: the first tap is the egg at once
  const e = evening({ storage: saveMid(0) });
  onPan(e); e.frames(3); tap(e, sheetMid(e));
  assert.deepEqual({ b: kinds(e).banana, egg: kinds(e).egg > 0 }, { b: 0, egg: true }, 'an empty shelf: the first tap is the egg');
  assert.equal(e.run('fillingNext()'), null, 'and then nothing more');
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []); assert.deepEqual(e.errors, []);
  return { summary: `banana ${k1.banana}, then egg ${k2.egg} puddles over the heap; empty shelf → egg ${kinds(e).egg}` };
});

test('P3', 'a short tap does not start a carry; a led finger or a held one lays no banana and goes to the stand (press, «сначала заверни края»); the carry of the envelope to the table drops nothing', () => {
  const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }) });
  onPan(h); h.frames(3);
  const c = sheetMid(h), log0 = panLog(h).length;
  // held 300 ms without moving: a press
  h.touch('start', 't1', c.x, c.y); h.frames(18); assert.ok(h.run('!!dishGesture'), 'a held finger reaches the stand within 300 ms'); h.touch('end', 't1', c.x, c.y); h.frames(5);
  assert.equal(kinds(h).banana, 0, 'a held finger lays no banana'); assert.equal(panLog(h).at(-1), 'press', 'it is a press');
  // led from the middle 70 px in 200 ms
  drive(h, line(c, { x: c.x + 70, y: c.y + 10 }, { v: 350, hold: 20 }), { settle: 10 });
  assert.equal(kinds(h).banana, 0, 'a led finger lays no banana');
  // 9 px drift in 100 ms (within the slop): still a tap
  const log1 = panLog(h).length;
  h.touch('start', 't1', c.x, c.y); h.frames(2); h.touch('move', 't1', c.x + 6, c.y + 6); h.frames(2); h.touch('end', 't1', c.x + 6, c.y + 6);
  assert.equal(h.run('!!dishGesture'), false, 'a short tap never became a stand gesture'); h.frames(3);
  const b = kinds(h).banana; assert.ok(b >= 10, `a short tap is the filling (${b})`); assert.equal(panLog(h).length, log1, 'and the stand logged nothing for it');
  tap(h, c); const k = kinds(h); assert.ok(k.egg > 0);
  envelope(h); until(h, PALE); toTable(h);
  assert.deepEqual(kinds(h), k, 'carried to the table by the middle: nothing fell off');
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: `hold 300 ms → ${panLog(h).slice(log0, log0 + 1)}; lead 70 px → no banana; tap with 8 px drift → ${b} slices; carried with ${k.banana}+${k.egg}` };
});

test('P4', 'after «нарезано» the roti slides onto the paper tray by itself: smaller, at the right edge of the table, clear of the dog; undoing the cut slides it back onto the board', () => {
  const out = [];
  for (const [w, hh] of [[390, 844], [375, 667]]) {
    const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }), w, hh });
    onPan(h); h.frames(3); const c = sheetMid(h); tap(h, c); tap(h, c);
    envelope(h); until(h, PALE); toTable(h);
    const board = h.J('dishPose()'); assert.equal(h.run('!!dish.tray'), false, 'cut not yet: on the board');
    cut(h); h.frames(30);
    assert.equal(h.run('dish.tray'), true, '«нарезано»: on the tray');
    const tray = h.J('dishPose()'); assert.ok(Math.abs(tray.scale / board.scale - 0.85) < 1e-6, 'the roti on the tray is a bit smaller');
    const T = h.J(`(()=>{const T=trayRect(),p=dishPose(),r=cv.getBoundingClientRect(),C=(x,y)=>{const X=p.x+x*p.scale,Y=p.y+y*p.scale;return {x:r.left+prX(X,Y)*r.width/cv.width,y:r.top+prY(X,Y)*r.height/cv.height}};
      return {a:C(T.left,T.top),b:C(T.right,T.bottom)}})()`);
    const W = h.J('(()=>{const z=zone("work"),r=cv.getBoundingClientRect(),C=(x,y)=>({x:r.left+prX(x,y)*r.width/cv.width,y:r.top+prY(x,y)*r.height/cv.height});return {a:C(z.x,z.y),b:C(z.x+z.w,z.y+z.h)}})()');
    assert.ok(T.a.y >= W.a.y - 1 && T.b.y <= W.b.y + 1, `the tray lies on the table (tray y ${T.a.y.toFixed(0)}…${T.b.y.toFixed(0)}, table ${W.a.y.toFixed(0)}…${W.b.y.toFixed(0)})`);
    assert.ok(W.b.x - T.b.x < (W.b.x - W.a.x) * 0.08, `at the right edge of the table (${(W.b.x - T.b.x).toFixed(0)} px from it)`);
    const Z = h.J('nightSpots()').zone;
    assert.ok(Z.x1 < T.a.x || Z.y0 > T.b.y, 'the zone of the dog does not reach the tray');
    // drawn: the tray under the roti, the milk bottle beside it
    const drawn = h.run('(()=>{let n=0;const k=drawTray;drawTray=function(){n++;return k.apply(this,arguments)};try{drawDish(ctx,1,1)}finally{drawTray=k}return n})()');
    assert.equal(drawn, 1, 'drawDish draws the tray');
    const M = h.J('milkSpots()'); assert.ok(M.at && (M.at.x > T.b.x || M.at.x < T.a.x), 'the bottle stands beside the tray');
    const bowl = h.J('(()=>{const G=eveGeo(),r=cv.getBoundingClientRect(),k=r.width/cv.width;return {x:r.left+G.bowl.x*k,y:r.top+G.bowl.y*r.height/cv.height,r:G.bowl.rx*1.15*k}})()');
    const gap = Math.hypot(M.at.x - bowl.x, M.at.y - bowl.y) - bowl.r - 30;
    assert.ok(gap > 0, `the bottle's touch zone is clear of the bowl's (${gap.toFixed(0)} px apart)`);
    assert.ok(Z.x1 < M.at.x - 30 || Z.y0 > M.at.y + 30, 'and of the dog');
    h.run('undoDish()'); h.frames(30); assert.equal(h.run('dish.tray'), false, 'the cut undone: back on the board');
    assert.ok(Math.abs(h.J('dishPose()').scale - board.scale) < 1e-9);
    assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
    out.push(`${w}×${hh}: tray ${T.a.x.toFixed(0)}…${T.b.x.toFixed(0)} × ${T.a.y.toFixed(0)}…${T.b.y.toFixed(0)}, table top ${W.a.y.toFixed(0)}, dog zone x1 ${Z.x1.toFixed(0)} y0 ${Z.y0.toFixed(0)}, bottle ${M.at.x.toFixed(0)},${M.at.y.toFixed(0)}, ${gap.toFixed(0)} px clear of the bowl`);
  }
  return { summary: out.join(' · ') };
});

test('P5', 'the milk: a touch of the bottle takes it, a finger led over the roti lays a thin white stripe (half the jam), the bottle goes back after one stripe; the stripe lies on the roti and goes up with the tray; a second touch of the bottle puts it back unused', () => {
  const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }) });
  onPan(h); h.frames(3); const c = sheetMid(h); tap(h, c); tap(h, c); finish(h);
  const M = h.J('milkSpots()'); assert.equal(M.can, true);
  tap(h, M.at); assert.equal(h.run('milkArmed'), true, 'a touch of the bottle takes it'); assert.equal(h.run('drizzleModeOn'), true);
  tap(h, M.at); assert.equal(h.run('milkArmed'), false, 'touched again: put back'); assert.equal(h.run('drizzleStrokes'), 0, 'no stripe from the bottle touches');
  tap(h, M.at); milkStroke(h); h.frames(3);
  assert.equal(h.run('drizzleStrokes'), 1, 'one stripe on the roti'); assert.equal(h.run('milkArmed'), false, 'the bottle went back after the stripe');
  assert.equal(h.run('_trails[0].tint.milk'), true, 'the stripe is milk'); assert.equal(h.run('_trails[0].tint.fill.startsWith("rgba(253")'), true, 'white');
  const wk = h.run('_flatWidth(_trails[0].tint)/_flatWidth(null)'); assert.ok(Math.abs(wk - 0.5) < 1e-6, `thinner than the jam (×${wk})`);
  // the stripe goes with the tray: its points stay inside the drawn roti while the finger carries it up
  const inside = () => h.J(`(()=>{const p=dishShownPose(),pts=_trails[0].pts.filter(q=>q&&!q.break);
    const S=pts.map(q=>_screen(q.x,q.y,q.face)),H=dish.hull.map(q=>({x:prX(p.x+q.x*p.scale,p.y+q.y*p.scale),y:prY(p.x+q.x*p.scale,p.y+q.y*p.scale)}));
    const inPoly=(P,x,y)=>{let s=false;for(let i=0,j=P.length-1;i<P.length;j=i++){const a=P[i],b=P[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)s=!s}return s};
    return {all:S.every(s=>inPoly(H,s.x,s.y)),y:S[0].y,n:S.length}})()`);
  const before = inside(); assert.ok(before.all && before.n > 3, 'the stripe lies on the roti');
  const B = rotiBox(h), counterY = h.spots().counterBottom;
  h.touch('start', 't1', B.c.x, B.c.y); h.frames(3);
  const at = go(h, B.c, { x: B.c.x, y: (B.c.y + counterY) / 2 });
  const mid = inside(); assert.equal(h.run('!!(dishGesture&&dishGesture.carry)'), true, 'the tray is in the hand');
  assert.ok(mid.all, 'in the hand the stripe is still on the roti'); assert.ok(before.y - mid.y > 80, `and it went up with it (${(before.y - mid.y).toFixed(0)} canvas px)`);
  go(h, at, { x: B.c.x, y: counterY - 30 }); h.touch('end', 't1', B.c.x, counterY - 30); h.frames(30);
  assert.equal(h.eve().rotiDone, 1, 'served with the milk on it');
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: `stripe ${before.n} points, ×${wk} of the jam width; went up ${(before.y - mid.y).toFixed(0)} px with the tray, inside the roti all the way` };
});

test('P6', 'the roti in the hand is drawn at 60 % and hangs 40 px above the finger; the release is judged by the finger: roti over the counter but finger below it — not served; finger over the counter — served (390×844, 375×667)', () => {
  const out = [];
  for (const [w, hh] of [[390, 844], [375, 667]]) {
    const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }), w, hh });
    onPan(h); finish(h);
    const B = rotiBox(h), cb = h.spots().counterBottom;
    h.touch('start', 't1', B.c.x, B.c.y); h.frames(3);
    let at = go(h, B.c, { x: B.c.x, y: cb + 20 });
    const s = shown(h), up1 = at.y - s.y;
    assert.ok(Math.abs(s.k - 0.6) < 1e-6, `drawn at 60 % (${s.k})`);
    assert.ok(Math.abs(at.y - s.y - 40) < 1.5 && Math.abs(at.x - s.x) < 1.5, `hangs 40 px above the finger (${(at.y - s.y).toFixed(1)} px up, ${(s.x - at.x).toFixed(1)} px aside)`);
    assert.ok(s.y < cb, 'the roti is drawn over the counter …');
    h.touch('end', 't1', at.x, at.y); h.frames(30);
    assert.equal(h.eve().rotiDone, 0, '… but the finger is below it: not served'); assert.equal(h.run('dish.mode'), 'cut', 'the roti is back on the tray');
    assert.equal(h.run('dish.tray'), true);
    const B2 = rotiBox(h); h.touch('start', 't1', B2.c.x, B2.c.y); h.frames(3);
    at = go(h, B2.c, { x: B2.c.x, y: cb - 6 }); h.frames(2); h.touch('end', 't1', at.x, at.y); h.frames(30);
    assert.equal(h.eve().rotiDone, 1, 'the finger over the counter: served');
    assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
    out.push(`${w}×${hh}: ×${s.k.toFixed(2)}, ${up1.toFixed(1)} px above the finger; release 20 px below the counter → not served, 6 px inside → served`);
  }
  return { summary: out.join(' · ') };
});

test('P7', 'an evening of three roti by touches — banana heap (while the bunch lasts), egg and milk on every roti, carried up on the tray; the notebook photo has the tray, the cuts, the filling and the milk', () => {
  const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }) });
  // what nbShot (the notebook photo) draws: the tray and the milk stripe, counted while it runs (the mock canvas is shared)
  h.run('__tray=0;__milk=0;__in=0;{const s=nbShot;nbShot=function(){__in=1;try{return s.apply(this,arguments)}finally{__in=0}};const k=drawTray;drawTray=function(){if(__in)__tray++;return k.apply(this,arguments)};const d=drizzlePaint;drizzlePaint=function(){if(__in&&_trails.some(t=>t.tint&&t.tint.milk))__milk++;return d.apply(this,arguments)}}');
  const rows = [];
  for (let i = 0; i < 3; i++) {
    if (i) { tap(h, h.spots().bowl); assert.equal(h.eve().ball, true); }
    onPan(h); h.frames(3); const c = sheetMid(h); tap(h, c); tap(h, c);
    const k = kinds(h); assert.ok(k.egg > 0, `roti ${i + 1}: egg`); if (i < 2) assert.ok(k.banana >= 10, `roti ${i + 1}: banana heap`);
    finish(h); assert.equal(h.run('dish.tray'), true);
    tap(h, h.J('milkSpots()').at); milkStroke(h); h.frames(3); assert.equal(h.run('drizzleStrokes'), 1, `roti ${i + 1}: milk`);
    const B = rotiBox(h); drive(h, line(B.c, h.spots().counter, { v: 420, hold: 80 }), { settle: 30 });
    assert.equal(h.eve().rotiDone, i + 1, `roti ${i + 1} served`);
    rows.push(`${k.banana}+${k.egg}`);
  }
  const snaps = h.J('notebookEvening()');
  assert.equal(snaps.length, 3, 'three photos'); assert.equal(h.run('__tray'), 3, 'each photo draws the tray'); assert.equal(h.run('__milk'), 3, 'and the milk stripe');
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: `banana+egg per roti: ${rows.join(', ')}; photos ${snaps.length}, with tray ${h.run('__tray')}, with milk ${h.run('__milk')}` };
});

const okN = results.filter(r => r.status === 'PASS').length;
try { const dir = path.join(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'serving-results.json'), JSON.stringify(results, null, 1)); } catch (e) {}
console.log(`\nserving: ${okN}/${results.length} passed`);
process.exitCode = okN === results.length ? 0 : 1;
