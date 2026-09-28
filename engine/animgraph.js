// Higher-level animation: blend spaces (1D and 2D), a state machine with conditional and
// timed transitions, procedural look-at and foot placement, spring-based hit reactions,
// and a small tween library for animating any object (doors, props, cameras, UI values).
import { vec3, quat, mat4, clamp } from './math.js';
import { twoBoneIK, setWorldRotation } from './ik.js';

// ------------------------------------------------------------------ blend spaces
// 1D: points [{ clip, x }], e.g. Idle 0, Walk 1.15, Run 2.9 by speed.
export class BlendSpace1D {
  constructor(mixer, points) { this.mixer = mixer; this.points = [...points].sort((a, b) => a.x - b.x); this.x = 0; }
  weights(x = this.x) {
    const P = this.points, w = {};
    for (const p of P) w[p.clip] = 0;
    if (x <= P[0].x) { w[P[0].clip] = 1; return w; }
    if (x >= P[P.length - 1].x) { w[P[P.length - 1].clip] = 1; return w; }
    for (let i = 0; i < P.length - 1; i++) if (x >= P[i].x && x <= P[i + 1].x) {
      const t = (x - P[i].x) / (P[i + 1].x - P[i].x || 1); w[P[i].clip] += 1 - t; w[P[i + 1].clip] += t; break;
    }
    return w;
  }
  set(x, fade = 0.15) { this.x = x; this.mixer.setWeights(this.weights(x), fade); return this; }
}
// 2D: points [{ clip, x, y }], weights by gradient-band interpolation (smooth, no triangulation,
// works for any point layout). Typical: x = sideways speed, y = forward speed.
export class BlendSpace2D {
  constructor(mixer, points) { this.mixer = mixer; this.points = points; this.x = 0; this.y = 0; }
  weights(x = this.x, y = this.y) {
    const P = this.points, n = P.length, raw = new Array(n).fill(0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let w = 1;
      const px = x - P[i].x, py = y - P[i].y;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const ex = P[j].x - P[i].x, ey = P[j].y - P[i].y, l2 = ex * ex + ey * ey;
        if (l2 < 1e-9) continue;
        w = Math.min(w, clamp(1 - (px * ex + py * ey) / l2, 0, 1));
        if (w <= 0) break;
      }
      raw[i] = w; sum += w;
    }
    const out = {};
    for (let i = 0; i < n; i++) out[P[i].clip] = (out[P[i].clip] || 0) + (sum > 0 ? raw[i] / sum : i === 0 ? 1 : 0);
    return out;
  }
  set(x, y, fade = 0.15) { this.x = x; this.y = y; this.mixer.setWeights(this.weights(x, y), fade); return this; }
}

// ------------------------------------------------------------------ state machine
// states: { Name: { clip, speed, fade, restart } | { blend: BlendSpace, input: (params) => [x, y] }
//           plus optional onEnter(sm), onExit(sm), update(sm, dt) }
// transitions: [{ from: 'Name' | '*' | ['A','B'], to, when: (params, sm) => bool,
//                 exitTime: 0..1 (normalized clip time before it may fire), fade }]
// Triggers (sm.trigger('jump')) are params that reset once a transition consumes them.
export class AnimStateMachine {
  constructor(mixer, { states, transitions = [], params = {}, initial }) {
    this.mixer = mixer; this.states = states; this.transitions = transitions;
    this.params = { ...params }; this._triggers = new Set();
    this.current = null; this.time = 0; this.history = []; this.listeners = [];
    this.enter(initial || Object.keys(states)[0], 0);
  }
  set(name, value) { this.params[name] = value; return this; }
  trigger(name) { this.params[name] = true; this._triggers.add(name); return this; }
  on(fn) { this.listeners.push(fn); }
  get state() { return this.states[this.current]; }
  get normalizedTime() {
    const s = this.state;
    if (s && s.clip) { const a = this.mixer.action(s.clip); return a ? (a.clip.loop ? this.time / a.clip.duration : Math.min(1, a.time / a.clip.duration)) : 0; }
    return this.time;
  }
  enter(name, fade) {
    const prev = this.current, s = this.states[name];
    if (!s) return;
    if (prev && this.states[prev].onExit) this.states[prev].onExit(this);
    this.current = name; this.time = 0;
    const f = fade ?? s.fade ?? 0.25;
    if (s.clip) this.mixer.play(s.clip, { fade: f, restart: s.restart ?? !this.mixer.action(s.clip)?.clip.loop, speed: s.speed });
    if (s.blend) { const [x, y] = s.input ? s.input(this.params) : [0, 0]; s.blend.set(x, y, f); s._fade = f; }
    if (s.onEnter) s.onEnter(this);
    this.history.push({ from: prev, to: name, at: performance.now?.() ?? 0 }); if (this.history.length > 20) this.history.shift();
    for (const fn of this.listeners) fn(name, prev);
  }
  update(dt) {
    this.time += dt;
    const s = this.state;
    if (s.blend && s.input) { const [x, y] = s.input(this.params); s.blend.set(x, y, Math.max(0.12, s._fade * 0.5)); }
    if (s.update) s.update(this, dt);
    for (const t of this.transitions) {
      const from = t.from;
      const match = from === '*' ? t.to !== this.current : Array.isArray(from) ? from.includes(this.current) : from === this.current;
      if (!match) continue;
      if (t.exitTime !== undefined && this.normalizedTime < t.exitTime) continue;
      if (t.when && !t.when(this.params, this)) continue;
      for (const k of this._triggers) this.params[k] = false;
      this._triggers.clear();
      this.enter(t.to, t.fade);
      break;
    }
  }
}

