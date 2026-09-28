// Collision world: axis-aligned boxes (static level geometry, doors), vertical-cylinder
// character movement with step-up and gravity, ray casts, line-of-sight and a small nav graph.

export class Collider {
  constructor(min, max, o = {}) {
    this.min = [...min]; this.max = [...max];
    this.enabled = true;
    this.tag = o.tag || 'world';
    this.material = o.material || 'concrete'; // impact effects / sounds
    this.area = o.area ?? 0;
    this.blocksSight = o.blocksSight !== false;
    this.walkable = o.walkable !== false;
    this.owner = o.owner || null;
  }
}

export class PhysicsWorld {
  constructor() { this.colliders = []; this.groundY = 0; }
  add(min, max, o) { const c = new Collider(min, max, o); this.colliders.push(c); return c; }
  clear() { this.colliders = []; }

  // highest walkable surface under (x,z) at or below y + step
  groundAt(x, z, y, radius = 0.3, step = 0.45) {
    let g = -Infinity;
    for (const c of this.colliders) {
      if (!c.enabled || !c.walkable) continue;
      if (x + radius * 0.5 < c.min[0] || x - radius * 0.5 > c.max[0] || z + radius * 0.5 < c.min[2] || z - radius * 0.5 > c.max[2]) continue;
      const top = c.max[1];
      if (top <= y + step && top > g) g = top;
    }
    return Math.max(g, this.groundY);
  }

  // Move a vertical cylinder (feet at pos) by delta; returns { pos, grounded, hitWall }
  move(pos, delta, radius, height, state = {}) {
    const p = [pos[0], pos[1], pos[2]];
    let hitWall = false;
    const steps = Math.max(1, Math.ceil(Math.hypot(delta[0], delta[2]) / (radius * 0.5)));
    for (let s = 0; s < steps; s++) {
      p[0] += delta[0] / steps; p[2] += delta[2] / steps;
      // resolve horizontal penetrations (circle vs box footprint), allowing low steps
      for (let it = 0; it < 3; it++) {
        let pushed = false;
        for (const c of this.colliders) {
          if (!c.enabled) continue;
          if (c.max[1] <= p[1] + 0.42 || c.min[1] >= p[1] + height) continue; // below step height or above head
          const cx = Math.max(c.min[0], Math.min(p[0], c.max[0])), cz = Math.max(c.min[2], Math.min(p[2], c.max[2]));
          let dx = p[0] - cx, dz = p[2] - cz; const d2 = dx * dx + dz * dz;
          if (d2 >= radius * radius) continue;
          if (d2 < 1e-10) { // center inside the box: push out along the smallest axis
            const pen = [p[0] - c.min[0], c.max[0] - p[0], p[2] - c.min[2], c.max[2] - p[2]];
            const m = Math.min(...pen), k = pen.indexOf(m);
            if (k === 0) p[0] = c.min[0] - radius; else if (k === 1) p[0] = c.max[0] + radius; else if (k === 2) p[2] = c.min[2] - radius; else p[2] = c.max[2] + radius;
          } else {
            const d = Math.sqrt(d2), push = radius - d;
            p[0] += (dx / d) * push; p[2] += (dz / d) * push;
          }
          pushed = true; hitWall = true;
        }
        if (!pushed) break;
      }
    }
    // vertical
    const g = this.groundAt(p[0], p[2], p[1], radius);
    let grounded = false;
    p[1] += delta[1];
    // ceiling
    for (const c of this.colliders) {
      if (!c.enabled || delta[1] <= 0) continue;
      if (p[0] < c.min[0] - radius * 0.5 || p[0] > c.max[0] + radius * 0.5 || p[2] < c.min[2] - radius * 0.5 || p[2] > c.max[2] + radius * 0.5) continue;
      if (pos[1] + height <= c.min[1] + 0.01 && p[1] + height > c.min[1]) { p[1] = c.min[1] - height; state.bonk = true; }
    }
    if (p[1] <= g + 1e-4) {
      // step up smoothly if the ground rose
      p[1] = g; grounded = true;
    } else if (state.snap && p[1] - g < 0.35 && delta[1] <= 0) { p[1] = g; grounded = true; }
    return { pos: p, grounded, hitWall };
  }

