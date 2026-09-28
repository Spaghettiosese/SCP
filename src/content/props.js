// Props built from shapes: NPC weapons, SCP-173, the MTF helicopter and the environment kit
// used by the level builder. Kit functions draw into a StaticBuilder at its current transform.
import { Node, Mesh, Material, buildShape, Geometry } from '../../engine/index.js';
import { StaticBuilder } from '../util.js';
import { WEAPONS, WEAPON_MATERIALS } from './weapons.js';
import { face173Texture, signTexture, emblemTexture, hazardLabel, posterTexture, terminalTexture, numberPlate } from './textures.js';

const rbox = (w, h, d, bevel = 0.01, segments = 1) => ({ type: 'box', width: w, height: h, depth: d, bevel, bevelSegments: 2, segments });
const cyl = (rt, rb, h, seg = 16, caps = true) => ({ type: 'cylinder', radiusTop: rt, radiusBottom: rb, height: h, radialSegments: seg, heightSegments: 1, capTop: caps, capBottom: caps, arc: 360 });
const sq = (rx, ry, rz, e1, e2, extra = {}) => ({ type: 'superquadric', rx, ry, rz, e1, e2, widthSegments: 28, heightSegments: 18, phiStart: 0, phiLength: 360, thetaStart: 0, thetaLength: 180, taperTop: 1, taperBottom: 1, ...extra });
const sphere = (radius, ws = 16, hs = 12) => ({ type: 'sphere', radius, widthSegments: ws, heightSegments: hs, phiStart: 0, phiLength: 360, thetaStart: 0, thetaLength: 180 });
const plane = (w, d) => ({ type: 'plane', width: w, depth: d, subdivisions: 1 });

