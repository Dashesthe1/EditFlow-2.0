import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { M3_MARKER_MOTION_CAPABILITIES_V20 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-marker-motion.js";
import {
  M3_MARKER_MOTION_P1_P2_ACCEPTED_SOURCE_COMMIT,
  M3_MARKER_MOTION_P1_P2_ACCEPTANCE_CONTROL_COMMIT,
  M3_MARKER_MOTION_P1_P2_ACCEPTANCE_RUN,
  M3_MARKER_MOTION_P1_P2_ACCEPTANCE_JOB,
  M3_MARKER_MOTION_P1_P2_ACCEPTANCE_ARTIFACT,
  M3_MARKER_MOTION_P1_P2_ACCEPTANCE_ARTIFACT_SHA256,
  M3_MARKER_MOTION_P3_ACCEPTED_SOURCE_COMMIT,
  M3_MARKER_MOTION_P3_ACCEPTANCE_CONTROL_COMMIT,
  M3_MARKER_MOTION_P3_ACCEPTANCE_RUN,
  M3_MARKER_MOTION_P3_ACCEPTANCE_JOB,
  M3_MARKER_MOTION_P3_ACCEPTANCE_ARTIFACT,
  M3_MARKER_MOTION_P3_ACCEPTANCE_ARTIFACT_SHA256,
  M3_MARKER_MOTION_P3_ACCEPTANCE_PROOF_CLI_SHA256,
  M3_MARKER_MOTION_P4_ACCEPTED_SOURCE_COMMIT,
  M3_MARKER_MOTION_P4_ACCEPTANCE_CONTROL_COMMIT,
  M3_MARKER_MOTION_P4_ACCEPTANCE_RUN,
  M3_MARKER_MOTION_P4_ACCEPTANCE_JOB,
  M3_MARKER_MOTION_P4_ACCEPTANCE_ARTIFACT,
  M3_MARKER_MOTION_P4_ACCEPTANCE_ARTIFACT_SHA256,
  M3_MARKER_MOTION_P5_ACCEPTED_SOURCE_COMMIT,
  M3_MARKER_MOTION_P5_ACCEPTANCE_CONTROL_COMMIT,
  M3_MARKER_MOTION_P5_ACCEPTANCE_RUN,
  M3_MARKER_MOTION_P5_ACCEPTANCE_JOB,
  M3_MARKER_MOTION_P5_ACCEPTANCE_ARTIFACT,
  M3_MARKER_MOTION_P5_ACCEPTANCE_ARTIFACT_SHA256,
  M3_MARKER_MOTION_P5_RESULT_SHA256,
  M3_MARKER_MOTION_P5_SAVED_PROJECT_SHA256,
  applyM3MarkerMotionAcceptedP1P2Evidence,
  m3MarkerMotionAcceptedProofMaturityForCapability,
  m3MarkerMotionP1P2MaturityForCapability,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-marker-motion-proof-maturity.js";

const ids = [
  "ae.marker.set", "ae.marker.remove", "ae.marker.readback",
  "ae.comp.motion.set", "ae.comp.motion.readback",
  "ae.layer.motion.set", "ae.layer.motion.readback",
];

test("marker-motion proof provenance is pinned to retained real-AE evidence", () => {
  assert.deepEqual([
    M3_MARKER_MOTION_P1_P2_ACCEPTED_SOURCE_COMMIT,
    M3_MARKER_MOTION_P1_P2_ACCEPTANCE_CONTROL_COMMIT,
    M3_MARKER_MOTION_P1_P2_ACCEPTANCE_RUN,
    M3_MARKER_MOTION_P1_P2_ACCEPTANCE_JOB,
    M3_MARKER_MOTION_P1_P2_ACCEPTANCE_ARTIFACT,
    M3_MARKER_MOTION_P1_P2_ACCEPTANCE_ARTIFACT_SHA256,
  ], ["454cc19cd7b6c676f9dab15122432ca64d82c7d8", "16146cb00ebcef2b0a34ec629875dfee53f1ca73", 34286914057, 102264510880, 10079885025, "75bd92ea1661b0871f73b2368f6bcce217956b311aa73b722fedd2c13b420ade"]);
  assert.deepEqual([
    M3_MARKER_MOTION_P3_ACCEPTED_SOURCE_COMMIT, M3_MARKER_MOTION_P3_ACCEPTANCE_CONTROL_COMMIT,
    M3_MARKER_MOTION_P3_ACCEPTANCE_RUN, M3_MARKER_MOTION_P3_ACCEPTANCE_JOB,
    M3_MARKER_MOTION_P3_ACCEPTANCE_ARTIFACT, M3_MARKER_MOTION_P3_ACCEPTANCE_ARTIFACT_SHA256,
    M3_MARKER_MOTION_P3_ACCEPTANCE_PROOF_CLI_SHA256,
  ], ["59688365d879530bb79efe4746745da720ecbeaa", "868246515d7cd0fb1c4dcbf84c55be57b470f896", 34506818837, 102970927495, 10164183740, "4c7af69295ab5f9274f63e50b7a388a211ee3c75bd3e681629986554148b5809", "a86de953b5b3ccf243f8fdf89dba80af6f361f9d5354b263966b44376bcc221d"]);
  assert.deepEqual([
    M3_MARKER_MOTION_P4_ACCEPTED_SOURCE_COMMIT, M3_MARKER_MOTION_P4_ACCEPTANCE_CONTROL_COMMIT,
    M3_MARKER_MOTION_P4_ACCEPTANCE_RUN, M3_MARKER_MOTION_P4_ACCEPTANCE_JOB,
    M3_MARKER_MOTION_P4_ACCEPTANCE_ARTIFACT, M3_MARKER_MOTION_P4_ACCEPTANCE_ARTIFACT_SHA256,
  ], ["62c21fa868cd19b0bc51530222cb310bc05bb524", "28c38604f7f78655c854722d874e5bf90ce3b3d1", 34508045587, 102974965343, 10164628534, "1785d94837928b8b56929e15e42cf8ff2d4e90072438ca9dc4a7a386293e0eb8"]);
  assert.deepEqual([
    M3_MARKER_MOTION_P5_ACCEPTED_SOURCE_COMMIT, M3_MARKER_MOTION_P5_ACCEPTANCE_CONTROL_COMMIT,
    M3_MARKER_MOTION_P5_ACCEPTANCE_RUN, M3_MARKER_MOTION_P5_ACCEPTANCE_JOB,
    M3_MARKER_MOTION_P5_ACCEPTANCE_ARTIFACT, M3_MARKER_MOTION_P5_ACCEPTANCE_ARTIFACT_SHA256,
    M3_MARKER_MOTION_P5_RESULT_SHA256, M3_MARKER_MOTION_P5_SAVED_PROJECT_SHA256,
  ], ["d9bc3e4debb31bdb7c08d35f289ccabab29f3804", "1bb5dff7970877507f3814a84412d4b374c6a038", 34507680568, 102973777466, 10164488951, "86dce7ee3438a5bf0c4776de8bba5973f85235b88a801fe586422473d01b21fe", "e62b3442e6341e3422d6e31855c7d8e360a35ec38f791e29f35d288c8b9933b8", "a42134fb1ac6c2581cc54fd9dfc01829aabbe853c3fb52b9f2190339c75d99df"]);
});

test("historical P1/P2 evidence is structural only and unknown IDs fail closed", () => {
  for (const id of ids) assert.equal(m3MarkerMotionP1P2MaturityForCapability(id), "STRUCTURAL");
  assert.equal(m3MarkerMotionP1P2MaturityForCapability("ae.marker.unknown"), "DECLARED");
  assert.equal(m3MarkerMotionAcceptedProofMaturityForCapability("ae.marker.unknown"), "DECLARED");
  const historical = applyM3MarkerMotionAcceptedP1P2Evidence(M3_MARKER_MOTION_CAPABILITIES_V20);
  for (const capability of historical) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "STRUCTURAL");
  }
});

