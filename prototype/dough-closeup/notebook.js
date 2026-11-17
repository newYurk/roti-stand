"use strict";
/* Тетрадь — шаг 3 v0 (docs/v0-step3-notebook.md).
   Грузится ПОСЛЕ guest.js и только смотрит на стенд: в момент подачи снимает роти видом сверху
   (маленький JPEG) и помнит, кому он ушёл; лежит на тележке рядом с радио; по касанию выезжает
   листом снизу — слева один рисунок рукой Мали (роти с лучами хруста и маленькая Сом), справа мои
   роти этого вечера с меткой, кто съел. Слов в тетради нет, пустых рамок, счётчиков и оценок тоже.
   Рамка вечера (evening.js) зовёт отсюда под typeof: notebookDown / notebookMove / notebookUp,
   notebookUpdate, notebookDrawItem, notebookDraw, notebookSnap, notebookNewEvening, notebookOpen,
   notebookState, notebookExport. Без этого файла вечер идёт как в шаге 2.
   Пока тетрадь открыта, жарка стоит, как под крышкой (тот же fryHold стенда), гостья ждёт (guest.js).
   Правило владелицы 17.11: плоские фигуры в палитре стенда, без свечения и частиц; из движения —
   только выезд листа. Сама тетрадь открывается один раз за вечер, после первого ответа Сом, на 1,2 с. */

const NB_V = 1;
const NB_EVENINGS = 7, NB_PER_EVENING = 3;             // хранится 7 вечеров по три роти — до 21 снимка
const NB_SHOT_PX = 240, NB_SHOT_BYTES = 30*1024;       // снимок: сторона в пикселях и предел веса JPEG
const NB_SHOT_Q = [0.72, 0.58, 0.44, 0.30];            // качество JPEG по убыванию, пока не уложится в предел
const NB_SLIDE_S = 0.18, NB_PEEK_S = 1.2, NB_SWIPE = 40;   // выезд листа, показ «сама», свайп (CSS px)
const NB_QUIET_S = 2.5;                                // показ «сама» — не раньше, чем через столько после подачи или загрузки
const NB_PAPER = "#e8dcc0", NB_INK = "#3a2c1e", NB_COVER = "#b5563f", NB_BRASS = "#d9a441";

function nbFresh(){ return { v:NB_V, cur:false, peeked:false, evenings:[] }; }
let NB = nbFresh();
let nbEvents = [];                   // журнал тетради: хранится в roti_evening.notebook.events
// Живёт только в кадре: открыта ли (0 нет, 1 — открыла рука, 2 — приоткрылась сама), выезд листа 0…1,
// остаток показа, страница, палец на листе, пальцы на экране (сама она не открывается под пальцем).
let nbMode = 0, nbAnim = 0, nbPeek = 0, nbPage = 0, nbDrag = null, nbOpenAt = 0;
let nbQuiet = NB_QUIET_S;            // сколько ещё ждать до показа «сама»: заводится подачей и загрузкой страницы
const nbTouches = new Set();
const nbPics = new Map();            // data URL → Image

