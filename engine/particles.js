// Tiny CPU particle system (dust puffs, sparks). Rendered as soft point sprites.
import { rng } from './math.js';

export class Particles {
  constructor(max = 2000) {
    this.max = max; this.list = []; this.data = new Float32Array(max * 8); this.count = 0; this.rand = rng(7);
    this.gravity = -0.6; this.drag = 1.8;
  }
  // burst of dust at position p (world), moving roughly along vel
  emit(p, { count = 12, color = [0.72, 0.6, 0.46, 0.5], size = 0.12, spread = 0.6, up = 0.6, life = 1.2, vel = [0, 0, 0] } = {}) {
    const r = this.rand;
    for (let i = 0; i < count && this.list.length < this.max; i++) {
      const a = r() * Math.PI * 2, s = spread * (0.3 + r() * 0.7);
      this.list.push({
        p: [p[0] + (r() - 0.5) * 0.08, p[1] + r() * 0.03, p[2] + (r() - 0.5) * 0.08],
        v: [Math.cos(a) * s + vel[0], up * (0.4 + r() * 0.6) + vel[1], Math.sin(a) * s + vel[2]],
        age: 0, life: life * (0.6 + r() * 0.6), size: size * (0.6 + r() * 0.8), color,
      });
    }
  }
  update(dt) {
    const out = [];
    for (const q of this.list) {
      q.age += dt; if (q.age >= q.life) continue;
      const k = Math.exp(-this.drag * dt);
      q.v[0] *= k; q.v[2] *= k; q.v[1] = q.v[1] * k + this.gravity * dt * 0.2;
      q.p[0] += q.v[0] * dt; q.p[1] = Math.max(0.01, q.p[1] + q.v[1] * dt); q.p[2] += q.v[2] * dt;
      out.push(q);
    }
    this.list = out;
    this.count = out.length;
    for (let i = 0; i < out.length; i++) {
      const q = out[i], t = q.age / q.life, o = i * 8;
      this.data[o] = q.p[0]; this.data[o + 1] = q.p[1]; this.data[o + 2] = q.p[2]; this.data[o + 3] = q.size * (0.6 + t * 1.8);
      this.data[o + 4] = q.color[0]; this.data[o + 5] = q.color[1]; this.data[o + 6] = q.color[2]; this.data[o + 7] = q.color[3] * (1 - t) * Math.min(1, t * 8);
    }
  }
}
