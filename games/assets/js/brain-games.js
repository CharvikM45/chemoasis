/*
 * The six brain games. Each one is inspired by a task used in cognitive training research with
 * people after cancer treatment. Most adapt as you play: harder after you succeed and easier
 * after you miss. Sessions are a few minutes long.
 *
 *   lumen      Lumen Garden            spatial working memory span (forward, then backward)
 *   starling   Starling Observatory    speed of processing (brief flashes, centre + periphery)
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
 * Levels set where a session starts; results and personal bests are shown at the end.
 * three.js only draws the backdrop, so it is loaded on demand: if it can't download (offline,
 * a blocked network), the games still open on their plain background.
 */
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
function bests() { try { return JSON.parse(localStorage.getItem(BEST) || '{}') || {}; } catch (_) { return {}; } }
// Saves `value` if it beats the old best (higher is better unless lowerIsBetter). Returns { best, isNew }.
function recordBest(game, value, lowerIsBetter) {
  const all = bests();
  const old = all[game];
  const isNew = old === undefined || (lowerIsBetter ? value < old : value > old);
  if (isNew) { all[game] = value; try { localStorage.setItem(BEST, JSON.stringify(all)); } catch (_) { /* storage unavailable */ } }
  return { best: isNew ? value : old, isNew };
}

const MODE = 'chemoasis.mode';
function modes() { try { return JSON.parse(localStorage.getItem(MODE) || '{}') || {}; } catch (_) { return {}; } }
const savedMode = (game) => (modes()[game] === 'challenge' ? 'challenge' : 'gentle');
function saveMode(game, mode) { const all = modes(); all[game] = mode; try { localStorage.setItem(MODE, JSON.stringify(all)); } catch (_) { /* storage unavailable */ } }

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
  render(body) {
    this.host.innerHTML = `<div class="world-panel"><header class="world-top"><div><p class="world-kicker">${esc(this.game.kicker)}</p><h2>${esc(this.game.title)}</h2></div><div class="world-actions">${this.playing ? '<button data-action="pause">Pause</button>' : ''}<button data-action="exit">Exit game</button></div></header>${body}</div>`;
    this.host.querySelector('[data-action="exit"]').onclick = () => this.close();
    const pause = this.host.querySelector('[data-action="pause"]');
    if (pause) pause.onclick = () => this.pause();
    if (this.renderer) this.host.prepend(this.renderer.domElement);
    if (this.paused) this.showPause();
    return this.host.querySelector('.world-panel');
  }
  async scene() {
    if (this.renderer || this.sceneTried) return;
    this.sceneTried = true;
    const T = await loadThree();
    if (!T) return; // no 3D: the game still works on its plain background
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
    const geometry = {
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
    addEventListener('resize', () => this.resize());
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
    // The game opens straight away; the backdrop joins in once three.js has loaded.
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
    cancelAnimationFrame(this.raf);
    GameLevels.close(this.host);
    this.host.hidden = true;
    (this.inerted || []).forEach((el) => { el.inert = false; });
    this.inerted = null;
    // Back to the games library if it's open underneath, otherwise back to the page.
    document.body.style.overflow = document.querySelector('#experience-view:not([hidden])') ? 'hidden' : '';
    window.speechSynthesis && speechSynthesis.cancel();
  }
}

/* ---------- shared screens ---------- */

// "How it works" card before a session, with the Gentle / Challenge choice for games that have
// one. Resolves { go, mode }: go is true for Start, false for All levels.
function intro(world, game, level) {
  let mode = game.modes ? savedMode(game.id) : null;
  const panel = world.render(`<main class="world-card bg-card">
    <p class="world-note">Level ${level.index + 1} · ${esc(level.name)}</p>
    ${game.modes ? `<div class="bg-modes" role="group" aria-label="Mode">
      <button data-mode="gentle">Gentle<small>No timer. The game waits for you.</small></button>
      <button data-mode="challenge">Challenge<small>${esc(game.challengeNote)}</small></button>
    </div>` : ''}
    <ul class="bg-how" data-how></ul>
    ${game.safety ? `<p class="bg-safety">${game.safety}</p>` : ''}
    <div class="world-controls"><button data-go class="bg-primary">Start</button><button data-levels>All levels</button></div>
  </main>`);
  const show = () => {
    panel.querySelector('[data-how]').innerHTML = game.how(level, mode).map((l) => `<li>${l}</li>`).join('');
    panel.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  };
  panel.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { mode = b.dataset.mode; saveMode(game.id, mode); show(); }; });
  show();
  return new Promise((resolve) => {
    panel.querySelector('[data-go]').onclick = () => resolve({ go: true, mode });
    panel.querySelector('[data-levels]').onclick = () => resolve({ go: false });
    panel.querySelector('[data-go]').focus();
  });
}

