// Game: owns the renderer, scene, level, actors, player, effects, HUD and audio, and glues
// them together (damage, deaths, callouts, noise, explosions, area environments, weather).
import { Renderer, Scene, Camera, Node, Mesh, Material, buildShape, mat4, quat, vec3 } from '../../engine/index.js';
import { buildLevel, AREA2_X } from '../world/level.js';
import { Player } from './player.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { audio } from './audio.js';
import { Squadmate, ClassD, SCP173, SQUAD, hitscan } from './actors.js';
import { WEAPONS, GRENADE_PARTS } from '../content/weapons.js';
import { StaticBuilder, dirFromYawPitch, rand, pick, dist2D, clamp, basisMatrix } from '../util.js';
import { WEAPON_MATERIALS } from '../content/weapons.js';

export class Game {
  constructor(canvas, settings) {
    this.settings = settings;
    this.renderer = new Renderer(canvas, { pixelRatio: Math.min(window.devicePixelRatio || 1, settings.quality === 'low' ? 0.75 : 1.5), msaa: settings.quality === 'low' ? 2 : 4, shadowSize: settings.quality === 'low' ? 1024 : 2048 });
    this.renderer.settings.bloomStrength = 0.28; this.renderer.settings.bloomThreshold = 1.0; this.renderer.settings.vignette = 0.5; this.renderer.settings.grain = 0.03;
    this.scene = new Scene();
    this.camera = new Camera(); this.camera.near = 0.05; this.camera.far = 400;
    this.vmCamera = new Camera(); this.vmCamera.near = 0.01; this.vmCamera.far = 10;
    this.audio = audio;
    this.time = 0; this.frame = 0; this.area = 1; this.areaName = 'GATE B CHECKPOINT';
    this.actors = []; this.squad = []; this.scp173 = null;
    this.hudVisible = false; this.talking = null; this.cameraOverride = null; this.cameraRoll = 0;
    this.level = buildLevel();
    this.physics = this.level.physics; this.nav = this.level.nav;
    for (const a of this.level.areas) if (a) this.scene.add(a.root);
    this.effects = new Effects(this.scene, this.scene.environment, this.physics);
    this.effects.onBrass = (p) => { if (dist2D(p, this.player.pos) < 6) this.audio._tone(3000 + Math.random() * 2500, 0.05, { vol: 0.03, pos: p, type: 'triangle' }); };
    this.player = new Player(this);
    this.scene.add(this.player.vmRoot);
    this.scene.remove(this.player.vmRoot); // drawn in its own pass
    this.hud = new HUD(this);
    this.lightning = { t: 6, flash: 0, seq: [] };
    this.nadeGeo = null;
  }

  // ---------------------------------------------------------------- environments
  setArea(n) {
    this.area = n; this.player.area = n;
    for (let i = 1; i < this.level.areas.length; i++) if (this.level.areas[i]) this.level.areas[i].root.visible = i === n;
    const env = this.scene.environment;
    const P = this.player;
    if (n === 1) {
      this.areaName = 'GATE B · SURFACE';
      Object.assign(env, {
        sky: true, mesas: false, storm: 1, clouds: false, sunDirection: vec3.normalize([0, 0, 0], [-0.3, 0.75, 0.55]), sunColor: [0.55, 0.65, 0.9], sunIntensity: 0.18,
        skyColor: [0.16, 0.2, 0.3], groundColor: [0.06, 0.065, 0.07], ambient: 0.9, horizonColor: [0.12, 0.15, 0.2], zenithColor: [0.05, 0.07, 0.12],
        fogColor: [0.06, 0.075, 0.1], fogDensity: 0.022, exposure: 1.35, wetness: 0.85, rain: 1, shadowCenter: [0, 0, 0], shadowRadius: 30,
        volumetric: 0.7, volumeDensity: 0.035, sunShafts: 0.1, lampGlow: 1.2, anisotropy: 0.55, volumeDistance: 55, fogHeight: 0.12, godRays: 0, night: 0, aoIntensity: 1.4,
      });
      this.effects.rain = 1;
      this.audio.setSpace('outdoor');
    } else {
      this.areaName = 'HCZ · SECTOR 2';
      Object.assign(env, {
        sky: false, storm: 0, sunIntensity: 0, skyColor: [0.08, 0.08, 0.09], groundColor: [0.03, 0.03, 0.03], ambient: 0.14,
        fogColor: [0.012, 0.012, 0.014], fogDensity: 0.03, exposure: 1.25, wetness: 0, rain: 0, flash: 0,
        volumetric: 0.9, volumeDensity: 0.06, sunShafts: 0, lampGlow: 1.4, anisotropy: 0.6, volumeDistance: 30, fogHeight: 0, godRays: 0, aoIntensity: 1.6,
      });
      this.effects.rain = 0;
      this.audio.setSpace('indoor');
    }
    env.dynLights = [...this.level.lights.filter((l) => l.area === n), P.flashlight, ...this.effects.lights];
  }
  areaLightsOn() { return this.area === 1 || this.powerOn; }

