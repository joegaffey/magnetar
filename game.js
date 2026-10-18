import { SteeringInput } from './input.js?v=20261018al';
import { AudioEngine } from './audio.js?v=20261018al';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const hintEl = document.querySelector('.hint');
const sourceEl = document.getElementById('source');
const healthEl = document.getElementById('health');
const massEl = document.getElementById('mass');
const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');
const ffbEl = document.getElementById('ffb');
const wheelSettingsBtn = document.getElementById('wheelSettingsBtn');
const connectButton = document.getElementById('connectButton');
const wheelChip = document.getElementById('wheelChip');
const wheelSettingsGroup = document.getElementById('wheelSettingsGroup');
const disconnectButton = document.getElementById('disconnectButton');
const webHidSupported = !!(navigator.hid && navigator.hid.requestDevice);
const ffbStrengthInput = document.getElementById('ffbStrength');
const ffbStrengthVal = document.getElementById('ffbStrengthVal');
const wheelRangeInput = document.getElementById('wheelRange');
const wheelRangeVal = document.getElementById('wheelRangeVal');
const muteToggle = document.getElementById('muteToggle');
const volumeInput = document.getElementById('volume');
const volumeVal = document.getElementById('volumeVal');
const musicInput = document.getElementById('music');
const musicVal = document.getElementById('musicVal');
const settingsModal = document.getElementById('settingsModal');
const settingsClose = document.getElementById('settingsClose');
const touchSensitivityInput = document.getElementById('touchSensitivity');
const touchSensitivityVal = document.getElementById('touchSensitivityVal');

let W = 0, H = 0, CX = 0, CY = 0, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  CX = W / 2;
  CY = H / 2;
}
resize();
window.addEventListener('resize', resize);

// magnet
const BAR_HALF = 85;
const POLE_R = 22;             // surface-contact catch radius
const POLE_BODY_R = 10;        // physical pole radius (orb-like)
const BOUNCE = 0.85;
const ATTRACT_R = 150;
const POLE_INNER_REACH = BAR_HALF - POLE_R; // pole pull fades to zero inside this radius
const PULL = 550;
const REPEL = 0.75;            // opposite pole push
const REPEL_RANGE = ATTRACT_R * 1.2;
const K_TORQUE = 170;
const D_TORQUE = 17;
const BASE_I = 1.0;
const ORB_MASS = 0.11;
const MAX_STUCK = 14;
const SHED_ACCEL = 5200;       // w^2 * r threshold for centrifugal shed
const SHED_INTERVAL = 0.12;    // seconds between shed orbs
const CORE_R = 20;
const CORE_PULL = 275;         // acceleration of free orbs toward the core (all orbs)
const ORB_DRAG = 1.1;          // linear drag on free orbs (1/s)
const MAX_ORB_SPEED = 340;
const FFB_DEADZONE = 0.05;
const EDGE_GLOW_OFFSET = 16;    // glow centre sits this far outside the screen edge

// overload / hard contacts
const OVERSPEED_LOAD_THRESHOLD = 550; // pole-tip speed (px/s) that builds overload
const OVERLOAD_RISE_TIME = 3.5;       // seconds of sustained over-speed to overload
const OVERLOAD_DECAY_TIME = 1.5;      // seconds to bleed off when slowed (faster than rise)
const OVERLOAD_SPIN_DAMP = 0.5;       // spin multiplier after a hard impact
const OVERLOAD_DRAIN = 5;             // core health lost per second at full overload
const OVERSPEED_VOLATILE_DAMAGE = 12; // base core damage, scaled by over-speed
const OVERSPEED_REGULAR_DAMAGE = 8;
const HARD_IMPACT_R = 55;
const HARD_IMPACT_FORCE = 320;

// waves
const WAVE_TIME = 35;
const WAVE_LULL = 3;
const WAVE_BANNER_TIME = 1.8;
const WAVE_SCORE_BASE = 5;
const WAVE_SCORE_PER = 2;
const WAVE_MODIFIERS = {
  normal: { label: 'NORMAL', spawn: 1, speed: 1, count: 1 },
  fast: { label: 'FAST ORBS', spawn: 1.15, speed: 1.3, count: 1 },
  volatile: { label: 'VOLATILE', spawn: 1.1, speed: 1, count: 1, volatileChance: 0.4 },
  swarm: { label: 'SWARM', spawn: 1.8, speed: 0.8, count: 3 },
  polarity: { label: 'POLARITY', spawn: 1, speed: 1, count: 1, alternating: true },
  heavy: { label: 'HEAVY ORBS', spawn: 1.2, speed: 0.9, count: 1, energy: 1.5 }
};
const WAVE_ORDER = ['normal', 'fast', 'volatile', 'swarm', 'polarity', 'heavy'];

// polarity / absorption
const POLARITY = true;
const ORB_SIZE = 8;            // render radius while stuck
const ABSORB_TIME = 4.0;       // seconds for a stuck orb to be absorbed
const HEAL_PER_ORB = 4.0;      // total health restored per absorbed orb

// volatile
const VOLATILE_CHANCE = 0.18;
const EXPLOSION_R = 95;
const EXPLOSION_FORCE = 850;
const EXPLOSION_TORQUE = 5;
const EXPLOSION_DAMAGE = 12;

const storedTouchSensitivity = parseFloat(localStorage.getItem('magnetar-touch-sensitivity'));
const initialTouchSensitivity = Number.isFinite(storedTouchSensitivity)
  ? Math.max(0.35, Math.min(1, storedTouchSensitivity))
  : 1;

const input = new SteeringInput({
  keyRate: 540,
  mouseRange: 540,
  touchSensitivity: initialTouchSensitivity
});
const audio = new AudioEngine();

let magnet = { phi: 0, omega: 0 };
let stuck = [];
let orbs = [];
let explosions = [];
let particles = [];
let health = 100, score = 0, caught = 0, exploded = 0;
let streak = 0;
let spawnTimer = 0;
let wave = 1, waveTimer = 0, wavePhase = 'active', waveLull = 0, runTime = 0;
let waveModifier = 'normal', waveNextModifier = null, wavePolFlip = 0;
let waveBanner = null;
let running = false, over = false, paused = false;
let shedCooldown = 0;
let spinLoad = 0;
let jolt = 0, joltDir = 0, joltForce = 0;
let audioAccum = 0;
let connectingWheel = false;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const panOf = (x) => clamp((x - CX) / (W / 2), -1, 1) * 0.8;

