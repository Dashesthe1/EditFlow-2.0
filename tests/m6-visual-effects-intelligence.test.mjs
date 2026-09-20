import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DenseEvidenceCacheV1,
  alignDenseEffectSequencesV1,
  analyzeDenseEffectEvidenceV1,
  applyConstructionActuationPlanV1,
  detectDenseEffectWindowsV1,
  assessM6BaselineLockV1,
  buildConstructionGraphV1,
  canonicalTransitionDnaV1,
  classifyEffectFamilyV1,
  compareSemanticVisualFidelityV1,
  compileConstructionGraphV1,
  compileConstructionThroughNativeAeV1,
  compileConstructionThroughVirtualAeV1,
  createCanonicalProfessionalBenchmarkV1,
  decomposeUnknownEffectV1,
  deriveConstructionActuationPlanV1,
  deriveEffectAnatomyV1,
  deriveProfessionalFidelityLevelV1,
  distinguishShutterFromFlashZoomV1,
  evaluateProfessionalBenchmarkV1,
  evaluateRetainedProfessionalBenchmarkV1,
  evaluateProfessionalFidelityGateV1,
  evaluateUnknownEffectSynthesisMilestoneV1,
  learnTutorialActionPixelConsequencesV1,
  measureHalfPeakTemporalProfileV1,
  runAutomaticVisualCorrectionLoopV1,
  selectSynthesisEscalationCandidateV1,
  summarizeDenseEffectFramesV1,
  synthesizeUnknownEffectV1,
  SynthesizedEffectMemoryV1,
  validateConstructionGraphV1,
  VisualCorrectionMemoryV1,
  VisualEffectsBrainV1,
} from "../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";
import {
  compileEditingIrRecipeToVirtualAeV1,
  inspectRecipeCompilerSupportV1,
  lowerCompiledRecipeToNativeAePlanV1,
} from "../.tmp/runtime/packages/recipe-compiler/src/index.js";

const ALL_CAPABILITIES = [
  "ae.layer.duplicate",
  "ae.layer.time.offset",
  "ae.layer.opacity.set",
  "ae.subject.isolate",
  "ae.layer.matte.set",
  "ae.effect.displacement-map",
  "ae.effect.time-displacement",
  "ae.effect.directional-blur",
  "ae.effect.exposure",
  "ae.effect.channel-shift",
  "ae.layer.blend_mode.set",
  "ae.layer.order.set",
  "ae.precompose.layers",
  "ae.keyframe.temporal_ease.set",
  "ae.layer.transform.set",
  "ae.keyframe.spatial.set",
];

const summaryDefaults = {
  frameCount: 7,
  frameIntervalMs: 1000 / 30,
  temporalStateCountPeak: 1,
  temporalPersistence: 0.1,
  motionEnergyPeak: 0.1,
  displacementPeak: 0.02,
  displacementDirection: { x: 1, y: 0 },
  scaleRange: 0,
  rotationRange: 0,
  blurPeak: 0.08,
  blurPeakPhase: 0.5,
  distortionPeak: 0.04,
  exposurePeak: 0.5,
  subjectSeparationPeak: 0,
  overlapDensityPeak: 0,
  stateSeparationPeak: 0,
  occlusionPeak: 0,
  accelerationPeak: 0.01,
  recoveryFrames: 4,
  opticalPeakPhase: 0.5,
  motionPeakPhase: 0.5,
};

const frameDefaults = {
  lumaMean: 0.5,
  lumaStd: 0.3,
  exposure: 0.5,
  sharpness: 0.5,
  edgeDensity: 0.25,
  chromaticSeparation: 0.04,
  alphaCoverage: 1,
  visualDensity: 0.3,
  frameDifference: 0.1,
  structuralDifference: 0.1,
  motionEnergy: 0.1,
  motionDirection: { x: 1, y: 0 },
  subjectMotion: { x: 0, y: 0 },
  backgroundMotion: { x: 0, y: 0 },
  subjectBackgroundDivergence: 0,
  displacementMagnitude: 0.02,
  scale: 1,
  rotationDegrees: 0,
  perspectiveEnergy: 0,
  blurStrength: 0.08,
  distortionStrength: 0.04,
  subjectSeparation: 0,
  overlapDensity: 0,
  stateSeparation: 0,
  temporalStateCount: 1,
  occlusion: 0,
  maskCoverage: 0,
};

let evidenceSerial = 0;
const evidence = (overrides = {}, frameOverrides = {}) => {
  evidenceSerial += 1;
  const summary = { ...summaryDefaults, ...overrides };
  const frames = Array.from({ length: summary.frameCount }, (_, index) => ({
    ...frameDefaults,
    timeMs: index * summary.frameIntervalMs,
    motionEnergy: index === 3 ? summary.motionEnergyPeak : 0.03,
    displacementMagnitude: index === 3 ? summary.displacementPeak : 0.01,
    motionDirection: summary.displacementDirection,
    blurStrength: index === 3 ? summary.blurPeak : 0.05,
    distortionStrength: index === 3 ? summary.distortionPeak : 0.02,
    exposure: index === 3 ? summary.exposurePeak : 0.45,
    subjectSeparation: index === 3 ? summary.subjectSeparationPeak : 0,
    overlapDensity: index === 3 ? summary.overlapDensityPeak : 0,
    stateSeparation: index === 3 ? summary.stateSeparationPeak : 0,
    temporalStateCount: index === 3 ? summary.temporalStateCountPeak : 1,
    occlusion: index === 3 ? summary.occlusionPeak : 0,
    ...frameOverrides,
  }));
  return {
    schema: "editflow.dense-effect-evidence.v1",
    sourceId: `fixture-${evidenceSerial}`,
    sourceKind: "REFERENCE",
    range: { startMs: 0, endMs: (summary.frameCount - 1) * summary.frameIntervalMs },
    analyzerFingerprint: "fixture-analyzer-v1",
    settingsFingerprint: "settings",
    contentKey: `evidence-${evidenceSerial}`,
    frames,
    summary,
    evidenceRefs: [`fixture:evidence-${evidenceSerial}`],
  };
};

const shutterReference = () => evidence({
  temporalStateCountPeak: 4,
  temporalPersistence: 0.55,
  motionEnergyPeak: 0.5,
  displacementPeak: 0.16,
  stateSeparationPeak: 0.08,
  blurPeak: 0.35,
  exposurePeak: 0.7,
  subjectSeparationPeak: 0.42,
  overlapDensityPeak: 0.4,
  accelerationPeak: 0.09,
  recoveryFrames: 3,
}, { maskCoverage: 0.25 });

const degradedFlashZoom = () => evidence({
  temporalStateCountPeak: 1,
  temporalPersistence: 0.12,
  motionEnergyPeak: 0.18,
  displacementPeak: 0.025,
  scaleRange: 0.18,
  blurPeak: 0.3,
  exposurePeak: 0.72,
  overlapDensityPeak: 0,
  accelerationPeak: 0.01,
  recoveryFrames: 8,
});

const rgbaFrame = (index, semantic) => {
  const width = 8;
  const height = 8;
  const rgba = new Uint8Array(width * height * 4);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const hero = x >= 1 + index % 3 && x <= 3 + index % 3 && y >= 2 && y <= 5;
      const value = hero ? 210 : 35 + index * 6;
      rgba[offset] = value;
      rgba[offset + 1] = hero ? 80 : value;
      rgba[offset + 2] = hero ? 40 : value;
      rgba[offset + 3] = 255;
      mask[pixel] = hero ? 255 : 0;
    }
  }
  return { timeMs: index * (1000 / 30), width, height, rgba, subjectMask: mask, semantic };
};

const chromaticRegistrationFrame = (index, separated) => {
  const width = 48;
  const height = 24;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const inY = y >= 5 && y <= 18;
      const green = inY && x >= 14 && x <= 32;
      const red = inY && x >= (separated ? 17 : 14) && x <= (separated ? 35 : 32);
      const blue = inY && x >= (separated ? 11 : 14) && x <= (separated ? 29 : 32);
      rgba[offset] = red ? 240 : 20;
      rgba[offset + 1] = green ? 70 : 20;
      rgba[offset + 2] = blue ? 200 : 20;
      rgba[offset + 3] = 255;
    }
  }
  return { timeMs: index * (1000 / 30), width, height, rgba };
};

test("M6.0 locks M5 retained proofs and invalidates only affected evidence", () => {
  const additive = assessM6BaselineLockV1(["code:m6-dense-evidence"]);
  assert.equal(additive.locked, true);
  assert.deepEqual(additive.invalidatedRetainedProofIds, []);
  assert.ok(additive.requiredM6ProofIds.includes("proof:m6:dense-evidence"));

  const changedCompiler = assessM6BaselineLockV1(["code:m5-recipe-compiler"]);
  assert.equal(changedCompiler.locked, false);
  assert.ok(changedCompiler.invalidatedRetainedProofIds.includes("proof:tutorial-001:transfer"));
  assert.ok(changedCompiler.invalidatedRetainedProofIds.includes("proof:tutorial-002:effect-stack"));
});

test("M6.1 analyzes every frame, combines semantic motion/isolation evidence, and reuses cache", () => {
  const frames = Array.from({ length: 7 }, (_, index) => rgbaFrame(index, {
    displacement: { x: index === 3 ? 0.16 : 0.02, y: 0 },
    temporalStateCount: index === 3 ? 4 : 1,
    overlapDensity: index === 3 ? 0.4 : 0,
    subjectSeparation: index === 3 ? 0.5 : 0.08,
    blurStrength: index === 3 ? 0.4 : 0.08,
    distortionStrength: index === 3 ? 0.25 : 0.03,
    scale: index === 3 ? 1.18 : 1,
  }));
  const cache = new DenseEvidenceCacheV1();
  const first = analyzeDenseEffectEvidenceV1({
    sourceId: "reference:microwave",
    sourceKind: "REFERENCE",
    frames,
    settings: { expectedFps: 30, requireEveryFrame: true },
    evidenceRefs: ["video:transition:all-frames"],
    cache,
  });
  const second = analyzeDenseEffectEvidenceV1({
    sourceId: "reference:microwave",
    sourceKind: "REFERENCE",
    frames,
    settings: { expectedFps: 30, requireEveryFrame: true },
    evidenceRefs: ["video:transition:all-frames"],
    cache,
  });
  assert.equal(first.frames.length, 7);
  assert.equal(first.summary.temporalStateCountPeak, 4);
  assert.ok(first.summary.displacementPeak >= 0.16);
  assert.ok(first.summary.subjectSeparationPeak >= 0.5);
  assert.equal(cache.size, 1);
  assert.deepEqual(second, first);
});

test("M6.1 measures channel-edge misregistration instead of raw colorfulness", () => {
  const analyze = (separated) => analyzeDenseEffectEvidenceV1({
    sourceId: separated ? "fixture:channel-split" : "fixture:colorful-registered",
    sourceKind: "REFERENCE",
    frames: Array.from({ length: 3 }, (_, index) => chromaticRegistrationFrame(index, separated)),
    settings: { expectedFps: 30, requireEveryFrame: true },
    evidenceRefs: ["fixture:chromatic-registration"],
  });
  const registered = analyze(false);
  const separated = analyze(true);
  const registeredPeak = Math.max(...registered.frames.map((frame) => frame.chromaticSeparation));
  const separatedPeak = Math.max(...separated.frames.map((frame) => frame.chromaticSeparation));
  assert.ok(registeredPeak < 0.05,
    `co-registered saturated color must not masquerade as chromatic separation: ${registeredPeak}`);
  assert.ok(separatedPeak > 0.2,
    `spatially misregistered channel edges must produce a material chromatic signal: ${separatedPeak}`);
  assert.ok(separatedPeak > registeredPeak + 0.15);
});

test("M6.1 analyzer provenance invalidates dense-evidence cache entries", () => {
  const frames = Array.from({ length: 4 }, (_, index) => rgbaFrame(index, {}));
  const cache = new DenseEvidenceCacheV1();
  const first = analyzeDenseEffectEvidenceV1({
    sourceId: "reference:provenance",
    sourceKind: "REFERENCE",
    frames,
    settings: { expectedFps: 30, requireEveryFrame: true },
    analyzerFingerprint: "analyzer-a",
    evidenceRefs: ["fixture:analyzer-a"],
    cache,
  });
  const second = analyzeDenseEffectEvidenceV1({
    sourceId: "reference:provenance",
    sourceKind: "REFERENCE",
    frames,
    settings: { expectedFps: 30, requireEveryFrame: true },
    analyzerFingerprint: "analyzer-b",
    evidenceRefs: ["fixture:analyzer-b"],
    cache,
  });
  assert.notEqual(first.contentKey, second.contentKey);
  assert.equal(cache.size, 2);
});

test("M6.5 refuses reference/render comparison across analyzer implementations", () => {
  const reference = shutterReference();
  const render = { ...reference, sourceKind: "RENDER", analyzerFingerprint: "different-analyzer" };
  const dna = canonicalTransitionDnaV1("SHUTTER_FRAGMENTATION", reference.evidenceRefs);
  assert.throws(
    () => compareSemanticVisualFidelityV1({ reference, render, dna }),
    /different analyzer implementations/i,
  );
});

test("M6.1 does not let exposure-only flashes masquerade as motion energy", () => {
  const liftedFrame = (index, lift) => {
    const width = 8;
    const height = 8;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        const base = x < 4 ? 45 : 105;
        const value = base + lift;
        rgba[offset] = value;
        rgba[offset + 1] = value;
        rgba[offset + 2] = value;
        rgba[offset + 3] = 255;
      }
    }
    return {
      timeMs: index * (1000 / 30),
      width,
      height,
      rgba,
      semantic: { displacement: { x: 0, y: 0 } },
    };
  };
  const result = analyzeDenseEffectEvidenceV1({
    sourceId: "reference:flash-only",
    sourceKind: "REFERENCE",
    frames: [
      liftedFrame(0, 0),
      liftedFrame(1, 0),
      liftedFrame(2, 80),
      liftedFrame(3, 80),
      liftedFrame(4, 0),
    ],
    settings: { expectedFps: 30, requireEveryFrame: true },
    evidenceRefs: ["fixture:flash-only"],
  });
  assert.ok(result.frames[2].frameDifference > 0.25);
  assert.ok(result.frames[2].structuralDifference < 0.02);
  assert.ok(result.frames[2].motionEnergy < 0.02);
  assert.ok(result.summary.accelerationPeak < 0.03);
});

test("M6.1 shot boundaries retain raw change evidence without masquerading as effect motion or distortion", () => {
  const solidFrame = (index, value, semantic = {}) => {
    const width = 8;
    const height = 8;
    const rgba = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
    return {
      timeMs: index * (1000 / 30),
      width,
      height,
      rgba,
      semantic,
    };
  };
  const result = analyzeDenseEffectEvidenceV1({
    sourceId: "reference:shot-boundary",
    sourceKind: "REFERENCE",
    frames: [
      solidFrame(0, 25, { displacement: { x: 0, y: 0 } }),
      solidFrame(1, 25, { displacement: { x: 0, y: 0 } }),
      solidFrame(2, 220, {
        shotBoundaryDiscontinuity: true,
        displacement: { x: 0.5, y: 0.25 },
        distortionStrength: 0.95,
      }),
      solidFrame(3, 220, { displacement: { x: 0, y: 0 } }),
      solidFrame(4, 220, { displacement: { x: 0, y: 0 } }),
    ],
    settings: { expectedFps: 30, requireEveryFrame: true },
    evidenceRefs: ["fixture:shot-boundary"],
  });
  assert.ok(result.frames[2].frameDifference > 0.5,
    "the discontinuity remains observable as raw temporal change");
  assert.equal(result.frames[2].structuralDifference, 0);
  assert.equal(result.frames[2].motionEnergy, 0);
  assert.equal(result.frames[2].displacementMagnitude, 0);
  assert.equal(result.frames[2].distortionStrength, 0);
});

test("M6.1 temporal persistence measures visible multi-state occupancy instead of generic frame change", () => {
  const temporalFrame = (index, overrides = {}) => ({
    ...frameDefaults,
    timeMs: index * (1000 / 30),
    frameDifference: index === 0 ? 0 : 0.005,
    structuralDifference: 0.005,
    motionEnergy: 0.01,
    temporalStateCount: 4,
    overlapDensity: 0.32,
    stateSeparation: 0.03,
    ...overrides,
  });
  const persistent = Array.from({ length: 10 }, (_, index) => temporalFrame(index));
  const sourceTextureOnly = Array.from({ length: 10 }, (_, index) => temporalFrame(index, {
    overlapDensity: 0.12,
  }));
  const bounded = Array.from({ length: 10 }, (_, index) => temporalFrame(index, index < 5 ? {} : {
    temporalStateCount: 1,
    overlapDensity: 0,
    stateSeparation: 0,
  }));

  assert.equal(summarizeDenseEffectFramesV1(persistent, 1000 / 30, 0.25).temporalPersistence, 1);
  assert.equal(summarizeDenseEffectFramesV1(sourceTextureOnly, 1000 / 30, 0.25).temporalPersistence, 0);
  assert.equal(summarizeDenseEffectFramesV1(bounded, 1000 / 30, 0.25).temporalPersistence, 0.5);
});

test("M6.1 exposure evidence is source-relative instead of absolute scene brightness", () => {
  const frame = (index, baseline, gain) => {
    const width = 12;
    const height = 12;
    const rgba = new Uint8Array(width * height * 4);
    const value = Math.min(255, Math.round(baseline * gain));
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
    return { timeMs: index * (1000 / 30), width, height, rgba };
  };
  const analyze = (baseline) => analyzeDenseEffectEvidenceV1({
    sourceId: `fixture:relative-exposure:${baseline}`,
    sourceKind: "REFERENCE",
    frames: [1, 1, 3, 1, 1].map((gain, index) => frame(index, baseline, gain)),
    settings: { expectedFps: 30, requireEveryFrame: true },
    evidenceRefs: ["fixture:relative-exposure"],
  });
  const dark = analyze(50);
  const bright = analyze(80);
  assert.ok(dark.summary.exposurePeak > 0.35);
  assert.ok(bright.summary.exposurePeak > 0.35);
  assert.ok(Math.abs(dark.summary.exposurePeak - bright.summary.exposurePeak) < 0.02);
  assert.notEqual(dark.frames[0].lumaMean, bright.frames[0].lumaMean);
});

test("M6.1 refuses sparse or missing-frame evidence when dense proof is required", () => {
  const frames = [0, 1, 3].map((index) => rgbaFrame(index, {}));
  assert.throws(() => analyzeDenseEffectEvidenceV1({
    sourceId: "reference:sparse",
    sourceKind: "REFERENCE",
    frames,
    settings: { expectedFps: 30, requireEveryFrame: true },
    evidenceRefs: ["fixture:sparse"],
  }), /every important frame/i);
});

test("M6.2 learns causal action-to-pixel rules for Tutorials 001 and 002 without literal-value replay", () => {
  const base = evidence();
  const velocity = evidence({ motionEnergyPeak: 0.48, accelerationPeak: 0.08, recoveryFrames: 4 });
  const isolation = evidence({ subjectSeparationPeak: 0.55, displacementPeak: 0.12 }, { maskCoverage: 0.28 });
  const tutorial001 = learnTutorialActionPixelConsequencesV1([{
    actionId: "t001.shape-time-remap",
    tutorialId: "tutorial-001-smooth-zoom-reverse",
    action: "Shape Time Remap velocity around the transition anchor",
    aeChange: "Bezier Time Remap keyframes and temporal ease",
    editorialPurpose: "Create an acceleration and recovery pulse without a frozen plateau",
    before: base,
    after: velocity,
    literalValues: { tutorialInfluence: 84 },
    adaptationInputs: ["sourceVelocity", "frameRate", "transitionDuration"],
    evidenceRefs: ["tutorial-001:time-remap-action"],
    major: true,
  }]);
  const tutorial002 = learnTutorialActionPixelConsequencesV1([{
    actionId: "t002.lock-subject",
    tutorialId: "tutorial-002-head-tracking-stabilization",
    action: "Track a persistent head feature and stabilize Position X/Y",
    aeChange: "Motion Tracker feature region plus stabilized transform",
    editorialPurpose: "Separate desired subject lock from background/camera motion",
    before: base,
    after: isolation,
    literalValues: { tutorialFeatureX: 421 },
    adaptationInputs: ["semanticHero", "featurePersistence", "trackConfidence"],
    evidenceRefs: ["tutorial-002:subject-lock-action"],
    major: true,
  }]);
  assert.equal(tutorial001.complete, true);
  assert.equal(tutorial002.complete, true);
  assert.match(tutorial001.rules[0].transferableRule, /sourceVelocity/);
  assert.doesNotMatch(tutorial001.rules[0].transferableRule, /84/);
  assert.ok(tutorial002.rules[0].pixelConsequences.some((delta) => delta.dimension === "ISOLATION"));
});

test("M6.3 Transition DNA rejects a flash/zoom substitute for shutter fragmentation", () => {
  const reference = shutterReference();
  const flash = degradedFlashZoom();
  assert.equal(distinguishShutterFromFlashZoomV1(reference).shutter, true);
  const rejected = distinguishShutterFromFlashZoomV1(flash);
  assert.equal(rejected.shutter, false);
  assert.ok(rejected.reasons.includes("MISSING_MULTIPLE_TEMPORAL_STATES"));
  assert.ok(rejected.reasons.includes("MISSING_OVERLAPPING_FRAGMENTATION"));
  const anatomy = deriveEffectAnatomyV1(reference);
  assert.equal(anatomy.family, "SHUTTER_FRAGMENTATION");
  assert.ok(anatomy.dna.definingInvariants.every((item) => item.defining));
});

test("M6.1/M6.3 refuses uncoordinated maxima masquerading as shutter fragmentation", () => {
  const interval = 1000 / 60;
  const frames = Array.from({ length: 13 }, (_, index) => ({
    ...frameDefaults,
    timeMs: index * interval,
    frameDifference: [1, 6, 11].includes(index) ? 0.03 : 0.005,
    motionEnergy: index === 6 ? 0.12 : 0.02,
    temporalStateCount: index === 1 ? 2 : 1,
    displacementMagnitude: index === 6 ? 0.06 : 0.005,
    overlapDensity: index === 11 ? 0.32 : 0,
  }));
  const summary = summarizeDenseEffectFramesV1(frames, interval, 0.25);
  const uncoordinated = {
    schema: "editflow.dense-effect-evidence.v1",
    sourceId: "reference:uncoordinated-fragmentation",
    sourceKind: "REFERENCE",
    range: { startMs: 0, endMs: frames.at(-1).timeMs },
    analyzerFingerprint: "fixture-analyzer-v1",
    settingsFingerprint: "coordination-regression",
    contentKey: "coordination-regression",
    frames,
    summary,
    evidenceRefs: ["regression:uncoordinated-fragmentation"],
  };

  assert.equal(summary.temporalStateCountPeak, 2);
  assert.equal(summary.overlapDensityPeak, 0.32);
  assert.equal(summary.displacementPeak, 0.06);
  assert.ok(summary.accelerationPeak >= 0.03);
  assert.ok(summary.fragmentationCoherencePeak < 0.08);
  const rejected = distinguishShutterFromFlashZoomV1(uncoordinated);
  assert.equal(rejected.shutter, false);
  assert.ok(rejected.reasons.includes("MISSING_COORDINATED_FRAGMENTATION"));
  assert.notEqual(classifyEffectFamilyV1(uncoordinated), "SHUTTER_FRAGMENTATION");
  assert.notEqual(classifyEffectFamilyV1(uncoordinated), "FREEZE_FRAGMENTATION");
});

