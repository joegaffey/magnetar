export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.ambient = null;
    this.overheatNode = null;
    this.muted = false;
    this.volume = 0.85;
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
    comp.threshold.value = -8;
    comp.knee.value = 20;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.3;

    const makeup = this.ctx.createGain();
    makeup.gain.value = 1.3;

    this.master.connect(comp);
    comp.connect(makeup);
    makeup.connect(this.ctx.destination);

    const len = Math.floor(this.ctx.sampleRate * 2);
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

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && this.ctx && !this.muted) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
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
    this._env(g, t0, 0.01, dur, gain);
    const p = this._pan(pan);

    src.connect(f); f.connect(g); g.connect(p); p.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  whoosh(pan, dir, gain, dur) {
    const f1 = dir > 0 ? 350 : 1900;
    const f2 = dir > 0 ? 1900 : 350;
    this._noise({ dur, gain, pan, freq: f1, q: 0.9, type: 'bandpass', sweepTo: f2 });
  }

  catch(pan = 0) {
    this.whoosh(pan, 1, 0.15, 0.24);
  }

  shed(pan = 0) {
    this.whoosh(pan, -1, 0.1, 0.28);
  }

  burst(pan = 0) {
    this.whoosh(pan, 1, 0.24, 0.38);
    this.thunk(pan, 0.8);
  }

  thunk(pan = 0, strength = 1) {
    const g = Math.min(0.55, 0.34 * strength);
    this._tone(140, { type: 'sine', dur: 0.22, gain: g, pan, glide: 55, attack: 0.004 });
    this._tone(205, { type: 'triangle', dur: 0.1, gain: g * 0.45, pan, glide: 90 });
    this._noise({ dur: 0.09, gain: g * 0.55, pan, freq: 520, q: 0.6, type: 'lowpass', sweepTo: 120 });
  }

  damage(pan = 0) {
    this.thunk(pan, 1.7);
    this._tone(90, { type: 'sine', dur: 0.35, gain: 0.22, pan, glide: 45 });
  }

  explode(scale = 1, pan = 0) {
    const k = Math.sqrt(scale);
    this._tone(75 / k, { type: 'sine', dur: 0.8 * scale, gain: 0.58, pan, glide: 26, attack: 0.008 });
    this._tone(135 / k, { type: 'triangle', dur: 0.5 * scale, gain: 0.2, pan, glide: 45 });
    this._noise({ dur: 0.8 * scale, gain: 0.28, pan, freq: 420, q: 0.5, type: 'lowpass', sweepTo: 45 });
  }

  gameOver() {
    this.overheat(false);
    this._tone(110, { type: 'sine', dur: 1.1, gain: 0.3, glide: 38 });
    this._tone(55, { type: 'triangle', dur: 1.3, gain: 0.21, glide: 28 });
    this._noise({ dur: 1.0, gain: 0.14, freq: 300, type: 'lowpass', sweepTo: 60 });
  }

  overheat(on) {
    if (!this.ctx) return;
    if (on && !this.overheatNode) {
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 72;

      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 4;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 10;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.045, t0 + 0.25);

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
    bus.gain.exponentialRampToValueAtTime(0.055, t0 + 2.5);
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
    lp.frequency.value = 190;
    lp.Q.value = 0.7;

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 50;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);

    o1.connect(lp); o2.connect(lp); lp.connect(bus);
    o1.start(); o2.start(); lfo.start();

    const mo = this.ctx.createOscillator();
    mo.type = 'sine';
    mo.frequency.value = 58;
    const mg = this.ctx.createGain();
    mg.gain.value = 0.0001;
    mo.connect(mg); mg.connect(this.master); mo.start();

    const tsrc = this.ctx.createBufferSource();
    tsrc.buffer = this.noiseBuf;
    tsrc.loop = true;
    const tf = this.ctx.createBiquadFilter();
    tf.type = 'bandpass';
    tf.frequency.value = 600;
    tf.Q.value = 0.9;
    const tg = this.ctx.createGain();
    tg.gain.value = 0.0001;
    tsrc.connect(tf); tf.connect(tg); tg.connect(this.master); tsrc.start();

    this.ambient = { bus, o1, o2, mo, mg, tsrc, tf, tg };
  }

  setMass(mass) {
    if (!this.ambient) return;
    const t = this.ctx.currentTime;
    const m = Math.min(Math.max(0, mass - 1), 6);
    this.ambient.mo.frequency.setTargetAtTime(55 + m * 20, t, 0.2);
    this.ambient.mg.gain.setTargetAtTime(0.0001 + m * 0.007, t, 0.2);
  }

  setTransfer(rate) {
    if (!this.ambient) return;
    const t = this.ctx.currentTime;
    const r = Math.max(0, Math.min(1, rate));
    this.ambient.tf.frequency.setTargetAtTime(280 + r * 1200, t, 0.12);
    this.ambient.tg.gain.setTargetAtTime(0.0001 + r * 0.012, t, 0.12);
  }
}
