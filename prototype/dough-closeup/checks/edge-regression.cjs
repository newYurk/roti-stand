#!/usr/bin/env node
'use strict';
// Build 74: the drawn edge of the sheet. The sheet is a 38×38 grid clipped to a disc, so its
// boundary is made of cell sides — a staircase that survives any stretching and went into the
// flight view and into the dish faces. The stand now draws the rim nodes on a line smoothed along
// the rim loop (rimDraw: dX, dY); physics (px, py) is untouched.
// This check measures the raggedness of the outline that is actually drawn, BEFORE (RIM_K = 0:
// the rim as in physics, i.e. build 73) and AFTER (the stand's own RIM_K), on the same sheet:
//   table   — a sheet stretched by real pulls, polygons recorded from the canvas calls of draw();
//   in hand — the same sheet carried (xf), polygons recorded from draw();
//   tava    — the same sheet landed (startDish), dish.faces through the stand's own projection;
//   rect    — after two opposite envelope folds; envelope — after four;
//   sample  — the stand's «образец» sheet moved onto the square target, on the tava.
// The outline is what is left after cancelling the sides shared by two polygons: the rim of the
// sheet (in a folded dish — the rim of every flap; crease sides coincide and cancel).
// Numbers per state:
//   len/fit  — outline length ÷ length of its smooth fit (moving average along the arc, window
//              ±3 % of the outline's bounding diagonal). 1.00 = nothing to smooth away.
//   turns    — sum of |turning angle| ÷ 360°. A smooth convex outline makes exactly 1 turn.
//   sharp    — outline vertices that turn by more than 30° (a staircase step is two of ~90°).
//   dev      — RMS distance from the outline to its smooth fit, % of the mean cell side.
// Folded states keep real kinks where a rim crosses a crease, so they are judged by the change.
// Pure Node/vm, same mocks as model-regression.cjs; not a browser and says nothing about the look.
//   node prototype/dough-closeup/checks/edge-regression.cjs path/to/stand.js [--only G1,G3]
// ALWAYS pass the stand.js of the checkout under test as the first argument.
// Report: runs/checks/edge-results.json of the checkout (runs/ is not in git).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const quiet = console.log; console.log = () => {};
const H = require('./model-regression.cjs');
console.log = quiet;
const { boot, press, pull, slap } = H;
const args = process.argv.slice(3);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',')) : null; })();
const results = [];
function test(id, name, fn) {
  if (only && !only.has(id)) return;
  const t0 = Date.now();
  try { const result = fn() || {}; results.push({ id, name, status: 'PASS', seconds: (Date.now() - t0) / 1000, result }); }
  catch (err) { results.push({ id, name, status: 'FAIL', seconds: (Date.now() - t0) / 1000, error: err.stack, result: err.partial }); }
  const r = results.at(-1);
  console.log(`${r.status} ${id} ${name} (${r.seconds.toFixed(1)} s)` + (r.status === 'FAIL' ? `\n     ${String(r.error).split('\n')[0]}` : ''));
  if (r.result && r.result.summary) console.log('     ' + r.result.summary);
}
function failWith(partial, message) { const e = new assert.AssertionError({ message }); e.partial = partial; throw e; }
const r3 = x => Math.round(x * 1000) / 1000;
const TUNE = { com: 100, creep: 100, brk: 100 };

