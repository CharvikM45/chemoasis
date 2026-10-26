/*
 * Cloudpath Cartographer in 3D: five floating islands joined by sky bridges. Plan a route from
 * Harbor to the goal, then click each next island's beacon. Islands you can reach next glow
 * brightest. No timer.
 * Restored from the original 3D Cloudpath Cartographer (games/assets/js/cloudpath-3d.js before
 * commit 04ebfa8).
 */
import { Walk, mat, label, esc } from './walk.js';

const LINKS = { Harbor: ['Moss', 'Wind'], Moss: ['Harbor', 'Falls'], Wind: ['Harbor', 'Falls'], Falls: ['Moss', 'Wind', 'Beacon'], Beacon: ['Falls'] };
const AT = { Harbor: [0, 0, 12], Moss: [-7, 1, 4], Wind: [7, 1, 4], Falls: [0, 2, -4], Beacon: [4.5, 4.5, -13] };
// The Beacon sits up and to the right, so Falls doesn't hide it from the start at Harbor.
const BRIDGES = [['Harbor', 'Moss'], ['Harbor', 'Wind'], ['Moss', 'Falls'], ['Wind', 'Falls'], ['Falls', 'Beacon']];

function build(T, walk) {
  const { scene } = walk;
  const islands = {};
  scene.background = new T.Color('#060d19');
  scene.fog = new T.FogExp2('#527d95', 0.024);
  scene.add(new T.HemisphereLight('#c1e8ff', '#28465b', 1.45));
  const sun = new T.DirectionalLight('#ffe5a8', 1.25);
  sun.position.set(-7, 14, 8);
  scene.add(sun);
  const cloud = new T.Mesh(new T.PlaneGeometry(100, 100), new T.MeshStandardMaterial({ color: '#527f95', roughness: 0.9, transparent: true, opacity: 0.68 }));
  cloud.rotation.x = -Math.PI / 2;
  cloud.position.y = -4;
  scene.add(cloud);
  for (const name of Object.keys(AT)) {
    const beaconIsle = name === 'Beacon';
    const g = new T.Group();
    g.position.set(...AT[name]);
    g.userData.name = name;
    const land = new T.Mesh(new T.IcosahedronGeometry(beaconIsle ? 2.05 : 2.45, 2), mat(T, beaconIsle ? '#9a7f2f' : '#245b51', beaconIsle ? '#625010' : '#163e4b', 0.25, 0.7, 0.06));
    land.scale.y = 0.46;
    g.add(land);
    const grass = new T.Mesh(new T.CylinderGeometry(1.72, 2.1, 0.28, 9), mat(T, beaconIsle ? '#ffe78f' : '#7fbf6b', '#6eab5f', 0.35, 0.7, 0.06));
    grass.position.y = 0.68;
    g.add(grass);
    for (let i = 0; i < 3; i++) {
      const tree = new T.Mesh(new T.ConeGeometry(0.33, 0.95, 7), mat(T, '#16473c', '#1c5c47', 0.2, 0.7, 0.06));
      tree.position.set((i - 1) * 0.5, 0.98, ((i % 2) - 0.5) * 0.7);
      g.add(tree);
    }
    const beacon = new T.Mesh(new T.CylinderGeometry(0.16, 0.23, 1.65, 10), mat(T, '#fff0a5', '#ffcc57', 1.5, 0.7, 0.06));
    beacon.position.y = 1.65;
    g.add(beacon);
    const glow = new T.PointLight('#ffcb62', 1.8, 6);
    glow.position.y = 2.3;
    g.add(glow);
    const tag = label(T, name, beaconIsle ? '#ffe9a6' : '#fff7e8');
    tag.position.y = 3.2;
    tag.scale.multiplyScalar(1.5);
    g.add(tag);
    g.traverse((o) => { if (o.isMesh) { o.userData.island = g; walk.clickables.push(o); } });
    scene.add(g);
    islands[name] = g;
  }
  for (const [a, b] of BRIDGES) {
    const pa = new T.Vector3(...AT[a]), pb = new T.Vector3(...AT[b]);
    const plank = new T.Mesh(new T.BoxGeometry(0.48, 0.12, pa.distanceTo(pb)), mat(T, '#b48450', '#704522', 0.2, 0.7, 0.06));
    plank.position.copy(pa.clone().add(pb).multiplyScalar(0.5));
    plank.lookAt(pb);
    scene.add(plank);
    for (let i = 1; i < 5; i++) {
      const lamp = new T.PointLight('#f3cb76', 0.42, 2);
      lamp.position.copy(pa).lerp(pb, i / 5);
      lamp.position.y += 0.45;
      scene.add(lamp);
    }
  }
  for (let i = 0; i < 45; i++) {
    const puff = new T.Mesh(new T.SphereGeometry(0.35 + Math.random() * 0.6, 8, 6), new T.MeshBasicMaterial({ color: '#d0ecf2', transparent: true, opacity: 0.23 }));
    puff.position.set((Math.random() - 0.5) * 40, Math.random() * 8 - 3, (Math.random() - 0.5) * 42);
    puff.scale.set(2.5, 0.5, 1.4);
    scene.add(puff);
  }
  const pier = new T.Mesh(new T.BoxGeometry(3.3, 0.18, 4), mat(T, '#754b32', '#4a251c', 0.25, 0.7, 0.06));
  pier.position.set(0, 0.65, 15.4);
  scene.add(pier);
  return islands;
}

