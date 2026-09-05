import { createM1CapabilityRegistry, type CapabilityRegistry } from "../../../packages/capability-registry/src/index.js";
import {
  AE_ADAPTER_BUILD_V11,
  AE_CEP_PUBLIC_CAPABILITIES_V11,
  AeCepAdapterClientV11,
  type AeCepAdapterStateV11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";

export interface DesktopAeSessionV11 {
  readonly adapterBuild: typeof AE_ADAPTER_BUILD_V11;
  readonly state: AeCepAdapterStateV11;
  readonly registry: CapabilityRegistry;
}

export const createDesktopAeSessionV11 = async (
  adapter: AeCepAdapterClientV11,
  projectId = "after-effects-project",
): Promise<DesktopAeSessionV11> => {
  const state = await adapter.observe(projectId);
  const registry = createM1CapabilityRegistry(state.observed.environmentFingerprint);
  registry.registerAdapter({
    adapterId: "ae-cep-v1.1",
    adapterVersion: AE_ADAPTER_BUILD_V11,
    priority: 110,
    capabilities: AE_CEP_PUBLIC_CAPABILITIES_V11,
  });
  return { adapterBuild: AE_ADAPTER_BUILD_V11, state, registry };
};
