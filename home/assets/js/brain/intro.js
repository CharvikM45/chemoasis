/*
 * Home page brain: a soft, glossy brain made of small jigsaw pieces.
 * Scroll story ("your way back"): the brain is there from the first moment, its pieces drifting
 * just apart from each other. As you read down the page they click together, whole at the very
 * bottom. It only ever comes together, never bursts apart, which would be a heavy image for people
 * living with "chemo brain". Once a piece is in place its seam fades away, so the finished brain
 * reads as one thing.
 * With reduced motion the brain is shown whole and still.
 * The mesh is built in a worker (build-worker.js), a rough one first so the brain shows at once,
 * and all piece motion runs on the GPU, so the page only updates a few numbers per frame.
 */
import * as THREE from 'three';
import { PUZZLE_N, PUZZLE_SCALE, PUZZLE_SHIFT_Y } from './mesh.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.querySelector('#brain');
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
const uniforms = {
  uAssemble: { value: 1 },
  uTime: { value: 0 },
  uShards: { value: null },
  uIntro: { value: still ? 1 : 0 }, // 0 → 1 as the brain first fades in: the pieces gather from a little further out
  // Where pieces fade into the background, in canvas pixels: right edge of the text column, the
  // top bar's lower edge (counted from the bottom), and the width of the soft edge.
  uFade: { value: new THREE.Vector3(-1e5, 1e5, 60) }
};
const brain = new THREE.Group();
stage.add(brain);
let ready = false;
let material = null, brainMesh = null;

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

function addMesh(m) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  geo.setAttribute('aShard', new THREE.BufferAttribute(m.shard, 1));
  geo.setAttribute('aAO', new THREE.BufferAttribute(m.ao, 1));
  geo.setIndex(new THREE.BufferAttribute(m.index, 1));

  // Per piece, 3 texels: [centre, delay] [loose position, turn] [turn axis, unused].
  const W = 3;
  const data = new Float32Array(m.shards * W * 4);
  for (let s = 0; s < m.shards; s++) {
    const cx = m.centre[s * 3], cy = m.centre[s * 3 + 1], cz = m.centre[s * 3 + 2];
    const ox = m.out[s * 3], oy = m.out[s * 3 + 1], oz = m.out[s * 3 + 2];
    // Loose pieces float just off their place, so the cloud always reads as a brain.
    const dist = 0.025 + 0.05 * seeded(s + 1);
    const swirl = (Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2);
    const ax = seeded(s + 5) - 0.5, ay = seeded(s + 6) - 0.5, az = seeded(s + 7) - 0.5;
    const al = Math.hypot(ax, ay, az) || 1;
    data.set([
      cx, cy, cz, (0.65 * swirl + 0.35 * seeded(s + 9)) * SPREAD,
      cx + ox * dist + (seeded(s + 2) - 0.5) * 0.015, cy + oy * dist + (seeded(s + 3) - 0.5) * 0.015, cz + oz * dist + (seeded(s + 4) - 0.5) * 0.015,
      (0.06 + 0.14 * seeded(s + 8)) * (seeded(s + 10) < 0.5 ? -1 : 1),
      ax / al, ay / al, az / al, 0
    ], s * W * 4);
  }
  const tex = new THREE.DataTexture(data, W, m.shards, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  if (uniforms.uShards.value) uniforms.uShards.value.dispose();
  uniforms.uShards.value = tex;

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
      uniform float uAssemble; uniform float uTime; uniform sampler2D uShards; uniform float uIntro;
      varying float vLoose; varying float vSnap; varying vec3 vRest; varying float vShard; varying float vAO;
      vec3 rotAxis(vec3 v, vec3 axis, float a) { float c = cos(a), s = sin(a); return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c); }
      ` + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `
        int row = int(aShard + 0.5);
        vec4 sA = texelFetch(uShards, ivec2(0, row), 0);
        vec4 sB = texelFetch(uShards, ivec2(1, row), 0);
        vec4 sC = texelFetch(uShards, ivec2(2, row), 0);
        // How settled this piece is in the brain: 0 = loose, 1 = in place.
        float k = clamp(uAssemble * (1.0 + ${SPREAD.toFixed(2)}) - sA.w, 0.0, 1.0);
        vSnap = smoothstep(0.72, 0.96, k) * (1.0 - smoothstep(0.96, 1.0, k)); // a soft glow as it clicks in
        k = k * k * (3.0 - 2.0 * k);
        float turn = (sB.w + sin(uTime * 0.5 + sA.w * 20.0) * 0.04) * (1.0 - k); // a slow sway while loose
        vec3 objectNormal = rotAxis(normal, sC.xyz, turn);
        vLoose = 1.0 - k;
        vRest = position;
        vShard = aShard;
        vAO = aAO;`)
      .replace('#include <begin_vertex>', `
        // On first load the loose pieces gather in from a little further out.
        float gather = 1.0 - uIntro;
        vec3 loosePos = sA.xyz + (sB.xyz - sA.xyz) * (1.0 + 8.0 * gather * gather);
        vec3 local = (position - sA.xyz) * mix(0.965, 1.0, k); // small gaps between loose pieces
        vec3 transformed = mix(loosePos, sA.xyz, k) + rotAxis(local, sC.xyz, turn);`);
    shader.fragmentShader = `varying float vLoose; varying float vSnap; varying vec3 vRest; varying float vShard; varying float vAO;
      uniform vec3 uFade;
      ${PUZZLE_SPACE}
      ${PUZZLE_GLSL}
      ` + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        // Keep only the part of this copy that is really inside its piece: exact jigsaw outlines.
        float seam;
        float piece = pieceAt(vRest, seam);
        if (abs(piece - vShard) > 0.5) discard;
        float line = 1.0 - smoothstep(0.0, 0.03 + fwidth(seam) * 1.5, seam);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (!gl_FrontFacing) diffuseColor.rgb *= 0.4; // the inside of a piece is darker
        diffuseColor.rgb *= mix(vec3(0.46, 0.2, 0.2), vec3(1.0), vAO); // deep, rosy grooves
        diffuseColor.rgb *= 1.0 - 0.35 * line * vLoose; // seams show only while a piece is loose`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // A soft glow at the edges, as light passes through the surface (subsurface scattering).
        float facing = max(dot(normal, normalize(vViewPosition)), 0.0);
        totalEmissiveRadiance += vec3(0.75, 0.24, 0.2) * pow(1.0 - facing, 3.0) * 0.22 * vAO;
        // Faint warm edges while the pieces are loose, a soft glow as each one clicks in, then nothing.
        vec3 glow = vec3(1.0, 0.62, 0.48);
        totalEmissiveRadiance += glow * (line * (0.35 * vLoose + 0.9 * vSnap) + 0.12 * vSnap);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= vAO;
        reflectedLight.indirectSpecular *= mix(0.15, 1.0, vAO);
        reflectedLight.directSpecular *= mix(0.25, 1.0, vAO);`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        // Loose pieces fade into the background while they pass behind the text column or the top
        // bar, so the words stay easy to read.
        float hide = max(1.0 - smoothstep(uFade.x - uFade.z * 0.4, uFade.x + uFade.z, gl_FragCoord.x),
                         smoothstep(uFade.y - uFade.z * 0.3, uFade.y, gl_FragCoord.y));
        hide *= smoothstep(0.0, 0.25, vLoose);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.027, 0.024, 0.035), 0.9 * hide);`);
  };
  brainMesh = new THREE.Mesh(geo, material);
  brainMesh.frustumCulled = false; // pieces move in the shader, so the box three.js knows about is wrong
  brain.add(brainMesh);
  ready = true;
  document.body.classList.add('brain-ready');
}

