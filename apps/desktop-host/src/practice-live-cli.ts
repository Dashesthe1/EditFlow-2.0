import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  EditTypeRegistryFileV1,
  type GptOrchestrationAssignmentV1,
  type PracticeMediaInputV1,
} from "../../../packages/practice-homework/src/index.js";
import { LoopbackCepBroker } from "./loopback-cep.js";
import { recordPracticeHeldOutCertificationV1 } from "./practice-held-out-certification.js";
import {
  evaluatePracticeIsolationEvidenceV1,
  evaluatePracticeLivePersistenceV1,
} from "./practice-live-proof-assertions.js";
import { PracticeMasteryVerifierV1 } from "./practice-mastery-verifier.js";
import { resolvePracticeStatePathsV1 } from "./practice-state-paths.js";
import { createPracticeM6CurrentAeTrainingRuntimeV1 } from "./practice-training-runtime.js";

interface BridgeConfigFile {
  readonly schemaVersion: 1;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
  readonly protocolVersion: "1.1.0";
  readonly supportedProtocolVersions?: readonly string[];
  readonly extensionId: string;
  readonly extensionVersion: string;
}

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

const argumentsFor = (name: string): readonly string[] => {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1] !== undefined) {
      values.push(process.argv[index + 1] ?? "");
    }
  }
  return values;
};const hasFlag = (name: string): boolean => process.argv.includes(name);

const requireArgument = (name: string): string => {
  const value = argument(name);
  if (value === null || value.trim().length === 0) {
    throw new Error("Missing required argument " + name + ".");
  }
  return value;
};

const stripUtf8Bom = (value: string): string =>
  value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;

const parseConfig = (value: unknown): BridgeConfigFile => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Bridge config must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["schemaVersion"] !== 1 || candidate["host"] !== "127.0.0.1") {
    throw new Error("Unsupported CEP bridge config.");
  }
  if (!Number.isInteger(candidate["port"]) || (candidate["port"] as number) < 1) {
    throw new Error("CEP bridge config port is invalid.");
  }
  if (typeof candidate["token"] !== "string" || candidate["token"].length < 32) {
    throw new Error("CEP bridge token is invalid.");
  }
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) {
    throw new Error("CEP bridge protocolVersion mismatch.");
  }  if (typeof candidate["extensionId"] !== "string" || typeof candidate["extensionVersion"] !== "string") {
    throw new Error("CEP bridge extension metadata is incomplete.");
  }
  const protocols = candidate["supportedProtocolVersions"];
  if (protocols !== undefined
    && (!Array.isArray(protocols) || protocols.some((item) => typeof item !== "string"))) {
    throw new Error("CEP bridge supportedProtocolVersions is invalid.");
  }
  return candidate as unknown as BridgeConfigFile;
};

const numberArgument = (name: string, fallback: number, minimum: number): number => {
  const raw = argument(name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(name + " must be a finite number >= " + String(minimum) + ".");
  }
  return value;
};

const integerArgument = (name: string, fallback: number, minimum: number): number => {
  const value = numberArgument(name, fallback, minimum);
  if (!Number.isInteger(value)) throw new Error(name + " must be an integer.");
  return value;
};

const ensureFile = async (value: string, label: string): Promise<string> => {
  const resolved = path.resolve(value);
  const metadata = await stat(resolved);
  if (!metadata.isFile() || metadata.size <= 0) {
    throw new Error(label + " is not a non-empty file: " + resolved);
  }
  return resolved;
};const mediaId = (prefix: string, filePath: string, index: number): string => {
  const stem = path.basename(filePath, path.extname(filePath))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "media";
  return prefix + ":" + String(index + 1) + ":" + stem;
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
};

const isPanelRegistrationTimeout = (error: unknown): boolean =>
  error instanceof Error && error.message === "CEP_PANEL_REGISTRATION_TIMEOUT";