test("M6.1/M6.3 rejects persistent autocorrelation as non-local shutter evidence", () => {
  const interval = 1000 / 60;
  const frames = Array.from({ length: 25 }, (_, index) => ({
    ...frameDefaults,
    timeMs: index * interval,
    frameDifference: index === 12 ? 0.08 : 0.01,
    motionEnergy: index === 12 ? 0.1 : 0.015,
    temporalStateCount: 3,
    overlapDensity: 0.18,
    stateSeparation: 0.03,
    acceleration: index === 12 ? 0.05 : 0,
  }));
  const summary = summarizeDenseEffectFramesV1(frames, interval, 0.25);
  const persistentTexture = {
    schema: "editflow.dense-effect-evidence.v1",
    sourceId: "reference:persistent-autocorrelation",
    sourceKind: "REFERENCE",
    range: { startMs: 0, endMs: frames.at(-1).timeMs },
    analyzerFingerprint: "fixture-analyzer-v7",
    settingsFingerprint: "fragmentation-locality-regression",
    contentKey: "fragmentation-locality-regression",
    frames,
    summary,
    evidenceRefs: ["probe-algorithm:editflow.m6.dense-video-probe.v7"],
  };
  assert.ok((summary.fragmentationCoherencePeak ?? 0) >= 0.08);
  const rejected = distinguishShutterFromFlashZoomV1(persistentTexture);
  assert.equal(rejected.shutter, false);
  assert.ok(rejected.reasons.includes("FRAGMENTATION_NOT_EVENT_LOCAL"));
  assert.notEqual(classifyEffectFamilyV1(persistentTexture), "SHUTTER_FRAGMENTATION");
  assert.ok(!decomposeUnknownEffectV1(persistentTexture).dna.definingInvariants.some(
    (item) => item.invariantId === "unknown.fragmentation-states",
  ));
});

test("M6.3 calibrates v10+ baseline-subtracted shutter scale without weakening locality", () => {
  const interval = 1000 / 60;
  const frames = Array.from({ length: 43 }, (_, index) => ({
    ...frameDefaults,
    timeMs: index * interval,
    temporalStateCount: [15, 16].includes(index) ? 2 : 1,
    overlapDensity: [15, 16].includes(index) ? 0.026 : 0,
    stateSeparation: [15, 16].includes(index) ? 0.022 : 0,
    displacementMagnitude: index === 16 ? 0.019 : 0.002,
    motionEnergy: index === 16 ? 0.09 : 0.01,
  }));
  const summary = {
    ...summarizeDenseEffectFramesV1(frames, interval, 0.25),
    fragmentationCoherencePeak: 0.128,
    fragmentationCoherencePhase: 15 / 42,
    fragmentationTemporalStateCountPeak: 2,
    fragmentationOverlapDensityPeak: 0.0256,
    fragmentationStateSeparationPeak: 0.0217,
    accelerationPeak: 0.07,
    recoveryFrames: 6,
  };
  const currentScale = {
    schema: "editflow.dense-effect-evidence.v1",
    sourceId: "reference:v10-baseline-subtracted-shutter",
    sourceKind: "REFERENCE",
    range: { startMs: 0, endMs: frames.at(-1).timeMs },
    analyzerFingerprint: "fixture-analyzer-v10",
    settingsFingerprint: "v10-fragmentation-scale-regression",
    contentKey: "v10-fragmentation-scale-regression",
    frames,
    summary,
    evidenceRefs: ["probe-algorithm:editflow.m6.dense-video-probe.v10"],
  };
  const legacyScale = {
    ...currentScale,
    sourceId: "reference:v9-low-overlap-control",
    evidenceRefs: ["probe-algorithm:editflow.m6.dense-video-probe.v9"],
  };

  assert.equal(distinguishShutterFromFlashZoomV1(currentScale).shutter, true);
  const legacyRejected = distinguishShutterFromFlashZoomV1(legacyScale);
  assert.equal(legacyRejected.shutter, false);
  assert.ok(legacyRejected.reasons.includes("MISSING_OVERLAPPING_FRAGMENTATION"));
});

test("M6.1/M6.3 inter-frame motion cannot substitute for within-frame state separation", () => {
  const interval = 1000 / 60;
  const movingFrames = Array.from({ length: 9 }, (_, index) => ({
    ...frameDefaults,
    timeMs: index * interval,
    temporalStateCount: index === 4 ? 2 : 1,
    overlapDensity: index === 4 ? 0.3 : 0,
    displacementMagnitude: index === 4 ? 0.12 : 0.005,
    stateSeparation: 0,
  }));
  const layeredFrames = movingFrames.map((frame, index) => ({
    ...frame,
    stateSeparation: index === 4 ? 0.03 : 0,
  }));
  const moving = summarizeDenseEffectFramesV1(movingFrames, interval, 0.25);
  const layered = summarizeDenseEffectFramesV1(layeredFrames, interval, 0.25);
  assert.ok(moving.displacementPeak >= 0.12);
  assert.equal(moving.stateSeparationPeak, 0);
  assert.equal(moving.fragmentationCoherencePeak, 0);
  assert.equal(layered.stateSeparationPeak, 0.03);
  assert.ok((layered.fragmentationCoherencePeak ?? 0) >= 0.08);
});

test("M6.1/M6.3 coordination gate matches the v5 analyzer's bounded ~100 ms event semantics", () => {
  const professionalLike = evidence({
    temporalStateCountPeak: 2,
    temporalPersistence: 0.65,
    overlapDensityPeak: 0.30,
    displacementPeak: 0.024,
    stateSeparationPeak: 0.024,
    fragmentationCoherencePeak: 0.09,
    accelerationPeak: 0.025,
    recoveryFrames: 2,
  });
  assert.equal(distinguishShutterFromFlashZoomV1(professionalLike).shutter, true);
  assert.equal(classifyEffectFamilyV1(professionalLike), "SHUTTER_FRAGMENTATION");

  const tooDispersed = evidence({
    temporalStateCountPeak: 2,
    temporalPersistence: 0.65,
    overlapDensityPeak: 0.30,
    displacementPeak: 0.024,
    stateSeparationPeak: 0.024,
    fragmentationCoherencePeak: 0.07,
    accelerationPeak: 0.025,
    recoveryFrames: 2,
  });
  assert.equal(distinguishShutterFromFlashZoomV1(tooDispersed).shutter, false);
  assert.ok(distinguishShutterFromFlashZoomV1(tooDispersed).reasons.includes(
    "MISSING_COORDINATED_FRAGMENTATION",
  ));
  assert.notEqual(classifyEffectFamilyV1(tooDispersed), "SHUTTER_FRAGMENTATION");

  const dna = canonicalTransitionDnaV1("SHUTTER_FRAGMENTATION");
  assert.equal(
    dna.definingInvariants.find((item) => item.invariantId === "shutter.coordination")?.target,
    0.08,
  );
});

test("M6.3 shutter recovery tolerance matches the observed family contract", () => {
  const observed = evidence({
    temporalStateCountPeak: 2,
    overlapDensityPeak: 0.31,
    displacementPeak: 0.049,
    stateSeparationPeak: 0.03,
    accelerationPeak: 0.071,
    recoveryFrames: 6,
  });
  assert.equal(distinguishShutterFromFlashZoomV1(observed).shutter, true);
  assert.equal(classifyEffectFamilyV1(observed), "SHUTTER_FRAGMENTATION");

  const tooSlow = evidence({
    temporalStateCountPeak: 2,
    overlapDensityPeak: 0.31,
    displacementPeak: 0.049,
    stateSeparationPeak: 0.03,
    accelerationPeak: 0.071,
    recoveryFrames: 7,
  });
  assert.equal(distinguishShutterFromFlashZoomV1(tooSlow).shutter, false);
  assert.ok(distinguishShutterFromFlashZoomV1(tooSlow).reasons.includes(
    "RECOVERY_TOO_LONG_FOR_SHUTTER",
  ));
});

test("M6.3 family classification cannot select a family whose defining DNA the reference fails", () => {
  const falseEcho = evidence({
    temporalStateCountPeak: 2,
    temporalPersistence: 0.7,
    overlapDensityPeak: 0.02,
    motionEnergyPeak: 0.62,
    accelerationPeak: 0.3,
    recoveryFrames: 2,
  });
  assert.equal(classifyEffectFamilyV1(falseEcho), "VELOCITY_TRANSITION");

  const realEcho = evidence({
    temporalStateCountPeak: 2,
    temporalPersistence: 0.7,
    overlapDensityPeak: 0.24,
    displacementPeak: 0.02,
  });
  assert.equal(classifyEffectFamilyV1(realEcho), "TEMPORAL_ECHO");
});

test("M6.4 reconstructs complete construction graphs for three compound families", () => {
  const fixtures = [
    shutterReference(),
    evidence({ temporalStateCountPeak: 3, temporalPersistence: 0.65, overlapDensityPeak: 0.32, motionEnergyPeak: 0.28 }),
    evidence({ distortionPeak: 0.62, displacementPeak: 0.25, motionEnergyPeak: 0.5, blurPeak: 0.55, recoveryFrames: 4 }),
  ];
  const families = ["SHUTTER_FRAGMENTATION", "TEMPORAL_ECHO", "WHIP_SMEAR"];
  for (let index = 0; index < fixtures.length; index += 1) {
    const anatomy = deriveEffectAnatomyV1(fixtures[index], families[index]);
    const graph = buildConstructionGraphV1(anatomy);
    if (families[index] === "SHUTTER_FRAGMENTATION") {
      assert.equal(anatomy.observedMetrics.overlapDensityPeak, fixtures[index].summary.overlapDensityPeak);
      assert.equal(anatomy.observedMetrics.fragmentationStateSeparationPeak, fixtures[index].summary.stateSeparationPeak);
      assert.equal(
        graph.nodes.find((node) => node.parameters.overlapDensityPeak !== undefined)?.parameters.overlapDensityPeak,
        fixtures[index].summary.overlapDensityPeak,
      );
      assert.equal(
        graph.nodes.find((node) => node.parameters.fragmentationStateSeparationPeak !== undefined)?.parameters.fragmentationStateSeparationPeak,
        fixtures[index].summary.stateSeparationPeak,
      );
    }
    const validation = validateConstructionGraphV1(graph);
    const compilation = compileConstructionGraphV1(graph, ALL_CAPABILITIES);
    assert.equal(validation.valid, true, validation.errors.join(", "));
    assert.deepEqual(graph.missingInvariantIds, []);
    assert.equal(compilation.definingCoverageComplete, true);
    assert.notEqual(compilation.recipe, null);
    const virtual = compileConstructionThroughVirtualAeV1(
      compilation,
      {
        schema: "editflow.virtual-ae.project.v1",
        activeCompId: "comp",
        compositions: [{
          compId: "comp",
          name: "M6 structural fixture",
          width: 1080,
          height: 1080,
          durationMs: 3000,
          frameRate: 30,
          layers: [{
            layerId: "hero",
            name: "Hero",
            kind: "FOOTAGE",
            inMs: 0,
            outMs: 3000,
            properties: [],
            effects: [],
            masks: [],
          }],
        }],
      },
      {
        compId: "comp",
        eventTimesMs: { transition: 1500 },
        roleBindings: [{ role: "hero", layerIds: ["hero"] }],
        parameterValues: {},
      },
    );
    assert.equal(virtual.compiled, true, virtual.issues.join(", "));
    assert.equal(virtual.simulation.valid, true);
  }
});

test("M6.4/M6.8 lowers UNKNOWN construction through the generic native AE plan path", () => {
  const reference = shutterReference();
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: ALL_CAPABILITIES,
  });
  assert.equal(synthesis.status, "READY_FOR_PROOF");
  assert.notEqual(synthesis.selected, null);
  assert.equal(synthesis.selected.graph.family, "UNKNOWN");

  const compilation = compileConstructionGraphV1(
    synthesis.selected.graph,
    ALL_CAPABILITIES,
  );
  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp",
      name: "M6 native construction fixture",
      width: 1080,
      height: 1080,
      durationMs: 1000,
      frameRate: 30,
      layers: [{
        layerId: "hero",
        name: "Hero",
        kind: "FOOTAGE",
        inMs: 0,
        outMs: 1000,
        properties: [],
        effects: [],
        masks: [],
      }],
    }],
  };
  const result = compileConstructionThroughNativeAeV1(
    compilation,
    project,
    {
      compId: "comp",
      eventTimesMs: { transition: 500 },
      roleBindings: [{ role: "hero", layerIds: ["hero"] }],
      parameterValues: {},
    },
    {
      planId: "m6-unknown-native-plan",
      observedState: {
        projectId: "project",
        projectRevision: "1",
        projectFingerprint: "project-fingerprint",
        environmentFingerprint: "environment-fingerprint",
      },
      curveBindingMode: "LIVE_ADAPTIVE",
      creativeObjective: "Materialize UNKNOWN M6 behavior through the generic native AE path.",
    },
  );
  assert.equal(result.compiled, true, result.issues.join(", "));
  assert.notEqual(result.plan, null);
  const temporalNodes = synthesis.selected.graph.nodes.filter((node) =>
    node.kind === "TEMPORAL_DUPLICATES");
  assert.equal(temporalNodes.length, 1, "coordinated temporal evidence must materialize once");
  assert.ok(temporalNodes[0].capabilityCandidates.includes("ae.layer.opacity.set"));
  assert.ok(temporalNodes[0].capabilityCandidates.includes("ae.layer.transform.set"));
  const stateCount = Math.max(2, Math.round(
    temporalNodes[0].parameters.fragmentationTemporalStateCountPeak
      ?? temporalNodes[0].parameters.temporalStateCountPeak
      ?? 2,
  ));
  const commands = result.plan.operations.map((operation) => operation.input.command);
  assert.equal(commands.filter((command) => command === "layer.duplicate").length, stateCount - 1);
  assert.ok(commands.includes("layer.time_remap.enable"));
  assert.ok(commands.includes("property.set_expression"));
  assert.equal(result.plan.operations.some((operation) =>
    JSON.stringify(operation.input).includes("M6.TemporalState")), false);
});

test("M6.8 materializes measured UNKNOWN directional displacement without a named-effect fallback", () => {
  const reference = evidence({
    displacementPeak: 0.11,
    displacementDirection: { x: 0.6, y: -0.8 },
    motionPeakPhase: 0.35,
    motionEnergyPeak: 0.12,
    accelerationPeak: 0.05,
  });
  const anatomy = decomposeUnknownEffectV1(reference);
  assert.ok(anatomy.dna.definingInvariants.some((item) =>
    item.invariantId === "unknown.displacement-direction"));
  assert.ok(anatomy.dna.definingInvariants.some((item) =>
    item.invariantId === "unknown.motion-peak-phase"));
  assert.deepEqual(anatomy.observedMetrics.displacementDirection, { x: 0.6, y: -0.8 });

  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: ALL_CAPABILITIES,
  });
  assert.equal(synthesis.status, "READY_FOR_PROOF");
  assert.notEqual(synthesis.selected, null);
  const cameraNodes = synthesis.selected.graph.nodes.filter((node) =>
    node.kind === "CAMERA_MOTION");
  assert.equal(cameraNodes.length, 1);
  assert.equal(cameraNodes[0].parameters.displacementPeak, 0.11);
  assert.deepEqual(cameraNodes[0].parameters.displacementDirection, [0.6, -0.8]);
  assert.equal(cameraNodes[0].parameters.motionPeakPhase, 0.35);

  const compilation = compileConstructionGraphV1(
    synthesis.selected.graph,
    ALL_CAPABILITIES,
  );
  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp",
      name: "M6 directional construction fixture",
      width: 1920,
      height: 1080,
      durationMs: 1000,
      frameRate: 30,
      layers: [{
        layerId: "hero",
        name: "Hero",
        kind: "FOOTAGE",
        inMs: 0,
        outMs: 1000,
        properties: [],
        effects: [],
        masks: [],
      }],
    }],
  };
  const result = compileConstructionThroughNativeAeV1(
    compilation,
    project,
    {
      compId: "comp",
      eventTimesMs: { transition: 350 },
      roleBindings: [{ role: "hero", layerIds: ["hero"] }],
      parameterValues: {},
    },
    {
      planId: "m6-unknown-directional-native-plan",
      observedState: {
        projectId: "project",
        projectRevision: "1",
        projectFingerprint: "project-fingerprint",
        environmentFingerprint: "environment-fingerprint",
      },
      curveBindingMode: "LIVE_ADAPTIVE",
      creativeObjective: "Materialize observed UNKNOWN displacement direction and phase.",
    },
  );
  assert.equal(result.compiled, true, result.issues.join(", "));
  assert.notEqual(result.plan, null);
  const expressionOperations = result.plan.operations.filter((operation) =>
    operation.input.command === "property.set_expression"
      && JSON.stringify(operation.input).includes("ADBE Position"));
  assert.equal(expressionOperations.length, 1);
  const expression = expressionOperations[0].input.payload.expression;
  assert.match(expression, /var base=value;/);
  assert.match(expression, /var d0=\(function\(\)/);
  assert.match(expression, /var d1=\(function\(\)/);
  assert.match(expression, /var center=0\.35;/);
  assert.match(expression, /var event=0\.35;/);
  assert.doesNotMatch(expression, /center=\(inPoint\+outPoint\)\/2/);
  assert.doesNotMatch(expression, /center=first\+span/);
  assert.match(expression, /Math\.max\(thisComp\.width,thisComp\.height\)/);
  assert.equal(result.plan.operations.some((operation) =>
    JSON.stringify(operation.input).includes("M6.DIRECTIONAL_OFFSET")), false);

  const ambiguousEventResult = compileConstructionThroughNativeAeV1(
    compilation,
    project,
    {
      compId: "comp",
      eventTimesMs: { transition: 350, recovery: 600 },
      roleBindings: [{ role: "hero", layerIds: ["hero"] }],
      parameterValues: {},
    },
    {
      planId: "m6-unknown-directional-ambiguous-event-plan",
      observedState: {
        projectId: "project",
        projectRevision: "1",
        projectFingerprint: "project-fingerprint",
        environmentFingerprint: "environment-fingerprint",
      },
      curveBindingMode: "LIVE_ADAPTIVE",
    },
  );
  assert.equal(ambiguousEventResult.compiled, false);
  assert.ok(ambiguousEventResult.issues.some((issue) =>
    issue.startsWith("M6_DIRECTIONAL_OFFSET_EVENT_ANCHOR_REQUIRED:")));
});

test("M6.8 materializes measured scale-only motion as an event-local native AE expression", () => {
  const reference = evidence({
    scaleRange: 0.08,
    displacementPeak: 0.02,
    accelerationPeak: 0.01,
  });
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: ALL_CAPABILITIES,
  });
  assert.equal(synthesis.status, "READY_FOR_PROOF");
  assert.notEqual(synthesis.selected, null);
  const compilation = compileConstructionGraphV1(
    synthesis.selected.graph,
    ALL_CAPABILITIES,
  );
  const result = compileConstructionThroughNativeAeV1(
    compilation,
    {
      schema: "editflow.virtual-ae.project.v1",
      activeCompId: "comp",
      compositions: [{
        compId: "comp",
        name: "M6 scale-only native fixture",
        width: 1080,
        height: 1080,
        durationMs: 1000,
        frameRate: 30,
        layers: [{
          layerId: "hero",
          name: "Hero",
          kind: "FOOTAGE",
          inMs: 0,
          outMs: 1000,
          properties: [],
          effects: [],
          masks: [],
        }],
      }],
    },
    {
      compId: "comp",
      eventTimesMs: { transition: 500 },
      roleBindings: [{ role: "hero", layerIds: ["hero"] }],
      parameterValues: {},
    },
    {
      planId: "m6-scale-only-native-plan",
      observedState: {
        projectId: "project",
        projectRevision: "1",
        projectFingerprint: "project-fingerprint",
        environmentFingerprint: "environment-fingerprint",
      },
      curveBindingMode: "LIVE_ADAPTIVE",
    },
  );
  assert.equal(result.compiled, true, result.issues.join(", "));
  assert.deepEqual(result.issues, []);
  assert.notEqual(result.plan, null);
  const scaleExpression = result.plan.operations.find((operation) =>
    operation.input.command === "property.set_expression"
    && JSON.stringify(operation.input.payload.propertyPath).includes("ADBE Scale"));
  assert.ok(scaleExpression);
  assert.match(String(scaleExpression.input.payload.expression), /thisComp\.frameDuration/);
  assert.match(String(scaleExpression.input.payload.expression), /var factor=1\+pulse/);
});

test("M6.5-M6.6 comparator diagnoses degradation and anti-simplification fails closed", () => {
  const reference = shutterReference();
  const render = degradedFlashZoom();
  const anatomy = deriveEffectAnatomyV1(reference);
  const graph = buildConstructionGraphV1(anatomy);
  const compilation = compileConstructionGraphV1(graph, ALL_CAPABILITIES);
  const comparison = compareSemanticVisualFidelityV1({ reference, render, dna: anatomy.dna });
  const gate = evaluateProfessionalFidelityGateV1({ comparison, compilation, synthesisPossible: true });
  assert.equal(comparison.passed, false);
  assert.ok(comparison.diagnoses.some((item) => /temporalStateCountPeak/.test(item)));
  assert.ok(comparison.diagnoses.some((item) => /overlapDensityPeak/.test(item)));
  assert.equal(gate.certified, false);
  assert.equal(gate.weakerSubstitutionDetected, true);
  assert.equal(gate.outcome, "CORRECTION_REQUIRED");
});

test("M6.6 passes faithful behavior and refuses genuine capability gaps", () => {
  const reference = shutterReference();
  const dna = canonicalTransitionDnaV1("SHUTTER_FRAGMENTATION", reference.evidenceRefs);
  const anatomy = deriveEffectAnatomyV1(reference);
  const graph = buildConstructionGraphV1(anatomy);
  const goodCompilation = compileConstructionGraphV1(graph, ALL_CAPABILITIES);
  const comparison = compareSemanticVisualFidelityV1({ reference, render: reference, dna });
  assert.equal(evaluateProfessionalFidelityGateV1({
    comparison,
    compilation: goodCompilation,
    synthesisPossible: true,
  }).certified, true);

  const missing = compileConstructionGraphV1(graph, []);
  const gap = evaluateProfessionalFidelityGateV1({ comparison, compilation: missing, synthesisPossible: false });
  assert.equal(gap.outcome, "CAPABILITY_GAP");
  assert.equal(gap.certified, false);
});