// pre-rendered glow sprites (cheap neon bloom)
const glowCache = new Map();
function glowSprite(color) {
  if (glowCache.has(color)) return glowCache.get(color);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, color);
  grd.addColorStop(0.35, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

function drawGlow(x, y, radius, color, alpha = 1) {
  const s = glowSprite(color);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.drawImage(s, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function spawnParticles(x, y, color, n, speed, sizeScale = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const s = speed * rand(0.2, 1);
    const life = rand(0.25, 0.6);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: rand(1.5, 3) * sizeScale });
  }
}

function reset() {
  magnet = { phi: 0, omega: 0 };
  stuck = []; orbs = []; explosions = []; particles = []; streams = []; streamTimer = 0;
  health = 100; score = 0; caught = 0; exploded = 0; streak = 0;
  wave = 1; waveTimer = 0; wavePhase = 'active'; waveLull = 0; runTime = 0;
  waveModifier = 'normal'; waveNextModifier = null; wavePolFlip = 0;
  waveBanner = null; spawnTimer = 0;
  running = true; over = false; shedCooldown = 0; spinLoad = 0; jolt = 0; joltForce = 0;
  input.reset();
  audio.init();
  audio.setMusicIntensity(0.2);
  beginWave(1);
  overlay.classList.add('hidden');
  syncHud();
}

overlay.querySelector('button').addEventListener('click', () => reset());
document.getElementById('restartButton').addEventListener('click', () => reset());

function inertia() {
  return BASE_I + stuck.reduce((a, o) => a + o.mass, 0);
}

function syncHud() {
  healthEl.textContent = Math.max(0, Math.round(health));
  massEl.textContent = inertia().toFixed(2);
  scoreEl.textContent = score;
  if (waveEl) waveEl.textContent = wave;
  sourceEl.textContent = input.source + (input.ffbActive ? ' + FFB' : '');
}

function gameOver() {
  over = true; running = false;
  input.stopFfb();
  audio.gameOver();
  audio.setMusicIntensity(0.12);
  audio.setTransfer(0);
  audio.setMass(1);
  overlay.querySelector('h2').textContent = 'Core breached';
  overlay.querySelector('p').textContent = 'Score: ' + score + ' · wave ' + wave + ' · caught ' + caught + ' · unstable ' + exploded + '.';
  overlay.classList.remove('hidden');
  overlay.querySelector('button').textContent = 'Restart';
  syncHud();
}

function poleWorld(sign) {
  const ang = magnet.phi;
  return { x: CX + Math.cos(ang) * BAR_HALF * sign, y: CY + Math.sin(ang) * BAR_HALF * sign };
}

const poles = () => [
  { p: poleWorld(1), aff: 0 },
  { p: poleWorld(-1), aff: 1 }
];

function waveBaseInterval() {
  return Math.max(0.45, 1.6 - runTime * 0.0055);
}

function waveBaseSpeed() {
  return 35 + Math.min(runTime * 0.85, 170);
}

function modifierLabel(name) {
  return (WAVE_MODIFIERS[name] || WAVE_MODIFIERS.normal).label;
}

function getWaveModifier(n) {
  if (n <= WAVE_ORDER.length) return WAVE_ORDER[n - 1];
  let next;
  do {
    next = WAVE_ORDER[Math.floor(Math.random() * WAVE_ORDER.length)];
  } while (next === waveModifier);
  return next;
}

function spawnWaveInterval() {
  const mod = WAVE_MODIFIERS[waveModifier] || WAVE_MODIFIERS.normal;
  return Math.max(0.35, waveBaseInterval() * (mod.spawn || 1));
}

function beginWave(n) {
  wave = n;
  waveModifier = waveNextModifier || getWaveModifier(n);
  waveNextModifier = null;
  waveTimer = 0;
  wavePhase = 'active';
  waveLull = 0;
  wavePolFlip = 0;
  spawnTimer = 0.7;
  waveBanner = {
    title: 'WAVE ' + n,
    subtitle: modifierLabel(waveModifier),
    life: WAVE_BANNER_TIME,
    max: WAVE_BANNER_TIME
  };
  audio.wave();
  syncHud();
}

function endWave() {
  const bonus = WAVE_SCORE_BASE + wave * WAVE_SCORE_PER;
  score += bonus;
  wavePhase = 'lull';
  waveLull = WAVE_LULL;
  spawnTimer = Infinity;
  waveNextModifier = getWaveModifier(wave + 1);
  waveBanner = {
    title: 'WAVE ' + wave + ' COMPLETE',
    subtitle: '+' + bonus + ' \u00b7 NEXT: ' + modifierLabel(waveNextModifier),
    life: WAVE_LULL,
    max: WAVE_LULL
  };
  syncHud();
}

function spawnWaveOrbs() {
  const mod = WAVE_MODIFIERS[waveModifier] || WAVE_MODIFIERS.normal;
  const speed = waveBaseSpeed() * (mod.speed || 1);
  const energy = mod.energy || 1;
  const count = mod.count || 1;
  for (let k = 0; k < count; k++) {
    let pol = null;
    if (mod.alternating) {
      pol = wavePolFlip;
      wavePolFlip = 1 - wavePolFlip;
    }
    spawnOrb({ speed, energy, pol, volatileChance: mod.volatileChance });
  }
}

function spawnOrb({ speed = null, energy = 1, pol = null, volatileChance = VOLATILE_CHANCE } = {}) {
  const a = Math.random() * TAU;
  const ux = Math.cos(a), uy = Math.sin(a);
  const lead = 60;
  const r = Math.min(
    (W / 2 + lead) / Math.max(Math.abs(ux), 0.0001),
    (H / 2 + lead) / Math.max(Math.abs(uy), 0.0001)
  );
  const x = CX + ux * r;
  const y = CY + uy * r;
  const orbSpeed = speed === null ? waveBaseSpeed() : speed;
  orbs.push({
    x, y,
    vx: -ux * orbSpeed,
    vy: -uy * orbSpeed,
    r: 12 * Math.sqrt(energy),
    pol: pol === null ? (Math.random() < 0.5 ? 0 : 1) : pol,
    volatile: Math.random() < volatileChance,
    energy, noCatch: 0
  });
}

