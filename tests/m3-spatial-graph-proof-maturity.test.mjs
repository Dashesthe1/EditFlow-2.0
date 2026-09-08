import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  M3_SPATIAL_GRAPH_P1_P2_ACCEPTED_SOURCE_COMMIT,
  M3_SPATIAL_GRAPH_P1_P2_ACCEPTANCE_RUN,
  M3_SPATIAL_GRAPH_P1_P2_ACCEPTANCE_ARTIFACT,
  M3_SPATIAL_GRAPH_P3_P4_ACCEPTED_SOURCE_COMMIT,
  M3_SPATIAL_GRAPH_P3_P4_ACCEPTANCE_RUN,
  M3_SPATIAL_GRAPH_P3_P4_ACCEPTANCE_ARTIFACT,
  M3_SPATIAL_GRAPH_P5_ACCEPTED_SOURCE_COMMIT,
  M3_SPATIAL_GRAPH_P5_ACCEPTANCE_CONTROL_COMMIT,
  M3_SPATIAL_GRAPH_P5_ACCEPTANCE_RUN,
  M3_SPATIAL_GRAPH_P5_ACCEPTANCE_JOB,
  M3_SPATIAL_GRAPH_P5_ACCEPTANCE_ARTIFACT,
  applyM3SpatialGraphAcceptedP1P2Evidence,
  m3SpatialGraphP1P2MaturityForCapability,
  m3SpatialGraphAcceptedProofMaturityForCapability,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-spatial-graph-proof-maturity.js";
import { M3_SPATIAL_GRAPH_CAPABILITIES_V19 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-spatial-graph.js";

const acceptancePath = "proofs/diagnostics/m3-spatial-graph-p5-acceptance.json";
const expectedCapabilities = [
  "ae.property.spatial_graph.set",
  "ae.property.spatial_graph.readback",
];

test("spatial Graph Editor P1/P2 maturity is pinned to accepted structural evidence", () => {
  assert.equal(M3_SPATIAL_GRAPH_P1_P2_ACCEPTED_SOURCE_COMMIT, "041f2db8ee01095dfa6de7ecf9c2de29a232c17b");
  assert.equal(M3_SPATIAL_GRAPH_P1_P2_ACCEPTANCE_RUN, 34182897797);
  assert.equal(M3_SPATIAL_GRAPH_P1_P2_ACCEPTANCE_ARTIFACT, 10039524832);
  for (const capabilityId of expectedCapabilities) {
    assert.equal(m3SpatialGraphP1P2MaturityForCapability(capabilityId), "STRUCTURAL");
  }
  assert.equal(m3SpatialGraphP1P2MaturityForCapability("ae.property.spatial_graph.future"), "DECLARED");
});

test("historical spatial P1/P2 projection cannot promote an unproven capability to FULL", () => {
  const projected = applyM3SpatialGraphAcceptedP1P2Evidence([{
    id: "ae.property.spatial_graph.future",
    domain: "animation",
    description: "test",
    status: "FULL",
    proofMaturity: "ROBUST",
    routes: [],
    readbackStrategy: null,
    visualProofProfile: null,
    rollbackStrategy: null,
    riskClass: "R0_READ_ONLY",
    fallbackPolicy: "FORBID",
  }]);
  assert.equal(projected[0].status, "PARTIAL");
  assert.equal(projected[0].proofMaturity, "DECLARED");
});

test("accepted spatial Graph Editor registry is FULL only after retained P1-P5 transfer evidence", () => {
  assert.equal(M3_SPATIAL_GRAPH_P3_P4_ACCEPTED_SOURCE_COMMIT, "0c297200af3563d2f714d61a2df718af81cd1d4c");
  assert.equal(M3_SPATIAL_GRAPH_P3_P4_ACCEPTANCE_RUN, 34184591197);
  assert.equal(M3_SPATIAL_GRAPH_P3_P4_ACCEPTANCE_ARTIFACT, 10070526495);
  assert.equal(M3_SPATIAL_GRAPH_P5_ACCEPTED_SOURCE_COMMIT, "d42600e0d1004c71d91296bc6e4c31981d9a62a6");
  assert.equal(M3_SPATIAL_GRAPH_P5_ACCEPTANCE_CONTROL_COMMIT, "5ebff93d9e13681914da558eb16c1c9b96f27617");
  assert.equal(M3_SPATIAL_GRAPH_P5_ACCEPTANCE_RUN, 34264619734);
  assert.equal(M3_SPATIAL_GRAPH_P5_ACCEPTANCE_JOB, 102190765510);
  assert.equal(M3_SPATIAL_GRAPH_P5_ACCEPTANCE_ARTIFACT, 10071318446);
  for (const capabilityId of expectedCapabilities) {
    assert.equal(m3SpatialGraphAcceptedProofMaturityForCapability(capabilityId), "TRANSFER");
  }
  assert.equal(m3SpatialGraphAcceptedProofMaturityForCapability("ae.property.spatial_graph.future"), "DECLARED");
  for (const capability of M3_SPATIAL_GRAPH_CAPABILITIES_V19) {
    assert.equal(capability.status, "FULL");
    assert.equal(capability.proofMaturity, "TRANSFER");
  }
});

test("spatial P5 acceptance record pins exact transfer provenance and remains bounded below ROBUST", async () => {
  const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
  assert.equal(acceptance.proofId, "M3_SPATIAL_GRAPH_P5_ACCEPTANCE");
  assert.equal(acceptance.protocolVersion, "1.9.0");
  assert.equal(acceptance.accepted, true);
  assert.equal(acceptance.provenance.acceptedSourceCommit, M3_SPATIAL_GRAPH_P5_ACCEPTED_SOURCE_COMMIT);
  assert.equal(acceptance.provenance.controlCommit, M3_SPATIAL_GRAPH_P5_ACCEPTANCE_CONTROL_COMMIT);
  assert.equal(acceptance.provenance.workflowRunId, M3_SPATIAL_GRAPH_P5_ACCEPTANCE_RUN);
  assert.equal(acceptance.provenance.jobId, M3_SPATIAL_GRAPH_P5_ACCEPTANCE_JOB);
  assert.equal(acceptance.provenance.artifactId, M3_SPATIAL_GRAPH_P5_ACCEPTANCE_ARTIFACT);
  assert.deepEqual(acceptance.proofLevels, {
    P1_validation_rejection: true,
    P2_structural_readback: true,
    P3_visual_proof: true,
    P4_failure_injection_rollback: true,
    P5_save_reopen_reconnect_transfer: true,
  });
  assert.equal(acceptance.transferEvidence.savedNativeLayerId, 25);
  assert.equal(acceptance.transferEvidence.reopenedNativeLayerId, 25);
  assert.equal(acceptance.transferEvidence.nativeLayerIdPreserved, true);
  assert.equal(acceptance.transferEvidence.cleanupFingerprintRestored, true);
  assert.ok(acceptance.limitations.some((entry) => /ROBUST maturity/.test(entry)));
});
