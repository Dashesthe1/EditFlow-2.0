import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { asEnvironmentFingerprint } from "../.tmp/runtime/packages/core-contracts/src/index.js";
import {
  CapabilityRegistry,
  CapabilityResolutionError,
} from "../.tmp/runtime/packages/capability-registry/src/index.js";
import {
  M4_POINT_TRACKING_CAPABILITY_ID,
  registerM4TrackingFoundation,
} from "../.tmp/runtime/packages/capability-registry/src/m4.js";

const manifestPath = "proofs/manifests/m4-point-tracking-p1-p2.json";

test("M4 point-tracking manifest cannot promote capability before retained authenticated live-AE acceptance", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.proof_id, "M4_POINT_TRACK_REAL_AE_V1");
  assert.equal(manifest.status, "PENDING_LIVE_ACCEPTANCE");
  assert.equal(manifest.code_readiness_ci.verdict, "PASS");
  assert.equal(manifest.evidence.direct_real_ae_pixel_experiment.performed, true);
  assert.equal(manifest.evidence.direct_real_ae_pixel_experiment.retained_as_formal_acceptance_artifact, false);
  assert.equal(manifest.evidence.authenticated_warm_cep.verdict, "PENDING");
  assert.equal(manifest.evidence.authenticated_warm_cep.retained_result, false);
  assert.deepEqual(manifest.accepted_proof_levels, {
    P1_typed_live_validation: false,
    P2_semantic_tracking_readback: false,
    P3_visual_external_review: false,
    P4_failure_recovery: false,
    P5_transfer: false,
  });

  const registry = new CapabilityRegistry(asEnvironmentFingerprint("ENV_M4_PENDING_ACCEPTANCE"));
  registerM4TrackingFoundation(registry);
  const capability = registry.get(M4_POINT_TRACKING_CAPABILITY_ID);
  assert.ok(capability);
  assert.equal(capability.status, "ADAPTER_REQUIRED");
  assert.equal(capability.proofMaturity, "STRUCTURAL");
  assert.equal(capability.routes[0]?.available, false);
  assert.throws(
    () => registry.resolve(M4_POINT_TRACKING_CAPABILITY_ID),
    (error) => error instanceof CapabilityResolutionError && /no available route/.test(error.message),
  );
});
