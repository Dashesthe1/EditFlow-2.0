import { createM1CapabilityRegistry, type CapabilityRegistry } from "../../../packages/capability-registry/src/index.js";
import {
  AE_CEP_CAPABILITIES,
  AeCepAdapterClient,
  type AeCepAdapterState,
} from "../../../packages/adapters/ae-cep/src/index.js";
import { AE_ADAPTER_BUILD } from "../../../packages/adapters/ae-cep/src/protocol.js";
import {
  registerAcceptedM3RuntimeCapabilities,
  registerAcceptedM4TrackerRuntimeCapabilities,
  type M4TrackerRuntimeRegistrationV1,
} from "./ae-runtime-capabilities.js";

export interface DesktopAeSession {
  readonly adapterBuild: typeof AE_ADAPTER_BUILD;
  readonly state: AeCepAdapterState;
  readonly registry: CapabilityRegistry;
}

export interface DesktopAeSessionOptions {
  readonly m4TrackerRuntime?: M4TrackerRuntimeRegistrationV1 | null;
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
  if (options.m4TrackerRuntime) registerAcceptedM4TrackerRuntimeCapabilities(registry, options.m4TrackerRuntime);
  return { adapterBuild: AE_ADAPTER_BUILD, state, registry };
};
