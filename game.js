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
const BAR_HALF = 85;
const POLE_R = 52;
const ATTRACT_R = 150;
const PULL = 760;
const K_TORQUE = 170;
const D_TORQUE = 17;
const BASE_I = 1.0;
const ORB_MASS = 0.11;
const MAX_STUCK = 14;
const SHED_OMEGA = 7.0;
const CORE_R = 20;
const FFB_DEADZONE = 0.05;

// polarity / absorption
const POLARITY = true;         // poles attract their colour, repel the other
const CORE_REGEN = 1.2;        // health per absorbed orb

// overload
const OVERLOAD_MASS = 3.0;     // above this the magnet overheats (no attraction)
const OVERHEAT_VENT = 3.0;     // seconds of continuous overheat before it vents

// volatile orbs
const VOLATILE_CHANCE = 0.18;
const EXPLOSION_R = 95;
const EXPLOSION_FORCE = 850;
const EXPLOSION_TORQUE = 5;
const EXPLOSION_DAMAGE = 7;

const input = new SteeringInput({ keyRate: 540, mouseRange: 540 });

let magnet = { phi: 0, omega: 0 };
let stuck = [];          // { lx, ly, mass, pol }
let orbs = [];           // { x, y, vx, vy, r, pol, volatile, shed }
let explosions = [];     // { x, y, life, max }
let health = 100, score = 0, caught = 0, shedCount = 0, exploded = 0;
let difficulty = 0, spawnTimer = 1.0, spawnEvery = 1.6;
let running = false, over = false;
let overheatTime = 0;
let jolt = 0, joltDir = 0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

function reset() {
  magnet = { phi: 0, omega: 0 };
  stuck = []; orbs = []; explosions = [];
  health = 100; score = 0; caught = 0; shedCount = 0; exploded = 0;
  difficulty = 0; spawnTimer = 0.9; spawnEvery = 1.6;
  running = true; over = false; overheatTime = 0; jolt = 0;
  input.angle = 0;
  overlay.classList.add('hidden');
  syncHud();
}

function inertia() {
  return BASE_I + stuck.reduce((a, o) => a + o.mass, 0);
}

function overheated() {
  return inertia() > OVERLOAD_MASS;
}

function syncHud() {
  healthEl.textContent = Math.max(0, Math.round(health));
  massEl.textContent = inertia().toFixed(2) + (overheated() ? ' !' : '');
  scoreEl.textContent = score;
  sourceEl.textContent = input.source + (input.ffbActive ? ' + FFB' : '');
}

function gameOver() {
  over = true; running = false;
  input.stopFfb();
  overlay.querySelector('h2').textContent = 'Core breached';
  overlay.querySelector('p').textContent = 'Score: ' + score + ' · caught ' + caught + ' · shed ' + shedCount + ' · volatile ' + exploded + '.';
  overlay.classList.remove('hidden');
  overlay.querySelector('button').textContent = 'Restart';
}

function poleWorld(sign) {
  const ang = magnet.phi;
  return { x: CX + Math.cos(ang) * BAR_HALF * sign, y: CY + Math.sin(ang) * BAR_HALF * sign };
}

// pole at +BAR_HALF attracts pol 0 (amber); -BAR_HALF attracts pol 1 (blue)
const poles = () => [
  { p: poleWorld(1), aff: 0 },
  { p: poleWorld(-1), aff: 1 }
];

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
    pol: Math.random() < 0.5 ? 0 : 1,
    volatile: Math.random() < VOLATILE_CHANCE,
    shed: false
  });
}

function explode(x, y) {
  explosions.push({ x, y, life: 0.35, max: 0.35 });
  for (const o of orbs) {
    const dx = o.x - x, dy = o.y - y;
    const d = Math.hypot(dx, dy);
    if (d < EXPLOSION_R && d > 0.001) {
      const f = EXPLOSION_FORCE * (1 - d / EXPLOSION_R);
      o.vx += (dx / d) * f;
      o.vy += (dy / d) * f;
    }
  }
  magnet.omega += (x >= CX ? 1 : -1) * EXPLOSION_TORQUE;
  if (Math.hypot(x - CX, y - CY) < EXPLOSION_R * 0.6) health -= EXPLOSION_DAMAGE;
  exploded++;
}

function catchOrb(orb) {
  if (orb.volatile) { explode(orb.x, orb.y); return; }
  if (stuck.length >= MAX_STUCK) shedOne(0);
  const dx = orb.x - CX, dy = orb.y - CY;
  const c = Math.cos(-magnet.phi), s = Math.sin(-magnet.phi);
  stuck.push({ lx: dx * c - dy * s, ly: dx * s + dy * c, mass: ORB_MASS, pol: orb.pol });
  caught++;
  score += 1;
  health = Math.min(100, health + CORE_REGEN);
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
    pol: o.pol,
    volatile: false,
    shed: true
  });
  stuck.splice(index, 1);
  shedCount++;
  score += 2;
}

function vent() {
  // overheat failure: blow every stuck orb off in a burst
  for (let i = stuck.length - 1; i >= 0; i--) shedOne(i);
  explode(CX, CY);
  overheatTime = 0;
}

