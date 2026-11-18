#!/usr/bin/env node
'use strict';
// Build 99 (#113) — a frame switch («у реки» / «у канала» / «без рамы») and a resize or rotation of the window in the
// middle of a roti change only the view. For each state of one roti (table step 2 stretched with a tear, tava open with
// banana + egg, folded frying with spots, flipped, cut 2 + 2 on the table, tray with milk, carried) the frame goes
// riverside → canal → none and the window 390×844 → 390×740 → 844×390 → 390×844; after each change the fingerprint of
// the state (step, phase, fry level, cuts, fillings, nodes and area of the sheet within 1 %, evening counters, notebook)
// equals the one before, and the sheet keeps its place against the table / tava within 2 % of its size on screen.
// Pure Node/vm with the mocks of model-regression.cjs; stand.js and every script of index.html after it in one context.
// The frame picture is a mock Image that «loads» at once. This is not a browser: how it looks is the live check.
//   node prototype/dough-closeup/checks/frame-regression.cjs path/to/stand.js [--only F1,F7]
// The helpers down to serve() are copied from serving-regression.cjs (kept in step by hand).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const H = require('./model-regression.cjs');
const { boot, lcg } = H;
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
const FRAME = 'step(1/60); bananaUpdate(1/60); eggUpdate(1/60); drizzleUpdate(1/60); eveningUpdate(1/60); if(pendingResize) flushResize();';   // + the deferred layout, as loop() does
const W = 390, HH = 844;

