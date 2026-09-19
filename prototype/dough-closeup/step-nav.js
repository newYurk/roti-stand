/* step-nav.js — кнопки «← шаг» и «шаг →» для стенда.
   Подключается после stand.js.
   Добавляет группу #gStepNav в панель перед #gStep.
   Нажатие вызывает те же действия, что кнопки data-s и id-кнопки в панели.
*/

"use strict";

(function initStepNav() {
  const STEPS = [
    { label: "расплющить",  action: () => clickStep("1") },
    { label: "растянуть",   action: () => clickStep("2") },
    { label: "на таву",     action: () => clickStep("3") },
    { label: "перевернуть", action: () => clickById("flipDish") },
    { label: "к нарезке",   action: () => clickById("cutMode") },
    { label: "сгущёнка",    action: () => activateDrizzle() },
    { label: "подать",      action: () => clickById("serveDish") },
  ];

  let stepIdx = 0;

  function clickStep(s) {
    const btn = document.querySelector(`[data-s="${s}"]`);
    if (btn && !btn.disabled) btn.click();
  }

  function clickById(id) {
    const btn = document.getElementById(id);
    if (btn && !btn.disabled && !btn.hidden) btn.click();
  }

  // Шаг «сгущёнка»: переходим в фазу CUT если ещё не там,
  // и обновляем подсказку чтобы игрок знал что делать.
  function activateDrizzle() {
    const live = document.getElementById("live");
    if (typeof phase === "undefined" || phase !== "CUT") {
      clickById("cutMode");
    }
    setTimeout(() => {
      if (typeof window.setDrizzleMode === "function") window.setDrizzleMode(true);
      else {
        const b = document.getElementById("drizzleMode");
        if (b && !b.classList.contains("on")) b.click();
      }
      if (live) live.textContent = "веди пальцем по роти — польётся сгущёнка";
    }, 160);
  }

  function go(delta) {
    const next = Math.max(0, Math.min(STEPS.length - 1, stepIdx + delta));
    if (next === stepIdx && delta !== 0) return;
    stepIdx = next;
    STEPS[stepIdx].action();
    updateNav();
  }

  function updateNav() {
    const prev = document.getElementById("stepNavPrev");
    const next = document.getElementById("stepNavNext");
    const lbl  = document.getElementById("stepNavLabel");
    if (!prev) return;
    prev.disabled = (stepIdx === 0);
    next.disabled = (stepIdx === STEPS.length - 1);
    if (lbl) lbl.textContent = STEPS[stepIdx].label;
  }

  function buildNav() {
    if (document.getElementById("gStepNav")) return;
    const panel = document.getElementById("panel");
    if (!panel) return;

    const grp = document.createElement("div");
    grp.className = "grp";
    grp.id = "gStepNav";
    // Порядок 0 — перед всеми группами с order:1+
    grp.style.cssText = "order:0; flex-shrink:0;";

    grp.innerHTML =
      `<b style="color:var(--dim);font-weight:400;margin-right:2px">шаг</b>` +
      `<button id="stepNavPrev" title="предыдущий шаг">&#8592;</button>` +
      `<span id="stepNavLabel" style="font-size:11px;color:var(--dim);` +
        `min-width:72px;text-align:center;padding:0 2px">${STEPS[0].label}</span>` +
      `<button id="stepNavNext" title="следующий шаг">&#8594;</button>`;

    const gStep = document.getElementById("gStep");
    const parent = (gStep && gStep.parentNode) || panel;
    parent.insertBefore(grp, gStep || parent.firstChild);

    document.getElementById("stepNavPrev").addEventListener("click", () => go(-1));
    document.getElementById("stepNavNext").addEventListener("click", () => go(+1));

    updateNav();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildNav);
  } else {
    buildNav();
  }
})();
