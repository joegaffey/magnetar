# Magnetar

**Play:** https://joegaffey.com/magnetar/

A one-axis survival game about catching iron orbs on a rotating magnet while they spiral into a black hole.

Every orb that sticks adds mass — the magnet lags and becomes harder to control. Left alone, stuck orbs are slowly absorbed into the black hole, feeding it and restoring its strength. Spinning fast can naturally shake orbs loose before they are absorbed — that is a physical consequence of rotation, not a goal in itself.

## Play

- **Rotate the magnet** with `←/→` (or `A/D`), move the mouse, or drag on a touchscreen (relative drag; sensitivity in Settings).
- Present the **matching pole** (amber ↔ amber, blue ↔ blue) to catch an orb; the opposite pole repels it.
- Let caught orbs **be absorbed** to restore the core.
- **Spinning fast naturally detaches orbs** — they keep their polarity and can be re-caught, and a detached orb reaching the core damages by its remaining energy. Shedding is not a goal, just a consequence.
- Keep orbs from reaching the core.

## Mechanics

- **Catch:** orbs are pulled to the poles; contact sticks them.
- **Physical poles:** orbs bounce off the pole orbs and never pass through; the opposite-colour pole can bat them away, and each hit gives a wheel jolt. The bridge between the poles is just energy.
- **Polarity:** one pole attracts amber orbs, the other blue; the wrong pole pushes them away.
- **Core gravity:** the black hole pulls every orb toward the centre, so positioning matters.
- **Edge warning:** off-screen orbs cast a soft localized glow just outside the screen edge where they will enter, fading in gradually from spawn and reaching full brightness before they enter; unstable orbs pulse red.
- **Weight:** each stuck orb adds angular inertia (HUD `Mass`), making the magnet sluggish and overshooty.
- **Absorb:** stuck orbs slowly shrink and feed the core, restoring `Health` and removing their mass.
- **Unstable orbs:** some detonate at the core for 3× damage (with a blast that shoves nearby orbs and kicks the magnet), but if you catch one it bursts **instantly** for a 3× heal — high risk, high reward.
- **Escalation:** spawn rate and orb speed climb over time.

## Audio

Fully procedural via the Web Audio API (no asset files): a **hiss/whoosh** whose pitch and gain track the energy-transfer rate, deep sub-bass explosions, low **thunks** on impacts, an ambient drone, and a filtered air layer that tracks the magnet's weight. An **adaptive generative score** (warm major-key pads, shimmering arpeggios, soft bass) builds with difficulty and ducks under impacts. It cycles through four sections — including a whole-step key lift and reordered progressions — so it doesn't loop monotonously. Loosely inspired by dreamy, euphoric synth-pop. Sounds are **stereo-panned** by orb position. Bright synthetic ticks accent scoring (pitch rises with a streak) and impacts. **Master**, **Music** and **Mute** live in **Settings** (persisted), which pauses play while open.

A small music loop can be layered in later without changing the event API.

## Force-feedback wheel support

Magnetar is built to be played with a real **force-feedback steering wheel**, with no drivers, via the [**webhid-wheel**](https://github.com/joegaffey/webhid-wheel) project.

Click **Connect wheel** and pick your wheelbase — it becomes the steering axis, and its FFB reflects the magnet's mass and rotation (the heavier it gets, the heavier the wheel feels). Use **Settings** (pauses play) to adjust **touch sensitivity**, **FFB strength**, **rotation range** (match your wheel's lock-to-lock for 1:1 steering), **Master/Music** volume and **mute**. Keyboard, mouse and touch always work, so a wheel is entirely optional.

## Run

```sh
npx serve
# open the URL it prints (e.g. http://localhost:3000)
```

Use a Chromium-based browser with WebHID for the wheel; keyboard, mouse and touch work in any modern browser.

The wheel library is vendored at [`vendor/webhid-wheel.js`](./vendor/webhid-wheel.js) (a copy of [webhid-wheel](https://github.com/joegaffey/webhid-wheel)) so the page is self-contained; refresh it from that repo when the library changes.

## Tuning

Most feel lives in `game.js`:

- Magnet: `K_TORQUE`, `D_TORQUE`, `BASE_I`, `ORB_MASS`.
- Orbs: `CORE_PULL`, `ORB_DRAG`, `MAX_ORB_SPEED`, spawn rate/speed.
- Poles: `BAR_HALF`, `ATTRACT_R`, `POLE_INNER_REACH`, `POLE_R`, `PULL`, `REPEL`, `REPEL_RANGE`.
- Absorption: `ABSORB_TIME`, `HEAL_PER_ORB`.
- Shedding: `SHED_ACCEL`, `SHED_INTERVAL`, `MAX_STUCK`.
- Volatile orbs: `VOLATILE_CHANCE`, `EXPLOSION_*`.

See [`SPEC.md`](./SPEC.md) for the full design notes and parameter table.

## Credits

Built on [webhid-wheel](https://github.com/joegaffey/webhid-wheel). MIT.
