/* egg.js — жест: яйцо на открытый лист.
   Подключается ПОСЛЕ banana.js. Лужица — настоящая начинка (addEgg):
   конверт прячет, на срезе жёлтая полоса.

   Кнопка #eggMode. Середина листа льёт, край складывает.
   С бананом взаимно исключается.
*/

"use strict";
window.__eggBoot = 1;

const EGG_EDGE = 0.30;

let _modeOn     = false;
let _userOff    = false;
let _active     = false;
let _captureId  = null;
let _last       = null;
let _remembered = false;

Object.defineProperty(window, "eggModeOn",
  { get: () => _modeOn, configurable: true });

function eggReset() {
  _modeOn = false; _userOff = false; _active = false; _captureId = null;
  _last = null; _remembered = false;
  _syncButton();
}

function eggUpdate() {
  if (typeof canPlaceEgg !== "function") return;
  if (canPlaceEgg()) {
    /* яйцо не включается само — сначала банан, яйцо по кнопке */
  } else if (_modeOn) {
    _modeOn = false; _userOff = false; _active = false; _captureId = null; _last = null;
  }
  _syncButton();
}

function _inEggPhase() {
  return _modeOn && typeof canPlaceEgg === "function" && canPlaceEgg();
}

function _ui(e) {
  return typeof inUI === "function" && inUI(e.target);
}

function _local(e) {
  const table = typeof toLocal === "function"
    ? toLocal(e.clientX, e.clientY)
    : { x: e.clientX, y: e.clientY };
  return typeof dishLocal === "function" ? dishLocal(table) : table;
}

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
  return _hullDist(p) > EGG_EDGE;
}

function _place(e) {
  if (typeof addEgg !== "function") return;
  const p = _local(e);
  if (!_isMiddle(p)) return;
  if (_last && Math.hypot(p.x - _last.x, p.y - _last.y) < 0.028) return;
  const ok = addEgg(p.x, p.y, { silent: true });
  if (ok) {
    _last = p;
    if (typeof dish !== "undefined" && dish && dish.message) {
      const live = document.getElementById("live");
      if (live) live.textContent = dish.message;
    }
  }
}

function _onDown(e) {
  if (!_inEggPhase() || _ui(e)) return;
  if (e.button != null && e.button !== 0) return;
  if (_active) return;
  const p = _local(e);
  if (!_isMiddle(p)) return;
  _active = true;
  _captureId = e.pointerId;
  _last = null;
  if (!_remembered && typeof rememberDish === "function") {
    rememberDish();
    _remembered = true;
  }
  _place(e);
  e.stopImmediatePropagation();
  e.preventDefault();
}

function _onMove(e) {
  if (!_active || e.pointerId !== _captureId) return;
  _place(e);
  e.stopImmediatePropagation();
}

function _onUp(e) {
  if (e.pointerId !== _captureId) return;
  _active = false;
  _captureId = null;
  _last = null;
  _remembered = false;
  if (typeof syncDishUI === "function") syncDishUI();
}

function _setMode(on) {
  if (on && typeof canPlaceEgg === "function" && !canPlaceEgg()) {
    const live = document.getElementById("live");
    if (live) live.textContent = "яйцо — на открытый лист, до складки";
    _modeOn = false;
    _userOff = true;
    _syncButton();
    return;
  }
  _modeOn = !!on;
  _userOff = !_modeOn;
  if (!_modeOn) { _active = false; _captureId = null; _last = null; }
  _syncButton();
  if (_modeOn && typeof setBananaMode === "function" && window.bananaModeOn) setBananaMode(false);
  const live = document.getElementById("live");
  if (_modeOn && live) live.textContent = "середина листа — яйцо · край — складка";
}

function _syncButton() {
  const b = document.getElementById("eggMode");
  if (!b) return;
  const can = typeof canPlaceEgg === "function" && canPlaceEgg();
  b.hidden = !can && !_modeOn;
  b.disabled = !can;
  b.classList.toggle("on", _modeOn);
  b.textContent = _modeOn ? "яйцо ✓" : "яйцо";
}

window.setEggMode = _setMode;
window.eggUpdate = eggUpdate;
window.eggReset = eggReset;

(function hookReset() {
  if (typeof reset === "function") {
    const orig = reset;
    if (orig._eggReset) return;
    const wrapped = function () { eggReset(); return orig.apply(this, arguments); };
    wrapped._eggReset = true;
    window.reset = wrapped;
  } else {
    window.addEventListener("load", hookReset);
  }
})();

(function hookStandInput() {
  function wrap(name) {
    const orig = window[name];
    if (typeof orig !== "function" || orig._eggWrap) return false;
    const wrapped = function (id, cx, cy, t) {
      if (name === "onDown" && _inEggPhase() && typeof toLocal === "function") {
        const table = toLocal(cx, cy);
        const local = typeof dishLocal === "function" ? dishLocal(table) : table;
        if (_isMiddle(local)) return;
      }
      if (name !== "onDown" && _active) return;
      return orig.apply(this, arguments);
    };
    wrapped._eggWrap = true;
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

  function touchFake(e, t) {
    return {
      pointerId: "t" + t.identifier,
      button: 0,
      clientX: t.clientX,
      clientY: t.clientY,
      target: e.target,
      preventDefault() { e.preventDefault(); },
      stopImmediatePropagation() { e.stopImmediatePropagation(); }
    };
  }
  window.addEventListener("touchstart", e => {
    if (!_inEggPhase() || _ui(e) || _active) return;
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
})();

(function buildBtn() {
  function bind() {
    const b = document.getElementById("eggMode");
    if (!b || b._eggBound) return;
    b._eggBound = true;
    b.addEventListener("click", () => _setMode(!_modeOn));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
