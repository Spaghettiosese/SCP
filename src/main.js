// Boot, menus, input and the main loop.
import { Game } from './game/game.js';
import { Director } from './game/director.js';
import { audio } from './game/audio.js';
import { WEAPONS, PRIMARIES, SIDEARMS } from './content/weapons.js';
import { SQUAD } from './game/actors.js';
import { humanClips, createOperator } from './content/humans.js';
import { Renderer, Scene, Camera } from '../engine/index.js';
import { weaponSilhouette } from './game/hud.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SETTINGS_KEY = 'scp-e11-settings';
const defaults = { sensitivity: 1, fov: 74, quality: 'high', difficulty: 1, invertY: false, primary: 'm4a1', secondary: 'glock', volume: 0.8 };
let settings = { ...defaults };
try { settings = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (e) { /* storage unavailable */ }
const save = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } };

// ---------------------------------------------------------------- input
const keys = new Set(), pressed = new Set();
const mouse = { dx: 0, dy: 0, left: false, right: false };
let wheel = 0;
addEventListener('keydown', (e) => { if (!keys.has(e.code)) pressed.add(e.code); keys.add(e.code); if (['Space', 'Tab', 'KeyF'].includes(e.code) && locked()) e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('mousemove', (e) => { if (locked()) { mouse.dx += e.movementX; mouse.dy += e.movementY; } });
addEventListener('mousedown', (e) => { if (!locked()) return; if (e.button === 0) mouse.left = true; if (e.button === 2) mouse.right = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (locked()) wheel += Math.sign(e.deltaY); }, { passive: true });
const locked = () => document.pointerLockElement === $('game') || params.has('nolock');
function readInput() {
  const k = (c) => keys.has(c), p = (c) => pressed.has(c);
  let swap = null;
  if (p('Digit1')) swap = 0; if (p('Digit2')) swap = 1;
  if (wheel !== 0) { swap = game.player.slot === 0 ? 1 : 0; wheel = 0; }
  const inp = {
    mouse: [mouse.dx, mouse.dy], move: [(k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0), (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0)],
    sprint: k('ShiftLeft') || k('ShiftRight'), crouch: k('KeyC') || k('ControlLeft'), jumpPressed: p('Space'), leanL: k('KeyQ'), leanR: k('KeyE'),
    fire: mouse.left, ads: mouse.right, reloadPressed: p('KeyR'), swapPressed: swap, modePressed: p('KeyB'), meleePressed: p('KeyV'),
    inspectPressed: p('KeyI'), grenadePressed: p('KeyG') || p('Digit3'), medPressed: p('KeyH') || p('Digit4'), lightPressed: p('KeyT'), nvgPressed: p('KeyN'),
    interact: k('KeyF'), blinkPressed: p('KeyX'),
  };
  mouse.dx = 0; mouse.dy = 0;
  return inp;
}

// ---------------------------------------------------------------- boot
let game, director, running = false, paused = true, last = performance.now(), state = 'loading';
async function step(label, pct, fn) { $('loadText').textContent = label; $('loadBar').style.width = pct + '%'; await new Promise((r) => setTimeout(r, 30)); return fn(); }

async function boot() {
  try {
    await step('Synthesizing gait & combat animations…', 10, () => humanClips());
    await step('Building Site-80: Gate B & Heavy Containment…', 30, () => { game = new Game($('game'), settings); window.__game = game; });
    await step('Assembling weapons & view models…', 55, () => { for (const id of Object.keys(WEAPONS)) game.player.vm.build(id); game.player.setLoadout(settings.primary, settings.secondary); });
    await step('Briefing Epsilon-11…', 70, () => { director = new Director(game); game.onInteract = (it) => director.onInteract(it); });
    await step('Rendering squad portraits…', 82, () => renderPortraits());
    await step('Calibrating HUD…', 94, () => { game.hud.init(); game.hud.setPortraits(window.__portraits || {}); });
    wireGame();
    buildMenus();
    $('loading').classList.add('done'); setTimeout(() => ($('loading').style.display = 'none'), 900);
    state = 'menu'; showScreen('menu');
    running = true;
    requestAnimationFrame(loop);
    // headless test hooks
    if (params.has('auto')) autoStart();
  } catch (err) {
    console.error(err);
    $('loadText').textContent = 'Failed to start: ' + err.message;
  }
}

function renderPortraits() {
  const out = {};
  try {
    const cv = $('portraitCanvas');
    const r = new Renderer(cv, { pixelRatio: 1, msaa: 4, shadowSize: 512, preserveDrawingBuffer: true });
    for (const info of SQUAD) {
      const scene = new Scene(), cam = new Camera();
      Object.assign(scene.environment, { mesas: false, sky: false, fogColor: [0.05, 0.12, 0.13], fogDensity: 0, ambient: 0.9, sunIntensity: 2.6, sunDirection: [0.5, 0.5, 0.8], exposure: 1.2 });
      const ch = createOperator({ name: info.last, gear: info.gear, beard: info.beard, skin: info.skin, medic: info.medic });
      ch.play('Idle', { fade: 0 }); ch.update(0.5);
      scene.add(ch);
      cam.position.set([0.12, 1.74, 0.62]); cam.target.set([0, 1.7, 0]); cam.fov = 26 * Math.PI / 180;
      r.render(scene, cam, { shadows: false });
      out[info.id] = cv.toDataURL('image/jpeg', 0.85);
    }
    const lose = r.gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  } catch (e) { console.warn('portraits failed', e); }
  window.__portraits = out;
}

function wireGame() {
  game.onPlayerDeath = () => {
    state = 'dead';
    setTimeout(() => { showScreen('dead'); document.exitPointerLock && document.exitPointerLock(); }, 1400);
    $('deadCause').textContent = game.deathCause || 'KILLED IN ACTION';
    game.deathCause = null;
  };
  game.killPlayerBy173 = () => {
    game.deathCause = 'NECK SNAPPED BY SCP-173 — YOU BLINKED';
    audio.neckSnap(game.player.eye());
    game.cameraRoll = 1.1; game.player.pitch = -0.4;
    game.player.damage(999, null);
  };
  game.onComplete = () => {
    state = 'complete';
    const s = game.player.stats;
    const acc = s.shots ? Math.round(s.hits / s.shots * 100) : 0;
    const t = Math.floor(s.time), mm = String(Math.floor(t / 60)).padStart(2, '0'), ss = String(t % 60).padStart(2, '0');
    $('stats').innerHTML = `<div><b>${mm}:${ss}</b><span>Mission time</span></div><div><b>${s.kills}</b><span>Hostiles neutralized</span></div><div><b>${s.detained}</b><span>D-Class detained</span></div><div><b>${s.headshots}</b><span>Headshots</span></div><div><b>${acc}%</b><span>Accuracy</span></div><div><b>1</b><span>SCP recontained</span></div>`;
    showScreen('complete');
    document.exitPointerLock && document.exitPointerLock();
  };
}

// ---------------------------------------------------------------- menus
function showScreen(name) {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('show', el.id === 'scr-' + name);
  document.body.classList.toggle('in-menu', !!name);
}
function buildMenus() {
  const opt = (list, cur, key) => list.map((id) => `<button class="wcard ${cur === id ? 'sel' : ''}" data-k="${key}" data-id="${id}"><img src="${weaponSilhouette(id, 260, 80)}"><b>${WEAPONS[id].name}</b><span>${WEAPONS[id].cls} · ${WEAPONS[id].caliber}</span><em>${statBars(WEAPONS[id])}</em></button>`).join('');
  const render = () => {
    $('primaries').innerHTML = opt(PRIMARIES, settings.primary, 'primary');
    $('sidearms').innerHTML = opt(SIDEARMS, settings.secondary, 'secondary');
    for (const b of document.querySelectorAll('.wcard')) b.onclick = () => { settings[b.dataset.k] = b.dataset.id; save(); render(); game.player.setLoadout(settings.primary, settings.secondary); };
  };
  render();
  $('btnDeploy').onclick = () => deploy(false);
  $('btnLoadout').onclick = () => showScreen('loadout');
  $('btnSettings').onclick = () => { syncSettings(); showScreen('settings'); };
  $('btnControls').onclick = () => showScreen('controls');
  for (const b of document.querySelectorAll('[data-back]')) b.onclick = () => showScreen(state === 'paused' ? 'pause' : 'menu');
  $('btnResume').onclick = () => resume();
  $('btnRestartCp').onclick = () => { director.restart(); resume(); };
  $('btnQuit').onclick = () => location.reload();
  $('btnRetry').onclick = () => { director.restart(); state = 'playing'; resume(); };
  $('btnAgain').onclick = () => location.reload();
  $('btnPauseSettings').onclick = () => { syncSettings(); showScreen('settings'); };
  for (const inp of document.querySelectorAll('#scr-settings [data-set]')) inp.oninput = inp.onchange = () => {
    const k = inp.dataset.set; settings[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? parseFloat(inp.value) : inp.value;
    save(); syncSettings(); game.settings = settings; audio.master && (audio.master.gain.value = settings.volume);
  };
}
function statBars(w) {
  const bar = (v) => `<i style="width:${Math.round(Math.max(0.05, Math.min(1, v)) * 100)}%"></i>`;
  return `<label>DMG</label><s>${bar(w.damage * (w.pellets || 1) / 140)}</s><label>RPM</label><s>${bar(w.rpm / 1000)}</s><label>CTRL</label><s>${bar(1 - w.recoil[0] / 4.5)}</s><label>MOB</label><s>${bar((w.moveMul - 0.8) / 0.3)}</s>`;
}
function syncSettings() {
  for (const inp of document.querySelectorAll('#scr-settings [data-set]')) {
    const k = inp.dataset.set;
    if (inp.type === 'checkbox') inp.checked = !!settings[k]; else inp.value = settings[k];
    const lab = document.querySelector(`[data-val="${k}"]`); if (lab) lab.textContent = typeof settings[k] === 'number' ? (k === 'fov' ? settings[k] + '°' : settings[k].toFixed(2)) : settings[k];
  }
}
function deploy(skip) {
  audio.init(); audio.resume(); audio.master && (audio.master.gain.value = settings.volume);
  game.player.setLoadout(settings.primary, settings.secondary);
  showScreen(null);
  state = 'playing';
  requestLock();
  if (skip) { director.startIntro(); director.t = 33.3; director.updateIntro(0); }
  else director.startIntro();
  paused = false;
}
function requestLock() { const c = $('game'); if (c.requestPointerLock && !params.has('nolock')) { try { const r = c.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } } }
function resume() { showScreen(null); state = 'playing'; paused = false; requestLock(); audio.resume(); }
document.addEventListener('pointerlockchange', () => {
  if (!locked() && state === 'playing' && !params.has('nolock')) { paused = true; state = 'paused'; showScreen('pause'); }
});
$('game').addEventListener('click', () => { if (state === 'playing' && !locked()) requestLock(); });
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && state === 'dead') { director.restart(); state = 'playing'; resume(); }
});

