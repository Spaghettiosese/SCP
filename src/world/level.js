// Level builder: Area 1 "Gate B Surface Checkpoint" (night, storm) and Area 2 "Heavy
// Containment Zone — Sector 2" (interior, power out). Produces static geometry (merged per
// material), colliders, lights, nav nodes, doors, interactables and scripted markers.
import { Node, Material, Mesh, buildShape } from '../../engine/index.js';
import { StaticBuilder } from '../util.js';
import { PhysicsWorld, NavGraph } from './physics.js';
import * as K from '../content/props.js';
import { signTexture, hazardLabel, posterTexture, terminalTexture, numberPlate, emblemTexture, bloodTexture } from '../content/textures.js';

export const AREA2_X = 400; // Area 2 lives far to the east so both can coexist

export function buildLevel() {
  const physics = new PhysicsWorld();
  const nav = new NavGraph(physics);
  const M = K.kitMaterials();
  const L = { physics, nav, materials: M, lights: [], doors: {}, interact: [], markers: {}, dynamic: [], areas: [] };
  buildArea1(L, M);
  buildArea2(L, M);
  nav.build();
  return L;
}

// helpers ---------------------------------------------------------------------
function solid(L, sb, mat, min, max, o = {}) {
  sb.box(mat, min, max, o);
  if (o.collide !== false) L.physics.add(min, max, { area: o.area ?? 0, material: o.surface || 'concrete', walkable: o.walkable, blocksSight: o.blocksSight, tag: o.tag });
}
function light(L, area, position, color, intensity, range, o = {}) {
  const l = { position: [...position], color, intensity, baseIntensity: intensity, range, area, ...o };
  L.lights.push(l); return l;
}
const rbox = (w, h, d, bevel = 0.01) => ({ type: 'box', width: w, height: h, depth: d, bevel, bevelSegments: 2, segments: 1 });
const cyl = (rt, rb, h, seg = 16, caps = true) => ({ type: 'cylinder', radiusTop: rt, radiusBottom: rb, height: h, radialSegments: seg, heightSegments: 1, capTop: caps, capBottom: caps, arc: 360 });

