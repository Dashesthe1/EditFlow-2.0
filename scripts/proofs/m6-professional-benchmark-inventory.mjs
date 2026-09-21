import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCanonicalProfessionalBenchmarkV1,
  evaluateRetainedProfessionalBenchmarkV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "proofs", "manifests", "m6-professional-benchmark-readiness-v1.json");
const V6 = path.join(ROOT, "proofs", "manifests", "m6-real-pixel-fidelity-v6.json");
const TRANSFER_V17 = path.join(
  ROOT, "proofs", "diagnostics", "m6-shutter-measurement-v17-proof.json",
);
const PROFESSIONAL_CASE_V16 = path.join(
  ROOT, "proofs", "m6", "professional-cases", "shutter_fragmentation-held-out-w04-v16.json",
);
const VELOCITY_SOURCE_REJECTION = path.join(
  ROOT,
  "proofs",
  "diagnostics",
  "m6-velocity-source-candidate-smooth-twixtor-w09-v1-admission.json",
);
const ZOOM_SOURCE_ADMISSION = path.join(
  ROOT,
  "proofs",
  "diagnostics",
  "m6-zoom-impact-source-candidate-smooth-zoom-z19-v1-admission.json",
);
const ZOOM_PRE_AE_REJECTION = path.join(
  ROOT,
  "proofs",
  "diagnostics",
  "m6-zoom-impact-source-admission-live-boundary-v1.json",
);
const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const relative = (file) => path.relative(ROOT, file).replaceAll("\\", "/");
const sha256File = async (file) => createHash("sha256")
  .update(await readFile(file))
  .digest("hex");
const sourceVideoKey = (evidence) => {
  const ref = evidence.evidenceRefs?.find((item) => item.startsWith("video:sha256:"));
  return typeof ref === "string" ? ref.slice("video:sha256:".length) : null;
};

const cases = createCanonicalProfessionalBenchmarkV1();
const shutter = cases.find((item) => item.caseId === "m6:shutter_fragmentation:canonical");
if (shutter === undefined) throw new Error("Canonical shutter benchmark case is missing.");
const velocity = cases.find((item) => item.caseId === "m6:velocity_transition:canonical");
if (velocity === undefined) throw new Error("Canonical velocity benchmark case is missing.");
const zoom = cases.find((item) => item.caseId === "m6:zoom_impact:canonical");
if (zoom === undefined) throw new Error("Canonical zoom benchmark case is missing.");
const v6 = await load(V6);
const referenceSource = path.resolve(ROOT, v6.reference.evidence);
const renderSource = path.resolve(ROOT, v6.certifiedRealAeCandidate.evidence);
const comparisonSource = path.resolve(ROOT, v6.certifiedRealAeCandidate.fidelity);
const directAbSource = path.resolve(ROOT, v6.directAbEvidence.path);
const degradedComparisonSource = path.resolve(
  ROOT, v6.retainedNegativeControls[0].fidelity,
);
const degradedEvidenceSource = degradedComparisonSource.replace(
  /-fidelity\.json$/u, "-evidence.json",
);
const referencePath = path.resolve(ROOT, shutter.referenceEvidenceRef);
await mkdir(path.dirname(referencePath), { recursive: true });
await copyFile(referenceSource, referencePath);

