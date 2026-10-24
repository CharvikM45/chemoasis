/*
 * Home page brain: a soft, glossy brain made of jigsaw pieces.
 * Scroll story ("your way back"): the page opens on one solid wall of colour behind the headline.
 * The first scroll shows the wall's seams: it is a jigsaw. Piece by piece, from the bottom of the
 * screen up, the pieces lift off and fly back, and as you read down the page they click together
 * into a brain, whole at the very bottom. It only ever comes together, never bursts apart, which
 * would be a heavy image for people living with "chemo brain". Once a piece is in place its seam
 * fades away, so the finished brain reads as one thing.
 * With reduced motion there is no wall: the brain is shown finished and still.
 * The mesh is built in a worker (build-worker.js) and all piece motion runs on the GPU, so the
 * page only updates a few numbers per frame.
 */
import * as THREE from 'three';
import { PUZZLE_N, PUZZLE_SCALE, PUZZLE_SHIFT_Y } from './mesh.js';

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
// The wall's colour: the site's accent, the same as the hero background in home.css (--wall).
const WALL_COLOR = new THREE.Vector3(231 / 255, 167 / 255, 130 / 255);
const uniforms = {
  uAssemble: { value: 1 },
  uTime: { value: 0 },
  uShards: { value: null },
  uHero: { value: still ? 99 : 0 }, // how many screens down the page we are (the wall reads this)
  uSeams: { value: 0 },
  uWall: { value: new THREE.Vector4(0.1, WALL_DISTANCE, 18, 12) }, // tile size, distance, columns, rows
  uBlocks: { value: new THREE.Vector2(3, 2) }, // how the cube's six faces are laid out on the wall
  uView: { value: new THREE.Vector2(1, 1) }, // half the view's width and height at the wall
  uWallColor: { value: WALL_COLOR }
};
const brain = new THREE.Group();
stage.add(brain);
let ready = false;

function seeded(n) { const x = Math.sin(n * 91.7) * 43758.5; return x - Math.floor(x); }

const PUZZLE_SPACE = `
  const float PN = ${PUZZLE_N.toFixed(1)};
  vec3 puzzleSpace(vec3 p) { return vec3(p.x * ${PUZZLE_SCALE[0].toFixed(5)}, (p.y + ${PUZZLE_SHIFT_Y.toFixed(3)}) * ${PUZZLE_SCALE[1].toFixed(5)}, p.z); }
`;

