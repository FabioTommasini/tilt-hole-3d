# Star Pilot

A mobile web game: tilt your phone to fly a spinning saucer ship to the glowing mother ship while dodging swirling black holes. Vanilla JS, rendered in 3D with Three.js (loaded via CDN — no build step, no npm dependencies), over a twinkling starfield.

## Play

Open `index.html` on a phone (or serve the folder with any static file server). Deploys to Vercel with zero configuration.

## Structure

- `index.html` — screens (start, difficulty, permission, countdown, win, game over), the canvas, and the Three.js/Google Fonts CDN tags
- `style.css` — dark space visuals (the "board" itself has no fill color — see below)
- `game.js` — pure game logic (hole placement, physics, collisions), working entirely in 2D board-pixel coordinates and knowing nothing about ships/black holes/mother ships — it's still just a ball and holes. Tunable constants live in its `CONFIG` object. Also runnable from Node for tests.
- `sounds.js` — Web Audio–synthesized ambient music, a constant rocket-engine hum while flying, and sci-fi win/lose stingers (no audio files)
- `app.js` — state machine wiring screens, input (tilt + keyboard fallback), and the Three.js scene together. Board-pixel coordinates from `game.js` are mapped onto flat world space (`px2x`/`px2z`) viewed by a perspective camera tilted back off vertical (see `fitCamera`). The "ball" renders as a spinning saucer ship, "trap" holes as animated black-hole vortexes, and the "target" hole as a mother ship hovering over a landing pad — all floating over a starfield that shares the exact same color as the board, so the play surface itself is invisible; only a pulsing boundary line marks its edges
- `test/logic.test.js` — Node test suite for the pure game logic (`node test/logic.test.js`)

## Controls

- **Phone**: tilt to fly the ship (uses `devicemotion`; requests permission on iOS)
- **Desktop/no sensors**: arrow keys or WASD
