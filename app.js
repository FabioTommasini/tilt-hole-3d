// Tilt Hole — screens, input, rendering, and the game loop.
// Pure logic (physics, hole placement, collisions) lives in game.js.
// Rendering is Three.js (WebGL): a tilted top-down camera looking at a
// flat board, with the ball and holes as real 3D geometry so the scene
// reads with depth instead of flat 2D shapes.
(function () {
  'use strict';

  var T = window.TiltHole;
  var CONFIG = T.CONFIG;
  var S = window.TiltHoleSounds;

  var canvas = document.getElementById('board');

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
  // 3D scene setup
  //
  // Board-space pixel coordinates (ball.x/y, hole.x/y — same values the
  // physics in game.js works in) map straight onto Three.js world units,
  // with the board centered on the origin: world X = px.x - boardW/2,
  // world Z = px.y - boardH/2. The board lies flat in the XZ plane; Y is
  // up. The camera sits above the board's center, tilted back slightly
  // off vertical, so straight-down top-down play keeps a visible sense
  // of depth.
  // ---------------------------------------------------------------------
  var CAMERA_TILT = 26 * Math.PI / 180; // radians off straight-down
  var CAMERA_FOV = 42; // degrees, vertical

  function px2x(px) { return px - boardW / 2; }
  function px2z(py) { return py - boardH / 2; }

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color('#eef1f6');
  scene.fog = new THREE.Fog('#eef1f6', 500, 2000);

  var camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 1, 6000);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));

  var sunLight = new THREE.DirectionalLight(0xffffff, 0.85);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.bias = -0.0015;
  scene.add(sunLight);
  scene.add(sunLight.target);

  var boardMaterial = new THREE.MeshStandardMaterial({ color: '#eef1f6', roughness: 0.95 });
  var boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), boardMaterial);
  boardMesh.rotation.x = -Math.PI / 2;
  boardMesh.receiveShadow = true;
  scene.add(boardMesh);

  var gridMesh = null; // rebuilt to match board size on resize

  function buildGrid(w, h, step) {
    if (gridMesh) {
      scene.remove(gridMesh);
      gridMesh.geometry.dispose();
      gridMesh.material.dispose();
    }
    var halfW = w / 2, halfH = h / 2, points = [], x, z;
    for (x = -halfW; x <= halfW + 0.01; x += step) points.push(x, 0.15, -halfH, x, 0.15, halfH);
    for (z = -halfH; z <= halfH + 0.01; z += step) points.push(-halfW, 0.15, z, halfW, 0.15, z);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    var mat = new THREE.LineBasicMaterial({ color: 0x141e32, transparent: true, opacity: 0.06 });
    gridMesh = new THREE.LineSegments(geo, mat);
    scene.add(gridMesh);
  }

  var ballRadius = CONFIG.ball.radius;
  var ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(ballRadius, 24, 16),
    new THREE.MeshStandardMaterial({ color: '#3a3f4a', roughness: 0.4, metalness: 0.35 })
  );
  ballMesh.castShadow = true;
  scene.add(ballMesh);

  var holesGroup = new THREE.Group();
  scene.add(holesGroup);

  function disposeMesh(obj) {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(function (m) { m.dispose(); });
      else obj.material.dispose();
    }
  }

  function buildHoles(holeList) {
    while (holesGroup.children.length) {
      disposeMesh(holesGroup.children.pop());
    }
    holeList.forEach(function (h) {
      var x = px2x(h.x), z = px2z(h.y);
      var isTarget = h.type === 'target';
      var depth = 16;

      var pit = new THREE.Mesh(
        new THREE.CylinderGeometry(h.r, h.r * 0.88, depth, 28),
        new THREE.MeshStandardMaterial({ color: isTarget ? '#0a3d24' : '#111318', roughness: 0.9 })
      );
      pit.position.set(x, -depth / 2 + 0.5, z);
      pit.receiveShadow = true;
      holesGroup.add(pit);

      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(h.r * 0.94, Math.max(1.6, h.r * 0.09), 8, 40),
        new THREE.MeshStandardMaterial({
          color: isTarget ? '#3ddc84' : '#c0392b',
          emissive: isTarget ? '#3ddc84' : '#000000',
          emissiveIntensity: isTarget ? 1.1 : 0,
          roughness: 0.5
        })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 0.6, z);
      holesGroup.add(ring);

      if (isTarget) {
        var glow = new THREE.PointLight('#3ddc84', 1.1, h.r * 9, 2);
        glow.position.set(x, h.r * 1.6, z);
        holesGroup.add(glow);
      }
    });
  }

  // Frames the whole board inside the camera FOV regardless of aspect
  // ratio or tilt angle: projects the board's (padded) corners through
  // the camera and rescales distance from the actual overshoot, which
  // converges in a couple of iterations to a snug fit. A closed-form
  // formula would need to account for the near-edge magnification the
  // tilt introduces; this sidesteps that by just measuring it directly.
  var fitCorners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  var NDC_LIMIT = 0.92;

  function fitCamera() {
    camera.aspect = boardW / boardH;

    var pad = ballRadius * 3;
    var hw = boardW / 2 + pad, hh = boardH / 2 + pad;
    fitCorners[0].set(-hw, 0, -hh);
    fitCorners[1].set(hw, 0, -hh);
    fitCorners[2].set(-hw, 0, hh);
    fitCorners[3].set(hw, 0, hh);

    // A camera tilted back off vertical and aimed at the board's exact
    // center projects the near (bottom) edge larger than the far (top)
    // edge, so fitting the worst-case corner alone leaves the top of the
    // frame under-filled. Aiming slightly past center (toward the far
    // edge) balances the two and uses the frame far more evenly.
    var lookZ = -hh * 0.22;
    var distance = Math.max(hw, hh) * 3;
    for (var iter = 0; iter < 6; iter++) {
      camera.position.set(0, distance * Math.cos(CAMERA_TILT), distance * Math.sin(CAMERA_TILT) + lookZ);
      camera.lookAt(0, 0, lookZ);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);

      var maxAbs = 0;
      for (var i = 0; i < fitCorners.length; i++) {
        var p = fitCorners[i].clone().project(camera);
        maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y));
      }
      if (Math.abs(maxAbs - NDC_LIMIT) < 0.005) break;
      distance *= maxAbs / NDC_LIMIT;
    }

    sunLight.position.set(distance * 0.25, distance * 0.9, distance * 0.4);
    sunLight.target.position.set(0, 0, 0);
    sunLight.target.updateMatrixWorld();
    var shadowSpan = 0.5 * Math.hypot(boardW, boardH) + pad;
    sunLight.shadow.camera.left = -shadowSpan;
    sunLight.shadow.camera.right = shadowSpan;
    sunLight.shadow.camera.top = shadowSpan;
    sunLight.shadow.camera.bottom = -shadowSpan;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = distance * 3;
    sunLight.shadow.camera.updateProjectionMatrix();

    scene.fog.near = distance * 0.6;
    scene.fog.far = distance * 2.6;
  }

  // ---------------------------------------------------------------------
  // Canvas / renderer sizing
  // ---------------------------------------------------------------------
  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    boardW = window.innerWidth;
    boardH = window.innerHeight;

    renderer.setPixelRatio(dpr);
    renderer.setSize(boardW, boardH, false);
    canvas.style.width = boardW + 'px';
    canvas.style.height = boardH + 'px';

    boardMesh.geometry.dispose();
    boardMesh.geometry = new THREE.PlaneGeometry(boardW, boardH);
    buildGrid(boardW, boardH, 40);
    fitCamera();
  }
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', function () {
    setTimeout(resizeCanvas, 200);
  });
  resizeCanvas();

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  var rollAxis = new THREE.Vector3();

  function updateBall(dt) {
    ballMesh.position.set(px2x(ball.x), ballRadius, px2z(ball.y));
    var speed = Math.hypot(vel.x, vel.y);
    if (speed > 0.5) {
      rollAxis.set(vel.y, 0, -vel.x).normalize();
      ballMesh.rotateOnWorldAxis(rollAxis, (speed * dt) / ballRadius);
    }
  }

  function render(dt) {
    updateBall(dt);
    renderer.render(scene, camera);
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
    buildHoles(holes);
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
      render(dt);
      endRound(fallenHole.type === 'target');
      return;
    }

    render(dt);
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