function build() {
  const step = lowPower ? 0.023 : 0.017;
  try {
    const worker = new Worker(new URL('./build-worker.js?v=7', import.meta.url), { type: 'module' });
    let got = 0;
    worker.onmessage = (e) => { addMesh(e.data); if (++got === 2) worker.terminate(); };
    worker.onerror = () => { worker.terminate(); if (!got) buildHere(step); };
    worker.postMessage({ step, preview: 0.04 });
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

// How assembled the brain is (0 = every piece loose, 1 = whole) at scroll position p (0 to 1):
// it is whole at the very bottom.
function assembleAt(p) {
  return smooth(0.02, 0.94, p);
}

const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
let smoothP = 0;
let lastTime = performance.now();
let appear = 0, intro = still ? 1 : 0;
let slowFrames = 0;

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
  const assemble = still ? 1 : assembleAt(smoothP);
  const loose = 1 - assemble;
  if (ready) {
    appear = Math.min(1, appear + dt * 2.5);
    intro = Math.min(1, intro + dt * 0.8);
  }
  pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
  pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);

  uniforms.uAssemble.value = assemble;
  uniforms.uTime.value = t;
  uniforms.uIntro.value = 1 - (1 - intro) ** 3;
  dust.material.uniforms.uOpacity.value = 0.55 * appear;
  dust.material.uniforms.uSize.value = 22 * pixelRatio;

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
  shell.material.opacity = 0.16 * appear;
  ring.material.opacity = 0.08 * appear;
  dust.rotation.y = t * 0.02 + smoothP * 0.6;

  canvas.style.opacity = String(appear);
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
requestAnimationFrame(frame);