test("M6.7 maps visual deficits to construction controls before touching AE parameters", () => {
  const reference = shutterReference();
  const anatomy = deriveEffectAnatomyV1(reference);
  const graph = buildConstructionGraphV1(anatomy);
  const comparison = compareSemanticVisualFidelityV1({
    reference,
    render: degradedFlashZoom(),
    dna: anatomy.dna,
  });
  const plan = deriveConstructionActuationPlanV1({ graph, comparison });
  assert.deepEqual(plan.unresolvedInvariantIds, []);
  assert.ok(plan.instructions.every((instruction) => instruction.defining));

  const overlap = plan.instructions.filter((instruction) =>
    instruction.invariantId === "shutter.overlap");
  assert.deepEqual(overlap.map((instruction) => instruction.control).sort(),
    ["DUPLICATE_OPACITY", "DUPLICATE_SPREAD", "TEMPORAL_BAND_MIX", "TEMPORAL_FRAGMENT_DENSITY"]);
  assert.ok(overlap.every((instruction) =>
    instruction.direction === "INCREASE" && instruction.multiplier > 1));

  const recovery = plan.instructions.find((instruction) =>
    instruction.invariantId === "shutter.recovery");
  assert.equal(recovery?.control, "RECOVERY_DURATION");
  assert.equal(recovery?.direction, "DECREASE");
  assert.ok((recovery?.multiplier ?? 1) < 1);
});

test("M6.7 maps event-local UNKNOWN fragmentation overlap to temporal construction controls", () => {
  const reference = shutterReference();
  const anatomy = decomposeUnknownEffectV1(reference);
  const graph = buildConstructionGraphV1(anatomy);
  const comparison = compareSemanticVisualFidelityV1({
    reference,
    render: degradedFlashZoom(),
    dna: anatomy.dna,
  });
  const plan = deriveConstructionActuationPlanV1({ graph, comparison });
  const overlap = plan.instructions.filter((instruction) =>
    instruction.invariantId === "unknown.fragmentation-overlap");
  assert.deepEqual(overlap.map((instruction) => instruction.control).sort(),
    ["DUPLICATE_OPACITY", "DUPLICATE_SPREAD", "TEMPORAL_BAND_MIX", "TEMPORAL_FRAGMENT_DENSITY"]);
  assert.ok(overlap.every((instruction) => instruction.direction === "INCREASE"));
  assert.ok(!plan.unresolvedInvariantIds.includes("unknown.fragmentation-overlap"));
});

test("M6.7 visible-state correction strengthens existing duplicates before increasing structural count", () => {
  const reference = evidence({
    temporalStateCountPeak: 5,
    temporalPersistence: 0.65,
    overlapDensityPeak: 0.8,
    stateSeparationPeak: 0.04,
    accelerationPeak: 0.07,
    recoveryFrames: 5,
  });
  const anatomy = decomposeUnknownEffectV1(reference);
  const graph = buildConstructionGraphV1(anatomy);
  const render = evidence({
    ...reference.summary,
    temporalStateCountPeak: 3,
  });
  const comparison = compareSemanticVisualFidelityV1({
    reference,
    render: { ...render, sourceKind: "RENDER" },
    dna: anatomy.dna,
  });
  const stateFailure = comparison.metrics.find((metric) =>
    metric.invariantId === "unknown.fragmentation-states");
  assert.ok(stateFailure && !stateFailure.passed);
  const plan = deriveConstructionActuationPlanV1({ graph, comparison });
  const stateInstructions = plan.instructions.filter((instruction) =>
    instruction.invariantId === "unknown.fragmentation-states");
  assert.deepEqual(stateInstructions.map((instruction) => instruction.control),
    ["DUPLICATE_OPACITY"]);
  const application = applyConstructionActuationPlanV1(graph, plan);
  const temporal = application.graph.nodes.find((node) =>
    node.kind === "TEMPORAL_DUPLICATES");
  assert.ok((temporal?.parameters.duplicateOpacityScale ?? 1) > 1);
  assert.equal(temporal?.parameters.temporalCopyCountScale, undefined);
});

test("M6.5 shutter RANGE fidelity is reference-relative inside the broader family envelope", () => {
  const reference = evidence({
    temporalStateCountPeak: 4,
    overlapDensityPeak: 0.32,
    stateSeparationPeak: 0.022,
    accelerationPeak: 0.08,
    recoveryFrames: 3,
  });
  const familyValidButUnfaithful = evidence({
    ...reference.summary,
    stateSeparationPeak: 0.06,
  });
  const comparison = compareSemanticVisualFidelityV1({
    reference,
    render: familyValidButUnfaithful,
    dna: canonicalTransitionDnaV1("SHUTTER_FRAGMENTATION"),
  });
  const displacement = comparison.metrics.find((item) => item.invariantId === "shutter.displacement");
  assert.equal(displacement?.passed, false);
  assert.match(displacement?.diagnosis ?? "", /over-driven/);
});

test("M6.5 shutter fidelity rejects materially over-driven within-frame separation", () => {
  const reference = shutterReference();
  const overSeparated = evidence({
    ...reference.summary,
    stateSeparationPeak: 0.2,
  });
  const comparison = compareSemanticVisualFidelityV1({
    reference,
    render: overSeparated,
    dna: canonicalTransitionDnaV1("SHUTTER_FRAGMENTATION"),
  });
  const displacement = comparison.metrics.find((item) => item.invariantId === "shutter.displacement");
  assert.equal(displacement?.passed, false);
  assert.match(displacement?.diagnosis ?? "", /over-driven/);
});

test("M6.7 overlap correction cannot over-drive already excessive state separation", () => {
  const reference = shutterReference();
  const anatomy = deriveEffectAnatomyV1(reference);
  const graph = buildConstructionGraphV1(anatomy);
  const render = evidence({
    temporalStateCountPeak: 4,
    temporalPersistence: 0.55,
    motionEnergyPeak: 0.5,
    displacementPeak: 0.24,
    stateSeparationPeak: 0.12,
    blurPeak: 0.35,
    exposurePeak: 0.7,
    overlapDensityPeak: 0.08,
    accelerationPeak: 0.09,
    recoveryFrames: 3,
  });
  const comparison = compareSemanticVisualFidelityV1({ reference, render, dna: anatomy.dna });
  const plan = deriveConstructionActuationPlanV1({ graph, comparison });
  const opacity = plan.instructions.find((item) => item.control === "DUPLICATE_OPACITY");
  const spread = plan.instructions.find((item) => item.control === "DUPLICATE_SPREAD");
  assert.equal(opacity?.direction, "INCREASE");
  assert.equal(spread?.metric, "fragmentationStateSeparationPeak");
  assert.equal(spread?.direction, "DECREASE");
  assert.ok((spread?.multiplier ?? 1) < 1);
  const applied = applyConstructionActuationPlanV1(graph, plan);
  const temporal = applied.graph.nodes.find((node) => node.kind === "TEMPORAL_DUPLICATES");
  assert.ok(Number(temporal?.parameters.duplicateOpacityScale ?? 1) > 1);
  assert.ok(Number(temporal?.parameters.duplicateSpreadScale ?? 1) < 1);
  assert.ok(applied.appliedInstructionIds.includes(opacity?.instructionId ?? "missing"));
  assert.ok(applied.appliedInstructionIds.includes(spread?.instructionId ?? "missing"));
});

test("M6.7 maps temporal-state separation deficits to both semantic separation and the duplicate-spread construction actuator", () => {
  const reference = shutterReference();
  const anatomy = deriveEffectAnatomyV1(reference);
  const graph = buildConstructionGraphV1(anatomy);
  const overSeparated = evidence({
    ...reference.summary,
    stateSeparationPeak: 0.12,
  });
  const comparison = compareSemanticVisualFidelityV1({ reference, render: overSeparated, dna: anatomy.dna });
  const plan = deriveConstructionActuationPlanV1({ graph, comparison });
  const separation = plan.instructions.filter((item) => item.invariantId === "shutter.displacement");
  assert.ok(separation.some((item) => item.control === "SPATIAL_SEPARATION"));
  const spread = separation.find((item) => item.control === "DUPLICATE_SPREAD");
  assert.ok(spread, "state-separation diagnosis must reach the physical temporal-duplicate spread actuator");
  assert.equal(spread.direction, "DECREASE");
  assert.equal(spread.metric, "fragmentationStateSeparationPeak");
});

test("M6.7 bounded local correction improves an under-driven shutter until fidelity passes", async () => {
  const reference = shutterReference();
  const anatomy = deriveEffectAnatomyV1(reference);
  const graph = buildConstructionGraphV1(anatomy);
  const underDriven = {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      parameters: Object.fromEntries(Object.entries(node.parameters).map(([name, value]) => {
        if (name === "recoveryFrames") return [name, 10];
        return [name, typeof value === "number" ? value * 0.5 : value];
      })),
    })),
  };
  let applied = 0;
  const renderFromGraph = (candidate) => {
    const parameters = Object.assign({}, ...candidate.nodes.map((node) => node.parameters));
    return evidence({
      temporalStateCountPeak: parameters.temporalStateCountPeak ?? 1,
      temporalPersistence: 0.5,
      motionEnergyPeak: 0.45,
      displacementPeak: parameters.displacementPeak ?? 0,
      stateSeparationPeak: parameters.fragmentationStateSeparationPeak
        ?? parameters.stateSeparationPeak
        ?? 0,
      blurPeak: parameters.blurPeak ?? 0.3,
      exposurePeak: parameters.exposurePeak ?? 0.7,
      overlapDensityPeak: parameters.overlapDensityPeak ?? 0,
      accelerationPeak: parameters.accelerationPeak ?? 0,
      recoveryFrames: parameters.recoveryFrames ?? 10,
    });
  };
  const result = await runAutomaticVisualCorrectionLoopV1({
    reference,
    dna: anatomy.dna,
    initialGraph: underDriven,
    availableCapabilities: ALL_CAPABILITIES,
    applyGraph: async () => { applied += 1; },
    renderLocalWindow: async (candidate) => renderFromGraph(candidate),
    maxIterations: 5,
    minimumImprovement: 0,
  });
  assert.equal(result.status, "PASSED");
  assert.ok(result.passes.length >= 2);
  assert.ok(result.passes.at(-1).comparison.weightedFidelity > result.passes[0].comparison.weightedFidelity);
  assert.ok(result.learnedPatches.length > 0);
  assert.equal(applied, result.passes.length);
  const memory = new VisualCorrectionMemoryV1();
  memory.remember("SHUTTER_FRAGMENTATION", result.learnedPatches);
  const restored = new VisualCorrectionMemoryV1(memory.snapshot());
  assert.deepEqual(restored.recall("SHUTTER_FRAGMENTATION"), result.learnedPatches);
});

test("M6.8 synthesizes three deliberately unlearned effects from observed primitives", () => {
  const unknowns = [
    evidence({ temporalStateCountPeak: 2, displacementPeak: 0.11, distortionPeak: 0.2, accelerationPeak: 0.04 }),
    evidence({ subjectSeparationPeak: 0.24, overlapDensityPeak: 0.2, motionEnergyPeak: 0.2 }, { maskCoverage: 0.16 }),
    evidence({ scaleRange: 0.08, blurPeak: 0.22, occlusionPeak: 0.3, accelerationPeak: 0.035 }),
  ];
  const memory = new SynthesizedEffectMemoryV1();
  for (const unknown of unknowns) {
    const result = synthesizeUnknownEffectV1({ evidence: unknown, availableCapabilities: ALL_CAPABILITIES });
    assert.equal(result.status, "READY_FOR_PROOF");
    assert.notEqual(result.selected, null);
    assert.equal(result.selected.definingCoverage, 1);
    assert.ok(result.provenance.includes(unknown.contentKey));
    assert.equal(memory.remember(unknown.contentKey, result, true), true);
  }
  const restored = new SynthesizedEffectMemoryV1(memory.snapshot());
  assert.notEqual(restored.recall(unknowns[0].contentKey), null);
});

test("M6.8 unknown decomposition protects coherent event-local DNA from unrelated global maxima", () => {
  const reference = evidence({
    temporalStateCountPeak: 4,
    temporalPersistence: 0.66,
    scaleRange: 0.14,
    blurPeak: 0.99,
    distortionPeak: 0.47,
    overlapDensityPeak: 0.30,
    stateSeparationPeak: 0.19,
    fragmentationCoherencePeak: 0.275,
    fragmentationCoherencePhase: 0.35,
    fragmentationTemporalStateCountPeak: 2,
    fragmentationOverlapDensityPeak: 0.055,
    fragmentationStateSeparationPeak: 0.0217,
    accelerationPeak: 0.07,
    recoveryFrames: 6,
  });
  const anatomy = decomposeUnknownEffectV1(reference);
  assert.equal(anatomy.family, "UNKNOWN");
  assert.equal(anatomy.observedMetrics.fragmentationOverlapDensityPeak, 0.055);
  assert.equal(anatomy.observedMetrics.fragmentationStateSeparationPeak, 0.0217);
  assert.ok(anatomy.dna.definingInvariants.some((item) =>
    item.invariantId === "unknown.fragmentation-coordination"));
  assert.ok(anatomy.dna.optionalInvariants.some((item) =>
    item.invariantId === "unknown.scale"),
  "large source/global scale behavior is secondary when a coherent temporal event is the causal core");

  const faithful = evidence({
    temporalStateCountPeak: 3,
    temporalPersistence: 0.29,
    scaleRange: 0.04,
    blurPeak: 0.97,
    distortionPeak: 0.50,
    overlapDensityPeak: 0.058,
    stateSeparationPeak: 0.18,
    fragmentationCoherencePeak: 0.29,
    fragmentationCoherencePhase: 0.54,
    fragmentationTemporalStateCountPeak: 2,
    fragmentationOverlapDensityPeak: 0.058,
    fragmentationStateSeparationPeak: 0.0196,
    accelerationPeak: 0.085,
    recoveryFrames: 1,
  });
  const comparison = compareSemanticVisualFidelityV1({
    reference,
    render: { ...faithful, sourceKind: "RENDER" },
    dna: anatomy.dna,
  });
  assert.equal(comparison.definingCoverage, 1);
  assert.equal(comparison.passed, true);

  const globallyDecoratedButEventMissing = evidence({
    temporalStateCountPeak: 4,
    temporalPersistence: 0.66,
    scaleRange: 0.14,
    blurPeak: 0.99,
    distortionPeak: 0.47,
    overlapDensityPeak: 0.30,
    stateSeparationPeak: 0.19,
    fragmentationCoherencePeak: 0.01,
    fragmentationCoherencePhase: 0.35,
    fragmentationTemporalStateCountPeak: 1,
    fragmentationOverlapDensityPeak: 0.005,
    fragmentationStateSeparationPeak: 0.001,
    accelerationPeak: 0.07,
    recoveryFrames: 6,
  });
  const rejected = compareSemanticVisualFidelityV1({
    reference,
    render: { ...globallyDecoratedButEventMissing, sourceKind: "RENDER" },
    dna: anatomy.dna,
  });
  assert.equal(rejected.passed, false);
  assert.ok(rejected.metrics.some((item) =>
    item.invariantId === "unknown.fragmentation-coordination" && !item.passed));
  assert.ok(rejected.metrics.some((item) =>
    item.invariantId === "unknown.fragmentation-overlap" && !item.passed));
});

test("M6.3/M6.5 preserves peak-aligned blur recovery across semantic windows", () => {
  const referenceBase = evidence({
    frameCount: 12,
    frameIntervalMs: 20,
    blurPeak: 0.5,
    blurPeakPhase: 2 / 11,
    opticalPeakPhase: 2 / 11,
  });
  const referenceBlur = [0.05, 0.3, 0.5, 0.4, 0.32, 0.26, 0.1, 0.05, 0.03, 0.02, 0.01, 0];
  const reference = {
    ...referenceBase,
    frames: referenceBase.frames.map((frame, index) => ({
      ...frame,
      blurStrength: referenceBlur[index] ?? 0,
    })),
  };
  const profile = measureHalfPeakTemporalProfileV1(reference, "blurStrength");
  assert.equal(profile.peakIndex, 2);
  assert.equal(profile.attackMs, 20);
  assert.equal(profile.recoveryMs, 60);

  const anatomy = decomposeUnknownEffectV1(reference);
  assert.ok(anatomy.dna.definingInvariants.some((item) =>
    item.invariantId === "unknown.blur"));
  assert.ok(anatomy.dna.definingInvariants.some((item) =>
    item.invariantId === "unknown.blur-recovery"));
  const graph = buildConstructionGraphV1(anatomy);
  const optical = graph.nodes.find((node) => node.kind === "OPTICAL_TREATMENT");
  assert.equal(optical?.parameters.blurHalfPeakRecoveryMs, 60);

  const degradedBase = evidence({
    frameCount: 12,
    frameIntervalMs: 20,
    blurPeak: 0.5,
    blurPeakPhase: 2 / 11,
    opticalPeakPhase: 2 / 11,
  });
  const degraded = {
    ...degradedBase,
    analyzerFingerprint: reference.analyzerFingerprint,
    frames: degradedBase.frames.map((frame, index) => ({
      ...frame,
      blurStrength: index === 2 ? 0.5 : 0.05,
    })),
  };
  const comparison = compareSemanticVisualFidelityV1({
    reference,
    render: degraded,
    dna: anatomy.dna,
  });
  assert.equal(comparison.passed, false);
  assert.ok(comparison.metrics.some((item) =>
    item.invariantId === "unknown.blur-recovery" && !item.passed));
  const actuation = deriveConstructionActuationPlanV1({ graph, comparison });
  assert.ok(actuation.instructions.some((item) =>
    item.invariantId === "unknown.blur-recovery"
    && item.control === "BLUR_RECOVERY_DURATION"));
});

test("M6.8 rejects uncorroborated global temporal-state texture as unknown effect identity", () => {
  const reference = evidence({
    temporalStateCountPeak: 5,
    temporalPersistence: 0,
    overlapDensityPeak: 0.072,
    stateSeparationPeak: 0,
    fragmentationCoherencePeak: 0,
    fragmentationTemporalStateCountPeak: 0,
    fragmentationOverlapDensityPeak: 0,
    fragmentationStateSeparationPeak: 0,
    blurPeak: 0.457,
    distortionPeak: 0.078,
    motionEnergyPeak: 0.003,
    recoveryFrames: 1,
  });
  const anatomy = decomposeUnknownEffectV1(reference);
  assert.ok(!anatomy.dna.definingInvariants.some((item) =>
    item.invariantId === "unknown.temporal-states"));
  assert.ok(anatomy.dna.definingInvariants.some((item) =>
    item.invariantId === "unknown.blur"));

  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: ALL_CAPABILITIES,
  });
  assert.equal(synthesis.status, "READY_FOR_PROOF");
  assert.notEqual(synthesis.selected, null);
  assert.equal(synthesis.selected.graph.nodes.some((node) =>
    node.kind === "TEMPORAL_DUPLICATES"), false);
});

test("M6.8 keeps event-coordinated compound systems defining alongside fragmentation", () => {
  const seed = evidence({
    frameCount: 9,
    temporalStateCountPeak: 3,
    temporalPersistence: 0.7,
    scaleRange: 0.45,
    blurPeak: 0.85,
    fragmentationCoherencePeak: 0.62,
    fragmentationCoherencePhase: 0.5,
    fragmentationTemporalStateCountPeak: 3,
    fragmentationOverlapDensityPeak: 0.4,
    fragmentationStateSeparationPeak: 0.06,
    accelerationPeak: 0.05,
    recoveryFrames: 3,
  });
  const reference = {
    ...seed,
    frames: seed.frames.map((frame, index) => {
      const phase = index / (seed.frames.length - 1);
      const inEvent = Math.abs(phase - 0.5) <= 0.12;
      return {
        ...frame,
        scale: inEvent ? 1.45 : 1,
        blurStrength: inEvent ? 0.85 : 0.08,
        chromaticSeparation: inEvent ? 0.32 : 0.03,
        temporalStateCount: inEvent ? 3 : 1,
        overlapDensity: inEvent ? 0.4 : 0,
        stateSeparation: inEvent ? 0.06 : 0,
      };
    }),
  };
  const anatomy = decomposeUnknownEffectV1(reference);
  const defining = new Set(anatomy.dna.definingInvariants.map((item) => item.invariantId));
  assert.ok(defining.has("unknown.scale"));
  assert.ok(defining.has("unknown.blur"));
  assert.ok(defining.has("unknown.chroma"));

  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: ALL_CAPABILITIES,
  });
  assert.equal(synthesis.status, "READY_FOR_PROOF");
  assert.ok(synthesis.selected.graph.nodes.some((node) =>
    node.kind === "TRANSFORM_MOTION" && !node.optional));
  assert.ok(synthesis.selected.graph.nodes.some((node) =>
    node.kind === "OPTICAL_TREATMENT" && !node.optional));
  assert.ok(synthesis.selected.graph.nodes.some((node) =>
    node.kind === "CHROMATIC_TREATMENT" && !node.optional));
});

test("M6.8 chromatic treatment uses additive event-bounded channel fringes through native AE", () => {
  const seed = evidence({
    frameCount: 9,
    temporalStateCountPeak: 3,
    temporalPersistence: 0.7,
    scaleRange: 0.2,
    blurPeak: 0.5,
    fragmentationCoherencePeak: 0.62,
    fragmentationCoherencePhase: 0.5,
    fragmentationTemporalStateCountPeak: 3,
    fragmentationOverlapDensityPeak: 0.4,
    fragmentationStateSeparationPeak: 0.05,
    accelerationPeak: 0.05,
    recoveryFrames: 3,
  });
  const reference = {
    ...seed,
    frames: seed.frames.map((frame, index) => {
      const phase = index / (seed.frames.length - 1);
      const inEvent = Math.abs(phase - 0.5) <= 0.12;
      return {
        ...frame,
        chromaticSeparation: inEvent ? 0.34 : 0.01,
        temporalStateCount: inEvent ? 3 : 1,
        overlapDensity: inEvent ? 0.4 : 0,
        stateSeparation: inEvent ? 0.05 : 0,
      };
    }),
  };
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: ALL_CAPABILITIES,
  });
  assert.equal(synthesis.status, "READY_FOR_PROOF");
  const compilation = compileConstructionGraphV1(synthesis.selected.graph, ALL_CAPABILITIES);
  assert.notEqual(compilation.recipe, null);
  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp",
      name: "M6 chromatic fringe fixture",
      width: 1080,
      height: 1080,
      durationMs: 3000,
      frameRate: 30,
      layers: [{
        layerId: "hero",
        name: "Hero",
        kind: "FOOTAGE",
        inMs: 0,
        outMs: 3000,
        properties: [],
        effects: [],
        masks: [],
      }],
    }],
  };
  const compiled = compileEditingIrRecipeToVirtualAeV1(compilation.recipe, project, {
    compId: "comp",
    eventTimesMs: { transition: 1500 },
    roleBindings: [{ role: "hero", layerIds: ["hero"] }],
    parameterValues: {},
  });
  const fringeBlendOps = compiled.operations.filter((operation) =>
    operation.type === "SET_BLEND_MODE" && operation.layerId.includes("::fringe::"));
  assert.equal(fringeBlendOps.length, 2);
  assert.ok(fringeBlendOps.every((operation) => operation.blendMode === "ADD"));
  const fringeOpacityOps = compiled.operations.filter((operation) =>
    operation.type === "SET_EXPRESSION"
    && operation.layerId.includes("::fringe::")
    && operation.propertyPath === "Transform.Opacity");
  assert.equal(fringeOpacityOps.length, 2);
  assert.ok(fringeOpacityOps.every((operation) =>
    operation.expression.includes("var event=1.5;")
    && operation.expression.includes("envelope=0")
    && operation.expression.includes("peak*envelope")));

  const native = lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "m6-chromatic-additive-fringe",
    observedState: {
      projectId: "m6-project",
      projectRevision: "ae-revision:32326",
      projectFingerprint: "project:sha256:m6-chromatic-additive-fringe",
      environmentFingerprint: "environment:sha256:ae-25.6.6",
    },
    creativeObjective: "Materialize bounded additive channel fringes without opaque color-layer substitution.",
  });
  const nativeBlendOps = native.operations.filter((operation) =>
    operation.input.command === "layer.set_blend_mode");
  assert.equal(nativeBlendOps.length, 2);
  assert.ok(nativeBlendOps.every((operation) =>
    operation.input.payload.blendMode === "ADD"
    && String(operation.routeId) === "ae-cep.composite.v1_3"));
  assert.ok(native.requiredCapabilities.includes("ae.layer.blend_mode.set"));
});

