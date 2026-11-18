"use strict";
/* Рамка вечера без гостя — шаг 1 v0 (docs/v0-step1-evening-frame.md).
   Грузится ПОСЛЕ stand.js и только водит его: зажгла лампу → три шарика из миски → три роти на
   стойку → крышка на таву. Своей физики и своих жестов теста здесь нет. Стенд зовёт отсюда
   eveningActive / eveningDown / eveningMove / eveningUp / eveningDraw / eveningUpdate / eveningLive /
   eveningCounterHit / eveningServed / eveningExport — всё под typeof, поэтому без этого
   файла (проверки в Node) и в режиме стенда (?dev=1, «панель стенда» в радио) стенд работает как раньше.
   Правило владелицы 17.11: без украшений — лампа, миска, шарики, крышка, радио и небо здесь плоские
   фигуры в палитре стенда; ни свечения, ни теней, ни звуков. Движение — только то, что что-то сообщает:
   негорящая лампа покачивается (сборка 80) — это вход в игру. Слова — только в радио
   и в одной служебной строке сверху (#live); мелкая подсказка стенда (#hint) в игре спрятана: на
   маленьком телефоне она вместе со строкой ложилась на радио и стойку.
   Гость (guest.js, шаг 2 v0) грузится после этого файла; отсюда его зовут под typeof: guestUpdate,
   guestDraw, guestDrawOver, guestServe, guestWatch, guestReset, guestState, guestExport, guestTook. Без него вечер
   идёт как в шаге 1.
   Тетрадь (notebook.js, шаг 3 v0) грузится после гостя; её зовут так же под typeof: notebookDown / Move / Up,
   notebookUpdate, notebookDrawItem, notebookDraw, notebookSnap, notebookNewEvening, notebookOpen,
   notebookState, notebookExport. Её снимки лежат в том же сохранении (roti_evening.notebook) и вечер
   заново не стирает прошлые вечера. Экран не гаснет, пока лампа горит (eveWakeSync, внизу файла).
   Пёс и ночной кадр (night.js, шаг 4 v0) грузятся последними; их зовут под typeof: nightDogHit, nightServe,
   nightTook, nightUpdate, nightDrawUnder, nightDrawOver, nightDraw, nightReset, nightState, nightExport.
   С ним строка «вечер окончен» пустая: конец вечера показывает ночной кадр.
   Полка и номер вечера (shelf.js, шаг 5 v0) — после ночи; их зовут под typeof: shelfNewEvening, shelfDown, shelfUp,
   shelfUpdate, shelfLive, shelfState, shelfExport. Сохранение несёт n (номер вечера) и shelf. */

const EVE_KEY = "roti_evening", EVE_VERSION = 1, EVE_BALLS = 3;
const EVE_WAKE_IDLE_MS = 5*60*1000; // экран держится включённым столько после последнего касания или события вечера
const EVE_IDLE_HINT_MS = 6000;      // подсказка «шарик в миске» / «накрой крышкой» — только если она стоит
const EVE_LID_ON = 0.6;             // крышка легла, если её середина ближе этой доли радиуса тавы к центру
const EVE_SKY = ["#5b4a55", "#40384a", "#292838", "#14141d"];   // сумерки → вечер → поздний вечер → ночь
const EVE_COUNT = ["ни одного", "один", "два", "три"];
// Негорящая лампа качается (сборка 80, плейтест 17.11 п. 11: тёмный экран 30 с не пускал в игру — отвечала
// только тусклая лампа в углу). Раз в EVE_SWING_EVERY секунд она покачивается сама; любой тап в темноте
// мимо неё (миска, тава, стол) качает её сильнее — глаз идёт к тому, что шевельнулось. Слов нет.
const EVE_SWING_EVERY = 5, EVE_SWING_FIRST = 1.5, EVE_SWING_S = 1.8, EVE_SWING_IDLE = 0.16, EVE_SWING_TAP = 0.34;   // с, с, с, рад, рад

