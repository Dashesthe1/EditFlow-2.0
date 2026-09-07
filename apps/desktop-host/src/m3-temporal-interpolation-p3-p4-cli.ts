import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AeCepAdapterClientV11,
  AeFilesystemPolicyV11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  type AeAdapterPublicCommandV11,
  type AeAdapterResponseV11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17,
  type AeTemporalInterpolationCommandV17,
  type AeTemporalInterpolationResponseV17,
  type AeTemporalInterpolationStateV17,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_7.js";
import { buildTemporalInterpolationRequestV17 } from "../../../packages/adapters/ae-cep/src/m3-temporal-interpolation.js";
import type { ObservedProjectState } from "../../../packages/core-contracts/src/index.js";
import type { AeProjectSnapshot } from "../../../packages/ae-object-model/src/index.js";
import { LoopbackCepBroker } from "./loopback-cep.js";

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

interface RenderCompletionFile {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly status: "DONE" | "FAILED";
  readonly ok: boolean;
  readonly outputPath: string;
  readonly error: string | null;
  readonly completedAtMs: number;
  readonly queueItemRemoved: boolean;
}

interface RecordedResponse {
  readonly protocolVersion: string;
  readonly command: string;
  readonly outcome: string;
  readonly error: unknown;
  readonly hostProjectRevision: number | null;
  readonly notes: readonly string[];
}

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

const requireArgument = (name: string): string => {
  const value = argument(name);
  if (value === null || value.length === 0) throw new Error(`Missing required argument ${name}.`);
  return value;
};

const stripUtf8Bom = (value: string): string => value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;

const parseConfig = (value: unknown): BridgeConfigFile => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Bridge config must be an object.");
  const candidate = value as Record<string, unknown>;
  if (candidate["schemaVersion"] !== 1) throw new Error("Unsupported bridge config schemaVersion.");
  if (candidate["host"] !== "127.0.0.1") throw new Error("CEP bridge config host must be 127.0.0.1.");
  if (!Number.isInteger(candidate["port"]) || (candidate["port"] as number) < 1 || (candidate["port"] as number) > 65535) {
    throw new Error("CEP bridge config port is invalid.");
  }
  if (typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("CEP bridge token is invalid.");
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("CEP bridge legacy protocolVersion mismatch.");
  const supported = candidate["supportedProtocolVersions"];
  if (!Array.isArray(supported)
      || !supported.includes(AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise required temporal-interpolation 1.7 and baseline 1.1 protocols.");
  }
  if (typeof candidate["extensionId"] !== "string" || candidate["extensionId"].length === 0) throw new Error("CEP extensionId is missing.");
  if (typeof candidate["extensionVersion"] !== "string" || candidate["extensionVersion"].length === 0) throw new Error("CEP extensionVersion is missing.");
  return candidate as unknown as BridgeConfigFile;
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const nestedRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = asRecord(value);
  return record === null ? null : asRecord(record[key]);
};

const temporalState = (response: AeTemporalInterpolationResponseV17): Record<string, unknown> | null => {
  const temporal = nestedRecord(response.readback, "temporalInterpolation");
  return temporal === null ? null : asRecord(temporal["state"]);
};

const stateMatches = (response: AeTemporalInterpolationResponseV17, expected: AeTemporalInterpolationStateV17): boolean => {
  const state = temporalState(response);
  return state !== null
    && state["inType"] === expected.inType
    && state["outType"] === expected.outType
    && state["temporalContinuous"] === expected.temporalContinuous
    && state["temporalAutoBezier"] === expected.temporalAutoBezier;
};

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const fileExistsNonEmpty = async (filePath: string): Promise<boolean> => {
  try { return (await stat(filePath)).size > 0; } catch { return false; }
};

const parseRenderCompletion = (value: unknown): RenderCompletionFile => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Render completion marker must be an object.");
  const candidate = value as Record<string, unknown>;
  if (candidate["schemaVersion"] !== 1) throw new Error("Unsupported render completion schemaVersion.");
  if (typeof candidate["jobId"] !== "string" || candidate["jobId"].length === 0) throw new Error("Render completion marker is missing jobId.");
  if (candidate["status"] !== "DONE" && candidate["status"] !== "FAILED") throw new Error("Render completion marker has invalid status.");
  if (typeof candidate["ok"] !== "boolean") throw new Error("Render completion marker is missing ok.");
  if (typeof candidate["outputPath"] !== "string" || candidate["outputPath"].length === 0) throw new Error("Render completion marker is missing outputPath.");
  if (candidate["error"] !== null && typeof candidate["error"] !== "string") throw new Error("Render completion marker has invalid error.");
  if (typeof candidate["completedAtMs"] !== "number") throw new Error("Render completion marker is missing completedAtMs.");
  if (typeof candidate["queueItemRemoved"] !== "boolean") throw new Error("Render completion marker is missing queueItemRemoved.");
  return candidate as unknown as RenderCompletionFile;
};

