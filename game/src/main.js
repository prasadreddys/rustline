// RUSTLINE: boot and the one loop. A fixed 60 Hz simulation feeds a render
// at the display's rate; one state store (the fighters, the bomb, the rounds)
// is the only place the game lives, and the HUD only reads it.
// ?shot=start|play|buy|end with &seed=N stages a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, ARSENAL } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb } from './bomb.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { audio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = shot ? mulberry32(seed) : Math.random;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Dusk sky: a vertical gradient painted once, deep blue up top, ember at the
// horizon, so the yard reads at a glance instead of fading to black.
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#171e2e');
  grad.addColorStop(0.55, '#7a3d22');
  grad.addColorStop(0.78, '#c96a2e');
  grad.addColorStop(1, '#241812');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = makeSkyTexture();
scene.fog = new THREE.Fog(new THREE.Color('#2e2118'), 34, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const player = createPlayer(world.colliders, SPAWNS.atk[0]);
const weapons = createWeapons(camera);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// The one state store: the player fighter plus the bots, the bomb, the rounds.
const playerFighter = {
  kind: 'player',
  team: 'atk',
  name: 'You',
  position: player.state.position,
  get eye() { return player.state.eye; },
  get crouching() { return player.state.crouching; },
  hp: 100,
  armor: 0,
  alive: true,
};
playerFighter.position = player.state.position;

const losRay = new THREE.Raycaster();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

function losClear(from, to) {
  _v1.copy(to).sub(from);
  const dist = _v1.length();
  if (dist < 0.01) return true;
  losRay.set(from, _v1.normalize());
  losRay.far = dist - 0.05;
  return losRay.intersectObjects(world.shootables, false).length === 0;
}

const bots = createBots(scene, world, {
  losClear,
  playerSpeed: () => player.groundSpeed(),
  bombPlanted: () => bomb.state.status === 'planted',
  bombSite: () => bomb.state.site,
  shotFired: (bot, from, to, sound) => {
    addTracer(from, to, 0xffe0b0, 0.07);
    audio.shot('enemy');
  },
  damageFighter,
});
bots.spawnAll(SPAWNS, random);
const fighters = [playerFighter, ...bots.bots];

const bomb = createBomb({
  onPlanted(site) {
    hud.showBanner(`Bomb planted at ${site} — 35 seconds.`, 4000);
    audio.beep(660);
    if (bomb.state.carrier === playerFighter) rounds.addPlant();
  },
  onBeep(left) {
    audio.beep(left < 10 ? 1320 : 880);
  },
  onDefused() {
    rounds.endRound('def', 'Bomb defused.');
  },
  onExploded() {
    audio.explosion();
    explodeVisual(SITES[bomb.state.site ?? 'A'].center);
    rounds.endRound('atk', 'Bomb detonated.');
  },
});

const rounds = createRounds({
  onPhase(phase) {
    if (phase === 'freeze') resetRound();
    if (phase === 'live') {
      hud.showBuy(false);
      hud.showBanner('Plant the bomb at A or B.', 3600);
    }
  },
  onRoundStart() {},
  onRoundEnd(winner, reason, score) {
    hud.showBuy(false);
    hud.showOverlay('round', { won: winner === 'atk', reason, score });
    audio.sting(winner === 'atk');
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onMatchEnd(winner, score) {
    hud.showOverlay('match', { won: winner === 'atk', score });
    audio.sting(winner === 'atk');
  },
});

// Tracers: a small pool of lines, reused, never allocated in the hot loop.
const tracerPool = [];
for (let i = 0; i < 14; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0 });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracerPool.push({ line, life: 0 });
}
let tracerNext = 0;
function addTracer(from, to, color, life = 0.08) {
  const t = tracerPool[tracerNext];
  tracerNext = (tracerNext + 1) % tracerPool.length;
  const attr = t.line.geometry.getAttribute('position');
  attr.setXYZ(0, from.x, from.y, from.z);
  attr.setXYZ(1, to.x, to.y, to.z);
  attr.needsUpdate = true;
  t.line.material.color.setHex(color);
  t.line.material.opacity = 0.85;
  t.line.visible = true;
  t.life = life;
}

