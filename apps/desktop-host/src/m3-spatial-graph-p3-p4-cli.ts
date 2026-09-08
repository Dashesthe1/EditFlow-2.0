import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  type AeAdapterPublicCommandV11,
  type AeAdapterResponseV11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19,
  type AeSpatialGraphObservedStateV19,
  type AeSpatialGraphResponseV19,
  type AeSpatialGraphSetStateV19,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_9.js";
import { buildSpatialGraphRequestV19 } from "../../../packages/adapters/ae-cep/src/m3-spatial-graph.js";
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

interface AcceptedP1P2Artifact {
  readonly proofId: "M3_SPATIAL_GRAPH_P1_P2_REAL_AE";
  readonly status: "PASS";
  readonly ok: true;
  readonly cleanupComplete: true;
  readonly proofLevels: {
    readonly P1_validation_rejection: true;
    readonly P2_structural_readback: true;
    readonly P3_visual_proof: false;
    readonly P4_failure_injection_rollback: false;
    readonly P5_save_reopen_reconnect_transfer: false;
  };
  readonly completedAt?: string;
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

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const nestedRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = asRecord(value);
  return record === null ? null : asRecord(record[key]);
};

const parseConfig = (value: unknown): BridgeConfigFile => {
  const candidate = asRecord(value);
  if (candidate === null) throw new Error("Bridge config must be an object.");
  if (candidate["schemaVersion"] !== 1 || candidate["host"] !== "127.0.0.1") throw new Error("Bridge config schema/host is invalid.");
  if (!Number.isInteger(candidate["port"]) || (candidate["port"] as number) < 1 || (candidate["port"] as number) > 65535) throw new Error("Bridge config port is invalid.");
  if (typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("Bridge token is invalid.");
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("Bridge legacy protocolVersion mismatch.");
  const supported = candidate["supportedProtocolVersions"];
  if (!Array.isArray(supported)
      || !supported.includes(AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("Bridge config does not advertise required 1.9 and 1.1 protocols.");
  }
  if (typeof candidate["extensionId"] !== "string" || candidate["extensionId"].length === 0) throw new Error("Bridge extensionId is missing.");
  if (typeof candidate["extensionVersion"] !== "string" || candidate["extensionVersion"].length === 0) throw new Error("Bridge extensionVersion is missing.");
  return candidate as unknown as BridgeConfigFile;
};

const parseAcceptedP1P2 = (value: unknown): AcceptedP1P2Artifact => {
  const candidate = asRecord(value);
  if (candidate === null) throw new Error("Accepted P1/P2 artifact must be an object.");
  if (candidate["proofId"] !== "M3_SPATIAL_GRAPH_P1_P2_REAL_AE"
      || candidate["status"] !== "PASS"
      || candidate["ok"] !== true
      || candidate["cleanupComplete"] !== true) {
    throw new Error("Accepted spatial P1/P2 artifact identity/status is invalid.");
  }
  const proofLevels = asRecord(candidate["proofLevels"]);
  if (proofLevels === null
      || proofLevels["P1_validation_rejection"] !== true
      || proofLevels["P2_structural_readback"] !== true
      || proofLevels["P3_visual_proof"] !== false
      || proofLevels["P4_failure_injection_rollback"] !== false
      || proofLevels["P5_save_reopen_reconnect_transfer"] !== false) {
    throw new Error("Accepted spatial P1/P2 artifact proof-level contract is invalid.");
  }
  return candidate as unknown as AcceptedP1P2Artifact;
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const closeNumber = (left: number, right: number): boolean => Math.abs(left - right) <= 0.000001;

const vectorMatches = (actual: readonly number[], expected: readonly number[]): boolean =>
  actual.length === expected.length && actual.every((value, index) => {
    const target = expected[index];
    return target !== undefined && closeNumber(value, target);
  });

const spatialStateFromResponse = (response: AeSpatialGraphResponseV19): AeSpatialGraphObservedStateV19 | null => {
  const spatial = nestedRecord(response.readback, "spatialGraph");
  const state = spatial === null ? null : asRecord(spatial["state"]);
  if (state === null || !Array.isArray(state["inTangent"]) || !Array.isArray(state["outTangent"])) return null;
  if (typeof state["continuous"] !== "boolean" || typeof state["autoBezier"] !== "boolean" || typeof state["roving"] !== "boolean") return null;
  if (!(state["inTangent"] as unknown[]).every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  if (!(state["outTangent"] as unknown[]).every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return state as unknown as AeSpatialGraphObservedStateV19;
};

const spatialStatesEqual = (left: AeSpatialGraphObservedStateV19, right: AeSpatialGraphObservedStateV19): boolean =>
  left.continuous === right.continuous
  && left.autoBezier === right.autoBezier
  && left.roving === right.roving
  && vectorMatches(left.inTangent, right.inTangent)
  && vectorMatches(left.outTangent, right.outTangent);

const manualStateMatches = (
  response: AeSpatialGraphResponseV19,
  expected: Extract<AeSpatialGraphSetStateV19, { readonly mode: "MANUAL" }>,
): boolean => {
  const actual = spatialStateFromResponse(response);
  return actual !== null
    && actual.autoBezier === false
    && actual.continuous === expected.continuous
    && actual.roving === expected.roving
    && vectorMatches(actual.inTangent, expected.inTangent)
    && vectorMatches(actual.outTangent, expected.outTangent);
};

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const fileExistsNonEmpty = async (filePath: string): Promise<boolean> => {
  try { return (await stat(filePath)).size > 0; } catch { return false; }
};

const parseRenderCompletion = (value: unknown): RenderCompletionFile => {
  const candidate = asRecord(value);
  if (candidate === null || candidate["schemaVersion"] !== 1) throw new Error("Render completion marker is invalid.");
  if (typeof candidate["jobId"] !== "string" || candidate["jobId"].length === 0) throw new Error("Render completion marker is missing jobId.");
  if (candidate["status"] !== "DONE" && candidate["status"] !== "FAILED") throw new Error("Render completion marker has invalid status.");
  if (typeof candidate["ok"] !== "boolean" || typeof candidate["outputPath"] !== "string" || typeof candidate["completedAtMs"] !== "number" || typeof candidate["queueItemRemoved"] !== "boolean") {
    throw new Error("Render completion marker fields are invalid.");
  }
  if (candidate["error"] !== null && typeof candidate["error"] !== "string") throw new Error("Render completion marker error is invalid.");
  return candidate as unknown as RenderCompletionFile;
};

const waitForRenderCompletion = async (completionPath: string, expectedJobId: string, timeoutMs: number): Promise<RenderCompletionFile> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const completion = parseRenderCompletion(JSON.parse(stripUtf8Bom(await readFile(completionPath, "utf8"))) as unknown);
      if (completion.jobId === expectedJobId) return completion;
      lastError = `stale completion marker jobId '${completion.jobId}'`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(200);
  }
  throw new Error(`RENDER_JOB_COMPLETION_TIMEOUT: ${expectedJobId}${lastError ? ` (${lastError})` : ""}`);
};

const createBmp24 = (width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number]): Buffer => {
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

const sameFilesystemPath = (left: string, right: string): boolean => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const projectHasStableItem = (project: AeProjectSnapshot | null, stableId: string): boolean => project?.items.some((item) => item.stableId === stableId) ?? false;

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const acceptedP1P2Path = requireArgument("--accepted-p1-p2");
  const timeoutMs = Number(argument("--timeout-ms") ?? "240000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const acceptedBytes = await readFile(acceptedP1P2Path);
  const acceptedP1P2 = parseAcceptedP1P2(JSON.parse(stripUtf8Bom(acceptedBytes.toString("utf8"))) as unknown);
  const acceptedP1P2Sha256 = createHash("sha256").update(acceptedBytes).digest("hex");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const backgroundSourcePath = path.join(artifactDir, "p3-background-source.bmp");
  const foregroundSourcePath = path.join(artifactDir, "p3-marker-source.bmp");
  const baselineRenderPath = path.join(artifactDir, "p3-straight-baseline.avi");
  const curvedRenderPath = path.join(artifactDir, "p3-curved-spatial-path.avi");
  const restoredBaselineRenderPath = path.join(artifactDir, "p3-restored-straight-baseline.avi");
  const postRollbackRenderPath = path.join(artifactDir, "p4-post-rollback-straight-baseline.avi");

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

  const projectId = "m3-spatial-graph-p3-p4-real-ae";
  const prefix = `M3_SPATIAL_GRAPH_P34_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const backgroundSourceStable = `${prefix}_BACKGROUND_SOURCE`;
  const foregroundSourceStable = `${prefix}_FOREGROUND_SOURCE`;
  const targetCompStable = `${prefix}_TARGET_COMP`;
  const backgroundLayerStable = `${prefix}_BACKGROUND_LAYER`;
  const foregroundLayerStable = `${prefix}_FOREGROUND_LAYER`;
  const temporaryItemStableIds = new Set([backgroundSourceStable, foregroundSourceStable, targetCompStable]);
  const propertyPath = ["ADBE Transform Group", "ADBE Position"] as const;
  const middleKeyIndex = 2;
  let operationCounter = 0;
  let requestCounter = 0;

  const zeroState: Extract<AeSpatialGraphSetStateV19, { readonly mode: "MANUAL" }> = {
    mode: "MANUAL",
    inTangent: [0, 0, 0],
    outTangent: [0, 0, 0],
    continuous: false,
    roving: false,
  };
  const curvedState: Extract<AeSpatialGraphSetStateV19, { readonly mode: "MANUAL" }> = {
    mode: "MANUAL",
    inTangent: [-150, -220, 0],
    outTangent: [150, 220, 0],
    continuous: false,
    roving: false,
  };
  const inducedState: Extract<AeSpatialGraphSetStateV19, { readonly mode: "MANUAL" }> = {
    mode: "MANUAL",
    inTangent: [-180, 170, 0],
    outTangent: [180, -170, 0],
    continuous: false,
    roving: false,
  };

  const recordResponse = (response: AeAdapterResponseV11 | AeSpatialGraphResponseV19): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command: response.command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
      notes: response.diagnostics.notes ?? [],
    });
  };

  const refreshState = async (): Promise<void> => {
    if (client === null) throw new Error("M3 spatial P3/P4 client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
    projectSnapshot = observed.project;
  };

  const executeV11 = async (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>, refreshAfter = true): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M3 spatial P3/P4 V11 state is not initialized.");
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_OP_${++operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M3_SPATIAL_GRAPH_P3_P4_SETUP",
    });
    recordResponse(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`${command} failed: ${response.error?.code ?? response.outcome}`);
    if (refreshAfter) await refreshState();
    return response;
  };

  const targetPayload = (keyIndex = middleKeyIndex): Readonly<Record<string, unknown>> => ({
    comp: { stableId: targetCompStable },
    layer: { stableId: foregroundLayerStable },
    propertyPath,
    keyIndex,
  });

  const dispatchV19 = async (
    command: "property.spatial_graph.set" | "property.spatial_graph.readback",
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_SPATIAL_GRAPH_P3_P4_STRUCTURAL",
  ): Promise<AeSpatialGraphResponseV19> => {
    if (broker === null) throw new Error("Protocol 1.9 broker is unavailable.");
    const request = buildSpatialGraphRequestV19({
      requestId: `m3-spatial-graph-p34-v19-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V19_OP_${++operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    });
    const response = await broker.dispatch(request);
    recordResponse(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const setSpatialExact = async (
    keyIndex: number,
    desired: Extract<AeSpatialGraphSetStateV19, { readonly mode: "MANUAL" }>,
  ): Promise<AeSpatialGraphResponseV19> => {
    if (hostRevision === null) throw new Error("Host revision unavailable before spatial mutation.");
    const response = await dispatchV19("property.spatial_graph.set", { ...targetPayload(keyIndex), state: desired }, hostRevision);
    if ((response.outcome !== "APPLIED" && response.outcome !== "NO_OP") || !manualStateMatches(response, desired)) {
      throw new Error(`Spatial graph did not reach requested state at key ${keyIndex}.`);
    }
    await refreshState();
    return response;
  };

  const readSpatial = async (keyIndex = middleKeyIndex): Promise<AeSpatialGraphResponseV19> =>
    dispatchV19("property.spatial_graph.readback", targetPayload(keyIndex), null);

  const renderComp = async (outputPath: string): Promise<RenderCompletionFile> => {
    const scheduled = await executeV11("render.capture", {
      comp: { stableId: targetCompStable },
      outputPath,
      timeSpanStart: 0,
      timeSpanDuration: 1,
    }, false);
    const readback = asRecord(scheduled.readback);
    const jobId = readback?.["jobId"];
    const completionPath = readback?.["completionPath"];
    const requestedOutputPath = readback?.["requestedOutputPath"];
    const canonicalOutputPath = readback?.["outputPath"];
    if (typeof jobId !== "string" || typeof completionPath !== "string") throw new Error("render.capture did not return jobId/completionPath.");
    if (typeof requestedOutputPath !== "string" || !sameFilesystemPath(requestedOutputPath, outputPath)) throw new Error("render.capture requested output-path readback mismatch.");
    if (typeof canonicalOutputPath !== "string" || canonicalOutputPath.length === 0) throw new Error("render.capture did not return canonical output path.");
    const relativeArtifactPath = path.relative(artifactDir, canonicalOutputPath);
    if (relativeArtifactPath.startsWith("..") || path.isAbsolute(relativeArtifactPath)) throw new Error(`Render output escaped proof artifact directory: ${canonicalOutputPath}`);
    const completion = await waitForRenderCompletion(completionPath, jobId, timeoutMs);
    if (!completion.ok || completion.status !== "DONE" || !completion.queueItemRemoved) throw new Error(`Render job ${jobId} failed: ${completion.error ?? completion.status}`);
    if (!sameFilesystemPath(completion.outputPath, canonicalOutputPath)) throw new Error("Render completion path does not match canonical path.");
    if (!(await fileExistsNonEmpty(completion.outputPath))) throw new Error(`Render output is missing or empty: ${completion.outputPath}`);
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
      recordResponse(response);
      cleanupUndoCount += 1;
      if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`Cleanup undo failed: ${response.error?.code ?? response.outcome}`);
    }
    throw new Error("Cleanup undo budget exhausted before the exact baseline project was restored.");
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(backgroundSourcePath, createBmp24(640, 360, (x, y) => {
      const grid = x % 80 <= 1 || y % 60 <= 1;
      const centerLine = Math.abs(y - 180) <= 1;
      if (centerLine) return [52, 112, 148];
      if (grid) return [38, 48, 58];
      return [18, 24, 30];
    }));
    await writeFile(foregroundSourcePath, createBmp24(48, 48, (x, y) => {
      const border = x < 3 || y < 3 || x >= 45 || y >= 45;
      if (border) return [255, 255, 255];
      return (x + y) % 12 < 6 ? [255, 208, 32] : [36, 220, 238];
    }));
    checks.fixture_background_image_written = (await stat(backgroundSourcePath)).size > 54;
    checks.fixture_foreground_image_written = (await stat(foregroundSourcePath)).size > 54;
    checks.accepted_p1_p2_artifact_verified = acceptedP1P2.ok === true && acceptedP1P2.cleanupComplete === true;

    const config = parseConfig(JSON.parse(stripUtf8Bom(await readFile(configPath, "utf8"))) as unknown);
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 30_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);
    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v19 = panel.protocolVersion === AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19;
    checks.panel_supports_v11_v19 = panel.supportedProtocolVersions.includes(AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v19 || !checks.panel_supports_v11_v19) throw new Error("Spatial P3/P4 requires negotiated 1.9 with 1.1 compatibility.");
    if (panel.extensionVersion !== config.extensionVersion) throw new Error("Registered CEP panel version does not match installed config.");

    client = new AeCepAdapterClientV11(broker, () => `m3-spatial-graph-p34-setup-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects" && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    projectSnapshot = baseline.project;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;
    checks.baseline_blank = baseline.project.itemCount === 0 && baseline.project.filePath === null;
    if (!checks.baseline_blank) throw new Error("Spatial P3/P4 requires the isolated blank unsaved AE baseline.");

    const backgroundImport = await executeV11("media.import", { path: backgroundSourcePath, stableId: backgroundSourceStable, sequence: false });
    checks.background_source_import = backgroundImport.affectedObjects.some((item) => item.stableId === backgroundSourceStable && item.kind === "FOOTAGE");
    const foregroundImport = await executeV11("media.import", { path: foregroundSourcePath, stableId: foregroundSourceStable, sequence: false });
    checks.foreground_source_import = foregroundImport.affectedObjects.some((item) => item.stableId === foregroundSourceStable && item.kind === "FOOTAGE");
    const target = await executeV11("comp.create", {
      stableId: targetCompStable,
      name: `${prefix} Spatial Path Visual`,
      width: 640,
      height: 360,
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
        { time: 0, value: [96, 180] },
        { time: 0.5, value: [320, 180] },
        { time: 1, value: [544, 180] },
      ],
    });
    checks.position_keys_created = true;

    await setSpatialExact(1, zeroState);
    await setSpatialExact(2, zeroState);
    await setSpatialExact(3, zeroState);
    const baselineRead = await readSpatial(2);
    checks.p3_baseline_state_captured = baselineRead.outcome === "NO_OP" && manualStateMatches(baselineRead, zeroState);
    checks.p3_baseline_three_d_spatial = nestedRecord(baselineRead.readback, "spatialGraph") !== null
      && nestedRecord(nestedRecord(baselineRead.readback, "spatialGraph")?.["property"], "__never__") === null
      && (nestedRecord(baselineRead.readback, "spatialGraph")?.["property"] as Record<string, unknown> | undefined)?.["dimensions"] === 3;
    if (!checks.p3_baseline_state_captured) throw new Error("Unable to establish deterministic straight spatial baseline.");

    const baselineCompletion = await renderComp(baselineRenderPath);
    checks.p3_baseline_artifact = await fileExistsNonEmpty(baselineCompletion.outputPath);

    const curvedSet = await setSpatialExact(2, curvedState);
    checks.p3_contrast_state_differs_from_baseline = !manualStateMatches(curvedSet, zeroState) && manualStateMatches(curvedSet, curvedState);
    const curvedCompletion = await renderComp(curvedRenderPath);
    checks.p3_contrast_artifact = await fileExistsNonEmpty(curvedCompletion.outputPath);

    const restoredSet = await setSpatialExact(2, zeroState);
    checks.p3_restored_baseline_structural = manualStateMatches(restoredSet, zeroState);
    const restoredCompletion = await renderComp(restoredBaselineRenderPath);
    checks.p3_restored_baseline_artifact = await fileExistsNonEmpty(restoredCompletion.outputPath);
    checks.p3_visual_artifact_emitted = checks.p3_baseline_artifact === true
      && checks.p3_contrast_artifact === true
      && checks.p3_restored_baseline_artifact === true;

    const beforeFailure = await client.observe(projectId);
    state = beforeFailure.observed;
    hostRevision = beforeFailure.hostRevision;
    projectSnapshot = beforeFailure.project;
    const beforeFailureReadback = await readSpatial(2);
    const baselineObserved = spatialStateFromResponse(beforeFailureReadback);
    checks.p4_baseline_state_exact = beforeFailureReadback.outcome === "NO_OP"
      && manualStateMatches(beforeFailureReadback, zeroState)
      && baselineObserved !== null;

    if (hostRevision === null) throw new Error("Host revision unavailable before P4 failure injection.");
    const inducedFailure = await dispatchV19(
      "property.spatial_graph.set",
      { ...targetPayload(2), state: inducedState },
      hostRevision,
      "M3_SPATIAL_GRAPH_P4_FAILURE_INJECTION",
    );
    checks.p4_induced_failure_reported = inducedFailure.outcome === "FAILED"
      && inducedFailure.error?.category === "PROOF_INJECTION"
      && inducedFailure.error?.code === "M3_SPATIAL_GRAPH_P4_INDUCED_FAILURE";
    checks.p4_rollback_note = inducedFailure.diagnostics.notes.includes("Spatial Graph Editor mutation failed after a verified write and the exact prior spatial state was restored by structural rollback.");
    checks.p4_response_readback_restored = manualStateMatches(inducedFailure, zeroState);

    const afterFailure = await client.observe(projectId);
    state = afterFailure.observed;
    hostRevision = afterFailure.hostRevision;
    projectSnapshot = afterFailure.project;
    checks.p4_fingerprint_restored = afterFailure.observed.projectFingerprint === beforeFailure.observed.projectFingerprint;
    checks.p4_item_count_unchanged = afterFailure.project.itemCount === beforeFailure.project.itemCount;
    const afterFailureReadback = await readSpatial(2);
    const afterObserved = spatialStateFromResponse(afterFailureReadback);
    checks.p4_structural_state_restored = afterFailureReadback.outcome === "NO_OP"
      && manualStateMatches(afterFailureReadback, zeroState)
      && baselineObserved !== null
      && afterObserved !== null
      && spatialStatesEqual(afterObserved, baselineObserved);
    const recoveryCompletion = await renderComp(postRollbackRenderPath);
    checks.p4_recovery_visual_artifact_emitted = await fileExistsNonEmpty(recoveryCompletion.outputPath);
    checks.p4 = checks.p4_baseline_state_exact === true
      && checks.p4_induced_failure_reported === true
      && checks.p4_rollback_note === true
      && checks.p4_response_readback_restored === true
      && checks.p4_fingerprint_restored === true
      && checks.p4_item_count_unchanged === true
      && checks.p4_structural_state_restored === true
      && checks.p4_recovery_visual_artifact_emitted === true;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    if (client !== null) {
      try {
        await restoreBaselineThroughUndo();
        const finalState = await client.observe(projectId);
        const temporaryPresent = [...temporaryItemStableIds].some((stableId) => projectHasStableItem(finalState.project, stableId));
        checks.cleanup_temp_items_absent = !temporaryPresent;
        checks.cleanup_item_count_restored = baselineItemCount !== null && finalState.project.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint !== null && finalState.observed.projectFingerprint === baselineFingerprint;
        cleanupComplete = checks.cleanup_temp_items_absent === true
          && checks.cleanup_item_count_restored === true
          && checks.cleanup_fingerprint_restored === true;
      } catch (error) {
        cleanupErrors.push(`cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (broker !== null) {
      try { await broker.stop(); } catch (error) { cleanupErrors.push(`broker-stop: ${error instanceof Error ? error.message : String(error)}`); }
    }

    const ok = failureError === null
      && cleanupErrors.length === 0
      && cleanupComplete
      && checks.accepted_p1_p2_artifact_verified === true
      && checks.fixture_background_image_written === true
      && checks.fixture_foreground_image_written === true
      && checks.panel_negotiated_v19 === true
      && checks.panel_supports_v11_v19 === true
      && checks.host_probe === true
      && checks.baseline_blank === true
      && checks.background_source_import === true
      && checks.foreground_source_import === true
      && checks.target_comp_create === true
      && checks.background_layer_create === true
      && checks.foreground_layer_create === true
      && checks.position_keys_created === true
      && checks.p3_baseline_state_captured === true
      && checks.p3_contrast_state_differs_from_baseline === true
      && checks.p3_restored_baseline_structural === true
      && checks.p3_visual_artifact_emitted === true
      && checks.p4 === true;

    await writeJson(resultPath, {
      proofId: "M3_SPATIAL_GRAPH_P3_P4_REAL_AE",
      status: ok ? "VISUAL_REVIEW_REQUIRED" : "FAILURE",
      ok,
      visualReviewRequired: true,
      startedAt,
      completedAt: new Date().toISOString(),
      acceptedP1P2: {
        path: acceptedP1P2Path,
        sha256: acceptedP1P2Sha256,
        completedAt: acceptedP1P2.completedAt ?? null,
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
        keyIndex: middleKeyIndex,
        keyframes: [
          { time: 0, value: [96, 180] },
          { time: 0.5, value: [320, 180] },
          { time: 1, value: [544, 180] },
        ],
        zeroState,
        curvedState,
        inducedState,
      },
      visualReviewSpec: {
        baselineRender: baselineRenderPath,
        curvedRender: curvedRenderPath,
        restoredBaselineRender: restoredBaselineRenderPath,
        postRollbackRender: postRollbackRenderPath,
        sampleTimesSeconds: [0, 0.25, 0.5, 0.75, 1],
        expected: [
          "baselineRender keeps the marker on the horizontal center guide between identical Position key values/times and zero manual spatial tangents",
          "curvedRender must visibly depart from the horizontal baseline at one or more intermediate frames while preserving the exact same keyframe times and Position values",
          "restoredBaselineRender must return to the straight baseline after zero spatial tangents are restored",
          "postRollbackRender must visually match the restored baseline after the proof-gated post-verification spatial mutation fails and exact prior state is structurally restored",
          "P3 remains false until retained renders are decoded and independently reviewed; artifact existence alone is not visual acceptance",
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
