// Actors: MTF squadmates, Class-D hostiles and SCP-173, plus hitscan combat shared with the player.
import { quat, vec3, mat4 } from '../../engine/index.js';
import { createOperator, createClassD, applyAim, HITBOXES } from '../content/humans.js';
import { npcWeapon, createSCP173 } from '../content/props.js';
import { WEAPONS } from '../content/weapons.js';
import { rand, pick, angleDiff, yawTo, dist2D, clamp } from '../util.js';

// ---------------------------------------------------------------- hitscan
function rayCapsule(o, d, a, b, r) {
  // closest approach between ray o+t d and segment ab
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2], ud = u[0] * d[0] + u[1] * d[1] + u[2] * d[2], uw = u[0] * w[0] + u[1] * w[1] + u[2] * w[2], dw = d[0] * w[0] + d[1] * w[1] + d[2] * w[2];
  const den = uu - ud * ud;
  let s = den > 1e-8 ? (uw - ud * dw) / den : 0; s = clamp(s, 0, 1);
  let t = s * ud - dw; if (t < 0) t = 0;
  // refine s for this t
  s = clamp((t * ud + uw) / (uu || 1), 0, 1);
  const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], q = [a[0] + u[0] * s, a[1] + u[1] * s, a[2] + u[2] * s];
  const dist = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  if (dist > r) return null;
  return Math.max(0, t - Math.sqrt(r * r - dist * dist));
}

export function hitscan(game, origin, dir, range, shooter = null, { ignoreTeam = null } = {}) {
  const world = game.physics.raycast(origin, dir, range, (c) => c.area === game.area || c.area === 0);
  let best = world ? { t: world.t, point: world.point, normal: world.normal, material: world.collider ? world.collider.material : 'dirt' } : null;
  const maxT = best ? best.t : range;
  for (const a of game.actors) {
    if (!a.alive || a === shooter || !a.hittable || (ignoreTeam && a.team === ignoreTeam)) continue;
    const c = a.center();
    // quick sphere reject
    const w = [c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]], tc = w[0] * dir[0] + w[1] * dir[1] + w[2] * dir[2];
    if (tc < -1 || tc > maxT + 1) continue;
    const dd = Math.hypot(w[0] - dir[0] * tc, w[1] - dir[1] * tc, w[2] - dir[2] * tc);
    if (dd > 1.3) continue;
    for (const hb of a.hitboxes()) {
      const t = rayCapsule(origin, dir, hb.a, hb.b, hb.r);
      if (t !== null && t < (best ? best.t : range)) {
        const p = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
        best = { t, point: p, normal: [-dir[0], -dir[1], -dir[2]], actor: a, zone: hb.zone, material: a.fleshy ? 'flesh' : 'concrete' };
      }
    }
  }
  if (best) best.dist = best.t;
  return best;
}

export function spreadDir(dir, spread) {
  if (spread <= 0) return [...dir];
  const up = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const r = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], dir, up)), u = vec3.cross([0, 0, 0], r, dir);
  const a = Math.random() * Math.PI * 2, m = Math.sqrt(Math.random()) * spread;
  const d = [dir[0] + (r[0] * Math.cos(a) + u[0] * Math.sin(a)) * m, dir[1] + (r[1] * Math.cos(a) + u[1] * Math.sin(a)) * m, dir[2] + (r[2] * Math.cos(a) + u[2] * Math.sin(a)) * m];
  return vec3.normalize(d, d);
}

