import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  alignDenseEffectSequencesV1,
  canonicalTransitionDnaV1,
  classifyEffectFamilyV1,
  compareSemanticVisualFidelityV1,
  detectDenseEffectWindowsV1,
} from "../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("M6.1 retained microwave evidence is dense, real-pixel, and source-keyed", async () => {
  const reference = await readJson("proofs/diagnostics/m6-microwave-reference-cut1-evidence.json");
  const render = await readJson("proofs/diagnostics/m6-live-ae-microwave-cut1-evidence.json");

  assert.equal(reference.schema, "editflow.dense-effect-evidence.v1");
  assert.equal(reference.sourceKind, "REFERENCE");
  assert.equal(render.sourceKind, "RENDER");
  assert.equal(reference.summary.frameCount, 24);
  assert.equal(render.summary.frameCount, 25);
  assert.ok(reference.evidenceRefs.some((ref) => ref.startsWith("video:sha256:")));
  assert.ok(render.evidenceRefs.some((ref) => ref.startsWith("video:sha256:")));
  assert.ok(reference.evidenceRefs.some((ref) => ref.startsWith("probe-json:sha256:")));
  assert.ok(render.evidenceRefs.some((ref) => ref.startsWith("probe-json:sha256:")));
});

test("M6.3 real reference family selection fails closed instead of forcing shutter", async () => {
  const reference = await readJson("proofs/diagnostics/m6-microwave-reference-cut1-evidence.json");
  assert.equal(classifyEffectFamilyV1(reference), "UNKNOWN");
});

test("M6.5 v5 real-pixel comparator rejects weak AE shutter while preserving causal state-separation evidence", async () => {
  const reference = await readJson("proofs/diagnostics/m6-v5-cal-ref05-evidence.json");
  const weak = await readJson("proofs/diagnostics/m6-v5-cal-weak05-evidence.json");
  const improved = await readJson("proofs/diagnostics/m6-v5-cal-best05-evidence.json");
  assert.equal(reference.analyzerFingerprint, weak.analyzerFingerprint,
    "reference and render must be measured by the same analyzer implementation");
  assert.equal(reference.analyzerFingerprint, improved.analyzerFingerprint);
  assert.equal(classifyEffectFamilyV1(reference), "SHUTTER_FRAGMENTATION");
  assert.equal(classifyEffectFamilyV1(weak), "UNKNOWN");
  assert.equal(classifyEffectFamilyV1(improved), "UNKNOWN");

  const dna = canonicalTransitionDnaV1("SHUTTER_FRAGMENTATION", reference.evidenceRefs);
  const weakComparison = compareSemanticVisualFidelityV1({
    reference,
    render: weak,
    dna,
    alignment: "FRAME_ALIGNED",
  });
  const improvedComparison = compareSemanticVisualFidelityV1({
    reference,
    render: improved,
    dna,
    alignment: "FRAME_ALIGNED",
  });

  assert.equal(weakComparison.passed, false);
  // v6+ event-locality is deliberately non-applicable to retained v5
  // evidence, so it contributes one neutral passing invariant without
  // rewriting the historical measurements.
  assert.equal(weakComparison.definingCoverage, 3 / 7);
  assert.equal(improvedComparison.definingCoverage, 5 / 7);
  assert.ok(improvedComparison.weightedFidelity > weakComparison.weightedFidelity);
  for (const metric of ["fragmentationCoherencePeak", "overlapDensityPeak", "accelerationPeak"]) {
    assert.ok(weakComparison.metrics.some((item) =>
      item.metric === metric && !item.passed && item.renderValue < item.referenceValue),
    `expected under-driven defining deficit for ${metric}`);
  }
  assert.ok(weakComparison.metrics.some((item) =>
    item.metric === "fragmentationStateSeparationPeak" && !item.passed && item.renderValue > item.referenceValue),
  "family-valid separation must still fail when it is materially over-driven relative to the professional reference");
  assert.ok(improvedComparison.diagnoses.some((diagnosis) =>
    diagnosis.includes("overlapDensityPeak is under-driven")));
});


