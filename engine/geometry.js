// Geometry container + a library of parametric shape generators.
// Every generator returns a Geometry with positions, normals, uvs and indices.
import { vec3, mat4, clamp } from './math.js';

export class Geometry {
  constructor({ positions, normals, uvs, indices } = {}) {
    this.positions = positions instanceof Float32Array ? positions : new Float32Array(positions || []);
    this.normals = normals ? (normals instanceof Float32Array ? normals : new Float32Array(normals)) : new Float32Array(this.positions.length);
    this.uvs = uvs ? (uvs instanceof Float32Array ? uvs : new Float32Array(uvs)) : new Float32Array((this.positions.length / 3) * 2);
    this.indices = indices instanceof Uint32Array ? indices : new Uint32Array(indices || []);
    this.joints = null; // Float32Array vec4 (bone indices)
    this.weights = null; // Float32Array vec4
    this.rest = null; // optional rest-space positions for stable procedural texturing
    this.version = 0; // bump to re-upload to GPU
    if (!normals) this.computeNormals();
  }
  get vertexCount() { return this.positions.length / 3; }
  get triangleCount() { return this.indices.length / 3; }
  clone() {
    const g = new Geometry({ positions: this.positions.slice(), normals: this.normals.slice(), uvs: this.uvs.slice(), indices: this.indices.slice() });
    if (this.joints) g.joints = this.joints.slice();
    if (this.weights) g.weights = this.weights.slice();
    if (this.rest) g.rest = this.rest.slice();
    return g;
  }
  // Smooth normals. Vertices that share a position AND a similar reference normal are
  // averaged together, so UV seams disappear while intentional hard edges survive.
  computeNormals(refNormals = null) {
    const P = this.positions, I = this.indices, n = P.length / 3;
    const acc = new Float32Array(n * 3);
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], e1 = [0, 0, 0], e2 = [0, 0, 0], fn = [0, 0, 0];
    for (let t = 0; t < I.length; t += 3) {
      const i0 = I[t], i1 = I[t + 1], i2 = I[t + 2];
      vec3.set(a, P[i0 * 3], P[i0 * 3 + 1], P[i0 * 3 + 2]);
      vec3.set(b, P[i1 * 3], P[i1 * 3 + 1], P[i1 * 3 + 2]);
      vec3.set(c, P[i2 * 3], P[i2 * 3 + 1], P[i2 * 3 + 2]);
      vec3.sub(e1, b, a); vec3.sub(e2, c, a); vec3.cross(fn, e1, e2); // area weighted
      for (const i of [i0, i1, i2]) { acc[i * 3] += fn[0]; acc[i * 3 + 1] += fn[1]; acc[i * 3 + 2] += fn[2]; }
    }
    const ref = refNormals || this.normals;
    const hasRef = ref && ref.length === P.length && ref.some((v) => v !== 0);
    // weld pass
    const map = new Map();
    const q = (v) => Math.round(v * 1e4);
    const groups = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      let key = q(P[i * 3]) + ',' + q(P[i * 3 + 1]) + ',' + q(P[i * 3 + 2]);
      let list = map.get(key);
      if (!list) { list = []; map.set(key, list); }
      let g = -1;
      for (const j of list) {
        if (!hasRef) { g = j; break; }
        const d = ref[i * 3] * ref[j * 3] + ref[i * 3 + 1] * ref[j * 3 + 1] + ref[i * 3 + 2] * ref[j * 3 + 2];
        if (d > 0.5) { g = j; break; }
      }
      if (g < 0) { list.push(i); groups[i] = i; } else groups[i] = g;
    }
    const sum = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const g = groups[i]; sum[g * 3] += acc[i * 3]; sum[g * 3 + 1] += acc[i * 3 + 1]; sum[g * 3 + 2] += acc[i * 3 + 2]; }
    const N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const g = groups[i];
      let x = sum[g * 3], y = sum[g * 3 + 1], z = sum[g * 3 + 2];
      let l = Math.hypot(x, y, z);
      if (l < 1e-12) { x = hasRef ? ref[i * 3] : 0; y = hasRef ? ref[i * 3 + 1] : 1; z = hasRef ? ref[i * 3 + 2] : 0; l = Math.hypot(x, y, z) || 1; }
      N[i * 3] = x / l; N[i * 3 + 1] = y / l; N[i * 3 + 2] = z / l;
    }
    this.normals = N;
    this.version++;
    return this;
  }
  applyMatrix(m) {
    const P = this.positions, N = this.normals, nm = mat4.normalMatrix(mat4.create(), m), v = [0, 0, 0];
    for (let i = 0; i < P.length; i += 3) {
      vec3.set(v, P[i], P[i + 1], P[i + 2]); vec3.transformMat4(v, v, m); P[i] = v[0]; P[i + 1] = v[1]; P[i + 2] = v[2];
      vec3.set(v, N[i], N[i + 1], N[i + 2]); vec3.transformDir(v, v, nm); vec3.normalize(v, v); N[i] = v[0]; N[i + 1] = v[1]; N[i + 2] = v[2];
    }
    // mirrored transforms flip winding
    const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
    if (det < 0) this.flipWinding();
    this.version++;
    return this;
  }
  flipWinding() {
    const I = this.indices;
    for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
    return this;
  }
  bounds() {
    const P = this.positions, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
    if (!P.length) return { min: [0, 0, 0], max: [0, 0, 0] };
    return { min, max };
  }
  static merge(list) {
    let nv = 0, ni = 0;
    for (const g of list) { nv += g.vertexCount; ni += g.indices.length; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const g of list) {
      P.set(g.positions, vo * 3); N.set(g.normals, vo * 3); U.set(g.uvs, vo * 2);
      for (let i = 0; i < g.indices.length; i++) I[io + i] = g.indices[i] + vo;
      vo += g.vertexCount; io += g.indices.length;
    }
    return new Geometry({ positions: P, normals: N, uvs: U, indices: I });
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
class B {
  constructor() { this.p = []; this.n = []; this.u = []; this.i = []; }
  v(p, n, uv) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.u.push(uv[0], uv[1]); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, d, b, c, d); }
  // Parametric grid; fn(u,v) -> [pos, normal]. Winding chosen so normals face outward
  grid(us, vs, fn, flip = false) {
    const base = this.p.length / 3;
    for (let j = 0; j <= vs; j++) for (let i = 0; i <= us; i++) {
      const u = i / us, v = j / vs; const [p, n] = fn(u, v);
      this.v(p, n || [0, 1, 0], [u, v]);
    }
    for (let j = 0; j < vs; j++) for (let i = 0; i < us; i++) {
      const a = base + j * (us + 1) + i, b = a + 1, c = a + us + 2, d = a + us + 1;
      if (flip) this.quad(a, d, c, b); else this.quad(a, b, c, d);
    }
  }
  // Triangle-fan disc cap
  disc(center, ring, normal, flip) {
    const c = this.v(center, normal, [0.5, 0.5]);
    const idx = ring.map((p, k) => this.v(p, normal, [0.5 + 0.5 * Math.cos((k / ring.length) * 6.283), 0.5 + 0.5 * Math.sin((k / ring.length) * 6.283)]));
    for (let k = 0; k < idx.length - 1; k++) flip ? this.tri(c, idx[k + 1], idx[k]) : this.tri(c, idx[k], idx[k + 1]);
  }
  build(recompute = false) {
    const g = new Geometry({ positions: this.p, normals: this.n, uvs: this.u, indices: this.i });
    if (recompute) g.computeNormals();
    return g;
  }
}

