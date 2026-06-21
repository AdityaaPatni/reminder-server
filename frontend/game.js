/* Penalty Kings — World Class Edition v3 */
(function () {
'use strict';

// ─── Canvas ─────────────────────────────────────────────────────────────────
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const W = 400, H = 530;
const DPR = Math.min(window.devicePixelRatio || 1, 3);
canvas.width  = W * DPR; canvas.height = H * DPR;
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
ctx.scale(DPR, DPR);

const $ = id => document.getElementById(id);

// ─── Screens ────────────────────────────────────────────────────────────────
let currentScreen = 'menu';
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('s-' + id).classList.add('active');
  currentScreen = id;
}

// ─── Constants ──────────────────────────────────────────────────────────────
const GL = 60, GR = 340, GT = 82, GB = 285;
const GW = GR - GL, GH = GB - GT;
const GK0X = (GL + GR) / 2, GK0Y = GT + GH * 0.5;
const B0X = W / 2, B0Y = H - 62;
const BALL_R = 20;
const MAX_SWIPE = 130;
// 3-D goal depth
const BGL = GL + 22, BGR = GR - 22, BGT = GT + 16, BGB = GB + 3;

const LEVEL_NAMES = ['Amateur','Semi-Pro','Pro','Elite','World Class','Legend'];
const LEVEL_XP    = [100, 250, 500, 1000, 2000, Infinity];

const GK_CFG = [
  { name:'Bruno',     jersey:'#e05b1a', reach:44, accuracy:.38, react:.58 },
  { name:'Marco',     jersey:'#2266cc', reach:52, accuracy:.52, react:.46 },
  { name:'Diaz',      jersey:'#1a8833', reach:60, accuracy:.63, react:.35 },
  { name:'De Bruyne', jersey:'#881aaa', reach:68, accuracy:.74, react:.25 },
  { name:'AI-1000',   jersey:'#111111',  reach:76, accuracy:.86, react:.13 },
];

// ─── Persistence ────────────────────────────────────────────────────────────
let sv = (() => { try { return JSON.parse(localStorage.getItem('pk2')) || {}; } catch { return {}; } })();
sv.xp         = sv.xp         || 0;
sv.level      = sv.level      || 1;
sv.totalGoals = sv.totalGoals || 0;
sv.highScore  = sv.highScore  || 0;
sv.careerWins = sv.careerWins || 0;
sv.shots      = sv.shots      || [];
sv.dailyDate  = sv.dailyDate  || '';
sv.dailyScore = sv.dailyScore ?? null;
function savePersist() { localStorage.setItem('pk2', JSON.stringify(sv)); }
savePersist();

function addXP(n) {
  sv.xp += n;
  const need = LEVEL_XP[sv.level - 1];
  if (sv.xp >= need && sv.level < LEVEL_NAMES.length) { sv.xp -= need; sv.level++; savePersist(); return true; }
  savePersist(); return false;
}
function refreshMenuXP() {
  const need = LEVEL_XP[sv.level - 1];
  const pct  = need === Infinity ? 100 : sv.xp / need * 100;
  $('m-xp').style.width    = pct + '%';
  $('m-xlabel').textContent = `${sv.xp} / ${need === Infinity ? '∞' : need} XP`;
  $('m-lvl').textContent    = `LEVEL ${sv.level} · ${LEVEL_NAMES[sv.level - 1].toUpperCase()}`;
}

// ─── Game state ─────────────────────────────────────────────────────────────
let mode = 'quick', phase = 'idle';
let goals = 0, kicks = 0, maxKicks = 5;
let gkCfgIdx = 0, gkCfg = GK_CFG[0];
let arcadeEnd = 0;

let sw0 = null, swC = null, swPow = 0, swDir = { x: 0, y: -1 };

let bx = B0X, by = B0Y, bScale = 1, bAngle = 0;
let trail = [];
let stx = 0, sty = 0, sPow = 0, sSpin = 0;

let gkX = GK0X, gkAngle = 0, gkTX = GK0X;
let gkExprT = 0, gkIsHappy = false;

let repFrames = [], repIdx = 0;
let shootT = 0;
const SHOOT_DUR = 0.65;

let popMsg = '', popAlpha = 0;
let flashAlpha = 0;
let particles = [];
let crowdExcite = 0.15;
let netV = buildNet();
let lastGoalX = 0, lastGoalY = 0, netActive = false, netPhase = 0;
let isGoal = false;
let screenShake = 0;
let lastTs = 0, gameActive = false;

// Pre-baked crowd data
const crowd = Array.from({ length: 140 }, () => ({
  x: Math.random() * W,
  y: 4 + Math.random() * 58,
  c: ['#c03030','#2255aa','#bb9922','#228844','#aa5522','#886688','#884444','#2244aa'][Math.floor(Math.random() * 8)],
  ph: Math.random() * Math.PI * 2,
  sp: 1.6 + Math.random() * 2.6,
  size: 3.5 + Math.random() * 2,
}));

function buildNet() {
  const cols = 14, rows = 11, v = [];
  for (let r = 0; r <= rows; r++) {
    const row = [];
    for (let c = 0; c <= cols; c++) {
      const ox = GL + GW / cols * c, oy = GT + GH / rows * r;
      row.push({ x: ox, y: oy, ox, oy, vx: 0, vy: 0 });
    }
    v.push(row);
  }
  return v;
}

// ─── GK AI ──────────────────────────────────────────────────────────────────
function gkDecide(relX) {
  const hist = sv.shots.slice(-6);
  let bias = hist.length >= 3 ? hist.reduce((s, v) => s + v, 0) / hist.length : 0;
  const eff = relX + bias * gkCfgIdx * 0.18;
  const r   = Math.random();
  if (r < gkCfg.accuracy) {
    return eff < -.22 ? GL + 44 : eff > .22 ? GR - 44 : GK0X;
  }
  if (eff < -.22)     return Math.random() < .5 ? GK0X : GR - 44;
  if (eff > .22)      return Math.random() < .5 ? GK0X : GL + 44;
  return Math.random() < .5 ? GL + 44 : GR - 44;
}

// ─── Audio (satisfying arcade pops — all sine waves, clean envelopes) ───────
let AC;
function ac() { return AC || (AC = new (window.AudioContext || window.webkitAudioContext)()); }

function sineNote(freq, startT, duration, vol, freqEnd) {
  try {
    const a = ac(), o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, startT);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, startT + duration);
    g.gain.setValueAtTime(0, startT);
    g.gain.linearRampToValueAtTime(vol, startT + 0.012);
    g.gain.setValueAtTime(vol * 0.85, startT + duration * 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, startT + duration);
    o.connect(g); g.connect(a.destination);
    o.start(startT); o.stop(startT + duration + 0.01);
  } catch {}
}