  // ---------------------------------------------------------------- spawning
  spawnSquad(positions, yaw = 0) {
    for (const s of this.squad) { s.remove(); this.actors.splice(this.actors.indexOf(s), 1); }
    this.squad = SQUAD.map((info, i) => { const s = new Squadmate(this, info, positions[i]); s.yaw = yaw; s.area = this.area; this.actors.push(s); return s; });
    return this.squad;
  }
  spawnClassD(list, area, alerted = false) {
    const out = [];
    for (const e of list) { const d = new ClassD(this, e.p, e.w, area); if (alerted) d.alert(this.player); this.actors.push(d); out.push(d); }
    return out;
  }
  clearEnemies() {
    for (const a of this.actors.filter((a) => a.team === 'dclass')) a.remove();
    this.actors = this.actors.filter((a) => a.team !== 'dclass');
  }
  surfaceAt(p) {
    if (this.area === 2) { const x = p[0] - AREA2_X; return (x > 9.9 && p[2] > 22 && p[2] < 38) ? 'concrete' : 'concrete'; }
    if (p[2] < -30) return Math.abs(p[0]) < 8 && p[2] > -50 ? 'wet' : 'grass';
    if (p[2] > 39 && Math.abs(p[0]) < 3.4) return 'metal';
    return 'wet';
  }