const TAU = Math.PI * 2;
const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);

export function box({ width = 1, height = 1, depth = 1, bevel = 0, bevelSegments = 3, segments = 1 } = {}) {
  const b = new B();
  const h = [width / 2, height / 2, depth / 2];
  const r = clamp(bevel, 0, Math.min(...h) * 0.999);
  const segs = r > 0 ? Math.max(1, bevelSegments | 0) : 0;
  const inner = Math.max(1, segments | 0);
  const coords = (hh) => {
    const out = [];
    if (!segs) { for (let k = 0; k <= inner; k++) out.push(-hh + (2 * hh * k) / inner); return out; }
    for (let k = 0; k <= segs; k++) out.push(-hh + r * (1 - Math.cos((k / segs) * Math.PI / 2)));
    for (let k = 1; k < inner; k++) out.push(-(hh - r) + (2 * (hh - r) * k) / inner);
    for (let k = segs; k >= 0; k--) out.push(hh - r * (1 - Math.cos((k / segs) * Math.PI / 2)));
    return out;
  };
  const C = h.map(coords);
  // faces: axis index, sign
  const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (const [ax, s] of faces) {
    const u = (ax + 1) % 3, w = (ax + 2) % 3;
    const cu = C[u], cw = C[w];
    const base = b.p.length / 3;
    for (let j = 0; j < cw.length; j++) for (let i = 0; i < cu.length; i++) {
      const p = [0, 0, 0]; p[ax] = s * h[ax]; p[u] = cu[i]; p[w] = cw[j];
      let n = [0, 0, 0]; n[ax] = s;
      if (r > 0) {
        const inner = p.map((x, k) => clamp(x, -(h[k] - r), h[k] - r));
        const off = vec3.sub([0, 0, 0], p, inner);
        vec3.normalize(n, off);
        for (let k = 0; k < 3; k++) p[k] = inner[k] + n[k] * r;
      }
      b.v(p, n, [i / (cu.length - 1), j / (cw.length - 1)]);
    }
    for (let j = 0; j < cw.length - 1; j++) for (let i = 0; i < cu.length - 1; i++) {
      const a = base + j * cu.length + i, bb = a + 1, c = a + cu.length + 1, d = a + cu.length;
      if (s > 0) b.quad(a, bb, c, d); else b.quad(a, d, c, bb);
    }
  }
  return b.build();
}

