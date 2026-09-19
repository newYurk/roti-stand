/* drizzle.js — жест налива сгущёнки.
   Подключается ПОСЛЕ stand.js. Никаких правок в stand.js не требует.

   Когда работает:
     Фаза CUT (роти нарезано, но ещё не подано).
     Игрок ведёт пальцем/мышью по тесту — полоса следа, капли.
     После достаточного покрытия кнопка «подать» разблокируется.

   API:
     drizzlePointerDown(p)   — вызывать из pointerdown в фазе CUT
     drizzlePointerMove(p)   — вызывать из pointermove если active
     drizzlePointerUp()      — вызывать из pointerup/pointercancel
     drizzleUpdate(dt)       — вызывать из game-loop перед drawFrame
     drizzleDraw(ctx)        — вызывать из drawFrame после рисовки теста
     drizzleReset()          — сброс (новый роти)
     drizzleEnabled          — текущая покрытость [0..1]; serveDish можно читать для unlock-логики

   Параметры художника:
     DRIZZLE_COLOR_FILL  — цвет сгущёнки (fill)
     DRIZZLE_COLOR_DROP  — цвет капли (opacity < fill)
     DRIZZLE_TRAIL_W     — ширина полосы в px (scale от PAN_R)
     DRIZZLE_COVERAGE    — порог покрытия [0..1] для разблокировки serveDish
*/

"use strict";

// ─────────────────────────── параметры

// Цвет сгущёнки (тёплый кремовый) — в стиле палитры var(--hot) = #d98b3a
const DRIZZLE_COLOR_FILL = "rgba(245, 220, 150, 0.82)";
const DRIZZLE_COLOR_DROP = "rgba(245, 215, 120, 0.58)";
const DRIZZLE_FADE_T    = 0.9;    // время fade-out полосы после подъёма, с

// Порог покрытия [0..1] — при достижении разблокирует кнопка «подать».
// 0 — сгущёнка необязательна (кнопка всегда активна).
let DRIZZLE_COVERAGE    = 0.0;

// ─────────────────────────── состояние

let drizzleActive   = false;    // палец нажат
// trails: [{ pts:[{x,y},...], alpha }]  — каждый подъём/опускание = новая полоса
let trails          = [];
let currentTrail    = null;
let drops           = [];       // [{x,y,r,alpha}] — капли, отрывающиеся от полосы
let drizzleCoverage = 0;        // текущая покрытость [0..1]

// Публичный read-only аксессор для stand.js
Object.defineProperty(window, "drizzleEnabled", { get: () => drizzleCoverage, configurable: true });

// ─────────────────────────── API

function drizzleReset() {
  drizzleActive = false;
  trails = []; currentTrail = null; drops = []; drizzleCoverage = 0;
}

/**
 * Обработать pointerdown в фазе CUT.
 * p — {x, y} в координатах стола (toLocal).
 * Возвращает true если событие поглощено.
 */
function drizzlePointerDown(p) {
  if (typeof phase === "undefined" || phase !== "CUT") return false;
  if (drizzleCoverage >= DRIZZLE_COVERAGE && DRIZZLE_COVERAGE > 0) return false;
  drizzleActive = true;
  currentTrail = { pts: [{ x: p.x, y: p.y }], alpha: 1 };
  trails.push(currentTrail);
  return true;
}

function drizzlePointerMove(p) {
  if (!drizzleActive || !currentTrail) return;
  const last = currentTrail.pts[currentTrail.pts.length - 1];
  const dx = p.x - last.x, dy = p.y - last.y;
  if (Math.hypot(dx, dy) < 2) return;    // фильтр мелких движений
  currentTrail.pts.push({ x: p.x, y: p.y });

  // Спорадически отрываем каплю
  if (Math.random() < 0.12) {
    const r = (typeof PAN_R !== "undefined" ? PAN_R : 80) * 0.013;
    drops.push({ x: p.x + (Math.random() - 0.5) * r * 3,
                 y: p.y + (Math.random() - 0.5) * r * 3,
                 r, alpha: 0.7 + Math.random() * 0.3 });
  }

  // Пересчитываем покрытие: суммарная длина всех полос / длина диагонали блюда
  _recalcCoverage();
}

function drizzlePointerUp() {
  if (!drizzleActive) return;
  drizzleActive = false;
  currentTrail = null;
  // Полоса начинает таять: alpha уменьшается в drizzleUpdate()
  // (trails с ptми остаются для draw пока alpha > 0).
}

/**
 * Обновить анимацию.
 * dt — секунды.
 */
function drizzleUpdate(dt) {
  // Активная полоса не тает — только завершённые.
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

  // Проверяем unlock кнопки serve
  if (DRIZZLE_COVERAGE > 0) _updateServeButton();
}

/**
 * Нарисовать все полосы и капли.
 * Рисовать ПОСЛЕ теста, ДО карточки.
 */