function explode(x, y, big = false) {
  const scale = big ? 1.8 : 1;
  audio.explode(scale, panOf(x));
  explosions.push({ x, y, life: 0.45, max: 0.45, scale });
  const n = Math.max(1, Math.round(scale));
  spawnParticles(x, y, '#fff2d0', 12 * n, 560, 0.8);
  spawnParticles(x, y, '#ffb070', 20 * n, 480, 1.2);
  spawnParticles(x, y, '#ff5a5f', 16 * n, 360, 1);
  const R = EXPLOSION_R * scale;
  for (const o of orbs) {
    const dx = o.x - x, dy = o.y - y;
    const d = Math.hypot(dx, dy);
    if (d < R && d > 0.001) {
      const f = EXPLOSION_FORCE * (1 - d / R);
      o.vx += (dx / d) * f;
      o.vy += (dy / d) * f;
    }
  }
  magnet.omega += (x >= CX ? 1 : -1) * EXPLOSION_TORQUE * scale;
  if (Math.hypot(x - CX, y - CY) < R * 0.6) health -= EXPLOSION_DAMAGE;
  exploded++;
}

function powerBurst(x, y, pol) {
  health = Math.min(100, health + HEAL_PER_ORB * 3);
  audio.burst(panOf(x));
  score += 1;
  streak++;
  audio.score(panOf(x), streak);
  exploded++;
  explosions.push({ x, y, life: 0.45, max: 0.45, scale: 1.2 });
  spawnParticles(x, y, '#fff2d0', 14, 520, 0.8);
  spawnParticles(x, y, ORB_COLORS[pol], 18, 460, 1.1);
  spawnParticles(x, y, '#57d38c', 12, 360, 1);
  const R = EXPLOSION_R * 1.2;
  for (const o of orbs) {
    const dx = o.x - x, dy = o.y - y;
    const d = Math.hypot(dx, dy);
    if (d < R && d > 0.001) {
      const f = EXPLOSION_FORCE * (1 - d / R);
      o.vx += (dx / d) * f;
      o.vy += (dy / d) * f;
    }
  }
  magnet.omega += (x >= CX ? 1 : -1) * EXPLOSION_TORQUE;
}

function hardCatch(orb) {
  const poleSpeed = Math.abs(magnet.omega) * BAR_HALF;
  const over = clamp((poleSpeed - OVERSPEED_LOAD_THRESHOLD) / 350, 0, 1);
  streak = 0;
  jolt = 0.12;
  joltDir = Math.sign(orb.x - CX) || 1;
  joltForce = 0.9;

  if (orb.volatile) {
    explode(orb.x, orb.y, false);
    health -= OVERSPEED_VOLATILE_DAMAGE * (1 + over);
  } else {
    hardImpact(orb);
    health -= OVERSPEED_REGULAR_DAMAGE * (1 + over);
  }
  audio.damage(panOf(orb.x));
  magnet.omega *= OVERLOAD_SPIN_DAMP;
  spinLoad *= 0.5;
}

function hardImpact(orb) {
  for (const o of orbs) {
    if (o === orb) continue;
    const dx = o.x - orb.x, dy = o.y - orb.y;
    const d = Math.hypot(dx, dy);
    if (d < HARD_IMPACT_R && d > 0.001) {
      const f = HARD_IMPACT_FORCE * (1 - d / HARD_IMPACT_R);
      o.vx += (dx / d) * f;
      o.vy += (dy / d) * f;
    }
  }
  explosions.push({ x: orb.x, y: orb.y, life: 0.25, max: 0.25, scale: 0.55 });
  spawnParticles(orb.x, orb.y, '#fff2d0', 10, 420, 0.8);
  spawnParticles(orb.x, orb.y, ORB_COLORS[orb.pol], 12, 360, 1);
}

function catchOrb(orb) {
  if (spinLoad >= 1) { hardCatch(orb); return; }
  if (orb.volatile) { powerBurst(orb.x, orb.y, orb.pol); return; }
  if (stuck.length >= MAX_STUCK) shedOne(0, true);
  const energy = orb.energy !== undefined ? orb.energy : 1;
  const dx = orb.x - CX, dy = orb.y - CY;
  const c = Math.cos(-magnet.phi), s = Math.sin(-magnet.phi);
  stuck.push({ lx: dx * c - dy * s, ly: dx * s + dy * c, mass: ORB_MASS * energy, pol: orb.pol, size: ORB_SIZE * energy });
  caught++;
  score += 1;
  streak++;
  audio.score(panOf(orb.x), streak);
  spawnParticles(orb.x, orb.y, ORB_COLORS[orb.pol], 12, 220);
  audio.catch(panOf(orb.x));
  jolt = 0.09;
  joltDir = Math.sign(orb.x - CX) || 1;
  joltForce = 0.8;
}

function collidePoles(o) {
  let hit = false;
  for (const sign of [1, -1]) {
    const p = poleWorld(sign);
    let dx = o.x - p.x, dy = o.y - p.y;
    let d = Math.hypot(dx, dy);
    const R = POLE_BODY_R + o.r;
    if (d >= R) continue;
    if (d < 0.001) { dx = 1; dy = 0; d = 0.001; }
    const nx = dx / d, ny = dy / d;

    o.x = p.x + nx * R;
    o.y = p.y + ny * R;
    const vn = o.vx * nx + o.vy * ny;
    if (vn < 0) {
      o.vx -= (1 + BOUNCE) * vn * nx;
      o.vy -= (1 + BOUNCE) * vn * ny;
      const impact = -vn;
      jolt = Math.min(0.12, 0.03 + impact / 1400);
      joltDir = Math.sign(nx) || 1;
      joltForce = clamp(0.25 + impact / 1200, 0.25, 0.7);
      spawnParticles(p.x + nx * POLE_BODY_R, p.y + ny * POLE_BODY_R, '#cfe0ff', 6, 160);
      audio.thunk(panOf(p.x), clamp(impact / 300, 0.3, 1.2));
      audio.hit(panOf(p.x), clamp(impact / 400, 0.4, 1));
    }
    hit = true;
  }
  return hit;
}

