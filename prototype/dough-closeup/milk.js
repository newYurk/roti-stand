/* milk.js — сгущёнка: банка с пробитой крышкой у лотка (сборка 85, плейтест 17.11 п. 14, шаг 2; банка — сборка 92).
   Подключается ПОСЛЕДНИМ (после shelf.js). Своего полива нет: это жест drizzle.js, как варенье
   в сборке 79, только нить белая и тоньше (tint.thin) — плоская полоса без брызг и выбега (правило 17.11).

   Банка стоит на столе у лотка, пока нарезанный роти лежит на лотке (dish.tray, stand.js).
   Касание банки — сгущёнка в руке; ведение пальцем по роти кладёт нить; после одной нити банка
   сама встаёт на место — следующее касание середины роти снова несёт лоток (перенос не спорит с поливом).
   Ещё раз коснулась банки, не полив, — поставила обратно. Сгущёнка бесконечная; без неё роти тоже отдают.
   Пока в руке варенье (shelf.js), банка не берётся.

   API: milkSpots() — где банка в CSS px окна и в руке ли она (для проверок касаниями).
*/
(function () {
"use strict";
window.__milkBoot = 1;

// Сборка 85b: шире (0,5 → 0,7 ширины варенья) и с тёмной кромкой (edge, drizzle.js) — на кадре 390×844 узкая
// белая нить на светлом тесте почти не читалась.
// Сборка 92 (ревью сборки 89 п. 6: «одна непрозрачная полоса, как зубная паста»): нить тоньше (0,5 варенья),
// кремовая и полупрозрачная (тесто чуть просвечивает), с бликом (gloss); ложится зигзагом за пальцем (zig: размах
// и шаг — доли роти) и провисает в щели резов (sag — цвет нити в тени щели). Читается за счёт блика и кромки.
const MILK_TINT = { fill: "rgba(250, 240, 210, 0.82)", rim: "rgba(190, 180, 160, 0.5)", edge: "rgba(128, 100, 60, 0.4)",
  gloss: "rgba(255, 255, 250, 0.9)", sag: "rgba(214, 196, 158, 0.85)", thin: 0.5, zig: [0.055, 0.15], milk: true };
const MILK_HIT_CSS = 30;     // радиус касания банки, CSS px

let _armed = false;          // сгущёнка в руке
let _seen  = false;          // нить пошла

function _canvas() { return typeof cv !== "undefined" ? cv : document.getElementById("cv"); }
function _onTray() {
  return typeof dish !== "undefined" && !!dish && dish.mode === "cut" && !!dish.tray && typeof trayRect === "function";
}
// Место банки на столе (координаты стола): справа от лотка, в середине свободной полосы до края
// рабочей зоны; не влезает — слева. Считается от лотка на столе (dishPose), а не в руке: банка не едет.
function milkSpot() {
  if (!_onTray()) return null;
  const pose = dishPose(), T = trayRect(), w = zone("work");
  const right = pose.x + T.right * pose.scale, left = pose.x + T.left * pose.scale;
  const y = pose.y + ((T.top + T.bottom) / 2) * pose.scale;
  const need = (typeof PAN_R === "number" ? PAN_R : 80) * 0.22;
  const x = w.x + w.w - right >= need ? (right + w.x + w.w) / 2
    : left - w.x >= need ? (left + w.x) / 2 : right + need * 0.5;
  return { x, y };
}
function _screenSpot() {
  const s = milkSpot(); if (!s) return null;
  return { x: prX(s.x, s.y), y: prY(s.x, s.y) };
}
function _hit(cx, cy) {
  const s = _screenSpot(), c = _canvas(); if (!s || !c) return false;
  const r = c.getBoundingClientRect(), k = c.width / (r.width || 1);
  const x = (cx - r.left) * k, y = (cy - r.top) * c.height / (r.height || 1);
  const h = (typeof PAN_R === "number" ? PAN_R : 80) * 0.16;       // середина банки — выше её донца
  return Math.hypot(x - s.x, y - (s.y - h)) <= MILK_HIT_CSS * k;
}
function milkCan() {
  if (!_onTray() || typeof setDrizzleMode !== "function") return false;
  if (typeof dishMove !== "undefined" && dishMove) return false;
  if (typeof dishGesture !== "undefined" && dishGesture) return false;
  return !window.drizzleTint || window.drizzleTint === MILK_TINT;   // варенье в руке — банка ждёт
}
function milkArm() {
  if (_armed || !milkCan()) return false;
  window.drizzleTint = MILK_TINT;
  setDrizzleMode(true);
  if (!window.drizzleModeOn) { window.drizzleTint = null; return false; }
  _armed = true; _seen = false;
  _log("take");
  return true;
}
function milkDisarm(why) {
  if (!_armed) return;
  _armed = false; _seen = false;
  if (window.drizzleTint === MILK_TINT) {
    if (typeof setDrizzleMode === "function" && window.drizzleModeOn) setDrizzleMode(false);
    window.drizzleTint = null;
  }
  _log("put", { why });
}
function _log(event, extra) {
  if (typeof gestures === "undefined") return;
  gestures.push({ kind: "milk", event, ...(extra || {}), strokes: window.drizzleStrokes || 0, ts: new Date().toISOString() });
  if (gestures.length > 200) gestures.shift();
}
function milkUpdate() {
  if (!_armed) return;
  if (window.drizzleActive) { _seen = true; return; }
  if (_seen) { milkDisarm("poured"); return; }                       // одна нить — банка на место
  if (!_onTray() || !window.drizzleModeOn || window.drizzleTint !== MILK_TINT) milkDisarm("gone");
}
function milkSpots() {
  const s = _screenSpot(), c = _canvas();
  if (!s || !c) return { at: null, armed: _armed, can: milkCan() };
  const r = c.getBoundingClientRect(), h = (typeof PAN_R === "number" ? PAN_R : 80) * 0.16;
  return { at: { x: r.left + s.x * r.width / c.width, y: r.top + (s.y - h) * r.height / c.height }, armed: _armed, can: milkCan() };
}

// Банка сгущёнки (сборка 92; ревью сборки 89: белая бутылка читалась клеем): жестяной цилиндр — светлые кромки
// сверху и снизу, бумажная этикетка кремовая с красной полосой, на крышке два пробитых треугольных отверстия.
// В руке — наклонена над своим местом пробитым краем вниз, на краю висит капля.
function _tin(g, u, bw, bh) {
  const ey = bw * 0.38;                                              // крышка и дно — эллипсы
  g.fillStyle = "#9c9a92";                                           // жесть: бок
  g.beginPath(); g.moveTo(-bw, -bh); g.lineTo(-bw, 0); g.ellipse(0, 0, bw, ey, 0, Math.PI, 0, true); g.lineTo(bw, -bh); g.closePath(); g.fill();
  g.fillStyle = "#ece0bf";                                           // этикетка
  g.fillRect(-bw, -bh * 0.86, bw * 2, bh * 0.74);
  g.fillStyle = "#b8392b"; g.fillRect(-bw, -bh * 0.56, bw * 2, bh * 0.2);   // полоса этикетки
  g.fillStyle = "rgba(255, 255, 255, 0.28)"; g.fillRect(-bw * 0.62, -bh, bw * 0.28, bh);   // блик на жести
  g.fillStyle = "rgba(0, 0, 0, 0.14)"; g.fillRect(bw * 0.55, -bh, bw * 0.45, bh);          // тень на боку
  g.fillStyle = "#cfcdc4"; g.strokeStyle = "#7d7a70"; g.lineWidth = Math.max(0.8, u * 0.8);
  g.beginPath(); g.ellipse(0, -bh, bw, ey, 0, 0, Math.PI * 2); g.fill(); g.stroke();   // крышка
  g.fillStyle = "#2b2219";                                           // два пробитых отверстия
  for (const sx of [-0.5, 0.5]) {
    g.beginPath(); g.moveTo(bw * sx - bw * 0.16, -bh - ey * 0.1); g.lineTo(bw * sx + bw * 0.16, -bh - ey * 0.1); g.lineTo(bw * sx, -bh + ey * 0.45); g.closePath(); g.fill();
  }
  g.fillStyle = "rgba(250, 240, 210, 0.95)";                          // сгущёнка у переднего отверстия
  g.beginPath(); g.ellipse(bw * 0.5, -bh + ey * 0.3, bw * 0.1, ey * 0.22, 0, 0, Math.PI * 2); g.fill();
}
let _shown = null;            // что нарисовано в последнем кадре: "tin" — банка стоит, "pour" — наклонена (для проверок)
function milkDraw(g) {
  _shown = null;
  const s = _screenSpot(); if (!s) return;
  if (typeof notebookOpen === "function" && notebookOpen()) return;
  const u = (typeof PAN_R === "number" ? PAN_R : 80) / 80;
  const bw = 9 * u, bh = 22 * u;
  g.save();
  g.fillStyle = "rgba(40, 26, 12, 0.25)";                          // тень на столе
  g.beginPath(); g.ellipse(s.x, s.y, bw * 1.3, bw * 0.45, 0, 0, Math.PI * 2); g.fill();
  if (_armed) {
    // наклонена к лотку (лоток слева от банки, если банка справа), пробитым краем вниз
    const toLeft = dishPose().x < milkSpot().x;
    g.translate(s.x, s.y - bh * 1.15); g.rotate((toLeft ? -1 : 1) * 2.1); g.translate(0, bh * 0.5);
    _tin(g, u, bw, bh);
    g.fillStyle = "rgba(250, 240, 210, 0.95)";                      // капля на краю
    g.beginPath(); g.ellipse(bw * 0.5, -bh - bw * 0.18, bw * 0.13, bw * 0.2, 0, 0, Math.PI * 2); g.fill();
    _shown = "pour";
  } else {
    g.translate(s.x, s.y);
    _tin(g, u, bw, bh);
    _shown = "tin";
  }
  g.restore();
}

window.milkSpots = milkSpots;
window.milkArm = milkArm;
window.milkDisarm = milkDisarm;
Object.defineProperty(window, "milkArmed", { get: () => _armed, configurable: true });
Object.defineProperty(window, "milkShown", { get: () => _shown, configurable: true });

// Касание банки: drizzle.js его не штрихует (drizzlePass), стенд его не получает (обёртка onDown).
(function wrapPass() {
  const orig = window.drizzlePass;
  window.drizzlePass = function (cx, cy) {
    if (typeof orig === "function" && orig.apply(this, arguments)) return true;
    return _onTray() && _hit(cx, cy);
  };
})();
(function wrapInput() {
  function tryWrap() {
    if (typeof window.onDown !== "function") { setTimeout(tryWrap, 50); return; }
    if (window.onDown._milkWrap) return;
    const down = window.onDown, up = window.onUp;
    let mine = null;                                                // id касания банки: его конец стенду не нужен
    const w = function (id, cx, cy) {
      if (_onTray() && _hit(cx, cy)) {
        mine = id;
        if (_armed) milkDisarm("back"); else milkArm();
        return;
      }
      return down.apply(this, arguments);
    };
    const wu = function (id) {
      if (mine !== null && id === mine) { mine = null; return; }
      return up.apply(this, arguments);
    };
    w._milkWrap = wu._milkWrap = true;
    window.onDown = w; window.onUp = wu;
  }
  tryWrap();
})();
(function wrapFrame() {
  const upd = window.drizzleUpdate, draw = window.drizzleDraw, rst = window.drizzleReset;
  if (typeof upd === "function") window.drizzleUpdate = function () { const r = upd.apply(this, arguments); milkUpdate(); return r; };
  if (typeof draw === "function") window.drizzleDraw = function (g) { milkDraw(g); return draw.apply(this, arguments); };
  if (typeof rst === "function") window.drizzleReset = function () { if (window.drizzleTint === MILK_TINT) window.drizzleTint = null; _armed = false; _seen = false; return rst.apply(this, arguments); };
})();
})();
