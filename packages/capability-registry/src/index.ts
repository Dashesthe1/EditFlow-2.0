export const CAPABILITY_REGISTRY_PHASE = "DECLARATIONS_ONLY" as const;

export interface CapabilityRegistrySnapshot {
  readonly environmentFingerprint: string;
  readonly generatedAt: string;
  readonly capabilities: readonly unknown[];
}

export const createEmptyCapabilityRegistry = (
  environmentFingerprint: string,
  generatedAt = new Date().toISOString(),
): CapabilityRegistrySnapshot => ({
  environmentFingerprint,
  generatedAt,
  capabilities: [],
});
