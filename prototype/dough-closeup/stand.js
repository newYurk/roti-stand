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
const BUILD = "2026-09-17 · прижим и бананы · 16";
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
    runTuneAtBuild:runTuneAtBuild ? { ...runTuneAtBuild } : null, mixedTune };
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
  impulse:0, direction:{x:0,y:0}, timer:0, mul:0, heldAtLift:0,
  // перенос «запятой»: накопленный поворот маха, его хвост и параметры полёта
  sweep:0, lastDir:null, tailDir:{x:1,y:0}, carryFrom:{x:0,y:0}, toss:null };
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
// Разрыв — не провал и не перезапуск (решение владельца 22.08.2026): дырка остаётся
// в листе рваным узором, симуляция не останавливается, тесто не переделывается.
let tornAt = 0, lastSnap = 0, breakTime = 0, pressTime = 0, pressed = false;
// Ответ прибора на предсказание: что показать крупной строкой и с какого момента.
let verdict = "", verdictAt = 0;
let tornNode = null;               // узлы порванных ячеек — для подсветки рваного края
let conDeg = null;                 // сколько живых связей держит узел; 0 = осколок
let runStart = 0, R0 = 1;
let variant = "A", condition = "both";
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
// Перенос: пока лист в руке (CARRY) и летит (TOSS), узлы физики не двигаются —
// сдвиг, поворот и подъём применяются к картинке и запекаются в узлы при посадке.
let xf = null;                     // {cx,cy,ox,oy,th,lift}

// Вид не сверху, а из-за прилавка: стол уходит от игрока, поэтому по вертикали
// всё сжато, а дальний край ещё и сужен. Симуляция считается в плоскости стола,
// экранные координаты получаются проекцией — обратное преобразование нужно вводу.
const TILT = 0.56, PERSP = 0.22;
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
function zone(name){
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
}

