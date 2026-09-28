// Static batching: collapse a hierarchy of static meshes into one mesh per material, so a
// building made of hundreds of boards costs a handful of draw calls. Lights, skinned and
// instanced meshes, and nodes flagged userData.dynamic are kept as they are.
import { Node, Mesh } from './scene.js';
import { Geometry } from './geometry.js';
import { mat4 } from './math.js';

export function batchStatic(root, name = root.name + ' (batched)') {
  root.updateWorld(null);
  const inv = mat4.invert(mat4.create(), root.world);
  const groups = new Map(), keep = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (!c.visible) continue;
      if (c.isLight || c.skeleton || c.instanceMatrices || c.userData.dynamic) { keep.push(c); continue; }
      if (c.geometry) {
        const rel = mat4.multiply(mat4.create(), inv, c.world);
        if (!groups.has(c.material)) groups.set(c.material, { geos: [], shadow: false });
        const g = groups.get(c.material);
        g.geos.push(c.geometry.clone().applyMatrix(rel)); g.shadow ||= c.castShadow;
      }
      walk(c);
    }
  };
  walk(root);
  const out = new Node(name);
  out.position.set(root.position); out.rotation.set(root.rotation); out.scale.set(root.scale);
  for (const [mat, g] of groups) { const m = new Mesh(Geometry.merge(g.geos), mat, mat.name); m.castShadow = g.shadow; out.add(m); }
  for (const k of keep) { const w = mat4.multiply(mat4.create(), inv, k.world); mat4.getTranslation(k.position, w); mat4.getRotation(k.rotation, w); out.add(k); }
  return out;
}