// Resolves { stops } when the route reaches the goal with every must-visit island, or null if
// the game closes first.
export async function play(T, world, level, alive) {
  const walk = new Walk(T, world, { bounds: { x: [-13, 13], z: [-17, 21] }, speed: 3.5, far: 90, exposure: 1.2, pitch: [-1.05, 1.02] });
  const islands = build(T, walk);
  let route = [];
  const where = () => route[route.length - 1] || 'Harbor';
  const show = () => {
    walk.goal(`<small>${esc(level.goal)}</small><span class="w3-route">${['Harbor', ...route].map(esc).join(' → ')}</span>`);
    const at = where();
    Object.entries(islands).forEach(([name, g]) => {
      const next = LINKS[at].includes(name);
      g.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissiveIntensity = next ? 1.6 : name === at ? 0.55 : 0.25; });
    });
  };
  walk.place([0, 3.4, 20], 0, -0.14);
  walk.mount(walk.hud({
    goal: '',
    status: 'The islands you can reach next glow brightest. Click one to add it to your route.',
    extra: '<button class="w3-side" data-restart>Start over</button>'
  }));
  walk.start();
  show();
  walk.$('[data-restart]').addEventListener('click', () => { route = []; show(); walk.status('Back at Harbor. Plan your route again.'); });
  return new Promise((resolve) => {
    walk.onPick = (hit) => {
      if (!hit) return walk.status('Aim at an island’s beacon, then click it to plan the next stop.');
      const dest = hit.object.userData.island.userData.name, at = where();
      if (dest === at) return walk.status(`You’re on ${at}. Pick a connected island.`);
      if (!LINKS[at].includes(dest)) return walk.status(`${dest} isn’t joined to ${at}. Look for an island linked by a sky bridge.`);
      route.push(dest);
      show();
      if (dest !== level.end) return walk.status(`${dest} added. Choose the next island when you’re ready.`);
      const missing = level.must.filter((x) => !route.includes(x));
      if (missing.length) return walk.status(`${level.end} reached, but the route still needs ${missing.join(' and ')}. Keep going from here.`);
      walk.onPick = null;
      walk.status('Route complete.');
      world.sleep(900).then(() => resolve(alive() ? { stops: route.length, path: ['Harbor', ...route].join(' → ') } : null));
    };
  });
}