  // ---------------------------------------------------------------- combat glue
  applyDamage(actor, amount, zone, dir, attacker, point) {
    if (!actor || !actor.alive) return false;
    if (actor.team === 'scp') { this.effects.impact(point, dir.map((v) => -v), 'concrete'); this.audio.impact(point, 'concrete'); if (Math.random() < 0.2 && attacker === this.player) this.playerCallout(pick(["It doesn't even flinch!", 'Bullets do nothing!'])); return false; }
    if (actor.team === 'mtf' && attacker === this.player) return false; // no friendly fire
    if (point && actor.fleshy) this.effects.blood(point, dir.map((v) => -v), zone === 'head' ? 1.5 : 1);
    if (actor.surrendered && attacker === this.player) { this.player.stats.executed = (this.player.stats.executed || 0) + 1; }
    const killed = actor.damage(amount, zone, dir, attacker);
    if (killed && zone === 'head' && attacker === this.player) this.player.stats.headshots++;
    return killed;
  }
  onDeath(actor, attacker, zone) {
    const wname = attacker === this.player ? this.player.weapon.short : attacker && attacker.weaponId ? WEAPONS[attacker.weaponId].short : attacker && attacker.team === 'scp' ? 'SCP-173' : 'FRAG';
    const killer = attacker === this.player ? { name: 'ROOK', team: 'mtf' } : attacker ? { name: attacker.team === 'scp' ? 'SCP-173' : attacker.name, team: attacker.team } : { name: '—' };
    this.hud.kill(killer, wname, actor.name, zone === 'head');
    if (attacker === this.player) { this.player.stats.kills++; if (Math.random() < 0.3) this.playerCallout(pick(['Tango down.', 'Target neutralized.', 'Got him.'])); }
    else if (attacker && attacker.team === 'mtf' && Math.random() < 0.6) this.callout(attacker, pick(['Tango down.', 'Hostile neutralized.', 'Scratch one.', 'He\'s down.']));
    this.director && this.director.onDeath(actor);
  }
  onSurrender(d) {
    this.player.stats.detained++;
    this.hud.kill({ name: 'ROOK', team: 'mtf' }, 'DETAINED', d.name, false);
    this.hud.toast(d.name + ' SURRENDERED — DETAINED');
    const s = this.squad[0]; if (s) this.callout(s, pick(["Good call. Foundation's short on D-Class.", 'Hands where I can see them!', "Stay down, he's giving up!"]));
    this.director && this.director.onDeath(d);
  }
  melee(attacker, target, dmg) {
    if (!target) return;
    if (target === this.player) { if (!this.player.controlsEnabled) return; this.player.damage(dmg, attacker); this.audio.impact(this.player.chest(), 'flesh'); this.player.shake = 0.8; }
    else if (target.team === 'mtf') target.damage(dmg, 'torso', null, attacker);
  }
  // bullets that pass near the player: hit (capsule test) or whiz by
  bulletNearPlayer(o, d, shooter, dmg, maxT) {
    const P = this.player; if (!P.alive || !P.controlsEnabled || shooter.team === 'mtf') return;
    const c = P.chest();
    const w = [c[0] - o[0], c[1] - o[1], c[2] - o[2]], t = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
    if (t < 0 || t > maxT) return;
    const miss = Math.hypot(w[0] - d[0] * t, w[1] - d[1] * t, w[2] - d[2] * t);
    const r = 0.28 + (1 - P.crouch) * 0.05;
    if (miss < r) { P.damage(dmg * 0.55 * this.settings.difficulty, shooter); this.effects.blood(c, d.map((v) => -v), 0.4); }
    else if (miss < 1.6) { this.audio.whiz(c); P.shake = Math.min(1, P.shake + 0.08); }
  }
  noise(p, radius, src) {
    for (const a of this.actors) if (a.team === 'dclass' && a.alive && a.area === this.area && dist2D(a.pos, p) < radius) a.alert(src);
  }
  explode(p, owner) {
    this.effects.explosion(p); this.audio.explosion(p);
    for (const a of this.actors) {
      if (!a.alive || a.team === 'scp') continue;
      const c = a.center(), d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
      if (d < 7 && this.physics.lineOfSight([p[0], p[1] + 0.3, p[2]], c)) { const dir = vec3.normalize([0, 0, 0], [c[0] - p[0], c[1] - p[1] + 0.5, c[2] - p[2]]); this.applyDamage(a, 160 * (1 - d / 7), 'torso', dir, owner, c); }
    }
    const pc = this.player.chest(), pd = Math.hypot(pc[0] - p[0], pc[1] - p[1], pc[2] - p[2]);
    if (pd < 6 && this.physics.lineOfSight([p[0], p[1] + 0.3, p[2]], pc)) this.player.damage(120 * (1 - pd / 6), { pos: p });
    this.player.shake = Math.min(1, this.player.shake + Math.max(0, 1 - pd / 25));
    this.noise(p, 40, owner);
  }
  makeGrenadeNode() {
    if (!this.nadeTemplate) {
      const sb = new StaticBuilder({});
      const mats = {}; for (const [k, v] of Object.entries(WEAPON_MATERIALS)) mats[k] = new Material({ name: k, ...v });
      for (const p of GRENADE_PARTS) sb.add(mats[p.material], p.shape, { position: p.position, rotation: p.rotation, scale: p.scale });
      this.nadeTemplate = sb;
    }
    const n = this.nadeTemplate.build('frag'); this.scene.add(n); return n;
  }

