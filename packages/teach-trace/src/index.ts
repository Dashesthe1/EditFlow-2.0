import {
  canonicalStringify,
  sha256Hex,
} from "../../fingerprints/src/index.js";
import {
  simulateVirtualAeV1,
  type VirtualAeOperationV1,
  type VirtualAeProjectV1,
  type VirtualAePropertyV1,
} from "../../virtual-ae/src/index.js";

export const TEACH_TRACE_SOURCE_KINDS_V1 = [
  "TUTORIAL_RECONSTRUCTION",
  "TRANSFER_PROOF",
  "HUMAN_TEACH",
  "AUTONOMOUS_EDIT",
  "PROOF",
] as const;
export type TeachTraceSourceKindV1 = (typeof TEACH_TRACE_SOURCE_KINDS_V1)[number];

export interface TeachTraceSourceV1 {
  readonly kind: TeachTraceSourceKindV1;
  readonly referenceId: string;
  readonly notes?: string;
}

export const SEMANTIC_DELTA_ENTITY_KINDS_V1 = [
  "PROJECT_FIELD",
  "COMPOSITION",
  "COMPOSITION_ORDER",
  "LAYER",
  "LAYER_ORDER",
  "PROPERTY",
  "KEYFRAME",
  "EFFECT",
  "EFFECT_ORDER",
  "EFFECT_PROPERTY",
  "EFFECT_KEYFRAME",
  "MASK",
  "MASK_ORDER",
  "RELATION",
] as const;
export type SemanticDeltaEntityKindV1 =
  (typeof SEMANTIC_DELTA_ENTITY_KINDS_V1)[number];

export type SemanticDeltaChangeKindV1 = "ADDED" | "REMOVED" | "CHANGED";

export interface SemanticDeltaChangeV1 {
  readonly path: string;
  readonly entityKind: SemanticDeltaEntityKindV1;
  readonly change: SemanticDeltaChangeKindV1;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface VirtualAeSemanticDeltaV1 {
  readonly schema: "editflow.virtual-ae.semantic-delta.v1";
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly changeCount: number;
  readonly changes: readonly SemanticDeltaChangeV1[];
}

export interface TeachTraceV1 {
  readonly schema: "editflow.teach-trace.v1";
  readonly traceId: string;
  readonly source: TeachTraceSourceV1;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly operationHash: string;
  readonly deltaHash: string;
  readonly replayable: boolean;
  readonly before: VirtualAeProjectV1;
  readonly after: VirtualAeProjectV1;
  readonly operations: readonly VirtualAeOperationV1[];
  readonly delta: VirtualAeSemanticDeltaV1;
}

export type TeachTraceReplayStatusV1 =
  | "PASS"
  | "BASELINE_MISMATCH"
  | "NO_REPLAY_OPERATIONS"
  | "SIMULATION_FAILED"
  | "FINAL_STATE_MISMATCH"
  | "DELTA_MISMATCH";

export interface TeachTraceReplayResultV1 {
  readonly schema: "editflow.teach-trace-replay-result.v1";
  readonly traceId: string;
  readonly status: TeachTraceReplayStatusV1;
  readonly expectedBeforeHash: string;
  readonly actualBeforeHash: string;
  readonly expectedAfterHash: string;
  readonly actualAfterHash: string | null;
  readonly expectedDeltaHash: string;
  readonly actualDeltaHash: string | null;
  readonly errors: readonly string[];
}

export interface TeachTraceIntegrityV1 {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface TeachTraceRegressionContractV1 {
  readonly schema: "editflow.teach-trace-regression.v1";
  readonly traceId: string;
  readonly source: TeachTraceSourceV1;
  readonly expectedBeforeHash: string;
  readonly expectedAfterHash: string;
  readonly expectedDeltaHash: string;
  readonly expectedOperationHash: string;
  readonly operationCount: number;
  readonly requiredChangePaths: readonly string[];
  readonly requiredEntityKinds: readonly SemanticDeltaEntityKindV1[];
}

export class TeachTraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeachTraceError";
  }
}

interface FlatEntryV1 {
  readonly entityKind: SemanticDeltaEntityKindV1;
  readonly value: unknown;
}

const clone = <T>(value: T): T => structuredClone(value);
const enc = (value: string): string => encodeURIComponent(value);
const hash = (prefix: string, value: unknown): string =>
  prefix + ":sha256:" + sha256Hex(value);

export const hashVirtualAeSemanticStateV1 = (
  project: VirtualAeProjectV1,
): string => hash("virtual-ae", project);

