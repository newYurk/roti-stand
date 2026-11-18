#!/usr/bin/env node
'use strict';
// Build 88 — the «visible gesture» batch (docs/visible-gesture-batch-spec.md): the sheet grows visibly per slap,
// its rim is thicker and lighter than the middle; a cut counts only from edge to edge, a short stroke leaves a
// line that fades; «нарезано» after 1 + 2 or 2 + 2; the uncut roti does not lift from the table; touching the edge
// of the roti on the tava lifts that corner (drawing only), a flick still flips.
// Pure Node/vm, the same mocks and touch drivers as evening-regression.cjs (helpers copied from there): every
// action goes through the stand's real window touch handlers. Says nothing about look or feel — the frames do.
//   node prototype/dough-closeup/checks/gesture-regression.cjs path/to/stand.js [--only G1,G2]
// Report: runs/checks/gesture-results.json of the checkout (runs/ is not in git).
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

const r3 = x => Math.round(x * 1000) / 1000;
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const pan = h => (h.J('gestures.filter(g=>g.kind==="pan").at(-1)') || {}).outcome || null;
const onTable = () => { const h = evening(); light(h); stretched(h); toPan(h); envelope(h); toTable(h); return h; };
// the separation of the two pieces of the first cut, in CSS px across the cut, as drawn (pieceShiftLive)
const partPx = h => h.J(`(()=>{const m=pieceShiftLive(dish.faces),c=dish.cuts[0];if(!m)return null;
  const ux=c.b.x-c.a.x,uy=c.b.y-c.a.y,l=Math.hypot(ux,uy),nx=-uy/l,ny=ux/l;let lo=Infinity,hi=-Infinity;
  for(const [f,o] of m){const s=o.x*nx+o.y*ny;if(s<lo)lo=s;if(s>hi)hi=s;}
  const o0=__harness.dishToClient({x:0,y:0}),q=__harness.dishToClient({x:nx*(hi-lo),y:ny*(hi-lo)});return Math.hypot(q.x-o0.x,q.y-o0.y)})()`);

// ── G1: the sheet grows visibly ───────────────────────────────────────────────────────────────
test('G1', 'a moderate slap adds ≥ 6 % of area while the dashes are far; the first sector reaches them on slap 8–10; the rim roll is drawn, opaque and lighter than the middle after 3, 6, 9 slaps; no dish (and no filling dashes) on the table', () => {
  const h = boot(TUNE, W, HH); H.press(h); h.J = code => JSON.parse(h.run(`JSON.stringify(${code})`));
  const dash = () => h.run(`(()=>{rimProfile();let m=0;for(let b=0;b<RIM_BINS;b++){const th=(b+0.5)/RIM_BINS*2*Math.PI-Math.PI;m=Math.max(m,rimProf[b]/targetAt(th))}return m})()`);
  // what the eye gets over the table: pigment × alpha over the table colour, middle (median thickness) vs rim cells
  // the rim roll (drawRimRoll) against the middle of the sheet: pigment × alpha over the table colour
  h.run('globalThis.__roll=0;{const s0=ctx.stroke;ctx.stroke=function(){if(ctx.strokeStyle===RIM_ROLL)__roll++;return s0&&s0.apply(this,arguments);};}');
  const look = () => h.J(`(()=>{const p=s=>s.match(/[\\d.]+/g).map(Number),over=s=>{const v=p(s),a=v[3]??1;return [0,1,2].map(k=>v[k]*a+UNDER[k]*(1-a))};
    const mid=[];for(let q=0;q<quads.length;q++){if(rimEdgeQ&&rimEdgeQ[q])continue;const [a,b,c,d]=quads[q];mid.push((thick[a]+thick[b]+thick[c]+thick[d])/4);}
    mid.sort((x,y)=>x-y);const tm=mid[mid.length>>1];
    return {tm,mid:over(tableSkin(tm,0)),rim:over(RIM_ROLL),midA:p(tableSkin(tm,0))[3]??1,rimA:p(RIM_ROLL)[3]??1}})()`);
  let a0 = h.metrics().area, dashAt = null; const rows = [], looks = {};
  for (let i = 0; i < 12 && h.run('stepNo') === 2 && h.run('phase') === 'TABLE'; i++) {
    const far = dash() < 0.9;
    H.slap(h, i, 2.3);
    const a = h.metrics().area, g = a / a0 - 1; a0 = a;
    rows.push({ n: i + 1, growth: r3(g), far });
    if (dashAt === null && dash() >= 0.995) dashAt = i + 1;
    assert.equal(h.run('!!dish'), false, 'stretching on the table: no dish, no filling dashes');
    if ([3, 6, 9].includes(i + 1)) { h.run('__roll=0'); h.tick(1, 1 / 60, true); looks[i + 1] = { ...look(), drawn: h.run('__roll') }; }
  }
  const farRows = rows.filter(r => r.far), minFar = Math.min(...farRows.map(r => r.growth));
  const out = { rows, dashAt, looks, summary: `area growth per moderate slap while far from the dashes ${farRows.map(r => (r.growth * 100).toFixed(1) + '%').join(' ')} (min ${(minFar * 100).toFixed(1)} %); dashes at slap ${dashAt}; ` +
    Object.entries(looks).map(([n, L]) => `after ${n}: rim roll lum ${lum(L.rim).toFixed(0)} α ${L.rimA.toFixed(2)} (drawn ${L.drawn}) vs middle ${lum(L.mid).toFixed(0)} α ${L.midA.toFixed(2)} (t ${L.tm.toFixed(3)})`).join('; ') };
  if (!(farRows.length >= 5 && minFar >= 0.06)) { const e = new assert.AssertionError({ message: out.summary }); e.partial = out; throw e; }
  assert.ok(dashAt >= 8 && dashAt <= 10, out.summary);
  for (const [n, L] of Object.entries(looks)) {
    assert.ok(L.rimA >= 0.99 && L.drawn > 0, `after ${n} slaps the rim roll is drawn and opaque: ${out.summary}`);
    assert.ok(lum(L.rim) > lum(L.mid) + 8, `after ${n} slaps the rim is lighter than the middle: ${out.summary}`);
  }
  return out;
});

