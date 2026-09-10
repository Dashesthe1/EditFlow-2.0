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
const nestedRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  const parent = asRecord(value);
  return parent === null ? null : asRecord(parent[key]);
};
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  const object = asRecord(value);
  if (object === null) return value;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonical(object[key])]));
};
const equal = (left: unknown, right: unknown): boolean => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const all = (checks: Record<string, boolean>, names: readonly string[]): boolean => names.every((name) => checks[name] === true);
const sleep = async (milliseconds: number): Promise<void> => { await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); };
const fileExistsNonEmpty = async (filePath: string): Promise<boolean> => {
  try { return (await stat(filePath)).size > 0; } catch { return false; }
};
const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const projectHasStableItem = (project: AeProjectSnapshot | null, stableId: string): boolean =>
  project?.items.some((item) => item.stableId === stableId) ?? false;

const parseConfig = (value: unknown): BridgeConfigFile => {
  const candidate = asRecord(value);
  if (candidate === null || candidate["schemaVersion"] !== 1 || candidate["host"] !== "127.0.0.1") throw new Error("Bridge config schema/host is invalid.");
  if (!Number.isInteger(candidate["port"]) || typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("Bridge config transport fields are invalid.");
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("Bridge legacy protocolVersion mismatch.");
  const supported = candidate["supportedProtocolVersions"];
  if (!Array.isArray(supported) || !supported.includes(AE_MARKER_MOTION_PROTOCOL_VERSION_V20) || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("Bridge config does not advertise required 2.0 and 1.1 protocols.");
  }
  if (typeof candidate["extensionId"] !== "string" || candidate["extensionId"].length === 0 || typeof candidate["extensionVersion"] !== "string" || candidate["extensionVersion"].length === 0) {
    throw new Error("Bridge extension identity is invalid.");
  }
  return candidate as unknown as BridgeConfigFile;
};

const parseAcceptedP1P2 = (value: unknown): AcceptedP1P2Artifact => {
  const candidate = asRecord(value);
  if (candidate === null || candidate["proofId"] !== "M3_MARKER_MOTION_P1_P2_REAL_AE" || candidate["status"] !== "PASS" || candidate["ok"] !== true || candidate["cleanupComplete"] !== true) {
    throw new Error("Accepted marker-motion P1/P2 artifact identity/status is invalid.");
  }
  const levels = asRecord(candidate["proofLevels"]);
  if (levels === null || levels["P1_validation_rejection"] !== true || levels["P2_structural_readback"] !== true || levels["P3_visual_proof"] !== false || levels["P4_failure_injection_rollback"] !== false || levels["P5_save_reopen_reconnect_transfer"] !== false) {
    throw new Error("Accepted marker-motion P1/P2 proof-level contract is invalid.");
  }
  return candidate as unknown as AcceptedP1P2Artifact;
};

const parseRenderCompletion = (value: unknown): RenderCompletionFile => {
  const candidate = asRecord(value);
  if (candidate === null || candidate["schemaVersion"] !== 1 || typeof candidate["jobId"] !== "string") throw new Error("Render completion marker is invalid.");
  if (candidate["status"] !== "DONE" && candidate["status"] !== "FAILED") throw new Error("Render completion status is invalid.");
  if (typeof candidate["ok"] !== "boolean" || typeof candidate["outputPath"] !== "string" || typeof candidate["completedAtMs"] !== "number" || typeof candidate["queueItemRemoved"] !== "boolean") throw new Error("Render completion fields are invalid.");
  if (candidate["error"] !== null && typeof candidate["error"] !== "string") throw new Error("Render completion error is invalid.");
  return candidate as unknown as RenderCompletionFile;
};

const waitForRenderCompletion = async (completionPath: string, expectedJobId: string, timeoutMs: number): Promise<RenderCompletionFile> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const completion = parseRenderCompletion(JSON.parse(stripUtf8Bom(await readFile(completionPath, "utf8"))) as unknown);
      if (completion.jobId === expectedJobId) return completion;
      lastError = `stale completion marker '${completion.jobId}'`;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await sleep(125);
  }
  throw new Error(`RENDER_JOB_COMPLETION_TIMEOUT: ${expectedJobId}${lastError ? ` (${lastError})` : ""}`);
};

