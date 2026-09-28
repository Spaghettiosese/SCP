// Humans: Mobile Task Force Epsilon-11 operators and Class-D personnel. Built from shapes on
// one humanoid skeleton (the engine's naming convention, so the gait synthesizer and hand
// poses work), with per-character variation. Clips are synthesized once per skeleton and
// shared. At runtime an aim rig bends the spine and IKs both hands onto the carried weapon.
import { Character, expandSkeleton, Skeleton, quat, vec3, mat4 } from '../../engine/index.js';
import { synthesizeLocomotion, synthesizeIdle, applyHandPose, HAND_POSES } from '../../engine/gait.js';
import { twoBoneIK, setWorldRotation } from '../../engine/ik.js';
import { bakePoses } from '../../engine/choreo.js';
import { WEAPONS } from './weapons.js';
import { mergeCharacter } from '../util.js';
import { mtfPatch, dClassPatch, signTexture } from './textures.js';

// ---------------------------------------------------------------- skeleton
const KNUCKLE_Y = 0.845, FINGER_X = 0.277;
const FINGERS = [
  { name: 'index', z: 0.041, length: 0.052, radius: 0.0095 },
  { name: 'middle', z: 0.0215, length: 0.057, radius: 0.0098 },
  { name: 'ring', z: 0.002, length: 0.053, radius: 0.0095 },
  { name: 'pinky', z: -0.0175, length: 0.043, radius: 0.0085 },
];
export const HUMAN_SKELETON = [
  { name: 'root', parent: null, head: [0, 0, 0], tail: [0, 0.2, 0], deform: false },
  { name: 'hips', parent: 'root', head: [0, 0.98, 0], tail: [0, 1.1, 0] },
  { name: 'spine', parent: 'hips', head: [0, 1.1, 0], tail: [0, 1.28, 0] },
  { name: 'chest', parent: 'spine', head: [0, 1.28, 0], tail: [0, 1.5, 0] },
  { name: 'neck', parent: 'chest', head: [0, 1.5, 0], tail: [0, 1.6, 0.01] },
  { name: 'head', parent: 'neck', head: [0, 1.6, 0.01], tail: [0, 1.84, 0.01] },
  { name: 'antenna', parent: 'chest', head: [0.12, 1.42, -0.16], tail: [0.13, 1.78, -0.18], spring: { stiffness: 90, damping: 5, gravity: 1 } },
  { name: 'shoulder.L', parent: 'chest', head: [0.04, 1.45, -0.01], tail: [0.18, 1.45, -0.01], mirror: true },
  { name: 'upperArm.L', parent: 'shoulder.L', head: [0.18, 1.45, -0.01], tail: [0.235, 1.175, -0.02], mirror: true },
  { name: 'foreArm.L', parent: 'upperArm.L', head: [0.235, 1.175, -0.02], tail: [0.265, 0.935, 0.01], mirror: true },
  { name: 'hand.L', parent: 'foreArm.L', head: [0.265, 0.935, 0.01], tail: [0.276, 0.845, 0.018], mirror: true },
  ...FINGERS.flatMap((f) => {
    const j = KNUCKLE_Y - f.length * 0.55, tip = KNUCKLE_Y - f.length;
    return [
      { name: f.name + '1.L', parent: 'hand.L', head: [FINGER_X, KNUCKLE_Y, f.z], tail: [FINGER_X, j, f.z], mirror: true },
      { name: f.name + '2.L', parent: f.name + '1.L', head: [FINGER_X, j, f.z], tail: [FINGER_X, tip, f.z], mirror: true },
    ];
  }),
  { name: 'thumb1.L', parent: 'hand.L', head: [0.271, 0.8925, 0.042], tail: [0.262, 0.87, 0.055], mirror: true },
  { name: 'thumb2.L', parent: 'thumb1.L', head: [0.262, 0.87, 0.055], tail: [0.253, 0.8475, 0.068], mirror: true },
  { name: 'thigh.L', parent: 'hips', head: [0.095, 0.95, 0], tail: [0.105, 0.53, 0.01], mirror: true },
  { name: 'shin.L', parent: 'thigh.L', head: [0.105, 0.53, 0.01], tail: [0.11, 0.1, -0.01], mirror: true },
  { name: 'foot.L', parent: 'shin.L', head: [0.11, 0.1, -0.01], tail: [0.113, 0.03, 0.12], mirror: true },
  { name: 'toe.L', parent: 'foot.L', head: [0.113, 0.03, 0.12], tail: [0.115, 0.025, 0.21], mirror: true },
];

// Hit zones: capsules along bones (radius), damage multiplier resolved by zone
export const HITBOXES = [
  { bone: 'head', r: 0.115, zone: 'head', len: 0.22 },
  { bone: 'neck', r: 0.07, zone: 'head' },
  { bone: 'chest', r: 0.17, zone: 'torso' },
  { bone: 'spine', r: 0.16, zone: 'torso' },
  { bone: 'hips', r: 0.16, zone: 'torso' },
  ...['L', 'R'].flatMap((s) => [
    { bone: 'upperArm.' + s, r: 0.065, zone: 'limb' }, { bone: 'foreArm.' + s, r: 0.055, zone: 'limb' },
    { bone: 'thigh.' + s, r: 0.085, zone: 'limb' }, { bone: 'shin.' + s, r: 0.065, zone: 'limb' },
  ]),
];

