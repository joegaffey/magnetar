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
const ATTRACT_R = 150;
const PULL = 760;
const REPEL = 1.3;             // opposite pole push (stronger than pull)
const REPEL_RANGE = ATTRACT_R * 1.6;
const K_TORQUE = 170;
const D_TORQUE = 17;
const BASE_I = 1.0;
const ORB_MASS = 0.11;
const MAX_STUCK = 14;
const SHED_ACCEL = 5200;       // w^2 * r threshold for centrifugal shed
const SHED_INTERVAL = 0.12;    // seconds between shed orbs
const CORE_R = 20;
const CORE_PULL = 110;         // acceleration of free orbs toward the core
const MAX_ORB_SPEED = 320;
const FFB_DEADZONE = 0.05;

// polarity / absorption
const POLARITY = true;
const CORE_REGEN = 1.2;

// overload
const OVERLOAD_MASS = 3.0;
const OVERHEAT_VENT = 3.0;

// volatile
const VOLATILE_CHANCE = 0.18;
const EXPLOSION_R = 95;
const EXPLOSION_FORCE = 850;
const EXPLOSION_TORQUE = 5;
const EXPLOSION_DAMAGE = 7;

const input = new SteeringInput({ keyRate: 540, mouseRange: 540 });

let magnet = { phi: 0, omega: 0 };
let stuck = [];
let orbs = [];
let explosions = [];
let particles = [];
let health = 100, score = 0, caught = 0, shedCount = 0, exploded = 0;
let difficulty = 0, spawnTimer = 1.0, spawnEvery = 1.6;
let running = false, over = false;
let overheatTime = 0, shedCooldown = 0;
let jolt = 0, joltDir = 0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

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

function spawnParticles(x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const s = speed * rand(0.2, 1);
    const life = rand(0.25, 0.6);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: rand(1.5, 3) });
  }
}

function reset() {
  magnet = { phi: 0, omega: 0 };
  stuck = []; orbs = []; explosions = []; particles = [];
  health = 100; score = 0; caught = 0; shedCount = 0; exploded = 0;
  difficulty = 0; spawnTimer = 0.9; spawnEvery = 1.6;
  running = true; over = false; overheatTime = 0; shedCooldown = 0; jolt = 0;
  input.angle = 0;
  overlay.classList.add('hidden');
  syncHud();
}

function inertia() {
  return BASE_I + stuck.reduce((a, o) => a + o.mass, 0);
}
function overheated() { return inertia() > OVERLOAD_MASS; }

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
  explosions.push({ x, y, life: 0.4, max: 0.4 });
  spawnParticles(x, y, '#ff7a5a', 34, 520);
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
  if (stuck.length >= MAX_STUCK) shedOne(0, true);
  const dx = orb.x - CX, dy = orb.y - CY;
  const c = Math.cos(-magnet.phi), s = Math.sin(-magnet.phi);
  stuck.push({ lx: dx * c - dy * s, ly: dx * s + dy * c, mass: ORB_MASS, pol: orb.pol });
  caught++;
  score += 1;
  health = Math.min(100, health + CORE_REGEN);
  spawnParticles(orb.x, orb.y, ORB_COLORS[orb.pol], 12, 220);
  jolt = 0.09;
  joltDir = Math.sign(orb.x - CX) || 1;
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
  orbs.push({
    x: wx, y: wy, vx, vy,
    r: 11, pol: o.pol, volatile: false, shed: true,
    life: 1.4, maxLife: 1.4
  });
  stuck.splice(index, 1);
  shedCount++;
  score += 2;
  if (!quiet) spawnParticles(wx, wy, ORB_COLORS[o.pol], 10, 260);
}

function vent() {
  for (let i = stuck.length - 1; i >= 0; i--) shedOne(i, true);
  explode(CX, CY);
  overheatTime = 0;
}