function step(dt) {
  input.update(dt);
  if (!running) return;

  const over = overheated();
  if (over) {
    overheatTime += dt;
    if (overheatTime > OVERHEAT_VENT) vent();
  } else {
    overheatTime = Math.max(0, overheatTime - dt * 2);
  }

  const target = input.angle * Math.PI / 180;
  const I = inertia();
  const torque = K_TORQUE * (target - magnet.phi) - D_TORQUE * magnet.omega;
  magnet.omega += (torque / I) * dt;
  magnet.phi += magnet.omega * dt;

  if (Math.abs(magnet.omega) > SHED_OMEGA && stuck.length) {
    for (let i = stuck.length - 1; i >= 0; i--) shedOne(i);
  }

  difficulty += dt;
  spawnEvery = Math.max(0.45, 1.6 - difficulty * 0.012);
  spawnTimer -= dt;
  if (spawnTimer <= 0) { spawnOrb(); spawnTimer = spawnEvery; }

  const ps = poles();

  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];

    if (!o.shed && !over) {
      for (const { p, aff } of ps) {
        const dx = o.x - p.x, dy = o.y - p.y;
        const d = Math.hypot(dx, dy) || 0.001;
        if (d < ATTRACT_R) {
          const ux = dx / d, uy = dy / d;
          const f = PULL * (1 - d / ATTRACT_R);
          const sign = (aff === o.pol) ? -1 : 0.7;
          o.vx += ux * f * sign * dt;
          o.vy += uy * f * sign * dt;
        }
      }
    }

    o.x += o.vx * dt;
    o.y += o.vy * dt;

    if (!o.shed) {
      let caught = false;
      for (const { p, aff } of ps) {
        if (aff === o.pol && Math.hypot(o.x - p.x, o.y - p.y) < POLE_R) {
          catchOrb(o);
          orbs.splice(i, 1);
          caught = true;
          break;
        }
      }
      if (caught) continue;
    }

    if (Math.hypot(o.x - CX, o.y - CY) < CORE_R + o.r) {
      if (o.volatile && !o.shed) explode(o.x, o.y);
      if (!o.shed) health -= 12;
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

const ORB_COLORS = ['#e0a04a', '#7aa7ff'];

function render() {
  ctx.clearRect(0, 0, W, H);

  const over = overheated();
  const hp = clamp(health / 100, 0, 1);

  // core
  ctx.beginPath(); ctx.arc(CX, CY, CORE_R + 8, 0, TAU);
  ctx.strokeStyle = '#2a3140'; ctx.lineWidth = 6; ctx.stroke();
  ctx.beginPath(); ctx.arc(CX, CY, CORE_R + 8, -Math.PI / 2, -Math.PI / 2 + TAU * hp);
  ctx.strokeStyle = hp > 0.5 ? '#57d38c' : (hp > 0.25 ? '#e0a04a' : '#ff5a5f'); ctx.stroke();
  ctx.beginPath(); ctx.arc(CX, CY, CORE_R, 0, TAU);
  ctx.fillStyle = '#11151c'; ctx.fill();

  // orbs
  for (const o of orbs) {
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, TAU);
    ctx.fillStyle = o.shed ? '#9dbcff' : ORB_COLORS[o.pol];
    ctx.fill();
    if (o.volatile && !o.shed) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r + 4, 0, TAU);
      ctx.strokeStyle = '#ff5a5f';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // magnet
  const p1 = poleWorld(1), p2 = poleWorld(-1);
  ctx.strokeStyle = over ? '#ff8a5a' : '#c6cfdf';
  ctx.lineWidth = 14; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();

  // poles coloured by what they attract
  ctx.beginPath(); ctx.arc(p1.x, p1.y, 10, 0, TAU);
  ctx.fillStyle = ORB_COLORS[0]; ctx.fill();
  ctx.beginPath(); ctx.arc(p2.x, p2.y, 10, 0, TAU);
  ctx.fillStyle = ORB_COLORS[1]; ctx.fill();

  // stuck orbs
  const c = Math.cos(magnet.phi), s = Math.sin(magnet.phi);
  for (const o of stuck) {
    const wx = CX + o.lx * c - o.ly * s;
    const wy = CY + o.lx * s + o.ly * c;
    ctx.beginPath(); ctx.arc(wx, wy, 8, 0, TAU);
    ctx.fillStyle = ORB_COLORS[o.pol]; ctx.fill();
  }

  // explosions
  for (const e of explosions) {
    const t = 1 - e.life / e.max;
    ctx.beginPath(); ctx.arc(e.x, e.y, EXPLOSION_R * t, 0, TAU);
    ctx.strokeStyle = 'rgba(255, 120, 90, ' + (1 - t) + ')';
    ctx.lineWidth = 4; ctx.stroke();
  }

  // overheat warning
  if (over) {
    ctx.fillStyle = 'rgba(255, 90, 95, 0.9)';
    ctx.font = '700 18px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('OVERHEAT — knock off orbs', CX, CY - BAR_HALF - 40);
    ctx.textAlign = 'start';
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
