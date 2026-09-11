import { createM1CapabilityRegistry, type CapabilityRegistry } from "../../../packages/capability-registry/src/index.js";
import {
  AE_CEP_PUBLIC_CAPABILITIES_V11,
  AeCepAdapterClientV11,
  type AeCepAdapterStateV11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { applyM2AcceptedProofEvidence } from "../../../packages/adapters/ae-cep/src/m2-proof-maturity.js";
import { AE_ADAPTER_BUILD_V11 } from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import { ContinuousFastLoop } from "../../../packages/continuous-fast-loop/src/index.js";
import { EditorBrainRuntimeV0, EditorBrainV0 } from "../../../packages/editor-brain/src/index.js";

export const DEFAULT_AE_EXECUTION_MODE = "EDITOR_BRAIN_CONTINUOUS_FAST_LOOP_V0" as const;

export interface DesktopAeSessionV11 {
  readonly adapterBuild: typeof AE_ADAPTER_BUILD_V11;
  readonly state: AeCepAdapterStateV11;
  readonly registry: CapabilityRegistry;
  readonly executionMode: typeof DEFAULT_AE_EXECUTION_MODE;
  readonly runner: ContinuousFastLoop;
  readonly editorBrain: EditorBrainV0;
  readonly editorRunner: EditorBrainRuntimeV0;
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
    capabilities: applyM2AcceptedProofEvidence(AE_CEP_PUBLIC_CAPABILITIES_V11),
  });
  const runner = new ContinuousFastLoop(adapter, state);
  const editorBrain = new EditorBrainV0();
  const editorRunner = new EditorBrainRuntimeV0(editorBrain, runner);
  return {
    adapterBuild: AE_ADAPTER_BUILD_V11,
    state,
    registry,
    executionMode: DEFAULT_AE_EXECUTION_MODE,
    runner,
    editorBrain,
    editorRunner,
  };
};
