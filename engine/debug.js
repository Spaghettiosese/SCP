// Debug / editor visual helpers: skeleton lines, onion-skin ghost poses, octahedral bones.
import { Skeleton } from './skeleton.js';
import { sampleClip, createPose } from './animation.js';
import { Geometry } from './geometry.js';
import { vec3, quat, mat4 } from './math.js';

export function skeletonLines(sk, world, color = [1, 0.8, 0.35, 1], jointColor = [1, 1, 1, 1]) {
  const out = [];
  const a = [0, 0, 0], b = [0, 0, 0];
  for (let i = 0; i < sk.length; i++) {
    vec3.transformMat4(a, sk.worldHead(i), world); vec3.transformMat4(b, sk.worldTail(i), world);
    out.push(a[0], a[1], a[2], ...color, b[0], b[1], b[2], ...color);
    // small joint cross
    const s = 0.012;
    for (let k = 0; k < 3; k++) { const d = [0, 0, 0]; d[k] = s; out.push(a[0] - d[0], a[1] - d[1], a[2] - d[2], ...jointColor, a[0] + d[0], a[1] + d[1], a[2] + d[2], ...jointColor); }
  }
  return new Float32Array(out);
}

// Evaluate joint matrices of `clip` at time t without touching the live skeleton.
export class GhostPoser {
  constructor(skeleton) { this.sk = new Skeleton(skeleton.toJSON()); this.pose = createPose(this.sk.length); }
  joints(clip, t) {
    sampleClip(clip, this.sk, t, this.pose); this.sk.copyPose(this.pose); this.sk.update();
    return this.sk.joints.slice();
  }
  jointsFromPose(pose) { this.sk.copyPose(pose); this.sk.update(); return this.sk.joints.slice(); }
}

// Blender-style octahedral bone, unit length along +Y
export function boneGeometry() {
  const w = 0.1, h = 0.1;
  const P = [[0, 0, 0], [w, h, w], [w, h, -w], [-w, h, -w], [-w, h, w], [0, 1, 0]];
  const F = [[0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4], [5, 1, 2], [5, 2, 3], [5, 3, 4], [5, 4, 1]];
  const pos = [], idx = [];
  for (const f of F) { for (const v of f) pos.push(...P[v]); idx.push(idx.length, idx.length + 1, idx.length + 2); }
  const g = new Geometry({ positions: pos, indices: idx });
  g.computeNormals(new Float32Array(pos.length)); // flat per-face (no welding with zero ref normals)
  // recompute as flat normals
  const N = g.normals;
  for (let t = 0; t < idx.length; t += 3) {
    const a = pos.slice(t * 3, t * 3 + 3), b = pos.slice(t * 3 + 3, t * 3 + 6), c = pos.slice(t * 3 + 6, t * 3 + 9);
    const n = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], vec3.sub([0, 0, 0], b, a), vec3.sub([0, 0, 0], c, a)));
    for (let k = 0; k < 3; k++) N.set(n, (t + k) * 3);
  }
  return g;
}

// Matrix placing a unit bone between world head and tail, following the bone's roll.
export function boneMatrix(sk, i, world, out = mat4.create()) {
  const b = sk.bones[i];
  const len = vec3.dist(b.head, b.tail) || 0.05;
  const rest = vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], b.tail, b.head));
  const align = quat.rotationTo(quat.create(), [0, 1, 0], rest);
  const m = mat4.fromRTS(mat4.create(), align, [0, 0, 0], [len, len, len]);
  const bw = sk.world.subarray(i * 16, i * 16 + 16);
  mat4.multiply(out, world, bw);
  return mat4.multiply(out, out, m);
}
