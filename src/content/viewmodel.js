// First-person view model: MTF operator arms (combat shirt, tactical gloves, watch) holding
// one of the modern weapons. Everything is posed procedurally every frame:
//   base pose (hip / ADS / sprint) + bob, sway, recoil springs
//   + keyed actions (reload, inspect, melee, grenade, swap) authored as key poses
//   -> two-bone IK for both arms, hand rotations and finger poses.
// Rig space: the eye is the origin looking down +Z, +Y up, +X left.
import { Character, expandSkeleton, quat, vec3, mat4, Material } from '../../engine/index.js';
import { twoBoneIK, setWorldRotation } from '../../engine/ik.js';
import { applyHandPose, blendHandPoses } from '../../engine/gait.js';
import { sampleKeys, sampleXf, lerpArr, compose } from '../../engine/choreo.js';
import { WEAPONS, WEAPON_MATERIALS, GRENADE_PARTS } from './weapons.js';
import { mergeCharacter, damp, clamp } from '../util.js';

// ---------------------------------------------------------------- arms skeleton
const FINGERS = [
  { name: 'index', z: 0.026, length: 0.082, radius: 0.0098 },
  { name: 'middle', z: 0.009, length: 0.09, radius: 0.0102 },
  { name: 'ring', z: -0.008, length: 0.084, radius: 0.0098 },
  { name: 'pinky', z: -0.024, length: 0.068, radius: 0.0088 },
];
const SH = [0.19, -0.23, 0.02], EL = [SH[0] + 0.005, SH[1] - 0.33, SH[2]], WR = [EL[0] + 0.01, EL[1] - 0.31, EL[2] + 0.005];
const KNUCKLE_Y = WR[1] - 0.09, FINGER_X = WR[0] + 0.01, HAND_Z = WR[2] + 0.005;
const A = (dx, dy, dz) => [WR[0] + dx, WR[1] + dy, WR[2] + dz];

function skeletonFor(def) {
  const muzzle = def.muzzle, seat = def.magSeat;
  return [
    { name: 'root', parent: null, head: [0, 0, 0], tail: [0, 0.1, 0], deform: false },
    { name: 'weapon', parent: 'root', head: [0, 0, 0], tail: [0, 0, 0.1] },
    { name: 'bolt', parent: 'weapon', head: [0, 0.05, -0.1], tail: [0, 0.05, 0] },
    { name: 'slide', parent: 'weapon', head: [0, 0.03, 0], tail: [0, 0.03, 0.1] },
    { name: 'flash', parent: 'weapon', head: [...muzzle], tail: [muzzle[0], muzzle[1], muzzle[2] + 0.05] },
    { name: 'mag', parent: 'root', head: [...seat], tail: [seat[0], seat[1] + 0.05, seat[2]] },
    { name: 'shell', parent: 'root', head: [0, 0, 0], tail: [0, 0, 0.05] },
    { name: 'nade', parent: 'root', head: [0, 0, 0], tail: [0, 0.05, 0] },
    { name: 'upperArm.L', parent: 'root', head: SH, tail: EL, mirror: true },
    { name: 'foreArm.L', parent: 'upperArm.L', head: EL, tail: WR, mirror: true },
    { name: 'hand.L', parent: 'foreArm.L', head: WR, tail: [FINGER_X, KNUCKLE_Y, HAND_Z], mirror: true },
    ...FINGERS.flatMap((f) => {
      const j = KNUCKLE_Y - f.length * 0.55, tip = KNUCKLE_Y - f.length;
      return [
        { name: f.name + '1.L', parent: 'hand.L', head: [FINGER_X, KNUCKLE_Y, HAND_Z + f.z], tail: [FINGER_X, j, HAND_Z + f.z], mirror: true },
        { name: f.name + '2.L', parent: f.name + '1.L', head: [FINGER_X, j, HAND_Z + f.z], tail: [FINGER_X, tip, HAND_Z + f.z], mirror: true },
      ];
    }),
    { name: 'thumb1.L', parent: 'hand.L', head: A(0.002, -0.025, 0.038), tail: A(-0.002, -0.065, 0.056), mirror: true },
    { name: 'thumb2.L', parent: 'thumb1.L', head: A(-0.002, -0.065, 0.056), tail: A(-0.006, -0.102, 0.07), mirror: true },
  ];
}

export const ARM_MATERIALS = {
  sleeve: { color: '#2b3038', roughness: 0.88, pattern: 'camo', patternScale: 9, patternColor: '#3d4550', patternStrength: 0.8, sheen: 0.6 },
  sleeveDark: { color: '#1d2127', roughness: 0.85, pattern: 'fabric', patternScale: 300, sheen: 0.5 },
  glove: { color: '#1d1e20', roughness: 0.7, pattern: 'leather', patternScale: 380, patternColor: '#0c0c0d', sheen: 0.35 },
  gloveKnuckle: { color: '#35373a', roughness: 0.55, pattern: 'rubber', patternScale: 60 },
  gloveTan: { color: '#6f5f48', roughness: 0.8, pattern: 'fabric', patternScale: 400 },
  watchCase: { color: '#141416', roughness: 0.5, pattern: 'rubber', patternScale: 30 },
  watchFace: { color: '#0a0f0c', roughness: 0.2, emissive: '#56ffa0', emissiveStrength: 0.35 },
  velcro: { color: '#2a2e33', roughness: 0.95, pattern: 'felt', patternScale: 200 },
};

