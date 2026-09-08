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
  AE_MOTION_RENDER_PROTOCOL_VERSION_V110,
  type AeMotionRenderCommandV110,
  type AeMotionRenderResponseV110,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_10.js";
import { buildMotionRenderRequestV110 } from "../../../packages/adapters/ae-cep/src/m3-motion-render.js";
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

interface AcceptedP1P2Record {
  readonly schemaVersion: 1;
  readonly proofId: "M3_MOTION_RENDER_P1_P2_ACCEPTANCE";
  readonly protocolVersion: "1.10.0";
  readonly accepted: true;
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
const requireArgument = (name: string): string => {
  const value = argument(name);
  if (!value) throw new Error(`Missing required argument ${name}.`);
  return value;
};
const stripUtf8Bom = (value: string): string => value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nested = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = asRecord(value);
  return record === null ? null : asRecord(record[key]);
};
const valuesOf = (response: AeMotionRenderResponseV110, key: "composition" | "layer"): Record<string, unknown> | null => {
  const motion = nested(response.readback, "motionRender");
  const object = motion === null ? null : asRecord(motion[key]);
  return object === null ? null : asRecord(object["values"]);
};
const sameRecord = (left: Record<string, unknown> | null, right: Record<string, unknown> | null): boolean => JSON.stringify(left) === JSON.stringify(right);
const exactSubset = (actual: Record<string, unknown> | null, expected: Readonly<Record<string, unknown>>): boolean =>
  actual !== null && Object.entries(expected).every(([key, value]) => actual[key] === value);
const projectHasStableItem = (project: AeProjectSnapshot | null, stableId: string): boolean => project?.items.some((item) => item.stableId === stableId) ?? false;

const parseConfig = (value: unknown): BridgeConfigFile => {
  const candidate = asRecord(value);
  if (candidate === null || candidate["schemaVersion"] !== 1 || candidate["host"] !== "127.0.0.1") throw new Error("Bridge config is invalid.");
  if (!Number.isInteger(candidate["port"]) || (candidate["port"] as number) < 1 || (candidate["port"] as number) > 65535) throw new Error("CEP bridge port is invalid.");
  if (typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("CEP bridge token is invalid.");
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("CEP legacy protocolVersion mismatch.");
  const supported = candidate["supportedProtocolVersions"];
  if (!Array.isArray(supported) || !supported.includes(AE_MOTION_RENDER_PROTOCOL_VERSION_V110) || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise protocol 1.10 and baseline 1.1.");
  }
  if (typeof candidate["extensionId"] !== "string" || typeof candidate["extensionVersion"] !== "string") throw new Error("CEP extension identity is missing.");
  return candidate as unknown as BridgeConfigFile;
};

const parseAcceptedP1P2 = (value: unknown): AcceptedP1P2Record => {
  const candidate = asRecord(value);
  if (candidate === null
      || candidate["schemaVersion"] !== 1
      || candidate["proofId"] !== "M3_MOTION_RENDER_P1_P2_ACCEPTANCE"
      || candidate["protocolVersion"] !== AE_MOTION_RENDER_PROTOCOL_VERSION_V110
      || candidate["accepted"] !== true) {
    throw new Error("Accepted motion-render P1/P2 record identity/status is invalid.");
  }
  const levels = asRecord(candidate["proofLevels"]);
  if (levels === null
      || levels["P1_validation_rejection"] !== true
      || levels["P2_structural_readback"] !== true
      || levels["P3_visual_proof"] !== false
      || levels["P4_failure_injection_rollback"] !== false
      || levels["P5_save_reopen_reconnect_transfer"] !== false) {
    throw new Error("Accepted motion-render P1/P2 proof-level contract is invalid.");
  }
  return candidate as unknown as AcceptedP1P2Record;
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const sleep = async (milliseconds: number): Promise<void> => { await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); };
const fileExistsNonEmpty = async (filePath: string): Promise<boolean> => {
  try { return (await stat(filePath)).size > 0; } catch { return false; }
};
const sameFilesystemPath = (left: string, right: string): boolean => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

const parseRenderCompletion = (value: unknown): RenderCompletionFile => {
  const candidate = asRecord(value);
  if (candidate === null || candidate["schemaVersion"] !== 1) throw new Error("Render completion marker is invalid.");
  if (typeof candidate["jobId"] !== "string" || candidate["jobId"].length === 0) throw new Error("Render completion jobId is invalid.");
  if (candidate["status"] !== "DONE" && candidate["status"] !== "FAILED") throw new Error("Render completion status is invalid.");
  if (typeof candidate["ok"] !== "boolean" || typeof candidate["outputPath"] !== "string" || typeof candidate["completedAtMs"] !== "number" || typeof candidate["queueItemRemoved"] !== "boolean") {
    throw new Error("Render completion fields are invalid.");
  }
  if (candidate["error"] !== null && typeof candidate["error"] !== "string") throw new Error("Render completion error is invalid.");
  return candidate as unknown as RenderCompletionFile;
};
const waitForRenderCompletion = async (completionPath: string, jobId: string, timeoutMs: number): Promise<RenderCompletionFile> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const completion = parseRenderCompletion(JSON.parse(stripUtf8Bom(await readFile(completionPath, "utf8"))) as unknown);
      if (completion.jobId === jobId) return completion;
      lastError = `stale completion marker '${completion.jobId}'`;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await sleep(200);
  }
  throw new Error(`RENDER_JOB_COMPLETION_TIMEOUT: ${jobId}${lastError ? ` (${lastError})` : ""}`);
};

