// Skeleton: bone hierarchy, pose evaluation, GPU joint matrices, automatic skin weights
// and spring (jiggle) bones for secondary motion.
import { vec3, quat, mat4 } from './math.js';

export class Skeleton {
  // bones: [{ name, parent, head:[x,y,z], tail:[x,y,z], spring? }] listed parents-first (sorted automatically)
  constructor(bones = []) {
    this.setBones(bones);
  }
  setBones(bones) {
    // topological sort so parents come first
    const byName = new Map(bones.map((b) => [b.name, b]));
    const out = [], seen = new Set();
    const visit = (b) => { if (seen.has(b.name)) return; if (b.parent && byName.has(b.parent)) visit(byName.get(b.parent)); seen.add(b.name); out.push(b); };
    bones.forEach(visit);
    this.bones = out.map((b) => ({ name: b.name, parent: b.parent || null, head: [...b.head], tail: [...(b.tail || [b.head[0], b.head[1] + 0.1, b.head[2]])], spring: b.spring || null, deform: b.deform !== false }));
    const n = this.bones.length;
    this.index = new Map(this.bones.map((b, i) => [b.name, i]));
    this.parentIndex = new Int32Array(n).map((_, i) => (this.bones[i].parent ? this.index.get(this.bones[i].parent) ?? -1 : -1));
    this.restLocal = new Float32Array(n * 3);
    this.bones.forEach((b, i) => {
      const p = this.parentIndex[i];
      const ph = p >= 0 ? this.bones[p].head : [0, 0, 0];
      this.restLocal.set([b.head[0] - ph[0], b.head[1] - ph[1], b.head[2] - ph[2]], i * 3);
    });
    this.rot = new Float32Array(n * 4); // pose local rotations
    this.pos = new Float32Array(n * 3); // pose local translation offsets (added to rest)
    this.world = new Float32Array(n * 16); // model-space bone matrices
    this.joints = new Float32Array(n * 16); // world * inverseBind
    this.version = 0;
    this.springState = new Map();
    this.resetPose();
    this.update();
  }
  get length() { return this.bones.length; }
  boneIndex(name) { return this.index.get(name) ?? -1; }
  resetPose() { for (let i = 0; i < this.bones.length; i++) { this.rot.set([0, 0, 0, 1], i * 4); this.pos.set([0, 0, 0], i * 3); } }
  copyPose(pose) { this.rot.set(pose.rot); this.pos.set(pose.pos); }
  snapshotPose() { return { rot: this.rot.slice(), pos: this.pos.slice() }; }
  boneLength(i) { return vec3.dist(this.bones[i].head, this.bones[i].tail); }

