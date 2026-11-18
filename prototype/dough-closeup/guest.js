"use strict";
/* Тётя Сом, первый гость — шаг 2 v0 (docs/v0-step2-aunt-som.md).
   Грузится ПОСЛЕ evening.js и только смотрит на стенд: когда роти жарится — приходит и стучит по таве
   («хочу хрустящее», словами это не сказано нигде), на каждой новой ступени жарки стучит снова, а за
   поданный роти отвечает честно и по той же лестнице, по которой стучит (fryStep стенда — она же в
   строке стенда). Сборка 78: смотрит ОБЕ стороны, приговор один на стенд и на неё (fryVerdict в stand.js):
   обе стороны не ниже «приготовленного» — «хруст» и варенье; то же, если одна «приготовленное», другая
   не ниже «бледного», а хруст стенда dishCrisp от 5 (маргарин под краем заменяет дожарку второй стороны);
   обе сырые — качает головой и не берёт, подарка нет, роти остаётся на столе; хоть одна горелая —
   «кивок» без варенья; остальное — «кивок».
   Своих жестов у неё нет: роти ей отдают тем же переносом вверх, что и на стойку (evening.js зовёт
   guestServe). В стенде от неё одна переменная — panKnock: тава вздрагивает от стука.
   Правила владелицы 17.11: звука нет — всё читается глазами; Сом не говорит словами; движение — только
   то, что что-то сообщает. Сборка 80 (плейтест 17.11, п. 13: стук никто не заметил, между стуками сцена
   мёртвая): стуча, она наклоняется и тянет руку через стойку к борту тавы — метки стука вспыхивают У БОРТА,
   не у её руки; пока роти на таве не перевёрнут и до её «хруста» не дошёл, стук повторяется каждые
   GUEST_AGAIN_S секунд; глаза идут за роти (сгиб, переворот, перенос); роти унесли мимо неё на стойку —
   она поворачивает голову вслед (guestWatch). Рука и взгляд нарисованы кодом поверх любой картинки.
   Сборка 89 (спека docs/som-points-batch-spec.md): стук — не у борта, а у САМОГО БЛЕДНОГО места края роти
   (guestPaleEdge: по контуру конверта, цвет видимой стороны верхнего слоя; не перевёрнут — край, ближний к
   ней), и рука видна при любой картинке; раунд 2: рука короткая, с её стороны (guestArmPose) — палец
   направлен в это место и тычет на ударах, метки — в самом месте на роти. Роти с
   сырой видимой стороной сняли на стол — короткое «нет» (два качания за GUEST_NO_S) и взгляд на таву
   (guestSeesRemoval, событие «no»), раз на каждый такой съём.

   КАРТИНКИ. Четыре неподвижных кадра «по плечи» в одной рамке: guest/som-1.png … som-4.png
   (1 ждёт, 2 стучит, 3 кивок, 4 хруст; прозрачный фон, ширина около 600 px). Пока хотя бы одного файла
   нет, в том же месте рисуются заглушки — плоский силуэт. Где и какого размера картинка — только в
   GUEST_SLOT и guestSlot(): чтобы подставить PNG, код менять не нужно. */

const GUEST_V = 1;
const GUEST_SLOT = { top:34, aspect:1.1, side:88, overlap:2, sit:0.08 };   // CSS px; aspect — ширина к высоте; sit — доля высоты рамки
const GUEST_ARRIVE_S = 8, GUEST_ARRIVE_COOK = 0.08;    // 8 с жарки или низ дошёл до «бледного» (cookWord)
const GUEST_KNOCK_WAIT = 1.5, GUEST_KNOCK_S = 1.2, GUEST_HINT_S = 0.8, GUEST_ANSWER_S = 2.5;
// Пороги хруста и ступеней — в stand.js (FRY_STEPS, FRY_CRISP, fryVerdict): у строки стенда и у неё они одни.
const GUEST_SHAKE_HEAD_S = 1.1;                        // качает головой: картинка 1, голова два раза в стороны
const GUEST_SHAKE = [[0.10, 0.22], [0.40, 0.52]];      // два вздрагивания тавы, секунды от начала стука
const GUEST_SHAKE_PX = 2;
// Повтор стука, пока видимая сторона роти не дошла до её «хруста» (guestWantsFlip). Сборка 95 (ревью 18.11, п. 2):
// было 8 с со сложенными руками между стуками — на кадре она «успокаивалась» при сыром верхе. Теперь между стуками
// она не садится: наклонена, кулак лежит на краю стойки, взгляд на роти (guestUrging), стук — каждые 3,5 с.
const GUEST_AGAIN_S = 3.5;
const GUEST_MARK_S = 0.14;                             // метки у борта держатся столько после каждого удара — глаз успевает
const GUEST_LEAN = 0.07;                               // наклон к таве на время стука, доля высоты рамки
const GUEST_FLIP_UP = 0.04;                            // переворот: голова на миг поднимается за взлетевшим роти, доля высоты рамки
const GUEST_WATCH_S = 2.2;                             // сколько она смотрит вслед роти, унесённому на стойку
const GUEST_NO_S = 0.6, GUEST_NO_LOOK_S = 1.0;          // «нет» на сырое на столе: два качания, затем столько смотрит на таву
const GUEST_PALE_N = 48, GUEST_PALE_IN = 0.1, GUEST_PALE_TIE = 0.01;   // точки по краю; насколько внутрь брать цвет; равные — ближе к ней
const GUEST_HAND = { x:0.73, y:0.93 };                 // где на картинке 2 её стучащий кулак (доли рамки картинки) — оттуда идёт рука
const GUEST_GIFT = { nod:"bananas", crunch:"jam" };
const GUEST_FILES = [1, 2, 3, 4].map(i => `guest/som-${i}.png`);

