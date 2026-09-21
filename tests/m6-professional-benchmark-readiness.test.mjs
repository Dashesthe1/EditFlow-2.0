import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

test("M6.9 retained readiness binds canonical shutter Level 6 to independent professional proof", async () => {
  const manifest = await load("proofs/manifests/m6-professional-benchmark-readiness-v1.json");
  assert.equal(manifest.status, "IN_PROGRESS");
  assert.equal(manifest.canonicalCaseCount, 24);
  assert.equal(manifest.result.passed, false);
  assert.equal(manifest.result.passedCases, 1);
  assert.equal(manifest.result.failures.length, 23);
  const shutter = manifest.retainedCases.find((item) => item.caseId === "m6:shutter_fragmentation:canonical");
  assert.equal(shutter?.achievedLevel, "PROFESSIONAL_FIDELITY_VERIFIED");
  assert.equal(shutter?.maturityProof.professionalCasePassCount, 2);
  assert.deepEqual(manifest.nextRequiredForShutterCanonical, []);
  const ref = shutter?.professionalCaseEvidenceRefs?.[0];
  const artifact = manifest.artifacts.find((item) => item.ref === ref);
  assert.equal(artifact?.kind, "PROFESSIONAL_CASE_PROOF");
  assert.equal(artifact?.certified, true);
  assert.equal(artifact?.definingCoverage, 1);
  assert.ok(artifact?.weightedFidelity > 0.99);
  assert.equal(artifact?.sha256, await sha256(ref));
});

