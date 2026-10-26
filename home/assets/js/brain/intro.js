/*
 * Home page brain: a soft, glossy brain made of small jigsaw pieces.
 * Scroll story ("your way back"): the page opens on one solid plum wall behind the headline. The
 * first scroll shows its seams: it is a jigsaw. From the bottom of the screen up, the pieces lift
 * off and drift back to float around where the brain will be, and as you read down the page they
 * click into place, a few more with every section, until the brain is whole at the bottom. It only
 * ever comes together, never bursts apart, which would be a heavy image for people living with
 * "chemo brain". Once a piece is in place its seam fades away, so the finished brain reads as one.
 * In each section with a quote, one piece comes forward and turns to face you with a short line
 * about that section on it (the section's data-quote), then goes back.
 * With reduced motion there is no wall: the brain is shown whole and still, with no quotes.
 * The mesh is built in a worker (build-worker.js), a rough one first so the brain shows at once,
 * and all piece motion runs on the GPU, so the page only updates a few numbers per frame.
 */
import * as THREE from 'three';
import { PUZZLE_N, PUZZLE_SCALE, PUZZLE_SHIFT_Y, puzzleCell, EDGE_HASH_GLSL } from './mesh.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.querySelector('#brain');
const vignette = document.querySelector('.vignette');
if (window.__brainFallen) throw new Error('No 3D on this device.');

// Chromebooks and older phones: a lighter brain, no antialiasing, normal resolution.
const lowPower = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || matchMedia('(max-width: 700px)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
} catch (error) {
  window.brainFallback && window.brainFallback();
  throw error;
}
window.__brainStarted = true;

let pixelRatio = lowPower ? 1 : Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#070609');
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);

// Everything that moves with the brain (it sits right of the text on wide screens).
const stage = new THREE.Group();
scene.add(stage);

/* ---------- soft studio light ---------- */

scene.add(new THREE.HemisphereLight('#ffe9e2', '#2a1418', 0.7));
const key = new THREE.DirectionalLight('#fff4ee', 2.6);
key.position.set(-2, 3, 3);
const fill = new THREE.DirectionalLight('#ffd6cc', 0.7);
fill.position.set(3, 0.5, 2);
const rim = new THREE.DirectionalLight('#9fb6ff', 1.5);
rim.position.set(1, 1.5, -3.5);
scene.add(key, fill, rim);

// Soft reflections: a few glowing panels around the brain, like a photo studio, blurred into an
// environment map. They give the surface its wet, glossy look.
function studio() {
  const room = new THREE.Scene();
  room.background = new THREE.Color('#120c0e');
  const panel = (w, h, color, strength, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide }));
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };
  panel(4, 3, '#fff1ea', 5, -3, 4, 4);   // the main softbox, above left
  panel(3, 4, '#ffd2c2', 1.6, 5, 0.5, 2); // warm fill on the right
  panel(5, 1.2, '#b8c8ff', 2.2, 1, 2, -5); // cool strip behind
  panel(8, 8, '#3a2224', 0.6, 0, -5, 0);   // dim floor bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const map = pmrem.fromScene(room, 0.03).texture;
  pmrem.dispose();
  return map;
}
scene.environment = studio();

/* ---------- geometric backdrop: a faint geodesic shell and drifting points ---------- */

const shell = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.75, 1)),
  new THREE.LineBasicMaterial({ color: '#e7a782', transparent: true, opacity: 0, depthWrite: false })
);
stage.add(shell);
const ring = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(2.6, 0)),
  new THREE.LineBasicMaterial({ color: '#8fa6c8', transparent: true, opacity: 0, depthWrite: false })
);
stage.add(ring);

const DUST = 260;
const dustPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) {
  const r = 1.6 + Math.random() * 2.6, a = Math.random() * Math.PI * 2, y = (Math.random() - 0.5) * 4;
  dustPos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uOpacity: { value: 0 }, uSize: { value: 22 } },
  vertexShader: `uniform float uSize;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = uSize / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `uniform float uOpacity;
    void main(){
      float d = length(gl_PointCoord - 0.5);
      gl_FragColor = vec4(1.0, 0.86, 0.78, smoothstep(0.5, 0.1, d) * uOpacity);
    }`
}));
stage.add(dust);

/* ---------- the brain ---------- */

const SPREAD = 1.1; // how staggered the pieces are, in units of the whole assembly
const WALL_DISTANCE = 3; // how far in front of the camera the opening wall stands
// The wall is painted with a twilight nebula, drawn once into a texture each time the window
// changes size and shared by the flat sheet and the 3D pieces, so a piece keeps its patch of sky
// as it lets go. The wall is drawn unlit, straight to the screen, so these are plain sRGB values.
const NEBULA_GLSL = `
// A soft twilight nebula: deep navy above, violet and lavender light breaking through low on
// the right in soft rays, pink and lotus-pink cloud edges, dark teal wisps on the left.
// p is the point on screen: about -1..1 up the screen, and wider across.
float nHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float nNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(nHash(i), nHash(i + vec2(1.0, 0.0)), u.x), mix(nHash(i + vec2(0.0, 1.0)), nHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float nFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * nNoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return v;
}
vec3 nebula(vec2 p, float aspect) {
  vec2 q = vec2(nFbm(p * 1.1), nFbm(p * 1.1 + vec2(5.2, 1.3)));
  float cloud = nFbm(p * vec2(1.4, 2.4) + 2.4 * q);       // wide, flat banks of cloud
  float wisp = nFbm(p * vec2(2.2, 4.0) - 1.6 * q + 7.0);   // finer streaks inside them
  vec3 navy = vec3(0.06, 0.05, 0.17), indigo = vec3(0.20, 0.14, 0.40), violet = vec3(0.38, 0.28, 0.66);
  vec3 lavender = vec3(0.82, 0.74, 0.94), orchid = vec3(0.74, 0.40, 0.64), lotus = vec3(0.91, 0.55, 0.66);
  vec3 teal = vec3(0.05, 0.36, 0.37), pine = vec3(0.04, 0.15, 0.14);
  // The sky: navy at the top, deepening to violet toward the light.
  vec2 sun = vec2(min(0.85, aspect * 0.55), -0.55); // low on the right, still on screen on a phone
  vec2 g = p - sun;
  float near = exp(-dot(g, g) * 0.9);                       // how close to the light
  vec3 c = mix(navy, indigo, smoothstep(0.9, -0.6, p.y));
  c = mix(c, violet, near * 0.85);
  // Soft rays fanning out from the light.
  float ang = atan(g.y, g.x);
  float rays = 0.5 + 0.5 * sin(ang * 14.0 + 3.0 * nNoise(vec2(ang * 3.0, 1.0)));
  c += lavender * 0.10 * rays * near * smoothstep(-0.3, 0.6, g.y + 0.3) * smoothstep(0.08, 0.5, length(g));
  // Clouds catch the light: lavender where it's near, then orchid and lotus at their bright edges.
  float lit = cloud * (0.35 + near);
  c = mix(c, lavender * 0.8, smoothstep(0.45, 1.0, lit) * 0.7);
  c = mix(c, orchid, smoothstep(0.5, 0.85, wisp) * smoothstep(0.35, 0.8, lit) * 0.7);
  c = mix(c, lotus, smoothstep(0.62, 0.9, wisp * (0.4 + near)) * 0.45);
  // Dark teal and pine wisps drifting in from the left.
  float tealAmt = smoothstep(0.42, 0.75, cloud * 0.6 + wisp * 0.5) * smoothstep(0.7, -1.3, p.x);
  c = mix(c, mix(pine, teal, wisp), tealAmt * 0.75);
  // A few faint stars, where the sky is dark.
  vec2 sp = p * 70.0;
  float star = step(0.997, nHash(floor(sp))) * smoothstep(0.3, 0.0, length(fract(sp) - 0.5));
  c += vec3(0.95, 0.9, 1.0) * star * 0.6 * (1.0 - near) * (1.0 - cloud);
  // Darker behind the words on the left, so they stay easy to read.
  c *= mix(0.6, 1.0, smoothstep(-1.5, 0.25, p.x));
  return c;
}
`;
const skyTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
const skyPaint = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { uAspect: { value: 1 } },
  vertexShader: `varying vec2 vP; uniform float uAspect;
    void main() { vP = position.xy * vec2(uAspect, 1.0); gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `varying vec2 vP; uniform float uAspect;
    ${NEBULA_GLSL}
    void main() { gl_FragColor = vec4(nebula(vP, uAspect), 1.0); }`,
  depthTest: false, depthWrite: false
}));
const skyScene = new THREE.Scene();
skyScene.add(skyPaint);
skyPaint.frustumCulled = false;
const uniforms = {
  uAssemble: { value: 1 },
  uTime: { value: 0 },
  uShards: { value: null },
  uHero: { value: still ? 99 : 0 }, // how many screens down the page we are (the wall reads this)
  uSeams: { value: 0 }, // 0 → 1 on the first scroll: the wall's jigsaw seams show
  uWall: { value: new THREE.Vector4(0.1, WALL_DISTANCE, 36, 24) }, // tile size, distance, columns, rows
  uBlocks: { value: new THREE.Vector2(3, 2) }, // how the cube's six faces are laid out on the wall
  uView: { value: new THREE.Vector2(1, 1) }, // half the view's width and height at the wall
  uSky: { value: skyTarget.texture },
  // The piece that comes forward for the current section: its number, how far out it is (0 to 1),
  // where it goes (in front of the camera, in view space) and how much bigger it gets there.
  uFeature: { value: -1 },
  uFeatureT: { value: 0 },
  uFeatureDetail: { value: 0 }, // 1 = the featured piece is drawn by its own fine-detail copy
  uFeaturePos: { value: new THREE.Vector3(0, 0, -4) },
  uFeatureScale: { value: 4 },
  uSway: { value: new THREE.Vector2(0, 0) }, // how the piece in front is tilted (about the screen's x and y axes)
  uMaskOnly: { value: 0 }, // 1 = draw only the featured piece (to measure where its quote fits)
  // Where pieces fade into the background, in canvas pixels: right edge of the text column, the
  // top bar's lower edge (counted from the bottom), and the width of the soft edge.
  uFade: { value: new THREE.Vector3(-1e5, 1e5, 60) }
};
const brain = new THREE.Group();
stage.add(brain);
let ready = false;
let material = null, brainMesh = null;
let pieceSize = null; // per piece: how far its farthest point is from its centre
let pieceBox = null; // per piece: the box around it, [min x, y, z, max x, y, z]
let pieceCentre = null, pieceOut = null; // per piece: its middle and outward direction (from the mesh)
let detailMaterial = null;
let featured = []; // the clean pieces that can come forward: [right side, left side], best first

