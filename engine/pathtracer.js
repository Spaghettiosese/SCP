// Path tracer ("RTX mode"): the scene is baked to world-space triangles, a SAH bounding
// volume hierarchy is built on the CPU and packed into float textures, and a fragment
// shader traces full light paths on the GPU: GGX specular and Lambert diffuse, the sun and
// up to 16 lamps sampled directly with shadow rays, sky light, emissive surfaces, glass,
// Russian roulette. Samples accumulate while the camera is still; an edge-aware a-trous
// filter cleans up the first frames. Works on the same Scene, Camera and materials as the
// raster renderer, so any scene can be flipped into ray-traced mode.
import { NOISE } from './shaders.js';
import { skinnedPositions } from './io.js';
import { mat4, vec3, hexToRGB, srgbToLinear } from './math.js';
import { Mesh } from './scene.js';

const TEX_W = 2048;

// ------------------------------------------------------------------ scene baking
export function bakeScene(scene, { includeSkinned = true } = {}) {
  scene.updateWorld();
  const pos = [], nrm = [], mat = [], mats = [], matIndex = new Map();
  const lights = [];
  const addMat = (m) => {
    if (matIndex.has(m)) return matIndex.get(m);
    matIndex.set(m, mats.length); mats.push(m); return mats.length - 1;
  };
  const pushGeo = (g, P, N, mi) => {
    const I = g.indices, base = pos.length / 3;
    for (let i = 0; i < P.length; i++) { pos.push(P[i]); nrm.push(N[i]); }
    for (let t = 0; t < I.length; t += 3) mat.push([base + I[t], base + I[t + 1], base + I[t + 2], mi]);
  };
  const transform = (g, M) => {
    const n = g.vertexCount, P = new Float32Array(n * 3), N = new Float32Array(n * 3), p = [0, 0, 0], q = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      vec3.transformMat4(p, [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]], M);
      vec3.normalize(q, vec3.transformDir(q, [g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]], M));
      P.set(p, i * 3); N.set(q, i * 3);
    }
    return { P, N };
  };
  const walk = (node, vis) => {
    vis = vis && node.visible;
    if (!vis) return;
    if (node.isLight) lights.push(node);
    if (node.geometry && node.material && node.material.opacity > 0.05 && node.userData.raytrace !== false) {
      const mi = addMat(node.material);
      if (node.instanceMatrices) {
        for (let k = 0; k < node.count; k++) {
          const M = mat4.multiply(mat4.create(), node.world, node.instanceMatrices.subarray(k * 16, k * 16 + 16));
          const { P, N } = transform(node.geometry, M); pushGeo(node.geometry, P, N, mi);
        }
      } else if (node.skeleton && node.skinRoot) {
        if (includeSkinned) { const s = skinnedPositions(node); pushGeo(node.geometry, s.positions, s.normals, mi); }
      } else { const { P, N } = transform(node.geometry, node.world); pushGeo(node.geometry, P, N, mi); }
    }
    for (const c of node.children) walk(c, vis);
  };
  walk(scene, true);
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), tris: mat, materials: mats, lights };
}