// Grenades in flight and explosion effects.
const grenades = [];
const grenadeGeo = new THREE.SphereGeometry(0.11, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.5 });
const explosions = [];
const explosionGeo = new THREE.SphereGeometry(1, 20, 14);

function explodeVisual(center) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0.85 });
  const mesh = new THREE.Mesh(explosionGeo, mat);
  mesh.position.set(center.x, 1, center.z);
  scene.add(mesh);
  const light = new THREE.PointLight(0xff7a2f, 60, 18);
  light.position.set(center.x, 2, center.z);
  scene.add(light);
  explosions.push({ mesh, light, life: 0.8 });
}

function throwGrenade() {
  if (!weapons.throwGrenade()) return;
  camera.getWorldDirection(_v1);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.position.copy(camera.position).addScaledVector(_v1, 0.5);
  scene.add(mesh);
  grenades.push({
    mesh,
    vel: _v1.clone().multiplyScalar(15).add(new THREE.Vector3(0, 3.5, 0)),
    fuse: 1.6,
  });
  audio.shot('pistol');
}

function detonateGrenade(g) {
  scene.remove(g.mesh);
  audio.explosion();
  explodeVisual(g.mesh.position);
  const center = g.mesh.position;
  for (const f of fighters) {
    if (!f.alive) continue;
    _v2.set(f.position.x, f.position.y + 1.1, f.position.z);
    const dist = _v2.distanceTo(center);
    if (dist > 6.5) continue;
    if (!losClear(center, _v2)) continue;
    const dmg = Math.max(15, 120 * (1 - dist / 6.5));
    damageFighter(f, dmg, 'torso', playerFighter);
  }
}

function damageFighter(fighter, amount, part, attacker) {
  if (!fighter.alive) return false;
  const absorbed = Math.min(fighter.armor, amount * 0.5);
  fighter.armor -= absorbed;
  fighter.hp -= (amount - absorbed);
  if (fighter.kind === 'player') {
    hud.damageFlash();
    if (fighter.hp <= 0) {
      fighter.hp = 0;
      fighter.alive = false;
      hud.showOverlay('dead');
      if (document.pointerLockElement) document.exitPointerLock();
      // The bomb passes to the nearest living ally.
      if (bomb.state.carrier === fighter && bomb.state.status === 'carried') {
        let best = null;
        let bestD = Infinity;
        for (const b of bots.bots) {
          if (b.team !== 'atk' || !b.alive) continue;
          const d = b.position.distanceTo(fighter.position);
          if (d < bestD) { bestD = d; best = b; }
        }
        if (best) {
          best.carrying = true;
          bomb.state.carrier = best;
        }
      }
    }
  } else if (fighter.hp <= 0) {
    fighter.hp = 0;
    fighter.alive = false;
    if (attacker === playerFighter) {
      rounds.addKill();
      audio.kill();
    }
  } else if (attacker === playerFighter) {
    audio.hit();
  }
  if (!fighter.alive && attacker) hud.feed(attacker.name, fighter.name, part === 'head');
  return !fighter.alive;
}

function resetRound() {
  input.clearPressed();
  player.reset(SPAWNS.atk[0].x, SPAWNS.atk[0].z, SPAWNS.atk[0].yaw);
  playerFighter.hp = 100;
  playerFighter.armor = 0;
  playerFighter.alive = true;
  bots.resetRound(SPAWNS, random);
  weapons.refill();
  bomb.reset(playerFighter);
  for (const g of grenades) scene.remove(g.mesh);
  grenades.length = 0;
  for (const t of tracerPool) { t.life = 0; t.line.visible = false; }
  hud.showBuy(true, rounds.state.money, weapons.owned(), weapons.grenades);
  hud.showPrompt(null);
  hud.showProgress(null, null);
  syncCamera();
  hud.setAmmo(weapons.state().mag, weapons.state().reserve, weapons.def().name, weapons.grenades);
  hud.setHealth(100, 0);
  hud.setMoney(rounds.state.money);
  hud.setScore(rounds.state.score.atk, rounds.state.score.def, rounds.state.round);
}

