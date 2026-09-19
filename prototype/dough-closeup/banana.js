/* banana.js — жест сыпки банана на пожаренный лист.
   Подключается ПОСЛЕ stand.js. Никаких правок в stand.js не требует.

   Когда работает:
     Фаза PAN, dish.mode === "fold" (лист уже на таве, ещё не перешёл к нарезке).
     Игрок ведёт пальцем по тесту — дольки ложатся за пальцем, потом тают.
     После достаточного покрытия кнопка «к нарезке» разблокируется.

   API:
     bananaSprinkleUpdate(dt)    — вызывать из game-loop
     bananaSprinkleDraw(ctx)     — вызывать из drawFrame после теста
     bananaSprinkleReset()       — сброс (новый роти)
     bananaSprinkleCoverage      — текущее покрытие [0..1]

   BANANA_COVERAGE (default 0) — порог для разблокировки кнопки «к нарезке».
   0 — банан декоративный, не обязательный.
*/

"use strict";

// ─────────────────────────── параметры

// Цвет дольки: жёлто-кремовый, тёплый.
// Два цвета — наружная жареная корочка + светлая мякоть.
const BANANA_OUTER   = "rgba(220, 185, 90, 0.90)";
const BANANA_INNER   = "rgba(245, 225, 145, 0.70)";
const BANANA_FADE_T  = 1.4;   // секунд fade-out дольки
const BANANA_SLIDE   = 0.18;  // долька скользит вниз (в PAN_R) пока тает

// Порог покрытия [0..1] — при достижении разблокирует кнопку «к нарезке».
// 0 — банан декоративный, не обязательный.
let BANANA_COVERAGE  = 0.0;

// ─────────────────────────── состояние

// chunk: { x, y, r, vx, vy, alpha }  — одна долька/кружок
let chunks = [];
let bananaCoverage = 0;

Object.defineProperty(window, "bananaSprinkleCoverage", { get: () => bananaCoverage, configurable: true });

// ─────────────────────────── API

function bananaSprinkleReset() {
  chunks = []; bananaCoverage = 0;
}

/**
 * Обновить дольки: падают, скользят, тают.
 * dt — секунды.
 */
function bananaSprinkleUpdate(dt) {
  const slide = (typeof PAN_R !== "undefined" ? PAN_R : 80) * BANANA_SLIDE * dt;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    // Скольжение: долька постепенно замедляется (vx уменьшается).
    c.x  += c.vx * slide;
    c.y  += c.vy * slide;
    c.vx *= 0.82;
    c.vy *= 0.82;
    c.alpha -= dt / BANANA_FADE_T;
    if (c.alpha <= 0) { chunks.splice(i, 1); }
  }
  if (BANANA_COVERAGE > 0) _updateCutButton();
}

/**
 * Нарисовать дольки банана.
 * Рисовать ПОСЛЕ теста, ДО карточки.
 */