// ---------------------------------------------------------------- loop
let skipHold = 0, fpsAvg = 60;
function loop(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
  if (!paused && (state === 'playing' || state === 'dead' || state === 'complete')) {
    const input = state === 'playing' ? readInput() : (readInput(), { mouse: [0, 0], move: [0, 0] });
    // skip the cutscene by holding Space
    if (director.stage === 'intro') {
      skipHold = keys.has('Space') || keys.has('Enter') ? skipHold + dt : 0;
      $('skip').style.opacity = director.t > 1 ? 1 : 0;
      $('skipFill').style.width = Math.min(100, skipHold / 1.2 * 100) + '%';
      if (skipHold > 1.2) { director.t = 31; skipHold = 0; }
    } else $('skip').style.opacity = 0;
    game.time += dt;
    director.update(dt);
    game.player.update(dt, input);
    for (const a of [...game.actors]) a.update(dt);
    game.updateWorld(dt);
    game.player.vmRoot.updateWorld();
    game.render(dt);
    game.hud.update(dt);
    if (params.has('fps')) $('fps').textContent = Math.round(fpsAvg) + ' fps · ' + game.renderer.stats.drawCalls + ' draws · ' + game.renderer.stats.lights + ' lights';
  } else if (state === 'menu' || state === 'paused') {
    // idle backdrop: slow orbit around the gate in the storm
    const t = now / 1000;
    game.time += dt;
    if (state === 'menu') {
      if (game.area !== 1 || !game.menuInit) { game.setArea(1); game.menuInit = true; }
      game.cameraOverride = { pos: [Math.sin(t * 0.04) * 36, 9 + Math.sin(t * 0.1) * 2, -52 + Math.cos(t * 0.04) * 8], target: [0, 5, 10], fov: 50 };
      game.updateWorld(dt);
      game.render(dt);
    }
    pressed.clear();
  }
  pressed.clear();
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- automated test hooks (?auto=...)
function autoStart() {
  const mode = params.get('auto');
  audio.enabled = false;
  if (mode === 'intro') { deploy(false); director.t = parseFloat(params.get('t') || '10'); }
  else if (mode === 'a1') { deploy(true); }
  else if (mode === 'a2') { deploy(true); director.startArea2(params.get('cp') || 'a2'); }
  else if (mode === '173') { deploy(true); director.startArea2('a2power'); game.player.pos = [400, 0, 43]; }
  const yaw = params.get('yaw'); if (yaw) game.player.yaw = parseFloat(yaw);
  const pos = params.get('pos'); if (pos) game.player.pos = JSON.parse(pos);
  if (params.get('god')) game.godMode = true;
  const cam = params.get('cam');
  if (cam) { const c = JSON.parse(cam), l = JSON.parse(params.get('look') || '[0,0,0]'); game.debugCam = { pos: c, target: l, fov: parseFloat(params.get('fov') || '60') }; game.hudVisible = !params.has('nohud'); }
  if (params.has('freeze')) setTimeout(() => { game.actors.forEach((a) => { a.update = a.updateAnim ? function (dt) { this.updateAnim(dt); } : () => {}; }); }, 500);
  const wait = parseFloat(params.get('wait') || '2');
  setTimeout(() => { window.__ready = true; }, wait * 1000);
}

boot();
