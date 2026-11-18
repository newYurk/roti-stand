/* drizzle.js — жест налива сгущёнки.
   Подключается ПОСЛЕ stand.js. Правок в stand.js не требует.

   РЕЖИМ: кнопка #drizzleMode. Пока выключена — нарезка штатная.
   Включена — рез на столе глушится (и мышь, и touchstart на iPhone),
   палец ведёт нить сгущёнки.

   Нить остаётся на роти. После отпускания — короткий выбег по последней
   скорости (инерция вязкой нити, docs/papers.md). Ширина ∝ 1/скорость руки.

   API:
     drizzleUpdate(dt)
     drizzleDraw(ctx)
     drizzleReset()
     drizzleEnabled  — покрытие [0..1]

   ВАРЕНЬЕ (шаг 5 v0, shelf.js): тот же жест другим цветом. window.drizzleTint = {fill, rim} — нить,
   начатая при нём, плоская: без брызг, падающих капель, выбега и мокрого блеска (правило 17.11).
   drizzleActive — палец ведёт нить; drizzleStrokes — сколько нитей легло на роти; drizzlePaint —
   те же нити в чужой холст (снимок тетради). Нити помнят грань по номеру; после нового реза номера
   другие — _relink() находит грань заново по точке.
*/

"use strict";

const DRIZZLE_COLOR_FILL = "rgba(255, 248, 226, 0.97)";
const DRIZZLE_COLOR_RIM  = "rgba(168, 128, 64, 0.55)";
const DRIZZLE_COLOR_WET  = "rgba(255, 255, 245, 0.55)";
const DRIZZLE_COLOR_DROP = "rgba(255, 236, 190, 0.9)";
const STAIN_WET          = 0.82;   // мокрый блеск садится сюда и живёт
const SETTLE_T           = 0.55;
const COAST_T            = 0.22;   // выбег после отпускания, с
const COAST_DECAY        = 0.11;   // постоянная затухания скорости
const STEP_FRAC          = 0.35;   // шаг штампа относительно ширины нити

let DRIZZLE_COVERAGE = 0.0;

let _modeOn       = false;
let _active       = false;
let _captureId    = null;
let _trails       = [];
let _currentTrail = null;
let _drops        = [];
let _falls        = [];
let _coverage     = 0;
let _samples      = [];
let _coast        = null;
let _cardDone     = false;
let _facesRef     = null;    // dish.faces, для которого верны номера граней в нитях

Object.defineProperty(window, "drizzleEnabled",
  { get: () => _coverage, configurable: true });
Object.defineProperty(window, "drizzleModeOn",
  { get: () => _modeOn, configurable: true });
Object.defineProperty(window, "drizzleActive",
  { get: () => _active, configurable: true });
Object.defineProperty(window, "drizzleStrokes",
  { get: () => _trails.filter(t => t.pts.some(q => q && !q.break)).length, configurable: true });

function drizzleReset() {
  _modeOn = false; _active = false; _captureId = null;
  _trails = []; _currentTrail = null; _drops = []; _falls = []; _coverage = 0;
  _samples = []; _coast = null; _cardDone = false; _facesRef = null;
  const body = document.getElementById("cardBody");
  if (body) delete body.dataset.drizzle;
  _syncButton();
}

function _relink() {
  if (typeof dish === "undefined" || !dish || !dish.faces || typeof pointInFace !== "function") return;
  if (dish.faces === _facesRef) return;
  const first = _facesRef === null || !_trails.length;
  _facesRef = dish.faces;
  if (first) return;
  for (const t of _trails) {
    for (let n = 0; n < t.pts.length; n++) {
      const p = t.pts[n];
      if (!p || p.break) continue;
      const f = dish.faces[p.face];
      if (f && f.kind === "dough" && pointInFace(f.points, p.x, p.y)) continue;
      let found = false;
      for (let i = 0; i < dish.faces.length && !found; i++) {
        const q = dish.faces[i];
        if (q.kind === "dough" && pointInFace(q.points, p.x, p.y)) { p.face = i; found = true; }
      }
      if (!found) t.pts[n] = { break: true };   // точка попала в пропил: нить здесь рвётся
    }
  }
}

