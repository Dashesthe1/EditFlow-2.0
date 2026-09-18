import test from "node:test";
import assert from "node:assert/strict";
import { asEnvironmentFingerprint } from "../.tmp/runtime/packages/core-contracts/src/index.js";
import {
  CapabilityRegistry,
  CapabilityResolutionError,
} from "../.tmp/runtime/packages/capability-registry/src/index.js";
import {
  M4_POINT_TRACKING_CAPABILITY_ID,
  registerM4TrackingFoundation,
} from "../.tmp/runtime/packages/capability-registry/src/m4.js";

test("M4 point tracking foundation is registered but remains unavailable to production planning", () => {
  const registry = new CapabilityRegistry(asEnvironmentFingerprint("ENV_M4_TEST"));
  registerM4TrackingFoundation(registry);
  const capability = registry.get(M4_POINT_TRACKING_CAPABILITY_ID);

  assert.ok(capability);
  assert.equal(capability.status, "ADAPTER_REQUIRED");
  assert.equal(capability.proofMaturity, "STRUCTURAL");
  assert.equal(capability.routes.length, 1);
  assert.equal(capability.routes[0]?.available, false);
  assert.equal(capability.riskClass, "R0_READ_ONLY");
  assert.equal(capability.visualProofProfile, "M4_POINT_TRACK_DRIFT_V1");
  assert.throws(
    () => registry.resolve(M4_POINT_TRACKING_CAPABILITY_ID),
    (error) => error instanceof CapabilityResolutionError && /no available route/.test(error.message),
  );
});
