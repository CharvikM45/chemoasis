/*
 * The six brain games. Each one is an adaptive version of a task used in cognitive training
 * research with people after cancer treatment: it gets harder after you succeed and easier after
 * you miss, so it stays challenging. Sessions are a few minutes long.
 *
 *   lumen      Lumen Garden            spatial working memory span (forward, then backward)
 *   starling   Starling Observatory    speed of processing (brief flashes, centre + periphery)
 *   cloudpath  Cloudpath Cartographer  planning (Tower of London puzzles)
 *   echo       Story Echo              verbal memory (word lists, grouping strategy)
 *   rhythm     Finger Rhythm           paced finger tapping with a hidden repeating sequence
 *   signal     Signal Match            mental flexibility (switching between two sorting rules)
 *
 * Opening a game: a click on any [data-game] element (the library cards, ?play= links).
 * Levels set where a session starts; results and personal bests are shown at the end.
 */
import * as THREE from 'three';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* ---------- personal bests (this browser) ---------- */

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
  }
  render(body) {
    this.host.innerHTML = `<div class="world-panel"><header class="world-top"><div><p class="world-kicker">${esc(this.game.kicker)}</p><h2>${esc(this.game.title)}</h2></div><button data-action="exit">Exit game</button></header>${body}</div>`;
    this.host.querySelector('[data-action="exit"]').onclick = () => this.close();
    if (this.renderer) this.host.prepend(this.renderer.domElement);
    return this.host.querySelector('.world-panel');
  }
  scene() {
    if (this.renderer) return;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: !reduceMotion, alpha: true, powerPreference: 'high-performance' });
    } catch (_) { return; } // no 3D: the game still works on its plain background
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.host.prepend(this.renderer.domElement);
    this.scene3 = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    this.camera.position.set(0, 1.2, 10);
    this.scene3.add(new THREE.HemisphereLight('#c9e9ff', '#101522', 1.7));
    const key = new THREE.PointLight(this.game.tone, 4, 28);
    key.position.set(0, 5, 3);
    this.scene3.add(key);
    this.group = new THREE.Group();
    this.scene3.add(this.group);
    const geometry = {
      lumen: () => new THREE.IcosahedronGeometry(1.1, 0),
      starling: () => new THREE.OctahedronGeometry(1.1),
      cloudpath: () => new THREE.DodecahedronGeometry(1.1),
      echo: () => new THREE.TorusGeometry(0.9, 0.28, 12, 32),
      rhythm: () => new THREE.CylinderGeometry(0.8, 0.8, 0.18, 32),
      signal: () => new THREE.TetrahedronGeometry(1.2)
    }[this.game.id]();
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: this.game.tone, emissive: this.game.tone, emissiveIntensity: 0.3, roughness: 0.35, metalness: 0.2, transparent: true, opacity: 0.4, flatShading: true }));
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
    this.scene();
    this.host.hidden = false;
    document.body.style.overflow = 'hidden';
    this.resize();
    this.tick();
  }
  tick() {
    if (!this.renderer) return;
    this.raf = requestAnimationFrame(() => this.tick());
    if (!reduceMotion) { this.group.rotation.y += 0.0015; this.group.children.forEach((m, i) => { m.rotation.x += 0.002 + i * 0.0003; }); }
    this.renderer.render(this.scene3, this.camera);
  }
  close() {
    this.run++;
    cancelAnimationFrame(this.raf);
    GameLevels.close(this.host);
    this.host.hidden = true;
    // Back to the games library if it's open underneath, otherwise back to the page.
    document.body.style.overflow = document.querySelector('#experience-view:not([hidden])') ? 'hidden' : '';
    window.speechSynthesis && speechSynthesis.cancel();
  }
}

/* ---------- shared screens ---------- */

// "How it works" card before a session. Resolves when the player presses Start.
function intro(world, level, lines, safety) {
  const panel = world.render(`<main class="world-card bg-card">
    <p class="world-note">Level ${level.index + 1} · ${esc(level.name)}</p>
    <ul class="bg-how">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    ${safety ? `<p class="bg-safety">${safety}</p>` : ''}
    <div class="world-controls"><button data-go class="bg-primary">Start</button><button data-levels>All levels</button></div>
  </main>`);
  return new Promise((resolve) => {
    panel.querySelector('[data-go]').onclick = () => resolve(true);
    panel.querySelector('[data-levels]').onclick = () => resolve(false);
    panel.querySelector('[data-go]').focus();
  });
}

