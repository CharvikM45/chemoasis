// Builds the brain mesh off the main thread, so the page scrolls smoothly while it loads.
// A rough brain first (in a fraction of a second), so it shows straight away, then the detailed one.
import { buildBrainMesh } from './mesh.js';

const send = (mesh) => self.postMessage(mesh, [mesh.position.buffer, mesh.normal.buffer, mesh.ao.buffer, mesh.shard.buffer, mesh.index.buffer, mesh.centre.buffer, mesh.out.buffer]);

self.onmessage = (e) => {
  const { step, preview } = e.data || {};
  if (preview) send(buildBrainMesh({ step: preview }));
  send(buildBrainMesh({ step }));
};