function shedOne(index, quiet) {
  const o = stuck[index];
  if (!o) return;
  const c = Math.cos(magnet.phi), s = Math.sin(magnet.phi);
  const wx = CX + o.lx * c - o.ly * s;
  const wy = CY + o.lx * s + o.ly * c;
  const rx = wx - CX, ry = wy - CY;
  const len = Math.hypot(rx, ry) || 1;
  const tx = -magnet.omega * ry;
  const ty = magnet.omega * rx;
  let vx = tx * 0.6 + (rx / len) * 80;
  let vy = ty * 0.6 + (ry / len) * 80;
  const sp = Math.hypot(vx, vy) || 1;
  const cap = 180;
  if (sp > cap) { vx = vx / sp * cap; vy = vy / sp * cap; }
  const energy = clamp(o.size / ORB_SIZE, 0.15, 1);
  orbs.push({
    x: wx, y: wy, vx, vy,
    r: 6 + 6 * energy,
    pol: o.pol, volatile: false, energy, noCatch: 0.25
  });
  stuck.splice(index, 1);
  if (!quiet) {
    spawnParticles(wx, wy, ORB_COLORS[o.pol], 10, 260);
  }
}

function step(dt) {
  input.update(dt);
  updateStreams(dt);
  if (!running) return;

  const target = input.angle * Math.PI / 180;
  const I = inertia();
  const torque = K_TORQUE * (target - magnet.phi) - D_TORQUE * magnet.omega;
  magnet.omega += (torque / I) * dt;
  magnet.phi += magnet.omega * dt;

  const poleSpeed = Math.abs(magnet.omega) * BAR_HALF;
  if (poleSpeed > OVERSPEED_LOAD_THRESHOLD) {
    spinLoad = Math.min(1, spinLoad + dt / OVERLOAD_RISE_TIME);
  } else {
    spinLoad = Math.max(0, spinLoad - dt / OVERLOAD_DECAY_TIME);
  }
  if (spinLoad >= 1) {
    health -= OVERLOAD_DRAIN * dt;
    if (health <= 0) { health = 0; gameOver(); return; }
  }

  // stuck orbs are slowly absorbed: shrink, feed particles to the core, heal
  for (let i = stuck.length - 1; i >= 0; i--) {
    const o = stuck[i];
    const ds = Math.min(o.size, (ORB_SIZE / ABSORB_TIME) * dt);
    o.size -= ds;
    health = Math.min(100, health + (HEAL_PER_ORB / ORB_SIZE) * ds);
    if (Math.random() < ds * 3) spawnStuckEnergy(o);
    if (o.size <= 0.3) stuck.splice(i, 1);
  }

  // --- gradual centrifugal shedding ---
  shedCooldown -= dt;
  if (stuck.length && shedCooldown <= 0) {
    let best = -1, bestR = 0;
    for (let i = 0; i < stuck.length; i++) {
      const r = Math.hypot(stuck[i].lx, stuck[i].ly);
      if (magnet.omega * magnet.omega * r > SHED_ACCEL && r > bestR && movingAway(stuck[i])) { best = i; bestR = r; }
    }
    if (best >= 0) {
      shedOne(best);
      shedCooldown = SHED_INTERVAL;
    }
  }

  waveTimer += dt;
  if (wavePhase === 'active') {
    runTime += dt;
    if (waveTimer >= WAVE_TIME) {
      endWave();
    } else {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnWaveOrbs();
        spawnTimer = spawnWaveInterval();
      }
    }
  } else {
    waveLull -= dt;
    if (waveLull <= 0) beginWave(wave + 1);
  }
  if (waveBanner) {
    waveBanner.life -= dt;
    if (waveBanner.life <= 0) waveBanner = null;
  }

  const ps = poles();

  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    if (o.noCatch > 0) o.noCatch -= dt;
    const coreDist = Math.hypot(o.x - CX, o.y - CY);
    const innerFade = clamp((coreDist - POLE_INNER_REACH) / POLE_R, 0, 1);

    for (const { p, aff } of ps) {
      const dx = o.x - p.x, dy = o.y - p.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const ux = dx / d, uy = dy / d;
      if (aff === o.pol) {
        if (d < ATTRACT_R && innerFade > 0) {
          const f = PULL * (1 - d / ATTRACT_R) * innerFade;
          o.vx -= ux * f * dt;
          o.vy -= uy * f * dt;
        }
        if (d < POLE_R * 3 && Math.random() < dt * 16) {
          spawnEnergyToPole(o.x, o.y, p, o.pol);
        }
      } else if (d < REPEL_RANGE) {
        const f = PULL * REPEL * (1 - d / REPEL_RANGE);
        o.vx += ux * f * dt;
        o.vy += uy * f * dt;
      }
    }

    // core gravity well
    const dxc = CX - o.x, dyc = CY - o.y;
    const dc = Math.hypot(dxc, dyc) || 0.001;
    o.vx += (dxc / dc) * CORE_PULL * dt;
    o.vy += (dyc / dc) * CORE_PULL * dt;
    o.vx -= o.vx * ORB_DRAG * dt;
    o.vy -= o.vy * ORB_DRAG * dt;
    const osp = Math.hypot(o.vx, o.vy);
    if (osp > MAX_ORB_SPEED) { o.vx = o.vx / osp * MAX_ORB_SPEED; o.vy = o.vy / osp * MAX_ORB_SPEED; }

    o.x += o.vx * dt;
    o.y += o.vy * dt;

    if (o.volatile && Math.random() < dt * 18) {
      const life = 0.25 + Math.random() * 0.25;
      particles.push({
        x: o.x, y: o.y,
        vx: -o.vx * 0.15 + (Math.random() - 0.5) * 30,
        vy: -o.vy * 0.15 + (Math.random() - 0.5) * 30,
        life, max: life, color: '#ff7a5a', size: 1 + Math.random() * 1.5
      });
    }

    let didCatch = false;
    for (const { p, aff } of ps) {
      if (aff === o.pol && o.noCatch <= 0 && Math.hypot(o.x - p.x, o.y - p.y) < POLE_R) {
        catchOrb(o);
        orbs.splice(i, 1);
        didCatch = true;
        break;
      }
    }
    if (didCatch) {
      if (health <= 0) { gameOver(); return; }
      continue;
    }

    if (spinLoad >= 1) {
      let contact = false;
      for (const { p } of ps) {
        if (Math.hypot(o.x - p.x, o.y - p.y) < POLE_BODY_R + o.r) { contact = true; break; }
      }
      if (contact) {
        hardCatch(o);
        orbs.splice(i, 1);
        if (health <= 0) { gameOver(); return; }
        continue;
      }
    }

    if (collidePoles(o)) continue;

    if (Math.hypot(o.x - CX, o.y - CY) < CORE_R + o.r) {
      streak = 0;
      audio.hit(panOf(o.x), 1.3);
      if (o.volatile) {
        explode(o.x, o.y, true);
        health -= 24;
      } else {
        const energy = o.energy !== undefined ? o.energy : 1;
        health -= 8 * energy;
        spawnParticles(o.x, o.y, '#ff5a5f', 14, 240);
        audio.damage(panOf(o.x));
      }
      orbs.splice(i, 1);
      if (health <= 0) { gameOver(); return; }
      continue;
    }

    if (Math.abs(o.x - CX) > W || Math.abs(o.y - CY) > H) orbs.splice(i, 1);
  }

  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].life -= dt;
    if (explosions[i].life <= 0) explosions.splice(i, 1);
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.97; p.vy *= 0.97;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  syncHud();
  updateFfb(dt);
}

