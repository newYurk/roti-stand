/* banana.js — начинка касанием: банан кучкой, потом яйцо (сборка 85, плейтест 17.11 п. 15).
   Подключается ПОСЛЕ stand.js. Ломтики и яйцо — настоящая начинка (addBananaSlice, addEgg):
   конверт её прячет, на срезе видны мякоть и жёлтая полоса.

   На открытом листе (folds=0) короткое касание середины — начинка:
     первое — высыпает FILL_SLICES кружков банана квадратной кучкой в пунктир (как у продавцов:
     12–16 кружков квадратом); пока на полке есть связка, это тратит один банан (shelf.js);
     второе — выливает яйцо, оно растекается по кучке; яйцо бесконечное (запас тележки).
   Бананов нет (полка пуста) — первое касание сразу яйцо. Банан и яйцо уже есть — касание молчит.
   Короткое — меньше FILL_TAP_MS и без сдвига дальше FILL_SLOP_CSS. Ведение или удержание середины
   уходит стенду как было: ведение — перенос, удержание — прижим. Поэтому касание середины стенду
   отдаётся не сразу, а когда стало ясно, что это не начинка (с исходным временем касания).
   Раньше банан клался на касание, и начало переноса роняло ломтик.

   Кнопки #bananaMode/#eggMode (панель стенда) делают то же, что касание: кучка / яйцо.

   IIFE: иначе let-переменные banana/egg/drizzle дерутся в одном глобальном скоупе classic-скриптов.
*/
(function () {
"use strict";
window.__bananaBoot = 1;

const FILL_EDGE     = 0.30;   // дальше от кромки — середина (как zone middle в stand.js)
const FILL_TAP_MS   = 150;    // короче — касание; дольше — стенду (прижим, перенос)
const FILL_SLOP_CSS = 10;     // сдвиг пальца дальше — ведение, стенду
const FILL_SLICES   = 12;     // кружков в кучке: решётка 4×4 без углов — квадрат со скруглёнными углами
const HEAP_SIDE     = 0.62;   // сторона кучки — доля стороны пунктирного квадрата
const EGG_SPOTS     = [[0, 0], [-.28, -.28], [.28, -.28], [.28, .28], [-.28, .28]];   // доли стороны кучки

let _pending = null;          // касание середины, ещё не решено: {id, cx, cy, t, at}
let _passed  = null;          // id касания, отданного стенду

function _bananaOk() { return typeof canPlaceBanana === "function" && canPlaceBanana(); }
function _eggOk()    { return typeof canPlaceEgg === "function" && canPlaceEgg(); }
function _kinds() {
  const F = (typeof dish !== "undefined" && dish && dish.filling) || [];
  return { banana: F.some(f => (f.kind || "banana") === "banana"), egg: F.some(f => f.kind === "egg") };
}
// Что положит следующее касание: "banana", "egg" или null.
function fillingNext() {
  if (typeof dish === "undefined" || !dish || dish.mode !== "fold" || dish.folds !== 0) return null;
  const k = _kinds();
  if (!k.banana && !k.egg && _bananaOk()) return "banana";
  if (!k.egg && _eggOk()) return "egg";
  return null;
}
window.fillingNext = fillingNext;

function _hullDist(p) {
  if (typeof dish === "undefined" || !dish || !dish.hull || dish.hull.length < 2) return Infinity;
  let distance = Infinity;
  for (let i = 0; i < dish.hull.length; i++) {
    const a = dish.hull[i], b = dish.hull[(i + 1) % dish.hull.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
    if (d < distance) distance = d;
  }
  return distance;
}
function _isMiddle(p) {
  if (typeof onMaterial === "function" && !onMaterial(p)) return false;
  return _hullDist(p) > FILL_EDGE;
}
function _localOf(cx, cy) {
  const table = typeof toLocal === "function" ? toLocal(cx, cy) : { x: cx, y: cy };
  return typeof dishLocal === "function" ? dishLocal(table) : table;
}

// Пунктирный квадрат (drawFoldGuide): середина листа в половину его размера, в осях конверта.
function _guide() {
  const E = dish.env;
  if (!E) {
    const b = dishBounds(), c = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 }, h = Math.min(b.right - b.left, b.bottom - b.top) / 4;
    return { at: (a, q) => ({ x: c.x + a, y: c.y + q }), cu: 0, cv: 0, side: 2 * h };
  }
  const x1 = E.h[0] / 2, x0 = -E.h[1] / 2, y1 = E.h[2] / 2, y0 = -E.h[3] / 2;
  return { at: (a, q) => ({ x: E.c.x + E.u.x * a + E.v.x * q, y: E.c.y + E.u.y * a + E.v.y * q }),
    cu: (x0 + x1) / 2, cv: (y0 + y1) / 2, side: Math.min(x1 - x0, y1 - y0) };
}
// Кучка: решётка 4×4 без четырёх углов, с небольшим разбросом. Кружок, не легший (дыра, сосед вплотную),
// пробует сдвинуться к середине. Одна запись отмены на всю кучку.
function pourBanana() {
  if (fillingNext() !== "banana") return 0;
  const G = _guide(), s = G.side * HEAP_SIDE, step = s / 3;
  if (typeof rememberDish === "function") rememberDish();
  let n = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    if ((i === 0 || i === 3) && (j === 0 || j === 3)) continue;
    const jit = (k) => (Math.sin(k * 12.9898 + dish.history.length * 78.233) * 43758.5453 % 1) * step * 0.10;
    for (const shrink of [1, 0.8, 0.6]) {
      const a = G.cu + (i - 1.5) * step * shrink + jit(i * 7 + j), q = G.cv + (j - 1.5) * step * shrink + jit(j * 5 + i + 3);
      const p = G.at(a, q);
      if (window.addBananaSlice(p.x, p.y, { silent: true })) { n++; break; }
    }
  }
  if (!n && dish.history.length) dish.history.pop();      // ничего не легло — и отменять нечего
  return n;
}
// Яйцо: пять лужиц по кучке (или по пунктиру, если банана нет) — растекается по ней.
function pourEgg() {
  if (fillingNext() !== "egg") return 0;
  const G = _guide(), s = G.side * HEAP_SIDE;
  if (typeof rememberDish === "function") rememberDish();
  let n = 0;
  for (const [a, q] of EGG_SPOTS) {
    const p = G.at(G.cu + a * s, G.cv + q * s);
    if (window.addEgg(p.x, p.y, { silent: true })) n++;
  }
  if (!n && dish.history.length) dish.history.pop();
  return n;
}
function fillingTap() {
  const what = fillingNext();
  const n = what === "banana" ? pourBanana() : what === "egg" ? pourEgg() : 0;
  if (n) {
    // строка — одна и короткая (LINE_MAX), как была; о яйце она не говорит (V10 evening-regression: «no egg»)
    dish.message = tip("fold", "веди от края к середине");
    if (what === "egg" && typeof learn === "function") learn("egg");
    if (typeof syncDishUI === "function") syncDishUI();
    const live = document.getElementById("live");
    if (live) live.textContent = dish.message;
  }
  return n ? what : null;
}
window.fillingTap = fillingTap;

function bananaReset() { _pending = null; _passed = null; _syncButton(); }
// Сборка 85b (живая проверка, 375×667: первое короткое касание листа иногда молчало). Длительность касания
// меряется по времени самих событий (t — evTime, timeStamp касания), а не по часам в момент обработки: в длинном
// кадре (лист только лёг на таву — пересборка тепла и рельефа) касание в 70 мс доходило до обработчика через
// 150+ мс, считалось удержанием и уходило стенду — начинки не было. Держит ли палец — решает кадр, но только кадр
// без зависания: после долгого кадра (> FILL_STALL_MS) в очереди может ждать уже отпущенный палец — ждём ещё кадр.
const FILL_STALL_MS = 50;
let _lastUpd = 0;
function _dur(P, t) {
  if (Number.isFinite(t) && Number.isFinite(P.t) && t >= P.t) return t - P.t;
  return performance.now() - P.at;
}
// Каждый кадр: удержание середины дольше FILL_TAP_MS — это прижим, касание уходит стенду.
function bananaUpdate() {
  const now = performance.now(), stalled = now - _lastUpd > FILL_STALL_MS;
  _lastUpd = now;
  if (_pending && !stalled && now - _pending.at >= FILL_TAP_MS) _flush();
  _syncButton();
}
function _syncButton() {
  const b = document.getElementById("bananaMode");
  if (!b) return;
  const can = typeof dish !== "undefined" && !!dish && dish.mode === "fold" && dish.folds === 0;
  b.hidden = !can;
  b.disabled = fillingNext() !== "banana";
  b.textContent = "банан";
}

let _origDown = null, _origMove = null, _origUp = null;
function _flush() {
  const P = _pending; _pending = null;
  if (!P || !_origDown) return;
  _passed = P.id;
  _origDown.call(window, P.id, P.cx, P.cy, P.t);
}

(function hookStandInput() {
  function tryWrap() {
    if (typeof window.onDown !== "function") { setTimeout(tryWrap, 50); return; }
    if (window.onDown._bananaWrap) return;
    _origDown = window.onDown; _origMove = window.onMove; _origUp = window.onUp;
    const down = function (id, cx, cy, t) {
      if (_pending && _pending.id !== id) _flush();       // второй палец: первое касание — не начинка
      const busy = (typeof dishGesture !== "undefined" && dishGesture) || (typeof notebookOpen === "function" && notebookOpen())
        || (typeof inputQuietUntil !== "undefined" && performance.now() < inputQuietUntil);   // тетрадь открыта — касание ей
      if (!_pending && !busy && fillingNext() && _isMiddle(_localOf(cx, cy))) {
        _pending = { id, cx, cy, t, at: performance.now() };
        return;
      }
      return _origDown.apply(this, arguments);
    };
    const move = function (id, cx, cy, t) {
      if (_pending && _pending.id === id) {
        if (Math.hypot(cx - _pending.cx, cy - _pending.cy) < FILL_SLOP_CSS && _dur(_pending, t) < FILL_TAP_MS) return;
        _flush();                                          // ведение: перенос, складка — стенду
      }
      return _origMove.apply(this, arguments);
    };
    const up = function (id, cx, cy, t) {
      if (_pending && _pending.id === id) {
        const P = _pending;
        const quick = _dur(P, t) < FILL_TAP_MS && Math.hypot(cx - P.cx, cy - P.cy) < FILL_SLOP_CSS;
        if (quick) { _pending = null; fillingTap(); return; }
        _flush();
      }
      if (_passed === id) _passed = null;
      return _origUp.apply(this, arguments);
    };
    down._bananaWrap = move._bananaWrap = up._bananaWrap = true;
    window.onDown = down; window.onMove = move; window.onUp = up;
  }
  tryWrap();
})();

(function hookReset() {
  if (typeof reset === "function") {
    const orig = reset;
    if (orig._bananaReset) return;
    const wrapped = function () { bananaReset(); return orig.apply(this, arguments); };
    wrapped._bananaReset = true;
    window.reset = wrapped;
  } else {
    window.addEventListener("load", hookReset);
  }
})();

window.setBananaMode = function (on) { if (on) fillingTap(); };   // старое имя: кнопка и проверки
window.bananaUpdate = bananaUpdate;
window.bananaReset = bananaReset;
Object.defineProperty(window, "bananaModeOn", { get: () => false, configurable: true });

(function buildBtn() {
  function bind() {
    const b = document.getElementById("bananaMode");
    if (!b || b._bananaBound) return;
    b._bananaBound = true;
    b.addEventListener("click", () => { if (fillingNext() === "banana") fillingTap(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
})();