test("M6.8 searches genuinely different construction hypotheses and can select a native-effect alternative", () => {
  const unknown = evidence({
    temporalStateCountPeak: 3,
    temporalPersistence: 0.55,
    overlapDensityPeak: 0.05,
    motionEnergyPeak: 0.08,
    accelerationPeak: 0.01,
  });
  const result = synthesizeUnknownEffectV1({
    evidence: unknown,
    availableCapabilities: ["ae.effect.echo"],
  });
  assert.equal(result.status, "READY_FOR_PROOF");
  assert.equal(result.selected?.strategy, "NATIVE_ECHO_HYBRID");
  const strategies = new Set(result.candidates.map((item) => item.strategy));
  assert.ok(strategies.has("LAYERED_PRIMITIVES"));
  assert.ok(strategies.has("NATIVE_ECHO_HYBRID"));
  assert.ok(strategies.has("TIME_DISPLACEMENT_HYBRID"));

  const layered = result.candidates.find((item) => item.strategy === "LAYERED_PRIMITIVES");
  assert.ok(layered?.capabilityGaps.includes("ae.layer.duplicate"));
  const timeDisplacement = result.candidates.find((item) =>
    item.strategy === "TIME_DISPLACEMENT_HYBRID");
  assert.ok(timeDisplacement?.adaptiveCapabilityProposals.some((proposal) =>
    proposal.capabilityId === "ae.effect.time-displacement"
    && proposal.proofRequirement === "REAL_AE_RENDER"));
});

test("M6.8 escalation selects an alternate construction that directly targets exhausted invariants", () => {
  const result = synthesizeUnknownEffectV1({
    evidence: evidence({
      temporalStateCountPeak: 3,
      temporalPersistence: 0.55,
      overlapDensityPeak: 0.05,
      distortionPeak: 0.4,
      motionEnergyPeak: 0.08,
      accelerationPeak: 0.01,
    }),
    availableCapabilities: [
      ...ALL_CAPABILITIES,
      "ae.effect.echo",
      "ae.precompose.layers",
      "ae.effect.turbulent-displace",
    ],
  });
  assert.equal(result.selected?.strategy, "LAYERED_PRIMITIVES");

  const temporal = selectSynthesisEscalationCandidateV1({
    synthesis: result,
    currentStrategy: result.selected?.strategy,
    requiredInvariantIds: ["unknown.persistence", "unknown.acceleration"],
  });
  assert.equal(temporal?.strategy, "LAYERED_ECHO_AUGMENTED");

  const compound = selectSynthesisEscalationCandidateV1({
    synthesis: result,
    currentStrategy: result.selected?.strategy,
    requiredInvariantIds: ["unknown.persistence", "unknown.distortion"],
  });
  assert.equal(compound?.strategy, "COMPOUND_NATIVE_HYBRID");

  const distortion = selectSynthesisEscalationCandidateV1({
    synthesis: result,
    currentStrategy: result.selected?.strategy,
    requiredInvariantIds: ["unknown.distortion"],
  });
  assert.equal(distortion?.strategy, "TURBULENT_DISPLACE_HYBRID");

  const monotonicCompound = selectSynthesisEscalationCandidateV1({
    synthesis: result,
    currentStrategy: "LAYERED_ECHO_AUGMENTED",
    requiredInvariantIds: ["unknown.distortion", "unknown.acceleration"],
  });
  assert.equal(monotonicCompound?.strategy, "COMPOUND_NATIVE_HYBRID");

  const noCompoundDeescalation = selectSynthesisEscalationCandidateV1({
    synthesis: result,
    currentStrategy: "COMPOUND_NATIVE_HYBRID",
    requiredInvariantIds: ["unknown.distortion"],
  });
  assert.equal(noCompoundDeescalation, null,
    "a compound graph that already contains Turbulent Displace must not de-escalate to the simpler Turbulent-only strategy");

  const unrelated = selectSynthesisEscalationCandidateV1({
    synthesis: result,
    currentStrategy: result.selected?.strategy,
    requiredInvariantIds: ["unknown.subject-separation"],
  });
  assert.equal(unrelated, null);

  const noReproof = selectSynthesisEscalationCandidateV1({
    synthesis: result,
    currentStrategy: result.selected?.strategy,
    requiredInvariantIds: ["unknown.persistence", "unknown.acceleration"],
    excludedStrategies: ["LAYERED_ECHO_AUGMENTED"],
  });
  assert.notEqual(noReproof?.strategy, "LAYERED_ECHO_AUGMENTED",
    "an unchanged synthesis strategy with retained losing render evidence must not be selected for re-proof");

  const distortionMotionOnly = synthesizeUnknownEffectV1({
    evidence: evidence({
      temporalStateCountPeak: 1,
      temporalPersistence: 0,
      overlapDensityPeak: 0,
      blurPeak: 0.33,
      distortionPeak: 0.9,
      motionEnergyPeak: 0.08,
      accelerationPeak: 0.04,
    }),
    availableCapabilities: [
      ...ALL_CAPABILITIES,
      "ae.effect.turbulent-displace",
    ],
  });
  const distortionOnlyCompound = distortionMotionOnly.candidates.find((candidate) =>
    candidate.strategy === "COMPOUND_NATIVE_HYBRID");
  assert.ok(distortionOnlyCompound,
    "compound distortion synthesis must not require unrelated temporal/persistence anatomy");
  const distortionOnlyRecovery = distortionOnlyCompound.graph.nodes.find((node) =>
    node.kind === "RECOVERY");
  assert.notEqual(distortionOnlyRecovery?.parameters.synthesisStrategy, "COMPOUND_NATIVE_HYBRID");
  assert.notEqual(distortionOnlyRecovery?.parameters.motionProfile, "SHUTTER_CONVERGENCE",
    "distortion-only synthesis must not manufacture shutter convergence or fragmentation");
  const postTurbulentDistortion = selectSynthesisEscalationCandidateV1({
    synthesis: distortionMotionOnly,
    currentStrategy: distortionMotionOnly.selected?.strategy,
    requiredInvariantIds: ["unknown.blur", "unknown.distortion"],
    excludedStrategies: ["TURBULENT_DISPLACE_HYBRID"],
  });
  assert.equal(postTurbulentDistortion?.strategy, "COMPOUND_NATIVE_HYBRID",
    "after a Turbulent-only loss, distortion synthesis must layer new machinery instead of reporting no candidate");
});

test("M6.8 layered Echo augmentation preserves layered fragmentation while targeting persistence", () => {
  const reference = evidence({
    temporalStateCountPeak: 5,
    temporalPersistence: 0.66,
    overlapDensityPeak: 0.9,
    scaleRange: 0.14,
    blurPeak: 0.9,
    distortionPeak: 0.42,
    accelerationPeak: 0.07,
    recoveryFrames: 6,
  });
  const capabilities = [...ALL_CAPABILITIES, "ae.effect.echo"];
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: capabilities,
  });
  const augmented = synthesis.candidates.find((candidate) =>
    candidate.strategy === "LAYERED_ECHO_AUGMENTED");
  assert.ok(augmented);
  assert.deepEqual(
    augmented.graph.invariantCoverage["unknown.persistence"]?.slice(0, 2),
    ["node:1:temporal_duplicates", "node:1:temporal_duplicates:echo-augmentation"],
    "layered persistence correction must actuate the temporal visibility window before Echo spacing",
  );
  const weakPersistence = evidence({
    temporalStateCountPeak: 5,
    temporalPersistence: 0.2,
    overlapDensityPeak: 0.9,
    scaleRange: 0.14,
    blurPeak: 0.9,
    distortionPeak: 0.42,
    accelerationPeak: 0.07,
    recoveryFrames: 6,
  });
  const persistenceComparison = compareSemanticVisualFidelityV1({
    reference,
    render: weakPersistence,
    dna: decomposeUnknownEffectV1(reference).dna,
    alignment: "SEMANTIC",
  });
  const persistencePlan = deriveConstructionActuationPlanV1({
    graph: augmented.graph,
    comparison: persistenceComparison,
  });
  const persistenceInstruction = persistencePlan.instructions.find((instruction) =>
    instruction.invariantId === "unknown.persistence"
    && instruction.control === "TEMPORAL_PERSISTENCE");
  assert.equal(persistenceInstruction?.nodeId, "node:1:temporal_duplicates");
  const correctedPersistence = applyConstructionActuationPlanV1(
    augmented.graph,
    persistencePlan,
  ).graph;
  assert.ok(Number(correctedPersistence.nodes.find((node) =>
    node.nodeId === "node:1:temporal_duplicates")?.parameters.temporalPersistenceScale) > 1);
  assert.equal(
    correctedPersistence.nodes.find((node) =>
      node.nodeId === "node:1:temporal_duplicates:echo-augmentation")?.parameters.echoSpacingFrames,
    augmented.graph.nodes.find((node) =>
      node.nodeId === "node:1:temporal_duplicates:echo-augmentation")?.parameters.echoSpacingFrames,
  );
  const compilation = compileConstructionGraphV1(augmented.graph, capabilities);
  assert.notEqual(compilation.recipe, null);
  assert.ok(compilation.recipe.nodes.some((node) => node.kind === "TEMPORAL_DUPLICATION"));
  const echoNode = compilation.recipe.nodes.find((node) =>
    node.parameters.some((parameter) =>
      parameter.name === "synthesisStrategy"
      && parameter.value === "LAYERED_ECHO_AUGMENTED"));
  assert.equal(echoNode?.kind, "EFFECT_STACK");
  assert.equal(
    echoNode?.parameters.find((parameter) => parameter.name === "effectSchemaRef")?.value,
    "ae.effect-schema.m6.echo.v1",
  );

  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp",
      name: "Layered Echo augmentation proof",
      width: 640,
      height: 360,
      durationMs: 1000,
      frameRate: 30,
      layers: [{
        layerId: "hero",
        name: "Hero",
        kind: "PRECOMP",
        sourceRef: "source",
        inMs: 0,
        outMs: 1000,
        properties: [],
        effects: [],
        masks: [],
      }],
    }],
  };
  const compiled = compileEditingIrRecipeToVirtualAeV1(
    compilation.recipe,
    project,
    {
      compId: "comp",
      eventTimesMs: { transition: 500 },
      roleBindings: [{ role: "hero", layerIds: ["hero"] }],
      parameterValues: {},
      proofOnlyEffectSchemaRefs: ["ae.effect-schema.m6.echo.v1"],
    },
  );
  const plan = lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "m6-layered-echo-augmented-proof-plan",
    observedState: {
      projectId: "m6-project",
      projectRevision: "ae-revision:32326",
      projectFingerprint: "project:sha256:m6-layered-echo-augmented",
      environmentFingerprint: "environment:sha256:ae-25.6.6",
    },
    creativeObjective: "Add temporal memory without replacing the layered fragmentation system.",
  });
  const commands = plan.operations.map((operation) => operation.input.command);
  const precomposeIndex = commands.indexOf("layers.precompose");
  const duplicateIndices = commands
    .map((command, index) => command === "layer.duplicate" ? index : -1)
    .filter((index) => index >= 0);
  const echoIndices = plan.operations
    .map((operation, index) =>
      operation.input.command === "effect.add"
      && operation.input.payload.matchName === "ADBE Echo"
        ? index
        : -1)
    .filter((index) => index >= 0);
  assert.ok(precomposeIndex >= 0);
  assert.equal(duplicateIndices.length, 4);
  assert.equal(echoIndices.length, 4,
    "event-local Echo must augment the four fragmented accent states without affecting the base state");
  assert.ok(duplicateIndices.every((index) => precomposeIndex < index));
  assert.ok(echoIndices.every((index) => index > Math.max(...duplicateIndices)));
  assert.ok(plan.operations.length <= 96);
});

test("M6.8 compound native escalation preserves layered behavior while jointly targeting persistence and distortion", () => {
  const reference = evidence({
    temporalStateCountPeak: 5,
    temporalPersistence: 0.66,
    overlapDensityPeak: 0.9,
    scaleRange: 0.14,
    blurPeak: 0.9,
    distortionPeak: 0.42,
    accelerationPeak: 0.07,
    recoveryFrames: 4,
  });
  const capabilities = [
    ...ALL_CAPABILITIES,
    "ae.effect.echo",
    "ae.effect.turbulent-displace",
  ];
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: capabilities,
  });
  const compound = synthesis.candidates.find((candidate) =>
    candidate.strategy === "COMPOUND_NATIVE_HYBRID");
  assert.ok(compound);
  assert.deepEqual(compound.capabilityGaps, []);
  assert.ok(compound.graph.nodes.some((node) =>
    node.kind === "TEMPORAL_DUPLICATES"
    && node.parameters.synthesisStrategy === undefined));
  assert.ok(compound.graph.nodes.some((node) =>
    node.parameters.synthesisStrategy === "LAYERED_ECHO_AUGMENTED"
    && node.requiredInvariantIds.includes("unknown.persistence")));
  const retainedDistortion = compound.graph.nodes.find((node) =>
    node.kind === "DISTORTION"
    && node.parameters.synthesisStrategy === undefined
    && node.requiredInvariantIds.includes("unknown.distortion"));
  const turbulentAugmentation = compound.graph.nodes.find((node) =>
    node.parameters.synthesisStrategy === "TURBULENT_DISPLACE_HYBRID"
    && node.requiredInvariantIds.includes("unknown.distortion"));
  const recoveryMotion = compound.graph.nodes.find((node) =>
    node.kind === "RECOVERY"
    && node.requiredInvariantIds.includes("unknown.acceleration"));
  assert.ok(retainedDistortion);
  assert.ok(turbulentAugmentation);
  assert.ok(recoveryMotion);
  assert.equal(recoveryMotion.parameters.motionProfile, "SHUTTER_CONVERGENCE",
    "compound fragmentation must shape acceleration as a zero-net convergence pulse");
  assert.equal(recoveryMotion.parameters.synthesisStrategy, "COMPOUND_NATIVE_HYBRID",
    "compound acceleration intervention must retain synthesis provenance for monotonic escalation");
  assert.deepEqual(turbulentAugmentation.dependsOn, [retainedDistortion.nodeId]);
  assert.equal(compound.graph.invariantCoverage["unknown.distortion"]?.[0], turbulentAugmentation.nodeId,
    "compound correction must tune the synthesized native warp before rewriting the retained displacement stage");

  const escalation = selectSynthesisEscalationCandidateV1({
    synthesis,
    currentStrategy: "LAYERED_PRIMITIVES",
    requiredInvariantIds: [
      "unknown.persistence",
      "unknown.distortion",
      "unknown.acceleration",
    ],
  });
  assert.equal(escalation?.strategy, "COMPOUND_NATIVE_HYBRID");

  const compilation = compileConstructionGraphV1(compound.graph, capabilities);
  assert.equal(compilation.definingCoverageComplete, true);
  assert.notEqual(compilation.recipe, null);
  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp",
      name: "Compound native hybrid proof",
      width: 640,
      height: 360,
      durationMs: 1000,
      frameRate: 30,
      layers: [{
        layerId: "hero",
        name: "Hero",
        kind: "PRECOMP",
        sourceRef: "source",
        inMs: 0,
        outMs: 1000,
        properties: [],
        effects: [],
        masks: [],
      }],
    }],
  };
  const compilerContext = {
    compId: "comp",
    eventTimesMs: { transition: 500 },
    roleBindings: [{ role: "hero", layerIds: ["hero"] }],
    parameterValues: {},
    proofOnlyEffectSchemaRefs: [
      "ae.effect-schema.m6.echo.v1",
      "ae.effect-schema.m6.turbulent-displace.v2",
    ],
  };
  const compiled = compileEditingIrRecipeToVirtualAeV1(
    compilation.recipe,
    project,
    compilerContext,
  );
  const plan = lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "m6-compound-native-hybrid-proof-plan",
    observedState: {
      projectId: "m6-project",
      projectRevision: "ae-revision:32326",
      projectFingerprint: "project:sha256:m6-compound-native-hybrid",
      environmentFingerprint: "environment:sha256:ae-25.6.6",
    },
    creativeObjective: "Preserve layered temporal behavior while augmenting persistence and distortion.",
  });
  const nativeEffects = plan.operations
    .filter((operation) => operation.input.command === "effect.add")
    .map((operation) => operation.input.payload.matchName);
  assert.ok(nativeEffects.includes("ADBE Echo"));
  assert.ok(nativeEffects.includes("ADBE Displacement Map"),
    "compound synthesis must retain the proven displacement construction");
  assert.ok(nativeEffects.includes("ADBE Turbulent Displace"));
  const displacementIndex = plan.operations.findIndex((operation) =>
    operation.input.command === "effect.add"
    && operation.input.payload.matchName === "ADBE Displacement Map");
  const turbulentIndex = plan.operations.findIndex((operation) =>
    operation.input.command === "effect.add"
    && operation.input.payload.matchName === "ADBE Turbulent Displace");
  assert.ok(displacementIndex >= 0 && turbulentIndex > displacementIndex,
    "native warp augmentation must execute after the retained displacement stage");
  assert.ok(plan.operations.some((operation) => operation.input.command === "layer.duplicate"));

  const baselineTurbulentAmount = compiled.operations.find((operation) =>
    operation.type === "SET_EFFECT_PROPERTY"
    && operation.effectId.startsWith(turbulentAugmentation.nodeId)
    && operation.propertyPath[0] === "ADBE Turbulent Displace-0002")?.value;
  const baselineTurbulentSize = compiled.operations.find((operation) =>
    operation.type === "SET_EFFECT_PROPERTY"
    && operation.effectId.startsWith(turbulentAugmentation.nodeId)
    && operation.propertyPath[0] === "ADBE Turbulent Displace-0003")?.value;
  const baselineTurbulentComplexity = compiled.operations.find((operation) =>
    operation.type === "SET_EFFECT_PROPERTY"
    && operation.effectId.startsWith(turbulentAugmentation.nodeId)
    && operation.propertyPath[0] === "ADBE Turbulent Displace-0005")?.value;
  const baselineTurbulentEvolution = compiled.operations.find((operation) =>
    operation.type === "SET_EFFECT_PROPERTY"
    && operation.effectId.startsWith(turbulentAugmentation.nodeId)
    && operation.propertyPath[0] === "ADBE Turbulent Displace-0006")?.value;
  const baselineMotionExpression = compiled.operations.find((operation) =>
    operation.type === "SET_EXPRESSION"
    && operation.expression.includes("var impulse=0;"))?.expression;
  assert.equal(typeof baselineTurbulentAmount, "number");
  assert.equal(typeof baselineTurbulentSize, "number");
  assert.equal(typeof baselineTurbulentComplexity, "number");
  assert.equal(typeof baselineTurbulentEvolution, "number");
  assert.equal(typeof baselineMotionExpression, "string");
  const actuatedCompound = applyConstructionActuationPlanV1(compound.graph, {
    schema: "editflow.construction-actuation-plan.v1",
    family: "UNKNOWN",
    comparisonKey: "compound-native-warp-actuation",
    instructions: [{
      instructionId: "actuate:unknown.distortion:distortion_strength",
      invariantId: "unknown.distortion",
      nodeId: turbulentAugmentation.nodeId,
      metric: "distortionPeak",
      deficitMetric: "distortionPeak",
      deficitReferenceValue: 0.42,
      deficitRenderValue: 0.21,
      control: "DISTORTION_STRENGTH",
      direction: "INCREASE",
      referenceValue: 0.42,
      renderValue: 0.21,
      multiplier: 1.5,
      normalizedError: 0.5,
      defining: true,
      rationale: "Proof that synthesized native distortion has a physical AE actuator.",
    }, {
      instructionId: "actuate:unknown.distortion:distortion_size",
      invariantId: "unknown.distortion",
      nodeId: turbulentAugmentation.nodeId,
      metric: "distortionPeak",
      deficitMetric: "distortionPeak",
      deficitReferenceValue: 0.42,
      deficitRenderValue: 0.21,
      control: "DISTORTION_SIZE",
      direction: "INCREASE",
      referenceValue: 0.42,
      renderValue: 0.21,
      multiplier: 1.25,
      normalizedError: 0.5,
      defining: true,
      rationale: "Proof that synthesized native distortion exposes an independent spatial-scale actuator.",
    }, {
      instructionId: "actuate:unknown.distortion:distortion_complexity",
      invariantId: "unknown.distortion",
      nodeId: turbulentAugmentation.nodeId,
      metric: "distortionPeak",
      deficitMetric: "distortionPeak",
      deficitReferenceValue: 0.42,
      deficitRenderValue: 0.21,
      control: "DISTORTION_COMPLEXITY",
      direction: "INCREASE",
      referenceValue: 0.42,
      renderValue: 0.21,
      multiplier: 1.25,
      normalizedError: 0.5,
      defining: true,
      rationale: "Proof that native distortion can vary spatial detail independently of amount and size.",
    }, {
      instructionId: "actuate:unknown.distortion:distortion_evolution",
      invariantId: "unknown.distortion",
      nodeId: turbulentAugmentation.nodeId,
      metric: "distortionPeak",
      deficitMetric: "distortionPeak",
      deficitReferenceValue: 0.42,
      deficitRenderValue: 0.21,
      control: "DISTORTION_EVOLUTION",
      direction: "INCREASE",
      referenceValue: 0.42,
      renderValue: 0.21,
      multiplier: 1.5,
      normalizedError: 0.5,
      defining: true,
      rationale: "Proof that native distortion can move through an independent turbulence pattern state without misusing Complexity as magnitude.",
    }, {
      instructionId: "actuate:unknown.acceleration:motion_impulse_sharpness",
      invariantId: "unknown.acceleration",
      nodeId: recoveryMotion.nodeId,
      metric: "accelerationPeak",
      deficitMetric: "accelerationPeak",
      deficitReferenceValue: 0.07,
      deficitRenderValue: 0.035,
      control: "MOTION_IMPULSE_SHARPNESS",
      direction: "INCREASE",
      referenceValue: 0.07,
      renderValue: 0.035,
      multiplier: 1.5,
      normalizedError: 0.5,
      defining: true,
      rationale: "Proof that acceleration can be actuated by compressing impulse duration independently of amplitude.",
    }, {
      instructionId: "actuate:unknown.acceleration:motion_impulse_phase",
      invariantId: "unknown.acceleration",
      nodeId: recoveryMotion.nodeId,
      metric: "accelerationPeak",
      deficitMetric: "accelerationPeak",
      deficitReferenceValue: 0.07,
      deficitRenderValue: 0.035,
      control: "MOTION_IMPULSE_PHASE",
      direction: "INCREASE",
      referenceValue: 0.07,
      renderValue: 0.035,
      multiplier: 1.25,
      normalizedError: 0.5,
      defining: true,
      rationale: "Proof that acceleration can move relative to sampled frame boundaries without changing amplitude.",
    }],
    unresolvedInvariantIds: [],
  });
  const actuatedTurbulent = actuatedCompound.graph.nodes.find((node) =>
    node.nodeId === turbulentAugmentation.nodeId);
  const actuatedRecovery = actuatedCompound.graph.nodes.find((node) =>
    node.nodeId === recoveryMotion.nodeId);
  assert.equal(actuatedTurbulent?.parameters.distortionStrengthScale, 1.5);
  assert.equal(actuatedTurbulent?.parameters.distortionSizeScale, 1.25);
  assert.equal(actuatedTurbulent?.parameters.distortionComplexityScale, 1.25);
  assert.equal(actuatedTurbulent?.parameters.distortionEvolutionScale, 1.5);
  assert.equal(actuatedRecovery?.parameters.motionImpulseSharpnessScale, 1.5);
  assert.equal(actuatedRecovery?.parameters.motionImpulsePhaseScale, 1.25);
  const actuatedCompilation = compileConstructionGraphV1(actuatedCompound.graph, capabilities);
  assert.notEqual(actuatedCompilation.recipe, null);
  const actuatedCompiled = compileEditingIrRecipeToVirtualAeV1(
    actuatedCompilation.recipe,
    project,
    compilerContext,
  );
  const actuatedTurbulentAmount = actuatedCompiled.operations.find((operation) =>
    operation.type === "SET_EFFECT_PROPERTY"
    && operation.effectId.startsWith(turbulentAugmentation.nodeId)
    && operation.propertyPath[0] === "ADBE Turbulent Displace-0002")?.value;
  const actuatedTurbulentSize = actuatedCompiled.operations.find((operation) =>
    operation.type === "SET_EFFECT_PROPERTY"
    && operation.effectId.startsWith(turbulentAugmentation.nodeId)
    && operation.propertyPath[0] === "ADBE Turbulent Displace-0003")?.value;
  const actuatedTurbulentComplexity = actuatedCompiled.operations.find((operation) =>
    operation.type === "SET_EFFECT_PROPERTY"
    && operation.effectId.startsWith(turbulentAugmentation.nodeId)
    && operation.propertyPath[0] === "ADBE Turbulent Displace-0005")?.value;
  const actuatedTurbulentEvolution = actuatedCompiled.operations.find((operation) =>
    operation.type === "SET_EFFECT_PROPERTY"
    && operation.effectId.startsWith(turbulentAugmentation.nodeId)
    && operation.propertyPath[0] === "ADBE Turbulent Displace-0006")?.value;
  assert.equal(typeof actuatedTurbulentAmount, "number");
  assert.equal(typeof actuatedTurbulentSize, "number");
  assert.equal(typeof actuatedTurbulentComplexity, "number");
  assert.equal(typeof actuatedTurbulentEvolution, "number");
  assert.ok(Math.abs(actuatedTurbulentAmount - baselineTurbulentAmount * 1.5) < 1e-9,
    "native Turbulent Displace Amount must move with DISTORTION_STRENGTH actuation");
  assert.ok(Math.abs(actuatedTurbulentSize - baselineTurbulentSize * 1.25) < 1e-9,
    "native Turbulent Displace Size must move independently with DISTORTION_SIZE actuation");
  assert.ok(Math.abs(actuatedTurbulentComplexity - baselineTurbulentComplexity * 1.25) < 1e-9,
    "native Turbulent Displace Complexity must move independently with DISTORTION_COMPLEXITY actuation");
  assert.ok(Math.abs(actuatedTurbulentEvolution - baselineTurbulentEvolution * 1.5) < 1e-9,
    "native Turbulent Displace Evolution must move independently with DISTORTION_EVOLUTION actuation");
  const actuatedMotionExpression = actuatedCompiled.operations.find((operation) =>
    operation.type === "SET_EXPRESSION"
    && operation.expression.includes("var impulse=0;"))?.expression;
  assert.equal(typeof actuatedMotionExpression, "string");
  const baselinePreFrames = Number(baselineMotionExpression.match(/var pre=([0-9.]+);/)?.[1]);
  const actuatedPreFrames = Number(actuatedMotionExpression.match(/var pre=([0-9.]+);/)?.[1]);
  assert.ok(Number.isFinite(baselinePreFrames) && Number.isFinite(actuatedPreFrames));
  assert.ok(actuatedPreFrames < baselinePreFrames,
    "MOTION_IMPULSE_SHARPNESS must compress the event-local impulse window instead of increasing displacement amplitude");
  const baselinePhaseShift = Number(baselineMotionExpression.match(/frameDuration\)\+(-?[0-9.]+);/)?.[1]);
  const actuatedPhaseShift = Number(actuatedMotionExpression.match(/frameDuration\)\+(-?[0-9.]+);/)?.[1]);
  assert.equal(baselinePhaseShift, 0);
  assert.equal(actuatedPhaseShift, 0.5);
  assert.ok(plan.operations.length <= 96);
});