// ---------------------------------------------------------------- shared material library
export function kitMaterials() {
  return {
    concrete: new Material({ name: 'concrete', color: '#8d8a84', roughness: 0.9, pattern: 'concrete', patternScale: 1, patternColor: '#5c574e', worldPattern: true }),
    concreteDark: new Material({ name: 'concreteDark', color: '#5f5d59', roughness: 0.92, pattern: 'concrete', patternScale: 1, patternColor: '#3d3a35', worldPattern: true }),
    asphalt: new Material({ name: 'asphalt', color: '#2d2e30', roughness: 0.85, pattern: 'asphalt', patternScale: 1, patternColor: '#3a3b3d', worldPattern: true }),
    dirt: new Material({ name: 'dirt', color: '#3d3526', roughness: 0.95, pattern: 'dirt', patternScale: 1.2, patternColor: '#2a2519', worldPattern: true }),
    grass: new Material({ name: 'grass', color: '#27301c', roughness: 0.95, pattern: 'dirt', patternScale: 2, patternColor: '#1b2213', worldPattern: true }),
    hazard: new Material({ name: 'hazard', color: '#e0b21c', roughness: 0.6, pattern: 'hazard', patternScale: 3, patternColor: '#161616', worldPattern: true }),
    metalPanel: new Material({ name: 'metalPanel', color: '#6c7176', roughness: 0.45, metallic: 0.6, pattern: 'panel', patternScale: 0.8, patternColor: '#3e4246', worldPattern: true }),
    metalDark: new Material({ name: 'metalDark', color: '#2f3336', roughness: 0.45, metallic: 0.7, pattern: 'metal', patternScale: 2 }),
    steel: new Material({ name: 'steel', color: '#7c8085', roughness: 0.35, metallic: 1, pattern: 'metal', patternScale: 2 }),
    rust: new Material({ name: 'rust', color: '#5b6a5d', roughness: 0.55, metallic: 0.5, pattern: 'rust', patternScale: 1.5, patternColor: '#6b3a1c', worldPattern: true }),
    containerRed: new Material({ name: 'containerRed', color: '#7a2a1f', roughness: 0.6, metallic: 0.4, pattern: 'rust', patternScale: 1, patternColor: '#4a2410', worldPattern: true }),
    containerBlue: new Material({ name: 'containerBlue', color: '#27425e', roughness: 0.6, metallic: 0.4, pattern: 'rust', patternScale: 1, patternColor: '#4a2a14', worldPattern: true }),
    olive: new Material({ name: 'olive', color: '#3b4230', roughness: 0.65, metallic: 0.2, pattern: 'rust', patternScale: 1.2, patternColor: '#3a2c1c', worldPattern: true }),
    tile: new Material({ name: 'tile', color: '#a9aba6', roughness: 0.35, pattern: 'tile', patternScale: 1.6, patternColor: '#4b4b47', worldPattern: true }),
    tileDark: new Material({ name: 'tileDark', color: '#55595c', roughness: 0.4, pattern: 'tile', patternScale: 1, patternColor: '#2a2c2e', worldPattern: true }),
    wallPaint: new Material({ name: 'wallPaint', color: '#b9b7b0', roughness: 0.75, pattern: 'concrete', patternScale: 1.4, patternColor: '#8b877e', worldPattern: true }),
    wallStripe: new Material({ name: 'wallStripe', color: '#6b1b17', roughness: 0.6 }),
    wallStripeY: new Material({ name: 'wallStripeY', color: '#c49a1a', roughness: 0.6 }),
    grate: new Material({ name: 'grate', color: '#3c3f41', roughness: 0.6, metallic: 0.7, pattern: 'grate', patternScale: 6, patternColor: '#4a3322', worldPattern: true }),
    rubber: new Material({ name: 'rubber', color: '#141414', roughness: 0.7, pattern: 'rubber', patternScale: 20 }),
    glass: new Material({ name: 'glass', color: '#8fb3c4', roughness: 0.05, metallic: 0.3, opacity: 0.25, doubleSided: true }),
    glassLit: new Material({ name: 'glassLit', color: '#d9c38a', emissive: '#ffcf80', emissiveStrength: 1.6, roughness: 0.2 }),
    wood: new Material({ name: 'wood', color: '#6d5236', roughness: 0.75, pattern: 'wood', patternScale: 3, patternColor: '#3e2a17' }),
    sandbag: new Material({ name: 'sandbag', color: '#7a6b4e', roughness: 0.95, pattern: 'fabric', patternScale: 60, sheen: 0.4 }),
    lamp: new Material({ name: 'lamp', color: '#fff4d6', emissive: '#ffe2a8', emissiveStrength: 14, unlit: true }),
    lampCool: new Material({ name: 'lampCool', color: '#e8f4ff', emissive: '#d8ecff', emissiveStrength: 10, unlit: true }),
    lampRed: new Material({ name: 'lampRed', color: '#ff2a1a', emissive: '#ff1a0a', emissiveStrength: 16, unlit: true }),
    lampOrange: new Material({ name: 'lampOrange', color: '#ffae42', emissive: '#ff9a1a', emissiveStrength: 14, unlit: true }),
    lampGreen: new Material({ name: 'lampGreen', color: '#3cff7a', emissive: '#20ff5a', emissiveStrength: 8, unlit: true }),
    screen: new Material({ name: 'screen', color: '#1a3a2a', emissive: '#39ff9a', emissiveStrength: 0.9, roughness: 0.2 }),
    beam: new Material({ name: 'beam', color: '#000000', emissive: '#ffd9a0', emissiveStrength: 0.09, blend: 'add', unlit: true, doubleSided: true }),
    beamCool: new Material({ name: 'beamCool', color: '#000000', emissive: '#dfefff', emissiveStrength: 0.1, blend: 'add', unlit: true, doubleSided: true }),
    fire: new Material({ name: 'fire', color: '#ff8a2a', emissive: '#ff7a1a', emissiveStrength: 18, blend: 'add', unlit: true, doubleSided: true }),
    tire: new Material({ name: 'tire', color: '#161616', roughness: 0.85, pattern: 'rubber', patternScale: 30 }),
    leaf: new Material({ name: 'leaf', color: '#1f2a18', roughness: 0.9, pattern: 'fabric', patternScale: 5, doubleSided: true }),
    bark: new Material({ name: 'bark', color: '#2d241b', roughness: 0.95, pattern: 'wood', patternScale: 8, patternColor: '#1a140e' }),
    cardboard: new Material({ name: 'cardboard', color: '#8a6d47', roughness: 0.9, pattern: 'fabric', patternScale: 40 }),
    paper: new Material({ name: 'paper', color: '#dcd6c8', roughness: 0.9 }),
    blood: new Material({ name: 'blood', color: '#3b0505', roughness: 0.2 }),
    black: new Material({ name: 'black', color: '#060606', roughness: 0.9 }),
    white: new Material({ name: 'white', color: '#d8d8d4', roughness: 0.6 }),
    heliBody: new Material({ name: 'heliBody', color: '#23282a', roughness: 0.62, metallic: 0.3, pattern: 'panel', patternScale: 0.9, patternColor: '#1a1d1f' }),
    heliInterior: new Material({ name: 'heliInterior', color: '#3a3f3c', roughness: 0.8, pattern: 'panel', patternScale: 1.5, patternColor: '#2a2e2c' }),
    seat: new Material({ name: 'seat', color: '#34372f', roughness: 0.9, pattern: 'fabric', patternScale: 120 }),
  };
}

// textured quad (sign, poster, label) facing +Z at the builder's transform
export function texturedMaterial(name, tex, extra = {}) { return new Material({ name, color: '#ffffff', roughness: 0.7, texture: tex, ...extra }); }
export function sign(sb, tex, w, h, pos, rotY = 0, extra = {}) {
  const m = texturedMaterial('sign:' + (tex.__id || (tex.__id = Math.random().toString(36).slice(2))), tex, extra);
  sb.add(m, rbox(w, h, 0.02, 0.003), { position: pos, rotation: [0, rotY, 0] });
  return m;
}

