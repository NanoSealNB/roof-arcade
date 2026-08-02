/* ============================================================
   Moss Attack - NanoSeal NB
   Whack-a-mole style organic growth game on asphalt shingles
   ============================================================ */
(function () {
  'use strict';

  const CONFIG = {
    gameName: 'Moss Attack',
    canonicalURL: 'https://nanosealnb.ca/moss-attack/',
    gameDuration: 20,
    warningTime: 15,
    warningDuration: 2500,
    maxCoverage: 100,
    startCoverage: 0,
    contaminationPerMiss: { algae: 3, streak: 5, moss: 7, lichen: 10 },
    points: { algae: 10, streak: 15, moss: 20, lichen: 30 },
    baseSpawnInterval: 1100,
    minSpawnInterval: 350,
    spawnRampFactor: 0.35,
    warningSpawnMultiplier: 0.6,
    targetLifespan: 2200,
    warningTargetLifespan: 1600,
    targetLifespanRamp: 30,
    hazardWeights: { algae: 30, streak: 25, moss: 25, lichen: 20 },
    labelLifespan: 1400,
    labelRiseSpeed: 40,
    canvasClearColor: '#0A0A0A',
    gridCols: 4,
    gridRows: 3
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

  let state = 'idle', coverage = 0, score = 0, timeRemaining = CONFIG.gameDuration;
  let lastFrameTime = 0, gameStartTime = 0, elapsedSec = 0, spawnTimer = 0;
  let currentSpawnInterval = CONFIG.baseSpawnInterval;
  let warningShown = false, warningTimeoutId = null, rafId = null, visibilityPaused = false;
  let targets = [], particles = [], labels = [];
  let permanentStains = [];

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function pickTargetType() {
    const w = CONFIG.hazardWeights;
    const total = w.algae + w.streak + w.moss + w.lichen;
    let r = Math.random() * total;
    if ((r -= w.algae) < 0) return 'algae';
    if ((r -= w.streak) < 0) return 'streak';
    if ((r -= w.moss) < 0) return 'moss';
    return 'lichen';
  }

  function getGridPositions() {
    const roofTop = cssH * 0.15, roofBottom = cssH * 0.85;
    const roofLeft = cssW * 0.05, roofRight = cssW * 0.95;
    const cols = CONFIG.gridCols, rows = CONFIG.gridRows;
    const cellW = (roofRight - roofLeft) / cols, cellH = (roofBottom - roofTop) / rows;
    const positions = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      positions.push({ x: roofLeft + cellW * (c + 0.5), y: roofTop + cellH * (r + 0.5), row: r, col: c });
    }
    return positions;
  }

  function spawnTarget() {
    var positions = getGridPositions();
    var occupied = targets.map(function (t) { return t.row + ',' + t.col; });
    var available = positions.filter(function (p) { return occupied.indexOf(p.row + ',' + p.col) < 0; });
    if (available.length === 0) return;
    var pos = available[randInt(0, available.length - 1)];
    var type = pickTargetType();
    var lifespan = Math.max(800, (CONFIG.targetLifespan - elapsedSec * CONFIG.targetLifespanRamp) * (warningShown ? 0.75 : 1));
    targets.push({ type: type, x: pos.x, y: pos.y, row: pos.row, col: pos.col, size: type === 'lichen' ? rand(22, 30) : type === 'moss' ? rand(18, 26) : rand(14, 22), life: lifespan, maxLife: lifespan, alive: true, growPhase: 0 });
  }

  function addLabel(text, x, y, color) { labels.push({ text: text, x: x, y: y, color: color || '#FFFFFF', life: CONFIG.labelLifespan, maxLife: CONFIG.labelLifespan }); }

  function onTargetExpired(target) {
    var contam = CONFIG.contaminationPerMiss[target.type];
    coverage = Math.min(CONFIG.maxCoverage, coverage + contam);
    permanentStains.push({ x: target.x, y: target.y, type: target.type, size: target.size * 0.7, alpha: 0.15 });
    var labels = { algae: 'ALGAE SPREAD', streak: 'BLACK STREAK', moss: 'MOSS SPREAD', lichen: 'LICHEN SPREAD' };
    addLabel(labels[target.type] || 'GROWTH', target.x, target.y - 20, '#6B8E23');
  }

  function onTargetHit(target) {
    target.alive = false;
    score += CONFIG.points[target.type];
    var color = getTargetColor(target.type);
    for (var i = 0; i < 8; i++) particles.push({ x: target.x, y: target.y, vx: rand(-70, 70), vy: rand(-70, 20), size: rand(2, 5), life: 600, maxLife: 600, color: color });
  }

  function getTargetColor(type) {
    switch (type) { case 'algae': return '#2E5A2E'; case 'streak': return '#1A1A1A'; case 'moss': return '#4A7C3A'; case 'lichen': return '#8B8B6E'; default: return '#FFFFFF'; }
  }

  function handlePointer(clientX, clientY) {
    if (state !== 'playing') return;
    var rect = canvas.getBoundingClientRect(); var px = clientX - rect.left, py = clientY - rect.top;
    for (var i = targets.length - 1; i >= 0; i--) {
      var t = targets[i]; if (!t.alive) continue;
      var dx = px - t.x, dy = py - t.y; var hitRadius = t.size + 14;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) { onTargetHit(t); return; }
    }
  }

  canvas.addEventListener('mousedown', function (e) { e.preventDefault(); handlePointer(e.clientX, e.clientY); });
  canvas.addEventListener('touchstart', function (e) { e.preventDefault(); if (e.touches.length > 0) handlePointer(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function drawRoof() {
    var roofTop = cssH * 0.15, roofBottom = cssH * 0.85, roofLeft = cssW * 0.05, roofRight = cssW * 0.95;
    ctx.fillStyle = '#3A3530'; ctx.fillRect(roofLeft, roofTop, roofRight - roofLeft, roofBottom - roofTop);

    // Shingle grid
    var cols = CONFIG.gridCols, rows = CONFIG.gridRows;
    var cellW = (roofRight - roofLeft) / cols, cellH = (roofBottom - roofTop) / rows;
    ctx.strokeStyle = '#2E2A25'; ctx.lineWidth = 1;
    for (var r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(roofLeft, roofTop + cellH * r); ctx.lineTo(roofRight, roofTop + cellH * r); ctx.stroke(); }
    for (var c = 0; c <= cols; c++) { ctx.beginPath(); ctx.moveTo(roofLeft + cellW * c, roofTop); ctx.lineTo(roofLeft + cellW * c, roofBottom); ctx.stroke(); }

    // Permanent stains
    permanentStains.forEach(function (s) {
      var col = getTargetColor(s.type);
      ctx.fillStyle = col; ctx.globalAlpha = s.alpha;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, s.size * 0.5, s.size * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Damp shading at high coverage
    if (coverage > 40) {
      ctx.fillStyle = 'rgba(40,50,40,' + (coverage / 100 * 0.25) + ')';
      ctx.fillRect(roofLeft, roofTop, roofRight - roofLeft, roofBottom - roofTop);
    }
  }

  function drawTarget(t) {
    var lifeRatio = t.life / t.maxLife;
    var scale = lifeRatio > 0.85 ? (1 - lifeRatio) / 0.15 : (lifeRatio < 0.15 ? lifeRatio / 0.15 : 1);
    if (scale <= 0) return;
    ctx.save(); ctx.translate(t.x, t.y); ctx.scale(scale, scale);
    switch (t.type) {
      case 'algae':
        ctx.fillStyle = '#2E5A2E'; ctx.beginPath(); ctx.arc(0, 0, t.size, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3A6B3A'; for (var i = 0; i < 5; i++) { var a = (i / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(a) * t.size * 0.3, Math.sin(a) * t.size * 0.3, t.size * 0.25, 0, Math.PI * 2); ctx.fill(); }
        break;
      case 'streak':
        ctx.fillStyle = '#1A1A1A'; ctx.beginPath(); ctx.ellipse(0, 0, t.size * 0.4, t.size, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(50,50,50,0.6)'; ctx.beginPath(); ctx.ellipse(0, t.size * 0.3, t.size * 0.3, t.size * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'moss':
        ctx.fillStyle = '#4A7C3A'; ctx.beginPath(); ctx.arc(0, 0, t.size, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5B8E4A'; for (var j = 0; j < 6; j++) { var ang = (j / 6) * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(ang) * t.size * 0.5, Math.sin(ang) * t.size * 0.5, t.size * 0.2, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#3A6B2A'; ctx.beginPath(); ctx.arc(0, 0, t.size * 0.3, 0, Math.PI * 2); ctx.fill();
        break;
      case 'lichen':
        ctx.fillStyle = '#8B8B6E'; ctx.beginPath(); ctx.arc(0, 0, t.size, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9E9E80'; ctx.beginPath(); ctx.arc(-t.size * 0.3, -t.size * 0.2, t.size * 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#7A7A60'; ctx.beginPath(); ctx.arc(t.size * 0.3, t.size * 0.2, t.size * 0.3, 0, Math.PI * 2); ctx.fill();
        break;
    }
    // Pulse ring for urgency
    if (lifeRatio < 0.3) {
      ctx.strokeStyle = 'rgba(229,57,53,' + (0.5 * lifeRatio / 0.3) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, t.size + 6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach(function (p) { var alpha = clamp(p.life / p.maxLife, 0, 1); ctx.fillStyle = p.color; ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); });
    ctx.globalAlpha = 1;
  }

  function drawLabels() {
    labels.forEach(function (l) { var t = l.life / l.maxLife; var alpha = t > 0.7 ? 1 : t / 0.7; ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = l.color; ctx.font = '700 13px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(l.text, l.x, l.y); ctx.restore(); });
  }

  function update(dt) {
    if (state !== 'playing' || visibilityPaused) return;
    elapsedSec = (performance.now() - gameStartTime) / 1000;
    timeRemaining = Math.max(0, CONFIG.gameDuration - elapsedSec);
    timerEl.textContent = Math.ceil(timeRemaining);

    var progress = elapsedSec / CONFIG.gameDuration;
    currentSpawnInterval = Math.max(CONFIG.minSpawnInterval, CONFIG.baseSpawnInterval - (CONFIG.baseSpawnInterval - CONFIG.minSpawnInterval) * progress * CONFIG.spawnRampFactor * 10);

    if (!warningShown && timeRemaining <= CONFIG.warningTime) {
      warningShown = true;
      currentSpawnInterval *= CONFIG.warningSpawnMultiplier;
      weatherWarningEl.classList.remove('hide'); weatherWarningEl.classList.add('show'); weatherWarningEl.setAttribute('aria-hidden', 'false');
      warningTimeoutId = setTimeout(function () { weatherWarningEl.classList.remove('show'); weatherWarningEl.classList.add('hide'); weatherWarningEl.setAttribute('aria-hidden', 'true'); }, CONFIG.warningDuration);
    }

    spawnTimer += dt;
    if (spawnTimer >= currentSpawnInterval) { spawnTimer = 0; spawnTarget(); if (warningShown && Math.random() < 0.35) spawnTarget(); }

    for (var i = targets.length - 1; i >= 0; i--) {
      var t = targets[i];
      if (!t.alive) { targets.splice(i, 1); continue; }
      t.life -= dt;
      if (t.life <= 0) { onTargetExpired(t); targets.splice(i, 1); }
    }

    for (var j = labels.length - 1; j >= 0; j--) { labels[j].life -= dt; labels[j].y -= CONFIG.labelRiseSpeed * dt / 1000; if (labels[j].life <= 0) labels.splice(j, 1); }
    for (var k = particles.length - 1; k >= 0; k--) { var p = particles[k]; p.life -= dt; p.vy += 150 * dt / 1000; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; if (p.life <= 0) particles.splice(k, 1); }

    scoreEl.textContent = score;
    var covPct = Math.round(coverage); healthFill.style.width = covPct + '%'; healthBar.setAttribute('aria-valuenow', covPct);

    if (coverage >= CONFIG.maxCoverage) { endGame(false); return; }
    if (timeRemaining <= 0) { endGame(true); return; }
  }

  function render() {
    ctx.fillStyle = CONFIG.canvasClearColor; ctx.fillRect(0, 0, cssW, cssH);
    var skyGrad = ctx.createLinearGradient(0, 0, 0, cssH);
    skyGrad.addColorStop(0, '#0A0A0A'); skyGrad.addColorStop(1, '#1A1A16');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, cssW, cssH);
    drawRoof();
    targets.forEach(drawTarget);
    drawParticles();
    drawLabels();
  }

  function gameLoop(timestamp) {
    if (state !== 'playing') return;
    var dt = Math.min(timestamp - lastFrameTime, 50); lastFrameTime = timestamp;
    if (!visibilityPaused) { update(dt); render(); }
    rafId = requestAnimationFrame(gameLoop);
  }

  function startGame() {
    coverage = 0; score = 0; timeRemaining = CONFIG.gameDuration; elapsedSec = 0; spawnTimer = 0;
    currentSpawnInterval = CONFIG.baseSpawnInterval; warningShown = false; visibilityPaused = false;
    targets = []; particles = []; labels = []; permanentStains = [];
    if (warningTimeoutId) { clearTimeout(warningTimeoutId); warningTimeoutId = null; }
    weatherWarningEl.classList.remove('show', 'hide'); weatherWarningEl.setAttribute('aria-hidden', 'true');
    scoreEl.textContent = '0'; timerEl.textContent = CONFIG.gameDuration; healthFill.style.width = '0%'; healthBar.setAttribute('aria-valuenow', 0);
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
    var covPct = Math.round(coverage);
    finalScoreEl.textContent = score; finalHealthEl.textContent = covPct;
    if (survived) { endHeading.textContent = 'YOU HELD BACK THE GROWTH'; trackGameEvent('game_completed', { gameName: CONFIG.gameName, score: score, health: 100 - covPct, result: 'survived' }); }
    else { endHeading.textContent = 'THE MOSS TOOK OVER'; trackGameEvent('game_failed', { gameName: CONFIG.gameName, score: score, health: 0, result: 'failed' }); }
    hudEl.setAttribute('aria-hidden', 'true'); endScreen.setAttribute('aria-hidden', 'false'); render();
  }

  function restartGame() { trackGameEvent('game_restarted', { gameName: CONFIG.gameName }); shareStatusEl.textContent = ''; endScreen.setAttribute('aria-hidden', 'true'); startGame(); }

  function createScoreCard(scoreVal, coverageVal) {
    var W = 1200, H = 630; var off = document.createElement('canvas'); off.width = W; off.height = H; var c = off.getContext('2d');
    c.fillStyle = '#0A0A0A'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#F58025'; c.lineWidth = 6; c.strokeRect(12, 12, W - 24, H - 24);
    c.strokeStyle = 'rgba(245,128,37,0.25)'; c.lineWidth = 1; c.strokeRect(22, 22, W - 44, H - 44);
    c.fillStyle = '#F58025'; c.font = '700 24px -apple-system,sans-serif'; c.textAlign = 'center'; c.fillText('NANOSEAL NB', W / 2, 75);
    c.fillStyle = '#FFFFFF'; c.font = '800 48px -apple-system,sans-serif'; c.fillText('I HELD BACK THE GROWTH', W / 2, 150);
    c.fillStyle = '#F58025'; c.font = '700 18px -apple-system,sans-serif'; c.textAlign = 'right'; c.fillText('SCORE', W / 2 - 30, 240);
    c.fillStyle = '#FFFFFF'; c.font = '800 64px -apple-system,sans-serif'; c.fillText(String(scoreVal), W / 2 - 30, 300);
    c.fillStyle = '#F58025'; c.font = '700 18px -apple-system,sans-serif'; c.textAlign = 'left'; c.fillText('COVERAGE', W / 2 + 30, 240);
    c.fillStyle = '#FFFFFF'; c.font = '800 64px -apple-system,sans-serif'; c.fillText(coverageVal + '%', W / 2 + 30, 300);
    c.strokeStyle = '#2A2A2A'; c.lineWidth = 1; c.beginPath(); c.moveTo(W / 2 - 15, 205); c.lineTo(W / 2 - 15, 310); c.stroke(); c.beginPath(); c.moveTo(W / 2 + 15, 205); c.lineTo(W / 2 + 15, 310); c.stroke();
    c.fillStyle = '#B0B0B0'; c.font = '400 26px -apple-system,sans-serif'; c.textAlign = 'center'; c.fillText('Can you stop the roof invasion?', W / 2, 380);
    c.fillStyle = '#F58025'; c.font = '700 30px -apple-system,sans-serif'; c.fillText(CONFIG.canonicalURL.replace('https://', ''), W / 2, 445);
    c.fillStyle = '#707070'; c.font = '400 20px -apple-system,sans-serif'; c.fillText('Play the 20-second Roof Challenge', W / 2, 510);
    return off;
  }

  var shareInProgress = false;
  function shareScore(scoreVal, coverageVal) {
    if (shareInProgress) return; shareInProgress = true;
    var originalLabel = shareBtn.textContent; shareBtn.disabled = true; shareBtn.textContent = 'PREPARING SCORE...'; shareStatusEl.textContent = '';
    var cardCanvas = createScoreCard(scoreVal, coverageVal);
    cardCanvas.toBlob(function (blob) {
      if (!blob) { shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; shareStatusEl.textContent = 'Could not generate score card. Please try again.'; return; }
      var shareText = 'I scored ' + scoreVal + ' points holding back ' + coverageVal + '% roof coverage in NanoSeal NB\u2019s Moss Attack. Can you beat my score?\n\n' + CONFIG.canonicalURL;
      var shareTitle = 'Moss Attack | NanoSeal NB'; var sharingMethod = 'clipboard-download';
      var canShareFiles = false;
      try { if (typeof navigator.canShare === 'function') { var testFile = new File([blob], 'nanoseal-moss-attack-score.png', { type: 'image/png' }); canShareFiles = navigator.canShare({ files: [testFile] }); } } catch (e) { canShareFiles = false; }
      if (canShareFiles) { sharingMethod = 'native-file'; var shareFile = new File([blob], 'nanoseal-moss-attack-score.png', { type: 'image/png' });
        trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: 100 - coverageVal, sharingMethod: sharingMethod });
        navigator.share({ title: shareTitle, text: shareText, url: CONFIG.canonicalURL, files: [shareFile] }).then(function () { trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: 100 - coverageVal, sharingMethod: sharingMethod, result: 'shared' }); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }).catch(function (err) { if (err && err.name === 'AbortError') shareStatusEl.textContent = ''; else shareStatusEl.textContent = 'Sharing was interrupted. Please try again.'; shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }); return; }
      if (typeof navigator.share === 'function') { sharingMethod = 'native-text';
        trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: 100 - coverageVal, sharingMethod: sharingMethod });
        navigator.share({ title: shareTitle, text: shareText, url: CONFIG.canonicalURL }).then(function () { trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: 100 - coverageVal, sharingMethod: sharingMethod, result: 'shared' }); downloadBlob(blob); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }).catch(function (err) { if (err && err.name === 'AbortError') shareStatusEl.textContent = ''; else doFallback(blob, shareText, scoreVal, coverageVal, originalLabel); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }); return; }
      doFallback(blob, shareText, scoreVal, coverageVal, originalLabel);
    }, 'image/png');
  }

  function downloadBlob(blob) { var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'nanoseal-moss-attack-score.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }

  function doFallback(blob, shareText, scoreVal, coverageVal, originalLabel) {
    var sharingMethod = 'clipboard-download';
    trackGameEvent('share_clicked', { gameName: CONFIG.gameName, score: scoreVal, health: 100 - coverageVal, sharingMethod: sharingMethod });
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(shareText).then(function () { downloadBlob(blob); shareStatusEl.textContent = 'Score copied \u2014 share your score card and challenge a friend!'; trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: 100 - coverageVal, sharingMethod: sharingMethod, result: 'clipboard-download' }); }).catch(function () { downloadBlob(blob); shareStatusEl.textContent = 'Your score card has been saved. Share it and challenge a friend!'; trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: 100 - coverageVal, sharingMethod: sharingMethod, result: 'download-only' }); }).finally(function () { shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; });
    } else { downloadBlob(blob); shareStatusEl.textContent = 'Your score card has been saved. Share it and challenge a friend!'; trackGameEvent('share_completed', { gameName: CONFIG.gameName, score: scoreVal, health: 100 - coverageVal, sharingMethod: sharingMethod, result: 'download-only' }); shareInProgress = false; shareBtn.disabled = false; shareBtn.textContent = originalLabel; }
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