let last = performance.now(), acc = 0, ffbAccum = 0;
const STEP = 1 / 120;

function frame(now) {
requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (paused) { render(); return; }
  acc += dt;
  while (acc >= STEP) { step(STEP); acc -= STEP; }
  updateAudio(dt);
  render();
}

function updateAudio(dt) {
  audioAccum += dt;
  if (audioAccum < 0.06) return;
  audioAccum = 0;
  if (!running) {
    audio.setTransfer(0);
    audio.setMass(1);
    audio.setMusicIntensity(0.15);
    return;
  }
  audio.setMass(inertia());
  audio.setMusicIntensity(clamp(runTime / 180 + (1 - health / 100) * 0.35, 0, 1));
  let near = 0;
  const ps = poles();
  for (const o of orbs) {
    for (const { p, aff } of ps) {
      if (aff !== o.pol) continue;
      if (Math.hypot(o.x - p.x, o.y - p.y) < POLE_R * 3) { near++; break; }
    }
  }
  audio.setTransfer(clamp(stuck.length / 6 + near / 8, 0, 1));
}

function updateFfb(dt) {
  if (!input.ffbActive) { ffbEl.textContent = '—'; return; }
  ffbAccum += dt;
  if (ffbAccum < 1 / 60) return;
  ffbAccum = 0;
  if (!running) { ffbEl.textContent = 'idle'; return; }

  let force = clamp(-magnet.omega * inertia() * 0.06, -1, 1);
  if (jolt > 0) { jolt -= dt; force = joltDir * joltForce; }
  if (Math.abs(force) < FFB_DEADZONE) force = 0;
  ffbEl.textContent = force.toFixed(2);
  input.applyForce(force);
}

const ORB_COLORS = ['#e0a04a', '#7aa7ff'];

let streams = [];
let streamTimer = 0;

function spawnStream() {
  const extra = Math.min(2, Math.floor(stuck.length / 4));
  for (let s = 0; s < 2; s++) {
    const pole = poleWorld(s === 0 ? 1 : -1);
    const dx = pole.x - CX, dy = pole.y - CY;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const color = ORB_COLORS[s];
    for (let k = 0; k < 2 + extra; k++) {
      const f = 0.15 + Math.random() * 0.8;
      const jitter = (Math.random() - 0.5) * 4;
      const drift = 40 + Math.random() * 50;
      const life = 0.4 + Math.random() * 0.4;
      streams.push({
        x: CX + ux * len * f + px * jitter,
        y: CY + uy * len * f + py * jitter,
        vx: -ux * drift + px * (Math.random() - 0.5) * 6,
        vy: -uy * drift + py * (Math.random() - 0.5) * 6,
        tx: CX, ty: CY,
        life, max: life, color, size: 0.8 + Math.random() * 0.8
      });
    }
  }
}

function nearestPole(x, y) {
  const p1 = poleWorld(1), p2 = poleWorld(-1);
  return Math.hypot(x - p1.x, y - p1.y) <= Math.hypot(x - p2.x, y - p2.y) ? p1 : p2;
}

function movingAway(o) {
  const c = Math.cos(magnet.phi), s = Math.sin(magnet.phi);
  const wx = CX + o.lx * c - o.ly * s;
  const wy = CY + o.lx * s + o.ly * c;
  const pole = nearestPole(wx, wy);
  const rx = wx - CX, ry = wy - CY;
  const vx = -magnet.omega * ry;
  const vy = magnet.omega * rx;
  return vx * (wx - pole.x) + vy * (wy - pole.y) > 0;
}

function spawnEnergyToPole(x, y, pole, pol) {
  const dx = pole.x - x, dy = pole.y - y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const life = 0.25 + Math.random() * 0.25;
  streams.push({
    x, y,
    vx: ux * (120 + Math.random() * 80),
    vy: uy * (120 + Math.random() * 80),
    tx: pole.x, ty: pole.y,
    life, max: life, color: ORB_COLORS[pol], size: 1 + Math.random() * 0.8
  });
}

function spawnStuckEnergy(o) {
  const c = Math.cos(magnet.phi), s = Math.sin(magnet.phi);
  const wx = CX + o.lx * c - o.ly * s;
  const wy = CY + o.lx * s + o.ly * c;
  spawnEnergyToPole(wx, wy, nearestPole(wx, wy), o.pol);
}

