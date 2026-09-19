import type {
  ConstructionGraphV1,
  M6ProductionRequestV1,
  M6ProductionResultV1,
  SemanticPatchV1,
  TransitionDnaV1,
  UnknownEffectSynthesisV1,
} from "./contracts.js";
import { classifyEffectFamilyV1, deriveEffectAnatomyV1 } from "./anatomy.js";
import { buildConstructionGraphV1, compileConstructionGraphV1 } from "./construction.js";
import { applySemanticPatchesV1, runAutomaticVisualCorrectionLoopV1 } from "./correction.js";
import { decomposeUnknownEffectV1, synthesizeUnknownEffectV1 } from "./synthesis.js";

export class VisualCorrectionMemoryV1 {
  readonly #patches = new Map<string, readonly SemanticPatchV1[]>();

  constructor(snapshot: Readonly<Record<string, readonly SemanticPatchV1[]>> = {}) {
    for (const [family, patches] of Object.entries(snapshot)) {
      if (family.trim().length > 0 && patches.length > 0) {
        this.#patches.set(family, structuredClone(patches));
      }
    }
  }

  remember(family: string, patches: readonly SemanticPatchV1[]): void {
    if (patches.length > 0) this.#patches.set(family, structuredClone(patches));
  }

  recall(family: string): readonly SemanticPatchV1[] {
    return structuredClone(this.#patches.get(family) ?? []);
  }

  snapshot(): Readonly<Record<string, readonly SemanticPatchV1[]>> {
    return Object.fromEntries([...this.#patches].map(([family, patches]) =>
      [family, structuredClone(patches)]));
  }
}

export class VisualEffectsBrainV1 {
  readonly correctionMemory: VisualCorrectionMemoryV1;

  constructor(correctionMemory = new VisualCorrectionMemoryV1()) {
    this.correctionMemory = correctionMemory;
  }

  async run(request: M6ProductionRequestV1): Promise<M6ProductionResultV1> {
    if (request.risk === "LOW" && request.learnedTechniqueId !== undefined
      && request.learnedGraph !== undefined) {
      const compilation = compileConstructionGraphV1(request.learnedGraph, request.availableCapabilities);
      if (compilation.recipe === null) {
        return {
          schema: "editflow.m6-production-result.v1",
          route: "FAIL_CLOSED",
          status: "CAPABILITY_GAP",
          correction: null,
          synthesis: null,
          evidenceRefs: request.evidenceRefs,
        };
      }
      await request.applyGraph(request.learnedGraph);
      return {
        schema: "editflow.m6-production-result.v1",
        route: "FAST_PATH",
        status: "COMPLETED",
        correction: null,
        synthesis: null,
        evidenceRefs: request.evidenceRefs,
      };
    }

    const reference = request.referenceEvidence;
    if (reference === undefined) {
      return {
        schema: "editflow.m6-production-result.v1",
        route: "FAIL_CLOSED",
        status: "FIDELITY_FAILED",
        correction: null,
        synthesis: null,
        evidenceRefs: request.evidenceRefs,
      };
    }

    const family = classifyEffectFamilyV1(reference);
    let graph: ConstructionGraphV1;
    let synthesis: UnknownEffectSynthesisV1 | null = null;
    let dna: TransitionDnaV1;
    if (family === "UNKNOWN") {
      synthesis = synthesizeUnknownEffectV1({ evidence: reference, availableCapabilities: request.availableCapabilities });
      if (synthesis.selected === null) {
        return {
          schema: "editflow.m6-production-result.v1",
          route: "FAIL_CLOSED",
          status: "CAPABILITY_GAP",
          correction: null,
          synthesis,
          evidenceRefs: [...new Set([...request.evidenceRefs, ...synthesis.provenance])],
        };
      }
      graph = synthesis.selected.graph;
      dna = decomposeUnknownEffectV1(reference).dna;
    } else {
      const anatomy = deriveEffectAnatomyV1(reference, family);
      graph = buildConstructionGraphV1(anatomy);
      dna = anatomy.dna;
    }

    const memoryKey = family === "UNKNOWN" ? dna.dnaId : family;
    graph = applySemanticPatchesV1(graph, this.correctionMemory.recall(memoryKey));
    const correction = await runAutomaticVisualCorrectionLoopV1({
      reference,
      dna,
      initialGraph: graph,
      availableCapabilities: request.availableCapabilities,
      applyGraph: request.applyGraph,
      renderLocalWindow: request.renderWindow,
      maxIterations: 3,
    });
    if (correction.status === "PASSED") this.correctionMemory.remember(memoryKey, correction.learnedPatches);
    return {
      schema: "editflow.m6-production-result.v1",
      route: correction.status === "CAPABILITY_GAP" ? "FAIL_CLOSED" : "VISUAL_INTELLIGENCE",
      status: correction.status === "PASSED"
        ? "COMPLETED" : correction.status === "CAPABILITY_GAP"
          ? "CAPABILITY_GAP" : "FIDELITY_FAILED",
      correction,
      synthesis,
      evidenceRefs: [...new Set([
        ...request.evidenceRefs,
        ...reference.evidenceRefs,
        ...correction.passes.flatMap((pass) => [pass.comparison.renderEvidenceKey]),
      ])],
    };
  }
}
