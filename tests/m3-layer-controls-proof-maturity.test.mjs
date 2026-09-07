import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  M3_LAYER_CONTROLS_P1_P2_ACCEPTED_SOURCE_COMMIT,
  M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_COMMIT,
  M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_RUN,
  M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_ARTIFACT,
  M3_LAYER_CONTROLS_P3_P4_ACCEPTED_SOURCE_COMMIT,
  M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_CONTROL_COMMIT,
  M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_RUN,
  M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_JOB,
  M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_ARTIFACT,
  M3_LAYER_CONTROLS_P5_ACCEPTED_SOURCE_COMMIT,
  M3_LAYER_CONTROLS_P5_ACCEPTANCE_CONTROL_COMMIT,
  M3_LAYER_CONTROLS_P5_ACCEPTANCE_RUN,
  M3_LAYER_CONTROLS_P5_ACCEPTANCE_JOB,
  M3_LAYER_CONTROLS_P5_ACCEPTANCE_ARTIFACT,
  applyM3LayerControlsAcceptedP1P2Evidence,
  m3LayerControlsP1P2MaturityForCapability,
  m3LayerControlsAcceptedProofMaturityForCapability,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-layer-controls-proof-maturity.js";
import { M3_LAYER_CONTROLS_CAPABILITIES_V16 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-layer-controls.js";

const acceptancePath = "proofs/diagnostics/m3-layer-controls-p5-run1-acceptance.md";
const foundationPath = "docs/14_M3_LAYER_CONTROLS_FOUNDATION.md";

const expectedCapabilities = [
  "ae.layer.switches.set",
  "ae.layer.order.set",
  "ae.layer.controls.readback",
];

test("M3 layer-controls historical P1/P2 structural maturity stays pinned to accepted evidence", () => {
  assert.equal(M3_LAYER_CONTROLS_P1_P2_ACCEPTED_SOURCE_COMMIT, "bf26b3a4351a947d130f792ca7a1a26aa6091a2c");
  assert.equal(M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_COMMIT, "48055f15bd7856f3aad8cde762c58b521324f187");
  assert.equal(M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_RUN, 34156910741);
  assert.equal(M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_ARTIFACT, 10031293005);
  for (const capabilityId of expectedCapabilities) {
    assert.equal(m3LayerControlsP1P2MaturityForCapability(capabilityId), "STRUCTURAL");
  }
  assert.equal(m3LayerControlsP1P2MaturityForCapability("ae.layer.future.unproven"), "DECLARED");
});

test("historical P1/P2 projection cannot promote an unproven layer capability to FULL", () => {
  const promoted = applyM3LayerControlsAcceptedP1P2Evidence([
    {
      id: "ae.layer.future.unproven",
      domain: "layer",
      description: "test",
      status: "FULL",
      proofMaturity: "ROBUST",
      routes: [],
      readbackStrategy: null,
      visualProofProfile: null,
      rollbackStrategy: null,
      riskClass: "R0_READ_ONLY",
      fallbackPolicy: "FORBID",
    },
  ]);
  assert.equal(promoted[0].status, "PARTIAL");
  assert.equal(promoted[0].proofMaturity, "DECLARED");
});

test("M3 layer-controls accepted P3/P4 visual and rollback evidence is pinned", () => {
  assert.equal(M3_LAYER_CONTROLS_P3_P4_ACCEPTED_SOURCE_COMMIT, "2aa9b979c80ca4c4f025918943e725a345cd29f6");
  assert.equal(M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_CONTROL_COMMIT, "7e493aa05af5d0cb98ad242c9b752f96fa14b14b");
  assert.equal(M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_RUN, 34159635705);
  assert.equal(M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_JOB, 101858554842);
  assert.equal(M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_ARTIFACT, 10032176111);
});

test("current M3 layer-controls registry reflects accepted P1-P5 transfer evidence", () => {
  assert.equal(M3_LAYER_CONTROLS_P5_ACCEPTED_SOURCE_COMMIT, "a6181c0af2f22fd83141625f6c5852ae0a27b786");
  assert.equal(M3_LAYER_CONTROLS_P5_ACCEPTANCE_CONTROL_COMMIT, "82e55f8b2c8ee868cf2ac168e27b0ef5c4579340");
  assert.equal(M3_LAYER_CONTROLS_P5_ACCEPTANCE_RUN, 34160617926);
  assert.equal(M3_LAYER_CONTROLS_P5_ACCEPTANCE_JOB, 101861547189);
  assert.equal(M3_LAYER_CONTROLS_P5_ACCEPTANCE_ARTIFACT, 10032484694);
  for (const capabilityId of expectedCapabilities) {
    assert.equal(m3LayerControlsAcceptedProofMaturityForCapability(capabilityId), "TRANSFER");
  }
  assert.equal(m3LayerControlsAcceptedProofMaturityForCapability("ae.layer.future.unproven"), "DECLARED");
  for (const capability of M3_LAYER_CONTROLS_CAPABILITIES_V16) {
    assert.equal(capability.status, "FULL");
    assert.equal(capability.proofMaturity, "TRANSFER");
  }
});

test("M3 layer-controls P5 acceptance record pins exact retained transfer evidence", async () => {
  const source = await readFile(acceptancePath, "utf8");
  assert.match(source, /a6181c0af2f22fd83141625f6c5852ae0a27b786/);
  assert.match(source, /34160504063/);
  assert.match(source, /101861183798/);
  assert.match(source, /82e55f8b2c8ee868cf2ac168e27b0ef5c4579340/);
  assert.match(source, /34160617926/);
  assert.match(source, /101861547189/);
  assert.match(source, /10032484694/);
  assert.match(source, /92ad6c675ae7908da79d4434011ea8e4df41cff587baa4f2e8d450c189cdf246/);
  assert.match(source, /fefea3198b35cf4a96d2e1a98735cf0c054436114edb651ab6aeb2fd6a4bb0bd/);
  assert.match(source, /5093cb9bf82885731d5d5fd1b6d2bc2d8a48d2d237939622af3dc4eed1131b3a/);
  assert.match(source, /eb09ad8f-43c6-41db-a4b2-2f7a41ee8001/);
  assert.match(source, /c8bfb5ad-84e8-4d11-811a-ae2107b85dfe/);
  assert.match(source, /Layer\.id = 38/);
  assert.match(source, /Layer\.id = 37/);
  assert.match(source, /P5 save\/reopen\/reconnect transfer is accepted/);
  assert.match(source, /`FULL` \+ `TRANSFER`/);
});

test("M3 layer-controls foundation records initial gate and final accepted transfer posture", async () => {
  const source = await readFile(foundationPath, "utf8");
  assert.match(source, /Protocol `1\.6\.0`/);
  assert.match(source, /Motion blur and frame blending are intentionally \*\*not\*\* folded into this tranche/);
  assert.match(source, /P1–P5/);
  assert.match(source, /34160617926/);
  assert.match(source, /10032484694/);
  assert.match(source, /`FULL \/ TRANSFER`/);
  assert.match(source, /Layer\.id/);
});