function noiseBurst(startT, duration, vol, cutoff) {
  try {
    const a = ac();
    const len = Math.floor(a.sampleRate * duration);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.3));
    const src = a.createBufferSource();
    src.buffer = buf;
    const flt = a.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = cutoff; flt.Q.value = 4;
    const g = a.createGain();
    g.gain.setValueAtTime(vol, startT);
    g.gain.exponentialRampToValueAtTime(0.001, startT + duration);
    src.connect(flt); flt.connect(g); g.connect(a.destination);
    src.start(startT); src.stop(startT + duration + 0.01);
  } catch {}
}

function sfxKick() {
  try {
    const now = ac().currentTime;
    sineNote(90, now, 0.09, 0.55, 35);        // bass thump
    noiseBurst(now, 0.025, 0.3, 800);          // leather click
  } catch {}
}

function sfxGoal() {
  try {
    const now = ac().currentTime;
    // Bright ascending arpeggio (C E G C E)
    [523, 659, 784, 1047, 1318].forEach((f, i) => {
      sineNote(f, now + i * 0.11, 0.32, 0.2);
      sineNote(f * 2, now + i * 0.11, 0.18, 0.07); // octave harmonic
    });
    // Crowd whoosh after
    setTimeout(() => setCrowd(1), 250);
  } catch {}
}

function sfxSave() {
  try {
    const now = ac().currentTime;
    sineNote(440, now, 0.06, 0.28, 440);
    sineNote(330, now + 0.06, 0.12, 0.22, 260);
    noiseBurst(now, 0.06, 0.18, 2000);
  } catch {}
}

function sfxMiss() {
  try {
    const now = ac().currentTime;
    sineNote(300, now, 0.15, 0.2, 180);
  } catch {}
}

function sfxWhistle() {
  try {
    const now = ac().currentTime;
    [0, 0.38].forEach(delay => {
      const t = now + delay;
      sineNote(880, t, 0.08, 0.28, 880);
      sineNote(1100, t + 0.07, 0.18, 0.26, 1100);
      sineNote(880, t + 0.22, 0.1, 0.22, 880);
    });
  } catch {}
}

function sfxLvlUp() {
  try {
    const now = ac().currentTime;
    [523, 659, 784, 1047, 1318, 1568].forEach((f, i) => sineNote(f, now + i * 0.09, 0.22, 0.18));
  } catch {}
}

let crowdOsc = null, crowdGainNode = null;
function setCrowd(lvl) {
  crowdExcite = lvl;
  try {
    const a = ac();
    if (crowdOsc) { try { crowdOsc.stop(); } catch {} crowdOsc = null; }
    if (crowdGainNode) { crowdGainNode.disconnect(); crowdGainNode = null; }
    if (lvl > 0.08) {
      // Layered sine waves for warm crowd sound instead of harsh sawtooth
      crowdOsc = a.createOscillator();
      crowdGainNode = a.createGain();
      crowdOsc.type = 'sine';
      crowdOsc.frequency.value = 140 + lvl * 60;
      crowdGainNode.gain.value = lvl * 0.05;
      crowdOsc.connect(crowdGainNode); crowdGainNode.connect(a.destination);
      crowdOsc.start();
    }
  } catch {}
}

// ─── Haptics ────────────────────────────────────────────────────────────────
const vib = p => { try { navigator.vibrate?.(p); } catch {} };

// ─── Commentary ─────────────────────────────────────────────────────────────
function say(t) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.rate = 1.2; u.pitch = 1.1; speechSynthesis.speak(u);
}
const GLINES = ['GOOOAL!','What a finish!','Top corner!','Unstoppable!'];
const SLINES = ['Saved!','Incredible stop!','What a dive!'];
const pick = a => a[Math.floor(Math.random() * a.length)];

// ─── Particles ──────────────────────────────────────────────────────────────
const PCOLS = ['#FFD700','#FF6B35','#00FF88','#FF3388','#00CFFF','#fff','#FF4444','#ffaa00'];
function burst(x, y) {
  for (let i = 0; i < 65; i++) {
    const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
    particles.push({
      x, y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 5,
      r: 2.5 + Math.random() * 4.5,
      c: PCOLS[Math.floor(Math.random() * PCOLS.length)],
      life: 1, decay: .013 + Math.random() * .013,
      rect: Math.random() < .4, rot: Math.random() * Math.PI, rv: (Math.random()-.5)*.25,
    });
  }
}

// ─── Net ────────────────────────────────────────────────────────────────────
function triggerNet(x, y) { netActive = true; netPhase = 0; lastGoalX = x; lastGoalY = y; }
function updateNet(dt) {
  if (!netActive) return;
  netPhase += dt / 1000;
  for (let r = 0; r < netV.length; r++) {
    for (let c = 0; c < netV[r].length; c++) {
      const v = netV[r][c];
      v.vx += (v.ox - v.x) * .14; v.vy += (v.oy - v.y) * .14;
      if (netPhase < 1.1) {
        const dx = v.ox - lastGoalX, dy = v.oy - lastGoalY, d = Math.sqrt(dx*dx+dy*dy);
        const w = Math.sin(d * .13 - netPhase * 13) * Math.exp(-d * .034) * 16;
        v.vy -= w * .85; v.vx += w * (dx/(d+1)) * .3;
      }
      v.vx *= .78; v.vy *= .78;
      v.x += v.vx * dt/16; v.y += v.vy * dt/16;
    }
  }
  if (netPhase > 2.8) { netActive = false; netV = buildNet(); }
}

// ─── Swipe input ────────────────────────────────────────────────────────────
function cvXY(cx, cy) {
  const r = canvas.getBoundingClientRect();
  return { x: (cx-r.left)*(W/r.width), y: (cy-r.top)*(H/r.height) };
}
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (phase !== 'aim') { if (phase === 'idle') {} return; }
  const p = cvXY(e.touches[0].clientX, e.touches[0].clientY);
  sw0 = p; swC = {...p}; phase = 'swipe';
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (phase !== 'swipe') return;
  swC = cvXY(e.touches[0].clientX, e.touches[0].clientY); calcSwipe();
}, { passive: false });
canvas.addEventListener('touchend', e => {
  e.preventDefault();
  if (phase !== 'swipe') return;
  swPow > .06 ? executeShot() : resetSwipe();
}, { passive: false });

let mdown = false;
canvas.addEventListener('mousedown', e => { if (phase !== 'aim') return; const p = cvXY(e.clientX,e.clientY); sw0=p; swC={...p}; phase='swipe'; mdown=true; });
canvas.addEventListener('mousemove', e => { if (!mdown||phase!=='swipe') return; swC=cvXY(e.clientX,e.clientY); calcSwipe(); });
canvas.addEventListener('mouseup',   e => { mdown=false; if (phase!=='swipe') return; swPow>.06?executeShot():resetSwipe(); });

function calcSwipe() {
  if (!sw0||!swC) return;
  const dx=swC.x-sw0.x, dy=swC.y-sw0.y, d=Math.sqrt(dx*dx+dy*dy);
  swPow=Math.min(d/MAX_SWIPE,1);
  if (d>4) swDir={x:dx/d,y:dy/d};
}
function resetSwipe() { sw0=null; swC=null; swPow=0; phase='aim'; }

