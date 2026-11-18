#!/usr/bin/env node
'use strict';
// Slice 3 of the square stretch (build 72): envelope fold and flip on the tava. A stroke from a
// side towards the centre is a fold at any speed; near the axis it snaps straight (crease half-way
// to the centre line); two opposite sides give a rectangle, four a square of a quarter of the
// sheet. A fast flick outward or sideways is a flip. Acceptance checks T12–T14 of
// runs/square-stretch-spec-2026-11-16.md §6; every gesture outcome is checked at 30/60/120 Hz and
// at dropped-frame cadences (50 ms gaps) with ±1.5 px jitter. Pure Node/vm, same mocks as
// model-regression.cjs: the gestures go through the stand's real touch handlers, but this is not
// a browser and says nothing about the feel.
//   node prototype/dough-closeup/checks/envelope-regression.cjs path/to/stand.js [--only E1,E4]
// ALWAYS pass the stand.js of the checkout under test as the first argument.
// Report: runs/checks/envelope-results.json of the checkout (runs/ is not in git).
// Stroke angles are SCREEN angles (client px) off the screen direction of the sheet axis.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const H = require('./model-regression.cjs');
const { boot, lcg } = H;
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
const count = (rows, key) => rows.reduce((m, r) => (m[r[key]] = (m[r[key]] || 0) + 1, m), {});
const TUNE = { com: 100, creep: 100, brk: 100 };
const CADENCES = [
  ['30 Hz', () => 33.3], ['60 Hz', () => 16.67], ['120 Hz', () => 8.33], ['50 ms', () => 50],
  ['drops', rnd => { const u = rnd() + 0.5; return u < 0.55 ? 16.67 : u < 0.8 ? 33.3 : 50; }],
];
const JITTER = 1.5;