// ---------------------------------------------------------------- base humanoid actor
const tmpM = mat4.create();
export class Human {
  constructor(game, ch, o = {}) {
    this.game = game; this.ch = ch; this.team = o.team; this.fleshy = true; this.hittable = true;
    this.name = o.name || ch.name; this.maxHp = o.hp || 100; this.hp = this.maxHp; this.alive = true;
    this.pos = [...(o.pos || [0, 0, 0])]; this.yaw = o.yaw || 0; this.vel = [0, 0, 0];
    this.speed = 0; this.moveTarget = null; this.path = []; this.repath = 0;
    this.weaponId = o.weapon || null; this.aimPitch = 0; this.aimYaw = 0; this.aimMode = o.weapon ? 'low' : 'none';
    this.fireCd = 0; this.burst = 0; this.mag = this.weaponId ? WEAPONS[this.weaponId].mag : 0; this.reloadT = 0; this.recoil = 0;
    this.target = null; this.seeT = 0; this.flinch = 0; this.area = o.area ?? 1;
    this.anim = 'Idle'; this.locked = null; this.deadT = 0; this.stepPhase = 0;
    this.gun = this.weaponId ? npcWeapon(this.weaponId) : null;
    game.scene.add(ch);
    if (this.gun) game.scene.add(this.gun);
    ch.play('Idle', { fade: 0 });
    ch.mixer.on((e) => { if (e.name === 'footstep' && this.alive && this.near(game.player.pos, 25)) game.audio.footstep(this.pos, game.surfaceAt(this.pos), this.speed > 3 ? 0.3 : 0.18); });
    this._hb = HITBOXES.map((h) => ({ ...h, a: [0, 0, 0], b: [0, 0, 0], idx: ch.skeleton.boneIndex(h.bone) }));
    this._hbFrame = -1;
    this.place();
  }
  near(p, d) { return dist2D(this.pos, p) < d; }
  center() { return [this.pos[0], this.pos[1] + (this.alive ? 1.1 : 0.3), this.pos[2]]; }
  eye() { return [this.pos[0], this.pos[1] + 1.65, this.pos[2]]; }
  hitboxes() {
    if (this._hbFrame === this.game.frame) return this._hb;
    this._hbFrame = this.game.frame;
    const sk = this.ch.skeleton, W = this.ch.world;
    for (const h of this._hb) {
      const hd = sk.worldHead(h.idx), tl = sk.worldTail(h.idx);
      if (h.len) { const d = vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], tl, hd)); tl[0] = hd[0] + d[0] * h.len; tl[1] = hd[1] + d[1] * h.len; tl[2] = hd[2] + d[2] * h.len; hd[1] += 0.03; }
      vec3.transformMat4(h.a, hd, W); vec3.transformMat4(h.b, tl, W);
    }
    return this._hb;
  }
  place() {
    if (this.seated) { this.ch.position.set(this.seated.pos); quat.fromEuler(this.ch.rotation, 0, this.seated.yaw * 180 / Math.PI, 0); return; }
    this.ch.position.set(this.pos);
    quat.fromEuler(this.ch.rotation, 0, this.yaw * 180 / Math.PI, 0);
  }
  canSee(p, fov = 2.2) {
    const e = this.eye();
    const yawT = Math.atan2(p[0] - e[0], p[2] - e[2]);
    if (Math.abs(angleDiff(this.yaw, yawT)) > fov / 2) return false;
    return this.game.physics.lineOfSight(e, p);
  }
  setAnim(name, fade = 0.25) { if (this.anim !== name) { this.anim = name; this.ch.play(name, { fade }); } }

  // walk toward moveTarget following nav paths; returns true when arrived
  navigate(dt, speed, arrive = 0.6) {
    if (!this.moveTarget) { this.speed = Math.max(0, this.speed - dt * 8); return true; }
    this.repath -= dt;
    if (this.repath <= 0 || !this.path.length) { this.path = this.game.nav.path(this.pos, this.moveTarget, this.area); this.repath = 1.2 + Math.random(); }
    let wp = this.path[0];
    while (wp && dist2D(this.pos, wp) < 0.5 && this.path.length > 1) { this.path.shift(); wp = this.path[0]; }
    const dTarget = dist2D(this.pos, this.moveTarget);
    if (dTarget < arrive) { this.speed = Math.max(0, this.speed - dt * 10); return true; }
    const desired = yawTo(this.pos, wp);
    if (!this.target || this.aimMode === 'none') this.yaw += angleDiff(this.yaw, desired) * Math.min(1, dt * 8);
    const sp = Math.min(speed, dTarget * 2 + 0.4);
    this.speed += (sp - this.speed) * Math.min(1, dt * 5);
    const d = [Math.sin(desired) * this.speed * dt, 0, Math.cos(desired) * this.speed * dt];
    this.moveDir = desired;
    this.applyMove(d);
    return false;
  }
  applyMove(d) {
    // separation from other actors
    for (const o of this.game.actors) {
      if (o === this || !o.alive || !o.solid) continue;
      const dx = this.pos[0] - o.pos[0], dz = this.pos[2] - o.pos[2], l = Math.hypot(dx, dz);
      if (l < 0.75 && l > 1e-4) { d[0] += (dx / l) * (0.75 - l) * 0.5; d[2] += (dz / l) * (0.75 - l) * 0.5; }
    }
    const r = this.game.physics.move(this.pos, d, 0.33, 1.7, { snap: true });
    this.pos = r.pos;
  }
  get solid() { return this.alive; }

  // blend Idle/Walk/Run by speed, playing clips at matching rates
  locomotion() {
    if (this.locked) return;
    const s = this.speed, mx = this.ch.mixer;
    const w = s < 0.2 ? { Idle: 1 } : s < 1.35 ? { Idle: 1 - s / 1.35, Walk: s / 1.35 } : { Walk: Math.max(0, 1 - (s - 1.35) / 2.2), Run: Math.min(1, (s - 1.35) / 2.2) };
    mx.setWeights(w, 0.25);
    const walk = mx.action('Walk'), run = mx.action('Run');
    if (walk) walk.speed = clamp(s / 1.35, 0.6, 1.6);
    if (run) run.speed = clamp(s / 4.2, 0.7, 1.3);
    // moving backwards / sideways relative to facing: let the feet face the move direction a bit
    this.anim = '*';
  }
  playOnce(name, dur, fade = 0.12) {
    this.locked = name; this.lockT = dur;
    const a = this.ch.mixer.action(name); if (a) { a.time = 0; }
    this.ch.play(name, { fade, restart: true });
  }
  updateAnim(dt) {
    if (this.locked) { this.lockT -= dt; if (this.lockT <= 0 && this.alive) { this.locked = null; this.ch.play('Idle', { fade: 0.2 }); } }
    this.place();
    this.ch.update(dt);
    // aim overlay
    if (this.alive && this.weaponId && this.gun) {
      const pitch = this.aimPitch;
      const m = applyAim(this.ch, this.weaponId, { pitch, yaw: this.aimYaw, mode: this.aimMode === 'none' ? 'low' : this.aimMode, recoil: this.recoil });
      if (m) { this.gun.worldOverride = this.gun.worldOverride || mat4.create(); mat4.multiply(this.gun.worldOverride, this.ch.world, m); }
    }
    this.recoil = Math.max(0, this.recoil - dt * 8);
    if (this.gun && this.gun.flash) { this.gun.flash.visible = this.flashT > 0; this.flashT -= dt; }
  }

  // ---------------------------------------------------------------- combat
  damage(amount, zone, dir, attacker) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.lastHit = this.game.time; this.lastAttacker = attacker;
    if (this.hp <= 0) { this.die(dir, attacker, zone); return true; }
    if (!this.locked && Math.random() < 0.5) this.playOnce('Flinch', 0.25, 0.05);
    this.onHurt && this.onHurt(attacker);
    return false;
  }
  die(dir, attacker, zone) {
    this.alive = false; this.hp = 0; this.deadT = 0;
    const back = dir ? (Math.sin(this.yaw) * dir[0] + Math.cos(this.yaw) * dir[2]) < 0 : Math.random() < 0.5;
    this.locked = 'dead'; this.ch.play(back ? 'DeathBack' : 'DeathFwd', { fade: 0.08, restart: true });
    if (this.gun) { // drop the weapon
      const m = this.gun.worldOverride; if (m) { this.gun.worldOverride = null; this.gun.position.set([m[12] + rand(-0.3, 0.3), 0.05, m[14] + rand(-0.3, 0.3)]); quat.fromEuler(this.gun.rotation, 0, rand(0, 360), 90); }
      if (this.gun.flash) this.gun.flash.visible = false;
    }
    this.game.onDeath && this.game.onDeath(this, attacker, zone);
    setTimeout(() => this.game.effects.bloodPool(this.pos, rand(1.2, 1.8)), 900);
  }
  shootAt(p, accuracy, dt) {
    const def = WEAPONS[this.weaponId];
    if (!def) return;
    this.fireCd -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.mag = def.mag; return; }
    if (this.fireCd > 0) return;
    if (this.mag <= 0) { this.reloadT = def.reload * 1.2; this.onReload && this.onReload(); return; }
    const m = this.gun.worldOverride;
    const muzzle = m ? vec3.transformMat4([0, 0, 0], def.muzzle, m) : this.eye();
    const dir = vec3.normalize([0, 0, 0], [p[0] - muzzle[0], p[1] - muzzle[1], p[2] - muzzle[2]]);
    const pellets = def.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const d = spreadDir(dir, accuracy + (def.pelletSpread || 0));
      const h = hitscan(this.game, muzzle, d, 120, this, { ignoreTeam: this.team });
      const end = h ? h.point : [muzzle[0] + d[0] * 80, muzzle[1] + d[1] * 80, muzzle[2] + d[2] * 80];
      if (i === 0) this.game.effects.tracer(muzzle, end, this.team === 'mtf' ? [2.2, 2.0, 1.6] : [3.2, 1.6, 0.8], 200);
      if (h) {
        if (h.actor) this.game.applyDamage(h.actor, def.damage * (this.team === 'mtf' ? 0.55 : 1) * (h.zone === 'head' ? def.headMul : h.zone === 'limb' ? 0.7 : 1), h.zone, d, this, h.point);
        else if (h.target === 'player') void 0;
        else { this.game.effects.impact(h.point, h.normal, h.material); if (dist2D(h.point, this.game.player.pos) < 15) this.game.audio.impact(h.point, h.material); }
      }
      // bullets aimed at the player resolve against the player's capsule
      this.game.bulletNearPlayer(muzzle, d, this, def.damage * (pellets > 1 ? 1 : 1), h ? h.dist : 120);
    }
    this.game.effects.muzzle(muzzle, dir, def.pistol ? 0.5 : 0.8, def.sound.suppressed);
    this.game.audio.gunshot(def.sound, muzzle, { npc: true });
    this.flashT = 0.05; this.recoil = 1;
    this.mag--;
    this.fireCd = 60 / def.rpm * (def.modes[0] === 'AUTO' ? 1 : 1.8) + (this.team === 'dclass' ? 0.12 : 0.02);
  }
  faceTo(p, dt, rate = 7) {
    const want = yawTo(this.pos, p);
    this.yaw += angleDiff(this.yaw, want) * Math.min(1, dt * rate);
    const e = this.eye(), dx = p[0] - e[0], dz = p[2] - e[2];
    this.aimPitch += (Math.atan2(p[1] - e[1] + 0.1, Math.hypot(dx, dz)) - this.aimPitch) * Math.min(1, dt * 8);
    return Math.abs(angleDiff(this.yaw, want));
  }
  remove() { this.game.scene.remove(this.ch); if (this.gun) this.game.scene.remove(this.gun); }
}

