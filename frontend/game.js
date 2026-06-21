/* Penalty Kings — World Class Edition */
(function () {
'use strict';

// ─── Canvas ───────────────────────────────────────────────────────
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const W = 400, H = 530;
const DPR = Math.min(window.devicePixelRatio || 1, 3);
canvas.width  = W * DPR; canvas.height = H * DPR;
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
ctx.scale(DPR, DPR);

const $ = id => document.getElementById(id);

// ─── Screens ──────────────────────────────────────────────────────
let currentScreen = 'menu';
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('s-' + id).classList.add('active');
  currentScreen = id;
}

// ─── Constants ────────────────────────────────────────────────────
const GL = 58, GR = 342, GT = 80, GB = 288;
const GW = GR - GL, GH = GB - GT;
const GK0X = (GL + GR) / 2, GK0Y = GT + GH * 0.5;
const B0X = W / 2, B0Y = H - 60;
const BALL_R = 20;
const MAX_SWIPE = 130;

const LEVEL_NAMES = ['Amateur','Semi-Pro','Pro','Elite','World Class','Legend'];
const LEVEL_XP    = [100, 250, 500, 1000, 2000, Infinity];

// GK difficulty configs
const GK_CFG = [
  { name:'Bruno',     jersey:'#FF6B35', reach:44, accuracy:.38, react:.58 },
  { name:'Marco',     jersey:'#3388FF', reach:52, accuracy:.52, react:.46 },
  { name:'Diaz',      jersey:'#22AA44', reach:60, accuracy:.63, react:.35 },
  { name:'De Bruyne', jersey:'#AA22AA', reach:68, accuracy:.74, react:.25 },
  { name:'AI-1000',   jersey:'#111',    reach:76, accuracy:.86, react:.13 },
];

// ─── Persistence ──────────────────────────────────────────────────
let sv = (() => { try { return JSON.parse(localStorage.getItem('pk2')) || {}; } catch { return {}; } })();
sv.xp          = sv.xp          || 0;
sv.level       = sv.level       || 1;
sv.totalGoals  = sv.totalGoals  || 0;
sv.highScore   = sv.highScore   || 0;
sv.careerWins  = sv.careerWins  || 0;
sv.shots       = sv.shots       || []; // recent shot relX for AI
sv.dailyDate   = sv.dailyDate   || '';
sv.dailyScore  = sv.dailyScore  ?? null;
function save() { localStorage.setItem('pk2', JSON.stringify(sv)); }
save();

function addXP(n) {
  sv.xp += n;
  const need = LEVEL_XP[sv.level - 1];
  if (sv.xp >= need && sv.level < LEVEL_NAMES.length) { sv.xp -= need; sv.level++; save(); return true; }
  save(); return false;
}

function refreshMenuXP() {
  const need = LEVEL_XP[sv.level - 1];
  const pct  = need === Infinity ? 100 : sv.xp / need * 100;
  $('m-xp').style.width    = pct + '%';
  $('m-xlabel').textContent = `${sv.xp} / ${need === Infinity ? '∞' : need} XP`;
  $('m-lvl').textContent    = `LEVEL ${sv.level} · ${LEVEL_NAMES[sv.level - 1].toUpperCase()}`;
}

// ─── Game state ───────────────────────────────────────────────────
let mode      = 'quick';
let phase     = 'idle';   // idle|aim|swipe|shooting|replay|pause
let goals     = 0, kicks = 0, maxKicks = 5;
let gkCfgIdx  = 0;
let gkCfg     = GK_CFG[0];
let arcadeEnd = 0;

// Swipe
let sw0 = null, swC = null, swPow = 0, swDir = { x: 0, y: -1 };

// Ball
let bx = B0X, by = B0Y, bScale = 1, bAngle = 0;
let trail = [];

// Shot params (set at executeShot)
let stx = 0, sty = 0, sPow = 0, sSpin = 0;

// GK
let gkX = GK0X, gkAngle = 0, gkTX = GK0X;
let gkExprT = 0;  // >0 = show expression
let gkIsHappy = false;

// Replay
let repFrames = [], repIdx = 0, replayShowing = false;
let shootT = 0;
const SHOOT_DUR = 0.65;

// Misc
let popMsg = '', popAlpha = 0;
let flashAlpha = 0;
let particles  = [];
let crowdExcite = 0.15;
let netPhase   = 0, netActive = false; // simple net wave
let lastGoalX  = 0, lastGoalY = 0;
let isGoal     = false;
let lastTs     = 0;
let gameActive = false;

// Crowd data
const crowd = Array.from({ length: 130 }, () => ({
  x: Math.random() * W,
  y: 6 + Math.random() * 56,
  c: ['#cc3333','#3366cc','#ccaa22','#33aa55','#cc7733','#aaaaaa'][Math.floor(Math.random() * 6)],
  ph: Math.random() * Math.PI * 2,
  sp: 1.8 + Math.random() * 2.4,
}));

// Net vertices (simple grid)
let netV = buildNet();
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

// ─── GK AI ────────────────────────────────────────────────────────
function gkDecide(relX) {
  const hist = sv.shots.slice(-6);
  let bias = hist.length >= 3 ? hist.reduce((s, v) => s + v, 0) / hist.length : 0;
  const patW = gkCfgIdx * 0.18;
  const eff  = relX + bias * patW;
  const r    = Math.random();
  let tx;
  if (r < gkCfg.accuracy) {
    tx = eff < -.22 ? GL + 42 : eff > .22 ? GR - 42 : GK0X;
  } else {
    if (eff < -.22)     tx = Math.random() < .5 ? GK0X : GR - 42;
    else if (eff > .22) tx = Math.random() < .5 ? GK0X : GL + 42;
    else                tx = Math.random() < .5 ? GL + 42 : GR - 42;
  }
  return tx;
}

// ─── Audio ────────────────────────────────────────────────────────
let AC;
function ac() { return AC || (AC = new (window.AudioContext || window.webkitAudioContext)()); }
function tone(f, d, type = 'sine', v = .22, delay = 0) {
  try {
    const a = ac(), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(v, a.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(.001, a.currentTime + delay + d);
    o.connect(g); g.connect(a.destination);
    o.start(a.currentTime + delay); o.stop(a.currentTime + delay + d);
  } catch {}
}
function sfxKick()    { tone(75,.07,'square',.3); tone(55,.12,'sawtooth',.18,.04); }
function sfxGoal()    { [523,659,784,1047].forEach((f,i) => tone(f,.18+i*.06,'square',.22,i*.12)); }
function sfxSave()    { tone(330,.07,'sawtooth',.18); tone(220,.22,'sawtooth',.14,.08); }
function sfxMiss()    { tone(220,.1,'sawtooth',.15); tone(180,.25,'sawtooth',.1,.1); }
function sfxWhistle() { [880,1100,880].forEach((f,i) => tone(f,.14,'sine',.28,i*.22)); }
function sfxLvlUp()   { [523,659,784,1047,1318].forEach((f,i) => tone(f,.15,'triangle',.2,i*.1)); }

let crowdNode = null, crowdGain = null;
function setCrowd(lvl) {
  crowdExcite = lvl;
  try {
    const a = ac();
    if (crowdNode) { try { crowdNode.stop(); } catch {} crowdNode = null; }
    if (crowdGain) { crowdGain.disconnect(); crowdGain = null; }
    if (lvl > .08) {
      crowdNode = a.createOscillator(); crowdGain = a.createGain();
      crowdNode.type = 'sawtooth'; crowdNode.frequency.value = 110 + lvl * 90;
      crowdGain.gain.value = lvl * .07;
      crowdNode.connect(crowdGain); crowdGain.connect(a.destination);
      crowdNode.start();
    }
  } catch {}
}

// ─── Haptics ──────────────────────────────────────────────────────
const vib = (p) => { try { navigator.vibrate?.(p); } catch {} };

// ─── Commentary ───────────────────────────────────────────────────
let speechOn = false;
function say(t) {
  if (!speechOn || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.rate = 1.2; u.pitch = 1.15; speechSynthesis.speak(u);
}
const GLINES = ['GOOOAL!','What a finish!','Top corner!','Unstoppable!','Into the net!'];
const SLINES = ['Saved!','Incredible stop!','He read it perfectly!','What a dive!'];
const pick   = arr => arr[Math.floor(Math.random() * arr.length)];

// ─── Particles ────────────────────────────────────────────────────
const PCOLS = ['#FFD700','#FF6B35','#00FF88','#FF3388','#00CFFF','#fff','#FF4444'];
function burst(x, y) {
  for (let i = 0; i < 55; i++) {
    const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 8;
    particles.push({
      x, y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 5,
      r: 2.5 + Math.random() * 4.5,
      c: PCOLS[Math.floor(Math.random() * PCOLS.length)],
      life: 1, decay: .014 + Math.random() * .013,
      rect: Math.random() < .45, rot: Math.random() * Math.PI, rv: (Math.random()-.5)*.25,
    });
  }
}

// ─── Net ──────────────────────────────────────────────────────────
function triggerNet(x, y) { netActive = true; netPhase = 0; lastGoalX = x; lastGoalY = y; }
function updateNet(dt) {
  if (!netActive) return;
  netPhase += dt / 1000;
  const rows = netV.length - 1, cols = netV[0].length - 1;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const v = netV[r][c];
      v.vx += (v.ox - v.x) * .14; v.vy += (v.oy - v.y) * .14;
      if (netPhase < 1.0) {
        const dx = v.ox - lastGoalX, dy = v.oy - lastGoalY;
        const d  = Math.sqrt(dx*dx + dy*dy);
        const w  = Math.sin(d * .12 - netPhase * 12) * Math.exp(-d * .035) * 14;
        v.vy += w * -.9; v.vx += w * (dx / (d + 1)) * .3;
      }
      v.vx *= .8; v.vy *= .8;
      v.x += v.vx * dt / 16; v.y += v.vy * dt / 16;
    }
  }
  if (netPhase > 2.8) { netActive = false; netV = buildNet(); }
}

// ─── Swipe input ──────────────────────────────────────────────────
function canvasXY(cx, cy) {
  const r = canvas.getBoundingClientRect();
  return { x: (cx - r.left) * (W / r.width), y: (cy - r.top) * (H / r.height) };
}

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (phase !== 'aim') return;
  const t = e.touches[0], p = canvasXY(t.clientX, t.clientY);
  sw0 = { x: p.x, y: p.y }; swC = { x: p.x, y: p.y };
  phase = 'swipe';
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (phase !== 'swipe') return;
  const t = e.touches[0]; swC = canvasXY(t.clientX, t.clientY); calcSwipe();
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  if (phase !== 'swipe') return;
  swPow > .06 ? executeShot() : resetSwipe();
}, { passive: false });