function seeded(n) { const x = Math.sin(n * 91.7) * 43758.5; return x - Math.floor(x); }

const PUZZLE_SPACE = `
  const float PN = ${PUZZLE_N.toFixed(1)};
  vec3 puzzleSpace(vec3 p) { return vec3(p.x * ${PUZZLE_SCALE[0].toFixed(5)}, (p.y + ${PUZZLE_SHIFT_Y.toFixed(3)}) * ${PUZZLE_SCALE[1].toFixed(5)}, p.z); }
`;

// Which jigsaw piece a point on the brain belongs to (must match pieceOnFace in mesh.js), and how
// far it is from the piece's outline. Each cube face is a PN × PN grid; every inner edge has one
// round tab, owned by the piece on one side (chosen by a hash), poking into the other.
// pieceOnFace does the same for a point already on a face's grid (st, 0..PN across and up).
const PUZZLE_GLSL = `
  ${EDGE_HASH_GLSL}
  float pieceOnFace(float face, vec2 st, out float seam);
  vec2 seamGrid; // where the last point was on its face's grid: smooth, so its fwidth sizes the seam lines
  float seamWidth(float base) { vec2 w = fwidth(seamGrid); return base + 1.5 * max(w.x, w.y); }
  float pieceAt(vec3 p, out float seam) {
    vec3 q = puzzleSpace(p);
    vec3 a = abs(q);
    float face; vec2 uv;
    if (a.x >= a.y && a.x >= a.z) { face = q.x > 0.0 ? 0.0 : 1.0; uv = vec2(q.x > 0.0 ? -q.z : q.z, q.y) / a.x; }
    else if (a.y >= a.z) { face = q.y > 0.0 ? 2.0 : 3.0; uv = vec2(q.x, q.y > 0.0 ? -q.z : q.z) / a.y; }
    else { face = q.z > 0.0 ? 4.0 : 5.0; uv = vec2(q.z > 0.0 ? q.x : -q.x, q.y) / a.z; }
    return pieceOnFace(face, (uv + 1.0) * 0.5 * PN, seam);
  }
  float pieceOnFace(float face, vec2 st, out float seam) {
    st = clamp(st, 0.0, PN - 1e-4);
    seamGrid = st;
    vec2 cell = floor(st), f = st - cell, piece = cell;
    const float R = 0.18, C = 0.14, NECK = 0.11; // tab radius, how far its centre sits past the edge, half its neck
    seam = 9.0;
    float tabSeam = -1.0; // inside a tab: how far in from the tab's round edge
    bool tab; float d;
    if (cell.x < PN - 1.0) { // right edge: tab owned by this piece (true) or the one on the right
      tab = edgeHash(face, cell.x + 1.0, cell.y) < 0.5;
      d = length(f - vec2(tab ? 1.0 + C : 1.0 - C, 0.5));
      if (!tab) { if (d < R) { piece.x += 1.0; tabSeam = R - d; } seam = min(seam, abs(d - R)); }
    }
    if (cell.x > 0.0) { // left edge: tab owned by the piece on the left (true) or this one
      tab = edgeHash(face, cell.x, cell.y) < 0.5;
      d = length(f - vec2(tab ? C : -C, 0.5));
      if (tab) { if (d < R) { piece.x -= 1.0; tabSeam = R - d; } seam = min(seam, abs(d - R)); }
    }
    if (cell.y < PN - 1.0) { // top edge
      tab = edgeHash(face + 10.0, cell.x, cell.y + 1.0) < 0.5;
      d = length(f - vec2(0.5, tab ? 1.0 + C : 1.0 - C));
      if (!tab) { if (d < R) { piece.y += 1.0; tabSeam = R - d; } seam = min(seam, abs(d - R)); }
    }
    if (cell.y > 0.0) { // bottom edge
      tab = edgeHash(face + 10.0, cell.x, cell.y) < 0.5;
      d = length(f - vec2(0.5, tab ? C : -C));
      if (tab) { if (d < R) { piece.y -= 1.0; tabSeam = R - d; } seam = min(seam, abs(d - R)); }
    }
    // Inside a tab, its round edge is the only outline (this cell's straight edges run through it).
    if (tabSeam >= 0.0) { seam = tabSeam; return face * PN * PN + piece.y * PN + piece.x; }
    // Straight parts of the outline, leaving a gap where each tab's neck crosses.
    if (abs(f.y - 0.5) > NECK || cell.x >= PN - 1.0) seam = min(seam, 1.0 - f.x);
    if (abs(f.y - 0.5) > NECK || cell.x <= 0.0) seam = min(seam, f.x);
    if (abs(f.x - 0.5) > NECK || cell.y >= PN - 1.0) seam = min(seam, 1.0 - f.y);
    if (abs(f.x - 0.5) > NECK || cell.y <= 0.0) seam = min(seam, f.y);
    return face * PN * PN + piece.y * PN + piece.x;
  }
`;

