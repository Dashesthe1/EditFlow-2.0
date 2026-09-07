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
  AE_PARENTING_PROTOCOL_VERSION_V14,
  type AeParentingCommandV14,
  type AeParentingResponseV14,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_4.js";
import { buildParentingRequestV14 } from "../../../packages/adapters/ae-cep/src/m3-parenting.js";
import type { ObservedProjectState } from "../../../packages/core-contracts/src/index.js";
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

type PointMap = Readonly<Record<"topLeft" | "topRight" | "bottomRight" | "bottomLeft" | "center", readonly number[]>>;

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
      || !supported.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise both required parenting 1.4 and baseline 1.1 protocols.");
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

const parentingRecord = (response: AeParentingResponseV14): Record<string, unknown> | null =>
  nestedRecord(response.readback, "parenting");

const objectRef = (record: Record<string, unknown> | null, key: string): Record<string, unknown> | null =>
  record === null ? null : asRecord(record[key]);

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
      if (completion.jobId !== expectedJobId) {
        lastError = `stale completion marker jobId '${completion.jobId}'`;
      } else if (completion.status === "DONE" || completion.status === "FAILED") {
        return completion;
      }
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

const numericPoint = (value: unknown): readonly number[] | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  if (value.some((item) => typeof item !== "number" || !Number.isFinite(item))) return null;
  return value as number[];
};

const geometryPoints = (parenting: Record<string, unknown> | null): PointMap | null => {
  if (parenting === null) return null;
  const geometry = asRecord(parenting["compSpaceGeometry"]);
  if (geometry?.["supported"] !== true) return null;
  const points = asRecord(geometry["points"]);
  if (points === null) return null;
  const topLeft = numericPoint(points["topLeft"]);
  const topRight = numericPoint(points["topRight"]);
  const bottomRight = numericPoint(points["bottomRight"]);
  const bottomLeft = numericPoint(points["bottomLeft"]);
  const center = numericPoint(points["center"]);
  if (!topLeft || !topRight || !bottomRight || !bottomLeft || !center) return null;
  return { topLeft, topRight, bottomRight, bottomLeft, center };
};

const pointsClose = (left: readonly number[], right: readonly number[], tolerance = 0.05): boolean =>
  left.length === right.length && left.every((value, index) => Math.abs(value - right[index]!) <= tolerance);

const geometryClose = (left: PointMap | null, right: PointMap | null, tolerance = 0.05): boolean => {
  if (left === null || right === null) return false;
  return (Object.keys(left) as Array<keyof PointMap>).every((key) => pointsClose(left[key], right[key], tolerance));
};