function syncCamera() {
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - player.state.position.x;
  const dy = point.y - (player.state.position.y + player.state.eye);
  const dz = point.z - player.state.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.state.yaw = Math.atan2(-dx, -dz);
  player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

const shootables = world.shootables.concat(bots.hitMeshes());

function shoot(spread) {
  if (!weapons.takeRound()) return false;
  camera.getWorldDirection(_v1);
  _v1.x += (random() * 2 - 1) * spread;
  _v1.y += (random() * 2 - 1) * spread;
  _v1.z += (random() * 2 - 1) * spread;
  _v1.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, _v1);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  if (hit) {
    addTracer(camera.position, hit.point, 0xffe0b0);
    const fighter = hit.object.userData.fighter;
    if (fighter) {
      const def = weapons.def();
      const killed = damageFighter(fighter, def.damage * (hit.object.userData.part === 'head' ? def.headMult : 1), hit.object.userData.part, playerFighter);
      hud.hitMarker(killed, 4000);
    }
  } else {
    _v2.copy(camera.position).addScaledVector(_v1, 80);
    addTracer(camera.position, _v2, 0xffe0b0);
  }
  weapons.pullTrigger();
  player.recoil(0.009 + random() * 0.004 + weapons.def().kick * 0.4, (random() * 2 - 1) * 0.004);
  audio.shot(weapons.def().sound);
  bots.hearNoise(camera.position, elapsed);
  hud.setAmmo(weapons.state().mag, weapons.state().reserve, weapons.def().name, weapons.grenades);
  return true;
}

let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();

const BUY_KEYS = { Digit1: 'p9', Digit2: 'wasp', Digit3: 'falcon', Digit4: 'heron', Digit5: 'grenade', Digit6: 'armor' };

function buyAction(id) {
  if (id === 'close') {
    hud.showBuy(false);
    return;
  }
  if (rounds.state.phase !== 'freeze') return;
  if (id === 'grenade') {
    if (weapons.grenades > 0) return;
    if (!rounds.spend(300)) return;
    weapons.buyGrenade();
  } else if (id === 'armor') {
    if (playerFighter.armor >= 50) return;
    if (!rounds.spend(650)) return;
    playerFighter.armor = 50;
  } else {
    if (weapons.owned().includes(id)) {
      weapons.select(id);
    } else {
      if (!rounds.spend(ARSENAL[id].price)) return;
      weapons.buy(id);
    }
  }
  audio.beep(990);
  hud.setMoney(rounds.state.money);
  hud.setAmmo(weapons.state().mag, weapons.state().reserve, weapons.def().name, weapons.grenades);
  hud.setHealth(playerFighter.hp, playerFighter.armor);
  hud.showBuy(true, rounds.state.money, weapons.owned(), weapons.grenades);
}

hud.onPlay(() => {
  audio.unlock();
  if (shot) return;
  const phase = rounds.state.phase;
  if (phase === 'menu' || phase === 'matchEnd') {
    rounds.startMatch();
    hud.hideOverlay();
  } else if (phase === 'roundEnd') {
    rounds.state.phaseLeft = 0.01;
    hud.hideOverlay();
  } else if (phase === 'live' || phase === 'freeze') {
    hud.hideOverlay();
    if (hud.isBuyOpen()) hud.showBuy(false);
    input.requestLock();
  }
});
hud.onBuy(buyAction);

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (!started) {
    hud.showOverlay('start');
  } else if (rounds.state.phase === 'live' && playerFighter.alive && !hud.isBuyOpen()) {
    hud.showOverlay('paused');
  }
}

function siteContaining(pos) {
  for (const key of Object.keys(SITES)) {
    const site = SITES[key];
    if (Math.hypot(pos.x - site.center.x, pos.z - site.center.z) <= site.radius) return key;
  }
  return null;
}

