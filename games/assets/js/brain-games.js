/*
 * The six brain games. Each one is inspired by a task used in cognitive training research with
 * people after cancer treatment. Most adapt as you play: harder after you succeed and easier
 * after you miss. Sessions are a few minutes long.
 *
 *   lumen      Lumen Garden            spatial working memory span (forward, then backward)
 *   starling   Starling Observatory    speed of processing (brief flashes, center + periphery)
 *   cloudpath  Cloudpath Cartographer  planning (Tower of London puzzles)
 *   echo       Story Echo              verbal memory (word lists, linking strategy)
 *   rhythm     Finger Rhythm           finger tapping with a hidden repeating sequence
 *   signal     Signal Match            mental flexibility (switching between two sorting rules)
 *
 * Story Echo, Finger Rhythm and Signal Match have two modes. Gentle (the default) has no timer:
 * the game waits for you and shows no speed numbers. Challenge keeps the adaptive pace, with
 * safe limits, and keeps speed numbers behind "Show details". Every game can be paused.
 *
 * Opening a game: a click on any [data-game] element (the library cards, ?play= links).
 * Levels set where a session starts; results and personal bests (per level and mode) are shown
 * at the end. The next session on a level picks up one step easier than where the last one
 * ended, unless the player chooses Start fresh. Every finished session is saved to the account.
 * Lumen, Starling and Cloudpath can also be played as a walk-around 3D world (worlds/*.js, the
 * original 3D games). 2D is the default and always there; the 3D choice is remembered per game,
 * offered only on computers with a mouse or trackpad, and off in Calm mode. The 3D worlds are
 * simpler explore versions, not the research tasks, so their bests are kept apart (the "-3d"
 * keys) and they aren't sent to the account.
 * three.js draws the backdrop and the 3D worlds, so it is loaded on demand: if it can't download
 * (offline, a blocked network), the games still open on their plain background.
 */
// three.js is loaded only when a game opens with 3D on (not in calm mode).
let THREE = null;
const loadThree = () => (THREE ? Promise.resolve(THREE) : import('three').then((m) => (THREE = m), () => null));

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/* ---------- personal bests and Gentle / Challenge choice (this browser) ---------- */

// Storage keys keep the old "reframe" prefix so nobody loses their saved progress.
const BEST = 'reframe.best';
const readJSON = (name) => { try { return JSON.parse(localStorage.getItem(name) || '{}') || {}; } catch (_) { return {}; } };
const writeJSON = (name, value) => { try { localStorage.setItem(name, JSON.stringify(value)); } catch (_) { /* storage unavailable */ } };
// Bests and carried difficulty are kept per game, level and mode, so a level 1 score never
// stands as the best to beat on level 3, and Gentle never competes with Challenge. A level that
// moved keeps its old name through `save`, so its bests and carry move with it.
const keyFor = (game, level, mode) => `${game}-${level.save || `L${level.index + 1}`}${mode ? `-${mode}` : ''}`;
// Saves `value` if it beats the old best (higher is better unless lowerIsBetter). Returns { best, isNew }.
function recordBest(name, value, lowerIsBetter) {
  const all = readJSON(BEST);
  const old = all[name];
  const isNew = old === undefined || (lowerIsBetter ? value < old : value > old);
  if (isNew) { all[name] = value; writeJSON(BEST, all); }
  return { best: isNew ? value : old, isNew };
}

// Where the adaptive difficulty ended last time (span, flash length, route length...). The next
// session on that level starts one step easier than that, unless the player chooses Start fresh.
const CARRY = 'chemoasis.carry';
const carried = (name) => { const v = readJSON(CARRY)[name]; return Number.isFinite(v) ? v : undefined; };
function saveCarry(name, value) { const all = readJSON(CARRY); all[name] = value; writeJSON(CARRY, all); }
function forgetCarry(name) { const all = readJSON(CARRY); delete all[name]; writeJSON(CARRY, all); }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const MODE = 'chemoasis.mode';
const savedMode = (game) => (readJSON(MODE)[game] === 'challenge' ? 'challenge' : 'gentle');
function saveMode(game, mode) { const all = readJSON(MODE); all[game] = mode; writeJSON(MODE, all); }

// 2D board or 3D world, remembered per game. 2D unless the player picked 3D and 3D is possible here.
const VIEW = 'chemoasis.view';
const hasMouse = () => matchMedia('(any-pointer: fine)').matches && 'requestPointerLock' in Element.prototype;
const why3DOff = () => (window.reframeCalm ? '3D worlds are off in Calm mode. Turn Calm mode off in the top bar to use them.' : '');
const viewOf = (game) => (game.w3 && hasMouse() && !why3DOff() && readJSON(VIEW)[game.id] === '3d' ? '3d' : '2d');
function saveView(game, view) { const all = readJSON(VIEW); all[game] = view; writeJSON(VIEW, all); }
const W3 = { lumen: () => import('./worlds/lumen.js?v=2'), starling: () => import('./worlds/starling.js?v=2'), cloudpath: () => import('./worlds/cloudpath.js?v=2') };

/* ---------- the world around each game: a calm 3D backdrop and a panel ---------- */