// Mouse (desktop)
let mdown = false;
canvas.addEventListener('mousedown', e => { if (phase !== 'aim') return; const p = canvasXY(e.clientX, e.clientY); sw0 = p; swC = { ...p }; phase = 'swipe'; mdown = true; });
canvas.addEventListener('mousemove', e => { if (!mdown || phase !== 'swipe') return; swC = canvasXY(e.clientX, e.clientY); calcSwipe(); });
canvas.addEventListener('mouseup',   e => { mdown = false; if (phase !== 'swipe') return; swPow > .06 ? executeShot() : resetSwipe(); });

function calcSwipe() {
  if (!sw0 || !swC) return;
  const dx = swC.x - sw0.x, dy = swC.y - sw0.y;
  const d  = Math.sqrt(dx*dx + dy*dy);
  swPow = Math.min(d / MAX_SWIPE, 1);
  if (d > 4) swDir = { x: dx / d, y: dy / d };
}

function resetSwipe() { sw0 = null; swC = null; swPow = 0; phase = 'aim'; }

function executeShot() {
  phase = 'shooting'; kicks++;
  sfxKick(); vib(18);

  const pow = Math.max(.3, swPow);
  const relX = swDir.x; // -1=left, +1=right
  const upY  = -swDir.y; // positive = kicked upward
  const htF  = Math.max(0, Math.min(1, (upY + .3) / 1.3));

  const margin = 14;
  stx = clamp(GK0X + relX * (GW/2 - margin) * (0.4 + pow * 0.6), GL + margin, GR - margin);
  sty = lerp(GB - margin, GT + margin, htF * Math.min(pow * 1.4, 1));
  sPow = pow;
  sSpin = relX * pow * 0.7;

  sv.shots.push(relX);
  if (sv.shots.length > 20) sv.shots.shift();
  save();

  gkTX = gkDecide(relX);
  bx = B0X; by = B0Y; bScale = 1; bAngle = 0; trail = [];
  repFrames = []; shootT = 0;
  sw0 = null; swC = null; swPow = 0;
  updateHUD();
}

