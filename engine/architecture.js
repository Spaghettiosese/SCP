// Architecture kit: parametric buildings, structures and props for level building.
// Everything is assembled with a Kit that collects transformed shapes per material and
// merges them, so a whole building renders in one draw call per material.
// Conventions: a building's origin is the middle of its front wall at ground level, and
// its front faces +Z. Sizes are in metres.
import { Node, Mesh, Material, Light, InstancedMesh } from './scene.js';
import { Geometry, box, cylinder, cone, sphere, torus, tube, extrude, capsule, lathe } from './geometry.js';
import { buildShape } from './modifiers.js';
import { mat4, quat, vec3, rng } from './math.js';

// ------------------------------------------------------------------ materials
export function archPalette(o = {}) {
  const M = (k, def) => new Material({ name: k, ...def, ...(o[k] || {}) });
  return {
    siding: M('siding', { color: '#a27b52', roughness: 0.85, pattern: 'planks', patternScale: 5.5, patternColor: '#3a2616' }),
    paint: M('paint', { color: '#7f8f98', roughness: 0.8, pattern: 'planks', patternScale: 5.5, patternColor: '#2c3338', patternStrength: 0.8 }),
    paintRed: M('paintRed', { color: '#8e3b2e', roughness: 0.8, pattern: 'planks', patternScale: 5.5, patternColor: '#3a1712' }),
    paintCream: M('paintCream', { color: '#d9ccae', roughness: 0.8, pattern: 'planks', patternScale: 5.5, patternColor: '#6a5c44' }),
    trim: M('trim', { color: '#e8dfca', roughness: 0.7, pattern: 'wood', patternScale: 4, patternColor: '#b9ab8f', patternStrength: 0.4 }),
    darkWood: M('darkWood', { color: '#553a26', roughness: 0.75, pattern: 'planks', patternScale: 8, patternColor: '#24170d' }),
    deck: M('deck', { color: '#8c6a47', roughness: 0.85, pattern: 'planks', patternScale: 7, patternColor: '#2f1e10' }),
    shingles: M('shingles', { color: '#5e4c3f', roughness: 0.9, pattern: 'shingles', patternScale: 6 }),
    tin: M('tin', { color: '#8e9197', roughness: 0.45, metallic: 0.6, pattern: 'corrugated', patternScale: 12, patternColor: '#8a4a22' }),
    brick: M('brick', { color: '#9b5238', roughness: 0.85, pattern: 'brick', patternScale: 13, patternColor: '#cdbfa6' }),
    stucco: M('stucco', { color: '#d4b38b', roughness: 0.95, pattern: 'stucco', patternScale: 1.2, patternColor: '#9c7652' }),
    stone: M('stone', { color: '#8f867a', roughness: 0.9, pattern: 'stucco', patternScale: 3, patternColor: '#5f574c' }),
    glass: M('glass', { color: '#1d242a', roughness: 0.08, metallic: 0.3, pattern: 'glass', patternScale: 3, patternColor: '#e3d8c2', emissive: '#ffae52', emissiveStrength: 0 }),
    door: M('door', { color: '#5c3b24', roughness: 0.7, pattern: 'planks', patternScale: 9, patternColor: '#2a190c' }),
    metal: M('metal', { color: '#3c3c3e', roughness: 0.5, metallic: 0.85, pattern: 'metal', patternScale: 2 }),
    sign: M('sign', { color: '#27352d', roughness: 0.8, pattern: 'planks', patternScale: 4, patternColor: '#121a15' }),
    lettering: M('lettering', { color: '#ead9ad', roughness: 0.5, emissive: '#ffcf7a', emissiveStrength: 0 }),
    lanternGlass: M('lanternGlass', { color: '#ffd9a0', roughness: 0.2, emissive: '#ffb04a', emissiveStrength: 0 }),
    rope: M('rope', { color: '#b69a64', roughness: 0.9, pattern: 'hair', patternScale: 6 }),
    canvas: M('canvas', { color: '#d8ccb0', roughness: 0.95, pattern: 'fabric', patternScale: 180, doubleSided: true }),
    water: M('water', { color: '#2e4a52', roughness: 0.05, metallic: 0.2 }),
  };
}

// Switch every emissive "night" material in a palette on or off (0..1)
export function setNightLights(palette, amount) {
  palette.glass.emissiveStrength = 2.6 * amount;
  palette.lanternGlass.emissiveStrength = 9 * amount;
  palette.lettering.emissiveStrength = 0.6 * amount;
}

