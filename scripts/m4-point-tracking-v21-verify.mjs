import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { trackerReadbackToSubjectObservationsV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-point-tracking.js";
import { TrackingStateReducerV1 } from "../.tmp/runtime/packages/tracking-state/src/index.js";
import { EditorBrainV1 } from "../.tmp/runtime/packages/editor-brain/src/m4.js";

const artifactPath = new URL("../proofs/artifacts/m4-point-tracking-v21-live.json", import.meta.url);
const outputPath = new URL("../proofs/artifacts/m4-point-tracking-v21-brain.json", import.meta.url);
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
assert.equal(artifact.ok, true, "live AE tracker readback proof must pass first");

const observations = trackerReadbackToSubjectObservationsV1(
  artifact.response.readback,
  "SUBJECT_LIVE_TRACK_01",
);
assert.ok(observations.length >= 2, "live AE readback must produce at least two reducer observations");
const reducer = new TrackingStateReducerV1();
let estimate = null;
for (const observation of observations) estimate = reducer.update(observation);
assert.ok(estimate, "tracking reducer must produce a live estimate");
assert.ok(Math.hypot(estimate.velocityX, estimate.velocityY) > 0, "live estimate must preserve measured motion");
const style = {
  profileId: "STYLE_M4_LIVE",
  name: "M4 Live Tracker Proof",
  techniqueBias: { HOLD: 0.1, REFRAME: 0.25, IMPACT_PULSE: 0.9, FADE_PULSE: 0.15 },
  preferredImpactIntensity: 0.72,
  minimumReadability: 0.55,
  evidenceIds: ["M4_LIVE_TRACKER_STYLE"],
};
const brain = new EditorBrainV1();
const decision = brain.decide({
  comp: { hostId: artifact.response.readback.comp.hostId },
  layer: { hostId: artifact.response.readback.layer.hostId },
  style,
  desiredEnergy: 0.78,
  readability: 0.9,
  dialogueImportance: 0.05,
  transitionPressure: 0.4,
  beatStrength: "STRONG",
  beatEtaMs: 60,
  shotAgeMs: 900,
  reframeTarget: undefined,
  subject: estimate,
});
assert.equal(decision.route, "LOCAL", "reliable live AE tracking should remain on the local editor route");
assert.equal(decision.subjectId, "SUBJECT_LIVE_TRACK_01");
assert.ok(decision.objectRationaleCodes.includes("TRACKED_SUBJECT_BOUND"));
const result = {
  proof: "M4_POINT_TRACKING_V21_BRAIN",
  ok: true,
  observationCount: observations.length,
  estimate,
  decision: {
    route: decision.route,
    technique: decision.technique,
    confidence: decision.confidence,
    subjectId: decision.subjectId,
    rationaleCodes: decision.rationaleCodes,
    objectRationaleCodes: decision.objectRationaleCodes,
    objectEvidenceIds: decision.objectEvidenceIds,
  },
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result));