function drizzleDraw(ctx) {
  if (!trails.length && !drops.length) return;

  const W = (typeof PAN_R !== "undefined" ? PAN_R : 80) * 0.038;   // ширина полосы

  ctx.save();
  ctx.lineCap  = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = W;

  for (const trail of trails) {
    if (trail.alpha <= 0 || trail.pts.length < 2) continue;
    ctx.globalAlpha = Math.min(1, trail.alpha);
    ctx.strokeStyle = DRIZZLE_COLOR_FILL;
    ctx.beginPath();
    const pts = trail.pts;
    ctx.moveTo(prX(pts[0].x, pts[0].y), prY(pts[0].x, pts[0].y));
    for (let i = 1; i < pts.length; i++) {
      // сглаженная кривая через среднее двух соседних точек
      const mx = (pts[i-1].x + pts[i].x) / 2;
      const my = (pts[i-1].y + pts[i].y) / 2;
      ctx.quadraticCurveTo(
        prX(pts[i-1].x, pts[i-1].y), prY(pts[i-1].x, pts[i-1].y),
        prX(mx, my), prY(mx, my)
      );
    }
    ctx.stroke();
  }

  // Капли
  for (const d of drops) {
    if (d.alpha <= 0) continue;
    ctx.globalAlpha = d.alpha;
    ctx.fillStyle = DRIZZLE_COLOR_DROP;
    ctx.beginPath();
    ctx.arc(prX(d.x, d.y), prY(d.x, d.y), d.r * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

// ─────────────────────────── внутренние функции

// Считаем покрытие: сумма длин всех активных треков / диагональ боундинг-бокса блюда.
function _recalcCoverage() {
  let totalLen = 0;
  for (const trail of trails) {
    const pts = trail.pts;
    for (let i = 1; i < pts.length; i++) {
      totalLen += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
    }
  }
  // Ориентир: длина диагонали блюда ≈ 2*PAN_R*0,22 (полное покрытие).
  const ref = (typeof PAN_R !== "undefined" ? PAN_R : 80) * 0.22 * 2;
  drizzleCoverage = Math.min(1, totalLen / (ref * 1.8));  // 1.8 — немного запаса
}

// Разблокировать / заблокировать кнопку «подать».
function _updateServeButton() {
  const btn = document.getElementById("serveDish");
  if (!btn) return;
  const covered = drizzleCoverage >= DRIZZLE_COVERAGE;
  btn.disabled = !covered || btn.hidden;   // stand.js оставляет прочие условия
  if (covered && btn._drizzleTip !== true) {
    btn._drizzleTip = true;
    // Обновляем подсказку (поле #live есть в index.html)
    const live = document.getElementById("live");
    if (live) live.textContent = "Сгущёнка налита · нажми «подать»";
  }
}

// ─────────────────────────── хуки в stand.js

// 1. Хук в reset(): сбрасываем состояние при каждом новом роти.
(function hookReset() {
  if (typeof reset === "function") {
    const _origReset = reset;
    window.reset = function () {
      drizzleReset();
      return _origReset.apply(this, arguments);
    };
  } else {
    document.addEventListener("DOMContentLoaded", hookReset);
  }
})();

// 2. Хук в pointerdown: если фаза CUT и нажатие на canvas — перехватываем.
// stand.js вешает свой листенер на cv (canvas), поэтому перехватываем через capture.
(function hookPointer() {
  const cv = document.getElementById("cv");
  if (!cv) { document.addEventListener("DOMContentLoaded", hookPointer); return; }

  // toLocal определён в stand.js и доступен глобально.
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
      e.stopImmediatePropagation();   // не пускаем к гесту нарезки
    }
  }, { capture: true });

  cv.addEventListener("pointermove", function(e) {
    if (!drizzleActive || e.pointerId !== captureId) return;
    drizzlePointerMove(toLocalDrizzle(e));
  }, { capture: true });

  cv.addEventListener("pointerup",     function(e) { if (e.pointerId === captureId) { drizzlePointerUp(); captureId = null; } }, { capture: true });
  cv.addEventListener("pointercancel", function(e) { if (e.pointerId === captureId) { drizzlePointerUp(); captureId = null; } }, { capture: true });
})();

// 3. Хук в game-loop: (ищем requestAnimationFrame)
//    stand.js вызывает requestAnimationFrame(те же loop внутри); перехватываем.
(function hookLoop() {
  const _raf = window.requestAnimationFrame;
  let lastT = 0;
  window.requestAnimationFrame = function(cb) {
    return _raf.call(window, function(t) {
      const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0;
      lastT = t;
      drizzleUpdate(dt);
      return cb(t);
    });
  };
})();

// 4. Хук в drawFrame: (stand.js содержит function drawFrame(),
//    перехватываем её и вставляем вызов drizzleDraw после теста.)
(function hookDrawFrame() {
  if (typeof drawFrame === "function") {
    const _origDraw = drawFrame;
    window.drawFrame = function() {
      _origDraw.apply(this, arguments);
      const ctx = document.getElementById("cv") && document.getElementById("cv").getContext("2d");
      if (ctx) drizzleDraw(ctx);
    };
  } else {
    // drawFrame ещё не определён — попробуем после загрузки.
    document.addEventListener("DOMContentLoaded", hookDrawFrame);
  }
})();

/* ─────────────────────────── ИСПОЛЬЗОВАНИЕ

   Чтобы сгущёнка была обязательной, в HTML (или запускающем коде) установи порог:

     DRIZZLE_COVERAGE = 0.25;   // игрок должен покрыть хотя бы 25 % пути

   С DRIZZLE_COVERAGE = 0 (default) кнопка «подать» работает без ограничений
   (сгущёнка добровольна, не обязательна).

   В index.html добавить после stand.js:

     <script src="drizzle.js?v=2026-09-19"></script>

   Цвет (#d98b3a = var(--hot)) можно переопределить через константы вверху файла.
*/