// ── the dish ──────────────────────────────────────────────────────────────────────────────────
// A step-3 sheet put on the tava the way the «образец» button does it; optionally egg + bananas.
// The stand's sample sheet is a disc. square (default): its nodes are moved radially onto the
// stretch target (the rounded square of slice 1, targetAt) before landing — the sheet the player
// is led to. square:false keeps the disc (an under-shaped sheet is allowed onto the tava).
function dishOnPan(w = 390, hh = 844, { filling = false, square = true } = {}) {
  const h = boot(TUNE, w, hh); h.run('stepNo=3;reset();'); h.tick(2);
  if (square) h.run('{const c=centerOfSheet(),R=sheetRadius();for(let i=0;i<N;i++){const x=px[i]-c.x,y=py[i]-c.y,k=targetAt(Math.atan2(y,x))/R;px[i]=prx[i]=c.x+x*k;py[i]=pry[i]=c.y+y*k;}}');
  h.run('{const c=centerOfSheet();xf={cx:c.x,cy:c.y};bakeTransform(panC.x-c.x,panC.y-c.y,0);xf=null;phase="PAN";measureThickness();startDish();}');
  h.tick(2);
  if (filling) h.run(`{const E=dish.env;addEgg(E.c.x,E.c.y);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)addBananaSlice(E.c.x+i*E.h[0]*.22,E.c.y+j*E.h[2]*.22);}`);
  return h;
}
const state = h => JSON.parse(h.run(`JSON.stringify((()=>{
  const E=dish.env,hull=dish.hull,pu=hull.map(p=>(p.x-E.c.x)*E.u.x+(p.y-E.c.y)*E.u.y),pv=hull.map(p=>(p.x-E.c.x)*E.v.x+(p.y-E.c.y)*E.v.y);
  const box={u0:Math.min(...pu),u1:Math.max(...pu),v0:Math.min(...pv),v1:Math.max(...pv)};
  const sheet=dish.faces.filter(f=>f.kind==="dough").reduce((s,f)=>s+polyArea(f.points),0), hullA=polyArea(hull);
  const inside=(dish.filling||[]).filter(t=>{const a=(t.x-E.c.x)*E.u.x+(t.y-E.c.y)*E.u.y,b=(t.x-E.c.x)*E.v.x+(t.y-E.c.y)*E.v.y;return a>=box.u0-1e-9&&a<=box.u1+1e-9&&b>=box.v0-1e-9&&b<=box.v1+1e-9;}).length;
  return {env:E,box,w:box.u1-box.u0,hgt:box.v1-box.v0,hullA,sheet,fill:hullA/((box.u1-box.u0)*(box.v1-box.v0)),folds:dish.folds,flips:dish.flips||0,
    done:E.done,tokens:(dish.filling||[]).length,inside,mode:dish.mode,phase,message:dish.message,gcss:gsCss(),
    cook:dishSideMean("cook","contactWeights"),dry:dishSideMean("dry","contactWeights"),pieces:new Set(dishPieces(dish.faces).filter((_,i)=>dish.faces[i].kind==="dough")).size,finite:dish.faces.every(f=>f.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))};
})())`));
const sideDir = (E, k) => { const a = k < 2 ? E.u : E.v, s = k % 2 ? -1 : 1; return { x: a.x * s, y: a.y * s }; };
// Client points of a stroke from side k: starts on the side (shifted `lat` half-sides along it),
// goes `depth` of the way to the centre line (measured along the axis), `angleDeg` off the axis on
// the screen. depth < 0: outward. sideways: along the side.
function strokeEnds(h, k, { depth = 0.8, angleDeg = 0, lat = 0, px = null, from = 1, sideways = false } = {}) {
  const E = state(h).env, d = sideDir(E, k), t = { x: -d.y, y: d.x }, hk = E.h[k];
  const edge = { x: E.c.x + d.x * hk * from + t.x * hk * lat, y: E.c.y + d.y * hk * from + t.y * hk * lat };
  const mid = { x: E.c.x + t.x * hk * lat, y: E.c.y + t.y * hk * lat };
  const a = h.dishToClient(edge), b = h.dishToClient(mid);
  let ax = b.x - a.x, ay = b.y - a.y; const dist = Math.hypot(ax, ay); ax /= dist; ay /= dist;
  if (sideways) { const q = h.dishToClient({ x: edge.x + t.x * hk * 0.5, y: edge.y + t.y * hk * 0.5 }); const l = Math.hypot(q.x - a.x, q.y - a.y); ax = (q.x - a.x) / l; ay = (q.y - a.y) / l; }
  const an = angleDeg * Math.PI / 180, dx = ax * Math.cos(an) - ay * Math.sin(an), dy = ax * Math.sin(an) + ay * Math.cos(an);
  const L = px !== null ? px : Math.abs(depth) * dist / Math.cos(an), sgn = depth < 0 ? -1 : 1;
  return { from: a, to: { x: a.x + dx * L * sgn, y: a.y + dy * L * sgn }, dist };
}
// A straight stroke walked at `v` CSS px/s with the cadence's gaps and ±JITTER px on every event.
function strokePts(ends, { v = 170, gap, hold = 150, stop = 60, seed = 1, jitter = JITTER } = {}) {
  const rnd = lcg(seed), { from, to } = ends, L = Math.hypot(to.x - from.x, to.y - from.y), T = L / v * 1000;
  const pts = [{ x: from.x, y: from.y, t: 0 }], jit = p => ({ x: p.x + 2 * jitter * rnd(), y: p.y + 2 * jitter * rnd() });
  let tt = gap(rnd) * (0.3 + 0.6 * (rnd() + 0.5));
  for (; tt < T; tt += gap(rnd)) pts.push({ ...jit({ x: from.x + (to.x - from.x) * tt / T, y: from.y + (to.y - from.y) * tt / T }), t: hold + tt });
  pts.push({ ...jit(to), t: hold + T });
  pts.push({ x: pts.at(-1).x, y: pts.at(-1).y, t: hold + T + (stop > 0 ? stop : 4), up: true });
  for (let i = 1; i < pts.length; i++) if (pts[i].t <= pts[i - 1].t) pts[i].t = pts[i - 1].t + 0.5;
  return pts;
}
function dishDrive(h, pts, { release = true } = {}) {
  const t0 = h.getTime(), n0 = h.run('gestures.length'); let nextFrame = 16.67;
  const to = t => { const d = t0 + t - h.getTime(); if (d > 0) h.advance(d); };
  h.touch('start', 't1', pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) {
    while (nextFrame <= p.t) { to(nextFrame); h.run('step(1/60)'); nextFrame += 16.67; }
    if (p.up && !release) return null;
    to(p.t); h.touch(p.up ? 'end' : 'move', 't1', p.x, p.y);
  }
  h.tick(40);
  const g = h.run('gestures.length') > n0 ? JSON.parse(h.run('JSON.stringify(gestures.at(-1))')) : null;
  return { outcome: g && g.kind === 'pan' ? g.outcome : g ? g.kind : 'none', log: g || {} };
}
const fold = (h, k, o = {}, c = {}) => dishDrive(h, strokePts(strokeEnds(h, k, o), { gap: () => 16.67, ...c }));
const PERMS = (function p(a) { return a.length < 2 ? [a] : a.flatMap((x, i) => p(a.filter((_, j) => j !== i)).map(r => [x, ...r])); })([0, 1, 2, 3]);