function executeShot() {
  phase='shooting'; kicks++;
  sfxKick(); vib(18);
  const pow=Math.max(.3,swPow), relX=swDir.x, upY=-swDir.y;
  const htF=Math.max(0,Math.min(1,(upY+.3)/1.3));
  const mg=14;
  stx=clamp(GK0X+relX*(GW/2-mg)*(.4+pow*.6), GL+mg, GR-mg);
  sty=lerp(GB-mg, GT+mg, htF*Math.min(pow*1.4,1));
  sPow=pow; sSpin=relX*pow*.7;
  sv.shots.push(relX); if (sv.shots.length>20) sv.shots.shift(); savePersist();
  gkTX=gkDecide(relX);
  bx=B0X; by=B0Y; bScale=1; bAngle=0; trail=[];
  repFrames=[]; shootT=0;
  sw0=null; swC=null; swPow=0;
  updateHUD();
}

// ─── Update ─────────────────────────────────────────────────────────────────
function update(dt) {
  const sec = dt/1000, now = performance.now()/1000;

  if (phase==='shooting') {
    shootT += sec/SHOOT_DUR;
    const t=Math.min(shootT,1), ease=smoothStep(t);
    bx = lerp(B0X,stx,ease) + sSpin*ease*(1-ease)*58;
    by = lerp(B0Y,sty,ease) - Math.sin(t*Math.PI)*72;
    bScale=lerp(1,.47,ease); bAngle+=sec*9*sPow;
    trail.push({x:bx,y:by,s:bScale,a:.5});
    if (trail.length>10) trail.shift();
    if (t>gkCfg.react) {
      const gt=smoothStep(Math.min((t-gkCfg.react)/.5,1));
      gkX=lerp(GK0X,gkTX,gt);
      const lean=(gkTX>GK0X?1:gkTX<GK0X?-1:0)*.68;
      gkAngle=lean*Math.min((t-gkCfg.react)/.28,1);
    }
    repFrames.push({bx,by,bScale,bAngle,gkX,gkAngle});
    if (shootT>=1) resolveShot();
  }

  if (phase==='replay') {
    repIdx+=.3;
    if (repIdx>=repFrames.length) { phase='pause'; setTimeout(nextOrEnd,700); }
    else { const f=repFrames[Math.floor(repIdx)]; bx=f.bx; by=f.by; bScale=f.bScale; bAngle=f.bAngle; gkX=f.gkX; gkAngle=f.gkAngle; }
  }

  crowd.forEach(p => { p.cy = p.y + Math.sin(now*p.sp+p.ph)*(1.5+crowdExcite*8); });
  updateNet(dt);

  particles.forEach(p => { p.x+=p.vx; p.y+=p.vy; p.vy+=.32; p.vx*=.97; p.life-=p.decay*dt/16; if(p.rect) p.rot+=p.rv; });
  particles=particles.filter(p=>p.life>0);
  trail.forEach(t=>t.a-=.055);
  if (flashAlpha>0) flashAlpha=Math.max(0,flashAlpha-sec*3.5);
  if (popAlpha>0&&phase!=='pause'&&phase!=='replay') popAlpha=Math.max(0,popAlpha-sec*2.6);
  if (gkExprT>0) gkExprT-=dt;
  if (screenShake>0) screenShake=Math.max(0,screenShake-dt/40);

  if (mode==='arcade'&&phase==='aim') {
    const left=Math.max(0,(arcadeEnd-performance.now())/1000);
    $('hud-right').textContent=`⏱ ${Math.ceil(left)}s`;
    if (left<=0) { phase='pause'; setTimeout(showResult,500); }
  }
}

function resolveShot() {
  const inG=stx>GL+4&&stx<GR-4&&sty>GT+4&&sty<GB-4;
  isGoal=inG&&Math.abs(gkX-stx)>gkCfg.reach;
  if (isGoal) {
    goals++; sv.totalGoals++; savePersist();
    popMsg='GOAL!'; popAlpha=1; flashAlpha=1; screenShake=8;
    burst(stx,sty); triggerNet(stx,sty); setCrowd(1);
    sfxGoal(); vib([50,30,50,30,100]);
    say(pick(GLINES)); gkExprT=2200; gkIsHappy=false;
  } else {
    popMsg=inG?'SAVED!':'MISSED!'; popAlpha=1; flashAlpha=.4;
    if (!inG) sfxMiss(); else sfxSave();
    setCrowd(.12); say(inG?pick(SLINES):'Off target!');
    vib(35); gkExprT=2200; gkIsHappy=true;
  }
  updateHUD();
  if (isGoal) { setTimeout(()=>{ if(gameActive){phase='replay';repIdx=0;} },180); }
  else { phase='pause'; setTimeout(nextOrEnd,1600); }
}

function nextOrEnd() {
  if (!gameActive) return;
  popMsg='';
  const done=mode==='sudden'?!isGoal:mode==='arcade'?false:mode==='daily'?kicks>=1:kicks>=maxKicks;
  if (done) showResult(); else { resetRound(); phase='aim'; }
}

function resetRound() {
  bx=B0X; by=B0Y; bScale=1; bAngle=0; trail=[];
  gkX=GK0X; gkAngle=0; shootT=0; sw0=null;
  $('hint').textContent='SWIPE UP TO SHOOT';
}

// ─── HUD ────────────────────────────────────────────────────────────────────
function updateHUD() {
  if (mode==='sudden')      { $('hud-score').textContent=`🔥 ${goals} in a row`; $('hud-right').textContent=''; }
  else if (mode==='arcade') { $('hud-score').textContent=`⚽ ${goals} goals`; }
  else                      { $('hud-score').textContent=`⚽ ${goals} / ${kicks}`; $('hud-right').textContent=`${Math.max(0,maxKicks-kicks)} left`; }
}

// ─── Result ─────────────────────────────────────────────────────────────────
function showResult() {
  gameActive=false;
  const total=mode==='sudden'?goals:mode==='arcade'?goals:maxKicks;
  const xp=goals*28+(goals===maxKicks?100:0)+(mode==='career'?goals*15:0);
  if (goals>sv.highScore) sv.highScore=goals;
  if (mode==='daily') { sv.dailyDate=todayStr(); sv.dailyScore=goals; }
  if (mode==='career'&&goals>=3) sv.careerWins=Math.max(sv.careerWins,gkCfgIdx+1);
  savePersist();
  const leveled=addXP(xp);
  refreshMenuXP();
  $('r-title').textContent=mode==='sudden'?'STREAK OVER!':'FULL TIME!';
  $('r-score').textContent=mode==='sudden'?`${goals} in a row!`:`${goals} / ${total}`;
  const rtxt=goals===maxKicks?'⚽⚽⚽⚽⚽ PERFECT!':goals>=maxKicks*.8?'⚽⚽⚽⚽ World Class!':goals>=maxKicks*.6?'⚽⚽⚽ Clinical!':goals>=maxKicks*.4?'⚽⚽ Keep Going!':'⚽ Don\'t Give Up!';
  $('r-rating').textContent=mode==='sudden'?(goals>=10?'🏆 LEGEND!':goals>=5?'🔥 Incredible!':'💪 Keep going!'):rtxt;
  $('r-xp').textContent=`+${xp} XP`;
  $('r-xbar').style.width='0%';
  sfxWhistle(); showScreen('result');
  const need=LEVEL_XP[sv.level-1];
  const pct=need===Infinity?100:sv.xp/need*100;
  setTimeout(()=>{ $('r-xbar').style.width=pct+'%'; },300);
  if (leveled) setTimeout(showLevelUp,1300);
}