// ─── Update ───────────────────────────────────────────────────────
function update(dt) {
  const sec = dt / 1000;
  const now = performance.now() / 1000;

  if (phase === 'shooting') {
    shootT += sec / SHOOT_DUR;
    const t    = Math.min(shootT, 1);
    const ease = smoothStep(t);

    bx     = lerp(B0X, stx, ease) + sSpin * ease * (1 - ease) * 58;
    by     = lerp(B0Y, sty, ease) - Math.sin(t * Math.PI) * 70;
    bScale = lerp(1, .48, ease);
    bAngle += sec * 9 * sPow;
    trail.push({ x: bx, y: by, s: bScale, a: .5 });
    if (trail.length > 10) trail.shift();

    if (t > gkCfg.react) {
      const gt = smoothStep(Math.min((t - gkCfg.react) / .5, 1));
      gkX    = lerp(GK0X, gkTX, gt);
      const lean = (gkTX > GK0X ? 1 : gkTX < GK0X ? -1 : 0) * .65;
      gkAngle = lean * Math.min((t - gkCfg.react) / .28, 1);
    }

    repFrames.push({ bx, by, bScale, bAngle, gkX, gkAngle });

    if (shootT >= 1) resolveShot();
  }

  if (phase === 'replay') {
    repIdx += .3;
    if (repIdx >= repFrames.length) { phase = 'pause'; setTimeout(nextOrEnd, 700); }
    else {
      const f = repFrames[Math.floor(repIdx)];
      bx = f.bx; by = f.by; bScale = f.bScale; bAngle = f.bAngle;
      gkX = f.gkX; gkAngle = f.gkAngle;
    }
  }

  // Crowd
  crowd.forEach(p => { p.cy = p.y + Math.sin(now * p.sp + p.ph) * (1.5 + crowdExcite * 7); });

  // Net
  updateNet(dt);

  // Particles
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy; p.vy += .32; p.vx *= .97;
    p.life -= p.decay * dt / 16;
    if (p.rect) p.rot += p.rv;
  });
  particles = particles.filter(p => p.life > 0);
  trail.forEach(t => t.a -= .055);

  if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - sec * 3.5);
  if (popAlpha > 0 && phase !== 'pause' && phase !== 'replay') popAlpha = Math.max(0, popAlpha - sec * 2.8);
  if (gkExprT > 0) gkExprT -= dt;

  // Arcade timer
  if (mode === 'arcade' && phase === 'aim') {
    const left = Math.max(0, (arcadeEnd - performance.now()) / 1000);
    $('hud-right').textContent = `⏱ ${Math.ceil(left)}s`;
    if (left <= 0) { phase = 'pause'; setTimeout(showResult, 500); }
  }
}

