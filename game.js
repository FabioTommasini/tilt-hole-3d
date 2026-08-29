// Tilt Hole — core game logic, physics, rendering, and state machine.
// Tunable constants live in CONFIG below.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    // Node (used by test/logic.test.js) — export pure logic only.
    module.exports = factory();
  } else {
    root.TiltHole = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Tunable constants
  // ---------------------------------------------------------------------
  var CONFIG = {
    ball: {
      radius: 11,
      maxSpeed: 900,       // px/s, hard cap so the ball can't run away
      deadzone: 0.4,       // m/s^2 below which tilt input is ignored
      maxTilt: 20           // m/s^2 clamp on raw accelerometer input (glitch guard)
    },
    wallBounce: 0.5,        // velocity retained (0-1) after bouncing off a wall
    countdown: { steps: [3, 2, 1], stepMs: 700 },
    difficulties: {
      easy: {
        label: 'Easy',
        totalHoles: 4,      // 1 target + 3 traps
        holeRadius: 30,
        minSpacing: 100,
        accel: 700,         // px/s^2 per m/s^2 of tilt
        friction: 0.90       // per-frame-at-60fps velocity retention
      },
      medium: {
        label: 'Medium',
        totalHoles: 5,      // 1 target + 4 traps
        holeRadius: 24,
        minSpacing: 85,
        accel: 950,
        friction: 0.90
      },
      hard: {
        label: 'Hard',
        totalHoles: 7,      // 1 target + 6 traps
        holeRadius: 18,
        minSpacing: 62,
        accel: 1250,
        friction: 0.91
      }
    }
  };

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // -----------------------------------------------------------------------
  // Hole placement
  //
  // Places one target hole near a random edge of the board, then scatters
  // trap holes, rejecting candidates that are too close to each other, to
  // the target, or to the ball's start point. Falls back to relaxing the
  // spacing requirement if the board is too small/crowded to fit every
  // hole at full spacing, so this never hangs and always returns the
  // requested hole count.
  // -----------------------------------------------------------------------
  function generateHoles(boardW, boardH, diff, ballStart, ballRadius, rng) {
    rng = rng || Math.random;
    var r = diff.holeRadius;
    var edgeMargin = r + 14;
    var startClearance = r + ballRadius * 4 + 24;

    function randomEdgePoint() {
      var edge = Math.floor(rng() * 4);
      var x, y;
      if (edge === 0) { // top
        x = edgeMargin + rng() * (boardW - 2 * edgeMargin);
        y = edgeMargin;
      } else if (edge === 1) { // right
        x = boardW - edgeMargin;
        y = edgeMargin + rng() * (boardH - 2 * edgeMargin);
      } else if (edge === 2) { // bottom
        x = edgeMargin + rng() * (boardW - 2 * edgeMargin);
        y = boardH - edgeMargin;
      } else { // left
        x = edgeMargin;
        y = edgeMargin + rng() * (boardH - 2 * edgeMargin);
      }
      return { x: x, y: y };
    }

    var minDistFromCenter = Math.min(boardW, boardH) * 0.3 + r;

    var target = null;
    for (var a = 0; a < 80; a++) {
      var candidate = randomEdgePoint();
      if (dist(candidate, ballStart) >= minDistFromCenter) {
        target = candidate;
        break;
      }
    }
    if (!target) target = randomEdgePoint(); // best effort fallback

    var holes = [{ x: target.x, y: target.y, r: r, type: 'target' }];

    var trapCount = Math.max(0, diff.totalHoles - 1);
    var spacing = diff.minSpacing;
    var margin = r + 10;

    for (var relax = 0; relax < 6 && holes.length - 1 < trapCount; relax++) {
      var triesLeft = 3000;
      while (holes.length - 1 < trapCount && triesLeft-- > 0) {
        var x = margin + rng() * (boardW - 2 * margin);
        var y = margin + rng() * (boardH - 2 * margin);
        var pt = { x: x, y: y };
        if (dist(pt, ballStart) < startClearance) continue;
        var ok = true;
        for (var i = 0; i < holes.length; i++) {
          if (dist(pt, holes[i]) < spacing) { ok = false; break; }
        }
        if (ok) holes.push({ x: x, y: y, r: r, type: 'trap' });
      }
      spacing *= 0.8; // relax spacing requirement and try again if still short
    }

    return holes;
  }

  // Returns the hole the ball has fallen into (mostly overlapping its
  // center), or null.
  function checkHoleCollision(ball, holes, ballRadius) {
    for (var i = 0; i < holes.length; i++) {
      var h = holes[i];
      if (dist(ball, h) < Math.max(2, h.r - ballRadius * 0.5)) return h;
    }
    return null;
  }

  // Mutates ball position/velocity in place to keep it within
  // [radius, boardW-radius] x [radius, boardH-radius], bouncing off walls.
  function resolveWallCollision(ball, vel, boardW, boardH, ballRadius, bounce) {
    if (ball.x - ballRadius < 0) {
      ball.x = ballRadius;
      vel.x = Math.abs(vel.x) * bounce;
    } else if (ball.x + ballRadius > boardW) {
      ball.x = boardW - ballRadius;
      vel.x = -Math.abs(vel.x) * bounce;
    }
    if (ball.y - ballRadius < 0) {
      ball.y = ballRadius;
      vel.y = Math.abs(vel.y) * bounce;
    } else if (ball.y + ballRadius > boardH) {
      ball.y = boardH - ballRadius;
      vel.y = -Math.abs(vel.y) * bounce;
    }
  }

  // Advances ball position/velocity by dt seconds given a tilt input
  // (tiltX, tiltY in m/s^2-ish units). Pure function used by both the
  // live game loop and tests.
  function stepPhysics(ball, vel, tiltX, tiltY, dt, diff, ballCfg) {
    var dz = ballCfg.deadzone;
    var tx = Math.abs(tiltX) < dz ? 0 : clamp(tiltX, -ballCfg.maxTilt, ballCfg.maxTilt);
    var ty = Math.abs(tiltY) < dz ? 0 : clamp(tiltY, -ballCfg.maxTilt, ballCfg.maxTilt);

    vel.x += tx * diff.accel * dt;
    vel.y += ty * diff.accel * dt;

    var frictionFactor = Math.pow(diff.friction, dt * 60);
    vel.x *= frictionFactor;
    vel.y *= frictionFactor;

    var speed = Math.hypot(vel.x, vel.y);
    if (speed > ballCfg.maxSpeed) {
      var scale = ballCfg.maxSpeed / speed;
      vel.x *= scale;
      vel.y *= scale;
    }

    ball.x += vel.x * dt;
    ball.y += vel.y * dt;
  }

  return {
    CONFIG: CONFIG,
    dist: dist,
    clamp: clamp,
    generateHoles: generateHoles,
    checkHoleCollision: checkHoleCollision,
    resolveWallCollision: resolveWallCollision,
    stepPhysics: stepPhysics
  };
});
