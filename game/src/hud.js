// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score,
// kill feed, prompts, bomb banner, buy menu and the one overlay panel. It
// never touches the simulation; main.js pushes numbers in and reads the play
// and buy callbacks out. Every setter is guarded so the DOM is only touched
// when a value actually changes.
import { ARSENAL, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';

const COPY = {
  start: {
    title: 'RUSTLINE',
    copy: 'A dusk yard, two bomb sites, three against three. Plant the bomb at A or B — or stop the other team from doing it. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'RUSTLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  dead: {
    title: 'You are down',
    copy: 'Your squad fights on without you.',
    action: 'Keep watching',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const nadeCount = $('nade-count');
  const healthNum = $('health-num');
  const healthFill = $('health-fill');
  const armorNum = $('armor-num');
  const moneyEl = $('money');
  const timerEl = $('timer');
  const roundLabel = $('round-label');
  const scoreAtk = $('score-atk');
  const scoreDef = $('score-def');
  const feed = $('feed');
  const prompt = $('prompt');
  const progress = $('progress');
  const progressFill = $('progress-fill');
  const progressLabel = $('progress-label');
  const banner = $('banner');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const dmg = $('dmg');
  const buy = $('buy');
  const buyMoney = $('buy-money');
  const buyRows = $('buy-rows');

  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastNades = -1;
  let lastHp = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastPrompt = null;
  let lastBanner = null;
  let hitTimer = 0;
  let bannerTimer = 0;
  let buyAction = null;

  // Buy rows are built once from the arsenal; their disabled state refreshes
  // on every buy-menu open.
  const rowEls = {};
  const buyItems = [
    ...Object.entries(ARSENAL).map(([id, def], i) => ({ id, key: String(i + 1), name: def.name, detail: `${def.damage} dmg · ${def.mag} rounds`, price: def.price })),
    { id: 'grenade', key: '5', name: 'HE Grenade', detail: 'Throw with G · 120 max damage', price: GRENADE_PRICE },
    { id: 'armor', key: '6', name: 'Kevlar Vest', detail: 'Absorbs half of each hit · 50 armor', price: ARMOR_PRICE },
  ];
  for (const item of buyItems) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'buy-row';
    row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}<small>${item.detail}</small></span><span class="buy-price">$${item.price}</span>`;
    row.addEventListener('click', () => buyAction && buyAction(item.id));
    buyRows.appendChild(row);
    rowEls[item.id] = row;
  }
  document.getElementById('buy-close').addEventListener('click', () => buyAction && buyAction('close'));

  return {
    setAmmo(mag, reserve, weapon, nades) {
      if (mag === lastMag && reserve === lastReserve && weapon === lastWeapon && nades === lastNades) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = weapon;
      lastNades = nades;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = weapon;
      nadeCount.textContent = nades > 0 ? `◉ ${nades} HE` : '';
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setHealth(hp, armor) {
      const h = Math.max(0, Math.round(hp));
      const a = Math.max(0, Math.round(armor));
      if (h === lastHp && a === lastArmor) return;
      lastHp = h;
      lastArmor = a;
      healthNum.textContent = String(h);
      healthFill.style.width = `${h}%`;
      healthFill.classList.toggle('low', h <= 30);
      armorNum.textContent = a > 0 ? `◈ ${a}` : '';
    },
    setMoney(m) {
      if (m === lastMoney) return;
      lastMoney = m;
      moneyEl.textContent = `$${m}`;
      buyMoney.textContent = `$${m}`;
    },
    setTimer(text, urgent) {
      if (text === lastTimer) return;
      lastTimer = text;
      timerEl.textContent = text;
      timerEl.classList.toggle('urgent', !!urgent);
    },
    setScore(atk, def, round) {
      const text = `${atk}:${def}|${round}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreAtk.textContent = String(atk);
      scoreDef.textContent = String(def);
      roundLabel.textContent = `ROUND ${round}`;
    },
    setSpread(spread) {
      crosshair.style.setProperty('--gap', `${(3 + spread * 380).toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      dmg.classList.add('on');
      setTimeout(() => dmg.classList.remove('on'), 180);
    },
    feed(killer, victim, headshot) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.innerHTML = `<b>${killer}</b> ${headshot ? '◉ ' : ''}→ <b>${victim}</b>`;
      feed.prepend(line);
      while (feed.children.length > 4) feed.removeChild(feed.lastChild);
      setTimeout(() => line.classList.add('fade'), 4200);
      setTimeout(() => line.remove(), 5200);
    },
    showPrompt(text) {
      if (text === lastPrompt) return;
      lastPrompt = text;
      prompt.textContent = text ?? '';
      prompt.hidden = !text;
    },
    showProgress(label, frac) {
      if (frac === null || frac === undefined) {
        progress.hidden = true;
        return;
      }
      progress.hidden = false;
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.round(frac * 100)}%`;
    },
    showBanner(text, ms = 3600) {
      if (text === lastBanner) return;
      lastBanner = text;
      banner.textContent = text ?? '';
      banner.hidden = !text;
      clearTimeout(bannerTimer);
      if (text) bannerTimer = setTimeout(() => { banner.hidden = true; lastBanner = null; }, ms);
    },
    showBuy(open, money, ownedIds, nades) {
      buy.hidden = !open;
      if (!open) return;
      buyMoney.textContent = `$${money}`;
      for (const item of buyItems) {
        const row = rowEls[item.id];
        const owned = item.id === 'grenade' ? nades > 0 : ownedIds.includes(item.id);
        const afford = money >= item.price;
        row.classList.toggle('owned', owned);
        row.classList.toggle('cant', !owned && !afford);
        row.querySelector('.buy-price').textContent = owned ? 'OWNED' : `$${item.price}`;
      }
    },
    isBuyOpen() {
      return !buy.hidden;
    },
    showOverlay(mode, data = {}) {
      if (mode === 'round') {
        title.textContent = data.won ? 'Round won' : 'Round lost';
        copy.textContent = `${data.reason}  Score ${data.score.atk} — ${data.score.def}.`;
        play.textContent = 'Next round';
      } else if (mode === 'match') {
        title.textContent = data.won ? 'Match won' : 'Match lost';
        copy.textContent = `Final score ${data.score.atk} — ${data.score.def}. ${data.won ? 'RUSTLINE is yours.' : 'The yard keeps its secrets.'}`;
        play.textContent = 'Play again';
      } else {
        const text = COPY[mode];
        title.textContent = text.title;
        copy.textContent = text.copy;
        play.textContent = text.action;
      }
      play.style.display = mode === 'dead' ? 'none' : '';
      overlay.hidden = false;
      if (mode !== 'dead') play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyAction = handler;
    },
  };
}
