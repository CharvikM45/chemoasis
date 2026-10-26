/*
 * Lumen Garden in 3D: a night garden with five glowing plants. The path of plants to visit shows
 * at the top for a few seconds; then it hides, and you walk to each plant and click it in order.
 * Restored from the original 3D Lumen Garden (games/assets/js/lumen-3d.js before commit 04ebfa8).
 */
import { Walk, mat, label, reduceMotion, shuffle, esc } from './walk.js';

// [name, x, z, color]
const PLANTS = [['Moonfern', -3.6, 6.4, '#e46eff'], ['Prism bloom', 3.4, -0.8, '#75edff'], ['Star reed', -3.9, -8.1, '#ffd366'], ['Sunbud', 4.2, -12.4, '#ff8ec5'], ['Dawn orchid', -5.7, -14.7, '#8effc9']];
const hue = Object.fromEntries(PLANTS.map(([name, , , c]) => [name, c]));

function build(T, walk) {
  const { scene } = walk;
  const targets = [], lights = [];
  const add = (mesh, parent = scene) => { parent.add(mesh); return mesh; };
  scene.background = new T.Color('#03030c');
  scene.fog = new T.FogExp2('#09051d', 0.043);
  scene.add(new T.HemisphereLight('#4e2a88', '#06160f', 1.2));
  const moon = new T.DirectionalLight('#c2b3ff', 1.3);
  moon.position.set(-6, 12, 4);
  scene.add(moon);
  const ground = add(new T.Mesh(new T.PlaneGeometry(70, 70), mat(T, '#061510', '#061510', 0.15)));
  ground.rotation.x = -Math.PI / 2;
  const water = add(new T.Mesh(new T.PlaneGeometry(70, 70), new T.MeshStandardMaterial({ color: '#081438', metalness: 0.83, roughness: 0.22, transparent: true, opacity: 0.68 })));
  water.position.y = -0.04;
  water.rotation.x = -Math.PI / 2;
  // The glowing stepping-stone path down the middle of the garden.
  for (let z = 16; z > -25; z -= 3.5) {
    add(new T.Mesh(new T.BoxGeometry(5.6, 0.07, 2.55), mat(T, '#181044', '#4a1678', 0.4))).position.set(0, 0.02, z);
    add(new T.Mesh(new T.BoxGeometry(5.75, 0.05, 0.045), mat(T, '#be4fff', '#be4fff', 2))).position.set(0, 0.08, z - 1.23);
  }
  [[-7, 12, 1.5], [7, 12, 1.7], [-9, 3, 2], [9, 3, 2], [-8, -7, 2.3], [8, -7, 2.1], [-11, -16, 2.6], [11, -16, 2.6], [-5, -19, 1.6], [5, -19, 1.7]].forEach(([x, z, s], i) => {
    const tint = i % 2 ? '#4c1075' : '#275943';
    const tree = new T.Group();
    tree.position.set(x, 0, z);
    tree.scale.setScalar(s);
    add(new T.Mesh(new T.CylinderGeometry(0.18, 0.28, 3.2, 7), mat(T, '#1d1021')), tree).position.y = 1.55;
    for (let j = 0; j < 4; j++) {
      const leaf = add(new T.Mesh(new T.IcosahedronGeometry(1.08 - j * 0.12, 1), mat(T, tint, tint, 0.15)), tree);
      leaf.position.set(j % 2 ? 0.35 : -0.35, 2.4 + j * 0.65, ((j % 3) - 1) * 0.34);
      leaf.rotation.set(j, j * 1.7, 0);
    }
    scene.add(tree);
  });
  for (const [name, x, z, c] of PLANTS) {
    const g = new T.Group();
    g.position.set(x, 0, z);
    g.userData.name = name;
    add(new T.Mesh(new T.CylinderGeometry(0.045, 0.07, 1.35, 7), mat(T, '#244038')), g).position.y = 0.68;
    add(new T.Mesh(new T.SphereGeometry(0.25, 16, 12), mat(T, c, c, 1.7)), g).position.y = 1.35;
    for (let i = 0; i < 6; i++) {
      const petal = add(new T.Mesh(new T.SphereGeometry(0.19, 12, 9), mat(T, c, c, 0.95)), g);
      petal.position.set(Math.cos((i * Math.PI) / 3) * 0.39, 1.35 + Math.sin((i * Math.PI) / 3) * 0.12, Math.sin((i * Math.PI) / 3) * 0.39);
      petal.scale.set(1, 0.55, 1);
    }
    const halo = add(new T.Mesh(new T.TorusGeometry(0.55, 0.018, 6, 32), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.63 })), g);
    halo.position.y = 0.12;
    halo.rotation.x = Math.PI / 2;
    const tag = add(label(T, name, c), g);
    tag.position.y = 2.15;
    g.traverse((o) => { if (o.isMesh) { o.userData.target = g; o.userData.glow = o.material.emissiveIntensity; walk.clickables.push(o); } });
    const light = new T.PointLight(c, 2.1, 7, 2);
    light.position.set(x, 1.8, z);
    scene.add(light);
    lights.push(light);
    scene.add(g);
    targets.push(g);
  }
  const gate = new T.Group();
  gate.position.set(0, 0, -20);
  for (const x of [-3.3, 3.3]) add(new T.Mesh(new T.CylinderGeometry(0.18, 0.24, 5.4, 8), mat(T, '#30205d', '#671fc1', 0.7)), gate).position.set(x, 2.7, 0);
  add(new T.Mesh(new T.TorusGeometry(3.3, 0.16, 8, 40, Math.PI), mat(T, '#a24bff', '#a24bff', 1.2)), gate).position.set(0, 5.3, 0);
  scene.add(gate);
  const count = 650, positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { positions[i * 3] = (Math.random() - 0.5) * 80; positions[i * 3 + 1] = Math.random() * 27 + 2; positions[i * 3 + 2] = (Math.random() - 0.5) * 80; }
  const stars = new T.BufferGeometry();
  stars.setAttribute('position', new T.BufferAttribute(positions, 3));
  scene.add(new T.Points(stars, new T.PointsMaterial({ color: '#dcb9ff', size: 0.07, sizeAttenuation: true })));
  return { targets, lights };
}

