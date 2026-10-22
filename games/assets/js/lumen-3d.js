import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const host = document.createElement('section');
host.id = 'lumen-3d';
host.hidden = true;
host.setAttribute('aria-label', 'Lumen Garden 3D exploration game');
document.body.append(host);

let renderer, scene, camera, clock, raf, opened = false, locked = false;
let yaw = 0, pitch = -0.04, countdownTimer, active = false, step = 0, level = 0;
const keys = new Set();
const targets = [], lights = [], animated = [];
const PLANTS = ['Moonfern', 'Prism bloom', 'Star reed', 'Sunbud', 'Dawn orchid'];
const LEVELS = [
  { name: 'Two lights', desc: 'Remember 2 plants in order. 15 seconds to look.', count: 2, secs: 15 },
  { name: 'Three lights', desc: 'Remember 3 plants in order. 10 seconds to look.', count: 3, secs: 10 },
  { name: 'Four lights', desc: 'Remember 4 plants in order. 12 seconds to look.', count: 4, secs: 12 },
  { name: 'Five lights', desc: 'Remember all 5 plants in order. 12 seconds to look.', count: 5, secs: 12 }
];
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];
let sequence = PLANTS.slice(0, 3);
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);
const world = new THREE.Group();

function html() {
  host.innerHTML = `<div class="lumen-vignette"></div>
    <div class="lumen-sequence" id="lumen-sequence"><small>Level ${level + 1} · hold this path in mind · <span id="lumen-count">${LEVELS[level].secs}</span>s</small><div class="lumen-sequence-items">${sequence.map((name, i) => `<span class="lumen-token">${i + 1}. ${name}</span>`).join('')}</div></div>
    <div class="lumen-hud"><div class="lumen-copy"><p class="lumen-kicker">Lumen Garden · 3D exploration</p><h2>Find the light,<br>in order.</h2><p class="lumen-status" id="lumen-status">Look around the garden and remember the ${WORDS[sequence.length]} glowing plants.</p></div><button class="lumen-exit" id="lumen-exit">Exit garden</button></div>
    <button class="lumen-enter" id="lumen-enter">Enter the garden</button><div class="lumen-crosshair" aria-hidden="true"></div><p class="lumen-help"><b>W A S D</b> to walk · <b>mouse</b> to look · aim at a glowing plant and <b>click</b> to interact. You need to be close enough to tend it.</p>`;
}

