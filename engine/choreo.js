// Choreography: author an action as a few key poses per channel (weapon transform,
// hand targets, finger poses, prop attachments...), evaluate them at a fixed frame rate
// and bake the result into an ordinary editable Clip. Transform keys can be attached to
// other moving things (a hand, a weapon), and blending happens in world space, so a prop
// can be handed from one attachment to another without popping.
import { quat, vec3, clamp } from './math.js';
import { twoBoneIK, setWorldRotation } from './ik.js';
import { applyHandPose, hasFingers, HAND_POSES } from './gait.js';

export const EASE = {
  linear: (s) => s,
  inOut: (s) => s * s * (3 - 2 * s),
  in: (s) => s * s,
  out: (s) => 1 - (1 - s) * (1 - s),
  snap: (s) => 1 - Math.pow(1 - s, 4), // fast start, soft landing (bolt slams, recoil)
  hold: (s) => (s >= 1 ? 1 : 0),
};

// keys: [{ t, ...value, ease }] sorted by t. mix(a, b, s) blends two key values.
export function sampleKeys(keys, t, mix) {
  if (t <= keys[0].t) return mix(keys[0], keys[0], 0);
  const last = keys[keys.length - 1];
  if (t >= last.t) return mix(last, last, 0);
  let i = 0;
  while (keys[i + 1].t < t) i++;
  const a = keys[i], b = keys[i + 1];
  const s = clamp((t - a.t) / (b.t - a.t || 1e-6), 0, 1);
  return mix(a, b, (EASE[b.ease || 'inOut'] || EASE.inOut)(s));
}

export const lerpArr = (a, b, s) => a.map((v, k) => v + (b[k] - v) * s);

// A rigid transform {p, q}; compose(parent, localPos, localRot)
export function compose(parent, p, q) {
  const wp = vec3.transformQuat([0, 0, 0], p, parent.q);
  return { p: [parent.p[0] + wp[0], parent.p[1] + wp[1], parent.p[2] + wp[2]], q: quat.multiply(quat.create(), parent.q, q) };
}
export function blendXf(a, b, s) {
  const q = quat.slerp(quat.create(), a.q, b.q, s);
  return { p: lerpArr(a.p, b.p, s), q };
}

// Sample a transform channel whose keys may be attached to named parents.
// keys: [{ t, attach: 'world' | name, p:[x,y,z], r:[euler deg] }], parents: { name: {p,q} } at this time
export function sampleXf(keys, t, parents) {
  const resolve = (k) => {
    const q = quat.fromEuler(quat.create(), ...(k.r || [0, 0, 0]));
    const par = k.attach && k.attach !== 'world' ? parents[k.attach] : null;
    return par ? compose(par, k.p, q) : { p: [...k.p], q };
  };
  return sampleKeys(keys, t, (a, b, s) => (s <= 0 ? resolve(a) : blendXf(resolve(a), resolve(b), s)));
}

// Bake a list of skeleton pose snapshots (taken at `times`) into a Clip definition.
export function bakePoses(sk, name, times, poses, { loop = false, posBones = [], stepBones = [], ...extra } = {}) {
  const tracks = [];
  const eul = [0, 0, 0];
  const r = (x) => Math.round(x * 1e5) / 1e5;
  sk.bones.forEach((b, i) => {
    if (b.name === 'root' || b.spring) return;
    const rot = { bone: b.name, type: 'rotation', interp: stepBones.includes(b.name) ? 'step' : 'smooth', keys: [] };
    let prev = null;
    poses.forEach((snap, k) => {
      quat.toEuler(eul, snap.rot.subarray(i * 4, i * 4 + 4));
      const v = eul.map((a, c) => { if (!prev) return a; let x = a; while (x - prev[c] > 180) x -= 360; while (x - prev[c] < -180) x += 360; return x; });
      prev = v; rot.keys.push({ t: r(times[k]), v: v.map(r) });
    });
    if (rot.keys.some((k) => k.v.some((x) => Math.abs(x) > 1e-3))) tracks.push(rot);
    if (posBones.includes(b.name)) {
      tracks.push({ bone: b.name, type: 'position', interp: stepBones.includes(b.name) ? 'step' : 'smooth', keys: poses.map((snap, k) => ({ t: r(times[k]), v: Array.from(snap.pos.subarray(i * 3, i * 3 + 3)).map(r) })) });
    }
  });
  return { name, duration: r(times[times.length - 1]), loop, tracks, rootMotion: [0, 0, 0], syncGroup: null, events: [], ...extra };
}