test("M6.8 evolving compound warp adds event-local effect-property expressions without invalidating retained v2 proof", () => {
  const reference = evidence({
    temporalStateCountPeak: 5,
    temporalPersistence: 0.66,
    overlapDensityPeak: 0.9,
    scaleRange: 0.14,
    blurPeak: 0.9,
    distortionPeak: 0.42,
    accelerationPeak: 0.07,
    recoveryFrames: 4,
  });
  const capabilities = [
    ...ALL_CAPABILITIES,
    "ae.effect.echo",
    "ae.effect.turbulent-displace",
  ];
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: capabilities,
  });
  const retained = synthesis.candidates.find((candidate) =>
    candidate.strategy === "COMPOUND_NATIVE_HYBRID");
  const evolving = synthesis.candidates.find((candidate) =>
    candidate.strategy === "COMPOUND_EVOLVING_WARP_HYBRID");
  assert.ok(retained);
  assert.ok(evolving);
  assert.deepEqual(retained.capabilityGaps, []);
  assert.deepEqual(evolving.capabilityGaps, []);

  const retainedTurbulent = retained.graph.nodes.find((node) =>
    node.parameters.synthesisStrategy === "TURBULENT_DISPLACE_HYBRID");
  const dynamicTurbulent = evolving.graph.nodes.find((node) =>
    node.parameters.synthesisStrategy === "COMPOUND_EVOLVING_WARP_HYBRID");
  assert.equal(retainedTurbulent?.parameters.effectSchemaRef,
    "ae.effect-schema.m6.turbulent-displace.v2");
  assert.equal(dynamicTurbulent?.nodeId, retainedTurbulent?.nodeId,
    "evolving warp must upgrade the retained Turbulent Displace stage in place");
  assert.equal(dynamicTurbulent?.parameters.effectSchemaRef,
    "ae.effect-schema.m6.turbulent-displace.v3");
  assert.equal(dynamicTurbulent?.parameters.eventDynamicDistortion, true);
  assert.ok(dynamicTurbulent?.requiredInvariantIds.includes("unknown.distortion"));
  assert.ok(dynamicTurbulent?.requiredInvariantIds.includes("unknown.acceleration"));
  const evolvingRecovery = evolving.graph.nodes.find((node) =>
    node.kind === "RECOVERY"
    && node.requiredInvariantIds.includes("unknown.acceleration"));
  assert.ok(evolvingRecovery);
  assert.equal(
    evolving.graph.invariantCoverage["unknown.distortion"]?.[0],
    dynamicTurbulent?.nodeId,
    "dynamic Turbulent Displace must remain the primary distortion actuator",
  );
  assert.equal(
    evolving.graph.invariantCoverage["unknown.acceleration"]?.[0],
    evolvingRecovery?.nodeId,
    "evolving warp may contribute acceleration but must not displace the dedicated motion-shaping actuator",
  );

  const escalation = selectSynthesisEscalationCandidateV1({
    synthesis,
    currentStrategy: "COMPOUND_NATIVE_HYBRID",
    requiredInvariantIds: ["unknown.distortion", "unknown.acceleration"],
  });
  assert.equal(escalation?.strategy, "COMPOUND_EVOLVING_WARP_HYBRID");

  const compilation = compileConstructionGraphV1(evolving.graph, capabilities);
  assert.notEqual(compilation.recipe, null);
  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp",
      name: "Evolving warp proof",
      width: 640,
      height: 360,
      durationMs: 1000,
      frameRate: 30,
      layers: [{
        layerId: "hero",
        name: "Hero",
        kind: "PRECOMP",
        sourceRef: "source",
        inMs: 0,
        outMs: 1000,
        properties: [],
        effects: [],
        masks: [],
      }],
    }],
  };
  const compiled = compileEditingIrRecipeToVirtualAeV1(
    compilation.recipe,
    project,
    {
      compId: "comp",
      eventTimesMs: { transition: 500 },
      roleBindings: [{ role: "hero", layerIds: ["hero"] }],
      parameterValues: {},
      proofOnlyEffectSchemaRefs: [
        "ae.effect-schema.m6.echo.v1",
        "ae.effect-schema.m6.turbulent-displace.v2",
        "ae.effect-schema.m6.turbulent-displace.v3",
      ],
    },
  );
  const dynamicExpressions = compiled.operations.filter((operation) =>
    operation.type === "SET_EFFECT_EXPRESSION"
    && operation.effectId.startsWith(dynamicTurbulent.nodeId));
  assert.ok(dynamicExpressions.length >= 2);
  const amountExpression = dynamicExpressions.find((operation) =>
    operation.propertyPath[0] === "ADBE Turbulent Displace-0002");
  assert.ok(amountExpression);
  assert.match(amountExpression.expression, /Math\.sin\(Math\.PI\*u\)/);
  assert.match(amountExpression.expression, /base\*[0-9.]+\*envelope/);
  assert.doesNotMatch(amountExpression.expression, /1\+\(/,
    "dynamic v3 Amount must be zero outside its event instead of relying on a duplicate layer for localization");
  assert.equal(compiled.operations.some((operation) =>
    operation.type === "DUPLICATE_LAYER"
    && operation.layerId.startsWith(dynamicTurbulent.nodeId)), false,
    "dynamic v3 warp must actuate the retained layer directly and must not create a new visible temporal state");
  assert.ok(dynamicExpressions.some((operation) =>
    operation.propertyPath[0] === "ADBE Turbulent Displace-0006"
    && operation.expression.includes("var base=")
    && operation.expression.includes("base+(")));

  const plan = lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "m6-evolving-warp-proof-plan",
    observedState: {
      projectId: "m6-project",
      projectRevision: "ae-revision:evolving-warp",
      projectFingerprint: "project:sha256:evolving-warp",
      environmentFingerprint: "environment:sha256:ae-25.6.6",
    },
    creativeObjective: "Add event-local evolving deformation after static actuator search plateaus.",
  });
  assert.ok(plan.operations.length <= 96,
    "evolving warp escalation must stay within the bounded correction transaction ceiling");
  const effectExpressionOps = plan.operations.filter((operation) =>
    operation.input.command === "property.set_expression"
    && typeof operation.input.payload.effectBindingId === "string"
    && operation.input.payload.effectBindingId.startsWith(dynamicTurbulent.nodeId));
  assert.ok(effectExpressionOps.length >= 2);
  assert.ok(effectExpressionOps.every((operation) =>
    Array.isArray(operation.input.payload.propertyPath)
    && operation.input.payload.propertyPath.length === 1));
});

test("M6.8 compound temporal warp preserves evolving warp and adds new temporal-field machinery", () => {
  const reference = evidence({
    temporalStateCountPeak: 5,
    temporalPersistence: 0.66,
    overlapDensityPeak: 0.9,
    scaleRange: 0.14,
    blurPeak: 0.9,
    distortionPeak: 0.42,
    accelerationPeak: 0.07,
    recoveryFrames: 4,
  });
  const capabilities = [
    ...ALL_CAPABILITIES,
    "ae.effect.echo",
    "ae.effect.turbulent-displace",
  ];
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: capabilities,
  });
  const temporalWarp = synthesis.candidates.find((candidate) =>
    candidate.strategy === "COMPOUND_TEMPORAL_WARP_HYBRID");
  assert.ok(temporalWarp);
  assert.deepEqual(temporalWarp.capabilityGaps, []);

  const evolvingNode = temporalWarp.graph.nodes.find((node) =>
    node.parameters.synthesisStrategy === "COMPOUND_EVOLVING_WARP_HYBRID");
  const timeNode = temporalWarp.graph.nodes.find((node) =>
    node.parameters.synthesisStrategy === "TIME_DISPLACEMENT_HYBRID");
  assert.equal(evolvingNode?.parameters.effectSchemaRef,
    "ae.effect-schema.m6.turbulent-displace.v3");
  assert.equal(timeNode?.parameters.effectSchemaRef,
    "ae.effect-schema.m6.time-displacement.v1");
  assert.ok(timeNode?.requiredInvariantIds.includes("unknown.persistence"));
  const persistenceCoverage = temporalWarp.graph.invariantCoverage["unknown.persistence"] ?? [];
  assert.notEqual(
    persistenceCoverage[0],
    timeNode?.nodeId,
    "live-AE non-response evidence keeps layered persistence as the correction owner",
  );
  assert.ok(persistenceCoverage.includes(timeNode?.nodeId ?? "missing"),
    "Time Displacement remains retained as secondary construction/provenance coverage");

  const persistenceEscalation = selectSynthesisEscalationCandidateV1({
    synthesis,
    currentStrategy: "COMPOUND_EVOLVING_WARP_HYBRID",
    requiredInvariantIds: ["unknown.persistence", "unknown.distortion"],
  });
  assert.equal(persistenceEscalation?.strategy, "COMPOUND_TEMPORAL_WARP_HYBRID");
  const temporalBoundary = temporalWarp.graph.nodes.find((node) =>
    node.parameters.causalBoundary === "TEMPORAL_FIELD_COMPOSITE");
  const postCompositeScale = temporalWarp.graph.nodes.find((node) =>
    node.parameters.synthesisStrategy === "COMPOUND_TEMPORAL_WARP_HYBRID"
    && node.requiredInvariantIds.includes("unknown.scale"));
  assert.ok(temporalBoundary?.requiredInvariantIds.includes("unknown.blur"));
  assert.ok(postCompositeScale);
  const postCompositeEscalation = selectSynthesisEscalationCandidateV1({
    synthesis,
    currentStrategy: "COMPOUND_EVOLVING_WARP_HYBRID",
    requiredInvariantIds: ["unknown.scale", "unknown.blur"],
  });
  assert.equal(postCompositeEscalation?.strategy, "COMPOUND_TEMPORAL_WARP_HYBRID");

  const compilation = compileConstructionGraphV1(temporalWarp.graph, capabilities);
  assert.notEqual(compilation.recipe, null);
  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp", name: "Compound temporal warp proof", width: 640, height: 360,
      durationMs: 1000, frameRate: 30,
      layers: [{
        layerId: "hero", name: "Hero", kind: "PRECOMP", sourceRef: "source",
        inMs: 0, outMs: 1000, properties: [], effects: [], masks: [],
      }],
    }],
  };
  const compiled = compileEditingIrRecipeToVirtualAeV1(compilation.recipe, project, {
    compId: "comp",
    eventTimesMs: { transition: 500 },
    roleBindings: [{ role: "hero", layerIds: ["hero"] }],
    parameterValues: {},
    proofOnlyEffectSchemaRefs: [
      "ae.effect-schema.m6.echo.v1",
      "ae.effect-schema.m6.turbulent-displace.v2",
      "ae.effect-schema.m6.turbulent-displace.v3",
      "ae.effect-schema.m6.time-displacement.v1",
    ],
  });
  assert.ok(compiled.operations.some((operation) =>
    operation.type === "ADD_EFFECT" && operation.matchName === "ADBE Time Displacement"));
  const temporalFieldPrecomposes = compiled.operations
    .filter((operation) => operation.type === "PRECOMPOSE"
      && operation.newLayerId.includes("time-field-precompose"));
  assert.equal(temporalFieldPrecomposes.length, 1);
  assert.ok((temporalFieldPrecomposes[0]?.layerIds.length ?? 0) > 1,
    "the temporal-field boundary must group the realized temporal states within the bounded transaction budget");
  assert.ok(temporalFieldPrecomposes.every((operation) => !operation.layerIds.includes("hero")),
    "the temporal-field boundary must inherit temporal outputs instead of retargeting the original hero layer");
  const simulated = compileConstructionThroughVirtualAeV1(compilation, project, {
    compId: "comp",
    eventTimesMs: { transition: 500 },
    roleBindings: [{ role: "hero", layerIds: ["hero"] }],
    parameterValues: {},
    proofOnlyEffectSchemaRefs: [
      "ae.effect-schema.m6.echo.v1",
      "ae.effect-schema.m6.turbulent-displace.v2",
      "ae.effect-schema.m6.turbulent-displace.v3",
      "ae.effect-schema.m6.time-displacement.v1",
    ],
  });
  assert.equal(simulated.compiled, true, simulated.issues.join(", "));
  const plan = lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "m6-compound-temporal-warp-proof-plan",
    observedState: {
      projectId: "m6-project",
      projectRevision: "ae-revision:compound-temporal-warp",
      projectFingerprint: "project:sha256:compound-temporal-warp",
      environmentFingerprint: "environment:sha256:ae-25.6.6",
    },
    creativeObjective: "Preserve proven evolving deformation while adding a spatial temporal field.",
  });
  assert.ok(plan.operations.length <= 96,
    `compound temporal warp must remain within the bounded correction transaction ceiling (got ${plan.operations.length})`);
  const temporalFieldVirtualPrecompose = temporalFieldPrecomposes[0];
  const temporalFieldSourceIds = new Set(temporalFieldVirtualPrecompose.layerIds);
  const timeRemappedTemporalFieldSources = [...temporalFieldSourceIds].filter((layerId) =>
    compiled.operations.some((operation) =>
      operation.type === "SET_PROPERTY"
      && operation.layerId === layerId
      && operation.propertyPath === "TimeRemap.Enabled")
    && compiled.operations.some((operation) =>
      operation.type === "SET_EXPRESSION"
      && operation.layerId === layerId
      && operation.propertyPath === "TimeRemap.SourceTime"));
  assert.ok(timeRemappedTemporalFieldSources.length > 0,
    "temporal-field grouping must consume at least one explicitly time-remapped synthesized state");
  const nativeTemporalFieldPrecomposeIndex = plan.operations.findIndex((operation) =>
    operation.input.command === "layers.precompose"
    && operation.input.payload.replacementStableId === temporalFieldVirtualPrecompose.newLayerId);
  assert.ok(nativeTemporalFieldPrecomposeIndex >= 0);
  for (const layerId of timeRemappedTemporalFieldSources) {
    const enableIndex = plan.operations.findIndex((operation) =>
      operation.input.command === "layer.time_remap.enable"
      && operation.input.payload.layer?.stableId === layerId);
    const remapExpressionIndex = plan.operations.findIndex((operation) =>
      operation.input.command === "property.set_expression"
      && operation.input.payload.layer?.stableId === layerId
      && Array.isArray(operation.input.payload.propertyPath)
      && operation.input.payload.propertyPath.includes("ADBE Time Remapping"));
    assert.ok(enableIndex >= 0 && enableIndex < nativeTemporalFieldPrecomposeIndex,
      `Time Remap must be enabled on '${layerId}' before temporal-field precompose consumes it.`);
    assert.ok(remapExpressionIndex > enableIndex
      && remapExpressionIndex < nativeTemporalFieldPrecomposeIndex,
      `Time Remap expression must be installed on '${layerId}' before temporal-field precompose consumes it.`);
  }
});

test("M6.8 materialized Time Displacement is proof-gated and FPS-adaptive", () => {
  const time = synthesizeUnknownEffectV1({
    evidence: evidence({
      frameIntervalMs: 1000 / 60,
      temporalStateCountPeak: 3,
      temporalPersistence: 0.55,
    }),
    availableCapabilities: ALL_CAPABILITIES,
  });
  const timeCandidate = time.candidates.find((item) => item.strategy === "TIME_DISPLACEMENT_HYBRID");
  assert.ok(timeCandidate);
  assert.deepEqual(timeCandidate.capabilityGaps, []);
  const timeNode = timeCandidate.graph.nodes.find((node) =>
    node.parameters.synthesisStrategy === "TIME_DISPLACEMENT_HYBRID");
  assert.equal(timeNode?.parameters.effectSchemaRef, "ae.effect-schema.m6.time-displacement.v1");
  assert.equal(timeNode?.parameters.eventLocalEffect, false);
  assert.equal(timeNode?.parameters.eventDynamicTimeDisplacement, true);
  const maxDisplacementSeconds = Number(timeNode?.parameters.maxDisplacementSeconds);
  assert.ok(maxDisplacementSeconds > (1 / 60));
  assert.ok(maxDisplacementSeconds < (2 / 60),
    "auxiliary Time Displacement must stay inside the observed three-state cadence span rather than smearing the full analysis window");

  const timeCompilation = compileConstructionGraphV1(timeCandidate.graph, ALL_CAPABILITIES);
  assert.notEqual(timeCompilation.recipe, null);
  const timeNormalSupport = inspectRecipeCompilerSupportV1(timeCompilation.recipe);
  assert.ok(timeNormalSupport.nativeAeBlockedPrimitiveKinds.includes("EFFECT_STACK"));
  const timeProofSupport = inspectRecipeCompilerSupportV1(timeCompilation.recipe, {
    proofOnlyEffectSchemaRefs: ["ae.effect-schema.m6.time-displacement.v1"],
  });
  assert.ok(!timeProofSupport.nativeAeBlockedPrimitiveKinds.includes("EFFECT_STACK"));

  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp", name: "Time displacement proof", width: 640, height: 360,
      durationMs: 1000, frameRate: 30,
      layers: [{
        layerId: "hero", name: "Hero", kind: "PRECOMP", sourceRef: "source",
        inMs: 0, outMs: 1000, properties: [], effects: [], masks: [],
      }],
    }],
  };
  const compiled = compileEditingIrRecipeToVirtualAeV1(timeCompilation.recipe, project, {
    compId: "comp",
    eventTimesMs: { transition: 500 },
    roleBindings: [{ role: "hero", layerIds: ["hero"] }],
    parameterValues: {},
    proofOnlyEffectSchemaRefs: ["ae.effect-schema.m6.time-displacement.v1"],
  });
  const add = compiled.operations.find((operation) =>
    operation.type === "ADD_EFFECT" && operation.matchName === "ADBE Time Displacement");
  assert.ok(add);
  const properties = compiled.operations.filter((operation) =>
    operation.type === "SET_EFFECT_PROPERTY" && operation.effectId === add.effectId);
  const expressions = compiled.operations.filter((operation) =>
    operation.type === "SET_EFFECT_EXPRESSION" && operation.effectId === add.effectId);
  assert.ok(expressions.some((operation) =>
    operation.propertyPath[0] === "ADBE Time Displacement-0002"
    && operation.expression.includes("Math.sin(Math.PI*u)")));
  assert.ok(properties.some((operation) =>
    operation.propertyPath[0] === "ADBE Time Displacement-0003"
    && operation.value === 30),
    "Time Resolution must clamp to the target composition FPS rather than copying a literal 60fps reference value");
  assert.ok(!properties.some((operation) =>
    operation.propertyPath[0] === "ADBE Time Displacement-0001"),
    "Live AE proved the layer selector defaults to the affected layer; avoid brittle layer-index literals");

  const turbulent = synthesizeUnknownEffectV1({
    evidence: evidence({ distortionPeak: 0.4 }),
    availableCapabilities: ["ae.effect.turbulent-displace"],
  });
  assert.equal(turbulent.status, "READY_FOR_PROOF");
  assert.equal(turbulent.selected?.strategy, "TURBULENT_DISPLACE_HYBRID");
  const turbulentCandidate = turbulent.candidates.find((item) => item.strategy === "TURBULENT_DISPLACE_HYBRID");
  assert.deepEqual(turbulentCandidate?.capabilityGaps, []);
  const compilation = compileConstructionGraphV1(
    turbulent.selected.graph,
    ["ae.effect.turbulent-displace"],
  );
  assert.notEqual(compilation.recipe, null);
  const turbulentNode = compilation.recipe.nodes.find((node) =>
    node.parameters.some((parameter) =>
      parameter.name === "synthesisStrategy"
      && parameter.value === "TURBULENT_DISPLACE_HYBRID"));
  assert.equal(turbulentNode?.kind, "EFFECT_STACK");
  assert.equal(
    turbulentNode?.parameters.find((parameter) => parameter.name === "effectSchemaRef")?.value,
    "ae.effect-schema.m6.turbulent-displace.v2",
  );
  assert.equal(
    turbulentNode?.parameters.find((parameter) => parameter.name === "eventLocalEffect")?.value,
    true,
  );
  const normalSupport = inspectRecipeCompilerSupportV1(compilation.recipe);
  assert.ok(normalSupport.nativeAeBlockedPrimitiveKinds.includes("EFFECT_STACK"));
  const proofSupport = inspectRecipeCompilerSupportV1(compilation.recipe, {
    proofOnlyEffectSchemaRefs: ["ae.effect-schema.m6.turbulent-displace.v2"],
  });
  assert.ok(!proofSupport.nativeAeBlockedPrimitiveKinds.includes("EFFECT_STACK"));
});