// ------------------------------------------------------------------ Kit
export class Kit {
  constructor(palette) { this.p = palette; this.groups = new Map(); this.lights = []; this.colliders = []; this.dynamic = []; }
  add(mat, geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    const m = mat4.fromRTS(mat4.create(), quat.fromEuler(quat.create(), rot[0], rot[1], rot[2]), pos, scale);
    if (!this.groups.has(mat)) this.groups.set(mat, []);
    this.groups.get(mat).push(geo.applyMatrix(m));
    return this;
  }
  box(mat, center, size, rot = [0, 0, 0], bevel = 0) {
    const b = Math.min(bevel, ...size.map((s) => s * 0.45));
    return this.add(mat, box({ width: size[0], height: size[1], depth: size[2], bevel: b, bevelSegments: b > 0 ? 1 : 3 }), center, rot);
  }
  // axis-aligned box from min/max corners
  span(mat, min, max, bevel = 0) { return this.box(mat, min.map((v, k) => (v + max[k]) / 2), max.map((v, k) => Math.abs(v - min[k])), [0, 0, 0], bevel); }
  cyl(mat, center, radius, height, rot = [0, 0, 0], segs = 12, r2 = radius) { return this.add(mat, cylinder({ radiusTop: radius, radiusBottom: r2, height, radialSegments: segs, heightSegments: 1, capTop: true, capBottom: true, arc: 360 }), center, rot); }
  shape(mat, spec, mods, pos, rot, scale) { return this.add(mat, buildShape(spec, mods || []), pos, rot, scale); }
  light(pos, opts) { const l = new Light(opts.type || 'point', opts); l.position.set(pos); this.lights.push(l); return l; }
  toNode(name = 'Structure') {
    const n = new Node(name);
    for (const [mat, geos] of this.groups) { const m = new Mesh(Geometry.merge(geos), mat, name + ' · ' + mat.name); n.add(m); }
    for (const l of this.lights) n.add(l);
    for (const d of this.dynamic) n.add(d);
    n.userData.colliders = this.colliders;
    return n;
  }
}

// ------------------------------------------------------------------ 3D lettering (5x7 pixel font)
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'], H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'], J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'], R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'], X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'], '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'], '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'], ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
// Adds raised letters centred at `center`, facing +Z (rotated by rotY). Returns the text width.
export function lettering(kit, text, center, height = 0.3, rotY = 0, mat = kit.p.lettering) {
  const px = height / 7, gap = px, chars = text.toUpperCase().split('');
  const width = chars.length * 5 * px + (chars.length - 1) * gap;
  const q = quat.fromEuler(quat.create(), 0, rotY, 0);
  chars.forEach((ch, i) => {
    const g = FONT[ch] || FONT[' '];
    const x0 = -width / 2 + i * (5 * px + gap);
    g.forEach((row, r) => [...row].forEach((bit, c) => {
      if (bit !== '1') return;
      const local = [x0 + (c + 0.5) * px, height / 2 - (r + 0.5) * px, 0];
      const w = vec3.transformQuat([0, 0, 0], local, q);
      kit.box(mat, [center[0] + w[0], center[1] + w[1], center[2] + w[2]], [px * 1.02, px * 1.02, px * 0.8], [0, rotY, 0]);
    }));
  });
  return width;
}

// ------------------------------------------------------------------ walls with openings
// A wall running along local X from x0 to x1 at depth z (thickness t), y from y0 to y1.
// openings: [{ x, y, w, h, kind: 'window'|'door'|'batwing'|'arch' }] with x the opening centre.
export function wall(kit, { x0, x1, y0, y1, z, t = 0.14, mat, openings = [], trim = kit.p.trim, rotY = 0, origin = [0, 0, 0], frame = true }) {
  const q = quat.fromEuler(quat.create(), 0, rotY, 0);
  const put = (m, min, max, bevel = 0) => {
    const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], s = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    if (s[0] <= 0.001 || s[1] <= 0.001) return;
    const w = vec3.transformQuat([0, 0, 0], c, q);
    kit.box(m, [origin[0] + w[0], origin[1] + w[1], origin[2] + w[2]], s, [0, rotY, 0], bevel);
  };
  const ops = openings.filter((o) => o.x - o.w / 2 > x0 && o.x + o.w / 2 < x1).sort((a, b) => a.x - b.x);
  let cx = x0;
  for (const o of ops) {
    const l = o.x - o.w / 2, r = o.x + o.w / 2, b = y0 + o.y, top = b + o.h;
    put(mat, [cx, y0, z - t / 2], [l, y1, z + t / 2]);           // solid strip before the opening
    put(mat, [l, y0, z - t / 2], [r, b, z + t / 2]);             // below (sill wall)
    put(mat, [l, top, z - t / 2], [r, y1, z + t / 2]);           // above (header)
    cx = r;
    const zf = z + t / 2 + 0.02, f = 0.07;
    if (frame) {
      put(trim, [l - f, top, zf - 0.03], [r + f, top + f * 1.3, zf + 0.03]);          // header trim
      put(trim, [l - f, b - (o.kind === 'window' ? f : 0), zf - 0.03], [l, top, zf + 0.03]);
      put(trim, [r, b - (o.kind === 'window' ? f : 0), zf - 0.03], [r + f, top, zf + 0.03]);
      if (o.kind === 'window') put(trim, [l - f * 1.4, b - f, zf - 0.02], [r + f * 1.4, b, zf + 0.07]); // sill
    }
    if (o.kind === 'window') {
      put(kit.p.glass, [l, b, z - 0.01], [r, top, z + 0.01]);
      put(trim, [l, b + o.h / 2 - 0.02, z], [r, b + o.h / 2 + 0.02, z + 0.035]); // meeting rail
      if (o.shutters) {
        put(kit.p.paintRed, [l - o.w / 2 - 0.1, b, zf], [l - 0.1, top, zf + 0.04]);
        put(kit.p.paintRed, [r + 0.1, b, zf], [r + o.w / 2 + 0.1, top, zf + 0.04]);
      }
    } else if (o.kind === 'door') {
      put(kit.p.door, [l, b, z - 0.03], [r, top, z + 0.01]);
      put(kit.p.metal, [r - 0.14, b + 1.0, z], [r - 0.1, b + 1.08, z + 0.05]); // handle
    } else if (o.kind === 'batwing') {
      // saloon doors: two short swinging leaves, dark room behind
      put(kit.p.door, [l, b, z - t / 2 - 0.4], [r, top, z - t / 2 - 0.38]);
      put(kit.p.paintCream, [l + 0.02, b + 0.45, z + 0.02], [o.x - 0.02, b + 1.55, z + 0.05]);
      put(kit.p.paintCream, [o.x + 0.02, b + 0.45, z + 0.02], [r - 0.02, b + 1.55, z + 0.05]);
    }
  }
  put(mat, [cx, y0, z - t / 2], [x1, y1, z + t / 2]);
}

