// Choreography: author an action as a few key poses per channel (weapon transform,
// hand targets, finger poses, prop attachments...), evaluate them at a fixed frame rate
// and bake the result into an ordinary editable Clip. Transform keys can be attached to
// other moving things (a hand, a weapon), and blending happens in world space, so a prop
// can be handed from one attachment to another without popping.
import { quat, vec3, clamp } from './math.js';

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