const PA = (name, shape, material, bind, o = {}) => ({ name, shape, material, bind, position: o.p || [0, 0, 0], rotation: o.r || [0, 0, 0], scale: [1, 1, 1], modifiers: o.m || [], ...(o.mirror ? { mirror: true } : {}) });
const ARMS = [
  PA('Sleeve', { type: 'tube', path: [[SH[0], SH[1] + 0.05, SH[2]], [SH[0] + 0.004, SH[1] - 0.16, SH[2]], EL, [EL[0] + 0.006, EL[1] - 0.15, EL[2] + 0.003], A(0, 0.045, 0)], radii: [0.062, 0.056, 0.05, 0.046, 0.043], radialSegments: 18, samples: 8, caps: false, flatten: 1, arc: 360, arcOffset: 0, twist: 0 }, 'sleeve', { bones: ['upperArm.L', 'foreArm.L'], falloff: 7 }, { mirror: true, m: [{ type: 'displace', amount: 0.005, scale: 18, seed: 4, octaves: 2 }] }),
  PA('Sleeve Cuff', { type: 'cylinder', radiusTop: 0.045, radiusBottom: 0.046, height: 0.04, radialSegments: 20, heightSegments: 1, capTop: false, capBottom: false, arc: 360 }, 'sleeveDark', { bone: 'foreArm.L' }, { p: A(0, 0.05, 0), mirror: true }),
  PA('Glove Cuff', { type: 'cylinder', radiusTop: 0.036, radiusBottom: 0.031, height: 0.06, radialSegments: 18, heightSegments: 2, capTop: false, capBottom: false, arc: 360 }, 'glove', { bones: ['foreArm.L', 'hand.L'], falloff: 8 }, { p: A(0.002, 0.012, 0.001), mirror: true }),
  PA('Glove Strap', { type: 'box', width: 0.02, height: 0.022, depth: 0.05, bevel: 0.006, bevelSegments: 2 }, 'velcro', { bone: 'foreArm.L' }, { p: A(0.028, 0.02, 0.0), mirror: true }),
  PA('Palm', { type: 'box', width: 0.03, height: 0.094, depth: 0.084, bevel: 0.013, bevelSegments: 3 }, 'glove', { bone: 'hand.L' }, { p: A(0.007, -0.047, 0.003), mirror: true }),
  PA('Knuckle Guard', { type: 'box', width: 0.012, height: 0.03, depth: 0.078, bevel: 0.005, bevelSegments: 2 }, 'gloveKnuckle', { bone: 'hand.L' }, { p: A(0.024, -0.078, 0.003), mirror: true }),
  PA('Back Pad', { type: 'box', width: 0.008, height: 0.04, depth: 0.05, bevel: 0.004, bevelSegments: 2 }, 'gloveTan', { bone: 'hand.L' }, { p: A(0.022, -0.035, 0.0), mirror: true }),
  ...FINGERS.map((f) => PA(f.name + ' Finger', { type: 'capsule', radius: f.radius, length: f.length - f.radius, radialSegments: 12, capSegments: 4 }, 'glove', { bones: ['hand.L', f.name + '1.L', f.name + '2.L'], falloff: 9 }, { p: [FINGER_X, KNUCKLE_Y + 0.004 - (f.length + f.radius) / 2, HAND_Z + f.z], mirror: true })),
  ...FINGERS.map((f) => PA(f.name + ' Pad', { type: 'box', width: 0.006, height: 0.022, depth: 0.017, bevel: 0.003, bevelSegments: 1 }, 'gloveKnuckle', { bone: f.name + '1.L' }, { p: [FINGER_X + 0.009, KNUCKLE_Y - 0.018, HAND_Z + f.z], mirror: true })),
  PA('Thumb', { type: 'capsule', radius: 0.0112, length: 0.06, radialSegments: 12, capSegments: 4 }, 'glove', { bones: ['hand.L', 'thumb1.L', 'thumb2.L'], falloff: 9 }, { p: A(-0.002, -0.065, 0.054), r: [-24, 0, -6], mirror: true }),
  // rugged digital watch on the left wrist
  PA('Watch Band', { type: 'torus', radius: 0.036, tube: 0.004, radialSegments: 8, tubularSegments: 28, arc: 360, tubeScaleY: 2.4 }, 'watchCase', { bone: 'foreArm.L' }, { p: A(0.002, 0.06, 0.001) }),
  PA('Watch Case', { type: 'box', width: 0.012, height: 0.04, depth: 0.042, bevel: 0.006, bevelSegments: 2 }, 'watchCase', { bone: 'foreArm.L' }, { p: A(0.04, 0.06, 0.001) }),
  PA('Watch Face', { type: 'box', width: 0.002, height: 0.026, depth: 0.028, bevel: 0.0008, bevelSegments: 1 }, 'watchFace', { bone: 'foreArm.L' }, { p: A(0.0465, 0.06, 0.001) }),
];

// ---------------------------------------------------------------- hand poses
const POSE = {
  trigger: { curl: [0.5, 0.18, 0.86, 0.92, 0.96], spread: 0 },
  triggerPull: { curl: [0.5, 0.38, 0.86, 0.92, 0.96], spread: 0 },
  supportRail: { curl: [0.3, 0.58, 0.64, 0.7, 0.74], spread: 0.08 },
  foregrip: { curl: [0.45, 0.82, 0.88, 0.92, 0.95], spread: 0 },
  pistolSupport: { curl: [0.1, 0.72, 0.8, 0.85, 0.9], spread: 0.05 },
  relaxed: { curl: [0.2, 0.3, 0.38, 0.45, 0.5], spread: 0.15 },
  grab: { curl: [0.45, 0.62, 0.68, 0.72, 0.76], spread: 0.05 },
  open: { curl: [0.05, 0.08, 0.1, 0.12, 0.14], spread: 0.25 },
  pinch: { curl: [0.35, 0.5, 0.6, 0.85, 0.9], spread: 0 },
  fist: { curl: [0.85, 1, 1, 1, 1], spread: 0 },
  flat: { curl: [0.05, 0.03, 0.03, 0.04, 0.05], spread: 0.1 },
};