// ---------------------------------------------------------------- MTF squadmate
export const SQUAD = [
  { id: 'reyes', rank: 'LT', rankFull: 'Lieutenant', first: 'Daniel', last: 'Reyes', call: 'KESTREL', role: 'Team Leader', weapon: 'm4a1', gear: 'nvg', beard: true, skin: '#b98262', voice: 0.9 },
  { id: 'volkova', rank: 'SSGT', rankFull: 'Staff Sergeant', first: 'Ivana', last: 'Volkova', call: 'HEX', role: 'Breacher', weapon: 'm1014', gear: 'mask', skin: '#e0b096', voice: 1.25 },
  { id: 'okafor', rank: 'SGT', rankFull: 'Sergeant', first: 'Tobias', last: 'Okafor', call: 'GRIM', role: 'Marksman', weapon: 'm110', gear: 'goggles', skin: '#5e3c2a', voice: 0.8 },
  { id: 'brennan', rank: 'CPL', rankFull: 'Corporal', first: 'Lucas', last: 'Brennan', call: 'PATCH', role: 'Corpsman', weapon: 'mp7', gear: 'nvg', medic: true, skin: '#d2a07e', voice: 1.05 },
];

export class Squadmate extends Human {
  constructor(game, info, pos) {
    const ch = createOperator({ name: info.last, gear: info.gear, beard: info.beard, skin: info.skin, medic: info.medic });
    super(game, ch, { team: 'mtf', pos, weapon: info.weapon, hp: 400, name: info.call });
    this.info = info; this.slot = SQUAD.indexOf(info); this.mode = 'follow'; this.hold = null;
    this.blinkT = rand(2, 6); this.blinking = 0; this.watching = false; this.healCd = 0; this.calloutCd = rand(2, 5);
    this.hittable = true; this.invulnerable = true; // story characters don't die
    this.aimMode = 'low';
  }
  damage(amount, zone, dir, attacker) { this.hp = Math.max(60, this.hp - amount * 0.3); this.lastHit = this.game.time; if (!this.locked) this.playOnce('Flinch', 0.25, 0.05); return false; }
  formationPoint() {
    const P = this.game.player, off = [[-1.8, -1.6], [1.8, -1.8], [-1.2, -3.4], [1.4, -3.6]][this.slot];
    const s = Math.sin(P.yaw), c = Math.cos(P.yaw);
    return [P.pos[0] + c * off[0] + s * off[1], 0, P.pos[2] - s * off[0] + c * off[1]];
  }
  update(dt) {
    const g = this.game;
    if (this.mode === 'cutscene') { this.updateAnim(dt); return; }
    this.calloutCd -= dt; this.healCd -= dt;
    // blinking (matters around SCP-173)
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinking = 0.22; this.blinkT = rand(3.5, 6.5); }
    this.blinking = Math.max(0, this.blinking - dt);
    // pick a target
    this.seeT -= dt;
    if (this.seeT <= 0) {
      this.seeT = 0.3 + Math.random() * 0.2;
      let best = null, bd = 45;
      for (const a of g.actors) if (a.alive && a.team === 'dclass' && !a.surrendered && a.area === g.area) { const d = dist2D(a.pos, this.pos); if (d < bd && g.physics.lineOfSight(this.eye(), a.center())) { bd = d; best = a; } }
      if (best && !this.target && this.calloutCd <= 0) { g.callout(this, pick(['Contact!', 'Tango, ' + g.clockDir(this, best.pos) + '!', 'Hostile spotted!', 'D-Class, weapons free!'])); this.calloutCd = 6; }
      this.target = best;
    }
    const s173 = g.scp173;
    this.watching = false;
    let moveSpeed = 3.6;
    // --- movement goal
    if (this.mode === 'script') { /* director drives moveTarget */ }
    else if (this.mode === 'hold' && this.hold) this.moveTarget = this.hold;
    else {
      const f = this.formationPoint();
      if (!this.moveTarget || dist2D(this.moveTarget, f) > 1.2) this.moveTarget = f;
      const dp = dist2D(this.pos, g.player.pos);
      moveSpeed = dp > 8 ? 4.4 : dp > 4 ? 3.2 : 1.8;
    }
    // --- SCP-173: keep eyes on it
    if (s173 && s173.active && !s173.contained) {
      const c = s173.center();
      if (dist2D(this.pos, c) < 26 && g.physics.lineOfSight(this.eye(), c)) {
        const off = this.faceTo(c, dt, 10);
        this.aimMode = 'aim';
        this.watching = off < 0.6 && this.blinking <= 0 && !this.target && s173.lit(this);
        if (this.calloutCd <= 0 && this.blinking > 0) { g.callout(this, pick(['Blinking!', 'Blink!', 'Eyes closed—cover me!'])); this.calloutCd = 7; }
      }
    }
    // --- combat
    if (this.target && this.target.alive) {
      const tp = this.target.center();
      const off = this.faceTo(tp, dt, 9);
      this.aimMode = 'aim';
      if (off < 0.25) this.shootAt(tp, 0.03 + (this.speed > 1 ? 0.03 : 0), dt);
      if (this.mode !== 'script' && dist2D(this.pos, g.player.pos) < 10) moveSpeed = 1.4;
    } else if (!(s173 && s173.active && !s173.contained && this.watching)) {
      this.aimMode = this.speed > 3 ? 'low' : 'low';
      this.aimPitch *= 0.9;
    }
    this.navigate(dt, moveSpeed, 0.8);
    if (!this.target && !(s173 && s173.active) && this.speed < 0.3 && this.mode === 'follow') {
      // idle: face roughly where the player looks
      this.yaw += angleDiff(this.yaw, g.player.yaw) * Math.min(1, dt * 1.5);
    }
    // --- corpsman heals the player
    if (this.info.medic && g.player.hp < 45 && g.player.alive && this.healCd <= 0 && dist2D(this.pos, g.player.pos) < 3.5 && !this.target) {
      g.player.heal(55); this.healCd = 25;
      g.callout(this, pick(['Hold still—stim going in.', 'Patched up. Stay in the fight.', "You're good, move!"]));
    } else if (this.info.medic && g.player.hp < 45 && this.healCd <= 0 && this.mode === 'follow') { this.moveTarget = g.player.pos.slice(); }
    this.locomotion();
    this.updateAnim(dt);
  }
  onReload() { if (this.calloutCd <= 1 && Math.random() < 0.6) { this.game.callout(this, pick(['Reloading!', 'Changing mags!', 'Cover me, reloading!'])); this.calloutCd = 4; } }
}

