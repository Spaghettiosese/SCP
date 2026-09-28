// GLSL ES 3.00 shader sources.

export const COMMON_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in vec4 aJoints;
layout(location=4) in vec4 aWeights;
layout(location=5) in vec3 aRest;
layout(location=6) in vec4 aI0;
layout(location=7) in vec4 aI1;
layout(location=8) in vec4 aI2;
layout(location=9) in vec4 aI3;
uniform bool uInstanced;  // per-instance model matrix in attributes 6..9
uniform mat4 uModel;      // world transform (character root for skinned meshes)
uniform mat4 uLocal;      // part transform (applied before skinning)
uniform mat4 uViewProj;
uniform mat4 uShadowVP;
uniform bool uSkinned;
uniform sampler2D uJointTex;
uniform float uInflate;   // outline shell / ghost offset
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec3 vRest;
out vec3 vRestN;
out vec4 vShadow;
mat4 jointMat(int i){
  return mat4(texelFetch(uJointTex, ivec2(0,i),0), texelFetch(uJointTex, ivec2(1,i),0), texelFetch(uJointTex, ivec2(2,i),0), texelFetch(uJointTex, ivec2(3,i),0));
}
void main(){
  vec4 lp = uLocal * vec4(aPos,1.0);
  vec3 ln = mat3(uLocal) * aNormal;
  if(uSkinned){
    mat4 s = aWeights.x*jointMat(int(aJoints.x)) + aWeights.y*jointMat(int(aJoints.y)) + aWeights.z*jointMat(int(aJoints.z)) + aWeights.w*jointMat(int(aJoints.w));
    lp = s * lp; ln = mat3(s) * ln;
  }
  mat4 inst = uInstanced ? mat4(aI0, aI1, aI2, aI3) : mat4(1.0);
  vec4 wp = uModel * inst * lp;
  vec3 n = normalize(mat3(uModel) * mat3(inst) * ln);
  wp.xyz += n * uInflate;
  // instances get their own pattern offset so repeated props don't look identical
  vWorld = wp.xyz; vNormal = n; vUV = aUV; vRest = aRest + (uInstanced ? aI3.xyz * 0.731 : vec3(0.0)); vRestN = aNormal;
  vShadow = uShadowVP * vec4(wp.xyz + n*0.02, 1.0);
  gl_Position = uViewProj * wp;
}`;

export const NOISE = /* glsl */ `
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec3 hash33(vec3 p){ p = fract(p*vec3(0.1031,0.1030,0.0973)); p += dot(p, p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),u.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),u.x),u.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),u.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),u.x),u.y),u.z);
}
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
vec2 voronoi(vec3 p){
  vec3 i = floor(p), f = fract(p); float d1=8.0, d2=8.0;
  for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec3 g = vec3(x,y,z); vec3 o = hash33(i+g); vec3 r = g+o-f; float d = dot(r,r);
    if(d<d1){ d2=d1; d1=d; } else if(d<d2) d2=d;
  }
  return vec2(sqrt(d1), sqrt(d2));
}`;


// V3 weather: damp surfaces, puddles on flat ground and rain ripples in the puddles.
export const WET = /* glsl */ `
uniform float uWetness; uniform float uRain;
float puddleMask(vec3 wp, vec3 n){
  if(uWetness <= 0.0) return 0.0;
  float up = smoothstep(0.8, 0.97, n.y);
  vec3 q = vec3(wp.x, 0.0, wp.z);
  float m = fbm(q * 0.42) + 0.15 * fbm(q * 2.7 + 5.0);
  float th = 0.8 - uWetness * 0.3;
  return up * smoothstep(th, th + 0.035, m);
}
vec2 rainRipples(vec2 p, float t){
  vec2 acc = vec2(0.0);
  for(int j = -1; j <= 1; j++) for(int i = -1; i <= 1; i++){
    vec2 c = floor(p) + vec2(float(i), float(j));
    float h = hash12(c);
    vec2 o = c + vec2(hash12(c + 3.1), hash12(c + 7.7));
    float ph = fract(t * 0.85 + h);
    vec2 d = p - o; float r = length(d);
    float w = exp(-pow((r - ph * 0.8) * 16.0, 2.0)) * (1.0 - ph) * sin((r - ph * 0.8) * 60.0);
    acc += (r > 1e-4 ? d / r : vec2(0.0)) * w;
  }
  return acc;
}
`;

export const MAIN_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld; in vec3 vNormal; in vec2 vUV; in vec3 vRest; in vec3 vRestN; in vec4 vShadow;
uniform vec3 uCamPos;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uGroundColor; uniform float uAmbient;
uniform vec3 uHorizon; uniform vec3 uZenith;
uniform vec3 uFogColor; uniform float uFogDensity;
uniform sampler2DShadow uShadowMap; uniform bool uShadows; uniform float uShadowTexel;
uniform vec3 uBaseColor; uniform float uMetallic; uniform float uRoughness; uniform vec3 uEmissive;
uniform int uPattern; uniform float uPatternScale; uniform vec3 uPatternColor; uniform float uPatternStrength; uniform float uBump; uniform float uSheen;
uniform int uShading;   // 0 PBR, 1 studio solid, 2 flat, 3 toon, 4 ghost, 5 normals
uniform vec4 uFlatColor;
uniform float uOpacity;
uniform sampler2D uTex; uniform bool uHasTex; uniform float uAlphaTest;
uniform bool uUnlit; uniform bool uAdditive; uniform bool uWorldPattern;
vec2 domUV(vec3 p, vec3 w){ return (w.y > w.x && w.y > w.z) ? p.xz : (w.x > w.z ? p.zy : p.xy); }
uniform bool uDoubleSided;
uniform float uTime;
// V2 lighting
#define MAX_LIGHTS 16
uniform int uLightCount;
uniform vec4 uLightPos[MAX_LIGHTS];   // xyz position, w range
uniform vec4 uLightColor[MAX_LIGHTS]; // rgb * intensity, w: 0 point / 1 spot
uniform vec4 uLightSpot[MAX_LIGHTS];  // xyz direction, w cos(outer angle)
uniform sampler2D uAO; uniform bool uUseAO; uniform vec2 uScreen; uniform float uAOStrength;
uniform float uFogHeight;             // height falloff (0 = uniform fog)
// V3: soft (PCSS) and contact shadows
uniform sampler2D uShadowRaw; uniform float uShadowSoft;  // penumbra scale (0 = plain PCF)
uniform sampler2D uGBuf; uniform bool uContact; uniform mat4 uView; uniform mat4 uProj;
out vec4 outColor;
${NOISE}
${WET}
const float PI = 3.14159265;

struct Surf { vec3 albedo; float rough; float metal; float h; float bump; float ao; };

// 2D pattern primitives, evaluated triplanar in the part's rest space (units = repeats per metre)
float aaFade(float cyclesPerPixel){ return 1.0 - smoothstep(0.18, 0.55, cyclesPerPixel); }
vec2 weave2(vec2 p, float fw){ // h, fade
  vec2 c = floor(p), f = fract(p);
  float ch = mod(c.x+c.y, 2.0);
  float th = mix(sin(f.y*PI), sin(f.x*PI), ch);
  float a = aaFade(fw);
  return vec2(mix(0.6, th, a), a);
}
float twill2(vec2 p, float fw){ float d = fract(p.x + p.y*0.5); float t = smoothstep(0.0,0.35,d)*smoothstep(1.0,0.6,d); return mix(0.55, t, aaFade(fw)); }
vec4 plaid2(vec2 p, float fw){
  vec2 q = fract(p);
  float e = clamp(fw*1.5, 0.004, 0.05);
  vec2 wide = smoothstep(0.0, e, q) * (1.0 - smoothstep(0.30, 0.30+e, q));
  vec2 thin = smoothstep(0.55, 0.55+e, q) * (1.0 - smoothstep(0.585, 0.585+e, q));
  vec2 dark = smoothstep(0.10, 0.10+e, q) * (1.0 - smoothstep(0.20, 0.20+e, q));
  return vec4(max(wide.x, wide.y), wide.x*wide.y, max(thin.x, thin.y), max(dark.x, dark.y));
}

Surf pattern(Surf s){
  vec3 P0 = uWorldPattern ? vWorld : vRest;
  vec3 N0 = uWorldPattern ? vNormal : vRestN;
  vec3 rp = P0 * uPatternScale;
  float fw = length(fwidth(P0)) * uPatternScale; // pattern units per pixel
  vec3 w = pow(abs(normalize(N0)), vec3(6.0)); w /= (w.x + w.y + w.z);
  vec3 an = abs(normalize(N0));
  float k = uPatternStrength;
  if(uPattern==1){ // fabric weave
    vec2 a = weave2(rp.zy, fw)*w.x + weave2(rp.xz, fw)*w.y + weave2(rp.xy, fw)*w.z;
    float n = fbm(rp*0.02);
    s.h = a.x*0.5; s.bump = 0.25*a.y;
    s.albedo *= mix(1.0, 0.86 + 0.18*a.x + 0.16*(n-0.5), k);
  } else if(uPattern==2){ // denim twill + fading
    float t = twill2(rp.zy, fw)*w.x + twill2(rp.xz, fw)*w.y + twill2(rp.xy, fw)*w.z;
    float n = fbm(rp*0.04);
    float fade = smoothstep(0.45, 0.8, fbm(rp*0.006 + 3.0));
    vec3 weft = mix(s.albedo, vec3(0.8,0.83,0.88), 0.3);
    s.albedo = mix(s.albedo, weft, (1.0-t)*0.35*k);
    s.albedo *= 1.0 + (fade*0.12 + (n-0.5)*0.14)*k;
    s.h = t*0.5; s.bump = 0.25*aaFade(fw);
  } else if(uPattern==3){ // leather: fine pebbled grain + mottling + soft wrinkles
    vec2 v = voronoi(rp);
    float g = aaFade(fw*1.5);
    float grain = mix(0.6, smoothstep(0.0, 0.3, v.y - v.x), g);
    float m = fbm(rp*0.03);
    float wr = 1.0 - abs(fbm(rp*0.012 + 5.0)*2.0 - 1.0);
    float crease = smoothstep(0.82, 0.98, wr);
    s.albedo *= mix(1.0, (0.93 + 0.07*grain) * (0.84 + 0.32*m) * (1.0 - 0.2*crease), k);
    s.albedo = mix(s.albedo, uPatternColor, smoothstep(0.55,0.85,fbm(rp*0.02+2.0))*0.35*k);
    s.rough = clamp(s.rough + (m-0.5)*0.25 + crease*0.1 - (1.0-grain)*0.05, 0.05, 1.0);
    s.h = grain*0.2*g - crease*0.6 + m*0.1; s.bump = 0.3;
  } else if(uPattern==4){ // brushed metal
    float n = vnoise(vec3(vUV.x*3.0, vUV.y*uPatternScale*60.0, 0.0));
    float g = aaFade(length(fwidth(vUV))*uPatternScale*60.0);
    float sc = smoothstep(0.93,1.0, vnoise(rp*9.0));
    s.albedo *= 0.9 + 0.16*mix(0.5, n, g);
    s.rough = clamp(s.rough + (n-0.5)*0.12*g + sc*0.25, 0.04, 1.0);
    s.h = n*0.3*g; s.bump = 0.2;
  } else if(uPattern==5){ // wood
    float r = length(rp.xz) + fbm(rp*vec3(1.0,0.3,1.0))*0.6;
    float ring = fract(r*6.0);
    float grain = fbm(rp*vec3(12.0,1.5,12.0));
    float g = aaFade(fw*12.0);
    s.albedo = mix(s.albedo, uPatternColor, (smoothstep(0.2,0.9,ring)*0.55 + grain*0.3*g)*k);
    s.h = ring*0.3 + grain*0.4*g; s.bump = 0.3;
  } else if(uPattern==6){ // skin
    float m = fbm(rp*2.0);
    float g = aaFade(fw*20.0);
    float pores = vnoise(rp*20.0);
    s.albedo *= 0.95 + 0.1*m;
    s.albedo = mix(s.albedo, uPatternColor, smoothstep(0.45,0.75,fbm(rp*1.2+7.0))*0.22*k);
    s.h = pores*0.12*g + m*0.1; s.bump = 0.2;
    s.rough = clamp(s.rough + (pores-0.5)*0.08*g, 0.2, 1.0);
  } else if(uPattern==7){ // plaid / tartan
    vec4 a = plaid2(rp.zy, fw)*w.x + plaid2(rp.xz, fw)*w.y + plaid2(rp.xy, fw)*w.z;
    vec3 c = s.albedo;
    c = mix(c, uPatternColor, a.x*0.55*k);
    c = mix(c, uPatternColor*0.5, a.y*0.6*k);
    c = mix(c, uPatternColor*0.35, a.w*0.5*k);
    c = mix(c, vec3(0.85,0.82,0.74), a.z*0.45*k);
    vec2 wv = weave2(rp.zy*64.0, fw*64.0)*w.x + weave2(rp.xz*64.0, fw*64.0)*w.y + weave2(rp.xy*64.0, fw*64.0)*w.z;
    s.albedo = c*(0.95 + 0.07*wv.x);
    s.h = wv.x*0.4; s.bump = 0.2*wv.y;
  } else if(uPattern==8){ // stripes / ribs around the surface (U direction)
    float x = vUV.x*uPatternScale;
    float st = smoothstep(0.35,0.5,fract(x)) * (1.0-smoothstep(0.85,1.0,fract(x)));
    s.albedo = mix(s.albedo, uPatternColor, st*k*aaFade(length(fwidth(vUV))*uPatternScale));
    s.h = st*0.5; s.bump = 0.4;
  } else if(uPattern==9){ // checker
    vec3 c = floor(rp);
    s.albedo = mix(s.albedo, uPatternColor, mod(c.x+c.y+c.z,2.0)*k);
  } else if(uPattern==10){ // dirt ground (world space)
    vec3 wp = vec3(vWorld.x, 0.0, vWorld.z) * uPatternScale;
    float n = fbm(wp*0.35);
    float n2 = fbm(wp*2.5+4.0);
    vec2 v = voronoi(wp*3.0);
    float pebble = 1.0 - smoothstep(0.0, 0.35, v.x);
    pebble *= step(0.72, hash13(floor(wp*3.0)));
    float tracks = smoothstep(0.35,0.6, fbm(wp*vec3(0.05,0.0,1.4)));
    s.albedo = mix(s.albedo, uPatternColor, smoothstep(0.35,0.7,n)*k);
    s.albedo *= 0.8 + 0.4*n2;
    s.albedo = mix(s.albedo, s.albedo*1.25+0.04, pebble*0.8);
    s.albedo *= 1.0 - tracks*0.12;
    s.h = n2*0.5 + pebble*0.6; s.bump = 1.0;
    s.rough = 0.9 - pebble*0.25;
  } else if(uPattern==11){ // felt
    float g = aaFade(fw*8.0);
    float n = fbm(rp*8.0);
    s.albedo *= 0.88 + 0.22*mix(0.5, n, g) + (fbm(rp*0.8)-0.5)*0.25;
    s.h = n*0.4*g; s.bump = 0.25;
  } else if(uPattern==12){ // hair strands (follow the V direction of the surface)
    float f = length(fwidth(vUV))*uPatternScale*40.0;
    float n = vnoise(vec3(vUV.x*uPatternScale*40.0, vUV.y*3.0, 0.0));
    float g = aaFade(f);
    n = mix(0.5, n, g);
    s.albedo *= 0.75 + 0.45*n;
    s.h = n; s.bump = 0.3*g; s.rough = clamp(s.rough - n*0.2, 0.2, 1.0);
  } else if(uPattern==14){ // walnut: grain streaks running along the part's Z axis + flame figure
    float g = aaFade(fw*6.0);
    float streak = fbm(vec3(rp.x*6.0, rp.y*6.0, rp.z*0.35));
    float fig = fract((rp.x*1.2 + rp.y*1.6)*3.0 + fbm(rp*vec3(1.5,1.5,0.25))*2.5);
    float pore = vnoise(vec3(rp.x*40.0, rp.y*40.0, rp.z*2.0));
    s.albedo = mix(s.albedo, uPatternColor, (smoothstep(0.35,0.8,streak)*0.55 + smoothstep(0.55,1.0,fig)*0.3*g)*k);
    s.albedo *= 0.94 + 0.1*mix(0.5, pore, g);
    s.rough = clamp(s.rough + (streak-0.5)*0.2, 0.1, 1.0);
    s.h = streak*0.25 + pore*0.08*g; s.bump = 0.15;
  } else if(uPattern==15){ // planks: horizontal boards with gaps and grain (siding, floors)
    float y = rp.y + (vRestN.y > 0.7 || vRestN.y < -0.7 ? rp.z : 0.0);
    float along = abs(vRestN.x) > abs(vRestN.z) ? rp.z : rp.x;
    if(abs(vRestN.y) > 0.7){ y = rp.z; along = rp.x; }
    float row = floor(y);
    float fy = fract(y);
    float seam = smoothstep(0.0, 0.05, fy) * (1.0 - smoothstep(0.93, 1.0, fy));
    float board = hash12(vec2(row, 3.1));
    float endj = step(0.97, fract(along * 0.35 + board * 7.0));
    float grain = fbm(vec3(along * 0.8, y * 14.0, board * 10.0));
    float g = aaFade(fw * 3.0);
    s.albedo *= mix(1.0, (0.78 + 0.35 * board) * (0.86 + 0.3 * grain * g), k);
    s.albedo = mix(s.albedo, uPatternColor, (1.0 - seam) * 0.8 * k + endj * 0.5 * k);
    s.h = seam * 0.6 + grain * 0.2 * g - endj * 0.4; s.bump = 0.45;
    s.rough = clamp(s.rough + (board - 0.5) * 0.2, 0.2, 1.0);
  } else if(uPattern==16){ // brick with mortar
    vec3 w3 = w;
    vec2 p2 = w3.x > max(w3.y, w3.z) ? rp.zy : (w3.y > w3.z ? rp.xz : rp.xy);
    vec2 b = vec2(p2.x * 0.5, p2.y);
    b.x += 0.5 * mod(floor(b.y), 2.0);
    vec2 f = fract(b), c = floor(b);
    float e = clamp(fw * 1.5, 0.02, 0.2);
    float mortar = smoothstep(0.0, e + 0.04, f.x) * smoothstep(0.0, e + 0.08, f.y) * (1.0 - smoothstep(1.0 - e - 0.04, 1.0, f.x)) * (1.0 - smoothstep(1.0 - e - 0.08, 1.0, f.y));
    float tone = hash12(c);
    s.albedo *= mix(1.0, 0.72 + 0.45 * tone + 0.1 * (fbm(rp * 3.0) - 0.5), k);
    s.albedo = mix(uPatternColor, s.albedo, mortar);
    s.h = mortar * 0.7 + fbm(rp * 6.0) * 0.1; s.bump = 0.6;
    s.rough = mix(0.95, s.rough, mortar);
  } else if(uPattern==17){ // shingles (roofs): staggered rows of rounded tiles
    vec2 p2 = abs(vRestN.x) > abs(vRestN.z) ? vec2(rp.z, rp.y) : vec2(rp.x, rp.y);
    if(abs(vRestN.y) > 0.3) p2 = vec2(abs(vRestN.x) > abs(vRestN.z) ? rp.z : rp.x, rp.y + (abs(vRestN.x) > abs(vRestN.z) ? rp.x : rp.z));
    p2.x += 0.5 * mod(floor(p2.y), 2.0);
    vec2 f = fract(p2), c = floor(p2);
    float edge = smoothstep(0.0, 0.12, f.y) * smoothstep(0.0, 0.06, min(f.x, 1.0 - f.x));
    float tone = hash12(c + 7.0);
    s.albedo *= mix(1.0, (0.7 + 0.5 * tone) * (0.55 + 0.45 * edge), k);
    s.h = f.y * 0.8 + edge * 0.2; s.bump = 0.55;
  } else if(uPattern==18){ // stucco / adobe: lumpy plaster with soft staining
    float n = fbm(rp * 1.5), n2 = fbm(rp * 9.0 + 3.0);
    float stain = smoothstep(0.45, 0.8, fbm(vec3(rp.x * 0.4, rp.y * 1.6, rp.z * 0.4) + 11.0));
    s.albedo *= mix(1.0, 0.88 + 0.22 * n + 0.08 * n2, k);
    s.albedo = mix(s.albedo, uPatternColor, stain * 0.35 * k * smoothstep(0.6, 0.0, fract(vRest.y * 0.4)));
    s.h = n * 0.6 + n2 * 0.4; s.bump = 0.7;
  } else if(uPattern==19){ // window glass: dark reflective panes, warm glow when emissive
    vec2 p2 = abs(vRestN.x) > abs(vRestN.z) ? rp.zy : rp.xy;
    vec2 f = fract(p2);
    float mull = 1.0 - smoothstep(0.03, 0.06, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    s.albedo = mix(s.albedo, uPatternColor, mull);
    s.rough = mix(0.05, 0.7, mull); s.metal = mix(0.4, 0.0, mull);
    s.ao = 1.0 - mull; // mullions block the interior glow
  } else if(uPattern==20){ // corrugated metal
    float a = abs(vRestN.x) > abs(vRestN.z) ? rp.z : rp.x;
    float wave = sin(a * 6.2831);
    float rust = smoothstep(0.5, 0.8, fbm(rp * 0.3 + 5.0));
    s.albedo = mix(s.albedo, uPatternColor, rust * k);
    s.metal = mix(s.metal, 0.1, rust); s.rough = mix(s.rough, 0.9, rust);
    s.h = wave * 0.5 + 0.5; s.bump = 0.5 * aaFade(fw);
  } else if(uPattern==13){ // eye: iris + pupil around +Z of the rest normal
    float r = length(vRestN.xy);
    float z = vRestN.z;
    float iris = step(0.0, z) * (1.0 - smoothstep(0.5, 0.56, r));
    float pupil = step(0.0, z) * (1.0 - smoothstep(0.22, 0.26, r));
    float ang = atan(vRestN.y, vRestN.x);
    vec3 irisC = uPatternColor * (0.7 + 0.5*vnoise(vec3(ang*6.0, r*20.0, 0.0)));
    s.albedo = mix(s.albedo, irisC, iris);
    s.albedo = mix(s.albedo, vec3(0.02), pupil);
    s.rough = 0.06;
  }
  // --- SCP game patterns
  if(uPattern==21){ // concrete: formwork panels, tie holes, stains, pits
    float n = fbm(rp*0.9), n2 = vnoise(rp*14.0);
    float stains = smoothstep(0.5, 0.85, fbm(rp*vec3(0.35,1.8,0.35)+2.0));
    vec2 uv = domUV(rp*0.42, an);
    vec2 f = abs(fract(uv)-0.5);
    float seam = smoothstep(0.485, 0.497, max(f.x, f.y)) * aaFade(fw*0.4);
    vec2 tf = abs(fract(uv*2.0)-0.5);
    float tie = (1.0 - smoothstep(0.02, 0.035, length(tf-0.0))) * aaFade(fw*0.8) * 0.0;
    vec2 v = voronoi(rp*5.0);
    float pit = (1.0 - smoothstep(0.0, 0.14, v.x)) * step(0.82, hash13(floor(rp*5.0)));
    s.albedo *= (0.8 + 0.32*n) * (0.94 + 0.12*n2);
    s.albedo = mix(s.albedo, uPatternColor, stains*0.55*k);
    s.albedo *= 1.0 - pit*0.4 - seam*0.35 - tie;
    s.h = n2*0.25*aaFade(fw*14.0) - pit*0.8 - seam*0.6 + n*0.2; s.bump = 0.6;
    s.rough = clamp(s.rough + (n-0.5)*0.25, 0.25, 1.0);
  } else if(uPattern==22){ // floor / wall tiles with grout, per-tile tint and grime
    vec2 uv = domUV(rp, an);
    vec2 c = floor(uv), f = fract(uv);
    float e = min(min(f.x, 1.0-f.x), min(f.y, 1.0-f.y));
    float grout = (1.0 - smoothstep(0.015, 0.035, e)) * aaFade(fw);
    float tint = hash12(c);
    float grime = smoothstep(0.4, 0.9, fbm(rp*0.35));
    s.albedo *= 0.9 + 0.18*tint;
    s.albedo = mix(s.albedo, uPatternColor, grout*0.85);
    s.albedo *= 1.0 - grime*0.35*k;
    s.rough = mix(s.rough, 0.95, max(grout, grime*0.5));
    s.h = -grout*0.6 + (1.0-grout)*smoothstep(0.0,0.08,e)*0.2; s.bump = 0.6;
  } else if(uPattern==23){ // hazard stripes (yellow/black) with scuffs
    vec2 uv = domUV(rp, an);
    float st = smoothstep(0.48, 0.52, fract((uv.x + uv.y)*0.5)) - smoothstep(0.98, 1.0, fract((uv.x + uv.y)*0.5));
    float wear = smoothstep(0.55, 0.8, fbm(rp*1.7));
    s.albedo = mix(s.albedo, uPatternColor, st);
    s.albedo = mix(s.albedo, vec3(0.35,0.33,0.3), wear*0.6*k);
    s.rough = mix(s.rough, 0.9, wear); s.h = wear*0.2; s.bump = 0.3;
  } else if(uPattern==24){ // sci-fi wall panels: seams, rivets, variation
    vec2 uv = domUV(rp, an) * vec2(1.0, 0.5);
    vec2 c = floor(uv), f = fract(uv);
    float e = min(min(f.x, 1.0-f.x), min(f.y, 1.0-f.y)*2.0);
    float seam = (1.0 - smoothstep(0.008, 0.02, e)) * aaFade(fw);
    vec2 rc = abs(f - vec2(0.5)) - vec2(0.44, 0.44);
    float rivet = (1.0 - smoothstep(0.012, 0.018, length(max(abs(f-0.5)-vec2(0.455,0.455),0.0) + vec2(0.0)) )) * 0.0;
    vec2 rv = vec2(f.x < 0.5 ? f.x : 1.0-f.x, f.y < 0.5 ? f.y : 1.0-f.y);
    rivet = (1.0 - smoothstep(0.008, 0.013, length(rv - vec2(0.04, 0.08)))) * aaFade(fw*3.0);
    float tint = hash12(c);
    float grime = smoothstep(0.45, 0.9, fbm(rp*0.5 + 3.0));
    s.albedo *= 0.88 + 0.2*tint;
    s.albedo = mix(s.albedo, uPatternColor, grime*0.45*k);
    s.albedo *= 1.0 - seam*0.6;
    s.rough = clamp(s.rough + (tint-0.5)*0.15 + grime*0.2, 0.08, 1.0);
    s.h = -seam + rivet*0.8; s.bump = 0.5;
  } else if(uPattern==25){ // rusty painted metal
    float n = fbm(rp*1.3), n2 = vnoise(rp*18.0);
    float rust = smoothstep(0.45, 0.7, n + 0.25*fbm(rp*vec3(0.5,3.0,0.5)));
    vec3 rc = uPatternColor * (0.7 + 0.5*n2);
    s.albedo = mix(s.albedo * (0.9 + 0.15*n2), rc, rust*k);
    s.metal = mix(s.metal, 0.1, rust); s.rough = mix(s.rough, 0.95, rust);
    s.h = rust*0.4 + n2*0.15*rust; s.bump = 0.5;
  } else if(uPattern==26){ // floor grating
    vec2 uv = domUV(rp, an);
    vec2 f = fract(uv*vec2(1.0, 4.0));
    float bar = max(1.0 - smoothstep(0.08, 0.14, abs(f.x-0.5)*2.0 - 0.0) , 0.0);
    float slot = smoothstep(0.1, 0.18, f.y) * (1.0 - smoothstep(0.82, 0.9, f.y)) * smoothstep(0.1,0.18,f.x) * (1.0 - smoothstep(0.82, 0.9, f.x));
    float g = aaFade(fw*4.0);
    s.albedo *= mix(1.0, mix(1.0, 0.12, slot), g);
    s.h = (1.0 - slot)*g; s.bump = 0.8; s.rough = mix(s.rough, 1.0, slot*g);
    s.albedo = mix(s.albedo, uPatternColor, smoothstep(0.55,0.9,fbm(rp*0.6))*0.5*k);
  } else if(uPattern==27){ // rubber / polymer
    float n = vnoise(rp*30.0), m = fbm(rp*2.0);
    s.albedo *= 0.92 + 0.12*m;
    s.h = n*0.3*aaFade(fw*30.0); s.bump = 0.2;
  } else if(uPattern==28){ // wet asphalt with puddles and paint wear
    float n = vnoise(rp*25.0), m = fbm(rp*0.25);
    float speck = step(0.8, hash13(floor(rp*60.0))) * aaFade(fw*60.0);
    float puddle = smoothstep(0.52, 0.6, m + 0.1*fbm(rp*2.0));
    s.albedo *= (0.85 + 0.2*n) + speck*0.25;
    s.albedo = mix(s.albedo, uPatternColor, smoothstep(0.5,0.8,fbm(rp*0.9+7.0))*0.3*k);
    s.albedo *= 1.0 - puddle*0.45;
    s.rough = mix(s.rough, 0.04, puddle);
    s.h = (n*0.3 + speck*0.3)*(1.0-puddle)*aaFade(fw*25.0); s.bump = 0.7;
  } else if(uPattern==29){ // camo blotches (three tones)
    float a = fbm(rp*1.0 + 11.0), b = fbm(rp*1.6 + 3.0);
    s.albedo = mix(s.albedo, uPatternColor, smoothstep(0.5, 0.53, a)*k);
    s.albedo = mix(s.albedo, s.albedo*0.55, smoothstep(0.55, 0.58, b)*k);
    vec2 wv = weave2(rp.zy*80.0, fw*80.0)*w.x + weave2(rp.xz*80.0, fw*80.0)*w.y + weave2(rp.xy*80.0, fw*80.0)*w.z;
    s.albedo *= 0.94 + 0.08*wv.x; s.h = wv.x*0.3; s.bump = 0.2*wv.y;
  }
  return s;
}

vec3 perturb(vec3 N, vec3 p, float h, float strength){
  vec3 dpdx = dFdx(p), dpdy = dFdy(p);
  float dhdx = dFdx(h), dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  if(abs(det) < 1e-10) return N;
  vec3 grad = sign(det) * (dhdx*r1 + dhdy*r2);
  return normalize(abs(det)*N - strength*grad);
}

float shadowFactor(vec3 N){
  if(!uShadows) return 1.0;
  vec3 sc = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  if(sc.x<0.0||sc.x>1.0||sc.y<0.0||sc.y>1.0||sc.z>1.0) return 1.0;
  float bias = 0.0008 + 0.0015*(1.0-max(dot(N,uSunDir),0.0));
  float ang = hash12(gl_FragCoord.xy)*6.2831;
  mat2 R = mat2(cos(ang),sin(ang),-sin(ang),cos(ang));
  vec2 taps[12] = vec2[](vec2(-0.326,-0.406),vec2(-0.840,-0.074),vec2(-0.696,0.457),vec2(-0.203,0.621),vec2(0.962,-0.195),vec2(0.473,-0.480),
                         vec2(0.519,0.767),vec2(0.185,-0.893),vec2(0.507,0.064),vec2(0.896,0.412),vec2(-0.322,-0.933),vec2(-0.792,-0.598));
  float radius = 2.2;
  if(uShadowSoft > 0.0){
    // PCSS: average blocker depth -> penumbra width, so shadows are sharp at contact and soften with distance
    float bsum = 0.0, bn = 0.0;
    for(int i=0;i<12;i++){ float d = texture(uShadowRaw, sc.xy + R*taps[i]*uShadowTexel*14.0).r; if(d < sc.z - bias){ bsum += d; bn += 1.0; } }
    if(bn < 0.5) return 1.0;
    float pen = (sc.z - bsum/bn) * uShadowSoft / uShadowTexel;
    radius = clamp(pen, 1.2, 16.0);
  }
  float s = 0.0;
  for(int i=0;i<12;i++){ s += texture(uShadowMap, vec3(sc.xy + R*taps[i]*uShadowTexel*radius, sc.z - bias)); }
  return s/12.0;
}

// Screen-space contact shadows: a short ray toward the sun through the depth buffer catches
// the small, sharp shadows (feet on the floor, props on shelves) the shadow map is too coarse for.
float contactShadow(vec3 wp, vec3 N){
  if(!uContact) return 1.0;
  vec3 vp = (uView * vec4(wp + N*0.015, 1.0)).xyz, vl = mat3(uView) * uSunDir;
  float j = hash12(gl_FragCoord.xy + uTime);
  for(int i = 0; i < 10; i++){
    float t = 0.03 + (float(i) + j) * 0.03;
    vec3 q = vp + vl * t;
    vec4 c = uProj * vec4(q, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sd = texture(uGBuf, uv).w;
    float dq = -q.z;
    if(sd > 0.0 && dq > sd + 0.015 && dq < sd + 0.25) return 1.0 - smoothstep(0.0, 1.0, 1.0 - float(i) / 10.0) * 0.85;
  }
  return 1.0;
}

vec3 skyAt(vec3 d){
  float t = clamp(d.y*0.5+0.5, 0.0, 1.0);
  vec3 c = mix(uGroundColor*0.9, uHorizon, smoothstep(0.35, 0.5, t));
  c = mix(c, uZenith, smoothstep(0.5, 0.95, t));
  return c;
}

// Analytic environment BRDF (Karis)
vec3 envBRDF(vec3 F0, float r, float NoV){
  vec4 c0 = vec4(-1.0,-0.0275,-0.572,0.022), c1 = vec4(1.0,0.0425,1.04,-0.04);
  vec4 rr = r*c0 + c1; float a004 = min(rr.x*rr.x, exp2(-9.28*NoV))*rr.x + rr.y;
  vec2 AB = vec2(-1.04,1.04)*a004 + rr.zw;
  return F0*AB.x + AB.y;
}

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  if(uDoubleSided && !gl_FrontFacing) N = -N;
  if(uShading==2){ outColor = uFlatColor; return; }
  if(uShading==5){ outColor = vec4(N*0.5+0.5,1.0); return; }
  if(uShading==4){ // onion-skin ghost: fresnel glow
    float f = pow(1.0-abs(dot(N,V)), 2.0);
    outColor = vec4(uFlatColor.rgb*(0.35+f*1.4), uFlatColor.a*(0.25+0.75*f)); return;
  }
  Surf s = Surf(uBaseColor, uRoughness, uMetallic, 0.0, 0.0, 1.0);
  float alpha = uOpacity;
  if(uHasTex){ vec4 tx = texture(uTex, vUV); if(tx.a < uAlphaTest) discard; s.albedo *= tx.rgb; alpha *= tx.a; }
  if(uPattern>0) s = pattern(s);
  if(uUnlit || uAdditive){
    vec3 c0 = s.albedo + uEmissive;
    if(uAdditive) alpha *= pow(abs(dot(N,V)), 1.5);
    float fog0 = clamp(1.0 - exp(-pow(length(uCamPos - vWorld)*uFogDensity, 1.4)), 0.0, 1.0);
    outColor = vec4(uAdditive ? c0*(1.0-fog0) : mix(c0, uFogColor, fog0), alpha); return;
  }
  float pud = 0.0;
  if(uWetness > 0.0 && uShading != 1){ // rain: porous surfaces darken, everything turns glossy, puddles mirror
    float damp = uWetness * (0.5 + 0.5*smoothstep(-0.3, 0.7, N.y));
    pud = puddleMask(vWorld, N);
    s.albedo *= mix(1.0, 0.6, damp * (1.0 - s.metal) * 0.8);
    s.rough = mix(s.rough, s.rough * 0.45, damp);
    s.rough = mix(s.rough, 0.02, pud); s.albedo *= 1.0 - 0.3*pud; s.bump *= 1.0 - pud;
  }
  if(s.bump>0.0 && uBump>0.0) N = perturb(N, vWorld, s.h, s.bump*uBump*0.02);
  if(pud > 0.0 && uRain > 0.0){ vec2 rp = rainRipples(vWorld.xz * 2.6, uTime); N = normalize(N + vec3(rp.x, 0.0, rp.y) * 0.35 * uRain * pud); }
  float NoV = max(dot(N,V), 1e-4);

  if(uShading==1){ // studio "solid" mode
    vec3 L1 = normalize(vec3(0.4,0.8,0.5)), L2 = normalize(vec3(-0.6,0.3,-0.4));
    float d = max(dot(N,L1),0.0)*0.75 + max(dot(N,L2),0.0)*0.25 + 0.25 + 0.15*N.y;
    float rim = pow(1.0-NoV, 3.0)*0.25;
    vec3 c = s.albedo*d + rim;
    float spec = pow(max(dot(N, normalize(L1+V)),0.0), 40.0)*0.25*(1.0-s.rough);
    outColor = vec4(c + spec, uOpacity); return;
  }

  float sh = shadowFactor(N);
  if(sh > 0.0 && dot(N, uSunDir) > 0.0) sh *= contactShadow(vWorld, normalize(vNormal));
  vec3 L = uSunDir;
  vec3 H = normalize(L+V);
  float NoL = max(dot(N,L),0.0), NoH = max(dot(N,H),0.0), VoH = max(dot(V,H),0.0);
  float a = max(s.rough*s.rough, 0.002), a2 = a*a;
  float D = a2 / (PI * pow(NoH*NoH*(a2-1.0)+1.0, 2.0));
  float k = (s.rough+1.0)*(s.rough+1.0)/8.0;
  float G = (NoL/(NoL*(1.0-k)+k)) * (NoV/(NoV*(1.0-k)+k));
  vec3 F0 = mix(vec3(0.04), s.albedo, s.metal);
  vec3 F = F0 + (1.0-F0)*pow(1.0-VoH, 5.0);
  vec3 spec = D*G*F / max(4.0*NoL*NoV, 1e-4);
  vec3 kd = (1.0-F)*(1.0-s.metal);
  vec3 diffuse = kd*s.albedo/PI;
  float wrapL = NoL;
  if(uPattern==6){ // skin: wrapped diffuse + warm subsurface tint
    wrapL = max((dot(N,L)+0.45)/1.45, 0.0);
    diffuse += s.albedo*vec3(0.35,0.08,0.04)*max(0.0,1.0-abs(dot(N,L)))*0.4/PI;
  }
  if(uShading==3){ // toon
    wrapL = smoothstep(0.0,0.05,NoL)*0.8 + smoothstep(0.5,0.55,NoL)*0.2;
    spec = vec3(smoothstep(0.5,0.52,D*0.02))*(1.0-s.rough);
  }
  vec3 color = (diffuse*wrapL + spec*NoL) * uSunColor * sh;
  // local point / spot lights (GGX specular + Lambert, smooth windowed falloff)
  for(int i = 0; i < MAX_LIGHTS; i++){
    if(i >= uLightCount) break;
    vec3 Lv = uLightPos[i].xyz - vWorld;
    float d2 = dot(Lv, Lv), r = uLightPos[i].w;
    if(d2 > r*r) continue;
    vec3 Ll = Lv * inversesqrt(max(d2, 1e-6));
    float win = clamp(1.0 - pow(d2/(r*r), 2.0), 0.0, 1.0);
    float att = win*win / (d2 + 1.0);
    if(uLightColor[i].w > 0.5){ float cd = dot(-Ll, uLightSpot[i].xyz); att *= smoothstep(uLightSpot[i].w, mix(uLightSpot[i].w, 1.0, 0.35), cd); }
    float nl = max(dot(N, Ll), 0.0);
    if(nl <= 0.0 || att <= 0.0) continue;
    vec3 Hl = normalize(Ll + V);
    float nh = max(dot(N, Hl), 0.0);
    float Dl = a2 / (PI * pow(nh*nh*(a2-1.0)+1.0, 2.0));
    vec3 Fl = F0 + (1.0-F0)*pow(1.0-max(dot(V,Hl),0.0), 5.0);
    color += (kd*s.albedo/PI + Dl*Fl*0.25*G) * uLightColor[i].rgb * att * nl;
  }
  // hemisphere ambient + ambient specular from the procedural sky
  vec3 hemi = mix(uGroundColor, uSkyColor, N.y*0.5+0.5);
  float ssao = uUseAO ? mix(1.0, texture(uAO, gl_FragCoord.xy / uScreen).r, uAOStrength) : 1.0;
  float ao = (0.55 + 0.45*clamp(N.y*0.5+0.6, 0.0, 1.0)) * ssao * s.ao;
  color *= mix(1.0, ssao, 0.35);
  color += kd*s.albedo*hemi*uAmbient*ao;
  vec3 R = reflect(-V, N);
  vec3 env = mix(skyAt(R), hemi, s.rough);
  color += env * envBRDF(F0, s.rough, NoV) * uAmbient * ao * mix(0.6, 1.0, sh);
  // cool fill light from the opposite side + cloth sheen / rim
  vec3 Lf = normalize(vec3(-uSunDir.x, 0.35, -uSunDir.z));
  color += kd*s.albedo*max(dot(N,Lf),0.0)*vec3(0.25,0.3,0.4)*0.35;
  float rim = pow(1.0-NoV, 4.0);
  color += (uSheen*s.albedo + vec3(0.06))*rim*uSunColor*0.35*(0.4+0.6*sh);
  color += uEmissive;
  // fog
  float dist = length(uCamPos - vWorld);
  float fogAmt = dist*uFogDensity;
  if(uFogHeight > 0.0){ // denser near the ground, thinning with height
    float h0 = max(uCamPos.y, 0.0), h1 = max(vWorld.y, 0.0);
    float dh = h1 - h0;
    float integ = abs(dh) < 1e-3 ? exp(-uFogHeight*h0) : (exp(-uFogHeight*h0) - exp(-uFogHeight*h1)) / (uFogHeight*dh);
    fogAmt *= 1.0 + 1.2*integ;
  }
  float fog = 1.0 - exp(-pow(fogAmt, 1.4));
  color = mix(color, uFogColor, clamp(fog,0.0,1.0));
  outColor = vec4(color, alpha);
}`;

