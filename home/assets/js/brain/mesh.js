/*
 * Turns the brain's distance field (shape.js) into a smooth triangle mesh with surface nets,
 * then cuts the surface into jigsaw pieces, so each piece can fly apart on its own.
 * Runs in a worker (build-worker.js); plain arrays in, typed arrays out.
 *
 * Pieces: the brain is wrapped in a cube (each face a PUZZLE_N × PUZZLE_N grid) and every point
 * belongs to the grid cell it points toward. Here quads are only sorted roughly (into the cell and
 * its neighbours); the shader cuts the exact jigsaw outline, tabs and all (see intro.js).
 */
import { field, BOUNDS } from './shape.js';

export const PUZZLE_N = 6;

// Which cube face and grid cell a point points toward: [face, column, row, fraction across, fraction up].
export function puzzleCell(x, y, z) {
  x /= 0.72; y = (y + 0.08) / 0.8; // stretch to a rounder shape, so pieces come out about the same size
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

export function buildBrainMesh({ step = 0.021 } = {}) {
  let shards;
  const { min, max } = BOUNDS;
  const nx = Math.ceil((max[0] - min[0]) / step) + 1;
  const ny = Math.ceil((max[1] - min[1]) / step) + 1;
  const nz = Math.ceil((max[2] - min[2]) / step) + 1;
  const at = (i, j, k) => i + nx * (j + ny * k);

  // 1. Sample the field on a grid.
  const F = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * step;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * step;
      for (let i = 0; i < nx; i++) F[at(i, j, k)] = field(min[0] + i * step, y, z);
    }
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

  // 4. Smooth normals from the field's slope.
  const vcount = pos.length / 3;
  const nor = new Float32Array(vcount * 3);
  const e = step * 0.5;
  for (let p = 0; p < vcount; p++) {
    const x = pos[p * 3], y = pos[p * 3 + 1], z = pos[p * 3 + 2];
    const gx = field(x + e, y, z) - field(x - e, y, z);
    const gy = field(x, y + e, z) - field(x, y - e, z);
    const gz = field(x, y, z + e) - field(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    nor[p * 3] = gx / l; nor[p * 3 + 1] = gy / l; nor[p * 3 + 2] = gz / l;
  }

  // 5. Pieces. A quad goes into the cell each of its corners (and its middle) points toward, plus
  //    the neighbouring cell when it's near an edge, where a tab may reach across. The shader keeps
  //    only the part of each copy that is really inside that piece.
  shards = 6 * PUZZLE_N * PUZZLE_N;
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
    quadShards.push([...set]);
  }

  // 6. Final buffers: vertices are shared within a shard and duplicated where shards meet.
  const remap = new Map();
  const outPos = [], outNor = [], outShard = [], index = [];
  const vertFor = (p, s) => {
    const key = p * 1024 + s;
    let id = remap.get(key);
    if (id === undefined) {
      id = outShard.length;
      remap.set(key, id);
      outPos.push(pos[p * 3], pos[p * 3 + 1], pos[p * 3 + 2]);
      outNor.push(nor[p * 3], nor[p * 3 + 1], nor[p * 3 + 2]);
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
    shard: new Float32Array(outShard),
    index: outShard.length > 65535 ? new Uint32Array(index) : new Uint16Array(index),
    centre, out, shards
  };
}
