// DOM HUD in the style of the reference screenshot: teal/cyan palette, bottom-right weapon
// panel with a large ammo counter and slot icons (silhouettes generated from the gun
// models), bottom-left minimap + squad list, compass tape, world markers, CoD-style
// nameplates, killfeed, radio subtitles, prompts, damage indicators and screens.
import { buildShape, mat4, quat, vec3 } from '../../engine/index.js';
import { WEAPONS } from '../content/weapons.js';
import { SQUAD } from './actors.js';
import { clamp } from '../util.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- icons
export function weaponSilhouette(id, w = 220, h = 70) {
  const def = WEAPONS[id];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const tris = [];
  let minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of def.parts()) {
    const b = p.bind.bone;
    if (b === 'flash' || b === 'shell' || p.material === 'glass' || p.material === 'reticle') continue;
    const g = buildShape(p.shape, p.modifiers);
    const m = mat4.fromRTS(mat4.create(), quat.fromEuler(quat.create(), ...p.rotation), p.position, p.scale);
    const P = g.positions, v = [0, 0, 0], pts = [];
    for (let i = 0; i < P.length; i += 3) { vec3.transformMat4(v, [P[i], P[i + 1], P[i + 2]], m); pts.push(v[2], v[1]); minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]); minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]); }
    tris.push([pts, g.indices]);
  }
  const s = Math.min((w - 8) / (maxZ - minZ), (h - 8) / (maxY - minY));
  const ox = (w - (maxZ - minZ) * s) / 2, oy = (h - (maxY - minY) * s) / 2;
  x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineWidth = 0.6;
  x.beginPath();
  for (const [pts, I] of tris) for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 2, b = I[t + 1] * 2, cc = I[t + 2] * 2;
    // muzzle to the right (+Z), up is up
    x.moveTo(ox + (pts[a] - minZ) * s, h - oy - (pts[a + 1] - minY) * s);
    x.lineTo(ox + (pts[b] - minZ) * s, h - oy - (pts[b + 1] - minY) * s);
    x.lineTo(ox + (pts[cc] - minZ) * s, h - oy - (pts[cc + 1] - minY) * s);
    x.closePath();
  }
  x.fill(); x.stroke();
  return c.toDataURL();
}
const ICON = {
  frag: '<svg viewBox="0 0 24 24"><circle cx="11" cy="14" r="7" fill="currentColor"/><rect x="9" y="3.5" width="5" height="4" fill="currentColor"/><path d="M14 5 L20 9" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="17.5" cy="5" r="2.2" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
  med: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="14" rx="2" fill="currentColor"/><rect x="8" y="3" width="8" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 9v8M8 13h8" stroke="#0a1a1a" stroke-width="2.6"/></svg>',
  light: '<svg viewBox="0 0 24 24"><path d="M4 9h7l5-4v14l-5-4H4z" fill="currentColor"/><path d="M18 8l3-2M18 12h4M18 16l3 2" stroke="currentColor" stroke-width="1.6"/></svg>',
  nvg: '<svg viewBox="0 0 24 24"><circle cx="7" cy="13" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="13" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11.5 13h1M7 6h10" stroke="currentColor" stroke-width="2"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.4-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.6-8 11-8 11z" fill="currentColor"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/></svg>',
  skull: '<svg viewBox="0 0 24 24"><path d="M12 2a8 8 0 00-8 8c0 3 1.6 4.8 3 5.8V19h10v-3.2c1.4-1 3-2.8 3-5.8a8 8 0 00-8-8z" fill="currentColor"/><circle cx="9" cy="11" r="2" fill="#000"/><circle cx="15" cy="11" r="2" fill="#000"/></svg>',
  cross: '<svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="3"/></svg>',
};
export function rankInsignia(rank) {
  const chev = (n, rocker = 0) => {
    let s = '';
    for (let i = 0; i < n; i++) s += `<path d="M3 ${6 + i * 5} L12 ${1 + i * 5} L21 ${6 + i * 5}" stroke="currentColor" stroke-width="2.6" fill="none"/>`;
    for (let i = 0; i < rocker; i++) s += `<path d="M3 ${17 + i * 4} Q12 ${22 + i * 4} 21 ${17 + i * 4}" stroke="currentColor" stroke-width="2.4" fill="none"/>`;
    return `<svg viewBox="0 0 24 26">${s}</svg>`;
  };
  if (rank === 'LT') return '<svg viewBox="0 0 24 26"><rect x="9" y="2" width="6" height="22" rx="1" fill="#cfd6dc" stroke="#fff" stroke-width="0.8"/></svg>';
  if (rank === 'SSGT') return chev(3, 1);
  if (rank === 'SGT') return chev(3);
  if (rank === 'CPL') return chev(2);
  return chev(1);
}

