import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  alignDenseEffectSequencesV1,
  buildConstructionGraphV1,
  canonicalTransitionDnaV1,
  classifyEffectFamilyV1,
  compareSemanticVisualFidelityV1,
  compileConstructionGraphV1,
  deriveConstructionActuationPlanV1,
  deriveEffectAnatomyV1,
  detectDenseEffectWindowsV1,
  evaluateProfessionalFidelityGateV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const argv = process.argv.slice(2);
const required = (name) => {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) throw new Error(`Missing ${name}`);
  return path.resolve(argv[index + 1]);
};

const passArgs = [];
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--pass" && argv[index + 1]) passArgs.push(argv[index + 1]);
}
if (passArgs.length < 2 || passArgs.length > 5) {
  throw new Error("Correction proof requires 2-5 ordered --pass label=path arguments.");
}
const referencePath = required("--reference-evidence");
const outputPath = required("--output");
const load = async (file) => JSON.parse(await readFile(file, "utf8"));
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

const referenceEvidence = await load(referencePath);
const referenceSequence = detectDenseEffectWindowsV1(referenceEvidence);
const shutterReferences = referenceSequence.windows
  .map((window, index) => ({ window, index }))
  .filter(({ window }) => classifyEffectFamilyV1(window.evidence) === "SHUTTER_FRAGMENTATION");

if (shutterReferences.length === 0) {
  throw new Error("Reference contains no proof-gated shutter windows.");
}
const comparePass = async (label, evidencePath, ordinal) => {
  const renderEvidence = await load(evidencePath);
  const renderSequence = detectDenseEffectWindowsV1(renderEvidence);
  const alignment = alignDenseEffectSequencesV1(referenceSequence, renderSequence);
  const byReference = new Map(alignment.pairs.map((pair) => [pair.referenceIndex, pair]));
  const cases = [];

  for (const { window: referenceWindow, index: referenceIndex } of shutterReferences) {
    const pair = byReference.get(referenceIndex);
    if (pair === undefined) {
      cases.push({
        referenceIndex,
        referenceWindowId: referenceWindow.windowId,
        result: "UNMATCHED",
      });
      continue;
    }
    const renderWindow = renderSequence.windows[pair.renderIndex];
    if (renderWindow === undefined) throw new Error("Alignment referenced a missing render window.");

    const dna = canonicalTransitionDnaV1("SHUTTER_FRAGMENTATION", referenceWindow.evidence.evidenceRefs);
    const anatomy = deriveEffectAnatomyV1(referenceWindow.evidence, "SHUTTER_FRAGMENTATION");
    const graph = buildConstructionGraphV1(anatomy);
    const compilation = compileConstructionGraphV1(graph, capabilities);
    const comparison = compareSemanticVisualFidelityV1({
      reference: referenceWindow.evidence,
      render: renderWindow.evidence,
      dna,
      alignment: "SEMANTIC",
    });
    const gate = evaluateProfessionalFidelityGateV1({
      comparison,
      compilation,
      synthesisPossible: true,
    });
    const actuationPlan = deriveConstructionActuationPlanV1({ graph, comparison });

    cases.push({
      referenceIndex,
      renderIndex: pair.renderIndex,
      referenceWindowId: referenceWindow.windowId,
      renderWindowId: renderWindow.windowId,
      semanticAlignmentCost: pair.semanticCost,
      renderFamily: classifyEffectFamilyV1(renderWindow.evidence),
      comparison,
      gate,
      actuationPlan,
      result: gate.certified ? "CERTIFIED" : "CORRECTION_REQUIRED",
    });
  }

  const complete = cases.filter((item) => "gate" in item);
  const averageWeightedFidelity = complete.length === 0 ? 0
    : complete.reduce((sum, item) => sum + item.comparison.weightedFidelity, 0) / complete.length;
  const averageDefiningCoverage = complete.length === 0 ? 0
    : complete.reduce((sum, item) => sum + item.comparison.definingCoverage, 0) / complete.length;
  return {
    ordinal,
    label,
    evidencePath: path.relative(process.cwd(), evidencePath).replaceAll("\\", "/"),
    renderSourceId: renderEvidence.sourceId,
    renderEvidenceKey: renderEvidence.contentKey,
    alignment,
    cases,
    averageWeightedFidelity,
    averageDefiningCoverage,
    certifiedCases: complete.filter((item) => item.gate.certified).length,
    targetCases: shutterReferences.length,
    allTargetCasesCertified: complete.length === shutterReferences.length
      && complete.every((item) => item.gate.certified),
  };
};

const passes = [];
for (const [ordinal, raw] of passArgs.entries()) {
  const split = raw.indexOf("=");
  if (split <= 0 || split === raw.length - 1) throw new Error(`Invalid --pass '${raw}'.`);
  const label = raw.slice(0, split);
  const evidencePath = path.resolve(raw.slice(split + 1));
  passes.push(await comparePass(label, evidencePath, ordinal + 1));
}
const first = passes[0];
const latest = passes.at(-1);
if (first === undefined || latest === undefined) throw new Error("Correction pass list is empty.");

