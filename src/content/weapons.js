// Modern firearms built from parametric shapes. Weapon-local space: origin at the top of
// the pistol grip, +Z toward the muzzle, +Y up, +X is the weapon's LEFT side (the engine's
// first-person convention). Every part binds to a bone of the first-person rig:
//   weapon (static body), bolt (charging handle / bolt), slide (pistols), mag, flash, shell.
// The same part lists build the third-person guns carried by NPCs.

export const WEAPON_MATERIALS = {
  anodized: { color: '#1e1f22', roughness: 0.42, metallic: 0.55, pattern: 'metal', patternScale: 3 },
  polymer: { color: '#18191c', roughness: 0.72, pattern: 'rubber', patternScale: 20 },
  grip: { color: '#141517', roughness: 0.8, pattern: 'rubber', patternScale: 60, bump: 2 },
  fde: { color: '#8a7457', roughness: 0.7, pattern: 'rubber', patternScale: 25 },
  fdeMetal: { color: '#9b8565', roughness: 0.5, metallic: 0.25, pattern: 'metal', patternScale: 3 },
  ranger: { color: '#4d5243', roughness: 0.6, metallic: 0.2, pattern: 'metal', patternScale: 3 },
  steel: { color: '#2d2f33', roughness: 0.3, metallic: 1, pattern: 'metal', patternScale: 4 },
  darkSteel: { color: '#131416', roughness: 0.36, metallic: 0.9, pattern: 'metal', patternScale: 4 },
  stainless: { color: '#b3b6ba', roughness: 0.22, metallic: 1, pattern: 'metal', patternScale: 4 },
  brass: { color: '#c9a04a', roughness: 0.26, metallic: 1, pattern: 'metal', patternScale: 1 },
  copper: { color: '#b86c3a', roughness: 0.3, metallic: 1 },
  shellRed: { color: '#8e1a18', roughness: 0.5, pattern: 'rubber', patternScale: 40 },
  slot: { color: '#050505', roughness: 0.9 },
  glass: { color: '#6f8da0', roughness: 0.04, metallic: 0.4, opacity: 0.18, doubleSided: true },
  lens: { color: '#1a2b3a', roughness: 0.05, metallic: 0.6 },
  reticle: { color: '#ff2a1a', emissive: '#ff3018', emissiveStrength: 6, unlit: true, doubleSided: true },
  flash: { color: '#ffb866', emissive: '#ffa040', emissiveStrength: 26, blend: 'add', unlit: true, doubleSided: true },
  lightLens: { color: '#dfe8f0', roughness: 0.05, emissive: '#f4f8ff', emissiveStrength: 0 },
  whiteDot: { color: '#e8e8d8', emissive: '#d9ffd0', emissiveStrength: 1.2, roughness: 0.4 },
  tritium: { color: '#9aff7a', emissive: '#7aff5a', emissiveStrength: 4, roughness: 0.4 },
  nadeBody: { color: '#4a5236', roughness: 0.65, pattern: 'rubber', patternScale: 30 },
};

// ---------------------------------------------------------------- shape helpers
const P = (name, shape, material, bone, o = {}) => ({ name, shape, material, bind: { bone }, position: o.p || [0, 0, 0], rotation: o.r || [0, 0, 0], scale: o.s || [1, 1, 1], modifiers: o.m || [], ...(o.noShadow ? { castShadow: false } : {}) });
const rbox = (w, h, d, bevel = 0.002, segments = 1) => ({ type: 'box', width: w, height: h, depth: d, bevel, bevelSegments: 2, segments });
const cyl = (rt, rb, h, seg = 18, caps = true) => ({ type: 'cylinder', radiusTop: rt, radiusBottom: rb, height: h, radialSegments: seg, heightSegments: 1, capTop: caps, capBottom: caps, arc: 360 });
const torus = (radius, tube, seg = 20) => ({ type: 'torus', radius, tube, radialSegments: 8, tubularSegments: seg, arc: 360, tubeScaleY: 1 });
const sphere = (radius, ws = 14, hs = 10) => ({ type: 'sphere', radius, widthSegments: ws, heightSegments: hs, phiStart: 0, phiLength: 360, thetaStart: 0, thetaLength: 180 });
const lathe = (points, segments = 24) => ({ type: 'lathe', points, segments, arc: 360, smooth: 1 });
const ALONG_Z = [90, 0, 0];
const arr = (count, dz, dy = 0, dx = 0) => ({ type: 'array', count, offsetX: dx, offsetY: dy, offsetZ: dz, rotX: 0, rotY: 0, rotZ: 0, scaleStep: 1 });
const taper = (axis, amount) => ({ type: 'taper', axis, amount, curve: 1 });
const bend = (axis, toward, angle) => ({ type: 'bend', axis, toward, angle });

// Picatinny rail: base + cross slots along Z
function rail(name, mat, x, y, z0, z1, bone = 'weapon', width = 0.021, rot = [0, 0, 0]) {
  const len = z1 - z0, n = Math.max(2, Math.floor(len / 0.0052));
  return [
    P(name, rbox(width, 0.006, len, 0.0012), mat, bone, { p: [x, y, (z0 + z1) / 2], r: rot }),
    P(name + ' Ribs', rbox(width + 0.002, 0.0035, 0.0028, 0.0006), mat, bone, { p: [x, y + 0.004, z0 + 0.003], r: rot, m: [arr(n, 0.0052)] }),
  ];
}
// M-LOK slot row on one side of a handguard
const mlok = (name, x, y, z0, count, spacing = 0.04, rot = [0, 0, 0]) => P(name, rbox(0.0022, 0.009, 0.026, 0.001), 'slot', 'weapon', { p: [x, y, z0], r: rot, m: [arr(count, spacing)] });

function muzzleFlash(z, y, scale = 1) {
  return [
    P('Flash Star', { type: 'extrude', shape: 'star', points: 5, inner: 0.3, radius: 0.06 * scale, teeth: 12, toothDepth: 0.12, depth: 0.002, bevel: 0 }, 'flash', 'flash', { p: [0, y, z + 0.01], noShadow: true }),
    P('Flash Star 2', { type: 'extrude', shape: 'star', points: 4, inner: 0.25, radius: 0.045 * scale, teeth: 12, toothDepth: 0.12, depth: 0.002, bevel: 0 }, 'flash', 'flash', { p: [0, y, z + 0.035], r: [0, 0, 36], noShadow: true }),
    P('Flash Cone', { type: 'cone', radius: 0.028 * scale, height: 0.14 * scale, radialSegments: 10, heightSegments: 1, capBottom: false, arc: 360 }, 'flash', 'flash', { p: [0, y, z + 0.07 * scale], r: ALONG_Z, noShadow: true }),
    ...[0, 1, 2, 3].map((k) => P('Flash Petal ' + k, rbox(0.004, 0.05 * scale, 0.002, 0), 'flash', 'flash', { p: [Math.cos(k * 1.57 + 0.4) * 0.03 * scale, y + Math.sin(k * 1.57 + 0.4) * 0.03 * scale, z + 0.02], r: [0, 0, k * 90 + 23 + 90], noShadow: true })),
  ];
}

