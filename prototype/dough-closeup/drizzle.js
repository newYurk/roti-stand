/* drizzle.js — жест налива сгущёнки.
   Подключается ПОСЛЕ stand.js. Никаких правок в stand.js не требует.

   РЕЖИМ: активируется явной кнопкой #drizzleMode в панели.
   Пока кнопка не нажата — pointer-события не перехватываются, нарезка работает штатно.
   Когда кнопка нажата (режим ON) — нарезка заморожена, ведёт сгущёнку.

   API:
     drizzleUpdate(dt)    — game-loop перед drawFrame
     drizzleDraw(ctx)     — drawFrame после рисовки теста
     drizzleReset()       — сброс (новый роти)
     drizzleEnabled       — текущее покрытие [0..1]

   Параметры художника:
     DRIZZLE_COLOR_FILL   — цвет полосы
     DRIZZLE_COLOR_DROP   — цвет капли
     DRIZZLE_COVERAGE     — порог [0..1] для разблокировки «подать» (0 = необязательно)
*/

"use strict";

const DRIZZLE_COLOR_FILL = "rgba(245, 220, 150, 0.82)";
const DRIZZLE_COLOR_DROP = "rgba(245, 215, 120, 0.58)";
const DRIZZLE_FADE_T     = 0.9;

let DRIZZLE_COVERAGE = 0.0;

// ─── состояние
let _modeOn       = false;   // кнопка #drizzleMode нажата
let _active       = false;   // pointer удерживается
let _captureId    = null;
let _trails       = [];
let _currentTrail = null;
let _drops        = [];
let _coverage     = 0;

Object.defineProperty(window, "drizzleEnabled",
  { get: () => _coverage, configurable: true });

// ─── публичный API
function drizzleReset() {
  _modeOn = false; _active = false; _captureId = null;
  _trails = []; _currentTrail = null; _drops = []; _coverage = 0;
  _syncButton();
}

function drizzleUpdate(dt) {
  for (let i = _trails.length - 1; i >= 0; i--) {
    const t = _trails[i];
    if (!_active || t !== _currentTrail) {
      t.alpha -= dt / DRIZZLE_FADE_T;
      if (t.alpha <= 0) _trails.splice(i, 1);
    }
  }
  for (let i = _drops.length - 1; i >= 0; i--) {
    _drops[i].alpha -= dt / (DRIZZLE_FADE_T * 0.7);
    if (_drops[i].alpha <= 0) _drops.splice(i, 1);
  }
  if (DRIZZLE_COVERAGE > 0) _updateServe();
}