const isBetterPass = (candidate, retained) => {
  if (candidate.allTargetCasesCertified !== retained.allTargetCasesCertified) {
    return candidate.allTargetCasesCertified;
  }
  if (candidate.certifiedCases !== retained.certifiedCases) {
    return candidate.certifiedCases > retained.certifiedCases;
  }
  if (Math.abs(candidate.averageDefiningCoverage - retained.averageDefiningCoverage) > 1e-9) {
    return candidate.averageDefiningCoverage > retained.averageDefiningCoverage;
  }
  return candidate.averageWeightedFidelity > retained.averageWeightedFidelity + 1e-9;
};

let retainedBest = first;
const retention = [{
  label: first.label,
  ordinal: first.ordinal,
  adopted: true,
  retainedBestLabel: first.label,
  reason: "INITIAL_STATE",
}];
for (const candidate of passes.slice(1)) {
  const adopted = isBetterPass(candidate, retainedBest);
  if (adopted) retainedBest = candidate;
  retention.push({
    label: candidate.label,
    ordinal: candidate.ordinal,
    adopted,
    retainedBestLabel: retainedBest.label,
    reason: adopted ? "FIDELITY_IMPROVED" : "REGRESSION_ROLLBACK",
  });
}

const weightedImprovement = retainedBest.averageWeightedFidelity - first.averageWeightedFidelity;
const coverageImprovement = retainedBest.averageDefiningCoverage - first.averageDefiningCoverage;
const latestWeightedDelta = latest.averageWeightedFidelity - retainedBest.averageWeightedFidelity;
const latestCoverageDelta = latest.averageDefiningCoverage - retainedBest.averageDefiningCoverage;
const residualInvariantIds = [...new Set(retainedBest.cases.flatMap((item) =>
  "gate" in item ? item.gate.underDrivenInvariantIds : ["UNMATCHED_REFERENCE_WINDOW"],
))];
const unresolvedActuationIds = [...new Set(retainedBest.cases.flatMap((item) =>
  "actuationPlan" in item ? item.actuationPlan.unresolvedInvariantIds : [],
))];
const latestResidualInvariantIds = [...new Set(latest.cases.flatMap((item) =>
  "gate" in item ? item.gate.underDrivenInvariantIds : ["UNMATCHED_REFERENCE_WINDOW"],
))];

const closed = retainedBest.allTargetCasesCertified && residualInvariantIds.length === 0
  && unresolvedActuationIds.length === 0;
const result = {
  schema: "editflow.m6.real-rendered-correction-proof.v1",
  executedAt: new Date().toISOString(),
  claim: "REAL_RENDERED_BOUNDED_CORRECTION",
  result: closed ? "PASS" : "OPEN",
  reference: {
    sourceId: referenceEvidence.sourceId,
    contentKey: referenceEvidence.contentKey,
    shutterWindowCount: shutterReferences.length,
    evidenceRefs: referenceEvidence.evidenceRefs,
  },
  bounded: passes.length <= 5,
  passes,
  retention,
  retainedBestPassLabel: retainedBest.label,
  latestAttemptLabel: latest.label,
  trend: {
    weightedImprovement,
    coverageImprovement,
    firstAverageWeightedFidelity: first.averageWeightedFidelity,
    retainedBestAverageWeightedFidelity: retainedBest.averageWeightedFidelity,
    latestAverageWeightedFidelity: latest.averageWeightedFidelity,
    firstAverageDefiningCoverage: first.averageDefiningCoverage,
    retainedBestAverageDefiningCoverage: retainedBest.averageDefiningCoverage,
    latestAverageDefiningCoverage: latest.averageDefiningCoverage,
    latestWeightedDeltaFromRetainedBest: latestWeightedDelta,
    latestCoverageDeltaFromRetainedBest: latestCoverageDelta,
  },
  finalGate: {
    semantics: "RETAINED_BEST_STATE",
    certified: closed,
    retainedBestPassLabel: retainedBest.label,
    residualInvariantIds,
    unresolvedActuationIds,
  },
  latestAttemptGate: {
    passLabel: latest.label,
    certified: latest.allTargetCasesCertified,
    residualInvariantIds: latestResidualInvariantIds,
  },
  evidenceBoundary: closed
    ? [
      "Every targeted shutter reference window is certified by the rendered professional-fidelity gate.",
      "This proof closes the bounded rendered-correction gate for these cases only.",
    ]
    : [
      "The retained passes demonstrate measured correction attempts, regression detection, rollback, and diagnostic-to-actuation planning.",
      "A regressing attempt is retained as evidence but does not replace the best proven state.",
      "M6.7 remains open until one retained rendered state certifies every targeted defining invariant.",
    ],
};

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  result: result.result,
  passes: passes.length,
  weightedImprovement,
  coverageImprovement,
  residualInvariantIds,
  retainedBestPassLabel: retainedBest.label,
  latestAttemptLabel: latest.label,
  retainedBestCertifiedCases: retainedBest.certifiedCases,
  targetCases: retainedBest.targetCases,
}));