// ------------------------------------------------------------------ BVH (binned SAH)
export function buildBVH(positions, tris, { leafSize = 4, bins = 12 } = {}) {
  const n = tris.length;
  const bmin = new Float32Array(n * 3), bmax = new Float32Array(n * 3), cen = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const a = positions[tris[i][0] * 3 + k], b = positions[tris[i][1] * 3 + k], c = positions[tris[i][2] * 3 + k];
      bmin[i * 3 + k] = Math.min(a, b, c); bmax[i * 3 + k] = Math.max(a, b, c); cen[i * 3 + k] = (a + b + c) / 3;
    }
  }
  const order = new Uint32Array(n); for (let i = 0; i < n; i++) order[i] = i;
  const nodes = []; // { min, max, left, first, count }
  const area = (mn, mx) => { const x = mx[0] - mn[0], y = mx[1] - mn[1], z = mx[2] - mn[2]; return x * y + y * z + z * x; };
  const bounds = (s, e) => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) { const t = order[i]; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], bmin[t * 3 + k]); mx[k] = Math.max(mx[k], bmax[t * 3 + k]); } }
    return [mn, mx];
  };
  // children of a node always sit next to each other (right = left + 1), which the
  // shader relies on; each call fills a slot that was reserved by its parent
  const MAX_LEAF = 8;
  const build = (slot, s, e) => {
    const [mn, mx] = bounds(s, e);
    nodes[slot] = { min: mn, max: mx, left: -1, first: s, count: e - s };
    if (e - s <= leafSize) return;
    const cmn = [Infinity, Infinity, Infinity], cmx = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) { const t = order[i]; for (let k = 0; k < 3; k++) { cmn[k] = Math.min(cmn[k], cen[t * 3 + k]); cmx[k] = Math.max(cmx[k], cen[t * 3 + k]); } }
    let bestAxis = -1, bestPos = 0, bestCost = (e - s) * area(mn, mx);
    for (let ax = 0; ax < 3; ax++) {
      const ext = cmx[ax] - cmn[ax]; if (ext < 1e-7) continue;
      const cnt = new Int32Array(bins), bb = Array.from({ length: bins }, () => [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]]);
      for (let i = s; i < e; i++) {
        const t = order[i], b = Math.min(bins - 1, Math.floor(((cen[t * 3 + ax] - cmn[ax]) / ext) * bins));
        cnt[b]++; for (let k = 0; k < 3; k++) { bb[b][0][k] = Math.min(bb[b][0][k], bmin[t * 3 + k]); bb[b][1][k] = Math.max(bb[b][1][k], bmax[t * 3 + k]); }
      }
      const lA = new Float64Array(bins), lN = new Int32Array(bins);
      const mnL = [Infinity, Infinity, Infinity], mxL = [-Infinity, -Infinity, -Infinity]; let c = 0;
      for (let i = 0; i < bins - 1; i++) { c += cnt[i]; for (let k = 0; k < 3; k++) { mnL[k] = Math.min(mnL[k], bb[i][0][k]); mxL[k] = Math.max(mxL[k], bb[i][1][k]); } lA[i] = c ? area(mnL, mxL) : 0; lN[i] = c; }
      const mnR = [Infinity, Infinity, Infinity], mxR = [-Infinity, -Infinity, -Infinity]; c = 0;
      for (let i = bins - 1; i > 0; i--) {
        c += cnt[i]; for (let k = 0; k < 3; k++) { mnR[k] = Math.min(mnR[k], bb[i][0][k]); mxR[k] = Math.max(mxR[k], bb[i][1][k]); }
        if (!lN[i - 1] || !c) continue;
        const cost = lN[i - 1] * lA[i - 1] + c * area(mnR, mxR) + area(mn, mx) * 0.125;
        if (cost < bestCost) { bestCost = cost; bestAxis = ax; bestPos = cmn[ax] + (ext * i) / bins; }
      }
    }
    let mid = -1;
    if (bestAxis >= 0) {
      let i = s, j = e - 1;
      while (i <= j) { if (cen[order[i] * 3 + bestAxis] < bestPos) i++; else { const t = order[i]; order[i] = order[j]; order[j] = t; j--; } }
      if (i > s && i < e) mid = i;
    }
    if (mid < 0) {
      if (e - s <= MAX_LEAF) return; // small enough to stay a leaf
      // degenerate spread (many coincident centroids): split the sorted range in half
      const ax = [0, 1, 2].reduce((a, b) => (cmx[b] - cmn[b] > cmx[a] - cmn[a] ? b : a), 0);
      const part = Array.from(order.subarray(s, e)).sort((a, b) => cen[a * 3 + ax] - cen[b * 3 + ax]);
      order.set(part, s); mid = (s + e) >> 1;
    }
    const l = nodes.length; nodes.push(null, null);
    nodes[slot].count = 0; nodes[slot].left = l;
    build(l, s, mid); build(l + 1, mid, e);
  };
  nodes.push(null);
  if (n) build(0, 0, n); else nodes[0] = { min: [0, 0, 0], max: [0, 0, 0], left: -1, first: 0, count: 0 };
  return { nodes, order };
}

