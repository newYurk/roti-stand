#!/usr/bin/env node
'use strict';
// Slice 2 of the square stretch (build 70): lift-and-carry transfer onto the flat round tava,
// and the same lift-and-carry taking the folded roti off the tava. Acceptance checks T10–T11 of
// runs/square-stretch-spec-2026-11-16.md §6 plus what the live test of 17.11 asked for: every
// outcome is checked at 30/60/120 Hz and at dropped-frame cadences (50 ms gaps) with ±1.5 px
// jitter. Pure Node/vm, same mocks as model-regression.cjs: the gestures go through the stand's
// real touch handlers, but this is not a browser and says nothing about the feel.
//   node prototype/dough-closeup/checks/carry-regression.cjs path/to/stand.js [--only T10a,T11]
// ALWAYS pass the stand.js of the checkout under test as the first argument.
// Report: runs/checks/carry-results.json of the checkout (runs/ is not in git).
// Strokes are in client px; speeds in screen gs/s (1 gs = gsCss() CSS px), the stand's own unit.
// Every "random" number is seeded; a run is reproducible.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const quiet = console.log; console.log = () => {};
const H = require('./model-regression.cjs');
console.log = quiet;
const { boot, press, drive, lcg } = H;
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

// ── sheets ────────────────────────────────────────────────────────────────────────────────────
// ready(): the stand's own step-3 sheet (a sheet at the target, as the «на таву» step button
// builds it). small(): a freshly flattened step-2 sheet — under-stretched.
function ready(w = 390, hh = 844, opts = {}) { const h = boot(TUNE, w, hh, opts); h.run('stepNo=3;reset();'); h.tick(2); return h; }
function small(w = 390, hh = 844) { const h = boot(TUNE, w, hh); press(h); return h; }
const geo = h => JSON.parse(h.run(`(()=>{const c=centerOfSheet();rimProfile(c);const w=zone("work");
  return JSON.stringify({c,r:sheetRadius(),gs:gestureScale,gcss:gsCss(),panC,PAN_R,targetR,work:w,stacked:stackedLayout(),rim0:rimProf[rimBin(0)]})})()`));
// Snapshot of everything a carry must not change while the sheet is in the hand.
function snap(h) {
  h.run(`globalThis.__s={px:px.slice(),py:py.slice(),thick:thick.slice(),rest:cons.map(c=>c.rest),broken:cons.map(c=>c.broken),ref:px,gl:gestures.length,stepNo,sqC:sqC?{...sqC}:null,tossTry,tossOk};`);
}
function back(h) {
  h.run(`{const s=__s;if(dish)throw new Error('snapshot: the sheet became a dish');px.set(s.px);py.set(s.py);prx.set(s.px);pry.set(s.py);vx.fill(0);vy.fill(0);thick.set(s.thick);
    cons.forEach((c,i)=>{c.rest=s.rest[i];c.broken=s.broken[i];});stepNo=s.stepNo;phase='TABLE';xf=null;sqC=s.sqC?{...s.sqC}:null;gestures.length=s.gl;tossTry=s.tossTry;tossOk=s.tossOk;plasticT=0;clearAction();}`);
}
const same = h => h.run(`(()=>{const s=__s;let d=0;for(let i=0;i<N;i++){if(px[i]!==s.px[i]||py[i]!==s.py[i]||thick[i]!==s.thick[i])d++;}
  return d===0 && px===s.ref && cons.every((c,i)=>c.rest===s.rest[i]&&c.broken===s.broken[i]);})()`);
// Where the sheet ended up against the snapshot: rigid rotation (deg), rim against the tava.
const landed = h => JSON.parse(h.run(`(()=>{const s=__s;let ax=0,ay=0,bx=0,by=0,n=0;
  for(let i=0;i<N;i++){if(conDeg&&conDeg[i]<=0)continue;ax+=s.px[i];ay+=s.py[i];bx+=px[i];by+=py[i];n++;}ax/=n;ay/=n;bx/=n;by/=n;
  let sn=0,cs=0,worst=0,rim=0;for(let i=0;i<N;i++){if(conDeg&&conDeg[i]<=0)continue;const ux=s.px[i]-ax,uy=s.py[i]-ay,wx=px[i]-bx,wy=py[i]-by;sn+=ux*wy-uy*wx;cs+=ux*wx+uy*wy;}
  const th=Math.atan2(sn,cs),c=Math.cos(th),si=Math.sin(th);
  for(let i=0;i<N;i++){if(conDeg&&conDeg[i]<=0)continue;const ux=s.px[i]-ax,uy=s.py[i]-ay;worst=Math.max(worst,Math.hypot(bx+ux*c-uy*si-px[i],by+ux*si+uy*c-py[i]));}
  for(const i of edgeNodes){if(conDeg&&conDeg[i]<=0)continue;rim=Math.max(rim,Math.hypot(px[i]-panC.x,py[i]-panC.y));}
  const m=metrics();
  return JSON.stringify({rotDeg:th*180/Math.PI,rigidErr:worst/targetR,rimOverPan:rim/PAN_R,centreOff:Math.hypot(bx-panC.x,by-panC.y)/PAN_R,sameMesh:px===s.ref,
    brokenKept:cons.every((c,i)=>c.broken===s.broken[i]),restKept:cons.every((c,i)=>c.rest===s.rest[i]),thickErr:Array.from(thick).reduce((m,t,i)=>Math.max(m,Math.abs(t-s.thick[i])),0),
    phase,stepNo,state:action.state,dish:!!dish,finite:m.finite,kind:gestures.length?gestures.at(-1).kind:null,last:gestures.length?gestures.at(-1):null})})()`));

// ── finger paths ──────────────────────────────────────────────────────────────────────────────
// Cadences: [name, gap generator]. '50 ms' is a phone that delivers every third frame; 'drops' is
// 60 Hz where a third of the events is lost in runs of one or two (gaps 33–50 ms), as on the
// owner's phone on 17.11.
const CADENCES = [
  ['30 Hz', () => 33.3], ['60 Hz', () => 16.67], ['120 Hz', () => 8.33], ['50 ms', () => 50],
  ['drops', rnd => { const u = rnd() + 0.5; return u < 0.55 ? 16.67 : u < 0.8 ? 33.3 : 50; }],
];
// A polyline walked at the given speeds. legs: [{to:{x,y} client px, v: gs/s, arc: signed bulge in
// gs (the leg bends sideways by this much at its middle)}], then `stop` ms with the finger standing
// still before the release. The first point is the touch; `hold` ms pass before the first move.
function walk(g, from, legs, { gap, hold = 200, stop = 0, jitter = 1.5, seed = 1, stopEvents = false } = {}) {
  const rnd = lcg(seed), pts = [{ x: from.x, y: from.y, t: 0 }];
  let t = hold, cur = { ...from };
  const jit = p => ({ x: p.x + 2 * jitter * rnd(), y: p.y + 2 * jitter * rnd() });
  for (const leg of legs) {
    const L = Math.hypot(leg.to.x - cur.x, leg.to.y - cur.y), T = L / (leg.v * g.gcss) * 1000;
    const nx = -(leg.to.y - cur.y) / (L || 1), ny = (leg.to.x - cur.x) / (L || 1), b = (leg.arc || 0) * g.gcss;
    const at = u => ({ x: cur.x + (leg.to.x - cur.x) * u + nx * b * 4 * u * (1 - u), y: cur.y + (leg.to.y - cur.y) * u + ny * b * 4 * u * (1 - u) });
    let tt = gap(rnd) * (0.3 + 0.6 * (rnd() + 0.5));
    for (; tt < T; tt += gap(rnd)) pts.push({ ...jit(at(tt / T)), t: t + tt });
    t += T; cur = { ...leg.to }; pts.push({ ...jit(cur), t });
  }
  if (stop > 0 && stopEvents) for (let tt = gap(rnd); tt < stop; tt += gap(rnd)) pts.push({ ...jit(cur), t: t + tt });   // a standing finger still jitters
  const lastP = pts.at(-1);
  pts.push({ x: lastP.x, y: lastP.y, t: t + stop + (stop > 0 ? 0 : 4), up: true });
  for (let i = 1; i < pts.length; i++) if (pts[i].t <= pts[i - 1].t) pts[i].t = pts[i - 1].t + 0.5;
  return pts;
}
// Points on the sheet / table / tava in client px.
function spots(h) {
  const g = geo(h);
  const onSheet = (reach, angle = 0) => h.toClient(g.c.x + Math.cos(angle) * g.rim0 * reach, g.c.y + Math.sin(angle) * g.rim0 * reach);
  const pan = (k = 0, angle = 0) => h.toClient(g.panC.x + Math.cos(angle) * g.PAN_R * k, g.panC.y + Math.sin(angle) * g.PAN_R * k);
  // a spot on the work table away from the tava: half-way from the sheet centre to the far side of the work zone
  const away = g.stacked ? h.toClient(g.c.x + g.work.w * 0.22, g.c.y + g.work.h * 0.10) : h.toClient(g.c.x - g.work.w * 0.18, g.c.y + g.work.h * 0.12);
  return { g, onSheet, pan, away };
}
const outcome = (h, r) => r.phase === 'PAN' ? h.run('gestures.at(-1).kind') : r.kind;
module.exports = { ready, small, geo, snap, back, same, landed, walk, spots, CADENCES, outcome };