class World {
  constructor(game) {
    this.game = game;
    this.host = document.createElement('section');
    this.host.className = 'new-world brain-game';
    this.host.id = `${game.id}-3d`;
    this.host.hidden = true;
    this.host.setAttribute('aria-label', `${game.title}`);
    this.host.style.setProperty('--tone', game.tone);
    document.body.append(this.host);
    this.raf = 0;
    this.run = 0; // bumped on close, so a session that's still running stops
    this.playing = false; // a session is under way (shows the Pause button)
    this.paused = false;
    this.pausedAt = 0;
    this.pausedTotal = 0; // time spent paused, left out of world.now()
  }
  // The title bar on every screen. While a session is under way it has How to play and Pause,
  // which both open the pause card (it shows the How to play box too).
  header() {
    const kicker = this.walk ? `${this.game.kicker} · 3D world` : this.game.kicker;
    return `<header class="world-top"><div><p class="world-kicker">${esc(kicker)}</p><h2>${esc(this.game.title)}</h2></div><div class="world-actions">${this.playing ? '<button data-action="how">How to play</button><button data-action="pause">Pause</button>' : ''}<button data-action="exit">Exit game</button></div></header>`;
  }
  wire() {
    this.host.querySelector('[data-action="exit"]').onclick = () => this.close();
    this.host.querySelectorAll('[data-action="pause"], [data-action="how"]').forEach((b) => { b.onclick = () => this.pause(); });
    if (this.paused) this.showPause();
  }
  render(body) {
    this.leave3D();
    this.host.innerHTML = `<div class="world-panel">${this.header()}${this.playing ? '<div class="bg-progress" aria-hidden="true"><i></i></div>' : ''}${body}</div>`;
    this.host.scrollTop = 0; // each new screen starts at its top, not where the last one was scrolled to
    if (this.renderer) this.host.prepend(this.renderer.domElement);
    this.wire();
    this.progress();
    return this.host.querySelector('.world-panel');
  }
  // A 3D world (worlds/walk.js) takes the whole screen: its canvas, the title bar and its HUD.
  mount3D(canvas, hud) {
    this.dispose(); // the backdrop's graphics memory goes to the world instead
    this.host.classList.add('is-3d');
    this.host.innerHTML = `<div class="w3-hud">${this.header()}${hud}</div>`;
    this.host.prepend(canvas);
    this.wire();
  }
  leave3D() {
    if (!this.walk) return;
    this.walk.dispose();
    this.walk = null;
    this.host.classList.remove('is-3d');
    if (!this.host.hidden) this.backdrop();
  }
  // How far through the session: `world.progress(3, 14)` fills the bar under the title.
  progress(done, total) {
    if (total) this.prog = done / total;
    const bar = this.host.querySelector('.bg-progress i');
    if (bar) bar.style.width = `${Math.round((this.prog || 0) * 100)}%`;
  }
  async scene() {
    if (this.renderer || this.sceneTried || window.reframeCalm || this.walk) return; // calm mode: plain background, no 3D
    this.sceneTried = true;
    const T = await loadThree();
    if (!T) return; // no 3D: the game still works on its plain background
    if (this.host.hidden || this.walk) { this.sceneTried = false; return; } // closed (or a 3D world opened) while three.js loaded
    try {
      this.renderer = new T.WebGLRenderer({ antialias: !reduceMotion, alpha: true, powerPreference: 'high-performance' });
    } catch (_) { return; }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.host.prepend(this.renderer.domElement);
    this.scene3 = new T.Scene();
    this.camera = new T.PerspectiveCamera(55, 1, 0.1, 100);
    this.camera.position.set(0, 1.2, 10);
    this.scene3.add(new T.HemisphereLight('#c9e9ff', '#101522', 1.7));
    const key = new T.PointLight(this.game.tone, 4, 28);
    key.position.set(0, 5, 3);
    this.scene3.add(key);
    this.group = new T.Group();
    this.scene3.add(this.group);
    const geometry = this.geometry = {
      lumen: () => new T.IcosahedronGeometry(1.1, 0),
      starling: () => new T.OctahedronGeometry(1.1),
      cloudpath: () => new T.DodecahedronGeometry(1.1),
      echo: () => new T.TorusGeometry(0.9, 0.28, 12, 32),
      rhythm: () => new T.CylinderGeometry(0.8, 0.8, 0.18, 32),
      signal: () => new T.TetrahedronGeometry(1.2)
    }[this.game.id]();
    for (let i = 0; i < 6; i++) {
      const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ color: this.game.tone, emissive: this.game.tone, emissiveIntensity: 0.3, roughness: 0.35, metalness: 0.2, transparent: true, opacity: 0.4, flatShading: true }));
      const a = (i / 6) * Math.PI * 2;
      mesh.position.set(Math.cos(a) * 6, Math.sin(a * 1.7) * 2 + 1, -4 - (i % 2) * 2);
      mesh.rotation.set(a, a * 0.7, 0);
      this.group.add(mesh);
    }
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
  }
  // Frees the backdrop's graphics memory when the game closes; opening it again rebuilds it.
  // Browsers only allow a handful of live WebGL contexts, so six games left open would run out.
  dispose() {
    if (!this.renderer) return;
    removeEventListener('resize', this.onResize);
    this.group.children.forEach((m) => m.material.dispose());
    this.geometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.renderer = this.scene3 = this.camera = this.group = this.geometry = this.onResize = null;
    this.sceneTried = false;
  }
  resize() {
    if (!this.renderer || this.host.hidden) return;
    const { clientWidth: w, clientHeight: h } = this.host;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  open() {
    this.host.hidden = false;
    document.body.style.overflow = 'hidden';
    // Keep Tab inside the game: everything else on the page is inert while it's open.
    this.inerted = [...document.body.children].filter((el) => el !== this.host && !el.inert);
    this.inerted.forEach((el) => { el.inert = true; });
    this.backdrop();
  }
  // The game opens straight away; the backdrop joins in once three.js has loaded.
  backdrop() {
    this.scene().then(() => {
      if (this.host.hidden || !this.renderer) return;
      this.resize();
      cancelAnimationFrame(this.raf);
      this.tick();
    });
  }
  tick() {
    if (!this.renderer || this.host.hidden) return;
    this.raf = requestAnimationFrame(() => this.tick());
    if (!reduceMotion) { this.group.rotation.y += 0.0015; this.group.children.forEach((m, i) => { m.rotation.x += 0.002 + i * 0.0003; }); }
    this.renderer.render(this.scene3, this.camera);
  }
  // A clock that stops while the game is paused. Use it for anything timed.
  now() { return performance.now() - this.pausedTotal - (this.paused ? performance.now() - this.pausedAt : 0); }
  // Waits `ms` of unpaused time. Resolves early if the game is closed.
  sleep(ms) {
    const end = this.now() + ms;
    return new Promise((resolve) => {
      const step = () => {
        if (this.host.hidden) return resolve();
        const left = end - this.now();
        if (left <= 0) return resolve();
        setTimeout(step, this.paused ? 150 : Math.min(left, 150));
      };
      step();
    });
  }
  pause() {
    if (this.paused || !this.playing || this.host.hidden) return;
    this.paused = true;
    this.pausedAt = performance.now();
    // Freeze anything animating, such as Signal Match's timer bar.
    this.frozen = (this.host.getAnimations ? this.host.getAnimations({ subtree: true }) : []);
    this.frozen.forEach((a) => a.pause());
    window.speechSynthesis && speechSynthesis.cancel(); // Story Echo's read-aloud stops too
    this.showPause();
  }
  showPause() {
    this.host.querySelector(':scope > .bg-pause')?.remove();
    const el = document.createElement('div');
    el.className = 'bg-pause';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Paused');
    el.innerHTML = `<div class="bg-pause-card"><h3>Paused</h3><p>Take as long as you need. The game will wait for you.</p>
      ${this.howLines ? GameLevels.howBox(this.howLines) : ''}
      <div class="world-controls"><button data-resume class="bg-primary">Resume</button><button data-exit>Exit game</button></div></div>`;
    el.querySelector('[data-resume]').onclick = () => this.resume();
    el.querySelector('[data-exit]').onclick = () => this.close();
    this.host.append(el);
    el.querySelector('[data-resume]').focus({ preventScroll: true });
  }
  resume() {
    if (!this.paused) return;
    this.pausedTotal += performance.now() - this.pausedAt;
    this.paused = false;
    (this.frozen || []).forEach((a) => { try { a.play(); } catch (_) { /* animation already gone */ } });
    this.frozen = null;
    this.host.querySelector(':scope > .bg-pause')?.remove();
  }
  close() {
    this.run++;
    this.resume();
    this.playing = false;
    this.keyHandler = null; // a game's keys (Space for Next word, F and J...) end with the game
    cancelAnimationFrame(this.raf);
    this.host.hidden = true;
    this.leave3D();
    this.dispose();
    GameLevels.close(this.host);
    (this.inerted || []).forEach((el) => { el.inert = false; });
    this.inerted = null;
    // Back to the card or button that opened the game, so keyboard players keep their place.
    if (this.opener && this.opener.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
    // Back to the games library if it's open underneath, otherwise back to the page.
    document.body.style.overflow = document.querySelector('#experience-view:not([hidden])') ? 'hidden' : '';
    window.speechSynthesis && speechSynthesis.cancel();
  }
}

/* ---------- shared screens ---------- */

// The start card before a session: the How to play box first, then the Gentle / Challenge choice
// for games that have one. `game` is the 2D game or its 3D world (game.w3). Resolves
// { go, mode, startAt }: go is true for Start, false for All levels. startAt is where the
// adaptive difficulty begins, picked up from last time (undefined: the level's start).
function intro(world, game, level) {
  let mode = game.modes ? savedMode(game.id) : null;
  let fresh = false;
  const panel = world.render(`<main class="world-card bg-card">
    <p class="world-note">Level ${level.index + 1} · ${esc(level.name)}${game.is3D ? ' · 3D world' : ''}</p>
    <div data-how></div>
    ${game.modes ? `<div class="bg-modes" role="group" aria-label="Mode">
      <button data-mode="gentle">Gentle<small>No timer. The game waits for you.</small></button>
      <button data-mode="challenge">Challenge<small>${esc(game.challengeNote)}</small></button>
    </div>` : ''}
    <p class="bg-carry" data-carry hidden><span data-carry-text></span> <button data-fresh>Start fresh</button></p>
    ${game.safety ? `<p class="bg-safety">${game.safety}</p>` : ''}
    <div class="world-controls"><button data-go class="bg-primary">Start</button><button data-levels>All levels</button></div>
  </main>`);
  const startAt = () => {
    const last = fresh || !game.carry ? undefined : carried(keyFor(game.id, level, mode));
    return last === undefined ? undefined : game.carry.from(last, level, mode);
  };
  const show = () => {
    panel.querySelector('[data-how]').innerHTML = GameLevels.howBox(game.how(level, mode), game.meta && game.meta(level, mode));
    panel.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    const from = startAt();
    panel.querySelector('[data-carry]').hidden = from === undefined;
    if (from !== undefined) panel.querySelector('[data-carry-text]').textContent = `Picking up near where you finished last time: ${game.carry.label(from)}.`;
  };
  panel.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { mode = b.dataset.mode; saveMode(game.id, mode); show(); }; });
  panel.querySelector('[data-fresh]').onclick = () => { fresh = true; show(); panel.querySelector('[data-go]').focus({ preventScroll: true }); };
  show();
  return new Promise((resolve) => {
    panel.querySelector('[data-go]').onclick = () => resolve({ go: true, mode, startAt: startAt() });
    panel.querySelector('[data-levels]').onclick = () => resolve({ go: false });
    panel.querySelector('[data-go]').focus({ preventScroll: true });
  });
}

// The level-complete screen. `lines` are the friendly results; `details` (speed numbers and
// the like) sit behind "Show details". Every finished session is saved to the account for the
// Your games page; `score` is null when there is no number to chart (Gentle mode keeps none).
// `low` marks a hard session: the screen suggests staying on the level instead of moving on.
// Results are saved under the level's id, like its tick and bests (Lumen's Backwards is 3, once level 4).
function finish(world, game, level, lines, bestText = '', details = [], score = null, low = false) {
  if (window.Account && Account.auth) Account.auth.recordResult(game.id, GameLevels.idOf(level, level.index), score, world.mode || undefined);
  GameLevels.done({
    host: world.host, game: game.id, level: level.index, levels: game.levels, low,
    message: [...lines, bestText, 'These scores track your practice, not your health.'].filter(Boolean).join(' '),
    details: details.filter(Boolean),
    onPick: (n) => start(game, n), onLevels: () => levelsFor(game), onExit: () => world.close()
  });
}

// The level-complete screen after a 3D world. Its tick and best stay in this browser: the
// account and the Your games charts only track the 2D research tasks.
function finish3D(world, game, level, lines, bestText = '') {
  GameLevels.done({
    host: world.host, game: `${game.id}-3d`, sync: false, level: level.index, levels: game.w3.levels,
    message: [...lines, bestText].filter(Boolean).join(' '),
    onPick: (n) => start(game, n), onLevels: () => levelsFor(game), onExit: () => world.close()
  });
}
// "Personal best" wording for the 3D worlds, where fewer is better.
function best3D(world, value, unit) {
  const { best, isNew } = recordBest(world.saveAs, value, true);
  return isNew ? 'That’s a new personal best on this level.' : `Personal best on this level: ${best} ${unit}.`;
}

function levelsFor(game, focusView) {
  const world = worlds[game.id];
  world.render('');
  const view = viewOf(game), def = view === '3d' ? game.w3 : game;
  GameLevels.pick({
    host: world.host, game: view === '3d' ? `${game.id}-3d` : game.id, title: game.title,
    kicker: `${game.kicker} · choose a level`, levels: def.levels, how: def.summary, focusView,
    // The 2D / 3D choice: only on computers with a mouse or trackpad, and grayed out in Calm mode.
    views: game.w3 && hasMouse() ? { current: view, off: why3DOff(), onChange: (v) => { saveView(game.id, v); levelsFor(game, true); } } : null,
    ...(view === '3d'
      ? { lede: 'Fixed levels, at your own pace.', note: 'The 3D world is a simpler explore version of this game, for fun and practice. It isn’t based on a research task, and it isn’t a treatment.' }
      : { about: game.about }),
    onPick: (n) => start(game, n), onExit: () => world.close()
  });
}

