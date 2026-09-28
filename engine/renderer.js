// WebGL2 forward renderer: HDR + MSAA, PBR shading with procedural materials,
// soft PCF sun shadows, procedural sky, bloom, ACES tone mapping, FXAA fallback,
// selection outlines, onion-skin ghosts, particles, debug lines and GPU picking.
import * as S from './shaders.js';
import { mat4, vec3, hexToRGB, srgbToLinear } from './math.js';

const IDENTITY = mat4.create();

class Program {
  constructor(gl, vs, fs) {
    this.gl = gl;
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
        throw new Error('Shader compile error: ' + log + '\n' + lines.slice(0, 20000));
      }
      return s;
    };
    this.p = gl.createProgram();
    gl.attachShader(this.p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(this.p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(this.p);
    if (!gl.getProgramParameter(this.p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(this.p));
    this.loc = new Map();
  }
  use() { this.gl.useProgram(this.p); return this; }
  u(name) { if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.p, name)); return this.loc.get(name); }
  m4(n, v) { this.gl.uniformMatrix4fv(this.u(n), false, v); }
  v3(n, v) { this.gl.uniform3fv(this.u(n), v); }
  v4(n, v) { this.gl.uniform4fv(this.u(n), v); }
  v2(n, v) { this.gl.uniform2fv(this.u(n), v); }
  f(n, v) { this.gl.uniform1f(this.u(n), v); }
  i(n, v) { this.gl.uniform1i(this.u(n), v); }
}

const SHADING = { rendered: 0, material: 0, solid: 1, flat: 2, toon: 3, ghost: 4, normals: 5, wireframe: 1 };
const matCache = new WeakMap();
function matUniforms(m) {
  // cache linear colors per material "version" (cheap string key)
  const key = m.color + m.emissive + m.emissiveStrength + m.patternColor;
  let c = matCache.get(m);
  if (!c || c.key !== key) {
    c = { key, base: srgbToLinear(hexToRGB(m.color)), pat: srgbToLinear(hexToRGB(m.patternColor)), em: srgbToLinear(hexToRGB(m.emissive)).map((v) => v * m.emissiveStrength) };
    matCache.set(m, c);
  }
  return c;
}