// ------------------------------------------------------------------ roofs
function gableRoof(kit, { w, d, y, pitch = 0.45, overhang = 0.35, mat, trim, front = true }) {
  const half = w / 2 + overhang, rise = (w / 2) * pitch, len = Math.hypot(half, rise * (half / (w / 2)));
  const ang = Math.atan2(rise, w / 2) * 180 / Math.PI;
  const zc = -d / 2, depth = d + overhang * 2;
  for (const s of [1, -1]) kit.box(mat, [s * half / 2, y + rise / 2, zc], [len, 0.08, depth], [0, 0, -s * ang]);
  kit.box(trim, [0, y + rise + 0.03, zc], [0.18, 0.1, depth + 0.02]); // ridge cap
  // gable ends
  for (const zz of [0, -d]) kit.add(trim === mat ? mat : kit.p.paintCream, extrude({ outline: [[-w / 2, 0], [w / 2, 0], [0, rise]], depth: 0.12, bevel: 0 }), [0, y, zz + (zz === 0 ? -0.06 : 0.06)]);
  return rise;
}
function hipRoof(kit, { w, d, y, pitch = 0.5, overhang = 0.35, mat }) {
  // four sloped faces meeting at a ridge along the longer side (a pyramid when square)
  const W = w + overhang * 2, D = d + overhang * 2, h = (Math.min(W, D) / 2) * pitch * 2;
  const rx = Math.max(0, (W - D) / 2), rz = Math.max(0, (D - W) / 2);
  const A = [-W / 2, 0, D / 2], B = [W / 2, 0, D / 2], C = [W / 2, 0, -D / 2], Q = [-W / 2, 0, -D / 2];
  const faces = [
    [A, B, [rx, h, rz], [-rx, h, rz]], [B, C, [rx, h, -rz], [rx, h, rz]],
    [C, Q, [-rx, h, -rz], [rx, h, -rz]], [Q, A, [-rx, h, rz], [-rx, h, -rz]], [A, Q, C, B],
  ];
  const positions = [], normals = [], uvs = [], indices = [];
  for (const f of faces) {
    const o = positions.length / 3;
    const n = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], vec3.sub([0, 0, 0], f[1], f[0]), vec3.sub([0, 0, 0], f[2], f[0])));
    for (const v of f) { positions.push(...v); normals.push(...n); uvs.push(v[0], v[2]); }
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  kit.add(mat, new Geometry({ positions, normals, uvs, indices }), [0, y, -d / 2]);
  return h;
}
function falseFront(kit, { w, y, extra = 1.6, mat, trim, style = 'stepped' }) {
  // the classic western facade that hides a small gabled roof behind it
  const top = y + extra;
  let outline;
  if (style === 'stepped') outline = [[-w / 2, 0], [w / 2, 0], [w / 2, extra * 0.55], [w / 2 - w * 0.12, extra * 0.55], [w / 2 - w * 0.12, extra * 0.8], [w * 0.14, extra * 0.8], [w * 0.14, extra], [-w * 0.14, extra], [-w * 0.14, extra * 0.8], [-w / 2 + w * 0.12, extra * 0.8], [-w / 2 + w * 0.12, extra * 0.55], [-w / 2, extra * 0.55]];
  else if (style === 'curved') { outline = [[-w / 2, 0], [w / 2, 0], [w / 2, extra * 0.5]]; for (let i = 0; i <= 16; i++) { const t = i / 16, x = w / 2 - t * w; outline.push([x, extra * 0.5 + extra * 0.5 * Math.sin(Math.PI * t) ** 0.7]); } outline.push([-w / 2, extra * 0.5]); }
  else outline = [[-w / 2, 0], [w / 2, 0], [w / 2, extra], [-w / 2, extra]];
  kit.add(mat, extrude({ outline, depth: 0.16, bevel: 0 }), [0, y, 0]);
  kit.box(trim, [0, top + 0.05, 0.04], [w * 0.3, 0.1, 0.26]);
  kit.box(trim, [0, y + 0.06, 0.12], [w + 0.1, 0.12, 0.12]); // cornice
  return top;
}