const reference = await load(referencePath);
const render = await load(renderSource);
const comparison = await load(comparisonSource);
const degradedComparison = await load(degradedComparisonSource);
const degradedRender = await load(degradedEvidenceSource);
const transferProof = await load(TRANSFER_V17);
const transferReferenceSource = path.resolve(ROOT, transferProof.reference.evidenceRef);
const transferRenderSource = path.resolve(ROOT, transferProof.corrected09.evidenceRef);
const transferReference = await load(transferReferenceSource);
const transferRender = await load(transferRenderSource);
const canonicalReferenceSourceKey = sourceVideoKey(reference);
const transferReferenceSourceKey = sourceVideoKey(transferReference);
if (canonicalReferenceSourceKey === null
  || transferReferenceSourceKey !== canonicalReferenceSourceKey
  || transferProof.transferIdentity?.baselineSourceContentKey !== canonicalReferenceSourceKey
  || transferProof.assertions?.analyzerMatched !== true
  || transferProof.assertions?.corrected09FidelityPasses !== true
  || transferProof.assertions?.corrected09DefiningCoverageComplete !== true
  || transferProof.assertions?.degradedControlRejected !== true
  || transferReference.analyzerFingerprint !== transferRender.analyzerFingerprint
  || await sha256File(transferReferenceSource) !== transferProof.reference.evidenceSha256
  || await sha256File(transferRenderSource) !== transferProof.corrected09.evidenceSha256) {
  throw new Error("M6 v17 shutter transfer proof lost its source/analyzer/content binding.");
}
if (comparison.comparison.referenceEvidenceKey !== reference.contentKey
  || comparison.comparison.renderEvidenceKey !== render.contentKey
  || comparison.gate.certified !== true) {
  throw new Error("M6 v6 certified shutter evidence lost its content binding.");
}
if (degradedComparison.comparison.referenceEvidenceKey !== reference.contentKey
  || degradedComparison.comparison.renderEvidenceKey !== degradedRender.contentKey
  || degradedComparison.gate.certified !== false) {
  throw new Error("M6 v6 degraded shutter control lost its rejection binding.");
}
const directAbSha = await sha256File(directAbSource);
if (directAbSha !== v6.directAbEvidence.sha256) {
  throw new Error("M6 v6 direct A/B artifact digest no longer matches its manifest.");
}

const professionalCase = await load(PROFESSIONAL_CASE_V16);
const professionalReferencePath = path.resolve(ROOT, professionalCase.reference.ref);
const professionalRenderPath = path.resolve(
  ROOT, professionalCase.constructionReuse.retainedRenderRef,
);
const professionalRenderEvidencePath = path.resolve(
  ROOT, professionalCase.constructionReuse.renderEvidenceRef,
);
const professionalTransferPath = path.resolve(
  ROOT, professionalCase.constructionReuse.transferProofRef,
);
const professionalFidelityPath = path.resolve(ROOT, professionalCase.fidelity.ref);
const professionalDirectAbPath = path.resolve(ROOT, professionalCase.directAb.ref);
const professionalDirectAbGenerator = path.resolve(ROOT, professionalCase.directAb.generatorRef);
const professionalDegradedPath = path.resolve(ROOT, professionalCase.degradedControl.ref);
const professionalDegradedEvidencePath = path.resolve(
  ROOT, professionalCase.degradedControl.renderEvidenceRef,
);
const professionalReference = await load(professionalReferencePath);
const professionalRenderEvidence = await load(professionalRenderEvidencePath);
const professionalTransfer = await load(professionalTransferPath);
const professionalFidelity = await load(professionalFidelityPath);
const professionalDegraded = await load(professionalDegradedPath);
const professionalDegradedEvidence = await load(professionalDegradedEvidencePath);
const professionalReferenceSourceKey = sourceVideoKey(professionalReference);
if (professionalCase.schema !== "editflow.m6.professional-case-pass.v1"
  || professionalCase.result !== "PASS"
  || professionalCase.family !== shutter.family
  || professionalCase.independence?.distinctProfessionalSource !== true
  || professionalCase.constructionReuse?.reusedWithoutHeldOutRetuning !== true
  || professionalCase.independence?.canonicalSourceVideoSha256 !== canonicalReferenceSourceKey
  || professionalReferenceSourceKey === null
  || professionalReferenceSourceKey !== professionalCase.reference.sourceVideoSha256
  || professionalReferenceSourceKey === canonicalReferenceSourceKey) {
  throw new Error("M6 held-out professional case lost its independent-source identity.");
}
if (await sha256File(professionalReferencePath) !== professionalCase.reference.sha256
  || await sha256File(professionalRenderPath) !== professionalCase.constructionReuse.retainedRenderSha256
  || await sha256File(professionalFidelityPath) !== professionalCase.fidelity.sha256
  || await sha256File(professionalDirectAbPath) !== professionalCase.directAb.sha256
  || await sha256File(professionalDirectAbGenerator) !== professionalCase.directAb.generatorSha256
  || await sha256File(professionalDegradedPath) !== professionalCase.degradedControl.sha256
  || await sha256File(professionalDegradedEvidencePath)
    !== professionalCase.degradedControl.renderEvidenceSha256) {
  throw new Error("M6 held-out professional case lost a retained artifact digest binding.");
}
if (professionalReference.contentKey !== professionalCase.reference.contentKey
  || professionalRenderEvidence.contentKey !== professionalCase.constructionReuse.renderContentKey
  || professionalReference.analyzerFingerprint !== professionalRenderEvidence.analyzerFingerprint
  || professionalTransfer.render?.ref !== professionalCase.constructionReuse.retainedRenderRef
  || professionalTransfer.render?.sha256 !== professionalCase.constructionReuse.retainedRenderSha256
  || professionalTransfer.render?.contentKey !== professionalRenderEvidence.contentKey
  || professionalFidelity.result !== "CERTIFIED"
  || professionalFidelity.gate?.certified !== true
  || professionalFidelity.reference?.contentKey !== professionalReference.contentKey
  || professionalFidelity.render?.contentKey !== professionalRenderEvidence.contentKey
  || professionalCase.fidelity.certified !== true
  || professionalCase.fidelity.definingCoverage !== 1) {
  throw new Error("M6 held-out professional case lost its certified render/comparison binding.");
}
if (professionalDegraded.result !== "REJECTED"
  || professionalDegraded.gate?.certified !== false
  || professionalDegraded.reference?.contentKey !== professionalReference.contentKey
  || professionalDegraded.render?.contentKey !== professionalDegradedEvidence.contentKey
  || professionalDegradedEvidence.contentKey === professionalRenderEvidence.contentKey
  || professionalCase.degradedControl.rejected !== true) {
  throw new Error("M6 held-out professional case lost its degraded-control rejection.");
}
const professionalCaseRef = relative(PROFESSIONAL_CASE_V16);