// ── the outline of a set of drawn polygons ────────────────────────────────────────────────────
const Q = 1e4;
const pkey = p => Math.round(p.x * Q) + ',' + Math.round(p.y * Q);
function outline(polys) {
  const edges = new Map();
  for (const ps of polys) for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length], ka = pkey(a), kb = pkey(b);
    if (ka === kb) continue;
    const k = ka < kb ? ka + '|' + kb : kb + '|' + ka, e = edges.get(k);
    if (e) e.n++; else edges.set(k, { a, b, ka, kb, n: 1 });
  }
  const free = [...edges.values()].filter(e => e.n % 2 === 1), at = new Map();
  for (const e of free) for (const k of [e.ka, e.kb]) { if (!at.has(k)) at.set(k, []); at.get(k).push(e); }
  // Chains: walk through vertices of degree 2; a vertex of another degree ends a chain.
  const used = new Set(), chains = [];
  const walk = (e, fromKey) => {
    const pts = []; let key = fromKey, cur = e;
    for (;;) {
      used.add(cur);
      const nextKey = cur.ka === key ? cur.kb : cur.ka; pts.push(cur.ka === key ? cur.b : cur.a); key = nextKey;
      const list = at.get(key); if (list.length !== 2) return { pts, closed: false };
      const nx = list[0] === cur ? list[1] : list[0];
      if (used.has(nx)) return { pts, closed: nx === e };
      cur = nx;
    }
  };
  for (const [k, list] of at) if (list.length !== 2) for (const e of list) if (!used.has(e)) { const w = walk(e, k); chains.push({ pts: [e.ka === k ? e.a : e.b, ...w.pts], closed: false }); }
  for (const e of free) if (!used.has(e)) { const w = walk(e, e.ka); chains.push({ pts: w.closed ? w.pts : [e.a, ...w.pts], closed: w.closed }); }
  return { chains, freeEdges: free.length };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function chainTurns(c) {
  const p = c.pts, n = p.length, out = [];
  for (let i = c.closed ? 0 : 1; i < (c.closed ? n : n - 1); i++) {
    const a = p[(i - 1 + n) % n], b = p[i], d = p[(i + 1) % n];
    const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - b.x, vy = d.y - b.y;
    if (Math.hypot(ux, uy) < 1e-9 || Math.hypot(vx, vy) < 1e-9) continue;
    out.push(Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)));
  }
  return out;
}
// Smooth fit: the chain resampled every ds, each sample replaced by the mean of the samples
// within ±win of arc (the window wraps on a closed chain and is cut at the ends of an open one).
function fit(c, ds, win) {
  const p = c.closed ? [...c.pts, c.pts[0]] : c.pts, s = [];
  let carry = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    const L = dist(p[i], p[i + 1]); let t = carry;
    for (; t < L; t += ds) s.push({ x: p[i].x + (p[i + 1].x - p[i].x) * t / L, y: p[i].y + (p[i + 1].y - p[i].y) * t / L });
    carry = t - L;
  }
  const n = s.length, k = Math.max(1, Math.round(win / ds)), f = [];
  if (n < 3) return { samples: s, fit: s.slice() };
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, m = 0;
    for (let j = -k; j <= k; j++) {
      let q = i + j; if (c.closed) q = (q % n + n) % n; else if (q < 0 || q >= n) continue;
      x += s[q].x; y += s[q].y; m++;
    }
    f.push({ x: x / m, y: y / m });
  }
  return { samples: s, fit: f };
}
function measure(polys, cell) {
  const { chains, freeEdges } = outline(polys);
  const all = chains.flatMap(c => c.pts), xs = all.map(p => p.x), ys = all.map(p => p.y);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const ds = diag / 4000, win = diag * 0.03;
  let len = 0, fitLen = 0, turn = 0, sharp = 0, dev2 = 0, devN = 0, maxTurn = 0, vertices = 0;
  for (const c of chains) {
    const p = c.pts, n = p.length;
    for (let i = 0; i + 1 < n; i++) len += dist(p[i], p[i + 1]);
    if (c.closed) len += dist(p[n - 1], p[0]);
    const t = chainTurns(c); vertices += t.length;
    for (const a of t) { turn += a; if (a > Math.PI / 6) sharp++; if (a > maxTurn) maxTurn = a; }
    const f = fit(c, ds, win), m = f.fit.length;
    for (let i = 0; i + 1 < m; i++) fitLen += dist(f.fit[i], f.fit[i + 1]);
    if (c.closed && m > 1) fitLen += dist(f.fit[m - 1], f.fit[0]);
    for (let i = 0; i < m; i++) { dev2 += dist(f.samples[i], f.fit[i]) ** 2; devN++; }
  }
  return { chains: chains.length, closed: chains.filter(c => c.closed).length, freeEdges, vertices, lenPx: r3(len), lenOverFit: r3(len / fitLen), turns: r3(turn / (2 * Math.PI)),
    sharp, maxTurnDeg: r3(maxTurn * 180 / Math.PI), devPctCell: r3(Math.sqrt(dev2 / Math.max(1, devN)) / cell * 100) };
}