export function sphere({ radius = 0.5, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = 360, thetaStart = 0, thetaLength = 180 } = {}) {
  const b = new B();
  const ps = phiStart * Math.PI / 180, pl = phiLength * Math.PI / 180, ts = thetaStart * Math.PI / 180, tl = thetaLength * Math.PI / 180;
  b.grid(Math.max(3, widthSegments | 0), Math.max(2, heightSegments | 0), (u, v) => {
    const phi = ps + u * pl, th = ts + v * tl;
    const n = [Math.sin(th) * Math.sin(phi), Math.cos(th), Math.sin(th) * Math.cos(phi)];
    return [[n[0] * radius, n[1] * radius, n[2] * radius], n];
  }, true);
  return b.build();
}

// Superquadric (superellipsoid): e1 shapes the vertical profile, e2 the horizontal
// cross-section. e=1 sphere, e->0 box, e=2 octahedron-like, e>2 pinched stars.
export function superquadric({ rx = 0.5, ry = 0.5, rz = 0.5, e1 = 1, e2 = 1, widthSegments = 40, heightSegments = 24, phiStart = 0, phiLength = 360, thetaStart = 0, thetaLength = 180, taperTop = 1, taperBottom = 1 } = {}) {
  const b = new B();
  const ps = phiStart * Math.PI / 180, pl = phiLength * Math.PI / 180, ts = thetaStart * Math.PI / 180, tl = thetaLength * Math.PI / 180;
  b.grid(Math.max(3, widthSegments | 0), Math.max(2, heightSegments | 0), (u, v) => {
    const phi = ps + u * pl, th = ts + v * tl; // th 0 = top
    const lat = Math.PI / 2 - th;
    const cl = spow(Math.cos(lat), e1), sl = spow(Math.sin(lat), e1);
    const y = ry * sl;
    const t = y >= 0 ? taperTop : taperBottom;
    const k = 1 + (t - 1) * Math.abs(sl);
    const p = [rx * cl * spow(Math.sin(phi), e2) * k, y, rz * cl * spow(Math.cos(phi), e2) * k];
    return [p, [p[0] / (rx * rx), p[1] / (ry * ry), p[2] / (rz * rz)]];
  }, true);
  return b.build(true);
}