const velocitySourceAdmission = await load(VELOCITY_SOURCE_REJECTION);
const velocitySourceEvidencePath = path.resolve(
  ROOT,
  velocitySourceAdmission.sourceEvidence?.ref ?? "",
);
const velocitySourceEvidence = await load(velocitySourceEvidencePath);
if (velocitySourceAdmission.schema !== "editflow.m6.reference-family-admission-proof.v1"
  || velocitySourceAdmission.authority !== "SOURCE_ADMISSION_ONLY_NOT_PROFESSIONAL_FIDELITY"
  || velocitySourceAdmission.result !== "REJECTED"
  || velocitySourceAdmission.requestedFamily !== velocity.family
  || velocitySourceAdmission.candidate?.passed !== false
  || velocitySourceAdmission.candidate?.definingCoverage >= 1
  || !velocitySourceAdmission.candidate?.checks?.some((item) =>
    item.invariantId === "velocity.energy" && item.passed === false)) {
  throw new Error("M6 velocity source-admission rejection lost its fail-closed family-DNA decision.");
}
if (velocitySourceEvidence.sourceKind !== "REFERENCE"
  || velocitySourceEvidence.contentKey !== velocitySourceAdmission.sourceEvidence.contentKey
  || velocitySourceEvidence.analyzerFingerprint
    !== velocitySourceAdmission.sourceEvidence.analyzerFingerprint
  || await sha256File(velocitySourceEvidencePath) !== velocitySourceAdmission.sourceEvidence.sha256) {
  throw new Error("M6 velocity source-admission rejection lost its dense-evidence binding.");
}
const velocitySourceAdmissionRef = relative(VELOCITY_SOURCE_REJECTION);

