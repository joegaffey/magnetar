# Magnetar

**Play:** https://joegaffey.com/magnetar/

A one-axis survival game about catching iron orbs on a rotating magnet while they spiral into a black hole.

Every orb that sticks adds mass — the magnet lags and becomes harder to control. Left alone, stuck orbs are slowly absorbed into the black hole, feeding it and restoring its strength. Grab too eagerly or spin too fast and you'll overload the magnet or shed your catch before it pays off.

## Play

- **Rotate the magnet** with `←/→` (or `A/D`), move the mouse, or drag on a touchscreen.
- Present the **matching pole** (amber ↔ amber, blue ↔ blue) to catch an orb; the opposite pole repels it.
- Let caught orbs **be absorbed** to restore the core.
- **Avoid spinning fast** — it sheds orbs before they can be absorbed.
- Keep orbs from reaching the core.

## Mechanics

- **Catch:** orbs are pulled to the poles; contact sticks them.
- **Polarity:** one pole attracts amber orbs, the other blue; the wrong pole pushes them away.
- **Core gravity:** the black hole pulls every orb toward the centre, so positioning matters.
- **Weight:** each stuck orb adds angular inertia (HUD `Mass`), making the magnet sluggish and overshooty.
- **Absorb:** stuck orbs slowly shrink and feed the core, restoring `Health` and removing their mass.
- **Overheat:** above a mass threshold the magnet loses attraction; if it stays hot it vents in a burst.
- **Volatile orbs:** some detonate on contact — blast waves shove nearby orbs and kick the magnet. A volatile orb hitting the core is especially bad.
- **Escalation:** spawn rate and orb speed climb over time.

## Force-feedback wheel support

Magnetar is built to be played with a real **force-feedback steering wheel**, with no drivers, via the [**webhid-wheel**](https://github.com/joegaffey/webhid-wheel) project.

Click **Connect wheel** and pick your wheelbase — it becomes the steering axis, and its FFB reflects the magnet's mass and rotation (the heavier it gets, the heavier the wheel feels). Keyboard and mouse always work, so a wheel is entirely optional and the game never requires force feedback.

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
- Poles: `BAR_HALF`, `ATTRACT_R`, `POLE_R`, `PULL`, `REPEL`, `REPEL_RANGE`.
- Absorption: `ABSORB_TIME`, `HEAL_PER_ORB`.
- Overload / shedding: `OVERLOAD_MASS`, `OVERHEAT_VENT`, `SHED_ACCEL`, `SHED_INTERVAL`.
- Volatile orbs: `VOLATILE_CHANCE`, `EXPLOSION_*`.

See [`SPEC.md`](./SPEC.md) for the full design notes and parameter table.

## Credits

Built on [webhid-wheel](https://github.com/joegaffey/webhid-wheel). MIT.
