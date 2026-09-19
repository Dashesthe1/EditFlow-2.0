import { TestImpactGraphV1, type TestImpactAnalysisV1 } from "../../incremental-proof-engine/src/impact-graph.js";

export const M6_BASELINE_AUTHORITY_V1 = Object.freeze({
  schema: "editflow.m6-baseline-authority.v1" as const,
  baseRef: "m5-tutorial-002-stabilization-orchestration-v1",
  baseCommit: "1e0d7c7621f7b52dc26bd85b56cdb35150359958",
  retainedProofs: Object.freeze([
    "proof:tutorial-001:transfer",
    "proof:tutorial-001:sparse-visual",
    "proof:tutorial-001:short-motion",
    "proof:tutorial-002:effect-stack",
    "proof:tutorial-002:stabilization",
  ]),
  preservedPipeline: Object.freeze([
    "Editing IR",
    "Virtual AE",
    "Recipe Compiler",
    "Native AE lowering",
    "Transactional current host",
    "Rendered visual proof",
  ]),
});

export const createM6ImpactGraphV1 = (): TestImpactGraphV1 => new TestImpactGraphV1(
  [
    { id: "code:m5-editing-ir", kind: "CODE" },
    { id: "code:m5-virtual-ae", kind: "CODE" },
    { id: "code:m5-recipe-compiler", kind: "CODE" },
    { id: "code:m5-native-lowering", kind: "CODE" },
    { id: "proof:tutorial-001:transfer", kind: "PROOF" },
    { id: "proof:tutorial-002:effect-stack", kind: "PROOF" },
    { id: "proof:tutorial-002:stabilization", kind: "PROOF" },
    { id: "code:m6-dense-evidence", kind: "CODE" },
    { id: "code:m6-anatomy-dna", kind: "CODE" },
    { id: "code:m6-construction", kind: "CODE" },
    { id: "code:m6-comparator", kind: "CODE" },
    { id: "code:m6-fidelity-gate", kind: "CODE" },
    { id: "code:m6-correction", kind: "CODE" },
    { id: "code:m6-synthesis", kind: "CODE" },
    { id: "benchmark:m6-professional", kind: "BENCHMARK" },
    { id: "proof:m6:dense-evidence", kind: "PROOF" },
    { id: "proof:m6:anti-simplification", kind: "PROOF" },
    { id: "proof:m6:correction", kind: "PROOF" },
    { id: "proof:m6:synthesis", kind: "PROOF" },
    { id: "proof:m6:professional-benchmark", kind: "PROOF" },
  ],
  [
    { from: "code:m5-editing-ir", to: "proof:tutorial-001:transfer" },
    { from: "code:m5-virtual-ae", to: "proof:tutorial-001:transfer" },
    { from: "code:m5-recipe-compiler", to: "proof:tutorial-001:transfer" },
    { from: "code:m5-recipe-compiler", to: "proof:tutorial-002:effect-stack" },
    { from: "code:m5-native-lowering", to: "proof:tutorial-002:stabilization" },
    { from: "code:m6-dense-evidence", to: "proof:m6:dense-evidence" },
    { from: "code:m6-dense-evidence", to: "code:m6-anatomy-dna" },
    { from: "code:m6-anatomy-dna", to: "code:m6-construction" },
    { from: "code:m6-construction", to: "code:m6-fidelity-gate" },
    { from: "code:m6-comparator", to: "code:m6-fidelity-gate" },
    { from: "code:m6-fidelity-gate", to: "proof:m6:anti-simplification" },
    { from: "code:m6-fidelity-gate", to: "code:m6-correction" },
    { from: "code:m6-correction", to: "proof:m6:correction" },
    { from: "code:m6-synthesis", to: "proof:m6:synthesis" },
    { from: "proof:m6:anti-simplification", to: "benchmark:m6-professional" },
    { from: "proof:m6:correction", to: "benchmark:m6-professional" },
    { from: "proof:m6:synthesis", to: "benchmark:m6-professional" },
    { from: "benchmark:m6-professional", to: "proof:m6:professional-benchmark" },
  ],
);

export const analyzeM6InvalidationV1 = (changedNodeIds: readonly string[]): TestImpactAnalysisV1 =>
  createM6ImpactGraphV1().analyze(changedNodeIds);

export interface M6BaselineLockResultV1 {
  readonly locked: boolean;
  readonly invalidatedRetainedProofIds: readonly string[];
  readonly requiredM6ProofIds: readonly string[];
  readonly broadValidationRequired: boolean;
}

export const assessM6BaselineLockV1 = (
  changedNodeIds: readonly string[],
): M6BaselineLockResultV1 => {
  const impact = analyzeM6InvalidationV1(changedNodeIds);
  const retained = new Set<string>(M6_BASELINE_AUTHORITY_V1.retainedProofs);
  const invalidatedRetainedProofIds = impact.affectedProofIds.filter((id) => retained.has(id));
  return {
    locked: invalidatedRetainedProofIds.length === 0 && !impact.requiresBroadValidation,
    invalidatedRetainedProofIds,
    requiredM6ProofIds: impact.affectedProofIds.filter((id) => id.startsWith("proof:m6:")),
    broadValidationRequired: impact.requiresBroadValidation,
  };
};