// ---------------------------------------------------------------- actions
// Time t in [0,1] (scaled by duration). Weapon keys are additive offsets on the base pose.
const k = (t, v, ease) => ({ t, ...v, ...(ease ? { ease } : {}) });
const W0 = { p: [0, 0, 0], r: [0, 0, 0] };
const onW = (p, r = [0, 0, 0]) => ({ attach: 'weapon', p, r });
const onRig = (p, r = [0, 0, 0]) => ({ attach: 'world', p, r });
const onHandL = (p, r = [0, 0, 0]) => ({ attach: 'hand.L', p, r });
const onHandR = (p, r = [0, 0, 0]) => ({ attach: 'hand.R', p, r });

// Built per weapon, because grip positions and mag seats differ.
function buildActions(def) {
  const S = def.magSeat, G = def.grip, SUP = def.support;
  const gripR = onW(G.p, G.r), gripL = onW(SUP.p, SUP.r);
  const seat = onW(S, [0, 0, 0]);
  const pouch = [0.16, -0.55, 0.12]; // left vest pouch (rig space)
  const magInHand = onHandL([-0.028, -0.07, 0.01], [0, 0, 80]);
  const acts = {};

  // --- rifle reload (M4 / SCAR / M110): drop, fetch, seat, (bolt catch)
  const rifle = (empty) => ({
    weapon: [k(0, W0), k(0.12, { p: [0.02, 0.02, -0.02], r: [8, -6, -24] }), k(0.5, { p: [0.03, 0.01, -0.03], r: [10, -8, -28] }), k(0.6, { p: [0.03, 0.03, -0.03], r: [13, -8, -30] }, 'snap'), k(0.64, { p: [0.03, 0.015, -0.03], r: [9, -8, -28] }),
      ...(empty ? [k(0.74, { p: [0.03, 0.012, -0.03], r: [9, -12, -24] }), k(0.78, { p: [0.03, 0.02, -0.035], r: [6, -12, -22] }, 'snap')] : []), k(0.92, { p: [0, -0.004, 0], r: [1, 0, 0] }), k(1, W0)],
    handL: [k(0, gripL), k(0.14, onW([0.03, S[1] - 0.09, S[2] + 0.02], [-10, 10, -70])), k(0.2, onW([0.03, S[1] - 0.1, S[2] + 0.02], [-10, 10, -70])),
      k(0.36, onRig(pouch, [-20, 0, -40])), k(0.42, onRig(pouch, [-20, 0, -40])),
      k(0.54, onW([0.035, S[1] - 0.2, S[2] + 0.01], [-4, 8, -70])), k(0.6, onW([0.035, S[1] - 0.105, S[2] + 0.01], [-4, 8, -70]), 'in'), k(0.66, onW([0.03, S[1] - 0.12, S[2] + 0.01], [-4, 8, -70])),
      ...(empty ? [k(0.73, onW([0.04, 0.0, 0.03], [0, 30, -80])), k(0.77, onW([0.034, 0.0, 0.02], [0, 30, -80]), 'snap')] : []),
      k(0.88, gripL), k(1, gripL)],
    fingersL: [k(0, { pose: POSE[def.supportPose] }), k(0.12, { pose: POSE.open }), k(0.18, { pose: POSE.grab }), k(0.24, { pose: POSE.open }), k(0.4, { pose: POSE.grab }), k(0.6, { pose: POSE.grab }), k(0.66, { pose: POSE.flat }), ...(empty ? [k(0.74, { pose: POSE.fist })] : []), k(0.88, { pose: POSE[def.supportPose] })],
    mag: [k(0, seat), k(0.2, seat), k(0.23, onW([S[0], S[1] - 0.04, S[2] + 0.01], [6, 0, 0]), 'linear'), k(0.34, onRig([-0.02, -1.1, 0.35], [70, 20, 30]), 'in'), k(0.35, onRig([0.3, -1.5, 0.1])), k(0.38, onRig([0.2, -0.7, 0.1])), k(0.42, magInHand), k(0.5, magInHand), k(0.55, onW([S[0], S[1] - 0.075, S[2]], [4, 0, 0])), k(0.6, seat, 'in'), k(1, seat)],
    bolt: empty ? [k(0, { v: 0 }), k(1, { v: 0 })] : [k(0, { v: 0 })],
    events: [{ t: 0.22, name: 'magOut' }, { t: 0.6, name: 'magIn' }, ...(empty ? [{ t: 0.77, name: 'boltRelease' }] : [])],
  });
  acts.reload = rifle(false); acts.reloadEmpty = rifle(true);

  // --- MP7 / pistols: mag lives in the grip
  const gripMag = (empty, pistol) => ({
    weapon: [k(0, W0), k(0.12, { p: [0.03, 0.03, -0.03], r: [14, -10, -20] }), k(0.5, { p: [0.035, 0.03, -0.04], r: [16, -12, -24] }), k(0.58, { p: [0.035, 0.05, -0.04], r: [20, -12, -24] }, 'snap'), k(0.62, { p: [0.035, 0.032, -0.04], r: [15, -12, -24] }),
      ...(empty ? [k(0.72, { p: [0.03, 0.03, -0.02], r: [10, -18, -10] }), k(0.82, { p: [0.02, 0.03, 0.0], r: [8, -10, -6] })] : []), k(0.92, { p: [0, -0.004, 0], r: [1, 0, 0] }), k(1, W0)],
    handL: [k(0, gripL), k(0.12, onRig([0.14, -0.25, 0.18], [-10, 0, -40])), k(0.36, onRig(pouch, [-20, 0, -40])), k(0.42, onRig(pouch, [-20, 0, -40])),
      k(0.52, onW([0.03, -0.2, -0.02], [-60, 0, -40])), k(0.58, onW([0.02, -0.13, -0.03], [-60, 0, -40]), 'in'), k(0.64, onW([0.02, -0.15, -0.03], [-60, 0, -40])),
      ...(empty ? (pistol
        ? [k(0.72, onW([0.02, 0.05, -0.03], [-20, 70, -90])), k(0.76, onW([0.02, 0.05, -0.02], [-20, 70, -90])), k(0.82, onW([0.02, 0.05, -0.08], [-20, 70, -90]), 'in'), k(0.85, onW([0.03, 0.06, -0.05], [-20, 70, -90]), 'snap')]
        : [k(0.72, onW([0.03, 0.09, -0.12], [-30, 60, -90])), k(0.76, onW([0.02, 0.08, -0.12], [-30, 60, -90])), k(0.82, onW([0.02, 0.08, -0.18], [-30, 60, -90]), 'in'), k(0.85, onW([0.03, 0.1, -0.15], [-30, 60, -90]), 'snap')])
        : []),
      k(0.92, gripL), k(1, gripL)],
    fingersL: [k(0, { pose: POSE[def.supportPose] }), k(0.12, { pose: POSE.relaxed }), k(0.36, { pose: POSE.grab }), k(0.58, { pose: POSE.grab }), k(0.62, { pose: POSE.flat }), ...(empty ? [k(0.74, { pose: POSE.pinch }), k(0.85, { pose: POSE.open })] : []), k(0.92, { pose: POSE[def.supportPose] })],
    mag: [k(0, seat), k(0.14, seat), k(0.18, onW([S[0], S[1] - 0.06, S[2] - 0.02]), 'linear'), k(0.32, onRig([0.0, -1.2, 0.3], [40, 10, 20]), 'in'), k(0.33, onRig([0.3, -1.5, 0.1])), k(0.38, onRig([0.2, -0.7, 0.1])), k(0.42, onHandL([-0.03, -0.06, 0.02], [0, 0, 100])), k(0.5, onHandL([-0.03, -0.06, 0.02], [0, 0, 100])), k(0.53, onW([S[0], S[1] - 0.07, S[2] - 0.02])), k(0.58, seat, 'in'), k(1, seat)],
    slide: empty ? [k(0, { v: 1 }), k(0.76, { v: 1 }), k(0.82, { v: 1.25 }, 'in'), k(0.85, { v: 0 }, 'snap'), k(1, { v: 0 })] : [k(0, { v: 0 })],
    bolt: empty && !pistol ? [k(0, { v: 0 }), k(0.76, { v: 0 }), k(0.82, { v: 1 }, 'in'), k(0.85, { v: 0 }, 'snap')] : [k(0, { v: 0 })],
    events: [{ t: 0.16, name: 'magOut' }, { t: 0.58, name: 'magIn' }, ...(empty ? [{ t: 0.84, name: 'boltRelease' }] : [])],
  });
  if (def.reloadStyle === 'gripMag') { acts.reload = gripMag(false, false); acts.reloadEmpty = gripMag(true, false); }
  if (def.reloadStyle === 'pistol') { acts.reload = gripMag(false, true); acts.reloadEmpty = gripMag(true, true); }

  // --- shotgun: start, per-shell loop, end (and chamber-load when empty)
  if (def.reloadStyle === 'shotgun') {
    const port = [0, -0.012, 0.08];
    const saddle = [0.05, 0.03, 0.06];
    acts.loadStart = { weapon: [k(0, W0), k(1, { p: [0.02, 0.03, -0.02], r: [10, -6, -30] })], handL: [k(0, gripL), k(1, onW([0.05, -0.04, 0.12], [-40, 0, -70]))], fingersL: [k(0, { pose: POSE.supportRail }), k(1, { pose: POSE.relaxed })], shell: [k(0, onRig([0, -2, 0]))] };
    const hold = { weapon: [k(0, { p: [0.02, 0.03, -0.02], r: [10, -6, -30] })] };
    acts.loadShell = {
      ...hold,
      weapon: [k(0, { p: [0.02, 0.03, -0.02], r: [10, -6, -30] }), k(0.62, { p: [0.02, 0.03, -0.02], r: [10, -6, -30] }), k(0.7, { p: [0.02, 0.045, -0.02], r: [12, -6, -31] }, 'snap'), k(1, { p: [0.02, 0.03, -0.02], r: [10, -6, -30] })],
      handL: [k(0, onW([0.05, -0.04, 0.12], [-40, 0, -70])), k(0.3, onW([saddle[0] + 0.02, saddle[1] - 0.02, saddle[2]], [-80, 0, -30])), k(0.4, onW([saddle[0] + 0.02, saddle[1] - 0.03, saddle[2]], [-80, 0, -30])), k(0.58, onW([0.02, port[1] - 0.06, port[2] - 0.02], [-60, 0, -80])), k(0.68, onW([0.015, port[1] - 0.035, port[2] + 0.02], [-60, 0, -80]), 'in'), k(1, onW([0.05, -0.04, 0.12], [-40, 0, -70]))],
      fingersL: [k(0, { pose: POSE.relaxed }), k(0.35, { pose: POSE.pinch }), k(0.68, { pose: POSE.pinch }), k(0.75, { pose: POSE.relaxed })],
      shell: [k(0, onRig([0, -2, 0])), k(0.38, onRig([0, -2, 0]), 'hold'), k(0.39, onHandL([-0.02, -0.075, 0.02], [90, 0, 0])), k(0.6, onHandL([-0.02, -0.075, 0.02], [90, 0, 0])), k(0.68, onW([port[0], port[1] + 0.005, port[2] + 0.03], [-10, 0, 0]), 'in'), k(0.7, onW([port[0], port[1] + 0.02, port[2] + 0.05], [-10, 0, 0])), k(0.71, onRig([0, -2, 0]), 'hold')],
      events: [{ t: 0.66, name: 'shellIn' }],
    };
    acts.loadEnd = { weapon: [k(0, { p: [0.02, 0.03, -0.02], r: [10, -6, -30] }), k(0.7, { p: [0, -0.004, 0], r: [1, 0, 0] }), k(1, W0)], handL: [k(0, onW([0.05, -0.04, 0.12], [-40, 0, -70])), k(0.7, gripL), k(1, gripL)], fingersL: [k(0, { pose: POSE.relaxed }), k(0.7, { pose: POSE.supportRail })], shell: [k(0, onRig([0, -2, 0]))] };
    // empty: drop a shell straight into the ejection port, then hit the bolt release
    acts.loadChamber = {
      weapon: [k(0, W0), k(0.2, { p: [0.0, 0.03, -0.02], r: [8, 10, 40] }), k(0.62, { p: [0.0, 0.03, -0.02], r: [8, 10, 40] }), k(0.7, { p: [0.0, 0.04, -0.03], r: [6, 8, 36] }, 'snap'), k(1, { p: [0.02, 0.03, -0.02], r: [10, -6, -30] })],
      handL: [k(0, gripL), k(0.25, onW([saddle[0] + 0.02, saddle[1] - 0.02, saddle[2]], [-80, 0, -30])), k(0.32, onW([saddle[0] + 0.02, saddle[1] - 0.03, saddle[2]], [-80, 0, -30])), k(0.5, onW([-0.02, 0.09, 0.09], [-150, 0, 20])), k(0.58, onW([-0.02, 0.07, 0.09], [-150, 0, 20]), 'in'), k(0.68, onW([0.03, 0.0, 0.03], [0, 30, -80])), k(0.72, onW([0.025, 0.0, 0.025], [0, 30, -80]), 'snap'), k(1, onW([0.05, -0.04, 0.12], [-40, 0, -70]))],
      fingersL: [k(0, { pose: POSE.supportRail }), k(0.28, { pose: POSE.pinch }), k(0.58, { pose: POSE.pinch }), k(0.62, { pose: POSE.relaxed }), k(0.68, { pose: POSE.fist }), k(0.8, { pose: POSE.relaxed })],
      shell: [k(0, onRig([0, -2, 0])), k(0.3, onRig([0, -2, 0]), 'hold'), k(0.31, onHandL([-0.02, -0.075, 0.02], [90, 0, 0])), k(0.5, onHandL([-0.02, -0.075, 0.02], [90, 0, 0])), k(0.58, onW([-0.02, 0.04, 0.09], [0, 0, 0]), 'in'), k(0.6, onRig([0, -2, 0]), 'hold')],
      bolt: [k(0, { v: 1 }), k(0.7, { v: 1 }), k(0.72, { v: 0 }, 'snap')],
      events: [{ t: 0.58, name: 'shellIn' }, { t: 0.72, name: 'boltRelease' }],
    };
  }

  // --- inspect: show the left side, then roll to the right, check the chamber
  acts.inspect = {
    weapon: [k(0, W0), k(0.15, { p: [0.08, 0.04, -0.04], r: [-5, -35, 25] }), k(0.4, { p: [0.08, 0.045, -0.04], r: [-8, -38, 28] }), k(0.55, { p: [0.03, 0.05, -0.02], r: [-10, 40, -55] }), k(0.82, { p: [0.03, 0.05, -0.02], r: [-12, 42, -58] }), k(0.95, { p: [0, -0.004, 0], r: [1, 0, 0] }), k(1, W0)],
    handL: [k(0, gripL), k(0.12, gripL), k(0.3, onW([0.03, 0.06, def.pistol ? -0.05 : 0.0], [-30, 60, -90])), k(0.38, onW([0.03, 0.06, def.pistol ? -0.09 : -0.06], [-30, 60, -90])), k(0.45, onW([0.03, 0.07, def.pistol ? -0.05 : 0.0], [-30, 60, -90]), 'snap'), k(0.55, gripL), k(1, gripL)],
    fingersL: [k(0, { pose: POSE[def.supportPose] }), k(0.26, { pose: POSE.pinch }), k(0.46, { pose: POSE.pinch }), k(0.55, { pose: POSE[def.supportPose] })],
    slide: def.pistol ? [k(0, { v: 0 }), k(0.3, { v: 0 }), k(0.38, { v: 0.45 }), k(0.45, { v: 0 }, 'snap')] : [k(0, { v: 0 })],
    bolt: !def.pistol ? [k(0, { v: 0 }), k(0.3, { v: 0 }), k(0.38, { v: 0.45 }), k(0.45, { v: 0 }, 'snap')] : [k(0, { v: 0 })],
  };
  // --- melee: butt-stroke / pistol whip
  acts.melee = {
    weapon: [k(0, W0), k(0.25, { p: [0.08, 0.06, -0.08], r: [-10, -30, 40] }), k(0.45, { p: [-0.1, 0.02, 0.2], r: [10, 45, -30] }, 'snap'), k(0.62, { p: [-0.08, 0.0, 0.14], r: [8, 40, -26] }), k(1, W0)],
    handL: [k(0, gripL), k(1, gripL)], events: [{ t: 0.42, name: 'hit' }],
  };
  // --- grenade: left hand pulls the pin and throws
  acts.grenade = {
    weapon: [k(0, W0), k(0.2, { p: [-0.04, -0.06, -0.04], r: [6, 12, 20] }), k(0.8, { p: [-0.04, -0.06, -0.04], r: [6, 12, 20] }), k(1, W0)],
    handL: [k(0, gripL), k(0.18, onRig([0.14, -0.42, 0.15], [-20, 0, -40])), k(0.3, onRig([0.12, -0.18, 0.28], [-60, 20, -20])), k(0.5, onRig([0.26, 0.02, -0.02], [-150, 10, -10])), k(0.62, onRig([0.02, 0.0, 0.5], [-60, 0, 0]), 'snap'), k(0.72, onRig([-0.04, -0.2, 0.4], [-30, 0, 0])), k(0.9, gripL), k(1, gripL)],
    fingersL: [k(0, { pose: POSE[def.supportPose] }), k(0.2, { pose: POSE.grab }), k(0.6, { pose: POSE.grab }), k(0.64, { pose: POSE.open }), k(0.9, { pose: POSE[def.supportPose] })],
    nade: [k(0, onRig([0, -3, 0])), k(0.18, onRig([0, -3, 0]), 'hold'), k(0.19, onHandL([-0.035, -0.07, 0.01])), k(0.61, onHandL([-0.035, -0.07, 0.01])), k(0.62, onRig([0, -3, 0]), 'hold')],
    events: [{ t: 0.32, name: 'pin' }, { t: 0.62, name: 'throw' }],
  };
  // --- swap
  acts.lower = { weapon: [k(0, W0), k(1, { p: [0.02, -0.28, -0.05], r: [40, 10, -10] }, 'in')] };
  acts.raise = { weapon: [k(0, { p: [0.02, -0.28, -0.05], r: [40, 10, -10] }), k(1, W0, 'out')] };
  return acts;
}