function eveFresh(){ return { v:EVE_VERSION, lamp:false, ballsLeft:EVE_BALLS, rotiDone:0, lid:false, over:false, ball:false }; }
let EVE = eveFresh();
let eveEvents = [];                 // журнал вечера: не вытесняется шлепками из общего gestures (там предел 200)
let eveDev = false;                 // режим стенда: панель видна, рамка вечера не рисуется и не слушает
let eveDrag = null;                 // крышка в руке: {id, x, y, dx, dy} в пикселях холста
let eveIdleAt = 0, eveStage = "", eveRestartArmed = 0;
let eveGuestRaw = null;             // сохранённый гость, пока guest.js ещё не загрузился (он читает это при запуске)
let eveNbRaw = null;                // сохранённая тетрадь, пока notebook.js ещё не загрузился
let eveShelfRaw = null;             // сохранённая полка и номер вечера, пока shelf.js ещё не загрузился
let eveNightRaw = null;             // сохранённые пёс и ночной кадр, пока night.js ещё не загрузился
let eveServePt = null;              // где отпущен роти (client px): гость смотрит, над ним ли
let eveSwing = { a:0, t:0, wait:EVE_SWING_FIRST, n:0 };   // качание негорящей лампы: размах, возраст, до следующего, счётчик (для проверок)
const eveRoot = document.documentElement || document.body;
const eveEl = id => document.getElementById(id);

function eveningActive(){ return !eveDev; }

