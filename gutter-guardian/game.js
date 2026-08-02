/* ============================================================
   Gutter Guardian - NanoSeal NB
   Game Engine - Vanilla JS + Canvas
   ============================================================ */
(function () {
  'use strict';

  const CONFIG = {
    gameName: 'Gutter Guardian',
    canonicalURL: 'https://nanosealnb.ca/gutter-guardian/',
    gameDuration: 20,
    warningTime: 15,
    warningDuration: 2500,
    maxHealth: 100,
    startHealth: 100,
    healthPerMiss: { leaf: 3, pine: 5, acorn: 7, branch: 12 },
    points: { leaf: 10, pine: 15, acorn: 20, branch: 30 },
    baseSpawnInterval: 950,
    minSpawnInterval: 280,
    spawnRampFactor: 0.35,
    warningSpawnMultiplier: 0.55,
    baseFallSpeed: 140,
    maxFallSpeed: 420,
    speedRampPerSec: 8,
    warningSpeedBoost: 120,
    hazardWeights: { leaf: 35, pine: 25, acorn: 20, branch: 20 },
    roofTopY: 0.55,
    labelLifespan: 1400,
    labelRiseSpeed: 40,
    granuleCount: 8,
    wetPatchLifespan: 3000,
    leafGutterLifespan: 6000,
    shakeDuration: 400,
    shakeIntensity: 6,
    canvasClearColor: '#0A0A0A'
  };

  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function trackGameEvent(eventName, data) {
    if (typeof console !== 'undefined' && console.log) console.log('[GameEvent]', eventName, data || {});
    if (typeof window.fbq === 'function') window.fbq('trackCustom', eventName, data || {});
    if (typeof window.gtag === 'function') window.gtag('event', eventName, data || {});
  }

  const canvas = document.getElementById('game-canvas');
  const fallbackEl = document.getElementById('canvas-fallback');
  const startScreen = document.getElementById('start-screen');
  const startBtn = document.getElementById('start-btn');
  const endScreen = document.getElementById('end-screen');
  const tryAgainBtn = document.getElementById('try-again-btn');
  const assessmentLink = document.getElementById('assessment-link');
  const shareBtn = document.getElementById('share-btn');
  const shareStatusEl = document.getElementById('share-status');
  const hudEl = document.getElementById('hud');
  const scoreEl = document.getElementById('score');
  const timerEl = document.getElementById('timer');
  const healthFill = document.getElementById('health-fill');
  const healthBar = document.querySelector('.health-bar');
  const weatherWarningEl = document.getElementById('weather-warning');
  const endHeading = document.getElementById('end-heading');
  const finalScoreEl = document.getElementById('final-score');
  const finalHealthEl = document.getElementById('final-health');

  if (!canvas || !canvas.getContext) {
    if (fallbackEl) fallbackEl.style.display = 'block';
    if (startScreen) startScreen.style.display = 'none';
    return;
  }
  if (fallbackEl) fallbackEl.style.display = 'none';
  const ctx = canvas.getContext('2d');

  let dpr = 1, cssW = 0, cssH = 0;
  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cssW = window.innerWidth; cssH = window.innerHeight;
    canvas.width = Math.floor(cssW * dpr); canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  let state = 'idle', health = CONFIG.startHealth, score = 0, timeRemaining = CONFIG.gameDuration;
  let lastFrameTime = 0, gameStartTime = 0, elapsedSec = 0, spawnTimer = 0;
  let currentSpawnInterval = CONFIG.baseSpawnInterval, currentFallSpeed = CONFIG.baseFallSpeed;
  let warningShown = false, warningTimeoutId = null, rafId = null, visibilityPaused = false;
  let hazards = [], labels = [], gutterLeaves = [], waterPools = [], particles = [];
  let shakeTime = 0, shakeOffsetX = 0, shakeOffsetY = 0;
  let rainDrops = [];
  let heavyRain = false;

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function pickHazardType() {
    const w = CONFIG.hazardWeights;
    const total = w.leaf + w.pine + w.acorn + w.branch;
    let r = Math.random() * total;
    if ((r -= w.leaf) < 0) return 'leaf';
    if ((r -= w.pine) < 0) return 'pine';
    if ((r -= w.acorn) < 0) return 'acorn';
    return 'branch';
  }

  function getRoofGeometry() {
    const topY = cssH * CONFIG.roofTopY;
    const peakX = cssW * 0.5;
    const leftEdge = cssW * 0.05, rightEdge = cssW * 0.95;
    const roofHeight = cssH * 0.15;
    const peakY = topY, eaveY = topY + roofHeight, gutterY = eaveY + 8;
    return { leftEdge, rightEdge, peakX, peakY, eaveY, topY, roofHeight, gutterY };
  }

  function getGutterY() { return getRoofGeometry().gutterY; }

  function spawnHazard() {
    const type = pickHazardType();
    const x = rand(cssW * 0.1, cssW * 0.9);
    const size = type === 'branch' ? rand(18, 28) : type === 'leaf' ? rand(14, 22) : type === 'acorn' ? rand(10, 16) : rand(10, 18);
    hazards.push({
      type: type, x: x, y: -size,
      vx: type === 'leaf' ? rand(-20, 20) : rand(-8, 8),
      vy: currentFallSpeed + rand(-15, 25),
      size: size, rotation: rand(0, Math.PI * 2), rotSpeed: rand(-2, 2),
      wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(2, 4), alive: true
    });
  }

  function addLabel(text, x, y, color) {
    labels.push({ text: text, x: x, y: y, color: color || '#FFFFFF', life: CONFIG.labelLifespan, maxLife: CONFIG.labelLifespan });
  }

  function onHazardMissed(hazard) {
    const gutterY = getGutterY();
    const dmg = CONFIG.healthPerMiss[hazard.type];
    health = Math.max(0, health - dmg);
    const g = getRoofGeometry();
    switch (hazard.type) {
      case 'leaf':
        gutterLeaves.push({ x: clamp(hazard.x, g.leftEdge + 10, g.rightEdge - 10), y: gutterY + rand(2, 8), rotation: rand(0, Math.PI * 2), size: hazard.size, color: pickLeafColor(), life: CONFIG.leafGutterLifespan, maxLife: CONFIG.leafGutterLifespan });
        addLabel('GUTTER BUILDUP', hazard.x, gutterY - 10, '#F58025');
        break;
      case 'pine':
        gutterLeaves.push({ x: clamp(hazard.x, g.leftEdge + 10, g.rightEdge - 10), y: gutterY + rand(2, 10), rotation: rand(0, Math.PI * 2), size: hazard.size * 0.7, color: '#4A6B3A', life: CONFIG.leafGutterLifespan, maxLife: CONFIG.leafGutterLifespan });
        addLabel('OUTLET CLOG', hazard.x, gutterY - 10, '#F58025');
        break;
      case 'acorn':
        gutterLeaves.push({ x: clamp(hazard.x, g.leftEdge + 10, g.rightEdge - 10), y: gutterY + rand(2, 6), rotation: 0, size: hazard.size * 0.8, color: '#8B6914', life: CONFIG.leafGutterLifespan, maxLife: CONFIG.leafGutterLifespan });
        addLabel('BLOCKAGE', hazard.x, gutterY - 10, '#F58025');
        break;
      case 'branch':
        shakeTime = CONFIG.shakeDuration;
        gutterLeaves.push({ x: clamp(hazard.x, g.leftEdge + 10, g.rightEdge - 10), y: gutterY + rand(0, 12), rotation: rand(0, Math.PI), size: hazard.size, color: '#8B5A2B', life: CONFIG.leafGutterLifespan, maxLife: CONFIG.leafGutterLifespan });
        addLabel('MAJOR BLOCKAGE', hazard.x, gutterY - 20, '#E53935');
        break;
    }
    if (health <= 50 && Math.random() < 0.15) {
      waterPools.push({ x: hazard.x, y: gutterY + 10, radius: rand(15, 30), life: 2000, maxLife: 2000 });
    }
  }

  function onHazardHit(hazard) {
    hazard.alive = false;
    score += CONFIG.points[hazard.type];
    const color = getHazardColor(hazard.type);
    for (let i = 0; i < 6; i++) {
      particles.push({ x: hazard.x, y: hazard.y, vx: rand(-80, 80), vy: rand(-80, 30), size: rand(2, 5), life: 500, maxLife: 500, color: color });
    }
  }

  function getHazardColor(type) {
    switch (type) {
      case 'leaf': return pickLeafColor();
      case 'pine': return '#4A6B3A';
      case 'acorn': return '#8B6914';
      case 'branch': return '#8B5A2B';
      default: return '#FFFFFF';
    }
  }

  function pickLeafColor() {
    const colors = ['#F58025', '#D4651C', '#E89B3C', '#C45028', '#B8651A'];
    return colors[randInt(0, colors.length - 1)];
  }

  function handlePointer(clientX, clientY) {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i];
      if (!h.alive) continue;
      const dx = px - h.x, dy = py - h.y;
      const hitRadius = h.size + 12;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) { onHazardHit(h); return; }
    }
  }

  canvas.addEventListener('mousedown', function (e) { e.preventDefault(); handlePointer(e.clientX, e.clientY); });
  canvas.addEventListener('touchstart', function (e) { e.preventDefault(); if (e.touches.length > 0) handlePointer(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---- Drawing ---- */
  function drawHouse() {
    const g = getRoofGeometry();
    ctx.save();
    ctx.translate(shakeOffsetX, shakeOffsetY);

    // Walls
    ctx.fillStyle = '#2E2A26';
    ctx.fillRect(g.leftEdge + 10, g.eaveY, g.rightEdge - g.leftEdge - 20, cssH - g.eaveY);

    // Door
    const doorW = Math.min(50, cssW * 0.1), doorH = Math.min(80, cssH * 0.12);
    const doorX = (g.leftEdge + g.rightEdge) / 2 - doorW / 2, doorY = cssH - doorH;
    ctx.fillStyle = '#3D352D'; ctx.fillRect(doorX, doorY, doorW, doorH);
    ctx.strokeStyle = '#1A1714'; ctx.lineWidth = 2; ctx.strokeRect(doorX, doorY, doorW, doorH);
    ctx.fillStyle = '#F58025'; ctx.beginPath(); ctx.arc(doorX + doorW * 0.8, doorY + doorH * 0.5, 2.5, 0, Math.PI * 2); ctx.fill();

    // Windows
    const winSize = Math.min(40, cssW * 0.08);
    const winY = g.eaveY + (cssH - g.eaveY) * 0.25;
    drawWindow(g.leftEdge + (doorX - g.leftEdge) / 2 - winSize / 2, winY, winSize);
    drawWindow(doorX + doorW + (g.rightEdge - doorX - doorW) / 2 - winSize / 2, winY, winSize);

    // Roof
    ctx.beginPath(); ctx.moveTo(g.leftEdge, g.eaveY); ctx.lineTo(g.peakX, g.peakY); ctx.lineTo(g.rightEdge, g.eaveY); ctx.closePath();
    ctx.fillStyle = '#3A3530'; ctx.fill();
    ctx.strokeStyle = '#1F1C19'; ctx.lineWidth = 2; ctx.stroke();

    // Shingle lines
    ctx.strokeStyle = '#2E2A25'; ctx.lineWidth = 1;
    for (let r = 1; r <= 5; r++) {
      const t = r / 5, yLevel = g.eaveY - (g.eaveY - g.peakY) * t;
      ctx.beginPath(); ctx.moveTo(g.leftEdge + (g.peakX - g.leftEdge) * t, yLevel); ctx.lineTo(g.peakX - (g.peakX - g.leftEdge) * 0.02 * t, yLevel); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g.peakX + (g.rightEdge - g.peakX) * 0.02 * t, yLevel); ctx.lineTo(g.rightEdge - (g.rightEdge - g.peakX) * t, yLevel); ctx.stroke();
    }

    // Downspout
    ctx.fillStyle = '#4A4540';
    ctx.fillRect(g.rightEdge - 6, g.gutterY, 6, cssH - g.gutterY);

    // Gutter
    ctx.fillStyle = '#4A4540'; ctx.fillRect(g.leftEdge - 2, g.eaveY, g.rightEdge - g.leftEdge + 4, 8);
    ctx.strokeStyle = '#2E2A26'; ctx.lineWidth = 1; ctx.strokeRect(g.leftEdge - 2, g.eaveY, g.rightEdge - g.leftEdge + 4, 8);

    // Gutter leaves/debris
    gutterLeaves.forEach(function (gl) {
      const alpha = clamp(gl.life / gl.maxLife, 0, 1);
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(gl.x, gl.y); ctx.rotate(gl.rotation);
      if (gl.color === '#8B6914' || gl.color === '#4A6B3A') {
        ctx.fillStyle = gl.color; ctx.beginPath(); ctx.ellipse(0, 0, gl.size * 0.4, gl.size * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      } else if (gl.color === '#8B5A2B') {
        ctx.strokeStyle = gl.color; ctx.lineWidth = gl.size * 0.3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-gl.size * 0.8, 0); ctx.lineTo(gl.size * 0.3, -gl.size * 0.3); ctx.stroke();
      } else {
        drawLeafShape(0, 0, gl.size, gl.color);
      }
      ctx.restore();
    });
    ctx.globalAlpha = 1;

    // Water pools (overflow)
    waterPools.forEach(function (p) {
      const alpha = clamp(p.life / p.maxLife, 0, 1) * 0.5;
      ctx.fillStyle = 'rgba(100,150,200,' + alpha + ')';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.radius, p.radius * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    });

    // Rain
    if (heavyRain) {
      ctx.strokeStyle = 'rgba(100,150,200,0.4)'; ctx.lineWidth = 1;
      for (let i = 0; i < 30; i++) {
        const rx = rand(0, cssW), ry = rand(0, g.gutterY);
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 3, ry + 12); ctx.stroke();
      }
    }

    // Water flow in downspout (visual)
    if (health > 0) {
      const flowAlpha = health / 100 * 0.4;
      ctx.fillStyle = 'rgba(100,150,200,' + flowAlpha + ')';
      ctx.fillRect(g.rightEdge - 5, g.gutterY + 2, 2, cssH - g.gutterY - 2);
    }

    ctx.restore();
  }

  function drawWindow(x, y, size) {
    ctx.fillStyle = '#1A1A1A'; ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = '#F58025'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, size, size);
    ctx.beginPath(); ctx.moveTo(x + size / 2, y); ctx.lineTo(x + size / 2, y + size); ctx.moveTo(x, y + size / 2); ctx.lineTo(x + size, y + size / 2); ctx.stroke();
  }

  function drawLeafShape(x, y, size, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, size * 0.5, size, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - size); ctx.lineTo(x, y + size); ctx.stroke();
  }

  function drawHazard(h) {
    ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.rotation);
    switch (h.type) {
      case 'leaf': drawLeafShape(0, 0, h.size, getHazardColor('leaf')); break;
      case 'pine':
        ctx.fillStyle = '#4A6B3A'; ctx.beginPath(); ctx.ellipse(0, 0, h.size * 0.3, h.size, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
        for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(0, i * h.size * 0.3); ctx.lineTo(h.size * 0.3, i * h.size * 0.3 + h.size * 0.1); ctx.stroke(); }
        break;
      case 'acorn':
        ctx.fillStyle = '#8B6914'; ctx.beginPath(); ctx.arc(0, h.size * 0.2, h.size * 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5C4A1E'; ctx.beginPath(); ctx.ellipse(0, -h.size * 0.3, h.size * 0.5, h.size * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'branch':
        ctx.strokeStyle = '#8B5A2B'; ctx.lineWidth = h.size * 0.35; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-h.size, h.size * 0.3); ctx.lineTo(h.size * 0.3, -h.size * 0.5); ctx.stroke();
        ctx.lineWidth = h.size * 0.15; ctx.beginPath(); ctx.moveTo(-h.size * 0.2, 0); ctx.lineTo(0, -h.size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(h.size * 0.1, -h.size * 0.2); ctx.lineTo(h.size * 0.5, -h.size * 0.6); ctx.stroke();
        break;
    }
    ctx.restore();
  }

  function drawLabels() {
    labels.forEach(function (l) {
      const t = l.life / l.maxLife; const alpha = t > 0.7 ? 1 : t / 0.7;
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = l.color;
      ctx.font = '700 13px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(l.text, l.x, l.y); ctx.restore();
    });
  }

  function drawParticles() {
    particles.forEach(function (p) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color; ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /* ---- Update ---- */
  function update(dt) {
    if (state !== 'playing' || visibilityPaused) return;
    elapsedSec = (performance.now() - gameStartTime) / 1000;
    timeRemaining = Math.max(0, CONFIG.gameDuration - elapsedSec);
    timerEl.textContent = Math.ceil(timeRemaining);

    const progress = elapsedSec / CONFIG.gameDuration;
    currentSpawnInterval = Math.max(CONFIG.minSpawnInterval, CONFIG.baseSpawnInterval - (CONFIG.baseSpawnInterval - CONFIG.minSpawnInterval) * progress * CONFIG.spawnRampFactor * 10);
    currentFallSpeed = Math.min(CONFIG.maxFallSpeed, CONFIG.baseFallSpeed + CONFIG.speedRampPerSec * elapsedSec);

    if (!warningShown && timeRemaining <= CONFIG.warningTime) {
      warningShown = true; heavyRain = true;
      currentSpawnInterval *= CONFIG.warningSpawnMultiplier;
      currentFallSpeed += CONFIG.warningSpeedBoost;
      weatherWarningEl.classList.remove('hide'); weatherWarningEl.classList.add('show');
      weatherWarningEl.setAttribute('aria-hidden', 'false');
      warningTimeoutId = setTimeout(function () {
        weatherWarningEl.classList.remove('show'); weatherWarningEl.classList.add('hide'); weatherWarningEl.setAttribute('aria-hidden', 'true');
      }, CONFIG.warningDuration);
    }

    // Heavy rain passive drain
    if (heavyRain && health > 0) {
      health = Math.max(0, health - 0.5 * dt / 1000);
    }

    spawnTimer += dt;
    if (spawnTimer >= currentSpawnInterval) {
      spawnTimer = 0; spawnHazard();
      if (warningShown && Math.random() < 0.3) spawnHazard();
    }

    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i];
      if (!h.alive) { hazards.splice(i, 1); continue; }
      h.wobble += h.wobbleSpeed * dt / 1000;
      const wobbleX = Math.sin(h.wobble) * (h.type === 'leaf' ? 15 : 5);
      h.x += (h.vx + wobbleX) * dt / 1000; h.y += h.vy * dt / 1000; h.rotation += h.rotSpeed * dt / 1000;
      if (h.y >= getGutterY()) { onHazardMissed(h); hazards.splice(i, 1); continue; }
      if (h.x < -30 || h.x > cssW + 30) hazards.splice(i, 1);
    }

    for (let i = labels.length - 1; i >= 0; i--) { labels[i].life -= dt; labels[i].y -= CONFIG.labelRiseSpeed * dt / 1000; if (labels[i].life <= 0) labels.splice(i, 1); }
    for (let i = gutterLeaves.length - 1; i >= 0; i--) { gutterLeaves[i].life -= dt; if (gutterLeaves[i].life <= 0) gutterLeaves.splice(i, 1); }
    for (let i = waterPools.length - 1; i >= 0; i--) { waterPools[i].life -= dt; if (waterPools[i].life <= 0) waterPools.splice(i, 1); }
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.life -= dt; p.vy += 150 * dt / 1000; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; if (p.life <= 0) particles.splice(i, 1); }

    if (shakeTime > 0) { shakeTime -= dt; const intensity = REDUCED_MOTION ? 0 : CONFIG.shakeIntensity * (shakeTime / CONFIG.shakeDuration); shakeOffsetX = rand(-intensity, intensity); shakeOffsetY = rand(-intensity, intensity); }
    else { shakeOffsetX = 0; shakeOffsetY = 0; }

    scoreEl.textContent = score;
    const healthPct = Math.round(health); healthFill.style.width = healthPct + '%'; healthBar.setAttribute('aria-valuenow', healthPct);

    if (health <= 0) { endGame(false); return; }
    if (timeRemaining <= 0) { endGame(true); return; }
  }

  function render() {
    ctx.fillStyle = CONFIG.canvasClearColor; ctx.fillRect(0, 0, cssW, cssH);
    const skyGrad = ctx.createLinearGradient(0, 0, 0, cssH * 0.65);
    skyGrad.addColorStop(0, '#0A0A0A'); skyGrad.addColorStop(0.5, '#141414'); skyGrad.addColorStop(1, '#1E1A16');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, cssW, cssH * 0.65);
    const groundGrad = ctx.createLinearGradient(0, cssH * 0.95, 0, cssH);
    groundGrad.addColorStop(0, '#1A1714'); groundGrad.addColorStop(1, '#0A0A0A');
    ctx.fillStyle = groundGrad; ctx.fillRect(0, cssH * 0.95, cssW, cssH * 0.05);
    drawHouse();
    hazards.forEach(drawHazard);
    drawParticles();
    drawLabels();
  }

  function gameLoop(timestamp) {
    if (state !== 'playing') return;
    const dt = Math.min(timestamp - lastFrameTime, 50); lastFrameTime = timestamp;
    if (!visibilityPaused) { update(dt); render(); }
    rafId = requestAnimationFrame(gameLoop);
  }

  function startGame() {
    health = CONFIG.startHealth; score = 0; timeRemaining = CONFIG.gameDuration; elapsedSec = 0; spawnTimer = 0;
    currentSpawnInterval = CONFIG.baseSpawnInterval; currentFallSpeed = CONFIG.baseFallSpeed;
    warningShown = false; visibilityPaused = false; heavyRain = false;
    hazards = []; labels = []; gutterLeaves = []; waterPools = []; particles = [];
    shakeTime = 0; shakeOffsetX = 0; shakeOffsetY = 0;
    if (warningTimeoutId) { clearTimeout(warningTimeoutId); warningTimeoutId = null; }
    weatherWarningEl.classList.remove('show', 'hide'); weatherWarningEl.setAttribute('aria-hidden', 'true');
    scoreEl.textContent = '0'; timerEl.textContent = CONFIG.gameDuration; healthFill.style.width = '100%'; healthBar.setAttribute('aria-valuenow', 100);
    startScreen.setAttribute('aria-hidden', 'true'); endScreen.setAttribute('aria-hidden', 'true'); hudEl.setAttribute('aria-hidden', 'false');
    state = 'playing'; gameStartTime = performance.now(); lastFrameTime = performance.now();
    rafId = requestAnimationFrame(gameLoop);
    trackGameEvent('game_started', { gameName: CONFIG.gameName, duration: CONFIG.gameDuration });
  }

  function endGame(survived) {
    if (state === 'ended') return; state = 'ended';
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (warningTimeoutId) { clearTimeout(warningTimeoutId); warningTimeoutId = null; }
    weatherWarningEl.classList.remove('show'); weatherWarningEl.classList.add('hide'); weatherWarningEl.setAttribute('aria-hidden', 'true');
    const healthPct = Math.max(0, Math.round(health));
    finalScoreEl.textContent = score; finalHealthEl.textContent = healthPct;
    if (survived) { endHeading.textContent = 'YOU KEPT THE WATER FLOWING'; trackGameEvent('game_completed', { gameName: CONFIG.gameName, score: score, health: healthPct, result: 'survived' }); }
    else { endHeading.textContent = 'YOUR GUTTER COULDN\u2019T KEEP UP'; trackGameEvent('game_failed', { gameName: CONFIG.gameName, score: score, health: 0, result: 'failed' }); }
    hudEl.setAttribute('aria-hidden', 'true'); endScreen.setAttribute('aria-hidden', 'false'); render();
  }

  function restartGame() {
    trackGameEvent('game_restarted', { gameName: CONFIG.gameName });
    shareStatusEl.textContent = ''; endScreen.setAttribute('aria-hidden', 'true'); startGame();
  }

  /* ---- Score Card ---- */
  function createScoreCard(scoreVal, flowVal) {
    const W = 1200, H = 630;
    const off = document.createElement('canvas'); off.width = W; off.height = H; const c = off.getContext('2d');
    c.fillStyle = '#0A0A0A'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#F58025'; c.lineWidth = 6; c.strokeRect(12, 12, W - 24, H - 24);
    c.strokeStyle = 'rgba(245,128,37,0.25)'; c.lineWidth = 1; c.strokeRect(22, 22, W - 44, H - 44);
    c.fillStyle = '#F58025'; c.font = '700 24px -apple-system,sans-serif'; c.textAlign = 'center'; c.fillText('NANOSEAL NB', W / 2, 75);
    c.fillStyle = '#FFFFFF'; c.font = '800 48px -apple-system,sans-serif'; c.fillText('I KEPT THE WATER FLOWING', W / 2, 150);
    c.fillStyle = '#F58025'; c.font = '700 18px -apple-system,sans-serif'; c.textAlign = 'right'; c.fillText('SCORE', W / 2 - 30, 240);
    c.fillStyle = '#FFFFFF'; c.font = '800 64px -apple-system,sans-serif'; c.fillText(String(scoreVal), W / 2 - 30, 300);
    c.fillStyle = '#F58025'; c.font = '700 18px -apple-system,sans-serif'; c.textAlign = 'left'; c.fillText('DRAINAGE FLOW', W / 2 + 30, 240);
    c.fillStyle = '#FFFFFF'; c.font = '800 64px -apple-system,sans-serif'; c.fillText(flowVal + '%', W / 2 + 30, 300);
    c.strokeStyle = '#2A2A2A'; c.lineWidth = 1; c.beginPath(); c.moveTo(W / 2 - 15, 205); c.lineTo(W / 2 - 15, 310); c.stroke(); c.beginPath(); c.moveTo(W / 2 + 15, 205); c.lineTo(W / 2 + 15, 310); c.stroke();
    c.fillStyle = '#B0B0B0'; c.font = '400 26px -apple-system,sans-serif'; c.textAlign = 'center'; c.fillText('Can your gutter survive New Brunswick weather?', W / 2, 380);
    c.fillStyle = '#F58025'; c.font = '700 30px -apple-system,sans-serif'; c.fillText(CONFIG.canonicalURL.replace('https://', ''), W / 2, 445);
    c.fillStyle = '#707070'; c.font = '400 20px -apple-system,sans-serif'; c.fillText('Play the 20-second Roof Challenge', W / 2, 510);
    return off;
  }

  var shareInProgress = false;
  function shareScore(scoreVal, flowVal) {
    if (shareInProgress) return; shareInProgress = true;
    var originalLabel = shareBtn.textContent; shareBtn.disabled = true; shareBtn.textContent = 'PREPARING SCORE...'; shareStatusEl.textContent = '';
    var cardCanvas = createScoreCard(scoreVal, flowVal);
    cardCanvas.toBlob(function (blob) {
      if (!blob) { shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; shareStatusEl.textContent = 'Could not generate score card. Please try again.'; return; }
      var shareText = 'I scored ' + scoreVal + ' points with ' + flowVal + '% drainage flow in NanoSeal NB\u2019s Gutter Guardian. Can you beat my score?\n\n' + CONFIG.canonicalURL;
      var shareTitle = 'Gutter Guardian | NanoSeal NB';
      var sharingMethod = 'clipboard-download';
      var canShareFiles = false;
      try { if (typeof navigator.canShare === 'function') { var testFile = new File([blob], 'nanoseal-gutter-guardian-score.png', { type: 'image/png' }); canShareFiles = navigator.canShare({ files: [testFile] }); } } catch (e) { canShareFiles = false; }
      if (canShareFiles) {
        sharingMethod = 'native-file'; var shareFile = new File([blob], 'nanoseal-gutter-guardian-score.png', { type: 'image/png' });
        trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod });
        navigator.share({ title: shareTitle, text: shareText, url: CONFIG.canonicalURL, files: [shareFile] }).then(function () {
          trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod, result: 'shared' });
          shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel;
        }).catch(function (err) {
          if (err && err.name === 'AbortError') shareStatusEl.textContent = ''; else shareStatusEl.textContent = 'Sharing was interrupted. Please try again.';
          shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel;
        });
        return;
      }
      if (typeof navigator.share === 'function') {
        sharingMethod = 'native-text';
        trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod });
        navigator.share({ title: shareTitle, text: shareText, url: CONFIG.canonicalURL }).then(function () {
          trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod, result: 'shared' });
          var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'nanoseal-gutter-guardian-score.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel;
        }).catch(function (err) {
          if (err && err.name === 'AbortError') shareStatusEl.textContent = ''; else fallbackClipboardDownload(blob, shareText, scoreVal, flowVal, originalLabel, sharingMethod);
          shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel;
        });
        return;
      }
      fallbackClipboardDownload(blob, shareText, scoreVal, flowVal, originalLabel, sharingMethod);
    }, 'image/png');
  }

  function fallbackClipboardDownload(blob, shareText, scoreVal, flowVal, originalLabel, sharingMethod) {
    sharingMethod = 'clipboard-download';
    trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod });
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(shareText).then(function () {
        var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'nanoseal-gutter-guardian-score.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        shareStatusEl.textContent = 'Score copied \u2014 share your score card and challenge a friend!';
        trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod, result: 'clipboard-download' });
      }).catch(function () {
        var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'nanoseal-gutter-guardian-score.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        shareStatusEl.textContent = 'Your score card has been saved. Share it and challenge a friend!';
        trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod, result: 'download-only' });
      }).finally(function () { shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; });
    } else {
      var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'nanoseal-gutter-guardian-score.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      shareStatusEl.textContent = 'Your score card has been saved. Share it and challenge a friend!';
      trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod, result: 'download-only' });
      shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel;
    }
  }

  startBtn.addEventListener('click', startGame);
  tryAgainBtn.addEventListener('click', restartGame);
  assessmentLink.addEventListener('click', function () { trackGameEvent('assessment_clicked', { gameName: CONFIG.gameName, url: 'https://nanosealnb.ca/contact/' }); });
  shareBtn.addEventListener('click', function () { var s = parseInt(scoreEl.textContent, 10) || 0; var h = parseInt(finalHealthEl.textContent, 10) || 0; shareScore(s, h); });
  shareBtn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shareBtn.click(); } });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'playing') { visibilityPaused = true; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    else if (!document.hidden && state === 'playing' && visibilityPaused) { visibilityPaused = false; lastFrameTime = performance.now(); rafId = requestAnimationFrame(gameLoop); }
  });
  window.addEventListener('resize', function () { if (state === 'playing' && !visibilityPaused) render(); });
  window.addEventListener('keydown', function (e) { if (state === 'playing' && (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) e.preventDefault(); });

  trackGameEvent('game_viewed', { gameName: CONFIG.gameName });
  render();
})();