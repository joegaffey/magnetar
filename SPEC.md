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
| Touch | drag on the canvas → pointer X → absolute angle | No | Mobile/tablet |
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
- A gentle **core gravity well** (`CORE_PULL`) accelerates free orbs toward the centre, speed-capped at `MAX_ORB_SPEED`.
- Each free orb is pulled toward the **nearest pole** within `ATTRACT_R`:
  `a = PULL · (1 − d/ATTRACT_R)` toward the pole.
- Contact within `POLE_R` of a matching pole → **caught** (sticks).
- The **pole orbs are physical**: free orbs bounce off them and never pass through; the opposite-colour pole can bat them away. Each impact gives a force-feedback jolt proportional to impact speed. The bridge between the poles is energy, not a solid body.

### 5.3 Mass / weight
- Each caught orb adds `ORB_MASS` to `I`.
- Effects: slower magnet response, more overshoot, heavier wheel (FFB), harder to spin.
- Displayed as `Mass` in the HUD.

### 5.4 Shedding (buttonless detach)
Primary: **centrifugal (gradual)** — an orb detaches when `ω²·r > SHED_ACCEL` **and the pole is moving away from it** at that speed (outermost first), at most one per `SHED_INTERVAL`; released tangentially with a modest outward bias. A detached orb has a short no-catch window (0.25 s) so it cannot instantly reattach. Spinning no longer clears everything instantly.
Secondary: **hard capacity** — if `stuck ≥ MAX_STUCK`, the oldest orb is ejected automatically (prevents a dead-end).
A detached orb becomes an ordinary free orb again: it keeps its polarity colour and can be re-caught. Its remaining energy (`size / ORB_SIZE`) scales its radius and the core damage it deals.

### 5.5 Core & failure
- Core at centre; hitting it damages `Health` (orb contact within `CORE_R + r`).
- A detached orb that reaches the core damages `Health` in proportion to its remaining energy (`size / ORB_SIZE`).
- `Health ≤ 0` → game over.

### 5.6 Escalation
- Time-based difficulty increases spawn rate and orb speed:
  `spawnEvery = max(0.45, 1.6 − t·0.012)`, orb speed `55 + min(t·7, 150)`.
- Planned: wave events (bursts, fast orbs), difficulty tiers.

### 5.7 Scoring
- `+1` per catch. Shedding never scores. (Planned: survival ticks, combo/multipliers.)

### 5.8 Polarity (experimental, in build)
- Two poles with opposite affinity: the `+BAR_HALF` pole attracts **amber** orbs (pol 0), the `-BAR_HALF` pole attracts **blue** orbs (pol 1).
- The matching pole attracts; the opposite pole repels. Only the matching pole can catch.
- The **core attracts all orbs** (gravity well); the poles are the player's tool to intercept and protect it, so positioning is the skill.
- Rotation therefore matters: present the correct pole to each orb; the wrong pole shoves it away.

### 5.9 Core regeneration / absorption (in build)
- A caught orb sticks at full size, then **slowly shrinks** over `ABSORB_TIME`, feeding particles into its pole.
- **Energy routing:** orb → pole → centre. Orbs (free or stuck) siphon energy into their matching pole, and the pole forwards it to the black hole. Energy never travels directly orb → centre.
- Absorption heals the core gradually (up to `HEAL_PER_ORB` per orb, capped 100) and **removes the orb's mass** once fully absorbed.
- More absorbing orbs = denser pole→centre flow (and a safer but lighter magnet).

### 5.10 Overload / overheat (experimental, in build)
- Above `OVERLOAD_MASS` the magnet overheats: **attraction is disabled** and the HUD shows a warning (`Mass 3.xx !` + “OVERHEAT”).
- If overheat persists for `OVERHEAT_VENT` seconds it **vents**: all stuck orbs are flung off and an explosion fires (angular kick to the magnet).
- Shedding (spinning) back below the threshold cools it.

### 5.11 Unstable orbs & explosions (in build)
- Some orbs are **unstable** (red ring). Catching one triggers an **instant burst** that transmits power immediately (heals `HEAL_PER_ORB × 3`) — it does **not** stick or absorb gradually.
- An explosion applies a radial impulse to nearby orbs, an **angular kick to the magnet**, and damages the core if close.
- An unstable orb reaching the **centre** detonates in a **larger explosion** (1.8× radius/force/particles) and deals **3× core damage** (24) plus the blast damage.
- Goal: make unstable orbs high-risk / high-reward — grab them for a big heal, but never let one reach the core.

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