// ------------------------------------------------------------------ buildings
export const BUILDING_DEFAULTS = {
  width: 8, depth: 10, floors: 2, floorHeight: 3.2, siding: 'siding', roof: 'falseFront', facade: 'stepped',
  porch: true, porchDepth: 2.4, balcony: true, windows: 3, door: 'door', sign: '', shutters: false, chimney: false, lanterns: true, seed: 1,
};

export function building(kit0, o = {}) {
  const p = { ...BUILDING_DEFAULTS, ...o };
  const kit = kit0 || new Kit(archPalette());
  const P = kit.p, r = rng(p.seed);
  const W = p.width, D = p.depth, H = p.floorHeight, F = p.floors, top = F * H;
  const wallMat = P[p.siding] || P.siding;
  // foundation
  kit.span(P.stone, [-W / 2 - 0.08, 0, -D - 0.08], [W / 2 + 0.08, 0.35, 0.08]);
  for (let f = 0; f < F; f++) {
    const y0 = 0.35 + f * H, y1 = y0 + H;
    const openings = [];
    const n = p.windows;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (W / (n + 1)) * (i + 1);
      openings.push({ x, y: 0.9, w: 0.95, h: 1.45, kind: 'window', shutters: p.shutters });
    }
    if (f === 0 && p.door !== 'none') {
      const mid = openings.reduce((b, op, i) => (Math.abs(op.x) < Math.abs(openings[b].x) ? i : b), 0);
      openings[mid] = { x: openings[mid].x, y: 0, w: p.door === 'batwing' ? 1.5 : 1.1, h: 2.3, kind: p.door };
    }
    wall(kit, { x0: -W / 2, x1: W / 2, y0, y1, z: 0, mat: wallMat, openings });
    // back wall with a door downstairs
    wall(kit, { x0: -W / 2, x1: W / 2, y0, y1, z: -D, mat: wallMat, openings: f === 0 ? [{ x: W * 0.25, y: 0, w: 1, h: 2.2, kind: 'door' }] : [{ x: 0, y: 0.9, w: 0.9, h: 1.3, kind: 'window' }] });
    // side walls (rotated), windows spaced along depth
    const sideOps = [];
    const ns = Math.max(1, Math.floor(D / 3.5));
    for (let i = 0; i < ns; i++) sideOps.push({ x: -D / 2 + (D / (ns + 1)) * (i + 1), y: 0.9, w: 0.9, h: 1.35, kind: 'window', shutters: p.shutters });
    for (const s of [1, -1]) wall(kit, { x0: -D / 2 + 0.07, x1: D / 2 - 0.07, y0, y1, z: 0, mat: wallMat, openings: sideOps, rotY: s * 90, origin: [s * W / 2, 0, -D / 2] });
    // floor band + interior floor
    kit.span(P.trim, [-W / 2 - 0.05, y1 - 0.08, -D - 0.05], [W / 2 + 0.05, y1, 0.09]);
    if (f > 0) kit.span(P.deck, [-W / 2 + 0.1, y0 - 0.1, -D + 0.1], [W / 2 - 0.1, y0, -0.1]);
  }
  kit.span(P.deck, [-W / 2 + 0.1, 0.3, -D + 0.1], [W / 2 - 0.1, 0.36, -0.1]);
  // corner boards
  for (const x of [-W / 2, W / 2]) for (const z of [0, -D]) kit.span(P.trim, [x - 0.09, 0.35, z - 0.09], [x + 0.09, 0.35 + top, z + 0.09]);
  // roof
  const roofY = 0.35 + top;
  let peak = roofY;
  if (p.roof === 'gable') peak += gableRoof(kit, { w: W, d: D, y: roofY, mat: P.shingles, trim: wallMat });
  else if (p.roof === 'hip') peak += hipRoof(kit, { w: W, d: D, y: roofY, mat: P.shingles });
  else {
    kit.span(P.tin, [-W / 2 - 0.1, roofY, -D - 0.1], [W / 2 + 0.1, roofY + 0.12, 0.1]);
    kit.span(wallMat, [-W / 2, roofY, -D], [-W / 2 + 0.15, roofY + 0.5, 0]); // parapets
    kit.span(wallMat, [W / 2 - 0.15, roofY, -D], [W / 2, roofY + 0.5, 0]);
    kit.span(wallMat, [-W / 2, roofY, -D], [W / 2, roofY + 0.5, -D + 0.15]);
    if (p.roof === 'falseFront') peak = falseFront(kit, { w: W + 0.2, y: roofY, mat: wallMat, trim: P.trim, style: p.facade });
    else kit.span(wallMat, [-W / 2, roofY, -0.15], [W / 2, roofY + 0.5, 0]);
  }
  if (p.chimney) kit.span(P.brick, [W * 0.22, roofY - 0.5, -D * 0.7], [W * 0.22 + 0.6, peak + 0.6, -D * 0.7 + 0.6]);
  // porch with posts, tin awning and lanterns
  if (p.porch) {
    const pd = p.porchDepth;
    kit.span(P.deck, [-W / 2 - 0.1, 0.25, 0], [W / 2 + 0.1, 0.42, pd]);
    kit.span(P.deck, [-W / 2 - 0.1, 0.0, pd - 0.02], [W / 2 + 0.1, 0.26, pd + 0.3]); // step
    const posts = Math.max(2, Math.round(W / 2.6) + 1);
    for (let i = 0; i < posts; i++) { const x = -W / 2 + (W / (posts - 1)) * i; kit.box(P.darkWood, [x, 0.42 + 1.45, pd - 0.1], [0.14, 2.9, 0.14], [0, 0, 0], 0.02); }
    const aw = 0.42 + 2.95;
    kit.box(P.tin, [0, aw + 0.25, pd / 2], [W + 0.5, 0.06, pd + 0.4], [-9, 0, 0]);
    kit.span(P.darkWood, [-W / 2 - 0.05, aw - 0.12, pd - 0.18], [W / 2 + 0.05, aw + 0.02, pd - 0.02]);
    // hitching rail in front of the porch
    kit.box(P.darkWood, [0, 0.95, pd + 1.3], [Math.min(W - 1, 4), 0.1, 0.1]);
    for (const s of [-1, 1]) kit.box(P.darkWood, [s * Math.min(W - 1, 4) / 2, 0.5, pd + 1.3], [0.12, 1.0, 0.12]);
    if (p.lanterns) for (const s of [-1, 1]) lantern(kit, [s * (W / 2 - 0.35), aw - 0.35, pd - 0.35]);
  }
  // balcony on the second floor
  if (p.balcony && F > 1) {
    const by = 0.35 + H, bd = Math.min(p.porchDepth, 1.6);
    kit.span(P.deck, [-W / 2, by, 0], [W / 2, by + 0.12, bd]);
    for (let x = -W / 2 + 0.1; x <= W / 2; x += 0.22) kit.box(P.trim, [x, by + 0.55, bd - 0.05], [0.05, 0.85, 0.05]);
    kit.span(P.trim, [-W / 2, by + 0.95, bd - 0.1], [W / 2, by + 1.02, bd]);
  }
  // sign board with raised letters across the facade or porch
  if (p.sign) {
    const sy = p.roof === 'falseFront' ? roofY + 0.75 : 0.35 + H - 0.55 + (p.porch ? 0.4 : 0);
    const sz = p.roof === 'falseFront' ? 0.12 : p.porch ? p.porchDepth + 0.05 : 0.12;
    const sw = Math.min(W - 0.6, p.sign.length * 0.55 + 0.6);
    kit.box(P.sign, [0, sy, sz], [sw, 0.7, 0.08], [0, 0, 0], 0.02);
    kit.box(P.trim, [0, sy, sz - 0.01], [sw + 0.12, 0.82, 0.06]);
    lettering(kit, p.sign, [0, sy, sz + 0.06], Math.min(0.42, (sw - 0.4) / (p.sign.length * 1.2)));
  }
  // an interior lamp so windows glow at night
  kit.light([0, 0.35 + 1.8, -D / 2], { color: '#ffb266', intensity: 0, range: Math.max(W, D) * 0.9, flicker: 0.15 }).userData.interior = true;
  kit.colliders.push({ min: [-W / 2 - 0.1, -D - 0.1], max: [W / 2 + 0.1, 0.1] });
  return kit;
}