function step(dt) {
  elapsed += dt;
  const phase = rounds.state.phase;
  rounds.update(dt, bomb.state.status === 'planted');

  if (phase === 'live' && playerFighter.alive) {
    player.step(dt, input.state.keys);
  }
  weapons.step(dt);
  bots.thinkAll(elapsed, fighters, random);
  bots.stepAll(dt, elapsed, random, phase === 'live');

  // Grenades.
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.vel.y -= 12 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    if (g.mesh.position.y <= 0.11) {
      g.mesh.position.y = 0.11;
      g.vel.set(0, 0, 0);
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      detonateGrenade(g);
      grenades.splice(i, 1);
    }
  }

  // Bomb: plant by the carrier, defuse by a defender at the site.
  let planting = false;
  let plantSite = null;
  if (bomb.state.status === 'carried' && bomb.state.carrier) {
    const carrier = bomb.state.carrier;
    const site = siteContaining(carrier.position);
    if (carrier.kind === 'player') {
      planting = carrier.alive && !!site && input.state.keys.has('KeyE');
      plantSite = planting ? site : site;
    } else if (carrier.planting) {
      planting = true;
      plantSite = site;
    }
    if (carrier.kind === 'player') hud.showProgress(planting ? 'Planting the bomb' : null, planting ? bomb.state.plantProgress : null);
  }
  const defuser = bomb.state.status === 'planted'
    ? bots.bots.find((b) => b.team === 'def' && b.alive && b.defusing) ?? null
    : null;
  bomb.update(dt, elapsed, planting, plantSite, defuser);

  // Round ends by elimination.
  if (rounds.state.phase === 'live') {
    if (bots.aliveCount('def') === 0) {
      rounds.endRound('atk', 'Enemy team eliminated.');
    } else if (bots.aliveCount('atk') === 0 && !playerFighter.alive && bomb.state.status !== 'planted') {
      rounds.endRound('def', 'Your team was eliminated.');
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const phase = rounds.state.phase;
    if (!shot) {
      if (phase === 'live' && playerFighter.alive && input.state.locked) {
        if (input.state.firing && weapons.ready()) shoot(weapons.spread(player.groundSpeed()));
        if (input.pressed('KeyR') && weapons.reload()) audio.reload();
        if (input.pressed('KeyG')) throwGrenade();
        for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
          if (input.pressed(code)) {
            if (weapons.select(BUY_KEYS[code])) {
              hud.setAmmo(weapons.state().mag, weapons.state().reserve, weapons.def().name, weapons.grenades);
            }
          }
        }
      }
      if (phase === 'freeze') {
        if (input.pressed('KeyB')) hud.showBuy(!hud.isBuyOpen(), rounds.state.money, weapons.owned(), weapons.grenades);
        for (const code of Object.keys(BUY_KEYS)) {
          if (input.pressed(code) && hud.isBuyOpen()) buyAction(BUY_KEYS[code]);
        }
      }
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    // HUD, every frame (setters guard unchanged values).
    const st = weapons.state();
    hud.setAmmo(st.mag, st.reserve, weapons.def().name, weapons.grenades);
    hud.setHealth(playerFighter.hp, playerFighter.armor);
    hud.setMoney(rounds.state.money);
    hud.setSpread(weapons.spread(player.groundSpeed()));
    hud.setScore(rounds.state.score.atk, rounds.state.score.def, rounds.state.round);
    if (bomb.state.status === 'planted') {
      const left = bomb.timeLeft(elapsed);
      hud.setTimer(`0:${String(Math.ceil(left)).padStart(2, '0')}`, left < 10);
      hud.showPrompt(null);
    } else if (rounds.state.phase === 'freeze') {
      hud.setTimer(`BUY ${Math.ceil(rounds.state.phaseLeft)}`, false);
      hud.showPrompt('Buy phase — press B for the shop.');
      hud.showProgress(null, null);
    } else if (rounds.state.phase === 'live') {
      hud.setTimer(`${Math.floor(rounds.state.phaseLeft / 60)}:${String(Math.floor(rounds.state.phaseLeft % 60)).padStart(2, '0')}`, rounds.state.phaseLeft < 15);
      const site = siteContaining(player.state.position);
      if (bomb.state.carrier === playerFighter && site && playerFighter.alive) {
        hud.showPrompt('Hold E to plant the bomb');
      } else {
        hud.showPrompt(null);
      }
    } else {
      hud.setTimer('—', false);
    }
  }
  for (const t of tracerPool) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.85;
      if (t.life <= 0) t.line.visible = false;
    }
  }
  for (let i = explosions.length - 1; i >= 0; i -= 1) {
    const e = explosions[i];
    e.life -= dt;
    const scale = 1 + (0.8 - Math.max(0, e.life)) * 14;
    e.mesh.scale.setScalar(Math.max(0.1, scale));
    e.mesh.material.opacity = Math.max(0, e.life / 0.8) * 0.85;
    e.light.intensity = Math.max(0, e.life / 0.8) * 60;
    if (e.life <= 0) {
      scene.remove(e.mesh);
      scene.remove(e.light);
      explosions.splice(i, 1);
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  if (name === 'start') {
    player.reset(SPAWNS.atk[0].x, SPAWNS.atk[0].z, 0);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, 0));
    hud.showOverlay('start');
  } else if (name === 'buy') {
    rounds.startMatch();
    settle(30);
    player.reset(SPAWNS.atk[0].x, SPAWNS.atk[0].z, -0.45);
    syncCamera();
    hud.showBuy(true, rounds.state.money, weapons.owned(), weapons.grenades);
  } else if (name === 'play') {
    rounds.startMatch();
    rounds.state.phase = 'live';
    rounds.state.phaseLeft = 100;
    player.reset(2, 12, 0);
    const defender = bots.bots.find((b) => b.team === 'def');
    defender.position.set(0, 0, 0);
    defender.yaw = Math.PI;
    const ally = bots.bots.find((b) => b.team === 'atk');
    ally.position.set(-3.5, 0, 9);
    ally.yaw = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.2, 0));
    shoot(0);
    // Freeze two steps later, while the tracer and muzzle flash still show.
    settle(2);
  } else {
    // end: a round just won by detonation.
    rounds.startMatch();
    rounds.state.score.atk = 1;
    rounds.state.phase = 'roundEnd';
    rounds.state.phaseLeft = 4;
    player.reset(-14, -4, 0.9);
    settle(20);
    aimAt(new THREE.Vector3(-20, 1.2, -9));
    hud.showOverlay('round', { won: true, reason: 'Bomb detonated — Site A cleared.', score: { atk: 1, def: 0 } });
  }
  hud.setScore(rounds.state.score.atk, rounds.state.score.def, rounds.state.round);
  hud.setAmmo(weapons.state().mag, weapons.state().reserve, weapons.def().name, weapons.grenades);
  hud.setMoney(rounds.state.money);
  if (name !== 'buy') hud.showBuy(false);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__rustline = {
  state: () => ({
    phase: rounds.state.phase,
    round: rounds.state.round,
    score: { ...rounds.state.score },
    money: rounds.state.money,
    hp: playerFighter.hp,
    alive: playerFighter.alive,
    bomb: bomb.state.status,
    bombSite: bomb.state.site,
    plantProgress: bomb.state.plantProgress,
    defuseProgress: bomb.state.defuseProgress,
    weapon: weapons.current,
    nades: weapons.grenades,
    ammo: weapons.state(),
    pos: [Math.round(player.state.position.x * 10) / 10, Math.round(player.state.position.z * 10) / 10],
    botsAlive: { atk: bots.aliveCount('atk'), def: bots.aliveCount('def') },
    botsHp: bots.bots.map((b) => b.hp),
    elapsed,
  }),
  start: () => rounds.startMatch(),
  teleport: (x, z) => player.reset(x, z, player.state.yaw),
};

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
