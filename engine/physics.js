// Rigid-body physics: spheres, boxes, capsules and planes; sweep-and-prune broadphase;
// SAT box manifolds with face clipping; a sequential-impulse solver with warm starting,
// friction, restitution and Baumgarte stabilisation; sleeping; joints (ball, hinge with
// limits and motor, cone-twist, distance/rope, spring, weld, mouse drag); raycasts;
// contact and trigger events; and a kinematic capsule character controller.
//
// Units are metres, kilograms and seconds. +Y is up. Rotations are quaternions [x,y,z,w].

// ------------------------------------------------------------------ small vector kit
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
const norm = (a) => { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]; };
const qrot = (q, v) => {
  const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qnorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const qFromTo = (a, b) => {
  const d = dot(a, b);
  if (d < -0.999999) { const ax = norm(Math.abs(a[0]) < 0.9 ? cross([1, 0, 0], a) : cross([0, 1, 0], a)); return [ax[0], ax[1], ax[2], 0]; }
  const c = cross(a, b); return qnorm([c[0], c[1], c[2], 1 + d]);
};
const tangents = (n) => { const t1 = norm(Math.abs(n[0]) > 0.57 ? [n[1], -n[0], 0] : [0, n[2], -n[1]]); return [t1, cross(n, t1)]; };
const axesOf = (q) => [qrot(q, [1, 0, 0]), qrot(q, [0, 1, 0]), qrot(q, [0, 0, 1])];
export const physicsMath = { add, sub, scl, madd, dot, cross, len, norm, qrot, qconj, qmul, qnorm, qFromTo };

// ------------------------------------------------------------------ shapes
export class Sphere {
  constructor(radius = 0.5) { this.type = 'sphere'; this.radius = radius; }
  get volume() { return (4 / 3) * Math.PI * this.radius ** 3; }
  inertia(m) { const i = 0.4 * m * this.radius ** 2; return [i, i, i]; }
  extent() { return [this.radius, this.radius, this.radius]; }
  get boundingRadius() { return this.radius; }
}
export class Box {
  constructor(halfExtents = [0.5, 0.5, 0.5]) { this.type = 'box'; this.half = [...halfExtents]; }
  get volume() { return 8 * this.half[0] * this.half[1] * this.half[2]; }
  inertia(m) { const [x, y, z] = this.half; return [(m / 3) * (y * y + z * z), (m / 3) * (x * x + z * z), (m / 3) * (x * x + y * y)]; }
  get boundingRadius() { return len(this.half); }
}
// A capsule is a segment along local Y (from -halfHeight to +halfHeight) swept by a sphere.
export class Capsule {
  constructor(radius = 0.25, halfHeight = 0.5) { this.type = 'capsule'; this.radius = radius; this.halfHeight = halfHeight; }
  get volume() { return Math.PI * this.radius ** 2 * (2 * this.halfHeight) + (4 / 3) * Math.PI * this.radius ** 3; }
  inertia(m) { const r = this.radius, L = 2 * this.halfHeight + r; const ix = (m / 12) * (3 * r * r + L * L); return [ix, 0.45 * m * r * r, ix]; }
  get boundingRadius() { return this.radius + this.halfHeight; }
}
// Infinite static plane: dot(normal, p) = offset. Only valid on static bodies.
export class Plane {
  constructor(normal = [0, 1, 0], offset = 0) { this.type = 'plane'; this.normal = norm(normal); this.offset = offset; }
  get volume() { return 0; }
  inertia() { return [0, 0, 0]; }
  get boundingRadius() { return Infinity; }
}

// ------------------------------------------------------------------ bodies
let NEXT_ID = 1;
export class Body {
  constructor(o = {}) {
    this.id = NEXT_ID++;
    this.shape = o.shape || new Sphere(0.5);
    this.type = o.type || (o.mass === 0 || this.shape.type === 'plane' ? 'static' : 'dynamic');
    this.position = [...(o.position || [0, 0, 0])];
    this.quaternion = qnorm([...(o.rotation || [0, 0, 0, 1])]);
    this.velocity = [...(o.velocity || [0, 0, 0])];
    this.angularVelocity = [...(o.angularVelocity || [0, 0, 0])];
    this.friction = o.friction ?? 0.5;
    this.restitution = o.restitution ?? 0.15;
    this.linearDamping = o.linearDamping ?? 0.02;
    this.angularDamping = o.angularDamping ?? 0.08;
    this.gravityScale = o.gravityScale ?? 1;
    this.group = o.group ?? 1; this.mask = o.mask ?? 0xffff;
    this.isTrigger = !!o.isTrigger;
    this.allowSleep = o.allowSleep !== false;
    this.sleeping = false; this.sleepTimer = 0;
    this.force = [0, 0, 0]; this.torque = [0, 0, 0];
    this.node = o.node || null;
    this.userData = o.userData || {};
    this.name = o.name || this.shape.type;
    this.setMass(this.type === 'dynamic' ? o.mass ?? this.shape.volume * (o.density ?? 500) : 0);
    this.aabb = { min: [0, 0, 0], max: [0, 0, 0] };
    this.world = null;
  }
  setMass(m) {
    this.mass = m; this.invMass = m > 0 ? 1 / m : 0;
    const I = this.shape.inertia(m);
    this.invInertia = I.map((v) => (v > 0 ? 1 / v : 0));
  }
  get isDynamic() { return this.type === 'dynamic'; }
  get active() { return this.type === 'dynamic' && !this.sleeping; }
  // world-space inverse inertia applied to a vector
  invI(v) {
    if (!this.active) return [0, 0, 0];
    const l = qrot(qconj(this.quaternion), v);
    return qrot(this.quaternion, [l[0] * this.invInertia[0], l[1] * this.invInertia[1], l[2] * this.invInertia[2]]);
  }
  get im() { return this.active ? this.invMass : 0; }
  pointVelocity(p) { return add(this.velocity, cross(this.angularVelocity, sub(p, this.position))); }
  toWorld(local) { return add(this.position, qrot(this.quaternion, local)); }
  toLocal(world) { return qrot(qconj(this.quaternion), sub(world, this.position)); }
  applyImpulse(imp, point = this.position) {
    if (this.type !== 'dynamic') return;
    this.wake();
    this.velocity = madd(this.velocity, imp, this.invMass);
    this.angularVelocity = add(this.angularVelocity, this.invI(cross(sub(point, this.position), imp)));
  }
  applyForce(f, point = this.position) { this.force = add(this.force, f); this.torque = add(this.torque, cross(sub(point, this.position), f)); this.wake(); }
  applyTorque(t) { this.torque = add(this.torque, t); this.wake(); }
  wake() { if (this.sleeping) { this.sleeping = false; this.sleepTimer = 0; } }
  sleep() { this.sleeping = true; this.velocity = [0, 0, 0]; this.angularVelocity = [0, 0, 0]; }
  setPosition(p) { this.position = [...p]; this.wake(); }
  setRotation(q) { this.quaternion = qnorm([...q]); this.wake(); }
  updateAABB(margin = 0) {
    const s = this.shape, p = this.position, a = this.aabb;
    let e;
    if (s.type === 'sphere') e = [s.radius, s.radius, s.radius];
    else if (s.type === 'box') {
      const [x, y, z] = axesOf(this.quaternion);
      e = [0, 1, 2].map((k) => Math.abs(x[k]) * s.half[0] + Math.abs(y[k]) * s.half[1] + Math.abs(z[k]) * s.half[2]);
    } else if (s.type === 'capsule') { const u = qrot(this.quaternion, [0, s.halfHeight, 0]); e = u.map((v) => Math.abs(v) + s.radius); }
    else { a.min = [-Infinity, -Infinity, -Infinity]; a.max = [Infinity, Infinity, Infinity]; return; }
    for (let k = 0; k < 3; k++) { a.min[k] = p[k] - e[k] - margin; a.max[k] = p[k] + e[k] + margin; }
  }
  segment() { const u = qrot(this.quaternion, [0, this.shape.halfHeight, 0]); return [sub(this.position, u), add(this.position, u)]; }
}

// ------------------------------------------------------------------ narrowphase
// Every routine returns contacts [{ point, normal (from A to B), depth }] or []. Contacts are
// speculative: points up to MARGIN apart are kept (negative depth) so resting stacks don't
// flicker in and out of contact; the solver only lets such a gap close, never pulls.
const MARGIN = 0.02;
function closestOnSegment(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1e-12)));
  return madd(a, ab, t);
}
function closestSegSeg(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a < 1e-12 && e < 1e-12) return [p1, p2];
  if (a < 1e-12) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = dot(d1, r);
    if (e < 1e-12) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return [madd(p1, d1, s), madd(p2, d2, t)];
}
function sphereSphere(pa, ra, pb, rb) {
  const d = sub(pb, pa), l = len(d), depth = ra + rb - l;
  if (depth < -MARGIN) return null;
  const n = l > 1e-9 ? scl(d, 1 / l) : [0, 1, 0];
  return { point: madd(pa, n, ra - depth / 2), normal: n, depth };
}
// sphere (centre c, radius r) against box body B; normal points from the sphere to the box
function sphereBox(c, r, B) {
  const h = B.shape.half, l = B.toLocal(c);
  const cl = [Math.max(-h[0], Math.min(h[0], l[0])), Math.max(-h[1], Math.min(h[1], l[1])), Math.max(-h[2], Math.min(h[2], l[2]))];
  const d = sub(l, cl), dist = len(d);
  let nLocal, depth, surf;
  if (dist > 1e-9) { if (dist > r + MARGIN) return null; nLocal = scl(d, -1 / dist); depth = r - dist; surf = cl; }
  else { // centre inside the box: leave through the nearest face
    let best = 0, bestD = Infinity, sgn = 1;
    for (let k = 0; k < 3; k++) { const dd = h[k] - Math.abs(l[k]); if (dd < bestD) { bestD = dd; best = k; sgn = l[k] >= 0 ? 1 : -1; } }
    nLocal = [0, 0, 0]; nLocal[best] = -sgn; depth = r + bestD; surf = [...l]; surf[best] = sgn * h[best];
  }
  const n = qrot(B.quaternion, nLocal), ps = B.toWorld(surf);
  return { point: madd(ps, n, depth / 2), normal: n, depth };
}
function boxBox(A, B) {
  const a = axesOf(A.quaternion), b = axesOf(B.quaternion), ha = A.shape.half, hb = B.shape.half;
  const d = sub(B.position, A.position);
  let best = Infinity, bestAxis = null, bestType = -1, bestI = 0, bestJ = 0;
  const test = (L, type, i, j) => {
    const l = len(L); if (l < 1e-6) return true;
    L = scl(L, 1 / l);
    const ra = Math.abs(dot(a[0], L)) * ha[0] + Math.abs(dot(a[1], L)) * ha[1] + Math.abs(dot(a[2], L)) * ha[2];
    const rb = Math.abs(dot(b[0], L)) * hb[0] + Math.abs(dot(b[1], L)) * hb[1] + Math.abs(dot(b[2], L)) * hb[2];
    const dd = dot(d, L), o = ra + rb - Math.abs(dd);
    if (o < -MARGIN) return false;
    const biased = type === 2 ? o + 0.004 : type === 1 ? o + 0.0005 : o; // prefer face axes
    if (biased < best) { best = biased; bestAxis = dd < 0 ? scl(L, -1) : L; bestType = type; bestI = i; bestJ = j; bestAxis.o = o; }
    return true;
  };
  for (let i = 0; i < 3; i++) if (!test(a[i], 0, i, 0)) return [];
  for (let i = 0; i < 3; i++) if (!test(b[i], 1, i, 0)) return [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (!test(cross(a[i], b[j]), 2, i, j)) return [];
  const n = bestAxis, depth = bestAxis.o;
  if (bestType === 2) { // edge-edge
    const sa = [0, 1, 2].map((k) => (dot(a[k], n) > 0 ? 1 : -1)), sb = [0, 1, 2].map((k) => (dot(b[k], n) > 0 ? -1 : 1));
    let pa = [...A.position], pb = [...B.position];
    for (let k = 0; k < 3; k++) { if (k !== bestI) pa = madd(pa, a[k], sa[k] * ha[k]); if (k !== bestJ) pb = madd(pb, b[k], sb[k] * hb[k]); }
    const [c1, c2] = closestSegSeg(madd(pa, a[bestI], -ha[bestI]), madd(pa, a[bestI], ha[bestI]), madd(pb, b[bestJ], -hb[bestJ]), madd(pb, b[bestJ], hb[bestJ]));
    return [{ point: scl(add(c1, c2), 0.5), normal: n, depth }];
  }
  // face contact: clip the incident face against the reference face's side planes
  const refIsA = bestType === 0;
  const R = refIsA ? A : B, I = refIsA ? B : A, ra = refIsA ? a : b, ia = refIsA ? b : a, rh = R.shape.half, ih = I.shape.half;
  const nR = refIsA ? n : scl(n, -1);
  const ri = bestI;
  const cR = madd(R.position, nR, rh[ri]);
  const u = ra[(ri + 1) % 3], v = ra[(ri + 2) % 3], hu = rh[(ri + 1) % 3], hv = rh[(ri + 2) % 3];
  let k = 0, bd = -Infinity;
  for (let j = 0; j < 3; j++) { const dd = Math.abs(dot(ia[j], nR)); if (dd > bd) { bd = dd; k = j; } }
  const s = dot(ia[k], nR) > 0 ? -1 : 1;
  const cI = madd(I.position, ia[k], s * ih[k]);
  const iu = ia[(k + 1) % 3], iv = ia[(k + 2) % 3], ihu = ih[(k + 1) % 3], ihv = ih[(k + 2) % 3];
  let poly = [madd(madd(cI, iu, ihu), iv, ihv), madd(madd(cI, iu, -ihu), iv, ihv), madd(madd(cI, iu, -ihu), iv, -ihv), madd(madd(cI, iu, ihu), iv, -ihv)];
  const clip = (pts, axis, off) => { // keep dot(axis, p - cR) <= off
    const out = [];
    for (let m = 0; m < pts.length; m++) {
      const p = pts[m], q = pts[(m + 1) % pts.length], dp = dot(axis, sub(p, cR)) - off, dq = dot(axis, sub(q, cR)) - off;
      if (dp <= 0) out.push(p);
      if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) out.push(madd(p, sub(q, p), dp / (dp - dq)));
    }
    return out;
  };
  poly = clip(poly, u, hu); poly = clip(poly, scl(u, -1), hu); poly = clip(poly, v, hv); poly = clip(poly, scl(v, -1), hv);
  let pts = [];
  for (const p of poly) { const dp = -dot(nR, sub(p, cR)); if (dp >= -MARGIN) pts.push({ point: madd(p, nR, dp / 2), normal: n, depth: Math.max(0, dp) }); }
  if (pts.length > 4) { // keep the four extreme points of the patch
    const dirs = [add(u, v), sub(u, v), scl(add(u, v), -1), sub(v, u)], keep = new Set();
    for (const dir of dirs) { let bi = 0, bv = -Infinity; pts.forEach((c, m) => { const val = dot(c.point, dir); if (val > bv) { bv = val; bi = m; } }); keep.add(bi); }
    pts = [...keep].map((m) => pts[m]);
  }
  if (!pts.length) pts = [{ point: madd(cI, nR, depth / 2), normal: n, depth }];
  return pts;
}
function capsuleBox(A, B, flip) {
  const [p0, p1] = A.segment(), r = A.shape.radius, h = B.shape.half;
  // squared distance from a segment point to the box is convex in t: golden-section search
  const dist2 = (t) => { const l = B.toLocal(madd(p0, sub(p1, p0), t)); let s = 0; for (let k = 0; k < 3; k++) { const e = Math.abs(l[k]) - h[k]; if (e > 0) s += e * e; } return s; };
  let lo = 0, hi = 1;
  for (let it = 0; it < 18; it++) { const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618; if (dist2(m1) < dist2(m2)) hi = m2; else lo = m1; }
  const cands = [0, 1, (lo + hi) / 2];
  const out = [];
  for (const t of cands) {
    const c = sphereBox(madd(p0, sub(p1, p0), t), r, B);
    if (c && !out.some((o) => len(sub(o.point, c.point)) < 0.02)) out.push(c);
  }
  return flip ? out.map((c) => ({ ...c, normal: scl(c.normal, -1) })) : out;
}
function capsuleCapsule(A, B) {
  const [a0, a1] = A.segment(), [b0, b1] = B.segment(), ra = A.shape.radius, rb = B.shape.radius;
  const [c1, c2] = closestSegSeg(a0, a1, b0, b1);
  const out = [], c = sphereSphere(c1, ra, c2, rb);
  if (c) out.push(c);
  const da = norm(sub(a1, a0)), db = norm(sub(b1, b0));
  if (Math.abs(dot(da, db)) > 0.96) for (const e of [a0, a1]) {
    const q = closestOnSegment(e, b0, b1), cc = sphereSphere(e, ra, q, rb);
    if (cc && !out.some((o) => len(sub(o.point, cc.point)) < 0.02)) out.push(cc);
  }
  return out;
}
function planeContacts(P, B, flip) {
  const n = P.shape.normal, off = P.shape.offset, s = B.shape, out = [];
  const pt = (p, r) => { const d = dot(n, p) - off - r; if (d < MARGIN) out.push({ point: madd(p, n, -r - d / 2), normal: n, depth: -d }); };
  if (s.type === 'sphere') pt(B.position, s.radius);
  else if (s.type === 'capsule') { const [p0, p1] = B.segment(); pt(p0, s.radius); pt(p1, s.radius); }
  else if (s.type === 'box') for (let i = 0; i < 8; i++) pt(B.toWorld([(i & 1 ? 1 : -1) * s.half[0], (i & 2 ? 1 : -1) * s.half[1], (i & 4 ? 1 : -1) * s.half[2]]), 0);
  if (out.length > 4) out.sort((x, y) => y.depth - x.depth).length = 4;
  return flip ? out.map((c) => ({ ...c, normal: scl(c.normal, -1) })) : out;
}
// Contacts between two bodies, normals pointing from A to B.
export function collide(A, B) {
  const ta = A.shape.type, tb = B.shape.type;
  const flipped = (arr) => arr.map((c) => ({ ...c, normal: scl(c.normal, -1) }));
  if (ta === 'plane') return planeContacts(A, B, false);
  if (tb === 'plane') return planeContacts(B, A, true);
  if (ta === 'sphere' && tb === 'sphere') { const c = sphereSphere(A.position, A.shape.radius, B.position, B.shape.radius); return c ? [c] : []; }
  if (ta === 'sphere' && tb === 'box') { const c = sphereBox(A.position, A.shape.radius, B); return c ? [c] : []; }
  if (ta === 'box' && tb === 'sphere') return flipped(collide(B, A));
  if (ta === 'box' && tb === 'box') return boxBox(A, B);
  if (ta === 'capsule' && tb === 'box') return capsuleBox(A, B, false);
  if (ta === 'box' && tb === 'capsule') return capsuleBox(B, A, true);
  if (ta === 'capsule' && tb === 'capsule') return capsuleCapsule(A, B);
  if (ta === 'capsule' && tb === 'sphere') { const [p0, p1] = A.segment(), c = sphereSphere(closestOnSegment(B.position, p0, p1), A.shape.radius, B.position, B.shape.radius); return c ? [c] : []; }
  if (ta === 'sphere' && tb === 'capsule') return flipped(collide(B, A));
  return [];
}