// Which jigsaw piece a point on the brain belongs to (must match puzzleCell in mesh.js), and how
// far it is from the piece's outline. Each cube face is a PN × PN grid; every inner edge has one
// round tab, owned by the piece on one side (chosen by a hash), poking into the other.
const PUZZLE_GLSL = `
  float edgeHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float pieceAt(vec3 p, out float seam) {
    vec3 q = puzzleSpace(p);
    vec3 a = abs(q);
    float face; vec2 uv;
    if (a.x >= a.y && a.x >= a.z) { face = q.x > 0.0 ? 0.0 : 1.0; uv = vec2(q.x > 0.0 ? -q.z : q.z, q.y) / a.x; }
    else if (a.y >= a.z) { face = q.y > 0.0 ? 2.0 : 3.0; uv = vec2(q.x, q.y > 0.0 ? -q.z : q.z) / a.y; }
    else { face = q.z > 0.0 ? 4.0 : 5.0; uv = vec2(q.z > 0.0 ? q.x : -q.x, q.y) / a.z; }
    vec2 st = clamp((uv + 1.0) * 0.5 * PN, 0.0, PN - 1e-4);
    vec2 cell = floor(st), f = st - cell, piece = cell;
    const float R = 0.18, C = 0.14, NECK = 0.11; // tab radius, how far its centre sits past the edge, half its neck
    seam = 9.0;
    bool tab; float d;
    if (cell.x < PN - 1.0) { // right edge: tab owned by this piece (true) or the one on the right
      tab = edgeHash(vec3(face, cell.x + 1.0, cell.y)) < 0.5;
      d = length(f - vec2(tab ? 1.0 + C : 1.0 - C, 0.5));
      if (!tab) { if (d < R) piece.x += 1.0; seam = min(seam, abs(d - R)); }
    }
    if (cell.x > 0.0) { // left edge: tab owned by the piece on the left (true) or this one
      tab = edgeHash(vec3(face, cell.x, cell.y)) < 0.5;
      d = length(f - vec2(tab ? C : -C, 0.5));
      if (tab) { if (d < R) piece.x -= 1.0; seam = min(seam, abs(d - R)); }
    }
    if (cell.y < PN - 1.0) { // top edge
      tab = edgeHash(vec3(face + 10.0, cell.x, cell.y + 1.0)) < 0.5;
      d = length(f - vec2(0.5, tab ? 1.0 + C : 1.0 - C));
      if (!tab) { if (d < R) piece.y += 1.0; seam = min(seam, abs(d - R)); }
    }
    if (cell.y > 0.0) { // bottom edge
      tab = edgeHash(vec3(face + 10.0, cell.x, cell.y)) < 0.5;
      d = length(f - vec2(0.5, tab ? C : -C));
      if (tab) { if (d < R) piece.y -= 1.0; seam = min(seam, abs(d - R)); }
    }
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

function addMesh(m) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  geo.setAttribute('aShard', new THREE.BufferAttribute(m.shard, 1));
  geo.setAttribute('aAO', new THREE.BufferAttribute(m.ao, 1));
  geo.setIndex(new THREE.BufferAttribute(m.index, 1));

  // Per piece, 3 texels: [centre, delay] [loose position, turn] [turn axis, when it leaves the wall].
  const W = 3;
  const data = new Float32Array(m.shards * W * 4);
  for (let s = 0; s < m.shards; s++) {
    const cx = m.centre[s * 3], cy = m.centre[s * 3 + 1], cz = m.centre[s * 3 + 2];
    const ox = m.out[s * 3], oy = m.out[s * 3 + 1], oz = m.out[s * 3 + 2];
    // Loose pieces float close to their place, so the cloud already reads as a brain in pieces.
    const dist = 0.3 + 0.6 * seeded(s + 1);
    const swirl = (Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2);
    const ax = seeded(s + 5) - 0.5, ay = seeded(s + 6) - 0.5, az = seeded(s + 7) - 0.5;
    const al = Math.hypot(ax, ay, az) || 1;
    data.set([
      cx, cy, cz, (0.65 * swirl + 0.35 * seeded(s + 9)) * SPREAD,
      cx + ox * dist + (seeded(s + 2) - 0.5) * 0.3, cy + oy * dist + (seeded(s + 3) - 0.5) * 0.3, cz + oz * dist + (seeded(s + 4) - 0.5) * 0.3,
      (0.5 + 1.3 * seeded(s + 8)) * (seeded(s + 10) < 0.5 ? -1 : 1),
      ax / al, ay / al, az / al, seeded(s + 11)
    ], s * W * 4);
  }
  const tex = new THREE.DataTexture(data, W, m.shards, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  uniforms.uShards.value = tex;

  const material = new THREE.MeshPhysicalMaterial({
    color: '#eba38e',
    roughness: 0.46,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.32,
    sheen: 0.6,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color('#ffc9b8'),
    envMapIntensity: 0.55,
    side: THREE.DoubleSide
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float aShard; attribute float aAO;
      uniform float uAssemble; uniform float uTime; uniform sampler2D uShards;
      uniform float uHero; uniform vec4 uWall; uniform vec2 uBlocks; uniform vec2 uView;
      varying float vLoose; varying float vSnap; varying vec3 vRest; varying float vShard; varying float vAO; varying float vWall;
      vec3 rotAxis(vec3 v, vec3 axis, float a) { float c = cos(a), s = sin(a); return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c); }
      ${PUZZLE_SPACE}
      ${FACE_GLSL}
      ` + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `
        int row = int(aShard + 0.5);
        vec4 sA = texelFetch(uShards, ivec2(0, row), 0);
        vec4 sB = texelFetch(uShards, ivec2(1, row), 0);
        vec4 sC = texelFetch(uShards, ivec2(2, row), 0);
        // How settled this piece is in the brain: 0 = loose, 1 = in place.
        float k = clamp(uAssemble * (1.0 + ${SPREAD.toFixed(2)}) - sA.w, 0.0, 1.0);
        vSnap = smoothstep(0.72, 0.96, k) * (1.0 - smoothstep(0.96, 1.0, k)); // flash as it clicks in
        k = k * k * (3.0 - 2.0 * k);
        float turn = (sB.w + uTime * 0.2 * sign(sB.w)) * (1.0 - k);
        vec3 objectNormal = rotAxis(normal, sC.xyz, turn);
        vLoose = 1.0 - k;
        vRest = position;
        vShard = aShard;
        vAO = aAO;

        // The opening wall: each cube face is a block of PN x PN pieces, the blocks side by side.
        float face = floor(aShard / (PN * PN) + 0.01);
        float cell = aShard - face * PN * PN;
        vec2 block = vec2(mod(face, uBlocks.x), floor(face / uBlocks.x + 0.01));
        vec2 grid = uWall.zw;
        vec2 wallXY = (block * PN + faceGrid(position, face) - grid * 0.5) * uWall.x;
        vec2 pieceXY = (block * PN + vec2(mod(cell, PN), floor(cell / PN + 0.01)) + 0.5 - grid * 0.5) * uWall.x;
        // Pieces leave from the bottom of the screen up, just ahead of the next section's text.
        float fromTop = 0.5 - pieceXY.y / (2.0 * uView.y);
        float leave = max(0.035, 0.7 - fromTop + 0.14 * sC.w);
        float w = 1.0 - smoothstep(leave, leave + 0.24, uHero); // 1 = still in the wall
        vWall = w;
        float lift = 1.0 - w;
        lift = lift * lift * (3.0 - 2.0 * lift);`)
      .replace('#include <normal_vertex>', `#include <normal_vertex>
        vNormal = normalize(mix(vNormal, vec3(0.0, 0.0, 1.0), 1.0 - lift));`)
      .replace('#include <begin_vertex>', `
        vec3 local = (position - sA.xyz) * mix(0.92, 1.0, k); // small gaps between loose pieces
        vec3 transformed = mix(sB.xyz, sA.xyz, k) + rotAxis(local, sC.xyz, turn);`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        if (w > 0.0) {
          // Outer layers sit a hair in front of inner ones, so the wall draws cleanly.
          vec3 onWall = vec3(wallXY, -uWall.y + 0.02 * length(puzzleSpace(position)));
          // Lift toward the viewer as it lets go, then fly back to its place in the brain.
          vec3 arc = vec3(0.0, 0.0, 0.7) * sin(3.14159 * lift);
          mvPosition = vec4(mix(onWall, mvPosition.xyz, lift) + arc, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }`);
    shader.fragmentShader = `varying float vLoose; varying float vSnap; varying vec3 vRest; varying float vShard; varying float vAO; varying float vWall;
      uniform float uSeams; uniform vec3 uWallColor;
      ${PUZZLE_SPACE}
      ${PUZZLE_GLSL}
      ${FACE_GLSL}
      ` + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        // Keep only the part of this copy that is really inside its piece: exact jigsaw outlines.
        float inWall = smoothstep(0.9, 1.0, vWall); // still part of the flat wall
        float seam;
        float piece = pieceAt(vRest, seam);
        float seamWidth = 0.025 + fwidth(seam) * 1.5;
        if (abs(piece - vShard) > 0.5) {
          // In the wall, a piece on the edge of its cube face may reach a hair past it, so the six
          // blocks of the wall meet without hairline cracks.
          float face = floor(vShard / (PN * PN) + 0.01);
          vec2 g = abs(faceGrid(vRest, face) - PN * 0.5);
          if (inWall < 0.999 || floor(piece / (PN * PN) + 0.01) == face || max(g.x, g.y) > PN * 0.5 + 0.06) discard;
          seam = 9.0;
        }
        float line = 1.0 - smoothstep(0.0, seamWidth, seam);
        // A piece sitting in the wall is just its plain colour, with the seams drawn in once they
        // show: skip the lighting, since the wall covers the whole screen.
        if (inWall > 0.999) { gl_FragColor = vec4(uWallColor * (1.0 - 0.3 * line * uSeams), 1.0); return; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (!gl_FrontFacing) diffuseColor.rgb *= 0.4; // the inside of a piece is darker
        diffuseColor.rgb *= mix(vec3(0.46, 0.2, 0.2), vec3(1.0), vAO); // deep, rosy grooves
        diffuseColor.rgb *= 1.0 - 0.45 * line * vLoose; // seams show only while a piece is loose`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // A soft glow at the edges, as light passes through the surface (subsurface scattering).
        float facing = max(dot(normal, normalize(vViewPosition)), 0.0);
        totalEmissiveRadiance += vec3(0.75, 0.24, 0.2) * pow(1.0 - facing, 3.0) * 0.22 * vAO;
        // Blue edges while the pieces are loose, a flash as each one locks into place, then nothing.
        vec3 glow = vec3(0.3, 0.78, 1.0);
        totalEmissiveRadiance += (glow * line * (2.2 * vLoose + 2.5 * vSnap) + glow * 0.35 * vSnap) * (1.0 - inWall);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= vAO;
        reflectedLight.indirectSpecular *= mix(0.15, 1.0, vAO);
        reflectedLight.directSpecular *= mix(0.25, 1.0, vAO);`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        // Pieces still in the wall are its plain colour, with the seams drawn in once they show.
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uWallColor * (1.0 - 0.3 * line * uSeams), inWall);`);
  };
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false; // pieces move in the shader, so the box three.js knows about is wrong
  brain.add(mesh);
  ready = true;
  document.body.classList.add('brain-ready');
}