// The level-complete screen. `lines` are the friendly results; `details` (speed numbers and
// the like) sit behind "Show details".
function finish(world, game, level, lines, bestText = '', details = []) {
  GameLevels.done({
    host: world.host, game: game.id, level: level.index, levels: game.levels,
    message: [...lines, bestText, 'These scores track your practice, not your health.'].filter(Boolean).join(' '),
    details: details.filter(Boolean),
    onPick: (n) => start(game, n), onLevels: () => levelsFor(game), onExit: () => world.close()
  });
}

function levelsFor(game) {
  const world = worlds[game.id];
  world.render('');
  GameLevels.pick({ host: world.host, game: game.id, title: game.title, kicker: `${game.kicker} · choose a level`, levels: game.levels, about: game.about, onPick: (n) => start(game, n), onExit: () => world.close() });
}

async function start(game, n) {
  const world = worlds[game.id];
  const run = ++world.run;
  const level = { ...game.levels[n], index: n };
  const alive = () => world.run === run && !world.host.hidden;
  const { go, mode } = await intro(world, game, level);
  if (!alive()) return;
  if (!go) return levelsFor(game);
  world.playing = true;
  try {
    await game.play(world, level, alive, mode);
  } finally {
    if (world.run === run) { world.playing = false; world.host.querySelector('[data-action="pause"]')?.remove(); }
  }
}

/* ======================================================================
 * 1. Lumen Garden: spatial working memory span (like the Corsi blocks task)
 * ==================================================================== */