// Weapon light (hand-held style) on a side rail
const weaponLight = (x, y, z, bone = 'weapon') => [
  P('Light Body', cyl(0.0115, 0.0115, 0.075, 16), 'anodized', bone, { p: [x, y, z], r: ALONG_Z }),
  P('Light Head', cyl(0.0145, 0.0125, 0.028, 18), 'anodized', bone, { p: [x, y, z + 0.05], r: ALONG_Z }),
  P('Light Lens', cyl(0.0125, 0.0125, 0.002, 18), 'lightLens', bone, { p: [x, y, z + 0.065], r: ALONG_Z, noShadow: true }),
  P('Light Mount', rbox(0.012, 0.014, 0.03, 0.002), 'anodized', bone, { p: [x * 0.6, y + 0.006, z], r: [0, 0, 0] }),
  P('Light Switch', rbox(0.008, 0.006, 0.014, 0.002), 'polymer', bone, { p: [x, y + 0.012, z - 0.03] }),
];

// Holographic sight (EOTech-style)
function holoSight(y, z, mat = 'anodized') {
  return [
    P('Holo Base', rbox(0.044, 0.02, 0.098, 0.004), mat, 'weapon', { p: [0, y + 0.01, z] }),
    P('Holo Hood L', rbox(0.003, 0.044, 0.064, 0.001), mat, 'weapon', { p: [0.0215, y + 0.044, z + 0.012] }),
    P('Holo Hood R', rbox(0.003, 0.044, 0.064, 0.001), mat, 'weapon', { p: [-0.0215, y + 0.044, z + 0.012] }),
    P('Holo Top', rbox(0.046, 0.004, 0.07, 0.0015), mat, 'weapon', { p: [0, y + 0.068, z + 0.012] }),
    P('Holo Buttons', rbox(0.006, 0.006, 0.012, 0.002), 'polymer', 'weapon', { p: [-0.024, y + 0.012, z - 0.02], m: [arr(2, 0.016)] }),
    P('Holo Battery', cyl(0.009, 0.009, 0.045, 14), mat, 'weapon', { p: [0.0, y + 0.012, z + 0.06], r: [0, 0, 90] }),
    P('Holo Glass', rbox(0.038, 0.038, 0.0015, 0), 'glass', 'weapon', { p: [0, y + 0.045, z + 0.035], noShadow: true }),
    P('Holo Glass Rear', rbox(0.038, 0.038, 0.0015, 0), 'glass', 'weapon', { p: [0, y + 0.045, z - 0.012], noShadow: true }),
    P('Holo Ring', torus(0.0065, 0.00045, 32), 'reticle', 'weapon', { p: [0, y + 0.045, z + 0.034], r: ALONG_Z, noShadow: true }),
    P('Holo Dot', sphere(0.00065, 8, 6), 'reticle', 'weapon', { p: [0, y + 0.045, z + 0.034], noShadow: true }),
    P('Holo Tick', rbox(0.0007, 0.0024, 0.0005, 0), 'reticle', 'weapon', { p: [0, y + 0.045 + 0.0078, z + 0.034], noShadow: true }),
  ];
}
// Tube red dot (Aimpoint-style) on a riser
function tubeDot(y, z, r = 0.017, mat = 'anodized') {
  return [
    P('Dot Riser', rbox(0.026, y - 0.004 - r, 0.05, 0.003), mat, 'weapon', { p: [0, (y - r) / 2 + 0.002, z] }),
    P('Dot Tube', cyl(r, r, 0.07, 22, false), mat, 'weapon', { p: [0, y, z], r: ALONG_Z, m: [{ type: 'solidify', thickness: 0.003 }] }),
    P('Dot Turret', cyl(0.009, 0.009, 0.014, 14), mat, 'weapon', { p: [0, y + r + 0.004, z] }),
    P('Dot Turret Side', cyl(0.009, 0.009, 0.014, 14), mat, 'weapon', { p: [-r - 0.004, y, z], r: [0, 0, 90] }),
    P('Dot Lens', cyl(r - 0.003, r - 0.003, 0.001, 22), 'glass', 'weapon', { p: [0, y, z + 0.034], r: ALONG_Z, noShadow: true }),
    P('Dot Reticle', sphere(0.0011, 8, 6), 'reticle', 'weapon', { p: [0, y, z + 0.03], noShadow: true }),
    P('Dot Caps', cyl(r + 0.002, r + 0.002, 0.008, 22, false), 'polymer', 'weapon', { p: [0, y, z + 0.034], r: ALONG_Z }),
  ];
}

// AR-pattern pistol grip, trigger group and lower details (M4 / M110 / MP7 style)
function arLower(o = {}) {
  const m = o.mat || 'anodized', gm = o.gripMat || 'grip';
  return [
    P('Pistol Grip', rbox(0.027, 0.098, 0.036, 0.009, 2), gm, 'weapon', { p: [0, -0.048, -0.037], r: [21, 0, 0], m: [taper('y', -0.06)] }),
    P('Grip Beavertail', rbox(0.026, 0.016, 0.03, 0.006), gm, 'weapon', { p: [0, -0.004, -0.058], r: [28, 0, 0] }),
    P('Trigger Guard', rbox(0.012, 0.0045, 0.066, 0.0015), m, 'weapon', { p: [0, -0.034, 0.012] }),
    P('Trigger Guard Front', rbox(0.012, 0.03, 0.006, 0.0015), m, 'weapon', { p: [0, -0.02, 0.043] }),
    P('Trigger', rbox(0.0045, 0.022, 0.0055, 0.0015), 'darkSteel', 'weapon', { p: [0, -0.017, 0.014], r: [16, 0, 0] }),
    P('Safety Selector', rbox(0.004, 0.008, 0.02, 0.0015), 'darkSteel', 'weapon', { p: [0.0145, 0.006, -0.022], r: [0, 0, 0] }),
    P('Mag Release', cyl(0.0045, 0.0045, 0.004, 12), 'darkSteel', 'weapon', { p: [-0.0145, -0.002, 0.052], r: [0, 0, 90] }),
    P('Bolt Catch', rbox(0.003, 0.02, 0.012, 0.001), 'darkSteel', 'weapon', { p: [0.0145, 0.008, 0.028] }),
  ];
}
// AR-style buffer tube + collapsible stock
function arStock(y, z0, mat = 'polymer', long = false) {
  const zs = z0 - (long ? 0.2 : 0.17);
  return [
    P('Buffer Tube', cyl(0.0148, 0.0148, 0.2, 18), 'anodized', 'weapon', { p: [0, y, z0 - 0.1], r: ALONG_Z }),
    P('Castle Nut', cyl(0.018, 0.018, 0.01, 12), 'anodized', 'weapon', { p: [0, y, z0 - 0.006], r: ALONG_Z }),
    P('Stock Body', rbox(0.04, 0.066, 0.115, 0.012, 2), mat, 'weapon', { p: [0, y - 0.006, zs], m: [taper('z', 0.08)] }),
    P('Stock Cheek', rbox(0.034, 0.018, 0.1, 0.008), mat, 'weapon', { p: [0, y + 0.028, zs + 0.004] }),
    P('Stock Toe', rbox(0.03, 0.05, 0.05, 0.01), mat, 'weapon', { p: [0, y - 0.052, zs - 0.03], r: [-12, 0, 0] }),
    P('Butt Pad', rbox(0.044, 0.13, 0.02, 0.008, 2), 'grip', 'weapon', { p: [0, y - 0.022, zs - 0.064] }),
    P('Stock Latch', rbox(0.01, 0.008, 0.04, 0.003), mat, 'weapon', { p: [0, y - 0.03, zs + 0.05] }),
    P('QD Cup', cyl(0.006, 0.006, 0.006, 12), 'darkSteel', 'weapon', { p: [0.021, y - 0.01, zs + 0.03], r: [0, 0, 90] }),
  ];
}
// Curved 5.56 polymer magazine (PMAG style) on the mag bone
function curvedMag(seat, h = 0.14, color = 'polymer', rounds = true) {
  return [
    P('Mag Body', rbox(0.022, h, 0.062, 0.004, 3), color, 'mag', { p: [seat[0], seat[1] - h / 2 + 0.012, seat[2]], m: [bend('y', 'z', 16)] }),
    P('Mag Ribs', rbox(0.0235, 0.004, 0.05, 0.0012), color, 'mag', { p: [seat[0], seat[1] - 0.045, seat[2] + 0.004], m: [arr(4, 0.0035, -0.012)] }),
    P('Mag Base', rbox(0.027, 0.012, 0.072, 0.004), color, 'mag', { p: [seat[0], seat[1] - h + 0.006, seat[2] + 0.012], r: [-12, 0, 0] }),
    ...(rounds ? [
      P('Mag Round', cyl(0.0048, 0.0048, 0.04, 10), 'brass', 'mag', { p: [seat[0], seat[1] + 0.017, seat[2] - 0.006], r: ALONG_Z }),
      P('Mag Bullet', { type: 'cone', radius: 0.0045, height: 0.017, radialSegments: 10, heightSegments: 1, capBottom: true, arc: 360 }, 'copper', 'mag', { p: [seat[0], seat[1] + 0.017, seat[2] + 0.022], r: ALONG_Z }),
    ] : []),
  ];
}
// Straight steel/polymer box magazine
function boxMag(seat, h, w, d, color, rounds = true) {
  return [
    P('Mag Body', rbox(w, h, d, 0.003, 2), color, 'mag', { p: [seat[0], seat[1] - h / 2 + 0.012, seat[2]] }),
    P('Mag Base', rbox(w + 0.006, 0.012, d + 0.008, 0.004), color, 'mag', { p: [seat[0], seat[1] - h + 0.008, seat[2] + 0.002] }),
    P('Mag Window', rbox(w + 0.0012, h * 0.5, 0.006, 0.001), 'slot', 'mag', { p: [seat[0], seat[1] - h * 0.45, seat[2] - d * 0.25] }),
    ...(rounds ? [
      P('Mag Round', cyl(0.0056, 0.0056, 0.046, 10), 'brass', 'mag', { p: [seat[0], seat[1] + 0.017, seat[2] - 0.006], r: ALONG_Z }),
      P('Mag Bullet', { type: 'cone', radius: 0.0052, height: 0.02, radialSegments: 10, heightSegments: 1, capBottom: true, arc: 360 }, 'copper', 'mag', { p: [seat[0], seat[1] + 0.017, seat[2] + 0.026], r: ALONG_Z }),
    ] : []),
  ];
}