test("M6.8 native Echo schema is live-AE proven, FPS-adaptive, and production-enabled", () => {
  const unknown = evidence({
    temporalStateCountPeak: 3,
    temporalPersistence: 0.55,
    overlapDensityPeak: 0.05,
    motionEnergyPeak: 0.08,
    accelerationPeak: 0.01,
    recoveryFrames: 4,
  });
  const result = synthesizeUnknownEffectV1({
    evidence: unknown,
    availableCapabilities: ["ae.effect.echo"],
  });
  assert.equal(result.selected?.strategy, "NATIVE_ECHO_HYBRID");

  const compilation = compileConstructionGraphV1(
    result.selected.graph,
    ["ae.effect.echo"],
  );
  assert.notEqual(compilation.recipe, null);
  const echoNode = compilation.recipe.nodes.find((node) =>
    node.parameters.some((parameter) =>
      parameter.name === "synthesisStrategy" && parameter.value === "NATIVE_ECHO_HYBRID"));
  assert.equal(echoNode?.kind, "EFFECT_STACK");
  assert.equal(
    echoNode?.parameters.find((parameter) => parameter.name === "effectSchemaRef")?.value,
    "ae.effect-schema.m6.echo.v1",
  );
  assert.equal(
    echoNode?.parameters.find((parameter) => parameter.name === "eventLocalEffect")?.value,
    true,
  );
  assert.equal(
    echoNode?.parameters.find((parameter) => parameter.name === "numberOfEchoes")?.value,
    2,
    "three observed temporal states require two AE echoes because the current frame is already included",
  );
  assert.ok(!compilation.recipe.nodes.some((node) =>
    node.kind === "TEMPORAL_DUPLICATION"
    && node.capabilityIds.includes("ae.effect.echo")));

  const normalSupport = inspectRecipeCompilerSupportV1(compilation.recipe);
  assert.ok(!normalSupport.nativeAeBlockedPrimitiveKinds.includes("EFFECT_STACK"));
  const proofSupport = inspectRecipeCompilerSupportV1(compilation.recipe, {
    proofOnlyEffectSchemaRefs: ["ae.effect-schema.m6.echo.v1"],
  });
  assert.ok(!proofSupport.nativeAeBlockedPrimitiveKinds.includes("EFFECT_STACK"));

  const projectForRate = (frameRate) => ({
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp",
      name: "M6 Echo proof fixture",
      width: 1080,
      height: 1080,
      durationMs: 3000,
      frameRate,
      layers: [{
        layerId: "hero",
        name: "Hero",
        kind: "FOOTAGE",
        inMs: 0,
        outMs: 3000,
        properties: [],
        effects: [],
        masks: [],
      }],
    }],
  });
  const baseContext = {
    compId: "comp",
    eventTimesMs: { transition: 1500 },
    roleBindings: [{ role: "hero", layerIds: ["hero"] }],
    parameterValues: {},
  };
  const production30 = compileEditingIrRecipeToVirtualAeV1(
    compilation.recipe,
    projectForRate(30),
    baseContext,
  );
  assert.ok(production30.operations.some((operation) =>
    operation.type === "SET_EFFECT_PROPERTY"
    && operation.propertyPath[0] === "ADBE Echo-0001"));

  const compileAt = (frameRate) => compileEditingIrRecipeToVirtualAeV1(
    compilation.recipe,
    projectForRate(frameRate),
    baseContext,
  );
  const at30 = compileAt(30);
  const at60 = compileAt(60);
  const echoTimeValue = (compiled) => compiled.operations.find((operation) =>
    operation.type === "SET_EFFECT_PROPERTY"
    && operation.propertyPath[0] === "ADBE Echo-0001")?.value;
  const echoOpacityExpression = (compiled) => compiled.operations.find((operation) =>
    operation.type === "SET_EXPRESSION"
    && operation.propertyPath === "Transform.Opacity"
    && operation.layerId.includes("effect-stack-accent"))?.expression ?? "";
  const echoWindowFrames = (compiled) => {
    const expression = echoOpacityExpression(compiled);
    const pre = Number(expression.match(/var pre=([0-9.]+);/)?.[1]);
    const post = Number(expression.match(/var post=([0-9.]+);/)?.[1]);
    return { expression, pre, post, total: pre + post };
  };
  const echoTime30 = echoTimeValue(at30);
  const echoTime60 = echoTimeValue(at60);
  const window30 = echoWindowFrames(at30);
  const window60 = echoWindowFrames(at60);
  assert.equal(typeof echoTime30, "number");
  assert.equal(typeof echoTime60, "number");
  assert.ok(echoTime30 < 0);
  assert.ok(Math.abs(echoTime60 - echoTime30 / 2) < 1e-12);
  assert.match(window30.expression, /var post=/);
  assert.ok(Number.isFinite(window30.pre) && Number.isFinite(window30.post));
  assert.ok(window30.post >= 1);
  assert.ok(window60.total > window30.total,
    "event-local Echo persistence must scale with the destination FPS/reference analysis duration");

  const plan = lowerCompiledRecipeToNativeAePlanV1(at30, {
    planId: "m6-native-echo-proof-plan",
    observedState: {
      projectId: "m6-project",
      projectRevision: "ae-revision:32326",
      projectFingerprint: "project:sha256:m6-native-echo-proof",
      environmentFingerprint: "environment:sha256:ae-25.6.6",
    },
    creativeObjective: "Materialize the live-AE-certified native Echo synthesis path.",
  });
  const commands = plan.operations.map((operation) => operation.input.command);
  assert.ok(commands.includes("effect.add"));
  assert.ok(commands.includes("effect.set_property"));
  assert.ok(commands.includes("layer.duplicate"),
    "event-local Echo must be materialized on a bounded accent layer");
  assert.ok(commands.includes("property.set_expression"),
    "event-local Echo accent must carry the bounded opacity expression");
  assert.equal(
    plan.operations.find((operation) => operation.input.command === "effect.add")
      ?.input.payload.matchName,
    "ADBE Echo",
  );
});

test("M6.8 native Echo preserves animate -> precompose -> Echo causal order for transform history", () => {
  const reference = shutterReference();
  const capabilities = [
    "ae.effect.echo",
    "ae.precompose.layers",
    "ae.keyframe.temporal_ease.set",
    "ae.layer.transform.set",
  ];
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: capabilities,
  });
  assert.equal(synthesis.selected?.strategy, "NATIVE_ECHO_HYBRID");

  const graph = synthesis.selected.graph;
  const recovery = graph.nodes.find((node) => node.kind === "RECOVERY" && !node.optional);
  const boundary = graph.nodes.find((node) => node.kind === "PRECOMPOSE_BOUNDARY");
  const echo = graph.nodes.find((node) =>
    node.parameters.synthesisStrategy === "NATIVE_ECHO_HYBRID");
  assert.ok(recovery);
  assert.ok(boundary);
  assert.ok(echo);
  assert.deepEqual(recovery.dependsOn, []);
  assert.equal(recovery.parameters.motionProfile, "SHUTTER_CONVERGENCE");
  assert.deepEqual(echo.dependsOn, [boundary.nodeId]);
  assert.ok(boundary.capabilityCandidates.includes("ae.precompose.layers"));

  const compilation = compileConstructionGraphV1(graph, capabilities);
  assert.notEqual(compilation.recipe, null);
  assert.ok(compilation.recipe.nodes.some((node) => node.kind === "PRECOMPOSE"));

  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp",
      name: "M6 Echo causal-order fixture",
      width: 1080,
      height: 1080,
      durationMs: 3000,
      frameRate: 30,
      layers: [{
        layerId: "hero",
        name: "Hero",
        kind: "PRECOMP",
        sourceRef: "source",
        inMs: 0,
        outMs: 3000,
        properties: [],
        effects: [],
        masks: [],
      }],
    }],
  };
  const compiled = compileEditingIrRecipeToVirtualAeV1(compilation.recipe, project, {
    compId: "comp",
    eventTimesMs: { transition: 1500 },
    roleBindings: [{ role: "hero", layerIds: ["hero"] }],
    parameterValues: {},
    proofOnlyEffectSchemaRefs: ["ae.effect-schema.m6.echo.v1"],
  });
  const expressionIndex = compiled.operations.findIndex((operation) =>
    operation.type === "SET_EXPRESSION"
    && operation.layerId === "hero"
    && operation.propertyPath === "Transform.Position");
  const precomposeIndex = compiled.operations.findIndex((operation) =>
    operation.type === "PRECOMPOSE" && operation.layerIds.includes("hero"));
  const echoIndex = compiled.operations.findIndex((operation) =>
    operation.type === "ADD_EFFECT" && operation.matchName === "ADBE Echo");
  assert.ok(expressionIndex >= 0 && expressionIndex < precomposeIndex);
  const motionExpression = compiled.operations[expressionIndex]?.expression ?? "";
  assert.match(motionExpression, /thisComp\.height\*0\.5/);
  assert.match(motionExpression, /amplitude,-amplitude/);
  assert.match(motionExpression, /var q=pre\/4/);
  assert.match(motionExpression, /\/thisComp\.frameDuration/);
  assert.doesNotMatch(motionExpression, /thisComp\.frameRate/);
  assert.ok(precomposeIndex < echoIndex);

  const plan = lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "m6-native-echo-causal-order",
    observedState: {
      projectId: "m6-project",
      projectRevision: "ae-revision:32326",
      projectFingerprint: "project:sha256:m6-native-echo-causal-order",
      environmentFingerprint: "environment:sha256:ae-25.6.6",
    },
    creativeObjective: "Bake event-local transform motion into a precomp before native Echo.",
  });
  const commands = plan.operations.map((operation) => operation.input.command);
  const nativeExpressionIndex = commands.indexOf("property.set_expression");
  const nativePrecomposeIndex = commands.indexOf("layers.precompose");
  const precomposeOperation = plan.operations[nativePrecomposeIndex];
  const replacementStableId = precomposeOperation?.input.payload.replacementStableId;
  const nativeEchoIndex = plan.operations.findIndex((operation) =>
    operation.input.command === "effect.add"
    && operation.input.payload.matchName === "ADBE Echo");
  const postPrecomposeDuplicateIndex = plan.operations.findIndex((operation) =>
    operation.input.command === "layer.duplicate"
    && operation.input.payload.layer?.stableId === replacementStableId);
  const nativeBlurIndex = plan.operations.findIndex((operation) =>
    operation.input.command === "effect.add"
    && operation.input.payload.matchName === "ADBE Motion Blur");
  assert.ok(nativeExpressionIndex >= 0 && nativeExpressionIndex < nativePrecomposeIndex);
  assert.ok(nativePrecomposeIndex < postPrecomposeDuplicateIndex,
    "event-local Echo must duplicate the baked precomp into a bounded accent layer");
  assert.ok(postPrecomposeDuplicateIndex < nativeEchoIndex,
    "native Echo must be added to the bounded accent rather than the base precomp");
  assert.ok(nativeEchoIndex < nativeBlurIndex);
  assert.ok(plan.requiredCapabilities.includes("ae.precompose.layers"));
});

test("M6.8 synthesized Echo uses strategy-specific comparator actuators", () => {
  const capabilities = [...ALL_CAPABILITIES, "ae.effect.echo", "ae.precompose.layers"];
  const synthesis = synthesizeUnknownEffectV1({
    evidence: shutterReference(),
    availableCapabilities: capabilities,
  });
  const echo = synthesis.candidates.find((candidate) => candidate.strategy === "NATIVE_ECHO_HYBRID");
  assert.notEqual(echo, undefined);
  const temporal = echo.graph.nodes.find((node) =>
    node.parameters.synthesisStrategy === "NATIVE_ECHO_HYBRID");
  assert.notEqual(temporal, undefined);

  const beforeSpacing = Number(temporal.parameters.echoSpacingFrames);
  const beforeDecay = Number(temporal.parameters.decay);
  const beforeIntensity = Number(temporal.parameters.startingIntensity);
  const instruction = (suffix, control, multiplier, direction) => ({
    instructionId: `actuate:echo:${suffix}`,
    invariantId: suffix === "persistence" ? "unknown.persistence" : "unknown.overlap",
    nodeId: temporal.nodeId,
    metric: suffix === "persistence" ? "temporalPersistence" : "overlapDensityPeak",
    deficitMetric: suffix === "persistence" ? "temporalPersistence" : "overlapDensityPeak",
    deficitReferenceValue: suffix === "persistence" ? 0.75 : 0.2,
    deficitRenderValue: suffix === "persistence" ? 0.05 : 0.6,
    control,
    direction,
    referenceValue: suffix === "persistence" ? 0.75 : 0.2,
    renderValue: suffix === "persistence" ? 0.05 : 0.6,
    multiplier,
    normalizedError: suffix === "persistence" ? 0.7 : 0.6,
    defining: true,
    rationale: "Strategy-specific Echo correction fixture.",
  });
  const plan = {
    schema: "editflow.construction-actuation-plan.v1",
    family: echo.graph.family,
    comparisonKey: "reference->echo-render",
    instructions: [
      instruction("persistence", "TEMPORAL_PERSISTENCE", 2, "INCREASE"),
      instruction("band-mix", "TEMPORAL_BAND_MIX", 0.5, "DECREASE"),
      instruction("visibility", "DUPLICATE_OPACITY", 0.75, "DECREASE"),
    ],
    unresolvedInvariantIds: [],
  };
  const application = applyConstructionActuationPlanV1(echo.graph, plan);
  const correctedTemporal = application.graph.nodes.find((node) => node.nodeId === temporal.nodeId);
  assert.equal(correctedTemporal.parameters.echoSpacingFrames, Math.min(8, beforeSpacing * 2));
  assert.equal(correctedTemporal.parameters.decay, Math.max(0.05, beforeDecay * 0.5));
  assert.equal(correctedTemporal.parameters.startingIntensity, Math.max(0.1, beforeIntensity * 0.75));
  assert.equal(correctedTemporal.parameters.temporalPersistenceScale, undefined);
  assert.deepEqual(application.unsupportedInstructionIds, []);
  assert.equal(application.appliedInstructionIds.length, 3);
});

test("M6.8 UNKNOWN construction graph lowers through Recipe Compiler to concrete native AE operations", () => {
  const reference = shutterReference();
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: ALL_CAPABILITIES,
  });
  assert.equal(synthesis.status, "READY_FOR_PROOF");
  assert.equal(synthesis.selected?.strategy, "LAYERED_PRIMITIVES");
  assert.equal(synthesis.selected?.graph.family, "UNKNOWN");
  const layeredRecovery = synthesis.selected.graph.nodes.find((node) =>
    node.kind === "RECOVERY" && !node.optional);
  assert.equal(layeredRecovery?.parameters.motionProfile, "SHUTTER_CONVERGENCE");
  const layeredBoundary = synthesis.selected.graph.nodes.find((node) =>
    node.kind === "PRECOMPOSE_BOUNDARY"
    && node.parameters.causalBoundary === "LAYERED_TRANSFORM_HISTORY");
  const layeredTemporalNode = synthesis.selected.graph.nodes.find((node) =>
    node.kind === "TEMPORAL_DUPLICATES" && node.dimension === "TEMPORAL");
  const layeredTransform = synthesis.selected.graph.nodes.find((node) =>
    node.kind === "TRANSFORM_MOTION" && !node.optional);
  assert.ok(layeredBoundary);
  assert.ok(layeredTemporalNode);
  if (layeredTransform !== undefined) {
    assert.deepEqual(layeredTransform.dependsOn, []);
    assert.deepEqual(layeredRecovery.dependsOn, [layeredTransform.nodeId]);
  } else {
    assert.deepEqual(layeredRecovery.dependsOn, []);
  }
  assert.deepEqual(layeredBoundary.dependsOn, [layeredRecovery.nodeId]);
  assert.deepEqual(layeredTemporalNode.dependsOn, [layeredBoundary.nodeId]);

  const compilation = compileConstructionGraphV1(synthesis.selected.graph, ALL_CAPABILITIES);
  assert.notEqual(compilation.recipe, null);
  assert.deepEqual(inspectRecipeCompilerSupportV1(compilation.recipe).nativeAeBlockedPrimitiveKinds, []);

  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp",
      name: "M6 UNKNOWN realizer fixture",
      width: 1080,
      height: 1080,
      durationMs: 9000,
      frameRate: 30,
      layers: [{
        layerId: "hero",
        name: "Hero",
        kind: "FOOTAGE",
        inMs: 0,
        outMs: 9000,
        properties: [],
        effects: [],
        masks: [],
      }],
    }],
  };
  const compiled = compileEditingIrRecipeToVirtualAeV1(compilation.recipe, project, {
    compId: "comp",
    eventTimesMs: { transition: 1500 },
    roleBindings: [{ role: "hero", layerIds: ["hero"] }],
    parameterValues: {},
  });

  const requestedStateCount = Math.max(
    2,
    Math.round(reference.summary.fragmentationTemporalStateCountPeak
      ?? reference.summary.temporalStateCountPeak),
  );
  const innerScaleIndex = compiled.operations.findIndex((operation) =>
    operation.type === "SET_EXPRESSION"
    && operation.layerId === "hero"
    && operation.propertyPath === "Transform.Scale");
  const innerMotionIndex = compiled.operations.findIndex((operation) =>
    operation.type === "SET_EXPRESSION"
    && operation.layerId === "hero"
    && operation.propertyPath === "Transform.Position");
  const layeredPrecomposeIndex = compiled.operations.findIndex((operation) =>
    operation.type === "PRECOMPOSE" && operation.layerIds.includes("hero"));
  const firstHistoryDuplicateIndex = compiled.operations.findIndex((operation) =>
    operation.type === "DUPLICATE_LAYER");
  const firstHistoryEnableIndex = compiled.operations.findIndex((operation) =>
    operation.type === "SET_PROPERTY"
    && operation.propertyPath === "TimeRemap.Enabled");
  const firstHistoryRemapIndex = compiled.operations.findIndex((operation) =>
    operation.type === "SET_EXPRESSION"
    && operation.propertyPath === "TimeRemap.SourceTime");
  if (innerScaleIndex >= 0) assert.ok(innerScaleIndex < layeredPrecomposeIndex);
  assert.ok(innerMotionIndex >= 0 && innerMotionIndex < layeredPrecomposeIndex);
  assert.ok(layeredPrecomposeIndex < firstHistoryDuplicateIndex);
  assert.ok(firstHistoryDuplicateIndex < firstHistoryEnableIndex);
  assert.ok(firstHistoryEnableIndex < firstHistoryRemapIndex);
  assert.equal(compiled.operations.filter((operation) =>
    operation.type === "DUPLICATE_LAYER").length, requestedStateCount - 1);
  const expressionPaths = compiled.operations
    .filter((operation) => operation.type === "SET_EXPRESSION")
    .map((operation) => operation.propertyPath);
  assert.ok(expressionPaths.includes("TimeRemap.SourceTime"));
  assert.ok(expressionPaths.includes("Transform.Opacity"));
  assert.ok(expressionPaths.includes("Transform.Position"));
  const opacityPeaks = compiled.operations
    .filter((operation) => operation.type === "SET_EXPRESSION"
      && operation.propertyPath === "Transform.Opacity")
    .map((operation) => Number(operation.expression.match(/var peak=([0-9.]+);/)?.[1]))
    .filter((value) => Number.isFinite(value));
  assert.ok(opacityPeaks.length >= requestedStateCount - 1);
  const layeredTemporal = synthesis.selected.graph.nodes.find((node) =>
    node.kind === "TEMPORAL_DUPLICATES");
  const overlapTarget = Number(layeredTemporal?.parameters.fragmentationOverlapDensityPeak
    ?? layeredTemporal?.parameters.overlapDensityPeak);
  assert.ok(Number.isFinite(overlapTarget));
  const boundedOverlap = Math.max(0, Math.min(1, overlapTarget));
  const expectedFirstOpacity = Math.max(42, Math.min(100,
    58 + boundedOverlap * 40));
  assert.ok(opacityPeaks.some((value) => Math.abs(value - expectedFirstOpacity) < 1e-9));
  const positionExpressions = compiled.operations.filter((operation) =>
    operation.type === "SET_EXPRESSION" && operation.propertyPath === "Transform.Position");
  assert.ok(positionExpressions.some((operation) =>
    operation.expression.includes("amplitude,-amplitude")
    && operation.expression.includes("thisComp.frameDuration")));
  const eventAnchoredExpressions = compiled.operations.filter((operation) =>
    operation.type === "SET_EXPRESSION"
    && ["Transform.Opacity", "Transform.Position", "Transform.Scale"].includes(operation.propertyPath));
  assert.ok(eventAnchoredExpressions.length >= 2);
  assert.ok(eventAnchoredExpressions.every((operation) =>
    operation.expression.includes("var event=1.5;")
    && !operation.expression.includes("inPoint+(outPoint-inPoint)")));
  assert.ok(!compiled.operations.some((operation) =>
    operation.type === "SET_PROPERTY"
    && operation.propertyPath === "M6.TEMPORAL_DUPLICATION"));
  assert.throws(() => compileEditingIrRecipeToVirtualAeV1(compilation.recipe, project, {
    compId: "comp",
    eventTimesMs: { beat: 1200, cut: 1500 },
    roleBindings: [{ role: "hero", layerIds: ["hero"] }],
    parameterValues: {},
  }), /M6_EVENT_REF_AMBIGUOUS/);

  const plan = lowerCompiledRecipeToNativeAePlanV1(compiled, {
    planId: "m6-unknown-realizer-plan",
    observedState: {
      projectId: "m6-project",
      projectRevision: "ae-revision:32326",
      projectFingerprint: "project:sha256:m6-unknown-realizer",
      environmentFingerprint: "environment:sha256:ae-25.6.6",
    },
    creativeObjective: "Materialize an UNKNOWN effect graph using retained native AE primitives.",
  });
  const commands = plan.operations.map((operation) => operation.input.command);
  assert.equal(
    commands.filter((command) => command === "layer.duplicate").length,
    requestedStateCount - 1,
  );
  assert.ok(commands.includes("layer.time_remap.enable"));
  assert.ok(commands.filter((command) => command === "property.set_expression").length >= 3);
  const nativeLayeredPrecomposeIndex = commands.indexOf("layers.precompose");
  const nativeFirstHistoryDuplicateIndex = commands.indexOf("layer.duplicate");
  const nativeFirstHistoryEnableIndex = commands.indexOf("layer.time_remap.enable");
  const nativeFirstHistoryRemapIndex = plan.operations.findIndex((operation, index) =>
    index > nativeFirstHistoryEnableIndex
    && operation.input.command === "property.set_expression"
    && Array.isArray(operation.input.payload.propertyPath)
    && operation.input.payload.propertyPath.includes("ADBE Time Remapping"));
  assert.ok(nativeLayeredPrecomposeIndex >= 0);
  assert.ok(nativeLayeredPrecomposeIndex < nativeFirstHistoryDuplicateIndex);
  assert.ok(nativeFirstHistoryDuplicateIndex < nativeFirstHistoryEnableIndex);
  assert.ok(nativeFirstHistoryEnableIndex < nativeFirstHistoryRemapIndex);
  assert.ok(plan.requiredCapabilities.includes("ae.precompose.layers"));
  assert.ok(plan.requiredCapabilities.includes("ae.layer.duplicate"));
  assert.ok(plan.requiredCapabilities.includes("ae.layer.time_remap.enable"));
  assert.ok(plan.requiredCapabilities.includes("ae.expression.set"));
});

