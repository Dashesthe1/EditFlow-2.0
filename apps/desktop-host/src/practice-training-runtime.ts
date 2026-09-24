import path from "node:path";

import type {
  ExecutionPlan,
  ExecutionPlanOperation,
  ObservedProjectState,
  RiskClass,
} from "../../../packages/core-contracts/src/index.js";
import {
  asCapabilityId,
  asOperationId,
  asPlanId,
  asRollbackBoundaryId,
  asRouteId,
} from "../../../packages/core-contracts/src/index.js";
import {
  AeCepCurrentTransactionalHostV1,
  type CurrentAeCepTransactionalTransportV1,
} from "../../../packages/adapters/ae-cep/src/current-transactional-host.js";
import {
  AeFilesystemPolicyV11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  AE_ADAPTER_ROUTE_ID_V11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  AE_LAYER_CONTROLS_ROUTE_ID_V16,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_6.js";
import {
  AE_TIME_REMAP_ROUTE_ID_V27,
} from "../../../packages/adapters/ae-cep/src/protocol-v2_7.js";
import {
  PracticeAeBaselineBuilderV1,
  type PracticeAeBaselineBatchRunnerV1,
  type PracticeAeBaselineCommandV1,
  type PracticeAeBaselinePlanV1,
} from "../../../packages/practice-homework/src/ae-baseline.js";
import {
  LocalPracticeMediaMatcherV1,
} from "../../../packages/practice-homework/src/local-media.js";
import {
  PracticeM6ExecutionBridgeV1,
  composePracticeM6ExecutionAdaptersV1,
} from "../../../packages/practice-homework/src/m6-practice.js";
import type {
  EditTypeKnowledgeSnapshotV1,
  EditTypeProfileV1,
  PracticeHomeworkAdaptersV1,
  PracticeLearningAllocationResultV1,
  PracticeSessionRequestV1,
  PracticeSessionResultV1,
  ProCreationPreparationResultV1,
  ProCreationSessionRequestV1,
} from "../../../packages/practice-homework/src/contracts.js";
import { PracticeHomeworkEngineV1 } from "../../../packages/practice-homework/src/engine.js";
import {
  EditTypeRegistryFileV1,
  type CreateEditTypeInputV1,
} from "../../../packages/practice-homework/src/edit-types.js";
import { PracticeLearningMemoryFileV1 } from "../../../packages/practice-homework/src/persistent-memory.js";
import { ProCreationPreparationEngineV1 } from "../../../packages/practice-homework/src/pro-creation.js";
import { CurrentAeTransactionRuntimeV1 } from "./current-ae-transaction-runtime.js";
import { PracticeM6LocalMediaAnalyzerV1 } from "./practice-m6-media.js";
import {
  PracticeM6CurrentAeRuntimeV1,
  type PracticeM6SubjectIsolationRouteV1,
} from "./practice-m6-current-ae-runtime.js";
import { PracticeM6AeRenderDriverCurrentV1 } from "./practice-m6-ae-render-driver.js";
import {
  createRetainedSam31PracticeSubjectIsolationRouteV1,
} from "./practice-m6-subject-isolation.js";
import {
  createRetainedPracticeRotoBrushSubjectIsolationRouteV1,
} from "./practice-m6-roto-brush-subject-isolation.js";
import {
  createRetainedPracticeTrackedMaskSubjectIsolationRouteV1,
} from "./practice-m6-tracked-mask-subject-isolation.js";
import {
  createPracticeM6SubjectIsolationRouterV1,
} from "./practice-m6-subject-isolation-router.js";
const routeForCommand = (
  command: PracticeAeBaselineCommandV1,
): string => command === "layer.switches.set"
  ? AE_LAYER_CONTROLS_ROUTE_ID_V16
  : command === "layer.time_remap.enable"
    ? AE_TIME_REMAP_ROUTE_ID_V27
    : AE_ADAPTER_ROUTE_ID_V11;

const riskForCommand = (
  command: PracticeAeBaselineCommandV1,
): RiskClass => command === "layer.set_timing"
  || command === "property.set_keyframes"
  || command === "layer.switches.set"
  ? "R1_REVERSIBLE"
  : "R2_STRUCTURAL";

const uniqueCapabilities = (
  plan: PracticeAeBaselinePlanV1,
) => [...new Set(plan.operations.map((operation) => operation.capabilityId))]
  .map(asCapabilityId);

export const compilePracticeAeBaselineExecutionPlanV1 = (
  plan: PracticeAeBaselinePlanV1,
  observed: ObservedProjectState,
): ExecutionPlan => {
  if (plan.operations.length === 0) {
    throw new TypeError("Practice AE baseline plan must contain at least one operation.");
  }
  const rollbackBoundaryId = asRollbackBoundaryId(
    `${plan.baselineId}:rollback`,
  );
  const operations: ExecutionPlanOperation[] = plan.operations.map(
    (operation, index) => ({
      operationId: asOperationId(operation.operationId),
      capabilityId: asCapabilityId(operation.capabilityId),
      routeId: asRouteId(routeForCommand(operation.command)),
      dependsOn: index === 0
        ? []
        : [asOperationId(plan.operations[index - 1]?.operationId ?? "")],
      idempotency: "CHECK_THEN_APPLY",
      riskClass: riskForCommand(operation.command),
      input: {
        command: operation.command,
        payload: operation.payload,
        readbackProfile: "PRACTICE_BASELINE_STRUCTURAL",
      },
      rollbackBoundaryId,
    }),
  );
  const finalOperation = operations.at(-1);
  if (finalOperation === undefined) {
    throw new TypeError("Practice AE baseline execution plan lost its final operation.");
  }

  return {
    planId: asPlanId(`practice-ae:${plan.baselineId}`),
    planRevision: 1,
    projectRevision: observed.projectRevision,
    projectFingerprint: observed.projectFingerprint,
    environmentFingerprint: observed.environmentFingerprint,
    creativeObjective:
      "Construct the exact source-matched Practice baseline in After Effects.",
    recipeRefs: [
      plan.schema,
      `practice-reference:${plan.referenceId}`,
      ...plan.evidenceRefs,
    ],
    requiredCapabilities: uniqueCapabilities(plan),
    bindings: [],
    operations,
    checkpoints: [{
      checkpointId: `${plan.baselineId}:structural`,
      afterOperationIds: [finalOperation.operationId],
      kind: "STRUCTURAL",
      profile: "PRACTICE_BASELINE_STRUCTURAL",
    }],
    invariants: {
      structural: [{
        baselineId: plan.baselineId,
        compStableId: plan.compStableId,
        expectedDurationMs: plan.durationMs,
        expectedFrameRate: plan.frameRate,
        audioMatchId: plan.audioMatchId,
      }],
      visual: [],
    },
    rollbackBoundaries: [{
      id: rollbackBoundaryId,
      strategy: "RESTORE_SNAPSHOT",
      notes: "Practice baseline construction is one atomic AE transaction.",
    }],
  };
};
export class PracticeCurrentAeBaselineRunnerV1
implements PracticeAeBaselineBatchRunnerV1 {
  readonly runtime: CurrentAeTransactionRuntimeV1;
  #observationCounter = 0;
  readonly #requestScope = `${process.pid}:${Date.now()}`;
  #requestCounter = 0;

  constructor(runtime: CurrentAeTransactionRuntimeV1) {
    this.runtime = runtime;
  }

  async executePlan(plan: PracticeAeBaselinePlanV1): Promise<{
    readonly evidenceRefs: readonly string[];
  }> {
    if (plan.operations.length > this.runtime.maxOperations) {
      throw new Error(
        `PRACTICE_BASELINE_TRANSACTION_LIMIT: plan contains ${plan.operations.length} `
        + `operations; current atomic limit is ${this.runtime.maxOperations}.`,
      );
    }

    const observationId = ++this.#observationCounter;
    const observer = new AeCepCurrentTransactionalHostV1(
      this.runtime.transport,
      this.runtime.projectId,
      `practice-baseline-observe:${plan.baselineId}:${observationId}`,
      () => `practice-baseline-observe-request:${this.#requestScope}:${++this.#requestCounter}`,
    );
    const observed = await observer.readState();
    const executionPlan = compilePracticeAeBaselineExecutionPlanV1(
      plan,
      observed,
    );
    const result = await this.runtime.execute(executionPlan);
    if (result.state !== "COMMITTED") {
      throw new Error(
        `PRACTICE_BASELINE_TRANSACTION_${result.state}: `
        + `applied ${result.appliedOperations} operations and recovered=${result.recovered}.`
        + (result.error === undefined ? "" : ` Cause: ${result.error}`),
      );
    }

    return {
      evidenceRefs: [
        `practice-ae-transaction:${String(executionPlan.planId)}:COMMITTED`,
        `practice-ae-transaction-applied:${result.appliedOperations}`,
        `practice-ae-transaction-recovered:${String(result.recovered)}`,
      ],
    };
  }
}


export const createPracticeCurrentAeBaselineRunnerV1 = (input: {
  readonly transport: CurrentAeCepTransactionalTransportV1;
  readonly projectId: string;
  readonly mediaRoots: readonly string[];
}): PracticeCurrentAeBaselineRunnerV1 => {
  if (input.mediaRoots.length === 0) {
    throw new TypeError(
      "Practice current-AE baseline runner requires at least one allowed media root.",
    );
  }
  return new PracticeCurrentAeBaselineRunnerV1(
    new CurrentAeTransactionRuntimeV1(
      input.transport,
      input.projectId,
      undefined,
      null,
      undefined,
      new AeFilesystemPolicyV11(input.mediaRoots),
    ),
  );
};

export interface PracticeM6CurrentAeAssemblyV1 {
  readonly adapters: PracticeHomeworkAdaptersV1;
  readonly transaction: CurrentAeTransactionRuntimeV1;
  readonly baselineBuilder: PracticeAeBaselineBuilderV1;
  readonly mediaMatcher: LocalPracticeMediaMatcherV1;
  readonly mediaAnalyzer: PracticeM6LocalMediaAnalyzerV1;
  readonly renderDriver: PracticeM6AeRenderDriverCurrentV1;
  readonly subjectIsolationRoute: PracticeM6SubjectIsolationRouteV1 | null;
  readonly m6Runtime: PracticeM6CurrentAeRuntimeV1;
  readonly bridge: PracticeM6ExecutionBridgeV1;
}

export interface PracticeM6CurrentAeAssemblyConfigV1 {
  readonly transport: CurrentAeCepTransactionalTransportV1;
  readonly projectId: string;
  readonly repositoryRoot: string;
  readonly artifactDir: string;
  readonly mediaRoots: readonly string[];
  readonly ffmpegPath?: string;
  readonly renderTimeoutMs?: number;
  readonly restoreUndoLimit?: number;
  readonly sam31PythonPath?: string;
  readonly sam31WorkingDirectory?: string;
  readonly sam31CheckpointPath?: string;
  readonly sam31RuntimeEvidencePath?: string;
  readonly sam31RuntimeEvidenceSha256Path?: string;
  readonly afterFxPath?: string;
  readonly rotoBrushPythonPath?: string;
  readonly rotoBrushVisualWorkingDirectory?: string;
  readonly rotoBrushRuntimeEvidencePath?: string;
  readonly rotoBrushRuntimeEvidenceSha256Path?: string;
  readonly rotoBrushVisualTimeoutMs?: number;
  readonly trackedMaskPythonPath?: string;
  readonly trackedMaskVisualWorkingDirectory?: string;
  readonly trackedMaskRuntimeEvidencePath?: string;
  readonly trackedMaskVisualTimeoutMs?: number;
  readonly trackedMaskMaxAnalysisWindowSeconds?: number;
  readonly recordEpisode?: NonNullable<PracticeHomeworkAdaptersV1["recordEpisode"]>;
}

export const createPracticeM6CurrentAeAssemblyV1 = (
  input: PracticeM6CurrentAeAssemblyConfigV1,
): PracticeM6CurrentAeAssemblyV1 => {
  if (input.mediaRoots.length === 0) {
    throw new TypeError(
      "Practice M6 current-AE assembly requires at least one allowed media root.",
    );
  }
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const artifactDir = path.resolve(input.artifactDir);
  const transaction = new CurrentAeTransactionRuntimeV1(
    input.transport,
    input.projectId,
    undefined,
    null,
    undefined,
    new AeFilesystemPolicyV11([...input.mediaRoots, artifactDir]),
  );
  const baselineBuilder = new PracticeAeBaselineBuilderV1(
    new PracticeCurrentAeBaselineRunnerV1(transaction),
  );
  const mediaMatcher = new LocalPracticeMediaMatcherV1({
    artifactDir: path.join(artifactDir, "media"),
    analysisCacheDir: path.join(
      repositoryRoot,
      "proofs",
      "artifacts",
      "practice-media-cache",
    ),
    scriptPath: path.join(
      repositoryRoot,
      "scripts",
      "practice",
      "practice-media-match.py",
    ),
    ...(input.ffmpegPath === undefined ? {} : { ffmpegPath: input.ffmpegPath }),
  });
  const mediaAnalyzer = new PracticeM6LocalMediaAnalyzerV1({
    repositoryRoot,
    artifactDir: path.join(artifactDir, "m6-analysis"),
  });
  const renderDriver = new PracticeM6AeRenderDriverCurrentV1({
    transport: input.transport,
    projectId: input.projectId,
    artifactDir: path.join(artifactDir, "renders"),
    ...(input.renderTimeoutMs === undefined
      ? {}
      : { renderTimeoutMs: input.renderTimeoutMs }),
    ...(input.restoreUndoLimit === undefined
      ? {}
      : { restoreUndoLimit: input.restoreUndoLimit }),
  });
  const profileRoot = process.env.USERPROFILE?.trim()
    ? path.resolve(process.env.USERPROFILE)
    : path.dirname(repositoryRoot);
  const sam31RuntimeRoot = path.join(profileRoot, "sam3-runtime");
  const sam31SubjectIsolationRoute = createRetainedSam31PracticeSubjectIsolationRouteV1({
    transaction,
    media: mediaAnalyzer,
    repositoryRoot,
    artifactDir: path.join(artifactDir, "subject-isolation"),
    pythonPath: path.resolve(
      input.sam31PythonPath
        ?? path.join(sam31RuntimeRoot, ".venv", "Scripts", "python.exe"),
    ),
    workingDirectory: path.resolve(
      input.sam31WorkingDirectory
        ?? path.join(sam31RuntimeRoot, "sam3-src"),
    ),
    checkpointPath: path.resolve(
      input.sam31CheckpointPath
        ?? path.join(
          sam31RuntimeRoot,
          "checkpoints",
          "sam3.1",
          "sam3.1_multiplex.pt",
        ),
    ),
    runtimeEvidencePath: path.resolve(
      input.sam31RuntimeEvidencePath
        ?? path.join(
          repositoryRoot,
          "proofs",
          "diagnostics",
          "m4-segmentation-runtime-evidence-live.json",
        ),
    ),
    ...(input.sam31RuntimeEvidenceSha256Path === undefined
      ? {}
      : {
          runtimeEvidenceSha256Path: path.resolve(
            input.sam31RuntimeEvidenceSha256Path,
          ),
        }),
  });
  const rotoBrushSubjectIsolationRoute =
    createRetainedPracticeRotoBrushSubjectIsolationRouteV1({
      transaction,
      media: mediaAnalyzer,
      transport: input.transport,
      repositoryRoot,
      artifactDir: path.join(artifactDir, "subject-isolation", "roto-brush"),
      pythonPath: path.resolve(
        input.rotoBrushPythonPath
          ?? path.join(profileRoot, "editgpt", ".venv", "Scripts", "python.exe"),
      ),
      visualWorkingDirectory: path.resolve(
        input.rotoBrushVisualWorkingDirectory
          ?? path.join(repositoryRoot, "packages", "adapters", "ae-cep", "runtime"),
      ),
      afterFxPath: path.resolve(
        input.afterFxPath
          ?? "C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\AfterFX.exe",
      ),
      runtimeEvidencePath: path.resolve(
        input.rotoBrushRuntimeEvidencePath
          ?? path.join(
            repositoryRoot,
            "proofs",
            "diagnostics",
            "m5-roto-brush-runtime-evidence-live.json",
          ),
      ),
      ...(input.rotoBrushRuntimeEvidenceSha256Path === undefined
        ? {}
        : {
            runtimeEvidenceSha256Path: path.resolve(
              input.rotoBrushRuntimeEvidenceSha256Path,
            ),
          }),
      ...(input.rotoBrushVisualTimeoutMs === undefined
        ? {}
        : { visualTimeoutMs: input.rotoBrushVisualTimeoutMs }),
    });
  const trackedMaskSubjectIsolationRoute =
    createRetainedPracticeTrackedMaskSubjectIsolationRouteV1({
      transaction,
      media: mediaAnalyzer,
      transport: input.transport,
      repositoryRoot,
      artifactDir: path.join(artifactDir, "subject-isolation", "tracked-mask"),
      pythonPath: path.resolve(
        input.trackedMaskPythonPath
          ?? input.rotoBrushPythonPath
          ?? path.join(profileRoot, "editgpt", ".venv", "Scripts", "python.exe"),
      ),
      visualWorkingDirectory: path.resolve(
        input.trackedMaskVisualWorkingDirectory
          ?? input.rotoBrushVisualWorkingDirectory
          ?? path.join(repositoryRoot, "packages", "adapters", "ae-cep", "runtime"),
      ),
      afterFxPath: path.resolve(
        input.afterFxPath
          ?? "C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\AfterFX.exe",
      ),
      runtimeEvidencePath: path.resolve(
        input.trackedMaskRuntimeEvidencePath
          ?? path.join(
            repositoryRoot,
            "proofs",
            "diagnostics",
            "m4-mask-tracking-forward-live-acceptance.json",
          ),
      ),
      ...(input.trackedMaskVisualTimeoutMs === undefined
        ? {}
        : { visualTimeoutMs: input.trackedMaskVisualTimeoutMs }),
      ...(input.trackedMaskMaxAnalysisWindowSeconds === undefined
        ? {}
        : { maxAnalysisWindowSeconds: input.trackedMaskMaxAnalysisWindowSeconds }),
    });
  const subjectIsolationRoute = createPracticeM6SubjectIsolationRouterV1([
    sam31SubjectIsolationRoute === null
      ? null
      : { id: "SAM31_TEMPORAL_MATTE", route: sam31SubjectIsolationRoute },
    rotoBrushSubjectIsolationRoute === null
      ? null
      : { id: "ROTO_BRUSH_TRACK_MATTE", route: rotoBrushSubjectIsolationRoute },
    trackedMaskSubjectIsolationRoute === null
      ? null
      : { id: "AE_TRACKED_MASK", route: trackedMaskSubjectIsolationRoute },
  ]);
  const m6Runtime = new PracticeM6CurrentAeRuntimeV1({
    transaction,
    baselineBuilder,
    media: mediaAnalyzer,
    renderDriver,
    subjectIsolationRoute,
  });
  const bridge = new PracticeM6ExecutionBridgeV1(m6Runtime);
  const adapters = composePracticeM6ExecutionAdaptersV1(bridge, {
    analyzeFinish: (finish) => mediaMatcher.analyzeFinish(finish),
    indexStart: (start) => mediaMatcher.indexStart(start),
    matchScenes: (value) => mediaMatcher.matchScenes(value),
    matchAudio: (value) => mediaMatcher.matchAudio(value),
    buildContentBaseline: (value) => baselineBuilder.buildContentBaseline(value),
    ...(input.recordEpisode === undefined
      ? {}
      : { recordEpisode: (episode) => input.recordEpisode?.(episode) ?? Promise.resolve() }),
  });

  return {
    adapters,
    transaction,
    baselineBuilder,
    mediaMatcher,
    mediaAnalyzer,
    renderDriver,
    subjectIsolationRoute,
    m6Runtime,
    bridge,
  };
};

export interface PracticeM6CurrentAeTrainingRuntimeConfigV1
extends PracticeM6CurrentAeAssemblyConfigV1 {
  readonly learningMemoryFilePath: string;
  readonly editTypeRegistryFilePath: string;
}

export class PracticeM6CurrentAeTrainingRuntimeV1 {
  readonly assembly: PracticeM6CurrentAeAssemblyV1;
  readonly engine: PracticeHomeworkEngineV1;
  readonly proCreation: ProCreationPreparationEngineV1;
  readonly learningMemoryFile: PracticeLearningMemoryFileV1;
  readonly editTypeRegistryFile: EditTypeRegistryFileV1;

  constructor(input: {
    readonly assembly: PracticeM6CurrentAeAssemblyV1;
    readonly engine: PracticeHomeworkEngineV1;
    readonly learningMemoryFile: PracticeLearningMemoryFileV1;
    readonly editTypeRegistryFile: EditTypeRegistryFileV1;
  }) {
    this.assembly = input.assembly;
    this.engine = input.engine;
    this.proCreation = new ProCreationPreparationEngineV1(input.engine.editTypes);
    this.learningMemoryFile = input.learningMemoryFile;
    this.editTypeRegistryFile = input.editTypeRegistryFile;
  }
  async run(
    request: PracticeSessionRequestV1,
    knowledgeOverride?: EditTypeKnowledgeSnapshotV1,
    options?: { readonly retainEpisode?: boolean },
  ): Promise<PracticeSessionResultV1> {
    return await this.engine.run(request, knowledgeOverride, options);
  }

  async createEditType(
    input: CreateEditTypeInputV1,
  ): Promise<EditTypeProfileV1> {
    const profile = this.engine.editTypes.create(input);
    await this.editTypeRegistryFile.save(this.engine.editTypes);
    return profile;
  }

  async allocateLearning(input: {
    readonly sessionId: string;
    readonly editTypeId: string;
  }): Promise<PracticeLearningAllocationResultV1> {
    const result = await this.engine.allocateLearning(input);
    await this.editTypeRegistryFile.save(this.engine.editTypes);
    return result;
  }

  prepareProCreation(
    request: ProCreationSessionRequestV1,
  ): ProCreationPreparationResultV1 {
    return this.proCreation.prepare(request);
  }
}
export const createPracticeM6CurrentAeTrainingRuntimeV1 = async (
  input: PracticeM6CurrentAeTrainingRuntimeConfigV1,
): Promise<PracticeM6CurrentAeTrainingRuntimeV1> => {
  const learningMemoryFile = new PracticeLearningMemoryFileV1(
    input.learningMemoryFilePath,
  );
  const editTypeRegistryFile = new EditTypeRegistryFileV1(
    input.editTypeRegistryFilePath,
  );
  const [memory, editTypes] = await Promise.all([
    learningMemoryFile.load(),
    editTypeRegistryFile.load(),
  ]);

  const assembly = createPracticeM6CurrentAeAssemblyV1({
    transport: input.transport,
    projectId: input.projectId,
    repositoryRoot: input.repositoryRoot,
    artifactDir: input.artifactDir,
    mediaRoots: input.mediaRoots,
    ...(input.ffmpegPath === undefined
      ? {}
      : { ffmpegPath: input.ffmpegPath }),
    ...(input.renderTimeoutMs === undefined
      ? {}
      : { renderTimeoutMs: input.renderTimeoutMs }),
    recordEpisode: async (episode) => {
      await learningMemoryFile.recordEpisode(episode);
      await input.recordEpisode?.(episode);
    },
  });
  const engine = new PracticeHomeworkEngineV1(
    assembly.adapters,
    memory,
    editTypes,
  );
  return new PracticeM6CurrentAeTrainingRuntimeV1({
    assembly,
    engine,
    learningMemoryFile,
    editTypeRegistryFile,
  });
};