// Where a point of the brain sits on its own cube face's grid (0..PN across and up), even when
// the point itself leans a little toward a neighbouring face. Used to lay the pieces out flat.
const FACE_GLSL = `
  vec2 faceGrid(vec3 p, float face) {
    vec3 q = puzzleSpace(p);
    vec2 uv;
    if (face < 0.5) uv = vec2(-q.z, q.y) / max(q.x, 0.05);
    else if (face < 1.5) uv = vec2(q.z, q.y) / max(-q.x, 0.05);
    else if (face < 2.5) uv = vec2(q.x, -q.z) / max(q.y, 0.05);
    else if (face < 3.5) uv = vec2(q.x, q.z) / max(-q.y, 0.05);
    else if (face < 4.5) uv = vec2(q.x, q.y) / max(q.z, 0.05);
    else uv = vec2(-q.x, q.y) / max(-q.z, 0.05);
    return clamp((uv + 1.0) * 0.5 * PN, -0.5, PN + 0.5);
  }
`;

// How much a piece is still part of the wall (1 = in it, 0 = gone), from where it sits on the wall
// and its own small lag. Pieces leave from the bottom of the screen up, just ahead of the next
// section's text.
const WALL_GLSL = `
  float wallHold(vec2 pieceXY, float lag) {
    float fromTop = 0.5 - pieceXY.y / (2.0 * uView.y);
    float leave = max(0.035, 0.7 - fromTop + 0.14 * lag);
    return 1.0 - smoothstep(leave, leave + 0.24, uHero);
  }
`;

// The standing wall itself: one flat sheet just behind the pieces, cut into the same jigsaw
// shapes. Each piece's 3D copy only takes over as it lets go, so the wall never shows cracks where
// the brain's surface doesn't quite reach, and it is cheap to draw. Where a piece has gone, the
// sheet has a hole and the scene behind shows through.
const wallSheet = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: {
    uShards: uniforms.uShards, uHero: uniforms.uHero, uWall: uniforms.uWall, uBlocks: uniforms.uBlocks,
    uView: uniforms.uView, uSeams: uniforms.uSeams, uSky: uniforms.uSky
  },
  vertexShader: `uniform vec4 uWall; uniform vec2 uView;
    varying vec2 vWallXY;
    void main() {
      float z = uWall.y + 0.1;
      vWallXY = position.xy * uView * 1.02; // where this point is on the wall
      gl_Position = projectionMatrix * vec4(vWallXY * z / uWall.y, -z, 1.0);
    }`,
  fragmentShader: `uniform sampler2D uShards; uniform float uHero; uniform vec4 uWall; uniform vec2 uBlocks; uniform vec2 uView;
    uniform float uSeams; uniform sampler2D uSky;
    varying vec2 vWallXY;
    ${PUZZLE_SPACE}
    ${PUZZLE_GLSL}
    ${WALL_GLSL}
    void main() {
      vec2 g = vWallXY / uWall.x + uWall.zw * 0.5; // on the wall's grid of pieces
      vec2 block = clamp(floor(g / PN), vec2(0.0), uBlocks - 1.0);
      float face = block.y * uBlocks.x + block.x;
      float seam;
      float piece = pieceOnFace(face, g - block * PN, seam);
      float lineWidth = seamWidth(0.02);
      float cell = piece - face * PN * PN;
      vec2 pieceXY = (block * PN + vec2(mod(cell, PN), floor(cell / PN + 0.01)) + 0.5 - uWall.zw * 0.5) * uWall.x;
      if (wallHold(pieceXY, texelFetch(uShards, ivec2(3, int(piece + 0.5)), 0).w) < 0.999) discard;
      float line = 1.0 - smoothstep(0.0, lineWidth, seam);
      // The nebula, with the seams as faint pale lines once they show: a hint of the pieces.
      vec3 sky = texture2D(uSky, vWallXY / (2.0 * uView) + 0.5).rgb;
      gl_FragColor = vec4(mix(sky, vec3(0.96, 0.86, 0.94), 0.1 * line * uSeams), 1.0);
    }`
}));
wallSheet.frustumCulled = false; // placed in the shader, in front of the camera
wallSheet.renderOrder = -1; // first, so it hides whatever is behind it
wallSheet.visible = false;
scene.add(wallSheet);

function toGeometry(m) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  geo.setAttribute('aShard', new THREE.BufferAttribute(m.shard, 1));
  geo.setAttribute('aAO', new THREE.BufferAttribute(m.ao, 1));
  geo.setIndex(new THREE.BufferAttribute(m.index, 1));
  return geo;
}