export const DEPTH_FS = /* glsl */ `#version 300 es
precision mediump float;
void main(){}`;

export const PICK_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uFlatColor;
out vec4 outColor;
void main(){ outColor = uFlatColor; }`;

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUV;
void main(){
  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);
  vUV = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

export const SKY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform mat4 uInvViewProj;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uGroundColor;
uniform bool uClouds; uniform float uTime;
uniform float uNight; uniform vec3 uMoonDir;
uniform bool uMesas; uniform float uStorm; uniform float uFlash;
uniform int uMode; // 0 procedural sky, 1 editor gradient
uniform vec3 uTop; uniform vec3 uBottom;
out vec4 outColor;
${NOISE}
void main(){
  if(uMode==1){ outColor = vec4(mix(uBottom, uTop, vUV.y), 1.0); return; }
  vec4 a = uInvViewProj * vec4(vUV*2.0-1.0, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(vUV*2.0-1.0, 1.0, 1.0);
  vec3 d = normalize(b.xyz/b.w - a.xyz/a.w);
  float t = d.y;
  vec3 c = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.8, t), 0.6));
  c = mix(c, uGroundColor*0.8, smoothstep(0.0, -0.15, t));
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(sd, 900.0)*20.0 + pow(sd, 12.0)*0.35 + pow(sd,3.0)*0.12);
  // distant mesas silhouette
  float az = atan(d.z, d.x);
  float ridge = 0.035 + 0.05*fbm(vec3(az*2.2, 0.0, 1.0)) + 0.06*smoothstep(0.55,0.75,fbm(vec3(az*1.3,4.0,2.0)));
  float mesa = smoothstep(ridge+0.002, ridge-0.002, t) * step(-0.02, t);
  if(uMesas) c = mix(c, mix(uHorizon*0.62, vec3(0.45,0.3,0.25), 0.5), mesa*0.85);
  if(uStorm > 0.0){
    vec2 sp = d.xz/(max(t,0.0)+0.08)*0.6;
    float drift = uTime*0.035;
    float base = fbm(vec3(sp*0.8 + vec2(drift, drift*0.3), uTime*0.02));
    float detail = fbm(vec3(sp*2.7 - vec2(drift*1.7, 0.0), 3.0 + uTime*0.05));
    float dens = clamp(base*1.2 + detail*0.5 - 0.25, 0.0, 1.0);
    vec3 dark = mix(uZenith*0.6, uHorizon*0.9, 1.0 - smoothstep(0.0, 0.5, t));
    vec3 lit = vec3(0.55,0.62,0.8) * (0.4 + 1.8*uFlash);
    vec3 cloud = mix(dark*1.3, dark*0.45, dens) + lit * pow(detail, 2.0) * (0.15 + uFlash*1.6) * smoothstep(-0.05, 0.3, t);
    c = mix(c, cloud, uStorm * smoothstep(-0.08, 0.06, t));
    float az2 = atan(d.z, d.x);
    float line = 0.012 + 0.018*fbm(vec3(az2*9.0, 1.0, 0.0)) + 0.02*step(0.72, fbm(vec3(az2*3.0, 5.0, 2.0)));
    c = mix(c, uGroundColor*0.35, smoothstep(line+0.002, line-0.002, t) * step(-0.05, t) * uStorm);
    outColor = vec4(c, 1.0); return;
  }
  if(uNight > 0.0 && t > 0.0){
    // stars: hashed directions, twinkling, fading toward the horizon
    vec3 sd3 = floor(d * 380.0);
    float st = hash13(sd3);
    float star = smoothstep(0.9965, 1.0, st) * (0.6 + 0.4*sin(uTime*3.0 + st*80.0));
    c += vec3(0.9, 0.95, 1.0) * star * 2.5 * uNight * smoothstep(0.0, 0.25, t);
    // milky band
    float band = fbm(d*6.0) * smoothstep(0.35, 0.0, abs(dot(d, normalize(vec3(0.3, 0.2, 1.0)))));
    c += vec3(0.25, 0.28, 0.4) * band * 0.25 * uNight;
    float md = max(dot(d, uMoonDir), 0.0);
    float disc = smoothstep(0.99965, 0.99975, md);
    float craters = 0.85 + 0.15*fbm(d*400.0);
    c += vec3(0.95, 0.96, 1.0) * (disc * 3.0 * craters + pow(md, 60.0) * 0.25) * uNight;
  }
  if(uClouds && t > 0.0){
    vec2 cp = d.xz/(t+0.15)*1.2 + vec2(uTime*0.01, 0.0);
    float cl = smoothstep(0.5, 0.85, fbm(vec3(cp, 0.0)*1.5));
    vec3 cc = mix(vec3(1.0,0.95,0.9), uSunColor, 0.3) * (0.9 + 0.3*pow(sd,4.0));
    cc = mix(cc, vec3(0.08, 0.09, 0.13), uNight);
    c = mix(c, cc, cl*smoothstep(0.0,0.25,t)*0.8);
  }
  outColor = vec4(c, 1.0);
}`;

