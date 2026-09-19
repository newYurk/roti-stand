/* drizzle.js — жест налива сгущёнки.
   Подключается ПОСЛЕ stand.js. Никаких правок в stand.js не требует.

   Когда работает:
     Фаза CUT (роти нарезано, но ещё не подано).
     Игрок ведёт пальцем/мышью по тесту — полоса следа, капли.
     После достаточного покрытия кнопка «подать» разблокируется.

   API:
     drizzlePointerDown(p)   — pointerdown в фазе CUT
     drizzlePointerMove(p)   — pointermove если active
     drizzlePointerUp()      — pointerup/pointercancel
     drizzleUpdate(dt)       — game-loop перед drawFrame
     drizzleDraw(ctx)        — drawFrame после рисовки теста
     drizzleReset()          — сброс (новый роти)
     drizzleEnabled          — текущая покрытость [0..1]

   Параметры художника:
     DRIZZLE_COLOR_FILL  — цвет сгущёнки (fill)
     DRIZZLE_COLOR_DROP  — цвет капли
     DRIZZLE_COVERAGE    — порог покрытия [0..1] для разблокировки serveDish
*/

"use strict";

// ─────────────────────────── параметры
const DRIZZLE_COLOR_FILL = "rgba(245, 220, 150, 0.82)";
const DRIZZLE_COLOR_DROP = "rgba(245, 215, 120, 0.58)";
const DRIZZLE_FADE_T     = 0.9;   // fade-out завершённой полосы, с

let DRIZZLE_COVERAGE = 0.0;       // 0 = необязательна

// ─────────────────────────── состояние
let drizzleActive   = false;
let trails          = [];         // [{pts:[{x,y}...], alpha}]
let currentTrail    = null;
let drops           = [];         // [{x,y,r,alpha}]
let drizzleCoverage = 0;

Object.defineProperty(window, "drizzleEnabled",
  { get: () => drizzleCoverage, configurable: true });

// ─────────────────────────── API
function drizzleReset() {
  drizzleActive = false;
  trails = []; currentTrail = null; drops = []; drizzleCoverage = 0;
}

function drizzlePointerDown(p) {
  if (typeof phase === "undefined" || phase !== "CUT") return false;
  if (DRIZZLE_COVERAGE > 0 && drizzleCoverage >= DRIZZLE_COVERAGE) return false;
  drizzleActive = true;
  currentTrail = { pts: [{ x: p.x, y: p.y }], alpha: 1 };
  trails.push(currentTrail);
  return true;
}

function drizzlePointerMove(p) {
  if (!drizzleActive || !currentTrail) return;
  const last = currentTrail.pts[currentTrail.pts.length - 1];
  if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
  currentTrail.pts.push({ x: p.x, y: p.y });
  if (Math.random() < 0.12) {
    const r = (typeof PAN_R !== "undefined" ? PAN_R : 80) * 0.013;
    drops.push({
      x: p.x + (Math.random() - 0.5) * r * 3,
      y: p.y + (Math.random() - 0.5) * r * 3,
      r, alpha: 0.7 + Math.random() * 0.3
    });
  }
  _recalcCoverage();
}

function drizzlePointerUp() {
  if (!drizzleActive) return;
  drizzleActive = false;
  currentTrail  = null;
}

function drizzleUpdate(dt) {
  for (let i = trails.length - 1; i >= 0; i--) {
    const t = trails[i];
    if (!drizzleActive || t !== currentTrail) {
      t.alpha -= dt / DRIZZLE_FADE_T;
      if (t.alpha <= 0) trails.splice(i, 1);
    }
  }
  for (let i = drops.length - 1; i >= 0; i--) {
    drops[i].alpha -= dt / (DRIZZLE_FADE_T * 0.7);
    if (drops[i].alpha <= 0) drops.splice(i, 1);
  }
  if (DRIZZLE_COVERAGE > 0) _updateServeButton();
}