// ------------------------------------------------------------------ key-pose authoring
// Author a clip as a few full-body key poses. Each frame carries over everything from the
// previous one, so a frame only lists what changes:
//   { t, bones: { spine: [x,y,z], 'upperArm.R': [...] },   local euler degrees
//     hips: [x,y,z],                                         model-space hips position
//     arms: { R: { target, pole, handRot } | null },         two-bone IK for the hands
//     legs: { L: { target, pole, pitch } | 'plant' | null }, 'plant' keeps the foot on the floor
//     hands: { L: 'relaxed' | { curl, spread } } }
// Bones named with a trailing '*' (e.g. 'upperArm*') are set on both sides, mirrored.
// Keys are eased into each other and the IK is solved at every sample (30 fps), so planted
// feet stay planted and hands stay on their targets between keys, not just on them.
export function keyPoseClip(sk, name, frames, { loop = false, events = [], rootMotion = [0, 0, 0], syncGroup = null, fps = 30 } = {}) {
  const idx = (n) => sk.boneIndex(n);
  const hi = idx('hips'), hipsRest = sk.bones[hi].head;
  const footRest = { L: sk.bones[idx('foot.L')]?.head, R: sk.bones[idx('foot.R')]?.head };
  // 1. expand carry-over frames into complete key states
  const keys = [];
  const st = { bones: {}, hips: [...hipsRest], arms: { L: null, R: null }, legs: { L: null, R: null }, hands: {} };
  for (const f of frames) {
    for (const [k, v] of Object.entries(f.bones || {})) {
      if (k.endsWith('*')) { const b = k.slice(0, -1); st.bones[b + '.L'] = v; st.bones[b + '.R'] = [v[0], -v[1], -v[2]]; } else st.bones[k] = v;
    }
    if (f.hips) st.hips = f.hips;
    for (const side of ['L', 'R']) {
      if (f.arms && side in f.arms) st.arms[side] = f.arms[side];
      if (f.legs && side in f.legs) { const l = f.legs[side]; st.legs[side] = l === 'plant' && footRest[side] ? { target: [...footRest[side]], pitch: 0 } : l; }
      if (f.hands && side in f.hands) { const h = f.hands[side]; st.hands[side] = typeof h === 'string' ? HAND_POSES[h] : h; }
    }
    keys.push({ t: f.t, bones: { ...st.bones }, hips: [...st.hips], arms: { ...st.arms }, legs: { ...st.legs }, hands: { ...st.hands } });
  }
  const T = keys[keys.length - 1].t;
  const L = (a, b, s) => a + (b - a) * s, LA = (a, b, s) => a.map((v, i) => L(v, b[i], s));
  const ik = (a, b, s) => { // blend two IK settings; a missing one fades the IK weight
    if (!a && !b) return null;
    if (a && b) return { target: LA(a.target, b.target, s), pole: LA(a.pole || b.pole || [0, 0, 1], b.pole || a.pole || [0, 0, 1], s), pitch: L(a.pitch || 0, b.pitch || 0, s), handRot: a.handRot && b.handRot ? LA(a.handRot, b.handRot, s) : a.handRot || b.handRot, w: 1 };
    const one = a || b; return { ...one, w: a ? 1 - s : s };
  };
  // 2. sample
  const times = new Set([...keys.map((k) => k.t)]);
  for (let t = 0; t < T; t += 1 / fps) times.add(Math.round(t * 1e4) / 1e4);
  const sorted = [...times].sort((a, b) => a - b), poses = [];
  const E3 = (e) => quat.fromEuler(quat.create(), e[0], e[1], e[2]);
  for (const t of sorted) {
    let i = 0; while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
    const A = keys[i], B = keys[Math.min(i + 1, keys.length - 1)];
    let s = B.t > A.t ? clamp((t - A.t) / (B.t - A.t), 0, 1) : 0; s = s * s * (3 - 2 * s);
    sk.resetPose();
    const names = new Set([...Object.keys(A.bones), ...Object.keys(B.bones)]);
    for (const b of names) { const bi = idx(b); if (bi < 0) continue; const ea = A.bones[b] || [0, 0, 0], eb = B.bones[b] || [0, 0, 0]; sk.rot.set(quat.slerp(quat.create(), E3(ea), E3(eb), s), bi * 4); }
    const hp = LA(A.hips, B.hips, s);
    sk.pos.set([hp[0] - hipsRest[0], hp[1] - hipsRest[1], hp[2] - hipsRest[2]], hi * 3);
    sk.update();
    for (const side of ['L', 'R']) {
      const sg = side === 'L' ? 1 : -1;
      const solve = (chain, set, extra) => { // IK blended against FK by weight
        if (!set || chain.some((c) => c < 0)) return;
        const fk = chain.map((c) => quat.copy(quat.create(), sk.rot.subarray(c * 4, c * 4 + 4)));
        twoBoneIK(sk, chain[0], chain[1], chain[2], set.target, set.pole);
        extra();
        if (set.w < 1) { chain.forEach((c, k) => { const cur = sk.rot.subarray(c * 4, c * 4 + 4); quat.slerp(cur, fk[k], quat.copy(quat.create(), cur), set.w); }); sk.update(); }
      };
      const leg = ik(A.legs[side], B.legs[side], s);
      if (leg) leg.pole = leg.pole || [sg * 0.1, 0, 1];
      solve([idx('thigh.' + side), idx('shin.' + side), idx('foot.' + side)], leg, () => {
        setWorldRotation(sk, idx('foot.' + side), quat.fromEuler(quat.create(), leg.pitch || 0, 0, 0));
        if (leg.pitch > 0 && idx('toe.' + side) >= 0) setWorldRotation(sk, idx('toe.' + side), quat.create()); // toes stay flat on a heel lift
      });
      const arm = ik(A.arms[side], B.arms[side], s);
      if (arm) arm.pole = arm.pole || [sg, -0.5, -0.3];
      solve([idx('upperArm.' + side), idx('foreArm.' + side), idx('hand.' + side)], arm, () => { if (arm.handRot) setWorldRotation(sk, idx('hand.' + side), quat.fromEuler(quat.create(), ...arm.handRot)); });
      const ha = A.hands[side], hb = B.hands[side];
      if ((ha || hb) && hasFingers(sk, side)) { const a = ha || hb, b = hb || ha; applyHandPose(sk, side, { curl: a.curl.map((c, k) => L(c, b.curl[k], s)), spread: L(a.spread, b.spread, s) }); }
    }
    sk.update();
    poses.push(sk.snapshotPose());
  }
  const clip = bakePoses(sk, name, sorted, poses, { loop, posBones: ['hips'], events, rootMotion, syncGroup });
  for (const tr of clip.tracks) tr.interp = 'linear'; // dense samples: linear keeps IK contacts exact
  sk.resetPose(); sk.update();
  return clip;
}
