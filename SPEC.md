# Magnetar — Game Design Spec

Status: prototype (playable). This doc captures direction, mechanics, art, and tuning.

## 1. Concept

You are a **rotating bar magnet** guarding a core. Iron orbs drift in from all directions; catch them on your poles to keep the core safe. Each caught orb **adds mass** — your magnet lags, overshoots, and feels heavier. **Spin to shed** the weight before you become too sluggish. Survive escalating waves.

- **Genre:** physics survival / arcade resource management
- **Perspective:** 2D top-down
- **Session:** 2–6 minutes
- **Platform:** web (canvas), Chromium for wheel/FFB; any modern browser for keyboard/mouse
- **Controls:** one axis only (no buttons required)

## 2. Design pillars

1. **Rotation-first** — every interaction is angle/angular velocity; no buttons needed.
2. **Weight is the resource** — catching protects you but makes you worse; shedding is relief but costs positioning.
3. **Feel the field** — force feedback communicates mass and impacts, never required to play.
4. **Readable chaos** — dark, high-contrast, glowing shapes; the player always sees threat, mass, and health.

## 3. Core loop

Catch orbs → gain mass/inertia → magnet becomes sluggish → spin to shed → reposition to catch the next wave. Difficulty rises until the core is breached.

## 4. Input

A single abstract value: **target angle** `θ` in degrees (may be unbounded for continuous spin). Source is auto-selected by most-recent activity; all sources coexist.

| Source | Mapping | FFB | Notes |
| --- | --- | --- | --- |
| Wheel (WebHID) | `wheel.rotation` (absolute, ±maxRotation/2) | Yes | Optional; auto-selected when moved |
| Keyboard | hold ←/→ or A/D, integrate ±rate (unbounded) | No | Best for continuous spin |
| Mouse | pointer X → absolute angle (bounded ±range) | No | Simple aiming |
| Gamepad | left-stick X / wheel axis (planned) | No | Add via same interface |

- Input module: `input.js` (`SteeringInput`), exposes `angle`, `source`, `ffbActive`, `update(dt)`, `applyForce(v)`, `stopFfb()`.
- **Gameplay must not depend on FFB.** Visual/HUD cues carry all critical info.

## 5. Mechanics

### 5.1 Magnet
A bar magnet centred on the core, angle `φ` (rad), angular velocity `ω` (rad/s).

```
I · φ'' = K·(θ − φ) − D·ω
I = I0 + Σ m_orb
```

- `K` (torque spring) and `D` (damping) set responsiveness.
- Higher `I` → slower response and more overshoot (the felt "weight").
- Two poles at `±BAR_HALF` along `φ`.

### 5.2 Orbs
- Spawn just off-screen at a random bearing; drift toward the core.
- Each free orb is pulled toward the **nearest pole** within `ATTRACT_R`:
  `a = PULL · (1 − d/ATTRACT_R)` toward the pole.
- Contact within `POLE_R` of a pole → **caught** (sticks).

### 5.3 Mass / weight
- Each caught orb adds `ORB_MASS` to `I`.
- Effects: slower magnet response, more overshoot, heavier wheel (FFB), harder to spin.
- Displayed as `Mass` in the HUD.

### 5.4 Shedding (buttonless detach)
Primary: **centrifugal** — when `|ω| > SHED_OMEGA`, stuck orbs are released tangentially:
`v = ω × r` (plus a small outward bias). They become free "shed" orbs (blue) and fly off.
Secondary: **hard capacity** — if `stuck ≥ MAX_STUCK`, the oldest orb is ejected automatically (prevents a dead-end).

### 5.5 Core & failure
- Core at centre; hitting it damages `Health` (orb contact within `CORE_R + r`).
- Shed orbs do not damage the core.
- `Health ≤ 0` → game over.

### 5.6 Escalation
- Time-based difficulty increases spawn rate and orb speed:
  `spawnEvery = max(0.45, 1.6 − t·0.012)`, orb speed `55 + min(t·7, 150)`.
- Planned: wave events (bursts, fast orbs), difficulty tiers.

### 5.7 Scoring
- `+1` per catch, `+2` per shed. (Planned: survival ticks, combo/multipliers.)

### 5.8 Polarity (experimental, in build)
- Two poles with opposite affinity: the `+BAR_HALF` pole attracts **amber** orbs (pol 0), the `-BAR_HALF` pole attracts **blue** orbs (pol 1).
- The matching pole attracts; the opposite pole weakly repels. Only the matching pole can catch.
- Rotation therefore matters: present the correct pole to each orb; the wrong pole shoves it away.

### 5.9 Core regen (experimental, in build)
- Absorbing a caught orb heals the core (`CORE_REGEN`, capped at 100), giving catches a defensive payoff.

### 5.10 Overload / overheat (experimental, in build)
- Above `OVERLOAD_MASS` the magnet overheats: **attraction is disabled** and the HUD shows a warning (`Mass 3.xx !` + “OVERHEAT”).
- If overheat persists for `OVERHEAT_VENT` seconds it **vents**: all stuck orbs are flung off and an explosion fires (angular kick to the magnet).
- Shedding (spinning) back below the threshold cools it.

### 5.11 Volatile orbs & explosions (experimental, in build)
- Some orbs are **volatile** (red ring) and detonate on pole/core contact instead of sticking.
- An explosion applies a radial impulse to nearby orbs, an **angular kick to the magnet**, and damages the core if close.
- Goal: make slinging/repelled orbs kinetic — chain reactions are desirable.

### 5.12 Future mechanics (candidate)
- Orb types: heavy, fast, shielded (needs 2 hits).
- Polarity toggle (only if a button verb is added).
- Combo/multipliers for chain explosions.
- Overload variants: blown pole (disabled side) vs. temporary loss of attraction (current).

