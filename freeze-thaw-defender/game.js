/* ============================================================
   Freeze-Thaw Defender - NanoSeal NB
   Tap moisture entry points before freeze cycles damage roof
   ============================================================ */
(function () {
  'use strict';

  const CONFIG = {
    gameName: 'Freeze-Thaw Defender',
    canonicalURL: 'https://nanosealnb.ca/freeze-thaw-defender/',
    gameDuration: 20, warningTime: 15, warningDuration: 2500,
    maxHealth: 100, startHealth: 100,
    healthPerFreeze: { small: 5, large: 9, flashing: 14 },
    points: { early: 20, wet: 10, flashing: 30 },
    baseSpawnInterval: 1000, minSpawnInterval: 350,
    spawnRampFactor: 0.35, warningSpawnMultiplier: 0.55,
    targetLifespan: 3000, warningTargetLifespan: 1800,
    hazardWeights: { small: 40, large: 35, flashing: 25 },
    labelLifespan: 1400, labelRiseSpeed: 40,
    shakeDuration: 400, shakeIntensity: 6,
    canvasClearColor: '#0A0A0A',
    gridCols: 4, gridRows: 3,
    tempCycleDuration: 4000
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
  let currentSpawnInterval = CONFIG.baseSpawnInterval;
  let warningShown = false, warningTimeoutId = null, rafId = null, visibilityPaused = false;
  let targets = [], particles = [], labels = [];
  let shakeTime = 0, shakeOffsetX = 0, shakeOffsetY = 0;
  let tempPhase = 'mild';
  let tempCycleTimer = 0;
  let tempDisplay = 8;

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function pickTargetType() {
    var w = CONFIG.hazardWeights; var total = w.small + w.large + w.flashing;
    var r = Math.random() * total;
    if ((r -= w.small) < 0) return 'small';
    if ((r -= w.large) < 0) return 'large';
    return 'flashing';
  }

  function getGridPositions() {
    var roofTop = cssH * 0.15, roofBottom = cssH * 0.85, roofLeft = cssW * 0.05, roofRight = cssW * 0.95;
    var cellW = (roofRight - roofLeft) / CONFIG.gridCols, cellH = (roofBottom - roofTop) / CONFIG.gridRows;
    var positions = [];
    for (var r = 0; r < CONFIG.gridRows; r++) for (var c = 0; c < CONFIG.gridCols; c++)
      positions.push({ x: roofLeft + cellW * (c + 0.5), y: roofTop + cellH * (r + 0.5), row: r, col: c });
    return positions;
  }

  function spawnTarget() {
    var positions = getGridPositions();
    var occupied = targets.map(function (t) { return t.row + ',' + t.col; });
    var available = positions.filter(function (p) { return occupied.indexOf(p.row + ',' + p.col) < 0; });
    if (available.length === 0) return;
    var pos = available[randInt(0, available.length - 1)];
    var type = pickTargetType();
    var lifespan = warningShown ? CONFIG.warningTargetLifespan : CONFIG.targetLifespan;
    targets.push({ type: type, x: pos.x, y: pos.y, row: pos.row, col: pos.col,
      size: type === 'flashing' ? rand(20, 28) : type === 'large' ? rand(16, 24) : rand(10, 16),
      life: lifespan, maxLife: lifespan, alive: true, isWet: false });
  }

  function addLabel(text, x, y, color) { labels.push({ text: text, x: x, y: y, color: color || '#FFFFFF', life: CONFIG.labelLifespan, maxLife: CONFIG.labelLifespan }); }

  function onTargetExpired(target) {
    // If target was wet during freeze, it causes damage
    if (tempPhase === 'freeze' && (target.isWet || tempDisplay < 0)) {
      var dmg = CONFIG.healthPerFreeze[target.type] || 5;
      health = Math.max(0, health - dmg);
      shakeTime = CONFIG.shakeDuration;
      var labelMap = { small: 'CRACK WIDENED', large: 'CRACK SPLIT', flashing: 'FLASHING BREACH' };
      addLabel(labelMap[target.type] || 'DAMAGE', target.x, target.y - 20, '#E53935');
    }
  }

  function onTargetHit(target) {
    target.alive = false;
    var pts = target.type === 'flashing' ? CONFIG.points.flashing : target.isWet ? CONFIG.points.wet : CONFIG.points.early;
    score += pts;
    var labelMap = { small: 'SEALED', large: 'SEALED', flashing: 'FLASHING SEALED' };
    addLabel(labelMap[target.type] + ' +' + pts, target.x, target.y - 15, '#F58025');
    for (var i = 0; i < 8; i++) particles.push({ x: target.x, y: target.y, vx: rand(-70, 70), vy: rand(-70, 20), size: rand(2, 5), life: 600, maxLife: 600, color: '#F58025' });
  }

  function handlePointer(clientX, clientY) {
    if (state !== 'playing') return;
    var rect = canvas.getBoundingClientRect(); var px = clientX - rect.left, py = clientY - rect.top;
    for (var i = targets.length - 1; i >= 0; i--) { var t = targets[i]; if (!t.alive) continue;
      var dx = px - t.x, dy = py - t.y; var hitRadius = t.size + 14;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) { onTargetHit(t); return; } }
  }

  canvas.addEventListener('mousedown', function (e) { e.preventDefault(); handlePointer(e.clientX, e.clientY); });
  canvas.addEventListener('touchstart', function (e) { e.preventDefault(); if (e.touches.length > 0) handlePointer(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function drawRoof() {
    var roofTop = cssH * 0.15, roofBottom = cssH * 0.85, roofLeft = cssW * 0.05, roofRight = cssW * 0.95;
    // Roof color shifts with temperature
    var baseColor = tempDisplay < 0 ? '#2E3540' : tempDisplay < 5 ? '#333538' : '#3A3530';
    ctx.fillStyle = baseColor; ctx.fillRect(roofLeft, roofTop, roofRight - roofLeft, roofBottom - roofTop);
    // Shingle grid
    var cellW = (roofRight - roofLeft) / CONFIG.gridCols, cellH = (roofBottom - roofTop) / CONFIG.gridRows;
    ctx.strokeStyle = '#2E2A25'; ctx.lineWidth = 1;
    for (var r = 0; r <= CONFIG.gridRows; r++) { ctx.beginPath(); ctx.moveTo(roofLeft, roofTop + cellH * r); ctx.lineTo(roofRight, roofTop + cellH * r); ctx.stroke(); }
    for (var c = 0; c <= CONFIG.gridCols; c++) { ctx.beginPath(); ctx.moveTo(roofLeft + cellW * c, roofTop); ctx.lineTo(roofLeft + cellW * c, roofBottom); ctx.stroke(); }

    // Frost overlay during freeze
    if (tempDisplay < 0) { ctx.fillStyle = 'rgba(200,220,255,' + clamp(Math.abs(tempDisplay) / 20 * 0.15, 0, 0.15) + ')'; ctx.fillRect(roofLeft, roofTop, roofRight - roofLeft, roofBottom - roofTop); }
  }

  function drawTarget(t) {
    var lifeRatio = t.life / t.maxLife;
    var scale = lifeRatio > 0.85 ? (1 - lifeRatio) / 0.15 : (lifeRatio < 0.15 ? lifeRatio / 0.15 : 1);
    if (scale <= 0) return;
    ctx.save(); ctx.translate(t.x, t.y); ctx.scale(scale, scale);
    switch (t.type) {
      case 'small':
        ctx.strokeStyle = t.isWet ? '#6EC6E6' : '#4A4540'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-t.size * 0.5, 0); ctx.lineTo(t.size * 0.5, 0); ctx.stroke();
        if (t.isWet) { ctx.fillStyle = 'rgba(100,150,200,0.4)'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill(); }
        break;
      case 'large':
        ctx.strokeStyle = t.isWet ? '#6EC6E6' : '#4A4540'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-t.size, -t.size * 0.2); ctx.lineTo(t.size, t.size * 0.3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-t.size * 0.3, t.size * 0.4); ctx.lineTo(t.size * 0.5, -t.size * 0.5); ctx.stroke();
        if (t.isWet) { ctx.fillStyle = 'rgba(100,150,200,0.4)'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill(); }
        break;
      case 'flashing':
        ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.rect(-t.size * 0.6, -t.size * 0.3, t.size * 1.2, t.size * 0.6); ctx.stroke();
        if (t.isWet) { ctx.fillStyle = 'rgba(100,150,200,0.3)'; ctx.fillRect(-t.size * 0.5, -t.size * 0.2, t.size, t.size * 0.4); }
        ctx.fillStyle = '#F58025'; ctx.beginPath(); ctx.arc(t.size * 0.4, 0, 2, 0, Math.PI * 2); ctx.fill();
        break;
    }
    // Urgency ring
    if (lifeRatio < 0.3) { ctx.strokeStyle = 'rgba(229,57,53,' + (0.5 * lifeRatio / 0.3) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, t.size + 6, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }

  function drawTempDisplay() {
    ctx.save();
    ctx.font = '700 14px -apple-system, sans-serif'; ctx.textAlign = 'right';
    var tempStr = Math.round(tempDisplay) + '\u00B0C';
    var color = tempDisplay < 0 ? '#6EC6E6' : tempDisplay < 5 ? '#B0B0B0' : '#F58025';
    ctx.fillStyle = color;
    ctx.fillText(tempStr, cssW - 20, cssH * 0.12);
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

    // Temperature cycling
    tempCycleTimer += dt;
    var cycleProgress = (tempCycleTimer % CONFIG.tempCycleDuration) / CONFIG.tempCycleDuration;
    var phases = ['mild', 'rain', 'cooling', 'freeze', 'thaw'];
    var phaseIdx = Math.floor(cycleProgress * phases.length);
    tempPhase = phases[Math.min(phaseIdx, phases.length - 1)];

    // Smooth temperature
    var baseTemp = 8;
    if (tempPhase === 'rain') baseTemp = 5; else if (tempPhase === 'cooling') baseTemp = 0; else if (tempPhase === 'freeze') baseTemp = -8; else if (tempPhase === 'thaw') baseTemp = 3;
    if (warningShown && tempPhase === 'freeze') baseTemp = -15;
    tempDisplay += (baseTemp - tempDisplay) * 0.02 * dt / 16;

    // Mark targets as wet during rain
    if (tempPhase === 'rain') { targets.forEach(function (t) { if (t.alive) t.isWet = true; }); }

    if (!warningShown && timeRemaining <= CONFIG.warningTime) {
      warningShown = true; currentSpawnInterval *= CONFIG.warningSpawnMultiplier;
      weatherWarningEl.classList.remove('hide'); weatherWarningEl.classList.add('show'); weatherWarningEl.setAttribute('aria-hidden', 'false');
      warningTimeoutId = setTimeout(function () { weatherWarningEl.classList.remove('show'); weatherWarningEl.classList.add('hide'); weatherWarningEl.setAttribute('aria-hidden', 'true'); }, CONFIG.warningDuration);
    }

    spawnTimer += dt;
    if (spawnTimer >= currentSpawnInterval) { spawnTimer = 0; spawnTarget(); if (warningShown && Math.random() < 0.3) spawnTarget(); }

    for (var i = targets.length - 1; i >= 0; i--) { var t = targets[i]; if (!t.alive) { targets.splice(i, 1); continue; } t.life -= dt; if (t.life <= 0) { onTargetExpired(t); targets.splice(i, 1); } }
    for (var j = labels.length - 1; j >= 0; j--) { labels[j].life -= dt; labels[j].y -= CONFIG.labelRiseSpeed * dt / 1000; if (labels[j].life <= 0) labels.splice(j, 1); }
    for (var k = particles.length - 1; k >= 0; k--) { var p = particles[k]; p.life -= dt; p.vy += 150 * dt / 1000; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; if (p.life <= 0) particles.splice(k, 1); }
    if (shakeTime > 0) { shakeTime -= dt; var intensity = REDUCED_MOTION ? 0 : CONFIG.shakeIntensity * (shakeTime / CONFIG.shakeDuration); shakeOffsetX = rand(-intensity, intensity); shakeOffsetY = rand(-intensity, intensity); } else { shakeOffsetX = 0; shakeOffsetY = 0; }

    scoreEl.textContent = score;
    var healthPct = Math.round(health); healthFill.style.width = healthPct + '%'; healthBar.setAttribute('aria-valuenow', healthPct);
    if (health <= 0) { endGame(false); return; }
    if (timeRemaining <= 0) { endGame(true); return; }
  }

  function render() {
    ctx.save(); ctx.translate(shakeOffsetX, shakeOffsetY);
    ctx.fillStyle = CONFIG.canvasClearColor; ctx.fillRect(-10, -10, cssW + 20, cssH + 20);
    var skyGrad = ctx.createLinearGradient(0, 0, 0, cssH);
    skyGrad.addColorStop(0, '#0A0A0A'); skyGrad.addColorStop(1, '#1A1A16');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, cssW, cssH);
    drawRoof();
    targets.forEach(drawTarget);
    drawParticles(); drawLabels();
    ctx.restore();
    drawTempDisplay();
  }

  function gameLoop(timestamp) { if (state !== 'playing') return; var dt = Math.min(timestamp - lastFrameTime, 50); lastFrameTime = timestamp; if (!visibilityPaused) { update(dt); render(); } rafId = requestAnimationFrame(gameLoop); }

  function startGame() {
    health = CONFIG.startHealth; score = 0; timeRemaining = CONFIG.gameDuration; elapsedSec = 0; spawnTimer = 0; tempCycleTimer = 0; tempDisplay = 8; tempPhase = 'mild';
    currentSpawnInterval = CONFIG.baseSpawnInterval; warningShown = false; visibilityPaused = false;
    targets = []; particles = []; labels = []; shakeTime = 0; shakeOffsetX = 0; shakeOffsetY = 0;
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
    if (survived) { endHeading.textContent = 'YOUR ROOF SURVIVED THE FREEZE'; trackGameEvent('game_completed', { gameName: CONFIG.gameName, score: score, health: healthPct, result: 'survived' }); }
    else { endHeading.textContent = 'FREEZE-THAW DAMAGE BROKE THROUGH'; trackGameEvent('game_failed', { gameName: CONFIG.gameName, score: score, health: 0, result: 'failed' }); }
    hudEl.setAttribute('aria-hidden', 'true'); endScreen.setAttribute('aria-hidden', 'false'); render();
  }

  function restartGame() { trackGameEvent('game_restarted', { gameName: CONFIG.gameName }); shareStatusEl.textContent = ''; endScreen.setAttribute('aria-hidden', 'true'); startGame(); }

  function createScoreCard(scoreVal, integrityVal) {
    var W = 1200, H = 630; var off = document.createElement('canvas'); off.width = W; off.height = H; var c = off.getContext('2d');
    c.fillStyle = '#0A0A0A'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#F58025'; c.lineWidth = 6; c.strokeRect(12, 12, W - 24, H - 24);
    c.strokeStyle = 'rgba(245,128,37,0.25)'; c.lineWidth = 1; c.strokeRect(22, 22, W - 44, H - 44);
    c.fillStyle = '#F58025'; c.font = '700 24px -apple-system,sans-serif'; c.textAlign = 'center'; c.fillText('NANOSEAL NB', W / 2, 75);
    c.fillStyle = '#FFFFFF'; c.font = '800 48px -apple-system,sans-serif'; c.fillText('I SURVIVED THE FREEZE', W / 2, 150);
    c.fillStyle = '#F58025'; c.font = '700 18px -apple-system,sans-serif'; c.textAlign = 'right'; c.fillText('SCORE', W / 2 - 30, 240);
    c.fillStyle = '#FFFFFF'; c.font = '800 64px -apple-system,sans-serif'; c.fillText(String(scoreVal), W / 2 - 30, 300);
    c.fillStyle = '#F58025'; c.font = '700 18px -apple-system,sans-serif'; c.textAlign = 'left'; c.fillText('INTEGRITY', W / 2 + 30, 240);
    c.fillStyle = '#FFFFFF'; c.font = '800 64px -apple-system,sans-serif'; c.fillText(integrityVal + '%', W / 2 + 30, 300);
    c.strokeStyle = '#2A2A2A'; c.lineWidth = 1; c.beginPath(); c.moveTo(W / 2 - 15, 205); c.lineTo(W / 2 - 15, 310); c.stroke(); c.beginPath(); c.moveTo(W / 2 + 15, 205); c.lineTo(W / 2 + 15, 310); c.stroke();
    c.fillStyle = '#B0B0B0'; c.font = '400 26px -apple-system,sans-serif'; c.textAlign = 'center'; c.fillText('Can your roof survive the freeze-thaw cycle?', W / 2, 380);
    c.fillStyle = '#F58025'; c.font = '700 30px -apple-system,sans-serif'; c.fillText(CONFIG.canonicalURL.replace('https://', ''), W / 2, 445);
    c.fillStyle = '#707070'; c.font = '400 20px -apple-system,sans-serif'; c.fillText('Play the 20-second Roof Challenge', W / 2, 510);
    return off;
  }

  var shareInProgress = false;
  function shareScore(scoreVal, integrityVal) {
    if (shareInProgress) return; shareInProgress = true;
    var originalLabel = shareBtn.textContent; shareBtn.disabled = true; shareBtn.textContent = 'PREPARING SCORE...'; shareStatusEl.textContent = '';
    var cardCanvas = createScoreCard(scoreVal, integrityVal);
    cardCanvas.toBlob(function (blob) {
      if (!blob) { shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; shareStatusEl.textContent = 'Could not generate score card. Please try again.'; return; }
      var shareText = 'I scored ' + scoreVal + ' points with ' + integrityVal + '% roof integrity in NanoSeal NB\u2019s Freeze-Thaw Defender. Can you beat my score?\n\n' + CONFIG.canonicalURL;
      var shareTitle = 'Freeze-Thaw Defender | NanoSeal NB'; var sharingMethod = 'clipboard-download';
      var canShareFiles = false;
      try { if (typeof navigator.canShare === 'function') { var testFile = new File([blob], 'nanoseal-freeze-thaw-score.png', { type: 'image/png' }); canShareFiles = navigator.canShare({ files: [testFile] }); } } catch (e) { canShareFiles = false; }
      if (canShareFiles) { sharingMethod = 'native-file'; var shareFile = new File([blob], 'nanoseal-freeze-thaw-score.png', { type: 'image/png' });
        trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: integrityVal, sharingMethod: sharingMethod });
        navigator.share({ title: shareTitle, text: shareText, url: CONFIG.canonicalURL, files: [shareFile] }).then(function () { trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: integrityVal, sharingMethod: sharingMethod, result: 'shared' }); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }).catch(function (err) { if (err && err.name === 'AbortError') shareStatusEl.textContent = ''; else shareStatusEl.textContent = 'Sharing was interrupted. Please try again.'; shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }); return; }
      if (typeof navigator.share === 'function') { sharingMethod = 'native-text';
        trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: integrityVal, sharingMethod: sharingMethod });
        navigator.share({ title: shareTitle, text: shareText, url: CONFIG.canonicalURL }).then(function () { trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: integrityVal, sharingMethod: sharingMethod, result: 'shared' }); downloadBlob(blob); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }).catch(function (err) { if (err && err.name === 'AbortError') shareStatusEl.textContent = ''; else doFallback(blob, shareText, scoreVal, integrityVal, originalLabel); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }); return; }
      doFallback(blob, shareText, scoreVal, integrityVal, originalLabel);
    }, 'image/png');
  }

  function downloadBlob(blob) { var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'nanoseal-freeze-thaw-score.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }
  function doFallback(blob, shareText, scoreVal, integrityVal, originalLabel) {
    var sharingMethod = 'clipboard-download';
    trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: integrityVal, sharingMethod: sharingMethod });
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(shareText).then(function () { downloadBlob(blob); shareStatusEl.textContent = 'Score copied \u2014 share your score card and challenge a friend!'; trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: integrityVal, sharingMethod: sharingMethod, result: 'clipboard-download' }); }).catch(function () { downloadBlob(blob); shareStatusEl.textContent = 'Your score card has been saved. Share it and challenge a friend!'; trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: integrityVal, sharingMethod: sharingMethod, result: 'download-only' }); }).finally(function () { shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; });
    } else { downloadBlob(blob); shareStatusEl.textContent = 'Your score card has been saved. Share it and challenge a friend!'; trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: integrityVal, sharingMethod: sharingMethod, result: 'download-only' }); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }
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