// ------------------------------------------------------------------ shaders
const PT_VS = /* glsl */ `#version 300 es
out vec2 vUV;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUV = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;

const PT_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUV;
uniform sampler2D uTris; uniform sampler2D uNodes; uniform sampler2D uMats; uniform sampler2D uPrev;
uniform mat4 uInvViewProj; uniform vec3 uCamPos; uniform vec2 uRes;
uniform int uFrame; uniform int uMaxBounces;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunCone;
uniform vec3 uSkyColor; uniform vec3 uGroundColor; uniform vec3 uHorizon; uniform vec3 uZenith; uniform float uAmbient; uniform float uNight;
uniform int uLightCount; uniform vec4 uLightPos[16]; uniform vec4 uLightColor[16]; uniform vec4 uLightSpot[16];
uniform float uAperture; uniform float uFocus;
layout(location=0) out vec4 outAccum;
layout(location=1) out vec4 outAux;    // first hit: normal (xyz), depth (w)
layout(location=2) out vec4 outAlbedo; // first hit albedo (for denoising)
${NOISE}
const float PI = 3.14159265;
const int TW = ${TEX_W};
uint rngState;
uint pcg(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float rnd(){ rngState = pcg(rngState); return float(rngState) / 4294967296.0; }
vec4 fetch(sampler2D t, int i){ return texelFetch(t, ivec2(i % TW, i / TW), 0); }

struct Hit { float t; int tri; vec2 bc; };

float boxT(vec3 mn, vec3 mx, vec3 ro, vec3 inv, float tmax){
  vec3 t0 = (mn - ro) * inv, t1 = (mx - ro) * inv;
  vec3 a = min(t0, t1), b = max(t0, t1);
  float n = max(max(a.x, a.y), max(a.z, 0.0)), f = min(min(b.x, b.y), min(b.z, tmax));
  return n <= f ? n : 1e30;
}
bool triHit(int k, vec3 ro, vec3 rd, inout Hit h){
  vec3 v0 = fetch(uTris, k*6).xyz, v1 = fetch(uTris, k*6+1).xyz, v2 = fetch(uTris, k*6+2).xyz;
  vec3 e1 = v1 - v0, e2 = v2 - v0, p = cross(rd, e2);
  float det = dot(e1, p);
  if(abs(det) < 1e-9) return false;
  float id = 1.0 / det; vec3 s = ro - v0;
  float u = dot(s, p) * id; if(u < 0.0 || u > 1.0) return false;
  vec3 q = cross(s, e1); float v = dot(rd, q) * id; if(v < 0.0 || u + v > 1.0) return false;
  float t = dot(e2, q) * id;
  if(t > 1e-4 && t < h.t){ h.t = t; h.tri = k; h.bc = vec2(u, v); return true; }
  return false;
}
bool trace(vec3 ro, vec3 rd, float tmax, bool any, out Hit h){
  h.t = tmax; h.tri = -1;
  vec3 inv = 1.0 / rd;
  int stack[40]; int sp = 0; int node = 0;
  if(boxT(fetch(uNodes, 0).xyz, fetch(uNodes, 1).xyz, ro, inv, h.t) > 1e29) return false;
  for(int it = 0; it < 4096; it++){
    vec4 a = fetch(uNodes, node*2), b = fetch(uNodes, node*2+1);
    int count = int(b.w);
    if(count > 0){
      int first = int(a.w);
      for(int i = 0; i < 8; i++){ if(i >= count) break; if(triHit(first + i, ro, rd, h) && any) return true; }
      if(sp == 0) break; node = stack[--sp]; continue;
    }
    int l = int(a.w), r = l + 1;
    float dl = boxT(fetch(uNodes, l*2).xyz, fetch(uNodes, l*2+1).xyz, ro, inv, h.t);
    float dr = boxT(fetch(uNodes, r*2).xyz, fetch(uNodes, r*2+1).xyz, ro, inv, h.t);
    if(dl > dr){ float tt = dl; dl = dr; dr = tt; int ti = l; l = r; r = ti; }
    if(dl < 1e29){ if(dr < 1e29 && sp < 40) stack[sp++] = r; node = l; continue; }
    if(sp == 0) break; node = stack[--sp];
  }
  return h.tri >= 0;
}

struct Mat { vec3 albedo; float rough; float metal; vec3 emit; float opacity; bool glass; };
Mat material(int id, vec3 p, vec3 n){
  vec4 t0 = fetch(uMats, id*4), t1 = fetch(uMats, id*4+1), t2 = fetch(uMats, id*4+2), t3 = fetch(uMats, id*4+3);
  Mat m; m.albedo = t0.rgb; m.rough = t0.a; m.emit = t1.rgb; m.metal = t1.a; m.opacity = t3.z; m.glass = false;
  int pat = int(t2.a + 0.5); float sc = t3.x, k = t3.y; vec3 pc = t2.rgb;
  vec3 q = p * sc;
  vec3 an = abs(n);
  vec2 uv = an.x > max(an.y, an.z) ? q.zy : (an.y > an.z ? q.xz : q.xy);
  if(pat == 9){ vec3 c = floor(q); m.albedo = mix(m.albedo, pc, mod(c.x+c.y+c.z, 2.0)*k); }
  else if(pat == 10){ vec3 w = vec3(p.x, 0.0, p.z) * sc; float f = fbm(w*0.35); m.albedo = mix(m.albedo, pc, smoothstep(0.35,0.7,f)*k) * (0.8 + 0.4*fbm(w*2.5+4.0)); }
  else if(pat == 16){ vec2 b = vec2(uv.x*0.5, uv.y); b.x += 0.5*mod(floor(b.y), 2.0); vec2 f = fract(b); float mortar = step(0.06, f.x)*step(0.1, f.y)*step(f.x, 0.94)*step(f.y, 0.9); m.albedo = mix(pc, m.albedo*(0.75+0.4*hash12(floor(b))), mortar); }
  else if(pat == 15){ float row = floor(uv.y); float seam = step(0.05, fract(uv.y)); m.albedo *= mix(1.0, 0.8 + 0.35*hash12(vec2(row, 3.1)), k); m.albedo = mix(pc, m.albedo, mix(1.0, seam, 0.8*k)); }
  else if(pat == 17){ vec2 s2 = uv; s2.x += 0.5*mod(floor(s2.y), 2.0); m.albedo *= mix(1.0, (0.7+0.5*hash12(floor(s2)+7.0))*(0.6+0.4*fract(s2.y)), k); }
  else if(pat == 19){ m.rough = 0.04; m.metal = 0.0; m.glass = true; }
  else if(pat == 13){ m.rough = 0.08; }
  else if(pat > 0){ m.albedo *= 0.88 + 0.24*fbm(q*1.3); }
  return m;
}
vec3 skyVisual(vec3 d){
  float t = d.y;
  vec3 c = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.8, t), 0.6));
  c = mix(c, uGroundColor*0.8, smoothstep(0.0, -0.15, t));
  return c;
}
vec3 skyLight(vec3 d){ return mix(uGroundColor, uSkyColor, d.y*0.5+0.5) * uAmbient; }
vec3 cosDir(vec3 n){
  float r1 = rnd(), r2 = rnd(), phi = 2.0*PI*r1, sr = sqrt(r2);
  vec3 t = normalize(abs(n.x) > 0.5 ? cross(n, vec3(0,1,0)) : cross(n, vec3(1,0,0))), b = cross(n, t);
  return normalize(t*cos(phi)*sr + b*sin(phi)*sr + n*sqrt(1.0 - r2));
}
vec3 ggxHalf(vec3 n, float a){
  float r1 = rnd(), r2 = rnd(), phi = 2.0*PI*r1;
  float ct = sqrt((1.0 - r2) / (1.0 + (a*a - 1.0)*r2)), st = sqrt(1.0 - ct*ct);
  vec3 t = normalize(abs(n.x) > 0.5 ? cross(n, vec3(0,1,0)) : cross(n, vec3(1,0,0))), b = cross(n, t);
  return normalize(t*cos(phi)*st + b*sin(phi)*st + n*ct);
}
float D_ggx(float nh, float a){ float a2 = a*a; float d = nh*nh*(a2-1.0)+1.0; return a2 / (PI*d*d); }
float G_smith(float nv, float nl, float r){ float k = (r+1.0)*(r+1.0)/8.0; return nv/(nv*(1.0-k)+k) * nl/(nl*(1.0-k)+k); }
// BRDF * cos for a light direction (used by next-event estimation)
vec3 brdfCos(Mat m, vec3 n, vec3 v, vec3 l){
  float nl = dot(n, l); if(nl <= 0.0) return vec3(0.0);
  float nv = max(dot(n, v), 1e-4), a = max(m.rough*m.rough, 0.002);
  vec3 h = normalize(v + l); float nh = max(dot(n, h), 0.0), vh = max(dot(v, h), 0.0);
  vec3 F0 = mix(vec3(0.04), m.albedo, m.metal), F = F0 + (1.0 - F0)*pow(1.0 - vh, 5.0);
  vec3 spec = D_ggx(nh, a) * G_smith(nv, nl, m.rough) * F / max(4.0*nv*nl, 1e-4);
  vec3 diff = (1.0 - F) * (1.0 - m.metal) * m.albedo / PI;
  return (diff + spec) * nl;
}
void main(){
  rngState = uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uint(uFrame) * 26699u;
  rngState = pcg(rngState);
  vec2 px = (gl_FragCoord.xy + vec2(rnd(), rnd())) / uRes * 2.0 - 1.0;
  vec4 a = uInvViewProj * vec4(px, -1.0, 1.0), b = uInvViewProj * vec4(px, 1.0, 1.0);
  vec3 ro = a.xyz / a.w, rd = normalize(b.xyz / b.w - ro);
  if(uAperture > 0.0){ // thin-lens depth of field
    vec3 fp = ro + rd * uFocus;
    vec3 rt = normalize(cross(rd, vec3(0,1,0))), up = cross(rt, rd);
    float r = sqrt(rnd()) * uAperture, ph = rnd() * 2.0 * PI;
    ro += (rt*cos(ph) + up*sin(ph)) * r; rd = normalize(fp - ro);
  }
  vec3 L = vec3(0.0), thr = vec3(1.0);
  vec4 aux = vec4(0.0, 0.0, 0.0, -1.0); vec3 alb = vec3(1.0);
  bool specBounce = true;
  for(int depth = 0; depth < 8; depth++){
    if(depth > uMaxBounces) break;
    Hit h;
    if(!trace(ro, rd, 1e5, false, h)){
      vec3 sky = depth == 0 ? skyVisual(rd) : skyLight(rd);
      if(specBounce){ float sd = max(dot(rd, uSunDir), 0.0); sky += uSunColor * pow(sd, 1500.0) * (depth == 0 ? 20.0 : 4.0) * (1.0 - uNight); }
      L += thr * sky;
      if(depth == 0){ aux = vec4(-rd, 1e4); alb = sky; }
      break;
    }
    int k = h.tri;
    vec4 t0 = fetch(uTris, k*6);
    int mid = int(t0.w + 0.5);
    vec3 v0 = t0.xyz, v1 = fetch(uTris, k*6+1).xyz, v2 = fetch(uTris, k*6+2).xyz;
    vec3 n0 = fetch(uTris, k*6+3).xyz, n1 = fetch(uTris, k*6+4).xyz, n2 = fetch(uTris, k*6+5).xyz;
    vec3 ng = normalize(cross(v1 - v0, v2 - v0));
    vec3 n = normalize(n0*(1.0 - h.bc.x - h.bc.y) + n1*h.bc.x + n2*h.bc.y);
    vec3 p = ro + rd * h.t;
    bool front = dot(ng, rd) < 0.0;
    if(!front){ ng = -ng; n = -n; }
    if(dot(n, ng) < 0.0) n = ng;
    Mat m = material(mid, p, n);
    if(depth == 0){ aux = vec4(n, h.t); alb = m.albedo; }
    if(m.opacity < 1.0 && rnd() > m.opacity){ ro = p + rd * 1e-3; continue; }
    L += thr * m.emit;
    vec3 v = -rd;
    vec3 po = p + ng * 1e-3;
    if(m.glass){ // thin window glass: reflect or pass straight through
      float F = 0.04 + 0.96*pow(1.0 - max(dot(n, v), 0.0), 5.0);
      if(rnd() < F){ rd = reflect(rd, n); ro = po; }
      else { ro = p - ng * 1e-3; thr *= vec3(0.9, 0.93, 0.95); }
      specBounce = true;
      continue;
    }
    // next-event estimation: the sun (a small disc) ...
    if(uSunColor.r + uSunColor.g + uSunColor.b > 0.0){
      vec3 sd = normalize(uSunDir + (vec3(rnd(), rnd(), rnd()) - 0.5) * uSunCone);
      Hit sh;
      if(dot(n, sd) > 0.0 && !trace(po, sd, 1e5, true, sh)) L += thr * brdfCos(m, n, v, sd) * uSunColor;
    }
    // ... and one randomly chosen lamp
    if(uLightCount > 0){
      int li = min(int(rnd() * float(uLightCount)), uLightCount - 1);
      vec3 lp = uLightPos[li].xyz + (vec3(rnd(), rnd(), rnd()) - 0.5) * 0.08;
      vec3 lv = lp - po; float d2 = dot(lv, lv), r = uLightPos[li].w;
      if(d2 < r*r){
        vec3 ld = lv * inversesqrt(d2);
        float win = clamp(1.0 - pow(d2/(r*r), 2.0), 0.0, 1.0), att = win*win / (d2 + 1.0);
        if(uLightColor[li].w > 0.5){ float cd = dot(-ld, uLightSpot[li].xyz); att *= smoothstep(uLightSpot[li].w, mix(uLightSpot[li].w, 1.0, 0.35), cd); }
        Hit sh;
        if(att > 0.0 && dot(n, ld) > 0.0 && !trace(po, ld, sqrt(d2) - 0.02, true, sh)) L += thr * brdfCos(m, n, v, ld) * uLightColor[li].rgb * att * float(uLightCount);
      }
    }
    // continue the path: choose specular or diffuse by Fresnel-weighted probability
    float nv = max(dot(n, v), 1e-4), a = max(m.rough*m.rough, 0.002);
    vec3 F0 = mix(vec3(0.04), m.albedo, m.metal);
    float pSpec = clamp(max(m.metal, 0.04 + 0.96*pow(1.0 - nv, 5.0)) * (1.2 - m.rough*0.6), 0.05, 0.95);
    if(m.metal > 0.9) pSpec = 1.0;
    if(rnd() < pSpec){
      vec3 hv = ggxHalf(n, a), l = reflect(rd, hv);
      float nl = dot(n, l); if(nl <= 0.0) break;
      float vh = max(dot(v, hv), 1e-4), nh = max(dot(n, hv), 1e-4);
      vec3 F = F0 + (1.0 - F0)*pow(1.0 - vh, 5.0);
      // weight = brdf*cos/pdf with pdf = D*nh/(4*vh)
      thr *= F * G_smith(nv, nl, m.rough) * vh / (nv * nh) / pSpec;
      rd = l; specBounce = m.rough < 0.25;
    } else {
      thr *= (1.0 - m.metal) * m.albedo / (1.0 - pSpec);
      rd = cosDir(n); specBounce = false;
    }
    ro = po;
    if(depth >= 2){ float q = clamp(max(thr.r, max(thr.g, thr.b)), 0.05, 0.95); if(rnd() > q) break; thr /= q; }
  }
  L = min(L, vec3(40.0)); // clamp fireflies
  vec4 prev = uFrame > 0 ? texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0) : vec4(0.0);
  outAccum = vec4(prev.rgb + L, prev.a + 1.0);
  outAux = aux; outAlbedo = vec4(alb, 1.0);
}`;

