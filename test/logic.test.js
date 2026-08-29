// Lightweight assertion tests for the pure game logic (no DOM/browser
// needed). Run with: node test/logic.test.js
'use strict';

var assert = require('assert');
var T = require('../game.js');
var CONFIG = T.CONFIG;

var passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok - ' + name);
  } catch (e) {
    console.error('  FAIL - ' + name);
    console.error('    ' + e.message);
    process.exitCode = 1;
  }
}

// Deterministic PRNG (mulberry32) so failures are reproducible.
function makeRng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log('Hole placement');
['easy', 'medium', 'hard'].forEach(function (key) {
  var diff = CONFIG.difficulties[key];
  for (var seed = 0; seed < 25; seed++) {
    var rng = makeRng(seed * 97 + 1);
    var boardW = 360, boardH = 720;
    var ballStart = { x: boardW / 2, y: boardH / 2 };
    var holes = T.generateHoles(boardW, boardH, diff, ballStart, CONFIG.ball.radius, rng);

    test(key + ' seed ' + seed + ': places the requested hole count', function () {
      assert.strictEqual(holes.length, diff.totalHoles);
    });

    test(key + ' seed ' + seed + ': exactly one target hole', function () {
      var targets = holes.filter(function (h) { return h.type === 'target'; });
      assert.strictEqual(targets.length, 1);
    });

    test(key + ' seed ' + seed + ': all holes stay within board bounds', function () {
      holes.forEach(function (h) {
        assert.ok(h.x - h.r >= -1 && h.x + h.r <= boardW + 1, 'x out of bounds: ' + h.x);
        assert.ok(h.y - h.r >= -1 && h.y + h.r <= boardH + 1, 'y out of bounds: ' + h.y);
      });
    });

    test(key + ' seed ' + seed + ': no hole overlaps the ball start point', function () {
      holes.forEach(function (h) {
        var d = T.dist(h, ballStart);
        assert.ok(d > h.r, 'hole too close to start: dist=' + d + ' r=' + h.r);
      });
    });
  }
});

console.log('Wall collision');
test('ball bounces off the left wall and stays in bounds', function () {
  var ball = { x: 2, y: 100 };
  var vel = { x: -50, y: 0 };
  T.resolveWallCollision(ball, vel, 360, 720, 11, 0.5);
  assert.strictEqual(ball.x, 11);
  assert.ok(vel.x > 0, 'velocity should reverse');
  assert.strictEqual(vel.x, 25);
});

test('ball bounces off the right wall and stays in bounds', function () {
  var ball = { x: 358, y: 100 };
  var vel = { x: 50, y: 0 };
  T.resolveWallCollision(ball, vel, 360, 720, 11, 0.5);
  assert.strictEqual(ball.x, 349);
  assert.ok(vel.x < 0);
});

test('ball inside bounds is left untouched', function () {
  var ball = { x: 180, y: 360 };
  var vel = { x: 12, y: -7 };
  T.resolveWallCollision(ball, vel, 360, 720, 11, 0.5);
  assert.strictEqual(ball.x, 180);
  assert.strictEqual(ball.y, 360);
  assert.strictEqual(vel.x, 12);
  assert.strictEqual(vel.y, -7);
});

console.log('Hole collision (win/lose detection)');
test('detects falling into the target hole', function () {
  var holes = [{ x: 100, y: 100, r: 20, type: 'target' }, { x: 300, y: 300, r: 20, type: 'trap' }];
  var ball = { x: 101, y: 99 };
  var hit = T.checkHoleCollision(ball, holes, 11);
  assert.ok(hit);
  assert.strictEqual(hit.type, 'target');
});

test('detects falling into a trap hole', function () {
  var holes = [{ x: 100, y: 100, r: 20, type: 'target' }, { x: 300, y: 300, r: 20, type: 'trap' }];
  var ball = { x: 302, y: 298 };
  var hit = T.checkHoleCollision(ball, holes, 11);
  assert.ok(hit);
  assert.strictEqual(hit.type, 'trap');
});

test('no collision when far from every hole', function () {
  var holes = [{ x: 100, y: 100, r: 20, type: 'target' }, { x: 300, y: 300, r: 20, type: 'trap' }];
  var ball = { x: 200, y: 200 };
  var hit = T.checkHoleCollision(ball, holes, 11);
  assert.strictEqual(hit, null);
});

test('near a hole edge but not overlapping enough does not trigger', function () {
  var holes = [{ x: 100, y: 100, r: 20, type: 'target' }];
  var ball = { x: 100 + 20 + 11, y: 100 }; // ball edge just touching hole edge, center far
  var hit = T.checkHoleCollision(ball, holes, 11);
  assert.strictEqual(hit, null);
});

console.log('Physics step');
test('tilt accelerates the ball in the expected direction', function () {
  var ball = { x: 0, y: 0 };
  var vel = { x: 0, y: 0 };
  T.stepPhysics(ball, vel, 5, 0, 1 / 60, CONFIG.difficulties.medium, CONFIG.ball);
  assert.ok(vel.x > 0, 'positive x tilt should produce positive x velocity');
  assert.ok(ball.x > 0);
});

test('deadzone ignores tiny tilt noise', function () {
  var ball = { x: 0, y: 0 };
  var vel = { x: 0, y: 0 };
  T.stepPhysics(ball, vel, 0.1, 0.1, 1 / 60, CONFIG.difficulties.medium, CONFIG.ball);
  assert.strictEqual(vel.x, 0);
  assert.strictEqual(vel.y, 0);
});

test('friction decays velocity over time with zero input', function () {
  var ball = { x: 0, y: 0 };
  var vel = { x: 100, y: 0 };
  T.stepPhysics(ball, vel, 0, 0, 1, CONFIG.difficulties.medium, CONFIG.ball);
  assert.ok(vel.x < 100 && vel.x > 0, 'velocity should decay but not reverse: ' + vel.x);
});

test('speed is capped at maxSpeed', function () {
  var ball = { x: 0, y: 0 };
  var vel = { x: 0, y: 0 };
  for (var i = 0; i < 600; i++) {
    T.stepPhysics(ball, vel, 20, 0, 1 / 60, CONFIG.difficulties.hard, CONFIG.ball);
  }
  var speed = Math.hypot(vel.x, vel.y);
  assert.ok(speed <= CONFIG.ball.maxSpeed + 1, 'speed exceeded cap: ' + speed);
});

console.log('\n' + passed + ' assertions passed.');
if (process.exitCode) {
  console.error('\nSome tests FAILED.');
  process.exit(1);
} else {
  console.log('All tests passed.');
}
