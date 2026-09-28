// ShapeForge Engine — public API.
export * from './math.js';
export * from './geometry.js';
export * from './modifiers.js';
export * from './scene.js';
export * from './skeleton.js';
export * from './animation.js';
export * from './character.js';
export * from './renderer.js';
export * from './controls.js';
export * from './particles.js';
export * from './io.js';
export * from './ik.js';
export * from './gait.js';
export * from './debug.js';
export * from './choreo.js';

// Minimal game loop helper: calls update(dt, time) then render every frame.
export function runLoop(update) {
  let last = performance.now(), stopped = false;
  const frame = (now) => {
    if (stopped) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    update(dt, now / 1000);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return () => { stopped = true; };
}
