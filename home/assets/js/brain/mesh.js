/*
 * Turns the brain's distance field (shape.js) into a smooth triangle mesh with surface nets,
 * then cuts the surface into triangular shards, so each shard can
 * fly apart on its own. Runs in a worker (build-worker.js); plain arrays in, typed arrays out.
 */
import { field, BOUNDS } from './shape.js';

// Centres of the faces of an icosahedron split `levels` times (20 · 4^levels faces), as unit vectors.
function geodesicFaceCentres(levels) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let tris = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  verts = verts.map(unit);
  for (let level = 0; level < levels; level++) {
    const mid = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? a + ',' + b : b + ',' + a;
      if (!mid.has(key)) { mid.set(key, verts.length); verts.push(unit(verts[a].map((c, i) => c + verts[b][i]))); }
      return mid.get(key);
    };
    tris = tris.flatMap(([a, b, c]) => { const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  }
  const centres = new Float32Array(tris.length * 3);
  tris.forEach(([a, b, c], f) => centres.set(unit([0, 1, 2].map((i) => verts[a][i] + verts[b][i] + verts[c][i])), f * 3));
  // The three faces sharing an edge with each face.
  const byEdge = new Map();
  tris.forEach(([a, b, c], f) => [[a, b], [b, c], [c, a]].forEach(([p, q]) => {
    const key = p < q ? p + ',' + q : q + ',' + p;
    (byEdge.get(key) || byEdge.set(key, []).get(key)).push(f);
  }));
  const neighbours = new Uint16Array(tris.length * 3);
  tris.forEach(([a, b, c], f) => [[a, b], [b, c], [c, a]].forEach(([p, q], e) => {
    const key = p < q ? p + ',' + q : q + ',' + p;
    neighbours[f * 3 + e] = byEdge.get(key).find((g) => g !== f);
  }));
  return { centres, neighbours };
}

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

  // 5. Shards: triangular wedges. A point belongs to the face of a geodesic sphere (around the
  //    brain's middle) that it points toward. Quads that straddle a cut go into every shard they
  //    touch; the shader trims each copy to its own straight-edged triangle.
  const { centres: faces, neighbours } = geodesicFaceCentres(2);
  shards = faces.length / 3;
  const faceOf = (x, y, z) => {
    x /= 0.72; y = (y + 0.08) / 0.8; // stretch to a rounder shape, so the wedges are about the same size
    let best = 0, bestDot = -Infinity;
    for (let f = 0; f < shards; f++) {
      const d = x * faces[f * 3] + y * faces[f * 3 + 1] + z * faces[f * 3 + 2];
      if (d > bestDot) { bestDot = d; best = f; }
    }
    return best;
  };
  const vertFace = new Uint16Array(vcount);
  for (let p = 0; p < vcount; p++) vertFace[p] = faceOf(pos[p * 3], pos[p * 3 + 1], pos[p * 3 + 2]);
  const quadCount = quads.length / 4;
  const quadShards = [];
  for (let q = 0; q < quadCount; q++) {
    const set = new Set();
    let x = 0, y = 0, z = 0;
    for (let c = 0; c < 4; c++) { const p = quads[q * 4 + c]; set.add(vertFace[p]); x += pos[p * 3]; y += pos[p * 3 + 1]; z += pos[p * 3 + 2]; }
    set.add(faceOf(x / 4, y / 4, z / 4));
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
    centre, out, shards, faces, neighbours
  };
}
