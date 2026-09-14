import test from "node:test";
import assert from "node:assert/strict";

import {
  M4_SAM31_LOCAL_SEGMENTATION_CAPABILITY_V1,
} from "../.tmp/runtime/packages/adapters/sam3-local/src/index.js";

test("SAM 3.1 local capability stays unavailable until gated checkpoint proof is retained", () => {
  const capability = M4_SAM31_LOCAL_SEGMENTATION_CAPABILITY_V1;
  assert.equal(capability.id, "tracking.segmentation.subject_object.sam3_1.local");
  assert.equal(capability.proofMaturity, "DECLARED");
  assert.equal(capability.riskClass, "R0_READ_ONLY");
  assert.ok(capability.routes.every((route) => route.available === false));
  assert.ok(capability.limitations.some((value) => value.includes("presence-score risk proxy")));
});