function guestFresh(){ return { v:GUEST_V, here:false, gone:false, knocked:false, answers:[], gifts:[], taken:0 }; }
let GST = guestFresh();
let guestEvents = [];                // журнал гостя: хранится в roti_evening.guest.events, шлепками не вытесняется
// То, что живёт только в кадре (после перезагрузки начинается заново): ожидание первого стука, стук,
// показ ответа, ступень, на которую она уже стучала, наибольшая ступень жарки этого роти (gBest —
// только в выгрузку guestExport; ответ с партии «жарка» даёт guestVerdict по обеим сторонам), «села».
let gWait = 0, gKnock = 0, gKnockAge = 0, gAnswer = 0, gStep = 0, gBest = 0, gBall = 0, gSat = false, gMain = false, gHead = 0, gFlips = 0;
let gKnockBall = 0;                                             // шарик, по которому был последний стук (guestUrging)
let gAgain = 0, gWatch = 0, gWatchDir = 0, gWatchAt = null;   // до повтора стука; взгляд вслед: остаток, сторона (−1, 0 — вниз, 1), куда
let gHeadT = GUEST_SHAKE_HEAD_S, gNoLook = 0, gMode = null;  // длина идущего качания головой; «нет»: остаток взгляда на таву; режим блюда в прошлом кадре
let gPale = null;                                       // кэш самой бледной точки края (guestPaleEdge)

// ─────────────────────────── картинки
// Сначала спрашивается только первый файл: пока картинок нет, это один отказ сервера, а не четыре.
const gImgs = [];
if(typeof Image !== "undefined"){
  const first = new Image();
  first.onload = () => { for(const f of GUEST_FILES.slice(1)){ const im = new Image(); im.src = f; gImgs.push(im); } };
  first.src = GUEST_FILES[0]; gImgs.push(first);
}
// Картинка 2 со взглядом на роти (сборка 95, ревью 18.11, п. 2): на som-2 она смотрит на игрока. Голова берётся
// с картинки 1 (глаза вниз, на таву), плечи и стучащая рука — с картинки 2; шов на шее размыт (GUEST_HEAD_SEAM,
// доли высоты). Собирается один раз, когда обе картинки загружены; без document (проверки в Node) — som-2 как есть.
const GUEST_HEAD_SEAM = [0.54, 0.62];
let gKnockImg = null;
function guestKnockImage(){
  if(gKnockImg) return gKnockImg;
  const a = gImgs[0], b = gImgs[1];
  if(typeof document === "undefined" || !document.createElement) return b;
  try{
    const w = b.naturalWidth, h = b.naturalHeight, mk = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const head = mk(), hg = head.getContext("2d"), out = mk(), og = out.getContext("2d");
    if(!hg || !og) return b;
    hg.drawImage(a, 0, 0, w, h); hg.globalCompositeOperation = "destination-in";
    const gr = hg.createLinearGradient(0, GUEST_HEAD_SEAM[0]*h, 0, GUEST_HEAD_SEAM[1]*h);
    gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)"); hg.fillStyle = gr; hg.fillRect(0, 0, w, h);
    og.drawImage(b, 0, 0); og.drawImage(head, 0, 0);
    out.naturalWidth = w; out.naturalHeight = h;
    return gKnockImg = out;
  }catch(e){ return b; }
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
function guestStepOf(c){ return fryStep(c); }           // общая лестница стенда: сырое, бледное, приготовленное, зажаренное, горелое
// Что она скажет о роти с такими сторонами (числа цвета низа и верха) и таким хрустом стенда — приговор
// стенда (fryVerdict): raw — не берёт; burnt — кивок, варенья нет; crunch — хруст и варенье; nod — кивок.
function guestVerdict(bottom, top, crisp){ return fryVerdict(bottom, top, crisp); }
function guestSides(){ return { bottom:dishSideMean("cook", "contactWeights"), top:dishSideMean("cook", "topWeights"), crisp:+dishCrisp.toFixed(1) }; }
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
  gWait = gKnock = gKnockAge = gAnswer = gStep = gBest = gBall = gHead = gFlips = gAgain = gWatch = gWatchDir = 0; gSat = gMain = false; panKnock = 0;
  gWatchAt = null; gHeadT = GUEST_SHAKE_HEAD_S; gNoLook = 0; gMode = null; gPale = null; gKnockBall = 0;
}

