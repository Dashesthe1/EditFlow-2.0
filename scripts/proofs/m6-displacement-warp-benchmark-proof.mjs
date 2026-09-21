import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildConstructionGraphV1,
  compareSemanticVisualFidelityV1,
  compileConstructionGraphV1,
  deriveEffectAnatomyV1,
  evaluateProfessionalFidelityGateV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIAG = path.join(ROOT, "proofs", "diagnostics");
const BENCH = path.join(ROOT, "proofs", "m6", "benchmark", "references");
const PROFESSIONAL = path.join(ROOT, "proofs", "m6", "professional-cases");
const CANONICAL_SOURCE = path.join(DIAG, "m6-displacement-warp-source-candidate-smooth-zoom-z19-v3-evidence.json");
const CANONICAL_CORRECTION = path.join(DIAG, "m6-displacement-warp-smooth-zoom-z19-auto-correction-v8.json");
const TRANSFER_CORRECTION = path.join(DIAG, "m6-displacement-warp-ripple-shake-w400-429-auto-correction-v1.json");
const CANONICAL_AB = path.join(DIAG, "m6-displacement-warp-canonical-direct-ab-v1.png");
const TRANSFER_AB = path.join(DIAG, "m6-displacement-warp-ripple-shake-w400-429-direct-ab-v1.png");
const CANONICAL_RETAINED = path.join(BENCH, "displacement_warp-canonical.json");
const TRANSFER_RETAINED = path.join(BENCH, "displacement_warp-professional-ripple-shake-v1.json");
const CANONICAL_FIDELITY = path.join(DIAG, "m6-displacement-warp-canonical-fidelity-v1.json");
const CANONICAL_DEGRADED = path.join(DIAG, "m6-displacement-warp-canonical-degraded-control-v1.json");
const TRANSFER_PROOF = path.join(DIAG, "m6-displacement-warp-transfer-ripple-shake-v1.json");
const PROFESSIONAL_CASE = path.join(PROFESSIONAL, "displacement_warp-ripple-shake-v1.json");
const DIRECT_AB_GENERATOR = path.join(ROOT, "scripts", "proofs", "m6-direct-ab-contact-sheet.py");

const CAPABILITIES = [
  "ae.layer.duplicate", "ae.layer.time.offset", "ae.layer.opacity.set",
  "ae.layer.transform.set", "ae.keyframe.temporal_ease.set",
  "ae.keyframe.spatial.set", "ae.effect.directional-blur",
  "ae.effect.displacement-map", "ae.effect.turbulent-displace",
  "ae.effect.echo", "ae.effect.time-displacement", "ae.precompose.layers",
  "ae.effect.exposure", "ae.effect.channel-shift", "ae.layer.blend_mode.set",
  "ae.subject.isolate", "ae.layer.matte.set", "ae.layer.order.set",
];

const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const rel = (file) => path.relative(ROOT, file).replaceAll("\\", "/");
const sha256 = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const sourceSha = (evidence) => {
  const ref = evidence.evidenceRefs?.find((item) => item.startsWith("video:sha256:"));
  return typeof ref === "string" ? ref.slice("video:sha256:".length) : null;
};

const evaluate = async (reference, correction) => {
  const finalPass = correction.passes?.at(-1);
  if (!finalPass?.evidence || correction.status !== "PASSED" || correction.certified !== true) {
    throw new Error("Correction proof is not a retained certified pass.");
  }
  const render = await load(path.resolve(ROOT, finalPass.evidence));
  const seed = await load(path.resolve(ROOT, correction.seedEvidence));
  if (reference.analyzerFingerprint !== render.analyzerFingerprint
    || reference.analyzerFingerprint !== seed.analyzerFingerprint) {
    throw new Error("Reference/render/degraded evidence lost analyzer compatibility.");
  }
  const anatomy = deriveEffectAnatomyV1(reference, "DISPLACEMENT_WARP");
  const graph = buildConstructionGraphV1(anatomy);
  const compilation = compileConstructionGraphV1(graph, CAPABILITIES);
  const comparison = compareSemanticVisualFidelityV1({
    reference, render, dna: anatomy.dna, alignment: "SEMANTIC",
  });
  const gate = evaluateProfessionalFidelityGateV1({
    comparison, compilation, synthesisPossible: true,
  });
  const degradedComparison = compareSemanticVisualFidelityV1({
    reference, render: seed, dna: anatomy.dna, alignment: "SEMANTIC",
  });
  const degradedGate = evaluateProfessionalFidelityGateV1({
    comparison: degradedComparison, compilation, synthesisPossible: true,
  });
  if (!comparison.passed || !gate.certified || gate.outcome !== "PASS") {
    throw new Error("Certified real-AE render no longer passes semantic fidelity.");
  }
  if (degradedComparison.passed || degradedGate.certified) {
    throw new Error("Deliberately degraded render was incorrectly accepted.");
  }
  return { finalPass, render, seed, anatomy, comparison, gate, degradedComparison, degradedGate };
};