// ------------------------------------------------------------------ constraint rows
// A row constrains the relative velocity of two bodies along one direction:
//   linear rows act at anchor offsets rA/rB along n; angular rows act on rotation about n.
class Row {
  constructor(A, B, n, rA, rB, angular = false) {
    this.A = A; this.B = B; this.n = n; this.angular = angular;
    if (angular) { this.jA = n; this.jB = n; this.lin = false; }
    else { this.jA = cross(rA, n); this.jB = cross(rB, n); this.lin = true; }
    this.iA = A ? A.invI(this.jA) : [0, 0, 0]; this.iB = B ? B.invI(this.jB) : [0, 0, 0];
    const mA = A ? A.im : 0, mB = B ? B.im : 0;
    this.mA = mA; this.mB = mB;
    const k = (this.lin ? mA + mB : 0) + dot(this.jA, this.iA) + dot(this.jB, this.iB);
    this.m = k > 1e-12 ? 1 / k : 0;
    this.bias = 0; this.lo = -Infinity; this.hi = Infinity; this.lambda = 0; this.soft = 0;
  }
  velocity() {
    const A = this.A, B = this.B;
    let v = 0;
    if (B) v += (this.lin ? dot(this.n, B.velocity) : 0) + dot(this.jB, B.angularVelocity);
    if (A) v -= (this.lin ? dot(this.n, A.velocity) : 0) + dot(this.jA, A.angularVelocity);
    return v;
  }
  apply(d) {
    const A = this.A, B = this.B;
    if (A && A.active) { if (this.lin) A.velocity = madd(A.velocity, this.n, -d * this.mA); A.angularVelocity = madd(A.angularVelocity, this.iA, -d); }
    if (B && B.active) { if (this.lin) B.velocity = madd(B.velocity, this.n, d * this.mB); B.angularVelocity = madd(B.angularVelocity, this.iB, d); }
  }
  solve() {
    if (!this.m) return;
    let d = -(this.velocity() + this.bias + this.soft * this.lambda) * this.m;
    const old = this.lambda; this.lambda = Math.max(this.lo, Math.min(this.hi, old + d)); d = this.lambda - old;
    if (d) this.apply(d);
  }
}

