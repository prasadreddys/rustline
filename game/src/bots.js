// Bots: 5v... 3v3 with the player. Two ally attackers, three enemy defenders.
// Each bot has one job at a time: route along the waypoint graph, hold a
// position, engage a visible enemy, plant, defuse, or investigate a sound.
// Perception is a line-of-sight ray against the world plus a field of view;
// shooting is a probability model (distance, movement, cover state) with a
// reaction delay, so bots feel human and never snap-shot through walls.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { ARSENAL } from './weapons.js';

const THINK_EVERY = 0.12;
const REACT_MIN = 0.32;
const REACT_SPREAD = 0.35;
const SIGHT_RANGE = 42;
const SIGHT_HALF_ANGLE = 1.25;
const BOT_SPEED = 4.0;
const EYE_HEIGHT = 1.45;

const NAMES = {
  atk: ['Vex', 'Rook'],
  def: ['Havoc', 'Sable', 'Mira'],
};

const _to = new THREE.Vector3();
const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();

function nearestNode(nodes, pos) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const dx = nodes[i].x - pos.x;
    const dz = nodes[i].z - pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function bfsPath(edges, nodeCount, from, to) {
  if (from === to) return [to];
  const prev = new Array(nodeCount).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const [a, b] of edges) {
      const next = a === cur ? b : b === cur ? a : -1;
      if (next === -1 || prev[next] !== -1) continue;
      prev[next] = cur;
      if (next === to) {
        const path = [to];
        let node = to;
        while (node !== from) {
          node = prev[node];
          path.unshift(node);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

export function createBots(scene, world, hooks) {
  const teamMaterial = {
    atk: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.6, metalness: 0.05 }),
    def: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.6, metalness: 0.05 }),
  };
  const headMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.85 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.155, 16, 12);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const legGeo = new THREE.BoxGeometry(0.42, 0.62, 0.26);

  const bots = [];
  let botId = 0;

  function makeBot(team, index, spawn, weaponId) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, teamMaterial[team]);
    torso.position.y = 1.0;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, headMaterial);
    head.position.y = 1.53;
    head.userData.part = 'head';
    const legs = new THREE.Mesh(legGeo, darkMaterial);
    legs.position.y = 0.31;
    const gun = new THREE.Mesh(gunGeo, darkMaterial);
    gun.position.set(0.2, 1.15, -0.3);
    group.add(torso, head, legs, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);
    const bot = {
      kind: 'bot',
      id: botId,
      team,
      name: NAMES[team][index],
      weapon: weaponId,
      group,
      torso,
      head,
      position: new THREE.Vector3(spawn.x, 0, spawn.z),
      yaw: spawn.yaw,
      pitch: 0,
      hp: 100,
      armor: 0,
      alive: true,
      speed: BOT_SPEED,
      state: 'route',
      assignedSite: team === 'def' ? (index === 0 ? 'A' : index === 1 ? 'B' : null) : null,
      goalNode: -1,
      path: [],
      pathIndex: 0,
      target: null,
      engagedAt: 0,
      reactAt: 0,
      burstLeft: 0,
      nextShotAt: 0,
      thinkAt: Math.random() * THINK_EVERY,
      holdYaw: spawn.yaw,
      holdUntil: 0,
      investigateUntil: 0,
      investigateNode: -1,
      planting: false,
      defusing: false,
      carrying: false,
      fall: 0,
      crouching: false,
    };
    torso.userData.fighter = bot;
    head.userData.fighter = bot;
    bots.push(bot);
    botId += 1;
    return bot;
  }

  function resetBot(bot, spawn, random) {
    bot.position.set(spawn.x, 0, spawn.z);
    bot.yaw = spawn.yaw;
    bot.pitch = 0;
    bot.hp = 100;
    bot.armor = 0;
    bot.alive = true;
    bot.state = 'route';
    bot.goalNode = -1;
    bot.path = [];
    bot.pathIndex = 0;
    bot.target = null;
    bot.reactAt = 0;
    bot.burstLeft = 0;
    bot.nextShotAt = 0;
    bot.holdUntil = 0;
    bot.investigateUntil = 0;
    bot.planting = false;
    bot.defusing = false;
    bot.carrying = false;
    bot.fall = 0;
    bot.group.rotation.set(0, bot.yaw, 0);
    bot.group.position.copy(bot.position);
    bot.group.visible = true;
    if (bot.team === 'atk') bot.assignedSite = random() < 0.5 ? 'A' : 'B';
  }

  function routeTo(bot, nodeIndex) {
    if (bot.goalNode === nodeIndex && bot.path.length) return;
    const from = nearestNode(world.nodes, bot.position);
    bot.path = bfsPath(world.edges, world.nodes.length, from, nodeIndex);
    bot.pathIndex = 0;
    bot.goalNode = nodeIndex;
  }

  function eyeOf(fighter) {
    _to.set(fighter.position.x, fighter.position.y + (fighter.kind === 'player' ? fighter.eye : EYE_HEIGHT), fighter.position.z);
    return _to;
  }

  function visibleEnemy(bot, now, fighters) {
    let best = null;
    let bestD = Infinity;
    for (const other of fighters) {
      if (!other.alive || other.team === bot.team || other === bot) continue;
      const dx = other.position.x - bot.position.x;
      const dz = other.position.z - bot.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > SIGHT_RANGE || dist >= bestD) continue;
      // Field of view, unless very close.
      if (dist > 6) {
        const ang = Math.atan2(-dx, -dz);
        let diff = ang - bot.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) > SIGHT_HALF_ANGLE) continue;
      }
      _from.copy(eyeOf(bot));
      _to.copy(eyeOf(other));
      if (!hooks.losClear(_from, _to)) continue;
      best = other;
      bestD = dist;
    }
    return best;
  }

  function think(bot, now, fighters, random) {
    if (!bot.alive) return;
    const seen = visibleEnemy(bot, now, fighters);
    if (seen) {
      if (bot.target !== seen) {
        bot.target = seen;
        bot.engagedAt = now;
        bot.reactAt = now + REACT_MIN + random() * REACT_SPREAD;
        bot.burstLeft = 0;
      }
      bot.state = 'engage';
      bot.planting = false;
      bot.defusing = false;
      return;
    }
    bot.target = null;
    bot.planting = false;
    bot.defusing = false;

    // Bomb planted: defenders converge on the site and defuse.
    if (hooks.bombPlanted() && bot.team === 'def') {
      const site = hooks.bombSite();
      const siteNode = site === 'A' ? 14 : 18;
      const dx = bot.position.x - (site === 'A' ? -20 : 20);
      const dz = bot.position.z + 9;
      if (Math.hypot(dx, dz) < 3) {
        bot.state = 'defusing';
        bot.defusing = true;
        return;
      }
      bot.state = 'route';
      routeTo(bot, siteNode);
      return;
    }

    // Attackers: carrier goes to its site and plants; others push and hold.
    if (bot.team === 'atk') {
      const siteNode = bot.assignedSite === 'A' ? 14 : 18;
      const siteX = bot.assignedSite === 'A' ? -20 : 20;
      const distSite = Math.hypot(bot.position.x - siteX, bot.position.z + 9);
      if (bot.carrying && distSite < 4.5) {
        bot.state = 'planting';
        bot.planting = true;
        return;
      }
      if (distSite < 3.5) {
        bot.state = 'hold';
        bot.holdUntil = now + 2 + random() * 2;
        bot.holdYaw = bot.yaw + (random() - 0.5) * 1.6;
        return;
      }
      bot.state = 'route';
      routeTo(bot, siteNode);
      return;
    }

    // Defenders: hold near their site, rotate on noise.
    if (bot.investigateUntil > now) {
      bot.state = 'route';
      routeTo(bot, bot.investigateNode);
      return;
    }
    const holdNode = bot.assignedSite === 'A' ? 23 : bot.assignedSite === 'B' ? 24 : 25;
    const hold = world.nodes[holdNode];
    if (Math.hypot(bot.position.x - hold.x, bot.position.z - hold.z) > 1.2) {
      bot.state = 'route';
      routeTo(bot, holdNode);
      return;
    }
    bot.state = 'hold';
    if (now > bot.holdUntil) {
      bot.holdUntil = now + 2 + random() * 3;
      bot.holdYaw = bot.yaw + (random() - 0.5) * 2.4;
    }
  }

  function faceToward(bot, tx, tz, dt, rate = 6) {
    const want = Math.atan2(-(tx - bot.position.x), -(tz - bot.position.z));
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
  }

  function fireAt(bot, now, random) {
    const target = bot.target;
    if (!target || !target.alive) return;
    const def = ARSENAL[bot.weapon];
    if (now < bot.nextShotAt) return;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(random() * 3);
      bot.nextShotAt = now + 0.55 + random() * 0.4;
      return;
    }
    bot.burstLeft -= 1;
    bot.nextShotAt = now + (bot.weapon === 'wasp' ? 0.09 : 0.12);
    _from.set(bot.position.x, bot.position.y + 1.35, bot.position.z);
    _fwd.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    _from.addScaledVector(_fwd, 0.5);
    // Aim error shrinks the longer the bot has held the target.
    const held = now - bot.engagedAt;
    const err = 0.35 * Math.exp(-0.9 * held) + 0.12;
    _to.set(
      target.position.x + (random() * 2 - 1) * err,
      target.position.y + 1.2 + (random() * 2 - 1) * err,
      target.position.z + (random() * 2 - 1) * err,
    );
    hooks.shotFired(bot, _from, _to, def.sound);
    // Hit roll: distance, target speed, target crouch all matter.
    const dist = Math.hypot(target.position.x - bot.position.x, target.position.z - bot.position.z);
    const falloff = Math.max(0.25, 1.15 - dist / 45);
    const targetSpeed = target.kind === 'player' ? hooks.playerSpeed() : BOT_SPEED * 0.7;
    const moving = targetSpeed > 1.5 ? 0.7 : 1;
    const crouched = target.crouching ? 0.8 : 1;
    const movingBot = bot.state === 'route' ? 0.7 : 1;
    const p = 0.52 * falloff * moving * crouched * movingBot;
    if (random() < p) {
      const head = random() < 0.12;
      hooks.damageFighter(target, def.damage * (head ? def.headMult : 1), head ? 'head' : 'torso', bot);
    }
  }

  function step(bot, dt, now, random, canFight) {
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.08;
      }
      return;
    }
    bot.group.position.copy(bot.position);
    if (bot.state === 'engage' && bot.target && bot.target.alive) {
      faceToward(bot, bot.target.position.x, bot.target.position.z, dt, 8);
      if (canFight && now >= bot.reactAt) fireAt(bot, now, random);
    } else if (bot.state === 'route' && bot.path.length) {
      const node = world.nodes[bot.path[bot.pathIndex]];
      const dx = node.x - bot.position.x;
      const dz = node.z - bot.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.7) {
        bot.pathIndex += 1;
        if (bot.pathIndex >= bot.path.length) bot.path = [];
      } else {
        faceToward(bot, node.x, node.z, dt, 6);
        bot.position.x += (-Math.sin(bot.yaw)) * bot.speed * dt;
        bot.position.z += (-Math.cos(bot.yaw)) * bot.speed * dt;
      }
    } else if (bot.state === 'hold') {
      let diff = bot.holdYaw - bot.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      bot.yaw += Math.max(-2 * dt, Math.min(2 * dt, diff));
    }
    // Gentle separation so bots never stand inside each other.
    bot.group.rotation.y = bot.yaw;
    bot.group.position.copy(bot.position);
  }

  function hearNoise(pos, now) {
    for (const bot of bots) {
      if (!bot.alive || bot.team !== 'def' || bot.state === 'engage') continue;
      const d = Math.hypot(bot.position.x - pos.x, bot.position.z - pos.z);
      if (d < 22) {
        bot.investigateNode = nearestNode(world.nodes, pos);
        bot.investigateUntil = now + 6;
      }
    }
  }

  return {
    bots,
    spawnAll(spawns, random) {
      bots.length = 0;
      makeBot('atk', 0, spawns.atk[1], 'wasp');
      makeBot('atk', 1, spawns.atk[2], 'falcon');
      makeBot('def', 0, spawns.def[0], 'falcon');
      makeBot('def', 1, spawns.def[1], 'falcon');
      makeBot('def', 2, spawns.def[2], 'wasp');
    },
    resetRound(spawns, random) {
      const order = [spawns.atk[1], spawns.atk[2], spawns.def[0], spawns.def[1], spawns.def[2]];
      bots.forEach((bot, i) => resetBot(bot, order[i], random));
    },
    hitMeshes() {
      const meshes = [];
      for (const bot of bots) meshes.push(bot.torso, bot.head);
      return meshes;
    },
    thinkAll(now, fighters, random) {
      for (const bot of bots) {
        if (now >= bot.thinkAt) {
          bot.thinkAt = now + THINK_EVERY;
          think(bot, now, fighters, random);
        }
      }
    },
    stepAll(dt, now, random, canFight = true) {
      for (const bot of bots) step(bot, dt, now, random, canFight);
      // Separation pass.
      for (let i = 0; i < bots.length; i += 1) {
        for (let j = i + 1; j < bots.length; j += 1) {
          const a = bots[i];
          const b = bots[j];
          if (!a.alive || !b.alive) continue;
          const dx = b.position.x - a.position.x;
          const dz = b.position.z - a.position.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.01 && d < 0.9) {
            const push = (0.9 - d) / 2;
            const nx = dx / d;
            const nz = dz / d;
            a.position.x -= nx * push;
            a.position.z -= nz * push;
            b.position.x += nx * push;
            b.position.z += nz * push;
          }
        }
      }
    },
    hearNoise,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    carrier() {
      return bots.find((b) => b.carrying && b.alive) ?? null;
    },
  };
}
