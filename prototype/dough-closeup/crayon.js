// Сборка 103: облик «восковые мелки на крафт-бумаге» (вариант H, выбор владелицы 23.11; макет — mockups/ui/H/).
// Стенд рисуется как раньше, меняется только одежда: небо и место над стойкой — запечённая картинка макета H
// для настоящего часа телефона (утро — у школы, день — у причала, вечер — канал, ночь — рынок, глубокая ночь —
// тележка спит), стол — стальная полоса мелком, тава — воронёный круг с рваным краем мелка, поверх всего кадра —
// зубец бумаги (как мелок цепляется за крафт). Физика, жесты и раскладка не меняются.
// Выключить: ?look=old (запоминается на устройстве), включить обратно: ?look=crayon. Час для проверки: ?h=19.5.
const CRAYON_PH = {
  morning: { table:"#b7c4c4", line:"#d4e8ea", tint:null,       tintA:0,    counter:["#b0703c","#8a5228"], ink:"#3a2a24" },
  day:     { table:"#c3cbc8", line:"#f4f6ee", tint:null,       tintA:0,    counter:["#b0703c","#8a5228"], ink:"#3a2a24" },
  evening: { table:"#b4a6a6", line:"#f2b06e", tint:"#ffc9a3",  tintA:0.10, counter:["#8a5030","#5c3420"], ink:"#fbe8c8" },
  night:   { table:"#8f8fa6", line:"#ffd25e", tint:"#5f62a3",  tintA:0.16, counter:["#6e4430","#3f2a22"], ink:"#f3e6c8" },
  deep:    { table:"#6f7084", line:"#b9b7d8", tint:"#3b3f7a",  tintA:0.18, counter:["#5a3c30","#33241e"], ink:"#dcd6f0" },
};
const CRAYON_V = "2026-11-28-b104";
let crayonOn = false, crayonPhase = "evening", crayonBand = null, crayonTableImg = null, crayonTablePat = null, crayonTooth = null;

function crayonHour(){
  try { const h = parseFloat(new URLSearchParams(location.search).get("h")); if(isFinite(h)) return h; } catch(e) {}
  const d = new Date(); return d.getHours() + d.getMinutes()/60;
}
// Те же границы, что в макете H: до 5 — глубокая ночь, до 11 — утро, до 16 — день, до 19:30 — вечер, дальше ночь.
function crayonPhaseOf(h){ h = ((h%24)+24)%24; return h<5 ? "deep" : h<11 ? "morning" : h<16 ? "day" : h<19.5 ? "evening" : "night"; }

function crayonWanted(){
  try {
    const q = new URLSearchParams(location.search).get("look");
    if(q === "old" || q === "crayon"){ try { localStorage.setItem("roti_look", q); } catch(e) {} return q === "crayon"; }
    return (localStorage.getItem("roti_look") || "crayon") === "crayon";
  } catch(e) { return true; }
}

// Зубец бумаги: мелкие светлые и тёмные крапины, вытянутые по ходу мелка. Рисуется один раз в плитку 256².
function crayonMakeTooth(){
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const q = c.getContext("2d"); let s = 7;
  const rnd = () => (s = (s*16807) % 2147483647) / 2147483647;
  for(let i=0;i<2600;i++){
    const x = rnd()*256, y = rnd()*256, w = 1 + rnd()*5, dark = rnd() < 0.55;
    q.fillStyle = dark ? `rgba(70,40,20,${0.10 + rnd()*0.22})` : `rgba(255,246,220,${0.10 + rnd()*0.25})`;
    q.fillRect(x, y, w, 1 + (rnd() < 0.3 ? 1 : 0));
  }
  return c;
}

