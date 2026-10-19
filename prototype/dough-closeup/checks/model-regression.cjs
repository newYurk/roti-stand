#!/usr/bin/env node
'use strict';
// Pure Node/vm regression harness. No browser and no UI automation.
// DOM/canvas/audio are intentionally mocked: this checks script boot, model math,
// native internal action transitions and tear criteria, not browser input or feel.
// 16.09: boot() also returns synthetic window/document event dispatch (fire, touch,
// pointer, gesture, viewport, visibility), table/dish ↔ client projection and, with
// {audio:true}, a logging Web Audio mock. These are still mocks, not a browser:
// see README.md «Расширения харнесса 16.09» and harness-selftest.cjs.
// 19.10.2026: this copy lives in git next to stand.js (prototype/dough-closeup/checks/) and is the
// current one; the suites in runs/continuation/regression/ still require their own older copy.
//   node prototype/dough-closeup/checks/model-regression.cjs [path/to/stand.js]
// Without an argument it checks the stand.js of THIS checkout (not the main folder), and writes
// the report to runs/checks/model-regression-results.json of this checkout (runs/ is not in git).
// Changes against the 16.09 copy: press() releases the finger (since e4f7a81 step 1 is committed
// on release), the thin-quads check also fills the flatten map that step 1 is drawn with, a resize
// check and a steady-swipe check. slap() is the 16.09 slap (one stationary event, then one move at
// the requested speed along the grabbed rim) and its strength is checked exactly, as on 16.09:
// the stand measures the hand speed between two neighbouring events. swipe() is a steady 60 Hz
// swipe; its rim turns a little between the events, so it is checked exactly against the stand's
// own formula along the grip axis, not against the requested strength.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sourcePath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'stand.js'));
const htmlPath = path.join(path.dirname(sourcePath), 'index.html');
let source = fs.readFileSync(sourcePath, 'utf8');
let html = sourcePath.endsWith('.html') ? source : fs.readFileSync(htmlPath, 'utf8');
if (sourcePath.endsWith('.html')) {
  html = source;
  source = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace('let tossOk = 0, tossTry = 0;и', 'let tossOk = 0, tossTry = 0;');
}
const outputs = [], tests = [];
function test(name, fn) { try { const result = fn(); tests.push({name, status:'PASS', ...(result ? {result} : {})}); } catch(err) { tests.push({name, status:'FAIL', error:err.stack}); } }
// ── Web Audio mock (16.09): включается boot(..., {audio:true}). Не звук, а журнал.
// Каждый вызов метода AudioParam и каждая запись `.value` пишутся в audioLog как
// {node, param, method, args, t}; вызовы самих нод (connect/start/stop/…) — туда же
// с param:null. Имя ноды — `<Тип>#<порядковый номер создания>`, выход — 'destination'.
// `.value` меняется только записью и setValueAtTime (кривые автоматизации не считаются).
// Проверки аргументов повторяют те, на которых падает настоящий браузер: нечисловое
// значение, отрицательное время, экспоненциальная рампа к нулю, повторный start().
function makeAudioMock(clock) {
  const audioLog = [], audioNodes = [], contexts = [];
  const finite = (m, a) => { for (const v of a) if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${m}: The provided value is non-finite (${v})`); };
  const nonNegative = (m, t) => { if (t < 0) throw new RangeError(`${m}: time ${t} must be non-negative`); };
  function AudioContextMock(options = {}) {
    if (!new.target) throw new TypeError("Failed to construct 'AudioContext': Please use the 'new' operator");
    const ac = this, created = clock();
    let count = 0;
    const now = () => (clock() - created) / 1000;
    const log = (node, param, method, args) => audioLog.push({node, param, method, args, t: now()});
    const nameOf = x => (x && x.__name) || x;
    function param(owner, name, init) {
      let v = init;
      const p = { defaultValue: init, minValue: -3.4028234663852886e38, maxValue: 3.4028234663852886e38, automationRate: 'a-rate',
        get value() { return v; },
        set value(x) { finite(`${owner}.${name}.value`, [x]); log(owner, name, 'value=', [x]); v = x; },
        setValueAtTime(x, t) { finite('setValueAtTime', [x, t]); nonNegative('setValueAtTime', t); log(owner, name, 'setValueAtTime', [x, t]); if (t <= now()) v = x; return p; },
        linearRampToValueAtTime(x, t) { finite('linearRampToValueAtTime', [x, t]); nonNegative('linearRampToValueAtTime', t); log(owner, name, 'linearRampToValueAtTime', [x, t]); return p; },
        exponentialRampToValueAtTime(x, t) { finite('exponentialRampToValueAtTime', [x, t]); nonNegative('exponentialRampToValueAtTime', t); if (x === 0) throw new RangeError('exponentialRampToValueAtTime: value must be non-zero'); log(owner, name, 'exponentialRampToValueAtTime', [x, t]); return p; },
        setTargetAtTime(x, t, c) { finite('setTargetAtTime', [x, t, c]); nonNegative('setTargetAtTime', t); if (c < 0) throw new RangeError('setTargetAtTime: timeConstant must be non-negative'); log(owner, name, 'setTargetAtTime', [x, t, c]); return p; },
        setValueCurveAtTime(curve, t, d) { finite('setValueCurveAtTime', [t, d]); log(owner, name, 'setValueCurveAtTime', [Array.from(curve), t, d]); return p; },
        cancelScheduledValues(t) { finite('cancelScheduledValues', [t]); nonNegative('cancelScheduledValues', t); log(owner, name, 'cancelScheduledValues', [t]); return p; },
        cancelAndHoldAtTime(t) { finite('cancelAndHoldAtTime', [t]); nonNegative('cancelAndHoldAtTime', t); log(owner, name, 'cancelAndHoldAtTime', [t]); return p; } };
      Object.defineProperty(p, '__name', {value: `${owner}.${name}`});
      return p;
    }
    function audioNode(type, params = {}, extra = {}, isSource = false) {
      const name = `${type}#${++count}`, rec = {name, type, createdAt: now(), connections: [], started: null, stopped: null};
      audioNodes.push(rec);
      const n = { context: ac, numberOfInputs: isSource ? 0 : 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers',
        connect(dest, ...rest) { if (!dest) throw new TypeError(`${name}.connect: destination required`); log(name, null, 'connect', [nameOf(dest), ...rest]); rec.connections.push(nameOf(dest)); return dest; },
        disconnect(...a) { log(name, null, 'disconnect', a.map(nameOf)); if (!a.length) rec.connections.length = 0; else rec.connections = rec.connections.filter(c => c !== nameOf(a[0])); },
        ...extra };
      Object.defineProperty(n, '__name', {value: name});
      for (const [k, v] of Object.entries(params)) n[k] = param(name, k, v);
      if (isSource) {
        n.onended = null;
        n.start = (when = 0, ...rest) => { finite(`${name}.start`, [when, ...rest]); nonNegative(`${name}.start`, when); if (rec.started !== null) throw new Error(`InvalidStateError: ${name}.start() called more than once`); rec.started = when; log(name, null, 'start', [when, ...rest]); };
        n.stop = (when = 0) => { finite(`${name}.stop`, [when]); nonNegative(`${name}.stop`, when); if (rec.started === null) throw new Error(`InvalidStateError: ${name}.stop() before start()`); rec.stopped = when; log(name, null, 'stop', [when]); };
      }
      return n;
    }
    const sampleRate = options.sampleRate || 48000;
    Object.assign(ac, {
      options: {...options}, sampleRate, state: 'running', baseLatency: 0.005, outputLatency: 0.02, onstatechange: null,
      destination: Object.defineProperty({maxChannelCount: 2, channelCount: 2, numberOfInputs: 1, numberOfOutputs: 0}, '__name', {value: 'destination'}),
      resume() { ac.state = 'running'; log('context', null, 'resume', []); return Promise.resolve(); },
      suspend() { ac.state = 'suspended'; log('context', null, 'suspend', []); return Promise.resolve(); },
      close() { ac.state = 'closed'; log('context', null, 'close', []); return Promise.resolve(); },
      createGain: () => audioNode('Gain', {gain: 1}),
      createBiquadFilter: () => audioNode('BiquadFilter', {frequency: 350, Q: 1, gain: 0, detune: 0}, {type: 'lowpass'}),
      createBufferSource: () => audioNode('BufferSource', {playbackRate: 1, detune: 0}, {buffer: null, loop: false, loopStart: 0, loopEnd: 0}, true),
      createOscillator: () => audioNode('Oscillator', {frequency: 440, detune: 0}, {type: 'sine'}, true),
      createStereoPanner: () => audioNode('StereoPanner', {pan: 0}),
      createBuffer(channels, length, rate) {
        if (!(channels >= 1 && channels <= 32)) throw new Error(`NotSupportedError: createBuffer channels ${channels}`);
        if (!(length >= 1)) throw new Error(`NotSupportedError: createBuffer length ${length}`);
        if (!(rate >= 3000 && rate <= 768000)) throw new Error(`NotSupportedError: createBuffer sampleRate ${rate}`);
        const data = Array.from({length: channels}, () => new Float32Array(length));
        return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate,
          getChannelData(i) { if (!(i >= 0 && i < channels)) throw new RangeError(`getChannelData(${i})`); return data[i]; },
          copyFromChannel(dest, i, off = 0) { dest.set(data[i].subarray(off, off + dest.length)); },
          copyToChannel(src, i, off = 0) { data[i].set(src, off); } };
      },
    });
    Object.defineProperty(ac, 'currentTime', {get: now, enumerable: true});
    contexts.push(ac);
  }
  return {AudioContextMock, audioLog, audioNodes, contexts};
}
// boot(tune, width, height, opts)
//   opts.audio — true: в окне есть AudioContext/webkitAudioContext (мок с журналом).
//   Без opts поведение прежнее: AudioContext отсутствует, слушатели окна только копятся.
function boot(tune, width=1000, height=600, opts={}) {
  let time=1000, seed=123456789;
  const storage = new Map([...(tune ? [['dough_tune',JSON.stringify(tune)]] : []), ...(opts.storage||[])]);   // opts.storage — заранее записанное хранилище
  const drawCalls=[];
  const canvas = Object.fromEntries(['fillRect','beginPath','ellipse','fill','moveTo','lineTo','closePath','drawImage','stroke','setLineDash','clearRect','save','restore','clip','translate','rotate','scale','arc','strokeRect','fillText','quadraticCurveTo','bezierCurveTo','arcTo','rect','setTransform','resetTransform','strokeText','putImageData','fillRect'].map(k=>[k,()=>{}]));
  canvas.closePath=()=>drawCalls.push({kind:'closedPath',fillStyle:canvas.fillStyle});
  function node(id, dataset={}) { const classes = new Set(),listeners = new Map(); return {id, dataset, style:{}, value:'', textContent:'', width:0,height:0, children:[], classList:{add:(k)=>classes.add(k), remove:(k)=>classes.delete(k), contains:(k)=>classes.has(k), toggle:(k,v)=>{if(v===undefined)v=!classes.has(k);if(v)classes.add(k);else classes.delete(k);return v;}}, addEventListener(type,fn){listeners.set(type,fn);},fire(type){listeners.get(type)?.({target:this});}, dispatch(ev){listeners.get(ev.type)?.call(this,ev);}, appendChild(n){this.children.push(n);}, getContext(){return canvas;}, getBoundingClientRect(){return {left:0,top:0,width,height};}, closest(){return null;}}; }
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],node(m[1])]));
  const groups = Object.fromEntries(['s','v','c','f','p'].map(k=>[`[data-${k}]`, [...html.matchAll(new RegExp(`data-${k}="([^"]+)"`,'g'))].map(m=>node('',{[k]:m[1]}))]));
  const errors=[], raf=[];
  const mockMath = Object.create(Math); mockMath.random=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  // Реестр слушателей: окно (оно же глобальный объект vm) и document; по нескольку на тип.
  const winListeners=new Map(), docListeners=new Map();
  const captureOf=o=>typeof o==='boolean'?o:!!(o&&o.capture);
  const addListener=map=>(type,fn,o)=>{ if(!fn)return; const list=map.get(type)||[],capture=captureOf(o); if(list.some(l=>l.fn===fn&&l.capture===capture))return; list.push({fn,capture,once:!!(o&&o.once),passive:!!(o&&o.passive)}); map.set(type,list); };
  const removeListener=map=>(type,fn,o)=>{ const list=map.get(type),capture=captureOf(o); if(!list)return; const i=list.findIndex(l=>l.fn===fn&&l.capture===capture); if(i>=0)list.splice(i,1); };
  const document={getElementById:id=>nodes.get(id)||null, createElement:tag=>node(tag), querySelectorAll:s=>groups[s]||[], body:node('body'), hidden:false, visibilityState:'visible', addEventListener:addListener(docListeners), removeEventListener:removeListener(docListeners)};
  const context={ Math:mockMath, performance:{now:()=>time}, document, localStorage:{getItem:k=>storage.get(k)||null, setItem:(k,v)=>storage.set(k,String(v))}, devicePixelRatio:1, addEventListener:addListener(winListeners), removeEventListener:removeListener(winListeners), requestAnimationFrame:f=>raf.push(f), setTimeout:()=>1, clearTimeout(){}, navigator:{}, location:{origin:'http://localhost',pathname:'/',replace(){}}, console:{log(){},warn(){},error:(...a)=>errors.push(a.map(x=>String(x)).join(' '))} };
  context.window=context;
  const audio=opts.audio?makeAudioMock(()=>time):null;
  if(audio){ context.AudioContext=audio.AudioContextMock; context.webkitAudioContext=audio.AudioContextMock; }
  vm.createContext(context);
  vm.runInContext(source,context,{filename:sourcePath,timeout:10000});
  const run=code=>vm.runInContext(code,context,{timeout:120000});
  const tick=(n=1,dt=1/60,full=false)=>{for(let i=0;i<n;i++){time+=dt*1000;if(full){const fn=raf.shift();assert.ok(fn,'rAF is scheduled');fn(time);}else run(`step(${dt});`);}};
  run(`globalThis.metrics = () => ({n:N, stepNo, state:action.state, phase, radius:sheetRadius(), progress:sheetRadius()/targetR, area:quads.reduce((s,q)=>s+area(q),0), areaRatio:quads.reduce((s,q)=>s+area(q),0)/startArea, broken:cons.filter(c=>c.broken).length, holeQuads:quadCons.filter(cs=>cs.some(c=>c.broken)).length, minThickness:Math.min(...thick), medianThickness:median(Array.from(thick)), invertedQuads:quads.filter(([a,b,c,d])=>(px[a]*(py[b]-py[d])+px[b]*(py[c]-py[a])+px[c]*(py[d]-py[b])+px[d]*(py[a]-py[c]))<0).length, finite:[px,py,vx,vy,thick].every(a=>Array.from(a).every(Number.isFinite)), threshold:THICK_BREAK});`);
  // Проекция стол ↔ client px. Имена стенда (cv, prX, prY, toLocal, dishPose, dishLocal)
  // разрешаются в момент вызова, а не при загрузке, — старые стенды без блюда грузятся.
  run(`globalThis.__harness = {
    toClient(x,y){ const r=cv.getBoundingClientRect(), sx=prX(x,y), sy=prY(x,y); return {x:r.left+sx*r.width/cv.width, y:r.top+sy*r.height/cv.height}; },
    dishToClient(p){ const pose=dishPose(); return this.toClient(pose.x+p.x*pose.scale, pose.y+p.y*pose.scale); },
    fromClient(x,y){ return toLocal(x,y); },
    clientToDish(x,y){ return dishLocal(toLocal(x,y)); }
  };`);
  const call=(fn,a,b)=>{ context.__harnessArgs=[a,b]; try{ return JSON.parse(run(`JSON.stringify(__harness.${fn}(...__harnessArgs))`)); } finally { delete context.__harnessArgs; } };
  const xy=(x,y)=>typeof x==='object'&&x!==null?[x.x,x.y]:[x,y];
  const toClient=(x,y)=>call('toClient',...xy(x,y));
  const dishToClient=p=>call('dishToClient',{x:p.x,y:p.y});
  const fromClient=(x,y)=>call('fromClient',...xy(x,y));
  const clientToDish=(x,y)=>call('clientToDish',...xy(x,y));
  // События. Порядок как у всплывающего события внутри страницы: окно (capture) →
  // цель (слушатель узла-мока) → document → окно (bubble). Исключение слушателя не
  // обрывает остальных (как в браузере), копится в eventErrors и по умолчанию
  // перевыбрасывается после обхода: fire(type, props, {strict:false}) — не бросать.
  const cv=nodes.get('cv'), eventErrors=[];
  // closest() разбирает список селекторов, как браузер: stand.js спрашивает '#panel, #card'.
  const within=(id)=>sel=>String(sel).split(',').map(x=>x.trim()).includes('#'+id)?nodes.get(id):null;
  const uiTarget={id:'panel-child', closest:within('panel')};
  const cardTarget={id:'card-child', closest:within('card')};
  function fire(type, props={}, {strict=true}={}) {
    const ev={type, target:cv, currentTarget:null, bubbles:true, cancelable:true, defaultPrevented:false, timeStamp:time, isTrusted:true,
      preventDefault(){ if(this.cancelable) this.defaultPrevented=true; }, stopPropagation(){ this.propagationStopped=true; }, stopImmediatePropagation(){ this.propagationStopped=this.immediatePropagationStopped=true; }, ...props};
    const errs=[];
    const invoke=(map,current,capture)=>{
      if(ev.propagationStopped) return;
      for(const l of [...(map.get(type)||[])]){
        if(capture!==null&&l.capture!==capture) continue;
        if(l.once) removeListener(map)(type,l.fn,l.capture);
        ev.currentTarget=current;
        try{ typeof l.fn==='function'?l.fn.call(current,ev):l.fn.handleEvent(ev); }catch(e){ errs.push(e); eventErrors.push({type,error:e&&e.stack||String(e)}); }
        if(ev.immediatePropagationStopped) break;
      }
    };
    invoke(winListeners,context,true);
    if(!ev.propagationStopped&&ev.target&&typeof ev.target.dispatch==='function'){ ev.currentTarget=ev.target; try{ ev.target.dispatch(ev); }catch(e){ errs.push(e); eventErrors.push({type,error:e&&e.stack||String(e)}); } }
    invoke(docListeners,document,null);
    invoke(winListeners,context,false);
    ev.currentTarget=null;
    if(strict&&errs.length) throw errs[0];
    return ev;
  }
  // Идентификатор касания: 't1'/'p1' — внутреннее имя стенда ("t"+identifier / "p"+pointerId).
  const rawId=(id,prefix)=>{ if(typeof id==='string'&&id.startsWith(prefix)){ const s=id.slice(prefix.length); return /^-?\d+$/.test(s)?Number(s):s; } return id; };
  // props — поля события поверх стандартных (например target:h.uiTarget); props.fireOptions → третий аргумент fire.
  // touches/targetTouches — все пальцы, что сейчас на экране, как в браузере (17.09: сверка списка
  // пальцев в стенде; раньше здесь был только текущий палец).
  const liveTouches=new Map();
  function touch(kind, id, x, y, {fireOptions, ...props}={}) {
    const type=kind.startsWith('touch')?kind:'touch'+kind;
    const t={identifier:rawId(id,'t'), clientX:x, clientY:y, pageX:x, pageY:y, screenX:x, screenY:y, radiusX:1, radiusY:1, rotationAngle:0, force:1, target:props.target||cv};
    if(/end|cancel/.test(type)) liveTouches.delete(t.identifier); else liveTouches.set(t.identifier,t);
    const live=[...liveTouches.values()];
    return fire(type,{changedTouches:[t],touches:live,targetTouches:live,...props},fireOptions);
  }
  function pointer(kind, id, x, y, pointerType='mouse', {fireOptions, ...props}={}) {
    const type=kind.startsWith('pointer')?kind:'pointer'+kind;
    return fire(type,{pointerId:rawId(id,'p'), clientX:x, clientY:y, pageX:x, pageY:y, pointerType, isPrimary:true, button:/down|up/.test(type)?0:-1, buttons:/down|move/.test(type)?1:0, pressure:/down|move/.test(type)?0.5:0, width:1, height:1, ...props},fireOptions);
  }
  // path — точки в client px. kind: 'touch' → touch-события; 'mouse'|'pen'|'pointer' →
  // pointer-события (pointer = mouse; pointerType 'touch' стенд игнорирует намеренно).
  // Время виртуальное. framesBetween: паузы заполняются кадрами step() (fullFrames — полными rAF-кадрами).
  function gesture(path, {id, kind='touch', dtMs=1000/60, holdMs=0, framesBetween=false, fullFrames=false, release=true}={}) {
    assert.ok(Array.isArray(path)&&path.length>=1,'gesture path needs at least one point');
    const isTouch=kind==='touch', pointerType=kind==='pointer'?'mouse':kind;
    id=id??(isTouch?'t1':'p1');
    const send=(phase,p)=>isTouch?touch(phase,id,p.x,p.y):pointer(phase,id,p.x,p.y,pointerType);
    const wait=ms=>{ if(!(ms>0))return; if(framesBetween){ const n=Math.max(1,Math.round(ms/(1000/60))); tick(n,ms/n/1000,fullFrames); } else time+=ms; };
    const startedAt=time; let events=0;
    send(isTouch?'start':'down',path[0]);events++;
    wait(holdMs);
    for(const p of path.slice(1)){ wait(dtMs); send('move',p); events++; }
    if(release){ send(isTouch?'end':'up',path.at(-1)); events++; }
    return {id,kind,events,startedAt,endedAt:time,durationMs:time-startedAt};
  }
  // Смена размера окна: все узлы-моки отдают новый прямоугольник, затем событие resize.
  // Купола (пузыри, 17.09) меняют тепло по месту; старые наборы проверяют модель без них.
  // Новые проверки включают их явно: boot(..., {domes:true}).
  if(!opts.domes) run('if(typeof DOMES!=="undefined") DOMES=false;');
  function viewport(w,h){ width=w; height=h; return fire('resize',{target:context}); }
  function visibility(hidden){ document.hidden=!!hidden; document.visibilityState=hidden?'hidden':'visible'; return fire('visibilitychange',{target:document}); }
  return {run,tick,errors,nodes,storage,drawCalls,getTime:()=>time,advance:ms=>time+=ms,metrics:()=>JSON.parse(JSON.stringify(run('metrics()'))),
    context,fire,touch,pointer,gesture,viewport,visibility,uiTarget,cardTarget,eventErrors,
    listeners:{window:winListeners,document:docListeners},
    toClient,dishToClient,fromClient,clientToDish,
    audioLog:audio?audio.audioLog:[],audioNodes:audio?audio.audioNodes:[],audioContexts:audio?audio.contexts:[]};
}
function press(h) {
  h.run('globalThis.originalMesh=px; armAction("test",centerOfSheet());');
  let frames=0;
  // Since e4f7a81 the flatten→stretch transition happens on release: the palm is lifted every
  // 3 s and put back while the lump is still on step 1.
  while(h.run('stepNo')===1 && frames<1200) { h.tick();frames++; if(frames%180===0 && h.run('stepNo')===1) h.run('releaseAction(); if(stepNo===1) armAction("test",centerOfSheet());'); }
  assert.equal(h.run('stepNo'),2,'native automatic flatten→stretch transition');
  assert.equal(h.run('px===originalMesh'),true,'automatic transition retains the same mesh');
  h.run('releaseAction();');h.tick(60);
  return {seconds:frames/60,metrics:h.metrics()};
}
function slap(h, index, impulse=2.3) {
  assert.equal(h.run('action.state'),'RESTING');
  const angle=index*Math.PI/2;
  h.run(`{const c=centerOfSheet(),r=sheetRadius();armAction("test",{x:c.x+Math.cos(${angle})*r,y:c.y+Math.sin(${angle})*r});}`);
  h.tick(15);
  // A stationary event makes the following event's dt explicit. Coordinates are
  // internal table units; this intentionally bypasses DOM and gesture projection.
  h.run('updateActionMove({x:action.last.x,y:action.last.y});');
  h.advance(1000/60);
  h.run(`{const c=centerOfSheet(),r=Math.hypot(px[action.edgeNode]-c.x,py[action.edgeNode]-c.y),dx=(px[action.edgeNode]-c.x)/r,dy=(py[action.edgeNode]-c.y)/r;updateActionMove({x:action.last.x+dx*gestureScale*${impulse}/IMPULSE_K/60,y:action.last.y+dy*gestureScale*${impulse}/IMPULSE_K/60});}`);
  assert.equal(h.run('action.state'),'LIFTING','native straight swipe reaches LIFTING');
  const actualImpulse=h.run('action.impulse');
  assert.ok(Math.abs(actualImpulse-impulse)<1e-6,`requested impulse ${impulse}; actual ${actualImpulse}`);
  h.run('releaseAction();');h.tick(60);
  assert.equal(h.run('action.state'),'RESTING');
  assert.equal(h.run('gestures.at(-1).kind'),'slap');
  assert.ok(h.metrics().finite);
  return {impulse:actualImpulse, ...h.metrics()};
}
// A steady swipe like a hand: after the 250 ms hold, move events at 60 Hz with constant velocity
// gestureScale·impulse/IMPULSE_K along the radius the grabbed rim had at the start, a physics frame
// between events, two more events after the lift starts. The held rim moves between the events, so
// the delivered strength is not the requested one (at compliance 30 it is 1.6–2.6 for 2.3); what must
// hold exactly is the recognition itself: the hand speed at the lift is the speed between the two
// last events, and the strength is the stand's formula along the grabbed rim at that moment.
function swipe(h, index, impulse=2.3) {
  assert.equal(h.run('action.state'),'RESTING');
  const angle=index*Math.PI/2;
  h.run(`{const c=centerOfSheet(),r=sheetRadius();armAction("test",{x:c.x+Math.cos(${angle})*r,y:c.y+Math.sin(${angle})*r});}`);
  h.tick(15);
  h.run(`{const c=centerOfSheet(),r=Math.hypot(px[action.edgeNode]-c.x,py[action.edgeNode]-c.y);globalThis.__slap={x:action.last.x,y:action.last.y,dx:(px[action.edgeNode]-c.x)/r,dy:(py[action.edgeNode]-c.y)/r,v:gestureScale*${impulse}/IMPULSE_K};}`);
  let lifted=-1, speed=null, formula=null;
  for(let k=1;k<=12 && (lifted<0 || k<=lifted+2);k++){
    h.tick();
    h.run(`updateActionMove({x:__slap.x+__slap.dx*__slap.v*${k}/60,y:__slap.y+__slap.dy*__slap.v*${k}/60});`);
    if(lifted<0 && h.run('action.state')==='LIFTING'){
      lifted=k;
      speed=h.run('Math.hypot(action.velocity.x,action.velocity.y)/__slap.v');
      formula=h.run(`(()=>{const c=action.liftC||centerOfSheet(),e=action.edgeNode,rl=Math.hypot(px[e]-c.x,py[e]-c.y)||1,rx=(px[e]-c.x)/rl,ry=(py[e]-c.y)/rl,v=action.velocity,out=Math.max(0,v.x*rx+v.y*ry),tan=Math.abs(rx*v.y-ry*v.x);return Math.min(IMPULSE_MAX,IMPULSE_K*(out+0.55*tan)/Math.max(1,gestureScale));})()`);
    }
  }
  assert.ok(lifted>0,'native straight swipe reaches LIFTING');
  assert.equal(h.run('action.state'),'LIFTING','swipe still lifting two events later');
  const actualImpulse=h.run('action.impulse');
  assert.ok(Math.abs(speed-1)<1e-6,`hand speed at the lift is the speed between the last two events: ${speed} of the swipe`);
  assert.ok(Math.abs(actualImpulse-formula)<1e-6,`impulse is the stand's formula along the grabbed rim at the lift: ${formula}; actual ${actualImpulse}`);
  h.run('releaseAction();');h.tick(60);
  assert.equal(h.run('action.state'),'RESTING');
  assert.equal(h.run('gestures.at(-1).kind'),'slap');
  assert.ok(h.metrics().finite);
  return {impulse:actualImpulse, liftEvent:lifted, ...h.metrics()};
}
module.exports={boot,press,slap,swipe,sourcePath,sourceSha256:crypto.createHash('sha256').update(source).digest('hex')};
if(require.main===module){
test('standalone script boots and executes three render/physics frames',()=>{const h=boot();h.tick(3,1/60,true);assert.deepEqual(h.errors,[]);assert.equal(h.metrics().n,1060);assert.equal(h.run('loopErrs'),0);return h.metrics();});
test('identical seed produces identical initial geometry across tuning presets',()=>{const a=boot({com:30,creep:30,brk:72}),b=boot({com:100,creep:100,brk:100});assert.equal(a.run('JSON.stringify(Array.from(px))'),b.run('JSON.stringify(Array.from(px))'));assert.equal(a.run('JSON.stringify(Array.from(py))'),b.run('JSON.stringify(Array.from(py))'));});
test('resting mesh is stable and rigid transform preserves area/radius/thickness',()=>{const h=boot({com:100,creep:100,brk:100});const a=h.metrics();h.tick(120);const b=h.metrics();assert.ok(Math.abs(b.radius/a.radius-1)<1e-4);assert.ok(Math.abs(b.area/a.area-1)<1e-4);h.run('{const c=centerOfSheet();xf={cx:c.x,cy:c.y};bakeTransform(111,-37,1.2);xf=null;measureThickness();}');const c=h.metrics();assert.ok(Math.abs(c.radius/b.radius-1)<1e-4);assert.ok(Math.abs(c.area/b.area-1)<1e-4);assert.ok(Math.abs(c.medianThickness-b.medianThickness)<1e-4);assert.ok(c.finite);return {before:a,after:c};});
for(const tuple of [[30,30,72],[100,100,100],[100,100,72],[100,30,72],[30,100,72]]) {
  const name=tuple.join('/');
  test(`same press and five moderate native slaps: ${name}`,()=>{
    const h=boot({com:tuple[0],creep:tuple[1],brk:tuple[2]});const before=h.metrics(),flatten=press(h),slaps=[];
    for(let i=0;i<5;i++)slaps.push(slap(h,i,2.3));
    const last=slaps.at(-1);h.tick(120);const retained=h.metrics();
    assert.ok(last.area>flatten.metrics.area,'slaps grow sheet area');assert.ok(last.radius>flatten.metrics.radius,'slaps grow body radius');assert.ok(retained.finite);assert.ok(retained.area>flatten.metrics.area,'growth retained after two seconds');assert.ok(retained.radius>flatten.metrics.radius,'radius growth retained after two seconds');
    const record={preset:name,flattenSeconds:flatten.seconds,progressAfterFlatten:flatten.metrics.progress,progressAfterEachSlap:slaps.map(s=>s.progress),areaAfterFlatten:flatten.metrics.area,invertedAfterFlatten:flatten.metrics.invertedQuads,invertedAfterSlaps:last.invertedQuads,areaAfterSlaps:last.area,areaRatio:last.areaRatio,retention:{radius:retained.radius/last.radius,area:retained.area/last.area},broken:last.broken,holeQuads:last.holeQuads,minThickness:last.minThickness,medianThickness:last.medianThickness};outputs.push(record);return record;
  });
}
test('steady 60 Hz swipe: speed between neighbouring events, impulse by the stand formula',()=>{
  const h=boot({com:100,creep:100,brk:100});press(h);const rows=[];
  for(let i=0;i<5;i++){const r=swipe(h,i,2.3);rows.push({impulse:r.impulse,liftEvent:r.liftEvent,invertedQuads:r.invertedQuads,progress:r.progress});}
  assert.ok(rows.every(r=>r.impulse>2&&r.impulse<2.6),'a 2.3 swipe on the stiff sheet stays a moderate slap');
  return rows;
});
test('maximum strength still allows native thickness tear criterion',()=>{
  const h=boot({com:100,creep:100,brk:100});h.advance(2000);
  // Synthetic fixture: uniformly expand actual coordinates to 1/sqrt(.002)
  // and recalculate thickness. This intentionally bypasses normal growth caps,
  // so it proves reachability of checkBreak, NOT reachability by ordinary input.
  h.run('{const c=centerOfSheet(),s=1/Math.sqrt(0.002);for(let i=0;i<N;i++){px[i]=c.x+(px[i]-c.x)*s;py[i]=c.y+(py[i]-c.y)*s;}measureThickness();for(let i=0;i<120;i++)checkBreak(1/60);}');
  const m=h.metrics();assert.ok(m.threshold>0);assert.ok(m.broken>0);assert.ok(h.run('tornAt')>0);assert.ok(m.finite);return m;
});
test('maximum strength still allows strong-slap tear on naturally flattened sheet',()=>{
  const h=boot({com:100,creep:100,brk:100});const flatten=press(h);const results=[];
  for(let i=0;i<8&&!h.metrics().broken;i++)results.push(slap(h,i,3.5));
  const m=h.metrics();assert.ok(m.broken>0,'native impactAction punches hole at high impulse on thin sheet');assert.ok(m.holeQuads>0);assert.ok(h.run('tornAt')>0);assert.ok(m.finite);return {flatten,slapsToTear:results.length,slaps:results};
});
test('intact thin quads remain rendered; broken topology still renders actual holes',()=>{
  const h=boot({com:100,creep:100,brk:100});
  // Step 1 is drawn by the flatten map, not by thickness (e4f7a81): fill both.
  h.run('thick.fill(0.01);if(stepNo===1&&typeof flatH!=="undefined"&&flatH)flatH.fill(0.01);draw();');
  assert.equal(h.drawCalls.length,h.run('quads.length'),'all intact .01-thickness quads draw despite former .02 visual cutoff');
  h.drawCalls.length=0;
  // Break a quad at the sheet centre through the native topology mutation. Holes are drawn from
  // step 2 on: a step-1 lump is always drawn as a disc (sheetLooksDisc), and it does not tear.
  h.run('{stepNo=2;const c=centerOfSheet();let best=0,bd=Infinity;quads.forEach((q,k)=>{const x=q.reduce((s,n)=>s+px[n],0)/4,y=q.reduce((s,n)=>s+py[n],0)/4,d=(x-c.x)**2+(y-c.y)**2;if(d<bd){bd=d;best=k;}});for(const c of quadCons[best])breakCon(c);onTear();draw();}');
  assert.ok(h.metrics().broken>0);assert.ok(h.drawCalls.some(c=>c.fillStyle==='#100a06'),'native broken quad is drawn as a hole');
  return {closedPaths:h.drawCalls.length,holePaths:h.drawCalls.filter(c=>c.fillStyle==='#100a06').length};
});
test('saved material preferences survive startup and gesture log captures material snapshot',()=>{
  const tune={com:30,creep:30,brk:72},h=boot(tune);
  assert.equal(h.run('JSON.stringify(TUNE)'),JSON.stringify(tune));
  assert.equal(h.storage.get('dough_tune'),JSON.stringify(tune));
  h.run('action.impulse=2.3;finalizeGesture();');
  assert.equal(h.run('gestures.at(-1).build'),h.run('BUILD'));
  assert.equal(h.run('JSON.stringify(gestures.at(-1).tune)'),JSON.stringify(tune));
  h.run('TUNE.com=100;TUNE.creep=100;TUNE.brk=100;applyTune();');
  assert.equal(h.run('JSON.stringify(gestures.at(-1).tune)'),JSON.stringify(tune),'older gesture keeps copied tune snapshot');
});
test('default reset applies 100/100/100 and preserves the existing mesh',()=>{
  const h=boot({com:30,creep:30,brk:72});h.run('globalThis.meshBeforeReset=px;');
  h.nodes.get('tuneDefault').fire('click');
  assert.equal(h.run('JSON.stringify(TUNE)'),JSON.stringify({com:100,creep:100,brk:100}));
  assert.equal(h.run('px===meshBeforeReset'),true);
  for(const id of ['sCom','sCreep','sBreak'])assert.equal(Number(h.nodes.get(id).value),100);
  const malformed=boot({com:150,creep:-10,brk:'bad'});
  assert.equal(malformed.run('JSON.stringify(TUNE)'),JSON.stringify({com:100,creep:0,brk:100}));
});
test('landing under-stretched sheet sets PAN and step 3 while retaining mesh and tears',()=>{
  const h=boot({com:100,creep:100,brk:100});
  h.run('stepNo=2;build();breakCon(cons[0]);onTear();globalThis.landingMesh=px;');
  const before=h.metrics();
  h.run('{const c=centerOfSheet(),dx=panC.x-c.x,dy=panC.y-c.y,d=Math.hypot(dx,dy);xf={cx:c.x,cy:c.y,ox:0,oy:0,th:0,lift:0};action.sweep=1;startToss(c.x,c.y,{x:dx/d,y:dy/d},d);}');
  h.tick(40);
  const after=h.metrics();
  assert.equal(after.phase,'PAN');assert.equal(after.stepNo,3);assert.equal(after.state,'RESTING');
  assert.equal(h.run('px===landingMesh'),true);assert.equal(after.broken,before.broken);assert.equal(after.holeQuads,before.holeQuads);assert.ok(after.finite);
  assert.ok(Math.abs(after.area/before.area-1)<1e-4);assert.ok(Math.abs(after.radius/before.radius-1)<1e-4);
  assert.equal(h.storage.get('dough_step'),'3');assert.equal(h.run('gestures.at(-1).kind'),'toss');
  assert.equal(h.run('gestures.at(-1).build'),h.run('BUILD'));return {before,after};
});
test('material changes remain mixed after reverting; only a rebuilt clean sheet counts toward /30',()=>{
  const tune={com:30,creep:30,brk:72},h=boot(tune);
  assert.equal(h.run('mixedTune'),false,'new sheet is clean');
  assert.equal(h.run('JSON.stringify(runTuneAtBuild)'),JSON.stringify(tune));
  h.run('globalThis.startContext=measurementContext();globalThis.mixedMesh=px;applyTune();');
  assert.equal(h.run('mixedTune'),false,'applying identical values does not mark a clean sheet mixed');
  h.run('TUNE.com=100;applyTune();');
  assert.equal(h.run('mixedTune'),true,'changing material marks existing sheet mixed');
  h.run('TUNE.com=30;applyTune();');
  assert.equal(h.run('mixedTune'),true,'returning initial values does not erase mixed history');
  assert.equal(h.run('px===mixedMesh'),true,'changing material retains the played mesh');
  assert.equal(h.run('JSON.stringify(startContext.runTuneAtBuild)'),JSON.stringify(tune),'starting material is copied into older snapshots');
  h.run('breakCon(cons[0]);onTear();');
  assert.equal(h.run('log.at(-1).mixedTune'),true);
  assert.equal(h.run('currentMeasurement(log.at(-1))'),false,'mixed sheet excluded from counted attempts');
  assert.equal(h.run('JSON.stringify(log.at(-1).runTuneAtBuild)'),JSON.stringify(tune));
  h.run('reset();');
  assert.equal(h.run('mixedTune'),false,'reset builds a clean sheet');
  assert.equal(h.run('px===mixedMesh'),false,'reset actually rebuilds geometry');
  h.run('breakCon(cons[0]);onTear();');
  assert.equal(h.run('log.at(-1).mixedTune'),false);
  assert.equal(h.run('currentMeasurement(log.at(-1))'),true,'new clean sheet counts');
  assert.equal(h.run('currentMeasurement(log[0])'),false,'prior mixed entry remains excluded after reset');
  assert.equal(h.run('log.filter(currentMeasurement).length'),1,'only clean run counts toward /30');
  assert.equal(h.run('currentMeasurement({build:BUILD,variant,condition,tune:{...TUNE}})'),false,'legacy record without mixed provenance is not silently treated as clean');
  return JSON.parse(h.run('JSON.stringify(log.map(({tune,runTuneAtBuild,mixedTune})=>({tune,runTuneAtBuild,mixedTune})))'));
});
test('resize on the table keeps the played sheet; only layout and scale change',()=>{
  // Rotation and the Safari bar resize the stage; up to build 65 resize() rebuilt the sheet on the
  // table (steps 1–3): the flattened lump or the stretched sheet became a fresh disc.
  const h=boot({com:100,creep:100,brk:100});
  h.run('armAction("test",centerOfSheet());');h.tick(30);h.run('releaseAction();');h.tick(30);
  assert.equal(h.run('stepNo'),1,'a short press leaves the lump on step 1');
  const flat=()=>h.run('Array.from(flatH).reduce((s,v)=>s+v,0)/N');
  const f0=flat(),p0=h.metrics();h.run('globalThis.resizeMesh=px;');
  assert.ok(f0<1,'the press flattened something');
  h.viewport(600,1000);h.tick(2);
  assert.equal(h.run('px===resizeMesh'),true,'step 1: portrait keeps the mesh');
  assert.ok(Math.abs(flat()-f0)<1e-9,'step 1: flatten map kept');
  assert.ok(Math.abs(h.metrics().progress-p0.progress)<1e-3,'step 1: size relative to the target kept');
  h.viewport(1000,600);h.tick(2);
  press(h);for(let i=0;i<2;i++)slap(h,i,2.3);h.tick(60);
  const a=h.metrics();h.run('globalThis.resizeMesh=px;');
  const rows=[];
  for(const [w,hh] of [[1000,480],[600,1000],[1000,600]]){
    h.viewport(w,hh);h.tick(2);const b=h.metrics();
    assert.equal(h.run('px===resizeMesh'),true,`step 2 ${w}×${hh}: mesh kept`);
    assert.equal(b.stepNo,a.stepNo);assert.equal(b.phase,'TABLE');assert.equal(b.broken,a.broken);
    assert.ok(Math.abs(b.progress-a.progress)<2e-3,`step 2 ${w}×${hh}: size relative to the target ${a.progress} → ${b.progress}`);
    assert.ok(Math.abs(b.areaRatio-a.areaRatio)<2e-3,`step 2 ${w}×${hh}: stretch ${a.areaRatio} → ${b.areaRatio}`);
    assert.ok(Math.abs(b.medianThickness-a.medianThickness)<2e-3,`step 2 ${w}×${hh}: thickness ${a.medianThickness} → ${b.medianThickness}`);
    assert.ok(Math.abs(b.invertedQuads-a.invertedQuads)<=2,`step 2 ${w}×${hh}: inverted quads`);
    rows.push({size:[w,hh],progress:b.progress,areaRatio:b.areaRatio,medianThickness:b.medianThickness,canvas:h.run('[cv.width,cv.height]')});
  }
  assert.ok(slap(h,2,2.3).finite,'slaps still work after the resizes');
  return {step1:{flatMap:f0,progress:p0.progress},step2:{progress:a.progress,areaRatio:a.areaRatio,medianThickness:a.medianThickness},rows};
});
const report={sourcePath,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),createdAt:new Date().toISOString(),limitations:['Pure Node vm; DOM, Canvas and audio are mocks. No real browser rendering, audio, touch feeling, event coalescing or iPhone timing measured.','Fixed virtual 60 Hz, seeded random, 1000×600 CSS-pixel stage at DPR 1. Results are not device performance measurements.','Action tests call native internal arm/update/release functions in table coordinates; no onDown/onMove DOM projection or comma toss recognition.','Thickness-criterion fixture expands geometry beyond ordinary growth caps; strong-slap tear test uses naturally flattened sheet.','Moderate slap impulse is 2.3, below the independent punch-hole threshold 2.9. Growth figures are scenario observations, not calibrated recommendations.'],tests,comparison:outputs};
const reportDir=process.env.CHECKS_OUT||path.join(__dirname,'..','..','..','runs','checks');fs.mkdirSync(reportDir,{recursive:true});
const reportPath=path.join(reportDir,'model-regression-results.json');fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({tests:tests.map(({name,status,error})=>({name,status,error})),comparison:outputs,reportPath},null,2));
if(tests.some(t=>t.status==='FAIL'))process.exitCode=1;

}