function updateStreams(dt) {
  streamTimer -= dt;
  if (streamTimer <= 0) { streamTimer = 0.04; spawnStream(); }
  for (let i = streams.length - 1; i >= 0; i--) {
    const p = streams[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.life -= dt;
    const dc = Math.hypot(p.x - p.tx, p.y - p.ty);
    if (p.life <= 0 || dc < 12) streams.splice(i, 1);
  }
}

function renderStreams() {
  for (const p of streams) {
    const a = clamp(p.life / p.max, 0, 1) * 0.7;
    drawGlow(p.x, p.y, p.size * 4, p.color, 0.25 * a);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawBlackHole(t, color) {
  const hp = clamp(health / 100, 0, 1);
  drawGlow(CX, CY, 74, color, 0.35);

  ctx.beginPath(); ctx.arc(CX, CY, 37, -Math.PI / 2, -Math.PI / 2 + TAU * hp);
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();

  ctx.beginPath(); ctx.arc(CX, CY, 22, 0, TAU);
  ctx.fillStyle = '#000'; ctx.fill();
}

function edgeEntryPoint(o) {
  const pad = -EDGE_GLOW_OFFSET;
  const left = pad, right = W - pad, top = pad, bottom = H - pad;
  const dx = CX - o.x, dy = CY - o.y;
  let best = Infinity;
  let edge = null;

  if (o.x < left && dx > 0) {
    const t = (left - o.x) / dx;
    const y = o.y + dy * t;
    if (t > 0 && y >= top && y <= bottom && t < best) { best = t; edge = 'left'; }
  }
  if (o.x > right && dx < 0) {
    const t = (right - o.x) / dx;
    const y = o.y + dy * t;
    if (t > 0 && y >= top && y <= bottom && t < best) { best = t; edge = 'right'; }
  }
  if (o.y < top && dy > 0) {
    const t = (top - o.y) / dy;
    const x = o.x + dx * t;
    if (t > 0 && x >= left && x <= right && t < best) { best = t; edge = 'top'; }
  }
  if (o.y > bottom && dy < 0) {
    const t = (bottom - o.y) / dy;
    const x = o.x + dx * t;
    if (t > 0 && x >= left && x <= right && t < best) { best = t; edge = 'bottom'; }
  }

  if (!Number.isFinite(best)) return null;
  return { x: o.x + dx * best, y: o.y + dy * best, edge };
}

function renderEdgeGlows(t) {
  for (const o of orbs) {
    if (o.x >= 0 && o.x <= W && o.y >= 0 && o.y <= H) {
      if (o.edgeGlow) delete o.edgeGlow;
      continue;
    }

    const hit = edgeEntryPoint(o);
    if (hit) {
      if (o.edgeGlow) {
        o.edgeGlow.x = hit.x;
        o.edgeGlow.y = hit.y;
        o.edgeGlow.edge = hit.edge;
      } else {
        o.edgeGlow = { ...hit, startDist: 0 };
      }
    } else if (!o.edgeGlow) {
      continue;
    }

    const glow = o.edgeGlow;
    const dist = Math.hypot(glow.x - o.x, glow.y - o.y);
    if (!glow.startDist) glow.startDist = Math.max(dist, 1);
    const passed = (o.x - glow.x) * o.vx + (o.y - glow.y) * o.vy >= 0;
    const fade = passed ? 1 : clamp(1 - dist / glow.startDist, 0, 1);
    if (fade <= 0.01) continue;
    drawEdgeGlow(glow, o, t, fade);
  }
}

function drawEdgeGlow(hit, o, t, approach) {
  const volatile = o.volatile;
  const color = volatile ? '#ff5a5f' : ORB_COLORS[o.pol];
  const full = approach >= 1;
  const pulse = full ? 1 : 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(t * (volatile ? 12 : 7) + o.x * 0.05 + o.y * 0.04));
  const alpha = (volatile ? 1 : 0.8) * approach * pulse;

  drawGlow(hit.x, hit.y, volatile ? 72 : 62, color, alpha * 0.55);
  if (volatile) drawGlow(hit.x, hit.y, 50, '#ff5a5f', alpha * 0.5);
  drawGlow(hit.x, hit.y, volatile ? 28 : 24, color, Math.min(1, alpha * 1.2));
}

function drawOverloadEdges(t) {
  if (spinLoad <= 0.03) return;
  const pulse = spinLoad >= 1 ? 0.82 + 0.18 * Math.sin(t * 8) : 1;
  const alpha = spinLoad * 0.58 * pulse;
  const band = Math.min(W, H) * 0.2;
  const stops = (g) => {
    g.addColorStop(0, `rgba(255, 30, 45, ${alpha})`);
    g.addColorStop(0.45, `rgba(255, 30, 45, ${alpha * 0.55})`);
    g.addColorStop(1, 'rgba(255, 30, 45, 0)');
    return g;
  };

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  ctx.fillStyle = stops(ctx.createLinearGradient(0, 0, band, 0));
  ctx.fillRect(0, 0, band, H);
  ctx.fillStyle = stops(ctx.createLinearGradient(W, 0, W - band, 0));
  ctx.fillRect(W - band, 0, band, H);
  ctx.fillStyle = stops(ctx.createLinearGradient(0, 0, 0, band));
  ctx.fillRect(0, 0, W, band);
  ctx.fillStyle = stops(ctx.createLinearGradient(0, H, 0, H - band));
  ctx.fillRect(0, H - band, W, band);

  ctx.restore();
}

function renderWaveBanner() {
  if (!waveBanner) return;
  const age = waveBanner.max - waveBanner.life;
  const fadeIn = clamp(age / 0.22, 0, 1);
  const fadeOut = clamp(waveBanner.life / 0.45, 0, 1);
  const alpha = fadeIn * fadeOut;
  if (alpha <= 0.01) return;

  const y = Math.max(120, H * 0.26);
  const size = Math.round(clamp(Math.min(W, H) * 0.055, 18, 42));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#eaffff';
  ctx.shadowColor = 'rgba(34, 225, 255, .9)';
  ctx.shadowBlur = 18;
  ctx.font = '900 ' + size + 'px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(waveBanner.title, CX, y);
  ctx.fillStyle = '#7dfcff';
  ctx.shadowColor = 'rgba(125, 252, 255, .8)';
  ctx.shadowBlur = 12;
  ctx.font = '800 ' + Math.round(size * 0.52) + 'px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(waveBanner.subtitle, CX, y + size * 0.9);
  ctx.restore();
}

function render() {
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, W, H);

  // faint grid
  ctx.strokeStyle = 'rgba(56, 120, 210, 0.22)';
  ctx.lineWidth = 1;
  const grid = 48;
  const ox = (CX % grid), oy = (CY % grid);
  for (let x = ox; x < W; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = oy; y < H; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const hp = clamp(health / 100, 0, 1);
  const coreColor = hp > 0.5 ? '#57d38c' : (hp > 0.25 ? '#e0a04a' : '#ff5a5f');
  const t = performance.now() / 1000;

  // gravity-well backdrop + faint field rings
  const well = ctx.createRadialGradient(CX, CY, 0, CX, CY, 175);
  well.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
  well.addColorStop(0.45, 'rgba(8, 12, 26, 0.45)');
  well.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = well;
  ctx.beginPath(); ctx.arc(CX, CY, 175, 0, TAU); ctx.fill();

  const p1 = poleWorld(1), p2 = poleWorld(-1);

  // black hole / event horizon
  drawBlackHole(t, coreColor);

  // particle tendrils from the horizon to each pole
  renderStreams();

  // orbs (glow + core); off-screen orbs are represented by edge glows
  for (const o of orbs) {
    if (o.x < 0 || o.x > W || o.y < 0 || o.y > H) continue;
    const col = ORB_COLORS[o.pol];
    drawGlow(o.x, o.y, o.r * 3, col, 0.55);
    ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU);
    ctx.fillStyle = col; ctx.fill();
    if (o.volatile) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 10 + o.x * 0.05);
      drawGlow(o.x, o.y, o.r * 4.5, '#ff5a5f', 0.3 + 0.35 * pulse);
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 6 + pulse * 3, 0, TAU);
      ctx.strokeStyle = 'rgba(255, 90, 95, ' + (0.55 + 0.4 * pulse) + ')';
      ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.42, 0, TAU);
      ctx.fillStyle = '#fff2d0'; ctx.fill();
    }
  }

  // localized edge glows for orbs still outside the viewport
  renderEdgeGlows(t);

  // poles (glowing ends of the wisps)
  const polePulse = 1 + Math.sin(t * 5) * 0.12;
  drawGlow(p1.x, p1.y, 46 * polePulse, ORB_COLORS[0], 0.85);
  drawGlow(p2.x, p2.y, 46 * polePulse, ORB_COLORS[1], 0.85);
  for (const [p, col] of [[p1, ORB_COLORS[0]], [p2, ORB_COLORS[1]]]) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, TAU);
    ctx.fillStyle = col; ctx.fill();
  }

  // overload warning glow
  if (spinLoad > 0.03) {
    const hot = spinLoad >= 1;
    const warn = 0.5 + 0.5 * Math.sin(t * (hot ? 12 : 7));
    for (const p of [p1, p2]) {
      drawGlow(p.x, p.y, 58 + 12 * spinLoad, '#ff2a36', (0.24 + 0.45 * spinLoad) * (0.6 + 0.4 * warn));
      drawGlow(p.x, p.y, 32 + 8 * spinLoad, '#ff5a5f', (0.16 + 0.36 * spinLoad) * (0.6 + 0.4 * warn));
    }
  }

  // stuck orbs
  const c = Math.cos(magnet.phi), s = Math.sin(magnet.phi);
  for (const o of stuck) {
    const wx = CX + o.lx * c - o.ly * s;
    const wy = CY + o.lx * s + o.ly * c;
    const sz = o.size !== undefined ? o.size : ORB_SIZE;
    drawGlow(wx, wy, sz * 2.7, ORB_COLORS[o.pol], 0.6);
    ctx.beginPath(); ctx.arc(wx, wy, sz, 0, TAU);
    ctx.fillStyle = ORB_COLORS[o.pol]; ctx.fill();
  }

  // explosions: hot flash + additive shock rings
  for (const e of explosions) {
    const tt = 1 - e.life / e.max;
    const fade = e.life / e.max;
    const r = EXPLOSION_R * (e.scale || 1) * (0.35 + 0.65 * tt);
    drawGlow(e.x, e.y, r * 1.5, '#ffb070', 0.5 * fade * fade);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255, 170, 110, ' + (0.85 * fade) + ')';
    ctx.lineWidth = 5 * fade + 1;
    ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 240, 220, ' + (0.6 * fade) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.x, e.y, r * 0.7, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // particles (glow + bright core)
  for (const p of particles) {
    const a = clamp(p.life / p.max, 0, 1);
    drawGlow(p.x, p.y, p.size * 3.5, p.color, 0.55 * a);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawOverloadEdges(t);
  renderWaveBanner();
}