const zoomSourceAdmission = await load(ZOOM_SOURCE_ADMISSION);
const zoomSourceEvidencePath = path.resolve(
  ROOT,
  zoomSourceAdmission.sourceEvidence?.ref ?? "",
);
const zoomSourceEvidence = await load(zoomSourceEvidencePath);
const zoomAdmissionDecisionCoherent = zoomSourceAdmission.result === "ADMITTED"
  ? zoomSourceAdmission.candidate?.passed === true
    && zoomSourceAdmission.candidate?.definingCoverage === 1
    && !zoomSourceAdmission.candidate?.checks?.some((item) => item.passed !== true)
  : zoomSourceAdmission.result === "REJECTED"
    && zoomSourceAdmission.candidate?.passed === false
    && zoomSourceAdmission.candidate?.definingCoverage < 1
    && zoomSourceAdmission.candidate?.checks?.some((item) => item.passed === false);
if (zoomSourceAdmission.schema !== "editflow.m6.reference-family-admission-proof.v1"
  || zoomSourceAdmission.authority !== "SOURCE_ADMISSION_ONLY_NOT_PROFESSIONAL_FIDELITY"
  || zoomSourceAdmission.requestedFamily !== zoom.family
  || !zoomAdmissionDecisionCoherent) {
  throw new Error("M6 zoom source admission lost its fail-closed family-DNA decision.");
}
if (zoomSourceEvidence.sourceKind !== "REFERENCE"
  || zoomSourceEvidence.contentKey !== zoomSourceAdmission.sourceEvidence.contentKey
  || zoomSourceEvidence.analyzerFingerprint !== zoomSourceAdmission.sourceEvidence.analyzerFingerprint
  || await sha256File(zoomSourceEvidencePath) !== zoomSourceAdmission.sourceEvidence.sha256) {
  throw new Error("M6 zoom source admission lost its dense-evidence binding.");
}
const zoomSourceAdmissionRef = relative(ZOOM_SOURCE_ADMISSION);
const zoomPreAeRejection = await load(ZOOM_PRE_AE_REJECTION);
const materializerPath = path.join(
  ROOT, "scripts", "proofs", "m6-generic-native-materializer-proof.mjs",
);
const autoCorrectionPath = path.join(
  ROOT, "scripts", "proofs", "m6-generic-native-auto-correction-proof.mjs",
);
if (zoomPreAeRejection.schema !== "editflow.m6.known-family-rejection-live-boundary-proof.v1"
  || zoomPreAeRejection.status !== "PASS"
  || zoomPreAeRejection.authority !== "LIVE_AE_FAIL_CLOSED_BEFORE_MUTATION"
  || zoomPreAeRejection.family !== zoom.family
  || zoomPreAeRejection.sourceAdmission?.ref !== zoomSourceAdmissionRef
  || zoomPreAeRejection.sourceAdmission?.sha256 !== await sha256File(ZOOM_SOURCE_ADMISSION)
  || zoomPreAeRejection.materializer?.sha256 !== await sha256File(materializerPath)
  || zoomPreAeRejection.correction?.sha256 !== await sha256File(autoCorrectionPath)
  || zoomPreAeRejection.materializer?.exitCode === 0
  || zoomPreAeRejection.correction?.exitCode === 0
  || zoomPreAeRejection.liveAe?.beforeHostRevision !== zoomPreAeRejection.liveAe?.afterHostRevision
  || zoomPreAeRejection.liveAe?.beforeMutationLeaseHeld !== false
  || zoomPreAeRejection.liveAe?.afterMutationLeaseHeld !== false) {
  throw new Error("M6 zoom source admission lost its live pre-AE rejection boundary proof.");
}
const zoomPreAeRejectionRef = relative(ZOOM_PRE_AE_REJECTION);

const renderRef = relative(renderSource);
const comparisonRef = relative(comparisonSource);
const directAbRef = relative(directAbSource);
const degradedRef = relative(degradedComparisonSource);
const transferRef = relative(TRANSFER_V17);
const evidence = [{
  caseId: shutter.caseId,
  achievedLevel: "PROFESSIONAL_FIDELITY_VERIFIED",
  maturityProof: {
    functionallyPresent: true,
    structuralCoverageComplete: true,
    visuallyRecognizable: true,
    referenceFaithful: true,
    transferVariantCount: 1,
    professionalCasePassCount: 2,
    robustnessAxesPassed: [...shutter.transferAxes],
  },
  directAbReferenceRef: directAbRef,
  comparisonEvidenceRef: comparisonRef,
  renderEvidenceRef: renderRef,
  transferEvidenceRefs: [transferRef],
  professionalCaseEvidenceRefs: [professionalCaseRef],
  degradedControlEvidenceRef: degradedRef,
  transferPassed: true,
  degradedCaseRejected: true,
}];