// ── E1 (T12): four snapped folds ──────────────────────────────────────────────────────────────
test('E1', 'four sides to the centre in all 24 orders × 5 cadences, strokes up to 30° off the axis, depth 0.4–1.2, ±1.5 px jitter, with egg and bananas: square envelope a×a, a quarter of the sheet, filling inside', () => {
  const rows = []; let n = 0;
  for (const [w, hh] of [[390, 844], [844, 390]]) for (const [cname, cad] of CADENCES) for (const order of (w === 390 ? PERMS : PERMS.filter((_, i) => i % 6 === 0))) {
    const h = dishOnPan(w, hh, { filling: true }); const s0 = state(h); n++;
    const rnd = lcg(1000 + n), steps = [];
    for (let i = 0; i < 4; i++) {
      const k = order[i], angleDeg = 60 * rnd(), depth = 0.8 + 0.8 * rnd(), lat = 0.3 * rnd() * (i < 2 ? 1 : 0.5), v = 110 + 400 * (rnd() + 0.5);
      const r = dishDrive(h, strokePts(strokeEnds(h, k, { angleDeg, depth, lat }), { v, gap: cad, seed: 2000 + n * 4 + i }));
      const s = state(h);
      steps.push({ k, angleDeg: r3(angleDeg), depth: r3(depth), v: Math.round(v), outcome: r.outcome, snap: r.log.snap === true, side: r.log.side, w: r3(s.w / (2 * s0.env.h[0])), hgt: r3(s.hgt / (2 * s0.env.h[2])), fill: r3(s.fill) });
    }
    const s = state(h), a = s0.env.h[0], b = s0.env.h[2];
    // the intermediate after the first two folds when they are opposite sides: a rectangle 2a×a
    const rect = (order[0] >> 1) === (order[1] >> 1) ? (order[0] < 2 ? { w: steps[1].w, hgt: steps[1].hgt } : { w: steps[1].hgt, hgt: steps[1].w }) : null;
    rows.push({ screen: `${w}x${hh}`, cadence: cname, order: order.join(''), steps, folds: s.folds, done: s.done.join(''), sideW: r3(s.w / a), sideH: r3(s.hgt / b), fill: r3(s.fill), areaOfSheet: r3(s.hullA / s0.sheet), areaOfSquare: r3(s.hullA / (4 * a * b)),
      tokens: s.tokens, inside: s.inside, rect, flips: s.flips, finite: s.finite, message: s.message });
  }
  const bad = rows.filter(r => r.folds !== 4 || r.done !== '1111' || r.flips !== 0 || !r.finite || Math.abs(r.sideW - 1) > 0.05 || Math.abs(r.sideH - 1) > 0.05 || r.fill < 0.97 || Math.abs(r.areaOfSquare - 0.25) > 0.01 || r.areaOfSheet < 0.25 || r.areaOfSheet > 0.33
    || r.tokens !== 10 || r.inside !== r.tokens || r.steps.some(x => x.outcome !== 'fold' || !x.snap || x.side !== x.k) || (r.rect && (Math.abs(r.rect.w - 0.5) > 0.025 || Math.abs(r.rect.hgt - 1) > 0.025)));
  // an under-shaped (round) sheet: the same four strokes still give the square; its share of a disc is 1/π
  const round = []; for (const [cname, cad] of CADENCES) { const h = dishOnPan(390, 844, { filling: true, square: false }), s0 = state(h); for (const k of [2, 0, 3, 1]) dishDrive(h, strokePts(strokeEnds(h, k, { angleDeg: 20, depth: 0.7 }), { gap: cad, seed: 2900 + round.length }));
    const s = state(h); round.push({ cadence: cname, done: s.done.join(''), sideW: r3(s.w / s0.env.h[0]), sideH: r3(s.hgt / s0.env.h[2]), fill: r3(s.fill), areaOfSheet: r3(s.hullA / s0.sheet), inside: s.inside, tokens: s.tokens }); }
  const badRound = round.filter(r => r.done !== '1111' || Math.abs(r.sideW - 1) > 0.05 || Math.abs(r.sideH - 1) > 0.05 || r.fill < 0.97 || Math.abs(r.areaOfSheet - 1 / Math.PI) > 0.03 || r.inside !== r.tokens);
  bad.push(...badRound);
  const rng = k => `${Math.min(...rows.map(r => r[k]))}…${Math.max(...rows.map(r => r[k]))}`, rects = rows.filter(r => r.rect);
  const out = { runs: rows.length, bad: bad.length, sample: rows.slice(0, 3), summary: `${rows.length} envelopes (${rows.length * 4} strokes): snapped folds ${rows.flatMap(r => r.steps).filter(x => x.snap).length}/${rows.length * 4}; side/a ${rng('sideW')} × ${rng('sideH')}, hull/box ${rng('fill')}, area ${rng('areaOfSquare')} of the sheet's bounding square 2a×2a (${rng('areaOfSheet')} of the dough itself: the rounded sheet is smaller than its square); filling inside ${rows.reduce((s, r) => s + r.inside, 0)}/${rows.reduce((s, r) => s + r.tokens, 0)}; rectangle after two opposite folds (${rects.length} runs): short side ${Math.min(...rects.map(r => r.rect.w))}…${Math.max(...rects.map(r => r.rect.w))} of the sheet, long ${Math.min(...rects.map(r => r.rect.hgt))}…${Math.max(...rects.map(r => r.rect.hgt))}; round sheet ×${round.length}: side/a ${round[0].sideW}×${round[0].sideH}, area of the disc ${round[0].areaOfSheet} (1/π = 0.318); wrong ${bad.length}` };
  if (bad.length) failWith({ ...out, round, badRows: bad.slice(0, 10) }, out.summary);
  return out;
});