// edge-avoiding a-trous wavelet filter on the averaged radiance (demodulated by albedo)
const DENOISE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uColor; uniform sampler2D uAux; uniform sampler2D uAlbedo; uniform int uStep; uniform bool uFirst; uniform float uSigma;
out vec4 outColor;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy), sz = textureSize(uColor, 0);
  vec4 c0 = texelFetch(uColor, p, 0); vec4 a0 = texelFetch(uAux, p, 0); vec3 al0 = max(texelFetch(uAlbedo, p, 0).rgb, vec3(0.02));
  vec3 base = uFirst ? c0.rgb / max(c0.a, 1.0) / al0 : c0.rgb;
  float lum0 = dot(base, vec3(0.3, 0.6, 0.1));
  const float K[3] = float[](0.375, 0.25, 0.0625);
  vec3 sum = vec3(0.0); float wsum = 0.0;
  for(int y = -2; y <= 2; y++) for(int x = -2; x <= 2; x++){
    ivec2 q = clamp(p + ivec2(x, y) * uStep, ivec2(0), sz - 1);
    vec4 c = texelFetch(uColor, q, 0), a = texelFetch(uAux, q, 0);
    vec3 al = max(texelFetch(uAlbedo, q, 0).rgb, vec3(0.02));
    vec3 v = uFirst ? c.rgb / max(c.a, 1.0) / al : c.rgb;
    float wn = pow(max(dot(a.xyz, a0.xyz), 0.0), 32.0);
    float wd = exp(-abs(a.w - a0.w) / (0.05 * max(a0.w, 0.1) + 1e-3));
    float wl = exp(-abs(dot(v, vec3(0.3, 0.6, 0.1)) - lum0) / uSigma);
    float w = K[abs(x)] * K[abs(y)] * wn * wd * wl;
    sum += v * w; wsum += w;
  }
  outColor = vec4(sum / max(wsum, 1e-5), 1.0);
}`;

const DISPLAY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uAccum; uniform sampler2D uFiltered; uniform sampler2D uAlbedo; uniform bool uUseFilter; uniform float uBlend;
uniform float uExposure; uniform float uSaturation; uniform float uContrast;
out vec4 outColor;
vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
void main(){
  ivec2 p = ivec2(vUV * vec2(textureSize(uAccum, 0)));
  vec4 acc = texelFetch(uAccum, p, 0);
  vec3 c = acc.rgb / max(acc.a, 1.0);
  if(uUseFilter){ vec3 f = texelFetch(uFiltered, p, 0).rgb * max(texelFetch(uAlbedo, p, 0).rgb, vec3(0.02)); c = mix(c, f, uBlend); }
  c = aces(c * uExposure);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSaturation); c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
  outColor = vec4(pow(c, vec3(1.0/2.2)), 1.0);
}`;

