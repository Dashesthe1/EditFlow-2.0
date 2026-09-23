import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPracticeReferenceAnatomyV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";

const frame = (timeMs, motionEnergy) => ({
  timeMs,
  lumaMean: 0.5,
  lumaStd: 0.2,
  exposure: 0.5,
  sharpness: 0.5,
  edgeDensity: 0.2,
  chromaticSeparation: 0.01,
  alphaCoverage: 1,
  visualDensity: 0.3,
  frameDifference: motionEnergy,
  structuralDifference: motionEnergy,
  motionEnergy,
  motionDirection: { x: 1, y: 0 },
  subjectMotion: { x: 0.2, y: 0 },
  backgroundMotion: { x: 0.02, y: 0 },
  subjectBackgroundDivergence: 0.18,
  displacementMagnitude: 0.12,
  scale: 1,
  rotationDegrees: 0,
  perspectiveEnergy: 0,
  blurStrength: 0.2,
  distortionStrength: 0.05,
  subjectSeparation: 0.4,
  overlapDensity: 0.1,
  stateSeparation: 0,
  temporalStateCount: 1,
  occlusion: 0.2,
  maskCoverage: 0.1,
});

const evidence = {
  schema: "editflow.dense-effect-evidence.v1",
  sourceId: "finish:anatomy",
  sourceKind: "REFERENCE",
  range: { startMs: 420, endMs: 620 },
  analyzerFingerprint: "analyzer:fixture",
  settingsFingerprint: "settings:fixture",
  contentKey: "content:fixture",
  frames: [frame(420, 0.05), frame(500, 0.35), frame(620, 0.08)],
  summary: {
    frameCount: 3,
    frameIntervalMs: 100,
    temporalStateCountPeak: 1,
    temporalPersistence: 0,
    motionEnergyPeak: 0.35,
    displacementPeak: 0.12,
    displacementDirection: { x: 1, y: 0 },
    scaleRange: 0.04,
    rotationRange: 0,
    blurPeak: 0.2,
    blurPeakPhase: 0.5,
    distortionPeak: 0.05,
    exposurePeak: 0.5,
    subjectSeparationPeak: 0.4,
    overlapDensityPeak: 0.1,
    stateSeparationPeak: 0,
    occlusionPeak: 0.2,
    accelerationPeak: 0.08,
    recoveryFrames: 1,
    opticalPeakPhase: 0.5,
    motionPeakPhase: 0.5,
  },
  evidenceRefs: ["dense:reference"],
};

const reference = {
  referenceId: "finish:anatomy",
  styleFingerprint: "style:anatomy",
  shots: [
    {
      shotId: "shot:001",
      order: 0,
      referenceStartMs: 0,
      referenceEndMs: 500,
      evidenceRefs: ["shot:001"],
    },
    {
      shotId: "shot:002",
      order: 1,
      referenceStartMs: 500,
      referenceEndMs: 1000,
      evidenceRefs: ["shot:002"],
    },
  ],
  evidenceRefs: ["reference:analysis"],
};

const matches = [
  {
    shotId: "shot:001",
    sourceId: "raw:a",
    sourceStartMs: 1000,
    sourceEndMs: 1500,
    direction: "FORWARD",
    playbackRate: 1,
    temporalBehavior: "FORWARD_THEN_REWIND",
    trajectory: [
      { referenceTimeMs: 80, sourceTimeMs: 1080, similarity: 0.98 },
      { referenceTimeMs: 280, sourceTimeMs: 1280, similarity: 0.99 },
      { referenceTimeMs: 420, sourceTimeMs: 1420, similarity: 0.99 },
      { referenceTimeMs: 490, sourceTimeMs: 1340, similarity: 0.98 },
    ],
    rewind: {
      detected: true,
      referenceStartMs: 420,
      referenceEndMs: 490,
      sourceStartMs: 1420,
      sourceEndMs: 1340,
      rewindSpanMs: 80,
      confidence: 0.96,
    },
    appearanceSimilarity: 0.99,
    temporalSimilarity: 0.98,
    motionSimilarity: 0.97,
    confidence: 0.99,
    evidenceRefs: ["match:001"],
  },
  {
    shotId: "shot:002",
    sourceId: "raw:b",
    sourceStartMs: 3000,
    sourceEndMs: 3500,
    direction: "FORWARD",
    playbackRate: 1,
    temporalBehavior: "FORWARD",
    appearanceSimilarity: 0.99,
    temporalSimilarity: 0.99,
    motionSimilarity: 0.99,
    confidence: 0.99,
    evidenceRefs: ["match:002"],
  },
];

test("reference anatomy binds a cut-spanning effect to both shots and retains rewind/object cues", () => {
  const sequence = {
    schema: "editflow.dense-effect-sequence.v1",
    sourceId: reference.referenceId,
    windows: [{
      windowId: "window:cut",
      startIndex: 0,
      endIndex: 2,
      anchorIndex: 1,
      startMs: 420,
      endMs: 620,
      anchorMs: 500,
      peakEnergy: 0.35,
      evidence,
    }],
    evidenceRefs: ["sequence:reference"],
  };

  const anatomy = buildPracticeReferenceAnatomyV1({
    reference,
    sequence,
    matches,
  });
  assert.equal(anatomy.cuts.length, 1);
  assert.equal(anatomy.cuts[0].atMs, 500);
  assert.deepEqual(anatomy.cuts[0].transitionWindowIds, ["window:cut"]);

  const window = anatomy.effectWindows[0];
  assert.equal(window.relation, "CUT_SPAN");
  assert.deepEqual(window.shotIds, ["shot:001", "shot:002"]);
  assert.equal(window.transitionBoundaryMs, 500);
  assert.equal(window.effectFamilyId, "SUBJECT_ISOLATED_TRANSITION");
  assert.equal(window.objectCue.objectAware, true);
  assert.equal(window.objectCue.relation, "SUBJECT_DOMINANT");
  assert.equal(window.objectCue.subjectBackgroundDivergencePeak, 0.18);
  assert.equal(window.objectCue.evidencePersistence, 1);
  assert.ok(window.evidenceRefs.includes("practice-object-relation:SUBJECT_DOMINANT"));
  assert.equal(window.temporalCue.behavior, "FORWARD_THEN_REWIND");
  assert.equal(window.temporalCue.rewind.rewindSpanMs, 80);
  assert.deepEqual(anatomy.rewindShotIds, ["shot:001"]);
  assert.deepEqual(anatomy.objectAwareWindowIds, ["window:cut"]);
  assert.ok(anatomy.evidenceRefs.includes("practice-reference-cuts:1"));
});