// ---------------------------------------------------------------- M4A1 Block II
function m4Parts() {
  const B = 0.034; // bore height
  return [
    // lower & upper receivers
    P('Lower Receiver', rbox(0.026, 0.044, 0.19, 0.004), 'anodized', 'weapon', { p: [0, 0.006, 0.012] }),
    P('Magwell', rbox(0.031, 0.05, 0.078, 0.004), 'anodized', 'weapon', { p: [0, -0.02, 0.07], m: [taper('y', 0.06)] }),
    P('Upper Receiver', rbox(0.03, 0.034, 0.2, 0.004), 'anodized', 'weapon', { p: [0, 0.042, 0.004] }),
    P('Upper Fins', rbox(0.004, 0.012, 0.04, 0.0015), 'anodized', 'weapon', { p: [0.0148, 0.05, -0.055] }),
    P('Ejection Port', rbox(0.0015, 0.013, 0.052, 0.0006), 'darkSteel', 'weapon', { p: [-0.0155, 0.04, 0.03] }),
    P('Brass Deflector', rbox(0.008, 0.016, 0.02, 0.004), 'anodized', 'weapon', { p: [-0.016, 0.048, -0.006] }),
    P('Forward Assist', cyl(0.0075, 0.0075, 0.03, 14), 'anodized', 'weapon', { p: [-0.018, 0.05, -0.052], r: [70, 0, 0] }),
    P('Dust Cover Hinge', cyl(0.002, 0.002, 0.05, 8), 'darkSteel', 'weapon', { p: [-0.0158, 0.031, 0.03], r: ALONG_Z }),
    ...rail('Upper Rail', 'anodized', 0, 0.062, -0.1, 0.1),
    P('Charging Handle', rbox(0.034, 0.007, 0.03, 0.002), 'anodized', 'bolt', { p: [0, 0.056, -0.108] }),
    P('Charging Latch', rbox(0.012, 0.007, 0.014, 0.002), 'anodized', 'bolt', { p: [0.022, 0.056, -0.116] }),
    // handguard (free float M-LOK)
    P('Handguard', rbox(0.05, 0.052, 0.32, 0.012, 4), 'anodized', 'weapon', { p: [0, B, 0.265] }),
    ...rail('Handguard Rail', 'anodized', 0, 0.063, 0.106, 0.42),
    mlok('M-LOK L', 0.0252, B, 0.14, 7), mlok('M-LOK R', -0.0252, B, 0.14, 7),
    P('M-LOK Bottom', rbox(0.009, 0.0022, 0.026, 0.001), 'slot', 'weapon', { p: [0, B - 0.0262, 0.14], m: [arr(7, 0.04)] }),
    P('Barrel Nut', cyl(0.02, 0.02, 0.012, 16), 'anodized', 'weapon', { p: [0, B, 0.108], r: ALONG_Z }),
    // barrel & muzzle
    P('Barrel', cyl(0.0082, 0.0082, 0.13, 16), 'darkSteel', 'weapon', { p: [0, B, 0.49], r: ALONG_Z }),
    P('Gas Block', rbox(0.022, 0.024, 0.02, 0.003), 'darkSteel', 'weapon', { p: [0, B + 0.002, 0.44] }),
    P('Flash Hider', cyl(0.011, 0.011, 0.055, 16), 'darkSteel', 'weapon', { p: [0, B, 0.58], r: ALONG_Z }),
    P('Flash Hider Slots', rbox(0.0232, 0.0028, 0.03, 0.0004), 'slot', 'weapon', { p: [0, B, 0.592], m: [{ type: 'array', count: 3, offsetX: 0, offsetY: 0, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 60, scaleStep: 1 }] }),
    // BUIS
    P('Front BUIS', rbox(0.014, 0.022, 0.014, 0.002), 'anodized', 'weapon', { p: [0, 0.078, 0.405] }),
    P('Front Post', rbox(0.0025, 0.012, 0.0025, 0.0005), 'darkSteel', 'weapon', { p: [0, 0.094, 0.405] }),
    P('Rear BUIS (folded)', rbox(0.022, 0.009, 0.032, 0.002), 'anodized', 'weapon', { p: [0, 0.072, -0.082] }),
    // foregrip + light
    P('Angled Grip', rbox(0.03, 0.022, 0.075, 0.008), 'polymer', 'weapon', { p: [0, B - 0.036, 0.27], r: [-8, 0, 0] }),
    P('Angled Grip Ramp', rbox(0.026, 0.018, 0.03, 0.007), 'polymer', 'weapon', { p: [0, B - 0.043, 0.31], r: [-35, 0, 0] }),
    ...weaponLight(-0.036, B + 0.012, 0.35),
    ...holoSight(0.066, 0.01),
    ...arLower(), ...arStock(0.03, -0.1, 'polymer'),
    ...curvedMag([0, -0.02, 0.071]),
    ...muzzleFlash(0.61, B),
  ];
}

