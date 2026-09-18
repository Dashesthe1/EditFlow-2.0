export const VIRTUAL_AE_LAYER_KINDS = [
  "FOOTAGE",
  "TEXT",
  "SHAPE",
  "SOLID",
  "NULL",
  "CAMERA",
  "LIGHT",
  "PRECOMP",
] as const;
export type VirtualAeLayerKindV1 = (typeof VIRTUAL_AE_LAYER_KINDS)[number];

export type VirtualAeValueV1 = unknown;

export interface VirtualAeKeyframeV1 {
  timeMs: number;
  value: VirtualAeValueV1;
}

export interface VirtualAePropertyV1 {
  path: string;
  value?: VirtualAeValueV1;
  keyframes: VirtualAeKeyframeV1[];
  expression?: string;
}
export interface VirtualAeEffectV1 {
  effectId: string;
  matchName: string;
  properties: VirtualAePropertyV1[];
}

export interface VirtualAeMaskV1 {
  maskId: string;
  mode: "ADD" | "SUBTRACT" | "INTERSECT" | "NONE";
  closed: boolean;
}

export interface VirtualAeLayerV1 {
  layerId: string;
  name: string;
  kind: VirtualAeLayerKindV1;
  sourceRef?: string;
  inMs: number;
  outMs: number;
  properties: VirtualAePropertyV1[];
  effects: VirtualAeEffectV1[];
  masks: VirtualAeMaskV1[];
  matteLayerId?: string;
  parentLayerId?: string;
}
export interface VirtualAeCompositionV1 {
  compId: string;
  name: string;
  width: number;
  height: number;
  durationMs: number;
  frameRate: number;
  layers: VirtualAeLayerV1[];
}

export interface VirtualAeProjectV1 {
  schema: "editflow.virtual-ae.project.v1";
  compositions: VirtualAeCompositionV1[];
  activeCompId?: string;
}

export type VirtualAeOperationV1 =
  | { type: "CREATE_COMP"; compId: string; name: string; width: number; height: number;
      durationMs: number; frameRate: number }
  | { type: "CREATE_LAYER"; compId: string; layerId: string; name: string;
      kind: VirtualAeLayerKindV1; inMs: number; outMs: number; sourceRef?: string }
  | { type: "DUPLICATE_LAYER"; compId: string; sourceLayerId: string; layerId: string;
      name?: string; offsetMs?: number }
  | { type: "SET_PROPERTY"; compId: string; layerId: string; propertyPath: string; value: VirtualAeValueV1 }
  | { type: "ADD_KEYFRAME"; compId: string; layerId: string; propertyPath: string;
      timeMs: number; value: VirtualAeValueV1 }
  | { type: "SET_EXPRESSION"; compId: string; layerId: string; propertyPath: string; expression: string }
  | { type: "ADD_EFFECT"; compId: string; layerId: string; effectId: string; matchName: string;
      insertAfterEffectId?: string }
  | { type: "SET_EFFECT_PROPERTY"; compId: string; layerId: string; effectId: string;
      propertyPath: string; value: VirtualAeValueV1 }
  | { type: "ADD_MASK"; compId: string; layerId: string; maskId: string;
      mode?: VirtualAeMaskV1["mode"]; closed?: boolean }
  | { type: "SET_MATTE"; compId: string; layerId: string; matteLayerId: string }
  | { type: "SET_PARENT"; compId: string; layerId: string; parentLayerId: string | null }
  | { type: "PRECOMPOSE"; compId: string; newCompId: string; newCompName: string;
      newLayerId: string; layerIds: string[] };

export interface VirtualAeSimulationV1 {
  valid: boolean;
  errors: string[];
  project: VirtualAeProjectV1;
}
export const createEmptyVirtualAeProjectV1 = (): VirtualAeProjectV1 => ({
  schema: "editflow.virtual-ae.project.v1",
  compositions: [],
});

const nonEmpty = (value: string): boolean => value.trim().length > 0;
const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

const findComp = (project: VirtualAeProjectV1, compId: string): VirtualAeCompositionV1 | undefined =>
  project.compositions.find((comp) => comp.compId === compId);

const findLayer = (comp: VirtualAeCompositionV1, layerId: string): VirtualAeLayerV1 | undefined =>
  comp.layers.find((layer) => layer.layerId === layerId);

