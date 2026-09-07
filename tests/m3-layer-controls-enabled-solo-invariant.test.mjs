import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls.jsx";

test("protocol 1.6 rejects the AE-unrepresentable disabled plus solo state before mutation", async () => {
  const source = await readFile(hostPath, "utf8");
  const helperStart = source.indexOf("function requireRepresentableSwitchState(readback, patch)");
  const helperEnd = source.indexOf("\n  function setQuality", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "representability guard must be present");
  const helper = source.slice(helperStart, helperEnd);

  assert.match(helper, /finalEnabled === false && finalSolo === true/);
  assert.match(helper, /LAYER_SOLO_REQUIRES_ENABLED/);
  assert.match(helper, /request enabled:true or solo:false in the same atomic patch/);

  const executeStart = source.indexOf("function execute(request)");
  const mutationStart = source.indexOf('app.beginUndoGroup("EditFlow M3 layer switches")', executeStart);
  const guardCall = source.indexOf("requireRepresentableSwitchState(beforeReadback, prepared.patch);", executeStart);
  assert.ok(guardCall >= 0 && mutationStart > guardCall,
    "unrepresentable enabled/solo combinations must reject before the AE undo-group mutation begins");
});
