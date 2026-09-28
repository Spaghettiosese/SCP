// Time of day: one number (hours, 0-24) drives the sun and moon, sky and fog colours,
// ambient light, exposure and light shafts. Colours are keyed at a few times of day and
// blended, so sunsets and dawns come out warm and nights come out cool and dark.
import { vec3, clamp, lerp, smoothstep } from './math.js';

const K = [ // hour: sun colour, sky (ambient from above), ground bounce, horizon, zenith, fog
  [0, { sun: [0.35, 0.45, 0.75], si: 0.45, sky: [0.06, 0.08, 0.16], ground: [0.04, 0.035, 0.04], hor: [0.06, 0.07, 0.12], zen: [0.01, 0.015, 0.045], fog: [0.05, 0.06, 0.1], amb: 0.55, exp: 1.5 }],
  [5.2, { sun: [0.35, 0.45, 0.75], si: 0.4, sky: [0.08, 0.1, 0.2], ground: [0.05, 0.045, 0.05], hor: [0.14, 0.12, 0.2], zen: [0.03, 0.04, 0.1], fog: [0.1, 0.1, 0.16], amb: 0.6, exp: 1.4 }],
  [6.3, { sun: [1.0, 0.5, 0.25], si: 1.8, sky: [0.45, 0.42, 0.6], ground: [0.35, 0.24, 0.2], hor: [1.0, 0.55, 0.35], zen: [0.25, 0.3, 0.55], fog: [0.75, 0.55, 0.45], amb: 0.75, exp: 1.1 }],
  [8, { sun: [1.0, 0.85, 0.66], si: 2.8, sky: [0.52, 0.64, 0.88], ground: [0.42, 0.33, 0.25], hor: [0.95, 0.78, 0.62], zen: [0.28, 0.46, 0.8], fog: [0.86, 0.75, 0.64], amb: 0.9, exp: 1.0 }],
  [12.5, { sun: [1.0, 0.95, 0.86], si: 3.3, sky: [0.55, 0.68, 0.92], ground: [0.44, 0.35, 0.26], hor: [0.9, 0.82, 0.72], zen: [0.25, 0.47, 0.85], fog: [0.86, 0.8, 0.72], amb: 0.9, exp: 1.0 }],
  [17, { sun: [1.0, 0.8, 0.55], si: 2.9, sky: [0.55, 0.6, 0.8], ground: [0.45, 0.32, 0.22], hor: [0.98, 0.72, 0.5], zen: [0.27, 0.42, 0.78], fog: [0.88, 0.72, 0.58], amb: 0.88, exp: 1.0 }],
  [18.6, { sun: [1.0, 0.42, 0.18], si: 2.0, sky: [0.5, 0.38, 0.5], ground: [0.38, 0.22, 0.16], hor: [1.0, 0.45, 0.25], zen: [0.22, 0.24, 0.5], fog: [0.8, 0.46, 0.34], amb: 0.72, exp: 1.1 }],
  [19.6, { sun: [0.5, 0.35, 0.55], si: 0.6, sky: [0.14, 0.13, 0.26], ground: [0.08, 0.06, 0.07], hor: [0.35, 0.2, 0.28], zen: [0.05, 0.06, 0.16], fog: [0.2, 0.15, 0.22], amb: 0.6, exp: 1.35 }],
  [21, { sun: [0.35, 0.45, 0.75], si: 0.45, sky: [0.06, 0.08, 0.16], ground: [0.04, 0.035, 0.04], hor: [0.06, 0.07, 0.12], zen: [0.01, 0.015, 0.045], fog: [0.05, 0.06, 0.1], amb: 0.55, exp: 1.5 }],
  [24, { sun: [0.35, 0.45, 0.75], si: 0.45, sky: [0.06, 0.08, 0.16], ground: [0.04, 0.035, 0.04], hor: [0.06, 0.07, 0.12], zen: [0.01, 0.015, 0.045], fog: [0.05, 0.06, 0.1], amb: 0.55, exp: 1.5 }],
];

const mix3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

export const SUNRISE = 5.9, SUNSET = 19.0;

// Sun path: rises in the east (+X), sets in the west (-X), tilted toward the south (-Z).
export function sunDirection(hours, out = [0, 0, 0]) {
  const a = ((hours - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI; // 0 at sunrise, PI at sunset
  return vec3.normalize(out, [Math.cos(a), Math.sin(a), -0.35]);
}

export function applyTimeOfDay(env, hours, { rays = true } = {}) {
  hours = ((hours % 24) + 24) % 24;
  let i = 0;
  while (i < K.length - 2 && K[i + 1][0] <= hours) i++;
  const [h0, a] = K[i], [h1, b] = K[i + 1];
  const t = smoothstep(0, 1, (hours - h0) / (h1 - h0 || 1));
  const sun = sunDirection(hours), moon = vec3.normalize([0, 0, 0], [-sun[0], -sun[1] * 0.9 + 0.35, 0.3]);
  const sunUp = sun[1] > -0.04;
  // the directional light is the sun by day and the moon by night
  const dirLight = sunUp ? sun : moon;
  vec3.copy(env.sunDirection, [dirLight[0], Math.max(dirLight[1], 0.06), dirLight[2]]);
  vec3.normalize(env.sunDirection, env.sunDirection);
  env.sunColor = mix3(a.sun, b.sun, t);
  env.sunIntensity = lerp(a.si, b.si, t) * (sunUp ? smoothstep(-0.04, 0.08, sun[1]) * 0.8 + 0.2 : 1);
  env.skyColor = mix3(a.sky, b.sky, t);
  env.groundColor = mix3(a.ground, b.ground, t);
  env.horizonColor = mix3(a.hor, b.hor, t);
  env.zenithColor = mix3(a.zen, b.zen, t);
  env.fogColor = mix3(a.fog, b.fog, t);
  env.ambient = lerp(a.amb, b.amb, t);
  env.exposure = lerp(a.exp, b.exp, t);
  env.night = clamp(smoothstep(0.1, -0.2, sun[1]), 0, 1);
  env.moonDirection = moon;
  env.sunUp = sunUp;
  // light shafts are strongest when the sun is low
  env.godRays = rays && sunUp ? smoothstep(0.0, 0.08, sun[1]) * (1 - smoothstep(0.3, 0.7, sun[1])) * 0.9 + 0.15 * smoothstep(0, 0.2, sun[1]) : 0;
  env.rayColor = mix3([1, 0.55, 0.3], [1, 0.9, 0.75], smoothstep(0.05, 0.5, sun[1]));
  // volumetric sun scattering: strong shafts at dawn and dusk, a faint haze at noon, moonlight at night
  env.sunShafts = sunUp ? 0.04 + 0.9 * (1 - smoothstep(0.05, 0.45, sun[1])) : 0.35;
  env.timeOfDay = hours;
  return env;
}

// true between dusk and dawn: handy for switching lamps on
export const isDark = (env) => (env.night ?? 0) > 0.35 || (env.timeOfDay !== undefined && (env.timeOfDay < 6.4 || env.timeOfDay > 18.9));