// ------------------------------------------------------------------ structures and props
export function lantern(kit, pos, { hang = true } = {}) {
  const P = kit.p;
  kit.box(P.metal, [pos[0], pos[1] + 0.2, pos[2]], [0.16, 0.03, 0.16]);
  kit.box(P.lanternGlass, pos, [0.12, 0.2, 0.12], [0, 45, 0]);
  kit.box(P.metal, [pos[0], pos[1] - 0.12, pos[2]], [0.15, 0.03, 0.15]);
  if (hang) kit.box(P.metal, [pos[0], pos[1] + 0.33, pos[2]], [0.015, 0.25, 0.015]);
  kit.light([pos[0], pos[1] - 0.05, pos[2]], { color: '#ffb35c', intensity: 0, range: 10, flicker: 0.5 }).userData.lamp = true;
}

export function lampPost(kit, pos, height = 3.2) {
  const P = kit.p;
  kit.cyl(P.metal, [pos[0], height / 2, pos[2]], 0.05, height, [0, 0, 0], 10, 0.08);
  kit.box(P.metal, [pos[0] + 0.3, height - 0.05, pos[2]], [0.7, 0.05, 0.05]);
  lantern(kit, [pos[0] + 0.55, height - 0.45, pos[2]]);
}

export function crate(kit, pos, s = 0.7, rotY = 0) {
  const P = kit.p;
  kit.box(P.deck, [pos[0], pos[1] + s / 2, pos[2]], [s, s, s], [0, rotY, 0], 0.02);
  const q = quat.fromEuler(quat.create(), 0, rotY, 0);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const off = vec3.transformQuat([0, 0, 0], [dx * (s / 2 + 0.005), 0, dz * (s / 2 + 0.005)], q);
    kit.box(P.darkWood, [pos[0] + off[0], pos[1] + s / 2, pos[2] + off[2]], dx ? [0.02, s * 0.95, s * 0.14] : [s * 0.14, s * 0.95, 0.02], [0, rotY + (dx ? 0 : 0), 45 * (dx || dz)]);
  }
}

