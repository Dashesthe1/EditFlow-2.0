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
  registerAcceptedM5RotoBrushRuntimeCapabilities,
  type M4TrackerRuntimeRegistrationV1,
} from "./ae-runtime-capabilities.js";
import {
  loadTrustedM4SegmentationRuntimeEvidenceV1,
  type M4SegmentationRuntimeEvidenceFileV1,
} from "./m4-segmentation-runtime-evidence.js";
import {
  loadTrustedM5RotoBrushRuntimeEvidenceV1,
  type M5RotoBrushRuntimeEvidenceFileV1,
} from "./m5-roto-brush-runtime-evidence.js";

export interface DesktopAeSession {
  readonly adapterBuild: typeof AE_ADAPTER_BUILD;
  readonly state: AeCepAdapterState;
  readonly registry: CapabilityRegistry;
  readonly m4SegmentationRuntimeRegistered: boolean;
  readonly m4SegmentationRuntimeEvidenceFileSha256: string | null;
  readonly m5RotoBrushRuntimeRegistered: boolean;
  readonly m5RotoBrushRuntimeEvidenceFileSha256: string | null;
}

export interface DesktopAeSessionOptions {
  readonly m4TrackerRuntime?: M4TrackerRuntimeRegistrationV1 | null;
  readonly m4SegmentationRuntimeEvidenceFile?: M4SegmentationRuntimeEvidenceFileV1 | null;
  readonly m5RotoBrushRuntimeEvidenceFile?: M5RotoBrushRuntimeEvidenceFileV1 | null;
}

export {
  PracticeCurrentAeBaselineRunnerV1,
  PracticeM6CurrentAeTrainingRuntimeV1,
  compilePracticeAeBaselineExecutionPlanV1,
  createPracticeCurrentAeBaselineRunnerV1,
  createPracticeM6CurrentAeAssemblyV1,
  createPracticeM6CurrentAeTrainingRuntimeV1,
} from "./practice-training-runtime.js";
export {
  recordPracticeHeldOutCertificationV1,
  refreshPracticeHeldOutBenchmarkV1,
} from "./practice-held-out-certification.js";
export {
  evaluatePracticeRetainedTruthSuiteManifestV1,
} from "./practice-retained-truth-suite.js";
export type {
  PracticeRetainedTruthManifestCaseV1,
  PracticeRetainedTruthManifestSourceV1,
  PracticeRetainedTruthSuiteManifestV1,
} from "./practice-retained-truth-suite.js";
export type {
  PracticeM6CurrentAeAssemblyV1,
  PracticeM6CurrentAeAssemblyConfigV1,
  PracticeM6CurrentAeTrainingRuntimeConfigV1,
} from "./practice-training-runtime.js";
export {
  PRACTICE_M6_NATIVE_CAPABILITIES_V1,
  PracticeM6CurrentAeRuntimeV1,
} from "./practice-m6-current-ae-runtime.js";
export type {
  PracticeM6AeRenderDriverV1,
  PracticeM6CurrentAeTransactionV1,
} from "./practice-m6-current-ae-runtime.js";
export {
  PracticeM6AeRenderDriverCurrentV1,
} from "./practice-m6-ae-render-driver.js";
export type {
  PracticeM6AeRenderDriverConfigV1,
} from "./practice-m6-ae-render-driver.js";
export {
  buildPracticeCrossSourceSubjectProofV1,
} from "./practice-cross-source-subject-proof.js";
export {
  loadM6ProfessionalBenchmarkEvidenceV1,
  defaultM6ProfessionalBenchmarkEvidencePathV1,
  M6_PROFESSIONAL_BENCHMARK_EVIDENCE_SCHEMA_V1,
} from "./m6-professional-benchmark-evidence.js";
export type {
  M6ProfessionalBenchmarkEvidenceFileV1,
} from "./m6-professional-benchmark-evidence.js";
export {
  PracticePanelServerV1,
} from "./practice-panel-server.js";
export type {
  PracticePanelRunSnapshotV1,
  PracticePanelServerConfigV1,
} from "./practice-panel-server.js";

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
  const m5RotoBrushRuntimeAttestation = options.m5RotoBrushRuntimeEvidenceFile
    ? await loadTrustedM5RotoBrushRuntimeEvidenceV1(options.m5RotoBrushRuntimeEvidenceFile)
    : null;
  const m5RotoBrushRuntimeRegistered = registerAcceptedM5RotoBrushRuntimeCapabilities(
    registry,
    m5RotoBrushRuntimeAttestation,
  );
  return {
    adapterBuild: AE_ADAPTER_BUILD,
    state,
    registry,
    m4SegmentationRuntimeRegistered,
    m4SegmentationRuntimeEvidenceFileSha256: m4SegmentationRuntimeAttestation?.evidenceFileSha256 ?? null,
    m5RotoBrushRuntimeRegistered,
    m5RotoBrushRuntimeEvidenceFileSha256: m5RotoBrushRuntimeAttestation?.evidenceFileSha256 ?? null,
  };
};
