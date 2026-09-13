import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_TRACKER_REPAIR_PROTOCOL_VERSION_V24,
  AE_TRACKER_REPAIR_COMMANDS_V24,
  capabilityForTrackerRepairCommandV24,
  isAeTrackerRepairMutationCommandV24,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_4.js";
import {
  M4_TRACKER_REPAIR_READBACK_CAPABILITY_V24,
  M4_TRACKER_REPAIR_WRITE_CAPABILITY_V24,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-repair-resume.js";

test("protocol 2.4 is tracker-repair-specific and mutation classification is exact", () => {
  assert.equal(AE_TRACKER_REPAIR_PROTOCOL_VERSION_V24, "2.4.0");
  assert.deepEqual(AE_TRACKER_REPAIR_COMMANDS_V24, [
    "tracker.repair.readback",
    "tracker.repair.set_feature_center",
  ]);
  assert.equal(capabilityForTrackerRepairCommandV24("tracker.repair.readback"), "ae.tracker.repair.readback");
  assert.equal(capabilityForTrackerRepairCommandV24("tracker.repair.set_feature_center"), "ae.tracker.repair.feature_center.set");
  assert.equal(isAeTrackerRepairMutationCommandV24("tracker.repair.readback"), false);
  assert.equal(isAeTrackerRepairMutationCommandV24("tracker.repair.set_feature_center"), true);
});

test("tracker repair capabilities project retained real-AE protocol 2.4 acceptance", () => {
  assert.equal(M4_TRACKER_REPAIR_READBACK_CAPABILITY_V24.status, "PARTIAL");
  assert.equal(M4_TRACKER_REPAIR_READBACK_CAPABILITY_V24.proofMaturity, "STRUCTURAL");
  assert.equal(M4_TRACKER_REPAIR_READBACK_CAPABILITY_V24.routes[0].available, true);
  assert.equal(M4_TRACKER_REPAIR_READBACK_CAPABILITY_V24.riskClass, "R0_READ_ONLY");
  assert.equal(M4_TRACKER_REPAIR_WRITE_CAPABILITY_V24.status, "PARTIAL");
  assert.equal(M4_TRACKER_REPAIR_WRITE_CAPABILITY_V24.proofMaturity, "ROLLBACK");
  assert.equal(M4_TRACKER_REPAIR_WRITE_CAPABILITY_V24.routes[0].available, true);
  assert.equal(M4_TRACKER_REPAIR_WRITE_CAPABILITY_V24.riskClass, "R1_REVERSIBLE");
});

test("host implementation revision-gates, reads back, and transactionally rolls back Feature Center writes", async () => {
  const source = await readFile("packages/adapters/ae-cep/host/editflow_host_m4_repair_resume.jsx", "utf8");
  assert.match(source, /expectedHostProjectRevision/);
  assert.match(source, /ADBE MTracker Pt Feature Center/);
  assert.match(source, /setValueAtTime\(target\.time,desired\)/);
  assert.match(source, /TRACKER_REPAIR_READBACK_MISMATCH/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.match(source, /TRACKER_REPAIR_ROLLBACK_READBACK_MISMATCH/);
  assert.match(source, /frameDuration\/1000/);
  assert.match(source, /EDITFLOW_M4_TRACKER_REPAIR_P4_PROOF/);
});

test("protocol 2.4 loader is additive over accepted protocol 2.3", async () => {
  const loader = await readFile("packages/adapters/ae-cep/host/editflow_host_current_v24.jsx", "utf8");
  assert.match(loader, /editflow_host_current_v23\.jsx/);
  assert.match(loader, /editflow_host_m4_repair_resume\.jsx/);
  assert.match(loader, /M4_TRACKER_REPAIR_MODULE_LOAD_FAILED/);
  assert.match(loader, /EditFlow2_HOST_PROTOCOL_24 = true/);
});