// ── T10a: carry and lay ───────────────────────────────────────────────────────────────────────
test('T10a', 'carry from the middle and release over the tava: the sheet lies down — same mesh and tears, square to the table, inside the rim', () => {
  const rows = [];
  for (const [w, hh] of [[390, 844], [844, 390]]) for (const torn of [false, true]) {
    const h = ready(w, hh);
    if (torn) h.run('breakCon(cons[40]);breakCon(cons[900]);onTear();');
    snap(h);
    const s = spots(h), before = h.metrics();
    const r = drive(h, walk(s.g, s.onSheet(0.15, 0.7), [{ to: s.pan(0.2, 1), v: 4 }], { gap: () => 16.67, stop: 120, seed: 5 }), { frames: true });
    const L = landed(h), after = h.metrics();
    rows.push({ screen: `${w}x${hh}`, torn, kind: outcome(h, r), phase: L.phase, step: L.stepNo, rotDeg: r3(L.rotDeg), rigidErr: L.rigidErr, rimOverPan: r3(L.rimOverPan), centreOff: r3(L.centreOff),
      sameMesh: L.sameMesh, brokenKept: L.brokenKept, restKept: L.restKept, thickErr: L.thickErr, areaRatio: after.area / before.area, dish: L.dish, state: L.state, finite: L.finite,
      panOverTarget: r3(s.g.PAN_R / s.g.targetR), logged: L.last && { kind: L.last.kind, entry: L.last.entry, spin_deg: L.last.spin_deg, aim: L.last.aim, flight_ms: L.last.flight_ms } });
  }
  const bad = rows.filter(r => !(r.kind === 'lay' && r.phase === 'PAN' && r.step === 3 && r.dish && r.state === 'RESTING' && r.sameMesh && r.brokenKept && r.restKept && r.thickErr < 1e-4 && r.finite
    && Math.abs(r.rotDeg - 90 * Math.round(r.rotDeg / 90)) <= 0.5 && r.rigidErr < 1e-4 && Math.abs(r.areaRatio - 1) < 1e-4 && r.rimOverPan <= 1.08 + 1e-6));
  const out = { rows, summary: rows.map(r => `${r.screen}${r.torn ? ' torn' : ''}: ${r.kind}, rotation ${r.rotDeg}°, rim ${r.rimOverPan}·PAN_R (tava ${r.panOverTarget}·targetR), centre off ${r.centreOff}`).join('; ') };
  if (bad.length) failWith(out, `outside the spec ${bad.length}/${rows.length}: ` + out.summary);
  return out;
});

// ── T10b: release anywhere else ───────────────────────────────────────────────────────────────
test('T10b', 'carry and release over the table (standing finger, slow finger, half-way to the tava): the sheet is back where it was, bit for bit', () => {
  const rows = [];
  for (const [w, hh] of [[390, 844], [844, 390]]) {
    const h = ready(w, hh); snap(h); const s = spots(h);
    const half = { x: (s.onSheet(0).x + s.pan().x) / 2, y: (s.onSheet(0).y + s.pan().y) / 2 };
    const cases = [['away, stop', [{ to: s.away, v: 3 }], 150], ['away, slow release on the move', [{ to: s.away, v: 2 }], 0],
      ['half-way to the tava, stop', [{ to: half, v: 4 }], 150], ['to the tava and back, stop', [{ to: s.pan(), v: 6 }, { to: s.onSheet(0.2), v: 6 }], 100]];
    for (const [name, legs, stop] of cases) {
      back(h);
      const r = drive(h, walk(s.g, s.onSheet(0.1, 2), legs, { gap: () => 16.67, stop, seed: 11 }), { frames: true });
      rows.push({ screen: `${w}x${hh}`, name, kind: r.kind, outcome: h.run('gestures.at(-1).outcome'), phase: r.phase, same: same(h), state: h.run('action.state'), xf: h.run('xf===null'), decision: h.run('lastDecision') });
    }
  }
  const bad = rows.filter(r => !(r.kind === 'carry' && r.outcome === 'back' && r.phase === 'TABLE' && r.same && r.state === 'RESTING' && r.xf));
  const out = { rows, summary: `${rows.length} releases: ${JSON.stringify(count(rows, 'kind'))}, sheet bit-for-bit the same ${rows.filter(r => r.same).length}/${rows.length}, still on the table ${rows.filter(r => r.phase === 'TABLE').length}/${rows.length}` };
  if (bad.length) failWith(out, `wrong ${bad.length}: ` + out.summary);
  return out;
});

// ── T10c: the toss ────────────────────────────────────────────────────────────────────────────
// A flick is a short fast leg released on the move. In the cone: towards the tava centre and 30°
// either side of it. Out of the cone: 90°, 135°, 180° off. Ready sheet → toss / back.
function flick(h, s, off, v, cad, seed, len = 1.3) {
  const a = s.onSheet(0.1, 1), p = s.pan(), d = Math.hypot(p.x - a.x, p.y - a.y), ux = (p.x - a.x) / d, uy = (p.y - a.y) / d;
  const c = Math.cos(off), si = Math.sin(off), L = len * s.g.gcss;
  return walk(s.g, a, [{ to: { x: a.x + (ux * c - uy * si) * L, y: a.y + (ux * si + uy * c) * L }, v }], { gap: cad, hold: 150, stop: 0, seed });
}
test('T10c', 'fast release of a ready sheet: towards the tava — toss (lands square, inside the rim); sideways or away — back on the table', () => {
  const rows = []; let k = 0;
  for (const [w, hh] of [[390, 844], [844, 390]]) for (const [off, want] of [[0, 'toss'], [0.5, 'toss'], [-0.5, 'toss'], [Math.PI / 2, 'carry'], [-Math.PI * 3 / 4, 'carry'], [Math.PI, 'carry']]) for (const v of [9, 14]) {
    const h = ready(w, hh); snap(h); const s = spots(h); k++;
    const r = drive(h, flick(h, s, off, v, () => 16.67, 40 + k), { frames: true });
    const L = want === 'toss' ? landed(h) : null;
    rows.push({ screen: `${w}x${hh}`, offDeg: Math.round(off * 180 / Math.PI), v, want, kind: outcome(h, r), phase: r.phase, decision: h.run('lastDecision'),
      rotDeg: L && r3(L.rotDeg), rimOverPan: L && r3(L.rimOverPan), same: want === 'toss' ? null : same(h) });
  }
  const bad = rows.filter(r => r.kind !== r.want || (r.want === 'toss' ? !(r.phase === 'PAN' && Math.abs(r.rotDeg - 90 * Math.round(r.rotDeg / 90)) <= 0.5 && r.rimOverPan <= 1.08 + 1e-6) : !(r.phase === 'TABLE' && r.same)));
  const toss = rows.filter(r => r.want === 'toss');
  const out = { rows, summary: `${rows.length} flicks at 9 and 14 gs/s: in the cone ${JSON.stringify(count(toss, 'kind'))}, out of the cone ${JSON.stringify(count(rows.filter(r => r.want !== 'toss'), 'kind'))}; toss rim max ${Math.max(...toss.map(r => r.rimOverPan))}·PAN_R, rotations ${[...new Set(toss.map(r => r.rotDeg))].join('/')}°` };
  if (bad.length) failWith({ ...out, bad }, `wrong ${bad.length}: ` + out.summary);
  return out;
});