export const GRID_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj; uniform float uExtent; uniform vec3 uCenter;
out vec3 vWorld;
void main(){ vec3 p = vec3(aPos.x*uExtent + uCenter.x, 0.0, aPos.z*uExtent + uCenter.z); vWorld = p; gl_Position = uViewProj*vec4(p,1.0); }`;

export const GRID_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec3 uCamPos; uniform float uExtent;
out vec4 outColor;
float gridLine(vec2 p, float scale){
  vec2 c = p/scale; vec2 g = abs(fract(c-0.5)-0.5)/fwidth(c);
  return 1.0 - min(min(g.x,g.y),1.0);
}
void main(){
  vec2 p = vWorld.xz;
  float d = length(uCamPos.xz - p);
  float h = abs(uCamPos.y);
  float l1 = gridLine(p, 1.0), l10 = gridLine(p, 10.0), l01 = gridLine(p, 0.1);
  float fade = 1.0 - smoothstep(uExtent*0.2, uExtent*0.5, d);
  float fine = (1.0 - smoothstep(2.0, 10.0, h)) ;
  float a = max(max(l1*0.35, l10*0.5), l01*0.18*fine);
  vec3 col = vec3(0.34);
  vec2 ax = abs(p)/fwidth(p);
  float xAxis = 1.0 - min(ax.y, 1.0); // z = 0 line -> X axis
  float zAxis = 1.0 - min(ax.x, 1.0);
  if(xAxis > 0.01){ col = mix(col, vec3(0.9,0.22,0.27), xAxis); a = max(a, xAxis*0.9); }
  if(zAxis > 0.01){ col = mix(col, vec3(0.2,0.45,0.95), zAxis); a = max(a, zAxis*0.9); }
  outColor = vec4(col, a*fade);
}`;