const getOrCreateProperty = (layer: VirtualAeLayerV1, path: string): VirtualAePropertyV1 => {
  const existing = layer.properties.find((property) => property.path === path);
  if (existing) return existing;
  const property: VirtualAePropertyV1 = { path, keyframes: [] };
  layer.properties.push(property);
  return property;
};

const fail = (errors: string[], index: number, message: string): void => {
  errors.push("op[" + index + "] " + message);
};
const validateLayerTiming = (
  comp: VirtualAeCompositionV1,
  layer: Pick<VirtualAeLayerV1, "layerId" | "inMs" | "outMs">,
): string | null => {
  if (!Number.isFinite(layer.inMs) || !Number.isFinite(layer.outMs)
    || layer.inMs < 0 || layer.outMs <= layer.inMs) {
    return "layer '" + layer.layerId + "' has invalid timing";
  }
  if (layer.outMs > comp.durationMs) {
    return "layer '" + layer.layerId + "' exceeds composition duration";
  }
  return null;
};

const detectParentCycle = (comp: VirtualAeCompositionV1): string | null => {
  for (const layer of comp.layers) {
    const seen = new Set<string>([layer.layerId]);
    let parentId = layer.parentLayerId;
    while (parentId) {
      if (seen.has(parentId)) return "parent cycle includes layer '" + parentId + "'";
      seen.add(parentId);
      parentId = findLayer(comp, parentId)?.parentLayerId;
    }
  }
  return null;
};
const validateFinalState = (project: VirtualAeProjectV1, errors: string[]): void => {
  const compIds = new Set<string>();
  for (const comp of project.compositions) {
    if (compIds.has(comp.compId)) errors.push("duplicate composition '" + comp.compId + "'");
    compIds.add(comp.compId);
    const layerIds = new Set<string>();
    for (const layer of comp.layers) {
      if (layerIds.has(layer.layerId)) {
        errors.push("composition '" + comp.compId + "' duplicates layer '" + layer.layerId + "'");
      }
      layerIds.add(layer.layerId);
      const timingError = validateLayerTiming(comp, layer);
      if (timingError) errors.push(timingError);
      if (layer.parentLayerId && !findLayer(comp, layer.parentLayerId)) {
        errors.push("layer '" + layer.layerId + "' references missing parent '" + layer.parentLayerId + "'");
      }
      if (layer.matteLayerId && !findLayer(comp, layer.matteLayerId)) {
        errors.push("layer '" + layer.layerId + "' references missing matte '" + layer.matteLayerId + "'");
      }
      const effectIds = new Set<string>();
      for (const effect of layer.effects) {
        if (effectIds.has(effect.effectId)) {
          errors.push("layer '" + layer.layerId + "' duplicates effect '" + effect.effectId + "'");
        }
        effectIds.add(effect.effectId);
      }
    }
    const parentCycle = detectParentCycle(comp);
    if (parentCycle) errors.push(parentCycle);
  }
};

