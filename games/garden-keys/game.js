/* Garden Keys — a calm piano-tiles activity.
 * No score, no fail state: tiles either wait for you (Gentle) or drift past
 * and fade (Flowing). Every note played helps a plant grow. */
(() => {
  'use strict';

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);

  /* ---------- Songs ---------- */

  const NOTE_INDEX = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

  // "C4 G4:2 E4:0.5" -> [{ midi, beat }]
  function parseMelody(str) {
    let beat = 0;
    return str.trim().split(/\s+/).map((tok) => {
      const [name, dur = '1'] = tok.split(':');
      const m = name.match(/^([A-G]#?)(\d)$/);
      const note = { midi: 12 * (Number(m[2]) + 1) + NOTE_INDEX[m[1]], beat };
      beat += parseFloat(dur);
      return note;
    });
  }

  // Spread pitches across the four lanes so higher notes sit further right.
  function assignLanes(notes) {
    const pitches = [...new Set(notes.map((n) => n.midi))].sort((a, b) => a - b);
    return notes.map((n) => ({ ...n, lane: Math.min(3, Math.floor((pitches.indexOf(n.midi) * 4) / pitches.length)) }));
  }

  function mulberry32(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A wandering C-major pentatonic melody: always consonant, never jarring.
  function driftMelody() {
    const rand = mulberry32(7);
    const scale = [0, 2, 4, 7, 9];
    const notes = [];
    let idx = 2, beat = 0;
    for (let phrase = 0; phrase < 6; phrase++) {
      for (let i = 0; i < 8; i++) {
        const last = phrase === 5 && i === 7;
        if (last) idx = 5;
        notes.push({ midi: 60 + 12 * Math.floor(idx / 5) + scale[idx % 5], beat });
        beat += i === 7 ? 2 : 1;
        const steps = [-2, -1, -1, 1, 1, 2];
        idx = Math.max(0, Math.min(9, idx + steps[Math.floor(rand() * steps.length)]));
      }
    }
    return notes;
  }

  const SONGS = [
    { id: 'drift', name: 'Drift', notes: () => driftMelody() },
    {
      id: 'twinkle', name: 'Twinkle, Twinkle',
      notes: () => parseMelody(`
        C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2
        G4 G4 F4 F4 E4 E4 D4:2 G4 G4 F4 F4 E4 E4 D4:2
        C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2`),
    },
    {
      id: 'ode', name: 'Ode to Joy',
      notes: () => parseMelody(`
        E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:0.5 D4:2
        E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:0.5 C4:2
        D4 D4 E4 C4 D4 E4:0.5 F4:0.5 E4 C4 D4 E4:0.5 F4:0.5 E4 D4 C4 D4 G3:2
        E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:0.5 C4:2`),
    },
  ];

  const PACES = [
    { id: 'gentle', name: 'Gentle', bps: 1.5, wait: true, hint: 'Tiles pause at the line and wait for you. There’s no rush.' },
    { id: 'flowing', name: 'Flowing', bps: 1.3, wait: false, hint: 'Tiles drift slowly and keep moving. If you miss one, it simply fades away.' },
    { id: 'lively', name: 'Lively', bps: 1.9, wait: false, hint: 'A little quicker, and just as forgiving.' },
  ];

  const KEYS = { d: 0, f: 1, j: 2, k: 3, 1: 0, 2: 1, 3: 2, 4: 3 };
  const KEY_LABELS = ['D', 'F', 'J', 'K'];

  /* ---------- Settings ---------- */

  const settings = { song: 'drift', pace: 'gentle', sound: true };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('gardenKeys') || '{}')); } catch (_) { /* storage unavailable */ }
  const saveSettings = () => { try { localStorage.setItem('gardenKeys', JSON.stringify(settings)); } catch (_) { /* ignore */ } };

  /* ---------- Audio ---------- */

  let audio = null;

  function initAudio() {
    if (audio) { if (audio.ac.state === 'suspended') audio.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();

    const master = ac.createGain();
    master.gain.value = settings.sound ? 0.9 : 0;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp).connect(ac.destination);

    // Soft echo for a sense of open space.
    const delay = ac.createDelay(1);
    delay.delayTime.value = 0.34;
    const feedback = ac.createGain();
    feedback.gain.value = 0.3;
    const damp = ac.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1600;
    const wet = ac.createGain();
    wet.gain.value = 0.35;
    delay.connect(damp).connect(feedback).connect(delay);
    damp.connect(wet).connect(master);

    const notes = ac.createGain();
    notes.connect(master);
    notes.connect(delay);

    // Ambient: a quiet breeze (filtered brown noise) and a low, slow pad.
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
    pad.gain.value = 0.018;
    const padFilter = ac.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 600;
    pad.connect(padFilter).connect(master);
    [130.81, 196.0, 261.63].forEach((f, i) => {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = (i - 1) * 4;
      o.connect(pad);
      o.start();
    });
    const padLfo = ac.createOscillator();
    padLfo.frequency.value = 0.05;
    const padDepth = ac.createGain();
    padDepth.gain.value = 0.008;
    padLfo.connect(padDepth).connect(pad.gain);
    padLfo.start();

    audio = { ac, master, notes };
  }

  function playNote(midi) {
    if (!audio || !settings.sound) return;
    const { ac, notes } = audio;
    const t = ac.currentTime;
    const f = 440 * 2 ** ((midi - 69) / 12);

    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.2, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);

    const tone = ac.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(f * 6, t);
    tone.frequency.exponentialRampToValueAtTime(f * 1.5, t + 1.2);

    const body = ac.createOscillator();
    body.type = 'triangle';
    body.frequency.value = f;
    const shimmer = ac.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.value = f * 2;
    const shimmerGain = ac.createGain();
    shimmerGain.gain.value = 0.22;

    body.connect(tone);
    shimmer.connect(shimmerGain).connect(tone);
    tone.connect(env).connect(notes);
    body.start(t); shimmer.start(t);
    body.stop(t + 2.7); shimmer.stop(t + 2.7);
  }

  function setSound(on) {
    settings.sound = on;
    saveSettings();
    const btn = $('soundBtn');
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    if (audio) audio.master.gain.setTargetAtTime(on ? 0.9 : 0, audio.ac.currentTime, 0.15);
  }

  /* ---------- Layout ---------- */

  let W = 0, H = 0, dpr = 1;
  const field = { x: 0, y: 0, w: 0, h: 0, laneW: 0, hitY: 0, beatPx: 0, tileH: 0 };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    field.w = Math.min(440, W * 0.88);
    field.x = (W - field.w) / 2;
    field.y = 84;
    field.h = H - field.y - 24;
    field.laneW = field.w / 4;
    field.hitY = field.y + field.h * 0.8;
    field.beatPx = Math.max(90, Math.min(170, field.h / 4.6));
    field.tileH = field.beatPx * 0.46;

    buildScene();
  }

  /* ---------- Scene: plants, hills, motes ---------- */

  const GREENS = ['#6f8460', '#86996f', '#9fb08a', '#5d7052', '#a9b893', '#7d8f69'];
  let plants = [];
  let motes = [];
  let grass = [];

  function buildScene() {
    const rand = mulberry32(42);
    plants = [];
    const sideW = Math.max(field.x - 10, W * 0.12);
    const addSide = (fromX, toX, count) => {
      for (let i = 0; i < count; i++) {
        const back = i % 2 === 0;
        plants.push({
          x: fromX + (toX - fromX) * ((i + 0.5) / count) + (rand() - 0.5) * 40,
          h: (back ? 0.3 : 0.22) * H + rand() * 0.18 * H,
          lean: (rand() - 0.5) * 0.35 + (fromX < W / 2 ? 0.08 : -0.08),
          kind: rand() < 0.5 ? 'fern' : 'leafy',
          color: GREENS[Math.floor(rand() * GREENS.length)],
          phase: rand() * Math.PI * 2,
          speed: 0.45 + rand() * 0.35,
          alpha: back ? 0.45 : 0.85,
          back,
        });
      }
    };
    const count = Math.max(3, Math.round(sideW / 70));
    addSide(-20, sideW, count);
    addSide(W - sideW, W + 20, count);
    plants.sort((a, b) => Number(b.back) - Number(a.back));

    grass = [];
    for (let x = -10; x < W + 10; x += 9 + rand() * 10) {
      grass.push({ x, h: 18 + rand() * 46, lean: (rand() - 0.5) * 0.5, phase: rand() * 6, color: GREENS[Math.floor(rand() * GREENS.length)] });
    }

    motes = [];
    for (let i = 0; i < 38; i++) {
      motes.push({ x: rand() * W, y: rand() * H, r: 1 + rand() * 2.4, vy: 4 + rand() * 9, phase: rand() * 6, warm: rand() < 0.4 });
    }
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function leaf(x, y, angle, len, width, color, alpha = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.45, -width, len, 0);
    ctx.quadraticCurveTo(len * 0.45, width, 0, 0);
    ctx.fill();
    ctx.restore();
  }

  // Stem as a quadratic curve; returns a sampler for points/tangents along it.
  function stem(x, baseY, h, lean, sway, color, width) {
    const ang = lean + sway;
    const tipX = x + Math.sin(ang) * h, tipY = baseY - Math.cos(ang) * h;
    const cx = x + Math.sin(lean * 0.4) * h * 0.15, cy = baseY - h * 0.55;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.quadraticCurveTo(cx, cy, tipX, tipY);
    ctx.stroke();
    return (t) => {
      const mt = 1 - t;
      return {
        x: mt * mt * x + 2 * mt * t * cx + t * t * tipX,
        y: mt * mt * baseY + 2 * mt * t * cy + t * t * tipY,
        a: Math.atan2(2 * mt * (cy - baseY) + 2 * t * (tipY - cy), 2 * mt * (cx - x) + 2 * t * (tipX - cx)),
      };
    };
  }

  const swayAmp = reduceMotion ? 0.2 : 1;
  const wind = (time, phase, speed) => swayAmp * (Math.sin(time * speed + phase) * 0.05 + Math.sin(time * 0.17 + phase * 0.3) * 0.035);

  function drawPlant(p, time) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    const at = stem(p.x, H + 4, p.h, p.lean, wind(time, p.phase, p.speed), p.color, p.back ? 2 : 3);
    if (p.kind === 'fern') {
      for (let i = 2; i < 22; i++) {
        const t = i / 22, pt = at(t), size = (1 - t) * p.h * 0.17 + 6;
        leaf(pt.x, pt.y, pt.a - 1.0, size, size * 0.22, p.color);
        leaf(pt.x, pt.y, pt.a + 1.0, size, size * 0.22, p.color);
      }
    } else {
      for (let i = 1; i < 8; i++) {
        const t = i / 8, pt = at(t), size = (1 - t * 0.6) * p.h * 0.2 + 10;
        const side = i % 2 ? -1 : 1;
        leaf(pt.x, pt.y, pt.a + side * 0.75 + wind(time, p.phase + i, 0.9) * 2, size, size * 0.36, p.color);
      }
    }
    ctx.restore();
  }

  function drawBackground(time) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#f7f0e7');
    sky.addColorStop(0.65, '#f2eee0');
    sky.addColorStop(1, '#e7ead8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const sun = ctx.createRadialGradient(W * 0.78, H * 0.2, 0, W * 0.78, H * 0.2, Math.max(W, H) * 0.45);
    sun.addColorStop(0, '#f6dcbcaa');
    sun.addColorStop(1, '#f6dcbc00');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, H);

    const hill = (base, amp, color, seed) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W + 20; x += 20) {
        const y = H * base + Math.sin(x * 0.004 + seed) * amp + Math.sin(x * 0.011 + seed * 2) * amp * 0.4;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.fill();
    };
    hill(0.68, 26, '#e4e4d0', 1.3);
    hill(0.78, 20, '#d9ddc5', 4.1);

    // Drifting pollen / light motes.
    for (const m of motes) {
      const y = reduceMotion ? m.y : (m.y - time * m.vy) % (H + 20);
      const yy = y < -10 ? y + H + 20 : y;
      const x = m.x + Math.sin(time * 0.3 + m.phase) * 14 * swayAmp;
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 0.8 + m.phase);
      ctx.fillStyle = m.warm ? '#f0ca9e' : '#fffaf4';
      ctx.beginPath();
      ctx.arc(x, yy, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const p of plants) if (p.back) drawPlant(p, time);
  }

  function drawForeground(time) {
    for (const p of plants) if (!p.back) drawPlant(p, time);
    ctx.globalAlpha = 0.8;
    for (const g of grass) {
      leaf(g.x, H + 2, -Math.PI / 2 + g.lean + wind(time, g.phase, 0.8), g.h, 2.4, g.color);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- Growing plant (progress) ---------- */

  const sprout = { g: 0, target: 0, bloom: 0, bloomTarget: 0 };

  function drawSprout(time, dt) {
    sprout.g += (sprout.target - sprout.g) * Math.min(1, dt * 2.5);
    sprout.bloom += (sprout.bloomTarget - sprout.bloom) * Math.min(1, dt * 1.5);
    const space = W - (field.x + field.w);
    if (space < 150) return;
    const x = field.x + field.w + space * 0.45;
    const baseY = H - 34;
    const maxH = Math.min(H * 0.45, 340);
    const h = 18 + maxH * sprout.g;

    // Soil mound
    ctx.fillStyle = '#8f6250';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(x, baseY + 6, 46, 14, 0, Math.PI, 0);
    ctx.fill();
    ctx.globalAlpha = 1;

    const at = stem(x, baseY, h, 0, wind(time, 1.7, 0.6) * 0.7, '#5d7052', 3.2);
    const leaves = 12;
    for (let i = 0; i < leaves; i++) {
      const start = i / leaves;
      const grow = Math.max(0, Math.min(1, (sprout.g - start) * 5));
      if (!grow) continue;
      const t = 0.15 + (i / leaves) * 0.8;
      const pt = at(t);
      const size = (26 - i * 1.1) * grow;
      const side = i % 2 ? -1 : 1;
      leaf(pt.x, pt.y, pt.a + side * 0.9, size, size * 0.38, i % 3 ? '#7d8f69' : '#9fb08a');
    }

    if (sprout.bloom > 0.01) {
      const tip = at(1);
      const b = sprout.bloom;
      ctx.save();
      ctx.translate(tip.x, tip.y);
      ctx.rotate(time * 0.05 * swayAmp);
      for (let i = 0; i < 7; i++) {
        leaf(0, 0, (i / 7) * Math.PI * 2, 22 * b, 10 * b, i % 2 ? '#e3a68a' : '#d99377', 0.95);
      }
      ctx.fillStyle = '#f0ca9e';
      ctx.beginPath();
      ctx.arc(0, 0, 6 * b, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // Small bud at the tip while growing.
      const tip = at(1);
      ctx.fillStyle = '#9fb08a';
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 3 + sprout.g * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------- Game state ---------- */

  let screen = 'menu'; // menu | playing | paused | ended
  let song = null, pace = null, notes = [], scrollBeat = 0, hits = 0, finishTimer = 0, playTime = 0;
  const laneFlash = [0, 0, 0, 0];
  let ripples = [];
  let petals = [];

  const noteY = (n) => field.hitY - (n.beat - scrollBeat) * field.beatPx;
  const laneX = (lane) => field.x + field.laneW * (lane + 0.5);

  function startGame() {
    song = SONGS.find((s) => s.id === settings.song) || SONGS[0];
    pace = PACES.find((p) => p.id === settings.pace) || PACES[0];
    notes = assignLanes(song.notes()).map((n) => ({ ...n, state: 'pending', t: 0 }));
    // First tile enters from just above the playfield.
    scrollBeat = -(field.hitY - field.y) / field.beatPx - 0.6;
    hits = 0;
    finishTimer = 0;
    playTime = 0;
    ripples = [];
    petals = [];
    sprout.target = 0;
    sprout.bloomTarget = 0;
    initAudio();
    showScreen('playing');
    announce(`${song.name} begins. Press D, F, J or K as tiles reach the line.`);
  }

  function press(lane) {
    laneFlash[lane] = 1;
    const early = pace.wait ? 0.8 : 0.6;
    const late = 0.45;
    let target = null;
    for (const n of notes) {
      if (n.state !== 'pending' || n.lane !== lane) continue;
      const d = n.beat - scrollBeat;
      if (d > early) break; // notes are in beat order
      if (d >= -late) { target = n; break; }
    }
    if (!target) return;
    const y = noteY(target);
    target.state = 'hit';
    target.t = 0;
    target.hitY = y;
    hits++;
    playNote(target.midi);
    sprout.target = hits / notes.length;
    ripples.push({ x: laneX(lane), y, t: 0 });
    for (let i = 0; i < 3; i++) {
      petals.push({
        x: laneX(lane) + (Math.random() - 0.5) * 30, y,
        vx: (Math.random() - 0.5) * 50, vy: -30 - Math.random() * 30,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 2, t: 0,
        color: ['#e3a68a', '#d7b391', '#f0ca9e'][i],
      });
    }
  }

  function update(dt) {
    for (let i = 0; i < 4; i++) laneFlash[i] = Math.max(0, laneFlash[i] - dt * 3);
    ripples = ripples.filter((r) => (r.t += dt) < 1.1);
    petals = petals.filter((p) => {
      p.t += dt;
      p.vy += 22 * dt;
      p.vx *= 0.99;
      p.x += (p.vx + Math.sin(p.t * 2 + p.rot) * 12) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      return p.t < 3;
    });

    if (screen !== 'playing') return;
    playTime += dt;
    for (const n of notes) if (n.state !== 'pending') n.t += dt;

    let speed = pace.bps;
    const next = notes.find((n) => n.state === 'pending');
    if (pace.wait && next) {
      // Ease to a stop as the next tile reaches the line, then wait.
      const gap = next.beat - scrollBeat;
      if (gap < 0.5) speed *= Math.max(0.12, gap / 0.5);
      scrollBeat = Math.min(next.beat, scrollBeat + speed * dt);
    } else {
      scrollBeat += speed * dt;
    }

    if (!pace.wait) {
      for (const n of notes) {
        if (n.state === 'pending' && scrollBeat - n.beat > 0.45) { n.state = 'missed'; n.t = 0; }
      }
    }

    if (!next) {
      finishTimer += dt;
      sprout.target = Math.max(sprout.target, 0.35);
      sprout.bloomTarget = 1;
      if (finishTimer > 2) finish();
    }
  }

  function finish() {
    const total = notes.length;
    const mins = Math.max(1, Math.round(playTime / 60));
    const time = `about ${mins} minute${mins > 1 ? 's' : ''}`;
    $('endSummary').textContent = hits === total
      ? `You played all ${total} notes of “${song.name}” in ${time}, at your own pace. Rest for a moment, or play again whenever you like.`
      : `You played ${hits} notes of “${song.name}” in ${time}. Every note counts. Rest for a moment, or play again whenever you like.`;
    showScreen('ended');
    announce('Melody complete. Your garden bloomed.');
  }

  /* ---------- Rendering: playfield ---------- */

  function drawField(time) {
    const { x, y, w, h, laneW, hitY, tileH } = field;

    // Frosted panel
    ctx.save();
    roundRect(x, y, w, h, 26);
    ctx.fillStyle = '#fffaf452';
    ctx.fill();
    ctx.strokeStyle = '#bda99855';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.clip();

    // Lane separators
    ctx.strokeStyle = '#bda99833';
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + laneW * i, y + 20);
      ctx.lineTo(x + laneW * i, y + h - 20);
      ctx.stroke();
    }

    // Lane press glow
    for (let i = 0; i < 4; i++) {
      if (!laneFlash[i]) continue;
      const g = ctx.createLinearGradient(0, hitY - 220, 0, hitY + 30);
      g.addColorStop(0, '#9fb08a00');
      g.addColorStop(1, `rgba(159,176,138,${0.32 * laneFlash[i]})`);
      ctx.fillStyle = g;
      ctx.fillRect(x + laneW * i, hitY - 220, laneW, 250);
    }

    // Progress thread along the top
    if (notes.length && screen !== 'menu') {
      const done = notes.filter((n) => n.state !== 'pending').length / notes.length;
      ctx.fillStyle = '#bda99840';
      ctx.fillRect(x + 24, y + 14, w - 48, 2);
      ctx.fillStyle = '#7d8f69';
      ctx.fillRect(x + 24, y + 14, (w - 48) * done, 2);
    }

    // Hit line
    ctx.strokeStyle = '#a86c4e55';
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 8]);
    ctx.beginPath();
    ctx.moveTo(x + 14, hitY);
    ctx.lineTo(x + w - 14, hitY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Tiles
    if (screen !== 'menu') {
      const pad = Math.max(8, laneW * 0.1);
      for (const n of notes) {
        const cx = laneX(n.lane);
        if (n.state === 'pending') {
          const ny = noteY(n);
          if (ny < y - tileH || ny > y + h + tileH) continue;
          const d = Math.abs(n.beat - scrollBeat);
          const near = Math.max(0, 1 - d / 0.6);
          // Waiting tiles breathe softly to invite a press.
          const breathe = pace.wait && d < 0.02 ? (Math.sin(time * 2.6) * 0.5 + 0.5) * swayAmp : 0;
          if (near > 0) {
            ctx.fillStyle = `rgba(240,202,158,${0.35 * near + 0.15 * breathe})`;
            roundRect(cx - laneW / 2 + pad - 6, ny - tileH / 2 - 6, laneW - pad * 2 + 12, tileH + 12, 18);
            ctx.fill();
          }
          const grad = ctx.createLinearGradient(0, ny - tileH / 2, 0, ny + tileH / 2);
          grad.addColorStop(0, '#5b3d2f');
          grad.addColorStop(1, '#4a3025');
          ctx.fillStyle = grad;
          ctx.globalAlpha = 0.88;
          roundRect(cx - laneW / 2 + pad, ny - tileH / 2, laneW - pad * 2, tileH, 14);
          ctx.fill();
          ctx.globalAlpha = 1;
          // Tiny leaf mark on each tile
          leaf(cx - 7, ny + 3, -0.5, 14, 4.5, '#9fb08a', 0.8);
        } else if (n.state === 'hit' && n.t < 0.6) {
          const k = n.t / 0.6;
          const s = 1 + k * 0.25;
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = '#a86c4e';
          const tw = (laneW - pad * 2) * s, th = tileH * s;
          roundRect(cx - tw / 2, n.hitY - th / 2, tw, th, 14);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (n.state === 'missed' && n.t < 0.9) {
          const ny = noteY(n);
          ctx.globalAlpha = 0.5 * (1 - n.t / 0.9);
          ctx.fillStyle = '#d7b391';
          roundRect(cx - laneW / 2 + pad, ny - tileH / 2, laneW - pad * 2, tileH, 14);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    // Ripples
    for (const r of ripples) {
      const k = r.t / 1.1;
      ctx.strokeStyle = `rgba(168,108,78,${0.45 * (1 - k)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 12 + k * laneW * 0.9, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Key labels
    const ky = Math.min(y + h - 30, hitY + (y + h - hitY) / 2);
    ctx.font = '13px "DM Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) {
      const kx = laneX(i);
      ctx.fillStyle = laneFlash[i] ? `rgba(159,176,138,${0.3 + 0.5 * laneFlash[i]})` : '#fffaf4b3';
      roundRect(kx - 17, ky - 17, 34, 34, 10);
      ctx.fill();
      ctx.strokeStyle = '#bda99888';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#4a3025';
      ctx.fillText(KEY_LABELS[i], kx, ky + 1);
    }

    ctx.restore();
  }

  function drawPetals() {
    for (const p of petals) {
      const a = Math.max(0, 1 - p.t / 3);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ---------- Loop ---------- */

  let lastTs = performance.now();
  function frame(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    const time = ts / 1000;
    update(dt);
    drawBackground(time);
    drawField(time);
    drawForeground(time);
    drawSprout(time, dt);
    drawPetals();
    requestAnimationFrame(frame);
  }

  /* ---------- UI ---------- */

  const screens = { menu: $('startScreen'), paused: $('pauseScreen'), ended: $('endScreen') };
  let breathTimer = null;

  function showScreen(name) {
    screen = name;
    for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
    $('pauseBtn').hidden = name !== 'playing';
    clearInterval(breathTimer);
    if (name === 'paused') {
      const label = $('breathLabel');
      const circle = document.querySelector('.breath span');
      circle.style.animation = 'none';
      void circle.offsetWidth; // restart so the label stays in sync
      circle.style.animation = '';
      let inhale = true;
      label.textContent = 'Breathe in…';
      breathTimer = setInterval(() => { inhale = !inhale; label.textContent = inhale ? 'Breathe in…' : 'Breathe out…'; }, 4000);
      $('resumeBtn').focus();
    } else if (name === 'ended') {
      $('againBtn').focus();
    } else if (name === 'menu') {
      $('beginBtn').focus();
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function pause() { if (screen === 'playing') showScreen('paused'); }
  function resume() { if (screen === 'paused') { initAudio(); showScreen('playing'); } }

  function announce(text) { $('liveRegion').textContent = text; }

  function buildChips(container, items, key, onChange) {
    container.setAttribute('role', 'radiogroup');
    const render = () => {
      for (const btn of container.children) btn.setAttribute('aria-checked', String(btn.dataset.id === settings[key]));
    };
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.setAttribute('role', 'radio');
      btn.dataset.id = item.id;
      btn.textContent = item.name;
      btn.addEventListener('click', () => { settings[key] = item.id; saveSettings(); render(); onChange && onChange(); });
      container.appendChild(btn);
    }
    render();
  }

  const updatePaceHint = () => { $('paceHint').textContent = (PACES.find((p) => p.id === settings.pace) || PACES[0]).hint; };
  buildChips($('songChips'), SONGS, 'song');
  buildChips($('paceChips'), PACES, 'pace', updatePaceHint);
  updatePaceHint();
  setSound(settings.sound);

  $('beginBtn').addEventListener('click', startGame);
  $('resumeBtn').addEventListener('click', resume);
  $('againBtn').addEventListener('click', startGame);
  $('menuBtn').addEventListener('click', () => showScreen('menu'));
  $('endMenuBtn').addEventListener('click', () => showScreen('menu'));
  $('pauseBtn').addEventListener('click', pause);
  $('soundBtn').addEventListener('click', () => { initAudio(); setSound(!settings.sound); });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onButton = e.target instanceof HTMLButtonElement;
    const key = e.key.toLowerCase();

    if (key === 'escape' || (key === ' ' && !onButton)) {
      e.preventDefault();
      if (screen === 'playing') pause();
      else if (screen === 'paused') resume();
      return;
    }
    if (key === 'm' && !e.repeat) { initAudio(); setSound(!settings.sound); return; }
    if (screen === 'playing' && key in KEYS && !e.repeat) {
      e.preventDefault();
      press(KEYS[key]);
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (screen !== 'playing') return;
    const { x, y, w, h, laneW } = field;
    if (e.clientX < x || e.clientX > x + w || e.clientY < y || e.clientY > y + h) return;
    press(Math.min(3, Math.floor((e.clientX - x) / laneW)));
  });

  // Never let the game run on while the person has stepped away.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);
  window.addEventListener('resize', resize);

  resize();
  showScreen('menu');
  requestAnimationFrame(frame);
})();
