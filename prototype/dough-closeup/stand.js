"use strict";
/* Прототип «крупный план теста». Ввод перестроен по docs/slap-input-audit.md:
   вместо непрерывной тяги — дискретный жест «поднять и шлёпнуть» со state machine
   RESTING → ARMED → LIFTING → FLYING → IMPACT → SETTLING. Проход A + ядро прохода B.
   Физика: XPBD, равномерная решётка ~1060 узлов; толщина из площади квадов. */

// ─────────────────────────── параметры модели
// Топология: РАВНОМЕРНАЯ решётка, обрезанная по кругу.
// Полярная сетка (24x48 из линзы T2) даёт верное число узлов, но вырождается в центре:
// длина окружного ребра там падает до долей пикселя, относительное растяжение скачет
// до 400%+ и лист «рвётся» в середине от любого движения. Замер это обнаружил сразу.
// Число узлов сохранено (1 060 после обрезки по кругу; прежняя оценка «~1150» была на глаз,
// пересчитано 07.09.2026), однородность рёбер восстановлена.
const BUILD = "2026-11-18 · Сом стучит костяшками, маргарин виден, уголок без кольца, сгущёнка щедрее; лист без заплат · 95";
const GRID = 38;                   // 38x38, в круг попадает 1 060 узлов (посчитано, не оценка)
let SUBSTEPS = 8;                  // T2: 8–10 подшагов, 1 итерация
let DAMP = 0.986;

// ─────────────────────────── ощущение теста: одно место на весь файл (#57)
// Три параметра задаются ползунками «ощущение» и переживают перезагрузку.
// До 08.09.2026 они вдобавок объявлялись здесь литералами — COMPLIANCE 1e-5,
// THICK_BREAK 0,020, CREEP 0,55, — а applyTune() перетирал их при старте. То есть
// объявленные числа в работе не участвовали НИКОГДА, а сверка «модель против кода»
// сравнивала бы модель с ними. Литералы убраны; осталась формула и её исходная точка.
// Рабочая стартовая точка по живой пробе владелицы (#94), не финальный баланс.
// Старые ручные настройки сохраняются; вернуться к этой точке можно кнопкой «исходные».
const TUNE_DEFAULT = Object.freeze({ com:100, creep:100, brk:100 });
const TUNE = { ...TUNE_DEFAULT };
const feelCompliance = t => 0.0000004 * Math.pow(60, t.com/100);   // 4e-7 … 2,4e-5 · при 30 → 1,37e-6
const feelCreep      = t => 0.04 + (t.creep/100) * 0.9;            // 0,04 … 0,94   · при 30 → 0,31
const feelBreak      = t => 0.045 - (t.brk/100) * 0.042;           // 0,045 … 0,003 · при 72 → 0,0148
let COMPLIANCE  = feelCompliance(TUNE);   // податливость
let CREEP       = feelCreep(TUNE);        // текучесть: скорость, с которой длина покоя догоняет текущую
let THICK_BREAK = feelBreak(TUNE);        // лист рвётся там, где истончился до этой доли толщины

// Смена материала сохраняет лист, но его пластическая история становится смешанной.
let runTuneAtBuild = null, mixedTune = false;
function measurementContext(){
  return { build:BUILD, tune:{ ...TUNE },
    runTuneAtBuild:runTuneAtBuild ? { ...runTuneAtBuild } : null, mixedTune,
    fry:typeof FRY_SECONDS==="undefined" ? null : FRY_SECONDS,
    pressGain:typeof PRESS_GAIN==="undefined" ? null : PRESS_GAIN,
    domes:typeof DOMES==="undefined" ? null : DOMES,
    tearFeel:typeof tearFeel==="undefined" ? null : tearFeel };
}
function currentMeasurement(entry){
  return entry.build===BUILD && entry.mixedTune===false &&
    entry.variant===variant && entry.condition===condition &&
    entry.tune && ["com","creep","brk"].every(key=>entry.tune[key]===TUNE[key]);
}

// ─────────────────────────── состояние
let N = 0;
let px, py, vx, vy, prx, pry, pinned, thick;
let gi = new Int32Array(GRID*GRID);          // (i,j) -> node | -1
let quads = [];                              // ячейки решётки для рендера
let quadCons = [], quadPrev = null, quadSm = null;
// Единственный источник истины о жесте (audit §6.1). Не хранить состояние
// параллельно в grabs, DOM и замыканиях — прежний захват означал четыре вещи разом.
let action = { state:"RESTING", pointerId:null, edgeNode:-1, gripIds:[], gripWeights:[],
  down:{x:0,y:0,t:0}, last:{x:0,y:0,t:0}, velocity:{x:0,y:0},
  impulse:0, direction:{x:0,y:0}, timer:0, mul:0, heldAtLift:0, kind:null,
  // перенос в руке: откуда лист взят, поворот пути руки (украшение полёта) и параметры посадки
  sweep:0, tailDir:{x:1,y:0}, carryFrom:{x:0,y:0}, toss:null,
  carryArm:false, two:null, back:null, carryT:0,
  liftRad:null };                   // наружный радиус в точке хвата на момент подъёма
let lastDecision = "—";            // как классифицирован последний мах — для строки статистик
// Сколько махов на шаге 3 стенд засчитал переносом. Нужен потому, что гейт 15°
// решается частотой событий, а не рукой (#91): на живом пальце долю попаданий
// приходится считать вручную, а руками из двадцати попыток не сосчитаешь.
// Считаем только шаг 3: на шаге 2 шлепок — работа, а не промах.
let tossOk = 0, tossTry = 0;
let plasticT = 0;                  // окно пластичности после удара, с
let startArea = 1;                 // площадь листа при рождении — база для areaRatio
let gestures = [];                 // журнал шлепков (audit §6.6)
let cons = null;                             // {a,b,rest,broken}
let edgeNodes = [];                          // граничные узлы — за них берут лист
let rimLoop = [], rimLoopQuad = [];          // кромка по порядку обхода (рёбра ячеек с одной ячейкой) и ячейка каждого её ребра — для рисования
let rimRing = [];                            // те же узлы по кругу, соседи по кромке (для оплывания)
// Разрыв — не провал и не перезапуск (решение владельца 22.08.2026): дырка остаётся
// в листе рваным узором, симуляция не останавливается, тесто не переделывается.
let tornAt = 0, lastSnap = 0, breakTime = 0, pressTime = 0, pressed = false;
// Ответ прибора на предсказание: что показать крупной строкой и с какого момента.
let verdict = "", verdictAt = 0;
let tornNode = null;               // узлы порванных ячеек — для подсветки рваного края
let conDeg = null;                 // сколько живых связей держит узел; 0 = осколок
let runStart = 0, R0 = 1;
let variant = "C", condition = "both";
let log = [];
let latencies = [];

const stage = document.getElementById("stage");
const cv = document.getElementById("cv"), ctx = cv.getContext("2d", { alpha:false });
const lo = document.createElement("canvas"), lctx = lo.getContext("2d", { alpha:false });
const stats = document.getElementById("stats"), flash = document.getElementById("flash");
const miniEl = document.getElementById("mini"), hintEl = document.getElementById("hint");

// ─────────────────────────── раскладка стола (v3: тесто слева, начинки по центру, тава справа)
// Раскладка закрепляется навсегда, чтобы игрок со временем готовил «не глядя».
// Точные пропорции были в утраченном addendum-v3; здесь рабочее приближение, которое и проверяем.
// Дошли до жарки: тава вернулась справа. Мостик начинок вернётся с шагом 4 —
// пока он только отнимал бы место у двух главных жестов: шлепка и переноса.
// Раскладка идёт по ДЛИННОЙ стороне кадра (решение владельца 08.09.2026). В альбоме
// тесто слева, тава справа — как было. В портрете тесто ВНИЗУ, тава ВВЕРХУ, и лист
// закидывается снизу вверх: раньше верх портрета был пустым столом (замер 08.09 —
// две трети поля), и таве при этом не хватало места настолько, что роти выходил за
// её борт на любом экране. Теперь пустая половина стала местом тавы.
const WORK_FRAC = 0.50;
// Гистерезис 1.02: у почти квадратного холста раскладка не должна прыгать от пикселя.
function stackedLayout(){ return cv.height > cv.width * 1.02; }
let panC = { x:0, y:0 }, PAN_R = 1;   // тава: центр и радиус в координатах стола (считаются в build)
// Где лист: на столе (все жесты растяжки) или на таве (жарится; жесты жарки — следующий этап).
let phase = "TABLE";
let cook = null;                   // цвет узла: 0 сырое → 0,4 золотистое → >1,2 тёмное
let dry = null;                    // сушка узла 0→1: пока не 1, цвета нет вообще
let contactF = null;               // пятнистость контакта с плитой, 0,6…1,15
// Перенос: пока лист в руке (CARRY), ложится (LAY), летит (TOSS) или возвращается на стол (BACK),
// узлы физики не двигаются — сдвиг, поворот и подъём применяются к картинке и запекаются в узлы
// при посадке.
let xf = null;                     // {cx,cy,ox,oy,th,lift, layS,layU,layH — укладка с ближнего края}
function sheetInHand(){ const s = action.state; return s==="CARRY" || s==="TOSS" || s==="LAY" || s==="BACK"; }

// Вид не сверху, а из-за прилавка: стол уходит от игрока, поэтому по вертикали
// всё сжато, а дальний край ещё и сужен. Симуляция считается в плоскости стола,
// экранные координаты получаются проекцией — обратное преобразование нужно вводу.
const TILT_BASE = 0.56, PERSP = 0.22;
// Наклон — свой у каждой рамы: камера стенда должна совпасть с камерой художника, иначе круглый
// роти не ложится в нарисованную таву. Мерка — сама тава: высота её эллипса к ширине ≈ TILT/перспектива.
let TILT = TILT_BASE;
function horizon(){ return cv.height * 0.42; }
function prX(x, y){
  const h = horizon(), k = 1 + ((y - h)/cv.height) * PERSP;
  return cv.width*0.5 + (x - cv.width*0.5) * k;
}
function prY(x, y){ const h = horizon(); return h + (y - h) * TILT; }
function unproject(sx, sy){
  const h = horizon(), wy = h + (sy - h)/TILT;
  const k = 1 + ((wy - h)/cv.height) * PERSP;
  return { x: cv.width*0.5 + (sx - cv.width*0.5)/k, y: wy };
}
// ─── Рама одобренного экрана (#102). Стенд рисует стол сам; в раме стол уже нарисован на картинке,
// поэтому свой мы не рисуем, а зоны берём с неё. Включается адресом `?frame=riverside` или `?frame=canal`.
// Рамы: картинка одобренного экрана с ПУСТЫМ столом и пустой тавой (свой лист и роти рисует стенд).
// Получены правкой одобренных экранов (Draw Things, 17.09), лежат рядом со стендом, ~70 КБ каждая.
// Замеры сделаны по копиям 1024×576 — в этом же логическом размере картинки и рисуются.
const FRAME_W = 1024, FRAME_H = 576;
const STAND_BASE = (document.currentScript && document.currentScript.src || "").replace(/[^/]*$/, "");
const FRAMES = {
  riverside: { src: STAND_BASE + "frame-riverside.jpg",                       // день у реки, бабушка за прилавком
    work:{x:24,y:246,w:420,h:225}, pan:{cx:800,cy:352,rx:228,ry:112}, band:{y0:235,y1:492} },
  // Вечер у канала, украшения над прилавком. Картинка переделана 17.09 (владелица: «очень уж получилось
  // мелко… рабочая область должна быть намного больше»): полка и предметы мельче, стол глубже, лоток
  // лопаток убран, вместо вока плоская тава (#44). Камера художника ниже нашей: тава 170×66, отсюда tilt.
  canal:     { src: STAND_BASE + "frame-canal.jpg?v=2026-09-20-back", tilt:0.41,
    work:{x:120,y:340,w:495,h:180}, pan:{cx:824,cy:408,rx:170,ry:66}, band:{y0:300,y1:528} },
};
let frameImg = null, frameOn = false, FRAME = FRAMES.riverside;
function frameWanted(){
  try { const k = new URLSearchParams(location.search).get("frame"); return FRAMES[k] ? k : null; } catch(e) { return null; }
}
function frameFit(){                                  // картинка → холст: по ширине, полоса по центру
  const k = cv.width / FRAME_W, bandMid = (FRAME.band.y0 + FRAME.band.y1) * 0.5;
  return { k, dx: 0, dy: cv.height*0.5 - bandMid*k };
}
const frameX = x => { const f=frameFit(); return f.dx + x*f.k; };
const frameY = y => { const f=frameFit(); return f.dy + y*f.k; };
if(typeof Image!=="undefined" && frameWantedSafe()){
  FRAME = FRAMES[frameWantedSafe()];
  frameImg = new Image();
  frameImg.onload = ()=>{
    frameOn = true; setTilt(FRAME.tilt || TILT_BASE);
    sampleFrameColours();
    // Рама — это экран игры, а не замер: виды A/B рисуют кадр в 80 и 224 пикселя по ширине,
    // и картинка экрана в них превращается в мозаику. В раме всегда полный вид.
    try { variant = "C"; document.querySelectorAll("[data-v]").forEach(b=>b.classList.toggle("on", b.dataset.v==="C")); } catch(e) {}
    try { document.body.classList.add("framed"); } catch(e) {}
    try { resize(true); } catch(e) {}
  };
  frameImg.src = FRAME.src;
}
function frameWantedSafe(){
  try { const u = frameWanted(); if(u) return u; } catch(e) {}
  try { const k = localStorage.getItem("rotiFrame"); return FRAMES[k] ? k : null; } catch(e) { return null; }
}
// Переключение экрана на ходу (владелица 17.09: «между скринами можно переключить?»).
function setFrame(key){
  try { localStorage.setItem("rotiFrame", key || ""); } catch(e) {}
  if(typeof document!=="undefined")
    document.querySelectorAll("[data-frame]").forEach(b=>b.classList.toggle("on", b.dataset.frame===(key||"")));
  if(!FRAMES[key]){                       // без рамы — обратно на свой стол
    frameOn = false; FRAME = FRAMES.riverside; UNDER = TABLE; PAN_UNDER = null; PAL = buildPal(); setTilt(TILT_BASE);
    if(typeof palPan!=="undefined" && palPan.clear) palPan.clear();
    try { document.body.classList.remove("framed"); } catch(e) {}
    try { resize(true); } catch(e) {}
    return;
  }
  FRAME = FRAMES[key];
  const img = new Image();
  img.onload = ()=>{
    frameImg = img; frameOn = true; setTilt(FRAME.tilt || TILT_BASE); sampleFrameColours();
    try { variant = "C"; document.querySelectorAll("[data-v]").forEach(b=>b.classList.toggle("on", b.dataset.v==="C")); } catch(e) {}
    try { document.body.classList.add("framed"); } catch(e) {}
    try { resize(true); } catch(e) {}
  };
  img.src = FRAME.src;
}
// Цвет «под тестом» и «под роти» берётся с самой картинки: средний цвет рабочей поверхности и
// середины тавы. Иначе тонкое тесто просвечивает цветом стола, которого в раме нет.
function sampleFrameColours(){
  try {
    const c = document.createElement("canvas"); c.width = FRAME_W; c.height = FRAME_H;
    const q = c.getContext("2d", {willReadFrequently:true});
    q.drawImage(frameImg, 0, 0, FRAME_W, FRAME_H);
    const avg = (x,y,w,h)=>{
      const d = q.getImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h)).data;
      let r=0,g=0,b=0,n=0;
      for(let i=0;i<d.length;i+=4){ r+=d[i]; g+=d[i+1]; b+=d[i+2]; n++; }
      return [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
    };
    const W_ = FRAME.work, P_ = FRAME.pan;
    // Просвечивание держим тёплым: у сырого роти тень под листом жёлто-песочная, а не стальная.
    // С картинки берём только яркость места (день светлее, вечер темнее), цвет — тёплый.
    const steel = avg(W_.x + W_.w*0.55, W_.y + W_.h*0.25, W_.w*0.4, W_.h*0.5);
    const lum = Math.max(0.55, Math.min(1.25, (steel[0]*0.3 + steel[1]*0.59 + steel[2]*0.11)/145));
    UNDER = [Math.round(176*lum), Math.round(146*lum), Math.round(104*lum)];
    PAN_UNDER = avg(P_.cx - P_.rx*0.35, P_.cy - P_.ry*0.3, P_.rx*0.7, P_.ry*0.6);
    PAL = buildPal();
    if(typeof palPan!=="undefined" && palPan.clear) palPan.clear();
  } catch(e) {}
}
function zone(name){
  if(frameOn){
    // Зоны рамы: прямоугольник картинки → координаты стола (через обратную проекцию углов).
    const W_ = FRAME.work, P_ = FRAME.pan;
    const box = name==="work"
      ? [frameX(W_.x), frameY(W_.y), frameX(W_.x+W_.w), frameY(W_.y+W_.h)]
      : [frameX(P_.cx-P_.rx), frameY(P_.cy-P_.ry), frameX(P_.cx+P_.rx), frameY(P_.cy+P_.ry)];
    const a = unproject(box[0], box[1]), b = unproject(box[2], box[3]);
    const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y), w = Math.abs(b.x-a.x), h = Math.abs(b.y-a.y);
    return { x, y, w, h, cx:x+w*0.5, cy:y+h*0.5 };
  }
  const work = name === "work", f = work ? WORK_FRAC : 1 - WORK_FRAC;
  // Вертикальные границы зон — по ВИДИМОЙ полосе стола, а не по числу cv.height.
  // Перспектива сжимает стол в TILT раз, поэтому координата y = cv.height приходится
  // примерно на 3/4 высоты кадра: считая зоны по cv.height, нижнюю четверть кадра
  // не занимал никто, и это была та самая «пустая треть поля» из замера 08.09.2026.
  const h0 = horizon();
  const top = h0 + (0 - h0)/TILT, bot = h0 + (cv.height - h0)/TILT;
  if(stackedLayout()){                     // портрет: тесто внизу, тава вверху
    // Отступ по бокам — только ТЕСТУ: на всю ширину кадра лист быть не должен, иначе
    // таве расти некуда. Таве ширина кадра отдана целиком (решение владельца 08.09.2026:
    // «в вертикальном таву можно расширить почти до границ экрана» — и тут же:
    // «чтобы место для готовки осталось, тоже нужно»). 4 % — та середина, где тава
    // встаёт в 20 px от края, а лист остаётся крупнее, чем был в альбоме.
    const inset = work ? cv.width * 0.04 : 0;
    let fWork = WORK_FRAC;
    if(stepNo===1 && !frameOn && !eveningOn()) fWork = 0.70;   // плющение: тесто — герой, тава ждёт сверху (в рамке вечера раскладка не прыгает)
    const f = work ? fWork : 1 - fWork;
    const h = (bot - top) * f, y = work ? bot - h : top;
    return { x:inset, y, w:cv.width - inset*2, h, cx:cv.width*0.5, cy:y + h*0.5 };
  }
  const w = cv.width * f, x = work ? 0 : cv.width - w;   // альбом: тесто слева, тава справа
  return { x, y:top, w, h:bot - top, cx:x + w*0.5, cy:(top + bot)*0.5 };
}

function layoutPan(){
  // Тава считается по СВОБОДНОМУ МЕСТУ В КАДРЕ, а не по доле зоны.
  //
  // Как было и почему это дефект (замер 08.09.2026, жалоба владельца «роти выходит за
  // границы тавы»). Пределов было два, и оба врали. `pz.h*0.49` сравнивал НЕСЖАТЫЙ
  // радиус с высотой зоны, хотя тава рисуется эллипсом, сплющенным в TILT = 0,56 раза, —
  // предел был строже нужного в 1,8 раза. Потом правый край срезал ещё 15 %, требуя,
  // чтобы в кадр влезла и ТЕНЬ (PAN_RIM = 1,16). В сумме `PAN_R ≤ 0,175·ширины`, тогда
  // как `targetR = 0,232·ширины`: роти оказывался шире тавы в 1,32 раза НА ЛЮБОМ экране,
  // хотя строка ниже просит обратного — таву в 1,25 раза шире роти.
  //
  // Как стало. Тава занимает место между кромкой теста и краем кадра. В кадр обязан
  // помещаться БОРТ (1,08), тень (1,16) может уходить за край — она тень. Сравнение
  // честное: полуширина роти НА ТАВЕ — это targetR, умноженный на перспективу, а не сам
  // targetR (лист рисуется поузловой проекцией, а тава — эллипсом от PAN_R без множителя).
  const pz = zone("pan"), wz = zone("work");
  const RIM = 1.08, pad = Math.min(cv.width, cv.height) * 0.02;
  const kAt = (ty)=> 1 + ((ty - horizon())/cv.height) * PERSP;
  let cxS, cyS;
  for(let pass = 0; pass < 2; pass++){                 // второй проход уточняет перспективу
    const rotiHalf = targetR * kAt(pass ? panC.y : pz.cy);
    if(stackedLayout()){
      const doughTop = prY(wz.cx, wz.cy - targetR);    // ближняя кромка теста снизу
      const room = (doughTop - pad*2) - pad;
      // Тава берёт всё, что даёт кадр: в портрете упор идёт в ШИРИНУ, и борт встаёт
      // в pad от края. Потолок 1,45 — чтобы на нестандартно вытянутом экране тава не
      // раздулась вокруг крошечного роти.
      PAN_R = Math.max(8, Math.min(rotiHalf*1.45, (cv.width*0.5 - pad)/RIM,
                                   room*0.5/(TILT*RIM)));
      cxS = cv.width*0.5;
      cyS = doughTop - pad*2 - PAN_R*TILT*RIM;
    } else {
      const doughRight = prX(wz.cx + targetR, wz.cy);  // кромка теста со стороны тавы
      const left = doughRight + pad*2, right = cv.width - pad;
      PAN_R = Math.max(8, Math.min(rotiHalf*1.25, (right - left)*0.5/RIM,
                                   (cv.height*0.5 - pad)/(TILT*RIM)));
      cxS = right - PAN_R*RIM;
      cyS = prY(0, pz.cy);
    }
    panC = unproject(cxS, cyS);
  }
  if(frameOn){                       // в раме тава уже нарисована — садимся ровно в неё
    const c = unproject(frameX(FRAME.pan.cx), frameY(FRAME.pan.cy));
    panC = c;
    PAN_R = frameX(FRAME.pan.rx) - frameX(0);
  }
}

// ─────────────────────────── проба конверта и нарезки (#20 / #53)
// После посадки замораживаем исходную сетку. Локальные полигоны хранят настоящий
// материал: разорванные ячейки отсутствуют, складка отражает материал и порядок
// слоёв. Это геометрический стенд, не симуляция самоконтакта или готовности блюда.
let dish = null, dishGesture = null;
// Рамка вечера (evening.js, шаг 1 v0) держит в стенде только два флага и вызовы eveningXxx() под
// typeof: без evening.js (проверки в Node, ?dev=1) стенд работает как раньше.
// sheetHidden — стол свободен, шарика на нём нет; fryHold — тава под крышкой, жарка стоит.
let sheetHidden = false, fryHold = false;
// panKnock — стук гостя (guest.js, шаг 2 v0): тава с листом вздрагивает на столько пикселей холста; 0 — стоит.
let panKnock = 0;
const eveningOn = ()=> typeof eveningActive==="function" && eveningActive();
// Жарка как действие (срез 17.09): прижим пальцем, купола и жир — модификаторы тепла по месту.
// Живут вне dish.thermal (его целиком сравнивают проверки) и вне dish (его снимки — история):
// panPress — точки прижима {x,y,level} в координатах блюда; domes — купола; fatMap — жир на
// таве в долях PAN_R. Пустые — жарка идёт прежним быстрым путём.
let panPress = [], domes = [], fatMap = null;
let contactRebuilds = 0;        // счётчик пересборок контакта (проверка: действия её не вызывают)
// Полёт при перевороте живёт вне dish: «заново» его сбрасывает, а снимки dish не меняются.
let dishFlight = null;
// Перелёт снятого блюда с тавы на стол: поза интерполируется от места на таве к столу.
let dishMove = null;
let dishBack = null;               // роти, отпущенный из руки над тавой, возвращается на место: {slide,t0}
// Поворот в процессе (предпросмотр): {input, angle, pivot, …}; запекается на отпускании (rotateDish).
let dishTwist = null;
const TWIST_HINT = "повернуть: два пальца, колесо или ⌥ + перетаскивание · раздвинуть: два пальца или ⌥ + колёсико";
const dishTouches = new Map();   // касания поля при блюде: id → точка стола (второй палец — поворот)
// Развести куски двумя пальцами и заглянуть в срезы (владелица 17.09: «два пальца развести, и
// кусочки разлетятся… а потом отпускаешь — обычный масштаб»). Щель живая, геометрию не трогает:
// на отпускании куски съезжаются обратно, резать и поворачивать можно и разведённым.
let dishPinch = null;            // идущее разведение: пальцы и базовое расстояние
let dishSpread = 1;              // во сколько раз щель шире обычной
const SPREAD_MAX = 6, SPREAD_GAIN = 1.8, SPREAD_BACK = 9;
let twistDbg = {gestures:0, cancels:0, last:"—"};   // что видел поворот на устройстве (строка отладки, лог)
const polyArea = p => Math.abs(p.reduce((s,a,i)=>{ const b=p[(i+1)%p.length]; return s+a.x*b.y-b.x*a.y; },0))/2;
function clipPoly(points, nx, ny, offset, positive=true){
  const out=[], sign=positive ? 1 : -1;
  for(let i=0;i<points.length;i++){
    const a=points[i], b=points[(i+1)%points.length];
    const da=sign*(a.x*nx+a.y*ny-offset), db=sign*(b.x*nx+b.y*ny-offset);
    if(da>=0) out.push(a);
    if((da>=0)!==(db>=0)){
      const t=da/(da-db); out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
    }
  }
  return out.length>=3 && polyArea(out)>1e-10 ? out : [];
}
function dishBounds(faces=dish.faces){
  const pts=faces.filter(f=>f.kind==="dough").flatMap(f=>f.points);
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
  return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
}
function dishPose(board){                // board — поза на доске, без лотка (доска не ездит)
  if(dish.mode==="fold") return {x:panC.x,y:panC.y,scale:targetR};
  const w=zone("work"), b=dishTwist ? twistBoundsCached() : dish.cutBounds;
  const cc=dishTwist ? {x:(b.left+b.right)/2,y:(b.top+b.bottom)/2} : dish.cutCenter;
  const perspective=1+((w.cy+w.h*.35-horizon())/cv.height)*PERSP;
  // Сборка 80: роти на столе мельче (×1,4 → ×1,25 от размера на таве; пределы 0,82 → 0,72 ширины зоны и
  // 0,70 → 0,60 высоты) — на 375×667 он был в полтора раза крупнее, чем на таве, и подходил к её борту
  // (плейтест 17.11, п. 19); теперь вокруг него помещается доска.
  const scale=Math.min(targetR*1.25,w.w*.72/(b.right-b.left)/perspective,w.h*.60/(b.bottom-b.top));
  if(dish.tray && dish.cutBounds && !board){
    // Нарезанный роти на лотке (сборка 85): мельче на TRAY_SCALE и правым краем лотка у правого края доски, на
    // высоте доски. У ближнего края слева лежит пёс (night.js, его зона отпускания), у дальнего — тава (отпущенный
    // там роти снова жарится) и граница «нижней трети», по которой пёс поднимает голову.
    // Сборка 85b: лоток лежит на доске целиком (живая проверка: правая половина висела за доской). Правый край
    // лотка — у правого края доски с полем TRAY_IN её ширины; не влезает по ширине или высоте — роти мельче.
    const T=trayRect(), B=boardRect(), m=TRAY_IN*(B.x1-B.x0), tw=T.right-T.left, th=T.bottom-T.top;
    const s=Math.min(scale*TRAY_SCALE,(B.x1-B.x0-2*m)/tw,(B.y1-B.y0-2*m)/th);
    const xr=B.x1-m;
    let y=w.cy-cc.y*s;
    const top=y+(T.top-dish.cutCenter.y+cc.y)*s, bot=y+(T.bottom-dish.cutCenter.y+cc.y)*s;
    if(bot>B.y1-m) y-=bot-(B.y1-m); else if(top<B.y0+m) y+=(B.y0+m)-top;
    return {x:xr-(T.right-dish.cutCenter.x+cc.x)*s, y, scale:s};
  }
  return {x:w.cx-cc.x*scale,y:w.cy-cc.y*scale,scale};
}
function dishLocal(p){
  const pose=dishPose(), q={x:(p.x-pose.x)/pose.scale,y:(p.y-pose.y)/pose.scale}, T=dishTwist;
  return T ? rotAbout(q,T.pivot,Math.cos(-T.angle),Math.sin(-T.angle)) : q;
}
function dishHull(){
  const pts=dish.faces.filter(f=>f.kind==="dough").flatMap(f=>f.points).slice().sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  function half(list){ const h=[]; for(const p of list){ while(h.length>1&&cross(h[h.length-2],h[h.length-1],p)<=0) h.pop(); h.push(p); } return h; }
  const a=half(pts), b=half(pts.slice().reverse()); a.pop(); b.pop(); return a.concat(b);
}
function materialTriangles(p){
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  // A crossed quad has two lobes, matching the original canvas fill. Splitting
  // at the crossing avoids manufacturing a triangle outside the drawn sheet.
  for(const [i,j,k,l] of [[0,1,2,3],[1,2,3,0]]){
    const a=p[i],b=p[j],c=p[k],d=p[l],den=(b.x-a.x)*(d.y-c.y)-(b.y-a.y)*(d.x-c.x);
    if(Math.abs(den)<1e-12) continue;
    const t=((c.x-a.x)*(d.y-c.y)-(c.y-a.y)*(d.x-c.x))/den;
    const u=((c.x-a.x)*(b.y-a.y)-(c.y-a.y)*(b.x-a.x))/den;
    if(t>0&&t<1&&u>0&&u<1){
      const q={x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)};
      return [[q,b,c],[q,d,a]];
    }
  }
  return cross(p[0],p[1],p[2])*cross(p[0],p[2],p[3])>=0
    ? [[p[0],p[1],p[2]],[p[0],p[2],p[3]]]
    : [[p[0],p[1],p[3]],[p[1],p[2],p[3]]];
}
function startDish(){
  if(dish) return; // раскладка начинки ровно одна на посадку
  panPress=[]; domes=[]; domeState={session:-1,left:0,next:0}; dishCrisp=0;   // жир на таве остаётся: он принадлежит сковороде
  const faces=[];
  rimDraw();   // грани блюда берут ту же сглаженную кромку, что и рисунок листа (сборка 74)
  for(let q=0;q<quads.length;q++){
    if(quadCons[q].some(c=>c.broken)) continue;
    const ids=quads[q], points=ids.map(i=>({x:(dX[i]-panC.x)/targetR,y:(dY[i]-panC.y)/targetR}));
    const tone=ids.reduce((s,i)=>s+thick[i],0)/4;
    // Внутренняя диагональ сохраняет вогнутые квады при выпуклом отсечении.
    for(const p of materialTriangles(points)){
      if(polyArea(p)>1e-10) faces.push({points:p,kind:"dough",source:q,tone,turned:false,m:CRUST_M0});
    }
  }
  dish={mode:"fold",faces,folds:0,cuts:[],history:[],filling:[],message:tip("banana","коснись середины — ляжет банан",tip("fold","веди от края к середине"))};
  if(!faces.length){ dish=null; return; }
  // Ломтики кладёт игрок (`addBananaSlice`): авто-пятно в середине убрано,
  // иначе жест «положить банан» не к чему было бы прикоснуться.
  // У материала две поверхности: 0 — та, что легла на таву при посадке, 1 — исходный
  // верх. Обе начинаются с нуля: startDish вызывается в момент посадки, и узловые
  // dry/cook к этому времени ещё не успели вырасти ни на одном пути.
  dish.thermal=quads.map((ids,q)=>quadCons[q].some(c=>c.broken) ? null : {
    dry:[0,0],cook:[0,0],
    tone:ids.reduce((s,i)=>s+thick[i],0)/4,contact:ids.reduce((s,i)=>s+contactF[i],0)/4
  });
  dish.flips=0; dish.panTime=0; dish.sessions=[{flip:0,start:0,gold:null}];
  dish.seed=crustSeedNow();   // узор пятен — от номера роти (сборка 86)
  fryStageNow = 0; fryJumpAt = 0;
  dish.holes=quadCons.filter(cs=>cs.some(c=>c.broken)).length;   // рваные ячейки листа при посадке
  rebuildDishContact(); dish.hull=dishHull(); dish.env=envelopeFrame(); syncDishUI();
}
// Heat belongs to material, not to a geometry snapshot. Undo never rewinds cooking.
function pointInFace(points,x,y){
  let sign=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],v=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);
    if(Math.abs(v)<1e-10) continue;
    if(sign && Math.sign(v)!==sign) return false;
    sign=Math.sign(v);
  }
  return true;
}
// ─── Толщина в миллиметрах и объём начинки (решение владелицы 16.09: всё влияет и на жарку,
// и на вид). Это 2.5D: слои и карта высоты, без объёмной физики (#34). Все числа INFERRED —
// миллиметров уличного роти в источниках нет; опора — «тонкий, почти прозрачный лист» и
// подброшенное тесто пиццы 0,12–0,18 мм (docs/simulation-references.md, §в).
const DOUGH_UNIT_MM = 14;     // толщина 1 (кусочек) ≈ 14 мм → лист у мишени (0,035) ≈ 0,5 мм
const SHEET_REF_MM = 0.5;     // при такой толщине сушка идёт с базовой скоростью
const FILL_MM = 3;            // толщина ломтика банана (с 17.09 порция — один ломтик; было 4 мм на горку)
const BANANA_MAX = 18;        // однослойное пятно, как уличное (~16 кружков)
// Начинка — один слой по одну сторону листа: у стопки одно место для неё (slot в складке и
// перевороте). Открытый лист, перевёрнутый с начинкой, держит её под собой, и новые куски легли бы
// сверху, на другую сторону, а следующая складка или переворот свалили бы их к старым, под лист
// (ревью сборки 61). Поэтому доложить можно, только пока начинки нет или она сверху: переверни
// лист обратно — и клади дальше.
function fillingUnderSheet(){
  if(!dish || !(dish.filling && dish.filling.length)) return false;
  const F=dish.faces; let top=F.length-1;
  while(top>=0 && F[top].kind!=="dough") top--;
  for(let i=0;i<top;i++) if(F[i].kind==="filling") return true;
  return false;
}
function canPlaceBanana(){
  return !!dish && dish.mode==="fold" && dish.folds===0 && !dishFlight && !dishMove && !fryHold && !fillingUnderSheet();
}
function _fillingOf(kind){
  return (dish.filling||[]).filter(f => (f.kind||"banana")===kind);
}
function addBananaSlice(x, y, opts){
  if(!canPlaceBanana()) return false;
  const bananas=_fillingOf("banana");
  if(bananas.length>=BANANA_MAX) return false;
  if(!onMaterial({x,y})) return false;
  const b=dishBounds(), span=Math.min(b.right-b.left,b.bottom-b.top);
  // Сборка 92 (партия «еда»): кучка (banana.js) кладёт кружки разного размера внахлёст — opts.k задаёт размер,
  // opts.heap разрешает нахлёст (центры не ближе 0,55 радиуса: кружок на кружке, а не стопка монет). Одиночный
  // ломтик — как был: свой размер и зазор.
  const slice=span*.05, rr=slice*(opts && opts.k>0 ? opts.k : .88+Math.random()*.22);
  const near=opts && opts.heap ? .55 : 1.35;
  for(const f of bananas){
    if(Math.hypot(f.x-x,f.y-y)<rr*near) return false;
  }
  const ring=Array.from({length:12},(_,j)=>({x:x+Math.cos(j*Math.PI/6)*rr,y:y+Math.sin(j*Math.PI/6)*rr}));
  const added=[];
  const id=dish.filling.length ? dish.filling[dish.filling.length-1].id+1 : 0;
  for(const face of dish.faces){
    if(face.kind!=="dough") continue;
    let p=face.points;
    for(let j=0;j<ring.length && p.length;j++){
      const a=ring[j], z=ring[(j+1)%ring.length], nx=-(z.y-a.y), ny=z.x-a.x;
      p=clipPoly(p,nx,ny,a.x*nx+a.y*ny);
    }
    if(p.length) added.push({points:p,kind:"filling",fill:"banana",source:id,tone:id%3,turned:false,pc:{x,y},pr:rr,ph:FILL_MM});
  }
  if(!added.length) return false;
  if(!(opts && opts.silent)) rememberDish();
  dish.faces = dish.faces.concat(added);
  dish.filling = dish.filling.concat([{id,x,y,radius:rr,kind:"banana"}]);
  rebuildDishContact();
  learn("banana");
  dish.message=tip("fold","веди от края к середине");
  if(!(opts && opts.silent)) syncDishUI();
  return true;
}
window.addBananaSlice = addBananaSlice;
window.canPlaceBanana = canPlaceBanana;
const EGG_MM = 1.6;
const EGG_MAX = 24;
function canPlaceEgg(){
  return !!dish && dish.mode==="fold" && dish.folds===0 && !dishFlight && !dishMove && !fryHold && !fillingUnderSheet();
}
function addEgg(x, y, opts){
  if(!canPlaceEgg()) return false;
  if(!onMaterial({x,y})) return false;
  const eggs=_fillingOf("egg");
  if(eggs.length>=EGG_MAX) return false;
  const b=dishBounds(), span=Math.min(b.right-b.left,b.bottom-b.top);
  const blob=span*.075, rr=blob*(.8+Math.random()*.35);
  for(const f of eggs){
    if(Math.hypot(f.x-x,f.y-y)<rr*.48) return false;
  }
  const id=dish.filling.length ? dish.filling[dish.filling.length-1].id+1 : 0;
  const ring=fillingRing({kind:"egg",id,x,y,radius:rr});
  const added=[];
  for(const face of dish.faces){
    if(face.kind!=="dough") continue;
    let p=face.points;
    for(let j=0;j<ring.length && p.length;j++){
      const a=ring[j], z=ring[(j+1)%ring.length], nx=-(z.y-a.y), ny=z.x-a.x;
      p=clipPoly(p,nx,ny,a.x*nx+a.y*ny);
    }
    if(p.length) added.push({points:p,kind:"filling",fill:"egg",source:id,tone:0,turned:false,pc:{x,y},pr:rr,ph:EGG_MM});
  }
  if(!added.length) return false;
  if(!(opts && opts.silent)) rememberDish();
  dish.faces = dish.faces.concat(added);
  dish.filling = dish.filling.concat([{id,x,y,radius:rr,kind:"egg"}]);
  rebuildDishContact();
  dish.message=eggs.length+1>=EGG_MAX
    ? "Яйцо на месте · заверни края внутрь"
    : "Яйцо · веди дальше или заверни края";
  if(!(opts && opts.silent)) syncDishUI();
  return true;
}
window.addEgg = addEgg;
window.canPlaceEgg = canPlaceEgg;
function fillingRing(t){
  // Сборка 92: лужица яйца — 24 точки и плавный овал (было 14 точек с рваным «колебанием»: обрезка по рёбрам
  // кольца всё равно выпуклая, и белок выходил гранёным многоугольником). Растекание неровное — от нахлёста лужиц.
  const n=t.kind==="egg"?24:12, ring=[];
  for(let j=0;j<n;j++){
    const a=j*2*Math.PI/n;
    const wob=t.kind==="egg" ? (0.86+0.14*(0.5+0.5*Math.sin(2*a+t.id*0.9))) : 1;
    ring.push({x:t.x+Math.cos(a)*t.radius*wob, y:t.y+Math.sin(a)*t.radius*wob});
  }
  return ring;
}
function stampTokenOnFaces(faces, token){
  const ring=fillingRing(token), added=[];
  const ph=token.kind==="egg"?EGG_MM:FILL_MM;
  const fill=token.kind==="egg"?"egg":"banana";
  for(const face of faces){
    if(face.kind!=="dough") continue;
    let p=face.points;
    for(let j=0;j<ring.length && p.length;j++){
      const a=ring[j], z=ring[(j+1)%ring.length], nx=-(z.y-a.y), ny=z.x-a.x;
      p=clipPoly(p,nx,ny,a.x*nx+a.y*ny);
    }
    if(p.length) added.push({points:p,kind:"filling",fill,source:token.id,tone:fill==="egg"?0:token.id%3,turned:false,
      pc:{x:token.x,y:token.y},pr:token.radius,ph});
  }
  return added;
}
function fillingDiskFace(t){
  const fill=t.kind==="egg"?"egg":"banana";
  return {points:fillingRing(t),kind:"filling",fill,source:t.id,tone:fill==="egg"?0:t.id%3,turned:false,
    pc:{x:t.x,y:t.y},pr:t.radius,ph:fill==="egg"?EGG_MM:FILL_MM};
}
// Лист, на который клали начинку, — грани, которые ни одна складка не поднимала (поднятым
// foldGeometry ставит flap). Начинка — один слой на листе, а не копия на каждом клапане.
function sheetFaces(faces){
  const dough=faces.filter(f=>f.kind==="dough"), sheet=dough.filter(f=>!f.flap);
  return sheet.length ? sheet : dough;
}
// slot — сколько граней теста лежит в стопке под начинкой: над листом и под клапанами, которые
// легли на неё позже (после переворота — наоборот). Без slot начинка ляжет поверх всего —
// так было в сборке 59, и конверт её не прятал.
function restampFillings(faces, tokens, slot){
  const dough=faces.filter(f=>f.kind==="dough");
  if(!tokens.length) return dough;
  const sheet=sheetFaces(dough), extra=[];
  for(const t of tokens) extra.push(...stampTokenOnFaces(sheet, t));
  const at=slot===undefined ? dough.length : Math.max(0,Math.min(dough.length,slot));
  return dough.slice(0,at).concat(extra,dough.slice(at));
}
function onDoughFaces(faces, p){
  return faces.some(f=>f.kind==="dough" && pointInFace(f.points,p.x,p.y));
}
function separateFillings(tokens){
  for(let k=0;k<3;k++){
    for(let i=0;i<tokens.length;i++) for(let j=i+1;j<tokens.length;j++){
      const a=tokens[i], b=tokens[j];
      const dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy), min=(a.radius+b.radius)*0.92;
      if(d>=min || d<1e-6) continue;
      const p=(min-d)*0.5, ux=dx/d, uy=dy/d;
      a.x-=ux*p; a.y-=uy*p; b.x+=ux*p; b.y+=uy*p;
    }
  }
}
function clampFillings(tokens, faces){
  const sheet=sheetFaces(faces), c=dishCentroid(sheet);   // кусок едет по листу, не по клапану
  for(const f of tokens){
    if(onDoughFaces(sheet, f)) continue;
    for(let i=0;i<8;i++){
      f.x+=(c.x-f.x)*0.4; f.y+=(c.y-f.y)*0.4;
      if(onDoughFaces(sheet, f)) break;
    }
  }
}
// Начинка — кусок НА листе, не наклейка. Складка теста его не режет: с stay-стороны лежит,
// с клапана съезжает на основание; резкий дёргань — дальше к середине. Кружки чуть расталкиваются.
function scootFillings(tokens, nx, ny, offset, yank){
  const out=tokens.map(t=>({...t}));
  if(!out.length) return out;
  const y=Math.max(0,Math.min(1,yank||0));
  for(const f of out){
    const d=f.x*nx+f.y*ny-offset;
    if(d<=-f.radius*0.2) continue;                 // целиком на основании
    const need=d+f.radius*0.85;
    const extra=y>0.55 ? (0.10+0.16*y) : (0.02+0.05*y);
    f.x-=nx*(need+extra); f.y-=ny*(need+extra);
    if(y>0.35){
      const s=(f.id%2?1:-1)*0.02*y;
      f.x+=-ny*s; f.y+=nx*s;
    }
  }
  separateFillings(out);
  return out;
}
function foldYank(g){
  if(!g) return 0.3;
  const v=velocityOf(g, performance.now());
  return Math.max(0, Math.min(1, (((v&&v.speed)||0)-180)/900));
}
const DOUGH_HEAT_MM = 1.05;   // тепло сквозь слой теста exp(−мм/1,05): лист 0,5 мм пропускает 0,62, как раньше
const FILL_HEAT_MM = 5;       // сквозь начинку exp(−мм/5), и ещё её тень: порция 4 мм пропускает 0,45 × 0,2
const COVER_MM = 1;           // тень начинки на слоях под ней 1/(1+мм/1): 4 мм дают ×0,2 (спецификация §1: ×0,15…0,25)
const doughMM = tone => tone*DOUGH_UNIT_MM;
// Высота начинки в точке: плато с узким мягким краем (ломтик — плоский кружок). Порция помнит свой
// центр в текущих координатах (pc) — складка и переворот переносят его вместе с гранью.
function fillHeight(f,p){
  const H = f.ph ?? FILL_MM*0.8;
  if(!f.pc || !(f.pr>0)) return H;
  const edge = 1 - Math.hypot(p.x-f.pc.x,p.y-f.pc.y)/f.pr;
  return H*Math.sqrt(Math.max(0.15,Math.min(1,edge/0.15)));
}
function layerMM(f,p){ return f.kind==="filling" ? fillHeight(f,p) : doughMM(f.tone); }
const fillPass = mm => Math.exp(-mm/FILL_HEAT_MM)/(1+mm/COVER_MM);
// Сборка 85b: кучка (12 кружков) и яйцо поверх неё не делают жарку дольше. Начинка в тепловой модели
// ослабляется так, чтобы её объём (площадь × высота) действовал не сильнее FILL_FRY_SLICES ломтиков: на роти
// с 1–3 ломтиками всё как было (k=1), на кучке тень и задержка тепла каждой порции ×k. Жарка и так долгая
// (плейтест, п. 1), и окно времени жарки настраивалось на одном ломтике. Видимая высота начинки не меняется.
const FILL_FRY_SLICES = 3;
function fillFryK(){
  const F=dish && dish.filling; if(!F || !F.length) return 1;
  let vol=0, ref=0;
  for(const f of F){
    const egg=f.kind==="egg", r=f.radius||0;
    vol+=Math.PI*r*r*(egg ? EGG_MM : FILL_MM);
    ref+=egg ? r/1.5 : r;                 // яйцо: лужица 0,075 пролёта против ломтика 0,05 (addEgg/addBananaSlice)
  }
  ref/=F.length;
  const cap=FILL_FRY_SLICES*Math.PI*ref*ref*FILL_MM;
  return vol>cap ? cap/vol : 1;
}
// Сушка верхней, открытой стороны: пар от нагретого низа уходит сквозь лист.
// INFERRED — источника на долю нет. Закрытая сверху сторона (под клапаном или под
// начинкой) не сохнет вовсе: там пар заперт, а начинка — водяной резервуар
// (docs/frying-mechanics.md §1, «cover»).
const UP_DRY = 0.35;
// Цвет растёт только у стороны, прижатой прямо к стали. Условие цвета — поверхность
// >120 °C при a_w<0,6 (frying-mechanics.md §1 п. 3); закрытые поверхности между
// слоями его не достигают — это вывод из условия, а не цитата (INFERRED).
// Поле контакта `contact` у обеих сторон одно — принадлежит материалу (упрощение).
function rebuildDishContact(){
  if(!dish || !dish.thermal) return;
  const b=dishBounds(), size=48, dx=(b.right-b.left)/size,dy=(b.bottom-b.top)/size;
  const cells=Array.from({length:size*size},()=>[]);
  const boxes=[];
  for(const f of dish.faces){
    const xs=f.points.map(p=>p.x),ys=f.points.map(p=>p.y);
    boxes.push([Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)]);
    const x0=Math.max(0,Math.floor((Math.min(...xs)-b.left)/dx)),x1=Math.min(size-1,Math.floor((Math.max(...xs)-b.left)/dx));
    const y0=Math.max(0,Math.floor((Math.min(...ys)-b.top)/dy)),y1=Math.min(size-1,Math.floor((Math.max(...ys)-b.top)/dy));
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
      if(!pointInFace(f.points,b.left+(x+.5)*dx,b.top+(y+.5)*dy)) continue;
      const cell=cells[y*size+x];
      // Shared mesh diagonals must not count as an extra physical layer.
      if(!cell.some(a=>a.kind===f.kind && a.source===f.source && a.turned===f.turned)) cell.push(f);
    }
  }
  contactRebuilds++;
  const n=dish.thermal.length, pair=()=>Array.from({length:n},()=>[0,0]);
  const dryD=pair(), cookD=pair(), contactW=pair(), topW=pair(), count=new Float64Array(n);
  // Таблица образцов — тот же расчёт по месту, чтобы прижим, купола и жир меняли тепло в
  // точке без пересборки сетки (heatSamples). Порядок записей — порядок сложения ниже.
  const rows=[];
  // Один образец слоя: нижняя сторона получает тепло, прошедшее сквозь всё, что ниже;
  // открытая верхняя — долю UP_DRY на сушку; цвет — только прямой контакт со сталью.
  const deposit=(f,heat,tr,top,weight,pt,covered)=>{
    const t=dish.thermal[f.source]; if(!t) return;
    const s=f.source, down=f.turned ? 1 : 0, up=1-down, h=heat*t.contact*weight;
    const steel=tr===1 && heat>0;
    count[s]+=weight;
    dryD[s][down]+=h*tr;
    if(top){ dryD[s][up]+=UP_DRY*h*tr; topW[s][up]+=weight; }
    if(steel){ cookD[s][down]+=h; contactW[s][down]+=weight; }
    rows.push(s,down,(top?1:0)|(steel?2:0)|(covered?4:0),h,tr,pt.x,pt.y);
  };
  // Для крошечного фрагмента: та же стопка, но тепло кладётся только ему самому (индекс own).
  const fk=fillFryK(), heatMM=(f,pt)=>f.kind==="filling" ? fillHeight(f,pt)*fk : doughMM(f.tone);
  const stackHeatAt=(stack,own,pt,heat,weight)=>{
    const hs=stack.map(f=>heatMM(f,pt));
    let transmission=1, fillAbove=0;
    for(let k=own+1;k<stack.length;k++) if(stack[k].kind==="filling") fillAbove+=hs[k];
    for(let k=0;k<own;k++) transmission*=stack[k].kind==="dough" ? Math.exp(-hs[k]/DOUGH_HEAT_MM) : fillPass(hs[k]);
    deposit(stack[own],heat/(1+fillAbove/COVER_MM),transmission,own===stack.length-1,weight,pt,fillAbove>0);
  };
  // Стопка в точке, снизу вверх: слой теста пропускает exp(−мм/DOUGH_HEAT_MM), начинка —
  // exp(−мм/FILL_HEAT_MM)·тень; на всё, что лежит под начинкой, ложится её тень 1/(1+мм/COVER_MM).
  // Тень входит и в поток вверх: клапан получает тепло сквозь охлаждённую начинкой базу,
  // поэтому ему не может достаться больше, чем слою под начинкой.
  const stackHeat=(stack,pt,heat,weight)=>{
    const hs=stack.map(f=>heatMM(f,pt));
    let above=0; const fillAbove=new Array(stack.length);
    for(let k=stack.length-1;k>=0;k--){ fillAbove[k]=above; if(stack[k].kind==="filling") above+=hs[k]; }
    let transmission=1;
    for(let k=0;k<stack.length;k++){
      const f=stack[k];
      if(f.kind==="dough"){
        deposit(f,heat/(1+fillAbove[k]/COVER_MM),transmission,k===stack.length-1,weight,pt,fillAbove[k]>0);
        transmission*=Math.exp(-hs[k]/DOUGH_HEAT_MM);
      } else transmission*=fillPass(hs[k]);   // влажная начинка задерживает тепло к клапану
    }
  };
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const cell=cells[y*size+x];
    const pt={x:b.left+(x+.5)*dx,y:b.top+(y+.5)*dy}, r=Math.hypot(pt.x,pt.y)*targetR/PAN_R;
    stackHeat(cell,pt,r<=1 ? panHeat(r)*1.05 : 0,1);
  }
  // Tiny intact fragments may fit between all grid centres. Sample their own
  // interior instead of leaving a permanently raw island inside the hot pan.
  const missed=Array.from(count,v=>v===0);
  const pad=1e-7, inBox=(j,p)=>{const box=boxes[j];
    return !(p.x<box[0]-pad||p.x>box[1]+pad||p.y<box[2]-pad||p.y>box[3]+pad);};
  for(let i=0;i<dish.faces.length;i++){
    const f=dish.faces[i],t=dish.thermal[f.source];
    if(f.kind!=="dough" || !t || !missed[f.source]) continue;
    const p=f.points.reduce((s,p)=>({x:s.x+p.x/f.points.length,y:s.y+p.y/f.points.length}),{x:0,y:0});
    // Та же стопка, что в ячейке, но собранная для собственной точки фрагмента.
    const below=[],above=[],seen=new Set();
    for(let j=0;j<dish.faces.length;j++){
      if(j===i || !inBox(j,p)) continue;
      // Рамка отсекает почти все грани до точного теста: без неё открытый лист
      // тратил здесь десятки тысяч вызовов pointInFace на одну пересборку.
      const g=dish.faces[j],key=g.kind+":"+g.source+":"+g.turned;
      if(j<i && seen.has(key)) continue;
      if(!pointInFace(g.points,p.x,p.y)) continue;
      if(j<i){ seen.add(key); below.push(g); } else above.push(g);
    }
    const r=Math.hypot(p.x,p.y)*targetR/PAN_R;
    stackHeatAt(below.concat([f],above),below.length,p,r<=1 ? panHeat(r)*1.05 : 0,polyArea(f.points)/(dx*dy));
  }
  const avg=(v,s)=>count[s] ? [v[0]/count[s],v[1]/count[s]] : [0,0];
  dish.dryDrive=dryD.map(avg);
  dish.cookDrive=cookD.map(avg);
  dish.contactWeights=contactW;   // [s][сторона]: сколько образцов стороны лежит на стали
  dish.topWeights=topW;           // [s][сторона]: сколько образцов стороны открыто сверху
  // Не перечисляемое: снимки и сравнения dish его не видят.
  const m=rows.length/7, table={n:m,count,src:new Int32Array(m),side:new Uint8Array(m),flags:new Uint8Array(m),
    h:new Float64Array(m),tr:new Float64Array(m),x:new Float64Array(m),y:new Float64Array(m)};
  for(let i=0,k=0;i<m;i++,k+=7){
    table.src[i]=rows[k]; table.side[i]=rows[k+1]; table.flags[i]=rows[k+2];
    table.h[i]=rows[k+3]; table.tr[i]=rows[k+4]; table.x[i]=rows[k+5]; table.y[i]=rows[k+6];
  }
  Object.defineProperty(dish,"heatTable",{value:table,writable:true,configurable:true,enumerable:false});
}
// Модификаторы тепла по месту: множитель на каждый образец (1 — без изменений). Пока пусто.
let FORCE_HEAT_TABLE = false;   // отладка: считать через таблицу и без модификаторов
function panModsActive(){ return FORCE_HEAT_TABLE || panPress.length>0 || domes.length>0 || !!fatMap; }
function sampleMultiplier(T,i){
  for(const d of domes) if(Math.hypot(T.x[i]-d.x,T.y[i]-d.y)<d.r) return 0;   // под куполом стали нет
  let m=1;
  if(fatMap) m*=oilMul(fatAt(T.x[i]*targetR/PAN_R,T.y[i]*targetR/PAN_R));
  // Прижимы в одном месте не складываются: берётся самый сильный (ревью 17.09 — частые тапы
  // перемножались до ×7 при заявленных ×(1 + сила)).
  let press=0;
  for(const p of panPress){
    if(!(p.level>0)) continue;
    const d=Math.hypot(T.x[i]-p.x,T.y[i]-p.y); if(d>=PRESS_R) continue;
    const soft=d<=PRESS_R*.6 ? 1 : 1-(d-PRESS_R*.6)/(PRESS_R*.4);
    press=Math.max(press,p.level*soft);
  }
  return press>0 ? m*(1+PRESS_GAIN*press) : m;
}
// ─── Прижим пальцем (владелица 07.09: «удержание пальца = прижим, и больше ничего: дольше держишь —
// сильнее»). Здесь «сильнее» — это накопление тепла под пальцем: стопка прижата к стали, жар
// проходит лучше (inferred). У кромки палец становится прижимом только после паузы — привычка
// «миг подержи — махни» остаётся переворотом (разбор 16.09); в середине листа — сразу.
// Цена прижима (#60) не решена: сейчас это занятый палец и местный пережог, который не мусор.
const PRESS_EDGE_HOLD_MS = 450;          // у кромки: столько неподвижности до прижима
const PRESS_R = 0.18;                    // радиус пятна в долях роти (inferred)
const PRESS_RISE = 0.5, PRESS_DECAY = 1.5;   // с: нарастание при удержании и спад после (inferred)
const PINCH_WINDOW_MS = 250;             // резерв щипков (#19): быстрый сдвиг до схватывания — не след прижима
let PRESS_GAIN = 1.0;                    // прибор «прижим»: во сколько раз больше жара под пальцем при полном прижиме
let pressWet = 0;                        // сколько воды под прижатыми пальцами (для звука)
function releasePress(g){ if(g && g.press) g.press.held=false; }
// Новое касание рядом с гаснущим прижимом подхватывает его уровень: тап за тапом — это один прижим.
function adoptPress(at){
  let best=null;
  for(const p of panPress) if(!p.held && Math.hypot(p.x-at.x,p.y-at.y)<PRESS_R && (!best || p.level>best.level)) best=p;
  const press={x:at.x,y:at.y,level:best ? best.level : 0,held:true,since:performance.now()};
  if(best) panPress.splice(panPress.indexOf(best),1);
  panPress.push(press);
  return press;
}
function updatePanPress(dt){
  const g=dishGesture;
  if(g && g.zone==="edge" && !g.press && !g.moved && g.onMat && performance.now()-g.t0>=PRESS_EDGE_HOLD_MS){
    g.press=adoptPress(g.start); g.latched=true;
    if(cornerLift) g.press.lift=true;          // сборка 95: этим пальцем поднят угол — пятна прижима не рисуем (drawPressDents)
  }
  for(const p of panPress) p.level=p.held ? Math.min(1,p.level+dt/PRESS_RISE) : p.level*Math.exp(-dt/PRESS_DECAY);
  if(panPress.some(p=>!p.held && p.level<=.01)) panPress=panPress.filter(p=>p.held || p.level>.01);
  // Вода под пальцем: среднее (1 − сухость) сторон на стали в пятне прижима.
  pressWet=0;
  const held=panPress.filter(p=>p.held), T=dish.heatTable;
  if(held.length && T){
    let wet=0,n=0;
    for(let i=0;i<T.n;i++){
      if(!(T.flags[i]&2)) continue;
      if(!held.some(p=>Math.hypot(T.x[i]-p.x,T.y[i]-p.y)<PRESS_R)) continue;
      const t=dish.thermal[T.src[i]]; if(!t) continue;
      wet+=1-t.dry[T.side[i]]; n++;
    }
    pressWet=n ? wet/n : 0;
  }
}
// Палец на тесте — с допуском r: у кромки палец часто чуть за ступенчатым краем листа.
// ─── Маргарин. Кусок у дальнего борта; жест от куска мажет открытую сталь. На горячей
// таве это не след-краска: вспышка глянца и шипение, плёнка сходит за секунду
// (владелица 20.09: жёлтая полоса не должна оставаться и медленно таять).
// Под листом — короткий +10 % жара, пока плёнка ещё есть.
// Сборка 78 (плейтест 17.11: «маргарин выглядит как инструмент, но не работает»): мазок оставляет
// блестящую лужицу, она расходится (FAT_SPREAD) и сходит за несколько секунд (FAT_TAU 0,55 → 2,6 с;
// это по-прежнему глянец, не жёлтая краска). Растекаясь, жир заходит под край роти — там он шипит
// пузырьками (drawFatFizz) и растит хруст: CRISP_GAIN подобран так, что 2–3 мазка вдоль края дают
// хруст 5 (замер — MECHANICS «Жарка, сборка 78»). Кусок убывает с каждым мазком (butterLeft).
const FAT_N = 32, FAT_GAIN = 0.10/1.05, FAT_TAU = 2.6, FAT_BRUSH = .07, FAT_SEEP = .06;
const FAT_SPREAD = 1.1;                  // растекание: клеток² в секунду
// Хруст считается по ТОМУ, ЧТО ВИДНО (ревью партии «жарка», 17.11): по доле кромки роти, вдоль которой шипят
// пузырьки (edgeFat — те же точки и тот же порог FIZZ_MIN, что у drawFatFizz). Прежний счёт — средний жир под
// всем низом, умноженный на сухость, — зависел от того, насколько близко к краю лёг мазок (0,7…2,3 за мазок) и
// резал ранние мазки, хотя пузырьки рисовались те же. CRISP_GAIN — хруст в секунду при шипении по всей кромке.
let CRISP_GAIN = 3.6;
const FIZZ_MIN = 0.06, FIZZ_STEP = 0.035, FIZZ_OUT = 0.04;   // порог жира у кромки; шаг точек вдоль кромки; проба чуть снаружи
const BUTTER_MIN = 0.3, BUTTER_PER_STAMP = 0.0016;  // мазок вдоль стороны роти снимает с куска 8–11 % (сборка 92; было 5–7 % — убыль не читалась на кадрах)
// Доля куска: 1 — целый. Кусок бесконечный (ресурсом он не стал): дотаял до BUTTER_MIN — после мазка рядом кладут
// новый (butterRenew), без строки и звука. Сборка 92: раньше огрызок BUTTER_MIN так и лежал до конца вечера.
let butterLeft = 1;
// Сборка 95 (ревью 18.11, п. 4): кусок находится сам — касание оставляет на нём выемку от пальца (butterDents,
// доли длины и ширины куска на его верхней грани, последние BUTTER_DENTS) и отщипывает BUTTER_PER_TOUCH: брусок
// мнётся и тает к концу вечера и без мазков. Новый кусок (butterRenew, новый вечер) — целый, без выемок.
const BUTTER_PER_TOUCH = 0.025, BUTTER_DENTS = 7;
let butterDents = [];
function butterRenew(){ if(butterLeft<=BUTTER_MIN+1e-9){ butterLeft=1; butterDents=[]; } }
// Касание куска (клиентские px): где на верхней грани — перебором сетки по нарисованному бруску (сейчашнего размера).
function butterTouch(client){
  if(client && typeof cv!=="undefined" && cv.getBoundingClientRect){
    const r=cv.getBoundingClientRect(), k=cv.width/(r.width||1), c={x:(client.x-r.left)*k,y:(client.y-r.top)*k};
    const b=butterSpot(), tx=-Math.sin(b.a), ty=Math.cos(b.a), nx=Math.cos(b.a), ny=Math.sin(b.a);
    const left=Math.sqrt(butterLeft), L=PAN_R*.09*left, W=PAN_R*.06*left, H=PAN_R*.035*TILT*butterLeft;
    let best=null, bd=Infinity;
    for(let i=-6;i<=6;i++) for(let j=-6;j<=6;j++){
      const u=i/6*.75, v=j/6*.7, X=b.x+tx*u*L+nx*v*W, Y=b.y+ty*u*L+ny*v*W, d=Math.hypot(prX(X,Y)-c.x,prY(X,Y)-H-c.y);
      if(d<bd){ bd=d; best={u,v}; }
    }
    if(best){ butterDents.push(best); if(butterDents.length>BUTTER_DENTS) butterDents.shift(); }
  }
  butterLeft=Math.max(BUTTER_MIN,butterLeft-BUTTER_PER_TOUCH);
}
let fatGesture = null, fatUnder = 0, dishCrisp = 0, smearSoundAt = 0;
let fatCanvas = null, fatCtx = null, fatDrawnAt = 0, fatDirty = false;
function butterSpot(){
  // дальний от стола борт: в портрете — вверх-вправо, в альбоме — вправо. В раме экрана правый
  // край тавы обрезан картинкой, и кусочек уезжал за экран (владелица 17.09: «мы же маслице
  // возвращали») — там он лежит на дальнем левом борту, всегда в кадре.
  const a = frameOn ? -140*Math.PI/180 : stackedLayout() ? -35*Math.PI/180 : 20*Math.PI/180;
  const r = frameOn ? .78 : .93;   // в раме борт нарисован картинкой — кусочек кладём чуть глубже внутрь
  return {x:panC.x+Math.cos(a)*PAN_R*r, y:panC.y+Math.sin(a)*PAN_R*r, a};
}
// Кусок берётся по нарисованному контуру (основание и верхняя грань) с запасом 6 CSS px, но не
// сквозь тесто: если лист лежит на куске, касание — листу (ревью 17.09).
function butterPolys(){
  const b=butterSpot(), tx=-Math.sin(b.a), ty=Math.cos(b.a), nx=Math.cos(b.a), ny=Math.sin(b.a);
  const L=PAN_R*.09, W=PAN_R*.06, H=PAN_R*.035*TILT;
  const P=(u,v)=>({x:prX(b.x+tx*u+nx*v,b.y+ty*u+ny*v),y:prY(b.x+tx*u+nx*v,b.y+ty*u+ny*v)});
  const base=[P(-L,-W),P(L,-W),P(L,W),P(-L,W)];
  return {base,top:base.map(q=>({x:q.x,y:q.y-H}))};
}
function onButter(p,client){
  let hit;
  if(client){
    const r=cv.getBoundingClientRect(), k=cv.width/(r.width||1);
    const c={x:(client.x-r.left)*k,y:(client.y-r.top)*k}, slop=6*k;
    const near=poly=>pointInFace(poly,c.x,c.y) || poly.some((a,i)=>{const z=poly[(i+1)%poly.length],dx=z.x-a.x,dy=z.y-a.y,
      t=Math.max(0,Math.min(1,((c.x-a.x)*dx+(c.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(a.x+dx*t-c.x,a.y+dy*t-c.y)<=slop;});
    const P=butterPolys(); hit=near(P.base)||near(P.top)||near([P.base[0],P.base[1],P.top[1],P.top[0]])||near([P.base[3],P.base[2],P.top[2],P.top[3]]);
  } else { const b=butterSpot(); hit=Math.hypot(p.x-b.x,p.y-b.y)<=PAN_R*.11; }
  // Сборка 78: штрих, начатый на куске, — всегда маргарин, даже если под пальцем край листа: раньше
  // касание отдавалось листу, и мазок от куска становился складкой (плейтест 17.11). Кусок рисуется
  // поверх листа (drawButterBlock), так что берётся то, что видно.
  return hit;
}
function butterFree(){
  if(typeof EVE==="undefined" || eveDev) return true;
  const sheet=typeof document!=="undefined" && document.getElementById("radioSheet");
  return !!EVE.lamp && !EVE.lid && !EVE.over && !(sheet && sheet.hidden===false);
}
function oilMul(f){
  if(!(f>0)) return 0.90;                         // сухая сталь
  if(f < 0.50) return 1.00 + 0.18*f;              // плёнка +5…9 %
  return 1.09 - 0.40*(f-0.50);                    // лужа теплоизолирует
}
function fatAt(u,v){
  if(!fatMap) return 0;
  const i=Math.floor((u+1)/2*FAT_N), j=Math.floor((v+1)/2*FAT_N);
  return i<0||j<0||i>=FAT_N||j>=FAT_N ? 0 : fatMap[j*FAT_N+i];
}
function insideMaterial(p,r){
  const pts=[p,{x:p.x+r,y:p.y},{x:p.x-r,y:p.y},{x:p.x,y:p.y+r},{x:p.x,y:p.y-r}];
  return pts.every(q=>dish.faces.some(f=>f.kind==="dough" && pointInFace(f.points,q.x,q.y)));
}
// Мазок в точке стола: жир ложится на сталь, кроме места глубоко под листом.
function smearAt(q){
  const u=(q.x-panC.x)/PAN_R, v=(q.y-panC.y)/PAN_R;
  if(Math.hypot(u,v)>1) return false;
  if(dish && dish.mode==="fold" && !dishMove && !dishFlight){
    const d=dishLocal(q);
    if(insideMaterial(d,FAT_SEEP)) return false;
  }
  if(!fatMap) fatMap=new Float32Array(FAT_N*FAT_N);
  const cell=2/FAT_N, rr=FAT_BRUSH;
  for(let j=Math.max(0,Math.floor((v-rr+1)/cell));j<=Math.min(FAT_N-1,Math.floor((v+rr+1)/cell));j++)
    for(let i=Math.max(0,Math.floor((u-rr+1)/cell));i<=Math.min(FAT_N-1,Math.floor((u+rr+1)/cell));i++){
      const cu=-1+(i+.5)*cell, cv2=-1+(j+.5)*cell, d=Math.hypot(cu-u,cv2-v);
      if(d>rr || Math.hypot(cu,cv2)>1) continue;
      const k=j*FAT_N+i; fatMap[k]=Math.min(1,fatMap[k]+.22*(1-d/rr));
    }
  fatDirty=true;
  butterLeft=Math.max(BUTTER_MIN,butterLeft-BUTTER_PER_STAMP);
  return true;
}
// След пальца (сборка 92, ревью сборки 89 п. 5: «блики читаются как пузыри воды или стеклянные капли, а не как
// жир»). Там, где прошёл палец, на стали лежит плоский глянцевый развод: широкая мокрая полоса с бликом вдоль, она
// тускнеет вместе с лужицей (FAT_TAU) и чуть расходится. Только картинка: жар, хруст и шипение по-прежнему
// считает fatMap. Точки — координаты стола; {gap:true} — палец прошёл под роти (там жир не лёг).
const FAT_STREAK_MAX = 400;
let fatStreak = [], fatStreakEnd = null;
function smearStreakPush(q,wrote){
  const now=performance.now(), last=fatStreak[fatStreak.length-1];
  if(!wrote){ if(last && !last.gap) fatStreak.push({gap:true}); return; }
  fatStreak.push({x:q.x,y:q.y,t:now});
  if(fatStreak.length>FAT_STREAK_MAX) fatStreak.splice(0,fatStreak.length-FAT_STREAK_MAX);
}
function smearStroke(a,b){
  const len=Math.hypot(b.x-a.x,b.y-a.y), n=Math.max(1,Math.ceil(len/(PAN_R*.03)));
  let wrote=false;
  // новый мазок (палец не продолжает прежний) — разрыв в следе
  if(fatStreakEnd!==a && fatStreak.length && !fatStreak[fatStreak.length-1].gap) fatStreak.push({gap:true});
  fatStreakEnd=b;
  for(let k=1;k<=n;k++){
    const q={x:a.x+(b.x-a.x)*k/n,y:a.y+(b.y-a.y)*k/n}, w=smearAt(q);
    smearStreakPush(q,w); wrote=w||wrote;
  }
  if(wrote && performance.now()-smearSoundAt>120){ smearSoundAt=performance.now(); audioSmear(); }
}
let fatTmp = null;
function updateFat(dt){
  fatUnder=0;
  if(typeof EVE!=="undefined" && !EVE.lamp && !EVE.over){ butterLeft=1; butterDents=[]; learnReset(); }   // новый вечер — новый кусок, и жесты подсказываются заново
  if(!fatMap) return;
  // Лужица расходится: шаг диффузии по четырём соседям, за борт плиты жир не уходит.
  const N=FAT_N, kd=Math.min(.2,FAT_SPREAD*dt);
  if(!fatTmp) fatTmp=new Float32Array(N*N);
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    const q=j*N+i, cu=-1+(i+.5)*2/N, cw=-1+(j+.5)*2/N;
    if(cu*cu+cw*cw>1){ fatTmp[q]=0; continue; }
    const f=fatMap[q], l=i>0 ? fatMap[q-1] : f, r=i<N-1 ? fatMap[q+1] : f, u=j>0 ? fatMap[q-N] : f, d=j<N-1 ? fatMap[q+N] : f;
    fatTmp[q]=f+kd*(l+r+u+d-4*f);
  }
  let max=0; const k=Math.exp(-dt/FAT_TAU);
  for(let i=0;i<fatMap.length;i++){ fatMap[i]=fatTmp[i]*k; if(fatMap[i]>max) max=fatMap[i]; }
  fatDirty=true;
  if(max<.02){ fatMap=null; fatUnder=0; fatStreak=[]; return; }
  // Хруст растёт, только пока роти жарится на таве (не в полёте, не под крышкой, не в руке).
  if(!dish || dish.mode!=="fold" || phase!=="PAN" || dishFlight || fryHold || (dishGesture && dishGesture.slide)) return;
  fatUnder=edgeFat();
  dishCrisp+=dt*CRISP_GAIN*fatUnder;
}
// Жир в точке кромки роти (координаты блюда): у самой кромки или чуть снаружи — лужица подходит к краю снаружи.
function fatAtEdge(x,y,c){
  const k=targetR/PAN_R, dl=Math.hypot(x-c.x,y-c.y)||1, ox=x+(x-c.x)/dl*FIZZ_OUT, oy=y+(y-c.y)/dl*FIZZ_OUT;
  return Math.max(fatAt(x*k,y*k),fatAt(ox*k,oy*k));
}
function hullCentre(H){ return H.reduce((s,q)=>({x:s.x+q.x/H.length,y:s.y+q.y/H.length}),{x:0,y:0}); }
// Доля кромки, под которой сейчас шипит жир (0…1).
function edgeFat(){
  const H=dish && dish.hull; if(!fatMap || !H || H.length<3) return 0;
  const c=hullCentre(H); let on=0,all=0;
  for(let i=0;i<H.length;i++){
    const a=H[i], b=H[(i+1)%H.length], n=Math.max(1,Math.round(Math.hypot(b.x-a.x,b.y-a.y)/FIZZ_STEP));
    for(let k=0;k<n;k++){ const u=(k+.5)/n; all++; if(fatAtEdge(a.x+(b.x-a.x)*u,a.y+(b.y-a.y)*u,c)>=FIZZ_MIN) on++; }
  }
  return all ? on/all : 0;
}
function crispWord(c){ return c<1.5 ? "мягкий" : c<5 ? "хрустит" : "сильно хрустит"; }

// ─── Пузыри-купола (спецификация §2, решение 25.08: пузыри прижимаются). Пар отрывает целый
// участок нижнего слоя от стали, пока его сторона сохнет; под куполом стали нет — пятно остаётся
// бледным (измерено у оладий: Sanz-Serrano 2017). Место — случайное на целом голом тесте: «купол на
// тонком» источниками не подтверждён, а дырки выпускают пар (разбор источников 17.09,
// runs/continuation/notes/bubbles-research.json). Купол временный: пар уходит, и он опадает сам
// через 2–4 с после роста — или раньше, если вокруг досохло (дизайн-док: «на сухом»). Лопается от
// прижима, от складки, переворота и снятия. Не под начинкой и не у края. Числа — inferred.
let DOMES = true;                         // выключатель для старых проверок модели
const DOME_COUNT = [3,5], DOME_R = [.06,.14], DOME_GROW_S = 3, DOME_SELF_POP_S = 2, DOME_HOLD_S = [2,4];
let domeState = {session:-1, left:0, next:0};
function domeRingDry(d){
  const T=dish.heatTable; let s=0,n=0;
  for(let i=0;i<T.n;i++){
    if(!(T.flags[i]&2)) continue;
    const r=Math.hypot(T.x[i]-d.x,T.y[i]-d.y); if(r<d.r || r>d.r*1.3+.02) continue;
    const t=dish.thermal[T.src[i]]; if(t){ s+=t.dry[T.side[i]]; n++; }
  }
  return n ? s/n : 1;
}
function spawnDome(){
  const T=dish.heatTable;
  for(let k=0;k<30;k++){
    const i=Math.floor(Math.random()*T.n);
    if((T.flags[i]&6)!==2) continue;
    const t=dish.thermal[T.src[i]]; if(!t || t.dry[T.side[i]]>=.95) continue;
    const r=DOME_R[0]+(DOME_R[1]-DOME_R[0])*Math.random(), c={x:T.x[i],y:T.y[i]};
    if(domes.some(d=>Math.hypot(d.x-c.x,d.y-c.y)<d.rMax+r+.02)) continue;
    if(panPress.some(p=>Math.hypot(p.x-c.x,p.y-c.y)<PRESS_R+r)) continue;
    // не рядом с начинкой: купол поднимает голое тесто
    if(dish.faces.some(f=>f.kind==="filling" && f.points.some(q=>Math.hypot(q.x-c.x,q.y-c.y)<r+.05))) continue;
    let ok=true;
    for(let j=0;j<8 && ok;j++){ const a=j*Math.PI/4; ok=onMaterial({x:c.x+Math.cos(a)*(r+.05),y:c.y+Math.sin(a)*(r+.05)}); }
    if(!ok) continue;
    domes.push({x:c.x,y:c.y,rMax:r,r:r*.35,grow:0,dryFor:0,hold:DOME_HOLD_S[0]+Math.random()*(DOME_HOLD_S[1]-DOME_HOLD_S[0])});
    audioDomeGrow();
    return true;
  }
  return false;
}
// Лопнувший пузырь оставляет румяное пятнышко (сборка 78): тонкая кожица купола ложится на сталь
// сухой и буреет первой — у настоящего роти это тёмные точки на пузырях. Выросший купол добавляет
// DOME_SCORCH цвета стороне на стали под собой; виден после переворота и в срезе.
const DOME_SCORCH = 0.07;
function popDome(d,sound=true){
  const i=domes.indexOf(d); if(i<0) return;
  const T=dish && dish.heatTable;
  if(T && d.grow>.3){
    const seen=new Set();
    for(let k=0;k<T.n;k++){
      if(!(T.flags[k]&2) || Math.hypot(T.x[k]-d.x,T.y[k]-d.y)>d.r*.8) continue;
      const key=T.src[k]*2+T.side[k]; if(seen.has(key)) continue; seen.add(key);
      const t=dish.thermal[T.src[k]]; if(t) t.cook[T.side[k]]=Math.min(COOK_CAP,t.cook[T.side[k]]+DOME_SCORCH*d.grow);
    }
  }
  domes.splice(i,1);
  if(sound) audioDomePop(d.rMax);
}
function popAllDomes(){ domes.slice().forEach((d,i)=>popDome(d,i<3)); }   // слышно не больше трёх хлопков разом
function updateDomes(dt){
  if(!DOMES || !dish.heatTable) return;
  const now=performance.now(), sess=dish.sessions ? dish.sessions.length : 1, md=meanDry();
  if(domeState.session!==sess){
    domeState={session:sess,left:DOME_COUNT[0]+Math.floor(Math.random()*(DOME_COUNT[1]-DOME_COUNT[0]+1)),next:0,s0:md};
  }
  // Купола растут, пока сторона на стали сохнет: после схватывания и до почти сухого — считая от
  // сухости при посадке (вторая сторона садится уже подсохшей; совсем сухой пара не даёт).
  const s0=domeState.s0||0, wet=1-s0;
  if(domeState.left>0 && wet>.1 && md>s0+.15*wet && md<s0+.85*wet && now>=domeState.next){
    if(spawnDome()) domeState.left--;
    domeState.next=now+400+Math.random()*900;
  }
  for(const d of domes.slice()){
    if(panPress.some(p=>p.level>.2 && Math.hypot(p.x-d.x,p.y-d.y)<d.r+PRESS_R*.5)){ popDome(d); continue; }
    const ring=domeRingDry(d);
    if(ring<.98){ d.grow=Math.min(1,d.grow+dt/DOME_GROW_S); d.dryFor=0; }
    else if((d.dryFor+=dt)>=DOME_SELF_POP_S){ popDome(d,false); audioDomeSigh(); continue; }
    // пар выходит: выросший купол держится недолго и опадает сам
    if(d.grow>=1 && (d.hold-=dt)<=0){ popDome(d,false); audioDomeSigh(); continue; }
    d.r=d.rMax*(.35+.65*d.grow);
  }
}
function onMaterial(p,r=0){
  const pts=r>0 ? [p,{x:p.x+r,y:p.y},{x:p.x-r,y:p.y},{x:p.x,y:p.y+r},{x:p.x,y:p.y-r}] : [p];
  return dish.faces.some(f=>f.kind==="dough" && pts.some(q=>pointInFace(f.points,q.x,q.y)));
}
// Приводы с модификаторами: тот же порядок сложения, что в rebuildDishContact, поэтому при
// множителях 1 результат побитово равен dish.dryDrive / dish.cookDrive.
function moddedDrives(){
  const T=dish.heatTable, n=dish.thermal.length;
  const dryD=Array.from({length:n},()=>[0,0]), cookD=Array.from({length:n},()=>[0,0]);
  for(let i=0;i<T.n;i++){
    const s=T.src[i], down=T.side[i], fl=T.flags[i], h=T.h[i]*sampleMultiplier(T,i), tr=T.tr[i];
    dryD[s][down]+=h*tr;
    if(fl&1) dryD[s][1-down]+=UP_DRY*h*tr;
    if(fl&2) cookD[s][down]+=h;
  }
  const avg=(v,s)=>T.count[s] ? [v[0]/T.count[s],v[1]/T.count[s]] : [0,0];
  return {dryDrive:dryD.map(avg),cookDrive:cookD.map(avg)};
}
function cookDish(dt){
  if(!dish || dish.mode!=="fold" || phase!=="PAN" || !dish.thermal || dishFlight || fryHold) return;
  if(dishGesture && dishGesture.slide) return;   // лист на лопатке — стали не касается
  if(!dish.dryDrive) rebuildDishContact();
  updatePanPress(dt);
  updateDomes(dt);
  const D=panModsActive() && dish.heatTable ? moddedDrives() : dish;
  // Пока конверт не сложен, лист только сохнет и мутнеет: цвет не поднимается выше OPEN_COOK_CAP (ниже
  // «бледного»). Иначе открытый лист жарился снизу, складки поднимали поджаренный низ наверх, и «подождать
  // и свернуть» давало готовое с двух сторон без переворота (ревью партии «жарка», 17.11).
  const cap=dish.env && !envelopeDone() ? OPEN_COOK_CAP : COOK_CAP;
  for(let i=0;i<dish.thermal.length;i++){
    const t=dish.thermal[i]; if(!t) continue;
    const thin=Math.max(.25,Math.min(2.5,SHEET_REF_MM/Math.max(.05,doughMM(t.tone))));
    for(let side=0;side<2;side++){
      if(t.dry[side]<1) t.dry[side]=Math.min(1,t.dry[side]+dt*DRY_RATE*D.dryDrive[i][side]*thin);
      const k=t.dry[side]>=COOK_DRY_FULL ? 1 : (t.dry[side]-COOK_DRY_FROM)/(COOK_DRY_FULL-COOK_DRY_FROM);
      if(k>0 && t.cook[side]<cap) t.cook[side]=Math.min(cap, t.cook[side]+dt*COOK_RATE*k*D.cookDrive[i][side]);
    }
  }
  if(dish.sessions){
    dish.panTime=(dish.panTime||0)+dt;
    const cur=dish.sessions[dish.sessions.length-1];
    if(cur.gold===null && dishSideMean("cook","contactWeights")>=0.4) cur.gold=dish.panTime-cur.start;
  }
  tickFryStage();
  if(performance.now()<(dish.noteUntil||0)){
    // подсказка о жесте (dishNote) держится пару секунд: строка жарки её не затирает
  } else if(!(typeof bananaModeOn!=="undefined" && bananaModeOn) && !(typeof eggModeOn!=="undefined" && eggModeOn)){
    const h=fryHint();
    if(h!==null && dish.message!==h){
      dish.message=h;
      const live=document.getElementById("live");
      if(live) live.textContent=h;
    }
  }
}
// Подсказка в ответ на жест, который не сработал: держится DISH_NOTE_MS, иначе её в том же кадре
// затирала строка стадии жарки, и «сначала сверни края» никто не видел (ревью сборки 70).
const DISH_NOTE_MS = 2400;
function dishNote(text){
  dish.message=text; dish.noteUntil=performance.now()+DISH_NOTE_MS;
  const live=typeof document!=="undefined" && document.getElementById("live"); if(live) live.textContent=text;
}
// Строка жарки (сборка 78). Называет только то, что игрок видит, — румяную кайму по краю (она красится
// цветом стороны на стали) и верх, — и только когда есть что делать руками; иначе молчит. Ступени — та же
// лестница fryStep, по которой судит тётя Сом, и те же условия, что у её хруста (guestVerdict).
// null — строку не трогать: пока конверт не сложен, в ней слова о банане и сторонах.
// Подсказки (сборка 80, плейтест 17.11 п. 12). Строка сверху — ОДНА короткая строка (до LINE_MAX знаков:
// на 375 px при лампе справа больше не влезает), без процентов и без стрелок. Подсказка жеста живёт, пока
// жест не удался один раз за вечер (learn); потом на её месте пусто или одно слово о состоянии. Поправки
// («сначала заверни края», «сырое — верни на таву») и состояния («край чёрный — горит») остаются всегда.
// Выученное лежит в roti_learned и стирается, пока лампа нового вечера не зажжена (updateFat). В режиме
// стенда (без рамки вечера) подсказки не гаснут: там нет вечера, который их вернул бы.
const LINE_MAX = 30;
let learned = {};
try{ learned = JSON.parse(localStorage.getItem("roti_learned") || "{}") || {}; }catch(e){ learned = {}; }
function learn(k){
  if(learned[k]) return;
  learned[k] = 1;
  try{ localStorage.setItem("roti_learned", JSON.stringify(learned)); }catch(e){}
}
function learnReset(){
  if(!Object.keys(learned).length) return;
  learned = {};
  try{ localStorage.removeItem("roti_learned"); }catch(e){}
}
function tip(k, text, after = ""){ return learned[k] && eveningOn() ? after : text; }
// Сборка 91 (ревью 18.11, п. 1): строка не спорит с тётей Сом. Пока она стучит (guest.js), строки «неси» нет;
// роти с сырой видимой стороной сняли на стол при ней — она качает головой (guestSeesRemoval), строки «режь» нет.
function somKnocks(){ return typeof guestKnocking==="function" && guestKnocking(); }
function somSaysRaw(){
  return typeof GST!=="undefined" && GST.here && !!dish && fryStep(dishSideMean("cook","topWeights"))<1;
}
function cutTip(){ return somSaysRaw() ? "" : tip("cut","режь от края до края"); }
function fryHint(){
  if(!envelopeDone()) return null;
  const bc=dishSideMean("cook","contactWeights"), tc=dishSideMean("cook","topWeights"), b=fryStep(bc), t=fryStep(tc);
  const v=fryVerdict(bc,tc,+dishCrisp.toFixed(1));
  if(b>=4) return "край чёрный — горит";
  // Сборка 91 (ревью 18.11, п. 1): пока Сом стучит, строка «поджарилось — неси» молчит — стук и строка не спорят.
  if(v==="crunch") return somKnocks() ? "" : tip("table","поджарилось — неси на стол","поджарилось");
  if(v==="burnt") return "";                               // верх уже чёрный: это видно и без слов
  // Сборка 88 (видимый жест): «край румяный — мах от края» снята — касание края на таве приподнимает
  // угол (cornerLift), и румяный низ виден на самом роти. Строка молчит, пока не горит и не готово.
  return "";
}
// Среднее по сторонам с весами: contactWeights — то, что лежит на стали (звук и «низ»),
// topWeights — то, что открыто сверху и видно игроку («верх»).
function dishSideMean(key,weightsKey){
  if(!dish || !dish.thermal || !dish[weightsKey]) return 0;
  let sum=0,weight=0;
  const W=dish[weightsKey];
  for(let i=0;i<dish.thermal.length;i++){
    const t=dish.thermal[i]; if(!t) continue;
    for(let side=0;side<2;side++){ const w=W[i][side]; if(w){ sum+=t[key][side]*w; weight+=w; } }
  }
  return weight ? sum/weight : 0;
}
// Строка прибора: «низ» — то, что лежит на стали, «верх» — то, что открыто взгляду.
// Золото низа считается по сеансам: посадка и каждый переворот начинают новый.
function dishStatus(){
  const parts=[`складок ${dish.folds}`,`переворотов ${dish.flips||0}`,`разрезов ${dish.cuts.length}`];
  if(phase!=="PAN") return parts.concat("на столе").join(" · ");
  parts.push(`низ: сушка ${meanDry().toFixed(2)} цвет ${meanCook().toFixed(2)}`);
  parts.push(`верх: цвет ${dishSideMean("cook","topWeights").toFixed(2)}`);
  if(dish.sessions) parts.push("золото низа "+dish.sessions.map(x=>x.gold===null ? "—" : typeof x.gold==="string" ? x.gold : Math.round(x.gold)+" с").join(" / "));
  return parts.join(" · ");
}
// Условность отрисовки, не физика: тонкий лист показывает сквозь себя цвет своей
// нижней стороны с весом (1 − толщина) × SHOW_THROUGH. На таве настоящий лист матовеет,
// опора на просвечивание есть только у сырого растянутого листа. Доля — на пробу (#21).
let SHOW_THROUGH = 0;
// ─── Жарку видно там, куда смотрит глаз (сборка 78; плейтест 17.11: верх конверта не менялся 50 с,
// игрок читал строку, а не роти). Условности отрисовки, модель тепла не трогают:
//  • румяная КАЙМА: у сложенного роти край верха красится цветом стороны, лежащей на стали, и ползёт
//    от края к середине, пока низ темнеет (RIM_FROM…RIM_TO полуширины роти к «зажаренному»); по шву
//    конверта — узкая полоска того же цвета. Кайма неровная (пятна контакта), а не обводка. Видна,
//    только пока низ темнее верха: после переворота верх и так румяный. Чёрная кайма — низ горит;
//  • бледные квадратные заплатки над начинкой на видимой стороне сглажены: тон тянется к среднему
//    тону этой стороны на PATCH_SMOOTH (в срезе слои честные: through===false).
const RIM_FROM = 0.16, RIM_TO = 0.72, RIM_FULL = 0.55, RIM_MIX = 0.92, SEAM_W = 0.035, SEAM_MIX = 0.5, PATCH_SMOOTH = 0.55;
let dishLookCache = null;
function dishLook(){
  const L=dishLookCache, t=dish.panTime||0;
  if(L && L.faces===dish.faces && L.t===t && L.hull===dish.hull) return L;
  const top=dishSideMean("cook","topWeights"), bot=dishSideMean("cook","contactWeights");
  let inr=Infinity; const H=dish.hull||[];
  if(H.length>2){
    const c=H.reduce((s,q)=>({x:s.x+q.x/H.length,y:s.y+q.y/H.length}),{x:0,y:0});
    for(let i=0;i<H.length;i++){ const a=H[i],b=H[(i+1)%H.length],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);
      if(l>1e-9) inr=Math.min(inr,Math.abs((c.x-a.x)*dy-(c.y-a.y)*dx)/l); }
  }
  const rim=dish.folds>0 && Number.isFinite(inr) && bot>top+0.04;
  // Сборка 88 (видимый жест): шов конверта больше не темнеет полоской — два шва крестом на корке
  // принимали за разрезы (разбор 17.11, п. 3). Кайма у края осталась.
  const seam=null;
  return dishLookCache={faces:dish.faces,t,hull:dish.hull,top,bot,rim,seam,
    rimW:inr*(RIM_FROM+(RIM_TO-RIM_FROM)*Math.min(1,bot/RIM_FULL))};
}
// Расстояние середины грани до края роти (оболочки) — считается один раз на грань и оболочку.
const rimDistCache = new WeakMap();
function rimDist(f,hull){
  const hit=rimDistCache.get(f); if(hit && hit.hull===hull) return hit;
  let x=0,y=0; for(const p of f.points){ x+=p.x; y+=p.y; } x/=f.points.length; y/=f.points.length;
  let d=Infinity;
  for(let i=0;i<hull.length;i++){
    const a=hull[i],b=hull[(i+1)%hull.length],dx=b.x-a.x,dy=b.y-a.y;
    const u=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));
    d=Math.min(d,Math.hypot(a.x+u*dx-x,a.y+u*dy-y));
  }
  const out={hull,d,x,y}; rimDistCache.set(f,out); return out;
}
function dishCookColor(f,side,through=true){
  const base=f.turned ? [221,199,152] : [227,213,178];
  const t=dish.thermal && dish.thermal[f.source];
  if(!t) return cookColor(base,0);
  if(side===undefined) side=f.turned ? 0 : 1;           // видна верхняя сторона грани
  const spot=0.55+0.8*(t.contact||1);
  let vis=t.cook[side]*spot;
  if(through===false) return cookColor(base, vis);
  const L=dishLook();
  if(vis<L.top) vis+=(L.top-vis)*PATCH_SMOOTH;
  let color=cookColor(base, vis);
  const down=f.turned ? 1 : 0;
  const bot=t.cook[down]*spot;
  if(bot>vis+0.06) color=lerp3(color, cookColor(base, bot), Math.min(0.32, (bot-vis)*0.55));
  if(L.rim){
    const R=rimDist(f,L.hull), low=L.bot*spot;
    let k=R.d<L.rimW ? 1-R.d/L.rimW : 0;
    k=k*k*(3-2*k)*RIM_MIX;
    if(L.seam){
      const E=L.seam, px=R.x-E.c.x, py=R.y-E.c.y;
      const s=Math.min(Math.abs(px*E.u.x+py*E.u.y),Math.abs(px*E.v.x+py*E.v.y));
      if(s<SEAM_W) k=Math.max(k,(1-s/SEAM_W)*SEAM_MIX);
    }
    if(k>0 && low>vis) color=lerp3(color, cookColor(base, low), k);
  }
  return color;
}

// ─── Жарка пятнами (сборка 86, docs/fry-spots-batch-spec.md). Только вид: пороги жарки, время, приговор
// и строки не тронуты. Румянец ложится пятнами и точками, а не виньеткой от края:
//  • поле пятен — шум в координатах МАТЕРИАЛА (лист в момент посадки), поэтому узор стоит на месте при
//    складке, перевороте и повороте и одинаков от кадра к кадру. Каждая грань несёт рамку m —
//    отображение материала в нынешние координаты блюда (CRUST_M0 при посадке; складка, переворот и
//    поворот переводят её той же функцией, что и точки грани — crustFrameMap). У двух сторон листа
//    узоры разные, зерно — от номера роти (dish.seed);
//  • доля площади под пятнами растёт с прожаркой стороны (spotCover), сами пятна темнее фона на
//    SPOT_LIFT…; сырая сторона (ниже FRY_STEPS[0]) — ни одного пятна, фон бледный и матовый;
//  • у края роти и у шва конверта (рёбра складок) пятен больше и они темнее (EDGE_W, SEAM_W);
//    румяная кайма стороны на стали (сборка 78) осталась, но тоже пятнами;
//  • пятно — не свой цвет, а затемнение фона (множитель SPOT_TINT): фон золотеет с прожаркой, веснушки
//    чуть темнее него, края мягкие (раунд 2, 18.11: на 86 пятна читались ржавчиной и камуфляжем);
//  • на таве пятна рисуются текстурой в координатах материала (crustSpotTex): у каждой грани своё
//    аффинное отображение материал → экран, умножение поверх фона грани, сила — globalAlpha; на столе
//    тот же crustMix считается попиксельно (renderDishTable). Пятна круглые и там, и там.
const CRUST_M0 = [1,0,0,1,0,0];                // материал = блюдо в момент посадки
const SPOT_BIG = 0.09, SPOT_FINE = 0.03;       // шаг сетки пятен и веснушек в долях радиуса роти (раунд 2: круглые точки)
const SPOT_SOFT = 0.09;                       // мягкость края пятна (в долях поля): край расплывается
const SPOT_TINT = [0.76,0.65,0.56];            // множитель цвета в сердцевине пятна при полной силе: коричневее фона, не чёрное
const EDGE_W = 0.075, EDGE_GROUND = 0.16;      // полоса края, где пятна гуще, — доля радиуса; румянец фона у края
function crustSeedNow(){
  const e=typeof EVE!=="undefined" && EVE ? EVE : null;
  return 1+(e && Number.isFinite(e.rotiDone) ? e.rotiDone : 0);
}
// Рамка переводится той же функцией, что точки: начало и два единичных вектора.
function crustFrameMap(m,fn){
  if(!m) return m;
  const o=fn({x:m[4],y:m[5]}), a=fn({x:m[0]+m[4],y:m[1]+m[5]}), b=fn({x:m[2]+m[4],y:m[3]+m[5]});
  return [a.x-o.x,a.y-o.y,b.x-o.x,b.y-o.y,o.x,o.y];
}
function crustToMaterial(m,x,y){
  const X=x-m[4], Y=y-m[5], det=m[0]*m[3]-m[1]*m[2]||1;
  return {x:(m[3]*X-m[2]*Y)/det, y:(m[0]*Y-m[1]*X)/det};
}
function crustHash(ix,iy,seed){
  let h=Math.imul(ix|0,374761393)+Math.imul(iy|0,668265263)+Math.imul(seed|0,1442695041);
  h=Math.imul(h^(h>>>13),1274126177); h^=h>>>16;
  return (h>>>0)/4294967296;
}
function crustNoise(x,y,seed){
  const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy, u=fx*fx*(3-2*fx), v=fy*fy*(3-2*fy);
  const a=crustHash(ix,iy,seed), b=crustHash(ix+1,iy,seed), c=crustHash(ix,iy+1,seed), d=crustHash(ix+1,iy+1,seed);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
// Поле пятен 0…1 в точке материала: круглые точки двух размеров (раунд 2; шум на решётке давал
// квадратные кляксы). В каждой клетке сетки — одна точка со случайными местом, радиусом и весом;
// поле — максимум по точкам от w·(1−(d/r)²). Порог поля по доле площади сначала открывает самые
// весомые точки и их середины, дальше точек больше и они крупнее. Крупные пятна (вес ≤ 0,8)
// появляются только у сильно зажаренной стороны. Медленный шум сверху — скопления веснушек.
function spotDot(cx,cy,cell,s){
  const h1=crustHash(cx,cy,s), h2=crustHash(cx,cy,s+101), h3=crustHash(cx,cy,s+202), h4=crustHash(cx,cy,s+303);
  return [(cx+0.15+0.7*h1)*cell,(cy+0.15+0.7*h2)*cell,cell*(0.3+0.42*h3),0.45+0.55*h4];
}
function spotDots(x,y,cell,s){
  const ix=Math.floor(x/cell), iy=Math.floor(y/cell); let v=0;
  for(let j=-1;j<=1;j++) for(let i=-1;i<=1;i++){
    const D=spotDot(ix+i,iy+j,cell,s), dx=x-D[0], dy=y-D[1], q=(dx*dx+dy*dy)/(D[2]*D[2]);
    if(q<1){ const w=D[3]*(1-q); if(w>v) v=w; }
  }
  return v;
}
const SPOT_BIG_W = 0.7, SPOT_CLUSTER = 0.3;
function spotCluster(x,y,s){ return 1-SPOT_CLUSTER+SPOT_CLUSTER*crustNoise(x/0.22+3.1,y/0.22+8.7,s+31); }
function spotField(x,y,seed,side){
  const s=seed*2+side;
  return Math.max(SPOT_BIG_W*spotDots(x,y,SPOT_BIG,s+7919),spotDots(x,y,SPOT_FINE,s))*spotCluster(x,y,s);
}
// Квантили поля (считаются один раз): порог, выше которого лежит заданная доля площади.
let spotQ=null;
function spotQuant(p){
  if(!spotQ){
    const a=[]; for(let j=0;j<96;j++) for(let i=0;i<96;i++) a.push(spotField(-1+i/48+.003,-1+j/48+.007,1,0));
    a.sort((x,y)=>x-y); spotQ=[]; for(let k=0;k<=100;k++) spotQ.push(a[Math.min(a.length-1,Math.round(k/100*(a.length-1)))]);
  }
  const q=Math.max(0,Math.min(100,p*100)), k=Math.floor(q), f=q-k;
  return k>=100 ? spotQ[100] : spotQ[k]+(spotQ[k+1]-spotQ[k])*f;
}
// Доля площади стороны под пятнами по её прожарке c: сырое — 0; «приготовленное» — редкие веснушки,
// «зажаренное» — гуще (до ~40 %). Больше половины — уже сплошные кляксы (камуфляж сборки 86).
function spotCover(c){
  if(!(c>=FRY_STEPS[0])) return 0;
  const k=Math.min(1,(c-FRY_STEPS[0])/(FRY_STEPS[3]-FRY_STEPS[0]));
  return Math.min(0.85,0.04+0.32*Math.pow(k,0.8)+Math.max(0,c-FRY_STEPS[3])*1.5);
}
// Сила пятна (0…1) — насколько сердцевина пятна доходит до SPOT_TINT: растёт с прожаркой, у края и
// у шва сильнее. Горелое — тёмное целиком, пятна на нём почти не нужны.
function spotStrength(c,edge){
  if(!(c>=FRY_STEPS[0])) return 0;
  const k=Math.min(1,(c-FRY_STEPS[0])/(FRY_STEPS[2]-FRY_STEPS[0]));
  return Math.min(1,0.3+0.45*k+0.35*edge);
}
// Фон между пятнами — сама сторона, чуть светлее: с прожаркой золотеет (раунд 2: на 86 фон оставался
// кремовым до «зажаренного»); у горелого догоняет её (горелое читается тёмным целиком).
const CRUST_GROUND = 0.78;
function crustGround(c){ return c<1 ? CRUST_GROUND*c : Math.min(c, CRUST_GROUND+(c-1)*4); }
// Маска пятна 0…1 по значению поля n и порогу thr: мягкий край, к сердцевине гуще.
function spotMask(n,thr,soft){
  const s=Math.max(0,Math.min(1,(n-thr+soft)/(2*soft)));
  if(s<=0) return 0;
  const d=Math.max(0,Math.min(1,(n-thr)/Math.max(1e-6,spotQuant(1)-thr)));
  return s*s*(3-2*s)*(0.5+0.5*d);
}
// Доля площади с поправкой на край и шов (там пятна гуще).
function spotCoverAt(c,edge){ const cov=spotCover(c); return cov ? cov+(0.75-cov)*0.6*edge : 0; }
// Параметры корки, одинаковые по всей грани: прожарка видимой стороны (с каймой стороны на стали),
// близость к краю и шву, зерно узора. null — у грани нет тепла (порванная ячейка).
function crustFace(f,side){
  const base=f.turned ? [221,199,152] : [227,213,178];
  const t=dish && dish.thermal && dish.thermal[f.source];
  if(side===undefined) side=f.turned ? 0 : 1;
  if(!t) return {base,c:0,edge:0,seed:1,side,ground:base};
  const spot=0.55+0.8*(t.contact||1), L=dishLook();
  let c=t.cook[side]*spot;
  if(c<L.top) c+=(L.top-c)*PATCH_SMOOTH;       // заплатки над начинкой сглажены, как в dishCookColor
  // Фон — по своей стороне, с лёгким просветом стороны на стали (как в dishCookColor); пятна — только у
  // своей прожарки и у каймы: сырая сторона не получает пятен ни от просвета, ни от сглаживания.
  const bot=t.cook[1-side]*spot;
  let gc=crustGround(c);
  if(bot>c+0.06) gc+=(crustGround(bot)-gc)*Math.min(0.32,(bot-c)*0.55);
  let edge=0;
  if(L.hull && L.hull.length>2){
    const R=rimDist(f,L.hull);
    if(R.d<EDGE_W){ const k=1-R.d/EDGE_W; edge=k*k*(3-2*k); }
    if(L.rim){                                  // кайма стороны на стали, ползёт к середине (сборка 78)
      let k=R.d<L.rimW ? 1-R.d/L.rimW : 0; k=k*k*(3-2*k)*RIM_MIX;
      if(L.seam){
        const E=L.seam, px=R.x-E.c.x, py=R.y-E.c.y, s=Math.min(Math.abs(px*E.u.x+py*E.u.y),Math.abs(px*E.v.x+py*E.v.y));
        if(s<SEAM_W){ k=Math.max(k,(1-s/SEAM_W)*SEAM_MIX); edge=Math.max(edge,1-s/SEAM_W); }
      }
      const low=L.bot*spot; if(k>0 && low>c) c+=(low-c)*k;
    }
  }
  // край и рёбра складок румянее и сами по себе, не только пятнами (раунд 2)
  if(c>=FRY_STEPS[0]) gc+=EDGE_GROUND*edge*Math.min(1,c/FRY_STEPS[2]);
  return {base,c,edge,seed:(dish && dish.seed)||1,side,ground:cookColor(base,gc)};
}
// Цвет корки в точке материала (x, y) для параметров грани P. Без пятна — фон.
function crustMix(P,x,y,ground=P.ground,soft=SPOT_SOFT,field=null){
  const cov=spotCoverAt(P.c,P.edge);
  if(!cov) return ground;
  const n=field===null ? spotField(x,y,P.seed,P.side) : field;
  const m=spotMask(n,spotQuant(1-cov),soft)*spotStrength(P.c,P.edge);
  if(m<=0) return ground;
  return [ground[0]*(1-m*(1-SPOT_TINT[0])),ground[1]*(1-m*(1-SPOT_TINT[1])),ground[2]*(1-m*(1-SPOT_TINT[2]))];
}
// Середина грани в материале — кэш по массиву точек (новая геометрия — новый массив).
const crustMid=new WeakMap();
function faceMaterialMid(f){
  let hit=crustMid.get(f.points); if(hit) return hit;
  let x=0,y=0; for(const p of f.points){ x+=p.x; y+=p.y; } x/=f.points.length; y/=f.points.length;
  hit=f.m ? crustToMaterial(f.m,x,y) : {x,y};
  crustMid.set(f.points,hit); return hit;
}
// Вид грани на таве и в руке: заливка — фон корки, пятна поверх — текстурой (drawCrustSpots).
// Пересчитывается раз в CRUST_DT секунд жарки: за это время прожарка сдвигается на тысячные, а рисунок
// тавы иначе платил бы за crustFace (rimDist) каждый кадр (2 000+ граней).
const CRUST_DT = 0.25, crustCache = new WeakMap();
function crustLook(f){
  const key=dish ? Math.floor((dish.panTime||0)/CRUST_DT+(f.source%16)/16)+"|"+(dish.seed||1) : "", hit=crustCache.get(f);
  if(hit && hit.key===key) return hit;
  const P=crustFace(f), cov=spotCoverAt(P.c,P.edge);
  const L={key,c:P.ground,cov,k:cov ? spotStrength(P.c,P.edge) : 0,seed:P.seed,side:P.side};
  crustCache.set(f,L); return L;
}
function dishCrustColor(f,side){ return side===undefined ? crustLook(f).c : crustFace(f,side).ground; }
// Сборка 90: фон корки на таве — по вершинам, как на столе (tableFaceData). Цвет вершины — среднее фона граней
// того же слоя в этой точке; иначе грань, прожаренная меньше соседей, светилась квадратной заплаткой.
// Номера вершин считаются раз на массив граней, суммы — каждый кадр из уже закэшированных crustLook.
const crustTopo = new WeakMap();
function crustVertexIds(faces){
  let T=crustTopo.get(faces); if(T) return T;
  const ids=new Map(), off=new Int32Array(faces.length+1);
  for(let i=0;i<faces.length;i++) off[i+1]=off[i]+faces[i].points.length;
  const id=new Int32Array(off[faces.length]);
  faces.forEach((f,i)=>f.points.forEach((p,k)=>{
    const key=Math.round(p.x*2e4)+","+Math.round(p.y*2e4)+(f.turned ? "t" : "f");
    let v=ids.get(key); if(v===undefined){ v=ids.size; ids.set(key,v); } id[off[i]+k]=v; }));
  T={off,id,n:ids.size}; crustTopo.set(faces,T); return T;
}
function crustVertexColors(faces){
  const T=crustVertexIds(faces), acc=new Float32Array(T.n*4);
  for(let i=0;i<faces.length;i++){
    const f=faces[i]; if(f.kind!=="dough") continue;
    const c=crustLook(f).c;
    for(let j=T.off[i];j<T.off[i+1];j++){ const v=T.id[j]*4; acc[v]+=c[0]; acc[v+1]+=c[1]; acc[v+2]+=c[2]; acc[v+3]++; }
  }
  for(let v=0;v<T.n;v++){ const w=acc[v*4+3]; if(w>1){ acc[v*4]/=w; acc[v*4+1]/=w; acc[v*4+2]/=w; } }
  return {T,acc};
}
// Заливка треугольника с цветами вершин (градиент или строка цвета): линейный градиент вдоль направления, где растёт яркость
// (r+g+b, линейная по треугольнику), со стопом в средней вершине. Цвет корки меняется вдоль одной
// линии «светлее — темнее», так что градиент даёт в вершинах их точные цвета. s — экранные x, y трёх точек.
// Градиент держится в кэше грани, пока её экранные точки и цвета вершин почти не сдвинулись: за кадр жарки
// цвет меняется на сотые доли единицы, а новый градиент на 1 000+ граней стоил ~2 мс кадра.
const crustGrad = new WeakMap();
function crustGradientCached(g,f,s,c0,c1,c2){
  let h=crustGrad.get(f);
  if(h && h.g===g){
    let ok=true;
    for(let i=0;i<6 && ok;i++) if(Math.abs(h.s[i]-s[i])>0.05) ok=false;
    const C=[c0,c1,c2];
    for(let i=0;i<9 && ok;i++) if(Math.abs(h.c[i]-C[(i/3)|0][i%3])>0.75) ok=false;
    if(ok) return h.gr;
  }
  if(!h){ h={s:new Float64Array(6),c:new Float32Array(9),gr:null,g:null}; crustGrad.set(f,h); }
  h.s.set(s); h.c.set([...c0,...c1,...c2]); h.g=g; h.gr=crustGradient(g,s,c0,c1,c2);
  return h.gr;
}
function crustGradient(g,s,c0,c1,c2){
  const t0=c0[0]+c0[1]+c0[2], t1=c1[0]+c1[1]+c1[2], t2=c2[0]+c2[1]+c2[2];
  const lo=Math.min(t0,t1,t2), hi=Math.max(t0,t1,t2);
  // ровная заливка — средним вершин, не своим цветом грани: иначе недожаренная грань осталась бы заплаткой
  const flat=()=>rgb([(c0[0]+c1[0]+c2[0])/3,(c0[1]+c1[1]+c2[1])/3,(c0[2]+c1[2]+c2[2])/3]);
  if(hi-lo<3 || !g.createLinearGradient) return flat();   // разница меньше единицы на канал — хватит ровной заливки
  const e1x=s[2]-s[0], e1y=s[3]-s[1], e2x=s[4]-s[0], e2y=s[5]-s[1], det=e1x*e2y-e2x*e1y;
  if(Math.abs(det)<1e-6) return flat();
  const d1=t1-t0, d2=t2-t0, gx=(d1*e2y-d2*e1y)/det, gy=(d2*e1x-d1*e2x)/det, gg=gx*gx+gy*gy;
  if(!(gg>1e-12)) return flat();
  const T=[t0,t1,t2], C=[c0,c1,c2], a=T.indexOf(lo), b=T.indexOf(hi), m=3-a-b, k=(hi-lo)/gg;
  const gr=g.createLinearGradient(s[a*2],s[a*2+1],s[a*2]+gx*k,s[a*2+1]+gy*k);
  gr.addColorStop(0,rgb(C[a])); if(m!==a && m!==b) gr.addColorStop((T[m]-lo)/(hi-lo),rgb(C[m])); gr.addColorStop(1,rgb(C[b]));
  return gr;
}
// Цвет в середине грани с пятном (для наборов: то, что текстура кладёт в этой точке).
function dishCrustSample(f){ const P=crustFace(f), q=faceMaterialMid(f); return crustMix(P,q.x,q.y); }
// Текстура пятен: поле в координатах материала на квадрате [U0, U0+N·S]², одна на сторону и зерно;
// уровни — доля площади, квантованная на SPOT_LEVELS ступеней (у соседних граней разница ступени — край
// пятна сдвигается на сотые поля, под мягким краем не виден). Значение текселя — множитель цвета.
const SPOT_TEX_N = 512, SPOT_TEX_U0 = -1.15, SPOT_TEX_S = 2.3/512, SPOT_LEVELS = 24, SPOT_COV_MAX = 0.85;
let spotTex = {seed:0, field:[null,null], pat:new Map()};
function spotTexField(seed,side){
  if(spotTex.seed!==seed) spotTex={seed, field:[null,null], pat:new Map()};
  let F=spotTex.field[side]; if(F) return F;
  // То же поле, что spotField, но раскладкой точек по текселям: в разы быстрее опроса 3×3 клеток
  const N=SPOT_TEX_N, S=SPOT_TEX_S, U=SPOT_TEX_U0, s=seed*2+side; F=new Float32Array(N*N);
  for(const [cell,sd,W] of [[SPOT_FINE,s,1],[SPOT_BIG,s+7919,SPOT_BIG_W]]){
    const c0=Math.floor(U/cell)-1, c1=Math.ceil((U+N*S)/cell)+1;
    for(let cy=c0;cy<=c1;cy++) for(let cx=c0;cx<=c1;cx++){
      const D=spotDot(cx,cy,cell,sd), r2=D[2]*D[2];
      const i0=Math.max(0,Math.floor((D[0]-D[2]-U)/S-.5)), i1=Math.min(N-1,Math.ceil((D[0]+D[2]-U)/S-.5));
      const j0=Math.max(0,Math.floor((D[1]-D[2]-U)/S-.5)), j1=Math.min(N-1,Math.ceil((D[1]+D[2]-U)/S-.5));
      for(let j=j0;j<=j1;j++){ const dy=U+(j+.5)*S-D[1];
        for(let i=i0;i<=i1;i++){ const dx=U+(i+.5)*S-D[0], q=(dx*dx+dy*dy)/r2;
          if(q<1){ const w=W*D[3]*(1-q); if(w>F[j*N+i]) F[j*N+i]=w; } } }
    }
  }
  for(let j=0;j<N;j++){ const y=U+(j+.5)*S; for(let i=0;i<N;i++) F[j*N+i]*=spotCluster(U+(i+.5)*S,y,s); }
  return spotTex.field[side]=F;
}
function spotLevel(cov){ return Math.max(1,Math.min(SPOT_LEVELS,Math.round(cov/SPOT_COV_MAX*SPOT_LEVELS))); }
function crustSpotPattern(g,seed,side,lv){
  if(typeof document==="undefined" || !g.createPattern) return null;
  const key=seed+"|"+side+"|"+lv; let pat=spotTex.seed===seed ? spotTex.pat.get(key) : undefined;
  if(pat!==undefined) return pat;
  const F=spotTexField(seed,side), N=SPOT_TEX_N, thr=spotQuant(1-lv/SPOT_LEVELS*SPOT_COV_MAX);
  const cv=document.createElement("canvas"); cv.width=cv.height=N;
  const cx=cv.getContext("2d"), im=cx.createImageData(N,N), d=im.data;
  for(let i=0;i<N*N;i++){
    const m=spotMask(F[i],thr,SPOT_SOFT);
    d[i*4]=255*(1-m*(1-SPOT_TINT[0])); d[i*4+1]=255*(1-m*(1-SPOT_TINT[1])); d[i*4+2]=255*(1-m*(1-SPOT_TINT[2])); d[i*4+3]=255;
  }
  cx.putImageData(im,0,0);
  pat=g.createPattern(cv,"repeat"); spotTex.pat.set(key,pat); return pat;
}
// Точки грани в материале — кэш по массиву точек и рамке.
const crustMat=new WeakMap();
function faceMaterialPts(f){
  let hit=crustMat.get(f.points); if(hit && hit.m===f.m) return hit.q;
  const q=new Float32Array(6);
  for(let k=0;k<3;k++){ const p=f.points[k], r=f.m ? crustToMaterial(f.m,p.x,p.y) : p; q[k*2]=r.x; q[k*2+1]=r.y; }
  crustMat.set(f.points,{m:f.m,q}); return q;
}
// Грани под верхним слоем (клапаны конверта закрывают низ): пятна им не нужны — их всё равно закроют.
// Скрыта, только если стопка выше верха грани во всех клетках вокруг её середины и вершин (с запасом).
function crustBuried(faces,H){
  if(!H || !H.zt || !H.top || !H.size) return null;
  if(H.crustBuried) return H.crustBuried;
  const n=H.size, out=new Uint8Array(faces.length);
  const cell=(x,y)=>[Math.min(n-1,Math.max(0,Math.floor((x-H.L)/H.dx))),Math.min(n-1,Math.max(0,Math.floor((y-H.T)/H.dy)))];
  for(let i=0;i<faces.length;i++){
    const f=faces[i]; if(f.kind!=="dough") continue;
    let cx=0,cy=0; for(const p of f.points){ cx+=p.x; cy+=p.y; }
    // запас — 0,7 толщины самой грани: открытая грань стоит вровень со стопкой, под клапаном — на слой ниже
    const c={x:cx/f.points.length,y:cy/f.points.length}, pts=[c,...f.points], lim=H.zt[i]+Math.max(0.05,0.7*layerMM(f,c));
    let hid=true;
    for(const p of pts){ const [a,b]=cell(p.x,p.y);
      for(let j=Math.max(0,b-1);j<=Math.min(n-1,b+1) && hid;j++) for(let k=Math.max(0,a-1);k<=Math.min(n-1,a+1);k++) if(H.top[j*n+k]<=lim){ hid=false; break; }
      if(!hid) break; }
    out[i]=hid ? 1 : 0;
  }
  return H.crustBuried=out;
}
// Пятна поверх уже залитой грани (путь грани — текущий): умножение текстуры, у каждой грани своё
// аффинное отображение материал → экран по трём первым точкам (s — их экранные x, y).
const spotMatrix = typeof DOMMatrix!=="undefined" ? new DOMMatrix() : null;
function drawCrustSpots(g,f,s){
  const L=crustLook(f); if(!(L.k>0.01) || !spotMatrix) return;
  const pat=crustSpotPattern(g,L.seed,L.side,spotLevel(L.cov)); if(!pat) return;
  const q=faceMaterialPts(f), du1=q[2]-q[0], dv1=q[3]-q[1], du2=q[4]-q[0], dv2=q[5]-q[1], det=du1*dv2-du2*dv1;
  if(Math.abs(det)<1e-12) return;
  const dx1=s[2]-s[0], dy1=s[3]-s[1], dx2=s[4]-s[0], dy2=s[5]-s[1];
  const a=(dx1*dv2-dx2*dv1)/det, c=(dx2*du1-dx1*du2)/det, b=(dy1*dv2-dy2*dv1)/det, d=(dy2*du1-dy1*du2)/det;
  const e=s[0]-a*q[0]-c*q[1], h=s[1]-b*q[0]-d*q[1], S=SPOT_TEX_S, U=SPOT_TEX_U0;
  const M=spotMatrix; M.a=a*S; M.b=b*S; M.c=c*S; M.d=d*S; M.e=e+(a+c)*U; M.f=h+(b+d)*U;
  pat.setTransform(M);
  const ga=g.globalAlpha;
  g.globalCompositeOperation="multiply"; g.globalAlpha=L.k; g.fillStyle=pat; g.fill();
  g.globalCompositeOperation="source-over"; g.globalAlpha=ga;
}
// Мокрый блеск маргарина (сборка 86): на ближнем к глазу крае роти, там, где под кромкой жир.
// Нет, пока сторона на стали сырая; ярче всего у «бледного», тускнеет к «зажаренному». Без пузырьков.
function marginGloss(bot){
  if(!(bot>=FRY_STEPS[0])) return 0;
  const up=Math.min(1,(bot-FRY_STEPS[0])/0.08), down=1-0.85*Math.max(0,Math.min(1,(bot-0.16)/(FRY_STEPS[3]-0.16)));
  return up*down;
}
function drawMargarineGloss(g,screen,H,zk,sx){
  if(!fatMap || !dish || dish.mode!=="fold" || phase!=="PAN" || !dish.hull || dish.hull.length<3) return;
  const k0=marginGloss(dishSideMean("cook","contactWeights")); if(k0<=0.01) return;
  const Hl=dish.hull, c=hullCentre(Hl), dpr=typeof devicePixelRatio==="number" ? devicePixelRatio : 1;
  const w=Math.max(1.5,3.2*sx*Math.min(2,dpr));
  g.save(); g.lineCap="round";
  for(let i=0;i<Hl.length;i++){
    const A=Hl[i], B=Hl[(i+1)%Hl.length], n=Math.max(1,Math.round(Math.hypot(B.x-A.x,B.y-A.y)/FIZZ_STEP));
    // ближний край: наружная нормаль стороны смотрит вниз по экрану
    let nx=B.y-A.y, ny=-(B.x-A.x); const l=Math.hypot(nx,ny)||1; nx/=l; ny/=l;
    if(nx*((A.x+B.x)/2-c.x)+ny*((A.y+B.y)/2-c.y)<0){ nx=-nx; ny=-ny; }
    const s0=screen(A), s1=screen({x:A.x+nx*.05,y:A.y+ny*.05}), near=(s1.y-s0.y)/(Math.hypot(s1.x-s0.x,s1.y-s0.y)||1);
    if(near<0.2) continue;
    for(let k=0;k<n;k++){                     // сторона по кусочкам: блеск там, где под кромкой жир
    const a={x:A.x+(B.x-A.x)*k/n,y:A.y+(B.y-A.y)*k/n}, b={x:A.x+(B.x-A.x)*(k+1)/n,y:A.y+(B.y-A.y)*(k+1)/n};
    const f=fatAtEdge((a.x+b.x)/2,(a.y+b.y)/2,c); if(!(f>0.02)) continue;
    const al=k0*Math.min(1,f*2.5)*Math.min(1,(near-0.2)/0.4);
    if(al<0.02) continue;
    const IN=0.022, pa=screen({x:a.x-nx*IN,y:a.y-ny*IN}), pb=screen({x:b.x-nx*IN,y:b.y-ny*IN});
    const za=H ? H.at({x:a.x-nx*IN,y:a.y-ny*IN})*zk : 0, zb=H ? H.at({x:b.x-nx*IN,y:b.y-ny*IN})*zk : 0;
    g.strokeStyle=`rgba(255,247,222,${(0.30*al).toFixed(3)})`; g.lineWidth=w*2.2;
    g.beginPath(); g.moveTo(pa.x,pa.y-za); g.lineTo(pb.x,pb.y-zb); g.stroke();
    g.strokeStyle=`rgba(255,252,238,${(0.55*al).toFixed(3)})`; g.lineWidth=w*0.7;
    g.beginPath(); g.moveTo(pa.x,pa.y-za); g.lineTo(pb.x,pb.y-zb); g.stroke();
    }
  }
  g.restore();
}

// ─── Конверт (срез 3, сборка 72). Лист ложится на таву ровно к столу (посадка кратна 90°), и у него
// четыре стороны. Рамка конверта привязана к МАТЕРИАЛУ, не к экрану: середина листа c, две оси u и v
// и полуразмеры h — расстояние от середины до края по каждой из четырёх сторон (+u, −u, +v, −v).
// Поворот и переворот преобразуют рамку вместе с гранями, «отменить» возвращает её из истории.
// Штрих от стороны к середине, не дальше FOLD_SNAP_ANG от оси (угол — в экранной мерке: вид из-за
// прилавка сжимает вертикаль в TILT раз), ставит складку РОВНО: сгиб параллелен стороне и проходит
// на половине пути до середины, кромка клапана ложится на среднюю линию. Две стороны — прямоугольник,
// четыре — квадрат в четверть листа, швы крестом. Штрих наискось, слишком мелкий или слишком глубокий
// (вне FOLD_SNAP_MIN…MAX от расстояния до средней линии) и повтор по уже завёрнутой стороне дают
// свободную складку, как раньше. Верхняя граница 1,5 — середина между «к середине» (палец прошёл 1)
// и «пополам» (палец прошёл 2): на телефоне полстороны по вертикали — около 55 px, и палец легко
// проскакивает среднюю линию (живая проверка сборки 72: при границе 1,25 мах в 105 px дал косую
// свободную складку). Штриху быстрее FOLD_FAST_CSS глубина не важна: мах пальцем её не выбирает.
// Числа — стартовые, не замер.
const FOLD_SNAP_COS = Math.cos(35*Math.PI/180), FOLD_SNAP_MIN = 0.35, FOLD_SNAP_MAX = 1.5, FOLD_SNAP_FROM = 0.6, FOLD_FAST_CSS = 500;
function envelopeFrame(){
  const b=dishBounds();
  return {c:{x:(b.left+b.right)/2,y:(b.top+b.bottom)/2},u:{x:1,y:0},v:{x:0,y:1},
    h:[(b.right-b.left)/2,(b.right-b.left)/2,(b.bottom-b.top)/2,(b.bottom-b.top)/2],done:[0,0,0,0]};
}
function envSide(E,k){ const a=k<2 ? E.u : E.v, s=k%2 ? -1 : 1; return {x:a.x*s,y:a.y*s}; }
function envDoneCount(){ return dish && dish.env ? dish.env.done.reduce((s,d)=>s+(d?1:0),0) : 0; }
function envelopeDone(){ return envDoneCount()===4; }
// point — как едет точка, vec — как едет направление (поворот или зеркало без сдвига)
function envMoved(E,point,vec){ return E ? {...E,c:point(E.c),u:vec(E.u),v:vec(E.v)} : E; }
function snapFold(g,fast){
  const E=dish.env; if(!E || !g.target || !g.anchor) return null;
  const wx=g.target.x-g.anchor.x, wy=g.target.y-g.anchor.y, wl=Math.hypot(wx,wy*TILT);
  if(wl<1e-9) return null;
  let best=null;
  for(let k=0;k<4;k++){
    if(E.done[k]) continue;
    const d=envSide(E,k), h=E.h[k], from=(g.anchor.x-E.c.x)*d.x+(g.anchor.y-E.c.y)*d.y;
    if(!(h>1e-6) || from<FOLD_SNAP_FROM*h) continue;             // штрих начат не с этой стороны
    const cos=-(wx*d.x+wy*d.y*TILT*TILT)/(wl*Math.hypot(d.x,d.y*TILT));   // угол к оси на экране
    if(cos<FOLD_SNAP_COS) continue;
    const depth=-(wx*d.x+wy*d.y)/from;                           // доля пути от кромки до средней линии
    if(!fast && (depth<FOLD_SNAP_MIN || depth>FOLD_SNAP_MAX)) continue;
    if(!best || cos>best.cos) best={k,d,h,cos};
  }
  if(!best) return null;
  // Вдоль стороны точка остаётся там, где палец: сгиб от этого не зависит, а лопатка рисуется под рукой.
  const t={x:-best.d.y,y:best.d.x}, along=(g.anchor.x-E.c.x)*t.x+(g.anchor.y-E.c.y)*t.y;
  const base={x:E.c.x+t.x*along,y:E.c.y+t.y*along};
  return {side:best.k,anchor:{x:base.x+best.d.x*best.h,y:base.y+best.d.y*best.h},target:base};
}
// Свободных складок не больше четырёх (сборка 78): сверх них свободная не делается; ровная складка стороны
// конверта — всегда (она его и завершает). Поэтому счётчик dish.folds может быть больше четырёх: N свободных
// + 4 стороны. Это складки самой играющей до готового конверта; у ГОТОВОГО конверта новых складок нет вовсе.
const FOLDS_MAX = 4;
function foldCapped(plan){ return plan && plan.side<0 && dish.folds>=FOLDS_MAX ? null : plan; }
// Что складывать: ровная складка конверта, если штрих на неё похож, иначе — как провела.
function foldPlan(g,fast){
  if(!g.target || !inwardFold(g)) return null;
  const s=snapFold(g,fast);
  return s || {side:-1,anchor:g.anchor,target:g.target};
}
function foldGeometry(anchor,end){
  const dx=anchor.x-end.x, dy=anchor.y-end.y, length=Math.hypot(dx,dy);
  if(length<.12) return null;
  const nx=dx/length, ny=dy/length, offset=((anchor.x+end.x)*nx+(anchor.y+end.y)*ny)/2;
  const fixed=[], moving=[]; let aFixed=0,aMoving=0,slot=-1;
  // Скрытые ссылки на исходную грань нужны быстрым высотам предпросмотра; в JSON и в
  // следующие копии они не попадают (не перечисляемые).
  const tag=(o,src,lifted)=>Object.defineProperties(o,{__src:{value:src},__lifted:{value:lifted}});
  dish.faces.forEach((f,src)=>{
    // Начинка — кусок на листе, едет отдельно (scootFillings), но место в стопке помнит:
    // всё, что было под ней и осталось, — под ней; клапан этой складки ложится сверху.
    if(f.kind==="filling"){ if(slot<0) slot=fixed.length; return; }
    const stay=clipPoly(f.points,nx,ny,offset,false), lift=clipPoly(f.points,nx,ny,offset);
    if(stay.length){ fixed.push(tag({...f,points:stay},src,false)); if(f.kind==="dough") aFixed+=polyArea(stay); }
    if(lift.length){
      if(f.kind==="dough") aMoving+=polyArea(lift);
      const refl=p=>{const d=p.x*nx+p.y*ny-offset;return{x:p.x-2*d*nx,y:p.y-2*d*ny};};
      moving.push(tag({...f,turned:!f.turned,flap:true,points:lift.map(refl),m:crustFrameMap(f.m,refl)},src,true));
    }
  });
  if(aMoving<.025*(aFixed+aMoving)||aFixed<.18*(aFixed+aMoving)) return null;
  return {faces:fixed.concat(moving.reverse()),crease:{nx,ny,offset},slot:slot<0 ? fixed.length : slot};
}
function rememberDish(){
  pushHistory({faces:dish.faces,folds:dish.folds,cuts:dish.cuts,flips:dish.flips||0,env:dish.env,
    filling:(dish.filling||[]).map(f=>({...f}))});
}
// До 20 шагов назад; шаг «вернуть на таву» (toPan) не выпадает никогда — иначе после 20 действий
// на столе конверт нельзя было вернуть (проверка 17.09).
function pushHistory(entry){
  dish.history.push(entry);
  if(dish.history.length>20){
    if(dish.history[0].toPan) dish.history.splice(1,1); else dish.history.shift();
  }
}
function foldDish(anchor,end,yank,side=-1){
  const next=foldGeometry(anchor,end); if(!next) return false;
  panPress=[]; popAllDomes();
  rememberDish();
  const tokens=scootFillings(dish.filling||[], next.crease.nx, next.crease.ny, next.crease.offset, yank);
  clampFillings(tokens, next.faces);
  dish.faces=restampFillings(next.faces, tokens, next.slot);
  dish.filling=tokens;
  dish.folds++; dish.hull=dishHull(); rebuildDishContact();
  if(side>=0 && dish.env){ const done=dish.env.done.slice(); done[side]=1; dish.env={...dish.env,done}; }   // новая рамка: прежняя живёт в истории
  const n=envDoneCount();
  // dishNote, а не dish.message: строка стадии жарки затирала подпись в том же кадре (живая проверка сборки 72).
  dishNote(side<0 ? tip("fold","ещё край — к середине")
    : n===4 ? ""                                   // сборка 88: «конверт готов» снята — конверт виден
    : n===2 && dish.env.done[0]===dish.env.done[1] ? tip("fold","теперь две другие стороны")
    : tip("fold",`завёрнуто ${n} из 4`));
  if(side>=0 && n===4){ audioReady(); learn("fold"); }
  syncDishUI(); return true;
}
// ─── Подача (решение владелицы 16.09): техническая кнопка «подать» → карточка → «следующий роти».
// Карточка — черновик стенда: что помнит след роти, владелица отложила до первой нарисованной
// карточки (#50). Здесь только то, что стенд знает наверняка.
let servedCount = 0, inputQuietUntil = 0;
try{ servedCount = Math.max(0, +(localStorage.getItem("dough_served")||0)) || 0; }catch(e){}
function cookWord(c){ return FRY_WORDS[fryStep(c)]; }
function dishCard(){
  const bottom=+dishSideMean("cook","contactWeights").toFixed(2), top=+dishSideMean("cook","topWeights").toFixed(2);
  return { folds:dish.folds, flips:dish.flips||0, cuts:dish.cuts.length, holes:dish.holes||0,
    portions:dish.filling.length, bottom, top,
    thickMM:+Math.max(0,...stackHeights(dish.faces).zt).toFixed(1),
    bottomWord:cookWord(bottom), topWord:cookWord(top), panSeconds:Math.round(dish.panTime||0),
    crisp:+dishCrisp.toFixed(1), crispWord:crispWord(+dishCrisp.toFixed(1)),
    sessions:(dish.sessions||[]).map(x=>x.gold===null ? "—" : typeof x.gold==="string" ? x.gold : Math.round(x.gold)+" с") };
}
function serveDish(){
  // Карточка и кнопка убраны (владелица 20.09): черновик с неверной сводкой.
  // След остаётся в дампе, блюдо на столе не блокируется.
  if(!dish || dishMove || dishGesture) return false;
  if(dishTwist) endTwist(false);
  const c=dishCard();
  servedCount++;
  try{ localStorage.setItem("dough_served", String(servedCount)); }catch(e){}
  gestures.push({ ...measurementContext(), kind:"serve", n:servedCount, ...c, ts:new Date().toISOString() });
  if(gestures.length>200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
  const card=document.getElementById("card");
  if(card) card.hidden=true;
  syncDishUI(); return true;
}
function nextRoti(){
  document.getElementById("card").hidden=true;
  inputQuietUntil=performance.now()+350;   // второе касание кнопки не должно попасть в новый кусочек
  stepNo=1;
  try{ localStorage.setItem("dough_step","1"); }catch(e){}
  syncStepButtons(); reset();
}
function startCutting(){
  if(!dish || !dish.folds || dish.mode!=="fold" || dishGesture || dishFlight) return;
  const b=dishBounds(); dish.cutBounds=b; dish.cutCenter={x:(b.left+b.right)/2,y:(b.top+b.bottom)/2};
  // Первая отмена на столе возвращает лист на таву вместе с историей складок: случайное
  // снятие обратимо (находка проверки 16.09).
  dish.history=[{faces:dish.faces,folds:dish.folds,cuts:dish.cuts,flips:dish.flips||0,env:dish.env,
    filling:(dish.filling||[]).map(f=>({...f})),toPan:{history:dish.history}}];
  dish.mode="cut"; phase="CUT";
  dish.message=cutTip();
  syncDishUI();
}
// Роти со стола — обратно на таву: то же, что первая отмена на столе (undoDish, ветка toPan) — возвращается
// конверт до разрезов, цвет сторон и хруст при нём, на стали начинается новый сеанс жарки.
const PAN_BACK_R = 0.8;
function returnToPan(){
  if(!dish || dish.mode!=="cut" || dishMove || dishFlight || dishGesture) return false;
  if(dishTwist) endTwist(false);
  const h=dish.history.find(e=>e.toPan); if(!h) return false;
  const {toPan,...entry}=h;
  Object.assign(dish,entry); dish.hull=dishHull();
  dish.mode="fold"; phase="PAN"; dish.history=toPan.history;
  rebuildDishContact(); startPanSession(); syncDishUI();
  return true;
}
// Рез — только от края до края (сборка 80, плейтест 17.11 п. 17: штрих на 30 % ширины давал «нарезано»).
// Прямая штриха режет оболочку роти по хорде; штрих засчитан, если его концы не дальше CUT_END_TOL хорды
// от её концов внутрь (палец редко начинает точно с кромки), и тогда рез идёт по всей хорде с запасом.
// Сборка 88 (видимый жест): допуск 0,15 → 0,10 — штрих, остановившийся на 15 % не доходя края, больше не рез
// (его линия гаснет, cutFade); 8 % — ширина пальца на роти 150 px — ещё рез.
// «Нарезано» — когда резов не меньше трёх и они двух направлений (2+2, принимается и 1+2): направление
// считается от первого реза, «поперёк» — дальше CUT_FAMILY_DEG от него. К сетке резы не привязаны.
// Срезанный уголок — не рез (ревью сборки 80: три штриха по углам на 20 % стороны давали «нарезано» у целого
// роти). Хорда реза — не короче CUT_MIN_SPAN габарита роти ВДОЛЬ этого реза: поперёк и по диагонали через
// середину — весь габарит, уголок в 20 % стороны — пятая часть.
const CUT_END_TOL = 0.10, CUT_OVER = 0.03, CUT_FAMILY_COS = Math.cos(35*Math.PI/180), CUT_MIN_SPAN = 0.6;
function cutAcross(a,b){
  const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy); if(len<.08) return null;
  const ux=dx/len, uy=dy/len, H=dish.hull || dishHull(); let t0=Infinity, t1=-Infinity;
  for(let i=0;i<H.length;i++){
    const p=H[i], q=H[(i+1)%H.length], ex=q.x-p.x, ey=q.y-p.y, den=ux*ey-uy*ex;
    if(Math.abs(den)<1e-12) continue;
    const t=((p.x-a.x)*ey-(p.y-a.y)*ex)/den, w=((p.x-a.x)*uy-(p.y-a.y)*ux)/den;
    if(w<-1e-9 || w>1+1e-9) continue;
    if(t<t0) t0=t; if(t>t1) t1=t;
  }
  const span=t1-t0; if(!(span>1e-6)) return null;
  { let lo=Infinity, hi=-Infinity; for(const p of H){ const w=p.x*ux+p.y*uy; if(w<lo) lo=w; if(w>hi) hi=w; }
    if(span<CUT_MIN_SPAN*(hi-lo)) return null; }                           // срезан уголок
  if(t0<-CUT_END_TOL*span || t1>len+CUT_END_TOL*span) return null;        // начат или кончен в глубине роти
  const f=Math.min(0,t0-CUT_OVER), e=Math.max(len,t1+CUT_OVER);
  return {a:{x:a.x+ux*f,y:a.y+uy*f}, b:{x:a.x+ux*e,y:a.y+uy*e}};
}
function cutFamilies(){
  const C=dish ? dish.cuts : []; if(!C.length) return [0,0];
  const dir=c=>{ const x=c.b.x-c.a.x, y=c.b.y-c.a.y, l=Math.hypot(x,y)||1; return {x:x/l,y:y/l}; }, d0=dir(C[0]);
  let along=0, across=0;
  for(const c of C){ const d=dir(c); if(Math.abs(d.x*d0.x+d.y*d0.y)>=CUT_FAMILY_COS) along++; else across++; }
  return [along,across];
}
function cutEnough(){ const [a,b]=cutFamilies(); return a+b>=3 && a>=1 && b>=1; }
function cutWord(){
  const [a,b]=cutFamilies();
  if(cutEnough()){ learn("cut"); return tip("serve","нарезано — за середину и неси","нарезано"); }
  return !b ? (a<2 ? "ещё рез" : "теперь поперёк") : "ещё один рез";
}
// Строка роти. На столе поправка («неси дальше», «сырое — верни на таву», «режь от края до края») держится
// DISH_NOTE_MS и уступает место состоянию нарезки; на таве то же делает строка жарки (cookDish).
function dishLine(){
  if(dish.mode==="cut" && dish.noteUntil && performance.now()>=dish.noteUntil){
    dish.noteUntil=0; dish.message=dish.cuts.length ? cutWord() : cutTip();
  }
  return dish.message;
}
// Сборка 88 (видимый жест): линия ножа и её угасание, если рез не прошёл от края до края.
const CUT_LINE = "rgba(52,30,14,.85)", CUT_FADE_S = 0.3;
let cutFade = null;                // {a,b,o,t0}: последний не засчитанный штрих, гаснет
function cutDish(a,b){
  const full=cutAcross(a,b); if(!full) return false;
  a=full.a; b=full.b;
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy); if(len<.08) return false;
  const ux=dx/len,uy=dy/len,nx=-uy,ny=ux, width=.018;
  // Вычитаем узкую конечную полосу ножа из КАЖДОГО слоя. Четыре полуплоскости
  // оставляют концы короткого надреза на месте: это не бесконечная линия и не
  // нарисованная поверх теста полоска. Удалённый зазор делает срез видимым.
  const edges=[[ux,uy,a.x*ux+a.y*uy],[-ux,-uy,-b.x*ux-b.y*uy],
    [nx,ny,a.x*nx+a.y*ny-width/2],[-nx,-ny,-a.x*nx-a.y*ny-width/2]];
  const faces=[]; let removed=0;
  for(const f of dish.faces){
    let inside=f.points;
    for(const [ex,ey,offset] of edges){
      if(!inside.length) break;
      const outside=clipPoly(inside,ex,ey,offset,false);
      if(outside.length){
        const next={...f,points:outside};
        // Осколок начинки по ту сторону реза больше не тот же диск: pc в щели рисовал
        // «выпавшую» монету. Оставляем диск, только если центр ещё на этом куске.
        if(f.kind==="filling" && f.pc && f.pr>0 && !pointInFace(outside,f.pc.x,f.pc.y)){
          let cx=0,cy=0; for(const p of outside){ cx+=p.x; cy+=p.y; }
          cx/=outside.length; cy/=outside.length;
          if(Math.hypot(cx-f.pc.x,cy-f.pc.y)>f.pr){ next.pc=undefined; next.pr=0; }
        }
        faces.push(next);
      }
      inside=clipPoly(inside,ex,ey,offset);
    }
    if(inside.length) removed+=polyArea(inside);
  }
  if(removed<1e-7) return false;
  rememberDish(); dish.faces=faces; dish.cuts=dish.cuts.concat({a,b,width});
  dish.message=cutWord();
  syncDishUI(); return true;
}
function undoDish(){
  // Посреди поворота «отменить» отменяет сам поворот и больше ничего.
  if(dishTwist){ endTwist(false); dish.message="Поворот отменён"; syncDishUI(); return; }
  if(!dish || dishGesture || dishFlight || dishMove || dish.mode==="served" || !dish.history.length) return;
  const flipsBefore=dish.flips||0;
  panPress=[]; for(const d of domes.slice()) popDome(d,false);   // геометрия меняется — купола и пятна прижима не переносятся
  const {toPan,...entry}=dish.history.pop();
  Object.assign(dish,entry); dish.hull=dishHull();
  if(toPan){
    dish.mode="fold"; phase="PAN"; dish.history=toPan.history;
    rebuildDishContact(); startPanSession();
    dish.message="Вернули на таву"; syncDishUI(); return;
  }
  rebuildDishContact();
  // Отмена переворота кладёт на сталь другую сторону — это новый сеанс, а не откат времени.
  if((dish.flips||0)!==flipsBefore) startPanSession();
  dish.message="Последнее действие отменено"; syncDishUI();
}

// ─── Переворот (#21). Чистая геометрия: отражение относительно прямой через центроид
// площади теста, перпендикулярной направлению маха, плюс сдвиг посадки. Центроид при
// отражении стоит на месте, поэтому два переворота на месте возвращают лист точно.
// Порядок слоёв разворачивается, у каждой грани меняется сторона, материал и его
// тепловая история не трогаются: стороны принадлежат тесту. Начинка внутри конверта
// едет зеркалом вместе с пакетом (куски, не наклейка).
function dishCentroid(faces=dish.faces){
  // Складка отражает клапан, не меняя порядка вершин, поэтому у граней разная ориентация.
  // Площадь и момент каждой грани берутся со знаком её собственной площади — иначе клапан
  // вычитался бы из листа, и переворот после складки уносил лист с тавы.
  let a=0,cx=0,cy=0;
  for(const f of faces){
    if(f.kind!=="dough") continue;
    const p=f.points; let fa=0,fx=0,fy=0;
    for(let i=0;i<p.length;i++){
      const u=p[i],v=p[(i+1)%p.length],c=u.x*v.y-v.x*u.y;
      fa+=c; fx+=(u.x+v.x)*c; fy+=(u.y+v.y)*c;
    }
    const sign=fa<0 ? -1 : 1;
    a+=fa*sign; cx+=fx*sign; cy+=fy*sign;
  }
  return a>1e-12 ? {x:cx/(3*a),y:cy/(3*a)} : {x:0,y:0};
}
const FLIP_REACH = 0.30;     // как у переноса: центр блюда не дальше 30 % радиуса тавы
function flipGeometry(dir,landing={x:0,y:0}){
  const len=Math.hypot(dir.x,dir.y); if(len<1e-9) return null;
  const nx=dir.x/len, ny=dir.y/len, c=dishCentroid();
  // Упор посадки: не уводить центр дальше предела, но и не подтягивать уже лежащий дальше.
  let tx=c.x+landing.x, ty=c.y+landing.y;
  const lim=FLIP_REACH*PAN_R/targetR, r=Math.hypot(tx,ty);
  if(r>lim && r>1e-12){ const k=Math.max(lim,Math.hypot(c.x,c.y))/r; if(k<1){ tx*=k; ty*=k; } }
  const ox=tx-c.x, oy=ty-c.y, moved=new Map();
  const mirror=p=>{
    let q=moved.get(p);
    if(!q){ const d=(p.x-c.x)*nx+(p.y-c.y)*ny; q={x:p.x-2*d*nx+ox,y:p.y-2*d*ny+oy}; moved.set(p,q); }
    return q;
  };
  const faces=[]; let slot;
  for(let i=dish.faces.length-1;i>=0;i--){
    const f=dish.faces[i];
    if(f.kind==="filling"){ if(slot===undefined) slot=faces.length; continue; }   // лист теперь над начинкой
    faces.push({...f,turned:!f.turned,points:f.points.map(mirror),m:crustFrameMap(f.m,mirror)});
  }
  const filling=(dish.filling||[]).map(t=>{ const q=mirror({x:t.x,y:t.y}); return {...t,x:q.x,y:q.y}; });
  const env=envMoved(dish.env, p=>mirror({x:p.x,y:p.y}), w=>{ const d=w.x*nx+w.y*ny; return {x:w.x-2*d*nx,y:w.y-2*d*ny}; });
  return {faces:restampFillings(faces, filling, slot),filling,env,axis:{nx,ny,c},from:c,to:{x:tx,y:ty}};
}
function startPanSession(){
  // Если на сталь легла уже золотая сторона, «0 с» засоряло бы замер бюджета: пишем «уже».
  if(dish.sessions) dish.sessions.push({flip:dish.flips||0,start:dish.panTime||0,
    gold:dishSideMean("cook","contactWeights")>=0.4 ? "уже" : null});
}
function commitFlip(next){
  panPress=[];                                   // лист перевернулся: пятна прижима остались на прежнем месте
  rememberDish(); dish.faces=next.faces; if(next.filling) dish.filling=next.filling; dish.flips=(dish.flips||0)+1;
  if(next.env) dish.env=next.env;
  dish.hull=dishHull(); rebuildDishContact(); startPanSession();
  learn("flip");
  dish.message=""; dish.noteUntil=0;                        // переворот видно и без слов; строка жарки скажет своё
  syncDishUI();
}
// Технический и жестовый вход одинаковы: полёт 0,45 с, посадка — шлепок и волна шипения.
const FLIP_T = 0.45;
function startFlip(dir,landing){
  if(dishTwist) endTwist(false);
  if(!dish || dish.mode!=="fold" || phase!=="PAN" || dishGesture || dishFlight) return false;
  const next=flipGeometry(dir,landing); if(!next) return false;
  if(dish.folds || dish.cuts.length) dishSectionGeometry(next.faces);   // торец считаем до посадки, если он рисуется
  stackHeights(dish.faces); stackHeights(next.faces);   // и высоты: иначе кадр посадки считает их сам и дёргается
  popAllDomes();                                         // лопатка поддела лист — купола лопнули
  let radius=0;
  for(const f of dish.faces) if(f.kind==="dough") for(const p of f.points)
    radius=Math.max(radius,Math.hypot(p.x-next.from.x,p.y-next.from.y));
  dishFlight={next,from:dish.faces,t0:performance.now(),T:FLIP_T,radius};
  dish.message=""; syncDishUI(); audioFlipLift();
  return true;
}
// «Почти» переворот: тот же полёт, но лист доходит только до FLICK_ALMOST_U пути и падает обратно;
// материал не меняется, купола целы. Жарка стоит эти 0,34 с, как и в настоящем полёте.
function startAlmostFlip(dir){
  if(!dish || dish.mode!=="fold" || phase!=="PAN" || dishGesture || dishFlight) return false;
  const len=Math.hypot(dir.x,dir.y); if(len<1e-9) return false;
  const c=dishCentroid(); let radius=0;
  for(const f of dish.faces) if(f.kind==="dough") for(const p of f.points) radius=Math.max(radius,Math.hypot(p.x-c.x,p.y-c.y));
  stackHeights(dish.faces);
  dishFlight={almost:true,next:{axis:{nx:dir.x/len,ny:dir.y/len,c},from:c,to:c},from:dish.faces,t0:performance.now(),T:FLICK_ALMOST_T,radius};
  return true;
}
function updateDishFlight(){
  if(!dishFlight) return;
  if((performance.now()-dishFlight.t0)/1000 < dishFlight.T) return;
  if(dishFlight.almost){ dishFlight=null; return; }
  const late=(performance.now()-dishFlight.t0)/1000 > dishFlight.T+0.5;   // вернулись из фона
  const next=dishFlight.next; dishFlight=null;
  commitFlip(next);
  if(!late) audioPanLand();                  // шлепок через минуты после взлёта — ложный звук
}
// ─── Поворот сложенного роти на плоскости (владелица 17.09: «давай реализуем поворот на плоскости
// (когда роти уже в сложенном виде)?», жест — «два пальца?»). Пока пальцы крутят, поворот только
// показывается (dishTwist); на отпускании он запекается в геометрию, как переворот: грани, центры
// ломтиков и резы поворачиваются вокруг середины (на таве — центроида теста, на столе — середины
// раскладки), шаг ложится в историю. Тепло принадлежит материалу и не меняется; на таве контакт
// пересчитывается (сталь греет по радиусу), пятна прижима и купола снимаются — лопатка поддела лист.
// Мышь: колесо или прокрутка тачпада над полем (фиксируется через TWIST_IDLE_MS тишины) и
// перетаскивание с Option/Alt. Все числа — для пробы.
const TWIST_MIN_DEG = 1, TWIST_IDLE_MS = 220, TWIST_WHEEL_DEG = 0.25;   // градусов на пиксель прокрутки
function canTwist(){
  if(!dish || dishFlight || dishMove || dish.mode==="served") return false;
  if(dish.mode==="fold") return phase==="PAN";
  return dish.mode==="cut";
}
function twistPivot(){ return dish.mode==="cut" ? {...dish.cutCenter} : dishCentroid(); }
const rotAbout=(p,c,cs,sn)=>({x:c.x+(p.x-c.x)*cs-(p.y-c.y)*sn, y:c.y+(p.x-c.x)*sn+(p.y-c.y)*cs});
// Границы повёрнутого блюда — масштаб стола следует за поворотом плавно, без скачка на отпускании.
function twistBounds(angle,pivot){
  const cs=Math.cos(angle), sn=Math.sin(angle);
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(const f of dish.faces){ if(f.kind!=="dough") continue;
    for(const p of f.points){ const q=rotAbout(p,pivot,cs,sn); if(q.x<left)left=q.x; if(q.x>right)right=q.x; if(q.y<top)top=q.y; if(q.y>bottom)bottom=q.y; } }
  return {left,right,top,bottom};
}
function twistBoundsCached(){
  const T=dishTwist, C=twistBoundsCached.c;
  if(C && C.faces===dish.faces && C.angle===T.angle && C.px===T.pivot.x && C.py===T.pivot.y) return C.b;
  const b=twistBounds(T.angle,T.pivot);
  twistBoundsCached.c={faces:dish.faces,angle:T.angle,px:T.pivot.x,py:T.pivot.y,b};
  return b;
}
function rotateDish(angle,pivot=twistPivot()){
  if(!canTwist() || dishGesture || !(Math.abs(angle)*180/Math.PI>=TWIST_MIN_DEG)) return false;
  const cs=Math.cos(angle), sn=Math.sin(angle), R=p=>rotAbout(p,pivot,cs,sn);
  const moved=new Map(), rot=p=>{ let q=moved.get(p); if(!q){ q=R(p); moved.set(p,q); } return q; };
  const faces=dish.faces.map(f=>({...f,points:f.points.map(rot),m:crustFrameMap(f.m,R),...(f.pc?{pc:R(f.pc)}:{})}));
  // Куски начинки поворачиваются вместе с блюдом: иначе следующая складка или переворот
  // штамповали бы их на прежнем, неповёрнутом месте.
  const filling=(dish.filling||[]).map(t=>{ const q=R(t); return {...t,x:q.x,y:q.y}; });
  if(dish.mode==="cut"){
    // Отмена поворота на столе возвращает и рамку масштаба.
    pushHistory({faces:dish.faces,folds:dish.folds,cuts:dish.cuts,flips:dish.flips||0,cutBounds:dish.cutBounds,cutCenter:dish.cutCenter,env:dish.env,
      filling:(dish.filling||[]).map(f=>({...f}))});
    dish.faces=faces; dish.cuts=dish.cuts.map(c=>({...c,a:R(c.a),b:R(c.b)}));
    // Середина раскладки — середина повёрнутых границ: так же, как в предпросмотре (иначе
    // повёрнутое блюдо съезжало и могло лечь на борт тавы).
    const b=dishBounds(); dish.cutBounds=b; dish.cutCenter={x:(b.left+b.right)/2,y:(b.top+b.bottom)/2};
  } else {
    panPress=[]; popAllDomes();
    rememberDish(); dish.faces=faces; rebuildDishContact();
  }
  dish.filling=filling;
  dish.env=envMoved(dish.env, R, w=>({x:w.x*cs-w.y*sn,y:w.x*sn+w.y*cs}));
  dish.hull=dishHull();
  if (typeof drizzleRotate === "function") drizzleRotate(angle, pivot);
  const deg=Math.round(angle*180/Math.PI);
  dish.message=`Повёрнуто на ${Math.abs(deg)}° ${deg>0 ? "по часовой" : "против часовой"}`;
  syncDishUI(); return true;
}
function logTwist(input,angle){
  gestures.push({ ...measurementContext(), kind:"twist", input, mode:dish.mode, deg:+(angle*180/Math.PI).toFixed(1),
    folds:dish.folds, cuts:dish.cuts.length, ts:new Date().toISOString() });
  if(gestures.length>200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
}
function dishModeWord(){
  return !dish ? "нет блюда" : dishFlight ? "полёт" : dishMove ? "перенос" : dish.mode==="fold" ? (dish.folds ? "тава" : "не сложено") : dish.mode;
}
function logTwistTry(reason){
  twistDbg.last=reason;
  gestures.push({ ...measurementContext(), kind:"twist-try", reason, touches:dishTouches.size, mode:dish ? dish.mode : null,
    folds:dish ? dish.folds : 0, ts:new Date().toISOString() });
  if(gestures.length>200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
}
// Угол точек касания меряется в плоскости стола: на экране стол сжат по вертикали.
const tableAngle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
function beginTwist(input,extra){
  if(!canTwist() || dishTwist) return false;
  if(dishGesture){ releasePress(dishGesture); dishGesture=null; }   // второй палец отменяет начатую складку или рез
  dishTwist={input,angle:0,pivot:twistPivot(),lastT:performance.now(),...extra};
  if(dish.mode==="fold") audioScrape();
  return true;
}
function twistTo(raw){
  // Разворот через ±180° не перескакивает: копим приращения.
  const T=dishTwist; let d=raw-T.raw; d=Math.atan2(Math.sin(d),Math.cos(d));
  T.raw=raw; T.angle+=d; T.lastT=performance.now();
}
function endTwist(commit=true){
  const T=dishTwist; if(!T) return false;
  dishTwist=null;
  const ok=commit && rotateDish(T.angle,T.pivot);
  twistDbg.last=ok ? `${T.input} ${Math.round(T.angle*180/Math.PI)}°` : `${T.input}: не сделан (${Math.round(T.angle*180/Math.PI)}°)`;
  logTwist(T.input,ok ? T.angle : 0);
  return ok;
}
function updateDishTwist(dt){
  if(dishTwist && dishTwist.input==="wheel" && performance.now()-dishTwist.lastT>=TWIST_IDLE_MS) endTwist(true);
  // Отпустили пальцы — куски съезжаются обратно к обычной щели.
  if(!dishPinch && dishSpread>1){
    dishSpread=1+(dishSpread-1)*Math.exp(-(dt||0)*SPREAD_BACK);
    if(dishSpread<1.02) dishSpread=1;
  }
}
function syncDishUI(){
  syncTray();
  document.getElementById("gDish").hidden=!dish;
  document.getElementById("gStep").hidden=!!dish;
  { const b = document.getElementById("tear"); if(b) b.hidden=!!dish; }
  document.getElementById("gTune").hidden=!!dish;
  document.getElementById("gCond").hidden=!!dish;
  const cut=document.getElementById("cutMode");
  cut.disabled=!dish || !dish.folds || dish.mode!=="fold";
  cut.textContent=dish && dish.mode==="cut" ? "нарезка на столе" : "к нарезке →";
  cut.disabled=cut.disabled || !!dishFlight || !!dishMove;
  document.getElementById("undoDish").disabled=!dish || !dish.history.length || !!dishFlight || dish.mode==="served";
  const serve=document.getElementById("serveDish");
  if(serve) serve.hidden=true;
  const card=document.getElementById("card");
  if(card) card.hidden=true;
  const flip=document.getElementById("flipDish");
  if(flip) flip.disabled=!dish || dish.mode!=="fold" || !!dishFlight;
  const served=!!dish && dish.mode==="served";
  for(const id of ["flipDish","cutMode","undoDish"]){ const b=document.getElementById(id); if(b) b.hidden=served; }
  if(dish) hintEl.textContent=dish.mode==="fold"
    ? (envelopeDone() ? "за середину — унести на стол · держи — прижим"
       : dish.folds ? "от стороны к середине — складка · мах наружу или вбок — переворот · за середину — унести на стол · держи — прижим · "+TWIST_HINT
       : (dish.filling && dish.filling.length
         ? (fillingUnderSheet() ? "начинка под листом · мах наружу — перевернуть обратно · от стороны к середине — складка"
           : "начинка на листе · веди от каждой стороны к середине — четыре складки дают конверт")
         : "коснись середины — банан, ещё раз — яйцо; потом заверни четыре стороны к середине"))
    : dish.mode==="served" ? "Подано · «следующий роти» — новый кусочек"
    : "Нарезка: проведи через конверт · "+TWIST_HINT;
  const ban=document.getElementById("bananaMode");
  if(ban){
    ban.hidden=!dish || dish.mode!=="fold" || dish.folds>0;
    ban.disabled=!!dishFlight || !!dishMove;
  }
  const egg=document.getElementById("eggMode");
  if(egg){
    egg.hidden=!dish || dish.mode!=="fold" || dish.folds>0;
    egg.disabled=!!dishFlight || !!dishMove;
  }
}
// Складка — только ВНУТРЬ листа. Раньше линия сгиба строилась по любому сдвигу длиннее
// 0,12, и сдвиг пальца вдоль кромки на 10 CSS px складывал полсписта (портрет: сгиб
// поперёк движения проходил через середину листа). Теперь сдвиг меряется вдоль
// внутренней нормали кромки и должен смотреть внутрь не дальше 70° от неё.
// До 10 CSS px от точки касания жест не читается вовсе: это дрожание пальца
// (iOS allowableMovement 10 pt, Android touch slop 8 dp). Числа — для пробы, не замер.
const FOLD_MIN_DEPTH = 0.12, FOLD_MAX_ANGLE_COS = Math.cos(70*Math.PI/180), TOUCH_SLOP_CSS = 10;   // сборка 72: 60° → 70°, и угол теперь экранный (inwardFold)
function beginDishGesture(id,p,client,time){
  if(dishGesture || dishTwist || dishFlight || dishMove || dish.mode==="served") return;
  const start=dishLocal(p), at=client || {x:0,y:0}, t0=Number.isFinite(time) ? time : performance.now();
  const samples=[{x:at.x,y:at.y,t:t0}];
  if(dish.mode==="cut"){
    // Рез считается в материале: сдвиг куска под пальцем вычитается из всего штриха; начало в
    // щели — сдвиг ближайшего куска не известен, штрих идёт по нарисованному столу как есть.
    const u=unshiftCutPoint(start), o=u ? u.o : {x:0,y:0};
    // Рамка вечера: нарезанный роти берут за середину и уносят наверх, на стойку, — тем же переносом,
    // что и на таву. Рез после первого начинается у края или снаружи, не из середины.
    // Середина часто приходится на щель первого реза (u пуст) — она тоже середина.
    // Ревью сборки 80: середина — ВСЕГДА перенос, при любом числе резов (рез из середины невозможен: он от
    // края до края). Иначе снятый слишком рано роти с одним резом было не вернуть на таву, не дорезав.
    // Сборка 88 (видимый жест): ненарезанный роти со стола не поднимается — касание середины у него
    // обычный штрих ножа (он не от края, рез не засчитается, линия погаснет). Отката на таву нет.
    if(eveningOn() && cutEnough() && cutMiddle(u ? u.p : start)){
      dishGesture={id,start,end:start,client:at,samples,zone:"serve",t0,moved:false,carry:false}; return;
    }
    dishGesture={id,start:{x:start.x-o.x,y:start.y-o.y},end:{x:start.x-o.x,y:start.y-o.y},client:at,samples,cutShift:o};
    return;
  }
  // У угла оболочки два ребра одинаково близки: сохраняем оба, иначе жест внутрь
  // засчитывался бы у одного угла конверта и отклонялся у другого.
  const near=[]; let distance=Infinity;
  for(let i=0;i<dish.hull.length;i++){
    const a=dish.hull[i],b=dish.hull[(i+1)%dish.hull.length],dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((start.x-a.x)*dx+(start.y-a.y)*dy)/(dx*dx+dy*dy||1)));
    const q={x:a.x+t*dx,y:a.y+t*dy},d=Math.hypot(q.x-start.x,q.y-start.y);
    if(d<distance-1e-9){ distance=d; near.length=0; }
    if(d<=distance+1e-9) near.push({q,dx,dy});
  }
  // «Середина» — дальше 0,30 от кромки, а у сложенного (маленького) роти — дальше CARRY_ZONE от
  // его полуширины: иначе у конверта в четверть листа середины не было бы вовсе (сборка 70).
  const c=dish.hull.reduce((s,q)=>({x:s.x+q.x/dish.hull.length,y:s.y+q.y/dish.hull.length}),{x:0,y:0});
  let inr=Infinity;
  for(let i=0;i<dish.hull.length;i++){
    const a=dish.hull[i],b=dish.hull[(i+1)%dish.hull.length],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);
    if(l>1e-9) inr=Math.min(inr,Math.abs((c.x-a.x)*dy-(c.y-a.y)*dx)/l);
  }
  // У готового конверта (четыре складки) складывать больше нечего — главный жест «взять и унести»,
  // и полоса кромки ИЗНУТРИ сужается до 0,30 полуширины: середина была 88×54 px на роти 144×84 px
  // (ревью сборки 70). Снаружи, на стали, полоса прежняя: мах-переворот начинается и оттуда.
  const outDepth=Math.min(.30,CARRY_ZONE*inr);
  const midDepth=dish.folds>=4 && onMaterial(start,0) ? Math.min(outDepth,ENVELOPE_EDGE*inr) : outDepth;
  const onMat=onMaterial(start,distance>midDepth ? 0 : .06);
  // Дальше от кромки лопатки нет: палец на тесте — прижим с первого кадра, мимо теста — ничего.
  // Сложенный роти из середины можно взять и унести на стол (carryable): стоит палец — прижим,
  // повела — роти в руке. Подсказки о возможном здесь не пишутся (критерий подсказок 07.09).
  if(distance>midDepth){
    if(!onMat) return;
    const press=adoptPress(start);
    dishGesture={id,start,end:start,client:at,samples,zone:"middle",t0,moved:false,press,latched:true,carryable:dish.folds>0,
      foldSide:openSideAt(start)};
    return;
  }
  const anchor=near[0].q, edge={dx:near[0].dx,dy:near[0].dy};
  // Внутренняя нормаль кромки: перпендикуляр, повёрнутый к центру оболочки.
  const inwards=near.map(e=>{
    const len=Math.hypot(e.dx,e.dy)||1; let n={x:-e.dy/len,y:e.dx/len};
    if((c.x-anchor.x)*n.x+(c.y-anchor.y)*n.y<0) n={x:-n.x,y:-n.y};
    return n;
  });
  const inward=inwards[0];
  dishGesture={id,start,end:start,anchor,inward,inwards,edge,preview:null,client:at,samples,moved:false,
    zone:"edge",t0,onMat,press:null,latched:false,foldSide:openSideAt(start),
    stroke:{start:null,path:0,lastMoveT:t0,lastT:t0,pos:{x:at.x,y:at.y}}};
  // Сборка 88: касание края на таве приподнимает этот угол — снизу виден его румянец (cornerLift).
  if(phase==="PAN" && !dishTwist){
    const nl=Math.hypot(c.x-anchor.x,c.y-anchor.y);
    if(nl>1e-6) cornerLift={a:anchor,n:{x:(c.x-anchor.x)/nl,y:(c.y-anchor.y)/nl},R:nl,t0:performance.now(),up:null};
  }
  audioScrape();                              // ответ инструмента: лопатка коснулась стали у края
}
// Четвёртый сгиб читался как перенос (плейтест 17.11, п. 16): палец вставал на 8 px глубже полосы кромки,
// и движение к центру поднимало начатый конверт («carry-back», «неси дальше — на стол»). Сборка 80: пока
// завёрнуты не все четыре стороны, касание во ВНЕШНЕЙ ТРЕТИ ещё открытой стороны (от FOLD_OUTER её
// полуширины и дальше) с движением внутрь — её сгиб, а не перенос. Вбок и наружу оттуда же — перенос, как был.
// Несложенный лист (ни одной складки) это не трогает: его и так не унести, а в середине там прижим и щипок.
const FOLD_OUTER = 2/3, FOLD_OUTER_COS = Math.cos(50*Math.PI/180);   // конус «внутрь» уже, чем у складки от кромки (70°): вниз к столу от боковой стороны — перенос
function openSideAt(q){
  const E=dish.env; if(!E || !dish.folds || dish.mode!=="fold" || envelopeDone()) return -1;
  let best=-1, far=0;
  for(let k=0;k<4;k++){
    if(E.done[k]) continue;
    const d=envSide(E,k), h=E.h[k]; if(!(h>1e-6)) continue;
    const f=((q.x-E.c.x)*d.x+(q.y-E.c.y)*d.y)/h;
    if(f>=FOLD_OUTER && f>far){ far=f; best=k; }
  }
  return best;
}
// Ревью сборки 80: то же — и из ПОЛОСЫ КРОМКИ открытой стороны (и с самой стали у неё, f > 1): там решал
// прежний foldPlan, и штрих внутрь на 12–24 px не давал ничего, на 45 px — свободную складку («конверт 3 из 4»
// на 149 с). Теперь у начатого конверта любой штрих внутрь длиннее мёртвой зоны от открытой стороны — её сгиб.
// Палец пошёл: внутрь (экранный конус ±50° к оси стороны) — жест становится складкой этой стороны.
function promoteToFold(g,client,t){
  const E=dish.env, k=g.foldSide, d=envSide(E,k), h=E.h[k];
  const vx=g.end.x-g.start.x, vy=g.end.y-g.start.y, len=Math.hypot(vx,vy*TILT);
  g.foldSide=-1;                                                   // решается один раз, на первом сдвиге
  if(!(len>1e-9) || -(vx*d.x+vy*d.y*TILT*TILT)<len*Math.hypot(d.x,d.y*TILT)*FOLD_OUTER_COS) return false;
  const tv={x:-d.y,y:d.x}, along=(g.start.x-E.c.x)*tv.x+(g.start.y-E.c.y)*tv.y, base={x:E.c.x+tv.x*along,y:E.c.y+tv.y*along};
  releasePress(g);
  if(g.press){ const i=panPress.indexOf(g.press); if(i>=0 && g.press.level<.02) panPress.splice(i,1); }
  g.forced={side:k,anchor:{x:base.x+d.x*h,y:base.y+d.y*h},target:base,d};
  g.zone="edge"; g.anchor=g.forced.anchor; g.inward={x:-d.x,y:-d.y}; g.inwards=[g.inward]; g.edge={dx:tv.x,dy:tv.y};
  g.press=null; g.latched=false; g.carryable=false; g.preview=null; g.onMat=true;
  if(!g.stroke) g.stroke={start:null,path:0,lastMoveT:g.t0,lastT:g.t0,pos:{x:g.client.x,y:g.client.y}};
  return true;
}
// Сгиб стороны оказался переносом (ревью сборки 80): палец от дальней открытой стороны прошёл весь роти и
// вышел за противоположный край (FOLD_PAST её полуразмера дальше оболочки) или отпущен над столом — роти в руке.
const FOLD_PAST = 0.15;
function foldPassed(g){
  const F=g.forced, E=dish.env; if(!F || !E || !dish.folds) return false;
  let lo=Infinity; for(const p of dish.hull) lo=Math.min(lo,(p.x-E.c.x)*F.d.x+(p.y-E.c.y)*F.d.y);
  return (g.end.x-E.c.x)*F.d.x+(g.end.y-E.c.y)*F.d.y < lo-FOLD_PAST*E.h[F.side];
}
function foldToCarry(g,t){
  g.forced=null; g.plan=null; g.preview=null; g.target=null; g.zone="middle"; g.carryable=true; g.foldSide=-1;
  g.carry=true; g.carryFrom={x:g.start.x,y:g.start.y}; g.carryAt=t; g.slide={x:g.end.x-g.start.x,y:g.end.y-g.start.y};
  audioPeel(); dish.message=tip("table","неси на стол и отпусти");
}
// Сгиб стороны, пока палец всё ещё ушёл внутрь от места касания; вернулся назад — сгиба нет.
function forcedFold(g){
  const F=g.forced; if(!F) return null;
  return (g.end.x-g.start.x)*F.d.x+(g.end.y-g.start.y)*F.d.y<0 ? F : null;
}
// Угол конуса меряется так, как его видит рука, — на экране: вид из-за прилавка сжимает вертикаль в
// TILT раз, и в координатах блюда штрих под 45° на экране у боковых кромок уходил за 60° (6 «ничего»
// из 160, runs/fix91-diagnosis), а у ближней и дальней конус был шире заявленного. Сборка 72.
// Середина нарезанного роти: внутренняя половина его габарита на столе (SERVE_MID по каждой оси).
const SERVE_MID = 0.5;
function cutMiddle(q){
  const b=dish.cutBounds, c=dish.cutCenter; if(!b || !c) return false;
  return Math.abs(q.x-c.x)<=(b.right-b.left)*SERVE_MID/2 && Math.abs(q.y-c.y)<=(b.bottom-b.top)*SERVE_MID/2;
}
function inwardFold(g){
  const vx=g.target.x-g.anchor.x, vy=g.target.y-g.anchor.y, len=Math.hypot(vx,vy*TILT);
  return (g.inwards || [g.inward]).some(n=>{
    const depth=vx*n.x+vy*n.y;
    return depth>=FOLD_MIN_DEPTH && vx*n.x+vy*n.y*TILT*TILT>=len*Math.hypot(n.x,n.y*TILT)*FOLD_MAX_ANGLE_COS;
  });
}
// Штрих — непрерывное движение пальца. Пауза длиннее STROKE_PAUSE_MS начинает новый штрих:
// неподвижный палец событий не шлёт, и без этого пауза перед махом считалась бы его частью.
// Начало штриха живёт в жесте, а не в буфере отсчётов, — длина буфера зависит от частоты событий.
// Сборка 70: как и на столе (pauseMs/staleMs/gapIsPause), пороги паузы и остановки растут со средним
// шагом событий жеста, а разрыв — пауза, только если палец за него почти не сдвинулся. С постоянными
// 40/50 мс телефон на пропущенных кадрах (события через 33–60 мс) резал один мах на куски: штрих
// «начинался заново» на каждом событии, и мах-переворот не набирал ни пути, ни свежести.
const ENVELOPE_EDGE = 0.30;                 // доля полуширины конверта: глубже от кромки — «середина»
const STROKE_PAUSE_MS = 40, FOLD_PREVIEW_DELAY_MS = 110, DISH_STALL_CSS = 100;   // CSS px/с: медленнее за разрыв — палец стоял
function dishEvStep(g){ return Math.min(60, Math.max(4, g.dtAvg || 16.7)); }
function dishPauseMs(g){ return Math.max(STROKE_PAUSE_MS, 2.5*dishEvStep(g)); }
function dishStaleMs(g){ return Math.max(FLICK_STALE_MS, 3*dishEvStep(g)); }
function dishLongGapMs(g){ return Math.max(LONG_GAP_MS, 3*dishEvStep(g)); }
function trackStroke(g,client,t){
  const k=g.stroke, d=Math.hypot(client.x-k.pos.x,client.y-k.pos.y), gap=t-k.lastT;
  if(gap>1 && gap<70) g.dtAvg=g.dtAvg ? g.dtAvg*0.8+gap*0.2 : gap;
  if(d>=0.5){
    // Долгий разрыв — пауза при любом сдвиге: первое событие маха после паузы несёт целый кадр
    // быстрого движения (35–60 px), и по одной скорости «сдвиг / разрыв» пауза терялась — мах
    // «сдвинула, подержала, махнула» не переворачивал (ревью сборки 70).
    const idle=t-k.lastMoveT, paused=idle>dishPauseMs(g) && (d/idle*1000<DISH_STALL_CSS || idle>dishLongGapMs(g));
    if(k.start===null || paused){ k.start=Math.max(k.lastT,t-17); k.path=0; }
    k.path+=d; k.lastMoveT=t; k.pos={x:client.x,y:client.y};
  }
  k.lastT=t;
}
function moveDishGesture(p,client,time){
  const g=dishGesture; g.end=dishLocal(p);
  // Повела (складка, мах) — жест ведёт сам лист, поддетый угол уходит сразу.
  if(cornerLift && g.zone==="edge" && client && Math.hypot(client.x-g.client.x,client.y-g.client.y)>=TOUCH_SLOP_CSS) cornerLift=null;
  if(g.cutShift){ g.end={x:g.end.x-g.cutShift.x,y:g.end.y-g.cutShift.y}; }
  const t=Number.isFinite(time) ? time : performance.now();
  if(client){
    g.samples.push({x:client.x,y:client.y,t});
    if(g.samples.length>64) g.samples.shift();
    if(!g.moved && Math.hypot(client.x-g.client.x,client.y-g.client.y)>=TOUCH_SLOP_CSS){ g.moved=true; g.movedAt=t; }
    // Дрожание пальца в пределах мёртвой зоны штрих не начинает: иначе «подержи — махни» с
    // дрожащим пальцем давал штрих длиннее 300 мс и складку вместо переворота (ревью 17.09).
    if(g.stroke){ if(g.moved) trackStroke(g,client,t); else { g.stroke.pos={x:client.x,y:client.y}; g.stroke.lastT=t; } }
  } else { if(!g.moved) g.movedAt=t; g.moved=true; }   // вызов без экранных координат (проверки) — без мёртвой зоны
  if(g.zone==="serve"){                       // нарезанный роти в руке: идёт за пальцем на стойку
    if(g.moved && !g.carry){ g.carry=true; g.carryFrom={x:g.end.x,y:g.end.y}; dish.message=""; }
    if(g.carry) g.slide={x:g.end.x-g.carryFrom.x,y:g.end.y-g.carryFrom.y};
    if(g.carry && client) g.hand=toLocal(client.x,client.y-CARRY_ABOVE_CSS);   // роти висит над пальцем (dishShownPose)
    return;
  }
  if((g.zone==="middle" || g.zone==="edge") && !g.carry && g.foldSide>=0 && g.moved && client){
    const mid=g.zone==="middle";
    if(promoteToFold(g,client,t) && mid) trackStroke(g,client,t);
  }
  if(g.forced && foldPassed(g)) foldToCarry(g,t);
  if(g.zone==="middle"){
    // Сложенный роти взяли за середину и повели — он в руке и идёт за пальцем 1:1 (сборка 70).
    // Взять в руку — это повести сразу (первые CARRY_GRAB_MS); палец, который уже прижимал, должен
    // уйти заметно дальше: иначе прижим со сползанием на 12 px поднимал роти (ревью сборки 70).
    if(g.carry || (g.carryable && client && Math.hypot(client.x-g.client.x,client.y-g.client.y)>=(t-g.t0<=CARRY_GRAB_MS ? CARRY_SLOP_CSS : CARRY_SLOP_PRESS_CSS))){
      if(!g.carry){ g.carry=true; releasePress(g); g.carryFrom={x:g.end.x,y:g.end.y}; g.carryAt=t; audioPeel(); dish.message=tip("table","неси на стол и отпусти"); }
      g.slide={x:g.end.x-g.carryFrom.x,y:g.end.y-g.carryFrom.y};
      return;
    }
    // До схватывания быстрый сдвиг — место под щипок (#19), не след прижима.
    if(g.moved && !g.pinch && g.movedAt-g.t0<=PINCH_WINDOW_MS && meanDry()<.25){ g.pinch=true; releasePress(g); }
    if(!g.pinch){ g.press.x=g.end.x; g.press.y=g.end.y; }
    return;
  }
  if(g.moved) releasePress(g);               // сдвиг у кромки — складка или мах, прижим отпущен
  if(dish.mode==="fold"){
    if(!g.moved){ g.target=null; g.preview=null; return; }
    // Сохраняем смещение пальца от выбранной кромки, чтобы лист не прыгал к нему.
    g.target={x:g.anchor.x+g.end.x-g.start.x,y:g.anchor.y+g.end.y-g.start.y};
    // Штрих внутрь — складка при любой скорости (сборка 72), поэтому предпросмотр виден сразу: мах-переворот
    // идёт наружу или вбок и складку не показывает. У готового конверта быстрый штрих внутрь — тоже
    // переворот, и его первые 110 мс клапан не мелькает.
    const vNow=client ? velocityOf(g,t).speed : 0;
    if(vNow>=FOLD_FAST_CSS) g.fastSeen=true;
    const fresh=client && g.stroke && g.stroke.start!==null && t-g.stroke.start<FOLD_PREVIEW_DELAY_MS;
    // Готовый конверт больше не складывается (сборка 78): любой штрих от его края — мах или ничего.
    g.plan=envelopeDone() ? null : g.forced ? forcedFold(g) : foldCapped(foldPlan(g,!!g.fastSeen));
    g.preview=g.plan ? foldGeometry(g.plan.anchor,g.plan.target) : null;
    if(g.preview && dish.filling && dish.filling.length){
      const tok=scootFillings(dish.filling, g.preview.crease.nx, g.preview.crease.ny, g.preview.crease.offset, foldYank(g));
      clampFillings(tok, g.preview.faces);
      const dough=g.preview.faces.filter(f=>f.kind==="dough"), at=g.preview.slot;
      g.preview.faces=dough.slice(0,at).concat(tok.map(fillingDiskFace),dough.slice(at));   // под клапаном, как после отпускания
    }
    // Ведение от кромки НАРУЖУ больше ничего не двигает (сборка 70): снятие на стол — тот же
    // перенос в руке, что и со стола на таву (взять сложенный роти за середину), а штрих наружу
    // остаётся за махом-переворотом и со снятием больше не спорит.
  }
}
// Роти снят, если палец отпущен над рабочей частью стола за бортом тавы.
function slideEndsOnTable(client){
  const p=toLocal(client.x,client.y), w=zone("work");
  const onTable=p.x>=w.x && p.x<=w.x+w.w && p.y>=w.y && p.y<=w.y+w.h;
  return onTable && Math.hypot(p.x-panC.x,p.y-panC.y)>PAN_R*1.08;
}
const MOVE_T = 0.35;
function startRemoval(slide={x:0,y:0}){
  if(dishTwist) endTwist(false);
  if(!dish || dish.mode!=="fold" || dishFlight || dishMove || dishGesture) return false;
  const from=dishPose(); from.x+=slide.x*from.scale; from.y+=slide.y*from.scale;
  panPress=[]; popAllDomes();
  startCutting();
  if(dish.mode!=="cut") return false;
  dishMove={from,t0:performance.now(),T:MOVE_T};
  learn("table");
  dish.message=cutTip();
  syncDishUI();
  return true;
}
function updateDishMove(){
  if(!dishMove) return;
  const age=(performance.now()-dishMove.t0)/1000;
  if(age<dishMove.T) return;
  const quiet=dishMove.quiet;
  dishMove=null; if(!quiet && age<=MOVE_T+0.5) audioSlap(1.0);   // после возврата из фона — без шлепка
  syncDishUI();
}
// ─── Лоток и роти в руке (сборка 85; плейтест 17.11 п. 14, ревью сборки 79 п. 6)
// Нарезанный роти («нарезано», cutEnough) сам съезжает с доски на бумажный лоток у правого края стола: стол
// свободен, и видно, что роти готов. Лоток — плоский прямоугольник цвета бумаги по габариту роти с полем
// TRAY_PAD; он в координатах блюда, поэтому едет вместе с роти: в руке, к Сом, на стойку, псу. Съезд — тот же
// перелёт dishMove, только тихий и без подскока (quiet): не украшение, а смена места. Отменили рез, и
// «нарезано» пропало, — роти съезжает обратно на доску; вернули на таву — лоток остаётся на столе (его нет).
// В руке (несут наверх) роти нарисован в CARRY_SHOW своего размера и висит серединой на CARRY_ABOVE_CSS выше
// пальца: видно, куда несёшь. Отпускание по-прежнему судится по пальцу (eveningCounterHit, guestRefuses,
// nightDogHit берут точку касания), зоны Сом, стойки и пса не менялись. Числа стартовые.
const TRAY_PAD = 0.10, TRAY_SCALE = 0.85, TRAY_IN = 0.03, TRAY_T = 0.30;
const TRAY_PAPER = "#e8dcc2", TRAY_RIM = "#c9b48e";
const CARRY_SHOW = 0.60, CARRY_ABOVE_CSS = 40;
function trayRect(){
  const b=dish && dish.cutBounds; if(!b) return null;
  const p=TRAY_PAD*Math.max(b.right-b.left,b.bottom-b.top);
  return {left:b.left-p,right:b.right+p,top:b.top-p,bottom:b.bottom+p};
}
function syncTray(){
  if(!dish) return;
  const want=dish.mode==="cut" && !!dish.cutBounds && cutEnough();
  if(want===!!dish.tray) return;
  const from=dish.mode==="cut" && !dishMove ? dishShownPose() : null;
  dish.tray=want;
  if(from) dishMove={from,t0:performance.now(),T:TRAY_T,quiet:true};
}
// Поза, в которой роти нарисован сейчас: перелёт, рука (уменьшен и над пальцем), сдвиг на лопатке.
// Её же берёт drizzle.js, чтобы нить сгущёнки и варенья шла вместе с роти.
function dishShownPose(){
  const pose=dishPose(), g=dishGesture;
  if(dishMove){
    const u=Math.max(0,Math.min(1,(performance.now()-dishMove.t0)/1000/dishMove.T)), e=u*u*(3-2*u), f=dishMove.from;
    return {x:f.x+(pose.x-f.x)*e, y:f.y+(pose.y-f.y)*e-(dishMove.quiet ? 0 : Math.sin(Math.PI*u)*.25*pose.scale), scale:f.scale+(pose.scale-f.scale)*e};
  }
  if(!g || !g.slide) return pose;
  if(g.zone==="serve" && g.carry && g.hand && dish.cutCenter){
    const s=pose.scale*CARRY_SHOW, cc=dish.cutCenter;
    return {x:g.hand.x-cc.x*s, y:g.hand.y-cc.y*s, scale:s};
  }
  return {x:pose.x+g.slide.x*pose.scale, y:pose.y+g.slide.y*pose.scale-(g.carry ? .05*pose.scale : 0), scale:pose.scale};
}
window.dishShownPose = dishShownPose;
function drawTray(g,screen,sx){
  const T=trayRect(); if(!T) return;
  const q=[screen({x:T.left,y:T.top}),screen({x:T.right,y:T.top}),screen({x:T.right,y:T.bottom}),screen({x:T.left,y:T.bottom})];
  g.save(); g.fillStyle=TRAY_PAPER; g.strokeStyle=TRAY_RIM; g.lineWidth=Math.max(1,2*sx); g.lineJoin="round";
  g.beginPath(); q.forEach((p,i)=>i ? g.lineTo(p.x,p.y) : g.moveTo(p.x,p.y)); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
// Переворот на таве — тот же глагол «поднять и шлёпнуть»: коснуться края и резко махнуть
// (вариант A для пробы владелицы, #21). Удержание здесь не используется — оно закреплено
// за прижимом (решение 07.09). Скорость — регрессия по отсчётам в CSS px за последние
// 80 мс, чтобы исход не зависел от частоты событий (урок #91). Все пороги — для пробы.
// Сборка 78: у ГОТОВОГО конверта порог ниже (FLICK_ENV_CSS) — там мах ни с чем не спорит: складывать
// уже нечего, а с 850 px/с срабатывали 3 маха из 12 (плейтест 17.11). Мах чуть слабее порога (от
// FLICK_NEAR_CSS) виден: край приподнимается и падает обратно (dishFlight.almost) — «почти».
const FLICK_ENV_CSS = 575, FLICK_NEAR_CSS = 300, FLICK_ALMOST_T = 0.34, FLICK_ALMOST_U = 0.2;
function flickMin(){ return envelopeDone() ? FLICK_ENV_CSS : FLICK_MIN_CSS; }
const FLICK_MIN_CSS = 850, FLICK_MIN_PATH_CSS = 40, FLICK_MAX_MS = 300, FLICK_STALE_MS = 50, FLICK_WINDOW_MS = 80, FLICK_SPAN_MS = 25;
function velocityOf(g,tUp){
  const S=g.samples;
  // Окно 80 мс; если в него попало меньше двух отсчётов или они стоят вплотную (два события за
  // пару мс после пропущенных кадров), окно расширяется назад: наклон по двум почти одновременным
  // точкам с дрожанием ±1,5 px давал 1800 px/с на медленной складке (проверка в Node, сборка 70).
  let i=S.length; while(i>0 && S[i-1].t>=tUp-FLICK_WINDOW_MS) i--;
  while(i>0 && (S.length-i<2 || S[S.length-1].t-S[i].t<FLICK_SPAN_MS)) i--;
  const pts=S.slice(i);
  let vx=0, vy=0;
  if(pts.length>=2){
    const n=pts.length, mt=pts.reduce((a,q)=>a+q.t,0)/n, mx=pts.reduce((a,q)=>a+q.x,0)/n, my=pts.reduce((a,q)=>a+q.y,0)/n;
    let tt=0, tx=0, ty=0;
    for(const q of pts){ const dt=q.t-mt; tt+=dt*dt; tx+=dt*(q.x-mx); ty+=dt*(q.y-my); }
    if(tt>1e-9){ vx=tx/tt*1000; vy=ty/tt*1000; }
  }
  return {vx,vy,speed:Math.hypot(vx,vy)};
}
function flickOf(g,tUp){
  const {vx,vy,speed}=velocityOf(g,tUp), k=g.stroke;
  const path=k.path, duration=k.start===null ? 0 : tUp-k.start, stale=tUp-k.lastMoveT;
  const ok=speed>=flickMin() && path>=FLICK_MIN_PATH_CSS && duration<=FLICK_MAX_MS && stale<=dishStaleMs(g);
  return {ok,vx,vy,speed,duration,path,stale};
}
function logPanGesture(outcome,f,extra){
  gestures.push({ ...measurementContext(), kind:"pan", outcome, condition, ...(extra||{}), speed:Math.round(f.speed),
    duration_ms:Math.round(f.duration), path_css:Math.round(f.path), stale_ms:Math.round(f.stale),
    folds:dish.folds, flips:dish.flips||0, ts:new Date().toISOString() });
  if(gestures.length>200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
}
function pressExtra(g,tUp){
  const p=g.press;
  return {zone:g.zone||"edge", pause_ms:Math.round(((g.stroke&&g.stroke.start!==null ? g.stroke.start : (g.movedAt ?? tUp))-g.t0)||0),
    latched:!!g.latched, press_ms:p ? Math.round(Math.max(0,tUp-p.since)) : 0};
}
function endDishGesture(time){
  const g=dishGesture; dishGesture=null;
  if(cornerLift && cornerLift.up===null) cornerLift.up=performance.now();   // отпустила — угол ложится
  const tUp=Number.isFinite(time) ? time : performance.now();
  releasePress(g);
  if(g.forced && dish.folds && slideEndsOnTable(g.samples[g.samples.length-1])) foldToCarry(g,tUp);   // сгиб кончился над столом — это был перенос
  if(g.zone==="middle" && g.carry){
    // Отпустила роти из руки: над столом за бортом тавы — перелёт на стол (к нарезке), иначе обратно на таву.
    const last=g.samples[g.samples.length-1], extra=pressExtra(g,tUp);
    const f={speed:0,duration:tUp-(g.carryAt||g.t0),path:Math.hypot(last.x-g.client.x,last.y-g.client.y),stale:0};
    if(slideEndsOnTable(last)){
      // Для замера «когда снимать» (#14): цвет прижатой и видимой стороны в момент снятия.
      const at={bottomCook:+meanCook().toFixed(3), topCook:+dishSideMean("cook","topWeights").toFixed(3),
        panSeconds:Math.round(dish.panTime||0)};
      logPanGesture(startRemoval(g.slide) ? "remove" : "carry-refused",f,{...extra,carry:true,...at});
    } else {
      dishBack={slide:g.slide,t0:performance.now()};
      logPanGesture("carry-back",f,{...extra,carry:true}); dishNote("неси дальше — на стол");
    }
    return;
  }
  if(g.zone==="serve"){
    // Отпустила над стойкой — роти подан (журнал serve, как у прежней кнопки «подать»), стол свободен;
    // иначе роти остаётся на столе, где лежал.
    const last=g.samples[g.samples.length-1];
    const f={speed:0,duration:tUp-g.t0,path:Math.hypot(last.x-g.client.x,last.y-g.client.y),stale:0};
    const over=g.carry && typeof eveningCounterHit==="function" && eveningCounterHit(last);
    // Над тавой — снова жарится, при любом числе резов и вовсе без них. Над стойкой недорезанный не подаётся.
    const lp=toLocal(last.x,last.y), enough=cutEnough();
    // Гостья сырой роти не берёт (guest.js, сборка 78): он остаётся на столе, вечер его не считает.
    if(over && typeof guestRefuses==="function" && guestRefuses(last)){
      logPanGesture("serve-refused",f,{zone:"serve",carry:true}); dishNote("сырое — верни на таву"); return;
    }
    // Отпустила над тавой — роти снова жарится (ревью партии «жарка», 17.11: отказ гостьи был тупиком,
    // сырой роти шёл только на стойку и считался в «три роти»). Только в середину тавы: недонесённый до
    // стойки роти у борта остаётся на столе, как раньше.
    if(g.carry && !over && Math.hypot(lp.x-panC.x,lp.y-panC.y)<=PAN_R*PAN_BACK_R && returnToPan()){
      logPanGesture("pan-back",f,{zone:"serve",carry:true}); return;   // сборка 88: без строки — роти сам на таве
    }
    if(over && serveDish()){ learn("serve"); logPanGesture("serve-carry",f,{zone:"serve",carry:true}); eveningServed(); }
    else if(g.carry){ logPanGesture("serve-back",f,{zone:"serve",carry:true}); if(enough || !somSaysRaw()) dishNote(enough ? "неси дальше" : "режь от края до края"); }
    return;
  }
  if(g.zone==="middle"){
    // Несложенный лист с тавы не снимается: повела из середины на стол — говорим, что сначала.
    const L=g.samples[g.samples.length-1];
    if(!dish.folds && dish.mode==="fold" && g.moved && slideEndsOnTable(L)) dishNote("сначала заверни края");
    logPanGesture(g.pinch ? "pinch" : "press",{speed:0,duration:tUp-g.t0,path:0,stale:0},pressExtra(g,tUp));
    return;
  }
  if(dish.mode!=="fold"){
    // Конец штриха в нарисованной щели продлевается до выхода из материала (там же, по направлению).
    let end=g.end;
    if(g.cutShift && !onMaterial(end)){
      const dx=end.x-g.start.x, dy=end.y-g.start.y, l=Math.hypot(dx,dy);
      if(l>1e-6) end={x:end.x+dx/l*PIECE_SPREAD*2.5,y:end.y+dy/l*PIECE_SPREAD*2.5};
    }
    // Сборка 88: не засчитанный штрих не пишет строку — его линия гаснет за CUT_FADE_S (тесто не разошлось).
    if(!cutDish(g.start,end) && g.moved) cutFade={a:g.start,b:end,o:g.cutShift||{x:0,y:0},t0:performance.now()};
    return;
  }
  const last=g.samples[g.samples.length-1], f=flickOf(g,tUp), extra=pressExtra(g,tUp);
  if(g.press && !g.moved){ logPanGesture("press",f,extra); return; }
  // Сборка 72: штрих ВНУТРЬ листа — складка при любой скорости (быстрая складка 100–130 px за
  // 100–200 мс превышала порог маха и переворачивала лист: 8 из 19, runs/fix91-diagnosis). Переворот —
  // мах наружу или вбок. У готового конверта (четыре стороны завёрнуты) складывать нечего, и там
  // быстрый мах от края переворачивает в любую сторону.
  const inward=(!!g.target && inwardFold(g)) || !!forcedFold(g);
  if(f.ok && !(inward && !envelopeDone())){
    // Лист уходит по направлению маха: направление переводим из экрана в координаты блюда.
    const a=dishLocal(toLocal(last.x-f.vx*.05,last.y-f.vy*.05)), b=dishLocal(toLocal(last.x,last.y));
    const len=Math.hypot(b.x-a.x,b.y-a.y);
    if(len>1e-9){
      const d={x:(b.x-a.x)/len,y:(b.y-a.y)/len};
      const reach=.15*Math.max(0,Math.min(1,(f.speed-flickMin())/1650));   // по хвосту маха, inferred
      const ok=startFlip(d,{x:d.x*reach,y:d.y*reach});
      logPanGesture(ok ? "flip" : "flip-refused",f,extra);
      if(ok) return;
    }
  }
  if(envelopeDone()){
    // Готовый конверт: пятой складки нет (быстрый штрих внутрь на 726 px/с давал «Складок: 5», плейтест
    // 17.11). Мах не дотянул до порога — «почти»: край приподнялся и упал. Совет «на стол» — только
    // медленному ведению от края на стол, не сразу после неудачного маха.
    if(g.moved && !f.ok && f.speed>=FLICK_NEAR_CSS && f.path>=FLICK_MIN_PATH_CSS*.5){
      const a=dishLocal(toLocal(last.x-f.vx*.05,last.y-f.vy*.05)), b=dishLocal(toLocal(last.x,last.y)), len=Math.hypot(b.x-a.x,b.y-a.y);
      if(len>1e-9 && startAlmostFlip({x:(b.x-a.x)/len,y:(b.y-a.y)/len})){ logPanGesture("flip-almost",f,extra); return; }
    }
    if(g.moved && f.speed<FLICK_NEAR_CSS && slideEndsOnTable(last)) dishNote("на стол — бери за середину");
    logPanGesture("none",f,extra); return;
  }
  const plan=forcedFold(g) || foldCapped(foldPlan(g, !!g.fastSeen || (f.speed>=FOLD_FAST_CSS && f.stale<=dishStaleMs(g))));
  const ok=!!plan && foldDish(plan.anchor,plan.target,foldYank(g),plan.side);
  if(ok){ extra.snap=plan.side>=0; extra.side=plan.side; extra.env=envDoneCount(); if(g.forced) extra.outerThird=true; audioScrape(); }
  // Повела от кромки на стол — прежний жест снятия: подсказываем новый (взять за середину).
  if(!ok && g.moved && slideEndsOnTable(last)) dishNote(dish.folds ? "на стол — бери за середину" : "сначала заверни края");
  logPanGesture(ok ? "fold" : "none",f,extra);
}
// Section geometry belongs to a material snapshot, not to its screen size or heat.
// A boundary exists only where dough ends. Shared mesh diagonals never get walls.
function dishSectionGeometry(faces, cuts=dish.cuts){
  const cache=dishSectionGeometry.cache||(dishSectionGeometry.cache=new WeakMap());
  if(cache.has(faces)) return cache.get(faces);
  const entries=faces.map((face,id)=>{
    const xs=face.points.map(p=>p.x),ys=face.points.map(p=>p.y);
    return {face,id,left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
  });
  const bounds={left:Math.min(...entries.map(e=>e.left)),right:Math.max(...entries.map(e=>e.right)),
    top:Math.min(...entries.map(e=>e.top)),bottom:Math.max(...entries.map(e=>e.bottom))};
  const cell=Math.max(.025,Math.max(bounds.right-bounds.left,bounds.bottom-bounds.top)/24),grid=new Map();
  const cellX=x=>Math.floor((x-bounds.left)/cell),cellY=y=>Math.floor((y-bounds.top)/cell);
  for(const e of entries) for(let y=cellY(e.top);y<=cellY(e.bottom);y++) for(let x=cellX(e.left);x<=cellX(e.right);x++){
    const key=x+":"+y; if(!grid.has(key)) grid.set(key,[]); grid.get(key).push(e);
  }
  function nearby(left,top,right,bottom){
    const found=new Set();
    for(let y=cellY(top);y<=cellY(bottom);y++) for(let x=cellX(left);x<=cellX(right);x++){
      for(const e of grid.get(x+":"+y)||[]) if(e.right>=left&&e.left<=right&&e.bottom>=top&&e.top<=bottom) found.add(e);
    }
    return [...found];
  }
  function stackAt(x,y){
    // Do not merge equal source/turned IDs: folding can put two different parts
    // of one original cell above each other. Interior samples avoid triangle edges.
    return nearby(x,y,x,y).filter(e=>pointInFace(e.face.points,x,y)).sort((a,b)=>a.id-b.id).map(e=>e.face);
  }
  function onCut(p){
    return cuts.some(c=>{
      const dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,len=Math.hypot(dx,dy);
      const along=((p.x-c.a.x)*dx+(p.y-c.a.y)*dy)/len;
      const across=((p.x-c.a.x)*-dy+(p.y-c.a.y)*dx)/len;
      return along>=-1e-6&&along<=len+1e-6&&Math.abs(across)<=c.width/2+1e-6 &&
        (Math.abs(Math.abs(across)-c.width/2)<1e-6||Math.abs(along)<1e-6||Math.abs(along-len)<1e-6);
    });
  }
  const pointKey=p=>Math.round(p.x*1e8)+","+Math.round(p.y*1e8);
  const edgeKey=(a,b)=>{const ak=pointKey(a),bk=pointKey(b);return ak<bk?ak+"/"+bk:bk+"/"+ak;};
  // Exact paired mesh edges have dough on both sides along their entire length.
  // Remove those before the more expensive crossing/T-junction work.
  const paired=new Map();
  for(const e of entries){
    if(e.face.kind!=="dough") continue;
    const ps=e.face.points,orientation=Math.sign(ps.reduce((s,p,i)=>{const q=ps[(i+1)%ps.length];return s+p.x*q.y-q.x*p.y;},0));
    for(let j=0;j<ps.length;j++){
      const a=ps[j],b=ps[(j+1)%ps.length],key=edgeKey(a,b),side=orientation*(pointKey(a)<pointKey(b)?1:-1)>0?1:2;
      paired.set(key,(paired.get(key)||0)|side);
    }
  }
  const walls=[],seen=new Set(),cross=(x,y,u,v)=>x*v-y*u;
  for(const e of entries){
    if(e.face.kind!=="dough") continue;
    const points=e.face.points;
    for(let j=0;j<points.length;j++){
      const a=points[j],b=points[(j+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
      if(len<1e-8||paired.get(edgeKey(a,b))===3) continue;
      const breaks=[0,1],candidates=nearby(Math.min(a.x,b.x)-1e-7,Math.min(a.y,b.y)-1e-7,Math.max(a.x,b.x)+1e-7,Math.max(a.y,b.y)+1e-7);
      // Split at crossings AND collinear endpoints. Cuts produce T junctions;
      // comparing whole triangle edges would leave false seams at those junctions.
      for(const other of candidates){
        const ps=other.face.points;
        for(let k=0;k<ps.length;k++){
          const c=ps[k],d=ps[(k+1)%ps.length],ex=d.x-c.x,ey=d.y-c.y,den=cross(dx,dy,ex,ey);
          if(Math.abs(den)>1e-12){
            const t=cross(c.x-a.x,c.y-a.y,ex,ey)/den,u=cross(c.x-a.x,c.y-a.y,dx,dy)/den;
            if(t>1e-8&&t<1-1e-8&&u>=-1e-8&&u<=1+1e-8) breaks.push(t);
          } else if(Math.abs(cross(c.x-a.x,c.y-a.y,dx,dy))<1e-9*len){
            for(const p of [c,d]){const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(len*len);if(t>1e-8&&t<1-1e-8) breaks.push(t);}
          }
        }
      }
      breaks.sort((a,b)=>a-b);
      for(let k=1;k<breaks.length;k++){
        const lo=breaks[k-1],hi=breaks[k];if((hi-lo)*len<1e-7) continue;
        const p={x:a.x+dx*lo,y:a.y+dy*lo},q={x:a.x+dx*hi,y:a.y+dy*hi};
        const keyPoint=p=>Math.round(p.x*1e7)+","+Math.round(p.y*1e7),pk=keyPoint(p),qk=keyPoint(q),key=pk<qk?pk+"/"+qk:qk+"/"+pk;
        if(seen.has(key)) continue;seen.add(key);
        const mid={x:(p.x+q.x)/2,y:(p.y+q.y)/2},nx=-dy/len,ny=dx/len,eps=Math.min(1e-5,(hi-lo)*len*.001);
        const left=stackAt(mid.x+nx*eps,mid.y+ny*eps),right=stackAt(mid.x-nx*eps,mid.y-ny*eps);
        const hasLeft=left.some(f=>f.kind==="dough"),hasRight=right.some(f=>f.kind==="dough");
        if(hasLeft===hasRight) continue;
        walls.push({a:p,b:q,inward:{x:hasLeft?nx:-nx,y:hasLeft?ny:-ny},stack:hasLeft?left:right,cut:onCut(mid)});
      }
    }
  }
  const result={walls,stackAt,bounds};cache.set(faces,result);return result;
}
// Куски на столе чуть раздвинуты — условность отрисовки (владелица 17.09: после «одного
// конверта» резы не читались: гладкий верх шёл поверх узкой щели ножа). Кусок — связная часть
// теста (грани с общими рёбрами; складка связывает слои, пропил ножа — разделяет); надрез, не
// разделивший тесто, ничего не двигает. Каждый кусок отодвигается от центра блюда на PIECE_SPREAD.
// Материал, резы и торцы считаются по настоящей геометрии (ревью 17.09: прежнее деление по
// бесконечной прямой реза рвало целый кусок при резе «Т»). Сдвиг — поперёк каждого реза, который
// кусок действительно отделил (dishPieceShift).
const PIECE_SPREAD = 0.013;   // владелица 17.09: 0,045 — «очень широкая щель»; сборка 88 (спека «видимый жест»):
                              // 0,022 раздвигал куски на 4,4 CSS px (390×844), нужно 2–3 — 0,013 даёт ≈ 2,6
function dishPieces(faces){
  const cache=dishPieces.cache||(dishPieces.cache=new WeakMap());
  if(cache.has(faces)) return cache.get(faces);
  const parent=faces.map((_,i)=>i);
  const find=i=>{ while(parent[i]!==i){ parent[i]=parent[parent[i]]; i=parent[i]; } return i; };
  const unite=(a,b)=>{ a=find(a); b=find(b); if(a!==b) parent[a]=b; };
  // 1e5, не 1e7: после клипа реза общие вершины расходятся на 1e-6, и один кусок
  // распадался на крошки, которые не ехали со своими.
  const key=p=>Math.round(p.x*1e5)+","+Math.round(p.y*1e5);
  const edges=new Map();
  const doughIdx=[];
  faces.forEach((f,i)=>{
    if(f.kind!=="dough") return;
    doughIdx.push(i);
    const ps=f.points;
    for(let j=0;j<ps.length;j++){
      const a=key(ps[j]), b=key(ps[(j+1)%ps.length]), k=a<b ? a+"/"+b : b+"/"+a;
      const o=edges.get(k); if(o===undefined) edges.set(k,i); else unite(i,o);
    }
  });
  // Слои конверта занимают одно место на столе и не делят ребро — только перекрытие.
  // Щель реза их уже развела, поэтому два берега не склеятся.
  const cents=new Array(faces.length), bb=new Array(faces.length);
  const cell=0.06, grid=new Map();
  const gkey=(x,y)=>((x/cell)|0)+","+((y/cell)|0);
  for(const i of doughIdx){
    const ps=faces[i].points; let cx=0,cy=0,x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const p of ps){ cx+=p.x; cy+=p.y; if(p.x<x0)x0=p.x; if(p.x>x1)x1=p.x; if(p.y<y0)y0=p.y; if(p.y>y1)y1=p.y; }
    cents[i]={x:cx/ps.length,y:cy/ps.length}; bb[i]={x0,x1,y0,y1};
    const k=gkey(cents[i].x,cents[i].y), b=grid.get(k); if(b) b.push(i); else grid.set(k,[i]);
  }
  for(const i of doughIdx){
    const c=cents[i], gx=(c.x/cell)|0, gy=(c.y/cell)|0;
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){
      const bucket=grid.get((gx+dx)+","+(gy+dy)); if(!bucket) continue;
      for(const j of bucket){
        if(j<=i || find(i)===find(j)) continue;
        if(pointInFace(faces[j].points,c.x,c.y)||pointInFace(faces[i].points,cents[j].x,cents[j].y))
          unite(i,j);
      }
    }
  }
  const piece=new Array(faces.length).fill(-1);
  faces.forEach((f,i)=>{ if(f.kind==="dough") piece[i]=find(i); });
  // Начинка едет с тестом, на котором лежит. Центр осколка часто падает в щель реза —
  // тогда кусок банана оставался на столе, а тесто уезжало.
  faces.forEach((f,i)=>{
    if(f.kind==="dough") return;
    const ps=f.points; let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const p of ps){ if(p.x<x0)x0=p.x; if(p.x>x1)x1=p.x; if(p.y<y0)y0=p.y; if(p.y>y1)y1=p.y; }
    const votes=new Map();
    const gx=( (x0+x1)/2/cell )|0, gy=( (y0+y1)/2/cell )|0;
    for(let dx=-2;dx<=2;dx++) for(let dy=-2;dy<=2;dy++){
      const bucket=grid.get((gx+dx)+","+(gy+dy)); if(!bucket) continue;
      for(const j of bucket){
        const b=bb[j]; if(x1<b.x0||x0>b.x1||y1<b.y0||y0>b.y1) continue;
        let n=0; for(const p of ps) if(pointInFace(faces[j].points,p.x,p.y)) n++;
        if(n) votes.set(piece[j], (votes.get(piece[j])||0)+n);
      }
    }
    let best=-1, n=0;
    for(const [id,c] of votes) if(c>n){ n=c; best=id; }
    if(best<0){
      let cx=0,cy=0; for(const p of ps){ cx+=p.x; cy+=p.y; }
      cx/=ps.length; cy/=ps.length;
      let bd=Infinity;
      for(const j of doughIdx){
        const d=Math.hypot(cents[j].x-cx,cents[j].y-cy);
        if(d<bd){ bd=d; best=piece[j]; }
      }
    }
    piece[i]=best;
  });
  cache.set(faces,piece); return piece;
}
function dishPieceShift(faces){
  if(!dish || !dish.cuts.length) return null;
  const cache=dishPieceShift.cache||(dishPieceShift.cache=new WeakMap());
  if(cache.has(faces)) return cache.get(faces);
  // Кусок отходит поперёк каждого реза, который его отделил: он касается пропила только с одной
  // стороны. Кусок, обходящий конец надреза, касается обеих сторон — этот рез его не двигает.
  // (Проба 17.09: сдвиг «от центра блюда» не раскрывал рез между кусками по одну сторону центра.)
  const piece=dishPieces(faces), touch=new Map();
  dish.cuts.forEach((c,ci)=>{
    const dx=c.b.x-c.a.x, dy=c.b.y-c.a.y, len=Math.hypot(dx,dy)||1, ux=dx/len, uy=dy/len;
    faces.forEach((f,i)=>{
      if(f.kind!=="dough") return;
      for(const p of f.points){
        const along=(p.x-c.a.x)*ux+(p.y-c.a.y)*uy, across=(p.x-c.a.x)*-uy+(p.y-c.a.y)*ux;
        if(along<-1e-4 || along>len+1e-4 || Math.abs(Math.abs(across)-c.width/2)>c.width*0.35) continue;
        let m=touch.get(piece[i]); if(!m) touch.set(piece[i],m=new Map());
        m.set(ci,(m.get(ci)||0)|(across>0 ? 1 : 2));
      }
    });
  });
  const dir=new Map(); let any=false;
  for(const [k,m] of touch){
    let x=0,y=0;
    for(const [ci,mask] of m){
      if(mask===3) continue;
      const c=dish.cuts[ci], len=Math.hypot(c.b.x-c.a.x,c.b.y-c.a.y)||1, nx=-(c.b.y-c.a.y)/len, ny=(c.b.x-c.a.x)/len, side=mask===1 ? 1 : -1;
      x+=side*PIECE_SPREAD*nx; y+=side*PIECE_SPREAD*ny;
    }
    if(x||y) any=true;
    dir.set(k,{x,y});
  }
  let out=null;
  if(any){ out=new Map(); faces.forEach((f,i)=>out.set(f,dir.get(piece[i])||{x:0,y:0})); }
  cache.set(faces,out); return out;
}
// Сборка 90: щели одной ширины. Вглубь стола щель (пропил + два сдвига) на экране сжата наклоном в TILT раз, и
// поперечные резы (щель по x, в ней ещё тень куска) читались втрое шире продольного: снимок 390×844 — 11 против
// 3 px устройства. Сдвиг по x уменьшен так, чтобы пропил и два сдвига по x на экране равнялись тем же по y:
// w + 2·kx·s = TILT·(w + 2·s). Порог G2 (рез поперёк y раздвигает на 2–3 CSS px) не тронут.
function spreadKX(){
  const w=dish && dish.cuts.length && dish.cuts[0].width || .018;
  return Math.max(0,TILT-(1-TILT)*w/(2*PIECE_SPREAD));
}
// Живой сдвиг кусков: обычная щель, умноженная на разведение пальцами.
function pieceShiftLive(faces){
  const base=dishPieceShift(faces);
  if(!base) return base;
  const c=pieceShiftLive.c, kx=spreadKX();
  if(c && c.faces===faces && c.k===dishSpread && c.base===base && c.kx===kx) return c.m;
  // Вглубь стола движение сжато наклоном (TILT): доля сверх обычной щели по y делится на TILT, и щели
  // расходятся поровну на экране. Обычная щель по x — с множителем spreadKX, доля сверх неё — прежняя.
  const ky=1+(dishSpread-1)/TILT, kxs=kx+dishSpread-1;
  const m=new Map();
  for(const [f,o] of base) m.set(f,{x:o.x*kxs,y:o.y*ky});
  pieceShiftLive.c={faces,base,k:dishSpread,kx,m}; return m;
}
function canSpread(){ return !!dish && dish.mode==="cut" && dish.cuts.length>0 && !dishFlight && !dishMove; }
function spreadTo(k){ dishSpread=Math.max(1,Math.min(SPREAD_MAX,k)); }
// Точка жеста на столе → точка материала: из нарисованного (сдвинутого) куска под пальцем.
function unshiftCutPoint(p){
  const shift=pieceShiftLive(dish.faces); if(!shift) return {p,o:{x:0,y:0}};
  for(const f of dish.faces){
    if(f.kind!=="dough") continue;
    const o=shift.get(f);
    if(pointInFace(f.points,p.x-o.x,p.y-o.y)) return {p:{x:p.x-o.x,y:p.y-o.y},o};
  }
  return null;
}
function drawDishSections(g,screen,faces,sx,sy,zk=0,H=null){
  const sections=dishSectionGeometry(faces),pixel=Math.min(2,devicePixelRatio||1)*Math.min(sx,sy);
  const shift=pieceShiftLive(faces);
  if(shift){ const base=screen; screen=(p,f)=>{ const o=f && shift.get(f); return base(o ? {x:p.x+o.x,y:p.y+o.y} : p); }; }
  const unit=Math.max(.55,1.7*pixel);
  // Magnified cross sections sit just INSIDE their real material edge. Otherwise
  // a .018 kerf on a phone hides every layer behind its neighbouring piece. This
  // is a drawing convention: neither the cut width nor any material is moved.
  g.save();g.globalAlpha=1;
  // Контур обрезки — объединение тысяч граней; строить его каждый кадр стоило ~7 мс (#20).
  // Пока поза, масштаб и раздвижка кусков те же, он хранится готовым (Path2D).
  const build=path=>{
    for(const f of faces){
      if(f.kind!=="dough") continue;
      const signed=f.points.reduce((s,p,i)=>{const q=f.points[(i+1)%f.points.length];return s+p.x*q.y-q.x*p.y;},0);
      const ps=signed<0?f.points.slice().reverse():f.points;
      const a=screen(ps[0],f);path.moveTo(a.x,a.y);
      // без closePath: заливка и обрезка сами замыкают контур, а closePath делал сборку пути квадратичной (поворот на таве — 39 кадров/с)
      for(let i=1;i<ps.length;i++){const p=screen(ps[i],f);path.lineTo(p.x,p.y);}
    }
  };
  if(typeof Path2D==="function"){
    const o=screen({x:0,y:0}), e=screen({x:1,y:1});
    const key=[o.x,o.y,e.x,e.y].map(v=>v.toFixed(2)).join(",");
    const cache=drawDishSections.clips||(drawDishSections.clips=new WeakMap());
    let hit=cache.get(faces);
    if(!hit || hit.key!==key || hit.shift!==shift){ const path=new Path2D(); build(path); hit={key,shift,path}; cache.set(faces,hit); }
    g.clip(hit.path);
  } else { g.beginPath(); build(g); g.clip(); }
  // Торец рисуется только там, где тесто кончается целиком (внешний край, разрез): кромка клапана
  // внутри конверта лежит под сплошной «подушкой» и торцом не видна (17.09: жёлтые пятна на кусках).
  const outer=w=>{
    if(w.outer===undefined){
      const mid={x:(w.a.x+w.b.x)/2,y:(w.a.y+w.b.y)/2};
      w.outer=!onMaterial({x:mid.x-w.inward.x*.012,y:mid.y-w.inward.y*.012});
    }
    return w.outer;
  };
  // Дыра внутри конверта (снаружи от кромки — всё ещё внутри его оболочки) стенки не получает:
  // на скомканном рваном листе такие стенки стояли белыми столбиками поверх теста (17.09).
  const hull=dish.hull||[];
  const insideHull=p=>hull.length>2 && pointInFace(hull,p.x,p.y);
  const hole=w=>{ const mid={x:(w.a.x+w.b.x)/2,y:(w.a.y+w.b.y)/2}; return insideHull({x:mid.x-w.inward.x*.06,y:mid.y-w.inward.y*.06}); };
  const walls=sections.walls.filter(w=>!zk || w.cut || (outer(w) && !hole(w))).map(w=>{
    const own=w.stack[0];   // стенка принадлежит куску своей стопки
    const a=screen(w.a,own),b=screen(w.b,own),mid={x:(w.a.x+w.b.x)/2,y:(w.a.y+w.b.y)/2};
    const m=screen(mid,own),n=screen({x:mid.x+w.inward.x*.001,y:mid.y+w.inward.y*.001},own);
    const l=Math.hypot(n.x-m.x,n.y-m.y)||1;
    // В объёмном виде верх поднят строго вверх, поэтому и стенка — вертикальная полоса у кромки,
    // обращённой к зрителю; боковые кромки видны ребром и не рисуются.
    return zk ? {w,a,b,nx:0,ny:-1,face:-(n.y-m.y)/l} : {w,a,b,nx:(n.x-m.x)/l,ny:(n.y-m.y)/l};
  }).filter(s=>zk ? s.face>.35 : -(s.nx*.4+s.ny)>.06).sort((a,b)=>(a.a.y+a.b.y)-(b.a.y+b.b.y));
  for(const s of walls){
    const {w,a,b,nx,ny}=s;
    if(!w.cut&&w.stack.length<2) continue; // no artificial thick rim around a bare sheet
    // Высоты полос — настоящие толщины слоёв в этой точке (мм × zk); тонкому тесту даём
    // хотя бы unit, иначе в виде A корочки не видно. Без zk — прежняя условная шкала.
    // Со сглаженной поверхностью конверта стенка доходит ровно до её края, а слои делят
    // эту высоту в своей настоящей пропорции.
    const mid={x:(w.a.x+w.b.x)/2,y:(w.a.y+w.b.y)/2};
    // Полосы делят ровно высоту нарисованной поверхности у края: срез не вылезает на верх куска
    // (17.09: жёлтые прямоугольники поверх кусков). Начинке — не меньше трети высоты.
    const raw=w.stack.map(f=>Math.max(f.kind==="filling" ? .8 : .25, layerMM(f,mid)));
    const weights=zk ? raw : w.stack.map(f=>f.kind==="filling"?1.65:1);
    const sum=weights.reduce((a,b)=>a+b,0);
    const surfPx=zk ? (H ? H.at(mid)*zk : raw.reduce((a,b)=>a+b,0)*zk) : 0;
    // минимум на слой не поднимает срез выше нарисованного верха больше чем на полпикселя
    const height=zk ? Math.min(Math.max(unit*w.stack.length*.6,surfPx),surfPx+.5) : Math.min(Math.max(3,14*pixel),unit*sum), step=height/sum;
    const band=(from,to,color)=>{
      g.fillStyle=rgb(color);g.beginPath();
      g.moveTo(a.x+nx*from,a.y+ny*from);g.lineTo(b.x+nx*from,b.y+ny*from);
      g.lineTo(b.x+nx*to,b.y+ny*to);g.lineTo(a.x+nx*to,a.y+ny*to);g.closePath();g.fill();
    };
    let bottom=0;
    for(let i=0;i<w.stack.length;i++){
      const f=w.stack[i],top=bottom+weights[i]*step;
      // Начинка в торце — только на разрезе ножом; у рваного края дыры торец теста (17.09: оранжевые
      // бруски по краям разрывов).
      // Сборка 91 (ревью 18.11, п. 3: «толстая книга с белым основанием»): у сгиба и внешней кромки мякиша не
      // видно — слои там корочка в тени стенки (×WALL_CRUST_K); светлый мякиш и блик кромки — только у реза ножом.
      if(f.kind==="filling" && !w.cut){ band(bottom,top,dishCookColor(w.stack[0],1,false).map(c=>Math.round(c*WALL_CRUST_K))); bottom=top; continue; }
      if(f.kind==="filling"){
        if(f.fill==="egg"){
          band(bottom,top,EGG_SECTION);
          bottom=top; continue;
        }
        band(bottom,top,SECTION_FILL);
        const L=Math.hypot(b.x-a.x,b.y-a.y), n=Math.floor(L/Math.max(6,10*pixel)), hh=(top-bottom)*.32;
        g.fillStyle=rgb(BANANA_FLESH[0]);
        for(let k=0;k<n;k++){
          const t=(k+.5+(f.source%3)*.2)/n, cx=a.x+(b.x-a.x)*t+nx*(bottom+top)/2, cy=a.y+(b.y-a.y)*t+ny*(bottom+top)/2;
          g.beginPath(); g.ellipse(cx,cy,Math.max(1,L/n*.32),Math.max(.6,hh),Math.atan2(b.y-a.y,b.x-a.x),0,Math.PI*2); g.fill();
        }
        bottom=top; continue;
      }
      // Мякиш светлее корочек. Корочки — настоящие стороны слоя: снизу та, что смотрит
      // вниз, сверху — та, что вверх; у каждой свой цвет (в виде A слой ~0,5 px — не разглядеть).
      // Нижний слой на таве показывает свою корочку широкой полосой: по кромке видно, как
      // румянится низ (владелица 17.09: жарку снизу не было видно).
      const down=f.turned ? 1 : 0, crust=i===0 && phase==="PAN" ? (top-bottom)*.55 : Math.min((top-bottom)*.3,Math.max(.5,1.2*pixel));
      const crumb=dishCookColor(f,down,false).map((c,k)=>(c+dishCookColor(f,1-down,false)[k])/2);
      const shade=w.cut ? 1 : WALL_CRUST_K, sh=c=>c.map(v=>Math.round(v*shade));
      band(bottom,top,w.cut ? crumb.map(c=>Math.round(c*.7+62)) : sh(crumb));   // мякиш светлее — жёлтая начинка читается рядом
      band(bottom,bottom+crust,sh(dishCookColor(f,down,false)));
      band(top-crust,top,sh(dishCookColor(f,1-down,false)));
      bottom=top;
    }
    // Only the actual outer lips are stroked; never a triangle or a filling tile.
    g.strokeStyle="rgba(64,34,16,.72)";g.lineWidth=Math.max(.35,.7*pixel);
    g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();
    if(!w.cut) continue;
    g.strokeStyle="rgba(255,232,171,.6)";g.lineWidth=Math.max(.3,.65*pixel);
    g.beginPath();g.moveTo(a.x+nx*height,a.y+ny*height);g.lineTo(b.x+nx*height,b.y+ny*height);g.stroke();
  }
  g.restore();
}
// ─── Вид толщины (решение владелицы 16.09). Условности отрисовки, не физика:
// высота на экране преувеличена в Z_EXAG раз, мм переводятся в доли роти через ROTI_R_MM.
const ROTI_R_MM = 110;   // радиус роти ≈ 11 см (inferred): 1 targetR ≈ 110 мм
// ×5 (сборка 24) дал куски-кубики: конверт в 6 мм выглядел на 13–25 мм (владелица 17.09, вечер).
// Высоту можно подобрать адресом: ?z=1…8.
// Сборка 91 (ревью 18.11, п. 3: сложенный роти — «толстая книга»): ×1 — конверт вдвое тоньше. Свет, кромка,
// тень и корки считаются по Z_RELIEF (RELIEF_K = Z_RELIEF/Z_EXAG) и от этого не меняются — меняется только высота.
const Z_EXAG_DEFAULT = 1;
const Z_RELIEF = 5;      // высота, под которую подобраны свет, кромка, тень и корки
// Высота ×2 — решение владелицы 19.09: крупнее ×2 смотрится плохо, крутилку убрали.
let Z_EXAG = Z_EXAG_DEFAULT;
let RELIEF_K = Z_RELIEF / Z_EXAG;   // во сколько раз картинка выразительнее геометрии
function setHeight(z){
  if(!(z>=1 && z<=8) || z===Z_EXAG) return;
  Z_EXAG=z; RELIEF_K=Z_RELIEF/z;
  try { localStorage.setItem("rotiZ",String(z)); } catch(e) {}
  drawDishTable.cache=null; drawDishTable.lru=[]; tableBlit.shown=null;
  if(typeof document!=="undefined") document.querySelectorAll("[data-z]").forEach(x=>x.classList.toggle("on",+x.dataset.z===z));
  draw();
}
let VIEW_UP = 0.83;      // вертикаль в кадре при наклоне стола, ≈ √(1 − TILT²)
function setTilt(t){     // рама с другой камерой; без рамы и у реки — TILT_BASE, VIEW_UP 0,83
  TILT = t; VIEW_UP = +Math.sqrt(1 - t*t).toFixed(2);
  drawDishTable.cache=null; drawDishTable.lru=[]; tableBlit.shown=null;
}
// Рельеф читается тенью и кромкой, а не высотой: геометрия — как в жизни (Z_EXAG), а свет, кромка,
// тень и корки считаются по Z_RELIEF (см. выше). При ×2 без этого верх освещался ровно, складки
// оставались царапинами, а в виде A стенок не было вовсе (проверка сборки 31).
// Начинка — ломтики банана (владелица 17.09: жёлтые капли читались желтками). Мякоть кремовая;
// у каждого ломтика тёмный ободок и семечки в середине. Желток появится отдельной начинкой.
// Мякоть ломтика и его бок (порция — один ломтик). Ярко-жёлтая горка читалась желтком (17.09).
const FILL_COLORS = [[236,218,158],[232,213,150],[239,222,166]];
const SECTION_FILL = [232,176,58];
const BANANA_TILT = [0.12,0.32];   // наклон кружка в горке: подъём края — доля радиуса на экране (сборка 92)
const BANANA_FLESH = [[253,234,156],[249,228,146],[254,239,170]], BANANA_RIM = "rgba(196,156,78,.5)", BANANA_SEED = "rgba(128,96,54,.45)";
const EGG_SECTION = [236,178,42];
const EGG_RIM = "rgba(196,140,28,.55)";
const EGG_GLOSS = "rgba(255,248,210,.38)";
// белок: плёнка, сквозь неё видно тесто (сборка 92). Сборка 94: молочный, не серый — чистый белый на 0,46 поверх
// бежевого теста давал холодный серо-голубой (ревью 18.11, кадр d); тёплее и плотнее — сливочная плёнка.
const EGG_WHITE_RGB = [255,249,232], EGG_WHITE_A = .7, EGG_WHITE = `rgba(${EGG_WHITE_RGB},${EGG_WHITE_A})`;
const EGG_YOLK = [247,176,34], EGG_YOLK_RUN = "rgba(250,190,52,.55)";
// Высота стопки под каждой гранью и верх материала на сетке 48×48. Грани идут снизу
// вверх; грань поднимается на высоту того, что уже лежит под её центром. Кэш — по массиву
// граней, как у торца: снимок геометрии неизменяем. zb/zt — настоящие миллиметры (карточка,
// тень); рисуется сглаженная поверхность конверта (envelopeSurface).
function stackHeights(faces){
  const cache=stackHeights.cache||(stackHeights.cache=new WeakMap());
  const hit=cache.get(faces); if(hit) return hit;
  let L=Infinity,R=-Infinity,T=Infinity,B=-Infinity;
  for(const f of faces) for(const p of f.points){ if(p.x<L)L=p.x; if(p.x>R)R=p.x; if(p.y<T)T=p.y; if(p.y>B)B=p.y; }
  const size=48, dx=Math.max(1e-6,(R-L)/size), dy=Math.max(1e-6,(B-T)/size);
  const top=new Float32Array(size*size), under=new Float32Array(size*size), fill=new Uint8Array(size*size);
  const doughTop=new Float32Array(size*size);   // верх последнего слоя теста в ячейке (под начинкой)
  const zb=new Float32Array(faces.length), zt=new Float32Array(faces.length);
  // В ячейке каждый слой материала считается один раз: общие диагонали треугольников
  // одного квадрата иначе удваивали толщину пятнами (рябь на ровном листе).
  // near — все грани, чья рамка задевает ячейку: мелкий треугольник может не накрыть ни
  // одного центра ячейки, но лежать под чужим центром (ревью толщины 16.09, п. 1).
  const layers=new Array(size*size), near=new Array(size*size), bx=new Float64Array(faces.length*4);
  const ci=x=>Math.min(size-1,Math.max(0,Math.floor((x-L)/dx))), cj=y=>Math.min(size-1,Math.max(0,Math.floor((y-T)/dy)));
  for(let i=0;i<faces.length;i++){
    const f=faces[i], ps=f.points, key=f.kind+":"+f.source+":"+f.turned;
    let cx=0,cy=0,x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const p of ps){ cx+=p.x; cy+=p.y; if(p.x<x0)x0=p.x; if(p.x>x1)x1=p.x; if(p.y<y0)y0=p.y; if(p.y>y1)y1=p.y; }
    bx[i*4]=x0; bx[i*4+1]=x1; bx[i*4+2]=y0; bx[i*4+3]=y1;
    // Под гранью — только то, что действительно накрывает её центр: соседний треугольник того
    // же слоя центра не содержит, и считать его «снизу» значит поднять грань на пустом месте.
    const c={x:cx/ps.length,y:cy/ps.length};
    let base=0;
    for(const e of near[cj(c.y)*size+ci(c.x)]||[]){
      const o=e*4, pad=1e-7;   // рамка отсекает соседей до точного теста
      if(c.x<bx[o]-pad || c.x>bx[o+1]+pad || c.y<bx[o+2]-pad || c.y>bx[o+3]+pad) continue;
      const g=faces[e]; if(pointInFace(g.points,c.x,c.y)) base+=layerMM(g,c);
    }
    zb[i]=base; zt[i]=base+layerMM(f,c);
    for(let j=cj(y0);j<=cj(y1);j++) for(let k=ci(x0);k<=ci(x1);k++) (near[j*size+k]||(near[j*size+k]=[])).push(i);
    for(let j=cj(y0);j<=cj(y1);j++) for(let k=ci(x0);k<=ci(x1);k++){
      const q={x:L+(k+.5)*dx,y:T+(j+.5)*dy};
      if(!pointInFace(ps,q.x,q.y)) continue;
      const cell=j*size+k, list=layers[cell]||(layers[cell]=[]);
      if(list.some(e=>e.key===key)) continue;
      const h=layerMM(f,q); list.push({key,h,idx:i});
      under[cell]=top[cell]; top[cell]+=h; fill[cell]=f.kind==="filling" ? 1 : 0;
      if(f.kind==="dough") doughTop[cell]=top[cell];
    }
  }
  const out=envelopeSurface({zb,zt,top,under,fill,doughTop,L,T,dx,dy,size},faces); cache.set(faces,out); return out;
}
// Быстрые высоты предпросмотра складки (на каждое движение пальца точный расчёт дорог):
// оставшаяся часть берёт высоты из последнего точного снимка; поднятая часть кладётся
// перевёрнутой стопкой поверх того, что лежит в месте назначения. Верх — своя сетка по
// граням предпросмотра: клапан может выйти за прежнюю рамку. Приближение для движения
// пальца; после отпускания считается точно.
function previewHeights(faces){
  const cache=previewHeights.cache||(previewHeights.cache=new WeakMap());
  const hit=cache.get(faces); if(hit) return hit;
  const H=stackHeights(dish.faces), n=H.size;
  const topAt=(x,y)=>H.top[Math.min(n-1,Math.max(0,Math.floor((y-H.T)/H.dy)))*n+Math.min(n-1,Math.max(0,Math.floor((x-H.L)/H.dx)))];
  const cen=ps=>{let x=0,y=0;for(const p of ps){x+=p.x;y+=p.y;}return {x:x/ps.length,y:y/ps.length};};
  const zb=new Float32Array(faces.length), zt=new Float32Array(faces.length);
  let L=Infinity,R=-Infinity,T=Infinity,B=-Infinity;
  for(let i=0;i<faces.length;i++){
    const f=faces[i], src=f.__src, c=cen(f.points);
    for(const p of f.points){ if(p.x<L)L=p.x; if(p.x>R)R=p.x; if(p.y<T)T=p.y; if(p.y>B)B=p.y; }
    if(src===undefined){ zt[i]=layerMM(f,c); continue; }
    if(!f.__lifted) zb[i]=H.zb[src];
    else { const o=cen(dish.faces[src].points); zb[i]=topAt(c.x,c.y)+Math.max(0,topAt(o.x,o.y)-H.zt[src]); }
    zt[i]=zb[i]+layerMM(f,c);
  }
  const dx=Math.max(1e-6,(R-L)/n), dy=Math.max(1e-6,(B-T)/n);
  const top=new Float32Array(n*n), under=new Float32Array(n*n), fill=new Uint8Array(n*n);
  for(let i=0;i<faces.length;i++){
    const ps=faces[i].points;
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const p of ps){ if(p.x<x0)x0=p.x; if(p.x>x1)x1=p.x; if(p.y<y0)y0=p.y; if(p.y>y1)y1=p.y; }
    const i0=Math.max(0,Math.floor((x0-L)/dx)), i1=Math.min(n-1,Math.floor((x1-L)/dx));
    const j0=Math.max(0,Math.floor((y0-T)/dy)), j1=Math.min(n-1,Math.floor((y1-T)/dy));
    for(let j=j0;j<=j1;j++) for(let k=i0;k<=i1;k++){
      const cell=j*n+k;
      // Грани идут снизу вверх: верх ячейки — последняя накрывшая её грань (высоты
      // предпросмотра приближённые, и «кто выше» по ним путает начинку с клапаном над ней).
      if(!pointInFace(ps,L+(k+.5)*dx,T+(j+.5)*dy)) continue;
      top[cell]=zt[i]; under[cell]=zb[i]; fill[cell]=faces[i].kind==="filling" ? 1 : 0;
    }
  }
  const out=envelopeSurface({zb,zt,top,under,fill,L,T,dx,dy,size:n},faces); cache.set(faces,out); return out;
}
// Конверт — одна подушка, а не лист, облепивший каждую порцию (владелица 16.09; сверено с
// видео уличных роти: верх ровный, начинка видна лишь пологой волной, край скруглён).
// Условность отрисовки: карта высот (top) и жарка не меняются. Там, где тесто лежит поверх
// чего-то, рельеф сглаживается широко; одиночный лист и открытая начинка остаются как есть.
const ENV_BLUR = 0.3;     // радиус сглаживания в долях короткой стороны рамки (inferred)
const ENV_DETAIL = 0.12;  // доля исходного рельефа под тестом: волна над порциями, ступень клапана
const WALL_MIN_MM = 1.2;
const WALL_CRUST_K = 0.74;   // полоса корочки низа на стенке — темнее верха, как сама стенка (сборка 91)
const FILL_VIS = 0.45;      // доля высоты открытого ломтика в картинке (подобрана при ×5)
// Укрощение толстых мест (см. envelopeSurface): одиночное пятно не выше соседей + SPIKE_MM; на экране
// высота насыщается — visMM(h) = VIS_SAT_MM·(1 − e^(−h/VIS_SAT_MM)): 0,5 мм → 0,48, 5 мм → 3,2, 14 мм → 4,7.
const SPIKE_MM = 1, SPIKE_R = 3, VIS_SAT_MM = 5;
const visMM = h => h>0 ? VIS_SAT_MM*(1-Math.exp(-h/VIS_SAT_MM)) : 0;
const LIGHT_SLOPE = 0.3;   // доля наклона поверхности, которую видит свет (при ×5 по высоте)  // тоньше — это одиночный лист: его ступенчатый край без стенки
function boxBlur(a,n,rx,ry){
  // Скользящее среднее по строкам, затем по столбцам; окно у края обрезается, делитель
  // постоянный — поэтому сглаживать надо и массу, и маску, и делить одно на другое.
  const tmp=new Float32Array(n*n), out=new Float32Array(n*n), pre=new Float64Array(n+1);
  for(let j=0;j<n;j++){
    for(let i=0;i<n;i++) pre[i+1]=pre[i]+a[j*n+i];
    for(let i=0;i<n;i++) tmp[j*n+i]=(pre[Math.min(n,i+rx+1)]-pre[Math.max(0,i-rx)])/(2*rx+1);
  }
  for(let i=0;i<n;i++){
    for(let j=0;j<n;j++) pre[j+1]=pre[j]+tmp[j*n+i];
    for(let j=0;j<n;j++) out[j*n+i]=(pre[Math.min(n,j+ry+1)]-pre[Math.max(0,j-ry)])/(2*ry+1);
  }
  return out;
}
function envelopeSurface(H,faces){
  const {top,under,fill,size:n,dx,dy,L,T}=H, N=n*n, short=Math.min(dx,dy)*n;
  const rx=Math.max(1,Math.round(ENV_BLUR*short/dx)), ry=Math.max(1,Math.round(ENV_BLUR*short/dy));
  let mass=new Float32Array(N), mask=new Float32Array(N);
  const draped=c=>top[c]>0 && !fill[c] && under[c]>.3;   // тесто сверху, под ним что-то есть
  for(let c=0;c<N;c++) if(draped(c)){ mass[c]=top[c]; mask[c]=1; }
  // Два прохода скользящего среднего ≈ гауссово сглаживание.
  mass=boxBlur(boxBlur(mass,n,rx,ry),n,rx,ry); mask=boxBlur(boxBlur(mask,n,rx,ry),n,rx,ry);
  // base — поверхность теста: под открытой начинкой это верх того, на чём она лежит, иначе
  // лист вокруг порции тянулся бы к ней шатром.
  const surf=new Float32Array(N), base=new Float32Array(N), cover=new Float32Array(N);
  for(let c=0;c<N;c++){
    if(!(top[c]>0)) continue;
    cover[c]=1;
    if(!draped(c) || mask[c]<1e-6) surf[c]=top[c];
    else { const smooth=mass[c]/mask[c]; surf[c]=smooth+ENV_DETAIL*(top[c]-smooth); }
    // Под открытой начинкой тесто — на высоте своего верха, сколько бы ломтиков ни лежало сверху.
    base[c]=fill[c] ? (H.doughTop ? H.doughTop[c] : under[c]) : surf[c];
  }
  // Одиночные толстые пятна — несмятый или скомканный при неаккуратном переносе кусок тонкого
  // листа (толщина до 14 мм) — при ×5 стояли башнями, а ломтики на них — столбами (владелица
  // 17.09). Условность картинки: клетка не выше средней по соседям + SPIKE_MM, и на экране высота
  // насыщается (visMM) — толстое пятно пологий бугор, а не гора. Толщина в карточке и тепло считаются
  // по настоящим миллиметрам.
  {
    const r=SPIKE_R, cw=boxBlur(boxBlur(cover,n,r,r),n,r,r);
    for(const g of [surf,base]){
      const m=new Float32Array(N); for(let c=0;c<N;c++) m[c]=cover[c]?g[c]:0;
      const mean=boxBlur(boxBlur(m,n,r,r),n,r,r);
      for(let c=0;c<N;c++){
        if(!cover[c]) continue;
        g[c]=visMM(Math.min(g[c], (cw[c]>1e-6 ? mean[c]/cw[c] : g[c])+SPIKE_MM));
      }
    }
  }
  // Свет сверху-слева-спереди по наклону поверхности: множитель яркости (0,72…1,22). Пустые
  // ячейки снаружи дают склон у края — это и есть скругление кромки на свету.
  // За рамкой сетки — пусто: рамка облегает конверт, и его край лежит в крайних ячейках.
  const get=(grid,i,j)=>i<0||j<0||i>=n||j>=n ? 0 : grid[j*n+i];
  // Свет вполовину от преувеличенной высоты: на столе крупные куски иначе мнутся бликами (17.09).
  // Наклон считается в координатах блюда и сглаживается на ячейку (иначе свет мнётся, как бумага);
  // яркость — из наклона и направления света. Пока блюдо крутят, наклон поворачивается вместе с ним,
  // а свет стоит на месте (lightAtAngle), — раньше блик ехал с блюдом и прыгал на отпускании.
  let gxg=new Float32Array(N), gyg=new Float32Array(N), s=Z_RELIEF/ROTI_R_MM*LIGHT_SLOPE;
  for(let j=0;j<n;j++) for(let i=0;i<n;i++){
    const c=j*n+i;
    if(!cover[c]) continue;
    gxg[c]=(get(surf,i+1,j)-get(surf,i-1,j))/(2*dx)*s; gyg[c]=(get(surf,i,j+1)-get(surf,i,j-1))/(2*dy)*s;
  }
  const lw=boxBlur(boxBlur(cover,n,1,1),n,1,1);
  gxg=boxBlur(boxBlur(gxg,n,1,1),n,1,1); gyg=boxBlur(boxBlur(gyg,n,1,1),n,1,1);
  for(let c=0;c<N;c++){ const k=cover[c]&&lw[c]>1e-6 ? 1/lw[c] : 0; gxg[c]*=k; gyg[c]*=k; }
  const shade=(gx,gy)=>Math.max(.72,Math.min(1.22,((.42*gx+.5*gy+.76)/Math.hypot(gx,gy,1))/.76));
  const light=new Float32Array(N);
  for(let c=0;c<N;c++) light[c]=cover[c] ? shade(gxg[c],gyg[c]) : 1;
  // Билинейная выборка по занятым ячейкам: край не оседает от пустоты снаружи, а лишь
  // скругляется на долю (0,8…1) по мере того, как рядом кончается материал.
  const sample=(grid,p,weighted)=>{
    const u=(p.x-L)/dx-.5, v=(p.y-T)/dy-.5, i=Math.floor(u), j=Math.floor(v), fu=u-i, fv=v-j;
    const w=[(1-fu)*(1-fv),fu*(1-fv),(1-fu)*fv,fu*fv], ij=[[i,j],[i+1,j],[i,j+1],[i+1,j+1]];
    let sum=0,wsum=0,cov=0;
    for(let k=0;k<4;k++){
      const [a,b]=ij[k], on=get(cover,a,b);
      cov+=w[k]*on;
      if(!weighted || on){ sum+=w[k]*get(grid,a,b); wsum+=w[k]; }
    }
    return {value:wsum>1e-9 ? sum/wsum : 0, cov};
  };
  const at=p=>{ const r=sample(surf,p,true); return r.value*(.8+.2*Math.min(1,r.cov)); };
  const atDough=p=>{ const r=sample(base,p,true); return r.value*(.8+.2*Math.min(1,r.cov)); };
  const verts=new Array(faces.length), lights=new Float32Array(faces.length).fill(NaN), grads=new Array(faces.length);
  const flags=new Int8Array(faces.length).fill(-1);   // бит 1 — открытая начинка, бит 2 — край
  const flagsOf=i=>{
    if(flags[i]<0){
      const ps=faces[i].points; let x=0,y=0; for(const p of ps){x+=p.x;y+=p.y;}
      const k=Math.min(n-1,Math.max(0,Math.floor((x/ps.length-L)/dx))), j=Math.min(n-1,Math.max(0,Math.floor((y/ps.length-T)/dy)));
      flags[i]=(fill[j*n+k] ? 1 : 0) | (ps.some(p=>sample(cover,p,false).cov<.999) ? 2 : 0);
    }
    return flags[i];
  };
  return {...H, surf, base, light, gxg, gyg,
    at,
    // Высоты вершин грани (мм) — одна поверхность на все грани: у общих точек соседей высота одна.
    vert(i){
      if(verts[i]) return verts[i];
      const f=faces[i];
      // Открытый ломтик — плоский диск на тесте: высота теста плюс профиль ломтика (ниже, чем ×5
      // остального: иначе ломтики торчали колючими бочонками, 17.09).
      // Ломтик — жёсткий диск: основание одно на весь ломтик, по тесту под его центром
      // (иначе на неровном листе ломтик вытягивался столбом, 17.09).
      if(f.kind==="filling" && (flagsOf(i)&1)){ const b0=f.pc ? atDough(f.pc) : null; return verts[i]=Float32Array.from(f.points,p=>(b0!==null ? b0 : atDough(p))+fillHeight(f,p)*FILL_VIS); }
      return verts[i]=Float32Array.from(f.points,f.kind==="dough" ? atDough : at);
    },
    atBase:p=>atDough(p),
    lightPoint:p=>sample(light,p,true).value||1,
    lightAt(i){
      if(Number.isNaN(lights[i])){
        const ps=faces[i].points; let x=0,y=0; for(const p of ps){x+=p.x;y+=p.y;}
        lights[i]=sample(light,{x:x/ps.length,y:y/ps.length},true).value||1;
      }
      return lights[i];
    },
    // Яркость грани, когда блюдо повёрнуто на угол a (предпросмотр поворота).
    lightAtAngle(i,a){
      if(!a) return this.lightAt(i);
      if(!grads[i]){
        const ps=faces[i].points; let x=0,y=0; for(const p of ps){x+=p.x;y+=p.y;}
        const c={x:x/ps.length,y:y/ps.length};
        grads[i]=[sample(gxg,c,true).value,sample(gyg,c,true).value];
      }
      const [gx,gy]=grads[i], cs=Math.cos(a), sn=Math.sin(a);
      return shade(gx*cs-gy*sn,gx*sn+gy*cs);
    },
    // Открытая начинка: верх ячейки под её центром — сама начинка.
    exposed(i){ return !!(flagsOf(i)&1); },
    // Край материала: хотя бы одна вершина стоит у пустой ячейки.
    rim(i){ return !!(flagsOf(i)&2); }
  };
}
// Боковая стенка грани: четырёхугольник между точками на высоте base и на высоте вершины.
// Рисуется до верхов — внутри конверта стенки закрывает поверхность, остаётся только край.
function drawFaceWalls(g,ps,screen,hs,zk,base,open){
  for(let k=0;k<ps.length;k++){
    if(open && !open[k]) continue;
    const m=(k+1)%ps.length, a=screen(ps[k]), b=screen(ps[m]);
    const ha=hs[k]*zk, hb=hs[m]*zk, la=base ? base[k]*zk : 0, lb=base ? base[m]*zk : 0;
    if(ha-la<.2/RELIEF_K && hb-lb<.2/RELIEF_K) continue;   // порог — доля прежней высоты, иначе бока тонкого пропадают
    g.beginPath(); g.moveTo(a.x,a.y-la); g.lineTo(b.x,b.y-lb); g.lineTo(b.x,b.y-hb); g.lineTo(a.x,a.y-ha); g.closePath(); g.fill();
  }
}
// Сборка 94 (ревью 18.11, кадры c, d): стенка кромки рисовалась по ВСЕМ сторонам грани кромки, в том числе по
// общим с соседней гранью и по дальним, отвёрнутым от глаза. Верх сырого листа полупрозрачный — и сквозь него
// светились треугольные «заплаты» вокруг дыр и «пила» вдоль кромки. Стенка нужна только на открытой стороне
// (её не делит другая грань теста) и только если сторона смотрит к зрителю (внешняя нормаль — вниз по экрану).
const faceEdgeUse = new WeakMap();
function wallEdgesOpen(faces,i,screen){
  let use=faceEdgeUse.get(faces);
  const ek=(p,q)=>{ const a=p.x.toFixed(4)+","+p.y.toFixed(4), b=q.x.toFixed(4)+","+q.y.toFixed(4); return a<b ? a+"|"+b : b+"|"+a; };
  if(!use || use.n!==faces.length){
    use={n:faces.length,map:new Map(),shared:new WeakMap()};   // стороны считаются раз на набор граней
    for(const f of faces){ if(f.kind!=="dough") continue; const ps=f.points;
      for(let k=0;k<ps.length;k++){ const key=ek(ps[k],ps[(k+1)%ps.length]); use.map.set(key,(use.map.get(key)||0)+1); } }
    faceEdgeUse.set(faces,use);
  }
  const ps=faces[i].points, n=ps.length, sp=ps.map(p=>screen(p));
  let sh=use.shared.get(faces[i]);
  if(!sh){ sh=ps.map((p,k)=>(use.map.get(ek(p,ps[(k+1)%n]))||0)>1); use.shared.set(faces[i],sh); }
  let cx=0, cy=0; for(const q of sp){ cx+=q.x; cy+=q.y; } cx/=n; cy/=n;
  const open=new Array(n);
  for(let k=0;k<n;k++){
    const m=(k+1)%n;
    if(sh[k]){ open[k]=false; continue; }
    const a=sp[k], b=sp[m], ny=b.x-a.x, nx=-(b.y-a.y), side=nx*(cx-a.x)+ny*(cy-a.y);
    open[k]=(side<0 ? ny : -ny)>0;               // внешняя нормаль смотрит вниз по экрану — к зрителю
  }
  return open;
}
// Сырой лист на таве полупрозрачный (сквозь него темнеет сталь) и за 2–3 с схватывается — становится
// матовым: доля SET_RAW…1 растёт с сушкой стороны на стали до SET_DRY (сборка 78; раньше лист на таве
// сразу был кремовым, и первые секунды на глаз не происходило ничего). Условность отрисовки.
const SET_RAW = 0.58, SET_DRY = 0.17;
function doughSet(f){
  const t=dish && dish.thermal && dish.thermal[f.source]; if(!t) return 1;
  const s=Math.min(1,Math.max(t.dry[0],t.dry[1])/SET_DRY);
  return SET_RAW+(1-SET_RAW)*s*s*(3-2*s);
}
function drawDishFaces(g,faces,screen,H,zk,shadow=true,shift=null,noShadow=null){
  const turn=dishTwist && dish && faces===dish.faces ? dishTwist.angle : 0;   // свет стоит, пока блюдо крутят
  if(shift){ const base=screen; screen=(p,f)=>{ const o=f && shift.get(f); return base(o ? {x:p.x+o.x,y:p.y+o.y} : p); }; }
  // Тень конверта на стали и боковая сторона у его края. Отдельные заливки мелких
  // треугольников: один общий путь из тысяч наложенных контуров растеризуется в разы дольше.
  const tone=(f,k)=>{
    let color=f.kind==="filling"
      ? (f.fill==="egg" ? EGG_WHITE_RGB : FILL_COLORS[Math.round(f.tone)%3])
      : dishCrustColor(f);
    return k===1 ? color : color.map(c=>Math.min(255,c*k));
  };
  const tri=new Float64Array(6);   // экранные три первые точки последней залитой грани — для пятен
  const top=(i,off)=>{
    const f=faces[i], p=screen(f.points[0],f), y0=p.y-off(0); g.beginPath(); g.moveTo(p.x,y0); tri[0]=p.x; tri[1]=y0;
    for(let k=1;k<f.points.length;k++){ const q=screen(f.points[k],f), y=q.y-off(k); g.lineTo(q.x,y); if(k<3){ tri[k*2]=q.x; tri[k*2+1]=y; } }
    g.closePath();
    if(VC && faces[i].kind==="dough" && faces[i].points.length===3){   // сборка 90: фон по вершинам
      // свет тоже по вершинам (кроме поворота блюда): у кромки склон круче, и свет грани давал осколки
      const o=VC.T.off[i], id=VC.T.id, A=VC.acc, ps=faces[i].points;
      const c=m=>{ const v=id[o+m]*4, k=VL ? vlight(o+m,ps[m]) : ink; return [Math.min(255,A[v]*k),Math.min(255,A[v+1]*k),Math.min(255,A[v+2]*k)]; };
      g.fillStyle=crustGradientCached(g,faces[i],tri,c(0),c(1),c(2));
    }
    g.fill();
  };
  // Цвета вершин фона корки — только у листа с жаркой (на таве и в руке после неё)
  const VC=dish && dish.thermal && faces.some(f=>f.kind==="dough") ? crustVertexColors(faces) : null;
  let ink=1;                                     // множитель света текущей грани для цветов вершин
  // свет вершин — раз на снимок высот (H живёт, пока не меняются грани)
  const VL=VC && H && !turn ? (H.crustVL && H.crustVL.length===VC.T.id.length ? H.crustVL : (H.crustVL=new Float32Array(VC.T.id.length).fill(NaN))) : null;
  const vlight=(j,p)=>{ let k=VL[j]; if(k!==k) k=VL[j]=Math.max(.88,H.lightPoint(p)); return k; };
  const faceScreen=f=>p=>screen(p,f);
  if(H){
    // На столе тень гуще и длиннее: куски читаются отдельными брусками (владелица 17.09: «плоско»).
    const onTable=dish && dish.mode!=="fold";
    g.fillStyle=onTable ? "rgba(12,7,3,.5)" : "rgba(18,10,4,.34)";
    for(let i=0;i<faces.length && shadow;i++){
      if(faces[i].kind!=="dough" || H.zb[i]>.3 || (noShadow && noShadow(faces[i]))) continue;
      const hs=H.vert(i), drop=zk*RELIEF_K*Math.max(...hs)*(onTable ? .45 : .25);
      if(drop<.3) continue;
      const ps=faces[i].points, p=screen(ps[0],faces[i]); g.beginPath(); g.moveTo(p.x+drop,p.y);
      for(let k=1;k<ps.length;k++){ const q=screen(ps[k],faces[i]); g.lineTo(q.x+drop,q.y); }
      g.closePath(); g.fill();
    }
    const crust=[];
    for(let i=0;i<faces.length;i++){
      if(faces[i].kind!=="dough" || !H.rim(i) || Math.max(...H.vert(i))<WALL_MIN_MM) continue;
      g.fillStyle=rgb(tone(faces[i],.66));
      const open=wallEdgesOpen(faces,i,faceScreen(faces[i]));
      drawFaceWalls(g,faces[i].points,faceScreen(faces[i]),H.vert(i),zk,undefined,open);
      if(H.zb[i]<=.3 && dish && dish.thermal) crust.push([i,open]);
    }
    // Корочка низа по краю: нижняя полоса стенки — цвет стороны на стали. Так жарку снизу видно
    // сверху, как продавец смотрит на кромку (владелица 17.09: «держала долго — ничего не поджарилось»).
    for(const [i,open] of crust){
      const f=faces[i], hs=H.vert(i), band=hs.map(h=>Math.min(h,Math.max(2.2/Math.max(zk,1e-6),.55*h)));
      // Сборка 91 (ревью 18.11, п. 3): полоса — в тени стенки (×WALL_CRUST_K), иначе сырой низ светлее верха
      // и читался белым основанием «книги»; цвет стороны на стали в ней остаётся.
      g.fillStyle=rgb(dishCookColor(f,f.turned ? 1 : 0,false).map(v=>v*WALL_CRUST_K));
      drawFaceWalls(g,f.points,faceScreen(f),band,zk,undefined,open);
    }
  }
  // Прозрачность накладывает настоящие слои друг на друга, а не смешивает каждый слой с
  // цветом тавы. Сырой тонкий лист чуть просвечивает; поверх объёма — почти непрозрачен.
  const paint=k=>{
    const f=faces[k];
    // Открытая начинка без светотени купола: это плоская россыпь ломтиков, а не горка.
    const flat=H && f.kind==="filling" && H.exposed(k);
    const lit=H && !flat ? (turn && H.lightAtAngle ? H.lightAtAngle(k,turn) : H.lightAt(k)) : 1;
    ink=f.kind==="filling" ? 1 : Math.max(.88, lit);
    g.fillStyle=rgb(tone(f, ink));
    g.globalAlpha=f.kind==="filling" ? (f.fill==="egg" ? EGG_WHITE_A : 1)
      : H ? Math.min(.95,.72+doughMM(f.tone)*.3)*doughSet(f)
      : Math.max(.48,Math.min(.92,.48+doughMM(f.tone)*.3));
    if(H){ const hs=H.vert(k); top(k,m=>hs[m]*zk); } else top(k,()=>0);
    if(f.kind==="dough" && !(buried && buried[k])) drawCrustSpots(g,f,tri);   // сборка 86, раунд 2: пятна круглые и на таве
  };
  // Открытая начинка — всегда верх своей ячейки и выше соседнего теста, поэтому рисуется
  // последней: иначе низкий клапан за порцией закрашивал её верх (ревью толщины 16.09, п. 4).
  // Сперва стенки всех открытых кусочков, потом их верхи — стенка следующего кусочка не
  // ложится поверх уже нарисованного.
  const buried=crustBuried(faces,H);
  const open=[], smooth=g.imageSmoothingEnabled; g.imageSmoothingEnabled=true;   // текстура пятен — сглаженно
  for(let k=0;k<faces.length;k++){
    if(H && faces[k].kind==="filling" && H.exposed(k)) open.push(k); else paint(k);
  }
  g.globalAlpha=1;
  for(const k of open){
    if(faces[k].fill==="egg") continue;   // сборка 92: открытое яйцо — плёнка белка (drawEggFilm), без стенок и граней
    // бок ломтика — не выше его собственной толщины: на склоне он иначе стоял кексом до низа
    const f=faces[k], hs=H.vert(k), base=f.points.map((p,m)=>Math.max(Math.min(hs[m],H.atBase(p)),hs[m]-fillHeight(f,p)*FILL_VIS-.15));
    g.fillStyle=rgb(tone(f,.88));
    drawFaceWalls(g,f.points,faceScreen(f),hs,zk,base);
  }
  for(const k of open) if(faces[k].fill!=="egg") paint(k);
  g.globalAlpha=1; g.imageSmoothingEnabled=smooth;
  if(H && open.length){
    drawEggFilm(g,faces,open,screen,H,zk);
    drawBananaSlices(g,faces,open,screen,H,zk);
    drawEggYolk(g,faces,open,screen,H,zk);
  }
}
// Ломтик поверх открытой порции (порция и есть ломтик): обрезка по её открытым граням и куску
// стола, чтобы ломтик не лёг на клапан.
function drawBananaSlices(g,faces,open,screen,H,zk){
  const groups=new Map();
  for(const k of open){
    const f=faces[k]; if(f.fill==="egg" || !f.pc || !(f.pr>0)) continue;
    // Один кусок стола — один сдвиг: сравниваем точку со сдвигом куска и без него.
    const probe=screen(f.points[0],f), bare=screen(f.points[0]);
    const gk=f.source+"|"+f.turned+"|"+Math.round(probe.x-bare.x)+","+Math.round(probe.y-bare.y);
    if(!groups.has(gk)) groups.set(gk,{f,list:[]});
    groups.get(gk).list.push(k);
  }
  for(const {f,list} of groups.values()){
    // Сборка 92 (партия «еда»): кружок в горке лежит с наклоном — край, которым он лёг на соседа, выше.
    // Наклон — от номера кружка (направление и 10–25°), в экранных px: подъём точки = tk·r·cos(угол к наклону).
    // Обрезка по граням порции поднимается тем же наклоном, иначе приподнятый край срезало бы.
    const hs0=Math.sin(f.source*12.9898+4.1)*43758.5453, hk=hs0-Math.floor(hs0);
    const tAng=f.source*2.39996+.7, tk=BANANA_TILT[0]+(BANANA_TILT[1]-BANANA_TILT[0])*hk, td={x:Math.cos(tAng),y:Math.sin(tAng)};
    const R=f.pr, c=f.pc, r=R*.97;
    const e0=screen({x:c.x+r,y:c.y},f), e1=screen({x:c.x-r,y:c.y},f), rs=Math.hypot(e0.x-e1.x,e0.y-e1.y)/2;
    const tz=p=>tk*rs*((p.x-c.x)*td.x+(p.y-c.y)*td.y)/r;
    g.save(); g.beginPath();
    for(const k of list){
      const ps=faces[k].points, hs=H.vert(k);
      const p=screen(ps[0],faces[k]); g.moveTo(p.x,p.y-hs[0]*zk-tz(ps[0]));
      for(let m=1;m<ps.length;m++){ const q=screen(ps[m],faces[k]); g.lineTo(q.x,q.y-hs[m]*zk-tz(ps[m])); }
      g.closePath();
    }
    g.clip();
    const lift=H.at(c)*zk, ring=[];
    for(let j=0;j<14;j++){ const a=j*Math.PI/7, m={x:c.x+Math.cos(a)*r,y:c.y+Math.sin(a)*r}, q=screen(m,f); ring.push({x:q.x,y:q.y-lift-tz(m)}); }
    const path=dy=>{ g.beginPath(); g.moveTo(ring[0].x,ring[0].y+dy); for(let j=1;j<ring.length;j++) g.lineTo(ring[j].x,ring[j].y+dy); g.closePath(); };
    const flesh=BANANA_FLESH[f.source%3], th=Math.max(.8,rs*.16);
    // срез кружка: тот же контур ниже на толщину — светлая мякоть в тени, видна там, где кружок поднят
    path(th); g.fillStyle=rgb(flesh.map(v=>Math.round(v*.78))); g.fill();
    path(0); g.strokeStyle=BANANA_RIM; g.lineWidth=Math.max(.5,rs*.08);
    g.fillStyle=rgb(flesh); g.fill(); g.stroke();
    // семечки: три тёмные точки треугольником у середины
    g.fillStyle=BANANA_SEED;
    for(let j=0;j<3;j++){
      const a=(j*120+f.source*53)*Math.PI/180, m={x:c.x+Math.cos(a)*r*.16,y:c.y+Math.sin(a)*r*.16}, q=screen(m,f);
      const d=Math.max(.4,rs*.052);
      g.beginPath(); g.ellipse(q.x,q.y-lift-tz(m),d,d*.7,0,0,Math.PI*2); g.fill();
    }
    g.restore();
  }
}
// Яйцо (сборка 92, ревью сборки 89 п. 5: «плоские жёлтые полигоны, белка нет»). Яйцо разбивают на кучку банана:
// белок — полупрозрачная плёнка, растекается между кружками и чуть за кучку; желток один, на середине, лопнул и
// подтёк. Лужицы — по-прежнему настоящая начинка (addEgg): конверт их прячет, на срезе жёлтая полоса. Белок
// рисуется ПОД кружками банана (виден между ними) одной заливкой на все лужицы куска — иначе нахлёст лужиц темнел
// ступеньками; желток — ПОВЕРХ кружков (drawEggYolk).
function eggGroups(faces,open,screen){
  const groups=new Map();
  for(const k of open){
    const f=faces[k]; if(f.fill!=="egg" || !f.pc || !(f.pr>0)) continue;
    const probe=screen(f.points[0],f), bare=screen(f.points[0]);
    const gk=f.turned+"|"+Math.round(probe.x-bare.x)+","+Math.round(probe.y-bare.y);
    if(!groups.has(gk)) groups.set(gk,{f,list:[]});
    groups.get(gk).list.push(k);
  }
  return groups;
}
function eggClip(g,faces,list,screen,H,zk){
  g.beginPath();
  for(const k of list){
    const ps=faces[k].points, hs=H.vert(k);
    const p=screen(ps[0],faces[k]); g.moveTo(p.x,p.y-hs[0]*zk);
    for(let m=1;m<ps.length;m++){ const q=screen(ps[m],faces[k]); g.lineTo(q.x,q.y-hs[m]*zk); }
    g.closePath();
  }
}
function drawEggFilm(g,faces,open,screen,H,zk){
  for(const {list} of eggGroups(faces,open,screen).values()){
    // одна заливка на весь путь: лужица — это много кусочков граней листа, обводка рисовала бы их сетку
    eggClip(g,faces,list,screen,H,zk);
    g.fillStyle=EGG_WHITE; g.fill();
  }
}
function drawEggYolk(g,faces,open,screen,H,zk){
  let first=Infinity;
  for(const f of dish && dish.filling || []) if(f.kind==="egg" && f.id<first) first=f.id;
  for(const {list} of eggGroups(faces,open,screen).values()){
    const fy=list.map(k=>faces[k]).find(f=>f.source===first); if(!fy) continue;
    const c=fy.pc, R=fy.pr*.44, lift=H.at(c)*zk+zk*.6;
    const at=(dx,dy)=>{ const q=screen({x:c.x+dx,y:c.y+dy},fy); return {x:q.x,y:q.y-lift}; };
    const o=at(0,0), ex=at(R,0), ey=at(0,R), rx=Math.hypot(ex.x-o.x,ex.y-o.y), ry=Math.hypot(ey.x-o.x,ey.y-o.y);
    g.save(); eggClip(g,faces,list,screen,H,zk); g.clip();
    // подтёк лопнувшего желтка — в сторону от середины, полупрозрачный
    const a=fy.source*1.7+.9, run=at(Math.cos(a)*R*1.5,Math.sin(a)*R*1.5);
    g.fillStyle=EGG_YOLK_RUN; g.beginPath(); g.ellipse((o.x+run.x)/2,(o.y+run.y)/2,rx*1.45,ry*.95,Math.atan2(run.y-o.y,run.x-o.x),0,Math.PI*2); g.fill();
    g.fillStyle=rgb(EGG_YOLK); g.beginPath(); g.ellipse(o.x,o.y,rx,ry,0,0,Math.PI*2); g.fill();
    g.strokeStyle=EGG_RIM; g.lineWidth=Math.max(.6,rx*.08); g.stroke();
    g.fillStyle=EGG_GLOSS; g.beginPath(); g.ellipse(o.x-rx*.32,o.y-ry*.38,rx*.34,ry*.2,-.3,0,Math.PI*2); g.fill();
    g.restore();
  }
}
// Полёт переворота — свойство картинки, как TOSS у переноса: лист сжимается вдоль маха
// (|cos πu|), поднимается и на середине пути показывает другую сторону. Торец в полёте
// не рисуется; материал меняется один раз — при посадке.
function drawDishFlight(g,sx,sy,pose){
  const F=dishFlight, n=F.next, u0=Math.max(0,Math.min(1,(performance.now()-F.t0)/1000/F.T));
  const u=F.almost ? FLICK_ALMOST_U*Math.sin(Math.PI*u0) : u0;   // «почти»: до пятой части пути и обратно
  const e=u*u*(3-2*u), nx=n.axis.nx, ny=n.axis.ny;
  const cx=n.from.x+(n.to.x-n.from.x)*e, cy=n.from.y+(n.to.y-n.from.y)*e;
  const squash=Math.abs(Math.cos(Math.PI*u)), rise=Math.sin(Math.PI*u);
  const second=u>=.5, pivot=second ? n.to : n.from;
  const place=(p,lift)=>{
    const dx=p.x-pivot.x, dy=p.y-pivot.y, d=dx*nx+dy*ny;
    const qx=cx+dx-d*nx*(1-squash), qy=cy+dy-d*ny*(1-squash);
    const x=pose.x+qx*pose.scale, y=pose.y+qy*pose.scale-lift;
    return {x:prX(x,y)*sx,y:prY(x,y)*sy};
  };
  // Тень остаётся на стали и слегка сжимается, пока лист в воздухе.
  const c=place(pivot,0), r=(F.radius||.8)*.85*pose.scale*(1-.25*rise);
  g.fillStyle="rgba(6,3,1,.32)"; g.beginPath();
  g.ellipse(c.x,c.y,r*sx,r*TILT*sy,0,0,Math.PI*2); g.fill();
  // Объём летит вместе с листом: без высот верх конверта в первом кадре падал на ~20 px
  // и прыгал обратно при посадке. На ребре (середина маха) толщина сходит к нулю.
  const lift=rise*.45*pose.scale, faces=second ? n.faces : F.from;
  drawDishFaces(g,faces,p=>place(p,lift),stackHeights(faces),pose.scale*Z_EXAG/ROTI_R_MM*VIEW_UP*sy*squash,false);
}
// Ответ на касание края — о совершившемся, голосом предмета (критерий подсказок 07.09):
// лопатка под краем и приподнятая кромка с тенью. До касания ничего не рисуется.
function edgeFrame(d){
  const len=Math.hypot(d.edge.dx,d.edge.dy)||1;
  return {tx:d.edge.dx/len, ty:d.edge.dy/len, nx:d.inward.x, ny:d.inward.y, a:d.anchor};
}
// ─── Поддетый угол (сборка 88, видимый жест: разбор 17.11, п. 4) ───
// Касание края роти на таве без маха поднимает ближайший к пальцу угол конверта: небольшой треугольник
// сворачивается завитком (кончик — на CORNER_LIFT_DEG) и показывает низ — сторону на стали с её
// румянцем; под ним на таве мягкая тень. Держит палец — угол поднят; отпустила — ложится; короткое касание длится CORNER_LIFT_S.
// Только картинка: материал, тепло и контакт не меняются, переворота нет.
const CORNER_LIFT_S = 0.4, CORNER_LIFT_UP = 0.1, CORNER_LIFT_DOWN = 0.15, CORNER_LIFT_DEG = 160;
let cornerLift = null;             // {a,n,R,t0,up}: точка кромки, внутренняя нормаль к середине, отпускание
function cornerLiftAmount(now=performance.now()){
  const L=cornerLift; if(!L) return 0;
  const t=(now-L.t0)/1000, rise=Math.min(1,t/CORNER_LIFT_UP);
  const downAt=Math.max(L.up===null ? Infinity : (L.up-L.t0)/1000, CORNER_LIFT_S-CORNER_LIFT_DOWN);
  if(t<downAt) return rise*rise*(3-2*rise);
  const k=1-(t-downAt)/CORNER_LIFT_DOWN;
  if(k<=0){ cornerLift=null; return 0; }
  return Math.min(rise,k)*Math.min(rise,k)*(3-2*Math.min(rise,k));
}
// Шапка угла в координатах блюда (раунд 2: была полоса стороны — «крышка коробки»). Теперь — только угол
// конверта, ближайший к пальцу: треугольник, катеты — CORNER_LIFT_LEG стороны вдоль каждой кромки от угла
// (сторона ≈ √площади оболочки), петля — прямая через концы катетов. Угол — вершина оболочки, где кромка
// поворачивает больше CORNER_LIFT_TURN на отрезке ±0,1 стороны (скруглённый угол тоже угол).
// Сборка 91 (ревью 18.11, п. 2): пока палец держит, угол растёт — катеты от CORNER_LIFT_LEG до CORNER_LIFT_LEG_MAX
// стороны за CORNER_LIFT_GROW_S после подъёма: шапка доходит до четверти стороны от угла (у прямого угла
// петля на 0,25·√2 стороны по кромкам). Отпустила — угол ложится того размера, до какого дорос.
const CORNER_LIFT_LEG = 0.25, CORNER_LIFT_LEG_MAX = 0.354, CORNER_LIFT_GROW_S = 0.5, CORNER_LIFT_TURN = 30*Math.PI/180;
function cornerLiftGrow(now=performance.now()){
  const L=cornerLift; if(!L) return 0;
  const held=((L.up===null ? now : Math.min(now,L.up))-L.t0)/1000;
  const k=Math.max(0,Math.min(1,(held-CORNER_LIFT_UP)/CORNER_LIFT_GROW_S));
  return k*k*(3-2*k);
}
function cornerLiftCap(){
  const L=cornerLift, H=dish.hull; if(!L || !H || H.length<3) return null;
  const n=H.length, side=Math.sqrt(polyArea(H)), leg=(CORNER_LIFT_LEG+(CORNER_LIFT_LEG_MAX-CORNER_LIFT_LEG)*cornerLiftGrow())*side;
  // точка кромки на расстоянии len от вершины k, идя по оболочке в сторону dir
  const walk=(k,dir,len)=>{ let left=len, i=k;
    for(let m=0;m<n;m++){ const a=H[i], j=(i+dir+n)%n, b=H[j], l=Math.hypot(b.x-a.x,b.y-a.y);
      if(l>=left && l>1e-12) return {x:a.x+(b.x-a.x)*left/l,y:a.y+(b.y-a.y)*left/l}; left-=l; i=j; }
    return H[k]; };
  const turn=k=>{ const a=walk(k,-1,.1*side), b=H[k], c=walk(k,1,.1*side);
    const u=Math.atan2(b.y-a.y,b.x-a.x), v=Math.atan2(c.y-b.y,c.x-b.x); return Math.abs(Math.atan2(Math.sin(v-u),Math.cos(v-u))); };
  let k=-1, best=Infinity;
  for(let pass=0;pass<2 && k<0;pass++) for(let i=0;i<n;i++){
    const d=Math.hypot(H[i].x-L.a.x,H[i].y-L.a.y); if(d<best && (pass || turn(i)>CORNER_LIFT_TURN)){ best=d; k=i; } }
  const V=H[k], B1=walk(k,1,leg), B2=walk(k,-1,leg);
  let m={x:-(B2.y-B1.y),y:B2.x-B1.x}; const ml=Math.hypot(m.x,m.y); if(ml<1e-9) return null;
  m={x:m.x/ml,y:m.y/ml}; if((V.x-B1.x)*m.x+(V.y-B1.y)*m.y<0) m={x:-m.x,y:-m.y};   // m — от петли к углу
  const hinge=B1.x*m.x+B1.y*m.y, P=clipPoly(H,m.x,m.y,hinge); if(!P.length) return null;
  const reach=Math.max(...P.map(p=>p.x*m.x+p.y*m.y-hinge)); if(reach<1e-6) return null;
  const mid={x:P.reduce((s,p)=>s+p.x,0)/P.length,y:P.reduce((s,p)=>s+p.y,0)/P.length};
  return {P,hinge,m,reach,V,mid,leg,side};
}
// Цвета угла в точке q (середина шапки): верх — верхняя грань теста, низ — самая нижняя грань
// (порядок граней — снизу вверх), её сторона на стали с румянцем.
function cornerFaceAt(q,top){
  const fs=dish.faces.filter(f=>f.kind==="dough" && pointInFace(f.points,q.x,q.y));
  let f=top ? fs.at(-1) : fs[0];
  if(!f){ let best=Infinity; for(const g of dish.faces) if(g.kind==="dough"){ const p=g.points[0], d=Math.hypot(p.x-q.x,p.y-q.y); if(d<best){ best=d; f=g; } } }
  return f;
}
// Сборка 91 (ревью 18.11, п. 2): низ угла — не цвет одной грани (на кадре он был того же бежевого, что верх),
// а настоящая прожарка всей нижней стороны (сторона на стали, та же лестница fryStep, что у Сом и строки):
// сырое и бледное — светлый (переворачивать рано), приготовленное — золотой (пора), зажаренное — бурый
// (поздно), горелое — почти чёрный. q оставлен для совместимости вызовов.
const CORNER_UNDER = [[238,226,192],[236,218,170],[224,166,72],[150,90,40],[62,38,22]];
function cornerUnderStep(){ return fryStep(dishSideMean("cook","contactWeights")); }
// Сборка 95 (ревью 18.11, п. 3): цвет изнанки — ровно тот, каким эта сторона будет сверху после переворота
// (кадр h), чтобы игрок учился по нему: нижняя грань под серединой шапки, её сторона на стали, посчитанная
// как перевёрнутая грань (crustFace той же грани с turned наоборот: фон, кайма у края), плюс средняя доля
// пятен корки (как их кладёт crustMix). Палитра CORNER_UNDER осталась запасной — когда грани под углом нет.
function cornerUnderColor(q){
  const f=q ? cornerFaceAt(q,false) : null;
  if(!f || !dish.thermal || !dish.thermal[f.source]) return CORNER_UNDER[cornerUnderStep()].slice();
  const P=crustFace({...f,turned:!f.turned}), cov=spotCoverAt(P.c,P.edge), m=cov ? cov*spotStrength(P.c,P.edge) : 0;
  return P.ground.map((v,i)=>Math.round(v*(1-m*(1-SPOT_TINT[i]))));
}
function cornerTopColor(q){ const f=cornerFaceAt(q,true); return f ? dishCrustColor(f) : [227,213,178]; }
// Угол не поворачивается плоской доской на петле, а сворачивается завитком: точка на расстоянии s от петли
// уходит по дуге радиуса r = reach/θ на угол s/r — у петли лист почти лежит, кончик поднят на θ и
// смотрит низом. Рисуется полосами поперёк завитка (снизу к кончику), верх и низ — своими цветами,
// свет по наклону. Под углом на таве — мягкая тень (shadowBlur), сталь в следе шапки темнее.
const CORNER_CURL_STRIPS = 12, CORNER_SHADOW_A = 0.38, CORNER_CURL_ARC = 0.4, CORNER_SHADOW_W = 0.22;   // сила тени под завитком у петли; доля вылета, которая гнётся
function drawCornerLift(g,screen,lifted,cap,e,sx,sy){
  const {P,hinge,m,reach,mid}=cap, th=e*CORNER_LIFT_DEG*Math.PI/180; if(th<1e-3) return;
  // Сборка 91 (ревью 18.11, п. 2): гнётся только полоса у петли (CORNER_CURL_ARC вылета), дальше угол лежит
  // прямо, откинутый на θ, — низ смотрит вверх всей откинутой частью, а не узким кончиком завитка.
  const arc=reach*CORNER_CURL_ARC, r=arc/th, ct=Math.cos(th), st=Math.sin(th);
  const along=s=>s<=arc ? s/r : th;                       // наклон листа в точке s от петли
  const bend=p=>{ const s=Math.max(0,p.x*m.x+p.y*m.y-hinge);
    const f=Math.min(s,arc)/r, rest=Math.max(0,s-arc);
    const x=r*Math.sin(f)+rest*ct, z=r*(1-Math.cos(f))+rest*st, d=s-x;
    return lifted({x:p.x-m.x*d,y:p.y-m.y*d},z); };
  // рёбра шапки — мелко, чтобы изгиб читался
  const dense=Q=>{ const out=[]; Q.forEach((a,i)=>{ const b=Q[(i+1)%Q.length], k=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/(reach/16)));
    for(let j=0;j<k;j++) out.push({x:a.x+(b.x-a.x)*j/k,y:a.y+(b.y-a.y)*j/k}); }); return out; };
  const path=Q=>{ g.beginPath(); Q.forEach((q,i)=>i ? g.lineTo(q.x,q.y) : g.moveTo(q.x,q.y)); g.closePath(); };
  // Тень на таве (сборка 90): только размытая и полупрозрачная, гуще у петли (под завитком) и тает к кончику
  // угла. Прежде след шапки заливался тёмным поверх ореола — почти чёрный с жёстким краем по кромке роти.
  // Сама фигура уносится за холст, на таву ложится только её тень (shadowOffset — в пикселях устройства).
  if(g.getTransform && g.createLinearGradient){   // в Node (наборы) холста нет — без тени
  const S=P.map(screen), a0=screen({x:m.x*hinge,y:m.y*hinge}), a1=screen({x:m.x*(hinge+reach),y:m.y*(hinge+reach)});
  const tip=P.reduce((b,p)=>p.x*m.x+p.y*m.y>b.x*m.x+b.y*m.y ? p : b,P[0]), at=screen(tip);
  // конец градиента — проекция кончика угла на ось m в экране
  const ux=a1.x-a0.x, uy=a1.y-a0.y, uu=ux*ux+uy*uy||1, k=((at.x-a0.x)*ux+(at.y-a0.y)*uy)/uu;
  const OFF=1e4, M=g.getTransform(), gr=g.createLinearGradient(a0.x+OFF,a0.y,a0.x+OFF+ux*k,a0.y+uy*k);
  // Сборка 95 (ревью 18.11, п. 3): тень — узкая полоса под самим загибом (CORNER_SHADOW_W вылета), без ореола
  // по следу шапки: широкая размытая тень ложилась на сталь тёмным пятном и читалась пригаром.
  gr.addColorStop(0,"rgba(0,0,0,1)"); gr.addColorStop(CORNER_SHADOW_W,"rgba(0,0,0,0)"); gr.addColorStop(1,"rgba(0,0,0,0)");
  g.save(); g.shadowColor=`rgba(10,5,2,${(CORNER_SHADOW_A*e).toFixed(3)})`; g.shadowBlur=Math.max(1,2*sx*e);
  g.shadowOffsetX=-OFF*M.a; g.shadowOffsetY=-OFF*M.b; g.fillStyle=gr;
  path(S.map(q=>({x:q.x+OFF,y:q.y}))); g.fill(); g.restore();
  }
  const top=cornerTopColor(mid), under=cornerUnderColor(mid);
  for(let i=0;i<CORNER_CURL_STRIPS;i++){
    const s0=hinge+reach*i/CORNER_CURL_STRIPS, s1=hinge+reach*(i+1)/CORNER_CURL_STRIPS;
    let Q=clipPoly(P,m.x,m.y,s0); if(Q.length) Q=clipPoly(Q,-m.x,-m.y,-s1); if(!Q.length) continue;
    const f=along(reach*(i+.5)/CORNER_CURL_STRIPS), c=Math.cos(f);
    const col=c>=0 ? top.map(v=>v*(.72+.28*c)) : under.map(v=>v*(.80+.20*-c));
    path(dense(Q).map(bend)); g.fillStyle=rgb(col); g.fill();
    g.strokeStyle=rgb(col); g.lineWidth=Math.max(.6,.6*sx); g.stroke();   // шов между полосами не виден
  }
  // кромка завитка — тонкая тёмная линия по краю листа (без петли)
  const D=dense(P); g.strokeStyle=rgb(under.map(v=>v*.62)); g.lineWidth=Math.max(1,1*sx); g.beginPath();
  let on=false;
  D.forEach((p,i)=>{ const q=D[(i+1)%D.length], onHinge=Math.abs(p.x*m.x+p.y*m.y-hinge)<1e-6 && Math.abs(q.x*m.x+q.y*m.y-hinge)<1e-6;
    if(onHinge){ on=false; return; } const a=bend(p), b=bend(q); if(!on){ g.moveTo(a.x,a.y); on=true; } g.lineTo(b.x,b.y); });
  g.stroke();
}
function drawSpatula(g,screen,d,sx,sy){
  const {tx,ty,nx,ny,a}=edgeFrame(d), w=.13, back=.10, fwd=.24;
  const P=[[-w,-back],[w,-back],[w*.8,fwd],[-w*.8,fwd]].map(([u,v])=>screen({x:a.x+tx*u+nx*v,y:a.y+ty*u+ny*v}));
  g.fillStyle="#b9b6ad"; g.globalAlpha=.9; g.beginPath(); g.moveTo(P[0].x,P[0].y);
  for(let i=1;i<P.length;i++) g.lineTo(P[i].x,P[i].y);
  g.closePath(); g.fill(); g.globalAlpha=1;
}
function drawLiftedEdge(g,screen,d,sx,sy){
  const css=Math.min(2,devicePixelRatio||1)*sy, {tx,ty,a}=edgeFrame(d), half=.32, up=Math.max(1,3*css);
  const p=screen({x:a.x-tx*half,y:a.y-ty*half}), q=screen({x:a.x+tx*half,y:a.y+ty*half});
  // тень под приподнятой кромкой и сама кромка чуть выше
  g.fillStyle="rgba(6,3,1,.42)"; g.beginPath();
  g.moveTo(p.x,p.y); g.lineTo(q.x,q.y); g.lineTo(q.x,q.y+up*.8); g.lineTo(p.x,p.y+up*.8); g.closePath(); g.fill();
  g.strokeStyle="rgba(240,226,190,.9)"; g.lineWidth=Math.max(1,1.6*sy);
  g.beginPath(); g.moveTo(p.x,p.y-up); g.lineTo(q.x,q.y-up); g.stroke();
}
// Купол: светлая выпуклость с тенью и бликом, выше с ростом (условность: ×3 по высоте, как всё).
function drawDomes(g,screen,H,zk){
  // Пологий купол того же теста: тень у подножия справа-снизу, чуть светлее верх, узкий блик.
  // Сборка 92 (ревью сборки 89: «блики читаются как пузыри воды или стеклянные капли»): купол — цвет теста под
  // ним (верхняя грань в этой точке), почти непрозрачный, блик мягкий. Было: полупрозрачный кремовый овал с белым
  // бликом — на золотой корке он выглядел стеклянной каплей, и его принимали за маргарин.
  for(const d of domes){
    let top=null;
    for(let i=dish.faces.length-1;i>=0;i--){ const f=dish.faces[i]; if(f.kind==="dough" && pointInFace(f.points,d.x,d.y)){ top=f; break; } }
    const col=top ? dishCrustColor(top) : [238,226,192];
    const c=screen(d), lift=H ? H.at(d)*zk : 0, up=(.6+1.6*d.grow)*zk*RELIEF_K;
    const e=screen({x:d.x+d.r,y:d.y}), f=screen({x:d.x,y:d.y+d.r});
    const rx=Math.hypot(e.x-c.x,e.y-c.y), ry=Math.hypot(f.x-c.x,f.y-c.y), y0=c.y-lift;
    g.fillStyle="rgba(60,38,16,.18)";
    g.beginPath(); g.ellipse(c.x+rx*.12,y0+ry*.18,rx*1.02,ry*1.02,0,0,Math.PI*2); g.fill();
    g.fillStyle=`rgba(${col.map(v=>Math.min(255,Math.round(v*1.05))).join(",")},.94)`;
    g.beginPath(); g.ellipse(c.x,y0-up*.5,rx*.96,ry*.96+up*.3,0,0,Math.PI*2); g.fill();
    g.fillStyle="rgba(255,244,214,.22)";
    g.beginPath(); g.ellipse(c.x-rx*.28,y0-up*.8-ry*.28,rx*.42,ry*.26,-.35,0,Math.PI*2); g.fill();
  }
}
// ─── Стол: куски выдавлены по пикселям (владелица 17.09 о сборках 24–25: «как-то не очень
// выглядит» — стенки по рёбрам граней торчали «ножками» и ложились на соседние куски).
// Каждый пиксель основания знает верхнюю грань, высоту и стопку слоёв под собой. Столбец
// пикселей рисуется от ближнего края к дальнему, как рельеф в воксельных движках: стенка идёт
// ровно по контуру куска и сама прячется за ближними кусками. Картинка считается один раз на
// рез (кэш) и дальше только копируется.
// Условности, не физика: высота ×Z_EXAG и подушка ×1,4 (потолок 5 мм); стенка разреза делит
// высоту по настоящим толщинам слоёв в этом месте; у разреза начинка видна полоской по верху
// (так читаются щели с бананом на видео уличного роти); сгиб — гладкий бок теста без слоёв.
const SLAB_MM = 5, SLAB_GAIN = 1.4;
// Верх теста на столе: подушка ×1,4 с потолком. Берётся поверхность теста (atBase): под открытыми
// ломтиками это верх листа, а не ломтика, — иначе сглаживание поднимало вокруг ломтиков «шатёр»
// (проверка 17.09). Ломтик сверху добавляет свой профиль ×FILL_VIS×1,4.
const slabTop = (H,p) => Math.min(SLAB_MM, Math.max(0, H.atBase ? H.atBase(p) : H.at(p))*SLAB_GAIN);
const TABLE_FLAP_LINES = false;        // сборка 88: тень и губа у кромок клапанов на столе (кресты на корке) — выключены
const CUT_RIM = 0.014;                 // ширина полоски начинки у разреза, доли роти (≈4 CSS px)
const SHADOW_DX = .45, SHADOW_DY = .12; // тень на столе: сдвиг на единицу высоты
const TABLE_K = 8;                     // сколько слоёв помнит пиксель (при переполнении выпадает нижний слой теста над низом, не начинка)
const TABLE_RELIEF = 0.25;             // доля мелкого рельефа верха (остальное — крупно сглажено)
let tableCanvas = null;
// Всё, что не зависит от вида, считается один раз на снимок материала: высоты вершин (мм),
// цвета вершин, номера слоёв, какие грани стоят у резов. Поворот и ресайз это не пересчитывают.
function tableFaceData(faces,H){
  const cache=tableFaceData.cache||(tableFaceData.cache=new WeakMap());
  const key=(dish.panTime||0).toFixed(3)+"|"+(dish.flips||0)+"|"+SHOW_THROUGH;
  const hit=cache.get(faces);
  if(hit && hit.key===key) return hit;
  // Цвет вершины — среднее цветов граней того же слоя в этой точке: иначе верх — мозаика
  // квадратиков сетки жарки.
  const vkey=(p,f)=>Math.round(p.x*2e4)+","+Math.round(p.y*2e4)+(f.turned ? "t" : "f");
  const acc=new Map();
  for(const f of faces){
    if(f.kind!=="dough") continue;
    // сборка 86: вершины несут фон корки, прожарку и близость к краю; пятна кладёт topColor попиксельно —
    // по гладким (усреднённым по вершинам) числам, иначе край пятна ступенькой шёл по рёбрам граней
    const P=crustFace(f), c=P.ground;
    for(const p of f.points){ const k=vkey(p,f), a=acc.get(k); if(a){ a[0]+=c[0]; a[1]+=c[1]; a[2]+=c[2]; a[3]++; a[4]+=P.c; a[5]+=P.edge; } else acc.set(k,[c[0],c[1],c[2],1,P.c,P.edge]); }
  }
  const V=faces.map(f=>{
    const m=f.points.length, base=new Float32Array(m), lift=new Float32Array(m), cs=new Float32Array(m*3), ce=new Float32Array(m*2);
    const b0=f.kind==="filling" && f.pc ? slabTop(H,f.pc) : null;   // ломтик — один уровень на весь диск
    f.points.forEach((p,k)=>{
      base[k]=b0!==null ? b0 : slabTop(H,p);
      let c;
      if(f.kind==="filling"){ lift[k]=fillHeight(f,p)*FILL_VIS*SLAB_GAIN; c=BANANA_FLESH[f.source%3]; }
      else { const a=acc.get(vkey(p,f)); c=[a[0]/a[3],a[1]/a[3],a[2]/a[3]]; ce[k*2]=a[4]/a[3]; ce[k*2+1]=a[5]/a[3]; }
      cs[k*3]=c[0]; cs[k*3+1]=c[1]; cs[k*3+2]=c[2];
    });
    return {base,lift,cs,ce};
  });
  const layer=new Int32Array(faces.length), isFill=new Uint8Array(faces.length);
  { const m=new Map(); faces.forEach((f,i)=>{ const k=f.kind+":"+f.source+":"+f.turned; if(!m.has(k)) m.set(k,m.size); layer[i]=m.get(k); isFill[i]=f.kind==="filling" ? 1 : 0; }); }
  const boxes=faces.map(f=>{ let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const p of f.points){ if(p.x<x0)x0=p.x; if(p.x>x1)x1=p.x; if(p.y<y0)y0=p.y; if(p.y>y1)y1=p.y; }
    return {cx:(x0+x1)/2,cy:(y0+y1)/2,r:Math.hypot(x1-x0,y1-y0)/2}; });
  const crust=faces.map(f=>f.kind==="dough" ? crustFace(f) : null);
  const out={key,V,layer,isFill,boxes,crust,cutFace:new Map()};
  cache.set(faces,out); return out;
}
// Грани далеко от резов попиксельно не проверяются; радиус зависит от размера пикселя (вид A/B).
function tableCutFaces(D,cuts,reach){
  const k=reach.toFixed(4), hit=D.cutFace.get(k); if(hit) return hit;
  const out=new Uint8Array(D.boxes.length);
  if(cuts.length) D.boxes.forEach((b,i)=>{
    const rad=b.r+reach;
    for(const c of cuts){
      const ax=b.cx-c.ax, ay=b.cy-c.ay, along=ax*c.ux+ay*c.uy;
      if(along<-rad || along>c.len+rad) continue;
      if(Math.abs(-ax*c.uy+ay*c.ux)-c.half<rad){ out[i]=1; break; }
    }
  });
  D.cutFace.set(k,out); return out;
}
// Полосы стенки разреза: стопка снизу вверх делит высоту по своим толщинам (мм); у теста —
// мякиш и две корочки: снизу сторона, что смотрит вниз, сверху — что вверх.
function cutWallBands(stack,p){
  const bands=[]; let tot=0;
  for(const f of stack){ const w=Math.max(f.kind==="filling" ? .8 : .3, layerMM(f,p)); bands.push({f,w}); tot+=w; }
  let acc=0;
  for(const b of bands){
    b.from=acc/tot; acc+=b.w; b.to=acc/tot;
    if(b.f.kind==="dough"){
      const d=b.f.turned ? 1 : 0, c0=dishCookColor(b.f,d,false), c1=dishCookColor(b.f,1-d,false);
      b.c0=c0; b.c1=c1; b.crumb=c0.map((v,k)=>(v+c1[k])/2*.7+62);
    }
  }
  return bands;
}
// Рабочие массивы рельефа живут между кадрами: при повороте он считается каждый кадр, и
// новые массивы на каждый кадр давали мегабайты мусора (проверка 17.09).
const tablePool = {cap:0, capOut:0};
function tableArrays(N,NO){
  const P=tablePool, K=TABLE_K;
  if(P.cap<N){
    const cap=Math.ceil(N*1.25);
    Object.assign(P,{cap, tf:new Int32Array(cap), th:new Float32Array(cap), tl:new Float32Array(cap), tu:new Float32Array(cap), tv:new Float32Array(cap),
      col:new Float32Array(cap*3), pf:new Int32Array(cap*K), pn:new Uint8Array(cap), pd:new Uint8Array(cap),
      m:new Float32Array(cap), v:new Float32Array(cap), b1:new Float32Array(cap), b2:new Float32Array(cap), b3:new Float32Array(cap), b4:new Float32Array(cap)});
  }
  if(P.capOut<NO){
    const cap=Math.ceil(NO*1.25);
    Object.assign(P,{capOut:cap, out:new Uint8ClampedArray(cap*4), sh:new Float32Array(cap), s1:new Float32Array(cap)});
  }
  P.tf.fill(-1,0,N); P.pn.fill(0,0,N); P.pd.fill(0,0,N); P.tl.fill(0,0,N);
  P.out.fill(0,0,NO*4); P.sh.fill(0,0,NO);
  return P;
}
// Скользящее среднее по строкам и столбцам в прямоугольнике bw×bh (суммы, без деления).
function boxSum(a,o,tmp,bw,bh,r){
  for(let y=0;y<bh;y++){ let acc=0; const row=y*bw; for(let x=-r;x<bw;x++){ if(x+r<bw) acc+=a[row+x+r]; if(x-r-1>=0) acc-=a[row+x-r-1]; if(x>=0) tmp[row+x]=acc; } }
  for(let x=0;x<bw;x++){ let acc=0; for(let y=-r;y<bh;y++){ if(y+r<bh) acc+=tmp[(y+r)*bw+x]; if(y-r-1>=0) acc-=tmp[(y-r-1)*bw+x]; if(y>=0) o[y*bw+x]=acc; } }
  return o;
}
function renderDishTable(faces,screen,H,zk,W,Hc,s,opts={}){
  const t0=performance.now(), n=faces.length, shift=pieceShiftLive(faces), D=tableFaceData(faces,H);
  const P=new Array(n);
  let X0=Infinity,X1=-Infinity,Y0=Infinity,Y1=-Infinity;
  for(let i=0;i<n;i++){
    const f=faces[i], o=shift && shift.get(f);
    const q=P[i]=f.points.map(p=>screen(o ? {x:p.x+o.x,y:p.y+o.y} : p));
    for(const p of q){ if(p.x<X0)X0=p.x; if(p.x>X1)X1=p.x; if(p.y<Y0)Y0=p.y; if(p.y>Y1)Y1=p.y; }
  }
  X0=Math.max(0,Math.floor(X0)); X1=Math.min(W,Math.ceil(X1)); Y0=Math.max(0,Math.floor(Y0)); Y1=Math.min(Hc*2,Math.ceil(Y1));
  const bw=X1-X0, bh=Y1-Y0;
  if(!(bw>0 && bh>0) || bw*bh>8e6) return null;
  // Верх рельефа ограничен сверху: потолок теста плюс профиль ломтика.
  const maxUp=Math.ceil((SLAB_MM+FILL_MM*FILL_VIS*SLAB_GAIN)*zk)+2;
  const N=bw*bh, K=TABLE_K, padX=Math.ceil(SHADOW_DX*maxUp*RELIEF_K)+4, padY=Math.ceil(SHADOW_DY*maxUp*RELIEF_K)+4;
  const OW=bw+padX, OH=bh+maxUp+padY, NO=OW*OH;
  const A=tableArrays(N,NO), {tf,th,tl,tu,tv,col,pf,pn,pd}=A, layer=D.layer, isFill=D.isFill;
  if(!A.ck || A.ck.length<N*2) A.ck=new Float32Array(N*2);   // прожарка и край корки в пикселе (сборка 86)
  const ck=A.ck;
  // Грани идут снизу вверх: последняя накрывшая пиксель — его верх.
  for(let i=0;i<n;i++){
    const q=P[i], ps=faces[i].points, {base,lift,cs,ce}=D.V[i], dough=faces[i].kind==="dough";
    for(let t=1;t+1<q.length;t++){
      const Aa=q[0], B=q[t], C=q[t+1];
      const area=(B.x-Aa.x)*(C.y-Aa.y)-(B.y-Aa.y)*(C.x-Aa.x);
      if(Math.abs(area)<1e-9) continue;
      // Барицентрики линейны по x: считаем на начале отрезка строки и шагаем.
      const inv=1/area, dax=-(C.y-B.y)*inv, dbx=-(Aa.y-C.y)*inv;
      const y0=Math.max(Y0,Math.floor(Math.min(Aa.y,B.y,C.y))), y1=Math.min(Y1-1,Math.ceil(Math.max(Aa.y,B.y,C.y)));
      const E=[Aa,B,B,C,C,Aa];
      for(let y=y0;y<=y1;y++){
        const py=y+.5;
        // отрезок строки внутри треугольника: пересечения строки с рёбрами
        let xl=Infinity, xr=-Infinity;
        for(let e=0;e<6;e+=2){
          const P1=E[e], P2=E[e+1];
          if((P1.y<=py && P2.y>=py) || (P2.y<=py && P1.y>=py)){
            if(P1.y===P2.y){ if(P1.x<xl)xl=P1.x; if(P2.x<xl)xl=P2.x; if(P1.x>xr)xr=P1.x; if(P2.x>xr)xr=P2.x; continue; }
            const x=P1.x+(P2.x-P1.x)*(py-P1.y)/(P2.y-P1.y);
            if(x<xl)xl=x; if(x>xr)xr=x;
          }
        }
        const xa=Math.max(X0,Math.ceil(xl-.5)), xb=Math.min(X1-1,Math.floor(xr-.5));
        if(xa>xb) continue;
        let la=((C.x-B.x)*(py-B.y)-(C.y-B.y)*(xa+.5-B.x))*inv, lb=((Aa.x-C.x)*(py-C.y)-(Aa.y-C.y)*(xa+.5-C.x))*inv;
        const row=(y-Y0)*bw-X0;
        for(let x=xa;x<=xb;x++, la+=dax, lb+=dbx){
          const lc=1-la-lb, c=row+x;
          let cnt=pn[c], dup=false;
          for(let k=0;k<cnt;k++) if(layer[pf[c*K+k]]===layer[i]){ dup=true; break; }
          if(!dup){
            // При переполнении выпадает средний слой: нижний нужен для поджаристой полосы стенки.
            // Выпадает нижний слой ТЕСТА над низом, начинка — почти никогда: с сборки 60 она лежит прямо
            // над листом, во втором слоте, и от пяти складок первой пропадала из стенки разреза
            // (ревью сборки 61). Начинку пропускаем; если начинка в самом низу (переворот до складок),
            // сохраняем и первый слой теста над ней — он и есть лист для полосы стенки; если выше одна
            // начинка — уходит верхний слот.
            if(cnt<K){ pf[c*K+cnt]=i; pn[c]=cnt+1; }
            else {
              const e=c*K+K-1; let d=c*K+1, base=!isFill[pf[c*K]];
              while(d<e && (isFill[pf[d]] || !base)){ if(!isFill[pf[d]]) base=true; d++; }
              pf.copyWithin(d,d+1,e+1); pf[e]=i;
            }
            if(dough && pd[c]<255) pd[c]++;
          }
          tf[c]=i;
          th[c]=(la*base[0]+lb*base[t]+lc*base[t+1])*zk;
          tl[c]=dough ? 0 : (la*lift[0]+lb*lift[t]+lc*lift[t+1])*zk;
          tu[c]=la*ps[0].x+lb*ps[t].x+lc*ps[t+1].x;
          tv[c]=la*ps[0].y+lb*ps[t].y+lc*ps[t+1].y;
          col[c*3]=la*cs[0]+lb*cs[t*3]+lc*cs[(t+1)*3];
          col[c*3+1]=la*cs[1]+lb*cs[t*3+1]+lc*cs[(t+1)*3+1];
          col[c*3+2]=la*cs[2]+lb*cs[t*3+2]+lc*cs[(t+1)*3+2];
          if(dough){ ck[c*2]=la*ce[0]+lb*ce[t*2]+lc*ce[(t+1)*2]; ck[c*2+1]=la*ce[1]+lb*ce[t*2+1]+lc*ce[(t+1)*2+1]; }
        }
      }
    }
  }
  const t1=performance.now();
  // Верх теста сглаживается в пределах теста: мелко (~2 CSS px) — грани сетки иначе видны
  // ступеньками; крупно (~30 CSS px) — при ×5 однослойные места читались ямами, края клапанов —
  // хребтами (проба 17.09). Остаётся TABLE_RELIEF мелкого рельефа. Ломтики в среднее не входят и
  // ложатся поверх сглаженного теста своим профилем (иначе вокруг них вырастал бугор).
  {
    const {m,v,b1,b2,b3,b4}=A;
    for(let c=0;c<N;c++){ const on=tf[c]>=0; m[c]=on ? 1 : 0; v[c]=on ? th[c] : 0; }
    const r1=Math.max(1,Math.round(2*s)), r2=Math.max(3,Math.round(30*s));
    boxSum(v,b1,b3,bw,bh,r1); boxSum(m,b2,b3,bw,bh,r1);
    for(let c=0;c<N;c++) b4[c]=b2[c]>0 ? b1[c]/b2[c] : 0;   // мелко сглаженный верх
    boxSum(v,b1,b3,bw,bh,r2); boxSum(m,b2,b3,bw,bh,r2);
    for(let c=0;c<N;c++) if(tf[c]>=0){
      const fine=b4[c]>0 ? b4[c] : th[c], coarse=b2[c]>0 ? b1[c]/b2[c] : th[c];
      th[c]=TABLE_RELIEF*fine+(1-TABLE_RELIEF)*coarse+tl[c];
    }
  }
  // Размер пикселя в долях роти — по обеим осям: стол сжат по вертикали, и поперёк
  // горизонтального реза пиксель «длиннее» (вид A: полоска пропадала в 40 % столбцов).
  const o0=screen({x:0,y:0}), ox=screen({x:1,y:0}), oy=screen({x:0,y:1});
  const unit=Math.max(1/(Math.hypot(ox.x-o0.x,ox.y-o0.y)||1),1/(Math.hypot(oy.x-o0.x,oy.y-o0.y)||1));
  const cuts=dish.cuts.map(c=>{ const dx=c.b.x-c.a.x, dy=c.b.y-c.a.y, len=Math.hypot(dx,dy)||1; return {ax:c.a.x,ay:c.a.y,half:c.width/2,ux:dx/len,uy:dy/len,len}; });
  // Полоска начинки — не уже пикселя: в пиксельных видах A/B она иначе пропадает.
  const rimW=Math.max(CUT_RIM,unit*1.05);
  const cutFace=tableCutFaces(D,cuts,rimW+unit*3+.01);
  // Край пятна сглажен на ~полтора пикселя: мелкие точки поля меняются быстрее пикселя (сборка 86, без лесенки)
  const spotAA=Math.max(SPOT_SOFT,0.36*1.5/SPOT_FINE*unit*0.75);
  let ncD=0, ncAlong=0, ncFace=0;   // ncFace — насколько рез смотрит на зрителя (стенка столбца)
  const nearCut=(u,v)=>{
    let hit=false;
    for(const k of cuts){
      const ax=u-k.ax, ay=v-k.ay, along=ax*k.ux+ay*k.uy;
      if(along<-unit || along>k.len+unit) continue;
      const d=Math.abs(-ax*k.uy+ay*k.ux)-k.half;
      if(d>-unit*2 && (!hit || d<ncD)){ hit=true; ncD=Math.max(0,d); ncAlong=along; ncFace=Math.abs(k.ux); }
    }
    return hit;
  };
  const hasFill=c=>{ for(let k=0;k<pn[c];k++) if(faces[pf[c*K+k]].kind==="filling") return true; return false; };
  let UP=1, liftSum=0, liftN=0;
  for(let c=0;c<N;c++) if(tf[c]>=0){ if(th[c]>UP) UP=th[c]; liftSum+=th[c]; liftN++; }
  UP=Math.min(maxUp,Math.ceil(UP)+2);
  const out=A.out, OWu=bw+padX;
  // Тень: силуэт, сдвинутый на свою высоту (и на половину — без просветов), размытый.
  const sh=A.sh, OHu=bh+UP+padY;
  for(let j=0;j<bh;j++) for(let i=0;i<bw;i++){
    const c=j*bw+i; if(tf[c]<0) continue;
    const h=th[c];
    const hsx=h*RELIEF_K;   // тень читает высоту так же, как свет и кромка
    let x=Math.round(i+SHADOW_DX*hsx), y=Math.round(j+UP+SHADOW_DY*hsx); if(x<OWu && y<OHu) sh[y*OWu+x]=1;
    x=Math.round(i+SHADOW_DX*hsx*.5); y=Math.round(j+UP+SHADOW_DY*hsx*.5); if(x<OWu && y<OHu) sh[y*OWu+x]=1;
  }
  const rb=Math.max(1,Math.round(1.5*s)), NOu=OWu*OHu;
  boxSum(sh,sh,A.s1,OWu,OHu,rb);
  const norm=1/((2*rb+1)*(2*rb+1));
  for(let q=0;q<NOu;q++) if(sh[q]>0){ out[q*4]=12; out[q*4+1]=7; out[q*4+2]=3; out[q*4+3]=Math.round(Math.min(1,sh[q]*norm*1.6)*.5*255); }
  const t2=performance.now();
  const cp=Math.max(.7,1.1*s), seam=Math.max(1,Math.round(1.2*s)), stat={fill:0,wallFill:0,rim:0,cutWall:0,crustDown:0,crustUp:0,low:0};
  const flesh=BANANA_FLESH[0], FILL=SECTION_FILL, per=Math.max(8,14*s), cutSeed=dish.cuts.length*.37;
  let R=0,G=0,B=0;
  // Цвет верха: гладкий цвет вершин, ломтики, полоска начинки у разреза, тень клапана, наклон.
  const topColor=(c,i,j,dl,light)=>{
    const f=faces[tf[c]]; let m=light;
    R=col[c*3]; G=col[c*3+1]; B=col[c*3+2];
    if(f.kind==="dough"){   // сборка 86: пятна корки — попиксельно, в координатах материала, круглые
      const P=D.crust[tf[c]];
      if(P && ck[c*2]>=FRY_STEPS[0]){
        const q=f.m ? crustToMaterial(f.m,tu[c],tv[c]) : {x:tu[c],y:tv[c]};
        const k=crustMix({base:P.base,c:ck[c*2],edge:ck[c*2+1],seed:P.seed,side:P.side},q.x,q.y,[R,G,B],spotAA); R=k[0]; G=k[1]; B=k[2];
      }
    }
    if(f.kind==="filling" && f.pc && f.pr>0){
      const d=Math.hypot(tu[c]-f.pc.x,tv[c]-f.pc.y)/f.pr;
      if(f.fill==="egg"){
        if(d>.82){ R=R*.7+70; G=G*.7+42; B=B*.7+8; }
        else { R=EGG_SECTION[0]; G=EGG_SECTION[1]; B=EGG_SECTION[2]; }
        stat.fill++;
      } else {
        if(d>.84){ R=R*.6+78.4; G=G*.6+62.4; B=B*.6+31.2; }
        for(let k=0;k<3;k++){ const a=(k*120+f.source*53)*Math.PI/180;
          if(Math.hypot(tu[c]-f.pc.x-Math.cos(a)*f.pr*.16,tv[c]-f.pc.y-Math.sin(a)*f.pr*.16)<f.pr*.055){ R=R*.55+57.6; G=G*.55+43.2; B=B*.55+24.3; } }
        stat.fill++;
      }
    } else if(cutFace[tf[c]] && nearCut(tu[c],tv[c]) && ncD<rimW && hasFill(c)){
      // полоска начинки: жёлто-яичная с неровными бледными ломтиками вдоль реза, у кромки темнее
      const pu=per*unit, k=Math.floor(ncAlong/pu), hsh=Math.abs(Math.sin(k*12.9898+cutSeed)*43758.5453)%1;
      const ph=((ncAlong%pu)+pu)%pu/pu-.5-(hsh-.5)*.3, across=ncD/rimW-.5-(hsh-.5)*.2, sz=.26+.16*hsh;
      const ban=hsh>.18 && (ph/sz)**2+(across/.44)**2<1, src=ban ? BANANA_FLESH[k&3 ? 0 : 2] : FILL;
      R=src[0]; G=src[1]; B=src[2];
      if(ncD<Math.min(unit*1.2,rimW*.45)) m*=.75;   // в пиксельных видах затемнение съедало всю полоску (оливковый цвет)
      stat.rim++;
    }
    if(f.kind==="dough" && s>=.9 && TABLE_FLAP_LINES){
      // клапан выше соседа: у его кромки мягкая тень вниз-вправо, на самой кромке — светлая губа
      // (только вид C: в пиксельных видах пиксель крупнее кромки — там это шум)
      // Сборка 88 (видимый жест): выключено — кромки клапанов конверта рисовали на корке крест и дуги
      // от углов, их принимали за разрезы (разбор 17.11, п. 3). Разрезом на корке остаётся только рез.
      if(i>=seam && j>=seam){ const nb=c-seam*bw-seam; if(tf[nb]>=0 && pd[nb]>pd[c]) m*=.87; }
      if(i+seam<bw && j+seam<bh){ const nb=c+seam*bw+seam; if(tf[nb]>=0 && pd[nb]<pd[c] && faces[tf[nb]].kind==="dough") m*=1.05; }
    }
    m*=1-.3*dl; R*=m; G*=m; B*=m;
  };
  // Стенка: у разреза — слои стопки, у сгиба — бок теста с поджаристым низом.
  const wallOf=c=>{
    // Стенка столбца всегда смотрит на зрителя, поэтому слои среза показывает только рез,
    // который идёт поперёк взгляда (нормаль вдоль y материала). У продольного реза рядом стоит
    // бок сгиба, и с палитрой среза он читался бледными язычками (проверка сборки 31).
    const f=faces[tf[c]], cut=cutFace[tf[c]] && nearCut(tu[c],tv[c]) && ncD<unit*1.2+.004;
    let bottom=f;
    for(let k=0;k<pn[c];k++){ const g_=faces[pf[c*K+k]]; if(g_.kind==="dough"){ bottom=g_; break; } }
    const low=dishCookColor(bottom,bottom.turned ? 1 : 0,false).map(v=>v*.82);
    if(!cut){
      const side=f.kind==="filling" ? flesh.map(v=>v*.82) : [col[c*3]*.8,col[c*3+1]*.8,col[c*3+2]*.8];
      return {cut:false,side,low};
    }
    // узор ломтиков в срезе привязан к материалу (вдоль реза), а не к столбцу экрана
    return {cut:true,along:ncAlong,bands:cutWallBands(Array.from(pf.subarray(c*K,c*K+pn[c]),k=>faces[k]),{x:tu[c],y:tv[c]})};
  };
  const wallColor=(w,z,h,i)=>{
    const phi=Math.max(0,Math.min(.9999,z/h)), ao=.84+.16*phi;
    let c, kind;
    // поджаристый низ на боку сгиба — полоска, а не весь бок: при низкой стенке 1,2 пикселя
    // съедали её целиком (проверка сборки 31)
    if(!w.cut){ if(z<Math.min(Math.max(1.2*s,.22*h),.4*h)){ c=w.low; stat.low++; kind="low"; } else { c=w.side; kind="side"; } }
    else {
      let b=w.bands[w.bands.length-1];
      for(const x of w.bands) if(phi<x.to){ b=x; break; }
      const zf=b.from*h, zt=b.to*h;
      if(b.f.kind==="filling"){
        const pu=per*unit, ph=((w.along%pu)+pu)%pu/pu-.5, dz=(z-(zf+zt)/2)/Math.max(.5,(zt-zf)/2);
        if(b.f.fill==="egg"){ c=EGG_SECTION; kind="filling"; }
        else { c=(ph/.34)**2+(dz/.62)**2<1 ? flesh : FILL; kind="filling"; }
        stat.wallFill++;
      } else { // корка не толще 40 % полосы, но не тоньше пикселя: иначе на низкой стенке её нет вовсе
        const cw=Math.max(.9,Math.min(cp,.4*(zt-zf)));
        if(z-zf<cw){ c=b.c0; stat.crustDown++; kind="crustDown"; }
        else if(zt-z<cw){ c=b.c1; stat.crustUp++; kind="crustUp"; }
        else { c=b.crumb; kind="crumb"; } }
      stat.cutWall++;
    }
    R=c[0]*ao; G=c[1]*ao; B=c[2]*ao;
    return kind;
  };
  // Наклон верха → свет слева-сверху-издалека (как у подушки на таве), вполсилы. Свет считается
  // в экране, поэтому при повороте он не крутится вместе с блюдом.
  const slopeK=.5*TILT/Math.max(.2,VIEW_UP)*RELIEF_K, dbgCol=opts.debugColumn, owner=dbgCol!==undefined ? new Int32Array(OHu).fill(-1) : null;
  for(let i=0;i<bw;i++){
    let ymin=Infinity;
    for(let j=bh-1;j>=0;j--){
      const c=j*bw+i; if(tf[c]<0) continue;
      const h=th[c], rt=Math.round(j-h);
      if(rt>=ymin) continue;
      const rEnd=Math.min(j,ymin-1), lip=Math.min(1.6*s+.4,h*.2);
      // Кромка — только там, где ближний сосед заметно ниже: иначе пологий склон рисовался
      // полосами, как горы на карте (проба 17.09). Ступенька меряется в «прежней» высоте
      // (×RELIEF_K), иначе при низком роти кромок нет вовсе (проверка сборки 31).
      const near=j+1<bh && tf[c+bw]>=0 ? th[c+bw] : 0;
      const hR=h*RELIEF_K, edge=(h-near)*RELIEF_K>Math.min(1.6*s+.4,hR*.2)+1.5;
      const far=j>0 && tf[c-bw]>=0 ? th[c-bw] : h, left=i>0 && tf[c-1]>=0 ? th[c-1] : h, right=i+1<bw && tf[c+1]>=0 ? th[c+1] : h;
      const gy=((edge ? h : near)-far)*.5*slopeK, gx=(right-left)*.5*slopeK;
      const light=Math.max(.8,Math.min(1.15,(.42*gx+.5*gy+.76)/Math.hypot(gx,gy,1)/.76));
      let w=null;
      for(let r=rt;r<=rEnd;r++){
        const z=j-r;
        if(!edge || z>=h-lip-.5) topColor(c,i,j,edge ? Math.max(0,Math.min(1,(h-z)/(lip+.5))) : 0,light);
        else { if(!w) w=wallOf(c); wallColor(w,z,h,i+X0); }
        const q=((r+UP)*OWu+i)*4; out[q]=R; out[q+1]=G; out[q+2]=B; out[q+3]=255;
        if(owner && i===dbgCol && r+UP>=0 && r+UP<OHu) owner[r+UP]=c;
      }
      ymin=rt;
    }
  }
  // Край силуэта без лесенки (сборка 86): пиксель роти, у которого сосед по кресту не роти, кладём на 3/4
  // непрозрачности — грубое, но дешёвое сглаживание; рисунок внутри не трогаем.
  {
    const E=[];
    for(let y=1;y<OHu-1;y++) for(let x=1;x<OWu-1;x++){
      const q=(y*OWu+x)*4; if(out[q+3]!==255) continue;
      if(out[q-1]!==255 || out[q+7]!==255 || out[q-OWu*4+3]!==255 || out[q+OWu*4+3]!==255) E.push(q);
    }
    for(const q of E) out[q+3]=190;
  }
  const t3=performance.now();
  const R_={x:X0,y:Y0-UP,w:OWu,h:OHu,up:UP,bw,bh,th,tf,data:out,owner,
    lift:liftN ? liftSum/liftN : 0,
    ms:t3-t0,stages:[t1-t0,t2-t1,t3-t2].map(v=>+v.toFixed(1)),stat,texels:N,
    // образец стенки для проверок: цвет и полоса стенки пикселя основания (i,j) на высоте z
    probeWall(i,j,z){ const c=j*bw+i; if(tf[c]<0) return null; const w=wallOf(c), kind=wallColor(w,z,th[c],i+X0); return {kind,cut:w.cut,rgb:[R,G,B]}; },
    stack(i,j){ const c=j*bw+i; return Array.from(pf.subarray(c*K,c*K+pn[c])); },
    point(i,j){ const c=j*bw+i; return tf[c]<0 ? null : {x:tu[c],y:tv[c]}; },
    unit, rimW};
  // Буферы общие: снимок, который будет храниться, копируется.
  if(opts.keep){ R_.data=out.slice(0,NOu*4); R_.th=th.slice(0,N); R_.tf=tf.slice(0,N); }
  return R_;
}
// Картинки стола хранятся для трёх последних состояний: отмена и отказ от поворота не
// пересчитывают рельеф заново (проверка 17.09: отмена стоила в 4–6 раз дороже).
const TABLE_LRU = 3;
function tableBlit(R){
  if(!R || typeof document==="undefined") return false;
  if(!tableCanvas){
    tableCanvas=document.createElement("canvas");
    // Потеря контекста стирает картинку: после восстановления кладём её заново (иначе блюдо
    // пропадало до следующего реза).
    if(tableCanvas.addEventListener){
      tableCanvas.addEventListener("contextlost",()=>{ for(const e of drawDishTable.lru||[]) e.drawn=false; });
      tableCanvas.addEventListener("contextrestored",()=>{ for(const e of drawDishTable.lru||[]) e.drawn=false; });
    }
  }
  if(tableCanvas.width!==R.w || tableCanvas.height!==R.h){ tableCanvas.width=R.w; tableCanvas.height=R.h; }
  const tc=tableCanvas.getContext("2d");
  if(!(tc && tc.createImageData && tc.putImageData)) return false;
  let img=tableBlit.img;
  if(!img || img.width!==R.w || img.height!==R.h) img=tableBlit.img=tc.createImageData(R.w,R.h);
  img.data.set(R.data.subarray(0,R.w*R.h*4)); tc.putImageData(img,0,0);
  return true;
}
function drawDishTable(g,screen,faces,H,zk,sx,sy){
  const W=Math.round(cv.width*sx), Hc=Math.round(cv.height*sy), s=Math.min(2,devicePixelRatio||1)*Math.min(sx,sy);
  // Пока блюдо крутят, рельеф считается каждый кадр — вполовину разрешения (вчетверо дешевле);
  // на отпускании — полный.
  const q=(dishTwist||dishPinch) && W>400 ? .5 : 1, sc=q===1 ? screen : p=>{ const a=screen(p); return {x:a.x*q,y:a.y*q}; };
  const o=screen({x:0,y:0}), e=screen({x:1,y:1});
  const key=[W,Hc,o.x,o.y,e.x,e.y,zk,s,q,dish.panTime||0,dish.flips||0,SHOW_THROUGH,dishSpread].map(v=>+(+v).toFixed(3)).join(",");
  const lru=drawDishTable.lru||(drawDishTable.lru=[]);
  let C=drawDishTable.cache;
  if(!C || C.faces!==faces || C.key!==key){
    const k=lru.findIndex(x=>x.faces===faces && x.key===key);
    if(k>=0){ C=lru[k]; C.drawn=false; }
    else {
      const R=renderDishTable(faces,sc,H,zk*q,Math.round(W*q),Math.round(Hc*q),s*q,{keep:q===1});
      C={faces,key,R,q,drawn:false};
      if(q===1){ lru.unshift(C); if(lru.length>TABLE_LRU) lru.length=TABLE_LRU; }
    }
    drawDishTable.cache=C;
    tableBlit.shown=null;
  }
  if(!C.R) return;
  const tc=tableCanvas && tableCanvas.getContext && tableCanvas.getContext("2d");
  if(tc && tc.isContextLost && tc.isContextLost()){ C.drawn=false; return; }
  // Холст один на все снимки: если на нём не этот снимок, кладём его заново.
  if(!C.drawn || tableBlit.shown!==C){ C.drawn=tableBlit(C.R); if(C.drawn) tableBlit.shown=C; }
  if(!C.drawn) return;
  if(C.q===1) g.drawImage(tableCanvas,C.R.x,C.R.y);
  else { const k=1/C.q, sm=g.imageSmoothingEnabled; g.imageSmoothingEnabled=true; g.drawImage(tableCanvas,C.R.x*k,C.R.y*k,C.R.w*k,C.R.h*k); g.imageSmoothingEnabled=sm; }
}
// Подъём нарисованного верха над плоскостью стола, в пикселях холста: нож режет там, где палец
// видит верх кусков (проверка 17.09: рез ложился на 20–38 CSS px выше пальца).
function tableLiftCanvas(){
  const C=drawDishTable.cache;
  if(!C || !C.R || !dish || dish.mode==="fold" || C.faces!==dish.faces) return 0;
  const sy=variant!=="C" ? (lo.height||1)/(cv.height||1) : 1;
  return C.R.lift/C.q/sy;
}
// Вмятина под пальцем: мягкое тёмное пятно на поверхности, глубже с силой прижима.
// Сборка 95 (ревью 18.11, п. 3): пятно прижима — только на тесте (обрезано по оболочке роти: на стали тёмное
// кольцо у края читалось пригаром) и не у касания, которое поднимает угол (p.lift — палец поддевает, а не жмёт;
// в модели прижим тот же, меняется только картинка).
function drawPressDents(g,screen,H,zk,pose,sx,sy){
  const list=panPress.filter(p=>p.level>.02 && !p.lift), hull=dish && dish.hull;
  if(!list.length) return;
  g.save();
  if(hull && hull.length>2){ g.beginPath(); hull.forEach((q,i)=>{ const c=screen(q); i ? g.lineTo(c.x,c.y) : g.moveTo(c.x,c.y); }); g.closePath(); g.clip(); }
  for(const p of list){
    const c=screen(p), lift=H ? H.at(p)*zk : 0;
    const rx=Math.hypot(screen({x:p.x+PRESS_R,y:p.y}).x-c.x,screen({x:p.x+PRESS_R,y:p.y}).y-c.y);
    const ry=Math.hypot(screen({x:p.x,y:p.y+PRESS_R}).x-c.x,screen({x:p.x,y:p.y+PRESS_R}).y-c.y);
    for(const [k,a] of [[1,.07],[.72,.08],[.45,.09]]){
      g.fillStyle=`rgba(58,32,12,${(a*p.level).toFixed(3)})`;
      g.beginPath(); g.ellipse(c.x,c.y-lift*(1-.25*p.level),rx*k,ry*k,0,0,Math.PI*2); g.fill();
    }
  }
  g.restore();
}
// Бледная разметка конверта: середина листа в половину его размера — сюда кладётся начинка и сюда
// ложатся кромки клапанов. Сторона, которая уже завёрнута, свою линию теряет; у готового конверта
// разметки нет.
function drawFoldGuide(g,screen,sx){
  const E=dish.env; if(!E || envelopeDone() || phase!=="PAN") return;
  const at=(a,b)=>screen({x:E.c.x+E.u.x*a+E.v.x*b,y:E.c.y+E.u.y*a+E.v.y*b});
  const x1=E.h[0]/2, x0=-E.h[1]/2, y1=E.h[2]/2, y0=-E.h[3]/2;
  const lines=[[x1,y0,x1,y1],[x0,y0,x0,y1],[x0,y1,x1,y1],[x0,y0,x1,y0]];   // сгибы сторон +u, −u, +v, −v
  g.save(); g.strokeStyle="rgba(255,246,222,.42)"; g.lineWidth=Math.max(1,1.5*sx); g.setLineDash([5*sx,5*sx]);
  for(let k=0;k<4;k++){
    if(E.done[k]) continue;
    const a=at(lines[k][0],lines[k][1]), b=at(lines[k][2],lines[k][3]);
    g.beginPath(); g.moveTo(a.x,a.y); g.lineTo(b.x,b.y); g.stroke();
  }
  g.restore();
}
// Доска под роти на столе (сборка 80, плейтест 17.11 п. 17: «режут на голом столе»). Одна плоская фигура в
// палитре стенда: прямоугольник по габариту роти с полем BOARD_PAD и тёмная полоска ближнего торца. Она
// говорит, где режут и откуда роти уносят; не двигается, пока роти в руке или его крутят.
const BOARD_PAD = 0.16, BOARD_MAX = 0.47;
function boardRect(){
  const b=dish.cutBounds; if(!b) return null;
  const pose=dishPose(true), w=zone("work"), pad=BOARD_PAD*Math.max(b.right-b.left,b.bottom-b.top);
  const hw=Math.min(w.w*BOARD_MAX,((b.right-b.left)/2+pad)*pose.scale), hh=Math.min(w.h*BOARD_MAX,((b.bottom-b.top)/2+pad)*pose.scale);
  // Роти на столе стоит серединой в середине рабочей зоны (dishPose). Его верх нарисован выше плоскости стола
  // на высоту кусков (tableLiftCanvas) — дальний край доски отодвинут на столько же, иначе поле сверху пропадало.
  return {x0:w.cx-hw,x1:w.cx+hw,y0:Math.max(w.y,w.cy-hh-tableLiftCanvas()),y1:w.cy+hh};
}
function drawBoard(g,sx,sy){
  const B=boardRect(); if(!B) return;
  const P=(x,y)=>({x:prX(x,y)*sx,y:prY(x,y)*sy});
  const a=P(B.x0,B.y0), b=P(B.x1,B.y0), c=P(B.x1,B.y1), d=P(B.x0,B.y1), th=Math.max(2,(d.y-a.y)*.045);
  g.fillStyle="#4a3722"; g.beginPath(); g.moveTo(d.x,d.y); g.lineTo(c.x,c.y); g.lineTo(c.x,c.y+th); g.lineTo(d.x,d.y+th); g.closePath(); g.fill();
  g.fillStyle="#7d6240"; g.beginPath(); g.moveTo(a.x,a.y); g.lineTo(b.x,b.y); g.lineTo(c.x,c.y); g.lineTo(d.x,d.y); g.closePath(); g.fill();
}
function drawDish(g,sx,sy){
  let pose=dishPose(), moving=false;
  if(dishFlight){ drawDishFlight(g,sx,sy,pose); return; }
  // Перелёт на стол (с небольшим подъёмом) и съезд на лоток — плавно от прежнего места к новому (dishShownPose).
  if(dishMove){ pose=dishShownPose(); moving=true; }
  let slide=dishGesture && dishGesture.slide;
  if(!slide && dishBack && dish.mode==="fold"){        // отпущен над тавой: роти возвращается на место
    const u=(performance.now()-dishBack.t0)/1000/BACK_T, e=1-(1-u)*(1-u);
    if(u>=0 && u<1) slide={x:dishBack.slide.x*(1-e),y:dishBack.slide.y*(1-e)}; else dishBack=null;
  }
  // в руке роти чуть приподнят над сталью; нарезанный в руке — уменьшен и над пальцем (dishShownPose)
  if(dishGesture && dishGesture.slide) pose=dishShownPose();
  else if(slide) pose={x:pose.x+slide.x*pose.scale, y:pose.y+slide.y*pose.scale, scale:pose.scale};
  if(dish.mode!=="fold") drawBoard(g,sx,sy);          // доска лежит на столе: роти на неё прилетает и с неё уносится
  const faces=dishGesture&&dishGesture.preview ? dishGesture.preview.faces : dish.faces;
  const T=dishTwist, tc=T ? Math.cos(T.angle) : 1, ts=T ? Math.sin(T.angle) : 0;
  const screen=p=>{ if(T) p=rotAbout(p,T.pivot,tc,ts); const x=pose.x+p.x*pose.scale,y=pose.y+p.y*pose.scale;return{x:prX(x,y)*sx,y:prY(x,y)*sy};};
  const lift=dishGesture && dish.mode==="fold" && dishGesture.anchor && !dishGesture.preview && !dishGesture.press ? dishGesture : null;
  const H=faces===dish.faces ? stackHeights(faces) : previewHeights(faces), zk=pose.scale*Z_EXAG/ROTI_R_MM*VIEW_UP*sy;
  if(lift) drawSpatula(g,screen,lift,sx,sy);
  if(dish.mode!=="fold" && dish.tray) drawTray(g,screen,sx);   // лоток под роти, едет вместе с ним
  if(dish.mode!=="fold" && !moving && !slide && faces===dish.faces) drawDishTable(g,screen,faces,H,zk,sx,sy);   // в руке (на стойку) — плоский вид: рельеф не пересчитывается каждый кадр
  else {
    // Поддетый угол (сборка 88): лист рисуется без шапки угла, шапка — поверх, повёрнутая на петле.
    const ce=dish.mode==="fold" && !moving && !slide && !T && faces===dish.faces ? cornerLiftAmount() : 0;
    const cap=ce>.01 ? cornerLiftCap() : null;
    if(cap){
      g.save(); g.beginPath(); g.rect(-1e4,-1e4,3e4,3e4);
      cap.P.forEach((p,i)=>{ const q=screen(p); i ? g.lineTo(q.x,q.y) : g.moveTo(q.x,q.y); }); g.closePath(); g.clip("evenodd");
    }
    // Сборка 90: у граней шапки нет и тени на таве — она ложилась правее выреза тёмной полосой с жёстким краем
    drawDishFaces(g,faces,screen,H,zk,true,pieceShiftLive(faces),cap ? f=>{ let x=0,y=0; for(const p of f.points){ x+=p.x; y+=p.y; } return pointInFace(cap.P,x/f.points.length,y/f.points.length); } : null);
    if(!moving && !slide && faces===dish.faces) drawMargarineGloss(g,screen,H,zk,sx);
    if(lift && !cap) drawLiftedEdge(g,screen,lift,sx,sy);
    // Rebuild expensive boundary intersections only after a committed geometry
    // change. During a drag the existing flat preview remains immediate.
    if(!moving&&(dish.folds||dish.cuts.length)&&!(dishGesture&&dishGesture.preview)) drawDishSections(g,screen,faces,sx,sy,zk,H);
    if(cap){
      g.restore();
      const lifted=(p,h)=>{ const x=pose.x+p.x*pose.scale, y=pose.y+(p.y-h)*pose.scale; return {x:prX(x,y)*sx,y:prY(x,y)*sy}; };
      drawCornerLift(g,screen,lifted,cap,ce,sx,sy);
    }
  }
  if(dish.mode==="fold" && !moving && !slide) drawFoldGuide(g,screen,sx);
  if(dish.mode==="fold" && !(dishGesture && dishGesture.preview)) drawDomes(g,screen,H,zk);
  if(dish.mode==="fold") drawPressDents(g,screen,H,zk,pose,sx,sy);
  if(dishGesture && !slide && dishGesture.zone!=="middle" && dishGesture.zone!=="serve" && !(dishGesture.press && !dishGesture.moved)){
    const d=dishGesture, o=d.cutShift||{x:0,y:0}, up=dish.mode==="cut" ? tableLiftCanvas()*sy : 0;
    const sh=q=>{ const a=screen({x:q.x+o.x,y:q.y+o.y}); return {x:a.x,y:a.y-up}; };
    const a=sh((d.plan&&d.plan.anchor)||d.anchor||d.start),b=sh((d.plan&&d.plan.target)||d.target||d.end);
    // Сборка 88: за ножом — тонкая тёмная линия по тесту (раньше светлая, на светлом тесте не читалась).
    if(dish.mode==="cut"){ g.strokeStyle=CUT_LINE; g.lineWidth=Math.max(1,1.2*sx); }
    else { g.strokeStyle="#eab562"; g.lineWidth=Math.max(1,2*sx); }
    g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();
    // Короткое лезвие остаётся под пальцем во время реза.
    if(dish.mode==="cut"){g.fillStyle="#d1d2c9";g.fillRect(b.x-2,b.y-5,4,9);}
  }
  // Не засчитанный штрих: линия гаснет за CUT_FADE_S, тесто не разошлось.
  if(cutFade && dish.mode==="cut" && !slide && !moving){
    const u=(performance.now()-cutFade.t0)/1000/CUT_FADE_S;
    if(u>=1) cutFade=null;
    else {
      const o=cutFade.o, up=tableLiftCanvas()*sy, sh=q=>{ const a=screen({x:q.x+o.x,y:q.y+o.y}); return {x:a.x,y:a.y-up}; };
      const a=sh(cutFade.a), b=sh(cutFade.b);
      g.save(); g.globalAlpha=1-u; g.strokeStyle=CUT_LINE; g.lineWidth=Math.max(1,1.2*sx);
      g.beginPath(); g.moveTo(a.x,a.y); g.lineTo(b.x,b.y); g.stroke(); g.restore();
    }
  } else if(cutFade && dish.mode!=="cut") cutFade=null;
}

// ─────────────────────────── построение листа
// Подготовка теста разбита на шаги (решение владельца 22.08.2026):
// шаг 1 — отрезанный от «колбаски» кусочек расплющивается пальцем до ~42% мишени
// (ровно та точка, где раньше стенд начинался); шаг 2 — растягивание шлепками.
const FLAT_START_FRAC = 0.11, START_FRAC = 0.17, TARGET_FRAC = 0.40;
let stepNo = 1;                                // текущий шаг стенда (step занят функцией физики)
let targetR = 1, startR = 1, step1R = 1;       // step1R = цель расплющивания (42% мишени)
let advancedAt = 0;                            // момент авто-перехода на шаг 2 (для баннера)
let gestureScale = 1;                          // масштаб жеста: фиксирован от экрана, не от роста листа
let FLAT_RATE = 1.15;                          // ладонь за секунду заметно плющит пятно
const FLAT_READY = 0.42;                       // выше этого кусок ещё толстый — тянуть рано
let flatH = null;                              // карта нажима: 1 толстое, меньше — где провели
// Мерка листа — меньшая сторона рабочей зоны; от неё доли комка, свежего листа и мишени.
// В раме тава нарисована и не растягивается: мерка ещё и не больше той, при которой готовый лист
// ложится в таву с тем же запасом, что на своём столе (тава в 1,25 раза шире роти). Иначе на
// вечернем экране с глубоким столом лист выходил крупнее сковороды (сборка 41).
function sheetSpan(z){
  const s = Math.min(z.w, z.h);
  if(!frameOn) return s;
  layoutPan();                                   // в раме тава от листа не зависит
  const k = 1 + ((panC.y - horizon())/cv.height) * PERSP;
  return Math.min(s, PAN_R / (1.25 * k * TARGET_FRAC));
}
function build(){
  runTuneAtBuild = { ...TUNE };
  mixedTune = false;
  const z = zone("work"), span = sheetSpan(z);
  R0 = span * (stepNo===1 ? FLAT_START_FRAC : START_FRAC);
  startR = R0;
  targetR = span * TARGET_FRAC;
  step1R  = span * START_FRAC;
  gestureScale = step1R;                       // мах меряем в долях «свежего листа шага 2»
  const h = (R0*2)/(GRID-1);                 // шаг решётки — одинаков везде
  const x0 = z.cx - R0, y0 = z.cy - R0;

  gi.fill(-1);
  const xs=[], ys=[];
  for(let j=0;j<GRID;j++) for(let i=0;i<GRID;i++){
    const x = x0 + i*h, y = y0 + j*h;
    const dx = x - z.cx, dy = y - z.cy;
    if(dx*dx + dy*dy > R0*R0) continue;      // обрезаем круг
    gi[j*GRID+i] = xs.length; xs.push(x); ys.push(y);
  }
  N = xs.length;
  px = Float32Array.from(xs); py = Float32Array.from(ys);
  vx = new Float32Array(N); vy = new Float32Array(N);
  prx = new Float32Array(N); pry = new Float32Array(N);
  pinned = new Uint8Array(N); thick = new Float32Array(N).fill(1);
  flatH = new Float32Array(N).fill(1);

  const c = [];
  const at = (i,j) => (i<0||j<0||i>=GRID||j>=GRID) ? -1 : gi[j*GRID+i];
  const add = (a,b) => { if(a<0||b<0) return;
    c.push({ a, b, rest: Math.hypot(px[a]-px[b], py[a]-py[b]), broken:0, prev:0 }); };
  quads = [];
  for(let j=0;j<GRID;j++) for(let i=0;i<GRID;i++){
    const n = at(i,j); if(n<0) continue;
    add(n, at(i+1,j));                        // →
    add(n, at(i,j+1));                        // ↓
    add(n, at(i+1,j+1));                      // ↘ держит сдвиг
    add(at(i+1,j), at(i,j+1));                // ↙ держит сдвиг
    const a=n, b=at(i+1,j), d=at(i+1,j+1), e=at(i,j+1);
    if(b>=0&&d>=0&&e>=0){ quads.push([a,b,d,e]); }
  }
  cons = c;

  // какие связи держат каждую ячейку — чтобы дырка рвала ячейку, а не весь лист
  const key = (a,b)=> a<b ? a+":"+b : b+":"+a;
  const byPair = new Map();
  for(const cc of cons) byPair.set(key(cc.a,cc.b), cc);
  quadCons = quads.map(([a,b,d,e])=>{
    const list=[];
    for(const [x,y] of [[a,b],[b,d],[d,e],[e,a]]){ const cc=byPair.get(key(x,y)); if(cc) list.push(cc); }
    return list;
  });
  quadPrev = new Float32Array(quads.length).fill(1);
  quadSm = new Float32Array(quads.length).fill(1);
  quadRest = null;
  buildRimLoop();
  conDeg = new Int32Array(N);
  for(const cc of c){ conDeg[cc.a]++; conDeg[cc.b]++; }

  // связи, инцидентные узлу — чтобы «дырка» рвала именно ячейку, а не весь лист
  const deg = new Int32Array(N);
  for(const cc of cons){ deg[cc.a]++; deg[cc.b]++; }
  edgeNodes = [];
  for(let i=0;i<N;i++) if(deg[i] < 8) edgeNodes.push(i);   // граница круга
  { const ang = i => Math.atan2(py[i]-z.cy, px[i]-z.cx); rimRing = edgeNodes.slice().sort((a,b)=>ang(a)-ang(b)); }

  layoutPan();
  phase = "TABLE"; xf = null;
  dish = null; dishGesture = null; dishFlight = null; dishMove = null; dishTwist = null; dishPinch = null; dishSpread = 1; dishTouches.clear(); syncDishUI(); syncStepButtons();
  lastSlapDir = null; sameSlapN = 0; pullN = 0; resetCorners();
  panPress = []; domes = []; fatMap = null; fatGesture = null; fatStreak = [];
  { const card = document.getElementById("card"); if(card) card.hidden = true; }
  cook = new Float32Array(N); dry = new Float32Array(N);
  // Контакт с плитой пятнистый, а не идеальный: под листом микрозазоры, складки, плёнка
  // жира. Источники в один голос описывают ПЯТНА («some brown spots», «leopard-spotted»),
  // а не гладкий градиент, — без этого поля никакая радиальная карта картинку не даст.
  contactF = new Float32Array(N);
  {
    const K = [2.4, 4.1], AMP = [1, 0.5];
    const ph = K.map(()=>Math.random()*Math.PI*2), ph2 = K.map(()=>Math.random()*Math.PI*2);
    for(let i=0;i<N;i++){
      let n = 0;
      for(let m=0;m<K.length;m++)
        n += AMP[m]*Math.sin(K[m]*(px[i]-z.cx)/targetR+ph[m])*Math.sin(K[m]*(py[i]-z.cy)/targetR+ph2[m]);
      contactF[i] = Math.max(0.6, Math.min(1.15, 0.9 + 0.25*n/1.5));
    }
  }
  // Площади при рождении и база площади — от маленького комка, до любого масштабирования:
  // так толщина шага 3 честная, а не «родился большим и толстым».
  quadRest = new Float32Array(quads.length);
  for(let q=0;q<quads.length;q++) quadRest[q] = area(quads[q]) || 1;
  // Толщина 1 — это кусочек, отрезанный от колбаски (шаг 1). Заготовки шагов 2 и 3 рождаются
  // уже расплющенным диском, поэтому их площадь при рождении пересчитываем к кусочку: иначе
  // «проба конверта» была в 6 раз толще листа, растянутого руками (0,18 против 0,03; #41).
  if(stepNo !== 1){
    const k = (FLAT_START_FRAC/START_FRAC)**2;
    for(let q=0;q<quads.length;q++) quadRest[q] *= k;
  }
  startArea = 0; for(let q=0;q<quads.length;q++) startArea += area(quads[q]);
  // Шаг 3 «на таву»: лист уже растянут до мишени — переносим сразу, без восьми шлепков.
  // Профиль листа (перепроверка 26.08.2026, вторая итерация): цель растяжки — РАВНОМЕРНАЯ
  // просвечивающая тонкость («until the dough becomes paper-thin and translucent»), а не
  // толстая середина: цитата «the center is thicker» относится к 6-дюймовому диску ДО
  // подбрасывания, кромочную «губу» в тайском методе срезают ножом. Первая правка 26.08
  // (радиальная карта 3:1) была таким же домыслом, как прежний «горячий центр», только
  // с обратным знаком. Здесь: однородная растяжка + ПЯТНИСТАЯ неровность плавным полем
  // смещений — остаточные толстые места сидят где попало, как у настоящей руки.
  if(stepNo===3){
    const s = targetR / R0;
    const K = [2.0, 3.6, 5.4], AMP = [1, 0.5, 0.28], NOISE = 0.02;
    const ph = K.map(()=>Math.random()*Math.PI*2), ph2 = K.map(()=>Math.random()*Math.PI*2);
    for(let i=0;i<N;i++){
      const dx = (px[i]-z.cx)*s, dy = (py[i]-z.cy)*s;
      const u = dx/targetR, v = dy/targetR;
      let gu = 0, gv = 0;
      for(let m=0;m<K.length;m++){
        gu += AMP[m]*K[m]*Math.cos(K[m]*u+ph[m])*Math.sin(K[m]*v+ph2[m]);
        gv += AMP[m]*K[m]*Math.sin(K[m]*u+ph[m])*Math.cos(K[m]*v+ph2[m]);
      }
      px[i] = z.cx + dx + targetR*NOISE*gu;
      py[i] = z.cy + dy + targetR*NOISE*gv;
      prx[i]=px[i]; pry[i]=py[i];
    }
    for(const cc of cons) cc.rest = Math.hypot(px[cc.a]-px[cc.b], py[cc.a]-py[cc.b]);
  }

  clearAction(); plasticT = 0;
  tornAt = 0; lastSnap = 0; pressed = false; breakTime = pressTime = 0;
  verdict = ""; verdictAt = 0;
  { const b = document.getElementById("tear"); if(b) b.classList.remove("armed"); }
  runStart = performance.now();
}

// ─────────────────────────── кромка для рисования (сборка 74)
// Лист — решётка 38×38, обрезанная по кругу: его граница — рёбра ячеек, то есть лесенка из
// шагов в одну ячейку. Лесенка топологическая: как лист ни тяни, край остаётся ступенчатым,
// и таким же он уходил в грани блюда (startDish), в полёт и на таву. Физика тут ни при чём —
// ступени есть только в картинке. Поэтому сглаживается только картинка, в одном месте:
// rimDraw() отдаёт координаты узлов для рисования (dX, dY), где узлы кромки стоят на
// сглаженной вдоль обхода линии (треугольное окно ±RIM_K узлов), а все остальные — как в
// физике. px/py не меняются; дыры, складки, начинка и рез считаются как раньше.
// У рваного края (порванная ячейка кромки, оторванный узел) сглаживания нет: окно узла
// обрывается на первом таком соседе, так что разрыв остаётся разрывом.
// Два предела (правка после ревью сборки 74): узел кромки сдвигается не дальше RIM_CAP своей
// кратчайшей соседней стороны кромки, и ни одна ячейка не рисуется меньше RIM_AREA своей
// физической площади — иначе в сжатом углу листа ячейки схлопывались и выворачивались.
let RIM_K = 4;                               // 0 — рисовать кромку как в физике (так её меряет checks/edge-regression.cjs «до»)
let RIM_CAP = 0.8, RIM_AREA = 0.3, RIM_RAMP = 0.2, RIM_STEP = 0.75, RIM_STEPS = 8;   // пределы сглаживания: сдвиг узла в долях соседней стороны кромки; нарисованная площадь ячейки в долях физической
let dX = null, dY = null, rimRaw = null, rimF = null, rimCells = [];
let rimEdgeQ = null;                 // ячейка кромки — рисуется плотнее и светлее (сборка 81)
function buildRimLoop(){
  rimLoop = []; rimLoopQuad = []; rimCells = [];
  const key = (a,b)=> a<b ? a*65536+b : b*65536+a;
  const uses = new Map();
  const sides = (q)=>{ const [a,b,d,e] = quads[q]; return [[a,b],[b,d],[d,e],[e,a]]; };
  for(let q=0;q<quads.length;q++) for(const [u,v] of sides(q)){ const k = key(u,v); uses.set(k, (uses.get(k)||0)+1); }
  const next = new Map(); let start = -1;
  for(let q=0;q<quads.length;q++) for(const [u,v] of sides(q)){
    if(uses.get(key(u,v)) !== 1) continue;
    if(next.has(u)) return;                    // узел-перемычка: одной петли нет — рисуем как есть
    next.set(u, {v, q}); if(start < 0) start = u;
  }
  if(start < 0) return;
  const loop = [], lq = []; let n = start;
  do { const e = next.get(n); if(!e) return; loop.push(n); lq.push(e.q); n = e.v; } while(n !== start && loop.length <= next.size);
  if(n !== start || loop.length !== next.size) return;
  rimLoop = loop; rimLoopQuad = lq;
  const onRim = new Uint8Array(N); for(const i of loop) onRim[i] = 1;
  for(let q=0;q<quads.length;q++){ const s = quads[q]; if(onRim[s[0]] || onRim[s[1]] || onRim[s[2]] || onRim[s[3]]) rimCells.push(q); }
  if(!rimEdgeQ || rimEdgeQ.length !== quads.length) rimEdgeQ = new Uint8Array(quads.length);
  rimEdgeQ.fill(0);
  for(const q of rimCells) rimEdgeQ[q] = 1;
}
// ── Край дыры тем же сглаживанием, что кромка (сборка 81) ──
// Дыра — рваные ячейки, и её граница — те же стороны ячеек: без сглаживания она такая же
// лесенка, только из тёмных клеток (плейтест 77: «чёрные ступенчатые блоки»). Собираем
// цепочки сторон между целой и рваной ячейкой и сглаживаем узлы тем же окном ±RIM_K,
// с теми же пределами RIM_CAP/RIM_AREA. Цепочки открытые: дыра, дорвавшаяся до кромки,
// кончается на узлах внешнего контура — концы цепочки не двигаем (их ведёт rimDraw).
let holeChains = null, holeVer = -1;
function brokenCount(){ let v = 0; for(let k=0;k<cons.length;k++) v += cons[k].broken ? 1 : 0; return v; }
function buildHoleChains(){
  const v = brokenCount();
  holeVer = v; holeChains = [];
  if(v === 0) return;
  const key = (a,b)=> a<b ? a*65536+b : b*65536+a;
  const uses = new Map();                       // сторона -> сколько целых и сколько рваных ячеек её делят
  for(let q=0;q<quads.length;q++){
    const torn = quadCons[q].some(c=>c.broken);
    const [a,b,d,e] = quads[q];
    for(const [u,w] of [[a,b],[b,d],[d,e],[e,a]]){
      const k = key(u,w); let s = uses.get(k);
      if(!s){ s = {u, w, intact:0, torn:0}; uses.set(k, s); }
      torn ? s.torn++ : s.intact++;
    }
  }
  const adj = new Map(), quadAt = new Map();    // узел -> соседи по границе дыры; сторона -> целая ячейка
  for(const s of uses.values()){
    if(s.intact !== 1 || s.torn === 0) continue;
    if(!adj.has(s.u)) adj.set(s.u, []);
    if(!adj.has(s.w)) adj.set(s.w, []);
    adj.get(s.u).push(s.w); adj.get(s.w).push(s.u);
    quadAt.set(key(s.u, s.w), null);
  }
  if(!adj.size) return;
  for(let q=0;q<quads.length;q++){              // целая ячейка каждой границы — для предела площади
    if(quadCons[q].some(c=>c.broken)) continue;
    const [a,b,d,e] = quads[q];
    for(const [u,w] of [[a,b],[b,d],[d,e],[e,a]]){ const k = key(u,w); if(quadAt.has(k)) quadAt.set(k, q); }
  }
  const used = new Set();
  for(const start of adj.keys()){
    if(used.has(start)) continue;
    const chain = [start]; used.add(start);
    for(const first of adj.get(start)){          // от старта — в каждую сторону (у тупика одна, у цикла две)
      let prev = start, cur = first;
      if(used.has(cur)) continue;
      const seg = [];
      for(;;){
        seg.push(cur); used.add(cur);
        const nxt = adj.get(cur).filter(n => n !== prev && !used.has(n));
        if(!nxt.length) break;
        prev = cur; cur = nxt[0];
      }
      // вторая ветка от старта встаёт перед ним в обратном порядке (сборка 88: без reverse цепочка
      // рвалась на стыке, ячейка стыка была undefined, и рваный лист на таве ронял каждый кадр в rimDraw)
      if(first === adj.get(start)[0]) chain.push(...seg); else chain.unshift(...seg.reverse());
    }
    if(chain.length >= 5){
      const cells = new Set();
      for(let i=0;i+1<chain.length;i++){ const q = quadAt.get(key(chain[i], chain[i+1])); if(q != null) cells.add(q); }
      const cyclic = adj.get(chain[0]).includes(chain[chain.length-1]);   // замкнутая петля вокруг дыры
      holeChains.push({ nodes: chain, cells: [...cells], cyclic });
    }
  }
}
// Тап по краю листа (сборка 80, плейтест 17.11 п. 12: «четыре тапа по краю ничего не дали»): край под
// пальцем дёргается наружу и возвращается — видно, что касание дошло и что край живой. Только рисунок
// (dX, dY): узлы физики не трогаются, лист от тапов не растёт и не рвётся.
const TWITCH_S = 0.32, TWITCH_OUT = 0.16;      // длительность, с; размах в долях радиуса листа
let twitch = null;
function edgeTwitch(){
  if(stepNo===1 || phase!=="TABLE" || !action.gripIds || !action.gripIds.length) return;
  const c = centerOfSheet();
  twitch = { ids:action.gripIds.slice(), ws:action.gripWeights.slice(), cx:c.x, cy:c.y, r:Math.max(R0, sheetRadius()), t0:performance.now() };
}
function twitchDraw(){
  if(!twitch) return;
  const u = (performance.now()-twitch.t0)/1000/TWITCH_S;
  if(!(u>=0 && u<1) || phase!=="TABLE" || dish){ twitch = null; return; }
  const k = Math.sin(u*Math.PI*3)*(1-u)*TWITCH_OUT*twitch.r;     // наружу — внутрь — наружу, затухая
  for(let j=0;j<twitch.ids.length;j++){
    const i = twitch.ids[j]; if(i>=N) continue;
    const x = px[i]-twitch.cx, y = py[i]-twitch.cy, l = Math.hypot(x,y) || 1;
    dX[i] += x/l*k*twitch.ws[j]; dY[i] += y/l*k*twitch.ws[j];
  }
}
function rimDraw(){ rimDrawBase(); twitchDraw(); }
function rimDrawBase(){
  if(!dX || dX.length !== N){ dX = new Float32Array(N); dY = new Float32Array(N); }
  dX.set(px); dY.set(py);
  const L = rimLoop, n = L.length;
  if(RIM_K < 1 || n < 4*RIM_K) return;
  if(!rimRaw || rimRaw.length !== n) rimRaw = new Uint8Array(n);
  rimRaw.fill(0);
  let anyRaw = false;
  for(let i=0;i<n;i++){
    if(conDeg && conDeg[L[i]] <= 0){ rimRaw[i] = 1; anyRaw = true; }
    const qc = quadCons[rimLoopQuad[i]];
    if(qc[0].broken || (qc[1]&&qc[1].broken) || (qc[2]&&qc[2].broken) || (qc[3]&&qc[3].broken)){ rimRaw[i] = rimRaw[(i+1)%n] = 1; anyRaw = true; }
  }
  for(let i=0;i<n;i++){
    let m = RIM_K;
    if(anyRaw){
      if(rimRaw[i]) continue;
      m = 0;
      while(m < RIM_K && !rimRaw[(i+m+1)%n] && !rimRaw[(i-m-1+2*n)%n]) m++;
      if(!m) continue;
    }
    let sx = 0, sy = 0, sw = 0;
    for(let j=-m;j<=m;j++){
      const w = m+1-(j<0?-j:j), id = L[(i+j+n)%n];
      sx += w*px[id]; sy += w*py[id]; sw += w;
    }
    dX[L[i]] = sx/sw; dY[L[i]] = sy/sw;
  }
  // Предел сдвига: узел кромки рисуется не дальше RIM_CAP от своей кратчайшей соседней стороны
  // кромки. Где ячейки сжаты (угол листа после тяг и шлепков), окно в ±RIM_K узлов длиннее
  // самого угла и утягивало узел внутрь на целую ячейку.
  if(RIM_CAP > 0) for(let i=0;i<n;i++){
    const id = L[i], ex = dX[id]-px[id], ey = dY[id]-py[id], e2 = ex*ex+ey*ey;
    if(e2 === 0) continue;
    const a = L[(i+n-1)%n], b = L[(i+1)%n];
    const la = Math.hypot(px[a]-px[id], py[a]-py[id]), lb = Math.hypot(px[b]-px[id], py[b]-py[id]);
    const lim = RIM_CAP*(la < lb ? la : lb);
    if(e2 > lim*lim){ const k = lim/Math.sqrt(e2); dX[id] = px[id]+ex*k; dY[id] = py[id]+ey*k; }
  }
  // Ячейка не должна схлопнуться или вывернуться в рисунке: если её нарисованная площадь меньше
  // RIM_AREA от физической, сглаживание её узлов кромки убавляется (доля rimF: ×RIM_STEP за шаг, на
  // последнем из RIM_STEPS — ноль), а доля соседей по обходу подтягивается ступенями по RIM_RAMP, чтобы
  // переход от сглаженной кромки к физической не был изломом.
  if(RIM_AREA > 0){
    if(!rimF || rimF.length !== N) rimF = new Float32Array(N);
    let touched = false;
    const guard = ()=>{
      let changed = false;
      for(const q of rimCells){
        const ids = quads[q], a = ids[0], b = ids[1], d = ids[2], e = ids[3];
        const ap = (px[d]-px[a])*(py[e]-py[b]) - (px[e]-px[b])*(py[d]-py[a]);
        if(ap === 0) continue;
        for(let t=0;t<RIM_STEPS;t++){
          const ad = (dX[d]-dX[a])*(dY[e]-dY[b]) - (dX[e]-dX[b])*(dY[d]-dY[a]);
          if(ad/ap >= RIM_AREA) break;
          if(!touched){ for(const id of L) rimF[id] = 1; touched = true; }
          for(const id of ids){
            if(dX[id] === px[id] && dY[id] === py[id]) continue;
            const k = t < RIM_STEPS-1 ? RIM_STEP : 0;
            rimF[id] *= k; dX[id] = px[id]+(dX[id]-px[id])*k; dY[id] = py[id]+(dY[id]-py[id])*k;
          }
          changed = true;
        }
      }
      return changed;
    };
    for(let round=0; round<3 && guard(); round++){
      // подтянуть доли соседей: вперёд и назад по обходу, не больше RIM_RAMP на узел
      for(let dir=0;dir<2;dir++) for(let c=0;c<2*n;c++){
        const i = dir ? (2*n-1-c)%n : c%n, id = L[i], prev = L[dir ? (i+1)%n : (i+n-1)%n];
        const cap = rimF[prev] + RIM_RAMP;
        if(rimF[id] > cap){ const k = cap/rimF[id]; rimF[id] = cap; dX[id] = px[id]+(dX[id]-px[id])*k; dY[id] = py[id]+(dY[id]-py[id])*k; }
      }
    }
    if(touched) guard();
  }
  // Край дыры — тот же шаг сетки, что и кромка: сглаживаем его тем же окном и с теми же
  // пределами (сборка 81). Концы цепочки не трогаем: дыра, дорвавшаяся до внешней кромки,
  // кончается на её узлах. Плавного откатa долей, как у внешней кромки, нет — дыры малы.
  if(holeVer !== brokenCount()) buildHoleChains();
  if(holeChains && holeChains.length){
    for(const { nodes: ch, cells, cyclic } of holeChains){
      const n = ch.length;
      for(let ci = cyclic ? 0 : 1; ci < (cyclic ? n : n-1); ci++){
        const m = cyclic ? RIM_K : Math.min(RIM_K, ci, n-1-ci);
        let sx = 0, sy = 0, sw = 0;
        for(let j=-m;j<=m;j++){ const w = m+1-(j<0?-j:j), id = ch[(ci+j+n)%n]; sx += w*px[id]; sy += w*py[id]; sw += w; }
        dX[ch[ci]] = sx/sw; dY[ch[ci]] = sy/sw;
      }
      for(let ci = cyclic ? 0 : 1; ci < (cyclic ? n : n-1); ci++){   // предел сдвига: у дыры глубже зубцы
        const id = ch[ci], ex = dX[id]-px[id], ey = dY[id]-py[id], e2 = ex*ex+ey*ey;   // (ячейка во внутрь), окно режет угол на целую
        if(e2 === 0) continue;                        // ячейку — держит только предел площади ниже
        const a = ch[(ci+n-1)%n], b = ch[(ci+1)%n];
        const la = Math.hypot(px[a]-px[id], py[a]-py[id]), lb = Math.hypot(px[b]-px[id], py[b]-py[id]);
        const lim = 1.2*(la < lb ? la : lb);
        if(e2 > lim*lim){ const k = lim/Math.sqrt(e2); dX[id] = px[id]+ex*k; dY[id] = py[id]+ey*k; }
      }
      for(let t=0;t<RIM_STEPS;t++){                  // целая ячейка у дыры не схлопывается в рисунке
        let bad = false;
        for(const q of cells){
          const [a,b,d,e] = quads[q];
          const ap = (px[d]-px[a])*(py[e]-py[b]) - (px[e]-px[b])*(py[d]-py[a]);
          const ad = (dX[d]-dX[a])*(dY[e]-dY[b]) - (dX[e]-dX[b])*(dY[d]-dY[a]);
          if(ap !== 0 && ad/ap < RIM_AREA){
            bad = true;
            const k = t < RIM_STEPS-1 ? RIM_STEP : 0;
            for(const id of [a,b,d,e]){ dX[id] = px[id]+(dX[id]-px[id])*k; dY[id] = py[id]+(dY[id]-py[id])*k; }
          }
        }
        if(!bad) break;
      }
    }
  }
}

// ─────────────────────────── XPBD
function step(dt){
  // В руке и в полёте узлы заморожены: перенос — движение картинки, запекаемое при посадке.
  // На таве лист схватился и стоит — только жарится.
  if(sheetInHand()){ updateAction(dt); return; }
  updateFat(dt);   // жир живёт на таве и без блюда: лужица на пустой стали тоже расходится и сходит
  if(dish){ updateDishFlight(); updateDishMove(); updateDishTwist(dt); cookDish(dt); return; }
  if(phase==="PAN"){ cookStep(dt); return; }
  // Шаг 1 — не физика листа, а карта нажима. XPBD здесь не гоняем: это и был лаг.
  if(stepNo===1){
    if(action.state==="ARMED" && action.kind!=="lump") pressFlatten(dt);
    updateAction(dt);
    return;
  }
  // Тяга — кинематика: край стоит там, куда его привёл палец, решатель ждёт отпускания.
  // Подъём и полёт шлепка с языком в руке — то же самое: язык держит палец, а не решатель.
  if(action.state==="PULLING" || (action.pull && (action.state==="LIFTING" || action.state==="FLYING"))){ measureThickness(); updateAction(dt); return; }
  const h = dt / SUBSTEPS;
  // Затухание зависит от фазы: в полёте лист скользит свободнее, после удара,
  // когда окно пластичности закрылось, — успокаивается быстрее (audit §5).
  const damp = action.state==="FLYING" ? 0.995
             : (action.state==="SETTLING" && plasticT<=0) ? 0.94 : DAMP;
  for(let ss=0; ss<SUBSTEPS; ss++){
    for(let i=0;i<N;i++){
      if(pinned[i]){ prx[i]=px[i]; pry[i]=py[i]; continue; }
      vx[i]*=damp; vy[i]*=damp;
      prx[i]=px[i]+vx[i]*h; pry[i]=py[i]+vy[i]*h;
    }

    const alpha = COMPLIANCE/(h*h);
    for(let k=0;k<cons.length;k++){
      const c = cons[k]; if(c.broken) continue;
      const a=c.a, b=c.b;
      const dx=prx[b]-prx[a], dy=pry[b]-pry[a];
      const d=Math.hypot(dx,dy); if(d<1e-6) continue;
      const wa = pinned[a]?0:1, wb = pinned[b]?0:1, w = wa+wb;
      if(w===0) continue;
      const lam=-(d-c.rest)/(w+alpha), nx=dx/d, ny=dy/d;
      prx[a]-=nx*lam*wa; pry[a]-=ny*lam*wa;
      prx[b]+=nx*lam*wb; pry[b]+=ny*lam*wb;
    }

    for(let i=0;i<N;i++){
      if(pinned[i]) continue;
      vx[i]=(prx[i]-px[i])/h; vy[i]=(pry[i]-py[i])/h;
      px[i]=prx[i]; py[i]=pry[i];
    }
  }
  plasticT = Math.max(0, plasticT - dt);
  // Шаг 2 → 3 так же автоматически и ТЕМ ЖЕ ЛИСТОМ. Раньше перехода не было вовсе:
  // строка говорила «✓ готов · запятой на таву», а шаг оставался вторым, и нажатие
  // «на таву» вручную ПЕРЕСОБИРАЛО лист — растянутый своими руками уходил в мусор,
  // и на таву летел свежий. Это спорило с «как порвал, так и пожаришь»: дырки,
  // заработанные при растяжке, до тавы не доезжали (замечание владельца 08.09.2026).
  updateAction(dt);
  // Сборка 75: готовность судится по листу в покое — после updateAction, только в RESTING и когда
  // узлы встали (средняя скорость ниже READY_STILL·targetR в секунду; после шлепка это ~0,3 с,
  // после тяги сразу). Раньше шаг менялся на лету шлепка: разлёт узлов на миг давал 0,92, лист
  // оседал до 0,91 с самым коротким сектором 0,847 при норме 0,85 (Node 17.11, серии 7006 и 7008).
  if(stepNo===2 && action.state==="RESTING" && sheetReadyToPan() && sheetSpeed() < READY_STILL*targetR){
    stepNo = 3; advancedAt = performance.now();
    try{ localStorage.setItem("dough_step","3"); }catch(e){}
    syncStepButtons();
  }
  creep(dt);
  if(action.state === "SETTLING") relaxRim(dt);
  measureThickness();
  checkBreak(dt);
  checkCorners();
}
// Кромка оплывает после удара (19.10.2026). Круг, вырезанный из квадратной сетки, — лесенка:
// у выпуклых углов 3–4 связи, у вогнутых 7. Шлепок растит длины покоя сильнее к краю (край²),
// выпуклые углы стоят дальше и растут сильнее — лесенка с каждым шлепком раздувалась в пилу
// (Chrome 390×844 без рамы, сборка 64, 60 прогонов: средний зубец кромки на шаге 3 — 0,024–0,031
// мишени, медиана 0,027, против 0,017 у пробы — кнопка «шаг 3» со свежего комка). Пока лист
// успокаивается, каждый узел кромки сдвигается к середине между соседями по кругу (RIM_RELAX
// в секунду), и связи у сдвинутых узлов принимают новую длину — иначе решатель вернул бы зубец.
// Сглаживаются только соседние узлы: лепесток и вытянутые стороны остаются. Это условность
// против лесенки сетки, а не физическая величина (inferred: так оплывает тонкий край теста).
const RIM_RELAX = 6;
let rimMoved = null;
function relaxRim(dt){
  const ring = rimRing.filter(i => !conDeg || conDeg[i] > 0), n = ring.length;
  if(n < 12) return;
  const k = Math.min(1, RIM_RELAX*dt);
  if(!rimMoved || rimMoved.length !== N) rimMoved = new Uint8Array(N);
  rimMoved.fill(0);
  const nx = new Float32Array(n), ny = new Float32Array(n);
  for(let j=0;j<n;j++){
    const a = ring[(j-1+n)%n], b = ring[(j+1)%n], i = ring[j];
    nx[j] = px[i] + ((px[a]+px[b])*0.5 - px[i])*k;
    ny[j] = py[i] + ((py[a]+py[b])*0.5 - py[i])*k;
  }
  for(let j=0;j<n;j++){ const i = ring[j]; px[i] = nx[j]; py[i] = ny[j]; prx[i] = px[i]; pry[i] = py[i]; rimMoved[i] = 1; }
  for(const c of cons){
    if(c.broken || !(rimMoved[c.a] || rimMoved[c.b])) continue;
    c.rest += (Math.hypot(px[c.b]-px[c.a], py[c.b]-py[c.a]) - c.rest)*k;
  }
}

// ─── Подъём перед шлепком (17.11.2026) ───
// Тяги дуги хвата в LIFTING (liftPull, предел LIFT_REACH) больше нет: подъём начинается, когда мах
// подтверждён (SLAP_MIN_MS), палец к этому времени далеко за краем, и пружина к пальцу всегда
// упиралась в предел и спорила с языком, который край уже вытянул за пальцем (pullTo).
// Видимый подъём края — сам язык тяги: под быстрым махом край идёт за пальцем на PULL_GAIN_FAST
// хода, не дальше PULL_FAST_CAP. Язык остаётся в руке весь подъём и полёт (в полёте отпускается до
// PULL_FLY_KEEP) и снимается ударом. Первая версия отпускала язык в момент подъёма: край успевал
// вернуться в ноль до удара и только потом расходился — дёрганье «туда-обратно-туда», которого на
// main не было (покадровый след Node, мах 9,2 gs/с: main держит край на 0,16→0,10 gs до удара,
// первая версия — 0,24→0,00). Вывернутые ячейки после пяти шлепков — в checks/model-regression.cjs.
// Ширина хвата решает, получится лист или жгут (замер: 4% тонкой площади при щипке
// против 76% при широком хвате). Хват растёт от прижима, но насыщается за 100–250 мс,
// а не за полторы секунды: удержание — удобная замена ширине ладони (audit §6.2).
const GRIP_MIN = 5, GRIP_MAX = 22;   // шагов решётки

let radBuf = null;
function sheetRadius(){
  // Радиус ТЕЛА листа: 92-й перцентиль расстояний живых узлов. Максимум не годится:
  // после разрывов остаётся бахрома из полудержащихся цепочек, шлепки задирают её
  // наружу, и по ней процент листа улетал за потолок (живой тест: 5000 %).
  const c = centerOfSheet();
  if(!radBuf || radBuf.length !== N) radBuf = new Float32Array(N);
  let n = 0;
  for(let i=0;i<N;i++){
    if(conDeg && conDeg[i] <= 0) continue;
    radBuf[n++] = Math.hypot(px[i]-c.x, py[i]-c.y);
  }
  if(!n) return 0;
  const a = radBuf.subarray(0, n);
  Array.prototype.sort.call(a, (x,y)=>x-y);
  return a[Math.min(n-1, Math.floor(n*0.92))];
}
function centerOfSheet(){
  let sx=0, sy=0, n=0;
  for(let i=0;i<N;i++){
    if(conDeg && conDeg[i] <= 0) continue;
    sx+=px[i]; sy+=py[i]; n++;
  }
  n = n || 1;
  return { x:sx/n, y:sy/n };
}
let edgeRadBuf = null;
function sheetShortR(){
  const c = centerOfSheet();
  const need = Math.max(64, edgeNodes.length);
  if(!edgeRadBuf || edgeRadBuf.length < need) edgeRadBuf = new Float32Array(need);
  let n = 0;
  for(const i of edgeNodes){
    if(conDeg && conDeg[i] <= 0) continue;
    edgeRadBuf[n++] = Math.hypot(px[i]-c.x, py[i]-c.y);
  }
  if(!n) return 0;
  const a = edgeRadBuf.subarray(0, n);
  Array.prototype.sort.call(a, (x,y)=>x-y);
  return a[Math.min(n-1, Math.floor(n*0.18))];
}
function flattenStats(){
  const h = flatH || thick;
  let mx=0, mn=1, sum=0, n=0, over=0;
  for(let i=0;i<N;i++){
    if(conDeg && conDeg[i]<=0) continue;
    const t=h[i]; if(t>mx) mx=t; if(t<mn) mn=t; sum+=t; n++;
    if(t>FLAT_READY) over++;
  }
  return {max:mx, min:n?mn:0, mean:n?sum/n:1, over:n?over/n:1, n};
}
function sheetReadyToStretch(){
  return sheetRadius() >= step1R * 0.92;
}
function sheetReadyToPan(){
  return phase==="TABLE" && sheetFill() >= READY_FILL;
}
function flattenDidWork(){
  const s = flattenStats();
  return sheetRadius() > R0 * 1.08 || s.mean < 0.94;
}
function sheetLooksDisc(){
  if(phase!=="TABLE" || xf) return false;
  if(stepNo===1) return true;
  if(stepNo!==2) return false;
  if(tornAt) return false;
  return true;
}
function flattenLiveWord(){
  const s=flattenStats();
  const pct=Math.min(100, Math.round(sheetRadius()/step1R*100));
  if(action.kind==="lump") return "сначала расплющи кусок";
  if(pct>=92) return action.state==="ARMED" ? tip("flat","диск готов — отпусти") : "";
  if(s.mean < 0.55 && s.max > FLAT_READY) return "края толстые — веди по ободу";
  return tip("flat","прижми кусок и веди пальцем");
}

// ─── Жест «поднять и шлёпнуть» — ฟาด как единица действия (audit §5–6) ───
// Скорости в радиусах листа в секунду, чтобы пороги не зависели от экрана.
// Направление хорошего свайпа НЕ фиксировано до живого iPhone-теста: формула
// принимает и мах «от центра», и касательный (audit §6.3, оговорка).
// 16.11.2026: пороги V_MIN / ACTION_MIN / IMPULSE_K / HOLD_MIN сняты — мах распознаётся по
// отсчётам жеста (V_SLAP и соседи, ниже у updateActionMove), а не по двум соседним событиям.
let IMPULSE_MAX = 3.5;       // потолок силы, R0/с скорости узлов
const LIFT_MAX = 0.25;       // с: предохранитель фазы LIFTING (обычно её кончает путь, остановка или отпускание)
let PLASTIC_BOOST = 5.0;     // множитель текучести в окне удара
let SETTLE_SPEED = 12;       // px/с средней скорости листа: «успокоился»

function heldMs(){ return performance.now() - action.down.t; }

function clearAction(){
  action.state = "RESTING"; action.pointerId = null; action.edgeNode = -1;
  action.gripIds = []; action.gripWeights = []; action.impulse = 0;
  action.direction = {x:0,y:0}; action.velocity = {x:0,y:0};
  action.timer = 0; action.mul = 0; action.heldAtLift = 0; action.kind = null;
  action.sweep = 0; action.tailDir = {x:1,y:0}; action.toss = null;
  action.samples = []; action.stroke = null; action.moved = false; action.pull = null;
  action.liftI = 0; action.liftRad = null; action.rel = null; action.vPeak = 0; action.events = 0; action.lastClient = null;
  action.carryArm = false; action.two = null; action.back = null; action.carryT = 0;
  action.off = null; action.wasTwo = false;
}

function armAction(pointerId, p, tEv, client){
  const n = nodeNear(p.x, p.y);
  if(n < 0) return;
  // Решение прошлого маха стирается на входе в новый: иначе после неудачной запятой
  // в панели продолжает висеть «запятая 154° → тава» от прошлой удачной, и по строке
  // нельзя судить, что случилось сейчас (найдено проверкой 08.09).
  lastDecision = "—";
  action.state = "ARMED"; action.pointerId = pointerId; action.edgeNode = n;
  action.down = { x:p.x, y:p.y, t: performance.now() };
  action.last = { x:p.x, y:p.y, t: performance.now() };
  action.velocity = {x:0,y:0}; action.impulse = 0; action.kind = null;
  { const t0 = Number.isFinite(tEv) ? tEv : performance.now(); action.down.t = t0; action.last.t = t0;
    const m = gestureMetric(p, client);
    action.samples = [{ x:p.x, y:p.y, u:m.u, v:m.v, t:t0 }]; action.moved = false; action.pull = null;
    action.downM = { u:m.u, v:m.v }; action.evFb0 = evTimeFallbacks;
    action.stroke = { start:null, path:0, lastMoveT:t0, i0:0, au:m.u, av:m.v, judged:false }; action.dtAvg = 0;
    action.liftI = 0; action.liftRad = null; action.rel = null; action.vPeak = 0; action.events = 0;
    action.lastClient = client || null; }
  // Касание в середине листа — взять его в руку целиком (перенос), а не край (сборка 70).
  action.carryArm = stepNo !== 1 && phase === "TABLE" && CARRY_MODE !== "two" && inCarryZone(p);
  if(stepNo!==1 && !action.carryArm) updateGripFromHold();   // на шаге 1 и в середине листа дуга хвата не нужна
}

// Шаг 1: ладонь плющит шар в диск. Сетка остаётся кругом — точки не разлетаются.
// Диаметр растёт к пунктиру по объёму: ниже → шире. На шлепок — только после отпускания.
function pressFlatten(dt){
  if(!flatH) return;
  const at = flattenAt(action.last);
  const fx = at.x, fy = at.y;
  const sr = Math.max(R0, sheetRadius());
  const sigma = Math.max(sr * 0.62, gestureScale * 0.22);
  const s2 = sigma*sigma || 1;
  for(let i=0;i<N;i++){
    if(conDeg && conDeg[i]<=0) continue;
    const dx = px[i]-fx, dy = py[i]-fy;
    const w = Math.exp(-(dx*dx + dy*dy)/s2);
    if(w < 0.03) continue;
    flatH[i] = Math.max(0.18, flatH[i] * Math.exp(-FLAT_RATE * w * dt));
  }
  const mean = flattenStats().mean;
  const want = Math.min(step1R, R0 * Math.sqrt(1 / Math.max(0.22, mean)));
  const c = centerOfSheet();
  const r = Math.max(1e-3, sheetRadius());
  const s = 1 + Math.min(Math.max(0, want/r - 1), 0.38 * dt);
  if(s > 1.001){
    for(let i=0;i<N;i++){
      px[i] = c.x + (px[i]-c.x)*s;
      py[i] = c.y + (py[i]-c.y)*s;
      prx[i]=px[i]; pry[i]=py[i]; vx[i]=0; vy[i]=0;
    }
  }
}
function bakeFlatten(){
  if(stepNo!==1) return;
  for(let i=0;i<N;i++){ vx[i]=0; vy[i]=0; }
  for(const cc of cons) if(!cc.broken) cc.rest = Math.hypot(px[cc.a]-px[cc.b], py[cc.a]-py[cc.b]);
  if(!quadRest || quadRest.length!==quads.length) quadRest = new Float32Array(quads.length);
  for(let q=0;q<quads.length;q++){
    const qq=quads[q], a=area(qq)||1e-6;
    const h = ((flatH[qq[0]]||1)+(flatH[qq[1]]||1)+(flatH[qq[2]]||1)+(flatH[qq[3]]||1))/4;
    // Плющение переходит как есть: размер диска и где жали. Не подгоняем к канону шага 2.
    // 0,50+0,50·h: вмятина видна, лист не стартует уже в зоне дыр.
    quadRest[q] = a * (0.50 + 0.50 * Math.max(0.18, h));
  }
  measureThickness();
  stepNo = 2; advancedAt = performance.now(); learn("flat");
  try{ localStorage.setItem("dough_step","2"); }catch(e){}
  syncStepButtons();
  const z = zone("work"), c2 = centerOfSheet();
  const dx = z.cx - c2.x, dy = z.cy - c2.y;
  if(Math.hypot(dx,dy) > 1){
    for(let i=0;i<N;i++){ px[i]+=dx; py[i]+=dy; prx[i]=px[i]; pry[i]=py[i]; }
  }
  layoutPan();
  sqC = null;                       // мишень шага 2 встаёт по центру листа на входе в шаг
  clearAction();
}

function lumpFollow(p){
  const k = 0.80;
  const dx = (p.x - action.last.x)*k, dy = (p.y - action.last.y)*k;
  for(let i=0;i<N;i++){
    if(conDeg && conDeg[i]<=0) continue;
    px[i]+=dx; py[i]+=dy; prx[i]=px[i]; pry[i]=py[i];
    vx[i]=0; vy[i]=0;
  }
  action.last = { x:p.x, y:p.y, t: performance.now() };
}
function flattenAt(p){
  // Кусок маленький, мишень большая: нажим рядом всё равно давит тесто, а не пустой стол.
  const c = centerOfSheet(), r = Math.max(R0, sheetRadius());
  const dx=p.x-c.x, dy=p.y-c.y, d=Math.hypot(dx,dy);
  if(d <= r) return p;
  if(d > Math.max(r*2.2, step1R*0.85)) return p;
  const k = r / (d || 1);
  return { x:c.x + dx*k, y:c.y + dy*k };
}
function pointerOnRim(p){
  const c = centerOfSheet(), r = Math.max(R0, sheetRadius());
  return Math.hypot(p.x-c.x, p.y-c.y) > r * 0.78;
}

function updateGripFromHold(){
  const t = Math.max(0, Math.min(1, (heldMs() - 100) / 150));
  const st = t*t*(3-2*t);                            // smoothstep
  const gp = gripArc(action.edgeNode, GRIP_MIN + (GRIP_MAX - GRIP_MIN) * st);
  action.gripIds = gp.ids; action.gripWeights = gp.ws; action.mul = gp.mul;
}

// ─── Шаг 2: два входа — тяга и шлепок (16.11.2026, #91) ───
// Раньше жест решался по разности двух соседних событий и по таймеру 80 мс: исход зависел от
// частоты событий телефона, и медленная протяжка края в 68–72 % прогонов читалась шлепком (#91).
// Теперь всё считается по отсчётам жеста со ВРЕМЕНЕМ СОБЫТИЯ:
//  • отсчёт — точка стола и точка экрана в единицах gs (CSS px ÷ gsCss()), чтобы вертикаль и
//    горизонталь весили одинаково, несмотря на наклон стола;
//  • штрих — непрерывное движение; пауза длиннее PAUSE_MS начинает новый штрих;
//  • скорость — наименьшие квадраты по отсчётам штриха за последние VEL_WIN_MS; когда отсчётов
//    меньше трёх — путь штриха, делённый на его длительность. Разности соседних событий нет нигде;
//  • «тяга или шлепок» решается по скорости за окно вдвое длиннее (SLAP_WIN_MS) и, пока палец
//    на столе, не раньше SLAP_MIN_MS от начала штриха: при дрожи ±1,5 px окно 80 мс даёт разброс
//    скорости 0,3 gs/с на 30–60 Гц, и ведение на 0,9 порога читалось шлепком в 9 прогонах из 128
//    (Node, 17.11). Короткий мах (моложе SLAP_MIN_MS) решается по концу штриха — отпускание,
//    остановка пальца или пауза перед новым штрихом (strokeVerdict): окно там равно самому штриху.
//    Живой палец в конце маха тормозит и встаёт: судить такой мах по скорости в миг отпускания
//    нельзя — он читался тягой (ревью 17.11, P1). Паузы перед махом не требуется (P2);
//  • путь штриха копится шагами не короче PATH_Q: иначе дрожь на частых событиях его удлиняет;
//  • мёртвая зона — max(SLOP_GS·gs, SLOP_CSS px): в рамах (?frame=) gs мал, и дрожь пальца
//    иначе выходила бы из зоны.
// Быстро наружу — шлепок (прежняя цепочка LIFTING → FLYING → IMPACT → SETTLING), медленно наружу —
// тяга (PULLING): край идёт за пальцем и остаётся вытянутым. Внутрь — ничего.
// Все пороги — стартовые значения, не замеры: подстраиваются по журналу жестов владелицы.
let V_SLAP = 5.0;                 // gs/с в метрике экрана: быстрее — шлепок, медленнее — тяга (адрес ?vslap=)
let V_PULL_FULL = 4.0;            // gs/с: ниже — край идёт за пальцем в полную силу; до V_SLAP — коридор
const PULL_GAIN_FAST = 0.6;       // доля хода края у самого порога шлепка: шаг роста через порог мал
const SLOP_GS = 0.15, SLOP_CSS = 10;
const SLAP_MIN_PATH = 0.45, SLAP_OUT_COS = Math.cos(80*Math.PI/180);
const VEL_WIN_MS = 80, PAUSE_MS = 40, IMPULSE_KS = 0.25;
const SLAP_WIN_MS = 160, SLAP_MIN_MS = 150, PATH_Q = 0.05;
const STALE_MS = 50;              // столько без движения — палец остановился, скорость считается нулевой
// Частота событий у телефона своя и проседает: на 30 кадрах или при пропуске пары кадров события идут
// через 33–60 мс, и постоянные 40/50 мс резали один быстрый мах на куски-«тяги» (проверка в своём Chrome
// 17.11: мах 0,9 листа за 90 мс засчитан тягой со скоростью 0). Поэтому пороги паузы и остановки растут
// со средним шагом событий этого жеста, а разрыв между событиями — пауза, только если палец за него почти
// не сдвинулся: события во время покоя не приходят, и первое после паузы несёт маленький сдвиг.
const V_STALL = 1.5;              // gs/с: медленнее за разрыв — палец стоял
const LONG_GAP_MS = 100;          // разрыв длиннее этого (и трёх шагов событий) — пауза при любом сдвиге
function evStep(){ return Math.min(60, Math.max(4, action.dtAvg || 16.7)); }
function pauseMs(){ return Math.max(PAUSE_MS, 2.5*evStep()); }
function staleMs(){ return Math.max(STALE_MS, 3*evStep()); }
function gapIsPause(m, t){
  const S = action.samples, L = S && S[S.length-1], st = action.stroke;
  if(!L || !st || !(t - st.lastMoveT > pauseMs())) return false;
  const gap = Math.max(1, t - L.t);
  // Долгий разрыв — пауза при любом сдвиге: первое событие маха после паузы несёт целый кадр пути.
  return Math.hypot(m.u-L.u, m.v-L.v) / gap * 1000 < V_STALL || t - st.lastMoveT > Math.max(LONG_GAP_MS, 3*evStep());
}
const SAMPLES_MAX = 256;          // отсчётов жеста в памяти: секунда с лишним на 240 Гц (поворот запятой считается по ним)
const LIFT_PATH = 1.2;            // gs стола: столько пути после подъёма — и мах бьёт сам
try{
  const v = parseFloat(new URLSearchParams(location.search).get("vslap"));
  if(v >= 1 && v <= 20){ V_PULL_FULL *= v / V_SLAP; V_SLAP = v; }
}catch(e){}
function gsCss(){ const r = cv.getBoundingClientRect(); return Math.max(1, gestureScale * r.width / cv.width); }
function gestureMetric(p, client){
  if(client){ const k = 1/gsCss(); return { u:client.x*k, v:client.y*k }; }
  const k = 1/Math.max(1, gestureScale); return { u:p.x*k, v:p.y*k };   // вызов без экрана (проверки в Node)
}
function gestureSlop(){ return Math.max(SLOP_GS, SLOP_CSS/gsCss()); }
function pushSample(p, tEv, client){
  const S = action.samples, L = S[S.length-1], st = action.stroke;
  let t = Number.isFinite(tEv) ? tEv : performance.now(); if(t <= L.t) t = L.t + 0.01;
  const m = gestureMetric(p, client), s = { x:p.x, y:p.y, u:m.u, v:m.v, t };
  const gap = t - L.t, paused = gapIsPause(m, t);
  if(gap > 1 && gap < 70) action.dtAvg = action.dtAvg ? action.dtAvg*0.8 + gap*0.2 : gap;
  // мёртвая зона — от точки КАСАНИЯ (action.downM), а не от S[0]: массив отсчётов сдвигается
  if(!action.moved && Math.hypot(m.u-action.downM.u, m.v-action.downM.v) >= gestureSlop()) action.moved = true;
  if(action.moved){
    const d = Math.hypot(m.u-L.u, m.v-L.v);
    if(d > 1e-4){
      if(st.start === null || paused){
        // Начало штриха — предыдущий отсчёт; после паузы он старый, и движение началось
        // не раньше кадра назад (события во время покоя не приходят).
        st.start = t - L.t > pauseMs() ? t - 17 : L.t; st.path = 0; st.i0 = S.length - 1; st.au = L.u; st.av = L.v;
        st.judged = false;
      }
      st.lastMoveT = t;
      const da = Math.hypot(m.u-st.au, m.v-st.av);
      if(da >= PATH_Q){ st.path += da; st.au = m.u; st.av = m.v; }
    }
  }
  S.push(s); action.events++; action.lastClient = client || null;
  if(S.length > SAMPLES_MAX){ S.shift(); st.i0 = Math.max(0, st.i0-1); if(action.liftI) action.liftI = Math.max(0, action.liftI-1); }
  action.last = { x:p.x, y:p.y, t };
}
// Скорость руки: { x, y } — единицы стола в секунду, speed — gs/с по экрану.
function sampleVelocity(winMs){
  const S = action.samples, st = action.stroke, tN = S[S.length-1].t, win = winMs || VEL_WIN_MS;
  const pts = []; for(let i=Math.max(0, st.i0); i<S.length; i++) if(S[i].t >= tN - win) pts.push(S[i]);
  if(pts.length < 3){
    // Мало отсчётов (редкие события или самое начало штриха): путь штриха на его длительность.
    const a = S[Math.max(0, Math.min(st.i0, S.length-1))], b = S[S.length-1];
    const dur = st.start === null ? 0 : tN - st.start;
    const l = Math.hypot(b.x-a.x, b.y-a.y), lu = Math.hypot(b.u-a.u, b.v-a.v);
    if(dur < 1 || l < 1e-9 || lu < 1e-9) return { x:0, y:0, speed:0 };
    const speed = Math.max(st.path, lu) / dur * 1000, k = speed * l / lu;   // k — та же скорость в единицах стола
    return { x:(b.x-a.x)/l*k, y:(b.y-a.y)/l*k, speed, su:(b.u-a.u)/lu*speed, sv:(b.v-a.v)/lu*speed };
  }
  const n = pts.length; let mt=0,mx=0,my=0,mu=0,mv=0;
  for(const q of pts){ mt+=q.t; mx+=q.x; my+=q.y; mu+=q.u; mv+=q.v; } mt/=n; mx/=n; my/=n; mu/=n; mv/=n;
  let tt=0,tx=0,ty=0,tu=0,tv=0;
  for(const q of pts){ const dt=q.t-mt; tt+=dt*dt; tx+=dt*(q.x-mx); ty+=dt*(q.y-my); tu+=dt*(q.u-mu); tv+=dt*(q.v-mv); }
  if(tt < 1e-9) return { x:0, y:0, speed:0 };
  return { x:tx/tt*1000, y:ty/tt*1000, speed:Math.hypot(tu/tt, tv/tt)*1000, su:tu/tt*1000, sv:tv/tt*1000 };   // su, sv — та же скорость по экрану
}
// Путь после подъёма, перебранный с постоянным шагом по ДЛИНЕ (стол): поворот и хвост не зависят от частоты событий.
function liftPath(maxLen){
  const S = action.samples, i0 = Math.min(action.liftI || 0, S.length-1), stepL = 0.2 * gestureScale, pts = [{x:S[i0].x, y:S[i0].y}];
  let carry = 0, total = 0; const lim = maxLen == null ? Infinity : maxLen * gestureScale;
  for(let i=i0+1; i<S.length && total < lim; i++){
    let ax=S[i-1].x, ay=S[i-1].y; const bx=S[i].x, by=S[i].y; let seg = Math.hypot(bx-ax, by-ay); if(seg < 1e-9) continue;
    const ux=(bx-ax)/seg, uy=(by-ay)/seg;
    while(carry + seg >= stepL && total < lim){ const d = stepL - carry; ax += ux*d; ay += uy*d; seg -= d; carry = 0; total += stepL; pts.push({x:ax, y:ay}); }
    carry += seg;
  }
  return { pts, total: total + (total < lim ? carry : 0) };
}
// Наружный радиус в точке хвата (по листу ДО тяги) и центр, от которого он отложен.
function grabRadial(){
  const P = action.pull, c = P ? P.c : centerOfSheet(), e = action.edgeNode;
  const x = (P ? P.bx[e] : px[e]) - c.x, y = (P ? P.by[e] : py[e]) - c.y, l = Math.hypot(x, y) || 1;
  return { c, x:x/l, y:y/l };
}
// Шлепок ли этот штрих: скорость, путь и направление наружу. Возвращает силу удара или 0.
// Сила линейна по скорости: 1,25 на пороге, потолок IMPULSE_MAX с 14 gs/с — без ступеньки.
// vc — скорость за длинное окно (решение), v — за короткое (сила: мах к концу разгоняется).
function slapForce(vc, rad, v){
  if(vc.speed < V_SLAP || action.stroke.path < SLAP_MIN_PATH) return 0;
  const sp = Math.hypot(vc.x, vc.y); if(sp < 1e-9) return 0;
  const outCos = (vc.x*rad.x + vc.y*rad.y)/sp;
  if(outCos < SLAP_OUT_COS) return 0;
  const tang = Math.abs(rad.x*vc.y - rad.y*vc.x)/sp;
  return Math.min(IMPULSE_MAX, IMPULSE_KS * Math.max(vc.speed, v ? v.speed : 0) * Math.min(1, Math.max(0, outCos) + 0.55*tang));
}
// Суд над штрихом по его последнему движению: скорости и сила шлепка (0 — не шлепок).
function strokeVerdict(){
  const v = sampleVelocity(), vc = sampleVelocity(SLAP_WIN_MS);
  return { v, vc, force: slapForce(vc, grabRadial(), v) };
}
// Штрих кончился (пауза, остановка), а на ходу его не судили — он был моложе SLAP_MIN_MS.
// Судим один раз; шлепок бьёт сам, не дожидаясь отпускания (как на main). true — ушли в полёт.
function judgeEndedStroke(){
  const st = action.stroke;
  if(!st || st.start === null || st.judged || !action.moved) return false;
  st.judged = true;
  if(st.lastMoveT - st.start >= SLAP_MIN_MS) return false;   // зрелый штрих судился на каждом событии
  const j = strokeVerdict();
  if(!(j.force > 0)) return false;
  startLift(j.vc, j.force, st.start - action.down.t); toFlying(); return true;
}
function noteRelease(v){   // числа жеста для журнала: по ним подстраиваются пороги
  const st = action.stroke;
  action.rel = { v:v.speed, peak:Math.max(action.vPeak||0, v.speed), path:st ? st.path : 0,
    ms:st && st.start !== null ? st.lastMoveT - st.start : 0, events:action.events|0 };
}
// ── Тяга: край идёт за пальцем по полю смещений; длины покоя пересчитываются на отпускании.
// Физика на время тяги стоит (step): рост — функция пути пальца, а не времени удержания, поэтому
// «липкой буксировки», снятой раньше, здесь нет. Сборка 81 (плейтест 77, п. 10): ПОКА ПАЛЕЦ
// ДЕРЖИТ, край под пальцем идёт за ним без tanh-отставания — до PULL_KNEE·cap ровно 1:1, дальше
// мягко к cap (пунктир × (1+PULL_OVER)) и не дальше предела разрыва; у предела край дрожит на
// 2–3 px. Сборка 84: тесто пластичное — языка за пунктиром нет, расстановка зажата к пунктиру и
// пока палец держит, и pullCommit фиксирует ровно держимую форму (сборка 83 переигрывала на
// отпускании tanh-расстановку, и лист отскакивал на 10–134 px). Предел разрыва — физический:
// самая тонкая ячейка полосы не тоньше PULL_TEAR_T (двойной порог разрыва; quadRest на коммите
// не меняется — материал тот же, площадь больше); тяга не рвёт никогда — рвёт только шлепок.
const PULL_SIGMA = 1.0;           // рад: угловая ширина поля тяги. 0,55 давало язык: соседи не шли, одни
                                  // тяги за углы строили звезду, а готовность требовала 16 тяг (ревью 17.11, P7)
const PULL_OUT_COS = Math.cos(65*Math.PI/180);   // конус тяги уже конуса шлепка: вбок край не тащим
const PULL_SKEW = 25*Math.PI/180; // край идёт за пальцем не дальше этого угла от радиуса хвата
const PULL_NEIGH = 1.25;          // тянутый участок — не дальше стольких радиусов соседей (±30°): ни звезды, ни креста
const PULL_OVER = 0.03;           // тяга ведёт кромку до пунктира и на столько за него; шлепок встаёт у пунктира (SLAP_CAP)
const PULL_FAST_BAND = 0.25;      // доля V_SLAP над порогом, за которую язык укорачивается до PULL_FAST_CAP
const PULL_MIN = 0.25;            // gs: короче — тесто возвращается
const PULL_CAP_GS = 1.4, PULL_CAP_R = 0.55;   // предел хода: в gs и в радиусах листа
const PULL_SLIP = 1.6;            // палец на столько пределов впереди — тяга фиксируется сама
const PULL_KNEE = 0.8;            // доля cap, до которой край идёт за пальцем 1:1; дальше мягко к cap
const PULL_BLOCK = 0.06;          // gs: меньше запаса до мишени — сторона дотянута
const PULL_FAST_CAP = 0.40;       // gs: предел хода края под махом на пороге шлепка и быстрее
const PULL_FLY_KEEP = 0.5;        // доля языка, остающаяся к удару (на main дуга хвата к удару держала ~0,6 подъёма)
const PULL_NUDGE = 0.10;          // gs: настолько упёршаяся сторона подаётся под пальцем и возвращается
const PULL_TEAR_T = 0.032;        // предел разрыва тяги: тоньше этой толщины полосу не тянем. Замер (Node,
                                  // готовый лист): полоса при ходе 200 px — 0,033, при 244 px — 0,030; предел
                                  // встаёт на ~210 px. Уже тоньше пола полоса тянется ещё на 15 %, не намертво
let pullN = 0;                    // зафиксированных тяг на этом листе (контур листа рисуется по кромке)
// Ход края от скорости руки: полный до V_PULL_FULL, дальше падает до PULL_GAIN_FAST на пороге
// шлепка и остаётся таким под быстрым махом. Гасить его под махом до нуля пробовали (17.11):
// лист ждал удара неподвижно 150 мс, а вывернутых ячеек после пяти шлепков стало больше
// (Node, 18 раскладок: 9–35 против 0–18 с постоянной долей; у main в том же тесте 13).
function pullGain(speed){
  if(speed <= V_PULL_FULL) return 1;
  if(speed >= V_SLAP) return PULL_GAIN_FAST;
  return 1 - (1 - PULL_GAIN_FAST) * (speed - V_PULL_FULL)/(V_SLAP - V_PULL_FULL);
}
function pullBegin(){
  const c = centerOfSheet(), e = action.edgeNode, gx = px[e]-c.x, gy = py[e]-c.y, rg = Math.hypot(gx,gy)||1;
  const w = new Float32Array(N);
  for(let i=0;i<N;i++){
    if(conDeg && conDeg[i] <= 0) continue;
    const x = px[i]-c.x, y = py[i]-c.y, rho = Math.hypot(x,y); if(rho < 1e-6) continue;
    const phi = Math.acos(Math.max(-1, Math.min(1, (x*gx+y*gy)/(rho*rg))));
    const t = Math.max(0, Math.min(1, (Math.min(1, rho/rg) - 0.1)/0.75));
    w[i] = Math.exp(-(phi*phi)/(PULL_SIGMA*PULL_SIGMA)) * t*t*(3-2*t);
  }
  // Запас хода — от центра МИШЕНИ: до контура × (1+PULL_OVER). И не дальше PULL_NEIGH радиусов
  // соседей на ±30° ПОСЛЕ тяги (соседи идут следом с весом w30): узкое поле звезду не построит.
  const tc = targetC(), tx = px[e]-tc.x, ty = py[e]-tc.y, rt = Math.hypot(tx,ty), th = Math.atan2(ty,tx);
  rimProfile(tc);
  const neigh = Math.min(rimProf[rimBin(th - Math.PI/6)], rimProf[rimBin(th + Math.PI/6)]);
  const w30 = Math.exp(-(Math.PI/6)*(Math.PI/6)/(PULL_SIGMA*PULL_SIGMA)), den = 1 - PULL_NEIGH*w30;
  const roomN = den > 0.02 ? Math.max(0, (PULL_NEIGH*neigh - rt)/den) : (PULL_NEIGH*neigh > rt ? Infinity : 0);
  const room = Math.max(0, Math.min(targetAt(th)*(1+PULL_OVER) - rt, roomN));
  let cap = Math.min(PULL_CAP_GS*gestureScale, PULL_CAP_R*sheetRadius(), room);
  if(cap < PULL_BLOCK*gestureScale) cap = 0;
  // Узлы кромки и дробный номер сектора каждого узла (от центра мишени): по ним pullTo зажимает ход.
  const ab = new Float32Array(N), rim = [];
  for(let i=0;i<N;i++) ab[i] = (Math.atan2(py[i]-tc.y, px[i]-tc.x) + Math.PI)/(2*Math.PI)*RIM_BINS - 0.5;
  for(const i of edgeNodes) if(!(conDeg && conDeg[i] <= 0) && w[i] > 0) rim.push(i);
  // Сборка 81: полоса тяги — целые ячейки под пальцем (по ним считается предел разрыва).
  const strip = [];
  for(let q=0;q<quads.length;q++){
    if(quadCons[q].some(cc=>cc.broken)) continue;
    let mx = 0; for(const id of quads[q]) if(w[id] > mx) mx = w[id];
    if(mx >= 0.25) strip.push(q);
  }
  let thin0 = 1;
  for(const q of strip) thin0 = Math.min(thin0, quadRest ? quadRest[q]/Math.max(1e-6, area(quads[q])) : 1);
  action.pull = { c, tc, rg, nx:gx/rg, ny:gy/rg, bx:Float32Array.from(px), by:Float32Array.from(py), w, ab, rim,
    strip, thin0, e:0, raw:0, gain:1, fast:0, k:1, dx:0, dy:0, ux:gx/rg, uy:gy/rg, cap,
    limKin:0, atLimit:false, followed:false };
  action.state = "PULLING";
}
// Предел разрыва тяги: наибольший ход e ≤ want, при котором самая тонкая ячейка полосы ещё не
// тоньше пола (PULL_TEAR_T; полоса, уже тоньше пола, тянется ещё на 15 %). Площадь ячейки при
// ходе e — по её четырём узлам (база + ход×вес); секторные зажимы не учтены, оценка смотрит в
// сторону разрыва с запасом. Тяга не рвёт — рвёт только шлепок.
function pullTearLimit(P, ux, uy, want){
  if(want <= 0 || !P.strip.length || !quadRest) return want;
  const floor = Math.min(PULL_TEAR_T, P.thin0*0.85);
  const areaAt = (q, e)=>{
    const s = quads[q]; let acc = 0;
    for(let k2=0;k2<4;k2++){
      const i = s[k2], j = s[(k2+1)%4];
      acc += (P.bx[i]+ux*e*P.w[i])*(P.by[j]+uy*e*P.w[j]) - (P.bx[j]+ux*e*P.w[j])*(P.by[i]+uy*e*P.w[i]);
    }
    return Math.abs(acc)/2;
  };
  const thin = (e)=>{ let m = 1; for(const q of P.strip){ const t = quadRest[q]/Math.max(1e-6, areaAt(q, e)); if(t < m) m = t; } return m; };
  if(thin(want) >= floor) return want;
  let lo = 0, hi = want;
  for(let it=0; it<6; it++){ const m = (lo+hi)*0.5; if(thin(m) >= floor) lo = m; else hi = m; }
  return lo;
}
// fast — 0…1: насколько рука быстрее порога шлепка (язык укорачивается до PULL_FAST_CAP).
// follow — палец держит медленную тягу: край идёт за ним до предела разрыва (сборка 81).
function pullTo(p, gain, fast, follow){
  const P = action.pull; let dx = p.x-action.down.x, dy = p.y-action.down.y; const len = Math.hypot(dx,dy);
  if(gain != null) P.gain = gain;
  if(fast != null) P.fast = Math.max(0, Math.min(1, fast));
  P.raw = len; P.dx = dx; P.dy = dy;
  let e = 0, ux = P.nx, uy = P.ny;
  if(len > 1e-9 && (dx*P.nx + dy*P.ny)/len >= PULL_OUT_COS){
    // Край идёт по направлению пальца, но не дальше PULL_SKEW от радиуса хвата, а ход — проекция
    // пути пальца на это направление: косая тяга не сдвигает лист вбок (ревью 17.11, P6:
    // под 60° к радиусу шесть тяг вывернули 44 ячейки).
    const a = Math.atan2(P.nx*dy - P.ny*dx, P.nx*dx + P.ny*dy), b = Math.max(-PULL_SKEW, Math.min(PULL_SKEW, a));
    const cb = Math.cos(b), sb = Math.sin(b); ux = P.nx*cb - P.ny*sb; uy = P.nx*sb + P.ny*cb;
    const along = Math.max(0, dx*ux + dy*uy);
    // упёршаяся сторона чуть подаётся и вернётся на отпускании; в длины покоя это не идёт
    let lim = P.cap > 0 ? P.cap : PULL_NUDGE*gestureScale;
    if(follow){
      // Сборка 84: край идёт за пальцем без отставания (без tanh), но не дальше cap (пунктир ×
      // (1+PULL_OVER), соседи) и предела разрыва; расстановка зажата к пунктиру, как при коммите.
      // То, что держит палец, и фиксируется на отпускании: тесто пластичное, отскока нет.
      const give = PULL_NUDGE*gestureScale;
      // Колено PULL_KNEE: до него край идёт за пальцем 1:1, дальше мягко подходит к cap (жёсткий
      // упор оставлял излом кромки у пунктира: edge G1, конверт — 11 острых вершин против 8).
      const a = along*P.gain, top = P.cap > 0 ? P.cap : give, kn = PULL_KNEE*top;
      const want = a <= kn ? a : kn + (top - kn)*Math.tanh((a - kn)/(top - kn));
      e = P.cap > 0 ? pullTearLimit(P, ux, uy, want) : want;
      P.limKin = P.cap > 0 ? e : give;
      P.followed = true;
    } else {
      // Под махом быстрее порога шлепка язык короткий (PULL_FAST_CAP): длинный, отпущенный на подъёме,
      // выворачивал ячейки при ударе (Node 17.11, шесть случайных серий тяг и шлепков: 323 против 193).
      // В коридоре V_PULL_FULL…V_SLAP язык не укорачивается: там это ещё тяга, и её рост резать нечем.
      lim += (Math.min(lim, PULL_FAST_CAP*gestureScale) - lim) * P.fast;
      e = P.gain * lim * Math.tanh(along/lim);
      P.limKin = lim; P.atLimit = false;
    }
  } else { P.limKin = P.cap > 0 ? Infinity : 0; P.atLimit = false; }
  P.e = P.cap > 0 ? e : 0;
  P.ux = ux; P.uy = uy;
  pullPlace(P, ux, uy, e);
  if(follow && P.cap > 0 && len > 1e-9){
    // У предела (cap, разрыв или пунктир в секторе хвата) палец уходит вперёд края — край дрожит в рисунке.
    const g = action.edgeNode, d = (px[g]-P.bx[g])*ux + (py[g]-P.by[g])*uy;
    P.atLimit = Math.max(0, dx*ux + dy*uy)*P.gain - d > 0.03*gestureScale;
  }
}
// Расстановка узлов тяги: секторные зажимы к пунктиру. Сборка 84: языка за пунктиром нет и пока
// палец держит — держимая форма и есть зафиксированная.
function pullPlace(P, ux, uy, e){
  const dx = ux*e*P.k, dy = uy*e*P.k;
  // Ход зажат ПО УГЛУ: в каждом секторе кромка идёт наружу не дальше контура мишени × (1+PULL_OVER).
  // Запас считался только в точке хвата, и соседи уезжали за пунктир (ревью 17.11, P6: 1,21 мишени).
  // Доля хода s — одна на сектор (наименьшая по узлам кромки в нём и в соседних секторах) и
  // линейно по углу между секторами: узлы на одном луче идут с одной долей и друг друга не обгоняют
  // (зажим каждого узла по отдельности выворачивал ячейки у кромки: 9 за 8 тяг, Node 17.11).
  const tc = P.tc, S1 = pullS, S2 = pullS2; S1.fill(1);
  if(e > 0){
    const rMin = SQ_SIDE*targetR, lim2 = (x, y)=>{ const t = Math.atan2(y, x), l = targetAt(t)*(1+PULL_OVER); return l*l; };
    for(const i of P.rim){
      const w = P.w[i], x0 = P.bx[i]-tc.x, y0 = P.by[i]-tc.y, x = x0 + dx*w, y = y0 + dy*w, r2 = x*x + y*y;
      if(r2 <= rMin*rMin || r2 <= lim2(x, y)) continue;
      let k;
      if(x0*x0 + y0*y0 >= lim2(x0, y0)) k = (x0*dx + y0*dy) > 0 ? 0 : 1;   // уже за контуром: наружу ни шагу
      else { let lo = 0, hi = 1;
        for(let it=0; it<7; it++){ const m = (lo+hi)*0.5, xm = x0 + dx*w*m, ym = y0 + dy*w*m; if(xm*xm + ym*ym > lim2(xm, ym)) hi = m; else lo = m; }
        k = lo; }
      const b = ((Math.round(P.ab[i]) % RIM_BINS) + RIM_BINS) % RIM_BINS;
      if(k < S1[b]) S1[b] = k;
    }
    for(let b=0;b<RIM_BINS;b++) S2[b] = Math.min(S1[b], S1[(b+1)%RIM_BINS], S1[(b-1+RIM_BINS)%RIM_BINS]);
  } else S2.fill(1);
  for(let i=0;i<N;i++){
    const w = P.w[i]; let k = 1;
    if(w > 0 && e > 0){
      const f = P.ab[i], b0 = Math.floor(f), t = f - b0, i0 = ((b0 % RIM_BINS) + RIM_BINS) % RIM_BINS;
      k = S2[i0] + (S2[(i0+1)%RIM_BINS] - S2[i0])*t;
    }
    px[i] = P.bx[i] + dx*w*k; py[i] = P.by[i] + dy*w*k; prx[i]=px[i]; pry[i]=py[i]; vx[i]=0; vy[i]=0;
  }
}
function pullRestore(){
  const P = action.pull; if(!P) return;
  for(let i=0;i<N;i++){ px[i]=P.bx[i]; py[i]=P.by[i]; prx[i]=px[i]; pry[i]=py[i]; vx[i]=0; vy[i]=0; }
  action.pull = null;
}
function pullCommit(){
  const P = action.pull;
  // Сборка 84: коммит — та самая форма, что держал палец (зажатая к пунктиру, не дальше cap).
  // Переигровка прежней tanh-расстановки на отпускании отбрасывала край на 10–134 px (живой замер).
  // Короткая тяга — по ходу ПАЛЬЦА, а не края: край отстаёт (резинка, коридор скоростей), и по
  // его ходу быстрая тяга у самого порога шлепка откатывалась бы целиком.
  if(!P || P.e <= 0 || P.raw < PULL_MIN*gestureScale){
    const blocked = !!P && P.cap <= 0 && P.raw > 0;
    pullRestore(); lastDecision = blocked ? "сторона дотянута — тяни, где до пунктира далеко" : "тяга коротка";
    clearAction(); return;
  }
  for(const cc of cons){ if(cc.broken) continue;
    const o = Math.hypot(P.bx[cc.a]-P.bx[cc.b], P.by[cc.a]-P.by[cc.b]), n = Math.hypot(px[cc.a]-px[cc.b], py[cc.a]-py[cc.b]);
    if(o > 1e-9) cc.rest *= n/o; }
  action.impulse = P.e/gestureScale; action.kind = "pull"; action.direction = { x:P.nx, y:P.ny };
  lastDecision = "тяга " + (P.e/gestureScale).toFixed(2);
  action.pull = null; action.pointerId = null; pullN++; learn("pull");
  audioRelease(Math.min(1, P.e/(PULL_CAP_GS*gestureScale)));
  plasticT = 0; action.timer = 0.30; action.state = "SETTLING";
}
function startLift(v, force, held){
  // Язык тяги, начатой этим же движением, остаётся в руке до удара (см. «Подъём перед шлепком»):
  // длины покоя не тронуты, лист упруго вернётся сам.
  const rad = grabRadial(), sp = Math.hypot(v.x, v.y) || 1;
  action.state = "LIFTING";
  action.timer = LIFT_MAX; action.heldAtLift = Math.round(held);
  action.direction = { x:v.x/sp, y:v.y/sp };
  action.impulse = force;
  action.sweep = 0;
  action.liftI = Math.max(0, action.stroke.i0);
  action.liftRad = { x:rad.x, y:rad.y };
  noteRelease(v);
}
function updateActionMove(p, tEv, client){
  if(action.state === "CARRY"){                          // лист в руке: идёт за пальцем 1:1
    pushSample(p, tEv, client);
    xf.ox = p.x - action.carryFrom.x; xf.oy = p.y - action.carryFrom.y;
    return;
  }
  if(action.state === "LIFTING"){                        // палец ещё ведёт мах
    pushSample(p, tEv, client);
    const v = sampleVelocity(); action.velocity = { x:v.x, y:v.y };
    if(action.pull) pullTo(p, PULL_GAIN_FAST, 1);          // край на подъёме ещё идёт за пальцем
    // Мах ещё разгоняется: сила — по пику скорости, а не по первому событию за порогом.
    const f = slapForce(sampleVelocity(SLAP_WIN_MS), action.liftRad || action.direction, v);
    if(f > action.impulse){ action.impulse = f; noteRelease(v); }
    // Дуга или прямой — больше не развилка: мах от края всегда шлепок (перенос — только в руке).
    if(liftPath(LIFT_PATH).total >= LIFT_PATH*gestureScale) toFlying();
    return;
  }
  if(stepNo !== 1){
    if(action.state !== "ARMED" && action.state !== "PULLING") return;
    if(action.carryArm){
      // Взяла за середину: до CARRY_SLOP_CSS — дрожание пальца, дальше лист поднимается и идёт за рукой.
      pushSample(p, tEv, client);
      const m = action.samples[action.samples.length-1];
      if(Math.hypot(m.u-action.downM.u, m.v-action.downM.v)*gsCss() >= CARRY_SLOP_CSS) enterCarry();
      return;
    }
    // Пауза длиннее PAUSE_MS: прежний штрих кончился — судим его до того, как начнётся новый.
    if(action.stroke && Number.isFinite(tEv) && gapIsPause(gestureMetric(p, client), tEv) && judgeEndedStroke()) return;
    pushSample(p, tEv, client);
    updateGripFromHold();
    if(!action.moved) return;
    const v = sampleVelocity(); action.velocity = { x:v.x, y:v.y };
    if(action.stroke.start !== null && action.last.t - action.stroke.start >= VEL_WIN_MS && v.speed > action.vPeak) action.vPeak = v.speed;   // пик — только по полному окну
    const rad = grabRadial();
    const st = action.stroke, held = st.start === null ? 0 : st.start - action.down.t;
    const ripe = st.start !== null && action.last.t - st.start >= SLAP_MIN_MS;
    const vc = ripe ? sampleVelocity(SLAP_WIN_MS) : null, force = ripe ? slapForce(vc, rad, v) : 0;
    if(force > 0){ startLift(vc, force, held); return; }
    if(action.state === "ARMED"){
      // внутрь и вбок — ни тяга, ни шлепок: лист не трогаем, пока палец не пошёл наружу
      const dx = p.x-action.down.x, dy = p.y-action.down.y, len = Math.hypot(dx,dy);
      if(len < 1e-9 || (dx*rad.x + dy*rad.y)/len < PULL_OUT_COS) return;
      pullBegin();
    }
    pullTo(p, pullGain(v.speed), (v.speed - V_SLAP)/(PULL_FAST_BAND*V_SLAP), true);
    const P = action.pull, lim = Math.max(P.cap, P.limKin || 0, PULL_MIN*gestureScale);
    // пальцы соскользнули: тяга — единица действия, а не буксировка. Предел — фактический ход
    // языка (сборка 81: до предела разрыва), а не только запас до пунктира.
    if(P.cap > 0 && P.raw >= lim*PULL_SLIP && v.speed < V_SLAP*0.6 && action.last.t - action.stroke.start >= 120){
      noteRelease(v); pullCommit();
    }
    return;
  }
  if(action.state !== "ARMED") return;
  if(stepNo===1){                                      // шаг 1: нажим; кусок прыгает только от явного рывка
    if(action.kind==="lump"){ lumpFollow(p); return; }
    if(!action.kind){
      const moved = Math.hypot(p.x-action.down.x, p.y-action.down.y);
      const r = Math.max(R0, sheetRadius());
      const outward = (()=>{
        const c=centerOfSheet();
        const vx=p.x-action.down.x, vy=p.y-action.down.y;
        const rx=action.down.x-c.x, ry=action.down.y-c.y, rl=Math.hypot(rx,ry)||1;
        return (vx*rx + vy*ry)/rl;
      })();
      if(pointerOnRim(action.down) && moved > r*0.70 && outward > r*0.45){
        action.kind="lump"; lumpFollow(p); return;
      }
      if(moved > r*0.03) action.kind="flat";
    }
    action.last = { x:p.x, y:p.y, t: performance.now() };
  }
}

function releaseAction(tEv){
  if(stepNo===1){
    if(sheetReadyToStretch()) bakeFlatten();
    else clearAction();
    return;
  }
  if(action.state === "ARMED" && action.carryArm){ clearAction(); return; }   // тронула середину и отпустила — ничего
  if(action.state === "ARMED" || action.state === "PULLING"){
    // Быстрый короткий мах мог целиком уместиться между двумя событиями: на отпускании решаем
    // по тем же числам. Палец, который остановился, шлепком не считается, и край догоняет его.
    const tUp = Number.isFinite(tEv) ? tEv : performance.now(), st = action.stroke;
    const fresh = action.moved && st.start !== null && tUp - st.lastMoveT <= staleMs();
    // Штрих на ходу (fresh) судим сейчас. Вставший палец шлепком не считается — кроме короткого
    // маха, который ещё никто не судил: «рывок — стоп — отпустила» остаётся шлепком.
    if(fresh){
      st.judged = true;
      const j = strokeVerdict();
      if(j.force > 0){ startLift(j.vc, j.force, st.start - action.down.t); toFlying(); return; }
    } else if(judgeEndedStroke()) return;
    const v = fresh ? sampleVelocity() : { x:0, y:0, speed:0 };
    if(action.state === "ARMED"){ if(!action.moved) edgeTwitch(); clearAction(); return; }   // вела внутрь — ничего; тап по краю — край дёрнулся
    pullTo(action.last, pullGain(v.speed), 0, true);
    noteRelease(v); pullCommit(); return;
  }
  if(action.state === "LIFTING"){ toFlying(); return; }    // шлепок
  if(action.state === "CARRY"){ endCarry(tEv); return; }   // отпустила лист — решаем, куда он ляжет
  // FLYING/IMPACT/SETTLING/TOSS/LAY/BACK: жест автономен; поздний pointerup его не убивает.
  // (Псевдокод аудита здесь очищал бы состояние — это обрывало бы удар на лету.)
  action.pointerId = null;
}
// Полёт — 80–160 мс до удара, как на main. Там подъём начинался с первого движения, здесь мах
// подтверждается не раньше SLAP_MIN_MS от начала штриха: это время уже прошло у игрока на глазах
// (край тянулся за пальцем), и оно вычитается из полёта — иначе удар по длинному маху опаздывал
// на ~70 мс против main (ревью 17.11, P9).
const FLY_MIN = 0.02, LIFT_SEEN_MS = 80;
function toFlying(){
  learn("slap");
  const st = action.stroke, age = st && st.start !== null ? action.last.t - st.start : 0;
  action.state = "FLYING";
  action.timer = Math.max(FLY_MIN, 0.08 + Math.random()*0.08 - Math.max(0, age - LIFT_SEEN_MS)/1000);
  action.flyT = action.timer;
}

function updateAction(dt){
  if(action.state === "LIFTING"){
    action.timer -= dt;
    // Подъём кончают путь LIFT_PATH (в updateActionMove), отпускание, остановка руки (90 мс без
    // событий) или предохранитель LIFT_MAX — и всегда ударом: развилки «дуга или прямой» нет (#91).
    if(action.timer <= 0 || performance.now() - action.last.t > Math.max(90, 4*evStep())) toFlying();
  } else if(action.state === "PULLING"){
    // Палец остановился — край, отставший в коридоре скоростей, догоняет его.
    if(performance.now() - action.stroke.lastMoveT > staleMs()){
      if(judgeEndedStroke()) return;                         // короткий рывок и стоп — шлепок бьёт сам
      const P = action.pull;
      if(P && (P.gain < 1 || P.fast > 0)) pullTo(action.last, Math.min(1, P.gain + dt*4), Math.max(0, P.fast - dt*6), true);
    }
  } else if(action.state === "ARMED" && stepNo !== 1){
    if(action.stroke && performance.now() - action.stroke.lastMoveT > staleMs()) judgeEndedStroke();
  } else if(action.state === "CARRY"){
    // Лист в руке, пока палец на экране: ни таймера, ни остановки по неподвижной руке.
    action.carryT += dt;
    xf.lift = sheetRadius()*CARRY_LIFT*Math.min(1, action.carryT/CARRY_LIFT_T);
  } else if(action.state === "TOSS"){
    action.timer -= dt;
    updateToss();
    if(action.timer <= 0) land();
  } else if(action.state === "LAY"){
    action.timer -= dt;
    updateLay();
    if(action.timer <= 0) land();
  } else if(action.state === "BACK"){
    action.timer -= dt;
    const b = action.back, u = Math.max(0, Math.min(1, 1 - action.timer/BACK_T)), e = 1 - (1-u)*(1-u);
    xf.ox = b.ox*(1-e); xf.oy = b.oy*(1-e); xf.lift = b.lift*(1-e);
    if(action.timer <= 0){ xf = null; clearAction(); }   // узлы не трогались: лист тот же, бит в бит
  } else if(action.state === "FLYING"){
    action.timer -= dt;
    // язык в полёте отпускается наполовину (PULL_FLY_KEEP), остальное снимает удар
    const P = action.pull;
    if(P && action.timer > 0){ P.k = PULL_FLY_KEEP + (1-PULL_FLY_KEEP)*Math.max(0, Math.min(1, action.timer/(action.flyT||1))); pullTo(action.last); }
    if(action.timer <= 0) impactAction();
  } else if(action.state === "SETTLING"){
    action.timer -= dt;
    // Ранний выход по скорости — только со второй половины окна, иначе метрики
    // жеста записываются до того, как лист дорос до новых длин покоя.
    if(action.timer <= 0 || (action.timer < 0.15 && sheetSpeed() < SETTLE_SPEED)) finalizeGesture();
  }
}

// ─── Перенос на таву — взять лист в руку и отнести (сборка 70, 17.11.2026) ───
// Было: «запятая» — мах дугой от края, который стенд распознавал и отправлял лист в полёт (идея
// владелицы 25.08). Распознавание дуги и было источником «кидается» (#91). Теперь перенос — явное
// действие: коснуться СЕРЕДИНЫ листа и повести палец (или поставить на лист второй палец, пока
// первый держит край) — лист отрывается от стола и идёт за рукой 1:1, пока палец на экране.
// Отпустила над тавой — лист ложится с ближнего края (LAY), шипение растёт с площадью касания.
// Отпустила в другом месте — лист возвращается на своё место на столе (BACK): узлы не трогались,
// ни удара, ни штрафа. Быстро отпустила в сторону тавы готовый лист — бросок (TOSS), как раньше.
// Запятая осталась украшением: дуга руки от ARC_DECOR добавляет четверть оборота в полёте;
// садится лист всегда ровно по осям стола. Мах от края, прямой или дугой, — всегда шлепок.
// Недотянутый лист отнести и положить МОЖНО (⚑ владелица 08.09.2026): это теперь явный выбор.
// Бросок недотянутого листа не засчитывается — быстрый мах из середины на шаге 2 иначе закидывал
// бы лист на таву сам, а это и есть жалоба «кидается».
// Все числа — стартовые, не замеры: подстраиваются по журналу жестов (записи kind "lay"/"toss"/"carry").
const CARRY_ZONE = 0.45;                    // «середина»: ближе к центру, чем эта доля радиуса кромки в ту сторону
const CARRY_SLOP_CSS = 12;                  // CSS px от касания: дальше — лист в руке
const CARRY_GRAB_MS = 250, CARRY_SLOP_PRESS_CSS = 28;   // на таве: позже этого палец уже прижимает, и «в руку» — только дальше 28 px
const CARRY_LIFT = 0.10, CARRY_LIFT_T = 0.10;   // подъём в руке (доля радиуса листа) и время отрыва, с
const LAY_ZONE = 0.75;                      // центр листа ближе этой доли PAN_R к центру тавы — ляжет на таву
const LAY_T = 0.30;                         // с: укладка с ближнего края
const LAY_H = 0.30;                         // на сколько радиусов листа приподнят дальний край в начале укладки
const LAY_TOUCH = 0.15;                     // доля LAY_T, когда ближний край касается стали
const TOSS_MIN = 7;                         // gs/с на отпускании: быстрее и в сторону тавы — бросок
const TOSS_CONE = Math.cos(50*Math.PI/180); // конус броска к таве
const TOSS_AIM = 1.0;                       // …или луч по ходу руки проходит не дальше этой доли PAN_R от центра тавы
const ARC_DECOR = 60*Math.PI/180;           // поворот пути руки: с него — четверть оборота в полёте
const ARC_PATH = 5;                         // gs: поворот считается по последним стольким gs пути (примерно весь перенос)
const BACK_T = 0.16;                        // с: возврат листа на место
const CARRY_STALE_MS = 90;                  // мс без движения до отпускания: дольше — рука остановилась, броска нет
// ?carry=mid|two|both — каким входом берётся лист (для пробы владелицы; по умолчанию оба).
let CARRY_MODE = "both";
try{ const m = new URLSearchParams(location.search).get("carry"); if(m==="mid" || m==="two" || m==="both") CARRY_MODE = m; }catch(e){}

// Где точка относительно листа: 0 — центр мишени, 1 — кромка в эту сторону.
function sheetReach(p){
  const c = targetC(); rimProfile();
  const dx = p.x-c.x, dy = p.y-c.y, r = rimProf[rimBin(Math.atan2(dy,dx))] || sheetRadius() || 1;
  return Math.hypot(dx,dy)/r;
}
function inCarryZone(p){ return sheetReach(p) <= CARRY_ZONE; }
function carryOverPan(){
  if(!xf || phase !== "TABLE") return false;
  const c = centerOfSheet();
  return Math.hypot(c.x + xf.ox - panC.x, c.y + xf.oy - panC.y) <= LAY_ZONE*PAN_R;
}
function enterCarry(){
  pullRestore();                    // язык тяги в руку не едет: лист подхватывается ровным
  const c = centerOfSheet();
  action.state = "CARRY"; action.kind = "carry"; action.carryArm = false; action.carryT = 0;
  action.carryFrom = { x:action.last.x, y:action.last.y };
  action.liftI = Math.max(0, action.samples.length-1);
  xf = { cx:c.x, cy:c.y, ox:0, oy:0, th:0, lift:0 };
  tossTry++; lastDecision = "лист в руке";
  audioPeel();
}
// Второй палец на листе, пока первый держит край или середину: лист в руке, ведёт середина между пальцами.
function carryTwo(id, p2, client, tEv){
  const a = { id:action.pointerId, p:{ x:action.last.x, y:action.last.y }, c:action.lastClient || client };
  if(action.state !== "CARRY") enterCarry();
  action.two = { a, b:{ id, p:p2, c:client } };
  const m = twoMid(), t = Number.isFinite(tEv) ? tEv : performance.now(), g = gestureMetric(m.p, m.c);
  // отсчёты начинаются заново от середины: иначе прыжок «палец → середина» читался бы как рывок
  action.samples = [{ x:m.p.x, y:m.p.y, u:g.u, v:g.v, t }]; action.downM = { u:g.u, v:g.v }; action.moved = false;
  action.stroke = { start:null, path:0, lastMoveT:t, i0:0, au:g.u, av:g.v, judged:true }; action.liftI = 0;
  action.last = { x:m.p.x, y:m.p.y, t }; action.lastClient = m.c;
  action.carryFrom = { x:m.p.x - xf.ox, y:m.p.y - xf.oy };
  lastDecision = "лист в руке · два пальца";
}
function twoMid(){
  const T = action.two;
  return { p:{ x:(T.a.p.x+T.b.p.x)*0.5, y:(T.a.p.y+T.b.p.y)*0.5 }, c:{ x:(T.a.c.x+T.b.c.x)*0.5, y:(T.a.c.y+T.b.c.y)*0.5 } };
}
// Поворот пути руки за последние ARC_PATH gs переноса. Точки пути берутся не по событиям, а по
// расстоянию: новая — когда палец ушёл от прошлой на 0,25 gs. Дрожание стоящего пальца
// (±1,5 px) до этого шага не дотягивается и поворота не набирает (урок #91). Окно — по длине
// пути, а не по числу точек: на редких событиях точки стоят реже, и «последние 12» были бы длиннее.
function carryTurn(){
  const S = action.samples, stepL = 0.25*gestureScale, pts = [];
  let i0 = Math.min(action.liftI || 0, S.length-1); if(i0 < 0) return 0;
  let k = { x:S[i0].x, y:S[i0].y }; pts.push(k);
  for(let i=i0+1; i<S.length; i++) if(Math.hypot(S[i].x-k.x, S[i].y-k.y) >= stepL){ k = { x:S[i].x, y:S[i].y }; pts.push(k); }
  let from = pts.length-1, len = 0;
  while(from > 1 && len < ARC_PATH*gestureScale){ len += Math.hypot(pts[from].x-pts[from-1].x, pts[from].y-pts[from-1].y); from--; }
  let sweep = 0;
  for(let i=Math.max(2, from+1); i<pts.length; i++){
    const ax=pts[i-1].x-pts[i-2].x, ay=pts[i-1].y-pts[i-2].y, bx=pts[i].x-pts[i-1].x, by=pts[i].y-pts[i-1].y;
    sweep += Math.atan2(ax*by-ay*bx, ax*bx+ay*by);
  }
  return sweep;
}
// Скорость руки на отпускании. Окно растёт с шагом событий: на пропущенных кадрах (50 мс между
// событиями) в 80 мс попадают два отсчёта, и скорость считалась бы по всему штриху от его начала.
function carryVelocity(){ return sampleVelocity(Math.max(VEL_WIN_MS, 3.2*evStep())); }
function endCarry(tEv){
  if(!xf){ clearAction(); return; }
  const c = centerOfSheet(), hx = c.x + xf.ox, hy = c.y + xf.oy;   // где лист сейчас, в руке
  const tUp = Number.isFinite(tEv) ? tEv : performance.now(), st = action.stroke;
  // «Рука ещё шла»: с запасом CARRY_STALE_MS — у короткого броска всего два-три события, средний шаг
  // событий по ним не набирается, и touchend через 59 мс после последнего движения (свой Chrome,
  // события через 50 мс и реже) читался бы остановкой: бросок не засчитывался.
  const fresh = action.moved && st && st.start !== null && tUp - st.lastMoveT <= Math.max(staleMs(), CARRY_STALE_MS);
  const v = fresh ? carryVelocity() : { x:0, y:0, speed:0 };
  const turn = carryTurn(), quarter = Math.abs(turn) >= ARC_DECOR ? Math.sign(turn)*Math.PI/2 : 0;
  const two = !!action.two || !!action.wasTwo;
  action.pointerId = null; action.two = null; action.off = null; action.sweep = turn; noteRelease(v);
  action.rel.entry = two ? "two" : "mid"; action.rel.carry_ms = Math.round(action.carryT*1000);
  if(phase === "TABLE" && carryOverPan()){
    lastDecision = `в руке → на таву · лист ${sheetPct()}%`;
    startLay(hx, hy, quarter); return;
  }
  const tpx = panC.x - hx, tpy = panC.y - hy, tl = Math.hypot(tpx,tpy) || 1, sp = Math.hypot(v.x, v.y);
  // Конус — по ЭКРАНУ, как его видит рука: вид из-за прилавка сжимает стол по вертикали, и в
  // координатах стола 30° вбок на экране в альбоме выходили за 50° (проверка в Node, сборка 70).
  const qx = prX(panC.x,panC.y) - prX(hx,hy), qy = prY(panC.x,panC.y) - prY(hx,hy), ql = Math.hypot(qx,qy) || 1;
  // Лист уже ушёл за пальцем вбок, и направление «от листа к таве» отворачивается от руки: конус
  // 50° в портрете сжимался до ±28° (ревью сборки 70). Поэтому бросок засчитывается и тогда, когда
  // луч от листа по ходу руки попадает в саму таву (на экране она эллипс: ось Y растянута на 1/TILT).
  const ax = qx, ay = qy/TILT, dx = v.su||0, dy = (v.sv||0)/TILT, dl = Math.hypot(dx,dy);
  const aims = dl > 1e-9 && (ax*dx + ay*dy) > 0 && Math.abs(ax*dy - ay*dx)/dl <= TOSS_AIM*PAN_R;
  const toPan = sp > 1e-9 && v.speed > 1e-9 && (((v.su||0)*qx + (v.sv||0)*qy)/(v.speed*ql) >= TOSS_CONE || aims);
  if(phase === "TABLE" && stepNo === 3 && v.speed >= TOSS_MIN && toPan){
    lastDecision = `бросок ${v.speed.toFixed(1)} gs/с → тава · лист ${sheetPct()}%`;
    startToss(hx, hy, { x:v.x/sp, y:v.y/sp }, tl, quarter); return;
  }
  lastDecision = v.speed >= TOSS_MIN && toPan ? "бросок недотянутого листа не считается → на стол" : "в руке → обратно на стол";
  startBack();
}
// Лист возвращается на своё место: узлы физики не трогались, поэтому он тот же бит в бит.
function startBack(){
  action.state = "BACK"; action.pointerId = null; action.two = null; action.timer = BACK_T;
  action.back = { ox:xf.ox, oy:xf.oy, lift:xf.lift || 0 };
  const r = action.rel || {};
  gestures.push({ ...measurementContext(), kind:"carry", outcome:"back", entry:r.entry || "mid", carry_ms:r.carry_ms || 0,
    v_gs:+(r.v||0).toFixed(2), sheet_pct: sheetPct(), ts: new Date().toISOString() });
  if(gestures.length>200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
}
function cancelCarry(){ xf = null; clearAction(); }   // отмена касания, уход в фон: лист на столе, как был
// Куда сядет лист: центр не дальше от центра тавы, чем позволяет борт — углы остаются на стали.
function landingSpot(x, y){
  const c = centerOfSheet(); let rmax = 0;
  for(const i of edgeNodes){ if(conDeg && conDeg[i] <= 0) continue; const d = Math.hypot(px[i]-c.x, py[i]-c.y); if(d > rmax) rmax = d; }
  const cap = Math.max(0.05*PAN_R, 1.08*PAN_R - rmax);
  const ax = x - panC.x, ay = y - panC.y, al = Math.hypot(ax,ay), k = al > cap ? cap/al : 1;
  return { x:panC.x + ax*k, y:panC.y + ay*k, aim:al/PAN_R };
}
function startToss(hx, hy, dir, distToPan, quarter){
  learn("carry");
  // Бросок летит по направлению руки ровно на расстояние до тавы; промах от центра сохраняется,
  // но не дальше, чем позволяет борт (landingSpot). Садится ровно: поворот — 0 или четверть оборота
  // (украшение дугой), а в воздухе лист ещё чуть покачивается.
  const L = landingSpot(hx + dir.x*distToPan, hy + dir.y*distToPan);
  if(!xf){ const c = centerOfSheet(); xf = { cx:c.x, cy:c.y, ox:hx-c.x, oy:hy-c.y, th:0, lift:0 }; }
  action.state = "TOSS"; action.pointerId = null;
  action.toss = { x0:hx, y0:hy, x1:L.x, y1:L.y, spin:quarter || 0, wob:Math.max(-0.35, Math.min(0.35, (action.sweep||0)*0.3)),
    T: 0.34 + 0.16*Math.min(1, distToPan/(cv.width*0.5)), sweep: action.sweep || 0, aim: L.aim };
  action.timer = action.toss.T;
}
function updateToss(){
  const t = action.toss, u = Math.max(0, Math.min(1, 1 - action.timer/t.T));
  const e = u*u*(3-2*u);                                        // плавный разгон и посадка
  xf.ox = t.x0 + (t.x1-t.x0)*e - xf.cx;
  xf.oy = t.y0 + (t.y1-t.y0)*e - xf.cy;
  xf.th = t.spin*e + t.wob*Math.sin(Math.PI*u);                 // к посадке покачивание гаснет
  xf.lift = sheetRadius()*(0.10 + 0.38*Math.sin(Math.PI*u));    // подлетает и опускается
}
// Укладка: лист держат за дальние углы, ближний край касается стали первым, остальное
// раскатывается от игрока. У каждого узла своё время касания по его месту вдоль листа.
function startLay(hx, hy, quarter){
  learn("carry");
  const L = landingSpot(hx, hy), cs = Math.cos(quarter), sn = Math.sin(quarter);
  const s = new Float32Array(N); let lo = Infinity, hi = -Infinity;
  for(let i=0;i<N;i++){ const y = (px[i]-xf.cx)*sn + (py[i]-xf.cy)*cs; s[i] = y; if(conDeg && conDeg[i] <= 0) continue; if(y < lo) lo = y; if(y > hi) hi = y; }
  const span = Math.max(1e-6, hi - lo);
  for(let i=0;i<N;i++) s[i] = Math.max(0, Math.min(1, (hi - s[i])/span));   // 0 — ближний край (к игроку), 1 — дальний
  action.state = "LAY"; action.pointerId = null; action.timer = LAY_T;
  action.toss = { x0:hx, y0:hy, x1:L.x, y1:L.y, spin:quarter, wob:0, T:LAY_T, sweep:action.sweep || 0, aim:L.aim, lay:true, touched:false };
  xf.layS = s; xf.layU = 0; xf.layH = sheetRadius()*LAY_H; xf.lift0 = xf.lift || 0; xf.contact = 0;
}
function layTouchAt(s){ return LAY_TOUCH + (1-LAY_TOUCH)*s; }
function updateLay(){
  const t = action.toss, u = Math.max(0, Math.min(1, 1 - action.timer/t.T));
  const e = Math.min(1, u/0.6), k = e*e*(3-2*e);                // на место лист встаёт за первые 60 % укладки
  xf.ox = t.x0 + (t.x1-t.x0)*k - xf.cx;
  xf.oy = t.y0 + (t.y1-t.y0)*k - xf.cy;
  xf.th = t.spin*k; xf.layU = u;
  let on = 0, n = 0; const S = xf.layS;
  for(let i=0;i<N;i++){ if(conDeg && conDeg[i] <= 0) continue; n++; if(layTouchAt(S[i]) <= u) on++; }
  xf.contact = n ? on/n : 1;
  if(!t.touched && u >= LAY_TOUCH){ t.touched = true; audioPanTouch(); }
}
function land(){
  const t = action.toss;
  bakeTransform(t.x1 - xf.cx, t.y1 - xf.cy, t.spin);
  xf = null; phase = "PAN"; tossOk++;
  // Недотянутый лист тоже разрешено перенести. В step() эта ветка была недостижима:
  // лист в руке и на таве возвращаются раньше. Обновляем шаг в момент самой посадки.
  if(stepNo < 3){
    stepNo = 3;
    try{ localStorage.setItem("dough_step","3"); }catch(e){}
    syncStepButtons();
  }
  measureThickness();
  audioPanLand(!!t.lay);
  const r = action.rel || {};
  gestures.push({ ...measurementContext(), kind: t.lay ? "lay" : "toss", sweep_deg: Math.round(t.sweep*180/Math.PI),
    spin_deg: Math.round(t.spin*180/Math.PI), aim: +t.aim.toFixed(2),
    flight_ms: Math.round(t.T*1000), sheet_pct: sheetPct(),
    entry: r.entry || null, carry_ms: r.carry_ms || 0, v_gs: +(r.v||0).toFixed(2),
    ts: new Date().toISOString() });
  if(gestures.length>200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
  clearAction();
  startDish();
}
function bakeTransform(ox, oy, th){
  const c = Math.cos(th), s = Math.sin(th), cx = xf.cx, cy = xf.cy;
  for(let i=0;i<N;i++){
    const dx = px[i]-cx, dy = py[i]-cy;
    px[i] = cx + ox + dx*c - dy*s; py[i] = cy + oy + dx*s + dy*c;
    prx[i] = px[i]; pry[i] = py[i]; vx[i] = 0; vy[i] = 0;
  }
  sqC = null;                       // лист перенесён целиком — мишень встаёт под ним заново
}

// ─── Жарка листа без блюда (лист на таве, пока блюдо не собрано) и общие скорости ───
// Скорости те же, что у блюда: тава одна. Времена в фактчеке ниже — реальные секунды
// источников, игровые сжаты (см. DRY_RATE).
// Настоящая модель (две стороны, начинка, пузыри, переворот) — docs/frying-mechanics.md.
// Фактчек 26.08.2026 + перепроверка скептиками, вторая итерация:
//  • сначала СУШКА, потом цвет. Пока в тесте есть вода, испарительное охлаждение держит
//    контактную сторону у 100 °C: цвет требует >120 °C и a_w<0,6. Первая правка красила
//    лист с первой секунды — это была ошибка, источники дают «схватился, но без цвета»
//    к 15–30 с и первые золотые точки только к 30–45 с.
//  • толщина решает СУШКУ (её время ∝ толщине), а не скорость окраски: буреет тонкая
//    поверхностная ламина, ей всё равно, что под ней.
//  • тава греет широким пятном; кольцевая горелка даёт лёгкий горб на среднем радиусе,
//    а не пик в центре (inferred: ИК-замера настоящей кратхи нет).
//  • масло — скромный +5…15 %, а не ×1,3: жир заполняет микрозазор, но сам зазор не
//    узкое место, а лужа толще миллиметра уже теплоизолирует.
//  • контакт пятнистый (см. contactF) — отсюда «leopard spots» вместо гладкого градиента.
// Сжатие игрового времени (владелица 16.09: «жарка слишком долгая»; принято 30–60 с на всё
// роти, frying-mechanics.md §8). Условность, не физика: сушку ускоряем мало (×1,25 к прежним
// 0,13), чтобы схватывание осталось в окне 2–4 с и шипению было что сказать, а цвет — сильнее.
// Разбор четырьмя линзами 16.09 отверг один общий множитель: равномерное ×4 сжимало и мокрую
// фазу — переворот садил на сталь уже сухую сторону. Цвет ×6 (сборка 14, роти ~40 с) владелице
// показался слишком быстрым (17.09); по умолчанию ×3,5 — первая сторона ~30 с, роти ~55–59 с.
// Прибор «жарка» переключает цвет: ×6 / ×3,5 / ×2 ≈ роти 40 / 60 / 85 с.
const COOK_BASE = 0.0075, FRY_RATES = {40:0.028, 60:0.015, 180:0.0075};
let FRY_SECONDS = 40;                          // сборка 78: по умолчанию быстрая жарка (было 180) — см. MECHANICS «Жарка, сборка 78»
let DRY_RATE = 0.1625;                         // 1/с: лист 0,5 мм схватывается за 2–3 с и сохнет за ~7 с
let COOK_RATE = FRY_RATES[40];                 // «приготовленное» ~20 с на сторону, «горелое» ~60 с (замер — MECHANICS)
const OPEN_COOK_CAP = 0.06;                    // несложенный лист: цвет стоит ниже «бледного» (FRY_STEPS[0]) — румянец начинается с конверта
const COOK_CAP = 1.4;                          // сборка 78: темнеет дальше «зажаренного» — до горелого (было 0,92, «угля нет»)
// Цвет у конверта начинается до полной просушки: корочка сохнет первой. Доля скорости цвета растёт
// от 0 при сушке COOK_DRY_FROM до 1 при COOK_DRY_FULL (было: цвет только после сушки 1, и первые
// 15 с жарки на глаз не происходило ничего). Только у блюда (cookDish); числа — игровые.
const COOK_DRY_FROM = 0.15, COOK_DRY_FULL = 0.4;
// ОДНА лестница жарки на всё: строка стенда, карточка, журнал и тётя Сом (guest.js) берут ступень отсюда.
// 0 сырое · 1 бледное · 2 приготовленное · 3 зажаренное · 4 горелое.
const FRY_STEPS = [0.08, 0.28, 0.55, 1.10];
const FRY_WORDS = ["сырое", "бледное", "приготовленное", "зажаренное", "горелое"];
function fryStep(c){ let s=0; while(s<FRY_STEPS.length && c>=FRY_STEPS[s]) s++; return s; }
// ОДИН приговор роти — и для строки стенда, и для тёти Сом (guest.js зовёт это же). Смотрятся ОБЕ стороны
// (средний цвет стороны на стали и стороны, открытой сверху) и хруст от маргарина (dishCrisp):
//   raw    — обе стороны ниже «бледного»: сырое, гостья не берёт;
//   burnt  — хоть одна сторона «горелое»;
//   crunch — обе стороны не ниже «приготовленного», ИЛИ одна «приготовленное», другая не ниже «бледного»
//            и хруст от маргарина не меньше FRY_CRISP: маргарин под краем заменяет дожарку второй стороны;
//   nod    — всё остальное (съедобно, но не хрустит).
// Перевернуть вовремя — быстрый путь: без переворота верх быстро сложенного конверта остаётся сырым.
const FRY_CRISP = 5;
function fryVerdict(bottom, top, crisp){
  const a=fryStep(bottom), b=fryStep(top), lo=Math.min(a,b), hi=Math.max(a,b);
  if(hi<1) return "raw";
  if(hi>=4) return "burnt";
  return lo>=2 || (hi>=2 && lo>=1 && crisp>=FRY_CRISP) ? "crunch" : "nod";
}
let fryStageNow = 0, fryJumpAt = 0;
function panHeat(r){
  if(r < 0.45) return 0.90 + 0.10*(r/0.45);                     // центр внутри кольца пламени — чуть слабее
  if(r < 0.70) return 1.00 - 0.25*((r-0.45)/0.25);              // горб на среднем радиусе
  return Math.max(0.5, 0.75 - 0.20*((r-0.70)/0.30));            // прохладный борт
}
function cookStep(dt){
  if(fryHold) return;
  for(let i=0;i<N;i++){
    if(conDeg[i] <= 0) continue;
    const r = Math.hypot(px[i]-panC.x, py[i]-panC.y)/PAN_R;
    // Масло: скромные +5 % равномерно. Центральной добавки здесь БЫЛА +10 % при r<0.35 —
    // она гасила весь профиль panHeat: разница между центром и горбом на среднем радиусе
    // падала с 11 % до 0,3 %, то есть кольцевая горелка переставала быть видна, и лист
    // румянился ровно — против собственного фактчека строкой выше.
    const heat = panHeat(r) * oilMul(fatAt((px[i]-panC.x)/PAN_R, (py[i]-panC.y)/PAN_R)) * contactF[i];
    if(dry[i] < 1){
      const thin = Math.max(0.2, Math.min(2.0, 0.10/Math.max(0.05, thick[i])));
      dry[i] = Math.min(1, dry[i] + dt * DRY_RATE * heat * thin);
    } else {
      cook[i] = Math.min(COOK_CAP, cook[i] + dt * COOK_RATE * heat);
    }
  }
  tickFryStage();
}
// Ступень стороны на стали — по общей лестнице. Строку она больше не пишет («→ сырое» после переворота
// спорило с румяной стороной перед глазами, плейтест 17.11): что видно — говорит картинка.
function rotiStage(){ return fryStep(meanCook()); }
function tickFryStage(){
  const next = rotiStage();
  if(next === fryStageNow) return;
  fryStageNow = next;
  fryJumpAt = performance.now();
}
function meanCook(){
  if(dish) return dishSideMean("cook","contactWeights");   // цвет того, что сейчас жарится
  if(!cook) return 0;
  let s=0, n=0;
  for(let i=0;i<N;i++){ if(conDeg[i]<=0) continue; s+=cook[i]; n++; }
  return n ? s/n : 0;
}
// Звук ведёт вода, а не цвет: шипение и треск идут от сушки и потому ОПЕРЕЖАЮТ окраску —
// «суше и звонче» слышно раньше, чем видно золото. Это и есть «звук как HUD».
function meanDry(){
  if(dish) return dishSideMean("dry","contactWeights");    // вода прижатых сторон ведёт шипение
  if(!dry) return 0;
  let s=0, n=0;
  for(let i=0;i<N;i++){ if(conDeg[i]<=0) continue; s+=dry[i]; n++; }
  return n ? s/n : 0;
}

let SLAP_GROW = 0.145;           // сторона маха длиннее, но растёт весь лист. Сборка 81: 0,24 давал
                                  // готовность за 5–7 шлепков (плейтест 77, п. 9: «решают всё за пять
                                  // касаний»); 0,145 — сектор доходит до пунктира на 8–10-м шлепке,
                                  // готовность одними шлепками на 12–14-м, углы — тяга (Node, сборка 81)
let lastSlapDir = null, sameSlapN = 0;
const SAME_SLAP_COS = Math.cos(20*Math.PI/180);
let TEAR_I = 3.4;                // с этой силы шлепок опасен…
let TEAR_THIN = 0.10;            // …если лист уже истончился ниже этого
const TEAR_PRESETS = {
  easy: { i:2.3, thin:0.26 },    // дыры почти сразу — проба узора
  mid:  { i:3.4, thin:0.10 },    // сильный мах по уже тонкому
  hard: { i:4.2, thin:0.05 }     // рвёт редко, только жёсткий удар
};
let tearFeel = "mid";
function applyTearFeel(){
  const p = TEAR_PRESETS[tearFeel] || TEAR_PRESETS.mid;
  TEAR_I = p.i; TEAR_THIN = p.thin;
  try{ localStorage.setItem("dough_tear", tearFeel); }catch(e){}
  if(typeof document!=="undefined")
    document.querySelectorAll("[data-tear]").forEach(b=>b.classList.toggle("on", b.dataset.tear===tearFeel));
}

// Рваная дырка на дальней стороне по направлению маха: рвём связи небольшого
// пятна с неровным краем. Дырка остаётся навсегда — это узор, не наказание.
// Сборка 81 (плейтест 77, п. 9): рвёт только шлепок, пришедшийся ПО УЖЕ ТОНКОМУ МЕСТУ —
// тонкий узел ищется в конусе удара ±50° (дальняя сторона по маху, не центр листа),
// и дырка мала: пятно в полторы ячейки вместо 2,4 (было 19 рваных ячеек за 5 шлепков).
// Тонкого места в конусе нет — шлепок не рвёт, каким бы сильным ни был.
function punchHole(direction){
  const c = centerOfSheet(), sr = sheetRadius();
  const th = Math.atan2(direction.y, direction.x);
  let best = -1, bt = 1;
  for(let i=0;i<N;i++){
    if(conDeg && conDeg[i] <= 0) continue;
    const dx = px[i]-c.x, dy = py[i]-c.y, r = Math.hypot(dx, dy);
    if(r < sr*0.25 || r > sr*1.15) continue;        // не центр и не улетевший осколок
    let dth = Math.atan2(dy, dx) - th;
    while(dth > Math.PI) dth -= 2*Math.PI;
    while(dth < -Math.PI) dth += 2*Math.PI;
    if(Math.abs(dth) > Math.PI/3.6) continue;       // конус удара ±50°
    if(thick[i] < bt){ bt = thick[i]; best = i; }
  }
  if(best < 0 || bt >= TEAR_THIN) return false;     // тонкого места под ударом нет
  const rad = (Math.max(R0, sheetRadius())*2/(GRID-1)) * 1.5;   // маленькое пятно в шагах ТЕКУЩЕЙ сетки
  let torn = 0;
  for(let k2=0;k2<cons.length;k2++){
    const c2 = cons[k2]; if(c2.broken) continue;
    const mx = (px[c2.a]+px[c2.b])/2 - px[best], my = (py[c2.a]+py[c2.b])/2 - py[best];
    const d = Math.hypot(mx,my);
    if(d < rad * (0.65 + Math.random()*0.5)){ if(breakCon(c2)) torn++; }  // неровный край
  }
  if(torn) onTear();
  return torn > 0;
}
function impactAction(){
  action.state = "IMPACT";
  action.pull = null;               // язык отпущен: узлы остаются где были, длины покоя не тронуты
  const c = centerOfSheet();
  slapRoom(action.impulse, action.direction, c);   // доли роста по секторам: до пунктира и не дальше
  applySlapImpulse(action.impulse * gestureScale, action.direction, c);
  // Сработал стоп-сигнал audit §6.6: скоростной импульс в одиночку не растил площадь —
  // жёсткий решатель гасил растяжение раньше, чем пластичность его захватывала
  // (замер: diameterRatio 0.99–1.00 при любом ударе). Чиним связь по предписанию
  // аудита: удар даёт одноразовое пластическое растяжение длин покоя с той же
  // пространственной формулой весов, что у импульса. Скорости остаются как рывок и звук.
  plasticStretch(action.impulse, action.direction, c);
  {
    const d = lastSlapDir ? lastSlapDir.x*action.direction.x + lastSlapDir.y*action.direction.y : 0;
    // «Тот же край» — ближе SAME_SLAP_DEG к прошлому шлепку. Было 56,6° (d > 0,55): игрок шёл по кругу шагом
    // 30–45° и читал «теперь другой край» (плейтест 17.11 п. 12, ревью сборки 80).
    sameSlapN = d > SAME_SLAP_COS ? sameSlapN+1 : 1;
    lastSlapDir = { x:action.direction.x, y:action.direction.y };
  }
  // Дырка рождается из перестарательности: сильный шлепок по уже тонкому листу
  // рвёт дальнюю сторону. Сборка 81: тонкость судится МЕСТОМ — конусом удара в punchHole,
  // а не минимумом по всему листу: «шлепок по уже тонкому месту», дырка маленькая и у края.
  // Порог по силе (TEAR_I) и доля роста (SLAP_TEAR_SHARE) прежние: шлепок, который лист
  // уже не растит, не рвёт; средний шлепок (2,3 < 3,4) не рвёт никогда.
  if(action.impulse >= TEAR_I && slapShareMean() >= SLAP_TEAR_SHARE) punchHole(action.direction);
  audioSlap(action.impulse);
  plasticT = 0.15;
  action.timer = 0.30;             // успокоение = релаксация в новые длины покоя
  action.state = "SETTLING";
}

function slapWeight(x, y, direction, center, sr, t){
  const mx = x - center.x, my = y - center.y;
  const dl = Math.hypot(mx, my) || 1;
  const along = (mx/dl)*direction.x + (my/dl)*direction.y;
  // Лепесток мягкий: сторона маха растёт примерно вдвое сильнее спины, спина тоже растёт.
  // С 21.09 (сборки 51–56) росла почти одна сторона удара (спина 0,10, бока ~0,1):
  // лист шёл к мишени 12–15 шлепков вместо 5–6 и, смятый, больше не расправлялся.
  // 19.10.2026: пол 0,45 и гладкий профиль без излома на боках — при изломе бока
  // от сдвига выворачивались (Node: 13–16 ячеек против 5–7). Сила SLAP_GROW подобрана
  // под сборки 2–41: её четыре маха дают ~0,85 мишени, готов за 5 шлепков.
  // max(0, …): у узла точно напротив маха along из-за округления бывает −1,0000000000000002,
  // степень 1,5 от отрицательного — NaN, и за кадр NaN расходился по всему листу (сборка 75:
  // серия 7155 из T9b --full, первый же шлепок; на сборке 74 то же).
  const axis = 0.45 + 0.55 * Math.pow(Math.max(0, (1 + along) * 0.5), 1.5);
  const edge = Math.max(0, Math.min(1, dl/sr));
  const harden = 0.32 + 0.68 * Math.max(0, Math.min(1, t));
  return axis * (0.28 + 0.72*edge*edge) * harden;
}

// ─── Мишень шага 2 — квадрат со скруглёнными углами (16.11.2026) ───
// Владелица: роти квадратный; на кадрах бангкокских продавцов края тянут руками в почти квадрат
// (docs/sources). Мишень — суперэллипс по осям стола: полусторона SQ_SIDE·targetR, угол на 1,11·targetR.
// Рост режется ПО УГЛУ: сторона, дошедшая до пунктира, встаёт, остальные ещё растут — «тяни там,
// где до пунктира далеко». Раньше был один общий стоп по радиусу листа. Сборки 67–74 гасили рост
// шлепка только ЗА пунктиром (до × 1,12 у сторон и × 1,05 у углов) — сборка 75 останавливает его
// у пунктира заранее, см. «Шлепок уважает квадрат» ниже.
const SQ_N = 5, SQ_SIDE = 0.90, RIM_BINS = 48;
const READY_FILL = 0.92;          // sheetFill() с этого значения — лист готов к таве
const READY_STILL = 0.02;         // …и лист при этом стоит: средняя скорость узлов, доля targetR в секунду
const FILL_WORST = 0.85;          // готовый лист ни в одном секторе не короче этой доли мишени
const CORNER_TICK = 0.97;         // кромка/мишень на диагонали: угол дотянут — нота и вспышка (до сборки 76 — 0,93:
                                  // шлепки доводят углы до 0,92–0,96, и ноты играли без единой тяги; тяга даёт 0,98–1,00)
const CORNER_SIDE = 0.80;         // …и соседние стороны (±30° от диагонали) дотянуты хотя бы настолько
let rimProf = new Float32Array(RIM_BINS), rimSrc = new Float32Array(RIM_BINS), fillBuf = new Float32Array(RIM_BINS);
const pullS = new Float32Array(RIM_BINS), pullS2 = new Float32Array(RIM_BINS);   // доли хода тяги по секторам (pullTo)
function targetAt(th){ const c=Math.abs(Math.cos(th)), s=Math.abs(Math.sin(th)); return targetR*SQ_SIDE/Math.pow(Math.pow(c,SQ_N)+Math.pow(s,SQ_N), 1/SQ_N); }
// Центр мишени — место на столе, а не центр масс листа: пунктир не ездит за тестом и не прыгает
// на отпускании (ревью 17.11, P12: 0,06 gs после двух тяг). Ставится по центру листа на входе в
// шаг 2 и заново после любого переноса листа целиком (ресайз, возврат из руки на стол, «заново»).
// Кромка, готовность, углы и запас роста меряются от него: лист, уехавший вбок, с одной стороны
// не дотянут до пунктира, и тянуть надо там.
let sqC = null;
function targetC(){ return sqC || (sqC = centerOfSheet()); }
function rimBin(th){ return ((Math.floor((th+Math.PI)/(2*Math.PI)*RIM_BINS))%RIM_BINS+RIM_BINS)%RIM_BINS; }
// Профиль кромки: наибольший радиус живых узлов края в каждом из RIM_BINS секторов.
function rimProfile(c){
  c = c || targetC(); rimProf.fill(0);
  for(const i of edgeNodes){ if(conDeg && conDeg[i] <= 0) continue; const dx=px[i]-c.x, dy=py[i]-c.y, b=rimBin(Math.atan2(dy,dx)), d=Math.hypot(dx,dy); if(d>rimProf[b]) rimProf[b]=d; }
  const src = rimSrc; src.set(rimProf);
  for(let b=0;b<RIM_BINS;b++) if(!src[b]){ for(let k=1;k<RIM_BINS;k++){ const v=Math.max(src[(b+k)%RIM_BINS], src[(b-k+RIM_BINS)%RIM_BINS]); if(v){ rimProf[b]=v; break; } } }
  return rimProf;
}
// Заполнение мишени: меньшее из трёх — 18-й перцентиль отношения кромка/мишень по секторам,
// самая короткая из четырёх середин сторон и самый короткий сектор с поправкой READY_FILL/FILL_WORST
// (готовый лист нигде не короче FILL_WORST мишени). Одного перцентиля мало: он прощает 8 секторов
// из 48 — «подушка» с вогнутыми серединами сторон считалась готовой на 99 % (ревью 17.11, P5),
// а лист с одним недотянутым углом (0,64 мишени) — на 92 % (Node 17.11, случайные серии).
function sheetFill(){
  rimProfile(); const a = fillBuf;
  for(let b=0;b<RIM_BINS;b++) a[b] = rimProf[b]/targetAt((b+0.5)/RIM_BINS*2*Math.PI-Math.PI);
  let side = Infinity;
  for(let k=0;k<4;k++){ const b = (k*RIM_BINS/4) % RIM_BINS, m = (a[b] + a[(b-1+RIM_BINS)%RIM_BINS])*0.5; if(m < side) side = m; }
  a.sort(); return Math.min(a[Math.floor(RIM_BINS*0.18)], side, a[0]*READY_FILL/FILL_WORST);
}
function sheetPct(){ return Math.round(sheetFill()*100); }
// Кромка на направлении th (rimProfile уже посчитан): диагональ лежит на стыке двух секторов.
function rimAt(th){ return Math.max(rimProf[rimBin(th-0.02)], rimProf[rimBin(th+0.02)]); }
// Квадратность: радиус кромки на диагоналях к радиусу на серединах сторон (круг 1,0; квадрат 1,41).
function squareness(){
  rimProfile(); let d=0, m=0;
  for(let k=0;k<4;k++){ d += rimAt(Math.PI/4 + k*Math.PI/2); m += rimAt(k*Math.PI/2); }
  return m > 0 ? d/m : 1;
}
// Углы: каждый, впервые дошедший до мишени, — своя нота и вспышка; четвёртый — аккорд «готово».
let cornerDone = [0,0,0,0], cornerFlash = [0,0,0,0], readyBlinkAt = 0;
function cornerAngle(k){ return -Math.PI*3/4 + k*Math.PI/2; }
function resetCorners(){ cornerDone = [0,0,0,0]; cornerFlash = [0,0,0,0]; readyBlinkAt = 0; sqC = null; }
// Угол засчитывается, только если дотянуты и соседние стороны: одни тяги за углы давали звезду
// (угол/сторона 2,18, заполнение 0,61), а стенд играл четыре ноты и «готово» (ревью 17.11, P4).
// Аккорд и мигание борта — когда отмечены все четыре угла И лист готов: шаг 3 (лист в покое,
// сборка 76 — раньше аккорд мог сыграть на лету шлепка до шага 3) и sheetFill ≥ READY_FILL.
function checkCorners(){
  if(phase !== "TABLE" || stepNo < 2 || xf) return;
  let left = 0; for(let k=0;k<4;k++) if(!cornerDone[k]) left++;
  if(!left && readyBlinkAt) return;
  // Углы судятся по стоящему листу (как готовность) или под пальцем во время тяги: на лету шлепка
  // разлёт узлов на миг давал углу 0,97, лист оседал на 0,94, а нота уже сыграла (живая проба 17.11).
  if(action.state !== "PULLING" && sheetSpeed() >= READY_STILL*targetR) return;
  rimProfile();
  const rat = a => rimProf[rimBin(a)]/targetAt(a);
  for(let k=0;k<4;k++){
    if(cornerDone[k]) continue;
    const th = cornerAngle(k);
    if(rimAt(th)/targetAt(th) < CORNER_TICK) continue;
    if(Math.min(rat(th - Math.PI/6), rat(th + Math.PI/6)) < CORNER_SIDE) continue;
    cornerDone[k] = 1; cornerFlash[k] = performance.now(); left--;
    audioCornerTick(4 - left);
  }
  if(!left && !readyBlinkAt && stepNo === 3 && sheetFill() >= READY_FILL){ audioReady(); readyBlinkAt = performance.now(); }
}
// ─── Шлепок уважает квадрат (сборка 75, 17.11.2026) ───
// Сборки 67–74 гасили рост шлепка только ЗА пунктиром: сторона на 0,95 мишени получала полный
// шлепок и за один удар уходила на 1,25 (Node, серия 7005: 1,04 → 1,26; случайные серии T9b —
// кромка 1,19–1,31 мишени). Теперь шлепок до удара считает, куда уедет кромка в каждом из
// 48 секторов, и берёт от сектора не больше, чем осталось до пунктира:
//   кромка′ ≈ кромка · (1 + SLAP_REACH · SLAP_GROW · I · w̄),  w̄ — средний вес шлепка вдоль луча
//   сектора (узлы взвешены 1/r: среднее по лучу, а не по площади);
//   доля сектора slapS = запас до пунктира × slapCap / прогноз, 0…1, сглажена по соседям.
// Пока запаса хватает всем секторам (slapS = 1 везде), шлепок прежний, бит в бит: длины покоя
// растут одинаково во все стороны по весу slapWeight.
// Как только хоть один сектор упёрся, одной доли на связь мало: соседние секторы, растущие во все
// стороны, раздвигают и поднимают упёршийся (замер Node: сторона 1,02 → 1,07 за шлепок при своей
// доле 0). Поэтому общая часть (наименьшая доля slapMin) растит лист по-старому, а остаток даётся
// полем смещений, как у тяги: каждый узел едет наружу ПО СВОЕМУ ЛУЧУ, кромка сектора — на
// slapG = (slapS − slapMin) · прогноз, внутри луча — по профилю 0,28 + 0,24·(r/кромка)², и связи
// принимают длину сдвинутой сетки. Такое поле ничего не раздвигает вбок: упёршийся сектор стоит.
// Той же долей гаснет рывок скоростей (до SLAP_KICK_FLOOR): его разлёт закрепляет текучесть.
// Углы: на диагоналях шлепок ведёт кромку только до пунктира × SLAP_CAP_CORNER — лист от одних
// шлепков выходит скруглённым квадратом, острый угол дотягивает тяга. Провал узкий (sin¹⁶ 2θ):
// ниже READY_FILL остаются 8 секторов из 48, и лист от одних шлепков готов за те же 7 шлепков.
// SLAP_REACH 1,3 — поправка прогноза: при росте во все стороны кромка уходит дальше среднего по
// лучу (первый шлепок: прогноз +29 %, по замеру Node +37 %).
let SLAP_CAP = 1.0, SLAP_CAP_CORNER = 0.92, SLAP_REACH = 1.3, SLAP_KICK_FLOOR = 0.25;
const slapS = new Float32Array(RIM_BINS), slapG = new Float32Array(RIM_BINS), slapW = new Float32Array(RIM_BINS), slapD = new Float32Array(RIM_BINS);
let slapMin = 1, slapQx = null, slapQy = null;
function slapCap(th){ const q = Math.sin(2*th), q2 = q*q, q4 = q2*q2, q8 = q4*q4; return SLAP_CAP + (SLAP_CAP_CORNER - SLAP_CAP)*q8*q8; }
function slapRoom(I, direction, center){
  rimProfile();
  const tc = targetC(), sr = Math.max(1, sheetRadius()), rMin = sr*0.08;
  slapW.fill(0); slapD.fill(0);
  for(let i=0;i<N;i++){
    if(conDeg && conDeg[i] <= 0) continue;
    const dx = px[i]-tc.x, dy = py[i]-tc.y, r = Math.hypot(dx, dy);
    if(r < rMin) continue;
    const b = rimBin(Math.atan2(dy, dx)), k = 1/r;
    slapW[b] += slapWeight(px[i], py[i], direction, center, sr, thick[i]||1) * k; slapD[b] += k;
  }
  for(let b=0;b<RIM_BINS;b++){
    const th = (b+0.5)/RIM_BINS*2*Math.PI - Math.PI;
    const grow = SLAP_REACH * SLAP_GROW * I * (slapD[b] > 0 ? slapW[b]/slapD[b] : 0);
    const room = targetAt(th)*slapCap(th)/Math.max(1e-6, rimProf[b]) - 1;
    slapS[b] = room <= 0 ? 0 : grow > room ? room/grow : 1;
    slapG[b] = grow;
  }
  // гладко по углу и не больше себя: сосед дотянутой стороны не тащит её дальше
  const s = slapD; s.set(slapS); slapMin = 1;
  for(let b=0;b<RIM_BINS;b++){
    const l = s[(b-1+RIM_BINS)%RIM_BINS], r = s[(b+1)%RIM_BINS];
    slapS[b] = Math.min(s[b], (l + 2*s[b] + r)*0.25);
    if(slapS[b] < slapMin) slapMin = slapS[b];
  }
  for(let b=0;b<RIM_BINS;b++) slapG[b] *= slapS[b] - slapMin;   // ход кромки сверх общей доли, в долях её радиуса
}
// Величина сектора в точке: линейно между серединами секторов (slapRoom() уже посчитан).
function slapAt(arr, th){
  const f = (th + Math.PI)/(2*Math.PI)*RIM_BINS - 0.5, b0 = Math.floor(f), t = f - b0;
  return arr[((b0%RIM_BINS)+RIM_BINS)%RIM_BINS]*(1-t) + arr[(((b0+1)%RIM_BINS)+RIM_BINS)%RIM_BINS]*t;
}
// Средняя доля шлепка по секторам (slapRoom() уже посчитан): сколько от удара лист ещё берёт.
// Ниже SLAP_TEAR_SHARE шлепок лист уже не растит и не утончает — и дырку не пробивает: у листа,
// дошедшего до пунктира, дыра читалась как штраф ни за что (ревью сборки 75: 148 рваных ячеек
// за 8 шлепков на потолке силы по готовому квадрату при той же площади и толщине). Порог по доле
// в точке дырки не годится: к толщине 0,10 сторона по маху уже стоит у пунктира (доля 0), и
// шлепок не рвал бы никогда (Node 17.11: пятый шлепок на потолке — средняя доля 0,25, дальше ≤ 0,04).
const SLAP_TEAR_SHARE = 0.10;
function slapShareMean(){ let m = 0; for(let b=0;b<RIM_BINS;b++) m += slapS[b]; return m/RIM_BINS; }
function slapEase(x, y){ const tc = targetC(); return slapAt(slapS, Math.atan2(y - tc.y, x - tc.x)); }
function plasticStretch(I, direction, center){
  const sr = Math.max(1, sheetRadius()), limited = slapMin < 1;
  if(limited){
    // поле смещений «сверх общей доли»: узел едет по своему лучу, кромка — на slapG своего сектора
    const tc = targetC();
    if(!slapQx || slapQx.length !== N){ slapQx = new Float32Array(N); slapQy = new Float32Array(N); }
    for(let i=0;i<N;i++){
      const dx = px[i]-tc.x, dy = py[i]-tc.y, r = Math.hypot(dx, dy);
      if(r < 1e-6){ slapQx[i] = px[i]; slapQy[i] = py[i]; continue; }
      const th = Math.atan2(dy, dx), rim = slapAt(rimProf, th), e = rim > 0 ? Math.min(1.15, r/rim) : 1;
      const u = slapAt(slapG, th) * (0.28 + 0.24*e*e)/0.52;       // u_r/r для профиля роста 0,28 + 0,72·e²
      slapQx[i] = px[i] + dx*u; slapQy[i] = py[i] + dy*u;
    }
  }
  for(let k2=0;k2<cons.length;k2++){
    const c2 = cons[k2]; if(c2.broken) continue;
    const mx = (px[c2.a]+px[c2.b])*0.5, my = (py[c2.a]+py[c2.b])*0.5;
    const t = ((thick[c2.a]||1)+(thick[c2.b]||1))*0.5;
    const w = slapWeight(mx, my, direction, center, sr, t);
    c2.rest *= 1 + SLAP_GROW * I * w * slapMin;
    if(limited){
      const d0 = Math.hypot(px[c2.b]-px[c2.a], py[c2.b]-py[c2.a]);
      if(d0 > 1e-6) c2.rest *= Math.hypot(slapQx[c2.b]-slapQx[c2.a], slapQy[c2.b]-slapQy[c2.a])/d0;
    }
  }
}

// Рывок скоростей гаснет той же долей сектора (до SLAP_KICK_FLOOR): иначе разлёт узлов
// закреплялся текучестью, и сторона уходила за пунктир на 15 % при любом предохранителе длин
// покоя (Node 17.11: девять сильных шлепков — сторона 1,16 мишени, площадь 1,63 круга).
function applySlapImpulse(I, direction, center){
  const sr = Math.max(1, sheetRadius());
  for(let i=0;i<N;i++){
    const loose = conDeg ? Math.min(1, conDeg[i]/3) : 1;
    const ddx = px[i]-center.x, ddy = py[i]-center.y;
    const kick = SLAP_KICK_FLOOR + (1-SLAP_KICK_FLOOR) * slapEase(px[i], py[i]);
    const w = slapWeight(px[i], py[i], direction, center, sr, thick[i]||1) * loose * kick;
    const dl = Math.hypot(ddx,ddy) || 1;
    vx[i] += (ddx/dl*0.78 + direction.x*0.22) * I * w;
    vy[i] += (ddy/dl*0.78 + direction.y*0.22) * I * w;
  }
}

// Связь рвётся только здесь. Узел, потерявший все связи, — осколок: он замирает
// на месте и выпадает из всех измерений. Иначе шлепки разгоняли свободные узлы
// в бесконечность, и «радиус листа» (а с ним процент, хват и потолок роста)
// мерился по улетевшему мусору — живой тест поймал 5000 %.
function breakCon(c){
  if(c.broken) return false;
  c.broken = 1;
  for(const nn of [c.a, c.b]){
    if(--conDeg[nn] <= 0){ pinned[nn] = 1; vx[nn] = 0; vy[nn] = 0; }
  }
  return true;
}

function sheetSpeed(){
  let sum=0; for(let i=0;i<N;i++) sum += Math.hypot(vx[i],vy[i]);
  return sum/Math.max(1,N);
}

// Инварианты после каждого удара (audit §6.6). Стоп-сигнал: если медианная толщина
// падает, а areaRatio почти не растёт — чинить связь пластичности с импульсом,
// а не маскировать масштабом рендера.
function finalizeGesture(){
  let areaNow=0, holes=0;
  for(let q=0;q<quads.length;q++){
    areaNow += area(quads[q]);
    const qcn = quadCons[q];
    if(qcn.some(cc=>cc.broken)) holes++;
  }
  const ths = Array.from(thick).sort((x,y)=>x-y);
  // Числа жеста — для подстройки порогов по игре владелицы: скорость на решении и пик (gs/с и
  // CSS px/с), путь и длительность штриха, число событий, квадратность листа после жеста.
  const rel = action.rel || { v:0, peak:0, path:0, ms:0, events:0 }, gcss = gsCss();
  gestures.push({
    ...measurementContext(),
    kind: action.kind === "pull" ? "pull" : "slap",
    sweep_deg: Math.round(action.sweep*180/Math.PI),
    impulse: +action.impulse.toFixed(2),
    held_ms: action.heldAtLift,
    v_gs: +rel.v.toFixed(2), v_css: Math.round(rel.v*gcss),
    v_peak_gs: +rel.peak.toFixed(2), v_slap_gs: V_SLAP,
    path_gs: +rel.path.toFixed(2), stroke_ms: Math.round(rel.ms), events: rel.events,
    t_fallbacks: Math.max(0, evTimeFallbacks - (action.evFb0|0)),
    squareness: +squareness().toFixed(3), fill: +sheetFill().toFixed(3),
    areaRatio: +(areaNow/Math.max(1,startArea)).toFixed(3),
    diameterRatio: +(sheetRadius()/Math.max(1,startR)).toFixed(3),
    medianThickness: +(ths[ths.length>>1]||0).toFixed(3),
    minThickness: +(ths[0]||0).toFixed(3),
    holeQuads: holes,
    ts: new Date().toISOString()
  });
  if(gestures.length>200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
  clearAction();
}

function gripArc(n, mul){
  const rad = (Math.max(R0, sheetRadius())*2/(GRID-1)) * mul;   // шаг сетки текущего листа
  const ids=[], ws=[];
  for(const i of edgeNodes){
    const d = Math.hypot(px[i]-px[n], py[i]-py[n]);
    if(d<=rad){ ids.push(i); ws.push(1 - d/rad*0.75); }
  }
  return { ids, ws, mul };
}

// Разрыв судится по устойчивому натяжению за кадр, а не по шуму отдельного подшага,
// и распространяется по соседям — дырка рвётся дальше, как в настоящем тесте.
// Чем быстрее истончается место, тем раньше оно рвётся. Это ИГРОВАЯ УСЛОВНОСТЬ, не физика.
// У настоящего теста в измеренном окне (примерно 1e-3..1e-1 1/с) знак ОБРАТНЫЙ: быстрее
// растянутое рвётся при БОЛЬШЕЙ деформации, то есть более тонким (Sliwinski 2002, печ. с. 75,
// 76, 129; см. docs/simulation-references.md §б). Критерий Консидера этого не обосновывает
// ни в какую сторону: он про максимум силы при ПОСТОЯННОЙ скорости деформации, члена по
// скорости в нём нет. На скоростях живой руки (порядка 1..10 1/с) данных нет ни за, ни против —
// поэтому знак и не переворачивается вслед за литературой, а держится как условность ради
// читаемости жеста: истончение видно игроку за 0,77 с до разрыва.
// История имени: RATE_SENS («наказание за рывок») -> RATE_BRITTLE (07.09.2026, обоснование
// не выдержало проверки) -> TEAR_RATE_BIAS (08.09.2026, #90). Величина 0,30 не тронута:
// она подобрана под инструментальный прогон, а не под живую руку (#42).
let TEAR_RATE_BIAS = 0.30;
// CREEP объявлен наверху, вместе с формулой ползунка (#57)
const CREEP_ON = 0.06;             // порог растяжения, с которого тесто начинает течь

// Тесто ПЛАСТИЧНО: удержанное натяжение оно не возвращает, а запоминает — лист
// остаётся растянутым и становится тоньше. Чисто упругая модель рвалась на 1,3x
// и «прозрачного листа» из v3 не давала в принципе.
let evenBuf = null;
function evenOut(dt){
  // В окне удара почти не сглаживаем: иначе лепесток за кадр становится кругом.
  const k = Math.min(0.5, 3.2*dt) * (plasticT>0 ? 0.18 : 1);
  if(!evenBuf || evenBuf.length !== cons.length) evenBuf = new Float32Array(cons.length);
  let sum = 0, n = 0;
  for(let i=0;i<cons.length;i++){ const c=cons[i]; if(c.broken) continue;
    const d = Math.hypot(px[c.b]-px[c.a], py[c.b]-py[c.a]);
    evenBuf[i] = d / c.rest; sum += evenBuf[i]; n++; }
  if(!n) return;
  const mean = sum/n;
  for(let i=0;i<cons.length;i++){ const c=cons[i]; if(c.broken) continue;
    c.rest *= 1 + (evenBuf[i] - mean)/Math.max(0.2, mean) * 0.02 * k;
  }
}
function creep(dt){
  if(sheetRadius() > targetR*1.25) return;
  evenOut(dt);
  const k = Math.min(1, CREEP * (plasticT>0 ? PLASTIC_BOOST : 1) * dt);
  for(let i=0;i<cons.length;i++){
    const c=cons[i]; if(c.broken) continue;
    const d=Math.hypot(px[c.b]-px[c.a], py[c.b]-py[c.a]);
    if((d-c.rest)/c.rest > CREEP_ON) c.rest += (d-c.rest)*k;
  }
}
function checkBreak(dt){
  // Первые полторы секунды после нового комка тесто прощает: рвать новичка мгновенно
  // за первое же резкое движение — значит не дать ему вообще ничего понять.
  const young = (performance.now() - runStart) < 1500;
  if(young) return;
  // Тесто рвётся не там, где сильнее натянуто, а там, где стало слишком тонким:
  // «дырка» из v3 — это следствие истончения. Рывок рвёт раньше терпеливого растягивания,
  // потому что поднимает эффективный порог толщины: это наш выбор ради читаемости жеста,
  // а не свойство теста (см. TEAR_RATE_BIAS выше и docs/simulation-references.md §б).
  // судим по СГЛАЖЕННОЙ толщине: лист не рвётся от мгновенной дрожи после хлопка
  let torn = 0;
  if(!quadSm || quadSm.length!==quads.length) quadSm = new Float32Array(quads.length).fill(1);
  for(let q=0;q<quads.length;q++){
    const qq = quads[q];
    const raw = (thick[qq[0]]+thick[qq[1]]+thick[qq[2]]+thick[qq[3]])/4;
    quadSm[q] += (raw - quadSm[q]) * 0.12;
    const t = quadSm[q];
    if(t > 0.5) continue;
    const grow = quadPrev ? Math.max(0, (quadPrev[q]-t)/Math.max(1e-4,dt)) : 0;  // скорость истончения
    if(t < THICK_BREAK * Math.min(1.6, 1 + grow*TEAR_RATE_BIAS)){
      for(const c of quadCons[q]) if(breakCon(c)) torn++;
    }
  }
  if(quadPrev) for(let q=0;q<quads.length;q++){
    const qq=quads[q]; quadPrev[q]=(thick[qq[0]]+thick[qq[1]]+thick[qq[2]]+thick[qq[3]])/4;
  }
  if(torn) onTear();
}

// Толщина: чем сильнее узел растянут, тем тоньше лист и тем сильнее он просвечивает.
let maxStrain = 0, avgStrain = 0;
let accBuf=null, cntBuf=null, quadRest=null;
function area(q){
  const [a,b,c,d]=q;
  return Math.abs((px[a]*(py[b]-py[d]) + px[b]*(py[c]-py[a]) +
                   px[c]*(py[d]-py[b]) + px[d]*(py[a]-py[c]))/2);
}
// Объём теста сохраняется: во сколько раз выросла площадь, во столько раз лист тоньше.
// Это и есть «растянуть почти до прозрачности» — толщина падает как 1/площадь.
function measureThickness(){
  if(!accBuf || accBuf.length!==N){ accBuf=new Float32Array(N); cntBuf=new Float32Array(N); }
  if(!quadRest || quadRest.length!==quads.length){
    quadRest = new Float32Array(quads.length);
    for(let q=0;q<quads.length;q++) quadRest[q] = area(quads[q]) || 1;
  }
  accBuf.fill(0); cntBuf.fill(0);
  for(let q=0;q<quads.length;q++){
    const t = Math.min(1, quadRest[q] / Math.max(1e-3, area(quads[q])));
    for(const n of quads[q]){ accBuf[n]+=t; cntBuf[n]++; }
  }
  for(let i=0;i<N;i++) thick[i] = cntBuf[i] ? accBuf[i]/cntBuf[i] : 1;

  let mx=0, sum=0, live=0;
  for(let k=0;k<cons.length;k++){
    const c=cons[k]; if(c.broken) continue;
    const d=Math.hypot(px[c.b]-px[c.a], py[c.b]-py[c.a]);
    const st=Math.max(0,(d-c.rest)/c.rest);
    if(st>mx) mx=st; sum+=st; live++;
  }
  maxStrain=mx; avgStrain = live? sum/live : 0;
}

// ─────────────────────────── звук: три слоя, процедурно, без ассетов
let AC=null, master=null, tenseGain=null, tenseFilt=null, noiseBuf=null;
let sizzleGain=null, sizzleFilt=null, crackleNext=0;
let pressGain=null, pressFilt=null, pressCrunchNext=0;   // прижим: свой голос, шипение не трогает
// Звук по умолчанию выключен (владелица 17.11: «звук мешает… по умолчанию выключай»). Кнопка «звук»
// включает его, выбор помнится на этом устройстве (localStorage "roti_sound"). Пока звук выключен,
// AudioContext не создаётся вовсе: стенд молчит и в браузере проверок.
let soundOn = (()=>{ try{ return localStorage.getItem("roti_sound")==="on"; }catch(e){ return false; } })();
function audioWake(){ if(!soundOn) return; audioInit(); if(AC && AC.state==="suspended") AC.resume(); }
function soundLabel(){
  const b=typeof document!=="undefined" && document.getElementById("sound");
  if(b){ b.textContent=soundOn ? "звук: вкл" : "звук: выкл"; if(b.classList) b.classList.toggle("on",soundOn); }
}
function setSound(on){
  soundOn=!!on; try{ localStorage.setItem("roti_sound", soundOn ? "on" : "off"); }catch(e){}
  if(soundOn) audioWake(); else if(AC && AC.state==="running") AC.suspend();
  soundLabel();
}
function audioInit(){
  if(AC || !soundOn) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) return;                       // без звука стенд работает дальше
  AC = new Ctx({ latencyHint:"interactive" });
  master = AC.createGain(); master.gain.value = 0.9; master.connect(AC.destination);

  const len = AC.sampleRate*2, b = AC.createBuffer(1, len, AC.sampleRate), d = b.getChannelData(0);
  for(let i=0;i<len;i++) d[i] = Math.random()*2-1;
  noiseBuf = b;

  // слой 1 — натяжение: полосовой шум, «скрип» волокон
  const src = AC.createBufferSource(); src.buffer=b; src.loop=true;
  tenseFilt = AC.createBiquadFilter(); tenseFilt.type="bandpass"; tenseFilt.Q.value=6.5;
  tenseFilt.frequency.value=340;
  tenseGain = AC.createGain(); tenseGain.gain.value=0;
  src.connect(tenseFilt); tenseFilt.connect(tenseGain); tenseGain.connect(master); src.start();

  // слой тавы — шипение: полосовой шум; полоса уезжает вверх, когда тесто сохнет
  const sz = AC.createBufferSource(); sz.buffer=b; sz.loop=true;
  sizzleFilt = AC.createBiquadFilter(); sizzleFilt.type="bandpass"; sizzleFilt.Q.value=0.9;
  sizzleFilt.frequency.value=1800;
  sizzleGain = AC.createGain(); sizzleGain.gain.value=0;
  sz.connect(sizzleFilt); sizzleFilt.connect(sizzleGain); sizzleGain.connect(master); sz.start();

  // прижим: под мокрым местом — глухое «пш», под сухим — светлый хруст
  const pz = AC.createBufferSource(); pz.buffer=b; pz.loop=true;
  pressFilt = AC.createBiquadFilter(); pressFilt.type="bandpass"; pressFilt.Q.value=1.4;
  pressFilt.frequency.value=900;
  pressGain = AC.createGain(); pressGain.gain.value=0;
  pz.connect(pressFilt); pressFilt.connect(pressGain); pressGain.connect(master); pz.start();

  // Слоя «предупреждение об истончении» больше нет — решение владельца 22.08.2026:
  // разрыв не провал, предупреждать не о чем. Звуки листа: скрип натяжения,
  // шлепок удара, треск новой дырки.
}
function audioFrame(){
  if(!AC || condition==="sight"){
    if(tenseGain) tenseGain.gain.value=0;
    if(sizzleGain) sizzleGain.gain.value=0;
    if(pressGain) pressGain.gain.value=0;
    return;
  }
  const now = AC.currentTime;
  if(phase==="PAN"){
    // На таве натяжения нет — только жарка. Готовность ведёт звук, не процент:
    // шипение громкое, пока в тесте вода, и глохнет к концу; потрескивание редкое
    // на мокром и частое на сухом; полоса шипения уезжает вверх — «суше и звонче».
    tenseGain.gain.setTargetAtTime(0, now, 0.05);
    audioPress(now);
    // Лист в воздухе: стали он не касается, шипение почти сходит на нет до посадки.
    if(dishFlight || (dishGesture && dishGesture.slide)){ sizzleGain.gain.setTargetAtTime(0.02, now, 0.06); return; }
    const d = Math.max(0, Math.min(1, meanDry())), moist = 1 - d;
    // После сушки звук не замирает: цвет низа ведёт треск — чаще и громче, полоса звонче
    // (готовность ведёт звук; к золоту 0,4 — вдвое чаще, к румяному — ещё звонче).
    const gold = Math.max(0, Math.min(1.5, meanCook()/0.4));
    const lfo = 0.85 + 0.15*Math.sin(now*6.3);
    sizzleGain.gain.setTargetAtTime((0.03 + 0.24*moist)*lfo, now, 0.25);
    sizzleFilt.frequency.setTargetAtTime(1700 + 1600*d + 500*Math.min(1,gold), now, 0.3);
    if(crackleNext < now - 1) crackleNext = now;
    while(crackleNext < now + 0.1){
      if(crackleNext >= now - 0.05) audioCrackle(Math.max(now, crackleNext), d + 0.5*Math.min(1,gold));
      // жир под сухим низом — хруст: треск ещё чаще
      crackleNext += (0.9 - 0.75*d) * (1 - 0.5*Math.min(1,gold)) * (1 - 0.45*Math.min(1,fatUnder*2)*d) * (0.4 + Math.random()*1.2);
    }
    return;
  }
  if(action.state==="LAY" && xf && sizzleGain){
    // Лист ложится на таву: шипение растёт с долей листа, уже коснувшейся стали.
    sizzleGain.gain.setTargetAtTime(0.5*(xf.contact||0), now, 0.03);
    tenseGain.gain.setTargetAtTime(0, now, 0.05);
    return;
  }
  if(sizzleGain) sizzleGain.gain.setTargetAtTime(0, now, 0.08);
  if(pressGain) pressGain.gain.setTargetAtTime(0, now, 0.08);
  // Только скрип натяжения от фактической работы — никакой привязки к толщине:
  // лист не гудит «сейчас порвусь», он просто рвётся, и это слышно треском.
  const st = dish ? 0 : Math.min(1, avgStrain*2.5);
  tenseGain.gain.setTargetAtTime(dish ? 0 : Math.min(0.22, avgStrain*0.7), now, 0.04);
  tenseFilt.frequency.setTargetAtTime(260 + st*260, now, 0.05);
}
// Мазок маргарина по горячей стали — короткое шипение.
function audioSmear(){
  if(!AC || condition==="sight" || !noiseBuf) return;
  const s=AC.createBufferSource(); s.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="bandpass"; f.frequency.value=3200; f.Q.value=1.1;
  const g=AC.createGain(), t=AC.currentTime;
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.09,t+.02); g.gain.exponentialRampToValueAtTime(0.001,t+.16);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t+.18);
}
// Купол растёт — тихое «пш» с подъёмом тона; лопается — щелчок и выдох.
function audioDomeGrow(){
  if(!AC || condition==="sight" || !noiseBuf) return;
  const s=AC.createBufferSource(); s.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="bandpass"; f.Q.value=3;
  const g=AC.createGain(), t=AC.currentTime;
  f.frequency.setValueAtTime(1200,t); f.frequency.exponentialRampToValueAtTime(2600,t+.6);
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.05,t+.2); g.gain.exponentialRampToValueAtTime(0.001,t+.65);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t+.7);
}
// Купол опал сам — только тихий выдох, без щелчка.
function audioDomeSigh(){
  if(!AC || condition==="sight" || !noiseBuf) return;
  const t=AC.currentTime, x=AC.createBufferSource(); x.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="bandpass"; f.frequency.value=700; f.Q.value=1;
  const g=AC.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.035,t+.05); g.gain.exponentialRampToValueAtTime(0.001,t+.35);
  x.connect(f); f.connect(g); g.connect(master); x.start(t); x.stop(t+.37);
}
function audioDomePop(size){
  if(!AC || condition==="sight" || !noiseBuf) return;
  // несколько хлопков разом — не один синфазный удар: сдвиг во времени и в буфере шума
  const t=AC.currentTime+Math.random()*.06, k=Math.max(.5,Math.min(1.5,size/.1));
  const s=AC.createBufferSource(); s.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="highpass"; f.frequency.value=2200;
  const g=AC.createGain(); g.gain.setValueAtTime(0.22*k,t); g.gain.exponentialRampToValueAtTime(0.001,t+.03);
  s.connect(f); f.connect(g); g.connect(master); s.start(t,Math.random()*1.5); s.stop(t+.05);
  const x=AC.createBufferSource(); x.buffer=noiseBuf;
  const xf2=AC.createBiquadFilter(); xf2.type="bandpass"; xf2.frequency.value=900; xf2.Q.value=1.2;
  const xg=AC.createGain(); xg.gain.setValueAtTime(0.0001,t); xg.gain.setValueAtTime(0.0001,t+.01); xg.gain.exponentialRampToValueAtTime(0.07*k,t+.04); xg.gain.exponentialRampToValueAtTime(0.001,t+.3);
  x.connect(xf2); xf2.connect(xg); xg.connect(master); x.start(t); x.stop(t+.32);
}
// Голос прижима: громкость — от силы прижима, тембр и хруст — от воды под пальцем.
function audioPress(now){
  if(!pressGain) return;
  const held=dish && !dishFlight ? panPress.filter(p=>p.held) : [];
  const level=held.reduce((m,p)=>Math.max(m,p.level),0);
  const wet=Math.max(0,Math.min(1,pressWet));
  pressGain.gain.setTargetAtTime(level*(0.03+0.11*wet), now, 0.08);
  pressFilt.frequency.setTargetAtTime(900+2600*(1-wet), now, 0.1);
  if(level<=.05 || wet>.6){ pressCrunchNext=now; return; }
  if(pressCrunchNext < now-1) pressCrunchNext=now;
  while(pressCrunchNext < now+0.1){
    if(pressCrunchNext >= now-0.05) audioCrackle(Math.max(now,pressCrunchNext), 1-wet);
    pressCrunchNext += (0.35-0.25*level*(1-wet)) * (0.5+Math.random());
  }
}
function audioCrackle(t, dry){
  const s=AC.createBufferSource(); s.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="highpass"; f.frequency.value=2800;
  const g=AC.createGain(); const dur = 0.012 + Math.random()*0.012;
  g.gain.setValueAtTime(0.05 + 0.10*dry, t); g.gain.exponentialRampToValueAtTime(0.001, t+dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t+dur+0.01);
}
// Лист отрывается от стола: короткий мягкий «чпок» вверх по тону.
function audioPeel(){
  if(!AC || condition==="sight" || !noiseBuf) return;
  const s=AC.createBufferSource(); s.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="bandpass"; f.Q.value=1.2;
  const g=AC.createGain(); const t=AC.currentTime;
  f.frequency.setValueAtTime(320,t); f.frequency.exponentialRampToValueAtTime(1100,t+0.09);
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.10,t+0.02);
  g.gain.exponentialRampToValueAtTime(0.001,t+0.12);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t+0.14);
}
// Ближний край листа коснулся стали: тихий шлепок; шипение дальше ведёт площадь касания (audioFrame).
function audioPanTouch(){
  if(!AC || condition==="sight") return;
  audioSlap(0.8);
  crackleNext = AC.currentTime + 0.10;
}
// Посадка на таву: глухой шлепок и сразу волна шипения — маргарин встретил сырое тесто.
// soft — лист положили рукой (LAY): шлепка нет, шипение уже выросло вместе с касанием.
function audioPanLand(soft){
  if(!AC || condition==="sight") return;
  if(!soft) audioSlap(2.2);
  const now = AC.currentTime;
  sizzleGain.gain.cancelScheduledValues(now);
  sizzleGain.gain.setValueAtTime(0.5, now);
  crackleNext = now + 0.15;
}
// Касание края на таве: короткий тихий скрежет лопатки о сталь.
function audioScrape(){
  if(!AC || condition==="sight" || !noiseBuf) return;
  const s=AC.createBufferSource(); s.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="bandpass"; f.frequency.value=3400; f.Q.value=4;
  const g=AC.createGain(); const t=AC.currentTime;
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.10,t+0.015);
  g.gain.exponentialRampToValueAtTime(0.001,t+0.09);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t+0.1);
}
// Лопатка поддела край и лист пошёл вверх: короткий скрежет о сталь, шипение отступает.
function audioFlipLift(){
  if(!AC || condition==="sight" || !noiseBuf) return;
  const s=AC.createBufferSource(); s.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="bandpass"; f.frequency.value=2600; f.Q.value=3;
  const g=AC.createGain(); const t=AC.currentTime;
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.26,t+0.02);
  g.gain.exponentialRampToValueAtTime(0.001,t+0.16);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t+0.18);
  sizzleGain.gain.cancelScheduledValues(t); sizzleGain.gain.setTargetAtTime(0.02,t,0.05);
}
// Угол листа дотянут до мишени: короткая нота, четыре угла — четыре ступени вверх (до–ми–соль–до).
// Вибрации нет намеренно: в Safari на iOS её нет.
const CORNER_NOTES = [523.25, 659.25, 783.99, 1046.5];
function audioNote(freq, t, dur, gain){
  const o=AC.createOscillator(); o.type="triangle"; o.frequency.value=freq;
  const g=AC.createGain();
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(gain,t+0.008);
  g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t+dur+0.02);
}
function audioCornerTick(n){
  if(!AC || condition==="sight") return;
  audioNote(CORNER_NOTES[Math.max(0, Math.min(3, (n|0)-1))], AC.currentTime, 0.22, 0.16);
}
// Четвёртый угол: те же четыре ноты разом, чуть вразбивку — «готово».
function audioReady(){
  if(!AC || condition==="sight") return;
  const t=AC.currentTime;
  CORNER_NOTES.forEach((f,i)=>audioNote(f, t+i*0.045, 0.75, 0.10));
}
// Тяга отпущена: тихий глухой «пух» — тесто легло вытянутым. k — доля полной тяги.
function audioRelease(k){
  if(!AC || condition==="sight" || !noiseBuf) return;
  const s=AC.createBufferSource(); s.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="lowpass"; f.frequency.value=260+240*(k||0);
  const g=AC.createGain(); const t=AC.currentTime;
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.05+0.11*(k||0),t+0.012);
  g.gain.exponentialRampToValueAtTime(0.001,t+0.14);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t+0.16);
}
// слой 3 — разрыв
function audioSnap(){
  if(!AC || condition==="sight") return;
  const s=AC.createBufferSource(); s.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="highpass"; f.frequency.value=900;
  const g=AC.createGain(); const t=AC.currentTime;
  g.gain.setValueAtTime(0.55,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.18);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t+0.2);
}

function audioSlap(I){
  // Вызывается на переходе FLYING → IMPACT; громкость и яркость — от силы жеста.
  if(!AC || condition==="sight") return;
  const k = Math.max(0, Math.min(1, (I||1)/IMPULSE_MAX));
  const s=AC.createBufferSource(); s.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="lowpass"; f.frequency.value=420+420*k; f.Q.value=1.2;
  const g=AC.createGain(); const t=AC.currentTime;
  g.gain.setValueAtTime(0.20+0.45*k,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.11+0.06*k);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t+0.2);
}

// ─────────────────────────── события разрыва и нажатия
function onTear(){
  const nowT = performance.now();
  if(nowT - lastSnap > 150){ lastSnap = nowT; audioSnap(); }   // треск на каждую новую дырку, без пулемёта
  if(!tornAt){
    tornAt = nowT; breakTime = nowT; record();                 // в журнал — только первый разрыв листа
    // Предсказание получает ответ по существу, а не только вспышку: за сколько секунд угадала.
    // Порог 0,3 с — тот же, по которому пишется `predicted` в журнале, чтобы экран и лог совпадали.
    const lead = pressed ? (nowT - pressTime)/1000 : null;
    verdict = lead === null ? "порвался без предсказания — жми «сейчас порвётся», пока тянешь"
            : lead >= 0.3   ? `угадала: нажала за ${lead.toFixed(1)} с до разрыва`
                            : `почти: нажала за ${lead.toFixed(1)} с — засчитывается от 0,3 с`;
    verdictAt = nowT;
    const b = document.getElementById("tear"); if(b) b.classList.remove("armed");
  }
}
function pressNow(){
  if(pressed) return;
  pressed = true; pressTime = performance.now();
  // Вспышка заметная: 0,5 сразу, затем затухание по CSS-переходу. Она рисуется поверх
  // холста слоем композитора — на замере худшего кадра нажатие может стоить кадра,
  // поэтому во время прогона fps лучше не жать.
  flash.style.opacity = "0.5";
  setTimeout(()=>flash.style.opacity = "0", 150);
  const b = document.getElementById("tear");
  if(b && !tornAt) b.classList.add("armed");
  verdict = tornAt ? "лист уже порван — предсказывать нечего, жми «заново»"
                   : "предсказание записано · жду разрыва";
  verdictAt = performance.now();
}
let recorded = false;
function record(){
  if(recorded) return;
  if(!tornAt) return;                      // пишем только листы, дожившие до первого разрыва
  recorded = true;
  const lead = pressed ? (breakTime - pressTime)/1000 : null;   // за сколько секунд до разрыва
  log.push({
    ...measurementContext(),
    variant, condition,
    lead_s: lead === null ? null : +lead.toFixed(3),
    predicted: lead !== null && lead >= 0.3,
    pressed_at_all: pressed,
    run_ms: Math.round(breakTime - runStart),
    max_strain: +maxStrain.toFixed(3),
    audio_latency_ms: latencies.length ? +median(latencies).toFixed(1) : null,
    ts: new Date().toISOString()
  });
  try{ localStorage.setItem("dough_log", JSON.stringify(log)); }catch(e){}
}
function median(a){ const b=[...a].sort((x,y)=>x-y); const m=b.length>>1;
  return b.length%2 ? b[m] : (b[m-1]+b[m])/2; }

// ─────────────────────────── ввод
function nodeNear(x,y){
  // На расплющивании берём ближайший живой узел — иначе палец в середине
  // всё равно хватал край, и ямка не читалась.
  if(stepNo===1){
    let best=-1, bd=1e9;
    for(let i=0;i<N;i++){
      if(conDeg && conDeg[i]<=0) continue;
      const d=(px[i]-x)**2+(py[i]-y)**2; if(d<bd){bd=d;best=i;}
    }
    return best;
  }
  // Палец толстый, а комок маленький: требовать попадания в край — значит не дать
  // взять тесто вообще. Любое касание рабочей зоны берёт ближайший край листа.
  let best=-1, bd=1e9;
  for(const i of edgeNodes){
    const d=(px[i]-x)**2+(py[i]-y)**2; if(d<bd){bd=d;best=i;}
  }
  return best;
}
function toLocal(cx, cy){
  const r = cv.getBoundingClientRect();
  const sx=(cx-r.left)*cv.width/r.width, sy=(cy-r.top)*cv.height/r.height;
  return unproject(sx, sy);
}
// ─────────────────────────── ввод
// На iOS Safari pointer-события на холсте отменяются жестами страницы: pointerdown
// приходит, а pointermove — уже нет. Поэтому на тач-устройствах слушаем touch-события
// напрямую и гасим жест через preventDefault; мышь идёт своим путём.
let dbgDown = 0, dbgMove = 0, dbgKind = "ждёт";

// Время события, а не момент обработки: занятый главный поток склеивает touchmove,
// и по времени обработки медленная складка читалась бы как мах. Берём e.timeStamp,
// если он в той же шкале, что performance.now().
// Откат на время обработки считается (evTimeFallbacks) и пишется в журнал жеста: если шкала
// timeStamp на телефоне чужая, скорости жеста меряются по времени обработки — это надо видеть.
let evTimeFallbacks = 0;
function evTime(e){
  const now=performance.now(), t=e && e.timeStamp;
  if(Number.isFinite(t) && Math.abs(t-now)<1000) return t;
  evTimeFallbacks++; return now;
}
// Точка ввода на столе при нарезке берётся на нарисованном верху кусков, а не на плоскости стола.
function dishInputLocal(cx, cy){
  if(!dish || dish.mode!=="cut") return toLocal(cx, cy);
  const r = cv.getBoundingClientRect();
  return unproject((cx-r.left)*cv.width/r.width, (cy-r.top)*cv.height/r.height + tableLiftCanvas());
}
function onDown(id, cx, cy, t){
  if(performance.now()<inputQuietUntil) return;
  // Кусок маргарина отвечает и на пустой таве (сборка 78): мазок по стали оставляет лужицу. В вечере —
  // при зажжённой лампе и снятой крышке, в том числе пока стол свободен (там рамка вечера забирает касания).
  if(!dish && !fatGesture && action.pointerId===null && butterFree() && onButter(toLocal(cx,cy),{x:cx,y:cy})){ fatGesture={id,last:toLocal(cx,cy)}; butterTouch({x:cx,y:cy}); return; }
  if(typeof eveningDown==="function" && eveningDown(id, cx, cy, t)) return;   // лампа, миска, крышка, радио; стол до лампы молчит
  // Нажатие сразу после поворота колесом фиксирует поворот и идёт дальше как обычный жест
  // (иначе первый рез или складка после прокрутки пропадали).
  if(dish && dishTwist && dishTwist.input==="wheel") endTwist(true);
  dbgDown++;
  // iOS усыпляет AudioContext в фоне. Касание блюда тоже будит звук, иначе после
  // возврата шипение на таве молчало бы до «заново».
  if(dish){ audioWake();
            const p=toLocal(cx,cy);
            if(id[0]==="t") dishTouches.set(id,p);
            if(dishTwist) return;                              // третий палец поворот не меняет
            // Второй палец на поле — поворот (владелица 17.09): начатая складка или рез отменяются.
            if(id[0]==="t" && dishTouches.size===2){
              const ids=[...dishTouches.keys()], can=canTwist();
              if(!fatGesture && canSpread()){
                const a=dishTouches.get(ids[0]), b=dishTouches.get(ids[1]);
                dishPinch={ids,d0:Math.max(.04,Math.hypot(b.x-a.x,b.y-a.y))};
              }
              if(!fatGesture && can && beginTwist("touch",{ids})){ dishTwist.raw=tableAngle(dishTouches.get(ids[0]),dishTouches.get(ids[1])); twistDbg.last="два пальца"; return; }
              logTwistTry(fatGesture ? "маргарин" : !can ? "нельзя: "+dishModeWord() : "не начался");
            }
            // Порядок попадания: кусок маргарина → лист → сталь.
            if(!fatGesture && !dishGesture && dish.mode==="fold" && onButter(p,{x:cx,y:cy})){ fatGesture={id,last:p}; butterTouch({x:cx,y:cy}); return; }
            if(fatGesture) return;
            beginDishGesture(id,dishInputLocal(cx,cy),{x:cx,y:cy},t); return; }
  if(action.pointerId !== null){
    // Второй палец на листе, пока первый его держит, — взять лист в руку (сборка 70). Иначе второй
    // палец, как и раньше, игнорируется (audit §5).
    if(id[0]==="t" && id!==action.pointerId && !action.two && CARRY_MODE!=="mid" && stepNo!==1 && phase==="TABLE"
       && (action.state==="ARMED" || action.state==="PULLING" || action.state==="CARRY")){
      // Лист в руке нарисован со сдвигом: второй палец меряем по листу там, где он сейчас.
      const p2 = toLocal(cx, cy), q2 = xf ? { x:p2.x-xf.ox, y:p2.y-xf.oy } : p2;
      if(sheetReach(q2) <= 1.1) carryTwo(id, p2, {x:cx,y:cy}, t);
    }
    return;
  }
  if(action.state === "SETTLING") finalizeGesture(); // быстрый повторный тап не ждёт хвоста успокоения
  if(action.state === "BACK"){ xf = null; clearAction(); }   // и возврата листа на место тоже: узлы не трогались
  if(action.state !== "RESTING") return;             // остальные фазы доигрывают автономно
  const tDown = performance.now();
  audioWake();
  if(AC){
    const lat = (AC.baseLatency||0)*1000 + (AC.outputLatency||0)*1000 + (performance.now()-tDown);
    latencies.push(lat); if(latencies.length>60) latencies.shift();
  }
  const p = toLocal(cx, cy);
  const w = zone("work");
  if(phase !== "TABLE"){ dbgKind = "тава"; return; }   // лист на таве: жесты жарки — следующий этап
  // Отсекается только зона тавы, и по той оси, которая делит стол: в альбоме правее
  // теста, в портрете выше него. Сверху/снизу (в альбоме) и слева/справа (в портрете)
  // границ нет намеренно — любое касание берёт лист за ближайший край.
  if(stackedLayout() ? p.y < w.y : p.x > w.x + w.w) return;
  armAction(id, p, t, {x:cx,y:cy});                  // только выбор края: тесто НЕ двигается
}
function onMove(id, cx, cy, t){
  if(typeof eveningMove==="function" && eveningMove(id, cx, cy, t)) return;
  if(dishTouches.has(id)) dishTouches.set(id,toLocal(cx,cy));
  if(dishPinch && dishPinch.ids && dishPinch.ids.includes(id)){
    const a=dishTouches.get(dishPinch.ids[0]), b=dishTouches.get(dishPinch.ids[1]);
    if(a && b) spreadTo(1+(Math.hypot(b.x-a.x,b.y-a.y)/dishPinch.d0-1)*SPREAD_GAIN);
    else dishPinch=null;
  }
  if(dishTwist){
    const T=dishTwist;
    if(T.ids && T.ids.includes(id)){ twistTo(tableAngle(dishTouches.get(T.ids[0]),dishTouches.get(T.ids[1]))); return; }
    if(T.id===id){ twistTo(tableAngle(T.center,toLocal(cx,cy))); return; }
  }
  if(fatGesture && fatGesture.id===id){ const p=toLocal(cx,cy); smearStroke(fatGesture.last,p); fatGesture.last=p; return; }
  if(dishGesture && dishGesture.id===id){ dbgMove++; moveDishGesture(dishInputLocal(cx,cy),{x:cx,y:cy},t); return; }
  if(action.two){                                    // два пальца несут лист: ведёт середина между ними
    const T = action.two, f = id===T.a.id ? T.a : id===T.b.id ? T.b : null;
    if(!f) return;
    f.p = toLocal(cx, cy); f.c = {x:cx,y:cy};
    const m = twoMid(); dbgMove++;
    updateActionMove(m.p, t, m.c);
    return;
  }
  if(action.pointerId !== id) return;
  dbgMove++;
  if(action.off && action.state === "CARRY"){        // остался один палец из двух: ведёт ту же точку
    const p = toLocal(cx, cy), o = action.off;
    updateActionMove({x:p.x+o.x, y:p.y+o.y}, t, {x:cx+o.cx, y:cy+o.cy});
    return;
  }
  updateActionMove(toLocal(cx, cy), t, {x:cx,y:cy});
}
function onUp(id, cx, cy, t){
  if(typeof eveningUp==="function" && eveningUp(id, cx, cy, t)) return;
  dishTouches.delete(id);
  if(dishPinch && dishPinch.ids && dishPinch.ids.includes(id)) dishPinch=null;
  if(dishTwist && ((dishTwist.ids && dishTwist.ids.includes(id)) || dishTwist.id===id)){ endTwist(true); return; }
  if(fatGesture && fatGesture.id===id){ fatGesture=null; butterRenew(); return; }
  if(dishGesture && dishGesture.id===id){
    // touchend несёт последнюю точку: быстрый участок может прийти только в нём.
    const L=dishGesture.samples[dishGesture.samples.length-1];
    if(Number.isFinite(cx) && Number.isFinite(cy) && (cx!==L.x || cy!==L.y)) moveDishGesture(dishInputLocal(cx,cy),{x:cx,y:cy},t);
    endDishGesture(t); return;
  }
  // Лист несли двумя пальцами, один подняла: лист остаётся в руке у второго (случайный второй палец
  // раньше ронял лист и оставлял первый ни с чем — ревью сборки 70). Отпускает последний палец.
  // Ведущая точка не прыгает: оставшийся палец ведёт её с тем же сдвигом, что был до середины.
  if(action.two && (id===action.two.a.id || id===action.two.b.id)){
    const T = action.two, keep = id===T.a.id ? T.b : T.a, m = twoMid();
    action.off = { x:m.p.x-keep.p.x, y:m.p.y-keep.p.y, cx:m.c.x-keep.c.x, cy:m.c.y-keep.c.y };
    action.pointerId = keep.id; action.two = null; action.wasTwo = true;
    return;
  }
  if(action.pointerId !== id) return;
  const o = action.off;
  if(o && action.state === "CARRY" && Number.isFinite(cx) && Number.isFinite(cy)){
    const p = toLocal(cx, cy), c = {x:cx+o.cx, y:cy+o.cy};
    if(action.lastClient && (c.x !== action.lastClient.x || c.y !== action.lastClient.y)) updateActionMove({x:p.x+o.x, y:p.y+o.y}, t, c);
    releaseAction(t); return;
  }
  // touchend несёт последнюю точку: конец быстрого маха может прийти только в нём.
  if(stepNo !== 1 && Number.isFinite(cx) && Number.isFinite(cy) && action.lastClient
     && (cx !== action.lastClient.x || cy !== action.lastClient.y)
     && (action.state === "ARMED" || action.state === "PULLING" || action.state === "LIFTING" || action.state === "CARRY")){
    updateActionMove(toLocal(cx, cy), t, {x:cx,y:cy});
    if(action.pointerId !== id) return;              // тяга зафиксировалась сама (пальцы соскользнули)
  }
  releaseAction(t);
}
function onCancel(id){
  if(typeof eveningUp==="function" && eveningUp(id, NaN, NaN, NaN, true)) return;
  dishTouches.delete(id);
  // iOS может отменить касания, когда забирает жест двумя пальцами себе: поворот к этому моменту
  // уже сделан пальцами — фиксируем его, а не выбрасываем (отменить можно кнопкой).
  if(dishTwist && ((dishTwist.ids && dishTwist.ids.includes(id)) || dishTwist.id===id)){ twistDbg.cancels++; endTwist(dishTwist.input==="touch"); return; }
  if(fatGesture && fatGesture.id===id){ fatGesture=null; butterRenew(); return; }
  if(dishGesture && dishGesture.id===id){ releasePress(dishGesture); dishGesture=null; return; }
  if(action.two && (id===action.two.a.id || id===action.two.b.id)){ cancelCarry(); return; }
  if(action.pointerId !== id) return;
  // Отмена всегда возвращает покой из ARMED/LIFTING (audit §5); начатая тяга откатывается целиком;
  // автономные фазы (FLYING и дальше) доигрывают сами и очистятся за ≤0.4 с.
  if(action.state === "CARRY"){ cancelCarry(); }       // отмена касания: лист возвращается на стол как был
  else if(action.state === "PULLING" || action.state === "LIFTING"){ pullRestore(); clearAction(); }   // и язык подъёма тоже
  else if(action.state === "ARMED") clearAction();
  else action.pointerId = null;
}

// Слушаем на УРОВНЕ ОКНА в фазе перехвата: любой элемент поверх холста — подсказка,
// оверлей, что угодно — раньше съедал касание, и до игры не доходило ничего.
// На окне его не перехватит никто. Панель с кнопками отфильтрована по цели события.
let rawTouch = 0, rawPointer = 0;

// Что считается интерфейсом, а не полем. Касание интерфейса нельзя гасить через
// preventDefault: тогда браузер не синтезирует click, и кнопка мертва. Так 08.09.2026
// умерла кнопка «всё равно продолжить» на заглушке поворота: она лежала внутри #stage,
// а проверка была только на #panel. Заглушки больше нет, но правило остаётся:
// ЛЮБОЙ новый слой поверх поля добавлять СЮДА, иначе его кнопки не нажмутся.
function inUI(t){ return !!(t && t.closest && t.closest("#panel, #card, #radioSheet")); }

// Список пальцев на поле сверяется с тем, что знает сам браузер (e.touches): палец, чей конец
// не дошёл до страницы, иначе навсегда оставался бы «вторым» (ломал поворот), а его складка или
// рез висели бы и не пускали новые касания. Такой палец считается отменённым.
function syncDishTouches(e){
  if(!dishTouches.size || !e.touches) return;
  const live=new Set(); for(const t of e.touches) live.add("t"+t.identifier);
  for(const id of [...dishTouches.keys()]) if(!live.has(id)) onCancel(id);
}
window.addEventListener("touchstart", e=>{
  rawTouch++;
  syncDishTouches(e);
  if(inUI(e.target)) return;
  e.preventDefault(); dbgKind = "touch";
  const at = evTime(e);
  for(const t of e.changedTouches) onDown("t"+t.identifier, t.clientX, t.clientY, at);
}, {passive:false, capture:true});

window.addEventListener("touchmove", e=>{
  syncDishTouches(e);
  if(inUI(e.target)) return;
  e.preventDefault();
  const at = evTime(e);
  for(const t of e.changedTouches) onMove("t"+t.identifier, t.clientX, t.clientY, at);
}, {passive:false, capture:true});

window.addEventListener("touchend", e=>{
  const at = evTime(e);
  for(const t of e.changedTouches) onUp("t"+t.identifier, t.clientX, t.clientY, at);
}, {passive:false, capture:true});

window.addEventListener("touchcancel", e=>{
  for(const t of e.changedTouches) onCancel("t"+t.identifier);
}, {passive:false, capture:true});

window.addEventListener("pointerdown", e=>{
  rawPointer++;
  if(e.pointerType === "touch" || inUI(e.target)) return;
  dbgKind = "мышь";
  // Мышь: поворот — перетаскивание с Option/Alt вокруг середины блюда.
  if(e.altKey && (e.button===0 || e.button===undefined) && canTwist() && !dishTwist){
    const pose=dishPose(), pv=twistPivot(), center={x:pose.x+pv.x*pose.scale,y:pose.y+pv.y*pose.scale};
    if(beginTwist("alt",{id:"p"+e.pointerId,center})){ dishTwist.raw=tableAngle(center,toLocal(e.clientX,e.clientY)); return; }
  }
  onDown("p"+e.pointerId, e.clientX, e.clientY, evTime(e));
}, true);
// Safari (iOS и тачпад на маке) присылает свои события жеста двумя пальцами. Без preventDefault он
// может забрать жест себе (масштаб страницы) и отменить касания. Если поворот касаниями не начался,
// блюдо ведёт угол жеста Safari (e.rotation, градусы по часовой на экране).
for(const type of ["gesturestart","gesturechange","gestureend"]) window.addEventListener(type, e=>{
  if(inUI(e.target) || !dish) return;
  e.preventDefault();
  if(type==="gesturestart"){
    twistDbg.gestures++;
    if(canSpread()) dishPinch={gesture:true};
    if(!dishTwist && canTwist() && beginTwist("gesture",{})){ dishTwist.raw=0; twistDbg.last="жест Safari"; }
    return;
  }
  if(type==="gesturechange" && dishPinch && dishPinch.gesture && Number.isFinite(e.scale)) spreadTo(1+(e.scale-1)*SPREAD_GAIN);
  if(type==="gestureend" && dishPinch && dishPinch.gesture) dishPinch=null;
  if(!dishTwist || dishTwist.input!=="gesture") return;
  if(type==="gesturechange" && Number.isFinite(e.rotation)) twistTo(e.rotation*Math.PI/180);
  else if(type==="gestureend") endTwist(true);
}, {passive:false, capture:true});
// Колесо и прокрутка тачпада над полем крутят блюдо; фиксируется после паузы (TWIST_IDLE_MS).
// ⌥ + колёсико — раздвинуть куски и заглянуть в срезы (владелица 19.09: мышью двух пальцев нет).
// Щипок тачпада (ctrlKey) не трогаем. Без блюда колесо листает страницу, как раньше.
window.addEventListener("wheel", e=>{
  if(inUI(e.target) || e.ctrlKey || !dish) return;
  const d=Math.abs(e.deltaY)>=Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  const px=d*(e.deltaMode===1 ? 16 : e.deltaMode===2 ? 400 : 1);
  if(e.altKey){
    if(dishPinch && dishPinch.wheel && !canSpread() && dishSpread<=1){ dishPinch=null; return; }
    if(!canSpread() && !(dishPinch && dishPinch.wheel)) return;
    e.preventDefault();
    if(dishTwist && dishTwist.input==="wheel") endTwist(true);
    if(!(dishPinch && (dishPinch.ids || dishPinch.gesture))) dishPinch={wheel:true};
    spreadTo(dishSpread + Math.max(-40,Math.min(40,px))*0.012);
    return;
  }
  if(dishPinch && dishPinch.wheel) dishPinch=null;
  if(!canTwist() && !(dishTwist && dishTwist.input==="wheel")) return;
  if(dishTwist && dishTwist.input!=="wheel") endTwist(true);
  if(dishGesture){ releasePress(dishGesture); dishGesture=null; }
  e.preventDefault();
  if(!dishTwist && !beginTwist("wheel",{})) return;
  dishTwist.angle+=Math.max(-40,Math.min(40,px))*TWIST_WHEEL_DEG*Math.PI/180;
  dishTwist.lastT=performance.now();
}, {passive:false, capture:true});
window.addEventListener("keyup", e=>{
  if((e.key==="Alt" || e.code==="AltLeft" || e.code==="AltRight") && dishPinch && dishPinch.wheel)
    dishPinch=null;
}, true);
window.addEventListener("pointermove", e=>{
  if(e.pointerType === "touch" || inUI(e.target)) return;
  onMove("p"+e.pointerId, e.clientX, e.clientY, evTime(e));
}, true);
window.addEventListener("pointerup", e=>{ onUp("p"+e.pointerId, e.clientX, e.clientY, evTime(e)); }, true);
window.addEventListener("pointercancel", e=>{ onCancel("p"+e.pointerId); }, true);
// Уход в фон — та же отмена: не оставлять взведённый жест (audit §5).
addEventListener("blur", ()=>{
  releasePress(dishGesture); dishGesture=null; fatGesture=null;
  dishTouches.clear(); if(dishTwist) endTwist(dishTwist.input==="wheel");
  if(action.state==="CARRY"){ cancelCarry(); }
  else if(action.state==="PULLING"||action.state==="LIFTING"){ pullRestore(); clearAction(); }   // иначе тяга висела до «заново»: физика в ней стоит
  else if(action.state==="ARMED") clearAction();
});

addEventListener("keydown", e=>{
  if(e.code==="Space"){ e.preventDefault(); pressNow(); }
  if(e.code==="KeyR" && !eveningOn()){ restartRun(); }   // в рамке вечера «заново» — только через радио
});
// Кнопка «сейчас порвётся» убрана с панели 17.09 (владелица: «ей не пользуюсь, место только занимает»).
// Предсказание разрыва осталось в модели и на пробеле — им пользуется протокол замера, а не игрок.
{ const b = document.getElementById("tear"); if(b) b.addEventListener("click", pressNow); }
document.getElementById("reset").addEventListener("click", restartRun);
{ const sb=document.getElementById("sound"); if(sb){ sb.addEventListener("click",()=>setSound(!soundOn)); soundLabel(); } }
// Chrome даёт звуку проснуться только по отпусканию пальца (touchend/click), не по касанию: будим и там.
addEventListener("touchend", audioWake, {passive:true}); addEventListener("click", audioWake);
// Техническое снятие — тот же перелёт на стол, что и у жеста.
document.getElementById("cutMode").addEventListener("click", ()=>startRemoval());
document.getElementById("undoDish").addEventListener("click", undoDish);
document.getElementById("serveDish").addEventListener("click", serveDish);
document.getElementById("nextRoti").addEventListener("click", nextRoti);
// Технический вход переворота (как «к нарезке»): лист уходит от игрока и ложится обратно.
document.getElementById("flipDish").addEventListener("click", ()=>startFlip({x:0,y:-1},{x:0,y:0}));
document.getElementById("foldSample").addEventListener("click", ()=>{
  audioWake();
  stepNo=3; reset();
  const c=centerOfSheet(); xf={cx:c.x,cy:c.y};
  bakeTransform(panC.x-c.x,panC.y-c.y,0); xf=null; phase="PAN";
  measureThickness(); startDish(); audioPanLand();
});
// «Прибор» — шесть из семи строк панели, которые нужны замеру, а не игре. В ландшафте
// они уходят на лист поверх поля; лист не меняет размер #stage, поэтому лист теста цел.
const toolsBtn = document.getElementById("toolsBtn");
function setTools(on){
  document.body.classList.toggle("tools", on);
  toolsBtn.textContent = on ? "✕ закрыть" : "прибор ▸";
}
toolsBtn.addEventListener("click", ()=>setTools(!document.body.classList.contains("tools")));
// Тап по пустому месту листа закрывает его: лист накрывает поле, и искать кнопку,
// когда хочется просто вернуться к тесту, — лишний шаг.
document.getElementById("tools").addEventListener("click", e=>{ if(e.target.id==="tools") setTools(false); });

// Подсказка сразу на три шага занимала 2–4 строки и закрывала до 62 % поля в ландшафте
// (замер: низ #hint приходился на 40–62 % высоты #stage). Показываем только текущий шаг.
const HINTS = {
  1: "прижимай кусок: где ведёшь — там тоньше, край остаётся толстым. Когда весь тонкий — можно тянуть край",
  2: "шаг 2: резкий мах от края — шлепок, лист растёт. Медленно потяни за угол — выйдет квадрат. Тяни там, где до пунктира далеко",
  3: "шаг 3: возьми лист за середину и отнеси на таву — отпусти над ней, он ляжет и зашипит",
};
function syncStepButtons(){
  document.querySelectorAll("[data-s]").forEach(b=>b.classList.toggle("on", +b.dataset.s === stepNo));
  hintEl.textContent = HINTS[stepNo] || "";
  if(dish) syncDishUI();
}
document.querySelectorAll("[data-s]").forEach(b=>b.addEventListener("click", ()=>{
  const to = +b.dataset.s;
  // «растянуть» забирает ТЕКУЩИЙ диск, не новый. Иначе плющение выкидывалось,
  // и шаг 2 всегда начинался одним и тем же кругом.
  if(to === 2 && stepNo === 1 && phase === "TABLE"){
    if(flattenDidWork()) bakeFlatten();
    else {
      stepNo = 2;
      try{ localStorage.setItem("dough_step","2"); }catch(e){}
      reset();
    }
    return;
  }
  // «на таву» с шага 2 берёт ТЕКУЩИЙ лист любого размера (⚑ 08.09: недотянутый тоже несут),
  // а не отказывает и не пересобирает его.
  const ready = to === 1 ? false
              : to === 2 ? true
              :            stepNo === 2 || sheetReadyToPan();
  const keep = to === stepNo || (to > stepNo && ready && phase === "TABLE");
  stepNo = to;
  try{ localStorage.setItem("dough_step", String(stepNo)); }catch(e){}
  syncStepButtons();
  if(!keep) reset();
}));
try{ localStorage.setItem("dough_step","1"); }catch(e){}
stepNo = 1;
syncStepButtons();

// Ощущение теста подбирается рукой, а не прогоном: три ползунка меняют
// податливость, текучесть и запас прочности, значения переживают перезагрузку.
function applyTune(){
  if(runTuneAtBuild && ["com","creep","brk"].some(key=>TUNE[key]!==runTuneAtBuild[key])){
    mixedTune = true;
  }
  // Формулы и диапазоны не меняются вместе со стартовой точкой (#94).
  COMPLIANCE  = feelCompliance(TUNE);
  CREEP       = feelCreep(TUNE);
  THICK_BREAK = feelBreak(TUNE);
  try{ localStorage.setItem("dough_tune", JSON.stringify(TUNE)); }catch(e){}
}
// Ползунки переживают перезагрузку — значит замер можно снять на чужой настройке,
// не заметив этого. Панель обязана сказать, что ощущение не исходное (#89).
function tuneChanged(){
  return TUNE.com!==TUNE_DEFAULT.com || TUNE.creep!==TUNE_DEFAULT.creep || TUNE.brk!==TUNE_DEFAULT.brk;
}
try{ const t = JSON.parse(localStorage.getItem("dough_tune")||"null");
  if(t && typeof t==="object"){
    for(const key of ["com","creep","brk"]){
      if(typeof t[key]==="number" && Number.isFinite(t[key])){
        TUNE[key] = Math.max(0, Math.min(100, t[key]));
      }
    }
  }
}catch(e){}
[["sCom","com"],["sCreep","creep"],["sBreak","brk"]].forEach(([id,key])=>{
  const el = document.getElementById(id);
  el.value = TUNE[key];
  el.addEventListener("input", ()=>{ TUNE[key] = +el.value; applyTune(); });
});
document.getElementById("tuneDefault").addEventListener("click", ()=>{
  Object.assign(TUNE, TUNE_DEFAULT);
  [["sCom","com"],["sCreep","creep"],["sBreak","brk"]].forEach(([id,key])=>{
    document.getElementById(id).value = TUNE[key];
  });
  applyTune();
});
applyTune();

function reset(){ recorded=false; resetMeters(); resize(true); }

// Вид и условие меняют только draw() и звук — лист от них не зависит. Пересборка теряла
// растянутый лист (A и B мерились на разных листах) и вбрасывала свой всплеск в «худший».
document.querySelectorAll("[data-frame]").forEach(b=>{
  b.classList.toggle("on", b.dataset.frame===(frameWantedSafe()||""));
  b.addEventListener("click", ()=>setFrame(b.dataset.frame));
});
document.querySelectorAll("[data-z]").forEach(b=>{
  b.classList.toggle("on",+b.dataset.z===Z_EXAG);
  b.addEventListener("click",()=>setHeight(+b.dataset.z));
});
document.querySelectorAll("[data-v]").forEach(b=>b.addEventListener("click",()=>{
  variant=b.dataset.v;
  document.querySelectorAll("[data-v]").forEach(x=>x.classList.toggle("on",x===b));
  resetMeters(); setTools(false);
}));
document.querySelectorAll("[data-c]").forEach(b=>b.addEventListener("click",()=>{
  condition=b.dataset.c;
  document.querySelectorAll("[data-c]").forEach(x=>x.classList.toggle("on",x===b));
  resetMeters(); setTools(false);
}));
// Доля «низа сквозь лист» — условность отрисовки; кнопки убраны 19.09, остаётся 0
// (владелица: при нуле лист кажется зажаристее).
SHOW_THROUGH = 0;
document.querySelectorAll("[data-k]").forEach(b=>{
  b.classList.toggle("on", +b.dataset.k===SHOW_THROUGH);
});
// Сила прижима — прибор для пробы; кнопки убраны 19.09, остаётся 1.
PRESS_GAIN = 1;
document.querySelectorAll("[data-p]").forEach(b=>{
  b.classList.toggle("on", +b.dataset.p===PRESS_GAIN);
});
// Скорость жарки — минута (владелица 19.09: оставить, настроим потом).
function setFrySeconds(sec){
  if(!FRY_RATES[sec]) return;
  FRY_SECONDS=sec; COOK_RATE=FRY_RATES[sec];
  document.querySelectorAll("[data-f]").forEach(x=>x.classList.toggle("on",+x.dataset.f===sec));
}
setFrySeconds(40);
document.querySelectorAll("[data-f]").forEach(b=>{
  b.addEventListener("click", ()=>setFrySeconds(+b.dataset.f));
});
try{ tearFeel = localStorage.getItem("dough_tear") || "mid"; }catch(e){}
if(!TEAR_PRESETS[tearFeel]) tearFeel = "mid";
document.querySelectorAll("[data-tear]").forEach(b=>{
  b.addEventListener("click", ()=>{ tearFeel = b.dataset.tear; applyTearFeel(); });
});
applyTearFeel();
// Принудительное обновление: страница отдаётся с GitHub Pages и залипает в кеше,
// поэтому правки иначе не доезжают до телефона. Та же схема, что в «Лягушке».
document.getElementById("hardReload").addEventListener("click", ()=>{
  const btn = document.getElementById("hardReload");
  btn.textContent = "обновляю…";
  const done = ()=> location.replace(location.origin + location.pathname + "?v=" + Date.now());
  try{
    const jobs = [];
    if(window.caches && caches.keys){
      jobs.push(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
    }
    if(navigator.serviceWorker && navigator.serviceWorker.getRegistrations){
      jobs.push(navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))));
    }
    if(jobs.length){ Promise.all(jobs).then(done, done); setTimeout(done, 1200); }
    else done();
  }catch(e){ done(); }
});

function clearPlayLog(){
  log = [];
  gestures = [];
  recorded = false;
  try{ localStorage.removeItem("dough_log"); }catch(e){}
  try{ localStorage.removeItem("dough_gestures"); }catch(e){}
}
function restartRun(){
  stepNo=1;
  try{ localStorage.setItem("dough_step","1"); }catch(e){}
  clearPlayLog();
  reset();
}

function playLogText(){
  return JSON.stringify({ formatVersion:2, exportedAt:new Date().toISOString(),
    current:measurementContext(), tears:log, gestures,
    evening:typeof eveningExport==="function" ? eveningExport() : undefined }, null, 2);
}
function fallbackCopy(txt){
  const ta = document.createElement("textarea");
  ta.value = txt;
  ta.setAttribute("readonly","");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try{ ok = document.execCommand("copy"); }catch(e){}
  document.body.removeChild(ta);
  return ok;
}
async function copyPlayLog(){
  const txt = playLogText();
  const n = log.length + gestures.length;
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(txt);
      return { ok:true, n };
    }
  }catch(e){}
  if(fallbackCopy(txt)) return { ok:true, n };
  try{
    const blob = new Blob([txt], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "roti-log.json";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
    return { ok:true, n, file:true };
  }catch(e){}
  console.log(txt);
  return { ok:false, n };
}

document.getElementById("dump").addEventListener("click", async ()=>{
  const btn = document.getElementById("dump");
  const r = await copyPlayLog();
  btn.textContent = r.ok
    ? (r.file ? `лог в файле (${r.n})` : `скопировано (${r.n})`)
    : "не скопировалось";
  setTimeout(()=>btn.textContent = "скопировать лог", 1800);
});

// ─────────────────────────── рендер
// Тесто лежит на тёмной столешнице. Толстое — непрозрачное и бежевое; растянутое
// истончается и НАЧИНАЕТ ПРОСВЕЧИВАТЬ, то есть темнеет к цвету стола.
// Это и есть «растянуть почти до прозрачности» из v3, и это же — читаемый сигнал «сейчас порвётся».
const DOUGH = [240, 224, 176], TABLE = [36, 28, 19];   // сырое масляное тесто — кремово-жёлтое (владелица, 17.09)
// Под тестом — то, что реально лежит под ним: тёмный стол стенда или столешница с картинки рамы.
// Без этого на светлой стали лист выглядел грязно-серым (владелица, 17.09): он «просвечивал»
// цветом стола, которого в раме нет.
let UNDER = TABLE, PAN_UNDER = null;
function mix(t){                                   // t: 1 толстое → 0 тонкое
  // Пол просвечивания: самое тонкое тесто остаётся чуть светлее стола, иначе
  // дырка (настоящий стол и тень под ним) неотличима от тонкого места.
  // В раме пол выше: под тестом не тёмный стол, а светлая сталь. При 0,14 растянутый лист
  // растворялся в столешнице и уходил в серый, а сырое роти на видео — кремово-жёлтое
  // (владелица, 17.09). Просвечивание остаётся, но цвет держится своим.
  const floor = frameOn ? 0.55 : 0.14;
  const k = floor + Math.pow(Math.max(0,Math.min(1,t)), 0.85) * (1 - floor);
  return [ Math.round(UNDER[0]+(DOUGH[0]-UNDER[0])*k),
           Math.round(UNDER[1]+(DOUGH[1]-UNDER[1])*k),
           Math.round(UNDER[2]+(DOUGH[2]-UNDER[2])*k) ];
}
let PAL = buildPal();
function buildPal(){ return Array.from({length:16}, (_,i)=>{ const c = mix(i/15); return `rgb(${c[0]},${c[1]},${c[2]})`; }); }
function quant(t){ return PAL[Math.max(0,Math.min(15, Math.round(t*15)))]; }

// ── Сборка 81: тесто НА СТОЛЕ — светлое и тёплое, тонкость видна прозрачностью ──
// Плейтест 77 (п. 8): лист на столе был тёмно-хаки rgb(96,87,68) — mix() при толщине
// растянутого листа (~0,1) даёт всего 26 % пигмента. Теперь пигмент светлый всегда,
// а толщина показывает себя альфой: где тоньше, сквозь тесто проступает доска.
// Совсем тонкое (у порога разрыва) выцветает к светлому и почти прозрачному —
// предупреждение без мигания и значков. На таве лист рисуется иначе (mixOn + прожарка)
// и не тронут. Рваный край и так рисуется плотнее (t + 0,28 у порванных ячеек).
const DOUGH_PALE = [250, 242, 216];   // выцветший пигмент самого тонкого теста
const TEAR_VIEW = 0.004;              // ниже этой толщины лист в рисунке почти прозрачен (порог разрыва 0,003)
const TABLE_ALPHA_TOP = 0.20;         // толще — непрозрачно: диск и толстые места светятся собой
function tableAlpha(t){
  const k = Math.max(0, Math.min(1, (t - TEAR_VIEW) / (TABLE_ALPHA_TOP - TEAR_VIEW)));
  return 0.05 + 0.95 * Math.sqrt(k);   // 0,12 → 0,78 · 0,05 → 0,52 · 0,02 → 0,33 · у порога → 0,05
}
// rim: 1 — ячейка кромки: плотнее (альфа выше) и светлее, как толстый край в жизни
function tableSkin(t, rim = 0){
  const a = Math.min(1, tableAlpha(t) + 0.10 * rim);
  const pale = Math.max(0, Math.min(1, 1 - t / TABLE_ALPHA_TOP)) * 0.45 + 0.25 * rim;
  const c = [0, 1, 2].map(k => Math.round(DOUGH[k] + (DOUGH_PALE[k] - DOUGH[k]) * pale));
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
}

// На таве тонкое тесто просвечивает уже не столом, а дном тавы, и поверх ложится прожарка:
// сырое → золотистое → коричневое → тёмное. Тёмное — не провал (см. docs/frying-mechanics.md).
const PAN_BG_DEFAULT = [66, 58, 48];
function panBg(){ return PAN_UNDER || PAN_BG_DEFAULT; }
const GOLD = [224,168,72], BROWN = [176,96,36], DARK = [118,58,22], CHAR = [58,32,14];
function lerp3(a, b, k){ return [ a[0]+(b[0]-a[0])*k, a[1]+(b[1]-a[1])*k, a[2]+(b[2]-a[2])*k ]; }
function mixOn(t, bg){
  const k = 0.14 + Math.pow(Math.max(0,Math.min(1,t)), 0.85) * 0.86;
  return lerp3(bg, DOUGH, k);
}
function cookColor(base, c){
  const x = Math.min(c, COOK_CAP);
  if(x <= 0) return base;
  if(x < 0.35) return lerp3(base, GOLD, x/0.35);
  if(x < 0.70) return lerp3(GOLD, BROWN, (x-0.35)/0.35);
  if(x < 1.00) return lerp3(BROWN, DARK, (x-0.70)/0.30);
  return lerp3(DARK, CHAR, Math.min(1,(x-1.00)/0.12));   // сборка 78: дальше «зажаренного» — до горелого
}
const rgb = (c)=>`rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const palPan = new Map();   // 16 ступеней толщины × 16 ступеней прожарки — для пиксельных вариантов
function quantOn(t, c){
  const tq = Math.max(0,Math.min(15, Math.round(t*15))), cq = Math.max(0,Math.min(15, Math.round(c/1.7*15)));
  const key = tq*16 + cq;
  let s = palPan.get(key);
  if(!s){ s = rgb(cookColor(mixOn(tq/15, panBg()), cq/15*1.7)); palPan.set(key, s); }
  return s;
}
function shadeOn(t, c){ return rgb(cookColor(mixOn(t, panBg()), c)); }

// Картинка листа в руке и в полёте: узлы физики стоят, а рисуем их со сдвигом,
// поворотом и подъёмом из xf.
let vxBuf=null, vyBuf=null;
function viewX(){
  if(!vxBuf || vxBuf.length!==N){ vxBuf = new Float32Array(N); vyBuf = new Float32Array(N); }
  const c = Math.cos(xf.th), s = Math.sin(xf.th);
  // Укладка (LAY): у каждого узла свой подъём — ближний край уже на стали, дальний ещё в руке.
  const S = xf.layS, u = xf.layU || 0, H = xf.layH || 0, L0 = xf.lift0 || 0, ramp = Math.min(1, u/LAY_TOUCH);
  rimDraw();
  for(let i=0;i<N;i++){
    const dx = dX[i]-xf.cx, dy = dY[i]-xf.cy;
    let lift = xf.lift;
    if(S){ const tau = layTouchAt(S[i]); lift = u >= tau ? 0 : (L0 + H*S[i]*ramp)*(1 - u/tau); }
    vxBuf[i] = xf.cx + xf.ox + dx*c - dy*s;
    vyBuf[i] = xf.cy + xf.oy + dx*s + dy*c - lift;
  }
  return vxBuf;
}
function viewY(){ return vyBuf; }

// ─── Валик кромки (сборка 88, видимый жест: разбор 17.11, п. 1) ───
// Кромка настоящего роти толще середины и не растягивается в бумагу: она светлая и непрозрачная на всех
// шагах растяжки. Прежде это делал один ряд ячеек кромки (rimEdgeQ) — на тонком листе он светлел вровень
// с серединой и терялся, а второй ряд ячеек давал лесенку. Теперь валик — полоса вдоль нарисованной
// кромки (rimLoop по dX/dY, тот же сглаженный контур, что у ячеек), обрезанная по листу: внутренний край
// ровный, наружу лист не растёт. Мягкий край — вторая, шире и прозрачнее, полоса. Ширина — доля листа.
const RIM_ROLL = "rgb(247,236,204)", RIM_ROLL_SOFT = "rgba(247,236,204,0.45)", RIM_ROLL_W = 0.035;
function drawRimRoll(g, Pnt, sx){
  const L = rimLoop; if(!L || L.length < 8) return false;
  g.save(); g.beginPath();
  for(let k=0;k<L.length;k++){ const p = Pnt(L[k]); k ? g.lineTo(p.x,p.y) : g.moveTo(p.x,p.y); }
  g.closePath(); g.clip();
  const w = Math.max(2, sheetRadius()*RIM_ROLL_W*sx);
  g.lineJoin = "round";
  g.strokeStyle = RIM_ROLL_SOFT; g.lineWidth = 2*w*1.7; g.stroke();
  g.strokeStyle = RIM_ROLL; g.lineWidth = 2*w; g.stroke();
  g.restore(); return true;
}
// ─── Лист без граней и заплат (сборка 94, ревью 18.11, кадр c) ───
// Ячейки листа одного цвета на ячейку давали полосы-грани растяжения, а у дыр рваный край рисовался
// «толще» (+0,28) — непрозрачные светлые прямоугольники вокруг каждой дыры. Теперь целые ячейки
// рисуются в отдельный слой (половинное разрешение), слой ложится на стол с размытием в полшага сетки
// и обрезается по нарисованной кромке (rimLoop). Чтобы размытие не разбавляло край прозрачностью,
// снаружи кромки и в дырах слой подбит средним цветом листа. Только рисунок: толщина, физика, разрыв
// не трогаются. Без ctx.filter (старый Safari) слой рисуется в 1/8 и растягивается сглаживанием.
let softCv = null, softG = null;
function sheetCellPx(sx){ return Math.max(R0, sheetRadius())*2/(GRID-1)*sx; }   // шаг сетки на экране
function drawSheetSoft(g, Pnt, Hmap, sx, bodyC, bodyR2, W, H){
  const L = rimLoop; if(!L || L.length < 8) return false;
  const hasFilter = typeof g.filter === "string", k = hasFilter ? 0.5 : 0.125;
  const cw = Math.max(1, Math.ceil(W*k)), ch = Math.max(1, Math.ceil(H*k));
  if(!softCv){ softCv = document.createElement("canvas"); softG = softCv.getContext("2d"); }
  if(softCv.width !== cw || softCv.height !== ch){ softCv.width = cw; softCv.height = ch; }
  const s = softG, blur = sheetCellPx(sx)*0.55;
  s.setTransform(1,0,0,1,0,0); s.clearRect(0, 0, cw, ch); s.setTransform(k,0,0,k,0,0);
  let st = 0, sn = 0;
  for(let i=0;i<N;i++){ if(conDeg && conDeg[i] <= 0) continue; st += Hmap[i]; sn++; }
  const pad = tableSkin(sn ? st/sn : 0.72, 1), padHole = tableSkin(sn ? st/sn : 0.72, 0);   // у дыры — без светлой кромки
  const outline = (c)=>{ c.beginPath(); for(let j=0;j<L.length;j++){ const p = Pnt(L[j]); j ? c.lineTo(p.x,p.y) : c.moveTo(p.x,p.y); } c.closePath(); };
  const inBody = (i)=> (px[i]-bodyC.x)**2 + (py[i]-bodyC.y)**2 < bodyR2;
  for(let q=0;q<quads.length;q++){
    const qc = quadCons[q], [a,b2,c,d] = quads[q];
    const torn = qc[0].broken || (qc[1]&&qc[1].broken) || (qc[2]&&qc[2].broken) || (qc[3]&&qc[3].broken);
    if(torn){
      if(!(inBody(a) && inBody(b2) && inBody(c) && inBody(d))) continue;   // выеденный край: теста нет и в слое
      s.fillStyle = padHole;                            // дыра в слое закрыта: её рисуем поверх чётко
    } else s.fillStyle = tableSkin((Hmap[a]+Hmap[b2]+Hmap[c]+Hmap[d])/4, rimEdgeQ ? rimEdgeQ[q] : 0);
    const Pa=Pnt(a), Pb=Pnt(b2), Pc=Pnt(c), Pd=Pnt(d);
    s.beginPath(); s.moveTo(Pa.x,Pa.y); s.lineTo(Pb.x,Pb.y); s.lineTo(Pc.x,Pc.y); s.lineTo(Pd.x,Pd.y); s.closePath(); s.fill();
  }
  // подбивка снаружи кромки — только вне листа (evenodd), чтобы внутри альфа не складывалась
  s.save(); outline(s); s.rect(-W, -H, 3*W, 3*H); s.clip("evenodd");
  outline(s); s.lineJoin = "round"; s.strokeStyle = pad; s.lineWidth = blur*4; s.stroke();
  s.restore();
  g.save(); outline(g); g.clip();
  if(hasFilter) g.filter = `blur(${blur.toFixed(1)}px)`;
  g.drawImage(softCv, 0, 0, cw, ch, 0, 0, cw/k, ch/k);
  g.restore();
  return true;
}
// Кромка дыры (сборка 94): рваная ломаная по цепочкам buildHoleChains — между узлами по две точки,
// сдвинутые поперёк на постоянный для узла шум, — и полупрозрачная плёнка теста по ней: тонкое тесто
// у разрыва просвечивает, а не скатывается в светлый валик.
function drawHoleRims(g, Pnt, sx, bodyC, bodyR2){
  if(holeVer !== brokenCount()) buildHoleChains();
  if(!holeChains || !holeChains.length) return;
  const cell = sheetCellPx(sx);
  const nz = (a, b)=>{ const v = Math.sin(a*12.9898 + b*78.233)*43758.5453; return v - Math.floor(v) - 0.5; };
  const inBody = (i)=> (px[i]-bodyC.x)**2 + (py[i]-bodyC.y)**2 < bodyR2;
  const pc = DOUGH_PALE.join(","), pw = DOUGH.join(",");   // плёнка над тёмной дырой — тёплая, не серая
  g.save(); g.lineJoin = "round"; g.lineCap = "round";
  for(const { nodes, cyclic } of holeChains){
    const n = nodes.length, segs = cyclic ? n : n-1, P = [];
    for(let i=0;i<segs;i++){
      const ia = nodes[i], ib = nodes[(i+1)%n], A = Pnt(ia), B = Pnt(ib);
      const dx = B.x-A.x, dy = B.y-A.y, l = Math.hypot(dx, dy) || 1, nx = -dy/l, ny = dx/l;
      P.push(A);
      for(const f of [1/3, 2/3]){
        const o = nz(ia + f, ib)*cell*0.45;
        P.push({ x:A.x+dx*f+nx*o, y:A.y+dy*f+ny*o });
      }
      if(!cyclic && i === segs-1) P.push(B);
    }
    if(P.length < 3) continue;
    const path = ()=>{ g.beginPath(); g.moveTo(P[0].x, P[0].y); for(let i=1;i<P.length;i++) g.lineTo(P[i].x, P[i].y); if(cyclic) g.closePath(); };
    if(cyclic && nodes.every(inBody)){ path(); g.fillStyle = "#100a06"; g.fill(); }   // зубцы дыры наружу
    path();
    g.strokeStyle = `rgba(${pw},0.3)`; g.lineWidth = cell*0.5; g.stroke();
    g.strokeStyle = `rgba(${pc},0.5)`; g.lineWidth = Math.max(1, cell*0.14); g.stroke();
  }
  g.restore();
}
function pathSheetOutline(g, sx, ox, sy, oy, extraY){
  const c = centerOfSheet();
  const bins = 28;
  const xs = new Float32Array(bins), ys = new Float32Array(bins), cn = new Uint8Array(bins);
  for(const i of edgeNodes){
    if(conDeg && conDeg[i]<=0) continue;
    let b = Math.floor((Math.atan2(py[i]-c.y, px[i]-c.x)+Math.PI)/(2*Math.PI)*bins);
    if(b<0) b=0; else if(b>=bins) b=bins-1;
    xs[b]+=prX(dX[i],dY[i])*sx+ox;          // та же сглаженная кромка, что у ячеек (draw зовёт rimDraw раньше)
    ys[b]+=prY(dX[i],dY[i])*sy+oy+(extraY||0);
    cn[b]++;
  }
  const P=[];
  for(let b=0;b<bins;b++) if(cn[b]) P.push({x:xs[b]/cn[b], y:ys[b]/cn[b]});
  if(P.length<8) return false;
  g.beginPath();
  const last=P[P.length-1];
  g.moveTo((P[0].x+last.x)*0.5, (P[0].y+last.y)*0.5);
  for(let i=0;i<P.length;i++){
    const n=P[(i+1)%P.length];
    g.quadraticCurveTo(P[i].x, P[i].y, (P[i].x+n.x)*0.5, (P[i].y+n.y)*0.5);
  }
  g.closePath();
  return true;
}

function draw(){
  const pixelated = variant!=="C";
  const LOGW = variant==="A" ? 80 : 224;
  let g, W, H, sx, sy, ox, oy;

  if(pixelated){
    const ar = cv.height/cv.width;
    W = LOGW; H = Math.max(8, Math.round(LOGW*ar));
    if(lo.width!==W||lo.height!==H){ lo.width=W; lo.height=H; }
    g = lctx; sx = W/cv.width; sy = H/cv.height; ox=0; oy=0;
  } else {
    g = ctx; W=cv.width; H=cv.height; sx=1; sy=1; ox=0; oy=0;
  }

  g.fillStyle = "#14100c"; g.fillRect(0,0,W,H);
  if(frameOn){
    const f = frameFit();
    g.drawImage(frameImg, f.dx*sx, f.dy*sy, FRAME_W*f.k*sx, FRAME_H*f.k*sy);
  }
  // В раме drawTable рисует только игру поверх картинки — жир, маргарин, мишень растяжки.
  // (В сборке 38 это было написано, но в раме drawTable не вызывался вовсе — владелица заметила.)
  drawTable(g, sx, sy);
  if(typeof eveningDraw==="function") eveningDraw(g, sx, sy, 0);   // небо, стойка, радио, миска — под тестом

  if(dish){
    const kn = panKnock && phase==="PAN" && dish.mode==="fold";   // лист на таве вздрагивает вместе с ней
    if(kn){ g.save(); g.translate(0, panKnock*sy); }
    drawDish(g,sx,sy);
    if(kn) g.restore();
  }
  else if(!sheetHidden){   // режим «только звук», в котором поле не рисовалось вовсе, снят 08.09.2026
    // ячейки решётки; порванные и просвеченные насквозь — дырки
    // порванные ячейки: пометить их узлы, чтобы подсветить рваный край у соседей
    if(tornAt){
      if(!tornNode || tornNode.length!==N) tornNode = new Uint8Array(N);
      tornNode.fill(0);
      for(let q=0;q<quads.length;q++){
        if(quadCons[q].some(cc=>cc.broken)){
          const [a,b2,c,d] = quads[q];
          tornNode[a]=tornNode[b2]=tornNode[c]=tornNode[d]=1;
        }
      }
    }
    // тень дырки рисуем только ВНУТРИ тела листа: рваный край — это просто
    // отсутствие теста (виден стол), а не «дырка вне блина» из замёрзших ошмётков
    const bodyC = centerOfSheet(), bodyR2 = Math.pow(sheetRadius()*0.96, 2);
    // В руке и в полёте лист рисуется со сдвигом, поворотом и подъёмом, а под ним — тень:
    // так видно, что он оторвался от доски и летит, хотя узлы физики стоят.
    if(!xf) rimDraw();
    const X = xf ? viewX() : dX, Y = xf ? viewY() : dY;
    // Дрожь края у предела разрыва (сборка 81, спека п. 10): пока палец тянет у предела,
    // язык мелко трясётся вдоль тяги — только в рисунке; физика и коммит стоят ровно на пределе.
    if(!xf && phase === "TABLE" && action.state === "PULLING" && action.pull && action.pull.atLimit){
      const P = action.pull, t = performance.now(), off = (1.9 + 0.9*Math.sin(t/310)) * Math.sin(t/43);
      for(let i=0;i<N;i++) if(P.w[i] > 0.55){ dX[i] += P.ux*off; dY[i] += P.uy*off; }
    }
    if(xf){
      const gx = xf.cx + xf.ox, gy = xf.cy + xf.oy, gr = sheetRadius()*1.03;
      g.fillStyle = "rgba(6,3,1,0.42)";
      g.beginPath();
      g.ellipse(prX(gx,gy)*sx+ox, prY(gx,gy)*sy+oy, gr*sx, gr*TILT*sy, 0, 0, Math.PI*2);
      g.fill();
    }
    const onPan = phase === "PAN";
    const Hmap = (stepNo===1 && flatH) ? flatH : thick;
    const Pnt=(i)=>({
      x: prX(X[i],Y[i])*sx+ox,
      y: prY(X[i],Y[i])*sy+oy
    });
    if(sheetLooksDisc() && !onPan && !xf){
      const c0 = bodyC, r0 = Math.max(R0, sheetRadius());
      const x = prX(c0.x,c0.y)*sx+ox, y = prY(c0.x,c0.y)*sy+oy;
      const rx = r0*sx, ry = r0*TILT*sy;
      const useHull = stepNo===2 && (sameSlapN>0 || pullN>0 || action.state==="PULLING" || !!twitch);   // дёрнувшийся край рисуется по узлам, а не ровным эллипсом
      g.fillStyle = "rgba(10,6,2,0.22)";
      if(useHull && pathSheetOutline(g, sx, ox, sy, oy, r0*TILT*sy*0.07)){
        g.fill();
      } else {
        g.beginPath(); g.ellipse(x, y+ry*0.07, rx*1.06, ry*1.08, 0, 0, Math.PI*2); g.fill();
      }
      g.save();
      if(!(useHull && pathSheetOutline(g, sx, ox, sy, oy, 0))){
        g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI*2);
      }
      g.clip();
      const st = stepNo===1 ? flattenStats() : { mean: 1 };
      let base = stepNo===1 ? Math.max(0.28, st.mean) : 0.72;
      if(stepNo===2){
        let s=0,n=0; for(let i=0;i<N;i++){ if(conDeg && conDeg[i]<=0) continue; s+=Hmap[i]; n++; }
        if(n) base = Math.max(0.28, s/n);
      }
      g.fillStyle = tableSkin(base);
      g.fill();
      for(let q=0;q<quads.length;q++){
        const [a,b2,c,d] = quads[q];
        const t = (Hmap[a]+Hmap[b2]+Hmap[c]+Hmap[d])/4;
        if(t > 0.96) continue;
        if(quadCons[q].some(cc=>cc.broken)) continue;   // дыра и в «круглом» виде — дыра: сквозь неё стол
        g.fillStyle = tableSkin(t, rimEdgeQ ? rimEdgeQ[q] : 0);
        const Pa=Pnt(a), Pb=Pnt(b2), Pc=Pnt(c), Pd=Pnt(d);
        g.beginPath();
        g.moveTo(Pa.x,Pa.y); g.lineTo(Pb.x,Pb.y); g.lineTo(Pc.x,Pc.y); g.lineTo(Pd.x,Pd.y);
        g.closePath(); g.fill();
      }
      g.restore();
    } else if(!onPan && !xf){
      const c0 = bodyC, r0 = sheetRadius();
      g.fillStyle = "rgba(10,6,2,0.20)";
      g.beginPath();
      g.ellipse(prX(c0.x,c0.y)*sx+ox, prY(c0.x,c0.y)*sy+oy + r0*TILT*sy*0.05,
                r0*1.03*sx, r0*1.04*TILT*sy, 0, 0, Math.PI*2);
      g.fill();
    }
    // Сборка 94: целый лист на столе — одним размытым слоем (drawSheetSoft), без граней ячеек и без
    // «заплат» у дыр; дыры поверх него — тёмные ячейки и рваная кромка (drawHoleRims).
    const softSheet = !onPan && !pixelated && !(sheetLooksDisc() && !xf) && drawSheetSoft(g, Pnt, Hmap, sx, bodyC, bodyR2, W, H);
    if(!(sheetLooksDisc() && !onPan && !xf))
    for(let q=0;q<quads.length;q++){
      const qc = quadCons[q];
      const [a,b2,c,d] = quads[q];
      const torn = qc[0].broken || (qc[1]&&qc[1].broken) || (qc[2]&&qc[2].broken) || (qc[3]&&qc[3].broken);
      let t= (Hmap[a]+Hmap[b2]+Hmap[c]+Hmap[d])/4;
      if(torn){
        const inside =
          (px[a]-bodyC.x)**2+(py[a]-bodyC.y)**2 < bodyR2 &&
          (px[b2]-bodyC.x)**2+(py[b2]-bodyC.y)**2 < bodyR2 &&
          (px[c]-bodyC.x)**2+(py[c]-bodyC.y)**2 < bodyR2 &&
          (px[d]-bodyC.x)**2+(py[d]-bodyC.y)**2 < bodyR2;
        if(!inside) continue;                          // выеденный край: теста просто нет
        // Сквозная дыра — тень ПОД листом, темнее и стола, и любого тонкого теста.
        g.fillStyle = onPan ? "#1c1712" : "#100a06";
      } else {
        if(softSheet) continue;                        // целые ячейки уже в мягком слое
        // Тонкий, но целый лист остаётся видимым. Дыру задают разорванные связи:
        // отдельный визуальный порог создавал исчезающие дырки без разрыва (#94).
        // Рваный край собирается толще — у настоящего теста кромка разрыва скатывается.
        if(tornAt && (tornNode[a]||tornNode[b2]||tornNode[c]||tornNode[d])) t = Math.min(1, t + 0.28);
        if(onPan){
          const ck = (cook[a]+cook[b2]+cook[c]+cook[d])/4;
          g.fillStyle = pixelated ? quantOn(t, ck) : shadeOn(t, ck);
        } else {
          // Сборка 81: на столе тесто светлое, тонкость — прозрачностью (стол проступает),
          // кромка плотнее и светлее; ячейки кромки знает buildRimLoop (rimEdgeQ).
          g.fillStyle = tableSkin(t, rimEdgeQ ? rimEdgeQ[q] : 0);
        }
      }
      const Pa=Pnt(a), Pb=Pnt(b2), Pc=Pnt(c), Pd=Pnt(d);
      g.beginPath();
      g.moveTo(Pa.x, Pa.y);
      g.lineTo(Pb.x, Pb.y);
      g.lineTo(Pc.x, Pc.y);
      g.lineTo(Pd.x, Pd.y);
      g.closePath(); g.fill();
    }
    if(softSheet) drawHoleRims(g, Pnt, sx, bodyC, bodyR2);
    if(!onPan && !xf && stepNo >= 2) drawRimRoll(g, Pnt, sx);   // сборка 88: валик кромки на всех шагах растяжки
    drawCornerFlash(g, sx, sy);
    // дуга хвата и палец видны только пока жест взводится: ARMED подсвечивает
    // выбранный край (audit, проход A), тесто при этом не двигается.
    if(action.state==="ARMED" || action.state==="LIFTING"){
      if(stepNo===1){
        const rr = pixelated ? 6 : 16;
        g.fillStyle="rgba(28,16,8,0.30)";
        g.beginPath();
        g.ellipse(prX(action.last.x,action.last.y)*sx, prY(action.last.x,action.last.y)*sy,
                  rr, rr*TILT, 0, 0, Math.PI*2);
        g.fill();
      } else {
        g.fillStyle="#d98b3a";
        const S2 = pixelated ? 2 : 6;
        for(const n of action.gripIds)
          g.fillRect(prX(X[n],Y[n])*sx-S2/2, prY(X[n],Y[n])*sy-S2/2, S2, S2);
        const rr = pixelated ? 4 : 14;
        g.beginPath();
        g.ellipse(prX(action.last.x,action.last.y)*sx, prY(action.last.x,action.last.y)*sy,
                  rr, rr*TILT, 0, 0, Math.PI*2);
        g.fill();
      }
    }
  }

  if(panKnock){ g.save(); g.translate(0, panKnock*sy); }
  drawCrispSheen(g, sx, sy);
  drawFatFizz(g, sx, sy);
  drawButterBlock(g, sx, sy);
  if(panKnock) g.restore();
  if(typeof eveningDraw==="function") eveningDraw(g, sx, sy, 1);   // крышка, сумерки без лампы, лампа — поверх
  if(pixelated){
    ctx.imageSmoothingEnabled=false;
    ctx.fillStyle="#14100c"; ctx.fillRect(0,0,cv.width,cv.height);
    ctx.drawImage(lo,0,0,W,H,0,0,cv.width,cv.height);
  }
}
// Стол: рабочая зона · мостик начинок · тава.
// Тава по F1 — กระทะโรตี, толстая сталь 18–20″ с ВОГНУТЫМ дном, удерживающим масло,
// а не плоская «тава»: лужица жира собирается в центре, отсюда техника подгона масла к краям.
function drawTable(g, sx, sy){   // пикселизация делается низкоразрешающей канвой, отдельный флаг сюда не нужен
  const w = zone("work");
  const R_ = (x)=>x*sx, D_ = (y)=>y*sy;
  // В раме стол и тава уже нарисованы на картинке экрана — свои не рисуем. Но жир, кусочек
  // маргарина и мишень растяжки остаются: это не декорация, а игра (владелица 17.09 о раме).
  if(frameOn){ drawFatAndButter(g, sx, sy); drawPanGlow(g, sx, sy); return drawStretchTarget(g, sx, sy); }

  // Столешница — весь кадр: и рабочая зона, и зона тавы стоят на одном столе.
  // Раньше здесь стояла высота РАБОЧЕЙ зоны; пока зоны делились по ширине, это было
  // одно и то же, а в портрете доски кончились бы на середине.
  g.fillStyle = "#2b2016";
  g.fillRect(0, 0, R_(cv.width), D_(cv.height));
  const boards = 7, bh = cv.height/boards;
  for(let i=0;i<boards;i++){
    g.fillStyle = i%2 ? "#31251a" : "#2b2016";
    g.fillRect(0, D_(i*bh), R_(cv.width), D_(bh-1));
    g.fillStyle = "#1d150e";
    g.fillRect(0, D_((i+1)*bh-1), R_(cv.width), Math.max(1, D_(1)));
  }

  // Тава (กระทะโรตี): толстая плоская круглая плита, в центре лужица маргарина. Рисуется в координатах стола той же проекцией, что мишень.
  if(panKnock){ g.save(); g.translate(0, D_(panKnock)); }   // стук гостя: вздрагивает тава, стол стоит
  const pcx = R_(prX(panC.x, panC.y)), pcy = D_(prY(panC.x, panC.y));
  const ell = (r, fill, dy)=>{
    g.fillStyle = fill; g.beginPath();
    g.ellipse(pcx, pcy + D_(dy||0), R_(r), D_(r*TILT), 0, 0, Math.PI*2); g.fill();
  };
  ell(PAN_R*1.16, "#0e0a07", PAN_R*0.06);   // тень и горелка под тавой
  ell(PAN_R*1.08, "#2a2622");               // борт
  ell(PAN_R*1.00, "#3a342d");               // кромка плиты
  ell(PAN_R*0.96, "#4b4338");               // плоская плита: один тон, без колец «в глубину» (тава плоская, решение 17.11)
  ell(PAN_R*0.30, "#6b5a2a");               // лужица маргарина в центре
  ell(PAN_R*0.16, "#8a7436", -PAN_R*0.02);  // блик на масле
  drawFatAndButter(g, sx, sy);
  if(panKnock) g.restore();
  drawPanGlow(g, sx, sy);
  drawStretchTarget(g, sx, sy);
}
// Борт тавы светится, пока лист в руке над ней: «отпусти — ляжет сюда» (и гаснет за время укладки).
function drawPanGlow(g, sx, sy){
  const lay = action.state === "LAY";
  if(!lay && !(action.state === "CARRY" && carryOverPan())) return;
  const now = performance.now(), a = lay ? 0.85*Math.max(0, 1 - (xf ? xf.layU || 0 : 1)) : 0.62 + 0.23*Math.sin(now/110);
  const x = prX(panC.x, panC.y)*sx, y = prY(panC.x, panC.y)*sy;
  for(const [k, w, al] of [[1.05, 0.10, 0.28], [1.04, 0.04, 1]]){
    g.strokeStyle = `rgba(255,198,96,${(a*al).toFixed(3)})`; g.lineWidth = Math.max(1, PAN_R*w*sx);
    g.beginPath(); g.ellipse(x, y, PAN_R*k*sx, PAN_R*k*TILT*sy, 0, 0, Math.PI*2); g.stroke();
  }
}
// Мишень: докуда растянуть лист — только пока лист на столе. Шаг 1 — круг расплющивания;
// с шага 2 — пунктирный квадрат со скруглёнными углами (targetAt), по осям стола.
function drawStretchTarget(g, sx, sy){
  const R_ = (x)=>x*sx, D_ = (y)=>y*sy;
  if(phase !== "TABLE" || sheetHidden) return;
  const c2 = stepNo===1 ? centerOfSheet() : targetC();   // с шага 2 мишень стоит на столе (targetC)
  g.strokeStyle = "#4a3a24"; g.lineWidth = Math.max(1, R_(2));
  g.setLineDash([R_(10), R_(8)]);
  if(stepNo===1){
    g.beginPath();
    g.ellipse(R_(prX(c2.x,c2.y)), D_(prY(c2.x,c2.y)), R_(step1R), D_(step1R*TILT), 0, 0, Math.PI*2);
    g.stroke(); g.setLineDash([]);
    return;
  }
  const at = (th, k)=>{ const r = targetAt(th)*(k||1), x = c2.x + Math.cos(th)*r, y = c2.y + Math.sin(th)*r; return { x:R_(prX(x,y)), y:D_(prY(x,y)) }; };
  const arc = (a0, a1, n, k)=>{ g.beginPath(); for(let i=0;i<=n;i++){ const p = at(a0 + (a1-a0)*i/n, k); if(i) g.lineTo(p.x,p.y); else g.moveTo(p.x,p.y); } g.stroke(); };
  arc(0, Math.PI*2, 96);
  g.setLineDash([]);
  // Сборка 94 (ревью 18.11, кадр c): у готового листа эти дуги читались оранжевой рамкой выделения.
  // Они нужны, пока углы дотягиваются (шаг 2); на шаге 3 жест уже другой — нести на таву.
  if(stepNo >= 3) return;
  for(let k=0;k<4;k++){
    if(!cornerDone[k]) continue;
    const th = cornerAngle(k);
    // дотянутый угол остаётся отмеченным: сплошная тёплая дуга поверх пунктира
    g.strokeStyle = "#b98a45"; g.lineWidth = Math.max(1, R_(2.5));
    arc(th-0.26, th+0.26, 10);
  }
}
// Вспышка дотянутого угла и мигание борта тавы — поверх листа: угол к этому моменту уже под тестом.
function drawCornerFlash(g, sx, sy){
  if(phase !== "TABLE" || stepNo < 2 || xf) return;
  const R_ = (x)=>x*sx, D_ = (y)=>y*sy, now = performance.now();
  const c2 = targetC();
  for(let k=0;k<4;k++){
    if(!cornerDone[k]) continue;
    const age = (now - cornerFlash[k])/450;
    if(!(age >= 0 && age < 1)) continue;
    const th = cornerAngle(k), kk = 1 + 0.10*age;      // дуга расходится и гаснет
    g.strokeStyle = `rgba(255,214,128,${(0.9*(1-age)).toFixed(3)})`; g.lineWidth = Math.max(1, R_(5*(1-age)+1.5));
    g.beginPath();
    for(let i=0;i<=12;i++){
      const a = th-0.34 + 0.68*i/12, r = targetAt(a)*kk, x = c2.x + Math.cos(a)*r, y = c2.y + Math.sin(a)*r;
      if(i) g.lineTo(R_(prX(x,y)), D_(prY(x,y))); else g.moveTo(R_(prX(x,y)), D_(prY(x,y)));
    }
    g.stroke();
  }
  if(readyBlinkAt){                                      // четвёртый угол: борт тавы дважды мигает
    const u = (now - readyBlinkAt)/900;
    if(u >= 0 && u < 1){
      const a = Math.abs(Math.sin(u*Math.PI*2)) * (1-u);
      g.strokeStyle = `rgba(255,214,128,${(0.9*a).toFixed(3)})`; g.lineWidth = Math.max(1, R_(4));
      g.beginPath();
      g.ellipse(R_(prX(panC.x,panC.y)), D_(prY(panC.x,panC.y)), R_(PAN_R*1.04), D_(PAN_R*1.04*TILT), 0, 0, Math.PI*2);
      g.stroke();
    }
  }
}

// Жир на стали — глянцевые светлые пятна; кусок маргарина у борта — жёлтый брусок с тенью.
function drawFatAndButter(g, sx, sy){
  const P=(x,y)=>({x:prX(x,y)*sx,y:prY(x,y)*sy});
  if(fatMap){
    // Мокрый глянец, не жёлтая краска. Тает каждый кадр — иначе след «застывал» на 250 мс.
    if(!fatCanvas){ fatCanvas=document.createElement("canvas"); fatCanvas.width=FAT_N; fatCanvas.height=FAT_N; fatCtx=fatCanvas.getContext("2d"); }
    if(fatDirty){
      fatCtx.clearRect(0,0,FAT_N,FAT_N);
      for(let j=0;j<FAT_N;j++) for(let i=0;i<FAT_N;i++){
        const f=fatMap[j*FAT_N+i]; if(f<.01) continue;
        // лужица: тёплый блеск без ступенек — прозрачность растёт от нуля (края клеток растворяет сглаживание
        // при растяжении), в густом месте светлее. Было: порог 0,05 и пол 0,10 — сетка 32×32 читалась лесенкой.
        fatCtx.fillStyle=`rgba(255,226,150,${Math.min(.5,.7*f).toFixed(3)})`; fatCtx.fillRect(i,j,1,1);
      }
      fatDirty=false;
    }
    const c=P(panC.x,panC.y), rx=PAN_R*sx, ry=PAN_R*TILT*sy;
    g.save(); g.imageSmoothingEnabled=true; g.imageSmoothingQuality="high"; g.globalCompositeOperation="lighter";
    g.drawImage(fatCanvas,c.x-rx,c.y-ry,rx*2,ry*2); g.restore();
  }
  drawFatStreak(g,sx,sy);
}
// Развод маргарина по следу пальца: мокрая полоса (сталь под жиром темнее и теплее), по ней узкий блик. Ширина — кисть мазка (FAT_BRUSH), расходится с возрастом; тускнеет как лужица.
function drawFatStreak(g,sx,sy){
  if(!fatStreak.length) return;
  const now=performance.now(), runs=[]; let cur=[];
  for(const q of fatStreak){
    if(q.gap){ if(cur.length) runs.push(cur); cur=[]; continue; }
    if((now-q.t)/1000>FAT_TAU*2.2) continue;
    cur.push(q);
  }
  if(cur.length) runs.push(cur);
  if(!runs.length) return;
  const W=FAT_BRUSH*PAN_R*1.5*sx;
  g.save(); g.lineCap="round"; g.lineJoin="round";
  for(const run of runs){
    const age=(now-run[run.length-1].t)/1000, a=Math.exp(-age/FAT_TAU), w=W*(1+.35*Math.min(1,age/FAT_TAU));
    const pts=run.map(q=>({x:prX(q.x,q.y)*sx,y:prY(q.x,q.y)*sy}));
    const path=dy=>{ g.beginPath(); pts.forEach((p,i)=>i ? g.lineTo(p.x,p.y+dy) : g.moveTo(p.x,p.y+dy)); if(pts.length===1) g.lineTo(pts[0].x+.01,pts[0].y+dy); };
    path(0); g.strokeStyle=`rgba(255,226,140,${(.28*a).toFixed(3)})`; g.lineWidth=w; g.stroke();          // жир: тёплая плёнка
    path(0); g.strokeStyle=`rgba(30,20,6,${(.16*a).toFixed(3)})`; g.lineWidth=w*.7; g.stroke();           // мокрая сталь темнее
    path(-w*.12); g.strokeStyle=`rgba(255,246,214,${(.42*a).toFixed(3)})`; g.lineWidth=Math.max(1,w*.1); g.stroke();   // блик
  }
  g.restore();
}
// Кусок маргарина рисуется ПОВЕРХ листа (то, что видно, то и берётся) и убывает с каждым мазком.
function drawButterBlock(g, sx, sy){
  const P=(x,y)=>({x:prX(x,y)*sx,y:prY(x,y)*sy});
  const b=butterSpot(), tx=-Math.sin(b.a), ty=Math.cos(b.a), nx=Math.cos(b.a), ny=Math.sin(b.a);
  const left=Math.sqrt(butterLeft), L=PAN_R*.09*left, W=PAN_R*.06*left, H=PAN_R*.035*TILT*butterLeft;
  const corner=(u,v)=>P(b.x+tx*u+nx*v, b.y+ty*u+ny*v);
  const base=[corner(-L,-W),corner(L,-W),corner(L,W),corner(-L,W)];
  // fill() замыкает контур сам; без closePath брусок не считается «гранью» в счётчике отрисовки.
  const poly=(pts,dy)=>{ g.beginPath(); g.moveTo(pts[0].x,pts[0].y-dy); for(let k=1;k<pts.length;k++) g.lineTo(pts[k].x,pts[k].y-dy); g.fill(); };
  g.fillStyle="rgba(10,6,2,.35)"; poly(base.map(q=>({x:q.x+2*sx,y:q.y+2*sy})),0);
  g.fillStyle="#c9a64a"; poly(base,0);
  g.fillStyle="#e8cc72"; poly(base,H*sy);
  g.fillStyle="rgba(255,244,190,.5)"; poly([corner(-L*.7,-W*.6),corner(L*.2,-W*.6),corner(L*.2,-W*.1),corner(-L*.7,-W*.1)],H*sy);
  // выемки от пальцев (сборка 95): впадина темнее грани, у дальнего края — светлый ободок, как вмятина в мягком
  for(const d of butterDents){
    const c=corner(d.u*L,d.v*W), e=corner(d.u*L+W*.42,d.v*W), f=corner(d.u*L,d.v*W+W*.42);
    const rx=Math.max(1,Math.hypot(e.x-c.x,e.y-c.y)), ry=Math.max(1,Math.hypot(f.x-c.x,f.y-c.y)*.8), y=c.y-H*sy;
    g.fillStyle="rgba(255,246,200,.75)"; g.beginPath(); g.ellipse(c.x,y+ry*.25,rx,ry,b.a,0,Math.PI*2); g.fill();
    g.fillStyle="#b8933a"; g.beginPath(); g.ellipse(c.x,y,rx*.92,ry*.88,b.a,0,Math.PI*2); g.fill();
    g.fillStyle="#d4b25a"; g.beginPath(); g.ellipse(c.x,y+ry*.22,rx*.7,ry*.55,b.a,0,Math.PI*2); g.fill();
  }
}
// Жир под краем роти шипит: мелкие светлые пузырьки вдоль кромки там, где под ней лужица. Чем больше
// жира в этом месте, тем их больше; каждый живёт 2–3 кадра. Это и есть «маргарин работает» — глазами.
// Накопленный хруст виден на роти: кромка блестит жиром — тонкая светлая линия по краю, тем ярче и шире,
// чем больше хруста; у порога FRY_CRISP она в полную силу. Не украшение: это то самое число, по которому
// судит гостья (ревью 17.11: «dishCrisp игрок не видит никак; мимо порога — молча»).
function crispSheen(){ return Math.max(0,Math.min(1,dishCrisp/FRY_CRISP)); }
function drawCrispSheen(g, sx, sy){
  if(!dish || dish.mode!=="fold" || phase!=="PAN" || dishFlight || dishMove || !dish.hull || dish.hull.length<3) return;
  const k=crispSheen(); if(k<.08) return;
  if(dishGesture && dishGesture.slide) return;   // в руке роти нарисован приподнятым — линия легла бы мимо края
  const H=dish.hull, pose=dishPose(), sl={x:0,y:0};
  const dpr=typeof devicePixelRatio==="number" ? devicePixelRatio : 1;
  g.save(); g.lineJoin="round"; g.strokeStyle=`rgba(255,238,176,${(.22+.6*k).toFixed(3)})`; g.lineWidth=Math.max(1,(1+2*k)*sx*dpr);
  g.beginPath();
  for(let i=0;i<H.length;i++){
    const qx=pose.x+(H[i].x+sl.x)*pose.scale, qy=pose.y+(H[i].y+sl.y)*pose.scale, X=prX(qx,qy)*sx, Y=prY(qx,qy)*sy;
    if(i) g.lineTo(X,Y); else g.moveTo(X,Y);
  }
  g.closePath(); g.stroke(); g.restore();
}
function drawFatFizz(g, sx, sy){
  if(!fatMap || !dish || dish.mode!=="fold" || phase!=="PAN" || dishFlight || dishMove || fryHold || !dish.hull) return;
  if(dishGesture && dishGesture.slide) return;
  const H=dish.hull, pose=dishPose(), tick=Math.floor(performance.now()/45), px1=Math.max(1,1.6*sx*(typeof devicePixelRatio==="number" ? devicePixelRatio : 1));
  const c=hullCentre(H);
  let seed=tick*7919+13;
  const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  for(let i=0;i<H.length;i++){
    const a=H[i], b=H[(i+1)%H.length], len=Math.hypot(b.x-a.x,b.y-a.y), n=Math.max(1,Math.round(len/FIZZ_STEP));
    for(let k=0;k<n;k++){
      const u=(k+rnd())/n, x=a.x+(b.x-a.x)*u, y=a.y+(b.y-a.y)*u;
      const f=fatAtEdge(x,y,c);
      if(f<FIZZ_MIN || rnd()>Math.min(.9,.35+f*2.2)) continue;
      const out=.012+.05*rnd(), dl=Math.hypot(x-c.x,y-c.y)||1;   // чуть снаружи кромки
      const qx=pose.x+(x+(x-c.x)/dl*out)*pose.scale, qy=pose.y+(y+(y-c.y)/dl*out)*pose.scale;
      // Сборка 95 (ревью 18.11, п. 4): пузырёк — светлое колечко 1,5–3 CSS px с тёмной серединкой, а не точка в
      // 1 px: на телефоне шипение у кромки было не видно. Число и порог — прежние.
      const big=rnd()<.3, r=px1*(big ? 1.5 : .95), X=prX(qx,qy)*sx, Y=prY(qx,qy)*sy;
      g.fillStyle="rgba(255,248,222,.92)"; g.beginPath(); g.arc(X,Y,r,0,Math.PI*2); g.fill();
      if(big){ g.fillStyle="rgba(120,84,30,.55)"; g.beginPath(); g.arc(X,Y,r*.45,0,Math.PI*2); g.fill(); }
    }
  }
  drawFatEdgeBrown(g,sx,sy,H,pose,c);
}
// Сборка 95 (ревью 18.11, п. 4): «на смазанном месте румянится быстрее» — видно сверху. Там, где у кромки жир
// (тот же порог FIZZ_MIN, что у пузырьков и хруста), из-под края выглядывает узкая кайма нижней стороны цветом
// её настоящей прожарки (cook стороны на стали ближайшей нижней грани), когда низ там не ниже «бледного»; жир сошёл —
// кайма остаётся там, где край прожарен больше среднего по кромке (FAT_EDGE_AHEAD). На сухом бледном краю каймы нет.
// Точки кромки и их грани считаются раз на геометрию (fatEdgeSamples), цвет — каждый кадр из dish.thermal.
const FAT_EDGE_AHEAD = 0.02;            // насколько низ у края прожарен больше среднего по кромке, чтобы кайма осталась без жира
let fatEdgeCache = null;
function fatEdgeSamples(H,c){
  if(fatEdgeCache && fatEdgeCache.hull===H && fatEdgeCache.faces===dish.faces) return fatEdgeCache.pts;
  const dough=dish.faces.filter(f=>f.kind==="dough"), pts=[];
  for(let i=0;i<H.length;i++){
    const a=H[i], b=H[(i+1)%H.length], len=Math.hypot(b.x-a.x,b.y-a.y), n=Math.max(1,Math.round(len/FIZZ_STEP));
    for(let k=0;k<n;k++){
      const u0=k/n, u1=(k+1)/n, p={x:a.x+(b.x-a.x)*(u0+u1)/2,y:a.y+(b.y-a.y)*(u0+u1)/2};
      const qx=p.x+(c.x-p.x)*.04, qy=p.y+(c.y-p.y)*.04;
      const f=dough.find(f=>pointInFace(f.points,qx,qy)); if(!f) continue;
      pts.push({p,a:{x:a.x+(b.x-a.x)*u0,y:a.y+(b.y-a.y)*u0},b:{x:a.x+(b.x-a.x)*u1,y:a.y+(b.y-a.y)*u1},src:f.source,side:f.turned ? 1 : 0});
    }
  }
  fatEdgeCache={hull:H,faces:dish.faces,pts}; return pts;
}
function drawFatEdgeBrown(g,sx,sy,H,pose,c){
  if(!dish.thermal) return 0;
  const css=sx*(typeof devicePixelRatio==="number" ? devicePixelRatio : 1), S=q=>{ const X=pose.x+q.x*pose.scale, Y=pose.y+q.y*pose.scale; return {x:prX(X,Y)*sx,y:prY(X,Y)*sy}; };
  const pts=fatEdgeSamples(H,c).map(q=>{ const t=dish.thermal[q.src]; return t ? {q,c:t.cook[q.side]} : null; }).filter(Boolean);
  if(!pts.length) return 0;
  const mean=pts.reduce((s,p)=>s+p.c,0)/pts.length; let drawn=0;
  g.save(); g.lineCap="round"; g.lineWidth=Math.max(1.5,2.2*css);
  for(const {q,c:cook} of pts){
    // видно, где низ у края уже румянится (не ниже «бледного») и либо там сейчас жир, либо он прожарен
    // заметно больше среднего по кромке — то есть румянился быстрее (жир сошёл, а след остался)
    if(cook<FRY_STEPS[0] || !(fatAtEdge(q.p.x,q.p.y,c)>=FIZZ_MIN || cook>mean+FAT_EDGE_AHEAD)) continue;
    const col=cookColor([221,199,152],crustGround(cook)), A=S(q.a), B=S(q.b), d=Math.max(1,1.2*css);
    g.strokeStyle=`rgba(${col.map(Math.round).join(",")},${Math.min(1,.35+(cook-FRY_STEPS[0])/.15).toFixed(3)})`;
    g.beginPath(); g.moveTo(A.x,A.y+d); g.lineTo(B.x,B.y+d); g.stroke(); drawn++;
  }
  g.restore();
  return drawn;                                  // сколько отрезков каймы нарисовано (для проверок)
}

function shade(t){ const c = mix(t); return `rgb(${c[0]},${c[1]},${c[2]})`; }

// ─────────────────────────── цикл
// `fps=null` и `worst=0` означают «ещё не мерили», и печатаются прочерком: ноль в приборе
// читается как «идеально», а «60 fps» до первого измерения — просто неправда (#89).
let last=performance.now(), fps=null, acc=0, frameCount=0, worst=0, warmup=0;   // не `frames`: совпадает с window.frames
function resetMeters(){
  worst=0; fps=null; acc=0; frameCount=0; warmup=6; tossOk=0; tossTry=0;
  // `latencies` тоже: без этого «звук N мс» — бегущая медиана за всю сессию и по всем
  // видам сразу, и как число вида A или B её читать нельзя (найдено проверкой 08.09).
  latencies.length = 0;
}
let loopErrs = 0, paused = 0;
function loop(now){
  // Настоящее время кадра — для измерений; обрезанное — только для устойчивости симуляции.
  // Раньше счётчик копил обрезанное dt и потому не умел показывать меньше 30 fps:
  // при кадрах по 50 мс он рисовал 30 вместо 20, то есть был слеп ровно к тем
  // просадкам, ради которых его и читают на телефоне. Найдено 07.09.2026.
  const real = (now-last)/1000;
  const dt = Math.min(0.033, real); last=now;
  // Первые кадры после пересборки и после возврата из фона — это сборка листа и пауза
  // вкладки, а не рисование. И то и другое попадало в «худший» и оставалось там навсегда:
  // до 08.09.2026 `worst` не обнуляло ничто, даже смена варианта. Значит A, B и C
  // возвращали одно и то же число — худший кадр первой пересборки.
  if(pendingResize) flushResize();
  if(warmup > 0) warmup--;
  else if(real < 1 && real > worst) worst = real;
  else if(real >= 1) paused++;   // пауза вкладки не «просадка»: считаем отдельно, но не прячем
  try{
    step(dt);
    audioFrame();
    if (typeof bananaUpdate === "function") bananaUpdate(dt);
    if (typeof eggUpdate === "function") eggUpdate(dt);
    if (typeof drizzleUpdate === "function") drizzleUpdate(dt);
    if (typeof eveningUpdate === "function") eveningUpdate(dt);
    draw();
    if (typeof drizzleDraw === "function") drizzleDraw(ctx);
  }catch(err){
    // Раньше единственное исключение в кадре останавливало игру насмерть:
    // requestAnimationFrame больше не вызывался, и экран замирал.
    loopErrs++;
    if(loopErrs < 4) console.error("кадр упал:", err);
  }

  acc+=real; frameCount++;
  if(acc>0.5){ fps=frameCount/acc; acc=0; frameCount=0; }
  const liveEl = document.getElementById("live");
  // заполнение мишени нужно только листу на столе с шага 2 (на таве и на шаге 1 его не показывают)
  const fillNow = phase==="TABLE" && stepNo>=2 && !dish ? sheetFill() : 0, pct = Math.round(fillNow*100);
  // Строка листа на столе (сборка 80): одно короткое сообщение, без процентов (пунктир их уже показывает),
  // без «лепестка», «рваного узора» и стрелок; подсказка жеста гаснет, как только жест удался (tip/learn).
  // Шаг 3 защёлкивается, когда лист встал, — «готово» раньше этого не пишется (ревью сборки 75).
  const verdictAge = verdictAt ? performance.now() - verdictAt : Infinity;
  const ragged = tornAt ? " · рваный узор" : "", ready = stepNo===3 && phase==="TABLE" && !dish ? " ✓ готов" : "";   // только для строки прибора (#stats)
  const mc = meanCook(), md = meanDry();
  const st = action.state;
  liveEl.textContent = dish ? dishLine() : verdictAge < 3500 ? verdict :
    phase==="PAN" ? ""
    : st==="CARRY" ? (carryOverPan() ? "над тавой — отпускай" : tip("carry","неси к таве"))
    : st==="TOSS" || st==="LAY" ? ""
    : st==="BACK" ? "лёг обратно на стол"
    : stepNo===1 ? flattenLiveWord()
    : stepNo===3 ? tip("carry","готово — за середину и на таву")
    : (st==="ARMED" && action.carryArm) ? ""
    : st==="ARMED" ? ((stepNo===2 && sameSlapN>=2) ? "теперь другой край — по кругу" : tip("slap","палец на край — и мах наружу"))   // та же строка, что до касания: не мигает на каждый тап (ревью сборки 80)
    : st==="PULLING" ? (action.pull && action.pull.cap<=0 ? "тут дотянуто — тяни другой край"
                                                          : tip("pull","тянешь — отпусти, останется"))
    : st!=="RESTING" ? ""
    : (stepNo===2 && sameSlapN>=2) ? "теперь другой край — по кругу"
    : tip("slap","палец на край — и мах наружу");
  // Рамка вечера говорит своё, когда стенду сказать нечего (стол пуст, лампа не горит, тава под крышкой).
  if(typeof eveningLive==="function"){ const s = eveningLive(liveEl.textContent); if(s !== null) liveEl.textContent = s; }
  // Ответ на предсказание отличается цветом, иначе он теряется среди обычных подсказок.
  liveEl.style.color = verdictAge < 3500 ? (verdict.startsWith("угадала") ? "#8fbf6a" : "#f0c674")
                     : action.state!=="RESTING" ? "#8fbf6a" : "#d98b3a";
  // В ландшафте полная строка статистики уезжала за правый край (35–212 px) и не
  // прокручивалась: fps и задержку — те самые числа — на телефоне было не прочитать.
  // По одному числу на строку и с именем варианта рядом: колонка даёт 114 px, а прежняя
  // строка «60 fps · худший 183 мс» требовала ~132 и обрезалась за краем экрана — «1180 мс»
  // читалось как «118». Три числа за поездку не должны остаться тремя безымянными числами.
  const condShort = condition==="both" ? "оба" : "без звука";
  miniEl.textContent =
    `вид ${variant} · ${condShort}\n` +
    `худший ${worst ? (worst*1000).toFixed(0)+" мс" : "—"}\n` +
    `fps ${fps===null ? "—" : fps.toFixed(0)}\n` +
    (condition==="sight" ? "звук выключен"
       : `звук ${latencies.length ? median(latencies).toFixed(0)+" мс" : "—"}`) +
    (paused ? `\nпауз ${paused}` : "") +
    // Подмена физики обязана быть видна В КОЛОНКЕ: лист «прибор» во время замера закрыт,
    // а задетый бедром ползунок отравляет все последующие числа молча.
    (tuneChanged() ? `\n⚙ ощущение своё` : "") +
    (mixedTune ? `\nсмешанный лист · для замера «заново»` : "") +
    // Что стенд решил про последний мах — «запятая 52° → тава» или «дуга 22° → шлепок».
    // Жила эта строка только в полной статистике, то есть за закрытой дверью «прибора»,
    // а именно она объясняет, почему лист не полетел. В колонке она нужнее всего.
    (lastDecision ? `\n${lastDecision}${tossTry ? ` · ${tossOk}/${tossTry}` : ""}` : "");
  const measured = log.filter(currentMeasurement);
  const done = measured.length;
  const hit  = measured.filter(l=>l.predicted).length;
  stats.textContent =
    `сборка: ${BUILD}\n` +
    `${variant}/${condition}  попыток ${done}/30  распознано ${done?Math.round(hit/done*100):0}%\n` +
    `${stackedLayout()?"портрет · замер с альбомным не сравнить":"альбом"}\n` +
    `шаг ${stepNo}  ${action.state!=="RESTING"?"◆ "+action.state:"○ покой"}  ` +
    `${dish ? dishStatus() : phase==="PAN" ? "тава · сушка "+md.toFixed(2)+" · цвет "+mc.toFixed(2) : "стол"}  мах: ${lastDecision}` +
    `${tossTry ? "  перенесено "+tossOk+" из "+tossTry : ""}  ` +
    `лист ${pct}%${ready}${ragged}  жестов ${gestures.length}  ` +
    `[касаний ${rawTouch} · указателей ${rawPointer} · до теста ↓${dbgDown} ↔${dbgMove} · ${dbgKind}${loopErrs?" · сбоев "+loopErrs:""}${dish?` · пальцев на поле ${dishTouches.size} · поворот: ${dishTwist ? dishTwist.input+" "+Math.round(dishTwist.angle*180/Math.PI)+"°" : twistDbg.last}${twistDbg.gestures?" · жестов Safari "+twistDbg.gestures:""}${twistDbg.cancels?" · отмен касаний "+twistDbg.cancels:""}`:""}]  ` +
    `${tornAt?"рваный":pressed?"нажато":"—"}  ` +
    `${tuneChanged()?`⚙ ощущение своё (${TUNE.com}/${TUNE.creep}/${TUNE.brk}, исходное ${TUNE_DEFAULT.com}/${TUNE_DEFAULT.creep}/${TUNE_DEFAULT.brk})  `:""}` +
    `${mixedTune?"смешанный лист · для замера «заново»  ":""}` +
    `${fps===null?"—":fps.toFixed(0)} fps  худший кадр ${worst?(worst*1000).toFixed(0)+" мс":"—"}  ` +
    `задержка ${latencies.length?median(latencies).toFixed(0)+" мс":"—"}${paused?"  пауз "+paused:""}`;
  requestAnimationFrame(loop);
}

// Пересборка листа стоит игроку всей работы, поэтому она только при РЕАЛЬНОЙ смене
// размера: событие resize прилетает и от панели Safari, и от поворота, и от наблюдателя.
// Пересборка холста стирает жест: build() кончается clearAction() и ставит phase="TABLE".
// Значит любой ресайз посреди запятой убивает её — а ресайз прилетает не только от поворота
// телефона: тулбар Safari, клавиатура, подросшая строка телеметрии. Откладываем.
let pendingResize = false;
// Отсрочка держится на ДЕЙСТВИИ РУКИ, а не на том, где лежит лист. Была клауза
// `|| phase === "PAN"` — она истинна всю жарку, и отложенный ресайз не применялся
// НИКОГДА после удачного броска: холст оставался в старом размере до «заново»
// (найдено проверкой 08.09, обе формы окна). Полёт при этом всё равно защищён —
// в нём `action.state === "TOSS"`.
function gestureLive(){ return action.state !== "RESTING" || !!dishGesture || !!dishFlight || !!dishMove || !!fatGesture || !!dishTwist; }
function resize(force){
  const r = stage.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio||1);
  const w = Math.max(64, Math.round(r.width*dpr)), h = Math.max(64, Math.round(r.height*dpr));
  if(!force && w===cv.width && h===cv.height) return;
  if(!force && gestureLive()){ pendingResize = true; return; }   // доиграем жест, потом пересоберём
  pendingResize = false;
  const oldPan={...panC},oldR=targetR,oldZ=zone("work");
  cv.width = w; cv.height = h;
  if(dish && !force){
    const z=zone("work"); targetR=sheetSpan(z)*TARGET_FRAC; layoutPan();
    const scale=targetR/oldR;
    for(let i=0;i<N;i++){px[i]=panC.x+(px[i]-oldPan.x)*scale;py[i]=panC.y+(py[i]-oldPan.y)*scale;prx[i]=px[i];pry[i]=py[i];}
    scaleSheetLengths(scale);
    rebuildDishContact();
    return; // dish и история в локальных координатах: ни одной пересборки материала
  }
  if(!force && N > 0 && cons){ rescaleSheet(oldZ, oldPan, oldR); return; }
  build();
}
// Лист на столе при ресайзе не пересобирается (19.10.2026). Раньше поворот телефона или панель
// Safari в альбоме на шагах 1–3 звали build(): расплющенное пятно, растянутый лист и готовый
// к таве шаг 3 заменялись свежей заготовкой (замер 390×844 → 844×390: лист 0,82 мишени стал 0,41,
// карта нажима шага 1 — снова 1). Теперь меняется только масштаб: координаты стола выводятся из
// холста, поэтому узлы переносятся от центра старой рабочей зоны к центру новой с множителем
// s = новая мишень / старая; длины покоя — в s раз, площади покоя — в s², радиусы и мерка жеста —
// в s. Толщина, карта нажима, сушка и цвет безразмерны и не трогаются. Лист на таве без блюда
// (посадка не дала ни одной ячейки) переносится так же от старого центра тавы к новому.
function rescaleSheet(oldZ, oldPan, oldR){
  const z = zone("work");
  targetR = sheetSpan(z)*TARGET_FRAC; layoutPan();
  const s = targetR/oldR, onPan = phase === "PAN";
  const o0 = onPan ? oldPan : { x:oldZ.cx, y:oldZ.cy }, o1 = onPan ? panC : { x:z.cx, y:z.cy };
  for(let i=0;i<N;i++){
    px[i] = o1.x + (px[i]-o0.x)*s; py[i] = o1.y + (py[i]-o0.y)*s; prx[i] = px[i]; pry[i] = py[i];
    vx[i] *= s; vy[i] *= s;
  }
  if(sqC && !onPan) sqC = { x:o1.x + (sqC.x-o0.x)*s, y:o1.y + (sqC.y-o0.y)*s };   // мишень едет вместе с листом
  else sqC = null;
  scaleSheetLengths(s);
}
// Всё, что у листа измеряется в единицах стола, кроме самих узлов (их переносят вызывающие).
// На блюде длины покоя физике уже не нужны, но масштабируются так же — лист остаётся согласованным.
function scaleSheetLengths(s){
  for(const c of cons) c.rest *= s;
  if(quadRest) for(let q=0;q<quadRest.length;q++) quadRest[q] *= s*s;
  startArea *= s*s;
  R0 *= s; startR *= s; step1R *= s; gestureScale *= s;
}
// Отложенный ресайз применяется, как только рука отпустила и лист вернулся в покой.
function flushResize(){ if(pendingResize && !gestureLive()) resize(); }
addEventListener("resize", ()=>resize());
// Поворот телефона меняет раскладку (панель вниз ↔ вбок), а событие resize на iOS
// приходит раньше, чем пересчитан layout: наблюдатель ловит уже итоговый размер.
if(window.ResizeObserver) new ResizeObserver(()=>resize()).observe(stage);
try{ const s=localStorage.getItem("dough_log"); if(s) log=JSON.parse(s); }catch(e){}
try{ const s=localStorage.getItem("dough_gestures"); if(s) gestures=JSON.parse(s); }catch(e){}
resize(true);
// Предпросмотр рабочей ветки: локальный сервер отдаёт /__preview.json с веткой и коммитом.
// Production на Pages такого адреса не знает — туда даже не ходим, значок остаётся скрытым.
if(/^https?:$/.test(String(location.protocol)) && !/github\.io$/.test(location.hostname)){
  fetch("/__preview.json", { cache:"no-store" }).then(r=>r.ok ? r.json() : null).then(info=>{
    const el = document.getElementById("previewBadge");
    if(!info || !el || !info.branch) return;
    el.textContent = `предпросмотр · ${info.branch} · ${info.head}` +
      (info.dirty ? ` + ${info.dirty} незакоммич.` : "") + ` · ${BUILD}`;
    el.hidden = false;
  }).catch(()=>{});
}
// Возврат из фона: rAF там стоял, и первый кадр после возврата — это секунды, а не просадка.
addEventListener("visibilitychange", ()=>{ if(!document.hidden){ last = performance.now(); resetMeters(); } });
requestAnimationFrame(loop);