function showLevelUp() {
  $('lu-txt').textContent=`Level ${sv.level} — ${LEVEL_NAMES[sv.level-1]}`;
  $('lvlup').classList.add('on');
  sfxLvlUp(); vib([60,30,60,30,200]);
  setTimeout(()=>$('lvlup').classList.remove('on'),2600);
}

// ─── Game start ─────────────────────────────────────────────────────────────
function startGame(m,gkIdx=0) {
  mode=m; gkCfgIdx=Math.min(gkIdx,GK_CFG.length-1); gkCfg=GK_CFG[gkCfgIdx];
  goals=0; kicks=0; maxKicks=m==='shootout'?10:m==='daily'?1:5;
  particles=[]; popMsg=''; popAlpha=0; flashAlpha=0; screenShake=0;
  crowdExcite=.18; netV=buildNet(); netActive=false; shootT=0; gkExprT=0;
  if (m==='arcade') arcadeEnd=performance.now()+60000;
  const names={quick:'QUICK PLAY',shootout:'SHOOTOUT',sudden:'SUDDEN DEATH',arcade:'ARCADE 60s',career:`vs ${gkCfg.name.toUpperCase()}`,daily:'DAILY CHALLENGE'};
  $('hud-mode').textContent=names[m]||m.toUpperCase();
  resetRound(); updateHUD();
  gameActive=true; showScreen('game'); phase='aim';
  sfxWhistle(); setCrowd(.2);
}

// ═══════════════════════════════════════════════════════════════════
// WORLD-CLASS DRAW ENGINE
// ═══════════════════════════════════════════════════════════════════

function draw() {
  ctx.clearRect(0,0,W,H);

  // Screen shake
  const sx = screenShake > 0 ? (Math.random()-.5)*screenShake*1.2 : 0;
  const sy = screenShake > 0 ? (Math.random()-.5)*screenShake*.8 : 0;
  ctx.save();
  ctx.translate(sx, sy);

  drawStadium();
  drawCrowd();
  drawFloodlights();
  drawCheckerGrass();
  drawFieldLines();
  drawGoal3D();
  drawGK();
  drawTrail();
  drawBall(bx, by, bScale, bAngle);

  if (phase==='swipe')  { drawSwipeArrow(); drawArcGuide(); }
  if (phase==='aim')    drawBallPulse();

  drawParticles();
  drawVignette();

  if (flashAlpha>0) {
    ctx.fillStyle=isGoal?`rgba(255,220,50,${flashAlpha*.18})`:`rgba(255,60,30,${flashAlpha*.15})`;
    ctx.fillRect(0,0,W,H);
  }
  if (popMsg&&popAlpha>0) drawPop();
  if (phase==='replay')  drawReplayTag();

  ctx.restore();
}

// ── Stadium ──────────────────────────────────────────────────────────────────
function drawStadium() {
  // Sky gradient
  const sky=ctx.createLinearGradient(0,0,0,70);
  sky.addColorStop(0,'#020811'); sky.addColorStop(1,'#0c1e3a');
  ctx.fillStyle=sky; ctx.fillRect(0,0,W,70);

  // Stand silhouettes — left block
  ctx.fillStyle='#0a1428';
  ctx.beginPath();
  ctx.moveTo(0,68); ctx.lineTo(0,50); ctx.lineTo(15,44); ctx.lineTo(30,38);
  ctx.lineTo(55,32); ctx.lineTo(80,28); ctx.lineTo(100,25); ctx.lineTo(130,22);
  ctx.lineTo(130,68); ctx.closePath(); ctx.fill();

  // Stand silhouette — right block
  ctx.beginPath();
  ctx.moveTo(W,68); ctx.lineTo(W,50); ctx.lineTo(W-15,44); ctx.lineTo(W-30,38);
  ctx.lineTo(W-55,32); ctx.lineTo(W-80,28); ctx.lineTo(W-100,25); ctx.lineTo(W-130,22);
  ctx.lineTo(W-130,68); ctx.closePath(); ctx.fill();

  // Stand tier lines
  ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1;
  [48,56,64].forEach(y => { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); });

  // Advertising boards strip
  ctx.fillStyle='#0d1a2e';
  ctx.fillRect(0,66,W,8);
  // Board highlights (colored ad panels)
  const adColors=['#cc1122','#1144cc','#228833','#cc8811','#551188'];
  for (let i=0;i<12;i++) {
    ctx.fillStyle=adColors[i%adColors.length];
    ctx.fillRect(6+i*34,67,28,5);
    ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.fillRect(7+i*34,67.5,26,1);
  }

  // Grass base
  const gr=ctx.createLinearGradient(0,280,0,H);
  gr.addColorStop(0,'#1d7a1d'); gr.addColorStop(.5,'#145514'); gr.addColorStop(1,'#083008');
  ctx.fillStyle=gr; ctx.fillRect(0,280,W,H-280);
}

// ── Checker grass ────────────────────────────────────────────────────────────
function drawCheckerGrass() {
  // Alternating lighter/darker green stripes with perspective
  const stripeCount=8, yStart=282, yEnd=H;
  for (let i=0;i<stripeCount;i++) {
    const t0=i/stripeCount, t1=(i+1)/stripeCount;
    const y0=lerp(yStart,yEnd,t0), y1=lerp(yStart,yEnd,t1);
    ctx.fillStyle=i%2===0?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.06)';
    ctx.fillRect(0,y0,W,y1-y0);
  }
}

