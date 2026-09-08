import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11, type AeAdapterPublicCommandV11, type AeAdapterResponseV11 } from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_MARKER_MOTION_PROTOCOL_VERSION_V20, type AeMarkerMotionCommandV20, type AeMarkerMotionResponseV20 } from "../../../packages/adapters/ae-cep/src/protocol-v2_0.js";
import { buildMarkerMotionRequestV20 } from "../../../packages/adapters/ae-cep/src/m3-marker-motion.js";
import type { ObservedProjectState } from "../../../packages/core-contracts/src/index.js";
import type { AeProjectSnapshot } from "../../../packages/ae-object-model/src/index.js";
import { LoopbackCepBroker } from "./loopback-cep.js";

interface BridgeConfig {
  readonly schemaVersion: 1;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
  readonly protocolVersion: "1.1.0";
  readonly supportedProtocolVersions?: readonly string[];
  readonly extensionId: string;
  readonly extensionVersion: string;
}

interface AcceptedP1P2 {
  readonly proofId: string;
  readonly status: string;
  readonly ok: boolean;
  readonly cleanupComplete: boolean;
  readonly proofLevels?: Readonly<Record<string, unknown>>;
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
  if (!value) throw new Error(`Missing required argument ${name}.`);
  return value;
};

const stripBom = (value: string): string => value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
const asRecord = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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
const sleep = async (milliseconds: number): Promise<void> => { await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); };
const fileExistsNonEmpty = async (filePath: string): Promise<boolean> => { try { return (await stat(filePath)).size > 0; } catch { return false; } };
const sameFilesystemPath = (left: string, right: string): boolean => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

