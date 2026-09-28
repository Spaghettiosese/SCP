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
    this.stats = { drawCalls: 0, triangles: 0, culled: 0, gpuMs: 0, cpuMs: 0, scale: 1, lod: 0 };
    this.time = 0;
    this.settings = {
      bloom: true, bloomStrength: 0.22, bloomThreshold: 1.1, vignette: 0.35, grain: 0.012, exposure: 1.0, fxaa: false, ssao: true, godRays: true, culling: true,
      // V3
      ssr: true, ssrStrength: 1, ssrMaxRoughness: 0.5, volumetrics: true, contactShadows: true, softShadows: true,
      saturation: 1.06, contrast: 1.04, temperature: 0, sharpen: 0.18, aberration: 0.35,
      renderScale: 1, adaptiveResolution: false, targetFps: 55, minScale: 0.5, sortDraws: true,
    };
    this.post = { damage: 0, blink: 0, nvg: 0, white: 0, desat: 0, aberration: 0 };
    this.texCache = new WeakMap();
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
      gbuf: P(S.COMMON_VS, S.GBUF_FS),
      ssao: P(S.FULLSCREEN_VS, S.SSAO_FS),
      aoblur: P(S.FULLSCREEN_VS, S.AOBLUR_FS),
      ssr: P(S.FULLSCREEN_VS, S.SSR_FS),
      volume: P(S.FULLSCREEN_VS, S.VOLUME_FS),
      bilateral: P(S.FULLSCREEN_VS, S.BILATERAL_FS),
      composite: P(S.FULLSCREEN_VS, S.COMPOSITE_FS),
    };
    // raw-depth sampler for PCSS blocker search on the (comparison) shadow map
    this.rawSampler = gl.createSampler();
    gl.samplerParameteri(this.rawSampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.samplerParameteri(this.rawSampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.rawSampler, gl.TEXTURE_COMPARE_MODE, gl.NONE);
    gl.samplerParameteri(this.rawSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.samplerParameteri(this.rawSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2'); this._queries = [];
    this._frameT = []; this._scaleT = 0;
    this.instCache = new WeakMap();
    // SSAO hemisphere kernel, denser near the centre
    this.aoKernel = new Float32Array(48);
    for (let i = 0; i < 16; i++) {
      let v; do { v = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()]; } while (Math.hypot(...v) > 1 || Math.hypot(...v) < 0.1);
      const s = 0.1 + 0.9 * (i / 16) ** 2; this.aoKernel.set(v.map((x) => x * s), i * 3);
    }
    this.lightU = { pos: new Float32Array(64), col: new Float32Array(64), spot: new Float32Array(64) };
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
    const pr = this.pixelRatio * (this.settings.renderScale || 1);
    const w = Math.max(1, Math.round(c.clientWidth * pr)), h = Math.max(1, Math.round(c.clientHeight * pr));
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h; c.width = w; c.height = h;
    const fmt = this.hdr ? gl.RGBA16F : gl.RGBA8;
    for (const k of ['msFBO', 'resolveFBO', 'pickFBO', 'b1FBO', 'b2FBO', 'gFBO', 'ao1FBO', 'ao2FBO', 'compFBO', 'ssr1FBO', 'ssr2FBO', 'vol1FBO', 'vol2FBO', 'c1FBO', 'c2FBO', 'd1FBO', 'd2FBO']) if (this[k]) gl.deleteFramebuffer(this[k]);
    for (const k of ['msColor', 'msDepth', 'pickDepth', 'gDepth']) if (this[k]) gl.deleteRenderbuffer(this[k]);
    for (const k of ['resolveTex', 'pickTex', 'b1Tex', 'b2Tex', 'gTex', 'gMatTex', 'ao1Tex', 'ao2Tex', 'compTex', 'ssr1Tex', 'ssr2Tex', 'vol1Tex', 'vol2Tex', 'c1Tex', 'c2Tex', 'd1Tex', 'd2Tex']) if (this[k]) gl.deleteTexture(this[k]);
    // half-resolution normal+depth buffer and AO targets (V2 ambient occlusion)
    const gw = Math.max(1, w >> 1), gh = Math.max(1, h >> 1);
    this.gw = gw; this.gh = gh;
    this.gTex = this._tex(gw, gh, this.hdr ? gl.RGBA16F : gl.RGBA8); this.gFBO = this._fbo(this.gTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.gDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.gDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gw, gh);
    // second G-buffer target: roughness, metallic, puddles (V3 reflections)
    this.gMatTex = this._tex(gw, gh, gl.RGBA8);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gFBO); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.gDepth);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.gMatTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    const hfmt = this.hdr ? gl.RGBA16F : gl.RGBA8;
    this.ssr1Tex = this._tex(gw, gh, hfmt); this.ssr1FBO = this._fbo(this.ssr1Tex);
    this.ssr2Tex = this._tex(gw, gh, hfmt); this.ssr2FBO = this._fbo(this.ssr2Tex);
    this.vol1Tex = this._tex(gw, gh, hfmt); this.vol1FBO = this._fbo(this.vol1Tex);
    this.vol2Tex = this._tex(gw, gh, hfmt); this.vol2FBO = this._fbo(this.vol2Tex);
    this.ao1Tex = this._tex(gw, gh, gl.RGBA8); this.ao1FBO = this._fbo(this.ao1Tex);
    this.ao2Tex = this._tex(gw, gh, gl.RGBA8); this.ao2FBO = this._fbo(this.ao2Tex);
    this.msColor = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.msaa, fmt, w, h);
    this.msDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.msDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.msaa, gl.DEPTH_COMPONENT24, w, h);
    this.msFBO = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFBO);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msDepth);
    this.resolveTex = this._tex(w, h, fmt); this.resolveFBO = this._fbo(this.resolveTex);
    this.compTex = this._tex(w, h, fmt); this.compFBO = this._fbo(this.compTex);
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    this.bw = bw; this.bh = bh;
    this.b1Tex = this._tex(bw, bh, fmt); this.b1FBO = this._fbo(this.b1Tex);
    this.b2Tex = this._tex(bw, bh, fmt); this.b2FBO = this._fbo(this.b2Tex);
    // wider bloom levels (1/8 and 1/16) for soft halos around lamps and the sun
    this.cw = Math.max(1, bw >> 1); this.ch = Math.max(1, bh >> 1); this.dw = Math.max(1, bw >> 2); this.dh = Math.max(1, bh >> 2);
    this.c1Tex = this._tex(this.cw, this.ch, fmt); this.c1FBO = this._fbo(this.c1Tex); this.c2Tex = this._tex(this.cw, this.ch, fmt); this.c2FBO = this._fbo(this.c2Tex);
    this.d1Tex = this._tex(this.dw, this.dh, fmt); this.d1FBO = this._fbo(this.d1Tex); this.d2Tex = this._tex(this.dw, this.dh, fmt); this.d2FBO = this._fbo(this.d2Tex);
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
    this.lights = [];
    const walk = (n, vis) => {
      vis = vis && n.visible;
      if (!vis) return;
      if (n.isLight) this.lights.push(n);
      if (n.geometry) list.push(n);
      for (const c of n.children) walk(c, vis);
    };
    walk(scene, true);
    return list;
  }
  _bindMesh(p, mesh, jointTexOverride) {
    const gl = this.gl;
    p.i('uInstanced', mesh.instanceMatrices ? 1 : 0);
    if (mesh.skeleton && mesh.skinRoot) {
      p.m4('uModel', mesh.skinRoot.world); p.m4('uLocal', mesh.local); p.i('uSkinned', 1);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, jointTexOverride || this._skelTex(mesh.skeleton));
    } else {
      p.m4('uModel', mesh.world); p.m4('uLocal', IDENTITY); p.i('uSkinned', 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.identityJoints);
    }
    p.i('uJointTex', 1);
  }
  _instVAO(im) {
    const gl = this.gl, c = this._geo(im.geometry);
    let e = this.instCache.get(im);
    if (!e) { e = { vao: gl.createVertexArray(), buf: gl.createBuffer(), version: -1, geoVersion: -1 }; this.instCache.set(im, e); }
    if (e.geoVersion !== c.version) {
      gl.bindVertexArray(e.vao);
      const sizes = [3, 3, 2, 4, 4, 3];
      for (let loc = 0; loc < 6; loc++) { gl.bindBuffer(gl.ARRAY_BUFFER, c.bufs[loc]); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, sizes[loc], gl.FLOAT, false, 0, 0); }
      gl.bindBuffer(gl.ARRAY_BUFFER, e.buf);
      for (let k = 0; k < 4; k++) { gl.enableVertexAttribArray(6 + k); gl.vertexAttribPointer(6 + k, 4, gl.FLOAT, false, 64, k * 16); gl.vertexAttribDivisor(6 + k, 1); }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ibo);
      gl.bindVertexArray(null);
      e.geoVersion = c.version; e.version = -1;
    }
    if (e.version !== im.instanceVersion) { gl.bindBuffer(gl.ARRAY_BUFFER, e.buf); gl.bufferData(gl.ARRAY_BUFFER, im.instanceMatrices, gl.DYNAMIC_DRAW); e.version = im.instanceVersion; }
    return { e, c };
  }
  _drawMesh(m, wire = false) {
    if (m.instanceMatrices) {
      if (wire || !m.count) return;
      const gl = this.gl, { e, c } = this._instVAO(m);
      gl.bindVertexArray(e.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, 0, m.count);
      this.stats.triangles += (c.count / 3) * m.count; this.stats.drawCalls++;
      return;
    }
    this._draw(m.lods ? this._lod(m) : m.geometry, wire);
  }
  // Level of detail: mesh.lods = [{ distance, geometry }, ...] swaps in cheaper geometry far away.
  _lod(m) {
    const d = vec3.dist(mat4.getTranslation([0, 0, 0], m.world), this._camPos || [0, 0, 0]);
    let g = m.geometry;
    for (const l of m.lods) if (d >= l.distance) { g = l.geometry; }
    if (g !== m.geometry) this.stats.lod++;
    return g;
  }
  // Bounding sphere of a drawable in world space (for frustum culling)
  _sphere(m) {
    const g = m.geometry;
    if (!g._bs || g._bs.v !== g.version) {
      const b = g.bounds(), c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      g._bs = { v: g.version, c, r: vec3.dist(b.min, b.max) / 2 };
    }
    let M = m.world, extra = 1;
    if (m.skeleton && m.skinRoot) { M = m.skinRoot.world; extra = 2.2; } // posed limbs can swing well outside the bind pose
    let c = g._bs.c, r = g._bs.r;
    if (m.instanceMatrices) {
      if (!m._ibs || m._ibs.v !== m.instanceVersion) {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], I = m.instanceMatrices;
        let sc = 1;
        for (let i = 0; i < m.count; i++) { for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], I[i * 16 + 12 + k]); max[k] = Math.max(max[k], I[i * 16 + 12 + k]); } sc = Math.max(sc, Math.hypot(I[i * 16], I[i * 16 + 1], I[i * 16 + 2])); }
        m._ibs = { v: m.instanceVersion, c: min.map((v, k) => (v + max[k]) / 2), r: vec3.dist(min, max) / 2 + g._bs.r * sc };
      }
      c = m._ibs.c; r = m._ibs.r;
    }
    const wc = vec3.transformMat4([0, 0, 0], c, M);
    const s = Math.max(Math.hypot(M[0], M[1], M[2]), Math.hypot(M[4], M[5], M[6]), Math.hypot(M[8], M[9], M[10]));
    return { c: wc, r: r * s * extra + (m.skeleton ? 0.3 : 0) };
  }
  _frustum(vp) {
    const P = [];
    for (const [a, sgn] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1]]) {
      const p = [vp[3] + sgn * vp[a], vp[7] + sgn * vp[4 + a], vp[11] + sgn * vp[8 + a], vp[15] + sgn * vp[12 + a]];
      const l = Math.hypot(p[0], p[1], p[2]) || 1; P.push(p.map((x) => x / l));
    }
    return P;
  }
  _visible(m, planes) {
    const s = this._sphere(m);
    for (const p of planes) if (p[0] * s.c[0] + p[1] * s.c[1] + p[2] * s.c[2] + p[3] < -s.r) return false;
    return true;
  }
  _gatherLights(camera, env) {
    const U = this.lightU, lights = (this.lights || []).filter((l) => l.intensity > 0);
    const cp = camera.position, t = this.time;
    const planes = this._frustum(camera.viewProj);
    const withD = lights.map((l) => { const p = mat4.getTranslation([0, 0, 0], l.world); return { l, p, d: vec3.dist(p, cp) - l.range }; });
    for (const l of env.dynLights || []) {
      if (!(l.intensity > 0) || l.enabled === false) continue;
      const p = l.position;
      if (!l.priority && planes.some((q) => q[0] * p[0] + q[1] * p[1] + q[2] * p[2] + q[3] < -l.range)) continue;
      withD.push({ l, p, d: l.priority ? -1e9 : vec3.dist(p, cp) - l.range, dyn: true });
    }
    withD.sort((a, b) => a.d - b.d); withD.length = Math.min(withD.length, 16);
    withD.forEach(({ l, p, dyn }, i) => {
      if (dyn) {
        const c = l.color, k = l.intensity;
        U.pos.set([p[0], p[1], p[2], l.range], i * 4);
        U.col.set([c[0] * k, c[1] * k, c[2] * k, l.spot ? 1 : 0], i * 4);
        const d = l.spot ? l.spot.direction : [0, -1, 0];
        U.spot.set([d[0], d[1], d[2], l.spot ? Math.cos(l.spot.angle) : 0], i * 4);
        return;
      }
      const col = srgbToLinear(hexToRGB(l.color));
      const f = l.flicker ? 1 - l.flicker * (0.18 + 0.12 * Math.sin(t * 13 + l.seed) + 0.1 * Math.sin(t * 29.3 + l.seed * 3) + 0.06 * Math.sin(t * 57 + l.seed)) : 1;
      U.pos.set([p[0], p[1], p[2], l.range], i * 4);
      U.col.set([col[0] * l.intensity * f, col[1] * l.intensity * f, col[2] * l.intensity * f, l.type === 'spot' ? 1 : 0], i * 4);
      const d = vec3.normalize([0, 0, 0], vec3.transformDir([0, 0, 0], [0, -1, 0], l.world));
      U.spot.set([d[0], d[1], d[2], Math.cos((l.angle * Math.PI) / 180)], i * 4);
    });
    return env.lights === false ? 0 : withD.length;
  }
  _draw(g, wire = false) {
    const gl = this.gl, c = this._geo(g);
    gl.bindVertexArray(c.vao);
    if (wire) { this._edges(g, c); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ebo); gl.drawElements(gl.LINES, c.edgeCount, gl.UNSIGNED_INT, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ibo); }
    else { gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, 0); this.stats.triangles += c.count / 3; }
    this.stats.drawCalls++;
  }
  _setMaterial(p, m) {
    if (this._lastMat === m && this._lastProg === p) return; // sorted draws share material state
    this._lastMat = m; this._lastProg = p;
    const c = matUniforms(m);
    p.v3('uBaseColor', c.base); p.f('uMetallic', m.metallic); p.f('uRoughness', m.roughness); p.v3('uEmissive', c.em);
    p.i('uPattern', m.patternIndex); p.f('uPatternScale', m.patternScale); p.v3('uPatternColor', c.pat); p.f('uPatternStrength', m.patternStrength);
    p.f('uBump', m.bump); p.f('uSheen', m.sheen); p.i('uDoubleSided', m.doubleSided ? 1 : 0); p.f('uOpacity', m.opacity);
    p.i('uUnlit', m.unlit ? 1 : 0); p.i('uAdditive', m.blend === 'add' ? 1 : 0); p.i('uWorldPattern', m.worldPattern ? 1 : 0);
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE5);
    if (m.texture) { gl.bindTexture(gl.TEXTURE_2D, this._texture(m.texture)); p.i('uHasTex', 1); p.f('uAlphaTest', m.alphaTest || 0); }
    else { gl.bindTexture(gl.TEXTURE_2D, this.whiteTex); p.i('uHasTex', 0); }
    p.i('uTex', 5);
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
    const an = gl.getExtension('EXT_texture_filter_anisotropic');
    if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    img.dirty = false;
    return t;
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
    const t0 = performance.now();
    this._adapt(t0);
    this.resize();
    this.stats.drawCalls = 0; this.stats.triangles = 0; this.stats.lod = 0;
    this._lastMat = null; this._lastProg = null; this._camPos = camera.position;
    this._beginGpuTimer();
    this.time = o.time ?? this.time + 1 / 60;
    const env = scene.environment;
    const shading = o.shading || 'rendered';
    const lit = shading === 'rendered' || shading === 'material' || shading === 'toon';
    scene.updateWorld();
    camera.update(this.width / this.height);
    const meshes = this.collect(scene);
    const shadows = lit && o.shadows !== false && shading !== 'material';

    // shadow pass
    if (shadows) {
      this._computeShadowVP(env);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3.0);
      const p = this.prog.depth.use();
      p.m4('uViewProj', this.shadowVP); p.m4('uShadowVP', this.shadowVP); p.f('uInflate', 0);
      const sc = env.shadowCenter, sr = env.shadowRadius * 1.8;
      for (const m of meshes) {
        if (!m.castShadow || (m.material && (m.material.opacity < 0.5 || m.material.blend === 'add' || m.material.unlit))) continue;
        if (this.settings.culling) { const s = this._sphere(m); if (vec3.dist(s.c, sc) - s.r > sr) continue; }
        if (m.material?.doubleSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
        this._bindMesh(p, m); this._drawMesh(m);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      this.stats.drawCalls = 0; this.stats.triangles = 0;
    }

    // frustum culling for everything drawn from the camera
    const planes = this._frustum(camera.viewProj);
    const visible = this.settings.culling ? meshes.filter((m) => this._visible(m, planes)) : meshes;
    this.stats.culled = meshes.length - visible.length;

    // ambient occlusion: half-res normal/depth pre-pass, SSAO, depth-aware blur
    const useAO = lit && env.ao !== false && this.settings.ssao && this.hdr && !camera.ortho && shading !== 'toon';
    // V3 screen effects need the same G-buffer
    const fx = lit && this.hdr && !camera.ortho && shading === 'rendered' && !o.xray;
    const useSSR = fx && this.settings.ssr;
    const volAmt = env.volumetric ?? 0;
    const useVol = fx && this.settings.volumetrics && volAmt > 0;
    const useContact = fx && this.settings.contactShadows && shadows;
    const needG = useAO || useSSR || useVol || useContact;
    if (needG) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.gFBO);
      gl.viewport(0, 0, this.gw, this.gh);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
      const g = this.prog.gbuf.use();
      g.m4('uViewProj', camera.viewProj); g.m4('uView', camera.view); g.m4('uShadowVP', IDENTITY); g.f('uInflate', 0);
      g.f('uWetness', env.wetness || 0); g.f('uRain', env.rain || 0); g.f('uTime', this.time);
      for (const m of visible) {
        const mat = m.material;
        if (mat && (mat.opacity < 1 || mat.blend === 'add' || mat.unlit || mat.alphaTest > 0)) continue;
        if (mat?.doubleSided) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
        g.i('uDoubleSided', mat?.doubleSided ? 1 : 0);
        g.f('uRoughness', mat ? mat.roughness : 0.6); g.f('uMetallic', mat ? mat.metallic : 0); g.i('uPattern', mat ? mat.patternIndex : 0);
        this._bindMesh(g, m); this._drawMesh(m);
      }
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    }
    if (useAO) {
      gl.bindVertexArray(this.emptyVAO);
      const a = this.prog.ssao.use();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ao1FBO);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.gTex); a.i('uG', 0);
      const th = Math.tan(camera.fov / 2);
      a.m4('uProj', camera.proj); a.v2('uTan', [th * camera.aspect, th]); a.f('uRadius', env.aoRadius ?? 0.5); a.f('uIntensity', env.aoIntensity ?? 1.4);
      gl.uniform3fv(a.u('uKernel'), this.aoKernel);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const bl = this.prog.aoblur.use();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ao2FBO);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.ao1Tex); bl.i('uAO', 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.gTex); bl.i('uG', 1);
      bl.v2('uTexel', [1 / this.gw, 1 / this.gh]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this.stats.drawCalls = 0; this.stats.triangles = 0;

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
      p.f('uNight', env.night || 0); p.v3('uMoonDir', env.moonDirection || [0, 1, 0]);
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
    const nLights = lit ? this._gatherLights(camera, env) : 0;
    p.i('uLightCount', nLights);
    if (nLights) { gl.uniform4fv(p.u('uLightPos'), this.lightU.pos); gl.uniform4fv(p.u('uLightColor'), this.lightU.col); gl.uniform4fv(p.u('uLightSpot'), this.lightU.spot); }
    p.i('uUseAO', useAO ? 1 : 0); p.f('uAOStrength', env.aoStrength ?? 1); p.v2('uScreen', [this.width, this.height]);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, useAO ? this.ao2Tex : this.identityJoints); p.i('uAO', 2);
    p.f('uFogHeight', o.fog === false ? 0 : env.fogHeight || 0);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.bindSampler(3, this.rawSampler); p.i('uShadowRaw', 3);
    const soft = shadows && this.settings.softShadows ? env.shadowSoftness ?? 2.5 : 0;
    p.f('uShadowSoft', soft > 0 ? 3 * Math.tan((soft * Math.PI) / 180) : 0);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, needG ? this.gTex : this.identityJoints); p.i('uGBuf', 4);
    p.i('uContact', useContact ? 1 : 0); p.m4('uView', camera.view); p.m4('uProj', camera.proj);
    p.f('uWetness', lit ? env.wetness || 0 : 0); p.f('uRain', env.rain || 0);
    const shadeMode = SHADING[shading] ?? 0;
    const xray = !!o.xray;
    const drawOpaque = shading !== 'wireframe';
    if (drawOpaque) {
      if (xray) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      const isT = (m) => m.material.opacity < 1 || m.material.blend === 'add';
      let opaque = visible.filter((m) => !isT(m));
      if (this.settings.sortDraws) opaque = opaque.sort((a, b) => this._matKey(a.material) - this._matKey(b.material)); // fewer state changes
      const sorted = xray ? visible : opaque.concat(visible.filter(isT));
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
        this._drawMesh(m);
        if (transparent && !xray) { gl.disable(gl.BLEND); gl.depthMask(true); }
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    // wireframe (full mode or overlay)
    if (shading === 'wireframe' || o.wireOverlay) {
      gl.disable(gl.CULL_FACE);
      p.i('uShading', 2);
      if (shading === 'wireframe') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
      for (const m of meshes) {
        const sel = o.selected && o.selected.has(m);
        p.v4('uFlatColor', sel ? [1, 0.45, 0.1, 1] : shading === 'wireframe' ? [0.05, 0.05, 0.05, 0.9] : [0.02, 0.02, 0.02, 0.35]);
        if (o.wireOverlay && shading !== 'wireframe') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
        this._bindMesh(p, m); this._drawMesh(m, true);
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
        p.m4('uModel', it.matrix); p.m4('uLocal', IDENTITY); p.i('uSkinned', 0); p.i('uInstanced', 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.identityJoints); p.i('uJointTex', 1);
        p.i('uShading', it.shading === 'flat' ? 2 : 1); p.i('uLightCount', 0); p.i('uPattern', 0); p.v3('uBaseColor', it.color.slice(0, 3)); p.f('uOpacity', it.color[3]); p.v4('uFlatColor', it.color); p.f('uRoughness', 0.5); p.i('uDoubleSided', 0);
        this._draw(it.geometry, !!it.wire);
      }
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    }
    // particles
    this._particles(camera, o.particles);
    // lines
    if (o.lines) for (const L of o.lines) this.drawLines(camera, L.data, L.depthTest !== false, L.alpha ?? 1, L.additive);

    // resolve + bloom + post
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFBO); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFBO);
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.emptyVAO);
    gl.bindSampler(3, null); // the raw shadow-depth sampler is only for the main shader
    const src = useSSR || useVol ? this._screenEffects(camera, env, { useSSR, useVol, volAmt, shadows, nLights }) : this.resolveTex;
    if (o.viewmodel && o.viewmodel.root.visible) { this._viewModel(src, o.viewmodel); gl.bindVertexArray(this.emptyVAO); }
    const bloom = this.settings.bloom && lit;
    if (bloom) {
      const b = this.prog.bright.use();
      gl.viewport(0, 0, this.bw, this.bh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.b1FBO); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
      b.i('uColor', 0); b.i('uPass', 0); b.v2('uTexel', [1 / this.width * 2, 1 / this.height * 2]); b.f('uThreshold', this.settings.bloomThreshold);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (let it = 0; it < 2; it++) {
        b.i('uPass', 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.b2FBO); gl.bindTexture(gl.TEXTURE_2D, this.b1Tex); b.v2('uTexel', [1 / this.bw, 0]); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.b1FBO); gl.bindTexture(gl.TEXTURE_2D, this.b2Tex); b.v2('uTexel', [0, 1 / this.bh]); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // two wider, softer levels: downsample then blur
      for (const [srcT, sw, sh, f1, t1, f2, t2, w, h] of [[this.b1Tex, this.bw, this.bh, this.c1FBO, this.c1Tex, this.c2FBO, this.c2Tex, this.cw, this.ch], [this.c1Tex, this.cw, this.ch, this.d1FBO, this.d1Tex, this.d2FBO, this.d2Tex, this.dw, this.dh]]) {
        gl.viewport(0, 0, w, h);
        b.i('uPass', 2); gl.bindFramebuffer(gl.FRAMEBUFFER, f1); gl.bindTexture(gl.TEXTURE_2D, srcT); b.v2('uTexel', [1 / sw, 1 / sh]); gl.drawArrays(gl.TRIANGLES, 0, 3);
        b.i('uPass', 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, f2); gl.bindTexture(gl.TEXTURE_2D, t1); b.v2('uTexel', [1 / w, 0]); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, f1); gl.bindTexture(gl.TEXTURE_2D, t2); b.v2('uTexel', [0, 1 / h]); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const pp = this.prog.post.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); pp.i('uColor', 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.b1Tex); pp.i('uBloom', 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.c1Tex); pp.i('uBloom2', 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.d1Tex); pp.i('uBloom3', 3);
    const st = this.settings, tmp = st.temperature || 0;
    pp.f('uSaturation', lit ? st.saturation : 1); pp.f('uContrast', lit ? st.contrast : 1); pp.v3('uWhite', lit ? [1 + 0.12 * tmp, 1 + 0.02 * tmp, 1 - 0.12 * tmp] : [1, 1, 1]);
    pp.f('uSharpen', lit ? st.sharpen : 0); pp.f('uAberration', lit ? st.aberration + this.post.aberration * 3 : 0);
    const po = this.post;
    pp.f('uDamage', po.damage); pp.f('uBlink', po.blink); pp.f('uNVG', po.nvg); pp.f('uFlashWhite', po.white); pp.f('uDesat', po.desat);
    pp.f('uBloomStrength', bloom ? this.settings.bloomStrength : 0);
    pp.f('uExposure', (env.exposure ?? 1) * this.settings.exposure); pp.f('uVignette', lit ? this.settings.vignette : 0); pp.f('uGrain', lit ? this.settings.grain : 0);
    let rays = 0, sunUV = [0.5, 0.5];
    if (bloom && this.settings.godRays && (env.godRays || 0) > 0) {
      const sp = [camera.position[0] + env.sunDirection[0] * 500, camera.position[1] + env.sunDirection[1] * 500, camera.position[2] + env.sunDirection[2] * 500];
      const v = [sp[0], sp[1], sp[2], 1], M = camera.viewProj;
      const cw = M[3] * v[0] + M[7] * v[1] + M[11] * v[2] + M[15];
      if (cw > 0) {
        const cx = (M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12]) / cw, cy = (M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13]) / cw;
        sunUV = [cx * 0.5 + 0.5, cy * 0.5 + 0.5];
        const off = Math.max(0, Math.max(Math.abs(cx), Math.abs(cy)) - 1);
        rays = env.godRays * Math.max(0, 1 - off * 1.5);
      }
    }
    pp.v2('uSunUV', sunUV); pp.f('uGodRays', rays * 1.6); pp.v3('uRayColor', env.rayColor || [1, 0.85, 0.6]);
    pp.f('uTime', this.time); pp.i('uTonemap', 1); pp.v2('uTexel', [1 / this.width, 1 / this.height]); pp.i('uFXAA', this.msaa < 2 || this.settings.fxaa ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this._endGpuTimer();
    this.stats.cpuMs = performance.now() - t0;
  }

  // ------------------------------------------------------------------ V3 screen effects
  _screenEffects(camera, env, { useSSR, useVol, volAmt, shadows, nLights }) {
    const gl = this.gl, th = Math.tan(camera.fov / 2), tan = [th * camera.aspect, th];
    const invView = mat4.invert(mat4.create(), camera.view);
    const tex = (unit, t, prog, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); prog.i(name, unit); };
    const blur = (from, toFBO, scale) => {
      const b = this.prog.bilateral.use(); gl.bindFramebuffer(gl.FRAMEBUFFER, toFBO);
      tex(0, from, b, 'uSrc'); tex(1, this.gTex, b, 'uG'); b.v2('uTexel', [1 / this.gw, 1 / this.gh]); b.f('uScale', scale);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    gl.viewport(0, 0, this.gw, this.gh);
    if (useSSR) {
      const r = this.prog.ssr.use(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssr1FBO);
      tex(0, this.gTex, r, 'uG'); tex(1, this.gMatTex, r, 'uM'); tex(2, this.resolveTex, r, 'uColor');
      r.m4('uProj', camera.proj); r.v2('uTan', tan); r.f('uMaxRough', this.settings.ssrMaxRoughness); r.f('uTime', this.time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      blur(this.ssr1Tex, this.ssr2FBO, 1);
    }
    if (useVol) {
      const v = this.prog.volume.use(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.vol1FBO);
      tex(0, this.gTex, v, 'uG'); tex(1, this.shadowTex, v, 'uShadowMap'); v.i('uShadows', shadows ? 1 : 0);
      v.m4('uInvView', invView); v.m4('uShadowVP', this.shadowVP); v.v2('uTan', tan); v.v3('uCamPos', camera.position);
      v.v3('uSunDir', env.sunDirection); v.v3('uSunColor', env.sunColor.map((c) => c * env.sunIntensity));
      v.f('uDensity', env.volumeDensity ?? 0.035); v.f('uFogHeight', env.fogHeight || 0.15);
      v.f('uSunScatter', volAmt * (env.sunShafts ?? 1)); v.f('uLightScatter', volAmt * (env.lampGlow ?? 1) * 1.6);
      v.f('uMaxDist', env.volumeDistance ?? 60); v.f('uTime', this.time); v.f('uAniso', env.anisotropy ?? 0.6);
      v.i('uLightCount', nLights);
      if (nLights) { gl.uniform4fv(v.u('uLightPos'), this.lightU.pos); gl.uniform4fv(v.u('uLightColor'), this.lightU.col); gl.uniform4fv(v.u('uLightSpot'), this.lightU.spot); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      blur(this.vol1Tex, this.vol2FBO, 1.6);
    }
    gl.viewport(0, 0, this.width, this.height);
    const c = this.prog.composite.use(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.compFBO);
    tex(0, this.resolveTex, c, 'uColor'); tex(1, this.ssr2Tex, c, 'uSSR'); tex(2, this.vol2Tex, c, 'uVol'); tex(3, this.gTex, c, 'uG'); tex(4, this.gMatTex, c, 'uM');
    c.i('uUseSSR', useSSR ? 1 : 0); c.i('uUseVol', useVol ? 1 : 0); c.f('uSSRStrength', this.settings.ssrStrength);
    c.m4('uInvView', invView); c.v2('uTan', tan);
    c.v3('uHorizon', env.horizonColor); c.v3('uZenith', env.zenithColor); c.v3('uGroundColor', env.groundColor); c.f('uAmbient', env.ambient);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.compTex;
  }
  _matKey(m) {
    if (!this._matIds) { this._matIds = new WeakMap(); this._nextMat = 1; }
    let id = this._matIds.get(m); if (!id) { id = this._nextMat++; this._matIds.set(m, id); }
    return (m.doubleSided ? 1e6 : 0) + id;
  }
  // Adaptive resolution: nudge renderScale toward the target frame rate (checked once a second)
  _adapt(now) {
    const T = this._frameT; if (this._lastFrame) T.push(now - this._lastFrame); this._lastFrame = now;
    if (T.length > 60) T.shift();
    const st = this.settings;
    this.stats.scale = st.renderScale;
    if (!st.adaptiveResolution || now - this._scaleT < 1000 || T.length < 20) return;
    this._scaleT = now;
    const avg = T.reduce((a, b) => a + b, 0) / T.length, fps = 1000 / avg;
    if (fps < st.targetFps - 4 && st.renderScale > st.minScale) st.renderScale = Math.max(st.minScale, +(st.renderScale - 0.1).toFixed(2));
    else if (fps > st.targetFps + 8 && st.renderScale < 1) st.renderScale = Math.min(1, +(st.renderScale + 0.1).toFixed(2));
  }
  _beginGpuTimer() {
    const t = this.timer; if (!t) return;
    const gl = this.gl;
    // collect finished queries
    while (this._queries.length && gl.getQueryParameter(this._queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this._queries.shift();
      if (!gl.getParameter(t.GPU_DISJOINT_EXT)) this.stats.gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(q);
    }
    if (this._queries.length > 4) return;
    const q = gl.createQuery(); gl.beginQuery(t.TIME_ELAPSED_EXT, q); this._queries.push(q); this._timing = true;
  }
  _endGpuTimer() { if (this._timing) { this.gl.endQuery(this.timer.TIME_ELAPSED_EXT); this._timing = false; } }

  // data: Float32Array of [x,y,z, r,g,b,a] per vertex, pairs form segments
  _particles(camera, list) {
    const gl = this.gl;
    for (const ps of !list ? [] : Array.isArray(list) ? list : [list]) {
      if (!ps.count) continue;
      const pp = this.prog.particle.use();
      pp.m4('uViewProj', camera.viewProj); pp.f('uScale', this.height * 0.8);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, ps.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.bindVertexArray(this.partVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      gl.bufferData(gl.ARRAY_BUFFER, ps.data.subarray(0, ps.count * 8), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, ps.count);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
  }
  // First-person view model: drawn over the finished (post-SSR/volumetric) HDR image with its
  // own projection and a cleared depth buffer, so it never clips into walls or catches world fog.
  _viewModel(target, vm) {
    const gl = this.gl, vc = vm.camera;
    vc.update(this.width / this.height);
    if (!this.vmFBO || this.vmW !== this.width || this.vmH !== this.height || this.vmTarget !== target) {
      if (!this.vmDepth || this.vmW !== this.width || this.vmH !== this.height) {
        if (this.vmDepth) gl.deleteRenderbuffer(this.vmDepth);
        this.vmDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.vmDepth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.width, this.height);
      }
      if (this.vmFBO) gl.deleteFramebuffer(this.vmFBO);
      this.vmFBO = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.vmFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.vmDepth);
      this.vmW = this.width; this.vmH = this.height; this.vmTarget = target;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.vmFBO);
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    const p = this.prog.main.use();
    this._lastMat = null; this._lastProg = null;
    p.m4('uViewProj', vc.viewProj); p.v3('uCamPos', vc.position); p.m4('uView', vc.view); p.m4('uProj', vc.proj);
    p.i('uShadows', 0); p.f('uShadowSoft', 0); p.i('uUseAO', 0); p.i('uContact', 0); p.f('uFogDensity', 0); p.f('uFogHeight', 0); p.f('uWetness', 0);
    p.i('uShading', 0);
    // rebind every sampler the main shader declares (the effect passes left other textures on these units)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); p.i('uShadowMap', 0);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.identityJoints); p.i('uAO', 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.bindSampler(3, this.rawSampler); p.i('uShadowRaw', 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.identityJoints); p.i('uGBuf', 4);
    const list = this.collect(vm.root);
    const isT = (m) => m.material.opacity < 1 || m.material.blend === 'add';
    for (const m of list.filter((m) => !isT(m)).concat(list.filter(isT))) {
      const mat = m.material, add = mat.blend === 'add', tr = add || mat.opacity < 1;
      if (tr) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); if (add) gl.depthMask(false); }
      if (mat.doubleSided || tr) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
      this._setMaterial(p, mat); this._bindMesh(p, m); this._drawMesh(m);
      if (tr) { gl.disable(gl.BLEND); gl.depthMask(true); }
    }
    if (vm.particles) this._particles(vc, vm.particles);
    gl.bindSampler(3, null);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  }
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
      if (it.mesh) this._bindMesh(p, it.mesh); else { p.m4('uModel', it.matrix); p.m4('uLocal', IDENTITY); p.i('uSkinned', 0); p.i('uInstanced', 0); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.identityJoints); p.i('uJointTex', 1); }
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