// ------------------------------------------------------------------ joints
class Joint {
  constructor(A, B, o = {}) { this.A = A; this.B = B; this.collideConnected = !!o.collideConnected; this.enabled = true; this.breakForce = o.breakForce ?? Infinity; this.rows = []; this.broken = false; }
  bodies() { return [this.A, this.B].filter(Boolean); }
  // point-to-point rows shared by most joints: 3 linear rows keeping the anchors together
  pointRows(dt, beta, softness = 0) {
    const A = this.A, B = this.B;
    const pa = A ? A.toWorld(this.localA) : this.localA, pb = B ? B.toWorld(this.localB) : this.localB;
    const rA = A ? sub(pa, A.position) : [0, 0, 0], rB = B ? sub(pb, B.position) : [0, 0, 0];
    const err = sub(pb, pa), rows = [];
    for (const n of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const r = new Row(A, B, n, rA, rB); r.bias = (beta / dt) * dot(err, n); r.soft = softness; rows.push(r);
    }
    return rows;
  }
  prepare() {}
  warm(cache) { this.rows.forEach((r, i) => { r.lambda = (cache[i] || 0) * 0.9; if (r.lambda) r.apply(r.lambda); }); }
}
export class BallJoint extends Joint {
  constructor(A, B, pivot, o = {}) { super(A, B, o); this.localA = A ? A.toLocal(pivot) : [...pivot]; this.localB = B ? B.toLocal(pivot) : [...pivot]; }
  prepare(dt) { this.rows = this.pointRows(dt, 0.2); }
}
// Mouse drag: pulls a body point toward a moving target with a soft, force-limited spring.
export class DragJoint extends Joint {
  constructor(body, point, o = {}) { super(null, body, o); this.localB = body.toLocal(point); this.localA = [...point]; this.maxForce = o.maxForce ?? body.mass * 60; this.stiffness = o.stiffness ?? 0.35; }
  setTarget(p) { this.localA = [...p]; this.B.wake(); }
  prepare(dt) {
    this.rows = this.pointRows(dt, this.stiffness, 0.05);
    for (const r of this.rows) { r.lo = -this.maxForce * dt; r.hi = this.maxForce * dt; }
    this.B.angularVelocity = scl(this.B.angularVelocity, 0.9);
  }
}
export class HingeJoint extends Joint {
  // axis is given in world space at creation; limits in radians relative to the start pose
  constructor(A, B, pivot, axis, o = {}) {
    super(A, B, o);
    axis = norm(axis);
    this.localA = A ? A.toLocal(pivot) : [...pivot]; this.localB = B ? B.toLocal(pivot) : [...pivot];
    this.axisA = A ? qrot(qconj(A.quaternion), axis) : axis; this.axisB = B ? qrot(qconj(B.quaternion), axis) : axis;
    const ref = tangents(axis)[0];
    this.refA = A ? qrot(qconj(A.quaternion), ref) : ref; this.refB = B ? qrot(qconj(B.quaternion), ref) : ref;
    this.min = o.min ?? -Infinity; this.max = o.max ?? Infinity;
    this.motorSpeed = o.motorSpeed ?? 0; this.maxMotorTorque = o.maxMotorTorque ?? 0;
  }
  axis() { return this.A ? qrot(this.A.quaternion, this.axisA) : this.axisA; }
  angle() {
    const ax = this.axis(), ra = this.A ? qrot(this.A.quaternion, this.refA) : this.refA, rb = this.B ? qrot(this.B.quaternion, this.refB) : this.refB;
    return Math.atan2(dot(cross(ra, rb), ax), dot(ra, rb));
  }
  prepare(dt) {
    const A = this.A, B = this.B, beta = 0.2;
    this.rows = this.pointRows(dt, beta);
    const aA = this.axis(), aB = B ? qrot(B.quaternion, this.axisB) : this.axisB;
    const e = cross(aA, aB), [t1, t2] = tangents(aA);
    for (const t of [t1, t2]) { const r = new Row(A, B, t, null, null, true); r.bias = (beta / dt) * dot(e, t); this.rows.push(r); }
    if (this.maxMotorTorque > 0) { const r = new Row(A, B, aA, null, null, true); r.bias = -this.motorSpeed; r.lo = -this.maxMotorTorque * dt; r.hi = this.maxMotorTorque * dt; this.rows.push(r); }
    if (this.min > -Infinity || this.max < Infinity) {
      const ang = this.angle();
      if (ang < this.min + 0.05) { const r = new Row(A, B, aA, null, null, true); const c = ang - this.min; r.bias = c < 0 ? (beta / dt) * c : c / dt; r.lo = 0; this.rows.push(r); }
      if (ang > this.max - 0.05) { const r = new Row(A, B, aA, null, null, true); const c = ang - this.max; r.bias = c > 0 ? (beta / dt) * c : c / dt; r.hi = 0; this.rows.push(r); }
    }
  }
}
// Ball joint with a swing cone and twist limits around the twist axis (shoulders, hips, necks).
export class ConeTwistJoint extends Joint {
  constructor(A, B, pivot, twistAxis, o = {}) {
    super(A, B, o);
    twistAxis = norm(twistAxis);
    this.localA = A.toLocal(pivot); this.localB = B.toLocal(pivot);
    this.tA = qrot(qconj(A.quaternion), twistAxis); this.tB = qrot(qconj(B.quaternion), twistAxis);
    const ref = tangents(twistAxis)[0];
    this.rA = qrot(qconj(A.quaternion), ref); this.rB = qrot(qconj(B.quaternion), ref);
    this.swing = o.swing ?? 0.7; this.twistMin = o.twistMin ?? -0.5; this.twistMax = o.twistMax ?? 0.5;
  }
  prepare(dt) {
    const A = this.A, B = this.B, beta = 0.2;
    this.rows = this.pointRows(dt, beta);
    const tA = qrot(A.quaternion, this.tA), tB = qrot(B.quaternion, this.tB);
    const swing = Math.acos(Math.max(-1, Math.min(1, dot(tA, tB))));
    if (swing > this.swing - 0.05 && swing > 1e-4) {
      const n = norm(cross(tA, tB)), c = swing - this.swing;
      const r = new Row(A, B, n, null, null, true); r.bias = c > 0 ? (beta / dt) * c : c / dt; r.hi = 0; this.rows.push(r);
    }
    // twist: compare reference vectors after removing the swing
    const sw = qFromTo(tA, tB), ra = qrot(sw, qrot(A.quaternion, this.rA)), rb = qrot(B.quaternion, this.rB);
    const tw = Math.atan2(dot(cross(ra, rb), tB), dot(ra, rb));
    if (tw < this.twistMin + 0.05) { const r = new Row(A, B, tB, null, null, true); const c = tw - this.twistMin; r.bias = c < 0 ? (beta / dt) * c : c / dt; r.lo = 0; this.rows.push(r); }
    if (tw > this.twistMax - 0.05) { const r = new Row(A, B, tB, null, null, true); const c = tw - this.twistMax; r.bias = c > 0 ? (beta / dt) * c : c / dt; r.hi = 0; this.rows.push(r); }
  }
}
// Keeps two anchor points between min and max apart (rope: min 0). With stiffness > 0 it is a spring.
export class DistanceJoint extends Joint {
  constructor(A, B, anchorA, anchorB, o = {}) {
    super(A, B, o);
    this.localA = A ? A.toLocal(anchorA) : [...anchorA]; this.localB = B ? B.toLocal(anchorB) : [...anchorB];
    const d = len(sub(anchorB, anchorA));
    this.min = o.min ?? d; this.max = o.max ?? d; this.stiffness = o.stiffness ?? 0; this.damping = o.damping ?? 0.5; this.rest = o.rest ?? d;
  }
  prepare(dt) {
    const A = this.A, B = this.B;
    const pa = A ? A.toWorld(this.localA) : this.localA, pb = B ? B.toWorld(this.localB) : this.localB;
    const d = sub(pb, pa), l = len(d), n = l > 1e-9 ? scl(d, 1 / l) : [0, 1, 0];
    const rA = A ? sub(pa, A.position) : [0, 0, 0], rB = B ? sub(pb, B.position) : [0, 0, 0];
    this.rows = [];
    if (this.stiffness > 0) { // soft spring as a force
      const vrel = dot(sub(B ? B.pointVelocity(pb) : [0, 0, 0], A ? A.pointVelocity(pa) : [0, 0, 0]), n);
      const f = -(this.stiffness * (l - this.rest) + this.damping * vrel) * dt;
      if (A) A.applyImpulse(scl(n, -f), pa); if (B) B.applyImpulse(scl(n, f), pb);
      return;
    }
    if (l > this.max - 0.01) { const r = new Row(A, B, n, rA, rB); r.bias = (0.2 / dt) * Math.max(0, l - this.max) + Math.min(0, l - this.max) / dt; r.hi = 0; this.rows.push(r); }
    if (l < this.min + 0.01 && this.min > 0) { const r = new Row(A, B, n, rA, rB); r.bias = (0.2 / dt) * Math.min(0, l - this.min) + Math.max(0, l - this.min) / dt; r.lo = 0; this.rows.push(r); }
  }
}
// Welds two bodies together (breakable with breakForce).
export class FixedJoint extends Joint {
  constructor(A, B, o = {}) {
    super(A, B, o);
    const pivot = B.position;
    this.localA = A ? A.toLocal(pivot) : [...pivot]; this.localB = [0, 0, 0];
    this.rel = qmul(qconj(A ? A.quaternion : [0, 0, 0, 1]), B.quaternion);
  }
  prepare(dt) {
    const A = this.A, B = this.B, beta = 0.2;
    this.rows = this.pointRows(dt, beta);
    const target = qmul(A ? A.quaternion : [0, 0, 0, 1], this.rel), e = qmul(B.quaternion, qconj(target));
    const s = e[3] < 0 ? -2 : 2, err = [e[0] * s, e[1] * s, e[2] * s];
    for (const n of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) { const r = new Row(A, B, n, null, null, true); r.bias = (beta / dt) * dot(err, n); this.rows.push(r); }
  }
}

