// The bomb: carried by the player (or an ally if the player falls), planted
// by holding E inside a site for 3 seconds, 35 seconds to detonation, defused
// by a defender holding at the site for 5 seconds. One state machine, no
// hidden rules; main.js decides the round from its callbacks.
export function createBomb(callbacks) {
  const PLANT_TIME = 3;
  const DEFUSE_TIME = 5;
  const DETONATE_AFTER = 35;

  const bomb = {
    status: 'carried', // carried | planted | exploded | defused
    site: null,
    carrier: null,
    plantProgress: 0,
    defuseProgress: 0,
    plantedAt: 0,
    beepAt: 0,
  };

  return {
    state: bomb,
    reset(carrier) {
      bomb.status = 'carried';
      bomb.site = null;
      bomb.carrier = carrier;
      bomb.plantProgress = 0;
      bomb.defuseProgress = 0;
      bomb.plantedAt = 0;
      bomb.beepAt = 0;
    },
    // now: match clock seconds. planting: the carrier is holding E in a site.
    // defuser: a defender bot at the planted site, or null.
    update(dt, now, planting, plantSite, defuser) {
      if (bomb.status === 'carried') {
        if (planting && plantSite) {
          bomb.plantProgress += dt / PLANT_TIME;
          bomb.site = plantSite;
          if (bomb.plantProgress >= 1) {
            bomb.status = 'planted';
            bomb.plantedAt = now;
            bomb.plantProgress = 1;
            callbacks.onPlanted(bomb.site);
          }
        } else {
          bomb.plantProgress = 0;
          bomb.site = planting ? plantSite : null;
        }
        return;
      }
      if (bomb.status === 'planted') {
        const left = DETONATE_AFTER - (now - bomb.plantedAt);
        const interval = 0.25 + 0.75 * Math.max(0, left / DETONATE_AFTER);
        if (now >= bomb.beepAt) {
          bomb.beepAt = now + interval;
          callbacks.onBeep(left);
        }
        if (defuser) {
          bomb.defuseProgress += dt / DEFUSE_TIME;
          if (bomb.defuseProgress >= 1) {
            bomb.status = 'defused';
            callbacks.onDefused();
          }
        } else {
          bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt / DEFUSE_TIME);
        }
        if (bomb.status === 'planted' && left <= 0) {
          bomb.status = 'exploded';
          callbacks.onExploded();
        }
      }
    },
    timeLeft(now) {
      if (bomb.status !== 'planted') return 0;
      return Math.max(0, DETONATE_AFTER - (now - bomb.plantedAt));
    },
  };
}