const createBmp24 = (width: number, height: number): Buffer => {
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
  for (let y = 0; y < height; y += 1) {
    const destinationY = height - 1 - y;
    const rowOffset = 54 + destinationY * rowStride;
    for (let x = 0; x < width; x += 1) {
      const checker = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) === 0;
      const diagonal = Math.abs(x - y) <= 3 || Math.abs((width - 1 - x) - y) <= 3;
      const rgb: readonly [number, number, number] = diagonal
        ? [255, 255, 255]
        : checker ? [32, 220, 255] : [238, 40, 176];
      const offset = rowOffset + x * 3;
      buffer[offset] = rgb[2];
      buffer[offset + 1] = rgb[1];
      buffer[offset + 2] = rgb[0];
    }
  }
  return buffer;
};

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const acceptedP1P2Path = requireArgument("--accepted-p1-p2");
  const timeoutMs = Number(argument("--timeout-ms") ?? "240000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const acceptedBytes = await readFile(acceptedP1P2Path);
  const acceptedP1P2 = parseAcceptedP1P2(JSON.parse(stripUtf8Bom(acceptedBytes.toString("utf8"))) as unknown);
  const acceptedP1P2Sha256 = createHash("sha256").update(acceptedBytes).digest("hex");
  const artifactDir = path.dirname(resultPath);
  const sourceBmpPath = path.join(artifactDir, "p3-motion-source.bmp");
  const motionBaselinePath = path.join(artifactDir, "p3-motion-baseline.avi");
  const motionEnabledPath = path.join(artifactDir, "p3-motion-blur-enabled.avi");
  const motionRestoredPath = path.join(artifactDir, "p3-motion-restored-baseline.avi");
  const blendNonePath = path.join(artifactDir, "p3-blend-none.avi");
  const blendFrameMixPath = path.join(artifactDir, "p3-blend-frame-mix.avi");
  const blendPixelMotionPath = path.join(artifactDir, "p3-blend-pixel-motion.avi");
  const blendRestoredPath = path.join(artifactDir, "p3-blend-restored-none.avi");
  const rollbackMotionPath = path.join(artifactDir, "p4-post-rollback-motion-baseline.avi");
  const rollbackBlendPath = path.join(artifactDir, "p4-post-rollback-blend-none.avi");

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
  let baselineFingerprint: string | null = null;
  let baselineItemCount: number | null = null;
  let environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null;
  let cleanupUndoCount = 0;

  const projectId = "m3-motion-render-p3-p4-real-ae";
  const prefix = `M3_MOTION_RENDER_P34_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const mediaStable = `${prefix}_MEDIA`;
  const motionCompStable = `${prefix}_MOTION_COMP`;
  const motionLayerStable = `${prefix}_MOTION_LAYER`;
  const blendSourceStable = `${prefix}_BLEND_SOURCE_COMP`;
  const blendSourceLayerStable = `${prefix}_BLEND_SOURCE_LAYER`;
  const blendTargetStable = `${prefix}_BLEND_TARGET_COMP`;
  const blendTargetLayerStable = `${prefix}_BLEND_TARGET_LAYER`;
  const positionPath = ["ADBE Transform Group", "ADBE Position"] as const;
  let operationCounter = 0;
  let requestCounter = 0;

  const recordResponse = (response: AeAdapterResponseV11 | AeMotionRenderResponseV110): void => {
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
    if (client === null) throw new Error("Baseline AE client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
    projectSnapshot = observed.project;
  };
  const executeV11 = async (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>, refreshAfter = true): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("Baseline AE client/state is not initialized.");
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_${++operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M3_MOTION_RENDER_P3_P4_SETUP",
    });
    recordResponse(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`${command} failed: ${response.error?.code ?? response.outcome}`);
    if (refreshAfter) await refreshState();
    return response;
  };
  const dispatchV110 = async (
    command: AeMotionRenderCommandV110,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_MOTION_RENDER_P3_P4_STRUCTURAL",
  ): Promise<AeMotionRenderResponseV110> => {
    if (broker === null) throw new Error("Protocol 1.10 broker is unavailable.");
    const request = buildMotionRenderRequestV110({
      requestId: `m3-motion-render-p34-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V110_${++operationCounter}`,
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
  const readMotion = async (compStable: string, layerStable: string): Promise<AeMotionRenderResponseV110> => dispatchV110("motion_render.readback", {
    comp: { stableId: compStable }, layer: { stableId: layerStable },
  }, null);
  const setComp = async (compStable: string, settings: Readonly<Record<string, unknown>>, readbackProfile?: string): Promise<AeMotionRenderResponseV110> => {
    if (hostRevision === null) throw new Error("Host revision unavailable before comp motion-render mutation.");
    const response = await dispatchV110("comp.motion_render.set", { comp: { stableId: compStable }, settings }, hostRevision, readbackProfile);
    await refreshState();
    return response;
  };
  const setLayer = async (compStable: string, layerStable: string, settings: Readonly<Record<string, unknown>>, readbackProfile?: string): Promise<AeMotionRenderResponseV110> => {
    if (hostRevision === null) throw new Error("Host revision unavailable before layer motion-render mutation.");
    const response = await dispatchV110("layer.motion_render.set", { comp: { stableId: compStable }, layer: { stableId: layerStable }, settings }, hostRevision, readbackProfile);
    await refreshState();
    return response;
  };
  const renderComp = async (compStable: string, outputPath: string): Promise<RenderCompletionFile> => {
    const scheduled = await executeV11("render.capture", {
      comp: { stableId: compStable }, outputPath, timeSpanStart: 0, timeSpanDuration: 1,
    }, false);
    const readback = asRecord(scheduled.readback);
    const jobId = readback?.["jobId"];
    const completionPath = readback?.["completionPath"];
    const requestedOutputPath = readback?.["requestedOutputPath"];
    const canonicalOutputPath = readback?.["outputPath"];
    if (typeof jobId !== "string" || typeof completionPath !== "string") throw new Error("render.capture did not return a jobId and completionPath.");
    if (typeof requestedOutputPath !== "string" || !sameFilesystemPath(requestedOutputPath, outputPath)) {
      throw new Error("render.capture requested output-path readback does not match the motion-render proof request.");
    }
    if (typeof canonicalOutputPath !== "string" || canonicalOutputPath.length === 0) throw new Error("render.capture did not return After Effects' canonical OutputModule.file path.");
    const relativeArtifactPath = path.relative(artifactDir, canonicalOutputPath);
    if (relativeArtifactPath.startsWith("..") || path.isAbsolute(relativeArtifactPath)) {
      throw new Error(`render.capture canonical output escaped the motion-render proof artifact directory: ${canonicalOutputPath}`);
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
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const current = await client.observe(projectId);
      state = current.observed;
      hostRevision = current.hostRevision;
      projectSnapshot = current.project;
      if (current.observed.projectFingerprint === baselineFingerprint && current.project.itemCount === baselineItemCount) return;
      const response = await client.undoLast({
        transactionId,
        operationId: `${transactionId}_CLEANUP_${attempt + 1}`,
        expectedState: current.observed,
      });
      recordResponse(response);
      cleanupUndoCount += 1;
      if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`Cleanup undo failed: ${response.error?.code ?? response.outcome}`);
    }
    throw new Error("Cleanup undo budget exhausted before exact baseline restoration.");
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(sourceBmpPath, createBmp24(80, 80));
    checks.fixture_source_written = (await stat(sourceBmpPath)).size > 54;
    checks.accepted_p1_p2_record_verified = acceptedP1P2.accepted === true;

    const config = parseConfig(JSON.parse(stripUtf8Bom(await readFile(configPath, "utf8"))) as unknown);
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 30_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_MOTION_RENDER_PROTOCOL_VERSION_V110, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);
    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v110 = panel.protocolVersion === AE_MOTION_RENDER_PROTOCOL_VERSION_V110;
    checks.panel_supports_v110_v11 = panel.supportedProtocolVersions.includes(AE_MOTION_RENDER_PROTOCOL_VERSION_V110) && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v110 || !checks.panel_supports_v110_v11) throw new Error("P3/P4 did not negotiate protocol 1.10 with baseline 1.1.");

    client = new AeCepAdapterClientV11(broker, () => `m3-motion-render-p34-setup-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects" && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    projectSnapshot = baseline.project;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;
    checks.baseline_blank = baseline.project.itemCount === 0 && baseline.project.filePath === null;
    if (!checks.baseline_blank) throw new Error("Motion-render P3/P4 requires an isolated blank unsaved AE project.");

    const media = await executeV11("media.import", { path: sourceBmpPath, stableId: mediaStable, sequence: false });
    checks.media_import = media.affectedObjects.some((item) => item.stableId === mediaStable && item.kind === "FOOTAGE");

    await executeV11("comp.create", { stableId: motionCompStable, name: `${prefix} Motion Blur Visual`, width: 320, height: 180, pixelAspect: 1, duration: 1, frameRate: 24 });
    await executeV11("layer.add_media", { stableId: motionLayerStable, comp: { stableId: motionCompStable }, item: { stableId: mediaStable } });
    await executeV11("property.set_keyframes", {
      comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable }, propertyPath: positionPath,
      keyframes: [
        { time: 0, value: [28, 90] },
        { time: 0.5, value: [292, 90] },
        { time: 1, value: [28, 90] },
      ],
    });
    checks.motion_position_keys_created = true;

    await executeV11("comp.create", { stableId: blendSourceStable, name: `${prefix} Blend Source 12fps`, width: 320, height: 180, pixelAspect: 1, duration: 1, frameRate: 12 });
    await executeV11("layer.add_media", { stableId: blendSourceLayerStable, comp: { stableId: blendSourceStable }, item: { stableId: mediaStable } });
    await executeV11("property.set_keyframes", {
      comp: { stableId: blendSourceStable }, layer: { stableId: blendSourceLayerStable }, propertyPath: positionPath,
      keyframes: [{ time: 0, value: [36, 90] }, { time: 1, value: [284, 90] }],
    });
    await executeV11("comp.create", { stableId: blendTargetStable, name: `${prefix} Blend Target 24fps`, width: 320, height: 180, pixelAspect: 1, duration: 1, frameRate: 24 });
    await executeV11("layer.add_media", { stableId: blendTargetLayerStable, comp: { stableId: blendTargetStable }, item: { stableId: blendSourceStable } });
    checks.blend_12fps_source_in_24fps_target = true;

    const motionInitial = await readMotion(motionCompStable, motionLayerStable);
    const motionInitialComp = valuesOf(motionInitial, "composition");
    const motionInitialLayer = valuesOf(motionInitial, "layer");
    if (motionInitialComp === null || motionInitialLayer === null) throw new Error("Motion baseline readback is incomplete.");
    const blendInitial = await readMotion(blendTargetStable, blendTargetLayerStable);
    const blendInitialComp = valuesOf(blendInitial, "composition");
    const blendInitialLayer = valuesOf(blendInitial, "layer");
    if (blendInitialComp === null || blendInitialLayer === null) throw new Error("Blend baseline readback is incomplete.");

    await setComp(motionCompStable, { motionBlur: false });
    await setLayer(motionCompStable, motionLayerStable, { motionBlur: false, frameBlendingType: "NO_FRAME_BLEND" });
    const motionVisualBaseline = await readMotion(motionCompStable, motionLayerStable);
    const motionVisualBaselineComp = valuesOf(motionVisualBaseline, "composition");
    const motionVisualBaselineLayer = valuesOf(motionVisualBaseline, "layer");
    const motionBaseline = await renderComp(motionCompStable, motionBaselinePath);
    checks.p3_motion_baseline_artifact = await fileExistsNonEmpty(motionBaseline.outputPath);

    const motionCompTarget = { motionBlur: true, shutterAngle: 270, shutterPhase: -90, samplesPerFrame: 16, adaptiveSampleLimit: 64 };
    const motionCompSet = await setComp(motionCompStable, motionCompTarget);
    const motionLayerSet = await setLayer(motionCompStable, motionLayerStable, { motionBlur: true });
    checks.p3_motion_structural_enabled = (motionCompSet.outcome === "APPLIED" || motionCompSet.outcome === "NO_OP")
      && exactSubset(valuesOf(motionCompSet, "composition"), motionCompTarget)
      && (motionLayerSet.outcome === "APPLIED" || motionLayerSet.outcome === "NO_OP")
      && exactSubset(valuesOf(motionLayerSet, "layer"), { motionBlur: true });
    const motionEnabled = await renderComp(motionCompStable, motionEnabledPath);
    checks.p3_motion_enabled_artifact = await fileExistsNonEmpty(motionEnabled.outputPath);

    if (motionVisualBaselineComp === null || motionVisualBaselineLayer === null) throw new Error("Motion visual baseline state was not captured.");
    await setComp(motionCompStable, motionVisualBaselineComp);
    await setLayer(motionCompStable, motionLayerStable, { motionBlur: motionVisualBaselineLayer["motionBlur"], frameBlendingType: motionVisualBaselineLayer["frameBlendingType"] });
    const motionRestoredRead = await readMotion(motionCompStable, motionLayerStable);
    checks.p3_motion_restored_structural = sameRecord(valuesOf(motionRestoredRead, "composition"), motionVisualBaselineComp)
      && sameRecord(valuesOf(motionRestoredRead, "layer"), motionVisualBaselineLayer);
    const motionRestored = await renderComp(motionCompStable, motionRestoredPath);
    checks.p3_motion_restored_artifact = await fileExistsNonEmpty(motionRestored.outputPath);

    await setComp(blendTargetStable, { motionBlur: false, frameBlending: true });
    await setLayer(blendTargetStable, blendTargetLayerStable, { motionBlur: false, frameBlendingType: "NO_FRAME_BLEND" });
    const blendVisualBaseline = await readMotion(blendTargetStable, blendTargetLayerStable);
    const blendVisualBaselineComp = valuesOf(blendVisualBaseline, "composition");
    const blendVisualBaselineLayer = valuesOf(blendVisualBaseline, "layer");
    const blendNone = await renderComp(blendTargetStable, blendNonePath);
    checks.p3_blend_none_artifact = await fileExistsNonEmpty(blendNone.outputPath);

    const frameMixSet = await setLayer(blendTargetStable, blendTargetLayerStable, { frameBlendingType: "FRAME_MIX" });
    checks.p3_frame_mix_structural = exactSubset(valuesOf(frameMixSet, "layer"), { frameBlending: true, frameBlendingType: "FRAME_MIX" });
    const blendFrameMix = await renderComp(blendTargetStable, blendFrameMixPath);
    checks.p3_frame_mix_artifact = await fileExistsNonEmpty(blendFrameMix.outputPath);

    const pixelMotionSet = await setLayer(blendTargetStable, blendTargetLayerStable, { frameBlendingType: "PIXEL_MOTION" });
    checks.p3_pixel_motion_structural = exactSubset(valuesOf(pixelMotionSet, "layer"), { frameBlending: true, frameBlendingType: "PIXEL_MOTION" });
    const blendPixelMotion = await renderComp(blendTargetStable, blendPixelMotionPath);
    checks.p3_pixel_motion_artifact = await fileExistsNonEmpty(blendPixelMotion.outputPath);

    if (blendVisualBaselineComp === null || blendVisualBaselineLayer === null) throw new Error("Blend visual baseline state was not captured.");
    await setComp(blendTargetStable, blendVisualBaselineComp);
    await setLayer(blendTargetStable, blendTargetLayerStable, { motionBlur: blendVisualBaselineLayer["motionBlur"], frameBlendingType: blendVisualBaselineLayer["frameBlendingType"] });
    const blendRestoredRead = await readMotion(blendTargetStable, blendTargetLayerStable);
    checks.p3_blend_restored_structural = sameRecord(valuesOf(blendRestoredRead, "composition"), blendVisualBaselineComp)
      && sameRecord(valuesOf(blendRestoredRead, "layer"), blendVisualBaselineLayer);
    const blendRestored = await renderComp(blendTargetStable, blendRestoredPath);
    checks.p3_blend_restored_artifact = await fileExistsNonEmpty(blendRestored.outputPath);

    const beforeCompFailure = await client.observe(projectId);
    state = beforeCompFailure.observed;
    hostRevision = beforeCompFailure.hostRevision;
    projectSnapshot = beforeCompFailure.project;
    const compFailure = await setComp(motionCompStable, { motionBlur: true, shutterAngle: 360 }, "M3_MOTION_RENDER_P4_FAILURE_INJECTION");
    checks.p4_comp_induced_failure = compFailure.outcome === "FAILED"
      && compFailure.error?.category === "PROOF_INJECTION"
      && compFailure.error?.code === "M3_MOTION_RENDER_P4_COMP_INDUCED_FAILURE";
    const afterCompFailure = await client.observe(projectId);
    checks.p4_comp_fingerprint_restored = afterCompFailure.observed.projectFingerprint === beforeCompFailure.observed.projectFingerprint;
    const compRollbackRead = await readMotion(motionCompStable, motionLayerStable);
    checks.p4_comp_state_restored = sameRecord(valuesOf(compRollbackRead, "composition"), motionVisualBaselineComp);

    const beforeLayerFailure = await client.observe(projectId);
    state = beforeLayerFailure.observed;
    hostRevision = beforeLayerFailure.hostRevision;
    projectSnapshot = beforeLayerFailure.project;
    const layerFailure = await setLayer(blendTargetStable, blendTargetLayerStable, { frameBlendingType: "PIXEL_MOTION" }, "M3_MOTION_RENDER_P4_FAILURE_INJECTION");
    checks.p4_layer_induced_failure = layerFailure.outcome === "FAILED"
      && layerFailure.error?.category === "PROOF_INJECTION"
      && layerFailure.error?.code === "M3_MOTION_RENDER_P4_LAYER_INDUCED_FAILURE";
    const afterLayerFailure = await client.observe(projectId);
    checks.p4_layer_fingerprint_restored = afterLayerFailure.observed.projectFingerprint === beforeLayerFailure.observed.projectFingerprint;
    const layerRollbackRead = await readMotion(blendTargetStable, blendTargetLayerStable);
    checks.p4_layer_state_restored = sameRecord(valuesOf(layerRollbackRead, "layer"), blendVisualBaselineLayer);

    const rollbackMotion = await renderComp(motionCompStable, rollbackMotionPath);
    const rollbackBlend = await renderComp(blendTargetStable, rollbackBlendPath);
    checks.p4_motion_rollback_artifact = await fileExistsNonEmpty(rollbackMotion.outputPath);
    checks.p4_blend_rollback_artifact = await fileExistsNonEmpty(rollbackBlend.outputPath);
    checks.p3_visual_artifacts_emitted = [
      checks.p3_motion_baseline_artifact,
      checks.p3_motion_enabled_artifact,
      checks.p3_motion_restored_artifact,
      checks.p3_blend_none_artifact,
      checks.p3_frame_mix_artifact,
      checks.p3_pixel_motion_artifact,
      checks.p3_blend_restored_artifact,
    ].every((value) => value === true);
    checks.p4_structural_rollback_complete = [
      checks.p4_comp_induced_failure,
      checks.p4_comp_fingerprint_restored,
      checks.p4_comp_state_restored,
      checks.p4_layer_induced_failure,
      checks.p4_layer_fingerprint_restored,
      checks.p4_layer_state_restored,
      checks.p4_motion_rollback_artifact,
      checks.p4_blend_rollback_artifact,
    ].every((value) => value === true);
  } catch (error) {
    failureError = error instanceof Error ? error.message : String(error);
  } finally {
    try { await restoreBaselineThroughUndo(); }
    catch (error) { cleanupErrors.push(error instanceof Error ? error.message : String(error)); }
    try {
      if (client !== null && baselineFingerprint !== null && baselineItemCount !== null) {
        const finalState = await client.observe(projectId);
        state = finalState.observed;
        hostRevision = finalState.hostRevision;
        projectSnapshot = finalState.project;
        checks.cleanup_fingerprint_restored = finalState.observed.projectFingerprint === baselineFingerprint;
        checks.cleanup_item_count_restored = finalState.project.itemCount === baselineItemCount;
        checks.cleanup_managed_items_absent = ![mediaStable, motionCompStable, blendSourceStable, blendTargetStable].some((stableId) => projectHasStableItem(finalState.project, stableId));
        cleanupComplete = checks.cleanup_fingerprint_restored === true && checks.cleanup_item_count_restored === true && checks.cleanup_managed_items_absent === true && cleanupErrors.length === 0;
      }
    } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : String(error)); }
    if (broker !== null) await broker.stop().catch(() => undefined);
  }

  const p4Required = [
    "panel_negotiated_v110", "panel_supports_v110_v11", "host_probe", "baseline_blank",
    "accepted_p1_p2_record_verified", "fixture_source_written", "media_import",
    "motion_position_keys_created", "blend_12fps_source_in_24fps_target",
    "p3_motion_structural_enabled", "p3_motion_restored_structural",
    "p3_frame_mix_structural", "p3_pixel_motion_structural", "p3_blend_restored_structural",
    "p3_visual_artifacts_emitted", "p4_structural_rollback_complete",
    "cleanup_fingerprint_restored", "cleanup_item_count_restored", "cleanup_managed_items_absent",
  ];
  const p4Pass = failureError === null && cleanupComplete && p4Required.every((key) => checks[key] === true);
  await writeJson(resultPath, {
    schemaVersion: 1,
    proof: "M3_MOTION_RENDER_P3_P4_REAL_AE",
    protocolVersion: AE_MOTION_RENDER_PROTOCOL_VERSION_V110,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: p4Pass ? "PASS" : "FAILURE",
    ok: p4Pass,
    failureError,
    acceptedP1P2: { path: acceptedP1P2Path, sha256: acceptedP1P2Sha256 },
    panel,
    environment,
    checks,
    responses,
    proofLevels: {
      P1_validation_rejection: true,
      P2_structural_readback: true,
      P3_visual_proof: false,
      P4_failure_injection_rollback: p4Pass,
      P5_save_reopen_reconnect_transfer: false,
    },
    visualReviewRequired: true,
    visualArtifacts: {
      motionBaselinePath,
      motionEnabledPath,
      motionRestoredPath,
      blendNonePath,
      blendFrameMixPath,
      blendPixelMotionPath,
      blendRestoredPath,
      rollbackMotionPath,
      rollbackBlendPath,
    },
    cleanupUndoCount,
    cleanupComplete,
    cleanupErrors,
  });
  if (!p4Pass) process.exitCode = 1;
};

await main();