export const LINE_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aColor;
uniform mat4 uViewProj;
out vec4 vColor;
void main(){ vColor = aColor; gl_Position = uViewProj*vec4(aPos,1.0); }`;

export const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor; uniform float uAlpha; out vec4 outColor;
void main(){ outColor = vec4(vColor.rgb, vColor.a*uAlpha); }`;

export const PARTICLE_VS = /* glsl */ `#version 300 es
layout(location=0) in vec4 aPosSize;
layout(location=1) in vec4 aColor;
uniform mat4 uViewProj; uniform float uScale;
out vec4 vColor;
void main(){ vec4 p = uViewProj*vec4(aPosSize.xyz,1.0); gl_Position = p; gl_PointSize = aPosSize.w*uScale/max(p.w,0.1); vColor = aColor; }`;

export const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor; out vec4 outColor;
void main(){ vec2 d = gl_PointCoord*2.0-1.0; float r = dot(d,d); if(r>1.0) discard; float a = (1.0-r); a*=a; outColor = vec4(vColor.rgb, vColor.a*a); }`;

export const POST_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uColor; uniform sampler2D uBloom;
uniform float uExposure; uniform float uVignette; uniform float uGrain; uniform float uTime; uniform bool uTonemap; uniform float uBloomStrength;
uniform vec2 uTexel; uniform bool uFXAA;
uniform vec2 uSunUV; uniform float uGodRays; uniform vec3 uRayColor;
uniform sampler2D uBloom2; uniform sampler2D uBloom3;
uniform float uSaturation; uniform float uContrast; uniform vec3 uWhite; uniform float uSharpen; uniform float uAberration;
uniform float uDamage; uniform float uBlink; uniform float uNVG; uniform float uFlashWhite; uniform float uDesat;
out vec4 outColor;
vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
vec3 fxaa(vec2 uv){
  vec3 rgbNW = texture(uColor, uv+vec2(-1.0,-1.0)*uTexel).rgb, rgbNE = texture(uColor, uv+vec2(1.0,-1.0)*uTexel).rgb;
  vec3 rgbSW = texture(uColor, uv+vec2(-1.0,1.0)*uTexel).rgb, rgbSE = texture(uColor, uv+vec2(1.0,1.0)*uTexel).rgb;
  vec3 rgbM = texture(uColor, uv).rgb;
  float lNW=luma(rgbNW), lNE=luma(rgbNE), lSW=luma(rgbSW), lSE=luma(rgbSE), lM=luma(rgbM);
  float lMin=min(lM,min(min(lNW,lNE),min(lSW,lSE))), lMax=max(lM,max(max(lNW,lNE),max(lSW,lSE)));
  vec2 dir = vec2(-((lNW+lNE)-(lSW+lSE)), ((lNW+lSW)-(lNE+lSE)));
  float red = max((lNW+lNE+lSW+lSE)*0.03125, 1.0/128.0);
  float rcp = 1.0/(min(abs(dir.x),abs(dir.y))+red);
  dir = clamp(dir*rcp, -8.0, 8.0)*uTexel;
  vec3 A = 0.5*(texture(uColor, uv+dir*(1.0/3.0-0.5)).rgb + texture(uColor, uv+dir*(2.0/3.0-0.5)).rgb);
  vec3 B = A*0.5 + 0.25*(texture(uColor, uv-dir*0.5).rgb + texture(uColor, uv+dir*0.5).rgb);
  float lB = luma(B);
  return (lB<lMin||lB>lMax) ? A : B;
}
void main(){
  vec3 c = uFXAA ? fxaa(vUV) : texture(uColor, vUV).rgb;
  if(uAberration > 0.0){ // slight lens fringing toward the corners
    vec2 off = (vUV - 0.5) * uAberration * 0.004;
    c.r = texture(uColor, vUV + off).r; c.b = texture(uColor, vUV - off).b;
  }
  if(uSharpen > 0.0){ // contrast-adaptive sharpening
    vec3 nb = texture(uColor, vUV + vec2(uTexel.x, 0.0)).rgb + texture(uColor, vUV - vec2(uTexel.x, 0.0)).rgb + texture(uColor, vUV + vec2(0.0, uTexel.y)).rgb + texture(uColor, vUV - vec2(0.0, uTexel.y)).rgb;
    c = max(c + (c - nb * 0.25) * uSharpen / (1.0 + luma(c)), vec3(0.0));
  }
  c += (texture(uBloom, vUV).rgb + texture(uBloom2, vUV).rgb * 0.9 + texture(uBloom3, vUV).rgb * 0.8) * uBloomStrength;
  if(uGodRays > 0.0){
    // screen-space light scattering: march toward the sun through the bright (bloom) buffer
    vec2 dir = (vUV - uSunUV) / 40.0;
    vec2 uv = vUV; float decay = 1.0; vec3 acc = vec3(0.0);
    for(int i = 0; i < 40; i++){ uv -= dir; acc += texture(uBloom, uv).rgb * decay; decay *= 0.955; }
    c += acc / 40.0 * uGodRays * uRayColor;
  }
  if(uTonemap){
    c *= uWhite;
    c = aces(c*uExposure*(1.0 + uNVG*5.0));
    float l = luma(c);
    c = mix(vec3(l), c, uSaturation);
    c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
    c = pow(c, vec3(1.0/2.2));
  }
  vec2 q = vUV-0.5;
  if(uNVG > 0.0){
    float l0 = dot(c, vec3(0.3,0.59,0.11));
    float n0 = fract(sin(dot(floor(vUV/uTexel*0.5)+uTime*60.0, vec2(12.9898,78.233)))*43758.5453);
    l0 = l0*1.1 + (n0-0.5)*0.12;
    vec2 qa = vec2(q.x*uTexel.y/uTexel.x, q.y);
    vec3 g = vec3(0.25,1.0,0.35)*l0*(0.94 + 0.06*sin(vUV.y/uTexel.y*1.5));
    c = mix(c, g*(0.08 + 0.92*smoothstep(0.66, 0.5, length(qa))), uNVG);
  }
  float l2 = dot(c, vec3(0.3,0.59,0.11));
  c = mix(c, vec3(l2), clamp(uDesat, 0.0, 1.0));
  c *= 1.0 - dot(q,q)*uVignette;
  c = mix(c, vec3(0.45,0.0,0.0), smoothstep(0.12, 0.75, length(q*vec2(1.3,1.0)))*uDamage*0.85);
  c = mix(c, vec3(1.0), clamp(uFlashWhite, 0.0, 1.0));
  if(uBlink > 0.0){ float open = 1.0 - uBlink; c *= 1.0 - smoothstep(open - 0.07, open, abs(q.y)*2.0); }
  float n = fract(sin(dot(vUV*1000.0+uTime, vec2(12.9898,78.233)))*43758.5453);
  c += (n-0.5)*uGrain;
  outColor = vec4(c, 1.0);
}`;

