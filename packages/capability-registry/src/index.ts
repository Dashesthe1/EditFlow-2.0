import {
  asCapabilityId,
  type CapabilityId,
  type CapabilityRecord,
  type CapabilityRoute,
  type EnvironmentFingerprint,
  type RouteId,
  type RouteKind,
} from "../../core-contracts/src/index.js";

export const CAPABILITY_REGISTRY_PHASE = "M1_RUNTIME" as const;

export interface CapabilityRegistrySnapshot {
  readonly environmentFingerprint: EnvironmentFingerprint;
  readonly generatedAt: string;
  readonly capabilities: readonly CapabilityRecord[];
}

export interface CapabilityAdapterDeclaration {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly priority: number;
  readonly capabilities: readonly CapabilityRecord[];
}

interface RegisteredCapability {
  readonly record: CapabilityRecord;
  readonly source: "STATIC" | "ADAPTER";
  readonly priority: number;
  readonly adapterId?: string;
}

export interface CapabilityResolution {
  readonly capability: CapabilityRecord;
  readonly route: CapabilityRoute;
}

const ROUTE_PRIORITY: Readonly<Record<RouteKind, number>> = {
  NATIVE_TYPED: 0,
  HOST_ADAPTER: 1,
  SUBSYSTEM_ADAPTER: 2,
  PLUGIN_ADAPTER: 3,
  GUARDED_UI: 4,
};

export class CapabilityResolutionError extends Error {
  readonly capabilityId: CapabilityId;

  constructor(capabilityId: CapabilityId, message: string) {
    super(message);
    this.name = "CapabilityResolutionError";
    this.capabilityId = capabilityId;
  }
}

export class CapabilityRegistry {
  readonly environmentFingerprint: EnvironmentFingerprint;
  readonly generatedAt: string;
  #records = new Map<CapabilityId, RegisteredCapability[]>();

  constructor(environmentFingerprint: EnvironmentFingerprint, generatedAt = new Date().toISOString()) {
    this.environmentFingerprint = environmentFingerprint;
    this.generatedAt = generatedAt;
  }

  registerStatic(records: readonly CapabilityRecord[]): void {
    for (const record of records) {
      this.#register(record, "STATIC", 0);
    }
  }

  registerAdapter(declaration: CapabilityAdapterDeclaration): void {
    if (!Number.isFinite(declaration.priority)) {
      throw new TypeError("Adapter priority must be finite.");
    }
    for (const record of declaration.capabilities) {
      this.#register(record, "ADAPTER", declaration.priority, declaration.adapterId);
    }
  }

