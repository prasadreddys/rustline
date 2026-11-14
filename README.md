# RUSTLINE — a three.js tactical FPS

A round-based tactical shooter in the style Counter-Strike made famous, built
as an original game: your own map, art, sounds and names.

**The game:** 3v3 on a dusk industrial yard with two bomb sites (A Foundry,
B Silo). You attack with two bot squadmates against three defender bots.
Plant the bomb at A or B, or eliminate the other team. First to 5 rounds wins
the match. Between rounds, spend earned money in the buy menu: four guns
(P9 Sidearm, Wasp PDW, Falcon AR, Heron DMR), an HE grenade and Kevlar.

**Gunplay:** hitscan fire with headshot damage, recoil and spread that
punish firing on the move, acceleration, crouching and collision with the map.
Bots follow waypoint routes through the yard, hold positions, react to what
they see and hear, converge to defuse a planted bomb, and plant it
themselves if you fall while carrying it.

**Controls:** WASD move, mouse look, click fire, R reload, 1–4 weapons,
G grenade, E hold to plant, B buy menu, Ctrl crouch, Space jump.

**Run it:** serve `game/` with any static HTTP server and open `index.html`
in desktop Chrome. No build step, no network requests, three.js 0.187.0
vendored under `game/vendor/three/`.

**Shots:** `game/?shot=start|play|buy|end&seed=N` stages a deterministic
frame and sets `window.__shotReady` after two painted frames.

## License

MIT. See LICENSE.
