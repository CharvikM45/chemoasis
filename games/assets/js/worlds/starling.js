/*
 * Starling Observatory in 3D: a domed observatory with six glowing objects in its sky. The box at
 * the top names one; find it, aim the crosshair at it and click. No timer.
 * Restored from the original 3D Starling Observatory (games/assets/js/starling-3d.js before
 * commit 04ebfa8).
 */
import { Walk, mat, reduceMotion, shuffle, esc } from './walk.js';

const OBJECTS = [['Aurora kite', -6, 7, -10], ['Ringed planet', 6, 9, -9], ['Comet trail', -1, 11, -13], ['Moon bridge', 7, 5, -11], ['Diamond cluster', -7, 4, -9], ['Sun wheel', 1, 6, -14]];
const shiny = (T, c, e, i) => mat(T, c, e, i, 0.52, 0.18);

function object(T, walk, name, x, y, z) {
  const g = new T.Group();
  g.position.set(x, y, z);
  g.userData.name = name;
  const add = (mesh) => { g.add(mesh); return mesh; };
  if (name === 'Aurora kite') add(new T.Mesh(new T.OctahedronGeometry(0.62), shiny(T, '#9dffdc', '#54ffcb', 1.2))).scale.set(1, 0.18, 1.65);
  if (name === 'Ringed planet') {
    add(new T.Mesh(new T.SphereGeometry(0.62, 24, 16), shiny(T, '#779bff', '#3d5dff', 0.7)));
    add(new T.Mesh(new T.TorusGeometry(0.95, 0.055, 8, 36), shiny(T, '#d6eaff', '#b6dcff', 1))).rotation.x = 1.2;
  }
  if (name === 'Comet trail') {
    add(new T.Mesh(new T.SphereGeometry(0.29, 16, 12), shiny(T, '#fbf3b5', '#fff27b', 2)));
    for (let i = 1; i < 5; i++) add(new T.Mesh(new T.SphereGeometry(0.18 - i * 0.025, 10, 8), shiny(T, '#78e6ff', '#54ceff', 0.75))).position.set(-i * 0.38, i * 0.13, i * 0.12);
  }
  if (name === 'Moon bridge') add(new T.Mesh(new T.TorusGeometry(0.66, 0.12, 8, 24, Math.PI), shiny(T, '#f3ddff', '#d191ff', 0.8))).rotation.z = Math.PI;
  if (name === 'Diamond cluster') for (let i = 0; i < 4; i++) add(new T.Mesh(new T.OctahedronGeometry(0.25), shiny(T, '#f6baff', '#e476ff', 1))).position.set(((i % 2) - 0.5) * 0.55, Math.floor(i / 2) * 0.5 - 0.25, ((i % 3) - 0.7) * 0.2);
  if (name === 'Sun wheel') {
    add(new T.Mesh(new T.TorusGeometry(0.48, 0.11, 8, 24), shiny(T, '#ffe080', '#ffc34d', 1.8)));
    for (let i = 0; i < 8; i++) {
      const ray = add(new T.Mesh(new T.BoxGeometry(0.08, 0.5, 0.08), shiny(T, '#ffe080', '#ffd766', 1)));
      ray.position.set(Math.cos((i * Math.PI) / 4) * 0.83, Math.sin((i * Math.PI) / 4) * 0.83, 0);
      ray.rotation.z = (-i * Math.PI) / 4;
    }
  }
  // An unseen ball around each object, so thin shapes (the comet's tail, the diamonds) are as easy to
  // click as the solid ones.
  add(new T.Mesh(new T.SphereGeometry(1.15, 10, 8), new T.MeshBasicMaterial({ visible: false })));
  g.traverse((o) => { if (o.isMesh) { o.userData.object = g; o.userData.glow = o.material.emissiveIntensity; walk.clickables.push(o); } });
  walk.scene.add(g);
  return g;
}

function build(T, walk) {
  const { scene } = walk;
  scene.background = new T.Color('#02040d');
  scene.fog = new T.FogExp2('#050916', 0.031);
  scene.add(new T.HemisphereLight('#486de2', '#081222', 1.2));
  const light = new T.PointLight('#63c7ff', 4, 30);
  light.position.set(0, 5, 2);
  scene.add(light);
  scene.add(new T.Mesh(new T.SphereGeometry(24, 32, 20), new T.MeshBasicMaterial({ color: '#071334', side: T.BackSide })));
  const floor = new T.Mesh(new T.CylinderGeometry(9, 10, 0.2, 48), shiny(T, '#071324', '#0b3651', 0.16));
  floor.position.y = -0.1;
  scene.add(floor);
  for (let i = 0; i < 70; i++) {
    const star = new T.Mesh(new T.SphereGeometry(0.018 + Math.random() * 0.035, 6, 6), new T.MeshBasicMaterial({ color: '#ddedff' }));
    const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 11;
    star.position.set(Math.cos(a) * r, 2 + Math.random() * 13, Math.sin(a) * r);
    scene.add(star);
  }
  const tube = new T.Mesh(new T.CylinderGeometry(0.38, 0.5, 3.2, 12), shiny(T, '#172c47', '#2a87bd', 0.25));
  tube.rotation.z = Math.PI / 2.35;
  tube.position.set(1.1, 1.8, -2);
  scene.add(tube);
  const base = new T.Mesh(new T.CylinderGeometry(0.8, 0.6, 1.6, 10), shiny(T, '#182031'));
  base.position.set(0, 0.8, -2);
  scene.add(base);
  return OBJECTS.map(([name, x, y, z]) => object(T, walk, name, x, y, z));
}

// Resolves { mistakes } when every object is found, or null if the game closes first.
export async function play(T, world, level, alive) {
  const walk = new Walk(T, world, { bounds: { x: [-7.5, 7.5], z: [-7.5, 7.5] }, speed: 3.4, fov: 70, far: 70, exposure: 1, pitch: [-1.1, 1.1] });
  const objects = build(T, walk);
  const queue = shuffle(OBJECTS.map(([name]) => name)).slice(0, level.count);
  let at = 0, mistakes = 0;
  const goal = () => `<small>Find${queue.length > 1 ? ` · ${at + 1} of ${queue.length}` : ''}</small><b>${esc(queue[at])}</b>`;
  walk.place([0, 1.62, 7], 0, 0.25);
  walk.mount(walk.hud({ goal: goal(), status: `Look around the dome for the ${queue[0]}. Aim the crosshair at it and click.` }));
  walk.start((dt) => { if (!reduceMotion) objects.forEach((g, i) => { g.rotation.y += dt * (0.25 + i * 0.03); }); });
  return new Promise((resolve) => {
    walk.onPick = (hit) => {
      if (!hit) return walk.status('Aim at one of the glowing objects in the dome, then click.');
      const found = hit.object.userData.object, { name } = found.userData;
      if (name !== queue[at]) { mistakes++; return walk.status(`That’s the ${name}. Keep looking for the ${queue[at]}.`); }
      found.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissiveIntensity = 3; });
      if (++at < queue.length) { walk.goal(goal()); return walk.status(`You found the ${name}. Now look for the ${queue[at]}.`); }
      walk.onPick = null;
      walk.goal(`<small>Done</small>You found ${queue.length === 1 ? 'it' : queue.length === 2 ? 'both' : `all ${queue.length}`}.`);
      walk.status(`You found the ${name}. Take a breath.`);
      world.sleep(900).then(() => resolve(alive() ? { mistakes } : null));
    };
  });
}
