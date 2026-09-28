// Inverse kinematics helpers operating on a Skeleton in model space.
import { vec3, quat, clamp } from './math.js';

export function parentWorldRot(sk, i) { const p = sk.parentIndex[i]; return p >= 0 ? sk.worldRotation(p) : quat.create(); }

// Set bone i so that its model-space orientation equals qWorld.
export function setWorldRotation(sk, i, qWorld) {
  sk.update();
  const local = quat.multiply(quat.create(), quat.invert(quat.create(), parentWorldRot(sk, i)), qWorld);
  sk.rot.set(quat.normalize(local, local), i * 4);
  sk.update();
}

// Rotate bone i (shortest arc from its rest direction) so that `restEnd` (a rest-pose
// point, default the bone tail) lands on the model-space target direction.
export function aimBone(sk, i, target, restEnd = null) {
  sk.update();
  const b = sk.bones[i];
  const end = restEnd || b.tail;
  const rest = vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], end, b.head));
  const head = sk.worldHead(i);
  const dirW = vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], target, head));
  const dirL = vec3.transformQuat([0, 0, 0], dirW, quat.invert(quat.create(), parentWorldRot(sk, i)));
  const q = quat.rotationTo(quat.create(), rest, dirL);
  sk.rot.set(q, i * 4);
  sk.update();
}

// Analytic two-bone IK: bones a (upper) -> b (lower) -> c (end, whose head is placed at target).
// pole: model-space direction the middle joint should bend toward.
export function twoBoneIK(sk, a, b, c, target, pole) {
  sk.update();
  const A = sk.bones[a], B = sk.bones[b], C = sk.bones[c];
  const L1 = vec3.dist(A.head, B.head), L2 = vec3.dist(B.head, C.head);
  const H = sk.worldHead(a);
  const t = vec3.sub([0, 0, 0], target, H);
  const dist = vec3.len(t) || 1e-6;
  const d = clamp(dist, Math.abs(L1 - L2) + 1e-4, (L1 + L2) * 0.9995);
  const u = vec3.scale([0, 0, 0], t, 1 / dist);
  let v = vec3.sub([0, 0, 0], pole, vec3.scale([0, 0, 0], u, vec3.dot(pole, u)));
  if (vec3.len(v) < 1e-6) v = [0, 0, 1];
  vec3.normalize(v, v);
  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const knee = [H[0] + (u[0] * cosA + v[0] * sinA) * L1, H[1] + (u[1] * cosA + v[1] * sinA) * L1, H[2] + (u[2] * cosA + v[2] * sinA) * L1];
  aimBone(sk, a, knee, B.head);
  const end = [H[0] + u[0] * d, H[1] + u[1] * d, H[2] + u[2] * d];
  aimBone(sk, b, end, C.head);
  return { reached: dist <= (L1 + L2) * 0.9995 };
}
