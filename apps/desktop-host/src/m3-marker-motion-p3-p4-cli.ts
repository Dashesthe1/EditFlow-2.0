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
  AE_MARKER_MOTION_PROTOCOL_VERSION_V20,
  type AeCompMotionStateV20,
  type AeLayerMotionStateV20,
  type AeMarkerMotionCommandV20,
  type AeMarkerMotionResponseV20,
  type AeMarkerStateV20,
} from "../../../packages/adapters/ae-cep/src/protocol-v2_0.js";
import { buildMarkerMotionRequestV20 } from "../../../packages/adapters/ae-cep/src/m3-marker-motion.js";
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

interface AcceptedP1P2Artifact {
  readonly proofId: "M3_MARKER_MOTION_P1_P2_REAL_AE";
  readonly status: "PASS";
  readonly ok: true;
  readonly cleanupComplete: true;
  readonly completedAt?: string;
  readonly proofLevels: {
    readonly P1_validation_rejection: true;
    readonly P2_structural_readback: true;
    readonly P3_visual_proof: false;
    readonly P4_failure_injection_rollback: false;
    readonly P5_save_reopen_reconnect_transfer: false;
  };
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

const required = (name: string): string => {
  const value = argument(name);
  if (value === null || value.length === 0) throw new Error(`Missing required argument ${name}.`);
  return value;
};

const stripUtf8Bom = (value: string): string => value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nested = (value: unknown, key: string): Record<string, unknown> | null => {
  const parent = record(value);
  return parent === null ? null : record(parent[key]);
};
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  const object = record(value);
  if (object === null) return value;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonical(object[key])]));
};
const equal = (left: unknown, right: unknown): boolean => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const sleep = async (milliseconds: number): Promise<void> => { await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); };
const fileExistsNonEmpty = async (filePath: string): Promise<boolean> => {
  try { return (await stat(filePath)).size > 0; } catch { return false; }
};
const sameFilesystemPath = (left: string, right: string): boolean => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const projectHasStableItem = (project: AeProjectSnapshot | null, stableId: string): boolean => project?.items.some((item) => item.stableId === stableId) ?? false;