// ── what the stand draws ──────────────────────────────────────────────────────────────────────
// Polygons of the sheet's cells as draw() sends them to the canvas (variant C: the real canvas).
function drawnQuads(h) {
  const ctx = h.run('ctx'), keep = {}, polys = []; let cur = null;
  for (const k of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'ellipse', 'quadraticCurveTo', 'arc', 'rect']) keep[k] = ctx[k];
  ctx.beginPath = () => { cur = { pts: [], curved: false }; };
  ctx.moveTo = (x, y) => { if (cur) cur.pts.push({ x, y }); };
  ctx.lineTo = (x, y) => { if (cur) cur.pts.push({ x, y }); };
  ctx.ellipse = ctx.quadraticCurveTo = ctx.arc = ctx.rect = () => { if (cur) cur.curved = true; };
  ctx.closePath = () => { keep.closePath.call(ctx); };
  ctx.fill = () => { if (cur && !cur.curved && cur.pts.length === 4 && /^rgb\(/.test(String(ctx.fillStyle))) polys.push(cur.pts); cur = null; };
  try { h.run('draw()'); } finally { Object.assign(ctx, keep); }
  return polys;
}
// Dough faces of the dish through the projection drawDish uses for a resting dish (relief
// offsets — the walls and the lifted tops — are not included: this is the footprint).
const dishPolys = h => JSON.parse(h.run(`JSON.stringify((()=>{const pose=dishPose();
  return dish.faces.filter(f=>f.kind==="dough").map(f=>f.points.map(p=>{const x=pose.x+p.x*pose.scale,y=pose.y+p.y*pose.scale;return{x:prX(x,y),y:prY(x,y)};}));})())`));
// Mean screen length of a cell side of the sheet / of a dish face side: the scale of one step.
const cellTable = h => h.run(`(()=>{let s=0,n=0;for(const [a,b,d,e] of quads)for(const [u,v] of [[a,b],[b,d],[d,e],[e,a]]){s+=Math.hypot(prX(px[u],py[u])-prX(px[v],py[v]),prY(px[u],py[u])-prY(px[v],py[v]));n++;}return s/n;})()`);
const snapSheet = h => h.run(`globalThis.__edge={px:px.slice(),py:py.slice(),prx:prx.slice(),pry:pry.slice(),thick:thick.slice(),phase,stepNo};`);
const backSheet = h => h.run(`{const s=__edge;px.set(s.px);py.set(s.py);prx.set(s.prx);pry.set(s.pry);thick.set(s.thick);vx.fill(0);vy.fill(0);phase=s.phase;stepNo=s.stepNo;xf=null;dish=null;dishGesture=null;dishFlight=null;dishMove=null;clearAction();syncDishUI();}`);
const toPan = h => { h.run('{const c=centerOfSheet();xf={cx:c.x,cy:c.y};bakeTransform(panC.x-c.x,panC.y-c.y,0);xf=null;phase="PAN";measureThickness();startDish();}'); h.tick(2); };
// A snapped envelope fold of side k, the way a stroke from the side to the centre line plans it.
const foldSide = (h, k) => h.run(`(()=>{const E=dish.env,d=envSide(E,${k}),g={anchor:{x:E.c.x+d.x*E.h[${k}],y:E.c.y+d.y*E.h[${k}]},target:{x:E.c.x,y:E.c.y}};
  const s=snapFold(g,true);return !!s&&s.side===${k}&&foldDish(s.anchor,s.target,null,s.side);})()`);
const withRim = (h, k, fn) => { const own = h.run('RIM_K'); h.run(`RIM_K=${k === null ? own : k}`); try { return fn(); } finally { h.run(`RIM_K=${own}`); } };