  // ---------------------------------------------------------------- dialogue
  callout(actor, text, dur = 2.6) {
    if (!actor || !text) return;
    this.hud.subtitle(actor.info ? actor.info.call : actor.name, text, dur);
    this.talking = actor;
  }
  radio(speaker, text, dur = 3.4) {
    const colors = { OVERWATCH: '#f2c96a', KESTREL: '#6ff3e4', HEX: '#9fd8ff', GRIM: '#b6f59a', PATCH: '#ffb2a8', ROOK: '#e8e8e8', 'D-CLASS': '#ff9a60' };
    this.hud.subtitle(speaker, text, dur, colors[speaker] || '#6ff3e4');
    const s = this.squad.find((q) => q.info.call === speaker); if (s) this.talking = s;
  }
  playerCallout(text) { if (this.hud.subQueue.length < 2) this.hud.subtitle('ROOK', text, 1.6, '#e8e8e8'); }
  shout(d) { if (dist2D(d.pos, this.player.pos) < 22 && this.hud.subQueue.length < 2 && Math.random() < 0.5) this.hud.subtitle(d.name, pick(["It's the Foundation!", 'Kill the bluecoats!', "We ain't going back!", 'Nine-Tailed Fox! Run!', 'Get their guns!']), 1.8, '#ff9a60'); }
  clockDir(from, p) {
    const a = Math.atan2(p[0] - from.pos[0], p[2] - from.pos[2]) - this.player.yaw;
    const h = ((Math.round(-a / (Math.PI / 6)) % 12) + 12) % 12;
    return (h === 0 ? 12 : h) + " o'clock";
  }

