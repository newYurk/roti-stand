#!/usr/bin/env node
'use strict';
// Slice 1 of the square stretch (build 67–68, #91): pull + slap, rounded-square target,
// frame-rate-independent classification. Acceptance checks T1–T9e (T9i: build 75) of
// runs/square-stretch-spec-2026-11-16.md §6 (T9f is model-regression.cjs itself).
// Build 68 (review of 17.11): T1b live-finger profiles (deceleration, dash–stop–release, no hold),
// T9d also covers blur, T9g star/cross and the corner notes, T9h oblique pulls; T9 judges the
// shape by rim/target sectors and compares thickness at equal area. The rim is measured from the
// target centre (targetC), as the player sees it against the dashes.
// Pure Node/vm, same mocks as model-regression.cjs: this checks the model and the gesture
// state machine through the stand's real touch handlers, not a browser and not the feel.
//   node prototype/dough-closeup/checks/square-stretch-regression.cjs path/to/stand.js [--only T1,T2] [--full]
// ALWAYS pass the stand.js of the checkout under test as the first argument.
// --only: comma-separated test ids. --full: T9b with 200 random sequences (default 12; slow).
// Report: runs/checks/square-stretch-results.json of the checkout (runs/ is not in git).
// Strokes are given in SCREEN units: 1 gs = gsCss() CSS px, speed in gs/s — the unit the stand
// classifies in. Every "random" number is seeded; a run is reproducible.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const quiet = console.log; console.log = () => {};
const H = require('./model-regression.cjs');
console.log = quiet;
const { boot, press, slap, pull, stroke, strokePoints, drive, lcg } = H;
const args = process.argv.slice(3);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',')) : null; })();
const FULL = args.includes('--full');
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

const TUNE = { com: 100, creep: 100, brk: 100 };
// A flattened sheet on step 2. frame: 'riverside'|'canal' switches the stand into the approved-screen
// frame the way the image's onload does (the image itself is not loaded in Node).
function fresh(w = 390, hh = 844, { tune = TUNE, frame = null } = {}) {
  const h = boot(tune, w, hh);
  if (frame) h.run(`FRAME=FRAMES[${JSON.stringify(frame)}];frameOn=true;setTilt(FRAME.tilt||TILT_BASE);resize(true);`);
  press(h);
  return h;
}
// Sheet state snapshot for classification runs: the same sheet for every stroke of a table.
function snap(h) {
  h.run(`globalThis.__snap={px:px.slice(),py:py.slice(),prx:prx.slice(),pry:pry.slice(),vx:vx.slice(),vy:vy.slice(),thick:thick.slice(),pinned:pinned.slice(),conDeg:conDeg.slice(),
    rest:cons.map(c=>c.rest),broken:cons.map(c=>c.broken),quadRest:quadRest?quadRest.slice():null,stepNo,tornAt,sameSlapN,lastSlapDir,
    pullN:typeof pullN==='undefined'?0:pullN,corner:typeof cornerDone==='undefined'?null:cornerDone.slice(),sqC:typeof sqC==='undefined'||!sqC?null:{...sqC},gl:gestures.length,tossTry,tossOk};`);
}
function back(h) {
  h.run(`{const s=__snap;if(dish)throw new Error('snapshot: the sheet became a dish');
    px.set(s.px);py.set(s.py);prx.set(s.prx);pry.set(s.pry);vx.set(s.vx);vy.set(s.vy);thick.set(s.thick);pinned.set(s.pinned);conDeg.set(s.conDeg);
    cons.forEach((c,i)=>{c.rest=s.rest[i];c.broken=s.broken[i];});if(s.quadRest)quadRest.set(s.quadRest);
    stepNo=s.stepNo;tornAt=s.tornAt;sameSlapN=s.sameSlapN;lastSlapDir=s.lastSlapDir;plasticT=0;phase='TABLE';xf=null;
    if(typeof pullN!=='undefined')pullN=s.pullN;if(s.corner)cornerDone=s.corner.slice();if(typeof sqC!=='undefined')sqC=s.sqC?{...s.sqC}:null;
    gestures.length=s.gl;tossTry=s.tossTry;tossOk=s.tossOk;clearAction();}`);
}
const shape = h => JSON.parse(h.run(`(()=>{const c=typeof targetC==='function'?targetC():centerOfSheet();rimProfile(c);const at=a=>rimAt(a)/targetR;
  const side=[0,1,2,3].map(k=>at(k*Math.PI/2)), corner=[0,1,2,3].map(k=>at(Math.PI/4+k*Math.PI/2));
  const ratio=[];for(let b=0;b<RIM_BINS;b++)ratio.push(rimProf[b]/targetAt((b+0.5)/RIM_BINS*2*Math.PI-Math.PI));
  const m=metrics();
  return JSON.stringify({step:stepNo,phase,fill:sheetFill(),squareness:squareness(),side,corner,sideMax:Math.max(...side),cornerMax:Math.max(...corner),
    binMin:Math.min(...ratio),binMax:Math.max(...ratio),areaOverDisc:m.area/(Math.PI*targetR*targetR),inverted:m.invertedQuads,holes:m.holeQuads,broken:m.broken,
    minThickness:m.minThickness,medianThickness:m.medianThickness,finite:m.finite,corners:cornerDone.reduce((a,b)=>a+b,0),chord:!!readyBlinkAt})})()`));
const r3 = x => Math.round(x * 1000) / 1000;
const restSum = h => h.run('cons.reduce((s,c)=>s+c.rest,0)');
const count = (rows, key) => rows.reduce((m, r) => (m[r[key]] = (m[r[key]] || 0) + 1, m), {});
const V_SLAP = (() => { const h = boot(TUNE, 390, 844); return h.run('typeof V_SLAP==="undefined"?5:V_SLAP'); })();