// ---------------------------------------------------------------- NPC weapon (static, one node)
const npcCache = new Map();
export function npcWeapon(id) {
  if (!npcCache.has(id)) {
    const sb = new StaticBuilder({});
    const mats = {}; for (const [k, v] of Object.entries(WEAPON_MATERIALS)) mats[k] = new Material({ name: k, ...v });
    for (const p of WEAPONS[id].parts()) {
      const bone = p.bind.bone;
      if (bone === 'flash' || bone === 'shell' || bone === 'nade' || p.material === 'glass' || p.material === 'reticle') continue;
      sb.add(mats[p.material], p.shape, { position: p.position, rotation: p.rotation, scale: p.scale, modifiers: p.modifiers });
    }
    const flash = new StaticBuilder({});
    const d = WEAPONS[id];
    flash.add(mats.flash, { type: 'extrude', shape: 'star', points: 5, inner: 0.3, radius: 0.09, teeth: 12, toothDepth: 0.1, depth: 0.002, bevel: 0 }, { position: [d.muzzle[0], d.muzzle[1], d.muzzle[2] + 0.02] });
    flash.add(mats.flash, { type: 'cone', radius: 0.04, height: 0.2, radialSegments: 8, heightSegments: 1, capBottom: false, arc: 360 }, { position: [d.muzzle[0], d.muzzle[1], d.muzzle[2] + 0.1], rotation: [90, 0, 0] });
    npcCache.set(id, { sb, flash });
  }
  const { sb, flash } = npcCache.get(id);
  const node = sb.build('npc:' + id);
  for (const m of node.children) m.castShadow = true;
  const fl = flash.build('flash'); fl.visible = false;
  for (const m of fl.children) m.castShadow = false;
  node.add(fl);
  node.flash = fl;
  return node;
}

// ---------------------------------------------------------------- SCP-173
export function createSCP173() {
  const M = kitMaterials();
  const stone = new Material({ name: '173stone', color: '#a39c8e', roughness: 0.92, pattern: 'concrete', patternScale: 4, patternColor: '#6d655a' });
  const face = new Material({ name: '173face', color: '#ffffff', roughness: 0.85, texture: face173Texture() });
  const red = new Material({ name: '173red', color: '#7c1010', roughness: 0.7 });
  const green = new Material({ name: '173green', color: '#1d5e2c', roughness: 0.7 });
  const sb = new StaticBuilder({});
  const D = (amt, sc, seed) => ({ type: 'displace', amount: amt, scale: sc, seed, octaves: 3 });
  // stumpy legs and blocky base
  sb.add(stone, cyl(0.1, 0.12, 0.55, 14), { position: [0.11, 0.28, 0], modifiers: [D(0.015, 8, 1)] });
  sb.add(stone, cyl(0.1, 0.12, 0.55, 14), { position: [-0.11, 0.28, 0], modifiers: [D(0.015, 8, 2)] });
  sb.add(stone, sq(0.14, 0.06, 0.2, 0.4, 0.6), { position: [0.12, 0.05, 0.05], modifiers: [D(0.01, 10, 3)] });
  sb.add(stone, sq(0.14, 0.06, 0.2, 0.4, 0.6), { position: [-0.12, 0.05, 0.05], modifiers: [D(0.01, 10, 4)] });
  // body: a tapered, slightly hunched mass
  sb.add(stone, sq(0.24, 0.52, 0.19, 0.7, 0.8, { widthSegments: 24, heightSegments: 20 }), { position: [0, 0.98, 0], rotation: [5, 0, 0], modifiers: [{ type: 'profile', axis: 'y', values: [0.85, 1.0, 0.9, 0.95, 1.05, 0.9, 0.6] }, D(0.02, 5, 5)] });
  // thin arms hanging with exposed rebar at the elbows
  for (const s of [1, -1]) {
    sb.add(stone, { type: 'tube', path: [[s * 0.25, 1.36, 0.0], [s * 0.31, 1.08, 0.03], [s * 0.3, 0.82, 0.08], [s * 0.27, 0.6, 0.1]], radii: [0.06, 0.045, 0.04, 0.035], radialSegments: 10, samples: 6, caps: true, flatten: 1, arc: 360, arcOffset: 0, twist: 0 }, { modifiers: [D(0.01, 12, 6 + s)] });
    sb.add(M.rust, cyl(0.008, 0.008, 0.2, 6), { position: [s * 0.34, 1.02, 0.02], rotation: [30, 0, s * 50] });
  }
  sb.add(M.rust, cyl(0.009, 0.009, 0.35, 6), { position: [0.08, 1.4, -0.14], rotation: [-35, 0, 10] });
  sb.add(M.rust, cyl(0.009, 0.009, 0.3, 6), { position: [-0.12, 1.2, -0.16], rotation: [-50, 0, -20] });
  // head with the spray-painted face (texture center faces +Z)
  sb.add(stone, cyl(0.07, 0.09, 0.14, 12), { position: [0, 1.5, 0.0] });
  sb.add(face, sq(0.17, 0.2, 0.15, 0.85, 0.9, { widthSegments: 32, heightSegments: 20 }), { position: [0, 1.7, 0.02], rotation: [0, 180, 0], modifiers: [D(0.008, 8, 9)] });
  // paint splatter on the body
  const blobs = [[0.12, 1.1, 0.19, red], [-0.1, 0.9, 0.2, green], [0.2, 0.7, 0.12, red], [-0.18, 1.2, 0.1, red], [0.05, 0.6, -0.22, green], [-0.05, 1.25, -0.2, red]];
  for (const [x, y, z, m] of blobs) sb.add(m, sq(0.07, 0.09, 0.025, 0.9, 0.9), { position: [x, y, z], rotation: [0, Math.atan2(x, z) * 57.3, 0], modifiers: [D(0.02, 18, x * 10)] });
  const node = sb.build('SCP-173');
  node.cullRadius = 1.2;
  return node;
}