export function barrel(kit, pos, s = 1) {
  const P = kit.p;
  kit.add(P.deck, lathe({ points: [[0, 0], [0.26, 0], [0.3, 0.2], [0.315, 0.42], [0.3, 0.64], [0.26, 0.84], [0, 0.84]], segments: 20, arc: 360, smooth: 1 }), pos, [0, 0, 0], [s, s, s]);
  for (const y of [0.12, 0.72]) kit.add(P.metal, torus({ radius: 0.285, tube: 0.012, radialSegments: 5, tubularSegments: 24, arc: 360, tubeScaleY: 2.5 }), [pos[0], pos[1] + y * s, pos[2]], [0, 0, 0], [s, s, s]);
}

export function stairs(kit, { from = [0, 0, 0], steps = 8, rise = 0.18, run = 0.28, width = 1.2, rotY = 0, rails = true, mat } = {}) {
  const P = kit.p, m = mat || P.deck, q = quat.fromEuler(quat.create(), 0, rotY, 0);
  const at = (x, y, z) => { const w = vec3.transformQuat([0, 0, 0], [x, y, z], q); return [from[0] + w[0], from[1] + w[1], from[2] + w[2]]; };
  for (let i = 0; i < steps; i++) kit.box(m, at(0, rise * (i + 0.5), -run * (i + 0.5)), [width, rise, run + 0.02], [0, rotY, 0]);
  if (rails) for (const s of [-1, 1]) {
    for (let i = 0; i <= steps; i += 2) kit.box(P.darkWood, at(s * width / 2, rise * i + 0.5, -run * i), [0.06, 1.0, 0.06], [0, rotY, 0]);
    const len = Math.hypot(rise * steps, run * steps), ang = Math.atan2(rise * steps, run * steps) * 180 / Math.PI;
    kit.box(P.darkWood, at(s * width / 2, rise * steps / 2 + 1.0, -run * steps / 2), [0.07, 0.07, len], [ang, rotY, 0]);
  }
}

export function bridge(kit, { from = [0, 0, 0], length = 10, width = 2.4, sag = 0.4, rotY = 0 } = {}) {
  // plank footbridge with rope handrails that sag between posts
  const P = kit.p, q = quat.fromEuler(quat.create(), 0, rotY, 0);
  const at = (x, y, z) => { const w = vec3.transformQuat([0, 0, 0], [x, y, z], q); return [from[0] + w[0], from[1] + w[1], from[2] + w[2]]; };
  const planks = Math.floor(length / 0.26);
  for (let i = 0; i < planks; i++) { const t = i / (planks - 1), y = -sag * Math.sin(Math.PI * t); kit.box(P.deck, at(0, y, -t * length), [width, 0.06, 0.22], [0, rotY + (i % 3 - 1) * 1.5, 0]); }
  for (const s of [-1, 1]) {
    for (const t of [0, 1]) kit.box(P.darkWood, at(s * (width / 2 + 0.1), 0.6, -t * length), [0.16, 1.6, 0.16], [0, rotY, 0], 0.02);
    const path = []; for (let i = 0; i <= 12; i++) { const t = i / 12; path.push(at(s * (width / 2 + 0.1), 1.3 - (sag + 0.25) * Math.sin(Math.PI * t), -t * length)); }
    kit.add(P.rope, tube({ path, radii: [0.025], radialSegments: 6, samples: 3, caps: true, flatten: 1, arc: 360, arcOffset: 0, twist: 0 }));
  }
}

