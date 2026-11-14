// The arsenal: four guns and a grenade, each with its own numbers. The module
// owns the view model, the magazines and the spread that punishes firing on
// the move; main.js owns the ray and the damage. Headshots deal 4x damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const ARSENAL = {
  p9: { name: 'P9 Sidearm', price: 0, mag: 12, reserve: 48, damage: 26, headMult: 4, fireGap: 0.16, auto: false, reload: 1.3, spreadStill: 0.003, spreadMove: 0.02, kick: 0.006, barrel: 0.22, sound: 'pistol' },
  wasp: { name: 'Wasp PDW', price: 1500, mag: 30, reserve: 120, damage: 22, headMult: 4, fireGap: 0.075, auto: true, reload: 1.7, spreadStill: 0.004, spreadMove: 0.03, kick: 0.005, barrel: 0.3, sound: 'smg' },
  falcon: { name: 'Falcon AR', price: 2700, mag: 30, reserve: 90, damage: 34, headMult: 4, fireGap: 0.096, auto: true, reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, kick: 0.009, barrel: 0.4, sound: 'rifle' },
  heron: { name: 'Heron DMR', price: 4750, mag: 10, reserve: 40, damage: 80, headMult: 4, fireGap: 0.5, auto: false, reload: 2.4, spreadStill: 0.0008, spreadMove: 0.02, kick: 0.016, barrel: 0.55, sound: 'dmr' },
};
export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;

export function createWeapons(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.1), accent);
  sight.position.set(0, 0.075, -0.1);
  model.add(receiver, barrel, stock, sight);
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  // Owned weapons keep their own magazines between rounds; the round refill
  // tops every owned gun back up.
  const owned = {
    p9: { mag: ARSENAL.p9.mag, reserve: ARSENAL.p9.reserve },
    falcon: { mag: ARSENAL.falcon.mag, reserve: ARSENAL.falcon.reserve },
  };
  let current = 'falcon';
  const state = { cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };
  let grenades = 0;

  function def() {
    return ARSENAL[current];
  }
  function magState() {
    return owned[current];
  }

  function rebuildModel() {
    barrel.scale.z = def().barrel / 0.4;
    barrel.position.z = -0.38 - (def().barrel - 0.4) / 2;
    flash.position.z = -0.55 - def().barrel;
  }
  rebuildModel();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const m = magState();
        const need = def().mag - m.mag;
        const take = Math.min(need, m.reserve);
        m.mag += take;
        m.reserve -= take;
      }
    }
  }

  return {
    get current() {
      return current;
    },
    get grenades() {
      return grenades;
    },
    def,
    owned: () => Object.keys(owned),
    state: () => ({ mag: magState().mag, reserve: magState().reserve }),
    step,
    ready() {
      return magState().mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().fireGap;
      state.flash = 0.06;
      state.kick = 0.04 + def().kick;
    },
    takeRound() {
      const m = magState();
      if (m.mag <= 0) return false;
      m.mag -= 1;
      return true;
    },
    reload() {
      const m = magState();
      if (state.reloadLeft > 0 || m.mag === def().mag || m.reserve === 0) return false;
      state.reloadLeft = def().reload;
      return true;
    },
    spread(speed) {
      return def().spreadStill + Math.min(1, speed / 5.2) * def().spreadMove;
    },
    select(id) {
      if (!owned[id] || state.reloadLeft > 0) return false;
      current = id;
      state.cooldown = 0.25;
      rebuildModel();
      return true;
    },
    // Returns the cost, or -1 when the gun is already owned.
    buy(id) {
      if (owned[id]) return -1;
      owned[id] = { mag: ARSENAL[id].mag, reserve: ARSENAL[id].reserve };
      current = id;
      state.cooldown = 0;
      state.reloadLeft = 0;
      rebuildModel();
      return ARSENAL[id].price;
    },
    buyGrenade() {
      if (grenades >= 1) return -1;
      grenades = 1;
      return GRENADE_PRICE;
    },
    throwGrenade() {
      if (grenades <= 0) return false;
      grenades -= 1;
      return true;
    },
    refill() {
      for (const id of Object.keys(owned)) {
        owned[id].mag = ARSENAL[id].mag;
        owned[id].reserve = ARSENAL[id].reserve;
      }
      grenades = 0;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      if (!owned[current]) current = 'falcon';
    },
    resetLoadout() {
      for (const id of Object.keys(owned)) delete owned[id];
      owned.p9 = { mag: ARSENAL.p9.mag, reserve: ARSENAL.p9.reserve };
      owned.falcon = { mag: ARSENAL.falcon.mag, reserve: ARSENAL.falcon.reserve };
      current = 'falcon';
      grenades = 0;
      state.cooldown = 0;
      state.reloadLeft = 0;
    },
  };
}
