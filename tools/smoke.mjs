// Node smoke test for the DOM-free parts: weapons build, clips synthesize, aim rig,
// physics movement/raycasts and nav paths. Run: npm test
import { buildShape, Skeleton, expandSkeleton, Mixer } from '../engine/index.js';
import { WEAPONS } from '../src/content/weapons.js';
import { HUMAN_SKELETON, humanClips, applyAim } from '../src/content/humans.js';
import { PhysicsWorld, NavGraph } from '../src/world/physics.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('FAIL', msg); } else console.log('ok  ', msg); };

for (const [id, w] of Object.entries(WEAPONS)) {
  const parts = w.parts();
  let tris = 0; for (const p of parts) tris += buildShape(p.shape, p.modifiers).triangleCount;
  ok(parts.length > 15 && tris > 1000, `${id}: ${parts.length} parts, ${tris} triangles`);
}
const t0 = performance.now();
const clips = humanClips();
ok(['Idle', 'Walk', 'Run', 'DeathBack', 'DeathFwd', 'Sit', 'Swing', 'Surrender'].every((n) => clips.some((c) => c.name === n)), `human clips (${Math.round(performance.now() - t0)} ms)`);
const sk = new Skeleton(expandSkeleton(HUMAN_SKELETON));
const mx = new Mixer(sk, clips); mx.play('Walk', { fade: 0 }); mx.update(0.3);
const m = applyAim({ skeleton: sk }, 'm4a1', { pitch: 0.2 });
ok(m && m[10] > 0.8 && m[9] > 0.05, 'aim rig points the rifle forward and up');
const hand = sk.worldHead(sk.boneIndex('hand.R')), grip = [m[12], m[13], m[14]];
ok(Math.hypot(hand[0] - grip[0], hand[1] - grip[1], hand[2] - grip[2]) < 0.2, 'right hand reaches the grip');

const ph = new PhysicsWorld();
ph.add([-1, 0, 2], [1, 3, 3]);
const r = ph.move([0, 0, 0], [0, 0, 2.5], 0.35, 1.7);
ok(r.pos[2] < 2 - 0.3, 'movement stops at walls');
const h = ph.raycast([0, 1, 0], [0, 0, 1], 10);
ok(h && Math.abs(h.t - 2) < 1e-4 && h.normal[2] === -1, 'raycast hits the wall face');
ok(!ph.lineOfSight([0, 1, 0], [0, 1, 5]), 'wall blocks line of sight');
const nav = new NavGraph(ph);
for (const [x, z] of [[0, 0], [3, 0], [3, 5], [0, 5]]) nav.add(x, z);
nav.build();
const path = nav.path([0, 0, 0], [0, 0, 5]);
ok(path.length >= 3 && path.some((p) => p[0] > 2), `nav path goes around the wall (${path.length} points)`);
if (fails) { console.error(fails + ' failure(s)'); process.exit(1); }
console.log('all smoke tests passed');
