import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_null_rigs.jsx";

test("null-rig P4 proof injection is fixed, doubly gated, post-create, and uses AE Undo recovery", async () => {
  const source = await readFile(hostPath, "utf8");

  assert.match(source, /request\.readbackProfile === "M3_NULL_RIG_P4_FAILURE_INJECTION"/);
  assert.match(source, /\$\.getenv\("EDITFLOW_M3_NULL_RIG_P4_PROOF"\) === "1"/);
  assert.match(source, /M3_NULL_RIG_P4_INDUCED_FAILURE/);
  assert.match(source, /PROOF_INJECTION/);
  assert.match(source, /Failed null-rig mutation self-rolled back with AE Undo\./);
  assert.match(source, /app\.executeCommand\(16\)/);

  const createIndex = source.indexOf("prepared.comp.layers.addNull");
  const sourceMarkerIndex = source.indexOf("createdSource.comment = nullSourceMarker");
  const ownershipIndex = source.indexOf("prepared.rig = rig");
  const injectionIndex = source.indexOf('request.readbackProfile === "M3_NULL_RIG_P4_FAILURE_INJECTION"');
  const endUndoIndex = source.indexOf("app.endUndoGroup();", injectionIndex);

  assert.ok(createIndex >= 0, "P4 host must perform a real addNull mutation");
  assert.ok(sourceMarkerIndex > createIndex, "managed backing-source ownership must be written after addNull");
  assert.ok(ownershipIndex > sourceMarkerIndex, "created rig must be bound before the proof hook");
  assert.ok(injectionIndex > ownershipIndex, "P4 failure must occur only after real managed-null creation/ownership");
  assert.ok(endUndoIndex > injectionIndex, "P4 failure must be thrown inside the normal undo group");

  assert.doesNotMatch(source, /M3_NULL_RIG_P4_INDUCED_FAILURE[\s\S]*rig\.null\.remove/,
    "P4 injection is create-only and must not create a destructive-remove proof shortcut");
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /new Function\s*\(/);
});