function drizzleUpdate(dt) {
  _relink();
  if (_coast && _currentTrail) {
    _coast.t += dt;
    const damp = Math.exp(-dt / COAST_DECAY);
    _coast.vx *= damp;
    _coast.vy *= damp;
    const pan = typeof PAN_R === "number" ? PAN_R : 80;
    const sp = Math.hypot(_coast.vx, _coast.vy);
    if (sp < pan * 0.35 || _coast.t > COAST_T) {
      _currentTrail.settling = true;
      _currentTrail = null;
      _coast = null;
    } else {
      _coast.x += _coast.vx * dt;
      _coast.y += _coast.vy * dt;
      _stamp(_currentTrail, _coast.x, _coast.y, sp);
    }
  }

  const g = typeof PAN_R === "number" ? PAN_R * 2.4 : 200;
  for (const d of _falls) {
    d.t += dt;
    d.vy += g * dt;
    d.y += d.vy * dt;
    d.a = Math.max(0, d.a0 * (1 - d.t / d.life));
  }
  if (_falls.length) _falls = _falls.filter(d => d.t < d.life && d.a > 0.02);

  for (const t of _trails) {
    if (t.settling && t.wet > STAIN_WET) {
      t.wet -= dt / SETTLE_T;
      if (t.wet < STAIN_WET) t.wet = STAIN_WET;
    }
  }

  if (typeof dish !== "undefined" && dish && dish.mode !== "cut" && dish.mode !== "served") {
    if (_trails.length) drizzleReset();
  }

  _ensureCardLine();
  _syncButton();
  if (DRIZZLE_COVERAGE > 0) _updateServe();
}