// ── E2: what stays a free fold ────────────────────────────────────────────────────────────────
test('E2', 'free folds stay: a slow stroke 45–55° off the axis, a shallow one (0.2), a deep one (1.8) and a second stroke on a folded side are folds, but not snapped', () => {
  const rows = []; let n = 0;
  for (const [w, hh] of [[390, 844], [844, 390]]) for (const [cname, cad] of CADENCES) for (let k = 0; k < 4; k++) {
    for (const [name, o] of [['45°', { angleDeg: 45, depth: 0.7 }], ['-55°', { angleDeg: -55, depth: 0.6 }], ['shallow 0.2', { depth: 0.2 }], ['deep 1.8', { depth: 1.8 }]]) {
      const h = dishOnPan(w, hh); n++; const s0 = state(h);
      const r = dishDrive(h, strokePts(strokeEnds(h, k, o), { v: 170, gap: cad, seed: 3000 + n }));
      const s = state(h);
      rows.push({ screen: `${w}x${hh}`, cadence: cname, side: k, name, outcome: r.outcome, snap: r.log.snap, folds: s.folds, done: s.done.join('') });
    }
    { const h = dishOnPan(w, hh); n++;   // a second stroke on a side that is already folded
      const a = dishDrive(h, strokePts(strokeEnds(h, k, { depth: 0.8 }), { gap: cad, seed: 3500 + n }));
      const b = dishDrive(h, strokePts(strokeEnds(h, k, { depth: 0.3, from: 0.5 }), { gap: cad, seed: 3600 + n }));
      const s = state(h);
      rows.push({ screen: `${w}x${hh}`, cadence: cname, side: k, name: 'again on a folded side', outcome: b.outcome, snap: b.log.snap, first: a.log.snap, folds: s.folds, done: s.done.join('') }); }
  }
  // shallow strokes of 0.2 may be too short to fold at all on the short screen axis: 'none' is allowed there
  const ok = r => r.name === 'shallow 0.2' ? (r.outcome === 'none' && r.folds === 0) || (r.outcome === 'fold' && r.snap === false)
    : r.name === 'again on a folded side' ? r.first === true && ((r.outcome === 'fold' && r.snap === false && r.folds === 2) || (r.outcome === 'none' && r.folds === 1))
    : r.outcome === 'fold' && r.snap === false && r.folds === 1 && r.done === '0000';
  const bad = rows.filter(r => !ok(r));
  const by = n2 => JSON.stringify(count(rows.filter(r => r.name === n2).map(r => ({ o: r.outcome + (r.snap ? ' snapped' : r.outcome === 'fold' ? ' free' : '') })), 'o'));
  const out = { rows, summary: ['45°', '-55°', 'shallow 0.2', 'deep 1.8', 'again on a folded side'].map(x => `${x}: ${by(x)}`).join('; ') + `; wrong ${bad.length}` };
  if (bad.length) failWith({ ...out, bad: bad.slice(0, 12) }, out.summary);
  return out;
});

