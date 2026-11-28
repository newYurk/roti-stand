"use strict";
/* Третий шарик и ночь — шаг 4 v0 (docs/v0-step4-night.md).
   Грузится ПОСЛЕ notebook.js и только смотрит на стенд. Две вещи:
   ПЁС спит под тележкой, внизу слева от миски. Нарезанный роти, отпущенный над ним, достаётся ему —
   с третьего шарика, а раньше любой роти, который Сом не берёт (её нет или она ответила дважды).
   Своего жеста нет: это тот же перенос, что на стойку. Единственная подсказка — поза: роти в руке
   поднялся выше нижней трети экрана — пёс поднял голову и держит её, пока роти в руке.
   НОЧНОЙ КАДР вместо строки «вечер окончен»: над стойкой три снимка этого вечера из тетради с меткой,
   кому ушёл каждый (Сом / пёс / стойка); полку с подарками, тележку под крышкой и ком теста рисуют
   evening.js и guest.js, как раньше. После перезагрузки оконченный вечер открывается этим же кадром.
   Рамка вечера зовёт отсюда под typeof: nightDogHit, nightServe, nightTook, nightUpdate, nightDrawUnder,
   nightDrawOver, nightDraw, nightReset, nightState, nightExport. Без этого файла вечер идёт как в шаге 3.
   Правила владелицы 17.11: плоские фигуры в палитре стенда, без свечения, частиц и анимаций — позы пса
   сменяются, а не двигаются (взмах хвоста — две нарисованные чёрточки); звука нет; слов нет.
   ВТОРОЙ ВЕЧЕР И ДАЛЬШЕ (шаг 5 v0, shelf.js): вчерашние три снимка — отдельной строкой под сегодняшними,
   тех же размеров, приглушённые, без меток; ни оценок, ни стрелок.
   Пёс — заглушка: по решению 17.09 собак две (мама и дочка), окрас и имена не утверждены. */

const NIGHT_V = 1;
const NIGHT_EAT_S = 2.5;               // сколько пёс стоит в позе «ест» (как ответ Сом)
const NIGHT_LOOK_Y = 2/3;              // роти в руке выше этой доли высоты экрана — пёс поднимает голову
const NIGHT_DOG = { w:100, h:56, left:8, bottom:8, pad:14 };   // CSS px: рамка пса и запас зоны «ему»
const NIGHT_SIL = 2.5;                 // CSS px: на сколько тёмный силуэт под псом шире его самого (только поверх роти в руке)
const NIGHT_FUR = "#d9d2c0", NIGHT_EAR = "#8b7f6e", NIGHT_DARK = "#1d150e";

function nightFresh(){ return { v:NIGHT_V, dog:0, shown:false }; }
let NGT = nightFresh();
let nightEvents = [];                  // журнал: хранится в roti_evening.night.events
let nEat = 0, nLook = false;           // живёт только в кадре: остаток позы «ест», голова поднята
let nShownHow = "lid";                 // как открыт ночной кадр: крышкой или запуском после оконченного вечера

