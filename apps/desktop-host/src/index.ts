import { createM1CapabilityRegistry, type CapabilityRegistry } from "../../../packages/capability-registry/src/index.js";
import {
  AE_ADAPTER_BUILD,
  AE_CEP_CAPABILITIES,
  AeCepAdapterClient,
  type AeCepAdapterState,
} from "../../../packages/adapters/ae-cep/src/index.js";

export interface DesktopAeSession {
  readonly adapterBuild: typeof AE_ADAPTER_BUILD;
  readonly state: AeCepAdapterState;
  readonly registry: CapabilityRegistry;
}

export const createDesktopAeSession = async (
  adapter: AeCepAdapterClient,
  projectId = "after-effects-project",
): Promise<DesktopAeSession> => {
  const state = await adapter.observe(projectId);
  const registry = createM1CapabilityRegistry(state.observed.environmentFingerprint);
  registry.registerAdapter({
    adapterId: "ae-cep",
    adapterVersion: AE_ADAPTER_BUILD,
    priority: 100,
    capabilities: AE_CEP_CAPABILITIES,
  });
  return { adapterBuild: AE_ADAPTER_BUILD, state, registry };
};