// ── E3: preview = committed ───────────────────────────────────────────────────────────────────
test('E3', 'the previewed flap is the committed flap: dough faces of the preview at the last move equal the faces after release (snapped and free strokes, with and without filling)', () => {
  const rows = []; let n = 0;
  for (const filling of [false, true]) for (const [cname, cad] of CADENCES) for (let k = 0; k < 4; k++) for (const [name, o] of [['snap', { angleDeg: 20, depth: 0.7 }], ['snap deep', { angleDeg: -10, depth: 1.15 }], ['free 50°', { angleDeg: 50, depth: 0.7 }]]) {
    const h = dishOnPan(390, 844, { filling }); n++;
    const pts = strokePts(strokeEnds(h, k, o), { v: 170, gap: cad, seed: 4000 + n, stop: 120 });
    dishDrive(h, pts, { release: false });
    const key = `JSON.stringify(F.filter(f=>f.kind==="dough").map(f=>f.points.map(p=>[+p.x.toFixed(9),+p.y.toFixed(9)])))`;
    const pre = h.run(`dishGesture&&dishGesture.preview?(()=>{const F=dishGesture.preview.faces;return ${key}})():null`), planSide = h.run('dishGesture&&dishGesture.plan?dishGesture.plan.side:null');
    const up = pts.at(-1); h.advance(120); h.touch('end', 't1', up.x, up.y); h.tick(4);
    const post = h.run(`(()=>{const F=dish.faces;return ${key}})()`), log = JSON.parse(h.run('JSON.stringify(gestures.at(-1))'));
    rows.push({ filling, cadence: cname, side: k, name, previewed: pre !== null, equal: pre === post, planSide, snap: log.snap, logSide: log.side, outcome: log.outcome });
  }
  const bad = rows.filter(r => !r.previewed || !r.equal || r.outcome !== 'fold' || (r.name.startsWith('snap') ? r.planSide !== r.side || r.snap !== true : r.planSide !== -1 || r.snap !== false));
  const out = { runs: rows.length, summary: `${rows.length} strokes: preview shown ${rows.filter(r => r.previewed).length}, preview = committed ${rows.filter(r => r.equal).length}, snapped ${rows.filter(r => r.snap).length}, free ${rows.filter(r => r.snap === false).length}; wrong ${bad.length}` };
  if (bad.length) failWith({ ...out, bad: bad.slice(0, 12) }, out.summary);
  return out;
});