test("M6.5 semantic recovery compares duration rather than literal frame count across FPS", () => {
  const base = shutterReference().summary;
  const reference = evidence({ ...base, frameIntervalMs: 1000 / 60, recoveryFrames: 6 });
  const render = evidence({ ...base, frameIntervalMs: 1000 / 30, recoveryFrames: 3 });
  const comparison = compareSemanticVisualFidelityV1({
    reference,
    render,
    dna: canonicalTransitionDnaV1("SHUTTER_FRAGMENTATION"),
  });
  const recovery = comparison.metrics.find((item) => item.metric === "recoveryFrames");
  assert.equal(recovery?.passed, true);
  assert.ok(Math.abs(Number(recovery?.renderValue) - 6) < 1e-9);
});

test("M6.8 generic temporal realization preserves reference cadence and recovery duration across destination FPS", () => {
  const base = shutterReference().summary;
  const reference = evidence({ ...base, frameIntervalMs: 1000 / 60, recoveryFrames: 6 });
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: ALL_CAPABILITIES,
  });
  assert.equal(synthesis.selected?.strategy, "LAYERED_PRIMITIVES");
  const temporal = synthesis.selected.graph.nodes.find((node) => node.kind === "TEMPORAL_DUPLICATES");
  const recovery = synthesis.selected.graph.nodes.find((node) => node.kind === "RECOVERY" && !node.optional);
  assert.ok(Math.abs(Number(temporal?.parameters.referenceFrameIntervalMs) - (1000 / 60)) < 1e-9);
  assert.ok(Math.abs(Number(recovery?.parameters.effectRecoveryDurationMs) - 100) < 1e-9);

  const compilation = compileConstructionGraphV1(synthesis.selected.graph, ALL_CAPABILITIES);
  assert.notEqual(compilation.recipe, null);
  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp",
      name: "M6 FPS transfer fixture",
      width: 1080,
      height: 1080,
      durationMs: 3000,
      frameRate: 30,
      layers: [{
        layerId: "hero",
        name: "Hero",
        kind: "FOOTAGE",
        inMs: 0,
        outMs: 3000,
        properties: [],
        effects: [],
        masks: [],
      }],
    }],
  };
  const compiled = compileEditingIrRecipeToVirtualAeV1(compilation.recipe, project, {
    compId: "comp",
    eventTimesMs: { transition: 1500 },
    roleBindings: [{ role: "hero", layerIds: ["hero"] }],
    parameterValues: {},
  });
  const timeRemapExpressions = compiled.operations
    .filter((operation) => operation.type === "SET_EXPRESSION"
      && operation.propertyPath === "TimeRemap.SourceTime")
    .map((operation) => operation.expression);
  const temporalOffsetsSeconds = timeRemapExpressions
    .map((expression) => Number(expression.match(/value-([0-9.eE+-]+)/)?.[1]))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const expectedTemporalOffsetsSeconds = Array.from(
    { length: temporalOffsetsSeconds.length },
    (_, index) => (index + 1) / 60,
  );
  assert.deepEqual(
    temporalOffsetsSeconds.map((value) => Number(value.toFixed(9))),
    expectedTemporalOffsetsSeconds.map((value) => Number(value.toFixed(9))),
  );
  const opacityExpressions = compiled.operations
    .filter((operation) => operation.type === "SET_EXPRESSION"
      && operation.propertyPath === "Transform.Opacity")
    .map((operation) => operation.expression);
  assert.ok(opacityExpressions.some((expression) => expression.includes("var pre=3;")));
  const motionExpressions = compiled.operations
    .filter((operation) => operation.type === "SET_EXPRESSION"
      && operation.propertyPath === "Transform.Position")
    .map((operation) => operation.expression);
  assert.ok(motionExpressions.some((expression) =>
    expression.includes("var pre=3;") && expression.includes("var q=pre/4;")));
});

test("M6.7 temporal persistence scales from reference analysis duration instead of a fixed frame cap", () => {
  const base = shutterReference().summary;
  const reference = evidence({
    ...base,
    frameCount: 49,
    frameIntervalMs: 1000 / 60,
    temporalPersistence: 0.75,
    recoveryFrames: 1,
  });
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: ALL_CAPABILITIES,
  });
  assert.equal(synthesis.selected?.strategy, "LAYERED_PRIMITIVES");
  const temporal = synthesis.selected.graph.nodes.find((node) => node.kind === "TEMPORAL_DUPLICATES");
  assert.ok(Math.abs(Number(temporal?.parameters.effectAnalysisDurationMs) - 800) < 1e-9);

  const project = {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: "comp",
    compositions: [{
      compId: "comp",
      name: "M6 persistence duration fixture",
      width: 1080,
      height: 1080,
      durationMs: 3000,
      frameRate: 30,
      layers: [{
        layerId: "hero",
        name: "Hero",
        kind: "FOOTAGE",
        inMs: 0,
        outMs: 3000,
        properties: [],
        effects: [],
        masks: [],
      }],
    }],
  };
  const compileOpacity = (scale) => {
    const graph = {
      ...synthesis.selected.graph,
      nodes: synthesis.selected.graph.nodes.map((node) => node.kind === "TEMPORAL_DUPLICATES"
        ? { ...node, parameters: { ...node.parameters, temporalPersistenceScale: scale } }
        : node),
    };
    const compilation = compileConstructionGraphV1(graph, ALL_CAPABILITIES);
    assert.notEqual(compilation.recipe, null);
    const compiled = compileEditingIrRecipeToVirtualAeV1(compilation.recipe, project, {
      compId: "comp",
      eventTimesMs: { transition: 1500 },
      roleBindings: [{ role: "hero", layerIds: ["hero"] }],
      parameterValues: {},
    });
    return compiled.operations.find((operation) =>
      operation.type === "SET_EXPRESSION" && operation.propertyPath === "Transform.Opacity")?.expression ?? "";
  };

  const baseline = compileOpacity(1);
  const boosted = compileOpacity(2);
  assert.match(baseline, /var pre=8;/);
  assert.match(baseline, /var post=10;/);
  assert.match(boosted, /var pre=10;/);
  assert.match(boosted, /var post=14;/);
  assert.notEqual(boosted, baseline);
});

test("M6.7 blur attack deficits use a dedicated optical-duration actuator", () => {
  const referenceBase = evidence({
    frameCount: 12,
    frameIntervalMs: 20,
    blurPeak: 0.5,
    blurPeakPhase: 8 / 11,
    opticalPeakPhase: 8 / 11,
  });
  const referenceBlur = [0.02, 0.05, 0.28, 0.3, 0.32, 0.34, 0.37, 0.42, 0.5, 0.25, 0.1, 0.03];
  const reference = {
    ...referenceBase,
    frames: referenceBase.frames.map((frame, index) => ({
      ...frame,
      blurStrength: referenceBlur[index] ?? 0,
    })),
  };
  const anatomy = decomposeUnknownEffectV1(reference);
  const graph = buildConstructionGraphV1(anatomy);
  const degradedBase = evidence({
    frameCount: 12,
    frameIntervalMs: 20,
    blurPeak: 0.5,
    blurPeakPhase: 8 / 11,
    opticalPeakPhase: 8 / 11,
  });
  const render = {
    ...degradedBase,
    analyzerFingerprint: reference.analyzerFingerprint,
    frames: degradedBase.frames.map((frame, index) => ({
      ...frame,
      blurStrength: index === 7 ? 0.3 : index === 8 ? 0.5 : index > 8 ? 0.1 : 0.03,
    })),
  };
  const comparison = compareSemanticVisualFidelityV1({
    reference,
    render,
    dna: anatomy.dna,
  });
  const plan = deriveConstructionActuationPlanV1({ graph, comparison });
  const attack = plan.instructions.find((item) =>
    item.metric === "blurHalfPeakAttackMs");
  assert.equal(attack?.control, "BLUR_ATTACK_DURATION");
  assert.equal(attack?.direction, "INCREASE");
  const applied = applyConstructionActuationPlanV1(graph, plan);
  const optical = applied.graph.nodes.find((node) => node.nodeId === attack?.nodeId);
  assert.ok(Number(optical?.parameters.blurAttackDurationScale ?? 1) > 1);
});

test("M6.7 blur-duration actuation drives native Directional Blur Length over the event envelope", () => {
  const referenceBase = evidence({
    frameCount: 12,
    frameIntervalMs: 20,
    blurPeak: 0.5,
    blurPeakPhase: 8 / 11,
    opticalPeakPhase: 8 / 11,
  });
  const referenceBlur = [0.02, 0.05, 0.28, 0.3, 0.32, 0.34, 0.37, 0.42, 0.5, 0.25, 0.1, 0.03];
  const reference = {
    ...referenceBase,
    frames: referenceBase.frames.map((frame, index) => ({
      ...frame,
      blurStrength: referenceBlur[index] ?? 0,
    })),
  };
  const anatomy = decomposeUnknownEffectV1(reference);
  const graph = buildConstructionGraphV1(anatomy);
  const blurNode = graph.nodes.find((node) => node.kind === "OPTICAL_TREATMENT");
  assert.ok(blurNode);
  const tunedGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => node.nodeId === blurNode.nodeId
      ? {
          ...node,
          parameters: {
            ...node.parameters,
            // Simulate a compound reference whose main semantic event is one
            // analysis-frame later than its optical peak, so lowering must
            // preserve the measured pre-event blur lead.
            effectEventPhase: 9 / 11,
            eventDynamicDirectionalBlurProfile: true,
            blurAttackDurationScale: 1.25,
            blurRecoveryDurationScale: 0.75,
          },
        }
      : node),
  };
  const compilation = compileConstructionGraphV1(tunedGraph, ALL_CAPABILITIES);
  const result = compileConstructionThroughNativeAeV1(
    compilation,
    {
      schema: "editflow.virtual-ae.project.v1",
      activeCompId: "comp",
      compositions: [{
        compId: "comp",
        name: "M6 dynamic blur fixture",
        width: 640,
        height: 360,
        durationMs: 1000,
        frameRate: 30,
        layers: [{
          layerId: "hero",
          name: "Hero",
          kind: "FOOTAGE",
          inMs: 0,
          outMs: 1000,
          properties: [],
          effects: [],
          masks: [],
        }],
      }],
    },
    {
      compId: "comp",
      eventTimesMs: { transition: 500 },
      roleBindings: [{ role: "hero", layerIds: ["hero"] }],
      parameterValues: {},
    },
    {
      planId: "m6-dynamic-blur-native-plan",
      observedState: {
        projectId: "project",
        projectRevision: "1",
        projectFingerprint: "project-fingerprint",
        environmentFingerprint: "environment-fingerprint",
      },
      creativeObjective: "Drive measured blur attack and recovery on the native Blur Length property.",
    },
  );
  assert.equal(result.compiled, true, result.issues.join(", "));
  assert.ok(result.plan);
  const blurLengthExpression = result.plan.operations.find((operation) =>
    operation.input.command === "property.set_expression"
    && operation.input.payload.propertyPath?.includes("ADBE Motion Blur-0002"));
  assert.ok(blurLengthExpression,
    "duration correction must actuate native Blur Length, not only layer opacity");
  assert.match(blurLengthExpression.input.payload.expression, /var pre=/);
  assert.match(blurLengthExpression.input.payload.expression, /var post=/);
  assert.match(blurLengthExpression.input.payload.expression, /linear\(f,-pre,0,0,peak\)/);
  const blurEventMatch = blurLengthExpression.input.payload.expression.match(/var event=([0-9.]+);/);
  assert.ok(blurEventMatch);
  const tunedBlurNode = tunedGraph.nodes.find((node) => node.nodeId === blurNode.nodeId);
  assert.ok(tunedBlurNode);
  const expectedBlurEventSeconds = 0.5 + (
    Number(tunedBlurNode.parameters.blurPeakPhase ?? tunedBlurNode.parameters.effectEventPhase ?? 0)
    - Number(tunedBlurNode.parameters.effectEventPhase ?? 0)
  ) * (Number(tunedBlurNode.parameters.effectAnalysisDurationMs ?? 0) / 1000);
  assert.ok(Math.abs(Number(blurEventMatch[1]) - expectedBlurEventSeconds) < 1e-9,
    "blur timing must preserve the measured peak phase relative to the main semantic event");
  assert.equal(result.plan.operations.some((operation) =>
    operation.input.command === "effect.set_property"
    && operation.input.payload.propertyPath?.includes("ADBE Motion Blur-0002")), false,
    "the dynamic profile replaces the static Blur Length write for corrected optical timing");
  const blurAdd = result.plan.operations.find((operation) =>
    operation.input.command === "effect.add"
    && operation.input.payload.matchName === "ADBE Motion Blur");
  const blurLayerId = blurAdd?.input.payload.layer?.stableId;
  assert.equal(blurLayerId, "hero",
    "dynamic blur should animate the retained construction instead of creating a visible accent duplicate");
  assert.equal(result.plan.operations.some((operation) =>
    operation.input.command === "layer.duplicate"
    && String(operation.input.payload.stableId ?? "").endsWith("effect-stack-accent")), false,
    "optical timing correction must not alter temporal overlap by manufacturing another image state");
  assert.equal(result.plan.operations.some((operation) =>
    operation.input.command === "property.set_expression"
    && operation.input.payload.effectBindingId === undefined
    && operation.input.payload.layer?.stableId === blurLayerId
    && operation.input.payload.propertyPath?.includes("ADBE Opacity")), false,
    "native Blur Length already provides the bounded event envelope; no opacity support layer is required");
});

test("M6.7 blur-duration scalars cannot silently switch optical construction topology", () => {
  const reference = evidence({
    frameCount: 12,
    frameIntervalMs: 20,
    blurPeak: 0.5,
    blurPeakPhase: 8 / 11,
    opticalPeakPhase: 8 / 11,
  });
  const anatomy = decomposeUnknownEffectV1(reference);
  const graph = buildConstructionGraphV1(anatomy);
  const blurNode = graph.nodes.find((node) => node.kind === "OPTICAL_TREATMENT");
  assert.ok(blurNode);
  const scalarOnlyGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => node.nodeId === blurNode.nodeId
      ? {
          ...node,
          parameters: {
            ...node.parameters,
            blurAttackDurationScale: 1.25,
          },
        }
      : node),
  };
  const compilation = compileConstructionGraphV1(scalarOnlyGraph, ALL_CAPABILITIES);
  const result = compileConstructionThroughNativeAeV1(
    compilation,
    {
      schema: "editflow.virtual-ae.project.v1",
      activeCompId: "comp",
      compositions: [{
        compId: "comp",
        name: "M6 scalar blur topology guard",
        width: 640,
        height: 360,
        durationMs: 1000,
        frameRate: 30,
        layers: [{
          layerId: "hero",
          name: "Hero",
          kind: "FOOTAGE",
          inMs: 0,
          outMs: 1000,
          properties: [],
          effects: [],
          masks: [],
        }],
      }],
    },
    {
      compId: "comp",
      eventTimesMs: { transition: 500 },
      roleBindings: [{ role: "hero", layerIds: ["hero"] }],
      parameterValues: {},
    },
    {
      planId: "m6-scalar-blur-topology-guard",
      observedState: {
        projectId: "project",
        projectRevision: "1",
        projectFingerprint: "project-fingerprint",
        environmentFingerprint: "environment-fingerprint",
      },
      creativeObjective: "Keep scalar blur timing search inside the retained construction topology.",
    },
  );
  assert.equal(result.compiled, true, result.issues.join(", "));
  assert.ok(result.plan);
  assert.equal(result.plan.operations.some((operation) =>
    operation.input.command === "property.set_expression"
    && operation.input.payload.propertyPath?.includes("ADBE Motion Blur-0002")), false,
    "a scalar duration multiplier alone must not opt into direct dynamic Blur Length");
  assert.ok(result.plan.operations.some((operation) =>
    operation.input.command === "layer.duplicate"
    && String(operation.input.payload.stableId ?? "").endsWith("effect-stack-accent")),
    "without explicit structural synthesis the retained event-local effect topology must remain intact");
});

test("M6.8 optical-profile synthesis targets stalled blur timing while preserving compound warp", () => {
  const referenceBase = evidence({
    frameCount: 12,
    frameIntervalMs: 20,
    blurPeak: 0.5,
    blurPeakPhase: 8 / 11,
    opticalPeakPhase: 8 / 11,
    distortionPeak: 0.42,
    accelerationPeak: 0.08,
    recoveryFrames: 4,
  });
  const blurProfile = [0.02, 0.05, 0.28, 0.3, 0.32, 0.34, 0.37, 0.42, 0.5, 0.25, 0.1, 0.03];
  const reference = {
    ...referenceBase,
    frames: referenceBase.frames.map((frame, index) => ({
      ...frame,
      blurStrength: blurProfile[index] ?? 0,
      distortionStrength: index === 8 ? 0.42 : 0.04,
    })),
  };
  const capabilities = [
    ...ALL_CAPABILITIES,
    "ae.effect.echo",
    "ae.effect.turbulent-displace",
  ];
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: capabilities,
  });
  const evolving = synthesis.candidates.find((candidate) =>
    candidate.strategy === "COMPOUND_EVOLVING_WARP_HYBRID");
  const opticalProfile = synthesis.candidates.find((candidate) =>
    candidate.strategy === "OPTICAL_PROFILE_HYBRID");
  assert.ok(evolving, "fixture must expose the retained evolving-warp intervention");
  assert.ok(opticalProfile, "blur temporal anatomy must synthesize an optical-profile intervention");
  assert.deepEqual(opticalProfile.capabilityGaps, []);
  const profiledBlur = opticalProfile.graph.nodes.find((node) =>
    node.parameters.synthesisStrategy === "OPTICAL_PROFILE_HYBRID");
  const preservedWarp = opticalProfile.graph.nodes.find((node) =>
    node.parameters.synthesisStrategy === "COMPOUND_EVOLVING_WARP_HYBRID");
  assert.ok(profiledBlur?.requiredInvariantIds.includes("unknown.blur-attack"));
  assert.equal(profiledBlur?.parameters.eventDynamicDirectionalBlurProfile, true);
  assert.equal(profiledBlur?.parameters.blurAttackDurationScale, 1);
  assert.ok(preservedWarp,
    "optical escalation must layer on top of the retained evolving-warp construction");

  const escalation = selectSynthesisEscalationCandidateV1({
    synthesis,
    currentStrategy: "COMPOUND_EVOLVING_WARP_HYBRID",
    requiredInvariantIds: ["unknown.blur-attack"],
  });
  assert.equal(escalation?.strategy, "OPTICAL_PROFILE_HYBRID");
});