function crayonInit(){
  if(typeof document === "undefined" || typeof Image === "undefined") return;   // Node-проверки: облик не нужен
  crayonOn = crayonWanted();
  try { document.body.classList.toggle("crayon", crayonOn); } catch(e) {}
  if(!crayonOn) return;
  crayonPhase = crayonPhaseOf(crayonHour());
  const band = new Image(); band.onload = () => { crayonBand = band; }; band.src = `crayon/band-${crayonPhase}.jpg?v=${CRAYON_V}`;
  const tab = new Image(); tab.onload = () => { crayonTableImg = tab; crayonTablePat = null; }; tab.src = `crayon/table-${crayonPhase}.jpg?v=${CRAYON_V}`;
  crayonTooth = crayonMakeTooth();
  // Час идёт: раз в минуту проверяем, не сменилась ли фаза. Сцена меняется только между роти (решение 23.11:
  // смена часа не прерывает руки), поэтому новая фаза ждёт, пока на столе и таве пусто.
  setInterval(() => {
    const p = crayonPhaseOf(crayonHour());
    if(p === crayonPhase || (typeof dish !== "undefined" && dish) || (typeof stepNo !== "undefined" && stepNo > 1)) return;
    crayonPhase = p; crayonBand = null; crayonTableImg = null; crayonTablePat = null;
    const b = new Image(); b.onload = () => { crayonBand = b; }; b.src = `crayon/band-${p}.jpg?v=${CRAYON_V}`;
    const t = new Image(); t.onload = () => { crayonTableImg = t; }; t.src = `crayon/table-${p}.jpg?v=${CRAYON_V}`;
  }, 60000);
}

// Рваный край мелка: эллипс из коротких штрихов с дрожью радиуса (детерминированно, без мерцания между кадрами).
function crayonEllipse(g, cx, cy, rx, ry, fill, jit, seed){
  g.fillStyle = fill; g.beginPath();
  const n = 72;
  for(let i=0;i<=n;i++){
    const a = i/n*Math.PI*2, k = 1 + jit*(Math.sin(a*7 + seed) * 0.5 + Math.sin(a*13 + seed*2.3) * 0.35 + Math.sin(a*29 + seed*0.7) * 0.15);
    const x = cx + Math.cos(a)*rx*k, y = cy + Math.sin(a)*ry*k;
    if(i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.fill();
}

// Стол и тава мелком. Возвращает true, если нарисовал (тогда обычный стол не рисуется).
function crayonDrawTable(g, sx, sy){
  if(!crayonOn || (typeof frameOn !== "undefined" && frameOn)) return false;
  const P = CRAYON_PH[crayonPhase], W = cv.width*sx, H = cv.height*sy;
  g.fillStyle = P.table; g.fillRect(0, 0, W, H);
  if(crayonTableImg){
    if(!crayonTablePat){ crayonTablePat = g.createPattern(crayonTableImg, "repeat"); }
    if(crayonTablePat){
      const k = W / crayonTableImg.width;
      crayonTablePat.setTransform && crayonTablePat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
      g.fillStyle = crayonTablePat; g.fillRect(0, 0, W, H);
    }
  }
  if(panKnock){ g.save(); g.translate(0, panKnock*sy); }
  const pcx = prX(panC.x, panC.y)*sx, pcy = prY(panC.x, panC.y)*sy, rx = PAN_R*sx, ry = PAN_R*TILT*sy;
  crayonEllipse(g, pcx, pcy + ry*0.10, rx*1.14, ry*1.16, "rgba(40,25,20,0.35)", 0.020, 1.1);   // тень на столе
  crayonEllipse(g, pcx, pcy, rx*1.07, ry*1.07, "#1f1d22", 0.016, 2.3);                         // борт
  crayonEllipse(g, pcx, pcy, rx*0.98, ry*0.98, "#2f2d33", 0.012, 3.7);                         // плита
  // штрихи мелка по плите: ход руки по кругу, светлее к краю
  g.save(); g.globalAlpha = 0.22; g.strokeStyle = "#6a6672"; g.lineWidth = Math.max(1, 2*sx);
  for(let i=0;i<5;i++){ g.beginPath(); g.ellipse(pcx, pcy, rx*(0.45 + i*0.11), ry*(0.45 + i*0.11), 0, 0.3 + i, 2.2 + i*0.9); g.stroke(); }
  g.globalAlpha = 0.30; g.strokeStyle = "#cfd6e8";
  g.beginPath(); g.ellipse(pcx - rx*0.22, pcy - ry*0.30, rx*0.32, ry*0.22, -0.3, Math.PI*1.05, Math.PI*1.55); g.stroke();   // блик
  g.restore();
  crayonEllipse(g, pcx, pcy, rx*0.30, ry*0.30, "#b08a2e", 0.05, 5.1);   // лужица маргарина
  crayonEllipse(g, pcx - rx*0.03, pcy - ry*0.04, rx*0.15, ry*0.15, "#e2c25a", 0.07, 6.2);
  drawFatAndButter(g, sx, sy);
  if(panKnock) g.restore();
  drawPanGlow(g, sx, sy);
  drawStretchTarget(g, sx, sy);
  return true;
}

// Небо и место над стойкой: картинка макета H, по ширине кадра, низом к стойке. Возвращает true, если нарисовал.
function crayonDrawSky(g, sx, sy, G){
  if(!crayonOn || !crayonBand) return false;
  const W = G.W*sx, bottom = G.counter.y1*sy, h = W * crayonBand.height / crayonBand.width;
  g.drawImage(crayonBand, 0, bottom - h, W, h);
  return true;
}
// Пока лампа не горит, кадр под небом приглушён (вечерняя механика «тронь лампу»). Днём слабее, ночью сильнее.
function crayonDim(){ return crayonOn ? { morning:0.14, day:0.10, evening:0.32, night:0.50, deep:0.55 }[crayonPhase] : 0.55; }
function crayonCounter(){ return crayonOn ? CRAYON_PH[crayonPhase].counter : null; }

// Поверх всего кадра: зубец бумаги и лёгкий тон часа (вечер теплее, ночь синее).
function crayonOver(c){
  if(!crayonOn || !crayonTooth) return;
  const P = CRAYON_PH[crayonPhase], cvs = c.canvas;
  c.save();
  if(P.tint && P.tintA){ c.globalCompositeOperation = "soft-light"; c.globalAlpha = P.tintA*2.2; c.fillStyle = P.tint; c.fillRect(0, 0, cvs.width, cvs.height); }
  c.globalCompositeOperation = "source-over"; c.globalAlpha = 0.55;
  const pat = c.createPattern(crayonTooth, "repeat");
  if(pat){ const k = Math.max(1, cvs.width/520); pat.setTransform && pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0])); c.fillStyle = pat; c.fillRect(0, 0, cvs.width, cvs.height); }
  c.restore();
}

