# Tilt Hole

A mobile web game: tilt your phone to roll a ball into the glowing target hole while avoiding trap holes. Vanilla JS + Canvas, no build step, no dependencies.

## Play

Open `index.html` on a phone (or serve the folder with any static file server). Deploys to Vercel with zero configuration.

## Structure

- `index.html` — screens (start, difficulty, permission, countdown, win, game over) and canvas
- `style.css` — visuals
- `game.js` — pure game logic (hole placement, physics, collisions); tunable constants live in its `CONFIG` object. Also runnable from Node for tests.
- `sounds.js` — Web Audio–synthesized music and sound effects (no audio files)
- `app.js` — state machine wiring screens, input (tilt + keyboard fallback), and rendering together
- `test/logic.test.js` — Node test suite for the pure game logic (`node test/logic.test.js`)

## Controls

- **Phone**: tilt to roll the ball (uses `devicemotion`; requests permission on iOS)
- **Desktop/no sensors**: arrow keys or WASD