const createBmp24 = (width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number]): Buffer => {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const buffer = Buffer.alloc(54 + pixelBytes, 0);
  buffer.write("BM", 0, 2, "ascii");
  buffer.writeUInt32LE(buffer.length, 2); buffer.writeUInt32LE(54, 10); buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18); buffer.writeInt32LE(height, 22); buffer.writeUInt16LE(1, 26); buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelBytes, 34); buffer.writeInt32LE(2835, 38); buffer.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = 54 + (height - 1 - y) * rowStride;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x, y);
      const offset = rowOffset + x * 3;
      buffer[offset] = blue; buffer[offset + 1] = green; buffer[offset + 2] = red;
    }
  }
  return buffer;
};

const compState = (response: AeMarkerMotionResponseV20): Record<string, unknown> | null => nestedRecord(nestedRecord(response.readback, "compMotion"), "state");
const layerState = (response: AeMarkerMotionResponseV20): Record<string, unknown> | null => nestedRecord(nestedRecord(response.readback, "layerMotion"), "state");
const markerEntries = (response: AeMarkerMotionResponseV20): readonly unknown[] => {
  const readback = asRecord(response.readback);
  return Array.isArray(readback?.["markers"]) ? readback["markers"] as readonly unknown[] : [];
};

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const acceptedP1P2Path = requireArgument("--accepted-p1-p2");
  const timeoutMs = Number(argument("--timeout-ms") ?? "180000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  await mkdir(artifactDir, { recursive: true });
  const sourcePath = path.join(artifactDir, "p3-motion-source.bmp");
  const baselineRenderPath = path.join(artifactDir, "p3-baseline-no-frame-blend.avi");
  const frameMixRenderPath = path.join(artifactDir, "p3-frame-mix-motion-blur.avi");
  const pixelMotionRenderPath = path.join(artifactDir, "p3-pixel-motion-motion-blur.avi");
  const restoredRenderPath = path.join(artifactDir, "p3-restored-baseline.avi");
  const recoveryRenderPath = path.join(artifactDir, "p4-post-rollback-baseline.avi");

  const checks: Record<string, boolean> = {};
  const responses: RecordedResponse[] = [];
  const cleanupErrors: string[] = [];
  let failureError: string | null = null;
  let classificationHint: "PRODUCT_FAILURE" | "INFRASTRUCTURE_FAILURE" = "PRODUCT_FAILURE";
  let mutationStarted = false;
  let cleanupComplete = false;
  let broker: LoopbackCepBroker | null = null;
  let client: AeCepAdapterClientV11 | null = null;
  let state: ObservedProjectState | null = null;
  let projectSnapshot: AeProjectSnapshot | null = null;
  let hostRevision: number | null = null;
  let baselineFingerprint: string | null = null;
  let baselineItemCount: number | null = null;
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null;
  let environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;
  let cleanupUndoCount = 0;
  let acceptedP1P2Sha256: string | null = null;

  const projectId = "m3-marker-motion-p3-p4-real-ae";
  const prefix = `M3_MARKER_MOTION_P34_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const footageStable = `${prefix}_FOOTAGE`;
  const sourceCompStable = `${prefix}_SOURCE_COMP`;
  const sourceLayerStable = `${prefix}_SOURCE_LAYER`;
  const targetCompStable = `${prefix}_TARGET_COMP`;
  const targetLayerStable = `${prefix}_TARGET_LAYER`;
  const temporaryItemStableIds = new Set([footageStable, sourceCompStable, targetCompStable]);
  let operationCounter = 0;
  let requestCounter = 0;

  const baselineCompMotion: AeCompMotionStateV20 = { motionBlur: false, frameBlending: false, shutterAngle: 180, shutterPhase: -90, samplesPerFrame: 16, adaptiveSampleLimit: 128 };
  const contrastCompMotion: AeCompMotionStateV20 = { motionBlur: true, frameBlending: true, shutterAngle: 720, shutterPhase: -360, samplesPerFrame: 64, adaptiveSampleLimit: 256 };
  const baselineLayerMotion: AeLayerMotionStateV20 = { motionBlur: false, frameBlendingType: "NO_FRAME_BLEND" };
  const frameMixLayerMotion: AeLayerMotionStateV20 = { motionBlur: true, frameBlendingType: "FRAME_MIX" };
  const pixelMotionLayerMotion: AeLayerMotionStateV20 = { motionBlur: true, frameBlendingType: "PIXEL_MOTION" };

  const recordResponse = (response: { readonly protocolVersion: string; readonly command: string; readonly outcome: string; readonly error: unknown; readonly hostProjectRevision: number | null; readonly diagnostics: { readonly notes?: readonly string[] } }): void => {
    responses.push({ protocolVersion: response.protocolVersion, command: response.command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision, notes: response.diagnostics.notes ?? [] });
  };

  const refresh = async (): Promise<void> => {
    if (client === null) throw new Error("Setup client unavailable.");
    const observed = await client.observe(projectId);
    state = observed.observed; projectSnapshot = observed.project; hostRevision = observed.hostRevision;
  };

  const executeV11 = async (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>, refreshAfter = true): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("Setup client unavailable.");
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_${++operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M3_MARKER_MOTION_P3_P4_FIXTURE",
    });
    recordResponse(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`${command}: ${response.error?.code ?? response.outcome}`);
    if (response.outcome === "APPLIED") mutationStarted = true;
    if (refreshAfter) await refresh();
    return response;
  };

  const dispatchV20 = async (command: AeMarkerMotionCommandV20, payload: Readonly<Record<string, unknown>>, expectedRevision: number | null, readbackProfile = "M3_MARKER_MOTION_P3_P4_STRUCTURAL"): Promise<AeMarkerMotionResponseV20> => {
    if (broker === null) throw new Error("Broker unavailable.");
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
    if (response.outcome === "APPLIED") mutationStarted = true;
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const setCompExact = async (requested: AeCompMotionStateV20, profile?: string): Promise<AeMarkerMotionResponseV20> => {
    const response = await dispatchV20("comp.motion.set", { comp: { stableId: targetCompStable }, state: requested }, hostRevision, profile);
    if (response.outcome !== "APPLIED" && response.outcome !== "NO_OP") throw new Error(`comp.motion.set failed: ${response.error?.code ?? response.outcome}`);
    await refresh();
    const readback = await dispatchV20("comp.motion.readback", { comp: { stableId: targetCompStable } }, null);
    if (readback.outcome !== "NO_OP" || !equal(compState(readback), requested)) throw new Error("Composition motion state did not match exact readback.");
    return readback;
  };

  const setLayerExact = async (requested: AeLayerMotionStateV20): Promise<AeMarkerMotionResponseV20> => {
    const response = await dispatchV20("layer.motion.set", { comp: { stableId: targetCompStable }, layer: { stableId: targetLayerStable }, state: requested }, hostRevision);
    if (response.outcome !== "APPLIED" && response.outcome !== "NO_OP") throw new Error(`layer.motion.set failed: ${response.error?.code ?? response.outcome}`);
    await refresh();
    const readback = await dispatchV20("layer.motion.readback", { comp: { stableId: targetCompStable }, layer: { stableId: targetLayerStable } }, null);
    const observed = layerState(readback);
    if (readback.outcome !== "NO_OP" || observed?.["motionBlur"] !== requested.motionBlur || observed?.["frameBlendingType"] !== requested.frameBlendingType) throw new Error("Layer motion state did not match exact readback.");
    return readback;
  };

  const renderTarget = async (outputPath: string): Promise<RenderCompletionFile> => {
    const scheduled = await executeV11("render.capture", { comp: { stableId: targetCompStable }, outputPath, timeSpanStart: 0, timeSpanDuration: 0.75 }, false);
    const readback = asRecord(scheduled.readback);
    const jobId = readback?.["jobId"];
    const completionPath = readback?.["completionPath"];
    const requestedOutputPath = readback?.["requestedOutputPath"];
    if (typeof jobId !== "string" || typeof completionPath !== "string" || typeof requestedOutputPath !== "string") throw new Error("render.capture did not return a bounded async completion contract.");
    const completion = await waitForRenderCompletion(completionPath, jobId, Math.min(timeoutMs, 60_000));
    if (!completion.ok || completion.status !== "DONE" || !completion.queueItemRemoved) throw new Error(`Render ${jobId} failed: ${completion.error ?? completion.status}`);
    if (!(await fileExistsNonEmpty(completion.outputPath))) throw new Error(`Render output is missing or empty: ${completion.outputPath}`);
    await refresh();
    return completion;
  };

  const restoreOriginalBaseline = async (): Promise<void> => {
    if (client === null || baselineFingerprint === null || baselineItemCount === null) return;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const current = await client.observe(projectId);
      state = current.observed; projectSnapshot = current.project; hostRevision = current.hostRevision;
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
    throw new Error("Cleanup undo budget exhausted before exact warm-project baseline restoration.");
  };

  try {
    const acceptedBytes = await readFile(acceptedP1P2Path);
    parseAcceptedP1P2(JSON.parse(stripUtf8Bom(acceptedBytes.toString("utf8"))) as unknown);
    acceptedP1P2Sha256 = createHash("sha256").update(acceptedBytes).digest("hex");
    checks.accepted_p1_p2 = true;

    classificationHint = "INFRASTRUCTURE_FAILURE";
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
    if (!checks.panel_negotiated_v20 || !checks.panel_supports_v11_v20) throw new Error("Protocol 2.0 panel negotiation failed.");

    client = new AeCepAdapterClientV11(broker, () => `m3-marker-motion-p34-setup-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects";
    if (!checks.host_probe) throw new Error("Real After Effects host probe failed.");
    const baseline = await client.observe(projectId);
    state = baseline.observed; projectSnapshot = baseline.project; hostRevision = baseline.hostRevision;
    baselineFingerprint = baseline.observed.projectFingerprint; baselineItemCount = baseline.project.itemCount;
    classificationHint = "PRODUCT_FAILURE";

    await writeFile(sourcePath, createBmp24(28, 28, (x, y) => {
      const border = x < 3 || y < 3 || x > 24 || y > 24;
      return border ? [255, 255, 255] : ((x + y) % 2 === 0 ? [250, 48, 48] : [255, 210, 48]);
    }));
    await executeV11("media.import", { path: sourcePath, stableId: footageStable, sequence: false });
    await executeV11("comp.create", { stableId: sourceCompStable, name: `${prefix} Source 6fps`, width: 160, height: 90, pixelAspect: 1, duration: 1, frameRate: 6 });
    await executeV11("layer.add_media", { stableId: sourceLayerStable, comp: { stableId: sourceCompStable }, item: { stableId: footageStable } });
    await executeV11("property.set_keyframes", {
      comp: { stableId: sourceCompStable }, layer: { stableId: sourceLayerStable }, propertyPath: ["ADBE Transform Group", "ADBE Position"],
      keyframes: [{ time: 0, value: [18, 45] }, { time: 0.5, value: [142, 45] }, { time: 1, value: [18, 45] }],
    });
    await executeV11("comp.create", { stableId: targetCompStable, name: `${prefix} Marker Motion Visual`, width: 320, height: 180, pixelAspect: 1, duration: 1, frameRate: 24 });
    await executeV11("layer.add_media", { stableId: targetLayerStable, comp: { stableId: targetCompStable }, item: { stableId: sourceCompStable } });
    await executeV11("property.set_keyframes", {
      comp: { stableId: targetCompStable }, layer: { stableId: targetLayerStable }, propertyPath: ["ADBE Transform Group", "ADBE Position"],
      keyframes: [{ time: 0, value: [80, 90] }, { time: 0.5, value: [240, 90] }, { time: 1, value: [80, 90] }],
    });
    checks.fixture_created = true;

    await setCompExact(baselineCompMotion);
    await setLayerExact(baselineLayerMotion);

    const compMarker = { comment: "Impact", chapter: "P3", duration: 0.125, eventCuePoint: true, label: 9, protectedRegion: true, parameters: { proof: "marker-motion", role: "accent" } };
    const compTarget = { kind: "COMP", comp: { stableId: targetCompStable } };
    const compMarkerSet = await dispatchV20("marker.set", { target: compTarget, time: 0.25, marker: compMarker }, hostRevision);
    if (compMarkerSet.outcome !== "APPLIED" && compMarkerSet.outcome !== "NO_OP") throw new Error(`Composition marker set failed: ${compMarkerSet.error?.code ?? compMarkerSet.outcome}`);
    await refresh();
    const compMarkerRead = await dispatchV20("marker.readback", { target: compTarget }, null);
    const compEntries = markerEntries(compMarkerRead);
    const compEntry = compEntries.length > 0 ? asRecord(compEntries[0]) : null;
    checks.p3_comp_marker_structural = compEntry?.["time"] === 0.25 && equal(compEntry?.["marker"], { ...compMarker, url: "", frameTarget: "", cuePointName: "" });

    const layerMarker = { comment: "Motion cue", duration: 0, eventCuePoint: false, label: 3, protectedRegion: false, parameters: { owner: "EditFlow2" } };
    const layerTarget = { kind: "LAYER", comp: { stableId: targetCompStable }, layer: { stableId: targetLayerStable } };
    const layerMarkerSet = await dispatchV20("marker.set", { target: layerTarget, time: 0.5, marker: layerMarker }, hostRevision);
    if (layerMarkerSet.outcome !== "APPLIED" && layerMarkerSet.outcome !== "NO_OP") throw new Error(`Layer marker set failed: ${layerMarkerSet.error?.code ?? layerMarkerSet.outcome}`);
    await refresh();
    const layerMarkerRead = await dispatchV20("marker.readback", { target: layerTarget }, null);
    const layerEntries = markerEntries(layerMarkerRead);
    const layerEntry = layerEntries.length > 0 ? asRecord(layerEntries[0]) : null;
    checks.p3_layer_marker_structural = layerEntry?.["time"] === 0.5 && equal(layerEntry?.["marker"], { ...layerMarker, chapter: "", url: "", frameTarget: "", cuePointName: "" });

    const baselineRender = await renderTarget(baselineRenderPath);
    checks.p3_baseline_artifact = await fileExistsNonEmpty(baselineRender.outputPath);

    await setCompExact(contrastCompMotion);
    await setLayerExact(frameMixLayerMotion);
    const frameMixRender = await renderTarget(frameMixRenderPath);
    checks.p3_frame_mix_artifact = await fileExistsNonEmpty(frameMixRender.outputPath);

    await setLayerExact(pixelMotionLayerMotion);
    const pixelMotionRender = await renderTarget(pixelMotionRenderPath);
    checks.p3_pixel_motion_artifact = await fileExistsNonEmpty(pixelMotionRender.outputPath);

    await setLayerExact(baselineLayerMotion);
    await setCompExact(baselineCompMotion);
    const restoredComp = await dispatchV20("comp.motion.readback", { comp: { stableId: targetCompStable } }, null);
    const restoredLayer = await dispatchV20("layer.motion.readback", { comp: { stableId: targetCompStable }, layer: { stableId: targetLayerStable } }, null);
    checks.p3_restored_structural = equal(compState(restoredComp), baselineCompMotion) && layerState(restoredLayer)?.["motionBlur"] === false && layerState(restoredLayer)?.["frameBlendingType"] === "NO_FRAME_BLEND";
    const restoredRender = await renderTarget(restoredRenderPath);
    checks.p3_restored_baseline_artifact = await fileExistsNonEmpty(restoredRender.outputPath);
    checks.p3_visual_artifact_emitted = all(checks, ["p3_baseline_artifact", "p3_frame_mix_artifact", "p3_pixel_motion_artifact", "p3_restored_baseline_artifact"]);

    const beforeFailure = await client.observe(projectId);
    const beforeFailureComp = await dispatchV20("comp.motion.readback", { comp: { stableId: targetCompStable } }, null);
    checks.p4_baseline_comp_exact = equal(compState(beforeFailureComp), baselineCompMotion);
    const induced = await dispatchV20(
      "comp.motion.set",
      { comp: { stableId: targetCompStable }, state: contrastCompMotion },
      beforeFailure.hostRevision,
      "M3_MARKER_MOTION_P4_FAILURE_INJECTION",
    );
    checks.p4_induced_failure_reported = induced.outcome === "FAILED" && induced.error?.category === "PROOF_INJECTION" && induced.error?.code === "M3_MARKER_MOTION_P4_INDUCED_FAILURE";
    checks.p4_rollback_note = induced.diagnostics.notes.includes("Protocol 2.0 marker-motion mutation failed and was rolled back through the transaction undo boundary.");
    checks.p4_response_readback_restored = equal(compState(induced), baselineCompMotion);

    const afterFailure = await client.observe(projectId);
    state = afterFailure.observed; projectSnapshot = afterFailure.project; hostRevision = afterFailure.hostRevision;
    checks.p4_fingerprint_restored = afterFailure.observed.projectFingerprint === beforeFailure.observed.projectFingerprint;
    checks.p4_item_count_unchanged = afterFailure.project.itemCount === beforeFailure.project.itemCount;
    const afterFailureComp = await dispatchV20("comp.motion.readback", { comp: { stableId: targetCompStable } }, null);
    checks.p4_structural_state_restored = equal(compState(afterFailureComp), baselineCompMotion);
    const recoveryRender = await renderTarget(recoveryRenderPath);
    checks.p4_recovery_visual_artifact_emitted = await fileExistsNonEmpty(recoveryRender.outputPath);
    checks.p4 = all(checks, [
      "p4_baseline_comp_exact", "p4_induced_failure_reported", "p4_rollback_note", "p4_response_readback_restored",
      "p4_fingerprint_restored", "p4_item_count_unchanged", "p4_structural_state_restored", "p4_recovery_visual_artifact_emitted",
    ]);
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    if (client !== null) {
      try {
        await restoreOriginalBaseline();
        const finalState = await client.observe(projectId);
        const temporaryPresent = [...temporaryItemStableIds].some((stableId) => projectHasStableItem(finalState.project, stableId));
        checks.cleanup_temp_items_absent = !temporaryPresent;
        checks.cleanup_item_count_restored = baselineItemCount !== null && finalState.project.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint !== null && finalState.observed.projectFingerprint === baselineFingerprint;
        cleanupComplete = checks.cleanup_temp_items_absent === true && checks.cleanup_item_count_restored === true && checks.cleanup_fingerprint_restored === true;
      } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : String(error)); }
    } else {
      cleanupComplete = !mutationStarted;
    }
    if (broker !== null) {
      try { await broker.stop(); } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : String(error)); }
    }

    if (cleanupErrors.length > 0) cleanupComplete = false;
    const structuralP3 = all(checks, ["accepted_p1_p2", "panel_negotiated_v20", "panel_supports_v11_v20", "host_probe", "fixture_created", "p3_comp_marker_structural", "p3_layer_marker_structural", "p3_restored_structural", "p3_visual_artifact_emitted"]);
    const ok = failureError === null && cleanupComplete && structuralP3 && checks.p4 === true;
    const classification = ok ? "PASS" : classificationHint;
    const message = ok
      ? "Marker/motion P3 artifacts emitted for independent visual review; P4 failure injection, rollback, recovery render, and exact warm-project cleanup passed."
      : (failureError ?? (cleanupErrors.join("; ") || "Marker/motion P3/P4 proof failed bounded checks."));

    await writeJson(resultPath, {
      proofId: "M3_MARKER_MOTION_P3_P4_REAL_AE",
      classification,
      status: ok ? "VISUAL_REVIEW_REQUIRED" : "FAILURE",
      ok,
      message,
      lifecycle: process.env["EDITFLOW_AE_LIFECYCLE"] ?? null,
      mutationStarted,
      cleanupComplete,
      visualReviewRequired: ok,
      startedAt,
      completedAt: new Date().toISOString(),
      acceptedP1P2: { path: acceptedP1P2Path, sha256: acceptedP1P2Sha256 },
      proofLevels: {
        P1_validation_rejection: checks.accepted_p1_p2 === true,
        P2_structural_readback: checks.accepted_p1_p2 === true,
        P3_visual_artifact_emitted: checks.p3_visual_artifact_emitted === true,
        P3_visual_proof: false,
        P4_failure_injection_rollback: checks.p4 === true,
        P5_save_reopen_reconnect_transfer: false,
      },
      panel,
      environment,
      fixture: { footageStable, sourceCompStable, sourceLayerStable, targetCompStable, targetLayerStable },
      artifacts: { baselineRenderPath, frameMixRenderPath, pixelMotionRenderPath, restoredRenderPath, recoveryRenderPath },
      checks,
      responses,
      cleanupUndoCount,
      failureError,
      cleanupErrors,
    });
    if (!ok) process.exitCode = 1;
  }
};

void main().catch((error) => { console.error(error); process.exitCode = 1; });