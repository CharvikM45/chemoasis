/*
 * Home page brain, made of flat tiles and lit from above in the dark.
 * Scroll story: whole at the top, it bursts apart on the first scroll, then the tiles drift back
 * into place as you read down the page, until it is whole again at the bottom.
 * All tile motion runs on the GPU (one draw call); the page only updates a few numbers per frame.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildTiles } from './tiles.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.querySelector('#brain');
if (window.__brainFallen) throw new Error('No 3D on this device.');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  window.brainFallback && window.brainFallback();
  throw error;
}
window.__brainStarted = true;

let pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#060507');
scene.fog = new THREE.FogExp2('#060507', 0.06);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);

// Everything that moves with the brain (it sits right of the text on wide screens).
const stage = new THREE.Group();
scene.add(stage);

/* ---------- light: one warm beam from above, cold rim behind, a little red below ---------- */

scene.add(new THREE.HemisphereLight('#3a4560', '#1a0b07', 0.55));
const key = new THREE.SpotLight('#fff7ef', 40, 12, 0.5, 0.85, 2);
key.position.set(0.35, 3.9, 0.7);
key.target.position.set(0, -0.1, 0);
stage.add(key, key.target);
const rimCool = new THREE.DirectionalLight('#6f9bff', 1.6);
rimCool.position.set(-2.6, 1.3, -3);
const rimWarm = new THREE.DirectionalLight('#ff8a5c', 0.3);
rimWarm.position.set(2.7, 0.4, -2.3);
const front = new THREE.DirectionalLight('#fff1e8', 0.9);
front.position.set(0.6, 0.3, 3);
const under = new THREE.PointLight('#8e2418', 2.2, 6, 2);
under.position.set(0, -1.7, 1.3);
scene.add(rimCool, rimWarm, front);
stage.add(under);

// Faint glow far behind, so the dark has depth.
const backGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 10),
  new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color('#3b1c12') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; varying vec2 vUv; void main(){ float d = distance(vUv, vec2(0.5, 0.56)); gl_FragColor = vec4(uColor * smoothstep(0.5, 0.0, d), 1.0); }'
  })
);
backGlow.position.set(0, 0.2, -6);
stage.add(backGlow);

// The visible beam: an open cone, brightest near the lamp.
const beam = new THREE.Mesh(
  new THREE.ConeGeometry(1.75, 4.6, 64, 1, true),
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color('#ffcf9e') }, uStrength: { value: 0 } },
    vertexShader: `varying float vH; varying float vFacing;
      void main(){
        vH = position.y / 4.6 + 0.5;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying float vH; varying float vFacing;
      void main(){
        float a = pow(vH, 1.7) * pow(vFacing, 2.0) * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }`
  })
);
beam.position.set(0.35, 3.9 - 2.3, 0.7);
stage.add(beam);