// ---------------------------------------------------------------- the view model
const DUR = { inspect: 4.2, melee: 0.55, grenade: 1.1, lower: 0.22, raise: 0.32, loadStart: 0.35, loadShell: 0.52, loadEnd: 0.45, loadChamber: 1.25 };

export class ViewModel {
  constructor() {
    this.rigs = {};
    this.current = null;
    this.materials = new Map();
    this.state = { ads: 0, sprint: 0, crouch: 0, bob: 0, bobAmp: 0, sway: [0, 0], swayV: [0, 0], recoil: { p: [0, 0, 0], v: [0, 0, 0], r: [0, 0, 0], rv: [0, 0, 0] }, land: 0, breathe: 0, fireFlash: 0, boltT: 1, trig: 0, lean: 0 };
    this.action = null; // { name, t, dur, keys, onEvent, done }
    this.listeners = [];
    this.lightOn = false;
    this.slideLocked = false; this.boltLocked = false;
  }
  on(fn) { this.listeners.push(fn); }
  emit(e) { for (const f of this.listeners) f(e); }

  // shared material instances (the light lens toggles, reticles glow)
  _materials() {
    const out = {};
    for (const [k2, m] of Object.entries({ ...WEAPON_MATERIALS, ...ARM_MATERIALS })) {
      if (!this.materials.has(k2)) this.materials.set(k2, new Material({ name: k2, ...m }));
      out[k2] = this.materials.get(k2);
    }
    return out;
  }
  build(id) {
    if (this.rigs[id]) return this.rigs[id];
    const def = WEAPONS[id];
    const parts = [...def.parts(), ...ARMS, ...GRENADE_PARTS];
    const ch = new Character({ name: 'VM ' + id, skeleton: skeletonFor(def), materials: {}, parts: [] });
    const mats = this._materials();
    ch.materials = new Map(Object.entries(mats));
    parts.forEach((p) => ch.addPart(p, false));
    mergeCharacter(ch);
    for (const m of ch.merged) m.castShadow = false;
    ch.autoAnimate = false; ch.springs = false;
    const sk = ch.skeleton;
    const idx = (n) => sk.boneIndex(n);
    const rig = { id, def, ch, sk, idx, actions: buildActions(def) };
    rig.ads = { p: [-def.sight[0], -def.sight[1], (def.pistol ? 0.32 : def.scope ? 0.2 : 0.15) - def.sight[2]], r: [0, 0, 0] };
    rig.hipPose = { p: [...def.hip], r: [0, 2, def.pistol ? -2 : -7] };
    rig.sprint = def.pistol ? { p: [def.hip[0] + 0.02, def.hip[1] - 0.06, def.hip[2] - 0.06], r: [-35, 10, -10] } : { p: [def.hip[0] + 0.05, def.hip[1] - 0.03, def.hip[2] - 0.05], r: [-12, 42, 26] };
    rig.shoulderR = def.pistol ? [0.02, -0.02, 0.02] : [0.0, -0.04, -0.12];
    this.rigs[id] = rig;
    return rig;
  }
  equip(id) {
    const rig = this.build(id);
    if (this.current) this.current.ch.visible = false;
    this.current = rig; rig.ch.visible = true;
    this.slideLocked = false; this.boltLocked = false;
    return rig;
  }

