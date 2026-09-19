import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  compareSemanticVisualFidelityV1,
  compileConstructionGraphV1,
  decomposeUnknownEffectV1,
  evaluateProfessionalFidelityGateV1,
  synthesizeUnknownEffectV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const argv = process.argv.slice(2);
const required = (name) => {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) throw new Error(`Missing ${name}`);
  return path.resolve(argv[index + 1]);
};
const optional = (name) => {
  const index = argv.indexOf(name);
  return index < 0 || index + 1 >= argv.length ? null : path.resolve(argv[index + 1]);
};

const referencePath = required("--reference-evidence");
const renderPath = required("--render-evidence");
const degradedPath = optional("--degraded-render-evidence");
const outputPath = required("--output");
const capabilities = [
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

const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const relative = (file) => path.relative(process.cwd(), file).replaceAll("\\", "/");
const reference = await load(referencePath);
const render = await load(renderPath);

const anatomy = decomposeUnknownEffectV1(reference);
if (anatomy.family !== "UNKNOWN" || anatomy.dna.family !== "UNKNOWN") {
  throw new Error("Proof must withhold learned family identity and remain on UNKNOWN DNA.");
}
const synthesis = synthesizeUnknownEffectV1({
  evidence: reference,
  availableCapabilities: capabilities,
});
if (synthesis.status !== "READY_FOR_PROOF" || synthesis.selected === null) {
  throw new Error("Unknown synthesis did not produce a proofable construction.");
}
const compilation = compileConstructionGraphV1(synthesis.selected.graph, capabilities);
const comparison = compareSemanticVisualFidelityV1({
  reference,
  render,
  dna: anatomy.dna,
  alignment: "SEMANTIC",
});
const gate = evaluateProfessionalFidelityGateV1({
  comparison,
  compilation,
  synthesisPossible: true,
});

let degraded = null;
if (degradedPath !== null) {
  const degradedRender = await load(degradedPath);
  const degradedComparison = compareSemanticVisualFidelityV1({
    reference,
    render: degradedRender,
    dna: anatomy.dna,
    alignment: "SEMANTIC",
  });
  const degradedGate = evaluateProfessionalFidelityGateV1({
    comparison: degradedComparison,
    compilation,
    synthesisPossible: true,
  });
  degraded = {
    evidencePath: relative(degradedPath),
    sourceId: degradedRender.sourceId,
    comparison: degradedComparison,
    gate: degradedGate,
  };
}

const passed = gate.certified && (degraded === null || !degraded.gate.certified);
const result = {
  schema: "editflow.m6.real-pixel-unknown-synthesis-proof.v1",
  generatedAt: new Date().toISOString(),
  result: passed ? "PASS" : "FAIL",
  learnedSkillAccess: "DISABLED_BY_PROOF",
  reference: {
    evidencePath: relative(referencePath),
    sourceId: reference.sourceId,
    contentKey: reference.contentKey,
    analyzerFingerprint: reference.analyzerFingerprint,
  },
  synthesis: {
    status: synthesis.status,
    selectedCandidateId: synthesis.selected.candidateId,
    selectedStrategy: synthesis.selected.strategy,
    selectedGraphId: synthesis.selected.graph.graphId,
    selectedFamily: synthesis.selected.graph.family,
    definingInvariantIds: anatomy.dna.definingInvariants.map((item) => item.invariantId),
    optionalInvariantIds: anatomy.dna.optionalInvariants.map((item) => item.invariantId),
    candidateStrategies: synthesis.candidates.map((item) => ({
      candidateId: item.candidateId,
      strategy: item.strategy,
      capabilityGaps: item.capabilityGaps,
      adaptiveCapabilityProposals: item.adaptiveCapabilityProposals,
    })),
  },
  reconstruction: {
    evidencePath: relative(renderPath),
    sourceId: render.sourceId,
    comparison,
    gate,
  },
  degradedControl: degraded,
  evidenceBoundary: [
    "The learned effect-family identity is intentionally withheld; construction begins from dense observed behavior.",
    "The selected graph remains family UNKNOWN and is compiled only from available proof-backed primitives.",
    "Certification comes from analyzer-matched rendered pixels, not candidate selection or AE command success.",
    "The reconstruction render is retained from the shutter correction actuator path; this proof does not yet establish a generic UNKNOWN graph-to-AE materializer.",
    "This is one real reference-only unknown-synthesis case; M6.8 still requires two additional substantially different real rendered cases.",
  ],
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: passed,
  output: outputPath,
  selectedStrategy: synthesis.selected.strategy,
  definingCoverage: comparison.definingCoverage,
  weightedFidelity: comparison.weightedFidelity,
  residualInvariantIds: gate.underDrivenInvariantIds,
  degradedRejected: degraded === null ? null : !degraded.gate.certified,
}));
if (!passed) process.exitCode = 2;
