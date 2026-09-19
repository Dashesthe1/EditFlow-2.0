import assert from "node:assert/strict";
import test from "node:test";

import {
  DenseEvidenceCacheV1,
  analyzeDenseEffectEvidenceV1,
  assessM6BaselineLockV1,
  buildConstructionGraphV1,
  canonicalTransitionDnaV1,
  compareSemanticVisualFidelityV1,
  compileConstructionGraphV1,
  compileConstructionThroughVirtualAeV1,
  createCanonicalProfessionalBenchmarkV1,
  deriveEffectAnatomyV1,
  distinguishShutterFromFlashZoomV1,
  evaluateProfessionalBenchmarkV1,
  evaluateProfessionalFidelityGateV1,
  learnTutorialActionPixelConsequencesV1,
  runAutomaticVisualCorrectionLoopV1,
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
    temporalStateCount: index === 3 ? summary.temporalStateCountPeak : 1,
    occlusion: index === 3 ? summary.occlusionPeak : 0,
    ...frameOverrides,
  }));
  return {
    schema: "editflow.dense-effect-evidence.v1",
    sourceId: `fixture-${evidenceSerial}`,
    sourceKind: "REFERENCE",
    range: { startMs: 0, endMs: (summary.frameCount - 1) * summary.frameIntervalMs },
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
