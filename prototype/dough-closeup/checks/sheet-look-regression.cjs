#!/usr/bin/env node
'use strict';
// Build 94, "sheet" batch (docs/review-2026-11-18-b93.md, points 1 and 6): how the sheet on the table is drawn.
//   L1 a hole leaves the cells around it alone: no "+0.28 thicker" light patch, the cells keep their own thickness
//      colour; the whole sheet goes through the soft layer (drawSheetSoft) and the hole rim (drawHoleRims) is drawn;
//   L2 the corner arcs of the stretch target are drawn at step 2 and not at step 3 (the "orange outline");
//   L3 rim walls on the tava only on open, near-facing sides (wallEdgesOpen): no walls under the translucent top;
//   L4 egg white is milky (warm, denser), not a cold thin white;
//   L5 night: the leftover dough lump is drawn under the dusk layer, with the table.
// Pure Node/vm with the mocks of model-regression.cjs; drawing is recorded by a Proxy context. Not a browser:
// how it looks was checked on screenshots (runs/merge-sheet/).
//   node prototype/dough-closeup/checks/sheet-look-regression.cjs path/to/stand.js
// Report: runs/checks/sheet-look-results.json of the checkout (runs/ is not in git).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const H = require('./model-regression.cjs');
const { boot } = H;
const sideScripts = ['banana.js', 'egg.js', 'evening.js', 'guest.js', 'notebook.js', 'night.js'].map(f => ({ file: path.join(path.dirname(H.sourcePath), f), src: fs.readFileSync(path.join(path.dirname(H.sourcePath), f), 'utf8') }));
const results = [];
function test(id, name, fn) {
  const t0 = Date.now();
  try { const result = fn() || {}; results.push({ id, name, status: 'PASS', seconds: (Date.now() - t0) / 1000, result }); }
  catch (err) { results.push({ id, name, status: 'FAIL', seconds: (Date.now() - t0) / 1000, error: err.stack }); }
  const r = results.at(-1);
  console.log(`${r.status} ${id} ${name} (${r.seconds.toFixed(1)} s)` + (r.status === 'FAIL' ? `\n     ${String(r.error).split('\n').slice(0, 3).join('\n     ')}` : ''));
  if (r.result && r.result.summary) console.log('     ' + r.result.summary);
}
const TUNE = { com: 100, creep: 100, brk: 100 };
// A recording 2D context in the stand's context: every fill/stroke logs its style, in order.
const REC = `globalThis.__rec=()=>{const log=[];const o={log,canvas:{width:1000,height:600}};return new Proxy(o,{get:(t,k)=>k in t?t[k]:(k==='fill'||k==='fillRect'?()=>log.push({op:'fill',style:t.fillStyle}):k==='stroke'?()=>log.push({op:'stroke',style:t.strokeStyle,w:t.lineWidth}):()=>{}),set:(t,k,v)=>{t[k]=v;return true;}});};1`;
function stand() { const h = boot(TUNE); h.run(REC); h.J = c => JSON.parse(h.run(`JSON.stringify(${c})`)); return h; }

test('L1', 'a hole does not thicken the cells around it; soft layer and hole rim are drawn', () => {
  const h = stand();
  // a hole at the sheet centre through the native topology mutation (as model-regression), step 2 on the table
  h.run(`{stepNo=2;const c=centerOfSheet();let best=0,bd=Infinity;quads.forEach((q,k)=>{const x=q.reduce((s,n)=>s+px[n],0)/4,y=q.reduce((s,n)=>s+py[n],0)/4,d=(x-c.x)**2+(y-c.y)**2;if(d<bd){bd=d;best=k;}});
    globalThis.__hole=best;for(const c of quadCons[best])breakCon(c);onTear();}`);
  h.run(`globalThis.__ts=[];{const o=tableSkin;tableSkin=function(t,r){__ts.push(+t);return o(t,r)};}
    globalThis.__soft=null;{const o=drawSheetSoft;drawSheetSoft=function(...a){return __soft=o.apply(this,a)};}
    globalThis.__rims=0;{const o=drawHoleRims;drawHoleRims=function(...a){__rims++;return o.apply(this,a)};}
    draw();1`);
  assert.equal(h.run('tornAt>0'), true);
  assert.equal(h.run('__soft'), true, 'torn sheet on the table is drawn through the soft layer');
  assert.equal(h.run('__rims'), 1, 'hole rim drawn once');
  // neighbours of the hole: cells sharing a node with a torn cell
  const r = h.J(`(()=>{const torn=new Set();quads.forEach((q,k)=>{if(quadCons[k].some(c=>c.broken))q.forEach(n=>torn.add(n));});
    const Hm=thick, nb=[];quads.forEach((q,k)=>{if(quadCons[k].some(c=>c.broken))return;if(q.some(n=>torn.has(n)))nb.push(q.reduce((s,n)=>s+Hm[n],0)/4);});
    const has=t=>__ts.some(x=>Math.abs(x-t)<1e-9);
    return {n:nb.length,plain:nb.filter(has).length,patched:nb.filter(t=>t+0.28<=1&&has(t+0.28)).length};})()`);
  assert.ok(r.n >= 4, 'hole has intact neighbours');
  assert.equal(r.plain, r.n, 'every neighbour is drawn with its own thickness');
  assert.equal(r.patched, 0, 'no neighbour is drawn 0.28 thicker (the light patch)');
  assert.equal(h.run('loopErrs'), 0); assert.deepEqual(h.errors, []);
  return { summary: `${r.n} neighbour cells, all at their own thickness, 0 patched; soft layer on, hole rim drawn` };
});

