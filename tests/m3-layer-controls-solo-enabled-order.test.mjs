import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls.jsx";

test("protocol 1.6 applies Solo while the layer is enabled and commits enabled last", async () => {
  const source = await readFile(hostPath, "utf8");
  const start = source.indexOf("function applyPatch(layer, patch)");
  const end = source.indexOf("\n\n  function execute(request)", start);
  assert.ok(start >= 0 && end > start, "applyPatch source must be present");
  const body = source.slice(start, end);

  assert.match(body, /if \(own\(patch, "solo"\)\)/);
  assert.match(body, /if \(enabledBeforeSolo === false\) \{[\s\S]*setBoolean\(layer, "enabled", true\);[\s\S]*temporarilyEnabledForSolo = true;/);
  assert.match(body, /else if \(temporarilyEnabledForSolo\) setBoolean\(layer, "enabled", false\);/);

  const soloWrite = body.indexOf('setBoolean(layer, "solo", patch.solo);');
  const finalEnabledWrite = body.indexOf('if (own(patch, "enabled")) setBoolean(layer, "enabled", patch.enabled);');
  const finalLockWrite = body.indexOf('if (own(patch, "locked") && patch.locked === true) setBoolean(layer, "locked", true);');
  assert.ok(soloWrite >= 0 && finalEnabledWrite > soloWrite,
    "AE rejects Solo writes on disabled layers, so Solo must be applied before the requested final enabled state");
  assert.ok(finalLockWrite > finalEnabledWrite,
    "the final lock write must remain last so the atomic patch cannot lock itself out");
});