// ---------------------------------------------------------------- MP7A2 (suppressed)
function mp7Parts() {
  const B = 0.05;
  return [
    P('Receiver', rbox(0.034, 0.05, 0.24, 0.007, 3), 'polymer', 'weapon', { p: [0, 0.03, 0.03], m: [taper('z', -0.06)] }),
    P('Receiver Top', rbox(0.028, 0.02, 0.21, 0.005), 'polymer', 'weapon', { p: [0, 0.062, 0.02] }),
    P('Receiver Flutes', rbox(0.0355, 0.004, 0.14, 0.001), 'slot', 'weapon', { p: [0, 0.018, 0.06], m: [arr(3, 0, 0.009)] }),
    ...rail('Top Rail', 'anodized', 0, 0.074, -0.08, 0.14),
    ...rail('Side Rail', 'anodized', -0.02, 0.035, 0.1, 0.15, 'weapon', 0.016, [0, 0, 90]),
    P('Front Grip Hinge', rbox(0.02, 0.012, 0.02, 0.003), 'polymer', 'weapon', { p: [0, -0.002, 0.135] }),
    P('Front Grip', rbox(0.024, 0.075, 0.03, 0.008, 2), 'grip', 'weapon', { p: [0, -0.042, 0.13], r: [-6, 0, 0], m: [taper('y', 0.08)] }),
    P('Grip (mag well)', rbox(0.03, 0.105, 0.042, 0.009, 2), 'grip', 'weapon', { p: [0, -0.05, -0.028], r: [12, 0, 0] }),
    P('Trigger Guard', rbox(0.012, 0.005, 0.06, 0.002), 'polymer', 'weapon', { p: [0, -0.03, 0.018] }),
    P('Trigger Guard Front', rbox(0.012, 0.028, 0.006, 0.002), 'polymer', 'weapon', { p: [0, -0.016, 0.046] }),
    P('Trigger', rbox(0.0045, 0.02, 0.006, 0.0015), 'darkSteel', 'weapon', { p: [0, -0.012, 0.018], r: [14, 0, 0] }),
    P('Selector', rbox(0.004, 0.012, 0.012, 0.002), 'darkSteel', 'weapon', { p: [0.0175, 0.012, -0.02] }),
    // stock (collapsed rods + plate)
    P('Stock Rod L', cyl(0.004, 0.004, 0.13, 8), 'darkSteel', 'weapon', { p: [0.012, 0.022, -0.12], r: ALONG_Z }),
    P('Stock Rod R', cyl(0.004, 0.004, 0.13, 8), 'darkSteel', 'weapon', { p: [-0.012, 0.022, -0.12], r: ALONG_Z }),
    P('Butt Plate', rbox(0.04, 0.085, 0.016, 0.006, 2), 'polymer', 'weapon', { p: [0, 0.01, -0.185] }),
    P('Butt Pad', rbox(0.038, 0.08, 0.008, 0.004), 'grip', 'weapon', { p: [0, 0.01, -0.195] }),
    P('Charging Handle', rbox(0.04, 0.008, 0.016, 0.003), 'polymer', 'bolt', { p: [0, 0.064, -0.098] }),
    // barrel + suppressor
    P('Barrel Shroud', cyl(0.011, 0.011, 0.03, 14), 'darkSteel', 'weapon', { p: [0, B - 0.012, 0.165], r: ALONG_Z }),
    P('Suppressor', cyl(0.019, 0.019, 0.16, 22), 'darkSteel', 'weapon', { p: [0, B - 0.012, 0.26], r: ALONG_Z }),
    P('Suppressor Cap', cyl(0.0165, 0.019, 0.01, 22), 'darkSteel', 'weapon', { p: [0, B - 0.012, 0.345], r: ALONG_Z }),
    P('Suppressor Rings', torus(0.0192, 0.0014, 22), 'steel', 'weapon', { p: [0, B - 0.012, 0.195], r: ALONG_Z, m: [arr(3, 0, 0.055)] }),
    // flip sights (folded) + tube red dot
    P('Front Sight (folded)', rbox(0.012, 0.008, 0.02, 0.002), 'polymer', 'weapon', { p: [0, 0.078, 0.13] }),
    ...tubeDot(0.1, 0.02, 0.016),
    // magazine lives in the grip
    ...boxMag([0, -0.035, -0.023], 0.14, 0.022, 0.034, 'polymer', false).map((p) => ({ ...p, rotation: [12, 0, 0] })),
    ...muzzleFlash(0.35, B - 0.012, 0.55),
  ];
}

// ---------------------------------------------------------------- FN SCAR-H (Mk17)
function scarParts() {
  const B = 0.042;
  return [
    P('Upper Receiver', rbox(0.046, 0.058, 0.52, 0.006, 4), 'fdeMetal', 'weapon', { p: [0, 0.045, 0.14] }),
    ...rail('Top Rail', 'fdeMetal', 0, 0.078, -0.11, 0.39),
    ...rail('Side Rail L', 'fdeMetal', 0.026, B, 0.25, 0.37, 'weapon', 0.018, [0, 0, 90]),
    ...rail('Side Rail R', 'fdeMetal', -0.026, B, 0.25, 0.37, 'weapon', 0.018, [0, 0, 90]),
    ...rail('Bottom Rail', 'fdeMetal', 0, 0.012, 0.24, 0.39, 'weapon', 0.018, [0, 0, 180]),
    P('Lower Receiver', rbox(0.036, 0.04, 0.2, 0.006), 'fde', 'weapon', { p: [0, 0.0, 0.02] }),
    P('Magwell', rbox(0.04, 0.048, 0.088, 0.005), 'fde', 'weapon', { p: [0, -0.022, 0.075] }),
    P('Charging Handle', rbox(0.018, 0.014, 0.016, 0.004), 'darkSteel', 'bolt', { p: [0.034, 0.05, 0.19] }),
    P('Charging Slot', rbox(0.002, 0.008, 0.21, 0.001), 'slot', 'weapon', { p: [0.0232, 0.05, 0.12] }),
    P('Ejection Port', rbox(0.002, 0.016, 0.06, 0.001), 'darkSteel', 'weapon', { p: [-0.0232, 0.04, 0.035] }),
    P('Barrel', cyl(0.0095, 0.0095, 0.14, 16), 'darkSteel', 'weapon', { p: [0, B, 0.45], r: ALONG_Z }),
    P('Gas Regulator', rbox(0.024, 0.02, 0.024, 0.004), 'darkSteel', 'weapon', { p: [0, B + 0.016, 0.415] }),
    P('Muzzle Brake', rbox(0.026, 0.026, 0.06, 0.005), 'darkSteel', 'weapon', { p: [0, B, 0.55] }),
    P('Brake Ports', rbox(0.0275, 0.009, 0.008, 0.001), 'slot', 'weapon', { p: [0, B + 0.004, 0.535], m: [arr(3, 0.014)] }),
    P('Front Sight (folded)', rbox(0.018, 0.012, 0.03, 0.003), 'fdeMetal', 'weapon', { p: [0, 0.087, 0.37] }),
    ...arLower({ mat: 'fde', gripMat: 'fde' }),
    // side-folding stock
    P('Stock Hinge', rbox(0.038, 0.05, 0.02, 0.006), 'fde', 'weapon', { p: [0, 0.035, -0.12] }),
    P('Stock Frame', rbox(0.034, 0.05, 0.16, 0.01, 2), 'fde', 'weapon', { p: [0, 0.026, -0.2], m: [taper('z', 0.12)] }),
    P('Stock Cheek', rbox(0.03, 0.02, 0.12, 0.008), 'fde', 'weapon', { p: [0, 0.062, -0.21] }),
    P('Stock Lower', rbox(0.026, 0.02, 0.1, 0.006), 'fde', 'weapon', { p: [0, -0.02, -0.25], r: [-8, 0, 0] }),
    P('Butt Pad', rbox(0.042, 0.12, 0.022, 0.008, 2), 'grip', 'weapon', { p: [0, 0.018, -0.29] }),
    ...tubeDot(0.112, 0.02, 0.018, 'anodized'),
    ...weaponLight(-0.042, B + 0.01, 0.31),
    ...boxMag([0, -0.024, 0.076], 0.13, 0.028, 0.074, 'darkSteel'),
    ...muzzleFlash(0.585, B, 1.3),
  ];
}