// ------------------------------------------------------------------ look-at
// Turns spine, neck and head toward a world target, spreading the rotation over the chain,
// clamped to human limits and eased so the gaze doesn't snap.
export class LookAt {
  constructor(character, { chain = [['spine', 0.15], ['chest', 0.25], ['neck', 0.3], ['head', 0.3]], maxYaw = 75, maxPitch = 40, speed = 8, eye = [0, 0.1, 0.1] } = {}) {
    this.ch = character; this.chain = chain.map(([n, w]) => [character.skeleton.boneIndex(n), w]).filter(([i]) => i >= 0);
    this.maxYaw = maxYaw; this.maxPitch = maxPitch; this.speed = speed; this.eye = eye;
    this.target = null; this.weight = 1; this.yaw = 0; this.pitch = 0; this._w = 0;
  }
  update(dt) {
    const sk = this.ch.skeleton, head = this.chain[this.chain.length - 1][0];
    let ty = 0, tp = 0, tw = 0;
    if (this.target && this.weight > 0) {
      const inv = mat4.invert(mat4.create(), this.ch.world);
      const t = vec3.transformMat4([0, 0, 0], this.target, inv);
      const h = vec3.add([0, 0, 0], sk.worldHead(head), this.eye);
      const d = vec3.sub([0, 0, 0], t, h);
      const yaw = (Math.atan2(d[0], d[2]) * 180) / Math.PI, pitch = (Math.atan2(-d[1], Math.hypot(d[0], d[2])) * 180) / Math.PI;
      // beyond the neck's reach the character gives up rather than twisting all the way round
      const behind = Math.abs(yaw) > this.maxYaw + 40;
      ty = clamp(yaw, -this.maxYaw, this.maxYaw); tp = clamp(pitch, -this.maxPitch, this.maxPitch); tw = behind ? 0 : this.weight;
    }
    const k = 1 - Math.exp(-this.speed * dt);
    this.yaw += (ty - this.yaw) * k; this.pitch += (tp - this.pitch) * k; this._w += (tw - this._w) * k;
    if (this._w < 1e-3) return;
    // aim relative to where the animation already points the head, so the gaze lands exactly
    const f = vec3.transformQuat([0, 0, 0], [0, 0, 1], sk.worldRotation(head));
    const animYaw = (Math.atan2(f[0], f[2]) * 180) / Math.PI, animPitch = (Math.atan2(-f[1], Math.hypot(f[0], f[2])) * 180) / Math.PI;
    const dy = (this.yaw - animYaw) * this._w, dp = (this.pitch - animPitch) * this._w;
    for (const [i, w] of this.chain) {
      const r = quat.fromEuler(quat.create(), dp * w, dy * w, 0);
      const cur = sk.worldRotation(i);
      setWorldRotation(sk, i, quat.multiply(quat.create(), r, cur));
    }
  }
}