function addMesh(m) {
  const geo = toGeometry(m);

  // Per piece, 5 texels: [centre, delay] [loose position, turn] [turn axis, swirl speed]
  // [outward direction, when it leaves the wall] [the piece's "up" on its cube face, unused].
  const W = 5;
  const UP = [[0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]]; // per face, as in puzzleCell
  const data = new Float32Array(m.shards * W * 4);
  for (let s = 0; s < m.shards; s++) {
    const cx = m.centre[s * 3], cy = m.centre[s * 3 + 1], cz = m.centre[s * 3 + 2];
    const ox = m.out[s * 3], oy = m.out[s * 3 + 1], oz = m.out[s * 3 + 2];
    // Loose pieces drift in a loose shell around the brain, so the cloud keeps its shape.
    const dist = 0.2 + 0.45 * seeded(s + 1);
    const swirl = (Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2);
    const ax = seeded(s + 5) - 0.5, ay = seeded(s + 6) - 0.5, az = seeded(s + 7) - 0.5;
    const al = Math.hypot(ax, ay, az) || 1;
    data.set([
      cx, cy, cz, (0.65 * swirl + 0.35 * seeded(s + 9)) * SPREAD,
      cx + ox * dist + (seeded(s + 2) - 0.5) * 0.2, cy + oy * dist + (seeded(s + 3) - 0.5) * 0.2, cz + oz * dist + (seeded(s + 4) - 0.5) * 0.2,
      (0.2 + 0.5 * seeded(s + 8)) * (seeded(s + 10) < 0.5 ? -1 : 1),
      ax / al, ay / al, az / al, 0.6 + 0.8 * seeded(s + 12),
      ox, oy, oz, seeded(s + 11),
      ...UP[Math.floor(s / (PUZZLE_N * PUZZLE_N))], 0
    ], s * W * 4);
  }
  const tex = new THREE.DataTexture(data, W, m.shards, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  if (uniforms.uShards.value) uniforms.uShards.value.dispose();
  uniforms.uShards.value = tex;
  pieceCentre = m.centre;
  pieceOut = m.out;
  pickFeatured(m);

  // The detailed brain replaces the rough one in place, with the same material.
  if (brainMesh) {
    brainMesh.geometry.dispose();
    brainMesh.geometry = geo;
    return;
  }
  material = new THREE.MeshPhysicalMaterial({
    color: '#eba38e',
    roughness: 0.46,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.32,
    sheen: 0.6,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color('#ffc9b8'),
    envMapIntensity: 0.55,
    side: THREE.DoubleSide // through the gaps between loose pieces you see their darker insides
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float aShard; attribute float aAO;
      uniform float uAssemble; uniform float uTime; uniform sampler2D uShards;
      uniform float uFeature; uniform float uFeatureT; uniform vec3 uFeaturePos; uniform float uFeatureScale;
      uniform float uHero; uniform vec4 uWall; uniform vec2 uBlocks; uniform vec2 uView;
      uniform vec2 uSway;
      varying float vLoose; varying float vSnap; varying vec3 vRest; varying float vShard; varying float vAO; varying float vFeature;
      varying float vDim; varying float vWall; varying vec2 vWallXY; varying float vTop;
      vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
      vec3 rotAxis(vec3 v, vec3 axis, float a) { float c = cos(a), s = sin(a); return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c); }
      ${PUZZLE_SPACE}
      ${FACE_GLSL}
      ${WALL_GLSL}
      ` + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `
        int row = int(aShard + 0.5);
        vec4 sA = texelFetch(uShards, ivec2(0, row), 0);
        vec4 sB = texelFetch(uShards, ivec2(1, row), 0);
        vec4 sC = texelFetch(uShards, ivec2(2, row), 0);
        vec4 sD = texelFetch(uShards, ivec2(3, row), 0);
        vec4 sE = texelFetch(uShards, ivec2(4, row), 0);
        // How settled this piece is in the brain: 0 = loose, 1 = in place.
        float k = clamp(uAssemble * (1.0 + ${SPREAD.toFixed(2)}) - sA.w, 0.0, 1.0);
        vSnap = smoothstep(0.72, 0.96, k) * (1.0 - smoothstep(0.96, 1.0, k)); // a soft glow as it clicks in
        k = k * k * (3.0 - 2.0 * k);
        // The featured piece: 0 = in its place (loose or in the brain), 1 = in front, facing the viewer.
        float feature = abs(aShard - uFeature) < 0.5 ? uFeatureT : 0.0;
        feature = feature * feature * feature * (feature * (feature * 6.0 - 15.0) + 10.0); // eased in and out
        vFeature = feature;
        // Loose pieces tumble gently and circle the brain, each at its own slow pace. The featured
        // piece straightens up on its way out: its tumble unwinds (by the short way round) as it goes.
        float swirl = uTime * 0.05 * sC.w;
        float swirlShort = swirl - 6.28318 * floor(swirl / 6.28318 + 0.5);
        float turn = (sB.w + sin(uTime * 0.35 + sA.w * 20.0) * 0.25) * (1.0 - k) * (1.0 - feature);
        float spin = swirlShort * (1.0 - feature);
        vec3 objectNormal = rotAxis(normal, sC.xyz, turn);
        objectNormal = normalize(mix(rotY(objectNormal, spin), objectNormal, k));
        vTop = dot(normal, sD.xyz);
        vDim = uFeatureT * (1.0 - step(0.001, feature)) * (1.0 - k); // the loose pieces step back
        vLoose = 1.0 - k;
        vRest = position;
        vShard = aShard;
        vAO = mix(aAO, 1.0, 0.45 * feature); // softer grooves up close, so the words read cleanly

        // The opening wall: each cube face is a block of PN x PN pieces, the blocks side by side.
        float face = floor(aShard / (PN * PN) + 0.01);
        float cell = aShard - face * PN * PN;
        vec2 block = vec2(mod(face, uBlocks.x), floor(face / uBlocks.x + 0.01));
        vec2 grid = uWall.zw;
        vec2 wallXY = (block * PN + faceGrid(position, face) - grid * 0.5) * uWall.x;
        vec2 pieceXY = (block * PN + vec2(mod(cell, PN), floor(cell / PN + 0.01)) + 0.5 - grid * 0.5) * uWall.x;
        float w = wallHold(pieceXY, sD.w); // 1 = still in the wall
        vWallXY = wallXY;
        vWall = w * (1.0 - feature);
        float lift = 1.0 - w;
        lift = lift * lift * (3.0 - 2.0 * lift);`)
      .replace('#include <begin_vertex>', `
        // The loose cloud draws in closer as more of the brain comes together.
        vec3 loosePos = rotY(sA.xyz + (sB.xyz - sA.xyz) * (1.0 - 0.5 * uAssemble), swirl);
        vec3 local = (position - sA.xyz) * mix(0.94, 1.0, k); // small gaps between loose pieces
        vec3 transformed = mix(loosePos + rotY(rotAxis(local, sC.xyz, turn), spin), sA.xyz + local, k);
        vec3 centreObj = mix(loosePos, sA.xyz, k); // where the piece's middle is right now`)
      .replace('#include <normal_vertex>', `#include <normal_vertex>
        vNormal = normalize(mix(vNormal, vec3(0.0, 0.0, 1.0), 1.0 - lift)); // flat on the wall
        // The featured piece turns, as one solid thing, so its outer side faces the viewer and its
        // "up" points up, like a piece held up to show you, then tilts a little (uSway) so its edges
        // catch the light. Built in view space, so it doesn't matter how the brain is turned. The
        // brain's own thin copy of the piece is also pressed flatter (the solid copy, DETAIL, is not).
        vec3 faceDir = vec3(0.0, 1.0, 0.0);
        float faceTurn = 0.0, roll = 0.0;
        #ifdef DETAIL
          const float FLAT = 1.0;
        #else
          const float FLAT = 0.35;
        #endif
        float squash = mix(1.0, FLAT, feature);
        if (feature > 0.0) {
          vec3 n = normalize(normalMatrix * sD.xyz);
          vec3 axis = cross(n, vec3(0.0, 0.0, 1.0));
          float len = length(axis);
          if (len > 1e-4) faceDir = axis / len;
          faceTurn = atan(len, n.z);
          vec3 up = rotAxis(normalize(normalMatrix * sE.xyz), faceDir, faceTurn);
          roll = atan(up.x, up.y);
          vec3 shown = rotAxis(rotAxis(vNormal, faceDir, faceTurn * feature), vec3(0.0, 0.0, 1.0), roll * feature);
          shown = rotAxis(rotAxis(shown, vec3(1.0, 0.0, 0.0), uSway.x * feature), vec3(0.0, 1.0, 0.0), uSway.y * feature);
          vNormal = normalize(vec3(shown.xy, shown.z / squash));
        }`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec3 placedBrain = mvPosition.xyz; // where it is in the brain or the cloud
        vec3 placed = placedBrain;
        vec3 centreView = (modelViewMatrix * vec4(centreObj, 1.0)).xyz; // the piece's middle there
        vec3 startCentre = centreView;
        if (w > 0.0) {
          // Outer layers sit a hair in front of inner ones, so the wall draws cleanly.
          vec3 onWall = vec3(wallXY, -uWall.y + 0.02 * length(puzzleSpace(position)));
          // Lift toward the viewer as it lets go, then drift back to its place by the brain.
          vec3 arc = vec3(0.0, 0.0, 0.7) * sin(3.14159 * lift);
          placed = mix(onWall, placed, lift) + arc;
          startCentre = mix(vec3(pieceXY, -uWall.y), centreView, lift) + arc;
        }
        if (feature > 0.0) {
          // The piece turns about its own middle on the way, grows as it comes, and travels along a
          // gentle curve, so it reads as one object turning toward you rather than a shape morphing.
          // (From the wall, where it lies flat, it also takes its brain shape on the way.)
          vec3 localView = mix(placed - startCentre, placedBrain - centreView, feature);
          localView = rotAxis(rotAxis(localView, faceDir, faceTurn * feature), vec3(0.0, 0.0, 1.0), roll * feature);
          localView = rotAxis(rotAxis(localView, vec3(1.0, 0.0, 0.0), uSway.x * feature), vec3(0.0, 1.0, 0.0), uSway.y * feature);
          localView.z *= squash;
          vec3 middle = mix(startCentre, uFeaturePos, feature) + vec3(0.0, 0.15, 0.1) * sin(3.14159 * feature);
          placed = middle + localView * mix(1.0, uFeatureScale, feature);
        }
        if (w > 0.0 || feature > 0.0) {
          mvPosition = vec4(placed, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }`);
    shader.fragmentShader = `varying float vLoose; varying float vSnap; varying vec3 vRest; varying float vShard; varying float vAO; varying float vFeature; varying float vDim;
      varying float vWall; varying vec2 vWallXY; varying float vTop;
      uniform vec3 uFade; uniform float uMaskOnly; uniform float uSeams;
      uniform sampler2D uSky; uniform vec2 uView;
      uniform float uFeature; uniform float uFeatureDetail;
      ${PUZZLE_SPACE}
      ${PUZZLE_GLSL}
      ` + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        // Up close, the featured piece is drawn by its own solid copy instead (addDetail), which is
        // already cut to its exact shape, so it needs no outline work.
        float inWall = 0.0, line = 0.0;
        vec3 wallInk = vec3(0.0);
        #ifdef DETAIL
          if (uFeatureDetail < 0.5 || abs(vShard - uFeature) > 0.5) discard;
          // Measuring where the words fit: only the piece's top face counts, not its sides or back.
          if (uMaskOnly > 0.5 && (vFeature < 0.999 || vTop < 0.25)) discard;
        #else
          if (uFeatureDetail > 0.5 && abs(vShard - uFeature) < 0.5) discard;
          if (vWall > 0.999) discard; // still standing in the wall, which the flat sheet draws
          // Keep only the part of this copy that is really inside its piece: exact jigsaw outlines.
          inWall = smoothstep(0.9, 1.0, vWall); // only just letting go of the wall
          float seam;
          float piece = pieceAt(vRest, seam);
          float lineWidth = seamWidth(0.03 - 0.01 * inWall);
          if (abs(piece - vShard) > 0.5) discard;
          if (uMaskOnly > 0.5 && vFeature < 0.999) discard;
          line = 1.0 - smoothstep(0.0, lineWidth, seam);
          // Looking just like the wall sheet as it lets go. Skip the lighting while it still does.
          wallInk = mix(texture2D(uSky, vWallXY / (2.0 * uView) + 0.5).rgb, vec3(0.96, 0.86, 0.94), 0.1 * line * uSeams);
          if (inWall > 0.999) { gl_FragColor = vec4(wallInk, 1.0); return; }
        #endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (!gl_FrontFacing) diffuseColor.rgb *= 0.4; // the inside of a piece is darker
        #ifdef DETAIL
          // The solid piece's sides and back sit in shade, so its thickness shows.
          diffuseColor.rgb *= mix(0.58, 1.0, smoothstep(-0.3, 0.75, vTop));
        #endif
        diffuseColor.rgb *= mix(vec3(0.46, 0.2, 0.2), vec3(1.0), vAO); // deep, rosy grooves
        diffuseColor.rgb *= 1.0 - 0.35 * line * vLoose * (1.0 - vFeature); // seams show only while a piece is loose
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.98, 0.84, 0.77), 0.28 * vFeature); // paler up close, behind the words`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.34, vFeature); // a glossier, ceramic finish up close`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // A soft glow at the edges, as light passes through the surface (subsurface scattering).
        float facing = max(dot(normal, normalize(vViewPosition)), 0.0);
        totalEmissiveRadiance += vec3(0.75, 0.24, 0.2) * pow(1.0 - facing, 3.0) * 0.22 * vAO;
        // Faint warm edges while the pieces are loose, a soft glow as each one clicks in, then nothing.
        // The featured piece gets a fine bright outline.
        vec3 glow = vec3(1.0, 0.62, 0.48);
        totalEmissiveRadiance += glow * (line * (0.25 * vLoose + 0.9 * vSnap + 0.6 * vFeature) + 0.12 * vSnap) * (1.0 - inWall);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= vAO;
        reflectedLight.indirectSpecular *= mix(0.15, 1.0, vAO);
        reflectedLight.directSpecular *= mix(0.25, 1.0, vAO);`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        // Pieces letting go of the wall turn from its plum to the brain's own colour.
        gl_FragColor.rgb = mix(gl_FragColor.rgb, wallInk, inWall);
        // Loose pieces (off the wall, not yet in the brain) fade into the background while they pass
        // behind the text column or the top bar, so the words stay easy to read.
        float hide = max(1.0 - smoothstep(uFade.x - uFade.z * 0.4, uFade.x + uFade.z, gl_FragCoord.x),
                         smoothstep(uFade.y - uFade.z * 0.3, uFade.y, gl_FragCoord.y));
        hide *= smoothstep(0.0, 0.25, vLoose) * (1.0 - vFeature) * (1.0 - inWall);
        hide = max(hide, 0.6 * vDim * (1.0 - inWall));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.027, 0.024, 0.035), 0.9 * hide);`);
  };
  brainMesh = new THREE.Mesh(geo, material);
  brainMesh.frustumCulled = false; // pieces move in the shader, so the box three.js knows about is wrong
  brain.add(brainMesh);
  // The same look for the fine-detail pieces, which only draw the featured piece.
  detailMaterial = material.clone();
  detailMaterial.defines = { DETAIL: '' };
  detailMaterial.onBeforeCompile = material.onBeforeCompile;
  ready = true;
  document.body.classList.add('brain-ready');
}

// One piece per section to bring forward. Up close it should look like the pieces in the brain,
// whole and clean, so only pieces on the sides of the brain qualify (the front, back and top cut
// across both halves and the gap between them), and of those the ones that are a single, thin
// sheet of surface rather than reaching down into a deep fold. Alternates left and right.
function pickFeatured(m) {
  const N = PUZZLE_N;
  const count = new Uint32Array(m.shards);
  const near = new Float32Array(m.shards).fill(1e9), far = new Float32Array(m.shards).fill(-1e9);
  pieceSize = new Float32Array(m.shards);
  pieceBox = new Float32Array(m.shards * 6).fill(1e9);
  for (let s = 0; s < m.shards; s++) pieceBox.fill(-1e9, s * 6 + 3, s * 6 + 6);
  for (let v = 0; v < m.shard.length; v++) {
    const s = m.shard[v];
    const x = m.position[v * 3], y = m.position[v * 3 + 1], z = m.position[v * 3 + 2];
    // The box around everything that may belong to the piece, tabs and all (for addDetail).
    for (let c = 0; c < 3; c++) {
      pieceBox[s * 6 + c] = Math.min(pieceBox[s * 6 + c], m.position[v * 3 + c]);
      pieceBox[s * 6 + 3 + c] = Math.max(pieceBox[s * 6 + 3 + c], m.position[v * 3 + c]);
    }
    // Only points really in the piece count from here on (the mesh also keeps copies around its tabs).
    const [face, i, j] = puzzleCell(x, y, z);
    if (face * N * N + j * N + i !== s) continue;
    count[s]++;
    const dx = x - m.centre[s * 3], dy = y - m.centre[s * 3 + 1], dz = z - m.centre[s * 3 + 2];
    pieceSize[s] = Math.max(pieceSize[s], Math.hypot(dx, dy, dz));
    const depth = dx * m.out[s * 3] + dy * m.out[s * 3 + 1] + dz * m.out[s * 3 + 2];
    near[s] = Math.min(near[s], depth);
    far[s] = Math.max(far[s], depth);
  }
  const ranked = (face) => {
    const list = [];
    for (let j = 5; j <= 8; j++) {
      for (let i = 3; i <= 8; i++) {
        const id = face * N * N + j * N + i;
        if (count[id]) list.push({ id, score: count[id] * Math.exp(-(far[id] - near[id]) / 0.05) });
      }
    }
    return list.sort((a, b) => b.score - a.score).map((c) => c.id);
  };
  featured = [ranked(0), ranked(1)];
  picks = []; // a new mesh: choose again
}

let builder = null; // the worker, kept to build fine-detail pieces later
let finished = false; // the detailed brain is in (not just the rough one)
function build() {
  const step = lowPower ? 0.023 : 0.017;
  try {
    builder = new Worker(new URL('./build-worker.js?v=9', import.meta.url), { type: 'module' });
    let got = 0;
    builder.onmessage = (e) => {
      if (e.data.piece !== undefined) { addDetail(e.data); return; }
      addMesh(e.data);
      if (++got === 2) finished = true;
    };
    builder.onerror = () => { builder.terminate(); builder = null; if (!got) buildHere(step); };
    builder.postMessage({ step, preview: 0.04 });
  } catch (_) {
    buildHere(step);
  }
}
// Browsers without module workers: build on the page instead (a short pause while it loads), and
// no fine-detail pieces.
function buildHere(step) {
  import('./mesh.js').then(({ buildBrainMesh }) => { addMesh(buildBrainMesh({ step })); finished = true; }).catch((error) => {
    console.error(error);
    window.brainFallback && window.brainFallback();
  });
}
build();

// A piece that comes up close is shown about four times its size, and the brain's own mesh is a
// thin, coarse sheet: up close it would look flat, faceted and blurry. So each piece picked for a
// quote is built again on its own as a solid object (buildPieceSolid in mesh.js: the brain's
// surface on top, straight sides along its exact outline, a flat back, rounded edges), about three
// times finer, and drawn in place of its thin copy while it's out.
const detailed = new Set(); // pieces asked for
const detailReady = new Set(); // pieces whose solid copy is in
function requestDetail(piece) {
  if (!builder || !finished || detailed.has(piece)) return;
  detailed.add(piece);
  const b = pieceBox.subarray(piece * 6, piece * 6 + 6), pad = 0.02;
  builder.postMessage({
    piece, step: lowPower ? 0.0085 : 0.006, thickness: 0.032, bevel: 0.012, soft: 0.45,
    centre: Array.from(pieceCentre.subarray(piece * 3, piece * 3 + 3)), out: Array.from(pieceOut.subarray(piece * 3, piece * 3 + 3)),
    box: [[b[0] - pad, b[1] - pad, b[2] - pad], [b[3] + pad, b[4] + pad, b[5] + pad]]
  });
}
function addDetail(m) {
  const mesh = new THREE.Mesh(toGeometry(m), detailMaterial);
  mesh.frustumCulled = false;
  brain.add(mesh);
  detailReady.add(m.piece);
}

// A soft shadow floating a little behind the piece in front, so it sits off the cloud of pieces
// instead of lying flat on it.
const shadow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(4, 2, 6, 1)');
    grad.addColorStop(0.45, 'rgba(4, 2, 6, 0.7)');
    grad.addColorStop(1, 'rgba(4, 2, 6, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })(),
  transparent: true, depthWrite: false, opacity: 0
}));
shadow.visible = false;
scene.add(shadow);
// How the piece in front is tilted when settled: a little back and to the side, so its top and
// left edges show, plus a slow sway and a slight lean toward the pointer (added each frame).
const SWAY_BASE = [0.1, 0.2];