export const hashVirtualAeOperationsV1 = (
  operations: readonly VirtualAeOperationV1[],
): string => hash("operations", operations);

export const hashVirtualAeSemanticDeltaV1 = (
  delta: VirtualAeSemanticDeltaV1,
): string => hash("delta", delta);

const put = (
  map: Map<string, FlatEntryV1>,
  path: string,
  entityKind: SemanticDeltaEntityKindV1,
  value: unknown,
): void => {
  if (map.has(path)) {
    throw new TeachTraceError("Duplicate semantic path '" + path + "'.");
  }
  canonicalStringify(value);
  map.set(path, { entityKind, value: clone(value) });
};

const flattenProperty = (
  map: Map<string, FlatEntryV1>,
  base: string,
  property: VirtualAePropertyV1,
  propertyKind: "PROPERTY" | "EFFECT_PROPERTY",
  keyframeKind: "KEYFRAME" | "EFFECT_KEYFRAME",
): void => {
  const path = base + "/property:" + enc(property.path);
  put(map, path, propertyKind, { path: property.path });
  if (property.value !== undefined) {
    put(map, path + "/value", propertyKind, property.value);
  }
  if (property.expression !== undefined) {
    put(map, path + "/expression", propertyKind, property.expression);
  }
  for (const keyframe of property.keyframes) {
    put(
      map,
      path + "/keyframe:" + String(keyframe.timeMs),
      keyframeKind,
      { timeMs: keyframe.timeMs, value: keyframe.value },
    );
  }
};

const flattenProject = (
  project: VirtualAeProjectV1,
): Map<string, FlatEntryV1> => {
  canonicalStringify(project);
  const map = new Map<string, FlatEntryV1>();
  if (project.activeCompId !== undefined) {
    put(map, "project/active-comp", "PROJECT_FIELD", project.activeCompId);
  }
  put(
    map,
    "project/composition-order",
    "COMPOSITION_ORDER",
    project.compositions.map((comp) => comp.compId),
  );

  for (const comp of project.compositions) {
    const compPath = "comp:" + enc(comp.compId);
    put(map, compPath, "COMPOSITION", {
      compId: comp.compId,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      durationMs: comp.durationMs,
      frameRate: comp.frameRate,
    });
    put(
      map,
      compPath + "/layer-order",
      "LAYER_ORDER",
      comp.layers.map((layer) => layer.layerId),
    );

    for (const layer of comp.layers) {
      const layerPath = compPath + "/layer:" + enc(layer.layerId);
      put(map, layerPath, "LAYER", {
        layerId: layer.layerId,
        name: layer.name,
        kind: layer.kind,
        inMs: layer.inMs,
        outMs: layer.outMs,
        ...(layer.sourceRef === undefined ? {} : { sourceRef: layer.sourceRef }),
      });
      if (layer.parentLayerId !== undefined) {
        put(map, layerPath + "/parent", "RELATION", layer.parentLayerId);
      }
      if (layer.matteLayerId !== undefined) {
        put(map, layerPath + "/matte", "RELATION", layer.matteLayerId);
      }
      for (const property of layer.properties) {
        flattenProperty(map, layerPath, property, "PROPERTY", "KEYFRAME");
      }

      put(
        map,
        layerPath + "/effect-order",
        "EFFECT_ORDER",
        layer.effects.map((effect) => effect.effectId),
      );
      for (const effect of layer.effects) {
        const effectPath = layerPath + "/effect:" + enc(effect.effectId);
        put(map, effectPath, "EFFECT", {
          effectId: effect.effectId,
          matchName: effect.matchName,
        });
        for (const property of effect.properties) {
          flattenProperty(
            map,
            effectPath,
            property,
            "EFFECT_PROPERTY",
            "EFFECT_KEYFRAME",
          );
        }
      }

      put(
        map,
        layerPath + "/mask-order",
        "MASK_ORDER",
        layer.masks.map((mask) => mask.maskId),
      );
      for (const mask of layer.masks) {
        put(
          map,
          layerPath + "/mask:" + enc(mask.maskId),
          "MASK",
          {
            maskId: mask.maskId,
            mode: mask.mode,
            closed: mask.closed,
          },
        );
      }
    }
  }
  return map;
};

const changeEntry = (
  path: string,
  entityKind: SemanticDeltaEntityKindV1,
  change: SemanticDeltaChangeKindV1,
  before: FlatEntryV1 | undefined,
  after: FlatEntryV1 | undefined,
): SemanticDeltaChangeV1 => ({
  path,
  entityKind,
  change,
  ...(before === undefined ? {} : { before: clone(before.value) }),
  ...(after === undefined ? {} : { after: clone(after.value) }),
});