// ---------------------------------------------------------------- Benelli M4 (M1014)
function m1014Parts() {
  const B = 0.052;
  return [
    P('Receiver', rbox(0.04, 0.066, 0.24, 0.007, 2), 'anodized', 'weapon', { p: [0, 0.03, 0.05] }),
    P('Receiver Cut', rbox(0.041, 0.004, 0.2, 0.001), 'slot', 'weapon', { p: [0, 0.012, 0.05] }),
    ...rail('Top Rail', 'anodized', 0, 0.066, -0.06, 0.16),
    P('Ghost Ring Rear', rbox(0.03, 0.022, 0.018, 0.003), 'anodized', 'weapon', { p: [0, 0.08, -0.04] }),
    P('Ghost Ring Aperture', torus(0.0052, 0.0017, 20), 'darkSteel', 'weapon', { p: [0, 0.094, -0.04], r: ALONG_Z }),
    P('Ghost Ring Ears', rbox(0.004, 0.022, 0.014, 0.001), 'anodized', 'weapon', { p: [0.013, 0.094, -0.04], m: [{ type: 'mirror', axis: 'x', offset: 0 }] }),
    P('Barrel', cyl(0.0115, 0.0115, 0.44, 18), 'darkSteel', 'weapon', { p: [0, B, 0.39], r: ALONG_Z }),
    P('Mag Tube', cyl(0.0135, 0.0135, 0.34, 18), 'anodized', 'weapon', { p: [0, 0.018, 0.34], r: ALONG_Z }),
    P('Tube Cap', cyl(0.015, 0.0145, 0.02, 16), 'anodized', 'weapon', { p: [0, 0.018, 0.515], r: ALONG_Z }),
    P('Barrel Clamp', rbox(0.03, 0.06, 0.018, 0.005), 'anodized', 'weapon', { p: [0, 0.035, 0.48] }),
    P('Front Sight', rbox(0.004, 0.024, 0.014, 0.001), 'anodized', 'weapon', { p: [0, 0.072, 0.58] }),
    P('Front Sight Base', rbox(0.012, 0.012, 0.03, 0.002), 'anodized', 'weapon', { p: [0, 0.064, 0.58] }),
    P('Front Dot', sphere(0.0022, 8, 6), 'tritium', 'weapon', { p: [0, 0.083, 0.58] }),
    P('Forend', rbox(0.05, 0.05, 0.2, 0.012, 3), 'polymer', 'weapon', { p: [0, 0.028, 0.29] }),
    P('Forend Grooves', rbox(0.0515, 0.004, 0.16, 0.001), 'slot', 'weapon', { p: [0, 0.018, 0.29], m: [arr(3, 0, 0.01)] }),
    P('Loading Port', rbox(0.022, 0.003, 0.07, 0.001), 'slot', 'weapon', { p: [0, -0.004, 0.08] }),
    P('Bolt Handle', rbox(0.022, 0.012, 0.014, 0.004), 'steel', 'bolt', { p: [-0.028, 0.04, 0.1] }),
    P('Ejection Port', rbox(0.002, 0.022, 0.07, 0.001), 'darkSteel', 'weapon', { p: [-0.0205, 0.04, 0.09] }),
    P('Side Saddle', rbox(0.012, 0.034, 0.1, 0.003), 'polymer', 'weapon', { p: [0.026, 0.03, 0.06] }),
    ...[0, 1, 2, 3, 4].map((k) => P('Saddle Shell ' + k, cyl(0.0105, 0.0105, 0.05, 12), 'shellRed', 'weapon', { p: [0.034, 0.03, 0.022 + k * 0.019] })),
    ...[0, 1, 2, 3, 4].map((k) => P('Saddle Brass ' + k, cyl(0.011, 0.011, 0.012, 12), 'brass', 'weapon', { p: [0.034, 0.003, 0.022 + k * 0.019] })),
    // pistol grip + collapsible stock
    P('Pistol Grip', rbox(0.03, 0.1, 0.04, 0.01, 2), 'grip', 'weapon', { p: [0, -0.045, -0.04], r: [18, 0, 0] }),
    P('Trigger Guard', rbox(0.014, 0.006, 0.07, 0.002), 'polymer', 'weapon', { p: [0, -0.012, 0.01] }),
    P('Trigger', rbox(0.0045, 0.02, 0.006, 0.0015), 'darkSteel', 'weapon', { p: [0, -0.002, 0.012], r: [14, 0, 0] }),
    P('Safety', cyl(0.004, 0.004, 0.044, 10), 'darkSteel', 'weapon', { p: [0, 0.006, 0.042], r: [0, 0, 90] }),
    P('Stock Tube', cyl(0.014, 0.014, 0.18, 16), 'anodized', 'weapon', { p: [0, 0.03, -0.14], r: ALONG_Z }),
    P('Stock Frame', rbox(0.038, 0.07, 0.11, 0.012, 2), 'polymer', 'weapon', { p: [0, 0.018, -0.25], m: [taper('z', 0.1)] }),
    P('Stock Cheek', rbox(0.03, 0.016, 0.09, 0.006), 'polymer', 'weapon', { p: [0, 0.056, -0.25] }),
    P('Butt Pad', rbox(0.044, 0.13, 0.024, 0.01, 2), 'grip', 'weapon', { p: [0, 0.0, -0.31] }),
    ...weaponLight(-0.034, 0.02, 0.38),
    // shell carried by the loading hand (shell bone)
    P('Load Shell', cyl(0.0105, 0.0105, 0.05, 12), 'shellRed', 'shell', { p: [0, 0, 0], r: ALONG_Z }),
    P('Load Shell Brass', cyl(0.0112, 0.0112, 0.012, 12), 'brass', 'shell', { p: [0, 0, -0.03], r: ALONG_Z }),
    ...muzzleFlash(0.615, B, 1.4),
  ];
}