// ─────────────────────────── сохранение и журнал
function notebookState(){ return { ...NB, events:nbEvents }; }
// В выгрузку журнала картинки не кладутся: только кто съел и сколько весит снимок.
function notebookExport(){
  return { state:{ cur:NB.cur, peeked:NB.peeked, open:nbMode, page:nbPage,
    evenings:NB.evenings.map(e => ({ ts:e.ts, snaps:e.snaps.map(s => ({ to:s.to, crisp:s.crisp, step:s.step, kb:nbKb(s.img), ts:s.ts })) })) }, events:nbEvents };
}
function nbBytes(url){ return typeof url === "string" ? Math.floor((url.length - url.indexOf(",") - 1)*3/4) : 0; }
function nbKb(url){ return +(nbBytes(url)/1024).toFixed(1); }
function nbLoad(){
  const s = typeof eveNbRaw !== "undefined" ? eveNbRaw : null;
  if(!s || s.v !== NB_V || !Array.isArray(s.evenings)) return;
  const snap = x => x && (x.to === "som" || x.to === "counter" || x.to === "dog")
    ? { to:x.to, img:typeof x.img === "string" && x.img.startsWith("data:image/") ? x.img : null, crisp:+x.crisp || 0, step:Math.round(+x.step) || 0, ts:x.ts } : null;
  const evenings = s.evenings.map(e => ({ ts:e && e.ts, snaps:(e && Array.isArray(e.snaps) ? e.snaps : []).map(snap).filter(Boolean).slice(0, NB_PER_EVENING) }))
    .filter(e => e.snaps.length).slice(-NB_EVENINGS);
  NB = { v:NB_V, cur:!!s.cur && evenings.length > 0, peeked:!!s.peeked, evenings };
  if(Array.isArray(s.events)) nbEvents = s.events.slice(-60);
}
// quiet — листание: строка остаётся в журнале тетради (уйдёт в сохранение со следующим событием), но
// не переписывает всё сохранение со снимками на каждый свайп и не вытесняет замеры из общего журнала.
function nbLog(event, extra, quiet){
  const row = { event, ...(extra || {}), ts:new Date().toISOString() };
  nbEvents.push(row); if(nbEvents.length > 60) nbEvents.shift();
  if(quiet) return;
  gestures.push({ ...measurementContext(), kind:"notebook", ...row });
  if(gestures.length > 200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
  eveSave();
}
// Страницы для листания: прошедшие вечера по порядку и последним — этот вечер (пустой, пока не подано).
function nbPages(){ return NB.cur ? NB.evenings : NB.evenings.concat([{ snaps:[] }]); }

// ─────────────────────────── снимок поданного роти
// Вид сверху, без наклона стола: те же грани, что на стенде (drawDishFaces), в отдельный маленький
// холст. Зовётся из eveningServed() ДО сброса стенда — роти ещё цел.
// Цвет — жареной стороны: сверху у конверта клапаны, а жарится низ, и по виду сверху прожарку было
// не различить (замер сборки 76). На время снимка каждому участку листа ставится большая из его двух
// сторон, но не меньше средней прожарки стороны, лежавшей на таве; после снимка всё возвращается.
function nbFriedSide(draw){
  const T = dish.thermal, keep = [];
  if(!Array.isArray(T)) return draw();
  let m = 0;
  try{ m = Math.max(dishSideMean("cook", "contactWeights"), dishSideMean("cook", "topWeights")) || 0; }catch(e){ m = 0; }
  try{
    for(const t of T){
      if(!t || !Array.isArray(t.cook)) continue;
      keep.push([t, t.cook]);
      const v = Math.max(+t.cook[0] || 0, +t.cook[1] || 0, m);
      t.cook = [v, v];
    }
    return draw();
  } finally { for(const [t, c] of keep) t.cook = c; }
}
function nbShot(){
  if(typeof dish === "undefined" || !dish || !dish.faces || !dish.faces.length) return null;
  const c = document.createElement("canvas"); c.width = c.height = NB_SHOT_PX;
  const g = c.getContext && c.getContext("2d"); if(!g) return null;
  const b = dishBounds(), w = Math.max(1e-6, b.right - b.left, b.bottom - b.top), k = NB_SHOT_PX*0.80/w;
  const cx = (b.left + b.right)/2, cy = (b.top + b.bottom)/2, zk = k/ROTI_R_MM*0.6;
  g.fillStyle = "#3a2c1e"; g.fillRect(0, 0, NB_SHOT_PX, NB_SHOT_PX);
  const screen = p => ({ x:NB_SHOT_PX/2 + (p.x - cx)*k, y:NB_SHOT_PX*0.52 + (p.y - cy)*k });
  nbFriedSide(() => drawDishFaces(g, dish.faces, screen, stackHeights(dish.faces), zk, true, pieceShiftLive(dish.faces)));
  if(typeof c.toDataURL !== "function") return null;
  for(const q of NB_SHOT_Q){
    const url = c.toDataURL("image/jpeg", q);
    if(typeof url === "string" && url.startsWith("data:image/") && nbBytes(url) <= NB_SHOT_BYTES) return url;
  }
  return null;                                           // не уложился — запись остаётся без картинки
}
function notebookSnap(to){
  let img = null;
  try{ img = nbShot(); }catch(e){ img = null; }          // снимок не должен сорвать подачу
  if(!NB.cur){ NB.evenings.push({ ts:new Date().toISOString(), snaps:[] }); NB.cur = true; }
  while(NB.evenings.length > NB_EVENINGS) NB.evenings.shift();
  const ev = NB.evenings[NB.evenings.length - 1];
  const stepOf = typeof guestStepOf === "function" ? guestStepOf : () => 0;
  let step = 0;
  try{ step = Math.max(stepOf(dishSideMean("cook", "contactWeights")), stepOf(dishSideMean("cook", "topWeights"))); }catch(e){}
  if(to === "som" && typeof GST !== "undefined" && GST.answers.length) step = Math.max(step, GST.answers[GST.answers.length - 1].step || 0);
  to = to === "som" || to === "dog" ? to : "counter";       // «dog» — шаг 4 (night.js): роти ушёл псу
  ev.snaps.push({ to, img, crisp:+(+dishCrisp || 0).toFixed(1), step, ts:new Date().toISOString() });
  while(ev.snaps.length > NB_PER_EVENING) ev.snaps.shift();
  nbQuiet = NB_QUIET_S;
  nbLog("snap", { to, kb:nbKb(img), n:ev.snaps.length });
}
// Снимки этого вечера (для ночного кадра, шаг 4).
function notebookEvening(){ return NB.cur ? NB.evenings[NB.evenings.length - 1].snaps : []; }
// evening.js зовёт это из eveNewEvening. «Начать вечер заново» посреди вечера — тот же вечер с начала:
// его снимки стираются. Оконченный вечер остаётся страницей; следующий начнётся с новой.
function notebookNewEvening(from, wasOver){
  if(NB.cur && !wasOver && from === "radio") NB.evenings.pop();
  NB.cur = false; NB.peeked = false;
  nbMode = 0; nbAnim = 0; nbPeek = 0; nbDrag = null; nbPage = nbPages().length - 1; nbQuiet = NB_QUIET_S;
}

// ─────────────────────────── открыть и закрыть
function notebookOpen(){ return nbMode !== 0; }
function nbOpen(how){
  nbMode = how === "peek" ? 2 : 1; nbPeek = how === "peek" ? NB_PEEK_S : 0;
  nbPage = nbPages().length - 1; nbDrag = null; nbOpenAt = performance.now();
  fryHold = true;                                        // жарка стоит, как под крышкой
  if(how === "peek") NB.peeked = true;
  nbLog("open", { how });
}
function nbClose(how){
  if(!nbMode) return;
  nbMode = 0; nbPeek = 0; nbDrag = null;
  fryHold = EVE.lid;                                     // крышка, если лежит, держит жарку дальше
  nbLog("close", { how, seconds:+((performance.now() - nbOpenAt)/1000).toFixed(1) });
}
function nbTurn(d){
  const n = nbPages().length, to = Math.max(0, Math.min(n - 1, nbPage + d));
  if(to === nbPage) return false;
  nbPage = to; nbLog("page", { page:to, of:n }, true);
  return true;
}
function notebookUpdate(dt){
  if(eveDev){ if(nbMode){ nbMode = 0; nbDrag = null; } nbAnim = 0; return; }
  nbAnim = Math.max(0, Math.min(1, nbAnim + (nbMode ? dt : -dt)/NB_SLIDE_S));
  if(nbMode === 2){ nbPeek -= dt; if(nbPeek <= 0) nbClose("auto"); return; }
  // Сама — один раз за вечер: Сом ответила в первый раз, ответ отстоял, прошло 2,5 с после подачи (или
  // после загрузки страницы: ответ Сом перезагрузку не переживает, и без этой паузы лист выезжал на первом
  // кадре), на экране нет пальцев, меню радио закрыто, стол свободен. Взяла следующий шарик раньше —
  // показ ждёт следующей подачи, а не выезжает на тесто посреди работы.
  if(nbMode || NB.peeked || !NB.cur) return;
  if(nbQuiet > 0){ nbQuiet -= dt; return; }
  const radio = eveEl("radioSheet");
  if(EVE.lamp && !EVE.lid && !EVE.over && !EVE.ball && nbTouches.size === 0 && (!radio || radio.hidden)
    && typeof GST !== "undefined" && GST.answers.length >= 1 && gAnswer <= 0) nbOpen("peek");
}

// ─────────────────────────── раскладка (пиксели холста)
function nbGeo(G){
  const u = G.u, R = G.radio;
  const item = { x0:R.x0 + R.w + 8*u, w:30*u, h:21*u, y1:R.y1 };
  item.y0 = item.y1 - item.h; item.x1 = item.x0 + item.w; item.x = item.x0 + item.w/2; item.y = item.y0 + item.h/2;
  const h = Math.min(G.H*0.58, 400*u), x0 = G.W*0.03, x1 = G.W*0.97, y0 = G.H - h*nbAnim;
  const pad = 9*u, foot = 38*u, mid = (x0 + x1)/2;
  const left = { x0:x0 + pad, x1:mid - pad*0.5, y0:y0 + pad, y1:y0 + h - foot };
  const right = { x0:mid + pad*0.5, x1:x1 - pad, y0:y0 + pad, y1:y0 + h - foot };
  const ay = y0 + h - foot*0.5;
  const row = (right.y1 - right.y0)/NB_PER_EVENING, side = Math.min(row - 8*u, right.x1 - right.x0 - 40*u);
  const cells = [0, 1, 2].map(i => ({ x:right.x0 + 2*u, y:right.y0 + row*i + (row - side)/2, s:side,
    mx:(right.x0 + 2*u + side + right.x1)/2, my:right.y0 + row*(i + 0.5) }));
  return { u, item, sheet:{ x0, x1, y0, h, mid }, left, right, cells,
    prev:{ x:x0 + 30*u, y:ay }, next:{ x:x1 - 30*u, y:ay }, arrowHit:28*u };
}
function nbItemHit(G, p){
  const N = nbGeo(G), I = N.item, u = G.u;
  if(p.x < I.x0 - 7*u || p.x > I.x1 + 14*u || Math.abs(p.y - I.y) > 24*u) return false;
  return Math.abs(p.x - I.x) <= Math.abs(p.x - G.radio.x);    // у самого радио касание — радио
}
// Где что, в CSS px окна — для проверок касаниями.
function notebookSpots(){
  const G = eveGeo(), N = nbGeo(G), r = cv.getBoundingClientRect(), k = r.width/cv.width, ky = r.height/cv.height;
  const c = p => ({ x:r.left + p.x*k, y:r.top + p.y*ky }), pages = nbPages(), pg = pages[Math.min(nbPage, pages.length - 1)];
  return { open:nbMode, anim:nbAnim, page:nbPage, pages:pages.length, peeked:NB.peeked, item:c(N.item),
    itemBox:{ ...c({ x:N.item.x0, y:N.item.y0 }), w:N.item.w*k, h:N.item.h*ky },
    sheet:{ x0:r.left + N.sheet.x0*k, x1:r.left + N.sheet.x1*k, y0:r.top + N.sheet.y0*ky, h:N.sheet.h*ky },
    leftPage:c({ x:(N.left.x0 + N.left.x1)/2, y:(N.left.y0 + N.left.y1)/2 }),
    prev:nbPage > 0 ? c(N.prev) : null, next:nbPage < pages.length - 1 ? c(N.next) : null,
    snaps:pg.snaps.map((s, i) => ({ to:s.to, kb:nbKb(s.img), ...c({ x:N.cells[i].x + N.cells[i].s/2, y:N.cells[i].y + N.cells[i].s/2 }), s:N.cells[i].s*k })) };
}

// ─────────────────────────── ввод (evening.js зовёт первым; true — касание забрано)
function notebookDown(id, cx, cy){
  nbTouches.add(id);
  if(eveDev) return false;
  if(nbMode === 2){ nbClose("pass"); return false; }      // приоткрылась сама: касание её закрывает и идёт дальше, к столу
  const G = eveGeo(), p = evePt(cx, cy);
  if(nbMode === 1){
    if(!nbDrag){
      const N = nbGeo(G), near = a => Math.hypot(p.x - a.x, p.y - a.y) <= N.arrowHit;
      nbDrag = { id, x0:p.x, y0:p.y, x:p.x, y:p.y, arrow:near(N.prev) ? -1 : near(N.next) ? 1 : 0 };
    }
    return true;
  }
  // Второй палец посреди жеста тетрадь не открывает: крышка в руке, тесто или роти под пальцем —
  // иначе лист съедал движение первого пальца, а несомый роти подавался из-под открытой тетради.
  if(typeof eveDrag !== "undefined" && eveDrag) return false;
  if(nbTouches.size > 1 || (typeof dishGesture !== "undefined" && dishGesture)
    || (typeof action !== "undefined" && action && action.state !== "RESTING")) return false;
  if(nbItemHit(G, p)){ nbOpen("touch"); return true; }
  return false;
}
function notebookMove(id, cx, cy){
  if(!nbDrag || nbDrag.id !== id) return nbMode === 1;
  const p = evePt(cx, cy); nbDrag.x = p.x; nbDrag.y = p.y;
  return true;
}
function notebookUp(id, cx, cy, cancel){
  nbTouches.delete(id);
  if(!nbDrag || nbDrag.id !== id) return false;
  const d = nbDrag; nbDrag = null;
  if(Number.isFinite(cx) && Number.isFinite(cy)){ const p = evePt(cx, cy); d.x = p.x; d.y = p.y; }
  if(cancel || nbMode !== 1) return true;
  const dx = d.x - d.x0, dy = d.y - d.y0, u = eveGeo().u;
  if(Math.abs(dx) >= NB_SWIPE*u && Math.abs(dx) > Math.abs(dy)){ nbTurn(dx < 0 ? 1 : -1); return true; }   // свайп влево — к следующему вечеру
  if(d.arrow && nbTurn(d.arrow)) return true;
  nbClose("touch");
  return true;
}

// ─────────────────────────── кадр
// Тетрадь на тележке: коралловый переплёт, латунная ложка на обложке, срез страниц снизу.
function notebookDrawItem(g, sx, sy, G){
  if(eveDev) return;
  const I = nbGeo(G).item, u = G.u;
  const box = (x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(x*sx, y*sy, w*sx, h*sy); };
  box(I.x0, I.y0, I.w, I.h, NB_COVER);
  box(I.x0, I.y1 - 4*u, I.w, 4*u, NB_PAPER);
  box(I.x0, I.y0, 4*u, I.h, "#8a4b3c");
  g.fillStyle = NB_BRASS;
  g.beginPath(); g.ellipse((I.x0 + I.w*0.42)*sx, (I.y0 + I.h*0.40)*sy, 4*u*sx, 3*u*sy, 0, 0, Math.PI*2); g.fill();
  box(I.x0 + I.w*0.42 + 3*u, I.y0 + I.h*0.40 - 0.8*u, 11*u, 1.6*u, NB_BRASS);
}
function nbPic(url){
  if(!url || typeof Image === "undefined") return null;
  let im = nbPics.get(url);
  if(!im){ im = new Image(); im.src = url; nbPics.set(url, im); }
  return im.complete && im.naturalWidth > 0 ? im : null;
}
// Метка «кто съел»: маленькая Сом (как её заглушка у стойки), морда пса (шаг 4) или стойка с роти.
function nbMark(g, sx, sy, to, x, y, u){
  const ell = (cx, cy, rx, ry, fill) => { g.fillStyle = fill; g.beginPath(); g.ellipse(cx*sx, cy*sy, rx*sx, ry*sy, 0, 0, Math.PI*2); g.fill(); };
  if(to === "som"){
    ell(x, y + 14*u, 13*u, 7*u, "#8a4b3c");
    ell(x, y - 12*u, 4*u, 3.6*u, "#2a2622");
    ell(x, y - 2*u, 10*u, 11*u, "#2a2622");
    ell(x, y + 1*u, 8*u, 9*u, "#c08a5a");
    for(const s of [-1, 1]){
      g.strokeStyle = "#e0a23a"; g.lineWidth = Math.max(1, 1.4*u*sx); g.beginPath();
      g.ellipse((x + s*9.5*u)*sx, (y + 6*u)*sy, 2.2*u*sx, 2.6*u*sy, 0, 0, Math.PI*2); g.stroke();
    }
    return;
  }
  if(to === "dog"){                                        // те же цвета, что у пса под тележкой (night.js)
    const rot = (cx, cy, rx, ry, a, fill) => { g.fillStyle = fill; g.beginPath(); g.ellipse(cx*sx, cy*sy, rx*sx, ry*sy, a, 0, Math.PI*2); g.fill(); };
    rot(x - 9*u, y - 4*u, 4*u, 9*u, 0.45, "#8b7f6e"); rot(x + 9*u, y - 4*u, 4*u, 9*u, -0.45, "#8b7f6e");
    ell(x, y + 1*u, 10*u, 10*u, "#d9d2c0");
    ell(x, y + 6*u, 5.5*u, 4.5*u, "#f3ead4");
    ell(x, y + 4.5*u, 2.2*u, 1.7*u, "#1d150e");
    ell(x - 4*u, y - 1.5*u, 1.3*u, 1.5*u, "#1d150e"); ell(x + 4*u, y - 1.5*u, 1.3*u, 1.5*u, "#1d150e");
    return;
  }
  g.fillStyle = "#3a2c1e"; g.fillRect((x - 14*u)*sx, (y + 2*u)*sy, 28*u*sx, 9*u*sy);
  g.fillStyle = "#4a3a24"; g.fillRect((x - 14*u)*sx, (y + 2*u)*sy, 28*u*sx, Math.max(1, 2*u*sy));
  ell(x, y - 1*u, 10*u, 4.5*u, "#c9a15a");
}
// Рука Мали: один рисунок тушью — роти, лучи хруста вокруг и маленькая довольная Сом рядом.
// Линии чуть неровные (детерминированная «дрожь»), слов нет. Статус — эскиз: лучи как знак хруста
// владелицей не утверждены (критик, п. 12; 19.09 — словарь знаков не утверждается).
function nbMali(g, sx, sy, P, u){
  const pw = P.x1 - P.x0, ph = P.y1 - P.y0, m = Math.min(pw, ph*0.62);
  const cx = P.x0 + pw*0.47, cy = P.y0 + ph*0.36, r = m*0.27;
  g.save();
  g.strokeStyle = NB_INK; g.lineWidth = Math.max(1, 1.7*u*sx); g.lineCap = "round"; g.lineJoin = "round";
  const line = pts => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0]*sx, p[1]*sy) : g.moveTo(p[0]*sx, p[1]*sy)); g.stroke(); };
  // роти: скруглённый квадрат конверта, обведён дважды, как пером
  for(const [k, ph0] of [[1, 0.4], [0.965, 2.1]]){
    const pts = [];
    for(let i = 0; i <= 48; i++){
      const t = i/48*Math.PI*2, c = Math.cos(t), s = Math.sin(t), w = 1 + 0.025*Math.sin(5*t + ph0);
      pts.push([cx + Math.sign(c)*Math.pow(Math.abs(c), 0.62)*r*k*w, cy + Math.sign(s)*Math.pow(Math.abs(s), 0.62)*r*0.94*k*w]);
    }
    line(pts);
  }
  // два реза крест-накрест
  line([[cx - r*0.80, cy + r*0.05], [cx - r*0.2, cy - r*0.03], [cx + r*0.82, cy + r*0.04]]);
  line([[cx + r*0.03, cy - r*0.76], [cx - r*0.03, cy], [cx + r*0.04, cy + r*0.78]]);
  // лучи хруста: короткие штрихи вокруг, длинный через один; в сторону Сом — без лучей
  for(let i = 0; i < 16; i++){
    const a = i/16*Math.PI*2 + 0.2;
    if(a > 0.35 && a < 1.25) continue;
    const r0 = r*1.26, r1 = r*(i%2 ? 1.46 : 1.62), j = 0.06*Math.sin(i*2.3);
    line([[cx + Math.cos(a)*r0, cy + Math.sin(a)*r0], [cx + Math.cos(a + j)*r1, cy + Math.sin(a + j)*r1]]);
  }
  // маленькая Сом: пучок, лицо, серьги-кольца, глаза закрыты, улыбка, плечи
  const hx = P.x0 + pw*0.70, hy = P.y0 + ph*0.74, h = m*0.115;
  const arc = (x, y, rx, ry, a0, a1) => { g.beginPath(); g.ellipse(x*sx, y*sy, Math.max(.5, rx*sx), Math.max(.5, ry*sy), 0, a0, a1); g.stroke(); };
  arc(hx, hy, h, h*1.15, 0, Math.PI*2);
  arc(hx, hy - h*1.45, h*0.42, h*0.36, 0, Math.PI*2);
  for(const s of [-1, 1]){
    arc(hx + s*h*1.12, hy + h*0.75, h*0.20, h*0.26, 0, Math.PI*2);
    arc(hx + s*h*0.42, hy - h*0.12, h*0.24, h*0.20, 0.15*Math.PI, 0.85*Math.PI);
  }
  arc(hx, hy + h*0.36, h*0.36, h*0.30, 0.1*Math.PI, 0.9*Math.PI);
  arc(hx, hy + h*2.75, h*2.0, h*1.5, 1.14*Math.PI, 1.86*Math.PI);
  g.restore();
}
// Открытая тетрадь: поверх всей сцены (evening.js зовёт последним в верхнем слое).
function notebookDraw(g, sx, sy, G){
  if(eveDev || nbAnim <= 0) return;
  const N = nbGeo(G), u = G.u, S = N.sheet;
  const box = (x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(x*sx, y*sy, w*sx, h*sy); };
  box(0, 0, G.W, G.H, `rgba(8,6,10,${(0.55*nbAnim).toFixed(3)})`);   // сцена затемнена: один плоский слой
  box(S.x0, S.y0, S.x1 - S.x0, S.h, NB_COVER);                       // переплёт
  box(S.x0 + 4*u, S.y0 + 4*u, S.x1 - S.x0 - 8*u, S.h, NB_PAPER);     // разворот
  box(S.mid - Math.max(.5, 0.75*u), S.y0 + 4*u, Math.max(1, 1.5*u), S.h, "#b9a988");   // сгиб
  nbMali(g, sx, sy, N.left, u);
  const pages = nbPages(), pg = pages[Math.min(nbPage, pages.length - 1)];
  pg.snaps.forEach((s, i) => {
    const C = N.cells[i], im = nbPic(s.img);
    box(C.x, C.y, C.s, C.s, "#f3ead4");                              // белое поле карточки
    const q = 3*u;
    if(im) g.drawImage(im, (C.x + q)*sx, (C.y + q)*sy, (C.s - 2*q)*sx, (C.s - 2*q)*sy);
    else {                                                           // снимка нет — плоский роти, как на стойке
      box(C.x + q, C.y + q, C.s - 2*q, C.s - 2*q, "#3a2c1e");
      g.fillStyle = "#c9a15a"; g.beginPath(); g.ellipse((C.x + C.s/2)*sx, (C.y + C.s/2)*sy, C.s*0.30*sx, C.s*0.28*sy, 0, 0, Math.PI*2); g.fill();
    }
    nbMark(g, sx, sy, s.to, C.mx, C.my, u);
  });
  // стрелки «листать» — только туда, где есть вечер
  g.fillStyle = NB_INK;
  const tri = (A, d) => { g.beginPath(); g.moveTo((A.x + d*9*u)*sx, (A.y - 9*u)*sy); g.lineTo((A.x - d*7*u)*sx, A.y*sy); g.lineTo((A.x + d*9*u)*sx, (A.y + 9*u)*sy); g.closePath(); g.fill(); };
  if(nbPage > 0) tri(N.prev, 1);
  if(nbPage < pages.length - 1) tri(N.next, -1);
}

// ─────────────────────────── запуск
// Свернула приложение с открытой тетрадью — она закрывается; паузу дальше держит крышка (evening.js).
document.addEventListener("visibilitychange", () => { if(document.hidden) nbClose("hidden"); });
nbLoad();
nbPage = nbPages().length - 1;