test("M6.5/M6.7 event-locality gate supersedes stale v6 shutter certification and rejects regressions", async () => {
  const reference = await readJson("proofs/diagnostics/m6-v6-event-ref05-evidence.json");
  const historicalCertified = await readJson("proofs/diagnostics/m6-v6-event-joint-01-evidence.json");
  const incoherent = await readJson("proofs/diagnostics/m6-v6-event-joint-03-evidence.json");
  const overWide = await readJson("proofs/diagnostics/m6-v6-event-joint-04-evidence.json");
  assert.equal(reference.analyzerFingerprint, historicalCertified.analyzerFingerprint);
  assert.ok(reference.summary.overlapDensityPeak > reference.summary.fragmentationOverlapDensityPeak * 4,
    "global texture overlap must not replace the coherent shutter-event measurement");
  assert.equal(classifyEffectFamilyV1(reference), "SHUTTER_FRAGMENTATION");
  assert.notEqual(classifyEffectFamilyV1(historicalCertified), "SHUTTER_FRAGMENTATION",
    "a render whose fragmentation persists as source texture must not remain family-certified");
  const dna = canonicalTransitionDnaV1("SHUTTER_FRAGMENTATION", reference.evidenceRefs);
  const superseded = compareSemanticVisualFidelityV1({
    reference,
    render: historicalCertified,
    dna,
  });
  const coordinationFail = compareSemanticVisualFidelityV1({ reference, render: incoherent, dna });
  const spreadFail = compareSemanticVisualFidelityV1({ reference, render: overWide, dna });
  assert.equal(superseded.passed, false);
  assert.equal(superseded.definingCoverage, 6 / 7);
  assert.ok(superseded.metrics.some((metric) =>
    metric.invariantId === "shutter.event-locality"
    && metric.metric === "fragmentationEventLocalization"
    && !metric.passed
    && Number(metric.renderValue) < Number(metric.referenceValue)));
  assert.equal(coordinationFail.passed, false);
  assert.ok(coordinationFail.metrics.some((metric) =>
    metric.invariantId === "shutter.coordination" && !metric.passed));
  assert.equal(spreadFail.passed, false);
  assert.ok(spreadFail.metrics.some((metric) =>
    metric.invariantId === "shutter.displacement" && !metric.passed));
});

test("M6 retained v5 manifest invalidates stale comparator authority and remains uncertified", async () => {
  const manifest = await readJson("proofs/manifests/m6-real-pixel-fidelity-v5.json");
  assert.equal(manifest.schema, "editflow.m6.real-pixel-fidelity-manifest.v5");
  assert.equal(manifest.reference.classifiedFamily, "SHUTTER_FRAGMENTATION");
  assert.equal(manifest.currentReplay.certified, false);
  assert.equal(manifest.currentReplay.definingCoverage, 4 / 6);
  assert.deepEqual(manifest.currentReplay.residualInvariantIds.sort(),
    ["shutter.displacement", "shutter.overlap"]);
  assert.ok(manifest.proofGovernance.historicalResultSuperseded);
  assert.equal(manifest.certification.professionalFidelityVerified, false);
  assert.equal(manifest.verification.tests.failed, 0);
});

test("M6.7 retained real correction attempts improve but remain fail-closed", async () => {
  const proof = await readJson("proofs/diagnostics/m6-shutter-correction-proof.json");
  assert.equal(proof.claim, "REAL_RENDERED_BOUNDED_CORRECTION");
  assert.equal(proof.result, "OPEN");
  assert.ok(proof.passes.length >= 3 && proof.passes.length <= 5);
  assert.equal(proof.bounded, true);
  assert.ok(proof.trend.weightedImprovement > 0.1);
  assert.ok(proof.trend.coverageImprovement >= 0.2);
  assert.equal(proof.finalGate.semantics, "RETAINED_BEST_STATE");
  assert.equal(proof.finalGate.certified, false);
  assert.ok(proof.finalGate.residualInvariantIds.includes("shutter.overlap"));
  assert.ok(proof.retention.some((item) => item.reason === "REGRESSION_ROLLBACK"),
    "a worse rendered attempt must be retained as evidence without replacing the best state");
  assert.ok(proof.finalGate.residualInvariantIds.length > 0,
    "retained correction proof must remain fail-closed while any defining invariant is residual");

  const finalPass = proof.passes.at(-1);
  assert.ok(finalPass.cases.every((item) => item.gate?.certified === false));
  for (const item of finalPass.cases) {
    const failed = item.gate?.underDrivenInvariantIds ?? [];
    const definingPlan = item.actuationPlan?.instructions.filter((instruction) => instruction.defining) ?? [];
    const plannedInvariants = new Set(definingPlan.map((instruction) => instruction.invariantId));
    for (const invariantId of failed) assert.ok(plannedInvariants.has(invariantId),
      `missing defining actuator plan for ${invariantId}`);
    assert.deepEqual(item.actuationPlan?.unresolvedInvariantIds ?? [], []);
  }
  const overlapControls = new Set(finalPass.cases.flatMap((item) =>
    item.actuationPlan?.instructions
      .filter((instruction) => instruction.invariantId === "shutter.overlap")
      .map((instruction) => instruction.control) ?? []));
  assert.ok(overlapControls.has("DUPLICATE_OPACITY"));
  assert.ok(overlapControls.has("DUPLICATE_SPREAD"));
});