  #register(
    record: CapabilityRecord,
    source: "STATIC" | "ADAPTER",
    priority: number,
    adapterId?: string,
  ): void {
    const existing = this.#records.get(record.id) ?? [];
    const entry: RegisteredCapability = adapterId === undefined
      ? { record: structuredClone(record), source, priority }
      : { record: structuredClone(record), source, priority, adapterId };
    this.#records.set(record.id, [...existing, entry]);
  }

  get(capabilityId: CapabilityId): CapabilityRecord | null {
    const declarations = this.#records.get(capabilityId);
    if (declarations === undefined || declarations.length === 0) {
      return null;
    }

    const ordered = [...declarations].sort((a, b) => b.priority - a.priority);
    const metadata = ordered[0]?.record;
    if (metadata === undefined) {
      return null;
    }

    const routesById = new Map<RouteId, { route: CapabilityRoute; priority: number }>();
    for (const declaration of ordered) {
      for (const route of declaration.record.routes) {
        const current = routesById.get(route.routeId);
        if (current === undefined || declaration.priority > current.priority) {
          routesById.set(route.routeId, { route: structuredClone(route), priority: declaration.priority });
        }
      }
    }

    const routes = [...routesById.values()]
      .map((entry) => entry.route)
      .sort((a, b) => {
        const kindDelta = ROUTE_PRIORITY[a.kind] - ROUTE_PRIORITY[b.kind];
        return kindDelta !== 0 ? kindDelta : String(a.routeId).localeCompare(String(b.routeId));
      });
    const hasAvailableRoute = routes.some((route) => route.available);
    const status = hasAvailableRoute
      ? metadata.status
      : metadata.status === "UNAVAILABLE"
        ? "UNAVAILABLE"
        : "ADAPTER_REQUIRED";

    return structuredClone({ ...metadata, routes, status });
  }

  resolve(capabilityId: CapabilityId): CapabilityResolution {
    const capability = this.get(capabilityId);
    if (capability === null) {
      throw new CapabilityResolutionError(capabilityId, `Capability '${capabilityId}' is not registered.`);
    }
    if (capability.status === "UNAVAILABLE") {
      throw new CapabilityResolutionError(capabilityId, `Capability '${capabilityId}' is unavailable.`);
    }
    const route = capability.routes.find((candidate) => candidate.available);
    if (route === undefined) {
      throw new CapabilityResolutionError(capabilityId, `Capability '${capabilityId}' has no available route.`);
    }
    return { capability, route };
  }

  assertRouteAvailable(capabilityId: CapabilityId, routeId: RouteId): CapabilityRoute {
    const capability = this.get(capabilityId);
    if (capability === null) {
      throw new CapabilityResolutionError(capabilityId, `Capability '${capabilityId}' is not registered.`);
    }
    const route = capability.routes.find((candidate) => candidate.routeId === routeId);
    if (route === undefined) {
      throw new CapabilityResolutionError(
        capabilityId,
        `Route '${routeId}' is not registered for capability '${capabilityId}'.`,
      );
    }
    if (!route.available) {
      throw new CapabilityResolutionError(
        capabilityId,
        `Route '${routeId}' for capability '${capabilityId}' is not available.`,
      );
    }
    return route;
  }

  resolveRequired(capabilityIds: readonly CapabilityId[]): ReadonlyMap<CapabilityId, CapabilityResolution> {
    const resolved = new Map<CapabilityId, CapabilityResolution>();
    for (const capabilityId of capabilityIds) {
      resolved.set(capabilityId, this.resolve(capabilityId));
    }
    return resolved;
  }

  snapshot(): CapabilityRegistrySnapshot {
    const capabilities = [...this.#records.keys()]
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map((id) => this.get(id))
      .filter((record): record is CapabilityRecord => record !== null);
    return {
      environmentFingerprint: this.environmentFingerprint,
      generatedAt: this.generatedAt,
      capabilities,
    };
  }
}

const unavailableAeCapability = (
  id: string,
  domain: string,
  description: string,
  riskClass: CapabilityRecord["riskClass"],
): CapabilityRecord => ({
  id: asCapabilityId(id),
  domain,
  description,
  status: "ADAPTER_REQUIRED",
  proofMaturity: "DECLARED",
  routes: [],
  readbackStrategy: "M2_HOST_ADAPTER_REQUIRED",
  rollbackStrategy: "M2_HOST_ADAPTER_REQUIRED",
  riskClass,
  fallbackPolicy: "FORBID",
});

export const M1_STATIC_AE_CAPABILITIES: readonly CapabilityRecord[] = [
  unavailableAeCapability("ae.project.inspect", "project", "Inspect the current After Effects project.", "R0_READ_ONLY"),
  unavailableAeCapability("ae.project.save", "project", "Save the current After Effects project.", "R2_STRUCTURAL"),
  unavailableAeCapability("ae.comp.create", "composition", "Create an After Effects composition.", "R2_STRUCTURAL"),
  unavailableAeCapability("ae.layer.create", "layer", "Create or add a layer.", "R2_STRUCTURAL"),
  unavailableAeCapability("ae.layer.transform.set", "layer", "Set typed layer transform properties.", "R1_REVERSIBLE"),
  unavailableAeCapability("ae.effect.add", "effect", "Add an effect instance to a layer.", "R2_STRUCTURAL"),
  unavailableAeCapability("ae.effect.property.set", "effect", "Set a typed effect property.", "R1_REVERSIBLE"),
  unavailableAeCapability("ae.keyframe.set", "animation", "Create or update a typed keyframe.", "R1_REVERSIBLE"),
  unavailableAeCapability("ae.precompose.layers", "composition", "Precompose a declared layer set.", "R2_STRUCTURAL"),
  unavailableAeCapability("ae.render.capture", "render", "Capture bounded review evidence.", "R0_READ_ONLY"),
] as const;

export const createM1CapabilityRegistry = (
  environmentFingerprint: EnvironmentFingerprint,
  generatedAt?: string,
): CapabilityRegistry => {
  const registry = generatedAt === undefined
    ? new CapabilityRegistry(environmentFingerprint)
    : new CapabilityRegistry(environmentFingerprint, generatedAt);
  registry.registerStatic(M1_STATIC_AE_CAPABILITIES);
  return registry;
};
