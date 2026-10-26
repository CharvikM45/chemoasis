// Decorative scenery only: never registered as a game target or used by scoring.
export function environment(T, walk, kind) {
  const scenery = new T.Group(), lamps = new T.Group(), atmosphere = new T.Group();
  scenery.name = 'Environment scenery'; lamps.name = 'Environment lanterns'; atmosphere.name = 'Environment atmosphere';
  walk.scene.add(scenery, lamps, atmosphere);
  const moving = [];
  const material = (color) => new T.MeshStandardMaterial({ color, roughness: 0.88 });
  const stone = material(kind === 'cloudpath' ? '#688b85' : '#455561');
  const wood = material('#635343'), leaf = material('#365c4b');
  const add = (group, geometry, mat, x, y, z) => {
    const mesh = new T.Mesh(geometry, mat);
    mesh.position.set(x, y, z); group.add(mesh); return mesh;
  };
  const box = (g, x, y, z, w, h, d, m = stone) => add(g, new T.BoxGeometry(w, h, d), m, x, y, z);
  const glow = new T.MeshBasicMaterial({ color: '#ffdda0' });
  const lantern = (x, z, y = 0) => {
    box(lamps, x, y + 0.8, z, 0.09, 1.6, 0.09, wood);
    box(lamps, x, y + 1.96, z, 0.48, 0.09, 0.48, wood);
    add(lamps, new T.SphereGeometry(0.17, 8, 6), glow, x, y + 1.72, z);
    // Ground pools suggest warm light without adding many expensive light sources.
    const pool = add(lamps, new T.CircleGeometry(1.3, 24), new T.MeshBasicMaterial({ color: '#eab774', transparent: true, opacity: 0.12, depthWrite: false }), x, y + 0.025, z);
    pool.rotation.x = -Math.PI / 2;
  };
  const bench = (x, z, angle) => {
    const g = new T.Group(); scenery.add(g); g.position.set(x, 0, z); g.rotation.y = angle;
    box(g, 0, 0.62, 0, 2.8, 0.16, 0.7, wood);
    box(g, 0, 1.12, -0.3, 2.8, 0.65, 0.12, wood);
    for (const a of [-1, 1]) box(g, a, 0.3, 0, 0.16, 0.6, 0.6);
  };
  // Deterministic placement keeps the landscape stable between levels.
  const scatter = (count, radius, y, geometry, mat, scale) => {
    const mesh = new T.InstancedMesh(geometry, mat, count), dummy = new T.Object3D();
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996, r = radius + (i % 9) * 1.4;
      dummy.position.set(Math.cos(a) * r, y, Math.sin(a) * r - 10);
      dummy.rotation.set(0, a, 0);
      dummy.scale.set(...scale.map(s => s * (0.7 + (i % 5) * 0.15)));
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    }
    scenery.add(mesh);
  };
  if (kind === 'lumen') {
    scatter(70, 33, 0.35, new T.IcosahedronGeometry(1, 1), stone, [1.5, 0.7, 1]);
    scatter(140, 30, 0.5, new T.ConeGeometry(0.3, 1.1, 4), leaf, [1, 1, 1]);
    bench(19, -10, -Math.PI / 2); bench(-20, 12, 0.6);
    for (const [x, z] of [[-5, 18], [6, 3], [-6, -16], [4, -36]]) lantern(x, z);
    // Reeds follow the lake's far bank, leaving its near shore open.
    for (let i = 0; i < 22; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 22;
      add(scenery, new T.CylinderGeometry(0.035, 0.05, 1.2 + i % 3 * 0.3, 4), leaf, 42 + Math.cos(a) * 17, 0.7, -12 + Math.sin(a) * 17);
    }
    for (let i = 0; i < 4; i++) {
      const ring = add(atmosphere, new T.RingGeometry(2 + i * 3, 2.06 + i * 3, 64), new T.MeshBasicMaterial({ color: '#a2c7d1', transparent: true, opacity: 0.14, depthWrite: false, side: T.DoubleSide }), 42, 0.035, -12);
      ring.rotation.x = -Math.PI / 2;
      moving.push(t => { ring.scale.setScalar(1 + Math.sin(t * 0.4 + i) * 0.09); });
    }
    add(atmosphere, new T.SphereGeometry(4, 24, 16), new T.MeshBasicMaterial({ color: '#dce8e5', fog: false }), -65, 60, -105);
  } else if (kind === 'starling') {
    scatter(65, 45, 0.3, new T.IcosahedronGeometry(1, 1), stone, [2, 1, 1.6]);
    bench(-18, 17, 0); bench(18, 17, 0);
    // Low terrace edging and observatory buildings sit outside the walking area.
    for (let i = 0; i < 40; i++) {
      const a = i * Math.PI * 2 / 40;
      const p = box(scenery, Math.cos(a) * 36, 0.3, Math.sin(a) * 36, 4.8, 0.6, 0.6);
      p.rotation.y = -a + Math.PI / 2;
    }
    for (const [x, z] of [[-45, -33], [48, 5]]) {
      add(scenery, new T.CylinderGeometry(5, 5.3, 4, 24), stone, x, 2, z);
      add(scenery, new T.SphereGeometry(5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), material('#71818b'), x, 4, z);
    }
    for (const x of [-27, 27]) for (const z of [-18, 8, 24]) lantern(x, z);
    // A faint, distant star field adds depth without resembling collectible objects.
    const positions = [];
    for (let i = 0; i < 320; i++) {
      const a = i * 2.39996, h = 40 + (i % 61);
      positions.push(Math.cos(a) * 140, h, Math.sin(a) * 140);
    }
    const stars = new T.BufferGeometry(); stars.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    atmosphere.add(new T.Points(stars, new T.PointsMaterial({ color: '#b9c9dd', size: 0.16, transparent: true, opacity: 0.6, depthWrite: false })));
  } else {
    // Unnamed islands beyond the puzzle have no beacons, labels or clickable surfaces.
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, x = Math.cos(a) * 80, z = Math.sin(a) * 80;
      const rock = add(scenery, new T.IcosahedronGeometry(6, 1), stone, x, -3, z);
      rock.scale.set(1.5, 0.65, 1);
      add(scenery, new T.CylinderGeometry(5.2, 6, 0.4, 12), leaf, x, 0, z);
      add(scenery, new T.ConeGeometry(2, 5, 7), leaf, x + 2, 2.5, z);
      if (i % 2 === 0) {
        const fall = box(atmosphere, x - 4, -8, z, 1.1, 16, 0.12, new T.MeshBasicMaterial({ color: '#c0e9ee', transparent: true, opacity: 0.3, depthWrite: false, side: T.DoubleSide }));
        moving.push(t => { fall.material.opacity = 0.26 + Math.sin(t * 0.8 + i) * 0.04; });
      }
    }
    // Harbor bollards and lanterns give the starting pier a human scale.
    for (const x of [-1.45, 1.45]) {
      lantern(x, 23, 0.75);
      for (const z of [21, 23]) add(scenery, new T.CylinderGeometry(0.13, 0.18, 0.6, 8), wood, x, 1.05, z);
    }
    const cloudMat = new T.MeshBasicMaterial({ color: '#edf5f5', transparent: true, opacity: 0.2, depthWrite: false });
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6, x = Math.cos(a) * 100, z = Math.sin(a) * 100;
      const cloud = add(atmosphere, new T.SphereGeometry(1, 12, 8), cloudMat, x, 20 + i % 3 * 6, z);
      cloud.scale.set(12, 2, 5);
      moving.push(t => { cloud.position.x = x + Math.sin(t * 0.025 + i) * 7; });
    }
  }
  return { scenery, lamps, atmosphere, update: t => moving.forEach(fn => fn(t)) };
}