test("M6.7 autonomous real-AE correction closes the bounded correction gate", async () => {
  const proof = await readJson("proofs/diagnostics/m6-auto-correction-proof-v2.json");
  assert.equal(proof.schema, "editflow.m6.real-ae-automatic-correction-proof.v1");
  assert.equal(proof.status, "PASSED");
  assert.ok(proof.bounded.actualRounds <= proof.bounded.maxCorrectionRounds);
  assert.ok(proof.bounded.renderedAttempts <=
    proof.bounded.maxCorrectionRounds * proof.bounded.maxCandidatesPerRound);
  assert.equal(proof.governance.hardcodedCertifiedCandidate, false);

  const attempts = proof.rounds.flatMap((round) => round.candidates);
  const certified = attempts.find((attempt) => attempt.certified);
  assert.ok(certified, "automatic search must discover a rendered certified state");
  assert.equal(certified.definingCoverage, 1);
  assert.equal(certified.weightedFidelity, 1);
  assert.deepEqual(certified.residualInvariantIds, []);
  assert.equal(certified.physicalState.duplicateSpreadPx, 28);
  assert.ok(certified.renderVideoSha256?.length > 0);
});

test("M6.8 retained real-pixel unknown synthesis is behavior-driven and rejects a degraded control", async () => {
  const proof = await readJson("proofs/diagnostics/m6-real-unknown-synthesis-case01.json");
  assert.equal(proof.schema, "editflow.m6.real-pixel-unknown-synthesis-proof.v1");
  assert.equal(proof.result, "PASS");
  assert.equal(proof.learnedSkillAccess, "DISABLED_BY_PROOF");
  assert.equal(proof.synthesis.status, "READY_FOR_PROOF");
  assert.equal(proof.synthesis.selectedFamily, "UNKNOWN");
  assert.equal(proof.synthesis.selectedStrategy, "LAYERED_PRIMITIVES");
  assert.ok(proof.synthesis.definingInvariantIds.includes(
    "unknown.fragmentation-coordination"));
  assert.ok(proof.synthesis.definingInvariantIds.includes(
    "unknown.fragmentation-separation"));

  assert.equal(proof.reconstruction.gate.certified, true);
  assert.equal(proof.reconstruction.comparison.definingCoverage, 1);
  assert.ok(proof.reconstruction.comparison.weightedFidelity > 0.95);
  assert.equal(proof.degradedControl.gate.certified, false);
  assert.ok(proof.degradedControl.comparison.definingCoverage < 1);
  assert.ok(proof.synthesis.candidateStrategies.some((candidate) =>
    candidate.strategy === "TIME_DISPLACEMENT_HYBRID"
    && candidate.adaptiveCapabilityProposals.some((proposal) =>
      proposal.capabilityId === "ae.effect.time-displacement"
      && proposal.proofRequirement === "REAL_AE_RENDER")));
});

test("M6.8 retained live-AE UNKNOWN graph materialization is event-local and source-time based", async () => {
  const proof = await readJson("proofs/diagnostics/m6-generic-native-materializer-case01.json");
  assert.equal(proof.schema, "editflow.m6.generic-native-materializer-proof.v1");
  assert.equal(proof.family, "UNKNOWN");
  assert.equal(proof.strategy, "LAYERED_PRIMITIVES");
  assert.equal(proof.definingCoverage, true);
  assert.deepEqual(proof.capabilityGaps, []);
  assert.equal(proof.transaction.state, "COMMITTED");
  assert.equal(proof.nativePlan.containsOpaqueM6Placeholder, false);
  assert.equal(proof.readbackVerification.actualLayerCount,
    proof.nativePlan.expectedTemporalStateCount);
  assert.equal(proof.readbackVerification.duplicateCount,
    proof.nativePlan.expectedDuplicateCount);
  assert.equal(proof.readbackVerification.globalLayerOffsetsAbsent, true);
  assert.equal(proof.readbackVerification.timeRemapEnabledCount,
    proof.nativePlan.expectedDuplicateCount);
  assert.equal(proof.readbackVerification.temporalOffsetsMatch, true);
  assert.equal(proof.readbackVerification.eventLocalVisibilityMatch, true);
  assert.equal(proof.readbackVerification.recursiveStableId, false);
  assert.ok(proof.nativePlan.commands.includes("layer.time_remap.enable"));
  assert.ok(proof.nativePlan.commands.includes("property.set_expression"));
});
