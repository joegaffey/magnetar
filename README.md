# Magnetar

A rotation-controlled survival game built on the [`webhid-wheel`](../webhid-wheel) library.

Catch iron orbs on a rotating bar magnet to protect the core. Every orb that sticks adds mass: the magnet lags, overshoots and becomes harder to control (and the wheel gets heavier via force feedback). **Spin fast to shed** stuck orbs before you're overloaded. Difficulty escalates.

## Controls

One axis only — no buttons required:

- **Wheel** — turn it (optional; force feedback when connected).
- **Keyboard** — hold **←/→** or **A/D** to rotate continuously.
- **Mouse** — move the pointer across the canvas.

The input source is auto-selected by whichever you used last. Wheel FFB is only active while the wheel is the source.

## Mechanics

- **Catch:** orbs are pulled to the nearest pole; contact sticks them.
- **Weight:** stuck orbs raise the magnet's angular inertia (shown as `Mass`).
- **Shed:** when the magnet's angular speed exceeds the threshold, stuck orbs are flung off tangentially (centrifugal). There's also a hard capacity fallback.
- **Threat:** orbs that reach the core damage `Health`.
- **Escalation:** spawn rate and orb speed increase over time.

## Run

The page imports the sibling library via `../webhid-wheel/webhid-wheel.js`, so serve the parent folder and open the game path:

```sh
# from the folder containing `webhid-wheel/` and `magnetar/`
npx serve ..
# open http://localhost:3000/magnetar/
```

Use a Chromium-based browser with WebHID for the wheel; keyboard and mouse work in any modern browser.

## Tuning (`game.js`)

`BAR_HALF`, `POLE_R`, `ATTRACT_R`, `PULL`, `K_TORQUE`/`D_TORQUE`, `ORB_MASS`, `MAX_STUCK`, `SHED_OMEGA`, and the FFB gain in `updateFfb`.
