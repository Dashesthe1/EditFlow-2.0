import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { transitionTrackingRepairV1 } from "../.tmp/runtime/packages/tracking-state/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (...parts) => JSON.parse(await readFile(path.join(root, ...parts), "utf8"));
const planResult = await read("proofs", "artifacts", "m4-automatic-corrective-recovery-plan.json");
const apply = await read("proofs", "artifacts", "m4-automatic-corrective-recovery-apply.json");
const visual = await read("proofs", "artifacts", "m4-automatic-corrective-recovery-visual", "result.json");
const readback = await read("proofs", "artifacts", "m4-automatic-corrective-recovery-readback.json");
const cleanup = await read("proofs", "artifacts", "m4-automatic-corrective-recovery-cleanup.json");
const plan = planResult.plan;
const firstPost = readback.firstPostRepairSamples?.[0] ?? null;
if (!planResult.ok || !plan || !firstPost) throw new Error("Automatic corrective recovery proof inputs are incomplete.");

const finite01 = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const postTimestampMs = Math.round(firstPost.time * 1000);
const trackConfidence = firstPost.confidence;
const driftRisk = Math.min(1, Math.max(0, Number(readback.groundTruthErrorPx) / 90));
if (!finite01(trackConfidence) || !finite01(driftRisk)) throw new Error("Protocol 2.1 post-analysis confidence/drift evidence is invalid.");
const verified = transitionTrackingRepairV1(plan.stateAfterCorrection, {
  type: "VERIFY_REPAIR",
  timestampMs: postTimestampMs,
  trackConfidence,
  driftRisk,
  occlusion: 0,
  evidenceIds: ["ACR:PROTOCOL21_POST_ANALYSIS_SAMPLE", "ACR:FIXTURE_UNOCCLUDED_GROUND_TRUTH"],
});
const resumed = verified ? transitionTrackingRepairV1(verified, {
  type: "RESUME",
  timestampMs: postTimestampMs,
  evidenceIds: ["ACR:GUARDED_ANALYZE_FORWARD_COMPLETED"],
}) : null;
const completion = visual?.proof?.completion;
const fixture = planResult.fixture;
const exactTarget = plan.operations?.[1]?.payload;
const checks = {
  explicitIdentityEscalated: planResult.monitor?.escalation?.status === "ESCALATE"
    && planResult.monitor?.escalation?.primaryReason === "IDENTITY_UNCERTAIN",
  composerEmittedExactSequence: plan.operations?.length === 3
    && plan.operations[0]?.command === "tracker.repair.readback"
    && plan.operations[1]?.command === "tracker.repair.set_feature_center"
    && plan.operations[2]?.command === "tracker.repair.readback",
  composerBoundExactTarget: exactTarget?.comp?.stableId === fixture.compStableId
    && exactTarget?.comp?.hostId === fixture.fixtureCompId
    && exactTarget?.layer?.stableId === fixture.layerStableId
    && exactTarget?.layer?.hostId === fixture.layerId
    && exactTarget?.trackerIndex === 1
    && exactTarget?.pointIndex === fixture.pointIndex
    && exactTarget?.time === fixture.repairTime,
  wrongStateObservedBeforeMutation: apply?.checks?.wrongStateObserved === true,
  composerCorrectionApplied: apply?.checks?.correctionApplied === true,
  protocol24ApplyReadbackExact: apply?.checks?.applyReadbackExact === true,
  protocol24IndependentPostReadbackExact: apply?.checks?.postReadbackExact === true,
  guardedVisualResumeCompleted: visual?.status === "COMPLETED" && visual?.guardedVisualTargetVerified === true,
  activeStopObserved: completion?.activeStopObserved === true,
  protocol21PostAnalysisAccepted: readback?.ok === true,
  nativeSamplesGrew: readback?.checks?.keyCountGrew === true && readback?.checks?.postRepairSamplesAdded === true,
  trajectoryMatchedGroundTruth: readback?.checks?.groundTruthTrajectoryMatched === true,
  repairVerificationAccepted: verified?.status === "RESUME_READY" && verified?.verification?.accepted === true,
  repairStateResumed: resumed?.status === "RESUMED",
  cleanupRestoredBaseline: cleanup?.ok === true,
};
const accepted = Object.values(checks).every(Boolean);
const normalizeEvidenceId = (value) => typeof value === "string" && value
  ? (path.isAbsolute(value) ? path.relative(root, value).split(path.sep).join("/") : value)
  : null;
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const acceptance = {
  status: accepted ? "PASS_REAL_AE_AUTOMATIC_IDENTITY_CORRECTIVE_RECOVERY" : "FAIL_REAL_AE_AUTOMATIC_IDENTITY_CORRECTIVE_RECOVERY",
  proofScope: "M4_AUTOMATIC_CORRECTIVE_RECOVERY_IDENTITY_FORWARD_REAL_AE",
  accepted,
  sourceCommit,
  generatedAt: new Date().toISOString(),
  capability: {
    id: "tracking.repair_resume.auto_correct.plan",
    routeId: "m4.tracking.repair-auto-correct-plan.v1",
    provedReason: "IDENTITY_UNCERTAIN",
    provedDirection: "FORWARD",
    protocols: { correction: "2.4.0", verification: "2.1.0" },
  },
  checks,
  automaticTrigger: planResult.monitor,
  correction: {
    time: fixture.repairTime,
    wrongFeatureCenter: fixture.wrongFeatureCenter,
    desiredFeatureCenter: fixture.desiredRepairCenter,
    hostDurationMs: apply?.applied?.diagnostics?.durationMs ?? null,
  },
  resume: {
    direction: plan.analysis?.direction ?? null,
    visualEvidenceId: normalizeEvidenceId(visual?.visualEvidenceId),
    activeStopObserved: completion?.activeStopObserved ?? false,
    stopClicked: completion?.stopClicked ?? false,
    preResumeKeyCount: readback.preResumeFeatureCenterKeyCount,
    postResumeKeyCount: readback.postResumeKeyedSampleCount,
    postRepairSampleCount: readback.postRepairSampleCount,
    groundTruthErrorPx: readback.groundTruthErrorPx,
    firstPostRepairSample: firstPost,
  },
  stateVerification: {
    derivedTrackConfidence: trackConfidence,
    derivedDriftRisk: driftRisk,
    occlusion: 0,
    verification: verified?.verification ?? null,
    finalStatus: resumed?.status ?? null,
  },
  cleanup,
  limitations: [
    "Retained live proof covers explicit identity-confidence loss escalation, exact point-tracker Feature Center correction, and guarded Analyze Forward resume.",
    "Persistent drift is independently live-proven on the same evidence-bound host surface; low tracking confidence remains structurally tested rather than independently live-proven.",
    "Occlusion recovery remains escalation-only and is not an automatic write path.",
    "Generalized semantic correction inference remains out of scope; exact correction geometry and semantic-to-host mapping are still required evidence inputs.",
  ],
};
await mkdir(path.join(root, "proofs", "diagnostics"), { recursive: true });
await writeFile(path.join(root, "proofs", "diagnostics", "m4-automatic-corrective-recovery-identity-real-ae-acceptance.json"), JSON.stringify(acceptance, null, 2), "utf8");
console.log(JSON.stringify({ accepted, checks, groundTruthErrorPx: readback.groundTruthErrorPx, finalStatus: resumed?.status ?? null }));
process.exitCode = accepted ? 0 : 2;