// ── T10d: under-stretched sheet ───────────────────────────────────────────────────────────────
test('T10d', 'under-stretched sheet (step 2): carried and laid — allowed, step becomes 3; flicked from the middle towards the tava — not thrown', () => {
  const rows = [];
  for (const [w, hh] of [[390, 844], [844, 390]]) {
    { const h = small(w, hh); snap(h); const s = spots(h), pct = h.run('sheetPct()');
      const r = drive(h, walk(s.g, s.onSheet(0.1), [{ to: s.pan(), v: 4 }], { gap: () => 16.67, stop: 120, seed: 3 }), { frames: true });
      const L = landed(h); rows.push({ screen: `${w}x${hh}`, name: 'carry and lay', pct, kind: outcome(h, r), phase: r.phase, step: L.stepNo, sameMesh: L.sameMesh, logged_pct: L.last.sheet_pct, want: 'lay' }); }
    for (const v of [9, 14, 20]) for (const hz of [60, 120]) {
      const h = small(w, hh); snap(h); const s = spots(h);
      const r = drive(h, flick(h, s, 0, v, () => 1000 / hz, 70 + v + hz), { frames: true });
      rows.push({ screen: `${w}x${hh}`, name: `flick ${v} gs/s at ${hz} Hz`, kind: outcome(h, r), phase: r.phase, step: h.run('stepNo'), same: same(h), decision: h.run('lastDecision'), want: 'carry' });
    }
  }
  const bad = rows.filter(r => r.kind !== r.want || (r.want === 'lay' ? !(r.phase === 'PAN' && r.step === 3 && r.sameMesh) : !(r.phase === 'TABLE' && r.step === 2 && r.same)));
  const lay = rows.filter(r => r.want === 'lay'), fl = rows.filter(r => r.want !== 'lay');
  const out = { rows, summary: `laid at ${lay.map(r => r.pct + ' %').join(' and ')} of the target: ${JSON.stringify(count(lay, 'kind'))}; ${fl.length} fast flicks towards the tava: ${JSON.stringify(count(fl, 'kind'))}, onto the tava ${fl.filter(r => r.phase === 'PAN').length}` };
  if (bad.length) failWith({ ...out, bad }, `wrong ${bad.length}: ` + out.summary);
  return out;
});

// ── T10e: the same at every event cadence ─────────────────────────────────────────────────────
test('T10e', 'carry outcomes at 30/60/120 Hz, 50 ms gaps and dropped frames, ±1.5 px jitter: lay, back and toss are the same at every cadence', () => {
  const rows = []; let k = 0;
  const cases = [
    ['lay, slow carry, stop', 'lay', (h, s, cad, seed) => walk(s.g, s.onSheet(0.2, seed), [{ to: s.pan(0.3, seed), v: 2 }], { gap: cad, stop: 150, seed })],
    ['lay, fast carry, stop 60 ms', 'lay', (h, s, cad, seed) => walk(s.g, s.onSheet(0.2, seed), [{ to: s.pan(0.2, seed), v: 10 }], { gap: cad, stop: 60, seed })],
    ['lay, released on the move over the tava', 'lay', (h, s, cad, seed) => walk(s.g, s.onSheet(0.2, seed), [{ to: s.pan(0.1, seed), v: 5 }], { gap: cad, stop: 0, seed })],
    ['back, stop over the table', 'carry', (h, s, cad, seed) => walk(s.g, s.onSheet(0.2, seed), [{ to: s.away, v: 4 }], { gap: cad, stop: 150, seed })],
    ['back, fast sideways flick', 'carry', (h, s, cad, seed) => flick(h, s, (seed % 2 ? 1 : -1) * Math.PI / 2, 12, cad, seed)],
    ['toss, flick 9 gs/s', 'toss', (h, s, cad, seed) => flick(h, s, 0.3 * ((seed % 3) - 1), 9, cad, seed)],
    ['toss, flick 14 gs/s', 'toss', (h, s, cad, seed) => flick(h, s, 0.3 * ((seed % 3) - 1), 14, cad, seed)],
    ['toss, long carry then flick 12 gs/s', 'toss', (h, s, cad, seed) => { const a = s.onSheet(0.1, 1), p = s.pan(), m = s.away, d = Math.hypot(p.x - m.x, p.y - m.y);
      return walk(s.g, a, [{ to: m, v: 2 }, { to: { x: m.x + (p.x - m.x) / d * 1.3 * s.g.gcss, y: m.y + (p.y - m.y) / d * 1.3 * s.g.gcss }, v: 12 }], { gap: cad, stop: 0, seed }); }],
  ];
  for (const [w, hh] of [[390, 844], [844, 390]]) for (const [name, want, make] of cases) for (const [cname, cad] of CADENCES) for (let i = 0; i < 4; i++) {
    const h = ready(w, hh); snap(h); const s = spots(h); k++;
    const pts = make(h, s, cad, 100 + k);
    const r = drive(h, pts, { frames: true });
    rows.push({ screen: `${w}x${hh}`, name, cadence: cname, want, kind: outcome(h, r), events: pts.length, decision: h.run('lastDecision') });
  }
  const table = cases.map(([name, want]) => { const line = { case: name, want }; for (const [cname] of CADENCES) line[cname] = Object.entries(count(rows.filter(r => r.name === name && r.cadence === cname), 'kind')).map(([a, n]) => `${a} ${n}`).join(', '); return line; });
  console.table(table);
  const wrong = rows.filter(r => r.kind !== r.want);
  const out = { table, wrong: wrong.length, runs: rows.length, summary: `${rows.length} carries (${cases.length} cases × ${CADENCES.length} cadences × 2 screens × 4 seeds): wrong ${wrong.length}` + (wrong.length ? ' — ' + JSON.stringify(count(wrong.map(r => ({ o: `${r.name} @ ${r.cadence} → ${r.kind}` })), 'o')) : '') };
  if (wrong.length) failWith({ ...out, wrongRows: wrong.slice(0, 40) }, out.summary);
  return out;
});

// ── T10f: the comma is a decoration ───────────────────────────────────────────────────────────
test('T10f', 'arced hand path adds a quarter turn in flight, a straight one none; landing is always square; a standing jittery finger gathers no turn', () => {
  const rows = []; let k = 0;
  for (const [cname, cad] of CADENCES) for (const [name, arc, stop, want] of [['straight', 0, 100, 0], ['arc left', 2.4, 100, 90], ['arc right', -2.4, 100, 90], ['straight, then 3 s standing with ±3 px jitter', 0, 3000, 0]]) {
    const h = ready(); snap(h); const s = spots(h); k++;
    const r = drive(h, walk(s.g, s.onSheet(0.1), [{ to: s.pan(0.1), v: 5, arc }], { gap: cad, stop, stopEvents: true, jitter: stop > 1000 ? 3 : 1.5, seed: 200 + k }), { frames: true });
    const L = landed(h);
    rows.push({ cadence: cname, name, want, kind: outcome(h, r), rotDeg: r3(L.rotDeg), sweep: L.last && L.last.sweep_deg, spin: L.last && L.last.spin_deg });
  }
  const bad = rows.filter(r => r.kind !== 'lay' || Math.abs(Math.abs(r.rotDeg) - r.want) > 0.5);
  const by = n => rows.filter(r => r.name.startsWith(n));
  const out = { rows, summary: `straight: rotation ${[...new Set(by('straight').map(r => Math.abs(r.rotDeg)))].join('/')}°, measured path turn ${Math.min(...by('straight').map(r => r.sweep))}…${Math.max(...by('straight').map(r => r.sweep))}°; arcs: rotation ${[...new Set(by('arc').map(r => r.rotDeg))].join('/')}°, path turn ${by('arc').map(r => r.sweep).join(' ')}°` };
  if (bad.length) failWith({ ...out, bad }, `wrong ${bad.length}/${rows.length}: ` + out.summary);
  return out;
});