// ── E4 (T13): fold or flip ────────────────────────────────────────────────────────────────────
// Flick: 100–130 px at 1100–1550 CSS px/s released in motion (the «brisk fold» of the diagnosis).
function flick(h, k, kind, i, cad, seed) {
  const L = 100 + 10 * (i % 4), v = 1100 + 150 * (i % 4), ang = (i % 5 - 2) * 10, from = state(h).done[k] ? 0.5 : 1;   // a folded side: its edge is the crease
  const o0 = kind === 'in' ? { px: L, angleDeg: ang, lat: (i % 3 - 1) * 0.1 } : kind === 'out' ? { px: L, depth: -1, angleDeg: ang, lat: (i % 3 - 1) * 0.1 } : { px: L, sideways: true, angleDeg: (i % 2 ? 180 : 0) + ang / 2 };
  return dishDrive(h, strokePts(strokeEnds(h, k, { ...o0, from }), { v, gap: cad, stop: 0, seed }));
}
test('E4', 'fold or flip at every cadence: a fast stroke INTO the sheet is a fold (snapped) while the envelope is open — with or without filling; fast outward and sideways flicks flip; on the finished envelope a fast flick in any direction flips and a slow inward stroke does nothing (build 78: never a fifth fold)', () => {
  const rows = []; let n = 0;
  for (const [w, hh] of [[390, 844], [844, 390]]) for (const [cname, cad] of CADENCES) for (let k = 0; k < 4; k++) for (let i = 0; i < (w === 390 ? 2 : 1); i++) {
    for (const stage of [0, 2, 4]) for (const kind of ['in', 'out', 'side']) {
      if (stage === 2 && kind !== 'in' && i > 0) continue;
      const h = dishOnPan(w, hh, { filling: i % 2 === 0 }); n++;
      const pre = stage === 0 ? [] : stage === 2 ? [(k + 2) % 4 < 2 ? 0 : 2, (k + 2) % 4 < 2 ? 1 : 3] : [0, 1, 2, 3];
      for (const p of pre) { const r = fold(h, p, { depth: 0.8 }); if (!(r.outcome === 'fold' && r.log.snap)) failWith({ p, r }, `setup fold of side ${p} failed`); }
      const before = state(h);
      const r = flick(h, k, kind, i, cad, 5000 + n), s = state(h);
      rows.push({ screen: `${w}x${hh}`, cadence: cname, side: k, stage, kind, filling: i % 2 === 0, outcome: r.outcome, snap: r.log.snap, logSide: r.log.side, speed: r.log.speed, path: r.log.path_css, dur: r.log.duration_ms,
        folds: s.folds - before.folds, flips: s.flips - before.flips, env: s.done.join('') });
    }
  }
  const want = r => r.stage < 4 && r.kind === 'in' ? (r.outcome === 'fold' && r.snap === true && r.logSide === r.side && r.folds === 1 && r.flips === 0) : (/^flip$/.test(r.outcome) && r.flips === 1 && r.folds === 0);
  const bad = rows.filter(r => !want(r));
  const table = []; for (const stage of [0, 2, 4]) for (const kind of ['in', 'out', 'side']) { const line = { 'flaps before': stage, flick: kind }; for (const [cname] of CADENCES) line[cname] = Object.entries(count(rows.filter(r => r.stage === stage && r.kind === kind && r.cadence === cname).map(r => ({ o: r.outcome + (r.snap ? '+snap' : '') })), 'o')).map(([a, c]) => `${a} ${c}`).join(', '); table.push(line); }
  console.table(table);
  // the finished envelope and a slow inward stroke: nothing — the envelope has four folds and stays so
  // (until build 78 this was a free fifth fold; the playtest of 17.11 called it a bug: «Складок: 5»)
  const slow = []; for (const [cname, cad] of CADENCES) { const h = dishOnPan(390, 844, { filling: true }); for (const p of [0, 1, 2, 3]) fold(h, p, { depth: 0.8 }); const r = dishDrive(h, strokePts(strokeEnds(h, 2, { from: 0.5, depth: 0.6 }), { v: 150, gap: cad, seed: 5900 + slow.length })); const s = state(h); slow.push({ cadence: cname, outcome: r.outcome, snap: r.log.snap, folds: s.folds, flips: s.flips }); }
  const badSlow = slow.filter(r => !(r.outcome === 'none' && r.folds === 4 && r.flips === 0));
  const c = (stage, kind) => { const q = rows.filter(r => r.stage === stage && r.kind === kind); return `${q.filter(want).length}/${q.length}`; };
  const out = { table, slow, runs: rows.length, summary: `${rows.length} flicks (speed logged ${Math.min(...rows.map(r => r.speed))}…${Math.max(...rows.map(r => r.speed))} px/s). Open sheet: in→fold+snap ${c(0, 'in')}, out→flip ${c(0, 'out')}, sideways→flip ${c(0, 'side')}. Two flaps: in→fold+snap ${c(2, 'in')}, out→flip ${c(2, 'out')}, sideways→flip ${c(2, 'side')}. Finished envelope: in→flip ${c(4, 'in')}, out→flip ${c(4, 'out')}, sideways→flip ${c(4, 'side')}; slow inward on the envelope → nothing, 4 folds ${slow.length - badSlow.length}/${slow.length}; wrong ${bad.length + badSlow.length}` };
  if (bad.length || badSlow.length) failWith({ ...out, bad: bad.slice(0, 16), badSlow }, out.summary);
  return out;
});

