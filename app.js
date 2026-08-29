// Tilt Hole — screens, input, rendering, and the game loop.
// Pure logic (physics, hole placement, collisions) lives in game.js.
(function () {
  'use strict';

  var T = window.TiltHole;
  var CONFIG = T.CONFIG;
  var S = window.TiltHoleSounds;

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');

  var screens = {
    start: document.getElementById('screen-start'),
    difficulty: document.getElementById('screen-difficulty'),
    permission: document.getElementById('screen-permission'),
    countdown: document.getElementById('screen-countdown'),
    win: document.getElementById('screen-win'),
    gameover: document.getElementById('screen-gameover')
  };

  var hud = document.getElementById('hud');
  var countdownNumberEl = document.getElementById('countdown-number');
  var muteBtn = document.getElementById('btn-mute');
  var permissionErrorText = document.getElementById('permission-error-text');

  var boardW = 0, boardH = 0, dpr = 1;
  var ball = { x: 0, y: 0 };
  var vel = { x: 0, y: 0 };
  var holes = [];
  var currentDiffKey = 'medium';
  var currentDiff = CONFIG.difficulties.medium;
  var tilt = { x: 0, y: 0 };
  var rafId = null;
  var lastFrameTime = 0;
  var gameActive = false;
  var motionListenerAttached = false;
  var keys = { up: false, down: false, left: false, right: false };

  var isCoarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  var isMobileLike = isCoarsePointer || isTouchDevice;

  // ---------------------------------------------------------------------
  // Screen management
  // ---------------------------------------------------------------------
  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.toggle('hidden', key !== name);
    });
  }

  function hideAllScreens() {
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.add('hidden');
    });
  }

  // ---------------------------------------------------------------------
  // Canvas sizing
  // ---------------------------------------------------------------------
  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    boardW = window.innerWidth;
    boardH = window.innerHeight;
    canvas.width = Math.round(boardW * dpr);
    canvas.height = Math.round(boardH * dpr);
    canvas.style.width = boardW + 'px';
    canvas.style.height = boardH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', function () {
    setTimeout(resizeCanvas, 200);
  });
  resizeCanvas();

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function drawBoard() {
    ctx.fillStyle = '#eef1f6';
    ctx.fillRect(0, 0, boardW, boardH);
    // subtle grid for depth
    ctx.strokeStyle = 'rgba(20,30,50,0.045)';
    ctx.lineWidth = 1;
    var step = 40;
    for (var x = 0; x < boardW; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, boardH); ctx.stroke();
    }
    for (var y = 0; y < boardH; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(boardW, y); ctx.stroke();
    }
  }

  function drawHole(h) {
    var grad = ctx.createRadialGradient(h.x, h.y, h.r * 0.15, h.x, h.y, h.r);
    if (h.type === 'target') {
      grad.addColorStop(0, '#0a3d24');
      grad.addColorStop(1, '#123');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#3ddc84';
      ctx.shadowColor = 'rgba(61,220,132,0.85)';
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      grad.addColorStop(0, '#111318');
      grad.addColorStop(1, '#000');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#c0392b';
      ctx.stroke();
    }
  }

  function drawBall() {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ball.x, ball.y + CONFIG.ball.radius * 0.55, CONFIG.ball.radius * 0.9, CONFIG.ball.radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();
    ctx.restore();

    var grad = ctx.createRadialGradient(
      ball.x - CONFIG.ball.radius * 0.35, ball.y - CONFIG.ball.radius * 0.35, CONFIG.ball.radius * 0.1,
      ball.x, ball.y, CONFIG.ball.radius
    );
    grad.addColorStop(0, '#5a6270');
    grad.addColorStop(1, '#20232b');
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, CONFIG.ball.radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  function render() {
    drawBoard();
    for (var i = 0; i < holes.length; i++) drawHole(holes[i]);
    drawBall();
  }

  // ---------------------------------------------------------------------
  // Input: device tilt + keyboard fallback
  // ---------------------------------------------------------------------
  function onDeviceMotion(e) {
    var g = e.accelerationIncludingGravity;
    if (!g || (g.x == null && g.y == null)) return;
    // accelerationIncludingGravity points opposite to the direction the
    // device is tilted toward (it's the reaction force), so the ball
    // rolls with the tilt when we use these signs directly.
    tilt.x = (g.x || 0);
    tilt.y = -(g.y || 0);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowUp' || e.key === 'w') keys.up = true;
    if (e.key === 'ArrowDown' || e.key === 's') keys.down = true;
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd') keys.right = true;
  }
  function onKeyUp(e) {
    if (e.key === 'ArrowUp' || e.key === 'w') keys.up = false;
    if (e.key === 'ArrowDown' || e.key === 's') keys.down = false;
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd') keys.right = false;
  }

  function attachInputListeners() {
    if (!motionListenerAttached) {
      window.addEventListener('devicemotion', onDeviceMotion);
      motionListenerAttached = true;
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  }

  function detachInputListeners() {
    if (motionListenerAttached) {
      window.removeEventListener('devicemotion', onDeviceMotion);
      motionListenerAttached = false;
    }
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    keys.up = keys.down = keys.left = keys.right = false;
  }

  function effectiveTilt() {
    var kx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var ky = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (kx || ky) {
      // Give keyboard testing a comfortable, deadzone-clearing magnitude.
      return { x: kx * 4, y: ky * 4 };
    }
    return tilt;
  }

  // ---------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------
  function startRound(diffKey) {
    currentDiffKey = diffKey;
    currentDiff = CONFIG.difficulties[diffKey];
    resizeCanvas();
    ball.x = boardW / 2;
    ball.y = boardH / 2;
    vel.x = 0; vel.y = 0;
    tilt.x = 0; tilt.y = 0;
    holes = T.generateHoles(boardW, boardH, currentDiff, ball, CONFIG.ball.radius);
    document.getElementById('hud-difficulty').textContent = currentDiff.label;
    hideAllScreens();
    hud.classList.remove('hidden');
    gameActive = true;
    attachInputListeners();
    lastFrameTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function endRound(won) {
    gameActive = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    detachInputListeners();
    hud.classList.add('hidden');
    if (won) {
      S.playWinJingle();
      showScreen('win');
    } else {
      S.playLoseSound();
      showScreen('gameover');
    }
  }

  function loop(now) {
    if (!gameActive) return;
    var dt = Math.min(0.05, (now - lastFrameTime) / 1000); // clamp to avoid huge jumps on tab-out
    lastFrameTime = now;

    var t = effectiveTilt();
    T.stepPhysics(ball, vel, t.x, t.y, dt, currentDiff, CONFIG.ball);
    T.resolveWallCollision(ball, vel, boardW, boardH, CONFIG.ball.radius, CONFIG.wallBounce);

    var fallenHole = T.checkHoleCollision(ball, holes, CONFIG.ball.radius);
    if (fallenHole) {
      render();
      endRound(fallenHole.type === 'target');
      return;
    }

    render();
    rafId = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------
  // Countdown
  // ---------------------------------------------------------------------
  function runCountdown(diffKey) {
    showScreen('countdown');
    var steps = CONFIG.countdown.steps;
    var i = 0;
    function tick() {
      if (i >= steps.length) {
        startRound(diffKey);
        return;
      }
      countdownNumberEl.textContent = steps[i];
      countdownNumberEl.classList.remove('pulse');
      // Force reflow so the pulse animation restarts each tick.
      void countdownNumberEl.offsetWidth;
      countdownNumberEl.classList.add('pulse');
      i++;
      setTimeout(tick, CONFIG.countdown.stepMs);
    }
    tick();
  }

  // ---------------------------------------------------------------------
  // Motion permission flow
  // ---------------------------------------------------------------------
  function requestMotionPermissionThenPlay(diffKey) {
    S.stopBackgroundMusic();
    var DME = window.DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === 'function') {
      DME.requestPermission().then(function (state) {
        if (state === 'granted') {
          runCountdown(diffKey);
        } else {
          showPermissionError('Motion access was not granted. Tilt Hole needs it to read your phone’s tilt.');
        }
      }).catch(function () {
        showPermissionError('Couldn’t request motion access. Check your browser’s motion & orientation permission setting and try again.');
      });
    } else {
      // Non-iOS / no permission gate needed — devicemotion just works
      // (and if the device has no sensors at all, arrow keys still do).
      runCountdown(diffKey);
    }
  }

  var pendingDiffKey = 'medium';
  function showPermissionError(message) {
    permissionErrorText.textContent = message;
    showScreen('permission');
  }

  // ---------------------------------------------------------------------
  // UI wiring
  // ---------------------------------------------------------------------
  var musicStarted = false;
  function ensureMusicPlaying() {
    S.unlock();
    if (!musicStarted) {
      musicStarted = true;
    }
    S.playBackgroundMusic();
  }

  document.getElementById('btn-start').addEventListener('click', function () {
    ensureMusicPlaying();
    showScreen('difficulty');
  });

  var diffButtons = document.querySelectorAll('#screen-difficulty [data-diff]');
  diffButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var diffKey = btn.getAttribute('data-diff');
      pendingDiffKey = diffKey;
      // This click is the user gesture — request motion permission
      // synchronously within it (required on iOS Safari).
      requestMotionPermissionThenPlay(diffKey);
    });
  });

  document.getElementById('btn-retry-permission').addEventListener('click', function () {
    requestMotionPermissionThenPlay(pendingDiffKey);
  });

  function backToDifficulty() {
    showScreen('difficulty');
    ensureMusicPlaying();
  }
  document.getElementById('btn-restart-win').addEventListener('click', backToDifficulty);
  document.getElementById('btn-restart-lose').addEventListener('click', backToDifficulty);

  muteBtn.addEventListener('click', function () {
    S.unlock();
    var muted = S.toggleMute();
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  });

  // Desktop / no-sensor hint.
  if (!isMobileLike || !('DeviceOrientationEvent' in window)) {
    document.getElementById('desktop-note').classList.remove('hidden');
  }

  // Attempt a graceful portrait lock; ignore failures (unsupported,
  // not fullscreen, desktop, etc.) — CSS handles the landscape warning.
  document.getElementById('btn-start').addEventListener('click', function () {
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('portrait').catch(function () {});
      }
    } catch (e) { /* ignore */ }
  });

  showScreen('start');
})();
