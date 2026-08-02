/* ============================================================
   Ice Dam Escape - NanoSeal NB
   Tap ice, snow and blockages to keep meltwater flowing
   ============================================================ */
(function () {
  'use strict';

  const CONFIG = {
    gameName: 'Ice Dam Escape',
    canonicalURL: 'https://nanosealnb.ca/ice-dam-escape/',
    gameDuration: 20, warningTime: 15, warningDuration: 2500,
    maxHealth: 100, startHealth: 100, maxBackup: 100,
    points: { ice: 10, snow: 15, channel: 25, icicle: 30 },
    baseSpawnInterval: 1000, minSpawnInterval: 320,
    spawnRampFactor: 0.35, warningSpawnMultiplier: 0.5,
    hazardWeights: { ice: 30, snow: 25, channel: 25, icicle: 20 },
    targetLifespan: 3500, warningTargetLifespan: 2200,
    labelLifespan: 1400, labelRiseSpeed: 40,
    shakeDuration: 400, shakeIntensity: 6,
    canvasClearColor: '#0A0A0A',
    gridCols: 4, gridRows: 3,
    backupPerMiss: 8,
    flowDrainPerMiss: 5
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

  let state = 'idle', health = CONFIG.startHealth, backupRisk = 0, score = 0, timeRemaining = CONFIG.gameDuration;
  let lastFrameTime = 0, gameStartTime = 0, elapsedSec = 0, spawnTimer = 0;
  let currentSpawnInterval = CONFIG.baseSpawnInterval;
  let warningShown = false, warningTimeoutId = null, rafId = null, visibilityPaused = false;
  let targets = [], particles = [], labels = [];
  let shakeTime = 0, shakeOffsetX = 0, shakeOffsetY = 0;

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function pickTargetType() {
    var w = CONFIG.hazardWeights; var total = w.ice + w.snow + w.channel + w.icicle;
    var r = Math.random() * total;
    if ((r -= w.ice) < 0) return 'ice';
    if ((r -= w.snow) < 0) return 'snow';
    if ((r -= w.channel) < 0) return 'channel';
    return 'icicle';
  }

  function getGridPositions() {
    var roofTop = cssH * 0.15, roofBottom = cssH * 0.80, roofLeft = cssW * 0.05, roofRight = cssW * 0.95;
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
      size: type === 'icicle' ? rand(16, 26) : type === 'channel' ? rand(20, 28) : type === 'snow' ? rand(18, 24) : rand(14, 22),
      life: lifespan, maxLife: lifespan, alive: true });
  }

  function addLabel(text, x, y, color) { labels.push({ text: text, x: x, y: y, color: color || '#FFFFFF', life: CONFIG.labelLifespan, maxLife: CONFIG.labelLifespan }); }

  function onTargetExpired(target) {
    health = Math.max(0, health - CONFIG.flowDrainPerMiss);
    backupRisk = Math.min(CONFIG.maxBackup, backupRisk + CONFIG.backupPerMiss);
    var labelMap = { ice: 'ICE BUILDUP', snow: 'SNOW BLOCKAGE', channel: 'CHANNEL BLOCKED', icicle: 'ICICLE GROWTH' };
    addLabel(labelMap[target.type] || 'BLOCKAGE', target.x, target.y - 20, '#6EC6E6');
  }

  function onTargetHit(target) {
    target.alive = false;
    score += CONFIG.points[target.type];
    addLabel('CLEARED +' + CONFIG.points[target.type], target.x, target.y - 15, '#F58025');
    var color = target.type === 'ice' || target.type === 'icicle' ? '#A0C8E0' : target.type === 'snow' ? '#E0E0E0' : '#6EC6E6';
    for (var i = 0; i < 8; i++) particles.push({ x: target.x, y: target.y, vx: rand(-70, 70), vy: rand(-70, 20), size: rand(2, 5), life: 600, maxLife: 600, color: color });
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
    var roofTop = cssH * 0.15, roofBottom = cssH * 0.80, roofLeft = cssW * 0.05, roofRight = cssW * 0.95;
    // Snow-covered roof
    ctx.fillStyle = '#D0D0D8'; ctx.fillRect(roofLeft, roofTop, roofRight - roofLeft, roofBottom - roofTop);
    // Shingle hint underneath
    ctx.strokeStyle = 'rgba(58,53,48,0.3)'; ctx.lineWidth = 1;
    var cellW = (roofRight - roofLeft) / CONFIG.gridCols, cellH = (roofBottom - roofTop) / CONFIG.gridRows;
    for (var r = 0; r <= CONFIG.gridRows; r++) { ctx.beginPath(); ctx.moveTo(roofLeft, roofTop + cellH * r); ctx.lineTo(roofRight, roofTop + cellH * r); ctx.stroke(); }
    // Eave (bottom edge - darker, where ice dams form)
    ctx.fillStyle = '#A0A8B0'; ctx.fillRect(roofLeft, roofBottom - 6, roofRight - roofLeft, 6);
    // Water pooling at high backup
    if (backupRisk > 50) {
      ctx.fillStyle = 'rgba(100,150,200,' + (backupRisk / 100 * 0.3) + ')';
      ctx.fillRect(roofLeft, roofTop, roofRight - roofLeft, roofBottom - roofTop);
    }
  }

  function drawTarget(t) {
    var lifeRatio = t.life / t.maxLife;
    var scale = lifeRatio > 0.85 ? (1 - lifeRatio) / 0.15 : (lifeRatio < 0.15 ? lifeRatio / 0.15 : 1);
    if (scale <= 0) return;
    ctx.save(); ctx.translate(t.x, t.y); ctx.scale(scale, scale);
    switch (t.type) {
      case 'ice':
        ctx.fillStyle = '#A0C8E0'; ctx.beginPath(); ctx.ellipse(0, 0, t.size * 0.7, t.size * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.ellipse(-t.size * 0.2, -t.size * 0.1, t.size * 0.2, t.size * 0.1, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'snow':
        ctx.fillStyle = '#E0E0E0'; ctx.beginPath(); ctx.arc(0, 0, t.size * 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#C0C0C8'; ctx.beginPath(); ctx.arc(t.size * 0.2, t.size * 0.1, t.size * 0.3, 0, Math.PI * 2); ctx.fill();
        break;
      case 'channel':
        ctx.strokeStyle = '#888'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-t.size, 0); ctx.lineTo(t.size, 0); ctx.stroke();
        ctx.fillStyle = '#A0C8E0'; ctx.fillRect(-t.size * 0.8, -3, t.size * 1.6, 6);
        ctx.strokeStyle = '#666'; ctx.lineWidth = 1; ctx.strokeRect(-t.size * 0.8, -3, t.size * 1.6, 6);
        break;
      case 'icicle':
        ctx.fillStyle = '#A0C8E0'; ctx.beginPath();
        ctx.moveTo(-t.size * 0.3, -t.size * 0.3); ctx.lineTo(t.size * 0.3, -t.size * 0.3);
        ctx.lineTo(t.size * 0.1, t.size * 0.7); ctx.lineTo(-t.size * 0.1, t.size * 0.7);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath();
        ctx.moveTo(-t.size * 0.1, -t.size * 0.2); ctx.lineTo(0, t.size * 0.5); ctx.lineTo(-t.size * 0.05, t.size * 0.5); ctx.closePath(); ctx.fill();
        break;
    }
    if (lifeRatio < 0.3) { ctx.strokeStyle = 'rgba(229,57,53,' + (0.5 * lifeRatio / 0.3) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, t.size + 6, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }

  function drawBackupMeter() {
    if (backupRisk <= 0) return;
    var meterW = cssW * 0.3, meterH = 6, meterX = cssW * 0.35, meterY = cssH * 0.11;
    ctx.fillStyle = '#2A2A2A'; ctx.fillRect(meterX, meterY, meterW, meterH);
    ctx.fillStyle = backupRisk > 75 ? '#E53935' : backupRisk > 50 ? '#FFB300' : '#F58025';
    ctx.fillRect(meterX, meterY, meterW * (backupRisk / 100), meterH);
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1; ctx.strokeRect(meterX, meterY, meterW, meterH);
    ctx.fillStyle = '#B0B0B0'; ctx.font = '700 9px -apple-system, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('BACKUP RISK ' + Math.round(backupRisk) + '%', meterX + meterW / 2, meterY - 2);
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

    if (!warningShown && timeRemaining <= CONFIG.warningTime) {
      warningShown = true; currentSpawnInterval *= CONFIG.warningSpawnMultiplier;
      weatherWarningEl.classList.remove('hide'); weatherWarningEl.classList.add('show'); weatherWarningEl.setAttribute('aria-hidden', 'false');
      warningTimeoutId = setTimeout(function () { weatherWarningEl.classList.remove('show'); weatherWarningEl.classList.add('hide'); weatherWarningEl.setAttribute('aria-hidden', 'true'); }, CONFIG.warningDuration);
    }

    spawnTimer += dt;
    if (spawnTimer >= currentSpawnInterval) { spawnTimer = 0; spawnTarget(); if (warningShown && Math.random() < 0.35) spawnTarget(); }

    for (var i = targets.length - 1; i >= 0; i--) { var t = targets[i]; if (!t.alive) { targets.splice(i, 1); continue; } t.life -= dt; if (t.life <= 0) { onTargetExpired(t); targets.splice(i, 1); } }
    for (var j = labels.length - 1; j >= 0; j--) { labels[j].life -= dt; labels[j].y -= CONFIG.labelRiseSpeed * dt / 1000; if (labels[j].life <= 0) labels.splice(j, 1); }
    for (var k = particles.length - 1; k >= 0; k--) { var p = particles[k]; p.life -= dt; p.vy += 150 * dt / 1000; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; if (p.life <= 0) particles.splice(k, 1); }
    if (shakeTime > 0) { shakeTime -= dt; var intensity = REDUCED_MOTION ? 0 : CONFIG.shakeIntensity * (shakeTime / CONFIG.shakeDuration); shakeOffsetX = rand(-intensity, intensity); shakeOffsetY = rand(-intensity, intensity); } else { shakeOffsetX = 0; shakeOffsetY = 0; }

    scoreEl.textContent = score;
    var healthPct = Math.round(health); healthFill.style.width = healthPct + '%'; healthBar.setAttribute('aria-valuenow', healthPct);
    if (health <= 0 || backupRisk >= CONFIG.maxBackup) { endGame(false); return; }
    if (timeRemaining <= 0) { endGame(true); return; }
  }

  function render() {
    ctx.save(); ctx.translate(shakeOffsetX, shakeOffsetY);
    ctx.fillStyle = CONFIG.canvasClearColor; ctx.fillRect(-10, -10, cssW + 20, cssH + 20);
    var skyGrad = ctx.createLinearGradient(0, 0, 0, cssH);
    skyGrad.addColorStop(0, '#0A0A0A'); skyGrad.addColorStop(1, '#141A1E');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, cssW, cssH);
    drawRoof();
    targets.forEach(drawTarget);
    drawParticles(); drawLabels();
    ctx.restore();
    drawBackupMeter();
  }

  function gameLoop(timestamp) { if (state !== 'playing') return; var dt = Math.min(timestamp - lastFrameTime, 50); lastFrameTime = timestamp; if (!visibilityPaused) { update(dt); render(); } rafId = requestAnimationFrame(gameLoop); }

  function startGame() {
    health = CONFIG.startHealth; backupRisk = 0; score = 0; timeRemaining = CONFIG.gameDuration; elapsedSec = 0; spawnTimer = 0;
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
    if (survived) { endHeading.textContent = 'YOU KEPT THE MELTWATER MOVING'; trackGameEvent('game_completed', { gameName: CONFIG.gameName, score: score, health: healthPct, result: 'survived' }); }
    else { endHeading.textContent = 'THE ICE DAM BLOCKED THE ROOF EDGE'; trackGameEvent('game_failed', { gameName: CONFIG.gameName, score: score, health: 0, result: 'failed' }); }
    hudEl.setAttribute('aria-hidden', 'true'); endScreen.setAttribute('aria-hidden', 'false'); render();
  }

  function restartGame() { trackGameEvent('game_restarted', { gameName: CONFIG.gameName }); shareStatusEl.textContent = ''; endScreen.setAttribute('aria-hidden', 'true'); startGame(); }

  function createScoreCard(scoreVal, flowVal) {
    var W = 1200, H = 630; var off = document.createElement('canvas'); off.width = W; off.height = H; var c = off.getContext('2d');
    c.fillStyle = '#0A0A0A'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#F58025'; c.lineWidth = 6; c.strokeRect(12, 12, W - 24, H - 24);
    c.strokeStyle = 'rgba(245,128,37,0.25)'; c.lineWidth = 1; c.strokeRect(22, 22, W - 44, H - 44);
    c.fillStyle = '#F58025'; c.font = '700 24px -apple-system,sans-serif'; c.textAlign = 'center'; c.fillText('NANOSEAL NB', W / 2, 75);
    c.fillStyle = '#FFFFFF'; c.font = '800 48px -apple-system,sans-serif'; c.fillText('I KEPT THE MELTWATER MOVING', W / 2, 150);
    c.fillStyle = '#F58025'; c.font = '700 18px -apple-system,sans-serif'; c.textAlign = 'right'; c.fillText('SCORE', W / 2 - 30, 240);
    c.fillStyle = '#FFFFFF'; c.font = '800 64px -apple-system,sans-serif'; c.fillText(String(scoreVal), W / 2 - 30, 300);
    c.fillStyle = '#F58025'; c.font = '700 18px -apple-system,sans-serif'; c.textAlign = 'left'; c.fillText('MELTWATER FLOW', W / 2 + 30, 240);
    c.fillStyle = '#FFFFFF'; c.font = '800 64px -apple-system,sans-serif'; c.fillText(flowVal + '%', W / 2 + 30, 300);
    c.strokeStyle = '#2A2A2A'; c.lineWidth = 1; c.beginPath(); c.moveTo(W / 2 - 15, 205); c.lineTo(W / 2 - 15, 310); c.stroke(); c.beginPath(); c.moveTo(W / 2 + 15, 205); c.lineTo(W / 2 + 15, 310); c.stroke();
    c.fillStyle = '#B0B0B0'; c.font = '400 26px -apple-system,sans-serif'; c.textAlign = 'center'; c.fillText('Can your roof survive the winter?', W / 2, 380);
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
      var shareText = 'I scored ' + scoreVal + ' points with ' + flowVal + '% meltwater flow in NanoSeal NB\u2019s Ice Dam Escape. Can you beat my score?\n\n' + CONFIG.canonicalURL;
      var shareTitle = 'Ice Dam Escape | NanoSeal NB'; var sharingMethod = 'clipboard-download';
      var canShareFiles = false;
      try { if (typeof navigator.canShare === 'function') { var testFile = new File([blob], 'nanoseal-ice-dam-score.png', { type: 'image/png' }); canShareFiles = navigator.canShare({ files: [testFile] }); } } catch (e) { canShareFiles = false; }
      if (canShareFiles) { sharingMethod = 'native-file'; var shareFile = new File([blob], 'nanoseal-ice-dam-score.png', { type: 'image/png' });
        trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod });
        navigator.share({ title: shareTitle, text: shareText, url: CONFIG.canonicalURL, files: [shareFile] }).then(function () { trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod, result: 'shared' }); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }).catch(function (err) { if (err && err.name === 'AbortError') shareStatusEl.textContent = ''; else shareStatusEl.textContent = 'Sharing was interrupted. Please try again.'; shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }); return; }
      if (typeof navigator.share === 'function') { sharingMethod = 'native-text';
        trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod });
        navigator.share({ title: shareTitle, text: shareText, url: CONFIG.canonicalURL }).then(function () { trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod, result: 'shared' }); downloadBlob(blob); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }).catch(function (err) { if (err && err.name === 'AbortError') shareStatusEl.textContent = ''; else doFallback(blob, shareText, scoreVal, flowVal, originalLabel); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }); return; }
      doFallback(blob, shareText, scoreVal, flowVal, originalLabel);
    }, 'image/png');
  }

  function downloadBlob(blob) { var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'nanoseal-ice-dam-score.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }
  function doFallback(blob, shareText, scoreVal, flowVal, originalLabel) {
    var sharingMethod = 'clipboard-download';
    trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod });
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(shareText).then(function () { downloadBlob(blob); shareStatusEl.textContent = 'Score copied \u2014 share your score card and challenge a friend!'; trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod, result: 'clipboard-download' }); }).catch(function () { downloadBlob(blob); shareStatusEl.textContent = 'Your score card has been saved. Share it and challenge a friend!'; trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod, result: 'download-only' }); }).finally(function () { shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; });
    } else { downloadBlob(blob); shareStatusEl.textContent = 'Your score card has been saved. Share it and challenge a friend!'; trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: flowVal, sharingMethod: sharingMethod, result: 'download-only' }); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }
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