// ── Floodlights ──────────────────────────────────────────────────────────────
function drawFloodlights() {
  [[44,64],[356,64]].forEach(([lx,ly]) => {
    // Pole
    const poleGrad=ctx.createLinearGradient(lx-3,0,lx+3,0);
    poleGrad.addColorStop(0,'#444'); poleGrad.addColorStop(.5,'#999'); poleGrad.addColorStop(1,'#444');
    ctx.fillStyle=poleGrad; ctx.fillRect(lx-3,ly-58,6,58);

    // Head
    ctx.fillStyle='#bbb'; ctx.fillRect(lx-13,ly-62,26,10);
    ctx.fillStyle='#eee'; ctx.fillRect(lx-12,ly-61,24,3);

    // Lens squares
    const dir=lx<W/2?1:-1;
    ['#fffff0','#ffffd0','#ffffe0'].forEach((c,i) => {
      ctx.fillStyle=c;
      ctx.fillRect(lx+dir*(2+i*5)-2,ly-61,4,4);
    });

    // Glow corona
    const glow=ctx.createRadialGradient(lx,ly,0,lx,ly,70);
    glow.addColorStop(0,'rgba(255,255,200,0.4)');
    glow.addColorStop(.4,'rgba(255,255,180,0.12)');
    glow.addColorStop(1,'rgba(255,255,180,0)');
    ctx.fillStyle=glow; ctx.fillRect(lx-70,ly-70,140,140);

    // Light beam cone
    const beam=ctx.createLinearGradient(lx,ly,lx+dir*160,H);
    beam.addColorStop(0,'rgba(255,255,200,0.09)');
    beam.addColorStop(1,'rgba(255,255,200,0)');
    ctx.fillStyle=beam;
    ctx.beginPath();
    ctx.moveTo(lx,ly);
    ctx.lineTo(lx+dir*130,H);
    ctx.lineTo(lx+dir*210,H);
    ctx.closePath(); ctx.fill();
  });
}