const CADENCES = [[30, 33.3], [60, 16.67], [120, 8.33], [240, 4.17]];   // spec: 8.33 / 16.67 / 33.3 ms; 240 Hz added
// ── T1: the classification table ──────────────────────────────────────────────────────────────
// No physics frames here (1024 strokes): the decision is made in the touch handlers alone. T2 and
// T4–T7 run the same handlers with 60 Hz physics frames in between.
test('T1', 'straight 1.5 gs stroke: pull below the threshold, slap above, the same at every event cadence', () => {
  const h = fresh(); snap(h);
  const speeds = [1, 2, 3, 0.9 * V_SLAP, 1.1 * V_SLAP, 8, 12, 20], rows = [], table = [], mismatches = [];
  for (const v of speeds) {
    const want = v < V_SLAP ? 'pull' : 'slap', line = { 'speed gs/s': r3(v), want };
    const cells = new Map();
    for (const [hz, dt] of CADENCES) {
      const got = {};
      for (let dir = 0; dir < 8; dir++) for (const phase of [0.3, 0.8]) for (const jitter of [0, 1.5]) {
        back(h);
        const r = stroke(h, { angle: dir * Math.PI / 4, speed: v, dist: 1.5, hz: 1000 / dt, phase, jitter, seed: 1000 * dir + 17 * hz + (phase > 0.5 ? 7 : 3) }, { settle: false, frames: false });
        const kind = r.phase === 'PAN' ? 'toss' : r.kind;
        got[kind] = (got[kind] || 0) + 1; rows.push({ v, hz, dir, phase, jitter, kind });
        const key = `${dir}/${phase}/${jitter}`; if (!cells.has(key)) cells.set(key, new Set()); cells.get(key).add(kind);
      }
      line[`${hz} Hz`] = Object.entries(got).map(([k, n]) => `${k} ${n}`).join(', ');
    }
    for (const [key, kinds] of cells) if (kinds.size > 1) mismatches.push({ v, key, kinds: [...kinds] });
    table.push(line);
  }
  console.table(table);
  const wrong = rows.filter(r => r.kind !== (r.v < V_SLAP ? 'pull' : 'slap'));
  const out = { V_SLAP, runsPerSpeed: rows.length / speeds.length, table, wrong: wrong.length, mismatchesAcrossCadences: mismatches.length,
    summary: `${rows.length} strokes, ${rows.length / speeds.length} per speed (8 directions × 2 phases × jitter 0/±1.5 px × 4 cadences): wrong ${wrong.length}, differing across cadences ${mismatches.length}` };
  if (wrong.length || mismatches.length) failWith({ ...out, wrongRows: wrong.slice(0, 40), mismatches: mismatches.slice(0, 40) }, out.summary);
  return out;
});
// ── T1b: a live finger does not move at constant speed ─────────────────────────────────────────
// Review of 17.11 (P1, P2): T1–T6 drove constant-speed strokes released on the move; a real finger
// brakes at the end of a swipe, often stops before lifting, and often swipes right from the touch
// with no hold. Profiles: easeOut (fast start, braking to zero), sCurve (slow–fast–slow), dash
// (constant speed, then the finger stands still for `stop` ms and lifts). Fast set: mean speed
// ≥ 1.3·V_SLAP → slap. Slow set: peak speed ≤ 0.8·V_SLAP → pull. Physics frames run (a stopped
// finger is noticed by the frame loop), events at 60/120/240 Hz, ±1.5 px jitter, hold 0 and 300 ms.
function profilePoints(h, { angle = 0, hold = 300, hz = 60, dur, distAt, stop = 0, jitter = 0, seed = 1 }) {
  const st = JSON.parse(h.run(`(()=>{const c=centerOfSheet();rimProfile(c);return JSON.stringify({c,r:rimProf[rimBin(${angle})],gcss:gsCss()})})()`));
  const p0 = h.toClient(st.c.x + Math.cos(angle) * st.r, st.c.y + Math.sin(angle) * st.r), p1 = h.toClient(st.c.x + Math.cos(angle) * st.r * 1.3, st.c.y + Math.sin(angle) * st.r * 1.3);
  let dx = p1.x - p0.x, dy = p1.y - p0.y; const l = Math.hypot(dx, dy); dx /= l; dy /= l;
  const rnd = lcg(seed), dt = 1000 / hz, out = [{ ...p0, t: 0 }];
  const at = t => { const d = distAt(Math.min(t, dur)) * st.gcss; return { x: p0.x + dx * d + 2 * jitter * rnd(), y: p0.y + dy * d + 2 * jitter * rnd() }; };
  for (let t = dt * 0.5; t < dur; t += dt) out.push({ ...at(t), t: hold + t });
  out.push({ ...at(dur), t: hold + dur + stop, up: true });
  return out;
}
const PROFILES = { easeOut: (T, D) => t => D * (1 - (1 - t / T) ** 2), sCurve: (T, D) => t => { const u = t / T; return D * u * u * (3 - 2 * u); }, dash: (T, D) => t => D * t / T };
test('T1b', 'live-finger profiles: braking swipe, dash–stop–release, swipe right from the touch — slap when fast, pull when slow', () => {
  const h = fresh(); snap(h); const rows = [];
  const cases = [];
  // fast: [profile, T ms, D gs, stop ms] — mean speed D/T ≥ 1.3·V_SLAP
  for (const [T, D] of [[120, 1.0], [200, 1.5], [300, 2.0]]) for (const name of ['easeOut', 'sCurve']) cases.push({ name, T, D, stop: 0, want: 'slap' });
  for (const [v, D] of [[8, 1.0], [12, 1.0], [8, 2.0]]) for (const stop of [30, 80, 150, 400]) cases.push({ name: 'dash', T: D / v * 1000, D, stop, want: 'slap' });
  // slow: peak speed ≤ 0.8·V_SLAP (easeOut peaks at 2·D/T, sCurve at 1.5·D/T)
  for (const [T, D] of [[400, 0.4 * V_SLAP * 0.4], [600, 0.4 * V_SLAP * 0.6]]) cases.push({ name: 'easeOut', T, D, stop: 0, want: 'pull' });
  for (const [T, D] of [[400, 0.8 * V_SLAP / 1.5 * 0.4], [600, 0.8 * V_SLAP / 1.5 * 0.6]]) cases.push({ name: 'sCurve', T, D, stop: 0, want: 'pull' });
  for (const stop of [30, 80, 150, 400]) cases.push({ name: 'dash', T: 1.0 / (0.8 * V_SLAP) * 1000, D: 1.0, stop, want: 'pull' });
  let k = 0;
  for (const c of cases) for (const hz of [60, 120, 240]) for (const hold of [0, 300]) for (const jitter of [0, 1.5]) {
    back(h); k++;
    const r = drive(h, profilePoints(h, { angle: (k % 8) * Math.PI / 4, hold, hz, dur: c.T, distAt: PROFILES[c.name](c.T, c.D), stop: c.stop, jitter, seed: 300 + k }), { frames: true, settle: true });
    rows.push({ ...c, T: Math.round(c.T), D: r3(c.D), hz, hold, jitter, angle: k % 8, kind: r.phase === 'PAN' ? 'toss' : r.kind, decision: r.atRelease.decision });
  }
  const wrong = rows.filter(r => r.kind !== r.want), by = w => count(rows.filter(r => r.want === w), 'kind');
  const out = { cases: cases.length, strokes: rows.length, fast: by('slap'), slow: by('pull'), wrong: wrong.length,
    summary: `${rows.length} strokes (${cases.length} profiles × 3 cadences × hold 0/300 ms × jitter 0/±1.5 px): fast ${JSON.stringify(by('slap'))}, slow ${JSON.stringify(by('pull'))}, wrong ${wrong.length}` };
  if (wrong.length) failWith({ ...out, wrongRows: wrong.slice(0, 40) }, out.summary);
  return out;
});
// ── T2: slow pulls never become slaps ─────────────────────────────────────────────────────────
// A run that throws the sheet onto the tava ends that sheet: the next run starts from a fresh one
// (on build 66 this is the usual outcome, which is what the check is for).
function slowPulls(n = 100) {
  let h = fresh(); snap(h); const rnd = lcg(20261117), rows = [];
  for (let i = 0; i < n; i++) {
    if (h.run('phase') !== 'TABLE' || h.run('!!dish')) { h = fresh(); snap(h); } else back(h);
    const hz = [60, 120, 240][i % 3], u = () => rnd() + 0.5;
    const o = { angle: u() * 2 * Math.PI, speed: 0.8 + 2.2 * u(), dist: 0.6 + 1.0 * u(), hz, phase: u(), jitter: 1.5, tjitter: Math.min(3, 250 / hz), hold: 150 + 300 * u(), seed: 5000 + i };
    const r = stroke(h, o, { settle: true });
    rows.push({ hz, speed: r3(o.speed), kind: r.kind, phase: r.phase });
  }
  return rows;
}
test('T2', 'slow pull 0.8–3 gs/s with ±1.5 px and ±3 ms jitter at 60/120/240 Hz, 100 seeded runs: no slap, no transfer', () => {
  const rows = slowPulls(), kinds = count(rows, 'kind'), byHz = {};
  for (const r of rows) (byHz[r.hz] = byHz[r.hz] || {})[r.kind] = ((byHz[r.hz] || {})[r.kind] || 0) + 1;
  const bad = rows.filter(r => r.kind === 'slap' || r.kind === 'toss' || r.phase !== 'TABLE');
  const out = { kinds, byHz, transfers: rows.filter(r => r.phase !== 'TABLE').length, summary: `100 runs: ${JSON.stringify(kinds)}; by cadence ${JSON.stringify(byHz)}; slaps or transfers ${bad.length}, of them onto the tava ${rows.filter(r => r.phase !== 'TABLE').length}` };
  if (bad.length) failWith({ ...out, bad }, out.summary);
  return out;
});
// ── T3: a held finger that only trembles does nothing ─────────────────────────────────────────
test('T3', 'hold 1 s with ±3 px jitter, plain and framed stands, 100 runs: no gesture, no transfer', () => {
  const modes = [[390, 844, null], [844, 390, null], [844, 390, 'riverside'], [844, 390, 'canal'], [390, 844, 'canal']], rows = [], gs = {};
  let k = 0;
  for (const [w, hh, frame] of modes) {
    const h = fresh(w, hh, { frame }); snap(h); const before = h.metrics();
    gs[`${w}x${hh}${frame ? ' ' + frame : ''}`] = { gsCss: r3(h.run('gsCss()')), deadZoneCss: r3(h.run('gestureSlop()*gsCss()')) };
    for (let i = 0; i < 20; i++, k++) {
      back(h);
      const hz = i % 2 ? 120 : 60, rnd = lcg(900 + k), a = (rnd() + 0.5) * 2 * Math.PI;
      const st = JSON.parse(h.run(`(()=>{const c=centerOfSheet();rimProfile(c);return JSON.stringify({c,r:rimProf[rimBin(${a})]})})()`));
      const p0 = h.toClient(st.c.x + Math.cos(a) * st.r, st.c.y + Math.sin(a) * st.r), pts = [{ ...p0, t: 0 }];
      for (let t = 1000 / hz; t < 1000; t += 1000 / hz) pts.push({ x: p0.x + 6 * rnd(), y: p0.y + 6 * rnd(), t });
      pts.push({ x: p0.x + 6 * rnd(), y: p0.y + 6 * rnd(), t: 1000, up: true });
      const r = drive(h, pts, { frames: i < 2 ? true : false, settle: true });
      const m = h.metrics();
      rows.push({ mode: `${w}x${hh}${frame ? ' ' + frame : ''}`, hz, kind: r.kind, state: r.atRelease.state, phase: r.phase, inverted: m.invertedQuads, restSame: i < 2 ? null : h.run('cons.every((c,i)=>c.rest===__snap.rest[i])') });
    }
    assert.equal(before.invertedQuads, 0);
  }
  const bad = rows.filter(r => r.kind !== 'none' || r.phase !== 'TABLE' || r.inverted || r.restSame === false);
  const out = { modes: gs, kinds: count(rows, 'kind'), summary: `100 holds over ${modes.length} stands: ${JSON.stringify(count(rows, 'kind'))}; dead zone ${JSON.stringify(gs)}` };
  if (bad.length) failWith({ ...out, bad }, `${bad.length} holds produced a gesture — ` + out.summary);
  return out;
});
// ── T4: a fast oblique inward swipe is nothing ────────────────────────────────────────────────
test('T4', 'fast inward swipe 140–150° off the outward radius, 24 runs: no gesture, sheet untouched', () => {
  const h = fresh(); snap(h); const rows = [];
  for (const [hz, dt] of CADENCES.slice(0, 3)) for (let dir = 0; dir < 8; dir++) {
    back(h);
    const off = (dir % 2 ? 140 : 150) * Math.PI / 180 * (dir % 4 < 2 ? 1 : -1);
    const r = stroke(h, { angle: dir * Math.PI / 4, speed: 10, dist: 1.5, hz: 1000 / dt, off, hold: 200, seed: dir + hz }, { frames: true, settle: true });
    rows.push({ hz, dir, kind: r.kind, state: r.atRelease.state, inverted: h.metrics().invertedQuads,
      restSame: h.run('cons.every((c,i)=>c.rest===__snap.rest[i])'), meshSame: h.run('px.every((v,i)=>Math.abs(v-__snap.px[i])<1e-3)&&py.every((v,i)=>Math.abs(v-__snap.py[i])<1e-3)') });
  }
  const bad = rows.filter(r => r.kind !== 'none' || r.inverted || !r.restSame);
  const out = { kinds: count(rows, 'kind'), meshMoved: rows.filter(r => !r.meshSame).length, summary: `24 swipes: ${JSON.stringify(count(rows, 'kind'))}, rest lengths changed ${rows.filter(r => !r.restSame).length}, inverted ${Math.max(...rows.map(r => r.inverted))}` };
  if (bad.length) failWith({ ...out, bad }, out.summary);
  return out;
});
// ── T5: no cliff at the threshold; force grows with speed ─────────────────────────────────────
test('T5', 'threshold continuity: growth of one stroke at 1.1·V_SLAP vs 0.9·V_SLAP ≤ 2×; force monotonic over 5–20 gs/s', () => {
  const h = fresh(); snap(h); const area0 = h.metrics().area, rows = [];
  for (const k of [0.6, 0.8, 0.9, 0.98, 1.02, 1.1, 1.2]) {
    back(h);
    const r = stroke(h, { angle: 0, speed: k * V_SLAP, dist: 1.5, hz: 60, phase: 0.5 }, { frames: true, settle: true });
    h.tick(30);
    rows.push({ speed: r3(k * V_SLAP), kind: r.kind, growth: r3(h.metrics().area / area0 - 1), impulse: r3(h.run('gestures.at(-1).impulse')) });
  }
  const g = v => rows.find(r => r.speed === r3(v * V_SLAP)).growth, ratio = g(1.1) / g(0.9), near = g(1.02) / g(0.98);
  const forces = [];
  for (const v of [1.02 * V_SLAP, 6, 7, 8, 10, 12, 14, 17, 20]) for (const hz of [60, 120]) {
    back(h);
    const r = stroke(h, { angle: Math.PI / 2, speed: v, dist: 1.5, hz, phase: 0.5 }, { settle: false });
    forces.push({ speed: r3(v), hz, kind: r.kind, impulse: r3(h.run('action.impulse')) });
  }
  const mono = [60, 120].every(hz => forces.filter(f => f.hz === hz).every((f, i, a) => i === 0 || f.impulse >= a[i - 1].impulse - 1e-6));
  const sameAcross = forces.filter(f => f.hz === 60).every((f, i) => Math.abs(f.impulse - forces.filter(x => x.hz === 120)[i].impulse) <= 0.05 * f.impulse);
  const out = { rows, forces, ratio: r3(ratio), acrossThreshold: r3(near),
    summary: `area growth 0.9·V ${g(0.9)} (pull) → 1.1·V ${g(1.1)} (slap), ratio ${r3(ratio)}; 0.98→1.02: ${r3(near)}; impulse ${forces.filter(f => f.hz === 60).map(f => f.impulse).join(' ')} (60 Hz), monotonic ${mono}, 60 vs 120 Hz within 5 % ${sameAcross}` };
  if (!(Math.max(ratio, 1 / ratio) <= 2.0) || !mono || !sameAcross || forces.some(f => f.kind !== 'slap')) failWith(out, out.summary);
  return out;
});
// ── T6: a flick that fits between two events ──────────────────────────────────────────────────
test('T6', 'fast flick 12 and 20 gs/s at 33 ms event step: slap 16/16 each', () => {
  const h = fresh(); snap(h); const rows = [];
  for (const v of [12, 20]) for (let dir = 0; dir < 8; dir++) for (const phase of [0.3, 0.8]) {
    back(h);
    // 0.7 gs flick: at 20 gs/s it lasts 35 ms — one move event at most, the rest travels in touchend
    const r = stroke(h, { angle: dir * Math.PI / 4, speed: v, dist: 0.7, hz: 30, phase }, { settle: false });
    rows.push({ v, dir, phase, kind: r.kind, events: r.events, impulse: r3(h.run('action.impulse')) });
  }
  const out = { byKind: { 12: count(rows.filter(r => r.v === 12), 'kind'), 20: count(rows.filter(r => r.v === 20), 'kind') }, events: count(rows, 'events'),
    summary: `12 gs/s: ${JSON.stringify(count(rows.filter(r => r.v === 12), 'kind'))}; 20 gs/s: ${JSON.stringify(count(rows.filter(r => r.v === 20), 'kind'))}; points per gesture incl. down and up ${JSON.stringify(count(rows, 'events'))}` };
  if (rows.some(r => r.kind !== 'slap')) failWith({ ...out, rows }, out.summary);
  return out;
});
// ── T6b: dropped frames do not cut a swipe into pulls ─────────────────────────────────────────
// Own Chrome 17.11: events came every 33–50 ms, and the fixed 40 ms pause cut one fast swipe into
// many short «strokes», each committed as a pull with speed 0. On a phone that is one or two dropped
// frames. A gap is a pause only when the finger barely moved across it.
test('T6b', 'swipe with 50 and 60 ms event gaps (dropped frames): fast is a slap, slow is a pull', () => {
  const h = fresh(); snap(h); const rows = [];
  for (const [v, want] of [[8, 'slap'], [12, 'slap'], [2, 'pull']]) for (const hz of [20, 16.7]) for (let dir = 0; dir < 8; dir += 2) for (const phase of [0.3, 0.8]) {
    back(h);
    const r = stroke(h, { angle: dir * Math.PI / 4, speed: v, dist: 1.5, hz, phase }, { settle: false });
    rows.push({ v, hz, dir, phase, want, kind: r.kind });
  }
  const wrong = rows.filter(r => r.kind !== r.want);
  const out = { byCase: Object.fromEntries([8, 12, 2].map(v => [v, count(rows.filter(r => r.v === v), 'kind')])), wrong: wrong.length,
    summary: `${rows.length} strokes at 20 and 16.7 Hz: 8 gs/s ${JSON.stringify(count(rows.filter(r => r.v === 8), 'kind'))}, 12 gs/s ${JSON.stringify(count(rows.filter(r => r.v === 12), 'kind'))}, 2 gs/s ${JSON.stringify(count(rows.filter(r => r.v === 2), 'kind'))}; wrong ${wrong.length}` };
  if (wrong.length) failWith({ ...out, rows }, out.summary);
  return out;
});
// ── T7: the comma gate does not depend on how many events fit a window ────────────────────────
// Path A of gesture-comma.svg («через верх», запятая 98° → тава) as described in issue #91:
// 1448×786, step 3, sheet at the target, 130 ms hold, an arc whose heading turns by 98° towards
// the tava. The original polyline lived in a session scratchpad and is lost; this is a
// reconstruction from the plate, so it reproduces the SETUP of the bistability (5 of 8), not the
// very same points.
function pathA(h, { dt, phase, turn = 98, v = 14, L = 2.6 }) {
  const st = JSON.parse(h.run(`(()=>{const c=centerOfSheet();return JSON.stringify({c,r:sheetRadius(),gs:gestureScale,panC})})()`));
  const tx = st.panC.x - st.c.x, ty = st.panC.y - st.c.y, tl = Math.hypot(tx, ty), ux = tx / tl, uy = ty / tl, sx = uy, sy = -ux;   // sideways «через верх»
  const a0 = Math.atan2(sy, sx), aT = Math.atan2(uy, ux); let dA = aT - a0; while (dA > Math.PI) dA -= 2 * Math.PI; while (dA < -Math.PI) dA += 2 * Math.PI;
  const sgn = Math.sign(dA) || 1;
  const pos = s => { let x = st.c.x + sx * st.r * 0.98, y = st.c.y + sy * st.r * 0.98; const n = 200;
    for (let i = 0; i < n; i++) { const a = a0 + sgn * turn * Math.PI / 180 * ((i + 0.5) / n * s / L); x += Math.cos(a) * s / n * st.gs; y += Math.sin(a) * s / n * st.gs; } return h.toClient(x, y); };
  const T = L / v * 1000, pts = [{ ...pos(0), t: 0 }];
  for (let t = phase * dt; t < T; t += dt) pts.push({ ...pos(L * t / T), t: 130 + t });
  pts.push({ ...pos(L), t: 130 + T, up: true });
  return pts;
}
test('T7', 'path A of issue #91 (reconstructed): 8 runs in a row at 8/17/33 ms steps and with glued events — one outcome', () => {
  const rows = [], rnd = lcg(91);
  for (const [name, dt, glue] of [['8 ms', 8.33, 1], ['17 ms', 16.67, 1], ['33 ms', 33.3, 1], ['8 ms ×2 per frame', 8.33, 2], ['8 ms ×3 per frame', 8.33, 3], ['17 ms ×2 per frame', 16.67, 2]]) {
    for (let i = 0; i < 8; i++) {
      const h = boot(TUNE, 1448, 786); h.run('stepNo=3;reset();'); h.tick(2);
      const before = h.run('gestures.length');
      const r = drive(h, pathA(h, { dt, phase: 0.05 + 0.9 * (rnd() + 0.5) }), { frames: true, glue, frameMs: 1000 / 60 + (i % 3 - 1) * 0.4, settle: true });
      const decision = h.run('lastDecision').replace(/-?\d+°/, 'N°').replace(/ · лист.*/, '');
      const sweep = (h.run('lastDecision').match(/(-?\d+)°/) || [])[1];
      rows.push({ name, i, kind: h.run('gestures.length') > before ? h.run('gestures.at(-1).kind') : 'none', phase: h.run('phase'), decision, sweep: sweep === undefined ? null : +sweep });
    }
  }
  const outcomes = count(rows.map(r => ({ o: `${r.kind} / ${r.phase} / ${r.decision}` })), 'o'), sw = rows.map(r => r.sweep).filter(x => x !== null);
  const out = { outcomes, sweepRange: sw.length ? [Math.min(...sw), Math.max(...sw)] : null, byCadence: Object.fromEntries([...new Set(rows.map(r => r.name))].map(n => [n, count(rows.filter(r => r.name === n), 'kind')])),
    summary: `${rows.length} runs: ${JSON.stringify(outcomes)}; measured turn ${sw.length ? Math.min(...sw) + '…' + Math.max(...sw) + '°' : '—'}` };
  if (Object.keys(outcomes).length !== 1) failWith({ ...out, rows }, out.summary);
  return out;
});
// ── T8: tempo ─────────────────────────────────────────────────────────────────────────────────
const D = Math.PI / 4;
// A moderate slap is 2.3 (9.2 gs/s), as in model-regression.cjs; 3.5 is the force ceiling (14 gs/s and faster).
const midSlap = (h, i) => slap(h, i, 2.3), strongSlap = (h, i) => slap(h, i, 3.5);
const inverted = h => h.metrics().invertedQuads;
function untilReady(h, gesture, max) { let n = 0; while (n < max && h.run('stepNo') === 2 && h.run('phase') === 'TABLE') { gesture(n); n++; } return n; }
test('T8a', 'tempo, slaps only: ready in 12–14 moderate slaps, the first sector reaches the dashes on the 8th–10th, corners stay rounded', () => {
  // Build 81 (spec §2): a weaker slap is the vendor's rhythm — the dashes in 8–10 slaps,
  // ready by slaps alone later (12–14), the corners are the pulls' work and stay rounded.
  const a = fresh(); let dashAt = null;
  const slaps = untilReady(a, i => { midSlap(a, i);
    if (dashAt === null) { const mx = a.run(`(()=>{rimProfile();let m=0;for(let b=0;b<RIM_BINS;b++){const th=(b+0.5)/RIM_BINS*2*Math.PI-Math.PI;if(rimProf[b]/targetAt(th)>m)m=rimProf[b]/targetAt(th)}return m})()`);
      if (mx >= 0.995) dashAt = i + 1; } }, 18);
  const sa = shape(a);
  const a2 = fresh(), strong = untilReady(a2, i => strongSlap(a2, i), 18);
  const out = { slapsToReady: slaps, firstSectorAtDashes: dashAt, strongSlapsToReady: strong, shape: sa,
    summary: `first sector at the dashes after slap ${dashAt}, ready after ${slaps} moderate slaps (2.3) or ${strong} at the ceiling (3.5); fill ${r3(sa.fill)}, corner/side ${r3(sa.squareness)}, corners ticked ${sa.corners}, inverted ${sa.inverted}` };
  if (!(dashAt >= 8 && dashAt <= 10 && slaps >= 12 && slaps <= 14 && sa.step === 3)) failWith(out, out.summary);
  if (!(sa.corners === 0 && sa.squareness <= 1.18)) failWith(out, 'slaps alone must leave rounded corners: ' + out.summary);
  return out;
});
test('T8b', 'tempo, pulls only walking around 8 directions: ready in 8–12 pulls', () => {
  const b = fresh(), sizes = []; const pulls = untilReady(b, i => sizes.push(pull(b, i * D + (i >= 8 ? D / 2 : 0), 2.4, 1.5).decision.replace('тяга ', '')), 40), sb = shape(b);
  const out = { pullsToReady: pulls, committedGs: sizes, shape: sb,
    summary: `${pulls} pulls${sb.step === 3 ? '' : ' — NOT ready'} (committed ${sizes.join(' ')} gs); fill ${r3(sb.fill)}, squareness ${r3(sb.squareness)}, inverted ${sb.inverted}, holes ${sb.holes}` };
  if (!(pulls >= 8 && pulls <= 12 && sb.step === 3)) failWith(out, out.summary);
  return out;
});
test('T8c', 'tempo, mix: 8 moderate slaps + 12 corner pulls reach step 3 (the pulls finish the corners)', () => {
  const c = fresh(); for (let i = 0; i < 8; i++) midSlap(c, i);
  let n = 0, at = null; for (let i = 0; i < 12 && c.run('phase') === 'TABLE'; i++, n++) { pull(c, D + i * 2 * D, 2.4, 1.5); if (at === null && c.run('stepNo') === 3) at = i + 1; }
  const sc = shape(c), out = { readyAfterPulls: at, shape: sc, summary: `step ${sc.step} after 8 slaps + ${at === null ? '—' : at} corner pulls; fill ${r3(sc.fill)}, squareness ${r3(sc.squareness)}, corners ticked ${sc.corners}` };
  if (!(sc.step === 3 && sc.corners === 4)) failWith(out, out.summary);
  return out;
});
// ── T9: the square ────────────────────────────────────────────────────────────────────────────
// Inverted quads: a steady swipe leaves a few folded rim cells on main as well (build 66, the
// former "steady 60 Hz swipe" check: 0, 4, 8, 13, 13 after five swipes). So the spec's "inverted 0"
// is asserted for what the PULLS add; what the four slaps left is reported next to it.
function squareRun(w, hh) {
  const h = fresh(w, hh); for (let i = 0; i < 8; i++) midSlap(h, i);
  const afterSlaps = inverted(h); let fromPulls = 0, real = 0;
  for (let i = 0; i < 12 && h.run('phase') === 'TABLE'; i++) { const b = inverted(h), r = pull(h, D + i * 2 * D, 2.4, 1.5); fromPulls += Math.max(0, inverted(h) - b); if (r.kind === 'pull') real++; }
  h.tick(60); return { ...shape(h), invertedAfterSlaps: afterSlaps, invertedFromPulls: fromPulls, pullsCommitted: real };
}
test('T9', 'square: 8 slaps + 12 corner pulls, portrait and landscape', () => {
  // Median thickness is compared at EQUAL AREA (review 17.11, P8): a square that fills the target is
  // larger than the disc that fills it, hence thinner; thickness × area is what must agree.
  // Build 81: 8 moderate slaps bring the sides to the dashes, the pulls square the corners.
  const ref = fresh(); untilReady(ref, i => midSlap(ref, i), 18); const rs = shape(ref), band = rs.medianThickness, refArea = rs.areaOverDisc;
  const rows = { portrait: squareRun(390, 844), landscape: squareRun(844, 390) }, bad = [];
  for (const [name, s] of Object.entries(rows)) {
    if (!(s.fill >= 0.92)) bad.push(`${name}: fill ${r3(s.fill)}`);
    // the target itself (superellipse n=5) has corner/side 1.11/0.90 = 1.23; the spec's 1.30–1.50
    // rewarded corners sharper than the target, i.e. a pillow with concave sides (review 17.11, P5)
    if (!(s.squareness >= 1.15 && s.squareness <= 1.30)) bad.push(`${name}: corner/side ${r3(s.squareness)}`);
    if (!(s.binMin >= 0.85 && s.binMax <= 1.14)) bad.push(`${name}: rim/target over 48 sectors ${r3(s.binMin)}…${r3(s.binMax)}`);
    if (!(Math.min(...s.side) / 0.9 >= 0.92)) bad.push(`${name}: shortest side mid-point ${r3(Math.min(...s.side) / 0.9)} of the target`);
    if (s.invertedFromPulls) bad.push(`${name}: inverted from pulls ${s.invertedFromPulls}`);
    if (!(Math.abs(s.medianThickness * s.areaOverDisc / (band * refArea) - 1) <= 0.10)) bad.push(`${name}: median thickness ${r3(s.medianThickness)} × area ratio ${r3(s.areaOverDisc / refArea)} vs ready-by-slaps ${r3(band)}`);
    if (!s.finite) bad.push(`${name}: not finite`);
  }
  const f = s => `fill ${r3(s.fill)}, corner/side ${r3(s.squareness)}, inverted: ${s.invertedAfterSlaps} after the slaps, +${s.invertedFromPulls} from pulls, holes ${s.holes}, sectors ${r3(s.binMin)}…${r3(s.binMax)}, median thickness ${r3(s.medianThickness)} (× area ${r3(s.medianThickness * s.areaOverDisc / refArea)}), pulls committed ${s.pullsCommitted}/12, corners ticked ${s.corners}`;
  const out = { readyBySlapsMedianThickness: band, ...rows, summary: `portrait: ${f(rows.portrait)}; landscape: ${f(rows.landscape)}; ready-by-slaps median thickness ${r3(band)}` + (bad.length ? ` — ${bad.join('; ')}` : '') };
  if (bad.length) failWith(out, out.summary);
  return out;
});
// Build 75 (slaps stop at the dashes) — two bounds of the spec row are restated, both reported:
// · area: the spec floor 0.95 of π·targetR² is 0.97 of the target's own area (0.980 for the
//   superellipse) and cannot be met by a sheet that is ready by the stand's own rule (fill 0.92:
//   82 % of the sectors ≥ 0.92 of the target, none below 0.85 → area from ~0.81). Builds 67–74
//   only came near it because the slaps threw the sides to 1.2–1.3 of the target. The floor is
//   AREA_MIN = 0.88 (measured over 200 sequences: 0.89–0.991; 0.85 until the review of build 75 —
//   too loose to guard anything); rows below the spec's 0.95 are counted in the summary ("below the spec floor").
// · inverted cells from pulls are counted over INTACT cells only: a torn cell keeps a frozen shard
//   node (breakCon pins it), the sheet moves around it and the cell's signed area flips — that is
//   the hole, reported in `holes`, not a fold made by the pull (seed 7007: all 3 such cells torn).
const AREA_MIN = 0.88, AREA_SPEC_MIN = 0.95;
const invertedIntact = h => h.run(`quads.reduce((n,[a,b,c,d],i)=>n+((px[a]*(py[b]-py[d])+px[b]*(py[c]-py[a])+px[c]*(py[d]-py[b])+px[d]*(py[a]-py[c]))<0&&!quadCons[i].some(c=>c.broken)?1:0),0)`);
test('T9b', `convergence: ${FULL ? 200 : 12} seeded random sequences of pulls and slaps until ready`, () => {
  const n = FULL ? 200 : 12, rows = [];
  for (let s = 0; s < n; s++) {
    const h = fresh(), rnd = lcg(7000 + s), u = () => rnd() + 0.5; let g = 0, invPull = 0, slaps = 0, pulls = 0;
    while (g < 60 && h.run('stepNo') === 2 && h.run('phase') === 'TABLE') {
      const before = invertedIntact(h);
      if (u() < 0.4) { slap(h, Math.floor(u() * 4) + (u() < 0.5 ? 0.5 : 0), 1.5 + 2 * u()); slaps++; }
      else { pull(h, u() * 2 * Math.PI, 0.6 + 1.8 * u(), 0.8 + 2.5 * u()); pulls++; invPull = Math.max(invPull, invertedIntact(h) - before); }
      g++;
    }
    h.tick(60); const sh = shape(h);
    rows.push({ seed: 7000 + s, gestures: g, slaps, pulls, step: sh.step, binMin: r3(sh.binMin), binMax: r3(sh.binMax), area: r3(sh.areaOverDisc), invertedFromPulls: invPull, inverted: sh.inverted, holes: sh.holes, finite: sh.finite });
  }
  const bad = rows.filter(r => r.step !== 3 || r.binMin < 0.85 || r.binMax > 1.14 || r.invertedFromPulls > 0 || r.area < AREA_MIN || r.area > 1.10 || !r.finite);
  const mm = k => `${Math.min(...rows.map(r => r[k]))}…${Math.max(...rows.map(r => r[k]))}`;
  const out = { sequences: n, rows, summary: `${n} sequences: ready ${rows.filter(r => r.step === 3).length}/${n}, gestures ${mm('gestures')}, rim/target over 48 bins min ${mm('binMin')} max ${mm('binMax')}, area/π·targetR² ${mm('area')}, inverted from pulls (intact cells) ${mm('invertedFromPulls')}, holes ${mm('holes')}; outside the bounds ${bad.length}; below the spec area floor ${AREA_SPEC_MIN}: ${rows.filter(r => r.area < AREA_SPEC_MIN).length}` };
  if (bad.length) failWith({ ...out, bad }, out.summary);
  return out;
});
// The finished side is BUILT (slaps + pulls until the stand refuses that side), then ten pulls on
// it must do nothing. Ready by slaps alone takes 12–14 (build 81), so the side is finished with a
// few pulls; slaps at the force ceiling are reported only (the sheet is shredded by then, and what
// still grows past the cap is creep()/evenOut(), whose cut-off the spec told not to touch §7).
test('T9c', 'cap: slaps + pulls finish a side, then 10 more pulls on it', () => {
  const h = fresh(); for (let i = 0; i < 8 && h.run('phase') === 'TABLE'; i++) midSlap(h, i);
  let finishers = 0; for (let i = 0; i < 12; i++) { const r = pull(h, 0, 1.2, 1.5); if (r.kind === 'none') break; finishers++; }
  h.tick(60); const s0 = shape(h), rest0 = restSum(h), rows = [];
  for (let i = 0; i < 10; i++) { const r = pull(h, 0, 1.2, 1.5); rows.push({ kind: r.kind, decision: r.decision, restSum: restSum(h) }); }
  h.tick(60); const s1 = shape(h);
  const x = fresh(); for (let i = 0; i < 10 && x.run('phase') === 'TABLE'; i++) strongSlap(x, i);
  x.tick(60); const sx = shape(x);
  const out = { finisherPulls: finishers, afterSlaps: s0, afterPulls: s1, pulls: rows.map(r => r.kind + ' · ' + r.decision), restDrift: restSum(h) / rest0 - 1, tenCeilingSlaps: sx,
    summary: `after 8 slaps + ${finishers} finisher pulls: side max ${r3(s0.sideMax)}, corner max ${r3(s0.cornerMax)} targetR, holes ${s0.holes}; 10 pulls on the side: ${JSON.stringify(count(rows, 'kind'))}, rest length sum changed by ${(restSum(h) / rest0 - 1).toExponential(2)}; then side max ${r3(s1.sideMax)}, corner max ${r3(s1.cornerMax)}. Not asserted — 10 slaps at the force ceiling: side max ${r3(sx.sideMax)}, corner max ${r3(sx.cornerMax)}, holes ${sx.holes}` };
  if (!(s1.sideMax <= 1.15 && s1.cornerMax <= 1.25 && s0.sideMax <= 1.15 && s0.cornerMax <= 1.25) || !s1.finite) failWith(out, out.summary);
  // the pulls beyond the cap must be "short": no log entry, rest lengths unchanged
  // (between the pulls the solver's own evenOut()/creep() still run, so the sum is compared to 1e-3, not bit-for-bit;
  //  bit-for-bit restore of a rolled-back pull is T9d)
  if (rows.some(r => r.kind !== 'none') || Math.abs(restSum(h) / rest0 - 1) > 1e-3) failWith(out, 'pulls on a finished side keep growing it — ' + out.summary);
  return out;
});
// Build 75. Slaps alone bring the sheet to the dashes and stop there; a side that pulls have brought
// close to the dashes first (the stand lets one side of a fresh sheet go to ~0.95) is not thrown past
// them by slaps on the other sides (build 74: 1.22 in both cases). 1.05 = the pull's own
// allowance past the dashes (PULL_OVER 1.03) plus 2 %. Slaps round the corners (the slap cap on the
// diagonals is 0.92 of the target), so corner/side stays below the target's 1.233.
// Review of build 75 (P2-1): at the force ceiling the rim goes further past the dashes than at 2.3
// (the spread of the nodes set by yield, not the rest-length growth) — its own pass and bound, 1.07.
// Review P2-2: slaps alone must not play the "ready" chord — the corners are the pulls' work.
test('T9i', 'slaps stop at the dashes: 14 moderate slaps; 14 slaps at the force ceiling; a pulled side under 6 slaps elsewhere', () => {
  const sideRatio = (h, a) => h.run(`(()=>{rimProfile();let m=0;for(let b=0;b<RIM_BINS;b++){const th=(b+0.5)/RIM_BINS*2*Math.PI-Math.PI;let d=Math.abs(th-(${a}));if(d>Math.PI)d=2*Math.PI-d;if(d<Math.PI/6)m=Math.max(m,rimProf[b]/targetAt(th));}return m})()`);
  const a = fresh(), rows = [];
  for (let i = 0; i < 14 && a.run('phase') === 'TABLE'; i++) { midSlap(a, i); const s = shape(a); rows.push({ slap: i + 1, step: s.step, binMax: r3(s.binMax), binMin: r3(s.binMin), squareness: r3(s.squareness), area: r3(s.areaOverDisc) }); }
  a.tick(60); const sa = shape(a), worst = Math.max(...rows.map(r => r.binMax));
  const c = fresh(); let worstC = 0, chordC = false;
  for (let i = 0; i < 14 && c.run('phase') === 'TABLE'; i++) { strongSlap(c, i); const s = shape(c); worstC = Math.max(worstC, s.binMax); chordC = chordC || s.chord; }
  c.tick(60); const sc = shape(c);
  // one side pulled first (pulls until the stand refuses), then slaps at the other three sides
  const b = fresh(); let pulls = 0; for (let i = 0; i < 12; i++) { if (pull(b, 0, 2.4, 1.5).kind !== 'pull') break; pulls++; }
  b.tick(60); const before = sideRatio(b, 0), track = [];
  for (let i = 0; i < 6 && b.run('phase') === 'TABLE'; i++) { midSlap(b, 1 + (i % 3)); track.push(r3(sideRatio(b, 0))); }
  b.tick(60); const after = sideRatio(b, 0), sb = shape(b);
  const out = { slapsOnly: rows, slapsOnlyEnd: sa, ceilingSlaps: { worst: worstC, chord: chordC, end: sc }, pulledSide: { pulls, before, afterEachSlap: track, after, end: sb },
    summary: `14 moderate slaps: rim/target max over the run ${r3(worst)}, at the end ${r3(sa.binMin)}…${r3(sa.binMax)}, corner/side ${r3(sa.squareness)}, area ${r3(sa.areaOverDisc)}, inverted ${sa.inverted}, holes ${sa.holes}, corners ticked ${sa.corners}, chord ${sa.chord}; 14 slaps at the force ceiling: rim/target max over the run ${r3(worstC)}, at the end ${r3(sc.binMin)}…${r3(sc.binMax)}, corners ticked ${sc.corners}, chord ${chordC || sc.chord}, holes ${sc.holes}; side pulled first (${pulls} pulls) ${r3(before)} → after 6 slaps at the other sides ${r3(after)} (max on the way ${Math.max(...track)}), sheet max ${r3(sb.binMax)}` };
  if (!(worst <= 1.05 && sa.binMin >= 0.85 && sa.squareness <= 1.18 && sa.inverted === 0 && sa.finite)) failWith(out, out.summary);
  if (!(worstC <= 1.07 && sc.finite) || sa.chord || chordC || sc.chord) failWith(out, out.summary);
  if (!(Math.max(after, ...track) <= 1.05 && sb.binMax <= 1.05 && sb.finite)) failWith(out, out.summary);
  return out;
});
// ── T9j: build 81 — the slap rhythm and the tear rule ────────────────────────────────────────
// Spec §2: 8 moderate slaps make no holes (a novice does not tear the sheet); the tear is a
// ceiling slap that lands on an already thin place — one SMALL hole AT THE RIM; pulls never tear.
const holesOf = h => +h.run('quadCons.filter(cs=>cs.some(c=>c.broken)).length');
test('T9j', 'slaps: 8 moderate slaps leave no holes; a ceiling slap tears once, small, at the rim of the impact side; a moderate slap and pulls on the same thin sheet tear nothing', () => {
  const a = fresh(); let worst = 0;
  for (let i = 0; i < 8; i++) { midSlap(a, i); worst = Math.max(worst, holesOf(a)); }
  const sa = shape(a);
  const bad = [];
  if (worst !== 0) bad.push(`8 moderate slaps made ${worst} torn cells`);
  // ceiling slaps until the sheet tears: one punch, small, near the rim of the slapped side
  const b = fresh(); let n = 0;
  for (; n < 10 && !holesOf(b); n++) strongSlap(b, n);
  const tb = JSON.parse(b.run(`(()=>{const torn=quadCons.map((cs,q)=>cs.some(c=>c.broken)?q:-1).filter(q=>q>=0);
    const c=centerOfSheet();let x=0,y=0;for(const q of torn){for(const i of quads[q]){x+=px[i];y+=py[i];}}
    x/=torn.length*4;y/=torn.length*4;const r=Math.hypot(x-c.x,y-c.y),th=Math.atan2(y-c.y,x-c.x);
    rimProfile();const rim=rimProf[rimBin(th)];
    return JSON.stringify({slaps:${n},torn:torn.length,atRim:+(r/rim).toFixed(2)})})()`));
  if (!(tb.torn > 0 && tb.torn <= 8)) bad.push(`the tear left ${tb.torn} torn cells (expected a small hole)`);
  if (!(tb.atRim >= 0.65)) bad.push(`the hole sits at ${tb.atRim} of the rim (expected near the edge)`);
  // the same thin sheet: one more moderate slap and four long pulls add no holes
  const before = holesOf(b);
  midSlap(b, 10);
  const afterMod = holesOf(b);
  for (let k = 0; k < 4; k++) pull(b, k * Math.PI / 2 + 0.4, 1.5, 1.2);
  const afterPull = holesOf(b);
  if (!(afterMod === before && afterPull === before)) bad.push(`on the thin sheet: moderate slap ${before}→${afterMod}, pulls →${afterPull} torn cells`);
  const out = { eightModerate: { worst, fill: r3(sa.fill), step: sa.step }, tear: tb, after: { before, afterMod, afterPull },
    summary: `8 moderate slaps: worst ${worst} torn cells, fill ${r3(sa.fill)}; ceiling slaps: first tear at slap ${tb.slaps}, ${tb.torn} cells at ${tb.atRim} of the rim; on the thin sheet a moderate slap and 4 pulls added ${afterPull - before} holes` };
  if (bad.length) failWith({ ...out, bad }, bad.join('; '));
  return out;
});
test('T9d', 'short pull and touch cancel restore the mesh and the rest lengths bit-for-bit', () => {
  const h = fresh(); snap(h); const same = () => h.run('px.every((v,i)=>v===__snap.px[i])&&py.every((v,i)=>v===__snap.py[i])&&cons.every((c,i)=>c.rest===__snap.rest[i])');
  const rows = [];
  for (const dist of [0.18, 0.22]) {   // beyond the dead zone, shorter than PULL_MIN
    const pts = strokePoints(h, { angle: 0.3, speed: 1.2, dist, hz: 60 }), mid = pts.slice(0, -1);
    const r = drive(h, pts, { frames: false, settle: false });
    rows.push({ what: `pull ${dist} gs`, state: r.atRelease.state, decision: r.atRelease.decision, moved: h.run('action.state'), same: same(), gestures: h.run('gestures.length-__snap.gl') });
    assert.ok(mid.length > 2);
  }
  { const pts = strokePoints(h, { angle: 2, speed: 1.5, dist: 0.5, hz: 60 });
    drive(h, pts, { frames: false, settle: false, release: false });
    const pulling = h.run('action.state'), displaced = h.run('px.some((v,i)=>v!==__snap.px[i])');
    h.touch('cancel', 't1', pts.at(-2).x, pts.at(-2).y);
    rows.push({ what: 'touchcancel during a 0.5 gs pull', state: pulling, displaced, moved: h.run('action.state'), same: same(), gestures: h.run('gestures.length-__snap.gl') }); }
  // Losing focus in the middle of a pull is the same cancel (review 17.11, P3: the stand hung in
  // PULLING until «заново» — physics stands still there and a new touch is refused).
  { const pts = strokePoints(h, { angle: 4, speed: 1.5, dist: 0.5, hz: 60 });
    drive(h, pts, { frames: false, settle: false, release: false });
    const pulling = h.run('action.state'), displaced = h.run('px.some((v,i)=>v!==__snap.px[i])');
    h.fire('blur', { target: h.context }); h.tick(120);
    const after = h.run('action.state'), ok = same(), g = h.run('gestures.length-__snap.gl');
    const next = stroke(h, { angle: 1, speed: 1.5, dist: 0.5, hz: 60 }, { settle: true, id: 't2' });
    rows.push({ what: 'blur during a 0.5 gs pull', state: pulling, displaced, moved: after, same: ok, gestures: g, next: next.kind }); }
  const out = { rows, summary: rows.map(r => `${r.what}: ${r.state} → ${r.moved}, bit-for-bit ${r.same}` + (r.next ? `, next gesture ${r.next}` : '')).join('; ') };
  if (rows.some(r => !r.same || r.gestures !== 0 || r.moved !== 'RESTING') || rows.slice(2).some(r => r.state !== 'PULLING' || !r.displaced) || rows[3].next !== 'pull') failWith(out, out.summary);
  return out;
});
test('T9e', 'thick rim: after pulls only the outer 10 % of the radius is thicker than the sheet mean', () => {
  const h = fresh(); let n = 0; while (n < 40 && h.run('stepNo') === 2) { pull(h, n * D + (n >= 8 ? D / 2 : 0), 2.4, 1.5); n++; }
  h.tick(60);
  const t = JSON.parse(h.run(`(()=>{const c=centerOfSheet();rimProfile(c);let so=0,no=0,s=0,n=0;for(let i=0;i<N;i++){if(conDeg[i]<=0)continue;const dx=px[i]-c.x,dy=py[i]-c.y,r=Math.hypot(dx,dy),rim=rimProf[rimBin(Math.atan2(dy,dx))];s+=thick[i];n++;if(r>=0.9*rim){so+=thick[i];no++;}}return JSON.stringify({outer:so/no,mean:s/n,outerNodes:no})})()`));
  const out = { pulls: n, ...t, summary: `${n} pulls: outer 10 % mean thickness ${r3(t.outer)} (${t.outerNodes} nodes) vs sheet mean ${r3(t.mean)}` };
  if (!(t.outer > t.mean)) failWith(out, out.summary);
  return out;
});

