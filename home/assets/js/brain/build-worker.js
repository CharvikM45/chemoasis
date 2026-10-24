// Builds the brain mesh off the main thread, so the page scrolls smoothly while it loads.
import { buildBrainMesh } from './mesh.js';

self.onmessage = (e) => {
  const mesh = buildBrainMesh(e.data || {});
  self.postMessage(mesh, [mesh.position.buffer, mesh.normal.buffer, mesh.shard.buffer, mesh.index.buffer, mesh.centre.buffer, mesh.out.buffer]);
};