// ---------------------------------------------------------------- helicopter (UH-60-style, Foundation black)
export function createHelicopter() {
  const M = kitMaterials();
  const sb = new StaticBuilder({});
  const B = M.heliBody, I = M.heliInterior;
  // cabin: floor, roof, bulkheads; open side doors
  sb.add(I, rbox(2.2, 0.08, 3.6, 0.02), { position: [0, 0.62, 0] });                       // floor
  sb.add(B, sq(1.15, 0.75, 1.85, 0.25, 0.5, { thetaLength: 90 }), { position: [0, 1.95, 0.0] }); // roof (upper half)
  sb.add(I, sq(1.1, 0.7, 1.8, 0.25, 0.5, { thetaLength: 90 }), { position: [0, 1.93, 0.0], scale: [0.98, 0.96, 0.98] });
  sb.add(B, rbox(2.3, 0.5, 3.8, 0.12), { position: [0, 0.4, 0] });                           // belly
  sb.add(B, rbox(0.1, 1.35, 0.5, 0.03), { position: [1.12, 1.3, 1.7] }); sb.add(B, rbox(0.1, 1.35, 0.5, 0.03), { position: [-1.12, 1.3, 1.7] });
  sb.add(B, rbox(0.1, 1.35, 0.6, 0.03), { position: [1.12, 1.3, -1.6] }); sb.add(B, rbox(0.1, 1.35, 0.6, 0.03), { position: [-1.12, 1.3, -1.6] });
  sb.add(I, rbox(2.2, 1.3, 0.08, 0.02), { position: [0, 1.3, -1.86] });                       // rear bulkhead
  // cockpit nose
  sb.add(B, sq(1.1, 0.95, 1.5, 0.45, 0.55), { position: [0, 1.25, 2.6], modifiers: [{ type: 'taper', axis: 'z', amount: -0.35, curve: 1.4 }] });
  sb.add(M.glass, sq(1.02, 0.55, 1.2, 0.4, 0.5, { thetaLength: 80 }), { position: [0, 1.5, 2.85] });
  sb.add(I, rbox(1.8, 0.5, 0.6, 0.05), { position: [0, 1.05, 2.9] });                        // dash
  sb.add(M.screen, rbox(1.2, 0.18, 0.02, 0.005), { position: [0, 1.32, 2.62], rotation: [-30, 0, 0] });
  // engine housing + exhausts
  sb.add(B, sq(0.9, 0.42, 1.8, 0.4, 0.4), { position: [0, 2.72, -0.2] });
  sb.add(M.metalDark, cyl(0.2, 0.22, 0.6, 12), { position: [0.72, 2.65, -1.3], rotation: [70, 0, 30] });
  sb.add(M.metalDark, cyl(0.2, 0.22, 0.6, 12), { position: [-0.72, 2.65, -1.3], rotation: [70, 0, -30] });
  // tail boom, fins
  sb.add(B, cyl(0.26, 0.55, 6.5, 14), { position: [0, 1.75, -5.0], rotation: [90, 0, 0] });
  sb.add(B, rbox(0.12, 2.0, 1.1, 0.04), { position: [0, 2.6, -8.1], rotation: [-18, 0, 0] });
  sb.add(B, rbox(2.8, 0.08, 0.7, 0.03), { position: [0, 1.85, -7.6] });
  // stub wings with pods
  for (const s of [1, -1]) {
    sb.add(B, rbox(1.4, 0.08, 0.6, 0.03), { position: [s * 1.7, 1.9, -0.5], rotation: [0, 0, s * -8] });
    sb.add(M.metalDark, cyl(0.22, 0.22, 1.6, 12), { position: [s * 2.25, 1.72, -0.5], rotation: [90, 0, 0] });
    // landing gear
    sb.add(M.metalDark, cyl(0.05, 0.05, 0.8, 8), { position: [s * 1.05, 0.2, 1.8], rotation: [0, 0, s * 25] });
    sb.add(M.tire, cyl(0.3, 0.3, 0.2, 16), { position: [s * 1.3, -0.15, 1.8], rotation: [0, 0, 90] });
    // benches inside (troops sit facing the doors)
    sb.add(M.seat, rbox(0.5, 0.1, 2.6, 0.02), { position: [s * 0.2, 1.06, -0.2] });
    sb.add(M.seat, rbox(0.1, 0.6, 2.6, 0.02), { position: [s * 0.02, 1.4, -0.2] });
    sb.add(M.metalDark, rbox(0.04, 0.44, 2.6, 0.01), { position: [s * 0.35, 0.84, -0.2] });
    // nav lights
    sb.add(s > 0 ? M.lampGreen : M.lampRed, sphere(0.06, 8, 6), { position: [s * 2.4, 1.75, -0.5] });
  }
  sb.add(M.tire, cyl(0.2, 0.2, 0.14, 12), { position: [0, 1.2, -7.7], rotation: [0, 0, 90] });
  // searchlight under the nose
  sb.add(M.metalDark, cyl(0.12, 0.14, 0.2, 14), { position: [0, 0.18, 2.8], rotation: [60, 0, 0] });
  sb.add(M.lampCool, cyl(0.1, 0.1, 0.02, 14), { position: [0, 0.12, 2.86], rotation: [60, 0, 0] });
  sb.add(M.lampRed, rbox(0.1, 0.05, 0.1, 0.01), { position: [0, 3.05, -1.0] });
  // Foundation emblem on the tail boom
  const em = texturedMaterial('heliEmblem', emblemTexture(), { alphaTest: 0.4, color: '#dfe6ea' });
  sb.add(em, rbox(0.9, 0.9, 0.01, 0), { position: [0.44, 1.9, -3.6], rotation: [0, 90, 0] });
  sb.add(em, rbox(0.9, 0.9, 0.01, 0), { position: [-0.44, 1.9, -3.6], rotation: [0, -90, 0] });
  const node = sb.build('Helicopter');

  // rotors (animated nodes)
  const rotor = new Node('Main Rotor');
  const rb = new StaticBuilder({});
  rb.add(M.metalDark, cyl(0.28, 0.32, 0.35, 16), { position: [0, 0, 0] });
  for (let k = 0; k < 4; k++) rb.add(M.metalDark, rbox(7.6, 0.05, 0.5, 0.02), { position: [Math.cos(k * Math.PI / 2) * 3.9, 0.12, Math.sin(k * Math.PI / 2) * 3.9], rotation: [0, -k * 90, 2] });
  const blades = rb.build('blades');
  rotor.add(blades);
  const disc = new Mesh(buildShape(cyl(8, 8, 0.01, 48)), new Material({ name: 'rotorBlur', color: '#556', emissive: '#99a', emissiveStrength: 0.05, opacity: 0.12, doubleSided: true, roughness: 0.6 }));
  disc.castShadow = false; disc.position.set([0, 0.12, 0]); rotor.add(disc);
  rotor.position.set([0, 3.35, 0]);
  node.add(rotor);
  const tail = new Node('Tail Rotor');
  const tb = new StaticBuilder({});
  for (let k = 0; k < 4; k++) tb.add(M.metalDark, rbox(0.05, 1.5, 0.18, 0.01), { position: [0, Math.cos(k * Math.PI / 2) * 0.75, Math.sin(k * Math.PI / 2) * 0.75], rotation: [k * 90, 0, 0] });
  tail.add(tb.build('tail blades'));
  tail.position.set([0.2, 2.9, -8.35]);
  node.add(tail);
  node.rotor = rotor; node.tailRotor = tail; node.blades = blades; node.disc = disc;
  return node;
}

