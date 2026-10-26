/*
 * Turns the brain's distance field (shape.js) into a smooth triangle mesh with surface nets,
 * shades the grooves (ambient occlusion: how much of the sky each point can see), then cuts the
 * surface into jigsaw pieces, so each piece can fly on its own.
 * Runs in a worker (build-worker.js); plain arrays in, typed arrays out.
 *
 * Pieces: the brain is wrapped in a cube (each face a PUZZLE_N × PUZZLE_N grid) and every point
 * belongs to the grid cell it points toward. Here quads are only sorted roughly (into the cell and
 * its neighbours); the shader cuts the exact jigsaw outline, tabs and all (see intro.js).
 *
 * The same code also builds a single piece on its own, much finer, for when it comes up close:
 * pass the piece (only) and the box around it (box: [min, max]).
 */
import { field, BOUNDS } from './shape.js';

export const PUZZLE_N = 12;
// Stretch the brain to a rounder shape before choosing cells, so pieces come out about the same size.
export const PUZZLE_SCALE = [1 / 0.74, 1 / 0.78, 1];
export const PUZZLE_SHIFT_Y = 0.1;

// Which cube face and grid cell a point points toward: [face, column, row, fraction across, fraction up].
export function puzzleCell(x, y, z) {
  x *= PUZZLE_SCALE[0]; y = (y + PUZZLE_SHIFT_Y) * PUZZLE_SCALE[1];
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face, u, v;
  if (ax >= ay && ax >= az) { face = x > 0 ? 0 : 1; u = (x > 0 ? -z : z) / ax; v = y / ax; }
  else if (ay >= az) { face = y > 0 ? 2 : 3; u = x / ay; v = (y > 0 ? -z : z) / ay; }
  else { face = z > 0 ? 4 : 5; u = (z > 0 ? x : -x) / az; v = y / az; }
  const s = Math.min(PUZZLE_N - 1e-4, Math.max(0, (u + 1) * 0.5 * PUZZLE_N));
  const t = Math.min(PUZZLE_N - 1e-4, Math.max(0, (v + 1) * 0.5 * PUZZLE_N));
  const i = Math.floor(s), j = Math.floor(t);
  return [face, i, j, s - i, t - j];
}
const pieceId = (face, i, j) => face * PUZZLE_N * PUZZLE_N + j * PUZZLE_N + i;

