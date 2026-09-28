// Orbit camera controls with Blender-style bindings:
//  MMB drag orbit, Shift+MMB pan, Ctrl+MMB / wheel zoom, Alt+LMB orbit (trackpad users),
//  optional LMB orbit / RMB pan for viewer apps, touch: 1 finger orbit, 2 finger pinch/pan.
import { vec3, clamp, DEG } from './math.js';

export class OrbitControls {
  constructor(camera, element, { leftButtonOrbit = false } = {}) {
    this.camera = camera; this.el = element;
    this.target = camera.target;
    this.yaw = 35 * DEG; this.pitch = 18 * DEG; this.distance = 6;
    this.leftButtonOrbit = leftButtonOrbit;
    this.enabled = true;
    this.minDistance = 0.2; this.maxDistance = 300;
    this.damping = 0; // 0 = immediate
    this._goal = null;
    this.onChange = null;
    this.fromCamera();
    const el = element;
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      const orbit = e.button === 1 || (e.button === 0 && (e.altKey || this.leftButtonOrbit));
      const pan = (e.button === 1 && e.shiftKey) || (e.button === 2 && this.leftButtonOrbit);
      const zoom = e.button === 1 && e.ctrlKey;
      if (!orbit && !pan && !zoom) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, mode: zoom ? 'zoom' : pan ? 'pan' : 'orbit', id: e.pointerId };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.mode === 'orbit') this.rotate(-dx * 0.008, dy * 0.008);
      else if (drag.mode === 'pan') this.pan(dx, dy);
      else this.zoom(Math.exp(dy * 0.01));
    });
    const end = (e) => { if (drag && e.pointerId === drag.id) { drag = null; } };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { if (!this.enabled) return; e.preventDefault(); this.zoom(Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100) * 0.0018)); }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // touch
    const touches = new Map(); let pinch = null;
    el.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) touches.set(t.identifier, [t.clientX, t.clientY]); pinch = null; }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0], p = touches.get(t.identifier);
        if (p) this.rotate(-(t.clientX - p[0]) * 0.008, (t.clientY - p[1]) * 0.008);
        touches.set(t.identifier, [t.clientX, t.clientY]);
      } else if (e.touches.length === 2) {
        const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), c = [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2];
        if (pinch) { this.zoom(pinch.d / d); this.pan(c[0] - pinch.c[0], c[1] - pinch.c[1]); }
        pinch = { d, c };
      }
    }, { passive: false });
    el.addEventListener('touchend', (e) => { for (const t of e.changedTouches) touches.delete(t.identifier); pinch = null; });
  }
  fromCamera() {
    const d = vec3.sub([0, 0, 0], this.camera.position, this.target);
    this.distance = vec3.len(d) || 5;
    this.yaw = Math.atan2(d[0], d[2]);
    this.pitch = Math.asin(clamp(d[1] / this.distance, -1, 1));
  }
  rotate(dyaw, dpitch) { this.yaw += dyaw; this.pitch = clamp(this.pitch + dpitch, -89.9 * DEG, 89.9 * DEG); this._goal = null; this.apply(); }
  zoom(f) {
    if (this.camera.ortho) this.camera.orthoSize = clamp(this.camera.orthoSize * f, 0.05, 500);
    this.distance = clamp(this.distance * f, this.minDistance, this.maxDistance); this.apply();
  }
  pan(dx, dy) {
    const c = this.camera, h = this.el.clientHeight || 1;
    const scale = c.ortho ? (2 * c.orthoSize) / h : (2 * this.distance * Math.tan(c.fov / 2)) / h;
    const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const fwd = vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], this.target, c.position));
    const up = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], right, fwd));
    vec3.scaleAdd(this.target, this.target, right, -dx * scale);
    vec3.scaleAdd(this.target, this.target, up, dy * scale);
    this._goal = null; this.apply();
  }
  // Smoothly fly to a view (Blender numpad views / frame selected)
  animateTo({ yaw = this.yaw, pitch = this.pitch, distance = this.distance, target = null }, duration = 0.3) {
    this._goal = { from: { yaw: this.yaw, pitch: this.pitch, distance: this.distance, target: [...this.target] }, to: { yaw, pitch, distance, target: target ? [...target] : null }, t: 0, duration };
  }
  update(dt) {
    const g = this._goal;
    if (g) {
      g.t = Math.min(1, g.t + dt / g.duration);
      const s = g.t * g.t * (3 - 2 * g.t);
      let dy = g.to.yaw - g.from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw = g.from.yaw + dy * s; this.pitch = g.from.pitch + (g.to.pitch - g.from.pitch) * s;
      this.distance = g.from.distance + (g.to.distance - g.from.distance) * s;
      if (g.to.target) vec3.lerp(this.target, g.from.target, g.to.target, s);
      if (g.t >= 1) this._goal = null;
      this.apply();
    }
  }
  apply() {
    const c = this.camera, cp = Math.cos(this.pitch);
    vec3.set(c.position, this.target[0] + Math.sin(this.yaw) * cp * this.distance, this.target[1] + Math.sin(this.pitch) * this.distance, this.target[2] + Math.cos(this.yaw) * cp * this.distance);
    if (this.onChange) this.onChange();
  }
}