// ---------------------------------------------------------------- environment kit
// each draws at (x, y, z) with yaw ry (degrees) into the builder `sb` using materials M
// Proper jersey barrier as an extruded profile (built once)
let JERSEY = null;
function jerseyGeo() {
  if (JERSEY) return JERSEY;
  // profile in (z, y), extruded along x
  const prof = [[-0.3, 0], [0.3, 0], [0.3, 0.08], [0.12, 0.3], [0.1, 0.81], [-0.1, 0.81], [-0.12, 0.3], [-0.3, 0.08]];
  const L = 3.0, P = [], I = [];
  const n = prof.length;
  for (const x of [-L / 2, L / 2]) for (const [z, y] of prof) P.push(x, y, z);
  for (let i = 0; i < n; i++) { const a = i, b = (i + 1) % n; I.push(a, b, b + n, a, b + n, a + n); }
  // caps (fan)
  for (let i = 1; i < n - 1; i++) { I.push(0, i + 1, i); I.push(n, n + i, n + i + 1); }
  const g = new Geometry({ positions: P, indices: I });
  // split flat shading: un-index for crisp edges
  JERSEY = flatten(g);
  return JERSEY;
}
function flatten(g) {
  const P = [], I = [];
  for (let t = 0; t < g.indices.length; t++) { const i = g.indices[t]; P.push(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]); I.push(t); }
  const N = new Float32Array(P.length);
  for (let t = 0; t < P.length; t += 9) {
    const ax = P[t + 3] - P[t], ay = P[t + 4] - P[t + 1], az = P[t + 5] - P[t + 2], bx = P[t + 6] - P[t], by = P[t + 7] - P[t + 1], bz = P[t + 8] - P[t + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) { N[t + k * 3] = nx; N[t + k * 3 + 1] = ny; N[t + k * 3 + 2] = nz; }
  }
  return new Geometry({ positions: P, normals: N, indices: I });
}