// ---------------------------------------------------------------- shape helpers
const P = (name, shape, material, bind, o = {}) => ({ name, shape, material, bind, position: o.p || [0, 0, 0], rotation: o.r || [0, 0, 0], scale: o.s || [1, 1, 1], modifiers: o.m || [], ...(o.mirror ? { mirror: true } : {}), ...(o.noShadow ? { castShadow: false } : {}) });
const sq = (rx, ry, rz, e1, e2, extra = {}) => ({ type: 'superquadric', rx, ry, rz, e1, e2, widthSegments: 28, heightSegments: 18, phiStart: 0, phiLength: 360, thetaStart: 0, thetaLength: 180, taperTop: 1, taperBottom: 1, ...extra });
const rbox = (w, h, d, bevel = 0.006, extra = {}) => ({ type: 'box', width: w, height: h, depth: d, bevel, bevelSegments: 2, ...extra });
const cyl = (rt, rb, h, seg = 16, caps = true) => ({ type: 'cylinder', radiusTop: rt, radiusBottom: rb, height: h, radialSegments: seg, heightSegments: 1, capTop: caps, capBottom: caps, arc: 360 });
const sphere = (radius, extra = {}) => ({ type: 'sphere', radius, widthSegments: 16, heightSegments: 12, phiStart: 0, phiLength: 360, thetaStart: 0, thetaLength: 180, ...extra });
const tube = (path, radii, extra = {}) => ({ type: 'tube', path, radii, radialSegments: 16, samples: 6, caps: false, flatten: 1, arc: 360, arcOffset: 0, twist: 0, ...extra });
const HEAD_PROFILE = { type: 'profile', axis: 'y', values: [0.72, 0.9, 1.0, 1.0, 0.94] };

// Body shared by everyone: head, neck, hands (skin) and the clothing layer names
function bodyParts(o) {
  const top = o.top, pants = o.pants;
  return [
    P('Head', sq(0.095, 0.112, 0.104, 0.78, 0.9), 'skin', { bone: 'head' }, { p: [0, 1.705, 0.012], m: [HEAD_PROFILE] }),
    P('Jaw', sq(0.072, 0.048, 0.07, 0.62, 0.85), 'skin', { bone: 'head' }, { p: [0, 1.627, 0.036] }),
    P('Nose', { type: 'capsule', radius: 0.013, length: 0.026, radialSegments: 12, capSegments: 5 }, 'skin', { bone: 'head' }, { p: [0, 1.699, 0.109], r: [-22, 0, 0], m: [{ type: 'taper', axis: 'y', amount: -0.3, curve: 1 }] }),
    P('Ear', sq(0.012, 0.03, 0.02, 0.8, 0.8, { widthSegments: 12, heightSegments: 10 }), 'skin', { bone: 'head' }, { p: [0.093, 1.695, 0.004], r: [0, -12, 8], mirror: true }),
    P('Eye', sphere(0.013), 'eye', { bone: 'head' }, { p: [0.035, 1.721, 0.1], r: [0, 6, 0], mirror: true, noShadow: true }),
    P('Brow', rbox(0.038, 0.008, 0.012, 0.004), 'hair', { bone: 'head' }, { p: [0.037, 1.744, 0.106], r: [-10, 8, -8], mirror: true }),
    P('Mouth', { type: 'capsule', radius: 0.0045, length: 0.03, radialSegments: 8, capSegments: 3 }, 'lips', { bone: 'head' }, { p: [0, 1.652, 0.098], r: [0, 0, 90], s: [1, 1, 0.7] }),
    P('Neck', cyl(0.05, 0.058, 0.15, 18, false), 'skin', { bones: ['chest', 'neck', 'head'], falloff: 6 }, { p: [0, 1.565, 0] }),
    P('Torso', sq(0.158, 0.285, 0.1, 0.55, 0.62, { widthSegments: 32, heightSegments: 22 }), top, { bones: ['hips', 'spine', 'chest', 'neck'], falloff: 5 }, { p: [0, 1.225, 0], m: [{ type: 'profile', axis: 'y', values: [0.9, 0.86, 0.9, 1.0, 1.07, 1.02, 0.75] }] }),
    P('Deltoid', sphere(0.063), top, { bones: ['chest', 'shoulder.L', 'upperArm.L'], falloff: 6 }, { p: [0.175, 1.415, -0.01], s: [1, 0.95, 1.05], mirror: true }),
    P('Pelvis', sq(0.15, 0.09, 0.098, 0.5, 0.62, { taperBottom: 0.7 }), pants, { bones: ['hips', 'thigh.L', 'thigh.R', 'spine'], falloff: 6 }, { p: [0, 0.99, -0.004] }),
    P('Sleeve', tube([[0.165, 1.452, -0.01], [0.207, 1.33, -0.015], [0.235, 1.175, -0.02], [0.25, 1.05, -0.004], [0.262, 0.965, 0.007]], [0.057, 0.05, 0.044, 0.04, 0.037]), o.sleeve || top, { bones: ['chest', 'shoulder.L', 'upperArm.L', 'foreArm.L'], falloff: 7 }, { mirror: true }),
    P('Palm', rbox(0.03, 0.085, 0.074, 0.013), o.hands, { bone: 'hand.L' }, { mirror: true, p: [0.274, 0.885, 0.015], r: [0, 0, 6] }),
    ...FINGERS.map((f) => P(f.name + ' Finger', { type: 'capsule', radius: f.radius, length: f.length - f.radius, radialSegments: 10, capSegments: 4 }, o.hands, { bones: ['hand.L', f.name + '1.L', f.name + '2.L'], falloff: 9 }, { p: [FINGER_X, KNUCKLE_Y + 0.004 - (f.length + f.radius) / 2, f.z], mirror: true })),
    P('Thumb', { type: 'capsule', radius: 0.0105, length: 0.034, radialSegments: 10, capSegments: 4 }, o.hands, { bones: ['hand.L', 'thumb1.L', 'thumb2.L'], falloff: 9 }, { p: [0.262, 0.87, 0.055], r: [-28, 0, -22], mirror: true }),
    P('Leg', tube([[0.092, 1.0, 0.0], [0.1, 0.76, 0.012], [0.105, 0.53, 0.02], [0.108, 0.33, 0.0], [0.11, 0.17, -0.012]], [0.084, 0.07, 0.057, 0.054, 0.06]), pants, { bones: ['hips', 'thigh.L', 'shin.L'], falloff: 7 }, { mirror: true }),
  ];
}

