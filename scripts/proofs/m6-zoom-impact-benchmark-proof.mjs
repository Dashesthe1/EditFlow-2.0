import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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
const CANONICAL_RETAINED = path.join(BENCH, "zoom_impact-canonical.json");
const CANONICAL_CORRECTION = path.join(DIAG, "m6-zoom-impact-smooth-zoom-z63-auto-correction-v2.json");
const CANONICAL_AB = path.join(DIAG, "m6-zoom-impact-canonical-direct-ab-v1.png");
const TRANSFER_RETAINED = path.join(BENCH, "zoom_impact-professional-bcc-v1.json");
const LANDSCAPE_CORRECTION = path.join(DIAG, "m6-zoom-impact-bcc-transfer-landscape-auto-v7.json");
const PORTRAIT_CORRECTION = path.join(DIAG, "m6-zoom-impact-bcc-transfer-portrait-auto-v4.json");
const LANDSCAPE_AB = path.join(DIAG, "m6-zoom-impact-bcc-transfer-landscape-direct-ab-v1.png");
const PORTRAIT_AB = path.join(DIAG, "m6-zoom-impact-bcc-transfer-portrait-direct-ab-v1.png");
const CANONICAL_FIDELITY = path.join(DIAG, "m6-zoom-impact-canonical-fidelity-v1.json");
const CANONICAL_DEGRADED = path.join(DIAG, "m6-zoom-impact-canonical-degraded-control-v1.json");
const TRANSFER_PROOF = path.join(DIAG, "m6-zoom-impact-transfer-bcc-v1.json");
const PROFESSIONAL_CASE = path.join(PROFESSIONAL, "zoom_impact-bcc-v1.json");
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
const readCanvas = async (pass) => {
  const value = await readFile(path.resolve(ROOT, pass.readback), "utf8");
  const match = value.match(/^COMP\t[^\t]+\t\d+\t(\d+)\t(\d+)\t([0-9.]+)/mu);
  if (match === null) throw new Error("Zoom transfer readback lost proof-canvas dimensions.");
  const width = Number(match[1]);
  const height = Number(match[2]);
  const frameRate = Number(match[3]);
  return { width, height, frameRate, aspectRatio: width / height };
};

const evaluate = async (reference, correction, expectedWindow, requireCanvas = false) => {
  const initialPass = correction.passes?.[0];
  const finalPass = correction.passes?.at(-1);
  if (correction.schema !== "editflow.m6.generic-native-auto-correction-proof.v1"
    || correction.requestedFamily !== "ZOOM_IMPACT"
    || correction.family !== "ZOOM_IMPACT"
    || correction.strategy !== "KNOWN_FAMILY_ZOOM_IMPACT"
    || correction.status !== "PASSED"
    || correction.certified !== true
    || correction.proofWindow?.durationMs !== expectedWindow.durationMs
    || correction.proofWindow?.eventMs !== expectedWindow.eventMs
    || correction.causalBaselineCleanupRestored !== true
    || correction.synthesisEscalation !== null
    || correction.finalDefiningCoverage !== 1
    || correction.residualInvariantIds?.length !== 0
    || initialPass?.gate?.certified !== false
    || finalPass?.source !== "real-ae-local-rerender"
    || finalPass?.transactionState !== "COMMITTED"
    || finalPass?.cleanupRestored !== true
    || finalPass?.gate?.outcome !== "PASS"
    || finalPass?.gate?.certified !== true
    || finalPass?.gate?.weakerSubstitutionDetected !== false
    || finalPass?.definingCoverage !== 1
    || !finalPass?.evidence || !finalPass?.video || !finalPass?.readback) {
    throw new Error("Zoom correction lost its retained certified real-AE boundary.");
  }
  const immutableSourceSha = sourceSha(reference);
  if (immutableSourceSha === null
    || correction.sourceAdmission?.passed !== true
    || correction.sourceAdmission?.definingCoverage !== 1
    || correction.sourceAdmission?.evidenceContentKey !== reference.contentKey
    || correction.sourceAdmission?.analyzerFingerprint !== reference.analyzerFingerprint
    || !correction.sourceAdmission?.evidenceRefs?.includes(`video:sha256:${immutableSourceSha}`)) {
    throw new Error("Zoom correction lost its exact retained professional-reference binding.");
  }
  const render = await load(path.resolve(ROOT, finalPass.evidence));
  const seed = await load(path.resolve(ROOT, correction.seedEvidence));
  if (reference.analyzerFingerprint !== render.analyzerFingerprint
    || reference.analyzerFingerprint !== seed.analyzerFingerprint
    || seed.contentKey === render.contentKey) {
    throw new Error("Zoom reference/render/degraded evidence lost analyzer or causal separation.");
  }
  const anatomy = deriveEffectAnatomyV1(reference, "ZOOM_IMPACT");
  const graph = buildConstructionGraphV1(anatomy);
  const compilation = compileConstructionGraphV1(graph, CAPABILITIES);
  const comparison = compareSemanticVisualFidelityV1({
    reference, render, dna: anatomy.dna, alignment: "SEMANTIC",
  });
  const gate = evaluateProfessionalFidelityGateV1({ comparison, compilation, synthesisPossible: true });
  const degradedComparison = compareSemanticVisualFidelityV1({
    reference, render: seed, dna: anatomy.dna, alignment: "SEMANTIC",
  });
  const degradedGate = evaluateProfessionalFidelityGateV1({
    comparison: degradedComparison, compilation, synthesisPossible: true,
  });
  if (!comparison.passed || !gate.certified || gate.outcome !== "PASS"
    || degradedComparison.passed || degradedGate.certified) {
    throw new Error("Zoom fidelity or degraded-control gate no longer fails closed.");
  }
  return {
    initialPass, finalPass, render, seed, comparison, gate,
    degradedComparison, degradedGate,
    canvas: requireCanvas ? await readCanvas(finalPass) : null,
  };
};