// ============================================================================ AREA 1
function buildArea1(L, M) {
  const sb = new StaticBuilder({});
  const A = 1;
  const S = (mat, min, max, o = {}) => solid(L, sb, mat, min, max, { area: A, ...o });

  // ground: asphalt yard, concrete apron, muddy field around the LZ
  sb.box(M.asphalt, [-32, -0.2, -30], [32, 0, 30]);
  sb.box(M.dirt, [-60, -0.2, -75], [60, -0.02, -30]);
  sb.box(M.grass, [-90, -0.25, -110], [90, -0.05, 60]);
  // LZ pad
  sb.box(M.concrete, [-8, -0.18, -50], [8, 0.02, -34]);
  sb.box(M.white, [-0.9, 0.02, -45.5], [-0.5, 0.03, -38.5], { collide: false });
  sb.box(M.white, [0.5, 0.02, -45.5], [0.9, 0.03, -38.5], { collide: false });
  sb.box(M.white, [-0.5, 0.02, -42.2], [0.5, 0.03, -41.8], { collide: false });
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; sb.add(M.lampOrange, cyl(0.12, 0.12, 0.06, 8), { position: [Math.cos(a) * 6.5, 0.05, -42 + Math.sin(a) * 6.5] }); }
  // road markings
  for (let z = -28; z < 28; z += 4) sb.box(M.white, [-0.08, 0.001, z], [0.08, 0.012, z + 2]);
  sb.box(M.hazard, [-6, 0.001, -26.5], [6, 0.014, -25.8]);

  // perimeter walls (4 m) with a gate in the south wall
  const wallH = 4.2;
  S(M.concrete, [-33, 0, -31], [-32, wallH, 30]);
  S(M.concrete, [32, 0, -31], [33, wallH, 30]);
  S(M.concrete, [-33, 0, -31], [-5, wallH, -30]);
  S(M.concrete, [5, 0, -31], [33, wallH, -30]);
  for (let x = -32; x <= 32; x += 8) { sb.box(M.concreteDark, [x - 0.4, 0, -31.3], [x + 0.4, wallH + 0.3, -29.7]); }
  for (const x of [-32.5, 32.5]) for (let z = -30; z <= 30; z += 8) sb.box(M.concreteDark, [x - 0.8, 0, z - 0.4], [x + 0.8, wallH + 0.3, z + 0.4]);
  // wall-top razor wire
  sb.push([0, wallH - 0.2, 0]); K.fence(sb, M, -32.5, -30, -32.5, 30, 0.01); K.fence(sb, M, 32.5, -30, 32.5, 30, 0.01); sb.pop();
  // gate posts + sliding gate (open, pushed aside)
  S(M.concreteDark, [-5.6, 0, -31.4], [-4.6, 5, -29.6]); S(M.concreteDark, [4.6, 0, -31.4], [5.6, 5, -29.6]);
  sb.box(M.hazard, [-5.62, 0, -31.42], [-4.58, 1.4, -29.58], { collide: false });
  sb.box(M.hazard, [4.58, 0, -31.42], [5.62, 1.4, -29.58], { collide: false });
  S(M.steel, [5.6, 0, -30.9], [13, 3.4, -30.7], { blocksSight: true });
  K.sign(sb, signTexture('GATE B', { sub: 'SITE-80 SURFACE CHECKPOINT', emblem: true, w: 1024, h: 256 }), 4.0, 1.0, [0, 4.4, -31.45], 180);
  sb.box(M.concreteDark, [-5.6, 4.9, -31.4], [5.6, 5.3, -29.6]);
  // perimeter fence around the LZ field
  K.fence(sb, M, -33, -30, -33, -70); K.fence(sb, M, 33, -30, 33, -70); K.fence(sb, M, -33, -70, 33, -70);
  L.physics.add([-34, 0, -70], [-33, 3, -30], { area: A, blocksSight: false }); L.physics.add([33, 0, -70], [34, 3, -30], { area: A, blocksSight: false }); L.physics.add([-34, 0, -71], [34, 3, -70], { area: A, blocksSight: false });
  // forest beyond
  let seed = 3;
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2, r = 55 + ((i * 37) % 23);
    const x = Math.cos(a) * r * 1.1, z = -10 + Math.sin(a) * r * 1.2;
    if (Math.abs(x) < 36 && z < 34 && z > -72) continue;
    K.tree(sb, M, x, z, 1.1 + ((i * 13) % 7) / 10, seed++);
  }

  // guard booth at the gate
  L.physics.add([6.9, 0, -27.6], [10.1, 1.0, -24.4], { area: A });
  sb.push([8.5, 0, -26]);
  sb.box(M.wallPaint, [-1.6, 0, -1.6], [1.6, 1.0, 1.6]);
  sb.box(M.glass, [-1.55, 1.0, -1.55], [1.55, 2.3, 1.55], { collide: false });
  L.physics.add([6.9, 1.0, -27.6], [10.1, 2.3, -24.4], { area: A, blocksSight: false });
  sb.box(M.concreteDark, [-1.8, 2.3, -1.8], [1.8, 2.6, 1.8]);
  for (const [x, z] of [[-1.55, -1.55], [1.55, -1.55], [-1.55, 1.55], [1.55, 1.55]]) sb.box(M.metalDark, [x - 0.06, 1.0, z - 0.06], [x + 0.06, 2.3, z + 0.06]);
  sb.box(M.lampCool, [-0.6, 2.28, -0.6], [0.6, 2.3, 0.6], { collide: false });
  K.desk(sb, M, 0, 0.6, 180);
  sb.pop();
  light(L, A, [8.5, 2.1, -26], [0.8, 0.9, 1.0], 14, 7);
  // boom barrier
  sb.box(M.metalDark, [3.6, 0, -26.3], [4.2, 1.1, -25.7]);
  sb.add(M.hazard, rbox(0.12, 0.12, 7.2, 0.02), { position: [3.9, 1.05, -22.2], rotation: [-68, 0, 0] });
  // jersey barriers & sandbags (chicane)
  K.jersey(sb, M, -3, -22, 0); L.physics.add([-4.5, 0, -22.3], [-1.5, 0.81, -21.7], { area: A });
  K.jersey(sb, M, 3.2, -17, 0); L.physics.add([1.7, 0, -17.3], [4.7, 0.81, -16.7], { area: A });
  K.jersey(sb, M, -2.5, -12, 12); L.physics.add([-4, 0, -12.5], [-1, 0.81, -11.5], { area: A });
  K.sandbags(sb, M, 12, -18, 90, 3.2, 3); L.physics.add([11.7, 0, -19.6], [12.3, 0.52, -16.4], { area: A });
  K.sandbags(sb, M, -11, -22, 0, 4, 3); L.physics.add([-13, 0, -22.3], [-9, 0.52, -21.7], { area: A });
  K.sandbags(sb, M, 20, 12, 0, 4, 3); L.physics.add([18, 0, 11.7], [22, 0.52, 12.3], { area: A });

  // shipping containers (cover)
  K.container(sb, M, -18, -8, 90, M.containerRed); L.physics.add([-19.25, 0, -11.05], [-16.75, 2.6, -4.95], { area: A, surface: 'metal' });
  K.container(sb, M, -21, -1, 90, M.containerBlue); L.physics.add([-22.25, 0, -4.05], [-19.75, 2.6, 2.05], { area: A, surface: 'metal' });
  sb.push([0, 2.6, 0]); K.container(sb, M, -19.5, -4.5, 90, M.containerBlue); sb.pop(); L.physics.add([-20.75, 2.6, -7.55], [-18.25, 5.2, -1.45], { area: A, surface: 'metal' });
  K.container(sb, M, 17, 3, 0, M.containerRed, true); L.physics.add([13.95, 0, 1.75], [20.05, 2.6, 4.25], { area: A, surface: 'metal' });
  K.container(sb, M, 22, -7, 20, M.olive); L.physics.add([19.2, 0, -9.4], [24.8, 2.6, -4.6], { area: A, surface: 'metal' });
  // crates, barrels
  const crates = [[-9, -4, 1, 10], [-10.3, -4.2, 0.9, 35], [-9.6, -4.1, 0.8, 5, 0.8], [6, 8, 1, 0], [7.3, 8.3, 1, 20], [-24, 16, 1, 0], [-22.7, 16.2, 1, 12], [25, 18, 1.1, 40]];
  for (const [x, z, s, r, y = 0] of crates) { K.crate(sb, M, x, y, z, s, r); L.physics.add([x - 0.65 * s, 0, z - 0.65 * s], [x + 0.65 * s, y + 0.86 * s, z + 0.65 * s], { area: A, surface: 'wood' }); }
  for (const [x, z] of [[-12, 3], [-12.7, 3.5], [-11.5, 3.9], [14, -10], [14.6, -10.6], [-26, 22], [26, -22]]) { K.barrel(sb, M, x, z); L.physics.add([x - 0.32, 0, z - 0.32], [x + 0.32, 0.9, z + 0.32], { area: A, surface: 'metal' }); }
  // MTF truck parked + burning Foundation van
  K.truck(sb, M, 9, -11, -25); L.physics.add([6.5, 0, -14], [11.5, 2.6, -8], { area: A, surface: 'metal' });
  sb.push([-7, 0, 9], [0, 70, 12]);
  K.truck(sb, new Proxy(M, { get: (t, k) => (k === 'olive' ? M.metalDark : t[k]) }), 0, 0, 0);
  sb.pop();
  L.physics.add([-10, 0, 6.5], [-4, 2.4, 11.5], { area: A, surface: 'metal' });
  const fireNode = new Node('fire');
  const fb = new StaticBuilder({});
  for (let i = 0; i < 5; i++) fb.add(M.fire, { type: 'cone', radius: 0.5 - i * 0.05, height: 1.6 + i * 0.3, radialSegments: 10, heightSegments: 3, capBottom: false, arc: 360 }, { position: [(i - 2) * 0.35, 2.6 + i * 0.05, (i % 2) * 0.3], modifiers: [{ type: 'displace', amount: 0.12, scale: 3, seed: i, octaves: 2 }] });
  fireNode.add(fb.build('flames', { castShadow: false }));
  fireNode.position.set([-7, 0, 9]);
  L.dynamic.push({ type: 'fire', node: fireNode, light: light(L, A, [-7, 3.2, 9], [1.0, 0.55, 0.2], 60, 16), area: A, pos: [-7, 3.2, 9] });

  // light poles (sodium)
  for (const [x, z, r] of [[-14, -22, 90], [14, -22, -90], [-14, 8, 90], [14, 8, -90], [-6, -38, 90], [6, -46, -90]]) {
    const lp = K.lightPole(sb, M, x, z, r); L.physics.add([x - 0.3, 0, z - 0.3], [x + 0.3, 7, z + 0.3], { area: A, blocksSight: false });
    light(L, A, lp, [1.0, 0.72, 0.4], 160, 22);
    sb.add(M.beam, { type: 'cone', radius: 3.2, height: 6.5, radialSegments: 20, heightSegments: 1, capBottom: false, arc: 360 }, { position: [lp[0], lp[1] - 3.2, lp[2]] });
  }
  // guard tower with sweeping searchlight (owns the shadow map in Area 1)
  sb.push([-25, 0, -23]);
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) { sb.box(M.metalDark, [x - 0.12, 0, z - 0.12], [x + 0.12, 6.2, z + 0.12]); }
  for (let h = 1.5; h < 6; h += 1.5) sb.add(M.metalDark, rbox(3.4, 0.08, 0.08, 0.01), { position: [0, h, -1.6] });
  sb.box(M.metalPanel, [-2, 6, -2], [2, 6.25, 2]);
  sb.box(M.metalPanel, [-2, 6.25, -2], [2, 7.2, -1.9]); sb.box(M.metalPanel, [-2, 6.25, 1.9], [2, 7.2, 2]); sb.box(M.metalPanel, [-2, 6.25, -2], [-1.9, 7.2, 2]);
  sb.box(M.metalDark, [-2.3, 8.6, -2.3], [2.3, 8.8, 2.3]);
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) sb.box(M.metalDark, [x - 0.06, 6.25, z - 0.06], [x + 0.06, 8.6, z + 0.06]);
  sb.pop();
  L.physics.add([-26.8, 0, -24.8], [-23.2, 6.2, -21.2], { area: A, blocksSight: false });
  const searchHead = new Node('searchlight');
  const shb = new StaticBuilder({});
  shb.add(M.metalDark, cyl(0.35, 0.4, 0.6, 16), { rotation: [90, 0, 0] });
  shb.add(M.lampCool, cyl(0.3, 0.3, 0.02, 16), { position: [0, 0, 0.31], rotation: [90, 0, 0] });
  shb.add(M.beamCool, { type: 'cone', radius: 2.4, height: 26, radialSegments: 20, heightSegments: 1, capBottom: false, arc: 360 }, { position: [0, 0, 13.3], rotation: [-90, 0, 0] });
  searchHead.add(shb.build('searchhead', { castShadow: false }));
  searchHead.position.set([-24.6, 7.1, -22.6]);
  const search = light(L, A, [-24.6, 7.1, -22.6], [0.85, 0.92, 1.0], 900, 60, { spot: { direction: [0.5, -0.4, 0.7], angle: 0.16, inner: 0.1 }, priority: true });
  L.dynamic.push({ type: 'searchlight', node: searchHead, light: search, area: A, t: 0 });
  L.markers.searchlight = search;

  // ---------------------------------------------------------------- facility facade
  const FZ = 30;
  S(M.concrete, [-32, 0, FZ], [-4.5, 12, FZ + 6]);
  S(M.concrete, [4.5, 0, FZ], [32, 12, FZ + 6]);
  S(M.concrete, [-4.5, 6.4, FZ], [4.5, 12, FZ + 6]);
  sb.box(M.concreteDark, [-33, 11.6, FZ - 0.4], [33, 12.4, FZ + 6.4]);
  for (let x = -28; x <= 28; x += 7) if (Math.abs(x) > 6) sb.box(M.concreteDark, [x - 0.5, 0, FZ - 0.5], [x + 0.5, 11.6, FZ]);
  // lit window strips
  for (let x = -26; x <= 26; x += 3.5) if (Math.abs(x) > 7) { sb.box(Math.abs(x * 7) % 3 < 1 ? M.black : M.glassLit, [x - 1.1, 7.4, FZ - 0.05], [x + 1.1, 8.6, FZ]); sb.box(M.metalDark, [x - 1.2, 7.3, FZ - 0.15], [x + 1.2, 7.4, FZ]); }
  // blast door frame, hazard stripes, sign, beacons
  sb.box(M.hazard, [-5, 0, FZ - 0.3], [-4.4, 6.6, FZ + 0.1]); sb.box(M.hazard, [4.4, 0, FZ - 0.3], [5, 6.6, FZ + 0.1]); sb.box(M.hazard, [-5, 6.4, FZ - 0.3], [5, 7, FZ + 0.1]);
  K.sign(sb, signTexture('SITE-80', { sub: 'SECURE · CONTAIN · PROTECT', emblem: true, w: 1024, h: 256, bg: '#15181b' }), 9, 2.25, [0, 9.2, FZ - 0.05], 180);
  K.sign(sb, hazardLabel('WARNING', ['RESTRICTED AREA', 'LETHAL FORCE', 'AUTHORIZED']), 1.4, 1.75, [-8, 2.4, FZ - 0.03], 180);
  K.sign(sb, hazardLabel('DANGER', ['CONTAINMENT', 'BREACH PROTOCOL', 'IN EFFECT'], '#c4a01e'), 1.4, 1.75, [8, 2.4, FZ - 0.03], 180);
  for (const x of [-5.6, 5.6]) {
    sb.add(M.metalDark, cyl(0.2, 0.22, 0.2, 12), { position: [x, 7.2, FZ - 0.3] });
    sb.add(M.lampRed, cyl(0.16, 0.16, 0.3, 12), { position: [x, 7.45, FZ - 0.3] });
    const b = light(L, A, [x, 7.5, FZ - 0.6], [1, 0.08, 0.04], 120, 18, { spot: { direction: [1, 0, 0], angle: 0.5, inner: 0.25 } });
    L.dynamic.push({ type: 'beacon', light: b, area: A, t: x > 0 ? 0 : Math.PI, speed: 3.2 });
  }
  // side personnel door (Class-D wave 2)
  sb.box(M.metalPanel, [13.2, 0, FZ - 0.05], [15, 2.3, FZ]); sb.box(M.lampOrange, [13.8, 2.45, FZ - 0.1], [14.4, 2.55, FZ]);
  light(L, A, [14.1, 2.6, FZ - 0.8], [1, 0.6, 0.25], 30, 8);
  L.markers.sideDoor = [14.1, 0, FZ - 1.5];
  // blast door (two sliding halves)
  const door = new Node('BlastDoor');
  const dl = new StaticBuilder({}), dr = new StaticBuilder({});
  for (const [b, s] of [[dl, -1], [dr, 1]]) {
    b.box(M.metalPanel, [s > 0 ? 0 : -4.4, 0, -0.4], [s > 0 ? 4.4 : 0, 6.4, 0.4]);
    b.add(M.hazard, rbox(0.4, 6.4, 0.84, 0), { position: [s * 0.2, 3.2, 0] });
    for (let h = 1; h < 6; h += 1.6) b.add(M.metalDark, rbox(3.6, 0.2, 0.9, 0.02), { position: [s * 2.3, h, 0] });
    b.add(M.lampRed, rbox(0.1, 0.1, 0.9, 0), { position: [s * 0.45, 5.8, 0] });
  }
  const dL = dl.build('doorL'), dR = dr.build('doorR');
  door.add(dL, dR); door.position.set([0, 0, FZ + 0.6]);
  const doorCol = L.physics.add([-4.5, 0, FZ + 0.1], [4.5, 6.4, FZ + 1.1], { area: A, tag: 'door', surface: 'metal' });
  L.doors.blast = { node: door, left: dL, right: dR, collider: doorCol, open: 0, target: 0, speed: 0.1, width: 4.3 };
  // terminal
  const termTex = terminalTexture('SITE-80 // GATE B CONTROL');
  K.terminal(sb, M, 6.8, 0, FZ - 0.5, 180, termTex);
  L.physics.add([6.45, 0, FZ - 0.7], [7.15, 1.3, FZ - 0.3], { area: A });
  L.interact.push({ id: 'terminal', pos: [6.8, 1.2, FZ - 0.8], radius: 1.8, label: 'Override blast door', area: A, enabled: false });
  L.markers.terminalTex = termTex;
  light(L, A, [6.8, 1.6, FZ - 1.2], [0.3, 1, 0.6], 6, 3);
  // interior vestibule + freight elevator
  S(M.concreteDark, [-5.5, 0, FZ + 1.1], [-4.5, 7, FZ + 17]); S(M.concreteDark, [4.5, 0, FZ + 1.1], [5.5, 7, FZ + 17]);
  S(M.concreteDark, [-5.5, 0, FZ + 16], [5.5, 7, FZ + 17]);
  sb.box(M.concreteDark, [-5.5, 6.4, FZ + 1.1], [5.5, 7, FZ + 16]);
  sb.box(M.tileDark, [-4.5, -0.1, FZ], [4.5, 0.01, FZ + 16]);
  sb.box(M.grate, [-3.4, 0.01, FZ + 9], [3.4, 0.08, FZ + 15.6]);
  sb.box(M.hazard, [-3.5, 0.0, FZ + 8.8], [3.5, 0.09, FZ + 9]);
  for (const x of [-3.5, 3.5]) sb.box(M.steel, [x - 0.08, 0, FZ + 9], [x + 0.08, 6.3, FZ + 15.8]);
  for (let h = 1; h < 6; h += 1.2) sb.box(M.steel, [-3.5, h, FZ + 15.7], [3.5, h + 0.06, FZ + 15.8]);
  K.sign(sb, signTexture('FREIGHT ELEVATOR 02', { sub: 'HEAVY CONTAINMENT ZONE ▼', w: 1024, h: 256, bg: '#3a2f10', fg: '#f2d060' }), 3.2, 0.8, [0, 5.2, FZ + 15.9], 180);
  K.sign(sb, posterTexture(), 1.0, 1.4, [-4.47, 2.0, FZ + 5], 90);
  sb.box(M.lampCool, [-0.8, 6.35, FZ + 4], [0.8, 6.4, FZ + 4.3], { collide: false }); sb.box(M.lampCool, [-0.8, 6.35, FZ + 12], [0.8, 6.4, FZ + 12.3], { collide: false });
  const inside1 = light(L, A, [0, 6, FZ + 4], [0.9, 0.95, 1], 40, 10), inside2 = light(L, A, [0, 6, FZ + 12], [1, 0.3, 0.2], 40, 10);
  L.dynamic.push({ type: 'flicker', light: inside1, area: A, seed: 2 });
  L.markers.elevator = { min: [-3.4, 0, FZ + 9.2], max: [3.4, 3, FZ + 15.6], center: [0, 0, FZ + 12.4] };
  L.markers.vestibule = [0, 0, FZ + 5];

  // ---------------------------------------------------------------- markers
  L.markers.lz = [0, 0, -42];
  L.markers.playerStart1 = [2.2, 0, -35.2];
  L.markers.squadStart1 = [[-1.2, 0, -34.6], [4.6, 0, -35.8], [-2.8, 0, -36.4], [0.8, 0, -36.8]];
  L.markers.heliLand = [0, 0, -42];
  L.markers.checkpoint = [0, 0, -20];
  L.markers.doorFront = [0, 0, FZ - 6];
  // enemy spawns: wave 1 in the yard, wave 2 from the side door + around the containers
  L.markers.wave1 = [
    { p: [-3, 0, -8], w: 'glock' }, { p: [4, 0, -4], w: null }, { p: [-15, 0, -14], w: 'mp7' }, { p: [16, 0, -2], w: 'glock' },
    { p: [0, 0, 6], w: null }, { p: [-10, 0, 14], w: 'glock' }, { p: [10, 0, 16], w: 'mp7' }, { p: [22, 0, 6], w: null }, { p: [-24, 0, 6], w: 'glock' },
  ];
  L.markers.wave2 = [
    { p: [14, 0, 27], w: 'mp7' }, { p: [13, 0, 26], w: null }, { p: [15.5, 0, 25.5], w: 'glock' }, { p: [-26, 0, 20], w: 'glock' }, { p: [-27, 0, 12], w: null }, { p: [25, 0, 22], w: 'm1014' },
  ];
  // nav nodes (yard grid + lanes)
  for (let x = -28; x <= 28; x += 7) for (let z = -26; z <= 26; z += 6.5) L.nav.add(x, z, { area: A });
  for (const [x, z] of [[0, -33], [0, -38], [-5, -42], [5, -42], [0, -47], [-10, -40], [10, -40], [0, FZ + 3], [0, FZ + 8], [0, FZ + 12], [-2, FZ + 12], [2, FZ + 12]]) L.nav.add(x, z, { area: A });

  const root = sb.build('Area1', { split: 24 });
  root.add(door, fireNode, searchHead);
  L.areas[A] = { root, env: 'storm' };
}