// ------------------------------------------------------------------ world
export class PhysicsWorld {
  constructor(o = {}) {
    this.gravity = [...(o.gravity || [0, -9.81, 0])];
    this.bodies = []; this.joints = [];
    this.iterations = o.iterations ?? 10;
    this.substeps = o.substeps ?? 2;
    this.fixedStep = o.fixedStep ?? 1 / 60;
    this.maxSteps = 4;
    this.sleepSpeed = 0.12; this.sleepTime = 0.6;
    this.baumgarte = 0.2; this.slop = 0.006;
    this.contacts = []; this._cache = new Map(); this._jointCache = new Map();
    this._accum = 0; this.time = 0;
    this._listeners = { contact: [], trigger: [] };
    this._triggerPairs = new Set();
    this.stats = { bodies: 0, awake: 0, pairs: 0, contacts: 0, stepMs: 0 };
    this._noCollide = new Set();
  }
  add(...items) {
    for (const it of items) {
      if (it instanceof Body) { it.world = this; this.bodies.push(it); }
      else if (it instanceof Joint) { this.joints.push(it); if (!it.collideConnected && it.A && it.B) this._noCollide.add(pairKey(it.A, it.B)); }
    }
    return items[0];
  }
  remove(...items) {
    for (const it of items) {
      if (it instanceof Body) {
        const i = this.bodies.indexOf(it); if (i >= 0) this.bodies.splice(i, 1);
        this.joints = this.joints.filter((j) => { const keep = j.A !== it && j.B !== it; return keep; });
        it.world = null;
      } else { const i = this.joints.indexOf(it); if (i >= 0) this.joints.splice(i, 1); if (it.A && it.B) this._noCollide.delete(pairKey(it.A, it.B)); }
    }
  }
  on(type, fn) { this._listeners[type].push(fn); return () => { const l = this._listeners[type]; l.splice(l.indexOf(fn), 1); }; }
  // convenience constructors
  addBody(o) { return this.add(new Body(o)); }