const parseConfig = (value: unknown): BridgeConfigFile => {
  const candidate = record(value);
  if (candidate === null || candidate["schemaVersion"] !== 1 || candidate["host"] !== "127.0.0.1") throw new Error("Invalid bridge config schema/host.");
  if (!Number.isInteger(candidate["port"]) || typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("Invalid bridge config port/token.");
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("Bridge legacy protocolVersion mismatch.");
  const supported = candidate["supportedProtocolVersions"];
  if (!Array.isArray(supported) || !supported.includes(AE_MARKER_MOTION_PROTOCOL_VERSION_V20) || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("Bridge config does not advertise required 2.0 and 1.1 protocols.");
  }
  if (typeof candidate["extensionId"] !== "string" || candidate["extensionId"].length === 0 || typeof candidate["extensionVersion"] !== "string" || candidate["extensionVersion"].length === 0) {
    throw new Error("Bridge extension identity is missing.");
  }
  return candidate as unknown as BridgeConfigFile;
};

const parseAcceptedP1P2 = (value: unknown): AcceptedP1P2Artifact => {
  const candidate = record(value);
  if (candidate === null
      || candidate["proofId"] !== "M3_MARKER_MOTION_P1_P2_REAL_AE"
      || candidate["status"] !== "PASS"
      || candidate["ok"] !== true
      || candidate["cleanupComplete"] !== true) {
    throw new Error("Accepted marker-motion P1/P2 artifact identity/status is invalid.");
  }
  const levels = record(candidate["proofLevels"]);
  if (levels === null
      || levels["P1_validation_rejection"] !== true
      || levels["P2_structural_readback"] !== true
      || levels["P3_visual_proof"] !== false
      || levels["P4_failure_injection_rollback"] !== false
      || levels["P5_save_reopen_reconnect_transfer"] !== false) {
    throw new Error("Accepted marker-motion P1/P2 proof-level contract is invalid.");
  }
  return candidate as unknown as AcceptedP1P2Artifact;
};

const parseRenderCompletion = (value: unknown): RenderCompletionFile => {
  const candidate = record(value);
  if (candidate === null || candidate["schemaVersion"] !== 1) throw new Error("Render completion marker is invalid.");
  if (typeof candidate["jobId"] !== "string" || candidate["jobId"].length === 0) throw new Error("Render completion marker is missing jobId.");
  if (candidate["status"] !== "DONE" && candidate["status"] !== "FAILED") throw new Error("Render completion status is invalid.");
  if (typeof candidate["ok"] !== "boolean" || typeof candidate["outputPath"] !== "string" || typeof candidate["completedAtMs"] !== "number" || typeof candidate["queueItemRemoved"] !== "boolean") {
    throw new Error("Render completion marker fields are invalid.");
  }
  if (candidate["error"] !== null && typeof candidate["error"] !== "string") throw new Error("Render completion error field is invalid.");
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

const compStateFromResponse = (response: AeMarkerMotionResponseV20): AeCompMotionStateV20 | null => {
  const state = nested(nested(response.readback, "compMotion"), "state");
  if (state === null) return null;
  const motionBlur = state["motionBlur"], frameBlending = state["frameBlending"], shutterAngle = state["shutterAngle"], shutterPhase = state["shutterPhase"], samplesPerFrame = state["samplesPerFrame"], adaptiveSampleLimit = state["adaptiveSampleLimit"];
  if (typeof motionBlur !== "boolean" || typeof frameBlending !== "boolean" || typeof shutterAngle !== "number" || typeof shutterPhase !== "number" || typeof samplesPerFrame !== "number" || typeof adaptiveSampleLimit !== "number") return null;
  return { motionBlur, frameBlending, shutterAngle, shutterPhase, samplesPerFrame, adaptiveSampleLimit };
};

const layerStateFromResponse = (response: AeMarkerMotionResponseV20): AeLayerMotionStateV20 | null => {
  const state = nested(nested(response.readback, "layerMotion"), "state");
  if (state === null || typeof state["motionBlur"] !== "boolean") return null;
  const mode = state["frameBlendingType"];
  if (mode !== "NO_FRAME_BLEND" && mode !== "FRAME_MIX" && mode !== "PIXEL_MOTION") return null;
  return { motionBlur: state["motionBlur"], frameBlendingType: mode };
};

const markerEntries = (response: AeMarkerMotionResponseV20): readonly unknown[] | null => {
  const readback = record(response.readback);
  const entries = readback?.["markers"];
  return Array.isArray(entries) ? entries : null;
};

const main = async (): Promise<void> => {
  const configPath = required("--config");
  const resultPath = required("--result");
  const acceptedP1P2Path = required("--accepted-p1-p2");
  const timeoutMs = Number(argument("--timeout-ms") ?? "240000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 30_000) throw new Error("--timeout-ms must be at least 30000.");

  const acceptedBytes = await readFile(acceptedP1P2Path);
  const acceptedP1P2 = parseAcceptedP1P2(JSON.parse(stripUtf8Bom(acceptedBytes.toString("utf8"))) as unknown);
  const acceptedP1P2Sha256 = createHash("sha256").update(acceptedBytes).digest("hex");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const motionSourcePath = path.join(artifactDir, "p3-motion-source.bmp");
  const sequenceStartPath = path.join(artifactDir, "p3-sequence-0001.bmp");
  const motionNoBlurPath = path.join(artifactDir, "p3-motion-no-blur.avi");
  const motionNarrowPath = path.join(artifactDir, "p3-motion-shutter-30.avi");
  const motionWidePath = path.join(artifactDir, "p3-motion-shutter-360.avi");
  const motionRestoredPath = path.join(artifactDir, "p3-motion-restored-no-blur.avi");
  const frameMixPath = path.join(artifactDir, "p3-frame-mix.avi");
  const pixelMotionPath = path.join(artifactDir, "p3-pixel-motion.avi");
  const frameBlendRestoredPath = path.join(artifactDir, "p3-frame-blend-restored.avi");
  const postRollbackPath = path.join(artifactDir, "p4-post-rollback.avi");

  const checks: Record<string, boolean> = {};
  const responses: RecordedResponse[] = [];
  const evidence: Record<string, unknown>[] = [];
  const cleanupErrors: string[] = [];
  let failureError: string | null = null;
  let cleanupComplete = false;
  let cleanupUndoCount = 0;
  let broker: LoopbackCepBroker | null = null;
  let client: AeCepAdapterClientV11 | null = null;
  let state: ObservedProjectState | null = null;
  let hostRevision: number | null = null;
  let projectSnapshot: AeProjectSnapshot | null = null;
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null;
  let environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;
  let baselineFingerprint: string | null = null;
  let baselineItemCount: number | null = null;
  let motionBaselineComp: AeCompMotionStateV20 | null = null;
  let motionBaselineLayer: AeLayerMotionStateV20 | null = null;
  let blendBaselineComp: AeCompMotionStateV20 | null = null;
  let blendBaselineLayer: AeLayerMotionStateV20 | null = null;

  const projectId = "m3-marker-motion-p3-p4-real-ae";
  const prefix = `M3_MARKER_MOTION_P34_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const motionSourceStable = `${prefix}_MOTION_SOURCE`;
  const sequenceSourceStable = `${prefix}_SEQUENCE_SOURCE`;
  const motionCompStable = `${prefix}_MOTION_COMP`;
  const blendCompStable = `${prefix}_BLEND_COMP`;
  const motionLayerStable = `${prefix}_MOTION_LAYER`;
  const blendLayerStable = `${prefix}_BLEND_LAYER`;
  const temporaryItemStableIds = new Set([motionSourceStable, sequenceSourceStable, motionCompStable, blendCompStable]);
  let requestCounter = 0;
  let operationCounter = 0;

  const recordResponse = (response: AeAdapterResponseV11 | AeMarkerMotionResponseV20): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command: response.command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
      notes: response.diagnostics.notes ?? [],
    });
  };

  const refresh = async (): Promise<void> => {
    if (client === null) throw new Error("V1.1 setup client is unavailable.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
    projectSnapshot = observed.project;
  };

  const executeV11 = async (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>, refreshAfter = true): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("V1.1 setup state is unavailable.");
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_${++operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M3_MARKER_MOTION_P3_P4_SETUP",
    });
    recordResponse(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`${command} failed: ${response.error?.code ?? response.outcome}`);
    if (refreshAfter) await refresh();
    return response;
  };

  const dispatchV20 = async (
    command: AeMarkerMotionCommandV20,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_MARKER_MOTION_P3_P4_STRUCTURAL",
  ): Promise<AeMarkerMotionResponseV20> => {
    if (broker === null) throw new Error("Protocol 2.0 broker is unavailable.");
    const response = await broker.dispatch(buildMarkerMotionRequestV20({
      requestId: `m3-marker-motion-p34-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V20_${++operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    }));
    recordResponse(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const setCompMotion = async (compStableId: string, desired: AeCompMotionStateV20): Promise<AeMarkerMotionResponseV20> => {
    if (hostRevision === null) throw new Error("Host revision is unavailable before composition motion mutation.");
    const response = await dispatchV20("comp.motion.set", { comp: { stableId: compStableId }, state: desired }, hostRevision);
    const observed = compStateFromResponse(response);
    if ((response.outcome !== "APPLIED" && response.outcome !== "NO_OP") || observed === null || !equal(observed, desired)) {
      throw new Error(`Composition motion state did not reach the requested value for ${compStableId}.`);
    }
    await refresh();
    return response;
  };

  const setLayerMotion = async (compStableId: string, layerStableId: string, desired: AeLayerMotionStateV20): Promise<AeMarkerMotionResponseV20> => {
    if (hostRevision === null) throw new Error("Host revision is unavailable before layer motion mutation.");
    const response = await dispatchV20("layer.motion.set", { comp: { stableId: compStableId }, layer: { stableId: layerStableId }, state: desired }, hostRevision);
    const observed = layerStateFromResponse(response);
    if ((response.outcome !== "APPLIED" && response.outcome !== "NO_OP") || observed === null || !equal(observed, desired)) {
      throw new Error(`Layer motion state did not reach the requested value for ${layerStableId}.`);
    }
    await refresh();
    return response;
  };

  const renderComp = async (compStableId: string, outputPath: string): Promise<RenderCompletionFile> => {
    const scheduled = await executeV11("render.capture", {
      comp: { stableId: compStableId },
      outputPath,
      timeSpanStart: 0,
      timeSpanDuration: 1,
    }, false);
    const readback = record(scheduled.readback);
    const jobId = readback?.["jobId"];
    const completionPath = readback?.["completionPath"];
    const requestedOutputPath = readback?.["requestedOutputPath"];
    const canonicalOutputPath = readback?.["outputPath"];
    if (typeof jobId !== "string" || typeof completionPath !== "string") throw new Error("render.capture did not return jobId/completionPath.");
    if (typeof requestedOutputPath !== "string" || !sameFilesystemPath(requestedOutputPath, outputPath)) throw new Error("render.capture requested path readback mismatch.");
    if (typeof canonicalOutputPath !== "string" || canonicalOutputPath.length === 0) throw new Error("render.capture did not return a canonical output path.");
    const relative = path.relative(artifactDir, canonicalOutputPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Render output escaped proof artifact directory: ${canonicalOutputPath}`);
    const completion = await waitForRenderCompletion(completionPath, jobId, timeoutMs);
    if (!completion.ok || completion.status !== "DONE" || !completion.queueItemRemoved) throw new Error(`Render job ${jobId} failed: ${completion.error ?? completion.status}`);
    if (!sameFilesystemPath(completion.outputPath, canonicalOutputPath) || !(await fileExistsNonEmpty(completion.outputPath))) throw new Error("Render completion output path is missing, empty, or mismatched.");
    await refresh();
    return completion;
  };

  const restoreBaselineThroughUndo = async (): Promise<void> => {
    if (client === null || baselineFingerprint === null || baselineItemCount === null) return;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const current = await client.observe(projectId);
      state = current.observed;
      hostRevision = current.hostRevision;
      projectSnapshot = current.project;
      if (current.observed.projectFingerprint === baselineFingerprint && current.project.itemCount === baselineItemCount) return;
      const response = await client.undoLast({ transactionId, operationId: `${transactionId}_CLEANUP_UNDO_${attempt + 1}`, expectedState: current.observed });
      recordResponse(response);
      cleanupUndoCount += 1;
      if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`Cleanup undo failed: ${response.error?.code ?? response.outcome}`);
    }
    throw new Error("Cleanup undo budget exhausted before exact baseline restoration.");
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(motionSourcePath, createBmp24(48, 48, (x, y) => {
      const cross = Math.abs(x - 24) <= 5 || Math.abs(y - 24) <= 5;
      return cross ? [248, 248, 248] : [18, 34, 82];
    }));
    for (let index = 0; index < 10; index += 1) {
      const framePath = path.join(artifactDir, `p3-sequence-${String(index + 1).padStart(4, "0")}.bmp`);
      const squareX = 4 + index * 7;
      await writeFile(framePath, createBmp24(96, 96, (x, y) => {
        const inside = x >= squareX && x < squareX + 22 && y >= 35 && y < 57;
        const guide = y >= 70 && y < 73;
        return inside ? [245, 245, 245] : (guide ? [48, 128, 240] : [8, 8, 16]);
      }));
    }
    checks.fixture_motion_source_written = (await stat(motionSourcePath)).size > 54;
    checks.fixture_sequence_written = (await stat(sequenceStartPath)).size > 54;
    checks.accepted_p1_p2_artifact_verified = acceptedP1P2.ok === true && acceptedP1P2.cleanupComplete === true;

    const config = parseConfig(JSON.parse(stripUtf8Bom(await readFile(configPath, "utf8"))) as unknown);
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 30_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_MARKER_MOTION_PROTOCOL_VERSION_V20, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    if (await broker.start() !== config.port) throw new Error("CEP broker bound an unexpected port.");
    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v20 = panel.protocolVersion === AE_MARKER_MOTION_PROTOCOL_VERSION_V20;
    checks.panel_supports_v11_v20 = panel.supportedProtocolVersions.includes(AE_MARKER_MOTION_PROTOCOL_VERSION_V20) && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v20 || !checks.panel_supports_v11_v20) throw new Error("Marker-motion P3/P4 requires negotiated 2.0 with 1.1 compatibility.");
    if (panel.extensionVersion !== config.extensionVersion) throw new Error("Registered CEP panel version does not match installed config.");

    client = new AeCepAdapterClientV11(broker, () => `m3-marker-motion-p34-v11-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects";
    const baseline = await client.observe(projectId);
    state = baseline.observed; hostRevision = baseline.hostRevision; projectSnapshot = baseline.project;
    baselineFingerprint = baseline.observed.projectFingerprint; baselineItemCount = baseline.project.itemCount;
    checks.baseline_blank = baseline.project.itemCount === 0 && baseline.project.filePath === null;
    if (!checks.baseline_blank) throw new Error("Marker-motion P3/P4 requires the isolated blank unsaved AE baseline.");

    const motionImport = await executeV11("media.import", { path: motionSourcePath, stableId: motionSourceStable, sequence: false });
    checks.motion_source_import = motionImport.affectedObjects.some((item) => item.stableId === motionSourceStable && item.kind === "FOOTAGE");
    const sequenceImport = await executeV11("media.import", { path: sequenceStartPath, stableId: sequenceSourceStable, sequence: true });
    checks.sequence_source_import = sequenceImport.affectedObjects.some((item) => item.stableId === sequenceSourceStable && item.kind === "FOOTAGE");

    const motionComp = await executeV11("comp.create", { stableId: motionCompStable, name: `${prefix} Motion Blur`, width: 320, height: 180, pixelAspect: 1, duration: 1, frameRate: 24 });
    checks.motion_comp_create = motionComp.affectedObjects.some((item) => item.stableId === motionCompStable);
    const motionLayer = await executeV11("layer.add_media", { stableId: motionLayerStable, comp: { stableId: motionCompStable }, item: { stableId: motionSourceStable }, duration: 1 });
    checks.motion_layer_create = nested(motionLayer.readback, "layer")?.["stableId"] === motionLayerStable;
    await executeV11("property.set_keyframes", {
      comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable }, propertyPath: ["ADBE Transform Group", "ADBE Position"],
      keyframes: [{ time: 0, value: [40, 90] }, { time: 1, value: [280, 90] }],
    });
    checks.motion_position_keys_created = true;

    const blendComp = await executeV11("comp.create", { stableId: blendCompStable, name: `${prefix} Frame Blending`, width: 320, height: 180, pixelAspect: 1, duration: 1, frameRate: 24 });
    checks.blend_comp_create = blendComp.affectedObjects.some((item) => item.stableId === blendCompStable);
    const blendLayer = await executeV11("layer.add_media", { stableId: blendLayerStable, comp: { stableId: blendCompStable }, item: { stableId: sequenceSourceStable } });
    checks.blend_layer_create = nested(blendLayer.readback, "layer")?.["stableId"] === blendLayerStable;
    await executeV11("layer.set_timing", { comp: { stableId: blendCompStable }, layer: { stableId: blendLayerStable }, timing: { stretch: 300 } });
    await executeV11("layer.set_transform", { comp: { stableId: blendCompStable }, layer: { stableId: blendLayerStable }, values: { position: [160, 90], scale: [180, 180] } });
    checks.blend_layer_retimed = true;

    const motionCompRead = await dispatchV20("comp.motion.readback", { comp: { stableId: motionCompStable } }, null);
    const motionLayerRead = await dispatchV20("layer.motion.readback", { comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable } }, null);
    motionBaselineComp = compStateFromResponse(motionCompRead); motionBaselineLayer = layerStateFromResponse(motionLayerRead);
    checks.motion_baseline_captured = motionBaselineComp !== null && motionBaselineLayer !== null;
    const blendCompRead = await dispatchV20("comp.motion.readback", { comp: { stableId: blendCompStable } }, null);
    const blendLayerRead = await dispatchV20("layer.motion.readback", { comp: { stableId: blendCompStable }, layer: { stableId: blendLayerStable } }, null);
    blendBaselineComp = compStateFromResponse(blendCompRead); blendBaselineLayer = layerStateFromResponse(blendLayerRead);
    checks.blend_baseline_captured = blendBaselineComp !== null && blendBaselineLayer !== null;
    if (motionBaselineComp === null || motionBaselineLayer === null || blendBaselineComp === null || blendBaselineLayer === null) throw new Error("Unable to capture native marker-motion baselines.");

    const compMarker: AeMarkerStateV20 = { comment: "P3 impact", chapter: "Motion proof", url: "", frameTarget: "midpoint", cuePointName: "impact", duration: 0.125, eventCuePoint: true, label: 9, protectedRegion: true, parameters: { role: "visual-proof", surface: "composition" } };
    const layerMarker: AeMarkerStateV20 = { comment: "P3 layer cue", chapter: "Motion proof", url: "", frameTarget: "moving-layer", cuePointName: "cue", duration: 0, eventCuePoint: false, label: 3, protectedRegion: false, parameters: { role: "visual-proof", surface: "layer" } };
    if (hostRevision === null) throw new Error("Host revision unavailable before marker fixture writes.");
    const compMarkerSet = await dispatchV20("marker.set", { target: { kind: "COMP", comp: { stableId: motionCompStable } }, time: 0.5, marker: compMarker }, hostRevision);
    await refresh();
    const compMarkerRead = await dispatchV20("marker.readback", { target: { kind: "COMP", comp: { stableId: motionCompStable } } }, null);
    const compMarkers = markerEntries(compMarkerRead);
    checks.p3_comp_marker_structural = compMarkerSet.outcome === "APPLIED" && compMarkers?.length === 1 && record(compMarkers[0])?.["time"] === 0.5 && equal(record(compMarkers[0])?.["marker"], compMarker);
    if (hostRevision === null) throw new Error("Host revision unavailable before layer marker write.");
    const layerMarkerSet = await dispatchV20("marker.set", { target: { kind: "LAYER", comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable } }, time: 0.25, marker: layerMarker }, hostRevision);
    await refresh();
    const layerMarkerReadback = await dispatchV20("marker.readback", { target: { kind: "LAYER", comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable } } }, null);
    const layerMarkers = markerEntries(layerMarkerReadback);
    checks.p3_layer_marker_structural = layerMarkerSet.outcome === "APPLIED" && layerMarkers?.length === 1 && record(layerMarkers[0])?.["time"] === 0.25 && equal(record(layerMarkers[0])?.["marker"], layerMarker);
    evidence.push({ kind: "markers", compMarkers, layerMarkers });

    await setLayerMotion(motionCompStable, motionLayerStable, { motionBlur: false, frameBlendingType: "NO_FRAME_BLEND" });
    await setCompMotion(motionCompStable, { ...motionBaselineComp, motionBlur: false, frameBlending: false });
    const noBlurCompletion = await renderComp(motionCompStable, motionNoBlurPath);
    checks.p3_motion_no_blur_artifact = await fileExistsNonEmpty(noBlurCompletion.outputPath);

    const blurLayerState: AeLayerMotionStateV20 = { motionBlur: true, frameBlendingType: "NO_FRAME_BLEND" };
    await setLayerMotion(motionCompStable, motionLayerStable, blurLayerState);
    const narrowState: AeCompMotionStateV20 = { ...motionBaselineComp, motionBlur: true, frameBlending: false, shutterAngle: 30, shutterPhase: -15, samplesPerFrame: 32, adaptiveSampleLimit: 128 };
    await setCompMotion(motionCompStable, narrowState);
    const narrowCompletion = await renderComp(motionCompStable, motionNarrowPath);
    checks.p3_motion_narrow_artifact = await fileExistsNonEmpty(narrowCompletion.outputPath);

    const wideState: AeCompMotionStateV20 = { ...narrowState, shutterAngle: 360, shutterPhase: -180 };
    await setCompMotion(motionCompStable, wideState);
    const wideCompletion = await renderComp(motionCompStable, motionWidePath);
    checks.p3_motion_wide_artifact = await fileExistsNonEmpty(wideCompletion.outputPath);
    evidence.push({ kind: "motionBlurShutter", noBlur: { ...motionBaselineComp, motionBlur: false, frameBlending: false }, narrowState, wideState, layer: blurLayerState });

    await setCompMotion(motionCompStable, motionBaselineComp);
    await setLayerMotion(motionCompStable, motionLayerStable, motionBaselineLayer);
    const restoredMotionCompletion = await renderComp(motionCompStable, motionRestoredPath);
    checks.p3_motion_restored_artifact = await fileExistsNonEmpty(restoredMotionCompletion.outputPath);

    const blendCompEnabled: AeCompMotionStateV20 = { ...blendBaselineComp, motionBlur: false, frameBlending: true };
    await setCompMotion(blendCompStable, blendCompEnabled);
    const frameMixState: AeLayerMotionStateV20 = { motionBlur: false, frameBlendingType: "FRAME_MIX" };
    await setLayerMotion(blendCompStable, blendLayerStable, frameMixState);
    const frameMixCompletion = await renderComp(blendCompStable, frameMixPath);
    checks.p3_frame_mix_artifact = await fileExistsNonEmpty(frameMixCompletion.outputPath);
    const pixelMotionState: AeLayerMotionStateV20 = { motionBlur: false, frameBlendingType: "PIXEL_MOTION" };
    await setLayerMotion(blendCompStable, blendLayerStable, pixelMotionState);
    const pixelMotionCompletion = await renderComp(blendCompStable, pixelMotionPath);
    checks.p3_pixel_motion_artifact = await fileExistsNonEmpty(pixelMotionCompletion.outputPath);
    evidence.push({ kind: "frameBlending", comp: blendCompEnabled, frameMix: frameMixState, pixelMotion: pixelMotionState, source: "retimed numbered BMP footage sequence" });

    await setLayerMotion(blendCompStable, blendLayerStable, blendBaselineLayer);
    await setCompMotion(blendCompStable, blendBaselineComp);
    const restoredBlendCompletion = await renderComp(blendCompStable, frameBlendRestoredPath);
    checks.p3_frame_blend_restored_artifact = await fileExistsNonEmpty(restoredBlendCompletion.outputPath);

    checks.p3_visual_artifact_emitted = [
      checks.p3_motion_no_blur_artifact, checks.p3_motion_narrow_artifact, checks.p3_motion_wide_artifact,
      checks.p3_motion_restored_artifact, checks.p3_frame_mix_artifact, checks.p3_pixel_motion_artifact,
      checks.p3_frame_blend_restored_artifact,
    ].every((value) => value === true);

    const baselineReadBeforeFailure = await dispatchV20("comp.motion.readback", { comp: { stableId: motionCompStable } }, null);
    checks.p4_baseline_motion_exact = equal(compStateFromResponse(baselineReadBeforeFailure), motionBaselineComp);
    const beforeFailure = await client.observe(projectId);
    hostRevision = beforeFailure.hostRevision;
    const failureTarget: AeCompMotionStateV20 = { ...motionBaselineComp, motionBlur: !motionBaselineComp.motionBlur, frameBlending: false, shutterAngle: motionBaselineComp.shutterAngle === 360 ? 180 : 360, shutterPhase: -90, samplesPerFrame: 32, adaptiveSampleLimit: 128 };
    if (equal(failureTarget, motionBaselineComp)) throw new Error("P4 failure-injection target unexpectedly equals baseline.");
    const inducedFailure = await dispatchV20("comp.motion.set", { comp: { stableId: motionCompStable }, state: failureTarget }, hostRevision, "M3_MARKER_MOTION_P4_FAILURE_INJECTION");
    checks.p4_induced_failure_reported = inducedFailure.outcome === "FAILED" && inducedFailure.error?.category === "PROOF_INJECTION" && inducedFailure.error?.code === "M3_MARKER_MOTION_P4_INDUCED_FAILURE";
    checks.p4_rollback_note = inducedFailure.diagnostics.notes.some((note) => note.includes("rolled back through the transaction undo boundary"));
    checks.p4_response_readback_restored = equal(compStateFromResponse(inducedFailure), motionBaselineComp);
    const afterFailure = await client.observe(projectId);
    state = afterFailure.observed; hostRevision = afterFailure.hostRevision; projectSnapshot = afterFailure.project;
    checks.p4_fingerprint_restored = afterFailure.observed.projectFingerprint === beforeFailure.observed.projectFingerprint;
    checks.p4_item_count_unchanged = afterFailure.project.itemCount === beforeFailure.project.itemCount;
    const afterFailureReadback = await dispatchV20("comp.motion.readback", { comp: { stableId: motionCompStable } }, null);
    checks.p4_structural_state_restored = equal(compStateFromResponse(afterFailureReadback), motionBaselineComp);
    const postRollbackCompletion = await renderComp(motionCompStable, postRollbackPath);
    checks.p4_recovery_visual_artifact_emitted = await fileExistsNonEmpty(postRollbackCompletion.outputPath);
    checks.p4 = checks.p4_baseline_motion_exact === true
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
        cleanupComplete = checks.cleanup_temp_items_absent === true && checks.cleanup_item_count_restored === true && checks.cleanup_fingerprint_restored === true;
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
      && checks.fixture_motion_source_written === true
      && checks.fixture_sequence_written === true
      && checks.panel_negotiated_v20 === true
      && checks.panel_supports_v11_v20 === true
      && checks.host_probe === true
      && checks.baseline_blank === true
      && checks.motion_source_import === true
      && checks.sequence_source_import === true
      && checks.motion_comp_create === true
      && checks.motion_layer_create === true
      && checks.motion_position_keys_created === true
      && checks.blend_comp_create === true
      && checks.blend_layer_create === true
      && checks.blend_layer_retimed === true
      && checks.motion_baseline_captured === true
      && checks.blend_baseline_captured === true
      && checks.p3_comp_marker_structural === true
      && checks.p3_layer_marker_structural === true
      && checks.p3_visual_artifact_emitted === true
      && checks.p4 === true;

    await writeJson(resultPath, {
      proofId: "M3_MARKER_MOTION_P3_P4_REAL_AE",
      status: ok ? "VISUAL_REVIEW_REQUIRED" : "FAILURE",
      ok,
      visualReviewRequired: true,
      startedAt,
      completedAt: new Date().toISOString(),
      acceptedP1P2: { path: acceptedP1P2Path, sha256: acceptedP1P2Sha256, completedAt: acceptedP1P2.completedAt ?? null },
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
        motionSourceStable, sequenceSourceStable, motionCompStable, blendCompStable, motionLayerStable, blendLayerStable,
        motionBaselineComp, motionBaselineLayer, blendBaselineComp, blendBaselineLayer,
        motionPositionKeys: [{ time: 0, value: [40, 90] }, { time: 1, value: [280, 90] }],
        frameBlendStretchPercent: 300,
      },
      visualReviewSpec: {
        motionNoBlur: motionNoBlurPath,
        motionShutter30: motionNarrowPath,
        motionShutter360: motionWidePath,
        motionRestoredNoBlur: motionRestoredPath,
        frameMix: frameMixPath,
        pixelMotion: pixelMotionPath,
        frameBlendRestored: frameBlendRestoredPath,
        postRollback: postRollbackPath,
        sampleTimesSeconds: [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
        expected: [
          "motionShutter30 and motionShutter360 must show viewer-visible blur on the AE-animated layer relative to motionNoBlur, with the 360-degree shutter visibly broader than the 30-degree shutter at one or more intermediate frames",
          "frameMix and pixelMotion must visibly differ on the deliberately retimed numbered-image footage sequence; the fixture is footage, not a precomposition layer",
          "motionRestoredNoBlur must return to the native motion baseline after the motion/shutter contrast renders",
          "frameBlendRestored must return to the native frame-blending baseline after Frame Mix and Pixel Motion renders",
          "postRollback must match the restored motion baseline after the proof-gated post-verification composition-motion mutation fails and transaction-undo restores exact protocol-2.0 readback",
          "P3 remains false until retained renders are decoded and independently reviewed; artifact existence alone is not visual acceptance",
        ],
      },
      cleanupComplete,
      cleanupUndoCount,
      checks,
      evidence,
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