  // Compute model-space matrices from the local pose.
  update(from = 0) {
    const n = this.bones.length, m = mat4.create(), t = [0, 0, 0];
    for (let i = from; i < n; i++) {
      const q = this.rot.subarray(i * 4, i * 4 + 4);
      t[0] = this.restLocal[i * 3] + this.pos[i * 3]; t[1] = this.restLocal[i * 3 + 1] + this.pos[i * 3 + 1]; t[2] = this.restLocal[i * 3 + 2] + this.pos[i * 3 + 2];
      mat4.fromRTS(m, q, t);
      const p = this.parentIndex[i], w = this.world.subarray(i * 16, i * 16 + 16);
      if (p >= 0) mat4.multiply(w, this.world.subarray(p * 16, p * 16 + 16), m); else w.set(m);
      // joint = world * inverseBind, inverse bind is a pure translation by -head
      const j = this.joints.subarray(i * 16, i * 16 + 16), h = this.bones[i].head;
      j.set(w);
      j[12] = w[12] - (w[0] * h[0] + w[4] * h[1] + w[8] * h[2]);
      j[13] = w[13] - (w[1] * h[0] + w[5] * h[1] + w[9] * h[2]);
      j[14] = w[14] - (w[2] * h[0] + w[6] * h[1] + w[10] * h[2]);
    }
    this.version++;
  }
  worldHead(i, out = [0, 0, 0]) { const w = this.world; out[0] = w[i * 16 + 12]; out[1] = w[i * 16 + 13]; out[2] = w[i * 16 + 14]; return out; }
  worldTail(i, out = [0, 0, 0]) {
    const b = this.bones[i], d = [b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]];
    const w = this.world.subarray(i * 16, i * 16 + 16);
    return vec3.transformMat4(out, d, w);
  }
  worldRotation(i, out = quat.create()) { return mat4.getRotation(out, this.world.subarray(i * 16, i * 16 + 16)); }

  // Secondary motion: bones with {spring:{stiffness,damping,gravity}} lag behind their
  // animated direction like a damped pendulum. modelMatrix places the skeleton in the world.
  simulateSprings(dt, modelMatrix) {
    if (dt <= 0) return;
    dt = Math.min(dt, 1 / 20);
    const inv = mat4.invert(mat4.create(), modelMatrix);
    for (let i = 0; i < this.bones.length; i++) {
      const sp = this.bones[i].spring;
      if (!sp) continue;
      const head = vec3.transformMat4([0, 0, 0], this.worldHead(i), modelMatrix);
      const tail = vec3.transformMat4([0, 0, 0], this.worldTail(i), modelMatrix);
      const len = vec3.dist(head, tail);
      let s = this.springState.get(i);
      if (!s) { s = { p: tail.slice(), v: [0, 0, 0] }; this.springState.set(i, s); }
      const k = sp.stiffness ?? 120, c = sp.damping ?? 10, g = sp.gravity ?? 2;
      const steps = 4, h = dt / steps;
      for (let it = 0; it < steps; it++) {
        const a = [(tail[0] - s.p[0]) * k - s.v[0] * c, (tail[1] - s.p[1]) * k - s.v[1] * c - g, (tail[2] - s.p[2]) * k - s.v[2] * c];
        vec3.scaleAdd(s.v, s.v, a, h); vec3.scaleAdd(s.p, s.p, s.v, h);
        // keep bone length
        const d = vec3.sub([0, 0, 0], s.p, head), l = vec3.len(d) || 1;
        vec3.scaleAdd(s.p, head, d, len / l);
      }
      // rotate bone so its tail points at the simulated particle (in model space)
      const animDir = vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], this.worldTail(i), this.worldHead(i)));
      const simDir = vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], vec3.transformMat4([0, 0, 0], s.p, inv), this.worldHead(i)));
      const delta = quat.rotationTo(quat.create(), animDir, simDir);
      const wr = quat.multiply(quat.create(), delta, this.worldRotation(i));
      const p = this.parentIndex[i];
      const pr = p >= 0 ? this.worldRotation(p) : quat.create();
      const local = quat.multiply(quat.create(), quat.invert(quat.create(), pr), wr);
      this.rot.set(quat.normalize(local, local), i * 4);
      this.update(i);
    }
  }
  resetSprings() { this.springState.clear(); }
  toJSON() { return this.bones.map((b) => ({ name: b.name, parent: b.parent, head: b.head, tail: b.tail, ...(b.spring ? { spring: b.spring } : {}), ...(b.deform === false ? { deform: false } : {}) })); }
}

function distToSegment(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-9;
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

// Skin binding.
//  { bone: 'name' }                 rigid: every vertex follows one bone
//  { bones: ['a','b'], falloff: 6 } automatic: inverse-distance weights to bone segments,
//                                   which gives smooth, seamless joints (elbows, knees...)
export function computeSkinWeights(geometry, skeleton, bind, localMatrix = null) {
  const n = geometry.vertexCount, J = new Float32Array(n * 4), W = new Float32Array(n * 4);
  const names = bind?.bones || (bind?.bone ? [bind.bone] : []);
  const ids = names.map((nm) => skeleton.boneIndex(nm)).filter((i) => i >= 0);
  if (!ids.length) {
    const root = 0;
    for (let i = 0; i < n; i++) { J[i * 4] = root; W[i * 4] = 1; }
  } else if (ids.length === 1) {
    for (let i = 0; i < n; i++) { J[i * 4] = ids[0]; W[i * 4] = 1; }
  } else {
    const pw = bind.falloff ?? 6, P = geometry.positions, p = [0, 0, 0];
    const segs = ids.map((i) => [skeleton.bones[i].head, skeleton.bones[i].tail]);
    const tmp = ids.map(() => 0);
    for (let v = 0; v < n; v++) {
      vec3.set(p, P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      if (localMatrix) vec3.transformMat4(p, p, localMatrix);
      let sum = 0;
      for (let k = 0; k < ids.length; k++) { const d = distToSegment(p, segs[k][0], segs[k][1]) + 0.004; tmp[k] = 1 / Math.pow(d, pw); sum += tmp[k]; }
      const order = tmp.map((w, k) => [w / sum, ids[k]]).sort((a, b) => b[0] - a[0]).slice(0, 4);
      const s4 = order.reduce((a, o) => a + o[0], 0);
      order.forEach(([w, id], k) => { J[v * 4 + k] = id; W[v * 4 + k] = w / s4; });
    }
  }
  geometry.joints = J; geometry.weights = W; geometry.version++;
  return geometry;
}
