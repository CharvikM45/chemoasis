/*
 * The brain's shape as a signed distance field: negative inside, positive outside.
 * Smooth lobes (ellipsoids), then rounded gyri carved in by narrow sulci, a finely ridged
 * cerebellum and a smooth brainstem.
 * Coordinates: x = left/right, y = up, z = toward the face. The brain fits in about ±1.
 */

/* ---------- 3D simplex noise (seeded) ---------- */

const GRAD = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
const perm = new Uint8Array(512);
const permMod12 = new Uint8Array(512);
(() => {
  let seed = 1337;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
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

/* ---------- shapes ---------- */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function smin(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); }

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

// One hemisphere's smooth outer shape, mirrored, with a narrow gap between the halves.
function cortexBase(x, y, z) {
  const ax = Math.abs(x);
  const front = ellipsoid(ax - 0.29, y - 0.1, z - 0.4, 0.34, 0.5, 0.56);
  const back = ellipsoid(ax - 0.34, y - 0.13, z + 0.24, 0.39, 0.56, 0.62);
  const temporal = ellipsoid(ax - 0.45, y + 0.24, z - 0.08, 0.23, 0.24, 0.5);
  let d = smin(smin(front, back, 0.22), temporal, 0.28);
  return Math.max(d, 0.022 - ax);
}

// 0..1: 1 in the middle of a sulcus. Long, wandering ridges like the gyri in a real brain:
// vertical above the lateral fissure, running front-to-back on the temporal lobe.
function sulcus(x, y, z) {
  const w = 0.13;
  const qx = x + w * noise3(x * 1.6, y * 1.6, z * 1.6);
  const qy = y + w * noise3(x * 1.6 + 5.2, y * 1.6 + 1.3, z * 1.6);
  const qz = z + w * noise3(x * 1.6, y * 1.6 + 9.1, z * 1.6 + 2.7);
  const above = smoothstep(-0.06, 0.06, y + 0.1 + 0.28 * z);
  const dir = (qy - 0.18 * qz) + ((qz + 0.25 * qy) - (qy - 0.18 * qz)) * above;
  const s = Math.sin(dir * 23 + 3.2 * noise3(qx * 2.6, qy * 2.6, qz * 2.6));
  const h = (s + 1) * 0.5;
  // Where the two fold directions meet, fade the folds out; the lateral fissure takes over.
  const calm = smoothstep(0.03, 0.13, Math.abs(y + 0.1 + 0.28 * z));
  return Math.pow(h, 2.2) * calm; // broad, rounded gyri; narrower sulci
}

// The lateral (Sylvian) fissure: one deep groove above the temporal lobe.
function lateralFissure(x, y, z) {
  const ax = Math.abs(x);
  const line = (y + 0.1 + 0.28 * z) / 1.038 + 0.02 * noise3(y * 2.6, z * 2.6, 4.1);
  return smoothstep(0.08, 0, Math.abs(line)) * smoothstep(0.25, 0.4, ax) * smoothstep(0.55, 0.25, z);
}

const GYRI_DEPTH = 0.085;
function cortex(x, y, z) {
  const d = cortexBase(x, y, z);
  if (d > 0.12 || d < -0.16) return d; // far from the surface: the folds don't matter
  return d - 0.025 + GYRI_DEPTH * sulcus(x, y, z) + 0.05 * lateralFissure(x, y, z);
}

function cerebellum(x, y, z) {
  const ax = Math.abs(x);
  const lobe = ellipsoid(ax - 0.21, y + 0.42, z + 0.55, 0.31, 0.22, 0.29);
  const vermis = ellipsoid(x, y + 0.42, z + 0.6, 0.12, 0.2, 0.26);
  const d = smin(lobe, vermis, 0.08);
  if (d > 0.06) return d;
  const zz = z + 0.55;
  const folia = Math.sin((y + 0.2 * zz * zz) * 70 + 1.2 * noise3(x * 3, y * 3, z * 3));
  return d + 0.012 * smoothstep(0.2, 1, folia);
}

function brainstem(x, y, z) {
  const stem = capsule(x, y, z, 0, -0.18, -0.14, 0, -0.84, -0.3, 0.12, 0.08);
  const pons = ellipsoid(x, y + 0.43, z + 0.07, 0.16, 0.14, 0.13);
  return smin(stem, pons, 0.1);
}

export function field(x, y, z) {
  return Math.min(cortex(x, y, z), smin(cerebellum(x, y, z), brainstem(x, y, z), 0.04));
}

export const BOUNDS = { min: [-0.8, -0.98, -1.0], max: [0.8, 0.82, 1.05] };
