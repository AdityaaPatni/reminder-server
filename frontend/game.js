(function () {
  'use strict';

  /* ── DOM ── */
  const canvas   = document.getElementById('c');
  const ctx      = canvas.getContext('2d');
  const shootBtn = document.getElementById('shoot-btn');
  const hintEl   = document.getElementById('hint');
  const scoreEl  = document.getElementById('score');
  const kicksEl  = document.getElementById('kicks-left');
  const bestEl   = document.getElementById('best');

  /* ── Layout (logical px) ── */
  const W = 400, H = 520;

  // Goal
  const GL = 58, GR = 342;          // left / right X
  const GT = 85,  GB = 285;          // top / bottom Y
  const GW = GR - GL, GH = GB - GT; // 284 × 200
  const POST = 10;

  // GK
  const GK0X = (GL + GR) / 2;       // 200
  const GK0Y = GT + GH * 0.52;      // ~189
  const GK_REACH = 55;               // px radius counted as save

  // Ball
  const B0X = W / 2, B0Y = H - 62;
  const BR = 19;

  // Grass starts
  const GRASS_Y = 305;

  /* ── DPI scaling ── */
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);

  /* ── Persistent state ── */
  let hs = +localStorage.getItem('pk_hs') || 0;
  bestEl.textContent = 'BEST: ' + hs;

  /* ── Game state ── */
  let phase;     // 'aim' | 'shooting' | 'result' | 'gameover'
  let goals, kicks, MAX_KICKS;
  let aimX, aimY;
  let ballX, ballY, ballScale, ballAngle;
  let gkX, gkAngle, gkTargetX;
  let shootT;
  const SHOOT_MS = 680;
  let isGoal;
  let popMsg, popAlpha;
  let particles;
  let flashAlpha;
  let lastTs = 0;

  function initGame() {
    goals = 0; kicks = 0; MAX_KICKS = 5;
    particles = [];
    flashAlpha = 0;
    popMsg = ''; popAlpha = 0;
    resetRound();
    updateHUD();
    phase = 'aim';
  }

  function resetRound() {
    ballX = B0X; ballY = B0Y; ballScale = 1; ballAngle = 0;
    gkX = GK0X; gkAngle = 0; gkTargetX = GK0X;
    aimX = null; aimY = null;
    shootT = 0;
    hintEl.textContent = 'Tap goal to aim';
    shootBtn.disabled = true;
  }

  function updateHUD() {
    scoreEl.textContent = `⚽ ${goals} / ${kicks}`;
    const left = MAX_KICKS - kicks;
    kicksEl.textContent = left + (left === 1 ? ' kick left' : ' kicks left');
  }

  /* ── Input ── */
  function clientToCanvas(cx, cy) {
    const r = canvas.getBoundingClientRect();
    return { x: (cx - r.left) * (W / r.width), y: (cy - r.top) * (H / r.height) };
  }

  function handleTap(x, y) {
    if (phase === 'gameover') { initGame(); return; }
    if (phase !== 'aim') return;
    // Hit zone: goal rectangle + small outer margin
    if (x >= GL - 14 && x <= GR + 14 && y >= GT - 14 && y <= GB + 18) {
      aimX = clamp(x, GL + 9, GR - 9);
      aimY = clamp(y, GT + 9, GB - 9);
      hintEl.textContent = 'Now press SHOOT!';
      shootBtn.disabled = false;
    }
  }

  canvas.addEventListener('click', e => {
    const p = clientToCanvas(e.clientX, e.clientY);
    handleTap(p.x, p.y);
  });

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.touches[0];
    const p = clientToCanvas(t.clientX, t.clientY);
    handleTap(p.x, p.y);
  }, { passive: false });

  /* ── Shoot ── */
  shootBtn.addEventListener('click', () => {
    if (phase !== 'aim' || aimX === null) return;
    phase = 'shooting';
    shoots();
  });

  function shoots() {
    kicks++;
    shootBtn.disabled = true;
    shootT = 0;

    // GK AI — biased toward shot direction but not perfect
    const rel = (aimX - GK0X) / (GW / 2); // −1…+1
    const r = Math.random();
    if (rel < -0.28) {
      gkTargetX = r < 0.55 ? GL + 38 : r < 0.82 ? GK0X : GR - 38;
    } else if (rel > 0.28) {
      gkTargetX = r < 0.55 ? GR - 38 : r < 0.82 ? GK0X : GL + 38;
    } else {
      gkTargetX = r < 0.38 ? GK0X : r < 0.68 ? GL + 38 : GR - 38;
    }

    updateHUD();
  }

  /* ── Audio (Web Audio API tones) ── */
  let audioCtx;
  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, dur, type = 'sine', vol = 0.25) {
    try {
      const ac = getAudio();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      gain.gain.setValueAtTime(vol, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + dur);
    } catch (_) {}
  }

  function sfxGoal() {
    playTone(523, 0.12, 'square', 0.2);
    setTimeout(() => playTone(659, 0.12, 'square', 0.2), 120);
    setTimeout(() => playTone(784, 0.25, 'square', 0.25), 240);
    setTimeout(() => playTone(1047, 0.35, 'square', 0.3), 420);
  }

  function sfxSave() {
    playTone(330, 0.08, 'sawtooth', 0.15);
    setTimeout(() => playTone(220, 0.25, 'sawtooth', 0.15), 90);
  }

  function sfxKick() {
    playTone(80, 0.1, 'square', 0.3);
  }

  /* ── Particles ── */
  function spawnParticles(x, y) {
    const COLS = ['#FFD700','#FF6B35','#00FF88','#FF3388','#00CFFF','#ffffff'];
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 7;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 4,
        r: 2 + Math.random() * 5,
        color: COLS[Math.floor(Math.random() * COLS.length)],
        life: 1,
        decay: 0.016 + Math.random() * 0.014,
      });
    }
  }

  /* ── Update ── */
  function update(dt) {
    if (phase === 'shooting') {
      shootT += dt / SHOOT_MS;
      const t = Math.min(shootT, 1);

      // Smooth ease in-out
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      // Ball: travels from B0 to aim with a rising arc
      ballX = lerp(B0X, aimX, ease);
      ballY = lerp(B0Y, aimY, ease) - Math.sin(t * Math.PI) * 55;
      ballScale = lerp(1, 0.52, ease);
      ballAngle += dt * 0.009;

      // GK dives shortly after kick
      if (t > 0.1) {
        const gt = clamp((t - 0.1) / 0.52, 0, 1);
        const ge = gt < 0.5 ? 2 * gt * gt : -1 + (4 - 2 * gt) * gt;
        gkX = lerp(GK0X, gkTargetX, ge);
        const lean = (gkTargetX > GK0X ? 1 : gkTargetX < GK0X ? -1 : 0) * 0.55;
        gkAngle = lean * Math.min(gt * 2, 1);
      }

      if (shootT >= 1) {
        resolveShot();
      }
    }

    // Particles
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.28;
      p.life -= p.decay;
    });
    particles = particles.filter(p => p.life > 0);

    if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - dt / 280);
    if (popAlpha > 0 && phase !== 'result') popAlpha = Math.max(0, popAlpha - dt / 350);
  }

  function resolveShot() {
    const inGoal = aimX > GL + 4 && aimX < GR - 4 && aimY > GT + 4 && aimY < GB - 4;
    isGoal = inGoal && Math.abs(gkX - aimX) > GK_REACH;

    if (isGoal) {
      goals++;
      popMsg = 'GOAL!';
      flashAlpha = 1;
      spawnParticles(aimX, aimY);
      sfxGoal();
    } else {
      popMsg = 'SAVED!';
      sfxSave();
    }
    popAlpha = 1;
    phase = 'result';
    updateHUD();

    setTimeout(() => {
      popMsg = '';
      if (kicks >= MAX_KICKS) {
        phase = 'gameover';
        if (goals > hs) { hs = goals; localStorage.setItem('pk_hs', hs); }
        bestEl.textContent = 'BEST: ' + hs;
        shootBtn.disabled = true;
        hintEl.textContent = 'Tap to play again';
      } else {
        resetRound();
        phase = 'aim';
      }
    }, 1500);
  }

  /* ── Draw helpers ── */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function pentagon(cx, cy, r) {
    ctx.moveTo(cx, cy - r);
    for (let i = 1; i <= 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath();
  }

  /* ── Draw scene ── */
  function drawBackground() {
    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, GRASS_Y);
    sky.addColorStop(0, '#050a18');
    sky.addColorStop(1, '#0d2244');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, GRASS_Y + 5);

    // Stadium flood-lights bloom
    [[55, 18], [345, 18]].forEach(([lx, ly]) => {
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 90);
      g.addColorStop(0, 'rgba(255,255,210,0.28)');
      g.addColorStop(1, 'rgba(255,255,210,0)');
      ctx.fillStyle = g;
      ctx.fillRect(lx - 90, ly - 90, 180, 180);
    });

    // Crowd silhouette
    ctx.fillStyle = '#111d30';
    ctx.fillRect(0, 0, W, 72);
    ctx.fillStyle = '#0d1828';
    ctx.beginPath();
    ctx.moveTo(0, 72);
    for (let x = 0; x <= W; x += 7) {
      ctx.lineTo(x, 72 - 7 - Math.sin(x * 0.31 + 0.5) * 3 - Math.sin(x * 0.73) * 2);
    }
    ctx.lineTo(W, 72);
    ctx.closePath();
    ctx.fill();

    // Grass
    const grass = ctx.createLinearGradient(0, GRASS_Y, 0, H);
    grass.addColorStop(0, '#1a6e1a');
    grass.addColorStop(1, '#0a3c0a');
    ctx.fillStyle = grass;
    ctx.fillRect(0, GRASS_Y, W, H - GRASS_Y);

    // Grass stripes
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(0, GRASS_Y + i * 45, W, 22);
    }
  }

  function drawFieldLines() {
    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.lineWidth = 2;

    // Goal line
    ctx.beginPath();
    ctx.moveTo(GL - 6, GB);
    ctx.lineTo(GR + 6, GB);
    ctx.stroke();

    // 6-yard box
    const b6 = GW * 0.16;
    ctx.strokeRect(GL + b6, GB, GW - b6 * 2, 30);

    // Penalty box
    ctx.strokeRect(GL - 18, GB, GW + 36, 62);

    // Penalty spot
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.arc(W / 2, B0Y, 4, 0, Math.PI * 2);
    ctx.fill();

    // D-arc
    ctx.beginPath();
    ctx.arc(W / 2, B0Y, 56, Math.PI, Math.PI * 2);
    ctx.stroke();
  }

  function drawNet() {
    const stepX = 20, stepY = 17;
    ctx.strokeStyle = 'rgba(180,210,180,0.18)';
    ctx.lineWidth = 0.8;
    for (let x = GL; x <= GR; x += stepX) {
      ctx.beginPath(); ctx.moveTo(x, GT); ctx.lineTo(x, GB); ctx.stroke();
    }
    for (let y = GT; y <= GB; y += stepY) {
      ctx.beginPath(); ctx.moveTo(GL, y); ctx.lineTo(GR, y); ctx.stroke();
    }
  }

  function drawGoalPosts() {
    ctx.shadowColor = 'rgba(255,255,255,0.7)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(GL - POST / 2, GT, POST, GH + POST / 2);
    ctx.fillRect(GR - POST / 2, GT, POST, GH + POST / 2);
    ctx.fillRect(GL - POST / 2, GT - POST / 2, GW + POST, POST);
    ctx.shadowBlur = 0;
  }

  function drawGK() {
    ctx.save();
    ctx.translate(gkX, GK0Y);
    ctx.rotate(gkAngle);

    // Shadow on ground
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 40, 20, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shorts
    ctx.fillStyle = '#14148a';
    rrect(-12, 12, 10, 26, 3); ctx.fill();
    rrect(2,   12, 10, 26, 3); ctx.fill();

    // Boots
    ctx.fillStyle = '#111';
    rrect(-14, 35, 13, 8, 2); ctx.fill();
    rrect(1,   35, 13, 8, 2); ctx.fill();

    // Jersey
    ctx.fillStyle = '#FF6B35';
    rrect(-16, -24, 32, 38, 6); ctx.fill();

    // Jersey stripe
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    rrect(-16, -10, 32, 8, 0); ctx.fill();

    // Jersey number
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1', 0, -6);

    // Head
    ctx.fillStyle = '#FFCC99';
    ctx.beginPath();
    ctx.arc(0, -35, 13, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = '#2c1000';
    ctx.beginPath();
    ctx.arc(0, -42, 11, Math.PI, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(-4.5, -36, 2.2, 0, Math.PI * 2);
    ctx.arc(4.5,  -36, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Mouth (determined expression)
    ctx.strokeStyle = '#884422';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-4, -28);
    ctx.lineTo(4, -28);
    ctx.stroke();

    // Gloves
    ctx.fillStyle = '#FFD700';
    ctx.strokeStyle = '#aa8800';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(-22, -10, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc( 22, -10, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    ctx.restore();
  }

  function drawBall(x, y, scale, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.rotate(angle);

    const r = BR;

    // Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(4, r + 5, r * 0.85, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // White base
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Black patches
    ctx.fillStyle = '#111';
    ctx.beginPath();
    pentagon(0, 0, r * 0.36);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      pentagon(Math.cos(a) * r * 0.65, Math.sin(a) * r * 0.65, r * 0.27);
    }
    ctx.fill();

    // Rim
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // Shine
    ctx.fillStyle = 'rgba(255,255,255,0.52)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.27, -r * 0.27, r * 0.22, r * 0.14, -0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawAimCursor() {
    if (aimX === null) return;
    const pulse = 1 + Math.sin(Date.now() / 180) * 0.15;
    const r = 16 * pulse;

    ctx.save();
    ctx.strokeStyle = '#FF2211';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#FF4422';
    ctx.shadowBlur = 14;

    ctx.beginPath();
    ctx.arc(aimX, aimY, r, 0, Math.PI * 2);
    ctx.stroke();

    const arm = r * 1.55;
    ctx.beginPath();
    ctx.moveTo(aimX - arm, aimY); ctx.lineTo(aimX - r * 0.38, aimY);
    ctx.moveTo(aimX + r * 0.38, aimY); ctx.lineTo(aimX + arm, aimY);
    ctx.moveTo(aimX, aimY - arm); ctx.lineTo(aimX, aimY - r * 0.38);
    ctx.moveTo(aimX, aimY + r * 0.38); ctx.lineTo(aimX, aimY + arm);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawPopMessage() {
    if (!popMsg) return;
    const goal = popMsg === 'GOAL!';
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Drop shadow
    ctx.font = 'bold 62px Impact, Arial Black, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(popMsg, W / 2 + 3, H / 2 - 38 + 3);

    // Main text
    ctx.fillStyle = goal ? '#FFD700' : '#FF3322';
    ctx.shadowColor = goal ? '#FF8800' : '#660000';
    ctx.shadowBlur = 22;
    ctx.fillText(popMsg, W / 2, H / 2 - 38);
    ctx.shadowBlur = 0;

    if (goal) {
      ctx.font = '20px Arial, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 6;
      ctx.fillText('What a finish! ⚽', W / 2, H / 2 + 10);
    } else {
      ctx.font = '18px Arial, sans-serif';
      ctx.fillStyle = '#88ccff';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 6;
      ctx.fillText('Incredible save! 🧤', W / 2, H / 2 + 10);
    }

    ctx.restore();
  }

  function drawGameOver() {
    // Dark overlay
    ctx.fillStyle = 'rgba(2,6,18,0.86)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Title
    ctx.font = 'bold 46px Impact, Arial Black, sans-serif';
    ctx.fillStyle = '#FFD700';
    ctx.shadowColor = '#FF8800';
    ctx.shadowBlur = 22;
    ctx.fillText('FULL TIME!', W / 2, H / 2 - 100);
    ctx.shadowBlur = 0;

    // Score
    ctx.font = 'bold 34px Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${goals} / ${MAX_KICKS} scored`, W / 2, H / 2 - 38);

    // High score
    if (goals >= hs && goals > 0) {
      ctx.font = 'bold 20px Arial, sans-serif';
      ctx.fillStyle = '#00FF88';
      ctx.shadowColor = '#00aa44';
      ctx.shadowBlur = 10;
      ctx.fillText('🏆 NEW BEST SCORE!', W / 2, H / 2 + 18);
      ctx.shadowBlur = 0;
    } else {
      ctx.font = '17px Arial, sans-serif';
      ctx.fillStyle = '#6688aa';
      ctx.fillText(`Your best: ${hs} / ${MAX_KICKS}`, W / 2, H / 2 + 18);
    }

    // Rating
    const rating =
      goals === 5 ? '⚽⚽⚽⚽⚽  LEGEND!' :
      goals === 4 ? '⚽⚽⚽⚽  Excellent!' :
      goals === 3 ? '⚽⚽⚽  Good effort!' :
      goals === 2 ? '⚽⚽  Keep going!' :
      goals === 1 ? '⚽  Don\'t give up!' :
                    '😤  Try again!';
    ctx.font = '20px Arial, sans-serif';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(rating, W / 2, H / 2 + 65);

    // Tap to retry (pulsing)
    const pulse = 0.55 + Math.abs(Math.sin(Date.now() / 600)) * 0.45;
    ctx.globalAlpha = pulse;
    ctx.font = '16px Arial, sans-serif';
    ctx.fillStyle = '#aaccee';
    ctx.fillText('Tap anywhere to play again', W / 2, H / 2 + 112);
    ctx.globalAlpha = 1;
  }

  /* ── Main render ── */
  function draw() {
    ctx.clearRect(0, 0, W, H);

    drawBackground();
    drawFieldLines();
    drawNet();
    drawGoalPosts();
    drawGK();
    drawBall(ballX, ballY, ballScale, ballAngle);

    if (phase === 'aim') drawAimCursor();

    drawParticles();

    // Goal flash
    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(255,210,0,${flashAlpha * 0.22})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (popMsg) drawPopMessage();
    if (phase === 'gameover') drawGameOver();
  }

  /* ── Game loop ── */
  function loop(ts) {
    const dt = Math.min(ts - lastTs, 50);
    lastTs = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  /* ── Kick sound on shoot ── */
  shootBtn.addEventListener('click', sfxKick, { capture: true });

  /* ── Boot ── */
  initGame();
  requestAnimationFrame(ts => { lastTs = ts; requestAnimationFrame(loop); });

})();