/* ---------- scroll + frame ---------- */

let width = 0, height = 0, maxScroll = 1;
// Wide screens: where the finished brain sits, in the space right of the text column.
const place = { distance: 6.2, x: 1 };
const BRAIN_LENGTH = 2.2, BRAIN_HEIGHT = 1.75; // its size on screen, side on (shape.js)
// Sections with a quote (each gets a piece), in page pixels.
let sections = [];
function measure() {
  maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  sections = [...document.querySelectorAll('[data-quote]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + scrollY, height: r.height, quote: el.dataset.quote };
  });
}
// Phones change the window height as the address bar shows and hides while scrolling;
// resizing the canvas for that would stutter, so small height changes are ignored.
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === width && Math.abs(h - height) < 140) return;
  width = w;
  height = h;
  picks = []; // the pieces come forward at a new size: fit the quotes again
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  // Lay the wall out to cover the whole screen: the cube's six faces as 3 x 2 blocks of pieces on
  // wide screens, 2 x 3 on tall ones.
  const wallH = WALL_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const wallW = wallH * camera.aspect;
  const tall = camera.aspect < 1;
  const cols = (tall ? 2 : 3) * PUZZLE_N, rows = (tall ? 3 : 2) * PUZZLE_N;
  uniforms.uBlocks.value.set(tall ? 2 : 3, tall ? 3 : 2);
  uniforms.uWall.value.set(Math.max((2 * wallW) / cols, (2 * wallH) / rows), WALL_DISTANCE, cols, rows);
  uniforms.uView.value.set(wallW, wallH);
  skyTarget.setSize(Math.ceil(width * renderer.getPixelRatio() / 2), Math.ceil(height * renderer.getPixelRatio() / 2));
  skyPaint.material.uniforms.uAspect.value = camera.aspect;
  renderer.setRenderTarget(skyTarget);
  renderer.render(skyScene, camera);
  renderer.setRenderTarget(null);

  // Size the brain to the free space right of the text (at most 40% of the screen's width and 70%
  // of its height), with the camera looking straight ahead, and centre it in that space.
  const copy = document.querySelector('.hero .copy');
  const copyRight = copy ? copy.getBoundingClientRect().right : width / 2;
  const textRight = copyRight / width;
  const free = Math.max(0.3, 1 - textRight);
  const share = Math.min(0.4, free * 0.8);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  place.distance = Math.max(BRAIN_LENGTH / (share * 2 * tanHalf * camera.aspect), BRAIN_HEIGHT / (0.7 * 2 * tanHalf));
  place.x = (1 - free * 0.54 - 0.5) * 2 * place.distance * tanHalf * camera.aspect;

  // Flying pieces fade behind the text on wide screens (on narrow ones the brain sits behind the
  // text boxes, which have their own backing) and behind the top bar everywhere.
  const pr = renderer.getPixelRatio();
  const nav = document.querySelector('.nav');
  const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
  uniforms.uFade.value.set(width >= 900 ? (copyRight + 16) * pr : -1e5, (height - navBottom) * pr, 60 * pr);
}