// ─────────────────────────── сохранение и журнал
function nightState(){ return { ...NGT, events:nightEvents }; }
function nightExport(){ return { state:{ ...NGT, pose:nightDogPose(), frame:nightFrameOn() }, events:nightEvents }; }
function nightTook(){ return NGT.dog; }
function nightLoad(){
  const s = typeof eveNightRaw !== "undefined" ? eveNightRaw : null;
  if(!s || s.v !== NIGHT_V) return;
  NGT = { v:NIGHT_V, dog:Math.max(0, Math.min(EVE_BALLS, Math.round(+s.dog) || 0)), shown:!!s.shown };
  if(Array.isArray(s.events)) nightEvents = s.events.slice(-40);
}
function nightLog(event, extra){
  const row = { event, ballNo:EVE_BALLS - EVE.ballsLeft, ...(extra || {}), ts:new Date().toISOString() };
  nightEvents.push(row); if(nightEvents.length > 40) nightEvents.shift();
  gestures.push({ ...measurementContext(), kind:"night", ...row });
  if(gestures.length > 200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
  eveSave();
}
function nightReset(){ NGT = nightFresh(); nightEvents = []; nEat = 0; nLook = false; nShownHow = "lid"; }

// ─────────────────────────── пёс
// Берёт ли пёс роти, который сейчас в работе: с третьего шарика — всегда; раньше — если Сом его не берёт.
function nightDogWants(){
  if(eveDev || !EVE.lamp || EVE.over || EVE.lid || !EVE.ball) return false;
  if(EVE_BALLS - EVE.ballsLeft >= 3) return true;
  return !(typeof GST !== "undefined" && GST.here && GST.answers.length < 2);
}
function nightCarried(){ return !!dish && dish.mode === "cut" && !!dishGesture && dishGesture.zone === "serve" && !!dishGesture.carry; }
function nightDogPose(){ return nEat > 0 ? 2 : nLook ? 1 : 0; }   // 0 спит, 1 поднял голову, 2 ест
// Рамка пса (пиксели холста): левый нижний угол, не шире места слева от миски.
function nightDogBox(G){
  const u = G.u, D = NIGHT_DOG;
  const w = Math.max(60*u, Math.min(D.w*u, G.bowl.x - G.bowl.rx*1.15 - (D.left + 6)*u)), h = w*D.h/D.w;
  const x0 = D.left*u, y1 = G.H - D.bottom*u;
  return { x0, x1:x0 + w, y0:y1 - h, y1, w, h, zone:{ x1:x0 + w + D.pad*u, y0:y1 - h - D.pad*u } };
}
function nightOverDog(client){
  if(!client) return false;
  const Z = nightDogBox(eveGeo()).zone, p = evePt(client.x, client.y);
  return p.x <= Z.x1 && p.y >= Z.y0;
}
// evening.js спрашивает это вместе со стойкой: отпущен ли роти там, где его подают.
// Ненарезанный роти псу не подаётся и штриху из середины в его угол не мешает: это обычный рез (ревью шага 4).
function nightDogHit(client){ return nightDogWants() && !!dish && dish.cuts.length > 0 && nightOverDog(client); }
// Слов про пса нет нигде; с сборки 80 строка стенда не называет, куда нести («нарезано — за середину и
// неси»), поэтому своих слов у этого файла больше нет (nightLive убран).
// evening.js зовёт это из eveningServed после гостьи (она смотрит первой), ДО сброса стенда.
function nightServe(client){
  if(!nightDogHit(client)) return null;
  NGT.dog++; nEat = NIGHT_EAT_S; nLook = false;
  nightLog("eat", { dog:NGT.dog });
  return "dog";
}
function nightUpdate(dt){
  if(eveDev){ nEat = 0; nLook = false; return; }
  if(nEat > 0) nEat = Math.max(0, nEat - dt);
  if(EVE.over && !NGT.shown){                              // ночной кадр показан: строка в журнал, один раз за вечер
    NGT.shown = true;
    nightLog("frame", { how:nShownHow, to:nightSnaps().map(s => s.to), gifts:typeof GST !== "undefined" ? GST.gifts.slice() : [],
      ...(typeof shelfN === "function" ? { n:shelfN(), yesterday:nightPast().map(s => s.to) } : {}) });
  }
  if(!nightCarried()){ nLook = false; return; }
  if(nLook || !nightDogWants()) return;
  const s = dishGesture.samples, last = s[s.length - 1], r = cv.getBoundingClientRect();
  if(last && last.y < r.top + r.height*NIGHT_LOOK_Y){ nLook = true; nightLog("look"); }
}

// ─────────────────────────── ночной кадр
function nightFrameOn(){ return !eveDev && EVE.over; }
function nightSnaps(){ return typeof notebookEvening === "function" ? notebookEvening() : []; }
// Вчерашние снимки — со второго вечера (shelf.js считает вечера, notebook.js хранит страницы).
function nightPast(){ return typeof shelfN === "function" && shelfN() >= 2 && typeof notebookYesterday === "function" ? notebookYesterday().slice(0, EVE_BALLS) : []; }
// Ряд карточек над стойкой: между полкой с тетрадью слева и лампой справа, от строки сверху до стойки.
function nightRow(G){
  const u = G.u, n = EVE_BALLS, gap = 8*u, markH = 30*u;
  const F = typeof guestShelf === "function" ? guestShelf(G) : { x0:G.counter.x0, w:0 };
  const xa = Math.max(F.x0 + F.w, G.radio.x0 + G.radio.w + 38*u) + 10*u, xb = G.lamp.x - G.lamp.s*1.15 - 10*u;
  const ya = 30*u, yb = G.counter.y0 - 4*u;
  // вчерашние снимки (шаг 5): столбик из трёх мелких слева, высотой с сегодняшнюю карточку
  const past = nightPast().length > 0, rowGap = past ? 6*u : 0;
  const side = Math.max(24*u, Math.min((xb - xa - gap*(n - 1))/n, (yb - ya - markH - rowGap)/(past ? 2 : 1), 84*u));
  const w = side*n + gap*(n - 1), x0 = (xa + xb)/2 - w/2;
  const y0 = ya + Math.max(0, (yb - ya - (past ? side*2 + markH + rowGap : side + markH))/2);
  return { side, markH, cells:[0, 1, 2].map(i => ({ x:x0 + i*(side + gap), y:y0, s:side, mx:x0 + i*(side + gap) + side/2, my:y0 + side + markH*0.55 })),
    past:past ? [0, 1, 2].map(i => ({ x:x0 + i*(side + gap), y:y0 + side + markH + rowGap, s:side })) : [] };
}
// Где что, в CSS px окна — для проверок касаниями.
function nightSpots(){
  const G = eveGeo(), D = nightDogBox(G), R = nightRow(G), r = cv.getBoundingClientRect(), k = r.width/cv.width, ky = r.height/cv.height;
  const c = (x, y) => ({ x:r.left + x*k, y:r.top + y*ky });
  return { pose:nightDogPose(), wants:nightDogWants(), eaten:NGT.dog, lookY:r.top + r.height*NIGHT_LOOK_Y,
    dog:c((D.x0 + D.x1)/2, (D.y0 + D.y1)/2), dogBox:{ ...c(D.x0, D.y0), w:D.w*k, h:D.h*ky },
    zone:{ x1:r.left + D.zone.x1*k, y0:r.top + D.zone.y0*ky },
    frame:nightFrameOn(), gifts:typeof GST !== "undefined" ? GST.gifts.slice() : [],
    cards:nightFrameOn() ? nightSnaps().map((s, i) => ({ to:s.to, ...c(R.cells[i].x, R.cells[i].y), s:R.cells[i].s*k, markY:r.top + R.cells[i].my*ky })) : [],
    past:nightFrameOn() ? nightPast().map((s, i) => ({ to:s.to, ...c(R.past[i].x, R.past[i].y), s:R.past[i].s*k })) : [] };
}

// ─────────────────────────── кадр
// Пёс: три неподвижные позы в одной рамке, мордой к миске. nx, ny — доли рамки.
// sil — плоский тёмный силуэт той же позы, на NIGHT_SIL px шире: подложка под пса, нарисованного поверх роти.
function nightDogDraw(g, sx, sy, G, sil){
  const B = nightDogBox(G), pose = nightDogPose(), grow = sil ? NIGHT_SIL*G.u : 0;
  const X = nx => (B.x0 + nx*B.w)*sx, Y = ny => (B.y0 + ny*B.h)*sy, RX = n => Math.max(.5, (n*B.w + grow)*sx), RY = n => Math.max(.5, (n*B.h + grow)*sy);
  // сборка 104: в облике мелками — рваный край, штрих и контур (crayon.js), шерсть — палевая уличного пса из макета H
  const CR = typeof crayonOn !== "undefined" && crayonOn && !sil;
  const PAL = CR ? { [NIGHT_FUR]:CRAYON_PROP.fur, [NIGHT_EAR]:CRAYON_PROP.ear, [NIGHT_DARK]:CRAYON_PROP.dark, "#c9a15a":CRAYON_PROP.roti, "#f0e0b0":"#fbf4e2" } : null;
  const col = c => PAL && PAL[c] || c;
  const ell = (nx, ny, rx, ry, fill, rot) => {
    if(CR){ crayonBlob(g, X(nx), Y(ny), RX(rx), RY(ry), col(fill), rot || 0); return; }
    g.fillStyle = sil ? NIGHT_DARK : fill; g.beginPath(); g.ellipse(X(nx), Y(ny), RX(rx), RY(ry), rot || 0, 0, Math.PI*2); g.fill(); };
  const stroke = (pts, w, color) => {
    g.strokeStyle = sil ? NIGHT_DARK : col(color); g.lineWidth = Math.max(1, (w*B.w + 2*grow)*sx); g.lineCap = "round"; g.beginPath();
    g.moveTo(X(pts[0][0]), Y(pts[0][1]));
    if(pts.length === 3) g.quadraticCurveTo(X(pts[1][0]), Y(pts[1][1]), X(pts[2][0]), Y(pts[2][1]));
    else g.lineTo(X(pts[1][0]), Y(pts[1][1]));
    g.stroke();
  };
  if(pose === 2){                                          // ест: стоит, голова у куска роти, хвост вверх и две чёрточки взмаха
    for(const lx of [0.22, 0.34, 0.56, 0.66]){ const lc = lx === 0.34 || lx === 0.56 ? NIGHT_EAR : NIGHT_FUR;
      if(CR) crayonRect(g, X(lx), Y(0.50), RX(0.07), RY(0.48), col(lc)); else { g.fillStyle = lc; g.fillRect(X(lx), Y(0.50), RX(0.07), RY(0.48)); } }
    ell(0.44, 0.44, 0.30, 0.21, NIGHT_FUR);
    stroke([[0.17, 0.40], [0.07, 0.30], [0.08, 0.06]], 0.05, NIGHT_FUR);
    stroke([[0.00, 0.14], [0.02, 0.02]], 0.02, "#f0e0b0");
    stroke([[0.15, 0.02], [0.18, 0.14]], 0.02, "#f0e0b0");
    ell(0.93, 0.93, 0.07, 0.06, "#c9a15a");                // кусок роти
    ell(0.76, 0.56, 0.11, 0.22, NIGHT_FUR, -0.6);          // шея
    ell(0.84, 0.74, 0.12, 0.15, NIGHT_FUR);                // голова
    ell(0.76, 0.66, 0.05, 0.13, NIGHT_EAR, 0.5);           // ухо
    ell(0.94, 0.80, 0.025, 0.04, NIGHT_DARK);              // нос
    return;
  }
  // лежит: туловище калачом, хвост вдоль земли
  stroke([[0.10, 0.80], [0.02, 0.96], [0.30, 0.95]], 0.05, NIGHT_FUR);
  ell(0.40, 0.72, 0.34, 0.25, NIGHT_FUR);
  ell(0.24, 0.80, 0.17, 0.17, NIGHT_FUR);                  // бедро
  ell(0.66, 0.93, 0.13, 0.06, NIGHT_FUR);                  // передняя лапа
  if(pose === 1){                                          // голова поднята: смотрит вверх, на роти в руке
    ell(0.70, 0.56, 0.11, 0.24, NIGHT_FUR, 0.35);          // шея
    ell(0.78, 0.30, 0.14, 0.19, NIGHT_FUR);
    ell(0.88, 0.27, 0.09, 0.10, NIGHT_FUR, -0.3);          // морда
    ell(0.68, 0.16, 0.05, 0.14, NIGHT_EAR, -0.35);         // ухо торчком
    ell(0.82, 0.26, 0.022, 0.04, NIGHT_DARK);              // глаз открыт
    ell(0.955, 0.22, 0.028, 0.045, NIGHT_DARK);            // нос вверх
    return;
  }
  ell(0.80, 0.82, 0.15, 0.16, NIGHT_FUR);                  // спит: голова на лапе
  ell(0.90, 0.87, 0.07, 0.09, NIGHT_FUR);                  // морда
  ell(0.72, 0.76, 0.06, 0.13, NIGHT_EAR, 0.7);             // ухо висит
  stroke([[0.80, 0.80], [0.84, 0.85], [0.88, 0.80]], 0.018, NIGHT_DARK);   // глаз закрыт
  ell(0.96, 0.86, 0.025, 0.04, NIGHT_DARK);
}
// evening.js зовёт это в нижнем слое после миски: тесто на столе ложится поверх пса.
function nightDrawUnder(g, sx, sy, G){ if(!eveDev) nightDogDraw(g, sx, sy, G); }
// Роти в руке закрыл бы пса — пока его несут, пёс рисуется поверх (как гостья): видно, кому несёшь.
// Шерсть почти одного тона с роти — под пса кладётся тёмный силуэт, иначе читались только ухо, глаз и нос.
function nightDrawOver(g, sx, sy, G){ if(!eveDev && nightCarried()){ nightDogDraw(g, sx, sy, G, true); nightDogDraw(g, sx, sy, G); } }
// Метка под карточкой — те же, что в тетради (notebook.js), мельче.
function nightDraw(g, sx, sy, G){
  if(!nightFrameOn() || typeof nbMark !== "function") return;
  const R = nightRow(G), u = G.u, q = Math.max(1, 3*u);
  nightSnaps().slice(0, EVE_BALLS).forEach((s, i) => {
    const C = R.cells[i], im = typeof nbPic === "function" ? nbPic(s.img) : null;
    g.fillStyle = "#f3ead4"; g.fillRect(C.x*sx, C.y*sy, C.s*sx, C.s*sy);
    if(im) g.drawImage(im, (C.x + q)*sx, (C.y + q)*sy, (C.s - 2*q)*sx, (C.s - 2*q)*sy);
    else {                                                 // снимка нет — плоский роти, как в тетради
      g.fillStyle = "#3a2c1e"; g.fillRect((C.x + q)*sx, (C.y + q)*sy, (C.s - 2*q)*sx, (C.s - 2*q)*sy);
      g.fillStyle = "#c9a15a"; g.beginPath(); g.ellipse((C.x + C.s/2)*sx, (C.y + C.s/2)*sy, C.s*0.30*sx, C.s*0.28*sy, 0, 0, Math.PI*2); g.fill();
    }
    nbMark(g, sx, sy, s.to, C.mx, C.my, u*0.72, s.answer);
  });
  nightPast().forEach((s, i) => {                          // вчера: те же снимки строкой ниже, приглушённые, без меток
    const C = R.past[i], im = typeof nbPic === "function" ? nbPic(s.img) : null;
    g.fillStyle = "#b9a988"; g.fillRect(C.x*sx, C.y*sy, C.s*sx, C.s*sy);
    if(im) g.drawImage(im, (C.x + q)*sx, (C.y + q)*sy, (C.s - 2*q)*sx, (C.s - 2*q)*sy);
    else {
      g.fillStyle = "#3a2c1e"; g.fillRect((C.x + q)*sx, (C.y + q)*sy, (C.s - 2*q)*sx, (C.s - 2*q)*sy);
      g.fillStyle = "#c9a15a"; g.beginPath(); g.ellipse((C.x + C.s/2)*sx, (C.y + C.s/2)*sy, C.s*0.30*sx, C.s*0.28*sy, 0, 0, Math.PI*2); g.fill();
    }
    g.fillStyle = "rgba(8,6,10,0.45)"; g.fillRect(C.x*sx, C.y*sy, C.s*sx, C.s*sy);   // приглушено
  });
}

// ─────────────────────────── запуск
nightLoad();
if(EVE.over){ NGT.shown = false; nShownHow = "load"; }   // открыта после оконченного вечера: тот же ночной кадр, в журнале — ещё одна строка