**Direction:** Geometry Wars-inspired neon. Near-black background with a faint grid, bright saturated shapes, bloom/glow, and particle bursts on every impact. High contrast, arcade energy.

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
- **Glow:** pre-rendered radial "bloom" sprites drawn additively behind orbs, poles and the core (cheap neon).
- **Black hole:** dark event horizon at the centre with a glowing accretion/health ring (no extra rings/lines).
- **Bridges:** glowing particles flow **inward** from each pole to the event horizon (no solid bar or drawn lines). Orbs feed energy **into their pole**, which then forwards it to the centre — never orb → centre directly.
- **Orbs:** glowing circles; volatile orbs get a red ring.
- **Stuck orbs:** clustered on the pole with a glow; gentle pulse.
- **Catch:** particle burst at the contact point (reads as a real hit).
- **Shed:** particle burst at release; shed orbs glow pale blue.
- **Explosion:** expanding ring + large particle burst (additive), angular kick to the magnet.
- **Core:** glowing ring gauge (health), dark interior.
- **Background:** near-black with a faint neon grid.
- **Particles:** short-lived additive dots with drag; each event colour-coded.
- **Typography:** system UI sans for HUD; uppercase, letter-spaced micro-labels.
- **Motion:** snappy spring on the magnet; particles ease out; no unnecessary UI animation.

### Audio (optional, later)
### Audio (implemented, procedural)
- **Energy transfer:** a continuous filtered-noise **hiss/whoosh** whose bandpass pitch and gain track the transfer rate (absorbing orbs + orbs near a pole). Short up/down whooshes mark catches and sheds.
- **Impacts:** low **thunks** (sine body + filtered noise) for pole collisions and core hits, scaled by impact speed. **Explosions are deep sub-bass** booms + low-passed noise.
- **Ambient:** dark detuned drone; **mass hum** whose pitch/gain tracks inertia; soft overheat wobble.
- **Stereo panning** by orb X relative to the core; drone/hum centred.
- **Mute + volume** in the generic **Settings** panel, persisted; AudioContext resumed on Start, suspended when the tab is hidden.
- Optional later: a small music loop layered on top.

## 8. Parameters (current)

| Constant | Value | Meaning |
| --- | --- | --- |
| `BAR_HALF` | 85 | pole distance from centre (px) |
| `POLE_R` | 22 | surface-contact catch radius (orbs visibly touch) |
| `POLE_BODY_R` | 10 | physical pole-orb radius (orbs bounce off) |
| `BOUNCE` | 0.75 | restitution when an orb hits a pole |
| `ATTRACT_R` | 150 | attraction range |
| `PULL` | 550 | attraction accel at the pole |
| `REPEL` | 0.6 | opposite-pole push (fraction of pull) |
| `REPEL_RANGE` | 1.2× `ATTRACT_R` | wrong pole acts from slightly further away |
| `K_TORQUE` / `D_TORQUE` | 170 / 17 | magnet spring / damping |
| `BASE_I` | 1.0 | base inertia |
| `ORB_MASS` | 0.11 | inertia added per stuck orb |
| `MAX_STUCK` | 14 | hard capacity |
| `SHED_ACCEL` | 5200 | centrifugal detach threshold (`ω²·r`) |
| `SHED_INTERVAL` | 0.12 s | min time between shed orbs |
| `CORE_R` | 20 | core radius |
| `CORE_PULL` | 275 | core gravity-well acceleration on all free orbs |
| `ORB_DRAG` | 1.1 /s | linear drag on free orbs (≈218 px/s terminal) |
| `MAX_ORB_SPEED` | 340 px/s | free-orb speed cap |
| Health / hit | 100 / 12 | core durability |
| Spawn | 1.6 → 0.45 s | interval over time |
| Orb speed | 55 → 205 px/s | over time |

### Experimental parameters

| Constant | Value | Meaning |
| --- | --- | --- |
| `POLARITY` | true | poles attract their colour, repel the other |
| `ORB_SIZE` | 8 px | stuck orb render radius |
| `ABSORB_TIME` | 4.0 s | time for a stuck orb to be fully absorbed |
| `HEAL_PER_ORB` | 4.0 | health restored per absorbed orb |
| `OVERLOAD_MASS` | 3.0 | overheat threshold (inertia) |
| `OVERHEAT_VENT` | 3.0 s | continuous overheat before venting |
| `VOLATILE_CHANCE` | 0.18 | fraction of orbs that are volatile |
| `EXPLOSION_R` | 95 px | blast radius |
| `EXPLOSION_FORCE` | 850 | radial impulse |
| `EXPLOSION_TORQUE` | 5 rad/s | angular kick to the magnet |
| `EXPLOSION_DAMAGE` | 12 | core damage if the blast is close |

Tuning goals: ~30–45 s to first "heavy" feel; shedding should be attainable in one committed spin; no death spiral.

## 9. UX / onboarding

- **Full-viewport canvas**; HUD and controls overlay on top (no letterboxing).
- **Start gate:** a help overlay with controls and a **Start** button; clicking Start dismisses it and begins play (no auto-start). On failure the same overlay shows results + **Restart**.
- HUD (top-left): `Health`, `Mass`, `Score`, `Input` (source + FFB), `FFB`; brand wordmark.
- Top-right: **Connect wheel** (optional) + **Restart** + status.
- Game over overlay: score + caught/unstable counts, **Restart**.
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