const canonicalReference = await load(CANONICAL_RETAINED);
const transferReference = await load(TRANSFER_RETAINED);
const canonicalCorrection = await load(CANONICAL_CORRECTION);
const landscapeCorrection = await load(LANDSCAPE_CORRECTION);
const portraitCorrection = await load(PORTRAIT_CORRECTION);
const canonical = await evaluate(canonicalReference, canonicalCorrection, { durationMs: 1600, eventMs: 1150 });
const landscape = await evaluate(
  transferReference, landscapeCorrection, { durationMs: 1000, eventMs: 500 }, true,
);
const portrait = await evaluate(
  transferReference, portraitCorrection, { durationMs: 1000, eventMs: 500 }, true,
);
const generatedAt = portraitCorrection.generatedAt;
if (typeof generatedAt !== "string" || generatedAt.length === 0) {
  throw new Error("Zoom transfer correction lacks a stable generation timestamp.");
}
const canonicalSourceSha = sourceSha(canonicalReference);
const transferSourceSha = sourceSha(transferReference);
if (canonicalSourceSha === null || transferSourceSha === null
  || canonicalSourceSha === transferSourceSha
  || canonicalReference.sourceId === transferReference.sourceId) {
  throw new Error("Zoom subject transfer requires a materially distinct immutable professional source.");
}
if (landscape.canvas.width !== 640 || landscape.canvas.height !== 360
  || portrait.canvas.width !== 360 || portrait.canvas.height !== 640
  || Math.abs(landscape.canvas.aspectRatio - portrait.canvas.aspectRatio) < 0.5) {
  throw new Error("Zoom transfer did not retain materially different landscape and portrait canvases.");
}

const canonicalFidelity = {
  schema: "editflow.m6.known-family-fidelity-proof.v1",
  generatedAt,
  caseId: "m6:zoom_impact:canonical",
  family: "ZOOM_IMPACT",
  result: "CERTIFIED",
  reference: { ref: rel(CANONICAL_RETAINED), contentKey: canonicalReference.contentKey },
  render: { ref: rel(path.resolve(ROOT, canonical.finalPass.evidence)), contentKey: canonical.render.contentKey },
  comparison: canonical.comparison,
  gate: canonical.gate,
};
await writeFile(CANONICAL_FIDELITY, JSON.stringify(canonicalFidelity, null, 2) + "\n", "utf8");

const canonicalDegraded = {
  schema: "editflow.m6.degraded-control-proof.v1",
  generatedAt,
  caseId: "m6:zoom_impact:canonical",
  family: "ZOOM_IMPACT",
  result: "REJECTED",
  reference: { ref: rel(CANONICAL_RETAINED), contentKey: canonicalReference.contentKey },
  render: { ref: rel(path.resolve(ROOT, canonicalCorrection.seedEvidence)), contentKey: canonical.seed.contentKey },
  comparison: canonical.degradedComparison,
  gate: canonical.degradedGate,
};
await writeFile(CANONICAL_DEGRADED, JSON.stringify(canonicalDegraded, null, 2) + "\n", "utf8");

