/*
 * The fold pattern, in JavaScript (for the mesh) and GLSL (for the per-pixel detail).
 * Both use the same simplex noise (Ashima Arts / Stefan Gustavson, MIT), so the broad folds
 * in the geometry and the fine folds drawn by the shader line up.
 *
 * foldS: warped stripes, a sine wave bent by noise about as strongly as the stripes themselves,
 *   which gives the long, maze-like ridges of real gyri. Ridges run up-down above the lateral fissure and front-back on the temporal lobe.
 * foliaS: the cerebellum's fine, nearly parallel folds.
 * Both return a value from -1 to 1; a sulcus (groove) is where the value is near 1.
 */

const mod289 = (x) => x - Math.floor(x / 289) * 289;
const permute = (x) => mod289((x * 34 + 1) * x);
const NS_X = 2 / 7, NS_Y = 0.5 / 7 - 1, NS_Z = 1 / 7;

export function snoise(vx, vy, vz) {
  const s = (vx + vy + vz) / 3;
  let ix = Math.floor(vx + s), iy = Math.floor(vy + s), iz = Math.floor(vz + s);
  const t = (ix + iy + iz) / 6;
  const x0 = [vx - ix + t, vy - iy + t, vz - iz + t];
  const gx = x0[0] >= x0[1] ? 1 : 0, gy = x0[1] >= x0[2] ? 1 : 0, gz = x0[2] >= x0[0] ? 1 : 0;
  const lx = 1 - gx, ly = 1 - gy, lz = 1 - gz;
  const i1 = [Math.min(gx, lz), Math.min(gy, lx), Math.min(gz, ly)];
  const i2 = [Math.max(gx, lz), Math.max(gy, lx), Math.max(gz, ly)];
  const corners = [
    x0,
    [x0[0] - i1[0] + 1 / 6, x0[1] - i1[1] + 1 / 6, x0[2] - i1[2] + 1 / 6],
    [x0[0] - i2[0] + 1 / 3, x0[1] - i2[1] + 1 / 3, x0[2] - i2[2] + 1 / 3],
    [x0[0] - 0.5, x0[1] - 0.5, x0[2] - 0.5]
  ];
  const offsets = [[0, 0, 0], i1, i2, [1, 1, 1]];
  ix = mod289(ix); iy = mod289(iy); iz = mod289(iz);
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const o = offsets[k], c = corners[k];
    const p = permute(permute(permute(iz + o[2]) + iy + o[1]) + ix + o[0]);
    const j = p - 49 * Math.floor(p * NS_Z * NS_Z);
    const xf = Math.floor(j * NS_Z);
    const yf = Math.floor(j - 7 * xf);
    const x = xf * NS_X + NS_Y;
    const y = yf * NS_X + NS_Y;
    const h = 1 - Math.abs(x) - Math.abs(y);
    const sh = h <= 0 ? -1 : 0;
    let gxk = x + (Math.floor(x) * 2 + 1) * sh;
    let gyk = y + (Math.floor(y) * 2 + 1) * sh;
    let gzk = h;
    const norm = 1.79284291400159 - 0.85373472095314 * (gxk * gxk + gyk * gyk + gzk * gzk);
    gxk *= norm; gyk *= norm; gzk *= norm;
    let m = Math.max(0.6 - (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]), 0);
    m *= m;
    sum += m * m * (gxk * c[0] + gyk * c[1] + gzk * c[2]);
  }
  return 42 * sum;
}

const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export function foldS(x, y, z) {
  const above = smoothstep(-0.08, 0.08, (y + 0.1 + 0.28 * z) / 1.038);
  const qx = x + 0.11 * snoise(x * 1.7, y * 1.7, z * 1.7);
  const qy = y + 0.11 * snoise(x * 1.7 + 5.2, y * 1.7 + 1.3, z * 1.7);
  const qz = z + 0.11 * snoise(x * 1.7, y * 1.7 + 9.1, z * 1.7 + 2.7);
  const dirA = qz + 0.22 * qy;
  const dirT = qy - 0.18 * qz;
  const phase = (dirT + (dirA - dirT) * above) * 72 + 7.0 * snoise(qx * 4.6, qy * 4.6, qz * 4.6) + 2.4 * snoise(qx * 10 + 3, qy * 10 + 3, qz * 10 + 3);
  return Math.sin(phase);
}

export function foliaS(x, y, z) {
  const zz = z + 0.56;
  return Math.sin((y + 0.18 * zz * zz) * 150 + 1.3 * snoise(x * 3, y * 3, z * 3));
}

// Same functions for the GPU.
export const FOLDS_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
vec3 foldWarp(vec3 p) {
  return p + 0.11 * vec3(snoise(p * 1.7), snoise(p * 1.7 + vec3(5.2, 1.3, 0.0)), snoise(p * 1.7 + vec3(0.0, 9.1, 2.7)));
}
// Split so the shader can reuse the (slowly changing) warp for nearby samples.
float foldFromWarp(vec3 p, vec3 q) {
  float above = smoothstep(-0.08, 0.08, (p.y + 0.1 + 0.28 * p.z) / 1.038);
  float dirA = q.z + 0.22 * q.y;
  float dirT = q.y - 0.18 * q.z;
  float phase = mix(dirT, dirA, above) * 72.0 + 7.0 * snoise(q * 4.6) + 2.4 * snoise(q * 10.0 + 3.0);
  return sin(phase);
}
float foldS(vec3 p) { return foldFromWarp(p, foldWarp(p)); }
float foliaS(vec3 p) {
  float zz = p.z + 0.56;
  return sin((p.y + 0.18 * zz * zz) * 150.0 + 1.3 * snoise(p * 3.0));
}
`;