// ---------------------------------------------------------------- MTF operator
export const MTF_MATERIALS = (skin = '#c28a66') => ({
  skin: { color: skin, roughness: 0.55, pattern: 'skin', patternScale: 6, patternColor: '#9b4a3a', sheen: 0.3 },
  lips: { color: '#8a4b3e', roughness: 0.45 },
  eye: { color: '#efe9e2', roughness: 0.1, pattern: 'eye', patternColor: '#4b3a28' },
  hair: { color: '#2a1d14', roughness: 0.6, pattern: 'hair', patternScale: 4, sheen: 0.5 },
  camoTop: { color: '#2d333b', roughness: 0.88, pattern: 'camo', patternScale: 7, patternColor: '#434b56', patternStrength: 0.85, sheen: 0.6 },
  camoPants: { color: '#2a3037', roughness: 0.9, pattern: 'camo', patternScale: 7, patternColor: '#3d454f', patternStrength: 0.85, sheen: 0.5 },
  carrier: { color: '#1f2327', roughness: 0.85, pattern: 'fabric', patternScale: 220, patternStrength: 0.6, sheen: 0.4 },
  webbing: { color: '#171a1d', roughness: 0.8, pattern: 'fabric', patternScale: 300 },
  polymer: { color: '#16171a', roughness: 0.7, pattern: 'rubber', patternScale: 30 },
  helmet: { color: '#2b2f34', roughness: 0.7, pattern: 'rubber', patternScale: 14 },
  metal: { color: '#2d2f33', roughness: 0.35, metallic: 1, pattern: 'metal', patternScale: 3 },
  lens: { color: '#0b1a12', roughness: 0.05, metallic: 0.5, emissive: '#1cff6a', emissiveStrength: 0.25 },
  gloves: { color: '#1b1c1e', roughness: 0.7, pattern: 'leather', patternScale: 360 },
  boots: { color: '#2a241e', roughness: 0.55, pattern: 'leather', patternScale: 300, patternColor: '#15110d' },
  sole: { color: '#121212', roughness: 0.8 },
  kneepad: { color: '#1a1c1f', roughness: 0.6, pattern: 'rubber', patternScale: 40 },
  rubber: { color: '#101112', roughness: 0.6, pattern: 'rubber', patternScale: 40 },
  medic: { color: '#e8e8e8', roughness: 0.6 },
  red: { color: '#b01818', roughness: 0.6 },
  patch: { color: '#ffffff', roughness: 0.8 },
  tape: { color: '#ffffff', roughness: 0.8 },
});