// A sheet stretched towards the square target by real pulls (sides, then corners, three rounds).
function stretched(w = 390, hh = 844, rounds = 3) {
  const h = boot(TUNE, w, hh); press(h);
  const pulls = [];
  for (let round = 0; round < rounds; round++) for (const off of [0, Math.PI / 4]) for (let k = 0; k < 4; k++) {
    const r = pull(h, off + k * Math.PI / 2, 0.8, 1.5); pulls.push(r && r.kind);
  }
  h.tick(120);
  const m = h.metrics();
  return { h, pulls: pulls.length, progress: r3(m.progress), broken: m.broken, fill: r3(h.run('sheetFill()')), loop: h.run('rimLoop.length'), rimK: h.run('RIM_K') };
}
// The stand's sample sheet (step 3) moved radially onto the square target, as envelope-regression does.
function sample(w = 390, hh = 844) {
  const h = boot(TUNE, w, hh); h.run('stepNo=3;reset();'); h.tick(2);
  h.run('{const c=centerOfSheet(),R=sheetRadius();for(let i=0;i<N;i++){const x=px[i]-c.x,y=py[i]-c.y,k=targetAt(Math.atan2(y,x))/R;px[i]=prx[i]=c.x+x*k;py[i]=pry[i]=c.y+y*k;}}');
  return h;
}
const line = (name, b, a) => `${name}: len/fit ${b.lenOverFit}→${a.lenOverFit}, turns ${b.turns}→${a.turns}, sharp ${b.sharp}→${a.sharp}, dev ${b.devPctCell}→${a.devPctCell} % of a cell`;
// Limits. A closed unfolded outline must read as one smooth loop; a folded one keeps the kinks
// where a rim crosses a crease, so there the staircase (sharp turns, excess length) must go.
function judgeLoop(name, b, a, bad, stair = false, corner = 0) {
  if (a.chains !== 1 || a.closed !== 1) bad.push(`${name}: the outline is not one closed loop (${a.chains} chains)`);
  if (!(a.lenOverFit <= 1.02)) bad.push(`${name}: len/fit ${a.lenOverFit} > 1.02`);
  if (!(a.turns <= 1.6)) bad.push(`${name}: ${a.turns} turns > 1.6`);
  if (a.sharp > corner || (a.sharp && !(a.maxTurnDeg <= 45))) bad.push(`${name}: ${a.sharp} sharp vertices, the sharpest ${a.maxTurnDeg}°`);
  if (!(a.turns <= b.turns && a.lenOverFit <= b.lenOverFit && a.devPctCell <= b.devPctCell)) bad.push(`${name}: the smoothed outline is not smoother than the physics rim`);
  if (stair && !(b.lenOverFit >= 1.08 && b.sharp >= 40)) bad.push(`${name}: the «before» outline is not a staircase (len/fit ${b.lenOverFit}, sharp ${b.sharp}) — the check measures nothing`);
}
function judgeFolded(name, b, a, bad, stair = false) {
  if (!(a.lenOverFit <= 1.06)) bad.push(`${name}: len/fit ${a.lenOverFit} > 1.06`);
  if (!(a.sharp <= 12)) bad.push(`${name}: ${a.sharp} sharp vertices (crease crossings of four folds give up to ~12)`);
  if (!(a.turns <= b.turns && a.sharp <= b.sharp && a.lenOverFit <= b.lenOverFit)) bad.push(`${name}: the smoothed outline is not smoother than the physics rim`);
  if (stair && !(a.sharp <= b.sharp * 0.25 && a.turns <= b.turns * 0.35)) bad.push(`${name}: sharp ${b.sharp}→${a.sharp}, turns ${b.turns}→${a.turns}: the staircase is still there`);
}

