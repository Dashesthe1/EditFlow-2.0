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
const SOURCE = path.join(
  DIAG, "m6-zoom-impact-source-candidate-smooth-zoom-z63-v1-evidence.json",
);
const CORRECTION = path.join(
  DIAG, "m6-zoom-impact-smooth-zoom-z63-auto-correction-v2.json",
);
const DIRECT_AB = path.join(DIAG, "m6-zoom-impact-canonical-direct-ab-v1.png");
const RETAINED = path.join(BENCH, "zoom_impact-canonical.json");
const FIDELITY = path.join(DIAG, "m6-zoom-impact-canonical-fidelity-v1.json");
const DEGRADED = path.join(DIAG, "m6-zoom-impact-canonical-degraded-control-v1.json");

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
const sha256 = async (file) => createHash("sha256")
  .update(await readFile(file))
  .digest("hex");
const sourceSha = (evidence) => {
  const ref = evidence.evidenceRefs?.find((item) => item.startsWith("video:sha256:"));
  return typeof ref === "string" ? ref.slice("video:sha256:".length) : null;
};

await mkdir(BENCH, { recursive: true });
await copyFile(SOURCE, RETAINED);
const reference = await load(RETAINED);
const correction = await load(CORRECTION);
const sourceVideoSha256 = sourceSha(reference);
const generatedAt = correction.generatedAt;
const finalPass = correction.passes?.at(-1);
if (typeof generatedAt !== "string" || generatedAt.length === 0
  || sourceVideoSha256 === null
  || correction.schema !== "editflow.m6.generic-native-auto-correction-proof.v1"
  || correction.requestedFamily !== "ZOOM_IMPACT"
  || correction.family !== "ZOOM_IMPACT"
  || correction.strategy !== "KNOWN_FAMILY_ZOOM_IMPACT"
  || correction.status !== "PASSED"
  || correction.certified !== true
  || correction.proofWindow?.durationMs !== 1600
  || correction.proofWindow?.eventMs !== 1150
  || correction.sourceAdmission?.passed !== true
  || correction.sourceAdmission?.definingCoverage !== 1
  || correction.sourceAdmission?.evidenceContentKey !== reference.contentKey
  || correction.sourceAdmission?.analyzerFingerprint !== reference.analyzerFingerprint
  || !correction.sourceAdmission?.evidenceRefs?.includes(`video:sha256:${sourceVideoSha256}`)
  || finalPass?.source !== "real-ae-local-rerender"
  || finalPass?.transactionState !== "COMMITTED"
  || finalPass?.cleanupRestored !== true
  || finalPass?.gate?.certified !== true
  || finalPass?.gate?.weakerSubstitutionDetected !== false
  || finalPass?.definingCoverage !== 1
  || !finalPass?.evidence) {
  throw new Error("Zoom canonical correction lost its exact retained real-AE fidelity binding.");
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
const gate = evaluateProfessionalFidelityGateV1({
  comparison, compilation, synthesisPossible: true,
});
const degradedComparison = compareSemanticVisualFidelityV1({
  reference, render: seed, dna: anatomy.dna, alignment: "SEMANTIC",
});
const degradedGate = evaluateProfessionalFidelityGateV1({
  comparison: degradedComparison, compilation, synthesisPossible: true,
});
if (!comparison.passed || !gate.certified || gate.outcome !== "PASS"
  || degradedComparison.passed || degradedGate.certified) {
  throw new Error("Zoom canonical fidelity/degraded-control proof no longer satisfies fail-closed gates.");
}
const fidelity = {
  schema: "editflow.m6.known-family-fidelity-proof.v1",
  generatedAt,
  caseId: "m6:zoom_impact:canonical",
  family: "ZOOM_IMPACT",
  result: "CERTIFIED",
  reference: { ref: rel(RETAINED), contentKey: reference.contentKey },
  render: { ref: rel(path.resolve(ROOT, finalPass.evidence)), contentKey: render.contentKey },
  comparison,
  gate,
};
await writeFile(FIDELITY, JSON.stringify(fidelity, null, 2) + "\n", "utf8");

const degraded = {
  schema: "editflow.m6.degraded-control-proof.v1",
  generatedAt,
  caseId: "m6:zoom_impact:canonical",
  family: "ZOOM_IMPACT",
  result: "REJECTED",
  reference: { ref: rel(RETAINED), contentKey: reference.contentKey },
  render: { ref: rel(path.resolve(ROOT, correction.seedEvidence)), contentKey: seed.contentKey },
  comparison: degradedComparison,
  gate: degradedGate,
};
await writeFile(DEGRADED, JSON.stringify(degraded, null, 2) + "\n", "utf8");

console.log(JSON.stringify({
  ok: true,
  fidelity: rel(FIDELITY),
  degraded: rel(DEGRADED),
  directAb: rel(DIRECT_AB),
  directAbSha256: await sha256(DIRECT_AB),
  weightedFidelity: comparison.weightedFidelity,
  definingCoverage: comparison.definingCoverage,
  sourceVideoSha256,
}));