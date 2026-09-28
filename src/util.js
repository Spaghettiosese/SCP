// Shared helpers: mesh merging (draw-call reduction), static model building,
// bone attachment, small math utilities.
import { Geometry, Mesh, Node, Material, mat4, quat, vec3, buildShape, clamp } from '../engine/index.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const damp = (a, b, lambda, dt) => b + (a - b) * Math.exp(-lambda * dt);
export const dampArr = (a, b, lambda, dt) => { const k = Math.exp(-lambda * dt); for (let i = 0; i < a.length; i++) a[i] = b[i] + (a[i] - b[i]) * k; return a; };
export const angleDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
export const dirFromYawPitch = (yaw, pitch, out = [0, 0, 0]) => { const c = Math.cos(pitch); out[0] = Math.sin(yaw) * c; out[1] = Math.sin(pitch); out[2] = Math.cos(yaw) * c; return out; };
export const yawTo = (from, to) => Math.atan2(to[0] - from[0], to[2] - from[2]);
export const dist2D = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];

// ---------------------------------------------------------------- merging
// Bake a mesh's local transform into a copy of its geometry.
function bakedGeometry(mesh) {
  const g = mesh.geometry.clone();
  mat4.fromRTS(mesh.local, mesh.rotation, mesh.position, mesh.scale);
  g.applyMatrix(mesh.local);
  g.rest = null;
  return g;
}

function mergeWithSkin(list) {
  const merged = Geometry.merge(list);
  if (list.some((g) => g.joints)) {
    const n = merged.vertexCount, J = new Float32Array(n * 4), W = new Float32Array(n * 4);
    let o = 0;
    for (const g of list) {
      const c = g.vertexCount;
      if (g.joints && g.weights) { J.set(g.joints, o * 4); W.set(g.weights, o * 4); }
      else for (let i = 0; i < c; i++) W[(o + i) * 4] = 1;
      o += c;
    }
    merged.joints = J; merged.weights = W;
  }
  return merged;
}

// Collapse a Character's many part meshes into one skinned mesh per material.
export function mergeCharacter(ch) {
  const groups = new Map();
  for (const part of ch.parts) for (const m of part.meshes) {
    if (!m.visible) continue;
    const key = m.material;
    if (!groups.has(key)) groups.set(key, { list: [], shadow: false });
    const g = groups.get(key);
    g.list.push(bakedGeometry(m));
    g.shadow = g.shadow || m.castShadow;
    ch.remove(m);
  }
  ch.merged = [];
  for (const [mat, g] of groups) {
    const mesh = new Mesh(mergeWithSkin(g.list), mat, ch.name + ':' + mat.name);
    mesh.skeleton = ch.skeleton; mesh.skinRoot = ch; mesh.castShadow = g.shadow;
    ch.add(mesh); ch.merged.push(mesh);
  }
  ch.parts.forEach((p) => (p.meshes = []));
  return ch;
}

// ---------------------------------------------------------------- static models
// A StaticBuilder accumulates shapes (in its own local space) grouped by material,
// then produces one Mesh per material. Used for level geometry, props and NPC guns.
export class StaticBuilder {
  constructor(materials = {}) { this.materials = materials; this.groups = new Map(); this.stack = [mat4.create()]; }
  mat(name) {
    if (name instanceof Material) return name;
    if (!this.materials[name]) this.materials[name] = new Material({ name });
    if (!(this.materials[name] instanceof Material)) this.materials[name] = new Material({ name, ...this.materials[name] });
    return this.materials[name];
  }
  push(position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
    const m = mat4.fromRTS(mat4.create(), quat.fromEuler(quat.create(), ...rotation), position, scale);
    this.stack.push(mat4.multiply(mat4.create(), this.stack[this.stack.length - 1], m));
    return this;
  }
  pop() { this.stack.pop(); return this; }
  // add a shape spec with optional modifiers at a transform (relative to the current stack)
  add(material, shape, { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], modifiers = [] } = {}) {
    const g = shape instanceof Geometry ? shape.clone() : buildShape(shape, modifiers);
    const m = mat4.fromRTS(mat4.create(), quat.fromEuler(quat.create(), ...rotation), position, scale);
    g.applyMatrix(mat4.multiply(mat4.create(), this.stack[this.stack.length - 1], m));
    const mt = this.mat(material);
    if (!this.groups.has(mt)) this.groups.set(mt, []);
    this.groups.get(mt).push(g);
    return g;
  }
  // axis-aligned box from min/max corners (world units)
  box(material, min, max, o = {}) {
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    return this.add(material, { type: 'box', width: size[0], height: size[1], depth: size[2], bevel: o.bevel || 0, bevelSegments: o.bevelSegments || 2, segments: o.segments || 1 }, { position: c, rotation: o.rotation || [0, 0, 0] });
  }
  build(name = 'Static', { castShadow = true, split = 0 } = {}) {
    const root = new Node(name);
    for (const [mat, list] of this.groups) {
      // optional spatial split keeps huge merged meshes cullable
      const chunks = split > 0 ? splitByCell(list, split) : [list];
      for (const c of chunks) {
        const mesh = new Mesh(Geometry.merge(c), mat, name + ':' + mat.name);
        mesh.castShadow = castShadow && mat.blend !== 'add' && !mat.unlit;
        root.add(mesh);
      }
    }
    return root;
  }
}

function splitByCell(list, cell) {
  const map = new Map();
  for (const g of list) {
    const P = g.positions; let x = 0, z = 0; const n = P.length / 3;
    for (let i = 0; i < P.length; i += 3) { x += P[i]; z += P[i + 2]; }
    const k = Math.floor(x / n / cell) + ',' + Math.floor(z / n / cell);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(g);
  }
  return [...map.values()];
}

// ---------------------------------------------------------------- attachment
const _m = mat4.create(), _bm = mat4.create();
// World matrix of a character bone (model-space bone matrix * character world).
export function boneWorld(ch, boneName, out = mat4.create()) {
  const i = ch.skeleton.boneIndex(boneName);
  if (i < 0) return out.set(ch.world);
  _bm.set(ch.skeleton.world.subarray(i * 16, i * 16 + 16));
  return mat4.multiply(out, ch.world, _bm);
}
export function bonePos(ch, boneName, out = [0, 0, 0]) {
  const i = ch.skeleton.boneIndex(boneName);
  const h = ch.skeleton.worldHead(i, [0, 0, 0]);
  return vec3.transformMat4(out, h, ch.world);
}
// Glue a node to a bone with a local offset matrix.
export function attachToBone(node, ch, boneName, offset) {
  boneWorld(ch, boneName, _m);
  if (!node.worldOverride) node.worldOverride = mat4.create();
  mat4.multiply(node.worldOverride, _m, offset);
}
export const offsetMatrix = (p = [0, 0, 0], r = [0, 0, 0]) => mat4.fromRTS(mat4.create(), quat.fromEuler(quat.create(), ...r), p, [1, 1, 1]);

// Basis matrix from position + forward (+Z) + up.
export function basisMatrix(pos, fwd, upHint = [0, 1, 0], out = mat4.create()) {
  const f = vec3.normalize([0, 0, 0], fwd);
  const l = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], upHint, f));
  const u = vec3.cross([0, 0, 0], f, l);
  out[0] = l[0]; out[1] = l[1]; out[2] = l[2]; out[3] = 0;
  out[4] = u[0]; out[5] = u[1]; out[6] = u[2]; out[7] = 0;
  out[8] = f[0]; out[9] = f[1]; out[10] = f[2]; out[11] = 0;
  out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2]; out[15] = 1;
  return out;
}

export { clamp };