function mtfGear(o) {
  const parts = [
    // plate carrier + cummerbund
    P('Front Plate', rbox(0.29, 0.32, 0.05, 0.02), 'carrier', { bones: ['spine', 'chest'], falloff: 6 }, { p: [0, 1.31, 0.098] }),
    P('Back Plate', rbox(0.3, 0.34, 0.05, 0.02), 'carrier', { bones: ['spine', 'chest'], falloff: 6 }, { p: [0, 1.31, -0.106] }),
    P('Shoulder Strap', rbox(0.06, 0.024, 0.24, 0.008), 'carrier', { bone: 'chest' }, { p: [0.1, 1.475, -0.004], r: [0, 0, -8], mirror: true }),
    P('Cummerbund', rbox(0.045, 0.15, 0.2, 0.012), 'carrier', { bones: ['spine', 'chest'], falloff: 6 }, { p: [0.163, 1.2, -0.004], mirror: true }),
    P('Mag Pouches', rbox(0.062, 0.12, 0.045, 0.01), 'carrier', { bone: 'spine' }, { p: [-0.075, 1.225, 0.14], m: [{ type: 'array', count: 3, offsetX: 0.075, offsetY: 0, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 0, scaleStep: 1 }] }),
    P('Pouch Mags', rbox(0.022, 0.03, 0.058, 0.004), 'polymer', { bone: 'spine' }, { p: [-0.075, 1.29, 0.138], m: [{ type: 'array', count: 3, offsetX: 0.075, offsetY: 0, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 0, scaleStep: 1 }] }),
    P('Pouch Flaps', rbox(0.066, 0.02, 0.05, 0.006), 'webbing', { bone: 'spine' }, { p: [-0.075, 1.285, 0.142], m: [{ type: 'array', count: 3, offsetX: 0.075, offsetY: 0, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 0, scaleStep: 1 }] }),
    P('Chest Placard', rbox(0.2, 0.075, 0.018, 0.005), 'carrier', { bone: 'chest' }, { p: [0, 1.405, 0.13] }),
    P('Chest Patch', rbox(0.15, 0.045, 0.004, 0), 'tape', { bone: 'chest' }, { p: [0, 1.405, 0.14] }),
    P('Radio Pouch', rbox(0.07, 0.12, 0.05, 0.01), 'carrier', { bone: 'chest' }, { p: [0.12, 1.33, -0.14] }),
    P('Radio', rbox(0.055, 0.1, 0.035, 0.006), 'polymer', { bone: 'chest' }, { p: [0.12, 1.4, -0.14] }),
    P('Antenna', cyl(0.004, 0.003, 0.36, 6), 'rubber', { bone: 'antenna' }, { p: [0.125, 1.6, -0.17] }),
    P('Hydration Pack', rbox(0.2, 0.26, 0.05, 0.03), 'carrier', { bones: ['spine', 'chest'], falloff: 6 }, { p: [0, 1.27, -0.15] }),
    P('Shoulder Patch', rbox(0.004, 0.07, 0.07, 0), 'patch', { bone: 'upperArm.L' }, { p: [0.232, 1.35, -0.012], r: [0, 0, 12], mirror: true }),
    // battle belt + thigh holster
    P('Belt', sq(0.168, 0.028, 0.114, 0.12, 0.62, { widthSegments: 36, heightSegments: 6 }), 'webbing', { bones: ['hips', 'spine'], falloff: 8 }, { p: [0, 1.03, 0] }),
    P('Belt Pouch', rbox(0.06, 0.08, 0.05, 0.01), 'carrier', { bone: 'hips' }, { p: [0.13, 1.01, 0.08], r: [0, 30, 0], mirror: true }),
    P('Dump Pouch', rbox(0.1, 0.1, 0.06, 0.02), 'carrier', { bone: 'hips' }, { p: [0.08, 0.98, -0.12] }),
    P('Holster', rbox(0.05, 0.15, 0.06, 0.012), 'polymer', { bones: ['hips', 'thigh.R'], falloff: 8 }, { p: [-0.165, 0.85, 0.01], r: [0, 0, -4] }),
    P('Holster Pistol Grip', rbox(0.03, 0.06, 0.045, 0.008), 'polymer', { bones: ['hips', 'thigh.R'], falloff: 8 }, { p: [-0.168, 0.95, -0.01], r: [-18, 0, -4] }),
    P('Leg Strap', { type: 'torus', radius: 0.076, tube: 0.008, radialSegments: 6, tubularSegments: 24, arc: 360, tubeScaleY: 2 }, 'webbing', { bone: 'thigh.R' }, { p: [-0.1, 0.8, 0.012] }),
    // knee pads + boots
    P('Knee Pad', sq(0.055, 0.07, 0.035, 0.5, 0.7), 'kneepad', { bone: 'shin.L' }, { p: [0.106, 0.52, 0.06], mirror: true }),
    P('Boot Shaft', cyl(0.058, 0.054, 0.17, 18, false), 'boots', { bones: ['shin.L', 'foot.L'], falloff: 8 }, { mirror: true, p: [0.11, 0.2, -0.008] }),
    P('Boot Foot', sq(0.05, 0.05, 0.128, 0.6, 0.78), 'boots', { bones: ['foot.L', 'toe.L'], falloff: 6 }, { mirror: true, p: [0.113, 0.07, 0.045], m: [{ type: 'taper', axis: 'z', amount: -0.25, curve: 1.2 }, { type: 'squash', axis: 'y', min: -0.045, max: 1 }] }),
    P('Boot Sole', rbox(0.086, 0.02, 0.235, 0.008), 'sole', { bones: ['foot.L', 'toe.L'], falloff: 6 }, { mirror: true, p: [0.113, 0.013, 0.048] }),
    // helmet (high-cut) with rails, shroud and comms cups
    P('Helmet Shell', sq(0.118, 0.1, 0.13, 0.7, 0.8, { thetaLength: 92 }), 'helmet', { bone: 'head' }, { p: [0, 1.74, 0.0], m: [{ type: 'solidify', thickness: 0.012 }] }),
    P('Helmet Rail', rbox(0.012, 0.03, 0.12, 0.003), 'polymer', { bone: 'head' }, { p: [0.116, 1.73, 0.0], mirror: true }),
    P('Helmet Shroud', rbox(0.05, 0.035, 0.018, 0.006), 'metal', { bone: 'head' }, { p: [0, 1.79, 0.126], r: [-20, 0, 0] }),
    P('Comms Cup', cyl(0.042, 0.042, 0.035, 18), 'rubber', { bone: 'head' }, { p: [0.105, 1.69, 0.0], r: [0, 0, 90], mirror: true }),
    P('Comms Band', { type: 'torus', radius: 0.11, tube: 0.007, radialSegments: 6, tubularSegments: 24, arc: 180, tubeScaleY: 1 }, 'rubber', { bone: 'head' }, { p: [0, 1.71, -0.01], r: [0, 90, 0] }),
    P('Boom Mic', tube([[-0.1, 1.67, 0.03], [-0.085, 1.645, 0.09], [-0.03, 1.64, 0.115]], [0.004], { radialSegments: 6, caps: true }), 'rubber', { bone: 'head' }),
    P('Helmet Strobe', rbox(0.025, 0.02, 0.03, 0.006), 'polymer', { bone: 'head' }, { p: [0, 1.845, -0.07] }),
  ];
  if (o.gear === 'nvg') parts.push(
    P('NVG Mount', rbox(0.04, 0.05, 0.03, 0.006), 'metal', { bone: 'head' }, { p: [0, 1.82, 0.13], r: [-40, 0, 0] }),
    P('NVG Tube', cyl(0.019, 0.019, 0.07, 14), 'metal', { bone: 'head' }, { p: [0.028, 1.855, 0.13], r: [-50, 0, 0], mirror: true }),
    P('NVG Lens', cyl(0.016, 0.016, 0.002, 14), 'lens', { bone: 'head' }, { p: [0.028, 1.883, 0.154], r: [-50, 0, 0], mirror: true, noShadow: true }),
  );
  if (o.gear === 'mask') parts.push(
    P('Mask Face', sq(0.085, 0.1, 0.06, 0.7, 0.8), 'rubber', { bone: 'head' }, { p: [0, 1.67, 0.075] }),
    P('Mask Lens', sq(0.03, 0.028, 0.012, 0.6, 0.8), 'lens', { bone: 'head' }, { p: [0.036, 1.715, 0.125], r: [0, 12, 0], mirror: true, noShadow: true }),
    P('Mask Filter', cyl(0.04, 0.042, 0.05, 18), 'metal', { bone: 'head' }, { p: [-0.05, 1.62, 0.12], r: [80, 0, 30] }),
    P('Mask Voice', cyl(0.022, 0.022, 0.02, 14), 'polymer', { bone: 'head' }, { p: [0, 1.625, 0.135], r: [80, 0, 0] }),
  );
  if (o.gear === 'goggles') parts.push(
    P('Goggle Frame', sq(0.085, 0.028, 0.03, 0.4, 0.6), 'rubber', { bone: 'head' }, { p: [0, 1.722, 0.1] }),
    P('Goggle Lens', sq(0.078, 0.022, 0.02, 0.4, 0.6), 'lens', { bone: 'head' }, { p: [0, 1.722, 0.112], noShadow: true }),
    P('Goggle Strap', { type: 'torus', radius: 0.105, tube: 0.006, radialSegments: 6, tubularSegments: 24, arc: 360, tubeScaleY: 2.2 }, 'rubber', { bone: 'head' }, { p: [0, 1.72, 0.0] }),
  );
  if (o.medic) parts.push(
    P('Medic Cross H', rbox(0.07, 0.022, 0.006, 0.002), 'red', { bone: 'head' }, { p: [0, 1.83, -0.085], r: [55, 0, 0] }),
    P('Medic Cross V', rbox(0.022, 0.07, 0.006, 0.002), 'red', { bone: 'head' }, { p: [0, 1.83, -0.085], r: [55, 0, 0] }),
    P('Medic Bag', rbox(0.26, 0.3, 0.12, 0.04), 'carrier', { bones: ['spine', 'chest'], falloff: 6 }, { p: [0, 1.27, -0.2] }),
    P('Medic Bag Cross', rbox(0.12, 0.035, 0.004, 0.001), 'red', { bone: 'chest' }, { p: [0, 1.3, -0.262] }),
    P('Medic Bag Cross V', rbox(0.035, 0.12, 0.004, 0.001), 'red', { bone: 'chest' }, { p: [0, 1.3, -0.262] }),
  );
  if (o.beard) parts.push(P('Beard', sq(0.078, 0.06, 0.07, 0.6, 0.85), 'hair', { bone: 'head' }, { p: [0, 1.625, 0.045], m: [{ type: 'displace', amount: 0.004, scale: 40, seed: 2, octaves: 2 }] }));
  return parts;
}

