// Visual effects: particle pools (smoke/dust/blood and additive sparks/embers), tracers,
// rain streaks, bullet-hole & blood decals, ejected brass, transient lights.
import { Mesh, Material, Node, buildShape, quat, vec3, mat4 } from '../../engine/index.js';
import { bulletHoleTexture, bloodTexture } from '../content/textures.js';
import { rand } from '../util.js';

class Pool {
  constructor(max, additive) { this.max = max; this.additive = additive; this.list = []; this.data = new Float32Array(max * 8); this.count = 0; }
  emit(p, o = {}) {
    const n = o.count ?? 8;
    for (let i = 0; i < n && this.list.length < this.max; i++) {
      const sp = o.spread ?? 1, dir = o.dir || [0, 1, 0], sd = o.speed ?? 2;
      const r = [rand(-1, 1), rand(-1, 1), rand(-1, 1)];
      const v = [dir[0] * sd * rand(0.4, 1) + r[0] * sp, dir[1] * sd * rand(0.4, 1) + r[1] * sp, dir[2] * sd * rand(0.4, 1) + r[2] * sp];
      this.list.push({ p: [p[0] + r[0] * (o.jitter || 0), p[1] + r[1] * (o.jitter || 0), p[2] + r[2] * (o.jitter || 0)], v, age: 0, life: (o.life ?? 1) * rand(0.6, 1.2), size: (o.size ?? 0.1) * rand(0.6, 1.4), grow: o.grow ?? 1.5, color: o.color || [1, 1, 1, 1], g: o.gravity ?? -9.8, drag: o.drag ?? 1, floor: o.floor ?? -1e9 });
    }
  }
  update(dt) {
    const out = [];
    for (const q of this.list) {
      q.age += dt; if (q.age >= q.life) continue;
      const k = Math.exp(-q.drag * dt);
      q.v[0] *= k; q.v[1] = q.v[1] * k + q.g * dt; q.v[2] *= k;
      q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt;
      if (q.p[1] < q.floor) { q.p[1] = q.floor; q.v[1] *= -0.3; q.v[0] *= 0.5; q.v[2] *= 0.5; }
      out.push(q);
    }
    this.list = out; this.count = out.length;
    for (let i = 0; i < out.length; i++) {
      const q = out[i], t = q.age / q.life, o = i * 8;
      this.data[o] = q.p[0]; this.data[o + 1] = q.p[1]; this.data[o + 2] = q.p[2]; this.data[o + 3] = q.size * (1 + t * q.grow);
      this.data[o + 4] = q.color[0]; this.data[o + 5] = q.color[1]; this.data[o + 6] = q.color[2];
      this.data[o + 7] = q.color[3] * (1 - t) * Math.min(1, t * 12 + 0.2);
    }
  }
}

export class Effects {
  constructor(scene, env, physics) {
    this.scene = scene; this.env = env; this.physics = physics;
    this.smoke = new Pool(1500, false); this.sparks = new Pool(1200, true);
    this.vmSparks = new Pool(64, true); this.vmSparks.count = 0;
    this.tracers = []; this.tracerData = new Float32Array(400 * 14);
    this.rainData = new Float32Array(2400 * 14); this.rainCount = 0; this.rain = 0; this.wind = [1.5, 0, 0.6];
    this.lights = [];
    this.root = new Node('effects'); scene.add(this.root);
    // decals
    const holeMat = new Material({ name: 'hole', color: '#ffffff', roughness: 0.9, texture: bulletHoleTexture(), alphaTest: 0.25 });
    const holeGeo = buildShape({ type: 'plane', width: 0.09, depth: 0.09, subdivisions: 1 });
    this.decals = []; this.decalIdx = 0;
    for (let i = 0; i < 80; i++) { const m = new Mesh(holeGeo, holeMat, 'decal'); m.visible = false; m.castShadow = false; this.root.add(m); this.decals.push(m); }
    this.bloodMats = [1, 2, 3].map((s) => new Material({ name: 'bloodsplat' + s, color: '#ffffff', roughness: 0.3, texture: bloodTexture(s * 5), alphaTest: 0.35 }));
    this.bloodGeo = buildShape({ type: 'plane', width: 1, depth: 1, subdivisions: 1 });
    this.bloods = []; this.bloodIdx = 0;
    for (let i = 0; i < 30; i++) { const m = new Mesh(this.bloodGeo, this.bloodMats[i % 3], 'blood'); m.visible = false; m.castShadow = false; this.root.add(m); this.bloods.push(m); }
    // brass
    const brassMat = new Material({ name: 'brassFx', color: '#c9a04a', roughness: 0.25, metallic: 1 });
    const shellMat = new Material({ name: 'shellFx', color: '#8e1a18', roughness: 0.5 });
    this.brassGeo = buildShape({ type: 'cylinder', radiusTop: 0.0048, radiusBottom: 0.0048, height: 0.045, radialSegments: 8, heightSegments: 1, capTop: true, capBottom: true, arc: 360 });
    this.shellGeo = buildShape({ type: 'cylinder', radiusTop: 0.01, radiusBottom: 0.01, height: 0.065, radialSegments: 8, heightSegments: 1, capTop: true, capBottom: true, arc: 360 });
    this.brass = []; this.brassIdx = 0;
    for (let i = 0; i < 40; i++) { const m = new Mesh(this.brassGeo, brassMat, 'brass'); m.visible = false; m.castShadow = false; m.userData.v = [0, 0, 0]; m.userData.w = [0, 0, 0]; this.root.add(m); this.brass.push(m); }
    this.brassMat = brassMat; this.shellMat = shellMat;
  }

