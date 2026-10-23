/*
 * Procedural brain: every part is an implicit shape (signed distance field) turned into a
 * closed mesh with marching cubes, so each part can fly apart on its own.
 *
 * Coordinates: x = left/right, y = up, z = toward the face. The brain fits in about ±1.
 * The mesh carries the shapes; intro.js draws the gyri per pixel (folds.js).
 */
import { foldS, foliaS } from './folds.js';

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

/* ---------- shape helpers ---------- */

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

/* ---------- cortex ---------- */

// One hemisphere's smooth outer shape (before folds). ax = |x|.
export function cortexBase(x, y, z) {
  const ax = Math.abs(x);
  const front = ellipsoid(ax - 0.29, y - 0.1, z - 0.4, 0.33, 0.5, 0.56);
  const back = ellipsoid(ax - 0.35, y - 0.13, z + 0.24, 0.38, 0.57, 0.63);
  const temporal = ellipsoid(ax - 0.46, y + 0.23, z - 0.1, 0.22, 0.24, 0.52);
  let d = smin(smin(front, back, 0.2), temporal, 0.16);
  d = Math.max(d, 0.016 - ax); // flat inner wall + the gap between hemispheres
  d = Math.max(d, -(y + 0.44)); // underside
  return d;
}

// 0..1: gentle lumps so the outline isn't perfectly smooth. All folds are drawn by the shader:
// the mesh grid is too coarse for real sulci, and trying makes stair-step artifacts.
export function groove(x, y, z) {
  return smoothstep(-0.4, 0.8, noise3(x * 3.4, y * 3.4, z * 3.4));
}

const FOLD_DEPTH = 0.022;

/* ---------- lobes ---------- */

// Boundaries, all leaning like the real fissures.
const sylvian = (y, z) => (y + 0.1 + 0.28 * z) / 1.038 + 0.025 * noise3(y * 2.6, z * 2.6, 4.1); // < 0 below the lateral fissure
const central = (y, z) => (0.1 - 0.22 * y - z) / 1.024 + 0.028 * noise3(y * 3.1, z * 2.2, 8.7); // < 0 in front of the central sulcus
const occipital = (y, z) => (z - (-0.58 + 0.12 * y)) / 1.007 + 0.022 * noise3(y * 2.8, z * 2.8, 1.9); // < 0 behind the parieto-occipital line

const REGIONS = {
  frontal: (y, z) => Math.max(central(y, z), -sylvian(y, z)),
  parietal: (y, z) => Math.max(-central(y, z), -occipital(y, z), -sylvian(y, z)),
  temporal: (y, z) => Math.max(sylvian(y, z), -occipital(y, z)),
  occipital: (y, z) => occipital(y, z)
};

/* ---------- deep and lower parts ---------- */

function cerebellum(x, y, z) {
  const ax = Math.abs(x);
  const lobe = ellipsoid(ax - 0.21, y + 0.42, z + 0.56, 0.31, 0.22, 0.29);
  const vermis = ellipsoid(x, y + 0.42, z + 0.6, 0.12, 0.2, 0.26);
  return smin(lobe, vermis, 0.08);
}
function cerebellumFolds(x, y, z) {
  return smoothstep(-0.25, 1, foliaS(x, y, z));
}

function brainstem(x, y, z) {
  const stem = capsule(x, y, z, 0, -0.16, -0.12, 0, -0.86, -0.3, 0.12, 0.075);
  const pons = ellipsoid(x, y + 0.42, z + 0.06, 0.16, 0.14, 0.13);
  const d = smin(stem, pons, 0.1);
  return d + 0.006 * Math.sin(x * 70 + 2 * noise3(x * 4, y * 4, z * 4)); // lengthwise fibre ridges
}

function corpusCallosum(x, y, z) {
  // A flattened arch along the middle, joining the hemispheres.
  const cy = y + 0.04, cz = z + 0.02;
  const thick = 0.038 + 0.04 * smoothstep(0.12, 0.36, Math.abs(cz)); // thicker genu and splenium
  const ring = Math.hypot(Math.hypot(cy, cz * 0.82) - 0.36, x * 0.32) - thick + 0.004 * Math.sin(x * 90);
  return Math.max(ring, -cy - 0.02);
}