await mkdir(BENCH, { recursive: true });
await mkdir(PROFESSIONAL, { recursive: true });
await copyFile(CANONICAL_SOURCE, CANONICAL_RETAINED);

const canonicalReference = await load(CANONICAL_RETAINED);
const transferReference = await load(TRANSFER_RETAINED);
const canonicalCorrection = await load(CANONICAL_CORRECTION);
const transferCorrection = await load(TRANSFER_CORRECTION);
const GENERATED_AT = transferCorrection.generatedAt;
if (typeof GENERATED_AT !== "string" || GENERATED_AT.length === 0) {
  throw new Error("Retained transfer correction proof lacks a stable generation timestamp.");
}
for (const [label, reference, correction] of [
  ["canonical", canonicalReference, canonicalCorrection],
  ["transfer", transferReference, transferCorrection],
]) {
  const immutableSourceSha = sourceSha(reference);
  if (immutableSourceSha === null
    || correction.sourceAdmission?.evidenceContentKey !== reference.contentKey
    || correction.sourceAdmission?.analyzerFingerprint !== reference.analyzerFingerprint
    || !correction.sourceAdmission?.evidenceRefs?.includes(`video:sha256:${immutableSourceSha}`)) {
    throw new Error(`Displacement ${label} correction lost its exact retained reference binding.`);
  }
}
const canonical = await evaluate(canonicalReference, canonicalCorrection);
const transfer = await evaluate(transferReference, transferCorrection);

const canonicalSourceSha = sourceSha(canonicalReference);
const transferSourceSha = sourceSha(transferReference);
if (canonicalSourceSha === null || transferSourceSha === null || canonicalSourceSha === transferSourceSha) {
  throw new Error("Displacement transfer requires materially distinct immutable professional sources.");
}
const canonicalDurationMs = canonicalReference.range.endMs - canonicalReference.range.startMs;
const transferDurationMs = transferReference.range.endMs - transferReference.range.startMs;
const durationRatio = transferDurationMs / canonicalDurationMs;
const canonicalIntensity = canonicalReference.summary.distortionPeak;
const transferIntensity = transferReference.summary.distortionPeak;
const intensityRatio = transferIntensity / canonicalIntensity;
if (Math.abs(1 - durationRatio) < 0.25 || Math.abs(1 - intensityRatio) < 0.15) {
  throw new Error("Held-out reference does not materially exercise duration and intensity transfer.");
}

const canonicalFidelity = {
  schema: "editflow.m6.known-family-fidelity-proof.v1",
  generatedAt: GENERATED_AT,
  caseId: "m6:displacement_warp:canonical",
  family: "DISPLACEMENT_WARP",
  result: "CERTIFIED",
  reference: { ref: rel(CANONICAL_RETAINED), contentKey: canonicalReference.contentKey },
  render: { ref: rel(path.resolve(ROOT, canonical.finalPass.evidence)), contentKey: canonical.render.contentKey },
  comparison: canonical.comparison,
  gate: canonical.gate,
};
await writeFile(CANONICAL_FIDELITY, JSON.stringify(canonicalFidelity, null, 2) + "\n", "utf8");

const canonicalDegraded = {
  schema: "editflow.m6.degraded-control-proof.v1",
  generatedAt: GENERATED_AT,
  caseId: "m6:displacement_warp:canonical",
  family: "DISPLACEMENT_WARP",
  result: "REJECTED",
  reference: { ref: rel(CANONICAL_RETAINED), contentKey: canonicalReference.contentKey },
  render: { ref: rel(path.resolve(ROOT, canonicalCorrection.seedEvidence)), contentKey: canonical.seed.contentKey },
  comparison: canonical.degradedComparison,
  gate: canonical.degradedGate,
};
await writeFile(CANONICAL_DEGRADED, JSON.stringify(canonicalDegraded, null, 2) + "\n", "utf8");

