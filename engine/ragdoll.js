// Ragdolls: build capsules, boxes and a sphere along a character's skeleton, joined by
// cone-twist joints (neck, shoulders, hips, spine) and limited hinges (elbows, knees).
// While active the bodies drive the bones; weight blends between animation and physics,
// so a character can fall limp and later blend back into an animation to get up.
import { Body, Box, Capsule, Sphere, ConeTwistJoint, HingeJoint, physicsMath as M } from './physics.js';
import { mat4, quat, vec3 } from './math.js';
const xform = (m, p) => Array.from(vec3.transformMat4([0, 0, 0], p, m));

// A humanoid layout matching the engine's standard bone names (Cowboy, Grinner, soldier).
export const HUMANOID_RAGDOLL = [
  { name: 'pelvis', bone: 'hips', shape: 'box', size: [0.15, 0.09, 0.1], from: 'hips', to: 'spine', mass: 12 },
  { name: 'torso', bone: 'spine', also: ['chest'], shape: 'box', size: [0.17, 0, 0.11], from: 'spine', to: 'neck', mass: 22, parent: 'pelvis', joint: { type: 'cone', swing: 0.45, twist: 0.35 } },
  { name: 'head', bone: 'neck', also: ['head'], shape: 'sphere', radius: 0.12, from: 'neck', toTail: 'head', mass: 5, parent: 'torso', joint: { type: 'cone', swing: 0.55, twist: 0.6 } },
  { name: 'upperArm.L', bone: 'upperArm.L', shape: 'capsule', radius: 0.055, from: 'upperArm.L', to: 'foreArm.L', mass: 2.5, parent: 'torso', joint: { type: 'cone', swing: 1.35, twist: 0.8 } },
  { name: 'foreArm.L', bone: 'foreArm.L', shape: 'capsule', radius: 0.048, from: 'foreArm.L', toTail: 'hand.L', mass: 2, parent: 'upperArm.L', joint: { type: 'hinge', axis: [1, 0, 0], min: -2.5, max: 0.05 } },
  { name: 'thigh.L', bone: 'thigh.L', shape: 'capsule', radius: 0.075, from: 'thigh.L', to: 'shin.L', mass: 9, parent: 'pelvis', joint: { type: 'cone', swing: 1.1, twist: 0.45 } },
  { name: 'shin.L', bone: 'shin.L', shape: 'capsule', radius: 0.06, from: 'shin.L', to: 'foot.L', mass: 5, parent: 'thigh.L', joint: { type: 'hinge', axis: [1, 0, 0], min: -0.05, max: 2.5 } },
];
// mirror .L entries to .R
for (const d of [...HUMANOID_RAGDOLL]) if (d.name.endsWith('.L')) {
  const r = (s) => (typeof s === 'string' ? s.replace(/\.L$/, '.R') : s);
  HUMANOID_RAGDOLL.push({ ...d, name: r(d.name), bone: r(d.bone), from: r(d.from), to: r(d.to), toTail: r(d.toTail), parent: r(d.parent) });
}

