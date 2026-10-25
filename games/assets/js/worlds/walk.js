/*
 * The walk-around world behind the 3D versions of Lumen Garden, Starling Observatory and
 * Cloudpath Cartographer. The worlds are the original 3D games (removed in commit 04ebfa8),
 * brought back as an option next to the 2D boards.
 *
 * W A S D or the arrow keys walk (Shift to hurry), the mouse looks around once the pointer is
 * locked, and a click picks whatever is under the crosshair. A Walk runs inside the game's World
 * (brain-games.js), so Pause, Escape, switching tabs and Exit behave exactly as they do in 2D.
 * three.js is passed in (T), so these files never download it themselves.
 */
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const mat = (T, color, emissive = color, power = 0, roughness = 0.68, metalness = 0.05) => new T.MeshStandardMaterial({ color, emissive, emissiveIntensity: power, roughness, metalness });

// A name tag that floats in the world and always faces you.
export function label(T, text, color = '#fff7e8') {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '600 40px "DM Sans", sans-serif';
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 44;
  c.height = 68;
  g.font = font;
  g.fillStyle = 'rgba(6, 10, 24, .72)';
  if (g.roundRect) { g.beginPath(); g.roundRect(0, 0, c.width, c.height, 34); g.fill(); } else g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 22, 36);
  const map = new T.CanvasTexture(c);
  map.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(new T.SpriteMaterial({ map, transparent: true, depthWrite: false }));
  sprite.scale.set((c.width / c.height) * 0.42, 0.42, 1);
  return sprite;
}

// Which way each key moves you: [forward, right].
const MOVES = { w: [1, 0], arrowup: [1, 0], s: [-1, 0], arrowdown: [-1, 0], a: [0, -1], arrowleft: [0, -1], d: [0, 1], arrowright: [0, 1] };

export class Walk {
  // o: { bounds: { x: [min, max], z: [min, max] }, speed, fov, far, exposure, pitch: [min, max] }
  constructor(T, world, o) {
    this.T = T;
    this.world = world;
    this.o = { fov: 68, far: 100, speed: 3.5, exposure: 1.2, pitch: [-1.1, 1.05], ...o };
    // Throws when the browser can't make a WebGL context; brain-games.js then offers 2D instead.
    this.renderer = new T.WebGLRenderer({ antialias: !reduceMotion, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, reduceMotion ? 1 : 1.7));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.o.exposure;
    this.canvas = this.renderer.domElement;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(this.o.fov, 1, 0.08, this.o.far);
    this.clock = new T.Clock();
    this.ray = new T.Raycaster();
    this.up = new T.Vector3(0, 1, 0);
    this.clickables = [];
    this.keys = new Set();
    this.locked = false;
    this.yaw = 0;
    this.pitch = 0;
    this.raf = 0;
    this.onPick = null;
    this.listeners = [];
    world.walk = this; // the World disposes it when the game moves on or closes
    this.listen(window, 'resize', () => this.resize());
    this.listen(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.$('[data-enter]')?.toggleAttribute('hidden', this.locked);
    });
    this.listen(document, 'mousemove', (e) => {
      if (!this.locked || world.paused) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = T.MathUtils.clamp(this.pitch - e.movementY * 0.0018, ...this.o.pitch);
    });
    this.listen(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    this.listen(window, 'blur', () => this.keys.clear());
    this.listen(this.canvas, 'mousedown', () => this.lock());
    this.listen(this.canvas, 'click', () => { if (!world.paused && this.onPick) this.onPick(this.aim()); });
    // brain-games.js passes key presses here (and not while paused).
    this.keyHandler = world.keyHandler = (e) => {
      const k = e.key.toLowerCase();
      if (k in MOVES || k === 'shift') { this.keys.add(k); e.preventDefault(); }
    };
  }
  listen(target, type, fn) { target.addEventListener(type, fn); this.listeners.push([target, type, fn]); }
  $(sel) { return this.world.host.querySelector(sel); }
  lock() {
    if (this.locked || this.world.paused || !this.canvas.requestPointerLock) return;
    const p = this.canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { /* the browser said no; clicking again will retry */ });
  }
  // The shared parts of every 3D screen: the goal box, the status line, the crosshair and the keys.
  hud({ goal, status, extra = '' }) {
    return `<div class="w3-goal" data-goal>${goal}</div>
      <p class="w3-status" data-status aria-live="polite">${esc(status)}</p>${extra}
      <button class="w3-enter" data-enter>Click here to look around</button>
      <div class="w3-cross" aria-hidden="true"></div>
      <p class="w3-keys"><b>W A S D</b> walk · <b>mouse</b> look · <b>click</b> pick · <b>Esc</b> frees the mouse</p>`;
  }
  mount(hud) {
    this.world.mount3D(this.canvas, hud);
    this.$('[data-enter]').addEventListener('click', () => this.lock());
    this.resize();
  }
  goal(html) { const el = this.$('[data-goal]'); if (el) el.innerHTML = html; }
  status(text) { const el = this.$('[data-status]'); if (el) el.textContent = text; }
  place([x, y, z], yaw = 0, pitch = 0) { this.camera.position.set(x, y, z); this.yaw = yaw; this.pitch = pitch; }
  // What's under the crosshair (only things registered in clickables count).
  aim() {
    this.ray.setFromCamera(new this.T.Vector2(0, 0), this.camera);
    return this.ray.intersectObjects(this.clickables, false)[0] || null;
  }
  resize() {
    const { host } = this.world;
    if (host.hidden) return;
    this.renderer.setSize(host.clientWidth, host.clientHeight, false);
    this.camera.aspect = host.clientWidth / host.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
  // Runs every frame. `update(dt, now)` animates the world; it's skipped while paused.
  start(update) {
    this.clock.start();
    const frame = () => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      if (this.world.paused) {
        this.keys.clear();
        if (this.locked) document.exitPointerLock();
        return;
      }
      this.move(dt);
      if (update) update(dt, performance.now());
      this.renderer.render(this.scene, this.camera);
    };
    frame();
  }
  move(dt) {
    const { T } = this, p = this.camera.position, { x, z } = this.o.bounds;
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    let f = 0, r = 0;
    for (const k of this.keys) if (MOVES[k]) { f += MOVES[k][0]; r += MOVES[k][1]; }
    if (!f && !r) return;
    const step = this.o.speed * (this.keys.has('shift') ? 1.75 : 1) * dt;
    p.addScaledVector(new T.Vector3(0, 0, -1).applyAxisAngle(this.up, this.yaw), f * step);
    p.addScaledVector(new T.Vector3(1, 0, 0).applyAxisAngle(this.up, this.yaw), r * step);
    p.x = T.MathUtils.clamp(p.x, x[0], x[1]);
    p.z = T.MathUtils.clamp(p.z, z[0], z[1]);
  }
  // Frees the graphics memory: browsers only allow a handful of live WebGL contexts.
  dispose() {
    cancelAnimationFrame(this.raf);
    this.listeners.forEach(([target, type, fn]) => target.removeEventListener(type, fn));
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (this.world.keyHandler === this.keyHandler) this.world.keyHandler = null;
    this.onPick = null;
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      [].concat(o.material || []).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