  // Advance by real frame time using fixed steps; returns interpolation alpha.
  step(dt) {
    this._accum += Math.min(dt, this.fixedStep * this.maxSteps);
    let n = 0;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    while (this._accum >= this.fixedStep && n < this.maxSteps) { for (let s = 0; s < this.substeps; s++) this._step(this.fixedStep / this.substeps); this._accum -= this.fixedStep; n++; }
    if (typeof performance !== 'undefined') this.stats.stepMs = performance.now() - t0;
    this.syncNodes();
    return this._accum / this.fixedStep;
  }
  _pairs() {
    const list = [], planes = [];
    for (const b of this.bodies) { if (b.shape.type === 'plane') { planes.push(b); continue; } b.updateAABB(0.02); list.push(b); }
    // sweep and prune along the axis with the largest spread
    let axis = 0;
    { const mean = [0, 0, 0], sq = [0, 0, 0]; for (const b of list) for (let k = 0; k < 3; k++) { const c = (b.aabb.min[k] + b.aabb.max[k]) / 2; mean[k] += c; sq[k] += c * c; }
      let bv = -1; for (let k = 0; k < 3; k++) { const v = sq[k] - (mean[k] * mean[k]) / (list.length || 1); if (v > bv) { bv = v; axis = k; } } }
    list.sort((a, b) => a.aabb.min[axis] - b.aabb.min[axis]);
    const pairs = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.aabb.min[axis] > a.aabb.max[axis]) break;
        if (!a.active && !b.active) continue;
        if (a.aabb.min[0] > b.aabb.max[0] || a.aabb.max[0] < b.aabb.min[0] || a.aabb.min[1] > b.aabb.max[1] || a.aabb.max[1] < b.aabb.min[1] || a.aabb.min[2] > b.aabb.max[2] || a.aabb.max[2] < b.aabb.min[2]) continue;
        pairs.push(a.id < b.id ? [a, b] : [b, a]);
      }
      for (const p of planes) if (a.active) pairs.push(p.id < a.id ? [p, a] : [a, p]);
    }
    return pairs.filter(([a, b]) => (a.group & b.mask) && (b.group & a.mask) && !this._noCollide.has(pairKey(a, b)));
  }
  _step(dt) {
    const g = this.gravity;
    // forces
    for (const b of this.bodies) {
      if (!b.active) continue;
      b.velocity = madd(madd(b.velocity, g, dt * b.gravityScale), b.force, dt * b.invMass);
      b.angularVelocity = add(b.angularVelocity, scl(b.invI(b.torque), dt));
      const ld = Math.max(0, 1 - b.linearDamping * dt), ad = Math.max(0, 1 - b.angularDamping * dt);
      b.velocity = scl(b.velocity, ld); b.angularVelocity = scl(b.angularVelocity, ad);
    }
    // collisions
    const pairs = this._pairs();
    const contacts = [], newCache = new Map(), triggers = new Set();
    for (const [A, B] of pairs) {
      const cs = collide(A, B);
      if (!cs.length) continue;
      if (A.isTrigger || B.isTrigger) {
        if (!cs.some((c) => c.depth > 0)) continue; triggers.add(pairKey(A, B)); if (!this._triggerPairs.has(pairKey(A, B))) this._emit('trigger', { a: A, b: B, enter: true }); continue; }
      // wake sleepers touched by something moving
      const moving = (x) => x.active && dot(x.velocity, x.velocity) + dot(x.angularVelocity, x.angularVelocity) > this.sleepSpeed * this.sleepSpeed * 4;
      if (A.sleeping && moving(B)) A.wake(); if (B.sleeping && moving(A)) B.wake();
      const key = pairKey(A, B), old = this._cache.get(key) || [], mine = [];
      for (const c of cs) {
        const la = A.toLocal(c.point);
        let prev = null, bd = 0.04 * 0.04;
        for (const o of old) { const d = sub(o.la, la), dd = dot(d, d); if (dd < bd) { bd = dd; prev = o; } }
        const ct = { A, B, point: c.point, normal: c.normal, depth: c.depth, la, resting: !!(prev && prev.ln > 0), ln: prev ? prev.ln : 0, lt1: prev ? prev.lt1 : 0, lt2: prev ? prev.lt2 : 0 };
        contacts.push(ct); mine.push(ct);
      }
      newCache.set(key, mine);
    }
    for (const k of this._triggerPairs) if (!triggers.has(k)) { const [ia, ib] = k.split(':').map(Number); this._emit('trigger', { a: this.bodies.find((b) => b.id === ia), b: this.bodies.find((b) => b.id === ib), enter: false }); }
    this._triggerPairs = triggers;
    // prepare contact rows
    const rows = [];
    for (const c of contacts) {
      const { A, B, normal: n } = c;
      const rA = sub(c.point, A.position), rB = sub(c.point, B.position);
      const rn = new Row(A, B, n, rA, rB); rn.lo = 0;
      const vn = dot(sub(B.pointVelocity(c.point), A.pointVelocity(c.point)), n);
      const e = Math.max(A.restitution, B.restitution);
      const bounce = vn < -1 && !c.resting ? -e * vn : 0; // only fresh impacts bounce
      const target = c.depth > 0 ? Math.min(4, (this.baumgarte / dt) * Math.max(0, c.depth - this.slop)) : c.depth / dt;
      // bounce once the gap would close this step (speculative contacts stop short of the surface)
      const closing = c.depth > 0 || vn * dt <= c.depth;
      rn.bias = closing && bounce > 0 ? -Math.max(bounce, target) : -target;
      const [t1, t2] = tangents(n);
      const mu = Math.sqrt(A.friction * B.friction);
      const f1 = new Row(A, B, t1, rA, rB), f2 = new Row(A, B, t2, rA, rB);
      c.rows = [rn, f1, f2]; c.mu = mu; c.vn = vn;
      rn.lambda = c.ln * 0.95; f1.lambda = c.lt1 * 0.95; f2.lambda = c.lt2 * 0.95;
      for (const r of c.rows) if (r.lambda) r.apply(r.lambda);
      rows.push(c);
    }
    // joints
    const joints = this.joints.filter((j) => j.enabled && !j.broken);
    for (const j of joints) {
      if (j.bodies().some((b) => b.active)) for (const b of j.bodies()) if (b.isDynamic) b.wake();
      j.prepare(dt);
      if (j.rows.length) j.warm(this._jointCache.get(j) || []);
    }
    // iterate
    for (let it = 0; it < this.iterations; it++) {
      for (const j of joints) for (const r of j.rows) r.solve();
      for (const c of rows) {
        const [rn, f1, f2] = c.rows, lim = c.mu * rn.lambda;
        f1.lo = -lim; f1.hi = lim; f2.lo = -lim; f2.hi = lim;
        f1.solve(); f2.solve(); rn.solve();
      }
    }
    for (const c of rows) { c.ln = c.rows[0].lambda; c.lt1 = c.rows[1].lambda; c.lt2 = c.rows[2].lambda; }
    for (const j of joints) {
      this._jointCache.set(j, j.rows.map((r) => r.lambda));
      if (j.breakForce < Infinity) { let f = 0; for (const r of j.rows) if (r.lin) f += r.lambda * r.lambda; if (Math.sqrt(f) / dt > j.breakForce) { j.broken = true; if (j.A && j.B) this._noCollide.delete(pairKey(j.A, j.B)); } }
    }
    this._cache = newCache;
    // integrate
    let awake = 0;
    for (const b of this.bodies) {
      if (b.type === 'static' || b.sleeping) continue;
      b.position = madd(b.position, b.velocity, dt);
      const w = b.angularVelocity;
      if (w[0] || w[1] || w[2]) { const dq = qmul([w[0] * dt * 0.5, w[1] * dt * 0.5, w[2] * dt * 0.5, 0], b.quaternion); b.quaternion = qnorm([b.quaternion[0] + dq[0], b.quaternion[1] + dq[1], b.quaternion[2] + dq[2], b.quaternion[3] + dq[3]]); }
      if (b.type !== 'dynamic') continue;
      b.force = [0, 0, 0]; b.torque = [0, 0, 0];
      awake++;
      const e = dot(b.velocity, b.velocity) + dot(b.angularVelocity, b.angularVelocity) * 0.25;
      if (b.allowSleep && e < this.sleepSpeed * this.sleepSpeed) { b.sleepTimer += dt; if (b.sleepTimer > this.sleepTime) b.sleep(); } else b.sleepTimer = 0;
      if (b.position[1] < -200) { b.sleep(); b.userData.fellOut = true; }
    }
    // impact events
    if (this._listeners.contact.length) for (const c of rows) { const imp = c.ln; if (-c.vn > 1.2 && imp > 0) this._emit('contact', { a: c.A, b: c.B, point: c.point, normal: c.normal, speed: -c.vn, impulse: imp }); }
    this.contacts = contacts;
    this.time += dt;
    this.stats.bodies = this.bodies.length; this.stats.awake = awake; this.stats.pairs = pairs.length; this.stats.contacts = contacts.length;
  }
  _emit(type, e) { for (const f of this._listeners[type]) f(e); }
  syncNodes() {
    for (const b of this.bodies) {
      const n = b.node; if (!n) continue;
      n.position[0] = b.position[0]; n.position[1] = b.position[1]; n.position[2] = b.position[2];
      n.rotation[0] = b.quaternion[0]; n.rotation[1] = b.quaternion[1]; n.rotation[2] = b.quaternion[2]; n.rotation[3] = b.quaternion[3];
    }
  }
  // Nearest hit along a ray: { body, point, normal, distance } or null
  raycast(origin, dir, maxDist = 1000, { mask = 0xffff, ignore = null, triggers = false } = {}) {
    dir = norm(dir);
    let best = null;
    for (const b of this.bodies) {
      if (!(b.group & mask) || b === ignore || (ignore && ignore.has && ignore.has(b)) || (b.isTrigger && !triggers)) continue;
      const h = rayBody(b, origin, dir, best ? best.distance : maxDist);
      if (h) best = { body: b, ...h };
    }
    return best;
  }
  // Bodies whose shape contains or overlaps a sphere
  overlapSphere(center, radius) {
    const probe = new Body({ shape: new Sphere(radius), position: center, type: 'kinematic' });
    return this.bodies.filter((b) => collide(b, probe).length);
  }
  explode(center, radius, strength) {
    for (const b of this.bodies) {
      if (!b.isDynamic) continue;
      const d = sub(b.position, center), l = len(d);
      if (l > radius) continue;
      b.applyImpulse(scl(norm(add(d, [0, 0.5, 0])), strength * (1 - l / radius) * b.mass), madd(b.position, norm(d), -0.05));
    }
  }
  // Wireframe lines for renderer.drawLines: [x,y,z,r,g,b,a] per vertex
  debugLines({ contacts = true } = {}) {
    const out = [];
    const seg = (a, b, c) => out.push(a[0], a[1], a[2], c[0], c[1], c[2], c[3], b[0], b[1], b[2], c[0], c[1], c[2], c[3]);
    const circle = (b, c, r, u, v, col) => { let prev = null; for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI * 2, p = madd(madd(c, u, Math.cos(a) * r), v, Math.sin(a) * r); if (prev) seg(prev, p, col); prev = p; } };
    for (const b of this.bodies) {
      const col = b.isTrigger ? [0.3, 0.9, 1, 0.9] : b.type === 'static' ? [0.5, 0.5, 0.55, 0.6] : b.sleeping ? [0.35, 0.45, 1, 0.9] : [0.4, 1, 0.45, 0.9];
      const [x, y, z] = axesOf(b.quaternion), s = b.shape;
      if (s.type === 'box') {
        const c = (i) => b.toWorld([(i & 1 ? 1 : -1) * s.half[0], (i & 2 ? 1 : -1) * s.half[1], (i & 4 ? 1 : -1) * s.half[2]]);
        for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) seg(c(i), c(j), col);
      } else if (s.type === 'sphere') { circle(b, b.position, s.radius, x, y, col); circle(b, b.position, s.radius, y, z, col); circle(b, b.position, s.radius, x, z, col); }
      else if (s.type === 'capsule') {
        const [p0, p1] = b.segment();
        circle(b, p0, s.radius, x, z, col); circle(b, p1, s.radius, x, z, col);
        for (const d of [x, z, scl(x, -1), scl(z, -1)]) seg(madd(p0, d, s.radius), madd(p1, d, s.radius), col);
      }
    }
    if (contacts) for (const c of this.contacts) seg(c.point, madd(c.point, c.normal, 0.15 + c.depth), [1, 0.35, 0.2, 1]);
    for (const j of this.joints) if (!j.broken && j.localA) { const pa = j.A ? j.A.toWorld(j.localA) : j.localA, pb = j.B ? j.B.toWorld(j.localB) : j.localB; seg(j.A ? j.A.position : pa, pa, [1, 0.85, 0.2, 1]); seg(pb, j.B ? j.B.position : pb, [1, 0.85, 0.2, 1]); }
    return new Float32Array(out);
  }
}
const pairKey = (a, b) => (a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id);