// ------------------------------------------------------------------ foot placement
// Plants feet on uneven ground. ground(x, z) returns { y, normal } in world space (for
// example from PhysicsWorld.raycast). The hips drop to let the lower foot reach, each leg
// is solved with two-bone IK, and the feet tilt to the slope.
export class FootIK {
  constructor(character, ground, { legs = ['L', 'R'], maxDrop = 0.45, maxLift = 0.5, speed = 14, footHeight = null } = {}) {
    const sk = character.skeleton;
    this.ch = character; this.ground = ground; this.maxDrop = maxDrop; this.maxLift = maxLift; this.speed = speed;
    this.legs = legs.map((s) => ({ side: s, thigh: sk.boneIndex('thigh.' + s), shin: sk.boneIndex('shin.' + s), foot: sk.boneIndex('foot.' + s), off: 0, tilt: quat.create() })).filter((l) => l.foot >= 0);
    this.hips = sk.boneIndex('hips'); this.pelvis = 0; this.weight = 1;
    this.ankle = footHeight ?? sk.bones[this.legs[0].foot].head[1];
  }
  update(dt) {
    if (this.weight <= 0 || !this.legs.length) return;
    const ch = this.ch, sk = ch.skeleton, W = ch.world, inv = mat4.invert(mat4.create(), W);
    const k = 1 - Math.exp(-this.speed * dt), rootY = W[13];
    // how far each ankle must move so it sits the same height above the ground as it does above the floor
    for (const L of this.legs) {
      const a = vec3.transformMat4([0, 0, 0], sk.worldHead(L.foot), W);
      const g = this.ground(a[0], a[2]);
      const want = g ? clamp(g.y - rootY, -this.maxDrop, this.maxLift) : 0;
      L.off += (want - L.off) * k;
      L.normal = g ? g.normal : [0, 1, 0];
    }
    const drop = Math.min(0, ...this.legs.map((L) => L.off));
    this.pelvis += (drop - this.pelvis) * k;
    sk.pos[this.hips * 3 + 1] += this.pelvis * this.weight;
    sk.update();
    for (const L of this.legs) {
      const a = sk.worldHead(L.foot), sg = L.side === 'L' ? 1 : -1;
      const target = [a[0], a[1] + (L.off - this.pelvis) * this.weight, a[2]];
      const footRot = sk.worldRotation(L.foot);
      twoBoneIK(sk, L.thigh, L.shin, L.foot, target, [sg * 0.1, 0, 1]);
      // tilt the foot to the slope (normal into character space)
      const n = vec3.normalize([0, 0, 0], vec3.transformDir([0, 0, 0], L.normal, inv));
      const tilt = quat.rotationTo(quat.create(), [0, 1, 0], n);
      quat.slerp(L.tilt, L.tilt, tilt, k);
      setWorldRotation(sk, L.foot, quat.multiply(quat.create(), quat.slerp(quat.create(), quat.create(), L.tilt, this.weight), footRot));
    }
  }
}

// ------------------------------------------------------------------ hit reactions
// Spring-driven offsets on a bone chain: hit(direction) knocks the chain back, then it
// wobbles home. Layer it after the animation update; works while running or aiming.
export class HitReaction {
  constructor(character, { chain = [['spine', 0.5], ['chest', 0.8], ['neck', 0.6], ['head', 0.9]], stiffness = 90, damping = 11 } = {}) {
    this.ch = character; this.chain = chain.map(([n, w]) => ({ i: character.skeleton.boneIndex(n), w, a: [0, 0, 0], v: [0, 0, 0] })).filter((b) => b.i >= 0);
    this.k = stiffness; this.c = damping;
  }
  // dir: world-space direction the hit travels; strength in radians-per-second-ish
  hit(dir, strength = 6, bone = null) {
    const inv = mat4.invert(mat4.create(), this.ch.world);
    const d = vec3.normalize([0, 0, 0], vec3.transformDir([0, 0, 0], dir, inv));
    const axis = vec3.cross([0, 0, 0], [0, 1, 0], d); // bend away from the hit
    const twist = (Math.random() - 0.5) * 0.4;
    for (const b of this.chain) {
      const s = strength * b.w * (bone && this.ch.skeleton.bones[b.i].name !== bone ? 0.7 : 1);
      b.v = vec3.add([0, 0, 0], b.v, [axis[0] * s, twist * s, axis[2] * s]);
    }
  }
  update(dt) {
    const sk = this.ch.skeleton;
    for (const b of this.chain) {
      for (let c = 0; c < 3; c++) { b.v[c] += (-this.k * b.a[c] - this.c * b.v[c]) * dt; b.a[c] += b.v[c] * dt; }
      const ang = vec3.len(b.a);
      if (ang < 1e-5) continue;
      const q = quat.setAxisAngle(quat.create(), vec3.scale([0, 0, 0], b.a, 1 / ang), ang);
      setWorldRotation(sk, b.i, quat.multiply(quat.create(), q, sk.worldRotation(b.i)));
    }
  }
}