function bananaSprinkleDraw(ctx) {
  if (!chunks.length) return;
  ctx.save();
  for (const c of chunks) {
    if (c.alpha <= 0) continue;
    const sx = prX(c.x, c.y);
    const sy = prY(c.x, c.y);
    const r  = c.r;
    ctx.globalAlpha = Math.min(1, c.alpha);
    // Корочка: овал сплющен в TILT раз, как всё на столе.
    ctx.beginPath();
    ctx.ellipse(sx, sy, r, r * TILT, 0, 0, Math.PI * 2);
    ctx.fillStyle = BANANA_OUTER;
    ctx.fill();
    // Светлая мякоть внутри
    ctx.beginPath();
    ctx.ellipse(sx - r * 0.2, sy - r * TILT * 0.2, r * 0.45, r * TILT * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = BANANA_INNER;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ─────────────────────────── внутренние функции

/**
 * Роняем дольки в точке (x, y) в координатах стола.
 * n — количество долек; по умолчанию 4–6.
 */
function _spawnChunks(x, y, n) {
  const baseR = (typeof PAN_R !== "undefined" ? PAN_R : 80) * 0.022;
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.6 + Math.random() * 0.8;
    chunks.push({
      x, y,
      r:  baseR * (0.6 + Math.random() * 0.8),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 0.85 + Math.random() * 0.15,
    });
  }
  // Пересчитываем покрытие: количество долек / норма (= диагональ блюда / 2×baseR).
  const ref = (typeof PAN_R !== "undefined" ? PAN_R : 80) * 0.22 * 2 / (baseR * 2);
  bananaCoverage = Math.min(1, chunks.length / ref);
}

// Разблокировать / заблокировать кнопку «к нарезке».
function _updateCutButton() {
  const btn = document.getElementById("cutMode");
  if (!btn) return;
  // stand.js сам управляет disabled кнопки; мы только добавляем свою блокировку.
  const covered = bananaCoverage >= BANANA_COVERAGE;
  // Снимаем / вешаем атрибут data-banana-locked.
  if (covered) {
    btn.removeAttribute("data-banana-locked");
  } else {
    btn.setAttribute("data-banana-locked", "1");
    btn.disabled = true;
  }
  if (covered && btn._bananaTip !== true) {
    btn._bananaTip = true;
    const live = document.getElementById("live");
    if (live) live.textContent = "Банан на месте · можно к нарезке";
  }
}

// ─────────────────────────── хуки

// 1. reset()
(function hookReset() {
  if (typeof reset === "function") {
    const _orig = reset;
    window.reset = function () {
      bananaSprinkleReset();
      return _orig.apply(this, arguments);
    };
  } else { document.addEventListener("DOMContentLoaded", hookReset); }
})();

// 2. pointerdown в фазе PAN / fold: отслеживаем pointermove и роняем дольки.
(function hookPointer() {
  const cv = document.getElementById("cv");
  if (!cv) { document.addEventListener("DOMContentLoaded", hookPointer); return; }

  function toLocalB(e) {
    if (typeof toLocal === "function") return toLocal(e.clientX, e.clientY);
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  let captureId = null;
  let lastPt    = null;
  // Шаг выборки долек: 1 долька на каждые ~16 px пути.
  const STEP_PX = 16;
  let accDist   = 0;

  function _inBananaPhase() {
    return typeof phase !== "undefined" && phase === "PAN" &&
           typeof dish   !== "undefined" && dish && dish.mode === "fold";
  }

  cv.addEventListener("pointerdown", function(e) {
    if (!_inBananaPhase()) return;
    // Не перехватываем событие — жесты переворота должны работать.
    captureId = e.pointerId;
    lastPt    = toLocalB(e);
    accDist   = 0;
  }, { capture: false });

  cv.addEventListener("pointermove", function(e) {
    if (!_inBananaPhase() || e.pointerId !== captureId || !lastPt) return;
    const p  = toLocalB(e);
    const dx = p.x - lastPt.x, dy = p.y - lastPt.y;
    const d  = Math.hypot(dx, dy);
    accDist += d;
    // Роняем дольки по достижении STEP_PX, пропорционально скорости.
    while (accDist >= STEP_PX) {
      accDist -= STEP_PX;
      // Позиция — след пальца, небольшой разброс.
      _spawnChunks(
        lastPt.x + (p.x - lastPt.x) * (accDist / d || 0) + (Math.random() - 0.5) * STEP_PX * 0.5,
        lastPt.y + (p.y - lastPt.y) * (accDist / d || 0) + (Math.random() - 0.5) * STEP_PX * 0.5,
        4 + Math.floor(Math.random() * 3)   // 4–6 долек
      );
    }
    lastPt = p;
  }, { capture: false });

  cv.addEventListener("pointerup",     function(e) { if (e.pointerId === captureId) { captureId = null; lastPt = null; } }, { capture: false });
  cv.addEventListener("pointercancel", function(e) { if (e.pointerId === captureId) { captureId = null; lastPt = null; } }, { capture: false });
})();

// 3. Хук в RAF (тот же паттерн, что в drizzle.js — если drizzle.js уже перехватил, банан встаёт после него).
(function hookLoop() {
  const _raf = window.requestAnimationFrame;
  let lastT = 0;
  window.requestAnimationFrame = function(cb) {
    return _raf.call(window, function(t) {
      const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0;
      lastT = t;
      bananaSprinkleUpdate(dt);
      return cb(t);
    });
  };
})();

// 4. Хук в drawFrame.
(function hookDrawFrame() {
  if (typeof drawFrame === "function") {
    const _orig = drawFrame;
    window.drawFrame = function() {
      _orig.apply(this, arguments);
      const ctx = document.getElementById("cv") && document.getElementById("cv").getContext("2d");
      if (ctx) bananaSprinkleDraw(ctx);
    };
  } else { document.addEventListener("DOMContentLoaded", hookDrawFrame); }
})();

/* ─────────────────────────── ПОРЯДОК СКРИПТОВ в index.html

   <script src="stand.js?v=2026-09-17-canal-41"></script>
   <script src="counter-item.js?v=2026-09-19"></script>
   <script src="drizzle.js?v=2026-09-19"></script>
   <script src="banana.js?v=2026-09-19"></script>   ← в конце

   Чтобы банан стал обязательным:
     BANANA_COVERAGE = 0.30;   // игрок должен покрыть хотя бы 30 % поверхности

   С BANANA_COVERAGE = 0 (default) банан декоративный — дольки сыпются, но
   кнопка «к нарезке» не заблокирована.
*/
