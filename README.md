# Magnetar

A rotation-controlled survival game built on the [`webhid-wheel`](../webhid-wheel) library.

Catch iron orbs on a rotating magnet to protect the core. Each stuck orb adds mass (the magnet lags and the wheel gets heavier), but is slowly absorbed into the core, restoring its strength. **Avoid spinning too fast** — that sheds orbs before they can be absorbed. Difficulty escalates.

## Controls

One axis only — no buttons required:

- **Wheel** — turn it (optional; force feedback when connected).
- **Keyboard** — hold **←/→** or **A/D** to rotate continuously.
- **Mouse** — move the pointer across the canvas.

The input source is auto-selected by whichever you used last. Wheel FFB is only active while the wheel is the source.

## Mechanics

- **Catch:** orbs are pulled to the nearest pole; contact sticks them.
- **Weight:** stuck orbs raise the magnet's angular inertia (shown as `Mass`).
- **Absorb:** stuck orbs slowly shrink, feeding the core and restoring `Health` — this is the intended payoff.
- **Shed (avoid):** spinning too fast flings stuck orbs off before they can be absorbed. There's also a hard capacity fallback.
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