test("M6.7 zero blur strength remains a true identity calibration point", () => {
  const compiler = readFileSync(
    new URL("../packages/recipe-compiler/src/index.ts", import.meta.url),
    "utf8",
  );
  const schemas = readFileSync(
    new URL("../packages/recipe-compiler/src/effect-schemas.ts", import.meta.url),
    "utf8",
  );
  const controller = readFileSync(
    new URL("../scripts/proofs/m6-generic-native-auto-correction-proof.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    compiler,
    /const blurLength = Math\.max\(0, Math\.min\(160, blurRaw \* 80 \* blurStrengthScale\)\);/,
  );
  assert.doesNotMatch(
    compiler,
    /const blurLength = Math\.max\(0\.5,/,
    "a nonzero blur floor prevents rendered actuator bracketing for weak optical references",
  );
  assert.match(
    compiler,
    /Dynamic Directional Blur requires a non-negative adapted Blur Length/,
  );
  assert.match(
    schemas,
    /semanticParameter: "blurLengthPixels"[\s\S]{0,260}scaleRange: Object\.freeze\(\[0, 4\] as const\)/,
    "the certified Directional Blur schema must preserve zero instead of clamping it to 0.25",
  );
  assert.match(
    controller,
    /control: "BLUR_STRENGTH", minimum: 0, maximum: 4, minimumStep: 0\.03125/,
    "rendered blur search needs sub-quarter-scale resolution because small Blur Length changes are visually strong",
  );
});

test("M6.7 recovery deficits actuate construction duration without rewriting reference evidence", () => {
  const reference = shutterReference();
  const anatomy = deriveEffectAnatomyV1(reference);
  const graph = buildConstructionGraphV1(anatomy);
  const slowRender = evidence({ ...reference.summary, recoveryFrames: 12 });
  const comparison = compareSemanticVisualFidelityV1({
    reference,
    render: slowRender,
    dna: anatomy.dna,
  });
  const plan = deriveConstructionActuationPlanV1({ graph, comparison });
  const recoveryInstruction = plan.instructions.find((item) => item.control === "RECOVERY_DURATION");
  assert.equal(recoveryInstruction?.direction, "DECREASE");
  assert.ok((recoveryInstruction?.multiplier ?? 1) < 1);
  const applied = applyConstructionActuationPlanV1(graph, plan);
  const recoveryNode = applied.graph.nodes.find((node) => node.kind === "RECOVERY");
  assert.ok(Number(recoveryNode?.parameters.recoveryDurationScale ?? 1) < 1);
  assert.ok(applied.appliedInstructionIds.includes(recoveryInstruction?.instructionId ?? "missing"));
  assert.equal(recoveryNode?.parameters.recoveryFrames, graph.nodes.find((node) => node.kind === "RECOVERY")?.parameters.recoveryFrames);
});

test("M6.8 milestone gate requires three distinct behavior-first rendered UNKNOWN proofs", () => {
  const digest = (char) => char.repeat(64);
  const proofCase = (index) => ({
    caseId: `m6.8:case-${index}`,
    proofRef: `proofs/case-${index}.json`,
    proofSha256: digest(String(index)),
    referenceContentKey: digest(String(index + 3)),
    family: "UNKNOWN",
    provenance: index === 1 ? "LEARNED_SKILL_DISABLED" : "UNKNOWN_DECOMPOSITION_DIRECT",
    behaviorFirst: true,
    namedEffectFallbackUsed: false,
    finalCertified: true,
    finalDefiningCoverage: 1,
    finalWeightedFidelity: 0.96,
    degradedOrUnderDrivenRejected: true,
    renderedOutputVerified: true,
    realAeTransactionCommitted: index === 2,
    automaticCorrectionObserved: index === 3,
  });
  const passed = evaluateUnknownEffectSynthesisMilestoneV1([
    proofCase(1), proofCase(2), proofCase(3),
  ]);
  assert.equal(passed.passed, true, passed.failures.join(", "));
  assert.equal(passed.distinctReferenceCount, 3);
  assert.equal(passed.realAeCaseCount, 1);
  assert.equal(passed.automaticCorrectionCaseCount, 1);

  const duplicate = { ...proofCase(3), referenceContentKey: proofCase(2).referenceContentKey };
  const rejected = evaluateUnknownEffectSynthesisMilestoneV1([
    proofCase(1),
    { ...proofCase(2), namedEffectFallbackUsed: true },
    duplicate,
  ]);
  assert.equal(rejected.passed, false);
  assert.ok(rejected.failures.includes("m6.8:case-2:NAMED_EFFECT_FALLBACK_USED"));
  assert.ok(rejected.failures.includes("M6.8:REFERENCES_NOT_DISTINCT"));
});

test("M6.9 defines 24 canonical/held-out cases and requires transfer, degraded rejection, and A/B evidence", () => {
  const cases = createCanonicalProfessionalBenchmarkV1();
  assert.equal(cases.length, 24);
  assert.ok(new Set(cases.map((item) => item.family)).size >= 14);
  assert.ok(cases.some((item) => item.sourceKind === "HELD_OUT"));
  const completeEvidence = cases.map((item) => ({
    caseId: item.caseId,
    achievedLevel: "PROFESSIONAL_FIDELITY_VERIFIED",
    maturityProof: {
      functionallyPresent: true,
      structuralCoverageComplete: true,
      visuallyRecognizable: true,
      referenceFaithful: true,
      transferVariantCount: 1,
      professionalCasePassCount: 2,
      robustnessAxesPassed: [],
    },
    directAbReferenceRef: `proof:a-b:${item.caseId}`,
    comparisonEvidenceRef: `proof:comparison:${item.caseId}`,
    transferPassed: true,
    degradedCaseRejected: true,
  }));
  const passed = evaluateProfessionalBenchmarkV1(cases, completeEvidence);
  assert.equal(passed.passed, true, passed.failures.join(", "));
  const degraded = completeEvidence.map((item, index) => index === 0
    ? { ...item, degradedCaseRejected: false } : item);
  const failed = evaluateProfessionalBenchmarkV1(cases, degraded);
  assert.equal(failed.passed, false);
  assert.ok(failed.failures.some((item) => /DEGRADED_CASE_NOT_REJECTED/.test(item)));

  assert.equal(deriveProfessionalFidelityLevelV1({
    functionallyPresent: true,
    structuralCoverageComplete: true,
    visuallyRecognizable: true,
    referenceFaithful: true,
    transferVariantCount: 1,
    professionalCasePassCount: 1,
    robustnessAxesPassed: [],
  }), "TRANSFER_VERIFIED");
  assert.equal(deriveProfessionalFidelityLevelV1({
    functionallyPresent: true,
    structuralCoverageComplete: true,
    visuallyRecognizable: true,
    referenceFaithful: true,
    transferVariantCount: 3,
    professionalCasePassCount: 4,
    robustnessAxesPassed: ["subject", "aspect-ratio", "frame-rate", "motion-direction", "duration", "intensity"],
  }), "ROBUST");

  const selfAssertedWithoutProof = completeEvidence.map((item, index) => index === 0
    ? { ...item, maturityProof: { ...item.maturityProof, professionalCasePassCount: 1 } } : item);
  const maturityFailed = evaluateProfessionalBenchmarkV1(cases, selfAssertedWithoutProof);
  assert.equal(maturityFailed.passed, false);
  assert.ok(maturityFailed.failures.some((item) => /MATURITY_ASSERTION_MISMATCH/.test(item)));
  assert.ok(maturityFailed.failures.some((item) => /MATURITY_TRANSFER_VERIFIED/.test(item)));
});

test("M6.9 retained benchmark requires content-addressed case, transfer, A/B, and degraded-control bindings", () => {
  const cases = createCanonicalProfessionalBenchmarkV1();
  const hex = (seed) => seed.toString(16).padStart(64, "0");
  const retainedEvidence = cases.map((item) => ({
    caseId: item.caseId,
    achievedLevel: "PROFESSIONAL_FIDELITY_VERIFIED",
    maturityProof: {
      functionallyPresent: true,
      structuralCoverageComplete: true,
      visuallyRecognizable: true,
      referenceFaithful: true,
      transferVariantCount: 1,
      professionalCasePassCount: 2,
      robustnessAxesPassed: [],
    },
    directAbReferenceRef: `artifact:direct-ab:${item.caseId}`,
    comparisonEvidenceRef: `artifact:comparison:${item.caseId}`,
    renderEvidenceRef: `artifact:render:${item.caseId}`,
    transferEvidenceRefs: [`artifact:transfer:${item.caseId}`],
    professionalCaseEvidenceRefs: [`artifact:professional-case:${item.caseId}`],
    degradedControlEvidenceRef: `artifact:degraded:${item.caseId}`,
    transferPassed: true,
    degradedCaseRejected: true,
  }));
  const artifacts = cases.flatMap((item, index) => {
    const proof = retainedEvidence[index];
    const referenceKey = hex(100 + index);
    const renderKey = hex(200 + index);
    const degradedKey = hex(300 + index);
    return [
      {
        ref: item.referenceEvidenceRef,
        kind: "REFERENCE_DENSE_EVIDENCE",
        caseId: item.caseId,
        family: item.family,
        sha256: hex(1000 + index * 10),
        contentKey: referenceKey,
        baselineSourceContentKey: hex(500 + index),
      },
      {
        ref: proof.renderEvidenceRef,
        kind: "RENDER_DENSE_EVIDENCE",
        caseId: item.caseId,
        family: item.family,
        sha256: hex(1001 + index * 10),
        contentKey: renderKey,
      },
      {
        ref: proof.comparisonEvidenceRef,
        kind: "SEMANTIC_COMPARISON",
        caseId: item.caseId,
        family: item.family,
        sha256: hex(1002 + index * 10),
        referenceContentKey: referenceKey,
        renderContentKey: renderKey,
      },
      {
        ref: proof.directAbReferenceRef,
        kind: "DIRECT_AB",
        caseId: item.caseId,
        family: item.family,
        sha256: hex(1003 + index * 10),
        referenceContentKey: referenceKey,
        renderContentKey: renderKey,
      },
      {
        ref: proof.degradedControlEvidenceRef,
        kind: "DEGRADED_CONTROL",
        caseId: item.caseId,
        family: item.family,
        sha256: hex(1004 + index * 10),
        referenceContentKey: referenceKey,
        renderContentKey: degradedKey,
      },
      {
        ref: proof.professionalCaseEvidenceRefs[0],
        kind: "PROFESSIONAL_CASE_PROOF",
        caseId: item.caseId,
        family: item.family,
        sha256: hex(1006 + index * 10),
        referenceContentKey: hex(800 + index),
        renderContentKey: hex(900 + index),
        baselineSourceContentKey: hex(700 + index),
        certified: true,
        renderedOutputVerified: true,
        degradedControlRejected: true,
        definingCoverage: 1,
        weightedFidelity: 0.95,
      },
      {
        ref: proof.transferEvidenceRefs[0],
        kind: "TRANSFER_PROOF",
        caseId: item.caseId,
        family: item.family,
        sha256: hex(1005 + index * 10),
        referenceContentKey: referenceKey,
        renderContentKey: hex(400 + index),
        baselineSourceContentKey: hex(500 + index),
        transferSourceContentKey: hex(600 + index),
        transferAxes: item.transferAxes,
      },
    ];
  });

  const passed = evaluateRetainedProfessionalBenchmarkV1(cases, retainedEvidence, artifacts);
  assert.equal(passed.passed, true, passed.failures.join(", "));

  const placeholdersOnly = evaluateRetainedProfessionalBenchmarkV1(cases, retainedEvidence, []);
  assert.equal(placeholdersOnly.passed, false);
  assert.ok(placeholdersOnly.failures.some((item) => /MISSING_REFERENCE_ARTIFACT/.test(item)));
  assert.ok(placeholdersOnly.failures.some((item) => /MISSING_TRANSFER_ARTIFACT/.test(item)));

  const missingProfessionalCase = retainedEvidence.map((proof, index) => index === 0
    ? { ...proof, professionalCaseEvidenceRefs: [] } : proof);
  const missingProfessionalCaseResult = evaluateRetainedProfessionalBenchmarkV1(
    cases, missingProfessionalCase, artifacts,
  );
  assert.equal(missingProfessionalCaseResult.passed, false);
  assert.ok(missingProfessionalCaseResult.failures.some(
    (item) => /INSUFFICIENT_PROFESSIONAL_CASE_ARTIFACTS/.test(item),
  ));

  const reusedProfessionalSource = artifacts.map((artifact) =>
    artifact.kind === "PROFESSIONAL_CASE_PROOF" && artifact.caseId === cases[0].caseId
      ? { ...artifact, baselineSourceContentKey: hex(500) }
      : artifact);
  const reusedProfessionalSourceResult = evaluateRetainedProfessionalBenchmarkV1(
    cases, retainedEvidence, reusedProfessionalSource,
  );
  assert.equal(reusedProfessionalSourceResult.passed, false);
  assert.ok(reusedProfessionalSourceResult.failures.some(
    (item) => /PROFESSIONAL_CASE_SOURCE_NOT_INDEPENDENT/.test(item),
  ));

  const uncertifiedProfessionalCase = artifacts.map((artifact) =>
    artifact.kind === "PROFESSIONAL_CASE_PROOF" && artifact.caseId === cases[0].caseId
      ? { ...artifact, certified: false }
      : artifact);
  const uncertifiedProfessionalCaseResult = evaluateRetainedProfessionalBenchmarkV1(
    cases, retainedEvidence, uncertifiedProfessionalCase,
  );
  assert.equal(uncertifiedProfessionalCaseResult.passed, false);
  assert.ok(uncertifiedProfessionalCaseResult.failures.some(
    (item) => /PROFESSIONAL_CASE_NOT_CERTIFIED/.test(item),
  ));

  const heldOutShutterCase = cases.find(
    (item) => item.sourceKind === "HELD_OUT" && item.family === "SHUTTER_FRAGMENTATION",
  );
  assert.ok(heldOutShutterCase);
  const canonicalShutterSource = artifacts.find(
    (artifact) => artifact.kind === "REFERENCE_DENSE_EVIDENCE"
      && artifact.caseId === "m6:shutter_fragmentation:canonical",
  )?.baselineSourceContentKey;
  assert.ok(canonicalShutterSource);
  const heldOutReusesCanonical = artifacts.map((artifact) =>
    artifact.kind === "REFERENCE_DENSE_EVIDENCE" && artifact.caseId === heldOutShutterCase.caseId
      ? { ...artifact, baselineSourceContentKey: canonicalShutterSource }
      : artifact);
  const heldOutReuseResult = evaluateRetainedProfessionalBenchmarkV1(
    cases, retainedEvidence, heldOutReusesCanonical,
  );
  assert.equal(heldOutReuseResult.passed, false);
  assert.ok(heldOutReuseResult.failures.some(
    (item) => /HELD_OUT_REFERENCE_SOURCE_NOT_INDEPENDENT/.test(item),
  ));

  const mismatchedComparison = artifacts.map((artifact) =>
    artifact.kind === "SEMANTIC_COMPARISON" && artifact.caseId === cases[0].caseId
      ? { ...artifact, referenceContentKey: hex(9999) }
      : artifact);
  const mismatchResult = evaluateRetainedProfessionalBenchmarkV1(
    cases, retainedEvidence, mismatchedComparison,
  );
  assert.equal(mismatchResult.passed, false);
  assert.ok(mismatchResult.failures.some((item) => /COMPARISON_CONTENT_BINDING_MISMATCH/.test(item)));

  const crossAnalyzerTransfer = artifacts.map((artifact) => {
    if (artifact.caseId !== cases[0].caseId) return artifact;
    if (artifact.kind === "REFERENCE_DENSE_EVIDENCE") {
      return { ...artifact, baselineSourceContentKey: hex(500) };
    }
    if (artifact.kind === "TRANSFER_PROOF") {
      return { ...artifact, referenceContentKey: hex(7000) };
    }
    return artifact;
  });
  const crossAnalyzerResult = evaluateRetainedProfessionalBenchmarkV1(
    cases, retainedEvidence, crossAnalyzerTransfer,
  );
  assert.equal(crossAnalyzerResult.passed, true, crossAnalyzerResult.failures.join(", "));

  const crossAnalyzerWrongSource = crossAnalyzerTransfer.map((artifact) =>
    artifact.kind === "REFERENCE_DENSE_EVIDENCE" && artifact.caseId === cases[0].caseId
      ? { ...artifact, baselineSourceContentKey: hex(9000) }
      : artifact);
  const crossAnalyzerWrongSourceResult = evaluateRetainedProfessionalBenchmarkV1(
    cases, retainedEvidence, crossAnalyzerWrongSource,
  );
  assert.equal(crossAnalyzerWrongSourceResult.passed, false);
  assert.ok(crossAnalyzerWrongSourceResult.failures.some(
    (item) => /TRANSFER_REFERENCE_BINDING_MISMATCH/.test(item),
  ));

  const reusedSource = artifacts.map((artifact) =>
    artifact.kind === "TRANSFER_PROOF" && artifact.caseId === cases[0].caseId
      ? { ...artifact, transferSourceContentKey: artifact.baselineSourceContentKey }
      : artifact);
  const sourceResult = evaluateRetainedProfessionalBenchmarkV1(cases, retainedEvidence, reusedSource);
  assert.equal(sourceResult.passed, false);
  assert.ok(sourceResult.failures.some((item) => /TRANSFER_SOURCE_NOT_MATERIALLY_DIFFERENT/.test(item)));
});

test("M6.10 keeps proven low-risk work on fast path and routes difficult references through fidelity", async () => {
  const reference = shutterReference();
  const anatomy = deriveEffectAnatomyV1(reference);
  const learnedGraph = buildConstructionGraphV1(anatomy);
  const brain = new VisualEffectsBrainV1();
  let applied = 0;
  const fast = await brain.run({
    requestId: "fast",
    risk: "LOW",
    learnedTechniqueId: "learned:shutter",
    learnedGraph,
    renderWindow: async () => reference,
    applyGraph: async () => { applied += 1; },
    availableCapabilities: ALL_CAPABILITIES,
    evidenceRefs: ["proof:learned-shutter"],
  });
  assert.equal(fast.route, "FAST_PATH");
  assert.equal(fast.status, "COMPLETED");

  const difficult = await brain.run({
    requestId: "difficult",
    risk: "HIGH",
    referenceEvidence: reference,
    renderWindow: async () => reference,
    applyGraph: async () => { applied += 1; },
    availableCapabilities: ALL_CAPABILITIES,
    evidenceRefs: ["reference:microwave"],
  });
  assert.equal(difficult.route, "VISUAL_INTELLIGENCE");
  assert.equal(difficult.status, "COMPLETED");
  assert.equal(difficult.correction.status, "PASSED");
  assert.ok(applied >= 2);
});

test("M6.1 aligns dense transitions by semantic behavior and normalized editorial time", () => {
  const makeSequence = (sourceId, peakIndices, phaseShift = 0) => {
    const frameIntervalMs = 1000 / 60;
    const frames = Array.from({ length: 128 }, (_, index) => {
      const peak = peakIndices.findIndex((candidate) => candidate === index);
      const strength = peak < 0 ? 0 : 0.36 + peak * 0.09;
      return {
        ...frameDefaults,
        timeMs: index * frameIntervalMs,
        frameDifference: peak < 0 ? 0.008 : strength,
        motionEnergy: peak < 0 ? 0.01 : strength,
        displacementMagnitude: peak < 0 ? 0.006 : 0.05 + peak * 0.018,
        motionDirection: { x: peak % 2 === 0 ? 1 : 0, y: peak % 2 === 0 ? 0 : 1 },
        scale: peak < 0 ? 1 : 1.04 + peak * 0.025,
        rotationDegrees: peak < 0 ? 0 : peak * 1.7,
        distortionStrength: peak < 0 ? 0.02 : 0.16 + peak * 0.08,
        overlapDensity: peak < 0 ? 0.01 : 0.2 + peak * 0.06,
        temporalStateCount: peak < 0 ? 1 : 2 + (peak % 2),
      };
    });
    return {
      schema: "editflow.dense-effect-evidence.v1",
      sourceId,
      sourceKind: sourceId.startsWith("reference") ? "REFERENCE" : "RENDER",
      range: { startMs: phaseShift, endMs: phaseShift + (frames.length - 1) * frameIntervalMs },
      analyzerFingerprint: "fixture-analyzer-v1",
      settingsFingerprint: "sequence-fixture",
      contentKey: sourceId,
      frames: frames.map((frame) => ({ ...frame, timeMs: frame.timeMs + phaseShift })),
      summary: { ...summaryDefaults, frameCount: frames.length, frameIntervalMs },
      evidenceRefs: [`fixture:${sourceId}`],
    };
  };

  const reference = detectDenseEffectWindowsV1(
    makeSequence("reference:sequence", [15, 44, 77, 108]),
  );
  const render = detectDenseEffectWindowsV1(
    makeSequence("render:sequence", [17, 46, 62, 80, 111], 83),
  );
  const alignment = alignDenseEffectSequencesV1(reference, render);
  assert.equal(reference.windows.length, 4);
  assert.equal(render.windows.length, 5);
  assert.equal(alignment.pairs.length, 4);
  assert.deepEqual(alignment.unmatchedReferenceWindowIds, []);
  assert.deepEqual(alignment.unmatchedRenderWindowIds, ["effect-03"]);
  assert.deepEqual(
    alignment.pairs.map((pair) => [pair.referenceIndex, pair.renderIndex]),
    [[0, 0], [1, 1], [2, 3], [3, 4]],
  );
  assert.ok(alignment.pairs.every((pair) => pair.semanticCost < 0.25));
});

test("M6.3/M6.5 treats the observed professional reference as the fidelity authority", () => {
  const reference = evidence({
    temporalStateCountPeak: 2,
    temporalPersistence: 0.5,
    motionEnergyPeak: 0.46,
    displacementPeak: 0.055,
    stateSeparationPeak: 0.028,
    blurPeak: 0.31,
    exposurePeak: 0.64,
    overlapDensityPeak: 0.22,
    accelerationPeak: 0.035,
    recoveryFrames: 4,
  });
  assert.equal(distinguishShutterFromFlashZoomV1(reference).shutter, true);
  assert.equal(classifyEffectFamilyV1(reference), "SHUTTER_FRAGMENTATION");

  const dna = canonicalTransitionDnaV1("SHUTTER_FRAGMENTATION", reference.evidenceRefs);
  const self = compareSemanticVisualFidelityV1({ reference, render: reference, dna });
  assert.equal(self.definingCoverage, 1);
  assert.equal(self.weightedFidelity, 1);
  assert.equal(self.passed, true);
});


test("M6 live correction keeps evolving-warp acceleration on the dedicated motion-shaping actuator", () => {
  const controller = readFileSync(
    new URL("../scripts/proofs/m6-generic-native-auto-correction-proof.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    controller,
    /EVOLVING_WARP_MOTION_CONTROLS/,
    "live correction must not force acceleration controls onto Turbulent Displace",
  );
  assert.match(
    controller,
    /candidate\.kind === "RECOVERY"[\s\S]{0,220}includes\("acceleration"\)/,
    "motion controls without an explicit preferred node must fall back to RECOVERY",
  );
  assert.match(
    controller,
    /const targetNode = controlTargetNode\(nextGraph, control, instruction\.nodeId\);/,
  );
  assert.match(
    controller,
    /node\.nodeId === targetNode\.nodeId/,
  );
  assert.match(
    controller,
    /"distortionEvolutionScale",\s*"eventEvolutionSweepScale",/,
    "evolving-warp deformation tuning remains transferable without owning acceleration",
  );
});

test("M6 live correction search reads the same physical actuator it writes", () => {
  const controller = readFileSync(
    new URL("../scripts/proofs/m6-generic-native-auto-correction-proof.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    controller,
    /controlTargetNode\(valueGraph, control, instruction\?\.nodeId\)/,
    "semantic controls shared by Echo and Time Displacement must bind to the actuation instruction node",
  );
  assert.match(
    controller,
    /controlVectorFromGraph\(state\.graph, controls, instructions\)/,
  );
  assert.equal(
    controller.match(/attemptEvidenceFromState\(state, activeControls, actuationPlan\.instructions\)/g)?.length,
    2,
    "both bounded-search snapshots must preserve physical-node identity",
  );
  assert.match(
    controller,
    /parameter === "timeDisplacementStrengthScale"[\s\S]{0,140}minimum: 0\.25, maximum: 4, minimumStep: 0\.25/,
  );
  assert.match(
    controller,
    /const hasRetainedScalarAuthority = searchPlan\.metricResponses\.some\([\s\S]{0,140}retainedImprovingProbeCount > 0/,
    "render-proven local correction authority must outrank premature structural escalation",
  );
  assert.match(
    controller,
    /structuralEscalationInvariantIds\.length > 0[\s\S]{0,80}!hasRetainedScalarAuthority/,
  );
  assert.equal(
    controller.match(/excludedStrategies: previouslyRenderedStrategies/g)?.length,
    2,
    "both bounded and final synthesis selection must retain rejected strategies as negative evidence",
  );
});

test("M6 live correction never treats the degraded seed as causal actuator evidence", () => {
  const controller = readFileSync(
    new URL("../scripts/proofs/m6-generic-native-auto-correction-proof.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    controller,
    /const renderedStates = \[\];/,
    "the deliberately degraded seed must stay outside rendered actuator states",
  );
  assert.match(
    controller,
    /source: "retained-real-ae-seed",[\s\S]{0,80}causalActuationState: false/,
  );
  assert.match(
    controller,
    /const materializedPass = await executePass\(graph, 1\);/,
    "the synthesized graph must be rendered at neutral controls before correction/search",
  );
  assert.match(
    controller,
    /attemptId: "materialized-seed"[\s\S]{0,220}renderedStates\.push|renderedStates\.push\([\s\S]{0,220}attemptId: "materialized-seed"/,
  );
  assert.match(
    controller,
    /source: "real-ae-materialized-seed",[\s\S]{0,80}causalActuationState: true/,
  );
});
