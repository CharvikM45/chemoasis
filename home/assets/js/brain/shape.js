/*
 * The brain's shape as a signed distance field: negative inside, positive outside.
 * Built like a real brain, not a blob with random ripples:
 * - each hemisphere is a frontal, a parietal and an occipital part blended together, with a flat
 *   medial side, a flattened underside and a separate temporal lobe below a deep lateral fissure;
 * - the folds follow the real layout: the central sulcus slanting down and forward, with the
 *   precentral and postcentral sulci parallel to it; frontal and temporal gyri running front to
 *   back; looser, more maze-like folds in the parietal and occipital lobes;
 * - gyri are broad and rounded, sulci narrow and deep; the two hemispheres fold a little
 *   differently, like real ones;
 * - a cerebellum with fine parallel folia tucked under the back, and a smooth brainstem.
 * Coordinates: x = left/right, y = up, z = toward the face. The brain fits in about ±1.
 */

/* ---------- 3D simplex noise (seeded) ---------- */

const GRAD = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
const perm = new Uint8Array(512);
const permMod12 = new Uint8Array(512);
let seed = 1337;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
(() => {
  const p = new Uint8Array(256).map((_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }
})();

const F3 = 1 / 3, G3 = 1 / 6;
function corner(t, gi, x, y, z) {
  if (t < 0) return 0;
  const g = gi * 3;
  t *= t;
  return t * t * (GRAD[g] * x + GRAD[g + 1] * y + GRAD[g + 2] * z);
}
export function noise3(xin, yin, zin) {
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
  const t = (i + j + k) * G3;
  const x0 = xin - i + t, y0 = yin - j + t, z0 = zin - k + t;
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
  else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
  else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  return 32 * (
    corner(0.6 - x0 * x0 - y0 * y0 - z0 * z0, permMod12[ii + perm[jj + perm[kk]]], x0, y0, z0) +
    corner(0.6 - x1 * x1 - y1 * y1 - z1 * z1, permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]], x1, y1, z1) +
    corner(0.6 - x2 * x2 - y2 * y2 - z2 * z2, permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]], x2, y2, z2) +
    corner(0.6 - x3 * x3 - y3 * y3 - z3 * z3, permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]], x3, y3, z3)
  );
}

/* ---------- helpers ---------- */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function smin(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); }
function smax(a, b, k) { return -smin(-a, -b, k); }

// Inigo Quilez's ellipsoid distance bound.
function ellipsoid(x, y, z, rx, ry, rz) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function capsule(x, y, z, ax, ay, az, bx, by, bz, ra, rb) {
  const px = x - ax, py = y - ay, pz = z - az;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const h = clamp((px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz), 0, 1);
  return Math.hypot(px - dx * h, py - dy * h, pz - dz * h) - (ra + (rb - ra) * h);
}

// A maze of folds with one main spacing (band-limited noise: a sum of waves of the same
// wavelength in random directions). Its zero lines wander, branch and stop like real secondary
// sulci. Spread about ±1.
const WAVES = 18;
const waveDir = new Float32Array(WAVES * 3), wavePhase = new Float32Array(WAVES);
for (let i = 0; i < WAVES; i++) {
  const u = rand() * 2 - 1, a = rand() * TAU, r = Math.sqrt(1 - u * u);
  waveDir.set([r * Math.cos(a), u, r * Math.sin(a)], i * 3);
  wavePhase[i] = rand() * TAU;
}
function maze(x, y, z, wavelength) {
  const k = TAU / wavelength;
  let s = 0;
  for (let i = 0; i < WAVES; i++) s += Math.cos(k * (waveDir[i * 3] * x + waveDir[i * 3 + 1] * y + waveDir[i * 3 + 2] * z) + wavePhase[i]);
  return s / Math.sqrt(WAVES / 2);
}

// Parallel folds: a sulcus at every whole-number phase, the crown of a gyrus halfway between.
const stripes = (phase) => Math.sin(Math.PI * phase);

/* ---------- the cerebrum ---------- */

// One hemisphere's smooth outer shape (ax = distance from the midline).
function hemisphere(ax, y, z) {
  const frontal = ellipsoid(ax - 0.33, y - 0.07, z - 0.4, 0.37, 0.46, 0.52);
  const parietal = ellipsoid(ax - 0.36, y - 0.14, z + 0.08, 0.4, 0.52, 0.58);
  const occipital = ellipsoid(ax - 0.3, y - 0.04, z + 0.52, 0.33, 0.4, 0.4);
  let d = smin(smin(frontal, parietal, 0.2), occipital, 0.2);
  d = smax(d, -0.26 + 0.1 * z - y, 0.1); // the flatter underside, rising toward the front
  // The temporal lobe hangs below the lateral fissure, its pole pointing forward and down.
  const temporal = ellipsoid(ax - 0.49, y + 0.22 + 0.12 * z, z - 0.03, 0.23, 0.21, 0.5);
  d = smin(d, temporal, 0.045); // a small blend leaves a crease: the lateral fissure
  return smax(d, 0.016 - ax, 0.035); // a flat inner side with a rounded edge: the longitudinal fissure
}

// Where the main fissures run (lateral view: z = front/back, y = height).
// Central sulcus: from the top, just behind the middle, slanting down and forward to the lateral fissure.
const central = (y, z) => (z - 0.2 + 0.344 * y) * 0.946; // > 0 in front of it
// Lateral fissure: from the temporal pole back and slightly up. > 0 below it.
const belowLateral = (y, z) => -0.1 + 0.26 * (0.4 - z) - y;

