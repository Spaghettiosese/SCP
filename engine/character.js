// Character: a rigged, multi-part model built entirely from parametric shapes.
// Parts are skinned to a shared skeleton (rigidly or with automatic weights) and
// animated by a Mixer. The whole thing round-trips to plain JSON.
import { Node, Mesh, Material } from './scene.js';
import { Skeleton, computeSkinWeights } from './skeleton.js';
import { Mixer, Clip } from './animation.js';
import { buildShape } from './modifiers.js';
import { mat4, quat, vec3 } from './math.js';

export const mirrorName = (n) => (n ? n.replace(/\.L$/, '.__R').replace(/\.R$/, '.L').replace(/\.__R$/, '.R') : n);
const MIRROR = new Float32Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function expandSkeleton(bones) {
  const out = [];
  for (const b of bones) {
    const { mirror, ...rest } = b;
    out.push(rest);
    if (mirror) out.push({ ...rest, name: mirrorName(b.name), parent: mirrorName(b.parent), head: [-b.head[0], b.head[1], b.head[2]], tail: [-b.tail[0], b.tail[1], b.tail[2]] });
  }
  return out;
}

export class Character extends Node {
  constructor(def) {
    super(def.name || 'Character');
    this.def = JSON.parse(JSON.stringify(def));
    this.def.parts = this.def.parts || [];
    this.def.materials = this.def.materials || {};
    this.def.skeleton = this.def.skeleton || [{ name: 'root', parent: null, head: [0, 0, 0], tail: [0, 0.3, 0] }];
    this.materials = new Map();
    for (const [k, m] of Object.entries(this.def.materials)) this.materials.set(k, new Material({ name: k, ...m }));
    this.skeleton = new Skeleton(expandSkeleton(this.def.skeleton));
    this.mixer = new Mixer(this.skeleton, (this.def.clips || []).map((c) => new Clip(c)));
    this.parts = [];
    this.def.parts.forEach((p) => this.addPart(p, false));
    this.autoAnimate = true;
    this.springs = true;
  }
  static async fromURL(url) { const r = await fetch(url); return new Character(await r.json()); }

  material(name) {
    if (typeof name === 'object' && name) return new Material(name);
    if (!this.materials.has(name)) this.materials.set(name, new Material({ name }));
    return this.materials.get(name);
  }

  addPart(pdef, pushDef = true) {
    if (pushDef) this.def.parts.push(pdef);
    const part = { def: pdef, meshes: [] };
    this.parts.push(part);
    this.buildPart(part);
    return part;
  }
  removePart(part) {
    for (const m of part.meshes) this.remove(m);
    this.parts.splice(this.parts.indexOf(part), 1);
    this.def.parts.splice(this.def.parts.indexOf(part.def), 1);
  }
  buildPart(part) {
    for (const m of part.meshes) this.remove(m);
    part.meshes = [];
    const d = part.def;
    const base = buildShape(d.shape, d.modifiers || []);
    const variants = [{ geo: base, mirror: false }];
    if (d.mirror) variants.push({ geo: base.clone().applyMatrix(MIRROR), mirror: true });
    for (const v of variants) {
      const mesh = new Mesh(v.geo, this.material(d.material), d.name + (v.mirror ? ' (mirror)' : ''));
      mesh.userData.part = part;
      mesh.userData.mirrored = v.mirror;
      mesh.skeleton = this.skeleton;
      mesh.skinRoot = this;
      mesh.castShadow = d.castShadow !== false;
      mesh.visible = d.hidden !== true;
      this.add(mesh);
      part.meshes.push(mesh);
    }
    this.updatePartTransform(part);
  }
  // Apply transform + recompute skin weights (cheap; called live while editing)
  updatePartTransform(part) {
    const d = part.def;
    const p = d.position || [0, 0, 0], r = d.rotation || [0, 0, 0], s = d.scale || [1, 1, 1];
    for (const mesh of part.meshes) {
      if (mesh.userData.mirrored) { vec3.set(mesh.position, -p[0], p[1], p[2]); quat.fromEuler(mesh.rotation, r[0], -r[1], -r[2]); }
      else { vec3.set(mesh.position, p[0], p[1], p[2]); quat.fromEuler(mesh.rotation, r[0], r[1], r[2]); }
      vec3.set(mesh.scale, s[0], s[1], s[2]);
      mat4.fromRTS(mesh.local, mesh.rotation, mesh.position, mesh.scale);
      let bind = d.bind || {};
      if (mesh.userData.mirrored) bind = { ...bind, bone: mirrorName(bind.bone), bones: bind.bones && bind.bones.map(mirrorName) };
      computeSkinWeights(mesh.geometry, this.skeleton, bind, mesh.local);
    }
  }
  setPartMaterial(part, name) { part.def.material = name; for (const m of part.meshes) m.material = this.material(name); }

  rebuildSkeleton() {
    const pose = null; void pose;
    this.skeleton.setBones(expandSkeleton(this.def.skeleton));
    this.mixer = new Mixer(this.skeleton, [...this.mixer.clips.values()]);
    for (const p of this.parts) for (const m of p.meshes) m.skeleton = this.skeleton;
    this.parts.forEach((p) => this.updatePartTransform(p));
  }

  play(name, opts) { this.mixer.play(name, opts); }
  update(dt) {
    this.updateWorld(this.parent ? this.parent.world : null);
    if (this.autoAnimate) this.mixer.update(dt);
    if (this.springs) this.skeleton.simulateSprings(dt, this.world);
  }
  get triangleCount() { let t = 0; for (const p of this.parts) for (const m of p.meshes) t += m.geometry.triangleCount; return t; }
  toJSON() {
    const mats = {};
    for (const [k, m] of this.materials) { const j = m.toJSON(); delete j.name; mats[k] = j; }
    return { format: 'shapeforge-character', version: 1, name: this.name, skeleton: this.def.skeleton, materials: mats, parts: this.def.parts, ...(this.def.roles ? { roles: this.def.roles } : {}), ...(this.def.firstPerson ? { firstPerson: this.def.firstPerson } : {}), clips: [...this.mixer.clips.values()].map((c) => c.toJSON()) };
  }
}