const invokeAePanelBootstrap = async (
  afterFxPath: string,
  panelBootstrapPath: string,
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(afterFxPath, ["-r", panelBootstrapPath], {
      stdio: "ignore",
      windowsHide: false,
      detached: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
};

const main = async (): Promise<void> => {
  const configPath = path.resolve(requireArgument("--config"));
  const repositoryRoot = path.resolve(requireArgument("--repository-root"));
  const artifactDir = path.resolve(requireArgument("--artifact-dir"));
  const statePaths = resolvePracticeStatePathsV1(argument("--state-dir"));
  const stateDir = statePaths.stateDir;
  const resultPath = path.resolve(requireArgument("--result"));
  const finishPath = await ensureFile(requireArgument("--finish"), "Finish reference");
  const videoPaths = await Promise.all(
    argumentsFor("--start-video").map((value) => ensureFile(value, "Start video")),
  );
  const audioPaths = await Promise.all(
    argumentsFor("--start-audio").map((value) => ensureFile(value, "Start audio")),
  );
  if (videoPaths.length === 0) {
    throw new Error("At least one --start-video is required.");
  }

  const sessionId = requireArgument("--session-id");
  const editTypeId = requireArgument("--edit-type-id");
  const editTypeTitle = argument("--edit-type-title");
  const heldOutCertification = hasFlag("--held-out-certification");
  const appliedSkillIds = [...new Set(argumentsFor("--applied-skill-id")
    .map((value) => value.trim())
    .filter(Boolean))];
  const expectedIsolationBackend = argument("--expected-isolation-backend");
  const expectedIsolationFallbackAfter = argument("--expected-isolation-fallback-after");
  if (heldOutCertification && hasFlag("--allocate")) {
    throw new Error("Held-out certification cannot allocate learning evidence.");
  }
  if (!heldOutCertification && appliedSkillIds.length > 0) {
    throw new Error("--applied-skill-id is reserved for held-out certification.");
  }
  const maxAttempts = integerArgument("--max-attempts", 2, 1);
  const minimumSimilarity = numberArgument("--minimum-similarity", 0.95, 0);
  const stretchSimilarity = numberArgument("--stretch-similarity", 0.99, 0);  const exactSceneConfidence = numberArgument("--exact-scene-confidence", 0.95, 0);
  const minimumAudioConfidence = numberArgument("--minimum-audio-confidence", 0.90, 0);
  const timeoutMs = integerArgument("--timeout-ms", 90_000, 1_000);
  const afterFxArgument = argument("--afterfx-path");
  const panelBootstrapArgument = argument("--panel-bootstrap");
  if ((afterFxArgument === null) !== (panelBootstrapArgument === null)) {
    throw new Error("--afterfx-path and --panel-bootstrap must be supplied together.");
  }
  const afterFxPath = afterFxArgument === null
    ? null
    : await ensureFile(afterFxArgument, "After Effects executable");
  const panelBootstrapPath = panelBootstrapArgument === null
    ? null
    : await ensureFile(panelBootstrapArgument, "CEP panel bootstrap script");
  if ([minimumSimilarity, stretchSimilarity, exactSceneConfidence, minimumAudioConfidence]
    .some((value) => value > 1)) {
    throw new Error("Similarity/confidence arguments must be <= 1.");
  }

  const config = parseConfig(JSON.parse(stripUtf8Bom(await readFile(configPath, "utf8"))) as unknown);
  let broker: LoopbackCepBroker | null = null;
  const startedAt = new Date().toISOString();
  try {
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.max(30_000, timeoutMs),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: config.supportedProtocolVersions ?? [config.protocolVersion],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) {
      throw new Error("CEP broker bound unexpected port " + String(boundPort) + ".");
    }
    const reconnectGraceMs = Math.min(2_000, Math.max(250, Math.floor(timeoutMs / 4)));
    let panelBootstrapInvoked = false;
    let panel = broker.panelSession;
    if (panel === null) {
      try {
        panel = await broker.waitForPanel(reconnectGraceMs);
      } catch (error) {
        if (!isPanelRegistrationTimeout(error)) throw error;
        if (afterFxPath !== null && panelBootstrapPath !== null) {
          await invokeAePanelBootstrap(afterFxPath, panelBootstrapPath);
          panelBootstrapInvoked = true;
        }
        panel = await broker.waitForPanel(Math.max(1_000, timeoutMs - reconnectGraceMs));
      }
    }
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(
        "Registered CEP panel version " + panel.extensionVersion
        + " does not match installed config " + config.extensionVersion + ".",
      );
    }

    const start: PracticeMediaInputV1[] = [
      ...videoPaths.map((filePath, index) => ({
        mediaId: mediaId("video", filePath, index),
        role: "START_SOURCE" as const,
        mediaKind: "VIDEO" as const,
        uri: filePath,
      })),      ...audioPaths.map((filePath, index) => ({
        mediaId: mediaId("audio", filePath, index),
        role: "START_SOURCE" as const,
        mediaKind: "AUDIO" as const,
        uri: filePath,
      })),
    ];
    const finish: PracticeMediaInputV1 = {
      mediaId: mediaId("finish", finishPath, 0),
      role: "FINISH_REFERENCE",
      mediaKind: "VIDEO",
      uri: finishPath,
    };
    const mediaRoots = [...new Set(
      [finishPath, ...videoPaths, ...audioPaths].map((filePath) => path.dirname(filePath)),
    )];
    const learningMemoryFilePath = statePaths.learningMemoryFilePath;
    const editTypeRegistryFilePath = statePaths.editTypeRegistryFilePath;

    const runtime = await createPracticeM6CurrentAeTrainingRuntimeV1({
      transport: broker,
      projectId: "practice-live:" + sessionId,
      repositoryRoot,
      artifactDir,
      mediaRoots,
      learningMemoryFilePath,
      editTypeRegistryFilePath,
      renderTimeoutMs: timeoutMs,
    });
    const learningMemoryBefore = runtime.engine.memory.snapshot();
    let editType = runtime.engine.editTypes.get(editTypeId);
    if (editType === null) {
      if (heldOutCertification) {
        throw new Error(
          "Held-out certification requires an existing transfer-verified Edit Type.",
        );
      }
      if (editTypeTitle === null || editTypeTitle.trim().length === 0) {
        throw new Error(
          "Edit Type " + editTypeId + " does not exist; supply --edit-type-title to create it.",
        );
      }
      editType = await runtime.createEditType({
        editTypeId,
        title: editTypeTitle,
        choiceWords: [editTypeTitle],
        description: "Created by the live Practice proof runner.",
      });
    }
    const heldOutKnowledge = heldOutCertification
      ? runtime.engine.editTypes.transferableKnowledge(editTypeId)
      : null;
    if (heldOutCertification && heldOutKnowledge === null) {
      throw new Error(
        "Held-out certification requires TRANSFER_VERIFIED Practice knowledge.",
      );
    }

    const result = await runtime.run({
      sessionId,
      mode: "PRACTICE",
      editTypeId,
      finish,
      start,
      minimumSimilarity,
      stretchSimilarity,
      maxAttempts,
      exactSceneConfidence,
      minimumAudioConfidence,
    }, heldOutKnowledge ?? undefined, heldOutCertification
      ? { retainEpisode: false }
      : undefined);

    let allocation = null;
    if (hasFlag("--allocate") && result.attempts.length > 0) {
      allocation = await runtime.allocateLearning({
        sessionId,
        editTypeId,
      });
    }

    let heldOutProof = null;
    if (heldOutCertification) {
      const finalRenderRef = result.bestAttempt?.renderRef ?? null;
      if (finalRenderRef === null) {
        throw new Error("Held-out certification requires a retained final render attempt.");
      }
      const assignment: GptOrchestrationAssignmentV1 = {
        schema: "editflow.gpt-orchestration-assignment.v1",
        assignmentId: "practice-live-held-out:" + sessionId,
        sessionId,
        mode: "PRACTICE",
        practiceRole: "HELD_OUT_CERTIFICATION",
        editTypeId,
        status: "RUNNING",
        finish,
        start,
        practicePolicy: {
          minimumSimilarity,
          exactSceneConfidence,
          minimumAudioConfidence,
        },
        artifactDir,
        chatMessage: "Standalone Current-AE held-out certification.",
        createdAt: startedAt,
        claimedAt: startedAt,
        claimedBy: "practice-live-cli",
        startedAt,
        completedAt: null,
        cancelRequestedAt: null,
        finalRenderRef: null,
        finalSummary: null,
        error: null,
      };
      const verifier = new PracticeMasteryVerifierV1({ repositoryRoot });
      const verification = await verifier.verify({
        assignment,
        finalRenderRef,
        minimumSimilarity,
        exactSceneConfidence,
        minimumAudioConfidence,
      });
      const registryFile = new EditTypeRegistryFileV1(editTypeRegistryFilePath);
      const registry = await registryFile.load();
      const certification = recordPracticeHeldOutCertificationV1({
        registry,
        editTypeId,
        sessionId,
        proof: verification.proof,
        proofRef: verification.proofRef,
        appliedSkillIds,
        attempt: result.bestAttempt,
        repositoryRoot,
      });
      await registryFile.save(registry);
      heldOutProof = {
        proofRef: verification.proofRef,
        heldOutCase: certification.heldOutCase,
        benchmark: certification.benchmark,
      };
    }

    const reloaded = await createPracticeM6CurrentAeTrainingRuntimeV1({
      transport: broker,
      projectId: "practice-live-reload:" + sessionId,
      repositoryRoot,
      artifactDir,
      mediaRoots,
      learningMemoryFilePath,
      editTypeRegistryFilePath,
      renderTimeoutMs: timeoutMs,
    });
    const reloadedEpisode = reloaded.engine.memory.get(sessionId);
    const reloadedEditType = reloaded.engine.editTypes.get(editTypeId);
    const learningMemoryAfter = reloaded.engine.memory.snapshot();
    const reloadProof = {
      episodeRestored: reloadedEpisode !== null,
      editTypeRestored: reloadedEditType !== null,
      allocationRestored: reloadedEpisode?.allocatedEditTypeId === editTypeId,
      editTypeContainsSession: reloadedEditType?.sessionIds.includes(sessionId) ?? false,
      learningMemoryUnchanged:
        JSON.stringify(learningMemoryAfter) === JSON.stringify(learningMemoryBefore),
      retainedAudioMatchId: reloadedEpisode?.audioMatch?.matchId ?? null,
    };

    const practiceRole = heldOutCertification
      ? "HELD_OUT_CERTIFICATION" as const
      : "LEARNING" as const;
    const persistenceAssertion = evaluatePracticeLivePersistenceV1(
      practiceRole,
      reloadProof,
    );
    const isolationAssertion = evaluatePracticeIsolationEvidenceV1({
      evidenceRefs: result.evidenceRefs,
      expectedBackend: expectedIsolationBackend,
      expectedFallbackAfter: expectedIsolationFallbackAfter,
    });
    const heldOutCasePassed = heldOutProof?.heldOutCase.passed ?? null;
    const liveRunAccepted = result.status === "MASTERED"
      || result.status === "HUMAN_REVIEW_REQUIRED";
    const accepted = liveRunAccepted
      && persistenceAssertion.passed
      && isolationAssertion.passed
      && (!heldOutCertification || heldOutCasePassed === true);
    await writeJson(resultPath, {
      proofId: "PRACTICE_CURRENT_AE_LIVE_E2E_V1",
      startedAt,
      completedAt: new Date().toISOString(),
      status: result.status,
      ok: accepted,
      panel,
      panelBootstrap: {
        invoked: panelBootstrapInvoked,
        afterFxPath,
        panelBootstrapPath,
      },
      sessionId,
      practiceRole,
      editType: {
        editTypeId: editType.editTypeId,
        title: editType.title,
        revisionAtStart: editType.revision,
      },
      inputs: {
        finishPath,
        videoPaths,
        audioPaths,
      },
      thresholds: {
        minimumSimilarity,
        stretchSimilarity,
        maxAttempts,
        exactSceneConfidence,
        minimumAudioConfidence,
      },
      result,
      allocation,
      heldOutProof,
      reloadProof,
      assertions: {
        persistence: persistenceAssertion,
        subjectIsolation: isolationAssertion,
      },
      persistence: {
        stateDir,
        learningMemoryFilePath,
        editTypeRegistryFilePath,
      },
    });
    if (result.status === "BLOCKED") process.exitCode = 2;
    if (!persistenceAssertion.passed) process.exitCode = 3;
    if (hasFlag("--allocate")
      && (!reloadProof.allocationRestored || !reloadProof.editTypeContainsSession)) {
      process.exitCode = 4;
    }
    if (heldOutCertification && heldOutCasePassed !== true) {
      process.exitCode = 5;
    }
    if (!isolationAssertion.passed) {
      process.exitCode = 6;
    }
  } catch (error) {
    await writeJson(resultPath, {
      proofId: "PRACTICE_CURRENT_AE_LIVE_E2E_V1",
      startedAt,
      completedAt: new Date().toISOString(),
      status: "FAILED",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    if (broker !== null) await broker.stop();
  }
};

await main();