export const simulateVirtualAeV1 = (
  initial: VirtualAeProjectV1,
  operations: readonly VirtualAeOperationV1[],
): VirtualAeSimulationV1 => {
  const project = structuredClone(initial);
  const errors: string[] = [];

  for (const [index, operation] of operations.entries()) {
    if (operation.type === "CREATE_COMP") {
      if (findComp(project, operation.compId)) {
        fail(errors, index, "composition '" + operation.compId + "' already exists");
        continue;
      }
      if (!nonEmpty(operation.compId) || !nonEmpty(operation.name)
        || !Number.isInteger(operation.width) || operation.width <= 0
        || !Number.isInteger(operation.height) || operation.height <= 0
        || !finitePositive(operation.durationMs) || !finitePositive(operation.frameRate)) {
        fail(errors, index, "CREATE_COMP has invalid dimensions, duration, frame rate, or identifiers");
        continue;
      }
      project.compositions.push({
        compId: operation.compId,
        name: operation.name,
        width: operation.width,
        height: operation.height,
        durationMs: operation.durationMs,
        frameRate: operation.frameRate,
        layers: [],
      });
      project.activeCompId ??= operation.compId;
      continue;
    }

    const comp = findComp(project, operation.compId);
    if (!comp) {
      fail(errors, index, "composition '" + operation.compId + "' does not exist");
      continue;
    }

    if (operation.type === "CREATE_LAYER") {
      if (findLayer(comp, operation.layerId)) {
        fail(errors, index, "layer '" + operation.layerId + "' already exists");
        continue;
      }
      const timingError = validateLayerTiming(comp, operation);
      if (!nonEmpty(operation.layerId) || !nonEmpty(operation.name) || timingError) {
        fail(errors, index, timingError ?? "CREATE_LAYER requires non-empty identifiers");
        continue;
      }
      comp.layers.push({
        layerId: operation.layerId,
        name: operation.name,
        kind: operation.kind,
        inMs: operation.inMs,
        outMs: operation.outMs,
        properties: [],
        effects: [],
        masks: [],
        ...(operation.sourceRef === undefined ? {} : { sourceRef: operation.sourceRef }),
      });
      continue;
    }

    if (operation.type === "DUPLICATE_LAYER") {
      const source = findLayer(comp, operation.sourceLayerId);
      if (!source || findLayer(comp, operation.layerId)) {
        fail(errors, index, source
          ? "layer '" + operation.layerId + "' already exists"
          : "source layer '" + operation.sourceLayerId + "' does not exist");
        continue;
      }
      const offset = operation.offsetMs ?? 0;
      const duplicate = structuredClone(source);
      duplicate.layerId = operation.layerId;
      duplicate.name = operation.name ?? (source.name + " copy");
      duplicate.inMs += offset;
      duplicate.outMs += offset;
      const timingError = validateLayerTiming(comp, duplicate);
      if (timingError) {
        fail(errors, index, timingError);
        continue;
      }
      const sourceIndex = comp.layers.findIndex((candidate) => candidate.layerId === source.layerId);
      comp.layers.splice(sourceIndex + 1, 0, duplicate);
      continue;
    }

    if (operation.type === "PRECOMPOSE") {
      if (findComp(project, operation.newCompId) || !nonEmpty(operation.newLayerId)
        || operation.layerIds.length === 0 || findLayer(comp, operation.newLayerId)) {
        fail(errors, index, "PRECOMPOSE has conflicting identifiers or no source layers");
        continue;
      }
      const selected = operation.layerIds.map((id) => findLayer(comp, id));
      if (selected.some((candidate) => candidate === undefined)
        || new Set(operation.layerIds).size !== operation.layerIds.length) {
        fail(errors, index, "PRECOMPOSE references missing or duplicate source layers");
        continue;
      }
      const moved = selected as VirtualAeLayerV1[];
      const firstIndex = Math.min(...moved.map((candidate) =>
        comp.layers.findIndex((current) => current.layerId === candidate.layerId)));
      const minIn = Math.min(...moved.map((candidate) => candidate.inMs));
      const maxOut = Math.max(...moved.map((candidate) => candidate.outMs));
      const newComp: VirtualAeCompositionV1 = {
        compId: operation.newCompId,
        name: operation.newCompName,
        width: comp.width,
        height: comp.height,
        durationMs: comp.durationMs,
        frameRate: comp.frameRate,
        layers: structuredClone(moved),
      };
      project.compositions.push(newComp);
      comp.layers = comp.layers.filter(
        (candidate) => !operation.layerIds.includes(candidate.layerId),
      );
      comp.layers.splice(firstIndex, 0, {
        layerId: operation.newLayerId,
        name: operation.newCompName,
        kind: "PRECOMP",
        sourceRef: operation.newCompId,
        inMs: minIn,
        outMs: maxOut,
        properties: [],
        effects: [],
        masks: [],
      });
      continue;
    }

    const layer = findLayer(comp, operation.layerId);
    if (!layer) {
      fail(errors, index, "layer '" + operation.layerId + "' does not exist");
      continue;
    }

    if (operation.type === "SET_PROPERTY") {
      if (!nonEmpty(operation.propertyPath)) {
        fail(errors, index, "SET_PROPERTY requires propertyPath");
        continue;
      }
      getOrCreateProperty(layer, operation.propertyPath).value = structuredClone(operation.value);
      continue;
    }

    if (operation.type === "ADD_KEYFRAME") {
      if (!nonEmpty(operation.propertyPath) || !Number.isFinite(operation.timeMs)
        || operation.timeMs < layer.inMs || operation.timeMs > layer.outMs) {
        fail(errors, index, "keyframe time must fall within layer '" + layer.layerId + "' timing");
        continue;
      }
      const property = getOrCreateProperty(layer, operation.propertyPath);
      if (property.keyframes.some((keyframe) => keyframe.timeMs === operation.timeMs)) {
        fail(errors, index, "property '" + operation.propertyPath + "' already has a keyframe at "
          + operation.timeMs + "ms");
        continue;
      }
      property.keyframes.push({
        timeMs: operation.timeMs,
        value: structuredClone(operation.value),
      });
      property.keyframes.sort((a, b) => a.timeMs - b.timeMs);
      continue;
    }

    if (operation.type === "SET_EXPRESSION") {
      if (!nonEmpty(operation.propertyPath) || !nonEmpty(operation.expression)) {
        fail(errors, index, "SET_EXPRESSION requires propertyPath and expression");
        continue;
      }
      getOrCreateProperty(layer, operation.propertyPath).expression = operation.expression;
      continue;
    }
    if (operation.type === "ADD_EFFECT") {
      if (!nonEmpty(operation.effectId) || !nonEmpty(operation.matchName)
        || layer.effects.some((effect) => effect.effectId === operation.effectId)) {
        fail(errors, index, "effect '" + operation.effectId + "' is invalid or already exists");
        continue;
      }
      const effect: VirtualAeEffectV1 = {
        effectId: operation.effectId,
        matchName: operation.matchName,
        properties: [],
      };
      if (operation.insertAfterEffectId === undefined) {
        layer.effects.push(effect);
      } else {
        const after = layer.effects.findIndex(
          (candidate) => candidate.effectId === operation.insertAfterEffectId,
        );
        if (after < 0) {
          fail(errors, index, "insertAfterEffectId '" + operation.insertAfterEffectId + "' does not exist");
          continue;
        }
        layer.effects.splice(after + 1, 0, effect);
      }
      continue;
    }

    if (operation.type === "SET_EFFECT_PROPERTY") {
      const effect = layer.effects.find((candidate) => candidate.effectId === operation.effectId);
      if (!effect || !nonEmpty(operation.propertyPath)) {
        fail(errors, index, effect
          ? "SET_EFFECT_PROPERTY requires propertyPath"
          : "effect '" + operation.effectId + "' does not exist");
        continue;
      }
      let property = effect.properties.find((candidate) => candidate.path === operation.propertyPath);
      if (!property) {
        property = { path: operation.propertyPath, keyframes: [] };
        effect.properties.push(property);
      }
      property.value = structuredClone(operation.value);
      continue;
    }

    if (operation.type === "ADD_MASK") {
      if (!nonEmpty(operation.maskId) || layer.masks.some((mask) => mask.maskId === operation.maskId)) {
        fail(errors, index, "mask '" + operation.maskId + "' is invalid or already exists");
        continue;
      }
      layer.masks.push({
        maskId: operation.maskId,
        mode: operation.mode ?? "ADD",
        closed: operation.closed ?? true,
      });
      continue;
    }
    if (operation.type === "SET_MATTE") {
      if (operation.matteLayerId === layer.layerId || !findLayer(comp, operation.matteLayerId)) {
        fail(errors, index, "matte '" + operation.matteLayerId + "' is missing or self-referential");
        continue;
      }
      layer.matteLayerId = operation.matteLayerId;
      continue;
    }

    if (operation.type === "SET_PARENT") {
      if (operation.parentLayerId === null) {
        delete layer.parentLayerId;
        continue;
      }
      if (operation.parentLayerId === layer.layerId || !findLayer(comp, operation.parentLayerId)) {
        fail(errors, index, "parent '" + operation.parentLayerId + "' is missing or self-referential");
        continue;
      }
      layer.parentLayerId = operation.parentLayerId;
      continue;
    }

  }

  validateFinalState(project, errors);
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    project,
  };
};

export interface VirtualAeTransactionResultV1 extends VirtualAeSimulationV1 {
  readonly rolledBack: boolean;
}

export const simulateVirtualAeTransactionV1 = (
  initial: VirtualAeProjectV1,
  operations: readonly VirtualAeOperationV1[],
): VirtualAeTransactionResultV1 => {
  const baseline = structuredClone(initial);
  const simulation = simulateVirtualAeV1(initial, operations);
  if (simulation.valid) return { ...simulation, rolledBack: false };
  return {
    valid: false,
    errors: simulation.errors,
    project: baseline,
    rolledBack: operations.length > 0,
  };
};