export function waterTower(kit, pos) {
  const P = kit.p, h = 6;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) kit.box(P.darkWood, [pos[0] + dx * 1.3, h / 2, pos[2] + dz * 1.3], [0.22, h, 0.22], [dz * 3, 0, -dx * 3]);
  for (const y of [1.6, 3.6]) for (const [a, b] of [[[-1.3, -1.3], [1.3, -1.3]], [[1.3, -1.3], [1.3, 1.3]], [[1.3, 1.3], [-1.3, 1.3]], [[-1.3, 1.3], [-1.3, -1.3]]]) {
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    kit.box(P.darkWood, [pos[0] + c[0], y, pos[2] + c[1]], [len, 0.12, 0.08], [0, -ang, 0]);
    kit.box(P.darkWood, [pos[0] + c[0], y + 1, pos[2] + c[1]], [len * 1.2, 0.08, 0.06], [0, -ang, 28]);
  }
  kit.span(P.deck, [pos[0] - 1.7, h, pos[2] - 1.7], [pos[0] + 1.7, h + 0.15, pos[2] + 1.7]);
  kit.cyl(P.siding, [pos[0], h + 1.5, pos[2]], 1.5, 2.8, [0, 0, 0], 24);
  for (const y of [0.4, 1.4, 2.4]) kit.add(P.metal, torus({ radius: 1.52, tube: 0.025, radialSegments: 5, tubularSegments: 32, arc: 360, tubeScaleY: 1.5 }), [pos[0], h + y + 0.1, pos[2]]);
  kit.add(P.shingles, cone({ radius: 1.7, height: 1.1, radialSegments: 24, heightSegments: 1, capBottom: true, arc: 360 }), [pos[0], h + 3.45, pos[2]]);
  kit.colliders.push({ min: [pos[0] - 1.5, pos[2] - 1.5], max: [pos[0] + 1.5, pos[2] + 1.5] });
}

// Windmill: tower + a rotor node you can spin (node.userData.rotor)
export function windmill(kit, pos) {
  const P = kit.p, h = 8;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) kit.box(P.metal, [pos[0] + dx * 0.55, h / 2, pos[2] + dz * 0.55], [0.08, h + 0.2, 0.08], [dz * 4, 0, -dx * 4]);
  for (let y = 1; y < h; y += 1.6) kit.span(P.metal, [pos[0] - 0.9 + y * 0.05, y, pos[2] - 0.03], [pos[0] + 0.9 - y * 0.05, y + 0.05, pos[2] + 0.03]);
  kit.span(P.metal, [pos[0] - 0.2, h, pos[2] - 0.5], [pos[0] + 0.2, h + 0.3, pos[2] + 0.5]);
  const rk = new Kit(P);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 360;
    const q = quat.fromEuler(quat.create(), 0, 0, a), c = vec3.transformQuat([0, 0, 0], [0, 1.0, 0], q);
    rk.box(P.tin, c, [0.28, 1.3, 0.02], [18, 0, a]);
  }
  rk.add(P.metal, torus({ radius: 1.2, tube: 0.03, radialSegments: 5, tubularSegments: 32, arc: 360, tubeScaleY: 1 }), [0, 0, 0], [90, 0, 0]);
  rk.cyl(P.metal, [0, 0, 0], 0.16, 0.3, [90, 0, 0], 12);
  const rotor = rk.toNode('Windmill Rotor');
  rotor.position.set([pos[0], h + 0.15, pos[2] + 0.55]);
  rotor.userData.dynamic = true;
  kit.dynamic.push(rotor);
  // tail vane
  kit.box(P.tin, [pos[0], h + 0.2, pos[2] - 1.3], [0.03, 0.8, 1.2]);
  kit.colliders.push({ min: [pos[0] - 0.7, pos[2] - 0.7], max: [pos[0] + 0.7, pos[2] + 0.7] });
  return rotor;
}

export function wagon(kit, pos, rotY = 0) {
  const P = kit.p, q = quat.fromEuler(quat.create(), 0, rotY, 0);
  const at = (x, y, z) => { const w = vec3.transformQuat([0, 0, 0], [x, y, z], q); return [pos[0] + w[0], pos[1] + w[1], pos[2] + w[2]]; };
  kit.box(P.deck, at(0, 0.95, 0), [1.4, 0.12, 3.2], [0, rotY, 0]);
  for (const s of [-1, 1]) kit.box(P.deck, at(s * 0.68, 1.25, 0), [0.06, 0.5, 3.2], [0, rotY, 0]);
  for (const s of [-1, 1]) kit.box(P.deck, at(0, 1.25, s * 1.57), [1.4, 0.5, 0.06], [0, rotY, 0]);
  for (const [x, z, r] of [[-0.8, 1.0, 0.45], [0.8, 1.0, 0.45], [-0.8, -1.0, 0.55], [0.8, -1.0, 0.55]]) {
    kit.add(P.darkWood, torus({ radius: r, tube: 0.05, radialSegments: 6, tubularSegments: 24, arc: 360, tubeScaleY: 1 }), at(x, r, z), [0, rotY + 90, 90]);
    for (let k = 0; k < 6; k++) kit.box(P.darkWood, at(x, r, z), [0.04, r * 2, 0.04], [0, rotY + 90, k * 30]);
  }
  // canvas cover hoops (the prairie schooner)
  const cover = [];
  for (let i = 0; i < 5; i++) cover.push(i);
  kit.add(P.canvas, cylinder({ radiusTop: 0.85, radiusBottom: 0.85, height: 2.8, radialSegments: 16, heightSegments: 4, capTop: false, capBottom: false, arc: 180 }), at(0, 1.45, 0), [90, rotY, 90 * 0], [1, 1, 1]);
  kit.colliders.push(rotY % 180 === 0 ? { min: [pos[0] - 0.8, pos[2] - 1.7], max: [pos[0] + 0.8, pos[2] + 1.7] } : { min: [pos[0] - 1.7, pos[2] - 0.8], max: [pos[0] + 1.7, pos[2] + 0.8] });
}