function build() {
  const step = lowPower ? 0.023 : 0.017;
  try {
    const worker = new Worker(new URL('./build-worker.js?v=6', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { addMesh(e.data); worker.terminate(); };
    worker.onerror = () => { worker.terminate(); buildHere(step); };
    worker.postMessage({ step });
  } catch (_) {
    buildHere(step);
  }
}
// Browsers without module workers: build on the page instead (a short pause while it loads).
function buildHere(step) {
  import('./mesh.js').then(({ buildBrainMesh }) => addMesh(buildBrainMesh({ step }))).catch((error) => {
    console.error(error);
    window.brainFallback && window.brainFallback();
  });
}
build();

/* ---------- scroll + frame ---------- */

let width = 0, height = 0, maxScroll = 1;
// Wide screens: where the finished brain sits, in the space right of the text column.
const place = { distance: 6.2, x: 1 };
const BRAIN_LENGTH = 2.2, BRAIN_HEIGHT = 1.75; // its size on screen, side on (shape.js)
function measure() {
  maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
}
// Phones change the window height as the address bar shows and hides while scrolling;
// resizing the canvas for that would stutter, so small height changes are ignored.
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === width && Math.abs(h - height) < 140) return;
  width = w;
  height = h;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  // Lay the wall out to cover the whole screen: the cube's six faces as 3 x 2 blocks of pieces on
  // wide screens, 2 x 3 on tall ones.
  const halfH = WALL_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfW = halfH * camera.aspect;
  const tall = camera.aspect < 1;
  const cols = (tall ? 2 : 3) * PUZZLE_N, rows = (tall ? 3 : 2) * PUZZLE_N;
  uniforms.uBlocks.value.set(tall ? 2 : 3, tall ? 3 : 2);
  uniforms.uWall.value.set(Math.max((2 * halfW) / cols, (2 * halfH) / rows), WALL_DISTANCE, cols, rows);
  uniforms.uView.value.set(halfW, halfH);

  // Size the brain to the free space right of the text (at most 40% of the screen's width and 70%
  // of its height), with the camera looking straight ahead, and centre it in that space.
  const copy = document.querySelector('.hero .copy');
  const textRight = copy ? copy.getBoundingClientRect().right / width : 0.5;
  const free = Math.max(0.3, 1 - textRight);
  const share = Math.min(0.4, free * 0.8);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  place.distance = Math.max(BRAIN_LENGTH / (share * 2 * tanHalf * camera.aspect), BRAIN_HEIGHT / (0.7 * 2 * tanHalf));
  place.x = (1 - free * 0.54 - 0.5) * 2 * place.distance * tanHalf * camera.aspect;
}

// How assembled the brain is (0 = every piece loose, 1 = whole) at scroll position p (0 to 1):
// it starts building as the first pieces leave the wall and is whole at the very bottom.
function assembleAt(p) {
  return smooth(0.04, 0.94, p);
}

const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
let smoothP = 0, smoothHero = 0;
let lastTime = performance.now();
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
  const assemble = still ? 1 : assembleAt(smoothP);
  const loose = 1 - assemble;
  if (ready) appear = Math.min(1, appear + dt * 0.9);
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
  dust.material.uniforms.uOpacity.value = 0.55 * appear * (1 - wall);
  dust.material.uniforms.uSize.value = 22 * pixelRatio;
  // The dark edge shading only makes sense once the wall has (nearly) gone: on the wall it would
  // just muddy the colour behind the headline.
  const shown = Math.round(smooth(0.5, 1, 1 - wall) * 50) / 50;
  if (shown !== vignetteShown && vignette) { vignette.style.opacity = String(shown); vignetteShown = shown; }

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
