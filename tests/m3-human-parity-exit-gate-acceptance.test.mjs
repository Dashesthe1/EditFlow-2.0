import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { getMcpServerStatus } from "../.tmp/runtime/apps/mcp-server/src/index.js";
import { AE_RUNTIME_CAPABILITY_FAMILIES } from "../.tmp/runtime/apps/desktop-host/src/ae-runtime-capabilities.js";

const manifestPath = "proofs/diagnostics/m3-human-parity-exit-gate-acceptance.json";

test("M3 human-parity exit gate is pinned to immutable real-AE P3/P5 evidence", async () => {
  const proof = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(proof.status, "ACCEPTED");
  assert.equal(proof.milestone, "M3_HUMAN_PARITY_CORE");
  assert.equal(proof.milestoneVersion, "0.4.0-dev");
  assert.match(proof.exitGate, /geometry, mattes and curves are not approximated/);

  assert.equal(proof.p3IntegratedVisual.runId, 34512695690);
  assert.equal(proof.p3IntegratedVisual.jobId, 102990474226);
  assert.equal(proof.p3IntegratedVisual.artifactId, 10166426411);
  assert.equal(proof.p3IntegratedVisual.sha256, "56ba74d124bd58da6867b9b9297a66448273a6cf6bd8bb31c2cfc6168bd1d03d");
  assert.equal(proof.p3IntegratedVisual.coreElapsedMs, 17281);
  assert.equal(proof.p3IntegratedVisual.speedTargetMet, true);
  assert.equal(proof.p3IntegratedVisual.independentVisualReview, "ACCEPTED");

  assert.equal(proof.p5IntegratedTransfer.runId, 34513732049);
  assert.equal(proof.p5IntegratedTransfer.jobId, 102993899373);
  assert.equal(proof.p5IntegratedTransfer.artifactId, 10166846750);
  assert.equal(proof.p5IntegratedTransfer.sha256, "e5b2792b27fad8b36bdf1edf5f59052b4c1b644bc0d9d4c8046bbbab65252f6e");
  assert.equal(proof.p5IntegratedTransfer.coreElapsedMs, 41914);
  assert.equal(proof.p5IntegratedTransfer.boundedLifecycleException, true);
  assert.equal(proof.p5IntegratedTransfer.boundedLifecycleCeilingMs, 55000);
  assert.equal(proof.p5IntegratedTransfer.geometryMattesCurvesTransferred, true);
  assert.equal(proof.p5IntegratedTransfer.cleanupComplete, true);
  assert.notEqual(proof.p5IntegratedTransfer.initialSessionId, proof.p5IntegratedTransfer.reconnectedSessionId);

  assert.ok(Object.values(proof.proofLevels).every(Boolean));
  assert.equal(proof.cleanup.finalBlankUnsavedProject, true);
  assert.equal(proof.cleanup.aeRestartRequired, false);
});

test("all accepted M3 protocol families remain present when M4 begins", () => {
  const byProtocol = new Map(AE_RUNTIME_CAPABILITY_FAMILIES.map((family) => [family.protocolVersion, family]));
  for (const protocol of ["1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0", "1.9.0", "2.0.0"]) {
    const family = byProtocol.get(protocol);
    assert.ok(family, `missing accepted M3 protocol family ${protocol}`);
    assert.equal(family.acceptanceStatus, "ACCEPTED", `${protocol} must remain accepted`);
  }
});

test("MCP status closes M3 and opens M4 without weakening accepted M3 history", () => {
  const status = getMcpServerStatus();
  assert.equal(status.version, "0.5.0-dev");
  assert.equal(status.phase, "M4_TRACKING_ISOLATION_IN_PROGRESS");
  assert.equal(status.acceptedM3HostProtocols, "1.2.0_THROUGH_2.0.0_REGISTERED");
  assert.equal(status.m3LatestHostProtocol, "2.0.0_TRANSFER_ACCEPTED");
  assert.equal(status.m3ExitGate, "OBJECT_MASK_GEOMETRY_MATTE_CURVES_TRANSFER_ACCEPTED");
  assert.equal(status.trackingIsolation, "POINT_TRACKING_NEXT");
});