// ── E5 (T14): the frame travels with the material ─────────────────────────────────────────────
test('E5', 'the envelope frame follows rotate, flip and undo: after a 30° twist, an oblique flip and an undo the four folds still give the square a×a with seams through the sheet centre', () => {
  const rows = [];
  const finish = (h, s0, name) => {
    for (let k = 0; k < 4; k++) { if (state(h).done[k]) continue; const r = fold(h, k, { depth: 0.8, angleDeg: k % 2 ? 15 : -15 }); if (!(r.outcome === 'fold' && r.log.snap && r.log.side === k)) failWith({ name, k, r, st: state(h) }, `${name}: fold of side ${k} is ${r.outcome}, snapped ${r.log.snap}`); }
    const s = state(h), a = s0.env.h[0], b = s0.env.h[2];
    // the seams cross where the flap edges meet: the centre of the envelope against the frame centre
    const off = Math.hypot((s.box.u0 + s.box.u1) / 2, (s.box.v0 + s.box.v1) / 2) / a;
    rows.push({ name, sideW: r3(s.w / a), sideH: r3(s.hgt / b), fill: r3(s.fill), areaOfSheet: r3(s.hullA / s0.sheet), areaOfSquare: r3(s.hullA / (4 * a * b)), centreOff: r3(off), done: s.done.join(''), axisDeg: r3(Math.atan2(s.env.u.y, s.env.u.x) * 180 / Math.PI), tokens: s.tokens, inside: s.inside });
  };
  for (const [w, hh] of [[390, 844], [844, 390]]) {
    { const h = dishOnPan(w, hh, { filling: true }), s0 = state(h); assert.equal(h.run('rotateDish(30*Math.PI/180)'), true); h.tick(2); finish(h, s0, `${w}x${hh} twist 30°, then four folds`); }
    { const h = dishOnPan(w, hh, { filling: true }), s0 = state(h); fold(h, 0); fold(h, 2); assert.equal(h.run('rotateDish(-50*Math.PI/180)'), true); h.tick(2); finish(h, s0, `${w}x${hh} two folds, twist −50°, two more`); }
    { const h = dishOnPan(w, hh, { filling: true }), s0 = state(h); fold(h, 0); fold(h, 1);
      assert.equal(h.run('startFlip({x:.8,y:.6},{x:.05,y:.03})'), true); h.advance(600); h.tick(4); assert.equal(state(h).flips, 1); finish(h, s0, `${w}x${hh} two folds, oblique flip, two more`); }
    { const h = dishOnPan(w, hh, { filling: true }), s0 = state(h);
      assert.equal(h.run('startFlip({x:-.3,y:1},{x:0,y:0})'), true); h.advance(600); h.tick(4); assert.equal(h.run('startFlip({x:1,y:.2},{x:0,y:0})'), true); h.advance(600); h.tick(4); finish(h, s0, `${w}x${hh} two oblique flips of the open sheet, then four folds`); }
    { const h = dishOnPan(w, hh, { filling: true }), s0 = state(h); fold(h, 0); fold(h, 3); const mid = state(h);
      fold(h, 1); h.run('rotateDish(.5)'); h.run('undoDish()'); h.run('undoDish()'); const back = state(h);
      assert.deepEqual(back.done, mid.done, 'undo restores which sides are folded'); assert.ok(Math.abs(back.env.u.x - mid.env.u.x) < 1e-12 && Math.abs(back.env.c.x - mid.env.c.x) < 1e-12, 'undo restores the frame');
      h.run('undoDish()'); h.run('undoDish()'); assert.deepEqual(state(h).done, [0, 0, 0, 0]); assert.equal(state(h).folds, 0);
      finish(h, s0, `${w}x${hh} fold, fold, fold, twist, four undos, then four folds`); }
  }
  const bad = rows.filter(r => Math.abs(r.sideW - 1) > 0.05 || Math.abs(r.sideH - 1) > 0.05 || r.fill < 0.97 || Math.abs(r.areaOfSquare - 0.25) > 0.01 || r.centreOff > 0.01 || r.done !== '1111' || r.inside !== r.tokens);
  const out = { rows, summary: rows.map(r => `${r.name}: ${r.sideW}×${r.sideH}, area ${r.areaOfSquare} of 2a×2a, centre off ${r.centreOff} a, axis ${r.axisDeg}°`).join('; ') + `; wrong ${bad.length}` };
  if (bad.length) failWith({ ...out, bad }, out.summary);
  return out;
});

