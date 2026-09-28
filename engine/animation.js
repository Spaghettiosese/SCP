// Keyframe animation: clips, tracks, sampling, pose blending and a mixer with
// phase-synchronised crossfades (feet stay in step when blending walk <-> run).
import { quat, clamp } from './math.js';

export const INTERP = ['smooth', 'linear', 'step'];

// Clip JSON: { name, duration, loop, rootMotion:[vx,vy,vz] (m/s), syncGroup,
//   tracks:[{ bone, type:'rotation'|'position', interp, keys:[{t, v:[x,y,z]}] }], events:[{t,name}] }
export class Clip {
  constructor(def = {}) {
    this.name = def.name || 'Action';
    this.duration = def.duration ?? 1;
    this.loop = def.loop ?? true;
    this.rootMotion = def.rootMotion || [0, 0, 0];
    this.syncGroup = def.syncGroup || null;
    this.tracks = (def.tracks || []).map((t) => ({ bone: t.bone, type: t.type || 'rotation', interp: t.interp || 'smooth', keys: t.keys.map((k) => ({ t: k.t, v: [...k.v] })).sort((a, b) => a.t - b.t) }));
    this.events = (def.events || []).map((e) => ({ ...e }));
  }
  track(bone, type = 'rotation', create = false) {
    let t = this.tracks.find((x) => x.bone === bone && x.type === type);
    if (!t && create) { t = { bone, type, interp: 'smooth', keys: [] }; this.tracks.push(t); }
    return t;
  }
  setKey(bone, type, time, v) {
    const tr = this.track(bone, type, true);
    const k = tr.keys.find((k) => Math.abs(k.t - time) < 1e-4);
    if (k) k.v = [...v]; else { tr.keys.push({ t: time, v: [...v] }); tr.keys.sort((a, b) => a.t - b.t); }
  }
  removeKey(bone, type, time) {
    const tr = this.track(bone, type);
    if (!tr) return;
    tr.keys = tr.keys.filter((k) => Math.abs(k.t - time) >= 1e-4);
    if (!tr.keys.length) this.tracks.splice(this.tracks.indexOf(tr), 1);
  }
  keyTimes() { const s = new Set(); for (const t of this.tracks) for (const k of t.keys) s.add(+k.t.toFixed(4)); return [...s].sort((a, b) => a - b); }
  toJSON() {
    const r = (v) => Math.round(v * 1e4) / 1e4;
    return { name: this.name, duration: this.duration, loop: this.loop, rootMotion: this.rootMotion, syncGroup: this.syncGroup, events: this.events, tracks: this.tracks.map((t) => ({ bone: t.bone, type: t.type, interp: t.interp, keys: t.keys.map((k) => ({ t: r(k.t), v: k.v.map(r) })) })) };
  }
}

// Sample one track at time t -> [x,y,z]
export function sampleTrack(track, t, duration, loop, out = [0, 0, 0]) {
  const K = track.keys;
  if (!K.length) return out;
  if (K.length === 1) { out[0] = K[0].v[0]; out[1] = K[0].v[1]; out[2] = K[0].v[2]; return out; }
  // for loops, a key sitting exactly at `duration` duplicates the key at 0
  let keys = K;
  if (loop && K.length > 1 && Math.abs(K[K.length - 1].t - duration) < 1e-4 && Math.abs(K[0].t) < 1e-4) keys = K.slice(0, -1);
  const n = keys.length;
  if (n === 1) { out[0] = keys[0].v[0]; out[1] = keys[0].v[1]; out[2] = keys[0].v[2]; return out; }
  // key accessor with wrap-around for loops
  const key = (i) => {
    if (!loop) return keys[clamp(i, 0, n - 1)];
    const w = Math.floor(i / n), j = i - w * n;
    return { t: keys[j].t + w * duration, v: keys[j].v };
  };
  let i;
  if (loop) {
    // find segment containing t among keys (wrapping past the last key)
    i = n - 1;
    for (let k = 0; k < n; k++) if (keys[k].t > t) { i = k - 1; break; }
  } else {
    if (t <= keys[0].t) { const v = keys[0].v; out[0] = v[0]; out[1] = v[1]; out[2] = v[2]; return out; }
    if (t >= keys[n - 1].t) { const v = keys[n - 1].v; out[0] = v[0]; out[1] = v[1]; out[2] = v[2]; return out; }
    i = 0;
    while (i < n - 1 && keys[i + 1].t <= t) i++;
  }
  const k1 = key(i), k2 = key(i + 1);
  const span = k2.t - k1.t || 1e-6;
  const f = clamp((t - k1.t) / span, 0, 1);
  if (track.interp === 'step') { out[0] = k1.v[0]; out[1] = k1.v[1]; out[2] = k1.v[2]; return out; }
  if (track.interp === 'linear') { for (let c = 0; c < 3; c++) out[c] = k1.v[c] + (k2.v[c] - k1.v[c]) * f; return out; }
  // smooth: non-uniform Catmull-Rom (cardinal) spline -> C1 continuous, seamless loops
  const k0 = key(i - 1), k3 = key(i + 2);
  const f2 = f * f, f3 = f2 * f;
  const h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
  for (let c = 0; c < 3; c++) {
    const d1 = ((k2.v[c] - k0.v[c]) / Math.max(1e-6, k2.t - k0.t)) * span;
    const d2 = ((k3.v[c] - k1.v[c]) / Math.max(1e-6, k3.t - k1.t)) * span;
    out[c] = h00 * k1.v[c] + h10 * d1 + h01 * k2.v[c] + h11 * d2;
  }
  return out;
}