export const BRIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uColor; uniform vec2 uTexel; uniform float uThreshold; uniform int uPass;
out vec4 outColor;
void main(){
  if(uPass==0){
    vec3 c = vec3(0.0);
    for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) c += texture(uColor, vUV + vec2(x,y)*uTexel).rgb;
    c /= 9.0;
    float l = max(c.r, max(c.g, c.b));
    outColor = vec4(c * max(l-uThreshold,0.0)/max(l,1e-4), 1.0);
  } else if(uPass==2){ // plain 4-tap downsample for the wider bloom levels
    vec3 c = texture(uColor, vUV + uTexel*vec2(-0.5,-0.5)).rgb + texture(uColor, vUV + uTexel*vec2(0.5,-0.5)).rgb + texture(uColor, vUV + uTexel*vec2(-0.5,0.5)).rgb + texture(uColor, vUV + uTexel*vec2(0.5,0.5)).rgb;
    outColor = vec4(c*0.25, 1.0);
  } else {
    // separable 9-tap gaussian; uTexel carries the direction
    vec3 c = texture(uColor, vUV).rgb*0.227;
    c += (texture(uColor, vUV+uTexel*1.385).rgb + texture(uColor, vUV-uTexel*1.385).rgb)*0.316;
    c += (texture(uColor, vUV+uTexel*3.231).rgb + texture(uColor, vUV-uTexel*3.231).rgb)*0.070;
    outColor = vec4(c,1.0);
  }
}`;

export const GBUF_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vNormal; in vec2 vUV; in vec3 vRest; in vec3 vRestN; in vec4 vShadow;
uniform mat4 uView; uniform bool uDoubleSided;
uniform float uRoughness; uniform float uMetallic; uniform int uPattern; uniform float uTime;
layout(location=0) out vec4 outG;   // view-space normal, linear depth
layout(location=1) out vec4 outM;   // roughness, metallic, puddle, 1
${NOISE}
${WET}
void main(){
  vec3 n = normalize(vNormal);
  if(uDoubleSided && !gl_FrontFacing) n = -n;
  float rough = uRoughness, metal = uMetallic;
  if(uPattern == 19){ rough = 0.05; metal = 0.4; } // window glass
  float pud = 0.0;
  if(uWetness > 0.0){ float damp = uWetness * (0.5 + 0.5*smoothstep(-0.3, 0.7, n.y)); pud = puddleMask(vWorld, n); rough = mix(mix(rough, rough*0.45, damp), 0.02, pud); }
  vec3 vn = normalize(mat3(uView) * n);
  float d = -(uView * vec4(vWorld, 1.0)).z;
  outG = vec4(vn, d);
  outM = vec4(rough, metal, pud, 1.0);
}`;