// ---------------------------------------------------------------- M110 SASS (suppressed, 4x scope)
function m110Parts() {
  const B = 0.036;
  return [
    P('Lower Receiver', rbox(0.03, 0.048, 0.21, 0.004), 'ranger', 'weapon', { p: [0, 0.006, 0.015] }),
    P('Magwell', rbox(0.035, 0.052, 0.09, 0.004), 'ranger', 'weapon', { p: [0, -0.022, 0.078] }),
    P('Upper Receiver', rbox(0.034, 0.038, 0.22, 0.004), 'ranger', 'weapon', { p: [0, 0.045, 0.005] }),
    P('Ejection Port', rbox(0.0015, 0.015, 0.06, 0.0006), 'darkSteel', 'weapon', { p: [-0.0175, 0.043, 0.032] }),
    P('Forward Assist', cyl(0.008, 0.008, 0.03, 14), 'ranger', 'weapon', { p: [-0.02, 0.053, -0.055], r: [70, 0, 0] }),
    ...rail('Upper Rail', 'ranger', 0, 0.068, -0.105, 0.11),
    P('Charging Handle', rbox(0.038, 0.008, 0.03, 0.002), 'ranger', 'bolt', { p: [0, 0.061, -0.118] }),
    P('Handguard', rbox(0.056, 0.058, 0.42, 0.014, 5), 'ranger', 'weapon', { p: [0, B, 0.325] }),
    ...rail('Handguard Rail', 'ranger', 0, 0.07, 0.116, 0.53),
    mlok('M-LOK L', 0.0282, B, 0.15, 9), mlok('M-LOK R', -0.0282, B, 0.15, 9),
    P('Barrel', cyl(0.0095, 0.0095, 0.1, 16), 'darkSteel', 'weapon', { p: [0, B, 0.58], r: ALONG_Z }),
    P('Suppressor', cyl(0.02, 0.02, 0.2, 22), 'darkSteel', 'weapon', { p: [0, B, 0.72], r: ALONG_Z }),
    P('Suppressor Cap', cyl(0.017, 0.02, 0.012, 22), 'darkSteel', 'weapon', { p: [0, B, 0.826], r: ALONG_Z }),
    // folded bipod
    P('Bipod Base', rbox(0.03, 0.016, 0.03, 0.004), 'darkSteel', 'weapon', { p: [0, B - 0.036, 0.48] }),
    P('Bipod Leg L', cyl(0.0055, 0.0055, 0.18, 10), 'darkSteel', 'weapon', { p: [0.011, B - 0.044, 0.39], r: ALONG_Z }),
    P('Bipod Leg R', cyl(0.0055, 0.0055, 0.18, 10), 'darkSteel', 'weapon', { p: [-0.011, B - 0.044, 0.39], r: ALONG_Z }),
    // scope 3.5-10x
    P('Scope Ring F', rbox(0.03, 0.04, 0.014, 0.004), 'darkSteel', 'weapon', { p: [0, 0.094, 0.07] }),
    P('Scope Ring R', rbox(0.03, 0.04, 0.014, 0.004), 'darkSteel', 'weapon', { p: [0, 0.094, -0.05] }),
    P('Scope Body', lathe([[0.0, -0.17], [0.021, -0.17], [0.021, -0.12], [0.015, -0.09], [0.015, 0.07], [0.024, 0.11], [0.024, 0.17], [0.0, 0.17]], 28), 'darkSteel', 'weapon', { p: [0, 0.11, 0.02], r: ALONG_Z }),
    P('Scope Turret Top', cyl(0.012, 0.012, 0.022, 16), 'darkSteel', 'weapon', { p: [0, 0.134, 0.01] }),
    P('Scope Turret Side', cyl(0.012, 0.012, 0.022, 16), 'darkSteel', 'weapon', { p: [-0.025, 0.11, 0.01], r: [0, 0, 90] }),
    P('Scope Turret Knurl', torus(0.0122, 0.0014, 16), 'steel', 'weapon', { p: [0, 0.142, 0.01] }),
    P('Scope Power Ring', torus(0.0206, 0.0022, 24), 'steel', 'weapon', { p: [0, 0.11, -0.1], r: ALONG_Z }),
    P('Scope Lens F', cyl(0.021, 0.021, 0.001, 22), 'lens', 'weapon', { p: [0, 0.11, 0.19], r: ALONG_Z }),
    P('Scope Lens R', cyl(0.018, 0.018, 0.001, 22), 'lens', 'weapon', { p: [0, 0.11, -0.15], r: ALONG_Z }),
    ...arLower({ mat: 'ranger' }), ...arStock(0.034, -0.105, 'ranger', true),
    ...boxMag([0, -0.022, 0.08], 0.12, 0.026, 0.07, 'polymer'),
    ...muzzleFlash(0.84, B, 0.35),
  ];
}

// ---------------------------------------------------------------- Glock 17 (with light)
function glockParts() {
  return [
    P('Slide', rbox(0.0255, 0.028, 0.186, 0.0035, 2), 'darkSteel', 'slide', { p: [0, 0.032, 0.062] }),
    P('Slide Serrations', rbox(0.0262, 0.02, 0.0022, 0.0004), 'slot', 'slide', { p: [0, 0.03, -0.022], m: [arr(9, 0.0042)] }),
    P('Ejection Port', rbox(0.002, 0.012, 0.036, 0.0005), 'slot', 'slide', { p: [-0.0128, 0.038, 0.06] }),
    P('Barrel Hood', rbox(0.016, 0.004, 0.034, 0.001), 'steel', 'weapon', { p: [0, 0.0465, 0.06] }),
    P('Rear Sight', rbox(0.02, 0.008, 0.008, 0.0015), 'darkSteel', 'slide', { p: [0, 0.049, -0.02] }),
    P('Rear Dots', sphere(0.0014, 8, 6), 'tritium', 'slide', { p: [0.006, 0.05, -0.024], m: [{ type: 'mirror', axis: 'x', offset: 0 }] }),
    P('Front Sight', rbox(0.004, 0.008, 0.006, 0.001), 'darkSteel', 'slide', { p: [0, 0.049, 0.148] }),
    P('Front Dot', sphere(0.0016, 8, 6), 'tritium', 'slide', { p: [0, 0.051, 0.144] }),
    P('Muzzle', cyl(0.0056, 0.0056, 0.002, 12), 'slot', 'slide', { p: [0, 0.034, 0.156], r: ALONG_Z }),
    P('Frame', rbox(0.024, 0.022, 0.16, 0.004), 'polymer', 'weapon', { p: [0, 0.009, 0.06] }),
    P('Frame Rail', rbox(0.022, 0.012, 0.05, 0.002), 'polymer', 'weapon', { p: [0, -0.005, 0.115] }),
    P('Grip', rbox(0.0285, 0.1, 0.052, 0.009, 3), 'grip', 'weapon', { p: [0, -0.045, -0.012], r: [19, 0, 0], m: [taper('y', -0.05)] }),
    P('Grip Backstrap', rbox(0.024, 0.08, 0.012, 0.005), 'polymer', 'weapon', { p: [0, -0.04, -0.04], r: [19, 0, 0] }),
    P('Trigger Guard', rbox(0.011, 0.005, 0.056, 0.002), 'polymer', 'weapon', { p: [0, -0.026, 0.035] }),
    P('Trigger Guard Front', rbox(0.011, 0.028, 0.006, 0.002), 'polymer', 'weapon', { p: [0, -0.012, 0.062], r: [-10, 0, 0] }),
    P('Trigger', rbox(0.005, 0.018, 0.006, 0.0015), 'polymer', 'weapon', { p: [0, -0.01, 0.026], r: [12, 0, 0] }),
    P('Slide Stop', rbox(0.0025, 0.004, 0.014, 0.001), 'darkSteel', 'weapon', { p: [0.013, 0.018, 0.03] }),
    ...weaponLight(0, -0.02, 0.1),
    // magazine: body hidden in the grip, base plate visible
    P('Mag Body', rbox(0.02, 0.1, 0.03, 0.003), 'polymer', 'mag', { p: [0, -0.04, -0.008], r: [19, 0, 0] }),
    P('Mag Base', rbox(0.028, 0.01, 0.048, 0.004), 'polymer', 'mag', { p: [0, -0.094, -0.03], r: [19, 0, 0] }),
    P('Mag Round', cyl(0.0045, 0.0045, 0.02, 10), 'brass', 'mag', { p: [0, 0.008, 0.008], r: ALONG_Z }),
    ...muzzleFlash(0.16, 0.034, 0.55),
  ];
}