export function createPose(n) { const p = { rot: new Float32Array(n * 4), pos: new Float32Array(n * 3) }; for (let i = 0; i < n; i++) p.rot[i * 4 + 3] = 1; return p; }

// Evaluate a clip into a pose (bones without tracks keep the rest pose)
export function sampleClip(clip, skeleton, time, pose = createPose(skeleton.length)) {
  const v = [0, 0, 0], q = quat.create();
  for (let i = 0; i < skeleton.length; i++) { pose.rot.set([0, 0, 0, 1], i * 4); pose.pos.set([0, 0, 0], i * 3); }
  for (const tr of clip.tracks) {
    const i = skeleton.boneIndex(tr.bone);
    if (i < 0) continue;
    sampleTrack(tr, time, clip.duration, clip.loop, v);
    if (tr.type === 'rotation') pose.rot.set(quat.fromEuler(q, v[0], v[1], v[2]), i * 4);
    else pose.pos.set(v, i * 3);
  }
  return pose;
}

// Weighted accumulation of poses (nlerp for rotations — commutative and stable for N inputs)
export function blendPoses(out, poses, weights) {
  const n = out.rot.length / 4;
  out.rot.fill(0); out.pos.fill(0);
  let total = 0; for (const w of weights) total += w;
  if (total <= 1e-6) { for (let i = 0; i < n; i++) out.rot[i * 4 + 3] = 1; return out; }
  for (let p = 0; p < poses.length; p++) {
    const w = weights[p] / total; if (w <= 0) continue;
    const R = poses[p].rot, P = poses[p].pos;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const s = out.rot[o] * R[o] + out.rot[o + 1] * R[o + 1] + out.rot[o + 2] * R[o + 2] + out.rot[o + 3] * R[o + 3] < 0 ? -w : w;
      out.rot[o] += R[o] * s; out.rot[o + 1] += R[o + 1] * s; out.rot[o + 2] += R[o + 2] * s; out.rot[o + 3] += R[o + 3] * s;
      out.pos[i * 3] += P[i * 3] * w; out.pos[i * 3 + 1] += P[i * 3 + 1] * w; out.pos[i * 3 + 2] += P[i * 3 + 2] * w;
    }
  }
  for (let i = 0; i < n; i++) { const o = i * 4, l = Math.hypot(out.rot[o], out.rot[o + 1], out.rot[o + 2], out.rot[o + 3]) || 1; for (let c = 0; c < 4; c++) out.rot[o + c] /= l; }
  return out;
}

const easeInOut = (t) => t * t * (3 - 2 * t);

export class Action {
  constructor(clip) { this.clip = clip; this.time = 0; this.speed = 1; this.weight = 0; this.from = 0; this.to = 0; this.fadeT = 1; this.fadeDur = 0; this.playing = true; }
  get phase() { return this.clip.duration ? this.time / this.clip.duration : 0; }
}