// ── T10g: the lay-down itself ─────────────────────────────────────────────────────────────────
test('T10g', 'lay-down: 0.30 s, the near edge touches first, contact and sizzle grow to full, rim glow only while a release would land', () => {
  const h = ready(390, 844, { audio: true }); snap(h); const s = spots(h);
  const glow = () => h.run('action.state==="CARRY"&&carryOverPan()');
  const pts = walk(s.g, s.onSheet(0.1), [{ to: s.pan(0.1), v: 5 }], { gap: () => 16.67, stop: 100, seed: 9 });
  // drive by hand to sample the glow on the way
  const t0 = h.getTime(); h.touch('start', 't1', pts[0].x, pts[0].y); const glowAt = [];
  for (const p of pts.slice(1, -1)) { const d = t0 + p.t - h.getTime(); if (d > 0) h.tick(1, d / 1000, true); h.touch('move', 't1', p.x, p.y);
    if (h.run('action.state') === 'CARRY') glowAt.push({ d: h.run('(()=>{const c=centerOfSheet();return Math.hypot(c.x+xf.ox-panC.x,c.y+xf.oy-panC.y)/PAN_R})()'), glow: glow() }); }
  const up = pts.at(-1); h.tick(6, 1 / 60, true); h.touch('end', 't1', up.x, up.y);
  assert.equal(h.run('action.state'), 'LAY');
  const frames = []; const a0 = h.audioLog.length;
  for (let i = 0; i < 40 && h.run('action.state') === 'LAY'; i++) {
    h.tick(1, 1 / 60, true);
    if (h.run('action.state') !== 'LAY') break;
    frames.push(JSON.parse(h.run(`(()=>{const S=xf.layS,u=xf.layU;let yOn=0,nOn=0,yAll=0,n=0;const c=centerOfSheet();
      for(let i=0;i<N;i++){if(conDeg&&conDeg[i]<=0)continue;n++;yAll+=py[i];if(layTouchAt(S[i])<=u){nOn++;yOn+=py[i];}}
      viewX();let lmax=0;for(let i=0;i<N;i++)lmax=Math.max(lmax,(xf.cy+xf.oy+(px[i]-xf.cx)*Math.sin(xf.th)+(py[i]-xf.cy)*Math.cos(xf.th))-viewY()[i]);
      return JSON.stringify({u,contact:xf.contact,nearer:nOn?(yOn/nOn-yAll/n)/sheetRadius():null,liftMax:lmax/sheetRadius()})})()`)));
  }
  const sizzle = h.audioLog.slice(a0).filter(e => e.method === 'setTargetAtTime' && e.args[2] === 0.03).map(e => r3(e.args[0]));
  const contact = frames.map(f => r3(f.contact)), mono = contact.every((c, i) => !i || c >= contact[i - 1]);
  const firstTouch = frames.find(f => f.contact > 0 && f.contact < 0.5);
  const far = glowAt.filter(g => g.d > 0.8), near = glowAt.filter(g => g.d < 0.7);
  const out = { layFrames: frames.length, contact, sizzle, liftMax: frames.map(f => r3(f.liftMax)), firstTouchNearer: firstTouch && r3(firstTouch.nearer), glowFar: far.filter(g => g.glow).length + '/' + far.length, glowNear: near.filter(g => g.glow).length + '/' + near.length,
    phase: h.run('phase'), summary: `${frames.length} frames (${r3(frames.length / 60)} s): contact ${contact[0]} → ${contact.at(-1)}, monotonic ${mono}; sizzle gain target ${sizzle[0]} → ${sizzle.at(-1)} (${sizzle.length} steps); first touched part lies ${firstTouch ? r3(firstTouch.nearer) : '—'} sheet radii nearer to the player than the sheet centre; far edge lift ${r3(frames[2].liftMax)} → ${r3(frames.at(-1).liftMax)} radii; rim glow: sheet centre farther than 0.8·PAN_R from the tava centre ${far.filter(g => g.glow).length}/${far.length}, closer than 0.7·PAN_R ${near.filter(g => g.glow).length}/${near.length}` };
  const ok = frames.length >= 16 && frames.length <= 19 && mono && contact[0] === 0 && contact.at(-1) >= 0.9 && firstTouch && firstTouch.nearer > 0.3 && sizzle.length >= 10 && sizzle.every((v, i) => !i || v >= sizzle[i - 1]) && sizzle.at(-1) >= 0.4
    && far.every(g => !g.glow) && near.length > 0 && near.every(g => g.glow) && h.run('phase') === 'PAN';
  if (!ok) failWith(out, out.summary);
  return out;
});

// ── T11: nothing happens by itself ────────────────────────────────────────────────────────────
function holdPoints(p, ms, hz, jitter, seed) {
  const rnd = lcg(seed), pts = [{ x: p.x, y: p.y, t: 0 }];
  for (let t = 1000 / hz; t < ms; t += 1000 / hz) pts.push({ x: p.x + 2 * jitter * rnd(), y: p.y + 2 * jitter * rnd(), t });
  pts.push({ x: p.x + 2 * jitter * rnd(), y: p.y + 2 * jitter * rnd(), t: ms, up: true });
  return pts;
}
test('T11', 'hold 1 s with ±3 px jitter in the middle and on the rim, 100 runs each: no transfer, no carry; 3 s standing in carry: still in the hand', () => {
  const rows = [];
  for (const [w, hh] of [[390, 844], [844, 390]]) for (const sheet of ['ready', 'small']) {
    const h = sheet === 'ready' ? ready(w, hh) : small(w, hh); snap(h); const s = spots(h);
    for (let i = 0; i < 25; i++) for (const [where, reach] of [['middle', 0.3 * ((i % 5) / 4)], ['rim', 1]]) {
      back(h);
      const hz = [30, 60, 120, 20][i % 4];
      const r = drive(h, holdPoints(s.onSheet(reach, i * 0.7), 1000, hz, 3, 500 + i), { frames: true });
      rows.push({ screen: `${w}x${hh}`, sheet, where, hz, kind: r.kind, phase: r.phase, same: same(h), tossTry: h.run('tossTry') - h.run('__s.tossTry') });
    }
  }
  const mid = rows.filter(r => r.where === 'middle'), rim = rows.filter(r => r.where === 'rim');
  const moved = rows.filter(r => r.kind !== 'none' || r.phase !== 'TABLE' || !r.same || r.tossTry);
  // standing in carry
  const stand = [];
  for (const [cname, cad] of CADENCES) {
    const h = ready(); snap(h); const s = spots(h);
    const pts = walk(s.g, s.onSheet(0.1), [{ to: s.away, v: 3 }], { gap: cad, stop: 3000, stopEvents: true, jitter: 3, seed: 77 });
    drive(h, pts, { frames: true, release: false });
    const held = { state: h.run('action.state'), xf: h.run('xf!==null'), heldMs: Math.round(pts.at(-1).t - pts[1].t) };
    const up = pts.at(-1); h.touch('end', 't1', up.x, up.y); for (let i = 0; i < 60 && h.run('action.state') !== 'RESTING'; i++) h.tick();
    stand.push({ cadence: cname, ...held, after: h.run('gestures.at(-1).kind') + '/' + h.run('gestures.at(-1).outcome'), phase: h.run('phase'), same: same(h) });
  }
  const badStand = stand.filter(r => !(r.state === 'CARRY' && r.xf && r.phase === 'TABLE' && r.same && r.after === 'carry/back'));
  const out = { middle: count(mid, 'kind'), rim: count(rim, 'kind'), stand,
    summary: `${mid.length} holds in the middle: ${JSON.stringify(count(mid, 'kind'))}; ${rim.length} on the rim: ${JSON.stringify(count(rim, 'kind'))}; transfers or carries ${moved.length}; standing ${stand[0].heldMs} ms in carry at 5 cadences: still CARRY ${stand.filter(r => r.state === 'CARRY').length}/5, then back bit-for-bit ${stand.filter(r => r.same).length}/5` };
  if (moved.length || badStand.length) failWith({ ...out, moved: moved.slice(0, 20), badStand }, out.summary);
  return out;
});