for (const [id, w, hh] of [['G1', 390, 844], ['G2', 844, 390]]) {
  test(id, `${w}×${hh}: a sheet stretched by pulls — the outline drawn on the table, in the hand, on the tava, as a rectangle and as an envelope, before (rim as in physics) and after (smoothed rim)`, () => {
    const S = stretched(w, hh), h = S.h, rows = {}, bad = [];
    assert.ok(S.loop > 100, `rim loop of ${S.loop} nodes`);
    assert.equal(S.broken, 0, 'the stretched sheet is not torn');
    snapSheet(h);
    const cell = cellTable(h), quads = h.run('quads.length');
    const each = (name, prep, grab, cellPx, judge) => {
      const m = [0, null].map(k => withRim(h, k, () => { backSheet(h); prep(); return measure(grab(), cellPx()); }));
      rows[name] = { before: m[0], after: m[1] }; judge(name, m[0], m[1], bad);
    };
    each('table', () => {}, () => { const p = drawnQuads(h); assert.equal(p.length, quads, 'every cell is drawn once'); return p; }, () => cell, judgeLoop);
    each('in hand', () => h.run('{const c=centerOfSheet();xf={cx:c.x,cy:c.y,ox:targetR*0.5,oy:-targetR*0.2,th:0.6,lift:targetR*0.3};}'),
      () => { const p = drawnQuads(h); assert.equal(p.length, quads, 'every cell is drawn once in the hand'); return p; }, () => cell,
      // The squeezed cells at the corner tips of the stretched sheet are no longer drawn collapsed (G6), so the
      // corner keeps its real turn; in the turned, lifted view two of the tips turn a little over 30° (as in physics).
      (name, b, a, bad) => judgeLoop(name, b, a, bad, false, 2));
    const dishCell = () => h.run('targetR') * cell / h.run('targetR') * 1;   // faces keep the cell size: the tava pose scale is targetR
    each('tava', () => toPan(h), () => dishPolys(h), dishCell, judgeLoop);
    each('rect', () => { toPan(h); assert.ok(foldSide(h, 0) && foldSide(h, 1), 'two opposite folds'); }, () => dishPolys(h), dishCell, judgeFolded);
    each('envelope', () => { toPan(h); for (const k of [0, 1, 2, 3]) assert.ok(foldSide(h, k), `fold ${k}`); assert.equal(h.run('envelopeDone()'), true); }, () => dishPolys(h), dishCell, judgeFolded);
    // physics is not touched by drawing: the nodes after all of the above are the snapshot
    backSheet(h); h.run('draw()');
    const moved = h.run('(()=>{let m=0;for(let i=0;i<N;i++)m=Math.max(m,Math.abs(px[i]-__edge.px[i]),Math.abs(py[i]-__edge.py[i]));return m;})()');
    if (moved !== 0) bad.push(`draw() moved physics nodes by ${moved}`);
    // how far the drawn rim is from the physics rim, in cells; inner nodes are not moved at all
    const shift = JSON.parse(h.run(`JSON.stringify((()=>{rimDraw();const rim=new Set(rimLoop);let mx=0,s=0,inner=0;const hcell=${cell};
      for(let i=0;i<N;i++){const d=Math.hypot(prX(dX[i],dY[i])-prX(px[i],py[i]),prY(dX[i],dY[i])-prY(px[i],py[i]));if(rim.has(i)){mx=Math.max(mx,d);s+=d;}else inner=Math.max(inner,d);}
      return {max:mx/hcell,mean:s/rim.size/hcell,inner};})())`));
    if (shift.inner !== 0) bad.push(`inner nodes are drawn off their place by ${shift.inner}`);
    if (!(shift.max < 0.75)) bad.push(`a rim node is drawn ${r3(shift.max)} cells off its place`);
    const out = { sheet: { pulls: S.pulls, progress: S.progress, fill: S.fill, rimLoop: S.loop, RIM_K: S.rimK, cellPx: r3(cell) }, rows, rimShiftCells: { max: r3(shift.max), mean: r3(shift.mean) }, bad,
      summary: `sheet after ${S.pulls} pulls: ${S.progress} of the target radius, fill ${S.fill}, rim loop ${S.loop} nodes, window ±${S.rimK}\n     ` + Object.entries(rows).map(([k, v]) => line(k, v.before, v.after)).join('\n     ')
        + `\n     drawn rim vs physics rim: mean ${r3(shift.mean)}, max ${r3(shift.max)} of a cell; physics nodes moved by draw: ${moved}` };
    if (bad.length) failWith(out, bad.join('; '));
    return out;
  });
}
test('G3', 'the sample sheet («образец») on the square target: table, tava, rectangle, envelope — before and after', () => {
  const h = sample(), rows = {}, bad = [];
  snapSheet(h);
  const cell = cellTable(h);
  const each = (name, prep, grab, judge) => {
    const m = [0, null].map(k => withRim(h, k, () => { backSheet(h); prep(); return measure(grab(), cell); }));
    rows[name] = { before: m[0], after: m[1] }; judge(name, m[0], m[1], bad, true);
  };
  each('table', () => {}, () => drawnQuads(h), judgeLoop);
  each('tava', () => toPan(h), () => dishPolys(h), judgeLoop);
  each('rect', () => { toPan(h); assert.ok(foldSide(h, 0) && foldSide(h, 1)); }, () => dishPolys(h), judgeFolded);
  each('envelope', () => { toPan(h); for (const k of [0, 1, 2, 3]) assert.ok(foldSide(h, k)); }, () => dishPolys(h), judgeFolded);
  const out = { rows, bad, summary: Object.entries(rows).map(([k, v]) => line(k, v.before, v.after)).join('\n     ') };
  if (bad.length) failWith(out, bad.join('; '));
  return out;
});
test('G5', 'the sheet right after flattening and after the first round of pulls (the physics rim has had little time to settle): the outline drawn on the table', () => {
  const rows = {}, bad = [];
  for (const [name, rounds] of [['flattened', 0], ['1 round', 1]]) {
    const S = stretched(390, 844, rounds), h = S.h, cell = cellTable(h);
    const disc = h.run('sheetLooksDisc()');
    // while the sheet still reads as a disc the stand clips the cells by an ellipse or by the binned hull; measure the cells themselves
    const m = [0, null].map(k => withRim(h, k, () => measure(drawnQuads(h), cell)));
    rows[name] = { before: m[0], after: m[1], disc, progress: S.progress }; judgeLoop(name, m[0], m[1], bad);
  }
  const out = { rows, bad, summary: Object.entries(rows).map(([k, v]) => line(`${k} (${v.progress} of the target radius${v.disc ? ', drawn inside the disc clip' : ''})`, v.before, v.after)).join('\n     ') };
  if (bad.length) failWith(out, bad.join('; '));
  return out;
});
test('G4', 'a torn rim is not smoothed over: nodes of a torn rim cell and their window keep the physics position; a hole inside the sheet changes nothing at the rim', () => {
  const h = sample(); h.run('rimDraw()');
  const before = JSON.parse(h.run('JSON.stringify(rimLoop.map(i=>[dX[i],dY[i]]))'));
  // a hole in the middle
  h.run('{const c=centerOfSheet();let q=0,best=1e9;for(let k=0;k<quads.length;k++){const a=quads[k][0],d=Math.hypot(px[a]-c.x,py[a]-c.y);if(d<best){best=d;q=k;}}for(const cc of quadCons[q])cc.broken=1;}');
  h.run('rimDraw()');
  const inner = JSON.parse(h.run('JSON.stringify(rimLoop.map(i=>[dX[i],dY[i]]))'));
  const sameAfterHole = inner.every((p, i) => p[0] === before[i][0] && p[1] === before[i][1]);
  // a torn rim cell
  h.run('for(const cc of quadCons[rimLoopQuad[10]])cc.broken=1;rimDraw();');
  const st = JSON.parse(h.run(`JSON.stringify((()=>{const n=rimLoop.length,at=i=>{const id=rimLoop[(i+n)%n];return Math.hypot(dX[id]-px[id],dY[id]-py[id]);};
    let moved=0;for(let i=0;i<n;i++)if(at(i)>0)moved++;return {n,raw:[9,10,11,12].map(at),far:at(40)>0||at(41)>0||at(42)>0,moved};})())`));
  const out = { sameAfterHole, ...st, summary: `inner hole: rim unchanged ${sameAfterHole}; torn rim cell: its nodes and the next ones drawn ${st.raw.map(r3).join('/')} off physics (0 = as in physics), ${st.moved}/${st.n} rim nodes still smoothed` };
  if (!sameAfterHole || st.raw[1] !== 0 || st.raw[2] !== 0 || st.raw[0] !== 0 || st.raw[3] !== 0 || !st.far) failWith(out, out.summary);
  return out;
});

