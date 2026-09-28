// Procedural canvas textures: signage, the Foundation emblem, warning labels,
// decals (blood, bullet holes, scorch), posters and terminal screens.
const cache = new Map();
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };

function grime(ctx, w, h, amount = 0.12, seed = 1) {
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(30,25,20,${r() * amount})`;
    const x = r() * w, y = r() * h, rr = r() * w * 0.05 + 2;
    ctx.beginPath(); ctx.ellipse(x, y, rr * (0.5 + r()), rr, r() * 3, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 40; i++) { // scratches
    ctx.strokeStyle = `rgba(255,255,255,${r() * amount * 0.6})`; ctx.lineWidth = 1;
    const x = r() * w, y = r() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * w * 0.2, y + (r() - 0.5) * h * 0.1); ctx.stroke();
  }
}

export function drawEmblem(ctx, cx, cy, R, color = '#ffffff', bg = null) {
  ctx.save(); ctx.translate(cx, cy);
  if (bg) { ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(0, 0, R * 1.08, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = R * 0.14; ctx.beginPath(); ctx.arc(0, 0, R * 0.86, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = R * 0.1; ctx.beginPath(); ctx.arc(0, 0, R * 0.34, 0, Math.PI * 2); ctx.stroke();
  for (let k = 0; k < 3; k++) {
    ctx.save(); ctx.rotate((k * Math.PI * 2) / 3 - Math.PI / 2);
    // three arrows pointing inward toward the core
    ctx.beginPath();
    ctx.moveTo(R * 0.44, 0); ctx.lineTo(R * 0.64, -R * 0.2); ctx.lineTo(R * 0.64, -R * 0.08); ctx.lineTo(R * 0.93, -R * 0.08);
    ctx.lineTo(R * 0.93, R * 0.08); ctx.lineTo(R * 0.64, R * 0.08); ctx.lineTo(R * 0.64, R * 0.2); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export const emblemTexture = () => memo('emblem', () => {
  const c = canvas(512, 512), x = c.getContext('2d');
  x.clearRect(0, 0, 512, 512);
  drawEmblem(x, 256, 256, 230, '#e8e8e8');
  return c;
});

// Wall sign: big stencil-ish text, optional sub line, stripes and emblem
export function signTexture(text, o = {}) {
  const key = 'sign:' + text + JSON.stringify(o);
  return memo(key, () => {
    const w = o.w || 1024, h = o.h || 256, c = canvas(w, h), x = c.getContext('2d');
    x.fillStyle = o.bg || '#1d2024'; x.fillRect(0, 0, w, h);
    if (o.stripes) {
      x.save(); x.beginPath(); x.rect(0, 0, w, h * 0.12); x.rect(0, h * 0.88, w, h * 0.12); x.clip();
      for (let i = -h; i < w + h; i += 48) { x.fillStyle = '#f2c230'; x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 24, 0); x.lineTo(i + 24 - h, h); x.lineTo(i - h, h); x.fill(); x.fillStyle = '#111'; }
      x.restore();
    }
    let left = h * 0.18;
    if (o.emblem) { drawEmblem(x, h * 0.5 + 10, h * 0.5, h * 0.32, o.fg || '#eee'); left = h + 10; }
    x.fillStyle = o.fg || '#e9e9e9';
    x.font = `${o.weight || 800} ${o.size || h * 0.42}px ${o.font || '"Arial Narrow", "Roboto Condensed", Arial, sans-serif'}`;
    x.textBaseline = 'middle';
    const tx = o.center ? (w - x.measureText(text).width) / 2 : left;
    x.fillText(text, tx, o.sub ? h * 0.4 : h * 0.52);
    if (o.sub) { x.globalAlpha = 0.8; x.font = `600 ${h * 0.16}px Arial, sans-serif`; x.fillText(o.sub, o.center ? (w - x.measureText(o.sub).width) / 2 : left + 4, h * 0.74); x.globalAlpha = 1; }
    if (o.border !== false) { x.strokeStyle = o.fg || '#e9e9e9'; x.globalAlpha = 0.5; x.lineWidth = 6; x.strokeRect(8, 8, w - 16, h - 16); x.globalAlpha = 1; }
    grime(x, w, h, o.grime ?? 0.12, text.length);
    return c;
  });
}

export const hazardLabel = (title, lines, color = '#c41e1e') => memo('hz:' + title + lines.join(), () => {
  const w = 512, h = 640, c = canvas(w, h), x = c.getContext('2d');
  x.fillStyle = '#e9e5da'; x.fillRect(0, 0, w, h);
  x.fillStyle = color; x.fillRect(0, 0, w, 150);
  x.fillStyle = '#fff'; x.font = '900 86px Arial, sans-serif'; x.textBaseline = 'middle';
  x.fillText(title, (w - x.measureText(title).width) / 2, 78);
  drawEmblem(x, w / 2, 290, 100, '#222');
  x.fillStyle = '#1b1b1b'; x.font = '700 40px Arial, sans-serif';
  lines.forEach((l, i) => x.fillText(l, (w - x.measureText(l).width) / 2, 450 + i * 52));
  x.strokeStyle = '#222'; x.lineWidth = 10; x.strokeRect(5, 5, w - 10, h - 10);
  grime(x, w, h, 0.1, 7);
  return c;
});

export const posterTexture = () => memo('poster', () => {
  const w = 512, h = 720, c = canvas(w, h), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#20262c'); g.addColorStop(1, '#0d1013');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  drawEmblem(x, w / 2, 260, 170, '#dfe6ea');
  x.fillStyle = '#dfe6ea'; x.font = '900 64px Arial, sans-serif'; x.textBaseline = 'middle';
  ['SECURE.', 'CONTAIN.', 'PROTECT.'].forEach((t, i) => x.fillText(t, (w - x.measureText(t).width) / 2, 510 + i * 66));
  grime(x, w, h, 0.18, 3);
  return c;
});

// Class-D jumpsuit chest number patch
export const dClassPatch = (n) => memo('d:' + n, () => {
  const c = canvas(256, 128), x = c.getContext('2d');
  x.fillStyle = '#efeae0'; x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#111'; x.font = '900 70px Arial, sans-serif'; x.textBaseline = 'middle';
  const t = 'D-' + n; x.fillText(t, (256 - x.measureText(t).width) / 2, 66);
  return c;
});

// MTF shoulder patch: Nine-Tailed Fox (stylised) + ε-11
export const mtfPatch = () => memo('mtf', () => {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#15191c'; x.beginPath(); x.arc(128, 128, 124, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#b8c2c8'; x.lineWidth = 6; x.beginPath(); x.arc(128, 128, 114, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#c9d2d8';
  for (let i = 0; i < 9; i++) { // nine tails
    const a = -Math.PI * 0.95 + (i / 8) * Math.PI * 0.9;
    x.save(); x.translate(128, 150); x.rotate(a); x.beginPath(); x.ellipse(0, -52, 9, 40, 0, 0, Math.PI * 2); x.fill(); x.restore();
  }
  x.beginPath(); x.moveTo(100, 160); x.lineTo(128, 118); x.lineTo(156, 160); x.lineTo(128, 196); x.closePath(); x.fill();
  x.fillStyle = '#15191c'; x.font = '900 30px Arial'; x.textBaseline = 'middle'; x.fillText('ε-11', 101, 162);
  return c;
});

export const bloodTexture = (seed = 1) => memo('blood' + seed, () => {
  const s = 256, c = canvas(s, s), x = c.getContext('2d');
  let r0 = seed * 7.13;
  const r = () => { r0 = (r0 * 16807 + 11) % 2147483647; return (r0 % 10000) / 10000; };
  x.fillStyle = 'rgba(70,4,4,0.95)';
  x.beginPath(); x.arc(128, 128, 50, 0, Math.PI * 2); x.fill();
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = 30 + r() * 90, rr = 3 + r() * 16;
    x.fillStyle = `rgba(${60 + r() * 30},2,2,${0.7 + r() * 0.3})`;
    x.beginPath(); x.ellipse(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, rr, rr * (0.5 + r()), a, 0, Math.PI * 2); x.fill();
  }
  return c;
});

export const bulletHoleTexture = () => memo('hole', () => {
  const s = 128, c = canvas(s, s), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 60);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.18, 'rgba(10,10,10,1)'); g.addColorStop(0.3, 'rgba(40,36,32,0.8)'); g.addColorStop(1, 'rgba(40,36,32,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  x.strokeStyle = 'rgba(20,20,20,0.6)'; x.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) { const a = i * 0.7 + 0.3; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(a) * (18 + (i % 3) * 8), 64 + Math.sin(a) * (18 + (i % 3) * 8)); x.stroke(); }
  return c;
});

// 173's crude painted face (Krylon spray paint: red and green)
export const face173Texture = () => memo('face173', () => {
  const s = 512, c = canvas(s, s), x = c.getContext('2d');
  x.fillStyle = '#b8b1a3'; x.fillRect(0, 0, s, s);
  const spray = (fn, col) => { x.save(); x.strokeStyle = col; x.fillStyle = col; x.lineCap = 'round'; x.shadowColor = col; x.shadowBlur = 14; fn(); x.restore(); };
  spray(() => { x.lineWidth = 26; x.beginPath(); x.ellipse(180, 210, 55, 42, -0.2, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.ellipse(335, 205, 55, 44, 0.25, 0, Math.PI * 2); x.stroke(); }, '#1f7a3a');
  spray(() => { x.beginPath(); x.arc(180, 212, 16, 0, Math.PI * 2); x.fill(); x.beginPath(); x.arc(335, 207, 16, 0, Math.PI * 2); x.fill(); }, '#111');
  spray(() => { x.lineWidth = 22; x.beginPath(); x.moveTo(150, 360); x.quadraticCurveTo(260, 330, 370, 365); x.quadraticCurveTo(260, 430, 150, 360); x.stroke(); for (let i = 0; i < 7; i++) { x.lineWidth = 8; x.beginPath(); x.moveTo(170 + i * 30, 355); x.lineTo(170 + i * 30, 395); x.stroke(); } }, '#9a1616');
  spray(() => { x.lineWidth = 12; x.beginPath(); x.moveTo(120, 140); x.lineTo(230, 160); x.moveTo(290, 158); x.lineTo(400, 130); x.stroke(); }, '#9a1616');
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '154,22,22' : '31,122,58'},${Math.random() * 0.5})`; x.beginPath(); x.arc(Math.random() * s, Math.random() * s, Math.random() * 5, 0, 7); x.fill(); }
  grime(x, s, s, 0.25, 11);
  return c;
});