// ── Crowd ────────────────────────────────────────────────────────────────────
function drawCrowd() {
  crowd.forEach(p => {
    const y=p.cy||p.y;
    ctx.fillStyle=p.c;
    ctx.beginPath(); ctx.ellipse(p.x,y,p.size,p.size*1.4,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#f0c090';
    ctx.beginPath(); ctx.arc(p.x,y-p.size*1.8,p.size*.88,0,Math.PI*2); ctx.fill();
  });
  // Crowd fade at top
  const ov=ctx.createLinearGradient(0,0,0,72);
  ov.addColorStop(0,'rgba(2,8,17,0.78)'); ov.addColorStop(1,'rgba(2,8,17,0)');
  ctx.fillStyle=ov; ctx.fillRect(0,0,W,72);
}

// ── Field lines ──────────────────────────────────────────────────────────────
function drawFieldLines() {
  ctx.strokeStyle='rgba(255,255,255,0.42)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(GL-8,GB); ctx.lineTo(GR+8,GB); ctx.stroke();
  const b6=GW*.16;
  ctx.strokeRect(GL+b6,GB,GW-b6*2,30);
  ctx.strokeRect(GL-18,GB,GW+36,62);
  ctx.fillStyle='rgba(255,255,255,0.7)';
  ctx.beginPath(); ctx.arc(W/2,B0Y,4,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(W/2,B0Y,58,Math.PI,Math.PI*2); ctx.stroke();
}

// ── 3-D Goal ─────────────────────────────────────────────────────────────────
function drawGoal3D() {
  // Back net surface panels (fill before posts so posts are on top)
  // Top panel (front crossbar to back crossbar)
  ctx.fillStyle='rgba(130,160,130,0.07)';
  ctx.beginPath(); ctx.moveTo(GL,GT); ctx.lineTo(GR,GT); ctx.lineTo(BGR,BGT); ctx.lineTo(BGL,BGT); ctx.closePath(); ctx.fill();
  // Left side panel
  ctx.beginPath(); ctx.moveTo(GL,GT); ctx.lineTo(GL,GB); ctx.lineTo(BGL,BGB); ctx.lineTo(BGL,BGT); ctx.closePath(); ctx.fill();
  // Right side panel
  ctx.beginPath(); ctx.moveTo(GR,GT); ctx.lineTo(GR,GB); ctx.lineTo(BGR,BGB); ctx.lineTo(BGR,BGT); ctx.closePath(); ctx.fill();

  // Net grid (physics-driven front, static for 3D depth walls)
  const rows=netV.length-1, cols=netV[0].length-1;
  ctx.strokeStyle='rgba(200,220,200,0.2)'; ctx.lineWidth=.65;
  for (let r=0;r<=rows;r++) {
    ctx.beginPath(); netV[r].forEach((v,c)=>c?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y)); ctx.stroke();
  }
  for (let c=0;c<=cols;c++) {
    ctx.beginPath(); netV.forEach((row,r)=>r?ctx.lineTo(row[c].x,row[c].y):ctx.moveTo(row[c].x,row[c].y)); ctx.stroke();
  }

  // Depth bars (corner posts going to back)
  ctx.strokeStyle='rgba(200,200,200,0.55)'; ctx.lineWidth=4; ctx.lineCap='round';
  [[GL,GT,BGL,BGT],[GR,GT,BGR,BGT],[GL,GB,BGL,BGB],[GR,GB,BGR,BGB]].forEach(([x1,y1,x2,y2]) => {
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  });

  // Back frame
  ctx.strokeStyle='rgba(180,180,180,0.6)'; ctx.lineWidth=4;
  ctx.beginPath();
  ctx.moveTo(BGL,BGT); ctx.lineTo(BGR,BGT);
  ctx.moveTo(BGL,BGB); ctx.lineTo(BGR,BGB);
  ctx.moveTo(BGL,BGT); ctx.lineTo(BGL,BGB);
  ctx.moveTo(BGR,BGT); ctx.lineTo(BGR,BGB);
  ctx.stroke();

  // Front posts — bright white with glow
  const P=10;
  ctx.shadowColor='rgba(255,255,255,0.85)'; ctx.shadowBlur=16;
  ctx.fillStyle='#ffffff';
  ctx.fillRect(GL-P/2, GT, P, GH+P/2);         // left
  ctx.fillRect(GR-P/2, GT, P, GH+P/2);         // right
  ctx.fillRect(GL-P/2, GT-P/2, GW+P, P);       // crossbar
  ctx.shadowBlur=0;

  // Post highlight stripe
  ctx.fillStyle='rgba(255,255,255,0.35)';
  ctx.fillRect(GL-P/2+1, GT+2, 3, GH-4);
  ctx.fillRect(GR-P/2+1, GT+2, 3, GH-4);
}

// ── GK — Athletic character ───────────────────────────────────────────────────
function drawGK() {
  ctx.save();
  ctx.translate(gkX, GK0Y);
  ctx.rotate(gkAngle);

  const jc  = gkCfg.jersey;
  const jcL = lightenHex(jc, 40);
  const jcD = darkenHex(jc, 35);

  // Ground shadow
  const sh=ctx.createRadialGradient(0,45,0,0,45,26);
  sh.addColorStop(0,'rgba(0,0,0,0.35)'); sh.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=sh; ctx.beginPath(); ctx.ellipse(0,45,26,8,0,0,Math.PI*2); ctx.fill();

  // --- Left leg ---
  const legG=ctx.createLinearGradient(-14,12,0,12);
  legG.addColorStop(0,'#1a1a1a'); legG.addColorStop(.5,'#2a2a2a'); legG.addColorStop(1,'#111');
  ctx.fillStyle=legG;
  ctx.beginPath();
  ctx.moveTo(-4,14); ctx.bezierCurveTo(-5,24,-11,32,-13,42);
  ctx.lineTo(-17,42); ctx.bezierCurveTo(-17,44,-14,44,-11,43);
  ctx.bezierCurveTo(-9,36,-4,25,-2,15); ctx.closePath(); ctx.fill();

  // --- Right leg ---
  const legG2=ctx.createLinearGradient(0,12,14,12);
  legG2.addColorStop(0,'#111'); legG2.addColorStop(.5,'#2a2a2a'); legG2.addColorStop(1,'#1a1a1a');
  ctx.fillStyle=legG2;
  ctx.beginPath();
  ctx.moveTo(4,14); ctx.bezierCurveTo(5,24,11,32,13,42);
  ctx.lineTo(17,42); ctx.bezierCurveTo(17,44,14,44,11,43);
  ctx.bezierCurveTo(9,36,4,25,2,15); ctx.closePath(); ctx.fill();

  // --- Boots ---
  [[-17,38,-4,38],[ 4,38,17,38]].forEach(([x1,y1,x2,y2],side)=>{
    const bx1=side?x1:x2, bx2=side?x2:x1;
    const bootG=ctx.createLinearGradient(bx1,38,bx2,38);
    bootG.addColorStop(0,'#0d0d0d'); bootG.addColorStop(.5,'#1a1a1a'); bootG.addColorStop(1,'#0d0d0d');
    ctx.fillStyle=bootG;
    ctx.beginPath();
    ctx.moveTo(x1,38); ctx.lineTo(x2,38);
    ctx.bezierCurveTo(x2+sign(x2)*2,38,x2+sign(x2)*3,42,x2+sign(x2)*1,45);
    ctx.lineTo(x1,45); ctx.closePath(); ctx.fill();
    // Highlight
    ctx.fillStyle='rgba(255,255,255,0.12)';
    ctx.fillRect(Math.min(x1,x2)+1,38,Math.abs(x2-x1)-2,3);
  });

  // --- Shorts ---
  const sG=ctx.createLinearGradient(-16,10,16,10);
  sG.addColorStop(0,'#111'); sG.addColorStop(.5,'#242424'); sG.addColorStop(1,'#111');
  ctx.fillStyle=sG;
  ctx.beginPath();
  ctx.moveTo(-16,10); ctx.lineTo(16,10); ctx.lineTo(17,24); ctx.lineTo(-17,24); ctx.closePath(); ctx.fill();

  // --- Jersey (body) ---
  const jG=ctx.createRadialGradient(-8,-18,2,4,0,28);
  jG.addColorStop(0,jcL); jG.addColorStop(.55,jc); jG.addColorStop(1,jcD);
  ctx.fillStyle=jG;
  ctx.beginPath();
  ctx.moveTo(-12,-28);
  ctx.bezierCurveTo(-15,-30,-22,-22,-26,-12);
  ctx.bezierCurveTo(-24,-6,-20,4,-18,10);
  ctx.lineTo(18,10);
  ctx.bezierCurveTo(20,4,24,-6,26,-12);
  ctx.bezierCurveTo(22,-22,15,-30,12,-28);
  ctx.bezierCurveTo(8,-31,-8,-31,-12,-28);
  ctx.closePath(); ctx.fill();

  // Jersey collar
  ctx.fillStyle=jcD;
  ctx.beginPath();
  ctx.moveTo(-6,-28); ctx.bezierCurveTo(-4,-32,4,-32,6,-28);
  ctx.lineTo(4,-26); ctx.bezierCurveTo(2,-29,-2,-29,-4,-26); ctx.closePath(); ctx.fill();

  // Jersey side panels
  ctx.fillStyle='rgba(255,255,255,0.1)';
  ctx.beginPath(); ctx.moveTo(-18,-5); ctx.lineTo(-14,-5); ctx.lineTo(-14,10); ctx.lineTo(-18,10); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(18,-5); ctx.lineTo(14,-5); ctx.lineTo(14,10); ctx.lineTo(18,10); ctx.closePath(); ctx.fill();

  // Jersey number
  ctx.fillStyle='rgba(255,255,255,0.92)';
  ctx.font='bold 14px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('1',0,-8);

  // --- Left arm ---
  ctx.strokeStyle=jc; ctx.lineWidth=12; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(-20,-14); ctx.quadraticCurveTo(-30,-6,-33,4); ctx.stroke();
  ctx.strokeStyle=jcL; ctx.lineWidth=4;
  ctx.beginPath(); ctx.moveTo(-20,-14); ctx.quadraticCurveTo(-30,-6,-33,4); ctx.stroke();

  // --- Right arm ---
  ctx.strokeStyle=jc; ctx.lineWidth=12;
  ctx.beginPath(); ctx.moveTo(20,-14); ctx.quadraticCurveTo(30,-6,33,4); ctx.stroke();
  ctx.strokeStyle=jcL; ctx.lineWidth=4;
  ctx.beginPath(); ctx.moveTo(20,-14); ctx.quadraticCurveTo(30,-6,33,4); ctx.stroke();

  // --- Head ---
  const hG=ctx.createRadialGradient(-4,-42,2,0,-38,14);
  hG.addColorStop(0,'#ffddbb'); hG.addColorStop(.65,'#f0c090'); hG.addColorStop(1,'#d4a070');
  ctx.fillStyle=hG; ctx.beginPath(); ctx.arc(0,-38,13.5,0,Math.PI*2); ctx.fill();

  // Ear
  ctx.fillStyle='#e0b080';
  ctx.beginPath(); ctx.ellipse(-13,-38,3.5,4.5,-.2,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(13,-38,3.5,4.5,.2,0,Math.PI*2); ctx.fill();

  // Hair
  const hairG=ctx.createRadialGradient(0,-48,0,0,-44,14);
  hairG.addColorStop(0,'#2a1000'); hairG.addColorStop(1,'#120800');
  ctx.fillStyle=hairG;
  ctx.beginPath();
  ctx.moveTo(-13.5,-38);
  ctx.bezierCurveTo(-14,-46,-8,-52,0,-52);
  ctx.bezierCurveTo(8,-52,14,-46,13.5,-38);
  ctx.bezierCurveTo(8,-42,0,-43,-13.5,-38);
  ctx.closePath(); ctx.fill();

  // Brow
  ctx.fillStyle='#110600';
  ctx.beginPath(); ctx.moveTo(-8,-33); ctx.quadraticCurveTo(-4,-35,-0.5,-33); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8,-33); ctx.quadraticCurveTo(4,-35,0.5,-33); ctx.stroke();

  // Eyes + expression
  const hap=gkIsHappy&&gkExprT>0, sad=!gkIsHappy&&gkExprT>0;
  ctx.fillStyle='#1a1a2a';
  ctx.beginPath(); ctx.ellipse(-4.5,-38,3,2.5,0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(4.5,-38,3,2.5,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.arc(-5.5,-39,1,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(3.5,-39,1,0,Math.PI*2); ctx.fill();

  ctx.strokeStyle='rgba(180,100,60,0.9)'; ctx.lineWidth=1.5; ctx.lineCap='round';
  if (hap) { ctx.beginPath(); ctx.arc(0,-30,5,0,Math.PI); ctx.stroke(); }
  else if (sad) { ctx.beginPath(); ctx.arc(0,-25,5,Math.PI,Math.PI*2); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(-3.5,-29); ctx.lineTo(3.5,-29); ctx.stroke(); }

  // --- Gloves ---
  const glv=ctx.createRadialGradient(0,0,1,0,0,12);
  glv.addColorStop(0,'#ffe033'); glv.addColorStop(.6,'#ddaa00'); glv.addColorStop(1,'#aa7700');

  [[-33,4],[33,4]].forEach(([gx,gy]) => {
    ctx.save(); ctx.translate(gx,gy);
    ctx.fillStyle=glv;
    ctx.beginPath(); ctx.ellipse(0,0,11,8,-0.25,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(170,120,0,0.7)'; ctx.lineWidth=1.2;
    for (let f=-1.5;f<=1.5;f+=1) {
      ctx.beginPath(); ctx.moveTo(f*2,-3); ctx.lineTo(f*2+f*.3,-10); ctx.stroke();
    }
    // Glove seam
    ctx.strokeStyle='rgba(0,0,0,0.25)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(-8,2); ctx.lineTo(8,2); ctx.stroke();
    ctx.restore();
  });

  ctx.restore();
}

// ── Ball — Proper 3-D shading ────────────────────────────────────────────────
function drawBall(x, y, sc, ang) {
  ctx.save(); ctx.translate(x,y); ctx.scale(sc,sc);
  const r = BALL_R;

  // Ground shadow
  const shG=ctx.createRadialGradient(r*.2,r*.85,0,r*.2,r*.85,r*.9);
  shG.addColorStop(0,'rgba(0,0,0,0.38)'); shG.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=shG; ctx.beginPath(); ctx.ellipse(r*.2,r*.88,r*.85,r*.3,0,0,Math.PI*2); ctx.fill();

  // Clip to ball circle
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.save(); ctx.clip();

  // Base — radial gradient lit from upper-left (floodlights)
  const base=ctx.createRadialGradient(-r*.28,-r*.32,r*.06,r*.18,r*.18,r*1.55);
  base.addColorStop(0,'#f2f2f2');
  base.addColorStop(.28,'#d6d6d6');
  base.addColorStop(.62,'#a4a4a4');
  base.addColorStop(1,'#606060');
  ctx.fillStyle=base; ctx.fillRect(-r,-r,r*2,r*2);

  // Rotating patches
  ctx.save(); ctx.rotate(ang);
  ctx.fillStyle='#0d0d0d'; ctx.beginPath();
  penta(0,0,r*.37);
  for (let i=0;i<5;i++) { const a=i/5*Math.PI*2-Math.PI/2; penta(Math.cos(a)*r*.65,Math.sin(a)*r*.65,r*.28); }
  ctx.fill();
  // Subtle gradient over patches to integrate them into the 3D shape
  const over=ctx.createRadialGradient(-r*.28,-r*.32,0,-r*.28,-r*.32,r*1.3);
  over.addColorStop(0,'rgba(255,255,255,0.06)'); over.addColorStop(.55,'rgba(255,255,255,0)'); over.addColorStop(1,'rgba(0,0,0,0.22)');
  ctx.fillStyle=over; ctx.fillRect(-r,-r,r*2,r*2);
  ctx.restore();

  // Primary specular highlight
  const sp=ctx.createRadialGradient(-r*.4,-r*.44,0,-r*.4,-r*.44,r*.52);
  sp.addColorStop(0,'rgba(255,255,255,0.95)');
  sp.addColorStop(.38,'rgba(255,255,255,0.42)');
  sp.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=sp; ctx.fillRect(-r,-r,r*2,r*2);

  // Tiny secondary specular
  const sp2=ctx.createRadialGradient(-r*.14,-r*.14,0,-r*.14,-r*.14,r*.2);
  sp2.addColorStop(0,'rgba(255,255,255,0.55)'); sp2.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=sp2; ctx.fillRect(-r,-r,r*2,r*2);

  // Cool ambient fill on shadow side (makes it feel like stadium ambient light)
  const amb=ctx.createRadialGradient(r*.4,r*.4,0,r*.4,r*.4,r*.9);
  amb.addColorStop(0,'rgba(100,140,255,0.07)'); amb.addColorStop(1,'rgba(100,140,255,0)');
  ctx.fillStyle=amb; ctx.fillRect(-r,-r,r*2,r*2);

  ctx.restore(); // remove clip

  // Ball outline
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2);
  ctx.strokeStyle='rgba(0,0,0,0.18)'; ctx.lineWidth=1.2; ctx.stroke();

  ctx.restore();
}

// ── Ball pulse (aim phase) ────────────────────────────────────────────────────
function drawBallPulse() {
  const t = performance.now()/1000;
  const r = (BALL_R+6) + Math.sin(t*3)*.8;
  const a = .35 + Math.sin(t*3)*.15;
  ctx.strokeStyle=`rgba(255,215,0,${a})`; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(B0X,B0Y,r,0,Math.PI*2); ctx.stroke();
}

// ── Trail ────────────────────────────────────────────────────────────────────
function drawTrail() {
  trail.forEach((t,i)=>{
    if (t.a<=0) return;
    ctx.globalAlpha=t.a*.3;
    const g=ctx.createRadialGradient(t.x,t.y,0,t.x,t.y,BALL_R*t.s*.7);
    g.addColorStop(0,'rgba(160,180,255,0.8)'); g.addColorStop(1,'rgba(160,180,255,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(t.x,t.y,BALL_R*t.s*.7,0,Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha=1;
}

// ── Swipe UI ─────────────────────────────────────────────────────────────────
function drawSwipeArrow() {
  if (!sw0||!swC) return;
  ctx.strokeStyle='rgba(255,255,255,0.22)'; ctx.lineWidth=2; ctx.setLineDash([5,4]);
  ctx.beginPath(); ctx.moveTo(sw0.x,sw0.y); ctx.lineTo(swC.x,swC.y); ctx.stroke(); ctx.setLineDash([]);
  const pc=`hsl(${120-swPow*120},90%,58%)`;
  ctx.strokeStyle=pc; ctx.lineWidth=3.5;
  ctx.beginPath(); ctx.arc(B0X,B0Y,BALL_R+10,-Math.PI/2,-Math.PI/2+swPow*Math.PI*2); ctx.stroke();
  ctx.fillStyle='#fff'; ctx.font='bold 13px Impact,Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(Math.round(swPow*100)+'%',B0X,B0Y-BALL_R-24);
}

function drawArcGuide() {
  if (!sw0||swPow<.07) return;
  const mg=14, relX=swDir.x, htF=Math.max(0,Math.min(1,(-swDir.y+.3)/1.3));
  const tx=clamp(GK0X+relX*(GW/2-mg)*(.4+swPow*.6),GL+mg,GR-mg);
  const ty=lerp(GB-mg,GT+mg,htF*Math.min(swPow*1.4,1));
  const cpx=(B0X+tx)/2, cpy=Math.min(B0Y,ty)-60-swPow*40;
  ctx.strokeStyle='rgba(255,255,100,0.28)'; ctx.lineWidth=1.5; ctx.setLineDash([4,5]);
  ctx.beginPath(); ctx.moveTo(B0X,B0Y); ctx.quadraticCurveTo(cpx,cpy,tx,ty); ctx.stroke(); ctx.setLineDash([]);
  if (tx>GL&&tx<GR&&ty>GT&&ty<GB) {
    const pulse=.55+Math.abs(Math.sin(performance.now()/220))*.45;
    ctx.globalAlpha=pulse;
    ctx.strokeStyle='rgba(255,220,0,0.85)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(tx,ty,12,0,Math.PI*2); ctx.stroke();
    const arm=18;
    ctx.beginPath();
    ctx.moveTo(tx-arm,ty); ctx.lineTo(tx-8,ty); ctx.moveTo(tx+8,ty); ctx.lineTo(tx+arm,ty);
    ctx.moveTo(tx,ty-arm); ctx.lineTo(tx,ty-8); ctx.moveTo(tx,ty+8); ctx.lineTo(tx,ty+arm);
    ctx.stroke(); ctx.globalAlpha=1;
  }
}

// ── Particles ────────────────────────────────────────────────────────────────
function drawParticles() {
  particles.forEach(p=>{
    ctx.save(); ctx.globalAlpha=p.life; ctx.fillStyle=p.c;
    if (p.rect) { ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.fillRect(-p.r,-p.r/2,p.r*2,p.r); }
    else { ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
  });
}

// ── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  const v=ctx.createRadialGradient(W/2,H/2,H*.18,W/2,H/2,H*.88);
  v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,0,0.6)');
  ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
}

// ── Pop message ───────────────────────────────────────────────────────────────
function drawPop() {
  const goal=popMsg==='GOAL!';
  const sc=1+(1-Math.min(popAlpha,1))*.22;
  ctx.save(); ctx.globalAlpha=Math.min(popAlpha,1);
  ctx.translate(W/2,H/2-35); ctx.scale(sc,sc); ctx.translate(-W/2,-(H/2-35));
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='bold 68px Impact,Arial Black,sans-serif';
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillText(popMsg,W/2+3,H/2-32);
  ctx.fillStyle=goal?'#FFD700':popMsg==='MISSED!'?'#FF8800':'#FF3322';
  ctx.shadowColor=goal?'#FF8800':'#660000'; ctx.shadowBlur=28;
  ctx.fillText(popMsg,W/2,H/2-35); ctx.shadowBlur=0;
  if (goal) { ctx.font='20px Arial,sans-serif'; ctx.fillStyle='#fff'; ctx.shadowColor='#000'; ctx.shadowBlur=6; ctx.fillText('What a finish! ⚽',W/2,H/2+10); }
  ctx.restore();
}

function drawReplayTag() {
  ctx.fillStyle='rgba(0,0,0,0.6)'; rr(W-98,8,90,26,6); ctx.fill();
  ctx.fillStyle='#FF3322'; ctx.beginPath(); ctx.arc(W-87,21,7,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font='bold 12px Impact,Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('SLOW MO',W-76,21);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function lerp(a,b,t){ return a+(b-a)*t; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function smoothStep(t){ return t<.5?2*t*t:-1+(4-2*t)*t; }
function sign(x){ return x>0?1:x<0?-1:0; }
function todayStr(){ return new Date().toISOString().slice(0,10); }

function rr(x,y,w,h,r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

function penta(cx,cy,r) {
  ctx.moveTo(cx,cy-r);
  for (let i=1;i<=5;i++){ const a=i/5*Math.PI*2-Math.PI/2; ctx.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a)); }
  ctx.closePath();
}

// Hex color helpers for jersey gradient
function hexToRgb(h) {
  const r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16);
  return [r,g,b];
}
function rgbToHex(r,g,b) { return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join(''); }
function lightenHex(h,n) { const [r,g,b]=hexToRgb(h); return rgbToHex(r+n,g+n,b+n); }
function darkenHex(h,n)  { const [r,g,b]=hexToRgb(h); return rgbToHex(r-n,g-n,b-n); }

// ─── Loop ───────────────────────────────────────────────────────────────────
function loop(ts) {
  const dt=Math.min(ts-lastTs,50); lastTs=ts;
  if (currentScreen==='game') { if (gameActive) update(dt); draw(); }
  requestAnimationFrame(loop);
}

// ─── Navigation ─────────────────────────────────────────────────────────────
$('btn-play').addEventListener('click',()=>showScreen('modes'));
$('btn-career').addEventListener('click',()=>renderCareer());
$('btn-daily').addEventListener('click',()=>{
  if (sv.dailyDate===todayStr()) { alert(`Today: ${sv.dailyScore}/1 ⚽\nCome back tomorrow!`); return; }
  startGame('daily',Math.min(sv.level,GK_CFG.length)-1);
});
$('back-modes').addEventListener('click',()=>showScreen('menu'));
$('back-career').addEventListener('click',()=>showScreen('menu'));
$('mode-quick').addEventListener('click',()=>startGame('quick',Math.min(sv.level-1,4)));
$('mode-shoot').addEventListener('click',()=>startGame('shootout',Math.min(sv.level-1,4)));
$('mode-sudden').addEventListener('click',()=>startGame('sudden',Math.min(sv.level-1,4)));
$('mode-arcade').addEventListener('click',()=>startGame('arcade',Math.min(sv.level-1,4)));
$('btn-again').addEventListener('click',()=>startGame(mode,gkCfgIdx));
$('btn-menu').addEventListener('click',()=>{ refreshMenuXP(); showScreen('menu'); });
$('btn-share').addEventListener('click',()=>{
  const t=`⚽ I scored ${goals} in Penalty Kings! Can you beat me? 🥅`;
  if (navigator.share) navigator.share({title:'Penalty Kings',text:t}).catch(()=>{});
  else navigator.clipboard?.writeText(t).then(()=>alert('Copied!'));
});

function renderCareer() {
  const wins=sv.careerWins||0;
  $('career-list').innerHTML=GK_CFG.map((g,i)=>{
    const beaten=wins>i, unlocked=wins>=i;
    return `<div class="mcard" style="width:290px;${!unlocked?'opacity:.45;pointer-events:none':''}" data-ci="${i}">
      <h3>${beaten?'✅':unlocked?'▶':'🔒'} ${g.name}</h3>
      <p>${beaten?'DEFEATED':unlocked?'5 kicks — need 3 to win':'Beat previous to unlock'}</p></div>`;
  }).join('');
  $('career-list').querySelectorAll('.mcard').forEach(el=>el.addEventListener('click',()=>startGame('career',+el.dataset.ci)));
  showScreen('career');
}

// ─── Boot ───────────────────────────────────────────────────────────────────
refreshMenuXP();
requestAnimationFrame(ts=>{ lastTs=ts; requestAnimationFrame(loop); });

})();
