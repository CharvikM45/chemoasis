/*
 * Tiled brain: flat tiles laid edge to edge over the brain's surface.
 * The shape is a set of implicit surfaces (signed distance fields); every grid cell the surface
 * passes through becomes one tile, facing outward, coloured by the part of the brain it sits on.
 *
 * Coordinates: x = left/right, y = up, z = toward the face. The brain fits in about ±1.
 */

/* ---------- 3D simplex noise (seeded), for gently wavy lobe boundaries ---------- */

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
function noise3(xin, yin, zin) {
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

// One hemisphere's outer shape, mirrored. The gap between hemispheres stays open.
function cortex(x, y, z) {
  const ax = Math.abs(x);
  const front = ellipsoid(ax - 0.29, y - 0.1, z - 0.4, 0.33, 0.5, 0.56);
  const back = ellipsoid(ax - 0.35, y - 0.13, z + 0.24, 0.38, 0.57, 0.63);
  const temporal = ellipsoid(ax - 0.46, y + 0.23, z - 0.1, 0.22, 0.24, 0.52);
  let d = smin(smin(front, back, 0.2), temporal, 0.16);
  d = Math.max(d, 0.03 - ax);
  d = Math.max(d, -(y + 0.44));
  return d;
}

function cerebellum(x, y, z) {
  const ax = Math.abs(x);
  const lobe = ellipsoid(ax - 0.21, y + 0.42, z + 0.56, 0.31, 0.22, 0.29);
  const vermis = ellipsoid(x, y + 0.42, z + 0.6, 0.12, 0.2, 0.26);
  return smin(lobe, vermis, 0.08);
}

function brainstem(x, y, z) {
  const stem = capsule(x, y, z, 0, -0.16, -0.12, 0, -0.86, -0.3, 0.12, 0.075);
  const pons = ellipsoid(x, y + 0.42, z + 0.06, 0.16, 0.14, 0.13);
  return smin(stem, pons, 0.1);
}

// Lobe boundaries, leaning like the real fissures.
const sylvian = (y, z) => (y + 0.1 + 0.28 * z) / 1.038 + 0.025 * noise3(y * 2.6, z * 2.6, 4.1); // < 0 below the lateral fissure
const central = (y, z) => (0.1 - 0.22 * y - z) / 1.024 + 0.028 * noise3(y * 3.1, z * 2.2, 8.7); // < 0 in front of the central sulcus
const occipitalLine = (y, z) => (z - (-0.58 + 0.12 * y)) / 1.007 + 0.022 * noise3(y * 2.8, z * 2.8, 1.9); // < 0 behind it

// 0 frontal, 1 parietal, 2 temporal, 3 occipital, 4 cerebellum, 5 brainstem
export const REGIONS = ['frontal', 'parietal', 'temporal', 'occipital', 'cerebellum', 'brainstem'];
function lobe(y, z) {
  if (occipitalLine(y, z) < 0) return 3;
  if (sylvian(y, z) < 0) return 2;
  return central(y, z) < 0 ? 0 : 1;
}

// Folds: long, wavy grooves like gyri. True where a tile sits in a groove.
function inGroove(x, y, z) {
  const above = (y + 0.1 + 0.28 * z) > 0;
  const qx = x + 0.12 * noise3(x * 1.7, y * 1.7, z * 1.7);
  const qy = y + 0.12 * noise3(x * 1.7 + 5.2, y * 1.7 + 1.3, z * 1.7);
  const qz = z + 0.12 * noise3(x * 1.7, y * 1.7 + 9.1, z * 1.7 + 2.7);
  const dir = above ? qz + 0.22 * qy : qy - 0.18 * qz;
  return Math.sin(dir * 26 + 4 * noise3(qx * 3.2, qy * 3.2, qz * 3.2)) > 0.62;
}

function shape(x, y, z) {
  return Math.min(cortex(x, y, z), cerebellum(x, y, z), brainstem(x, y, z));
}
function regionAt(x, y, z) {
  const c = cortex(x, y, z), b = cerebellum(x, y, z), s = brainstem(x, y, z);
  if (c <= b && c <= s) return lobe(y, z);
  return b <= s ? 4 : 5;
}

/*
 * Lays tiles over the surface: one per grid cell the surface passes through, moved onto the
 * surface and turned to face outward. Returns typed arrays ready for instanced drawing.
 */
export function buildTiles(spacing = 0.042) {
  const min = [-0.8, -1.0, -1.0], max = [0.8, 0.82, 1.05];
  const n = min.map((m, i) => Math.ceil((max[i] - m) / spacing));
  const home = [], normal = [], region = [], groove = [];
  const e = spacing * 0.1;
  for (let k = 0; k < n[2]; k++) {
    const z = min[2] + (k + 0.5) * spacing;
    for (let j = 0; j < n[1]; j++) {
      const y = min[1] + (j + 0.5) * spacing;
      for (let i = 0; i < n[0]; i++) {
        const x = min[0] + (i + 0.5) * spacing;
        const d = shape(x, y, z);
        if (Math.abs(d) > spacing * 0.5) continue;
        let nx = shape(x + e, y, z) - shape(x - e, y, z);
        let ny = shape(x, y + e, z) - shape(x, y - e, z);
        let nz = shape(x, y, z + e) - shape(x, y, z - e);
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        let px = x - nx * d, py = y - ny * d, pz = z - nz * d;
        const r = regionAt(px, py, pz);
        const g = r <= 3 && inGroove(px, py, pz); // cortex only
        if (g) { px -= nx * spacing * 0.45; py -= ny * spacing * 0.45; pz -= nz * spacing * 0.45; }
        home.push(px, py, pz);
        normal.push(nx, ny, nz);
        region.push(r);
        groove.push(g ? 1 : 0);
      }
    }
  }
  return { count: region.length, home: new Float32Array(home), normal: new Float32Array(normal), region: Uint8Array.from(region), groove: Uint8Array.from(groove), spacing };
}
