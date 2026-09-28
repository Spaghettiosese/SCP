// Scene graph: Node, Mesh, Camera, Scene, Material.
import { vec3, quat, mat4, DEG, hexToRGB } from './math.js';

let NEXT_ID = 1;

export const PATTERNS = ['none', 'fabric', 'denim', 'leather', 'metal', 'wood', 'skin', 'plaid', 'stripes', 'checker', 'dirt', 'felt', 'hair', 'eye', 'walnut',
  // SCP game additions (world-space triplanar)
  'concrete', 'tile', 'hazard', 'panel', 'rust', 'grate', 'rubber', 'asphalt', 'camo'];

export class Material {
  constructor(o = {}) {
    this.name = o.name || 'Material';
    this.color = o.color || '#c8c8c8';
    this.metallic = o.metallic ?? 0;
    this.roughness = o.roughness ?? 0.6;
    this.emissive = o.emissive || '#000000';
    this.emissiveStrength = o.emissiveStrength ?? 0;
    this.pattern = o.pattern || 'none';
    this.patternScale = o.patternScale ?? 8;
    this.patternColor = o.patternColor || '#000000';
    this.patternStrength = o.patternStrength ?? 1;
    this.bump = o.bump ?? 1;
    this.sheen = o.sheen ?? 0; // cloth rim
    this.doubleSided = o.doubleSided ?? false;
    this.opacity = o.opacity ?? 1;
    this.blend = o.blend || 'normal'; // 'normal' | 'add' (glows, flashes, beams)
    this.texture = o.texture || null; // optional canvas/image multiplied into the albedo (uses mesh UVs)
    this.alphaTest = o.alphaTest ?? 0; // discard texels below this alpha (decals, cutouts)
    this.unlit = o.unlit ?? false;
    this.worldPattern = o.worldPattern ?? false; // pattern evaluated in world space instead of rest space
  }
  get patternIndex() { return Math.max(0, PATTERNS.indexOf(this.pattern)); }
  rgb(key) { return hexToRGB(this[key]); }
  toJSON() { const o = {}; for (const k of Object.keys(this)) if (k !== 'texture') o[k] = this[k]; return o; }
}

export class Node {
  constructor(name = 'Node') {
    this.id = NEXT_ID++;
    this.name = name;
    this.position = vec3.create();
    this.rotation = quat.create();
    this.scale = vec3.create(1, 1, 1);
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.local = mat4.create();
    this.world = mat4.create();
    this.userData = {};
    this.worldOverride = null;
  }
  add(...nodes) { for (const n of nodes) { if (n.parent) n.parent.remove(n); n.parent = this; this.children.push(n); } return this; }
  remove(n) { const i = this.children.indexOf(n); if (i >= 0) { this.children.splice(i, 1); n.parent = null; } return this; }
  setEuler(x, y, z) { quat.fromEuler(this.rotation, x, y, z); return this; }
  getEuler(out = [0, 0, 0]) { return quat.toEuler(out, this.rotation); }
  updateWorld(parentWorld = null) {
    mat4.fromRTS(this.local, this.rotation, this.position, this.scale);
    if (this.worldOverride) this.world.set(this.worldOverride); // attached to a bone / camera by game code
    else if (parentWorld) mat4.multiply(this.world, parentWorld, this.local); else this.world.set(this.local);
    for (const c of this.children) c.updateWorld(this.world);
  }
  traverse(fn) { if (fn(this) === false) return; for (const c of this.children) c.traverse(fn); }
  find(name) { let r = null; this.traverse((n) => { if (!r && n.name === name) { r = n; return false; } }); return r; }
  worldPosition(out = [0, 0, 0]) { return mat4.getTranslation(out, this.world); }
}

export class Mesh extends Node {
  constructor(geometry, material = new Material(), name = 'Mesh') {
    super(name);
    this.geometry = geometry;
    this.material = material;
    this.castShadow = true;
    this.receiveShadow = true;
    this.skeleton = null; // when set, geometry is skinned: world = skinRoot.world * joints * local
    this.skinRoot = null; // node that owns the skeleton (character root)
    this.pickable = true;
  }
}

export class Camera {
  constructor() {
    this.position = vec3.create(4, 3, 6);
    this.target = vec3.create(0, 1, 0);
    this.up = vec3.create(0, 1, 0);
    this.fov = 40 * DEG;
    this.near = 0.05;
    this.far = 500;
    this.ortho = false;
    this.orthoSize = 3;
    this.aspect = 1;
    this.view = mat4.create();
    this.proj = mat4.create();
    this.viewProj = mat4.create();
    this.invViewProj = mat4.create();
  }
  update(aspect) {
    this.aspect = aspect;
    mat4.lookAt(this.view, this.position, this.target, this.up);
    if (this.ortho) { const h = this.orthoSize, w = h * aspect; mat4.ortho(this.proj, -w, w, -h, h, -this.far, this.far); }
    else mat4.perspective(this.proj, this.fov, aspect, this.near, this.far);
    mat4.multiply(this.viewProj, this.proj, this.view);
    mat4.invert(this.invViewProj, this.viewProj);
  }
  // World-space ray through normalized device coords
  ray(ndcX, ndcY) {
    const a = vec3.transformMat4([0, 0, 0], [ndcX, ndcY, -1], this.invViewProj);
    const b = vec3.transformMat4([0, 0, 0], [ndcX, ndcY, 1], this.invViewProj);
    return { origin: a, dir: vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], b, a)) };
  }
  project(p) { const v = vec3.transformMat4([0, 0, 0], p, this.viewProj); return v; }
}

export class Scene extends Node {
  constructor() {
    super('Scene');
    this.environment = {
      sunDirection: vec3.normalize([0, 0, 0], [0.45, 0.8, 0.35]),
      sunColor: [1.0, 0.92, 0.8], sunIntensity: 3.2,
      skyColor: [0.55, 0.68, 0.9], groundColor: [0.42, 0.33, 0.25], ambient: 0.9,
      horizonColor: [0.95, 0.78, 0.6], zenithColor: [0.28, 0.48, 0.82],
      fogColor: [0.86, 0.74, 0.62], fogDensity: 0.012,
      exposure: 1.0, sky: true, clouds: true,
      shadowCenter: [0, 1, 0], shadowRadius: 4,
      mesas: true, storm: 0, flash: 0, // sky: desert mesas, storm clouds (0..1), lightning flash
      lights: [], // [{ position, color, intensity, range, spot?: { direction, angle, inner }, shadow?: bool }]
      shadowLight: null, // a spot light from `lights` that owns the shadow map instead of the sun
    };
  }
}