function evening({ storage = [], search = '', w = W, hh = HH } = {}) {
  const h = boot(TUNE, w, hh, { storage });
  h.context.location.search = search;
  h.context.document.readyState = 'complete';
  // the frame picture: a mock that «loads» as soon as src is set (setFrame sets onload first)
  h.context.Image = class { set src(v) { this._src = v; if (this.onload) this.onload(); } get src() { return this._src; } };
  for (const s of sideScripts) vm.runInContext(s.src, h.context, { filename: s.file, timeout: 10000 });
  h.J = code => JSON.parse(h.run(`JSON.stringify(${code})`));
  h.eve = () => h.J('EVE');
  h.spots = () => h.J('eveningSpots()');
  h.frames = (n = 1) => { for (let i = 0; i < n; i++) { h.advance(1000 / 60); h.run(FRAME); } };
  return h;
}
const tap = (h, p, id = 't1') => { h.touch('start', id, p.x, p.y); h.frames(3); h.touch('end', id, p.x, p.y); h.frames(3); };
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
function line(a, b, { v = 300, hold = 120, stop = 40, seed = 1 } = {}) {
  const rnd = lcg(seed), L = Math.hypot(b.x - a.x, b.y - a.y), T = L / v * 1000, pts = [{ x: a.x, y: a.y, t: 0 }];
  for (let t = 8; t < T; t += 1000 / 60) pts.push({ x: a.x + (b.x - a.x) * t / T + 2 * rnd(), y: a.y + (b.y - a.y) * t / T + 2 * rnd(), t: hold + t });
  pts.push({ x: b.x, y: b.y, t: hold + T }); pts.push({ x: b.x, y: b.y, t: hold + T + stop });
  return pts;
}
function stretched(h) {
  h.run('stepNo=3;reset();'); h.frames(2);
  h.run('{const c=centerOfSheet(),R=sheetRadius();for(let i=0;i<N;i++){const x=px[i]-c.x,y=py[i]-c.y,k=targetAt(Math.atan2(y,x))/R;px[i]=prx[i]=c.x+x*k;py[i]=pry[i]=c.y+y*k;}}');
  h.frames(2);
}
function toPan(h) {
  const c = h.J('__harness.toClient(centerOfSheet().x,centerOfSheet().y)'), p = h.spots().pan;
  drive(h, line(c, p, { v: 320, hold: 100 }), { settle: 90 });
  assert.equal(h.run('phase'), 'PAN', 'the sheet carried by the middle lies on the tava');
}
function envelope(h) {
  for (const k of [2, 3, 0, 1]) {
    const e = h.J(`(()=>{const E=dish.env,a=${k}<2?E.u:E.v,s=${k}%2?-1:1,d={x:a.x*s,y:a.y*s},hk=E.h[${k}];
      const hu=dish.hull.reduce((m,p)=>Math.max(m,(p.x-E.c.x)*d.x+(p.y-E.c.y)*d.y),0)/hk;
      return [__harness.dishToClient({x:E.c.x+d.x*hk*hu*.97,y:E.c.y+d.y*hk*hu*.97}),__harness.dishToClient(E.c)]})()`);
    const a = e[0], m = e[1], b = { x: a.x + (m.x - a.x) * 0.85, y: a.y + (m.y - a.y) * 0.85 };
    drive(h, line(a, b, { v: 170, hold: 150, stop: 60, seed: k + 3 }));
  }
  assert.equal(h.run('envelopeDone()'), true, 'the envelope is done');
}
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
// 2 + 2: two cuts across, two along
function cut22(h) {
  const B = rotiBox(h), w = B.r.x - B.l.x, hh = B.b.y - B.t.y, dx = w * 0.2, dy = hh * 0.2;
  for (const k of [-1, 1]) drive(h, line({ x: B.l.x - dx, y: B.c.y + k * hh / 6 }, { x: B.r.x + dx, y: B.c.y + k * hh / 6 }, { v: 380, hold: 60 }));
  for (const k of [-1, 1]) drive(h, line({ x: B.c.x + k * w / 6, y: B.t.y - dy }, { x: B.c.x + k * w / 6, y: B.b.y + dy }, { v: 380, hold: 60 }));
  assert.equal(h.run('dish.cuts.length'), 4, 'four cuts, each from edge to edge');
  assert.equal(h.run('cutEnough()'), true, '«нарезано»');
}
const until = (h, cond, max = 60 * 400) => { let n = 0; while (!h.run(cond) && n < max) { h.frames(1); n++; } assert.ok(h.run(cond), `waited ${n} frames for ${cond}`); return n; };
const PALE = 'fryStep(meanCook())>=1';
const sheetMid = h => h.J('(()=>{const b=dishBounds();return __harness.dishToClient({x:(b.left+b.right)/2,y:(b.top+b.bottom)/2})})()');
function milkStroke(h, dy = 0.3, v = 260) {
  const B = rotiBox(h), y = B.c.y + (B.b.y - B.c.y) * dy, a = { x: B.l.x + (B.c.x - B.l.x) * 0.3, y }, b = { x: B.r.x - (B.r.x - B.c.x) * 0.3, y };
  drive(h, line(a, b, { v, hold: 60 }), { settle: 12 });
}
function go(h, from, to, v = 420) {
  const L = Math.hypot(to.x - from.x, to.y - from.y), n = Math.max(1, Math.ceil(L / (v / 60)));
  for (let i = 1; i <= n; i++) { h.touch('move', 't1', from.x + (to.x - from.x) * i / n, from.y + (to.y - from.y) * i / n); h.frames(1); }
  return { x: to.x, y: to.y };
}
const snapOf = (to, k) => ({ to, img: null, crisp: 1, step: 1, ts: `2026-11-17T12:0${k}:00.000Z` });
function saveMid(done, { n = 2, sh = {} } = {}) {
  return [['roti_evening', JSON.stringify({ v: 1, lamp: true, ballsLeft: 3 - done - 1, rotiDone: done, lid: false, over: false, ball: true, n,
    guest: { v: 1, here: false, gone: true, knocked: false, answers: [], gifts: [], taken: 0, events: [] },
    notebook: { v: 1, cur: false, peeked: true, evenings: [{ ts: '2026-11-16T12:00:00.000Z', snaps: ['som', 'som', 'dog'].map((to, k) => snapOf(to, k)) }], events: [] },
    shelf: { v: 1, n, bananas: 0, jam: 0, jar: false, empty: false, banBall: 0, jamBall: 0, som: { jar: false, early: false }, jarIn: null, begun: true, events: [], ...sh } })]];
}