export function cylinder({ radiusTop = 0.5, radiusBottom = 0.5, height = 1, radialSegments = 32, heightSegments = 1, capTop = true, capBottom = true, arc = 360 } = {}) {
  const b = new B();
  const rs = Math.max(3, radialSegments | 0), a = arc * Math.PI / 180, h2 = height / 2;
  const slope = (radiusBottom - radiusTop) / height;
  b.grid(rs, Math.max(1, heightSegments | 0), (u, v) => {
    const t = u * a, r = radiusTop + (radiusBottom - radiusTop) * v;
    const n = vec3.normalize([0, 0, 0], [Math.sin(t), slope, Math.cos(t)]);
    return [[Math.sin(t) * r, h2 - v * height, Math.cos(t) * r], n];
  }, true);
  const ring = (y, r) => Array.from({ length: rs + 1 }, (_, k) => [Math.sin((k / rs) * a) * r, y, Math.cos((k / rs) * a) * r]);
  if (capTop && radiusTop > 0) b.disc([0, h2, 0], ring(h2, radiusTop), [0, 1, 0], false);
  if (capBottom && radiusBottom > 0) b.disc([0, -h2, 0], ring(-h2, radiusBottom), [0, -1, 0], true);
  return b.build();
}

export function cone(o = {}) { return cylinder({ radiusTop: 0, radiusBottom: o.radius ?? 0.5, height: o.height ?? 1, radialSegments: o.radialSegments ?? 32, heightSegments: o.heightSegments ?? 4, capBottom: o.capBottom ?? true, capTop: false, arc: o.arc ?? 360 }); }

export function torus({ radius = 0.5, tube = 0.15, radialSegments = 20, tubularSegments = 48, arc = 360, tubeScaleY = 1 } = {}) {
  const b = new B();
  const a = arc * Math.PI / 180;
  b.grid(Math.max(3, tubularSegments | 0), Math.max(3, radialSegments | 0), (u, v) => {
    const t = u * a, p = v * TAU;
    const cx = Math.sin(t) * radius, cz = Math.cos(t) * radius;
    const n = [Math.cos(p) * Math.sin(t), Math.sin(p), Math.cos(p) * Math.cos(t)];
    return [[cx + n[0] * tube, n[1] * tube * tubeScaleY, cz + n[2] * tube], [n[0], n[1] / tubeScaleY, n[2]]];
  });
  return b.build(true);
}

export function capsule({ radius = 0.25, length = 0.5, radialSegments = 24, capSegments = 8 } = {}) {
  const b = new B();
  const rs = Math.max(3, radialSegments | 0), cs = Math.max(2, capSegments | 0);
  const rows = []; // [y, r, ny, nr]
  for (let k = 0; k <= cs; k++) { const t = (k / cs) * Math.PI / 2; rows.push([length / 2 + Math.cos(t) * radius, Math.sin(t) * radius, Math.cos(t), Math.sin(t)]); }
  for (let k = 0; k <= cs; k++) { const t = (k / cs) * Math.PI / 2; rows.push([-length / 2 - Math.sin(t) * radius, Math.cos(t) * radius, -Math.sin(t), Math.cos(t)]); }
  b.grid(rs, rows.length - 1, (u, v) => {
    const [y, r, ny, nr] = rows[Math.round(v * (rows.length - 1))], t = u * TAU;
    return [[Math.sin(t) * r, y, Math.cos(t) * r], [Math.sin(t) * nr, ny, Math.cos(t) * nr]];
  }, true);
  return b.build();
}