export const diffVirtualAeProjectsV1 = (
  before: VirtualAeProjectV1,
  after: VirtualAeProjectV1,
): VirtualAeSemanticDeltaV1 => {
  const beforeHash = hashVirtualAeSemanticStateV1(before);
  const afterHash = hashVirtualAeSemanticStateV1(after);
  const beforeMap = flattenProject(before);
  const afterMap = flattenProject(after);
  const paths = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
  const changes: SemanticDeltaChangeV1[] = [];

  for (const path of paths) {
    const left = beforeMap.get(path);
    const right = afterMap.get(path);
    if (left === undefined && right !== undefined) {
      changes.push(changeEntry(path, right.entityKind, "ADDED", undefined, right));
      continue;
    }
    if (left !== undefined && right === undefined) {
      changes.push(changeEntry(path, left.entityKind, "REMOVED", left, undefined));
      continue;
    }
    if (left === undefined || right === undefined) continue;
    if (left.entityKind !== right.entityKind) {
      throw new TeachTraceError(
        "Semantic entity kind changed at stable path '" + path + "'.",
      );
    }
    if (canonicalStringify(left.value) !== canonicalStringify(right.value)) {
      changes.push(changeEntry(path, left.entityKind, "CHANGED", left, right));
    }
  }

  return {
    schema: "editflow.virtual-ae.semantic-delta.v1",
    beforeHash,
    afterHash,
    changeCount: changes.length,
    changes,
  };
};

const validateSource = (source: TeachTraceSourceV1): void => {
  if (!TEACH_TRACE_SOURCE_KINDS_V1.includes(source.kind)) {
    throw new TeachTraceError("Teach trace source kind is invalid.");
  }
  if (source.referenceId.trim().length === 0) {
    throw new TeachTraceError("Teach trace source referenceId must not be empty.");
  }
  if (source.notes !== undefined && source.notes.trim().length === 0) {
    throw new TeachTraceError(
      "Teach trace source notes must not be empty when provided.",
    );
  }
};

const traceIdentity = (
  source: TeachTraceSourceV1,
  beforeHash: string,
  afterHash: string,
  operationHash: string,
  deltaHash: string,
): string => hash("trace", {
  source,
  beforeHash,
  afterHash,
  operationHash,
  deltaHash,
});

export const createTeachTraceFromSnapshotsV1 = (
  source: TeachTraceSourceV1,
  beforeInput: VirtualAeProjectV1,
  afterInput: VirtualAeProjectV1,
  operationsInput: readonly VirtualAeOperationV1[] = [],
): TeachTraceV1 => {
  validateSource(source);
  const before = clone(beforeInput);
  const after = clone(afterInput);
  const operations = clone(operationsInput);
  const delta = diffVirtualAeProjectsV1(before, after);
  const operationHash = hashVirtualAeOperationsV1(operations);
  const deltaHash = hashVirtualAeSemanticDeltaV1(delta);
  if (operations.length > 0) {
    const simulation = simulateVirtualAeV1(before, operations);
    if (!simulation.valid) {
      throw new TeachTraceError(
        "Recorded operations are not replayable: " + simulation.errors.join(" | "),
      );
    }
    const replayDelta = diffVirtualAeProjectsV1(before, simulation.project);
    const replayDeltaHash = hashVirtualAeSemanticDeltaV1(replayDelta);
    if (
      replayDelta.afterHash !== delta.afterHash
      || replayDeltaHash !== deltaHash
    ) {
      throw new TeachTraceError(
        "Recorded operations do not reproduce the recorded semantic after-state.",
      );
    }
  }
  const traceId = traceIdentity(
    source,
    delta.beforeHash,
    delta.afterHash,
    operationHash,
    deltaHash,
  );

  return {
    schema: "editflow.teach-trace.v1",
    traceId,
    source: clone(source),
    beforeHash: delta.beforeHash,
    afterHash: delta.afterHash,
    operationHash,
    deltaHash,
    replayable: operations.length > 0,
    before,
    after,
    operations,
    delta,
  };
};

export const createTeachTraceFromProgramV1 = (
  source: TeachTraceSourceV1,
  before: VirtualAeProjectV1,
  operations: readonly VirtualAeOperationV1[],
): TeachTraceV1 => {
  const simulation = simulateVirtualAeV1(before, operations);
  if (!simulation.valid) {
    throw new TeachTraceError(
      "Cannot trace invalid program: " + simulation.errors.join(" | "),
    );
  }
  return createTeachTraceFromSnapshotsV1(
    source,
    before,
    simulation.project,
    operations,
  );
};