// ---------------------------------------------------------------- Class-D hostile
export class ClassD extends Human {
  constructor(game, pos, weapon, area) {
    const ch = createClassD({ hair: pick(['bald', 'buzz', 'short']), skin: pick(['#b77f5c', '#8a5a3c', '#d8a484', '#6b4430', '#c9956f']), beard: Math.random() < 0.4, bloody: Math.random() < 0.35 });
    super(game, ch, { team: 'dclass', pos, weapon, hp: 100, area, yaw: rand(0, 6.28) });
    this.name = 'D-' + ch.number;
    this.state = 'idle'; this.alertT = 0; this.meleeCd = 0; this.stuckT = 0; this.reposT = rand(1, 3);
    this.aimMode = weapon ? 'low' : 'none';
    this.surrendered = false; this.aimedAtT = 0;
    this.wander = [...pos];
  }
  alert(src) { if (this.state === 'idle' && !this.surrendered) { this.state = 'combat'; this.alertT = 0; if (src) this.target = src; } }
  onHurt(attacker) { this.alert(attacker); }
  update(dt) {
    const g = this.game;
    if (!this.alive) { this.deadT += dt; this.updateAnim(dt); return; }
    if (this.surrendered) { this.speed = 0; this.updateAnim(dt); return; }
    this.meleeCd -= dt; this.seeT -= dt;
    // perception
    if (this.seeT <= 0) {
      this.seeT = 0.25 + Math.random() * 0.25;
      const cands = [g.player, ...g.actors.filter((a) => a.team === 'mtf' && a.alive)];
      let best = null, bd = 40;
      for (const c of cands) {
        if (!c.alive || (c.area !== undefined && c.area !== this.area)) continue;
        const d = dist2D(c.pos, this.pos);
        const lookRange = this.state === 'combat' ? 40 : 26;
        if (d < Math.min(bd, lookRange) && this.canSee(c === g.player ? g.player.eye() : c.center(), this.state === 'combat' ? 6.3 : 2.4)) { best = c; bd = d; }
      }
      if (best) { this.target = best; if (this.state === 'idle') { this.state = 'combat'; if (Math.random() < 0.5) g.shout(this); } }
      else if (this.state === 'combat' && this.target && !this.target.alive) this.target = null;
    }
    if (this.state === 'idle') {
      // loiter / pace
      if (!this.moveTarget || dist2D(this.pos, this.moveTarget) < 0.6) { if (Math.random() < dt * 0.3) this.moveTarget = [this.wander[0] + rand(-3, 3), 0, this.wander[2] + rand(-3, 3)]; }
      this.navigate(dt, 1.0);
    } else if (this.target) {
      const tp = this.target === g.player ? g.player.chest() : this.target.center();
      const d = dist2D(this.pos, tp);
      if (this.weaponId) {
        // armed: keep medium range, strafe between cover-ish spots, shoot when facing
        this.reposT -= dt;
        if (this.reposT <= 0) {
          this.reposT = rand(2.5, 5);
          const ang = yawTo(tp, this.pos) + rand(-0.9, 0.9), r = clamp(d + rand(-4, 3), 7, 18);
          this.moveTarget = [tp[0] + Math.sin(ang) * r, 0, tp[2] + Math.cos(ang) * r];
        }
        this.navigate(dt, 2.4, 0.8);
        const off = this.faceTo(tp, dt, 6);
        this.aimMode = 'aim';
        const visible = this.canSee(tp, 6.3);
        if (visible && off < 0.3) this.shootAt(tp, 0.075 + (this.speed > 1 ? 0.05 : 0) + (d > 20 ? 0.03 : 0), dt);
        else if (!visible && this.reposT > 1.5) { this.moveTarget = tp.slice(); this.reposT = 1.5; }
      } else {
        // unarmed: charge and swing
        this.moveTarget = [tp[0], 0, tp[2]];
        if (d > 1.5) this.navigate(dt, 4.6, 1.2);
        else { this.speed *= 0.8; this.faceTo(tp, dt, 10); if (this.meleeCd <= 0) { this.meleeCd = 1.3; this.playOnce('Swing', 0.8); setTimeout(() => { if (this.alive && !this.surrendered && dist2D(this.pos, this.target ? (this.target.pos || tp) : tp) < 1.9) g.melee(this, this.target, 18); }, 360); } }
        // unarmed Class-D can give up when a rifle is pointed at them up close
        if (g.player.aimingAt === this && d < 9) { this.aimedAtT += dt; if (this.aimedAtT > 1.1 && this.hp < 100 && Math.random() < 0.5) this.surrender(); } else this.aimedAtT = Math.max(0, this.aimedAtT - dt);
      }
    } else {
      this.navigate(dt, 2.0);
    }
    this.locomotion();
    this.updateAnim(dt);
  }
  surrender() {
    this.surrendered = true; this.target = null; this.hittable = true;
    this.locked = 'surrender'; this.ch.play('Surrender', { fade: 0.3 });
    this.game.onSurrender && this.game.onSurrender(this);
  }
}