const lumen = {
  id: 'lumen', title: 'Lumen Garden', kicker: 'Working memory', tone: '#c58cff',
  about: { text: 'Practises working memory: holding a short sequence in mind and replaying it. Inspired by span tasks used in research. A small pilot with childhood cancer survivors found gains on similar tasks; results in adults after cancer are early and mixed, and this game itself hasn’t been studied.', cite: 'Hardy et al., Psycho-Oncology 2013', href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4820841/' },
  levels: [
    { name: 'Forward paths', desc: '3 × 3 garden. Sequences start at 3 lights.', size: 3, span: 3, on: 650, backward: false },
    { name: 'Longer paths', desc: '3 × 3 garden. Starts at 4 lights, a little faster.', size: 3, span: 4, on: 520, backward: false },
    { name: 'Bigger garden', desc: '4 × 4 garden. Starts at 5 lights.', size: 4, span: 5, on: 480, backward: false },
    { name: 'Backwards', desc: '4 × 4 garden. Tap the path in reverse order.', size: 4, span: 4, on: 520, backward: true }
  ],
  how: (l) => [
    `Flowers light up one at a time. Then tap them in the <b>${l.backward ? 'reverse' : 'same'}</b> order.`,
    'Get one right and the next path is one flower longer. Miss and it gets one shorter.',
    '14 paths, about 3 minutes.'
  ],
  async play(world, level, alive) {
    const TRIALS = 14;
    let span = level.span, longest = 0, correct = 0;
    const cells = level.size * level.size;
    const panel = world.render(`<main class="world-card bg-card">
      <p class="world-note" data-info></p><p class="game-status" data-status></p>
      <div class="span-grid" style="--n:${level.size}">${Array.from({ length: cells }, (_, i) => `<button data-cell="${i}" aria-label="Flower ${i + 1}" disabled>✿</button>`).join('')}</div>
    </main>`);
    const buttons = [...panel.querySelectorAll('[data-cell]')];
    const status = (t) => { panel.querySelector('[data-status]').textContent = t; };
    for (let trial = 0; trial < TRIALS && alive(); trial++) {
      panel.querySelector('[data-info]').textContent = `Path ${trial + 1} of ${TRIALS} · ${span} flowers${level.backward ? ' · backwards' : ''}`;
      const seq = [];
      while (seq.length < span) { const c = Math.floor(Math.random() * cells); if (c !== seq[seq.length - 1]) seq.push(c); }
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
      if (ok) { correct++; longest = Math.max(longest, span); status(`Yes, ${span} in a row.`); span = Math.min(9, span + 1); }
      else { status('Not quite. The next path is a little shorter.'); span = Math.max(2, span - 1); }
      await world.sleep(1000);
    }
    if (!alive()) return;
    const { best, isNew } = recordBest('lumen', longest);
    finish(world, lumen, level, [`Longest path you got right: ${longest} flowers${level.backward ? ' backwards' : ''}. Paths correct: ${correct} of ${TRIALS}.`], isNew ? 'That is a new personal best!' : `Personal best: ${best}.`);
  }
};

/* ======================================================================
 * 2. Starling Observatory: speed of processing (useful field of view style)
 * ==================================================================== */

const starling = {
  id: 'starling', title: 'Starling Observatory', kicker: 'Processing speed', tone: '#7fb8ff',
  about: {
    text: 'Practises taking in quick glimpses, in the centre and at the edges of your vision. Inspired by speed-of-processing training used in research. An early trial with breast cancer survivors found gains compared with a waiting list, but a stricter later trial by the same team found no clear difference on thinking tests. This game itself hasn’t been studied.',
    cite: 'Von Ah et al., Breast Cancer Research and Treatment 2012', href: 'https://scholarworks.indianapolis.iu.edu/items/6103443c-9611-461c-adc1-1e42f0215fb2',
    more: [{ cite: 'Von Ah et al., Supportive Care in Cancer 2022', href: 'https://scholarworks.indianapolis.iu.edu/items/cc28c83f-bff2-4250-a944-e640a19b5526' }]
  },
  levels: [
    { name: 'Centre', desc: 'Name the symbol that flashes in the centre.', ring: false, clutter: false, start: 400 },
    { name: 'Centre and edge', desc: 'Name the centre symbol and find the comet at the edge.', ring: true, clutter: false, start: 450 },
    { name: 'Busy sky', desc: 'As before, with look-alike stars in the way.', ring: true, clutter: true, start: 500 },
    { name: 'Lightning sky', desc: 'Busy sky, starting with much shorter flashes.', ring: true, clutter: true, start: 260 }
  ],
  how: (l) => [
    'Keep your eyes on the + in the centre. A picture flashes, then is covered up.',
    `Say which symbol was in the centre${l.ring ? ', then tap where the comet ☄ appeared around the edge' : ''}.`,
    'Two right in a row and the flash gets shorter; a miss makes it longer. 20 flashes.'
  ],
  async play(world, level, alive) {
    const TRIALS = 20;
    const SYMBOLS = [['☾', 'Moon'], ['✦', 'Star']];
    let shown = level.start, streak = 0, right = 0;
    const history = [];
    const panel = world.render(`<main class="world-card bg-card">
      <p class="world-note" data-info></p>
      <div class="sky" data-sky><span class="sky-centre" data-centre>+</span>${Array.from({ length: 8 }, (_, i) => `<button class="sky-slot" data-slot="${i}" style="--a:${i * 45}deg" disabled aria-label="Edge position ${i + 1}"></button>`).join('')}<div class="sky-clutter" data-clutter></div></div>
      <p class="game-status" data-status></p>
      <div class="world-controls bg-choices" data-choices hidden>${SYMBOLS.map(([s, n], i) => `<button data-sym="${i}">${i + 1}. ${s} ${n}</button>`).join('')}</div>
    </main>`);
    const $ = (sel) => panel.querySelector(sel);
    const slots = [...panel.querySelectorAll('[data-slot]')];
    const status = (t) => { $('[data-status]').textContent = t; };
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    for (let trial = 0; trial < TRIALS && alive(); trial++) {
      $('[data-info]').textContent = `Flash ${trial + 1} of ${TRIALS}`;
      const sym = Math.floor(Math.random() * 2), slot = Math.floor(Math.random() * 8);
      slots.forEach((s) => { s.textContent = ''; s.disabled = true; s.className = 'sky-slot'; });
      $('[data-centre]').textContent = '+';
      $('[data-clutter]').innerHTML = '';
      status('Eyes on the +');
      await world.sleep(700 + Math.random() * 500);
      if (!alive()) return;
      // Show the picture for `shown` ms, timed to screen refreshes.
      $('[data-centre]').textContent = SYMBOLS[sym][0];
      if (level.ring) {
        slots[slot].textContent = '☄';
        if (level.clutter) {
          slots.forEach((s, i) => { if (i !== slot) s.textContent = '✧'; });
          $('[data-clutter]').innerHTML = Array.from({ length: 10 }, () => `<i style="left:${10 + Math.random() * 80}%;top:${10 + Math.random() * 80}%">✧</i>`).join('');
        }
      }
      const t0 = performance.now();
      await frame();
      while (performance.now() - t0 < shown - 8) await frame();
      // Mask: cover everything with noise so the picture can't linger.
      $('[data-centre]').textContent = '▩';
      slots.forEach((s) => { s.textContent = '▩'; });
      $('[data-clutter]').innerHTML = Array.from({ length: 16 }, () => `<i style="left:${Math.random() * 90}%;top:${Math.random() * 90}%">▩</i>`).join('');
      await world.sleep(250);
      $('[data-centre]').textContent = '?';
      slots.forEach((s) => { s.textContent = ''; });
      $('[data-clutter]').innerHTML = '';
      status('Which symbol was in the centre?');
      $('[data-choices]').hidden = false;
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
        slotOk = await new Promise((resolve) => { slots.forEach((s, i) => { s.onclick = () => resolve(i === slot); }); });
        slots.forEach((s) => { s.disabled = true; s.onclick = null; });
        slots[slot].classList.add('answer');
        slots[slot].textContent = '☄';
      }
      const ok = symOk && slotOk;
      history.push(shown);
      if (ok) { right++; status('Right.'); if (++streak >= 2) { streak = 0; shown = Math.max(17, shown * 0.8); } }
      else { streak = 0; status(!symOk ? `It was ${SYMBOLS[sym][0]} ${SYMBOLS[sym][1]}.` : 'The comet was here.'); shown = Math.min(800, shown * 1.25); }
      await world.sleep(ok ? 500 : 1100);
    }
    if (!alive()) return;
    const threshold = Math.round(history.slice(-6).reduce((a, b) => a + b, 0) / Math.min(6, history.length));
    const { best, isNew } = recordBest('starling', threshold, true);
    finish(world, starling, level, [
      `You got ${right} of ${TRIALS} right.`,
      threshold < level.start ? 'The flashes got shorter as you went: you were taking in more at a glance.' : 'The flashes stayed about the same length. That’s fine; it often takes a few sessions.'
    ], '', [`Flash length it settled at: about ${threshold} ms (shorter means quicker).`, isNew ? 'That is a new personal best.' : `Personal best: ${best} ms.`]);
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

const cloudpath = {
  id: 'cloudpath', title: 'Cloudpath Cartographer', kicker: 'Planning', tone: '#f6d184',
  about: { text: 'Practises planning ahead: working out a whole sequence of moves before you make them. Inspired by Tower of London puzzles used in research. A small trial with breast cancer survivors found gains on some thinking tests from home-based online training compared with a waiting list; results across studies are mixed, and this game itself hasn’t been studied.', cite: 'Kesler et al., Clinical Breast Cancer 2013', href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3726272/' },
  levels: [
    { name: 'Short routes', desc: 'Puzzles that take 2 to 3 moves.', target: 3 },
    { name: 'Four moves', desc: 'Puzzles that take 4 moves.', target: 4 },
    { name: 'Five moves', desc: 'Puzzles that take 5 moves.', target: 5 },
    { name: 'Long routes', desc: 'Puzzles that take 6 to 7 moves.', target: 6 }
  ],
  how: () => [
    'Move the lanterns so your clouds match the goal. Clouds hold 3, 2 and 1 lantern, and you can only move the top one.',
    'Tap a cloud to lift its top lantern, then tap where it goes. <b>Plan the whole route first</b>: the aim is the fewest possible moves.',
    'Solve it in the fewest moves and the next puzzle needs one more. 8 puzzles.'
  ],
  async play(world, level, alive) {
    const PUZZLES = 8;
    let target = level.target, perfect = 0, hardest = 0;
    for (let n = 0; n < PUZZLES && alive(); n++) {
      const startKey = pick(STATES);
      const d = distances(startKey);
      let need = target;
      let goals = [...d].filter(([, v]) => v === need);
      while (!goals.length) goals = [...d].filter(([, v]) => v === --need);
      const goal = pick(goals)[0];
      let state = parse(startKey), held = null, count = 0, firstMove = 0;
      const t0 = world.now();
      const panel = world.render(`<main class="world-card bg-card">
        <p class="world-note">Puzzle ${n + 1} of ${PUZZLES} · fewest possible: ${need} moves</p>
        <div class="tol-goal"><small>Goal</small><div class="tol" data-goal></div></div>
        <div class="tol tol-play" data-play></div>
        <p class="game-status" data-status>Plan your route, then start moving.</p>
        <div class="world-controls"><button data-reset>Start over</button><button data-skip>Skip this puzzle</button></div>
      </main>`);
      const draw = (el, s, live) => {
        el.innerHTML = s.map((peg, i) => `<${live ? 'button' : 'div'} class="tol-peg" data-peg="${i}" style="--cap:${CAP[i]}" ${live ? `aria-label="Cloud ${i + 1}"` : ''}>${peg.map((b, j) => `<i style="background:${COLORS[b]}" class="${live && held === i && j === peg.length - 1 ? 'held' : ''}"></i>`).join('')}</${live ? 'button' : 'div'}>`).join('');
      };
      draw(panel.querySelector('[data-goal]'), parse(goal), false);
      const solved = await new Promise((resolve) => {
        const redraw = () => {
          draw(panel.querySelector('[data-play]'), state, true);
          panel.querySelectorAll('[data-peg]').forEach((el) => {
            el.onclick = () => {
              const i = +el.dataset.peg;
              if (held === null) { if (state[i].length) held = i; }
              else if (held === i) held = null;
              else if (state[i].length < CAP[i]) {
                state[i].push(state[held].pop());
                held = null;
                if (!count++) firstMove = world.now() - t0;
                panel.querySelector('[data-status]').textContent = `Moves: ${count}`;
                if (key(state) === goal) { redraw(); resolve(true); return; }
              }
              redraw();
            };
          });
        };
        panel.querySelector('[data-reset]').onclick = () => { state = parse(startKey); held = null; panel.querySelector('[data-status]').textContent = `Back to the start. Moves so far: ${count}`; redraw(); };
        panel.querySelector('[data-skip]').onclick = () => resolve(false);
        redraw();
      });
      if (!alive()) return;
      const isPerfect = solved && count === need;
      if (isPerfect) { perfect++; hardest = Math.max(hardest, need); target = Math.min(8, need + 1); }
      else if (!solved || count > need + 2) target = Math.max(2, need - 1);
      panel.querySelector('[data-status]').textContent = isPerfect
        ? `Perfect: ${count} moves${firstMove > 4000 ? `, after ${Math.round(firstMove / 1000)} s of planning` : ''}.`
        : !solved ? 'Skipped. The next puzzle is a little shorter.'
        : `Solved in ${count} moves (fewest possible: ${need}). Try planning the whole route before the first move.`;
      await world.sleep(1600);
    }
    if (!alive()) return;
    const { best, isNew } = recordBest('cloudpath', hardest);
    finish(world, cloudpath, level, [`Perfect solutions: ${perfect} of ${PUZZLES}. Longest route solved perfectly: ${hardest || 'none yet'}${hardest ? ' moves' : ''}.`], isNew && hardest ? 'That is a new personal best!' : best ? `Personal best: ${best} moves.` : '');
  }
};

/* ======================================================================
 * 4. Story Echo: verbal memory (word lists, with a linking strategy)
 * ==================================================================== */

const WORDS = {
  fruit: ['apple', 'lemon', 'grape', 'peach', 'cherry', 'mango', 'plum', 'melon', 'pear', 'kiwi'],
  animals: ['horse', 'otter', 'eagle', 'tiger', 'rabbit', 'whale', 'goose', 'zebra', 'camel', 'fox'],
  tools: ['hammer', 'ladder', 'shovel', 'wrench', 'needle', 'brush', 'drill', 'rake', 'saw', 'chisel'],
  places: ['beach', 'castle', 'garden', 'harbor', 'library', 'market', 'meadow', 'museum', 'island', 'bridge'],
  clothing: ['scarf', 'jacket', 'boot', 'glove', 'apron', 'sweater', 'sock', 'belt', 'vest', 'sandal'],
  weather: ['thunder', 'breeze', 'frost', 'rain', 'fog', 'hail', 'sunshine', 'snow', 'storm', 'drizzle'],
  music: ['violin', 'drum', 'flute', 'piano', 'harp', 'trumpet', 'guitar', 'cello', 'banjo', 'organ'],
  kitchen: ['kettle', 'spoon', 'ladle', 'oven', 'plate', 'whisk', 'teapot', 'bowl', 'grater', 'skillet']
};
// Gentle lists stop growing at 12 words so the recall screen stays short.
const echoMax = (mode) => (mode === 'challenge' ? 16 : 12);

const echo = {
  id: 'echo', title: 'Story Echo', kicker: 'Verbal memory', tone: '#e7b574',
  modes: true, challengeNote: 'Each word shows for a set time, quicker on the last level.',
  about: {
    text: 'Practises remembering words, using strategies like linking them into a story. Inspired by memory training used in research. An early trial with breast cancer survivors found memory gains compared with a waiting list, but its authors called it preliminary, and a stricter later trial of brain training by the same team found no clear difference on thinking tests. This game itself hasn’t been studied.',
    cite: 'Von Ah et al., Breast Cancer Research and Treatment 2012', href: 'https://scholarworks.indianapolis.iu.edu/items/6103443c-9611-461c-adc1-1e42f0215fb2',
    more: [{ cite: 'Von Ah et al., Supportive Care in Cancer 2022', href: 'https://scholarworks.indianapolis.iu.edu/items/cc28c83f-bff2-4250-a944-e640a19b5526' }]
  },
  levels: [
    { name: 'Short lists', desc: 'Lists start at 6 words.', words: 6, pace: 1700 },
    { name: 'Longer lists', desc: 'Lists start at 8 words.', words: 8, pace: 1600 },
    { name: 'Long lists', desc: 'Lists start at 10 words.', words: 10, pace: 1500 },
    { name: 'Long and quick', desc: 'Lists start at 12 words. In Challenge, words show faster.', words: 12, pace: 1150 }
  ],
  how: (l, mode) => [
    mode === 'challenge'
      ? `Words appear one at a time, for about ${(l.pace / 1000).toFixed(1)} seconds each. Then pick out every word you saw from a mix of old and new.`
      : 'Words appear one at a time. Press <b>Next word</b> (or Space) whenever you’re ready. Then pick out every word you saw from a mix of old and new.',
    '<b>Strategy:</b> make up a tiny story that links the words, like “the horse ate a lemon on the bridge.” The words also come in pairs from the same group, which helps.',
    `Remember at least 85% and the next list is 2 words longer. 5 lists, starting at ${Math.min(l.words, echoMax(mode))} words.`
  ],
  async play(world, level, alive, mode) {
    const LISTS = 5, gentle = mode !== 'challenge', max = echoMax(mode);
    let n = Math.min(level.words, max), bestLen = 0, totalHits = 0, totalShown = 0;
    let speak = false;
    for (let list = 0; list < LISTS && alive(); list++) {
      const groups = shuffle(Object.keys(WORDS)).slice(0, Math.ceil(n / 2));
      const chosen = [], lures = [];
      groups.forEach((g) => { const w = shuffle(WORDS[g]); chosen.push(...w.slice(0, 2)); lures.push(...w.slice(2, 4)); });
      const list_ = shuffle(chosen.slice(0, n));
      const foils = shuffle(lures).slice(0, n);
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
      const options = shuffle([...list_, ...foils]);
      const recall = world.render(`<main class="world-card bg-card">
        <p class="world-note">List ${list + 1} of ${LISTS} · pick the ${n} words you saw</p>
        <div class="word-grid">${options.map((w) => `<button data-w="${w}" aria-pressed="false">${w}</button>`).join('')}</div>
        <p class="game-status" data-status>Selected: 0</p>
        <div class="world-controls"><button data-done class="bg-primary">Done</button></div>
      </main>`);
      const chosenSet = new Set();
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
      // Marks use a symbol as well as a colour: ✓ found, ○ missed, ✗ not on the list.
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
      else if (score < 0.6) n = Math.max(4, n - 2);
      await new Promise((r) => { const b = recall.querySelector('[data-done]'); b.textContent = list + 1 < LISTS ? 'Next list' : 'See results'; b.onclick = r; });
    }
    if (!alive()) return;
    const { best, isNew } = recordBest('echo', bestLen);
    finish(world, echo, level, [`You remembered ${totalHits} of ${totalShown} words. Longest list at 85% or better: ${bestLen || 'not yet'}${bestLen ? ' words' : ''}.`], isNew && bestLen ? 'That is a new personal best!' : best ? `Personal best: ${best} words.` : '');
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
  about: { text: 'Practises gentle, accurate finger movements and picking up a pattern. Fine-motor and sensorimotor training are being studied for hand symptoms after chemotherapy; the evidence is still early, and this game itself hasn’t been studied.', cite: 'Feasibility trial, Supportive Care in Cancer 2025', href: 'https://link.springer.com/article/10.1007/s00520-025-09712-2' },
  safety: 'Rest your hands comfortably and tap lightly. Stop if you feel pain, cramping, or more numbness or tingling than usual, and tell your care team about new or worse symptoms.',
  levels: [
    { name: 'Two pads', desc: 'Two big pads: F and J.', pads: 2, interval: 1100 },
    { name: 'Three pads', desc: 'Three pads: D, F and J.', pads: 3, interval: 950 },
    { name: 'Four pads', desc: 'All four pads: D, F, J and K.', pads: 4, interval: 800 },
    { name: 'Four pads, brisk', desc: 'All four pads. Challenge starts a little quicker.', pads: 4, interval: 650 }
  ],
  how: (l, mode) => {
    const keys = PAD_SETS[l.pads].map((i) => PADS[i][0]);
    return [
      mode === 'challenge'
        ? `${l.pads} pads light up one at a time. Tap the lit pad (or press <b>${keys.join(' ')}</b>) before the next one lights.`
        : `${l.pads} pads light up one at a time. Tap the lit pad (or press <b>${keys.join(' ')}</b>). It waits for you, and a wrong tap doesn’t count against you.`,
      'There is a hidden pattern. You don’t need to look for it; your hands may start to learn it.',
      mode === 'challenge'
        ? 'Catch almost every light in a round and the pace speeds up a little; miss a few and it slows down. 8 rounds of 8 lights.'
        : 'No timer and no speed scores. 8 short rounds of 8 lights.'
    ];
  },
  async play(world, level, alive, mode) {
    const gentle = mode !== 'challenge';
    const pads_ = PAD_SETS[level.pads].map((i) => PADS[i]);
    const SEQ = tapPattern(pads_.length);
    const ROUNDS = 8, RANDOM_ROUND = 6; // round 7 is mixed up, to see what the pattern taught your hands
    let interval = Math.max(RHYTHM_FASTEST, level.interval), fastest = Infinity, hitsAll = 0;
    const rts = { pattern: [], random: [] };
    const panel = world.render(`<main class="world-card bg-card">
      <p class="world-note" data-info></p>
      <div class="rhythm-row" data-count="${pads_.length}">${pads_.map(([k, icon], i) => `<button class="pad" data-pad="${i}" aria-label="Pad ${k}">${icon}<small>${k}</small></button>`).join('')}</div>
      <p class="game-status" data-status></p>
    </main>`);
    const pads = [...panel.querySelectorAll('[data-pad]')];
    const status = (t) => { panel.querySelector('[data-status]').textContent = t; };
    // Taps closer together than 150 ms count once, so a shaky double tap isn't a mistake.
    let tap = null, lastTap = -Infinity;
    const press = (i) => { const t = world.now(); if (t - lastTap < 150) return; lastTap = t; tap && tap(i); };
    pads.forEach((p, i) => { p.onpointerdown = (e) => { e.preventDefault(); press(i); }; });
    world.keyHandler = (e) => {
      if (e.repeat) return;
      const i = pads_.findIndex(([k]) => k.toLowerCase() === e.key.toLowerCase());
      if (i >= 0) { e.preventDefault(); press(i); }
    };
    const clear = () => pads.forEach((p) => p.classList.remove('active', 'good', 'bad'));
    for (let round = 0; round < ROUNDS && alive(); round++) {
      const seq = round === RANDOM_ROUND ? tapPattern(pads_.length) : SEQ;
      panel.querySelector('[data-info]').textContent = `Round ${round + 1} of ${ROUNDS}${gentle ? '' : ' · Challenge'}`;
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
    const perMinute = fastest === Infinity ? 0 : Math.round(60000 / fastest);
    const record = perMinute ? recordBest('rhythm-challenge', perMinute) : null;
    finish(world, rhythm, level, [`You caught ${hitsAll} of ${ROUNDS * 8} lights in time.`, patternLine], '', [
      `Average reaction: ${Math.round(mean([...rts.pattern, ...rts.random]))} ms.`,
      perMinute ? `Quickest pace you kept up with: ${perMinute} lights a minute.` : 'No round was quick enough to count toward a personal best yet.',
      learned > 30 ? `On the hidden pattern you were about ${learned} ms quicker than on the mixed-up round.` : '',
      record ? (record.isNew ? 'That is a new Challenge personal best.' : `Challenge personal best: ${record.best} a minute.`) : ''
    ]);
  }
};

/* ======================================================================
 * 6. Signal Match: mental flexibility (task switching)
 * ==================================================================== */

// Colour is only decoration: both rules (shape and fill) can be seen without it.
const SIGNAL_TONES = ['#ff9a62', '#5fa8ff', '#8fe3a4', '#f6d184', '#d8a4f0'];
const SIGNAL_FASTEST = 1000; // Challenge always leaves at least 1 second to answer

const signal = {
  id: 'signal', title: 'Signal Match', kicker: 'Mental flexibility', tone: '#d8a4f0',
  modes: true, challengeNote: 'A timer bar. Answer well and the time shrinks, never below 1 second.',
  about: { text: 'Practises switching between two rules, a part of mental flexibility. Inspired by task-switching exercises used in research. A small trial with breast cancer survivors found gains on flexibility tests from online training compared with a waiting list; results across studies are mixed, and this game itself hasn’t been studied.', cite: 'Kesler et al., Clinical Breast Cancer 2013', href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3726272/' },
  levels: [
    { name: 'One rule at a time', desc: 'The rule changes every 10 signals.', switchEvery: 10, p: 0, deadline: 3000 },
    { name: 'Some switches', desc: 'The rule changes about 1 time in 3.', p: 0.3, deadline: 2500 },
    { name: 'Frequent switches', desc: 'The rule changes about half the time.', p: 0.5, deadline: 2000 },
    { name: 'Fast switching', desc: 'Half the time. In Challenge, with less time to answer.', p: 0.5, deadline: 1300 }
  ],
  how: (l, mode) => [
    'Each signal is a shape that is either <b>solid</b> or just an <b>outline</b>. The word on top tells you which to sort by.',
    '<b>SHAPE</b>: round → left, pointed → right. <b>FILL</b>: solid → left, outline → right. Use the buttons or <b>F</b> and <b>J</b>.',
    mode === 'challenge'
      ? 'A bar shows your time. Get one right and you get a little less time; miss and you get more. 40 signals.'
      : 'No timer: each signal waits for your answer. 40 signals.'
  ],
  async play(world, level, alive, mode) {
    const TRIALS = 40, challenge = mode === 'challenge';
    let deadline = Math.max(SIGNAL_FASTEST, level.deadline), rule = Math.random() < 0.5 ? 'shape' : 'fill';
    let correct = 0;
    const rt = { switch: [], stay: [] };
    const panel = world.render(`<main class="world-card bg-card">
      <p class="world-note" data-info></p>
      <p class="switch-rule" data-rule></p>
      <div class="switch-card" data-card></div>
      ${challenge ? '<div class="switch-bar"><i data-bar></i></div>' : ''}
      <div class="world-controls bg-choices"><button data-side="0">F · Round / Solid</button><button data-side="1">J · Pointed / Outline</button></div>
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
    if (!challenge) return finish(world, signal, level, lines);
    const all = Math.round(mean([...rt.switch, ...rt.stay]));
    const cost = rt.switch.length && rt.stay.length ? Math.round(mean(rt.switch) - mean(rt.stay)) : null;
    const record = accuracy >= 85 ? recordBest('signal-challenge', all, true) : null; // best: fastest average with 85% right
    finish(world, signal, level, lines, '', [
      `Average answer: ${all} ms.`,
      cost !== null ? `Switch cost: ${cost} ms (the extra time a rule change takes; it often shrinks with practice).` : '',
      record ? (record.isNew ? 'That is a new Challenge personal best.' : `Challenge personal best: ${record.best} ms with 85% or more right.`) : 'Get 85% right to set a Challenge personal best.'
    ]);
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
  worlds[game.id].open();
  levelsFor(game);
}, true);

// Listens in the capture phase so an Escape used to leave a game stops here, instead of also
// closing the games library underneath.
addEventListener('keydown', (event) => {
  const world = Object.values(worlds).find((w) => !w.host.hidden);
  if (!world) return;
  if (event.key === 'Escape') { event.stopImmediatePropagation(); world.close(); return; }
  if (world.paused) return;
  if (world.keyHandler) world.keyHandler(event);
}, true);

// Switching to another tab or app pauses a game that's under way.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) Object.values(worlds).forEach((w) => w.pause());
});