// ── T11b: the sheet follows the finger 1:1 ────────────────────────────────────────────────────
test('T11b', 'in the hand the sheet follows the finger 1:1: the grabbed point stays under the finger', () => {
  const rows = [];
  for (const [w, hh] of [[390, 844], [844, 390]]) {
    const h = ready(w, hh); const s = spots(h);
    const pts = walk(s.g, s.onSheet(0.2, 1), [{ to: s.away, v: 3 }, { to: s.pan(0.5, 2), v: 6 }], { gap: () => 16.67, stop: 0, jitter: 0, seed: 1 });
    const t0 = h.getTime(); h.touch('start', 't1', pts[0].x, pts[0].y); let worstTable = 0, worstPx = 0, liftPx = 0, n = 0, grabbed = null;
    for (const p of pts.slice(1, -1)) {
      const d = t0 + p.t - h.getTime(); if (d > 0) h.tick(1, d / 1000);
      h.touch('move', 't1', p.x, p.y);
      if (h.run('action.state') !== 'CARRY') continue;
      if (!grabbed) { grabbed = JSON.parse(h.run('JSON.stringify(action.carryFrom)')); continue; }
      // where the grabbed table point is drawn now (without the lift) against the finger
      const q = JSON.parse(h.run(`(()=>{const f=action.carryFrom,x=f.x+xf.ox,y=f.y+xf.oy,r=cv.getBoundingClientRect(),k=r.width/cv.width;
        return JSON.stringify({x:r.left+prX(x,y)*k,y:r.top+prY(x,y)*k,tx:x,ty:y,lift:(prY(x,y)-prY(x,y-xf.lift))*k,last:action.last})})()`));
      worstTable = Math.max(worstTable, Math.hypot(q.tx - q.last.x, q.ty - q.last.y) / s.g.gs); worstPx = Math.max(worstPx, Math.hypot(q.x - p.x, q.y - p.y)); liftPx = Math.max(liftPx, q.lift); n++;
    }
    rows.push({ screen: `${w}x${hh}`, samples: n, worstTableGs: worstTable, worstPx: r3(worstPx), liftPx: r3(liftPx) });
    h.touch('end', 't1', pts.at(-1).x, pts.at(-1).y);
  }
  const out = { rows, summary: rows.map(r => `${r.screen}: ${r.samples} moves, grabbed point off the finger by ≤ ${r.worstPx} CSS px (table error ${r.worstTableGs.toExponential(1)} gs); the sheet is drawn ${r.liftPx} px above it (lift)`).join('; ') };
  if (rows.some(r => !(r.samples > 20 && r.worstPx <= 0.5 && r.worstTableGs < 1e-6))) failWith(out, out.summary);
  return out;
});

// ── T11c: two fingers ─────────────────────────────────────────────────────────────────────────
test('T11c', 'second finger on the sheet while the first holds the rim (or pulls it): carry; the midpoint leads; ?carry= switches the entries', () => {
  const rows = [];
  const run = (mode, first, secondReach, to) => {
    const h = ready(); h.run(`CARRY_MODE=${JSON.stringify(mode)}`); snap(h); const s = spots(h);
    const a = s.onSheet(first === 'rim' ? 1 : first === 'pull' ? 1 : 0.2, 0), b = s.onSheet(secondReach, Math.PI);
    h.touch('start', 't1', a.x, a.y); h.tick(6);
    let a1 = a;
    if (first === 'pull') for (let i = 1; i <= 12; i++) { a1 = { x: a.x + (a.x - s.onSheet(0).x) / Math.hypot(a.x - s.onSheet(0).x, a.y - s.onSheet(0).y) * i * 1.5, y: a.y + (a.y - s.onSheet(0).y) / Math.hypot(a.x - s.onSheet(0).x, a.y - s.onSheet(0).y) * i * 1.5 }; h.advance(16.67); h.touch('move', 't1', a1.x, a1.y); h.run('step(1/60)'); }
    const stateBefore = h.run('action.state');
    h.touch('start', 't2', b.x, b.y); h.tick(2);
    const entered = h.run('action.state'), two = h.run('!!action.two');
    const dest = to === 'pan' ? s.pan() : s.away, mid = { x: (a1.x + b.x) / 2, y: (a1.y + b.y) / 2 }, steps = 40;
    let follow = 0;
    for (let i = 1; i <= steps; i++) {
      const dx = (dest.x - mid.x) * i / steps, dy = (dest.y - mid.y) * i / steps;
      h.advance(16.67); h.touch('move', 't1', a1.x + dx, a1.y + dy); h.touch('move', 't2', b.x + dx, b.y + dy); h.run('step(1/60)');
      if (h.run('action.state') === 'CARRY') { const q = JSON.parse(h.run('JSON.stringify({x:action.carryFrom.x+xf.ox,y:action.carryFrom.y+xf.oy,l:action.last})')); follow = Math.max(follow, Math.hypot(q.x - q.l.x, q.y - q.l.y) / s.g.gs); }
    }
    h.tick(8);
    h.touch('end', 't2', b.x + dest.x - mid.x, b.y + dest.y - mid.y); h.tick(3);
    const kept = h.run('action.state');            // one of two fingers lifted: still in the hand (build 71)
    h.touch('end', 't1', a1.x + dest.x - mid.x, a1.y + dest.y - mid.y);
    for (let i = 0; i < 90 && h.run('action.state') !== 'RESTING'; i++) h.tick();
    h.tick(4);
    const last = h.run('gestures.length>__s.gl') ? JSON.parse(h.run('JSON.stringify(gestures.at(-1))')) : null;
    rows.push({ mode, first, secondReach, to, stateBefore, entered, two, kept, follow, phase: h.run('phase'), kind: last && last.kind, entry: last && last.entry, state: h.run('action.state'), same: h.run('phase') === 'TABLE' ? same(h) : null });
  };
  run('both', 'rim', 0.3, 'pan'); run('both', 'rim', 0.3, 'table'); run('both', 'pull', 0.5, 'pan'); run('both', 'mid', 0.3, 'pan');
  run('both', 'rim', 1.6, 'pan');            // second finger off the sheet: ignored as before
  run('mid', 'rim', 0.3, 'pan');             // ?carry=mid: the second finger does nothing
  run('two', 'rim', 0.3, 'pan');             // ?carry=two: two fingers carry …
  { const h = ready(); h.run('CARRY_MODE="two"'); snap(h); const s = spots(h);   // … and the middle touch does not
    const r = drive(h, walk(s.g, s.onSheet(0.1), [{ to: s.pan(), v: 4 }], { gap: () => 16.67, stop: 100, seed: 2 }), { frames: true });
    rows.push({ mode: 'two', first: 'mid alone', to: 'pan', phase: r.phase, kind: r.kind, entered: h.run('lastDecision') }); }
  const want = [['PAN', 'lay', 'two'], ['TABLE', 'carry', 'two'], ['PAN', 'lay', 'two'], ['PAN', 'lay', 'two'], ['TABLE', null], ['TABLE', null], ['PAN', 'lay', 'two'], ['TABLE']];
  const bad = rows.filter((r, i) => r.phase !== want[i][0] || (want[i][1] !== undefined && want[i][1] !== null && r.kind !== want[i][1]) || (want[i][2] && r.entry !== want[i][2]) || (want[i][1] === null && r.two) || (r.follow > 1e-6) || (r.two && r.kept !== 'CARRY') || (r.kind === 'carry' && r.same === false) || (r.state && r.state !== 'RESTING'));
  const out = { rows, summary: rows.map(r => `${r.mode}/${r.first}${r.secondReach ? '+' + r.secondReach : ''}→${r.to}: ${r.entered}${r.two ? ' (two)' : ''} → ${r.phase} ${r.kind || '—'}`).join('; ') };
  if (bad.length) failWith({ ...out, bad }, `wrong ${bad.length}: ` + out.summary);
  return out;
});