export const SSAO_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uG; uniform mat4 uProj; uniform vec2 uTan; uniform float uRadius; uniform float uIntensity;
uniform vec3 uKernel[16];
out vec4 outColor;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec3 viewPos(vec2 uv, float d){ vec2 ndc = uv*2.0-1.0; return vec3(ndc.x*uTan.x*d, ndc.y*uTan.y*d, -d); }
void main(){
  vec4 g = texture(uG, vUV);
  if(g.w <= 0.0){ outColor = vec4(1.0); return; }
  vec3 p = viewPos(vUV, g.w), n = normalize(g.xyz);
  float a = h12(gl_FragCoord.xy) * 6.2831;
  vec3 rv = vec3(cos(a), sin(a), 0.0);
  vec3 t = normalize(rv - n*dot(rv, n)), b = cross(n, t);
  mat3 TBN = mat3(t, b, n);
  float occ = 0.0;
  for(int i = 0; i < 16; i++){
    vec3 sp = p + TBN * uKernel[i] * uRadius;
    vec4 c = uProj * vec4(sp, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
    float sd = texture(uG, uv).w;
    if(sd <= 0.0) continue;
    float range = smoothstep(0.0, 1.0, uRadius / abs(g.w - sd));
    occ += (sd < -sp.z - 0.02 ? 1.0 : 0.0) * range;
  }
  outColor = vec4(vec3(clamp(1.0 - occ / 16.0 * uIntensity, 0.0, 1.0)), 1.0);
}`;

export const AOBLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uAO; uniform sampler2D uG; uniform vec2 uTexel;
out vec4 outColor;
void main(){
  float d0 = texture(uG, vUV).w, sum = 0.0, wsum = 0.0;
  for(int y = -2; y <= 2; y++) for(int x = -2; x <= 2; x++){
    vec2 uv = vUV + vec2(x, y) * uTexel;
    float d = texture(uG, uv).w;
    float w = 1.0 / (1.0 + abs(d - d0) * 8.0);
    sum += texture(uAO, uv).r * w; wsum += w;
  }
  outColor = vec4(vec3(sum / max(wsum, 1e-4)), 1.0);
}`;


// V3 screen-space reflections (half resolution): march the reflected view ray through the
// depth buffer, refine the hit with a binary search and fetch the lit colour there.
export const SSR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uG; uniform sampler2D uM; uniform sampler2D uColor;
uniform mat4 uProj; uniform vec2 uTan; uniform float uMaxRough; uniform float uTime;
out vec4 outColor;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec3 viewPos(vec2 uv, float d){ vec2 ndc = uv*2.0-1.0; return vec3(ndc.x*uTan.x*d, ndc.y*uTan.y*d, -d); }
vec2 project(vec3 q){ vec4 c = uProj * vec4(q, 1.0); return c.xy / c.w * 0.5 + 0.5; }
void main(){
  vec4 g = texture(uG, vUV); vec4 m = texture(uM, vUV);
  if(g.w <= 0.0 || m.r > uMaxRough){ outColor = vec4(0.0); return; }
  vec3 p = viewPos(vUV, g.w), n = normalize(g.xyz), v = normalize(p);
  vec3 r = normalize(reflect(v, n));
  float stepLen = 0.08 + 0.02 * g.w * 0.1, t = stepLen * (0.5 + h12(gl_FragCoord.xy + fract(uTime) * 61.0));
  vec2 hit = vec2(-1.0); float travelled = 0.0;
  for(int i = 0; i < 48; i++){
    vec3 q = p + r * t;
    if(q.z > -0.05) break;
    vec2 uv = project(q);
    if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sd = texture(uG, uv).w, qd = -q.z;
    if(sd > 0.0 && qd > sd + 0.02 && qd < sd + max(0.35, stepLen * 2.0)){
      float a = t - stepLen, b = t;
      for(int k = 0; k < 6; k++){ float mid = (a + b) * 0.5; vec3 qm = p + r * mid; float smd = texture(uG, project(qm)).w; if(-qm.z > smd) b = mid; else a = mid; }
      hit = project(p + r * b); travelled = b; break;
    }
    stepLen *= 1.09; t += stepLen;
  }
  if(hit.x < 0.0){ outColor = vec4(0.0); return; }
  vec3 col = texture(uColor, hit).rgb;
  float edge = smoothstep(0.0, 0.07, min(min(hit.x, 1.0 - hit.x), min(hit.y, 1.0 - hit.y)));
  float conf = edge * (1.0 - smoothstep(uMaxRough * 0.5, uMaxRough, m.r)) * (1.0 - smoothstep(0.35, 0.85, r.z)) * (1.0 - smoothstep(25.0, 45.0, travelled));
  outColor = vec4(min(col, vec3(40.0)), conf);
}`;

// V3 volumetric lighting (half resolution): raymarch the camera ray through height fog,
// adding sun light where the shadow map says it's lit and light from nearby lamps and spots.
export const VOLUME_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec2 vUV;
uniform sampler2D uG; uniform sampler2DShadow uShadowMap; uniform bool uShadows;
uniform mat4 uInvView; uniform mat4 uShadowVP; uniform vec2 uTan; uniform vec3 uCamPos;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uDensity; uniform float uFogHeight; uniform float uSunScatter; uniform float uLightScatter;
uniform float uMaxDist; uniform float uTime; uniform float uAniso;
#define MAX_LIGHTS 16
uniform int uLightCount; uniform vec4 uLightPos[MAX_LIGHTS]; uniform vec4 uLightColor[MAX_LIGHTS]; uniform vec4 uLightSpot[MAX_LIGHTS];
out vec4 outColor;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hg(float c, float g){ float g2 = g*g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0*g*c, 1.5)); }
void main(){
  float d = texture(uG, vUV).w;
  vec3 vd = normalize(vec3((vUV*2.0-1.0)*uTan, -1.0));
  float T = (d > 0.0 ? min(d, uMaxDist) : uMaxDist) / -vd.z;
  vec3 dir = normalize(mat3(uInvView) * vd);
  const int STEPS = 20;
  float dt = T / float(STEPS), j = h12(gl_FragCoord.xy + fract(uTime)*97.0);
  float cs = dot(dir, uSunDir), sunPhase = hg(cs, uAniso) + 0.02;
  vec3 acc = vec3(0.0); float trans = 1.0;
  for(int i = 0; i < STEPS; i++){
    float t = (float(i) + j) * dt;
    vec3 p = uCamPos + dir * t;
    float dens = uDensity * (uFogHeight > 0.0 ? exp(-max(p.y, 0.0) * uFogHeight) : 1.0);
    vec3 L = vec3(0.0);
    if(uSunScatter > 0.0){
      float lit = 1.0;
      if(uShadows){ vec4 sp = uShadowVP * vec4(p, 1.0); vec3 sc = sp.xyz / sp.w * 0.5 + 0.5; if(sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) lit = texture(uShadowMap, vec3(sc.xy, sc.z - 0.002)); }
      L += uSunColor * lit * sunPhase * uSunScatter;
    }
    for(int k = 0; k < MAX_LIGHTS; k++){
      if(k >= uLightCount) break;
      vec3 Lv = uLightPos[k].xyz - p; float d2 = dot(Lv, Lv), r = uLightPos[k].w;
      if(d2 > r*r) continue;
      float win = clamp(1.0 - pow(d2/(r*r), 2.0), 0.0, 1.0), att = win*win / (d2 + 0.3);
      if(uLightColor[k].w > 0.5){ float cd = dot(-Lv * inversesqrt(max(d2,1e-6)), uLightSpot[k].xyz); att *= smoothstep(uLightSpot[k].w, mix(uLightSpot[k].w, 1.0, 0.25), cd) * 3.0; }
      L += uLightColor[k].rgb * att * uLightScatter * 0.08;
    }
    acc += L * dens * trans * dt;
    trans *= exp(-dens * dt);
  }
  outColor = vec4(acc, trans);
}`;

// Depth-aware 5x5 blur for half-resolution effect buffers (SSR, volumetrics)
export const BILATERAL_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uSrc; uniform sampler2D uG; uniform vec2 uTexel; uniform float uScale;
out vec4 outColor;
void main(){
  float d0 = texture(uG, vUV).w; vec4 sum = vec4(0.0); float wsum = 0.0;
  for(int y = -2; y <= 2; y++) for(int x = -2; x <= 2; x++){
    vec2 uv = vUV + vec2(x, y) * uTexel * uScale;
    float d = texture(uG, uv).w;
    float w = exp(-float(x*x + y*y) * 0.18) / (1.0 + abs(d - d0) * 6.0);
    sum += texture(uSrc, uv) * w; wsum += w;
  }
  outColor = sum / max(wsum, 1e-4);
}`;

// Combine the lit frame with reflections and volumetric light (still HDR).
export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uColor; uniform sampler2D uSSR; uniform sampler2D uVol; uniform sampler2D uG; uniform sampler2D uM;
uniform bool uUseSSR; uniform bool uUseVol; uniform float uSSRStrength;
uniform mat4 uInvView; uniform vec2 uTan;
uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uGroundColor; uniform float uAmbient;
out vec4 outColor;
vec3 skyAt(vec3 d){
  float t = clamp(d.y*0.5+0.5, 0.0, 1.0);
  vec3 c = mix(uGroundColor*0.9, uHorizon, smoothstep(0.35, 0.5, t));
  return mix(c, uZenith, smoothstep(0.5, 0.95, t));
}
void main(){
  vec3 c = texture(uColor, vUV).rgb;
  if(uUseSSR){
    vec4 r = texture(uSSR, vUV);
    if(r.a > 0.001){
      vec4 g = texture(uG, vUV), m = texture(uM, vUV);
      vec3 v = normalize(vec3((vUV*2.0-1.0)*uTan, -1.0)), n = normalize(g.xyz);
      float NoV = clamp(dot(n, -v), 0.0, 1.0);
      float F0 = mix(0.04, 0.75, m.g), F = F0 + (1.0 - F0) * pow(1.0 - NoV, 5.0);
      F *= 1.0 - m.r * 0.8;
      vec3 R = mat3(uInvView) * reflect(v, n);
      // swap the sky reflection the lit pass assumed for what the ray actually hit
      vec3 add = (r.rgb - skyAt(R) * uAmbient * 0.8) * F * r.a * uSSRStrength;
      c = max(c + add, c * 0.25);
    }
  }
  if(uUseVol) c += texture(uVol, vUV).rgb;
  outColor = vec4(c, 1.0);
}`;
