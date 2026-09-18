import { writeFile } from "node:fs/promises";
import { AE_ADAPTER_ROUTE_ID_V11 } from "../../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17 } from "../../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_7.js";
import { AE_TEMPORAL_EASE_ROUTE_ID_V18 } from "../../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_8.js";

const BASE = process.env.EDITFLOW_SHADOW_CONTROL ?? "http://127.0.0.1:32146";
const EVIDENCE = "proofs/diagnostics/m3-temporal-ease-boundary-live.json";
const SOURCE = "EF2_EASE_BOUNDARY_SOURCE";
const COMP = "EF2_EASE_BOUNDARY_COMP";
const LAYER = "EF2_EASE_BOUNDARY_LAYER";
const requireThat = (value, message) => { if (!value) throw new Error(message); };

const requestJson = async (path, init = {}) => {
  const response = await fetch(BASE + path, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${path} failed ${response.status}: ${text}`);
  return body;
};
const getState = () => requestJson("/state");
const runTransaction = (plan) => requestJson("/run-transaction", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ plan }),
});
const operation = (id, capabilityId, routeId, command, payload, dependsOn = [], riskClass = "R1_REVERSIBLE") => ({
  operationId: id,
  capabilityId,
  routeId,
  dependsOn,
  idempotency: "CHECK_THEN_APPLY",
  riskClass,
  input: { command, payload, readbackProfile: "M3_TEMPORAL_EASE_BOUNDARY_LIVE_V1" },
  rollbackBoundaryId: "ROLLBACK_EASE_BOUNDARY",
});
const envelope = (planId, observed, requiredCapabilities, operations) => ({
  planId,
  planRevision: 1,
  projectRevision: observed.projectRevision,
  projectFingerprint: observed.projectFingerprint,
  environmentFingerprint: observed.environmentFingerprint,
  creativeObjective: "Verify meaningful temporal-ease boundary semantics in live AE.",
  requiredCapabilities,
  bindings: [],
  operations,
  checkpoints: [],
  invariants: { structural: [], visual: [] },
  rollbackBoundaries: [{ id: "ROLLBACK_EASE_BOUNDARY", strategy: "RESTORE_SNAPSHOT" }],
});

const mutationPlan = (observed) => {
  const ops = [];
  const add = (id, capabilityId, routeId, command, payload, riskClass) => {
    ops.push(operation(id, capabilityId, routeId, command, payload, ops.length ? [ops.at(-1).operationId] : [], riskClass));
  };
  add("EASE_BOUNDARY_001", "ae.comp.create", AE_ADAPTER_ROUTE_ID_V11, "comp.create",
    { stableId: SOURCE, name: "EF2 Ease Boundary Source", width: 64, height: 64, pixelAspect: 1, duration: 2, frameRate: 30 }, "R2_STRUCTURAL");
  add("EASE_BOUNDARY_002", "ae.comp.create", AE_ADAPTER_ROUTE_ID_V11, "comp.create",
    { stableId: COMP, name: "EF2 Ease Boundary Proof", width: 64, height: 64, pixelAspect: 1, duration: 2, frameRate: 30 }, "R2_STRUCTURAL");
  add("EASE_BOUNDARY_003", "ae.layer.create", AE_ADAPTER_ROUTE_ID_V11, "layer.add_media",
    { stableId: LAYER, comp: { stableId: COMP }, item: { stableId: SOURCE }, duration: 2 }, "R2_STRUCTURAL");
  add("EASE_BOUNDARY_004", "ae.keyframe.set", AE_ADAPTER_ROUTE_ID_V11, "property.set_keyframes",
    { comp: { stableId: COMP }, layer: { stableId: LAYER }, propertyPath: ["ADBE Transform Group", "ADBE Opacity"],
      keyframes: [{ time: 0.5, value: 20 }, { time: 1, value: 80 }, { time: 1.5, value: 20 }] });
  for (let keyIndex = 1; keyIndex <= 3; keyIndex += 1) {
    add(`EASE_BOUNDARY_INTERP_${keyIndex}`, "ae.property.temporal_interpolation.set", AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17,
      "property.temporal_interpolation.set", { comp: { stableId: COMP }, layer: { stableId: LAYER },
        propertyPath: ["ADBE Transform Group", "ADBE Opacity"], keyIndex,
        interpolation: { inType: "BEZIER", outType: "BEZIER", temporalContinuous: false, temporalAutoBezier: false } });
  }
  const ease = (influence) => ({ inEase: [{ speed: 0, influence }], outEase: [{ speed: 0, influence }] });
  add("EASE_BOUNDARY_FIRST", "ae.property.temporal_ease.set", AE_TEMPORAL_EASE_ROUTE_ID_V18, "property.temporal_ease.set",
    { comp: { stableId: COMP }, layer: { stableId: LAYER }, propertyPath: ["ADBE Transform Group", "ADBE Opacity"], keyIndex: 1, ease: ease(71) });
  add("EASE_BOUNDARY_LAST", "ae.property.temporal_ease.set", AE_TEMPORAL_EASE_ROUTE_ID_V18, "property.temporal_ease.set",
    { comp: { stableId: COMP }, layer: { stableId: LAYER }, propertyPath: ["ADBE Transform Group", "ADBE Opacity"], keyIndex: 3, ease: ease(67) });
  return envelope("m3-temporal-ease-boundary-live", observed,
    ["ae.comp.create", "ae.layer.create", "ae.keyframe.set", "ae.property.temporal_interpolation.set", "ae.property.temporal_ease.set"], ops);
};
const cleanupPlan = (observed, ids) => {
  const targets = [COMP, SOURCE].filter((stableId) => ids.has(stableId));
  const operations = targets.map((stableId, index) => operation(
    `EASE_BOUNDARY_CLEANUP_${String(index + 1).padStart(3, "0")}`,
    "ae.comp.remove",
    AE_ADAPTER_ROUTE_ID_V11,
    "comp.remove",
    { comp: { stableId } },
    index === 0 ? [] : [`EASE_BOUNDARY_CLEANUP_${String(index).padStart(3, "0")}`],
    "R3_DESTRUCTIVE",
  ));
  return envelope("m3-temporal-ease-boundary-cleanup", observed, ["ae.comp.remove"], operations);
};

const before = await getState();
const evidence = { proof: "M3_TEMPORAL_EASE_BOUNDARY_LIVE_V1", sourceCommit: process.env.EDITFLOW_SOURCE_COMMIT ?? null,
  startedAt: new Date().toISOString(), before: before.state.observed };
let failure = null;
try {
  const result = await runTransaction(mutationPlan(before.state.observed));
  requireThat(result.result?.state === "COMMITTED", "Boundary temporal-ease transaction did not commit.");
  requireThat(result.result?.appliedOperations === 9, "Boundary proof did not execute exactly nine operations.");
  evidence.execution = { state: result.result.state, appliedOperations: result.result.appliedOperations, planHash: result.result.planHash };
} catch (error) {
  failure = error;
  evidence.error = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null };
} finally {
  const current = await getState();
  const ids = new Set((current.state.project.items ?? []).map((item) => item.stableId));
  if (ids.has(COMP) || ids.has(SOURCE)) {
    const cleanup = await runTransaction(cleanupPlan(current.state.observed, ids));
    requireThat(cleanup.result?.state === "COMMITTED", "Boundary proof cleanup did not commit.");
  }
  const final = await getState();
  evidence.finishedAt = new Date().toISOString();
  evidence.cleanup = {
    projectFingerprint: final.state.observed.projectFingerprint,
    itemCount: final.state.project.itemCount,
    fingerprintRestored: final.state.observed.projectFingerprint === before.state.observed.projectFingerprint,
    itemCountRestored: final.state.project.itemCount === before.state.project.itemCount,
  };
  requireThat(evidence.cleanup.fingerprintRestored, "Boundary proof did not restore baseline fingerprint.");
  requireThat(evidence.cleanup.itemCountRestored, "Boundary proof did not restore baseline item count.");
  await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2) + "\n", "utf8");
}
if (failure) throw failure;
console.log(JSON.stringify({ ok: true, evidence: EVIDENCE, execution: evidence.execution, cleanup: evidence.cleanup }));