// ------------------------------------------------------------------ ray tests
function raySphere(o, d, c, r, maxT) {
  const m = sub(o, c), b = dot(m, d), cc = dot(m, m) - r * r;
  if (cc > 0 && b > 0) return null;
  const disc = b * b - cc; if (disc < 0) return null;
  let t = -b - Math.sqrt(disc); if (t < 0) t = 0;
  return t <= maxT ? t : null;
}
function rayBody(b, o, d, maxT) {
  const s = b.shape;
  if (s.type === 'plane') {
    const den = dot(s.normal, d); if (Math.abs(den) < 1e-9) return null;
    const t = (s.offset - dot(s.normal, o)) / den;
    return t >= 0 && t <= maxT ? { distance: t, point: madd(o, d, t), normal: den < 0 ? s.normal : scl(s.normal, -1) } : null;
  }
  if (s.type === 'sphere') { const t = raySphere(o, d, b.position, s.radius, maxT); return t === null ? null : { distance: t, point: madd(o, d, t), normal: norm(sub(madd(o, d, t), b.position)) }; }
  if (s.type === 'box') {
    const lo = b.toLocal(o), ld = qrot(qconj(b.quaternion), d);
    let tmin = 0, tmax = maxT, axis = -1, sgn = 1;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(ld[k]) < 1e-12) { if (Math.abs(lo[k]) > s.half[k]) return null; continue; }
      let t1 = (-s.half[k] - lo[k]) / ld[k], t2 = (s.half[k] - lo[k]) / ld[k], sg = -1;
      if (t1 > t2) { [t1, t2] = [t2, t1]; sg = 1; }
      if (t1 > tmin) { tmin = t1; axis = k; sgn = sg; }
      tmax = Math.min(tmax, t2); if (tmin > tmax) return null;
    }
    const nl = [0, 0, 0]; if (axis >= 0) nl[axis] = sgn; else nl[1] = 1;
    return { distance: tmin, point: madd(o, d, tmin), normal: qrot(b.quaternion, nl) };
  }
  if (s.type === 'capsule') { // march: sphere-trace the capsule distance field
    const [p0, p1] = b.segment();
    let t = 0;
    for (let i = 0; i < 64 && t <= maxT; i++) {
      const p = madd(o, d, t), q = closestOnSegment(p, p0, p1), dist = len(sub(p, q)) - s.radius;
      if (dist < 1e-4) return { distance: t, point: p, normal: norm(sub(p, q)) };
      t += dist;
    }
  }
  return null;
}