export function plane({ width = 1, depth = 1, subdivisions = 1 } = {}) {
  const b = new B();
  const s = Math.max(1, subdivisions | 0);
  b.grid(s, s, (u, v) => [[(u - 0.5) * width, 0, (v - 0.5) * depth], [0, 1, 0]], true);
  return b.build();
}

// Revolve a 2D profile [[radius, y], ...] around Y (the pottery-wheel tool).
export function lathe({ points = [[0, 0], [0.4, 0], [0.5, 0.5], [0.3, 1], [0, 1]], segments = 40, arc = 360, smooth = 0 } = {}) {
  let pts = points;
  for (let s = 0; s < (smooth | 0); s++) pts = chaikin(pts, false);
  const b = new B();
  const a = arc * Math.PI / 180;
  b.grid(Math.max(3, segments | 0), pts.length - 1, (u, v) => {
    const [r, y] = pts[Math.round(v * (pts.length - 1))], t = u * a;
    return [[Math.sin(t) * r, y, Math.cos(t) * r], null];
  });
  // Profiles are listed bottom -> top along the outside; that winding faces outward.
  return b.build(true);
}

function chaikin(pts, closed) {
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    out.push(a.map((x, k) => x * 0.75 + b[k] * 0.25), a.map((x, k) => x * 0.25 + b[k] * 0.75));
  }
  out.push(pts[pts.length - 1]);
  return closed ? out.slice(1, -1) : out;
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}
export function sampleSpline(points, samplesPerSegment = 8) {
  if (points.length < 2) return points.slice();
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < samplesPerSegment; s++) out.push(catmull(p0, p1, p2, p3, s / samplesPerSegment));
  }
  out.push(points[points.length - 1]);
  return out;
}

// Sweep a (optionally elliptical, optionally partial) circle along a spline path.
// radii: one value per path point (interpolated), great for limbs and sleeves.
export function tube({ path = [[0, 0, 0], [0, 0.5, 0.2], [0, 1, 0]], radii = [0.1], radialSegments = 20, samples = 10, caps = true, flatten = 1, arc = 360, arcOffset = 0, twist = 0 } = {}) {
  const pts = sampleSpline(path, Math.max(1, samples | 0));
  const R = radii.length ? radii : [0.1];
  const radiusAt = (t) => {
    if (R.length === 1) return R[0];
    const x = t * (R.length - 1), i = Math.min(R.length - 2, Math.floor(x)), f = x - i;
    const s = f * f * (3 - 2 * f);
    return R[i] + (R[i + 1] - R[i]) * s;
  };
  // parallel transport frames
  const T = pts.map((p, i) => vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)])));
  let nrm = Math.abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  nrm = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], vec3.cross([0, 0, 0], T[0], nrm), T[0]));
  const Ns = [nrm], Bs = [vec3.cross([0, 0, 0], T[0], nrm)];
  for (let i = 1; i < pts.length; i++) {
    const prevN = Ns[i - 1];
    let n = vec3.sub([0, 0, 0], prevN, vec3.scale([0, 0, 0], T[i], vec3.dot(prevN, T[i])));
    vec3.normalize(n, n);
    Ns.push(n); Bs.push(vec3.cross([0, 0, 0], T[i], n));
  }
  const b = new B();
  const rs = Math.max(3, radialSegments | 0), a = arc * Math.PI / 180, ao = arcOffset * Math.PI / 180, tw = twist * Math.PI / 180;
  const ringPt = (i, u) => {
    const t = ao + u * a + tw * (i / (pts.length - 1)), r = radiusAt(i / (pts.length - 1));
    const c = Math.cos(t), s = Math.sin(t);
    const dir = [Ns[i][0] * c * flatten + Bs[i][0] * s, Ns[i][1] * c * flatten + Bs[i][1] * s, Ns[i][2] * c * flatten + Bs[i][2] * s];
    return [[pts[i][0] + dir[0] * r, pts[i][1] + dir[1] * r, pts[i][2] + dir[2] * r], vec3.normalize([0, 0, 0], [Ns[i][0] * c / flatten + Bs[i][0] * s, Ns[i][1] * c / flatten + Bs[i][1] * s, Ns[i][2] * c / flatten + Bs[i][2] * s])];
  };
  b.grid(rs, pts.length - 1, (u, v) => ringPt(Math.round(v * (pts.length - 1)), u));
  if (caps && arc >= 360) {
    const last = pts.length - 1;
    b.disc(pts[0], Array.from({ length: rs + 1 }, (_, k) => ringPt(0, k / rs)[0]), vec3.scale([0, 0, 0], T[0], -1), true);
    b.disc(pts[last], Array.from({ length: rs + 1 }, (_, k) => ringPt(last, k / rs)[0]), T[last], false);
  }
  const g = b.build();
  g.computeNormals(g.normals);
  return g;
}