const artifacts = [
  {
    ref: shutter.referenceEvidenceRef,
    kind: "REFERENCE_DENSE_EVIDENCE",
    caseId: shutter.caseId,
    family: shutter.family,
    sha256: await sha256File(referencePath),
    contentKey: reference.contentKey,
    baselineSourceContentKey: canonicalReferenceSourceKey,
  },
  {
    ref: renderRef,
    kind: "RENDER_DENSE_EVIDENCE",
    caseId: shutter.caseId,
    family: shutter.family,
    sha256: await sha256File(renderSource),
    contentKey: render.contentKey,
  },
  {
    ref: comparisonRef,
    kind: "SEMANTIC_COMPARISON",
    caseId: shutter.caseId,
    family: shutter.family,
    sha256: await sha256File(comparisonSource),
    referenceContentKey: reference.contentKey,
    renderContentKey: render.contentKey,
  },
  {
    ref: directAbRef,
    kind: "DIRECT_AB",
    caseId: shutter.caseId,
    family: shutter.family,
    sha256: directAbSha,
    referenceContentKey: reference.contentKey,
    renderContentKey: render.contentKey,
  },
  {
    ref: degradedRef,
    kind: "DEGRADED_CONTROL",
    caseId: shutter.caseId,
    family: shutter.family,
    sha256: await sha256File(degradedComparisonSource),
    referenceContentKey: reference.contentKey,
    renderContentKey: degradedRender.contentKey,
  },
  {
    ref: transferRef,
    kind: "TRANSFER_PROOF",
    caseId: shutter.caseId,
    family: shutter.family,
    sha256: await sha256File(TRANSFER_V17),
    referenceContentKey: transferReference.contentKey,
    renderContentKey: transferRender.contentKey,
    baselineSourceContentKey: transferProof.transferIdentity.baselineSourceContentKey,
    transferSourceContentKey: transferProof.transferIdentity.transferSourceContentKey,
    transferAxes: transferProof.transferIdentity.transferAxes,
  },
  {
    ref: professionalCaseRef,
    kind: "PROFESSIONAL_CASE_PROOF",
    caseId: shutter.caseId,
    family: shutter.family,
    sha256: await sha256File(PROFESSIONAL_CASE_V16),
    referenceContentKey: professionalReference.contentKey,
    renderContentKey: professionalRenderEvidence.contentKey,
    baselineSourceContentKey: professionalReferenceSourceKey,
    certified: true,
    renderedOutputVerified: true,
    degradedControlRejected: true,
    definingCoverage: professionalCase.fidelity.definingCoverage,
    weightedFidelity: professionalCase.fidelity.weightedFidelity,
  },
];