  // ------------------------------------------------ actions
  play(name, { speed = 1, dur, onDone } = {}) {
    const rig = this.current; if (!rig) return;
    const keys = rig.actions[name]; if (!keys) return;
    const d = dur ?? DUR[name] ?? 1;
    this.action = { name, t: 0, dur: d / speed, keys, onDone, fired: new Set() };
  }
  stopAction() { this.action = null; }
  get busy() { return !!this.action; }

  fire(recoilScale = 1, empty = false) {
    const r = this.current; if (!r) return;
    const [kv, kh] = r.def.recoil;
    const s = this.state.recoil;
    const ads = this.state.ads;
    const m = recoilScale * (1 - ads * 0.45);
    s.v[2] -= (0.9 + kv * 0.5) * m;          // kick back
    s.v[1] += (0.15 + kv * 0.1) * m;
    s.rv[0] -= (40 + kv * 30) * m;            // muzzle rise (deg/s impulse)
    s.rv[1] += (Math.random() - 0.5) * kh * 50 * m;
    s.rv[2] += (Math.random() - 0.5) * kh * 70 * m;
    this.state.fireFlash = 0.045;
    this.state.flashRot = Math.random() * 360;
    this.state.boltT = 0;
    this.state.trig = 1;
    if (empty) { if (r.def.pistol) this.slideLocked = true; else this.boltLocked = r.def.reloadStyle === 'shotgun'; }
  }

