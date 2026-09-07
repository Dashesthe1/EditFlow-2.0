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
import {
  AE_NULL_RIG_PROTOCOL_VERSION_V15,
  type AeNullRigCommandV15,
  type AeNullRigResponseV15,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_5.js";
import { buildNullRigRequestV15 } from "../../../packages/adapters/ae-cep/src/m3-null-rig.js";
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
  if (!value) throw new Error(`Missing required argument ${name}.`);
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
      || !supported.includes(AE_NULL_RIG_PROTOCOL_VERSION_V15)
      || !supported.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise required null-rig 1.5, parenting 1.4, and baseline 1.1 protocols.");
  }
  if (typeof candidate["extensionId"] !== "string" || !candidate["extensionId"]) throw new Error("CEP extensionId is missing.");
  if (typeof candidate["extensionVersion"] !== "string" || !candidate["extensionVersion"]) throw new Error("CEP extensionVersion is missing.");
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
const nullRigRecord = (response: AeNullRigResponseV15): Record<string, unknown> | null => nestedRecord(response.readback, "nullRig");
const parentingRecord = (response: AeParentingResponseV14): Record<string, unknown> | null => nestedRecord(response.readback, "parenting");
const objectRef = (record: Record<string, unknown> | null, key: string): Record<string, unknown> | null =>
  record === null ? null : asRecord(record[key]);
const childStableIds = (rig: Record<string, unknown> | null): readonly string[] => {
  if (rig === null || !Array.isArray(rig["children"])) return [];
  return (rig["children"] as unknown[])
    .map((child) => asRecord(child)?.["stableId"])
    .filter((stableId): stableId is string => typeof stableId === "string");
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
  if (typeof candidate["jobId"] !== "string" || !candidate["jobId"]) throw new Error("Render completion marker is missing jobId.");
  if (candidate["status"] !== "DONE" && candidate["status"] !== "FAILED") throw new Error("Render completion marker has invalid status.");
  if (typeof candidate["ok"] !== "boolean") throw new Error("Render completion marker is missing ok.");
  if (typeof candidate["outputPath"] !== "string" || !candidate["outputPath"]) throw new Error("Render completion marker is missing outputPath.");
  if (candidate["error"] !== null && typeof candidate["error"] !== "string") throw new Error("Render completion marker has invalid error.");
  if (typeof candidate["completedAtMs"] !== "number") throw new Error("Render completion marker is missing completedAtMs.");
  if (typeof candidate["queueItemRemoved"] !== "boolean") throw new Error("Render completion marker is missing queueItemRemoved.");
  return candidate as unknown as RenderCompletionFile;
};
const waitForRenderCompletion = async (completionPath: string, expectedJobId: string, timeoutMs: number): Promise<RenderCompletionFile> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const completion = parseRenderCompletion(JSON.parse(stripUtf8Bom(await readFile(completionPath, "utf8"))) as unknown);
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
    const rowOffset = 54 + (height - 1 - y) * rowStride;
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
  const geometry = parenting === null ? null : asRecord(parenting["compSpaceGeometry"]);
  if (geometry?.["supported"] !== true) return null;
  const points = asRecord(geometry["points"]);
  if (!points) return null;
  const topLeft = numericPoint(points["topLeft"]);
  const topRight = numericPoint(points["topRight"]);
  const bottomRight = numericPoint(points["bottomRight"]);
  const bottomLeft = numericPoint(points["bottomLeft"]);
  const center = numericPoint(points["center"]);
  return topLeft && topRight && bottomRight && bottomLeft && center
    ? { topLeft, topRight, bottomRight, bottomLeft, center }
    : null;
};
const pointsClose = (left: readonly number[], right: readonly number[], tolerance = 0.05): boolean =>
  left.length === right.length && left.every((value, index) => Math.abs(value - right[index]!) <= tolerance);