const parseConfig = (value: unknown): BridgeConfig => {
  const candidate = asRecord(value);
  if (candidate === null || candidate["schemaVersion"] !== 1 || candidate["host"] !== "127.0.0.1") throw new Error("Invalid bridge config.");
  if (!Number.isInteger(candidate["port"]) || typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("Invalid bridge endpoint/token.");
  const supported = candidate["supportedProtocolVersions"];
  if (!Array.isArray(supported) || !supported.includes(AE_MARKER_MOTION_PROTOCOL_VERSION_V20) || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("Bridge config does not advertise required protocols 2.0 and 1.1.");
  }
  return candidate as unknown as BridgeConfig;
};

const parseAcceptedP1P2 = (value: unknown): AcceptedP1P2 => {
  const candidate = asRecord(value);
  if (candidate === null) throw new Error("Accepted P1/P2 artifact must be an object.");
  if (candidate["proofId"] !== "M3_MARKER_MOTION_P1_P2_REAL_AE" || candidate["status"] !== "PASS" || candidate["ok"] !== true || candidate["cleanupComplete"] !== true) {
    throw new Error("Accepted dependency is not a passing marker-motion P1/P2 artifact.");
  }
  const levels = asRecord(candidate["proofLevels"]);
  if (levels?.["P1_validation_rejection"] !== true || levels?.["P2_structural_readback"] !== true || levels?.["P3_visual_proof"] !== false || levels?.["P4_failure_injection_rollback"] !== false || levels?.["P5_save_reopen_reconnect_transfer"] !== false) {
    throw new Error("Accepted marker-motion P1/P2 artifact has unexpected proof-level assertions.");
  }
  return candidate as unknown as AcceptedP1P2;
};

const parseRenderCompletion = (value: unknown): RenderCompletionFile => {
  const candidate = asRecord(value);
  if (candidate === null || candidate["schemaVersion"] !== 1) throw new Error("Invalid render completion marker.");
  if (typeof candidate["jobId"] !== "string" || (candidate["status"] !== "DONE" && candidate["status"] !== "FAILED") || typeof candidate["ok"] !== "boolean") throw new Error("Malformed render completion marker.");
  if (typeof candidate["outputPath"] !== "string" || (candidate["error"] !== null && typeof candidate["error"] !== "string") || typeof candidate["completedAtMs"] !== "number" || typeof candidate["queueItemRemoved"] !== "boolean") {
    throw new Error("Incomplete render completion marker.");
  }
  return candidate as unknown as RenderCompletionFile;
};

const waitForRenderCompletion = async (completionPath: string, expectedJobId: string, timeoutMs: number): Promise<RenderCompletionFile> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const completion = parseRenderCompletion(JSON.parse(stripBom(await readFile(completionPath, "utf8"))) as unknown);
      if (completion.jobId === expectedJobId) return completion;
      lastError = `stale completion marker ${completion.jobId}`;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
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

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const compMotionState = (response: AeMarkerMotionResponseV20): Record<string, unknown> | null => nestedRecord(nestedRecord(response.readback, "compMotion"), "state");
const layerMotionState = (response: AeMarkerMotionResponseV20): Record<string, unknown> | null => nestedRecord(nestedRecord(response.readback, "layerMotion"), "state");
const markerEntries = (response: AeMarkerMotionResponseV20): unknown[] => {
  const root = asRecord(response.readback);
  return Array.isArray(root?.["markers"]) ? root["markers"] as unknown[] : [];
};

const main = async (): Promise<void> => {
  const configPath = required("--config");
  const resultPath = required("--result");
  const acceptedP1P2Path = required("--accepted-p1-p2");
  const timeoutMs = Number(argument("--timeout-ms") ?? "240000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const acceptedBytes = await readFile(acceptedP1P2Path);
  const accepted = parseAcceptedP1P2(JSON.parse(stripBom(acceptedBytes.toString("utf8"))) as unknown);
  const acceptedSha256 = createHash("sha256").update(acceptedBytes).digest("hex");

  const motionSourcePath = path.join(artifactDir, "p3-motion-source.bmp");
  const sequenceDir = path.join(artifactDir, "p3-frame-sequence");
  const sequenceFirstPath = path.join(sequenceDir, "frame-0001.bmp");
  const motionOffPath = path.join(artifactDir, "p3-motion-blur-off.avi");
  const motionOnPath = path.join(artifactDir, "p3-motion-blur-on.avi");
  const motionRestoredPath = path.join(artifactDir, "p3-motion-blur-restored.avi");
  const frameMixPath = path.join(artifactDir, "p3-frame-mix.avi");
  const pixelMotionPath = path.join(artifactDir, "p3-pixel-motion.avi");
  const postRollbackPath = path.join(artifactDir, "p4-post-rollback.avi");

  await mkdir(sequenceDir, { recursive: true });
  await writeFile(motionSourcePath, createBmp24(96, 96, (x, y) => {
    const cross = Math.abs(x - 48) < 10 || Math.abs(y - 48) < 10;
    const ring = Math.abs(Math.hypot(x - 48, y - 48) - 34) < 5;
    return cross || ring ? [255, 255, 255] : [8, 8, 8];
  }));
  for (let frame = 0; frame < 24; frame += 1) {
    const center = 20 + Math.round((frame / 23) * 280);
    const sequencePath = path.join(sequenceDir, `frame-${String(frame + 1).padStart(4, "0")}.bmp`);
    await writeFile(sequencePath, createBmp24(320, 180, (x, y) => {
      const moving = Math.abs(x - center) < 18 && Math.abs(y - 90) < 45;
      const guide = x % 40 < 4 || y % 45 < 4;
      if (moving) return [255, 255, 255];
      if (guide) return [45, 45, 45];
      return [5, 5, 5];
    }));
  }

  const checks: Record<string, boolean> = {
    accepted_p1_p2: accepted.ok === true,
    motion_fixture_written: await fileExistsNonEmpty(motionSourcePath),
    sequence_fixture_written: await fileExistsNonEmpty(sequenceFirstPath),
  };
  const responses: RecordedResponse[] = [];
  const evidence: Record<string, unknown>[] = [];
  const cleanupErrors: string[] = [];
  let failureError: string | null = null;
  let cleanupComplete = false;
  let broker: LoopbackCepBroker | null = null;
  let client: AeCepAdapterClientV11 | null = null;
  let state: ObservedProjectState | null = null;
  let project: AeProjectSnapshot | null = null;
  let revision: number | null = null;
  let baselineFingerprint: string | null = null;
  let baselineItemCount: number | null = null;
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null;
  let environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;

  const prefix = `M3_MARKER_MOTION_P34_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const projectId = "m3-marker-motion-p3-p4-real-ae";
  const motionMediaStable = `${prefix}_MOTION_MEDIA`;
  const sequenceMediaStable = `${prefix}_SEQUENCE_MEDIA`;
  const motionCompStable = `${prefix}_MOTION_COMP`;
  const blendCompStable = `${prefix}_BLEND_COMP`;
  const motionLayerStable = `${prefix}_MOTION_LAYER`;
  const blendLayerStable = `${prefix}_BLEND_LAYER`;
  let requestCounter = 0;
  let operationCounter = 0;

  const recordV11 = (command: string, response: AeAdapterResponseV11): void => {
    responses.push({ protocolVersion: response.protocolVersion, command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision, notes: response.diagnostics.notes ?? [] });
  };
  const recordV20 = (response: AeMarkerMotionResponseV20): void => {
    responses.push({ protocolVersion: response.protocolVersion, command: response.command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision, notes: response.diagnostics.notes });
  };
  const refresh = async (): Promise<void> => {
    if (!client) throw new Error("Protocol 1.1 setup client unavailable.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    project = observed.project;
    revision = observed.hostRevision;
  };
  const executeV11 = async (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>, refreshAfter = true): Promise<AeAdapterResponseV11> => {
    if (!client || !state) throw new Error("Protocol 1.1 setup state unavailable.");
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_${++operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M3_MARKER_MOTION_P3_P4_SETUP",
    });
    recordV11(command, response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`${command}: ${response.error?.code ?? response.outcome}`);
    if (refreshAfter) await refresh();
    return response;
  };
  const dispatchV20 = async (command: AeMarkerMotionCommandV20, payload: Readonly<Record<string, unknown>>, expectedRevision: number | null, readbackProfile = "M3_MARKER_MOTION_P3_P4_STRUCTURAL"): Promise<AeMarkerMotionResponseV20> => {
    if (!broker) throw new Error("Protocol 2.0 broker unavailable.");
    const request = buildMarkerMotionRequestV20({
      requestId: `m3-marker-motion-p34-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V20_${++operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    });
    const response = await broker.dispatch(request);
    recordV20(response);
    if (typeof response.hostProjectRevision === "number") revision = response.hostProjectRevision;
    return response;
  };
  const requireMutation = async (command: AeMarkerMotionCommandV20, payload: Readonly<Record<string, unknown>>): Promise<AeMarkerMotionResponseV20> => {
    const response = await dispatchV20(command, payload, revision);
    if (response.outcome !== "APPLIED" && response.outcome !== "NO_OP") throw new Error(`${command}: ${response.error?.code ?? response.outcome}`);
    await refresh();
    return response;
  };
  const renderComp = async (compStableId: string, outputPath: string, duration: number): Promise<RenderCompletionFile> => {
    const scheduled = await executeV11("render.capture", { comp: { stableId: compStableId }, outputPath, timeSpanStart: 0, timeSpanDuration: duration }, false);
    const readback = asRecord(scheduled.readback);
    const jobId = readback?.["jobId"], completionPath = readback?.["completionPath"], requestedOutputPath = readback?.["requestedOutputPath"], canonicalOutputPath = readback?.["outputPath"];
    if (typeof jobId !== "string" || typeof completionPath !== "string" || typeof requestedOutputPath !== "string" || typeof canonicalOutputPath !== "string") throw new Error("render.capture did not return complete job/path readback.");
    if (!sameFilesystemPath(requestedOutputPath, outputPath)) throw new Error("render.capture requested path readback mismatch.");
    const relative = path.relative(artifactDir, canonicalOutputPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Canonical render escaped artifact directory: ${canonicalOutputPath}`);
    const completion = await waitForRenderCompletion(completionPath, jobId, timeoutMs);
    if (!completion.ok || completion.status !== "DONE" || !completion.queueItemRemoved) throw new Error(`Render ${jobId} failed: ${completion.error ?? completion.status}`);
    if (!sameFilesystemPath(completion.outputPath, canonicalOutputPath) || !(await fileExistsNonEmpty(completion.outputPath))) throw new Error("Completed render path missing or mismatched.");
    await refresh();
    return completion;
  };

  try {
    const config = parseConfig(JSON.parse(stripBom(await readFile(configPath, "utf8"))) as unknown);
    broker = new LoopbackCepBroker({ port: config.port, token: config.token, commandTimeoutMs: Math.min(timeoutMs, 45_000), commandLeaseMs: 2_000, expectedExtensionId: config.extensionId, supportedProtocolVersions: [AE_MARKER_MOTION_PROTOCOL_VERSION_V20, AE_ADAPTER_PROTOCOL_VERSION_V11] });
    if (await broker.start() !== config.port) throw new Error("CEP broker bound unexpected port.");
    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v20 = panel.protocolVersion === AE_MARKER_MOTION_PROTOCOL_VERSION_V20;
    checks.panel_supports_v11_v20 = panel.supportedProtocolVersions.includes(AE_MARKER_MOTION_PROTOCOL_VERSION_V20) && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v20 || !checks.panel_supports_v11_v20) throw new Error("Protocol 2.0 negotiation failed.");

    client = new AeCepAdapterClientV11(broker, () => `m3-marker-motion-p34-setup-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects";
    const baseline = await client.observe(projectId);
    state = baseline.observed; project = baseline.project; revision = baseline.hostRevision;
    baselineFingerprint = state.projectFingerprint; baselineItemCount = project.itemCount;
    if (project.itemCount !== 0 || state.projectFingerprint === null) throw new Error("P3/P4 requires the isolated fresh blank unsaved proof project.");

    await executeV11("media.import", { path: motionSourcePath, stableId: motionMediaStable, sequence: false });
    await executeV11("media.import", { path: sequenceFirstPath, stableId: sequenceMediaStable, sequence: true });
    await executeV11("comp.create", { stableId: motionCompStable, name: `${prefix} Motion`, width: 640, height: 360, pixelAspect: 1, duration: 2, frameRate: 24 });
    await executeV11("comp.create", { stableId: blendCompStable, name: `${prefix} Blend`, width: 320, height: 180, pixelAspect: 1, duration: 2, frameRate: 24 });
    await executeV11("layer.add_media", { stableId: motionLayerStable, comp: { stableId: motionCompStable }, item: { stableId: motionMediaStable }, duration: 2 });
    await executeV11("layer.add_media", { stableId: blendLayerStable, comp: { stableId: blendCompStable }, item: { stableId: sequenceMediaStable } });
    await executeV11("layer.set_timing", { comp: { stableId: blendCompStable }, layer: { stableId: blendLayerStable }, timing: { startTime: 0, stretch: 400 } });
    await executeV11("property.set_keyframes", {
      comp: { stableId: motionCompStable },
      layer: { stableId: motionLayerStable },
      propertyPath: ["ADBE Transform Group", "ADBE Position"],
      keyframes: [
        { time: 0, value: [80, 180] },
        { time: 0.5, value: [560, 180] },
        { time: 1, value: [80, 180] },
        { time: 1.5, value: [560, 180] },
      ],
    });

    const motionOff = { motionBlur: false, frameBlending: false, shutterAngle: 180, shutterPhase: -90, samplesPerFrame: 16, adaptiveSampleLimit: 128 };
    const motionOn = { motionBlur: true, frameBlending: false, shutterAngle: 360, shutterPhase: -180, samplesPerFrame: 32, adaptiveSampleLimit: 128 };
    const motionLayerOff = { motionBlur: false, frameBlendingType: "NO_FRAME_BLEND" };
    const motionLayerOn = { motionBlur: true, frameBlendingType: "NO_FRAME_BLEND" };
    const blendCompState = { motionBlur: false, frameBlending: true, shutterAngle: 180, shutterPhase: -90, samplesPerFrame: 16, adaptiveSampleLimit: 128 };
    const frameMixState = { motionBlur: false, frameBlendingType: "FRAME_MIX" };
    const pixelMotionState = { motionBlur: false, frameBlendingType: "PIXEL_MOTION" };

    await requireMutation("comp.motion.set", { comp: { stableId: motionCompStable }, state: motionOff });
    await requireMutation("layer.motion.set", { comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable }, state: motionLayerOff });
    const offRender = await renderComp(motionCompStable, motionOffPath, 1.5);
    checks.p3_motion_off_artifact = await fileExistsNonEmpty(offRender.outputPath);

    await requireMutation("comp.motion.set", { comp: { stableId: motionCompStable }, state: motionOn });
    await requireMutation("layer.motion.set", { comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable }, state: motionLayerOn });
    const onRead = await dispatchV20("comp.motion.readback", { comp: { stableId: motionCompStable } }, null);
    checks.p3_nondefault_shutter_structural = equal(compMotionState(onRead), motionOn);
    const onRender = await renderComp(motionCompStable, motionOnPath, 1.5);
    checks.p3_motion_on_artifact = await fileExistsNonEmpty(onRender.outputPath);

    await requireMutation("comp.motion.set", { comp: { stableId: motionCompStable }, state: motionOff });
    await requireMutation("layer.motion.set", { comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable }, state: motionLayerOff });
    const restoredRender = await renderComp(motionCompStable, motionRestoredPath, 1.5);
    checks.p3_motion_restored_artifact = await fileExistsNonEmpty(restoredRender.outputPath);

    await requireMutation("comp.motion.set", { comp: { stableId: blendCompStable }, state: blendCompState });
    await requireMutation("layer.motion.set", { comp: { stableId: blendCompStable }, layer: { stableId: blendLayerStable }, state: frameMixState });
    const mixRender = await renderComp(blendCompStable, frameMixPath, 1.5);
    checks.p3_frame_mix_artifact = await fileExistsNonEmpty(mixRender.outputPath);
    await requireMutation("layer.motion.set", { comp: { stableId: blendCompStable }, layer: { stableId: blendLayerStable }, state: pixelMotionState });
    const pixelRead = await dispatchV20("layer.motion.readback", { comp: { stableId: blendCompStable }, layer: { stableId: blendLayerStable } }, null);
    checks.p3_pixel_motion_structural = layerMotionState(pixelRead)?.["frameBlendingType"] === "PIXEL_MOTION";
    const pixelRender = await renderComp(blendCompStable, pixelMotionPath, 1.5);
    checks.p3_pixel_motion_artifact = await fileExistsNonEmpty(pixelRender.outputPath);

    const compMarker = { comment: "Impact", chapter: "P3", url: "https://example.invalid/editflow/p3", frameTarget: "motion", cuePointName: "impact", duration: 0.25, eventCuePoint: true, label: 9, protectedRegion: true, parameters: { role: "accent", proof: "P3" } };
    const layerMarker = { comment: "Motion cue", chapter: "", url: "", frameTarget: "", cuePointName: "", duration: 0, eventCuePoint: false, label: 3, protectedRegion: false, parameters: { owner: "EditFlow" } };
    const compTarget = { kind: "COMP", comp: { stableId: motionCompStable } };
    const layerTarget = { kind: "LAYER", comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable } };
    await requireMutation("marker.set", { target: compTarget, time: 0.5, marker: compMarker });
    await requireMutation("marker.set", { target: layerTarget, time: 1.0, marker: layerMarker });
    const compMarkerRead = await dispatchV20("marker.readback", { target: compTarget }, null);
    const layerMarkerRead = await dispatchV20("marker.readback", { target: layerTarget }, null);
    checks.p3_comp_marker_structural = markerEntries(compMarkerRead).length === 1;
    checks.p3_layer_marker_structural = markerEntries(layerMarkerRead).length === 1;
    evidence.push({ kind: "markerTimelineEvidence", compMarkers: markerEntries(compMarkerRead), layerMarkers: markerEntries(layerMarkerRead) });

    checks.p3 = checks.p3_motion_off_artifact && checks.p3_motion_on_artifact && checks.p3_motion_restored_artifact
      && checks.p3_frame_mix_artifact && checks.p3_pixel_motion_artifact && checks.p3_nondefault_shutter_structural
      && checks.p3_pixel_motion_structural && checks.p3_comp_marker_structural && checks.p3_layer_marker_structural;

    const p4Profile = "M3_MARKER_MOTION_P4_FAILURE_INJECTION";
    const verifyInjectedRollback = async (name: string, command: AeMarkerMotionCommandV20, payload: Readonly<Record<string, unknown>>, beforeRead: () => Promise<unknown>): Promise<void> => {
      const beforeObserved = await client!.observe(projectId);
      const beforeValue = await beforeRead();
      state = beforeObserved.observed; project = beforeObserved.project; revision = beforeObserved.hostRevision;
      const response = await dispatchV20(command, payload, revision, p4Profile);
      const afterObserved = await client!.observe(projectId);
      state = afterObserved.observed; project = afterObserved.project; revision = afterObserved.hostRevision;
      const afterValue = await beforeRead();
      checks[`${name}_induced_failure_reported`] = response.outcome === "FAILED" && response.error?.category === "PROOF_INJECTION" && response.error?.code === "M3_MARKER_MOTION_P4_INDUCED_FAILURE";
      checks[`${name}_fingerprint_restored`] = beforeObserved.observed.projectFingerprint === afterObserved.observed.projectFingerprint;
      checks[`${name}_item_count_unchanged`] = beforeObserved.project.itemCount === afterObserved.project.itemCount;
      checks[`${name}_structural_state_restored`] = equal(beforeValue, afterValue);
      checks[`${name}_response_has_restored_readback`] = response.readback !== null;
    };

    await verifyInjectedRollback("p4_comp_motion", "comp.motion.set", { comp: { stableId: motionCompStable }, state: motionOn }, async () => {
      const response = await dispatchV20("comp.motion.readback", { comp: { stableId: motionCompStable } }, null);
      return compMotionState(response);
    });
    await verifyInjectedRollback("p4_layer_motion", "layer.motion.set", { comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable }, state: motionLayerOn }, async () => {
      const response = await dispatchV20("layer.motion.readback", { comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable } }, null);
      return layerMotionState(response);
    });
    const injectedMarker = { comment: "P4 induced", chapter: "rollback", url: "", frameTarget: "", cuePointName: "proof", duration: 0.1, eventCuePoint: true, label: 6, protectedRegion: false, parameters: { proof: "rollback" } };
    await verifyInjectedRollback("p4_marker_set", "marker.set", { target: compTarget, time: 1.5, marker: injectedMarker }, async () => {
      const response = await dispatchV20("marker.readback", { target: compTarget }, null);
      return markerEntries(response);
    });
    await verifyInjectedRollback("p4_marker_remove", "marker.remove", { target: layerTarget, keyIndex: 1 }, async () => {
      const response = await dispatchV20("marker.readback", { target: layerTarget }, null);
      return markerEntries(response);
    });

    checks.p4 = ["p4_comp_motion", "p4_layer_motion", "p4_marker_set", "p4_marker_remove"].every((name) =>
      checks[`${name}_induced_failure_reported`] === true
      && checks[`${name}_fingerprint_restored`] === true
      && checks[`${name}_item_count_unchanged`] === true
      && checks[`${name}_structural_state_restored`] === true
      && checks[`${name}_response_has_restored_readback`] === true);

    const recovery = await renderComp(motionCompStable, postRollbackPath, 1.5);
    checks.p4_recovery_visual_artifact_emitted = await fileExistsNonEmpty(recovery.outputPath);
    checks.p4_cleanup_trigger_restored_baseline = baselineFingerprint !== null && baselineItemCount !== null
      && state?.projectFingerprint === baselineFingerprint && project?.itemCount === baselineItemCount;
    checks.p4 = checks.p4 && checks.p4_recovery_visual_artifact_emitted && checks.p4_cleanup_trigger_restored_baseline;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    if (client) {
      try {
        const final = await client.observe(projectId);
        state = final.observed; project = final.project; revision = final.hostRevision;
        checks.cleanup_item_count_restored = baselineItemCount !== null && final.project.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint !== null && final.observed.projectFingerprint === baselineFingerprint;
        checks.cleanup_blank_unsaved = final.project.itemCount === 0 && final.project.filePath === null;
        cleanupComplete = checks.cleanup_item_count_restored && checks.cleanup_fingerprint_restored && checks.cleanup_blank_unsaved;
      } catch (error) { cleanupErrors.push(`final-inspect: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (broker) {
      try { await broker.stop(); }
      catch (error) { cleanupErrors.push(`broker-stop: ${error instanceof Error ? error.message : String(error)}`); }
    }

    const ok = failureError === null && cleanupErrors.length === 0 && cleanupComplete
      && checks.accepted_p1_p2 === true && checks.motion_fixture_written === true && checks.sequence_fixture_written === true
      && checks.panel_negotiated_v20 === true && checks.panel_supports_v11_v20 === true && checks.host_probe === true
      && checks.p3 === true && checks.p4 === true;

    await writeJson(resultPath, {
      proofId: "M3_MARKER_MOTION_P3_P4_REAL_AE",
      status: ok ? "VISUAL_REVIEW_REQUIRED" : "FAILURE",
      ok,
      visualReviewRequired: ok,
      startedAt,
      completedAt: new Date().toISOString(),
      acceptedP1P2: { path: acceptedP1P2Path, sha256: acceptedSha256, proofId: accepted.proofId, status: accepted.status },
      proofLevels: {
        P1_validation_rejection: accepted.ok === true,
        P2_structural_readback: accepted.ok === true,
        P3_visual_artifact_emitted: checks.p3 === true,
        P3_visual_proof: false,
        P4_failure_injection_rollback: checks.p4 === true,
        P5_save_reopen_reconnect_transfer: false,
      },
      panel,
      environment,
      fixture: { motionMediaStable, sequenceMediaStable, motionCompStable, blendCompStable, motionLayerStable, blendLayerStable },
      visualReview: {
        artifacts: [motionOffPath, motionOnPath, motionRestoredPath, frameMixPath, pixelMotionPath, postRollbackPath],
        assertionsToReview: [
          "motion-blur-on must visibly differ from motion-blur-off on the rapidly translated high-contrast layer",
          "motion-blur-restored must return to the no-motion-blur appearance",
          "frame-mix and pixel-motion must be reviewed as retimed image-sequence footage rather than a precomp",
          "post-rollback must match the restored no-motion-blur state after all induced failures",
        ],
      },
      cleanupComplete,
      checks,
      evidence,
      responses,
      failureError,
      cleanupErrors,
    });
    if (!ok) process.exitCode = 1;
  }
};

void main().catch((error) => { console.error(error); process.exitCode = 1; });