function resolveShot() {
  const inG  = stx > GL + 4 && stx < GR - 4 && sty > GT + 4 && sty < GB - 4;
  const dist = Math.abs(gkX - stx);
  isGoal = inG && dist > gkCfg.reach;

  if (isGoal) {
    goals++; sv.totalGoals++; save();
    popMsg = 'GOAL!'; popAlpha = 1;
    flashAlpha = 1;
    burst(stx, sty);
    triggerNet(stx, sty);
    setCrowd(1);
    sfxGoal(); vib([50,30,50,30,100]);
    say(pick(GLINES));
    gkExprT = 2200; gkIsHappy = false;
  } else {
    popMsg = inG ? 'SAVED!' : 'MISSED!'; popAlpha = 1;
    flashAlpha = .45;
    if (!inG) sfxMiss(); else sfxSave();
    setCrowd(.12);
    say(inG ? pick(SLINES) : 'Off target!');
    vib(35); gkExprT = 2200; gkIsHappy = true;
  }

  updateHUD();

  if (isGoal) { setTimeout(() => { if (gameActive) { phase = 'replay'; repIdx = 0; } }, 150); }
  else         { phase = 'pause'; setTimeout(nextOrEnd, 1600); }
}

function nextOrEnd() {
  if (!gameActive) return;
  popMsg = '';
  const done = mode === 'sudden' ? !isGoal
             : mode === 'arcade' ? false
             : mode === 'daily'  ? kicks >= 1
             : kicks >= maxKicks;
  if (done) showResult();
  else { resetRound(); phase = 'aim'; }
}

function resetRound() {
  bx = B0X; by = B0Y; bScale = 1; bAngle = 0; trail = [];
  gkX = GK0X; gkAngle = 0; shootT = 0; sw0 = null;
  $('hint').textContent = 'SWIPE UP TO SHOOT';
}

// ─── HUD ──────────────────────────────────────────────────────────
function updateHUD() {
  if (mode === 'sudden') { $('hud-score').textContent = `🔥 ${goals} in a row`; $('hud-right').textContent = ''; }
  else if (mode === 'arcade') { $('hud-score').textContent = `⚽ ${goals} goals`; }
  else { $('hud-score').textContent = `⚽ ${goals} / ${kicks}`; $('hud-right').textContent = `${Math.max(0, maxKicks - kicks)} left`; }
}