// Dust drifting in the beam. Moved in the vertex shader, so it costs nothing per frame.
const DUST = 420;
const dustPos = new Float32Array(DUST * 3);
const dustSeed = new Float32Array(DUST);
for (let i = 0; i < DUST; i++) {
  const r = Math.sqrt(Math.random()) * 1.5, a = Math.random() * Math.PI * 2;
  dustPos[i * 3] = 0.35 + Math.cos(a) * r;
  dustPos[i * 3 + 1] = Math.random() * 4.4;
  dustPos[i * 3 + 2] = 0.7 + Math.sin(a) * r;
  dustSeed[i] = Math.random() * 100;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
dustGeo.setAttribute('seed', new THREE.BufferAttribute(dustSeed, 1));
const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uSize: { value: 30 } },
  vertexShader: `attribute float seed; uniform float uTime; uniform float uSize;
    void main(){
      vec3 p = position;
      p.y = mod(p.y + uTime * (0.04 + 0.03 * sin(seed)), 4.4) - 1.0;
      p.x += 0.12 * sin(uTime * 0.3 + seed);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = uSize / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `uniform float uOpacity;
    void main(){
      float d = length(gl_PointCoord - 0.5);
      gl_FragColor = vec4(1.0, 0.85, 0.71, smoothstep(0.5, 0.0, d) * uOpacity);
    }`
}));
stage.add(dust);

/* ---------- the tiles ---------- */

// 0 frontal, 1 parietal, 2 temporal, 3 occipital, 4 cerebellum, 5 brainstem
const PALETTE = ['#ec9f74', '#ecd9c0', '#c9787a', '#7f9dc0', '#a993d6', '#f2e6d4'].map((c) => new THREE.Color(c));
const GROOVE = new THREE.Color('#3a1a1f');
const ORDER = [5, 4, 3, 2, 1, 0]; // assembly order: brainstem first, frontal lobe last
const SPREAD = 1.2; // how staggered the tiles are, in units of the whole assembly

const uniforms = { uAssemble: { value: 1 }, uTime: { value: 0 } };
const tiles = buildTiles();
const brain = buildMesh(tiles);
stage.add(brain);

function seeded(n) { const x = Math.sin(n * 91.7) * 43758.5; return x - Math.floor(x); }

function buildMesh({ count, home, normal, region, groove, spacing }) {
  const box = new THREE.BoxGeometry(1, 1, 0.22);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = box.index;
  geo.setAttribute('position', box.getAttribute('position'));
  geo.setAttribute('normal', box.getAttribute('normal'));
  geo.instanceCount = count;

  const scatter = new Float32Array(count * 3);
  const spin = new Float32Array(count * 4);
  const delay = new Float32Array(count);
  const color = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const x = home[i * 3], y = home[i * 3 + 1], z = home[i * 3 + 2];
    // Fly outward from the middle, plus some sideways drift.
    const len = Math.hypot(x, y + 0.05, z) || 1;
    const out = 0.5 + 1.3 * seeded(i + 1);
    scatter[i * 3] = x + (x / len) * out + (seeded(i + 2) - 0.5) * 0.6;
    scatter[i * 3 + 1] = y + ((y + 0.05) / len) * out + (seeded(i + 3) - 0.5) * 0.6;
    scatter[i * 3 + 2] = z + (z / len) * out + (seeded(i + 4) - 0.5) * 0.6;
    const ax = seeded(i + 5) - 0.5, ay = seeded(i + 6) - 0.5, az = seeded(i + 7) - 0.5;
    const al = Math.hypot(ax, ay, az) || 1;
    spin.set([ax / al, ay / al, az / al, (1.5 + 3 * seeded(i + 8)) * (seeded(i + 9) < 0.5 ? -1 : 1)], i * 4);
    delay[i] = (ORDER.indexOf(region[i]) / ORDER.length) * 0.75 * SPREAD + seeded(i + 10) * 0.25 * SPREAD;
    c.copy(PALETTE[region[i]]).multiplyScalar(0.84 + 0.26 * seeded(i + 11));
    if (groove[i]) c.lerp(GROOVE, 0.82);
    color.set([c.r, c.g, c.b], i * 3);
    size[i] = spacing * (groove[i] ? 0.74 : 0.8 + 0.05 * seeded(i + 12));
  }
  const inst = (array, n) => new THREE.InstancedBufferAttribute(array, n);
  geo.setAttribute('aHome', inst(home, 3));
  geo.setAttribute('aNormal', inst(normal, 3));
  geo.setAttribute('aScatter', inst(scatter, 3));
  geo.setAttribute('aSpin', inst(spin, 4));
  geo.setAttribute('aDelay', inst(delay, 1));
  geo.setAttribute('aColor', inst(color, 3));
  geo.setAttribute('aSize', inst(size, 1));

  const material = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute vec3 aHome; attribute vec3 aNormal; attribute vec3 aScatter; attribute vec4 aSpin;
      attribute float aDelay; attribute vec3 aColor; attribute float aSize;
      uniform float uAssemble; uniform float uTime;
      varying vec3 vTileColor; varying float vLoose;
      vec3 rotAxis(vec3 v, vec3 axis, float a) { float c = cos(a), s = sin(a); return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c); }
      ` + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `
        // How settled this tile is: 0 = flying loose, 1 = in place on the brain.
        float k = clamp(uAssemble * (1.0 + ${SPREAD.toFixed(2)}) - aDelay, 0.0, 1.0);
        k = k * k * (3.0 - 2.0 * k);
        vec3 tn = normalize(aNormal);
        vec3 up = abs(tn.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 tx = normalize(cross(up, tn));
        vec3 ty = cross(tn, tx);
        float turn = aSpin.w * (1.0 - k) + (1.0 - k) * uTime * 0.25 * sign(aSpin.w);
        vec3 objectNormal = rotAxis(tx * normal.x + ty * normal.y + tn * normal.z, aSpin.xyz, turn);
        vTileColor = aColor;
        vLoose = 1.0 - k;`)
      .replace('#include <begin_vertex>', `
        vec3 local = position * aSize;
        vec3 drift = (1.0 - k) * 0.06 * vec3(sin(uTime * 0.5 + aDelay * 40.0), cos(uTime * 0.4 + aDelay * 31.0), sin(uTime * 0.3 + aDelay * 17.0));
        vec3 transformed = mix(aScatter, aHome, k) + drift + rotAxis(tx * local.x + ty * local.y + tn * local.z, aSpin.xyz, turn);`);
    shader.fragmentShader = 'varying vec3 vTileColor; varying float vLoose;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vTileColor;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vTileColor * (0.05 + 0.18 * vLoose);');
  };
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false; // tiles move in the shader, so the box three.js knows about is wrong
  return mesh;
}

