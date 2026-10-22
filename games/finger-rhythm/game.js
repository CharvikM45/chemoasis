/* Finger Rhythm — tap big glowing pads at your own pace.
 * Follows "Three new Chemoasis games: full specs" (Oct 20, 2026):
 * the light waits for you, wrong taps do nothing, no scores or timing data. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const scene = window.GardenScene;
  const STORE = 'chemoasis.games.rhythm';
  const systemCalm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DOUBLE_TAP_MS = 150;

  /* ---------- Pads, levels, settings ---------- */

  const star = (() => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 10.5 : 25, a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push(`${(32 + r * Math.cos(a)).toFixed(1)},${(34 + r * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  })();
  const SVG = (inner, fill) => `<svg viewBox="0 0 64 64" aria-hidden="true" fill="${fill}" stroke="#4a3025" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${inner}</svg>`;

  const PADS = {
    moon: { name: 'Moon', color: '#d7c0ed', midi: 72, icon: SVG('<path d="M41 8a25 25 0 1 0 16 38A20 20 0 0 1 41 8z"/>', '#c3a6e0') },
    leaf: { name: 'Leaf', color: '#cddcb9', midi: 76, icon: SVG('<path d="M10 54C10 28 27 11 55 9c0 27-17 45-45 45z"/><path d="M13 51 44 21" fill="none"/>', '#a3b98a') },
    star: { name: 'Star', color: '#f2d5ab', midi: 79, icon: SVG(`<polygon points="${star}"/>`, '#e6bb80') },
  };

  const LEVELS = {
    1: { pads: 2, taps: 8, desc: '2 pads, 8 taps, simple back and forth.' },
    2: { pads: 3, taps: 12, desc: '3 pads, 12 taps, one steady pattern.' },
    3: { pads: 3, taps: 16, desc: '3 pads, 16 taps. The pattern changes partway through.' },
    4: { pads: 2, taps: 12, desc: '2 pads, one for each hand. Your hands take turns.' },
  };

  const settings = { setupDone: false, hand: 'right', input: 'mouse', level: 1, rounds: 0, keys: ['f', 'j', ' '], sound: true, calm: false, beat: false };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (_) { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (_) { /* ignore */ } };

  const keyName = (k) => (k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k);
  const level4Allowed = () => settings.input !== 'mouse';

  function padsForLevel(level) {
    if (level === 4) return [{ ...PADS.moon, sub: 'Left hand' }, { ...PADS.star, sub: 'Right hand' }];
    return LEVELS[level].pads === 2 ? [PADS.moon, PADS.leaf] : [PADS.moon, PADS.leaf, PADS.star];
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const repeatTo = (p, n) => Array.from({ length: n }, (_, i) => p[i % p.length]);
  const STEADY = [[0, 1, 2, 1], [0, 1, 2], [2, 1, 0, 1], [0, 2, 1, 2]];

  function buildPattern(level) {
    const { taps } = LEVELS[level];
    if (level === 1 || level === 4) return repeatTo([0, 1], taps);
    if (level === 2) return repeatTo(pick(STEADY), taps);
    const a = pick(STEADY);
    const b = pick(STEADY.filter((p) => p !== a));
    const first = repeatTo(a, taps / 2);
    let second = repeatTo(b, taps / 2);
    // Never ask for the same pad twice in a row at the change-over.
    if (second[0] === first[first.length - 1]) second = second.map((i) => (i + 1) % 3);
    return [...first, ...second];
  }

  /* ---------- Audio ---------- */

  let audio = null;

  function initAudio() {
    if (audio) { if (audio.ac.state === 'suspended') audio.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const master = ac.createGain();
    master.gain.value = settings.sound ? 0.9 : 0;
    master.connect(ac.createDynamicsCompressor()).connect(ac.destination);

    const delay = ac.createDelay(1);
    delay.delayTime.value = 0.34;
    const feedback = ac.createGain();
    feedback.gain.value = 0.28;
    const damp = ac.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1600;
    const wet = ac.createGain();
    wet.gain.value = 0.3;
    delay.connect(damp).connect(feedback).connect(delay);
    damp.connect(wet).connect(master);

    const notes = ac.createGain();
    notes.connect(master);
    notes.connect(delay);

    // A quiet breeze and a low, slow pad underneath everything.
    const len = ac.sampleRate * 4;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
    const noise = ac.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const windFilter = ac.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    const wind = ac.createGain();
    wind.gain.value = 0.05;
    const windLfo = ac.createOscillator();
    windLfo.frequency.value = 0.07;
    const windDepth = ac.createGain();
    windDepth.gain.value = 0.03;
    windLfo.connect(windDepth).connect(wind.gain);
    noise.connect(windFilter).connect(wind).connect(master);
    noise.start();
    windLfo.start();

    const pad = ac.createGain();
    pad.gain.value = 0.016;
    const padFilter = ac.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 600;
    pad.connect(padFilter).connect(master);
    [130.81, 196.0, 261.63].forEach((f, i) => {
      const o = ac.createOscillator();
      o.frequency.value = f;
      o.detune.value = (i - 1) * 4;
      o.connect(pad);
      o.start();
    });

    audio = { ac, master, notes };
  }

  function tone(freq, { gain = 0.2, decay = 2.6, type = 'triangle', bright = 6 } = {}) {
    if (!audio || !settings.sound) return;
    const { ac, notes } = audio;
    const t = ac.currentTime;
    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * bright, t);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.5, t + Math.min(1.2, decay));
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(filter).connect(env).connect(notes);
    osc.start(t);
    osc.stop(t + decay + 0.1);
  }
  const playPad = (midi) => {
    const f = 440 * 2 ** ((midi - 69) / 12);
    tone(f);
    tone(f * 2, { gain: 0.045, type: 'sine', decay: 1.8 });
  };
  const playTick = () => tone(196, { gain: 0.06, decay: 0.35, type: 'sine', bright: 3 });

  function setSound(on) {
    settings.sound = on;
    save();
    const btn = $('soundBtn');
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    if (audio) audio.master.gain.setTargetAtTime(on ? 0.9 : 0, audio.ac.currentTime, 0.15);
  }

  function applyLook() {
    const calm = settings.calm || systemCalm;
    document.body.classList.toggle('calm', calm);
    document.body.classList.toggle('touch', settings.input === 'touch');
    scene.setCalm(calm);
  }

  /* ---------- Round state ---------- */

  let screen = 'setup';
  let pads = [], keys = [], pattern = [], step = 0;
  let lastTap = [];
  let readyShown = false;
  let sessionPlay = 0;
  let ignoreClickUntil = 0;
  const beat = { bpm: 50, next: 0, last: 0, misses: 0 };

  const padEls = () => [...$('pads').children];
  const handText = () => (settings.level === 4 ? 'taking turns with each hand'
    : settings.hand === 'both' ? 'using both hands' : `with your ${settings.hand} hand`);

  function renderPads() {
    const box = $('pads');
    box.innerHTML = '';
    pads.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pad';
      b.style.setProperty('--c', p.color);
      b.setAttribute('aria-label', `${p.name} pad${p.sub ? `, ${p.sub.toLowerCase()}` : ''}, key ${keyName(keys[i])}`);
      b.innerHTML = `<span class="glow"></span><span class="ring"></span>${p.icon}<span class="name">${p.name}</span>${p.sub ? `<span class="sub">${p.sub}</span>` : ''}<kbd>${keyName(keys[i])}</kbd>`;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); tap(i); });
      // Keyboard activation of a focused pad (Enter), when not already handled as a game key.
      b.addEventListener('click', (e) => { if (e.detail === 0 && performance.now() > ignoreClickUntil) tap(i); });
      box.appendChild(b);
    });
  }

  function renderProgress() {
    const box = $('progress');
    box.innerHTML = pattern.map((_, i) => `<i class="${i < step ? 'done' : ''}"></i>`).join('');
    box.setAttribute('aria-label', `${step} of ${pattern.length} taps`);
  }

  function prompt(prefix = '') {
    const p = pads[pattern[step]];
    const who = settings.level === 4 ? ` with your ${p.sub.split(' ')[0].toLowerCase()} hand` : '';
    $('status').textContent = `${prefix}Tap the glowing ${p.name.toLowerCase()}${who}.`;
  }

  function light() {
    padEls().forEach((el, i) => el.classList.toggle('lit', i === pattern[step]));
  }

  function startRound(prefix = '') {
    if (!readyShown) { showScreen('ready'); return; }
    initAudio();
    if (settings.level === 4 && !level4Allowed()) settings.level = 1;
    pads = padsForLevel(settings.level);
    keys = settings.keys.slice(0, pads.length);
    pattern = buildPattern(settings.level);
    step = 0;
    lastTap = pads.map(() => 0);
    renderPads();
    renderProgress();
    scene.setGrowth(0);
    scene.setBloom(false);
    $('gentlerBtn').classList.remove('suggested');
    $('beatDot').hidden = !settings.beat;
    resetBeat();
    showScreen('playing');
    light();
    prompt(prefix);
  }

  function tap(i) {
    if (screen !== 'playing') return;
    const now = performance.now();
    if (now - lastTap[i] < DOUBLE_TAP_MS) return; // accidental double tap
    lastTap[i] = now;
    if (i !== pattern[step]) return; // wrong pad: nothing happens, the light keeps waiting

    const el = padEls()[i];
    el.classList.add('tapped');
    setTimeout(() => el.classList.remove('tapped'), 220);
    playPad(pads[i].midi);
    const r = el.getBoundingClientRect();
    scene.burst(r.left + r.width / 2, r.top + r.height * 0.3, pads[i].color);

    let prefix = '';
    if (settings.beat) prefix = beatFeedback(now / 1000);

    step++;
    renderProgress();
    scene.setGrowth(step / pattern.length);

    if (step === pattern.length) {
      el.classList.remove('lit');
      $('status').textContent = 'That’s the round.';
      screen = 'finishing';
      setTimeout(endRound, 700);
      return;
    }
    if (settings.level === 3 && step === pattern.length / 2) prefix = 'The pattern changes now. ' + prefix;
    light();
    prompt(prefix);
  }

  function endRound() {
    settings.rounds++;
    save();
    scene.setBloom(true);
    $('endSummary').textContent = `You tapped ${pattern.length} times ${handText()}. This is not a health result.`;
    const mins = Math.round(sessionPlay / 60);
    const note = $('sessionNote');
    note.hidden = sessionPlay < 180;
    note.textContent = `You've been tapping for about ${mins} minutes. A longer rest might feel good now.`;
    $('switchBtn').hidden = settings.hand === 'both' || settings.level === 4;
    resetFeedback();
    showScreen('ended');
  }

  // Gentler means: beat off first, then fewer pads and taps.
  function makeGentler() {
    if (settings.beat) { settings.beat = false; save(); return 'Steady beat is off now. '; }
    if (settings.level === 1) return 'This is already the gentlest level. Rest whenever you like. ';
    settings.level = settings.level === 4 ? 1 : settings.level - 1;
    save();
    return 'A gentler round. ';
  }

  /* ---------- Optional steady beat (off by default; awaiting review) ---------- */

  function resetBeat() {
    const now = performance.now() / 1000;
    beat.next = now + 1.2;
    beat.last = now;
    beat.misses = 0;
  }

  function beatFeedback(nowSec) {
    const interval = 60 / beat.bpm;
    const t = nowSec - beat.last;
    const off = Math.min(Math.abs(t), Math.abs(interval - t));
    if (off <= 0.3) { beat.misses = 0; return 'In time. '; }
    beat.misses++;
    if (beat.misses >= 3) {
      beat.misses = 0;
      beat.bpm = Math.max(40, beat.bpm - 6);
      return 'Slowing the beat a little. ';
    }
    return 'Take your time. ';
  }

  function tickBeat() {
    if (screen !== 'playing' || !settings.beat) return;
    const now = performance.now() / 1000;
    if (now < beat.next) return;
    beat.last = beat.next;
    beat.next += 60 / beat.bpm;
    if (beat.next < now) beat.next = now + 60 / beat.bpm;
    playTick();
    const dot = $('beatDot');
    dot.classList.add('on');
    setTimeout(() => dot.classList.remove('on'), 350);
    const lit = padEls()[pattern[step]];
    if (lit) { lit.classList.remove('pulse'); void lit.offsetWidth; lit.classList.add('pulse'); }
  }

  let lastTs = performance.now();
  function loop(ts) {
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    if (screen === 'playing') sessionPlay += dt;
    tickBeat();
    requestAnimationFrame(loop);
  }

  /* ---------- Screens ---------- */

  const overlays = {
    setup: $('setupScreen'), ready: $('readyScreen'), paused: $('pauseScreen'),
    comfort: $('comfortScreen'), ended: $('endScreen'), stopped: $('stoppedScreen'),
  };
  let breathTimer = null;

  function showScreen(name) {
    screen = name;
    for (const [key, el] of Object.entries(overlays)) el.hidden = key !== name;
    $('play').hidden = !['playing', 'paused', 'comfort', 'finishing'].includes(name);
    $('pauseBtn').setAttribute('aria-disabled', String(name !== 'playing'));
    clearInterval(breathTimer);

    if (name === 'paused') {
      const circle = document.querySelector('.breath span');
      circle.style.animation = 'none';
      void circle.offsetWidth;
      circle.style.animation = '';
      let inhale = true;
      $('breathLabel').textContent = 'Breathe in…';
      breathTimer = setInterval(() => { inhale = !inhale; $('breathLabel').textContent = inhale ? 'Breathe in…' : 'Breathe out…'; }, 4000);
    }
    const focus = { setup: 'setupDone', ready: 'readyBtn', paused: 'resumeBtn', comfort: 'keepGoingBtn', ended: 'againBtn', stopped: 'stoppedAgainBtn' }[name];
    if (focus) $(focus).focus();
    else if (name === 'playing' && document.activeElement instanceof HTMLElement && !document.activeElement.classList.contains('pad')) document.activeElement.blur();
  }

  function pause() { if (screen === 'playing') showScreen('paused'); }
  function resume() {
    if (screen !== 'paused' && screen !== 'comfort') return;
    initAudio();
    resetBeat();
    showScreen('playing');
  }
  function stop() {
    padEls().forEach((el) => el.classList.remove('lit'));
    showScreen('stopped');
  }

  /* ---------- Setup ---------- */

  const SETUP = {
    hand: { options: [['left', 'Left'], ['right', 'Right'], ['both', 'Both']], get: () => settings.hand, set: (v) => { settings.hand = v; } },
    input: {
      options: [['touch', 'Touchscreen'], ['mouse', 'Mouse or trackpad'], ['keyboard', 'Keyboard']],
      get: () => settings.input,
      set: (v) => { settings.input = v; if (settings.level === 4 && !level4Allowed()) settings.level = 1; },
    },
    pads: {
      options: [['2', '2 pads'], ['3', '3 pads']],
      get: () => String(LEVELS[settings.level].pads),
      set: (v) => { if (v !== String(LEVELS[settings.level].pads)) settings.level = v === '2' ? 1 : 2; },
    },
    level: {
      options: [['1', 'Level 1'], ['2', 'Level 2'], ['3', 'Level 3'], ['4', 'Level 4']],
      get: () => String(settings.level),
      set: (v) => { if (v !== '4' || level4Allowed()) settings.level = Number(v); },
      disabled: (v) => v === '4' && !level4Allowed(),
    },
  };

  function renderSetup() {
    document.querySelectorAll('[data-setting]').forEach((box) => {
      const def = SETUP[box.dataset.setting];
      box.setAttribute('role', 'radiogroup');
      box.setAttribute('aria-label', box.closest('fieldset').querySelector('legend').textContent);
      if (!box.children.length) {
        for (const [value, label] of def.options) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'chip';
          b.setAttribute('role', 'radio');
          b.dataset.value = value;
          b.textContent = label;
          b.addEventListener('click', () => {
            if (def.disabled && def.disabled(value)) return;
            def.set(value);
            save();
            applyLook();
            renderSetup();
          });
          box.appendChild(b);
        }
      }
      for (const b of box.children) {
        b.setAttribute('aria-checked', String(b.dataset.value === def.get()));
        b.setAttribute('aria-disabled', String(Boolean(def.disabled && def.disabled(b.dataset.value))));
      }
    });
    $('levelHint').textContent = LEVELS[settings.level].desc + (level4Allowed() ? '' : ' Level 4 needs a touchscreen or keyboard.');
    renderKeyChips();
    $('calmSwitch').setAttribute('aria-checked', String(settings.calm));
    $('beatSwitch').setAttribute('aria-checked', String(settings.beat));
  }

  let listening = -1;
  const RESERVED = ['escape', 'p', 'm', 'tab', 'enter'];

  function renderKeyChips() {
    const box = $('keyChips');
    box.innerHTML = '';
    ['Moon', 'Leaf', 'Star'].forEach((name, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (listening === i ? ' listening' : '');
      b.textContent = listening === i ? `${name}: press a key…` : `${name}: ${keyName(settings.keys[i])}`;
      b.addEventListener('click', () => { listening = listening === i ? -1 : i; renderKeyChips(); });
      box.appendChild(b);
    });
  }

  function captureKey(e) {
    e.preventDefault();
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    if (k === 'escape') { listening = -1; renderKeyChips(); return; }
    if (RESERVED.includes(k) || e.key.length !== 1) {
      $('keyHint').textContent = `${keyName(e.key)} is used for something else. Try a letter, number, or Space.`;
      return;
    }
    const other = settings.keys.indexOf(k);
    if (other >= 0 && other !== listening) settings.keys[other] = settings.keys[listening]; // swap
    settings.keys[listening] = k;
    listening = -1;
    save();
    $('keyHint').textContent = "Choose a pad's key, then press the new key you'd like to use.";
    renderKeyChips();
  }

  /* ---------- Optional feedback (not saved or sent) ---------- */

  function chipGroup(box, options, onPick) {
    box.setAttribute('role', 'radiogroup');
    box.innerHTML = '';
    for (const [value, label] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.textContent = label;
      b.addEventListener('click', () => {
        for (const c of box.children) c.setAttribute('aria-checked', String(c === b));
        onPick(value);
      });
      box.appendChild(b);
    }
  }

  function resetFeedback() {
    const reply = $('feedbackReply');
    reply.textContent = "Skip these if you like. Your answers aren't saved or sent anywhere yet.";
    $('endGentlerBtn').classList.remove('suggested');
    $('hardNote').hidden = true;
    $('hardNote').querySelector('textarea').value = '';
    chipGroup($('feelChips'), [['easy', 'Too easy'], ['right', 'About right'], ['hard', 'Too hard']], (v) => {
      $('endGentlerBtn').classList.toggle('suggested', v === 'hard');
      reply.textContent = {
        easy: settings.level < 3 ? 'Thanks. If you’d like a little more, try the next level under Change setup → More options.' : 'Thanks for letting us know.',
        right: 'Thanks. Glad it felt about right.',
        hard: 'Thanks. “Make gentler” is highlighted if you’d like an easier round.',
      }[v];
    });
    chipGroup($('hardChips'), [['no', 'No'], ['yes', 'Yes']], (v) => {
      $('hardNote').hidden = v !== 'yes';
      if (v === 'yes') reply.textContent = 'Thanks for telling us. You can add a short note below.';
    });
  }

  /* ---------- Wiring ---------- */

  $('setupDone').addEventListener('click', () => { settings.setupDone = true; save(); startRound(); });
  $('readyBtn').addEventListener('click', () => { readyShown = true; startRound(); });
  $('resumeBtn').addEventListener('click', resume);
  $('keepGoingBtn').addEventListener('click', resume);
  document.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('click', stop));
  $('stopBtn').addEventListener('click', stop);
  $('pauseBtn').addEventListener('click', pause);
  $('soundBtn').addEventListener('click', () => { initAudio(); setSound(!settings.sound); });

  $('hintBtn').addEventListener('click', () => {
    const i = pattern[step];
    if (i === undefined) return;
    const where = pads.length === 2 ? ['on the left', 'on the right'][i] : ['on the left', 'in the middle', 'on the right'][i];
    $('status').textContent = `Look for the glowing ${pads[i].name.toLowerCase()}, ${where}. Tap it, click it, or press ${keyName(keys[i])}.`;
  });
  $('gentlerBtn').addEventListener('click', () => startRound(makeGentler()));
  $('restartBtn').addEventListener('click', () => startRound());
  $('comfortBtn').addEventListener('click', () => { if (screen === 'playing') showScreen('comfort'); });

  $('againBtn').addEventListener('click', () => startRound());
  $('stoppedAgainBtn').addEventListener('click', () => startRound());
  $('endGentlerBtn').addEventListener('click', () => startRound(makeGentler()));
  $('switchBtn').addEventListener('click', () => {
    settings.hand = settings.hand === 'left' ? 'right' : 'left';
    save();
    startRound(`Now with your ${settings.hand} hand. `);
  });
  $('setupBtn').addEventListener('click', () => { renderSetup(); showScreen('setup'); });

  $('calmSwitch').addEventListener('click', () => { settings.calm = !settings.calm; save(); applyLook(); renderSetup(); });
  $('beatSwitch').addEventListener('click', () => { settings.beat = !settings.beat; save(); renderSetup(); });

  window.addEventListener('keydown', (e) => {
    if (listening >= 0) { captureKey(e); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (k === 'Escape' || k === 'p') {
      if (screen === 'playing') { e.preventDefault(); pause(); }
      else if (screen === 'paused' || screen === 'comfort') { e.preventDefault(); resume(); }
      return;
    }
    if (k === 'm' && !e.repeat) { initAudio(); setSound(!settings.sound); return; }
    if (screen === 'playing') {
      const i = keys.indexOf(k);
      if (i >= 0) {
        e.preventDefault();
        ignoreClickUntil = performance.now() + 400;
        if (!e.repeat) tap(i); // holding a key never counts as more taps
      }
    }
  });

  // Don't let a round run on while the person has stepped away.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);

  setSound(settings.sound);
  applyLook();
  renderSetup();
  if (settings.setupDone) showScreen('ready');
  else showScreen('setup');
  requestAnimationFrame(loop);
})();