test('L2', 'corner arcs of the target: drawn at step 2, gone at step 3', () => {
  const h = stand();
  const arcs = step => h.run(`(()=>{stepNo=${step};phase="TABLE";sheetHidden=false;cornerDone=[1,1,1,1];const g=__rec();drawStretchTarget(g,1,1);return g.log.filter(e=>e.op==='stroke'&&e.style==='#b98a45').length;})()`);
  const a2 = arcs(2), a3 = arcs(3);
  assert.equal(a2, 4, 'four done corners are marked while stretching');
  assert.equal(a3, 0, 'no warm arcs around the ready sheet');
  return { summary: `arcs step 2: ${a2}, step 3: ${a3}` };
});

test('L3', 'rim walls only on open sides facing the viewer', () => {
  const h = stand();
  // two triangles sharing the diagonal of a unit square; screen = identity (y down = toward the viewer)
  const r = h.J(`(()=>{const P=(x,y)=>({x,y});const f1={kind:'dough',points:[P(0,0),P(1,0),P(1,1)]},f2={kind:'dough',points:[P(0,0),P(1,1),P(0,1)]};
    const faces=[f1,f2],id=p=>p;return {a:wallEdgesOpen(faces,0,id),b:wallEdgesOpen(faces,1,id)};})()`);
  // f1: top edge (0,0)-(1,0) faces up → closed; right edge (1,0)-(1,1) faces right → closed (not down); diagonal shared → closed
  // f2: diagonal shared → closed; bottom edge (1,1)-(0,1) faces down → open; left edge faces left → closed
  assert.deepEqual(r.a, [false, false, false]);
  assert.deepEqual(r.b, [false, true, false]);
  return { summary: `f1 ${JSON.stringify(r.a)}, f2 ${JSON.stringify(r.b)}` };
});

test('L4', 'egg white is milky: warm and denser than build 93', () => {
  const h = stand();
  const [rgb, a] = h.J('[EGG_WHITE_RGB, EGG_WHITE_A]');
  assert.ok(rgb[0] > rgb[1] && rgb[1] > rgb[2], 'warm: r > g > b');
  assert.ok(rgb[0] - rgb[2] >= 15, 'not a cold white');
  assert.ok(a >= 0.6, 'dense enough not to read grey over the dough');
  return { summary: `rgb ${rgb.join(',')} alpha ${a}` };
});

test('L5', 'night: the leftover lump is under the dusk layer', () => {
  const h = boot(TUNE, 390, 844); h.run(REC);
  h.context.document.readyState = 'complete';
  for (const s of sideScripts) vm.runInContext(s.src, h.context, { filename: s.file, timeout: 10000 });
  const r = JSON.parse(h.run(`JSON.stringify((()=>{EVE.over=true;EVE.lamp=false;EVE.ball=false;EVE.ballsLeft=0;const g=__rec();eveningDraw(g,1,1,1);
    const L=g.log.map(e=>e.style);return {lump:L.indexOf('#f0e0b0'),dusk:L.indexOf('rgba(8,6,10,0.55)')};})())`));
  assert.ok(r.lump >= 0, 'lump drawn'); assert.ok(r.dusk >= 0, 'dusk drawn');
  assert.ok(r.lump < r.dusk, 'lump before the dusk layer — dimmed with the table');
  return { summary: `lump fill #${r.lump}, dusk #${r.dusk}` };
});

const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\nsheet-look: ${passed}/${results.length} passed`);
try {
  const dir = path.resolve(path.dirname(H.sourcePath), '..', '..', 'runs', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sheet-look-results.json'), JSON.stringify({ source: H.sourcePath, sha256: H.sourceSha256, passed, total: results.length, results }, null, 2));
} catch (e) { console.log('report not written: ' + e.message); }
process.exit(passed === results.length ? 0 : 1);