// ── T9g: pulls alone do not build a star or a cross, and the notes do not lie ─────────────────
// Review 17.11, P4: twelve corner pulls on a fresh sheet gave corner/side 2.18 at fill 0.61 with all
// four corner notes, the chord and the tava blink; twelve side pulls gave a cross (0.54).
test('T9g', 'pulls only at the corners / only at the sides: no star, no cross; corner notes need the sides, the chord needs a ready sheet', () => {
  const rows = [];
  for (const [name, a0] of [['corners', D], ['sides', 0]]) {
    const h = fresh(); let chordEarly = false, cornerEarly = false;
    for (let k = 0; k < 12 && h.run('phase') === 'TABLE'; k++) {
      stroke(h, { angle: a0 + (k % 4) * 2 * D, speed: 1.5, dist: 1.4, hz: 60 }, { settle: true });
      const s = shape(h);
      if (s.chord && s.fill < 0.92) chordEarly = true;
      if (s.corners && s.squareness > 1.40) cornerEarly = true;   // a note on a spike, not on a corner
    }
    h.tick(60); rows.push({ name, ...shape(h), chordEarly, cornerEarly });
  }
  const f = s => `${s.name}: corner/side ${r3(s.squareness)}, fill ${r3(s.fill)}, sectors ${r3(s.binMin)}…${r3(s.binMax)}, corners ticked ${s.corners}, chord ${s.chord}, inverted ${s.inverted}`;
  const out = { rows, summary: rows.map(f).join('; ') };
  if (rows.some(s => s.squareness > 1.35 || s.squareness < 0.85 || s.chordEarly || s.cornerEarly || s.inverted || (s.chord && s.fill < 0.92))) failWith(out, out.summary);
  return out;
});
// ── T9h: an oblique pull does not drag the neighbours past the dashes ─────────────────────────
// Review 17.11, P6: six pulls from a side mid-point after four slaps, the finger going 40° / 60°
// off the radius (screen angle): a sector at 1.21 of the target; 44 inverted cells and a false corner note.
test('T9h', 'oblique pulls from a side mid-point (0 / 20 / 40 / 60° off the radius): nothing past the dashes, no inverted cells, no false corner note', () => {
  const rows = [];
  for (const offDeg of [0, 20, 40, 60, -40]) {
    const h = fresh(); for (let i = 0; i < 4; i++) midSlap(h, i);
    const s0 = shape(h), inv0 = inverted(h), kinds = [];
    for (let i = 0; i < 6; i++) kinds.push(stroke(h, { angle: 0, speed: 1.5, dist: 1.2, off: offDeg * Math.PI / 180, hz: 60 }, { settle: true }).kind[0]);
    h.tick(60); const s1 = shape(h);
    rows.push({ offDeg, kinds: kinds.join(''), binMaxBefore: r3(s0.binMax), binMax: r3(s1.binMax), inverted: inverted(h) - inv0, corners: s1.corners });
  }
  const out = { rows, summary: rows.map(r => `${r.offDeg}°: ${r.kinds}, sectors max ${r.binMaxBefore} → ${r.binMax}, inverted +${r.inverted}, corners ${r.corners}`).join('; ') };
  if (rows.some(r => r.binMax > 1.08 || r.inverted > 0 || r.corners > 0) || !/p/.test(rows[0].kinds)) failWith(out, out.summary);
  return out;
});
// ── T9t: build 81 — thinness on the table shows as transparency ───────────────────────────────
// Spec §1: light warm dough (not khaki), the board shows through where the sheet is thinner,
// the near-tear zone fades to almost transparent, the rim is denser and lighter. The pan
// (mixOn + cook) is another branch's work and is not touched here.
test('T9t', 'table skin: alpha grows with thickness, near-tear almost transparent, rim denser and lighter; the sheet on the table draws rgba', () => {
  const h = fresh();
  const skin = (t, rim = 0) => h.run(`tableSkin(${t},${rim})`);
  const alpha = s => +s.match(/([\d.]+)\)$/)[1];
  const lum = s => { const m = s.match(/rgba\(([\d.]+),([\d.]+),([\d.]+),/); return +m[1] + +m[2] + +m[3]; };
  const ts = [0.004, 0.006, 0.01, 0.02, 0.05, 0.1, 0.15, 0.3, 1], as_ = ts.map(t => alpha(skin(t)));
  const bad = [];
  if (!as_.every((a, i) => i === 0 || a >= as_[i - 1] - 1e-9)) bad.push(`alpha not monotone: ${as_.join(' ')}`);
  if (!(as_[0] <= 0.08 && as_[1] <= 0.20)) bad.push(`near-tear not almost transparent: ${as_[0]}, ${as_[1]}`);
  if (!(as_[5] >= 0.6 && as_[7] >= 0.99)) bad.push(`stretched sheet not light enough: t=0.1 → ${as_[5]}, t=0.3 → ${as_[7]}`);
  if (!(alpha(skin(0.1, 1)) > alpha(skin(0.1)) && lum(skin(0.1, 1)) > lum(skin(0.1)))) bad.push('rim not denser and lighter');
  // drawn on the table: rgba fillStyles whose alpha follows the thickness (no opaque khaki path left)
  h.run('thick.fill(0.12);draw();');
  const fills1 = h.drawCalls.filter(c => c.fillStyle && String(c.fillStyle).startsWith('rgba')).map(c => alpha(c.fillStyle));
  h.drawCalls.length = 0;
  h.run('thick.fill(0.004);draw();');
  const fills2 = h.drawCalls.filter(c => c.fillStyle && String(c.fillStyle).startsWith('rgba')).map(c => alpha(c.fillStyle));
  const rgb_ = h.drawCalls.filter(c => c.fillStyle && String(c.fillStyle).startsWith('rgb(')).length;   // holes are #100a06 (hex), not rgb()
  if (fills1.length < 100 || fills2.length < 100) bad.push(`draw fills rgba ${fills1.length}/${fills2.length}`);
  if (Math.min(...fills1) < 0.55) bad.push(`t=0.12 drawn alpha min ${Math.min(...fills1)}`);
  if (Math.max(...fills2) > 0.15) bad.push(`near-tear t=0.004 drawn alpha max ${Math.max(...fills2)}`);
  const out = { alpha: as_.join(' '), rimAlpha: [alpha(skin(0.1)), alpha(skin(0.1, 1))].join(' '), drawn: { t012: [Math.min(...fills1), Math.max(...fills1)], t0004: [Math.min(...fills2), Math.max(...fills2)], rgbPaths: rgb_ },
    summary: `alpha ${as_.join(' ')}; rim ${alpha(skin(0.1))}→${alpha(skin(0.1, 1))}, lum ${lum(skin(0.1))}→${lum(skin(0.1, 1))}; drawn alpha t=0.12 ${Math.min(...fills1)}…${Math.max(...fills1)}, t=0.004 ${Math.min(...fills2)}…${Math.max(...fills2)}` };
  if (bad.length) failWith({ ...out, bad }, bad.join('; '));
  return out;
});

const reportDir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, 'square-stretch-results.json');
fs.writeFileSync(reportPath, JSON.stringify({ stand: H.sourcePath, sha256: H.sourceSha256, V_SLAP, full: FULL, only: only ? [...only] : null, results }, null, 2));
const failed = results.filter(r => r.status === 'FAIL');
console.log(`${results.length - failed.length}/${results.length} passed` + (failed.length ? ` — failed: ${failed.map(r => r.id).join(', ')}` : '') + ` · report ${reportPath}`);
process.exitCode = failed.length ? 1 : 0;
