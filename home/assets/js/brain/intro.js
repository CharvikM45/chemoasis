/*
 * Home intro: a brain lit from above in the dark. Scrolling takes it apart into its main
 * parts, then each part dulls or brightens by how consistently brain-imaging research
 * links it to chemotherapy-related cognitive changes (duller = more often affected).
 * Falls back to the original mosaic (script.js) if WebGL or the 3D library isn't available.
 */
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildBrain, PARTS } from './geometry.js';
import { FOLDS_GLSL } from './folds.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = $('#brain');
const intro = $('#mosaic-intro');
const hero = $('.hero');
const nav = $('#nav');
const cue = $('#scrollCue');
const scrim = $('.content-scrim');

if (window.__brainFallen) throw new Error('Mosaic fallback already showing.');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  window.brainFallback && window.brainFallback();
  throw error;
}
window.__brainStarted = true;

renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#060507');
scene.fog = new THREE.FogExp2('#060507', 0.075);

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);

/* ---------- light: one warm beam from above, cold rim behind, a little red below ---------- */

scene.add(new THREE.HemisphereLight('#2b3650', '#1a0b07', 0.35));

const key = new THREE.SpotLight('#fff0e2', 70, 12, 0.42, 0.85, 2);
key.position.set(0.35, 3.9, 0.7);
key.target.position.set(0, -0.1, 0);
scene.add(key, key.target);

const rimCool = new THREE.DirectionalLight('#6f9bff', 1.7);
rimCool.position.set(-2.6, 1.3, -3);
const rimWarm = new THREE.DirectionalLight('#ff8a5c', 0.45);
rimWarm.position.set(2.7, 0.4, -2.3);
const front = new THREE.DirectionalLight('#ffe7da', 0.3);
front.position.set(0.6, 0.3, 3);
const under = new THREE.PointLight('#8e2418', 2.4, 6, 2);
under.position.set(0, -1.7, 1.3);
scene.add(rimCool, rimWarm, front, under);

// Faint glow far behind, so the dark has depth.
const backGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 10),
  new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color('#3b1c12') }, uAmount: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uAmount; varying vec2 vUv; void main(){ float d = distance(vUv, vec2(0.5, 0.56)); gl_FragColor = vec4(uColor * smoothstep(0.5, 0.0, d) * uAmount, 1.0); }'
  })
);
backGlow.position.set(0, 0.2, -6);
scene.add(backGlow);

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
scene.add(beam);

// Dust drifting in the beam.
const DUST = 420;
const dustPos = new Float32Array(DUST * 3);
const dustSeed = new Float32Array(DUST);
for (let i = 0; i < DUST; i++) {
  const r = Math.sqrt(Math.random()) * 1.5, a = Math.random() * Math.PI * 2;
  dustPos[i * 3] = 0.35 + Math.cos(a) * r;
  dustPos[i * 3 + 1] = -1 + Math.random() * 4.4;
  dustPos[i * 3 + 2] = 0.7 + Math.sin(a) * r;
  dustSeed[i] = Math.random() * 100;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dot = document.createElement('canvas');
dot.width = dot.height = 64;
const g = dot.getContext('2d');
const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
grad.addColorStop(0, 'rgba(255,230,200,1)');
grad.addColorStop(1, 'rgba(255,230,200,0)');
g.fillStyle = grad;
g.fillRect(0, 0, 64, 64);
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  size: 0.028, map: new THREE.CanvasTexture(dot), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffd9b5'
}));
scene.add(dust);

/* ---------- post-processing ---------- */

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.45, 0.6, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- brain ---------- */

const brain = new THREE.Group();
scene.add(brain);
let pieces = [];
let built = false;
let appear = 0;