  // Ray vs boxes (slab test). Returns nearest { t, point, normal, collider } within maxT.
  raycast(o, d, maxT = 1000, filter = null) {
    let best = null;
    for (const c of this.colliders) {
      if (!c.enabled || (filter && !filter(c))) continue;
      let t0 = 0, t1 = maxT, nAxis = -1, nSign = 0;
      let ok = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) { if (o[a] < c.min[a] || o[a] > c.max[a]) { ok = false; break; } continue; }
        let ta = (c.min[a] - o[a]) / d[a], tb = (c.max[a] - o[a]) / d[a], s = -1;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
        if (ta > t0) { t0 = ta; nAxis = a; nSign = s; }
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
      if (!ok || nAxis < 0) continue; // origin inside a box counts as no hit
      if (!best || t0 < best.t) {
        const n = [0, 0, 0]; n[nAxis] = nSign;
        best = { t: t0, normal: n, collider: c };
      }
    }
    // implicit ground plane
    if (d[1] < -1e-6) {
      const tg = (this.groundY - o[1]) / d[1];
      if (tg > 0 && tg < maxT && (!best || tg < best.t)) best = { t: tg, normal: [0, 1, 0], collider: null };
    }
    if (best) best.point = [o[0] + d[0] * best.t, o[1] + d[1] * best.t, o[2] + d[2] * best.t];
    return best;
  }

  lineOfSight(a, b) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-4) return true;
    d[0] /= L; d[1] /= L; d[2] /= L;
    const h = this.raycast(a, d, L, (c) => c.blocksSight);
    return !h || h.t >= L - 0.05;
  }
}

// ---------------------------------------------------------------- nav graph
export class NavGraph {
  constructor(physics) { this.physics = physics; this.nodes = []; }
  add(x, z, o = {}) { const n = { id: this.nodes.length, p: [x, 0, z], links: [], area: o.area ?? 0, tag: o.tag || null }; this.nodes.push(n); return n; }
  // connect nodes that can see each other with clearance for a body
  build(maxDist = 22) {
    const ph = this.physics;
    // drop nodes that ended up inside solid props
    this.nodes = this.nodes.filter((n) => !ph.colliders.some((c) => c.enabled && c.walkable && c.max[1] > 0.3 && n.p[0] > c.min[0] - 0.3 && n.p[0] < c.max[0] + 0.3 && n.p[2] > c.min[2] - 0.3 && n.p[2] < c.max[2] + 0.3));
    this.nodes.forEach((n, i) => (n.id = i));
    for (const a of this.nodes) a.links = [];
    for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
      const a = this.nodes[i], b = this.nodes[j];
      if (a.area !== b.area) continue;
      const d = Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]);
      if (d > maxDist) continue;
      if (this.clear(a.p, b.p)) { a.links.push([b, d]); b.links.push([a, d]); }
    }
  }
  clear(a, b, r = 0.35) {
    const ph = this.physics;
    const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
    for (const off of [-r, 0, r]) for (const h of [0.5, 1.2]) {
      const o = [a[0] + nx * off, h, a[2] + nz * off], e = [b[0] + nx * off, h, b[2] + nz * off];
      const d = [e[0] - o[0], 0, e[2] - o[2]], l = Math.hypot(d[0], d[2]);
      d[0] /= l; d[2] /= l;
      const hit = ph.raycast(o, d, l, (c) => c.walkable || c.tag === 'door');
      if (hit && hit.collider && hit.t < l) return false;
    }
    return true;
  }
  nearest(p, area = null, needSight = true) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      if (area !== null && n.area !== area) continue;
      const d = Math.hypot(n.p[0] - p[0], n.p[2] - p[2]);
      if (d < bd && (!needSight || this.clear([p[0], 0, p[2]], n.p, 0.2))) { bd = d; best = n; }
    }
    if (!best && needSight) return this.nearest(p, area, false);
    return best;
  }
  // A* from world position to world position; returns list of points (excluding start)
  path(from, to, area = null) {
    if (this.clear([from[0], 0, from[2]], [to[0], 0, to[2]], 0.3)) return [[to[0], 0, to[2]]];
    const s = this.nearest(from, area), g = this.nearest(to, area);
    if (!s || !g) return [[to[0], 0, to[2]]];
    const open = new Map([[s.id, 0]]), came = new Map(), gs = new Map([[s.id, 0]]);
    const h = (n) => Math.hypot(n.p[0] - g.p[0], n.p[2] - g.p[2]);
    const fs = new Map([[s.id, h(s)]]);
    let guard = 0;
    while (open.size && guard++ < 500) {
      let cur = null, cf = Infinity;
      for (const [id] of open) { const f = fs.get(id); if (f < cf) { cf = f; cur = id; } }
      if (cur === g.id) {
        const out = [[to[0], 0, to[2]]];
        let c = cur;
        while (came.has(c)) { out.unshift(this.nodes[c].p.slice()); c = came.get(c); }
        out.unshift(this.nodes[s.id].p.slice());
        return out;
      }
      open.delete(cur);
      const cn = this.nodes[cur];
      for (const [nb, d] of cn.links) {
        const t = gs.get(cur) + d;
        if (t < (gs.get(nb.id) ?? Infinity)) { came.set(nb.id, cur); gs.set(nb.id, t); fs.set(nb.id, t + h(nb)); open.set(nb.id, 1); }
      }
    }
    return [[to[0], 0, to[2]]];
  }
}
