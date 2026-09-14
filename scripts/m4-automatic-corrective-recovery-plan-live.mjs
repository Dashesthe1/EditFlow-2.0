import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  AutomaticTrackingRepairMonitorV1,
  createTrackingRepairStateV1,
} from "../.tmp/runtime/packages/tracking-state/src/index.js";
import { buildM4AutomaticCorrectiveRecoveryPlanV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-automatic-corrective-recovery.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = path.join(root, "proofs", "artifacts", "m4-automatic-corrective-recovery-fixture.json");
const fixture = JSON.parse(await readFile(artifactPath, "utf8"));
if (!fixture.ok) throw new Error(`automatic-corrective fixture setup failed: ${JSON.stringify(fixture)}`);

const policy = {
  minTrackingConfidence: 0.75,
  maxDriftRisk: 0.3,
  maxOcclusion: 0.45,
  minIdentityConfidence: 0.8,
  failurePersistenceSamples: 2,
};
const monitor = new AutomaticTrackingRepairMonitorV1(policy);
const sample = (timestampMs, driftRisk, evidenceId) => ({
  semanticId: fixture.semanticId,
  timestampMs,
  trackConfidence: timestampMs === 0 ? 0.96 : 0.45,
  driftRisk,
  occlusion: 0,
  identityConfidence: 0.99,
  evidenceIds: [evidenceId],
});
const good = monitor.update(sample(0, 0.04, "ACR:BASELINE:GOOD"));
const pending = monitor.update(sample(500, 0.85, "ACR:DRIFT:FRAME_500"));
const escalation = monitor.update(sample(533, 0.86, "ACR:DRIFT:FRAME_533"));
if (good?.status !== "GOOD" || pending?.status !== "PENDING_FAILURE" || escalation?.status !== "ESCALATE") {
  throw new Error(`automatic drift escalation did not reach ESCALATE: ${JSON.stringify({ good, pending, escalation })}`);
}

const repairState = createTrackingRepairStateV1({
  semanticId: fixture.semanticId,
  policy: { minResumeConfidence: 0.82, maxResumeDriftRisk: 0.2, maxResumeOcclusion: 0.3 },
  evidenceIds: ["ACR:SEMANTIC_BINDING:EXACT"],
});
if (!repairState) throw new Error("failed to create repair state");
const plan = buildM4AutomaticCorrectiveRecoveryPlanV1({
  evaluation: escalation,
  repairState,
  beginRepairAtMs: 533,
  correction: {
    timestampMs: 500,
    x: fixture.desiredRepairCenter[0] / 720,
    y: fixture.desiredRepairCenter[1] / 720,
    scale: 90 / 720,
    confidence: 0.99,
    evidenceIds: ["ACR:CORRECTION:KNOWN_FIXTURE_GROUND_TRUTH"],
  },
  hostBinding: {
    target: {
      comp: { stableId: fixture.compStableId, hostId: fixture.fixtureCompId },
      layer: { stableId: fixture.layerStableId, hostId: fixture.layerId },
      trackerIndex: 1,
      pointIndex: fixture.pointIndex,
      time: fixture.repairTime,
    },
    featureCenter: fixture.desiredRepairCenter,
    mappingEvidenceIds: ["ACR:MAP:SEMANTIC_TO_TRACK_POINT:EXACT"],
  },
  resumeDirection: "FORWARD",
  requiredPointIndices: [fixture.pointIndex],
});
if (!plan) throw new Error("automatic corrective recovery planner refused the valid live fixture");
if (plan.reason !== "TRACK_DRIFT_RISK_HIGH" || plan.operations.length !== 3) throw new Error("unexpected automatic corrective plan");

const result = { ok: true, fixture, monitor: { good, pending, escalation }, repairState, plan };
await mkdir(path.join(root, "proofs", "artifacts"), { recursive: true });
await writeFile(path.join(root, "proofs", "artifacts", "m4-automatic-corrective-recovery-plan.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, reason: plan.reason, operations: plan.operations.map((item) => item.command), direction: plan.analysis.direction }));