// ============================================================================ AREA 2
function buildArea2(L, M) {
  const sb = new StaticBuilder({});
  const A = 2, X = AREA2_X;
  const S = (mat, min, max, o = {}) => solid(L, sb, mat, [min[0] + X, min[1], min[2]], [max[0] + X, max[1], max[2]], { area: A, ...o });
  const V = (mat, min, max, o = {}) => sb.box(mat, [min[0] + X, min[1], min[2]], [max[0] + X, max[1], max[2]], o);
  const lt = (p, c, i, r, o) => light(L, A, [p[0] + X, p[1], p[2]], c, i, r, o);
  const H = 4;

  // ---------------------------------------------------------------- shell: floors & ceilings
  V(M.tile, [-14, -0.1, -8], [14, 0, 62]);
  // arrival + checkpoint room: x -5..5, z -8..6
  S(M.wallPaint, [-6, 0, -8], [-5, H, 6]); S(M.wallPaint, [5, 0, -8], [6, H, 6]);
  S(M.metalPanel, [-6, 0, -9], [6, H, -8]);
  V(M.concreteDark, [-6, H, -9], [6, H + 0.4, 6]);
  // elevator doors (closed behind the player)
  V(M.metalPanel, [-2, 0, -8.02], [2, 3, -7.98]); V(M.hazard, [-2.2, 3, -8.05], [2.2, 3.3, -7.95]);
  K.sign(sb, signTexture('HEAVY CONTAINMENT ZONE', { sub: 'SECTOR 2 · AUTHORIZED PERSONNEL ONLY', emblem: true, bg: '#2a0f0f', fg: '#f0e0d0' }), 4.8, 1.2, [X, 3.3, 5.9], 180);
  // checkpoint booth (right) + turnstile barrier
  S(M.wallPaint, [2.5, 0, 0], [5, 1.1, 3]); V(M.glass, [2.5, 1.1, 0], [2.52, 2.6, 3]); S(M.wallPaint, [2.5, 2.6, 0], [5, H, 3]);
  L.physics.add([2.49 + X, 1.1, 0], [2.53 + X, 2.6, 3], { area: A, blocksSight: false });
  V(M.lampCool, [3, 3.95, 0.5], [4.5, 4, 2.5]);
  // wall with a doorway into the corridor at z=6
  S(M.wallPaint, [-6, 0, 6], [-2.5, H, 6.4]); S(M.wallPaint, [2.5, 0, 6], [6, H, 6.4]); S(M.wallPaint, [-2.5, 3, 6], [2.5, H, 6.4]);
  V(M.hazard, [-2.6, 0, 5.98], [-2.4, 3, 6.42]); V(M.hazard, [2.4, 0, 5.98], [2.6, 3, 6.42]);
  lt([0, 3.8, -3], [0.9, 0.95, 1], 26, 9);

  // ---------------------------------------------------------------- main corridor x -2.5..2.5, z 6.4..46
  const CW = 2.5;
  // west wall with control-room doorway (z 17..20)
  S(M.wallPaint, [-CW - 0.4, 0, 6.4], [-CW, H, 17]); S(M.wallPaint, [-CW - 0.4, 0, 20], [-CW, H, 46]); S(M.wallPaint, [-CW - 0.4, 3, 17], [-CW, H, 20]);
  // east wall with cell-block doorway (z 27..30)
  S(M.wallPaint, [CW, 0, 6.4], [CW + 0.4, H, 27]); S(M.wallPaint, [CW, 0, 30], [CW + 0.4, H, 46]); S(M.wallPaint, [CW, 3, 27], [CW + 0.4, H, 30]);
  V(M.concreteDark, [-CW - 0.4, H, 6], [CW + 0.4, H + 0.4, 46]);
  // wainscot stripes, floor guide line
  V(M.wallStripe, [-CW + 0.001, 1.0, 6.4], [-CW + 0.02, 1.15, 46]); V(M.wallStripe, [CW - 0.02, 1.0, 6.4], [CW - 0.001, 1.15, 46]);
  V(M.wallStripeY, [-0.1, 0.0, 6.4], [0.1, 0.012, 46]);
  V(M.concreteDark, [-CW, 0, 6.4], [-CW + 0.02, 0.15, 46]); V(M.concreteDark, [CW - 0.02, 0, 6.4], [CW, 0.15, 46]);
  // ceiling cable tray + pipes
  V(M.metalDark, [-1.8, 3.55, 6.4], [-0.8, 3.6, 46]); for (let z = 8; z < 46; z += 2) V(M.metalDark, [-1.85, 3.6, z], [-0.75, 3.95, z + 0.05]);
  sb.push([X, 0, 0]); K.pipeRun(sb, M, 1.8, 3.6, 6.4, 1.8, 46, 0.12); K.pipeRun(sb, M, 1.4, 3.75, 6.4, 1.4, 46, 0.07, M.steel); sb.pop();
  // signage
  K.sign(sb, signTexture('CONTROL ◄', { w: 512, h: 128, size: 70, bg: '#1d2024' }), 1.2, 0.3, [X - CW + 0.03, 3.2, 15.5], 90);
  K.sign(sb, signTexture('D-CLASS HOLDING ►', { w: 1024, h: 128, size: 70, bg: '#1d2024' }), 2, 0.25, [X + CW - 0.03, 3.25, 25.5], -90);
  K.sign(sb, signTexture('SCP-173 ▲', { w: 512, h: 128, size: 72, bg: '#2a0f0f' }), 1.2, 0.3, [X, 3.4, 44.5], 180);
  K.sign(sb, posterTexture(), 0.8, 1.1, [X - CW + 0.03, 1.8, 10], 90);
  K.sign(sb, hazardLabel('NOTICE', ['EYE CONTACT', 'PROTOCOL 173-B', 'DO NOT BLINK'], '#c4a01e'), 0.8, 1.0, [X + CW - 0.03, 1.7, 38], -90);
  // blood trail + decals
  const bloodMat = new Material({ name: 'bloodDecal', color: '#ffffff', roughness: 0.25, texture: bloodTexture(3), alphaTest: 0.3 });
  const bloodMat2 = new Material({ name: 'bloodDecal2', color: '#ffffff', roughness: 0.25, texture: bloodTexture(7), alphaTest: 0.3 });
  for (const [x, z, s, m] of [[0.4, 22, 1.4, bloodMat], [-0.8, 31, 1.0, bloodMat2], [0.9, 40, 1.8, bloodMat], [-1, 48.5, 1.3, bloodMat2], [0.4, 53, 2.2, bloodMat]]) sb.add(m, { type: 'plane', width: s, depth: s, subdivisions: 1 }, { position: [X + x, 0.012, z], rotation: [0, x * 90, 0] });
  // fluorescent fixtures (power-out: off; they come back on)
  L.markers.corridorLights = [];
  for (let z = 9; z < 46; z += 5) {
    V(M.metalDark, [-0.5, 3.9, z - 0.7], [0.5, 4.0, z + 0.7]);
    const tube = new Material({ name: 'tube' + z, color: '#20262a', emissive: '#e9f4ff', emissiveStrength: 0, unlit: true });
    sb.box(tube, [X - 0.35, 3.87, z - 0.6], [X + 0.35, 3.9, z + 0.6], { collide: false });
    const l = lt([0, 3.6, z], [0.9, 0.96, 1.0], 0, 9);
    l.tube = tube; L.markers.corridorLights.push(l);
  }
  // red emergency beacons
  for (const z of [12, 32]) {
    V(M.metalDark, [-CW + 0.02, 3.2, z - 0.15], [-CW + 0.2, 3.4, z + 0.15]);
    sb.add(M.lampRed, cyl(0.1, 0.1, 0.2, 10), { position: [X - CW + 0.14, 3.5, z] });
    const b = lt([-CW + 0.3, 3.4, z], [1, 0.05, 0.02], 80, 14, { spot: { direction: [1, 0, 0], angle: 0.55, inner: 0.3 } });
    L.dynamic.push({ type: 'beacon', light: b, area: A, t: z, speed: 3.6 });
  }
  const dimRed = [lt([0, 3.2, 22], [1, 0.1, 0.05], 10, 9), lt([0, 3.2, 40], [1, 0.1, 0.05], 10, 9)];
  L.markers.emergency = dimRed;

  // ---------------------------------------------------------------- control room (west): x -12..-2.9, z 12..26
  S(M.wallPaint, [-12.4, 0, 12], [-12, H, 26]); S(M.wallPaint, [-12.4, 0, 11.6], [-CW - 0.4, H, 12]); S(M.wallPaint, [-12.4, 0, 26], [-CW - 0.4, H, 26.4]);
  V(M.concreteDark, [-12.4, H, 11.6], [-CW - 0.4, H + 0.4, 26.4]);
  V(M.tileDark, [-12, 0, 12], [-CW - 0.4, 0.005, 26]);
  sb.push([X, 0, 0]);
  K.desk(sb, M, -6, 15, 0); K.desk(sb, M, -9, 15, 0); K.desk(sb, M, -6, 22.5, 180); K.locker(sb, M, -11.7, 19, 90, 5);
  sb.pop();
  for (const [x, z] of [[-6, 15], [-9, 15], [-6, 22.5]]) L.physics.add([X + x - 0.8, 0, z - 0.4], [X + x + 0.8, 0.8, z + 0.4], { area: A, surface: 'metal' });
  L.physics.add([X - 12, 0, 17.6], [X - 11.4, 1.9, 20.4], { area: A, surface: 'metal' });
  // wall of CCTV monitors
  for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
    V(M.metalDark, [-11.95, 1.6 + j * 0.62, 13 + i * 0.8], [-11.8, 2.15 + j * 0.62, 13.7 + i * 0.8]);
    V((i + j) % 3 ? M.screen : M.black, [-11.8, 1.65 + j * 0.62, 13.05 + i * 0.8], [-11.78, 2.1 + j * 0.62, 13.65 + i * 0.8]);
  }
  // power panel (objective)
  V(M.metalPanel, [-7.5, 0, 25.5], [-4.5, 2.6, 26]);
  L.physics.add([X - 7.5, 0, 25.4], [X - 4.5, 2.6, 26], { area: A, surface: 'metal' });
  V(M.hazard, [-7.5, 2.6, 25.5], [-4.5, 2.8, 26]);
  for (let i = 0; i < 5; i++) V(M.metalDark, [-7.2 + i * 0.6, 0.9, 25.35], [-6.9 + i * 0.6, 1.9, 25.5]);
  const leverMat = new Material({ name: 'leverLamp', color: '#300', emissive: '#ff2010', emissiveStrength: 6, unlit: true });
  V(leverMat, [-6.2, 2.1, 25.4], [-5.8, 2.3, 25.5]);
  K.sign(sb, signTexture('SECTOR 2 · MAIN BREAKER', { w: 1024, h: 128, size: 64, bg: '#3a2f10', fg: '#f2d060' }), 2.6, 0.3, [X - 6, 3.1, 25.47], 180);
  L.interact.push({ id: 'power', pos: [X - 6, 1.4, 25], radius: 1.8, label: 'Restore sector power', area: A, enabled: false });
  L.markers.powerLamp = leverMat;
  const ctrl = lt([-7, 3.6, 19], [0.9, 0.95, 1], 0, 11); L.markers.controlLight = ctrl;
  lt([-11.5, 2.2, 16], [0.3, 1, 0.6], 8, 5);

  // ---------------------------------------------------------------- D-class cell block (east): x 2.9..14, z 22..38
  S(M.wallPaint, [14, 0, 22], [14.4, H, 38]); S(M.wallPaint, [CW + 0.4, 0, 21.6], [14.4, H, 22]); S(M.wallPaint, [CW + 0.4, 0, 38], [14.4, H, 38.4]);
  V(M.concreteDark, [CW + 0.4, H, 21.6], [14.4, H + 0.4, 38.4]);
  V(M.concreteDark, [CW + 0.4, 0, 22], [14, 0.005, 38]);
  // cells along the east wall: 4 cells of 3 m
  for (let i = 0; i < 4; i++) {
    const z0 = 22.2 + i * 3.95;
    S(M.concreteDark, [10, 0, z0 - 0.15], [14, H, z0]);
    for (let b = 0; b < 8; b++) V(M.steel, [10 - 0.04, 0, z0 + 0.3 + b * 0.43], [10 + 0.04, 3, z0 + 0.34 + b * 0.43]);
    V(M.metalDark, [10 - 0.06, 3, z0], [10 + 0.06, 3.2, z0 + 3.8]);
    // open cell door swung into the aisle
    sb.add(M.steel, rbox(0.06, 3, 1.2, 0.01), { position: [X + 9.3, 1.5, z0 + 1.7], rotation: [0, 55, 0] });
    sb.add(M.white, rbox(0.8, 0.15, 1.9, 0.03), { position: [X + 12.8, 0.45, z0 + 1.9] });
    V(M.metalDark, [12.3, 0, z0 + 0.95], [13.3, 0.4, z0 + 2.85]);
    lt([12, 3.5, z0 + 1.9], [1.0, 0.85, 0.6], 8 + i * 3, 5);
    K.sign(sb, numberPlate('C-' + (201 + i)), 0.5, 0.25, [X + 9.93, 3.3, z0 + 1.9], -90);
  }
  L.physics.add([X + 9.96, 0, 22], [X + 10.04, 3, 38], { area: A, blocksSight: false });
  lt([6, 3.6, 30], [1, 0.2, 0.1], 18, 10);
  for (const [x, z] of [[5, 24], [6.5, 35], [8, 33]]) { K.barrel(sb, M, X + x, z, M.metalPanel); L.physics.add([X + x - 0.32, 0, z - 0.32], [X + x + 0.32, 0.9, z + 0.32], { area: A, surface: 'metal' }); }

  // ---------------------------------------------------------------- T-junction hallway z 46..52, x -14..14
  S(M.wallPaint, [-14.4, 0, 46], [-CW - 0.4, H, 46.4]); S(M.wallPaint, [CW + 0.4, 0, 46], [14.4, H, 46.4]);
  S(M.wallPaint, [-14.4, 0, 46], [-14, H, 52.4]); S(M.wallPaint, [14, 0, 46], [14.4, H, 52.4]);
  S(M.wallPaint, [-14.4, 0, 52], [-5, H, 52.4]); S(M.wallPaint, [5, 0, 52], [14.4, H, 52.4]);
  V(M.concreteDark, [-14.4, H, 46], [14.4, H + 0.4, 52.4]);
  V(M.wallStripe, [-14, 1.0, 51.98], [-5, 1.15, 52]); V(M.wallStripe, [5, 1.0, 51.98], [14, 1.15, 52]);
  // debris collapse in the east wing
  for (let i = 0; i < 9; i++) sb.add(M.concreteDark, rbox(0.8 + (i % 3) * 0.4, 0.5 + (i % 2) * 0.4, 0.9, 0.05), { position: [X + 10.5 + (i % 4) * 0.8, 0.3 + Math.floor(i / 4) * 0.5, 47 + (i * 1.7) % 4.5], rotation: [i * 13, i * 29, i * 7] });
  L.physics.add([X + 9.8, 0, 46.4], [X + 14, 1.6, 52], { area: A });
  lt([10, 3.2, 49], [1, 0.1, 0.05], 22, 10);
  lt([-10, 3.2, 49], [1, 0.1, 0.05], 22, 10);
  // west wing: storage + steam pipes
  sb.push([X, 0, 0]); K.pipeRun(sb, M, -14, 3.4, 47.5, -5, 47.5, 0.18); K.crate(sb, M, -12.5, 0, 50.5, 1, 10); K.crate(sb, M, -11.2, 0, 50.7, 0.9, 30); sb.pop();
  L.physics.add([X - 13.3, 0, 49.7], [X - 10.5, 0.9, 51.4], { area: A, surface: 'wood' });
  L.dynamic.push({ type: 'steam', pos: [X - 8, 3.3, 47.5], area: A });

  // ---------------------------------------------------------------- SCP-173 containment chamber: x -5..5, z 52.4..62
  S(M.concreteDark, [-5.4, 0, 52.4], [-5, 6, 62.4]); S(M.concreteDark, [5, 0, 52.4], [5.4, 6, 62.4]); S(M.concreteDark, [-5.4, 0, 62], [5.4, 6, 62.4]);
  S(M.concreteDark, [-5, 0, 52], [-1.6, 6, 52.4]); S(M.concreteDark, [1.6, 0, 52], [5, 6, 52.4]); S(M.concreteDark, [-1.6, 3, 52], [1.6, 6, 52.4]);
  V(M.concreteDark, [-5.4, 6, 52], [5.4, 6.4, 62.4]);
  V(M.concrete, [-5, 0, 52.4], [5, 0.01, 62]);
  V(M.hazard, [-1.9, 0, 51.9], [-1.6, 3.3, 52.45]); V(M.hazard, [1.6, 0, 51.9], [1.9, 3.3, 52.45]); V(M.hazard, [-1.9, 3, 51.9], [1.9, 3.3, 52.45]);
  // observation window high on the north wall
  V(M.glass, [-3, 3.8, 61.98], [3, 5.2, 62]); V(M.lampCool, [-3, 5.25, 62.0], [3, 5.3, 62.3]);
  // drain + stains
  sb.add(M.grate, cyl(0.35, 0.35, 0.02, 16), { position: [X, 0.02, 57] });
  sb.add(M.blood, { type: 'plane', width: 2.5, depth: 1.6, subdivisions: 1 }, { position: [X + 1.5, 0.015, 58], rotation: [0, 20, 0] });
  K.sign(sb, signTexture('SCP-173', { sub: 'OBJECT CLASS: EUCLID · CONTAINMENT CHAMBER 173-A', emblem: true, bg: '#1a1d20' }), 3.6, 0.9, [X, 3.8, 51.95], 180);
  K.sign(sb, hazardLabel('WARNING', ['MINIMUM 3 PERSONNEL', 'MAINTAIN EYE CONTACT', 'ANNOUNCE ALL BLINKS']), 1.1, 1.4, [X - 3.5, 1.7, 51.95], 180);
  // jammed containment door (half open, slid right)
  const cdoor = new Node('173Door');
  const cd = new StaticBuilder({});
  cd.box(M.metalPanel, [-1.6, 0, -0.2], [1.6, 3, 0.2]); cd.add(M.hazard, rbox(3.2, 0.3, 0.42, 0), { position: [0, 1.5, 0] });
  cdoor.add(cd.build('173doorpanel'));
  cdoor.position.set([X + 1.9, 0, 52.2]);
  const cdoorCol = L.physics.add([X + 0.3, 0, 52.0], [X + 3.5, 3, 52.4], { area: A, tag: 'door', surface: 'metal' });
  L.doors.chamber = { node: cdoor, collider: cdoorCol, open: 1, x0: X, target: 1 };
  const chamberLight = lt([0, 5.6, 57], [1, 0.12, 0.08], 50, 12);
  L.markers.chamberLight = chamberLight;
  L.markers.chamberCenter = [X, 0, 57.5];
  L.markers.containPoint = [X, 0, 58];

  // ---------------------------------------------------------------- markers + nav
  L.markers.playerStart2 = [X, 0, -5];
  L.markers.squadStart2 = [[X - 1.5, 0, -6], [X + 1.5, 0, -6], [X - 1.5, 0, -4], [X + 1.5, 0, -4]];
  L.markers.corridorMid = [X, 0, 24];
  L.markers.junction = [X, 0, 49];
  L.markers.a2control = [
    { p: [X - 8, 0, 20], w: 'glock' }, { p: [X - 5, 0, 18.5], w: null }, { p: [X - 10, 0, 23], w: null },
  ];
  L.markers.a2cells = [
    { p: [X + 12, 0, 24], w: null }, { p: [X + 12, 0, 28], w: 'mp7' }, { p: [X + 12, 0, 32], w: null }, { p: [X + 12, 0, 36], w: 'glock' }, { p: [X + 6, 0, 36], w: null },
  ];
  L.markers.a2late = [
    { p: [X - 12.5, 0, 48], w: 'glock' }, { p: [X - 13, 0, 50], w: null }, { p: [X + 8, 0, 50], w: null },
  ];
  L.markers.spawn173 = [X - 7, 0, 49.5];
  for (const [x, z] of [[0, -5], [0, 2], [0, 8], [0, 13], [0, 18.5], [0, 24], [0, 28.5], [0, 34], [0, 40], [0, 45], [0, 49], [-4, 49], [-8, 49], [-12, 48.5], [4, 49], [8, 49],
    [-4, 18.5], [-7.5, 18.5], [-10, 20], [-7.5, 13.5], [-4, 24], [-9, 24],
    [4.5, 28.5], [7, 28.5], [7, 24], [7, 33], [7, 36.5], [12, 24], [12, 28], [12, 32], [12, 36],
    [0, 54], [0, 58], [-3, 58], [3, 58]]) L.nav.add(X + x, z, { area: A });

  const root = sb.build('Area2', { split: 16 });
  root.add(cdoor);
  L.areas[A] = { root, env: 'interior' };
}