// ── T11d: cancel, blur, and a slap from the rim ───────────────────────────────────────────────
test('T11d', 'touchcancel and blur in carry put the sheet back bit for bit; a fast arc from the rim is a slap (or nothing, by the slice-1 rules), never a transfer', () => {
  const rows = [];
  for (const how of ['cancel', 'blur']) {
    const h = ready(); snap(h); const s = spots(h);
    const pts = walk(s.g, s.onSheet(0.1), [{ to: s.pan(0.2), v: 4 }], { gap: () => 16.67, stop: 50, seed: 4 });
    drive(h, pts, { frames: true, release: false });
    const state = h.run('action.state');
    if (how === 'cancel') h.touch('cancel', 't1', pts.at(-1).x, pts.at(-1).y); else h.fire('blur', { target: h.context });
    h.tick(3);
    rows.push({ how, state, after: h.run('action.state'), phase: h.run('phase'), same: same(h), xf: h.run('xf===null') });
  }
  const bad = rows.filter(r => !(r.state === 'CARRY' && r.after === 'RESTING' && r.phase === 'TABLE' && r.same && r.xf));
  // arcs from the rim towards the tava, 60–120° of turn, ready sheet
  const arcs = [];
  for (const [cname, cad] of CADENCES) for (const arc of [1.0, -1.0, 1.8]) for (const v of [8, 14]) {
    const h = ready(); snap(h); const s = spots(h);
    // from the rim sideways-outward («через верх»), bending towards the tava: 1.0 gs out, then 1.6 gs to the tava
    const c0 = s.onSheet(0), p = s.pan(), side = s.g.stacked ? 0 : -Math.PI / 2, a = s.onSheet(1, side), ol = Math.hypot(a.x - c0.x, a.y - c0.y), d = Math.hypot(p.x - a.x, p.y - a.y);
    const m = { x: a.x + (a.x - c0.x) / ol * 1.0 * s.g.gcss, y: a.y + (a.y - c0.y) / ol * 1.0 * s.g.gcss };
    const r = drive(h, walk(s.g, a, [{ to: m, v, arc: arc * 0.3 }, { to: { x: m.x + (p.x - a.x) / d * 1.6 * s.g.gcss, y: m.y + (p.y - a.y) / d * 1.6 * s.g.gcss }, v, arc: arc * 0.3 }], { gap: cad, hold: 130, stop: 0, seed: 300 + arcs.length }), { frames: true });
    arcs.push({ cadence: cname, arc, v, kind: r.kind, phase: r.phase });
  }
  const out = { rows, arcs: count(arcs, 'kind'), summary: `cancel/blur in carry: ${rows.map(r => `${r.how} ${r.state}→${r.after}, same sheet ${r.same}`).join('; ')}; ${arcs.length} fast arcs from the rim towards the tava: ${JSON.stringify(count(arcs, 'kind'))}, onto the tava ${arcs.filter(r => r.phase === 'PAN').length}` };
  if (bad.length || arcs.some(r => r.phase === 'PAN' || !/^(slap|pull|none)$/.test(r.kind))) failWith({ ...out, arcsRows: arcs }, out.summary);
  return out;
});

// ── Tava side ─────────────────────────────────────────────────────────────────────────────────
// A sheet put on the tava the way the «образец» button does it, then folded by real touches:
// a slow stroke from the middle of a side of the bounding box to the centre of the dish.
function dishOnPan(w = 390, hh = 844, folds = 0) {
  const h = boot(TUNE, w, hh); h.run('stepNo=3;reset();'); h.tick(2);
  h.run('{const c=centerOfSheet();xf={cx:c.x,cy:c.y};bakeTransform(panC.x-c.x,panC.y-c.y,0);xf=null;phase="PAN";measureThickness();startDish();}');
  h.tick(2);
  const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let k = 0; k < folds; k++) {
    const b = JSON.parse(h.run('JSON.stringify(dishBounds())')), cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2, [sx, sy] = sides[k];
    const from = h.dishToClient({ x: sx < 0 ? b.left : sx > 0 ? b.right : cx, y: sy < 0 ? b.top : sy > 0 ? b.bottom : cy }), to = h.dishToClient({ x: cx, y: cy });
    const pts = [{ ...from, t: 0 }]; for (let j = 1; j <= 24; j++) pts.push({ x: from.x + (to.x - from.x) * j / 24, y: from.y + (to.y - from.y) * j / 24, t: 150 + j * 16.67 }); pts.push({ ...to, t: 150 + 24 * 16.67 + 120, up: true });
    dishDrive(h, pts);
    assert.equal(h.run('dish.folds'), k + 1, `fold ${k + 1} by a touch stroke`);
  }
  return h;
}
// pts as in drive(), but for the dish: full frames between events, returns the last logged pan gesture.
function dishDrive(h, pts, { release = true } = {}) {
  const t0 = h.getTime(), n0 = h.run('gestures.length'); let nextFrame = 16.67;
  const to = t => { const d = t0 + t - h.getTime(); if (d > 0) h.advance(d); };
  h.touch('start', 't1', pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) {
    while (nextFrame <= p.t) { to(nextFrame); h.run('step(1/60)'); nextFrame += 16.67; }
    if (p.up && !release) break;
    to(p.t); h.touch(p.up ? 'end' : 'move', 't1', p.x, p.y);
  }
  h.tick(40);
  const g = h.run('gestures.length') > n0 ? JSON.parse(h.run('JSON.stringify(gestures.at(-1))')) : null;
  return { outcome: g && g.kind === 'pan' ? g.outcome : g ? g.kind : 'none', log: g, mode: h.run('dish?dish.mode:null'), phase: h.run('phase'), folds: h.run('dish?dish.folds:null'), flips: h.run('dish?dish.flips:null') };
}
const dishSpots = h => {
  const b = JSON.parse(h.run('JSON.stringify({b:dishBounds(),c:dishCentroid(),w:zone("work"),gcss:gsCss(),gs:gestureScale,stacked:stackedLayout()})'));
  return { ...b, centre: h.dishToClient(b.c), table: h.toClient(b.w.cx, b.w.cy), g: { gcss: b.gcss, gs: b.gs } };
};
test('T10h', 'on the tava: a folded roti taken by the middle and carried to the table is removed (to cutting) at every cadence; released over the tava it stays; holding still is a press; an unfolded sheet is not carried', () => {
  const rows = []; let k = 0;
  for (const folds of [2, 4]) for (const [cname, cad] of CADENCES) for (const [name, want] of [['to the table', 'remove'], ['a little and stop over the tava', 'carry-back'], ['hold 1 s, ±3 px', 'press']]) {
    const h = dishOnPan(390, 844, folds); const s = dishSpots(h); k++;
    h.run('globalThis.__faces=dish.faces');
    const pts = name === 'to the table' ? walk(s.g, s.centre, [{ to: s.table, v: 4 }], { gap: cad, stop: 120, seed: 600 + k })
      : name.startsWith('a little') ? walk(s.g, s.centre, [{ to: { x: s.centre.x + 30, y: s.centre.y + 10 }, v: 2 }], { gap: cad, stop: 120, seed: 600 + k })
      : holdPoints(s.centre, 1000, 60, 3, 600 + k);
    const r = dishDrive(h, pts);
    rows.push({ folds, cadence: cname, name, want, outcome: r.outcome, mode: r.mode, phase: r.phase, facesKept: h.run('dish.faces===__faces'), carry: r.log && r.log.carry === true });
  }
  for (const [w, hh] of [[390, 844], [844, 390]]) {   // unfolded: the middle is a press, as before
    const h = dishOnPan(w, hh, 0); const s = dishSpots(h);
    const r = dishDrive(h, walk(s.g, s.centre, [{ to: s.table, v: 4 }], { gap: () => 16.67, stop: 120, seed: 9 }));
    rows.push({ folds: 0, cadence: `60 Hz ${w}x${hh}`, name: 'unfolded, to the table', want: 'press', outcome: r.outcome === 'pinch' ? 'press' : r.outcome, mode: r.mode, phase: r.phase });
  }
  { const h = dishOnPan(844, 390, 2); const s = dishSpots(h);   // landscape
    const r = dishDrive(h, walk(s.g, s.centre, [{ to: s.table, v: 4 }], { gap: () => 16.67, stop: 120, seed: 10 }));
    rows.push({ folds: 2, cadence: '60 Hz 844x390', name: 'to the table', want: 'remove', outcome: r.outcome, mode: r.mode, phase: r.phase }); }
  const bad = rows.filter(r => r.outcome !== r.want || (r.want === 'remove' ? !(r.mode === 'cut' && r.phase === 'CUT') : !(r.mode === 'fold' && r.phase === 'PAN')) || (r.want === 'carry-back' && !r.facesKept));
  const by = n => JSON.stringify(count(rows.filter(r => r.name === n), 'outcome'));
  const out = { rows, summary: `${rows.length} gestures on 2- and 4-fold roti at 5 cadences: to the table ${by('to the table')}; stop over the tava ${by('a little and stop over the tava')}; hold ${by('hold 1 s, ±3 px')}; unfolded sheet ${by('unfolded, to the table')}` };
  if (bad.length) failWith({ ...out, bad }, `wrong ${bad.length}: ` + out.summary);
  return out;
});
// Strokes from the edge of the roti. Runs on build 69 too (it uses nothing new), to show what changed.
test('T10i', 'on the tava, strokes from the edge at every cadence: fast outward flick — flip (never a removal); slow outward drag to the table — nothing; slow inward stroke — fold', () => {
  const rows = []; let k = 0;
  for (const [cname, cad] of CADENCES) for (let i = 0; i < 8; i++) {
    for (const kind of ['flick out', 'drag out', 'fold in']) {
      const h = dishOnPan(390, 844, 2); const s = dishSpots(h); k++;
      // the side of the bounding box that faces the work table (portrait: the near one)
      const b = s.b, edge = h.dishToClient({ x: (b.left + b.right) / 2 + (i % 3 - 1) * 0.1, y: b.bottom }), c = s.centre, l = Math.hypot(edge.x - c.x, edge.y - c.y), ox = (edge.x - c.x) / l, oy = (edge.y - c.y) / l;
      const a = (i % 4 - 1.5) * 0.25, dx = ox * Math.cos(a) - oy * Math.sin(a), dy = ox * Math.sin(a) + oy * Math.cos(a);
      let pts;
      if (kind === 'flick out') { const L = 110 + 10 * (i % 4), v = (1100 + 150 * (i % 4)) / s.g.gcss; pts = walk(s.g, edge, [{ to: { x: edge.x + dx * L, y: edge.y + dy * L }, v }], { gap: cad, hold: 150, stop: 0, seed: 700 + k }); }
      else if (kind === 'drag out') pts = walk(s.g, edge, [{ to: s.table, v: 3 }], { gap: cad, hold: 150, stop: 100, seed: 700 + k });
      else pts = walk(s.g, edge, [{ to: { x: edge.x - dx * 45, y: edge.y - dy * 45 }, v: 2.5 }], { gap: cad, hold: 150, stop: 60, seed: 700 + k });
      const r = dishDrive(h, pts);
      rows.push({ cadence: cname, kind, outcome: r.outcome, mode: r.mode, folds: r.folds, speed: r.log && r.log.speed, stale: r.log && r.log.stale_ms, dur: r.log && r.log.duration_ms, path: r.log && r.log.path_css });
    }
  }
  const table = ['flick out', 'drag out', 'fold in'].map(kind => { const line = { stroke: kind }; for (const [cname] of CADENCES) line[cname] = Object.entries(count(rows.filter(r => r.kind === kind && r.cadence === cname), 'outcome')).map(([a, n]) => `${a} ${n}`).join(', '); return line; });
  console.table(table);
  const ok = r => r.kind === 'flick out' ? /^flip/.test(r.outcome) && r.mode === 'fold' : r.kind === 'drag out' ? r.outcome === 'none' && r.mode === 'fold' : r.outcome === 'fold' && r.folds === 3;
  const wrong = rows.filter(r => !ok(r)), fl = rows.filter(r => r.kind === 'flick out');
  const out = { table, wrong: wrong.length, summary: `${rows.length} strokes (8 per cadence): flick out ${JSON.stringify(count(fl, 'outcome'))}; drag out ${JSON.stringify(count(rows.filter(r => r.kind === 'drag out'), 'outcome'))}; fold in ${JSON.stringify(count(rows.filter(r => r.kind === 'fold in'), 'outcome'))}; wrong ${wrong.length}` };
  if (wrong.length) failWith({ ...out, wrongRows: wrong.slice(0, 40) }, out.summary);
  return out;
});