function drizzleDraw(ctx) {
  if (!_trails.length && !_drops.length) return;
  const W = (typeof PAN_R !== "undefined" ? PAN_R : 80) * 0.038;
  ctx.save();
  ctx.lineCap   = "round";
  ctx.lineJoin  = "round";
  ctx.lineWidth = W;
  for (const trail of _trails) {
    if (trail.alpha <= 0 || trail.pts.length < 2) continue;
    ctx.globalAlpha = Math.min(1, trail.alpha);
    ctx.strokeStyle = DRIZZLE_COLOR_FILL;
    ctx.beginPath();
    const pts = trail.pts;
    ctx.moveTo(_px(pts[0].x, pts[0].y), _py(pts[0].x, pts[0].y));
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i-1].x + pts[i].x) / 2;
      const my = (pts[i-1].y + pts[i].y) / 2;
      ctx.quadraticCurveTo(
        _px(pts[i-1].x, pts[i-1].y), _py(pts[i-1].x, pts[i-1].y),
        _px(mx, my), _py(mx, my)
      );
    }
    ctx.stroke();
  }
  for (const d of _drops) {
    if (d.alpha <= 0) continue;
    ctx.globalAlpha = d.alpha;
    ctx.fillStyle   = DRIZZLE_COLOR_DROP;
    ctx.beginPath();
    ctx.arc(_px(d.x, d.y), _py(d.x, d.y), d.r * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ─── внутренние
function _px(x, y) { return typeof prX === "function" ? prX(x, y) : x; }
function _py(x, y) { return typeof prY === "function" ? prY(x, y) : y; }

function _toLocal(e) {
  const cv = document.getElementById("cv");
  if (typeof toLocal === "function") return toLocal(e.clientX, e.clientY);
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function _onDown(e) {
  if (!_modeOn) return;
  if (typeof phase !== "undefined" && phase !== "CUT") return;
  _active = true;
  _captureId = e.pointerId;
  const cv = document.getElementById("cv");
  cv && cv.setPointerCapture(e.pointerId);
  const p = _toLocal(e);
  _currentTrail = { pts: [{ x: p.x, y: p.y }], alpha: 1 };
  _trails.push(_currentTrail);
  e.stopImmediatePropagation();
  e.preventDefault();
}

function _onMove(e) {
  if (!_active || e.pointerId !== _captureId) return;
  const p    = _toLocal(e);
  const last = _currentTrail.pts[_currentTrail.pts.length - 1];
  if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
  _currentTrail.pts.push({ x: p.x, y: p.y });
  if (Math.random() < 0.12) {
    const r = (typeof PAN_R !== "undefined" ? PAN_R : 80) * 0.013;
    _drops.push({
      x: p.x + (Math.random() - 0.5) * r * 3,
      y: p.y + (Math.random() - 0.5) * r * 3,
      r, alpha: 0.7 + Math.random() * 0.3
    });
  }
  _recalc();
  e.stopImmediatePropagation();
}

function _onUp(e) {
  if (e.pointerId !== _captureId) return;
  _active = false; _captureId = null; _currentTrail = null;
}

function _recalc() {
  let total = 0;
  for (const t of _trails) {
    const pts = t.pts;
    for (let i = 1; i < pts.length; i++)
      total += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  }
  const ref = (typeof PAN_R !== "undefined" ? PAN_R : 80) * 0.22 * 2;
  _coverage = Math.min(1, total / (ref * 1.8));
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

// ─── кнопка-переключатель
function _buildButton() {
  if (document.getElementById("drizzleMode")) return;
  const gDish = document.getElementById("gDish");
  if (!gDish) return;
  const btn = document.createElement("button");
  btn.id = "drizzleMode";
  btn.textContent = "сгущёнка";
  btn.title = "Переключить режим: нарезка / сгущёнка";
  btn.addEventListener("click", () => {
    _modeOn = !_modeOn;
    _syncButton();
    const live = document.getElementById("live");
    if (_modeOn && live) live.textContent = "веди пальцем по роти — польётся сгущёнка";
  });
  // вставить перед «подать»
  const serve = document.getElementById("serveDish");
  gDish.insertBefore(btn, serve || null);
}

// ─── хук reset
(function hookReset() {
  if (typeof reset === "function") {
    const _orig = reset;
    window.reset = function() { drizzleReset(); return _orig.apply(this, arguments); };
  } else {
    window.addEventListener("load", hookReset);
  }
})();

// ─── pointer-события на canvas
(function hookPointer() {
  const cv = document.getElementById("cv");
  if (!cv) { window.addEventListener("load", hookPointer); return; }
  cv.addEventListener("pointerdown",   _onDown,  { capture: true });
  cv.addEventListener("pointermove",   _onMove,  { capture: true });
  cv.addEventListener("pointerup",     _onUp,    { capture: true });
  cv.addEventListener("pointercancel", _onUp,    { capture: true });
})();

// ─── хук game-loop + drawFrame
(function hookLoop() {
  let lastT = 0;
  const _raf = window.requestAnimationFrame;
  let patched = false;

  function patchRAF() {
    if (patched) return;
    patched = true;
    window.requestAnimationFrame = function(cb) {
      return _raf.call(window, function(t) {
        const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0;
        lastT = t;
        drizzleUpdate(dt);
        return cb(t);
      });
    };
  }

  function tryHook() {
    if (typeof window.drawFrame !== "function") { setTimeout(tryHook, 200); return; }
    const _orig = window.drawFrame;
    window.drawFrame = function() {
      _orig.apply(this, arguments);
      const cv  = document.getElementById("cv");
      const ctx = cv && cv.getContext("2d");
      if (ctx) drizzleDraw(ctx);
    };
    patchRAF();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", tryHook)
    : tryHook();
})();

// ─── кнопка в панели
(function buildBtn() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _buildButton);
  } else {
    // gDish может быть ещё hidden — ждём немного
    setTimeout(_buildButton, 300);
  }
})();