const geometryClose = (left: PointMap | null, right: PointMap | null, tolerance = 0.05): boolean => {
  if (!left || !right) return false;
  return (Object.keys(left) as Array<keyof PointMap>).every((key) => pointsClose(left[key], right[key], tolerance));
};
const geometryMoved = (left: PointMap | null, right: PointMap | null, threshold = 24): boolean => {
  if (!left || !right) return false;
  let maximum = 0;
  for (const key of Object.keys(left) as Array<keyof PointMap>) {
    const a = left[key];
    const b = right[key];
    const dx = (a[0] ?? 0) - (b[0] ?? 0);
    const dy = (a[1] ?? 0) - (b[1] ?? 0);
    maximum = Math.max(maximum, Math.sqrt(dx * dx + dy * dy));
  }
  return maximum >= threshold;
};
const stableJson = (value: unknown): string => JSON.stringify(value);

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "180000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const sourcePath = path.join(artifactDir, "p3-null-source.bmp");
  const neutralRenderPath = path.join(artifactDir, "p3-attached-neutral.avi");
  const drivenRenderPath = path.join(artifactDir, "p3-rig-driven.avi");
  const detachedRenderPath = path.join(artifactDir, "p3-detached-preserved.avi");
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
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null;
  let environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;
  let baselineFingerprint: string | null = null;
  let baselineItemCount: number | null = null;
  let initialParenting: Record<string, unknown> | null = null;
  let neutralParenting: Record<string, unknown> | null = null;
  let drivenParenting: Record<string, unknown> | null = null;
  let detachedParenting: Record<string, unknown> | null = null;
  let neutralRigReadback: Record<string, unknown> | null = null;
  let drivenRigReadback: Record<string, unknown> | null = null;
  let detachedRigReadback: Record<string, unknown> | null = null;
  let rollbackRigReadback: Record<string, unknown> | null = null;
  let neutralArtifactPath: string | null = null;
  let drivenArtifactPath: string | null = null;
  let detachedArtifactPath: string | null = null;
  let recoveryArtifactPath: string | null = null;

  const projectId = "m3-null-rig-p3-p4-real-ae";
  const prefix = `M3_NULL_RIG_P34_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceMediaStable = `${prefix}_SOURCE_MEDIA`;
  const targetCompStable = `${prefix}_TARGET_COMP`;
  const childLayerStable = `${prefix}_CHILD_LAYER`;
  const rigStable = `${prefix}_RIG_MAIN`;
  const failedRigStable = `${prefix}_RIG_P4_FAIL`;
  const temporaryItemStableIds = new Set([sourceMediaStable, targetCompStable]);
  const childTransform = Object.freeze({ position: [180, 170], scale: [100, 100], rotation: 0, opacity: 100 });
  const drivenRigTransform = Object.freeze({ position: [455, 235], scale: [128, 128], rotation: 28, opacity: 0 });
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
  const recordV15 = (response: AeNullRigResponseV15): void => {
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
    if (!client) throw new Error("M2 setup client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
  };
  const executeV11 = async (
    command: AeAdapterPublicCommandV11,
    payload: Readonly<Record<string, unknown>>,
    options: { readonly refreshAfter?: boolean } = {},
  ): Promise<AeAdapterResponseV11> => {
    if (!client || !state) throw new Error("M2 setup state is not initialized.");
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_OP_${++operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M3_NULL_RIG_P3_P4_SETUP",
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
  ): Promise<AeParentingResponseV14> => {
    if (!broker) throw new Error("M3 null-rig broker is not initialized.");
    const response = await broker.dispatch(buildParentingRequestV14({
      requestId: `m3-null-rig-p34-parent-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V14_OP_${++operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_NULL_RIG_P3_P4_PARENTING",
    }));
    recordV14(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };
  const dispatchV15 = async (
    command: AeNullRigCommandV15,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_NULL_RIG_P3_P4_STRUCTURAL",
  ): Promise<AeNullRigResponseV15> => {
    if (!broker) throw new Error("M3 null-rig broker is not initialized.");
    const response = await broker.dispatch(buildNullRigRequestV15({
      requestId: `m3-null-rig-p34-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V15_OP_${++operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    }));
    recordV15(response);
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
    if (!completion.ok || completion.status !== "DONE") throw new Error(`Render ${jobId} failed: ${completion.error ?? "unknown render error"}`);
    if (!completion.queueItemRemoved) throw new Error(`Render ${jobId} did not remove its temporary render-queue item.`);
    if (!sameFilesystemPath(completion.outputPath, canonicalOutputPath)) throw new Error(`Render ${jobId} output path drifted.`);
    if (!await fileExistsNonEmpty(completion.outputPath)) throw new Error(`Render ${jobId} output is missing or empty.`);
    await refreshState();
    return completion;
  };

  const verifyBaselineOnly = async (): Promise<void> => {
    if (!client) return;
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
    const temporaryPresent = observed.project.items.some((item) => typeof item.stableId === "string" && temporaryItemStableIds.has(item.stableId));
    checks.cleanup_temp_items_absent = !temporaryPresent;
    checks.cleanup_item_count_restored = baselineItemCount === null || observed.project.itemCount === baselineItemCount;
    checks.cleanup_fingerprint_restored = baselineFingerprint === null || observed.observed.projectFingerprint === baselineFingerprint;
    cleanupComplete = checks.cleanup_temp_items_absent && checks.cleanup_item_count_restored && checks.cleanup_fingerprint_restored;
    if (!cleanupComplete) throw new Error("Proof-owned cleanup did not restore the original blank baseline.");
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(sourcePath, createBmp24(180, 110, (x, y) => {
      if (x < 25 || y < 15) return [235, 45, 45];
      if (x > 145 && y < 55) return [45, 220, 80];
      if (x < 80 && y > 72) return [50, 85, 235];
      if (x > 105 && y > 70) return [235, 205, 45];
      if (x >= 82 && x <= 98) return [245, 245, 245];
      return [35, 35, 35];
    }));
    checks.fixture_image_written = (await stat(sourcePath)).size > 54;

    const config = parseConfig(JSON.parse(stripUtf8Bom(await readFile(configPath, "utf8"))) as unknown);
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 180_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_NULL_RIG_PROTOCOL_VERSION_V15, AE_PARENTING_PROTOCOL_VERSION_V14, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v15 = panel.protocolVersion === AE_NULL_RIG_PROTOCOL_VERSION_V15;
    checks.panel_supports_v11_v14_v15 = panel.supportedProtocolVersions.includes(AE_NULL_RIG_PROTOCOL_VERSION_V15)
      && panel.supportedProtocolVersions.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v15 || !checks.panel_supports_v11_v14_v15) throw new Error("Null-rig P3/P4 protocol negotiation failed.");
    if (panel.extensionVersion !== config.extensionVersion) throw new Error("Registered CEP panel version does not match installed config.");

    client = new AeCepAdapterClientV11(broker, () => `m3-null-rig-p34-setup-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects" && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;
    checks.blank_unsaved_baseline = baseline.project.filePath === null && baseline.project.itemCount === 0;
    if (!checks.blank_unsaved_baseline) throw new Error("Null-rig P3/P4 proof requires a blank unsaved project.");

    const sourceImport = await executeV11("media.import", { path: sourcePath, stableId: sourceMediaStable, sequence: false });
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
      stableId: childLayerStable,
      comp: { stableId: targetCompStable },
      item: { stableId: sourceMediaStable },
    });
    await executeV11("layer.set_transform", {
      comp: { stableId: targetCompStable },
      layer: { stableId: childLayerStable },
      values: childTransform,
    });

    const createRig = await dispatchV15("rig.null.create", {
      comp: { stableId: targetCompStable },
      rig: { stableId: rigStable, name: `${prefix} Main Control` },
      threeDLayer: false,
    }, hostRevision);
    neutralRigReadback = nullRigRecord(createRig);
    checks.p3_true_null_created = createRig.outcome === "APPLIED"
      && neutralRigReadback?.["isNull"] === true
      && objectRef(neutralRigReadback, "layer")?.["stableId"] === rigStable;
    if (!checks.p3_true_null_created) throw new Error("P3 fixture did not create the exact managed true null.");
    await refreshState();

    const initialRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: childLayerStable },
    }, null);
    initialParenting = parentingRecord(initialRead);
    const initialGeometry = geometryPoints(initialParenting);
    checks.p3_initial_geometry_available = initialRead.outcome === "NO_OP" && initialGeometry !== null && initialParenting?.["hasParent"] === false;
    if (!checks.p3_initial_geometry_available) throw new Error("Initial visible-child geometry is unavailable.");

    const attach = await dispatchV14("layer.set_parent_preserve_transform", {
      comp: { stableId: targetCompStable },
      layer: { stableId: childLayerStable },
      parentLayer: { stableId: rigStable },
    }, hostRevision);
    neutralParenting = parentingRecord(attach);
    const neutralGeometry = geometryPoints(neutralParenting);
    checks.p3_attach_exact = attach.outcome === "APPLIED"
      && neutralParenting?.["hasParent"] === true
      && objectRef(neutralParenting, "parentLayer")?.["stableId"] === rigStable;
    checks.p3_attach_no_jump = geometryClose(initialGeometry, neutralGeometry);
    await refreshState();

    const topologyAttached = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetCompStable },
      rig: { stableId: rigStable },
    }, null);
    neutralRigReadback = nullRigRecord(topologyAttached);
    checks.p3_topology_attached = topologyAttached.outcome === "NO_OP" && childStableIds(neutralRigReadback).includes(childLayerStable);
    if (!checks.p3_attach_exact || !checks.p3_attach_no_jump || !checks.p3_topology_attached) throw new Error("P3 neutral attachment invariant failed.");

    const neutralCompletion = await renderComp(neutralRenderPath);
    neutralArtifactPath = neutralCompletion.outputPath;
    checks.p3_neutral_render_emitted = await fileExistsNonEmpty(neutralArtifactPath);

    await executeV11("layer.set_transform", {
      comp: { stableId: targetCompStable },
      layer: { stableId: rigStable },
      values: drivenRigTransform,
    });

    const drivenRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: childLayerStable },
    }, null);
    drivenParenting = parentingRecord(drivenRead);
    const drivenGeometry = geometryPoints(drivenParenting);
    checks.p3_rig_drive_geometry_moved = drivenRead.outcome === "NO_OP" && geometryMoved(neutralGeometry, drivenGeometry);
    const drivenTopology = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetCompStable },
      rig: { stableId: rigStable },
    }, null);
    drivenRigReadback = nullRigRecord(drivenTopology);
    checks.p3_rig_remains_true_null = drivenRigReadback?.["isNull"] === true;
    checks.p3_topology_still_attached = childStableIds(drivenRigReadback).includes(childLayerStable);
    if (!checks.p3_rig_drive_geometry_moved || !checks.p3_rig_remains_true_null || !checks.p3_topology_still_attached) {
      throw new Error("P3 managed null did not materially drive the visible child while retaining exact topology.");
    }

    const drivenCompletion = await renderComp(drivenRenderPath);
    drivenArtifactPath = drivenCompletion.outputPath;
    checks.p3_driven_render_emitted = await fileExistsNonEmpty(drivenArtifactPath);

    const detach = await dispatchV14("layer.clear_parent_preserve_transform", {
      comp: { stableId: targetCompStable },
      layer: { stableId: childLayerStable },
    }, hostRevision);
    detachedParenting = parentingRecord(detach);
    const detachedGeometry = geometryPoints(detachedParenting);
    checks.p3_detach_exact = detach.outcome === "APPLIED" && detachedParenting?.["hasParent"] === false && detachedParenting?.["parentLayer"] === null;
    checks.p3_detach_no_jump = geometryClose(drivenGeometry, detachedGeometry);
    await refreshState();

    const topologyDetached = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetCompStable },
      rig: { stableId: rigStable },
    }, null);
    detachedRigReadback = nullRigRecord(topologyDetached);
    checks.p3_topology_detached = topologyDetached.outcome === "NO_OP" && childStableIds(detachedRigReadback).length === 0;
    if (!checks.p3_detach_exact || !checks.p3_detach_no_jump || !checks.p3_topology_detached) throw new Error("P3 detach/no-jump invariant failed.");

    const detachedCompletion = await renderComp(detachedRenderPath);
    detachedArtifactPath = detachedCompletion.outputPath;
    checks.p3_detached_render_emitted = await fileExistsNonEmpty(detachedArtifactPath);
    checks.p3_visual_artifact_emitted = checks.p3_neutral_render_emitted && checks.p3_driven_render_emitted && checks.p3_detached_render_emitted;

    const beforeFailure = await client.observe(projectId);
    state = beforeFailure.observed;
    hostRevision = beforeFailure.hostRevision;
    const beforeFailureRig = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetCompStable },
      rig: { stableId: rigStable },
    }, null);
    const beforeFailureRigJson = stableJson(nullRigRecord(beforeFailureRig));

    const inducedFailure = await dispatchV15("rig.null.create", {
      comp: { stableId: targetCompStable },
      rig: { stableId: failedRigStable, name: `${prefix} P4 Failure Control` },
      threeDLayer: false,
    }, hostRevision, "M3_NULL_RIG_P4_FAILURE_INJECTION");
    checks.p4_induced_failure_reported = inducedFailure.outcome === "FAILED" && inducedFailure.error?.code === "M3_NULL_RIG_P4_INDUCED_FAILURE";
    checks.p4_self_rollback_note = inducedFailure.diagnostics.notes.includes("Failed null-rig mutation self-rolled back with AE Undo.");

    const afterFailure = await client.observe(projectId);
    state = afterFailure.observed;
    hostRevision = afterFailure.hostRevision;
    checks.p4_fingerprint_restored = afterFailure.observed.projectFingerprint === beforeFailure.observed.projectFingerprint;
    checks.p4_item_count_restored = afterFailure.project.itemCount === beforeFailure.project.itemCount;

    const absentFailedRig = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetCompStable },
      rig: { stableId: failedRigStable },
    }, null);
    checks.p4_failed_rig_absent = absentFailedRig.outcome === "REJECTED" && absentFailedRig.error?.code === "NULL_RIG_NOT_FOUND";

    const restoredMainRig = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetCompStable },
      rig: { stableId: rigStable },
    }, null);
    rollbackRigReadback = nullRigRecord(restoredMainRig);
    checks.p4_main_rig_readback_restored = restoredMainRig.outcome === "NO_OP" && stableJson(rollbackRigReadback) === beforeFailureRigJson;
    checks.p4_main_rig_topology_empty = childStableIds(rollbackRigReadback).length === 0;

    const recoveryCompletion = await renderComp(recoveryRenderPath);
    recoveryArtifactPath = recoveryCompletion.outputPath;
    checks.p4_recovery_render_emitted = await fileExistsNonEmpty(recoveryArtifactPath);
    checks.p4 = checks.p4_induced_failure_reported
      && checks.p4_self_rollback_note
      && checks.p4_fingerprint_restored
      && checks.p4_item_count_restored
      && checks.p4_failed_rig_absent
      && checks.p4_main_rig_readback_restored
      && checks.p4_main_rig_topology_empty
      && checks.p4_recovery_render_emitted;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    try { await verifyBaselineOnly(); }
    catch (error) { cleanupErrors.push(error instanceof Error ? error.message : String(error)); }

    if (client) {
      try {
        const final = await client.observe(projectId);
        const temporaryPresent = final.project.items.some((item) => typeof item.stableId === "string" && temporaryItemStableIds.has(item.stableId));
        checks.cleanup_temp_items_absent = !temporaryPresent;
        checks.cleanup_item_count_restored = baselineItemCount === null || final.project.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint === null || final.observed.projectFingerprint === baselineFingerprint;
        cleanupComplete = checks.cleanup_temp_items_absent && checks.cleanup_item_count_restored && checks.cleanup_fingerprint_restored;
      } catch (error) {
        cleanupErrors.push(`final inspect: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (broker) await broker.stop();

    const ok = failureError === null
      && cleanupErrors.length === 0
      && cleanupComplete
      && checks.p3_true_null_created === true
      && checks.p3_attach_no_jump === true
      && checks.p3_rig_drive_geometry_moved === true
      && checks.p3_detach_no_jump === true
      && checks.p3_visual_artifact_emitted === true
      && checks.p4 === true;

    await writeJson(resultPath, {
      proofId: "M3_NULL_RIG_P3_P4_REAL_AE",
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
        childLayerStable,
        rigStable,
        failedRigStable,
        childTransform,
        drivenRigTransform,
      },
      geometryEvidence: {
        initial: initialParenting,
        attachedNeutral: neutralParenting,
        rigDriven: drivenParenting,
        detachedPreserved: detachedParenting,
      },
      rigEvidence: {
        attachedNeutral: neutralRigReadback,
        rigDriven: drivenRigReadback,
        detached: detachedRigReadback,
        postRollback: rollbackRigReadback,
      },
      visualReviewSpec: {
        attachedNeutralRender: neutralArtifactPath,
        rigDrivenRender: drivenArtifactPath,
        detachedPreservedRender: detachedArtifactPath,
        postRollbackRender: recoveryArtifactPath,
        requestedAttachedNeutralRender: neutralRenderPath,
        requestedRigDrivenRender: drivenRenderPath,
        requestedDetachedPreservedRender: detachedRenderPath,
        requestedPostRollbackRender: recoveryRenderPath,
        source: sourcePath,
        expectation: "The attached-neutral frame must materially differ from the rig-driven frame because the invisible true null drives the visible child. The rig-driven, detached-preserved, and post-rollback frames must be visually equivalent, proving detach-without-jump and rollback preservation.",
      },
      checks,
      responses,
      failureError,
      cleanupErrors,
      notes: [
        "P1/P2 are accepted baseline evidence and are not replayed as acceptance claims in this tranche.",
        "P3 uses a true After Effects null as an invisible controller for one asymmetric visible child; protocol 1.4 owns attach/detach and protocol 1.5 owns null lifecycle/topology readback.",
        "P3 emits retained real-AE renders but does not self-claim visual acceptance; independent artifact comparison is required.",
        "P4 is doubly gated by M3_NULL_RIG_P4_FAILURE_INJECTION and runner-owned EDITFLOW_M3_NULL_RIG_P4_PROOF=1.",
        "P4 throws after real managed-null creation and backing-source ownership inside the normal undo group; the normal catch path must restore the exact pre-failure fingerprint and item count with AE Undo.",
        "The proof-only cleanup layer is the only successful fixture-disposal route and refuses to discard any project outside the exact proof-owned generation.",
        "P5 remains explicitly unclaimed.",
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
        proofId: "M3_NULL_RIG_P3_P4_REAL_AE",
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