const stableJson = (value: unknown): string => JSON.stringify(value);

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "180000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const sourcePath = path.join(artifactDir, "p3-parenting-source.bmp");
  const initialRenderPath = path.join(artifactDir, "p3-initial.avi");
  const parentedRenderPath = path.join(artifactDir, "p3-parented.avi");
  const clearedRenderPath = path.join(artifactDir, "p3-cleared.avi");
  const recoveryRenderPath = path.join(artifactDir, "p4-post-rollback.avi");

  const checks: Record<string, boolean> = {};
  const responses: RecordedResponse[] = [];
  const cleanupErrors: string[] = [];
  let failureError: string | null = null;
  let cleanupComplete = false;
  let broker: LoopbackCepBroker | null = null;
  let client: AeCepAdapterClientV11 | null = null;
  let state: ObservedProjectState | null = null;
  let hostRevision: number | null = null;
  let baselineFingerprint: string | null = null;
  let baselineItemCount: number | null = null;
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null;
  let environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;
  let initialParenting: Record<string, unknown> | null = null;
  let parentedParenting: Record<string, unknown> | null = null;
  let clearedParenting: Record<string, unknown> | null = null;
  let rollbackParenting: Record<string, unknown> | null = null;
  let initialArtifactPath: string | null = null;
  let parentedArtifactPath: string | null = null;
  let clearedArtifactPath: string | null = null;
  let recoveryArtifactPath: string | null = null;

  const projectId = "m3-parenting-p3-p4-real-ae";
  const prefix = `M3_PARENTING_P34_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceMediaStable = `${prefix}_SOURCE_MEDIA`;
  const targetCompStable = `${prefix}_TARGET_COMP`;
  const parentLayerStable = `${prefix}_PARENT_LAYER`;
  const childLayerStable = `${prefix}_CHILD_LAYER`;
  const temporaryItemStableIds = new Set([sourceMediaStable, targetCompStable]);
  const parentTransform = Object.freeze({ position: [430, 210], scale: [135, 80], rotation: 27, opacity: 0 });
  const childTransform = Object.freeze({ position: [220, 120], scale: [75, 125], rotation: -12, opacity: 100 });
  let operationCounter = 0;
  let requestCounter = 0;

  const recordV11 = (response: AeAdapterResponseV11): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command: response.command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
      notes: response.diagnostics.notes ?? [],
    });
  };

  const recordV14 = (response: AeParentingResponseV14): void => {
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
      readbackProfile: "M3_PARENTING_P3_P4_SETUP",
    });
    recordV11(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    }
    if (options.refreshAfter !== false) await refreshState();
    return response;
  };

  const dispatchV14 = async (
    command: AeParentingCommandV14,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_PARENTING_P3_P4_STRUCTURAL",
  ): Promise<AeParentingResponseV14> => {
    if (broker === null) throw new Error("M3 parenting broker is not initialized.");
    operationCounter += 1;
    const request = buildParentingRequestV14({
      requestId: `m3-parenting-p34-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V14_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    });
    const response = await broker.dispatch(request);
    recordV14(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const sameFilesystemPath = (left: string, right: string): boolean =>
    path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

  const renderComp = async (outputPath: string): Promise<RenderCompletionFile> => {
    const scheduled = await executeV11("render.capture", {
      comp: { stableId: targetCompStable },
      outputPath,
      timeSpanStart: 0,
      timeSpanDuration: 1 / 24,
    }, { refreshAfter: false });
    const readback = asRecord(scheduled.readback);
    const jobId = readback?.["jobId"];
    const completionPath = readback?.["completionPath"];
    const canonicalOutputPath = readback?.["outputPath"];
    if (typeof jobId !== "string" || typeof completionPath !== "string" || typeof canonicalOutputPath !== "string") {
      throw new Error("render.capture did not return a complete scheduled-job readback.");
    }
    const completion = await waitForRenderCompletion(completionPath, jobId, timeoutMs);
    if (!completion.ok || completion.status !== "DONE") {
      throw new Error(`Render ${jobId} failed: ${completion.error ?? "unknown render error"}`);
    }
    if (!completion.queueItemRemoved) throw new Error(`Render ${jobId} did not remove its temporary render-queue item.`);
    if (!sameFilesystemPath(completion.outputPath, canonicalOutputPath)) {
      throw new Error(`Render ${jobId} completion output path did not match scheduled canonical output path.`);
    }
    if (!await fileExistsNonEmpty(completion.outputPath)) throw new Error(`Render ${jobId} output is missing or empty.`);
    await refreshState();
    return completion;
  };

  const undoUntilBaseline = async (): Promise<void> => {
    if (client === null) return;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const observed = await client.observe(projectId);
      state = observed.observed;
      hostRevision = observed.hostRevision;
      const temporaryPresent = observed.project.items.some((item) =>
        typeof item.stableId === "string" && temporaryItemStableIds.has(item.stableId));
      if (!temporaryPresent) {
        checks.cleanup_temp_items_absent = true;
        checks.cleanup_item_count_restored = baselineItemCount === null || observed.project.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint === null || observed.observed.projectFingerprint === baselineFingerprint;
        cleanupComplete = checks.cleanup_item_count_restored && checks.cleanup_fingerprint_restored;
        return;
      }
      operationCounter += 1;
      const response = await client.undoLast({
        transactionId,
        operationId: `${transactionId}_CLEANUP_UNDO_${operationCounter}`,
        expectedState: state,
      });
      recordV11(response);
      if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
        throw new Error(`cleanup transaction.undo_last failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
      }
    }
    throw new Error("Cleanup did not return the temporary M3 parenting P3/P4 fixture to baseline within 24 Undo operations.");
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(sourcePath, createBmp24(320, 320, (x, y) => {
      if (x >= 140 && x < 180) return [240, 240, 240];
      if (y >= 145 && y < 160) return [15, 15, 15];
      if (x < 160 && y < 160) return [220, 40, 40];
      if (x >= 160 && y < 160) return [40, 220, 70];
      if (x < 160 && y >= 160) return [40, 80, 230];
      return [230, 210, 40];
    }));
    checks.fixture_image_written = (await stat(sourcePath)).size > 54;

    const configText = stripUtf8Bom(await readFile(configPath, "utf8"));
    const config = parseConfig(JSON.parse(configText) as unknown);
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 180_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_PARENTING_PROTOCOL_VERSION_V14, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v14 = panel.protocolVersion === AE_PARENTING_PROTOCOL_VERSION_V14;
    checks.panel_supports_v11_v14 = panel.supportedProtocolVersions.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v14 || !checks.panel_supports_v11_v14) {
      throw new Error(`Parenting P3/P4 proof requires negotiated protocol ${AE_PARENTING_PROTOCOL_VERSION_V14} with 1.1 compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-parenting-p34-setup-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects"
      && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;

    const sourceImport = await executeV11("media.import", {
      path: sourcePath,
      stableId: sourceMediaStable,
      sequence: false,
    });
    checks.source_import = sourceImport.affectedObjects.some((item) => item.stableId === sourceMediaStable && item.kind === "FOOTAGE");

    await executeV11("comp.create", {
      stableId: targetCompStable,
      name: `${prefix} Target`,
      width: 640,
      height: 360,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    await executeV11("layer.add_media", {
      stableId: parentLayerStable,
      comp: { stableId: targetCompStable },
      item: { stableId: sourceMediaStable },
    });
    await executeV11("layer.add_media", {
      stableId: childLayerStable,
      comp: { stableId: targetCompStable },
      item: { stableId: sourceMediaStable },
    });
    await executeV11("layer.set_transform", {
      comp: { stableId: targetCompStable },
      layer: { stableId: parentLayerStable },
      values: parentTransform,
    });
    await executeV11("layer.set_transform", {
      comp: { stableId: targetCompStable },
      layer: { stableId: childLayerStable },
      values: childTransform,
    });

    const initialRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: childLayerStable },
    }, null);
    initialParenting = parentingRecord(initialRead);
    const initialGeometry = geometryPoints(initialParenting);
    checks.p3_initial_geometry_available = initialRead.outcome === "NO_OP"
      && initialParenting?.["hasParent"] === false
      && initialParenting?.["parentLayer"] === null
      && initialGeometry !== null;
    if (!checks.p3_initial_geometry_available) throw new Error("Initial parenting geometry readback is unavailable.");

    const initialCompletion = await renderComp(initialRenderPath);
    initialArtifactPath = initialCompletion.outputPath;
    checks.p3_initial_render_emitted = initialCompletion.ok && await fileExistsNonEmpty(initialArtifactPath);

    const setParent = await dispatchV14("layer.set_parent_preserve_transform", {
      comp: { stableId: targetCompStable },
      layer: { stableId: childLayerStable },
      parentLayer: { stableId: parentLayerStable },
    }, hostRevision);
    parentedParenting = parentingRecord(setParent);
    const parentedGeometry = geometryPoints(parentedParenting);
    checks.p3_set_parent_exact = setParent.outcome === "APPLIED"
      && parentedParenting?.["hasParent"] === true
      && objectRef(parentedParenting, "layer")?.["stableId"] === childLayerStable
      && objectRef(parentedParenting, "parentLayer")?.["stableId"] === parentLayerStable;
    checks.p3_parented_multi_point_geometry_preserved = geometryClose(initialGeometry, parentedGeometry);
    if (!checks.p3_set_parent_exact || !checks.p3_parented_multi_point_geometry_preserved) {
      throw new Error("Parenting P3 set-parent geometry/readback invariant failed before render.");
    }

    const parentedCompletion = await renderComp(parentedRenderPath);
    parentedArtifactPath = parentedCompletion.outputPath;
    checks.p3_parented_render_emitted = parentedCompletion.ok && await fileExistsNonEmpty(parentedArtifactPath);

    const clearParent = await dispatchV14("layer.clear_parent_preserve_transform", {
      comp: { stableId: targetCompStable },
      layer: { stableId: childLayerStable },
    }, hostRevision);
    clearedParenting = parentingRecord(clearParent);
    const clearedGeometry = geometryPoints(clearedParenting);
    checks.p3_clear_parent_exact = clearParent.outcome === "APPLIED"
      && clearedParenting?.["hasParent"] === false
      && clearedParenting?.["parentLayer"] === null;
    checks.p3_cleared_multi_point_geometry_preserved = geometryClose(initialGeometry, clearedGeometry);
    if (!checks.p3_clear_parent_exact || !checks.p3_cleared_multi_point_geometry_preserved) {
      throw new Error("Parenting P3 clear-parent geometry/readback invariant failed before render.");
    }

    const clearedCompletion = await renderComp(clearedRenderPath);
    clearedArtifactPath = clearedCompletion.outputPath;
    checks.p3_cleared_render_emitted = clearedCompletion.ok && await fileExistsNonEmpty(clearedArtifactPath);
    checks.p3_visual_artifact_emitted = checks.p3_initial_render_emitted
      && checks.p3_parented_render_emitted
      && checks.p3_cleared_render_emitted;

    const beforeFailureRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: childLayerStable },
    }, null);
    const beforeFailureParenting = parentingRecord(beforeFailureRead);
    if (beforeFailureRead.outcome !== "NO_OP" || beforeFailureParenting === null) {
      throw new Error("P4 baseline parenting readback is unavailable.");
    }
    const beforeFailureJson = stableJson(beforeFailureParenting);
    const beforeFailureGeometry = geometryPoints(beforeFailureParenting);
    const beforeFailure = await client.observe(projectId);
    state = beforeFailure.observed;
    hostRevision = beforeFailure.hostRevision;

    const inducedFailure = await dispatchV14("layer.set_parent_preserve_transform", {
      comp: { stableId: targetCompStable },
      layer: { stableId: childLayerStable },
      parentLayer: { stableId: parentLayerStable },
    }, hostRevision, "M3_PARENTING_P4_FAILURE_INJECTION");
    checks.p4_induced_failure_reported = inducedFailure.outcome === "FAILED"
      && inducedFailure.error?.code === "M3_PARENTING_P4_INDUCED_FAILURE";
    checks.p4_self_rollback_note = inducedFailure.diagnostics.notes.includes("Failed parenting mutation self-rolled back with AE Undo.");
    rollbackParenting = parentingRecord(inducedFailure);
    checks.p4_failure_response_restored = rollbackParenting !== null
      && stableJson(rollbackParenting) === beforeFailureJson;
    checks.p4_failure_response_geometry_restored = geometryClose(beforeFailureGeometry, geometryPoints(rollbackParenting));

    const afterFailure = await client.observe(projectId);
    state = afterFailure.observed;
    hostRevision = afterFailure.hostRevision;
    checks.p4_fingerprint_restored = afterFailure.observed.projectFingerprint === beforeFailure.observed.projectFingerprint;

    const afterFailureRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: childLayerStable },
    }, null);
    const afterFailureParenting = parentingRecord(afterFailureRead);
    checks.p4_fresh_readback_restored = afterFailureRead.outcome === "NO_OP"
      && afterFailureParenting !== null
      && stableJson(afterFailureParenting) === beforeFailureJson;
    checks.p4_fresh_geometry_restored = geometryClose(beforeFailureGeometry, geometryPoints(afterFailureParenting));

    const recoveryCompletion = await renderComp(recoveryRenderPath);
    recoveryArtifactPath = recoveryCompletion.outputPath;
    checks.p4_recovery_render_emitted = recoveryCompletion.ok && await fileExistsNonEmpty(recoveryArtifactPath);
    checks.p4 = checks.p4_induced_failure_reported
      && checks.p4_self_rollback_note
      && checks.p4_failure_response_restored
      && checks.p4_failure_response_geometry_restored
      && checks.p4_fingerprint_restored
      && checks.p4_fresh_readback_restored
      && checks.p4_fresh_geometry_restored
      && checks.p4_recovery_render_emitted;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    try {
      await undoUntilBaseline();
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }

    if (client !== null) {
      try {
        const final = await client.observe(projectId);
        const temporaryPresent = final.project.items.some((item) =>
          typeof item.stableId === "string" && temporaryItemStableIds.has(item.stableId));
        checks.cleanup_temp_items_absent = !temporaryPresent;
        checks.cleanup_item_count_restored = baselineItemCount === null || final.project.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint === null || final.observed.projectFingerprint === baselineFingerprint;
        cleanupComplete = checks.cleanup_temp_items_absent && checks.cleanup_item_count_restored && checks.cleanup_fingerprint_restored;
      } catch (error) {
        cleanupErrors.push(`final inspect: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (broker !== null) await broker.stop();

    const ok = failureError === null
      && cleanupErrors.length === 0
      && cleanupComplete
      && checks.p3_initial_geometry_available === true
      && checks.p3_set_parent_exact === true
      && checks.p3_parented_multi_point_geometry_preserved === true
      && checks.p3_clear_parent_exact === true
      && checks.p3_cleared_multi_point_geometry_preserved === true
      && checks.p3_visual_artifact_emitted === true
      && checks.p4 === true;

    await writeJson(resultPath, {
      proofId: "M3_PARENTING_P3_P4_REAL_AE",
      status: ok ? "VISUAL_REVIEW_REQUIRED" : "FAILURE",
      ok,
      visualReviewRequired: true,
      startedAt,
      completedAt: new Date().toISOString(),
      cleanupComplete,
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
        sourcePath,
        sourceMediaStable,
        targetCompStable,
        parentLayerStable,
        childLayerStable,
        parentTransform,
        childTransform,
      },
      geometryEvidence: {
        initial: initialParenting,
        parented: parentedParenting,
        cleared: clearedParenting,
        rollback: rollbackParenting,
      },
      visualReviewSpec: {
        initialRender: initialArtifactPath,
        parentedRender: parentedArtifactPath,
        clearedRender: clearedArtifactPath,
        postRollbackRender: recoveryArtifactPath,
        requestedInitialRender: initialRenderPath,
        requestedParentedRender: parentedRenderPath,
        requestedClearedRender: clearedRenderPath,
        requestedPostRollbackRender: recoveryRenderPath,
        source: sourcePath,
        expectation: "Initial, parented, cleared, and post-rollback frames should be visually/pixel equivalent. The invisible transformed parent must not alter the visible child at the proof frame.",
      },
      checks,
      responses,
      failureError,
      cleanupErrors,
      notes: [
        "P1/P2 are accepted baseline evidence from main and are not replayed in this P3/P4 tranche.",
        "P3 requires five-point comp-space source geometry equality plus retained real-AE renders for initial, parented, and cleared states, but the harness does not self-claim visual acceptance.",
        "P4 is induced only when the runner-owned AE process inherits EDITFLOW_M3_PARENTING_P4_PROOF=1 and the typed set-parent request uses the exact M3_PARENTING_P4_FAILURE_INJECTION profile.",
        "The P4 error occurs after the real Layer.parent mutation inside the normal parenting undo group; the normal catch path must self-rollback with AE Undo and restore fingerprint plus exact parenting/geometry readback.",
        "P5 remains explicitly unclaimed and is a separate save/reopen/reconnect transfer tranche.",
      ],
    });
    if (!ok) process.exitCode = 1;
  }
};

void main().catch(async (error) => {
  const resultPath = argument("--result");
  if (resultPath) {
    try {
      await writeJson(resultPath, {
        proofId: "M3_PARENTING_P3_P4_REAL_AE",
        status: "HARNESS_FAILURE",
        ok: false,
        visualReviewRequired: false,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
        cleanupComplete: false,
      });
    } catch (_) {}
  }
  console.error(error);
  process.exitCode = 1;
});