// ─────────────────────────── проба конверта и нарезки (#20 / #53)
// После посадки замораживаем исходную сетку. Локальные полигоны хранят настоящий
// материал: разорванные ячейки отсутствуют, складка отражает материал и порядок
// слоёв. Это геометрический стенд, не симуляция самоконтакта или готовности блюда.
let dish = null, dishGesture = null;
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
function dishPose(){
  if(dish.mode==="fold") return {x:panC.x,y:panC.y,scale:targetR};
  const w=zone("work"), b=dish.cutBounds;
  const perspective=1+((w.cy+w.h*.35-horizon())/cv.height)*PERSP;
  const scale=Math.min(targetR*1.4,w.w*.82/(b.right-b.left)/perspective,w.h*.70/(b.bottom-b.top));
  return {x:w.cx-dish.cutCenter.x*scale,y:w.cy-dish.cutCenter.y*scale,scale};
}
function dishLocal(p){ const pose=dishPose(); return {x:(p.x-pose.x)/pose.scale,y:(p.y-pose.y)/pose.scale}; }
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
  panPress=[]; domes=[];          // жир на таве остаётся: он принадлежит сковороде
  const faces=[];
  for(let q=0;q<quads.length;q++){
    if(quadCons[q].some(c=>c.broken)) continue;
    const ids=quads[q], points=ids.map(i=>({x:(px[i]-panC.x)/targetR,y:(py[i]-panC.y)/targetR}));
    const tone=ids.reduce((s,i)=>s+thick[i],0)/4;
    // Внутренняя диагональ сохраняет вогнутые квады при выпуклом отсечении.
    for(const p of materialTriangles(points)){
      if(polyArea(p)>1e-10) faces.push({points:p,kind:"dough",source:q,tone,turned:false});
    }
  }
  dish={mode:"fold",faces,folds:0,cuts:[],history:[],filling:[],message:"Начинка на месте · заверни края внутрь"};
  if(!faces.length){ dish=null; return; }
  const b=dishBounds(), cx=(b.left+b.right)/2, cy=(b.top+b.bottom)/2;
  const span=Math.min(b.right-b.left,b.bottom-b.top), radius=span*.075;
  const base=faces.slice();
  // Кружочки условной начинки обрезаются самим листом: через дырку не висит даже
  // край порции. Случайны только центры и оттенок, далее все части сохраняют id.
  for(let id=0;id<7;id++){
    const angle=id*Math.PI*2/6, r=id===6 ? 0 : span*(.17+Math.random()*.025);
    const x=cx+Math.cos(angle)*r+(Math.random()-.5)*radius*.4;
    const y=cy+Math.sin(angle)*r+(Math.random()-.5)*radius*.4;
    // Круг той же площади, что прежний эллипс 1 × 0,8: высота порции считается по кругу,
    // и край эллипса по короткой оси обрывался ступенькой (ревью толщины 16.09, п. 9).
    const rr=radius*Math.sqrt(.8);
    const ring=Array.from({length:12},(_,j)=>({x:x+Math.cos(j*Math.PI/6)*rr,y:y+Math.sin(j*Math.PI/6)*rr}));
    let added=false;
    for(const face of base){
      let p=face.points;
      for(let j=0;j<ring.length && p.length;j++){
        const a=ring[j], z=ring[(j+1)%ring.length], nx=-(z.y-a.y), ny=z.x-a.x;
        p=clipPoly(p,nx,ny,a.x*nx+a.y*ny);
      }
      if(p.length){ faces.push({points:p,kind:"filling",source:id,tone:id%3,turned:false,pc:{x,y},pr:rr,ph:FILL_MM}); added=true; }
    }
    if(added) dish.filling.push({id,x,y,radius:rr});
  }
  // Даже у маленького/сильно порванного листа остаётся проверяемая порция на материале.
  if(!dish.filling.length){
    const f=base.reduce((a,b)=>polyArea(a.points)>polyArea(b.points)?a:b);
    const c=f.points.reduce((s,p)=>({x:s.x+p.x/3,y:s.y+p.y/3}),{x:0,y:0});
    const pts=f.points.map(p=>({x:c.x+(p.x-c.x)*.7,y:c.y+(p.y-c.y)*.7}));
    faces.push({...f,kind:"filling",source:0,tone:0,points:pts,pc:{x:c.x,y:c.y},
      pr:Math.max(...pts.map(p=>Math.hypot(p.x-c.x,p.y-c.y)))*1.2,ph:FILL_MM});
    dish.filling.push({id:0,x:c.x,y:c.y,radius:0});
  }
  // У материала две поверхности: 0 — та, что легла на таву при посадке, 1 — исходный
  // верх. Обе начинаются с нуля: startDish вызывается в момент посадки, и узловые
  // dry/cook к этому времени ещё не успели вырасти ни на одном пути.
  dish.thermal=quads.map((ids,q)=>quadCons[q].some(c=>c.broken) ? null : {
    dry:[0,0],cook:[0,0],
    tone:ids.reduce((s,i)=>s+thick[i],0)/4,contact:ids.reduce((s,i)=>s+contactF[i],0)/4
  });
  dish.flips=0; dish.panTime=0; dish.sessions=[{flip:0,start:0,gold:null}];
  dish.holes=quadCons.filter(cs=>cs.some(c=>c.broken)).length;   // рваные ячейки листа при посадке
  rebuildDishContact(); dish.hull=dishHull(); syncDishUI();
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
const FILL_MM = 4;            // высота порции начинки (ломтики банана с яйцом)
const DOUGH_HEAT_MM = 1.05;   // тепло сквозь слой теста exp(−мм/1,05): лист 0,5 мм пропускает 0,62, как раньше
const FILL_HEAT_MM = 5;       // сквозь начинку exp(−мм/5), и ещё её тень: порция 4 мм пропускает 0,45 × 0,2
const COVER_MM = 1;           // тень начинки на слоях под ней 1/(1+мм/1): 4 мм дают ×0,2 (спецификация §1: ×0,15…0,25)
const doughMM = tone => tone*DOUGH_UNIT_MM;
// Высота начинки в точке: плато с мягким краем по внешней трети порции. Порция помнит свой
// центр в текущих координатах (pc) — складка и переворот переносят его вместе с гранью.
function fillHeight(f,p){
  const H = f.ph ?? FILL_MM*0.8;
  if(!f.pc || !(f.pr>0)) return H;
  const edge = 1 - Math.hypot(p.x-f.pc.x,p.y-f.pc.y)/f.pr;
  return H*Math.sqrt(Math.max(0.15,Math.min(1,edge/0.35)));
}
function layerMM(f,p){ return f.kind==="filling" ? fillHeight(f,p) : doughMM(f.tone); }
const fillPass = mm => Math.exp(-mm/FILL_HEAT_MM)/(1+mm/COVER_MM);
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
  const stackHeatAt=(stack,own,pt,heat,weight)=>{
    const hs=stack.map(f=>layerMM(f,pt));
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
    const hs=stack.map(f=>layerMM(f,pt));
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
  let m=1;
  for(const p of panPress){
    if(!(p.level>0)) continue;
    const d=Math.hypot(T.x[i]-p.x,T.y[i]-p.y); if(d>=PRESS_R) continue;
    const soft=d<=PRESS_R*.6 ? 1 : 1-(d-PRESS_R*.6)/(PRESS_R*.4);
    m*=1+PRESS_GAIN*p.level*soft;
  }
  return m;
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
function updatePanPress(dt){
  const g=dishGesture;
  if(g && g.zone==="edge" && !g.press && !g.moved && g.onMat && performance.now()-g.t0>=PRESS_EDGE_HOLD_MS){
    g.press={x:g.start.x,y:g.start.y,level:0,held:true,since:performance.now()};
    panPress.push(g.press); g.latched=true;
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
  if(!dish || dish.mode!=="fold" || phase!=="PAN" || !dish.thermal || dishFlight) return;
  if(dishGesture && dishGesture.slide) return;   // лист на лопатке — стали не касается
  if(!dish.dryDrive) rebuildDishContact();
  updatePanPress(dt);
  // Быстрый путь: без прижима, куполов и жира — прежние приводы без перерасчёта.
  const D=panModsActive() && dish.heatTable ? moddedDrives() : dish;
  for(let i=0;i<dish.thermal.length;i++){
    const t=dish.thermal[i]; if(!t) continue;
    // Толще листа-эталона — сохнет медленнее, тоньше — быстрее (время сушки ∝ толщине, §1).
    const thin=Math.max(.25,Math.min(2.5,SHEET_REF_MM/Math.max(.05,doughMM(t.tone))));
    for(let side=0;side<2;side++){
      // Сторона сначала сохнет, и только потом набирает цвет — как было для листа целиком.
      if(t.dry[side]<1) t.dry[side]=Math.min(1,t.dry[side]+dt*DRY_RATE*D.dryDrive[i][side]*thin);
      else t.cook[side]+=dt*COOK_RATE*D.cookDrive[i][side];
    }
  }
  // Время на таве по «сеансам»: посадка и каждый переворот открывают новый. Золото низа
  // (средний цвет прижатых сторон 0,4) — ответ на вопрос бюджета 30–60 с (#21).
  if(dish.sessions){
    dish.panTime=(dish.panTime||0)+dt;
    const cur=dish.sessions[dish.sessions.length-1];
    if(cur.gold===null && dishSideMean("cook","contactWeights")>=0.4) cur.gold=dish.panTime-cur.start;
  }
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
let SHOW_THROUGH = 0.3;
function dishCookColor(f,side,through=true){
  const base=f.turned ? [221,199,152] : [227,213,178];
  const t=dish.thermal && dish.thermal[f.source];
  if(!t) return cookColor(base,0);
  if(side===undefined) side=f.turned ? 0 : 1;           // видна верхняя сторона грани
  const own=cookColor(base,t.cook[side]);
  if(!through || SHOW_THROUGH<=0) return own;
  const w=Math.max(0,Math.min(1,1-t.tone))*SHOW_THROUGH;
  return lerp3(own,cookColor(base,t.cook[1-side]),w);
}

function foldGeometry(anchor,end){
  const dx=anchor.x-end.x, dy=anchor.y-end.y, length=Math.hypot(dx,dy);
  if(length<.12) return null;
  const nx=dx/length, ny=dy/length, offset=((anchor.x+end.x)*nx+(anchor.y+end.y)*ny)/2;
  const fixed=[], moving=[]; let aFixed=0,aMoving=0;
  // Скрытые ссылки на исходную грань нужны быстрым высотам предпросмотра; в JSON и в
  // следующие копии они не попадают (не перечисляемые).
  const tag=(o,src,lifted)=>Object.defineProperties(o,{__src:{value:src},__lifted:{value:lifted}});
  dish.faces.forEach((f,src)=>{
    const stay=clipPoly(f.points,nx,ny,offset,false), lift=clipPoly(f.points,nx,ny,offset);
    if(stay.length){ fixed.push(tag({...f,points:stay},src,false)); if(f.kind==="dough") aFixed+=polyArea(stay); }
    if(lift.length){
      if(f.kind==="dough") aMoving+=polyArea(lift);
      const refl=p=>{const d=p.x*nx+p.y*ny-offset;return{x:p.x-2*d*nx,y:p.y-2*d*ny};};
      moving.push(tag({...f,turned:!f.turned,points:lift.map(refl),...(f.pc?{pc:refl(f.pc)}:{})},src,true));
    }
  });
  if(aMoving<.025*(aFixed+aMoving)||aFixed<.18*(aFixed+aMoving)) return null;
  return {faces:fixed.concat(moving.reverse()),crease:{nx,ny,offset}};
}
function rememberDish(){
  dish.history.push({faces:dish.faces,folds:dish.folds,cuts:dish.cuts,flips:dish.flips||0});
  if(dish.history.length>20) dish.history.shift();
}
function foldDish(anchor,end){
  const next=foldGeometry(anchor,end); if(!next) return false;
  panPress=[];
  rememberDish(); dish.faces=next.faces; dish.folds++; dish.hull=dishHull(); rebuildDishContact();
  dish.message=`Складок: ${dish.folds} · можно сложить ещё`;
  syncDishUI(); return true;
}
// ─── Подача (решение владелицы 16.09): техническая кнопка «подать» → карточка → «следующий роти».
// Карточка — черновик стенда: что помнит след роти, владелица отложила до первой нарисованной
// карточки (#50). Здесь только то, что стенд знает наверняка.
let servedCount = 0, inputQuietUntil = 0;
try{ servedCount = Math.max(0, +(localStorage.getItem("dough_served")||0)) || 0; }catch(e){}
function cookWord(c){
  return c<.05 ? "сырое" : c<.25 ? "бледное" : c<.6 ? "золотистое" : c<1 ? "румяное" : c<1.3 ? "тёмное" : "до угля";
}
function dishCard(){
  const bottom=+dishSideMean("cook","contactWeights").toFixed(2), top=+dishSideMean("cook","topWeights").toFixed(2);
  return { folds:dish.folds, flips:dish.flips||0, cuts:dish.cuts.length, holes:dish.holes||0,
    portions:dish.filling.length, bottom, top,
    thickMM:+Math.max(0,...stackHeights(dish.faces).zt).toFixed(1),
    bottomWord:cookWord(bottom), topWord:cookWord(top), panSeconds:Math.round(dish.panTime||0),
    sessions:(dish.sessions||[]).map(x=>x.gold===null ? "—" : typeof x.gold==="string" ? x.gold : Math.round(x.gold)+" с") };
}
function serveDish(){
  if(!dish || dish.mode!=="cut" || dishMove || dishGesture) return false;
  const c=dishCard(), f=v=>v.toFixed(2).replace(".",",");
  dish.mode="served"; dish.card=c; servedCount++;
  try{ localStorage.setItem("dough_served", String(servedCount)); }catch(e){}
  gestures.push({ ...measurementContext(), kind:"serve", n:servedCount, ...c, ts:new Date().toISOString() });
  if(gestures.length>200) gestures.shift();
  try{ localStorage.setItem("dough_gestures", JSON.stringify(gestures)); }catch(e){}
  const lines=[
    `Роти №${servedCount} подано`,
    `Складок ${c.folds} · переворотов ${c.flips} · резов ${c.cuts}`,
    `Снизу ${c.bottomWord} (${f(c.bottom)}) · сверху ${c.topWord} (${f(c.top)})`,
    `На таве ${c.panSeconds} с`,
    `Золото низа по сеансам: ${c.sessions.join(" / ")}`,
    `Начинка: ${c.portions} порц. · ${c.holes ? `рваный узор, ${c.holes} яч.` : "без дырок"}`,
    `Толщина конверта до ${String(c.thickMM).replace(".",",")} мм`,
  ];
  if(!c.folds) lines.push("Не сложено");
  else if(c.top<.05) lines.push("Верх не прожарен — конверт не переворачивали");
  if(!c.cuts) lines.push("Не нарезано");
  lines.push("", "черновик карточки стенда · что помнит след — ещё не решено (#50)");
  document.getElementById("cardBody").textContent=lines.join("\n");
  document.getElementById("card").hidden=false;
  dish.message="Подано";
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
  dish.history=[{faces:dish.faces,folds:dish.folds,cuts:dish.cuts,flips:dish.flips||0,toPan:{history:dish.history}}];
  dish.mode="cut"; phase="CUT";
  dish.message="Проведи через конверт · длину и направление выбираешь сама";
  syncDishUI();
}
function cutDish(a,b){
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
      if(outside.length) faces.push({...f,points:outside});
      inside=clipPoly(inside,ex,ey,offset);
    }
    if(inside.length) removed+=polyArea(inside);
  }
  if(removed<1e-7) return false;
  rememberDish(); dish.faces=faces; dish.cuts=dish.cuts.concat({a,b,width});
  dish.message=`Разрезов: ${dish.cuts.length} · режь дальше или «заново»`;
  syncDishUI(); return true;
}
function undoDish(){
  if(!dish || dishGesture || dishFlight || dishMove || dish.mode==="served" || !dish.history.length) return;
  const flipsBefore=dish.flips||0;
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
// тепловая история не трогаются: стороны принадлежат тесту. dish.filling — раскладка
// на момент посадки, её не отражаем (складка её тоже не трогает).
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
  const faces=[];
  for(let i=dish.faces.length-1;i>=0;i--){
    const f=dish.faces[i];
    faces.push({...f,turned:!f.turned,points:f.points.map(mirror),...(f.pc?{pc:mirror(f.pc)}:{})});
  }
  return {faces,axis:{nx,ny,c},from:c,to:{x:tx,y:ty}};
}
function startPanSession(){
  // Если на сталь легла уже золотая сторона, «0 с» засоряло бы замер бюджета: пишем «уже».
  if(dish.sessions) dish.sessions.push({flip:dish.flips||0,start:dish.panTime||0,
    gold:dishSideMean("cook","contactWeights")>=0.4 ? "уже" : null});
}
function commitFlip(next){
  panPress=[];                                   // лист перевернулся: пятна прижима остались на прежнем месте
  rememberDish(); dish.faces=next.faces; dish.flips=(dish.flips||0)+1;
  dish.hull=dishHull(); rebuildDishContact(); startPanSession();
  dish.message=`Перевёрнуто: ${dish.flips} · жарится другая сторона`;
  syncDishUI();
}
// Технический и жестовый вход одинаковы: полёт 0,45 с, посадка — шлепок и волна шипения.
const FLIP_T = 0.45;
function startFlip(dir,landing){
  if(!dish || dish.mode!=="fold" || phase!=="PAN" || dishGesture || dishFlight) return false;
  const next=flipGeometry(dir,landing); if(!next) return false;
  if(dish.folds || dish.cuts.length) dishSectionGeometry(next.faces);   // торец считаем до посадки, если он рисуется
  stackHeights(dish.faces); stackHeights(next.faces);   // и высоты: иначе кадр посадки считает их сам и дёргается
  let radius=0;
  for(const f of dish.faces) if(f.kind==="dough") for(const p of f.points)
    radius=Math.max(radius,Math.hypot(p.x-next.from.x,p.y-next.from.y));
  dishFlight={next,from:dish.faces,t0:performance.now(),T:FLIP_T,radius};
  dish.message="Переворот…"; syncDishUI(); audioFlipLift();
  return true;
}
function updateDishFlight(){
  if(!dishFlight) return;
  if((performance.now()-dishFlight.t0)/1000 < dishFlight.T) return;
  const late=(performance.now()-dishFlight.t0)/1000 > dishFlight.T+0.5;   // вернулись из фона
  const next=dishFlight.next; dishFlight=null;
  commitFlip(next);
  if(!late) audioPanLand();                  // шлепок через минуты после взлёта — ложный звук
}
function syncDishUI(){
  document.getElementById("gDish").hidden=!dish;
  document.getElementById("gStep").hidden=!!dish;
  document.getElementById("tear").hidden=!!dish;
  document.getElementById("gTune").hidden=!!dish;
  document.getElementById("gCond").hidden=!!dish;
  const cut=document.getElementById("cutMode");
  cut.disabled=!dish || !dish.folds || dish.mode!=="fold";
  cut.textContent=dish && dish.mode==="cut" ? "нарезка на столе" : "к нарезке →";
  cut.disabled=cut.disabled || !!dishFlight || !!dishMove;
  document.getElementById("undoDish").disabled=!dish || !dish.history.length || !!dishFlight || dish.mode==="served";
  const serve=document.getElementById("serveDish");
  if(serve){ serve.hidden=!dish || dish.mode==="fold"; serve.disabled=!dish || dish.mode!=="cut" || !!dishMove; }
  const flip=document.getElementById("flipDish");
  if(flip) flip.disabled=!dish || dish.mode!=="fold" || !!dishFlight;
  const served=!!dish && dish.mode==="served";
  for(const id of ["flipDish","cutMode","undoDish"]){ const b=document.getElementById(id); if(b) b.hidden=served; }
  if(dish) hintEl.textContent=dish.mode==="fold"
    ? "край: внутрь — складка · мах — переворот · на стол — снять · держи — прижим"
    : dish.mode==="served" ? "Подано · «следующий роти» — новый кусочек"
    : "Нарезка: проведи через конверт прямым жестом · «подать» — когда готово";
}
// Складка — только ВНУТРЬ листа. Раньше линия сгиба строилась по любому сдвигу длиннее
// 0,12, и сдвиг пальца вдоль кромки на 10 CSS px складывал полсписта (портрет: сгиб
// поперёк движения проходил через середину листа). Теперь сдвиг меряется вдоль
// внутренней нормали кромки и должен смотреть внутрь не дальше 60° от неё.
// До 10 CSS px от точки касания жест не читается вовсе: это дрожание пальца
// (iOS allowableMovement 10 pt, Android touch slop 8 dp). Числа — для пробы, не замер.
const FOLD_MIN_DEPTH = 0.12, FOLD_MAX_ANGLE_COS = Math.cos(60*Math.PI/180), TOUCH_SLOP_CSS = 10;
function beginDishGesture(id,p,client,time){
  if(dishGesture || dishFlight || dishMove || dish.mode==="served") return;
  const start=dishLocal(p), at=client || {x:0,y:0}, t0=Number.isFinite(time) ? time : performance.now();
  const samples=[{x:at.x,y:at.y,t:t0}];
  if(dish.mode==="cut"){ dishGesture={id,start,end:start,client:at,samples}; return; }
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
  const onMat=onMaterial(start,distance>.30 ? 0 : .06);
  // Дальше 0,30 от кромки лопатки нет: палец на тесте — прижим с первого кадра, мимо теста — ничего.
  // Подсказки о возможном здесь не пишутся (критерий подсказок 07.09).
  if(distance>.30){
    if(!onMat) return;
    const press={x:start.x,y:start.y,level:0,held:true,since:performance.now()};
    panPress.push(press);
    dishGesture={id,start,end:start,client:at,samples,zone:"middle",t0,moved:false,press,latched:true};
    return;
  }
  const anchor=near[0].q, edge={dx:near[0].dx,dy:near[0].dy};
  // Внутренняя нормаль кромки: перпендикуляр, повёрнутый к центру оболочки.
  const c=dish.hull.reduce((s,q)=>({x:s.x+q.x/dish.hull.length,y:s.y+q.y/dish.hull.length}),{x:0,y:0});
  const inwards=near.map(e=>{
    const len=Math.hypot(e.dx,e.dy)||1; let n={x:-e.dy/len,y:e.dx/len};
    if((c.x-anchor.x)*n.x+(c.y-anchor.y)*n.y<0) n={x:-n.x,y:-n.y};
    return n;
  });
  const inward=inwards[0];
  dishGesture={id,start,end:start,anchor,inward,inwards,edge,preview:null,client:at,samples,moved:false,
    zone:"edge",t0,onMat,press:null,latched:false,
    stroke:{start:null,path:0,lastMoveT:t0,lastT:t0,pos:{x:at.x,y:at.y}}};
  audioScrape();                              // ответ инструмента: лопатка коснулась стали у края
}
function inwardFold(g){
  const vx=g.target.x-g.anchor.x, vy=g.target.y-g.anchor.y, len=Math.hypot(vx,vy);
  return (g.inwards || [g.inward]).some(n=>{
    const depth=vx*n.x+vy*n.y;
    return depth>=FOLD_MIN_DEPTH && depth>=len*FOLD_MAX_ANGLE_COS;
  });
}
// Штрих — непрерывное движение пальца. Пауза длиннее STROKE_PAUSE_MS начинает новый штрих:
// неподвижный палец событий не шлёт, и без этого пауза перед махом считалась бы его частью.
// Начало штриха живёт в жесте, а не в буфере отсчётов, — длина буфера зависит от частоты событий.
const STROKE_PAUSE_MS = 40, FOLD_PREVIEW_DELAY_MS = 110;
function trackStroke(g,client,t){
  const k=g.stroke, d=Math.hypot(client.x-k.pos.x,client.y-k.pos.y);
  if(d>=0.5){
    if(k.start===null || t-k.lastMoveT>STROKE_PAUSE_MS){ k.start=Math.max(k.lastT,t-17); k.path=0; }
    k.path+=d; k.lastMoveT=t; k.pos={x:client.x,y:client.y};
  }
  k.lastT=t;
}
function moveDishGesture(p,client,time){
  const g=dishGesture; g.end=dishLocal(p);
  const t=Number.isFinite(time) ? time : performance.now();
  if(client){
    g.samples.push({x:client.x,y:client.y,t});
    if(g.samples.length>64) g.samples.shift();
    if(g.stroke) trackStroke(g,client,t);
    if(!g.moved && Math.hypot(client.x-g.client.x,client.y-g.client.y)>=TOUCH_SLOP_CSS){ g.moved=true; g.movedAt=t; }
  } else { if(!g.moved) g.movedAt=t; g.moved=true; }   // вызов без экранных координат (проверки) — без мёртвой зоны
  if(g.zone==="middle"){
    // До схватывания быстрый сдвиг — место под щипок (#19), не след прижима.
    if(g.moved && !g.pinch && g.movedAt-g.t0<=PINCH_WINDOW_MS && meanDry()<.25){ g.pinch=true; releasePress(g); }
    if(!g.pinch){ g.press.x=g.end.x; g.press.y=g.end.y; }
    return;
  }
  if(g.moved) releasePress(g);               // сдвиг у кромки — складка, снятие или мах, прижим отпущен
  if(dish.mode==="fold"){
    if(!g.moved){ g.target=null; g.preview=null; return; }
    // Сохраняем смещение пальца от выбранной кромки, чтобы лист не прыгал к нему.
    g.target={x:g.anchor.x+g.end.x-g.start.x,y:g.anchor.y+g.end.y-g.start.y};
    // Первые 110 мс быстрого штриха складку не показываем: это может быть мах, и
    // полсписта не должно мелькать перед переворотом.
    const fresh=client && g.stroke && g.stroke.start!==null && t-g.stroke.start<FOLD_PREVIEW_DELAY_MS;
    const fast=fresh && velocityOf(g,t).speed>=FLICK_MIN_CSS;
    g.preview=!fast && inwardFold(g) ? foldGeometry(g.anchor,g.target) : null;
    // Ведение НАРУЖУ — снятие (решение владелицы 16.09): лист едет за лопаткой. Пока быстрый
    // штрих свеж, лист не двигаем: это может быть мах, и лист прыгнул бы назад перед полётом.
    if(!fast && !g.preview && outwardSlide(g)){
      let sx=g.end.x-g.start.x, sy=g.end.y-g.start.y;
      if(!dish.folds){ const L=Math.hypot(sx,sy), k=L>.15 ? .15/L : 1; sx*=k; sy*=k; }   // несложенный упирается
      g.slide={x:sx,y:sy};
      if(Math.hypot(sx,sy)>=FOLD_MIN_DEPTH) g.slid=true;
    } else g.slide=null;
  }
}
function outwardSlide(g){
  const vx=g.target.x-g.anchor.x, vy=g.target.y-g.anchor.y, len=Math.hypot(vx,vy);
  // «Наружу» — от кромки или от центра конверта: у угла касание ближе к боковому ребру,
  // и нормаль одного ребра смотрела бы вдоль движения к столу.
  const c=dishCentroid(), rx=g.anchor.x-c.x, ry=g.anchor.y-c.y, rl=Math.hypot(rx,ry)||1;
  const radial=vx*rx/rl+vy*ry/rl;
  // От угла к столу палец часто идёт наискось к радиусу: для направления «от центра» конус шире (80°).
  if(radial>=FOLD_MIN_DEPTH && radial>=len*Math.cos(80*Math.PI/180)) return true;
  return (g.inwards || [g.inward]).some(n=>{
    const out=-(vx*n.x+vy*n.y);
    return out>=FOLD_MIN_DEPTH && out>=len*FOLD_MAX_ANGLE_COS;
  });
}
// Лист снят, если его заметно сдвинули (не меньше 0,45 и 60 CSS px пальцем — случайный сдвиг
// на 10 px в портрете снимал лист), а палец отпущен над рабочей частью стола за бортом тавы.
const REMOVE_MIN_SLIDE = 0.45, REMOVE_MIN_CSS = 60;
function slideFarEnough(g,client){
  return Math.hypot(g.slide.x,g.slide.y)>=REMOVE_MIN_SLIDE &&
    Math.hypot(client.x-g.client.x,client.y-g.client.y)>=REMOVE_MIN_CSS;
}
function slideEndsOnTable(client){
  const p=toLocal(client.x,client.y), w=zone("work");
  const onTable=p.x>=w.x && p.x<=w.x+w.w && p.y>=w.y && p.y<=w.y+w.h;
  return onTable && Math.hypot(p.x-panC.x,p.y-panC.y)>PAN_R*1.08;
}
const MOVE_T = 0.35;
function startRemoval(slide={x:0,y:0}){
  if(!dish || dish.mode!=="fold" || dishFlight || dishMove) return false;
  const from=dishPose(); from.x+=slide.x*from.scale; from.y+=slide.y*from.scale;
  panPress=[];
  startCutting();
  if(dish.mode!=="cut") return false;
  dishMove={from,t0:performance.now(),T:MOVE_T};
  dish.message="На столе · режь прямым движением";
  syncDishUI();
  return true;
}
function updateDishMove(){
  if(!dishMove) return;
  const age=(performance.now()-dishMove.t0)/1000;
  if(age<dishMove.T) return;
  dishMove=null; if(age<=MOVE_T+0.5) audioSlap(1.0);   // после возврата из фона — без шлепка
  syncDishUI();
}
// Переворот на таве — тот же глагол «поднять и шлёпнуть»: коснуться края и резко махнуть
// (вариант A для пробы владелицы, #21). Удержание здесь не используется — оно закреплено
// за прижимом (решение 07.09). Скорость — регрессия по отсчётам в CSS px за последние
// 80 мс, чтобы исход не зависел от частоты событий (урок #91). Все пороги — для пробы.
const FLICK_MIN_CSS = 850, FLICK_MIN_PATH_CSS = 40, FLICK_MAX_MS = 300, FLICK_STALE_MS = 50, FLICK_WINDOW_MS = 80;
function velocityOf(g,tUp){
  const S=g.samples;
  const win=S.filter(q=>q.t>=tUp-FLICK_WINDOW_MS);
  const pts=win.length>=2 ? win : S.slice(-2);
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
  const ok=speed>=FLICK_MIN_CSS && path>=FLICK_MIN_PATH_CSS && duration<=FLICK_MAX_MS && stale<=FLICK_STALE_MS;
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
  const tUp=Number.isFinite(time) ? time : performance.now();
  releasePress(g);
  if(g.zone==="middle"){
    logPanGesture(g.pinch ? "pinch" : "press",{speed:0,duration:tUp-g.t0,path:0,stale:0},pressExtra(g,tUp));
    return;
  }
  if(dish.mode!=="fold"){
    if(!cutDish(g.start,g.end)) dish.message="Проведи лезвием через тесто";
    return;
  }
  const last=g.samples[g.samples.length-1], f=flickOf(g,tUp), extra=pressExtra(g,tUp);
  if(g.press && !g.moved){ logPanGesture("press",f,extra); return; }
  if(f.ok && !g.slid){
    // Лист уходит по направлению маха (если лист уже поехал за пальцем — это не мах).: направление переводим из экрана в координаты блюда.
    const a=dishLocal(toLocal(last.x-f.vx*.05,last.y-f.vy*.05)), b=dishLocal(toLocal(last.x,last.y));
    const len=Math.hypot(b.x-a.x,b.y-a.y);
    if(len>1e-9){
      const d={x:(b.x-a.x)/len,y:(b.y-a.y)/len};
      const reach=.15*Math.max(0,Math.min(1,(f.speed-FLICK_MIN_CSS)/1650));   // по хвосту маха, inferred
      const ok=startFlip(d,{x:d.x*reach,y:d.y*reach});
      logPanGesture(ok ? "flip" : "flip-refused",f,extra);
      if(ok) return;
    }
  }
  if(g.slid && !g.slide){ logPanGesture("slide-back",f,extra); dish.message="Веди дальше — на стол"; return; }
  if(g.slide){
    const onTable=slideEndsOnTable(last), fingerFar=Math.hypot(last.x-g.client.x,last.y-g.client.y)>=REMOVE_MIN_CSS;
    if(!dish.folds && onTable && fingerFar){ logPanGesture("slide-unfolded",f,extra); dish.message="Сначала сверни края — потом на стол"; return; }
    if(!onTable || !slideFarEnough(g,last)){ logPanGesture("slide-back",f,extra); dish.message="Веди дальше — на стол"; return; }
    // Для замера «когда снимать» (#14): цвет прижатой и видимой стороны в момент снятия.
    const at={bottomCook:+meanCook().toFixed(3), topCook:+dishSideMean("cook","topWeights").toFixed(3),
      panSeconds:Math.round(dish.panTime||0)};
    logPanGesture(startRemoval(g.slide) ? "remove" : "slide-refused",f,{...extra,...at});
    return;
  }
  const ok=g.target&&inwardFold(g)&&foldDish(g.anchor,g.target);
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
// конверта» резы не читались: гладкий верх шёл поверх узкой щели ножа). Каждый сквозной рез
// отодвигает свои стороны на PIECE_SPREAD поперёк себя; надрез, не дошедший до края, кусков
// не разделяет и ничего не двигает. Материал, резы и торцы считаются по настоящей геометрии.
const PIECE_SPREAD = 0.035;
function dishPieceShift(faces){
  if(!dish || !dish.cuts.length) return null;
  const cache=dishPieceShift.cache||(dishPieceShift.cache=new WeakMap());
  if(cache.has(faces)) return cache.get(faces);
  const inDough=p=>faces.some(f=>f.kind==="dough" && pointInFace(f.points,p.x,p.y));
  const full=dish.cuts.filter(c=>!inDough(c.a) && !inDough(c.b)).map(c=>{
    const len=Math.hypot(c.b.x-c.a.x,c.b.y-c.a.y)||1;
    return {a:c.a,nx:-(c.b.y-c.a.y)/len,ny:(c.b.x-c.a.x)/len};
  });
  let out=null;
  if(full.length){
    out=new Map();
    for(const f of faces){
      let cx=0,cy=0; for(const p of f.points){ cx+=p.x; cy+=p.y; }
      cx/=f.points.length; cy/=f.points.length;
      let x=0,y=0;
      for(const c of full){ const side=Math.sign((cx-c.a.x)*c.nx+(cy-c.a.y)*c.ny); x+=side*PIECE_SPREAD*c.nx; y+=side*PIECE_SPREAD*c.ny; }
      out.set(f,{x,y});
    }
  }
  cache.set(faces,out); return out;
}
function drawDishSections(g,screen,faces,sx,sy,zk=0,H=null){
  const sections=dishSectionGeometry(faces),pixel=Math.min(2,devicePixelRatio||1)*Math.min(sx,sy);
  const shift=dishPieceShift(faces);
  if(shift){ const base=screen; screen=(p,f)=>{ const o=f && shift.get(f); return base(o ? {x:p.x+o.x,y:p.y+o.y} : p); }; }
  const unit=Math.max(.55,1.7*pixel);
  // Magnified cross sections sit just INSIDE their real material edge. Otherwise
  // a .018 kerf on a phone hides every layer behind its neighbouring piece. This
  // is a drawing convention: neither the cut width nor any material is moved.
  g.save();g.globalAlpha=1;g.beginPath();
  for(const f of faces){
    if(f.kind!=="dough") continue;
    const signed=f.points.reduce((s,p,i)=>{const q=f.points[(i+1)%f.points.length];return s+p.x*q.y-q.x*p.y;},0);
    const ps=signed<0?f.points.slice().reverse():f.points;
    const a=screen(ps[0],f);g.moveTo(a.x,a.y);
    for(let i=1;i<ps.length;i++){const p=screen(ps[i],f);g.lineTo(p.x,p.y);}g.closePath();
  }
  g.clip();
  const walls=sections.walls.map(w=>{
    const own=w.stack[0];   // стенка принадлежит куску своей стопки
    const a=screen(w.a,own),b=screen(w.b,own),mid={x:(w.a.x+w.b.x)/2,y:(w.a.y+w.b.y)/2};
    const m=screen(mid,own),n=screen({x:mid.x+w.inward.x*.001,y:mid.y+w.inward.y*.001},own);
    const l=Math.hypot(n.x-m.x,n.y-m.y)||1;return {w,a,b,nx:(n.x-m.x)/l,ny:(n.y-m.y)/l};
  }).filter(s=>-(s.nx*.4+s.ny)>.06).sort((a,b)=>(a.a.y+a.b.y)-(b.a.y+b.b.y));
  for(const s of walls){
    const {w,a,b,nx,ny}=s;
    if(!w.cut&&w.stack.length<2) continue; // no artificial thick rim around a bare sheet
    // Высоты полос — настоящие толщины слоёв в этой точке (мм × zk); тонкому тесту даём
    // хотя бы unit, иначе в виде A корочки не видно. Без zk — прежняя условная шкала.
    // Со сглаженной поверхностью конверта стенка доходит ровно до её края, а слои делят
    // эту высоту в своей настоящей пропорции.
    const mid={x:(w.a.x+w.b.x)/2,y:(w.a.y+w.b.y)/2};
    const trueMM=w.stack.reduce((s,f)=>s+layerMM(f,mid),0), fit=H&&trueMM>0 ? H.at(mid)/trueMM : 1;
    const weights=zk ? w.stack.map(f=>Math.max(f.kind==="filling" ? unit*1.5 : unit, layerMM(f,mid)*fit*zk))
                     : w.stack.map(f=>f.kind==="filling"?1.65:1);
    const sum=weights.reduce((a,b)=>a+b,0);
    const height=zk ? sum : Math.min(Math.max(3,14*pixel),unit*sum), step=height/sum;
    const band=(from,to,color)=>{
      g.fillStyle=rgb(color);g.beginPath();
      g.moveTo(a.x+nx*from,a.y+ny*from);g.lineTo(b.x+nx*from,b.y+ny*from);
      g.lineTo(b.x+nx*to,b.y+ny*to);g.lineTo(a.x+nx*to,a.y+ny*to);g.closePath();g.fill();
    };
    let bottom=0;
    for(let i=0;i<w.stack.length;i++){
      const f=w.stack[i],top=bottom+weights[i]*step;
      if(f.kind==="filling"){ band(bottom,top,FILL_COLORS[Math.round(f.tone)%3].map(c=>c*.9)); bottom=top; continue; }
      // Мякиш светлее корочек. Корочки — настоящие стороны слоя: снизу та, что смотрит
      // вниз, сверху — та, что вверх; у каждой свой цвет (в виде A слой ~0,5 px — не разглядеть).
      // Нижний слой на таве показывает свою корочку широкой полосой: по кромке видно, как
      // румянится низ (владелица 17.09: жарку снизу не было видно).
      const down=f.turned ? 1 : 0, crust=i===0 && phase==="PAN" ? (top-bottom)*.55 : Math.min((top-bottom)*.3,Math.max(.5,1.2*pixel));
      const crumb=dishCookColor(f,down,false).map((c,k)=>(c+dishCookColor(f,1-down,false)[k])/2);
      band(bottom,top,crumb.map(c=>Math.round(c*.82+18)));
      band(bottom,bottom+crust,dishCookColor(f,down,false));
      band(top-crust,top,dishCookColor(f,1-down,false));
      bottom=top;
    }
    // Only the actual outer lips are stroked; never a triangle or a filling tile.
    g.strokeStyle="rgba(64,34,16,.72)";g.lineWidth=Math.max(.35,.7*pixel);
    g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();
    g.strokeStyle="rgba(255,232,171,.6)";g.lineWidth=Math.max(.3,.65*pixel);
    g.beginPath();g.moveTo(a.x+nx*height,a.y+ny*height);g.lineTo(b.x+nx*height,b.y+ny*height);g.stroke();
  }
  g.restore();
}
// ─── Вид толщины (решение владелицы 16.09). Условности отрисовки, не физика:
// высота на экране преувеличена в Z_EXAG раз, мм переводятся в доли роти через ROTI_R_MM.
const ROTI_R_MM = 110;   // радиус роти ≈ 11 см (inferred): 1 targetR ≈ 110 мм
const Z_EXAG = 3;        // тонкий лист и начинку иначе не разглядеть на телефоне
const VIEW_UP = 0.83;    // вертикаль в кадре при наклоне стола, ≈ √(1 − TILT²)
// Начинка — ломтики банана (владелица 17.09: жёлтые капли читались желтками). Мякоть кремовая;
// у каждого ломтика тёмный ободок и семечки в середине. Желток появится отдельной начинкой.
// Основа порции — бледная яичная заливка, по которой разложены ломтики (кадры уличного роти):
// ярко-жёлтая основа с ломтиками сверху читалась желтком, обложенным бананом (владелица 17.09).
const FILL_COLORS = [[236,218,158],[232,213,150],[239,222,166]];
const BANANA_FLESH = [[253,234,156],[249,228,146],[254,239,170]], BANANA_RIM = "rgba(178,132,48,.75)", BANANA_SEED = "rgba(112,80,40,.65)";
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
    }
  }
  const out=envelopeSurface({zb,zt,top,under,fill,L,T,dx,dy,size},faces); cache.set(faces,out); return out;
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
const LIGHT_SLOPE = 0.5;   // доля наклона поверхности, которую видит свет  // тоньше — это одиночный лист: его ступенчатый край без стенки
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
    base[c]=fill[c] ? under[c] : surf[c];
  }
  // Свет сверху-слева-спереди по наклону поверхности: множитель яркости (0,72…1,22). Пустые
  // ячейки снаружи дают склон у края — это и есть скругление кромки на свету.
  // За рамкой сетки — пусто: рамка облегает конверт, и его край лежит в крайних ячейках.
  const get=(grid,i,j)=>i<0||j<0||i>=n||j>=n ? 0 : grid[j*n+i];
  // Свет вполовину от преувеличенной высоты: на столе крупные куски иначе мнутся бликами (17.09).
  let light=new Float32Array(N), s=Z_EXAG/ROTI_R_MM*LIGHT_SLOPE;
  const lx=-.42,ly=-.5,lz=.76;
  for(let j=0;j<n;j++) for(let i=0;i<n;i++){
    const c=j*n+i;
    if(!cover[c]) continue;
    const gx=(get(surf,i+1,j)-get(surf,i-1,j))/(2*dx)*s, gy=(get(surf,i,j+1)-get(surf,i,j-1))/(2*dy)*s;
    light[c]=Math.max(.72,Math.min(1.22,((-gx*lx-gy*ly+lz)/Math.hypot(gx,gy,1))/lz));
  }
  // Свет по граням иначе мнётся, как бумага: сглаживаем на ячейку в пределах материала.
  const lw=boxBlur(boxBlur(cover,n,1,1),n,1,1);
  light=boxBlur(boxBlur(light,n,1,1),n,1,1);
  for(let c=0;c<N;c++) light[c]=cover[c]&&lw[c]>1e-6 ? light[c]/lw[c] : 1;
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
  const verts=new Array(faces.length), lights=new Float32Array(faces.length).fill(NaN);
  const flags=new Int8Array(faces.length).fill(-1);   // бит 1 — открытая начинка, бит 2 — край
  const flagsOf=i=>{
    if(flags[i]<0){
      const ps=faces[i].points; let x=0,y=0; for(const p of ps){x+=p.x;y+=p.y;}
      const k=Math.min(n-1,Math.max(0,Math.floor((x/ps.length-L)/dx))), j=Math.min(n-1,Math.max(0,Math.floor((y/ps.length-T)/dy)));
      flags[i]=(fill[j*n+k] ? 1 : 0) | (ps.some(p=>sample(cover,p,false).cov<.999) ? 2 : 0);
    }
    return flags[i];
  };
  return {...H, surf, light,
    at,
    // Высоты вершин грани (мм) — одна поверхность на все грани: у общих точек соседей высота одна.
    vert(i){ return verts[i] || (verts[i]=Float32Array.from(faces[i].points,faces[i].kind==="dough" ? atDough : at)); },
    lightAt(i){
      if(Number.isNaN(lights[i])){
        const ps=faces[i].points; let x=0,y=0; for(const p of ps){x+=p.x;y+=p.y;}
        lights[i]=sample(light,{x:x/ps.length,y:y/ps.length},true).value||1;
      }
      return lights[i];
    },
    // Открытая начинка: верх ячейки под её центром — сама начинка.
    exposed(i){ return !!(flagsOf(i)&1); },
    // Край материала: хотя бы одна вершина стоит у пустой ячейки.
    rim(i){ return !!(flagsOf(i)&2); }
  };
}
// Боковая стенка грани: четырёхугольник между точками на высоте base и на высоте вершины.
// Рисуется до верхов — внутри конверта стенки закрывает поверхность, остаётся только край.
function drawFaceWalls(g,ps,screen,hs,zk,base){
  for(let k=0;k<ps.length;k++){
    const m=(k+1)%ps.length, a=screen(ps[k]), b=screen(ps[m]);
    const ha=hs[k]*zk, hb=hs[m]*zk, la=base ? base[k]*zk : 0, lb=base ? base[m]*zk : 0;
    if(ha-la<.2 && hb-lb<.2) continue;
    g.beginPath(); g.moveTo(a.x,a.y-la); g.lineTo(b.x,b.y-lb); g.lineTo(b.x,b.y-hb); g.lineTo(a.x,a.y-ha); g.closePath(); g.fill();
  }
}
function drawDishFaces(g,faces,screen,H,zk,shadow=true,shift=null){
  if(shift){ const base=screen; screen=(p,f)=>{ const o=f && shift.get(f); return base(o ? {x:p.x+o.x,y:p.y+o.y} : p); }; }
  // Тень конверта на стали и боковая сторона у его края. Отдельные заливки мелких
  // треугольников: один общий путь из тысяч наложенных контуров растеризуется в разы дольше.
  const tone=(f,k)=>{
    let color=f.kind==="filling" ? FILL_COLORS[Math.round(f.tone)%3] : dishCookColor(f);
    return k===1 ? color : color.map(c=>Math.min(255,c*k));
  };
  const top=(i,off)=>{
    const f=faces[i], p=screen(f.points[0],f); g.beginPath(); g.moveTo(p.x,p.y-off(0));
    for(let k=1;k<f.points.length;k++){ const q=screen(f.points[k],f); g.lineTo(q.x,q.y-off(k)); }
    g.closePath(); g.fill();
  };
  const faceScreen=f=>p=>screen(p,f);
  if(H){
    g.fillStyle="rgba(18,10,4,.34)";
    for(let i=0;i<faces.length && shadow;i++){
      if(faces[i].kind!=="dough" || H.zb[i]>.3) continue;
      const hs=H.vert(i), drop=zk*Math.max(...hs)*.25;
      if(drop<.3) continue;
      const ps=faces[i].points, p=screen(ps[0],faces[i]); g.beginPath(); g.moveTo(p.x+drop,p.y);
      for(let k=1;k<ps.length;k++){ const q=screen(ps[k],faces[i]); g.lineTo(q.x+drop,q.y); }
      g.closePath(); g.fill();
    }
    const crust=[];
    for(let i=0;i<faces.length;i++){
      if(faces[i].kind!=="dough" || !H.rim(i) || Math.max(...H.vert(i))<WALL_MIN_MM) continue;
      g.fillStyle=rgb(tone(faces[i],.66));
      drawFaceWalls(g,faces[i].points,faceScreen(faces[i]),H.vert(i),zk);
      if(H.zb[i]<=.3 && dish && dish.thermal) crust.push(i);
    }
    // Корочка низа по краю: нижняя полоса стенки — цвет стороны на стали. Так жарку снизу видно
    // сверху, как продавец смотрит на кромку (владелица 17.09: «держала долго — ничего не поджарилось»).
    for(const i of crust){
      const f=faces[i], hs=H.vert(i), band=hs.map(h=>Math.min(h,Math.max(1.8/Math.max(zk,1e-6),.4*h)));
      g.fillStyle=rgb(dishCookColor(f,f.turned ? 1 : 0,false).map(c=>c*.86));
      drawFaceWalls(g,f.points,faceScreen(f),band,zk);
    }
  }
  // Прозрачность накладывает настоящие слои друг на друга, а не смешивает каждый слой с
  // цветом тавы. Сырой тонкий лист чуть просвечивает; поверх объёма — почти непрозрачен.
  const paint=k=>{
    const f=faces[k];
    // Открытая начинка без светотени купола: это плоская россыпь ломтиков, а не горка.
    const flat=H && f.kind==="filling" && H.exposed(k);
    g.fillStyle=rgb(tone(f,H && !flat ? H.lightAt(k) : 1));
    g.globalAlpha=f.kind==="filling" ? 1
      : H ? Math.min(.95,.72+doughMM(f.tone)*.3)
      : Math.max(.48,Math.min(.92,.48+doughMM(f.tone)*.3));
    if(H){ const hs=H.vert(k); top(k,m=>hs[m]*zk); } else top(k,()=>0);
  };
  // Открытая начинка — всегда верх своей ячейки и выше соседнего теста, поэтому рисуется
  // последней: иначе низкий клапан за порцией закрашивал её верх (ревью толщины 16.09, п. 4).
  // Сперва стенки всех открытых кусочков, потом их верхи — стенка следующего кусочка не
  // ложится поверх уже нарисованного.
  const open=[];
  for(let k=0;k<faces.length;k++){
    if(H && faces[k].kind==="filling" && H.exposed(k)) open.push(k); else paint(k);
  }
  g.globalAlpha=1;
  for(const k of open){
    const f=faces[k], hs=H.vert(k), base=hs.map((h,m)=>Math.max(0,h-fillHeight(f,f.points[m])));
    g.fillStyle=rgb(tone(f,.88));
    drawFaceWalls(g,f.points,faceScreen(f),hs,zk,base);
  }
  for(const k of open) paint(k);
  g.globalAlpha=1;
  if(H && open.length) drawBananaSlices(g,faces,open,screen,H,zk);
}
// Ломтики поверх открытой начинки: по порции (и по куску стола) — обрезка по её открытым граням,
// чтобы ломтик не лёг на клапан. Раскладка ломтиков постоянна для порции (от её номера).
function drawBananaSlices(g,faces,open,screen,H,zk){
  const groups=new Map();
  for(const k of open){
    const f=faces[k]; if(!f.pc || !(f.pr>0)) continue;
    // Один кусок стола — один сдвиг: сравниваем точку со сдвигом куска и без него.
    const probe=screen(f.points[0],f), bare=screen(f.points[0]);
    const gk=f.source+"|"+f.turned+"|"+Math.round(probe.x-bare.x)+","+Math.round(probe.y-bare.y);
    if(!groups.has(gk)) groups.set(gk,{f,list:[]});
    groups.get(gk).list.push(k);
  }
  for(const {f,list} of groups.values()){
    g.save(); g.beginPath();
    for(const k of list){
      const ps=faces[k].points, hs=H.vert(k);
      const p=screen(ps[0],faces[k]); g.moveTo(p.x,p.y-hs[0]*zk);
      for(let m=1;m<ps.length;m++){ const q=screen(ps[m],faces[k]); g.lineTo(q.x,q.y-hs[m]*zk); }
      g.closePath();
    }
    g.clip();
    const R=f.pr, spots=[];
    for(let j=0;j<6;j++){ const a=(j*60+f.source*37)*Math.PI/180; spots.push([Math.cos(a)*R*.6,Math.sin(a)*R*.6,.42,j]); }
    spots.push([0,0,.44,6]);
    for(const [ox,oy,rk,j] of spots){
      const c={x:f.pc.x+ox,y:f.pc.y+oy}, r=R*rk, lift=H.at(c)*zk;
      const ring=[];
      for(let j=0;j<14;j++){ const a=j*Math.PI/7; const q=screen({x:c.x+Math.cos(a)*r,y:c.y+Math.sin(a)*r},f); ring.push(q); }
      g.beginPath(); g.moveTo(ring[0].x,ring[0].y-lift);
      for(let j=1;j<ring.length;j++) g.lineTo(ring[j].x,ring[j].y-lift);
      g.closePath();
      g.strokeStyle=BANANA_RIM; g.lineWidth=Math.max(.6,Math.hypot(ring[0].x-ring[7].x,ring[0].y-ring[7].y)*.06);
      g.fillStyle=rgb(BANANA_FLESH[(j+f.source)%3]); g.fill(); g.stroke();
      // семечки: три тёмные точки треугольником у середины
      g.fillStyle=BANANA_SEED;
      for(let j=0;j<3;j++){
        const a=(j*120+f.source*53)*Math.PI/180, q=screen({x:c.x+Math.cos(a)*r*.28,y:c.y+Math.sin(a)*r*.28},f);
        const d=Math.max(.5,Math.hypot(ring[0].x-ring[7].x,ring[0].y-ring[7].y)*.045);
        g.beginPath(); g.ellipse(q.x,q.y-lift,d,d*.7,0,0,Math.PI*2); g.fill();
      }
    }
    g.restore();
  }
}
// Полёт переворота — свойство картинки, как TOSS у переноса: лист сжимается вдоль маха
// (|cos πu|), поднимается и на середине пути показывает другую сторону. Торец в полёте
// не рисуется; материал меняется один раз — при посадке.
function drawDishFlight(g,sx,sy,pose){
  const F=dishFlight, n=F.next, u=Math.max(0,Math.min(1,(performance.now()-F.t0)/1000/F.T));
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
// Вмятина под пальцем: мягкое тёмное пятно на поверхности, глубже с силой прижима.
function drawPressDents(g,screen,H,zk,pose,sx,sy){
  for(const p of panPress){
    if(!(p.level>.02)) continue;
    const c=screen(p), lift=H ? H.at(p)*zk : 0;
    const rx=Math.hypot(screen({x:p.x+PRESS_R,y:p.y}).x-c.x,screen({x:p.x+PRESS_R,y:p.y}).y-c.y);
    const ry=Math.hypot(screen({x:p.x,y:p.y+PRESS_R}).x-c.x,screen({x:p.x,y:p.y+PRESS_R}).y-c.y);
    for(const [k,a] of [[1,.07],[.72,.08],[.45,.09]]){
      g.fillStyle=`rgba(58,32,12,${(a*p.level).toFixed(3)})`;
      g.beginPath(); g.ellipse(c.x,c.y-lift*(1-.25*p.level),rx*k,ry*k,0,0,Math.PI*2); g.fill();
    }
  }
}
function drawDish(g,sx,sy){
  let pose=dishPose(), moving=false;
  if(dishFlight){ drawDishFlight(g,sx,sy,pose); return; }
  if(dishMove){
    // Перелёт на стол: плавно от места на таве к позе нарезки, с небольшим подъёмом.
    const u=Math.max(0,Math.min(1,(performance.now()-dishMove.t0)/1000/dishMove.T)), e=u*u*(3-2*u), f=dishMove.from;
    pose={x:f.x+(pose.x-f.x)*e, y:f.y+(pose.y-f.y)*e-Math.sin(Math.PI*u)*.25*pose.scale, scale:f.scale+(pose.scale-f.scale)*e};
    moving=true;
  }
  const slide=dishGesture && dishGesture.slide;
  if(slide) pose={x:pose.x+slide.x*pose.scale, y:pose.y+slide.y*pose.scale, scale:pose.scale};
  const faces=dishGesture&&dishGesture.preview ? dishGesture.preview.faces : dish.faces;
  const screen=p=>{const x=pose.x+p.x*pose.scale,y=pose.y+p.y*pose.scale;return{x:prX(x,y)*sx,y:prY(x,y)*sy};};
  const lift=dishGesture && dish.mode==="fold" && dishGesture.anchor && !dishGesture.preview && !dishGesture.press ? dishGesture : null;
  const H=faces===dish.faces ? stackHeights(faces) : previewHeights(faces), zk=pose.scale*Z_EXAG/ROTI_R_MM*VIEW_UP*sy;
  if(lift) drawSpatula(g,screen,lift,sx,sy);
  drawDishFaces(g,faces,screen,H,zk,true,dishPieceShift(faces));
  if(lift) drawLiftedEdge(g,screen,lift,sx,sy);
  // Rebuild expensive boundary intersections only after a committed geometry
  // change. During a drag the existing flat preview remains immediate.
  if(!moving&&(dish.folds||dish.cuts.length)&&!(dishGesture&&dishGesture.preview)) drawDishSections(g,screen,faces,sx,sy,zk,H);
  if(dish.mode==="fold") drawPressDents(g,screen,H,zk,pose,sx,sy);
  if(dishGesture && !slide && dishGesture.zone!=="middle" && !(dishGesture.press && !dishGesture.moved)){
    const d=dishGesture, a=screen(d.anchor||d.start),b=screen(d.target||d.end);
    g.strokeStyle=dish.mode==="fold" ? "#eab562" : "#f5ead6";g.lineWidth=Math.max(1,2*sx);
    g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();
    // Короткое лезвие остаётся под пальцем во время реза.
    if(dish.mode==="cut"){g.fillStyle="#d1d2c9";g.fillRect(b.x-2,b.y-5,4,9);}
  }
}

// ─────────────────────────── построение листа
// Подготовка теста разбита на шаги (решение владельца 22.08.2026):
// шаг 1 — отрезанный от «колбаски» кусочек расплющивается пальцем до ~42% мишени
// (ровно та точка, где раньше стенд начинался); шаг 2 — растягивание шлепками.
const FLAT_START_FRAC = 0.075, START_FRAC = 0.17, TARGET_FRAC = 0.40;
let stepNo = 1;                                // текущий шаг стенда (step занят функцией физики)
let targetR = 1, startR = 1, step1R = 1;       // step1R = цель расплющивания (42% мишени)
let advancedAt = 0;                            // момент авто-перехода на шаг 2 (для баннера)
let gestureScale = 1;                          // масштаб жеста: фиксирован от экрана, не от роста листа
let FLAT_RATE = 0.55;                          // скорость расплющивания под пальцем
function build(){
  runTuneAtBuild = { ...TUNE };
  mixedTune = false;
  const z = zone("work");
  R0 = Math.min(z.w, z.h) * (stepNo===1 ? FLAT_START_FRAC : START_FRAC);
  startR = R0;
  targetR = Math.min(z.w, z.h) * TARGET_FRAC;
  step1R  = Math.min(z.w, z.h) * START_FRAC;
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
  conDeg = new Int32Array(N);
  for(const cc of c){ conDeg[cc.a]++; conDeg[cc.b]++; }

  // связи, инцидентные узлу — чтобы «дырка» рвала именно ячейку, а не весь лист
  const deg = new Int32Array(N);
  for(const cc of cons){ deg[cc.a]++; deg[cc.b]++; }
  edgeNodes = [];
  for(let i=0;i<N;i++) if(deg[i] < 8) edgeNodes.push(i);   // граница круга

  layoutPan();
  phase = "TABLE"; xf = null;
  dish = null; dishGesture = null; dishFlight = null; dishMove = null; syncDishUI(); syncStepButtons();
  panPress = []; domes = []; fatMap = null;
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

// ─────────────────────────── XPBD
function step(dt){
  // В руке и в полёте узлы заморожены: перенос — движение картинки, запекаемое при посадке.
  // На таве лист схватился и стоит — только жарится.
  if(action.state==="CARRY" || action.state==="TOSS"){ updateAction(dt); return; }
  if(dish){ updateDishFlight(); updateDishMove(); cookDish(dt); return; }
  if(phase==="PAN"){ cookStep(dt); return; }
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
    if(action.state==="LIFTING") liftPull();

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
    if(action.state==="LIFTING") liftPull();

    for(let i=0;i<N;i++){
      if(pinned[i]) continue;
      vx[i]=(prx[i]-px[i])/h; vy[i]=(pry[i]-py[i])/h;
      px[i]=prx[i]; py[i]=pry[i];
    }
  }
  plasticT = Math.max(0, plasticT - dt);
  if(stepNo===1 && action.state==="ARMED") pressFlatten(dt);
  if(stepNo===1 && sheetRadius() >= step1R){
    stepNo = 2; advancedAt = performance.now();          // кусок готов — дальше шлепки, тем же листом
    try{ localStorage.setItem("dough_step","2"); }catch(e){}
    syncStepButtons();
  }
  // Шаг 2 → 3 так же автоматически и ТЕМ ЖЕ ЛИСТОМ. Раньше перехода не было вовсе:
  // строка говорила «✓ готов · запятой на таву», а шаг оставался вторым, и нажатие
  // «на таву» вручную ПЕРЕСОБИРАЛО лист — растянутый своими руками уходил в мусор,
  // и на таву летел свежий. Это спорило с «как порвал, так и пожаришь»: дырки,
  // заработанные при растяжке, до тавы не доезжали (замечание владельца 08.09.2026).
  if(stepNo===2 && phase==="TABLE" && sheetRadius() >= targetR){
    stepNo = 3; advancedAt = performance.now();
    try{ localStorage.setItem("dough_step","3"); }catch(e){}
    syncStepButtons();
  }
  updateAction(dt);
  creep(dt);
  measureThickness();
  checkBreak(dt);
}

// Краткая тяга дуги хвата — ТОЛЬКО в LIFTING (≤80 мс). Постоянной буксировки
// больше нет: она и была источником «липкости» из живого теста. Палец по-прежнему
// тянет пружиной, а не телепортом, и дугу, а не точку.
const GRAB_K = 0.30;
function liftPull(){
  const dx = action.last.x - prx[action.edgeNode], dy = action.last.y - pry[action.edgeNode];
  for(let m=0;m<action.gripIds.length;m++){
    const n = action.gripIds[m], w = action.gripWeights[m];
    prx[n] += dx * GRAB_K * w;
    pry[n] += dy * GRAB_K * w;
  }
}
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

// ─── Жест «поднять и шлёпнуть» — ฟาด как единица действия (audit §5–6) ───
// Скорости в радиусах листа в секунду, чтобы пороги не зависели от экрана.
// Направление хорошего свайпа НЕ фиксировано до живого iPhone-теста: формула
// принимает и мах «от центра», и касательный (audit §6.3, оговорка).
let V_MIN = 1.6;             // минимальная скорость свайпа, R0/с
let ACTION_MIN = 1.4;        // порог направленной скорости outward + 0.55·tangent, R0/с
let IMPULSE_K = 0.5;         // сила удара на единицу направленной скорости (в R0)
let IMPULSE_MAX = 3.5;       // потолок силы, R0/с скорости узлов
const HOLD_MIN = 80;         // мс: раньше — не жест, а проезд пальца
const LIFT_MAX = 0.08;       // с: лимит фазы LIFTING
let PLASTIC_BOOST = 5.0;     // множитель текучести в окне удара
let SETTLE_SPEED = 12;       // px/с средней скорости листа: «успокоился»

function heldMs(){ return performance.now() - action.down.t; }

function clearAction(){
  action.state = "RESTING"; action.pointerId = null; action.edgeNode = -1;
  action.gripIds = []; action.gripWeights = []; action.impulse = 0;
  action.direction = {x:0,y:0}; action.velocity = {x:0,y:0};
  action.timer = 0; action.mul = 0; action.heldAtLift = 0;
  action.sweep = 0; action.lastDir = null; action.tailDir = {x:1,y:0}; action.toss = null;
}

function armAction(pointerId, p){
  const n = nodeNear(p.x, p.y);
  if(n < 0) return;
  // Решение прошлого маха стирается на входе в новый: иначе после неудачной запятой
  // в панели продолжает висеть «запятая 154° → тава» от прошлой удачной, и по строке
  // нельзя судить, что случилось сейчас (найдено проверкой 08.09).
  lastDecision = "—";
  action.state = "ARMED"; action.pointerId = pointerId; action.edgeNode = n;
  action.down = { x:p.x, y:p.y, t: performance.now() };
  action.last = { x:p.x, y:p.y, t: performance.now() };
  action.velocity = {x:0,y:0}; action.impulse = 0;
  if(stepNo!==1) updateGripFromHold();                 // на шаге 1 дуга хвата не нужна
}

// Шаг 1: прижатый палец расплющивает кусок — длины покоя растут сильнее всего
// под пальцем, слабее по всему куску. Толщина падает сама (площадь растёт).
function pressFlatten(dt){
  const over = sheetRadius() / step1R;
  if(over >= 1.0) return;
  const ease = over > 0.92 ? Math.max(0.15, (1.0-over)/0.08 * 0.5 + 0.15) : 1;
  const fx = action.last.x, fy = action.last.y;
  const sigma = Math.max(R0, sheetRadius()*0.55) * 1.15;
  for(let k2=0;k2<cons.length;k2++){
    const c2 = cons[k2]; if(c2.broken) continue;
    const mx = (px[c2.a]+px[c2.b])/2 - fx, my = (py[c2.a]+py[c2.b])/2 - fy;
    const d2 = (mx*mx + my*my)/(sigma*sigma);
    const w = Math.exp(-d2)*0.85 + 0.15;
    c2.rest *= 1 + FLAT_RATE * w * ease * dt;
  }
}

function updateGripFromHold(){
  const t = Math.max(0, Math.min(1, (heldMs() - 100) / 150));
  const st = t*t*(3-2*t);                            // smoothstep
  const gp = gripArc(action.edgeNode, GRIP_MIN + (GRIP_MAX - GRIP_MIN) * st);
  action.gripIds = gp.ids; action.gripWeights = gp.ws; action.mul = gp.mul;
}

function updateActionMove(p){
  if(action.state === "LIFTING" || action.state === "CARRY"){   // палец ещё ведёт дугу
    const nowT = performance.now();
    const dtm = Math.max(0.008, (nowT - action.last.t)/1000);
    action.velocity = { x:(p.x - action.last.x)/dtm, y:(p.y - action.last.y)/dtm };
    action.last = { x:p.x, y:p.y, t:nowT };
    trackSweep();
    if(action.state === "CARRY"){ xf.ox = p.x - action.carryFrom.x; xf.oy = p.y - action.carryFrom.y; }
    return;
  }
  if(action.state !== "ARMED") return;
  if(stepNo===1){                                      // шаг 1: палец только ведёт точку прижима
    action.last = { x:p.x, y:p.y, t: performance.now() };
    return;
  }
  const nowT = performance.now();
  const dtm = Math.max(0.008, (nowT - action.last.t)/1000);
  action.velocity = { x:(p.x - action.last.x)/dtm, y:(p.y - action.last.y)/dtm };
  action.last = { x:p.x, y:p.y, t:nowT };
  updateGripFromHold();

  const c = centerOfSheet();
  const rl = Math.hypot(px[action.edgeNode]-c.x, py[action.edgeNode]-c.y) || 1;
  const rx = (px[action.edgeNode]-c.x)/rl, ry = (py[action.edgeNode]-c.y)/rl;
  const outward = Math.max(0, action.velocity.x*rx + action.velocity.y*ry);
  const tangent = Math.abs(rx*action.velocity.y - ry*action.velocity.x);
  const speed = Math.hypot(action.velocity.x, action.velocity.y);
  const drive = (outward + 0.55*tangent) / Math.max(1, gestureScale);

  if(heldMs() >= HOLD_MIN && speed/Math.max(1,gestureScale) >= V_MIN && drive >= ACTION_MIN){
    action.state = "LIFTING";
    if(stepNo === 3 && phase === "TABLE") tossTry++;   // попытка засчитывается с момента маха
    action.timer = LIFT_MAX;
    action.heldAtLift = Math.round(heldMs());
    const sl = speed || 1;
    action.direction = { x:action.velocity.x/sl, y:action.velocity.y/sl };
    action.impulse = Math.min(IMPULSE_MAX, IMPULSE_K * drive);   // в R0-единицах
    action.sweep = 0; action.lastDir = { ...action.direction }; action.tailDir = { ...action.direction };
  }
}

function releaseAction(){
  if(action.state === "ARMED"){ clearAction(); return; }   // медленное отпускание — ничего
  if(action.state === "LIFTING"){ if(commaLike()) endCarry(); else toFlying(); return; }   // бросок
  if(action.state === "CARRY"){ endCarry(); return; }      // запятая дописана — решаем, куда летит
  // FLYING/IMPACT/SETTLING/TOSS: жест автономен; поздний pointerup его не убивает.
  // (Псевдокод аудита здесь очищал бы состояние — это обрывало бы удар на лету.)
  action.pointerId = null;
}
function toFlying(){
  action.state = "FLYING";
  action.timer = 0.08 + Math.random()*0.08;                // 80–160 мс до удара
}

function updateAction(dt){
  if(action.state === "LIFTING"){
    action.timer -= dt;
    if(action.timer <= 0){
      // Прямой мах бьёт через 80 мс, не дожидаясь отпускания (аудит). Если за эти
      // 80 мс палец уже заметно повернул — это запятая: лист поднимается в руку.
      if(commaLike() && action.pointerId !== null) enterCarry(); else toFlying();
    }
  } else if(action.state === "CARRY"){
    action.timer -= dt;
    const stalled = performance.now() - action.last.t > 90;   // рука остановилась — дуга кончилась
    if(action.timer <= 0 || stalled) endCarry();
  } else if(action.state === "TOSS"){
    action.timer -= dt;
    updateToss();
    if(action.timer <= 0) land();
  } else if(action.state === "FLYING"){
    action.timer -= dt;
    if(action.timer <= 0) impactAction();
  } else if(action.state === "SETTLING"){
    action.timer -= dt;
    // Ранний выход по скорости — только со второй половины окна, иначе метрики
    // жеста записываются до того, как лист дорос до новых длин покоя.
    if(action.timer <= 0 || (action.timer < 0.15 && sheetSpeed() < SETTLE_SPEED)) finalizeGesture();
  }
}

// ─── Перенос на таву — «запятая» (идея владельца 25.08.2026) ───
// Тот же глагол «поднять и шлёпнуть», но мах не прямой, а дугой: рука подхватывает лист,
// ведёт его по кругу, и хвост дуги, смотрящий на таву, отправляет его в полёт. В воздухе
// лист поворачивается тем сильнее, чем круче была дуга, садится на таву и начинает жариться.
// Прямой мах к таве переносом НЕ считается — это шлепок; естественно ли это, решает живой тест.
const COMMA_MIN_SWEEP = 15 * Math.PI/180;   // столько поворота за первые 80 мс уже отличает дугу от прямого маха
const COMMA_SWEEP     = 40 * Math.PI/180;   // итоговый поворот, чтобы бросок считался запятой
const COMMA_CONE      = 60 * Math.PI/180;   // хвост запятой должен смотреть на таву в пределах этого угла
const COMMA_MAX       = 0.45;               // с: дольше вести — это уже не бросок, лист опускается

// Копим знаковый угол между последовательными направлениями скорости (только пока
// палец движется быстро); «хвост» — сглаженное направление последних ~60 мс.
function trackSweep(){
  const sp = Math.hypot(action.velocity.x, action.velocity.y);
  if(sp < 0.35 * V_MIN * gestureScale) return;
  const d = { x:action.velocity.x/sp, y:action.velocity.y/sp };
  if(action.lastDir){
    const cr = action.lastDir.x*d.y - action.lastDir.y*d.x, dp = action.lastDir.x*d.x + action.lastDir.y*d.y;
    action.sweep += Math.atan2(cr, dp);
  }
  action.lastDir = d;
  const tx = action.tailDir.x*0.5 + d.x*0.5, ty = action.tailDir.y*0.5 + d.y*0.5;
  const tl = Math.hypot(tx,ty) || 1;
  action.tailDir = { x:tx/tl, y:ty/tl };
}
function commaLike(){ return Math.abs(action.sweep) >= COMMA_MIN_SWEEP; }

function enterCarry(){
  const c = centerOfSheet();
  action.state = "CARRY"; action.timer = COMMA_MAX;
  action.carryFrom = { x:action.last.x, y:action.last.y };
  xf = { cx:c.x, cy:c.y, ox:0, oy:0, th:0, lift: sheetRadius()*0.10 };
}
function endCarry(){
  const c = centerOfSheet();
  if(!xf) xf = { cx:c.x, cy:c.y, ox:0, oy:0, th:0, lift:0 };   // запятая уложилась в 80 мс
  const hx = c.x + xf.ox, hy = c.y + xf.oy;                     // где лист сейчас, в руке
  const dir = action.tailDir;
  const tpx = panC.x - hx, tpy = panC.y - hy, tl = Math.hypot(tpx,tpy) || 1;
  const cosA = (dir.x*tpx + dir.y*tpy)/tl;
  const sweepDeg = Math.round(action.sweep*180/Math.PI);
  const transfer = phase==="TABLE" && Math.abs(action.sweep) >= COMMA_SWEEP && cosA >= Math.cos(COMMA_CONE);
  if(transfer){
    // Размер листа в самом решении: закинуть недотянутый лист МОЖНО (отказов почти не бывает),
    // но тогда это должно читаться как выбор, а не как случайность.
    const pctNow = Math.round(sheetRadius()/targetR*100);
    lastDecision = `запятая ${sweepDeg}° → тава · лист ${pctNow}%`;
    startToss(hx, hy, dir, tl); return;
  }
  // Не к таве: это шлепок с дугой — лист опускается там, где его отпустили, и бьётся.
  lastDecision = `дуга ${sweepDeg}° → шлепок`;
  dropCarry();
  action.direction = { x:dir.x, y:dir.y };
  toFlying();
}
// Опустить лист из руки на стол там, где он сейчас (в пределах рабочей зоны), без удара.
function dropCarry(){
  const c = centerOfSheet();
  if(!xf){ clearAction(); return; }
  const z = zone("work"), r = sheetRadius();
  const nx = Math.max(z.x + r*0.6, Math.min(z.x + z.w - r*0.6, c.x + xf.ox));
  const ny = Math.max(z.y + r*0.4, Math.min(z.y + z.h - r*0.4, c.y + xf.oy));
  bakeTransform(nx - c.x, ny - c.y, 0);
  xf = null;
  if(action.state === "CARRY" && action.pointerId === null) clearAction();
}
function startToss(hx, hy, dir, distToPan){
  // Куда сядет: бросок летит по хвосту запятой ровно на расстояние до тавы; промах
  // от центра сохраняется, но не дальше 30 % радиуса — мимо тавы лист не пролетит.
  const ax = hx + dir.x*distToPan - panC.x, ay = hy + dir.y*distToPan - panC.y;
  const al = Math.hypot(ax,ay) || 1, cap = PAN_R*0.30, k = Math.min(1, cap/al);
  const spin = Math.max(-1.4, Math.min(1.4, action.sweep*0.55));   // «немножко вращается»
  action.state = "TOSS"; action.pointerId = null;
  action.toss = { x0:hx, y0:hy, x1:panC.x + ax*k, y1:panC.y + ay*k, spin,
    T: 0.34 + 0.16*Math.min(1, distToPan/(cv.width*0.5)), sweep: action.sweep, aim: al/PAN_R };
  action.timer = action.toss.T;
}
function updateToss(){
  const t = action.toss, u = Math.max(0, Math.min(1, 1 - action.timer/t.T));
  const e = u*u*(3-2*u);                                        // плавный разгон и посадка
  xf.ox = t.x0 + (t.x1-t.x0)*e - xf.cx;
  xf.oy = t.y0 + (t.y1-t.y0)*e - xf.cy;
  xf.th = t.spin * e;
  xf.lift = sheetRadius()*(0.10 + 0.38*Math.sin(Math.PI*u));    // подлетает и опускается
}
function land(){
  const t = action.toss;
  bakeTransform(t.x1 - xf.cx, t.y1 - xf.cy, t.spin);
  xf = null; phase = "PAN"; tossOk++;
  // Недотянутый лист тоже разрешено перенести. В step() эта ветка была недостижима:
  // TOSS и PAN возвращаются раньше. Обновляем шаг в момент самой посадки.
  if(stepNo < 3){
    stepNo = 3;
    try{ localStorage.setItem("dough_step","3"); }catch(e){}
    syncStepButtons();
  }
  measureThickness();
  audioPanLand();
  gestures.push({ ...measurementContext(), kind:"toss", sweep_deg: Math.round(t.sweep*180/Math.PI),
    spin_deg: Math.round(t.spin*180/Math.PI), aim: +t.aim.toFixed(2),
    flight_ms: Math.round(t.T*1000), sheet_pct: Math.round(sheetRadius()/targetR*100),
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
const COOK_BASE = 0.008, FRY_SPEEDS = {40:6, 60:3.5, 85:2};
let FRY_SECONDS = 60;
let DRY_RATE = 0.1625;                         // 1/с: лист 0,5 мм схватывается за 2–3 с и сохнет за ~7 с
let COOK_RATE = COOK_BASE*FRY_SPEEDS[60];      // 1/с после сушки: золото первой стороны пробы к ~30 с
function panHeat(r){
  if(r < 0.45) return 0.90 + 0.10*(r/0.45);                     // центр внутри кольца пламени — чуть слабее
  if(r < 0.70) return 1.00 - 0.25*((r-0.45)/0.25);              // горб на среднем радиусе
  return Math.max(0.5, 0.75 - 0.20*((r-0.70)/0.30));            // прохладный борт
}
function cookStep(dt){
  for(let i=0;i<N;i++){
    if(conDeg[i] <= 0) continue;
    const r = Math.hypot(px[i]-panC.x, py[i]-panC.y)/PAN_R;
    // Масло: скромные +5 % равномерно. Центральной добавки здесь БЫЛА +10 % при r<0.35 —
    // она гасила весь профиль panHeat: разница между центром и горбом на среднем радиусе
    // падала с 11 % до 0,3 %, то есть кольцевая горелка переставала быть видна, и лист
    // румянился ровно — против собственного фактчека строкой выше.
    const heat = panHeat(r) * 1.05 * contactF[i];
    if(dry[i] < 1){
      const thin = Math.max(0.2, Math.min(2.0, 0.10/Math.max(0.05, thick[i])));
      dry[i] = Math.min(1, dry[i] + dt * DRY_RATE * heat * thin);
    } else {
      cook[i] += dt * COOK_RATE * heat;
    }
  }
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

let SLAP_GROW = 0.075;           // пластическое растяжение за удар на единицу силы
let TEAR_I = 2.9;                // с этой силы шлепок опасен…
let TEAR_THIN = 0.20;            // …если лист уже истончился ниже этого

// Рваная дырка на дальней стороне по направлению маха: рвём связи небольшого
// пятна с неровным краем. Дырка остаётся навсегда — это узор, не наказание.
function punchHole(direction){
  const c = centerOfSheet(), sr = sheetRadius();
  const pxT = c.x + direction.x * sr * 0.8, pyT = c.y + direction.y * sr * 0.8;
  let best = 0, bd = 1e18;
  for(let i=0;i<N;i++){
    const d = (px[i]-pxT)**2 + (py[i]-pyT)**2;
    if(d < bd){ bd = d; best = i; }
  }
  const rad = (Math.max(R0, sheetRadius())*2/(GRID-1)) * 2.4;   // пятно в шагах ТЕКУЩЕЙ сетки
  let torn = 0;
  for(let k2=0;k2<cons.length;k2++){
    const c2 = cons[k2]; if(c2.broken) continue;
    const mx = (px[c2.a]+px[c2.b])/2 - px[best], my = (py[c2.a]+py[c2.b])/2 - py[best];
    const d = Math.hypot(mx,my);
    if(d < rad * (0.65 + Math.random()*0.5)){ if(breakCon(c2)) torn++; }  // неровный край
  }
  if(torn) onTear();
}
function impactAction(){
  action.state = "IMPACT";
  const c = centerOfSheet();
  applySlapImpulse(action.impulse * gestureScale, action.direction, c);
  // Сработал стоп-сигнал audit §6.6: скоростной импульс в одиночку не растил площадь —
  // жёсткий решатель гасил растяжение раньше, чем пластичность его захватывала
  // (замер: diameterRatio 0.99–1.00 при любом ударе). Чиним связь по предписанию
  // аудита: удар даёт одноразовое пластическое растяжение длин покоя с той же
  // пространственной формулой весов, что у импульса. Скорости остаются как рывок и звук.
  plasticStretch(action.impulse, action.direction, c);
  // Дырка рождается из перестарательности: сильный шлепок по уже тонкому листу
  // рвёт дальнюю сторону. Глобальный порог толщины стили не разводит — средний и
  // жёсткий стили приходят к одинаковой толщине (замер: 0.108 против 0.083),
  // поэтому судим по паре «сила удара × текущая тонкость» (audit: «слабый,
  // хороший, опасный результат»).
  if(action.impulse >= TEAR_I){
    let tmin = 1; for(let i=0;i<N;i++) if(thick[i]<tmin) tmin = thick[i];
    if(tmin < TEAR_THIN) punchHole(action.direction);
  }
  audioSlap(action.impulse);
  plasticT = 0.15;
  action.timer = 0.30;             // успокоение = релаксация в новые длины покоя
  action.state = "SETTLING";
}

function plasticStretch(I, direction, center){
  const over = sheetRadius() / targetR;
  if(over > 1.25) return;                            // предел растяжимости — общий для всех путей роста
  const ease = over > 1.0 ? Math.max(0, 1 - (over-1.0)/0.25) : 1;
  const sr = Math.max(1, sheetRadius());
  for(let k2=0;k2<cons.length;k2++){
    const c2 = cons[k2]; if(c2.broken) continue;
    const mx = (px[c2.a]+px[c2.b])/2 - center.x, my = (py[c2.a]+py[c2.b])/2 - center.y;
    const dl = Math.hypot(mx,my) || 1;
    const radial = Math.max(0, (mx/dl)*direction.x + (my/dl)*direction.y);
    const edgeBias = Math.max(0, Math.min(1, dl/sr));
    const w = 0.35 + 0.45*edgeBias + 0.20*radial;
    c2.rest *= 1 + SLAP_GROW * I * w * ease;
  }
}

// audit §6.5 дословно: не симуляция удара, а явная игровая модель —
// быстрый жест даёт краткое, широкое и наблюдаемое расправление.
function applySlapImpulse(I, direction, center){
  const sr = Math.max(1, sheetRadius());
  for(let i=0;i<N;i++){
    const ddx = px[i]-center.x, ddy = py[i]-center.y;
    const dl = Math.hypot(ddx,ddy) || 1;
    const dx = ddx/dl, dy = ddy/dl;
    const radial = Math.max(0, dx*direction.x + dy*direction.y);
    const edgeBias = Math.max(0, Math.min(1, dl/sr));
    // Рыхлый край (мало живых связей) не хлещет наружу: бахрома у дырок получала
    // полный импульс и улетала, задирая радиус.
    const loose = conDeg ? Math.min(1, conDeg[i]/3) : 1;
    const w = (0.35 + 0.45*edgeBias + 0.20*radial) * loose;
    vx[i] += dx * I * w;
    vy[i] += dy * I * w;
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
  gestures.push({
    ...measurementContext(),
    kind: "slap",
    sweep_deg: Math.round(action.sweep*180/Math.PI),
    impulse: +action.impulse.toFixed(2),
    held_ms: action.heldAtLift,
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
  // Тесто под руками выравнивается: толстые места отдают тонким. Без этого
  // жёсткий лист рвался у точки захвата на 90% пути, так и не дойдя до цели.
  const k = Math.min(0.5, 3.2*dt);
  if(!evenBuf || evenBuf.length !== cons.length) evenBuf = new Float32Array(cons.length);
  let sum = 0, n = 0;
  for(let i=0;i<cons.length;i++){ const c=cons[i]; if(c.broken) continue;
    const d = Math.hypot(px[c.b]-px[c.a], py[c.b]-py[c.a]);
    evenBuf[i] = d / c.rest; sum += evenBuf[i]; n++; }
  if(!n) return;
  const mean = sum/n;
  for(let i=0;i<cons.length;i++){ const c=cons[i]; if(c.broken) continue;
    // перетянутые связи слегка удлиняют покой, недотянутые — укорачивают
    c.rest *= 1 + (evenBuf[i] - mean)/Math.max(0.2, mean) * 0.02 * k;
  }
}
function creep(dt){
  if(sheetRadius() > targetR*1.25) return;          // предел растяжимости — общий с раскруткой
  evenOut(dt);
  // В окне удара тесто на порядок пластичнее: расправление закрепляется в длинах
  // покоя; вне окна лист упругий (audit, группа B: creep).
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
function audioInit(){
  if(AC) return;
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
      crackleNext += (0.9 - 0.75*d) * (1 - 0.5*Math.min(1,gold)) * (0.4 + Math.random()*1.2);
    }
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
// Посадка на таву: глухой шлепок и сразу волна шипения — маргарин встретил сырое тесто.
function audioPanLand(){
  if(!AC || condition==="sight") return;
  audioSlap(2.2);
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
function evTime(e){
  const now=performance.now(), t=e && e.timeStamp;
  return Number.isFinite(t) && Math.abs(t-now)<1000 ? t : now;
}
function onDown(id, cx, cy, t){
  if(performance.now()<inputQuietUntil) return;
  dbgDown++;
  // iOS усыпляет AudioContext в фоне. Касание блюда тоже будит звук, иначе после
  // возврата шипение на таве молчало бы до «заново».
  if(dish){ audioInit(); if(AC && AC.state==="suspended") AC.resume();
            beginDishGesture(id,toLocal(cx,cy),{x:cx,y:cy},t); return; }
  if(action.pointerId !== null) return;              // один активный палец; второй игнорируется (audit §5)
  if(action.state === "SETTLING") finalizeGesture(); // быстрый повторный тап не ждёт хвоста успокоения
  if(action.state !== "RESTING") return;             // остальные фазы доигрывают автономно
  const tDown = performance.now();
  audioInit(); if(AC && AC.state==="suspended") AC.resume();
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
  armAction(id, p);                                  // только выбор края: тесто НЕ двигается
}
function onMove(id, cx, cy, t){
  if(dishGesture && dishGesture.id===id){ dbgMove++; moveDishGesture(toLocal(cx,cy),{x:cx,y:cy},t); return; }
  if(action.pointerId !== id) return;
  dbgMove++;
  updateActionMove(toLocal(cx, cy));
}
function onUp(id, cx, cy, t){
  if(dishGesture && dishGesture.id===id){
    // touchend несёт последнюю точку: быстрый участок может прийти только в нём.
    const L=dishGesture.samples[dishGesture.samples.length-1];
    if(Number.isFinite(cx) && Number.isFinite(cy) && (cx!==L.x || cy!==L.y)) moveDishGesture(toLocal(cx,cy),{x:cx,y:cy},t);
    endDishGesture(t); return;
  }
  if(action.pointerId !== id) return;
  releaseAction();
}
function onCancel(id){
  if(dishGesture && dishGesture.id===id){ releasePress(dishGesture); dishGesture=null; return; }
  if(action.pointerId !== id) return;
  // Отмена всегда возвращает покой из ARMED/LIFTING (audit §5);
  // автономные фазы (FLYING и дальше) доигрывают сами и очистятся за ≤0.4 с.
  if(action.state === "CARRY"){ action.pointerId = null; dropCarry(); }
  else if(action.state === "ARMED" || action.state === "LIFTING") clearAction();
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
function inUI(t){ return !!(t && t.closest && t.closest("#panel, #card")); }

window.addEventListener("touchstart", e=>{
  rawTouch++;
  if(inUI(e.target)) return;
  e.preventDefault(); dbgKind = "touch";
  const at = evTime(e);
  for(const t of e.changedTouches) onDown("t"+t.identifier, t.clientX, t.clientY, at);
}, {passive:false, capture:true});

window.addEventListener("touchmove", e=>{
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
  dbgKind = "мышь"; onDown("p"+e.pointerId, e.clientX, e.clientY, evTime(e));
}, true);
window.addEventListener("pointermove", e=>{
  if(e.pointerType === "touch" || inUI(e.target)) return;
  onMove("p"+e.pointerId, e.clientX, e.clientY, evTime(e));
}, true);
window.addEventListener("pointerup", e=>{ onUp("p"+e.pointerId, e.clientX, e.clientY, evTime(e)); }, true);
window.addEventListener("pointercancel", e=>{ onCancel("p"+e.pointerId); }, true);
// Уход в фон — та же отмена: не оставлять взведённый жест (audit §5).
addEventListener("blur", ()=>{
  releasePress(dishGesture); dishGesture=null;
  if(action.state==="CARRY"){ action.pointerId = null; dropCarry(); }
  else if(action.state==="ARMED"||action.state==="LIFTING") clearAction();
});

addEventListener("keydown", e=>{
  if(e.code==="Space"){ e.preventDefault(); pressNow(); }
  if(e.code==="KeyR"){ reset(); }
});
document.getElementById("tear").addEventListener("click", pressNow);
document.getElementById("reset").addEventListener("click", reset);
// Техническое снятие — тот же перелёт на стол, что и у жеста.
document.getElementById("cutMode").addEventListener("click", ()=>startRemoval());
document.getElementById("undoDish").addEventListener("click", undoDish);
document.getElementById("serveDish").addEventListener("click", serveDish);
document.getElementById("nextRoti").addEventListener("click", nextRoti);
// Технический вход переворота (как «к нарезке»): лист уходит от игрока и ложится обратно.
document.getElementById("flipDish").addEventListener("click", ()=>startFlip({x:0,y:-1},{x:0,y:0}));
document.getElementById("foldSample").addEventListener("click", ()=>{
  audioInit(); if(AC && AC.state==="suspended") AC.resume();
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
  1: "шаг 1: прижимай кусочек — расплющишь до пунктира",
  2: "шаг 2: возьми край, миг подержи, резко махни — шлепок. Порвётся — останется рваный узор, так и пожарим",
  3: "шаг 3: возьми край и круговым махом-«запятой» перекинь на таву — полетит, повернётся, зашипит"
};
function syncStepButtons(){
  document.querySelectorAll("[data-s]").forEach(b=>b.classList.toggle("on", +b.dataset.s === stepNo));
  hintEl.textContent = HINTS[stepNo] || "";
  if(dish) syncDishUI();
}
document.querySelectorAll("[data-s]").forEach(b=>b.addEventListener("click", ()=>{
  const to = +b.dataset.s;
  // Кнопка шага значила «дай новый кусочек на этом шаге» и пересобирала лист ВСЕГДА —
  // даже когда её жали на уже горящем шаге. После автоперехода «на таву» загорается сама,
  // привычка нажать осталась с тех пор, когда другого пути туда не было, — и растянутый
  // лист с дырками улетал в мусор (замер 08.09: 25 % экрана перерисовывалось разом,
  // tornAt 163472 → 0). Теперь пересборка только там, где она осмысленна: назад или
  // вперёд на лист, который до этого шага ещё не дорос. Свежий кусочек даёт «заново».
  const ready = to === 1 ? false
              : to === 2 ? sheetRadius() >= step1R
              :            sheetRadius() >= targetR;
  const keep = to === stepNo || (to > stepNo && ready && phase === "TABLE");
  stepNo = to;
  try{ localStorage.setItem("dough_step", String(stepNo)); }catch(e){}
  syncStepButtons();
  if(!keep) reset();
}));
try{ const st0 = +(localStorage.getItem("dough_step")||1); if(st0===1||st0===2||st0===3) stepNo = st0; }catch(e){}
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
// Доля «низа сквозь лист» — условность отрисовки для пробы; переживает перезагрузку.
try{ const k=localStorage.getItem("dough_through"); if(k!==null && [0,0.3,0.6].includes(+k)) SHOW_THROUGH=+k; }catch(e){}
document.querySelectorAll("[data-k]").forEach(b=>{
  b.classList.toggle("on", +b.dataset.k===SHOW_THROUGH);
  b.addEventListener("click",()=>{
    SHOW_THROUGH=+b.dataset.k;
    try{ localStorage.setItem("dough_through", String(SHOW_THROUGH)); }catch(e){}
    document.querySelectorAll("[data-k]").forEach(x=>x.classList.toggle("on",x===b));
    setTools(false);
  });
});
// Сила прижима — прибор для пробы (разбор 16.09: 0,35 из плана против 1 — видно ли пятно).
try{ const k=localStorage.getItem("dough_press"); if(k!==null && [0.35,1].includes(+k)) PRESS_GAIN=+k; }catch(e){}
document.querySelectorAll("[data-p]").forEach(b=>{
  b.classList.toggle("on", +b.dataset.p===PRESS_GAIN);
  b.addEventListener("click",()=>{
    PRESS_GAIN=+b.dataset.p;
    try{ localStorage.setItem("dough_press", String(PRESS_GAIN)); }catch(e){}
    document.querySelectorAll("[data-p]").forEach(x=>x.classList.toggle("on",x===b));
    setTools(false);
  });
});
// Скорость жарки — прибор для пробы (владелица 17.09: «хочется подольше»); переживает перезагрузку.
function setFrySeconds(sec){
  if(!FRY_SPEEDS[sec]) return;
  FRY_SECONDS=sec; COOK_RATE=COOK_BASE*FRY_SPEEDS[sec];
  document.querySelectorAll("[data-f]").forEach(x=>x.classList.toggle("on",+x.dataset.f===sec));
}
try{ const f=localStorage.getItem("dough_fry"); if(f!==null) setFrySeconds(+f); }catch(e){}
document.querySelectorAll("[data-f]").forEach(b=>{
  b.classList.toggle("on", +b.dataset.f===FRY_SECONDS);
  b.addEventListener("click",()=>{
    setFrySeconds(+b.dataset.f);
    try{ localStorage.setItem("dough_fry", String(FRY_SECONDS)); }catch(e){}
    setTools(false);
  });
});
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

document.getElementById("dump").addEventListener("click", async ()=>{
  // Старым записям не приписываем сегодняшние настройки. Их отсутствие означает
  // неизвестный контекст; новые записи несут собственный снимок build/tune.
  const txt = JSON.stringify({ formatVersion:2, exportedAt:new Date().toISOString(),
    current:measurementContext(), tears:log, gestures }, null, 2);
  const btn = document.getElementById("dump");
  try{ await navigator.clipboard.writeText(txt); btn.textContent = `скопировано (${log.length}+${gestures.length})`; }
  catch(e){ console.log(txt); btn.textContent = "лог в консоли"; }
  setTimeout(()=>btn.textContent = "скопировать лог", 1800);
});

// ─────────────────────────── рендер
// Тесто лежит на тёмной столешнице. Толстое — непрозрачное и бежевое; растянутое
// истончается и НАЧИНАЕТ ПРОСВЕЧИВАТЬ, то есть темнеет к цвету стола.
// Это и есть «растянуть почти до прозрачности» из v3, и это же — читаемый сигнал «сейчас порвётся».
const DOUGH = [236, 219, 186], TABLE = [36, 28, 19];
function mix(t){                                   // t: 1 толстое → 0 тонкое
  // Пол просвечивания: самое тонкое тесто остаётся чуть светлее стола, иначе
  // дырка (настоящий стол и тень под ним) неотличима от тонкого места.
  const k = 0.14 + Math.pow(Math.max(0,Math.min(1,t)), 0.85) * 0.86;
  return [ Math.round(TABLE[0]+(DOUGH[0]-TABLE[0])*k),
           Math.round(TABLE[1]+(DOUGH[1]-TABLE[1])*k),
           Math.round(TABLE[2]+(DOUGH[2]-TABLE[2])*k) ];
}
const PAL = Array.from({length:16}, (_,i)=>{ const c = mix(i/15); return `rgb(${c[0]},${c[1]},${c[2]})`; });
function quant(t){ return PAL[Math.max(0,Math.min(15, Math.round(t*15)))]; }

// На таве тонкое тесто просвечивает уже не столом, а дном тавы, и поверх ложится прожарка:
// сырое → золотистое → коричневое → тёмное. Тёмное — не провал (см. docs/frying-mechanics.md).
const PAN_BG = [66, 58, 48];
const GOLD = [232,196,110], BROWN = [196,128,52], DARK = [122,66,26], CHAR = [62,34,16];
function lerp3(a, b, k){ return [ a[0]+(b[0]-a[0])*k, a[1]+(b[1]-a[1])*k, a[2]+(b[2]-a[2])*k ]; }
function mixOn(t, bg){
  const k = 0.14 + Math.pow(Math.max(0,Math.min(1,t)), 0.85) * 0.86;
  return lerp3(bg, DOUGH, k);
}
function cookColor(base, c){
  if(c <= 0) return base;
  if(c < 0.4) return lerp3(base, GOLD, c/0.4);
  if(c < 0.8) return lerp3(GOLD, BROWN, (c-0.4)/0.4);
  if(c < 1.2) return lerp3(BROWN, DARK, (c-0.8)/0.4);
  return lerp3(DARK, CHAR, Math.min(1, (c-1.2)/0.5));
}
const rgb = (c)=>`rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const palPan = new Map();   // 16 ступеней толщины × 16 ступеней прожарки — для пиксельных вариантов
function quantOn(t, c){
  const tq = Math.max(0,Math.min(15, Math.round(t*15))), cq = Math.max(0,Math.min(15, Math.round(c/1.7*15)));
  const key = tq*16 + cq;
  let s = palPan.get(key);
  if(!s){ s = rgb(cookColor(mixOn(tq/15, PAN_BG), cq/15*1.7)); palPan.set(key, s); }
  return s;
}
function shadeOn(t, c){ return rgb(cookColor(mixOn(t, PAN_BG), c)); }

// Картинка листа в руке и в полёте: узлы физики стоят, а рисуем их со сдвигом,
// поворотом и подъёмом из xf.
let vxBuf=null, vyBuf=null;
function viewX(){
  if(!vxBuf || vxBuf.length!==N){ vxBuf = new Float32Array(N); vyBuf = new Float32Array(N); }
  const c = Math.cos(xf.th), s = Math.sin(xf.th);
  for(let i=0;i<N;i++){
    const dx = px[i]-xf.cx, dy = py[i]-xf.cy;
    vxBuf[i] = xf.cx + xf.ox + dx*c - dy*s;
    vyBuf[i] = xf.cy + xf.oy + dx*s + dy*c - xf.lift;
  }
  return vxBuf;
}
function viewY(){ return vyBuf; }

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
  drawTable(g, sx, sy);

  if(dish) drawDish(g,sx,sy);
  else {   // режим «только звук», в котором поле не рисовалось вовсе, снят 08.09.2026
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
    const X = xf ? viewX() : px, Y = xf ? viewY() : py;
    if(xf){
      const gx = xf.cx + xf.ox, gy = xf.cy + xf.oy, gr = sheetRadius()*1.03;
      g.fillStyle = "rgba(6,3,1,0.42)";
      g.beginPath();
      g.ellipse(prX(gx,gy)*sx+ox, prY(gx,gy)*sy+oy, gr*sx, gr*TILT*sy, 0, 0, Math.PI*2);
      g.fill();
    }
    const onPan = phase === "PAN";
    for(let q=0;q<quads.length;q++){
      const qc = quadCons[q];
      const [a,b2,c,d] = quads[q];
      const torn = qc[0].broken || (qc[1]&&qc[1].broken) || (qc[2]&&qc[2].broken) || (qc[3]&&qc[3].broken);
      let t=(thick[a]+thick[b2]+thick[c]+thick[d])/4;
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
        // Тонкий, но целый лист остаётся видимым. Дыру задают разорванные связи:
        // отдельный визуальный порог создавал исчезающие дырки без разрыва (#94).
        // Рваный край собирается толще — у настоящего теста кромка разрыва скатывается.
        if(tornAt && (tornNode[a]||tornNode[b2]||tornNode[c]||tornNode[d])) t = Math.min(1, t + 0.28);
        if(onPan){
          const ck = (cook[a]+cook[b2]+cook[c]+cook[d])/4;
          g.fillStyle = pixelated ? quantOn(t, ck) : shadeOn(t, ck);
        } else g.fillStyle = pixelated ? quant(t) : shade(t);
      }
      g.beginPath();
      g.moveTo(prX(X[a],Y[a])*sx+ox, prY(X[a],Y[a])*sy+oy);
      g.lineTo(prX(X[b2],Y[b2])*sx+ox, prY(X[b2],Y[b2])*sy+oy);
      g.lineTo(prX(X[c],Y[c])*sx+ox, prY(X[c],Y[c])*sy+oy);
      g.lineTo(prX(X[d],Y[d])*sx+ox, prY(X[d],Y[d])*sy+oy);
      g.closePath(); g.fill();
    }
    // дуга хвата и палец видны только пока жест взводится: ARMED подсвечивает
    // выбранный край (audit, проход A), тесто при этом не двигается.
    if(action.state==="ARMED" || action.state==="LIFTING"){
      g.fillStyle="#d98b3a";
      const S2 = pixelated ? 2 : 6;
      for(const n of action.gripIds)
        g.fillRect(prX(px[n],py[n])*sx-S2/2, prY(px[n],py[n])*sy-S2/2, S2, S2);
      const rr = pixelated ? 4 : 14;
      g.beginPath();
      g.ellipse(prX(action.last.x,action.last.y)*sx, prY(action.last.x,action.last.y)*sy,
                rr, rr*TILT, 0, 0, Math.PI*2);
      g.fill();
    }
  }

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

  // Тава (กระทะโรตี): толстая сталь с вогнутым дном — кольца темнеют к борту,
  // в центре лужица маргарина. Рисуется в координатах стола той же проекцией, что мишень.
  const pcx = R_(prX(panC.x, panC.y)), pcy = D_(prY(panC.x, panC.y));
  const ell = (r, fill, dy)=>{
    g.fillStyle = fill; g.beginPath();
    g.ellipse(pcx, pcy + D_(dy||0), R_(r), D_(r*TILT), 0, 0, Math.PI*2); g.fill();
  };
  ell(PAN_R*1.16, "#0e0a07", PAN_R*0.06);   // тень и горелка под тавой
  ell(PAN_R*1.08, "#2a2622");               // борт
  ell(PAN_R*1.00, "#3a342d");
  ell(PAN_R*0.82, "#433c33");
  ell(PAN_R*0.62, "#4b4338");
  ell(PAN_R*0.42, "#544a3c");
  ell(PAN_R*0.30, "#6b5a2a");               // лужица маргарина в центре вогнутого дна
  ell(PAN_R*0.16, "#8a7436", -PAN_R*0.02);  // блик на масле

  // мишень: докуда растянуть лист — только пока лист на столе
  if(phase !== "TABLE") return;
  const c2 = centerOfSheet();
  const tR = stepNo===1 ? step1R : targetR;           // мишень текущего шага
  g.strokeStyle = "#4a3a24"; g.lineWidth = Math.max(1, R_(2));
  g.setLineDash([R_(10), R_(8)]);
  g.beginPath();
  g.ellipse(R_(prX(c2.x,c2.y)), D_(prY(c2.x,c2.y)), R_(tR), D_(tR*TILT), 0, 0, Math.PI*2);
  g.stroke(); g.setLineDash([]);
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
    draw();
  }catch(err){
    // Раньше единственное исключение в кадре останавливало игру насмерть:
    // requestAnimationFrame больше не вызывался, и экран замирал.
    loopErrs++;
    if(loopErrs < 4) console.error("кадр упал:", err);
  }

  acc+=real; frameCount++;
  if(acc>0.5){ fps=frameCount/acc; acc=0; frameCount=0; }
  const liveEl = document.getElementById("live");
  const pct = Math.round(sheetRadius()/targetR*100);
  const ragged = tornAt ? " · рваный узор" : "";
  const ready = sheetRadius()>=targetR ? " ✓ готов · запятой на таву →" : "";
  const banner = advancedAt && performance.now()-advancedAt < 2600;
  const mc = meanCook(), md = meanDry();
  const verdictAge = verdictAt ? performance.now() - verdictAt : Infinity;
  liveEl.textContent = dish ? dish.message : verdictAge < 3500 ? verdict :
    phase==="PAN" ? (md < 0.35 ? "на таве · шипит — слушай, цвета ещё нет"
                     : md < 0.9 ? "на таве · подсыхает, звук уходит выше"
                     : mc < 0.12 ? "на таве · суше и звонче — вот-вот пойдут пятна"
                     : "на таве · пятна цвета (жесты жарки — следующий этап, «заново» — новый кусочек)")
    : action.state==="CARRY" ? "в руке — веди запятую к таве"
    : action.state==="TOSS" ? "летит…"
    : banner ? (stepNo===3 ? "✓ растянуто — теперь круговым махом-«запятой» на таву"
                           : "✓ расплющено — шаг 2: возьми край и резко махни")
    : stepNo===1 ? (action.state==="ARMED"
        ? `расплющиваешь · ${Math.round(sheetRadius()/step1R*100)}%`
        : `шаг 1 · прижми кусочек и расплющивай · ${Math.round(sheetRadius()/step1R*100)}%`)
    : action.state==="ARMED" ? `держишь край · хват ${Math.round(action.mul||GRIP_MIN)} · смахни!`
    : (action.state==="LIFTING"||action.state==="FLYING") ? "бросок…"
    : (action.state==="IMPACT"||action.state==="SETTLING") ? `ШЛЕП · лист ${pct}%${ready}${ragged}`
    : `коснись края · лист ${pct}%${ready}${ragged}`;
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
    `[касаний ${rawTouch} · указателей ${rawPointer} · до теста ↓${dbgDown} ↔${dbgMove} · ${dbgKind}${loopErrs?" · сбоев "+loopErrs:""}]  ` +
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
function gestureLive(){ return action.state !== "RESTING" || !!dishGesture || !!dishFlight || !!dishMove; }
function resize(force){
  const r = stage.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio||1);
  const w = Math.max(64, Math.round(r.width*dpr)), h = Math.max(64, Math.round(r.height*dpr));
  if(!force && w===cv.width && h===cv.height) return;
  if(!force && gestureLive()){ pendingResize = true; return; }   // доиграем жест, потом пересоберём
  pendingResize = false;
  const oldPan={...panC},oldR=targetR;
  cv.width = w; cv.height = h;
  if(dish && !force){
    const z=zone("work"); targetR=Math.min(z.w,z.h)*TARGET_FRAC; layoutPan();
    const scale=targetR/oldR;
    for(let i=0;i<N;i++){px[i]=panC.x+(px[i]-oldPan.x)*scale;py[i]=panC.y+(py[i]-oldPan.y)*scale;prx[i]=px[i];pry[i]=py[i];}
    startR*=scale;step1R*=scale;gestureScale*=scale;R0*=scale;
    rebuildDishContact();
    return; // dish и история в локальных координатах: ни одной пересборки материала
  }
  build();
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
