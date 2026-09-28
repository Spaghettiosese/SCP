// The player: first-person movement (walk/sprint/crouch/jump/lean), weapons (fire modes,
// recoil, spread, reloads, swaps, melee, grenades), flashlight, night vision and the blink meter.
import { vec3, mat4, quat, Node } from '../../engine/index.js';
import { WEAPONS } from '../content/weapons.js';
import { hitscan, spreadDir } from './actors.js';
import { clamp, damp, dirFromYawPitch, rand, basisMatrix, dist2D } from '../util.js';
import { ViewModel } from '../content/viewmodel.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = [0, 0, 0]; this.vel = [0, 0, 0]; this.yaw = 0; this.pitch = 0; this.alive = true;
    this.hp = 100; this.maxHp = 100; this.lastDamage = -99; this.grounded = true; this.crouch = 0; this.height = 1.72;
    this.lean = 0; this.leanTarget = 0; this.area = 1;
    this.kick = [0, 0]; this.kickV = [0, 0]; this.bloom = 0; this.shake = 0;
    this.loadout = ['m4a1', 'glock']; this.slot = 0; this.ammo = {};
    this.grenades = 2; this.medkits = 2; this.nades = [];
    this.flashlightOn = false; this.nvg = false; this.nvgT = 0;
    this.blink = 1; this.blinkClosed = 0; this.blinkEnabled = false;
    this.vm = new ViewModel();
    this.vmRoot = new Node('viewmodel');
    this.stats = { shots: 0, hits: 0, kills: 0, headshots: 0, detained: 0, time: 0 };
    this.stepDist = 0; this.fireHeld = false; this.fireLatch = false; this.adsHeld = false;
    this.interactHold = 0; this.aimingAt = null; this.controlsEnabled = true;
    this.flashlight = { position: [0, 0, 0], color: [1, 0.96, 0.88], intensity: 0, range: 26, spot: { direction: [0, 0, 1], angle: 0.42, inner: 0.18 }, isFlashlight: true, priority: true };
    this.vm.on((e) => this.onVmEvent(e));
  }
  setLoadout(primary, secondary) {
    this.loadout = [primary, secondary];
    for (const id of this.loadout) if (!this.ammo[id]) { const d = WEAPONS[id]; this.ammo[id] = { mag: d.mag, reserve: d.reserve, mode: 0 }; }
    this.slot = 0;
    this.equip(this.loadout[0], true);
  }
  get weapon() { return WEAPONS[this.loadout[this.slot]]; }
  get wstate() { return this.ammo[this.loadout[this.slot]]; }
  equip(id, instant = false) {
    const rig = this.vm.equip(id);
    if (!rig.ch.parent) this.vmRoot.add(rig.ch);
    for (const c of this.vmRoot.children) c.visible = c === rig.ch;
    if (!instant) { this.vm.play('raise'); this.game.audio.mech('swap'); }
    this.reloading = null;
  }
  eye() { return [this.pos[0] + this.leanOffset[0], this.pos[1] + this.eyeHeight, this.pos[2] + this.leanOffset[2]]; }
  chest() { return [this.pos[0], this.pos[1] + 1.2 - this.crouch * 0.45, this.pos[2]]; }
  center() { return this.chest(); }
  get eyeHeight() { return 1.64 - this.crouch * 0.55; }
  get leanOffset() { const r = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)]; return [r[0] * -this.lean * 0.38, 0, r[2] * -this.lean * 0.38]; }
  forward() { return dirFromYawPitch(this.yaw, this.pitch + this.kick[0]); }
  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); this.game.hud.flash('heal'); }

  // ------------------------------------------------------------------ damage
  damage(amount, from) {
    if (!this.alive || this.game.godMode) return;
    this.hp -= amount; this.lastDamage = this.game.time;
    this.game.audio.hurt();
    if (from) this.game.hud.damageFrom(from, this);
    this.shake = Math.min(1, this.shake + amount / 40);
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.game.onPlayerDeath(); }
  }
  observing(p) {
    if (!this.alive || this.blinkClosed > 0) return false;
    const e = this.eye(), f = this.forward();
    const d = [p[0] - e[0], p[1] - e[1], p[2] - e[2]], L = Math.hypot(...d);
    if (L > 40) return false;
    const cos = (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / L;
    const half = (this.game.camera.fov * 0.5) * 0.92;
    const aspect = this.game.renderer.width / Math.max(1, this.game.renderer.height);
    if (cos < Math.cos(Math.atan(Math.tan(half) * aspect))) return false;
    return this.game.physics.lineOfSight(e, p);
  }

  // ------------------------------------------------------------------ per frame
  update(dt, input) {
    const g = this.game;
    if (!this.alive) { this.vmRoot.visible = false; return; }
    this.stats.time += dt;
    const w = this.weapon, ws = this.wstate;
    const ctl = this.controlsEnabled;
    // --- look
    if (ctl) {
      const sens = g.settings.sensitivity * 0.0022 * (this.adsAmount > 0.5 ? (w.adsFov / g.settings.fov) * 1.1 : 1);
      this.yaw -= input.mouse[0] * sens; this.pitch -= input.mouse[1] * sens * (g.settings.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.5, 1.5);
    }
    // recoil camera kick recovery
    for (let i = 0; i < 2; i++) { this.kickV[i] += (-this.kick[i] * 60 - this.kickV[i] * 11) * dt; this.kick[i] += this.kickV[i] * dt; }
    // --- stance
    const wantCrouch = ctl && input.crouch;
    this.crouch = damp(this.crouch, wantCrouch ? 1 : 0, 10, dt);
    this.leanTarget = ctl ? (input.leanL ? 1 : input.leanR ? -1 : 0) : 0;
    if (this.leanTarget !== 0) { // don't lean through walls
      const r = [Math.cos(this.yaw) * -this.leanTarget, 0, -Math.sin(this.yaw) * -this.leanTarget];
      const e = [this.pos[0], this.pos[1] + this.eyeHeight, this.pos[2]];
      const h = g.physics.raycast(e, r, 0.6);
      if (h) this.leanTarget *= clamp((h.t - 0.2) / 0.4, 0, 1);
    }
    this.lean = damp(this.lean, this.leanTarget, 9, dt);
    // --- movement
    const mv = ctl ? input.move : [0, 0];
    const ml = Math.hypot(mv[0], mv[1]);
    const sprint = ctl && input.sprint && mv[1] > 0.1 && !this.adsHeld && this.crouch < 0.5 && !this.vm.busy;
    this.sprinting = sprint;
    let maxSpeed = (sprint ? 6.9 : this.crouch > 0.5 ? 2.3 : 4.3) * w.moveMul;
    if (this.adsAmount > 0.5) maxSpeed *= 0.6;
    const fwd = [Math.sin(this.yaw), 0, Math.cos(this.yaw)], right = [-Math.cos(this.yaw), 0, Math.sin(this.yaw)];
    const wish = [0, 0, 0];
    if (ml > 0) { const n = 1 / Math.max(1, ml); wish[0] = (fwd[0] * mv[1] + right[0] * mv[0]) * n * maxSpeed; wish[2] = (fwd[2] * mv[1] + right[2] * mv[0]) * n * maxSpeed; }
    const acc = this.grounded ? 14 : 3;
    this.vel[0] += (wish[0] - this.vel[0]) * Math.min(1, acc * dt);
    this.vel[2] += (wish[2] - this.vel[2]) * Math.min(1, acc * dt);
    if (this.grounded && ctl && input.jumpPressed && this.crouch < 0.5) { this.vel[1] = 5.0; this.grounded = false; }
    this.vel[1] -= 18 * dt;
    const wasAir = !this.grounded, vy = this.vel[1];
    const r = g.physics.move(this.pos, [this.vel[0] * dt, this.vel[1] * dt, this.vel[2] * dt], 0.34, 1.75 - this.crouch * 0.6, { snap: this.grounded });
    const moved = dist2D(r.pos, this.pos);
    this.pos = r.pos; this.grounded = r.grounded;
    if (this.grounded) { if (wasAir && vy < -4) { this.landed = clamp(-vy / 12, 0, 1); g.audio.footstep(this.pos, g.surfaceAt(this.pos), 0.5, true); } this.vel[1] = 0; }
    this.speed = moved / Math.max(dt, 1e-4);
    // footsteps
    if (this.grounded) { this.stepDist += moved; const stride = sprint ? 2.1 : 1.6; if (this.stepDist > stride) { this.stepDist = 0; g.audio.footstep(this.pos, g.surfaceAt(this.pos), sprint ? 0.4 : this.crouch > 0.5 ? 0.12 : 0.25, true); } }

    // --- weapon handling
    this.adsHeld = ctl && input.ads && !sprint;
    this.adsAmount = this.vm.state.ads;
    const busy = this.vm.busy;
    const fireRate = 60 / w.rpm;
    this.fireCd = (this.fireCd || 0) - dt;
    const auto = w.modes[ws.mode] === 'AUTO';
    const wantFire = ctl && input.fire && (auto || !this.fireLatch);
    if (!input.fire) this.fireLatch = false;
    // shotgun reload can be interrupted by firing
    if (wantFire && this.reloading && this.reloading.kind === 'shotgun' && ws.mag > 0) { this.reloading.cancel = true; this.fireLatch = true; }
    if (wantFire && !busy && !sprint && this.fireCd <= 0) {
      if (ws.mag > 0) { this.fire(); this.fireCd = fireRate; if (!auto) this.fireLatch = true; }
      else if (!this.fireLatch) { g.audio.dryFire(); this.fireLatch = true; if (ws.reserve > 0) this.reload(); }
    }
    if (ctl && input.reloadPressed) this.reload();
    if (ctl && input.swapPressed !== null && input.swapPressed !== undefined && input.swapPressed !== this.slot && !this.swapping) this.swap(input.swapPressed);
    if (ctl && input.modePressed && w.modes.length > 1) { ws.mode = (ws.mode + 1) % w.modes.length; g.audio.mech('switch'); g.hud.toast('FIRE MODE: ' + w.modes[ws.mode]); }
    if (ctl && input.meleePressed && !busy) { this.vm.play('melee'); g.audio.mech('melee'); }
    if (ctl && input.inspectPressed && !busy) this.vm.play('inspect');
    if (ctl && input.grenadePressed && !busy && this.grenades > 0) { this.vm.play('grenade'); }
    if (ctl && input.medPressed && this.medkits > 0 && this.hp < this.maxHp) { this.medkits--; this.heal(60); g.audio.mech('pin'); g.hud.toast('MEDKIT USED'); }
    if (ctl && input.lightPressed) { this.flashlightOn = !this.flashlightOn; g.audio.mech('switch'); }
    if (ctl && input.nvgPressed) { this.nvg = !this.nvg; g.audio.mech('switch'); g.audio._tone(this.nvg ? 3200 : 1200, 0.4, { vol: 0.03, slide: this.nvg ? 3000 : -600 }); }
    this.bloom = Math.max(0, this.bloom - dt * (auto ? 1.6 : 3.2));

    // --- blink
    if (this.blinkEnabled) {
      this.blink -= dt / 9.5;
      if ((ctl && input.blinkPressed) || this.blink <= 0) { this.blinkClosed = 0.28; this.blink = 1; g.audio.blink(); }
    } else this.blink = 1;
    this.blinkClosed = Math.max(0, this.blinkClosed - dt);

    // --- regen
    if (g.time - this.lastDamage > 4.5 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 22 * dt);
    this.shake = Math.max(0, this.shake - dt * 2);

    // --- interaction
    this.nearInteract = null;
    if (ctl) {
      const e = this.eye();
      let best = null, bd = 99;
      for (const it of g.level.interact) {
        if (!it.enabled || it.area !== g.area) continue;
        const d = Math.hypot(it.pos[0] - e[0], it.pos[1] - e[1], it.pos[2] - e[2]);
        if (d < it.radius && d < bd) { bd = d; best = it; }
      }
      this.nearInteract = best;
      if (best && input.interact) { this.interactHold += dt; if (this.interactHold >= (best.hold ?? 1.2)) { this.interactHold = 0; best.enabled = false; g.onInteract(best); } }
      else this.interactHold = 0;
    }

    // --- what am I aiming at (nameplates, surrender)
    this.aimingAt = null;
    {
      const e = this.eye(), f = this.forward();
      const h = hitscan(g, e, f, 60, null);
      if (h && h.actor) this.aimingAt = h.actor;
      this.aimHit = h;
    }

    // --- view model
    const lookDelta = ctl ? [input.mouse[0], input.mouse[1]] : [0, 0];
    this.vm.update(dt, { ads: this.adsHeld && !this.reloading, sprint, crouch: this.crouch > 0.5, speed: this.grounded ? Math.hypot(this.vel[0], this.vel[2]) : 0, grounded: this.grounded, look: lookDelta, landed: this.landed, lean: this.lean });
    this.landed = 0;
    this.updateShotgunReload(dt);
    this.updateNades(dt);
    // flashlight follows the weapon light
    const fl = this.flashlight;
    fl.intensity = this.flashlightOn ? 140 : 0;
    fl.spot.direction = this.forward();
    const rigW = this.rigMatrix();
    const lp = w.noLight ? [-0.12, -0.05, 0.3] : w.light;
    if (this.vm.weaponPose) { this.vm.weaponPoint(lp, rigW, fl.position); fl.position[1] += 0.02; }
    const lensMat = this.vm.materials.get('lightLens'); if (lensMat) lensMat.emissiveStrength = this.flashlightOn ? 40 : 0;
  }

  rigMatrix() {
    const e = this.eye();
    const f = dirFromYawPitch(this.yaw, this.pitch + this.kick[0] * 0.3);
    const roll = -this.lean * 0.2 + (this.game.cameraRoll || 0);
    const up = [Math.sin(roll) * Math.cos(this.yaw), Math.cos(roll), -Math.sin(roll) * Math.sin(this.yaw)];
    return basisMatrix(e, f, up);
  }

  // ------------------------------------------------------------------ firing
  fire() {
    const g = this.game, w = this.weapon, ws = this.wstate;
    ws.mag--; this.stats.shots++;
    this.vm.fire(1, ws.mag === 0);
    const e = this.eye(), f = this.forward();
    const moving = Math.min(1, Math.hypot(this.vel[0], this.vel[2]) / 4);
    const ads = this.adsAmount;
    const spread = (w.spreadHip * (1 - ads) + w.spreadAds * ads) * (1 + moving * 1.5 + (this.grounded ? 0 : 2)) + this.bloom * 0.02 * (1 - ads * 0.7);
    this.bloom = Math.min(1.5, this.bloom + 0.12 + w.recoil[0] * 0.05);
    const rigW = this.rigMatrix();
    const muzzle = this.vm.weaponPoint(w.muzzle, rigW, [0, 0, 0]);
    let anyHit = false, killed = false, head = false;
    for (let i = 0; i < (w.pellets || 1); i++) {
      const d = spreadDir(f, spread + (w.pelletSpread || 0));
      const h = hitscan(g, e, d, 250, null, { ignoreTeam: 'mtf' });
      const end = h ? h.point : [e[0] + d[0] * 200, e[1] + d[1] * 200, e[2] + d[2] * 200];
      if (i === 0 || i % 3 === 0) g.effects.tracer(muzzle, end, [3.4, 2.4, 1.2], 330);
      if (window.__dbgShots && window.__dbgShots-- > 0) console.log('SHOT', JSON.stringify({ tgt: window.__tgt, e: e.map((v) => +v.toFixed(2)), d: d.map((v) => +v.toFixed(3)), hit: h && { t: +h.t.toFixed(2), actor: h.actor && h.actor.name, hp: h.actor && h.actor.hp, mat: h.material, p: h.point.map((v) => +v.toFixed(2)) } }));
      if (!h) continue;
      if (h.actor) {
        const rng = w.range, dist = h.dist, fall = dist < rng[0] ? 1 : dist > rng[1] ? rng[2] : 1 - (1 - rng[2]) * (dist - rng[0]) / (rng[1] - rng[0]);
        const mul = h.zone === 'head' ? w.headMul : h.zone === 'limb' ? 0.75 : 1;
        const k = g.applyDamage(h.actor, w.damage * fall * mul, h.zone, d, this, h.point);
        if (h.actor.team !== 'scp') { anyHit = true; if (k) { killed = true; if (h.zone === 'head') head = true; } }
      } else {
        g.effects.impact(h.point, h.normal, h.material);
        if (i === 0) g.audio.impact(h.point, h.material);
      }
    }
    if (anyHit) { this.stats.hits++; g.hud.hitmarker(killed, head); g.audio.hitmarker(killed); }
    // camera kick
    const [kv, kh] = w.recoil;
    this.kickV[0] += kv * 0.22 * (1 - ads * 0.35);
    this.pitch += kv * 0.0075 * (1 - ads * 0.3);
    this.yaw += (Math.random() - 0.45) * kh * 0.006;
    this.shake = Math.min(1, this.shake + kv * 0.05);
    g.effects.muzzle(muzzle, f, w.pistol ? 0.6 : w.pellets > 1 ? 1.6 : 1, w.sound.suppressed);
    g.audio.gunshot(w.sound, null);
    // brass
    const ej = this.vm.weaponPoint(w.eject, rigW, [0, 0, 0]);
    const rgt = [-Math.cos(this.yaw), 0, Math.sin(this.yaw)];
    if (w.reloadStyle !== 'shotgun') g.effects.eject(ej, [rgt[0] * rand(2, 3.2) + this.vel[0], rand(1.5, 2.5), rgt[2] * rand(2, 3.2) + this.vel[2]]);
    else setTimeout(() => g.effects.eject(ej, [rgt[0] * 2.2, 1.8, rgt[2] * 2.2], true), 60);
    // gunfire alerts nearby Class-D
    g.noise(this.pos, w.sound.suppressed ? 12 : 45, this);
  }

  reload() {
    const w = this.weapon, ws = this.wstate;
    if (this.vm.busy || ws.mag >= w.mag || ws.reserve <= 0) return;
    if (w.reloadStyle === 'shotgun') {
      const empty = ws.mag === 0;
      this.reloading = { kind: 'shotgun', phase: empty ? 'chamber' : 'start', cancel: false };
      this.vm.play(empty ? 'loadChamber' : 'loadStart');
      return;
    }
    const empty = ws.mag === 0;
    this.reloading = { kind: 'mag', empty };
    this.vm.play(empty ? 'reloadEmpty' : 'reload', { dur: empty ? w.reloadEmpty : w.reload, onDone: () => { this.reloading = null; } });
    if (Math.random() < 0.5) this.game.playerCallout(['Reloading!', 'Changing mags!', 'Cover me!'][Math.floor(Math.random() * 3)]);
  }
  updateShotgunReload() {
    const r = this.reloading;
    if (!r || r.kind !== 'shotgun' || this.vm.busy) return;
    const w = this.weapon, ws = this.wstate;
    const more = ws.mag < w.mag && ws.reserve > 0 && !r.cancel;
    if (r.phase === 'chamber' || r.phase === 'start' || r.phase === 'shell') {
      if (more) { r.phase = 'shell'; this.vm.play('loadShell'); }
      else { r.phase = 'end'; this.vm.play('loadEnd'); }
    } else if (r.phase === 'end') this.reloading = null;
  }
  onVmEvent(e) {
    const g = this.game, w = this.weapon, ws = this.wstate;
    if (e.name === 'magOut') g.audio.mech('magOut');
    if (e.name === 'magIn') { g.audio.mech('magIn'); const need = w.mag - ws.mag, take = Math.min(need, ws.reserve); ws.mag += take; ws.reserve -= take; }
    if (e.name === 'boltRelease') g.audio.mech('boltRelease');
    if (e.name === 'shellIn') { g.audio.mech('shellIn'); if (ws.reserve > 0 && ws.mag < w.mag) { ws.mag++; ws.reserve--; } }
    if (e.name === 'pin') g.audio.mech('pin');
    if (e.name === 'throw') this.throwNade();
    if (e.name === 'hit') this.meleeHit();
  }
  swap(slot) {
    if (slot === this.slot || slot < 0 || slot >= this.loadout.length) return;
    this.swapping = true; this.reloading = null;
    this.vm.play('lower', { onDone: () => { this.slot = slot; this.equip(this.loadout[slot]); this.swapping = false; } });
  }
  replacePrimary(id) {
    this.loadout[0] = id;
    if (!this.ammo[id]) { const d = WEAPONS[id]; this.ammo[id] = { mag: d.mag, reserve: d.reserve, mode: 0 }; }
    this.slot = 0; this.equip(id);
  }
  meleeHit() {
    const g = this.game, e = this.eye(), f = this.forward();
    const h = hitscan(g, e, f, 2.2, null, { ignoreTeam: 'mtf' });
    if (h && h.actor) { g.applyDamage(h.actor, 60, h.zone, f, this, h.point); g.audio.impact(h.point, 'flesh'); g.hud.hitmarker(!h.actor.alive, false); this.shake = 0.4; }
    else if (h) { g.audio.impact(h.point, h.material); g.effects.impact(h.point, h.normal, h.material); }
  }

  // ------------------------------------------------------------------ grenades
  throwNade() {
    const g = this.game; this.grenades--;
    const e = this.eye(), f = this.forward();
    const node = g.makeGrenadeNode();
    const n = { pos: [e[0] + f[0] * 0.5, e[1] - 0.1, e[2] + f[2] * 0.5], vel: [f[0] * 15 + this.vel[0], f[1] * 15 + 3.5, f[2] * 15 + this.vel[2]], fuse: 3.0, node, spin: [rand(-10, 10), rand(-10, 10), rand(-10, 10)] };
    this.nades.push(n);
    g.hud.toast('FRAG OUT!');
    g.playerCallout('Frag out!');
  }
  updateNades(dt) {
    const g = this.game;
    for (const n of this.nades) {
      n.fuse -= dt;
      n.vel[1] -= 9.8 * dt;
      const step = [n.vel[0] * dt, n.vel[1] * dt, n.vel[2] * dt], L = Math.hypot(...step);
      if (L > 0) {
        const d = step.map((v) => v / L);
        const h = g.physics.raycast(n.pos, d, L + 0.05);
        if (h) {
          const nn = h.normal, vd = n.vel[0] * nn[0] + n.vel[1] * nn[1] + n.vel[2] * nn[2];
          n.vel = n.vel.map((v, i) => (v - 1.6 * vd * nn[i]) * 0.5);
          n.pos = [h.point[0] + nn[0] * 0.05, h.point[1] + nn[1] * 0.05, h.point[2] + nn[2] * 0.05];
          if (Math.abs(vd) > 2) g.audio.impact(n.pos, 'metal');
        } else n.pos = n.pos.map((v, i) => v + step[i]);
      }
      n.node.position.set(n.pos);
      quat.multiply(n.node.rotation, n.node.rotation, quat.fromEuler(quat.create(), n.spin[0] * dt * 20, n.spin[1] * dt * 20, n.spin[2] * dt * 20));
      if (n.fuse <= 0) { g.explode(n.pos, this); g.scene.remove(n.node); }
    }
    this.nades = this.nades.filter((n) => n.fuse > 0);
  }
}
