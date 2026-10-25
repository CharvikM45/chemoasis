/*
 * Home page brain: a soft, glossy brain made of small jigsaw pieces.
 * Scroll story ("your way back"): the page opens on the brain's pieces drifting in a slow storm
 * around where the brain should be. In each section one piece leaves the storm, comes forward and
 * turns to face you, with a short line about that section beside it (the section's data-quote),
 * then goes back. In the last section the pieces click together into the whole brain. Once a
 * piece is in place its seam fades away, so the finished brain reads as one thing.
 * With reduced motion the brain is shown whole and still, with no quotes.
 * The mesh is built in a worker (build-worker.js), a rough one first so the brain shows at once,
 * and all piece motion runs on the GPU, so the page only updates a few numbers per frame.
 */
import * as THREE from 'three';
import { PUZZLE_N, PUZZLE_SCALE, PUZZLE_SHIFT_Y, puzzleCell } from './mesh.js';

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
  // The piece that comes forward for the current section: its number, how far out it is (0 to 1),
  // where it goes (in front of the camera, in view space) and how much bigger it gets there.
  uFeature: { value: -1 },
  uFeatureT: { value: 0 },
  uFeaturePos: { value: new THREE.Vector3(0, 0, -4) },
  uFeatureScale: { value: 4 },
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
let featured = []; // the clean pieces that can come forward: [right side, left side], best first

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

  // Per piece, 5 texels: [centre, delay] [loose position, turn] [turn axis, swirl speed]
  // [outward direction, unused] [the piece's "up" on its cube face, unused].
  const W = 5;
  const UP = [[0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]]; // per face, as in puzzleCell
  const data = new Float32Array(m.shards * W * 4);
  for (let s = 0; s < m.shards; s++) {
    const cx = m.centre[s * 3], cy = m.centre[s * 3 + 1], cz = m.centre[s * 3 + 2];
    const ox = m.out[s * 3], oy = m.out[s * 3 + 1], oz = m.out[s * 3 + 2];
    // Loose pieces drift in a loose shell around the brain, so the storm keeps its shape.
    const dist = 0.2 + 0.45 * seeded(s + 1);
    const swirl = (Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2);
    const ax = seeded(s + 5) - 0.5, ay = seeded(s + 6) - 0.5, az = seeded(s + 7) - 0.5;
    const al = Math.hypot(ax, ay, az) || 1;
    data.set([
      cx, cy, cz, (0.65 * swirl + 0.35 * seeded(s + 9)) * SPREAD,
      cx + ox * dist + (seeded(s + 2) - 0.5) * 0.2, cy + oy * dist + (seeded(s + 3) - 0.5) * 0.2, cz + oz * dist + (seeded(s + 4) - 0.5) * 0.2,
      (0.2 + 0.5 * seeded(s + 8)) * (seeded(s + 10) < 0.5 ? -1 : 1),
      ax / al, ay / al, az / al, 0.6 + 0.8 * seeded(s + 12),
      ox, oy, oz, 0,
      ...UP[Math.floor(s / (PUZZLE_N * PUZZLE_N))], 0
    ], s * W * 4);
  }
  const tex = new THREE.DataTexture(data, W, m.shards, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  if (uniforms.uShards.value) uniforms.uShards.value.dispose();
  uniforms.uShards.value = tex;
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
      uniform float uAssemble; uniform float uTime; uniform sampler2D uShards; uniform float uIntro;
      uniform float uFeature; uniform float uFeatureT; uniform vec3 uFeaturePos; uniform float uFeatureScale;
      varying float vLoose; varying float vSnap; varying vec3 vRest; varying float vShard; varying float vAO; varying float vFeature;
      varying float vDim;
      vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
      vec3 rotAxis(vec3 v, vec3 axis, float a) { float c = cos(a), s = sin(a); return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c); }
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
        // Loose pieces tumble gently and circle the brain, each at its own slow pace.
        float turn = (sB.w + sin(uTime * 0.35 + sA.w * 20.0) * 0.25) * (1.0 - k);
        float swirl = uTime * 0.05 * sC.w;
        vec3 objectNormal = rotAxis(normal, sC.xyz, turn);
        objectNormal = normalize(mix(rotY(objectNormal, swirl), objectNormal, k));
        // The featured piece: 0 = in the storm, 1 = in front, facing the viewer.
        float feature = abs(aShard - uFeature) < 0.5 ? uFeatureT : 0.0;
        feature = feature * feature * feature * (feature * (feature * 6.0 - 15.0) + 10.0); // eased in and out
        vFeature = feature;
        vDim = uFeatureT * (1.0 - step(0.001, feature)) * (1.0 - k); // the rest of the storm steps back
        vLoose = 1.0 - k;
        vRest = position;
        vShard = aShard;
        vAO = mix(aAO, 1.0, 0.45 * feature); // softer grooves up close, so the words read cleanly`)
      .replace('#include <begin_vertex>', `
        // On first load the loose pieces gather in from a little further out.
        float gather = 1.0 - uIntro;
        vec3 loosePos = rotY(sA.xyz + (sB.xyz - sA.xyz) * (1.0 + 1.5 * gather * gather), swirl);
        vec3 local = (position - sA.xyz) * mix(0.94, 1.0, k); // small gaps between loose pieces
        vec3 transformed = mix(loosePos + rotY(rotAxis(local, sC.xyz, turn), swirl), sA.xyz + local, k);`)
      .replace('#include <normal_vertex>', `#include <normal_vertex>
        // The featured piece turns so its outer side faces the viewer and its "up" points up, so it
        // sits level like a piece held up to show you, and is pressed a little flatter. Built in view
        // space, so it doesn't matter how the brain is turned.
        vec3 faceDir = vec3(0.0, 1.0, 0.0);
        float faceTurn = 0.0, roll = 0.0;
        const float FLAT = 0.35; // how deep the piece stays, up close
        if (feature > 0.0) {
          vec3 n = normalize(normalMatrix * sD.xyz);
          vec3 axis = cross(n, vec3(0.0, 0.0, 1.0));
          float len = length(axis);
          if (len > 1e-4) faceDir = axis / len;
          faceTurn = atan(len, n.z);
          vec3 up = rotAxis(normalize(normalMatrix * sE.xyz), faceDir, faceTurn);
          roll = atan(up.x, up.y);
          vec3 shown = rotAxis(rotAxis(normalize(normalMatrix * normal), faceDir, faceTurn), vec3(0.0, 0.0, 1.0), roll);
          shown = normalize(vec3(shown.xy, shown.z / FLAT));
          vNormal = normalize(mix(vNormal, shown, feature));
        }`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        if (feature > 0.0) {
          vec3 localView = rotAxis(rotAxis(mat3(modelViewMatrix) * (position - sA.xyz), faceDir, faceTurn), vec3(0.0, 0.0, 1.0), roll);
          localView.z *= FLAT;
          vec3 front = uFeaturePos + localView * uFeatureScale;
          // It grows on the way rather than all at the end, along a gentle curve.
          vec3 stormMv = mvPosition.xyz;
          vec3 path = mix(stormMv, front, feature) + vec3(0.0, 0.15, 0.1) * sin(3.14159 * feature);
          mvPosition = vec4(path, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }`);
    shader.fragmentShader = `varying float vLoose; varying float vSnap; varying vec3 vRest; varying float vShard; varying float vAO; varying float vFeature; varying float vDim;
      uniform vec3 uFade; uniform float uMaskOnly;
      ${PUZZLE_SPACE}
      ${PUZZLE_GLSL}
      ` + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        // Keep only the part of this copy that is really inside its piece: exact jigsaw outlines.
        float seam;
        float piece = pieceAt(vRest, seam);
        if (abs(piece - vShard) > 0.5) discard;
        if (uMaskOnly > 0.5 && vFeature < 0.999) discard;
        float line = 1.0 - smoothstep(0.0, 0.03 + fwidth(seam) * 1.5, seam);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (!gl_FrontFacing) diffuseColor.rgb *= 0.4; // the inside of a piece is darker
        diffuseColor.rgb *= mix(vec3(0.46, 0.2, 0.2), vec3(1.0), vAO); // deep, rosy grooves
        diffuseColor.rgb *= 1.0 - 0.35 * line * vLoose * (1.0 - vFeature); // seams show only while a piece is loose
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.98, 0.84, 0.77), 0.28 * vFeature); // paler up close, behind the words`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // A soft glow at the edges, as light passes through the surface (subsurface scattering).
        float facing = max(dot(normal, normalize(vViewPosition)), 0.0);
        totalEmissiveRadiance += vec3(0.75, 0.24, 0.2) * pow(1.0 - facing, 3.0) * 0.22 * vAO;
        // Faint warm edges while the pieces are loose, a soft glow as each one clicks in, then nothing.
        // The featured piece gets a fine bright outline.
        vec3 glow = vec3(1.0, 0.62, 0.48);
        totalEmissiveRadiance += glow * (line * (0.25 * vLoose + 0.9 * vSnap + 0.6 * vFeature) + 0.12 * vSnap);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= vAO;
        reflectedLight.indirectSpecular *= mix(0.15, 1.0, vAO);
        reflectedLight.directSpecular *= mix(0.25, 1.0, vAO);`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        // Loose pieces fade into the background while they pass behind the text column or the top
        // bar, so the words stay easy to read.
        float hide = max(1.0 - smoothstep(uFade.x - uFade.z * 0.4, uFade.x + uFade.z, gl_FragCoord.x),
                         smoothstep(uFade.y - uFade.z * 0.3, uFade.y, gl_FragCoord.y));
        hide *= smoothstep(0.0, 0.25, vLoose) * (1.0 - vFeature);
        hide = max(hide, 0.6 * vDim);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.027, 0.024, 0.035), 0.9 * hide);`);
  };
  brainMesh = new THREE.Mesh(geo, material);
  brainMesh.frustumCulled = false; // pieces move in the shader, so the box three.js knows about is wrong
  brain.add(brainMesh);
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
  // Only points really in the piece count (the mesh also keeps copies around its tabs).
  for (let v = 0; v < m.shard.length; v++) {
    const s = m.shard[v];
    const x = m.position[v * 3], y = m.position[v * 3 + 1], z = m.position[v * 3 + 2];
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
// Sections with a quote (each gets a piece) and where the last section starts, in page pixels.
let sections = [], closingTop = 1e9;
function measure() {
  maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  sections = [...document.querySelectorAll('[data-quote]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + scrollY, height: r.height, quote: el.dataset.quote };
  });
  const closing = document.querySelector('.closing');
  closingTop = closing ? closing.getBoundingClientRect().top + scrollY : maxScroll;
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
// whole when the page opens, apart as you scroll on from the first screen, and back together as
// the last section scrolls in, whole at the very bottom.
function assembleAt(y) {
  const apart = smooth(innerHeight * 0.05, innerHeight * 0.65, y);
  const start = Math.min(closingTop - innerHeight * 0.7, maxScroll - 40);
  return Math.max(1 - apart, smooth(start, maxScroll - 10, y));
}

// The section's quote (its data-quote), set on the featured piece once it has come forward: sharp
// HTML text over the middle of the 3D piece. Decorative, so screen readers skip it.
const card = document.createElement('blockquote');
card.className = 'piece-quote';
card.setAttribute('aria-hidden', 'true');
document.body.appendChild(card);
let featIndex = -1, featT = 0;
let picks = []; // per section: { piece, fit }, chosen the first time it's needed
const stagePoint = new THREE.Vector3();
let fontsReady = false;
document.fonts.load('italic 500 20px "Playfair Display"').catch(() => {}).then(() => { fontsReady = true; picks = []; });

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
  const depth = camera.position.z * 0.55;
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
  const saved = { feature: uniforms.uFeature.value, t: uniforms.uFeatureT.value, background: scene.background };
  uniforms.uFeature.value = piece;
  uniforms.uFeatureT.value = 1;
  uniforms.uMaskOnly.value = 1;
  shell.visible = ring.visible = dust.visible = false;
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
  uniforms.uMaskOnly.value = 0;
  shell.visible = ring.visible = dust.visible = true;
  scene.background = saved.background;
  const grid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) grid[y * w + x] = pixels[((h - 1 - y) * w + x) * 4 + 3] > 200 ? 1 : 0;
  }
  return { grid, w, h, left: left / MASK, top: top / MASK };
}

