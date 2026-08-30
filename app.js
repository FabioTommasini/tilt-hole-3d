// Tilt Hole — screens, input, rendering, and the game loop.
// Pure logic (physics, hole placement, collisions) lives in game.js and
// is completely unaware of the space theme below: it just deals in a
// ball, holes, and a board rectangle. Everything here is presentation —
// the "ball" is rendered as a spinning saucer ship, "trap" holes as
// animated black-hole vortexes, and the "target" hole as a mother ship
// hovering over a landing pad — layered over a starfield that shares
// its exact color with the board, so there is no visible plane at all.
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
  var elapsed = 0; // seconds of animation time, for spins/twinkle/pulses

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
  var SPACE_COLOR = '#03040c'; // background AND board — the "plane" is invisible

  function px2x(px) { return px - boardW / 2; }
  function px2z(py) { return py - boardH / 2; }

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(SPACE_COLOR);
  scene.fog = new THREE.Fog(SPACE_COLOR, 500, 2000);

  var camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 1, 6000);

  scene.add(new THREE.AmbientLight(0x8fa2ff, 0.55));
  var starLight = new THREE.DirectionalLight(0xdce6ff, 0.75);
  scene.add(starLight);

  // ---------------------------------------------------------------------
  // Starfield: a big shell of twinkling points around the whole scene.
  // Twinkle is computed per-vertex on the GPU from a time uniform, so it
  // costs nothing per frame beyond updating that one uniform. Points are
  // unlit and ignore scene.fog, so they read as infinitely far away.
  // ---------------------------------------------------------------------
  // The camera looks down at a steep angle (barely off vertical), so it
  // never looks "up" toward a sky dome — every ray it casts converges
  // toward the ground plane out at the horizon. So the starfield has to
  // live out at large XZ distance close to that same ground plane (a
  // huge flat ring around the board), not "overhead", or it simply never
  // crosses any ray the camera actually casts.
  var STAR_COUNT = 1100;
  var starGeometry = new THREE.BufferGeometry();
  (function buildStars() {
    var positions = new Float32Array(STAR_COUNT * 3);
    var phases = new Float32Array(STAR_COUNT);
    var speeds = new Float32Array(STAR_COUNT);
    var sizes = new Float32Array(STAR_COUNT);
    for (var i = 0; i < STAR_COUNT; i++) {
      var radius = 900 + Math.random() * 4200;
      var theta = Math.random() * Math.PI * 2;
      positions[i * 3] = radius * Math.cos(theta);
      positions[i * 3 + 1] = (Math.random() - 0.5) * 500;
      positions[i * 3 + 2] = radius * Math.sin(theta);
      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = 0.6 + Math.random() * 2.2;
      sizes[i] = 1.2 + Math.random() * 2.6;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    starGeometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));
    starGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  })();

  var starMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: [
      'attribute float phase;',
      'attribute float speed;',
      'attribute float size;',
      'uniform float uTime;',
      'varying float vTwinkle;',
      'void main() {',
      '  vTwinkle = 0.5 + 0.5 * sin(uTime * speed + phase);',
      '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
      // Stars are a backdrop at effectively infinite distance, so unlike
      // near-field particles they keep a constant screen-space size
      // rather than shrinking with distance.
      '  gl_PointSize = size * 1.6;',
      '  gl_Position = projectionMatrix * mvPosition;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'varying float vTwinkle;',
      'void main() {',
      '  vec2 uv = gl_PointCoord - vec2(0.5);',
      '  float d = length(uv);',
      '  float alpha = smoothstep(0.5, 0.0, d) * (0.35 + 0.65 * vTwinkle);',
      '  gl_FragColor = vec4(0.85, 0.9, 1.0, alpha);',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  scene.add(new THREE.Points(starGeometry, starMaterial));

  // A pulsing "containment field" outline is the only visual trace of
  // the play area's edges — the board itself has no fill, so it reads
  // as pure open space with a HUD-style boundary rather than a table.
  var boundaryMaterial = new THREE.LineBasicMaterial({ color: '#5ce1e6', transparent: true, opacity: 0.3 });
  var boundaryLine = new THREE.LineLoop(new THREE.BufferGeometry(), boundaryMaterial);
  scene.add(boundaryLine);

  function buildBoundary(w, h) {
    var hw = w / 2, hh = h / 2;
    boundaryLine.geometry.dispose();
    var pts = new Float32Array([
      -hw, 1, -hh,
      hw, 1, -hh,
      hw, 1, hh,
      -hw, 1, hh
    ]);
    boundaryLine.geometry = new THREE.BufferGeometry();
    boundaryLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }

  // ---------------------------------------------------------------------
  // Ship (replaces the ball): a small saucer that spins continuously,
  // with a translucent cockpit dome, a glowing rim, and a pulsing engine
  // glow underneath that pairs with the constant engine sound.
  // ---------------------------------------------------------------------
  var SHIP_SPIN_SPEED = 1.6; // radians/sec
  var ballRadius = CONFIG.ball.radius;
  var shipGroup = new THREE.Group();

  var shipHull = new THREE.Mesh(
    new THREE.CylinderGeometry(ballRadius * 1.15, ballRadius * 1.15, ballRadius * 0.4, 20),
    new THREE.MeshStandardMaterial({ color: '#b9c6de', metalness: 0.7, roughness: 0.3, emissive: '#0d1b33', emissiveIntensity: 0.5 })
  );
  shipGroup.add(shipHull);

  var shipDome = new THREE.Mesh(
    new THREE.SphereGeometry(ballRadius * 0.55, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#8fe8ff', metalness: 0.1, roughness: 0.15, emissive: '#3ddcff', emissiveIntensity: 0.4, transparent: true, opacity: 0.9 })
  );
  shipDome.position.y = ballRadius * 0.2;
  shipGroup.add(shipDome);

  var shipRim = new THREE.Mesh(
    new THREE.TorusGeometry(ballRadius * 1.15, ballRadius * 0.12, 8, 24),
    new THREE.MeshStandardMaterial({ color: '#5ce1e6', emissive: '#5ce1e6', emissiveIntensity: 1.3, roughness: 0.4 })
  );
  shipRim.rotation.x = Math.PI / 2;
  shipGroup.add(shipRim);

  var shipEngineGlow = new THREE.Mesh(
    new THREE.ConeGeometry(ballRadius * 0.4, ballRadius * 0.5, 12),
    new THREE.MeshBasicMaterial({ color: '#ff7a45', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending })
  );
  shipEngineGlow.rotation.x = Math.PI;
  shipEngineGlow.position.y = -ballRadius * 0.45;
  shipGroup.add(shipEngineGlow);

  var shipLight = new THREE.PointLight('#5ce1e6', 0.9, ballRadius * 14, 2);
  shipGroup.add(shipLight);

  scene.add(shipGroup);

  // ---------------------------------------------------------------------
  // Hazards & goal
  // ---------------------------------------------------------------------
  var holesGroup = new THREE.Group();
  scene.add(holesGroup);
  var activeVortices = []; // { pivot, speed } rotated every frame
  var mothershipPivot = null; // rotated slowly every frame, or null between rounds

  function disposeMesh(obj) {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(function (m) { m.dispose(); });
      else obj.material.dispose();
    }
    if (obj.children) obj.children.forEach(disposeMesh);
  }

  // Animated black hole: a dark core with concentric partial rings (each
  // an arc, not a full circle, so the spin is actually visible) spinning
  // at different speeds and directions for a swirling-vortex look.
  function buildVortex(x, z, r) {
    var group = new THREE.Group();

    var core = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.42, 20, 16),
      new THREE.MeshBasicMaterial({ color: '#000000' })
    );
    core.position.y = 0.8;
    group.add(core);

    var ringColors = ['#c084fc', '#7c3aed', '#3b0f70'];
    for (var i = 0; i < 3; i++) {
      var pivot = new THREE.Group();
      var ringR = r * (0.55 + i * 0.22);
      var tube = Math.max(1.2, r * 0.055);
      var arcLen = Math.PI * (1.15 + i * 0.25);
      var ringMesh = new THREE.Mesh(
        new THREE.TorusGeometry(ringR, tube, 8, 32, arcLen),
        new THREE.MeshStandardMaterial({
          color: ringColors[i],
          emissive: ringColors[i],
          emissiveIntensity: 0.9 - i * 0.2,
          roughness: 0.5,
          transparent: true,
          opacity: 0.9 - i * 0.15,
          side: THREE.DoubleSide
        })
      );
      ringMesh.rotation.x = Math.PI / 2; // lay flat; pivot (not this rotation) animates the spin
      ringMesh.rotation.y = Math.random() * Math.PI * 2;
      pivot.add(ringMesh);
      pivot.position.y = 0.5 + i * 0.18;
      group.add(pivot);
      activeVortices.push({ pivot: pivot, speed: (i % 2 === 0 ? 1 : -1) * (1.6 - i * 0.35) });
    }

    var glow = new THREE.PointLight('#7c3aed', 1.0, r * 8, 2);
    glow.position.set(0, r * 0.9, 0);
    group.add(glow);

    group.position.set(x, 0, z);
    return group;
  }

  // Mother ship: a hovering hull that slowly rotates above a glowing
  // landing pad, connected by a soft tractor-beam cone. The pad ring is
  // the actual collision target visually — flying into the beam is the
  // "reach the mother ship" win condition.
  function buildMothership(x, z, r) {
    var group = new THREE.Group();

    var pad = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.92, Math.max(1.6, r * 0.1), 8, 40),
      new THREE.MeshStandardMaterial({ color: '#8fffe0', emissive: '#8fffe0', emissiveIntensity: 1.3, roughness: 0.4 })
    );
    pad.rotation.x = Math.PI / 2;
    pad.position.y = 0.7;
    group.add(pad);

    var padGlow = new THREE.PointLight('#8fffe0', 1.2, r * 10, 2);
    padGlow.position.y = r * 1.1;
    group.add(padGlow);

    var beam = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.25, r * 1.05, r * 3.2, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: '#8fffe0', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.y = r * 1.6;
    group.add(beam);

    var hullPivot = new THREE.Group();
    hullPivot.position.y = r * 3.2;
    var hull = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.6, r * 1.9, r * 0.5, 24),
      new THREE.MeshStandardMaterial({ color: '#38507a', metalness: 0.6, roughness: 0.35, emissive: '#0d1b33', emissiveIntensity: 0.4 })
    );
    hullPivot.add(hull);
    var hullRim = new THREE.Mesh(
      new THREE.TorusGeometry(r * 1.75, r * 0.12, 8, 32),
      new THREE.MeshStandardMaterial({ color: '#8fffe0', emissive: '#8fffe0', emissiveIntensity: 1.1, roughness: 0.5 })
    );
    hullRim.rotation.x = Math.PI / 2;
    hullPivot.add(hullRim);
    var hullDome = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.7, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#8fffe0', emissive: '#8fffe0', emissiveIntensity: 0.6, roughness: 0.3, transparent: true, opacity: 0.75 })
    );
    hullDome.position.y = r * 0.25;
    hullPivot.add(hullDome);
    group.add(hullPivot);

    mothershipPivot = hullPivot;
    group.position.set(x, 0, z);
    return group;
  }

  function buildHoles(holeList) {
    while (holesGroup.children.length) {
      disposeMesh(holesGroup.children.pop());
    }
    activeVortices.length = 0;
    mothershipPivot = null;
    holeList.forEach(function (h) {
      var x = px2x(h.x), z = px2z(h.y);
      holesGroup.add(h.type === 'target' ? buildMothership(x, z, h.r) : buildVortex(x, z, h.r));
    });
  }

  // Frames the whole board inside the camera FOV regardless of aspect
  // ratio or tilt angle: projects a set of sample points (the board's
  // padded corners, plus the same corners lifted to the mother ship's
  // approximate height) through the camera and rescales distance from
  // the actual overshoot, which converges in a couple of iterations to
  // a snug fit. A closed-form formula would need to account for both
  // the near-edge magnification the tilt introduces and the mother
  // ship's height above the board; this sidesteps both by measuring
  // directly.
  var fitCorners = [];
  for (var fc = 0; fc < 8; fc++) fitCorners.push(new THREE.Vector3());
  var NDC_LIMIT = 0.92;

  function fitCamera() {
    camera.aspect = boardW / boardH;

    var pad = ballRadius * 3;
    var hw = boardW / 2 + pad, hh = boardH / 2 + pad;
    var liftY = 170; // generous margin for the mother ship's hull height
    fitCorners[0].set(-hw, 0, -hh);
    fitCorners[1].set(hw, 0, -hh);
    fitCorners[2].set(-hw, 0, hh);
    fitCorners[3].set(hw, 0, hh);
    fitCorners[4].set(-hw, liftY, -hh);
    fitCorners[5].set(hw, liftY, -hh);
    fitCorners[6].set(-hw, liftY, hh);
    fitCorners[7].set(hw, liftY, hh);

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

    starLight.position.set(distance * 0.25, distance * 0.9, distance * 0.4);

    scene.fog.near = distance * 0.7;
    scene.fog.far = distance * 2.8;
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

    buildBoundary(boardW, boardH);
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
  function updateShip(dt) {
    shipGroup.position.set(px2x(ball.x), ballRadius * 0.95, px2z(ball.y));
    shipGroup.rotation.y += SHIP_SPIN_SPEED * dt;

    var speed = Math.hypot(vel.x, vel.y);
    var speedFrac = Math.min(1, speed / CONFIG.ball.maxSpeed);
    var pulse = 0.7 + 0.3 * Math.sin(elapsed * 14);
    shipEngineGlow.scale.setScalar(0.7 + speedFrac * 0.6 + pulse * 0.15);
    shipEngineGlow.material.opacity = 0.55 + speedFrac * 0.35;

    S.setEngineIntensity(speedFrac);
  }

  function updateHazards(dt) {
    for (var i = 0; i < activeVortices.length; i++) {
      activeVortices[i].pivot.rotation.y += activeVortices[i].speed * dt;
    }
    if (mothershipPivot) mothershipPivot.rotation.y += 0.35 * dt;
    boundaryMaterial.opacity = 0.22 + 0.13 * Math.sin(elapsed * 1.4);
  }

  function render(dt) {
    elapsed += dt;
    starMaterial.uniforms.uTime.value = elapsed;
    updateShip(dt);
    updateHazards(dt);
    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------------
  // Input: device tilt + keyboard fallback
  // ---------------------------------------------------------------------
  function onDeviceMotion(e) {
    var g = e.accelerationIncludingGravity;
    if (!g || (g.x == null && g.y == null)) return;
    // accelerationIncludingGravity points opposite to the direction the
    // device is tilted toward (it's the reaction force), so the ship
    // flies with the tilt when we use these signs directly.
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
    S.startEngine();
    lastFrameTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function endRound(won) {
    gameActive = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    detachInputListeners();
    S.stopEngine();
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
          showPermissionError('Motion access was not granted. Star Pilot needs it to read your phone’s tilt.');
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