function handleWheelDisconnected() {
  input.stopFfb();
  input.wheel = null;
  input.ffbAvailable = false;
  if (input.source === 'wheel') input.source = 'keys';
  statusEl.textContent = 'Keys / mouse / pad ready';
  refreshWheelConnectUI();
  syncHud();
}

async function refreshWheelConnectUI() {
  if (!webHidSupported) {
    connectButton.classList.add('hidden');
    wheelChip.classList.add('hidden');
    wheelSettingsGroup.classList.add('hidden');
    disconnectButton.classList.add('hidden');
    statusEl.textContent = 'Keys / mouse / pad ready';
    if (hintEl) hintEl.textContent = 'gamepad \u00b7 \u2190/\u2192 or A/D \u00b7 mouse \u00b7 touch';
    return;
  }

  if (hintEl) hintEl.textContent = 'wheel \u00b7 gamepad \u00b7 \u2190/\u2192 or A/D \u00b7 mouse \u00b7 touch';
  wheelSettingsGroup.classList.remove('hidden');
  const connected = !!(input.wheel && input.wheel.isConnected);
  if (connected) {
    connectButton.classList.add('hidden');
    connectButton.classList.remove('hero');
    connectButton.disabled = false;
    connectButton.textContent = 'Connect wheel';
    const name = input.wheel.name || 'Wheel';
    const parser = input.wheel.parserName ? ' \u00b7 ' + input.wheel.parserName : '';
    wheelChip.textContent = name;
    wheelChip.title = name + parser;
    wheelChip.classList.remove('hidden');
    disconnectButton.classList.remove('hidden');
    return;
  }

  wheelChip.classList.add('hidden');
  disconnectButton.classList.add('hidden');
  if (connectingWheel) return;

  connectButton.classList.remove('hidden');
  connectButton.disabled = false;
  connectButton.textContent = 'Connect wheel';
  try {
    const devices = await navigator.hid.getDevices();
    connectButton.classList.toggle('hero', devices.length > 0);
  } catch {
    connectButton.classList.remove('hero');
  }
}

