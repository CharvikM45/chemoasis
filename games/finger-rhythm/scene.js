/* Garden backdrop: swaying plants, drifting motes, petals, and a sprout that
 * grows with each tap and blooms at the end of a round. Purely decorative. */
window.GardenScene = (() => {
  'use strict';

  const canvas = document.getElementById('garden');
  const ctx = canvas.getContext('2d');
  const GREENS = ['#6f8460', '#86996f', '#9fb08a', '#5d7052', '#a9b893', '#7d8f69'];

  let W = 0, H = 0;
  let calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let plants = [], grass = [], motes = [], petals = [];
  const sprout = { g: 0, target: 0, bloom: 0, bloomTarget: 0 };

  function mulberry32(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  function build() {
    const rand = mulberry32(11);
    plants = [];
    const sideW = Math.max(W * 0.2, 120);
    const count = Math.max(3, Math.round(sideW / 70));
    const addSide = (fromX, toX) => {
      for (let i = 0; i < count; i++) {
        const back = i % 2 === 0;
        plants.push({
          x: fromX + (toX - fromX) * ((i + 0.5) / count) + (rand() - 0.5) * 40,
          h: (back ? 0.32 : 0.24) * H + rand() * 0.18 * H,
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
    addSide(-20, sideW);
    addSide(W - sideW, W + 20);

    grass = [];
    for (let x = -10; x < W + 10; x += 9 + rand() * 10) {
      grass.push({ x, h: 16 + rand() * 40, lean: (rand() - 0.5) * 0.5, phase: rand() * 6, color: GREENS[Math.floor(rand() * GREENS.length)] });
    }

    motes = [];
    for (let i = 0; i < 36; i++) {
      motes.push({ x: rand() * W, y: rand() * H, r: 1 + rand() * 2.4, vy: 4 + rand() * 9, phase: rand() * 6, warm: rand() < 0.4 });
    }
  }

  const sway = () => (calm ? 0.2 : 1);
  const wind = (time, phase, speed) => sway() * (Math.sin(time * speed + phase) * 0.05 + Math.sin(time * 0.17 + phase * 0.3) * 0.035);

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

  function stem(x, baseY, h, lean, swayAngle, color, width) {
    const ang = lean + swayAngle;
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
        leaf(pt.x, pt.y, pt.a + (i % 2 ? -1 : 1) * 0.75 + wind(time, p.phase + i, 0.9) * 2, size, size * 0.36, p.color);
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
        ctx.lineTo(x, H * base + Math.sin(x * 0.004 + seed) * amp + Math.sin(x * 0.011 + seed * 2) * amp * 0.4);
      }
      ctx.lineTo(W, H);
      ctx.fill();
    };
    hill(0.7, 26, '#e4e4d0', 1.3);
    hill(0.8, 20, '#d9ddc5', 4.1);

    for (const m of motes) {
      let y = calm ? m.y : (m.y - time * m.vy) % (H + 20);
      if (y < -10) y += H + 20;
      const x = m.x + Math.sin(time * 0.3 + m.phase) * 14 * sway();
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 0.8 + m.phase);
      ctx.fillStyle = m.warm ? '#f0ca9e' : '#fffaf4';
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const p of plants) if (p.back) drawPlant(p, time);
  }

  function drawForeground(time) {
    for (const p of plants) if (!p.back) drawPlant(p, time);
    ctx.globalAlpha = 0.8;
    for (const g of grass) leaf(g.x, H + 2, -Math.PI / 2 + g.lean + wind(time, g.phase, 0.8), g.h, 2.4, g.color);
    ctx.globalAlpha = 1;
  }

  function drawSprout(time, dt) {
    sprout.g += (sprout.target - sprout.g) * Math.min(1, dt * 2.5);
    sprout.bloom += (sprout.bloomTarget - sprout.bloom) * Math.min(1, dt * 1.5);
    if (W < 820) return;
    const x = W * 0.86, baseY = H - 40;
    const h = 18 + Math.min(H * 0.38, 300) * sprout.g;

    ctx.fillStyle = '#8f6250';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(x, baseY + 6, 46, 14, 0, Math.PI, 0);
    ctx.fill();
    ctx.globalAlpha = 1;

    const at = stem(x, baseY, h, 0, wind(time, 1.7, 0.6) * 0.7, '#5d7052', 3.2);
    const leaves = 10;
    for (let i = 0; i < leaves; i++) {
      const grow = Math.max(0, Math.min(1, (sprout.g - i / leaves) * 5));
      if (!grow) continue;
      const pt = at(0.15 + (i / leaves) * 0.8);
      const size = (26 - i * 1.2) * grow;
      leaf(pt.x, pt.y, pt.a + (i % 2 ? -1 : 1) * 0.9, size, size * 0.38, i % 3 ? '#7d8f69' : '#9fb08a');
    }

    const tip = at(1);
    if (sprout.bloom > 0.01) {
      const b = sprout.bloom;
      ctx.save();
      ctx.translate(tip.x, tip.y);
      ctx.rotate(time * 0.05 * sway());
      for (let i = 0; i < 7; i++) leaf(0, 0, (i / 7) * Math.PI * 2, 22 * b, 10 * b, i % 2 ? '#e3a68a' : '#d99377', 0.95);
      ctx.fillStyle = '#f0ca9e';
      ctx.beginPath();
      ctx.arc(0, 0, 6 * b, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = '#9fb08a';
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 3 + sprout.g * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPetals(dt) {
    petals = petals.filter((p) => {
      p.t += dt;
      p.vy += 20 * dt;
      p.x += (p.vx + Math.sin(p.t * 2 + p.rot) * 12) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - p.t / 3) * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return p.t < 3;
    });
  }

  let last = performance.now();
  function frame(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    const time = ts / 1000;
    drawBackground(time);
    drawForeground(time);
    drawSprout(time, dt);
    drawPetals(dt);
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  return {
    setCalm(on) { calm = on; },
    setGrowth(g) { sprout.target = Math.max(0, Math.min(1, g)); },
    setBloom(on) { sprout.bloomTarget = on ? 1 : 0; },
    burst(x, y, color) {
      if (calm) return;
      for (let i = 0; i < 4; i++) {
        petals.push({
          x: x + (Math.random() - 0.5) * 40, y,
          vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 35,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 2, t: 0,
          color: [color, '#e3a68a', '#f0ca9e', '#d7b391'][i],
        });
      }
    },
  };
})();