// The level-complete screen, with this session's results and the personal best.
function finish(world, game, level, lines, bestText) {
  GameLevels.done({
    host: world.host, game: game.id, level: level.index, levels: game.levels,
    message: `${lines.join(' ')} ${bestText} These scores track your practice, not your health.`,
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
  const go = await intro(world, level, game.how(level), game.safety);
  if (!alive()) return;
  if (!go) return levelsFor(game);
  await game.play(world, level, alive);
}

/* ======================================================================
 * 1. Lumen Garden: spatial working memory span (like the Corsi blocks task)
 * ==================================================================== */

const lumen = {
  id: 'lumen', title: 'Lumen Garden', kicker: 'Working memory', tone: '#c58cff',
  about: { text: 'Trains working memory: holding a sequence in mind and replaying it. Adaptive working-memory training improved visual working memory in a randomized pilot with childhood cancer survivors.', cite: 'Hardy et al., Psycho-Oncology 2013', href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4820841/' },
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
      await wait(700);
      for (const c of seq) {
        if (!alive()) return;
        buttons[c].classList.add('lit');
        await wait(level.on);
        buttons[c].classList.remove('lit');
        await wait(220);
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
      await wait(1000);
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
  about: { text: 'Trains how quickly you take in what you see, in the centre and at the edges of your vision. Speed-of-processing training improved processing speed, with benefits for memory, in a randomized trial with breast cancer survivors.', cite: 'Von Ah et al., Breast Cancer Research and Treatment 2012', href: 'https://scholarworks.indianapolis.iu.edu/items/6103443c-9611-461c-adc1-1e42f0215fb2' },
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
      $('[data-info]').textContent = `Flash ${trial + 1} of ${TRIALS} · ${Math.round(shown)} ms`;
      const sym = Math.floor(Math.random() * 2), slot = Math.floor(Math.random() * 8);
      slots.forEach((s) => { s.textContent = ''; s.disabled = true; s.className = 'sky-slot'; });
      $('[data-centre]').textContent = '+';
      $('[data-clutter]').innerHTML = '';
      status('Eyes on the +');
      await wait(700 + Math.random() * 500);
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
      await wait(250);
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
      await wait(ok ? 500 : 1100);
    }
    if (!alive()) return;
    const threshold = Math.round(history.slice(-6).reduce((a, b) => a + b, 0) / Math.min(6, history.length));
    const { best, isNew } = recordBest('starling', threshold, true);
    finish(world, starling, level, [`Your flash speed settled around ${threshold} ms (shorter is faster). Right: ${right} of ${TRIALS}.`], isNew ? 'That is a new personal best!' : `Personal best: ${best} ms.`);
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
  about: { text: 'Trains planning ahead: working out a whole sequence of moves before you make them. Home-based executive-function training improved mental flexibility and processing speed in a randomized trial with breast cancer survivors.', cite: 'Kesler et al., Clinical Breast Cancer 2013', href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3726272/' },
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
      const t0 = performance.now();
      const panel = world.render(`<main class="world-card bg-card">
        <p class="world-note">Puzzle ${n + 1} of ${PUZZLES} · fewest possible: ${need} moves</p>
        <div class="tol-goal"><small>Goal</small><div class="tol" data-goal></div></div>
        <div class="tol tol-play" data-play></div>
        <p class="game-status" data-status>Plan your route, then start moving.</p>
        <div class="world-controls"><button data-reset>Start over</button></div>
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
                if (!count++) firstMove = performance.now() - t0;
                panel.querySelector('[data-status]').textContent = `Moves: ${count}`;
                if (key(state) === goal) { redraw(); resolve(true); return; }
              }
              redraw();
            };
          });
        };
        panel.querySelector('[data-reset]').onclick = () => { state = parse(startKey); held = null; panel.querySelector('[data-status]').textContent = `Back to the start. Moves so far: ${count}`; redraw(); };
        redraw();
      });
      if (!alive()) return;
      const isPerfect = solved && count === need;
      if (isPerfect) { perfect++; hardest = Math.max(hardest, need); target = Math.min(8, need + 1); }
      else if (count > need + 2) target = Math.max(2, need - 1);
      panel.querySelector('[data-status]').textContent = isPerfect
        ? `Perfect: ${count} moves${firstMove > 4000 ? `, after ${Math.round(firstMove / 1000)} s of planning` : ''}.`
        : `Solved in ${count} moves (fewest possible: ${need}). Try planning the whole route before the first move.`;
      await wait(1600);
    }
    if (!alive()) return;
    const { best, isNew } = recordBest('cloudpath', hardest);
    finish(world, cloudpath, level, [`Perfect solutions: ${perfect} of ${PUZZLES}. Longest route solved perfectly: ${hardest || 'none yet'}${hardest ? ' moves' : ''}.`], isNew && hardest ? 'That is a new personal best!' : `Personal best: ${best} moves.`);
  }
};

/* ======================================================================
 * 4. Story Echo: verbal memory (word lists, with a grouping strategy)
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

const echo = {
  id: 'echo', title: 'Story Echo', kicker: 'Verbal memory', tone: '#e7b574',
  about: { text: 'Trains remembering what you read, using memory strategies like grouping. Memory training improved memory at two months in a randomized trial with breast cancer survivors.', cite: 'Von Ah et al., Breast Cancer Research and Treatment 2012', href: 'https://scholarworks.indianapolis.iu.edu/items/6103443c-9611-461c-adc1-1e42f0215fb2' },
  levels: [
    { name: 'Short lists', desc: 'Lists start at 6 words.', words: 6, pace: 1700 },
    { name: 'Longer lists', desc: 'Lists start at 8 words.', words: 8, pace: 1600 },
    { name: 'Long lists', desc: 'Lists start at 10 words.', words: 10, pace: 1500 },
    { name: 'Long and quick', desc: 'Lists start at 12 words, shown faster.', words: 12, pace: 1150 }
  ],
  how: (l) => [
    `Words appear one at a time. Then pick out every word you saw from a mix of old and new.`,
    '<b>Strategy:</b> the words come in pairs from the same group (fruit, tools…). Notice the groups, or link the words into one silly picture.',
    `Remember at least 85% and the next list is 2 words longer. 5 lists, starting at ${l.words} words.`
  ],
  async play(world, level, alive) {
    const LISTS = 5;
    let n = level.words, bestLen = 0, totalHits = 0, totalShown = 0;
    let speak = false;
    for (let list = 0; list < LISTS && alive(); list++) {
      const groups = shuffle(Object.keys(WORDS)).slice(0, Math.ceil(n / 2));
      const chosen = [], lures = [];
      groups.forEach((g) => { const w = shuffle(WORDS[g]); chosen.push(...w.slice(0, 2)); lures.push(...w.slice(2, 4)); });
      const list_ = shuffle(chosen.slice(0, n));
      const foils = shuffle(lures).slice(0, n);
      const panel = world.render(`<main class="world-card bg-card">
        <p class="world-note">List ${list + 1} of ${LISTS} · ${n} words</p>
        <p class="word-show" data-word aria-live="polite">Ready…</p>
        <div class="world-controls"><button data-speak aria-pressed="${speak}">Read words aloud</button></div>
      </main>`);
      panel.querySelector('[data-speak]').onclick = (e) => { speak = !speak; e.currentTarget.setAttribute('aria-pressed', String(speak)); };
      await wait(1200);
      for (const w of list_) {
        if (!alive()) return;
        panel.querySelector('[data-word]').textContent = w;
        if (speak && window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(w));
        await wait(level.pace);
        panel.querySelector('[data-word]').textContent = '';
        await wait(250);
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
      recall.querySelectorAll('[data-w]').forEach((b) => { b.disabled = true; if (list_.includes(b.dataset.w)) b.classList.add(chosenSet.has(b.dataset.w) ? 'hit' : 'missed'); else if (chosenSet.has(b.dataset.w)) b.classList.add('wrong'); });
      recall.querySelector('[data-status]').textContent = `${hits} of ${n} found${falseAlarms ? `, ${falseAlarms} not on the list` : ''}.`;
      if (score >= 0.85) { bestLen = Math.max(bestLen, n); n = Math.min(16, n + 2); }
      else if (score < 0.6) n = Math.max(4, n - 2);
      await new Promise((r) => { const b = recall.querySelector('[data-done]'); b.textContent = list + 1 < LISTS ? 'Next list' : 'See results'; b.onclick = r; });
    }
    if (!alive()) return;
    const { best, isNew } = recordBest('echo', bestLen);
    finish(world, echo, level, [`Words remembered: ${totalHits} of ${totalShown}. Longest list at 85% or better: ${bestLen || 'not yet'}${bestLen ? ' words' : ''}.`], isNew && bestLen ? 'That is a new personal best!' : `Personal best: ${best} words.`);
  }
};

/* ======================================================================
 * 5. Finger Rhythm: paced tapping with a hidden repeating sequence
 * ==================================================================== */

const PADS = [['D', '☾'], ['F', '⌁'], ['J', '✦'], ['K', '◉']];
const rhythm = {
  id: 'rhythm', title: 'Finger Rhythm', kicker: 'Hand coordination', tone: '#8ed9c3',
  about: { text: 'Practises quick, accurate finger movements and picking up a pattern. Fine-motor and sensorimotor training are being studied for hand symptoms after chemotherapy; the evidence is still early.', cite: 'Feasibility trial, Supportive Care in Cancer 2025', href: 'https://link.springer.com/article/10.1007/s00520-025-09712-2' },
  safety: 'Rest your hands comfortably and tap lightly. Stop if you feel pain, cramping, or more numbness or tingling than usual, and tell your care team about new or worse symptoms.',
  levels: [
    { name: 'Steady', desc: 'A new light every 1.1 seconds.', interval: 1100 },
    { name: 'Brisk', desc: 'Starts at a light every 0.85 seconds.', interval: 850 },
    { name: 'Quick', desc: 'Starts at a light every 0.65 seconds.', interval: 650 },
    { name: 'Rapid', desc: 'Starts at a light every 0.5 seconds.', interval: 500 }
  ],
  how: () => [
    'Four pads light up one at a time. Tap the lit pad (or press <b>D F J K</b>) before the next one lights.',
    'There is a hidden pattern. You don’t need to look for it; your hands will start to learn it.',
    'Hit almost every light in a round and the pace speeds up. 8 rounds of 8 lights.'
  ],
  async play(world, level, alive) {
    const SEQ = shuffle([0, 1, 2, 3, 0, 1, 2, 3]).filter((v, i, a) => i === 0 || v !== a[i - 1]);
    while (SEQ.length < 8) SEQ.push((SEQ[SEQ.length - 1] + 2) % 4);
    const ROUNDS = 8, RANDOM_ROUND = 6; // round 7 is random, to see what the pattern taught your hands
    let interval = level.interval, fastest = Infinity;
    const rts = { pattern: [], random: [] };
    let hitsAll = 0;
    const panel = world.render(`<main class="world-card bg-card">
      <p class="world-note" data-info></p>
      <div class="rhythm-row">${PADS.map(([k, icon], i) => `<button class="pad" data-pad="${i}" aria-label="Pad ${k}">${icon}<small>${k}</small></button>`).join('')}</div>
      <p class="game-status" data-status></p>
    </main>`);
    const pads = [...panel.querySelectorAll('[data-pad]')];
    let tap = null;
    pads.forEach((p, i) => { p.onpointerdown = (e) => { e.preventDefault(); tap && tap(i); }; });
    world.keyHandler = (e) => { const i = 'dfjk'.indexOf(e.key.toLowerCase()); if (i >= 0) { e.preventDefault(); tap && tap(i); } };
    for (let round = 0; round < ROUNDS && alive(); round++) {
      const seq = round === RANDOM_ROUND ? SEQ.map(() => Math.floor(Math.random() * 4)) : SEQ;
      panel.querySelector('[data-info]').textContent = `Round ${round + 1} of ${ROUNDS} · ${Math.round(60000 / interval)} lights a minute`;
      panel.querySelector('[data-status]').textContent = 'Get ready…';
      await wait(900);
      let hits = 0;
      for (const target of seq) {
        if (!alive()) return;
        pads.forEach((p) => p.classList.remove('active', 'good', 'bad'));
        pads[target].classList.add('active');
        const shownAt = performance.now();
        const result = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), interval);
          tap = (i) => { clearTimeout(timer); resolve({ i, rt: performance.now() - shownAt }); };
        });
        tap = null;
        if (result && result.i === target) {
          hits++;
          pads[target].classList.add('good');
          (round === RANDOM_ROUND ? rts.random : rts.pattern).push(result.rt);
          await wait(Math.max(0, interval - result.rt) * 0.35);
        } else {
          pads[target].classList.add('bad');
          if (result) await wait(Math.max(0, interval - result.rt) * 0.35);
        }
      }
      pads.forEach((p) => p.classList.remove('active', 'good', 'bad'));
      hitsAll += hits;
      if (hits >= 7) { fastest = Math.min(fastest, interval); interval = Math.max(300, interval * 0.9); panel.querySelector('[data-status]').textContent = `${hits} of 8. Speeding up.`; }
      else if (hits <= 5) { interval = Math.min(1400, interval * 1.12); panel.querySelector('[data-status]').textContent = `${hits} of 8. Slowing down a little.`; }
      else panel.querySelector('[data-status]').textContent = `${hits} of 8. Same pace.`;
      await wait(1100);
    }
    world.keyHandler = null;
    if (!alive()) return;
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const learned = Math.round(mean(rts.random) - mean(rts.pattern.slice(-16)));
    const perMinute = fastest === Infinity ? 0 : Math.round(60000 / fastest);
    const { best, isNew } = recordBest('rhythm', perMinute);
    finish(world, rhythm, level, [
      `Hits: ${hitsAll} of ${ROUNDS * 8}. Average reaction: ${Math.round(mean([...rts.pattern, ...rts.random]))} ms.`,
      perMinute ? `Fastest pace you kept up with: ${perMinute} lights a minute.` : '',
      learned > 20 ? `Your hands learned the hidden pattern: you were ${learned} ms quicker on it than on the random round.` : ''
    ].filter(Boolean), isNew && perMinute ? 'That is a new personal best!' : `Personal best: ${best} a minute.`);
  }
};

/* ======================================================================
 * 6. Signal Match: mental flexibility (task switching)
 * ==================================================================== */

const signal = {
  id: 'signal', title: 'Signal Match', kicker: 'Mental flexibility', tone: '#d8a4f0',
  about: { text: 'Trains switching between rules quickly, a core part of mental flexibility. Online executive-function training improved cognitive flexibility, verbal fluency and processing speed in a randomized trial with breast cancer survivors.', cite: 'Kesler et al., Clinical Breast Cancer 2013', href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3726272/' },
  levels: [
    { name: 'One rule at a time', desc: 'The rule changes every 10 signals.', switchEvery: 10, p: 0, deadline: 3000 },
    { name: 'Some switches', desc: 'The rule changes about 1 time in 3.', p: 0.3, deadline: 2500 },
    { name: 'Frequent switches', desc: 'The rule changes about half the time.', p: 0.5, deadline: 2000 },
    { name: 'Fast switching', desc: 'Half the time, with much less time to answer.', p: 0.5, deadline: 1300 }
  ],
  how: () => [
    'Each signal has a shape and a colour. The word on top tells you which to sort by.',
    '<b>SHAPE</b>: round → left, pointed → right. <b>COLOUR</b>: warm → left, cool → right. Use the buttons or <b>F</b> and <b>J</b>.',
    'Answer correctly and you get a little less time; miss and you get more. 40 signals.'
  ],
  async play(world, level, alive) {
    const TRIALS = 40;
    const SHAPES = [['●', 'round'], ['▲', 'pointed'], ['◆', 'pointed'], ['⬤', 'round']];
    const TONES = [['#ff9a62', 'warm'], ['#5fa8ff', 'cool']];
    let deadline = level.deadline, rule = Math.random() < 0.5 ? 'shape' : 'colour';
    let correct = 0;
    const rt = { switch: [], stay: [] };
    const panel = world.render(`<main class="world-card bg-card">
      <p class="world-note" data-info></p>
      <p class="switch-rule" data-rule></p>
      <div class="switch-card" data-card></div>
      <div class="switch-bar"><i data-bar></i></div>
      <div class="world-controls bg-choices"><button data-side="0">F · Round / Warm</button><button data-side="1">J · Pointed / Cool</button></div>
      <p class="game-status" data-status></p>
    </main>`);
    const $ = (s) => panel.querySelector(s);
    let answer = null;
    panel.querySelectorAll('[data-side]').forEach((b) => { b.onclick = () => answer && answer(+b.dataset.side); });
    world.keyHandler = (e) => { const k = e.key.toLowerCase(); if (k === 'f' || k === 'j') { e.preventDefault(); answer && answer(k === 'f' ? 0 : 1); } };
    for (let t = 0; t < TRIALS && alive(); t++) {
      const switched = t > 0 && (level.switchEvery ? t % level.switchEvery === 0 : Math.random() < level.p);
      if (switched) rule = rule === 'shape' ? 'colour' : 'shape';
      const [shape, shapeKind] = pick(SHAPES), [tone, toneKind] = pick(TONES);
      const want = rule === 'shape' ? (shapeKind === 'round' ? 0 : 1) : (toneKind === 'warm' ? 0 : 1);
      $('[data-info]').textContent = `Signal ${t + 1} of ${TRIALS} · ${(deadline / 1000).toFixed(1)} s to answer`;
      $('[data-rule]').textContent = rule.toUpperCase();
      $('[data-rule]').className = `switch-rule rule-${rule}`;
      $('[data-card]').innerHTML = `<span style="color:${tone}">${shape}</span>`;
      $('[data-status]').textContent = '';
      const bar = $('[data-bar]');
      bar.style.transition = 'none'; bar.style.width = '100%';
      bar.getBoundingClientRect();
      bar.style.transition = `width ${deadline}ms linear`; bar.style.width = '0%';
      const shownAt = performance.now();
      const got = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), deadline);
        answer = (side) => { clearTimeout(timer); resolve({ side, time: performance.now() - shownAt }); };
      });
      answer = null;
      const ok = got && got.side === want;
      if (ok) { correct++; (switched ? rt.switch : rt.stay).push(got.time); deadline = Math.max(600, deadline * 0.95); }
      else deadline = Math.min(4000, deadline * 1.1);
      $('[data-status]').textContent = ok ? '✓' : got ? `Sorting by ${rule}: that one was ${rule === 'shape' ? shapeKind : toneKind}.` : 'Too slow. You get a little more time now.';
      $('[data-card]').innerHTML = '';
      await wait(ok ? 350 : 1000);
    }
    world.keyHandler = null;
    if (!alive()) return;
    const mean = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
    const all = mean([...rt.switch, ...rt.stay]);
    const cost = rt.switch.length && rt.stay.length ? mean(rt.switch) - mean(rt.stay) : null;
    const accuracy = Math.round((correct / TRIALS) * 100);
    const score = accuracy >= 85 ? all : 9999; // personal best: fastest average with 85% right
    const { best, isNew } = recordBest('signal', score, true);
    finish(world, signal, level, [
      `Right: ${accuracy}%. Average answer: ${all} ms.`,
      cost !== null ? `Switch cost: ${cost} ms (the extra time a rule change takes; it shrinks with practice).` : ''
    ].filter(Boolean), isNew && score < 9999 ? 'That is a new personal best!' : best < 9999 ? `Personal best: ${best} ms with 85% or more right.` : 'Aim for 85% right to set a personal best.');
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

addEventListener('keydown', (event) => {
  const world = Object.values(worlds).find((w) => !w.host.hidden);
  if (!world) return;
  if (event.key === 'Escape') { world.close(); return; }
  if (world.keyHandler) world.keyHandler(event);
});