// 2D outline presets for the extrude tool
export function shape2D(kind = 'star', { points = 5, inner = 0.45, radius = 0.5, teeth = 12, toothDepth = 0.12 } = {}) {
  const out = [];
  switch (kind) {
    case 'star': for (let k = 0; k < points * 2; k++) { const r = k % 2 ? radius * inner : radius, t = (k / (points * 2)) * TAU; out.push([Math.sin(t) * r, Math.cos(t) * r]); } break;
    case 'gear': {
      const n = Math.max(3, teeth | 0);
      for (let k = 0; k < n; k++) for (const [f, r] of [[0, 1 - toothDepth], [0.2, 1], [0.5, 1], [0.7, 1 - toothDepth]]) {
        const t = ((k + f) / n) * TAU; out.push([Math.sin(t) * r * radius, Math.cos(t) * r * radius]);
      }
      break;
    }
    case 'heart': for (let k = 0; k < 48; k++) { const t = (k / 48) * TAU; out.push([radius * 0.06 * 16 * Math.pow(Math.sin(t), 3), radius * 0.06 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]); } break;
    case 'polygon': for (let k = 0; k < points; k++) { const t = (k / points) * TAU; out.push([Math.sin(t) * radius, Math.cos(t) * radius]); } break;
    case 'arrow': out.push([0, radius], [radius * 0.7, 0], [radius * 0.25, 0], [radius * 0.25, -radius], [-radius * 0.25, -radius], [-radius * 0.25, 0], [-radius * 0.7, 0]); break;
    default: for (let k = 0; k < 48; k++) { const t = (k / 48) * TAU; out.push([Math.sin(t) * radius, Math.cos(t) * radius]); }
  }
  // ensure counter-clockwise
  let area = 0;
  for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) out.reverse();
  return out;
}

function earClip(poly) {
  const idx = poly.map((_, i) => i), tris = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let found = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      if (cross(a, b, c) <= 1e-12) continue;
      let ok = true;
      for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; if (inside(poly[j], a, b, c)) { ok = false; break; } }
      if (!ok) continue;
      tris.push([i0, i1, i2]); idx.splice(i, 1); found = true; break;
    }
    if (!found) break;
  }
  if (idx.length === 3) tris.push(idx.slice());
  return tris;
}