// ─────────────────────────── сохранение и журнал
function eveLoad(){
  try{
    const s = JSON.parse(localStorage.getItem(EVE_KEY) || "null");
    if(!s || s.v !== EVE_VERSION) return;
    const n = (x, max) => Math.max(0, Math.min(max, Math.round(+x) || 0));
    EVE = { v:EVE_VERSION, lamp:!!s.lamp, ballsLeft:n(s.ballsLeft, EVE_BALLS), rotiDone:n(s.rotiDone, EVE_BALLS),
      lid:!!s.lid, over:!!s.over, ball:!!s.ball };
    if(Array.isArray(s.events)) eveEvents = s.events.slice(-80);
    if(s.guest && typeof s.guest === "object") eveGuestRaw = s.guest;
    if(s.notebook && typeof s.notebook === "object") eveNbRaw = s.notebook;
    if(s.night && typeof s.night === "object") eveNightRaw = s.night;
    if(s.shelf && typeof s.shelf === "object") eveShelfRaw = s.shelf;
  }catch(e){}
}
function eveStageNow(){
  if(!EVE.lamp) return EVE.over ? "over" : "dusk";
  if(!EVE.ball) return "free";
  return dish ? dish.mode : phase === "TABLE" ? "step" + stepNo : "pan";
}
function eveSave(){
  eveStage = eveStageNow();
  const guest = typeof guestState === "function" ? guestState() : eveGuestRaw || undefined;
  const notebook = typeof notebookState === "function" ? notebookState() : eveNbRaw || undefined;
  const night = typeof nightState === "function" ? nightState() : eveNightRaw || undefined;
  const shelf = typeof shelfState === "function" ? shelfState() : eveShelfRaw || undefined;   // полка и номер вечера (shelf.js)
  try{ localStorage.setItem(EVE_KEY, JSON.stringify({ ...EVE, n:shelf ? shelf.n : 1, stage:eveStage, events:eveEvents, guest, notebook, night, shelf, ts:new Date().toISOString() })); }catch(e){}
  eveWakeSync();
}
function eveLog(event, extra){
  const row = { event, ballsLeft:EVE.ballsLeft, rotiDone:EVE.rotiDone, ...(extra || {}), ts:new Date().toISOString() };
  eveEvents.push(row); if(eveEvents.length > 80) eveEvents.shift();
  gestures.push({ ...measurementContext(), kind:"evening", ...row });
  if(gestures.length > 200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
  eveIdleAt = performance.now();
  eveSave();
}
function eveningExport(){ return { state:{ ...EVE, stage:eveStageNow() }, events:eveEvents, guest:typeof guestExport === "function" ? guestExport() : undefined,
  notebook:typeof notebookExport === "function" ? notebookExport() : undefined,
  night:typeof nightExport === "function" ? nightExport() : undefined,
  shelf:typeof shelfExport === "function" ? shelfExport() : undefined }; }

// ─────────────────────────── стенд под рамкой
// Свежий комок на столе (шаг 1). Журнал пробы не трогаем — это не «заново» стенда.
function eveFreshLump(){
  stepNo = 1;
  try{ localStorage.setItem("dough_step", "1"); }catch(e){}
  syncStepButtons(); reset();
}
// Привести стенд к сохранённому вечеру: при запуске, после «начать заново» и при выходе из режима стенда.
// Начатый шарик начинается с комка — узлы листа не сохраняются (принято для v0). Комок лежит на столе,
// на таве пусто — крышка паузы не нужна; остаётся только крышка оконченного вечера.
function eveApply(){
  eveDrag = null;
  if(eveDev){ sheetHidden = false; fryHold = false; return; }
  eveFreshLump();
  if(!EVE.over) EVE.lid = false;
  sheetHidden = !(EVE.lamp && EVE.ball);
  fryHold = EVE.lid;
  eveIdleAt = performance.now();
  eveHintRefresh();
  eveSave();
}
function eveHintRefresh(){ syncStepButtons(); }
function eveSetDev(on){
  eveDev = !!on;
  if(eveRoot && eveRoot.classList) eveRoot.classList.toggle("dev", eveDev);
  const p = eveEl("panel"); if(p) p.hidden = !eveDev;
  const b = eveEl("evPanel"); if(b) b.textContent = eveDev ? "спрятать панель стенда" : "панель стенда";
}

// ─────────────────────────── переходы вечера
function eveLight(){
  if(EVE.lamp || EVE.over) return;
  EVE.lamp = true; eveLog("lamp");
  eveTakeBall();                    // первый шарик ложится на стол сам
}
function eveTakeBall(){
  if(!EVE.lamp || EVE.ball || EVE.lid || EVE.over || EVE.ballsLeft <= 0) return false;
  EVE.ballsLeft--; EVE.ball = true;
  eveFreshLump(); sheetHidden = false;
  eveLog("ball"); eveHintRefresh();
  return true;
}
// Стенд зовёт это, когда нарезанный роти отпущен над стойкой (после своего serveDish()).
function eveningServed(){
  // Гость смотрит первым, до сброса стенда: ему нужен хруст поданного роти и место, где его отпустили.
  // Не ей — может быть, псу (night.js): роти отпущен над ним, внизу экрана.
  const to = (typeof guestServe === "function" ? guestServe(eveServePt) : null) || (typeof nightServe === "function" ? nightServe(eveServePt) : null);
  if(typeof notebookSnap === "function") notebookSnap(to || "counter");   // снимок в тетрадь — тоже до сброса: роти ещё цел
  EVE.rotiDone = Math.min(EVE_BALLS, EVE.rotiDone + 1); EVE.ball = false;
  eveFreshLump(); sheetHidden = true;
  if(!to && typeof guestWatch === "function") guestWatch(eveServePt);     // роти унесли мимо неё на стойку — она поворачивает голову вслед
  eveLog("serve", to ? { to } : undefined); eveHintRefresh();
}
function eveSwingStart(a){ eveSwing.a = a; eveSwing.t = 0; eveSwing.wait = EVE_SWING_EVERY; eveSwing.n++; }
// Угол лампы на шнуре, радианы: два с половиной качания, затухая. 0 — висит прямо.
function eveLampAngle(){
  const u = eveSwing.t/EVE_SWING_S;
  return eveSwing.a > 0 && u < 1 ? eveSwing.a*Math.sin(u*Math.PI*5)*(1 - u)*(1 - u) : 0;
}
function eveSwingUpdate(dt){
  if(EVE.lamp || EVE.over){ eveSwing.a = 0; eveSwing.wait = EVE_SWING_FIRST; return; }
  eveSwing.t += dt; eveSwing.wait -= dt;
  if(eveSwing.wait <= 0) eveSwingStart(EVE_SWING_IDLE);
}
function eveLidHome(){ return EVE.lamp && !EVE.over && !EVE.lid && !EVE.ball && EVE.ballsLeft === 0; }
function eveLidEnd(){
  EVE.lid = true; EVE.over = true; EVE.lamp = false; fryHold = true;
  eveLog("lid-end"); eveHintRefresh();
}
// Пауза нужна, только когда на таве что-то жарится: пустую таву накрывать незачем, а в конце вечера
// (крышка ждёт на столе) крышка на таве читалась бы как «закрыто».
function eveFrying(){ return EVE.ball && phase === "PAN"; }
function eveLidPause(){
  if(eveDev || !EVE.lamp || EVE.over || EVE.lid || !eveFrying()) return;
  eveDrag = null;
  EVE.lid = true; fryHold = true;
  eveLog("lid-pause"); eveHintRefresh();
}
function eveLidOff(){
  EVE.lid = false; fryHold = false;
  eveLog("lid-off"); eveHintRefresh();
}
function eveNewEvening(from){
  const wasOver = EVE.over;
  if(typeof notebookNewEvening === "function") notebookNewEvening(from, wasOver);
  if(typeof shelfNewEvening === "function") shelfNewEvening(from, wasOver);   // до сброса гостьи: полке нужны вчерашние ответы
  EVE = eveFresh();
  eveGuestRaw = null; eveNightRaw = null;
  if(typeof guestReset === "function") guestReset();
  if(typeof nightReset === "function") nightReset();
  eveLog("restart", { from });
  eveApply();
}

// ─────────────────────────── раскладка (пиксели холста)
// Всё считается от тавы и рабочей зоны стенда: над тавой — небо и стойка, под тестом — миска.
function eveGeo(){
  const W = cv.width, H = cv.height, r = cv.getBoundingClientRect(), u = W / Math.max(1, r.width);
  const pan = { x:prX(panC.x, panC.y), y:prY(panC.x, panC.y) };
  const wz = zone("work"), work = { x:prX(wz.cx, wz.cy), y:prY(wz.cx, wz.cy) };
  const A = Math.max(72*u, pan.y - PAN_R*TILT*1.16);       // свободная полоса над тавой
  const sky = { y0:0, y1:A*0.50 };
  // Стойка: 30 % полосы; на низком экране (полоса уже 300 px) тоньше, до 40 px — место над ней нужно
  // гостье (шаг 2: на 375×667 её рамка была 100×91 px). Нижний край стойки не двигается.
  const ch = A >= 300*u ? A*0.30 : Math.min(A*0.30, Math.max(40*u, A*0.30 - (300*u - A)*0.55));
  const counter = { x0:W*0.04, x1:W*0.96, y0:A*0.92 - ch, y1:A*0.92 };
  const ls = Math.max(12*u, Math.min(22*u, A*0.10));
  const lamp = { x:W - 46*u, y:A*0.34, s:ls, hit:Math.max(36*u, ls*1.9) };
  const radio = { x0:counter.x0 + 8*u, y1:counter.y0 + 3*u, w:40*u, h:24*u };
  radio.y0 = radio.y1 - radio.h; radio.x = radio.x0 + radio.w/2; radio.y = radio.y0 + radio.h/2; radio.hit = 32*u;
  const bowl = { x:work.x, y:H - 40*u, rx:62*u, ry:24*u };
  const lidR = PAN_R*1.08;                              // крышка закрывает плиту с бортом: ни лист, ни маргарин из-под неё не торчат
  const lump = { x:work.x, y:work.y, r:34*u };
  return { W, H, u, pan, work, A, sky, counter, lamp, radio, bowl, lidR, lump };
}
function evePt(cx, cy){
  const r = cv.getBoundingClientRect();
  return { x:(cx - r.left)*cv.width/Math.max(1, r.width), y:(cy - r.top)*cv.height/Math.max(1, r.height) };
}
function eveInEllipse(p, c, rx, ry){ const a = (p.x - c.x)/rx, b = (p.y - c.y)/ry; return a*a + b*b <= 1; }
function eveLidAt(G){
  if(eveDrag) return { x:eveDrag.x, y:eveDrag.y };
  if(EVE.lid) return G.pan;
  if(eveLidHome()) return G.work;
  return null;
}
function eveOverPan(G, p){ return eveInEllipse(p, G.pan, PAN_R*EVE_LID_ON, PAN_R*TILT*EVE_LID_ON); }
// Стойка: роти подан, если палец отпущен выше нижнего края стойки — или над псом (night.js), когда он берёт.
function eveningCounterHit(client){
  eveServePt = client;
  if(eveDev) return false;
  return evePt(client.x, client.y).y <= eveGeo().counter.y1 || (typeof nightDogHit === "function" && nightDogHit(client));
}
// Где что лежит, в CSS px окна — для проверок касаниями.
function eveningSpots(){
  const G = eveGeo(), r = cv.getBoundingClientRect(), k = r.width/cv.width, ky = r.height/cv.height;
  const c = p => ({ x:r.left + p.x*k, y:r.top + p.y*ky });
  const lid = eveLidAt(G);
  return { lamp:c(G.lamp), radio:c(G.radio), bowl:c(G.bowl), pan:c(G.pan), work:c(G.work), lump:c(G.lump),
    counter:c({ x:(G.counter.x0 + G.counter.x1)/2, y:(G.counter.y0 + G.counter.y1)/2 }),
    counterBottom:r.top + G.counter.y1*ky, lid:lid ? c(lid) : null, lidHome:eveLidHome(), panR:PAN_R*k,
    swing:+eveLampAngle().toFixed(4), swings:eveSwing.n };
}

// ─────────────────────────── ввод (стенд зовёт первым; true — касание забрано)
function eveningDown(id, cx, cy, t){
  if(eveDev) return false;
  eveIdleAt = performance.now();                           // трогает экран — значит, не стоит: подсказка простоя ждёт
  if(!eveWake) eveWakeSync();                              // вернулась после долгого простоя — экран снова держится
  const sheet = eveEl("radioSheet");
  if(sheet && !sheet.hidden) return true;
  if(typeof notebookDown === "function" && notebookDown(id, cx, cy)) return true;   // тетрадь: открыта — забирает всё; закрыта — своё место рядом с радио
  const G = eveGeo(), p = evePt(cx, cy);
  if(Math.hypot(p.x - G.radio.x, p.y - G.radio.y) <= G.radio.hit){ eveRadio(true); return true; }
  if(typeof shelfDown === "function" && shelfDown(id, cx, cy)) return true;         // банка на полке (shelf.js)
  if(EVE.over){
    if(eveInEllipse(p, G.lump, G.lump.r*1.5, G.lump.r*1.5)) eveNewEvening("lump");
    return true;
  }
  if(!EVE.lamp){                                           // до лампы стол на жесты не отвечает
    if(Math.hypot(p.x - G.lamp.x, p.y - G.lamp.y) <= G.lamp.hit) eveLight();
    else eveSwingStart(EVE_SWING_TAP);                     // тап в темноте: лампа качнулась — «начни с меня»
    return true;
  }
  const lid = eveLidAt(G);
  if(lid && !eveDrag && eveInEllipse(p, lid, G.lidR, G.lidR*TILT)){
    eveDrag = { id, x:lid.x, y:lid.y, dx:lid.x - p.x, dy:lid.y - p.y };
    return true;
  }
  if(EVE.lid || eveDrag) return true;                      // тава под крышкой: всё ждёт, пока крышку не снимут
  if(!EVE.ball){                                           // стол свободен: отвечает только миска
    if(eveInEllipse(p, G.bowl, G.bowl.rx*1.15, G.bowl.ry*1.6)) eveTakeBall();
    return true;
  }
  return false;                                            // шарик в работе: жесты — стенду, миска молчит
}
function eveningMove(id, cx, cy, t){
  if(typeof notebookMove === "function" && notebookMove(id, cx, cy)) return true;
  if(!eveDrag || eveDrag.id !== id) return false;
  const p = evePt(cx, cy);
  eveDrag.x = p.x + eveDrag.dx; eveDrag.y = p.y + eveDrag.dy;
  return true;
}
function eveningUp(id, cx, cy, t, cancel){
  if(typeof notebookUp === "function" && notebookUp(id, cx, cy, cancel)) return true;
  if(typeof shelfUp === "function" && shelfUp(id, cx, cy, cancel)) return true;
  if(!eveDrag || eveDrag.id !== id) return false;
  if(Number.isFinite(cx) && Number.isFinite(cy)){ const p = evePt(cx, cy); eveDrag.x = p.x + eveDrag.dx; eveDrag.y = p.y + eveDrag.dy; }
  const G = eveGeo(), on = eveOverPan(G, eveDrag), wasOn = EVE.lid;
  eveDrag = null;
  if(cancel) return true;                                  // отменённое касание: крышка остаётся, где была
  if(!wasOn && on) eveLidEnd();                            // конец вечера: крышка с стола легла на таву
  else if(wasOn && !on) eveLidOff();                       // пауза снята: крышку унесли в сторону
  return true;
}

// ─────────────────────────── радио: единственное место со словами
function eveRadio(open){
  const sheet = eveEl("radioSheet"); if(!sheet) return;
  sheet.hidden = !open;
  eveRestartArmed = 0;
  const rb = eveEl("evRestart"); if(rb) rb.textContent = "начать вечер заново";
  const bd = eveEl("evBuild"); if(bd) bd.textContent = "сборка " + BUILD.split("·").pop().trim() + " · " + BUILD.split("·")[0].trim();
  if(open) eveLog("radio");
}
function eveBind(id, fn){ const el = eveEl(id); if(el) el.addEventListener("click", fn); }
eveBind("radioSheet", e => { if(e && e.target && e.target.id === "radioSheet") eveRadio(false); });
eveBind("evClose", () => eveRadio(false));
eveBind("radioBtn", () => eveRadio(true));
eveBind("evRestart", () => {
  // Второе нажатие подтверждает: одно случайное касание не должно стирать вечер.
  if(!eveRestartArmed){ eveRestartArmed = 1; const b = eveEl("evRestart"); if(b) b.textContent = "точно заново? нажми ещё раз"; return; }
  eveRadio(false);
  if(eveDev) eveSetDev(false);
  eveNewEvening("radio");
});
eveBind("evPanel", () => {
  eveRadio(false);
  eveSetDev(!eveDev);
  eveApply();
  if(typeof resize === "function") resize();
});
eveBind("evLog", async () => {
  const b = eveEl("evLog"), r = await copyPlayLog();
  if(b){ b.textContent = r.ok ? `скопировано (${r.n})` : "не скопировалось"; setTimeout(() => { b.textContent = "скопировать журнал"; }, 1800); }
});

// ─────────────────────────── служебная строка сверху
// Стенд зовёт это каждый кадр со своей строкой (cur). null — оставить её как есть; иначе — наши слова.
// Сборка 80: слова игры пишет сам стенд — одна короткая строка, подсказка гаснет после первого удачного
// жеста (stand.js: tip/learn). Здесь остались только слова рамки (крышка, миска) и замена двух строк
// прибора стенда про кнопки, которых в игре нет («сейчас порвётся», «заново»).
const EVE_WORDS = [
  ["порвался без", "порвался — неси на таву"],
  ["лист уже порван", "порван — неси на таву"],
];
function eveningLive(cur){
  if(eveDev) return null;
  if(typeof notebookOpen === "function" && notebookOpen()) return "";   // в тетради слов нет
  if(EVE.over) return typeof nightDraw === "function" ? "" : `вечер окончен · ${EVE_COUNT[EVE.rotiDone] || EVE.rotiDone} роти`;   // с night.js конец вечера — ночной кадр, без слов
  if(!EVE.lamp) return "";
  if(EVE.lid) return "крышка — сдвинь её в сторону";
  const idle = performance.now() - eveIdleAt > EVE_IDLE_HINT_MS;
  if(!EVE.ball) return !idle ? "" : EVE.ballsLeft > 0 ? "следующий шарик — в миске" : "накрой таву крышкой";
  const m = typeof cur === "string" ? cur : "";
  if(typeof shelfLive === "function"){ const s = shelfLive(m); if(s) return s; }   // варенье в руке; бананов нет
  for(const [from, to] of EVE_WORDS) if(m.startsWith(from)) return to;
  return null;
}

// ─────────────────────────── кадр
function eveningUpdate(dt){
  if(eveDev) return;
  if(frameOn) setFrame("");                                // рамы-картинки — прибор стенда; вечер идёт на своём столе
  eveSwingUpdate(dt);
  if(eveStageNow() !== eveStage) eveSave();                // шаг сменился — сохранить
  if(typeof guestUpdate === "function") guestUpdate(dt);
  if(typeof notebookUpdate === "function") notebookUpdate(dt);
  if(typeof nightUpdate === "function") nightUpdate(dt);
  if(typeof shelfUpdate === "function") shelfUpdate(dt);
  if(eveWake && !eveWakeWanted()) eveWakeSync();           // телефон оставлен на 5 минут — экран отпускается
}
function eveningDraw(g, sx, sy, layer){
  if(eveDev) return;
  const G = eveGeo(), u = G.u;
  const ell = (c, rx, ry, fill) => { g.fillStyle = fill; g.beginPath(); g.ellipse(c.x*sx, c.y*sy, Math.max(.5, rx*sx), Math.max(.5, ry*sy), 0, 0, Math.PI*2); g.fill(); };
  const box = (x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(x*sx, y*sy, w*sx, h*sy); };
  if(layer === 0){
    // небо темнеет с каждым готовым роти; ночь — когда вечер окончен
    box(0, G.sky.y0, G.W, G.sky.y1 - G.sky.y0, EVE_SKY[EVE.over ? 3 : Math.min(3, EVE.rotiDone)]);
    if(typeof guestDraw === "function") guestDraw(g, sx, sy, G);   // гость за стойкой и полка с подарками — стойка ляжет поверх
    // стойка и готовые роти на ней
    const C = G.counter;
    box(C.x0, C.y0, C.x1 - C.x0, C.y1 - C.y0, "#3a2c1e");
    box(C.x0, C.y0, C.x1 - C.x0, Math.max(1, 2*u), "#4a3a24");
    box(C.x0, C.y1 - Math.max(1, 2*u), C.x1 - C.x0, Math.max(1, 2*u), "#1d150e");
    const cm = { x:(C.x0 + C.x1)/2, y:(C.y0 + C.y1)/2 }, ry = Math.min(11*u, (C.y1 - C.y0)*0.32);
    const onCounter = EVE.rotiDone - (typeof guestTook === "function" ? guestTook() : 0) - (typeof nightTook === "function" ? nightTook() : 0);   // отданные гостю и псу на стойке не лежат
    for(let i=0;i<onCounter;i++) ell({ x:cm.x + (i - 1)*66*u, y:cm.y }, 25*u, ry, "#c9a15a");
    // радио
    const R = G.radio;
    box(R.x0 + R.w*0.78, R.y0 - 9*u, Math.max(1, 1.5*u), 9*u, "#8b7f6e");
    box(R.x0, R.y0, R.w, R.h, "#4b4338");
    ell({ x:R.x0 + R.w*0.30, y:R.y }, R.h*0.30, R.h*0.30, "#2a2622");
    box(R.x0 + R.w*0.58, R.y0 + R.h*0.30, R.w*0.30, R.h*0.16, "#d98b3a");
    if(typeof notebookDrawItem === "function") notebookDrawItem(g, sx, sy, G);   // тетрадь рядом с радио
    // миска: сколько шариков осталось
    const B = G.bowl;
    ell(B, B.rx, B.ry, "#8b7f6e");
    ell({ x:B.x, y:B.y - 2*u }, B.rx*0.88, B.ry*0.80, "#1d150e");
    for(let i=0;i<EVE.ballsLeft;i++) ell({ x:B.x + (i - 1)*30*u, y:B.y - 4*u }, 13*u, 12*u, "#f0e0b0");
    if(typeof nightDrawUnder === "function") nightDrawUnder(g, sx, sy, G);   // пёс под тележкой, слева от миски
    return;
  }
  if(typeof guestDrawOver === "function") guestDrawOver(g, sx, sy, G);   // роти несут гостье: она видна поверх него
  if(typeof nightDrawOver === "function") nightDrawOver(g, sx, sy, G);   // и пёс тоже
  // крышка: дома на столе (конец вечера), в руке или на таве
  const lid = eveLidAt(G);
  if(lid){
    ell(lid, G.lidR, G.lidR*TILT, "#2a2622");
    ell(lid, G.lidR*0.94, G.lidR*TILT*0.94, "#5d564b");
    ell({ x:lid.x, y:lid.y - G.lidR*TILT*0.06 }, G.lidR*0.13, G.lidR*TILT*0.13, "#2a2622");
  }
  // лампа не горит — тележка в сумерках: один плоский тёмный слой, без градиента
  if(!EVE.lamp) box(0, G.sky.y1, G.W, G.H - G.sky.y1, "rgba(8,6,10,0.55)");
  // лампа над тележкой
  const L = G.lamp, s = L.s, swing = eveLampAngle();
  g.save();
  if(swing){ g.translate(L.x*sx, 0); g.rotate(swing); g.translate(-L.x*sx, 0); }   // качается на шнуре, вокруг точки подвеса
  box(L.x - Math.max(.5, 0.75*u), 0, Math.max(1, 1.5*u), L.y - s, EVE.lamp ? "#1d150e" : "#4b4338");   // негорящая: шнур виден на тёмном небе
  g.fillStyle = EVE.lamp ? "#d98b3a" : "#3a342d";
  g.beginPath();
  g.moveTo((L.x - s*0.45)*sx, (L.y - s)*sy); g.lineTo((L.x + s*0.45)*sx, (L.y - s)*sy);
  g.lineTo((L.x + s*1.15)*sx, (L.y + s*0.15)*sy); g.lineTo((L.x - s*1.15)*sx, (L.y + s*0.15)*sy);
  g.closePath(); g.fill();
  ell({ x:L.x, y:L.y + s*0.42 }, s*0.5, s*0.5, EVE.lamp ? "#f0c674" : "#4b4338");
  g.restore();
  // вечер окончен: ком теста на столе — касание начинает следующий вечер
  if(EVE.over) ell(G.lump, G.lump.r, G.lump.r*0.8, "#f0e0b0");
  if(typeof nightDraw === "function") nightDraw(g, sx, sy, G);         // ночной кадр: снимки вечера над стойкой
  if(typeof notebookDraw === "function") notebookDraw(g, sx, sy, G);   // открытая тетрадь — поверх всей сцены
}

// ─────────────────────────── экран не гаснет (Screen Wake Lock)
// Жарка — минуты без касаний, телефон заблокировался бы раньше. Пока лампа горит и страница видна,
// стенд держит экран включённым; свернули — система отпускает сама, вернулись — просим снова;
// вечер окончен — отпускаем. Оставила телефон с зажжённой лампой — через 5 минут без касаний отпускаем
// тоже (жарка одного роти короче); первое касание просит снова.
// Где navigator.wakeLock нет или в нём отказано — ничего не происходит.
let eveWake = null, eveWakeAsk = false;
function eveWakeWanted(){ return !eveDev && EVE.lamp && !EVE.over && !document.hidden && performance.now() - eveIdleAt < EVE_WAKE_IDLE_MS; }
function eveWakeSync(){
  if(!eveWakeWanted()){
    if(eveWake){ const w = eveWake; eveWake = null; try{ w.release(); }catch(e){} }
    return;
  }
  if(eveWake || eveWakeAsk) return;
  const wl = typeof navigator !== "undefined" && navigator ? navigator.wakeLock : null;
  if(!wl || typeof wl.request !== "function") return;
  try{
    const p = wl.request("screen");
    if(!p || typeof p.then !== "function") return;
    eveWakeAsk = true;
    p.then(lock => {
      eveWakeAsk = false;
      if(!lock) return;
      if(!eveWakeWanted()){ try{ lock.release(); }catch(e){} return; }
      eveWake = lock;
      if(typeof lock.addEventListener === "function") lock.addEventListener("release", () => { if(eveWake === lock) eveWake = null; });
    }, () => { eveWakeAsk = false; });
  }catch(e){ eveWakeAsk = false; }
}

// ─────────────────────────── запуск
// Свернула приложение или позвонили — крышка сама ложится на таву, жарка стоит.
document.addEventListener("visibilitychange", () => { if(document.hidden) eveLidPause(); eveWakeSync(); });
{ const s = eveEl("radioSheet"); if(s) s.hidden = true; }
eveLoad();
eveSetDev(/[?&]dev=1(&|$)/.test(String((typeof location !== "undefined" && location.search) || "")));
eveApply();