const transferProof = {
  schema: "editflow.m6.known-family-transfer-proof.v1",
  generatedAt,
  caseId: "m6:zoom_impact:canonical",
  family: "ZOOM_IMPACT",
  result: "PASS",
  transferIdentity: {
    baselineSourceContentKey: canonicalSourceSha,
    transferSourceContentKey: transferSourceSha,
    baselineSourceId: canonicalReference.sourceId,
    transferSourceId: transferReference.sourceId,
    transferAxes: ["subject", "aspect-ratio"],
    landscapeCanvas: landscape.canvas,
    portraitCanvas: portrait.canvas,
  },
  reference: { ref: rel(TRANSFER_RETAINED), contentKey: transferReference.contentKey },
  renders: [{
    variant: "LANDSCAPE",
    ref: rel(path.resolve(ROOT, landscape.finalPass.evidence)),
    contentKey: landscape.render.contentKey,
    comparison: landscape.comparison,
    gate: landscape.gate,
  }, {
    variant: "PORTRAIT",
    ref: rel(path.resolve(ROOT, portrait.finalPass.evidence)),
    contentKey: portrait.render.contentKey,
    comparison: portrait.comparison,
    gate: portrait.gate,
  }],
  degradedControl: { comparison: landscape.degradedComparison, gate: landscape.degradedGate },
  automaticCorrection: {
    proofRefs: [rel(LANDSCAPE_CORRECTION), rel(PORTRAIT_CORRECTION)],
    finalWeightedFidelity: Math.min(
      landscapeCorrection.finalWeightedFidelity,
      portraitCorrection.finalWeightedFidelity,
    ),
    finalDefiningCoverage: Math.min(
      landscapeCorrection.finalDefiningCoverage,
      portraitCorrection.finalDefiningCoverage,
    ),
    residualInvariantIds: [
      ...landscapeCorrection.residualInvariantIds,
      ...portraitCorrection.residualInvariantIds,
    ],
    developerRetuningRequired: false,
  },
};
await writeFile(TRANSFER_PROOF, JSON.stringify(transferProof, null, 2) + "\n", "utf8");

const professionalCase = {
  schema: "editflow.m6.professional-case-pass.v1",
  generatedAt,
  result: "PASS",
  caseId: "m6:zoom_impact:canonical:professional:bcc",
  family: "ZOOM_IMPACT",
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
    correctionProofRefs: [rel(LANDSCAPE_CORRECTION), rel(PORTRAIT_CORRECTION)],
    variants: await Promise.all([
      ["LANDSCAPE", landscape, LANDSCAPE_AB],
      ["PORTRAIT", portrait, PORTRAIT_AB],
    ].map(async ([variant, evaluated, directAb]) => ({
      variant,
      canvas: evaluated.canvas,
      retainedRenderRef: rel(path.resolve(ROOT, evaluated.finalPass.video)),
      retainedRenderSha256: await sha256(path.resolve(ROOT, evaluated.finalPass.video)),
      renderEvidenceRef: rel(path.resolve(ROOT, evaluated.finalPass.evidence)),
      renderEvidenceSha256: await sha256(path.resolve(ROOT, evaluated.finalPass.evidence)),
      renderContentKey: evaluated.render.contentKey,
      directAbRef: rel(directAb),
      directAbSha256: await sha256(directAb),
    }))),
  },
  fidelity: {
    certified: true,
    definingCoverage: Math.min(landscape.comparison.definingCoverage, portrait.comparison.definingCoverage),
    weightedFidelity: Math.min(landscape.comparison.weightedFidelity, portrait.comparison.weightedFidelity),
    transferProofRef: rel(TRANSFER_PROOF),
    comparisons: [landscape.comparison, portrait.comparison],
    gates: [landscape.gate, portrait.gate],
  },
  directAb: {
    ref: rel(LANDSCAPE_AB),
    sha256: await sha256(LANDSCAPE_AB),
    portraitRef: rel(PORTRAIT_AB),
    portraitSha256: await sha256(PORTRAIT_AB),
    generatorRef: rel(DIRECT_AB_GENERATOR),
    generatorSha256: await sha256(DIRECT_AB_GENERATOR),
  },
  degradedControl: {
    rejected: true,
    renderEvidenceRef: rel(path.resolve(ROOT, landscapeCorrection.seedEvidence)),
    renderEvidenceSha256: await sha256(path.resolve(ROOT, landscapeCorrection.seedEvidence)),
    renderContentKey: landscape.seed.contentKey,
    comparison: landscape.degradedComparison,
    gate: landscape.degradedGate,
  },
  assertions: {
    canonicalDirectAbSha256: await sha256(CANONICAL_AB),
    transferAxesProven: ["subject", "aspect-ratio"],
    sourceIdentityDistinct: canonicalSourceSha !== transferSourceSha,
    analyzerMatched: transferReference.analyzerFingerprint === landscape.render.analyzerFingerprint
      && transferReference.analyzerFingerprint === portrait.render.analyzerFingerprint,
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
  landscapeWeightedFidelity: landscape.comparison.weightedFidelity,
  portraitWeightedFidelity: portrait.comparison.weightedFidelity,
  transferAxes: transferProof.transferIdentity.transferAxes,
  canonicalSourceSha,
  transferSourceSha,
}));