// How the drawn sheet differs from the physics sheet, cell by cell: rim shift in mean cell sides,
// cells drawn inside out (area sign flipped) or collapsed (under 15 % of the physics area), the
// smallest drawn/physics area ratio, and the turning of the drawn rim loop.
const CELLS = `JSON.stringify((()=>{rimDraw();let s=0,n=0;for(const [a,b,d,e] of quads)for(const [u,v] of [[a,b],[b,d],[d,e],[e,a]]){s+=Math.hypot(px[u]-px[v],py[u]-py[v]);n++;}const cell=s/n;
  let mx=0,sm=0;for(const i of rimLoop){const d=Math.hypot(dX[i]-px[i],dY[i]-py[i]);sm+=d;if(d>mx)mx=d;}
  let flipped=0,collapsed=0,minRatio=9;for(let q=0;q<quads.length;q++){const ids=quads[q];const ar=(X,Y)=>{let a=0;for(let k=0;k<4;k++){const i=ids[k],j=ids[(k+1)%4];a+=X[i]*Y[j]-X[j]*Y[i];}return a/2;};
    const ap=ar(px,py),ad=ar(dX,dY);if(ap===0)continue;if(ap*ad<0)flipped++;else if(Math.abs(ad)<0.15*Math.abs(ap))collapsed++;minRatio=Math.min(minRatio,ad/ap);}
  let sharp=0,turn=0;const L=rimLoop,m=L.length;for(let i=0;i<m;i++){const a=L[(i+m-1)%m],b=L[i],c=L[(i+1)%m];const ux=dX[b]-dX[a],uy=dY[b]-dY[a],vx=dX[c]-dX[b],vy=dY[c]-dY[b];
    const t=Math.abs(Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy));turn+=t;if(t>Math.PI/6)sharp++;}
  return {shiftMax:mx/cell,shiftMean:sm/rimLoop.length/cell,flipped,collapsed,minRatio,turns:turn/2/Math.PI,sharp,broken:cons.filter(c=>c.broken).length};})())`;