async function start(game, n) {
  const world = worlds[game.id];
  const run = ++world.run;
  world.keyHandler = null; // nothing from an earlier session listens to keys any more
  const in3D = viewOf(game) === '3d', def = in3D ? game.w3 : game;
  const level = { ...def.levels[n], index: n };
  const alive = () => world.run === run && !world.host.hidden;
  const { go, mode, startAt } = await intro(world, def, level);
  if (!alive()) return;
  if (!go) return levelsFor(game);
  // A play counts for the recommender once a session starts, not when a card is merely opened.
  // Games opened from the Your games page (?play=) were already counted there.
  if (world.logPlay) { world.logPlay = false; if (window.Account && Account.auth) Account.auth.recordPlay(game.id); }
  world.playing = true;
  world.mode = in3D ? '3d' : mode;
  world.saveAs = keyFor(game.id, level, world.mode); // the name this session's best and carry use
  world.howLines = def.how(level, mode);
  world.prog = 0;
  try {
    await def.play(world, level, alive, mode, startAt);
  } finally {
    if (world.run === run) { world.playing = false; world.howLines = null; world.host.querySelectorAll('[data-action="pause"], [data-action="how"]').forEach((b) => b.remove()); }
  }
}

// Opens game `id`'s 3D world and plays one level; resolves its result, or null if it closed.
// If three.js or WebGL isn't available, it says so and offers the 2D board instead.
async function play3D(world, game, level, alive) {
  const [T, mod] = await Promise.all([loadThree(), W3[game.id]().catch(() => null)]);
  if (!alive()) return null;
  try {
    if (T && mod) return await mod.play(T, world, level, alive);
  } catch (_) { world.leave3D(); /* no WebGL context: fall through to the message */ }
  world.playing = false;
  const panel = world.render(`<main class="world-card bg-card"><p class="world-note">3D world</p>
    <p>The 3D world couldn’t start on this device. The 2D board works everywhere.</p>
    <div class="world-controls"><button data-2d class="bg-primary">Play in 2D</button></div></main>`);
  panel.querySelector('[data-2d]').onclick = () => { saveView(game.id, '2d'); levelsFor(game); };
  panel.querySelector('[data-2d]').focus({ preventScroll: true });
  return null;
}

/* ======================================================================
 * 1. Lumen Garden: spatial working memory span (like the Corsi blocks task)
 * ==================================================================== */