// ---------------------------------------------------------------- HUD
export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.silhouettes = {};
    this.markers = new Map();
    this.killfeed = [];
    this.subQueue = []; this.subT = 0;
    this.dmg = [];
    this.hitT = 0;
    this.miniCanvas = $('minimap'); this.mini = this.miniCanvas.getContext('2d');
    this.compass = $('compassTape');
    this.buildCompass();
    this.portraits = {};
  }
  init() {
    for (const id of Object.keys(WEAPONS)) this.silhouettes[id] = weaponSilhouette(id);
    $('slot3icon').innerHTML = ICON.frag; $('slot4icon').innerHTML = ICON.med;
    $('lightIcon').innerHTML = ICON.light; $('nvgIcon').innerHTML = ICON.nvg; $('hpIcon').innerHTML = ICON.heart; $('blinkIcon').innerHTML = ICON.eye;
    this.buildSquadList();
  }
  buildCompass() {
    let html = '';
    for (let d = -360; d <= 720; d += 15) {
      const deg = ((d % 360) + 360) % 360;
      const lab = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[deg];
      html += `<div class="tick ${lab ? 'major' : deg % 30 === 0 ? 'mid' : ''}" style="left:${(d + 360) * 4}px">${lab ? `<b>${lab}</b>` : deg % 30 === 0 ? `<span>${deg}</span>` : ''}</div>`;
    }
    this.compass.innerHTML = html;
  }
  buildSquadList() {
    const el = $('squadList');
    el.innerHTML = SQUAD.map((s) => `<div class="sq" id="sq-${s.id}"><div class="portrait" style="background-image:url(${this.portraits[s.id] || ''})"></div><div class="sqname">${s.call}<i class="rk">${rankInsignia(s.rank)}</i></div><div class="sqbar"><div></div></div><div class="sqicon">${s.role}</div></div>`).join('');
  }
  setPortraits(p) { this.portraits = p; this.buildSquadList(); }

  // ---------------------------------------------------------------- transient
  hitmarker(kill, head) {
    const h = $('hitmarker');
    h.className = 'show' + (kill ? ' kill' : '') + (head ? ' head' : '');
    this.hitT = kill ? 0.35 : 0.18;
  }
  damageFrom(src, player) {
    const sp = src.pos || src;
    const ang = Math.atan2(sp[0] - player.pos[0], sp[2] - player.pos[2]) - player.yaw;
    const el = document.createElement('div'); el.className = 'dmgind';
    el.style.transform = `translate(-50%,-50%) rotate(${-ang * 180 / Math.PI}deg)`;
    $('dmgLayer').appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }
  toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  }
  flash(kind) { const f = $('screenFlash'); f.className = kind; void f.offsetWidth; f.className = kind + ' go'; }
  kill(killer, weapon, victim, head) {
    const row = document.createElement('div'); row.className = 'kf';
    row.innerHTML = `<span class="kfk ${killer.team || 'mtf'}">${killer.name}</span> <span class="kfw">[${weapon}]</span>${head ? ' <span class="kfh">✛</span>' : ''} <span class="kfv">${victim}</span>`;
    const feed = $('killfeed'); feed.prepend(row);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => row.classList.add('fade'), 5000); setTimeout(() => row.remove(), 6000);
  }
  subtitle(speaker, text, dur = 3.2, color = '#6ff3e4') {
    this.subQueue.push({ speaker, text, dur, color });
  }
  objective(title, text) {
    $('objTitle').textContent = title; $('objText').textContent = text;
    const o = $('objective'); o.classList.remove('pulse'); void o.offsetWidth; o.classList.add('pulse');
  }
  banner(title, sub, dur = 4) {
    const b = $('banner'); $('bannerTitle').textContent = title; $('bannerSub').textContent = sub || '';
    b.classList.add('show'); clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.remove('show'), dur * 1000);
  }
  // world marker: { id, pos, label, kind:'obj'|'danger', text }
  setMarker(id, m) { if (m) this.markers.set(id, m); else this.markers.delete(id); }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game, P = g.player, w = P.weapon, ws = P.wstate;
    this.root.style.display = g.hudVisible ? 'block' : 'none';
    if (!g.hudVisible) return;
    // weapon panel
    const mag = String(ws.mag).padStart(3, '0');
    const lead = mag.match(/^0*/)[0].length;
    const shown = ws.mag === 0 ? '000' : mag;
    $('ammoMag').innerHTML = `<span class="dim">${shown.slice(0, Math.min(lead, 3))}</span>${ws.mag === 0 ? '' : shown.slice(lead)}`;
    $('ammoMag').classList.toggle('low', ws.mag <= Math.ceil(w.mag * 0.25));
    $('ammoRes').textContent = ws.reserve;
    $('wname').textContent = w.short;
    $('wmode').textContent = w.modes[ws.mode];
    $('hpNum').textContent = '+' + Math.ceil(P.hp);
    $('hpBar').style.width = P.hp + '%';
    $('hpBar').classList.toggle('crit', P.hp < 35);
    $('lightIcon').classList.toggle('on', P.flashlightOn); $('nvgIcon').classList.toggle('on', P.nvg);
    const lo = P.loadout;
    for (let i = 0; i < 2; i++) {
      const s = $('slot' + (i + 1)), id = lo[i];
      s.classList.toggle('active', P.slot === i);
      if (s.dataset.w !== id) { s.dataset.w = id; s.querySelector('.sicon').style.backgroundImage = `url(${this.silhouettes[id]})`; }
      s.querySelector('.scount').textContent = P.ammo[id] ? P.ammo[id].mag + P.ammo[id].reserve : '';
    }
    $('slot3count').textContent = P.grenades; $('slot4count').textContent = P.medkits;
    $('slot3').classList.toggle('empty', P.grenades <= 0); $('slot4').classList.toggle('empty', P.medkits <= 0);
    $('reloadHint').style.opacity = ws.mag <= Math.ceil(w.mag * 0.2) && ws.reserve > 0 && !P.reloading ? 1 : 0;
    // crosshair spread + scope
    const ads = P.adsAmount;
    const spread = (w.spreadHip * (1 - ads) + w.spreadAds * ads) * (1 + Math.min(1, P.speed / 4) * 1.5) + P.bloom * 0.02;
    const px = 6 + spread / Math.tan(g.camera.fov / 2) * (window.innerHeight / 2);
    const ch = $('crosshair');
    ch.style.setProperty('--gap', px + 'px');
    ch.style.opacity = ads > 0.6 || P.sprinting || P.vm.busy ? 0 : 1;
    ch.classList.toggle('enemy', !!(P.aimingAt && P.aimingAt.team === 'dclass' && P.aimingAt.alive && !P.aimingAt.surrendered));
    $('scope').style.opacity = w.scope && ads > 0.85 ? 1 : 0;
    g.player.vmRoot.visible = !(w.scope && ads > 0.85);
    // hitmarker
    this.hitT -= dt; if (this.hitT <= 0) $('hitmarker').className = '';
    // compass
    const heading = ((-P.yaw * 180 / Math.PI) % 360 + 360) % 360;
    this.compass.style.transform = `translateX(${-(heading + 360) * 4}px)`;
    $('heading').textContent = Math.round(heading) + ' ' + ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(heading / 45) % 8];
    // counts
    const hostiles = g.actors.filter((a) => a.team === 'dclass' && a.alive && !a.surrendered && a.area === g.area).length;
    $('scoreA').textContent = hostiles; $('scoreB').textContent = g.squad.length + 1;
    $('scoreBarA').style.width = Math.min(100, hostiles * 9) + '%';
    $('areaName').textContent = g.areaName;
    // squad list
    for (const s of g.squad) { const el = $('sq-' + s.info.id); if (el) { el.querySelector('.sqbar div').style.width = (s.hp / s.maxHp * 100) + '%'; el.classList.toggle('talk', g.talking === s); el.classList.toggle('blink', s.blinking > 0); } }
    this.drawMinimap();
    this.updateMarkers();
    this.updateNameplates();
    this.updateSubtitles(dt);
    // prompt
    const it = P.nearInteract;
    const pr = $('prompt');
    if (it) { pr.style.display = 'flex'; $('promptText').textContent = it.label; $('promptRing').style.setProperty('--p', (P.interactHold / (it.hold ?? 1.2)) * 100); }
    else pr.style.display = 'none';
    // SCP-173 blink UI
    const s173 = g.scp173;
    const blinkOn = P.blinkEnabled;
    $('blinkBox').style.display = blinkOn ? 'flex' : 'none';
    if (blinkOn) {
      $('blinkFill').style.width = (P.blink * 100) + '%';
      $('blinkFill').classList.toggle('low', P.blink < 0.25);
      $('eyesOn').textContent = s173 && s173.active && !s173.contained ? `EYES ON TARGET: ${s173.observers}` : '';
      $('eyesOn').classList.toggle('none', s173 && s173.observers === 0);
    }
  }
  drawMinimap() {
    const g = this.game, P = g.player, c = this.mini, W = this.miniCanvas.width, H = this.miniCanvas.height, scale = 3.2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = 'rgba(8,20,22,0.82)'; c.fillRect(0, 0, W, H);
    c.translate(W / 2, H / 2 + 12);
    c.rotate(P.yaw + Math.PI);
    c.scale(scale, scale);
    c.translate(-P.pos[0], -P.pos[2]);
    // flip x so the map matches the view (world +X is screen right when facing +Z... mirrored for yaw convention)
    c.fillStyle = 'rgba(120,200,190,0.28)';
    for (const col of g.physics.colliders) {
      if (!col.enabled || col.area !== g.area || col.max[1] < 0.6) continue;
      if (Math.abs(col.min[0] - P.pos[0]) > 70 && Math.abs(col.max[0] - P.pos[0]) > 70) continue;
      c.fillRect(col.min[0], col.min[2], col.max[0] - col.min[0], col.max[2] - col.min[2]);
    }
    const dot = (p, color, r = 1.1) => { c.fillStyle = color; c.beginPath(); c.arc(p[0], p[2], r, 0, 7); c.fill(); };
    for (const a of g.actors) {
      if (!a.alive || a.area !== g.area) continue;
      if (a.team === 'mtf') dot(a.pos, '#35f2c8', 1.2);
      else if (a.team === 'dclass' && (a.spotted || g.physics.lineOfSight(P.eye(), a.center()))) { a.spotted = true; dot(a.pos, a.surrendered ? '#f2c230' : '#ff4a3a', 1.1); }
    }
    for (const [, m] of this.markers) if (m.pos) { c.fillStyle = m.kind === 'danger' ? '#ff3a2a' : '#f7a13a'; c.save(); c.translate(m.pos[0], m.pos[2]); c.rotate(Math.PI / 4); c.fillRect(-1.6, -1.6, 3.2, 3.2); c.restore(); }
    c.setTransform(1, 0, 0, 1, 0, 0);
    // player arrow
    c.fillStyle = '#e8fffb'; c.beginPath(); c.moveTo(W / 2, H / 2 + 4); c.lineTo(W / 2 - 5, H / 2 + 16); c.lineTo(W / 2 + 5, H / 2 + 16); c.fill();
    c.strokeStyle = 'rgba(80,240,210,0.35)'; c.lineWidth = 1; c.strokeRect(0.5, 0.5, W - 1, H - 1);
  }
  project(p) {
    const cam = this.game.camera, v = cam.viewProj;
    const x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12], y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13], w = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
    if (w <= 0.05) return null;
    return [(x / w * 0.5 + 0.5) * window.innerWidth, (1 - (y / w * 0.5 + 0.5)) * window.innerHeight, w];
  }
  updateMarkers() {
    const layer = $('markerLayer');
    const P = this.game.player;
    for (const [id, m] of this.markers) {
      let el = document.getElementById('mk-' + id);
      if (!el) { el = document.createElement('div'); el.id = 'mk-' + id; el.className = 'marker ' + (m.kind || 'obj'); el.innerHTML = `<div class="dia"><b>${m.label || ''}</b></div><div class="mdist"></div><div class="mtext">${m.text || ''}</div>`; layer.appendChild(el); }
      const p = [m.pos[0], (m.pos[1] || 0) + (m.h ?? 2.2), m.pos[2]];
      let s = this.project(p);
      const d = Math.hypot(p[0] - P.pos[0], p[2] - P.pos[2]);
      // clamp to the screen edge when off screen / behind
      if (!s) { const ang = Math.atan2(p[0] - P.pos[0], p[2] - P.pos[2]) - P.yaw; s = [window.innerWidth / 2 - Math.sin(ang) * window.innerWidth, window.innerHeight * 0.85]; }
      s[0] = clamp(s[0], 40, window.innerWidth - 40); s[1] = clamp(s[1], 60, window.innerHeight - 160);
      el.style.transform = `translate(${s[0]}px, ${s[1]}px)`;
      el.querySelector('.mdist').textContent = Math.round(d) + ' m';
      el.style.opacity = m.hidden ? 0 : 1;
    }
    for (const el of [...layer.children]) if (!this.markers.has(el.id.slice(3))) el.remove();
  }
  updateNameplates() {
    const g = this.game, P = g.player, layer = $('nameLayer');
    const aimed = P.aimingAt;
    for (const s of g.squad) {
      let el = document.getElementById('np-' + s.info.id);
      if (!el) {
        el = document.createElement('div'); el.id = 'np-' + s.info.id; el.className = 'nameplate';
        el.innerHTML = `<div class="npmini"><span class="npd">◆</span> ${s.info.call}</div><div class="npfull"><i class="rk">${rankInsignia(s.info.rank)}</i><div><div class="npn">${s.info.rank}. ${s.info.first[0]}. ${s.info.last.toUpperCase()}</div><div class="npc">"${s.info.call}" · ${s.info.role}</div><div class="nph"><div></div></div></div></div>`;
        layer.appendChild(el);
      }
      const head = [s.pos[0], s.pos[1] + 2.05, s.pos[2]];
      const sp = this.project(head);
      const vis = sp && g.physics.lineOfSight(P.eye(), [s.pos[0], s.pos[1] + 1.6, s.pos[2]]);
      el.style.display = sp && g.hudVisible ? 'block' : 'none';
      if (!sp) continue;
      el.style.transform = `translate(${sp[0]}px, ${sp[1]}px) translate(-50%, -100%)`;
      const full = aimed === s || (sp[2] < 5 && Math.abs(sp[0] - window.innerWidth / 2) < 120 && Math.abs(sp[1] - window.innerHeight / 2) < 200);
      el.classList.toggle('full', full && vis);
      el.style.opacity = vis ? 1 : 0.45;
      el.querySelector('.nph div').style.width = (s.hp / s.maxHp * 100) + '%';
    }
    // enemy name when aimed at
    const en = $('enemyPlate');
    if (aimed && aimed.team === 'dclass' && aimed.alive) {
      const sp = this.project([aimed.pos[0], aimed.pos[1] + 2.0, aimed.pos[2]]);
      if (sp) { en.style.display = 'block'; en.style.transform = `translate(${sp[0]}px, ${sp[1]}px) translate(-50%, -100%)`; en.innerHTML = `<span class="en">${aimed.name}</span> <span class="ew">${aimed.surrendered ? 'DETAINED' : aimed.weaponId ? '[' + WEAPONS[aimed.weaponId].short + ']' : '[UNARMED]'}</span><div class="enh"><div style="width:${aimed.hp}%"></div></div>`; }
    } else if (aimed && aimed.team === 'scp') {
      const sp = this.project([aimed.pos[0], aimed.pos[1] + 2.1, aimed.pos[2]]);
      if (sp) { en.style.display = 'block'; en.style.transform = `translate(${sp[0]}px, ${sp[1]}px) translate(-50%, -100%)`; en.innerHTML = `<span class="en scp">SCP-173</span> <span class="ew">EUCLID · DO NOT BLINK</span>`; }
    } else en.style.display = 'none';
  }
  updateSubtitles(dt) {
    const el = $('subtitle');
    this.subT -= dt;
    if (this.subT <= 0) {
      const n = this.subQueue.shift();
      if (n) { el.innerHTML = n.speaker ? `<b style="color:${n.color}">${n.speaker}:</b> ${n.text}` : n.text; el.style.opacity = 1; this.subT = n.dur; this.game.audio.squelch(); this.onLine && this.onLine(n); }
      else { el.style.opacity = 0; this.game.talking = null; }
    }
    if (this.subQueue.length > 4) this.subQueue.splice(0, this.subQueue.length - 4);
  }
}