test('G6', 'the smoothing never collapses or flips a cell and never draws a rim node far from physics: flattened, 16 pulls, then 4 slaps (squeezed corner cells), with and without the limits', () => {
  const h = boot(TUNE, 390, 844); press(h);
  const rows = {}, bad = [];
  const own = JSON.parse(h.run('JSON.stringify({cap:RIM_CAP,area:RIM_AREA})'));
  const rec = name => {
    h.run('RIM_CAP=0;RIM_AREA=0'); const off = JSON.parse(h.run(CELLS));
    h.run(`RIM_CAP=${own.cap};RIM_AREA=${own.area}`); const on = JSON.parse(h.run(CELLS));
    h.run('RIM_K_OWN=RIM_K;RIM_K=0'); const phys = JSON.parse(h.run(CELLS)); h.run('RIM_K=RIM_K_OWN');
    rows[name] = { unlimited: off, limited: on, physics: { turns: phys.turns, sharp: phys.sharp } };
    if (on.flipped || on.collapsed) bad.push(`${name}: ${on.flipped} cells drawn inside out, ${on.collapsed} collapsed`);
    if (!(on.minRatio >= own.area - 1e-6)) bad.push(`${name}: a cell is drawn at ${r3(on.minRatio)} of its physics area (< ${own.area})`);
    if (!(on.shiftMax < 0.75)) bad.push(`${name}: a rim node is drawn ${r3(on.shiftMax)} cells off its place`);
    if (!(on.turns <= phys.turns && on.sharp <= phys.sharp)) bad.push(`${name}: the limited outline (turns ${r3(on.turns)}, sharp ${on.sharp}) is rougher than the physics rim (${r3(phys.turns)}, ${phys.sharp})`);
    if (on.broken) bad.push(`${name}: the sheet is torn (${on.broken}) — the state is not the one this check is about`);
  };
  rec('flattened');
  for (let round = 0; round < 2; round++) for (const off of [0, Math.PI / 4]) for (let k = 0; k < 4; k++) pull(h, off + k * Math.PI / 2, 0.8, 1.5);
  h.tick(120); rec('16 pulls');
  for (let i = 0; i < 4; i++) slap(h, i, 2.3);
  h.tick(200); rec('16 pulls + 4 slaps');
  const f = v => `shift max ${r3(v.shiftMax)} mean ${r3(v.shiftMean)} of a cell, flipped ${v.flipped}, collapsed ${v.collapsed}, min drawn/physics area ${r3(v.minRatio)}, turns ${r3(v.turns)}, sharp ${v.sharp}`;
  const out = { limits: own, rows, bad, summary: Object.entries(rows).map(([k, v]) => `${k}: no limits — ${f(v.unlimited)}\n       with limits (cap ${own.cap}, area ${own.area}) — ${f(v.limited)}; physics rim: turns ${r3(v.physics.turns)}, sharp ${v.physics.sharp}`).join('\n     ') };
  if (!Object.values(rows).some(v => v.unlimited.flipped + v.unlimited.collapsed > 0)) bad.push('no state collapses a cell without the limits — the check measures nothing');
  if (bad.length) failWith(out, bad.join('; '));
  return out;
});

const reportDir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
if (require.main === module) {
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'edge-results.json');
  fs.writeFileSync(reportPath, JSON.stringify({ stand: H.sourcePath, sha256: H.sourceSha256, only: only ? [...only] : null, results }, null, 2));
  const failed = results.filter(r => r.status === 'FAIL');
  console.log(`${results.length - failed.length}/${results.length} passed` + (failed.length ? ` — failed: ${failed.map(r => r.id).join(', ')}` : '') + ` · report ${reportPath}`);
  process.exitCode = failed.length ? 1 : 0;
}