// The biggest text box that fits inside the piece with a clear margin all round, and the largest
// type that fits that box: the grid is first shrunk by the margin (a pixel stays only if the whole
// square around it is piece), then the widest-area rectangle, no taller than it is wide, is found
// row by row. Returns the box (centre, size, font size, relative to the point the piece comes to),
// or null if the quote won't fit at a readable size.
const MARGIN = 18; // screen pixels kept clear between the words and the piece's edge
function fitQuote(piece, quote) {
  const at = placeFeature(piece);
  const { grid, w, h, left, top } = pieceMask(piece, at);
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
  let choice = null;
  for (const piece of options) {
    const fit = fitQuote(piece, sections[index].quote);
    if (fit && (!choice || fit.size > choice.fit.size)) choice = { piece, fit };
    if (fit && fit.size >= 19) break;
  }
  if (!choice && options.length) choice = { piece: options[0], fit: null }; // it still comes forward, without words
  picks[index] = choice;
  return choice;
}

// Which section's piece should be out at scroll position y, and how far (0 to 1): it comes out as
// the section scrolls in, stays while you read, and goes back before the next one.
function featureAt(y) {
  const middle = y + innerHeight * 0.5;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i], at = (middle - s.top) / s.height;
    if (at >= 0 && at < 1) return { index: i, amount: smooth(0.1, 0.28, at) * (1 - smooth(0.74, 0.92, at)) };
  }
  return { index: -1, amount: 0 };
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
  const y = smoothP * maxScroll;
  const assemble = still ? 1 : assembleAt(y);
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

  // One piece out at a time: the old one goes back into the storm before the next one leaves.
  const want = still || !featured.length ? { index: -1, amount: 0 } : featureAt(y);
  if (want.index !== featIndex) {
    featT = Math.max(0, featT - dt * 1.2);
    if (featT === 0) featIndex = want.index;
  } else {
    // Follow the scroll, but never faster than a calm pace either way.
    featT += clamp((want.amount * appear - featT) * Math.min(1, dt * 6), -dt * 1.2, dt * 0.8);
  }
  const pick = featIndex >= 0 && fontsReady && sections[featIndex] ? pickFor(featIndex) : null;
  uniforms.uFeature.value = pick ? pick.piece : -1;
  uniforms.uFeatureT.value = pick ? featT : 0;
  if (pick && pick.fit) {
    const at = placeFeature(pick.piece);
    const { fit } = pick;
    // The words appear once the piece has settled in front, and leave before it goes back.
    const shown = smooth(0.85, 1, featT);
    card.textContent = sections[featIndex].quote;
    card.style.opacity = String(shown);
    card.style.width = `${Math.floor(fit.w)}px`;
    card.style.height = `${Math.floor(fit.h)}px`;
    card.style.fontSize = `${fit.size}px`;
    card.style.transform = `translate(${(at.sx + fit.x).toFixed(1)}px, ${(at.sy + fit.y).toFixed(1)}px) translate(-50%, -50%)`;
  } else {
    if (pick) placeFeature(pick.piece);
    card.style.opacity = '0';
  }

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