// ---------------------------------------------------------------- Class-D
export const DCLASS_MATERIALS = (skin = '#b77f5c') => ({
  skin: { color: skin, roughness: 0.55, pattern: 'skin', patternScale: 6, patternColor: '#8f4636', sheen: 0.3 },
  lips: { color: '#7d443a', roughness: 0.45 },
  eye: { color: '#efe9e2', roughness: 0.1, pattern: 'eye', patternColor: '#3c2d20' },
  hair: { color: '#1c140e', roughness: 0.7, pattern: 'hair', patternScale: 5 },
  jumpsuit: { color: '#cf5f1a', roughness: 0.85, pattern: 'fabric', patternScale: 260, patternStrength: 0.7, sheen: 0.55 },
  jumpsuitDark: { color: '#a8491a', roughness: 0.85, pattern: 'fabric', patternScale: 260, sheen: 0.5 },
  blood: { color: '#4a0707', roughness: 0.3 },
  shoes: { color: '#b9b5ad', roughness: 0.75, pattern: 'rubber', patternScale: 30 },
  sole: { color: '#2a2a2a', roughness: 0.8 },
  patch: { color: '#ffffff', roughness: 0.8 },
  undershirt: { color: '#d8d2c6', roughness: 0.85, pattern: 'fabric', patternScale: 300 },
});
function dclassGear(o) {
  const parts = [
    P('Collar', { type: 'torus', radius: 0.066, tube: 0.018, radialSegments: 8, tubularSegments: 24, arc: 360, tubeScaleY: 1.3 }, 'jumpsuit', { bones: ['chest', 'neck'], falloff: 6 }, { p: [0, 1.5, 0.006], r: [14, 0, 0] }),
    P('Undershirt V', rbox(0.06, 0.07, 0.01, 0.003), 'undershirt', { bone: 'chest' }, { p: [0, 1.47, 0.083], r: [-20, 0, 0] }),
    P('Number Patch', rbox(0.1, 0.05, 0.004, 0), 'patch', { bone: 'chest' }, { p: [0.075, 1.38, 0.104], r: [-6, 12, 0] }),
    P('Back Stencil', rbox(0.18, 0.09, 0.004, 0), 'patch', { bone: 'chest' }, { p: [0, 1.36, -0.1], r: [0, 180, 0] }),
    P('Chest Pocket', rbox(0.08, 0.07, 0.006, 0.002), 'jumpsuitDark', { bone: 'chest' }, { p: [-0.075, 1.36, 0.1], r: [-6, -12, 0] }),
    P('Waist Seam', sq(0.16, 0.012, 0.106, 0.12, 0.62, { widthSegments: 32, heightSegments: 4 }), 'jumpsuitDark', { bones: ['hips', 'spine'], falloff: 8 }, { p: [0, 1.04, 0] }),
    P('Cuff', cyl(0.06, 0.062, 0.05, 16, false), 'jumpsuitDark', { bone: 'shin.L' }, { mirror: true, p: [0.11, 0.2, -0.008] }),
    P('Shoe', sq(0.048, 0.042, 0.12, 0.6, 0.78), 'shoes', { bones: ['foot.L', 'toe.L'], falloff: 6 }, { mirror: true, p: [0.113, 0.06, 0.05], m: [{ type: 'squash', axis: 'y', min: -0.04, max: 1 }] }),
    P('Shoe Sole', rbox(0.084, 0.018, 0.23, 0.008), 'sole', { bones: ['foot.L', 'toe.L'], falloff: 6 }, { mirror: true, p: [0.113, 0.01, 0.05] }),
    P('Ankle', cyl(0.042, 0.046, 0.08, 14, false), 'skin', { bones: ['shin.L', 'foot.L'], falloff: 8 }, { mirror: true, p: [0.11, 0.13, -0.008] }),
  ];
  if (o.hair === 'buzz') parts.push(P('Buzz', sq(0.095, 0.112, 0.104, 0.78, 0.9, { thetaLength: 85 }), 'hair', { bone: 'head' }, { p: [0, 1.707, 0.008], s: [1.02, 1.01, 1.02], m: [HEAD_PROFILE] }));
  if (o.hair === 'short') parts.push(P('Hair', sq(0.1, 0.118, 0.108, 0.78, 0.9, { thetaLength: 80 }), 'hair', { bone: 'head' }, { p: [0, 1.71, 0.0], m: [HEAD_PROFILE, { type: 'displace', amount: 0.006, scale: 30, seed: 7, octaves: 2 }] }));
  if (o.beard) parts.push(P('Stubble', sq(0.075, 0.055, 0.068, 0.6, 0.85), 'hair', { bone: 'head' }, { p: [0, 1.626, 0.04] }));
  if (o.bloody) parts.push(P('Blood Stain', sq(0.08, 0.1, 0.02, 0.8, 0.8), 'blood', { bone: 'chest' }, { p: [-0.03, 1.3, 0.1], m: [{ type: 'displace', amount: 0.01, scale: 20, seed: 3, octaves: 2 }] }));
  return parts;
}

