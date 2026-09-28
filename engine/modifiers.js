// Non-destructive modifier stack (Blender-style). Each modifier maps Geometry -> Geometry.
// Deformers move vertices; generators (mirror, array, solidify) add geometry.
import { Geometry, SHAPES } from './geometry.js';
import { vec3, mat4, quat, noise3 } from './math.js';

const AX = { x: 0, y: 1, z: 2 };

function axisRange(g, a) {
  const P = g.positions; let lo = Infinity, hi = -Infinity;
  for (let i = a; i < P.length; i += 3) { lo = Math.min(lo, P[i]); hi = Math.max(hi, P[i]); }
  return [lo, hi === lo ? lo + 1e-6 : hi];
}

function weldGroups(g) {
  const P = g.positions, n = P.length / 3, map = new Map(), grp = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.round(P[i * 3] * 1e4) + ',' + Math.round(P[i * 3 + 1] * 1e4) + ',' + Math.round(P[i * 3 + 2] * 1e4);
    if (!map.has(k)) map.set(k, i);
    grp[i] = map.get(k);
  }
  return grp;
}

export const MODIFIERS = {
  taper: {
    label: 'Taper', kind: 'deform',
    params: { axis: { type: 'enum', options: ['x', 'y', 'z'], default: 'y' }, amount: [0.5, -1, 1, 0.01], curve: [1, 0.1, 4, 0.05] },
    apply(g, { axis = 'y', amount = 0.5, curve = 1 }) {
      const a = AX[axis], [lo, hi] = axisRange(g, a), P = g.positions;
      for (let i = 0; i < P.length; i += 3) {
        const t = (P[i + a] - lo) / (hi - lo); // 0..1
        const s = 1 + amount * (Math.pow(t, curve) * 2 - 1);
        for (let k = 0; k < 3; k++) if (k !== a) P[i + k] *= s;
      }
      return g;
    },
  },
  twist: {
    label: 'Twist', kind: 'deform',
    params: { axis: { type: 'enum', options: ['x', 'y', 'z'], default: 'y' }, angle: [90, -1080, 1080, 1] },
    apply(g, { axis = 'y', angle = 90 }) {
      const a = AX[axis], u = (a + 1) % 3, w = (a + 2) % 3, [lo, hi] = axisRange(g, a), P = g.positions;
      for (let i = 0; i < P.length; i += 3) {
        const t = ((P[i + a] - lo) / (hi - lo) - 0.5) * angle * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
        const x = P[i + u], z = P[i + w];
        P[i + u] = x * c - z * s; P[i + w] = x * s + z * c;
      }
      return g;
    },
  },
  bend: {
    label: 'Bend', kind: 'deform',
    params: { axis: { type: 'enum', options: ['x', 'y', 'z'], default: 'y' }, toward: { type: 'enum', options: ['x', 'y', 'z'], default: 'z' }, angle: [45, -360, 360, 1] },
    apply(g, { axis = 'y', toward = 'z', angle = 45 }) {
      const a = AX[axis], d = AX[toward];
      if (a === d || !angle) return g;
      const [lo, hi] = axisRange(g, a), L = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
      const k = (angle * Math.PI / 180) / L, R = 1 / k, P = g.positions;
      for (let i = 0; i < P.length; i += 3) {
        const s = P[i + a], dd = P[i + d], th = s * k;
        P[i + a] = (R - dd) * Math.sin(th);
        P[i + d] = R - (R - dd) * Math.cos(th);
      }
      return g;
    },
  },
  displace: {
    label: 'Displace (Noise)', kind: 'deform',
    params: { amount: [0.03, -1, 1, 0.001], scale: [6, 0.1, 100, 0.1], seed: [1, 0, 999, 1], octaves: [2, 1, 5, 1] },
    apply(g, { amount = 0.03, scale = 6, seed = 1, octaves = 2 }) {
      const P = g.positions, N = g.normals;
      for (let i = 0; i < P.length; i += 3) {
        let n = 0, f = scale, amp = 1, tot = 0;
        for (let o = 0; o < octaves; o++) { n += noise3(P[i] * f, P[i + 1] * f, P[i + 2] * f, seed + o) * amp; tot += amp; f *= 2.03; amp *= 0.5; }
        n /= tot;
        for (let k = 0; k < 3; k++) P[i + k] += N[i + k] * n * amount;
      }
      return g;
    },
  },
  inflate: {
    label: 'Inflate', kind: 'deform',
    params: { amount: [0.02, -1, 1, 0.001] },
    apply(g, { amount = 0.02 }) { const P = g.positions, N = g.normals; for (let i = 0; i < P.length; i++) P[i] += N[i] * amount; return g; },
  },
  squash: {
    label: 'Flatten', kind: 'deform',
    params: { axis: { type: 'enum', options: ['x', 'y', 'z'], default: 'y' }, min: [-0.5, -20, 20, 0.005], max: [10, -20, 20, 0.005] },
    apply(g, { axis = 'y', min = -0.5, max = 10 }) {
      const a = AX[axis], P = g.positions;
      for (let i = a; i < P.length; i += 3) P[i] = Math.min(max, Math.max(min, P[i]));
      return g;
    },
  },
  profile: {
    label: 'Sculpt Profile', kind: 'deform',
    params: { axis: { type: 'enum', options: ['x', 'y', 'z'], default: 'y' }, values: { type: 'numbers', default: [1, 1.2, 0.9, 1] } },
    apply(g, { axis = 'y', values = [1, 1.2, 0.9, 1] }) {
      const a = AX[axis], [lo, hi] = axisRange(g, a), P = g.positions, V = values.length ? values : [1];
      for (let i = 0; i < P.length; i += 3) {
        const x = ((P[i + a] - lo) / (hi - lo)) * (V.length - 1);
        const j = Math.min(V.length - 2, Math.max(0, Math.floor(x))), f = x - j, sm = f * f * (3 - 2 * f);
        const s = V.length === 1 ? V[0] : V[j] + (V[j + 1] - V[j]) * sm;
        for (let k = 0; k < 3; k++) if (k !== a) P[i + k] *= s;
      }
      return g;
    },
  },
  wave: {
    label: 'Wave', kind: 'deform',
    params: { axis: { type: 'enum', options: ['x', 'y', 'z'], default: 'x' }, along: { type: 'enum', options: ['x', 'y', 'z'], default: 'y' }, amplitude: [0.05, -2, 2, 0.001], frequency: [4, 0, 100, 0.1], phase: [0, 0, 360, 1] },
    apply(g, { axis = 'x', along = 'y', amplitude = 0.05, frequency = 4, phase = 0 }) {
      const a = AX[axis], b = AX[along], P = g.positions;
      for (let i = 0; i < P.length; i += 3) P[i + a] += Math.sin(P[i + b] * frequency * Math.PI * 2 + phase * Math.PI / 180) * amplitude;
      return g;
    },
  },
  smooth: {
    label: 'Smooth', kind: 'deform',
    params: { iterations: [2, 1, 20, 1], factor: [0.5, 0, 1, 0.01] },
    apply(g, { iterations = 2, factor = 0.5 }) {
      const grp = weldGroups(g), P = g.positions, I = g.indices, n = P.length / 3;
      const nb = new Map();
      const link = (x, y) => { if (!nb.has(x)) nb.set(x, new Set()); nb.get(x).add(y); };
      for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const x = grp[I[t + e]], y = grp[I[t + (e + 1) % 3]]; link(x, y); link(y, x); }
      for (let it = 0; it < iterations; it++) {
        const np = new Map();
        for (const [v, set] of nb) {
          let x = 0, y = 0, z = 0;
          for (const u of set) { x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2]; }
          const c = set.size;
          np.set(v, [P[v * 3] + (x / c - P[v * 3]) * factor, P[v * 3 + 1] + (y / c - P[v * 3 + 1]) * factor, P[v * 3 + 2] + (z / c - P[v * 3 + 2]) * factor]);
        }
        for (let i = 0; i < n; i++) { const p = np.get(grp[i]); if (p) { P[i * 3] = p[0]; P[i * 3 + 1] = p[1]; P[i * 3 + 2] = p[2]; } }
      }
      return g;
    },
  },
  solidify: {
    label: 'Solidify', kind: 'generate',
    params: { thickness: [0.02, -1, 1, 0.001] },
    apply(g, { thickness = 0.02 }) {
      const n = g.vertexCount, P = g.positions, N = g.normals, I = g.indices;
      const inner = g.clone();
      for (let i = 0; i < P.length; i++) { inner.positions[i] = P[i] - N[i] * thickness; inner.normals[i] = -N[i]; }
      inner.flipWinding();
      const m = Geometry.merge([g, inner]);
      // rim along boundary edges
      const grp = weldGroups(g), count = new Map();
      for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
        const a = I[t + e], b = I[t + (e + 1) % 3], ga = grp[a], gb = grp[b];
        const k = ga < gb ? ga + '_' + gb : gb + '_' + ga;
        const c = count.get(k); count.set(k, c ? { n: c.n + 1 } : { n: 1, a, b });
      }
      const extra = [];
      for (const { n: c, a, b } of count.values()) if (c === 1) extra.push(a, b, b + n, a, b + n, a + n);
      if (extra.length) { const ni = new Uint32Array(m.indices.length + extra.length); ni.set(m.indices); ni.set(extra, m.indices.length); m.indices = ni; }
      return m;
    },
  },
  mirror: {
    label: 'Mirror', kind: 'generate',
    params: { axis: { type: 'enum', options: ['x', 'y', 'z'], default: 'x' }, offset: [0, -20, 20, 0.01] },
    apply(g, { axis = 'x', offset = 0 }) {
      const a = AX[axis], m = mat4.create(); m[a * 5] = -1; m[12 + a] = offset * 2;
      return Geometry.merge([g, g.clone().applyMatrix(m)]);
    },
  },
  array: {
    label: 'Array', kind: 'generate',
    params: { count: [3, 1, 200, 1], offsetX: [1.1, -50, 50, 0.01], offsetY: [0, -50, 50, 0.01], offsetZ: [0, -50, 50, 0.01], rotX: [0, -360, 360, 1], rotY: [0, -360, 360, 1], rotZ: [0, -360, 360, 1], scaleStep: [1, 0.1, 2, 0.01] },
    apply(g, { count = 3, offsetX = 1.1, offsetY = 0, offsetZ = 0, rotX = 0, rotY = 0, rotZ = 0, scaleStep = 1 }) {
      const out = [], step = mat4.create(), cur = mat4.create();
      mat4.fromRTS(step, quat.fromEuler(quat.create(), rotX, rotY, rotZ), [offsetX, offsetY, offsetZ], [scaleStep, scaleStep, scaleStep]);
      for (let k = 0; k < Math.max(1, count | 0); k++) { out.push(g.clone().applyMatrix(cur)); mat4.multiply(cur, cur, step); }
      return Geometry.merge(out);
    },
  },
};

export function modifierDefaults(type) {
  const o = { type, enabled: true };
  for (const [k, d] of Object.entries(MODIFIERS[type].params)) o[k] = Array.isArray(d) ? d[0] : JSON.parse(JSON.stringify(d.default));
  return o;
}

// Build final geometry from a shape spec {type, ...params} and a modifier stack.
export function buildShape(shape, modifiers = []) {
  const def = SHAPES[shape.type];
  if (!def) throw new Error('Unknown shape ' + shape.type);
  let g = def.build({ ...shape });
  let deformed = false;
  for (const m of modifiers) {
    if (!m || m.enabled === false || !MODIFIERS[m.type]) continue;
    g = MODIFIERS[m.type].apply(g, m);
    deformed = true;
  }
  if (deformed) g.computeNormals(g.normals);
  return g;
}
