/* counter-item.js — предмет на стойке прилавка.
   Подключается ПОСЛЕ stand.js. Никаких правок в stand.js не требует.

   Цикл жизни:
     counterPlaceItem(def)   — гость кладёт предмет (вызывается из логики визита)
     counterUpdate(dt)       — вызывать из game-loop перед drawFrame
     counterDraw(ctx)        — вызывать из drawFrame после фона, до теста
     counterPointerDown(p)   — вызывать из pointerdown (p — координаты стола)

   def = { id, x, y }       — тип предмета и позиция в координатах стола.
   Список типов — COUNTER_ITEMS ниже.

   Числа инфериред: нет источника на скорость fade и размер предмета;
   ориентир — ломтик банана в dish (~slice = span*0.05) и длительность
   анимации переворота FLIP_T = 0.45 с.
*/

"use strict";

// ─────────────────────────── каталог предметов
// Каждый предмет — только форма и цвет: текстур пока нет.
// tone: 0 светлый, 1 тёмный (масштаб как у thick начинки).
const COUNTER_ITEMS = {
  coconut:    { labelRu: "кокос",       radius: 0.038, tone: 0.55, color: [210, 190, 155] },
  banana:     { labelRu: "банан",       radius: 0.028, tone: 0.45, color: [230, 210, 90]  },
  spice_jar:  { labelRu: "приправа",    radius: 0.022, tone: 0.60, color: [160, 100, 60]  },
  banana_leaf:{ labelRu: "лист банана", radius: 0.050, tone: 0.30, color: [80,  150, 70]  },
};

// ─────────────────────────── состояние
// Один предмет на стойке — прототип; массив оставлен для расширения.
let counterItems = [];

// ─────────────────────────── API

/**
 * Положить предмет на стойку.
 * def: { id, x, y }
 *   id — ключ из COUNTER_ITEMS
 *   x, y — позиция в координатах стола (px, как prX/prY)
 */
function counterPlaceItem(def) {
  const spec = COUNTER_ITEMS[def.id];
  if (!spec) { console.warn("counter-item: неизвестный тип", def.id); return; }
  counterItems.push({
    id: def.id,
    spec,
    x: def.x,
    y: def.y,
    alpha: 0,          // появление: 0 → 1
    scale: 0.60,       // появление: 0.6 → 1.0
  });
}

/**
 * Обновить все предметы на стойке.
 * dt — дельта в секундах (как в основном loop).
 */
function counterUpdate(dt) {
  for (const item of counterItems) {
    if (item.alpha < 1) {
      item.alpha = Math.min(1, item.alpha + dt * 2.2);   // ≈ 0.45 с, как FLIP_T
      item.scale = Math.min(1, item.scale + dt * 1.5);
    }
  }
}

/**
 * Нарисовать предметы на стойке.
 * ctx — 2d-контекст основного холста.
 * Рисовать ПОСЛЕ фона, ДО теста (предмет лежит на столе под листом).
 */
function counterDraw(ctx) {
  if (!counterItems.length) return;

  // prX/prY и TILT определены в stand.js и доступны как глобалы.
  for (const item of counterItems) {
    if (item.alpha <= 0) continue;
    const spec = item.spec;

    // Проекция центра: стол уходит перспективой вглубь.
    const sx = prX(item.x, item.y);
    const sy = prY(item.x, item.y);

    // Радиус в экранных пикселях: берём ширину холста как ориентир масштаба.
    // PAN_R задан в koordinatах стола, поэтому множитель аналогичен ломтикам банана.
    const r = (typeof PAN_R !== "undefined" ? PAN_R : cv.width * 0.18)
              * spec.radius
              * item.scale;

    ctx.save();
    ctx.globalAlpha = item.alpha;
    ctx.translate(sx, sy);
    ctx.scale(item.scale, item.scale * TILT);   // TILT сплющивает по вертикали, как всё на столе

    // Тень
    ctx.beginPath();
    ctx.ellipse(r * 0.12, r * 0.18, r * 0.85, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fill();

    // Тело предмета
    const [cr, cg, cb] = spec.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    ctx.fill();

    // Световой блик
    ctx.beginPath();
    ctx.arc(-r * 0.28, -r * 0.28, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.12 + (1 - spec.tone) * 0.10})`;
    ctx.fill();

    ctx.restore();
  }
}

/**
 * Обработать нажатие/тап.
 * p — координата в координатах стола { x, y }.
 * Возвращает { id, spec } взятого предмета, или null если не попали.
 * Вызывать ДО обработки жестов теста: предмет на прилавке «перехватывает» тап.
 */
function counterPointerDown(p) {
  // Ищем с конца: верхний визуально предмет
  for (let i = counterItems.length - 1; i >= 0; i--) {
    const item = counterItems[i];
    if (item.alpha < 0.5) continue;   // ещё появляется — не интерактивен

    const spec = item.spec;
    const r = (typeof PAN_R !== "undefined" ? PAN_R : cv.width * 0.18)
              * spec.radius * 1.4;    // зона нажатия чуть шире нарисованного

    if (Math.hypot(p.x - item.x, p.y - item.y) <= r) {
      const taken = counterItems.splice(i, 1)[0];
      // Отдаём «наружу» — вызывающий код решает, куда добавить предмет.
      return { id: taken.id, spec: taken.spec };
    }
  }
  return null;
}

/**
 * Очистить стойку (новый роти, ресет).
 */
function counterClear() {
  counterItems = [];
}

// ─────────────────────────── хук в ресет stand.js
// stand.js экспортирует функцию reset() в глобальный скоуп.
// Перехватываем её и добавляем чистку стойки.
(function hookReset() {
  if (typeof reset === "function") {
    const _orig = reset;
    window.reset = function () {
      counterClear();
      return _orig.apply(this, arguments);
    };
  } else {
    // stand.js ещё не выполнился — подождём.
    document.currentScript && document.currentScript.addEventListener &&
      document.addEventListener("DOMContentLoaded", hookReset);
  }
})();

/* ─────────────────────────── ПРИМЕР ВЫЗОВА (удалить в игровой сборке)
   Через 1,5 с после загрузки кладём на стойку кокос — для визуальной проверки.

   setTimeout(() => {
     const w = zone("work");
     counterPlaceItem({ id: "coconut", x: w.cx - w.w * 0.30, y: w.cy + w.h * 0.25 });
   }, 1500);
*/
