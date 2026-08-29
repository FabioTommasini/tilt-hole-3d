# Tilt Hole

A mobile web game: tilt your phone to roll a ball into the glowing target hole while avoiding trap holes. Vanilla JS, rendered in 3D with Three.js (loaded via CDN — no build step, no npm dependencies).

## Play

Open `index.html` on a phone (or serve the folder with any static file server). Deploys to Vercel with zero configuration.

## Structure

- `index.html` — screens (start, difficulty, permission, countdown, win, game over), the canvas, and the Three.js CDN `<script>` tag
- `style.css` — visuals
- `game.js` — pure game logic (hole placement, physics, collisions), working entirely in 2D board-pixel coordinates; tunable constants live in its `CONFIG` object. Also runnable from Node for tests.
- `sounds.js` — Web Audio–synthesized music and sound effects (no audio files)
- `app.js` — state machine wiring screens, input (tilt + keyboard fallback), and the Three.js scene together. Board-pixel coordinates from `game.js` are mapped onto a flat 3D board (`px2x`/`px2z`) viewed by a perspective camera tilted back off vertical (see `fitCamera`), with the ball and holes as real geometry (sphere, cylinders, glowing torus ring) instead of flat 2D shapes
- `test/logic.test.js` — Node test suite for the pure game logic (`node test/logic.test.js`)

## Controls

- **Phone**: tilt to roll the ball (uses `devicemotion`; requests permission on iOS)
- **Desktop/no sensors**: arrow keys or WASD
