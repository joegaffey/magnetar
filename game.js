import { SteeringInput } from './input.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const sourceEl = document.getElementById('source');
const healthEl = document.getElementById('health');
const massEl = document.getElementById('mass');
const scoreEl = document.getElementById('score');
const ffbEl = document.getElementById('ffb');

const W = canvas.width, H = canvas.height;
const CX = W / 2, CY = H / 2;

// magnet
const BAR_HALF = 85;      // pole distance from centre
const POLE_R = 52;        // catch radius around each pole
const ATTRACT_R = 150;    // attraction range of a pole
const PULL = 760;         // attraction acceleration at the pole
const K_TORQUE = 170;
const D_TORQUE = 17;
const BASE_I = 1.0;
const ORB_MASS = 0.11;
const MAX_STUCK = 14;
const SHED_OMEGA = 7.0;   // rad/s -> centrifugal shed
const CORE_R = 20;
const FFB_DEADZONE = 0.05;

const input = new SteeringInput({ keyRate: 540, mouseRange: 540 });

let magnet = { phi: 0, omega: 0 };
let stuck = [];          // { lx, ly, mass }
let orbs = [];           // { x, y, vx, vy, r, shed }
let health = 100, score = 0, caught = 0, shedCount = 0;
let difficulty = 0, spawnTimer = 1.0, spawnEvery = 1.6;
let running = false, over = false;
let jolt = 0, joltDir = 0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

function reset() {
  magnet = { phi: 0, omega: 0 };
  stuck = [];
  orbs = [];
  health = 100; score = 0; caught = 0; shedCount = 0;
  difficulty = 0; spawnTimer = 0.9; spawnEvery = 1.6;
  running = true; over = false; jolt = 0;
  input.angle = 0;
  overlay.classList.add('hidden');
  syncHud();
}

function syncHud() {
  healthEl.textContent = Math.max(0, Math.round(health));
  massEl.textContent = inertia().toFixed(2);
  scoreEl.textContent = score;
  sourceEl.textContent = input.source + (input.ffbActive ? ' + FFB' : '');
}

function gameOver() {
  over = true; running = false;
  input.stopFfb();
  overlay.querySelector('h2').textContent = 'Core breached';
  overlay.querySelector('p').textContent = 'Score: ' + score + ' · caught ' + caught + ' · shed ' + shedCount + '.';
  overlay.classList.remove('hidden');
  overlay.querySelector('button').textContent = 'Restart';
}

function inertia() {
  return BASE_I + stuck.reduce((a, o) => a + o.mass, 0);
}

function poleWorld(sign) {
  const ang = magnet.phi;
  return {
    x: CX + Math.cos(ang) * BAR_HALF * sign,
    y: CY + Math.sin(ang) * BAR_HALF * sign
  };
}

function spawnOrb() {
  const a = Math.random() * TAU;
  const r = Math.max(W, H) * 0.62;
  const speed = 55 + Math.min(difficulty * 7, 150);
  orbs.push({
    x: CX + Math.cos(a) * r,
    y: CY + Math.sin(a) * r,
    vx: -Math.cos(a) * speed,
    vy: -Math.sin(a) * speed,
    r: 12,
    shed: false
  });
}

function catchOrb(orb, sign) {
  if (stuck.length >= MAX_STUCK) {
    // hard capacity: eject the oldest as a shed orb
    shedOne(0);
  }
  const dx = orb.x - CX, dy = orb.y - CY;
  const c = Math.cos(-magnet.phi), s = Math.sin(-magnet.phi);
  stuck.push({ lx: dx * c - dy * s, ly: dx * s + dy * c, mass: ORB_MASS });
  caught++;
  score += 1;
  jolt = 0.09;
  joltDir = Math.sign(orb.x - CX) || 1;
}

function shedOne(index) {
  const o = stuck[index];
  if (!o) return;
  const c = Math.cos(magnet.phi), s = Math.sin(magnet.phi);
  const wx = CX + o.lx * c - o.ly * s;
  const wy = CY + o.lx * s + o.ly * c;
  const rx = wx - CX, ry = wy - CY;
  const len = Math.hypot(rx, ry) || 1;
  const tx = -magnet.omega * ry;
  const ty = magnet.omega * rx;
  orbs.push({
    x: wx, y: wy,
    vx: tx * 30 + (rx / len) * 380,
    vy: ty * 30 + (ry / len) * 380,
    r: 11,
    shed: true
  });
  stuck.splice(index, 1);
  shedCount++;
  score += 2;
}

