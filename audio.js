export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.ambient = null;
    this.overheatNode = null;
    this.muted = false;
    this.volume = 0.6;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;

    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    const len = Math.floor(this.ctx.sampleRate * 1.0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this._startAmbient();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.03);
    }
  }

  _pan(pan) {
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      return p;
    }
    return this.ctx.createGain();
  }

  _env(gain, t0, attack, dur, peak) {
    const g = gain.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  _tone(freq, { type = 'sine', dur = 0.2, gain = 0.2, pan = 0, glide = null, attack = 0.005 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glide), t0 + dur);

    const g = this.ctx.createGain();
    this._env(g, t0, attack, dur, gain);
    const p = this._pan(pan);

    osc.connect(g); g.connect(p); p.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noise({ dur = 0.2, gain = 0.2, pan = 0, freq = 1000, q = 0.7, type = 'bandpass', sweepTo = null } = {}) {
    if (!this.ctx || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);

    const g = this.ctx.createGain();
    this._env(g, t0, 0.004, dur, gain);
    const p = this._pan(pan);

    src.connect(f); f.connect(g); g.connect(p); p.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  catch(pol, pan = 0) {
    this._tone(pol ? 470 : 330, { type: 'triangle', dur: 0.16, gain: 0.18, pan, glide: pol ? 560 : 400 });
    this._noise({ dur: 0.05, gain: 0.05, pan, freq: 2600, q: 1.2 });
  }

  burst(pol, pan = 0) {
    this._tone(pol ? 620 : 430, { type: 'square', dur: 0.22, gain: 0.16, pan, glide: 180 });
    this._noise({ dur: 0.3, gain: 0.22, pan, freq: 1800, q: 0.6, sweepTo: 300 });
    this.heal(pan);
  }

  explode(scale = 1, pan = 0) {
    this._tone(90 / scale, { type: 'sine', dur: 0.35 * scale, gain: 0.3, pan, glide: 40 });
    this._noise({ dur: 0.4 * scale, gain: 0.26, pan, freq: 900, q: 0.5, sweepTo: 120 });
  }

  shed(pan = 0) {
    this._noise({ dur: 0.22, gain: 0.11, pan, freq: 1400, q: 0.8, sweepTo: 300 });
  }

  damage(pan = 0) {
    this._tone(180, { type: 'sawtooth', dur: 0.3, gain: 0.2, pan, glide: 70 });
    this._noise({ dur: 0.2, gain: 0.16, pan, freq: 300, type: 'lowpass', sweepTo: 80 });
  }

  absorb(pan = 0) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - (this._lastAbsorb || 0) < 0.08) return;
    this._lastAbsorb = now;
    this._tone(1100 + Math.random() * 700, { type: 'sine', dur: 0.06, gain: 0.035, pan });
  }

  heal(pan = 0) {
    this._tone(520, { type: 'sine', dur: 0.28, gain: 0.12, pan, glide: 780 });
  }

  gameOver() {
    this.overheat(false);
    this._tone(220, { type: 'sawtooth', dur: 0.85, gain: 0.2, glide: 60 });
    this._noise({ dur: 0.8, gain: 0.14, freq: 500, sweepTo: 80 });
  }

  overheat(on) {
    if (!this.ctx) return;
    if (on && !this.overheatNode) {
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 170;

      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 6;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 35;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.2);

      osc.connect(g); g.connect(this.master);
      osc.start(); lfo.start();
      this.overheatNode = { osc, lfo, g };
    } else if (!on && this.overheatNode) {
      const { osc, lfo, g } = this.overheatNode;
      const t0 = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t0);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
      osc.stop(t0 + 0.2);
      lfo.stop(t0 + 0.2);
      this.overheatNode = null;
    }
  }

  _startAmbient() {
    const t0 = this.ctx.currentTime;

    const bus = this.ctx.createGain();
    bus.gain.value = 0.0001;
    bus.gain.exponentialRampToValueAtTime(0.08, t0 + 2.5);
    bus.connect(this.master);

    const o1 = this.ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = 55;

    const o2 = this.ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = 82.4;
    o2.detune.value = 6;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 0.7;

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);

    o1.connect(lp); o2.connect(lp); lp.connect(bus);
    o1.start(); o2.start(); lfo.start();

    const mo = this.ctx.createOscillator();
    mo.type = 'sine';
    mo.frequency.value = 60;
    const mg = this.ctx.createGain();
    mg.gain.value = 0.0001;
    mo.connect(mg); mg.connect(this.master); mo.start();

    const to = this.ctx.createOscillator();
    to.type = 'sawtooth';
    to.frequency.value = 170;
    const tf = this.ctx.createBiquadFilter();
    tf.type = 'bandpass';
    tf.frequency.value = 600;
    tf.Q.value = 2;
    const tg = this.ctx.createGain();
    tg.gain.value = 0.0001;
    to.connect(tf); tf.connect(tg); tg.connect(this.master); to.start();

    this.ambient = { bus, o1, o2, mo, mg, to, tg };
  }

  setMass(mass) {
    if (!this.ambient) return;
    const t = this.ctx.currentTime;
    const m = Math.min(Math.max(0, mass - 1), 6);
    this.ambient.mo.frequency.setTargetAtTime(55 + m * 22, t, 0.2);
    this.ambient.mg.gain.setTargetAtTime(0.0001 + m * 0.008, t, 0.2);
  }

  setTension(tension) {
    if (!this.ambient) return;
    const t = this.ctx.currentTime;
    const v = Math.max(0, Math.min(1, tension));
    this.ambient.to.frequency.setTargetAtTime(160 + v * 120, t, 0.2);
    this.ambient.tg.gain.setTargetAtTime(0.0001 + v * 0.02, t, 0.2);
  }
}