// ── the fingerprint and the place ─────────────────────────────────────────────────────────────
// Area of the sheet in units of the layout (targetR²): it does not depend on the screen. On the dish the material is in
// local coordinates (unit = targetR) and the faces are summed there.
const FP = `(()=>{const polyA=P=>{let s=0;for(let i=0,j=P.length-1;i<P.length;j=i++)s+=(P[j].x+P[i].x)*(P[j].y-P[i].y);return Math.abs(s)/2};
  const sheetA=quads.reduce((s,q)=>s+area(q),0)/(targetR*targetR);
  const faceA=dish?dish.faces.reduce((s,f)=>s+(f.points&&f.points.length>2?polyA(f.points):0),0):0;
  return {step:stepNo,phase,state:action.state,dish:dish?dish.mode:null,fry:dish&&dish.mode==="fold"?fryStep(meanCook()):null,
    folds:dish?dish.folds:0,flips:dish?(dish.flips||0):0,cuts:dish?dish.cuts.length:0,tray:dish?!!dish.tray:false,
    fill:dish&&dish.filling?dish.filling.length:0,faces:dish?dish.faces.length:0,faceA,
    n:N,broken:cons.filter(c=>c.broken).length,sheetA,milk:typeof _trails!=="undefined"?_trails.length:0,milkArmed:typeof milkArmed!=="undefined"?milkArmed:null,
    eve:{lamp:EVE.lamp,ballsLeft:EVE.ballsLeft,rotiDone:EVE.rotiDone,ball:EVE.ball,over:EVE.over},
    nb:JSON.stringify(NB.evenings.map(e=>e.snaps.length)),guest:JSON.stringify({here:GST.here,gone:GST.gone,taken:GST.taken}),shelf:SHF.bananas}})()`;
// Where the sheet is drawn, in screen px, against its anchor: the work zone (table) or the tava. Offset of the box
// centre from the anchor centre: across in units of the anchor's width on screen, in depth in units of its depth on
// screen (the frames have tables of different shape — canal 495×180 against riverside 420×225 in the picture — so the
// same place on the table is a different share of its width in depth).
const PLACE = `(()=>{const r=cv.getBoundingClientRect(),kx=r.width/cv.width,ky=r.height/cv.height,S=(x,y)=>({x:prX(x,y)*kx,y:prY(x,y)*ky});
  let pts=[];
  if(dish){const p=dishShownPose();for(const q of dish.hull)pts.push(S(p.x+q.x*p.scale,p.y+q.y*p.scale));}
  else for(let i=0;i<N;i++)pts.push(S(px[i],py[i]));
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),c={x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2};
  const z=zone("work"),a=S(z.x,z.y+z.h),b=S(z.x+z.w,z.y+z.h),tw=Math.abs(b.x-a.x),td=Math.abs(S(z.cx,z.y+z.h).y-S(z.cx,z.y).y);
  const onPan=phase==="PAN"&&(!dish||dish.mode==="fold");
  const o=onPan?S(panC.x,panC.y):S(z.cx,z.cy);
  const aw=onPan?Math.abs(S(panC.x+PAN_R,panC.y).x-S(panC.x-PAN_R,panC.y).x):tw, ad=onPan?Math.abs(S(panC.x,panC.y+PAN_R).y-S(panC.x,panC.y-PAN_R).y):td;
  return {anchor:onPan?"tava":"table",dx:(c.x-o.x)/aw,dy:(c.y-o.y)/ad,tw,td,bw:Math.max(...xs)-Math.min(...xs),finite:pts.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))}})()`;

