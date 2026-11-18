/* milk.js — сгущёнка: бутылка с носиком у лотка (сборка 85, плейтест 17.11 п. 14, шаг 2).
   Подключается ПОСЛЕДНИМ (после shelf.js). Своего полива нет: это жест drizzle.js, как варенье
   в сборке 79, только нить белая и тоньше (tint.thin) — плоская полоса без брызг и выбега (правило 17.11).

   Бутылка стоит на столе у лотка, пока нарезанный роти лежит на лотке (dish.tray, stand.js).
   Касание бутылки — сгущёнка в руке; ведение пальцем по роти кладёт нить; после одной нити бутылка
   сама встаёт на место — следующее касание середины роти снова несёт лоток (перенос не спорит с поливом).
   Ещё раз коснулась бутылки, не полив, — поставила обратно. Сгущёнка бесконечная; без неё роти тоже отдают.
   Пока в руке варенье (shelf.js), бутылка не берётся.

   API: milkSpots() — где бутылка в CSS px окна и в руке ли она (для проверок касаниями).
*/
(function () {
"use strict";
window.__milkBoot = 1;

const MILK_TINT = { fill: "rgba(253, 251, 244, 0.97)", rim: "rgba(190, 180, 160, 0.5)", thin: 0.5, milk: true };
const MILK_HIT_CSS = 30;     // радиус касания бутылки, CSS px

let _armed = false;          // сгущёнка в руке
let _seen  = false;          // нить пошла

function _canvas() { return typeof cv !== "undefined" ? cv : document.getElementById("cv"); }
function _onTray() {
  return typeof dish !== "undefined" && !!dish && dish.mode === "cut" && !!dish.tray && typeof trayRect === "function";
}
// Место бутылки на столе (координаты стола): справа от лотка, в середине свободной полосы до края
// рабочей зоны; не влезает — слева. Считается от лотка на столе (dishPose), а не в руке: бутылка не едет.
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
  const h = (typeof PAN_R === "number" ? PAN_R : 80) * 0.16;       // середина бутылки — выше её донца
  return Math.hypot(x - s.x, y - (s.y - h)) <= MILK_HIT_CSS * k;
}
function milkCan() {
  if (!_onTray() || typeof setDrizzleMode !== "function") return false;
  if (typeof dishMove !== "undefined" && dishMove) return false;
  if (typeof dishGesture !== "undefined" && dishGesture) return false;
  return !window.drizzleTint || window.drizzleTint === MILK_TINT;   // варенье в руке — бутылка ждёт
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
  if (_seen) { milkDisarm("poured"); return; }                       // одна нить — бутылка на место
  if (!_onTray() || !window.drizzleModeOn || window.drizzleTint !== MILK_TINT) milkDisarm("gone");
}
function milkSpots() {
  const s = _screenSpot(), c = _canvas();
  if (!s || !c) return { at: null, armed: _armed, can: milkCan() };
  const r = c.getBoundingClientRect(), h = (typeof PAN_R === "number" ? PAN_R : 80) * 0.16;
  return { at: { x: r.left + s.x * r.width / c.width, y: r.top + (s.y - h) * r.height / c.height }, armed: _armed, can: milkCan() };
}

// Бутылка: белое мягкое тело, красный колпачок и носик. В руке — перевёрнута носиком вниз над своим местом.
function milkDraw(g) {
  const s = _screenSpot(); if (!s) return;
  if (typeof notebookOpen === "function" && notebookOpen()) return;
  const u = (typeof PAN_R === "number" ? PAN_R : 80) / 80;
  const bw = 7 * u, bh = 24 * u;
  g.save();
  g.fillStyle = "rgba(40, 26, 12, 0.25)";                          // тень на столе
  g.beginPath(); g.ellipse(s.x, s.y, bw * 1.3, bw * 0.45, 0, 0, Math.PI * 2); g.fill();
  if (_armed) { g.translate(s.x, s.y - bh * 1.9); g.rotate(Math.PI); }
  else g.translate(s.x, s.y);
  g.fillStyle = "#f4f0e6"; g.strokeStyle = "#b9ae98"; g.lineWidth = Math.max(1, u);
  g.beginPath();
  g.moveTo(-bw, 0); g.lineTo(bw, 0); g.lineTo(bw, -bh * 0.78);
  g.quadraticCurveTo(bw, -bh, 0, -bh); g.quadraticCurveTo(-bw, -bh, -bw, -bh * 0.78); g.closePath();
  g.fill(); g.stroke();
  g.fillStyle = "#c2412f";                                          // колпачок и носик
  g.fillRect(-bw * 0.45, -bh - 3 * u, bw * 0.9, 3 * u);
  g.beginPath(); g.moveTo(-bw * 0.25, -bh - 3 * u); g.lineTo(bw * 0.25, -bh - 3 * u); g.lineTo(0, -bh - 9 * u); g.closePath(); g.fill();
  g.fillStyle = "#3d6fa8"; g.fillRect(-bw, -bh * 0.55, bw * 2, bh * 0.22);   // наклейка
  g.restore();
}

window.milkSpots = milkSpots;
window.milkArm = milkArm;
window.milkDisarm = milkDisarm;
Object.defineProperty(window, "milkArmed", { get: () => _armed, configurable: true });

// Касание бутылки: drizzle.js его не штрихует (drizzlePass), стенд его не получает (обёртка onDown).
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
    let mine = null;                                                // id касания бутылки: его конец стенду не нужен
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