## 6. Force feedback

- Active only when the wheel is the input source.
- Constant force, default strength **25%**.
- Mapping: resistance proportional to `I·ω` (mass × spin), so the wheel feels heavier as mass grows and as you spin faster.
- **Jolt** on catch (short pulse) and on core hit (stronger).
- Deadzone so a still magnet produces no force.
- Auto-stop on game over/pause; explicit **Stop** available (dev build).

## 7. Art style

**Direction:** dark orbital / industrial. Flat vector shapes, high contrast, restrained glow. Think "instrument panel at night", not neon overload.

### Palette
| Role | Hex |
| --- | --- |
| Background | `#0d0f14` / `#0b0d12` (radial vignette) |
| Panels/border | `#161a21` / `#262c37` |
| Text | `#e8ecf3`; muted `#95a0b3` |
| Accent | `#4f8cff`; light `#7aa7ff` |
| Magnet steel | `#c6cfdf`; poles `#4f8cff` |
| Orb (threat) | `#e0a04a` |
| Orb (shed) | `#7aa7ff` |
| Core healthy / warn / crit | `#57d38c` / `#e0a04a` / `#ff5a5f` |

### Shapes & effects
- **Magnet:** thick rounded bar + glowing pole caps; faint field arcs emanating from poles, intensity scaled by nearby orbs.
- **Orbs:** small filled circles with a 1–2 px rim and a short fading motion trail.
- **Stuck orbs:** clustered on the pole, gentle pulse; subtle jitter at high mass.
- **Shed:** bright streak + a few particles; brief bloom.
- **Core:** ring gauge (health), inner dark disc; pulses with HP.
- **Impacts:** small screen shake + red vignette flash on core hit.
- **Background:** subtle concentric rings / grid and a slow parallax drift.
- **Typography:** system UI sans for HUD; uppercase, letter-spaced micro-labels (matches webhid-wheel demo).
- **Motion:** snappy spring on the magnet; orbs ease; no unnecessary UI animation.

### Audio (optional, later)
Low hum whose pitch/volume tracks `Mass`; metallic ping on catch; whoosh on shed; alarm on core hit.

## 8. Parameters (current)

| Constant | Value | Meaning |
| --- | --- | --- |
| `BAR_HALF` | 85 | pole distance from centre (px) |
| `POLE_R` | 24 | contact radius around a pole (orbs visibly touch) |
| `ATTRACT_R` | 150 | attraction range |
| `PULL` | 760 | attraction accel at the pole |
| `REPEL` | 0.2 | opposite-pole push (weak) |
| `K_TORQUE` / `D_TORQUE` | 170 / 17 | magnet spring / damping |
| `BASE_I` | 1.0 | base inertia |
| `ORB_MASS` | 0.11 | inertia added per stuck orb |
| `MAX_STUCK` | 14 | hard capacity |
| `SHED_OMEGA` | 7.0 rad/s | centrifugal shed threshold |
| `CORE_R` | 20 | core radius |
| Health / hit | 100 / 12 | core durability |
| Spawn | 1.6 → 0.45 s | interval over time |
| Orb speed | 55 → 205 px/s | over time |

### Experimental parameters

| Constant | Value | Meaning |
| --- | --- | --- |
| `POLARITY` | true | poles attract their colour, repel the other |
| `CORE_REGEN` | 1.2 | health restored per absorbed orb |
| `OVERLOAD_MASS` | 3.0 | overheat threshold (inertia) |
| `OVERHEAT_VENT` | 3.0 s | continuous overheat before venting |
| `VOLATILE_CHANCE` | 0.18 | fraction of orbs that are volatile |
| `EXPLOSION_R` | 95 px | blast radius |
| `EXPLOSION_FORCE` | 850 | radial impulse |
| `EXPLOSION_TORQUE` | 5 rad/s | angular kick to the magnet |
| `EXPLOSION_DAMAGE` | 7 | core damage if close |

Tuning goals: ~30–45 s to first "heavy" feel; shedding should be attainable in one committed spin; no death spiral.

## 9. UX / onboarding

- Start overlay with one-line controls and a **Start** button.
- HUD: `Health`, `Mass`, `Score`, `Input` (source + FFB), `FFB` readout.
- Optional wheel connect in the top bar; keyboard/mouse work without it.
- Game over: score + caught/shed counts, **Restart**.
- Pause on window blur; auto-stop FFB.

## 10. Technical

- Files: `index.html`, `game.js`, `input.js`; consumes `../webhid-wheel/webhid-wheel.js`.
- Fixed timestep simulation at 120 Hz (`STEP = 1/120`), rendered per `requestAnimationFrame`.
- State: magnet `{φ, ω}`, `stuck[]` (magnet-local coords + mass), free `orbs[]`, `health`, `score`, difficulty timers.
- FFB sent at ~60 Hz, throttled.
- Performance target: 60 fps on integrated graphics; O(orbs × 2 poles) per step.

## 11. Roadmap

- **M0 — prototype (done):** magnet, orbs, catch, inertia, shed, core, HUD, wheel/keyboard/mouse.
- **M1 — feel pass:** tune inertia/shed/attraction; make weight legible; verify wheel FFB.
- **M2 — art/juice:** field lines, trails, impact shake, vignette, palette polish.
- **M3 — content:** orb types, waves, scoring/combo, difficulty tiers.
- **M4 — inputs:** gamepad; input-source indicator polish; pause.

## 12. Open questions

- Should the magnet be a bar (two poles) or a single directional pole?
- Is catching *reward* enough, or should caught orbs be "ammo" to fling at hazards?
- Should the core ever regenerate?
- How punishing should overload be (wobble vs. forced shed)?