// ─── Result ───────────────────────────────────────────────────────
function showResult() {
  gameActive = false;
  const total = mode === 'sudden' ? goals : mode === 'arcade' ? goals : maxKicks;
  const xp    = goals * 28 + (goals === maxKicks ? 100 : 0) + (mode === 'career' ? goals * 15 : 0);
  if (goals > sv.highScore) { sv.highScore = goals; }
  if (mode === 'daily') { sv.dailyDate = todayStr(); sv.dailyScore = goals; }
  if (mode === 'career' && goals >= 3) sv.careerWins = Math.max(sv.careerWins, gkCfgIdx + 1);
  save();
  const leveled = addXP(xp);
  refreshMenuXP();

  $('r-title').textContent = mode === 'sudden' ? 'STREAK OVER!' : 'FULL TIME!';
  $('r-score').textContent = mode === 'sudden' ? `${goals} in a row!` : `${goals} / ${total}`;
  const rtxt = goals === maxKicks ? '⚽⚽⚽⚽⚽ PERFECT · LEGEND!' :
               goals >= maxKicks * .8 ? '⚽⚽⚽⚽ World Class!' :
               goals >= maxKicks * .6 ? '⚽⚽⚽ Clinical!' :
               goals >= maxKicks * .4 ? '⚽⚽ Keep Going!' : '⚽ Don\'t Give Up!';
  $('r-rating').textContent = mode === 'sudden'
    ? (goals >= 10 ? '🏆 LEGEND STREAK!' : goals >= 5 ? '🔥 Incredible run!' : '💪 Keep practicing!') : rtxt;
  $('r-xp').textContent = `+${xp} XP`;
  $('r-xbar').style.width = '0%';

  sfxWhistle();
  showScreen('result');
  const need = LEVEL_XP[sv.level - 1];
  const pct  = need === Infinity ? 100 : sv.xp / need * 100;
  setTimeout(() => { $('r-xbar').style.width = pct + '%'; }, 300);
  if (leveled) setTimeout(showLevelUp, 1300);
}

function showLevelUp() {
  $('lu-txt').textContent = `Level ${sv.level} — ${LEVEL_NAMES[sv.level - 1]}`;
  $('lvlup').classList.add('on');
  sfxLvlUp(); vib([60,30,60,30,200]);
  setTimeout(() => $('lvlup').classList.remove('on'), 2600);
}

// ─── Game start ───────────────────────────────────────────────────
function startGame(m, gkIdx = 0) {
  mode = m; gkCfgIdx = Math.min(gkIdx, GK_CFG.length - 1); gkCfg = GK_CFG[gkCfgIdx];
  goals = 0; kicks = 0; maxKicks = m === 'shootout' ? 10 : m === 'daily' ? 1 : 5;
  particles = []; popMsg = ''; popAlpha = 0; flashAlpha = 0;
  crowdExcite = .18; netV = buildNet(); netActive = false;
  shootT = 0; gkExprT = 0;
  if (m === 'arcade') arcadeEnd = performance.now() + 60000;

  const names = { quick:'QUICK PLAY', shootout:'SHOOTOUT', sudden:'SUDDEN DEATH', arcade:'ARCADE 60s', career:`vs ${gkCfg.name.toUpperCase()}`, daily:'DAILY CHALLENGE' };
  $('hud-mode').textContent = names[m] || m.toUpperCase();

  resetRound(); updateHUD();
  gameActive = true;
  showScreen('game');
  phase = 'aim';
  sfxWhistle(); setCrowd(.2);
}

