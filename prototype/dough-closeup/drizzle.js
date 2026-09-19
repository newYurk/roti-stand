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
*/

"use strict";

const DRIZZLE_COLOR_FILL = "rgba(245, 226, 168, 0.92)";
const DRIZZLE_COLOR_WET  = "rgba(255, 244, 210, 0.45)";
const DRIZZLE_COLOR_DROP = "rgba(236, 208, 138, 0.78)";
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
let _coverage     = 0;
let _samples      = [];
let _coast        = null;
let _cardDone     = false;

Object.defineProperty(window, "drizzleEnabled",
  { get: () => _coverage, configurable: true });
Object.defineProperty(window, "drizzleModeOn",
  { get: () => _modeOn, configurable: true });

function drizzleReset() {
  _modeOn = false; _active = false; _captureId = null;
  _trails = []; _currentTrail = null; _drops = []; _coverage = 0;
  _samples = []; _coast = null; _cardDone = false;
  const body = document.getElementById("cardBody");
  if (body) delete body.dataset.drizzle;
  _syncButton();
}

function drizzleUpdate(dt) {
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
      if (Math.random() < 0.08) _bead(_coast.x, _coast.y, pan);
    }
  }

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
  if (DRIZZLE_COVERAGE > 0) _updateServe();
}

function drizzleDraw(ctx) {
  if (!_trails.length && !_drops.length) return;
  const tilt = typeof TILT === "number" ? TILT : 0.56;
  ctx.save();
  for (const trail of _trails) {
    const pts = trail.pts;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const sx = _px(p.x, p.y), sy = _py(p.x, p.y);
      ctx.globalAlpha = trail.wet;
      ctx.fillStyle = DRIZZLE_COLOR_FILL;
      ctx.beginPath();
      ctx.ellipse(sx, sy, p.w, p.w * tilt, 0, 0, Math.PI * 2);
      ctx.fill();
      if (trail.wet > 0.88) {
        ctx.globalAlpha = (trail.wet - 0.88) * 3.2;
        ctx.fillStyle = DRIZZLE_COLOR_WET;
        ctx.beginPath();
        ctx.ellipse(sx - p.w * 0.2, sy - p.w * tilt * 0.25, p.w * 0.38, p.w * tilt * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  for (const d of _drops) {
    ctx.globalAlpha = d.alpha;
    ctx.fillStyle = DRIZZLE_COLOR_DROP;
    const sx = _px(d.x, d.y), sy = _py(d.x, d.y);
    ctx.beginPath();
    ctx.ellipse(sx, sy, d.r, d.r * tilt, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
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
  const k = Math.max(0.45, Math.min(2.4, ref / Math.max(sp, pan * 0.15)));
  return pan * 0.026 * k;
}

function _stamp(trail, x, y, sp) {
  const w = _widthForSpeed(sp);
  const last = trail.pts[trail.pts.length - 1];
  if (last) {
    const dist = Math.hypot(x - last.x, y - last.y);
    const step = Math.max(w * STEP_FRAC, 0.8);
    if (dist < step) return;
    const n = Math.min(8, Math.floor(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      trail.pts.push({
        x: last.x + (x - last.x) * t,
        y: last.y + (y - last.y) * t,
        w: last.w + (w - last.w) * t
      });
    }
  }
  trail.pts.push({ x, y, w });
  _recalc();
}

function _bead(x, y, pan) {
  const r = pan * (0.008 + Math.random() * 0.01);
  _drops.push({
    x: x + (Math.random() - 0.5) * r * 4,
    y: y + (Math.random() - 0.5) * r * 4,
    r, alpha: 0.62 + Math.random() * 0.25
  });
}

function _inDrizzlePhase() {
  return _modeOn && typeof phase !== "undefined" && phase === "CUT";
}

function _onDown(e) {
  if (!_inDrizzlePhase()) return;
  if (typeof dish !== "undefined" && dish && dish.mode === "served") return;
  _active = true;
  _captureId = e.pointerId;
  _coast = null;
  const cv = document.getElementById("cv");
  try { cv && cv.setPointerCapture(e.pointerId); } catch (err) {}
  const p = _pt(e);
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  _samples = [{ x: p.x, y: p.y, t: now }];
  _currentTrail = { pts: [], wet: 1, settling: false };
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
  if (Math.random() < 0.1) _bead(p.x, p.y, typeof PAN_R === "number" ? PAN_R : 80);
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
  if (_currentTrail && _currentTrail.pts.length) {
    const v = _velocity();
    const pan = typeof PAN_R === "number" ? PAN_R : 80;
    const last = _currentTrail.pts[_currentTrail.pts.length - 1];
    if (Math.hypot(v.vx, v.vy) > pan * 0.5) {
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
    const pts = t.pts;
    for (let i = 1; i < pts.length; i++)
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
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
  const btn = document.getElementById("serveDish");
  if (!btn) return;
  const ok = _coverage >= DRIZZLE_COVERAGE;
  if (ok && !btn.hidden) btn.disabled = false;
  if (ok && !btn._drizzleTip) {
    btn._drizzleTip = true;
    const live = document.getElementById("live");
    if (live) live.textContent = "Сгущёнка налита · нажми «подать»";
  }
}

function _syncButton() {
  const b = document.getElementById("drizzleMode");
  if (!b) return;
  b.classList.toggle("on", _modeOn);
  b.textContent = _modeOn ? "сгущёнка ✓" : "сгущёнка";
}

function _setMode(on) {
  _modeOn = !!on;
  if (!_modeOn) {
    _active = false; _captureId = null; _coast = null; _currentTrail = null;
  }
  _syncButton();
  const live = document.getElementById("live");
  if (_modeOn && live) live.textContent = "веди пальцем по роти — польётся сгущёнка";
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
    const wrapped = function () {
      if (_inDrizzlePhase()) return;
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
  const cv = document.getElementById("cv");
  if (!cv) { window.addEventListener("load", hookPointer); return; }
  cv.addEventListener("pointerdown",   _onDown,  { capture: true });
  cv.addEventListener("pointermove",   _onMove,  { capture: true });
  cv.addEventListener("pointerup",     _onUp,    { capture: true });
  cv.addEventListener("pointercancel", _onUp,    { capture: true });
})();

(function hookLoop() {
  let lastT = 0;
  const raf = window.requestAnimationFrame;
  let patched = false;
  function patchRAF() {
    if (patched) return;
    patched = true;
    window.requestAnimationFrame = function (cb) {
      return raf.call(window, function (t) {
        const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0;
        lastT = t;
        drizzleUpdate(dt);
        return cb(t);
      });
    };
  }
  function tryHook() {
    if (typeof window.drawFrame !== "function") { setTimeout(tryHook, 200); return; }
    const orig = window.drawFrame;
    window.drawFrame = function () {
      orig.apply(this, arguments);
      const cv = document.getElementById("cv");
      const ctx = cv && cv.getContext("2d");
      if (ctx) drizzleDraw(ctx);
    };
    patchRAF();
  }
  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", tryHook)
    : tryHook();
})();

(function buildBtn() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _buildButton);
  } else {
    setTimeout(_buildButton, 300);
  }
})();
