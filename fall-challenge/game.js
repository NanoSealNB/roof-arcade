/* ============================================================
   Can Your Roof Survive Fall? - NanoSeal NB
   Game Engine - Vanilla JS + Canvas
   ============================================================
   All gameplay constants live in CONFIG.
   To change difficulty, edit CONFIG values below.
   ============================================================ */
(function () {
  'use strict';

  /* ============================================================
     CONFIG - Edit these values to tune difficulty & gameplay
     ============================================================ */
  const CONFIG = {
    // --- Game duration & pacing ---
    gameDuration: 20,             // seconds total
    warningTime: 15,              // show WEATHER WARNING when this many seconds remain
    warningDuration: 2500,        // ms the warning banner stays visible

    // --- Roof health ---
    maxHealth: 100,
    startHealth: 100,
    healthPerMiss: {              // damage taken when a hazard reaches the roof
      leaf: 4,
      rain: 3,
      moss: 6,
      branch: 12
    },

    // --- Scoring ---
    points: {
      leaf: 10,
      rain: 15,
      moss: 20,
      branch: 30
    },

    // --- Hazard spawn timing (ms) ---
    baseSpawnInterval: 950,       // initial ms between spawns
    minSpawnInterval: 280,        // fastest spawn rate
    spawnRampFactor: 0.035,      // how fast spawns get more frequent per second
    warningSpawnMultiplier: 0.55, // multiply interval after weather warning

    // --- Hazard fall speed (pixels per second) ---
    baseFallSpeed: 140,
    maxFallSpeed: 420,
    speedRampPerSec: 8,           // speed increase per second
    warningSpeedBoost: 120,       // added to fall speed after warning

    // --- Hazard mix (relative weights) ---
    hazardWeights: {
      leaf: 35,
      rain: 30,
      moss: 15,
      branch: 20
    },

    // --- Roof geometry (relative to canvas) ---
    roofTopY: 0.62,               // fraction of canvas height where roof begins
    roofSlopeOffset: 0.06,        // roof peak offset from center (fraction of width)

    // --- Floating labels ---
    labelLifespan: 1400,          // ms a damage label stays visible
    labelRiseSpeed: 40,           // px/sec the label rises

    // --- Visual effects ---
    granuleCount: 8,              // granules released on branch hit
    wetPatchLifespan: 3000,       // ms a rain wet patch lasts
    mossStreakLifespan: 8000,     // ms a moss streak lasts
    leafGutterLifespan: 6000,     // ms a leaf sits in the gutter
    shakeDuration: 400,           // ms roof shake on branch impact
    shakeIntensity: 6,            // px shake magnitude

    // --- Misc ---
    canvasClearColor: '#0A0A0A',
  };

  // Reduced motion preference
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================
     Analytics Hook
     Call trackGameEvent('event_name', { ... }) anywhere.
     Later, connect to Meta Pixel / GA4 / GoHighLevel here.
     ============================================================ */
  function trackGameEvent(eventName, data) {
    if (typeof console !== 'undefined' && console.log) {
      console.log('[GameEvent]', eventName, data || {});
    }
    // Future integration points:
    // if (window.fbq) fbq('trackCustom', eventName, data);
    // if (window.gtag) gtag('event', eventName, data);
    // if (window._paq) _paq.push(['trackEvent', 'Game', eventName]);
  }

  /* ============================================================
     DOM References
     ============================================================ */
  const canvas = document.getElementById('game-canvas');
  const fallbackEl = document.getElementById('canvas-fallback');
  const startScreen = document.getElementById('start-screen');
  const startBtn = document.getElementById('start-btn');
  const endScreen = document.getElementById('end-screen');
  const tryAgainBtn = document.getElementById('try-again-btn');
  const assessmentLink = document.getElementById('assessment-link');
  const hudEl = document.getElementById('hud');
  const scoreEl = document.getElementById('score');
  const timerEl = document.getElementById('timer');
  const healthFill = document.getElementById('health-fill');
  const healthBar = document.querySelector('.health-bar');
  const weatherWarningEl = document.getElementById('weather-warning');
  const endHeading = document.getElementById('end-heading');
  const finalScoreEl = document.getElementById('final-score');
  const finalHealthEl = document.getElementById('final-health');

  /* Canvas support check */
  if (!canvas || !canvas.getContext) {
    if (fallbackEl) fallbackEl.style.display = 'block';
    if (startScreen) startScreen.style.display = 'none';
    return;
  }
  if (fallbackEl) fallbackEl.style.display = 'none';

  const ctx = canvas.getContext('2d');

  /* ============================================================
     Canvas Sizing & High-DPI Support
     ============================================================ */
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  /* ============================================================
     Game State
     ============================================================ */
  let state = 'idle';  // idle, playing, ended
  let health = CONFIG.startHealth;
  let score = 0;
  let timeRemaining = CONFIG.gameDuration;
  let lastFrameTime = 0;
  let gameStartTime = 0;
  let elapsedSec = 0;
  let spawnTimer = 0;
  let currentSpawnInterval = CONFIG.baseSpawnInterval;
  let currentFallSpeed = CONFIG.baseFallSpeed;
  let warningShown = false;
  let warningTimeoutId = null;
  let rafId = null;
  let visibilityPaused = false;

  // Entity arrays
  let hazards = [];
  let labels = [];
  let wetPatches = [];
  let mossStreaks = [];
  let gutterLeaves = [];
  let granules = [];
  let particles = [];   // small hit-confirmation particles

  // Shake state
  let shakeTime = 0;
  let shakeOffsetX = 0;
  let shakeOffsetY = 0;

  /* ============================================================
     Utility Functions
     ============================================================ */
  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // Weighted hazard type selection
  function pickHazardType() {
    const w = CONFIG.hazardWeights;
    const total = w.leaf + w.rain + w.moss + w.branch;
    let r = Math.random() * total;
    if ((r -= w.leaf) < 0) return 'leaf';
    if ((r -= w.rain) < 0) return 'rain';
    if ((r -= w.moss) < 0) return 'moss';
    return 'branch';
  }

  /* ============================================================
     Roof Geometry Helpers
     ============================================================ */
  function getRoofGeometry() {
    const topY = cssH * CONFIG.roofTopY;
    const peakOffset = cssW * CONFIG.roofSlopeOffset;
    const peakX = cssW * 0.5 + peakOffset;
    const leftEdge = cssW * 0.05;
    const rightEdge = cssW * 0.95;
    const roofHeight = cssH * 0.18;
    const peakY = topY;
    const eaveY = topY + roofHeight;
    const gutterY = eaveY + 6;
    return {
      leftEdge, rightEdge, peakX, peakY, eaveY, topY, roofHeight, gutterY,
      leftSlope: { x1: leftEdge, y1: eaveY, x2: peakX, y2: peakY },
      rightSlope: { x1: peakX, y1: peakY, x2: rightEdge, y2: eaveY }
    };
  }

  // Get the roof surface Y at a given X (for impact detection)
  function getRoofYAt(x) {
    const g = getRoofGeometry();
    if (x < g.leftEdge || x > g.rightEdge) return g.eaveY + 20;
    if (x <= g.peakX) {
      const t = (x - g.leftEdge) / (g.peakX - g.leftEdge);
      return g.eaveY + (g.peakY - g.eaveY) * t;
    } else {
      const t = (x - g.peakX) / (g.rightEdge - g.peakX);
      return g.peakY + (g.eaveY - g.peakY) * t;
    }
  }

  /* ============================================================
     Hazard Creation
     ============================================================ */
  function spawnHazard() {
    const type = pickHazardType();
    const x = rand(cssW * 0.1, cssW * 0.9);
    const size = type === 'branch' ? rand(18, 28) : type === 'leaf' ? rand(14, 22) : rand(8, 16);
    hazards.push({
      type: type,
      x: x,
      y: -size,
      vx: type === 'leaf' ? rand(-20, 20) : rand(-8, 8),  // leaves drift more
      vy: currentFallSpeed + rand(-15, 25),
      size: size,
      rotation: rand(0, Math.PI * 2),
      rotSpeed: rand(-2, 2),
      wobble: rand(0, Math.PI * 2),
      wobbleSpeed: rand(2, 4),
      alive: true
    });
  }

  /* ============================================================
     Floating Labels (GRANULE LOSS, MOISTURE, etc.)
     ============================================================ */
  function addLabel(text, x, y, color) {
    labels.push({
      text: text,
      x: x,
      y: y,
      color: color || '#FFFFFF',
      alpha: 1,
      life: CONFIG.labelLifespan,
      maxLife: CONFIG.labelLifespan
    });
  }

  /* ============================================================
     Visual Effects on Miss
     ============================================================ */
  function onHazardMissed(hazard) {
    const roofY = getRoofYAt(hazard.x);
    const dmg = CONFIG.healthPerMiss[hazard.type];
    health = Math.max(0, health - dmg);

    switch (hazard.type) {
      case 'leaf':
        // Leaf collects in gutter
        const gutterX = clamp(hazard.x, getRoofGeometry().leftEdge + 10, getRoofGeometry().rightEdge - 10);
        gutterLeaves.push({
          x: gutterX,
          y: getRoofGeometry().gutterY + rand(2, 8),
          rotation: rand(0, Math.PI * 2),
          size: hazard.size,
          color: pickLeafColor(),
          life: CONFIG.leafGutterLifespan,
          maxLife: CONFIG.leafGutterLifespan
        });
        addLabel('GUTTER BUILDUP', hazard.x, roofY - 10, '#F58025');
        break;

      case 'rain':
        wetPatches.push({
          x: hazard.x,
          y: roofY,
          radius: rand(12, 20),
          life: CONFIG.wetPatchLifespan,
          maxLife: CONFIG.wetPatchLifespan
        });
        addLabel('MOISTURE', hazard.x, roofY - 10, '#6EC6E6');
        break;

      case 'moss':
        mossStreaks.push({
          x: hazard.x,
          y: roofY,
          width: rand(8, 14),
          height: rand(20, 35),
          life: CONFIG.mossStreakLifespan,
          maxLife: CONFIG.mossStreakLifespan
        });
        addLabel('MOSS GROWTH', hazard.x, roofY - 10, '#6B8E23');
        break;

      case 'branch':
        // Roof shake + granule loss
        shakeTime = CONFIG.shakeDuration;
        for (let i = 0; i < CONFIG.granuleCount; i++) {
          granules.push({
            x: hazard.x + rand(-15, 15),
            y: roofY + rand(-5, 5),
            vx: rand(-60, 60),
            vy: rand(-80, -20),
            size: rand(2, 4),
            life: 1500,
            maxLife: 1500,
            color: '#1A1A1A'
          });
        }
        addLabel('GRANULE LOSS', hazard.x, roofY - 20, '#E53935');
        break;
    }
  }

  /* ============================================================
     Hazard Clicked / Tapped
     ============================================================ */
  function onHazardHit(hazard, index) {
    hazard.alive = false;
    score += CONFIG.points[hazard.type];

    // Hit particles
    const particleColor = getHazardColor(hazard.type);
    for (let i = 0; i < 6; i++) {
      particles.push({
        x: hazard.x,
        y: hazard.y,
        vx: rand(-80, 80),
        vy: rand(-80, 30),
        size: rand(2, 5),
        life: 500,
        maxLife: 500,
        color: particleColor
      });
    }
  }

  function getHazardColor(type) {
    switch (type) {
      case 'leaf': return pickLeafColor();
      case 'rain': return '#6EC6E6';
      case 'moss': return '#6B8E23';
      case 'branch': return '#8B5A2B';
      default: return '#FFFFFF';
    }
  }

  function pickLeafColor() {
    const colors = ['#F58025', '#D4651C', '#E89B3C', '#C45028', '#B8651A'];
    return colors[randInt(0, colors.length - 1)];
  }

  /* ============================================================
     Input Handling (Mouse + Touch)
     ============================================================ */
  function handlePointer(clientX, clientY) {
    if (state !== 'playing') return;

    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    // Check hazards in reverse order (topmost first)
    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i];
      if (!h.alive) continue;
      const dx = px - h.x;
      const dy = py - h.y;
      const hitRadius = h.size + 12; // generous tap target for older users
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        onHazardHit(h, i);
        return;
      }
    }
  }

  // Mouse
  canvas.addEventListener('mousedown', function (e) {
    e.preventDefault();
    handlePointer(e.clientX, e.clientY);
  });

  // Touch (use touches[0] to avoid needing e.changedTouches complexity)
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (e.touches.length > 0) {
      handlePointer(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  // Prevent context menu on long press
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ============================================================
     Drawing Functions
     ============================================================ */

  // Draw the house and roof
  function drawHouse() {
    const g = getRoofGeometry();
    const shakeX = shakeOffsetX;
    const shakeY = shakeOffsetY;

    // --- House body ---
    const bodyTop = g.eaveY;
    const bodyBottom = cssH;
    const bodyLeft = g.leftEdge + 10;
    const bodyRight = g.rightEdge - 10;

    // Walls
    ctx.fillStyle = '#2E2A26';
    ctx.fillRect(bodyLeft, bodyTop, bodyRight - bodyLeft, bodyBottom - bodyTop);

    // Door
    const doorW = Math.min(50, cssW * 0.1);
    const doorH = Math.min(80, cssH * 0.12);
    const doorX = (bodyLeft + bodyRight) / 2 - doorW / 2;
    const doorY = bodyBottom - doorH;
    ctx.fillStyle = '#3D352D';
    ctx.fillRect(doorX, doorY, doorW, doorH);
    ctx.strokeStyle = '#1A1714';
    ctx.lineWidth = 2;
    ctx.strokeRect(doorX, doorY, doorW, doorH);
    // Door handle
    ctx.fillStyle = '#F58025';
    ctx.beginPath();
    ctx.arc(doorX + doorW * 0.8, doorY + doorH * 0.5, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Windows
    const winSize = Math.min(40, cssW * 0.08);
    const winY = bodyTop + (bodyBottom - bodyTop) * 0.35;
    const winLeftX = bodyLeft + (doorX - bodyLeft) / 2 - winSize / 2;
    const winRightX = doorX + doorW + (bodyRight - (doorX + doorW)) / 2 - winSize / 2;
    drawWindow(winLeftX, winY, winSize);
    drawWindow(winRightX, winY, winSize);

    // --- Roof (with shake offset) ---
    ctx.save();
    ctx.translate(shakeX, shakeY);

    // Roof fill - asphalt shingle dark grey
    ctx.beginPath();
    ctx.moveTo(g.leftEdge, g.eaveY);
    ctx.lineTo(g.peakX, g.peakY);
    ctx.lineTo(g.rightEdge, g.eaveY);
    ctx.closePath();
    ctx.fillStyle = '#3A3530';
    ctx.fill();

    // Shingle texture lines
    ctx.strokeStyle = '#2E2A25';
    ctx.lineWidth = 1;
    const shingleRows = 6;
    for (let r = 1; r <= shingleRows; r++) {
      const t = r / shingleRows;
      // Left slope line
      const ly1 = g.eaveY + (g.peakY - g.eaveY) * t;
      const lx1 = g.leftEdge + (g.peakX - g.leftEdge) * t;
      const ly2 = ly1;
      const lx2 = g.peakX - (g.peakX - g.leftEdge) * 0.08 * (1 - t);
      ctx.beginPath();
      ctx.moveTo(lx1, ly1);
      ctx.lineTo(lx2, ly2);
      ctx.stroke();
      // Right slope line
      const ry1 = g.peakY + (g.eaveY - g.peakY) * t;
      const rx1 = g.peakX + (g.rightEdge - g.peakX) * 0.08 * (1 - t);
      const ry2 = ly1;
      const rx2 = g.rightEdge - (g.rightEdge - g.peakX) * t;
      // Use simpler: horizontal lines across both slopes
      const yLevel = g.eaveY - (g.eaveY - g.peakY) * t;
      ctx.beginPath();
      ctx.moveTo(g.leftEdge + (g.peakX - g.leftEdge) * t, yLevel);
      ctx.lineTo(g.peakX - (g.peakX - g.leftEdge) * 0.02 * t, yLevel);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(g.peakX + (g.rightEdge - g.peakX) * 0.02 * t, yLevel);
      ctx.lineTo(g.rightEdge - (g.rightEdge - g.peakX) * t, yLevel);
      ctx.stroke();
    }

    // Roof outline
    ctx.strokeStyle = '#1F1C19';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(g.leftEdge, g.eaveY);
    ctx.lineTo(g.peakX, g.peakY);
    ctx.lineTo(g.rightEdge, g.eaveY);
    ctx.stroke();

    // Moss streaks (drawn on roof)
    mossStreaks.forEach(function (s) {
      const alpha = clamp(s.life / s.maxLife, 0, 1) * 0.6;
      ctx.fillStyle = 'rgba(85, 107, 47, ' + alpha + ')';
      ctx.fillRect(s.x - s.width / 2, s.y, s.width, s.height);
    });

    // Wet patches (drawn on roof)
    wetPatches.forEach(function (p) {
      const alpha = clamp(p.life / p.maxLife, 0, 1) * 0.4;
      ctx.fillStyle = 'rgba(100, 150, 200, ' + alpha + ')';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.radius, p.radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // Gutter
    ctx.fillStyle = '#4A4540';
    ctx.fillRect(g.leftEdge - 2, g.eaveY, g.rightEdge - g.leftEdge + 4, 8);
    ctx.strokeStyle = '#2E2A26';
    ctx.lineWidth = 1;
    ctx.strokeRect(g.leftEdge - 2, g.eaveY, g.rightEdge - g.leftEdge + 4, 8);

    // Gutter leaves
    gutterLeaves.forEach(function (gl) {
      const alpha = clamp(gl.life / gl.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(gl.x, gl.y);
      ctx.rotate(gl.rotation);
      drawLeafShape(0, 0, gl.size, gl.color);
      ctx.restore();
    });
    ctx.globalAlpha = 1;

    // Granules
    granules.forEach(function (gr) {
      const alpha = clamp(gr.life / gr.maxLife, 0, 1);
      ctx.fillStyle = 'rgba(26,26,26,' + alpha + ')';
      ctx.fillRect(gr.x - gr.size / 2, gr.y - gr.size / 2, gr.size, gr.size);
    });

    ctx.restore(); // end shake transform
  }

  function drawWindow(x, y, size) {
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = '#F58025';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, size, size);
    // Window cross
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y);
    ctx.lineTo(x + size / 2, y + size);
    ctx.moveTo(x, y + size / 2);
    ctx.lineTo(x + size, y + size / 2);
    ctx.stroke();
  }

  function drawLeafShape(x, y, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, size * 0.5, size, 0, 0, Math.PI * 2);
    ctx.fill();
    // Leaf vein
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
  }

  function drawHazard(h) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rotation);

    switch (h.type) {
      case 'leaf':
        drawLeafShape(0, 0, h.size, getHazardColor('leaf'));
        break;

      case 'rain':
        ctx.fillStyle = '#6EC6E6';
        ctx.beginPath();
        ctx.moveTo(0, -h.size);
        ctx.bezierCurveTo(h.size * 0.6, -h.size * 0.3, h.size * 0.6, h.size * 0.5, 0, h.size);
        ctx.bezierCurveTo(-h.size * 0.6, h.size * 0.5, -h.size * 0.6, -h.size * 0.3, 0, -h.size);
        ctx.fill();
        // Highlight
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.ellipse(-h.size * 0.2, -h.size * 0.2, h.size * 0.15, h.size * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'moss':
        ctx.fillStyle = '#6B8E23';
        ctx.beginPath();
        ctx.arc(0, 0, h.size, 0, Math.PI * 2);
        ctx.fill();
        // Texture dots
        ctx.fillStyle = '#556B2F';
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * h.size * 0.4, Math.sin(a) * h.size * 0.4, h.size * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      case 'branch':
        ctx.strokeStyle = '#8B5A2B';
        ctx.lineWidth = h.size * 0.35;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-h.size, h.size * 0.3);
        ctx.lineTo(h.size * 0.3, -h.size * 0.5);
        ctx.stroke();
        // Small twigs
        ctx.lineWidth = h.size * 0.15;
        ctx.beginPath();
        ctx.moveTo(-h.size * 0.2, 0);
        ctx.lineTo(0, -h.size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(h.size * 0.1, -h.size * 0.2);
        ctx.lineTo(h.size * 0.5, -h.size * 0.6);
        ctx.stroke();
        break;
    }

    ctx.restore();
  }

  function drawLabels() {
    labels.forEach(function (l) {
      const t = l.life / l.maxLife;
      const alpha = t > 0.7 ? 1 : t / 0.7;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = l.color;
      ctx.font = '700 13px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(l.text, l.x, l.y);
      ctx.restore();
    });
  }

  function drawParticles() {
    particles.forEach(function (p) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /* ============================================================
     Game Loop - Update
     ============================================================ */
  function update(dt) {
    if (state !== 'playing' || visibilityPaused) return;

    elapsedSec = (performance.now() - gameStartTime) / 1000;
    timeRemaining = Math.max(0, CONFIG.gameDuration - elapsedSec);
    timerEl.textContent = Math.ceil(timeRemaining);

    // --- Difficulty ramp ---
    const progress = elapsedSec / CONFIG.gameDuration;
    currentSpawnInterval = Math.max(
      CONFIG.minSpawnInterval,
      CONFIG.baseSpawnInterval - (CONFIG.baseSpawnInterval - CONFIG.minSpawnInterval) * progress * CONFIG.spawnRampFactor * 10
    );
    currentFallSpeed = Math.min(
      CONFIG.maxFallSpeed,
      CONFIG.baseFallSpeed + CONFIG.speedRampPerSec * elapsedSec
    );

    // --- Weather warning ---
    if (!warningShown && timeRemaining <= CONFIG.warningTime) {
      warningShown = true;
      currentSpawnInterval *= CONFIG.warningSpawnMultiplier;
      currentFallSpeed += CONFIG.warningSpeedBoost;
      weatherWarningEl.classList.remove('hide');
      weatherWarningEl.classList.add('show');
      weatherWarningEl.setAttribute('aria-hidden', 'false');
      warningTimeoutId = setTimeout(function () {
        weatherWarningEl.classList.remove('show');
        weatherWarningEl.classList.add('hide');
        weatherWarningEl.setAttribute('aria-hidden', 'true');
      }, CONFIG.warningDuration);
    }

    // --- Spawn hazards ---
    spawnTimer += dt;
    if (spawnTimer >= currentSpawnInterval) {
      spawnTimer = 0;
      spawnHazard();
      // Occasionally spawn a second one after warning
      if (warningShown && Math.random() < 0.3) {
        spawnHazard();
      }
    }

    // --- Update hazards ---
    const roofGeom = getRoofGeometry();
    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i];
      if (!h.alive) {
        hazards.splice(i, 1);
        continue;
      }
      // Wobble (mainly for leaves)
      h.wobble += h.wobbleSpeed * dt / 1000;
      const wobbleX = Math.sin(h.wobble) * (h.type === 'leaf' ? 15 : 5);
      h.x += (h.vx + wobbleX) * dt / 1000;
      h.y += h.vy * dt / 1000;
      h.rotation += h.rotSpeed * dt / 1000;

      // Check if reached roof
      const roofY = getRoofYAt(h.x);
      if (h.y >= roofY) {
        onHazardMissed(h);
        hazards.splice(i, 1);
        continue;
      }

      // Off screen sides
      if (h.x < -30 || h.x > cssW + 30) {
        hazards.splice(i, 1);
      }
    }

    // --- Update labels ---
    for (let i = labels.length - 1; i >= 0; i--) {
      labels[i].life -= dt;
      labels[i].y -= CONFIG.labelRiseSpeed * dt / 1000;
      if (labels[i].life <= 0) labels.splice(i, 1);
    }

    // --- Update wet patches ---
    for (let i = wetPatches.length - 1; i >= 0; i--) {
      wetPatches[i].life -= dt;
      if (wetPatches[i].life <= 0) wetPatches.splice(i, 1);
    }

    // --- Update moss streaks ---
    for (let i = mossStreaks.length - 1; i >= 0; i--) {
      mossStreaks[i].life -= dt;
      if (mossStreaks[i].life <= 0) mossStreaks.splice(i, 1);
    }

    // --- Update gutter leaves ---
    for (let i = gutterLeaves.length - 1; i >= 0; i--) {
      gutterLeaves[i].life -= dt;
      if (gutterLeaves[i].life <= 0) gutterLeaves.splice(i, 1);
    }

    // --- Update granules ---
    for (let i = granules.length - 1; i >= 0; i--) {
      const g = granules[i];
      g.life -= dt;
      g.vy += 200 * dt / 1000; // gravity
      g.x += g.vx * dt / 1000;
      g.y += g.vy * dt / 1000;
      if (g.life <= 0) granules.splice(i, 1);
    }

    // --- Update particles ---
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.vy += 150 * dt / 1000;
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // --- Update shake ---
    if (shakeTime > 0) {
      shakeTime -= dt;
      const intensity = REDUCED_MOTION ? 0 : CONFIG.shakeIntensity * (shakeTime / CONFIG.shakeDuration);
      shakeOffsetX = rand(-intensity, intensity);
      shakeOffsetY = rand(-intensity, intensity);
    } else {
      shakeOffsetX = 0;
      shakeOffsetY = 0;
    }

    // --- Update HUD ---
    scoreEl.textContent = score;
    const healthPct = Math.round(health);
    healthFill.style.width = healthPct + '%';
    healthBar.setAttribute('aria-valuenow', healthPct);

    // --- Check end conditions ---
    if (health <= 0) {
      endGame(false);
      return;
    }
    if (timeRemaining <= 0) {
      endGame(true);
      return;
    }
  }

  /* ============================================================
     Game Loop - Render
     ============================================================ */
  function render() {
    // Clear
    ctx.fillStyle = CONFIG.canvasClearColor;
    ctx.fillRect(0, 0, cssW, cssH);

    // Background gradient (sky)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, cssH * 0.65);
    skyGrad.addColorStop(0, '#0A0A0A');
    skyGrad.addColorStop(0.5, '#141414');
    skyGrad.addColorStop(1, '#1E1A16');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, cssW, cssH * 0.65);

    // Subtle ground gradient
    const groundGrad = ctx.createLinearGradient(0, cssH * 0.95, 0, cssH);
    groundGrad.addColorStop(0, '#1A1714');
    groundGrad.addColorStop(1, '#0A0A0A');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, cssH * 0.95, cssW, cssH * 0.05);

    // Draw house & roof (includes effects drawn on roof)
    drawHouse();

    // Draw hazards
    hazards.forEach(drawHazard);

    // Draw particles
    drawParticles();

    // Draw floating labels
    drawLabels();
  }

  /* ============================================================
     Main Loop
     ============================================================ */
  function gameLoop(timestamp) {
    if (state !== 'playing') return;

    const dt = Math.min(timestamp - lastFrameTime, 50); // cap delta to avoid jumps
    lastFrameTime = timestamp;

    if (!visibilityPaused) {
      update(dt);
      render();
    }

    rafId = requestAnimationFrame(gameLoop);
  }

  /* ============================================================
     Game Start / End / Restart
     ============================================================ */
  function startGame() {
    // Reset all state
    health = CONFIG.startHealth;
    score = 0;
    timeRemaining = CONFIG.gameDuration;
    elapsedSec = 0;
    spawnTimer = 0;
    currentSpawnInterval = CONFIG.baseSpawnInterval;
    currentFallSpeed = CONFIG.baseFallSpeed;
    warningShown = false;
    visibilityPaused = false;
    hazards = [];
    labels = [];
    wetPatches = [];
    mossStreaks = [];
    gutterLeaves = [];
    granules = [];
    particles = [];
    shakeTime = 0;
    shakeOffsetX = 0;
    shakeOffsetY = 0;

    // Clear any pending warning timeout
    if (warningTimeoutId) {
      clearTimeout(warningTimeoutId);
      warningTimeoutId = null;
    }
    weatherWarningEl.classList.remove('show', 'hide');
    weatherWarningEl.setAttribute('aria-hidden', 'true');

    // Update HUD display
    scoreEl.textContent = '0';
    timerEl.textContent = CONFIG.gameDuration;
    healthFill.style.width = '100%';
    healthBar.setAttribute('aria-valuenow', 100);

    // Hide overlays
    startScreen.setAttribute('aria-hidden', 'true');
    endScreen.setAttribute('aria-hidden', 'true');
    hudEl.setAttribute('aria-hidden', 'false');

    // Start loop
    state = 'playing';
    gameStartTime = performance.now();
    lastFrameTime = performance.now();
    rafId = requestAnimationFrame(gameLoop);

    trackGameEvent('game_started', { duration: CONFIG.gameDuration });
  }

  function endGame(survived) {
    if (state === 'ended') return;
    state = 'ended';

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (warningTimeoutId) {
      clearTimeout(warningTimeoutId);
      warningTimeoutId = null;
    }

    // Hide weather warning
    weatherWarningEl.classList.remove('show');
    weatherWarningEl.classList.add('hide');
    weatherWarningEl.setAttribute('aria-hidden', 'true');

    // Update end screen
    const healthPct = Math.max(0, Math.round(health));
    finalScoreEl.textContent = score;
    finalHealthEl.textContent = healthPct;

    if (survived) {
      endHeading.textContent = 'YOU SURVIVED THE STORM';
      trackGameEvent('game_completed', {
        score: score,
        health: healthPct,
        result: 'survived'
      });
    } else {
      endHeading.textContent = 'MOTHER NATURE WINS AGAIN';
      trackGameEvent('game_failed', {
        score: score,
        health: 0,
        result: 'failed'
      });
    }

    // Show end screen
    hudEl.setAttribute('aria-hidden', 'true');
    endScreen.setAttribute('aria-hidden', 'false');

    // Render one final frame
    render();
  }

  function restartGame() {
    trackGameEvent('game_restarted', {});
    endScreen.setAttribute('aria-hidden', 'true');
    startGame();
  }

  /* ============================================================
     Event Listeners
     ============================================================ */
  startBtn.addEventListener('click', startGame);
  tryAgainBtn.addEventListener('click', restartGame);
  assessmentLink.addEventListener('click', function () {
    trackGameEvent('assessment_clicked', {
      url: 'https://nanosealnb.ca/contact/'
    });
  });

  // Pause when tab is hidden
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'playing') {
      visibilityPaused = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    } else if (!document.hidden && state === 'playing' && visibilityPaused) {
      visibilityPaused = false;
      lastFrameTime = performance.now();
      rafId = requestAnimationFrame(gameLoop);
    }
  });

  // Handle resize during play
  window.addEventListener('resize', function () {
    if (state === 'playing' && !visibilityPaused) {
      render(); // re-render with new dimensions
    }
  });

  // Prevent keyboard scrolling / zoom
  window.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (state === 'playing') e.preventDefault();
    }
  });

  /* ============================================================
     Initial render (idle state shows house behind start overlay)
     ============================================================ */
  render();

})();