  // ---------------------------------------------------------------- per-frame world
  updateWorld(dt) {
    const env = this.scene.environment;
    // lightning (Area 1)
    if (this.area === 1) {
      const L = this.lightning;
      L.t -= dt;
      if (L.t <= 0) { L.t = rand(7, 15); L.seq = [0, 0.08, 0.18, 0.26].map((s, i) => ({ at: s, v: [1, 0.2, 0.8, 0][i] })); L.clock = 0; L.big = Math.random() < 0.5; this.audio.thunder(L.big ? rand(0.1, 0.3) : rand(0.5, 1)); }
      if (L.seq.length) { L.clock += dt; while (L.seq.length && L.seq[0].at <= L.clock) { L.flash = L.seq.shift().v * (L.big ? 1 : 0.5); } }
      L.flash = Math.max(0, L.flash - dt * 2.5);
      env.flash = L.flash; env.sunIntensity = 0.18 + L.flash * 6; env.ambient = 0.9 + L.flash * 1.6;
    }
    for (const d of this.level.dynamic) {
      if (d.area !== this.area) continue;
      if (d.type === 'fire') { const f = 0.75 + 0.25 * Math.sin(this.time * 17) * Math.sin(this.time * 7.3) + Math.random() * 0.1; d.light.intensity = 60 * f; d.node.scale.set([1, 0.85 + f * 0.3, 1]); if (Math.random() < dt * 20) this.effects.sparks.emit([d.pos[0] + rand(-0.6, 0.6), d.pos[1], d.pos[2] + rand(-0.6, 0.6)], { count: 1, dir: [0, 1, 0], speed: 3, spread: 0.6, life: 1.5, size: 0.02, grow: -0.5, color: [4, 1.6, 0.4, 1], gravity: 1, drag: 0.8 }); if (Math.random() < dt * 8) this.effects.smoke.emit([d.pos[0], d.pos[1] + 1.2, d.pos[2]], { count: 1, dir: [0.4, 1, 0.1], speed: 1.6, spread: 0.4, life: 5, size: 0.5, grow: 5, color: [0.08, 0.08, 0.08, 0.5], gravity: 0.5, drag: 0.4 }); }
      if (d.type === 'searchlight') {
        d.t += dt * 0.32;
        const tgt = this.searchTarget || [Math.sin(d.t) * 16, 0, -10 + Math.cos(d.t * 0.7) * 16];
        const p = d.light.position, dir = vec3.normalize([0, 0, 0], [tgt[0] - p[0], tgt[1] - p[1], tgt[2] - p[2]]);
        d.light.spot.direction = dir;
        d.node.worldOverride = basisMatrix(p, dir, [0, 1, 0]);
      }
      if (d.type === 'beacon') { d.t += dt * d.speed; d.light.spot.direction = [Math.cos(d.t), -0.15, Math.sin(d.t)]; }
      if (d.type === 'flicker') { d.light.intensity = d.light.baseIntensity * (Math.sin(this.time * 31 + d.seed) > 0.93 || Math.random() < 0.03 ? 0.1 : 1); }
      if (d.type === 'steam' && Math.random() < dt * 25) this.effects.steam(d.pos);
    }
    // scavenge ammo from weapons dropped by dead Class-D
    const P = this.player;
    for (const a of this.actors) {
      if (a.alive || a.team !== 'dclass' || !a.gun || a.looted || !a.gun.position) continue;
      const gp = a.gun.position;
      if (Math.hypot(gp[0] - P.pos[0], gp[2] - P.pos[2]) < 1.4) {
        a.looted = true;
        for (const id of P.loadout) { const d = WEAPONS[id]; P.ammo[id].reserve = Math.min(d.reserve * 1.5, P.ammo[id].reserve + d.mag); }
        this.hud.toast('AMMO SCAVENGED');
        this.audio.mech('magIn');
      }
    }
    // doors
    for (const k of Object.keys(this.level.doors)) {
      const D = this.level.doors[k];
      if (D.left) {
        D.open += clamp(D.target - D.open, -D.speed * dt, D.speed * dt);
        D.left.position.set([-D.open * D.width, 0, 0]); D.right.position.set([D.open * D.width, 0, 0]);
        D.collider.enabled = D.open < 0.45;
      }
    }
  }
  render(dt) {
    const P = this.player;
    this.frame++;
    // camera
    if (this.cameraOverride || this.debugCam) {
      const c = this.debugCam || this.cameraOverride;
      this.camera.position.set(c.pos); this.camera.target.set(c.target); this.camera.fov = (c.fov || 55) * Math.PI / 180;
      this.camera.up.set(c.up || [0, 1, 0]);
    } else {
      const e = P.eye(), f = P.forward();
      const shake = P.shake * P.shake * 0.02;
      const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
      this.camera.position.set(e);
      this.camera.target.set([e[0] + f[0] + sx, e[1] + f[1] + sy, e[2] + f[2]]);
      const roll = -P.lean * 0.2 + (this.cameraRoll || 0);
      this.camera.up.set([Math.sin(roll) * Math.cos(P.yaw), Math.cos(roll), -Math.sin(roll) * Math.sin(P.yaw)]);
      const w = P.weapon, ads = P.adsAmount;
      const baseFov = this.settings.fov + (P.sprinting ? 5 : 0);
      const fov = baseFov + (w.adsFov - baseFov) * (w.scope ? (ads > 0.85 ? 1 : ads * 0.4) : ads);
      this.camera.fov = fov * Math.PI / 180;
      // view model camera: same pose, fixed FOV
      this.vmCamera.position.set(e); this.vmCamera.target.set(this.camera.target); this.vmCamera.up.set(this.camera.up);
      this.vmCamera.fov = (58 - ads * 8) * Math.PI / 180;
      P.vmRoot.worldOverride = P.rigMatrix();
    }
    this.audio.listener.pos = this.camera.position; this.audio.listener.yaw = Math.atan2(this.camera.target[0] - this.camera.position[0], this.camera.target[2] - this.camera.position[2]);
    const env = this.scene.environment;
    env.shadowCenter = [this.camera.position[0], 0, this.camera.position[2]];
    // post
    const post = this.renderer.post;
    post.damage = clamp((1 - P.hp / P.maxHp) * 1.2 - 0.1, 0, 1) * (0.8 + 0.2 * Math.sin(this.time * 6));
    post.desat = clamp((1 - P.hp / 60), 0, 0.8);
    post.aberration = P.shake * 1.5 + post.damage * 0.5;
    post.nvg = P.nvg ? 1 : 0;
    post.blink = this.fade !== undefined ? this.fade : P.blinkClosed > 0 ? Math.min(1, Math.sin((1 - P.blinkClosed / 0.28) * Math.PI) * 1.4) : 0;
    this.effects.update(dt, this.camera.position);
    const fx = this.effects.renderOptions();
    const vmOn = !this.cameraOverride && !this.debugCam && P.alive && this.showViewModel !== false;
    P.vmRoot.visible = vmOn && P.vmRoot.visible;
    this.renderer.render(this.scene, this.camera, { time: this.time, particles: fx.particles, lines: fx.lines, viewmodel: vmOn ? { root: P.vmRoot, camera: this.vmCamera } : null });
    P.vmRoot.visible = true;
  }
}