// ---------------------------------------------------------------- clips (shared per skeleton)
let SHARED_CLIPS = null;
const E = (x, y, z) => quat.fromEuler(quat.create(), x, y, z);
function poseClip(sk, name, keys, { loop = false } = {}) {
  // keys: [{ t, hips:[x,y,z] offset, rot: { bone: [ex,ey,ez] } }]
  const times = [], poses = [];
  for (const kf of keys) {
    sk.resetPose();
    if (kf.hips) sk.pos.set(kf.hips, sk.boneIndex('hips') * 3);
    for (const [b, e] of Object.entries(kf.rot || {})) { const i = sk.boneIndex(b); if (i >= 0) sk.rot.set(E(...e), i * 4); }
    sk.update();
    if (kf.hands) for (const s of ['L', 'R']) applyHandPose(sk, s, kf.hands);
    times.push(kf.t); poses.push(sk.snapshotPose());
  }
  const c = bakePoses(sk, name, times, poses, { loop, posBones: ['hips'] });
  sk.resetPose(); sk.update();
  return c;
}

export function humanClips() {
  if (SHARED_CLIPS) return SHARED_CLIPS;
  const sk = new Skeleton(expandSkeleton(HUMAN_SKELETON));
  const clips = [
    synthesizeIdle(sk, { name: 'Idle', thumbHook: false }),
    synthesizeLocomotion(sk, { name: 'Walk', duration: 1.06, speed: 1.35, stance: 0.6, hipHeight: 0.94, bob: 0.018, center: -0.015 }),
    synthesizeLocomotion(sk, {
      name: 'Run', duration: 0.68, speed: 4.2, stance: 0.36, samples: 20, hipHeight: 0.92, bob: 0.035, bobPhase: 0.18,
      sway: 0.012, lean: 11, pelvisYaw: 9, pelvisRoll: 3, spineCounter: 1.1, stepWidth: 0.09, center: -0.1,
      heelStrike: -6, toeOff: 48, flatStart: 0.2, heelOff: 0.35, swingPitchMid: 30,
      kick: [0, 0.34, -0.16], drive: [0, 0.3, 0.22], armSwing: 38, armBias: -8, armAbduct: 10, elbow: 78, elbowSwing: 22,
      headPitch: 4, handFlex: -15, spineLean: 3, chestLean: 2, hands: 'fist', fingerSwing: 0.04,
    }),
    synthesizeLocomotion(sk, { name: 'Sneak', duration: 1.2, speed: 1.1, stance: 0.62, hipHeight: 0.8, bob: 0.012, lean: 14, center: 0.0, armSwing: 6, stepWidth: 0.13, syncGroup: 'locomotion' }),
  ];
  // deaths: fall backward / crumple forward
  const limp = { curl: [0.3, 0.4, 0.45, 0.5, 0.55], spread: 0.2 };
  clips.push(poseClip(sk, 'DeathBack', [
    { t: 0, rot: {} },
    { t: 0.18, hips: [0, -0.08, 0.02], rot: { spine: [-12, 0, 0], chest: [-14, 0, 0], head: [-20, 0, 0], 'upperArm.L': [-20, 0, 30], 'upperArm.R': [-20, 0, -30] } },
    { t: 0.45, hips: [0, -0.42, -0.2], rot: { hips: [-35, 8, 0], 'thigh.L': [-60, 0, 5], 'thigh.R': [-45, 0, -8], 'shin.L': [85, 0, 0], 'shin.R': [70, 0, 0], spine: [-10, 0, 0], head: [-25, 0, 0], 'upperArm.L': [-80, 0, 40], 'upperArm.R': [-60, 0, -45] } },
    { t: 0.75, hips: [0, -0.8, -0.4], rot: { hips: [-84, 10, 0], 'thigh.L': [-25, 0, 10], 'thigh.R': [-10, 0, -12], 'shin.L': [35, 0, 0], 'shin.R': [10, 0, 0], spine: [4, 0, 0], head: [8, 30, 0], 'upperArm.L': [-40, 0, 70], 'upperArm.R': [-20, 0, -80], 'foreArm.L': [-30, 0, 0], 'foreArm.R': [-50, 0, 0] }, hands: limp },
    { t: 1.1, hips: [0, -0.85, -0.42], rot: { hips: [-88, 10, 0], 'thigh.L': [-22, 0, 10], 'thigh.R': [-6, 0, -14], 'shin.L': [30, 0, 0], 'shin.R': [6, 0, 0], spine: [2, 0, 0], head: [4, 35, 0], 'upperArm.L': [-30, 0, 78], 'upperArm.R': [-12, 0, -82], 'foreArm.L': [-25, 0, 0], 'foreArm.R': [-40, 0, 0], 'foot.L': [30, 0, 0], 'foot.R': [40, 0, 0] }, hands: limp },
  ]));
  clips.push(poseClip(sk, 'DeathFwd', [
    { t: 0, rot: {} },
    { t: 0.2, hips: [0, -0.2, 0.05], rot: { spine: [20, 0, 0], chest: [15, 0, 0], head: [20, 0, 0], 'thigh.L': [-30, 0, 0], 'thigh.R': [-20, 0, 0], 'shin.L': [45, 0, 0], 'shin.R': [35, 0, 0] } },
    { t: 0.45, hips: [0, -0.55, 0.3], rot: { hips: [45, -6, 0], spine: [15, 0, 0], 'thigh.L': [-70, 0, 0], 'thigh.R': [-60, 0, 0], 'shin.L': [100, 0, 0], 'shin.R': [90, 0, 0], 'upperArm.L': [-70, 0, 10], 'upperArm.R': [-70, 0, -10] } },
    { t: 0.8, hips: [0, -0.84, 0.45], rot: { hips: [86, -8, 0], spine: [3, 0, 0], head: [-10, -40, 0], 'thigh.L': [-8, 0, 8], 'thigh.R': [-16, 0, -6], 'shin.L': [8, 0, 0], 'shin.R': [20, 0, 0], 'upperArm.L': [-20, 0, 60], 'upperArm.R': [-150, 0, -20], 'foreArm.L': [-40, 0, 0], 'foreArm.R': [-20, 0, 0], 'foot.L': [60, 0, 0], 'foot.R': [50, 0, 0] }, hands: limp },
    { t: 1.1, hips: [0, -0.86, 0.46], rot: { hips: [88, -8, 0], spine: [2, 0, 0], head: [-8, -45, 0], 'thigh.L': [-6, 0, 8], 'thigh.R': [-14, 0, -6], 'shin.L': [6, 0, 0], 'shin.R': [18, 0, 0], 'upperArm.L': [-18, 0, 64], 'upperArm.R': [-155, 0, -22], 'foreArm.L': [-40, 0, 0], 'foreArm.R': [-18, 0, 0], 'foot.L': [65, 0, 0], 'foot.R': [55, 0, 0] }, hands: limp },
  ]));
  // seated (helicopter bench)
  clips.push(poseClip(sk, 'Sit', [
    { t: 0, hips: [0, -0.46, -0.05], rot: { hips: [0, 0, 0], spine: [10, 0, 0], chest: [4, 0, 0], head: [6, 0, 0], 'thigh.L': [-88, 0, 8], 'thigh.R': [-88, 0, -8], 'shin.L': [84, 0, 0], 'shin.R': [84, 0, 0], 'foot.L': [4, 0, 0], 'foot.R': [4, 0, 0] } },
    { t: 2, hips: [0, -0.465, -0.05], rot: { hips: [0, 0, 0], spine: [12, 0, 0], chest: [5, 0, 0], head: [8, 0, 0], 'thigh.L': [-88, 0, 8], 'thigh.R': [-88, 0, -8], 'shin.L': [84, 0, 0], 'shin.R': [84, 0, 0], 'foot.L': [4, 0, 0], 'foot.R': [4, 0, 0] } },
  ], { loop: true }));
  // Class-D melee swing (overhead, right arm)
  clips.push(poseClip(sk, 'Swing', [
    { t: 0, rot: {} },
    { t: 0.22, hips: [0, -0.03, 0], rot: { spine: [-6, -20, 0], chest: [-8, -15, 0], 'upperArm.R': [-160, 0, -10], 'foreArm.R': [-60, 0, 0], 'upperArm.L': [-30, 0, 20], 'thigh.L': [-20, 0, 0], 'shin.L': [20, 0, 0] }, hands: HAND_POSES.fist },
    { t: 0.4, hips: [0, -0.06, 0.08], rot: { spine: [18, 25, 0], chest: [15, 20, 0], 'upperArm.R': [-40, 0, 10], 'foreArm.R': [-10, 0, 0], 'upperArm.L': [-10, 0, 25], 'thigh.L': [-35, 0, 0], 'shin.L': [30, 0, 0] }, hands: HAND_POSES.fist },
    { t: 0.8, rot: { spine: [4, 5, 0], 'upperArm.R': [-10, 0, 0], 'foreArm.R': [-20, 0, 0] }, hands: HAND_POSES.fist },
  ]));
  // flinch (played briefly on hits)
  clips.push(poseClip(sk, 'Flinch', [
    { t: 0, rot: {} },
    { t: 0.08, hips: [0, -0.03, -0.04], rot: { spine: [-8, 6, 4], chest: [-10, 8, 0], head: [-14, -10, 0] } },
    { t: 0.3, rot: {} },
  ]));
  // cowering Class-D / panic idle (hands up)
  clips.push(poseClip(sk, 'Surrender', [
    { t: 0, hips: [0, -0.02, 0], rot: { spine: [6, 0, 0], head: [10, 0, 0], 'upperArm.L': [-10, 0, 150], 'upperArm.R': [-10, 0, -150], 'foreArm.L': [0, 0, 50], 'foreArm.R': [0, 0, -50] }, hands: HAND_POSES.flat },
    { t: 1.5, hips: [0, -0.03, 0], rot: { spine: [8, 3, 0], head: [12, 8, 0], 'upperArm.L': [-12, 0, 148], 'upperArm.R': [-12, 0, -148], 'foreArm.L': [0, 0, 55], 'foreArm.R': [0, 0, -55] }, hands: HAND_POSES.flat },
    { t: 3, hips: [0, -0.02, 0], rot: { spine: [6, 0, 0], head: [10, 0, 0], 'upperArm.L': [-10, 0, 150], 'upperArm.R': [-10, 0, -150], 'foreArm.L': [0, 0, 50], 'foreArm.R': [0, 0, -50] }, hands: HAND_POSES.flat },
  ], { loop: true }));
  SHARED_CLIPS = clips;
  return clips;
}

