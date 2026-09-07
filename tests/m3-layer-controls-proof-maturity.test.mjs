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
});

test("protocol 1.6 records independently accepted real-AE P3/P4 evidence and frame identity", async () => {
  const source = await readFile(maturityPath, "utf8");
  assert.match(source, /M3_LAYER_CONTROLS_P3_P4_ACCEPTED_SOURCE_COMMIT = "93b24ac73d93997021e2911b33d58d0cc581ae9d"/);
  assert.match(source, /M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_CONTROL_COMMIT = "88f5f6ea91a7566bfbd38998b02d4aa5fb750692"/);
  assert.match(source, /M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_RUN = 34147459879/);
  assert.match(source, /M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_ARTIFACT = 10028180326/);
  assert.match(source, /0ef700c058674c01b4ea4f64dea52b47c4ecd5e03e41644477d9f8803d027fc2/);
  assert.match(source, /M3_LAYER_CONTROLS_P3_ENABLED_FRAME_SHA256 = "f418efd40f346eb601f2293bf3bad687abadf1934d67a437b318459a08ed9659"/);
  assert.match(source, /M3_LAYER_CONTROLS_P3_DISABLED_FRAME_SHA256 = "02b758b136d2da389a5f01ee31076e199d7002fa95b30767a94ec80a70ee78fa"/);
  assert.match(source, /M3_LAYER_CONTROLS_P3_RESTORED_FRAME_SHA256 = M3_LAYER_CONTROLS_P3_ENABLED_FRAME_SHA256/);
  assert.match(source, /M3_LAYER_CONTROLS_P4_RECOVERY_FRAME_SHA256 = M3_LAYER_CONTROLS_P3_ENABLED_FRAME_SHA256/);
  assert.match(source, /"ae\.layer\.switches\.set": "ROLLBACK"/);
  assert.match(source, /"ae\.layer\.switches\.readback": "STRUCTURAL"/);
  assert.doesNotMatch(source, /"ae\.layer\.switches\.set": "TRANSFER"/);
});

test("protocol 1.6 capability descriptors consume accepted evidence while P5 remains outstanding", async () => {
  const source = await readFile(capabilityPath, "utf8");
  assert.match(source, /applyM3LayerControlsAcceptedEvidence/);
  assert.match(source, /M3_LAYER_CONTROLS_DECLARED_CAPABILITIES_V16/);
  assert.match(source, /applyM3LayerControlsAcceptedEvidence\(M3_LAYER_CONTROLS_DECLARED_CAPABILITIES_V16\)/);
});