// How deep the folds cut in at a point near the surface (0 = crown of a gyrus).
function folds(x, y, z, ax) {
  const side = x < 0 ? 31.7 : 0; // the two hemispheres fold a little differently
  const nx = x + side;
  const wobble = (f, o) => noise3(nx * f + o, y * f + o * 0.7, z * f - o * 0.3);

  const c = central(y, z);
  const below = belowLateral(y, z);

  // How much each region's pattern applies here.
  const back = smoothstep(-0.4, -0.62, z); // occipital lobe
  const temporal = smoothstep(-0.005, 0.05, below) * smoothstep(-0.62, -0.38, z);
  const upper = (1 - temporal) * (1 - back);
  const band = 1 - smoothstep(0.17, 0.25, Math.abs(c)); // central, precentral and postcentral sulci
  const wCentral = upper * band;
  const wFrontal = upper * (1 - band) * (c > 0 ? 1 : 0);
  const wParietal = upper * (1 - band) * (c > 0 ? 0 : 1);

  // Sulci run along the zero lines of this pattern; the further from zero, the closer to the
  // crown of a gyrus.
  let n = 0;
  if (wCentral > 0) n += wCentral * stripes(c / 0.14 + 0.16 * wobble(2.4, 3.1));
  if (wFrontal > 0) {
    const theta = Math.atan2(y, ax - 0.12); // around a front-to-back axis: gyri run front to back
    n += wFrontal * stripes((theta - 0.5) / 0.4 + 0.3 * wobble(2.6, 7.7));
  }
  if (wParietal > 0) {
    const theta = Math.atan2(y, ax - 0.12);
    n += wParietal * stripes((theta - 0.85) / 0.42 + 0.4 * wobble(2.8, 11.3));
  }
  if (temporal > 0) {
    const theta = Math.atan2(y + 0.24 + 0.1 * z, ax - 0.42); // around the temporal lobe's own axis
    n += temporal * stripes((theta - 0.55) / 0.65 + 0.25 * wobble(2.6, 15.9));
  }
  if (back > 0) n += back * stripes(y / 0.13 + 0.45 * wobble(3, 19.1));

  // Secondary folds: some maze everywhere, more in the parietal and occipital lobes, so gyri
  // wander, branch and stop instead of running in perfect rows.
  const w = 0.05;
  const qx = nx + w * wobble(3.1, 23.3), qy = y + w * wobble(3.1, 29.9), qz = z + w * wobble(3.1, 37.1);
  const m = clamp(0.32 + 0.2 * wParietal + 0.22 * back + 0.3 * (1 - wCentral - wFrontal - wParietal - temporal - back), 0, 0.8);
  n = (n * (1 - m) + maze(qx, qy, qz, 0.25) * m) / Math.hypot(1 - m, m);
  n = (n + 0.18 * maze(qz * 1.3, qx * 1.3, qy * 1.3, 0.14)) / 1.016; // small side branches

  // Profile across a gyrus: a rounded crown, like half a tube, dropping steeply into the sulcus.
  // 0 on a sulcus line, 1 on a crown. Folding n like this also adds a ring of sulci inside any
  // patch where n stays large, so no gyrus grows into a wide flat plateau.
  const f = Math.abs(Math.sin(n * (Math.PI / 2.4)));
  const g = 1 - f;
  let depth = 0.072 * (1 - Math.sqrt(Math.max(0, 1 - g * g)));
  depth *= 0.45 + 0.55 * smoothstep(0.02, 0.12, ax); // gentler on the hidden inner side

  // The central sulcus is a little deeper than its neighbours; the lateral fissure much deeper.
  depth += 0.02 * Math.exp(-((c / 0.02) ** 2)) * wCentral;
  depth += 0.085 * Math.exp(-((below / 0.03) ** 2)) * smoothstep(0.28, 0.42, ax) * smoothstep(-0.32, -0.12, z);
  return depth;
}

function cerebrum(x, y, z) {
  const ax = Math.abs(x);
  const d = hemisphere(ax, y, z);
  if (d > 0.13 || d < -0.2) return d; // far from the surface: the folds don't matter
  return d - 0.03 + folds(x, y, z, ax);
}

/* ---------- cerebellum and brainstem ---------- */

function cerebellum(x, y, z) {
  const ax = Math.abs(x);
  const lobe = ellipsoid(ax - 0.21, y + 0.47, z + 0.5, 0.28, 0.19, 0.27);
  const vermis = ellipsoid(x, y + 0.46, z + 0.55, 0.1, 0.19, 0.24);
  const d = smin(lobe, vermis, 0.07);
  if (d > 0.06 || d < -0.08) return d;
  // Folia: fine grooves curving around the cerebellum, plus one deeper horizontal fissure.
  const r = Math.hypot(y + 0.62, (z + 0.42) * 0.9);
  const folia = Math.sin(r * 105 + 1.5 * noise3(x * 4, y * 4, z * 4));
  const fissure = Math.exp(-(((r - 0.27) / 0.012) ** 2));
  return d + 0.009 * smoothstep(0.1, 1, folia) + 0.03 * fissure;
}

function brainstem(x, y, z) {
  const stem = capsule(x, y, z, 0, -0.2, -0.12, 0, -0.86, -0.28, 0.115, 0.078);
  const pons = ellipsoid(x, y + 0.44, z + 0.06, 0.15, 0.13, 0.12);
  return smin(stem, pons, 0.08);
}

export function field(x, y, z) {
  // Hard joins keep visible creases between the cerebrum, cerebellum and brainstem.
  return Math.min(cerebrum(x, y, z), cerebellum(x, y, z), brainstem(x, y, z));
}

export const BOUNDS = { min: [-0.82, -0.98, -1.0], max: [0.82, 0.76, 1.0] };