function mat(color, emissive = color, power = 0) { return new THREE.MeshStandardMaterial({ color, roughness: .68, metalness: .05, emissive, emissiveIntensity: power }); }
function add(mesh, parent = world) { parent.add(mesh); return mesh; }
function createTree(x, z, scale, tint) {
  const tree = new THREE.Group(); tree.position.set(x, 0, z); tree.scale.setScalar(scale);
  add(new THREE.Mesh(new THREE.CylinderGeometry(.18, .28, 3.2, 7), mat('#1d1021')), tree).position.y = 1.55;
  for (let i = 0; i < 4; i++) { const leaf = add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.08 - i * .12, 1), mat(tint, tint, .15)), tree); leaf.position.set((i % 2 ? .35 : -.35), 2.4 + i * .65, (i % 3 - 1) * .34); leaf.rotation.set(i, i * 1.7, 0); }
  scene.add(tree);
}
function createTarget(name, x, z, hue) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.userData.targetName = name; g.userData.baseY = .12;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.045, .07, 1.35, 7), mat('#244038')); stem.position.y = .68; g.add(stem);
  const core = new THREE.Mesh(new THREE.SphereGeometry(.25, 16, 12), mat(hue, hue, 1.7)); core.position.y = 1.35; g.add(core);
  for (let i = 0; i < 6; i++) { const petal = new THREE.Mesh(new THREE.SphereGeometry(.19, 12, 9), mat(hue, hue, .95)); petal.position.set(Math.cos(i * Math.PI / 3) * .39, 1.35 + Math.sin(i * Math.PI / 3) * .12, Math.sin(i * Math.PI / 3) * .39); petal.scale.set(1, .55, 1); g.add(petal); }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(.55, .018, 6, 32), new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: .63 })); halo.position.y = .12; halo.rotation.x = Math.PI / 2; g.add(halo);
  g.traverse(node => { if (node.isMesh) { node.userData.target = g; node.userData.glow = node.material.emissiveIntensity; } });
  const light = new THREE.PointLight(hue, 2.1, 7, 2); light.position.set(x, 1.8, z); scene.add(light); lights.push(light);
  scene.add(g); targets.push(g); animated.push(g);
}
function createWorld() {
  scene = new THREE.Scene(); scene.background = new THREE.Color('#03030c'); scene.fog = new THREE.FogExp2('#09051d', .043);
  scene.add(world);
  const hemi = new THREE.HemisphereLight('#4e2a88', '#06160f', 1.2); scene.add(hemi);
  const moon = new THREE.DirectionalLight('#c2b3ff', 1.3); moon.position.set(-6, 12, 4); scene.add(moon);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), mat('#061510', '#061510', .15)); ground.rotation.x = -Math.PI / 2; add(ground);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshStandardMaterial({ color: '#081438', metalness: .83, roughness: .22, transparent: true, opacity: .68 })); water.position.y = -.04; water.rotation.x = -Math.PI / 2; add(water);
  for (let z = 16; z > -25; z -= 3.5) { const tile = new THREE.Mesh(new THREE.BoxGeometry(5.6, .07, 2.55), mat('#181044', '#4a1678', .4)); tile.position.set(0, .02, z); add(tile); const strip = new THREE.Mesh(new THREE.BoxGeometry(5.75, .05, .045), mat('#be4fff', '#be4fff', 2)); strip.position.set(0, .08, z - 1.23); add(strip); }
  [[-7,12,1.5], [7,12,1.7], [-9,3,2], [9,3,2], [-8,-7,2.3], [8,-7,2.1], [-11,-16,2.6], [11,-16,2.6], [-5,-19,1.6], [5,-19,1.7]].forEach(([x,z,s], i) => createTree(x,z,s, i % 2 ? '#4c1075' : '#275943'));
  createTarget('Moonfern', -3.6, 6.4, '#e46eff'); createTarget('Prism bloom', 3.4, -.8, '#75edff'); createTarget('Star reed', -3.9, -8.1, '#ffd366'); createTarget('Sunbud', 4.2, -12.4, '#ff8ec5'); createTarget('Dawn orchid', -5.7, -14.7, '#8effc9');
  const gate = new THREE.Group(); gate.position.set(0, 0, -20); for (const x of [-3.3, 3.3]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.18,.24,5.4,8), mat('#30205d','#671fc1',.7)); p.position.set(x,2.7,0); gate.add(p); } const arch = new THREE.Mesh(new THREE.TorusGeometry(3.3,.16,8,40,Math.PI),mat('#a24bff','#a24bff',1.2)); arch.position.set(0,5.3,0); gate.add(arch); scene.add(gate);
  const starGeo = new THREE.BufferGeometry(), count = 650, positions = new Float32Array(count * 3); for(let i=0;i<count;i++){ positions[i*3]=(Math.random()-.5)*80; positions[i*3+1]=Math.random()*27+2; positions[i*3+2]=(Math.random()-.5)*80; } starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3)); scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({color:'#dcb9ff',size:.07,sizeAttenuation:true})));
}
function init() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: !reduceMotion, powerPreference: 'high-performance' }); renderer.setPixelRatio(Math.min(devicePixelRatio, reduceMotion ? 1 : 1.75)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
  host.prepend(renderer.domElement); camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, .08, 100); camera.position.set(0, 1.65, 16); clock = new THREE.Clock(); createWorld(); resize(); addEventListener('resize', resize);
  renderer.domElement.addEventListener('click', interact); renderer.domElement.addEventListener('mousedown', () => { if (!locked) renderer.domElement.requestPointerLock?.(); });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === renderer.domElement; const enter = host.querySelector('#lumen-enter'); if (enter) enter.hidden = locked; });
  document.addEventListener('mousemove', e => { if (!opened || !locked) return; yaw -= e.movementX * .0022; pitch = THREE.MathUtils.clamp(pitch - e.movementY * .0018, -1.15, 1.05); });
}
function resize() { if (!renderer || host.hidden) return; const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); }
function status(text) { const el = host.querySelector('#lumen-status'); if (el) el.textContent = text; }
function beginSequence() { clearInterval(countdownTimer); active = false; step = 0; let remaining = LEVELS[level].secs; const count = host.querySelector('#lumen-count'), bar = host.querySelector('#lumen-sequence'); count.textContent = remaining; countdownTimer = setInterval(() => { remaining--; count.textContent = remaining; if (remaining <= 0) { clearInterval(countdownTimer); active = true; bar.innerHTML = '<small>Sequence hidden · explore and tend the plants in order</small>'; status('The path is hidden. Walk through the garden and click the glowing plants in the order you remember.'); } }, 1000); }
function interact() { if (!opened || !active) { if (opened && !active) status('Take a moment—the sequence is still visible.'); return; } raycaster.setFromCamera(center, camera); const hit = raycaster.intersectObjects(scene.children, true).find(item => item.object.userData.target); if (!hit) { status('Aim at a glowing plant, then click to tend it.'); return; } const plant = hit.object.userData.target; const dist = camera.position.distanceTo(plant.position); if (dist > 4.5) { status(`Walk closer to ${plant.userData.targetName} before tending it.`); return; } const wanted = sequence[step]; if (plant.userData.targetName === wanted) { plant.userData.found = true; plant.traverse(o => { if (o.isMesh && o.material?.emissive) o.material.emissiveIntensity = 3.4; }); step++; if (step === sequence.length) { status(`Garden sequence complete. You found all ${WORDS[sequence.length]} lights in order.`); host.querySelector('#lumen-sequence').innerHTML = `<small>Level ${level + 1} complete · ${WORDS[sequence.length]} lights tended</small>`; active = false; setTimeout(() => { if (opened) GameLevels.done({ host, game: 'lumen', level, levels: LEVELS, message: `You found all ${WORDS[sequence.length]} lights in order.`, onPick: startLevel, onLevels: showLevels, onExit: close }); }, 900); } else status(`${plant.userData.targetName} is glowing brighter. Find the next light.`); } else { status(`That is ${plant.userData.targetName}, but it is not next. Keep exploring.`); } }
function frame() { if (!opened) return; raf = requestAnimationFrame(frame); const dt = Math.min(clock.getDelta(), .05), speed = keys.has('Shift') ? 6.3 : 3.6; camera.rotation.set(pitch, yaw, 0, 'YXZ'); const forward = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), yaw); const right = new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0), yaw); if (keys.has('w') || keys.has('ArrowUp')) camera.position.addScaledVector(forward, speed*dt); if (keys.has('s') || keys.has('ArrowDown')) camera.position.addScaledVector(forward, -speed*dt); if (keys.has('a') || keys.has('ArrowLeft')) camera.position.addScaledVector(right, -speed*dt); if (keys.has('d') || keys.has('ArrowRight')) camera.position.addScaledVector(right, speed*dt); camera.position.x=THREE.MathUtils.clamp(camera.position.x,-14,14); camera.position.z=THREE.MathUtils.clamp(camera.position.z,-21,18); animated.forEach((g,i)=>{g.rotation.y += dt*(.35+i*.04); g.position.y = Math.sin(performance.now()*.0014+i)*.08;}); lights.forEach((l,i)=> l.intensity = 1.7 + Math.sin(performance.now()*.002+i)*.6); renderer.render(scene,camera); }
function open() { html(); if (renderer) host.prepend(renderer.domElement); init(); opened=true; host.hidden=false; document.body.style.overflow='hidden'; camera.position.set(0,1.65,16); yaw=0; pitch=-.04; resize(); clock.start(); frame(); showLevels(); }
function showLevels() { clearInterval(countdownTimer); active = false; GameLevels.pick({ host, game: 'lumen', title: 'Lumen Garden', kicker: 'Memory & recall · choose a level', levels: LEVELS, onPick: startLevel, onExit: close }); }
function startLevel(n) {
  level = n;
  sequence = PLANTS.slice().sort(() => Math.random() - .5).slice(0, LEVELS[n].count);
  targets.forEach(g => { g.userData.found = false; g.traverse(o => { if (o.isMesh && o.material?.emissive) o.material.emissiveIntensity = o.userData.glow; }); });
  html(); host.prepend(renderer.domElement); camera.position.set(0,1.65,16); yaw=0; pitch=-.04;
  host.querySelector('#lumen-exit').onclick=close; host.querySelector('#lumen-enter').onclick=()=>renderer.domElement.requestPointerLock?.();
  beginSequence();
}
function close() { opened=false; cancelAnimationFrame(raf); clearInterval(countdownTimer); GameLevels.close(host); if (document.pointerLockElement) document.exitPointerLock(); host.hidden=true; document.body.style.overflow=''; keys.clear(); }
addEventListener('keydown', e => { if (!opened) return; if (['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Shift'].includes(e.key)) { keys.add(e.key); e.preventDefault(); } if (e.key === 'Escape') close(); });
addEventListener('keyup', e => keys.delete(e.key));
addEventListener('click', e => { const card = e.target.closest('[data-game="lumen"]'); if (!card) return; e.preventDefault(); e.stopImmediatePropagation(); open(); }, true);
