/* egg.js — яйцо на открытый лист.
   С сборки 85 своего жеста нет: яйцо — второе короткое касание середины листа (banana.js, fillingTap),
   оно растекается по кучке банана. Здесь — кнопка панели стенда #eggMode и прежние имена
   (eggUpdate, eggReset, setEggMode, eggModeOn), которые зовут loop() и проверки.
   Лужица — настоящая начинка (addEgg в stand.js): конверт прячет, на срезе жёлтая полоса.
*/
(function () {
"use strict";
window.__eggBoot = 1;

function _syncButton() {
  const b = document.getElementById("eggMode");
  if (!b) return;
  const can = typeof dish !== "undefined" && !!dish && dish.mode === "fold" && dish.folds === 0;
  b.hidden = !can;
  b.disabled = !(typeof fillingNext === "function" && fillingNext() === "egg");
  b.textContent = "яйцо";
}
function _pour() { if (typeof fillingNext === "function" && fillingNext() === "egg") fillingTap(); }

window.eggUpdate = _syncButton;
window.eggReset = _syncButton;
window.setEggMode = function (on) { if (on) _pour(); };
Object.defineProperty(window, "eggModeOn", { get: () => false, configurable: true });

(function buildBtn() {
  function bind() {
    const b = document.getElementById("eggMode");
    if (!b || b._eggBound) return;
    b._eggBound = true;
    b.addEventListener("click", _pour);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
})();