const HIPPO = [[0.3, -0.3, 0.16], [0.35, -0.24, -0.04], [0.33, -0.15, -0.22], [0.23, -0.03, -0.32]];
function hippocampus(x, y, z, side) {
  let d = Infinity;
  for (let i = 0; i < HIPPO.length - 1; i++) {
    const a = HIPPO[i], b = HIPPO[i + 1];
    const ra = 0.062 - i * 0.009, rb = 0.062 - (i + 1) * 0.009;
    d = Math.min(d, capsule(x, y, z, a[0] * side, a[1], a[2], b[0] * side, b[1], b[2], ra, rb));
  }
  return d + 0.01 * noise3(x * 16, y * 16, z * 16);
}

/* ---------- parts list ---------- */

// impact: 0..1, how consistently brain-imaging research links this part to
// chemotherapy-related cognitive changes. Illustrative, not a measurement.
export const PARTS = [
  { id: 'frontal', impact: 0.85 },
  { id: 'hippocampus', impact: 0.8 },
  { id: 'callosum', impact: 0.75 },
  { id: 'parietal', impact: 0.55 },
  { id: 'temporal', impact: 0.5 },
  { id: 'cerebellum', impact: 0.35 },
  { id: 'occipital', impact: 0.25 },
  { id: 'brainstem', impact: 0.15 }
];

// Where each piece flies when the brain comes apart (left side; right side mirrors x).
// x is toward the viewer for the near half; the far half (mirrored x) drifts back and up.
const EXPLODE = {
  frontal: [0.3, 0.22, 0.72],
  parietal: [0.3, 0.6, -0.1],
  temporal: [0.5, -0.42, 0.36],
  occipital: [0.25, 0.16, -0.8],
  hippocampus: [0.9, -0.28, -0.04],
  callosum: [0.5, 0.22, 0.02],
  cerebellum: [0.15, -0.46, -0.78],
  brainstem: [0.2, -0.78, -0.08]
};
const FAR_SIDE = { back: 0.9, up: 0.12 };

const COLORS = {
  cortex: [0.9, 0.7, 0.67],
  sulcus: [0.42, 0.16, 0.2],
  grey: [0.6, 0.46, 0.47],
  white: [0.86, 0.8, 0.75],
  cerebellum: [0.84, 0.6, 0.6],
  stem: [0.9, 0.78, 0.72],
  callosum: [0.93, 0.88, 0.83],
  hippocampus: [0.9, 0.72, 0.68]
};

const GAP = 0.013;
const RES = 128;
const SCALE = 1.06; // grid -1..1 → world
const OFFSET_Y = -0.1;

/*
 * Builds every piece. Yields to the browser between pieces so the page stays responsive.
 * Returns [{ id, side, mesh geometry, centroid, explode }].
 */
export async function buildBrain(THREE, MarchingCubes, onProgress) {
  const mc = new MarchingCubes(RES, new THREE.MeshBasicMaterial(), false, false, 140000);
  mc.isolation = 0;
  const N = RES, half = N / 2;
  const coord = (i) => ((i - half) / half) * SCALE;
  const field = mc.field;

  // The folded cortex is shared by every lobe, so compute it once.
  const cortex = new Float32Array(N * N * N);
  for (let k = 0; k < N; k++) {
    const z = coord(k);
    for (let j = 0; j < N; j++) {
      const y = coord(j) + OFFSET_Y;
      for (let i = 0; i < N; i++) {
        const x = coord(i);
        const base = cortexBase(x, y, z);
        cortex[i + j * N + k * N * N] = base > 0.06 || base < -0.08 ? base : base + FOLD_DEPTH * groove(x, y, z);
      }
    }
    if (k % 16 === 15) await nextFrame();
  }

  const jobs = [];
  for (const side of [-1, 1]) {
    for (const lobe of Object.keys(REGIONS)) {
      jobs.push({ id: lobe, side, kind: 'cortex', sdf: (x, y, z, idx) => Math.max(cortex[idx], REGIONS[lobe](y, z) + GAP, -side * x) });
    }
    jobs.push({ id: 'hippocampus', side, kind: 'hippocampus', sdf: (x, y, z) => hippocampus(x, y, z, side) });
  }
  jobs.push({ id: 'callosum', side: 0, kind: 'callosum', sdf: corpusCallosum });
  jobs.push({ id: 'cerebellum', side: 0, kind: 'cerebellum', sdf: (x, y, z) => { const d = cerebellum(x, y, z); return d > 0.05 ? d : d + 0.018 * cerebellumFolds(x, y, z); } });
  jobs.push({ id: 'brainstem', side: 0, kind: 'stem', sdf: brainstem });

  const pieces = [];
  for (let n = 0; n < jobs.length; n++) {
    const job = jobs[n];
    mc.reset(); // clears the normal cache from the previous piece
    for (let k = 0; k < N; k++) {
      const z = coord(k);
      for (let j = 0; j < N; j++) {
        const y = coord(j) + OFFSET_Y;
        const row = j * N + k * N * N;
        for (let i = 0; i < N; i++) field[row + i] = -job.sdf(coord(i), y, z, row + i) * 40;
      }
    }
    mc.update();
    pieces.push(toPiece(THREE, mc, job));
    if (onProgress) onProgress((n + 1) / jobs.length);
    await nextFrame();
  }
  mc.geometry.dispose();
  return pieces;
}