// Updatable terminal screen (call .draw(lines) then set .dirty = true)
export function terminalTexture(title) {
  const c = canvas(512, 320), x = c.getContext('2d');
  c.draw = (lines, accent = '#39ff9a') => {
    x.fillStyle = '#031208'; x.fillRect(0, 0, 512, 320);
    x.fillStyle = accent; x.font = '700 26px "Courier New", monospace';
    x.fillText(title, 20, 40);
    x.fillRect(20, 52, 472, 3);
    x.font = '22px "Courier New", monospace';
    lines.forEach((l, i) => x.fillText(l, 20, 90 + i * 30));
    for (let y = 0; y < 320; y += 4) { x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, y, 512, 2); }
    c.dirty = true;
  };
  c.draw(['SYSTEM LOCKDOWN', 'AWAITING OVERRIDE']);
  return c;
}

export const numberPlate = (text, bg = '#d9d4c7', fg = '#1c1c1c') => memo('plate:' + text + bg, () => {
  const c = canvas(256, 128), x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 256, 128); x.fillStyle = fg; x.font = '900 64px Arial, sans-serif'; x.textBaseline = 'middle';
  x.fillText(text, (256 - x.measureText(text).width) / 2, 68); grime(x, 256, 128, 0.12, text.length + 3);
  return c;
});