  // ------------------------------------------------ per frame
  update(dt, input) {
    const rig = this.current; if (!rig) return;
    const st = this.state, def = rig.def, sk = rig.sk, idx = rig.idx;
    // --- continuous state
    st.ads = damp(st.ads, input.ads ? 1 : 0, 1 / Math.max(0.05, def.adsTime) * 4.2, dt);
    st.sprint = damp(st.sprint, input.sprint ? 1 : 0, 9, dt);
    st.crouch = damp(st.crouch, input.crouch ? 1 : 0, 8, dt);
    const speed = input.speed || 0;
    st.bobAmp = damp(st.bobAmp, Math.min(1.4, speed / 4.5) * (input.grounded ? 1 : 0.2), 8, dt);
    st.bob += dt * (5.2 + speed * 0.95) * (input.sprint ? 1.12 : 1);
    st.breathe += dt;
    st.land = damp(st.land, 0, 6, dt);
    if (input.landed) st.land = Math.min(1, input.landed);
    // sway from look velocity (lags behind the view)
    const lk = input.look || [0, 0];
    const tsx = clamp(-lk[0] * 0.9, -6, 6), tsy = clamp(lk[1] * 0.9, -5, 5);
    st.swayV[0] += ((tsx - st.sway[0]) * 90 - st.swayV[0] * 14) * dt; st.sway[0] += st.swayV[0] * dt;
    st.swayV[1] += ((tsy - st.sway[1]) * 90 - st.swayV[1] * 14) * dt; st.sway[1] += st.swayV[1] * dt;
    // recoil springs
    const R = st.recoil;
    for (let i = 0; i < 3; i++) {
      R.v[i] += (-R.p[i] * 220 - R.v[i] * 24) * dt; R.p[i] += R.v[i] * dt;
      R.rv[i] += (-R.r[i] * 170 - R.rv[i] * 20) * dt; R.r[i] += R.rv[i] * dt;
    }
    R.p[2] = Math.max(-0.12, R.p[2]);
    st.fireFlash -= dt; st.boltT = Math.min(1, st.boltT + dt / 0.07); st.trig = damp(st.trig, 0, 18, dt);

    // --- base pose
    const ads = st.ads * (1 - st.sprint), spr = st.sprint;
    const hip = rig.hipPose, ad = rig.ads, sp = rig.sprint;
    let p = lerpArr(lerpArr(hip.p, ad.p, ads), sp.p, spr);
    let r = lerpArr(lerpArr(hip.r, ad.r, ads), sp.r, spr);
    const bobK = st.bobAmp * (1 - ads * 0.85);
    const ph = st.bob;
    const breath = (1 - ads * 0.7) * (1 + spr);
    p = [
      p[0] + Math.sin(ph) * 0.011 * bobK + Math.sin(st.breathe * 0.9) * 0.0012 * breath - st.sway[0] * 0.0022 * (1 - ads * 0.6),
      p[1] - Math.abs(Math.cos(ph)) * 0.012 * bobK + Math.sin(st.breathe * 1.8) * 0.0016 * breath - st.land * 0.04 - st.crouch * 0.01 + st.sway[1] * 0.0018 * (1 - ads * 0.6),
      p[2] - st.crouch * 0.01,
    ];
    r = [
      r[0] + Math.sin(ph * 2) * 1.2 * bobK + st.sway[1] * 0.9 * (1 - ads * 0.7) + st.land * 6,
      r[1] + Math.sin(ph) * 1.5 * bobK + st.sway[0] * 1.2 * (1 - ads * 0.7),
      r[2] + Math.sin(ph) * 2.2 * bobK + st.sway[0] * 1.6 * (1 - ads * 0.5) + (input.lean || 0) * -8,
    ];
    // recoil on top (smaller while aiming so the sight stays readable)
    p = [p[0] + R.p[0], p[1] + R.p[1] * (1 - ads * 0.4), p[2] + R.p[2] * (1 - ads * 0.35)];
    r = [r[0] + R.r[0] * (1 - ads * 0.3), r[1] + R.r[1], r[2] + R.r[2]];

    // --- action overlay
    const act = this.action;
    let tn = 0, keys = null;
    if (act) {
      const t0 = act.t;
      act.t += dt;
      tn = clamp(act.t / act.dur, 0, 1);
      keys = act.keys;
      for (const e of keys.events || []) if (!act.fired.has(e) && e.t * act.dur <= act.t && e.t * act.dur > t0 - 1e-6) { act.fired.add(e); this.emit({ name: e.name, action: act.name }); }
      if (act.t >= act.dur) { this.action = null; if (/reload|loadChamber/.test(act.name)) { this.slideLocked = false; this.boltLocked = false; } if (act.onDone) act.onDone(act.name); }
    }
    const sampW = (ks) => sampleKeys(ks, tn, (a, b, s) => ({ p: lerpArr(a.p, b.p, s), r: lerpArr(a.r, b.r, s) }));
    if (keys && keys.weapon) { const o = sampW(keys.weapon); p = [p[0] + o.p[0], p[1] + o.p[1], p[2] + o.p[2]]; r = [r[0] + o.r[0], r[1] + o.r[1], r[2] + o.r[2]]; }

    // --- pose the skeleton
    sk.resetPose();
    const wq = quat.fromEuler(quat.create(), r[0], r[1], r[2]);
    sk.pos.set(p, idx('weapon') * 3);
    sk.rot.set(wq, idx('weapon') * 4);
    sk.pos.set(rig.shoulderR, idx('upperArm.R') * 3);
    sk.pos.set([0.0, st.crouch * 0.0, 0], idx('upperArm.L') * 3);
    // bolt / slide travel
    const cyc = st.boltT < 1 ? Math.sin(Math.min(1, st.boltT) * Math.PI) : 0;
    let boltV = keys && keys.bolt ? sampleKeys(keys.bolt, tn, (a, b, s) => a.v + (b.v - a.v) * s) : 0;
    if (!(keys && keys.bolt) && this.boltLocked) boltV = 1;
    let slideV = keys && keys.slide ? sampleKeys(keys.slide, tn, (a, b, s) => a.v + (b.v - a.v) * s) : 0;
    if (!(keys && keys.slide) && this.slideLocked) slideV = 1;
    sk.pos.set([0, 0, (def.boltTravel || 0) * Math.max(boltV, def.pistol ? 0 : cyc * 0.6)], idx('bolt') * 3);
    sk.pos.set([0, 0, (def.slideTravel || 0) * Math.max(slideV, def.pistol ? cyc : 0)], idx('slide') * 3);
    const flashOn = st.fireFlash > 0;
    sk.pos.set([0, 0, flashOn ? 0 : -3], idx('flash') * 3);
    if (flashOn) sk.rot.set(quat.fromEuler(quat.create(), 0, 0, st.flashRot), idx('flash') * 4);
    sk.update();
    const weapon = { p, q: wq };

    // --- arms
    const grip = def.grip, sup = def.support;
    const defR = [{ t: 0, attach: 'weapon', p: grip.p, r: grip.r }];
    const defL = [{ t: 0, attach: 'weapon', p: sup.p, r: sup.r }];
    const hands = {};
    const sprintL = spr > 0.5 && !def.pistol;
    for (const [side, ks, fk, pole] of [['R', (keys && keys.handR) || defR, keys && keys.fingersR, [-0.8, -1.0, -0.2]], ['L', (keys && keys.handL) || defL, keys && keys.fingersL, [1.3, -1.0, -0.3]]]) {
      const x = sampleXf(ks, tn, { weapon, ...hands });
      twoBoneIK(sk, idx('upperArm.' + side), idx('foreArm.' + side), idx('hand.' + side), x.p, pole);
      setWorldRotation(sk, idx('hand.' + side), x.q);
      let pose = fk ? sampleKeys(fk, tn, (a, b, s) => blendHandPoses(a.pose, b.pose, s)) : side === 'R' ? blendHandPoses(POSE.trigger, POSE.triggerPull, st.trig) : POSE[def.supportPose];
      if (side === 'L' && sprintL && !fk) pose = blendHandPoses(pose, POSE.supportRail, 0.5);
      applyHandPose(sk, side, pose);
      sk.update();
      hands['hand.' + side] = { p: sk.worldHead(idx('hand.' + side)), q: sk.worldRotation(idx('hand.' + side)) };
    }
    // --- props: magazine, shell, grenade
    const place = (bone, ks, fallback) => {
      const i = idx(bone), rest = sk.bones[i].head;
      const x = ks ? sampleXf(ks, tn, { weapon, ...hands }) : fallback;
      sk.pos.set([x.p[0] - rest[0], x.p[1] - rest[1], x.p[2] - rest[2]], i * 3);
      sk.rot.set(x.q, i * 4);
    };
    const seatW = compose(weapon, [0, 0, 0], quat.create());
    place('mag', keys && keys.mag, seatW);
    const hidden = { p: [0, -3, 0], q: quat.create() };
    place('shell', keys && keys.shell, hidden);
    place('nade', keys && keys.nade, hidden);
    sk.update();
    // mag bone rest is at the seat, so an attached-to-weapon seat means offset = weapon transform applied to rest
    if (!(keys && keys.mag)) {
      const i = idx('mag'), rest = sk.bones[i].head;
      const wp = vec3.transformQuat([0, 0, 0], rest, wq);
      sk.pos.set([p[0] + wp[0] - rest[0], p[1] + wp[1] - rest[1], p[2] + wp[2] - rest[2]], i * 3);
      sk.rot.set(wq, i * 4);
      sk.update();
    }
    this.weaponPose = weapon;
  }

  // world position of a weapon-local point (muzzle, ejection port), given the rig's world matrix
  weaponPoint(local, rigWorld, out = [0, 0, 0]) {
    const w = this.weaponPose; if (!w) return out;
    const lp = vec3.transformQuat([0, 0, 0], local, w.q);
    const rp = [w.p[0] + lp[0], w.p[1] + lp[1], w.p[2] + lp[2]];
    return vec3.transformMat4(out, rp, rigWorld);
  }
}