export function buildBrainMesh({ step = 0.017, box = null, only = -1 } = {}) {
  const [min, max] = box || [BOUNDS.min, BOUNDS.max];
  const nx = Math.ceil((max[0] - min[0]) / step) + 1;
  const ny = Math.ceil((max[1] - min[1]) / step) + 1;
  const nz = Math.ceil((max[2] - min[2]) / step) + 1;
  const at = (i, j, k) => i + nx * (j + ny * k);

  // 1. Sample the field on a grid. A coarse pass first (every 4th point); the full field is only
  //    worked out near the surface, and elsewhere the coarse values are blended, which is all the
  //    grooves' shading needs out there. About half the time, with the same surface.
  const C = 4, BAND = 0.1;
  const cx = Math.ceil((nx - 1) / C) + 1, cy = Math.ceil((ny - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1;
  const G = new Float32Array(cx * cy * cz);
  const cat = (i, j, k) => i + cx * (j + cy * k);
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) G[cat(i, j, k)] = field(min[0] + i * C * step, min[1] + j * C * step, min[2] + k * C * step);
    }
  }
  const F = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * step, k0 = Math.min(Math.floor(k / C), cz - 2), tz = k / C - k0;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * step, j0 = Math.min(Math.floor(j / C), cy - 2), ty = j / C - j0;
      for (let i = 0; i < nx; i++) {
        const i0 = Math.min(Math.floor(i / C), cx - 2), tx = i / C - i0;
        const a = G[cat(i0, j0, k0)], b = G[cat(i0 + 1, j0, k0)], c = G[cat(i0, j0 + 1, k0)], d = G[cat(i0 + 1, j0 + 1, k0)];
        const e = G[cat(i0, j0, k0 + 1)], f = G[cat(i0 + 1, j0, k0 + 1)], g = G[cat(i0, j0 + 1, k0 + 1)], h = G[cat(i0 + 1, j0 + 1, k0 + 1)];
        const near = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
        const far = (e + (f - e) * tx) * (1 - ty) + (g + (h - g) * tx) * ty;
        const rough = near + (far - near) * tz;
        F[at(i, j, k)] = Math.abs(rough) < BAND ? field(min[0] + i * step, y, z) : rough;
      }
    }
  }

  // The field anywhere inside the grid, smoothly (trilinear); outside it, "empty" for the whole
  // brain, or worked out exactly for a single piece (its box is small, and the shading looks past it).
  function sample(x, y, z) {
    const fx = (x - min[0]) / step, fy = (y - min[1]) / step, fz = (z - min[2]) / step;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return box ? field(x, y, z) : 1;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    const tx = fx - i, ty = fy - j, tz = fz - k;
    const c00 = F[at(i, j, k)] * (1 - tx) + F[at(i + 1, j, k)] * tx;
    const c10 = F[at(i, j + 1, k)] * (1 - tx) + F[at(i + 1, j + 1, k)] * tx;
    const c01 = F[at(i, j, k + 1)] * (1 - tx) + F[at(i + 1, j, k + 1)] * tx;
    const c11 = F[at(i, j + 1, k + 1)] * (1 - tx) + F[at(i + 1, j + 1, k + 1)] * tx;
    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  }

  // 2. One vertex per cell the surface passes through, at the average of its edge crossings.
  const cellAt = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos = [];
  const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          v[c] = F[at(i + CORNERS[c][0], j + CORNERS[c][1], k + CORNERS[c][2])];
          if (v[c] < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          if ((v[a] < 0) === (v[b] < 0)) continue;
          const t = v[a] / (v[a] - v[b]);
          const A = CORNERS[a], B = CORNERS[b];
          sx += A[0] + (B[0] - A[0]) * t; sy += A[1] + (B[1] - A[1]) * t; sz += A[2] + (B[2] - A[2]) * t;
          n++;
        }
        cellVert[cellAt(i, j, k)] = pos.length / 3;
        pos.push(min[0] + (i + sx / n) * step, min[1] + (j + sy / n) * step, min[2] + (k + sz / n) * step);
      }
    }
  }

  // 3. A quad for every grid edge the surface crosses, joining the four cells around it.
  const quads = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) quads.push(a, d, c, b); else quads.push(a, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const inside = F[at(i, j, k)] < 0;
        if (inside !== (F[at(i + 1, j, k)] < 0)) quad(cellVert[cellAt(i, j - 1, k - 1)], cellVert[cellAt(i, j, k - 1)], cellVert[cellAt(i, j, k)], cellVert[cellAt(i, j - 1, k)], !inside);
        if (inside !== (F[at(i, j + 1, k)] < 0)) quad(cellVert[cellAt(i - 1, j, k - 1)], cellVert[cellAt(i - 1, j, k)], cellVert[cellAt(i, j, k)], cellVert[cellAt(i, j, k - 1)], !inside);
        if (inside !== (F[at(i, j, k + 1)] < 0)) quad(cellVert[cellAt(i - 1, j - 1, k)], cellVert[cellAt(i, j - 1, k)], cellVert[cellAt(i, j, k)], cellVert[cellAt(i - 1, j, k)], !inside);
      }
    }
  }

  // 4. Smooth normals from the field's slope (read from the grid, so no extra field samples).
  const vcount = pos.length / 3;
  const nor = new Float32Array(vcount * 3);
  const e = step * 0.75;
  for (let p = 0; p < vcount; p++) {
    const x = pos[p * 3], y = pos[p * 3 + 1], z = pos[p * 3 + 2];
    const gx = sample(x + e, y, z) - sample(x - e, y, z);
    const gy = sample(x, y + e, z) - sample(x, y - e, z);
    const gz = sample(x, y, z + e) - sample(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    nor[p * 3] = gx / l; nor[p * 3 + 1] = gy / l; nor[p * 3 + 2] = gz / l;
  }

  // 5. Ambient occlusion: look out from each point in a cone of directions and count how much of
  //    what it sees is brain. Deep in a sulcus the walls close in, so it comes out dark; on the
  //    crown of a gyrus, light.
  const ao = new Float32Array(vcount);
  const REACH = [0.018, 0.04, 0.07, 0.11, 0.16];
  const CONE = [[0, 0], [0.55, 0], [0.55, 2.1], [0.55, 4.2], [1.0, 1.05], [1.0, 3.15], [1.0, 5.25]]; // [tilt, turn]
  for (let p = 0; p < vcount; p++) {
    const x = pos[p * 3], y = pos[p * 3 + 1], z = pos[p * 3 + 2];
    const n0 = nor[p * 3], n1 = nor[p * 3 + 1], n2 = nor[p * 3 + 2];
    // Two directions across the surface, to tilt the normal into a cone.
    let t0 = -n1, t1 = n0, t2 = 0;
    if (Math.abs(n2) > 0.9) { t0 = 0; t1 = -n2; t2 = n1; }
    let l = Math.hypot(t0, t1, t2); t0 /= l; t1 /= l; t2 /= l;
    const b0 = n1 * t2 - n2 * t1, b1 = n2 * t0 - n0 * t2, b2 = n0 * t1 - n1 * t0;
    let seen = 0, total = 0;
    for (const [tilt, turn] of CONE) {
      const ct = Math.cos(tilt), st = Math.sin(tilt), cu = Math.cos(turn), su = Math.sin(turn);
      const d0 = n0 * ct + (t0 * cu + b0 * su) * st, d1 = n1 * ct + (t1 * cu + b1 * su) * st, d2 = n2 * ct + (t2 * cu + b2 * su) * st;
      const weight = ct;
      for (const h of REACH) {
        const f = sample(x + d0 * h, y + d1 * h, z + d2 * h);
        seen += weight * clamp01(0.5 - f / (0.6 * h)); // 1 = inside the brain, 0 = clear
        total += weight;
      }
    }
    ao[p] = clamp01(1 - 1.9 * seen / total);
  }

  // 6. Pieces. A quad goes into the cell each of its corners (and its middle) points toward, plus
  //    the neighbouring cell when it's near an edge, where a tab may reach across. The shader keeps
  //    only the part of each copy that is really inside that piece.
  const shards = 6 * PUZZLE_N * PUZZLE_N;
  const reach = 0.36; // a tab reaches 0.32 of a piece across an edge (see the shader)
  const add = (set, x, y, z) => {
    const [face, i, j, fs, ft] = puzzleCell(x, y, z);
    set.add(pieceId(face, i, j));
    if (fs < reach && i > 0) set.add(pieceId(face, i - 1, j));
    if (fs > 1 - reach && i < PUZZLE_N - 1) set.add(pieceId(face, i + 1, j));
    if (ft < reach && j > 0) set.add(pieceId(face, i, j - 1));
    if (ft > 1 - reach && j < PUZZLE_N - 1) set.add(pieceId(face, i, j + 1));
  };
  const quadCount = quads.length / 4;
  const quadShards = [];
  for (let q = 0; q < quadCount; q++) {
    const set = new Set();
    let x = 0, y = 0, z = 0;
    for (let c = 0; c < 4; c++) { const p = quads[q * 4 + c] * 3; add(set, pos[p], pos[p + 1], pos[p + 2]); x += pos[p]; y += pos[p + 1]; z += pos[p + 2]; }
    add(set, x / 4, y / 4, z / 4);
    quadShards.push(only < 0 ? [...set] : set.has(only) ? [only] : []);
  }

  // 7. Final buffers: vertices are shared within a shard and duplicated where shards meet.
  const remap = new Map();
  const outPos = [], outNor = [], outAo = [], outShard = [], index = [];
  const vertFor = (p, s) => {
    const key = p * 1024 + s;
    let id = remap.get(key);
    if (id === undefined) {
      id = outShard.length;
      remap.set(key, id);
      outPos.push(pos[p * 3], pos[p * 3 + 1], pos[p * 3 + 2]);
      outNor.push(nor[p * 3], nor[p * 3 + 1], nor[p * 3 + 2]);
      outAo.push(ao[p]);
      outShard.push(s);
    }
    return id;
  };
  for (let q = 0; q < quadCount; q++) {
    for (const s of quadShards[q]) {
      const a = vertFor(quads[q * 4], s), b = vertFor(quads[q * 4 + 1], s), c = vertFor(quads[q * 4 + 2], s), d = vertFor(quads[q * 4 + 3], s);
      index.push(a, b, c, a, c, d);
    }
  }

  // Per shard: centre and outward direction.
  const centre = new Float32Array(shards * 3), out = new Float32Array(shards * 3), count = new Uint32Array(shards);
  for (let p = 0; p < outShard.length; p++) {
    const s = outShard[p];
    for (let c = 0; c < 3; c++) { centre[s * 3 + c] += outPos[p * 3 + c]; out[s * 3 + c] += outNor[p * 3 + c]; }
    count[s]++;
  }
  for (let s = 0; s < shards; s++) {
    const n = count[s] || 1;
    for (let c = 0; c < 3; c++) centre[s * 3 + c] /= n;
    const l = Math.hypot(out[s * 3], out[s * 3 + 1], out[s * 3 + 2]) || 1;
    for (let c = 0; c < 3; c++) out[s * 3 + c] /= l;
  }

  return {
    position: new Float32Array(outPos),
    normal: new Float32Array(outNor),
    ao: new Float32Array(outAo),
    shard: new Float32Array(outShard),
    index: outShard.length > 65535 ? new Uint32Array(index) : new Uint16Array(index),
    centre, out, shards
  };
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
