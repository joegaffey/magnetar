import { WebHIDWheel } from './vendor/webhid-wheel.js';

/**
 * Unified one-axis steering input.
 * Exposes `angle` (degrees, may exceed +/-360 for continuous spin) and an
 * optional force-feedback passthrough when a wheel is the active source.
 *
 * Sources (auto-selected by recent activity):
 *  - wheel: absolute rotation
 *  - keyboard: hold Left/Right (or A/D) to rotate continuously
 *  - mouse: pointer X maps to an absolute angle
 *  - touch: relative drag, anchored on touch-down
 */
export class SteeringInput {
  constructor({ keyRate = 540, mouseRange = 540, touchSensitivity = 1, touchDegPerPx = 2.77 } = {}) {
    this.angle = 0;
    this.source = 'keys';
    this.wheel = null;
    this.ffbAvailable = false;
    this.keyRate = keyRate;
    this.mouseRange = mouseRange;
    this.touchSensitivity = Math.max(0.05, Math.min(2, touchSensitivity));
    this.touchDegPerPx = touchDegPerPx;

    this._keys = { left: false, right: false };
    this._pointer = { x: null, width: 1 };
    this._lastWheel = -Infinity;
    this._lastPointer = -Infinity;
    this._pointerKind = 'mouse';
    this._prevWheelRot = null;
    this._pointerAngle = null;
    this._touch = { active: false, id: null, anchorX: 0, anchorAngle: 0 };

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
  }

  _onKey(e, down) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { this._keys.left = down; e.preventDefault(); }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { this._keys.right = down; e.preventDefault(); }
  }

  setPointer(x, width, kind = 'mouse') {
    if (x === null || x === undefined) return;
    this._pointer.x = x;
    this._pointer.width = width || 1;
    this._lastPointer = performance.now();
    this._pointerKind = kind;
  }

  setTouchSensitivity(value) {
    const v = Number(value);
    if (Number.isFinite(v)) this.touchSensitivity = Math.max(0.05, Math.min(2, v));
  }

  reset() {
    this.angle = 0;
    this.source = 'keys';
    this._pointer.x = null;
    this._pointerAngle = null;
    this._lastPointer = -Infinity;
    this._touch.active = false;
    this._touch.id = null;
  }

  touchStart(x, width, id = null) {
    if (x === null || x === undefined) return;
    if (this._touch.active) return;
    this._pointer.x = x;
    this._pointer.width = width || 1;
    this._lastPointer = performance.now();
    this._pointerKind = 'touch';
    this._touch.active = true;
    this._touch.id = id;
    this._touch.anchorX = x;
    this._touch.anchorAngle = this.angle;
    this._pointerAngle = this.angle;
  }

  touchMove(x, width, id = null) {
    if (x === null || x === undefined) return;
    if (!this._touch.active) return;
    if (id !== null && this._touch.id !== null && id !== this._touch.id) return;
    this._pointer.x = x;
    this._pointer.width = width || 1;
    this._lastPointer = performance.now();
    this._pointerKind = 'touch';
    const dx = x - this._touch.anchorX;
    this._pointerAngle = this._touch.anchorAngle + dx * this.touchDegPerPx * this.touchSensitivity;
  }

  touchEnd(id = null) {
    if (!this._touch.active) return;
    if (id !== null && this._touch.id !== null && id !== this._touch.id) return;
    this._touch.active = false;
    this._touch.id = null;
    this._lastPointer = performance.now();
  }

  async connectWheel(opts = {}) {
    this.wheel = new WebHIDWheel({
      maxRotation: opts.maxRotation !== undefined ? opts.maxRotation : 900,
      ffbStrength: opts.ffbStrength !== undefined ? opts.ffbStrength : 0.25
    });
    const dev = await this.wheel.connect();
    if (dev) {
      this.ffbAvailable = true;
      this.source = 'wheel';
      this._prevWheelRot = this.wheel.rotation;
    }
    return dev;
  }

  setFfbStrength(value) {
    if (this.wheel) this.wheel.ffbStrength = value;
  }

  setMaxRotation(value) {
    if (this.wheel) this.wheel.maxRotation = value;
  }

  get ffbActive() {
    return this.source === 'wheel' && this.ffbAvailable;
  }

  update(dt) {
    const now = performance.now();

    if (this.wheel && this.wheel.rotation !== undefined) {
      if (this._prevWheelRot === null || Math.abs(this.wheel.rotation - this._prevWheelRot) > 0.05) {
        this._lastWheel = now;
      }
      this._prevWheelRot = this.wheel.rotation;
    }

    if (this.wheel && now - this._lastWheel < 300) this.source = 'wheel';
    else if (this._keys.left || this._keys.right) this.source = 'keys';
    else if (now - this._lastPointer < 300) this.source = this._pointerKind;

    if (this.source === 'wheel' && this.wheel && this.wheel.rotation !== undefined) {
      this.angle = this.wheel.rotation;
    } else if (this.source === 'touch' && this._pointerAngle !== null) {
      this.angle = this._pointerAngle;
    } else if (this.source === 'mouse' && this._pointer.x !== null) {
      const n = (this._pointer.x / this._pointer.width - 0.5) * 2;
      this.angle = n * this.mouseRange;
    } else if (this.source === 'keys') {
      const dir = (this._keys.right ? 1 : 0) - (this._keys.left ? 1 : 0);
      this.angle += dir * this.keyRate * dt;
    }

    return this.angle;
  }

  applyForce(value) {
    if (this.ffbActive && this.wheel && this.wheel.ffb && this.wheel.ffb.supported.constant) {
      this.wheel.ffb.constant(value).catch(() => {});
    }
  }

  stopFfb() {
    if (this.wheel && this.wheel.ffb) this.wheel.ffb.stop().catch(() => {});
  }
}