export class Mixer {
  constructor(skeleton, clips = []) {
    this.skeleton = skeleton;
    this.clips = new Map();
    this.actions = new Map();
    this.timeScale = 1;
    this.listeners = [];
    this.pose = createPose(skeleton.length);
    this._tmp = [];
    clips.forEach((c) => this.addClip(c));
  }
  addClip(c) { const clip = c instanceof Clip ? c : new Clip(c); this.clips.set(clip.name, clip); this.actions.set(clip.name, new Action(clip)); return clip; }
  removeClip(name) { this.clips.delete(name); this.actions.delete(name); }
  on(fn) { this.listeners.push(fn); return () => (this.listeners = this.listeners.filter((f) => f !== fn)); }
  action(name) { return this.actions.get(name); }
  // Crossfade to one clip. Clips sharing a syncGroup keep their normalized phase.
  play(name, { fade = 0.35, restart = false, speed } = {}) {
    const a = this.actions.get(name);
    if (!a) return;
    const current = this.dominant();
    if (restart || (!a.weight && !(current && current.clip.syncGroup && current.clip.syncGroup === a.clip.syncGroup))) a.time = 0;
    if (current && current !== a && current.clip.syncGroup && current.clip.syncGroup === a.clip.syncGroup) a.time = current.phase * a.clip.duration;
    if (speed !== undefined) a.speed = speed;
    a.playing = true;
    for (const b of this.actions.values()) this._fadeTo(b, b === a ? 1 : 0, fade);
  }
  // Direct blend-tree control: setWeights({ walk: 0.3, run: 0.7 })
  // Blend-tree control, safe to call every frame: weights move toward their targets at a
  // steady rate (full swing in `fade` seconds) instead of restarting an eased fade.
  setWeights(map, fade = 0.2) {
    for (const [n, b] of this.actions) {
      b.to = map[n] || 0; b.fadeT = 1; b.track = fade > 0 ? 1 / fade : Infinity;
      if (b.to > 0 && b.weight === 0 && !(b.clip.syncGroup && this.dominant()?.clip.syncGroup === b.clip.syncGroup)) b.time = 0;
      if (b.to > 0 && b.weight === 0) { const d = this.dominant(); if (d && d !== b && d.clip.syncGroup && d.clip.syncGroup === b.clip.syncGroup) b.time = d.phase * b.clip.duration; }
    }
  }
  _fadeTo(a, target, dur) {
    a.track = 0;
    if (a.to === target && a.fadeT < 1) return;
    a.from = a.weight; a.to = target; a.fadeDur = dur; a.fadeT = dur > 0 ? 0 : 1;
    if (dur <= 0) a.weight = target;
  }
  dominant() { let best = null; for (const a of this.actions.values()) if (!best || a.weight > best.weight || (a.weight === best.weight && a.to > best.to)) best = a; return best && (best.weight > 0 || best.to > 0) ? best : null; }
  stop() { for (const a of this.actions.values()) { a.weight = 0; a.to = 0; a.fadeT = 1; } }
  setTime(name, t) { const a = this.actions.get(name); if (a) a.time = t; }

  update(dt) {
    dt *= this.timeScale;
    // weights
    for (const a of this.actions.values()) {
      if (a.track) { const step = dt * a.track; a.weight += Math.max(-step, Math.min(step, a.to - a.weight)); }
      else if (a.fadeT < 1) { a.fadeT = Math.min(1, a.fadeT + dt / a.fadeDur); a.weight = a.from + (a.to - a.from) * easeInOut(a.fadeT); }
    }
    // sync groups: shared phase rate = weighted mean of member rates
    const groups = new Map();
    for (const a of this.actions.values()) {
      if (a.weight <= 0 && a.to <= 0) continue;
      const g = a.clip.syncGroup;
      if (g) { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(a); }
    }
    const advanced = new Set();
    for (const members of groups.values()) {
      let wsum = 0, rate = 0;
      for (const a of members) { const w = Math.max(a.weight, 1e-4); wsum += w; rate += (w * a.speed) / a.clip.duration; }
      rate /= wsum;
      const lead = members.reduce((b, a) => (a.weight > b.weight ? a : b));
      const ph0 = lead.phase, ph1 = ph0 + rate * dt;
      for (const a of members) { this._events(a, ph0 * a.clip.duration, ph1 * a.clip.duration, a === lead); a.time = (((ph1 % 1) + 1) % 1) * a.clip.duration; advanced.add(a); }
    }
    for (const a of this.actions.values()) {
      if (advanced.has(a) || (a.weight <= 0 && a.to <= 0) || !a.playing) continue;
      const t0 = a.time; let t1 = t0 + dt * a.speed;
      this._events(a, t0, t1, a === this.dominant());
      if (a.clip.loop) t1 = ((t1 % a.clip.duration) + a.clip.duration) % a.clip.duration; else t1 = clamp(t1, 0, a.clip.duration);
      a.time = t1;
    }
    return this.evaluate();
  }
  _events(a, t0, t1, fire) {
    if (!fire || !a.clip.events.length || !this.listeners.length || a.weight < 0.3) return;
    const d = a.clip.duration;
    for (const e of a.clip.events) {
      for (let wrap = 0; wrap <= 1; wrap++) { const et = e.t + wrap * d; if (et > t0 && et <= t1) this.listeners.forEach((f) => f(e, a)); }
    }
  }
  evaluate() {
    const active = [...this.actions.values()].filter((a) => a.weight > 1e-4);
    while (this._tmp.length < active.length) this._tmp.push(createPose(this.skeleton.length));
    const poses = active.map((a, k) => sampleClip(a.clip, this.skeleton, a.time, this._tmp[k]));
    blendPoses(this.pose, poses, active.map((a) => a.weight));
    this.skeleton.copyPose(this.pose);
    this.skeleton.update();
    return this.pose;
  }
  // Weighted root-motion velocity (m/s in character space) for moving the character.
  rootVelocity(out = [0, 0, 0]) {
    out[0] = out[1] = out[2] = 0; let ws = 0;
    for (const a of this.actions.values()) { if (a.weight <= 0) continue; ws += a.weight; for (let k = 0; k < 3; k++) out[k] += a.clip.rootMotion[k] * a.weight * a.speed * this.timeScale; }
    if (ws > 0) for (let k = 0; k < 3; k++) out[k] /= ws;
    return out;
  }
}