// ------------------------------------------------------------------ tweens
export const EASINGS = {
  linear: (t) => t,
  inQuad: (t) => t * t, outQuad: (t) => 1 - (1 - t) * (1 - t), inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t) => t ** 3, outCubic: (t) => 1 - (1 - t) ** 3, inOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t) => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  outElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * 2 * Math.PI) / 3) + 1),
  outBounce: (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
};
// tweens.to(node, { position: [0, 2, 0], euler: [0, 90, 0], scale: [1, 1, 1] }, { duration, ease, delay, yoyo, repeat })
// Any numeric or array property works; `euler` rotates a Node (slerped). Returns a promise-like
// tween with .then(fn). tweens.sequence([...fns returning tweens]) chains them.
export class Tweens {
  constructor() { this.list = []; }
  to(target, props, { duration = 0.5, ease = 'inOutCubic', delay = 0, yoyo = false, repeat = 0, onUpdate = null } = {}) {
    const tw = { target, props, duration, ease: typeof ease === 'function' ? ease : EASINGS[ease] || EASINGS.linear, delay, yoyo, repeat, t: 0, from: null, done: false, cbs: [], onUpdate };
    tw.then = (fn) => { if (tw.done) fn(); else tw.cbs.push(fn); return tw; };
    tw.stop = () => { tw.done = true; this.list = this.list.filter((x) => x !== tw); };
    // cancel other tweens on the same properties of the same object
    for (const o of this.list) if (o.target === target) for (const k of Object.keys(props)) if (k in o.props) delete o.props[k];
    this.list.push(tw);
    return tw;
  }
  _start(tw) {
    tw.a = {}; tw.b = {};
    for (const k of Object.keys(tw.props)) {
      if (k === 'euler') { tw.a.euler = quat.copy(quat.create(), tw.target.rotation); tw.b.euler = quat.fromEuler(quat.create(), ...tw.props.euler); }
      else { const v = tw.target[k]; tw.a[k] = typeof v === 'number' ? v : Array.from(v); tw.b[k] = tw.props[k]; }
    }
  }
  update(dt) {
    for (const tw of [...this.list]) {
      if (tw.done) continue;
      if (tw.delay > 0) { tw.delay -= dt; continue; }
      if (!tw.a) this._start(tw);
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const s = tw.ease(tw.t);
      for (const k of Object.keys(tw.a)) {
        if (!(k in tw.props)) continue; // taken over by a newer tween
        const a = tw.a[k], b = tw.b[k];
        if (k === 'euler') quat.slerp(tw.target.rotation, a, b, s);
        else if (typeof a === 'number') tw.target[k] = a + (b - a) * s;
        else for (let c = 0; c < a.length; c++) tw.target[k][c] = a[c] + (b[c] - a[c]) * s;
      }
      if (tw.onUpdate) tw.onUpdate(s);
      if (tw.t < 1) continue;
      if (tw.repeat > 0) { // repeat counts extra runs (Infinity loops forever); yoyo swaps direction each run
        tw.repeat--; tw.t = 0;
        if (tw.yoyo) { const a = tw.a; tw.a = tw.b; tw.b = a; }
        continue;
      }
      tw.done = true; this.list = this.list.filter((x) => x !== tw);
      for (const fn of tw.cbs) fn();
    }
  }
  // steps: functions that start a tween and return it; each starts when the previous ends
  sequence(steps) { return new Promise((resolve) => { const run = (i) => (i >= steps.length ? resolve() : steps[i]().then(() => run(i + 1))); run(0); }); }
  get active() { return this.list.length; }
}