// ── Build 71: review of slice 2 ───────────────────────────────────────────────────────────────
// T10c2: the toss is judged by where the hand aims, not by the cone from the sheet that has already
// followed the finger sideways (portrait: the cone shrank to ±28°). T12a: a stray second finger in
// a one-finger carry neither drops the sheet nor orphans the first finger. T12b: a touch during the
// 0.16 s return picks the sheet up again. T10j: drift, pause, flick on the tava. T10k: a press that
// slides stays a press; a quick drag is a carry.
test('T10c2', 'portrait: flicks 20/30/40° off the line to the tava still cross it — toss; 90° and more — back', () => {
  const rows = []; let k = 0;
  for (const deg of [20, -20, 30, -30, 40, -40, 90, -90, 150]) for (const [cname, cad] of CADENCES) for (const v of [10, 21]) {
    const h = ready(390, 844); snap(h); const s = spots(h); k++;
    const want = Math.abs(deg) <= 40 ? 'toss' : 'carry';
    const r = drive(h, flick(h, s, deg * Math.PI / 180, v, cad, 900 + k, 2.2), { frames: true });
    rows.push({ deg, cadence: cname, v, want, kind: outcome(h, r), decision: h.run('lastDecision') });
  }
  const wrong = rows.filter(r => r.kind !== r.want);
  const out = { rows, summary: `${rows.length} flicks: ` + [20, 30, 40, 90, 150].map(d => `${d}° ${JSON.stringify(count(rows.filter(r => Math.abs(r.deg) === d), 'kind'))}`).join('; ') + `; wrong ${wrong.length}` };
  if (wrong.length) failWith({ ...out, wrongRows: wrong }, out.summary);
  return out;
});
test('T12a', 'one-finger carry, a second finger taps (on the table, on the carried sheet) and lifts: the sheet stays in the hand, the first finger carries it on to the tava; lifted over the table — back, bit for bit', () => {
  const rows = [];
  for (const [where, to] of [['table', 'pan'], ['sheet', 'pan'], ['table', 'table'], ['sheet', 'table']]) {
    const h = ready(); snap(h); const s = spots(h), a = s.onSheet(0.1, 0), m = { x: a.x + 40, y: a.y - 30 };
    h.touch('start', 't1', a.x, a.y); h.tick(4);
    for (let i = 1; i <= 10; i++) { h.advance(16.67); h.touch('move', 't1', a.x + (m.x - a.x) * i / 10, a.y + (m.y - a.y) * i / 10); h.run('step(1/60)'); }
    const before = h.run('action.state');
    const b = where === 'table' ? { x: m.x + 60, y: m.y + 20 } : { x: m.x - 20, y: m.y + 10 };
    h.touch('start', 't2', b.x, b.y); h.tick(4); h.touch('end', 't2', b.x, b.y); h.tick(4);
    const after = h.run('action.state'), jump = h.run('Math.hypot(xf.ox,xf.oy)');
    const dest = to === 'pan' ? s.pan() : s.away;
    for (let i = 1; i <= 30; i++) { h.advance(16.67); h.touch('move', 't1', m.x + (dest.x - m.x) * i / 30, m.y + (dest.y - m.y) * i / 30); h.run('step(1/60)'); }
    h.tick(8); h.touch('end', 't1', dest.x, dest.y);
    for (let i = 0; i < 90 && h.run('action.state') !== 'RESTING'; i++) h.tick();
    rows.push({ where, to, before, after, phase: h.run('phase'), state: h.run('action.state'), kind: h.run('gestures.length>__s.gl') ? h.run('gestures.at(-1).kind') : null, same: h.run('phase') === 'TABLE' ? same(h) : null });
  }
  const bad = rows.filter(r => r.before !== 'CARRY' || r.after !== 'CARRY' || r.state !== 'RESTING' || (r.to === 'pan' ? !(r.phase === 'PAN' && r.kind === 'lay') : !(r.phase === 'TABLE' && r.kind === 'carry' && r.same)));
  const out = { rows, summary: rows.map(r => `tap on ${r.where} → ${r.after}, on to ${r.to}: ${r.phase} ${r.kind}`).join('; ') };
  if (bad.length) failWith({ ...out, bad }, `wrong ${bad.length}: ` + out.summary);
  return out;
});
test('T12b', 'a touch 50 ms after the sheet was let go over the table (it is still returning) takes it again and carries it to the tava', () => {
  const rows = [];
  for (const [cname, cad] of CADENCES) {
    const h = ready(); snap(h); const s = spots(h);
    drive(h, walk(s.g, s.onSheet(0.1), [{ to: { x: s.onSheet(0.1).x + 30, y: s.onSheet(0.1).y + 8 }, v: 3 }], { gap: cad, stop: 120, seed: 3 }), { frames: true, settle: false });
    const st0 = h.run('action.state'); h.advance(50); h.run('step(0.05)');
    const st1 = h.run('action.state');
    const r = drive(h, walk(s.g, s.onSheet(0.15), [{ to: s.pan(), v: 5 }], { gap: cad, hold: 30, stop: 120, seed: 4 }), { frames: true });
    rows.push({ cadence: cname, afterRelease: st0, at50ms: st1, phase: r.phase, kind: outcome(h, r) });
  }
  const bad = rows.filter(r => r.afterRelease !== 'BACK' || r.at50ms !== 'BACK' || r.phase !== 'PAN' || r.kind !== 'lay');
  const out = { rows, summary: rows.map(r => `${r.cadence}: ${r.at50ms} → ${r.phase} ${r.kind}`).join('; ') };
  if (bad.length) failWith({ ...out, bad }, `wrong ${bad.length}: ` + out.summary);
  return out;
});
test('T10j', 'on the tava: drift 18 px from the edge, pause 120/250/400 ms, then a fast outward flick whose first event carries 35–60 px — flip at every cadence', () => {
  const rows = []; let k = 0;
  for (const [cname, cad] of CADENCES) for (const pause of [120, 250, 400]) for (const first of [4, 35, 60]) {
    const h = dishOnPan(390, 844, 2); const s = dishSpots(h); k++;
    const rnd = lcg(800 + k), b = s.b, edge = h.dishToClient({ x: (b.left + b.right) / 2, y: b.bottom }), c = s.centre, l = Math.hypot(edge.x - c.x, edge.y - c.y), ox = (edge.x - c.x) / l, oy = (edge.y - c.y) / l;
    const at = d => ({ x: edge.x + ox * d + 3 * rnd(), y: edge.y + oy * d + 3 * rnd() });
    const pts = [{ ...edge, t: 0 }]; let t = 150, d = 0;
    for (; d < 18; ) { t += cad(rnd); d = Math.min(18, d + 120 * cad(rnd) / 1000 + 3); pts.push({ ...at(d), t }); }   // slow drift
    t += pause; d += first; pts.push({ ...at(d), t });                                                                // first event after the pause
    const end = d + 110; for (; d < end; ) { const g = Math.min(cad(rnd), (end - d) / 1.6); t += g; d = Math.min(end, d + 1600 * g / 1000 + 1e-6); pts.push({ ...at(d), t }); }
    pts.push({ ...pts.at(-1), t: t + 4, up: true });
    const r = dishDrive(h, pts);
    rows.push({ cadence: cname, pause, first, outcome: r.outcome, dur: r.log && r.log.duration_ms, speed: r.log && r.log.speed, path: r.log && r.log.path_css });
  }
  const wrong = rows.filter(r => !/^flip/.test(r.outcome));
  const out = { rows, summary: `${rows.length} drift-pause-flicks (5 cadences × 3 pauses × first step 4/35/60 px): ${JSON.stringify(count(rows, 'outcome'))}; stroke duration max ${Math.max(...rows.map(r => r.dur || 0))} ms` };
  if (wrong.length) failWith({ ...out, wrongRows: wrong }, `wrong ${wrong.length}: ` + out.summary);
  return out;
});
test('T10k', 'on the tava, folded roti: a press that slides 20 px over 1 s stays a press (and follows the finger); a drag that starts at once is a carry; a long press then 40 px is a carry; an unfolded sheet dragged to the table gets the hint', () => {
  const rows = [];
  for (const folds of [2, 4]) for (const [cname, cad] of CADENCES) {
    for (const [name, want] of [['slide 20 px / 1 s', 'press'], ['drag at once 30 px', 'carry-back'], ['press 400 ms, then 40 px', 'carry-back']]) {
      const h = dishOnPan(390, 844, folds); const s = dishSpots(h), c = s.centre;
      const pts = [{ ...c, t: 0 }]; const rnd = lcg(folds * 50 + rows.length);
      if (name.startsWith('slide')) { for (let t = cad(rnd); t < 1000; t += cad(rnd)) pts.push({ x: c.x + 20 * t / 1000, y: c.y, t }); pts.push({ x: c.x + 20, y: c.y, t: 1004, up: true }); }
      else if (name.startsWith('drag')) { let t = 60; for (let d = 0; d < 30; ) { t += cad(rnd); d = Math.min(30, d + 300 * cad(rnd) / 1000); pts.push({ x: c.x + d, y: c.y, t }); if (t > 240) break; } pts.push({ ...pts.at(-1), t: t + 120, up: true }); }
      else { let t = 400; for (let d = 0; d < 40; ) { t += cad(rnd); d = Math.min(40, d + 200 * cad(rnd) / 1000); pts.push({ x: c.x + d, y: c.y, t }); } pts.push({ ...pts.at(-1), t: t + 120, up: true }); }
      const r = dishDrive(h, pts);
      rows.push({ folds, cadence: cname, name, want, outcome: r.outcome, press_ms: r.log && r.log.press_ms });
    }
  }
  const hint = [];
  for (const start of ['middle', 'edge']) { const h = dishOnPan(390, 844, 0); const s = dishSpots(h), b = s.b;
    const from = start === 'middle' ? s.centre : h.dishToClient({ x: (b.left + b.right) / 2, y: b.bottom });
    dishDrive(h, walk(s.g, from, [{ to: s.table, v: 3 }], { gap: () => 16.67, hold: 150, stop: 100, seed: 5 }));
    hint.push({ start, message: h.run('dish.message'), mode: h.run('dish.mode'), phase: h.run('phase') }); }
  const bad = rows.filter(r => r.outcome !== r.want || (r.want === 'press' && !(r.press_ms >= 900))), badHint = hint.filter(x => !/Сначала сверни/.test(x.message) || x.mode !== 'fold' || x.phase !== 'PAN');
  const by = n => JSON.stringify(count(rows.filter(r => r.name === n), 'outcome'));
  const out = { rows, hint, summary: `slide ${by('slide 20 px / 1 s')}; drag at once ${by('drag at once 30 px')}; long press then 40 px ${by('press 400 ms, then 40 px')}; unfolded hint ${hint.length - badHint.length}/${hint.length}` };
  if (bad.length || badHint.length) failWith({ ...out, bad, badHint }, `wrong ${bad.length + badHint.length}: ` + out.summary);
  return out;
});

const reportDir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
if (require.main === module) {
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'carry-results.json');
  fs.writeFileSync(reportPath, JSON.stringify({ stand: H.sourcePath, sha256: H.sourceSha256, only: only ? [...only] : null, results }, null, 2));
  const failed = results.filter(r => r.status === 'FAIL');
  console.log(`${results.length - failed.length}/${results.length} passed` + (failed.length ? ` — failed: ${failed.map(r => r.id).join(', ')}` : '') + ` · report ${reportPath}`);
  process.exitCode = failed.length ? 1 : 0;
}