// ─────────────── Сборка 104: предметы на стойке и пёс — мелком
// Миска с шариками, радио, крышка, лампа, лотки с роти и пёс рисуются теми же овалами и прямоугольниками, что раньше
// (место и размер — прежние, касания не меняются), но край у них рваный, внутри — штрих мелка, по краю — контур
// темнее заливки. Цвета — из палитры макета H. Форма края зависит только от размера предмета, не от места:
// крышка в руке и пёс поверх роти не «дрожат» при движении.
const CRAYON_PROP = {
  bowlRim:"#8e9b9b", bowlIn:"#56605f", ball:"#f3e2bd",
  radio:"#b8432f", radioSpk:"#3a2a24", radioDial:"#e9c25a", radioAnt:"#7c706a",
  lidRim:"#1f1d22", lidTop:"#4a4752", lidKnob:"#1f1d22",
  lampOn:"#e9733a", lampOff:"#5a4a42", bulbOn:"#ffd25e", bulbOff:"#6e6258", cordOn:"#3a2a24", cordOff:"#5a4a42",
  lump:"#f3e2bd", tray:"#efe3c6", roti:"#e9a53c", rotiEdge:"#b8621c", rotiCut:"rgba(126,60,16,.75)",
  fur:"#c9a878", ear:"#8a6a44", dark:"#3a2a24",
};
function crayonCol(key, old){ return crayonOn && CRAYON_PROP[key] ? CRAYON_PROP[key] : old; }
function crayonDarker(c, f){
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if(!m) return "rgba(40,25,20,0.5)";
  const d = i => Math.round(parseInt(m[i], 16)*f);
  return `rgb(${d(1)},${d(2)},${d(3)})`;
}
// Заливка готового контура как мелком: цвет, косой штрих темнее (тень снизу справа), контур темнее заливки.
function crayonFillPath(g, path, fill, x0, y0, w, h, grain){
  g.fillStyle = fill; g.fill(path);
  const m = Math.min(w, h), dark = crayonDarker(fill, 0.72);
  if(grain && m >= 10){
    // волокно тика: волнистые штрихи вдоль доски
    g.save(); g.clip(path); g.globalAlpha = 0.32; g.strokeStyle = dark; g.lineWidth = Math.max(1, m*0.02); g.beginPath();
    for(let i=1;i<6;i++){
      const yy = y0 + h*i/6;
      g.moveTo(x0, yy);
      for(let x = x0; x <= x0 + w; x += 24) g.lineTo(x, yy + Math.sin(x*0.021 + i*1.7)*m*0.03);
    }
    g.stroke(); g.restore();
  } else if(m >= 10){
    g.save(); g.clip(path);
    g.globalAlpha = 0.28; g.strokeStyle = dark; g.lineWidth = Math.max(1, m*0.035); g.beginPath();
    const step = Math.max(3, m*0.13);
    for(let t = -h; t < w; t += step){ g.moveTo(x0 + t + h*0.45, y0 + h*0.45); g.lineTo(x0 + t + h*1.05, y0 + h*1.05); }
    g.stroke(); g.restore();
  }
  if(m >= 4){
    g.save(); g.globalAlpha = 0.6; g.strokeStyle = dark; g.lineWidth = Math.max(1, Math.min(2.6, m*0.06)); g.lineJoin = "round";
    g.stroke(path); g.restore();
  }
}
function crayonBlob(g, cx, cy, rx, ry, fill, rot){
  if(!/^#/.test(fill)){ g.fillStyle = fill; g.beginPath(); g.ellipse(cx, cy, rx, ry, rot || 0, 0, Math.PI*2); g.fill(); return; }
  const seed = (rx*0.71 + ry*1.37) % 6.283, jit = Math.min(0.08, 1.4/Math.max(4, rx, ry));
  const n = 40, c = Math.cos(rot || 0), s = Math.sin(rot || 0);
  const P = new Path2D();
  for(let i=0;i<n;i++){
    const a = i/n*Math.PI*2, k = 1 + jit*(Math.sin(a*5 + seed)*0.55 + Math.sin(a*11 + seed*2.3)*0.30 + Math.sin(a*23 + seed*0.7)*0.15);
    const px = Math.cos(a)*rx*k, py = Math.sin(a)*ry*k, x = cx + px*c - py*s, y = cy + px*s + py*c;
    if(i) P.lineTo(x, y); else P.moveTo(x, y);
  }
  P.closePath();
  crayonFillPath(g, P, fill, cx - rx, cy - ry, 2*rx, 2*ry);
}
function crayonRect(g, x, y, w, h, fill, grain){
  if(w < 4 || h < 4 || !/^#/.test(fill)){ g.fillStyle = fill; g.fillRect(x, y, w, h); return; }
  const seed = (w*0.37 + h*0.91) % 6.283, amp = Math.min(1.2, Math.min(w, h)*0.06);
  const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const P = new Path2D(); P.moveTo(x, y);
  for(let e=0;e<4;e++){
    const [ax, ay] = pts[e], [bx, by] = pts[(e + 1)%4], len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(len/14));
    const nx = -(by - ay)/len, ny = (bx - ax)/len;
    for(let i=1;i<=n;i++){
      const t = i/n, j = i === n ? 0 : amp*Math.sin(i*2.7 + e*1.9 + seed);
      P.lineTo(ax + (bx - ax)*t + nx*j, ay + (by - ay)*t + ny*j);
    }
  }
  P.closePath();
  crayonFillPath(g, P, fill, x, y, w, h, grain);
}

crayonInit();