export function well(kit, pos) {
  const P = kit.p;
  kit.add(P.stone, cylinder({ radiusTop: 0.8, radiusBottom: 0.85, height: 0.8, radialSegments: 20, heightSegments: 1, capTop: false, capBottom: true, arc: 360 }), [pos[0], 0.4, pos[2]]);
  kit.add(P.water, cylinder({ radiusTop: 0.7, radiusBottom: 0.7, height: 0.02, radialSegments: 20, heightSegments: 1, capTop: true, capBottom: false, arc: 360 }), [pos[0], 0.5, pos[2]]);
  for (const s of [-1, 1]) kit.box(P.darkWood, [pos[0] + s * 0.75, 1.3, pos[2]], [0.12, 1.8, 0.12]);
  kit.cyl(P.darkWood, [pos[0], 2.0, pos[2]], 0.06, 1.6, [0, 0, 90]);
  kit.add(P.shingles, cylinder({ radiusTop: 0.001, radiusBottom: 1.1, height: 0.7, radialSegments: 4, heightSegments: 1, capTop: false, capBottom: true, arc: 360 }), [pos[0], 2.5, pos[2]], [0, 45, 0], [1, 1, 0.8]);
  kit.add(P.rope, cylinder({ radiusTop: 0.012, radiusBottom: 0.012, height: 1.2, radialSegments: 5, heightSegments: 1, capTop: true, capBottom: true, arc: 360 }), [pos[0], 1.4, pos[2]]);
  kit.colliders.push({ min: [pos[0] - 0.9, pos[2] - 0.9], max: [pos[0] + 0.9, pos[2] + 0.9] });
}

// Telegraph poles with sagging wires between them (catenary approximated by a parabola)
export function telegraphLine(kit, points, height = 5.5) {
  const P = kit.p;
  points.forEach((p) => { kit.cyl(P.darkWood, [p[0], height / 2, p[1]], 0.1, height, [0, 0, 0], 8, 0.13); kit.box(P.darkWood, [p[0], height - 0.4, p[1]], [1.2, 0.1, 0.1]); });
  for (let i = 0; i < points.length - 1; i++) for (const off of [-0.45, 0.45]) {
    const a = points[i], b = points[i + 1], path = [];
    for (let k = 0; k <= 10; k++) { const t = k / 10; path.push([a[0] + (b[0] - a[0]) * t + off, height - 0.32 - Math.sin(Math.PI * t) * 0.6, a[1] + (b[1] - a[1]) * t]); }
    kit.add(P.metal, tube({ path, radii: [0.008], radialSegments: 4, samples: 2, caps: false, flatten: 1, arc: 360, arcOffset: 0, twist: 0 }));
  }
}

export function bench(kit, pos, rotY = 0) {
  const P = kit.p, q = quat.fromEuler(quat.create(), 0, rotY, 0);
  const at = (x, y, z) => { const w = vec3.transformQuat([0, 0, 0], [x, y, z], q); return [pos[0] + w[0], pos[1] + w[1], pos[2] + w[2]]; };
  kit.box(P.deck, at(0, 0.45, 0), [1.6, 0.06, 0.4], [0, rotY, 0]);
  kit.box(P.deck, at(0, 0.75, -0.18), [1.6, 0.3, 0.05], [0, rotY, 0]);
  for (const s of [-1, 1]) kit.box(P.darkWood, at(s * 0.7, 0.22, 0), [0.06, 0.45, 0.36], [0, rotY, 0]);
}

// Fence posts as one instanced mesh + rails merged into the kit
export function fenceLine(kit, points, { height = 1.1, spacing = 2.2 } = {}) {
  const P = kit.p, posts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / spacing));
    for (let k = 0; k < n; k++) posts.push([a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)]);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    for (const y of [0.45, 0.9]) kit.box(P.deck, [(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2], [len, 0.09, 0.05], [0, -ang, 0]);
  }
  const last = points[points.length - 1]; posts.push(last);
  const inst = new InstancedMesh(box({ width: 0.13, height, depth: 0.13, bevel: 0.015, bevelSegments: 1 }), P.darkWood, posts.length, 'Fence Posts');
  posts.forEach((p, i) => inst.setTransformAt(i, [p[0], height / 2, p[1]], [0, i * 23, (i % 3 - 1) * 2]));
  kit.dynamic.push(inst);
  return inst;
}