/* ---------- post-processing ---------- */

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- scroll + frame ---------- */

let width = 0, height = 0;
function resize() {
  width = innerWidth;
  height = innerHeight;
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  bloom.resolution.set(width / 3, height / 3);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

// 0 at the top of the page, 1 at the bottom.
function progress() {
  const max = document.documentElement.scrollHeight - innerHeight;
  return max > 0 ? clamp(scrollY / max, 0, 1) : 0;
}
// Whole at the top, apart after the first screen, whole again at the very bottom.
function assembleAt(p) {
  if (p < 0.08) return 1 - smooth(0, 0.08, p);
  return smooth(0.12, 0.97, p);
}

const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
let smoothP = progress();
let lastTime = performance.now();
let appear = 0;
let slowFrames = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const t = reducedMotion ? 0 : now / 1000;

  // Drop the resolution, then the glow, on devices that can't keep up.
  slowFrames = dt > 0.028 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
  if (slowFrames > 45) {
    slowFrames = 0;
    if (pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); resize(); }
    else if (bloom.enabled) bloom.enabled = false;
  }

  const p = progress();
  smoothP += (p - smoothP) * (reducedMotion ? 1 : Math.min(1, dt * 6));
  const assemble = assembleAt(smoothP);
  const loose = 1 - assemble;
  appear = Math.min(1, appear + dt * 0.8);
  pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
  pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);

  uniforms.uAssemble.value = assemble;
  uniforms.uTime.value = t;
  dust.material.uniforms.uTime.value = t;
  dust.material.uniforms.uOpacity.value = 0.5 * appear;
  dust.material.uniforms.uSize.value = 30 * pixelRatio;
  beam.material.uniforms.uStrength.value = lerp(0.07, 0.12, assemble) * appear;
  key.intensity = lerp(22, 40, assemble) * appear;

  // Wide screens: the brain sits right of the text. Narrow: centred behind it.
  const wide = width >= 900;
  stage.position.x = wide ? lerp(1.3, 1.1, loose) : 0;
  stage.position.y = wide ? 0 : 0.62; // phones: above the hero text
  camera.position.set(pointer.x * 0.25, 0.2 + pointer.y * 0.12, lerp(6.0, 8.0, loose) + (wide ? 0 : 2.4));
  camera.lookAt(wide ? 0.45 : 0, -0.08, 0);

  const idle = reducedMotion ? 0 : Math.sin(t * 0.18) * 0.14;
  brain.rotation.set(0.06, -Math.PI / 2 + 0.42 + idle + smoothP * Math.PI * 0.9, 0);
  brain.position.y = reducedMotion ? 0 : Math.sin(t * 0.5) * 0.015;

  canvas.style.opacity = String(appear);
  composer.render();
}

addEventListener('resize', resize);
addEventListener('pointermove', (e) => {
  if (reducedMotion) return;
  pointer.tx = e.clientX / innerWidth - 0.5;
  pointer.ty = -(e.clientY / innerHeight - 0.5);
}, { passive: true });

resize();
document.body.classList.add('brain-ready');
requestAnimationFrame(frame);