// Extrude a 2D outline along Z with an optional bevel ring.
export function extrude({ shape = 'star', points = 5, inner = 0.45, radius = 0.5, teeth = 12, toothDepth = 0.12, outline = null, depth = 0.2, bevel = 0.02 } = {}) {
  const poly = outline || shape2D(shape, { points, inner, radius, teeth, toothDepth });
  const b = new B();
  const d2 = depth / 2, bv = Math.min(bevel, d2 * 0.9);
  const tris = earClip(poly);
  // offset outline for bevel (shrink along vertex normals)
  const off = (s) => poly.map((p, i) => {
    const a = poly[(i + poly.length - 1) % poly.length], c = poly[(i + 1) % poly.length];
    const n1 = [a[1] - p[1], p[0] - a[0]], n2 = [p[1] - c[1], c[0] - p[0]];
    const l1 = Math.hypot(...n1) || 1, l2 = Math.hypot(...n2) || 1;
    const n = [n1[0] / l1 + n2[0] / l2, n1[1] / l1 + n2[1] / l2], ln = Math.hypot(...n) || 1;
    return [p[0] - (n[0] / ln) * s, p[1] - (n[1] / ln) * s];
  });
  const capPoly = bv > 0 ? off(-bv) : poly; // inset outline for the bevelled caps
  for (const [z, nz] of [[d2, 1], [-d2, -1]]) {
    const base = b.p.length / 3;
    capPoly.forEach((p) => b.v([p[0], p[1], z], [0, 0, nz], [p[0] + 0.5, p[1] + 0.5]));
    for (const [x, y, w] of tris) nz > 0 ? b.tri(base + x, base + y, base + w) : b.tri(base + x, base + w, base + y);
  }
  // side rings: cap edge (z=±d2, inset) -> bevel edge (z=±(d2-bv), full) ...
  const rings = bv > 0 ? [[capPoly, d2], [poly, d2 - bv], [poly, -d2 + bv], [capPoly, -d2]] : [[poly, d2], [poly, -d2]];
  const n = poly.length;
  for (let r = 0; r < rings.length - 1; r++) {
    const [pa, za] = rings[r], [pb, zb] = rings[r + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const e = [poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]], el = Math.hypot(...e) || 1;
      const fnrm = [e[1] / el, -e[0] / el, 0];
      const q0 = b.v([pa[i][0], pa[i][1], za], fnrm, [i / n, r / 3]), q1 = b.v([pa[j][0], pa[j][1], za], fnrm, [(i + 1) / n, r / 3]);
      const q2 = b.v([pb[j][0], pb[j][1], zb], fnrm, [(i + 1) / n, (r + 1) / 3]), q3 = b.v([pb[i][0], pb[i][1], zb], fnrm, [i / n, (r + 1) / 3]);
      b.quad(q0, q3, q2, q1);
    }
  }
  const g = b.build();
  if (bv > 0) g.computeNormals(g.normals);
  return g;
}

