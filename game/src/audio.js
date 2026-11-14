// All sound is synthesized with WebAudio: no audio files, no network, nothing
// to load. One shared noise buffer, one master gain, short envelopes.
let ctx = null;
let master = null;
let noiseBuffer = null;

function ensure() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const length = ctx.sampleRate * 1;
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return ctx;
}

function noiseBurst(duration, filterFreq, gainValue, type = 'lowpass') {
  if (!ensure()) return;
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterFreq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainValue, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start(t, Math.random() * 0.5, duration);
  source.stop(t + duration);
}

function tone(freq, duration, gainValue, type = 'sine', slideTo = 0) {
  if (!ensure()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainValue, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t);
  osc.stop(t + duration);
}

export const audio = {
  unlock() {
    ensure();
  },
  // kind: 'rifle' | 'smg' | 'dmr' | 'pistol' | 'enemy' (distant, quieter)
  shot(kind) {
    if (kind === 'dmr') {
      noiseBurst(0.22, 900, 0.9);
      tone(140, 0.18, 0.5, 'sawtooth', 60);
    } else if (kind === 'smg') {
      noiseBurst(0.09, 1600, 0.55);
    } else if (kind === 'pistol') {
      noiseBurst(0.12, 1200, 0.6);
      tone(220, 0.08, 0.3, 'square', 90);
    } else if (kind === 'enemy') {
      noiseBurst(0.14, 700, 0.28);
    } else {
      noiseBurst(0.14, 1100, 0.75);
      tone(180, 0.1, 0.35, 'sawtooth', 70);
    }
  },
  dryClick() {
    tone(1400, 0.04, 0.25, 'square');
  },
  reload() {
    tone(500, 0.05, 0.2, 'square');
    setTimeout(() => tone(700, 0.05, 0.2, 'square'), 140);
    setTimeout(() => tone(420, 0.06, 0.25, 'square'), 320);
  },
  step() {
    noiseBurst(0.05, 400, 0.1);
  },
  beep(freq = 880) {
    tone(freq, 0.09, 0.3, 'sine');
  },
  plantTick() {
    tone(1200, 0.05, 0.2, 'sine');
  },
  explosion() {
    noiseBurst(1.1, 320, 1.0);
    tone(90, 0.9, 0.7, 'sine', 32);
  },
  sting(win) {
    const notes = win ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((freq, i) => setTimeout(() => tone(freq, 0.28, 0.25, 'triangle'), i * 130));
  },
  hit() {
    tone(2000, 0.04, 0.18, 'sine');
  },
  kill() {
    tone(2000, 0.05, 0.22, 'sine');
    setTimeout(() => tone(2600, 0.07, 0.22, 'sine'), 70);
  },
};
