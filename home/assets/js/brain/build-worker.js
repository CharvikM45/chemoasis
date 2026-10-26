// Builds the brain mesh off the main thread, so the page scrolls smoothly while it loads.
// A rough brain first (in a fraction of a second), so it shows straight away, then the detailed one.
// Later, on request, single pieces as fine, solid objects for when they come up close.
import { buildBrainMesh, buildPieceSolid } from './mesh.js';

const send = (mesh) => self.postMessage(mesh, [mesh.position.buffer, mesh.normal.buffer, mesh.ao.buffer, mesh.shard.buffer, mesh.index.buffer, mesh.centre.buffer, mesh.out.buffer]);

self.onmessage = (e) => {
  const { step, preview, piece } = e.data || {};
  if (piece !== undefined) { send(buildPieceSolid(e.data)); return; }
  if (preview) send(buildBrainMesh({ step: preview }));
  send(buildBrainMesh({ step }));
};