function compare(a, b) {
  const bad = [];
  for (const k of Object.keys(a)) {
    if (k === 'sheetA' || k === 'faceA') { if (Math.abs(b[k] - a[k]) > 0.01 * Math.max(1e-9, Math.abs(a[k]))) bad.push(`${k} ${a[k].toFixed(4)}→${b[k].toFixed(4)}`); }
    else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) bad.push(`${k} ${JSON.stringify(a[k])}→${JSON.stringify(b[k])}`);
  }
  return bad;
}
// The frame pictures are a tool of the stand panel: the evening runs on its own table and eveningUpdate() switches a
// frame off on its next frame (evening.js). So the frames go in the stand mode (eveDev on — the panel open; script,
// not the radio: closing the panel by the radio restarts the ball as a lump by design, eveApply), then eveDev goes off
// without eveApply and the evening drops the frame itself on its next frame — the same path as a stored frame whose
// picture arrives after the evening has started. The window sizes go in the evening.
const CHANGES = [
  ['stand mode, frame riverside', h => { h.run('eveSetDev(true);setFrame("riverside")'); }, 'riverside'],
  ['frame canal', h => h.run('setFrame("canal")'), 'canal'],
  ['frame none', h => h.run('setFrame("")'), ''],
  ['frame riverside', h => h.run('setFrame("riverside")'), 'riverside'],
  ['evening again: it drops the frame', h => { h.run('eveSetDev(false)'); h.frames(1); }, ''],
  ['390×740', h => h.viewport(390, 740)],
  ['844×390', h => h.viewport(844, 390)],
  ['390×844', h => h.viewport(390, 844)],
];
// --sizes: only the window sizes (to see on an old build whether the resize alone keeps the roti)
if (args.includes('--sizes')) CHANGES.splice(0, 5);
// Run every change on the built state; return rows and the list of failures.
function sweep(h, label) {
  const rows = [], fails = [], bad0 = fails;
  for (const [name, act, frame] of CHANGES) {
    const a = h.J(FP), pa = h.J(PLACE);
    act(h);
    const b = h.J(FP), pb = h.J(PLACE);
    const on = h.J('frameOn?Object.keys(FRAMES).find(k=>FRAMES[k]===FRAME):""');
    if (frame !== undefined && !h.run('gestureLive()') && on !== frame) bad0.push(`${label} / ${name}: frame is «${on}», wanted «${frame}»`);
    h.run('draw()');                                     // the picture must draw in the new layout
    h.frames(2);                                         // and the frame stays (in the stand mode)
    const bad = compare(a, b);
    const live = h.run('gestureLive()');
    // while a finger is down the layout waits for the release; the place is checked then
    const off = live ? 0 : Math.hypot(pb.dx - pa.dx, pb.dy - pa.dy);
    if (!live && pa.anchor !== pb.anchor) bad.push(`anchor ${pa.anchor}→${pb.anchor}`);
    if (off > 0.02) bad.push(`moved ${(off * 100).toFixed(1)} % of the ${pb.anchor} size`);
    if (!pb.finite) bad.push('non-finite sheet');
    if (h.errors.length) bad.push('errors: ' + h.errors.join(' | '));
    rows.push({ change: name, off: +(off * 100).toFixed(2), live, pa, pb, fp: b });
    if (bad.length) fails.push(`${label} / ${name}: ${bad.join('; ')}`);
  }
  return { rows, fails };
}
function framed(h) { }   // the state is built in the evening (no frame); the frames come in the sweep
function check(label, h, after) {
  const s = sweep(h, label);
  if (after) after(h, s);
  h.frames(10);
  if (h.errors.length) s.fails.push(`${label}: errors after the sweep: ${h.errors.join(' | ')}`);
  const worst = Math.max(...s.rows.map(r => r.off));
  const out = { rows: s.rows, summary: `${label}: ${s.rows.length} changes, worst shift ${worst.toFixed(2)} % of the table / tava size, fingerprint kept ${s.rows.length - s.fails.length}/${s.rows.length}` };
  if (s.fails.length) { const e = new assert.AssertionError({ message: s.fails.join('\n') }); e.partial = out; throw e; }
  return out;
}
// The roti is finished to the guest after the sweep: the state is not only kept but still playable.
function toGuest(h) {
  if (h.run('!dish')) { if (h.run('stepNo') < 3) stretched(h); toPan(h); }
  if (h.run('dish.mode') === 'fold') { if (!h.run('envelopeDone()')) envelope(h); if (!h.run(PALE)) until(h, PALE); toTable(h); }
  if (!h.run('cutEnough()')) cut22(h);
  h.frames(30);
  const before = h.eve().rotiDone, B = rotiBox(h), cb = h.spots().counterBottom;
  h.touch('start', 't1', B.c.x, B.c.y); h.frames(3);
  const at = go(h, B.c, { x: B.c.x, y: cb - 6 }); h.frames(2); h.touch('end', 't1', at.x, at.y); h.frames(30);
  assert.equal(h.eve().rotiDone, before + 1, 'the roti is served after the sweep');
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
}

