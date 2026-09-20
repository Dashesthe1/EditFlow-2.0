import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareSemanticVisualFidelityV1,
  compileConstructionGraphV1,
  decomposeUnknownEffectV1,
  evaluateProfessionalFidelityGateV1,
  measureHalfPeakTemporalProfileV1,
  synthesizeUnknownEffectV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REFERENCE = path.join(ROOT, "proofs", "diagnostics", "m6-unknown-case02-reference-evidence.json");
const BASELINE = path.join(ROOT, "proofs", "diagnostics", "m6-native-directional-blur-baseline-evidence.json");
const EFFECTED = path.join(ROOT, "proofs", "diagnostics", "m6-native-directional-blur-effected-evidence.json");
const SCHEMA_PROOF = path.join(ROOT, "proofs", "diagnostics", "m6-native-directional-blur-effect-schema-proof.json");
const OUTPUT = path.join(ROOT, "proofs", "diagnostics", "m6-unknown-case02-professional-proof.json");

const CAPABILITIES = ["ae.effect.directional-blur"];
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const reference = await readJson(REFERENCE);
const baseline = await readJson(BASELINE);
const effected = await readJson(EFFECTED);
const schemaProof = await readJson(SCHEMA_PROOF);

if (schemaProof.result !== "PASS") {
  throw new Error("Directional Blur native schema proof is not PASS.");
}
if (reference.analyzerFingerprint !== baseline.analyzerFingerprint
  || reference.analyzerFingerprint !== effected.analyzerFingerprint) {
  throw new Error("Case-02 proof requires reference/baseline/effected evidence from one analyzer fingerprint.");
}

const anatomy = decomposeUnknownEffectV1(reference);
const synthesis = synthesizeUnknownEffectV1({
  evidence: reference,
  availableCapabilities: CAPABILITIES,
});
if (synthesis.selected === null) throw new Error("Case-02 synthesis produced no construction.");
if (synthesis.selected.strategy !== "LAYERED_PRIMITIVES") {
  throw new Error("Case-02 must be reconstructed from observed primitives, not a nearest-known effect fallback.");
}
const compilation = compileConstructionGraphV1(synthesis.selected.graph, CAPABILITIES);
if (compilation.recipe === null || compilation.capabilityGaps.length > 0) {
  throw new Error("Case-02 construction did not compile without capability gaps.");
}
const degradedComparison = compareSemanticVisualFidelityV1({
  reference,
  render: baseline,
  dna: anatomy.dna,
});
const degradedGate = evaluateProfessionalFidelityGateV1({
  comparison: degradedComparison,
  compilation,
  synthesisPossible: true,
});
if (degradedComparison.passed || degradedGate.certified) {
  throw new Error("Case-02 degraded control was incorrectly accepted.");
}

const comparison = compareSemanticVisualFidelityV1({
  reference,
  render: effected,
  dna: anatomy.dna,
});
const gate = evaluateProfessionalFidelityGateV1({
  comparison,
  compilation,
  synthesisPossible: true,
});
if (!comparison.passed || !gate.certified || gate.outcome !== "PASS") {
  throw new Error("Case-02 reconstructed render did not pass professional reference fidelity.");
}

const sourceVideoRef = reference.evidenceRefs.find((ref) => ref.startsWith("video:sha256:")) ?? null;
const proof = {
  schema: "editflow.m6.unknown-case-professional-proof.v1",
  generatedAt: new Date().toISOString(),
  result: "PASS",
  caseId: "m6-unknown-case02-directional-blur",
  evidenceClass: "REFERENCE_ONLY_UNKNOWN_EFFECT_RECONSTRUCTION",
  reference: {
    contentKey: reference.contentKey,
    analyzerFingerprint: reference.analyzerFingerprint,
    sourceVideoRef,
    range: reference.range,
    evidenceRefs: reference.evidenceRefs,
    blurProfile: measureHalfPeakTemporalProfileV1(reference, "blurStrength"),
  },
  reconstruction: {
    candidateId: synthesis.selected.candidateId,
    strategy: synthesis.selected.strategy,
    graph: synthesis.selected.graph,
    definingCoverageComplete: compilation.definingCoverageComplete,
    capabilityGaps: compilation.capabilityGaps,
  },
  nativeSchemaProof: {
    path: "proofs/diagnostics/m6-native-directional-blur-effect-schema-proof.json",
    result: schemaProof.result,
    transactionState: schemaProof.transaction?.state ?? null,
    expected: schemaProof.expected,
    observed: schemaProof.observed,
    renderedAb: schemaProof.renderedAb,
  },
  degradedControl: {
    renderEvidenceKey: baseline.contentKey,
    comparison: degradedComparison,
    gate: degradedGate,
  },
  reconstructedRender: {
    renderEvidenceKey: effected.contentKey,
    analyzerFingerprint: effected.analyzerFingerprint,
    blurProfile: measureHalfPeakTemporalProfileV1(effected, "blurStrength"),
    comparison,
    gate,
  },
  boundary: {
    established: [
      "The current analyzer decomposes this held professional reference as an unknown optical blur construction without a learned transition-name fallback.",
      "The certified native Directional Blur mapping is exercised through the normal layered-primitives construction path in live After Effects.",
      "A deliberately degraded no-effect control is rejected while the reconstructed live render passes the defining semantic fidelity contract.",
    ],
    notEstablished: [
      "Transfer verification on materially different footage.",
      "Professional Fidelity Level 6 across multiple professional cases.",
      "Robustness across subject, aspect ratio, FPS, motion, duration, and intensity.",
      "Completion of the M6.8 three-unknown-effect proof gate or the M6.9 benchmark gate.",
    ],
  },
};

await writeFile(OUTPUT, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  output: OUTPUT,
  caseId: proof.caseId,
  definingInvariants: anatomy.dna.definingInvariants.map((item) => item.invariantId),
  degradedOutcome: degradedGate.outcome,
  reconstructedOutcome: gate.outcome,
  weightedFidelity: comparison.weightedFidelity,
}));