// ---------------------------------------------------------------- Desert Eagle Mk XIX (.50 AE)
function deaglePart() {
  return [
    P('Barrel', cyl(0.024, 0.024, 0.16, 3), 'stainless', 'weapon', { p: [0, 0.046, 0.14], r: [90, 0, 60], s: [1, 1, 1] }),
    P('Barrel Flats', rbox(0.03, 0.03, 0.16, 0.004), 'stainless', 'weapon', { p: [0, 0.043, 0.14] }),
    ...rail('Barrel Rail', 'stainless', 0, 0.064, 0.07, 0.21, 'weapon', 0.016),
    P('Muzzle', cyl(0.007, 0.007, 0.002, 12), 'slot', 'weapon', { p: [0, 0.046, 0.221], r: ALONG_Z }),
    P('Slide', rbox(0.032, 0.036, 0.13, 0.004, 2), 'stainless', 'slide', { p: [0, 0.042, 0.0] }),
    P('Slide Serrations', rbox(0.0328, 0.024, 0.0026, 0.0004), 'slot', 'slide', { p: [0, 0.04, -0.055], m: [arr(7, 0.005)] }),
    P('Rear Sight', rbox(0.022, 0.01, 0.01, 0.002), 'darkSteel', 'slide', { p: [0, 0.064, -0.05] }),
    P('Front Sight', rbox(0.004, 0.012, 0.01, 0.001), 'darkSteel', 'weapon', { p: [0, 0.072, 0.205] }),
    P('Hammer', rbox(0.01, 0.022, 0.012, 0.003), 'darkSteel', 'weapon', { p: [0, 0.034, -0.074], r: [-30, 0, 0] }),
    P('Frame', rbox(0.03, 0.026, 0.19, 0.004), 'stainless', 'weapon', { p: [0, 0.012, 0.05] }),
    P('Grip', rbox(0.034, 0.108, 0.058, 0.012, 3), 'grip', 'weapon', { p: [0, -0.048, -0.022], r: [16, 0, 0], m: [taper('y', -0.04)] }),
    P('Trigger Guard', rbox(0.012, 0.006, 0.06, 0.002), 'stainless', 'weapon', { p: [0, -0.024, 0.04] }),
    P('Trigger Guard Front', rbox(0.012, 0.03, 0.007, 0.002), 'stainless', 'weapon', { p: [0, -0.01, 0.07], r: [-10, 0, 0] }),
    P('Trigger', rbox(0.005, 0.018, 0.006, 0.0015), 'darkSteel', 'weapon', { p: [0, -0.008, 0.03], r: [12, 0, 0] }),
    P('Safety', rbox(0.004, 0.008, 0.016, 0.002), 'darkSteel', 'slide', { p: [0.018, 0.048, -0.04] }),
    P('Mag Body', rbox(0.022, 0.1, 0.036, 0.003), 'stainless', 'mag', { p: [0, -0.042, -0.018], r: [16, 0, 0] }),
    P('Mag Base', rbox(0.03, 0.01, 0.052, 0.004), 'polymer', 'mag', { p: [0, -0.1, -0.036], r: [16, 0, 0] }),
    P('Mag Round', cyl(0.0065, 0.0065, 0.02, 10), 'brass', 'mag', { p: [0, 0.006, 0.0], r: ALONG_Z }),
    ...muzzleFlash(0.225, 0.046, 0.9),
  ];
}

// ---------------------------------------------------------------- M67 frag (thrown by the left hand)
export const GRENADE_PARTS = [
  P('Frag Body', sphere(0.032, 16, 12), 'nadeBody', 'nade', { s: [1, 1.12, 1] }),
  P('Frag Fuze', cyl(0.009, 0.011, 0.02, 12), 'steel', 'nade', { p: [0, 0.042, 0] }),
  P('Frag Spoon', rbox(0.008, 0.06, 0.004, 0.0015), 'steel', 'nade', { p: [0.0, 0.02, 0.034], r: [8, 0, 0] }),
  P('Frag Pin Ring', torus(0.009, 0.0012, 16), 'steel', 'nade', { p: [0.018, 0.048, 0], r: [0, 0, 90] }),
];