const transferProof = {
  schema: "editflow.m6.known-family-transfer-proof.v1",
  generatedAt: GENERATED_AT,
  caseId: "m6:displacement_warp:canonical",
  family: "DISPLACEMENT_WARP",
  result: "PASS",
  transferIdentity: {
    baselineSourceContentKey: canonicalSourceSha,
    transferSourceContentKey: transferSourceSha,
    transferAxes: ["duration", "intensity"],
    canonicalDurationMs,
    transferDurationMs,
    durationRatio,
    canonicalDistortionPeak: canonicalIntensity,
    transferDistortionPeak: transferIntensity,
    intensityRatio,
  },
  reference: { ref: rel(TRANSFER_RETAINED), contentKey: transferReference.contentKey },
  render: { ref: rel(path.resolve(ROOT, transfer.finalPass.evidence)), contentKey: transfer.render.contentKey },
  comparison: transfer.comparison,
  gate: transfer.gate,
  degradedControl: { comparison: transfer.degradedComparison, gate: transfer.degradedGate },
  automaticCorrection: {
    proofRef: rel(TRANSFER_CORRECTION),
    finalWeightedFidelity: transferCorrection.finalWeightedFidelity,
    finalDefiningCoverage: transferCorrection.finalDefiningCoverage,
    residualInvariantIds: transferCorrection.residualInvariantIds,
    developerRetuningRequired: false,
  },
};
await writeFile(TRANSFER_PROOF, JSON.stringify(transferProof, null, 2) + "\n", "utf8");

const professionalCase = {
  schema: "editflow.m6.professional-case-pass.v1",
  generatedAt: GENERATED_AT,
  result: "PASS",
  caseId: "m6:displacement_warp:canonical:professional:ripple-shake",
  family: "DISPLACEMENT_WARP",
  independence: {
    distinctProfessionalSource: true,
    canonicalSourceVideoSha256: canonicalSourceSha,
    professionalSourceVideoSha256: transferSourceSha,
  },
  reference: {
    ref: rel(TRANSFER_RETAINED),
    sha256: await sha256(TRANSFER_RETAINED),
    contentKey: transferReference.contentKey,
    sourceVideoSha256: transferSourceSha,
  },
  constructionReuse: {
    automaticSemanticCorrection: true,
    developerRetuningRequired: false,
    correctionProofRef: rel(TRANSFER_CORRECTION),
    retainedRenderRef: rel(path.resolve(ROOT, transfer.finalPass.video)),
    retainedRenderSha256: await sha256(path.resolve(ROOT, transfer.finalPass.video)),
    renderEvidenceRef: rel(path.resolve(ROOT, transfer.finalPass.evidence)),
    renderEvidenceSha256: await sha256(path.resolve(ROOT, transfer.finalPass.evidence)),
    renderContentKey: transfer.render.contentKey,
  },
  fidelity: {
    certified: true,
    definingCoverage: transfer.comparison.definingCoverage,
    weightedFidelity: transfer.comparison.weightedFidelity,
    transferProofRef: rel(TRANSFER_PROOF),
    comparison: transfer.comparison,
    gate: transfer.gate,
  },
  directAb: {
    ref: rel(TRANSFER_AB),
    sha256: await sha256(TRANSFER_AB),
    generatorRef: rel(DIRECT_AB_GENERATOR),
    generatorSha256: await sha256(DIRECT_AB_GENERATOR),
  },
  degradedControl: {
    rejected: true,
    renderEvidenceRef: rel(path.resolve(ROOT, transferCorrection.seedEvidence)),
    renderEvidenceSha256: await sha256(path.resolve(ROOT, transferCorrection.seedEvidence)),
    renderContentKey: transfer.seed.contentKey,
    comparison: transfer.degradedComparison,
    gate: transfer.degradedGate,
  },
  assertions: {
    canonicalDirectAbSha256: await sha256(CANONICAL_AB),
    transferAxesProven: ["duration", "intensity"],
    sourceIdentityDistinct: canonicalSourceSha !== transferSourceSha,
    analyzerMatched: transferReference.analyzerFingerprint === transfer.render.analyzerFingerprint,
    renderedOutputVerified: true,
    degradedControlRejected: true,
  },
};
await writeFile(PROFESSIONAL_CASE, JSON.stringify(professionalCase, null, 2) + "\n", "utf8");

console.log(JSON.stringify({
  ok: true,
  canonicalFidelity: rel(CANONICAL_FIDELITY),
  canonicalDegraded: rel(CANONICAL_DEGRADED),
  transferProof: rel(TRANSFER_PROOF),
  professionalCase: rel(PROFESSIONAL_CASE),
  canonicalWeightedFidelity: canonical.comparison.weightedFidelity,
  transferWeightedFidelity: transfer.comparison.weightedFidelity,
  durationRatio,
  intensityRatio,
  canonicalSourceSha,
  transferSourceSha,
}));