function step(dt) {
  input.update(dt);
  if (!running) return;

  const target = input.angle * Math.PI / 180;
  const I = inertia();
  const torque = K_TORQUE * (target - magnet.phi) - D_TORQUE * magnet.omega;
  magnet.omega += (torque / I) * dt;
  magnet.phi += magnet.omega * dt;

  // centrifugal shedding
  if (Math.abs(magnet.omega) > SHED_OMEGA && stuck.length) {
    for (let i = stuck.length - 1; i >= 0; i--) shedOne(i);
  }

  // escalation
  difficulty += dt;
  spawnEvery = Math.max(0.45, 1.6 - difficulty * 0.012);
  spawnTimer -= dt;
  if (spawnTimer <= 0) { spawnOrb(); spawnTimer = spawnEvery; }

  const poles = [poleWorld(1), poleWorld(-1)];

  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];

    if (!o.shed) {
      // attraction to the nearer pole
      let best = null, bestD = Infinity;
      for (const p of poles) {
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best && bestD < ATTRACT_R) {
        const ux = (best.x - o.x) / (bestD || 1);
        const uy = (best.y - o.y) / (bestD || 1);
        const f = PULL * (1 - bestD / ATTRACT_R);
        o.vx += ux * f * dt;
        o.vy += uy * f * dt;
      }
    }

    o.x += o.vx * dt;
    o.y += o.vy * dt;

    // caught?
    if (!o.shed) {
      for (let s = 0; s < 2; s++) {
        const p = poles[s];
        if (Math.hypot(o.x - p.x, o.y - p.y) < POLE_R) {
          catchOrb(o, s === 0 ? 1 : -1);
          orbs.splice(i, 1);
          break;
        }
      }
      if (!orbs[i] || orbs[i] !== o) continue;
    }

    // core hit
    if (Math.hypot(o.x - CX, o.y - CY) < CORE_R + o.r) {
      health -= o.shed ? 0 : 12;
      orbs.splice(i, 1);
      if (health <= 0) { gameOver(); return; }
      continue;
    }

    // offscreen cleanup
    if (Math.abs(o.x - CX) > W || Math.abs(o.y - CY) > H) {
      orbs.splice(i, 1);
    }
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
  acc += dt;
  while (acc >= STEP) { step(STEP); acc -= STEP; }
  render();
}

function updateFfb(dt) {
  if (!input.ffbActive) { ffbEl.textContent = '—'; return; }
  ffbAccum += dt;
  if (ffbAccum < 1 / 60) return;
  ffbAccum = 0;
  if (!running) { ffbEl.textContent = 'idle'; return; }

  let force = clamp(-magnet.omega * inertia() * 0.06, -1, 1);
  if (jolt > 0) { jolt -= dt; force = joltDir * 0.8; }
  if (Math.abs(force) < FFB_DEADZONE) force = 0;
  ffbEl.textContent = force.toFixed(2);
  input.applyForce(force);
}

function render() {
  ctx.clearRect(0, 0, W, H);

  // core
  const hp = clamp(health / 100, 0, 1);
  ctx.beginPath();
  ctx.arc(CX, CY, CORE_R + 8, 0, TAU);
  ctx.strokeStyle = '#2a3140';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(CX, CY, CORE_R + 8, -Math.PI / 2, -Math.PI / 2 + TAU * hp);
  ctx.strokeStyle = hp > 0.5 ? '#57d38c' : (hp > 0.25 ? '#e0a04a' : '#ff5a5f');
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(CX, CY, CORE_R, 0, TAU);
  ctx.fillStyle = '#11151c';
  ctx.fill();

  // free orbs
  for (const o of orbs) {
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, TAU);
    ctx.fillStyle = o.shed ? '#7aa7ff' : '#e0a04a';
    ctx.fill();
  }

  // magnet bar
  const p1 = poleWorld(1), p2 = poleWorld(-1);
  ctx.strokeStyle = '#c6cfdf';
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  // poles
  for (const p of [p1, p2]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, TAU);
    ctx.fillStyle = '#4f8cff';
    ctx.fill();
  }

  // stuck orbs
  const c = Math.cos(magnet.phi), s = Math.sin(magnet.phi);
  for (const o of stuck) {
    const wx = CX + o.lx * c - o.ly * s;
    const wy = CY + o.lx * s + o.ly * c;
    ctx.beginPath();
    ctx.arc(wx, wy, 8, 0, TAU);
    ctx.fillStyle = '#9dbcff';
    ctx.fill();
  }
}

document.getElementById('connectButton').addEventListener('click', async () => {
  const dev = await input.connectWheel();
  if (!dev) { statusEl.textContent = 'Connection cancelled'; return; }
  statusEl.textContent = dev.productName + (input.wheel.parserName ? ' \u00b7 ' + input.wheel.parserName : '');
  syncHud();
});

document.getElementById('restartButton').addEventListener('click', () => reset());
overlay.querySelector('button').addEventListener('click', () => reset());

canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  input.setPointer(e.clientX - r.left, r.width);
});

input.angle = 0;
syncHud();
requestAnimationFrame(frame);