const lumen = {
  id: 'lumen', title: 'Lumen Garden', kicker: 'Working memory', tone: '#c58cff',
  about: { text: 'Practices working memory: holding a short sequence in mind and replaying it. Inspired by span tasks used in research. A small pilot with childhood cancer survivors found gains on similar tasks; results in adults after cancer are early and mixed, and this game itself hasn’t been studied.', cite: 'Hardy et al., Psycho-Oncology 2013', href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4820841/' },
  levels: [
    // span: where paths start; min and max: how short and long they get, here and when picked up next time.
    { name: 'Forward paths', desc: '3 × 3 garden. Paths of 2 to 5 lights, starting at 3.', size: 3, span: 3, min: 2, max: 5, on: 650 },
    { name: 'Longer paths', desc: '3 × 3 garden. Paths of 3 to 8 lights, starting at 4, a little faster.', size: 3, span: 4, min: 3, max: 8, on: 520 },
    // Backwards was level 4 until levels went from four to three, so it still saves as L4.
    { name: 'Backwards', desc: '3 × 3 garden. Tap the path in reverse order, from 3 lights.', size: 3, span: 3, min: 2, max: 7, on: 650, backward: true, save: 'L4' }
  ],
  summary: ['Watch the flowers light up, one at a time.', 'Then tap them in the same order. On the last level, tap them backwards.'],
  how: (l) => ['Watch the flowers light up, one at a time.', `Then tap them in the <b>${l.backward ? 'reverse' : 'same'}</b> order${l.backward ? ' (last one first)' : ''}.`],
  meta: () => '14 paths · about 3 minutes · each right answer adds a flower',
  carry: { from: (v, l) => clamp(v - 1, l.min, l.max), label: (v) => `paths of ${v} flowers` },
  async play(world, level, alive, mode, startAt) {
    const TRIALS = 14;
    let span = startAt ?? level.span, longest = 0, correct = 0;
    const cells = level.size * level.size;
    const panel = world.render(`<main class="world-card bg-card">
      <p class="world-note" data-info></p><p class="game-status" data-status></p>
      <div class="span-grid" style="--n:${level.size}">${Array.from({ length: cells }, (_, i) => `<button data-cell="${i}" aria-label="Flower ${i + 1}" disabled>✿</button>`).join('')}</div>
    </main>`);
    const buttons = [...panel.querySelectorAll('[data-cell]')];
    const status = (t) => { panel.querySelector('[data-status]').textContent = t; };
    for (let trial = 0; trial < TRIALS && alive(); trial++) {
      panel.querySelector('[data-info]').textContent = `Path ${trial + 1} of ${TRIALS} · ${span} flowers${level.backward ? ' · backwards' : ''}`;
      world.progress(trial, TRIALS);
      const seq = [];
      while (seq.length < span) { const c = Math.floor(Math.random() * cells); if (c !== seq[seq.length - 1]) seq.push(c); }
      const had = buttons.indexOf(document.activeElement); // keyboard players get their place back below
      buttons.forEach((b) => { b.disabled = true; b.className = ''; });
      status('Watch…');
      await world.sleep(700);
      for (const c of seq) {
        if (!alive()) return;
        buttons[c].classList.add('lit');
        await world.sleep(level.on);
        buttons[c].classList.remove('lit');
        await world.sleep(220);
      }
      const want = level.backward ? seq.slice().reverse() : seq;
      status(level.backward ? 'Your turn: tap them in reverse order.' : 'Your turn: tap them in the same order.');
      buttons.forEach((b) => { b.disabled = false; });
      buttons[Math.max(0, had)].focus({ preventScroll: true });
      const ok = await new Promise((resolve) => {
        let step = 0;
        buttons.forEach((b, i) => {
          b.onclick = () => {
            b.classList.add('tap');
            setTimeout(() => b.classList.remove('tap'), 180);
            if (i !== want[step]) { buttons[want[step]].classList.add('hint'); resolve(false); return; }
            if (++step === want.length) resolve(true);
          };
        });
      });
      buttons.forEach((b) => { b.disabled = true; b.onclick = null; });
      if (ok) { correct++; longest = Math.max(longest, span); status(`Yes, ${span} in a row.`); span = Math.min(level.max, span + 1); buttons.forEach((b) => b.classList.add('bloom')); }
      else { status('Not quite. The next path is a little shorter.'); span = Math.max(level.min, span - 1); }
      await world.sleep(1000);
    }
    if (!alive()) return;
    saveCarry(world.saveAs, span);
    const { best, isNew } = longest ? recordBest(world.saveAs, longest) : { best: readJSON(BEST)[world.saveAs] };
    finish(world, lumen, level, [`Longest path you got right: ${longest} flowers${level.backward ? ' backwards' : ''}. Paths correct: ${correct} of ${TRIALS}.`], isNew ? 'That is a new personal best on this level!' : best ? `Personal best on this level: ${best} flowers.` : '', [], longest, correct < 5);
  }
};

lumen.w3 = {
  id: 'lumen', is3D: true,
  levels: [
    { name: 'Two lights', desc: 'Remember 2 plants in order. 15 seconds to look.', count: 2, secs: 15 },
    { name: 'Three lights', desc: 'Remember 3 plants in order. 15 seconds to look.', count: 3, secs: 15 },
    { name: 'Four lights', desc: 'Remember 4 plants in order. 20 seconds to look.', count: 4, secs: 20 }
  ],
  summary: ['Remember the plants shown at the top, in order. Then they hide.', 'Walk to each plant and click it, in that order.'],
  how: (l) => [`Remember the ${l.count} plants in the box, in order. They hide after ${l.secs} seconds.`, 'Walk up to each plant and click it, in that order. Forgot? <b>Show the path again</b> (or press <b>P</b>).'],
  meta: () => '<b>W A S D</b> walk · <b>mouse</b> look · <b>click</b> pick · <b>P</b> peek · no other timer',
  async play(world, level, alive) {
    const result = await play3D(world, lumen, level, alive);
    if (!result) return;
    const { mistakes, peeks } = result;
    const extra = [mistakes && `${mistakes} wrong ${mistakes === 1 ? 'pick' : 'picks'}`, peeks && `${peeks} ${peeks === 1 ? 'peek' : 'peeks'} at the path`].filter(Boolean);
    // Fewer is better, and a peek counts like a wrong pick, so peeking can't set an easy best.
    finish3D(world, lumen, level, [`You found ${level.count === 2 ? 'both plants' : `all ${level.count} plants`} in order${extra.length ? `, with ${extra.join(' and ')}` : ', with no wrong picks'}.`], best3D(world, mistakes + peeks, 'wrong picks and peeks'));
  }
};

/* ======================================================================
 * 2. Starling Observatory: speed of processing (useful field of view style)
 * ==================================================================== */

// The shortest flash. Lower than this is close to impossible on a tired or low-vision day.
const STARLING_FASTEST = 80;

const starling = {
  id: 'starling', title: 'Starling Observatory', kicker: 'Processing speed', tone: '#7fb8ff',
  about: {
    text: 'Practices taking in quick glimpses, in the center and at the edges of your vision. Inspired by speed-of-processing training used in research. An early trial with breast cancer survivors found gains compared with a waiting list, but a stricter later trial by the same team found no clear difference on thinking tests. This game itself hasn’t been studied.',
    cite: 'Von Ah et al., Breast Cancer Research and Treatment 2012', href: 'https://scholarworks.indianapolis.iu.edu/items/6103443c-9611-461c-adc1-1e42f0215fb2',
    more: [{ cite: 'Von Ah et al., Supportive Care in Cancer 2022', href: 'https://scholarworks.indianapolis.iu.edu/items/cc28c83f-bff2-4250-a944-e640a19b5526' }]
  },
  levels: [
    { name: 'Center', desc: 'Name the symbol that flashes in the center.', ring: false, clutter: false, start: 400 },
    { name: 'Center and edge', desc: 'Name the center symbol and find the comet at the edge.', ring: true, clutter: false, start: 450 },
    { name: 'Busy sky', desc: 'As before, with look-alike stars in the way.', ring: true, clutter: true, start: 500 }
  ],
  summary: ['Keep your eyes on the + in the middle. A symbol flashes there for a moment.', 'Pick which symbol it was. On later levels, also tap where the comet ☄ flashed at the edge.'],
  how: (l) => ['Keep your eyes on the + in the middle. A symbol flashes there for a moment.', `Pick which symbol it was${l.ring ? ', then tap where the comet ☄ flashed around the edge' : ''}.`],
  meta: () => '20 flashes · they get shorter as you get them right, and longer if you miss',
  carry: { from: (v) => Math.round(clamp(v * 1.25, STARLING_FASTEST, 800)), label: (v) => `flashes of about ${v} ms` },
  async play(world, level, alive, mode, startAt) {
    const TRIALS = 20;
    const SYMBOLS = [['☾', 'Moon'], ['✦', 'Star']];
    const begin = startAt ?? level.start;
    let shown = begin, streak = 0, right = 0;
    const history = [];
    const panel = world.render(`<main class="world-card bg-card">
      <p class="world-note" data-info></p>
      <div class="sky" data-sky><span class="sky-center" data-center>+</span>${Array.from({ length: 8 }, (_, i) => `<button class="sky-slot" data-slot="${i}" style="left:${(50 + 38 * Math.sin(i * Math.PI / 4)).toFixed(2)}%;top:${(50 - 38 * Math.cos(i * Math.PI / 4)).toFixed(2)}%" disabled aria-label="Edge position ${i + 1}"></button>`).join('')}<div class="sky-clutter" data-clutter></div></div>
      <p class="game-status" data-status></p>
      <div class="world-controls bg-choices" data-choices hidden>${SYMBOLS.map(([s, n], i) => `<button data-sym="${i}"><kbd class="bg-key">${i + 1}. </kbd>${s} ${n}</button>`).join('')}</div>
    </main>`);
    const $ = (sel) => panel.querySelector(sel);
    const slots = [...panel.querySelectorAll('[data-slot]')];
    const status = (t) => { $('[data-status]').textContent = t; };
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    for (let trial = 0; trial < TRIALS && alive(); trial++) {
      $('[data-info]').textContent = `Flash ${trial + 1} of ${TRIALS}`;
      world.progress(trial, TRIALS);
      const sym = Math.floor(Math.random() * 2), slot = Math.floor(Math.random() * 8);
      slots.forEach((s) => { s.disabled = true; s.className = 'sky-slot'; });
      // Show the picture for `shown` ms, timed to screen refreshes. A pause in the middle of a flash
      // (Escape, switching tabs) spoils it, so the same flash plays again once the game resumes.
      for (;;) {
        slots.forEach((s) => { s.textContent = ''; });
        $('[data-center]').textContent = '+';
        $('[data-clutter]').innerHTML = '';
        status('Eyes on the +');
        await world.sleep(700 + Math.random() * 500);
        if (!alive()) return;
        $('[data-center]').textContent = SYMBOLS[sym][0];
        if (level.ring) {
          slots[slot].textContent = '☄';
          if (level.clutter) {
            slots.forEach((s, i) => { if (i !== slot) s.textContent = '✧'; });
            $('[data-clutter]').innerHTML = Array.from({ length: 10 }, () => `<i style="left:${10 + Math.random() * 80}%;top:${10 + Math.random() * 80}%">✧</i>`).join('');
          }
        }
        const t0 = performance.now(), pausedBefore = world.pausedTotal;
        await frame();
        while (performance.now() - t0 < shown - 8 && !world.paused) await frame();
        if (!world.paused && world.pausedTotal === pausedBefore) break;
      }
      // Mask: cover everything with noise so the picture can't linger.
      $('[data-center]').textContent = '▩';
      slots.forEach((s) => { s.textContent = '▩'; });
      $('[data-clutter]').innerHTML = Array.from({ length: 16 }, () => `<i style="left:${Math.random() * 90}%;top:${Math.random() * 90}%">▩</i>`).join('');
      await world.sleep(250);
      $('[data-center]').textContent = '?';
      slots.forEach((s) => { s.textContent = ''; });
      $('[data-clutter]').innerHTML = '';
      status('Which symbol was in the center?');
      $('[data-choices]').hidden = false;
      if (panel.contains(document.activeElement) || document.activeElement === document.body) $('[data-sym="0"]').focus({ preventScroll: true });
      const symOk = await new Promise((resolve) => {
        panel.querySelectorAll('[data-sym]').forEach((b) => { b.onclick = () => resolve(+b.dataset.sym === sym); });
        world.keyHandler = (e) => { if (e.key === '1' || e.key === '2') resolve(+e.key - 1 === sym); };
      });
      world.keyHandler = null;
      $('[data-choices]').hidden = true;
      let slotOk = true;
      if (level.ring && alive()) {
        status('Where was the comet?');
        slots.forEach((s) => { s.disabled = false; });
        slots[0].focus({ preventScroll: true });
        slotOk = await new Promise((resolve) => { slots.forEach((s, i) => { s.onclick = () => resolve(i === slot); }); });
        slots.forEach((s) => { s.disabled = true; s.onclick = null; });
        slots[slot].classList.add('answer');
        slots[slot].textContent = '☄';
      }
      const ok = symOk && slotOk;
      history.push(shown);
      if (ok) { right++; status('Right.'); if (++streak >= 2) { streak = 0; shown = Math.max(STARLING_FASTEST, shown * 0.8); } }
      else { streak = 0; status(!symOk ? `It was ${SYMBOLS[sym][0]} ${SYMBOLS[sym][1]}.` : 'The comet was here.'); shown = Math.min(800, shown * 1.25); }
      await world.sleep(ok ? 500 : 1100);
    }
    if (!alive()) return;
    const threshold = Math.round(history.slice(-6).reduce((a, b) => a + b, 0) / Math.min(6, history.length));
    saveCarry(world.saveAs, threshold);
    const { best, isNew } = recordBest(world.saveAs, threshold, true);
    finish(world, starling, level, [
      `You got ${right} of ${TRIALS} right.`,
      threshold < begin ? 'The flashes got shorter as you went: you were taking in more at a glance.' : 'The flashes stayed about the same length. That’s fine; it often takes a few sessions.'
    ], '', [`Flash length it settled at: about ${threshold} ms (shorter means quicker).`, isNew ? 'That is a new personal best on this level.' : `Personal best on this level: ${best} ms.`], threshold, right < 8);
  }
};

starling.w3 = {
  id: 'starling', is3D: true,
  levels: [
    { name: 'One object', desc: 'Find 1 named object in the sky.', count: 1 },
    { name: 'Two objects', desc: 'Find 2 objects, one after the other.', count: 2 },
    { name: 'Three objects', desc: 'Find 3 objects, one after the other.', count: 3 }
  ],
  summary: ['The box at the top names an object in the observatory sky.', 'Look around, aim the crosshair at it and click.'],
  how: (l) => [`The box at the top names an object in the sky${l.count > 1 ? `, ${l.count} in turn` : ''}.`, 'Look around, aim the crosshair at it and click.'],
  meta: () => '<b>W A S D</b> walk · <b>mouse</b> look · <b>click</b> pick · no timer',
  async play(world, level, alive) {
    const result = await play3D(world, starling, level, alive);
    if (!result) return;
    finish3D(world, starling, level, [`You found ${level.count === 1 ? 'the object' : level.count === 2 ? 'both objects' : `all ${level.count} objects`}${result.mistakes ? `, with ${result.mistakes} wrong ${result.mistakes === 1 ? 'pick' : 'picks'}` : ' without a wrong pick'}.`], best3D(world, result.mistakes, 'wrong picks'));
  }
};

/* ======================================================================
 * 3. Cloudpath Cartographer: planning (Tower of London)
 * ==================================================================== */

// Three lanterns on three clouds that hold 3, 2 and 1. A state is a string like "RG|B|".
const CAP = [3, 2, 1];
const key = (s) => s.map((p) => p.join('')).join('|');
const parse = (k) => k.split('|').map((p) => (p ? p.split('') : []));
const STATES = (() => {
  const out = [];
  for (const order of ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR']) {
    for (let a = 0; a <= 3; a++) for (let b = 0; b <= 2 && a + b <= 3; b++) {
      const c = 3 - a - b;
      if (c <= 1) out.push(key([order.slice(0, a).split(''), order.slice(a, a + b).split(''), order.slice(a + b).split('')].map((p) => p.filter(Boolean))));
    }
  }
  return [...new Set(out)];
})();
function moves(k) {
  const s = parse(k), out = [];
  for (let from = 0; from < 3; from++) for (let to = 0; to < 3; to++) {
    if (from === to || !s[from].length || s[to].length >= CAP[to]) continue;
    const n = s.map((p) => p.slice());
    n[to].push(n[from].pop());
    out.push(key(n));
  }
  return out;
}
function distances(from) {
  const d = new Map([[from, 0]]), queue = [from];
  while (queue.length) { const k = queue.shift(); for (const n of moves(k)) if (!d.has(n)) { d.set(n, d.get(k) + 1); queue.push(n); } }
  return d;
}
const COLORS = { R: '#ff8a78', G: '#8fe3a4', B: '#7fb8ff' };
// A shape on each lantern as well as a color, so the puzzle never depends on telling colors apart.
const GLYPHS = { R: '▲', G: '●', B: '■' };
const NAMES = { R: 'red triangle', G: 'green circle', B: 'blue square' };

const cloudpath = {
  id: 'cloudpath', title: 'Cloudpath Cartographer', kicker: 'Planning', tone: '#f6d184',
  about: { text: 'Practices planning ahead: working out a whole sequence of moves before you make them. Inspired by Tower of London puzzles used in research. A small trial with breast cancer survivors found gains on some thinking tests from home-based online training compared with a waiting list; results across studies are mixed, and this game itself hasn’t been studied.', cite: 'Kesler et al., Clinical Breast Cancer 2013', href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3726272/' },
  levels: [
    // target: where puzzles start; min and max: the shortest and longest they get on this level.
    { name: 'Short routes', desc: 'Puzzles that take 2 to 4 moves.', target: 3, min: 2, max: 4 },
    { name: 'Four moves', desc: 'Puzzles from 4 moves, up to 6.', target: 4, min: 3, max: 6 },
    { name: 'Five moves', desc: 'Puzzles from 5 moves, up to 8.', target: 5, min: 4, max: 8 }
  ],
  summary: ['Make your clouds match the Goal. Tap a cloud to lift its top lantern, then tap another cloud to drop it.', 'Clouds hold 3, 2 and 1 lanterns. Plan ahead and use as few moves as you can.'],
  how: () => ['Make your clouds match the <b>Goal</b>. Tap a cloud to lift its top lantern, then tap another cloud to drop it.', 'Clouds hold 3, 2 and 1 lanterns. <b>Plan first</b> and use as few moves as you can.'],
  meta: () => '8 puzzles · a perfect solve makes the next one a move longer',
  carry: { from: (v, l) => clamp(v - 1, l.min, l.max), label: (v) => `${v}-move puzzles` },
  async play(world, level, alive, mode, startAt) {
    const PUZZLES = 8;
    let target = startAt ?? level.target, perfect = 0, hardest = 0;
    for (let n = 0; n < PUZZLES && alive(); n++) {
      const startKey = pick(STATES);
      const d = distances(startKey);
      let need = target;
      let goals = [...d].filter(([, v]) => v === need);
      while (!goals.length) goals = [...d].filter(([, v]) => v === --need);
      const goal = pick(goals)[0];
      let state = parse(startKey), held = null, count = 0, firstMove = 0;
      const t0 = world.now();
      world.progress(n, PUZZLES);
      const panel = world.render(`<main class="world-card bg-card">
        <p class="world-note">Puzzle ${n + 1} of ${PUZZLES} · fewest possible: ${need} moves</p>
        <div class="tol-goal"><small>Goal</small><div class="tol" data-goal></div></div>
        <div class="tol tol-play" data-play></div>
        <p class="game-status" data-status>Plan your route, then start moving.</p>
        <div class="world-controls"><button data-reset>Start over</button><button data-skip>Skip this puzzle</button></div>
      </main>`);
      const draw = (el, s, live) => {
        el.innerHTML = s.map((peg, i) => `<${live ? 'button' : 'div'} class="tol-peg" data-peg="${i}" style="--cap:${CAP[i]}" ${live ? `aria-label="Cloud ${i + 1}: ${peg.length ? peg.map((b) => NAMES[b]).join(', ') : 'empty'}${held === i ? ', top lantern lifted' : ''}"` : ''}>${peg.map((b, j) => `<i style="--c:${COLORS[b]}" class="${live && held === i && j === peg.length - 1 ? 'held' : ''}" ${live ? '' : 'aria-hidden="true"'}>${GLYPHS[b]}</i>`).join('')}</${live ? 'button' : 'div'}>`).join('');
      };
      draw(panel.querySelector('[data-goal]'), parse(goal), false);
      const solved = await new Promise((resolve) => {
        const redraw = () => {
          draw(panel.querySelector('[data-play]'), state, true);
          panel.querySelectorAll('[data-peg]').forEach((el) => {
            el.onclick = () => {
              const i = +el.dataset.peg;
              const say = (t) => { panel.querySelector('[data-status]').textContent = t; };
              if (held === null) { if (state[i].length) held = i; else say('That cloud is empty. Tap a cloud with a lantern on it.'); }
              else if (held === i) held = null;
              else if (state[i].length >= CAP[i]) say(`That cloud is full. It holds ${CAP[i]} ${CAP[i] === 1 ? 'lantern' : 'lanterns'}.`);
              else {
                state[i].push(state[held].pop());
                held = null;
                if (!count++) firstMove = world.now() - t0;
                panel.querySelector('[data-status]').textContent = `Moves: ${count}`;
                if (key(state) === goal) { redraw(); resolve(true); return; }
              }
              redraw();
              // The clouds are redrawn, so put keyboard focus back on the one just tapped.
              panel.querySelector(`[data-play] [data-peg="${i}"]`).focus({ preventScroll: true });
            };
          });
        };
        panel.querySelector('[data-reset]').onclick = () => { state = parse(startKey); held = null; panel.querySelector('[data-status]').textContent = `Back to the start. Moves so far: ${count}`; redraw(); };
        panel.querySelector('[data-skip]').onclick = () => resolve(false);
        redraw();
        panel.querySelector('[data-play] [data-peg]').focus({ preventScroll: true });
      });
      if (!alive()) return;
      const isPerfect = solved && count === need;
      if (isPerfect) { perfect++; hardest = Math.max(hardest, need); target = Math.min(level.max, need + 1); }
      else if (!solved || count > need + 2) target = Math.max(level.min, need - 1);
      panel.querySelector('[data-status]').textContent = isPerfect
        ? `Perfect: ${count} moves${firstMove > 4000 ? `, after ${Math.round(firstMove / 1000)} s of planning` : ''}.`
        : !solved ? 'Skipped. The next puzzle is a little shorter.'
        : `Solved in ${count} moves (fewest possible: ${need}). Try planning the whole route before the first move.`;
      await world.sleep(1600);
    }
    if (!alive()) return;
    saveCarry(world.saveAs, target);
    const { best, isNew } = hardest ? recordBest(world.saveAs, hardest) : { best: readJSON(BEST)[world.saveAs] };
    finish(world, cloudpath, level, [`Perfect solutions: ${perfect} of ${PUZZLES}. Longest route solved perfectly: ${hardest || 'none yet'}${hardest ? ' moves' : ''}.`], isNew ? 'That is a new personal best on this level!' : best ? `Personal best on this level: ${best} moves.` : '', [], hardest, perfect === 0);
  }
};

cloudpath.w3 = {
  id: 'cloudpath', is3D: true,
  levels: [
    { name: 'To the Falls', desc: 'Plan a route from Harbor to Falls.', must: [], end: 'Falls', goal: 'Harbor to Falls', fewest: 2 },
    { name: 'To the Beacon', desc: 'Plan a route from Harbor all the way to Beacon.', must: [], end: 'Beacon', goal: 'Harbor to Beacon', fewest: 3 },
    { name: 'Through Moss', desc: 'Visit Moss on your way to Beacon.', must: ['Moss'], end: 'Beacon', goal: 'Harbor to Beacon, through Moss', fewest: 3 }
  ],
  summary: ['Plan a route across the sky bridges, from Harbor to the island named at the top.', 'Click each next island’s beacon. The ones you can reach next glow brightest.'],
  how: (l) => [`Plan a route across the sky bridges: <b>${esc(l.goal)}</b>.`, 'Click each next island’s beacon. The ones you can reach next glow brightest.'],
  meta: () => '<b>W A S D</b> walk · <b>mouse</b> look · <b>click</b> pick · no timer',
  async play(world, level, alive) {
    const result = await play3D(world, cloudpath, level, alive);
    if (!result) return;
    finish3D(world, cloudpath, level, [`Your route: ${result.path}. That’s ${result.stops} stops; the shortest takes ${level.fewest}.`], best3D(world, result.stops, 'stops'));
  }
};

/* ======================================================================
 * 4. Story Echo: verbal memory (word lists, with a linking strategy)
 * ==================================================================== */

// 25 words in each of 8 groups, so a whole session can use fresh words (a Challenge level 3
// session shows 68 list words and 68 lures) and still keep never-shown words for the last check.
const WORDS = {
  fruit: ['apple', 'lemon', 'grape', 'peach', 'cherry', 'mango', 'plum', 'melon', 'pear', 'kiwi', 'lime', 'orange', 'banana', 'apricot', 'papaya', 'coconut', 'fig', 'date', 'guava', 'berry', 'olive', 'raisin', 'quince', 'nectarine', 'tangerine'],
  animals: ['horse', 'otter', 'eagle', 'tiger', 'rabbit', 'whale', 'goose', 'zebra', 'camel', 'fox', 'badger', 'beaver', 'donkey', 'falcon', 'lizard', 'monkey', 'panda', 'parrot', 'salmon', 'turtle', 'wolf', 'moose', 'robin', 'shark', 'llama'],
  tools: ['hammer', 'ladder', 'shovel', 'wrench', 'needle', 'brush', 'drill', 'rake', 'saw', 'chisel', 'pliers', 'anvil', 'axe', 'trowel', 'bucket', 'clamp', 'funnel', 'hatchet', 'crowbar', 'mallet', 'rope', 'scissors', 'spade', 'tape', 'sander'],
  places: ['beach', 'castle', 'garden', 'harbor', 'library', 'market', 'meadow', 'museum', 'island', 'bridge', 'airport', 'bakery', 'canyon', 'chapel', 'desert', 'forest', 'lake', 'mountain', 'office', 'palace', 'prairie', 'school', 'stadium', 'temple', 'village'],
  clothing: ['scarf', 'jacket', 'boot', 'glove', 'apron', 'sweater', 'sock', 'belt', 'vest', 'sandal', 'blouse', 'cap', 'coat', 'dress', 'hoodie', 'mitten', 'pajamas', 'poncho', 'robe', 'shirt', 'shoe', 'skirt', 'slipper', 'tie', 'tuxedo'],
  weather: ['thunder', 'breeze', 'frost', 'rain', 'fog', 'hail', 'sunshine', 'snow', 'storm', 'drizzle', 'cloud', 'gale', 'lightning', 'mist', 'rainbow', 'sleet', 'tornado', 'blizzard', 'dew', 'drought', 'flood', 'heatwave', 'hurricane', 'monsoon', 'gust'],
  music: ['violin', 'drum', 'flute', 'piano', 'harp', 'trumpet', 'guitar', 'cello', 'banjo', 'organ', 'accordion', 'bagpipe', 'bugle', 'cymbal', 'fiddle', 'gong', 'harmonica', 'kazoo', 'lute', 'oboe', 'tambourine', 'trombone', 'tuba', 'ukulele', 'xylophone'],
  kitchen: ['kettle', 'spoon', 'ladle', 'oven', 'plate', 'whisk', 'teapot', 'bowl', 'grater', 'skillet', 'blender', 'colander', 'fork', 'jar', 'knife', 'mug', 'napkin', 'pan', 'pitcher', 'saucer', 'sieve', 'spatula', 'toaster', 'tray', 'cup']
};
// Gentle lists stop growing at 12 words so the recall screen stays short.
const echoMax = (mode, level) => Math.min(level ? level.max : 16, mode === 'challenge' ? 16 : 12);

const echo = {
  id: 'echo', title: 'Story Echo', kicker: 'Verbal memory', tone: '#e7b574',
  modes: true, challengeNote: 'Each word shows for a set time, quicker on the last level.',
  about: {
    text: 'Practices remembering words, using strategies like linking them into a story. Inspired by memory training used in research. An early trial with breast cancer survivors found memory gains compared with a waiting list, but its authors called it preliminary, and a stricter later trial of brain training by the same team found no clear difference on thinking tests. This game itself hasn’t been studied.',
    cite: 'Von Ah et al., Breast Cancer Research and Treatment 2012', href: 'https://scholarworks.indianapolis.iu.edu/items/6103443c-9611-461c-adc1-1e42f0215fb2',
    more: [{ cite: 'Von Ah et al., Supportive Care in Cancer 2022', href: 'https://scholarworks.indianapolis.iu.edu/items/cc28c83f-bff2-4250-a944-e640a19b5526' }]
  },
  levels: [
    // words: where lists start; min and max: the shortest and longest they get on this level
    // (Gentle also stops at 12, see echoMax).
    { name: 'Short lists', desc: 'Lists of 4 to 10 words, starting at 6.', words: 6, min: 4, max: 10, pace: 1700 },
    { name: 'Longer lists', desc: 'Lists from 8 words, up to 12 (14 in Challenge).', words: 8, min: 6, max: 14, pace: 1600 },
    { name: 'Long lists', desc: 'Lists from 10 words, up to 12 (16 in Challenge).', words: 10, min: 8, max: 16, pace: 1500 }
  ],
  summary: ['Words appear one at a time. Try to remember them all.', 'Then tap every word you saw, from a mix of old and new.'],
  how: (l, mode) => [
    mode === 'challenge'
      ? `Words appear one at a time, about ${(l.pace / 1000).toFixed(1)} seconds each. Then type the ones you remember (or skip).`
      : 'Words appear one at a time. Press <b>Next word</b> (or Space) when you’re ready.',
    'Then tap every word you saw, from a mix of old and new.',
    '<b>Tip:</b> link the words in a tiny story, like “the horse ate a lemon on the bridge.”'
  ],
  meta: (l, mode) => `5 lists, starting at ${Math.min(l.words, echoMax(mode, l))} words · remember 85% and the next list grows${mode === 'challenge' ? ' · one last check at the end' : ''}`,
  carry: { from: (v, l, mode) => clamp(v - 2, l.min, echoMax(mode, l)), label: (v) => `lists of ${v} words` },
  async play(world, level, alive, mode, startAt) {
    const LISTS = 5, gentle = mode !== 'challenge', max = echoMax(mode, level);
    let n = Math.min(startAt ?? level.words, max), bestLen = 0, totalHits = 0, totalShown = 0;
    let typedHits = 0, typedShown = 0; // Challenge: words typed from memory, before the list
    const seen = [], used = new Set(); // every listed word, and every word shown on any screen
    // Challenge keeps 8 words aside that no list or lure uses, so the last check always has
    // never-shown words to mix in, however long the session.
    const reserved = new Set(gentle ? [] : shuffle(Object.values(WORDS).flat()).slice(0, 8));
    let speak = false;
    for (let list = 0; list < LISTS && alive(); list++) {
      const groups = shuffle(Object.keys(WORDS)).slice(0, Math.ceil(n / 2));
      const chosen = [], lures = [];
      // Words not yet seen this session come first, so the same word doesn't turn up on two lists
      // (long Challenge sessions can run out, and only then reuse words).
      groups.forEach((g) => { const pool = WORDS[g].filter((x) => !reserved.has(x)); const w = [...shuffle(pool.filter((x) => !used.has(x))), ...shuffle(pool.filter((x) => used.has(x)))]; chosen.push(...w.slice(0, 2)); lures.push(...w.slice(2, 4)); });
      const list_ = shuffle(chosen.slice(0, n));
      const foils = shuffle(lures).slice(0, n);
      seen.push(...list_);
      [...list_, ...foils].forEach((w) => used.add(w));
      const panel = world.render(`<main class="world-card bg-card">
        <p class="world-note" data-info>List ${list + 1} of ${LISTS} · ${n} words</p>
        <p class="word-show" data-word aria-live="polite">Ready…</p>
        <div class="world-controls">${gentle ? '<button data-next class="bg-primary" hidden>Next word</button>' : ''}<button data-speak aria-pressed="${speak}">Read words aloud</button></div>
      </main>`);
      panel.querySelector('[data-speak]').onclick = (e) => { speak = !speak; e.currentTarget.setAttribute('aria-pressed', String(speak)); };
      const next = panel.querySelector('[data-next]');
      await world.sleep(gentle ? 800 : 1200);
      for (let i = 0; i < list_.length; i++) {
        if (!alive()) return;
        panel.querySelector('[data-info]').textContent = `List ${list + 1} of ${LISTS} · word ${i + 1} of ${n}`;
        world.progress(list + i / n / 2, LISTS);
        panel.querySelector('[data-word]').textContent = list_[i];
        if (speak && window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(list_[i]));
        if (gentle) {
          next.hidden = false;
          next.textContent = i + 1 < n ? 'Next word' : 'Pick the words';
          if (i === 0) next.focus({ preventScroll: true });
          await new Promise((resolve) => {
            next.onclick = resolve;
            // Space or Enter anywhere; a focused button already handles those keys itself.
            world.keyHandler = (e) => {
              if (e.repeat || (e.key !== ' ' && e.key !== 'Enter') || e.target.closest?.('button')) return;
              e.preventDefault();
              resolve();
            };
          });
          world.keyHandler = null;
        } else await world.sleep(level.pace);
        panel.querySelector('[data-word]').textContent = '';
        await world.sleep(gentle ? 150 : 250);
      }
      if (!alive()) return;
      // Challenge: first type what you remember (recalling is harder than recognizing), or skip.
      const chosenSet = new Set();
      if (!gentle) {
        const typing = world.render(`<main class="world-card bg-card">
          <p class="world-note">List ${list + 1} of ${LISTS} · type the words you remember</p>
          <label class="bg-type"><span>Any order, separated by spaces or commas.</span>
            <textarea data-typed rows="3" autocomplete="off" autocapitalize="none" spellcheck="false"></textarea></label>
          <div class="world-controls"><button data-check class="bg-primary">Check</button><button data-skip>Skip to the list</button></div>
        </main>`);
        const box = typing.querySelector('[data-typed]');
        box.focus({ preventScroll: true });
        const typed = await new Promise((resolve) => {
          typing.querySelector('[data-check]').onclick = () => resolve(box.value);
          typing.querySelector('[data-skip]').onclick = () => resolve(null);
        });
        if (!alive()) return;
        if (typed !== null) {
          const words = new Set(typed.toLowerCase().split(/[^a-z]+/).filter(Boolean));
          list_.filter((w) => words.has(w)).forEach((w) => chosenSet.add(w));
          typedHits += chosenSet.size; typedShown += n;
        }
      }
      const options = shuffle([...list_, ...foils]);
      world.progress(list + 0.5, LISTS);
      const recall = world.render(`<main class="world-card bg-card">
        <p class="world-note">List ${list + 1} of ${LISTS} · pick the ${n} words you saw</p>
        <div class="word-grid">${options.map((w) => `<button data-w="${w}" aria-pressed="${chosenSet.has(w)}">${w}</button>`).join('')}</div>
        <p class="game-status" data-status>${chosenSet.size ? `You typed ${chosenSet.size}, already picked. ` : ''}Selected: ${chosenSet.size}</p>
        <div class="world-controls"><button data-done class="bg-primary">Done</button></div>
      </main>`);
      recall.querySelectorAll('[data-w]').forEach((b) => {
        b.onclick = () => {
          const w = b.dataset.w;
          chosenSet.has(w) ? chosenSet.delete(w) : chosenSet.add(w);
          b.setAttribute('aria-pressed', String(chosenSet.has(w)));
          recall.querySelector('[data-status]').textContent = `Selected: ${chosenSet.size}`;
        };
      });
      await new Promise((r) => { recall.querySelector('[data-done]').onclick = r; });
      const hits = list_.filter((w) => chosenSet.has(w)).length;
      const falseAlarms = [...chosenSet].filter((w) => !list_.includes(w)).length;
      const score = Math.max(0, (hits - falseAlarms) / n);
      totalHits += hits; totalShown += n;
      // Marks use a symbol as well as a color: ✓ found, ○ missed, ✗ not on the list.
      recall.querySelectorAll('[data-w]').forEach((b) => {
        const w = b.dataset.w;
        b.disabled = true;
        const mark = list_.includes(w) ? (chosenSet.has(w) ? ['hit', '✓', 'found'] : ['missed', '○', 'missed']) : chosenSet.has(w) ? ['wrong', '✗', 'not on the list'] : null;
        if (!mark) return;
        b.classList.add(mark[0]);
        b.textContent = `${mark[1]} ${w}`;
        b.setAttribute('aria-label', `${w}: ${mark[2]}`);
      });
      recall.querySelector('[data-status]').textContent = `You found ${hits} of ${n}${falseAlarms ? `, and picked ${falseAlarms} that ${falseAlarms === 1 ? 'wasn’t' : 'weren’t'} on the list` : ''}. ✓ found · ○ missed · ✗ not on the list`;
      if (score >= 0.85) { bestLen = Math.max(bestLen, n); n = Math.min(max, n + 2); }
      else if (score < 0.6) n = Math.max(level.min, n - 2);
      await new Promise((r) => { const b = recall.querySelector('[data-done]'); b.textContent = list + 1 < LISTS ? 'Next list' : 'See results'; b.onclick = r; });
    }
    if (!alive()) return;
    // Challenge: a last check a few minutes on. Which of these words were on an earlier list?
    let later = '';
    if (!gentle) {
      // As many never-shown words as earlier ones, so guessing "all of them" doesn't pay.
      const unseen = Object.values(WORDS).flat().filter((w) => !used.has(w));
      const old = shuffle([...new Set(seen)]).slice(0, Math.min(8, unseen.length));
      const fresh = shuffle(unseen).slice(0, old.length);
      const check = world.render(`<main class="world-card bg-card">
        <p class="world-note">One last check · which of these were on any of your lists?</p>
        <div class="word-grid">${shuffle([...old, ...fresh]).map((w) => `<button data-w="${w}" aria-pressed="false">${w}</button>`).join('')}</div>
        <div class="world-controls"><button data-done class="bg-primary">See results</button></div>
      </main>`);
      const picked = new Set();
      check.querySelectorAll('[data-w]').forEach((b) => {
        b.onclick = () => { const w = b.dataset.w; picked.has(w) ? picked.delete(w) : picked.add(w); b.setAttribute('aria-pressed', String(picked.has(w))); };
      });
      await new Promise((r) => { check.querySelector('[data-done]').onclick = r; });
      if (!alive()) return;
      const kept = old.filter((w) => picked.has(w)).length, wrong = fresh.filter((w) => picked.has(w)).length;
      later = `At the end you still recognized ${kept} of ${old.length} earlier words${wrong ? ` (and picked ${wrong} that were never shown)` : ''}.`;
    }
    saveCarry(world.saveAs, n);
    const { best, isNew } = bestLen ? recordBest(world.saveAs, bestLen) : { best: readJSON(BEST)[world.saveAs] };
    finish(world, echo, level, [`You remembered ${totalHits} of ${totalShown} words. Longest list at 85% or better: ${bestLen || 'not yet'}${bestLen ? ' words' : ''}.`], isNew ? 'That is a new personal best on this level!' : best ? `Personal best on this level: ${best} words.` : '', [
      typedShown ? `Typed from memory before picking: ${typedHits} of ${typedShown} words.` : '',
      later
    ], bestLen, !bestLen && totalHits < totalShown * 0.6);
  }
};

/* ======================================================================
 * 5. Finger Rhythm: tapping with a hidden repeating sequence
 * ==================================================================== */

const PADS = [['D', '☾'], ['F', '⌁'], ['J', '✦'], ['K', '◉']];
const PAD_SETS = { 2: [1, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] }; // which pads each level uses
const RHYTHM_FASTEST = 600; // Challenge never asks for more than one light every 0.6 s
// 8 steps across n pads: no pad twice in a row (with 2 pads, never three in a row).
function tapPattern(n) {
  const seq = [];
  while (seq.length < 8) {
    const v = Math.floor(Math.random() * n), last = seq[seq.length - 1];
    if (n > 2 ? v === last : v === last && v === seq[seq.length - 2]) continue;
    seq.push(v);
  }
  return seq;
}

const rhythm = {
  id: 'rhythm', title: 'Finger Rhythm', kicker: 'Hand coordination', tone: '#8ed9c3',
  modes: true, challengeNote: 'Catch each light before the next one. The pace adapts, never faster than one every 0.6 seconds.',
  about: { text: 'Practices gentle, accurate finger movements and picking up a pattern. Fine-motor and sensorimotor training are being studied for hand symptoms after chemotherapy; the evidence is still early, and this game itself hasn’t been studied.', cite: 'Feasibility trial, Supportive Care in Cancer 2025', href: 'https://link.springer.com/article/10.1007/s00520-025-09712-2' },
  safety: 'Rest your hands comfortably and tap lightly. Stop if you feel pain, cramping, or more numbness or tingling than usual, and tell your care team about new or worse symptoms.',
  levels: [
    { name: 'Two pads', desc: 'Two big pads: F and J.', pads: 2, interval: 1100 },
    { name: 'Three pads', desc: 'Three pads: D, F and J.', pads: 3, interval: 950 },
    { name: 'Four pads', desc: 'All four pads: D, F, J and K.', pads: 4, interval: 800 }
  ],
  how: (l, mode) => {
    const keys = PAD_SETS[l.pads].map((i) => PADS[i][0]);
    return [
      `Tap the pad that lights up<span class="bg-key"> (or press <b>${keys.join(' ')}</b>)</span>.`,
      mode === 'challenge' ? 'Catch it before the next one lights. The pace adapts to you.' : 'It waits for you, and a wrong tap doesn’t count against you.'
    ];
  },
  summary: ['Tap the pad that lights up, using a light touch.', 'In Gentle mode it waits for you. In Challenge, catch each light before the next.'],
  meta: () => '8 rounds of 8 lights · a hidden pattern repeats, and your hands may pick it up',
  // Only Challenge has a pace to carry over; Gentle always waits.
  carry: { from: (v, l, mode) => (mode === 'challenge' ? Math.round(clamp(v * 1.1, RHYTHM_FASTEST, 1400)) : undefined), label: (v) => `a light every ${(v / 1000).toFixed(1)} seconds` },
  async play(world, level, alive, mode, startAt) {
    const gentle = mode !== 'challenge';
    const pads_ = PAD_SETS[level.pads].map((i) => PADS[i]);
    const SEQ = tapPattern(pads_.length);
    const ROUNDS = 8, RANDOM_ROUND = 6; // round 7 is mixed up, to see what the pattern taught your hands
    let interval = Math.max(RHYTHM_FASTEST, startAt ?? level.interval), fastest = Infinity, hitsAll = 0;
    const rts = { pattern: [], random: [] };
    const panel = world.render(`<main class="world-card bg-card">
      <p class="world-note" data-info></p>
      <div class="rhythm-row" data-count="${pads_.length}">${pads_.map(([k, icon], i) => `<button class="pad" data-pad="${i}" aria-label="Pad ${k}">${icon}<small class="bg-key">${k}</small></button>`).join('')}</div>
      <p class="game-status" data-status></p>
    </main>`);
    const pads = [...panel.querySelectorAll('[data-pad]')];
    const status = (t) => { panel.querySelector('[data-status]').textContent = t; };
    // Taps closer together than 150 ms count once, so a shaky double tap isn't a mistake.
    let tap = null, lastTap = -Infinity;
    const press = (i) => { const t = world.now(); if (t - lastTap < 150) return; lastTap = t; tap && tap(i); };
    pads.forEach((p, i) => {
      p.onpointerdown = (e) => { e.preventDefault(); press(i); };
      // Enter or Space on a focused pad (keyboard, switch access, screen readers) arrives as a click
      // with no pointer behind it (detail 0). Taps are already handled on pointerdown.
      p.onclick = (e) => { if (e.detail === 0) press(i); };
    });
    world.keyHandler = (e) => {
      if (e.repeat) return;
      const i = pads_.findIndex(([k]) => k.toLowerCase() === e.key.toLowerCase());
      if (i >= 0) { e.preventDefault(); press(i); }
    };
    const clear = () => pads.forEach((p) => p.classList.remove('active', 'good', 'bad'));
    for (let round = 0; round < ROUNDS && alive(); round++) {
      const seq = round === RANDOM_ROUND ? tapPattern(pads_.length) : SEQ;
      panel.querySelector('[data-info]').textContent = `Round ${round + 1} of ${ROUNDS}${gentle ? '' : ' · Challenge'}`;
      world.progress(round, ROUNDS);
      status('Get ready…');
      await world.sleep(900);
      status(gentle ? 'Tap the glowing pad whenever you’re ready.' : 'Tap the glowing pad before the next one lights.');
      let hits = 0;
      for (const target of seq) {
        if (!alive()) return;
        clear();
        pads[target].classList.add('active');
        const shownAt = world.now();
        if (gentle) {
          // The light waits for the right pad. Other taps are simply ignored.
          const rt = await new Promise((resolve) => { tap = (i) => { if (i === target) resolve(world.now() - shownAt); }; });
          tap = null;
          hits++;
          pads[target].classList.add('good');
          (round === RANDOM_ROUND ? rts.random : rts.pattern).push(rt);
          await world.sleep(350);
          continue;
        }
        const result = await new Promise((resolve) => {
          let over = false;
          const end = (v) => { if (!over) { over = true; resolve(v); } };
          tap = (i) => end({ i, rt: world.now() - shownAt });
          world.sleep(interval).then(() => end(null));
        });
        tap = null;
        if (result && result.i === target) {
          hits++;
          pads[target].classList.add('good');
          (round === RANDOM_ROUND ? rts.random : rts.pattern).push(result.rt);
          await world.sleep(Math.max(0, interval - result.rt) * 0.35);
        } else {
          pads[target].classList.add('bad');
          await world.sleep(result ? Math.max(0, interval - result.rt) * 0.35 : 250);
        }
      }
      clear();
      hitsAll += hits;
      if (gentle) status(round + 1 < ROUNDS ? pick(['Nice and steady.', 'Round done. Rest your hands for a moment if you like.', 'Good. Keep it light.']) : 'All done.');
      else if (hits >= 7) { fastest = Math.min(fastest, interval); interval = Math.max(RHYTHM_FASTEST, interval * 0.9); status(`${hits} of 8. A little quicker next round.`); }
      else if (hits <= 5) { interval = Math.min(1400, interval * 1.12); status(`${hits} of 8. A little slower next round.`); }
      else status(`${hits} of 8. Same pace.`);
      await world.sleep(gentle ? 1400 : 1100);
    }
    world.keyHandler = null;
    if (!alive()) return;
    // Medians, so a rest in the middle of a round doesn't skew the comparison.
    const learned = Math.round(median(rts.random) - median(rts.pattern.slice(-16)));
    const patternLine = learned > 30
      ? 'Your hands seemed to pick up the hidden pattern: you were a little quicker on it than on the mixed-up round.'
      : 'Hands often pick up the hidden pattern over a few sessions.';
    if (gentle) return finish(world, rhythm, level, [`You tapped all ${ROUNDS * 8} lights at your own pace.`, patternLine]);
    saveCarry(world.saveAs, Math.round(interval));
    const perMinute = fastest === Infinity ? 0 : Math.round(60000 / fastest);
    const record = perMinute ? recordBest(world.saveAs, perMinute) : null;
    finish(world, rhythm, level, [`You caught ${hitsAll} of ${ROUNDS * 8} lights in time.`, patternLine], '', [
      `Average reaction: ${Math.round(mean([...rts.pattern, ...rts.random]))} ms.`,
      perMinute ? `Quickest pace you kept up with: ${perMinute} lights a minute.` : 'No round was quick enough to count toward a personal best yet.',
      learned > 30 ? `On the hidden pattern you were about ${learned} ms quicker than on the mixed-up round.` : '',
      record ? (record.isNew ? 'That is a new Challenge personal best on this level.' : `Challenge personal best on this level: ${record.best} a minute.`) : ''
    ], perMinute || null, hitsAll < ROUNDS * 4);
  }
};

/* ======================================================================
 * 6. Signal Match: mental flexibility (task switching)
 * ==================================================================== */

// Color is only decoration: both rules (shape and fill) can be seen without it.
const SIGNAL_TONES = ['#ff9a62', '#5fa8ff', '#8fe3a4', '#f6d184', '#d8a4f0'];
const SIGNAL_FASTEST = 1000; // Challenge always leaves at least 1 second to answer

const signal = {
  id: 'signal', title: 'Signal Match', kicker: 'Mental flexibility', tone: '#d8a4f0',
  modes: true, challengeNote: 'A timer bar. Answer well and the time shrinks, never below 1 second.',
  about: { text: 'Practices switching between two rules, a part of mental flexibility. Inspired by task-switching exercises used in research. A small trial with breast cancer survivors found gains on flexibility tests from online training compared with a waiting list; results across studies are mixed, and this game itself hasn’t been studied.', cite: 'Kesler et al., Clinical Breast Cancer 2013', href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3726272/' },
  levels: [
    { name: 'One rule at a time', desc: 'The rule changes every 10 signals.', switchEvery: 10, p: 0, deadline: 3000 },
    { name: 'Some switches', desc: 'The rule changes about 1 time in 3.', p: 0.3, deadline: 2500 },
    { name: 'Frequent switches', desc: 'The rule changes about half the time.', p: 0.5, deadline: 2000 }
  ],
  summary: ['The word at the top says how to sort each shape: by <b>SHAPE</b> or by <b>FILL</b>.', '<b>SHAPE</b>: round goes left, pointed goes right. <b>FILL</b>: solid goes left, outline goes right.'],
  how: () => [
    'The word at the top says how to sort each shape: by <b>SHAPE</b> or by <b>FILL</b>.',
    '<b>SHAPE</b>: round goes left, pointed goes right. <b>FILL</b>: solid goes left, outline goes right.'
  ],
  meta: (l, mode) => `40 shapes · ${mode === 'challenge' ? 'a bar shows your time' : 'no timer'}<span class="bg-key"> · keys <b>F</b> (left) and <b>J</b> (right)</span>`,
  carry: { from: (v, l, mode) => (mode === 'challenge' ? Math.round(clamp(v * 1.1, SIGNAL_FASTEST, 4000)) : undefined), label: (v) => `${(v / 1000).toFixed(1)} seconds to answer` },
  async play(world, level, alive, mode, startAt) {
    const TRIALS = 40, challenge = mode === 'challenge';
    let deadline = Math.max(SIGNAL_FASTEST, startAt ?? level.deadline), rule = Math.random() < 0.5 ? 'shape' : 'fill';
    let correct = 0;
    const rt = { switch: [], stay: [] };
    const panel = world.render(`<main class="world-card bg-card">
      <p class="world-note" data-info></p>
      <p class="switch-rule" data-rule></p>
      <div class="switch-card" data-card></div>
      ${challenge ? '<div class="switch-bar"><i data-bar></i></div>' : ''}
      <div class="world-controls bg-choices"><button data-side="0"><kbd class="bg-key">F · </kbd>Round / Solid</button><button data-side="1"><kbd class="bg-key">J · </kbd>Pointed / Outline</button></div>
      <p class="game-status" data-status aria-live="polite"></p>
    </main>`);
    const $ = (s) => panel.querySelector(s);
    let answer = null;
    panel.querySelectorAll('[data-side]').forEach((b) => { b.onclick = () => answer && answer(+b.dataset.side); });
    world.keyHandler = (e) => { const k = e.key.toLowerCase(); if (!e.repeat && (k === 'f' || k === 'j')) { e.preventDefault(); answer && answer(k === 'f' ? 0 : 1); } };
    for (let t = 0; t < TRIALS && alive(); t++) {
      const switched = t > 0 && (level.switchEvery ? t % level.switchEvery === 0 : Math.random() < level.p);
      if (switched) rule = rule === 'shape' ? 'fill' : 'shape';
      const kind = pick(['round', 'pointed']), fill = pick(['solid', 'outline']);
      const glyph = kind === 'round' ? (fill === 'solid' ? '●' : '○') : pick(fill === 'solid' ? ['▲', '◆'] : ['△', '◇']);
      const want = rule === 'shape' ? (kind === 'round' ? 0 : 1) : (fill === 'solid' ? 0 : 1);
      $('[data-info]').textContent = `Signal ${t + 1} of ${TRIALS}${challenge ? ' · Challenge' : ''}`;
      world.progress(t, TRIALS);
      $('[data-rule]').textContent = rule.toUpperCase();
      $('[data-rule]').className = `switch-rule rule-${rule}`;
      $('[data-card]').innerHTML = `<span style="color:${pick(SIGNAL_TONES)}" role="img" aria-label="${fill} ${kind} shape">${glyph}</span>`;
      $('[data-status]').textContent = '';
      if (challenge) {
        const bar = $('[data-bar]');
        bar.style.transition = 'none'; bar.style.width = '100%';
        bar.getBoundingClientRect();
        bar.style.transition = `width ${deadline}ms linear`; bar.style.width = '0%';
      }
      const shownAt = world.now();
      const got = await new Promise((resolve) => {
        let over = false;
        const end = (v) => { if (!over) { over = true; resolve(v); } };
        answer = (side) => end({ side, time: world.now() - shownAt });
        if (challenge) world.sleep(deadline).then(() => end(null));
      });
      answer = null;
      const ok = got && got.side === want;
      if (ok) { correct++; (switched ? rt.switch : rt.stay).push(got.time); if (challenge) deadline = Math.max(SIGNAL_FASTEST, deadline * 0.95); }
      else if (challenge) deadline = Math.min(4000, deadline * 1.1);
      const explain = `sorting by ${rule}, that one is ${rule === 'shape' ? kind : fill}, so it goes ${want ? 'right' : 'left'}.`;
      $('[data-status]').textContent = ok ? '✓ Right.' : got ? `✗ Not quite: ${explain}` : `No rush. Here’s the answer: ${explain}`;
      $('[data-card]').innerHTML = '';
      await world.sleep(ok ? 350 : 1600);
    }
    world.keyHandler = null;
    if (!alive()) return;
    const accuracy = Math.round((correct / TRIALS) * 100);
    const lines = [`You sorted ${correct} of ${TRIALS} correctly.`, accuracy >= 85 ? 'Nicely done: you kept track of the rule as it changed.' : 'Switching rules is tricky for everyone, and it usually gets easier with practice.'];
    if (!challenge) return finish(world, signal, level, lines, '', [], null, accuracy < 60);
    saveCarry(world.saveAs, Math.round(deadline));
    const all = Math.round(mean([...rt.switch, ...rt.stay]));
    const cost = rt.switch.length && rt.stay.length ? Math.round(mean(rt.switch) - mean(rt.stay)) : null;
    const record = accuracy >= 85 ? recordBest(world.saveAs, all, true) : null; // best: fastest average with 85% right
    finish(world, signal, level, lines, '', [
      `Average answer: ${all} ms.`,
      cost === null ? '' : cost > 15 ? `Switching rules slowed you by ${cost} ms (this often shrinks with practice).` : 'No slowdown when the rule switched.',
      record ? (record.isNew ? 'That is a new Challenge personal best on this level.' : `Challenge personal best on this level: ${record.best} ms with 85% or more right.`) : 'Get 85% right to set a Challenge personal best.'
    ], record ? all : null, accuracy < 60);
  }
};

/* ---------- wiring ---------- */

const GAMES = [lumen, starling, cloudpath, echo, rhythm, signal];
const worlds = Object.fromEntries(GAMES.map((g) => [g.id, new World(g)]));

addEventListener('click', (event) => {
  const card = event.target.closest && event.target.closest('[data-game]');
  if (!card) return;
  const game = GAMES.find((g) => g.id === card.dataset.game);
  if (!game) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const world = worlds[game.id];
  world.opener = card.closest('.activity-card')?.querySelector('button') || (document.activeElement !== document.body ? document.activeElement : null);
  world.logPlay = event.isTrusted; // a ?play= link's click is made by script and was counted on the Your games page
  world.open();
  levelsFor(game);
}, true);

// Listens in the capture phase so an Escape meant for a game stops here, instead of also
// closing the games library underneath.
addEventListener('keydown', (event) => {
  const world = Object.values(worlds).find((w) => !w.host.hidden);
  if (!world) return;
  // Escape pauses a game under way (and resumes it from the pause card), so one stray key press
  // never throws away a session. Anywhere else, it leaves the game.
  if (event.key === 'Escape') {
    event.stopImmediatePropagation();
    if (world.paused) world.resume();
    else if (world.playing) world.pause();
    else world.close();
    return;
  }
  if (world.paused) return;
  // Letters and spaces typed into a text box (Story Echo's recall box) are words, not game keys.
  if (event.target.closest?.('textarea, input')) return;
  if (world.keyHandler) world.keyHandler(event);
}, true);

// Switching to another tab or app pauses a game that's under way.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) Object.values(worlds).forEach((w) => w.pause());
});
