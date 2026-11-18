"use strict";
/* Второй вечер: полка, которая кончается — шаг 5 v0 (docs/v0-step5-second-evening.md).
   Грузится ПОСЛЕ night.js и только смотрит на стенд. Здесь:
   НОМЕР ВЕЧЕРА n (1, 2, 3…): ком в ночном кадре начинает следующий вечер, «начать вечер заново» в радио —
   тот же вечер сначала. Ни то ни другое полку и прошлые страницы тетради не трогает; стереть всё можно
   только кнопкой в радио, которая видна в режиме стенда (?dev=1 или «панель стенда»).
   ПОЛКА: не больше одной связки бананов (на 2 роти) и одной банки варенья (на 3 роти). Подарок Сом того же
   вида пополняет, а не добавляет вторую. Вещь лежит на полке — её можно брать, в тот же вечер тоже.
   БАНАНЫ: касание середины открытого листа кладёт банан, пока в связке что-то есть; первое касание на
   этом роти убирает из связки один банан (2 → 1 → связки нет). Пусто — середина банан не кладёт, роти
   выходит простым. Своего жеста нет: это жест banana.js, здесь только «можно ли» (обёртка canPlaceBanana).
   ВАРЕНЬЕ: касание банки, потом палец по нарезанному роти на столе — полоса варенья (жест полива
   drizzle.js, цвет варенья, без брызг и выбега). Первая полоса на этом роти опускает уровень в банке на
   одну ступень (3 → 2 → 1 → пусто). Пустая банка остаётся на полке; касание убирает её под стойку.
   СОМ НА ДРУГОЙ ДЕНЬ (guest.js спрашивает отсюда): вчера оставила варенье — приходит с пустой банкой в руке
   и через 3 с ставит её на полку; вчера был кивок — приходит на 5-й секунде жарки и стучит сразу.
   Рамка вечера и гостья зовут отсюда под typeof: shelfNewEvening, shelfDown, shelfUp, shelfUpdate, shelfLive,
   shelfDraw, shelfGift, shelfSomArrive, shelfKnockWait, shelfSomJar, shelfSomState, shelfN, shelfState,
   shelfExport. Без этого файла вечер идёт как в шаге 4.
   Правила владелицы 17.11: плоские фигуры в палитре стенда, уровень и связка меняются ступенями — ни
   свечения, ни частиц, ни анимаций; звука нет; слов нет, кроме одной служебной строки. */

const SHELF_V = 1;
const SHELF_BANANAS = 2, SHELF_JAM = 3;      // связка на 2 роти, банка на 3
const SHELF_ARRIVE_EARLY_S = 5;              // после вчерашнего кивка Сом приходит на 5-й секунде жарки (обычно на 8-й)
const SHELF_KNOCK_EARLY_S = 0.01;            // и стучит сразу (обычно через 1,5 с)
const SHELF_JAR_HAND_S = 3;                  // сколько пустая банка у неё в руке, прежде чем встать на полку
const SHELF_CELL = 30, SHELF_HIT = 22;       // CSS px: шаг вещей на полке и запас касания по сторонам
const SHELF_W = 82;                          // доска полки: три места с шагом 30 (у гостьи без этого файла она 74)
const SHELF_FLIGHT_S = 0.6;                  // сколько подарок Сом летит от неё до полки (одно прямое движение)
const SHELF_TINT = { fill:"#a8402c", rim:"rgba(29,21,14,0.55)" };   // полоса варенья: цвет банки
const SHELF_GLASS = "#8b7f6e", SHELF_LID = "#d9d2c0", SHELF_LABEL = "#e8dcc0", SHELF_RED = "#a8402c", SHELF_YELLOW = "#e3c04a", SHELF_MARK = "#3a2c1e";

function shelfFresh(){
  return { v:SHELF_V, n:1, bananas:0, jam:0, jar:false, empty:false, banBall:0, jamBall:0,
    som:{ jar:false, early:false }, jarIn:null, begun:false, again:false };
}
let SHF = shelfFresh();
let shelfEvents = [];                  // журнал полки: хранится в roti_evening.shelf.events
let sArmed = false, sSeen = false, sBefore = 0;   // варенье в руке: ждём штрих, был ли он, сколько полос было до него
let sDown = null;                      // палец на банке: {id, what}
let sBack = false;                     // это касание банки ставит варенье обратно (оно было в руке), а не берёт
let sHand = 0;                         // сколько банка уже у Сом в руке
let sTravel = null;                    // подарок летит от Сом к полке: {gift, from, to, before, t, dur}

