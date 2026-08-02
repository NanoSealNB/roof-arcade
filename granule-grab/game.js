/* ============================================================
   Granule Grab - NanoSeal NB
   Tap falling granule clusters before they leave the screen
   ============================================================ */
(function () {
  'use strict';

  const CONFIG = {
    gameName: 'Granule Grab',
    canonicalURL: 'https://nanosealnb.ca/granule-grab/',
    gameDuration: 20, warningTime: 15, warningDuration: 2500,
    maxHealth: 100, startHealth: 100,
    healthPerMiss: { small: 2, medium: 4, large: 7, bonus: 0 },
    points: { small: 10, medium: 20, large: 30, bonus: 50 },
    baseSpawnInterval: 800, minSpawnInterval: 250,
    spawnRampFactor: 0.35, warningSpawnMultiplier: 0.5,
    baseFallSpeed: 120, maxFallSpeed: 380, speedRampPerSec: 7, warningSpeedBoost: 100,
    hazardWeights: { small: 40, medium: 30, large: 20, bonus: 10 },
    labelLifespan: 1400, labelRiseSpeed: 40,
    canvasClearColor: '#0A0A0A',
    shingleEdgeY: 0.82,
    windStrength: 0, warningWindBoost: 40
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

  if (!canvas || !canvas.getContext) { if (fallbackEl) fallbackEl.style.display = 'block'; if (startScreen) startScreen.style.display = 'none'; return; }
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
  let hazards = [], labels = [], particles = [];
  let windStrength = 0;

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function pickClusterType() {
    var w = CONFIG.hazardWeights; var total = w.small + w.medium + w.large + w.bonus;
    var r = Math.random() * total;
    if ((r -= w.small) < 0) return 'small';
    if ((r -= w.medium) < 0) return 'medium';
    if ((r -= w.large) < 0) return 'large';
    return 'bonus';
  }

  function spawnCluster() {
    var type = pickClusterType();
    var x = rand(cssW * 0.1, cssW * 0.9);
    var size = type === 'large' ? rand(20, 28) : type === 'medium' ? rand(14, 20) : type === 'bonus' ? rand(16, 22) : rand(8, 14);
    var granuleCount = type === 'large' ? randInt(6, 9) : type === 'medium' ? randInt(4, 6) : type === 'bonus' ? randInt(5, 7) : randInt(2, 4);
    hazards.push({
      type: type, x: x, y: -size,
      vx: rand(-10, 10) + windStrength * 0.3,
      vy: currentFallSpeed + rand(-10, 20),
      size: size, granuleCount: granuleCount,
      granules: [], rotation: rand(0, Math.PI * 2), rotSpeed: rand(-1, 1),
      wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(1, 3), alive: true
    });
    // Pre-generate granule offsets within the cluster
    var h = hazards[hazards.length - 1];
    for (var i = 0; i < granuleCount; i++) {
      h.granules.push({ ox: rand(-size * 0.5, size * 0.5), oy: rand(-size * 0.5, size * 0.5), r: rand(2, 4) });
    }
  }

  function addLabel(text, x, y, color) { labels.push({ text: text, x: x, y: y, color: color || '#FFFFFF', life: CONFIG.labelLifespan, maxLife: CONFIG.labelLifespan }); }

  function onClusterMissed(cluster) {
    if (cluster.type === 'bonus') return; // bonus doesn't damage
    var dmg = CONFIG.healthPerMiss[cluster.type];
    health = Math.max(0, health - dmg);
    var labelMap = { small: 'GRANULE LOSS', medium: 'SURFACE LOSS', large: 'BALD SPOT' };
    addLabel(labelMap[cluster.type] || 'LOSS', cluster.x, cluster.y - 15, '#E53935');
  }

  function onClusterHit(cluster) {
    cluster.alive = false;
    score += CONFIG.points[cluster.type];
    var labelMap = { small: '+' + CONFIG.points.small, medium: '+' + CONFIG.points.medium, large: '+' + CONFIG.points.large, bonus: 'BONUS +' + CONFIG.points.bonus };
    addLabel(labelMap[cluster.type], cluster.x, cluster.y - 15, cluster.type === 'bonus' ? '#F58025' : '#FFFFFF');
    var color = cluster.type === 'bonus' ? '#F58025' : '#1A1A1A';
    for (var i = 0; i < 6; i++) particles.push({ x: cluster.x, y: cluster.y, vx: rand(-60, 60), vy: rand(-60, 20), size: rand(2, 4), life: 500, maxLife: 500, color: color });
  }

  function handlePointer(clientX, clientY) {
    if (state !== 'playing') return;
    var rect = canvas.getBoundingClientRect(); var px = clientX - rect.left, py = clientY - rect.top;
    for (var i = hazards.length - 1; i >= 0; i--) { var h = hazards[i]; if (!h.alive) continue;
      var dx = px - h.x, dy = py - h.y; var hitRadius = h.size + 14;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) { onClusterHit(h); return; } }
  }

  canvas.addEventListener('mousedown', function (e) { e.preventDefault(); handlePointer(e.clientX, e.clientY); });
  canvas.addEventListener('touchstart', function (e) { e.preventDefault(); if (e.touches.length > 0) handlePointer(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function drawShingles() {
    var shingleTop = cssH * 0.12, shingleBottom = cssH * CONFIG.shingleEdgeY;
    var shingleLeft = cssW * 0.05, shingleRight = cssW * 0.95;
    // Base shingle color darkens as protection drops
    var protection = health / 100;
    var r = Math.round(58 - (1 - protection) * 20);
    var g = Math.round(53 - (1 - protection) * 15);
    var b = Math.round(48 - (1 - protection) * 10);
    ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    ctx.fillRect(shingleLeft, shingleTop, shingleRight - shingleLeft, shingleBottom - shingleTop);

    // Shingle rows
    var rows = 4;
    var rowH = (shingleBottom - shingleTop) / rows;
    ctx.strokeStyle = 'rgba(30,26,22,0.6)'; ctx.lineWidth = 1;
    for (var i = 0; i <= rows; i++) { ctx.beginPath(); ctx.moveTo(shingleLeft, shingleTop + rowH * i); ctx.lineTo(shingleRight, shingleTop + rowH * i); ctx.stroke(); }

    // Granule texture (dots) - fewer as protection drops
    var granuleDensity = Math.floor(protection * 80);
    ctx.fillStyle = 'rgba(20,18,16,0.5)';
    for (var j = 0; j < granuleDensity; j++) {
      var gx = rand(shingleLeft, shingleRight), gy = rand(shingleTop, shingleBottom);
      ctx.beginPath(); ctx.arc(gx, gy, 1.5, 0, Math.PI * 2); ctx.fill();
    }

    // Bald spots at low protection
    if (protection < 0.6) {
      var spots = Math.floor((1 - protection) * 8);
      ctx.fillStyle = 'rgba(10,10,10,0.4)';
      for (var s = 0; s < spots; s++) {
        var sx = rand(shingleLeft + 20, shingleRight - 20), sy = rand(shingleTop + 10, shingleBottom - 10);
        ctx.beginPath(); ctx.ellipse(sx, sy, rand(15, 30), rand(10, 20), 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    // UV glow at low protection
    if (protection < 0.5) {
      ctx.fillStyle = 'rgba(255,200,50,' + ((1 - protection) * 0.08) + ')';
      ctx.fillRect(shingleLeft, shingleTop, shingleRight - shingleLeft, shingleBottom - shingleTop);
    }

    // Gutter line at bottom
    ctx.fillStyle = '#4A4540'; ctx.fillRect(shingleLeft - 2, shingleBottom, shingleRight - shingleLeft + 4, 6);
  }

  function drawCluster(h) {
    ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.rotation);
    var baseColor = h.type === 'bonus' ? '#F58025' : '#1A1A1A';
    h.granules.forEach(function (g) {
      ctx.fillStyle = baseColor;
      ctx.beginPath(); ctx.arc(g.ox, g.oy, g.r, 0, Math.PI * 2); ctx.fill();
      if (h.type === 'bonus') {
        ctx.fillStyle = 'rgba(255,200,100,0.4)';
        ctx.beginPath(); ctx.arc(g.ox, g.oy, g.r + 2, 0, Math.PI * 2); ctx.fill();
      }
    });
    // Cluster outline for visibility
    ctx.strokeStyle = h.type === 'bonus' ? 'rgba(245,128,37,0.5)' : 'rgba(80,80,80,0.3)';
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, h.size, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawParticles() { particles.forEach(function (p) { var alpha = clamp(p.life / p.maxLife, 0, 1); ctx.fillStyle = p.color; ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); }); ctx.globalAlpha = 1; }
  function drawLabels() { labels.forEach(function (l) { var t = l.life / l.maxLife; var alpha = t > 0.7 ? 1 : t / 0.7; ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = l.color; ctx.font = '700 13px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(l.text, l.x, l.y); ctx.restore(); }); }

  function update(dt) {
    if (state !== 'playing' || visibilityPaused) return;
    elapsedSec = (performance.now() - gameStartTime) / 1000;
    timeRemaining = Math.max(0, CONFIG.gameDuration - elapsedSec);
    timerEl.textContent = Math.ceil(timeRemaining);
    var progress = elapsedSec / CONFIG.gameDuration;
    currentSpawnInterval = Math.max(CONFIG.minSpawnInterval, CONFIG.baseSpawnInterval - (CONFIG.baseSpawnInterval - CONFIG.minSpawnInterval) * progress * CONFIG.spawnRampFactor * 10);
    currentFallSpeed = Math.min(CONFIG.maxFallSpeed, CONFIG.baseFallSpeed + CONFIG.speedRampPerSec * elapsedSec);

    if (!warningShown && timeRemaining <= CONFIG.warningTime) {
      warningShown = true; currentSpawnInterval *= CONFIG.warningSpawnMultiplier; currentFallSpeed += CONFIG.warningSpeedBoost; windStrength = CONFIG.warningWindBoost;
      weatherWarningEl.classList.remove('hide'); weatherWarningEl.classList.add('show'); weatherWarningEl.setAttribute('aria-hidden', 'false');
      warningTimeoutId = setTimeout(function () { weatherWarningEl.classList.remove('show'); weatherWarningEl.classList.add('hide'); weatherWarningEl.setAttribute('aria-hidden', 'true'); }, CONFIG.warningDuration);
    }

    spawnTimer += dt;
    if (spawnTimer >= currentSpawnInterval) { spawnTimer = 0; spawnCluster(); if (warningShown && Math.random() < 0.3) spawnCluster(); }

    var shingleEdge = cssH * CONFIG.shingleEdgeY;
    for (var i = hazards.length - 1; i >= 0; i--) {
      var h = hazards[i]; if (!h.alive) { hazards.splice(i, 1); continue; }
      h.wobble += h.wobbleSpeed * dt / 1000;
      var wobbleX = Math.sin(h.wobble) * 8;
      h.x += (h.vx + wobbleX + windStrength * 0.3) * dt / 1000; h.y += h.vy * dt / 1000; h.rotation += h.rotSpeed * dt / 1000;
      if (h.y >= shingleEdge) { onClusterMissed(h); hazards.splice(i, 1); continue; }
      if (h.x < -30 || h.x > cssW + 30) hazards.splice(i, 1);
    }

    for (var j = labels.length - 1; j >= 0; j--) { labels[j].life -= dt; labels[j].y -= CONFIG.labelRiseSpeed * dt / 1000; if (labels[j].life <= 0) labels.splice(j, 1); }
    for (var k = particles.length - 1; k >= 0; k--) { var p = particles[k]; p.life -= dt; p.vy += 150 * dt / 1000; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; if (p.life <= 0) particles.splice(k, 1); }

    scoreEl.textContent = score;
    var healthPct = Math.round(health); healthFill.style.width = healthPct + '%'; healthBar.setAttribute('aria-valuenow', healthPct);
    if (health <= 0) { endGame(false); return; }
    if (timeRemaining <= 0) { endGame(true); return; }
  }

  function render() {
    ctx.fillStyle = CONFIG.canvasClearColor; ctx.fillRect(0, 0, cssW, cssH);
    var skyGrad = ctx.createLinearGradient(0, 0, 0, cssH * 0.65);
    skyGrad.addColorStop(0, '#0A0A0A'); skyGrad.addColorStop(0.5, '#141410'); skyGrad.addColorStop(1, '#1A1814');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, cssW, cssH * 0.65);
    drawShingles();
    hazards.forEach(drawCluster);
    drawParticles(); drawLabels();
  }

  function gameLoop(timestamp) { if (state !== 'playing') return; var dt = Math.min(timestamp - lastFrameTime, 50); lastFrameTime = timestamp; if (!visibilityPaused) { update(dt); render(); } rafId = requestAnimationFrame(gameLoop); }

  function startGame() {
    health = CONFIG.startHealth; score = 0; timeRemaining = CONFIG.gameDuration; elapsedSec = 0; spawnTimer = 0;
    currentSpawnInterval = CONFIG.baseSpawnInterval; currentFallSpeed = CONFIG.baseFallSpeed; windStrength = 0;
    warningShown = false; visibilityPaused = false;
    hazards = []; labels = []; particles = [];
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
    var healthPct = Math.max(0, Math.round(health));
    finalScoreEl.textContent = score; finalHealthEl.textContent = healthPct;
    if (survived) { endHeading.textContent = 'YOU PROTECTED THE SURFACE'; trackGameEvent('game_completed', { gameName: CONFIG.gameName, score: score, health: healthPct, result: 'survived' }); }
    else { endHeading.textContent = 'THE SHINGLES LOST THEIR PROTECTION'; trackGameEvent('game_failed', { gameName: CONFIG.gameName, score: score, health: 0, result: 'failed' }); }
    hudEl.setAttribute('aria-hidden', 'true'); endScreen.setAttribute('aria-hidden', 'false'); render();
  }

  function restartGame() { trackGameEvent('game_restarted', { gameName: CONFIG.gameName }); shareStatusEl.textContent = ''; endScreen.setAttribute('aria-hidden', 'true'); startGame(); }

  function createScoreCard(scoreVal, protectionVal) {
    var W = 1200, H = 630; var off = document.createElement('canvas'); off.width = W; off.height = H; var c = off.getContext('2d');
    c.fillStyle = '#0A0A0A'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#F58025'; c.lineWidth = 6; c.strokeRect(12, 12, W - 24, H - 24);
    c.strokeStyle = 'rgba(245,128,37,0.25)'; c.lineWidth = 1; c.strokeRect(22, 22, W - 44, H - 44);
    c.fillStyle = '#F58025'; c.font = '700 24px -apple-system,sans-serif'; c.textAlign = 'center'; c.fillText('NANOSEAL NB', W / 2, 75);
    c.fillStyle = '#FFFFFF'; c.font = '800 48px -apple-system,sans-serif'; c.fillText('I PROTECTED THE SURFACE', W / 2, 150);
    c.fillStyle = '#F58025'; c.font = '700 18px -apple-system,sans-serif'; c.textAlign = 'right'; c.fillText('SCORE', W / 2 - 30, 240);
    c.fillStyle = '#FFFFFF'; c.font = '800 64px -apple-system,sans-serif'; c.fillText(String(scoreVal), W / 2 - 30, 300);
    c.fillStyle = '#F58025'; c.font = '700 18px -apple-system,sans-serif'; c.textAlign = 'left'; c.fillText('PROTECTION', W / 2 + 30, 240);
    c.fillStyle = '#FFFFFF'; c.font = '800 64px -apple-system,sans-serif'; c.fillText(protectionVal + '%', W / 2 + 30, 300);
    c.strokeStyle = '#2A2A2A'; c.lineWidth = 1; c.beginPath(); c.moveTo(W / 2 - 15, 205); c.lineTo(W / 2 - 15, 310); c.stroke(); c.beginPath(); c.moveTo(W / 2 + 15, 205); c.lineTo(W / 2 + 15, 310); c.stroke();
    c.fillStyle = '#B0B0B0'; c.font = '400 26px -apple-system,sans-serif'; c.textAlign = 'center'; c.fillText('How many granules can you save?', W / 2, 380);
    c.fillStyle = '#F58025'; c.font = '700 30px -apple-system,sans-serif'; c.fillText(CONFIG.canonicalURL.replace('https://', ''), W / 2, 445);
    c.fillStyle = '#707070'; c.font = '400 20px -apple-system,sans-serif'; c.fillText('Play the 20-second Roof Challenge', W / 2, 510);
    return off;
  }

  var shareInProgress = false;
  function shareScore(scoreVal, protectionVal) {
    if (shareInProgress) return; shareInProgress = true;
    var originalLabel = shareBtn.textContent; shareBtn.disabled = true; shareBtn.textContent = 'PREPARING SCORE...'; shareStatusEl.textContent = '';
    var cardCanvas = createScoreCard(scoreVal, protectionVal);
    cardCanvas.toBlob(function (blob) {
      if (!blob) { shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; shareStatusEl.textContent = 'Could not generate score card. Please try again.'; return; }
      var shareText = 'I scored ' + scoreVal + ' points with ' + protectionVal + '% surface protection in NanoSeal NB\u2019s Granule Grab. Can you beat my score?\n\n' + CONFIG.canonicalURL;
      var shareTitle = 'Granule Grab | NanoSeal NB'; var sharingMethod = 'clipboard-download';
      var canShareFiles = false;
      try { if (typeof navigator.canShare === 'function') { var testFile = new File([blob], 'nanoseal-granule-grab-score.png', { type: 'image/png' }); canShareFiles = navigator.canShare({ files: [testFile] }); } } catch (e) { canShareFiles = false; }
      if (canShareFiles) { sharingMethod = 'native-file'; var shareFile = new File([blob], 'nanoseal-granule-grab-score.png', { type: 'image/png' });
        trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: protectionVal, sharingMethod: sharingMethod });
        navigator.share({ title: shareTitle, text: shareText, url: CONFIG.canonicalURL, files: [shareFile] }).then(function () { trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: protectionVal, sharingMethod: sharingMethod, result: 'shared' }); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }).catch(function (err) { if (err && err.name === 'AbortError') shareStatusEl.textContent = ''; else shareStatusEl.textContent = 'Sharing was interrupted. Please try again.'; shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }); return; }
      if (typeof navigator.share === 'function') { sharingMethod = 'native-text';
        trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: protectionVal, sharingMethod: sharingMethod });
        navigator.share({ title: shareTitle, text: shareText, url: CONFIG.canonicalURL }).then(function () { trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: protectionVal, sharingMethod: sharingMethod, result: 'shared' }); downloadBlob(blob); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }).catch(function (err) { if (err && err.name === 'AbortError') shareStatusEl.textContent = ''; else doFallback(blob, shareText, scoreVal, protectionVal, originalLabel); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }); return; }
      doFallback(blob, shareText, scoreVal, protectionVal, originalLabel);
    }, 'image/png');
  }

  function downloadBlob(blob) { var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'nanoseal-granule-grab-score.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }
  function doFallback(blob, shareText, scoreVal, protectionVal, originalLabel) {
    var sharingMethod = 'clipboard-download';
    trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: protectionVal, sharingMethod: sharingMethod });
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(shareText).then(function () { downloadBlob(blob); shareStatusEl.textContent = 'Score copied \u2014 share your score card and challenge a friend!'; trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: protectionVal, sharingMethod: sharingMethod, result: 'clipboard-download' }); }).catch(function () { downloadBlob(blob); shareStatusEl.textContent = 'Your score card has been saved. Share it and challenge a friend!'; trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: protectionVal, sharingMethod: sharingMethod, result: 'download-only' }); }).finally(function () { shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; });
    } else { downloadBlob(blob); shareStatusEl.textContent = 'Your score card has been saved. Share it and challenge a friend!'; trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: protectionVal, sharingMethod: sharingMethod, result: 'download-only' }); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }
  }

  startBtn.addEventListener('click', startGame);
  tryAgainBtn.addEventListener('click', restartGame);
  assessmentLink.addEventListener('click', function () { trackGameEvent('assessment_clicked', { gameName: CONFIG.gameName, url: 'https://nanosealnb.ca/contact/' }); });
  shareBtn.addEventListener('click', function () { var s = parseInt(scoreEl.textContent, 10) || 0; var h = parseInt(finalHealthEl.textContent, 10) || 0; shareScore(s, h); });
  shareBtn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shareBtn.click(); } });

  document.addEventListener('visibilitychange', function () { if (document.hidden && state === 'playing') { visibilityPaused = true; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } } else if (!document.hidden && state === 'playing' && visibilityPaused) { visibilityPaused = false; lastFrameTime = performance.now(); rafId = requestAnimationFrame(gameLoop); } });
  window.addEventListener('resize', function () { if (state === 'playing' && !visibilityPaused) render(); });
  window.addEventListener('keydown', function (e) { if (state === 'playing' && (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) e.preventDefault(); });

  trackGameEvent('game_viewed', { gameName: CONFIG.gameName });
  render();
})();