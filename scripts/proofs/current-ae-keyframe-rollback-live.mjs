import { writeFile } from "node:fs/promises";
import { AE_ADAPTER_ROUTE_ID_V11 } from "../../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_TIME_REMAP_ROUTE_ID_V27 } from "../../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_7.js";

const BASE = process.env.EDITFLOW_SHADOW_CONTROL ?? "http://127.0.0.1:32146";
const EVIDENCE = "proofs/diagnostics/m5-current-ae-keyframe-rollback-live.json";
const SOURCE = "EF2_ROLLBACK_SOURCE";
const COMP = "EF2_ROLLBACK_COMP";
const LAYER = "EF2_ROLLBACK_LAYER";

const assertThat = (value, message) => {
  if (!value) throw new Error(message);
};

const requestJson = async (path, init = {}, allowError = false) => {
  const response = await fetch(BASE + path, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok && !allowError) {
    throw new Error(`${path} failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return { status: response.status, body };
};

const getState = async () => (await requestJson("/state")).body;
const runTransaction = async (plan, allowError = false) => (
  await requestJson("/run-transaction", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan }),
  }, allowError)
);

const operation = ({
  id, capabilityId, routeId, command, payload, dependsOn = [], riskClass = "R1_REVERSIBLE",
}) => ({
  operationId: id,
  capabilityId,
  routeId,
  dependsOn,
  idempotency: "CHECK_THEN_APPLY",
  riskClass,
  input: { command, payload, readbackProfile: "M5_KEYFRAME_ROLLBACK_LIVE" },
  rollbackBoundaryId: "ROLLBACK_M5_KEYFRAME_LIVE",
});

const plan = (planId, observed, requiredCapabilities, operations) => ({
  planId,
  planRevision: 1,
  projectRevision: observed.projectRevision,
  projectFingerprint: observed.projectFingerprint,
  environmentFingerprint: observed.environmentFingerprint,
  creativeObjective: "Prove one EditFlow keyframe-removal request maps to one AE undo step.",
  requiredCapabilities,
  bindings: [],
  operations,
  checkpoints: [],
  invariants: { structural: [], visual: [] },
  rollbackBoundaries: [{ id: "ROLLBACK_M5_KEYFRAME_LIVE", strategy: "RESTORE_SNAPSHOT" }],
});

const setupPlan = (observed) => plan("m5-keyframe-rollback-setup", observed,
  ["ae.comp.create", "ae.layer.create"], [
    operation({
      id: "SETUP_001", capabilityId: "ae.comp.create", routeId: AE_ADAPTER_ROUTE_ID_V11,
      command: "comp.create",
      payload: { stableId: SOURCE, name: "EF2 Rollback Source", width: 320, height: 180, pixelAspect: 1, duration: 5, frameRate: 30 },
      riskClass: "R2_STRUCTURAL",
    }),
    operation({
      id: "SETUP_002", capabilityId: "ae.comp.create", routeId: AE_ADAPTER_ROUTE_ID_V11,
      command: "comp.create",
      payload: { stableId: COMP, name: "EF2 Rollback Comp", width: 320, height: 180, pixelAspect: 1, duration: 5, frameRate: 30 },
      dependsOn: ["SETUP_001"], riskClass: "R2_STRUCTURAL",
    }),
    operation({
      id: "SETUP_003", capabilityId: "ae.layer.create", routeId: AE_ADAPTER_ROUTE_ID_V11,
      command: "layer.add_media",
      payload: { stableId: LAYER, comp: { stableId: COMP }, item: { stableId: SOURCE }, duration: 5 },
      dependsOn: ["SETUP_002"], riskClass: "R2_STRUCTURAL",
    }),
  ]);
const rollbackPlan = (observed) => plan("m5-keyframe-rollback-induced-failure", observed,
  ["ae.layer.time_remap.enable", "ae.keyframe.set"], [
    operation({
      id: "ROLL_001", capabilityId: "ae.layer.time_remap.enable", routeId: AE_TIME_REMAP_ROUTE_ID_V27,
      command: "layer.time_remap.enable",
      payload: { comp: { stableId: COMP }, layer: { stableId: LAYER } },
    }),
    operation({
      id: "ROLL_002", capabilityId: "ae.keyframe.set", routeId: AE_ADAPTER_ROUTE_ID_V11,
      command: "property.set_keyframes",
      payload: {
        comp: { stableId: COMP }, layer: { stableId: LAYER },
        propertyPath: ["ADBE Time Remapping"],
        keyframes: [
          { time: 1, value: 0.8 },
          { time: 2, value: 1.4 },
          { time: 3, value: 2.2 },
        ],
      },
      dependsOn: ["ROLL_001"],
    }),
    operation({
      id: "ROLL_003", capabilityId: "ae.keyframe.set", routeId: AE_ADAPTER_ROUTE_ID_V11,
      command: "property.set_keyframes",
      payload: {
        comp: { stableId: COMP }, layer: { stableId: LAYER },
        propertyPath: ["ADBE Time Remapping"],
        removeKeyIndices: [5, 1],
      },
      dependsOn: ["ROLL_002"],
    }),
    operation({
      id: "ROLL_004_FAIL", capabilityId: "ae.keyframe.set", routeId: AE_ADAPTER_ROUTE_ID_V11,
      command: "property.set_keyframes",
      payload: {
        comp: { stableId: COMP }, layer: { stableId: LAYER },
        propertyPath: ["ADBE Missing Property"],
        keyframes: [{ time: 2.5, value: 1 }],
      },
      dependsOn: ["ROLL_003"],
    }),
  ]);

const cleanupPlan = (observed) => plan("m5-keyframe-rollback-cleanup", observed,
  ["ae.comp.remove"], [
    operation({
      id: "CLEAN_001", capabilityId: "ae.comp.remove", routeId: AE_ADAPTER_ROUTE_ID_V11,
      command: "comp.remove", payload: { comp: { stableId: COMP } }, riskClass: "R3_DESTRUCTIVE",
    }),
    operation({
      id: "CLEAN_002", capabilityId: "ae.comp.remove", routeId: AE_ADAPTER_ROUTE_ID_V11,
      command: "comp.remove", payload: { comp: { stableId: SOURCE } },
      dependsOn: ["CLEAN_001"], riskClass: "R3_DESTRUCTIVE",
    }),
  ]);

const stableIds = (state) => (state.state.project.items ?? [])
  .map((item) => item.stableId).filter(Boolean).sort();
const main = async () => {
  const beforeAll = await getState();
  const evidence = {
    proof: "M5_CURRENT_AE_KEYFRAME_ROLLBACK_LIVE_V1",
    sourceCommit: process.env.EDITFLOW_SOURCE_COMMIT ?? null,
    startedAt: new Date().toISOString(),
    beforeAll: {
      fingerprint: beforeAll.state.observed.projectFingerprint,
      itemCount: beforeAll.state.project.itemCount,
      stableIds: stableIds(beforeAll),
    },
  };
  let setupCommitted = false;
  try {
    const setup = await runTransaction(setupPlan(beforeAll.state.observed));
    assertThat(setup.body.result?.state === "COMMITTED", "Rollback fixture setup did not commit.");
    setupCommitted = true;

    const beforeFailure = await getState();
    const failure = await runTransaction(rollbackPlan(beforeFailure.state.observed), true);
    evidence.failureTransaction = {
      httpStatus: failure.status,
      state: failure.body?.result?.state ?? null,
      appliedOperations: failure.body?.result?.appliedOperations ?? null,
      error: failure.body?.result?.error ?? null,
    };
    assertThat(failure.status === 409, "Induced failure transaction unexpectedly returned success.");
    assertThat(failure.body?.result?.state === "ROLLED_BACK",
      `Expected ROLLED_BACK, got ${failure.body?.result?.state}`);
    assertThat(failure.body?.result?.appliedOperations === 3,
      `Expected three applied operations before induced failure, got ${failure.body?.result?.appliedOperations}`);

    const afterRollback = await getState();
    evidence.rollback = {
      beforeFingerprint: beforeFailure.state.observed.projectFingerprint,
      afterFingerprint: afterRollback.state.observed.projectFingerprint,
      exactFingerprintRestored:
        afterRollback.state.observed.projectFingerprint === beforeFailure.state.observed.projectFingerprint,
      itemCountBefore: beforeFailure.state.project.itemCount,
      itemCountAfter: afterRollback.state.project.itemCount,
    };
    assertThat(evidence.rollback.exactFingerprintRestored,
      "Transaction rollback did not restore the exact pre-failure fingerprint.");
  } finally {
    if (setupCommitted) {
      const current = await getState();
      const ids = new Set(stableIds(current));
      if (ids.has(COMP) || ids.has(SOURCE)) {
        const cleanup = await runTransaction(cleanupPlan(current.state.observed));
        assertThat(cleanup.body.result?.state === "COMMITTED", "Rollback proof cleanup did not commit.");
      }
    }
    const final = await getState();
    evidence.finishedAt = new Date().toISOString();
    evidence.cleanup = {
      fingerprint: final.state.observed.projectFingerprint,
      itemCount: final.state.project.itemCount,
      stableIds: stableIds(final),
      baselineFingerprintRestored:
        final.state.observed.projectFingerprint === beforeAll.state.observed.projectFingerprint,
      baselineItemCountRestored: final.state.project.itemCount === beforeAll.state.project.itemCount,
      baselineStableIdsRestored:
        JSON.stringify(stableIds(final)) === JSON.stringify(stableIds(beforeAll)),
    };
    await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2) + "\n", "utf8");
    assertThat(evidence.cleanup.baselineFingerprintRestored, "Final cleanup fingerprint mismatch.");
    assertThat(evidence.cleanup.baselineItemCountRestored, "Final cleanup item-count mismatch.");
    assertThat(evidence.cleanup.baselineStableIdsRestored, "Final cleanup stable-ID mismatch.");
  }
  console.log(JSON.stringify({ ok: true, evidence: EVIDENCE, failure: evidence.failureTransaction, rollback: evidence.rollback, cleanup: evidence.cleanup }));
};

await main();