// Registry used by the editor (Add menu + property panels) and by model files.
// Each param: [default, min, max, step] or a typed descriptor.
export const SHAPES = {
  box: { label: 'Cube', icon: '▣', build: box, params: { width: [1, 0.001, 20, 0.01], height: [1, 0.001, 20, 0.01], depth: [1, 0.001, 20, 0.01], bevel: [0, 0, 5, 0.005], bevelSegments: [3, 1, 12, 1], segments: [1, 1, 64, 1] } },
  roundedBox: { label: 'Rounded Cube', icon: '▢', build: box, params: { width: [1, 0.001, 20, 0.01], height: [1, 0.001, 20, 0.01], depth: [1, 0.001, 20, 0.01], bevel: [0.15, 0, 5, 0.005], bevelSegments: [4, 1, 12, 1], segments: [4, 1, 64, 1] } },
  sphere: { label: 'UV Sphere', icon: '●', build: sphere, params: { radius: [0.5, 0.001, 20, 0.01], widthSegments: [32, 3, 128, 1], heightSegments: [16, 2, 64, 1], phiStart: [0, 0, 360, 1], phiLength: [360, 1, 360, 1], thetaStart: [0, 0, 180, 1], thetaLength: [180, 1, 180, 1] } },
  superquadric: { label: 'Superquadric', icon: '✦', build: superquadric, params: { rx: [0.5, 0.001, 20, 0.01], ry: [0.5, 0.001, 20, 0.01], rz: [0.5, 0.001, 20, 0.01], e1: [0.5, 0.05, 4, 0.01], e2: [0.5, 0.05, 4, 0.01], taperTop: [1, 0, 3, 0.01], taperBottom: [1, 0, 3, 0.01], widthSegments: [40, 3, 128, 1], heightSegments: [24, 2, 64, 1], phiStart: [0, 0, 360, 1], phiLength: [360, 1, 360, 1], thetaStart: [0, 0, 180, 1], thetaLength: [180, 1, 180, 1] } },
  cylinder: { label: 'Cylinder', icon: '▮', build: cylinder, params: { radiusTop: [0.5, 0, 20, 0.01], radiusBottom: [0.5, 0, 20, 0.01], height: [1, 0.001, 20, 0.01], radialSegments: [32, 3, 128, 1], heightSegments: [1, 1, 64, 1], capTop: [true], capBottom: [true], arc: [360, 1, 360, 1] } },
  cone: { label: 'Cone', icon: '▲', build: cone, params: { radius: [0.5, 0, 20, 0.01], height: [1, 0.001, 20, 0.01], radialSegments: [32, 3, 128, 1], heightSegments: [4, 1, 64, 1], capBottom: [true], arc: [360, 1, 360, 1] } },
  torus: { label: 'Torus', icon: '◎', build: torus, params: { radius: [0.5, 0.001, 20, 0.01], tube: [0.15, 0.001, 10, 0.005], tubeScaleY: [1, 0.05, 5, 0.01], radialSegments: [20, 3, 64, 1], tubularSegments: [48, 3, 256, 1], arc: [360, 1, 360, 1] } },
  capsule: { label: 'Capsule', icon: '⬭', build: capsule, params: { radius: [0.25, 0.001, 10, 0.005], length: [0.5, 0, 20, 0.01], radialSegments: [24, 3, 96, 1], capSegments: [8, 2, 32, 1] } },
  plane: { label: 'Plane', icon: '▭', build: plane, params: { width: [2, 0.001, 200, 0.01], depth: [2, 0.001, 200, 0.01], subdivisions: [1, 1, 256, 1] } },
  lathe: { label: 'Lathe (Revolve)', icon: '⚱', build: lathe, params: { points: { type: 'points2', default: [[0, 0], [0.35, 0], [0.45, 0.15], [0.25, 0.6], [0.3, 0.9], [0, 0.95]] }, segments: [40, 3, 128, 1], arc: [360, 1, 360, 1], smooth: [1, 0, 4, 1] } },
  tube: { label: 'Tube (Sweep)', icon: '〰', build: tube, params: { path: { type: 'points3', default: [[0, 0, 0], [0.3, 0.4, 0], [0, 0.8, 0.2], [-0.3, 1.2, 0]] }, radii: { type: 'numbers', default: [0.12, 0.06] }, radialSegments: [20, 3, 64, 1], samples: [10, 1, 40, 1], caps: [true], flatten: [1, 0.05, 4, 0.01], arc: [360, 10, 360, 1], arcOffset: [0, -360, 360, 1], twist: [0, -720, 720, 1] } },
  extrude: { label: 'Extrude (Outline)', icon: '★', build: extrude, params: { shape: { type: 'enum', options: ['star', 'gear', 'heart', 'polygon', 'arrow', 'circle'], default: 'star' }, points: [5, 3, 32, 1], inner: [0.45, 0.05, 1, 0.01], radius: [0.5, 0.001, 20, 0.01], teeth: [12, 3, 64, 1], toothDepth: [0.12, 0, 0.9, 0.01], depth: [0.2, 0.001, 20, 0.005], bevel: [0.02, 0, 1, 0.002] } },
};

export function shapeDefaults(type) {
  const s = SHAPES[type]; const o = {};
  for (const [k, d] of Object.entries(s.params)) o[k] = Array.isArray(d) ? d[0] : JSON.parse(JSON.stringify(d.default));
  return o;
}
