export const AE_RUNTIME_KNOWLEDGE_SCHEMA_VERSION = "1.0.0" as const;
export const AE_RUNTIME_KNOWLEDGE_PROFILER_VERSION = "1.0.0" as const;

export interface AeRuntimeHostDescriptor {
  readonly name: "Adobe After Effects";
  readonly version: string;
  readonly buildName: string | null;
  readonly buildNumber: string | null;
  readonly locale: string | null;
  readonly isRenderEngine: boolean | null;
  readonly os: string | null;
}

export interface AeRuntimeProjectDescriptor {
  readonly open: boolean;
  readonly name: string | null;
  readonly filePath: string | null;
  readonly itemCount: number;
  readonly revision: number | null;
}

export interface AeInstalledEffectDescriptor {
  readonly displayName: string;
  readonly category: string;
  readonly matchName: string;
  readonly version: string;
}

export interface AeReflectionArgumentDescriptor {
  readonly name: string;
  readonly dataType: string | null;
  readonly defaultValue: string | number | boolean | null;
}

export interface AeReflectionMemberDescriptor {
  readonly name: string;
  readonly kind: "PROPERTY" | "METHOD";
  readonly dataType: string | null;
  readonly description: string | null;
  readonly help: string | null;
  readonly defaultValue: string | number | boolean | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly isCollection: boolean | null;
  readonly arguments: readonly AeReflectionArgumentDescriptor[];
}

export interface AeReflectionDescriptor {
  readonly name: string;
  readonly description: string | null;
  readonly help: string | null;
  readonly properties: readonly AeReflectionMemberDescriptor[];
  readonly methods: readonly AeReflectionMemberDescriptor[];
}

export interface AeRuntimePropertyNode {
  readonly name: string;
  readonly matchName: string;
  readonly propertyIndex: number;
  readonly propertyDepth: number;
  readonly propertyType: string;
  readonly propertyValueType: string | null;
  readonly isEffect: boolean;
  readonly isMask: boolean;
  readonly canSetEnabled: boolean | null;
  readonly enabled: boolean | null;
  readonly canSetExpression: boolean | null;
  readonly canVaryOverTime: boolean | null;
  readonly isSpatial: boolean | null;
  readonly hasMin: boolean | null;
  readonly minValue: number | null;
  readonly hasMax: boolean | null;
  readonly maxValue: number | null;
  readonly unitsText: string | null;
  readonly children: readonly AeRuntimePropertyNode[];
}

export interface AeRuntimeLayerKnowledge {
  readonly index: number;
  readonly name: string;
  readonly className: string;
  readonly reflection: AeReflectionDescriptor | null;
  readonly properties: readonly AeRuntimePropertyNode[];
}

export interface AeRuntimeCompositionKnowledge {
  readonly hostId: number | null;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly frameRate: number;
  readonly layerCount: number;
  readonly layers: readonly AeRuntimeLayerKnowledge[];
}

export interface AeRuntimeKnowledgeSnapshot {
  readonly schemaVersion: typeof AE_RUNTIME_KNOWLEDGE_SCHEMA_VERSION;
  readonly profilerVersion: string;
  readonly capturedAt: string;
  readonly source: "RUNTIME_EXTENDSCRIPT";
  readonly host: AeRuntimeHostDescriptor;
  readonly project: AeRuntimeProjectDescriptor;
  readonly applicationReflection: AeReflectionDescriptor | null;
  readonly projectReflection: AeReflectionDescriptor | null;
  readonly installedEffects: readonly AeInstalledEffectDescriptor[];
  readonly activeComposition: AeRuntimeCompositionKnowledge | null;
  readonly warnings: readonly string[];
}

export interface AeRuntimeKnowledgePropertyPath {
  readonly layerIndex: number;
  readonly layerName: string;
  readonly path: readonly string[];
  readonly property: AeRuntimePropertyNode;
}

const compareText = (a: string, b: string): number => a.localeCompare(b, "en", { sensitivity: "base" });

const normalizeReflection = (reflection: AeReflectionDescriptor | null): AeReflectionDescriptor | null => {
  if (reflection === null) return null;
  const normalizeMember = (member: AeReflectionMemberDescriptor): AeReflectionMemberDescriptor => ({
    ...structuredClone(member),
    arguments: [...member.arguments]
      .map((argument) => structuredClone(argument))
      .sort((a, b) => compareText(a.name, b.name)),
  });
  return {
    name: reflection.name,
    description: reflection.description,
    help: reflection.help,
    properties: [...reflection.properties].map(normalizeMember).sort((a, b) => compareText(a.name, b.name)),
    methods: [...reflection.methods].map(normalizeMember).sort((a, b) => compareText(a.name, b.name)),
  };
};

const normalizeProperty = (property: AeRuntimePropertyNode): AeRuntimePropertyNode => ({
  ...structuredClone(property),
  children: [...property.children]
    .map(normalizeProperty)
    .sort((a, b) => a.propertyIndex - b.propertyIndex || compareText(a.matchName, b.matchName)),
});