// ─── Draw ─────────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, W, H);

  drawStadium();
  drawCrowd();
  drawLights();
  drawField();
  drawNet();
  drawPosts();
  drawGK();
  drawTrail();
  drawBall(bx, by, bScale, bAngle);
  if (phase === 'swipe') { drawSwipeArrow(); drawArcGuide(); }
  if (phase === 'aim') drawBallPulse();
  drawParticles();

  if (flashAlpha > 0) {
    ctx.fillStyle = isGoal ? `rgba(255,215,0,${flashAlpha * .2})` : `rgba(255,50,30,${flashAlpha * .18})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (popMsg && popAlpha > 0) drawPop();
  if (phase === 'replay') drawReplayTag();
}

function drawStadium() {
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, 68);
  sky.addColorStop(0, '#020810'); sky.addColorStop(1, '#0c1e3c');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, 68);
  // Grass
  const gr = ctx.createLinearGradient(0, 290, 0, H);
  gr.addColorStop(0, '#1a6e1a'); gr.addColorStop(.4, '#145514'); gr.addColorStop(1, '#093009');
  ctx.fillStyle = gr; ctx.fillRect(0, 290, W, H - 290);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.03)';
    ctx.fillRect(0, 292 + i * 46, W, 46);
  }
}

function drawLights() {
  [[46, 64], [354, 64]].forEach(([lx, ly]) => {
    ctx.fillStyle = '#888'; ctx.fillRect(lx - 3, ly - 52, 6, 52);
    ctx.fillStyle = '#fff'; ctx.fillRect(lx - 11, ly - 56, 22, 9);
    const b = ctx.createRadialGradient(lx, ly, 0, lx, ly, 55);
    b.addColorStop(0, 'rgba(255,255,210,.35)'); b.addColorStop(1, 'rgba(255,255,210,0)');
    ctx.fillStyle = b; ctx.fillRect(lx - 55, ly - 55, 110, 110);
    // beam
    const dir = lx < W / 2 ? 1 : -1;
    const beam = ctx.createLinearGradient(lx, ly, lx + dir * 180, H);
    beam.addColorStop(0, 'rgba(255,255,200,.1)'); beam.addColorStop(1, 'rgba(255,255,200,0)');
    ctx.fillStyle = beam;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + dir * 140, H); ctx.lineTo(lx + dir * 220, H); ctx.closePath(); ctx.fill();
  });
}

function drawCrowd() {
  const now = performance.now() / 1000;
  crowd.forEach(p => {
    const bob = Math.sin(now * p.sp + p.ph) * (1.8 + crowdExcite * 8);
    ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.ellipse(p.x, (p.cy || p.y) + bob, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffcc99';
    ctx.beginPath(); ctx.arc(p.x, (p.cy || p.y) + bob - 10, 4, 0, Math.PI * 2); ctx.fill();
  });
  // crowd fade top
  const ov = ctx.createLinearGradient(0, 0, 0, 68);
  ov.addColorStop(0, 'rgba(2,8,16,.75)'); ov.addColorStop(1, 'rgba(2,8,16,0)');
  ctx.fillStyle = ov; ctx.fillRect(0, 0, W, 68);
}

function drawField() {
  ctx.strokeStyle = 'rgba(255,255,255,.38)'; ctx.lineWidth = 2;
  // goal line
  ctx.beginPath(); ctx.moveTo(GL - 7, GB); ctx.lineTo(GR + 7, GB); ctx.stroke();
  // 6yd
  const b6 = GW * .16;
  ctx.strokeRect(GL + b6, GB, GW - b6 * 2, 30);
  // 18yd
  ctx.strokeRect(GL - 18, GB, GW + 36, 62);
  // spot
  ctx.fillStyle = 'rgba(255,255,255,.65)';
  ctx.beginPath(); ctx.arc(W / 2, B0Y, 4, 0, Math.PI * 2); ctx.fill();
  // D-arc
  ctx.beginPath(); ctx.arc(W / 2, B0Y, 58, Math.PI, Math.PI * 2); ctx.stroke();
}

function drawNet() {
  const rows = netV.length - 1, cols = netV[0].length - 1;
  ctx.strokeStyle = 'rgba(190,215,190,.2)'; ctx.lineWidth = .7;
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    netV[r].forEach((v, c) => c ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y));
    ctx.stroke();
  }
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    netV.forEach((row, r) => r ? ctx.lineTo(row[c].x, row[c].y) : ctx.moveTo(row[c].x, row[c].y));
    ctx.stroke();
  }
}

function drawPosts() {
  ctx.shadowColor = 'rgba(255,255,255,.8)'; ctx.shadowBlur = 14;
  ctx.fillStyle = '#fff';
  const P = 10;
  ctx.fillRect(GL - P/2, GT, P, GH + P/2);
  ctx.fillRect(GR - P/2, GT, P, GH + P/2);
  ctx.fillRect(GL - P/2, GT - P/2, GW + P, P);
  ctx.shadowBlur = 0;
}

function drawGK() {
  ctx.save();
  ctx.translate(gkX, GK0Y);
  ctx.rotate(gkAngle);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(0, 43, 22, 7, 0, 0, Math.PI * 2); ctx.fill();

  // shorts
  ctx.fillStyle = '#111'; rr(-13,14,11,27,3); ctx.fill(); rr(2,14,11,27,3); ctx.fill();
  // boots
  ctx.fillStyle = '#0a0a0a'; rr(-15,38,14,8,2); ctx.fill(); rr(1,38,14,8,2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.14)'; rr(-14,38,12,3,1); ctx.fill(); rr(2,38,12,3,1); ctx.fill();

  // jersey
  ctx.fillStyle = gkCfg.jersey; rr(-17,-27,34,43,7); ctx.fill();
  // jersey stripe
  ctx.fillStyle = 'rgba(255,255,255,.18)'; rr(-17,-11,34,9,0); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('1', 0, -6);

  // head
  ctx.fillStyle = '#FFCC99'; ctx.beginPath(); ctx.arc(0, -38, 13, 0, Math.PI * 2); ctx.fill();
  // hair
  ctx.fillStyle = '#1a0800'; ctx.beginPath(); ctx.arc(0, -45, 12, Math.PI, Math.PI * 2); ctx.fill();

  // expression
  const hap = gkIsHappy && gkExprT > 0;
  const sad = !gkIsHappy && gkExprT > 0;
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(-4.5, -38, 2.4, 0, Math.PI * 2); ctx.arc(4.5, -38, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#774422'; ctx.lineWidth = 1.5;
  if (hap) { ctx.beginPath(); ctx.arc(0, -30, 5, 0, Math.PI); ctx.stroke(); }
  else if (sad) { ctx.beginPath(); ctx.arc(0, -24.5, 5, Math.PI, Math.PI * 2); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(-3, -30); ctx.lineTo(3, -30); ctx.stroke(); }

  // gloves
  ctx.fillStyle = '#FFD700'; ctx.strokeStyle = '#aa8800'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(-24, -10, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc( 24, -10, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#886600'; ctx.lineWidth = 1;
  [-24,24].forEach(gx => { for (let f=-1;f<=1;f++) { ctx.beginPath(); ctx.moveTo(gx+f*3,-1); ctx.lineTo(gx+f*3,-13); ctx.stroke(); } });

  ctx.restore();
}

function drawTrail() {
  trail.forEach((t, i) => {
    if (t.a <= 0) return;
    ctx.globalAlpha = t.a * .35;
    ctx.fillStyle = '#99aaff';
    ctx.beginPath(); ctx.arc(t.x, t.y, BALL_R * t.s * (.25 + i / trail.length * .45), 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawBall(x, y, sc, ang) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); ctx.rotate(ang);
  const r = BALL_R;
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(4, r+5, r*.85, r*.3, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#f5f5f5'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#111'; ctx.beginPath();
  penta(0, 0, r*.36);
  for (let i = 0; i < 5; i++) { const a = i/5*Math.PI*2-Math.PI/2; penta(Math.cos(a)*r*.65, Math.sin(a)*r*.65, r*.27); }
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(-r*.27,-r*.27,r*.22,r*.14,-.6,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawBallPulse() {
  const pulse = 1 + Math.sin(performance.now() / 280) * .08;
  ctx.strokeStyle = 'rgba(255,215,0,.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(B0X, B0Y, (BALL_R + 5) * pulse, 0, Math.PI * 2); ctx.stroke();
}

function drawSwipeArrow() {
  if (!sw0 || !swC) return;
  const dx = swC.x - sw0.x, dy = swC.y - sw0.y;
  // line
  ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2; ctx.setLineDash([5,4]);
  ctx.beginPath(); ctx.moveTo(sw0.x, sw0.y); ctx.lineTo(swC.x, swC.y); ctx.stroke(); ctx.setLineDash([]);
  // power ring
  const pc = `hsl(${120 - swPow * 120},90%,55%)`;
  ctx.strokeStyle = pc; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(B0X, B0Y, BALL_R + 9, -Math.PI/2, -Math.PI/2 + swPow * Math.PI * 2); ctx.stroke();
  // power label
  ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Impact,Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(swPow * 100) + '%', B0X, B0Y - BALL_R - 22);
}

function drawArcGuide() {
  if (!sw0 || swPow < .07) return;
  const margin = 14;
  const relX = swDir.x;
  const htF  = Math.max(0, Math.min(1, (-swDir.y + .3) / 1.3));
  const tx   = clamp(GK0X + relX * (GW/2 - margin) * (.4 + swPow * .6), GL + margin, GR - margin);
  const ty   = lerp(GB - margin, GT + margin, htF * Math.min(swPow * 1.4, 1));
  const cpx  = (B0X + tx) / 2, cpy = Math.min(B0Y, ty) - 55 - swPow * 40;

  ctx.strokeStyle = 'rgba(255,255,100,.3)'; ctx.lineWidth = 1.5; ctx.setLineDash([4,5]);
  ctx.beginPath(); ctx.moveTo(B0X, B0Y); ctx.quadraticCurveTo(cpx, cpy, tx, ty); ctx.stroke(); ctx.setLineDash([]);

  if (tx > GL && tx < GR && ty > GT && ty < GB) {
    const pulse = .6 + Math.abs(Math.sin(performance.now() / 220)) * .4;
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = 'rgba(255,210,0,.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tx, ty, 11, 0, Math.PI * 2); ctx.stroke();
    const arm = 17;
    ctx.beginPath();
    ctx.moveTo(tx-arm,ty); ctx.lineTo(tx-7,ty); ctx.moveTo(tx+7,ty); ctx.lineTo(tx+arm,ty);
    ctx.moveTo(tx,ty-arm); ctx.lineTo(tx,ty-7); ctx.moveTo(tx,ty+7); ctx.lineTo(tx,ty+arm);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawParticles() {
  particles.forEach(p => {
    ctx.save(); ctx.globalAlpha = p.life; ctx.fillStyle = p.c;
    if (p.rect) { ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.fillRect(-p.r,-p.r/2,p.r*2,p.r); }
    else { ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
  });
}

function drawPop() {
  const goal = popMsg === 'GOAL!';
  const sc   = 1 + (1 - Math.min(popAlpha, 1)) * .25;
  ctx.save(); ctx.globalAlpha = Math.min(popAlpha, 1);
  ctx.translate(W/2, H/2 - 35); ctx.scale(sc, sc); ctx.translate(-W/2, -(H/2 - 35));
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 66px Impact,Arial Black,sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText(popMsg, W/2+3, H/2-32);
  ctx.fillStyle = goal ? '#FFD700' : popMsg === 'MISSED!' ? '#FF8800' : '#FF3322';
  ctx.shadowColor = goal ? '#FF8800' : '#660000'; ctx.shadowBlur = 26;
  ctx.fillText(popMsg, W/2, H/2-35); ctx.shadowBlur = 0;
  if (goal) {
    ctx.font = '20px Arial,sans-serif'; ctx.fillStyle = '#fff'; ctx.shadowBlur = 6; ctx.shadowColor = '#000';
    ctx.fillText('What a finish! ⚽', W/2, H/2+10);
  }
  ctx.restore();
}

function drawReplayTag() {
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(W-96,8,88,26);
  ctx.fillStyle = '#FF3322'; ctx.beginPath(); ctx.arc(W-85,21,7,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Impact,Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('SLOW MO', W-74, 21);
}

// ─── Helpers ──────────────────────────────────────────────────────
function lerp(a,b,t){ return a+(b-a)*t; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function smoothStep(t){ return t<.5?2*t*t:-1+(4-2*t)*t; }
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
  for(let i=1;i<=5;i++){const a=i/5*Math.PI*2-Math.PI/2; ctx.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a));}
  ctx.closePath();
}

// ─── Navigation wiring ────────────────────────────────────────────
$('btn-play').addEventListener('click', () => showScreen('modes'));
$('btn-career').addEventListener('click', () => renderCareer());
$('btn-daily').addEventListener('click', () => {
  if (sv.dailyDate === todayStr()) {
    alert(`Today's challenge: ${sv.dailyScore}/1 ⚽\nCome back tomorrow!`); return;
  }
  startGame('daily', Math.min(sv.level, GK_CFG.length) - 1);
});