const waitForRenderCompletion = async (
  completionPath: string,
  expectedJobId: string,
  timeoutMs: number,
): Promise<RenderCompletionFile> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const text = stripUtf8Bom(await readFile(completionPath, "utf8"));
      const completion = parseRenderCompletion(JSON.parse(text) as unknown);
      if (completion.jobId !== expectedJobId) lastError = `stale completion marker jobId '${completion.jobId}'`;
      else return completion;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(200);
  }
  throw new Error(`RENDER_JOB_COMPLETION_TIMEOUT: ${expectedJobId}${lastError ? ` (${lastError})` : ""}`);
};

const createBmp24 = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number],
): Buffer => {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const buffer = Buffer.alloc(54 + pixelBytes, 0);
  buffer.write("BM", 0, 2, "ascii");
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelBytes, 34);
  buffer.writeInt32LE(2835, 38);
  buffer.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y += 1) {
    const destinationY = height - 1 - y;
    const rowOffset = 54 + destinationY * rowStride;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x, y);
      const offset = rowOffset + x * 3;
      buffer[offset] = blue;
      buffer[offset + 1] = green;
      buffer[offset + 2] = red;
    }
  }
  return buffer;
};

const projectHasStableItem = (project: AeProjectSnapshot | null, stableId: string): boolean =>
  project?.items.some((item) => item.stableId === stableId) ?? false;