// ── G2: a cut is seen and counts only from edge to edge ──────────────────────────────────────
test('G2', 'a stroke that stops short is not a cut: its dark line fades within 0.3 s, no line of words; an edge-to-edge stroke is a cut and parts the pieces by 2–3 px', () => {
  const h = onTable(); const B = rotiBox(h), w = B.r.x - B.l.x, msg0 = h.run('dish.message');
  // from outside the left edge to 15 % short of the right edge (was a cut until build 87: tolerance 0.15)
  drive(h, line({ x: B.l.x - w * 0.2, y: B.c.y }, { x: B.r.x - w * 0.15, y: B.c.y }, { v: 380, hold: 60 }), { settle: 1 });
  assert.equal(h.run('dish.cuts.length'), 0, 'stopped 15 % short: not a cut');
  assert.equal(h.run('!!cutFade'), true, 'the line of the stroke is still there, fading');
  // count knife-line strokes on the canvas mock (it does not log strokes itself)
  h.run('globalThis.__knife=0;{const s0=ctx.stroke;ctx.stroke=function(){if(ctx.strokeStyle===CUT_LINE)__knife++;return s0&&s0.apply(this,arguments);};}');
  h.tick(1, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  const drawnLine = h.run('__knife'); assert.ok(drawnLine > 0, 'the fading knife line is drawn');
  h.frames(30); h.tick(1, 1 / 60, true);
  assert.equal(h.run('cutFade'), null, 'gone after 0.5 s');
  h.run('__knife=0'); h.tick(1, 1 / 60, true);
  assert.equal(h.run('__knife'), 0, 'no knife line drawn after 0.5 s');
  assert.equal(h.run('dish.message'), msg0, 'no line of words pops up');
  // a stroke that starts in the middle (the old carry of an uncut roti) is a knife stroke too, and does not count
  drive(h, line(B.c, { x: B.r.x + w * 0.2, y: B.c.y }, { v: 380, hold: 60 }));
  assert.equal(h.run('dish.cuts.length'), 0, 'from the middle: not a cut');
  // edge to edge
  drive(h, line({ x: B.l.x - w * 0.2, y: B.c.y }, { x: B.r.x + w * 0.2, y: B.c.y }, { v: 380, hold: 60 }));
  assert.equal(h.run('dish.cuts.length'), 1, 'edge to edge: a cut');
  const part = partPx(h), sec = h.J('dishSectionGeometry(dish.faces).walls.length');
  assert.ok(part >= 2 && part <= 3, `the pieces part by ${part.toFixed(2)} CSS px`);
  let small; { const s = evening({ w: 375, hh: 667 }); light(s); stretched(s); toPan(s); envelope(s); toTable(s);
    const S = rotiBox(s), sw = S.r.x - S.l.x; drive(s, line({ x: S.l.x - sw * 0.2, y: S.c.y }, { x: S.r.x + sw * 0.2, y: S.c.y }, { v: 380, hold: 60 }));
    assert.equal(s.run('dish.cuts.length'), 1); small = partPx(s); assert.ok(small >= 2 && small <= 3, `375×667: the pieces part by ${small.toFixed(2)} CSS px`); }
  assert.ok(sec > 0, 'the section has walls (the filling shows in them)');
  h.tick(1, 1 / 60, true); assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { drawnLine, part, summary: `15 % short → 0 cuts, the line fading (drawn ${drawnLine}), gone after 0.5 s; from the middle → 0 cuts; edge to edge → 1 cut, pieces part ${part.toFixed(2)} CSS px (375×667: ${small.toFixed(2)}), ${sec} section walls` };
});

// ── G3: «нарезано» ────────────────────────────────────────────────────────────────────────────
test('G3', '2 + 2 and 1 + 2 are «нарезано», 1 + 1 is not', () => {
  const across = (h, B, k) => { const w = B.r.x - B.l.x, dy = (B.b.y - B.t.y) * 0.2; drive(h, line({ x: B.c.x + k * w / 6, y: B.t.y - dy }, { x: B.c.x + k * w / 6, y: B.b.y + dy }, { v: 380, hold: 60 })); };
  const along = (h, B, k) => { const w = B.r.x - B.l.x, hh = B.b.y - B.t.y; drive(h, line({ x: B.l.x - w * 0.2, y: B.c.y + k * hh / 6 }, { x: B.r.x + w * 0.2, y: B.c.y + k * hh / 6 }, { v: 380, hold: 60 })); };
  const a = onTable(), A = rotiBox(a);
  along(a, A, 0); across(a, A, -1);
  assert.deepEqual(a.J('cutFamilies()'), [1, 1]); assert.equal(a.run('cutEnough()'), false, '1 + 1: not yet');
  across(a, A, 1); assert.deepEqual(a.J('cutFamilies()'), [1, 2]); assert.equal(a.run('cutEnough()'), true, '1 + 2: «нарезано»');
  const b = onTable(), Bb = rotiBox(b);
  along(b, Bb, -1); along(b, Bb, 1); assert.equal(b.run('cutEnough()'), false, '2 + 0: not yet');
  across(b, Bb, -1); assert.equal(b.run('cutEnough()'), true, '2 + 1');
  const T = rotiBox(b); across(b, T, 1);
  assert.deepEqual(b.J('cutFamilies()'), [2, 2]); assert.equal(b.run('cutEnough()'), true, '2 + 2: «нарезано»');
  assert.deepEqual(a.errors.concat(b.errors), []);
  return { summary: `1 + 1 → no; 1 + 2 → «нарезано»; 2 + 2 → «нарезано» (${b.run('dish.cuts.length')} cuts)` };
});

// ── G4: the uncut roti stays on the table ─────────────────────────────────────────────────────
test('G4', 'until «нарезано» the roti does not lift from the table: to the counter, to the rim and the middle of the tava it stays, nothing pops up, it never goes back to the tava', () => {
  const h = onTable(), rows = [];
  const pose = () => h.J('(()=>{const p=dishShownPose();return [Math.round(p.x),Math.round(p.y)]})()');
  for (const cuts of [0, 1]) {
    if (cuts) { const B = rotiBox(h), w = B.r.x - B.l.x; drive(h, line({ x: B.l.x - w * 0.2, y: B.c.y }, { x: B.r.x + w * 0.2, y: B.c.y }, { v: 380, hold: 60 })); }
    assert.equal(h.run('dish.cuts.length'), cuts);
    for (const how of [undefined, { short: true }, { short: 'pan' }]) {
      const p0 = pose(), m0 = h.run('dish.message'), B = rotiBox(h), S = h.spots(), n0 = h.run('gestures.filter(g=>g.kind==="pan").length');
      const to = how && how.short === 'pan' ? S.pan : how ? { x: S.pan.x - S.panR * 0.93, y: S.pan.y } : S.counter;
      // in the middle of the move: not in the hand
      const pts = line(B.c, to, { v: 420, hold: 80 }); drive(h, pts.slice(0, Math.ceil(pts.length / 2)).concat([]), { settle: 0 });
      const held = h.run('!!(dishGesture&&dishGesture.carry)'); h.touch('end', 't1', to.x, to.y); h.frames(30);
      const fresh = h.J(`gestures.filter(g=>g.kind==="pan").slice(${n0}).map(g=>g.outcome)`);
      rows.push({ cuts, to: how ? how.short : 'counter', held, mode: h.run('dish.mode'), outcome: fresh.join('/') || 'none', moved: JSON.stringify(pose()) !== JSON.stringify(p0) });
      assert.equal(held, false, 'not in the hand'); assert.equal(h.run('dish.mode'), 'cut', 'still on the table'); assert.notEqual(h.run('phase'), 'PAN');
      assert.ok(!fresh.some(o => /^serve|pan-back|remove|carry/.test(o || '')), `no carry outcome (${fresh.join('/')})`);
      assert.deepEqual(pose(), p0, 'it did not move');
      assert.ok(!/сначала|снова на таве/.test(h.run('dish.message')), `nothing pops up: «${h.run('dish.message')}»`);
      assert.equal(h.run('dish.cuts.length'), cuts); assert.equal(h.eve().rotiDone, 0);
    }
  }
  assert.ok(!/сначала дорежь|сначала разрежь|снова на таве/.test(fs.readFileSync(H.sourcePath, 'utf8').replace(/\/\/.*$/gm, '')), 'the lines are gone from stand.js');
  assert.deepEqual(h.errors, []);
  return { summary: `${rows.length} carries of an uncut roti (0 and 1 cut; counter, tava rim, tava middle): none in the hand, none moved, outcomes ${[...new Set(rows.map(r => r.outcome))].join('/')}` };
});

// ── G5: the corner lifts on the tava ──────────────────────────────────────────────────────────
test('G5', 'touching the edge of the roti on the tava without a flick lifts that corner (the underside with its colour shows), released it lies down after 0.4 s, nothing flips; a flick flips', () => {
  const h = evening(); light(h); stretched(h); toPan(h); envelope(h);
  while (h.run('fryStep(meanCook())') < 2) h.frames(10);
  const e = h.J(`(()=>{const b=dishBounds();return __harness.dishToClient({x:b.right-0.02,y:(b.top+b.bottom)/2})})()`);
  const flips0 = h.run('dish.flips||0'), faces0 = h.run('JSON.stringify(dish.faces.map(f=>f.points))');
  // a tap: the corner goes up and lies down within CORNER_LIFT_S
  h.touch('start', 't1', e.x, e.y); h.frames(2); h.touch('end', 't1', e.x, e.y);
  let up = 0, frames = 0; while (h.run('!!cornerLift') && frames < 60) { h.tick(1, 1 / 60, true); up = Math.max(up, h.run('cornerLift?cornerLiftAmount():0')); frames++; }
  assert.ok(up > 0.9, `the corner rose (${r3(up)})`); assert.ok(frames >= 20 && frames <= 30, `a tap lifts it for about 0.4 s (${frames} frames)`);
  // a hold: up while the finger stays, the underside is the steel side (browned), down after release
  h.touch('start', 't1', e.x, e.y); h.frames(40); h.tick(1, 1 / 60, true);
  const held = h.run('cornerLiftAmount()'), cap = h.J('(()=>{const c=cornerLiftCap();return c?c.P.length:0})()');
  const under = h.J('cornerUnderColor()'), top = h.J('(()=>{const L=cornerLift,q={x:L.a.x+L.n.x*.03,y:L.a.y+L.n.y*.03};const f=dish.faces.filter(f=>f.kind==="dough"&&pointInFace(f.points,q.x,q.y)).at(-1);return dishCrustColor(f)})()');
  assert.ok(held > 0.99, `held 0.7 s: still up (${r3(held)})`); assert.ok(cap >= 3, 'the lifted cap is a polygon');
  assert.ok(lum(under) < lum(top) - 10, `the underside is browner than the top: ${lum(under).toFixed(0)} vs ${lum(top).toFixed(0)}`);
  h.touch('end', 't1', e.x, e.y); h.frames(12); h.tick(1, 1 / 60, true);
  assert.equal(h.run('!!cornerLift'), false, 'released: it lies down');
  assert.equal(h.run('dish.flips||0'), flips0, 'no flip'); assert.equal(h.run('JSON.stringify(dish.faces.map(f=>f.points))'), faces0, 'the material did not change');
  assert.equal(h.run('loopErrs'), 0);
  flick(h); assert.equal(h.run('dish.flips'), flips0 + 1, 'a flick from the edge flips');
  assert.deepEqual(h.errors, []);
  return { summary: `tap: up to ${r3(up)} for ${frames} frames; hold 0.7 s: ${r3(held)}, cap ${cap} points, underside lum ${lum(under).toFixed(0)} vs top ${lum(top).toFixed(0)}; down after release; flips ${flips0} → ${h.run('dish.flips')} by a flick` };
});

const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\ngesture: ${passed}/${results.length} passed`);
try {
  const dir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gesture-results.json'), JSON.stringify({ source: H.sourcePath, sha256: H.sourceSha256, passed, total: results.length, results }, null, 2));
} catch (e) { console.log('report not written: ' + e.message); }
process.exit(passed === results.length ? 0 : 1);
