import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  M3_MOTION_RENDER_P1_P2_ACCEPTED_SOURCE_COMMIT,
  M3_MOTION_RENDER_P1_P2_ACCEPTANCE_CONTROL_COMMIT,
  M3_MOTION_RENDER_P1_P2_ACCEPTANCE_RUN,
  M3_MOTION_RENDER_P1_P2_ACCEPTANCE_JOB,
  M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT,
  M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT_SHA256,
  M3_MOTION_RENDER_P1_P2_RESULT_SHA256,
  applyM3MotionRenderAcceptedP1P2Evidence,
  m3MotionRenderP1P2MaturityForCapability,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-motion-render-proof-maturity.js";
import { M3_MOTION_RENDER_CAPABILITIES_V110 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-motion-render.js";

const acceptancePath = "proofs/diagnostics/m3-motion-render-p1-p2-acceptance.json";
const expectedCapabilities = [
  "ae.comp.motion_render.set",
  "ae.layer.motion_render.set",
  "ae.motion_render.readback",
];

test("motion-render P1/P2 maturity is pinned to retained real-AE structural evidence", () => {
  assert.equal(M3_MOTION_RENDER_P1_P2_ACCEPTED_SOURCE_COMMIT, "70b1549c56179689fb033db36f13fc4b6dbb5998");
  assert.equal(M3_MOTION_RENDER_P1_P2_ACCEPTANCE_CONTROL_COMMIT, "34adbd69d6cfb847c2900551cd5ee6caa872981a");
  assert.equal(M3_MOTION_RENDER_P1_P2_ACCEPTANCE_RUN, 34275036819);
  assert.equal(M3_MOTION_RENDER_P1_P2_ACCEPTANCE_JOB, 102225850170);
  assert.equal(M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT, 10075375705);
  assert.equal(M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT_SHA256, "16ae4571d870aefba43e432016b93e8db6efc2060c49eea841315247d3ed9014");
  assert.equal(M3_MOTION_RENDER_P1_P2_RESULT_SHA256, "d29b4ecb1898aacd4b706421e338254e50d525a86449b9c62b47b939e3004927");
  for (const capabilityId of expectedCapabilities) {
    assert.equal(m3MotionRenderP1P2MaturityForCapability(capabilityId), "STRUCTURAL");
  }
  assert.equal(m3MotionRenderP1P2MaturityForCapability("ae.motion_render.future"), "DECLARED");
});

test("motion-render capabilities stay PARTIAL at P1/P2 and cannot overclaim visual or transfer maturity", () => {
  for (const capability of M3_MOTION_RENDER_CAPABILITIES_V110) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "STRUCTURAL");
  }
  const projected = applyM3MotionRenderAcceptedP1P2Evidence([{
    id: "ae.motion_render.future",
    domain: "render",
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

test("motion-render P1/P2 acceptance record pins exact evidence and leaves P3/P4/P5 false", async () => {
  const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
  assert.equal(acceptance.proofId, "M3_MOTION_RENDER_P1_P2_ACCEPTANCE");
  assert.equal(acceptance.protocolVersion, "1.10.0");
  assert.equal(acceptance.accepted, true);
  assert.equal(acceptance.provenance.acceptedSourceCommit, M3_MOTION_RENDER_P1_P2_ACCEPTED_SOURCE_COMMIT);
  assert.equal(acceptance.provenance.controlCommit, M3_MOTION_RENDER_P1_P2_ACCEPTANCE_CONTROL_COMMIT);
  assert.equal(acceptance.provenance.workflowRunId, M3_MOTION_RENDER_P1_P2_ACCEPTANCE_RUN);
  assert.equal(acceptance.provenance.jobId, M3_MOTION_RENDER_P1_P2_ACCEPTANCE_JOB);
  assert.equal(acceptance.provenance.artifactId, M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT);
  assert.deepEqual(acceptance.proofLevels, {
    P1_validation_rejection: true,
    P2_structural_readback: true,
    P3_visual_proof: false,
    P4_failure_injection_rollback: false,
    P5_save_reopen_reconnect_transfer: false,
  });
  assert.deepEqual(acceptance.structuralEvidence.compositionSettings, {
    motionBlur: true,
    frameBlending: true,
    shutterAngle: 270,
    shutterPhase: -90,
    samplesPerFrame: 16,
    adaptiveSampleLimit: 64,
  });
  assert.equal(acceptance.structuralEvidence.frameMix.derivedFrameBlending, true);
  assert.equal(acceptance.structuralEvidence.pixelMotion.derivedFrameBlending, true);
  assert.equal(acceptance.structuralEvidence.noFrameBlend.derivedFrameBlending, false);
  assert.equal(acceptance.structuralEvidence.cleanupFingerprintRestored, true);
  assert.ok(acceptance.limitations.some((entry) => /STRUCTURAL maturity only/.test(entry)));
  assert.ok(acceptance.limitations.some((entry) => /Production runtime remains on accepted protocol 1\.9/.test(entry)));
});