// ---------------------------------------------------------------- definitions + stats
// grip: right wrist target (weapon-local) and hand rotation; support: left hand.
// sight: eye point in weapon space when aiming (the sight line); magSeat: mag bone rest.
export const WEAPONS = {
  m4a1: {
    id: 'm4a1', name: 'M4A1 BLOCK II', short: 'M4A1', cls: 'Carbine', caliber: '5.56×45mm', slot: 'primary', parts: m4Parts,
    damage: 30, headMul: 2.4, rpm: 800, mag: 30, reserve: 180, modes: ['AUTO', 'SEMI'], pellets: 1,
    spreadHip: 0.028, spreadAds: 0.0015, recoil: [1.0, 0.45], adsTime: 0.22, adsFov: 52, moveMul: 0.96, range: [30, 80, 0.7],
    reload: 2.3, reloadEmpty: 2.9, reloadStyle: 'rifle', sound: { body: 0.9, crack: 1.0, pitch: 1.0, tail: 0.8 },
    grip: { p: [-0.032, -0.045, -0.105], r: [-72, 0, 6] }, support: { p: [0.045, -0.028, 0.285], r: [0, 18, -92] }, supportPose: 'supportRail',
    sight: [0, 0.111, 0.0], muzzle: [0, 0.034, 0.61], eject: [-0.02, 0.042, 0.03], magSeat: [0, -0.02, 0.071], hip: [-0.095, -0.175, 0.29], boltTravel: -0.075,
    light: [-0.036, 0.046, 0.415],
  },
  mp7: {
    id: 'mp7', name: 'MP7A2 SD', short: 'MP7', cls: 'PDW', caliber: '4.6×30mm', slot: 'primary', parts: mp7Parts,
    damage: 22, headMul: 2.1, rpm: 950, mag: 40, reserve: 240, modes: ['AUTO', 'SEMI'], pellets: 1,
    spreadHip: 0.022, spreadAds: 0.0025, recoil: [0.55, 0.32], adsTime: 0.16, adsFov: 58, moveMul: 1.05, range: [20, 55, 0.6],
    reload: 2.0, reloadEmpty: 2.5, reloadStyle: 'gripMag', sound: { body: 0.35, crack: 0.5, pitch: 1.3, tail: 0.3, suppressed: true },
    grip: { p: [-0.03, -0.05, -0.085], r: [-76, 0, 6] }, support: { p: [0.028, -0.07, 0.1], r: [-78, 0, -8] }, supportPose: 'foregrip',
    sight: [0, 0.1, 0.0], muzzle: [0, 0.038, 0.36], eject: [-0.02, 0.05, 0.02], magSeat: [0, -0.035, -0.023], hip: [-0.1, -0.15, 0.28], boltTravel: -0.05,
    light: [0, 0, 0], noLight: true,
  },
  scar: {
    id: 'scar', name: 'MK 17 SCAR-H', short: 'SCAR-H', cls: 'Battle Rifle', caliber: '7.62×51mm', slot: 'primary', parts: scarParts,
    damage: 45, headMul: 2.3, rpm: 600, mag: 20, reserve: 120, modes: ['AUTO', 'SEMI'], pellets: 1,
    spreadHip: 0.032, spreadAds: 0.0012, recoil: [1.7, 0.6], adsTime: 0.26, adsFov: 50, moveMul: 0.92, range: [40, 100, 0.75],
    reload: 2.5, reloadEmpty: 3.1, reloadStyle: 'rifle', sound: { body: 1.3, crack: 1.25, pitch: 0.82, tail: 1.1 },
    grip: { p: [-0.032, -0.045, -0.105], r: [-72, 0, 6] }, support: { p: [0.05, -0.02, 0.3], r: [0, 18, -92] }, supportPose: 'supportRail',
    sight: [0, 0.112, 0.0], muzzle: [0, 0.042, 0.585], eject: [-0.026, 0.042, 0.035], magSeat: [0, -0.024, 0.076], hip: [-0.1, -0.185, 0.31], boltTravel: -0.1,
    light: [-0.042, 0.052, 0.375],
  },
  m1014: {
    id: 'm1014', name: 'M1014 JSCS', short: 'M1014', cls: 'Shotgun', caliber: '12 Gauge', slot: 'primary', parts: m1014Parts,
    damage: 16, headMul: 1.5, rpm: 240, mag: 7, reserve: 42, modes: ['SEMI'], pellets: 9, pelletSpread: 0.055,
    spreadHip: 0.03, spreadAds: 0.02, recoil: [3.2, 0.9], adsTime: 0.25, adsFov: 60, moveMul: 0.95, range: [8, 25, 0.25],
    reload: 0.5, reloadEmpty: 1.4, reloadStyle: 'shotgun', sound: { body: 1.6, crack: 0.8, pitch: 0.6, tail: 1.3 },
    grip: { p: [-0.032, -0.04, -0.105], r: [-72, 0, 6] }, support: { p: [0.045, -0.035, 0.3], r: [0, 18, -92] }, supportPose: 'supportRail',
    sight: [0, 0.086, 0.0], muzzle: [0, 0.052, 0.615], eject: [-0.022, 0.04, 0.09], magSeat: [0, -0.4, 0], hip: [-0.1, -0.165, 0.29], boltTravel: -0.07,
    light: [-0.034, 0.02, 0.43],
  },
  m110: {
    id: 'm110', name: 'M110 SASS', short: 'M110', cls: 'Marksman', caliber: '7.62×51mm', slot: 'primary', parts: m110Parts,
    damage: 85, headMul: 2.5, rpm: 300, mag: 20, reserve: 80, modes: ['SEMI'], pellets: 1,
    spreadHip: 0.05, spreadAds: 0.0004, recoil: [2.4, 0.5], adsTime: 0.32, adsFov: 16, scope: true, moveMul: 0.88, range: [80, 200, 0.8],
    reload: 2.7, reloadEmpty: 3.3, reloadStyle: 'rifle', sound: { body: 0.5, crack: 0.9, pitch: 0.9, tail: 0.5, suppressed: true },
    grip: { p: [-0.032, -0.045, -0.105], r: [-72, 0, 6] }, support: { p: [0.05, -0.028, 0.32], r: [0, 18, -92] }, supportPose: 'supportRail',
    sight: [0, 0.11, 0.0], muzzle: [0, 0.036, 0.84], eject: [-0.022, 0.045, 0.032], magSeat: [0, -0.022, 0.08], hip: [-0.095, -0.185, 0.3], boltTravel: -0.08,
    light: [0, 0, 0], noLight: true,
  },
  glock: {
    id: 'glock', name: 'GLOCK 17 GEN5', short: 'G17', cls: 'Sidearm', caliber: '9×19mm', slot: 'secondary', parts: glockParts,
    damage: 26, headMul: 2.2, rpm: 450, mag: 17, reserve: 102, modes: ['SEMI'], pellets: 1,
    spreadHip: 0.02, spreadAds: 0.004, recoil: [1.3, 0.5], adsTime: 0.13, adsFov: 62, moveMul: 1.08, range: [15, 40, 0.55],
    reload: 1.6, reloadEmpty: 1.9, reloadStyle: 'pistol', sound: { body: 0.7, crack: 0.85, pitch: 1.25, tail: 0.6 }, pistol: true,
    grip: { p: [-0.018, -0.052, -0.07], r: [-72, 0, 4] }, support: { p: [0.03, -0.075, -0.035], r: [-70, -20, -40] }, supportPose: 'pistolSupport',
    sight: [0, 0.051, 0.0], muzzle: [0, 0.034, 0.16], eject: [-0.014, 0.04, 0.06], magSeat: [0, 0, 0], hip: [-0.085, -0.13, 0.33], slideTravel: -0.034,
    light: [0, -0.02, 0.166],
  },
  deagle: {
    id: 'deagle', name: 'DESERT EAGLE .50', short: 'DEAGLE', cls: 'Hand Cannon', caliber: '.50 AE', slot: 'secondary', parts: deaglePart,
    damage: 68, headMul: 2.0, rpm: 180, mag: 7, reserve: 42, modes: ['SEMI'], pellets: 1,
    spreadHip: 0.03, spreadAds: 0.005, recoil: [4.2, 1.1], adsTime: 0.18, adsFov: 58, moveMul: 1.0, range: [20, 50, 0.6],
    reload: 2.0, reloadEmpty: 2.4, reloadStyle: 'pistol', sound: { body: 1.7, crack: 1.4, pitch: 0.7, tail: 1.4 }, pistol: true,
    grip: { p: [-0.02, -0.056, -0.082], r: [-74, 0, 4] }, support: { p: [0.033, -0.08, -0.045], r: [-72, -20, -40] }, supportPose: 'pistolSupport',
    sight: [0, 0.07, 0.0], muzzle: [0, 0.046, 0.225], eject: [-0.018, 0.05, 0.0], magSeat: [0, 0, 0], hip: [-0.085, -0.14, 0.33], slideTravel: -0.045,
    light: [0, 0, 0], noLight: true,
  },
};
export const PRIMARIES = ['m4a1', 'mp7', 'scar', 'm1014', 'm110'];
export const SIDEARMS = ['glock', 'deagle'];

// Resolve parts with named materials (for third-person StaticBuilder use)
export function weaponParts(id) { return WEAPONS[id].parts(); }