// ---------------------------------------------------------------- factories
function makeCharacter(name, materials, parts, textures) {
  const def = { name, skeleton: HUMAN_SKELETON, materials, parts, clips: [] };
  const ch = new Character(def);
  for (const c of humanClips()) ch.mixer.addClip(c);
  for (const [mat, tex] of Object.entries(textures || {})) { const m = ch.material(mat); m.texture = tex; }
  mergeCharacter(ch);
  ch.cullRadius = 1.4;
  return ch;
}

export function createOperator(o = {}) {
  const mats = MTF_MATERIALS(o.skin);
  const parts = [...bodyParts({ top: 'camoTop', pants: 'camoPants', hands: 'gloves' }), ...mtfGear(o)];
  const ch = makeCharacter(o.name || 'Operator', mats, parts, { patch: mtfPatch(), tape: signTexture('MTF ε-11', { w: 512, h: 160, bg: '#1b1f23', fg: '#cfd8de', size: 96, border: false, grime: 0.05, center: true }) });
  ch.kind = 'mtf';
  return ch;
}

export function createClassD(o = {}) {
  const mats = DCLASS_MATERIALS(o.skin);
  const parts = [...bodyParts({ top: 'jumpsuit', pants: 'jumpsuit', hands: 'skin' }), ...dclassGear(o)];
  const num = o.number || String(1000 + Math.floor(Math.random() * 8999));
  const ch = makeCharacter('D-' + num, mats, parts, { patch: dClassPatch(num) });
  ch.kind = 'dclass';
  ch.number = num;
  return ch;
}