test("accepted P1-P5 projection promotes only the seven bounded capabilities to transfer", () => {
  assert.equal(M3_MARKER_MOTION_CAPABILITIES_V20.length, 7);
  assert.deepEqual(M3_MARKER_MOTION_CAPABILITIES_V20.map((c) => String(c.id)).sort(), [...ids].sort());
  for (const capability of M3_MARKER_MOTION_CAPABILITIES_V20) {
    assert.equal(capability.status, "FULL");
    assert.equal(capability.proofMaturity, "TRANSFER");
  }
});

test("acceptance record and strong visual fixture match the pinned evidence", async () => {
  const acceptance = JSON.parse(await readFile("proofs/diagnostics/m3-marker-motion-p5-acceptance.json", "utf8"));
  const fixture = JSON.parse(await readFile("proofs/fixtures/m3-marker-motion-p3-visual.json", "utf8"));
  assert.equal(acceptance.protocolVersion, "2.0.0");
  assert.equal(acceptance.accepted, true);
  assert.deepEqual(Object.values(acceptance.proofLevels), [true, true, true, true, true]);
  assert.equal(acceptance.provenance.p3.workflowRunId, M3_MARKER_MOTION_P3_ACCEPTANCE_RUN);
  assert.equal(acceptance.provenance.p3.artifactId, M3_MARKER_MOTION_P3_ACCEPTANCE_ARTIFACT);
  assert.equal(acceptance.provenance.p3.proofCliSha256, M3_MARKER_MOTION_P3_ACCEPTANCE_PROOF_CLI_SHA256);
  assert.equal(acceptance.provenance.p4.elapsedMs, 15995);
  assert.ok(acceptance.provenance.p4.elapsedMs < acceptance.provenance.p4.speedTargetMs);
  assert.equal(acceptance.transferEvidence.sessionsDistinct, true);
  assert.equal(acceptance.transferEvidence.cleanupComplete, true);
  assert.deepEqual(fixture.positionMotion, { start: [-80, 90], end: [400, 90], durationSeconds: 0.5 });
  assert.equal(fixture.acceptedEvidence.workflowRunId, M3_MARKER_MOTION_P3_ACCEPTANCE_RUN);
  assert.equal(fixture.acceptedEvidence.artifactId, M3_MARKER_MOTION_P3_ACCEPTANCE_ARTIFACT);
});