// ---------------------------------------------------------------- SCP-173
export class SCP173 {
  constructor(game, pos) {
    this.game = game; this.node = createSCP173(); game.scene.add(this.node);
    this.pos = [...pos]; this.yaw = 0; this.active = false; this.contained = false; this.team = 'scp'; this.alive = true; this.hittable = true; this.fleshy = false; this.solid = true;
    this.area = 2; this.moveBudget = 0; this.scrapeCd = 0; this.observers = 0; this.lastObserved = true; this.killCd = 0;
    this.node.visible = false; this.place();
  }
  place() { this.node.position.set(this.pos); quat.fromEuler(this.node.rotation, 0, this.yaw * 180 / Math.PI, 0); }
  center() { return [this.pos[0], this.pos[1] + 1.1, this.pos[2]]; }
  hitboxes() { const p = this.pos; return [{ a: [p[0], p[1] + 0.2, p[2]], b: [p[0], p[1] + 1.65, p[2]], r: 0.3, zone: 'torso' }, { a: [p[0], p[1] + 1.6, p[2]], b: [p[0], p[1] + 1.85, p[2]], r: 0.2, zone: 'head' }]; }
  damage() { this.game.effects.sparksBurst(this.center(), 4); return false; }
  // is 173 lit well enough for `who` to actually see it?
  lit(who) {
    const g = this.game;
    if (g.player.nvg && who === g.player) return true;
    if (g.areaLightsOn()) return true;
    const c = this.center();
    for (const l of g.scene.environment.lights) {
      if (!l.intensity || l.intensity < 3) continue;
      const d = Math.hypot(l.position[0] - c[0], l.position[1] - c[1], l.position[2] - c[2]);
      if (d > l.range * 0.8) continue;
      if (l.spot) { const dir = [(c[0] - l.position[0]) / d, (c[1] - l.position[1]) / d, (c[2] - l.position[2]) / d]; if (dir[0] * l.spot.direction[0] + dir[1] * l.spot.direction[1] + dir[2] * l.spot.direction[2] < Math.cos(l.spot.angle)) continue; }
      if (l.isFlashlight || l.intensity > 5) return true;
    }
    return false;
  }
  update(dt) {
    const g = this.game;
    this.node.visible = this.active || this.contained;
    if (!this.active || this.contained) return;
    // who is watching?
    let obs = 0;
    const P = g.player;
    const c = this.center();
    if (P.alive && P.observing(c) && this.lit(P)) obs++;
    for (const a of g.squad) if (a.watching) obs++;
    this.observers = obs;
    this.killCd -= dt; this.scrapeCd -= dt;
    if (obs === 0) {
      // unobserved: it moves impossibly fast toward the nearest living person
      let target = P.alive ? P : null, td = target ? dist2D(this.pos, P.pos) : Infinity;
      for (const a of g.actors) if (a.alive && a.team === 'dclass' && a.area === this.area) { const d = dist2D(this.pos, a.pos); if (d < td - 4) { td = d; target = a; } }
      if (!target) return;
      const tp = target.pos;
      const step = Math.min(td - 0.9, 14 * dt);
      if (step > 0) {
        this.repath = (this.repath || 0) - dt;
        if (this.repath <= 0 || !this.path || !this.path.length) { this.path = g.nav.path(this.pos, tp, this.area); this.repath = 0.3; }
        while (this.path.length > 1 && dist2D(this.path[0], this.pos) < 0.4) this.path.shift();
        const wp = this.path[0] || tp;
        const yaw = yawTo(this.pos, wp);
        const r = g.physics.move(this.pos, [Math.sin(yaw) * step, 0, Math.cos(yaw) * step], 0.3, 1.8, { snap: true });
        this.pos = r.pos; this.yaw = yawTo(this.pos, tp);
        if (this.scrapeCd <= 0) { g.audio.scrape(this.center(), 0.55); this.scrapeCd = 0.35; }
      }
      if (td < 1.3 && this.killCd <= 0) {
        this.killCd = 1;
        if (target === P) g.killPlayerBy173();
        else { g.audio.neckSnap(target.center()); target.damage(999, 'head', null, this); }
      }
      this.place();
    }
    this.lastObserved = obs > 0;
  }
}
