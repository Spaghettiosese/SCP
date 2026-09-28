// Scene graph: Node, Mesh, Camera, Scene, Material.
import { vec3, quat, mat4, DEG, hexToRGB } from './math.js';

let NEXT_ID = 1;

export const PATTERNS = ['none', 'fabric', 'denim', 'leather', 'metal', 'wood', 'skin', 'plaid', 'stripes', 'checker', 'dirt', 'felt', 'hair', 'eye', 'walnut', 'planks', 'brick', 'shingles', 'stucco', 'glass', 'corrugated',
  // SCP game additions (21..29)
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
    this.blend = o.blend || 'normal'; // 'normal' | 'add'
    this.texture = o.texture || null; this.alphaTest = o.alphaTest ?? 0;
    this.unlit = o.unlit ?? false; this.worldPattern = o.worldPattern ?? false;
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
    if (this.worldOverride) this.world.set(this.worldOverride);
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

// Local light. Point lights shine in all directions; spot lights shine down their node's
// local -Y axis (so a lamp hanging from a bracket just works). Up to 16 are used per frame,
// nearest to the camera first.
export class Light extends Node {
  constructor(type = 'point', { color = '#ffc07a', intensity = 6, range = 8, angle = 45, flicker = 0 } = {}) {
    super(type === 'spot' ? 'Spot Light' : 'Point Light');
    this.isLight = true;
    this.type = type;
    this.color = color; this.intensity = intensity; this.range = range; this.angle = angle;
    this.flicker = flicker; // 0..1, animated by the renderer (lanterns, torches)
    this.seed = Math.random() * 100;
  }
}

// Many copies of one geometry in a single draw call. Set matrices with setMatrixAt().
export class InstancedMesh extends Node {
  constructor(geometry, material, count, name = 'Instanced') {
    super(name);
    this.geometry = geometry; this.material = material;
    this.count = count; this.instanceMatrices = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) this.instanceMatrices.set(mat4.create(), i * 16);
    this.castShadow = true; this.receiveShadow = true; this.pickable = false;
    this.instanceVersion = 0;
  }
  setMatrixAt(i, m) { this.instanceMatrices.set(m, i * 16); this.instanceVersion++; }
  setTransformAt(i, pos, eulerDeg = [0, 0, 0], scale = [1, 1, 1]) {
    const q = quat.fromEuler(quat.create(), eulerDeg[0], eulerDeg[1], eulerDeg[2]);
    this.setMatrixAt(i, mat4.fromRTS(mat4.create(), q, pos, scale));
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
      // V2
      night: 0, moonDirection: [-0.4, 0.6, -0.5], fogHeight: 0,
      ao: true, aoRadius: 0.5, aoIntensity: 1.4, aoStrength: 1, godRays: 0, rayColor: [1, 0.85, 0.6], lights: true,
      // V3: volumetric light (0 = off), soft shadows (sun size in degrees), weather
      volumetric: 0.5, volumeDensity: 0.03, sunShafts: 0.25, lampGlow: 1, anisotropy: 0.6, volumeDistance: 60,
      shadowSoftness: 2.5, wetness: 0, rain: 0,
      // SCP game: sky variants and plain-object dynamic lights
      mesas: true, storm: 0, flash: 0, dynLights: [],
    };
  }
}