// ─────────────────────────── сохранение и журнал
function shelfState(){ return { ...SHF, events:shelfEvents }; }
function shelfExport(){ return { state:{ ...SHF, armed:sArmed, somState:shelfSomState() || null }, events:shelfEvents }; }
function shelfN(){ return SHF.n; }
function shelfBall(){ return EVE_BALLS - EVE.ballsLeft; }
function shelfLoad(){
  const s = typeof eveShelfRaw !== "undefined" ? eveShelfRaw : null;
  if(!s || s.v !== SHELF_V){
    // сохранение сборки 78: полки ещё нет, подарки этого вечера лежат у гостьи — переносим
    if(typeof GST !== "undefined") for(const gift of GST.gifts){ if(gift === "bananas") SHF.bananas = SHELF_BANANAS; else { SHF.jam = SHELF_JAM; SHF.jar = true; } }
    return;
  }
  const n = (x, max) => Math.max(0, Math.min(max, Math.round(+x) || 0));
  const som = s.som && typeof s.som === "object" ? s.som : {};
  SHF = { v:SHELF_V, n:Math.max(1, Math.round(+s.n) || 1), bananas:n(s.bananas, SHELF_BANANAS), jam:n(s.jam, SHELF_JAM),
    jar:!!s.jar || n(s.jam, SHELF_JAM) > 0, empty:!!s.empty, banBall:n(s.banBall, EVE_BALLS), jamBall:n(s.jamBall, EVE_BALLS),
    som:{ jar:!!som.jar, early:!!som.early }, jarIn:s.jarIn === "wait" || s.jarIn === "hand" || s.jarIn === "shelf" ? s.jarIn : null, begun:!!s.begun, again:!!s.again };
  if(Array.isArray(s.events)) shelfEvents = s.events.slice(-60);
}
function shelfLog(event, item, extra){
  const row = { event, item, n:SHF.n, ballNo:shelfBall(), bananas:SHF.bananas, jam:SHF.jam, ...(extra || {}), ts:new Date().toISOString() };
  shelfEvents.push(row); if(shelfEvents.length > 60) shelfEvents.shift();
  gestures.push({ ...measurementContext(), kind:"shelf", ...row });
  if(gestures.length > 200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
  eveSave();
}
function shelfContents(){ return { bananas:SHF.bananas, jam:SHF.jam, jar:SHF.jar, emptyJar:SHF.empty }; }

// ─────────────────────────── вечера
// evening.js зовёт это из eveNewEvening ДО сброса гостьи: вчерашние ответы Сом ещё на месте.
// from "lump" — ком в ночном кадре: следующий вечер. from "radio" — тот же вечер сначала: номер и то,
// какой Сом придёт сегодня, остаются. Полку не трогает ни то ни другое.
function shelfNewEvening(from, wasOver){
  shelfDisarm();
  if(from === "lump"){
    const a = typeof GST !== "undefined" ? GST.answers : [];
    SHF.som = { jar:a.some(x => x.answer === "crunch"), early:a.some(x => x.answer === "nod") };
    SHF.n++;
  }
  // тот же вечер сначала (радио): в журнале его второе начало помечено again; пустую банку Сом несёт снова,
  // только если ещё не донесла — донесённая уже на полке (или убрана), вторая такая же не появляется
  SHF.again = from === "radio" && (SHF.begun || SHF.again);
  SHF.jarIn = !SHF.som.jar ? null : from === "radio" && SHF.jarIn === "shelf" ? "shelf" : "wait";
  SHF.banBall = 0; SHF.jamBall = 0; SHF.begun = false; sHand = 0; sDown = null; sBack = false;
}
// Подарок Сом ложится на полку (guest.js зовёт из guestServe): тот же вид пополняется до полного.
// Запас пишется сразу (перезагрузка посреди полёта подарок не теряет), а сам предмет одним прямым
// движением за SHELF_FLIGHT_S едет от неё (guestSlot) к своему месту на полке — без дуг и свечения.
function shelfGift(gift){
  if(gift !== "bananas" && gift !== "jam") return;
  let from = null, to = null;
  try{
    const G = eveGeo(), S = guestSlot(G), P = shelfGeo(G);
    from = { x:S.x0 + S.w/2, y:S.y0 + S.h*0.6 };
    to = gift === "bananas" ? { x:P.bunch.x, y:P.bunch.y } : { x:P.jar.x, y:P.jar.y };
  }catch(e){ from = to = null; }
  const before = { bananas:SHF.bananas, jam:SHF.jam, jar:SHF.jar };
  if(gift === "bananas"){ const was = SHF.bananas; SHF.bananas = SHELF_BANANAS; shelfLog("refill", "bananas", { was }); }
  else if(gift === "jam"){ const was = SHF.jam; SHF.jam = SHELF_JAM; SHF.jar = true; shelfLog("refill", "jam", { was }); }
  sTravel = from && to ? { gift, from, to, before, t:0, dur:SHELF_FLIGHT_S } : null;
}
// Стереть всё — вечера, полку, тетрадь. Только из режима стенда (кнопка #evWipe видна при html.dev).
function shelfWipe(){
  shelfDisarm();
  EVE = eveFresh(); eveEvents = [];
  eveGuestRaw = null; eveNbRaw = null; eveNightRaw = null;
  if(typeof guestReset === "function") guestReset();
  if(typeof nightReset === "function") nightReset();
  if(typeof nbFresh === "function"){ NB = nbFresh(); nbEvents = []; nbPage = 0; }
  SHF = shelfFresh(); shelfEvents = []; sHand = 0; sDown = null;
  eveLog("wipe");
  eveApply();
}

// ─────────────────────────── бананы: можно ли и кто платит
function shelfBananaOk(){ return eveDev || SHF.bananas > 0 || (SHF.banBall > 0 && SHF.banBall === shelfBall()); }
(function wrapBanana(){
  const can = window.canPlaceBanana, add = window.addBananaSlice;
  if(typeof can !== "function" || typeof add !== "function" || can._shelf) return;
  const canW = function(){ return can.apply(this, arguments) && shelfBananaOk(); };
  canW._shelf = true;
  const addW = function(){
    const ok = add.apply(this, arguments);
    if(ok && !eveDev && EVE.lamp && EVE.ball && SHF.banBall !== shelfBall()){   // первый ломтик на этом роти — минус один банан в связке
      SHF.bananas = Math.max(0, SHF.bananas - 1); SHF.banBall = shelfBall();
      shelfLog("use", "bananas");
      if(SHF.bananas === 0) shelfLog("empty", "bananas");
    }
    return ok;
  };
  window.canPlaceBanana = canW; window.addBananaSlice = addW;
})();

// ─────────────────────────── варенье
// Роти нарезан и лежит на столе, никто его не несёт; в банке что-то есть или этот роти уже с вареньем.
function shelfJamCan(){
  if(eveDev || !EVE.lamp || EVE.over || EVE.lid || !EVE.ball) return false;
  if(typeof setDrizzleMode !== "function") return false;
  if(!dish || dish.mode !== "cut" || phase !== "CUT" || !dish.cuts.length || dishMove || dishGesture) return false;
  return SHF.jam > 0 || (SHF.jamBall > 0 && SHF.jamBall === shelfBall());
}
function shelfArm(){
  if(sArmed || !shelfJamCan()) return false;
  window.drizzleTint = SHELF_TINT;
  setDrizzleMode(true);
  if(!window.drizzleModeOn){ window.drizzleTint = null; return false; }
  sArmed = true; sSeen = false; sBefore = window.drizzleStrokes || 0;
  return true;
}
function shelfDisarm(){
  if(!sArmed) return;
  sArmed = false; sSeen = false;
  if(typeof setDrizzleMode === "function" && window.drizzleModeOn) setDrizzleMode(false);
  window.drizzleTint = null;
}

// Полосы рисует drizzle.js поверх готового кадра. В игре над роти бывает ещё кое-что: открытая тетрадь
// (полосы под ней не рисуются) и гостья с псом, когда роти несут к ним (они рисуются поверх ещё раз).
(function wrapDrizzleDraw(){
  const orig = window.drizzleDraw;
  if(typeof orig !== "function" || orig._shelf) return;
  const w = function(g){
    if(eveDev) return orig.apply(this, arguments);
    if(typeof notebookOpen === "function" && (notebookOpen() || (typeof nbAnim !== "undefined" && nbAnim > 0))) return;
    const strokes = window.drizzleStrokes || 0;
    orig.apply(this, arguments);
    if(!strokes) return;
    const G = eveGeo();
    if(typeof guestDrawOver === "function") guestDrawOver(g, 1, 1, G);
    if(typeof nightDrawOver === "function") nightDrawOver(g, 1, 1, G);
  };
  w._shelf = true;
  window.drizzleDraw = w;
})();

// ─────────────────────────── Сом на другой день (guest.js спрашивает под typeof)
function shelfSomArrive(normal){ return SHF.som.early ? Math.min(normal, SHELF_ARRIVE_EARLY_S) : normal; }
function shelfKnockWait(normal){ return SHF.som.early ? SHELF_KNOCK_EARLY_S : normal; }
function shelfSomJar(){ return SHF.jarIn === "hand" && typeof GST !== "undefined" && GST.here; }
function shelfSomState(){ return SHF.som.jar && SHF.som.early ? "jar+early" : SHF.som.jar ? "jar" : SHF.som.early ? "early" : undefined; }
function shelfJarLands(why){
  SHF.jarIn = "shelf"; SHF.empty = true; sHand = 0;
  shelfLog("bring", "empty-jar", { why });
}

// ─────────────────────────── раскладка (пиксели холста)
// Три места на полке гостьи (guestShelf): связка, банка, пустая банка Сом. Места постоянные — вещи не
// переезжают, когда соседняя кончилась.
function shelfGeo(G){
  const u = G.u, F = guestShelf(G), cx = i => F.x0 + (12 + SHELF_CELL*i)*u;
  return { F, u, x1:F.x0 + Math.max(F.w, SHELF_W*u), bunch:{ x:cx(0), y:F.y }, jar:{ x:cx(1), y:F.y }, empty:{ x:cx(2), y:F.y } };
}
function shelfAny(){ return SHF.bananas > 0 || SHF.jar || SHF.empty; }
// Что под пальцем: "jar", "empty" или null. Связка на касание не отвечает — бананы кладут на лист.
function shelfHit(G, p){
  const S = shelfGeo(G), u = G.u;
  if(p.y < S.F.y - 40*u || p.y > S.F.y + 16*u) return null;
  let best = null, d = SHELF_HIT*u;
  for(const [what, on] of [["jar", SHF.jar], ["empty", SHF.empty]]){
    const dx = Math.abs(p.x - S[what].x);
    if(on && dx <= d){ d = dx; best = what; }
  }
  return best;
}
// Где что, в CSS px окна — для проверок касаниями.
function shelfSpots(){
  const G = eveGeo(), S = shelfGeo(G), r = cv.getBoundingClientRect(), k = r.width/cv.width, ky = r.height/cv.height;
  const c = p => ({ x:r.left + p.x*k, y:r.top + (p.y - 10*G.u)*ky });
  return { n:SHF.n, bananas:SHF.bananas, jam:SHF.jam, jar:SHF.jar, empty:SHF.empty, armed:sArmed, jamCan:shelfJamCan(),
    bananaOk:shelfBananaOk(), som:shelfSomState() || null, jarIn:SHF.jarIn, somJar:shelfSomJar(),
    bunchAt:SHF.bananas > 0 ? c(S.bunch) : null, jarAt:SHF.jar ? c(S.jar) : null, emptyAt:SHF.empty ? c(S.empty) : null,
    flight:sTravel ? { gift:sTravel.gift, from:{ ...sTravel.from }, to:{ ...sTravel.to }, t:+sTravel.t.toFixed(3), dur:sTravel.dur } : null };
}

// ─────────────────────────── ввод (evening.js зовёт под typeof; true — касание забрано)
// Банка отвечает на отпускание, а не на касание: пока идёт жест варенья, drizzle.js глушит ввод стенда,
// и конец касания, начатого до него, потерялся бы.
function shelfDown(id, cx, cy){
  if(eveDev || sDown) return false;
  const what = shelfHit(eveGeo(), evePt(cx, cy));
  if(!what) return false;
  sDown = { id, what };
  return true;
}
function shelfUp(id, cx, cy, cancel){
  if(!sDown || sDown.id !== id) return false;
  const what = sDown.what; sDown = null;
  if(cancel) return true;
  if(Number.isFinite(cx) && Number.isFinite(cy) && shelfHit(eveGeo(), evePt(cx, cy)) !== what) return true;   // увела палец с банки — передумала
  const back = sBack; sBack = false;
  if(what === "empty" && SHF.empty){ SHF.empty = false; shelfLog("putaway", "empty-jar"); }
  else if(what === "jar" && back){ /* варенье было в руке: касание банки поставило его обратно */ }
  else if(what === "jar" && SHF.jar){
    if(SHF.jam <= 0 && !(SHF.jamBall > 0 && SHF.jamBall === shelfBall() && shelfJamCan())){ SHF.jar = false; shelfLog("putaway", "jar"); }
    else shelfArm();
  }
  return true;
}

// Варенье в руке, а палец лёг на радио, тетрадь или банку: жест варенья (drizzle.js) это касание не забирает —
// варенье возвращается в банку, касание идёт туда, куда легло. drizzle.js спрашивает до своего жеста.
window.drizzlePass = function(cx, cy){
  if(!sArmed || eveDev) return false;
  const G = eveGeo(), p = evePt(cx, cy), what = shelfHit(G, p);
  if(!what && Math.hypot(p.x - G.radio.x, p.y - G.radio.y) > G.radio.hit && !(typeof nbItemHit === "function" && nbItemHit(G, p))) return false;
  shelfDisarm(); sBack = what === "jar";
  return true;
};

// ─────────────────────────── служебная строка
function shelfLive(cur){
  if(eveDev || typeof cur !== "string") return null;
  if(sArmed) return "варенье · проведи пальцем по роти";
  if(!shelfBananaOk()){                                    // бананов нет: строка их не обещает
    if(cur.startsWith("Положи банан")) return "заверни четыре стороны к середине";
    if(cur.endsWith(", можно начинку")) return cur.slice(0, -", можно начинку".length);
  }
  return null;
}

// ─────────────────────────── кадр
function shelfUpdate(dt){
  if(eveDev){ shelfDisarm(); sDown = null; return; }
  if(EVE.lamp && !SHF.begun){                              // лампа зажжена: вечер начат — строка в журнал, один раз
    SHF.begun = true;
    eveLog("begin", { n:SHF.n, shelf:shelfContents(), som:shelfSomState() || null, ...(SHF.again ? { again:true } : {}) });
  }
  if(sBack && !sDown) sBack = false;                       // касание ушло не на банку
  if(sTravel){ sTravel.t += dt; if(sTravel.t >= sTravel.dur) sTravel = null; }   // подарок долетел
  // пустая банка Сом: пришла — банка в руке; постояла 3 с (крышка и тетрадь счёт останавливают) — банка на полке
  if(SHF.jarIn === "wait" && typeof GST !== "undefined" && GST.here){ SHF.jarIn = "hand"; sHand = 0; eveSave(); }
  if(SHF.jarIn === "hand"){
    if(typeof GST === "undefined" || !GST.here) shelfJarLands("left");
    else if(!EVE.lid && !(typeof notebookOpen === "function" && notebookOpen())){
      sHand += dt;
      if(sHand >= SHELF_JAR_HAND_S) shelfJarLands("put");
    }
  }
  if(!sArmed) return;
  if(window.drizzleActive){ sSeen = true; return; }
  if(sSeen){                                               // штрих кончился: легла ли полоса на роти
    const landed = (window.drizzleStrokes || 0) > sBefore;
    shelfDisarm();
    if(landed && SHF.jamBall !== shelfBall()){             // первая полоса на этом роти — уровень в банке на ступень ниже
      SHF.jam = Math.max(0, SHF.jam - 1); SHF.jamBall = shelfBall();
      shelfLog("use", "jam");
      if(SHF.jam === 0) shelfLog("empty", "jam");
    } else if(landed) eveSave();
    return;
  }
  if(!window.drizzleModeOn || !dish || dish.mode !== "cut") shelfDisarm();   // роти со стола ушёл
}
// Банка: стекло, варенье до уровня (ступени — трети), крышка, наклейка и три риски уровня (3 → 2 → 1 → 0).
// open — крышка приподнята: варенье в руке.
function shelfJarDraw(g, sx, sy, x, y, u, level, open, label){
  const w = 10*u, h0 = 19*u;                                // полширины и высота стекла
  g.fillStyle = SHELF_GLASS; g.fillRect((x - w)*sx, (y - h0)*sy, 2*w*sx, h0*sy);
  const h = h0*Math.max(0, Math.min(1, level/SHELF_JAM));
  if(h > 0){ g.fillStyle = SHELF_RED; g.fillRect((x - w)*sx, (y - h)*sy, 2*w*sx, h*sy); }
  g.fillStyle = SHELF_MARK;                                 // три риски: верх каждой трети
  for(let k = 1; k <= SHELF_JAM; k++){ const my = y - h0*k/SHELF_JAM; g.fillRect((x - w - 1.5*u)*sx, (my - Math.max(0.5, 0.5*u))*sy, (2*w + 3*u)*sx, Math.max(1, 0.8*u*sy)); }
  g.fillStyle = SHELF_LID; g.fillRect((x - w - 1*u)*sx, (y - (open ? 31 : 23)*u)*sy, (2*w + 2*u)*sx, 5*u*sy);
  if(label){ g.fillStyle = SHELF_LABEL; g.fillRect((x - 5*u)*sx, (y - 13*u)*sy, 10*u*sx, 6*u*sy); }
}
// Связка: по банану на роти, веером от одной ножки — видно 2 → 1 → нет.
function shelfBunchDraw(g, sx, sy, x, y, u, count){
  g.fillStyle = SHELF_YELLOW;
  for(const a of [-0.6, 0.35].slice(0, count)){             // верхушки сходятся у ножки, низы расходятся
    g.beginPath(); g.ellipse((x + Math.sin(a)*9*u)*sx, (y - 8*u - Math.cos(a)*2*u)*sy, 5.5*u*sx, 13*u*sy, -a, 0, Math.PI*2); g.fill();
  }
  g.fillStyle = "#5a4326"; g.fillRect((x - 3*u)*sx, (y - 24*u)*sy, 4*u*sx, 5*u*sy);
}
// guest.js зовёт это вместо своей полки (после неба, до стойки).
function shelfDraw(g, sx, sy, G){
  if(eveDev || (!shelfAny() && !sTravel)) return;
  const S = shelfGeo(G), u = G.u;
  // пока подарок летит, на полке — прежний вид (вещь ещё не долетела)
  const ban = sTravel && sTravel.gift === "bananas" ? sTravel.before.bananas : SHF.bananas;
  const jam = sTravel && sTravel.gift === "jam" ? sTravel.before.jam : SHF.jam;
  const jar = sTravel && sTravel.gift === "jam" ? sTravel.before.jar : SHF.jar;
  g.fillStyle = SHELF_GLASS; g.fillRect(S.F.x0*sx, S.F.y*sy, (S.x1 - S.F.x0)*sx, Math.max(1, 3*u*sy));
  if(ban > 0) shelfBunchDraw(g, sx, sy, S.bunch.x, S.bunch.y, u, ban);
  if(jar) shelfJarDraw(g, sx, sy, S.jar.x, S.jar.y, u, jam, sArmed, true);
  if(SHF.empty) shelfJarDraw(g, sx, sy, S.empty.x, S.empty.y, u, 0, false, false);
  if(sTravel){                                             // сам подарок ещё в полёте
    const k = Math.min(1, sTravel.t/sTravel.dur);
    const px = sTravel.from.x + (sTravel.to.x - sTravel.from.x)*k, py = sTravel.from.y + (sTravel.to.y - sTravel.from.y)*k;
    if(sTravel.gift === "bananas") shelfBunchDraw(g, sx, sy, px, py, u, SHELF_BANANAS);
    else shelfJarDraw(g, sx, sy, px, py, u, SHELF_JAM, false, true);
  }
}

// ─────────────────────────── запуск
shelfLoad();
{
  const b = eveEl("evWipe");
  let armed = 0;
  if(b) b.addEventListener("click", () => {
    if(!armed){ armed = 1; b.textContent = "точно стереть? нажми ещё раз"; return; }
    armed = 0; b.textContent = "стереть всё: вечера, полку, тетрадь";
    if(typeof eveRadio === "function") eveRadio(false);
    shelfWipe();
  });
}
eveSave();