// How assembled the brain is (0 = every piece loose, 1 = whole) at scroll position y (in pixels):
// it starts once the wall has let go and builds steadily down the page, a few more pieces with
// every section, whole just before the bottom so the finished brain has a moment on screen.
function assembleAt(y) {
  const start = innerHeight * 0.6, end = Math.max(start + 1, maxScroll - innerHeight * 0.3);
  return clamp((y - start) / (end - start), 0, 1);
}

// The section's quote (its data-quote), set on the featured piece once it has come forward: sharp
// HTML text over the middle of the 3D piece. Decorative, so screen readers skip it.
const card = document.createElement('blockquote');
card.className = 'piece-quote';
card.setAttribute('aria-hidden', 'true');
card.style.transformOrigin = '0 0'; // its transform is written out in full each frame (see frame)
document.body.appendChild(card);
let featIndex = -1, featT = 0;
let picks = []; // per section: { piece, fit }, chosen the first time it's needed
const stagePoint = new THREE.Vector3();
let fontsReady = false;
document.fonts.load('600 20px "Atkinson Hyperlegible Next"').catch(() => {}).then(() => { fontsReady = true; picks = []; });

// Where the featured piece comes to: in front of the brain, halfway down the screen (near the top
// on phones), with its square body about 300 pixels across. Returns that point on screen.
function placeFeature(piece) {
  const wide = width >= 900;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  stage.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  stagePoint.setFromMatrixPosition(stage.matrixWorld).project(camera);
  const sx = wide ? (stagePoint.x + 1) * 0.5 * width : width * 0.5;
  const sy = height * (wide ? 0.5 : 0.3);
  // Nearer than the opening wall, so the piece is never behind it while the wall is still up.
  const depth = Math.min(camera.position.z * 0.55, WALL_DISTANCE * 0.8);
  const halfH = depth * tanHalf;
  uniforms.uFeaturePos.value.set((sx / width * 2 - 1) * halfH * camera.aspect, (1 - sy / height * 2) * halfH, -depth);
  // The piece's farthest point from its centre is about half its square body's diagonal.
  const body = wide ? clamp(width * 0.21, 260, 330) : 200;
  const size = Math.max(0.02, pieceSize[piece] || 0.08);
  uniforms.uFeatureScale.value = (body * 0.72) / (size * (height / (2 * halfH)));
  return { sx, sy, body };
}