// ------------------------------------------------------------------ character controller
// A kinematic capsule that walks, jumps, slides along walls, steps onto low ledges and
// pushes dynamic bodies out of the way. position is the capsule's feet.
export class CharacterController {
  constructor(world, { radius = 0.32, height = 1.8, position = [0, 0, 0], stepHeight = 0.3, maxSlope = 50, pushStrength = 1, mask = 0xffff } = {}) {
    this.world = world; this.radius = radius; this.height = height;
    this.position = [...position]; this.velocity = [0, 0, 0];
    this.grounded = false; this.groundNormal = [0, 1, 0]; this.groundBody = null;
    this.stepHeight = stepHeight; this.minGroundY = Math.cos((maxSlope * Math.PI) / 180);
    this.pushStrength = pushStrength; this.mask = mask;
    this.body = new Body({ shape: new Capsule(radius, Math.max(0.01, height / 2 - radius)), type: 'kinematic', position: this._center(), group: 2 });
    this.body.userData.controller = this;
    world.add(this.body);
  }
  _center() { return [this.position[0], this.position[1] + this.height / 2, this.position[2]]; }
  jump(speed = 5) { if (this.grounded) { this.velocity[1] = speed; this.grounded = false; this._jumped = true; } }
  // wish: desired horizontal velocity [x, z] in m/s
  move(wish, dt) {
    const w = this.world, v = this.velocity;
    const accel = this.grounded ? 14 : 3;
    v[0] += (wish[0] - v[0]) * Math.min(1, accel * dt); v[2] += (wish[1] - v[2]) * Math.min(1, accel * dt);
    v[1] += w.gravity[1] * dt;
    this.position = madd(this.position, v, dt);
    const wasGrounded = this.grounded;
    this.grounded = false; this.groundBody = null;
    const body = this.body;
    for (let it = 0; it < 4; it++) {
      body.position = this._center(); body.updateAABB(0.05);
      let moved = false;
      for (const other of w.bodies) {
        if (other === body || other.isTrigger || !(other.group & this.mask)) continue;
        if (other.shape.type !== 'plane') { other.updateAABB(); const a = body.aabb, b = other.aabb; if (a.min[0] > b.max[0] || a.max[0] < b.min[0] || a.min[1] > b.max[1] || a.max[1] < b.min[1] || a.min[2] > b.max[2] || a.max[2] < b.min[2]) continue; }
        const cs = collide(body, other);
        for (const c of cs) {
          if (c.depth < 1e-4) continue;
          const n = c.normal; // from us to the other body
          if (other.isDynamic) { // push it, and give way a little
            const push = Math.max(0, dot(v, n)) + 0.5;
            other.applyImpulse(scl(n, push * this.pushStrength * Math.min(other.mass, 80) * dt * 6), c.point);
            this.position = madd(this.position, n, -c.depth * 0.5);
          } else {
            // low ledge in front of us: step up instead of stopping
            const top = c.point[1] - this.position[1];
            if (-n[1] < this.minGroundY && top > 0.02 && top < this.stepHeight && (wasGrounded || this.grounded)) { this.position[1] += top + 0.01; moved = true; continue; }
            this.position = madd(this.position, n, -c.depth);
          }
          const vn = dot(v, n);
          if (vn > 0) { v[0] -= n[0] * vn; v[1] -= n[1] * vn; v[2] -= n[2] * vn; }
          if (-n[1] >= this.minGroundY) { this.grounded = true; this.groundNormal = scl(n, -1); this.groundBody = other; }
          moved = true;
        }
      }
      if (!moved) break;
    }
    // stick to the ground when walking down slopes and steps
    if (!this.grounded && wasGrounded && !this._jumped && v[1] <= 0) {
      const hit = w.raycast(add(this.position, [0, 0.05, 0]), [0, -1, 0], this.stepHeight + 0.1, { ignore: body, mask: this.mask });
      if (hit && hit.normal[1] >= this.minGroundY) { this.position[1] = hit.point[1]; this.grounded = true; this.groundNormal = hit.normal; this.groundBody = hit.body; }
    }
    if (this.grounded && v[1] < 0) v[1] = 0;
    this._jumped = false;
    body.position = this._center();
    return this;
  }
  get speed() { return Math.hypot(this.velocity[0], this.velocity[2]); }
}
