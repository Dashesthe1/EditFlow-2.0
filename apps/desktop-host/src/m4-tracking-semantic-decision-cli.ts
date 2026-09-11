import { readFile, writeFile } from "node:fs/promises";

import { EditorBrainV0, type EditorStateV0 } from "../../../packages/editor-brain/src/index.js";
import { EditorBrainV1 } from "../../../packages/editor-brain/src/v1.js";
import {
  validateEditorSubjectStateV1,
  type EditorObjectContextV1,
  type EditorSubjectStateV1,
} from "../../../packages/editor-state/src/index.js";
import {
  applyPointTrackToEditorSubjectV1,
  type PointTrackResultV1,
} from "../../../packages/point-tracker/src/index.js";

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const required = (name: string): string => {
  const value = argument(name);
  if (!value) throw new Error(`Missing required argument ${name}.`);
  return value;
};
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
const stripBom = (value: string): string => value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;

const parseAcceptedTrack = (value: unknown): PointTrackResultV1 => {
  const track = record(value);
  if (!track) throw new Error("Tracking result does not contain a pointTrack object.");
  if (track["targetEntityId"] !== "M4_REAL_AE_PROOF_FEATURE") throw new Error("Point track is not bound to the bounded M4 proof feature.");
  if (track["status"] !== "STABLE") throw new Error("Semantic decision stage requires a STABLE point track.");
  if (typeof track["confidence"] !== "number" || !Number.isFinite(track["confidence"]) || track["confidence"] < 0.72) throw new Error("Point-track confidence is below the semantic readback floor.");
  if (!Array.isArray(track["samples"]) || track["samples"].length < 2) throw new Error("Point track does not contain enough trajectory samples.");
  if (!Array.isArray(track["evidenceRefs"]) || !(track["evidenceRefs"] as unknown[]).every((entry) => typeof entry === "string")) throw new Error("Point-track evidenceRefs are invalid.");
  for (const sampleValue of track["samples"] as unknown[]) {
    const sample = record(sampleValue);
    const point = record(sample?.["point"]);
    if (!sample || !point || typeof point["x"] !== "number" || typeof point["y"] !== "number" || typeof sample["timeMs"] !== "number") {
      throw new Error("Point-track sample geometry is invalid.");
    }
  }
  return value as PointTrackResultV1;
};

const unclassifiedPointSubject = (track: PointTrackResultV1): EditorSubjectStateV1 => {
  const first = track.samples[0];
  if (!first) throw new Error("Point track has no first sample.");
  return {
    entityId: track.targetEntityId,
    label: "Unclassified tracked feature",
    center: first.point,
    box: { left: first.point.x, top: first.point.y, right: first.point.x, bottom: first.point.y },
    scale: 0,
    speed: 0,
    acceleration: 0,
    motionDirection: "UNKNOWN",
    observationConfidence: track.confidence,
    identityConfidence: 0,
    geometryConfidence: 0,
    trackConfidence: 0,
    occlusionConfidence: 0,
    trackStatus: "NOT_TRACKED",
    isolationStatus: "UNAVAILABLE",
    occludedFraction: 0,
    foregroundOccluderEntityId: null,
    framingQuality: 0,
    attachPoints: [],
    evidenceRefs: ["M4_UNCLASSIFIED_POINT_SEED"],
    observedAtMs: first.timeMs,
  };
};

const baseDecisionState = (): EditorStateV0 => ({
  comp: { stableId: "M4_DECISION_ONLY_COMP" },
  layer: { stableId: "M4_DECISION_ONLY_LAYER" },
  style: {
    profileId: "M4_DECISION_ONLY_STYLE",
    name: "M4 Decision-Only Safety Style",
    techniqueBias: { HOLD: 0.9, REFRAME: 0.1, IMPACT_PULSE: 0.1, FADE_PULSE: 0.1 },
    preferredImpactIntensity: 0.5,
    minimumReadability: 0.55,
    evidenceIds: ["M4_POINT_TRACK_REAL_AE_V1"],
  },
  desiredEnergy: 0.2,
  readability: 0.9,
  dialogueImportance: 0.5,
  transitionPressure: 0.1,
  motionMagnitude: 0,
  motionDirection: "NONE",
  beatStrength: "NONE",
  beatEtaMs: null,
  shotAgeMs: 1000,
});