// Exactly which screen pixels a piece covers once it has come forward: draw it alone, settled,
// into a hidden image at half resolution and read that back. Returns a grid of 1s (piece) and 0s
// around the point it comes to, and where that grid sits on screen.
const MASK = 0.5;
const maskTarget = new THREE.WebGLRenderTarget(1, 1);
function pieceMask(piece, at) {
  const rw = Math.max(1, Math.round(width * MASK)), rh = Math.max(1, Math.round(height * MASK));
  maskTarget.setSize(rw, rh);
  const reach = Math.ceil(at.body * 1.15 * MASK);
  const left = clamp(Math.round(at.sx * MASK) - reach, 0, rw - 1), top = clamp(Math.round(at.sy * MASK) - reach, 0, rh - 1);
  const w = Math.min(rw - left, reach * 2), h = Math.min(rh - top, reach * 2);
  const saved = { feature: uniforms.uFeature.value, t: uniforms.uFeatureT.value, detail: uniforms.uFeatureDetail.value, sway: uniforms.uSway.value.clone(), background: scene.background, sheet: wallSheet.visible, shadow: shadow.visible };
  uniforms.uFeature.value = piece;
  uniforms.uFeatureT.value = 1;
  // Its solid copy if that is in, else the thin one (the thin copy hides whenever uFeatureDetail is
  // on, so this must be set for the piece being measured, not left over from the one on screen).
  uniforms.uFeatureDetail.value = detailReady.has(piece) ? 1 : 0;
  uniforms.uSway.value.set(SWAY_BASE[0], SWAY_BASE[1]);
  uniforms.uMaskOnly.value = 1;
  shell.visible = ring.visible = dust.visible = wallSheet.visible = shadow.visible = false;
  scene.background = null;
  renderer.setRenderTarget(maskTarget);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  const pixels = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(maskTarget, left, rh - top - h, w, h, pixels); // rows counted from the bottom
  renderer.setRenderTarget(null);
  uniforms.uFeature.value = saved.feature;
  uniforms.uFeatureT.value = saved.t;
  uniforms.uFeatureDetail.value = saved.detail;
  uniforms.uSway.value.copy(saved.sway);
  uniforms.uMaskOnly.value = 0;
  shell.visible = ring.visible = dust.visible = true;
  wallSheet.visible = saved.sheet;
  shadow.visible = saved.shadow;
  scene.background = saved.background;
  const grid = new Uint8Array(w * h);
  let cover = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) cover += grid[y * w + x] = pixels[((h - 1 - y) * w + x) * 4 + 3] > 200 ? 1 : 0;
  }
  return { grid, w, h, cover, left: left / MASK, top: top / MASK };
}

// The biggest text box that fits inside the piece with a clear margin all round, and the largest
// type that fits that box: the grid is first shrunk by the margin (a pixel stays only if the whole
// square around it is piece), then the widest-area rectangle, no taller than it is wide, is found
// row by row. Returns the box (centre, size, font size, relative to the point the piece comes to),
// or null if the quote won't fit at a readable size, or undefined if the piece didn't draw at all
// (so nothing could be measured, and it should be tried again).
const MARGIN = 18; // screen pixels kept clear between the words and the piece's edge
function fitQuote(piece, quote) {
  const at = placeFeature(piece);
  const { grid, w, h, cover, left, top } = pieceMask(piece, at);
  if (!cover) return undefined;
  const r = Math.round(MARGIN * MASK);
  const sum = new Int32Array((w + 1) * (h + 1)); // summed-area table
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += grid[y * w + x]; sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row; }
  }
  const area = (x0, y0, x1, y1) => sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
  const heights = new Int32Array(w);
  let best = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const clear = x >= r && y >= r && x + r < w && y + r < h && area(x - r, y - r, x + r + 1, y + r + 1) === (2 * r + 1) ** 2;
      heights[x] = clear ? heights[x] + 1 : 0;
    }
    const stack = [];
    for (let x = 0; x <= w; x++) {
      const hx = x < w ? heights[x] : 0;
      let start = x;
      while (stack.length && stack[stack.length - 1][1] >= hx) {
        const [sx, sh] = stack.pop();
        const bw = x - sx, bh = Math.min(sh, bw);
        if (!best || bw * bh > best.w * best.h) best = { x: sx, w: bw, h: bh, y: y - sh + 1 + Math.floor((sh - bh) / 2) };
        start = sx;
      }
      stack.push([start, hx]);
    }
  }
  if (!best) return null;
  const box = { w: best.w / MASK, h: best.h / MASK };
  box.x = left + (best.x + best.w / 2) / MASK - at.sx;
  box.y = top + (best.y + best.h / 2) / MASK - at.sy;
  // The largest type, in half-pixel steps, whose lines all fit inside the box.
  card.textContent = quote;
  card.style.width = `${Math.floor(box.w)}px`;
  card.style.height = 'auto';
  for (let size = 24; size >= 16; size -= 0.5) {
    card.style.fontSize = `${size}px`;
    if (card.scrollHeight <= box.h && card.scrollWidth <= box.w) return { ...box, size };
  }
  return null;
}

// The piece for a section, and where its quote goes: the first clean piece (alternating sides,
// none used twice) that holds the quote at a comfortable size, or else the one that holds it
// biggest.
function pickFor(index) {
  if (picks[index]) return picks[index];
  const used = new Set(picks.filter(Boolean).map((p) => p.piece));
  const options = featured[index % 2].filter((id) => !used.has(id)).slice(0, 6);
  let choice = null, unmeasured = false;
  for (const piece of options) {
    const fit = fitQuote(piece, sections[index].quote);
    if (fit === undefined) unmeasured = true;
    if (fit && (!choice || fit.size > choice.fit.size)) choice = { piece, fit };
    if (fit && fit.size >= 19) break;
  }
  if (!choice && options.length) choice = { piece: options[0], fit: null }; // it still comes forward, without words
  // If a piece couldn't be measured this time, keep this choice for now but try again later.
  if (choice && (choice.fit || !unmeasured)) picks[index] = choice;
  if (choice) requestDetail(choice.piece);
  return choice;
}

// Which section's piece should be out at scroll position y (-1 for none): from just before the
// section's top reaches the middle of the screen until it has nearly scrolled past, so there is
// time to read it. The same window going up or down the page.
function featureAt(y, current) {
  const middle = y + innerHeight * 0.5;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i], at = (middle - s.top) / s.height;
    // A little wider for the piece already out, so it doesn't flicker at the edges.
    const [from, to] = i === current ? [-0.12, 0.95] : [-0.06, 0.9];
    if (at >= from && at < to) return i;
  }
  return -1;
}

const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
let smoothP = 0;
let lastTime = performance.now();
let smoothHero = 0;
let appear = 0;
let slowFrames = 0;
let vignetteShown = -1;

// A game or the games library covers the page: no need to draw the brain underneath.
const covered = () => document.body.style.overflow === 'hidden';