function step(dt) {
  input.update(dt);
  if (!running) return;

  const isOver = overheated();
  if (isOver) {
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

  // --- gradual centrifugal shedding ---
  shedCooldown -= dt;
  if (stuck.length && shedCooldown <= 0) {
    let best = -1, bestR = 0;
    for (let i = 0; i < stuck.length; i++) {
      const r = Math.hypot(stuck[i].lx, stuck[i].ly);
      if (magnet.omega * magnet.omega * r > SHED_ACCEL && r > bestR) { best = i; bestR = r; }
    }
    if (best >= 0) {
      shedOne(best);
      shedCooldown = SHED_INTERVAL;
    }
  }

  difficulty += dt;
  spawnEvery = Math.max(0.45, 1.6 - difficulty * 0.012);
  spawnTimer -= dt;
  if (spawnTimer <= 0) { spawnOrb(); spawnTimer = spawnEvery; }

  const ps = poles();

  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];

    if (o.shed) {
      o.life -= dt;
      if (o.life <= 0) { orbs.splice(i, 1); continue; }
    }

    if (!o.shed && !isOver) {
      for (const { p, aff } of ps) {
        const dx = o.x - p.x, dy = o.y - p.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const ux = dx / d, uy = dy / d;
        if (aff === o.pol) {
          if (d < ATTRACT_R) {
            const f = PULL * (1 - d / ATTRACT_R);
            o.vx -= ux * f * dt;
            o.vy -= uy * f * dt;
          }
        } else if (d < REPEL_RANGE) {
          const f = PULL * REPEL * (1 - d / REPEL_RANGE);
          o.vx += ux * f * dt;
          o.vy += uy * f * dt;
        }
      }
    }

    // core gravity well
    if (!o.shed) {
      const dxc = CX - o.x, dyc = CY - o.y;
      const dc = Math.hypot(dxc, dyc) || 0.001;
      o.vx += (dxc / dc) * CORE_PULL * dt;
      o.vy += (dyc / dc) * CORE_PULL * dt;
      const sp = Math.hypot(o.vx, o.vy);
      if (sp > MAX_ORB_SPEED) { o.vx = o.vx / sp * MAX_ORB_SPEED; o.vy = o.vy / sp * MAX_ORB_SPEED; }
    }

    o.x += o.vx * dt;
    o.y += o.vy * dt;

    if (!o.shed) {
      let didCatch = false;
      for (const { p, aff } of ps) {
        if (aff === o.pol && Math.hypot(o.x - p.x, o.y - p.y) < POLE_R) {
          catchOrb(o);
          orbs.splice(i, 1);
          didCatch = true;
          break;
        }
      }
      if (didCatch) continue;
    }

    if (Math.hypot(o.x - CX, o.y - CY) < CORE_R + o.r) {
      if (o.volatile && !o.shed) explode(o.x, o.y);
      if (!o.shed) { health -= 12; spawnParticles(o.x, o.y, '#ff5a5f', 14, 240); }
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
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, W, H);

  // faint grid
  ctx.strokeStyle = 'rgba(40, 60, 100, 0.18)';
  ctx.lineWidth = 1;
  const grid = 48;
  const ox = (CX % grid), oy = (CY % grid);
  for (let x = ox; x < W; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = oy; y < H; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const isOver = overheated();
  const hp = clamp(health / 100, 0, 1);
  const coreColor = hp > 0.5 ? '#57d38c' : (hp > 0.25 ? '#e0a04a' : '#ff5a5f');

  // core glow + ring
  drawGlow(CX, CY, CORE_R * 3.2, coreColor, 0.5);
  ctx.beginPath(); ctx.arc(CX, CY, CORE_R + 8, -Math.PI / 2, -Math.PI / 2 + TAU * hp);
  ctx.strokeStyle = coreColor; ctx.lineWidth = 5; ctx.stroke();
  ctx.beginPath(); ctx.arc(CX, CY, CORE_R, 0, TAU);
  ctx.fillStyle = '#05060a'; ctx.fill();

  // orbs (glow + core)
  for (const o of orbs) {
    const col = o.shed ? '#9dbcff' : ORB_COLORS[o.pol];
    const alpha = o.shed ? clamp(o.life / (o.maxLife || 1.4), 0, 1) : 1;
    drawGlow(o.x, o.y, o.r * 3, col, 0.55 * alpha);
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU);
    ctx.fillStyle = col; ctx.fill();
    ctx.globalAlpha = 1;
    if (o.volatile && !o.shed) {
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 5, 0, TAU);
      ctx.strokeStyle = '#ff5a5f'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // magnet
  const p1 = poleWorld(1), p2 = poleWorld(-1);
  drawGlow(p1.x, p1.y, 42, ORB_COLORS[0], 0.7);
  drawGlow(p2.x, p2.y, 42, ORB_COLORS[1], 0.7);
  ctx.strokeStyle = isOver ? '#ff8a5a' : '#c6cfdf';
  ctx.lineWidth = 12; ctx.lineCap = 'round';
  ctx.shadowBlur = 18; ctx.shadowColor = isOver ? '#ff5a5f' : '#88aaff';
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  ctx.shadowBlur = 0;

  // poles (coloured by what they attract)
  for (const [p, col] of [[p1, ORB_COLORS[0]], [p2, ORB_COLORS[1]]]) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, TAU);
    ctx.fillStyle = col; ctx.fill();
  }

  // stuck orbs
  const c = Math.cos(magnet.phi), s = Math.sin(magnet.phi);
  for (const o of stuck) {
    const wx = CX + o.lx * c - o.ly * s;
    const wy = CY + o.lx * s + o.ly * c;
    drawGlow(wx, wy, 22, ORB_COLORS[o.pol], 0.6);
    ctx.beginPath(); ctx.arc(wx, wy, 8, 0, TAU);
    ctx.fillStyle = ORB_COLORS[o.pol]; ctx.fill();
  }

  // explosion rings
  for (const e of explosions) {
    const t = 1 - e.life / e.max;
    ctx.beginPath(); ctx.arc(e.x, e.y, EXPLOSION_R * t, 0, TAU);
    ctx.strokeStyle = 'rgba(255, 120, 90, ' + (1 - t) + ')';
    ctx.lineWidth = 4; ctx.stroke();
  }

  // particles (additive)
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    const a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  if (isOver) {
    ctx.fillStyle = 'rgba(255, 90, 95, 0.95)';
    ctx.font = '700 18px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('OVERHEAT — knock off orbs', CX, CY - BAR_HALF - 44);
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
running = false;
syncHud();
requestAnimationFrame(frame);