const main = async (): Promise<void> => {
  const trackingResultPath = required("--tracking-result");
  const resultPath = required("--result");
  let report: Record<string, unknown>;
  try {
    const trackingReport = record(JSON.parse(stripBom(await readFile(trackingResultPath, "utf8"))) as unknown);
    if (!trackingReport || trackingReport["proofId"] !== "M4_POINT_TRACK_REAL_AE_V1" || trackingReport["ok"] !== true || trackingReport["classification"] !== "PASS") {
      throw new Error("Semantic decision stage requires a passing retained M4_POINT_TRACK_REAL_AE_V1 result.");
    }
    const track = parseAcceptedTrack(trackingReport["pointTrack"]);
    const seeded = unclassifiedPointSubject(track);
    const subject = applyPointTrackToEditorSubjectV1(seeded, track);
    const validationErrors = validateEditorSubjectStateV1(subject);
    if (validationErrors.length > 0) throw new Error(`Semantic point-track readback is invalid: ${validationErrors.join(",")}`);

    const context: EditorObjectContextV1 = {
      heroSubjectId: null,
      subjects: [subject],
      capabilities: {
        pointTracking: {
          capabilityId: "ae.tracking.point",
          status: "ADAPTER_REQUIRED",
          proofMaturity: "STRUCTURAL",
          available: false,
          limitations: ["Authenticated live acceptance and later visual/recovery/transfer proof remain required."],
        },
      },
    };
    const decision = new EditorBrainV1(new EditorBrainV0()).decide(baseDecisionState(), context);
    const semanticReadbackPassed = subject.trackStatus === "STABLE"
      && subject.trackConfidence === track.confidence
      && subject.evidenceRefs.every((ref) => typeof ref === "string")
      && track.evidenceRefs.every((ref) => subject.evidenceRefs.includes(ref));
    const brainFailClosed = decision.route === "ESCALATE"
      && decision.intent === "DELEGATE_V0"
      && decision.escalationReason === "LOW_OBJECT_CONFIDENCE"
      && decision.delegatedDecisionV0 === null
      && decision.delegatedStateV0 === null
      && decision.requiredCapabilityIds.length === 0;
    const ok = semanticReadbackPassed && brainFailClosed;
    report = {
      proofId: "M4_TRACK_TO_BRAIN_DECISION_ONLY_V1",
      parentProofId: "M4_POINT_TRACK_REAL_AE_V1",
      ok,
      classification: ok ? "PASS_DECISION_ONLY_FAIL_CLOSED" : "SEMANTIC_OR_BRAIN_GATE_FAILED",
      semanticSubject: subject,
      semanticValidationErrors: validationErrors,
      editorBrainDecision: decision,
      checks: {
        semanticReadbackPassed,
        identityNotInvented: subject.identityConfidence === 0,
        extentNotInvented: subject.geometryConfidence === 0 && subject.scale === 0,
        pointTrackingCapabilityStillUnavailable: context.capabilities.pointTracking?.available === false,
        brainFailClosed,
        noAeMutationExecuted: true,
      },
      maturityImpact: "NONE_UNTIL_PARENT_AUTHENTICATED_LIVE_ACCEPTANCE_AND_LATER_VISUAL_RECOVERY_TRANSFER_GATES",
    };
    if (!ok) process.exitCode = 2;
  } catch (error) {
    report = {
      proofId: "M4_TRACK_TO_BRAIN_DECISION_ONLY_V1",
      ok: false,
      classification: "PROOF_FAILURE",
      error: error instanceof Error ? error.message : String(error),
      maturityImpact: "NONE",
    };
    process.exitCode = 1;
  }
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
};

await main();
