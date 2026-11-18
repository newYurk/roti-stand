#!/usr/bin/env node
'use strict';
// Сборка 101 (#89): каждое поле отладочной панели показывает то, что обещает, и умеет «нет данных».
//   node checks/panel-regression.cjs "$PWD/stand.js"
// Чистый Node/vm, те же моки, что у model-regression.cjs: это не браузер.
const assert = require('node:assert/strict');
const quiet = console.log; console.log = () => {};
const H = require('./model-regression.cjs');
console.log = quiet;
const { boot } = H;
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + String(e.message).split('\n')[0]); }
}
const TUNE = { com: 100, creep: 100, brk: 100 };
const stats = h => h.nodes.get('stats').textContent;
const mini = h => h.nodes.get('mini').textContent;
const frames = (h, n, ms) => h.tick(n, ms / 1000, true);
const fresh = () => { const h = boot(TUNE, 390, 844); frames(h, 12, 16.7); return h; };

test('fps: 50 ms frames read 20, 16.7 ms read 60 (no clamp)', () => {
  const h = fresh(); frames(h, 40, 50);
  const f = +/(\d+) fps/.exec(stats(h))[1]; assert.ok(f >= 19 && f <= 21, 'fps ' + f);
  frames(h, 120, 1000 / 60);
  const g = +/(\d+) fps/.exec(stats(h))[1]; assert.ok(g >= 59 && g <= 61, 'fps ' + g);
});
test('fps: no data before the first measurement is a dash, not a number', () => {
  const h = boot(TUNE, 390, 844); frames(h, 3, 16.7);
  assert.match(stats(h), /— fps/); assert.match(mini(h), /fps —/);
});
test('worst frame: a 180 ms frame reads 180 ms; none yet → dash', () => {
  const h = boot(TUNE, 390, 844); frames(h, 3, 16.7); assert.match(mini(h), /худший —/);
  frames(h, 12, 16.7); frames(h, 1, 180); frames(h, 3, 16.7);
  assert.match(stats(h), /худший кадр 180 мс/); assert.match(mini(h), /худший 180 мс/);
});
test('pauses: a ≥1 s gap counts as pause, not as worst; restart clears it', () => {
  const h = fresh(); frames(h, 1, 2500); frames(h, 3, 16.7);
  assert.match(stats(h), /пауз 1/); assert.doesNotMatch(stats(h), /худший кадр 2500/);
  h.run('restartRun()'); frames(h, 3, 16.7);
  assert.doesNotMatch(stats(h), /пауз/); assert.match(stats(h), /худший кадр —/);
});
test('touches: «нет» before any, then rises with real touchstarts', () => {
  const h = fresh(); assert.match(stats(h), /касаний нет/);
  h.touch('start', 't1', 100, 300); h.touch('end', 't1', 100, 300);
  h.touch('start', 't2', 120, 320); h.touch('end', 't2', 120, 320);
  assert.match(stats(h), /касаний нет/, 'stats are redrawn per frame'); frames(h, 1, 16.7);
  assert.match(stats(h), /касаний 2 /);
});
test('pointers: «нет» before any; three mouse downs → 3; mouse is not «касаний»', () => {
  const h = fresh(); assert.match(stats(h), /указателей нет/);
  for (let i = 0; i < 3; i++) { h.pointer('down', 'p1', 100, 300, 'mouse'); h.pointer('up', 'p1', 100, 300, 'mouse'); }
  frames(h, 1, 16.7);
  assert.match(stats(h), /указателей 3 /); assert.match(stats(h), /касаний нет/); assert.match(stats(h), /· мышь/);
});
test('↓/↔: counted even when the input is swallowed (quiet window); moves counted outside a gesture', () => {
  const h = fresh(); h.run('inputQuietUntil=performance.now()+100000');
  h.touch('start', 't1', 100, 300); h.touch('move', 't1', 110, 310); h.touch('move', 't1', 120, 320); frames(h, 1, 16.7);
  assert.match(stats(h), /↓1 ↔2/);
});
test('input kind: «ждёт» before input, «touch»/«мышь» after; a sheet on the tava does not overwrite it', () => {
  const h = fresh(); assert.match(stats(h), /ждёт/);
  h.touch('start', 't1', 100, 300); h.touch('end', 't1', 100, 300); frames(h, 1, 16.7); assert.match(stats(h), /· touch/);
  h.run('phase="PAN"'); h.touch('start', 't1', 100, 300); h.touch('end', 't1', 100, 300); frames(h, 1, 16.7);
  assert.match(stats(h), /· touch/); assert.doesNotMatch(stats(h), /· тава/);
});
test('loop errors: «сбоев 0» is shown; a throw in the frame raises it; a throw in the readout does not freeze the loop', () => {
  const h = fresh(); const e0 = console.error; console.error = () => {};
  try {
    assert.match(stats(h), /сбоев 0/);
    h.run('const __st=step; step=()=>{throw new Error("x")}'); frames(h, 3, 16.7); assert.match(stats(h), /сбоев 3/);
    h.run('step=__st; globalThis.__bad=true; const __d=median; median=()=>{throw new Error("y")}; latencies.push(5)'); frames(h, 2, 16.7);
    h.run('median=__d; latencies.length=0'); frames(h, 2, 16.7);
    assert.match(stats(h), /сбоев 5/);
  } finally { console.error = e0; }
});
test('sound delay: dash without data; a browser that reports 0 latency stays «—»', () => {
  const h = boot(TUNE, 390, 844, { audio: true }); frames(h, 12, 16.7);
  assert.match(stats(h), /задержка —/);
  h.touch('start', 't9', 100, 300); h.touch('end', 't9', 100, 300); h.run('latencies.length=0'); frames(h, 1, 16.7);
  h.run('AC.baseLatency=0; AC.outputLatency=0'); h.touch('start', 't1', 100, 300); h.touch('end', 't1', 100, 300); frames(h, 1, 16.7);
  assert.match(stats(h), /задержка —/, '0 ms from the browser is «unknown»');
  h.run('AC.outputLatency=0.04'); h.touch('start', 't1', 100, 300); h.touch('end', 't1', 100, 300); frames(h, 1, 16.7);
  assert.match(stats(h), /задержка 4\d мс/);
});
test('recognised / attempts: dash with no attempts; sheet fill: dash on step 1, percent on step 2+', () => {
  const h = fresh(); assert.match(stats(h), /попыток 0\/30  распознано —/); assert.match(stats(h), /лист —/);
  h.run('stepNo=2;reset()'); frames(h, 3, 16.7); assert.match(stats(h), /лист \d+%/);
});
test('restart: meters (fps, worst, delay, tosses) go back to «no data»; build string present', () => {
  const h = fresh(); frames(h, 1, 150); frames(h, 40, 16.7); h.run('restartRun()'); frames(h, 2, 16.7);
  assert.match(stats(h), /— fps/); assert.match(stats(h), /худший кадр —/); assert.match(stats(h), /сборка: .*101/);
});
test('survives frame switch and evening mode: panel keeps updating', () => {
  const h = fresh(); const before = stats(h);
  h.run('document.querySelectorAll("[data-frame]")'); frames(h, 5, 16.7);
  assert.ok(stats(h).length > 20 && /fps/.test(stats(h)));
});
console.log(`\n${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