// ── E6: the rest of the cycle is untouched ────────────────────────────────────────────────────
test('E6', 'the chain around the envelope still works: frying goes on while folding, a flick flips the envelope, the middle carries it to the table, four cuts give 3×3', () => {
  const rows = [];
  for (const [w, hh] of [[390, 844], [844, 390]]) {
    const h = dishOnPan(w, hh, { filling: true }); const cook0 = state(h).dry;
    h.tick(600); const cook1 = state(h).dry;
    for (const k of [0, 1, 2, 3]) fold(h, k, { depth: 0.8 });
    const env = state(h);
    const f = flick(h, 2, 'out', 1, () => 16.67, 77); h.advance(600); h.tick(4); const flipped = state(h);
    // carry by the middle to the table
    const E = flipped.env, c = h.dishToClient(E.c), tb = JSON.parse(h.run('JSON.stringify(zone("work"))')), table = h.toClient(tb.cx, tb.cy);
    const r = dishDrive(h, strokePts({ from: c, to: table }, { v: 280, gap: () => 16.67, stop: 120, seed: 78 })); h.advance(800); h.tick(30);
    const mode = h.run('dish.mode'), phase = h.run('phase');
    const b = JSON.parse(h.run('JSON.stringify(dishBounds())')), X = t => b.left + (b.right - b.left) * t, Y = t => b.top + (b.bottom - b.top) * t;
    const cuts = [[{ x: X(1 / 3), y: Y(-0.2) }, { x: X(1 / 3), y: Y(1.2) }], [{ x: X(2 / 3), y: Y(-0.2) }, { x: X(2 / 3), y: Y(1.2) }], [{ x: X(-0.2), y: Y(1 / 3) }, { x: X(1.2), y: Y(1 / 3) }], [{ x: X(-0.2), y: Y(2 / 3) }, { x: X(1.2), y: Y(2 / 3) }]]
      .map(([a, bb]) => h.run(`cutDish(${JSON.stringify(a)},${JSON.stringify(bb)})`));
    const pieces = state(h).pieces; h.tick(5, 1 / 60, true);
    rows.push({ screen: `${w}x${hh}`, cookBefore: r3(cook0), cookAfter10s: r3(cook1), envelope: env.done.join(''), flick: f.outcome, flips: flipped.flips, removal: r.outcome, mode, phase, cuts: cuts.filter(Boolean).length, pieces, errors: h.errors.length, loopErrs: h.run('loopErrs') });
  }
  const bad = rows.filter(r => !(r.cookAfter10s > r.cookBefore) || r.envelope !== '1111' || r.flick !== 'flip' || r.flips !== 1 || r.removal !== 'remove' || r.mode !== 'cut' || r.phase !== 'CUT' || r.cuts !== 4 || r.pieces !== 9 || r.errors || r.loopErrs);
  const out = { rows, summary: rows.map(r => `${r.screen}: dry side on the steel ${r.cookBefore}→${r.cookAfter10s} in 10 s, envelope ${r.envelope}, flick ${r.flick}, to the table ${r.removal} (${r.mode}), cuts ${r.cuts}, pieces ${r.pieces}, errors ${r.errors + r.loopErrs}`).join('; ') };
  if (bad.length) failWith({ ...out, bad }, out.summary);
  return out;
});

const reportDir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
if (require.main === module) {
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'envelope-results.json');
  fs.writeFileSync(reportPath, JSON.stringify({ stand: H.sourcePath, sha256: H.sourceSha256, only: only ? [...only] : null, results }, null, 2));
  const failed = results.filter(r => r.status === 'FAIL');
  console.log(`${results.length - failed.length}/${results.length} passed` + (failed.length ? ` — failed: ${failed.map(r => r.id).join(', ')}` : '') + ` · report ${reportPath}`);
  process.exitCode = failed.length ? 1 : 0;
}