let stopped = false;
function frame(now) {
  if (stopped) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (document.hidden || covered()) return;
  const t = still ? 0 : now / 1000;

  // Devices that can't keep up: first lower the resolution, then switch to a still background.
  if (ready && !still) slowFrames = dt > 0.026 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
  if (slowFrames > 40 && pixelRatio > 1) {
    slowFrames = 0;
    pixelRatio = 1;
    renderer.setPixelRatio(1);
    width = 0;
    resize();
  } else if (slowFrames > 120) {
    stopped = true;
    window.brainFallback && window.brainFallback();
    renderer.dispose();
    return;
  }

  const ease = still ? 1 : Math.min(1, dt * 9);
  smoothP += (clamp(scrollY / maxScroll, 0, 1) - smoothP) * ease;
  smoothHero += (scrollY / Math.max(1, innerHeight) - smoothHero) * ease;
  const y = smoothP * maxScroll;
  const assemble = still ? 1 : assembleAt(y);
  const loose = 1 - assemble;
  if (ready) appear = Math.min(1, appear + dt * 2.5);
  pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
  pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);

  // How much of the wall is still up (1 at the top of the page, 0 once it has all lifted off).
  const wall = still ? 0 : 1 - smooth(0.1, 1.05, smoothHero);
  uniforms.uAssemble.value = assemble;
  uniforms.uTime.value = t;
  if (!still) {
    uniforms.uHero.value = smoothHero;
    uniforms.uSeams.value = smooth(0, 0.05, smoothHero);
  }
  wallSheet.visible = ready && !still && smoothHero < 1.25;
  dust.material.uniforms.uOpacity.value = 0.55 * appear * (1 - wall);
  dust.material.uniforms.uSize.value = 22 * pixelRatio;
  // The dark edge shading only makes sense once the wall has (nearly) gone: on the wall it would
  // just muddy the colour behind the headline.
  const shade = Math.round(smooth(0.5, 1, 1 - wall) * 50) / 50;
  if (shade !== vignetteShown && vignette) { vignette.style.opacity = String(shade); vignetteShown = shade; }

  // Wide screens: the brain sits right of the text. Narrow: in the upper part of the screen,
  // with the camera far enough back that the whole brain fits the width.
  const wide = width >= 900;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const narrowZ = 1.7 / (tanHalf * camera.aspect);
  stage.position.set(wide ? place.x : 0, wide ? 0 : 0.42 * narrowZ * tanHalf, 0);
  camera.position.set(pointer.x * 0.25, 0.2 + pointer.y * 0.12, wide ? lerp(place.distance, place.distance * 1.3, loose) : lerp(narrowZ, narrowZ * 1.25, loose));
  camera.lookAt(pointer.x * 0.25, -0.05, 0);

  const idle = still ? 0 : Math.sin(t * 0.2) * 0.12;
  brain.rotation.set(0.16, -1.05 + idle + (still ? 0.62 : smoothP) * Math.PI * 0.8, 0);
  brain.position.y = still ? 0 : Math.sin(t * 0.6) * 0.02;
  shell.rotation.set(t * 0.03, t * 0.05 + smoothP * 1.2, 0);
  ring.rotation.set(-t * 0.02, -t * 0.03 - smoothP * 0.8, 0.3);
  shell.material.opacity = 0.16 * appear * (1 - wall);
  ring.material.opacity = 0.08 * appear * (1 - wall);
  dust.rotation.y = t * 0.02 + smoothP * 0.6;

  // One piece out at a time: the old one goes back into the cloud before the next one leaves.
  // The scroll only decides which section's piece should be out; the piece then moves on its own
  // clock, at the same even pace whichever way you scroll (the shader eases it in and out).
  // One piece out at a time: the old one goes back before the next one comes out.
  const want = still || !featured.length ? -1 : featureAt(y, featIndex);
  if (want !== featIndex) {
    featT = Math.max(0, featT - dt / 0.7);
    if (featT === 0) featIndex = want;
  }
  const pick = featIndex >= 0 && fontsReady && sections[featIndex] ? pickFor(featIndex) : null;
  if (want === featIndex && pick) featT = Math.min(1, featT + dt / 1.1);
  // Choose the other sections' pieces ahead of time, one per quiet frame, so their fine copies are
  // ready and choosing never stalls a piece on its way out.
  if (finished && fontsReady && featT === 0) {
    const next = sections.findIndex((_, i) => !picks[i]);
    if (next >= 0) pickFor(next);
  }
  uniforms.uFeature.value = pick ? pick.piece : -1;
  uniforms.uFeatureT.value = pick ? featT : 0;
  uniforms.uFeatureDetail.value = pick && featT > 0 && detailReady.has(pick.piece) ? 1 : 0;
  // The piece in front tilts a little, sways slowly and leans toward the pointer, so its edges
  // and the light on it keep moving: that is what makes it read as a solid thing.
  const swayX = SWAY_BASE[0] + 0.03 * Math.sin(t * 0.9) + 0.12 * pointer.y;
  const swayY = SWAY_BASE[1] + 0.04 * Math.sin(t * 0.7 + 1.0) - 0.16 * pointer.x;
  uniforms.uSway.value.set(swayX, swayY);
  shadow.visible = !!pick && featT > 0;
  if (pick) {
    const at = placeFeature(pick.piece);
    const fp = uniforms.uFeaturePos.value;
    const depth = -fp.z, worldPerPixel = (2 * depth * tanHalf) / height;
    shadow.position.set(fp.x + 0.08 * depth * 0.1, fp.y - 0.1 * depth * 0.1 - at.body * 0.12 * worldPerPixel, fp.z - 0.12 * depth);
    camera.localToWorld(shadow.position);
    const size = at.body * 2.1 * worldPerPixel * (1 + 0.12 * depth);
    shadow.scale.set(size, size * 0.9, 1);
    shadow.material.opacity = 0.6 * smooth(0.35, 1, featT);
    if (pick.fit) {
      const { fit } = pick;
      // The words appear once the piece has settled in front, and leave before it goes back. They
      // tilt with it (about its middle, with the camera's own perspective), so they stay on its face.
      const shown = smooth(0.8, 1, featT);
      const focal = (0.5 * height) / tanHalf;
      card.textContent = sections[featIndex].quote;
      card.style.opacity = String(shown);
      card.style.width = `${Math.floor(fit.w)}px`;
      card.style.height = `${Math.floor(fit.h)}px`;
      card.style.fontSize = `${fit.size}px`;
      card.style.transform = `translate(${at.sx.toFixed(1)}px, ${at.sy.toFixed(1)}px) perspective(${focal.toFixed(0)}px) rotateX(${(-swayX * 57.2958).toFixed(2)}deg) rotateY(${(swayY * 57.2958).toFixed(2)}deg) translate(${fit.x.toFixed(1)}px, ${fit.y.toFixed(1)}px) translate(-50%, -50%)`;
    } else {
      card.style.opacity = '0';
    }
  } else {
    card.style.opacity = '0';
  }

  canvas.style.opacity = String(appear);
  // Once the 3D wall is fully showing, the hero's flat stand-in colour can go.
  if (appear === 1 && !document.body.classList.contains('wall-live')) document.body.classList.add('wall-live');
  renderer.render(scene, camera);
}

addEventListener('resize', () => { resize(); measure(); });
new ResizeObserver(measure).observe(document.body);
addEventListener('pointermove', (e) => {
  if (still) return;
  pointer.tx = e.clientX / innerWidth - 0.5;
  pointer.ty = -(e.clientY / innerHeight - 0.5);
}, { passive: true });

measure();
resize();
smoothP = clamp(scrollY / maxScroll, 0, 1);
smoothHero = scrollY / Math.max(1, innerHeight);
requestAnimationFrame(frame);
