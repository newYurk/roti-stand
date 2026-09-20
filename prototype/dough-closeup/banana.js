/* banana.js — жест: ломтики банана на открытый лист.
   Подключается ПОСЛЕ stand.js. Ломтик — настоящая начинка (addBananaSlice):
   конверт его прячет, на срезе видна мякоть.

   На открытом листе (folds=0) середина кладёт кружки, край по-прежнему
   складывает. После первой складки жест гаснет.
*/

"use strict";
window.__bananaBoot = 1;

const BANANA_EDGE = 0.30;   // дальше — середина (как zone middle в stand.js)

let _modeOn     = false;
let _userOff    = false;
let _active     = false;
let _captureId  = null;
let _last       = null;
let _remembered = false;

Object.defineProperty(window, "bananaModeOn",
  { get: () => _modeOn, configurable: true });

function bananaReset() {
  _modeOn = false; _userOff = false; _active = false; _captureId = null;
  _last = null; _remembered = false;
  _syncButton();
}

function bananaUpdate() {
  if (typeof canPlaceBanana !== "function") return;
  if (canPlaceBanana()) {
    if (!_userOff && !_modeOn && !window.eggModeOn) _modeOn = true;
  } else {
    if (_modeOn || _active) {
      _modeOn = false; _userOff = false; _active = false; _captureId = null; _last = null;
    }
  }
  _syncButton();
}

function _inBananaPhase() {
  return _modeOn && typeof canPlaceBanana === "function" && canPlaceBanana();
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
  return _hullDist(p) > BANANA_EDGE;
}

function _place(e) {
  if (typeof addBananaSlice !== "function") return;
  const p = _local(e);
  if (!_isMiddle(p)) return;
  if (_last && Math.hypot(p.x - _last.x, p.y - _last.y) < 0.045) return;
  const ok = addBananaSlice(p.x, p.y, { silent: true });
  if (ok) {
    _last = p;
    if (typeof dish !== "undefined" && dish && dish.message) {
      const live = document.getElementById("live");
      if (live) live.textContent = dish.message;
    }
  }
}

function _onDown(e) {
  if (!_inBananaPhase() || _ui(e)) return;
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
  if (on && typeof canPlaceBanana === "function" && !canPlaceBanana()) {
    const live = document.getElementById("live");
    if (live) live.textContent = "банан — на открытый лист, до складки";
    _modeOn = false;
    _userOff = true;
    _syncButton();
    return;
  }
  _modeOn = !!on;
  _userOff = !_modeOn;
  if (!_modeOn) { _active = false; _captureId = null; _last = null; }
  _syncButton();
  if (_modeOn && typeof setEggMode === "function" && window.eggModeOn) setEggMode(false);
  const live = document.getElementById("live");
  if (_modeOn && live) live.textContent = "середина листа — ломтики · край — складка";
}

function _syncButton() {
  const b = document.getElementById("bananaMode");
  if (!b) return;
  const can = typeof canPlaceBanana === "function" && canPlaceBanana();
  b.hidden = !can && !_modeOn;
  b.disabled = !can;
  b.classList.toggle("on", _modeOn);
  b.textContent = _modeOn ? "банан ✓" : "банан";
}

window.setBananaMode = _setMode;
window.bananaUpdate = bananaUpdate;
window.bananaReset = bananaReset;

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

(function hookStandInput() {
  function wrap(name) {
    const orig = window[name];
    if (typeof orig !== "function" || orig._bananaWrap) return false;
    const wrapped = function (id, cx, cy, t) {
      if (name === "onDown" && _inBananaPhase() && typeof toLocal === "function") {
        const table = toLocal(cx, cy);
        const local = typeof dishLocal === "function" ? dishLocal(table) : table;
        if (_isMiddle(local)) return;
      }
      if (name !== "onDown" && _active && _inBananaPhase()) return;
      return orig.apply(this, arguments);
    };
    wrapped._bananaWrap = true;
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
    if (!_inBananaPhase() || _ui(e) || _active) return;
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
    const b = document.getElementById("bananaMode");
    if (!b || b._bananaBound) return;
    b._bananaBound = true;
    b.addEventListener("click", () => _setMode(!_modeOn));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