function drizzleDraw(ctx) {
  if (!trails.length && !drops.length) return;
  const W = (typeof PAN_R !== "undefined" ? PAN_R : 80) * 0.038;
  ctx.save();
  ctx.lineCap   = "round";
  ctx.lineJoin  = "round";
  ctx.lineWidth = W;
  for (const trail of trails) {
    if (trail.alpha <= 0 || trail.pts.length < 2) continue;
    ctx.globalAlpha = Math.min(1, trail.alpha);
    ctx.strokeStyle = DRIZZLE_COLOR_FILL;
    ctx.beginPath();
    const pts = trail.pts;
    ctx.moveTo(prX(pts[0].x, pts[0].y), prY(pts[0].x, pts[0].y));
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i-1].x + pts[i].x) / 2;
      const my = (pts[i-1].y + pts[i].y) / 2;
      ctx.quadraticCurveTo(
        prX(pts[i-1].x, pts[i-1].y), prY(pts[i-1].x, pts[i-1].y),
        prX(mx, my), prY(mx, my)
      );
    }
    ctx.stroke();
  }
  for (const d of drops) {
    if (d.alpha <= 0) continue;
    ctx.globalAlpha = d.alpha;
    ctx.fillStyle   = DRIZZLE_COLOR_DROP;
    ctx.beginPath();
    ctx.arc(prX(d.x, d.y), prY(d.x, d.y), d.r * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ─────────────────────────── внутренние
function _recalcCoverage() {
  let total = 0;
  for (const trail of trails) {
    const pts = trail.pts;
    for (let i = 1; i < pts.length; i++)
      total += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  }
  const ref = (typeof PAN_R !== "undefined" ? PAN_R : 80) * 0.22 * 2;
  drizzleCoverage = Math.min(1, total / (ref * 1.8));
}

function _updateServeButton() {
  const btn = document.getElementById("serveDish");
  if (!btn) return;
  const covered = drizzleCoverage >= DRIZZLE_COVERAGE;
  if (covered && !btn.hidden) btn.disabled = false;
  if (covered && !btn._drizzleTip) {
    btn._drizzleTip = true;
    const live = document.getElementById("live");
    if (live) live.textContent = "Сгущёнка налита · нажми «подать»";
  }
}

// ─────────────────────────── хук reset
(function hookReset() {
  if (typeof reset === "function") {
    const _orig = reset;
    window.reset = function () { drizzleReset(); return _orig.apply(this, arguments); };
  } else {
    window.addEventListener("load", hookReset);
  }
})();

// ─────────────────────────── хуки pointer
(function hookPointer() {
  const cv = document.getElementById("cv");
  if (!cv) { window.addEventListener("load", hookPointer); return; }

  function toLocalDrizzle(e) {
    if (typeof toLocal === "function") return toLocal(e.clientX, e.clientY);
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  let captureId = null;

  cv.addEventListener("pointerdown", function(e) {
    if (typeof phase === "undefined" || phase !== "CUT") return;
    const p = toLocalDrizzle(e);
    if (drizzlePointerDown(p)) {
      captureId = e.pointerId;
      cv.setPointerCapture(e.pointerId);
      e.stopImmediatePropagation();
    }
  }, { capture: true });

  cv.addEventListener("pointermove", function(e) {
    if (!drizzleActive || e.pointerId !== captureId) return;
    drizzlePointerMove(toLocalDrizzle(e));
  }, { capture: true });

  cv.addEventListener("pointerup",
    function(e) { if (e.pointerId === captureId) { drizzlePointerUp(); captureId = null; } },
    { capture: true });
  cv.addEventListener("pointercancel",
    function(e) { if (e.pointerId === captureId) { drizzlePointerUp(); captureId = null; } },
    { capture: true });
})();

// ─────────────────────────── хук game-loop + drawFrame
//
// stand.js может зарегистрировать drawFrame внутри DOMContentLoaded или load,
// поэтому ждём её появления в window через setTimeout(200мс).
// RAF патчим только после того, как drawFrame найдена.
(function hookLoop() {
  let lastT = 0;
  const _raf = window.requestAnimationFrame;
  let rafPatched = false;

  function patchRAF() {
    if (rafPatched) return;
    rafPatched = true;
    window.requestAnimationFrame = function(cb) {
      return _raf.call(window, function(t) {
        const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0;
        lastT = t;
        drizzleUpdate(dt);
        return cb(t);
      });
    };
  }

  function tryHookDrawFrame() {
    if (typeof window.drawFrame !== "function") {
      setTimeout(tryHookDrawFrame, 200);
      return;
    }
    const _orig = window.drawFrame;
    window.drawFrame = function() {
      _orig.apply(this, arguments);
      const cv = document.getElementById("cv");
      const ctx = cv && cv.getContext("2d");
      if (ctx) drizzleDraw(ctx);
    };
    patchRAF();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryHookDrawFrame);
  } else {
    tryHookDrawFrame();
  }
})();