const result = evaluateRetainedProfessionalBenchmarkV1(cases, evidence, artifacts);
const kinds = [
  "REFERENCE_DENSE_EVIDENCE",
  "RENDER_DENSE_EVIDENCE",
  "SEMANTIC_COMPARISON",
  "DIRECT_AB",
  "TRANSFER_PROOF",
  "PROFESSIONAL_CASE_PROOF",
  "DEGRADED_CONTROL",
];
const artifactCoverage = Object.fromEntries(
  kinds.map((kind) => [kind, artifacts.filter((item) => item.kind === kind).length]),
);
const manifest = {
  schema: "editflow.m6.professional-benchmark-readiness-manifest.v1",
  generatedAt: new Date().toISOString(),
  milestone: "M6.9",
  status: result.passed ? "PASS" : "IN_PROGRESS",
  authority: "RETAINED_CONTENT_ADDRESSED_ARTIFACTS_ONLY",
  canonicalCaseCount: cases.length,
  casesWithRetainedEvidence: evidence.length,
  artifactCoverage,
  retainedCases: evidence,
  artifacts,
  result,
  sourceManifests: [{
    ref: relative(V6),
    sha256: await sha256File(V6),
    status: v6.status,
  }],
  supplementalProofs: [{
    ref: transferRef,
    sha256: await sha256File(TRANSFER_V17),
    status: "TRANSFER_VERIFIED_SUBJECT_ASPECT_RATIO",
  }],
  professionalCasePassEvidence: [{
    ref: professionalCaseRef,
    sha256: await sha256File(PROFESSIONAL_CASE_V16),
    sourceVideoSha256: professionalReferenceSourceKey,
    distinctProfessionalSource: true,
    reusedWithoutHeldOutRetuning: true,
    weightedFidelity: professionalCase.fidelity.weightedFidelity,
    definingCoverage: professionalCase.fidelity.definingCoverage,
    degradedControlRejected: professionalCase.degradedControl.rejected,
  }],
  sourceAdmissionDiagnostics: [{
    caseId: velocity.caseId,
    family: velocity.family,
    ref: velocitySourceAdmissionRef,
    sha256: await sha256File(VELOCITY_SOURCE_REJECTION),
    sourceEvidenceRef: velocitySourceAdmission.sourceEvidence.ref,
    sourceEvidenceSha256: velocitySourceAdmission.sourceEvidence.sha256,
    sourceVideoSha256: velocitySourceAdmission.sourceEvidence.sourceVideoSha256,
    result: velocitySourceAdmission.result,
    definingCoverage: velocitySourceAdmission.candidate.definingCoverage,
    weightedContractScore: velocitySourceAdmission.candidate.weightedContractScore,
    failedInvariantIds: velocitySourceAdmission.candidate.checks
      .filter((item) => !item.passed)
      .map((item) => item.invariantId),
    reasons: velocitySourceAdmission.candidate.failures,
    authority: velocitySourceAdmission.authority,
  }, {
    caseId: zoom.caseId,
    family: zoom.family,
    ref: zoomSourceAdmissionRef,
    sha256: await sha256File(ZOOM_SOURCE_ADMISSION),
    sourceEvidenceRef: zoomSourceAdmission.sourceEvidence.ref,
    sourceEvidenceSha256: zoomSourceAdmission.sourceEvidence.sha256,
    sourceVideoSha256: zoomSourceAdmission.sourceEvidence.sourceVideoSha256,
    result: zoomSourceAdmission.result,
    definingCoverage: zoomSourceAdmission.candidate.definingCoverage,
    weightedContractScore: zoomSourceAdmission.candidate.weightedContractScore,
    failedInvariantIds: zoomSourceAdmission.candidate.checks
      .filter((item) => !item.passed)
      .map((item) => item.invariantId),
    reasons: zoomSourceAdmission.candidate.failures,
    authority: zoomSourceAdmission.authority,
    preAeRejectionRef: zoomPreAeRejectionRef,
    preAeRejectionSha256: await sha256File(ZOOM_PRE_AE_REJECTION),
    preAeRejectionStatus: zoomPreAeRejection.status,
  }],
  proofSources: {
    evaluator: "packages/visual-effects-intelligence/src/benchmark.ts",
    evaluatorSha256: await sha256File(path.join(
      ROOT, "packages", "visual-effects-intelligence", "src", "benchmark.ts",
    )),
    generator: relative(fileURLToPath(import.meta.url)),
    generatorSha256: await sha256File(fileURLToPath(import.meta.url)),
  },
  nextRequiredForShutterCanonical: [],
  noOverclaim: result.passed
    ? null
    : "M6.9 is not certified until all 24 canonical/held-out cases satisfy retained artifact, transfer, degraded-control, and maturity gates.",
};
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  ok: true,
  output: OUT,
  milestoneStatus: manifest.status,
  casesWithRetainedEvidence: manifest.casesWithRetainedEvidence,
  canonicalCaseCount: manifest.canonicalCaseCount,
  artifactCoverage,
  benchmarkPassed: result.passed,
  failureCount: result.failures.length,
}));