const sameFilesystemPath = (left: string, right: string): boolean =>
  path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "180000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const backgroundSourcePath = path.join(artifactDir, "p3-background-source.bmp");
  const foregroundSourcePath = path.join(artifactDir, "p3-foreground-source.bmp");
  const linearRenderPath = path.join(artifactDir, "p3-linear.avi");
  const incomingHoldRenderPath = path.join(artifactDir, "p3-incoming-hold.avi");
  const outgoingHoldRenderPath = path.join(artifactDir, "p3-outgoing-hold.avi");
  const restoredLinearRenderPath = path.join(artifactDir, "p3-restored-linear.avi");
  const postRollbackRenderPath = path.join(artifactDir, "p4-post-rollback-linear.avi");

  const checks: Record<string, boolean> = {};
  const responses: RecordedResponse[] = [];
  const cleanupErrors: string[] = [];
  let failureError: string | null = null;
  let cleanupComplete = false;
  let broker: LoopbackCepBroker | null = null;
  let client: AeCepAdapterClientV11 | null = null;
  let state: ObservedProjectState | null = null;
  let hostRevision: number | null = null;
  let projectSnapshot: AeProjectSnapshot | null = null;
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null;
  let environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;
  let baselineFingerprint: string | null = null;
  let baselineItemCount: number | null = null;
  let cleanupUndoCount = 0;

  const projectId = "m3-temporal-interpolation-p3-p4-real-ae";
  const prefix = `M3_TEMPORAL_P34_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const backgroundSourceStable = `${prefix}_BACKGROUND_SOURCE`;
  const foregroundSourceStable = `${prefix}_FOREGROUND_SOURCE`;
  const targetCompStable = `${prefix}_TARGET_COMP`;
  const backgroundLayerStable = `${prefix}_BACKGROUND_LAYER`;
  const foregroundLayerStable = `${prefix}_FOREGROUND_LAYER`;
  const temporaryItemStableIds = new Set([backgroundSourceStable, foregroundSourceStable, targetCompStable]);
  const propertyPath = ["ADBE Transform Group", "ADBE Opacity"] as const;
  const keyIndex = 2;
  let operationCounter = 0;
  let requestCounter = 0;

  const linear: AeTemporalInterpolationStateV17 = {
    inType: "LINEAR", outType: "LINEAR", temporalContinuous: false, temporalAutoBezier: false,
  };
  const incomingHold: AeTemporalInterpolationStateV17 = {
    inType: "HOLD", outType: "LINEAR", temporalContinuous: false, temporalAutoBezier: false,
  };
  const outgoingHold: AeTemporalInterpolationStateV17 = {
    inType: "LINEAR", outType: "HOLD", temporalContinuous: false, temporalAutoBezier: false,
  };

  const recordV11 = (command: string, response: AeAdapterResponseV11): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
      notes: response.diagnostics.notes ?? [],
    });
  };

  const recordV17 = (response: AeTemporalInterpolationResponseV17): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command: response.command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
      notes: response.diagnostics.notes,
    });
  };

  const refreshState = async (): Promise<void> => {
    if (client === null) throw new Error("M2 setup client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
    projectSnapshot = observed.project;
  };

  const executeV11 = async (
    command: AeAdapterPublicCommandV11,
    payload: Readonly<Record<string, unknown>>,
    options: { readonly refreshAfter?: boolean } = {},
  ): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M2 setup state is not initialized.");
    operationCounter += 1;
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_OP_${operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M3_TEMPORAL_INTERPOLATION_P3_P4_SETUP",
    });
    recordV11(command, response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    }
    if (options.refreshAfter !== false) await refreshState();
    return response;
  };

  const dispatchV17 = async (
    command: AeTemporalInterpolationCommandV17,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_TEMPORAL_INTERPOLATION_P3_P4_STRUCTURAL",
  ): Promise<AeTemporalInterpolationResponseV17> => {
    if (broker === null) throw new Error("M3 temporal-interpolation broker is not initialized.");
    operationCounter += 1;
    const request = buildTemporalInterpolationRequestV17({
      requestId: `m3-temporal-p34-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V17_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    });
    const response = await broker.dispatch(request);
    recordV17(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const targetPayload = (): Readonly<Record<string, unknown>> => ({
    comp: { stableId: targetCompStable },
    layer: { stableId: foregroundLayerStable },
    propertyPath,
    keyIndex,
  });

  const setStateExact = async (desired: AeTemporalInterpolationStateV17): Promise<AeTemporalInterpolationResponseV17> => {
    if (hostRevision === null) throw new Error("Host revision is unavailable before temporal interpolation mutation.");
    const response = await dispatchV17("property.temporal_interpolation.set", {
      ...targetPayload(), interpolation: desired,
    }, hostRevision);
    if ((response.outcome !== "APPLIED" && response.outcome !== "NO_OP") || !stateMatches(response, desired)) {
      throw new Error(`Temporal interpolation did not reach requested state ${JSON.stringify(desired)}.`);
    }
    await refreshState();
    return response;
  };

  const renderComp = async (outputPath: string): Promise<RenderCompletionFile> => {
    const scheduled = await executeV11("render.capture", {
      comp: { stableId: targetCompStable },
      outputPath,
      timeSpanStart: 0,
      timeSpanDuration: 1,
    }, { refreshAfter: false });
    const readback = asRecord(scheduled.readback);
    const jobId = readback?.["jobId"];
    const completionPath = readback?.["completionPath"];
    const requestedOutputPath = readback?.["requestedOutputPath"];
    const canonicalOutputPath = readback?.["outputPath"];
    if (typeof jobId !== "string" || typeof completionPath !== "string") throw new Error("render.capture did not return a jobId and completionPath.");
    if (typeof requestedOutputPath !== "string" || !sameFilesystemPath(requestedOutputPath, outputPath)) {
      throw new Error("render.capture requested output-path readback does not match the temporal proof request.");
    }
    if (typeof canonicalOutputPath !== "string" || canonicalOutputPath.length === 0) throw new Error("render.capture did not return After Effects' canonical OutputModule.file path.");
    const relativeArtifactPath = path.relative(artifactDir, canonicalOutputPath);
    if (relativeArtifactPath.startsWith("..") || path.isAbsolute(relativeArtifactPath)) {
      throw new Error(`render.capture canonical output escaped the temporal proof artifact directory: ${canonicalOutputPath}`);
    }
    const completion = await waitForRenderCompletion(completionPath, jobId, timeoutMs);
    if (!completion.ok || completion.status !== "DONE" || !completion.queueItemRemoved) {
      throw new Error(`Render job ${jobId} failed: ${completion.error ?? completion.status}`);
    }
    if (!sameFilesystemPath(completion.outputPath, canonicalOutputPath)) throw new Error("Render completion path does not match scheduled canonical path.");
    if (!(await fileExistsNonEmpty(completion.outputPath))) throw new Error(`Canonical render output is missing or empty: ${completion.outputPath}`);
    await refreshState();
    return completion;
  };

  const restoreBaselineThroughUndo = async (): Promise<void> => {
    if (client === null || baselineFingerprint === null || baselineItemCount === null) return;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const current = await client.observe(projectId);
      state = current.observed;
      hostRevision = current.hostRevision;
      projectSnapshot = current.project;
      if (current.observed.projectFingerprint === baselineFingerprint && current.project.itemCount === baselineItemCount) return;
      const response = await client.undoLast({
        transactionId,
        operationId: `${transactionId}_CLEANUP_UNDO_${attempt + 1}`,
        expectedState: current.observed,
      });
      recordV11("transaction.undo_last", response);
      cleanupUndoCount += 1;
      if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
        throw new Error(`Cleanup undo failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
      }
    }
    throw new Error("Cleanup undo budget exhausted before the exact baseline project was restored.");
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(backgroundSourcePath, createBmp24(320, 320, (x, y) => {
      if (x < 160 && y < 160) return [224, 48, 48];
      if (x >= 160 && y < 160) return [196, 48, 88];
      if (x < 160) return [232, 92, 40];
      return [188, 36, 44];
    }));
    await writeFile(foregroundSourcePath, createBmp24(320, 320, (x, y) => {
      if (x < 160 && y < 160) return [36, 92, 232];
      if (x >= 160 && y < 160) return [32, 172, 216];
      if (x < 160) return [80, 72, 208];
      return [36, 128, 236];
    }));
    checks.fixture_background_image_written = (await stat(backgroundSourcePath)).size > 54;
    checks.fixture_foreground_image_written = (await stat(foregroundSourcePath)).size > 54;

    const configText = stripUtf8Bom(await readFile(configPath, "utf8"));
    const config = parseConfig(JSON.parse(configText) as unknown);
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 30_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v17 = panel.protocolVersion === AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17;
    checks.panel_supports_v11_v17 = panel.supportedProtocolVersions.includes(AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v17 || !checks.panel_supports_v11_v17) {
      throw new Error(`Temporal P3/P4 proof requires negotiated protocol ${AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17} with baseline 1.1 fixture compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) throw new Error("Registered CEP panel version does not match installed config.");

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-temporal-p34-setup-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects"
      && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    projectSnapshot = baseline.project;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;
    checks.baseline_blank = baseline.project.itemCount === 0;
    if (!checks.baseline_blank) throw new Error("Temporal P3/P4 proof requires the isolated blank AE baseline used by accepted M3 visual/recovery proofs.");

    const backgroundImport = await executeV11("media.import", {
      path: backgroundSourcePath, stableId: backgroundSourceStable, sequence: false,
    });
    checks.background_source_import = backgroundImport.affectedObjects.some((item) => item.stableId === backgroundSourceStable && item.kind === "FOOTAGE");
    const foregroundImport = await executeV11("media.import", {
      path: foregroundSourcePath, stableId: foregroundSourceStable, sequence: false,
    });
    checks.foreground_source_import = foregroundImport.affectedObjects.some((item) => item.stableId === foregroundSourceStable && item.kind === "FOOTAGE");
    const target = await executeV11("comp.create", {
      stableId: targetCompStable,
      name: `${prefix} Temporal Visual`,
      width: 320,
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    checks.target_comp_create = target.affectedObjects.some((item) => item.stableId === targetCompStable);
    const backgroundLayer = await executeV11("layer.add_media", {
      stableId: backgroundLayerStable,
      comp: { stableId: targetCompStable },
      item: { stableId: backgroundSourceStable },
    });
    checks.background_layer_create = nestedRecord(backgroundLayer.readback, "layer")?.["stableId"] === backgroundLayerStable;
    const foregroundLayer = await executeV11("layer.add_media", {
      stableId: foregroundLayerStable,
      comp: { stableId: targetCompStable },
      item: { stableId: foregroundSourceStable },
    });
    checks.foreground_layer_create = nestedRecord(foregroundLayer.readback, "layer")?.["stableId"] === foregroundLayerStable;
    await executeV11("property.set_keyframes", {
      comp: { stableId: targetCompStable },
      layer: { stableId: foregroundLayerStable },
      propertyPath,
      keyframes: [
        { time: 0, value: 0 },
        { time: 0.5, value: 100 },
        { time: 1, value: 0 },
      ],
    });
    checks.opacity_keys_created = true;

    const linearSet = await setStateExact(linear);
    checks.p3_linear_structural = stateMatches(linearSet, linear);
    const linearCompletion = await renderComp(linearRenderPath);
    checks.p3_linear_artifact = await fileExistsNonEmpty(linearCompletion.outputPath);

    const incomingHoldSet = await setStateExact(incomingHold);
    checks.p3_incoming_hold_structural = stateMatches(incomingHoldSet, incomingHold);
    const incomingHoldCompletion = await renderComp(incomingHoldRenderPath);
    checks.p3_incoming_hold_artifact = await fileExistsNonEmpty(incomingHoldCompletion.outputPath);

    const outgoingHoldSet = await setStateExact(outgoingHold);
    checks.p3_outgoing_hold_structural = stateMatches(outgoingHoldSet, outgoingHold);
    const outgoingHoldCompletion = await renderComp(outgoingHoldRenderPath);
    checks.p3_outgoing_hold_artifact = await fileExistsNonEmpty(outgoingHoldCompletion.outputPath);

    const restoredLinear = await setStateExact(linear);
    checks.p3_restored_linear_structural = stateMatches(restoredLinear, linear);
    const restoredLinearCompletion = await renderComp(restoredLinearRenderPath);
    checks.p3_restored_linear_artifact = await fileExistsNonEmpty(restoredLinearCompletion.outputPath);

    checks.p3_visual_artifact_emitted = checks.p3_linear_artifact
      && checks.p3_incoming_hold_artifact
      && checks.p3_outgoing_hold_artifact
      && checks.p3_restored_linear_artifact;

    const beforeFailure = await client.observe(projectId);
    state = beforeFailure.observed;
    hostRevision = beforeFailure.hostRevision;
    projectSnapshot = beforeFailure.project;
    const beforeFailureReadback = await dispatchV17("property.temporal_interpolation.readback", targetPayload(), null);
    checks.p4_baseline_linear_exact = beforeFailureReadback.outcome === "NO_OP" && stateMatches(beforeFailureReadback, linear);

    const inducedFailure = await dispatchV17("property.temporal_interpolation.set", {
      ...targetPayload(), interpolation: outgoingHold,
    }, hostRevision, "M3_TEMPORAL_INTERPOLATION_P4_FAILURE_INJECTION");
    checks.p4_induced_failure_reported = inducedFailure.outcome === "FAILED"
      && inducedFailure.error?.category === "PROOF_INJECTION"
      && inducedFailure.error?.code === "M3_TEMPORAL_INTERPOLATION_P4_INDUCED_FAILURE";
    checks.p4_rollback_note = inducedFailure.diagnostics.notes.includes("Temporal-interpolation mutation failed and was rolled back through the transaction undo boundary.");
    checks.p4_response_readback_restored = stateMatches(inducedFailure, linear);

    const afterFailure = await client.observe(projectId);
    state = afterFailure.observed;
    hostRevision = afterFailure.hostRevision;
    projectSnapshot = afterFailure.project;
    checks.p4_fingerprint_restored = afterFailure.observed.projectFingerprint === beforeFailure.observed.projectFingerprint;
    checks.p4_item_count_unchanged = afterFailure.project.itemCount === beforeFailure.project.itemCount;

    const afterFailureReadback = await dispatchV17("property.temporal_interpolation.readback", targetPayload(), null);
    checks.p4_structural_state_restored = afterFailureReadback.outcome === "NO_OP" && stateMatches(afterFailureReadback, linear);
    const recoveryCompletion = await renderComp(postRollbackRenderPath);
    checks.p4_recovery_visual_artifact_emitted = await fileExistsNonEmpty(recoveryCompletion.outputPath);

    checks.p4 = checks.p4_baseline_linear_exact
      && checks.p4_induced_failure_reported
      && checks.p4_rollback_note
      && checks.p4_response_readback_restored
      && checks.p4_fingerprint_restored
      && checks.p4_item_count_unchanged
      && checks.p4_structural_state_restored
      && checks.p4_recovery_visual_artifact_emitted;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    if (client !== null) {
      try {
        await restoreBaselineThroughUndo();
        const finalState = await client.observe(projectId);
        state = finalState.observed;
        hostRevision = finalState.hostRevision;
        projectSnapshot = finalState.project;
        const temporaryPresent = [...temporaryItemStableIds].some((stableId) => projectHasStableItem(finalState.project, stableId));
        checks.cleanup_temp_items_absent = !temporaryPresent;
        checks.cleanup_item_count_restored = baselineItemCount !== null && finalState.project.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint !== null && finalState.observed.projectFingerprint === baselineFingerprint;
        cleanupComplete = checks.cleanup_temp_items_absent
          && checks.cleanup_item_count_restored
          && checks.cleanup_fingerprint_restored;
      } catch (error) {
        cleanupErrors.push(`cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (broker !== null) {
      try { await broker.stop(); }
      catch (error) { cleanupErrors.push(`broker-stop: ${error instanceof Error ? error.message : String(error)}`); }
    }

    const ok = failureError === null
      && cleanupErrors.length === 0
      && cleanupComplete
      && checks.fixture_background_image_written === true
      && checks.fixture_foreground_image_written === true
      && checks.panel_negotiated_v17 === true
      && checks.panel_supports_v11_v17 === true
      && checks.host_probe === true
      && checks.baseline_blank === true
      && checks.background_source_import === true
      && checks.foreground_source_import === true
      && checks.target_comp_create === true
      && checks.background_layer_create === true
      && checks.foreground_layer_create === true
      && checks.opacity_keys_created === true
      && checks.p3_linear_structural === true
      && checks.p3_incoming_hold_structural === true
      && checks.p3_outgoing_hold_structural === true
      && checks.p3_restored_linear_structural === true
      && checks.p3_visual_artifact_emitted === true
      && checks.p4 === true;

    await writeJson(resultPath, {
      proofId: "M3_TEMPORAL_INTERPOLATION_P3_P4_REAL_AE",
      status: ok ? "VISUAL_REVIEW_REQUIRED" : "FAILURE",
      ok,
      visualReviewRequired: true,
      startedAt,
      completedAt: new Date().toISOString(),
      acceptedBaseline: {
        P1_P2_source_commit: "9b660195c265f35fff79616b1ae345c01aeaec78",
        P1_P2_control_commit: "bfa22a7f6f7254325899e6b3d3b07d14b2fdadd7",
        P1_P2_run: 34163522485,
        P1_P2_job: 101869972996,
        P1_P2_artifact: 10033403065,
        P1_P2_artifact_sha256: "a029092ae5a0b0a3f492abd3c71276816081d36b2b7e00e3ccc08a5537406977",
      },
      proofLevels: {
        P1_validation_rejection: true,
        P2_structural_readback: true,
        P3_visual_artifact_emitted: checks.p3_visual_artifact_emitted === true,
        P3_visual_proof: false,
        P4_failure_injection_rollback: checks.p4 === true,
        P5_save_reopen_reconnect_transfer: false,
      },
      panel,
      environment,
      fixture: {
        backgroundSourceStable,
        foregroundSourceStable,
        targetCompStable,
        backgroundLayerStable,
        foregroundLayerStable,
        propertyPath,
        keyIndex,
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.5, value: 100 },
          { time: 1, value: 0 },
        ],
      },
      visualReviewSpec: {
        linearRender: linearRenderPath,
        incomingHoldRender: incomingHoldRenderPath,
        outgoingHoldRender: outgoingHoldRenderPath,
        restoredLinearRender: restoredLinearRenderPath,
        postRollbackRender: postRollbackRenderPath,
        sampleTimesSeconds: [0.25, 0.75],
        expected: [
          "linearRender must show a visible foreground/background blend near both 0.25 s and 0.75 s",
          "incomingHoldRender must hold the background-dominant state before the 0.5 s key while retaining the linear outgoing fade after it",
          "outgoingHoldRender must retain the linear incoming blend before 0.5 s while holding the foreground-dominant state after it until the final key",
          "restoredLinearRender must return to the same visible ramp behavior as linearRender",
          "postRollbackRender must match restoredLinearRender after the induced outgoing-HOLD mutation self-rolls back",
        ],
      },
      cleanupComplete,
      cleanupUndoCount,
      checks,
      responses,
      failureError,
      cleanupErrors,
    });
    if (!ok) process.exitCode = 1;
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
