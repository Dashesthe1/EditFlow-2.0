import assert from "node:assert/strict";
import test from "node:test";

import {
  DenseEvidenceCacheV1,
  alignDenseEffectSequencesV1,
  analyzeDenseEffectEvidenceV1,
  detectDenseEffectWindowsV1,
  assessM6BaselineLockV1,
  buildConstructionGraphV1,
  canonicalTransitionDnaV1,
  classifyEffectFamilyV1,
  compareSemanticVisualFidelityV1,
  compileConstructionGraphV1,
  compileConstructionThroughVirtualAeV1,
  createCanonicalProfessionalBenchmarkV1,
  deriveConstructionActuationPlanV1,
  deriveEffectAnatomyV1,
  distinguishShutterFromFlashZoomV1,
  evaluateProfessionalBenchmarkV1,
  evaluateProfessionalFidelityGateV1,
  learnTutorialActionPixelConsequencesV1,
  runAutomaticVisualCorrectionLoopV1,
  summarizeDenseEffectFramesV1,
  synthesizeUnknownEffectV1,
  SynthesizedEffectMemoryV1,
  validateConstructionGraphV1,
  VisualCorrectionMemoryV1,
  VisualEffectsBrainV1,
} from "../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const ALL_CAPABILITIES = [
  "ae.layer.duplicate",
  "ae.layer.time.offset",
  "ae.layer.opacity.set",
  "ae.subject.isolate",
  "ae.layer.matte.set",
  "ae.effect.displacement-map",
  "ae.effect.directional-blur",
  "ae.effect.exposure",
  "ae.effect.channel-shift",
  "ae.layer.order.set",
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
      assert.equal(anatomy.observedMetrics.stateSeparationPeak, fixtures[index].summary.stateSeparationPeak);
      assert.equal(
        graph.nodes.find((node) => node.parameters.overlapDensityPeak !== undefined)?.parameters.overlapDensityPeak,
        fixtures[index].summary.overlapDensityPeak,
      );
      assert.equal(
        graph.nodes.find((node) => node.parameters.stateSeparationPeak !== undefined)?.parameters.stateSeparationPeak,
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
  assert.equal(spread?.metric, "stateSeparationPeak");
  assert.equal(spread?.direction, "DECREASE");
  assert.ok((spread?.multiplier ?? 1) < 1);
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
      stateSeparationPeak: parameters.stateSeparationPeak ?? 0,
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

test("M6.9 defines 24 canonical/held-out cases and requires transfer, degraded rejection, and A/B evidence", () => {
  const cases = createCanonicalProfessionalBenchmarkV1();
  assert.equal(cases.length, 24);
  assert.ok(new Set(cases.map((item) => item.family)).size >= 14);
  assert.ok(cases.some((item) => item.sourceKind === "HELD_OUT"));
  const completeEvidence = cases.map((item) => ({
    caseId: item.caseId,
    achievedLevel: "PROFESSIONAL_FIDELITY_VERIFIED",
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