export function jersey(sb, M, x, z, ry = 0, mat) {
  sb.push([x, 0, z], [0, ry, 0]);
  sb.add(mat || M.concrete, jerseyGeo());
  sb.pop();
}
export function sandbags(sb, M, x, z, ry = 0, len = 3, rows = 3) {
  sb.push([x, 0, z], [0, ry, 0]);
  for (let r = 0; r < rows; r++) {
    const n = Math.floor(len / 0.55), off = (r % 2) * 0.27;
    for (let i = 0; i < n; i++) sb.add(M.sandbag, sq(0.28, 0.08, 0.2, 0.5, 0.35), { position: [-len / 2 + 0.28 + i * 0.55 + off - (r % 2 ? 0.14 : 0), 0.08 + r * 0.15, 0], rotation: [0, (i * 37 + r * 11) % 7 - 3, 0], modifiers: [{ type: 'displace', amount: 0.012, scale: 9, seed: i + r * 10, octaves: 2 }] });
  }
  sb.pop();
}
export function crate(sb, M, x, y, z, s = 1, ry = 0, mat) {
  sb.push([x, y, z], [0, ry, 0], [s, s, s]);
  sb.add(mat || M.olive, rbox(1.2, 0.8, 0.8, 0.02), { position: [0, 0.4, 0] });
  sb.add(M.metalDark, rbox(1.24, 0.06, 0.84, 0.01), { position: [0, 0.1, 0] });
  sb.add(M.metalDark, rbox(1.24, 0.06, 0.84, 0.01), { position: [0, 0.7, 0] });
  sb.add(M.metalDark, rbox(0.1, 0.04, 0.84, 0.01), { position: [-0.4, 0.82, 0] });
  sb.add(M.metalDark, rbox(0.1, 0.04, 0.84, 0.01), { position: [0.4, 0.82, 0] });
  sb.pop();
}
export function barrel(sb, M, x, z, mat, ry = 0, y = 0) {
  sb.push([x, y, z], [0, ry, 0]);
  sb.add(mat || M.rust, cyl(0.3, 0.3, 0.9, 20), { position: [0, 0.45, 0] });
  for (const h of [0.2, 0.7]) sb.add(M.metalDark, { type: 'torus', radius: 0.3, tube: 0.015, radialSegments: 6, tubularSegments: 24, arc: 360, tubeScaleY: 1 }, { position: [0, h, 0] });
  sb.pop();
}
export function container(sb, M, x, z, ry = 0, mat, open = false) {
  sb.push([x, 0, z], [0, ry, 0]);
  const m = mat || M.containerRed;
  const L = 6.06, W = 2.44, H = 2.59;
  sb.add(m, rbox(L, 0.1, W, 0.01), { position: [0, 0.05, 0] });
  sb.add(m, rbox(L, 0.1, W, 0.01), { position: [0, H - 0.05, 0] });
  // corrugated sides
  for (const s of [1, -1]) {
    sb.add(m, rbox(L - 0.2, H - 0.2, 0.04, 0), { position: [0, H / 2, s * (W / 2 - 0.02)] });
    sb.add(m, rbox(0.08, H - 0.2, 0.06, 0.005), { position: [-L / 2 + 0.3, H / 2, s * (W / 2 + 0.02)], modifiers: [{ type: 'array', count: 22, offsetX: 0.26, offsetY: 0, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 0, scaleStep: 1 }] });
  }
  sb.add(m, rbox(0.04, H - 0.2, W - 0.1, 0), { position: [L / 2 - 0.02, H / 2, 0] });
  if (!open) sb.add(m, rbox(0.06, H - 0.2, W - 0.1, 0), { position: [-L / 2 + 0.03, H / 2, 0] });
  for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) sb.add(M.metalDark, rbox(0.16, H, 0.16, 0.01), { position: [cx * (L / 2 - 0.08), H / 2, cz * (W / 2 - 0.08)] });
  // door bars
  sb.add(M.steel, cyl(0.02, 0.02, H - 0.3, 8), { position: [-L / 2 - 0.02, H / 2, 0.5] });
  sb.add(M.steel, cyl(0.02, 0.02, H - 0.3, 8), { position: [-L / 2 - 0.02, H / 2, -0.5] });
  sb.pop();
}
export function truck(sb, M, x, z, ry = 0) {
  // MTF armored utility truck
  sb.push([x, 0, z], [0, ry, 0]);
  const b = M.olive;
  sb.add(b, rbox(2.3, 0.9, 5.4, 0.08), { position: [0, 1.0, 0] });                      // chassis/body
  sb.add(b, rbox(2.2, 1.0, 2.0, 0.12), { position: [0, 1.9, 1.3] });                     // cab
  sb.add(M.glass, rbox(2.0, 0.55, 0.05, 0.02), { position: [0, 2.05, 2.31], rotation: [-12, 0, 0] });
  sb.add(b, rbox(2.3, 1.2, 3.1, 0.06), { position: [0, 2.05, -1.1] });                   // rear box
  sb.add(M.metalDark, rbox(2.35, 0.3, 0.3, 0.04), { position: [0, 0.8, 2.75] });          // bumper
  sb.add(M.lamp, rbox(0.25, 0.14, 0.04, 0.02), { position: [0.8, 1.25, 2.72] });
  sb.add(M.lamp, rbox(0.25, 0.14, 0.04, 0.02), { position: [-0.8, 1.25, 2.72] });
  sb.add(M.lampRed, rbox(0.2, 0.1, 0.04, 0.02), { position: [0.9, 1.0, -2.72] });
  sb.add(M.lampRed, rbox(0.2, 0.1, 0.04, 0.02), { position: [-0.9, 1.0, -2.72] });
  for (const [wx, wz] of [[1.1, 1.8], [-1.1, 1.8], [1.1, -1.6], [-1.1, -1.6]]) {
    sb.add(M.tire, cyl(0.52, 0.52, 0.4, 18), { position: [wx, 0.52, wz], rotation: [0, 0, 90] });
    sb.add(M.metalDark, cyl(0.28, 0.28, 0.42, 12), { position: [wx, 0.52, wz], rotation: [0, 0, 90] });
  }
  const em = texturedMaterial('truckEmblem', emblemTexture(), { alphaTest: 0.4, color: '#d8dcd6' });
  sb.add(em, rbox(0.8, 0.8, 0.01, 0), { position: [1.16, 2.1, -1.0], rotation: [0, 90, 0] });
  sb.add(em, rbox(0.8, 0.8, 0.01, 0), { position: [-1.16, 2.1, -1.0], rotation: [0, -90, 0] });
  sb.pop();
}
export function lightPole(sb, M, x, z, ry = 0, h = 7) {
  sb.push([x, 0, z], [0, ry, 0]);
  sb.add(M.concrete, cyl(0.3, 0.35, 0.5, 12), { position: [0, 0.25, 0] });
  sb.add(M.metalDark, cyl(0.08, 0.12, h, 10), { position: [0, h / 2, 0] });
  sb.add(M.metalDark, rbox(0.1, 0.1, 1.2, 0.02), { position: [0, h, 0.55] });
  sb.add(M.metalDark, rbox(0.5, 0.18, 0.7, 0.04), { position: [0, h - 0.05, 1.1] });
  sb.add(M.lamp, rbox(0.4, 0.02, 0.6, 0.01), { position: [0, h - 0.15, 1.1] });
  sb.pop();
  return [x + Math.sin(ry * Math.PI / 180) * 1.1, h - 0.3, z + Math.cos(ry * Math.PI / 180) * 1.1];
}
export function fence(sb, M, x0, z0, x1, z1, h = 3.2) {
  const L = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0) * 180 / Math.PI;
  sb.push([(x0 + x1) / 2, 0, (z0 + z1) / 2], [0, ry, 0]);
  const posts = Math.max(1, Math.round(L / 3));
  for (let i = 0; i <= posts; i++) sb.add(M.steel, cyl(0.04, 0.04, h + 0.4, 8), { position: [0, (h + 0.4) / 2, -L / 2 + (i * L) / posts] });
  // mesh panels (grate material, see-through look is faked with dark gaps)
  sb.add(M.grate, rbox(0.02, h, L, 0), { position: [0, h / 2, 0] });
  // razor wire coil
  sb.add(M.steel, { type: 'torus', radius: 0.25, tube: 0.008, radialSegments: 4, tubularSegments: 16, arc: 360, tubeScaleY: 1 }, { position: [0, h + 0.35, -L / 2], rotation: [90, 0, 0], modifiers: [{ type: 'array', count: Math.max(2, Math.floor(L / 0.18)), offsetX: 0, offsetY: 0, offsetZ: 0.18, rotX: 0, rotY: 0, rotZ: 0, scaleStep: 1 }] });
  sb.pop();
}
export function terminal(sb, M, x, y, z, ry, screenTex) {
  sb.push([x, y, z], [0, ry, 0]);
  sb.add(M.metalDark, rbox(0.6, 1.1, 0.35, 0.03), { position: [0, 0.55, 0] });
  sb.add(M.metalPanel, rbox(0.62, 0.08, 0.5, 0.02), { position: [0, 1.12, 0.06], rotation: [-15, 0, 0] });
  const scr = screenTex ? texturedMaterial('term:' + Math.random(), screenTex, { emissive: '#ffffff', emissiveStrength: 0.9, unlit: true }) : M.screen;
  sb.add(scr, rbox(0.46, 0.3, 0.02, 0.005), { position: [0, 1.38, 0.1], rotation: [-12, 0, 0] });
  sb.add(M.metalDark, rbox(0.52, 0.36, 0.06, 0.01), { position: [0, 1.38, 0.07], rotation: [-12, 0, 0] });
  sb.add(M.lampGreen, rbox(0.04, 0.04, 0.02, 0.005), { position: [0.2, 0.95, 0.18] });
  sb.add(M.lampRed, rbox(0.04, 0.04, 0.02, 0.005), { position: [0.12, 0.95, 0.18] });
  sb.pop();
  return scr;
}
export function tree(sb, M, x, z, s = 1, seed = 1) {
  sb.push([x, 0, z], [0, seed * 47, 0], [s, s, s]);
  sb.add(M.bark, cyl(0.12, 0.22, 5, 8), { position: [0, 2.5, 0], modifiers: [{ type: 'displace', amount: 0.05, scale: 3, seed, octaves: 2 }] });
  for (let i = 0; i < 4; i++) sb.add(M.leaf, sq(1.6 - i * 0.28, 0.9, 1.6 - i * 0.28, 0.9, 0.9, { widthSegments: 12, heightSegments: 8 }), { position: [Math.sin(i * 2.1) * 0.3, 3.6 + i * 0.9, Math.cos(i * 2.1) * 0.3], modifiers: [{ type: 'displace', amount: 0.35, scale: 1.5, seed: seed + i, octaves: 2 }] });
  sb.pop();
}
export function desk(sb, M, x, z, ry = 0) {
  sb.push([x, 0, z], [0, ry, 0]);
  sb.add(M.metalPanel, rbox(1.6, 0.05, 0.8, 0.01), { position: [0, 0.76, 0] });
  for (const [dx, dz] of [[0.75, 0.35], [-0.75, 0.35], [0.75, -0.35], [-0.75, -0.35]]) sb.add(M.metalDark, rbox(0.05, 0.74, 0.05, 0.005), { position: [dx, 0.37, dz] });
  sb.add(M.metalDark, rbox(0.5, 0.35, 0.05, 0.01), { position: [0.2, 1.0, -0.2], rotation: [-8, 0, 0] });
  sb.add(M.screen, rbox(0.46, 0.3, 0.01, 0.002), { position: [0.2, 1.0, -0.172], rotation: [-8, 0, 0] });
  sb.add(M.metalDark, rbox(0.45, 0.02, 0.15, 0.004), { position: [0.2, 0.79, 0.12] });
  sb.add(M.paper, rbox(0.21, 0.005, 0.3, 0.001), { position: [-0.45, 0.79, 0.05], rotation: [0, 12, 0] });
  sb.pop();
}
export function locker(sb, M, x, z, ry = 0, n = 4) {
  sb.push([x, 0, z], [0, ry, 0]);
  for (let i = 0; i < n; i++) {
    sb.add(M.metalPanel, rbox(0.5, 1.9, 0.5, 0.01), { position: [(i - (n - 1) / 2) * 0.52, 0.95, 0] });
    sb.add(M.black, rbox(0.3, 0.02, 0.01, 0.002), { position: [(i - (n - 1) / 2) * 0.52, 1.7, 0.255], modifiers: [{ type: 'array', count: 4, offsetX: 0, offsetY: -0.04, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 0, scaleStep: 1 }] });
  }
  sb.pop();
}
export function pipeRun(sb, M, x0, y, z0, x1, z1, r = 0.12, mat) {
  const L = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0) * 180 / Math.PI;
  sb.add(mat || M.rust, cyl(r, r, L, 14), { position: [(x0 + x1) / 2, y, (z0 + z1) / 2], rotation: [90, ry, 0] });
  for (let d = 1.5; d < L; d += 3) sb.add(M.metalDark, cyl(r * 1.25, r * 1.25, 0.08, 14), { position: [x0 + (x1 - x0) * d / L, y, z0 + (z1 - z0) * d / L], rotation: [90, ry, 0] });
}
export const TEX = { signTexture, emblemTexture, hazardLabel, posterTexture, terminalTexture, numberPlate };
