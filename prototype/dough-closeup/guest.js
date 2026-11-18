"use strict";
/* Тётя Сом, первый гость — шаг 2 v0 (docs/v0-step2-aunt-som.md).
   Грузится ПОСЛЕ evening.js и только смотрит на стенд: когда роти жарится — приходит и стучит по таве
   («хочу хрустящее», словами это не сказано нигде), на каждой новой ступени жарки стучит снова, а за
   поданный роти отвечает честно и по той же лестнице, по которой стучит: роти, чья сторона на таве
   дошла до «приготовленного» (или с хрустом стенда dishCrisp от 5), — «хруст», иначе «кивок».
   Своих жестов у неё нет: роти ей отдают тем же переносом вверх, что и на стойку (evening.js зовёт
   guestServe). В стенде от неё одна переменная — panKnock: тава вздрагивает от стука.
   Правила владелицы 17.11: звука нет — всё читается глазами; из движения только вздрагивание тавы на
   2 px и смена картинок; Сом не говорит словами.

   КАРТИНКИ. Четыре неподвижных кадра «по плечи» в одной рамке: guest/som-1.png … som-4.png
   (1 ждёт, 2 стучит, 3 кивок, 4 хруст; прозрачный фон, ширина около 600 px). Пока хотя бы одного файла
   нет, в том же месте рисуются заглушки — плоский силуэт. Где и какого размера картинка — только в
   GUEST_SLOT и guestSlot(): чтобы подставить PNG, код менять не нужно. */

const GUEST_V = 1;
const GUEST_SLOT = { top:34, aspect:1.1, side:88, overlap:2, sit:0.08 };   // CSS px; aspect — ширина к высоте; sit — доля высоты рамки
const GUEST_ARRIVE_S = 8, GUEST_ARRIVE_COOK = 0.08;    // 8 с жарки или низ дошёл до «бледного» (cookWord)
const GUEST_KNOCK_WAIT = 1.5, GUEST_KNOCK_S = 1.2, GUEST_HINT_S = 0.8, GUEST_ANSWER_S = 2.5;
const GUEST_CRUNCH = 5;                                // crispWord стенда: от 5 — «сильно хрустит»
const GUEST_CRUNCH_STEP = 2;                           // ступень жарки (guestStepOf): 2 — «приготовленное»; с неё роти ей хрустит
const GUEST_SHAKE = [[0.10, 0.22], [0.40, 0.52]];      // два вздрагивания тавы, секунды от начала стука
const GUEST_SHAKE_PX = 2;
const GUEST_GIFT = { nod:"bananas", crunch:"jam" };
const GUEST_FILES = [1, 2, 3, 4].map(i => `guest/som-${i}.png`);

function guestFresh(){ return { v:GUEST_V, here:false, gone:false, knocked:false, answers:[], gifts:[], taken:0 }; }
let GST = guestFresh();
let guestEvents = [];                // журнал гостя: хранится в roti_evening.guest.events, шлепками не вытесняется
// То, что живёт только в кадре (после перезагрузки начинается заново): ожидание первого стука, стук,
// показ ответа, ступень, на которую она уже стучала, наибольшая ступень жарки этого роти (gBest —
// по ней ответ; роти после перезагрузки начинается с комка, хранить её незачем), «села».
let gWait = 0, gKnock = 0, gKnockAge = 0, gAnswer = 0, gStep = 0, gBest = 0, gBall = 0, gSat = false, gMain = false;

// ─────────────────────────── картинки
// Сначала спрашивается только первый файл: пока картинок нет, это один отказ сервера, а не четыре.
const gImgs = [];
if(typeof Image !== "undefined"){
  const first = new Image();
  first.onload = () => { for(const f of GUEST_FILES.slice(1)){ const im = new Image(); im.src = f; gImgs.push(im); } };
  first.src = GUEST_FILES[0]; gImgs.push(first);
}
function guestPictures(){ return gImgs.length === 4 && gImgs.every(im => im.complete && im.naturalWidth > 0); }