export class Renderer {
  constructor(canvas, { pixelRatio = Math.min(window.devicePixelRatio || 1, 2), msaa = 4, shadowSize = 2048, preserveDrawingBuffer = false } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, preserveDrawingBuffer, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.pixelRatio = pixelRatio;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.msaa = Math.min(msaa, gl.getParameter(gl.MAX_SAMPLES));
    this.shadowSize = shadowSize;
    this.stats = { drawCalls: 0, triangles: 0 };
    this.time = 0;
    this.settings = { bloom: true, bloomStrength: 0.22, bloomThreshold: 1.1, vignette: 0.35, grain: 0.012, exposure: 1.0, fxaa: false };
    this.post = { damage: 0, blink: 0, nvg: 0, white: 0, desat: 0, aberration: 0 };
    this.texCache = new WeakMap();
    this.boundsCache = new WeakMap();
    this.frustum = new Float32Array(24);
    this.lightPos = new Float32Array(64); this.lightColor = new Float32Array(64); this.lightDir = new Float32Array(64);
    const P = (vs, fs) => new Program(gl, vs, fs);
    this.prog = {
      main: P(S.COMMON_VS, S.MAIN_FS),
      depth: P(S.COMMON_VS, S.DEPTH_FS),
      pick: P(S.COMMON_VS, S.PICK_FS),
      sky: P(S.FULLSCREEN_VS, S.SKY_FS),
      grid: P(S.GRID_VS, S.GRID_FS),
      line: P(S.LINE_VS, S.LINE_FS),
      particle: P(S.PARTICLE_VS, S.PARTICLE_FS),
      post: P(S.FULLSCREEN_VS, S.POST_FS),
      bright: P(S.FULLSCREEN_VS, S.BRIGHT_FS),
    };
    this.geoCache = new WeakMap();
    this.jointTex = new WeakMap();
    this.emptyVAO = gl.createVertexArray();
    this.lineVAO = gl.createVertexArray(); this.lineBuf = gl.createBuffer();
    gl.bindVertexArray(this.lineVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    this.partVAO = gl.createVertexArray(); this.partBuf = gl.createBuffer();
    gl.bindVertexArray(this.partVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    this.gridVAO = gl.createVertexArray(); const gb = gl.createBuffer();
    gl.bindVertexArray(this.gridVAO); gl.bindBuffer(gl.ARRAY_BUFFER, gb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.ghostTex = [];
    this.identityJoints = this._makeJointTexture(); this._uploadJoints(this.identityJoints, IDENTITY);
    this.whiteTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.whiteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this._initShadow();
    this.width = 0; this.height = 0;
    this.shadowVP = mat4.create();
  }

  // ------------------------------------------------------------------ targets
  _initShadow() {
    const gl = this.gl, s = this.shadowSize;
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, s, s);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  _tex(w, h, fmt) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  _fbo(tex) { const gl = this.gl, f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); return f; }
  resize() {
    const gl = this.gl, c = this.canvas;
    const w = Math.max(1, Math.round(c.clientWidth * this.pixelRatio)), h = Math.max(1, Math.round(c.clientHeight * this.pixelRatio));
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h; c.width = w; c.height = h;
    const fmt = this.hdr ? gl.RGBA16F : gl.RGBA8;
    for (const k of ['msFBO', 'resolveFBO', 'pickFBO', 'b1FBO', 'b2FBO']) if (this[k]) gl.deleteFramebuffer(this[k]);
    for (const k of ['msColor', 'msDepth', 'pickDepth']) if (this[k]) gl.deleteRenderbuffer(this[k]);
    for (const k of ['resolveTex', 'pickTex', 'b1Tex', 'b2Tex']) if (this[k]) gl.deleteTexture(this[k]);
    this.msColor = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.msaa, fmt, w, h);
    this.msDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.msDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.msaa, gl.DEPTH_COMPONENT24, w, h);
    this.msFBO = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFBO);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msDepth);
    this.resolveTex = this._tex(w, h, fmt); this.resolveFBO = this._fbo(this.resolveTex);
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    this.bw = bw; this.bh = bh;
    this.b1Tex = this._tex(bw, bh, fmt); this.b1FBO = this._fbo(this.b1Tex);
    this.b2Tex = this._tex(bw, bh, fmt); this.b2FBO = this._fbo(this.b2Tex);
    this.pickTex = this._tex(w, h, gl.RGBA8); this.pickFBO = this._fbo(this.pickTex);
    this.pickDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ------------------------------------------------------------------ resources
  _geo(g) {
    const gl = this.gl;
    let c = this.geoCache.get(g);
    if (c && c.version === g.version && c.nv === g.vertexCount) return c;
    if (!c) { c = { vao: gl.createVertexArray(), bufs: [gl.createBuffer(), gl.createBuffer(), gl.createBuffer(), gl.createBuffer(), gl.createBuffer(), gl.createBuffer()], ibo: gl.createBuffer(), ebo: null }; this.geoCache.set(g, c); }
    gl.bindVertexArray(c.vao);
    const n = g.vertexCount;
    const attr = (loc, data, size) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, c.bufs[loc]); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr(0, g.positions, 3); attr(1, g.normals, 3); attr(2, g.uvs, 2);
    attr(3, g.joints && g.joints.length === n * 4 ? g.joints : new Float32Array(n * 4), 4);
    let w = g.weights;
    if (!w || w.length !== n * 4) { w = new Float32Array(n * 4); for (let i = 0; i < n; i++) w[i * 4] = 1; }
    attr(4, w, 4);
    attr(5, g.rest && g.rest.length === n * 3 ? g.rest : g.positions, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    c.count = g.indices.length; c.version = g.version; c.nv = n; c.edgeVersion = -1;
    return c;
  }
  _edges(g, c) {
    const gl = this.gl;
    if (c.edgeVersion === g.version) return;
    const I = g.indices, set = new Set(), out = [];
    for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = I[t + e], b = I[t + (e + 1) % 3], k = a < b ? a * 4194304 + b : b * 4194304 + a;
      if (!set.has(k)) { set.add(k); out.push(a, b); }
    }
    if (!c.ebo) c.ebo = gl.createBuffer();
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ebo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(out), gl.STATIC_DRAW);
    c.edgeCount = out.length; c.edgeVersion = g.version;
  }
  _makeJointTexture() {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }
  _uploadJoints(tex, joints) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, joints.length / 16, 0, gl.RGBA, gl.FLOAT, joints);
  }
  _skelTex(sk) {
    let e = this.jointTex.get(sk);
    if (!e) { e = { tex: this._makeJointTexture(), version: -1 }; this.jointTex.set(sk, e); }
    if (e.version !== sk.version) { this._uploadJoints(e.tex, sk.joints); e.version = sk.version; }
    return e.tex;
  }

  // ------------------------------------------------------------------ helpers
  collect(scene) {
    const list = [];
    const walk = (n, vis) => {
      vis = vis && n.visible;
      if (!vis) return;
      if (n.geometry) list.push(n);
      for (const c of n.children) walk(c, vis);
    };
    walk(scene, true);
    return list;
  }
  _bindMesh(p, mesh, jointTexOverride) {
    const gl = this.gl;
    if (mesh.skeleton && mesh.skinRoot) {
      p.m4('uModel', mesh.skinRoot.world); p.m4('uLocal', mesh.local); p.i('uSkinned', 1);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, jointTexOverride || this._skelTex(mesh.skeleton));
    } else {
      p.m4('uModel', mesh.world); p.m4('uLocal', IDENTITY); p.i('uSkinned', 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.identityJoints);
    }
    p.i('uJointTex', 1);
  }
  _draw(g, wire = false) {
    const gl = this.gl, c = this._geo(g);
    gl.bindVertexArray(c.vao);
    if (wire) { this._edges(g, c); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ebo); gl.drawElements(gl.LINES, c.edgeCount, gl.UNSIGNED_INT, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ibo); }
    else { gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, 0); this.stats.triangles += c.count / 3; }
    this.stats.drawCalls++;
  }
  _setMaterial(p, m) {
    const c = matUniforms(m);
    p.v3('uBaseColor', c.base); p.f('uMetallic', m.metallic); p.f('uRoughness', m.roughness); p.v3('uEmissive', c.em);
    p.i('uPattern', m.patternIndex); p.f('uPatternScale', m.patternScale); p.v3('uPatternColor', c.pat); p.f('uPatternStrength', m.patternStrength);
    p.f('uBump', m.bump); p.f('uSheen', m.sheen); p.i('uDoubleSided', m.doubleSided ? 1 : 0); p.f('uOpacity', m.opacity);
    p.i('uUnlit', m.unlit ? 1 : 0); p.i('uAdditive', m.blend === 'add' ? 1 : 0); p.i('uWorldPattern', m.worldPattern ? 1 : 0);
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    if (m.texture) { gl.bindTexture(gl.TEXTURE_2D, this._texture(m.texture)); p.i('uHasTex', 1); p.f('uAlphaTest', m.alphaTest || 0); }
    else { gl.bindTexture(gl.TEXTURE_2D, this.whiteTex); p.i('uHasTex', 0); }
    p.i('uTex', 2);
  }
  _texture(img) {
    let t = this.texCache.get(img);
    if (t && !img.dirty) return t;
    const gl = this.gl;
    if (!t) { t = gl.createTexture(); this.texCache.set(img, t); }
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const an = gl.getExtension('EXT_texture_filter_anisotropic');
    if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    img.dirty = false;
    return t;
  }
  // bounding sphere (local space) of a geometry, cached per version
  _bounds(g) {
    let b = this.boundsCache.get(g);
    if (b && b.version === g.version) return b;
    const P = g.positions; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
    const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    let r = 0; for (let i = 0; i < P.length; i += 3) r = Math.max(r, (P[i] - c[0]) ** 2 + (P[i + 1] - c[1]) ** 2 + (P[i + 2] - c[2]) ** 2);
    b = { c, r: Math.sqrt(r), version: g.version }; this.boundsCache.set(g, b);
    return b;
  }
  // world bounding sphere of a mesh: skinned meshes use their character root + a radius
  worldSphere(m, out) {
    if (m.skinRoot) { const w = m.skinRoot.world; out[0] = w[12]; out[1] = w[13] + 1; out[2] = w[14]; out[3] = m.skinRoot.cullRadius || 2.2; return out; }
    const b = this._bounds(m.geometry), w = m.world, c = b.c;
    out[0] = w[0] * c[0] + w[4] * c[1] + w[8] * c[2] + w[12];
    out[1] = w[1] * c[0] + w[5] * c[1] + w[9] * c[2] + w[13];
    out[2] = w[2] * c[0] + w[6] * c[1] + w[10] * c[2] + w[14];
    const sc = Math.sqrt(Math.max(w[0] * w[0] + w[1] * w[1] + w[2] * w[2], w[4] * w[4] + w[5] * w[5] + w[6] * w[6], w[8] * w[8] + w[9] * w[9] + w[10] * w[10]));
    out[3] = b.r * sc;
    return out;
  }
  _setFrustum(m) {
    const f = this.frustum;
    const row = (r) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
    const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
    [[1, r0], [-1, r0], [1, r1], [-1, r1], [1, r2], [-1, r2]].forEach(([sg, r], i) => {
      const a = r3[0] + sg * r[0], b = r3[1] + sg * r[1], c = r3[2] + sg * r[2], d = r3[3] + sg * r[3];
      const l = Math.hypot(a, b, c) || 1;
      f[i * 4] = a / l; f[i * 4 + 1] = b / l; f[i * 4 + 2] = c / l; f[i * 4 + 3] = d / l;
    });
  }
  _inFrustum(sph) {
    const f = this.frustum;
    for (let i = 0; i < 6; i++) if (f[i * 4] * sph[0] + f[i * 4 + 1] * sph[1] + f[i * 4 + 2] * sph[2] + f[i * 4 + 3] < -sph[3]) return false;
    return true;
  }
  _uploadLights(p, env, camera) {
    const cp = camera.position;
    const sph = [0, 0, 0, 0];
    const list = (env.lights || []).filter((L) => {
      if (L.enabled === false || !(L.intensity > 0)) return false;
      if (L === env.shadowLight || L.priority) return true;
      sph[0] = L.position[0]; sph[1] = L.position[1]; sph[2] = L.position[2]; sph[3] = L.range;
      return this._inFrustum(sph);
    });
    const score = (L) => (L === env.shadowLight || L.priority ? -1e9 : Math.hypot(L.position[0] - cp[0], L.position[1] - cp[1], L.position[2] - cp[2]) - L.range * 0.5);
    list.sort((a, b) => score(a) - score(b));
    if (list.length > 16) list.length = 16;
    let shadowIdx = -1;
    list.forEach((L, i) => {
      this.lightPos.set([L.position[0], L.position[1], L.position[2], L.range], i * 4);
      const c = L.color, k = L.intensity;
      const outer = L.spot ? Math.cos(L.spot.angle) : -2, inner = L.spot ? Math.cos(L.spot.inner ?? L.spot.angle * 0.6) : 1;
      this.lightColor.set([c[0] * k, c[1] * k, c[2] * k, outer], i * 4);
      const d = L.spot ? L.spot.direction : [0, -1, 0];
      this.lightDir.set([d[0], d[1], d[2], inner], i * 4);
      if (L === env.shadowLight) shadowIdx = i;
    });
    p.i('uNumLights', list.length);
    const gl = this.gl;
    gl.uniform4fv(p.u('uLightPos'), this.lightPos); gl.uniform4fv(p.u('uLightColor'), this.lightColor); gl.uniform4fv(p.u('uLightDir'), this.lightDir);
    p.i('uShadowLight', shadowIdx);
    this.stats.lights = list.length;
  }
  _computeSpotShadowVP(L) {
    const d = L.spot.direction, P = L.position;
    const up = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    const view = mat4.lookAt(mat4.create(), P, [P[0] + d[0], P[1] + d[1], P[2] + d[2]], up);
    const proj = mat4.perspective(mat4.create(), Math.min(2.8, L.spot.angle * 2.1), 1, 0.1, L.range);
    mat4.multiply(this.shadowVP, proj, view);
  }
  _computeShadowVP(env) {
    const L = env.sunDirection, c = env.shadowCenter, r = env.shadowRadius;
    const view = mat4.lookAt(mat4.create(), [c[0] + L[0] * r * 3, c[1] + L[1] * r * 3, c[2] + L[2] * r * 3], c, Math.abs(L[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]);
    // snap to texel grid (prevents shimmering while the camera/character moves)
    const texel = (2 * r) / this.shadowSize;
    view[12] = Math.round(view[12] / texel) * texel; view[13] = Math.round(view[13] / texel) * texel;
    const proj = mat4.ortho(mat4.create(), -r, r, -r, r, 0.1, r * 6);
    mat4.multiply(this.shadowVP, proj, view);
    return texel;
  }

  // ------------------------------------------------------------------ main render
  render(scene, camera, o = {}) {
    const gl = this.gl;
    this.resize();
    this.stats.drawCalls = 0; this.stats.triangles = 0;
    this.time = o.time ?? this.time + 1 / 60;
    const env = scene.environment;
    const shading = o.shading || 'rendered';
    const lit = shading === 'rendered' || shading === 'material' || shading === 'toon';
    scene.updateWorld();
    camera.update(this.width / this.height);
    const meshes = this.collect(scene);
    const shadows = lit && o.shadows !== false && shading !== 'material';

    // shadow pass
    const spotShadow = env.shadowLight && env.shadowLight.spot && env.shadowLight.intensity > 0 && env.shadowLight.enabled !== false ? env.shadowLight : null;
    if (shadows) {
      if (spotShadow) this._computeSpotShadowVP(spotShadow); else this._computeShadowVP(env);
      this._setFrustum(this.shadowVP);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3.0);
      const p = this.prog.depth.use();
      p.m4('uViewProj', this.shadowVP); p.m4('uShadowVP', this.shadowVP); p.f('uInflate', 0);
      const sph = [0, 0, 0, 0];
      for (const m of meshes) {
        if (!m.castShadow || (m.material && (m.material.opacity < 0.5 || m.material.blend === 'add' || m.material.unlit))) continue;
        if (!this._inFrustum(this.worldSphere(m, sph))) continue;
        if (m.material?.doubleSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
        this._bindMesh(p, m); this._draw(m.geometry);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      this.stats.drawCalls = 0; this.stats.triangles = 0;
    }

    // main pass (HDR, MSAA)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFBO);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.1, 0.1, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // background
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    {
      const p = this.prog.sky.use();
      p.m4('uInvViewProj', camera.invViewProj); p.v3('uSunDir', env.sunDirection); p.v3('uSunColor', env.sunColor.map((v) => v * 1.2));
      p.v3('uHorizon', env.horizonColor); p.v3('uZenith', env.zenithColor); p.v3('uGroundColor', env.groundColor); p.i('uClouds', env.clouds ? 1 : 0); p.f('uTime', this.time);
      p.i('uMesas', env.mesas === false ? 0 : 1); p.f('uStorm', env.storm || 0); p.f('uFlash', env.flash || 0);
      const editorBg = o.background === 'editor' || (!lit && o.background !== 'sky');
      p.i('uMode', editorBg ? 1 : 0);
      p.v3('uTop', srgbToLinear([0.24, 0.24, 0.25])); p.v3('uBottom', srgbToLinear([0.16, 0.16, 0.17]));
      if (env.sky !== false || !lit) { gl.bindVertexArray(this.emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      else { const f = env.fogColor; gl.clearColor(f[0], f[1], f[2], 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    }
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    const p = this.prog.main.use();
    p.m4('uViewProj', camera.viewProj); p.m4('uShadowVP', this.shadowVP); p.v3('uCamPos', camera.position);
    const sunI = env.sunIntensity;
    p.v3('uSunDir', env.sunDirection); p.v3('uSunColor', env.sunColor.map((v) => v * sunI)); p.v3('uSkyColor', env.skyColor); p.v3('uGroundColor', env.groundColor);
    p.f('uAmbient', env.ambient); p.v3('uHorizon', env.horizonColor); p.v3('uZenith', env.zenithColor);
    p.v3('uFogColor', env.fogColor); p.f('uFogDensity', o.fog === false ? 0 : env.fogDensity);
    p.i('uShadows', shadows ? 1 : 0); p.f('uShadowTexel', 1 / this.shadowSize); p.f('uTime', this.time);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); p.i('uShadowMap', 0);
    p.f('uInflate', 0);
    p.f('uShadowBias', spotShadow ? 0.00015 : 0.0008); p.f('uWet', env.wet || 0);
    this._setFrustum(camera.viewProj);
    this._uploadLights(p, env, camera);
    const shadeMode = SHADING[shading] ?? 0;
    const xray = !!o.xray;
    const drawOpaque = shading !== 'wireframe';
    const drawList = (list, cull) => {
      const sph = [0, 0, 0, 0];
      const vis = cull ? list.filter((m) => this._inFrustum(this.worldSphere(m, sph))) : list;
      const isT = (m) => m.material.opacity < 1 || m.material.blend === 'add';
      const sorted = xray ? vis : vis.filter((m) => !isT(m)).concat(vis.filter(isT));
      if (xray) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      for (const m of sorted) {
        const mat = m.material;
        const add = mat.blend === 'add';
        const transparent = xray || mat.opacity < 1 || add;
        if (transparent) { gl.enable(gl.BLEND); if (add) { gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false); } else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
        if (mat.doubleSided || transparent) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
        this._setMaterial(p, mat);
        if (xray) p.f('uOpacity', 0.35);
        p.i('uShading', m.userData.shading ?? shadeMode);
        if (m.userData.flatColor) p.v4('uFlatColor', m.userData.flatColor);
        this._bindMesh(p, m);
        this._draw(m.geometry);
        if (transparent && !xray) { gl.disable(gl.BLEND); gl.depthMask(true); }
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
    };
    if (drawOpaque) drawList(meshes, o.cull !== false);
    // wireframe (full mode or overlay)
    if (shading === 'wireframe' || o.wireOverlay) {
      gl.disable(gl.CULL_FACE);
      p.i('uShading', 2);
      if (shading === 'wireframe') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
      for (const m of meshes) {
        const sel = o.selected && o.selected.has(m);
        p.v4('uFlatColor', sel ? [1, 0.45, 0.1, 1] : shading === 'wireframe' ? [0.05, 0.05, 0.05, 0.9] : [0.02, 0.02, 0.02, 0.35]);
        if (o.wireOverlay && shading !== 'wireframe') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
        this._bindMesh(p, m); this._draw(m.geometry, true);
      }
      gl.disable(gl.BLEND);
    }
    // editor grid
    if (o.grid) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      const g = this.prog.grid.use();
      const ext = Math.max(50, vec3.dist(camera.position, camera.target) * 8);
      g.m4('uViewProj', camera.viewProj); g.v3('uCamPos', camera.position); g.f('uExtent', ext); g.v3('uCenter', [Math.round(camera.target[0]), 0, Math.round(camera.target[2])]);
      gl.bindVertexArray(this.gridVAO); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    // onion-skin ghosts
    if (o.ghosts && o.ghosts.length) {
      p.use();
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      p.i('uShading', 4);
      o.ghosts.forEach((gh, k) => {
        if (!this.ghostTex[k]) this.ghostTex[k] = this._makeJointTexture();
        this._uploadJoints(this.ghostTex[k], gh.joints);
        p.v4('uFlatColor', gh.color);
        for (const m of gh.meshes) { if (!m.visible) continue; this._bindMesh(p, m, this.ghostTex[k]); this._draw(m.geometry); }
      });
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    // selection outlines (inverted hull)
    if (o.selected && o.selected.size && shading !== 'wireframe') {
      p.use();
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
      p.i('uShading', 2);
      for (const m of o.selected) {
        if (!m.visible || !m.geometry) continue;
        const pos = m.skinRoot ? m.skinRoot.worldPosition() : m.worldPosition();
        const d = camera.ortho ? camera.orthoSize * 2 : vec3.dist(camera.position, pos);
        p.f('uInflate', d * 0.0025 * (this.height > 0 ? 900 / this.height : 1));
        p.v4('uFlatColor', m === o.active ? [1.0, 0.63, 0.25, 1] : [0.95, 0.35, 0.05, 1]);
        this._bindMesh(p, m); this._draw(m.geometry);
      }
      p.f('uInflate', 0);
      gl.cullFace(gl.BACK);
    }
    // overlay meshes (bones, gizmos)
    if (o.overlayMeshes && o.overlayMeshes.length) {
      p.use();
      for (const it of o.overlayMeshes) {
        if (it.depthTest === false) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
        if (it.color[3] < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
        p.m4('uModel', it.matrix); p.m4('uLocal', IDENTITY); p.i('uSkinned', 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.identityJoints); p.i('uJointTex', 1);
        p.i('uShading', it.shading === 'flat' ? 2 : 1); p.i('uPattern', 0); p.v3('uBaseColor', it.color.slice(0, 3)); p.f('uOpacity', it.color[3]); p.v4('uFlatColor', it.color); p.f('uRoughness', 0.5); p.i('uDoubleSided', 0);
        this._draw(it.geometry, !!it.wire);
      }
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    }
    // particles
    const plist = !o.particles ? [] : Array.isArray(o.particles) ? o.particles : [o.particles];
    for (const ps of plist) {
      if (!ps.count) continue;
      const pp = this.prog.particle.use();
      pp.m4('uViewProj', camera.viewProj); pp.f('uScale', this.height * 0.8);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, ps.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.bindVertexArray(this.partVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      gl.bufferData(gl.ARRAY_BUFFER, ps.data.subarray(0, ps.count * 8), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, ps.count);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    // lines
    if (o.lines) for (const L of o.lines) this.drawLines(camera, L.data, L.depthTest !== false, L.alpha ?? 1, L.additive);
    // first-person view model: its own projection, drawn over a cleared depth buffer so it never clips into walls
    if (o.viewmodel && o.viewmodel.root.visible) {
      const vc = o.viewmodel.camera;
      vc.update(this.width / this.height);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      p.use();
      p.m4('uViewProj', vc.viewProj); p.v3('uCamPos', vc.position);
      drawList(this.collect(o.viewmodel.root), false);
      if (o.viewmodel.particles) for (const ps of o.viewmodel.particles) {
        if (!ps.count) continue;
        const pp = this.prog.particle.use();
        pp.m4('uViewProj', vc.viewProj); pp.f('uScale', this.height * 0.8);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, ps.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        gl.bindVertexArray(this.partVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
        gl.bufferData(gl.ARRAY_BUFFER, ps.data.subarray(0, ps.count * 8), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.POINTS, 0, ps.count);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
    }

    // resolve + bloom + post
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFBO); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFBO);
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.emptyVAO);
    const bloom = this.settings.bloom && lit;
    if (bloom) {
      const b = this.prog.bright.use();
      gl.viewport(0, 0, this.bw, this.bh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.b1FBO); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.resolveTex);
      b.i('uColor', 0); b.i('uPass', 0); b.v2('uTexel', [1 / this.width * 2, 1 / this.height * 2]); b.f('uThreshold', this.settings.bloomThreshold);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (let it = 0; it < 2; it++) {
        b.i('uPass', 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.b2FBO); gl.bindTexture(gl.TEXTURE_2D, this.b1Tex); b.v2('uTexel', [1 / this.bw, 0]); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.b1FBO); gl.bindTexture(gl.TEXTURE_2D, this.b2Tex); b.v2('uTexel', [0, 1 / this.bh]); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const pp = this.prog.post.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.resolveTex); pp.i('uColor', 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.b1Tex); pp.i('uBloom', 1);
    pp.f('uBloomStrength', bloom ? this.settings.bloomStrength : 0);
    pp.f('uExposure', (env.exposure ?? 1) * this.settings.exposure); pp.f('uVignette', lit ? this.settings.vignette : 0); pp.f('uGrain', lit ? this.settings.grain : 0);
    pp.f('uTime', this.time); pp.i('uTonemap', 1); pp.v2('uTexel', [1 / this.width, 1 / this.height]); pp.i('uFXAA', this.msaa < 2 || this.settings.fxaa ? 1 : 0);
    const po = this.post;
    pp.f('uDamage', po.damage); pp.f('uBlink', po.blink); pp.f('uNVG', po.nvg); pp.f('uWhite', po.white); pp.f('uDesat', po.desat); pp.f('uAberration', po.aberration);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // data: Float32Array of [x,y,z, r,g,b,a] per vertex, pairs form segments
  drawLines(camera, data, depthTest = true, alpha = 1, additive = false) {
    if (!data || !data.length) return;
    const gl = this.gl, p = this.prog.line.use();
    p.m4('uViewProj', camera.viewProj); p.f('uAlpha', alpha);
    if (depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.lineVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, data.length / 7);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  }

  // GPU picking. items: [{mesh, id}] and/or [{geometry, matrix, id, onTop}]
  pick(camera, x, y, items) {
    const gl = this.gl;
    this.resize();
    camera.update(this.width / this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFBO);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    const p = this.prog.pick.use();
    p.m4('uViewProj', camera.viewProj); p.m4('uShadowVP', IDENTITY); p.f('uInflate', 0);
    const col = (id) => [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255, 1];
    const draw = (it) => {
      p.v4('uFlatColor', col(it.id));
      if (it.mesh) this._bindMesh(p, it.mesh); else { p.m4('uModel', it.matrix); p.m4('uLocal', IDENTITY); p.i('uSkinned', 0); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.identityJoints); p.i('uJointTex', 1); }
      this._draw(it.mesh ? it.mesh.geometry : it.geometry);
    };
    for (const it of items) if (!it.onTop) draw(it);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    for (const it of items) if (it.onTop) draw(it);
    const px = new Uint8Array(4);
    const X = Math.round(x * this.pixelRatio), Y = this.height - 1 - Math.round(y * this.pixelRatio);
    gl.readPixels(X, Y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px[3] ? px[0] + (px[1] << 8) + (px[2] << 16) : 0;
  }
}
