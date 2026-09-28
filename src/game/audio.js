// Procedural audio (WebAudio, no sample files): weapons, mechanics, footsteps, impacts,
// storm ambience, thunder, alarms, helicopter, SCP-173 scraping, radio chatter.
export class Audio {
  constructor() {
    this.ctx = null; this.enabled = true; this.listener = { pos: [0, 0, 0], yaw: 0 };
    this.loops = {};
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.7; this.amb.connect(this.master);
    this.reverb = ctx.createConvolver(); this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.master);
    this.setSpace('outdoor');
    // shared noise buffers
    this.white = this._noise(2, 'white'); this.brown = this._noise(4, 'brown'); this.pink = this._noise(3, 'pink');
  }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  _noise(seconds, kind) {
    const ctx = this.ctx, n = ctx.sampleRate * seconds, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18; }
        else d[i] = w;
      }
    }
    return b;
  }
  setSpace(kind) {
    if (!this.ctx) return;
    const ctx = this.ctx, len = kind === 'indoor' ? 1.6 : 2.4, n = Math.floor(ctx.sampleRate * len), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const early = kind === 'indoor' && i < ctx.sampleRate * 0.08 ? (Math.random() < 0.004 ? 1 : 0) : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, kind === 'indoor' ? 3.2 : 4.5) + early) * (kind === 'indoor' ? 0.9 : 0.6);
      }
    }
    this.reverb.buffer = b;
    this.reverbGain.gain.value = kind === 'indoor' ? 0.5 : 0.28;
    this.space = kind;
  }

  // ---------------------------------------------------------------- spatial helper
  _spatial(pos, vol = 1, maxDist = 60) {
    const ctx = this.ctx, g = ctx.createGain(), p = ctx.createStereoPanner();
    let gain = vol, pan = 0;
    if (pos) {
      const L = this.listener, dx = pos[0] - L.pos[0], dy = pos[1] - L.pos[1], dz = pos[2] - L.pos[2];
      const d = Math.hypot(dx, dy, dz);
      gain = vol / (1 + d * d / 60) * Math.max(0, 1 - d / maxDist);
      const right = [-Math.cos(L.yaw), 0, Math.sin(L.yaw)];
      pan = d > 0.1 ? Math.max(-1, Math.min(1, (dx * right[0] + dz * right[2]) / d)) : 0;
    }
    g.gain.value = gain; p.pan.value = pan;
    g.connect(p); p.connect(this.sfx);
    return { in: g, gain, send: (amt) => { const s = ctx.createGain(); s.gain.value = amt; p.connect(s); s.connect(this.reverb); } };
  }
  _src(buf, rate = 1, offset = Math.random() * 1.5) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.loop = false; s.start(this.ctx.currentTime, offset % Math.max(0.01, buf.duration - 0.5)); return s; }
  _env(node, t0, a, peak, d, end = 0.0001) { node.gain.setValueAtTime(0.0001, t0); node.gain.exponentialRampToValueAtTime(peak, t0 + a); node.gain.exponentialRampToValueAtTime(Math.max(end, 0.0001), t0 + a + d); }
  _filter(type, f, q = 0.8) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  _tone(freq, dur, { type = 'sine', vol = 0.3, pos = null, slide = 0, delay = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    this._env(g, t, 0.004, vol, dur);
    const sp = this._spatial(pos, 1);
    o.connect(g); g.connect(sp.in); o.start(t); o.stop(t + dur + 0.05);
  }
  _burst(dur, { f = 2000, q = 0.8, type = 'bandpass', vol = 0.4, pos = null, a = 0.002, buf = null, rate = 1, send = 0, delay = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay, s = this._src(buf || this.white, rate), fl = this._filter(type, f, q), g = ctx.createGain();
    this._env(g, t, a, vol, dur);
    const sp = this._spatial(pos, 1);
    s.connect(fl); fl.connect(g); g.connect(sp.in); if (send) sp.send(send);
    s.stop(t + dur + a + 0.05);
  }

  // ---------------------------------------------------------------- weapons
  gunshot(snd, pos = null, { npc = false } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const sup = !!snd.suppressed, v = npc ? 0.8 : 1;
    const sp = this._spatial(pos, v, 120);
    sp.send(sup ? 0.25 : 0.9 * (snd.tail || 1));
    // body: filtered noise punch
    const n = this._src(this.white, 1), lp = this._filter('lowpass', (sup ? 1400 : 5200) * snd.pitch), g = ctx.createGain();
    this._env(g, t, 0.001, (sup ? 0.35 : 0.9) * snd.body, sup ? 0.09 : 0.16 + snd.body * 0.05);
    n.connect(lp); lp.connect(g); g.connect(sp.in); n.stop(t + 0.5);
    // crack: bright transient
    if (!sup || snd.crack > 0.8) {
      const c = this._src(this.white, 1.5), hp = this._filter('highpass', 3000), gc = ctx.createGain();
      this._env(gc, t, 0.0005, (sup ? 0.12 : 0.55) * snd.crack, 0.035);
      c.connect(hp); hp.connect(gc); gc.connect(sp.in); c.stop(t + 0.2);
    }
    // thump
    const o = ctx.createOscillator(), go = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140 * snd.pitch, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    this._env(go, t, 0.002, (sup ? 0.4 : 0.9) * snd.body, 0.2);
    o.connect(go); go.connect(sp.in); o.start(t); o.stop(t + 0.3);
    // mechanical clack (player only)
    if (!npc) this._burst(0.03, { f: 3800 * snd.pitch, q: 4, vol: 0.12, delay: 0.035 });
    // distant echo slap outdoors
    if (this.space === 'outdoor' && !sup) this._burst(0.35, { f: 500, q: 0.6, vol: 0.12 * snd.body * sp.gain, delay: 0.18 + Math.random() * 0.1, type: 'lowpass' });
  }
  dryFire() { this._burst(0.02, { f: 2500, q: 5, vol: 0.2 }); }
  mech(kind) {
    const presets = {
      magOut: [[0.04, 1800, 3, 0.25], [0.05, 900, 2, 0.15, 0.05]],
      magIn: [[0.03, 2200, 4, 0.35], [0.06, 700, 2, 0.25, 0.02]],
      boltRelease: [[0.05, 1500, 3, 0.45], [0.08, 500, 1, 0.3, 0.01]],
      shellIn: [[0.04, 1300, 3, 0.3], [0.04, 3200, 5, 0.1, 0.03]],
      pin: [[0.03, 4200, 6, 0.2], [0.02, 6000, 8, 0.1, 0.06]],
      swap: [[0.06, 1200, 1.5, 0.2], [0.05, 2500, 3, 0.1, 0.08]],
      ads: [[0.04, 900, 1, 0.08]],
      melee: [[0.12, 600, 0.8, 0.35]],
      switch: [[0.02, 3500, 6, 0.25]],
    };
    for (const [d, f, q, v, delay = 0] of presets[kind] || []) this._burst(d, { f, q, vol: v, delay });
  }
  footstep(pos, surface = 'concrete', vol = 0.25, isPlayer = false) {
    const f = surface === 'metal' ? 1600 : surface === 'grass' ? 500 : surface === 'wet' ? 1100 : 800;
    this._burst(0.07, { f, q: 1.2, vol: vol * (isPlayer ? 0.7 : 1), pos: isPlayer ? null : pos, buf: this.pink, rate: 0.8 + Math.random() * 0.4 });
    if (surface === 'metal') this._tone(220 + Math.random() * 40, 0.08, { vol: vol * 0.15, pos: isPlayer ? null : pos, type: 'triangle' });
    if (surface === 'wet') this._burst(0.12, { f: 3000, q: 0.7, vol: vol * 0.3, pos: isPlayer ? null : pos, delay: 0.02 });
  }
  impact(pos, material = 'concrete') {
    if (material === 'metal') { this._tone(1800 + Math.random() * 1500, 0.15, { vol: 0.12, pos, type: 'triangle' }); this._burst(0.04, { f: 4000, vol: 0.12, pos }); }
    else if (material === 'flesh') this._burst(0.08, { f: 300, q: 1, vol: 0.4, pos, type: 'lowpass' });
    else if (material === 'wood') this._burst(0.06, { f: 900, q: 2, vol: 0.2, pos });
    else this._burst(0.05, { f: 1800, q: 1, vol: 0.18, pos });
  }
  whiz(pos) { this._burst(0.12, { f: 2500, q: 3, vol: 0.12, pos, a: 0.03 }); }
  hitmarker(kill = false) { this._tone(kill ? 1600 : 2400, kill ? 0.12 : 0.04, { vol: kill ? 0.15 : 0.08, type: 'square' }); if (kill) this._tone(2200, 0.08, { vol: 0.08, type: 'square', delay: 0.05 }); }
  hurt() { this._burst(0.15, { f: 250, q: 0.8, vol: 0.5, type: 'lowpass', buf: this.brown }); }
  explosion(pos) {
    if (!this.ctx) return;
    const sp = this._spatial(pos, 1.6, 200); sp.send(1);
    const t = this.ctx.currentTime, s = this._src(this.brown, 0.8), f = this._filter('lowpass', 900), g = this.ctx.createGain();
    this._env(g, t, 0.005, 1.2, 1.4);
    s.connect(f); f.connect(g); g.connect(sp.in); s.stop(t + 2);
    this._burst(0.2, { f: 3000, vol: 0.5, pos, type: 'highpass' });
  }
  neckSnap(pos) { this._burst(0.03, { f: 3500, q: 2, vol: 0.9, pos }); this._burst(0.06, { f: 900, q: 3, vol: 0.6, pos, delay: 0.02 }); this._tone(90, 0.3, { vol: 0.5, pos, slide: -40 }); }
  scrape(pos, vol = 0.45) { this._burst(0.35 + Math.random() * 0.2, { f: 700 + Math.random() * 300, q: 2.2, vol, pos, buf: this.pink, rate: 0.5, a: 0.02, send: 0.4 }); }
  squelch() { this._burst(0.08, { f: 2200, q: 0.5, vol: 0.12 }); this._tone(1200, 0.05, { vol: 0.05, delay: 0.08, type: 'square' }); }
  beep(f = 880) { this._tone(f, 0.08, { vol: 0.1, type: 'square' }); }
  heartbeat() { this._tone(55, 0.12, { vol: 0.35 }); this._tone(50, 0.12, { vol: 0.25, delay: 0.18 }); }
  thunder(dist = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + dist * 0.8, s = this._src(this.brown, 0.5), f = this._filter('lowpass', 600 - dist * 300), g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.1 - dist * 0.5, t + 0.08); g.gain.exponentialRampToValueAtTime(0.4, t + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5 + dist);
    s.connect(f); f.connect(g); g.connect(this.amb); s.stop(t + 5);
    if (dist < 0.4) this._burst(0.08, { f: 4000, vol: 0.6, type: 'highpass', delay: dist * 0.8 });
  }
  door(pos, open = true) { this._burst(1.6, { f: 180, q: 0.8, vol: 0.5, pos, buf: this.brown, a: 0.2 }); this._tone(open ? 90 : 70, 1.5, { vol: 0.2, pos, type: 'sawtooth', slide: open ? 30 : -20 }); }
  powerUp() { this._tone(60, 2.5, { vol: 0.35, type: 'sawtooth', slide: 60 }); this._burst(0.2, { f: 400, vol: 0.4, type: 'lowpass', delay: 0.05 }); for (let i = 0; i < 6; i++) this._burst(0.05, { f: 5000, q: 2, vol: 0.2, delay: 0.4 + i * 0.22 }); }
  flickerBuzz(pos) { this._tone(120, 0.1, { vol: 0.06, pos, type: 'sawtooth' }); }
  blink() { this._burst(0.05, { f: 600, vol: 0.05, type: 'lowpass' }); }

  // ---------------------------------------------------------------- loops
  loop(name, make) { if (!this.ctx || this.loops[name]) return this.loops[name]; this.loops[name] = make(); return this.loops[name]; }
  setLoop(name, vol, ramp = 0.8) { const l = this.loops[name]; if (l) l.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, ramp / 3); }
  rainLoop() {
    return this.loop('rain', () => {
      const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.pink; s.loop = true;
      const hp = this._filter('highpass', 900), lp = this._filter('lowpass', 7000), gain = ctx.createGain(); gain.gain.value = 0;
      s.connect(hp); hp.connect(lp); lp.connect(gain); gain.connect(this.amb); s.start();
      const s2 = ctx.createBufferSource(); s2.buffer = this.brown; s2.loop = true; const g2 = ctx.createGain(); g2.gain.value = 0.25; s2.connect(g2); g2.connect(gain); s2.start();
      return { gain };
    });
  }
  windLoop() {
    return this.loop('wind', () => {
      const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.brown; s.loop = true;
      const bp = this._filter('bandpass', 300, 0.6), gain = ctx.createGain(); gain.gain.value = 0;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.13; lg.gain.value = 180; lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
      s.connect(bp); bp.connect(gain); gain.connect(this.amb); s.start();
      return { gain };
    });
  }
  alarmLoop() {
    return this.loop('alarm', () => {
      const ctx = this.ctx, o = ctx.createOscillator(), o2 = ctx.createOscillator(), gain = ctx.createGain(), mix = ctx.createGain(); gain.gain.value = 0; mix.gain.value = 0.12;
      o.type = 'square'; o2.type = 'square'; o.frequency.value = 620; o2.frequency.value = 465;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.type = 'square'; lfo.frequency.value = 0.9; lg.gain.value = 160; lfo.connect(lg); lg.connect(o.frequency); lfo.start();
      const lp = this._filter('lowpass', 1800);
      o.connect(mix); mix.connect(lp); lp.connect(gain); gain.connect(this.amb); o.start();
      const send = ctx.createGain(); send.gain.value = 0.6; gain.connect(send); send.connect(this.reverb);
      void o2;
      return { gain };
    });
  }
  humLoop() {
    return this.loop('hum', () => {
      const ctx = this.ctx, o = ctx.createOscillator(), o2 = ctx.createOscillator(), gain = ctx.createGain(); gain.gain.value = 0;
      o.frequency.value = 60; o2.frequency.value = 120; o2.type = 'sawtooth';
      const g2 = ctx.createGain(); g2.gain.value = 0.08; const lp = this._filter('lowpass', 400);
      o.connect(gain); o2.connect(g2); g2.connect(lp); lp.connect(gain); gain.connect(this.amb); o.start(); o2.start();
      return { gain };
    });
  }
  droneLoop() {
    return this.loop('drone', () => {
      const ctx = this.ctx, gain = ctx.createGain(); gain.gain.value = 0;
      for (const f of [41, 61.5, 82.3]) { const o = ctx.createOscillator(); o.frequency.value = f; o.type = 'sine'; const g = ctx.createGain(); g.gain.value = 0.2; o.connect(g); g.connect(gain); o.start(); }
      const s = ctx.createBufferSource(); s.buffer = this.brown; s.loop = true; const bp = this._filter('bandpass', 120, 1); const g = ctx.createGain(); g.gain.value = 0.4; s.connect(bp); bp.connect(g); g.connect(gain); s.start();
      gain.connect(this.amb);
      return { gain };
    });
  }
  heliLoop() {
    return this.loop('heli', () => {
      const ctx = this.ctx, gain = ctx.createGain(); gain.gain.value = 0;
      const s = ctx.createBufferSource(); s.buffer = this.brown; s.loop = true;
      const lp = this._filter('lowpass', 500), am = ctx.createGain(); am.gain.value = 0.5;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 4.6; lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain); lfo.start();
      s.connect(lp); lp.connect(am); am.connect(gain); s.start();
      const w = ctx.createOscillator(), wg = ctx.createGain(); w.type = 'sawtooth'; w.frequency.value = 1320; wg.gain.value = 0.012; const wl = this._filter('bandpass', 1400, 4); w.connect(wl); wl.connect(wg); wg.connect(gain); w.start();
      gain.connect(this.amb);
      this.heliLfo = lfo;
      return { gain };
    });
  }
  stopAll() { for (const k of Object.keys(this.loops)) this.setLoop(k, 0, 0.5); }
}
export const audio = new Audio();
