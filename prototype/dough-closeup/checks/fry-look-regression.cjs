#!/usr/bin/env node
'use strict';
// Batch «жарка пятнами», build 86 (docs/fry-spots-batch-spec.md): how the crust LOOKS, as numbers.
// The look is computed by the stand's own colour functions (crustFace / crustMix / dishCrustColor, the table
// renderer renderDishTable and the margarine gloss drawMargarineGloss on a recording 2D context) — there is no
// real canvas in Node. What this file holds:
//   L1 a raw side: not one spot, no gloss; pale and matte (the ground is the dough colour);
//   L2 the steps: «бледное» — few golden flecks, «приготовленное» — spots, «зажаренное» — darker spots on a
//      larger share of the area; spot colours of each step in their own range; edges and the envelope seam darker;
//   L3 the pattern stays: same roti — the same spots frame to frame, after a turn and after a flip; another
//      roti — another pattern;
//   L4 the margarine gloss: on the near edge where fat is under it, none while the steel side is raw, dims as it fries;
//   L5 the table: per-pixel round spots on the top of the cut roti, soft edges (no hard step between pixels).
//   node prototype/dough-closeup/checks/fry-look-regression.cjs path/to/stand.js [--only L1,L3]
// Report: runs/checks/fry-look-results.json of the checkout (runs/ is not in git).
// The helpers below are the ones of frying-regression.cjs (kept in step by hand).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const H = require('./model-regression.cjs');
const { boot, lcg } = H;
const sideScripts = ['banana.js', 'egg.js', 'evening.js', 'guest.js'].map(f => ({ file: path.join(path.dirname(H.sourcePath), f), src: fs.readFileSync(path.join(path.dirname(H.sourcePath), f), 'utf8') }));
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
const FRAME = 'step(1/60); bananaUpdate(1/60); eggUpdate(1/60); eveningUpdate(1/60);';
const W = 390, HH = 844;
function evening({ storage = [], w = W, hh = HH } = {}) {
  const h = boot(TUNE, w, hh, { storage });
  h.context.location.search = '';
  h.context.document.readyState = 'complete';
  for (const s of sideScripts) vm.runInContext(s.src, h.context, { filename: s.file, timeout: 10000 });
  h.J = code => JSON.parse(h.run(`JSON.stringify(${code})`));
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
const light = h => tap(h, h.spots().lamp);
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
function toTable(h) {
  const c = h.J('(()=>{const b=dishBounds();return __harness.dishToClient({x:(b.left+b.right)/2,y:(b.top+b.bottom)/2})})()'), w = h.spots().work;
  drive(h, line(c, w, { v: 320, hold: 60 }), { settle: 60 });
  assert.equal(h.run('dish.mode'), 'cut', 'the envelope carried by the middle lies on the table');
}
const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
function roti(opts) { const h = evening(opts); light(h); stretched(h); toPan(h); tap(h, h.spots().pan); envelope(h); return h; }
// script: both sides of every cell at cook c (dry), frying frozen so the numbers hold
const cookAll = (h, c) => h.run(`for(const t of dish.thermal) if(t){t.dry[0]=t.dry[1]=1;t.cook[0]=t.cook[1]=${c};} dish.panTime=(dish.panTime||0)+0.001; fryHold=true;`);
const cookSides = (h, bottom, top) => h.run(`for(let i=0;i<dish.thermal.length;i++){const t=dish.thermal[i];if(!t)continue;t.dry[0]=t.dry[1]=1;
  const w=dish.contactWeights[i]; const down=w&&w[1]>w[0]?1:0; t.cook[down]=${bottom}; t.cook[1-down]=${top};} dish.panTime=(dish.panTime||0)+0.001; fryHold=true;`);
// Seen faces of the envelope on the tava: colour drawn (dishCrustColor) against the ground of the same face.
const FACES = `(()=>{const out=[];for(const f of dish.faces){ if(f.kind!=="dough"||!dish.topWeights[f.source][f.turned?0:1]) continue;
  const P=crustFace(f), c=dishCrustColor(f); out.push({c:c.map(v=>Math.round(v*10)/10),g:P.ground.map(v=>Math.round(v*10)/10),edge:P.edge,cook:P.c,src:f.source,t:f.turned}); } return out;})()`;
// Material sampling of the field: share of the area under spots and the spot colours, for one cook value (no edge).
const FIELD = (c, edge = 0, side = 1) => `(()=>{const P={base:[227,213,178],c:${c},edge:${edge},seed:dish.seed,side:${side},ground:cookColor([227,213,178],crustGround(${c}))};
  let n=0,sp=0,L=[],R=[];const lum=v=>0.299*v[0]+0.587*v[1]+0.114*v[2], gl=lum(P.ground);
  for(let j=0;j<140;j++) for(let i=0;i<140;i++){ const x=-.95+i*1.9/139, y=-.95+j*1.9/139; if(x*x+y*y>.9) continue; n++;
    const k=crustMix(P,x,y); if(gl-lum(k)>6){ sp++; L.push(lum(k)); R.push(k.map(Math.round)); } }
  L.sort((a,b)=>a-b); const q=p=>L.length?L[Math.min(L.length-1,Math.floor(p*(L.length-1)))]:null;
  return {share:sp/n, ground:P.ground.map(Math.round), groundLum:gl, p10:q(.1), p50:q(.5), p90:q(.9),
    rgbMin:R.length?[0,1,2].map(k=>Math.min(...R.map(r=>r[k]))):null, rgbMax:R.length?[0,1,2].map(k=>Math.max(...R.map(r=>r[k]))):null};})()`;

test('L1', 'a raw side: not one spot and no gloss; the ground is pale (the dough colour) and matte', () => {
  const h = roti();
  cookAll(h, 0.05); h.frames(2);
  const F = h.J(FACES);
  const spotted = F.filter(f => f.c.some((v, k) => Math.abs(v - f.g[k]) > 0.05)).length;
  assert.ok(F.length > 50, `seen faces ${F.length}`);
  assert.equal(spotted, 0, `raw: no face differs from its ground (${spotted} of ${F.length})`);
  const bothSides = h.J(FIELD(0.079)), side0 = h.J(FIELD(0.079, 1, 0));
  assert.equal(bothSides.share, 0, 'just below «бледное»: the field has no spot anywhere');
  assert.equal(side0.share, 0, 'not even at the edge or on the other side');
  const pale = Math.min(...F.map(f => lum(f.g)));
  assert.ok(pale > 195, `pale: darkest raw face ${pale.toFixed(0)}`);
  // gloss: margarine under the near edge, steel side raw → nothing drawn
  const gl = glossRun(h, 0.05);
  assert.equal(gl.strokes, 0, 'no gloss on a raw roti');
  // the top raw, the steel side fried: inside the rim the top stays spotless (the rim is the steel side showing)
  h.run(`for(let i=0;i<dish.thermal.length;i++){const t=dish.thermal[i];if(!t)continue;const w=dish.topWeights[i];t.dry[0]=t.dry[1]=1;
    for(const s of [0,1]) t.cook[s]=w&&w[s]?0.03:0.6;} dish.panTime+=0.001; fryHold=true;`); h.frames(1);
  const G = h.J(FACES), L = h.J('dishLook()'), inner = G.filter(f => f.cook < 0.08);
  const spottedInner = inner.filter(f => f.c.some((v, k) => Math.abs(v - f.g[k]) > 0.05)).length, rimSpots = G.length - inner.length;
  assert.ok(inner.length > 50, `faces with a raw top inside the rim: ${inner.length}`);
  assert.equal(spottedInner, 0, 'raw top inside the rim: no spot');
  h.tick(1, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  return { summary: `steel side fried, top raw: ${inner.length} faces raw and spotless, ${rimSpots} rim faces take the steel side (rim width ${L.rimW.toFixed(2)}); ${F.length} seen faces, 0 spotted; darkest raw face luminance ${pale.toFixed(0)}; gloss strokes ${gl.strokes}` };
});

test('L2', 'the steps: spots appear at «бледное»/«приготовленное», at «зажаренное» they are darker and cover more; colours in their ranges; edges and seam darker', () => {
  const h = roti();
  const S = {};
  for (const [name, c] of [['бледное', 0.18], ['приготовленное', 0.42], ['зажаренное', 0.8], ['горелое', 1.2]]) {
    const step = h.run(`fryStep(${c})`);
    S[name] = { c, step, ...h.J(FIELD(c)) };
  }
  const P = S['бледное'], C = S['приготовленное'], Z = S['зажаренное'], B = S['горелое'];
  assert.deepEqual([P.step, C.step, Z.step, B.step], [1, 2, 3, 4], 'the probes stand on the ladder of fryStep');
  assert.ok(C.share > 0.15, `«приготовленное»: spots cover ${(C.share * 100).toFixed(0)} %`);
  assert.ok(Z.share > C.share + 0.08, `«зажаренное»: more area (${(C.share * 100).toFixed(0)} → ${(Z.share * 100).toFixed(0)} %)`);
  assert.ok(Z.p50 < C.p50 - 15, `«зажаренное»: darker spots (median luminance ${C.p50.toFixed(0)} → ${Z.p50.toFixed(0)})`);
  assert.ok(P.share > 0 && P.share < C.share, `«бледное»: a few flecks (${(P.share * 100).toFixed(0)} %)`);
  // ranges (luminance of spots, 10th–90th percentile), from the output of this suite (build 86)
  const inR = (s, lo, hi) => s.p10 >= lo && s.p90 <= hi;
  assert.ok(inR(P, 145, 200), `«бледное» spots golden: ${P.p10.toFixed(0)}–${P.p90.toFixed(0)}`);
  assert.ok(inR(C, 110, 185), `«приготовленное» spots gold-brown: ${C.p10.toFixed(0)}–${C.p90.toFixed(0)}`);
  assert.ok(inR(Z, 70, 150), `«зажаренное» spots brown: ${Z.p10.toFixed(0)}–${Z.p90.toFixed(0)}`);
  assert.ok(lum(B.ground) < 100 && (B.p50 === null || B.p50 < 60), `«горелое» dark all over: ground ${lum(B.ground).toFixed(0)}`);
  for (const s of [P, C, Z]) assert.ok(s.rgbMin && s.rgbMax[0] - s.rgbMax[2] > 40, 'warm, not grey');
  // ground between spots stays lighter than the spots
  for (const s of [P, C, Z]) assert.ok(s.groundLum > s.p90, 'ground lighter than its spots');
  // edges of the roti and the envelope seam: more and darker
  const E = h.J(FIELD(0.42, 1));
  assert.ok(E.share > C.share + 0.2 && E.p50 < C.p50, `at the edge: ${(E.share * 100).toFixed(0)} % (inside ${(C.share * 100).toFixed(0)} %), median ${E.p50.toFixed(0)}`);
  // on the real envelope: faces at the edge darker on average than the inside ones
  cookAll(h, 0.42); h.frames(1);
  const F = h.J(FACES), ed = F.filter(f => f.edge > 0.6), mid = F.filter(f => f.edge === 0);
  const m = a => a.reduce((s, f) => s + lum(f.c), 0) / a.length;
  assert.ok(ed.length > 5 && mid.length > 5, `edge ${ed.length} / inside ${mid.length} faces`);
  assert.ok(m(ed) < m(mid) - 10, `edge faces darker: ${m(ed).toFixed(0)} vs ${m(mid).toFixed(0)}`);
  const spotted = F.filter(f => lum(f.g) - lum(f.c) > 6).length / F.length;
  assert.ok(spotted > 0.15 && spotted < 0.8, `the envelope at «приготовленное»: ${(spotted * 100).toFixed(0)} % of seen faces carry a spot`);
  h.tick(1, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  const fmt = s => s.p50 === null ? `${(s.share * 100).toFixed(0)} %, ground ${s.groundLum.toFixed(0)}` : `${(s.share * 100).toFixed(0)} %, spot lum ${s.p10.toFixed(0)}–${s.p90.toFixed(0)} (med ${s.p50.toFixed(0)}), ground ${s.groundLum.toFixed(0)}, rgb ${s.rgbMin}…${s.rgbMax}`;
  return { summary: `бледное ${fmt(P)} | приготовленное ${fmt(C)} | зажаренное ${fmt(Z)} | горелое ${fmt(B)} | edge at «приготовленное» ${(E.share * 100).toFixed(0)} %; envelope faces spotted ${(spotted * 100).toFixed(0)} %, edge ${m(ed).toFixed(0)} vs inside ${m(mid).toFixed(0)}`, S };
});

test('L3', 'the pattern stays: the same spots frame to frame, after a turn and after a flip; another roti — another pattern', () => {
  const h = roti();
  cookAll(h, 0.42); h.frames(1);
  const a = h.J(FACES); h.frames(30); cookAll(h, 0.42); h.frames(1); const b = h.J(FACES);
  assert.deepEqual(b.map(f => f.c), a.map(f => f.c), 'frame to frame: identical colours');
  // material middles survive a turn exactly: the same material point, so the same spot
  const mids = () => h.J('dish.faces.filter(f=>f.kind==="dough").map(f=>{const q=faceMaterialMid(f);return [f.source,f.turned,+q.x.toFixed(6),+q.y.toFixed(6)]})');
  const m0 = mids();
  const turned = h.run('(()=>{const ok=rotateDish(0.6); return ok})()');
  assert.equal(turned, true, 'the envelope turns');
  const m1 = mids();
  const key = r => r.join('|');
  assert.deepEqual(m1.map(key).sort(), m0.map(key).sort(), 'after a turn every face sits on the same material point');
  const moved = h.run('(()=>{const f=dish.faces.find(f=>f.kind==="dough");const p=f.points[0];return Math.hypot(p.x,p.y)})()');
  // a flip (the whole dish mirrored): the same material points, the other side up
  h.run('fryHold=false'); h.run('startFlip({x:1,y:0},{x:0,y:0})'); h.frames(40);
  assert.equal(h.run('dish.flips'), 1, 'flipped');
  const m2 = mids();
  const pts = r => `${r[0]}|${r[2]}|${r[3]}`;
  const set0 = new Set(m0.map(pts)), same = m2.filter(r => set0.has(pts(r))).length;
  assert.equal(same, m2.length, `after a flip ${same}/${m2.length} faces on their own material points`);
  // another roti: another seed → another pattern; the same roti number → the same pattern
  const seeds = [h.run('dish.seed')];
  const g1 = roti(), g2 = roti();
  g2.run('EVE.rotiDone=1; dish.seed=crustSeedNow()');
  cookAll(g1, 0.42); cookAll(g2, 0.42); g1.frames(1); g2.frames(1);
  const f1 = g1.J(FIELD(0.42)), f2 = g2.J(FIELD(0.42));
  const mask = g => g.J(`(()=>{const P={base:[227,213,178],c:.42,edge:0,seed:dish.seed,side:1,ground:cookColor([227,213,178],crustGround(.42))};let s="";
    for(let j=0;j<40;j++) for(let i=0;i<40;i++){const k=crustMix(P,-.8+i*.04,-.8+j*.04); s+=k===P.ground?"0":"1";} return s;})()`);
  const k1 = mask(g1), k2 = mask(g2), kh = mask(h);
  let diff = 0; for (let i = 0; i < k1.length; i++) if (k1[i] !== k2[i]) diff++;
  assert.equal(kh, k1, 'two boots, roti 1 of the evening: the same pattern');
  assert.ok(diff > 200, `roti 2: another pattern (${diff}/1600 samples differ)`);
  assert.ok(Math.abs(f1.share - f2.share) < 0.06, `the same share of area all the same (${f1.share.toFixed(2)} / ${f2.share.toFixed(2)})`);
  seeds.push(g1.run('dish.seed'), g2.run('dish.seed'));
  for (const x of [h, g1, g2]) { x.tick(1, 1 / 60, true); assert.equal(x.run('loopErrs'), 0); }
  return { summary: `${a.length} seen faces identical over 30 frames; ${m1.length} faces on the same material points after a turn (moved ${moved.toFixed(2)}), ${same}/${m2.length} after a flip; seeds ${seeds.join('/')}, roti 1 vs 2: ${diff}/1600 samples differ` };
});

function glossRun(h, bottom) {
  // margarine under the whole hull, then cook the steel side and record what drawMargarineGloss draws
  h.run(`(()=>{fatMap=new Float32Array(FAT_N*FAT_N);const k=targetR/PAN_R;const Hl=dish.hull;for(let e=0;e<Hl.length;e++) for(let u=0;u<1;u+=.02){const A=Hl[e],B=Hl[(e+1)%Hl.length],p={x:A.x+(B.x-A.x)*u,y:A.y+(B.y-A.y)*u};const i=Math.floor((p.x*k+1)/2*FAT_N),j=Math.floor((p.y*k+1)/2*FAT_N);
    for(let dj=-2;dj<=2;dj++)for(let di=-2;di<=2;di++){const q=(j+dj)*FAT_N+i+di;if(q>=0&&q<fatMap.length)fatMap[q]=.6;}}})()`);
  cookSides(h, bottom, 0.02);
  return h.J(`(()=>{const rec={strokes:0,alpha:0,near:0,far:0};const pose=dishPose();
    const screen=p=>{const x=pose.x+p.x*pose.scale,y=pose.y+p.y*pose.scale;return{x:prX(x,y),y:prY(x,y)}};
    const c=screen(hullCentre(dish.hull)); let y0=0;
    const g={save(){},restore(){},beginPath(){},moveTo(x,y){y0=y},lineTo(x,y){this._y=(y0+y)/2},stroke(){rec.strokes++;const a=+/,([\\d.]+)\\)$/.exec(this.strokeStyle)[1];rec.alpha=Math.max(rec.alpha,a);if(this._y>c.y)rec.near++;else rec.far++;},set strokeStyle(v){this._s=v},get strokeStyle(){return this._s},lineWidth:1,lineCap:""};
    phase="PAN"; drawMargarineGloss(g,screen,null,0,1); return rec;})()`);
}

test('L4', 'the margarine gloss: on the near edge where fat is, none while the steel side is raw, brightest at «бледное», dims as it fries', () => {
  const h = roti();
  const r = {};
  for (const c of [0.05, 0.2, 0.42, 0.8, 1.05]) r[c] = glossRun(h, c);
  assert.equal(r[0.05].strokes, 0, 'raw steel side: no gloss');
  assert.ok(r[0.2].strokes > 0, 'margarine under a frying roti: gloss drawn');
  assert.equal(r[0.2].far, 0, 'only on the near edge');
  assert.ok(r[0.2].alpha > r[0.42].alpha && r[0.42].alpha > r[0.8].alpha && r[0.8].alpha > r[1.05].alpha, `dims: ${[0.2, 0.42, 0.8, 1.05].map(c => r[c].alpha.toFixed(2)).join(' → ')}`);
  h.run('fatMap=null');
  const none = glossRun(h, 0.2);
  assert.ok(none.strokes > 0, 'glossRun lays fat itself');
  h.run('fatMap=null');
  const dry = h.J('(()=>{let n=0;const g={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){n++}};drawMargarineGloss(g,p=>p,null,0,1);return n})()');
  assert.equal(dry, 0, 'no margarine — no gloss');
  h.tick(1, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  return { summary: `strokes/alpha by steel side cook: ${Object.entries(r).map(([c, v]) => `${c}: ${v.strokes}/${v.alpha.toFixed(2)}`).join(' · ')}` };
});

test('L5', 'the table: round spots on the top of the roti, per pixel; no hard step between neighbouring pixels inside the top', () => {
  const h = roti();
  cookAll(h, 0.6); h.frames(1);
  h.run('fryHold=false'); toTable(h); h.frames(5);
  const R = h.J(`(()=>{const pose=dishPose();const screen=p=>{const x=pose.x+p.x*pose.scale,y=pose.y+p.y*pose.scale;return{x:prX(x,y),y:prY(x,y)}};
    const faces=dish.faces,Hs=stackHeights(faces),zk=pose.scale*Z_EXAG/ROTI_R_MM*VIEW_UP;
    const R=renderDishTable(faces,screen,Hs,zk,cv.width,cv.height,Math.min(2,devicePixelRatio||1),{keep:true}); if(!R) return null;
    const d=R.data,w=R.w,h=R.h,L=[];let jumps=0,pairs=0,maxJump=0;const lum=q=>0.299*d[q]+0.587*d[q+1]+0.114*d[q+2];
    for(let j=0;j<R.bh;j++) for(let i=0;i<R.bw-1;i++){ const c=j*R.bw+i; if(R.tf[c]<0||R.tf[c+1]<0) continue;
      const r=Math.round(j-R.th[c])+R.up; if(r<0||r>=h) continue; const q=(r*w+i)*4; if(d[q+3]<255||d[q+4+3]<255) continue;
      const a=lum(q),b=lum(q+4); L.push(a); pairs++; const dj=Math.abs(a-b); if(dj>maxJump) maxJump=dj; if(dj>40) jumps++; }
    L.sort((a,b)=>a-b); const p=k=>L[Math.floor(k*(L.length-1))];
    return {n:L.length,p05:p(.05),p50:p(.5),p95:p(.95),jumps,pairs,maxJump};})()`);
  assert.ok(R && R.n > 2000, `table top sampled (${R && R.n} px)`);
  assert.ok(R.p95 - R.p05 > 30, `spots on the table top: luminance 5–95 % ${R.p05.toFixed(0)}–${R.p95.toFixed(0)}`);
  assert.ok(R.jumps / R.pairs < 0.01, `soft spot edges: ${R.jumps} of ${R.pairs} neighbouring pairs jump more than 40 (max ${R.maxJump.toFixed(0)})`);
  h.tick(1, 1 / 60, true); assert.equal(h.run('loopErrs'), 0);
  return { summary: `table top ${R.n} px, luminance 5/50/95 % ${R.p05.toFixed(0)}/${R.p50.toFixed(0)}/${R.p95.toFixed(0)}; jumps >40: ${R.jumps}/${R.pairs} (max ${R.maxJump.toFixed(0)})` };
});

const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\nfry-look: ${passed}/${results.length} passed`);
try {
  const dir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fry-look-results.json'), JSON.stringify({ source: H.sourcePath, sha256: H.sourceSha256, passed, total: results.length, results }, null, 2));
} catch (e) { console.log('report not written: ' + e.message); }
process.exit(passed === results.length ? 0 : 1);