function toPiece(THREE, mc, job) {
  const count = mc.count;
  const pos = new Float32Array(count * 3);
  const nor = mc.normalArray.slice(0, count * 3);
  for (let v = 0; v < count * 3; v += 3) {
    const len = Math.hypot(nor[v], nor[v + 1], nor[v + 2]) || 1;
    nor[v] /= len; nor[v + 1] /= len; nor[v + 2] /= len;
  }
  const col = new Float32Array(count * 3);
  const surf = new Float32Array(count);
  let cx = 0, cy = 0, cz = 0;
  for (let v = 0; v < count; v++) {
    const x = mc.positionArray[v * 3] * SCALE;
    const y = mc.positionArray[v * 3 + 1] * SCALE + OFFSET_Y;
    const z = mc.positionArray[v * 3 + 2] * SCALE;
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    cx += x; cy += y; cz += z;
    const c = vertexColor(job.kind, x, y, z);
    col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
    surf[v] = c[3];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('brainPos', new THREE.BufferAttribute(pos.slice(), 3)); // before centering
  geometry.setAttribute('surf', new THREE.BufferAttribute(surf, 1));
  const centroid = count ? [cx / count, cy / count, cz / count] : [0, 0, 0];
  // Center each piece on its own middle so it can turn in place while flying apart.
  geometry.translate(-centroid[0], -centroid[1], -centroid[2]);
  const e = EXPLODE[job.id];
  const explode = job.side === -1 ? [-(e[0] + FAR_SIDE.back), e[1] + FAR_SIDE.up, e[2] * 1.05] : [e[0], e[1], e[2]];
  const folds = job.kind === 'cortex' ? 0 : job.kind === 'cerebellum' ? 1 : 2;
  return { id: job.id, side: job.side, geometry, centroid, explode, folds };
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Returns [r, g, b, surf]; surf is 1 on the outer surface (where the shader draws folds), 0 on cut faces.
function vertexColor(kind, x, y, z) {
  const tint = 0.93 + 0.1 * noise3(x * 2.3, y * 2.3, z * 2.3); // blotchy, like real tissue
  let c;
  let surf = 1;
  if (kind === 'cortex') {
    const folded = -(cortexBase(x, y, z) + FOLD_DEPTH * groove(x, y, z)); // depth below the folded surface
    // Soft hand-over between the folded surface and a cut face, so edges don't crumble.
    surf = 1 - smoothstep(0.004, 0.022, folded);
    if (folded > 0.012) {
      // Cut face: a grey-matter ribbon that traces the folds, white matter inside.
      // The ribbon's inner edge wiggles with the folds, as in a real brain slice.
      const edge = 0.055 + 0.025 * foldS(x, y, z);
      c = mix(COLORS.grey, COLORS.white, smoothstep(edge - 0.012, edge + 0.012, folded));
    } else {
      c = COLORS.cortex;
    }
  } else if (kind === 'cerebellum') {
    c = COLORS.cerebellum;
  } else if (kind === 'stem') {
    c = COLORS.stem;
  } else if (kind === 'callosum') {
    c = COLORS.callosum;
  } else {
    c = COLORS.hippocampus;
  }
  return [c[0] * tint, c[1] * tint, c[2] * tint, surf];
}

const nextFrame = () => new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));