export class Ragdoll {
  constructor(world, character, { layout = HUMANOID_RAGDOLL, scale = 1, friction = 0.7, group = 4 } = {}) {
    this.world = world; this.character = character; this.layout = layout.filter((d) => character.skeleton.boneIndex(d.bone) >= 0);
    this.parts = new Map(); this.joints = []; this.weight = 0; this.active = false; this._fade = null;
    const sk = character.skeleton;
    // build in the rest pose so joint limits are measured from a neutral stance
    const saved = sk.snapshotPose(); sk.resetPose(); sk.update();
    character.updateWorld(character.parent ? character.parent.world : null);
    const W = character.world, wp = (name, tail) => { const i = sk.boneIndex(name); return xform(W, tail ? sk.worldTail(i) : sk.worldHead(i)); };
    const charRot = mat4.getRotation(quat.create(), W);
    for (const d of this.layout) {
      const p0 = wp(d.from), p1 = d.toTail ? wp(d.toTail, true) : wp(d.to);
      const dir = M.norm(M.sub(p1, p0)), L = M.len(M.sub(p1, p0)) * scale;
      let shape, center = M.scl(M.add(p0, p1), 0.5), rot = [...charRot];
      if (d.shape === 'box') { shape = new Box([d.size[0] * scale, d.size[1] ? d.size[1] * scale : L / 2, d.size[2] * scale]); }
      else if (d.shape === 'sphere') { shape = new Sphere(d.radius * scale); center = M.madd(p0, dir, L * 0.55); }
      else { shape = new Capsule(d.radius * scale, Math.max(0.02, L / 2 - d.radius * 0.6)); rot = M.qFromTo([0, 1, 0], dir); }
      const body = new Body({ shape, position: center, rotation: rot, mass: d.mass, friction, restitution: 0.05, linearDamping: 0.08, angularDamping: 0.6, group, name: d.name });
      body.userData.ragdoll = this;
      const bones = [sk.boneIndex(d.bone)]; // child bones (chest, head, hands, feet) keep their animated local pose
      const boneWorld = (i) => quat.multiply(quat.create(), charRot, sk.worldRotation(i));
      const part = { def: d, body, bones, offsets: bones.map((i) => M.qmul(M.qconj(body.quaternion), Array.from(boneWorld(i)))), anchor: body.toLocal(wp(sk.bones[bones[0]].name)) };
      this.parts.set(d.name, part);
    }
    // joints at the child's head
    for (const part of this.parts.values()) {
      const d = part.def, parent = d.parent && this.parts.get(d.parent);
      if (!parent) continue;
      const pivot = wp(d.from), A = parent.body, B = part.body, j = d.joint || { type: 'cone' };
      let joint;
      if (j.type === 'hinge') joint = new HingeJoint(A, B, pivot, M.qrot(Array.from(charRot), j.axis), { min: j.min, max: j.max });
      else { const twistAxis = M.norm(M.sub(d.toTail ? wp(d.toTail, true) : wp(d.to), pivot)); joint = new ConeTwistJoint(A, B, pivot, twistAxis, { swing: j.swing, twistMin: -j.twist, twistMax: j.twist }); }
      this.joints.push(joint);
    }
    sk.copyPose(saved); sk.update();
    this._pairsIgnored = [];
    const bodies = [...this.parts.values()].map((p) => p.body);
    // limbs may brush the torso and each other near the joints; skip those pairs
    for (let i = 0; i < bodies.length; i++) for (let k = i + 1; k < bodies.length; k++) {
      const a = bodies[i], b = bodies[k], n = (x) => x.name;
      const near = (n(a) === 'torso' && /upperArm|head/.test(n(b))) || (n(b) === 'torso' && /upperArm|head/.test(n(a))) || (/thigh/.test(n(a)) && /thigh/.test(n(b))) || (n(a) === 'pelvis' && /thigh/.test(n(b)));
      if (near) this._pairsIgnored.push([a, b]);
    }
  }
  get bodies() { return [...this.parts.values()].map((p) => p.body); }
  // Place the bodies on the character's current pose and hand the bones to physics.
  // velocity (world m/s) is added to every body, e.g. the character's running speed.
  activate({ velocity = [0, 0, 0], impulse = null, at = null, blendIn = 0 } = {}) {
    const ch = this.character, sk = ch.skeleton;
    ch.updateWorld(ch.parent ? ch.parent.world : null);
    const W = ch.world, charRot = mat4.getRotation(quat.create(), W);
    for (const p of this.parts.values()) {
      const i = p.bones[0];
      const qBone = Array.from(quat.multiply(quat.create(), charRot, sk.worldRotation(i)));
      const q = M.qnorm(M.qmul(qBone, M.qconj(p.offsets[0])));
      const head = xform(W, sk.worldHead(i));
      p.body.quaternion = q;
      p.body.position = M.sub(head, M.qrot(q, p.anchor));
      p.body.velocity = [...velocity]; p.body.angularVelocity = [0, 0, 0];
      p.body.wake();
    }
    if (!this.active) {
      this.world.add(...this.bodies, ...this.joints);
      for (const [a, b] of this._pairsIgnored) this.world._noCollide.add(a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id);
    }
    this.active = true;
    this._fade = blendIn > 0 ? { from: this.weight, to: 1, t: 0, d: blendIn } : null;
    if (!blendIn) this.weight = 1;
    if (impulse) { const target = at ? this.parts.get(at)?.body : this.parts.get('torso')?.body; if (target) target.applyImpulse(impulse, target.position); }
    return this;
  }
  // Blend back to animation over `duration` seconds, moving the character to where the body lies.
  deactivate(duration = 0.8, { moveCharacter = true } = {}) {
    if (!this.active) return;
    if (moveCharacter) {
      const pelvis = this.parts.get('pelvis')?.body, torso = this.parts.get('torso')?.body;
      if (pelvis) {
        const ch = this.character;
        // face along the torso's forward direction, projected on the ground
        const fwd = M.qrot(torso ? torso.quaternion : pelvis.quaternion, [0, 0, 1]), up = M.qrot(torso ? torso.quaternion : pelvis.quaternion, [0, 1, 0]);
        const dir = Math.abs(fwd[1]) > 0.7 ? M.scl(up, fwd[1] > 0 ? -1 : 1) : fwd;
        const yaw = Math.atan2(dir[0], dir[2]);
        const before = this._captureWorldPose();
        ch.position[0] = pelvis.position[0]; ch.position[2] = pelvis.position[2];
        quat.fromEuler(ch.rotation, 0, (yaw * 180) / Math.PI, 0);
        ch.updateWorld(ch.parent ? ch.parent.world : null);
        this._restoreWorldPose(before);
      }
    }
    this._fade = { from: this.weight, to: 0, t: 0, d: Math.max(1e-3, duration), release: true };
  }
  _captureWorldPose() { return [...this.parts.values()].map((p) => ({ p: [...p.body.position], q: [...p.body.quaternion] })); }
  _restoreWorldPose(s) { [...this.parts.values()].forEach((p, i) => { p.body.position = s[i].p; p.body.quaternion = s[i].q; }); }
  _release() {
    this.world.remove(...this.joints, ...this.bodies);
    for (const [a, b] of this._pairsIgnored) this.world._noCollide.delete(a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id);
    this.active = false;
  }
  get settled() { return this.bodies.every((b) => b.sleeping || M.len(b.velocity) < 0.15); }
  // Call after the character's animation update (and after physics has stepped).
  update(dt) {
    if (this._fade) {
      const f = this._fade; f.t = Math.min(1, f.t + dt / f.d);
      const s = f.t * f.t * (3 - 2 * f.t); this.weight = f.from + (f.to - f.from) * s;
      if (f.t >= 1) { this._fade = null; if (f.release) this._release(); }
    }
    if (this.weight <= 0 || this.parts.size === 0) return;
    const ch = this.character, sk = ch.skeleton, w = this.weight;
    ch.updateWorld(ch.parent ? ch.parent.world : null);
    const W = ch.world, invW = mat4.invert(mat4.create(), W), charRotInv = M.qconj(Array.from(mat4.getRotation(quat.create(), W)));
    const targets = new Map();
    for (const p of this.parts.values()) p.bones.forEach((i, k) => targets.set(i, { part: p, k }));
    const order = [...targets.keys()].sort((a, b) => a - b);
    for (const i of order) {
      const { part, k } = targets.get(i);
      const modelRot = M.qmul(charRotInv, M.qmul(part.body.quaternion, part.offsets[k]));
      const pi = sk.parentIndex[i];
      const parentRot = pi >= 0 ? Array.from(sk.worldRotation(pi)) : [0, 0, 0, 1];
      const local = M.qnorm(M.qmul(M.qconj(parentRot), modelRot));
      const cur = sk.rot.subarray(i * 4, i * 4 + 4);
      quat.slerp(cur, cur, local[3] * cur[3] + local[0] * cur[0] + local[1] * cur[1] + local[2] * cur[2] < 0 ? local.map((v) => -v) : local, w);
      if (k === 0 && part.def.name === 'pelvis') { // root translation: put the hips where the pelvis body is
        const head = xform(invW, part.body.toWorld(part.anchor));
        const pw = pi >= 0 ? sk.world.subarray(pi * 16, pi * 16 + 16) : mat4.create();
        const localPos = xform(mat4.invert(mat4.create(), pw), head);
        for (let c = 0; c < 3; c++) sk.pos[i * 3 + c] += (localPos[c] - sk.restLocal[i * 3 + c] - sk.pos[i * 3 + c]) * w;
      }
      sk.update(i);
    }
  }
}