// ------------------------------------------------------------------ path tracer
export class PathTracer {
  constructor(renderer, { maxBounces = 4, scale = 1 } = {}) {
    this.r = renderer; const gl = (this.gl = renderer.gl);
    if (!renderer.hdr) throw new Error('The path tracer needs float render targets (EXT_color_buffer_float).');
    this.maxBounces = maxBounces; this.scale = scale;
    this.samples = 0; this.maxSamples = 4096; this.denoise = true; this.aperture = 0; this.focus = 5;
    const mk = (fs) => new (Object.getPrototypeOf(renderer.prog.post).constructor)(gl, PT_VS, fs);
    this.prog = { trace: mk(PT_FS), denoise: mk(DENOISE_FS), display: mk(DISPLAY_FS) };
    this.vao = gl.createVertexArray();
    this.stats = { triangles: 0, nodes: 0, buildMs: 0, samples: 0, lights: 0 };
    this._w = 0; this._h = 0; this._lastVP = null;
  }
  _dataTex(data, texels) {
    const gl = this.gl, h = Math.max(1, Math.ceil(texels / TEX_W)), buf = new Float32Array(TEX_W * h * 4);
    buf.set(data.subarray(0, Math.min(data.length, buf.length)));
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEX_W, h, 0, gl.RGBA, gl.FLOAT, buf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }
  // Bake the scene into GPU buffers. Call again when geometry moves (characters, physics).
  build(scene, opts) {
    const t0 = performance.now(), gl = this.gl;
    const baked = bakeScene(scene, opts), { positions: P, normals: N, tris, materials } = baked;
    const { nodes, order } = buildBVH(P, tris);
    const triData = new Float32Array(tris.length * 24);
    for (let i = 0; i < order.length; i++) {
      const t = tris[order[i]], o = i * 24;
      for (let v = 0; v < 3; v++) { triData.set(P.subarray(t[v] * 3, t[v] * 3 + 3), o + v * 4); triData.set(N.subarray(t[v] * 3, t[v] * 3 + 3), o + 12 + v * 4); }
      triData[o + 3] = t[3];
    }
    const nodeData = new Float32Array(nodes.length * 8);
    nodes.forEach((n, i) => { nodeData.set([n.min[0], n.min[1], n.min[2], n.count > 0 ? n.first : n.left, n.max[0], n.max[1], n.max[2], n.count], i * 8); });
    const matData = new Float32Array(Math.max(1, materials.length) * 16);
    materials.forEach((m, i) => {
      const base = srgbToLinear(hexToRGB(m.color)), em = srgbToLinear(hexToRGB(m.emissive)).map((v) => v * m.emissiveStrength), pc = srgbToLinear(hexToRGB(m.patternColor));
      matData.set([...base, m.roughness, ...em, m.metallic, ...pc, m.patternIndex, m.patternScale, m.patternStrength, m.opacity, m.doubleSided ? 1 : 0], i * 16);
    });
    for (const k of ['triTex', 'nodeTex', 'matTex']) if (this[k]) gl.deleteTexture(this[k]);
    this.triTex = this._dataTex(triData, tris.length * 6);
    this.nodeTex = this._dataTex(nodeData, nodes.length * 2);
    this.matTex = this._dataTex(matData, materials.length * 4);
    this.lights = baked.lights;
    this.stats.triangles = tris.length; this.stats.nodes = nodes.length; this.stats.buildMs = performance.now() - t0;
    this.reset();
    return this.stats;
  }
  reset() { this.samples = 0; }
  _targets(w, h) {
    const gl = this.gl;
    if (w === this._w && h === this._h) return;
    this._w = w; this._h = h;
    const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; };
    if (this.fb) { for (const f of this.fb) gl.deleteFramebuffer(f.fbo); for (const t of this._tex) gl.deleteTexture(t); }
    this._tex = [];
    const mkTex = () => { const t = tex(); this._tex.push(t); return t; };
    this.aux = mkTex(); this.albedo = mkTex();
    this.fb = [0, 1].map(() => {
      const acc = mkTex(), fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, acc, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.aux, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.albedo, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      return { acc, fbo };
    });
    this.dn = [0, 1].map(() => { const t = mkTex(), fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, fbo }; });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cur = 0; this.samples = 0;
  }
  // One progressive pass (samplesPerFrame paths per pixel), then display.
  // split (0..1): only draw right of that fraction of the screen (A/B against the rasterizer)
  render(scene, camera, { samplesPerFrame = 1, split = 0 } = {}) {
    const r = this.r, gl = this.gl;
    r.resize();
    const w = Math.max(1, Math.round(r.width * this.scale)), h = Math.max(1, Math.round(r.height * this.scale));
    this._targets(w, h);
    camera.update(r.width / r.height);
    // restart accumulation whenever the view changes
    const vp = camera.viewProj;
    if (!this._lastVP || vp.some((v, i) => Math.abs(v - this._lastVP[i]) > 1e-6)) { this._lastVP = Float32Array.from(vp); this.samples = 0; }
    const env = scene.environment;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    const lights = (this.lights || []).filter((l) => l.intensity > 0 && l.visible !== false).slice(0, 16);
    const LP = new Float32Array(64), LC = new Float32Array(64), LS = new Float32Array(64);
    lights.forEach((l, i) => {
      const p = mat4.getTranslation([0, 0, 0], l.world), c = srgbToLinear(hexToRGB(l.color));
      LP.set([p[0], p[1], p[2], l.range], i * 4); LC.set([c[0] * l.intensity, c[1] * l.intensity, c[2] * l.intensity, l.type === 'spot' ? 1 : 0], i * 4);
      const d = vec3.normalize([0, 0, 0], vec3.transformDir([0, 0, 0], [0, -1, 0], l.world)); LS.set([d[0], d[1], d[2], Math.cos((l.angle * Math.PI) / 180)], i * 4);
    });
    this.stats.lights = lights.length;
    const p = this.prog.trace.use();
    const bind = (unit, tex, name, prog = p) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); prog.i(name, unit); };
    bind(0, this.triTex, 'uTris'); bind(1, this.nodeTex, 'uNodes'); bind(2, this.matTex, 'uMats');
    p.m4('uInvViewProj', camera.invViewProj); p.v3('uCamPos', camera.position); p.v2('uRes', [w, h]);
    p.i('uMaxBounces', this.maxBounces);
    p.v3('uSunDir', env.sunDirection); p.v3('uSunColor', env.sunColor.map((c) => c * env.sunIntensity)); p.f('uSunCone', Math.tan(((env.shadowSoftness ?? 1) * Math.PI) / 180));
    p.v3('uSkyColor', env.skyColor); p.v3('uGroundColor', env.groundColor); p.v3('uHorizon', env.horizonColor); p.v3('uZenith', env.zenithColor); p.f('uAmbient', env.ambient); p.f('uNight', env.night || 0);
    p.i('uLightCount', lights.length);
    gl.uniform4fv(p.u('uLightPos'), LP); gl.uniform4fv(p.u('uLightColor'), LC); gl.uniform4fv(p.u('uLightSpot'), LS);
    p.f('uAperture', this.aperture); p.f('uFocus', this.focus);
    gl.viewport(0, 0, w, h);
    for (let s = 0; s < samplesPerFrame && this.samples < this.maxSamples; s++) {
      const src = this.fb[this.cur], dst = this.fb[1 - this.cur];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      bind(3, src.acc, 'uPrev');
      p.i('uFrame', this.samples);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.cur = 1 - this.cur; this.samples++;
    }
    this.stats.samples = this.samples;
    const acc = this.fb[this.cur].acc;
    // denoise: three a-trous passes, strongest while few samples have landed
    const useFilter = this.denoise && this.samples < 512;
    let filtered = null;
    if (useFilter) {
      const d = this.prog.denoise.use();
      let input = acc, k = 0;
      for (const step of [1, 2, 4]) {
        const out = this.dn[k % 2];
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
        bind(0, input, 'uColor', d); bind(1, this.aux, 'uAux', d); bind(2, this.albedo, 'uAlbedo', d);
        d.i('uStep', step); d.i('uFirst', k === 0 ? 1 : 0); d.f('uSigma', 0.25 + 4 / Math.sqrt(this.samples + 1));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        input = out.t; k++;
      }
      filtered = input;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, r.width, r.height);
    if (split > 0) { gl.enable(gl.SCISSOR_TEST); gl.scissor(Math.round(r.width * split), 0, r.width, r.height); }
    const dp = this.prog.display.use();
    bind(0, acc, 'uAccum', dp); bind(1, filtered || acc, 'uFiltered', dp); bind(2, this.albedo, 'uAlbedo', dp);
    dp.i('uUseFilter', useFilter ? 1 : 0); dp.f('uBlend', useFilter ? Math.max(0, 1 - this.samples / 512) ** 0.5 : 0);
    dp.f('uExposure', (env.exposure ?? 1) * r.settings.exposure); dp.f('uSaturation', r.settings.saturation ?? 1); dp.f('uContrast', r.settings.contrast ?? 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    return this.samples;
  }
}
void Mesh;
