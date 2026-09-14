import { createM1CapabilityRegistry, type CapabilityRegistry } from "../../../packages/capability-registry/src/index.js";
import {
  AE_CEP_CAPABILITIES,
  AeCepAdapterClient,
  type AeCepAdapterState,
} from "../../../packages/adapters/ae-cep/src/index.js";
import { AE_ADAPTER_BUILD } from "../../../packages/adapters/ae-cep/src/protocol.js";
import {
  registerAcceptedM3RuntimeCapabilities,
  registerAcceptedM4FoundationRuntimeCapabilities,
  registerAcceptedM4SegmentationRuntimeCapabilities,
  registerAcceptedM4TrackerRuntimeCapabilities,
  type M4TrackerRuntimeRegistrationV1,
} from "./ae-runtime-capabilities.js";
import {
  loadTrustedM4SegmentationRuntimeEvidenceV1,
  type M4SegmentationRuntimeEvidenceFileV1,
} from "./m4-segmentation-runtime-evidence.js";

export interface DesktopAeSession {
  readonly adapterBuild: typeof AE_ADAPTER_BUILD;
  readonly state: AeCepAdapterState;
  readonly registry: CapabilityRegistry;
  readonly m4SegmentationRuntimeRegistered: boolean;
  readonly m4SegmentationRuntimeEvidenceFileSha256: string | null;
}

export interface DesktopAeSessionOptions {
  readonly m4TrackerRuntime?: M4TrackerRuntimeRegistrationV1 | null;
  readonly m4SegmentationRuntimeEvidenceFile?: M4SegmentationRuntimeEvidenceFileV1 | null;
}

export const createDesktopAeSession = async (
  adapter: AeCepAdapterClient,
  projectId = "after-effects-project",
  options: DesktopAeSessionOptions = {},
): Promise<DesktopAeSession> => {
  const state = await adapter.observe(projectId);
  const registry = createM1CapabilityRegistry(state.observed.environmentFingerprint);
  registry.registerAdapter({
    adapterId: "ae-cep",
    adapterVersion: AE_ADAPTER_BUILD,
    priority: 100,
    capabilities: AE_CEP_CAPABILITIES,
  });
  registerAcceptedM3RuntimeCapabilities(registry);
  registerAcceptedM4FoundationRuntimeCapabilities(registry);
  if (options.m4TrackerRuntime) registerAcceptedM4TrackerRuntimeCapabilities(registry, options.m4TrackerRuntime);
  const m4SegmentationRuntimeAttestation = options.m4SegmentationRuntimeEvidenceFile
    ? await loadTrustedM4SegmentationRuntimeEvidenceV1(options.m4SegmentationRuntimeEvidenceFile)
    : null;
  const m4SegmentationRuntimeRegistered = registerAcceptedM4SegmentationRuntimeCapabilities(
    registry,
    m4SegmentationRuntimeAttestation,
  );
  return {
    adapterBuild: AE_ADAPTER_BUILD,
    state,
    registry,
    m4SegmentationRuntimeRegistered,
    m4SegmentationRuntimeEvidenceFileSha256: m4SegmentationRuntimeAttestation?.evidenceFileSha256 ?? null,
  };
};