// folds: 0 = cortex gyri, 1 = cerebellum folia, 2 = smooth.
function makeMaterial(part, folds) {
  const uniforms = {
    uDull: { value: 0 },
    uGlow: { value: 0 },
    uGlowColor: { value: new THREE.Color('#ffb98a') },
    uFolds: { value: folds },
    uBump: { value: 0.011 },
    uDisp: { value: folds === 1 ? 0.012 : 0.02 },
    uCut: { value: 0 }
  };
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.75,
    clearcoatRoughness: 0.22,
    sheen: 0.4,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#ffb3a6')
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // Push the mesh down into each sulcus too, so the outline has real relief.
    shader.vertexShader = `attribute vec3 brainPos; attribute float surf; varying vec3 vBrainPos; varying float vSurf;
      uniform float uFolds; uniform float uDisp;
      ${FOLDS_GLSL}
      ` + shader.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBrainPos = brainPos;
        vSurf = surf;
        if (uFolds < 1.5) {
          float vfs = uFolds < 0.5 ? foldS(brainPos) : foliaS(brainPos);
          float vdip = smoothstep(-0.1, 1.0, vfs);
          transformed -= objectNormal * (vdip * vdip * vdip) * uDisp * surf;
        }`);
    shader.fragmentShader = `uniform float uDull; uniform float uGlow; uniform vec3 uGlowColor; uniform float uFolds; uniform float uBump; uniform float uCut;
      varying vec3 vBrainPos; varying float vSurf;
      ${FOLDS_GLSL}
      vec3 perturbFolds(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
        vec3 sx = normalize(dFdx(surfPos));
        vec3 sy = normalize(dFdy(surfPos));
        vec3 r1 = cross(sy, surfNorm);
        vec3 r2 = cross(surfNorm, sx);
        float det = dot(sx, r1) * faceDir;
        vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
        return normalize(abs(det) * surfNorm - grad);
      }
      ` + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Fine folds: narrow dark sulci, plus faint surface vessels on the cortex.
        float foldMask = vSurf * step(uFolds, 1.5);
        // Sample the folds here and a step along the surface in two directions, for a smooth slope.
        vec3 dpx = dFdx(vBrainPos), dpy = dFdy(vBrainPos);
        float lx = length(dpx), ly = length(dpy);
        vec3 t1 = dpx / max(lx, 1e-6), t2 = dpy / max(ly, 1e-6);
        const float stepLen = 0.0015;
        float fs, fs1, fs2;
        if (uFolds < 0.5) {
          vec3 q = foldWarp(vBrainPos);
          fs = foldFromWarp(vBrainPos, q);
          fs1 = foldFromWarp(vBrainPos + stepLen * t1, q + stepLen * t1);
          fs2 = foldFromWarp(vBrainPos + stepLen * t2, q + stepLen * t2);
        } else {
          fs = foliaS(vBrainPos);
          fs1 = foliaS(vBrainPos + stepLen * t1);
          fs2 = foliaS(vBrainPos + stepLen * t2);
        }
        // Where folds get denser than the pixels can show, fade toward their average (anti-aliasing).
        float fw = fwidth(fs);
        float detail = 1.0 - smoothstep(0.35, 0.9, fw);
        float sulcus = smoothstep(0.72 - fw, 1.0, fs) * foldMask * detail; // the dark groove itself
        float shade = mix(0.3, smoothstep(0.05, 1.0, fs), detail) * foldMask; // soft shadow falling into it
        float vesselNoise = abs(snoise(vBrainPos * 2.3 + 7.0));
        float vesselPatch = smoothstep(0.05, 0.4, snoise(vBrainPos * 1.4 + 2.0));
        float vessel = (1.0 - smoothstep(0.0, 0.02, vesselNoise)) * vesselPatch * (1.0 - sulcus) * foldMask * step(uFolds, 0.5);
        diffuseColor.rgb *= 1.0 - shade * shade * 0.45;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.08, 0.11), pow(sulcus, 1.2) * 0.92);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.12, 0.15), vessel * 0.55);
        // Broad, rounded gyri that drop steeply into each sulcus.
        float d0 = smoothstep(-0.1, 1.0, fs), d1 = smoothstep(-0.1, 1.0, fs1), d2 = smoothstep(-0.1, 1.0, fs2);
        float h0 = -d0 * d0 * d0, h1 = -d1 * d1 * d1, h2 = -d2 * d2 * d2;
        vec2 foldSlope = vec2((h1 - h0) * lx, (h2 - h0) * ly) / stepLen * uBump * foldMask * detail;
        // Cut faces stay dark (like deep fissures) until the parts separate.
        diffuseColor.rgb *= mix(mix(0.1, 1.0, uCut), 1.0, vSurf);
        float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(luma) * vec3(0.36, 0.38, 0.42), uDull);`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = perturbFolds(-vViewPosition, normal, foldSlope, faceDirection);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.roughness = min(1.0, material.roughness + sulcus * 0.3);
        // Cut faces: no shine while the brain is whole (they read as deep fissures), soft once apart.
        float cutShine = mix(mix(0.0, 0.35, uCut), 1.0, vSurf);
        material.specularColor *= cutShine;
        #ifdef USE_CLEARCOAT
          material.clearcoat *= cutShine * (1.0 - sulcus * 0.6);
        #endif
        #ifdef USE_SHEEN
          material.sheenColor *= cutShine;
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.2);
        totalEmissiveRadiance += uGlowColor * uGlow * (0.16 + 1.1 * fres);`);
  };
  return { material, uniforms, part };
}

function seeded(n) { const x = Math.sin(n * 91.7) * 43758.5; return x - Math.floor(x); }

const buildStart = performance.now();
buildBrain(THREE, MarchingCubes).then((built_) => {
  window.__brainBuildMs = Math.round(performance.now() - buildStart);
  pieces = built_.map((p, i) => {
    const part = PARTS.find((x) => x.id === p.id);
    const { material, uniforms } = makeMaterial(part, p.folds);
    const mesh = new THREE.Mesh(p.geometry, material);
    mesh.position.set(...p.centroid);
    brain.add(mesh);
    return {
      ...p, part, mesh, material, uniforms,
      home: new THREE.Vector3(...p.centroid),
      away: new THREE.Vector3(...p.explode),
      spin: new THREE.Vector3((seeded(i) - 0.5) * 0.3, (seeded(i + 7) - 0.5) * 0.35, (seeded(i + 3) - 0.5) * 0.25)
    };
  });
  built = true;
  document.body.classList.add('brain-ready');
  schedule();
}).catch((error) => {
  console.error(error);
  window.brainFallback && window.brainFallback();
});

/* ---------- scroll + frame ---------- */

let width = 0, height = 0;
function resize() {
  width = innerWidth;
  height = innerHeight;
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  bloom.resolution.set(width / 2, height / 2);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  schedule();
}

const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
let smoothP = 0;
let lastTime = performance.now();
let raf = 0;
let idleUntil = 0;

function progress() {
  const r = intro.getBoundingClientRect();
  return clamp(-r.top / (intro.offsetHeight - innerHeight), 0, 1);
}

function schedule() {
  idleUntil = performance.now() + 1500;
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame(now) {
  raf = 0;
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const t = now / 1000;

  const p = progress();
  smoothP += (p - smoothP) * (reducedMotion ? 1 : Math.min(1, dt * 7));
  const sp = smoothP;
  pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
  pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);

  const lightUp = smooth(0, 0.14, sp); // the beam finds the brain
  const explode = ease(smooth(0.1, 0.52, sp)); // parts separate
  const reveal = smooth(0.44, 0.66, sp); // dull / brighten by impact
  const leave = smooth(0.86, 0.98, sp); // fade to the cream page
  if (built) appear = Math.min(1, appear + dt * 0.6);

  // Hero copy, nav, cue and the cream fade (what script.js did for the mosaic).
  hero.style.opacity = String(1 - smooth(0, 0.12, sp));
  hero.style.filter = `blur(${smooth(0, 0.12, sp) * 6}px)`;
  hero.classList.toggle('burst', sp > 0.02);
  nav.classList.toggle('visible', p > 0.03);
  nav.classList.toggle('on-dark', leave < 0.5);
  cue.classList.toggle('hide', p > 0.03);
  scrim.style.opacity = String(leave);

  // Lights: dim and moody at first, then the beam lands.
  const breathe = reducedMotion ? 1 : 0.94 + 0.06 * Math.sin(t * 0.7);
  key.intensity = lerp(4, 42, lightUp) * breathe * appear;
  beam.material.uniforms.uStrength.value = lerp(0.05, 0.13, lightUp) * appear * (1 - leave);
  dust.material.opacity = lerp(0.15, 0.55, lightUp) * appear * (1 - leave);
  rimCool.intensity = 1.7 * appear;
  rimWarm.intensity = 0.45 * appear;
  front.intensity = lerp(0.04, 0.3, lightUp) * appear;
  under.intensity = lerp(1.2, 2.4, lightUp) * appear;

  if (!reducedMotion) {
    for (let i = 0; i < DUST; i++) {
      const s = dustSeed[i];
      dustPos[i * 3 + 1] += dt * (0.04 + 0.03 * Math.sin(s));
      dustPos[i * 3] += dt * 0.02 * Math.sin(t * 0.3 + s);
      if (dustPos[i * 3 + 1] > 3.4) dustPos[i * 3 + 1] = -1;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  // Camera pulls back as the parts spread.
  camera.position.set(pointer.x * 0.25, lerp(0.18, 0.2, explode) + pointer.y * 0.12, lerp(3.7, 6.2, explode));
  camera.lookAt(0, lerp(-0.12, -0.08, explode), 0);

  const idle = reducedMotion ? 0 : Math.sin(t * 0.18) * 0.14;
  brain.rotation.set(0.06 - explode * 0.02, -Math.PI / 2 + 0.42 + idle * (1 - explode * 0.6) - explode * 0.12, 0);
  brain.position.y = reducedMotion ? 0 : Math.sin(t * 0.5) * 0.015;

  for (const piece of pieces) {
    piece.mesh.position.copy(piece.home).addScaledVector(piece.away, explode);
    piece.mesh.rotation.set(piece.spin.x * explode, piece.spin.y * explode, piece.spin.z * explode);
    const dull = reveal * piece.part.impact;
    const glow = reveal * (1 - piece.part.impact);
    piece.uniforms.uDull.value = dull * 0.92;
    piece.uniforms.uGlow.value = glow * 1.15;
    piece.uniforms.uCut.value = smooth(0.05, 0.35, explode);
    piece.material.clearcoat = 0.6 * (1 - dull * 0.85);
    piece.material.roughness = 0.46 + dull * 0.35;
  }

  canvas.style.opacity = String(appear);
  composer.render();

  const animating = !reducedMotion || Math.abs(p - smoothP) > 0.001 || (built && appear < 1);
  if (leave < 1 && (animating || now < idleUntil)) raf = requestAnimationFrame(frame);
}

addEventListener('resize', resize);
addEventListener('scroll', schedule, { passive: true });
addEventListener('pointermove', (e) => {
  if (reducedMotion) return;
  pointer.tx = e.clientX / innerWidth - 0.5;
  pointer.ty = -(e.clientY / innerHeight - 0.5);
  schedule();
}, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });

resize();