function drizzleDraw(ctx) {
  if (!_trails.length && !_drops.length && !_falls.length) return;
  const tilt = typeof TILT === "number" ? TILT : 0.56;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const trail of _trails) {
    if (trail.tint) { _strokeFlat(ctx, trail); continue; }
    const runs = _runs(trail.pts);
    ctx.globalAlpha = Math.min(1, trail.wet + 0.12);
    for (const run of runs) _strokeRun(ctx, run, tilt);
  }
  for (const d of _drops) {
    const s = _screen(d.x, d.y, d.face);
    if (!s) continue;
    ctx.globalAlpha = d.alpha;
    ctx.fillStyle = DRIZZLE_COLOR_DROP;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, Math.max(d.r, 2), Math.max(d.r, 2) * tilt, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const d of _falls) {
    ctx.globalAlpha = d.a;
    ctx.fillStyle = DRIZZLE_COLOR_FILL;
    const sx = _px(d.x, d.y), sy = _py(d.x, d.y);
    ctx.beginPath();
    ctx.ellipse(sx, sy, d.r, d.r * tilt * 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function _shiftOf(face) {
  if (typeof dish === "undefined" || !dish || typeof pieceShiftLive !== "function") return { x: 0, y: 0 };
  const f = dish.faces[face];
  const sh = pieceShiftLive(dish.faces);
  return (f && sh && sh.get(f)) || { x: 0, y: 0 };
}

function _tableFromLocal(mx, my, face) {
  const o = _shiftOf(face);
  let p = { x: mx + o.x, y: my + o.y };
  if (typeof dishTwist !== "undefined" && dishTwist && typeof rotAbout === "function")
    p = rotAbout(p, dishTwist.pivot, Math.cos(dishTwist.angle), Math.sin(dishTwist.angle));
  const pose = typeof dishPose === "function" ? dishPose() : { x: 0, y: 0, scale: 1 };
  // роти в руке (несут на стойку): стенд рисует его со сдвигом жеста — нить идёт вместе с ним
  const g = typeof dishGesture !== "undefined" ? dishGesture : null;
  const sl = g && g.slide ? { x: g.slide.x * pose.scale, y: g.slide.y * pose.scale - (g.carry ? 0.05 * pose.scale : 0) } : { x: 0, y: 0 };
  return { x: pose.x + sl.x + p.x * pose.scale, y: pose.y + sl.y + p.y * pose.scale };
}

function _screen(mx, my, face) {
  const t = _tableFromLocal(mx, my, face);
  return { x: _px(t.x, t.y), y: _py(t.x, t.y) };
}

function _runs(pts) {
  const out = [];
  let cur = [];
  for (const p of pts) {
    if (!p || p.break) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    if (cur.length && cur[0].face !== p.face) {
      out.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

// Куски нити между разрывами, без деления по граням (для плоской полосы варенья).
function _segments(pts) {
  const out = [];
  let cur = [];
  for (const p of pts) {
    if (!p || p.break) { if (cur.length) out.push(cur); cur = []; continue; }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

// Плоская полоса (варенье): одна ровная линия одного цвета через все грани, без обрезки по грани и
// без каймы — на мелких треугольниках листа обрезанная нить рвалась в клочья.
// Ширина одна на всю полосу и не зависит от скорости пальца (быстрый штрих был волосом, медленный — комками).
function _flatWidth() { return Math.max(4, (typeof PAN_R === "number" ? PAN_R : 80) * 0.05); }
// Точки чаще, чем через полширины полосы, пропускаются: дрожь медленного пальца шла по краю зубцами.
function _thin(pts, min) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i], l = out[out.length - 1];
    if (!l || i === pts.length - 1 || Math.hypot(q.x - l.x, q.y - l.y) >= min) out.push(q);
  }
  return out;
}
function _strokeFlat(ctx, trail) {
  ctx.globalAlpha = 1;
  ctx.strokeStyle = trail.tint.fill;
  for (const seg of _segments(trail.pts)) {
    ctx.lineWidth = _flatWidth();
    ctx.beginPath();
    const qs = _thin(seg.map(p => _screen(p.x, p.y, p.face)), ctx.lineWidth / 2);
    qs.forEach((q, i) => { if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    if (qs.length === 1) ctx.lineTo(qs[0].x + 0.01, qs[0].y);
    ctx.stroke();
  }
}

function _clipFace(ctx, face) {
  if (typeof dish === "undefined" || !dish || !dish.faces[face]) return false;
  const f = dish.faces[face];
  if (!f.points || f.points.length < 3) return false;
  ctx.beginPath();
  for (let i = 0; i < f.points.length; i++) {
    const s = _screen(f.points[i].x, f.points[i].y, face);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  }
  ctx.closePath();
  ctx.clip();
  return true;
}

function _strokeRun(ctx, run, tilt) {
  const RIM = DRIZZLE_COLOR_RIM, FILL = DRIZZLE_COLOR_FILL;
  if (!run.length) return;
  let wAvg = 0;
  for (const p of run) wAvg += p.w;
  wAvg /= run.length;
  const rimW = Math.max(4, wAvg * 2.05);
  const fillW = Math.max(2.5, wAvg * 1.45);
  ctx.save();
  if (!(typeof dishTwist !== "undefined" && dishTwist))
    _clipFace(ctx, run[0].face);
  if (run.length === 1) {
    const s = _screen(run[0].x, run[0].y, run[0].face);
    ctx.fillStyle = RIM;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, rimW * 0.5, rimW * 0.5 * tilt, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = FILL;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, fillW * 0.5, fillW * 0.5 * tilt, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    for (let i = 0; i < run.length; i++) {
      const s = _screen(run[i].x, run[i].y, run[i].face);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    ctx.strokeStyle = RIM;
    ctx.lineWidth = rimW;
    ctx.stroke();
    ctx.strokeStyle = FILL;
    ctx.lineWidth = fillW;
    ctx.stroke();
  }
  ctx.restore();
}

function _px(x, y) { return typeof prX === "function" ? prX(x, y) : x; }
function _py(x, y) { return typeof prY === "function" ? prY(x, y) : y; }

function _pt(e) {
  if (typeof dishInputLocal === "function") return dishInputLocal(e.clientX, e.clientY);
  if (typeof toLocal === "function") return toLocal(e.clientX, e.clientY);
  const cv = document.getElementById("cv");
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function _widthForSpeed(sp) {
  const pan = typeof PAN_R === "number" ? PAN_R : 80;
  const ref = pan * 1.8;
  const k = Math.max(0.5, Math.min(2.1, ref / Math.max(sp, pan * 0.15)));
  return pan * 0.022 * k;
}

function _hit(p) {
  if (typeof dish === "undefined" || !dish || !dish.faces) return null;
  const local = typeof dishLocal === "function" ? dishLocal(p) : p;
  const shift = typeof pieceShiftLive === "function" ? pieceShiftLive(dish.faces) : null;
  if (typeof pointInFace !== "function") return null;
  for (let i = 0; i < dish.faces.length; i++) {
    const f = dish.faces[i];
    if (f.kind !== "dough") continue;
    const o = (shift && shift.get(f)) || { x: 0, y: 0 };
    if (pointInFace(f.points, local.x - o.x, local.y - o.y))
      return { i, mx: local.x - o.x, my: local.y - o.y, o };
  }
  return null;
}

function _nearRoti(p) {
  if (typeof dish === "undefined" || !dish) return false;
  const local = typeof dishLocal === "function" ? dishLocal(p) : p;
  if (dish.hull && dish.hull.length && typeof pointInFace === "function" && pointInFace(dish.hull, local.x, local.y))
    return true;
  if (typeof pointInFace === "function") {
    for (const f of dish.faces) {
      if (f.kind !== "dough") continue;
      if (pointInFace(f.points, local.x, local.y)) return true;
    }
  }
  return false;
}

function _fall(x, y, w) {
  const pan = typeof PAN_R === "number" ? PAN_R : 80;
  _falls.push({
    x, y,
    vy: pan * (0.22 + Math.random() * 0.18),
    t: 0,
    life: 0.22 + Math.random() * 0.12,
    r: Math.max(1.6, w * 0.38),
    a: 0.95,
    a0: 0.95
  });
}

function _stamp(trail, x, y, sp) {
  const prev = trail._lastTable;
  trail._lastTable = { x, y };
  if (prev) {
    const dx = x - prev.x, dy = y - prev.y;
    const dist = Math.hypot(dx, dy);
    const pose = typeof dishPose === "function" ? dishPose() : { scale: 80 };
    const stepPx = Math.max(3, pose.scale * 0.012);
    const n = Math.min(20, Math.floor(dist / stepPx));
    for (let i = 1; i <= n; i++)
      _stampOne(trail, prev.x + dx * i / (n + 1), prev.y + dy * i / (n + 1), sp);
  }
  _stampOne(trail, x, y, sp);
}

function _stampOne(trail, x, y, sp) {
  const w = _widthForSpeed(sp);
  const hit = _hit({ x, y });
  if (!hit) {
    if (!trail.tint && _nearRoti({ x, y })) _fall(x, y, w);
    trail.broken = true;
    return;
  }
  const last = trail.pts[trail.pts.length - 1];
  if (trail.broken || (!trail.tint && last && !last.break && last.face !== hit.i)) {
    trail.pts.push({ break: true });
    trail.broken = false;
  } else if (last && !last.break && last.face === hit.i) {
    const pose = typeof dishPose === "function" ? dishPose() : { scale: 1 };
    const dist = Math.hypot(hit.mx - last.x, hit.my - last.y);
    const step = Math.max(0.003, (w / Math.max(8, pose.scale)) * STEP_FRAC);
    if (dist < step) return;
  }
  trail.broken = false;
  trail.pts.push({ x: hit.mx, y: hit.my, w, face: hit.i });
  _recalc();
}

function _bead(x, y, pan, face) {
  const r = pan * (0.006 + Math.random() * 0.008);
  _drops.push({
    x: x + (Math.random() - 0.5) * r * 3,
    y: y + (Math.random() - 0.5) * r * 3,
    r, alpha: 0.55 + Math.random() * 0.25, face
  });
}

function _inDrizzlePhase() {
  return _modeOn
    && typeof phase !== "undefined" && phase === "CUT"
    && typeof dish !== "undefined" && dish && dish.mode === "cut"
    && !dishMove;
}

function _ui(e) {
  return typeof inUI === "function" && inUI(e.target);
}

function _onDown(e) {
  if (!_inDrizzlePhase() || _ui(e)) return;
  if (e.button != null && e.button !== 0) return;
  if (_active) return;
  // варенье (shelf.js): касание радио, тетради или банки — не штрих; shelf.js убирает варенье, касание идёт стенду
  if (window.drizzleTint && typeof window.drizzlePass === "function" && window.drizzlePass(e.clientX, e.clientY)) return;
  _active = true;
  _captureId = e.pointerId;
  _coast = null;
  const cv = document.getElementById("cv");
  try { cv && cv.setPointerCapture(e.pointerId); } catch (err) {}
  const p = _pt(e);
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  _samples = [{ x: p.x, y: p.y, t: now }];
  _currentTrail = { pts: [], wet: 1, settling: false, tint: window.drizzleTint || null };
  _trails.push(_currentTrail);
  _stamp(_currentTrail, p.x, p.y, 0);
  e.stopImmediatePropagation();
  e.preventDefault();
}

function _onMove(e) {
  if (!_active || e.pointerId !== _captureId || !_currentTrail) return;
  const p = _pt(e);
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  const last = _samples[_samples.length - 1];
  const dt = Math.max(0.008, now - last.t);
  const sp = Math.hypot(p.x - last.x, p.y - last.y) / dt;
  _samples.push({ x: p.x, y: p.y, t: now });
  if (_samples.length > 12) _samples.shift();
  _stamp(_currentTrail, p.x, p.y, sp);
  const hit = _hit(p);
  if (hit && !_currentTrail.tint && Math.random() < 0.08) _bead(hit.mx, hit.my, typeof PAN_R === "number" ? PAN_R : 80, hit.i);
  e.stopImmediatePropagation();
}

function _velocity() {
  if (_samples.length < 2) return { vx: 0, vy: 0 };
  const now = _samples[_samples.length - 1];
  let i = _samples.length - 2;
  while (i > 0 && now.t - _samples[i].t < 0.08) i--;
  const a = _samples[i];
  const dt = Math.max(0.016, now.t - a.t);
  return { vx: (now.x - a.x) / dt, vy: (now.y - a.y) / dt };
}

function _onUp(e) {
  if (e.pointerId !== _captureId) return;
  _active = false;
  _captureId = null;
  if (_currentTrail && _currentTrail.pts.some(q => q && !q.break)) {
    const v = _velocity();
    const pan = typeof PAN_R === "number" ? PAN_R : 80;
    const last = _samples[_samples.length - 1];
    if (last && !_currentTrail.tint && Math.hypot(v.vx, v.vy) > pan * 0.5) {
      _coast = { x: last.x, y: last.y, vx: v.vx, vy: v.vy, t: 0 };
    } else {
      _currentTrail.settling = true;
      _currentTrail = null;
    }
  } else {
    _currentTrail = null;
  }
  _samples = [];
}

function _recalc() {
  let total = 0;
  for (const t of _trails) {
    const pts = t.pts.filter(p => p && !p.break);
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].face !== pts[i - 1].face) continue;
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
  }
  const ref = (typeof PAN_R !== "undefined" ? PAN_R : 80) * 0.22 * 2;
  _coverage = Math.min(1, total / (ref * 1.8));
}

function _ensureCardLine() {
  if (_cardDone) return;
  if (typeof dish === "undefined" || !dish || dish.mode !== "served") return;
  const body = document.getElementById("cardBody");
  if (!body || body.dataset.drizzle) return;
  body.dataset.drizzle = "1";
  _cardDone = true;
  const line = _coverage > 0.04 ? "Сгущёнка: узор налит" : "Сгущёнка: без полива";
  body.textContent = body.textContent.replace(/\n\nчерновик/, "\n" + line + "\n\nчерновик");
}

function _updateServe() {
  // Кнопка «подать» скрыта — покрытие только в дамп, без подсказки про подачу.
}

function _syncButton() {
  const b = document.getElementById("drizzleMode");
  if (!b) return;
  b.hidden = false;
  b.classList.toggle("on", _modeOn);
  b.textContent = _modeOn ? "сгущёнка ✓" : "сгущёнка";
}

function _setMode(on) {
  if (on && typeof dish !== "undefined" && dish && dish.mode === "fold") {
    const ok = typeof startRemoval === "function" && startRemoval();
    if (!ok) {
      const live = document.getElementById("live");
      if (live) live.textContent = "сначала сложи конверт, потом сгущёнка";
      _modeOn = false;
      _syncButton();
      return;
    }
  }
  _modeOn = !!on;
  if (!_modeOn) {
    _active = false; _captureId = null; _coast = null; _currentTrail = null;
  }
  _syncButton();
  const live = document.getElementById("live");
  if (_modeOn && live) live.textContent = "веди мышью или пальцем по роти — польётся сгущёнка";
  else if (!_modeOn && live && typeof phase !== "undefined" && phase === "CUT")
    live.textContent = "Проведи через конверт · длину и направление выбираешь сама";
}

function _buildButton() {
  if (document.getElementById("drizzleMode")) return;
  const gDish = document.getElementById("gDish");
  if (!gDish) return;
  const btn = document.createElement("button");
  btn.id = "drizzleMode";
  btn.textContent = "сгущёнка";
  btn.title = "Переключить режим: нарезка / сгущёнка";
  btn.addEventListener("click", () => _setMode(!_modeOn));
  const serve = document.getElementById("serveDish");
  gDish.insertBefore(btn, serve || null);
}

function drizzleRotate(angle, pivot) {
  if (!angle || !pivot || typeof rotAbout !== "function") return;
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const spin = p => rotAbout({ x: p.x, y: p.y }, pivot, cs, sn);
  for (const t of _trails) {
    for (const p of t.pts) {
      if (!p || p.break) continue;
      const q = spin(p);
      p.x = q.x;
      p.y = q.y;
    }
  }
  for (const d of _drops) {
    const q = spin(d);
    d.x = q.x;
    d.y = q.y;
  }
}

// Те же нити в чужой холст: screen(p) переводит точку блюда (с её сдвигом куска) в пиксели холста,
// k — пикселей на единицу блюда. Для снимка тетради (notebook.js): полоса варенья видна и там.
function drizzlePaint(g, screen, k) {
  if (!_trails.length || typeof dish === "undefined" || !dish) return;
  const pose = typeof dishPose === "function" ? dishPose() : { scale: 1 };
  const at = p => { const o = _shiftOf(p.face); return screen({ x: p.x + o.x, y: p.y + o.y }); };
  g.save(); g.lineJoin = "round"; g.lineCap = "round";
  for (const trail of _trails) {
    g.strokeStyle = trail.tint ? trail.tint.fill : DRIZZLE_COLOR_FILL;
    for (const seg of _segments(trail.pts)) {
      let w = 0; for (const p of seg) w += p.w;
      g.lineWidth = Math.max(2, (trail.tint ? _flatWidth() : w / seg.length * 1.6) / Math.max(1e-6, pose.scale) * k);
      g.beginPath();
      const qs = trail.tint ? _thin(seg.map(at), g.lineWidth / 2) : seg.map(at);
      qs.forEach((q, i) => { if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); });
      if (qs.length === 1) g.lineTo(qs[0].x + 0.01, qs[0].y);
      g.stroke();
    }
  }
  g.restore();
}
window.drizzlePaint = drizzlePaint;
window.drizzleRotate = drizzleRotate;
window.setDrizzleMode = _setMode;

(function hookReset() {
  if (typeof reset === "function") {
    const orig = reset;
    window.reset = function () { drizzleReset(); return orig.apply(this, arguments); };
  } else {
    window.addEventListener("load", hookReset);
  }
})();

(function hookStandInput() {
  function wrap(name) {
    const orig = window[name];
    if (typeof orig !== "function" || orig._drizzleWrap) return false;
    const wrapped = function (id, cx, cy) {
      // варенье в руке, а касание легло на радио, тетрадь или банку (shelf.js): оно идёт стенду. Слушатель стенда
      // стоит раньше нашего, поэтому вопрос задаётся и здесь, и в _onDown — кто первый, тот и спросит.
      const pass = name === "onDown" && _inDrizzlePhase() && window.drizzleTint && typeof window.drizzlePass === "function" && window.drizzlePass(cx, cy);
      if (!pass && _inDrizzlePhase()) return;
      return orig.apply(this, arguments);
    };
    wrapped._drizzleWrap = true;
    window[name] = wrapped;
    return true;
  }
  function tryWrap() {
    if (typeof window.onDown !== "function") { setTimeout(tryWrap, 50); return; }
    wrap("onDown"); wrap("onMove"); wrap("onUp");
  }
  tryWrap();
})();

(function hookPointer() {
  window.addEventListener("pointerdown",   _onDown,  { capture: true });
  window.addEventListener("pointermove",   _onMove,  { capture: true });
  window.addEventListener("pointerup",     _onUp,    { capture: true });
  window.addEventListener("pointercancel", _onUp,    { capture: true });

  // iPhone: stand.js делает preventDefault на touchstart, и pointer-события
  // часто не приходят. Ловим те же касания, что и рез.
  function touchFake(e, t, extra) {
    return {
      pointerId: "t" + t.identifier,
      button: 0,
      clientX: t.clientX,
      clientY: t.clientY,
      target: e.target,
      preventDefault() { e.preventDefault(); },
      stopImmediatePropagation() { e.stopImmediatePropagation(); },
      ...extra
    };
  }
  window.addEventListener("touchstart", e => {
    if (!_inDrizzlePhase() || _ui(e) || _active) return;
    const t = e.changedTouches[0];
    if (t) _onDown(touchFake(e, t));
  }, { capture: true, passive: false });
  window.addEventListener("touchmove", e => {
    if (!_active) return;
    for (const t of e.changedTouches) {
      if ("t" + t.identifier === _captureId) { _onMove(touchFake(e, t)); break; }
    }
  }, { capture: true, passive: false });
  window.addEventListener("touchend", e => {
    for (const t of e.changedTouches) {
      if ("t" + t.identifier === _captureId) { _onUp(touchFake(e, t)); break; }
    }
  }, { capture: true, passive: false });
  window.addEventListener("touchcancel", e => {
    for (const t of e.changedTouches) {
      if ("t" + t.identifier === _captureId) { _onUp(touchFake(e, t)); break; }
    }
  }, { capture: true, passive: false });
})();

(function buildBtn() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _buildButton);
  } else {
    setTimeout(_buildButton, 300);
  }
})();