$('back-modes').addEventListener('click', () => showScreen('menu'));
$('back-career').addEventListener('click', () => showScreen('menu'));

$('mode-quick').addEventListener('click', () => startGame('quick',   Math.min(sv.level - 1, 4)));
$('mode-shoot').addEventListener('click', () => startGame('shootout',Math.min(sv.level - 1, 4)));
$('mode-sudden').addEventListener('click',() => startGame('sudden',  Math.min(sv.level - 1, 4)));
$('mode-arcade').addEventListener('click',() => startGame('arcade',  Math.min(sv.level - 1, 4)));

$('btn-again').addEventListener('click', () => startGame(mode, gkCfgIdx));
$('btn-menu').addEventListener('click',  () => { refreshMenuXP(); showScreen('menu'); });
$('btn-share').addEventListener('click', () => {
  const t = `⚽ I scored ${goals} in Penalty Kings! Can you beat me? 🥅`;
  if (navigator.share) navigator.share({ title:'Penalty Kings', text:t }).catch(()=>{});
  else navigator.clipboard?.writeText(t).then(()=>alert('Copied!'));
});

// ─── Career screen ────────────────────────────────────────────────
function renderCareer() {
  const wins = sv.careerWins || 0;
  $('career-list').innerHTML = GK_CFG.map((g, i) => {
    const beaten  = wins > i, unlocked = wins >= i;
    return `<div class="mcard" style="width:290px;${!unlocked?'opacity:.45;pointer-events:none':''}" data-ci="${i}">
      <h3>${beaten?'✅':unlocked?'▶':'🔒'} ${g.name}</h3>
      <p>${beaten?'DEFEATED':unlocked?'5 kicks — need 3 to win':'Beat previous to unlock'}</p>
    </div>`;
  }).join('');
  $('career-list').querySelectorAll('.mcard').forEach(el => {
    el.addEventListener('click', () => startGame('career', +el.dataset.ci));
  });
  showScreen('career');
}

// ─── Loop ─────────────────────────────────────────────────────────
function loop(ts) {
  const dt = Math.min(ts - lastTs, 50); lastTs = ts;
  if (currentScreen === 'game' && gameActive) { update(dt); draw(); }
  else if (currentScreen === 'game') draw(); // keep drawing even paused
  requestAnimationFrame(loop);
}

// ─── Boot ─────────────────────────────────────────────────────────
refreshMenuXP();
requestAnimationFrame(ts => { lastTs = ts; requestAnimationFrame(loop); });

})();