const replayResult = (
  trace: TeachTraceV1,
  status: TeachTraceReplayStatusV1,
  actualBeforeHash: string,
  actualAfterHash: string | null,
  actualDeltaHash: string | null,
  errors: readonly string[] = [],
): TeachTraceReplayResultV1 => ({
  schema: "editflow.teach-trace-replay-result.v1",
  traceId: trace.traceId,
  status,
  expectedBeforeHash: trace.beforeHash,
  actualBeforeHash,
  expectedAfterHash: trace.afterHash,
  actualAfterHash,
  expectedDeltaHash: trace.deltaHash,
  actualDeltaHash,
  errors: clone(errors),
});

export const replayTeachTraceV1 = (
  trace: TeachTraceV1,
  initial: VirtualAeProjectV1 = trace.before,
): TeachTraceReplayResultV1 => {
  const actualBeforeHash = hashVirtualAeSemanticStateV1(initial);
  if (actualBeforeHash !== trace.beforeHash) {
    return replayResult(
      trace,
      "BASELINE_MISMATCH",
      actualBeforeHash,
      null,
      null,
      ["Replay baseline does not match recorded semantic state."],
    );
  }
  if (trace.operations.length === 0) {
    return replayResult(
      trace,
      "NO_REPLAY_OPERATIONS",
      actualBeforeHash,
      null,
      null,
      ["Trace contains no recorded operations to replay."],
    );
  }

  const simulation = simulateVirtualAeV1(initial, trace.operations);
  if (!simulation.valid) {
    return replayResult(
      trace,
      "SIMULATION_FAILED",
      actualBeforeHash,
      null,
      null,
      simulation.errors,
    );
  }

  const actualDelta = diffVirtualAeProjectsV1(initial, simulation.project);
  const actualAfterHash = actualDelta.afterHash;
  const actualDeltaHash = hashVirtualAeSemanticDeltaV1(actualDelta);
  if (actualAfterHash !== trace.afterHash) {
    return replayResult(
      trace,
      "FINAL_STATE_MISMATCH",
      actualBeforeHash,
      actualAfterHash,
      actualDeltaHash,
      ["Replay produced a different final semantic state."],
    );
  }
  if (actualDeltaHash !== trace.deltaHash) {
    return replayResult(
      trace,
      "DELTA_MISMATCH",
      actualBeforeHash,
      actualAfterHash,
      actualDeltaHash,
      ["Replay reached the final state through a different semantic delta."],
    );
  }
  return replayResult(
    trace,
    "PASS",
    actualBeforeHash,
    actualAfterHash,
    actualDeltaHash,
  );
};

export const verifyTeachTraceIntegrityV1 = (
  trace: TeachTraceV1,
): TeachTraceIntegrityV1 => {
  const errors: string[] = [];
  try {
    const rebuilt = createTeachTraceFromSnapshotsV1(
      trace.source,
      trace.before,
      trace.after,
      trace.operations,
    );
    if (trace.beforeHash !== rebuilt.beforeHash) errors.push("beforeHash mismatch.");
    if (trace.afterHash !== rebuilt.afterHash) errors.push("afterHash mismatch.");
    if (trace.operationHash !== rebuilt.operationHash) {
      errors.push("operationHash mismatch.");
    }
    if (trace.deltaHash !== rebuilt.deltaHash) errors.push("deltaHash mismatch.");
    if (trace.traceId !== rebuilt.traceId) errors.push("traceId mismatch.");
    if (canonicalStringify(trace.delta) !== canonicalStringify(rebuilt.delta)) {
      errors.push("Recorded semantic delta does not match snapshots.");
    }
    if (trace.replayable !== rebuilt.replayable) {
      errors.push("replayable flag mismatch.");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
};

export const compileTeachTraceRegressionV1 = (
  trace: TeachTraceV1,
): TeachTraceRegressionContractV1 => ({
  schema: "editflow.teach-trace-regression.v1",
  traceId: trace.traceId,
  source: clone(trace.source),
  expectedBeforeHash: trace.beforeHash,
  expectedAfterHash: trace.afterHash,
  expectedDeltaHash: trace.deltaHash,
  expectedOperationHash: trace.operationHash,
  operationCount: trace.operations.length,
  requiredChangePaths: trace.delta.changes
    .map((change) => change.path)
    .sort(),
  requiredEntityKinds: [
    ...new Set(trace.delta.changes.map((change) => change.entityKind)),
  ].sort(),
});