// ── states ────────────────────────────────────────────────────────────────────────────────────
test('F1', 'table, step 2, stretched with a tear', () => {
  const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }) }); framed(h);
  h.run('stepNo=2;reset();'); h.frames(2);
  for (let n = 0; n < 3; n++) { H.stroke(h, { angle: Math.PI / 8 + n * Math.PI / 4, speed: 1.5, dist: 2.4, hz: 60, jitter: 1, seed: n + 1 }); h.frames(20); }
  h.run('breakCon(cons[40]);breakCon(cons[41]);onTear();'); h.frames(2);
  assert.equal(h.run('stepNo'), 2); assert.ok(h.run('cons.filter(c=>c.broken).length') >= 2, 'torn');
  const out = check('step 2 torn', h); toGuest(h); return out;
});
test('F2', 'tava, open sheet with banana and egg', () => {
  const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }) }); framed(h);
  stretched(h); toPan(h); h.frames(3); const c = sheetMid(h); tap(h, c); tap(h, c);
  assert.ok(h.run('dish.filling.some(f=>f.kind==="egg")&&dish.filling.some(f=>(f.kind||"banana")==="banana")'), 'banana and egg');
  const out = check('tava open + banana + egg', h); toGuest(h); return out;
});
test('F3', 'tava, folded and frying with spots', () => {
  const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }) }); framed(h);
  stretched(h); toPan(h); h.frames(3); envelope(h); until(h, PALE); h.frames(120);
  const out = check('folded frying', h); toGuest(h); return out;
});
test('F4', 'tava, flipped', () => {
  const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }) }); framed(h);
  stretched(h); toPan(h); h.frames(3); envelope(h); until(h, PALE); flick(h);
  assert.ok(h.run('dish.flips') >= 1, 'flipped');
  const out = check('flipped', h); toGuest(h); return out;
});
test('F5', 'table, cut 2 + 2', () => {
  const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }) }); framed(h);
  stretched(h); toPan(h); h.frames(3); envelope(h); until(h, PALE); toTable(h); cut22(h); h.frames(30);
  const out = check('cut 2+2', h); toGuest(h); return out;
});
test('F6', 'tray with milk', () => {
  const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }) }); framed(h);
  stretched(h); toPan(h); h.frames(3); envelope(h); until(h, PALE); toTable(h); cut22(h); h.frames(30);
  const M = h.J('milkSpots()'); tap(h, M.at); milkStroke(h); h.frames(3);
  assert.equal(h.run('drizzleStrokes'), 1, 'milk on the roti');
  const out = check('tray + milk', h); toGuest(h); return out;
});
test('F7', 'carried: the roti in the hand on its way to the counter; the layout waits for the release, then the roti is back on the tray in the new layout', () => {
  const h = evening({ storage: saveMid(0, { sh: { bananas: 2 } }) }); framed(h);
  stretched(h); toPan(h); h.frames(3); envelope(h); until(h, PALE); toTable(h); cut22(h); h.frames(30);
  const B = rotiBox(h);
  h.touch('start', 't1', B.c.x, B.c.y); h.frames(3);
  const at = go(h, B.c, { x: B.c.x, y: B.c.y - 60 });
  assert.equal(h.run('gestureLive()'), true, 'the roti is in the hand');
  const out = check('carried', h, () => {
    h.touch('end', 't1', at.x, at.y); h.frames(30);
    assert.equal(h.run('dish.mode'), 'cut'); assert.equal(h.run('dish.tray'), true, 'back on the tray');
    assert.equal(h.run('pendingResize'), false, 'the deferred layout is applied after the release ' + h.run('JSON.stringify({st:action.state,dg:!!dishGesture,fl:!!dishFlight,mv:!!dishMove,fat:!!fatGesture,tw:!!dishTwist,cv:[cv.width,cv.height]})'));
    const r = h.J('[cv.width,cv.height]'); assert.deepEqual(r, [390, 844], 'canvas in the final window size');
  });
  toGuest(h); return out;
});

const okN = results.filter(r => r.status === 'PASS').length;
try { const dir = path.join(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'frame-results.json'), JSON.stringify(results, null, 1)); } catch (e) {}
console.log(`\nframe: ${okN}/${results.length} passed`);
process.exitCode = okN === results.length ? 0 : 1;
