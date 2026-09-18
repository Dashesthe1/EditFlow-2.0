export const TEST_IMPACT_NODE_KINDS = [
  "CODE",
  "CAPABILITY",
  "RECIPE",
  "SKILL",
  "TUTORIAL",
  "BENCHMARK",
  "PROOF",
] as const;
export type TestImpactNodeKindV1 = (typeof TEST_IMPACT_NODE_KINDS)[number];

export interface TestImpactNodeV1 {
  readonly id: string;
  readonly kind: TestImpactNodeKindV1;
}

export interface TestImpactEdgeV1 {
  readonly from: string;
  readonly to: string;
}

export interface TestImpactAnalysisV1 {
  readonly changedNodeIds: readonly string[];
  readonly affectedNodeIds: readonly string[];
  readonly affectedProofIds: readonly string[];
  readonly unmappedChangedIds: readonly string[];
  readonly requiresBroadValidation: boolean;
}

const requireId = (id: string, field: string): void => {
  if (id.trim().length === 0) throw new TypeError(`${field} must not be empty.`);
};

export class TestImpactGraphV1 {
  readonly nodes: ReadonlyMap<string, TestImpactNodeV1>;
  readonly edges: readonly TestImpactEdgeV1[];
  readonly #outgoing: ReadonlyMap<string, readonly string[]>;

  constructor(nodes: readonly TestImpactNodeV1[], edges: readonly TestImpactEdgeV1[]) {
    const nodeMap = new Map<string, TestImpactNodeV1>();
    for (const node of nodes) {
      requireId(node.id, "Test impact node id");
      if (nodeMap.has(node.id)) throw new TypeError(`Duplicate test impact node '${node.id}'.`);
      nodeMap.set(node.id, structuredClone(node));
    }
    const outgoing = new Map<string, string[]>();
    for (const edge of edges) {
      requireId(edge.from, "Test impact edge from");
      requireId(edge.to, "Test impact edge to");
      if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) {
        throw new TypeError(`Test impact edge '${edge.from}' -> '${edge.to}' references an unknown node.`);
      }
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    }
    this.nodes = nodeMap;
    this.edges = structuredClone(edges);
    this.#outgoing = new Map([...outgoing].map(([id, targets]) =>
      [id, [...new Set(targets)].sort()] as const));
  }

  analyze(changedIds: readonly string[]): TestImpactAnalysisV1 {
    const uniqueChanged = [...new Set(changedIds)];
    const mapped = uniqueChanged.filter((id) => this.nodes.has(id));
    const unmapped = uniqueChanged.filter((id) => !this.nodes.has(id));
    const affected = new Set<string>();
    const queue = [...mapped];
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined || affected.has(id)) continue;
      affected.add(id);
      for (const target of this.#outgoing.get(id) ?? []) {
        if (!affected.has(target)) queue.push(target);
      }
    }
    const affectedNodeIds = [...affected].sort();
    const affectedProofIds = affectedNodeIds.filter((id) => this.nodes.get(id)?.kind === "PROOF");
    return {
      changedNodeIds: uniqueChanged,
      affectedNodeIds,
      affectedProofIds,
      unmappedChangedIds: unmapped,
      requiresBroadValidation: unmapped.length > 0,
    };
  }
}