const token = (name, i) => `<span class="w3-token" style="--c:${hue[name]}">${i + 1}. ${esc(name)}</span>`;

// Resolves { mistakes, peeks } when the path is done, or null if the game closes first.
export async function play(T, world, level, alive) {
  const walk = new Walk(T, world, { bounds: { x: [-14, 14], z: [-21, 18] }, speed: 3.6, exposure: 1.25, pitch: [-1.15, 1.05] });
  const { targets, lights } = build(T, walk);
  const path = shuffle(PLANTS.map(([name]) => name)).slice(0, level.count);
  walk.place([0, 1.65, 16], 0, -0.04);
  walk.mount(walk.hud({
    goal: `<small>Remember this path · hides in <span data-count>${level.secs}</span> s</small><div class="w3-tokens">${path.map(token).join('')}</div>`,
    status: `Look around the garden and remember these ${path.length} plants, in order.`,
    extra: '<button class="w3-side" data-peek hidden>Show the path again (P)</button>'
  }));
  walk.start((dt, now) => {
    if (reduceMotion) return;
    targets.forEach((g, i) => { g.rotation.y += dt * (0.35 + i * 0.04); g.position.y = Math.sin(now * 0.0014 + i) * 0.08; });
    lights.forEach((l, i) => { l.intensity = 1.7 + Math.sin(now * 0.002 + i) * 0.6; });
  });
  for (let s = level.secs; s > 0; s--) {
    const count = walk.$('[data-count]');
    if (count) count.textContent = s;
    await world.sleep(1000);
    if (!alive()) return null;
  }
  walk.goal(`<small>Path hidden · 0 of ${path.length} found</small>Visit the plants in the order you remember.`);
  walk.status('Walk up to each plant and click it, in order. You need to be close enough to tend it.');
  let step = 0, mistakes = 0, peeks = 0, peeking = false;
  const hidden = () => `<small>Path hidden · ${step} of ${path.length} found</small>${step ? `<div class="w3-tokens">${path.slice(0, step).map(token).join('')}</div>` : 'Visit the plants in the order you remember.'}`;
  // Forgot the path? A peek shows it again for 4 seconds. It counts toward the result, like a wrong pick.
  const peek = async () => {
    if (peeking || step >= path.length) return;
    peeking = true;
    peeks++;
    walk.goal(`<small>Peek ${peeks} · the path</small><div class="w3-tokens">${path.map(token).join('')}</div>`);
    await world.sleep(4000);
    peeking = false;
    if (alive() && step < path.length) walk.goal(hidden());
  };
  const button = walk.$('[data-peek]');
  button.hidden = false;
  button.addEventListener('click', peek);
  // P peeks too, so nobody has to free the mouse to reach the button. Movement keys go to the walk as before.
  const keys = walk.keyHandler;
  walk.keyHandler = world.keyHandler = (e) => { if (e.key.toLowerCase() === 'p' && !e.repeat) { e.preventDefault(); peek(); } else keys(e); };
  return new Promise((resolve) => {
    walk.onPick = (hit) => {
      if (!hit) return walk.status('Aim the crosshair at a glowing plant, then click.');
      const plant = hit.object.userData.target, { name } = plant.userData;
      if (plant.userData.found) return walk.status(`${name} is already glowing. Find the next plant.`);
      if (walk.camera.position.distanceTo(plant.position) > 4.5) return walk.status(`Walk closer to ${name} first.`);
      if (name !== path[step]) { mistakes++; return walk.status(`That’s ${name}, but it isn’t next. Keep looking.`); }
      plant.userData.found = true;
      plant.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissiveIntensity = 3.4; });
      step++;
      if (!peeking) walk.goal(hidden());
      if (step < path.length) return walk.status(`Yes, ${name}. Now find the next plant.`);
      walk.onPick = null;
      button.hidden = true;
      walk.goal(`<small>Garden complete</small><div class="w3-tokens">${path.map(token).join('')}</div>`);
      walk.status(`Garden complete: ${path.length === 2 ? 'both' : `all ${path.length}`} plants, in order.`);
      world.sleep(900).then(() => resolve(alive() ? { mistakes, peeks } : null));
    };
  });
}
