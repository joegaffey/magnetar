const midiToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SECTIONS = [
  [[50, 54, 57], [45, 49, 52], [47, 50, 54], [43, 47, 50]],
  [[52, 56, 59], [47, 51, 54], [49, 52, 56], [45, 49, 52]],
  [[47, 50, 54], [43, 47, 50], [50, 54, 57], [45, 49, 52]],
  [[43, 47, 50], [45, 49, 52], [47, 50, 54], [45, 49, 52]]
];
const ARP = [
  [0, 1, 2, 1],
  [0, 2, 1, 2],
  [0, 1, 2, 0],
  [0, 2, 1, 0]
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.ambient = null;
    this.overheatNode = null;
    this.muted = false;
    this.volume = 0.85;
    this.musicVolume = 0.55;
    this.musicBus = null;
    this.musicDuck = null;
    this.reverb = null;
    this.music = null;
    this._musicTimer = null;
  }

  init() {
    if (navigator.audioSession) {
      try { navigator.audioSession.type = 'playback'; } catch (e) { /* unsupported */ }
    }
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    try {
      const unlock = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = unlock;
      src.connect(this.ctx.destination);
      src.start(0);
    } catch (e) { /* ignore */ }
    this.ctx.addEventListener('statechange', () => {
      if (this.ctx.state === 'interrupted') this.ctx.resume().catch(() => {});
    });
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

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicDuck = this.ctx.createGain();
    this.musicDuck.gain.value = 1;
    this.musicBus.connect(this.musicDuck);
    this.musicDuck.connect(this.master);

    this._makeReverb();
    this._startMusic();

    this._startAmbient();
  }

  unlock() {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
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

  setMusicVolume(volume) {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.05);
    }
  }

  setMusicIntensity(value) {
    if (!this.music) return;
    this.music.intensity = Math.max(0, Math.min(1, value));
    this.music.tempo = 88 + this.music.intensity * 16;
  }

  duck() {
    if (!this.ctx || !this.musicDuck) return;
    const t = this.ctx.currentTime;
    const g = this.musicDuck.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.4, t + 0.02);
    g.linearRampToValueAtTime(1, t + 0.3);
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

  burst(pan = 0) {
    this.whoosh(pan, 1, 0.24, 0.38);
    this.thunk(pan, 0.8);
  }

  score(pan = 0, streak = 0) {
    const base = 880 + Math.min(streak, 12) * 70;
    this._tone(base, { type: 'triangle', dur: 0.1, gain: 0.1, pan, glide: base * 1.03, attack: 0.003 });
    this._tone(base * 1.5, { type: 'sine', dur: 0.16, gain: 0.06, pan, glide: base * 1.5, attack: 0.003 });
  }

  hit(pan = 0, strength = 1) {
    const g = Math.min(1, strength);
    this._tone(2100 + Math.random() * 700, { type: 'triangle', dur: 0.06, gain: 0.06 * g, pan });
    this._noise({ dur: 0.04, gain: 0.05 * g, pan, freq: 4200, q: 1.2, type: 'bandpass' });
  }

  thunk(pan = 0, strength = 1) {
    const g = Math.min(0.55, 0.34 * strength);
    this._tone(140, { type: 'sine', dur: 0.22, gain: g, pan, glide: 55, attack: 0.004 });
    this._tone(205, { type: 'triangle', dur: 0.1, gain: g * 0.45, pan, glide: 90 });
    this._noise({ dur: 0.09, gain: g * 0.55, pan, freq: 520, q: 0.6, type: 'lowpass', sweepTo: 120 });
  }

  damage(pan = 0) {
    this.duck();
    this.thunk(pan, 1.7);
    this._tone(90, { type: 'sine', dur: 0.35, gain: 0.22, pan, glide: 45 });
  }

  explode(scale = 1, pan = 0) {
    this.duck();
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

  _makeReverb() {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * 1.8);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    }
    const conv = this.ctx.createConvolver();
    conv.buffer = buf;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.5;
    conv.connect(wet);
    wet.connect(this.musicBus);
    this.reverb = conv;
  }

  _startMusic() {
    if (this.music) return;
    this.music = { tempo: 92, intensity: 0.2, step: 0, cycle: 0, section: 0, nextTime: this.ctx.currentTime + 0.2 };
    this._musicTimer = setInterval(() => this._scheduleMusic(), 25);
  }

  _scheduleMusic() {
    if (!this.music || !this.ctx) return;
    while (this.music.nextTime < this.ctx.currentTime + 0.12) {
      this._playStep(this.music.step, this.music.nextTime);
      const sixteenth = (60 / this.music.tempo) / 4;
      this.music.nextTime += sixteenth;
      this.music.step = (this.music.step + 1) % 64;
      if (this.music.step === 0) {
        this.music.cycle += 1;
        this.music.section = this.music.cycle % SECTIONS.length;
      }
    }
  }

  _playStep(step, time) {
    const section = this.music.section || 0;
    const bar = Math.floor(step / 16) % 4;
    const beat = step % 16;
    const intensity = this.music.intensity;
    const chord = SECTIONS[section][bar];
    const root = chord[0];
    const beatDur = 60 / this.music.tempo;

    if (beat === 0) {
      for (const n of chord) this._pad(n, time, beatDur * 4 * 0.98);
      this._bass(root - 12, time, beatDur * 2);
      if (section >= 2 && intensity > 0.4) {
        this._bell(chord[2] + 24, time, 0.35);
      }
    }
    if (beat === 8 && section % 2 === 0) {
      this._bass(root - 12, time, beatDur * 2);
    }

    if (beat % 2 === 0) {
      const pattern = ARP[section];
      const idx = pattern[Math.floor(beat / 2) % pattern.length];
      const oct = (Math.floor(step / 8) % 2) ? 24 : 12;
      this._bell(chord[idx] + oct, time, 0.55 + intensity * 0.45);
    }
  }

  _send(node) {
    node.connect(this.musicBus);
    if (this.reverb) node.connect(this.reverb);
  }

  _pad(midi, time, dur) {
    const freq = midiToFreq(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.045, time + 0.6);
    g.gain.setValueAtTime(0.045, time + dur - 0.5);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.6;

    for (const [type, cents] of [['triangle', -5], ['sine', 5]]) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = cents;
      osc.connect(lp);
      osc.start(time);
      osc.stop(time + dur + 0.1);
    }
    lp.connect(g);
    this._send(g);
  }

  _bell(midi, time, vel) {
    const freq = midiToFreq(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.035 * vel, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
    if (p.pan) p.pan.value = (Math.random() * 2 - 1) * 0.5;

    osc.connect(g);
    g.connect(p);
    this._send(p);

    osc.start(time);
    osc.stop(time + 0.55);
  }

  _bass(midi, time, dur) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToFreq(midi);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.09, time + 0.02);
    g.gain.setValueAtTime(0.09, time + dur - 0.15);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;

    osc.connect(lp); lp.connect(g); g.connect(this.musicBus);
    osc.start(time); osc.stop(time + dur + 0.05);
  }

  _startAmbient() {
    const t0 = this.ctx.currentTime;

    const bus = this.ctx.createGain();
    bus.gain.value = 0.0001;
    bus.gain.exponentialRampToValueAtTime(0.04, t0 + 2.5);
    bus.connect(this.master);

    const o1 = this.ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = 55;

    const o2 = this.ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 110;

    const g2 = this.ctx.createGain();
    g2.gain.value = 0.4;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.Q.value = 0.7;

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);

    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(bus);
    o1.start(); o2.start(); lfo.start();

    const msrc = this.ctx.createBufferSource();
    msrc.buffer = this.noiseBuf;
    msrc.loop = true;
    const mf = this.ctx.createBiquadFilter();
    mf.type = 'lowpass';
    mf.frequency.value = 150;
    mf.Q.value = 0.5;
    const mg = this.ctx.createGain();
    mg.gain.value = 0.0001;
    msrc.connect(mf); mf.connect(mg); mg.connect(this.master); msrc.start();

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

    this.ambient = { bus, o1, o2, g2, msrc, mf, mg, tsrc, tf, tg };
  }

  setMass(mass) {
    if (!this.ambient) return;
    const t = this.ctx.currentTime;
    const m = Math.min(Math.max(0, mass - 1), 6);
    this.ambient.mf.frequency.setTargetAtTime(140 + m * 30, t, 0.2);
    this.ambient.mg.gain.setTargetAtTime(0.0001 + m * 0.012, t, 0.2);
  }

  setTransfer(rate) {
    if (!this.ambient) return;
    const t = this.ctx.currentTime;
    const r = Math.max(0, Math.min(1, rate));
    this.ambient.tf.frequency.setTargetAtTime(280 + r * 1200, t, 0.12);
    this.ambient.tg.gain.setTargetAtTime(0.0001 + r * 0.012, t, 0.12);
  }
}