// ─────────────────────────── сохранение и журнал
function guestState(){ return { ...GST, events:guestEvents }; }
function guestExport(){ return { state:{ ...GST, pic:guestPic(), sat:gSat, best:gBest }, events:guestEvents }; }
function guestTook(){ return GST.taken; }
function guestLoad(){
  const s = typeof eveGuestRaw !== "undefined" ? eveGuestRaw : null;
  if(!s || s.v !== GUEST_V) return;
  const ok = a => a === "nod" || a === "crunch";
  const answers = (Array.isArray(s.answers) ? s.answers : []).filter(a => a && ok(a.answer)).slice(0, 2);
  GST = { v:GUEST_V, here:!!s.here, gone:!!s.gone, knocked:!!s.knocked, answers, gifts:answers.map(a => GUEST_GIFT[a.answer]),
    taken:Math.max(0, Math.min(2, Math.round(+s.taken) || 0)) };
  if(Array.isArray(s.events)) guestEvents = s.events.slice(-60);
  gSat = GST.answers.length > 0;
  // перезагрузка во время второго ответа: ответ уже записан, подарок на полке — она ушла
  if(GST.here && GST.answers.length >= 2){ GST.here = false; GST.gone = true; guestLog("leave", { why:"answered" }); }
}
function guestBallNo(){ return EVE_BALLS - EVE.ballsLeft; }
function guestStepOf(c){ return c < 0.08 ? 0 : c < 0.28 ? 1 : c < 0.55 ? 2 : 3; }   // как cookWord: сырое, бледное, приготовленное, зажаренное
function guestCookStep(){ return guestStepOf(meanCook()); }
function guestLog(event, extra){
  const row = { event, ballNo:guestBallNo(), ...(extra || {}), ts:new Date().toISOString() };
  guestEvents.push(row); if(guestEvents.length > 60) guestEvents.shift();
  gestures.push({ ...measurementContext(), kind:"guest", ...row });
  if(gestures.length > 200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
  eveSave();
}
// что она видит на таве в эту секунду — в журнал стука и подсказки
function guestFryNow(){
  return { crisp:+dishCrisp.toFixed(1), bottom:cookWord(meanCook()), panSeconds:Math.round((dish && dish.panTime) || 0) };
}
function guestReset(){
  GST = guestFresh(); guestEvents = [];
  gWait = gKnock = gKnockAge = gAnswer = gStep = gBest = gBall = 0; gSat = gMain = false; panKnock = 0;
}

// ─────────────────────────── ход гостя
function guestFrying(){ return EVE.ball && phase === "PAN" && !!dish && dish.mode === "fold"; }
function guestKnock(seconds, event){
  gKnock = seconds; gKnockAge = 0; gMain = event === "knock";
  guestLog(event, guestFryNow());
}
function guestLeave(why){
  if(!GST.here) return;
  GST.here = false; GST.gone = true; gWait = gKnock = gAnswer = 0; panKnock = 0;
  guestLog("leave", { why, answers:GST.answers.map(a => a.answer) });
}
// evening.js зовёт это, когда нарезанный роти отпущен выше нижнего края стойки, ДО сброса стенда.
// Над стойкой левее лампы — роти ей («som»), иначе он ложится на стойку (null).
// Ответ — по той же лестнице, по которой она стучит: наибольшая за этот роти ступень жарки стороны,
// лежавшей на таве (gBest; стороны поданного роти тоже смотрятся — жарили и до её прихода). Хруст
// стенда (dishCrisp, маргарин) тоже годится, но один он недостижим за обычную жарку (замер G7).
function guestServe(client){
  if(!GST.here || gAnswer > 0 || GST.answers.length >= 2 || !client) return null;
  const G = eveGeo(), Z = guestSlot(G).zone, p = evePt(client.x, client.y);
  if(p.x < Z.x0 || p.x > Z.x1 || p.y > Z.y1) return null;
  const crisp = +dishCrisp.toFixed(1);                     // то же число, что в карточке стенда (serve.crisp)
  const step = Math.max(gBest, guestStepOf(dishSideMean("cook", "contactWeights")), guestStepOf(dishSideMean("cook", "topWeights")));
  const answer = step >= GUEST_CRUNCH_STEP || crisp >= GUEST_CRUNCH ? "crunch" : "nod";
  const ballNo = guestBallNo();
  GST.answers.push({ ballNo, crisp, step, answer });
  GST.gifts.push(GUEST_GIFT[answer]);                      // подарок ложится на полку сразу: перезагрузка его не теряет
  if(typeof shelfGift === "function") shelfGift(GUEST_GIFT[answer]);   // полка шага 5: пополняет, а не добавляет
  GST.taken++; GST.knocked = true;                         // роти у неё: главный стук больше не нужен
  gWait = 0; gKnock = 0; panKnock = 0; gMain = false; gAnswer = GUEST_ANSWER_S;
  guestLog("serve", { crisp, crispWord:crispWord(crisp), step, bottom:cookWord(dishSideMean("cook", "contactWeights")),
    top:cookWord(dishSideMean("cook", "topWeights")), panSeconds:Math.round(dish.panTime || 0) });
  guestLog("answer", { crisp, step, answer, gift:GUEST_GIFT[answer] });
  return "som";
}
function guestUpdate(dt){
  guestMark();
  if(eveDev){ panKnock = 0; return; }
  if(EVE.over || !EVE.lamp){ if(GST.here) guestLeave("evening-over"); panKnock = 0; return; }
  if(EVE.lid){ panKnock = 0; return; }                     // тава под крышкой: стук не идёт (картинка 1), счёт стоит и пойдёт с того же места
  if(typeof notebookOpen === "function" && notebookOpen()){ panKnock = 0; return; }   // тетрадь открыта (notebook.js): та же пауза
  const ballNo = guestBallNo();
  if(ballNo !== gBall){ gBall = ballNo; gStep = 0; gBest = 0; }   // новый шарик — ступени жарки считаются заново
  if(guestFrying()) gBest = Math.max(gBest, guestCookStep());     // наибольшая ступень этого роти — по ней ответ
  if(gAnswer > 0){
    gAnswer -= dt;
    if(gAnswer <= 0){
      gAnswer = 0; gSat = true;                            // после первого ответа она садится
      if(GST.answers.length >= 2) guestLeave("answered");
      else if(ballNo >= 3 && EVE.ball) guestLeave("third-ball");
    }
    return;
  }
  const frying = guestFrying();
  if(!GST.here){
    // приходит по жарке, не раньше; только на первых двух шариках (третий — не ей)
    // shelf.js (шаг 5): после вчерашнего кивка она приходит раньше и стучит сразу; state — в журнал
    const early = typeof shelfSomArrive === "function";
    if(!GST.gone && frying && ballNo <= 2 && ((dish.panTime || 0) >= (early ? shelfSomArrive(GUEST_ARRIVE_S) : GUEST_ARRIVE_S) || meanCook() >= GUEST_ARRIVE_COOK)){
      GST.here = true; GST.knocked = false; gWait = early ? shelfKnockWait(GUEST_KNOCK_WAIT) : GUEST_KNOCK_WAIT; gStep = guestCookStep();
      guestLog("arrive", early && shelfSomState() ? { ...guestFryNow(), state:shelfSomState() } : guestFryNow());
    }
    return;
  }
  if(ballNo >= 3 && EVE.ball){ guestLeave("third-ball"); return; }
  if(gKnock > 0){
    gKnock -= dt; gKnockAge += dt;
    const on = gKnock > 0 && GUEST_SHAKE.some(([a, b]) => gKnockAge >= a && gKnockAge < b);
    panKnock = on ? GUEST_SHAKE_PX*eveGeo().u : 0;
    if(gKnock <= 0){
      gKnock = 0;
      // главный стук отстоял целиком — только теперь он записан: перезагрузка до или посреди него его не съест
      if(gMain){ gMain = false; GST.knocked = true; eveSave(); }
    }
    return;
  }
  panKnock = 0;
  if(gWait > 0){
    gWait -= dt;
    if(gWait <= 0){ gWait = 0; guestKnock(GUEST_KNOCK_S, "knock"); }
    return;
  }
  if(frying && !GST.knocked){                              // главный стук съела или оборвала перезагрузка: он придёт на этой жарке
    gWait = GUEST_KNOCK_WAIT; gStep = Math.max(gStep, guestCookStep());
    return;
  }
  if(frying){                                              // «теплее»: роти перешёл на следующую ступень жарки
    const s = guestCookStep();
    if(s > gStep){ gStep = s; guestKnock(GUEST_HINT_S, "hint"); }
  }
}
function guestPic(){
  if(!GST.here) return 0;
  if(gAnswer > 0) return GST.answers[GST.answers.length - 1].answer === "crunch" ? 4 : 3;
  if(EVE.lid) return 1;                                    // под крышкой она просто ждёт
  return gKnock > 0 ? 2 : 1;
}
// Служебная строка: с гостьей у стойки нарезанный роти можно унести и ей. Пока она здесь, строка
// набрана мельче и прижата к верху (html.guest в stand.css): две строки кончаются над её рамкой, а самые
// длинные слова вечера при ней короче — иначе вторая и третья строки ложились ей на волосы и лоб.
// cur === null — тава под крышкой (evening.js спрашивает до своих слов).
const GUEST_WORDS = [
  ["Положи банан", "коснись середины — ляжет банан · потом заверни стороны"],
  ["Банан", "банан лежит · заверни стороны к середине"],
];
function guestLive(cur){
  if(!GST.here) return null;
  if(cur === null) return "под крышкой · сними её в сторону — жарка пойдёт дальше";
  const give = gAnswer <= 0 && GST.answers.length < 2;
  if(give && cur.startsWith("Разрезов")) return "нарезано · за середину и наверх — гостье или на стойку";
  if(give && cur.startsWith("В руке — неси наверх")) return "неси наверх — гостье или на стойку";
  for(const [from, to] of GUEST_WORDS) if(cur.startsWith(from)) return to;
  return null;
}
let gMark = null;
function guestMark(){
  const on = GST.here && !eveDev;
  if(on === gMark) return; gMark = on;
  if(eveRoot && eveRoot.classList) eveRoot.classList.toggle("guest", on);
}

// ─────────────────────────── где она стоит (пиксели холста) — ЕДИНСТВЕННОЕ место с размерами картинки
// Рамка картинки: по середине, от строки сверху до верхнего края стойки (стойка закрывает низ на
// overlap; ниже y1 гость не рисуется вовсе). PNG вписывается в рамку целиком, прижат к низу, по
// середине. «Села» — та же рамка ниже на долю sit своей высоты; на время ответа она снова в полный рост.
// Зона «ей» шире картинки: вся полоса над стойкой от её левого края до лампы — роти в руке закрывает
// картинку, целиться в неё вслепую незачем. Сама стойка (ниже y1) остаётся стойкой.
function guestSlot(G){
  const u = G.u, S = GUEST_SLOT;
  const y1 = G.counter.y0 + S.overlap*u, y0 = Math.min(S.top*u, y1*0.4), h = y1 - y0;
  const w = Math.max(40*u, Math.min(h*S.aspect, G.W - 2*S.side*u)), x0 = G.W/2 - w/2;
  const zx0 = Math.min(x0, G.counter.x0), zx1 = Math.max(x0 + w, G.lamp.x - G.lamp.hit);
  return { x0, y0, w, h, sit:S.sit*h, zone:{ x0:zx0, x1:zx1, y1 } };
}
function guestLow(){ return gSat && gAnswer <= 0; }
function guestShelf(G){
  const u = G.u;
  return { x0:G.counter.x0 + 4*u, w:74*u, y:Math.max(58*u, G.A*0.36), cell:34*u };
}
// Где что, в CSS px окна — для проверок касаниями.
function guestSpots(){
  const G = eveGeo(), S = guestSlot(G), r = cv.getBoundingClientRect(), k = r.width/cv.width, ky = r.height/cv.height;
  const c = (x, y) => ({ x:r.left + x*k, y:r.top + y*ky }), F = guestShelf(G);
  return { here:GST.here, pic:guestPic(), sat:gSat, low:guestLow(), sit:S.sit*ky, pictures:guestPictures(),
    som:c(S.x0 + S.w/2, S.y0 + S.h*0.6), slot:{ ...c(S.x0, S.y0), w:S.w*k, h:S.h*ky },
    zone:{ x0:r.left + S.zone.x0*k, x1:r.left + S.zone.x1*k, y1:r.top + S.zone.y1*ky },
    shelf:c(F.x0 + F.w/2, F.y), gifts:GST.gifts.slice(), knock:panKnock*ky };
}

// ─────────────────────────── кадр (evening.js зовёт после неба и до стойки)
function guestDraw(g, sx, sy, G){
  if(eveDev) return;
  const u = G.u;
  // полка с подарками: появляется вместе с первой вещью. С shelf.js (шаг 5) полку рисует он: она переживает вечер
  if(typeof shelfDraw === "function") shelfDraw(g, sx, sy, G);
  else if(GST.gifts.length){
    const F = guestShelf(G);
    g.fillStyle = "#8b7f6e"; g.fillRect(F.x0*sx, F.y*sy, F.w*sx, Math.max(1, 3*u*sy));
    GST.gifts.forEach((gift, i) => guestGift(g, sx, sy, gift, F.x0 + F.cell*(i + 0.55), F.y, u));
  }
  guestFigure(g, sx, sy, G);
}
// Сама гостья: всё, что ниже верхнего края стойки, обрезано — за стойкой её не видно (и «села», и PNG).
function guestFigure(g, sx, sy, G){
  const pic = guestPic(); if(!pic) return;
  const S = guestSlot(G), dy = guestLow() ? S.sit : 0;
  g.save(); g.beginPath(); g.rect(0, 0, G.W*sx, S.zone.y1*sy); g.clip();
  if(guestPictures()){
    const im = gImgs[pic - 1], k = Math.min(S.w/im.naturalWidth, S.h/im.naturalHeight), w = im.naturalWidth*k, h = im.naturalHeight*k;
    g.drawImage(im, (S.x0 + (S.w - w)/2)*sx, (S.y0 + S.h - h + dy)*sy, w*sx, h*sy);
  } else guestPlaceholder(g, sx, sy, S, dy, pic);
  if(pic === 1 && typeof shelfSomJar === "function" && shelfSomJar()) guestJar(g, sx, sy, S, dy);
  g.restore();
}
// Шаг 5: вчера оставила варенье — сегодня та же картинка 1 с пустой банкой в руке (плоский рисунок поверх
// заглушки или PNG, слева у плеча). Когда банка встаёт на полку — решает shelf.js.
function guestJar(g, sx, sy, S, dy){
  const x = (S.x0 + 0.27*S.w)*sx, y = (S.y0 + dy + 0.93*S.h)*sy, w = 0.15*S.w*sx, h = 0.21*S.h*sy;
  g.fillStyle = "#8b7f6e"; g.fillRect(x - w/2, y - h, w, h);                    // пустое стекло
  g.fillStyle = "#d9d2c0"; g.fillRect(x - w*0.56, y - h*1.22, w*1.12, h*0.26);  // крышка
  g.fillStyle = "#c08a5a"; g.beginPath(); g.ellipse(x + w*0.42, y - h*0.38, Math.max(.5, w*0.34), Math.max(.5, h*0.22), 0, 0, Math.PI*2); g.fill();   // пальцы
}
// Нарезанный роти в руке (его несут наверх) закрывает её целиком — пока он в руке, она рисуется поверх
// него: видно, кому несёшь. evening.js зовёт это после теста, перед крышкой и лампой.
function guestCarried(){ return !!dish && dish.mode === "cut" && !!dishGesture && dishGesture.zone === "serve" && !!dishGesture.carry; }
function guestDrawOver(g, sx, sy, G){
  if(eveDev || !GST.here || !guestCarried()) return;
  guestFigure(g, sx, sy, G);
}
function guestGift(g, sx, sy, gift, x, y, u){
  if(gift === "jam"){                                      // банка варенья
    g.fillStyle = "#a8402c"; g.fillRect((x - 8*u)*sx, (y - 19*u)*sy, 16*u*sx, 19*u*sy);
    g.fillStyle = "#d9d2c0"; g.fillRect((x - 9*u)*sx, (y - 23*u)*sy, 18*u*sx, 5*u*sy);
    g.fillStyle = "#e8dcc0"; g.fillRect((x - 5*u)*sx, (y - 14*u)*sy, 10*u*sx, 7*u*sy);
    return;
  }
  // связка бананов: три плоских банана веером от одной ножки
  g.fillStyle = "#e3c04a";
  for(const a of [-0.75, -0.25, 0.25]){
    g.beginPath(); g.ellipse((x + Math.sin(a)*8*u)*sx, (y - 7*u - Math.cos(a)*2*u)*sy, 4.5*u*sx, 11*u*sy, a, 0, Math.PI*2); g.fill();
  }
  g.fillStyle = "#5a4326"; g.fillRect((x - 4*u)*sx, (y - 21*u)*sy, 4*u*sx, 5*u*sy);
}
// Заглушка до настоящих картинок: плоский силуэт по плечи в той же рамке. Разница 3 ↔ 4 нарочно
// крупная: 3 — глаза открыты, голова чуть наклонена, рот — ровная черта; 4 — глаза закрыты (дуги),
// крошки у рта, плечи подняты.
function guestPlaceholder(g, sx, sy, S, dy, pic){
  const X = nx => (S.x0 + nx*S.w)*sx, Y = ny => (S.y0 + dy + ny*S.h)*sy, R = n => n*S.w*sx, RY = n => n*S.h*sy;
  const SKIN = "#c08a5a", HAIR = "#2a2622", CLOTH = "#8a4b3c", GOLD = "#e0a23a", DARK = "#1d150e";
  const ell = (nx, ny, rx, ry, fill) => { g.fillStyle = fill; g.beginPath(); g.ellipse(X(nx), Y(ny), Math.max(.5, R(rx)), Math.max(.5, RY(ry)), 0, 0, Math.PI*2); g.fill(); };
  const stroke = (pts, w, color) => {
    g.strokeStyle = color; g.lineWidth = Math.max(1, R(w)); g.beginPath();
    g.moveTo(X(pts[0][0]), Y(pts[0][1]));
    if(pts.length === 3) g.quadraticCurveTo(X(pts[1][0]), Y(pts[1][1]), X(pts[2][0]), Y(pts[2][1]));
    else g.lineTo(X(pts[1][0]), Y(pts[1][1]));
    g.stroke();
  };
  const up = pic === 4 ? 0.14 : 0;                         // плечи подняты
  ell(0.5, 1.06 - up, 0.48, 0.36, CLOTH);                  // плечи
  g.fillStyle = SKIN; g.fillRect(X(0.44), Y(0.58), R(0.12), RY(0.16));   // шея
  // голова: в кивке наклонена и чуть опущена
  const tilt = pic === 3 ? 0.16 : 0, hx = 0.5, hy = pic === 3 ? 0.445 : 0.42;
  g.save(); g.translate(X(hx), Y(hy)); g.rotate(tilt); g.translate(-X(hx), -Y(hy));
  ell(hx, hy - 0.27, 0.075, 0.07, HAIR);                   // пучок
  ell(hx, hy - 0.05, 0.215, 0.26, HAIR);                   // волосы
  ell(hx, hy + 0.03, 0.175, 0.215, SKIN);                  // лицо
  for(const s of [-1, 1]){                                 // золотые серёжки-кольца
    g.strokeStyle = GOLD; g.lineWidth = Math.max(1, R(0.016)); g.beginPath();
    g.ellipse(X(hx + s*0.195), Y(hy + 0.13), R(0.035), RY(0.042), 0, 0, Math.PI*2); g.stroke();
  }
  if(pic === 4){
    for(const s of [-1, 1]) stroke([[hx + s*0.035, hy], [hx + s*0.08, hy + 0.045], [hx + s*0.125, hy]], 0.02, DARK);   // глаза закрыты
    stroke([[hx - 0.07, hy + 0.12], [hx, hy + 0.20], [hx + 0.07, hy + 0.12]], 0.02, DARK);                             // рот — дуга
    for(const [cx, cy] of [[-0.13, 0.13], [0.12, 0.11], [0.14, 0.18], [-0.11, 0.19], [0.03, 0.235], [-0.045, 0.24]]) ell(hx + cx, hy + cy, 0.014, 0.016, "#f0c674");   // крошки
  } else {
    const look = pic === 1 ? 0.03 : 0, r = pic === 2 ? 0.03 : 0.023;   // 1 — смотрит вниз, на таву; 2 — на тебя
    for(const s of [-1, 1]) ell(hx + s*0.075, hy + 0.01 + look, r, r*1.1, DARK);
    stroke(pic === 3 ? [[hx - 0.07, hy + 0.135], [hx + 0.07, hy + 0.135]] : [[hx - 0.035, hy + 0.135], [hx + 0.035, hy + 0.135]], 0.02, DARK);
  }
  g.restore();
  if(pic === 1){                                           // пальцы на серебряном браслете
    g.fillStyle = "#b9b3a8"; g.fillRect(X(0.50), Y(0.86), R(0.05), RY(0.10));
    ell(0.43, 0.91, 0.08, 0.055, SKIN);
  } else if(pic === 2){                                    // костяшками по краю тавы
    ell(0.80, 0.93, 0.07, 0.075, SKIN);
    stroke([[0.90, 0.84], [0.95, 0.78]], 0.016, "#f0e0b0");
    stroke([[0.92, 0.92], [0.99, 0.90]], 0.016, "#f0e0b0");
  } else {                                                 // кусок роти в руке
    ell(0.76, 0.90 - up*0.5, 0.075, 0.05, "#c9a15a");
    ell(0.70, 0.93 - up*0.5, 0.06, 0.05, SKIN);
  }
}

// ─────────────────────────── запуск
guestLoad();