test("M6.9 benchmark inventory keeps retained benchmark references isolated from live correction fixtures", async () => {
  const manifest = await load("proofs/manifests/m6-professional-benchmark-readiness-v1.json");
  const liveCanonical = await load("proofs/m6/references/shutter_fragmentation-canonical.json");
  const liveProof = await load("proofs/diagnostics/m6-shutter-measurement-v17-proof.json");
  const referenceArtifact = manifest.artifacts.find((item) =>
    item.caseId === "m6:shutter_fragmentation:canonical"
    && item.kind === "REFERENCE_DENSE_EVIDENCE"
  );
  assert.match(referenceArtifact?.ref ?? "", /^proofs\/m6\/benchmark\/references\//u);
  assert.notEqual(referenceArtifact?.ref, "proofs/m6/references/shutter_fragmentation-canonical.json");
  assert.equal(liveCanonical.analyzerFingerprint, liveProof.analyzer.measurementFingerprint);
  const benchmarkReference = await load(referenceArtifact.ref);
  assert.equal(benchmarkReference.contentKey, referenceArtifact.contentKey);
  const liveSource = liveCanonical.evidenceRefs.find((item) => item.startsWith("video:sha256:"));
  const benchmarkSource = benchmarkReference.evidenceRefs.find((item) => item.startsWith("video:sha256:"));
  assert.equal(benchmarkSource, liveSource);
});
test("M6.9 source admission retains rejected tutorial candidates without promoting benchmark evidence", async () => {
  const manifest = await load("proofs/manifests/m6-professional-benchmark-readiness-v1.json");
  const diagnostic = manifest.sourceAdmissionDiagnostics.find((item) =>
    item.caseId === "m6:velocity_transition:canonical"
  );
  assert.equal(diagnostic?.family, "VELOCITY_TRANSITION");
  assert.equal(diagnostic?.result, "REJECTED");
  assert.equal(diagnostic?.authority, "SOURCE_ADMISSION_ONLY_NOT_PROFESSIONAL_FIDELITY");
  assert.equal(diagnostic?.definingCoverage, 2 / 3);
  assert.deepEqual(diagnostic?.failedInvariantIds, ["velocity.energy"]);
  assert.match(diagnostic?.reasons?.join("\n") ?? "", /motionEnergyPeak=0\.0167/);
  assert.equal(diagnostic?.sha256, await sha256(diagnostic.ref));
  assert.equal(diagnostic?.sourceEvidenceSha256, await sha256(diagnostic.sourceEvidenceRef));

  assert.equal(
    manifest.retainedCases.some((item) => item.caseId === "m6:velocity_transition:canonical"),
    false,
  );
  assert.equal(manifest.casesWithRetainedEvidence, 1);
  assert.equal(manifest.result.passedCases, 1);
});

test("M6.9 Zoom source admission rejects scale drift without promoting benchmark evidence", async () => {
  const manifest = await load("proofs/manifests/m6-professional-benchmark-readiness-v1.json");
  const diagnostic = manifest.sourceAdmissionDiagnostics.find((item) =>
    item.caseId === "m6:zoom_impact:canonical"
  );
  assert.equal(diagnostic?.family, "ZOOM_IMPACT");
  assert.equal(diagnostic?.result, "REJECTED");
  assert.equal(diagnostic?.definingCoverage, 2 / 3);
  assert.ok(diagnostic?.weightedContractScore < 1);
  assert.deepEqual(diagnostic?.failedInvariantIds, ["zoom.recovery"]);
  assert.match(
    diagnostic?.reasons?.join("\n") ?? "",
    /scaleVelocityRecoveryRatio=.*fails family admission/,
  );
  assert.equal(diagnostic?.sha256, await sha256(diagnostic.ref));
  assert.equal(diagnostic?.sourceEvidenceSha256, await sha256(diagnostic.sourceEvidenceRef));
  assert.equal(diagnostic?.preAeRejectionStatus, "PASS");
  assert.equal(diagnostic?.preAeRejectionSha256, await sha256(diagnostic.preAeRejectionRef));
  const boundary = await load(diagnostic.preAeRejectionRef);
  assert.equal(boundary.authority, "LIVE_AE_FAIL_CLOSED_BEFORE_MUTATION");
  assert.equal(boundary.liveAe.beforeHostRevision, boundary.liveAe.afterHostRevision);
  assert.equal(boundary.materializer.exitCode, 1);
  assert.equal(boundary.correction.exitCode, 1);
  assert.equal(boundary.liveAe.beforeMutationLeaseHeld, false);
  assert.equal(boundary.liveAe.afterMutationLeaseHeld, false);

  assert.equal(
    manifest.retainedCases.some((item) => item.caseId === "m6:zoom_impact:canonical"),
    false,
  );
  assert.equal(manifest.casesWithRetainedEvidence, 1);
});

test("M6.9 Displacement Warp retains real-AE reference-faithful progress without Level 6 promotion", async () => {
  const manifest = await load("proofs/manifests/m6-professional-benchmark-readiness-v1.json");
  const admission = manifest.sourceAdmissionDiagnostics.find((item) =>
    item.caseId === "m6:displacement_warp:canonical"
  );
  assert.equal(admission?.family, "DISPLACEMENT_WARP");
  assert.equal(admission?.result, "ADMITTED");
  assert.equal(admission?.definingCoverage, 1);
  assert.equal(admission?.weightedContractScore, 1);
  assert.deepEqual(admission?.failedInvariantIds, []);
  assert.equal(admission?.sha256, await sha256(admission.ref));
  assert.equal(admission?.sourceEvidenceSha256, await sha256(admission.sourceEvidenceRef));

  const diagnostic = manifest.referenceFidelityDiagnostics.find((item) =>
    item.caseId === "m6:displacement_warp:canonical"
  );
  assert.equal(
    diagnostic?.authority,
    "SINGLE_PROFESSIONAL_REFERENCE_FAITHFUL_NOT_M6_9_CERTIFIED",
  );
  assert.equal(diagnostic?.maturityCeiling, "REFERENCE_FAITHFUL");
  assert.equal(diagnostic?.benchmarkPromoted, false);
  assert.equal(diagnostic?.sourceAdmissionSha256, await sha256(diagnostic.sourceAdmissionRef));
  assert.equal(diagnostic?.referenceEvidenceSha256, await sha256(diagnostic.referenceEvidenceRef));
  assert.equal(diagnostic?.correctionProofSha256, await sha256(diagnostic.correctionProofRef));
  assert.equal(diagnostic?.degradedSeed.evidenceSha256, await sha256(diagnostic.degradedSeed.evidenceRef));
  assert.equal(diagnostic?.degradedSeed.gateCertified, false);
  assert.equal(diagnostic?.degradedSeed.definingCoverage, 0);
  assert.deepEqual(diagnostic?.degradedSeed.failedInvariantIds, ["warp.distortion"]);

  assert.equal(diagnostic?.finalRealAe.evidenceSha256, await sha256(diagnostic.finalRealAe.evidenceRef));
  assert.equal(diagnostic?.finalRealAe.videoSha256, await sha256(diagnostic.finalRealAe.videoRef));
  assert.equal(diagnostic?.finalRealAe.readbackSha256, await sha256(diagnostic.finalRealAe.readbackRef));
  assert.ok(diagnostic?.finalRealAe.weightedFidelity > diagnostic?.degradedSeed.weightedFidelity);
  assert.equal(diagnostic?.finalRealAe.definingCoverage, 1);
  assert.equal(diagnostic?.finalRealAe.gateOutcome, "PASS");
  assert.equal(diagnostic?.finalRealAe.gateCertified, true);
  assert.equal(diagnostic?.finalRealAe.weakerSubstitutionDetected, false);
  assert.equal(diagnostic?.finalRealAe.transactionState, "COMMITTED");
  assert.equal(diagnostic?.finalRealAe.cleanupRestored, true);
  assert.deepEqual(
    diagnostic?.finalRealAe.appliedDefiningActuationIds,
    [
      "actuate:warp.distortion:distortion_strength",
      "actuate:warp.distortion:distortion_size",
      "actuate:warp.distortion:distortion_complexity",
      "actuate:warp.distortion:distortion_evolution",
    ],
  );
  assert.deepEqual(diagnostic?.finalRealAe.unsupportedInstructionIds, []);
  assert.deepEqual(diagnostic?.correction.residualInvariantIds, []);
  assert.equal(diagnostic?.correction.synthesisEscalation, null);
  assert.deepEqual(diagnostic?.transferAxesRequired, ["duration", "intensity"]);
  assert.deepEqual(
    diagnostic?.missingForBenchmarkPromotion,
    [
      "DIRECT_AB_CALIBRATION",
      "TRANSFER_DURATION",
      "TRANSFER_INTENSITY",
      "SECOND_INDEPENDENT_PROFESSIONAL_CASE",
    ],
  );

  assert.equal(
    manifest.retainedCases.some((item) => item.caseId === "m6:displacement_warp:canonical"),
    false,
  );
  assert.equal(manifest.casesWithRetainedEvidence, 1);
  assert.equal(manifest.result.passedCases, 1);
});