// ---------------------------------------------------------------- aim rig
// Holds `weaponId` with both hands. mode: 'aim' | 'low' | 'sit' | 'none'. pitch in radians (+up), yaw: upper-body twist.
const _q = quat.create();
export function applyAim(ch, weaponId, { pitch = 0, yaw = 0, mode = 'aim', recoil = 0 } = {}) {
  const sk = ch.skeleton, def = WEAPONS[weaponId];
  if (!def || mode === 'none') return null;
  const idx = (n) => sk.boneIndex(n);
  const deg = 180 / Math.PI;
  const P0 = mode === 'sit' ? -55 : mode === 'low' ? -28 : 0;
  const pd = (mode === 'aim' ? pitch * deg : 0) + P0;
  // twist the spine toward the aim direction, bend it for pitch
  const mul = (bone, e) => { const i = idx(bone); const q = quat.multiply(quat.create(), sk.rot.subarray(i * 4, i * 4 + 4), E(...e)); sk.rot.set(quat.normalize(q, q), i * 4); };
  const aimPitch = mode === 'aim' ? -pitch * deg : 0;
  mul('spine', [aimPitch * 0.3, yaw * deg * 0.4, 0]);
  mul('chest', [aimPitch * 0.3, yaw * deg * 0.4, 0]);
  sk.update();
  // weapon: anchored at the right shoulder pocket, pointing along the chest's forward
  const ci = idx('chest');
  const cq = sk.worldRotation(ci, quat.create());
  const ch0 = sk.worldHead(ci);
  const pistol = def.pistol;
  const off = pistol ? [-0.03, 0.16 - recoil * 0.02, 0.42] : mode === 'sit' ? [-0.06, 0.02, 0.24] : mode === 'low' ? [-0.1, 0.04, 0.28] : [-0.105, 0.14, 0.27 - recoil * 0.04];
  const gq = quat.multiply(quat.create(), cq, E(-pd * (mode === 'aim' ? 0.4 : 1) - recoil * 6, pistol ? 0 : -4, pistol ? 0 : 6));
  const gp = vec3.transformQuat([0, 0, 0], off, cq);
  vec3.add(gp, gp, ch0);
  const weapon = { p: gp, q: gq };
  // hands
  const hand = (side, g, pole, pose) => {
    const hq = quat.multiply(quat.create(), gq, E(...g.r));
    const hp = vec3.add([0, 0, 0], gp, vec3.transformQuat([0, 0, 0], g.p, gq));
    twoBoneIK(sk, idx('upperArm.' + side), idx('foreArm.' + side), idx('hand.' + side), hp, pole);
    setWorldRotation(sk, idx('hand.' + side), hq);
    applyHandPose(sk, side, pose);
  };
  hand('R', def.grip, [-1, -1.2, -0.4], { curl: [0.5, 0.2, 0.85, 0.9, 0.95], spread: 0 });
  hand('L', def.support, pistol ? [0.8, -1.2, -0.2] : [1, -1.2, 0.1], def.supportPose === 'foregrip' ? { curl: [0.45, 0.82, 0.88, 0.92, 0.95], spread: 0 } : { curl: [0.3, 0.58, 0.64, 0.7, 0.74], spread: 0.08 });
  // look along the weapon
  if (mode === 'aim') {
    const hi = idx('head');
    const hq = quat.multiply(quat.create(), cq, E(-pitch * deg * 0.4 + 6, 0, 0));
    setWorldRotation(sk, hi, hq);
  }
  sk.update();
  const m = mat4.fromRTS(mat4.create(), gq, gp, [1, 1, 1]);
  return m; // weapon matrix in character model space
}
