import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const maturityPath = "packages/adapters/ae-cep/src/m3-layer-controls-proof-maturity.ts";
const capabilityPath = "packages/adapters/ae-cep/src/m3-layer-controls.ts";

test("protocol 1.6 records the accepted real-AE P1/P2 evidence immutably", async () => {
  const source = await readFile(maturityPath, "utf8");
  assert.match(source, /M3_LAYER_CONTROLS_P1_P2_ACCEPTED_SOURCE_COMMIT = "60fd64c67161f9799c3a123570625049c00330d5"/);
  assert.match(source, /M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "fbbd203a82968cfe5e33f6c048958e823aa52981"/);
  assert.match(source, /M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_RUN = 34145893380/);
  assert.match(source, /M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_ARTIFACT = 10027648642/);
  assert.match(source, /44969faa55382f98319ece5b875c32422d249668caa05b1c2c1d1c20e4cce53e/);
  assert.match(source, /"ae\.layer\.switches\.set": "STRUCTURAL"/);
  assert.match(source, /"ae\.layer\.switches\.readback": "STRUCTURAL"/);
});

test("protocol 1.6 capability descriptors consume accepted P1/P2 maturity", async () => {
  const source = await readFile(capabilityPath, "utf8");
  assert.match(source, /applyM3LayerControlsAcceptedP1P2Evidence/);
  assert.match(source, /M3_LAYER_CONTROLS_DECLARED_CAPABILITIES_V16/);
  assert.match(source, /applyM3LayerControlsAcceptedP1P2Evidence\(M3_LAYER_CONTROLS_DECLARED_CAPABILITIES_V16\)/);
});