export const normalizeAeRuntimeKnowledgeSnapshot = (
  snapshot: AeRuntimeKnowledgeSnapshot,
): AeRuntimeKnowledgeSnapshot => ({
  ...structuredClone(snapshot),
  applicationReflection: normalizeReflection(snapshot.applicationReflection),
  projectReflection: normalizeReflection(snapshot.projectReflection),
  installedEffects: [...snapshot.installedEffects]
    .map((effect) => structuredClone(effect))
    .sort((a, b) => compareText(a.matchName, b.matchName) || compareText(a.version, b.version)),
  activeComposition: snapshot.activeComposition === null
    ? null
    : {
        ...structuredClone(snapshot.activeComposition),
        layers: [...snapshot.activeComposition.layers]
          .map((layer) => ({
            ...structuredClone(layer),
            reflection: normalizeReflection(layer.reflection),
            properties: [...layer.properties]
              .map(normalizeProperty)
              .sort((a, b) => a.propertyIndex - b.propertyIndex || compareText(a.matchName, b.matchName)),
          }))
          .sort((a, b) => a.index - b.index),
      },
  warnings: [...snapshot.warnings].sort(compareText),
});

const reflectionFingerprintShape = (reflection: AeReflectionDescriptor | null): unknown => {
  if (reflection === null) return null;
  const memberShape = (member: AeReflectionMemberDescriptor): unknown => ({
    name: member.name,
    kind: member.kind,
    dataType: member.dataType,
    arguments: member.arguments.map((argument) => ({ name: argument.name, dataType: argument.dataType })),
  });
  return {
    name: reflection.name,
    properties: reflection.properties.map(memberShape),
    methods: reflection.methods.map(memberShape),
  };
};

/**
 * Environment-level knowledge identity intentionally excludes capture time,
 * project content, localized effect display/category labels and warnings.
 * Those are useful evidence, but should not make an identical installed AE
 * capability surface appear to be a new environment.
 */
export const toAeRuntimeKnowledgeFingerprintInput = (snapshot: AeRuntimeKnowledgeSnapshot): unknown => {
  const normalized = normalizeAeRuntimeKnowledgeSnapshot(snapshot);
  return {
    schemaVersion: normalized.schemaVersion,
    profilerVersion: normalized.profilerVersion,
    host: {
      name: normalized.host.name,
      version: normalized.host.version,
      buildName: normalized.host.buildName,
      buildNumber: normalized.host.buildNumber,
      os: normalized.host.os,
    },
    installedEffects: normalized.installedEffects.map((effect) => ({
      matchName: effect.matchName,
      version: effect.version,
    })),
    applicationReflection: reflectionFingerprintShape(normalized.applicationReflection),
    projectReflection: reflectionFingerprintShape(normalized.projectReflection),
  };
};

export class AeRuntimeKnowledgeIndex {
  readonly snapshot: AeRuntimeKnowledgeSnapshot;
  #effectsByMatchName = new Map<string, AeInstalledEffectDescriptor[]>();

  constructor(snapshot: AeRuntimeKnowledgeSnapshot) {
    this.snapshot = normalizeAeRuntimeKnowledgeSnapshot(snapshot);
    for (const effect of this.snapshot.installedEffects) {
      const existing = this.#effectsByMatchName.get(effect.matchName) ?? [];
      this.#effectsByMatchName.set(effect.matchName, [...existing, effect]);
    }
  }

  getInstalledEffect(matchName: string): AeInstalledEffectDescriptor | null {
    return structuredClone(this.#effectsByMatchName.get(matchName)?.[0] ?? null);
  }

  getInstalledEffects(matchName: string): readonly AeInstalledEffectDescriptor[] {
    return structuredClone(this.#effectsByMatchName.get(matchName) ?? []);
  }

  searchInstalledEffects(query: string): readonly AeInstalledEffectDescriptor[] {
    const needle = query.trim().toLocaleLowerCase("en");
    if (needle.length === 0) return [];
    return this.snapshot.installedEffects
      .filter((effect) =>
        effect.matchName.toLocaleLowerCase("en").includes(needle)
        || effect.displayName.toLocaleLowerCase("en").includes(needle)
        || effect.category.toLocaleLowerCase("en").includes(needle))
      .map((effect) => structuredClone(effect));
  }

  findProperties(matchName: string): readonly AeRuntimeKnowledgePropertyPath[] {
    const composition = this.snapshot.activeComposition;
    if (composition === null) return [];
    const matches: AeRuntimeKnowledgePropertyPath[] = [];

    const visit = (
      layer: AeRuntimeLayerKnowledge,
      property: AeRuntimePropertyNode,
      ancestors: readonly string[],
    ): void => {
      const segment = property.matchName.length > 0 ? property.matchName : property.name;
      const path = [...ancestors, segment];
      if (property.matchName === matchName) {
        matches.push({
          layerIndex: layer.index,
          layerName: layer.name,
          path,
          property: structuredClone(property),
        });
      }
      for (const child of property.children) visit(layer, child, path);
    };

    for (const layer of composition.layers) {
      for (const property of layer.properties) visit(layer, property, []);
    }
    return matches;
  }
}
