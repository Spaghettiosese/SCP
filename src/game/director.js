// Director: the tech demo's script. Opening cutscene, objectives, scripted events, area
// transition (freight elevator), SCP-173 reveal and recontainment, checkpoints, endings.
import { quat, vec3, mat4 } from '../../engine/index.js';
import { createHelicopter } from '../content/props.js';
import { SCP173 } from './actors.js';
import { AREA2_X } from '../world/level.js';
import { rand, pick, dist2D, clamp, basisMatrix, damp } from '../util.js';

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (t) => t * t * (3 - 2 * t);
// Catmull-Rom through key points (for flight paths / camera moves)
function spline(pts, t) {
  const n = pts.length - 1, f = clamp(t, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  return p1.map((_, k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u));
}

export class Director {
  constructor(game) {
    this.g = game; this.stage = 'menu'; this.t = 0; this.events = []; this.checkpoint = 'a1';
    game.director = this;
    this.heli = null;
  }
  after(delay, fn) { this.events.push({ at: this.t + delay, fn }); }
  say(lines) { let d = 0; for (const [who, text, dur = 3.2] of lines) { this.after(d, () => this.g.radio(who, text, dur)); d += dur + 0.15; } return d; }
  objective(title, text) { this.g.hud.objective(title, text); this.g.audio.beep(660); this.g.audio.beep(990); }

  // ================================================================ intro
  startIntro() {
    const g = this.g, L = g.level;
    this.stage = 'intro'; this.t = 0; this.events = [];
    g.setArea(1);
    g.hudVisible = false;
    g.player.controlsEnabled = false;
    g.player.pos = [...L.markers.playerStart1]; g.player.hp = 100; g.player.alive = true;
    g.clearEnemies();
    this.heli = this.heli || createHelicopter();
    g.scene.add(this.heli);
    // squad seated inside
    g.spawnSquad(L.markers.squadStart1, Math.PI);
    const seats = [[0.55, -0.9, 1], [0.55, 0.3, 1], [-0.55, -0.9, -1], [-0.55, 0.3, -1]];
    g.squad.forEach((s, i) => { this.heli.add(s.ch); s.seated = { pos: [seats[i][0], 0.66, seats[i][1]], yaw: seats[i][2] * Math.PI / 2 }; s.mode = 'cutscene'; s.aimMode = 'sit'; s.ch.play('Sit', { fade: 0 }); s.locked = 'sit'; });
    g.spawnClassD(L.markers.wave1, 1);
    g.audio.heliLoop(); g.audio.setLoop('heli', 0.9, 1); g.audio.rainLoop(); g.audio.setLoop('rain', 0.55); g.audio.windLoop(); g.audio.setLoop('wind', 0.4);
    g.audio.alarmLoop(); g.audio.setLoop('alarm', 0.05);
    this.heliLight = { position: [0, 0, 0], color: [0.9, 0.95, 1], intensity: 500, range: 60, spot: { direction: [0, -1, 0.3], angle: 0.35, inner: 0.2 }, priority: true };
    g.scene.environment.lights.push(this.heliLight);
    g.hud.banner('SITE-80', '03:47 LOCAL · CONTAINMENT BREACH · MTF EPSILON-11 "NINE-TAILED FOX"', 6);
    document.body.classList.add('cinematic');
    this.say([
      ['OVERWATCH', 'Epsilon-Eleven, Overwatch. Site-80 went dark at zero-three-twenty. Heavy Containment reports a full breach.', 5],
      ['OVERWATCH', 'D-Class have overrun the Gate B checkpoint. At least one Keter-adjacent Euclid is unaccounted for.', 4.6],
      ['KESTREL', 'Copy, Overwatch. Which one?', 2.2],
      ['OVERWATCH', "One-seven-three. Its chamber door failed open. You know the rules, Kestrel.", 4],
      ['KESTREL', "Nobody blinks alone. You hear that, Rook? Stay on my six and keep your eyes open.", 4.2],
      ['HEX', 'Breaching charges are prepped. Door opens if the terminal says no.', 3.2],
      ['GRIM', 'Thirty seconds. LZ is hot—I count movement at the gate.', 3.2],
      ['KESTREL', 'Nine-Tailed Fox, get ready. Secure. Contain. Protect.', 3.4],
    ]);
  }
  heliFlight(t) {
    // flight path over the forest into the LZ
    const path = [[70, 38, -190], [40, 30, -140], [12, 22, -95], [2, 12, -60], [0, 4, -45], [0, 0.95, -42]];
    const T = 30;
    const u = clamp(t / T, 0, 1), e = 1 - Math.pow(1 - u, 1.6);
    const p = spline(path, e);
    const a = spline(path, Math.min(1, e + 0.01));
    let yaw = Math.atan2(a[0] - p[0], a[2] - p[2]); if (u > 0.95) yaw = 0;
    const bank = u < 0.9 ? Math.sin(t * 0.4) * 5 - 6 * (1 - u) : 0;
    const pitch = u < 0.75 ? 8 : u < 0.97 ? -8 * (1 - (u - 0.75) / 0.22) : 0;
    return { p, yaw: u > 0.9 ? yaw * (1 - (u - 0.9) * 10) : yaw, bank, pitch, landed: u >= 1 };
  }
  updateIntro(dt) {
    const g = this.g, t = this.t, H = this.heli;
    const f = this.heliFlight(t);
    H.position.set(f.p);
    quat.fromEuler(H.rotation, f.pitch, f.yaw * 180 / Math.PI, f.bank);
    H.rotor.rotation.set(quat.fromEuler(quat.create(), 0, (t * 1600) % 360, 0));
    H.tailRotor.rotation.set(quat.fromEuler(quat.create(), (t * 2400) % 360, 0, 0));
    H.updateWorld();
    const W = H.world;
    const hp = vec3.transformMat4([0, 0, 0], [0, 0.1, 2.9], W);
    this.heliLight.position = hp;
    this.heliLight.spot.direction = vec3.normalize([0, 0, 0], vec3.transformMat4([0, 0, 0], [0, -1, 0.9], mat4.fromRTS(mat4.create(), H.rotation, [0, 0, 0], [1, 1, 1])));
    g.searchTarget = t > 18 ? f.p : null;
    // shots
    let cam;
    if (t < 8) { // exterior: chase alongside the bird over the storm-lashed forest
      const k = t / 8;
      const side = vec3.transformMat4([0, 0, 0], [-16 + k * 4, 3 - k * 2, -10 + k * 14], W);
      cam = { pos: side, target: vec3.transformMat4([0, 0, 0], [0, 1.2, 1.5], W), fov: 50 };
    } else if (t < 15.5) { // cabin: from outside the open door, the squad facing us, rain behind
      const k = (t - 8) / 7.5;
      cam = { pos: vec3.transformMat4([0, 0, 0], [1.95 - k * 0.25, 1.32, -0.3 + k * 0.2], W), target: vec3.transformMat4([0, 0, 0], [0.4, 1.72, -0.3], W), fov: 64 };
    } else if (t < 22) { // close on Kestrel
      const k = (t - 15.5) / 6.5;
      cam = { pos: vec3.transformMat4([0, 0, 0], [1.5 - k * 0.12, 1.95, -0.5 + k * 0.08], W), target: vec3.transformMat4([0, 0, 0], [0.62, 1.86, -0.9], W), fov: 38 };
    } else if (t < 30.5) { // from the field: the bird comes down through the rain onto the pad
      const k = (t - 22) / 8.5;
      cam = { pos: lerp3([-9, 1.7, -31.5], [-7.5, 1.5, -32.5], k), target: lerp3(f.p, [0, 1.8, -42], 0.35), fov: 52 };
    } else { // first person handoff: from the cabin door
      const k = clamp((t - 30.5) / 2.5, 0, 1);
      const ps = g.level.markers.playerStart1;
      cam = { pos: lerp3(vec3.transformMat4([0, 0, 0], [1.1, 1.7, 0.4], W), [ps[0], 1.64, ps[2]], smooth(k)), target: lerp3(vec3.transformMat4([0, 0, 0], [3, 1.6, 1.5], W), [ps[0], 1.64, ps[2] + 5], smooth(k)), fov: lerp(62, g.settings.fov, k) };
      if (t > 31 && !this.hopped) this.hopOut();
    }
    g.cameraOverride = cam;
    g.cameraRoll = 0;
    if (t > 33.2) this.endIntro();
  }
  hopOut() {
    const g = this.g, L = g.level;
    this.hopped = true;
    g.squad.forEach((s, i) => {
      this.heli.remove(s.ch); g.scene.add(s.ch);
      s.seated = null; s.pos = [...L.markers.squadStart1[i]]; s.yaw = 0; s.mode = 'follow'; s.locked = null; s.aimMode = 'low';
      s.ch.play('Idle', { fade: 0.1 });
    });
  }
  endIntro() {
    const g = this.g;
    document.body.classList.remove('cinematic');
    g.cameraOverride = null;
    this.hopped = true;
    if (g.squad[0] && g.squad[0].seated) this.hopOut();
    const P = g.player;
    P.pos = [...g.level.markers.playerStart1]; P.yaw = 0; P.pitch = 0; P.alive = true; P.hp = 100;
    P.controlsEnabled = true; g.hudVisible = true;
    this.heliLeaveT = 8;
    this.startArea1('a1');
  }

  // ================================================================ Area 1
  startArea1(cp) {
    const g = this.g, L = g.level;
    this.stage = 'a1'; this.checkpoint = cp; this.events = []; this.t = 0;
    g.setArea(1);
    if (this.heliLight && !g.scene.environment.lights.includes(this.heliLight) && this.heli && this.heli.parent) g.scene.environment.lights.push(this.heliLight);
    g.searchTarget = null;
    L.doors.blast.target = 0; L.doors.blast.open = cp === 'a1door' ? 0.35 : 0;
    L.interact.forEach((i) => (i.enabled = false));
    L.interact.find((i) => i.id === 'terminal').enabled = false;
    L.markers.terminalTex.draw(['SYSTEM LOCKDOWN', 'AWAITING OVERRIDE', '', '> GATE B: SEALED', '> HCZ POWER: OFFLINE']);
    g.audio.setLoop('rain', 0.55); g.audio.setLoop('wind', 0.35); g.audio.setLoop('alarm', 0.06); g.audio.setLoop('hum', 0); g.audio.setLoop('drone', 0);
    this.addArmory();
    if (cp !== 'a1') { // restart from checkpoint: reset actors
      g.clearEnemies();
      if (this.heli) { g.scene.remove(this.heli); this.heliLeaveT = -1; }
      g.spawnSquad(cp === 'a1door' ? [[-2, 0, 22], [2, 0, 22], [-3, 0, 20], [3, 0, 20]] : L.markers.squadStart1, 0);
      const P = g.player; P.alive = true; P.hp = 100; P.controlsEnabled = true;
      P.pos = cp === 'a1door' ? [0, 0, 20] : [...L.markers.playerStart1]; P.yaw = 0; P.pitch = 0;
      if (cp === 'a1') g.spawnClassD(L.markers.wave1, 1);
    }
    g.hud.setMarker('gate', { pos: [0, 0, -30], label: 'A', text: 'GATE B', kind: 'obj' });
    if (cp === 'a1') {
      this.phase = 'approach';
      this.objective('SECURE GATE B', 'Push through the gate and clear the checkpoint');
      this.say([['KESTREL', 'On me! Rook, take point—Gate B, straight ahead.', 3], ['GRIM', 'Armory crate on the pad if you want to swap your long gun.', 3.2]]);
    } else {
      this.phase = 'door';
      this.beginDoorPhase(true);
    }
  }
  addArmory() {
    const g = this.g, L = g.level;
    if (!L.interact.find((i) => i.id === 'armory')) {
      L.interact.push({ id: 'armory', pos: [-4.5, 0.9, -38], radius: 1.8, label: 'Swap primary weapon (Armory)', area: 1, enabled: true, hold: 0.25, repeat: true });
      // the crate itself
      import('../content/props.js').then((K) => {
        import('../util.js').then(({ StaticBuilder }) => {
          const sb = new StaticBuilder({}), M = L.materials;
          K.crate(sb, M, -4.5, 0, -38, 1.2, 15, M.metalDark);
          sb.add(M.lampGreen, { type: 'box', width: 0.5, height: 0.04, depth: 0.04, bevel: 0.01, bevelSegments: 1, segments: 1 }, { position: [-4.5, 1.08, -37.5] });
          const n = sb.build('armory'); g.level.areas[1].root.add(n);
          g.physics.add([-5.3, 0, -38.8], [-3.7, 1.0, -37.2], { area: 1 });
        });
      });
    } else L.interact.find((i) => i.id === 'armory').enabled = true;
  }
  updateArea1(dt) {
    const g = this.g, L = g.level, P = g.player;
    // helicopter departs
    if (this.heli && this.heliLeaveT > 0) {
      this.heliLeaveT -= dt;
      const H = this.heli, t = this.t;
      H.rotor.rotation.set(quat.fromEuler(quat.create(), 0, (g.time * 1600) % 360, 0));
      H.tailRotor.rotation.set(quat.fromEuler(quat.create(), (g.time * 2400) % 360, 0, 0));
      if (this.heliLeaveT <= 0) this.heliLeaving = 0;
      void t;
    }
    if (this.heli && this.heliLeaving !== undefined && this.heliLeaving >= 0) {
      this.heliLeaving += dt;
      const k = this.heliLeaving, H = this.heli;
      H.position.set([k * k * 0.8, 0.95 + k * k * 1.6, -42 - k * k * 2.2]);
      quat.fromEuler(H.rotation, 10 * Math.min(1, k / 3), 0, 0);
      H.rotor.rotation.set(quat.fromEuler(quat.create(), 0, (g.time * 1600) % 360, 0));
      H.updateWorld();
      this.heliLight.position = vec3.transformMat4([0, 0, 0], [0, 0.1, 2.9], H.world);
      g.audio.setLoop('heli', Math.max(0, 0.9 - k * 0.07), 0.3);
      if (k > 14) { g.scene.remove(H); this.heliLeaving = -1; g.scene.environment.lights = g.scene.environment.lights.filter((l) => l !== this.heliLight); }
    }
    const hostiles = () => g.actors.filter((a) => a.team === 'dclass' && a.alive && !a.surrendered && a.area === 1);
    if (this.phase === 'approach') {
      if (P.pos[2] > -32 || hostiles().some((a) => a.state === 'combat')) {
        this.phase = 'clear';
        g.hud.setMarker('gate', null);
        this.objective('SECURE GATE B', 'Neutralize the Class-D rioters in the checkpoint yard');
        g.noise([0, 0, -10], 30, P);
        this.say([['KESTREL', 'Contact! D-Class in the yard—weapons free!', 2.6]]);
      }
    }
    if (this.phase === 'clear') {
      const n = hostiles().length;
      g.hud.objective('SECURE GATE B', `Neutralize the Class-D rioters (${n} remaining)`);
      if (n === 0) { this.phase = 'doorIntro'; this.beginDoorPhase(false); }
      // stragglers: mark the last few
      if (n <= 2) hostiles().forEach((a) => (a.spotted = true));
    }
    if (this.phase === 'defend') {
      const D = L.doors.blast;
      const n = hostiles().length;
      g.hud.objective('HOLD THE DOOR', `Blast door ${Math.round(D.open * 100)}% · Hostiles: ${n}`);
      g.hud.setMarker('door', { pos: [0, 0, 29], label: 'B', text: `${Math.round(D.open * 100)}%`, kind: 'obj' });
      if (D.open >= 0.99 && n <= 1) {
        this.phase = 'enter';
        this.checkpoint = 'a1door';
        g.hud.setMarker('door', null);
        g.hud.setMarker('elev', { pos: L.markers.elevator.center, label: 'C', text: 'FREIGHT ELEVATOR', kind: 'obj', h: 2.5 });
        this.objective('ENTER SITE-80', 'Board the freight elevator down to Heavy Containment');
        this.say([['KESTREL', "Door's open. Everyone into the freight elevator—we're going down.", 3.2], ['HEX', 'Smells like a slaughterhouse in there.', 2.4]]);
        g.squad.forEach((s, i) => { s.mode = 'script'; s.moveTarget = [(i % 2 ? 1.6 : -1.6), 0, L.markers.elevator.center[2] + (i < 2 ? -1 : 1.2)]; });
      }
    }
    if (this.phase === 'enter') {
      const E = L.markers.elevator;
      const inside = (p) => p[0] > E.min[0] && p[0] < E.max[0] && p[2] > E.min[2] && p[2] < E.max[2];
      if (inside(P.pos)) this.startElevator();
    }
  }
  beginDoorPhase(fromCheckpoint) {
    const g = this.g, L = g.level;
    this.phase = 'door';
    const term = L.interact.find((i) => i.id === 'terminal'); term.enabled = true; term.hold = 1.6;
    g.hud.setMarker('term', { pos: [6.8, 0, 29.2], label: 'B', text: 'TERMINAL', kind: 'obj', h: 1.9 });
    this.objective('OPEN THE BLAST DOOR', 'Override the Gate B control terminal');
    if (!fromCheckpoint) this.say([['KESTREL', 'Checkpoint secure. Rook, the terminal right of the blast door—override it.', 3.6], ['GRIM', 'Taking overwatch on the containers.', 2.4]]);
  }
  onInteract(it) {
    const g = this.g, L = g.level, P = g.player;
    if (it.id === 'armory') {
      const list = ['m4a1', 'mp7', 'scar', 'm1014', 'm110'];
      const next = list[(list.indexOf(P.loadout[0]) + 1) % list.length];
      P.replacePrimary(next); P.ammo[next].reserve = Math.max(P.ammo[next].reserve, 60);
      P.grenades = Math.max(P.grenades, 2); P.medkits = Math.max(P.medkits, 1);
      g.hud.toast('PRIMARY: ' + next.toUpperCase().replace('M4A1', 'M4A1 BLOCK II'));
      it.enabled = true; return;
    }
    if (it.id === 'terminal') {
      g.hud.setMarker('term', null);
      L.markers.terminalTex.draw(['OVERRIDE ACCEPTED', 'AUTH: MTF E-11 / KESTREL', '', '> GATE B: OPENING...', '> WARNING: DOOR SERVO FAULT', '> EST. 25 SECONDS'], '#f7c65a');
      L.doors.blast.target = 1; L.doors.blast.speed = 0.04;
      g.audio.door([0, 3, 30], true);
      g.audio.setLoop('alarm', 0.22);
      this.phase = 'defend';
      this.checkpoint = 'a1door';
      this.say([['KESTREL', "Door's cycling—slow as hell. Contact, side door! They're coming out of the facility!", 3.6], ['PATCH', 'More of them on the left, by the containers!', 2.6]]);
      this.after(1.5, () => g.spawnClassD(L.markers.wave2, 1, true));
      g.squad.forEach((s, i) => { s.mode = 'hold'; s.hold = [[-4, 0, 18], [4, 0, 20], [-8, 0, 12], [8, 0, 12]][i]; });
      this.after(28, () => g.squad.forEach((s) => { if (s.mode === 'hold') s.mode = 'follow'; }));
    }
    if (it.id === 'power') this.restorePower();
    if (it.id === 'contain') this.containComplete();
  }

  // ================================================================ elevator transition
  startElevator() {
    const g = this.g, P = g.player;
    this.stage = 'elevator'; this.t = 0; this.events = [];
    g.hud.setMarker('elev', null);
    P.controlsEnabled = false;
    g.squad.forEach((s) => { s.mode = 'script'; });
    g.audio.door([0, 3, 40], false);
    this.say([['KESTREL', 'Going down. Check your lights—power is out below.', 3], ['OVERWATCH', 'Epsilon, telemetry shows Chamber 173-A open. Motion sensors in Sector 2 are... inconsistent.', 4.2], ['GRIM', "Inconsistent. Love that word.", 2.2]]);
    this.fadeTo(1, 1.2);
    this.after(1.4, () => { g.audio.setLoop('rain', 0); g.audio.setLoop('wind', 0); g.audio.setLoop('alarm', 0); g.audio.humLoop(); g.audio.setLoop('hum', 0.25); this.elevatorRumble = true; });
    this.after(7.5, () => this.startArea2('a2'));
  }
  fadeTo(v, dur) { this.fade = { from: this.g.fade ?? 0, to: v, t: 0, dur }; }

  // ================================================================ Area 2
  startArea2(cp) {
    const g = this.g, L = g.level, P = g.player;
    this.stage = 'a2'; this.t = 0; this.events = []; this.checkpoint = cp;
    this.elevatorRumble = false;
    for (const k of [...g.hud.markers.keys()]) g.hud.setMarker(k, null);
    g.clearEnemies();
    g.setArea(2);
    g.powerOn = false;
    this.setPower(false, true);
    L.interact.forEach((i) => (i.enabled = false));
    P.pos = [...L.markers.playerStart2]; P.yaw = 0; P.pitch = 0; P.alive = true; P.hp = 100; P.controlsEnabled = true; P.flashlightOn = true;
    g.spawnSquad(L.markers.squadStart2, 0);
    g.squad.forEach((s) => (s.area = 2));
    if (this.s173) { g.scene.remove(this.s173.node); this.s173 = null; g.scp173 = null; }
    P.blinkEnabled = false;
    g.audio.alarmLoop(); g.audio.setLoop('alarm', 0.1); g.audio.droneLoop(); g.audio.setLoop('drone', 0.35); g.audio.humLoop(); g.audio.setLoop('hum', 0.05);
    this.fadeTo(0, 1.6);
    L.doors.chamber.open = 1;
    if (cp === 'a2') {
      this.phase = 'power';
      g.spawnClassD(L.markers.a2control, 2);
      this.cellsSpawned = false;
      this.objective('RESTORE POWER', 'Reach the Sector 2 main breaker in the control room');
      g.hud.setMarker('power', { pos: [AREA2_X - 6, 0, 25], label: 'A', text: 'MAIN BREAKER', kind: 'obj', h: 2.4 });
      L.interact.find((i) => i.id === 'power').enabled = true;
      L.interact.find((i) => i.id === 'power').hold = 2;
      this.say([['KESTREL', "Lights up. Main breaker's in the control room, west side of the corridor.", 3.4], ['PATCH', 'Blood trail... lots of it. Heading that way.', 2.6], ['KESTREL', 'Hex, Grim—cover the hall. Rook, with me.', 2.8]]);
      g.hud.banner('HEAVY CONTAINMENT ZONE', 'SECTOR 2 · EMERGENCY POWER ONLY', 4);
    } else {
      // checkpoint after power: straight to the 173 hunt
      P.pos = [AREA2_X, 0, 30];
      g.squad.forEach((s, i) => (s.pos = [AREA2_X + (i % 2 ? 1.2 : -1.2), 0, 27 - i]));
      this.cellsSpawned = true;
      this.setPower(true, true);
      this.phase = 'toChamber';
      this.afterPower(true);
    }
  }
  setPower(on, instant = false) {
    const g = this.g, L = g.level;
    g.powerOn = on;
    for (const l of L.markers.corridorLights) { l.intensity = on ? 34 : 0; l.baseIntensity = 34; l.tube.emissiveStrength = on ? 9 : 0; }
    L.markers.controlLight.intensity = on ? 30 : 0;
    L.markers.powerLamp.emissive = on ? '#20ff5a' : '#ff2010';
    for (const l of L.markers.emergency) l.intensity = on ? 4 : 10;
    g.scene.environment.ambient = on ? 0.22 : 0.07;
    void instant;
  }
  restorePower() {
    const g = this.g, L = g.level;
    g.hud.setMarker('power', null);
    g.audio.powerUp();
    // lights stutter on one after another
    L.markers.corridorLights.forEach((l, i) => {
      this.after(0.3 + i * 0.18, () => { l.intensity = 34; l.tube.emissiveStrength = 9; g.audio.flickerBuzz(l.position); });
      this.after(0.4 + i * 0.18, () => { l.intensity = 4; l.tube.emissiveStrength = 1; });
      this.after(0.5 + i * 0.18, () => { l.intensity = 34; l.tube.emissiveStrength = 9; });
    });
    this.after(2.2, () => { this.setPower(true); g.audio.setLoop('hum', 0.2); g.audio.setLoop('alarm', 0.16); });
    this.checkpoint = 'a2power';
    this.phase = 'toChamber';
    this.after(2.5, () => this.afterPower(false));
  }
  afterPower(fromCheckpoint) {
    const g = this.g, L = g.level;
    this.objective('CHECK CHAMBER 173-A', 'Investigate the SCP-173 containment chamber at the end of the corridor');
    g.hud.setMarker('chamber', { pos: [AREA2_X, 0, 52], label: 'B', text: 'CHAMBER 173-A', kind: 'danger', h: 3.4 });
    if (!fromCheckpoint) this.say([['KESTREL', 'Power is up. Chamber One-Seven-Three is at the end of the hall.', 3], ['KESTREL', 'If it is out—nobody blinks without calling it. Understood?', 3.4], ['HEX, GRIM, PATCH'.split(',')[0], 'Understood.', 1.6]]);
    if (!this.cellsSpawned) { this.cellsSpawned = true; g.spawnClassD(L.markers.a2cells, 2); }
  }
  updateArea2(dt) {
    const g = this.g, L = g.level, P = g.player;
    // corridor ambush as you walk past the cells
    if (this.phase === 'power' && !this.cellsSpawned && P.pos[2] > 20) {
      this.cellsSpawned = true;
      g.spawnClassD(L.markers.a2cells, 2, true);
      this.say([['GRIM', 'Movement in the holding cells—east side!', 2.4]]);
    }
    if (this.phase === 'toChamber' && P.pos[2] > 41) this.reveal173();
    if (this.phase === 'contain') {
      const s = this.s173;
      const d = dist2D(s.pos, P.pos);
      const it = L.interact.find((i) => i.id === 'contain');
      it.pos = [s.pos[0], 1.2, s.pos[2]];
      it.enabled = d < 2.8 && s.observers > 0;
      it.label = s.observers > 1 ? 'Deploy containment restraint' : 'Deploy restraint (squad not watching!)';
      g.hud.setMarker('s173', { pos: s.pos, label: '!', text: 'SCP-173', kind: 'danger', h: 2.3 });
      const n = g.actors.filter((a) => a.team === 'dclass' && a.alive && !a.surrendered && a.area === 2).length;
      g.hud.objective('RECONTAIN SCP-173', `Keep eyes on it, get within 2 m and hold [F] to restrain · Watchers: ${s.observers}` + (n ? ` · Hostiles: ${n}` : ''));
      // lights stutter now and then to keep everyone honest
      this.flickerT = (this.flickerT ?? 12) - dt;
      if (this.flickerT <= 0) { this.flickerT = rand(14, 22); this.blackout(0.7); }
    }
  }
  blackout(dur) {
    const g = this.g, L = g.level;
    for (const l of L.markers.corridorLights) { l.intensity = 0; l.tube.emissiveStrength = 0; }
    g.powerOn = false;
    g.audio.flickerBuzz(g.player.pos);
    this.after(dur, () => { for (const l of L.markers.corridorLights) { l.intensity = 34; l.tube.emissiveStrength = 9; } g.powerOn = true; });
  }
  reveal173() {
    const g = this.g, L = g.level, P = g.player;
    this.phase = 'reveal';
    g.hud.setMarker('chamber', null);
    // a fleeing Class-D runs out of the west wing...
    const victim = g.spawnClassD([{ p: [AREA2_X - 9, 0, 49], w: null }], 2)[0];
    victim.state = 'combat'; victim.target = null; victim.moveTarget = [AREA2_X - 1, 0, 48.5]; victim.hp = 1;
    victim.update = function (dt) { if (!this.alive) { this.deadT += dt; this.updateAnim(dt); return; } this.navigate(dt, 5); this.locomotion(); this.updateAnim(dt); };
    this.radioD = () => g.hud.subtitle(victim.name, "It's behind me! IT'S BEHIND ME—", 2, '#ff9a60');
    this.radioD();
    // ...and the lights die
    this.after(1.4, () => {
      for (const l of L.markers.corridorLights) { l.intensity = 0; l.tube.emissiveStrength = 0; }
      g.powerOn = false; g.audio.flickerBuzz(P.pos);
      this.s173 = new SCP173(g, [victim.pos[0] - 0.8, 0, victim.pos[2]]);
      g.scp173 = this.s173; g.actors.push(this.s173);
      this.s173.node.visible = true;
    });
    this.after(2.1, () => { g.audio.neckSnap(victim.center()); victim.damage(999, 'head', [0, 0, 1], this.s173); g.audio.scrape(victim.center(), 0.7); });
    this.after(3.0, () => {
      for (const l of L.markers.corridorLights) { l.intensity = 34; l.tube.emissiveStrength = 9; } g.powerOn = true;
      const s = this.s173;
      s.pos = [AREA2_X + (P.pos[0] > AREA2_X ? -1.4 : 1.4), 0, Math.min(P.pos[2] + 6.5, 49)]; s.yaw = Math.PI; s.place();
      s.active = true; P.blinkEnabled = true; P.blink = 0.9;
      g.audio.setLoop('drone', 0.7); g.audio.setLoop('alarm', 0.25);
      this.phase = 'contain';
      this.checkpoint = 'a2power';
      L.interact.push(L.interact.find((i) => i.id === 'contain') || { id: 'contain', pos: [0, 0, 0], radius: 3.2, label: 'Deploy containment restraint', area: 2, enabled: false, hold: 3.2 });
      this.objective('RECONTAIN SCP-173', 'Keep eyes on it. Get close and deploy the restraint [F]');
      g.hud.banner('SCP-173', 'OBJECT CLASS: EUCLID · DO NOT BREAK EYE CONTACT', 3.5);
      this.say([['KESTREL', 'EYES ON ONE-SEVEN-THREE! NOBODY BLINKS!', 2.6], ['HEX', 'I have eyes! Call your blinks!', 2.2], ['PATCH', 'More D-Class coming up behind us!', 2.4]]);
      g.spawnClassD(L.markers.a2late, 2, true);
      g.squad.forEach((sq, i) => { sq.mode = 'hold'; sq.hold = [AREA2_X + [-1.6, 1.6, -1, 1][i], 0, P.pos[2] - 1.5 - (i > 1 ? 1.5 : 0)]; });
    });
  }
  containComplete() {
    const g = this.g, L = g.level, P = g.player, s = this.s173;
    s.contained = true; s.active = false; P.blinkEnabled = false;
    g.hud.setMarker('s173', null);
    this.phase = 'done';
    this.say([['KESTREL', 'Restraint is locked! Hex, Grim—get it back in the box. Keep looking at it while you move!', 3.6], ['OVERWATCH', 'Epsilon-Eleven, confirm recontainment.', 2.6]]);
    this.after(2.6, () => this.fadeTo(1, 1.2));
    this.after(4.2, () => {
      s.pos = [...L.markers.chamberCenter]; s.yaw = Math.PI; s.place();
      L.doors.chamber.open = 0;
      P.pos = [AREA2_X + 0.8, 0, 47.5]; P.yaw = 0; P.pitch = 0.05;
      g.squad.forEach((q, i) => { q.pos = [AREA2_X + [-2.5, 2.5, -1.2, 3.2][i], 0, 49 + (i % 2)]; q.yaw = 0; q.mode = 'script'; q.moveTarget = null; });
      g.audio.door([AREA2_X, 2, 52], false);
      this.fadeTo(0, 1.4);
      g.hud.banner('SCP-173 RECONTAINED', 'CHAMBER 173-A SEALED · SECTOR 2 SECURE', 5);
      g.audio.setLoop('drone', 0.15); g.audio.setLoop('alarm', 0);
    });
    this.after(6.5, () => this.say([['KESTREL', 'Overwatch, Kestrel. One-Seven-Three is back in its box. Sector Two is ours.', 3.8], ['OVERWATCH', 'Good work, Epsilon. Stand by for cleanup. ...And Kestrel—Chamber 096 just stopped reporting.', 4.6], ['GRIM', '...Of course it did.', 2]]));
    this.after(18.5, () => this.complete());
  }
  complete() {
    const g = this.g, P = g.player;
    this.stage = 'complete';
    P.controlsEnabled = false;
    g.onComplete && g.onComplete();
  }

  // ================================================================ deaths / restarts
  onDeath(actor) { void actor; }
  restart() {
    const g = this.g;
    g.fade = undefined; this.fade = null;
    if (this.s173) { g.scene.remove(this.s173.node); g.actors = g.actors.filter((a) => a !== this.s173); this.s173 = null; g.scp173 = null; }
    const cp = this.checkpoint;
    g.player.alive = true; g.player.hp = 100; g.player.blinkEnabled = false;
    for (const k of ['gate', 'door', 'term', 'elev', 'power', 'chamber', 's173']) g.hud.setMarker(k, null);
    if (cp.startsWith('a1')) this.startArea1(cp);
    else { g.level.interact = g.level.interact.filter((i) => i.id !== 'contain'); this.startArea2(cp); }
  }

  // ================================================================ tick
  update(dt) {
    const g = this.g;
    this.t += dt;
    const due = this.events.filter((e) => e.at <= this.t);
    if (due.length) { this.events = this.events.filter((e) => e.at > this.t); for (const e of due) e.fn(); }
    if (this.fade) { this.fade.t += dt; const k = clamp(this.fade.t / this.fade.dur, 0, 1); g.fade = lerp(this.fade.from, this.fade.to, smooth(k)); if (k >= 1) { if (this.fade.to === 0) g.fade = undefined; this.fade = null; } }
    if (this.elevatorRumble) { g.player.shake = 0.25 + Math.random() * 0.05; }
    if (this.stage === 'intro') this.updateIntro(dt);
    else if (this.stage === 'a1') this.updateArea1(dt);
    else if (this.stage === 'a2') this.updateArea2(dt);
    // squad seated (cutscene) placement
    for (const s of g.squad) if (s.seated) { s.ch.position.set(s.seated.pos); quat.fromEuler(s.ch.rotation, 0, s.seated.yaw * 180 / Math.PI, 0); }
  }
}