connectButton.addEventListener('click', async () => {
  if (!webHidSupported || connectingWheel) return;
  const wasPaused = paused;
  connectingWheel = true;
  pauseGame();
  connectButton.disabled = true;
  connectButton.textContent = 'Connecting\u2026';
  try {
    const dev = await input.connectWheel({
      ffbStrength: parseInt(ffbStrengthInput.value) / 100,
      maxRotation: parseInt(wheelRangeInput.value)
    });
    if (!dev) { statusEl.textContent = 'Connection cancelled'; return; }
    statusEl.textContent = dev.productName + (input.wheel.parserName ? ' \u00b7 ' + input.wheel.parserName : '');
    if (input.wheel && input.wheel.on) input.wheel.on('disconnect', handleWheelDisconnected);
  } catch (err) {
    statusEl.textContent = 'Wheel connection failed';
    console.error(err);
  } finally {
    connectingWheel = false;
    connectButton.textContent = 'Connect wheel';
    connectButton.disabled = false;
    refreshWheelConnectUI();
    syncHud();
    if (!wasPaused) resumeGame();
  }
});

disconnectButton.addEventListener('click', async () => {
  if (!input.wheel) return;
  try { await input.wheel.disconnect(); } catch { /* noop */ }
  handleWheelDisconnected();
});

if (webHidSupported) {
  navigator.hid.addEventListener('connect', () => refreshWheelConnectUI());
  navigator.hid.addEventListener('disconnect', (e) => {
    if (input.wheel && (e.device === input.wheel.device || !input.wheel.isConnected)) {
      handleWheelDisconnected();
    } else {
      refreshWheelConnectUI();
    }
  });
}

function pauseGame() {
  if (paused) return;
  paused = true;
  acc = 0;
  input.stopFfb();
  audio.setTransfer(0);
}

function resumeGame() {
  if (!paused) return;
  paused = false;
  last = performance.now();
}

function openSettings() {
  if (!settingsModal) return;
  settingsModal.classList.remove('hidden');
  pauseGame();
}

function closeSettings() {
  if (!settingsModal) return;
  settingsModal.classList.add('hidden');
  resumeGame();
}

wheelSettingsBtn.addEventListener('click', () => {
  if (!settingsModal) return;
  if (settingsModal.classList.contains('hidden')) openSettings();
  else closeSettings();
});
if (settingsClose) settingsClose.addEventListener('click', closeSettings);
if (settingsModal) {
  settingsModal.addEventListener('click', (e) => {
    if (!e.target.closest('.wheel-panel')) closeSettings();
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsModal && !settingsModal.classList.contains('hidden')) closeSettings();
});
ffbStrengthInput.addEventListener('input', () => {
  ffbStrengthVal.textContent = ffbStrengthInput.value + '%';
  input.setFfbStrength(parseInt(ffbStrengthInput.value) / 100);
});
wheelRangeInput.addEventListener('input', () => {
  wheelRangeVal.textContent = wheelRangeInput.value + '\u00b0';
  input.setMaxRotation(parseInt(wheelRangeInput.value));
});

if (touchSensitivityInput) {
  touchSensitivityInput.value = Math.round(initialTouchSensitivity * 100);
  touchSensitivityVal.textContent = touchSensitivityInput.value + '%';
  touchSensitivityInput.addEventListener('input', () => {
    const v = parseInt(touchSensitivityInput.value, 10) / 100;
    input.setTouchSensitivity(v);
    touchSensitivityVal.textContent = touchSensitivityInput.value + '%';
    localStorage.setItem('magnetar-touch-sensitivity', String(v));
  });
}

const storedMute = localStorage.getItem('magnetar-muted') === '1';
audio.setMuted(storedMute);
muteToggle.checked = storedMute;
muteToggle.addEventListener('change', () => {
  audio.setMuted(muteToggle.checked);
  localStorage.setItem('magnetar-muted', muteToggle.checked ? '1' : '0');
});

const storedVolume = parseFloat(localStorage.getItem('magnetar-volume'));
const initialVolume = Number.isNaN(storedVolume) ? 0.85 : storedVolume;
audio.setVolume(initialVolume);
volumeInput.value = Math.round(initialVolume * 100);
volumeVal.textContent = Math.round(initialVolume * 100);
volumeInput.addEventListener('input', () => {
  const v = parseInt(volumeInput.value) / 100;
  audio.setVolume(v);
  volumeVal.textContent = volumeInput.value;
  localStorage.setItem('magnetar-volume', String(v));
});

const storedMusic = parseFloat(localStorage.getItem('magnetar-music'));
const initialMusic = Number.isNaN(storedMusic) ? 0.55 : storedMusic;
audio.setMusicVolume(initialMusic);
musicInput.value = Math.round(initialMusic * 100);
musicVal.textContent = Math.round(initialMusic * 100);
musicInput.addEventListener('input', () => {
  const v = parseInt(musicInput.value) / 100;
  audio.setMusicVolume(v);
  musicVal.textContent = musicInput.value;
  localStorage.setItem('magnetar-music', String(v));
});

document.addEventListener('visibilitychange', () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend();
  else audio.unlock();
});

const unlockAudio = () => audio.init();
for (const ev of ['pointerdown', 'touchstart', 'touchend', 'pointerup', 'keydown']) {
  window.addEventListener(ev, unlockAudio, { passive: true });
}

canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  input.setPointer(e.clientX - r.left, r.width, 'mouse');
});

function touchPoint(e) {
  const t = e.touches[0] || e.changedTouches[0];
  if (!t) return null;
  const r = canvas.getBoundingClientRect();
  return { x: t.clientX - r.left, width: r.width, id: t.identifier };
}
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const p = touchPoint(e);
  if (p) input.touchStart(p.x, p.width, p.id);
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const p = touchPoint(e);
  if (p) input.touchMove(p.x, p.width, p.id);
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  input.touchEnd(t ? t.identifier : null);
}, { passive: false });
canvas.addEventListener('touchcancel', (e) => {
  const t = e.changedTouches[0];
  input.touchEnd(t ? t.identifier : null);
}, { passive: false });

input.reset();
running = false;
syncHud();
refreshWheelConnectUI();
requestAnimationFrame(frame);