  // ---------------------------------------------------------------- emitters
  muzzle(p, dir, big = 1, suppressed = false) {
    if (!suppressed) this.sparks.emit(p, { count: 6, dir, speed: 6 * big, spread: 1.5, life: 0.08, size: 0.05 * big, grow: 0.2, color: [3, 1.8, 0.8, 1], gravity: 0, drag: 6 });
    this.smoke.emit(p, { count: suppressed ? 2 : 4, dir, speed: 1.2, spread: 0.3, life: 1.2, size: 0.06 * big, grow: 6, color: [0.55, 0.55, 0.55, 0.22], gravity: 0.4, drag: 2.5 });
    this.flash(p, suppressed ? 2 : 14 * big, [1, 0.72, 0.4], 0.05, 8);
  }
  flash(p, intensity, color, dur, range = 8) { const l = { position: [...p], color, intensity, range, t: dur, dur, base: intensity, priority: true }; this.env.dynLights.push(l); this.lights.push(l); return l; }
  impact(p, n, material = 'concrete') {
    if (material === 'flesh') { this.blood(p, n); return; }
    const sparks = material === 'metal';
    const col = material === 'wood' ? [0.45, 0.33, 0.2, 0.7] : material === 'dirt' ? [0.3, 0.25, 0.18, 0.7] : [0.62, 0.6, 0.56, 0.6];
    this.smoke.emit(p, { count: 6, dir: n, speed: 1.6, spread: 0.6, life: 0.9, size: 0.05, grow: 5, color: col, gravity: -1, drag: 3 });
    this.smoke.emit(p, { count: 5, dir: n, speed: 4, spread: 1.2, life: 0.5, size: 0.012, grow: 0, color: [col[0] * 0.6, col[1] * 0.6, col[2] * 0.6, 1], gravity: -9.8, drag: 0.5 });
    this.sparks.emit(p, { count: sparks ? 14 : 4, dir: n, speed: sparks ? 7 : 4, spread: 2.5, life: sparks ? 0.35 : 0.15, size: 0.012, grow: -0.5, color: [4, 2.2, 0.8, 1], gravity: -9.8, drag: 1 });
    this.decal(p, n);
  }
  blood(p, n, amount = 1) {
    this.smoke.emit(p, { count: Math.round(10 * amount), dir: n, speed: 2.2, spread: 1, life: 0.5, size: 0.05, grow: 2.5, color: [0.35, 0.02, 0.02, 0.85], gravity: -6, drag: 2 });
    this.smoke.emit(p, { count: Math.round(8 * amount), dir: n, speed: 3.5, spread: 1.5, life: 0.7, size: 0.018, grow: 0, color: [0.3, 0.01, 0.01, 1], gravity: -9.8, drag: 0.5 });
    // splat on whatever is behind the victim
    const d = [-n[0] + rand(-0.2, 0.2), -n[1] - 0.3, -n[2] + rand(-0.2, 0.2)], l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l;
    const h = this.physics.raycast(p, d, 3);
    if (h) this.bloodDecal(h.point, h.normal, rand(0.4, 0.9) * amount);
  }
  bloodPool(p, s = 1.4) { this.bloodDecal([p[0], 0.012 + Math.random() * 0.003, p[2]], [0, 1, 0], s); }
  decal(p, n) {
    const m = this.decals[this.decalIdx++ % this.decals.length];
    this._orient(m, p, n, 0.003, 1 + Math.random() * 0.4);
  }
  bloodDecal(p, n, s) {
    const m = this.bloods[this.bloodIdx++ % this.bloods.length];
    this._orient(m, p, n, 0.004 + Math.random() * 0.002, s);
  }
  _orient(m, p, n, off, s) {
    // plane geometry faces +Y; rotate +Y onto n
    const q = quat.rotationTo(quat.create(), [0, 1, 0], n);
    const spin = quat.setAxisAngle(quat.create(), [0, 1, 0], Math.random() * 6.28);
    quat.multiply(m.rotation, q, spin);
    m.position.set([p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off]);
    m.scale.set([s, s, s]);
    m.visible = true;
  }
  eject(p, v, shotgun = false) {
    const m = this.brass[this.brassIdx++ % this.brass.length];
    m.geometry = shotgun ? this.shellGeo : this.brassGeo; m.material = shotgun ? this.shellMat : this.brassMat;
    m.position.set(p); m.userData.v = [...v]; m.userData.w = [rand(-20, 20), rand(-20, 20), rand(-20, 20)]; m.userData.life = 4; m.userData.bounced = 0;
    m.visible = true;
  }
  tracer(a, b, color = [3.2, 2.2, 1.1], speed = 280) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d);
    if (L < 1) return;
    this.tracers.push({ a: [...a], dir: [d[0] / L, d[1] / L, d[2] / L], L, t: 0, speed, color });
  }
  explosion(p) {
    this.sparks.emit(p, { count: 60, dir: [0, 1, 0], speed: 9, spread: 7, life: 0.6, size: 0.05, grow: -0.3, color: [5, 2.5, 0.8, 1], gravity: -9.8, drag: 1.2 });
    this.sparks.emit(p, { count: 30, dir: [0, 1, 0], speed: 3, spread: 3, life: 0.35, size: 0.5, grow: 2, color: [4, 1.6, 0.4, 0.8], gravity: 2, drag: 3 });
    this.smoke.emit(p, { count: 50, dir: [0, 1, 0], speed: 3, spread: 3, life: 3.5, size: 0.4, grow: 5, color: [0.2, 0.19, 0.18, 0.55], gravity: 0.6, drag: 1.5 });
    this.smoke.emit(p, { count: 30, dir: [0, 1, 0], speed: 8, spread: 6, life: 1.4, size: 0.03, grow: 0, color: [0.2, 0.17, 0.12, 1], gravity: -9.8, drag: 0.4 });
    this.flash(p, 400, [1, 0.6, 0.3], 0.35, 20);
    this.decal(p, [0, 1, 0]); this.bloodDecal([p[0], 0.013, p[2]], [0, 1, 0], 0.0001);
  }
  steam(p) { this.smoke.emit(p, { count: 2, dir: [0, -1, 0.3], speed: 1.5, spread: 0.3, life: 2.2, size: 0.12, grow: 5, color: [0.7, 0.72, 0.74, 0.14], gravity: 0.3, drag: 1.2 }); }
  sparksBurst(p, n = 12) { this.sparks.emit(p, { count: n, dir: [0, -1, 0], speed: 2, spread: 2, life: 0.8, size: 0.012, grow: -0.5, color: [4, 3, 1.5, 1], gravity: -9.8, drag: 0.5 }); }
  dust(p) { this.smoke.emit(p, { count: 6, dir: [0, 1, 0], speed: 0.5, spread: 0.6, life: 1.2, size: 0.12, grow: 3, color: [0.5, 0.48, 0.45, 0.25], gravity: 0, drag: 2 }); }

  // ---------------------------------------------------------------- update
  update(dt, camPos, camFwd) {
    this.smoke.update(dt); this.sparks.update(dt);
    // transient lights
    for (const l of this.lights) { l.t -= dt; l.intensity = Math.max(0, l.base * (l.t / l.dur)); }
    const dead = this.lights.filter((l) => l.t <= 0);
    if (dead.length) { this.lights = this.lights.filter((l) => l.t > 0); this.env.dynLights = this.env.dynLights.filter((l) => !dead.includes(l)); }
    // brass physics
    for (const m of this.brass) {
      if (!m.visible) continue;
      const u = m.userData; u.life -= dt;
      if (u.life <= 0) { m.visible = false; continue; }
      if (u.bounced < 3) {
        u.v[1] -= 9.8 * dt;
        const p = m.position;
        p[0] += u.v[0] * dt; p[1] += u.v[1] * dt; p[2] += u.v[2] * dt;
        const g = this.physics.groundAt(p[0], p[2], p[1] + 0.2, 0.02, 0.3);
        if (p[1] < g + 0.005) { p[1] = g + 0.005; u.v[1] *= -0.35; u.v[0] *= 0.5; u.v[2] *= 0.5; u.w = u.w.map((w) => w * 0.5); u.bounced++; if (this.onBrass && u.bounced === 1) this.onBrass(p); }
        const q = quat.fromEuler(quat.create(), u.w[0] * dt * 57, u.w[1] * dt * 57, u.w[2] * dt * 57);
        quat.multiply(m.rotation, m.rotation, q);
        if (u.bounced >= 3) { quat.fromEuler(m.rotation, 0, Math.random() * 360, 90); m.position[1] = g + 0.005; }
      }
    }
    // tracers
    let n = 0;
    const out = [];
    for (const t of this.tracers) {
      t.t += dt;
      const head = t.t * t.speed, tail = head - 7;
      if (tail > t.L) continue;
      out.push(t);
      const h = Math.min(head, t.L), tl = Math.max(0, tail);
      if (n < 400) {
        const o = n * 14, c = t.color;
        this.tracerData.set([t.a[0] + t.dir[0] * tl, t.a[1] + t.dir[1] * tl, t.a[2] + t.dir[2] * tl, c[0] * 0.2, c[1] * 0.2, c[2] * 0.2, 0.0,
          t.a[0] + t.dir[0] * h, t.a[1] + t.dir[1] * h, t.a[2] + t.dir[2] * h, c[0], c[1], c[2], 1.0], o);
        n++;
      }
    }
    this.tracers = out; this.tracerCount = n;
    // rain streaks around the camera
    this.rainCount = 0;
    if (this.rain > 0 && camPos) {
      const N = Math.floor(2400 * this.rain), time = performance.now() / 1000, fall = 14, w = this.wind;
      for (let i = 0; i < N; i++) {
        const h1 = Math.sin(i * 12.9898) * 43758.5453, h2 = Math.sin(i * 78.233) * 12543.123, h3 = Math.sin(i * 39.425) * 9573.44;
        const rx = (h1 - Math.floor(h1)) * 30 - 15, rz = (h2 - Math.floor(h2)) * 30 - 15, ph = h3 - Math.floor(h3);
        const y = 14 - ((time * fall / 16 + ph) % 1) * 16;
        const x = Math.floor((camPos[0] - rx) / 30) * 30 + rx + 30 * ((camPos[0] - rx) / 30 - Math.floor((camPos[0] - rx) / 30) > 0.5 ? 1 : 0);
        const px = camPos[0] + (((rx - camPos[0]) % 30) + 45) % 30 - 15, pz = camPos[2] + (((rz - camPos[2]) % 30) + 45) % 30 - 15;
        void x;
        const py = camPos[1] - 3 + y;
        const o = this.rainCount * 14, sl = 0.5;
        this.rainData.set([px, py, pz, 0.6, 0.65, 0.75, 0.0, px - w[0] * sl * 0.06, py - sl, pz - w[2] * sl * 0.06, 0.7, 0.75, 0.85, 0.35], o);
        this.rainCount++;
      }
    }
  }
  renderOptions() {
    const lines = [];
    if (this.tracerCount) lines.push({ data: this.tracerData.subarray(0, this.tracerCount * 14), additive: true });
    if (this.rainCount) lines.push({ data: this.rainData.subarray(0, this.rainCount * 14), alpha: 0.5 });
    return { particles: [this.smoke, this.sparks], lines };
  }
}