// ─────────────────────────── ход гостя
function guestFrying(){ return EVE.ball && phase === "PAN" && !!dish && dish.mode === "fold"; }
// Чего она ждёт стуком: чтобы видимая сторона (верх) дошла до «приготовленного» — её «хруста» (fryVerdict). Сборка 95
// (ревью 18.11, п. 2): стук держится по прожарке, не по перевороту — перевернули бледной стороной вверх, она стучит
// дальше; перестаёт, когда сверху румяная сторона или приговор уже «хруст» (маргарин под краем) — дальше только горелое.
function guestWantsFlip(){
  if(!guestFrying()) return false;
  const S = guestSides();
  return fryStep(S.top) < 2 && guestVerdict(S.bottom, S.top, S.crisp) !== "crunch";
}
// Между стуками у готового конверта, пока она ждёт хруста: не садится и не складывает руки (картинка 2 без ударов).
// Только после её стука по этому шарику (gKnockBall): на втором шарике, едва конверт сложен, она ещё сидит — первым
// идёт стук («теплее» или повтор), потом уже ожидание с кулаком на стойке.
function guestUrging(){ return GST.here && GST.knocked && gAnswer <= 0 && !EVE.lid && gKnockBall === guestBallNo() && guestWantsFlip() && envelopeDone(); }
function guestKnock(seconds, event){
  gKnock = seconds; gKnockAge = 0; gMain = event === "knock"; gAgain = 0; gPale = null; gKnockBall = guestBallNo();   // место стука — заново (guestPaleEdge)
  guestLog(event, guestFryNow());
}
function guestLeave(why){
  if(!GST.here) return;
  GST.here = false; GST.gone = true; gWait = gKnock = gAnswer = 0; panKnock = 0;
  guestLog("leave", { why, answers:GST.answers.map(a => a.answer) });
}
// evening.js зовёт это, когда нарезанный роти отпущен выше нижнего края стойки, ДО сброса стенда.
// Над стойкой левее лампы — роти ей («som»), иначе он ложится на стойку (null).
// Ответ — по той же лестнице, по которой она стучит, и по ОБЕИМ сторонам поданного роти (guestVerdict):
// перевернуть вовремя — быстрый путь к хрусту, а не штраф (до сборки 78 считалась только сторона на
// таве, и лучшей тактикой было не переворачивать). Цвет стороны не убывает, поэтому «наибольшая
// ступень за роти» — это и есть её ступень сейчас. Хруст стенда (dishCrisp, маргарин под краем)
// заменяет дожарку второй стороны: это ответ руками на её стук.
function guestTakes(client){
  if(!GST.here || gAnswer > 0 || GST.answers.length >= 2 || !client) return false;
  const G = eveGeo(), Z = guestSlot(G).zone, p = evePt(client.x, client.y);
  return !(p.x < Z.x0 || p.x > Z.x1 || p.y > Z.y1);
}
// Стенд зовёт это ДО своего serveDish(): сырой роти (обе стороны ниже «бледного») она не берёт —
// качает головой, роти остаётся на столе, подарка нет, вечер его не считает.
function guestRefuses(client){
  if(!guestTakes(client)) return false;
  const S = guestSides();
  if(guestVerdict(S.bottom, S.top, S.crisp) !== "raw") return false;
  gHead = gHeadT = GUEST_SHAKE_HEAD_S; gKnock = 0; panKnock = 0;
  guestLog("refuse", { crisp:S.crisp, bottom:cookWord(S.bottom), top:cookWord(S.top), panSeconds:Math.round(dish.panTime || 0) });
  return true;
}
function guestServe(client){
  if(!guestTakes(client)) return null;
  const S = guestSides(), crisp = S.crisp;                 // то же число, что в карточке стенда (serve.crisp)
  const verdict = guestVerdict(S.bottom, S.top, crisp);
  if(verdict === "raw") return null;                       // сюда сырой не доходит (guestRefuses); на всякий случай — на стойку
  const step = Math.max(guestStepOf(S.bottom), guestStepOf(S.top));
  const answer = verdict === "crunch" ? "crunch" : "nod";
  const ballNo = guestBallNo();
  GST.answers.push({ ballNo, crisp, step, answer, ...(verdict === "burnt" ? { burnt:true } : {}) });
  GST.gifts.push(GUEST_GIFT[answer]);                      // подарок ложится на полку сразу: перезагрузка его не теряет
  if(typeof shelfGift === "function") shelfGift(GUEST_GIFT[answer]);   // полка шага 5: пополняет, а не добавляет
  GST.taken++; GST.knocked = true;                         // роти у неё: главный стук больше не нужен
  gWait = 0; gKnock = 0; panKnock = 0; gMain = false; gAnswer = GUEST_ANSWER_S;
  guestLog("serve", { crisp, crispWord:crispWord(crisp), step, bottom:cookWord(dishSideMean("cook", "contactWeights")),
    top:cookWord(dishSideMean("cook", "topWeights")), panSeconds:Math.round(dish.panTime || 0) });
  guestLog("answer", { crisp, step, answer, verdict, gift:GUEST_GIFT[answer] });
  return "som";
}
// Сборка 89: роти сняли с тавы на стол (режим блюда fold → cut), а видимая сторона ещё «сырое» — она коротко
// качает головой и смотрит на таву: «верни». Раз на каждый съём (вернули и сняли снова — снова «нет»).
// Видимая сторона — открытая сверху (topWeights): на столе роти лежит так же, как лежал на таве.
function guestSeesRemoval(){
  if(!GST.here || gAnswer > 0) return;
  const top = dishSideMean("cook", "topWeights");
  if(guestStepOf(top) > 0) return;
  gHead = gHeadT = GUEST_NO_S; gNoLook = GUEST_NO_S + GUEST_NO_LOOK_S; gKnock = 0; panKnock = 0;
  guestLog("no", { top:cookWord(top), bottom:cookWord(dishSideMean("cook", "contactWeights")), flips:dish.flips || 0, panSeconds:Math.round(dish.panTime || 0) });
}
function guestUpdate(dt){
  guestMark();
  if(eveDev){ panKnock = 0; return; }
  { const mode = dish ? dish.mode : null, was = gMode; gMode = mode;
    if(was === "fold" && mode === "cut" && !EVE.over && EVE.lamp) guestSeesRemoval(); }
  if(gNoLook > 0) gNoLook = Math.max(0, gNoLook - dt);
  if(EVE.over || !EVE.lamp){ if(GST.here) guestLeave("evening-over"); panKnock = 0; return; }
  if(EVE.lid){ panKnock = 0; return; }                     // тава под крышкой: стук не идёт (картинка 1), счёт стоит и пойдёт с того же места
  if(typeof notebookOpen === "function" && notebookOpen()){ panKnock = 0; return; }   // тетрадь открыта (notebook.js): та же пауза
  const ballNo = guestBallNo();
  if(ballNo !== gBall){ gBall = ballNo; gStep = 0; gBest = 0; gFlips = 0; }   // новый шарик — ступени жарки считаются заново
  // переворот: на стали другая сторона — её ступени она отстукивает заново (вторая «приготовленное» — знак «готово»)
  if(guestFrying() && (dish.flips || 0) !== gFlips){ gFlips = dish.flips || 0; gStep = guestCookStep(); }
  if(guestFrying()) gBest = Math.max(gBest, guestCookStep());     // наибольшая ступень стороны на таве (для журнала; ответ — guestVerdict)
  if(gHead > 0) gHead = Math.max(0, gHead - dt);
  if(gWatch > 0) gWatch = Math.max(0, gWatch - dt);
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
    if(s > gStep){ gStep = s; guestKnock(GUEST_HINT_S, "hint"); return; }
  }
  // Повтор: роти всё лежит той же стороной — она стучит снова, пока его не перевернут или не снимут.
  // Только у готового конверта (ревью сборки 80): раскрытый лист переворачивать нечем, а она стучала по нему
  // каждые 9 с, пока игрок клал банан и заворачивал. Первый стук (она пришла) — как был.
  if(guestWantsFlip() && envelopeDone()){
    gAgain += dt;
    if(gAgain >= GUEST_AGAIN_S) guestKnock(GUEST_KNOCK_S, "again");
  } else gAgain = 0;
}
// Роти отпущен на стойку мимо неё (evening.js зовёт это, когда роти уже посчитан): она поворачивает голову
// туда, где он лёг. Место — его ячейка стойки (как их рисует evening.js); прямо под ней — наклоняется и смотрит вниз.
function guestWatch(client){
  if(!GST.here || gAnswer > 0 || eveDev) return;
  const G = eveGeo(), S = guestSlot(G), C = G.counter;
  const i = Math.max(0, EVE.rotiDone - GST.taken - (typeof nightTook === "function" ? nightTook() : 0) - 1);
  const at = { x:(C.x0 + C.x1)/2 + (i - 1)*66*G.u, y:(C.y0 + C.y1)/2 }, dx = (at.x - (S.x0 + S.w/2))/(S.w/2);
  gWatch = GUEST_WATCH_S; gWatchDir = Math.abs(dx) < 0.25 ? 0 : Math.sign(dx); gWatchAt = at;
  guestLog("watch", { dir:gWatchDir });
}
// 0…1: взгляд вслед набирается за 0,15 с и отпускается за последние 0,35 с.
function guestWatchK(){
  if(!(gWatch > 0)) return 0;
  return Math.max(0, Math.min(1, (GUEST_WATCH_S - gWatch)/0.15, gWatch/0.35));
}
// Где сейчас роти (или лист), пиксели холста; null — на столе ничего нет. Для взгляда.
function guestRotiAt(){
  if(gWatch > 0 && gWatchAt) return gWatchAt;
  if(!EVE.ball || sheetHidden) return null;
  if(!dish){
    const c = centerOfSheet(), ox = xf ? xf.ox || 0 : 0, oy = xf ? xf.oy || 0 : 0;
    return { x:prX(c.x + ox, c.y + oy), y:prY(c.x + ox, c.y + oy) };
  }
  const pose = dishPose(), c = dish.mode === "fold" ? dishCentroid() : (dish.cutCenter || dishCentroid());
  let x = pose.x + c.x*pose.scale, y = pose.y + c.y*pose.scale, up = 0;
  const g = dishGesture;
  if(g && g.slide){ x += g.slide.x*pose.scale; y += g.slide.y*pose.scale; }
  else if(g && g.moved && g.end && dish.mode === "fold"){ x = pose.x + g.end.x*pose.scale; y = pose.y + g.end.y*pose.scale; }   // сгиб: смотрит на палец
  if(dishMove){                                            // перелёт с тавы на стол
    const u = Math.max(0, Math.min(1, (performance.now() - dishMove.t0)/1000/dishMove.T));
    x = panC.x + (x - panC.x)*u; y = panC.y + (y - panC.y)*u;
  }
  if(dishFlight){                                          // переворот: роти взлетает над тавой
    const u = Math.max(0, Math.min(1, (performance.now() - dishFlight.t0)/1000/dishFlight.T));
    up = Math.sin(Math.PI*u)*PAN_R*TILT*(dishFlight.almost ? 0.25 : 0.9);
  }
  return { x:prX(x, y), y:prY(x, y) - up };
}
// Куда смотрят глаза: вектор от её лица к роти (x вправо, y вниз), длиной не больше 1. Длина 1 — роти не
// ближе середины тавы; ближе (взлетел при перевороте, несут к ней) — вектор короче, зрачки идут к середине
// глаза: видно, что она провожает его взглядом вверх. Без роти — вниз, на таву.
function guestGaze(G, S){
  const at = gNoLook > 0 ? G.pan : guestRotiAt(); if(!at) return { x:0, y:1 };   // «нет» на сырое: смотрит на таву, куда его вернуть
  const fx = S.x0 + S.w/2, fy = S.y0 + S.h*0.45 + (guestLow() ? S.sit : 0), dx = at.x - fx, dy = at.y - fy;
  const l = Math.max(Math.hypot(dx, dy), Math.hypot(G.pan.x - fx, G.pan.y - fy), 1e-6);
  return { x:dx/l, y:dy/l };
}
// 0…1: насколько роти сейчас в воздухе над тавой (настоящий переворот) — она на миг поднимает голову за ним.
function guestFlipUp(){
  if(!dishFlight || dishFlight.almost) return 0;
  const u = (performance.now() - dishFlight.t0)/1000/dishFlight.T;
  return u > 0 && u < 1 ? Math.sin(Math.PI*u) : 0;
}
// Самое бледное место у края роти на таве (сборка 89), пиксели холста: GUEST_PALE_N точек по контуру конверта
// (dish.hull), в каждой — цвет видимой стороны верхнего слоя теста чуть внутри от края (GUEST_PALE_IN пути к
// центру). Перевёрнут — точка с наименьшим цветом (равные в пределах GUEST_PALE_TIE — ближняя к ней); не
// перевёрнут — край, ближний к ней (спека). null — роти на таве нет. Место выбирается в начале каждого стука
// (guestKnock сбрасывает кэш) и держится весь стук — палец не перескакивает; новое — только если роти сложили,
// перевернули или поменялся размер холста.
function guestPaleEdge(G, S){
  if(!dish || dish.mode !== "fold" || !dish.thermal || !dish.hull || dish.hull.length < 3) return null;
  const flips = dish.flips || 0, P = gPale;
  if(P && P.faces === dish.faces && P.hull === dish.hull && P.flips === flips && P.G === G.W + "x" + G.H) return P;
  const H = dish.hull, n = H.length, c = dishCentroid(), pose = dishPose(), dough = dish.faces.filter(f => f.kind === "dough");
  const L = H.map((a, i) => Math.hypot(H[(i + 1)%n].x - a.x, H[(i + 1)%n].y - a.y)), per = L.reduce((s, l) => s + l, 0);
  const her = { x:S.x0 + S.w*GUEST_HAND.x, y:S.zone.y1 }, samples = [];
  for(let k = 0; k < GUEST_PALE_N && per > 0; k++){
    let d = (k + 0.5)/GUEST_PALE_N*per, i = 0;
    while(i < n - 1 && d > L[i]){ d -= L[i]; i++; }
    const a = H[i], b = H[(i + 1)%n], s = L[i] ? Math.min(1, d/L[i]) : 0, p = { x:a.x + (b.x - a.x)*s, y:a.y + (b.y - a.y)*s };
    const qx = p.x + (c.x - p.x)*GUEST_PALE_IN, qy = p.y + (c.y - p.y)*GUEST_PALE_IN;
    let f = null; for(let j = dough.length - 1; j >= 0 && !f; j--) if(pointInFace(dough[j].points, qx, qy)) f = dough[j];
    const th = f && dish.thermal[f.source]; if(!th) continue;
    const X = pose.x + p.x*pose.scale, Y = pose.y + p.y*pose.scale, x = prX(X, Y), y = prY(X, Y);
    samples.push({ x, y, cook:th.cook[f.turned ? 0 : 1], near:Math.hypot(x - her.x, y - her.y), src:f.source, side:f.turned ? 0 : 1 });
  }
  if(!samples.length) return null;
  const low = Math.min(...samples.map(q => q.cook));
  const pool = flips ? samples.filter(q => q.cook - low <= GUEST_PALE_TIE) : samples;
  const best = pool.reduce((m, q) => q.near < m.near ? q : m);
  return gPale = { x:best.x, y:best.y, cook:best.cook, low, samples, faces:dish.faces, hull:dish.hull, flips, G:G.W + "x" + G.H };
}
// Куда она стучит: самое бледное место края роти (guestPaleEdge), без роти — дальний борт тавы под её рукой
// (rim — он же, для сравнения в проверках); hit — палец сейчас бьёт (тава вздрагивает), marks — метки стука
// видны (удар и GUEST_MARK_S после него).
function guestKnockAt(G, S){
  const hx = S.x0 + S.w*0.80, k = Math.max(-0.8, Math.min(0.8, (hx - G.pan.x)/PAN_R*0.55));   // от плеча наискось к середине борта
  const hit = gKnock > 0 && GUEST_SHAKE.some(([a, b]) => gKnockAge >= a && gKnockAge < b);
  const marks = gKnock > 0 && GUEST_SHAKE.some(([a, b]) => gKnockAge >= a && gKnockAge < b + GUEST_MARK_S);
  const rim = { x:G.pan.x + k*PAN_R*1.02, y:G.pan.y - PAN_R*TILT*1.02*Math.sqrt(1 - k*k) }, pale = guestPaleEdge(G, S);
  return { hand:{ x:hx, y:S.zone.y1 - 6*G.u }, rim, at:pale ? { x:pale.x, y:pale.y } : rim, pale, hit, marks };
}
// Наклон, доля высоты рамки: стучит — наклонилась к таве; смотрит вслед роти прямо под собой — тоже (поза).
function guestLean(){ return (guestPic() === 2 ? GUEST_LEAN : 0) + (gWatchDir === 0 ? GUEST_LEAN*guestWatchK() : 0); }
function guestKnocking(){ return GST.here && (gKnock > 0 || guestUrging()) && !EVE.lid && gAnswer <= 0; }
function guestPic(){
  if(!GST.here) return 0;
  if(gAnswer > 0) return GST.answers[GST.answers.length - 1].answer === "crunch" ? 4 : 3;
  if(EVE.lid) return 1;                                    // под крышкой она просто ждёт
  return gKnock > 0 || guestUrging() ? 2 : 1;
}
// Своих слов в строке у неё нет (сборка 80): строка стенда не называет, кому нести, — её видно. html.guest
// (stand.css) остаётся меткой «она у стойки» для проверок и стилей.
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
    shelf:c(F.x0 + F.w/2, F.y), shelfTop:r.top + (F.y - 23*G.u)*ky, gifts:GST.gifts.slice(), knock:panKnock*ky, head:+guestHeadTurn().toFixed(3),
    gaze:(g => ({ x:+g.x.toFixed(3), y:+g.y.toFixed(3) }))(guestGaze(G, S)), lean:+(guestLean()*S.h*ky).toFixed(2), watch:+guestWatchK().toFixed(3), watchDir:gWatchDir,
    arm:guestKnocking() ? (K => ({ rim:c(K.rim.x, K.rim.y), at:c(K.at.x, K.at.y), hit:K.hit, marks:K.marks,
      ...(A => ({ root:c(A.root.x, A.root.y), tip:c(A.tip.x, A.tip.y), edge:c(A.edge.x, A.edge.y), reach:+(A.reach*ky).toFixed(1), full:+(A.full*ky).toFixed(1), head:+(A.head*ky).toFixed(1) }))(guestArmPose(G, S, K)),
      pale:K.pale ? { cook:+K.pale.cook.toFixed(3), low:+K.pale.low.toFixed(3), edge:K.pale.samples.map(q => ({ ...c(q.x, q.y), cook:+q.cook.toFixed(3), src:q.src, side:q.side })) } : null }))(guestKnockAt(G, S)) : null,
    again:+gAgain.toFixed(2), noLook:+gNoLook.toFixed(2), urging:guestUrging(), counterTop:r.top + G.counter.y0*ky };
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
  const S = guestSlot(G), dy = guestPicRect(G, S, pic).dy;
  g.save(); g.beginPath(); g.rect(0, 0, G.W*sx, S.zone.y1*sy); g.clip();
  if(guestPictures()){
    const im = pic === 2 ? guestKnockImage() : gImgs[pic - 1], k = Math.min(S.w/im.naturalWidth, S.h/im.naturalHeight), w = im.naturalWidth*k, h = im.naturalHeight*k;
    const turn = guestHeadTurn(), x0 = S.x0 + (S.w - w)/2, y0 = S.y0 + S.h - h + dy;
    if(gHead > 0) guestShakeImage(g, sx, sy, im, x0, y0, w, h, turn);   // «нет»: качается голова, плечи стоят
    else {                                                 // вслед роти на стойке: картинка чуть сжимается и уходит в сторону
      const w2 = w*(1 - 0.07*Math.abs(turn));
      g.drawImage(im, (S.x0 + (S.w - w2)/2 + turn*0.05*S.w)*sx, y0*sy, w2*sx, h*sy);
    }
  } else guestPlaceholder(g, sx, sy, S, dy, pic, guestHeadTurn(), guestGaze(G, S));
  if(pic === 1 && typeof shelfSomJar === "function" && shelfSomJar()) guestJar(g, sx, sy, S, dy);
  g.restore();
}
// Качание головой на PNG (сборка 89; до неё сдвигалась вся картинка на 5 % — на 390×844 это 6 px, «нет» не
// читалось): картинка режется по высоте на полосы, голова (выше GUEST_NECK[0]) уходит вбок на GUEST_SHAKE_X ширины
// и сжимается, шея сдвигается плавно до нуля у ворота (GUEST_NECK[1]), плечи и руки стоят. Рисунок тот же.
const GUEST_NECK = [0.56, 0.67], GUEST_SHAKE_X = 0.08, GUEST_SHAKE_SQ = 0.12, GUEST_NECK_STRIPS = 12;
function guestShakeImage(g, sx, sy, im, x0, y0, w, h, turn){
  const nw = im.naturalWidth, nh = im.naturalHeight, [a, b] = GUEST_NECK;
  const band = (v0, v1, k) => {                            // строки картинки v0…v1 (доли высоты), k — доля поворота
    const ww = w*(1 - GUEST_SHAKE_SQ*Math.abs(turn)*k), xx = x0 + (w - ww)/2 + turn*k*GUEST_SHAKE_X*w;
    g.drawImage(im, 0, v0*nh, nw, (v1 - v0)*nh, xx*sx, (y0 + v0*h)*sy, ww*sx, (v1 - v0)*h*sy + 0.6);
  };
  band(b, 1, 0);
  for(let i = 0; i < GUEST_NECK_STRIPS; i++){ const v0 = a + (b - a)*i/GUEST_NECK_STRIPS; band(v0, v0 + (b - a)/GUEST_NECK_STRIPS, 1 - (i + 0.5)/GUEST_NECK_STRIPS); }
  band(0, a, 1);
}
// Рамка картинки гостьи в кадре (пиксели холста, со сдвигом «села»/наклон): где PNG или заглушка.
function guestPicRect(G, S, pic){
  const dy = (guestLow() ? S.sit : 0) + (guestLean() - (pic === 1 ? GUEST_FLIP_UP*guestFlipUp() : 0))*S.h;
  if(!guestPictures()) return { x:S.x0, y:S.y0 + dy, w:S.w, h:S.h, dy };
  const im = gImgs[pic - 1], k = Math.min(S.w/im.naturalWidth, S.h/im.naturalHeight), w = im.naturalWidth*k, h = im.naturalHeight*k;
  return { x:S.x0 + (S.w - w)/2, y:S.y0 + S.h - h + dy, w, h, dy };
}
// Рука (сборка 89, раунд 2): из стучащего кулака картинки 2 (GUEST_HAND, у края стойки) выходит короткое предплечье.
// Сборка 95 (ревью 18.11, п. 2): указательный палец вниз в стойку читался «клади сюда» — теперь она стучит КУЛАКОМ
// (костяшками вниз) по краю стойки, ближнему к таве: предплечье тянется от её края стойки к ближнему (чуть к таве по x),
// не дальше GUEST_REACH её картинки. На ударе кулак на краю (тава вздрагивает, у костяшек — короткие чёрточки
// удара), между двумя ударами одного стука приподнят на GUEST_LIFT; пока она ждёт между стуками (guestUrging) —
// кулак лежит на краю. Метки стука — по-прежнему в самом бледном месте на роти (K.at). Взгляд — на роти:
// у картинки 2 голова картинки 1 (глаза вниз, guestKnockImage). Цвета — кожа, обводка и браслет её картинок.
const GUEST_REACH = 0.62, GUEST_LIFT = 0.16, GUEST_FIST_X = 0.3;
function guestArmPose(G, S, K){
  const R = guestPicRect(G, S, 2), u = G.u, H = R.h*0.42;
  const root = { x:R.x + R.w*GUEST_HAND.x, y:Math.min(R.y + R.h*GUEST_HAND.y, S.zone.y1 - 3*u) };
  const edge = { x:root.x + (G.pan.x - root.x)*GUEST_FIST_X, y:G.counter.y1 - 0.16*H };     // костяшки — у ближнего края стойки
  const L0 = Math.max(1e-6, Math.hypot(edge.x - root.x, edge.y - root.y)), dx = (edge.x - root.x)/L0, dy = (edge.y - root.y)/L0;
  const full = Math.min(L0, R.h*GUEST_REACH), up = gKnock > 0 && !K.hit;                     // между ударами одного стука — приподнят
  const reach = full*(up ? 1 - GUEST_LIFT : 1);
  return { root, dx, dy, reach, head:H, edge, full, tip:{ x:root.x + dx*reach, y:root.y + dy*reach } };
}
function guestArm(g, sx, sy, G){
  if(!guestKnocking()) return;
  const u = G.u, S = guestSlot(G), K = guestKnockAt(G, S), A = guestArmPose(G, S, K), H = A.head;
  const SKIN = "#cf925c", LINE = "#4a2a1a", SILVER = "#aaa198", SHADE = "#a86f42";
  const { root, dx, dy, tip } = A, nx = -dy, ny = dx, k = H/100;           // размеры — доли длины её головы
  const fr = 20*k, fc = { x:tip.x - dx*fr, y:tip.y - dy*fr }, wr = { x:fc.x - dx*fr*0.9, y:fc.y - dy*fr*0.9 };
  const P = (p, s, w) => [(p.x + nx*w*s)*sx, (p.y + ny*w*s)*sy];
  const arm = (pad, color) => {                              // предплечье: от её кулака картинки к запястью
    g.fillStyle = color; g.beginPath();
    g.moveTo(...P(root, 1, 18*k + pad)); g.lineTo(...P(wr, 1, 14*k + pad)); g.lineTo(...P(wr, -1, 14*k + pad)); g.lineTo(...P(root, -1, 18*k + pad));
    g.closePath(); g.fill();
    g.beginPath(); g.ellipse(root.x*sx, root.y*sy, (19*k + pad)*sx, (15*k + pad)*sy, 0, 0, Math.PI*2); g.fill();
  };
  const line = (p, q, w, color) => {
    g.strokeStyle = color; g.lineWidth = Math.max(1, w*sx); g.lineCap = "round";
    g.beginPath(); g.moveTo(p.x*sx, p.y*sy); g.lineTo(q.x*sx, q.y*sy); g.stroke();
  };
  const rot = Math.atan2(dy*sy, dx*sx);
  const fist = (pad, color) => { g.fillStyle = color; g.beginPath(); g.ellipse(fc.x*sx, fc.y*sy, (fr + pad)*sx, (fr*1.12 + pad)*sy, rot, 0, Math.PI*2); g.fill(); };
  const o = Math.max(1.2*u, 2.4*k);
  g.save();
  arm(o, LINE); fist(o, LINE);                                              // обводка
  arm(0, SKIN); fist(0, SKIN);                                              // кожа
  // согнутые пальцы: три складки поперёк кулака у костяшек и большой палец сбоку
  for(const t of [-0.45, 0, 0.45]){
    const c = { x:fc.x + dx*fr*0.55 + nx*fr*t, y:fc.y + dy*fr*0.55 + ny*fr*t };
    line({ x:c.x - dx*fr*0.45, y:c.y - dy*fr*0.45 }, c, 1.6*k + 0.6*u, SHADE);
  }
  line({ x:fc.x - dx*fr*0.2 - nx*fr*0.95, y:fc.y - dy*fr*0.2 - ny*fr*0.95 }, { x:fc.x + dx*fr*0.35 - nx*fr*0.55, y:fc.y + dy*fr*0.35 - ny*fr*0.55 }, 2*k + 0.6*u, SHADE);
  const b0 = { x:wr.x - dx*3*k, y:wr.y - dy*3*k };                          // браслет поперёк запястья
  for(const t of [0, 4]){ const c = { x:b0.x - dx*t*k, y:b0.y - dy*t*k }; line({ x:c.x + nx*14.5*k, y:c.y + ny*14.5*k }, { x:c.x - nx*14.5*k, y:c.y - ny*14.5*k }, 3*k, SILVER); }
  if(K.hit){                                                 // удар о край стойки: две короткие чёрточки по бокам костяшек
    for(const s of [-1, 1]) line({ x:tip.x + nx*s*fr*1.25, y:tip.y + ny*s*fr*1.25 - 1*u }, { x:tip.x + nx*s*fr*1.9, y:tip.y + ny*s*fr*1.9 - 4*u }, 1.8*u, "#f0e0b0");
  }
  if(K.marks){                                               // метки — в самом месте на роти
    for(const [mx, my, ex, ey] of [[-13, 2, -24, -3], [13, 2, 24, -3], [-7, 11, -13, 20], [7, 11, 13, 20]])
      line({ x:K.at.x + mx*u, y:K.at.y + my*u }, { x:K.at.x + ex*u, y:K.at.y + ey*u }, 2.5*u, "#f0e0b0");
  }
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
  if(eveDev || !GST.here) return;
  if(guestCarried()) guestFigure(g, sx, sy, G);
  guestArm(g, sx, sy, G);
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
// Поворот головы «нет»: −1…1, два качания за GUEST_SHAKE_HEAD_S, затухает. 0 — голова прямо.
function guestHeadTurn(){
  if(!(gHead > 0)) return gWatchDir*guestWatchK();          // вслед роти на стойке: голова повёрнута и стоит
  const u = 1 - gHead/gHeadT;                               // отказ у стойки — 1,1 с, «нет» на сырое на столе — 0,6 с
  return Math.sin(u*Math.PI*4)*(1 - 0.5*u);
}
function guestPlaceholder(g, sx, sy, S, dy, pic, turn = 0, gaze = { x:0, y:1 }){
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
  // Взгляд за роти должен читаться (ревью сборки 80: ход зрачка был 1–2 px): зрачок ходит на GAZE_EYE рамки,
  // и голова чуть идёт следом (GAZE_HEAD), как при повороте вслед роти на стойке.
  const GAZE_EYE = 0.065, GAZE_HEAD = 0.03, follow = (pic === 1 || pic === 2) && !(gHead > 0);   // стучит — тоже смотрит на роти (сборка 95)
  g.translate(R(0.045*turn + (follow ? GAZE_HEAD*gaze.x : 0)), 0);   // «нет»: голова уходит в сторону, лицо — ещё дальше (face)
  const face = 0.085*turn;
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
    // 1 и 2 — глаза идут за роти (без роти — вниз, на таву); 3 — прямо
    const r = pic === 2 ? 0.03 : 0.023;
    const ex = follow ? gaze.x*GAZE_EYE : 0, ey = follow ? (gaze.y*2 - 1)*GAZE_EYE : 0;
    for(const s of [-1, 1]) ell(hx + face + ex + s*0.075*(1 - 0.3*Math.abs(turn)), hy + 0.01 + ey, r, r*1.1, DARK);
    stroke(pic === 3 ? [[hx - 0.07, hy + 0.135], [hx + 0.07, hy + 0.135]] : [[hx + face - 0.035, hy + 0.135], [hx + face + 0.035, hy + 0.135]], 0.02, DARK);
  }
  g.restore();
  if(pic === 1){                                           // пальцы на серебряном браслете
    g.fillStyle = "#b9b3a8"; g.fillRect(X(0.50), Y(0.86), R(0.05), RY(0.10));
    ell(0.43, 0.91, 0.08, 0.055, SKIN);
  } else if(pic === 2){                                    // рука тянется к таве: дальше её рисует guestArm поверх стойки
    ell(0.80, 0.97, 0.085, 0.09, CLOTH);
  } else {                                                 // кусок роти в руке
    ell(0.76, 0.90 - up*0.5, 0.075, 0.05, "#c9a15a");
    ell(0.70, 0.93 - up*0.5, 0.06, 0.05, SKIN);
  }
}

// ─────────────────────────── запуск
guestLoad();
