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
const writeJson = async (file: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const sleep = async (milliseconds: number): Promise<void> => { await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); };
const nonEmpty = async (file: string): Promise<boolean> => { try { return (await stat(file)).size > 0; } catch { return false; } };
const samePath = (left: string, right: string): boolean => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

const parseConfig = (value: unknown): BridgeConfig => {
  const candidate = record(value);
  if (candidate === null || candidate["schemaVersion"] !== 1 || candidate["host"] !== "127.0.0.1") throw new Error("Bridge config schema/host is invalid.");
  if (!Number.isInteger(candidate["port"]) || typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("Bridge config port/token is invalid.");
  const supported = candidate["supportedProtocolVersions"];
  if (!Array.isArray(supported) || !supported.includes(AE_MARKER_MOTION_PROTOCOL_VERSION_V20) || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) throw new Error("Warm CEP config does not advertise required protocols 2.0 and 1.1.");
  if (typeof candidate["extensionId"] !== "string" || typeof candidate["extensionVersion"] !== "string") throw new Error("Bridge extension identity is invalid.");
  return candidate as unknown as BridgeConfig;
};

const parseRenderCompletion = (value: unknown): RenderCompletionFile => {
  const candidate = record(value);
  if (candidate === null || candidate["schemaVersion"] !== 1) throw new Error("Render completion marker is invalid.");
  if (typeof candidate["jobId"] !== "string" || (candidate["status"] !== "DONE" && candidate["status"] !== "FAILED") || typeof candidate["ok"] !== "boolean" || typeof candidate["outputPath"] !== "string" || typeof candidate["completedAtMs"] !== "number" || typeof candidate["queueItemRemoved"] !== "boolean") throw new Error("Render completion marker fields are invalid.");
  if (candidate["error"] !== null && typeof candidate["error"] !== "string") throw new Error("Render completion marker error is invalid.");
  return candidate as unknown as RenderCompletionFile;
};

const waitForRenderCompletion = async (completionPath: string, expectedJobId: string, timeoutMs: number): Promise<RenderCompletionFile> => {
  const deadline = Date.now() + timeoutMs;
  let lastError = "completion marker not written";
  while (Date.now() < deadline) {
    try {
      const completion = parseRenderCompletion(JSON.parse(stripBom(await readFile(completionPath, "utf8"))) as unknown);
      if (completion.jobId === expectedJobId) return completion;
      lastError = `stale completion marker ${completion.jobId}`;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await sleep(200);
  }
  throw new Error(`RENDER_JOB_COMPLETION_TIMEOUT: ${expectedJobId} (${lastError})`);
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

const main = async (): Promise<void> => {
  const configPath = required("--config");
  const resultPath = required("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "240000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const sequenceDir = path.join(artifactDir, "p3-frame-blending-sequence");
  const movingSourcePath = path.join(artifactDir, "p3-motion-source.bmp");
  const motionBaselinePath = path.join(artifactDir, "p3-motion-blur-off.avi");
  const motionContrastPath = path.join(artifactDir, "p3-motion-blur-shutter-on.avi");
  const frameOffPath = path.join(artifactDir, "p3-frame-blending-off.avi");
  const frameMixPath = path.join(artifactDir, "p3-frame-mix.avi");
  const pixelMotionPath = path.join(artifactDir, "p3-pixel-motion.avi");
  const postRollbackPath = path.join(artifactDir, "p4-post-rollback.avi");

  const checks: Record<string, boolean> = {};
  const evidence: Record<string, unknown>[] = [];
  const responses: RecordedResponse[] = [];
  const cleanupErrors: string[] = [];
  let broker: LoopbackCepBroker | null = null;
  let client: AeCepAdapterClientV11 | null = null;
  let state: ObservedProjectState | null = null;
  let project: AeProjectSnapshot | null = null;
  let hostRevision: number | null = null;
  let baselineFingerprint: string | null = null;
  let baselineItemCount: number | null = null;
  let failureError: string | null = null;
  let cleanupComplete = false;
  let mutationStarted = false;
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null;
  let environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;

  const prefix = `M3_MARKER_MOTION_P34_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const projectId = "m3-marker-motion-p3-p4-real-ae";
  const movingSourceStable = `${prefix}_MOTION_SOURCE`;
  const motionCompStable = `${prefix}_MOTION_COMP`;
  const motionLayerStable = `${prefix}_MOTION_LAYER`;
  const sequenceStable = `${prefix}_SEQUENCE_SOURCE`;
  const frameCompStable = `${prefix}_FRAME_COMP`;
  const frameLayerStable = `${prefix}_FRAME_LAYER`;
  const temporaryStableIds = new Set([movingSourceStable, motionCompStable, sequenceStable, frameCompStable]);
  let operation = 0;
  let request = 0;

  const recordResponse = (response: AeAdapterResponseV11 | AeMarkerMotionResponseV20): void => {
    responses.push({ protocolVersion: response.protocolVersion, command: response.command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision, notes: response.diagnostics.notes ?? [] });
  };
  const refresh = async (): Promise<void> => {
    if (!client) throw new Error("P3/P4 client unavailable.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    project = observed.project;
    hostRevision = observed.hostRevision;
  };
  const executeV11 = async (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>, refreshAfter = true): Promise<AeAdapterResponseV11> => {
    if (!client || !state) throw new Error("P3/P4 V11 state unavailable.");
    const response = await client.executePublic(command, { transactionId, operationId: `${transactionId}_V11_${++operation}`, payload, expectedState: state, readbackProfile: "M3_MARKER_MOTION_P3_P4_SETUP" });
    recordResponse(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`${command}: ${response.error?.code ?? response.outcome}`);
    mutationStarted = mutationStarted || command !== "render.capture";
    if (refreshAfter) await refresh();
    return response;
  };
  const dispatch = async (command: AeMarkerMotionCommandV20, payload: Readonly<Record<string, unknown>>, expectedRevision: number | null, readbackProfile = "M3_MARKER_MOTION_P3_P4_STRUCTURAL"): Promise<AeMarkerMotionResponseV20> => {
    if (!broker) throw new Error("Protocol 2.0 broker unavailable.");
    const response = await broker.dispatch(buildMarkerMotionRequestV20({ requestId: `m3-marker-motion-p34-${++request}`, transactionId, operationId: `${transactionId}_V20_${++operation}`, command, expectedHostProjectRevision: expectedRevision, payload, readbackProfile }));
    recordResponse(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    if (command.endsWith(".set") || command === "marker.set" || command === "marker.remove") mutationStarted = true;
    return response;
  };
  const compMotionState = (response: AeMarkerMotionResponseV20): Record<string, unknown> | null => nested(nested(response.readback, "compMotion"), "state");
  const layerMotionState = (response: AeMarkerMotionResponseV20): Record<string, unknown> | null => nested(nested(response.readback, "layerMotion"), "state");
  const setCompMotion = async (stableId: string, desired: Readonly<Record<string, unknown>>): Promise<AeMarkerMotionResponseV20> => {
    if (hostRevision === null) throw new Error("Host revision unavailable before comp.motion.set.");
    const response = await dispatch("comp.motion.set", { comp: { stableId }, state: desired }, hostRevision);
    if ((response.outcome !== "APPLIED" && response.outcome !== "NO_OP") || !equal(compMotionState(response), desired)) throw new Error(`comp.motion.set failed to reach exact state: ${response.error?.code ?? response.outcome}`);
    await refresh();
    return response;
  };
  const setLayerMotion = async (compStable: string, layerStable: string, desired: Readonly<Record<string, unknown>>): Promise<AeMarkerMotionResponseV20> => {
    if (hostRevision === null) throw new Error("Host revision unavailable before layer.motion.set.");
    const response = await dispatch("layer.motion.set", { comp: { stableId: compStable }, layer: { stableId: layerStable }, state: desired }, hostRevision);
    const observed = layerMotionState(response);
    if ((response.outcome !== "APPLIED" && response.outcome !== "NO_OP") || observed?.["motionBlur"] !== desired["motionBlur"] || observed?.["frameBlendingType"] !== desired["frameBlendingType"]) throw new Error(`layer.motion.set failed to reach exact state: ${response.error?.code ?? response.outcome}`);
    await refresh();
    return response;
  };
  const renderComp = async (compStable: string, outputPath: string, duration: number): Promise<RenderCompletionFile> => {
    const scheduled = await executeV11("render.capture", { comp: { stableId: compStable }, outputPath, timeSpanStart: 0, timeSpanDuration: duration }, false);
    const readback = record(scheduled.readback);
    const jobId = readback?.["jobId"];
    const completionPath = readback?.["completionPath"];
    const canonicalOutputPath = readback?.["outputPath"];
    const requestedOutputPath = readback?.["requestedOutputPath"];
    if (typeof jobId !== "string" || typeof completionPath !== "string" || typeof canonicalOutputPath !== "string" || typeof requestedOutputPath !== "string") throw new Error("render.capture missing job/path readback.");
    if (!samePath(requestedOutputPath, outputPath)) throw new Error("render.capture requested path mismatch.");
    const relative = path.relative(artifactDir, canonicalOutputPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Render output escaped proof artifact directory.");
    const completion = await waitForRenderCompletion(completionPath, jobId, timeoutMs);
    if (!completion.ok || completion.status !== "DONE" || !completion.queueItemRemoved || !samePath(completion.outputPath, canonicalOutputPath) || !(await nonEmpty(completion.outputPath))) throw new Error(`Render job failed: ${completion.error ?? completion.status}`);
    await refresh();
    return completion;
  };
  const restoreBaseline = async (): Promise<void> => {
    if (!client || baselineFingerprint === null || baselineItemCount === null) return;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const current = await client.observe(projectId);
      state = current.observed;
      project = current.project;
      hostRevision = current.hostRevision;
      if (current.observed.projectFingerprint === baselineFingerprint && current.project.itemCount === baselineItemCount) return;
      const response = await client.undoLast({ transactionId, operationId: `${transactionId}_CLEANUP_UNDO_${attempt + 1}`, expectedState: current.observed });
      recordResponse(response);
      if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`Cleanup undo failed: ${response.error?.code ?? response.outcome}`);
    }
    throw new Error("Cleanup undo budget exhausted before baseline restoration.");
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await mkdir(sequenceDir, { recursive: true });
    await writeFile(movingSourcePath, createBmp24(72, 72, (x, y) => {
      const border = x < 4 || y < 4 || x >= 68 || y >= 68;
      if (border) return [255, 255, 255];
      return (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? [245, 75, 45] : [35, 220, 245];
    }));
    for (let frame = 0; frame < 12; frame += 1) {
      const centerX = 30 + frame * 23;
      const framePath = path.join(sequenceDir, `frame_${String(frame + 1).padStart(4, "0")}.bmp`);
      await writeFile(framePath, createBmp24(320, 180, (x, y) => {
        const grid = x % 40 <= 1 || y % 30 <= 1;
        const block = Math.abs(x - centerX) <= 20 && Math.abs(y - 90) <= 20;
        if (block) return [250, 245, 235];
        if (grid) return [50, 65, 80];
        return [15, 22, 30];
      }));
    }
    checks.fixture_motion_source_written = await nonEmpty(movingSourcePath);
    checks.fixture_sequence_written = await nonEmpty(path.join(sequenceDir, "frame_0001.bmp")) && await nonEmpty(path.join(sequenceDir, "frame_0012.bmp"));

    const config = parseConfig(JSON.parse(stripBom(await readFile(configPath, "utf8"))) as unknown);
    broker = new LoopbackCepBroker({ port: config.port, token: config.token, commandTimeoutMs: Math.min(timeoutMs, 30_000), commandLeaseMs: 2_000, expectedExtensionId: config.extensionId, supportedProtocolVersions: [AE_MARKER_MOTION_PROTOCOL_VERSION_V20, AE_ADAPTER_PROTOCOL_VERSION_V11] });
    if (await broker.start() !== config.port) throw new Error("CEP broker bound unexpected port.");
    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v20 = panel.protocolVersion === AE_MARKER_MOTION_PROTOCOL_VERSION_V20;
    checks.panel_supports_v11_v20 = panel.supportedProtocolVersions.includes(AE_MARKER_MOTION_PROTOCOL_VERSION_V20) && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v20 || !checks.panel_supports_v11_v20) throw new Error("Warm CEP panel did not negotiate protocol 2.0 with 1.1 compatibility.");

    client = new AeCepAdapterClientV11(broker, () => `m3-marker-motion-p34-setup-${++request}`, new AeFilesystemPolicyV11([artifactDir]));
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects";
    const baseline = await client.observe(projectId);
    state = baseline.observed;
    project = baseline.project;
    hostRevision = baseline.hostRevision;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;

    await executeV11("media.import", { path: movingSourcePath, stableId: movingSourceStable, sequence: false });
    await executeV11("comp.create", { stableId: motionCompStable, name: `${prefix} Motion Blur`, width: 640, height: 360, pixelAspect: 1, duration: 1, frameRate: 24 });
    await executeV11("layer.add_media", { stableId: motionLayerStable, comp: { stableId: motionCompStable }, item: { stableId: movingSourceStable } });
    await executeV11("property.set_keyframes", { comp: { stableId: motionCompStable }, layer: { stableId: motionLayerStable }, propertyPath: ["ADBE Transform Group", "ADBE Position"], keyframes: [{ time: 0, value: [72, 180] }, { time: 1, value: [568, 180] }] });

    const motionBaseline = { motionBlur: false, frameBlending: false, shutterAngle: 180, shutterPhase: -90, samplesPerFrame: 16, adaptiveSampleLimit: 128 };
    const motionContrast = { motionBlur: true, frameBlending: false, shutterAngle: 360, shutterPhase: -180, samplesPerFrame: 32, adaptiveSampleLimit: 128 };
    await setCompMotion(motionCompStable, motionBaseline);
    await setLayerMotion(motionCompStable, motionLayerStable, { motionBlur: false, frameBlendingType: "NO_FRAME_BLEND" });
    const baselineRender = await renderComp(motionCompStable, motionBaselinePath, 1);
    await setCompMotion(motionCompStable, motionContrast);
    await setLayerMotion(motionCompStable, motionLayerStable, { motionBlur: true, frameBlendingType: "NO_FRAME_BLEND" });
    const contrastRender = await renderComp(motionCompStable, motionContrastPath, 1);
    checks.p3_motion_baseline_artifact = await nonEmpty(baselineRender.outputPath);
    checks.p3_motion_contrast_artifact = await nonEmpty(contrastRender.outputPath);
    const motionRead = await dispatch("comp.motion.readback", { comp: { stableId: motionCompStable } }, null);
    checks.p3_motion_structural_exact = equal(compMotionState(motionRead), motionContrast);
    evidence.push({ kind: "motionBlurShutter", baseline: motionBaseline, contrast: motionContrast, baselineRender: baselineRender.outputPath, contrastRender: contrastRender.outputPath });

    const sequenceFirstPath = path.join(sequenceDir, "frame_0001.bmp");
    await executeV11("media.import", { path: sequenceFirstPath, stableId: sequenceStable, sequence: true });
    await executeV11("comp.create", { stableId: frameCompStable, name: `${prefix} Frame Blending`, width: 320, height: 180, pixelAspect: 1, duration: 1.2, frameRate: 24 });
    await executeV11("layer.add_media", { stableId: frameLayerStable, comp: { stableId: frameCompStable }, item: { stableId: sequenceStable } });
    await executeV11("layer.set_timing", { comp: { stableId: frameCompStable }, layer: { stableId: frameLayerStable }, timing: { startTime: 0, inPoint: 0, outPoint: 1.2, stretch: 400 } });
    const frameCompMotion = { motionBlur: false, frameBlending: true, shutterAngle: 180, shutterPhase: -90, samplesPerFrame: 16, adaptiveSampleLimit: 128 };
    await setCompMotion(frameCompStable, frameCompMotion);
    await setLayerMotion(frameCompStable, frameLayerStable, { motionBlur: false, frameBlendingType: "NO_FRAME_BLEND" });
    const noBlendRender = await renderComp(frameCompStable, frameOffPath, 1.2);
    await setLayerMotion(frameCompStable, frameLayerStable, { motionBlur: false, frameBlendingType: "FRAME_MIX" });
    const frameMixRender = await renderComp(frameCompStable, frameMixPath, 1.2);
    await setLayerMotion(frameCompStable, frameLayerStable, { motionBlur: false, frameBlendingType: "PIXEL_MOTION" });
    const pixelMotionRender = await renderComp(frameCompStable, pixelMotionPath, 1.2);
    const frameRead = await dispatch("layer.motion.readback", { comp: { stableId: frameCompStable }, layer: { stableId: frameLayerStable } }, null);
    checks.p3_frame_blending_structural_exact = layerMotionState(frameRead)?.["frameBlendingType"] === "PIXEL_MOTION" && layerMotionState(frameRead)?.["frameBlending"] === true;
    checks.p3_frame_off_artifact = await nonEmpty(noBlendRender.outputPath);
    checks.p3_frame_mix_artifact = await nonEmpty(frameMixRender.outputPath);
    checks.p3_pixel_motion_artifact = await nonEmpty(pixelMotionRender.outputPath);
    evidence.push({ kind: "frameBlending", source: sequenceFirstPath, stretch: 400, offRender: noBlendRender.outputPath, frameMixRender: frameMixRender.outputPath, pixelMotionRender: pixelMotionRender.outputPath });

    const markerTarget = { kind: "COMP", comp: { stableId: motionCompStable } };
    const marker = { comment: "P3 motion blur / shutter contrast", chapter: "Visual proof", duration: 0.1, eventCuePoint: true, label: 9, protectedRegion: false, parameters: { proof: "M3_MARKER_MOTION_P3" } };
    if (hostRevision === null) throw new Error("Host revision unavailable before marker proof.");
    const markerSet = await dispatch("marker.set", { target: markerTarget, time: 0.5, marker }, hostRevision);
    const markerRead = await dispatch("marker.readback", { target: markerTarget }, null);
    const markers = record(markerRead.readback)?.["markers"] as unknown[] | undefined;
    checks.p3_marker_structural_evidence = markerSet.outcome === "APPLIED" && Array.isArray(markers) && markers.length === 1;
    evidence.push({ kind: "marker", observed: markers?.[0] ?? null });

    checks.p3 = checks.p3_motion_baseline_artifact === true && checks.p3_motion_contrast_artifact === true && checks.p3_motion_structural_exact === true && checks.p3_frame_blending_structural_exact === true && checks.p3_frame_off_artifact === true && checks.p3_frame_mix_artifact === true && checks.p3_pixel_motion_artifact === true && checks.p3_marker_structural_evidence === true;

    await setCompMotion(motionCompStable, motionBaseline);
    const beforeFailure = await client.observe(projectId);
    state = beforeFailure.observed;
    project = beforeFailure.project;
    hostRevision = beforeFailure.hostRevision;
    const beforeRead = await dispatch("comp.motion.readback", { comp: { stableId: motionCompStable } }, null);
    checks.p4_baseline_exact = equal(compMotionState(beforeRead), motionBaseline);
    if (hostRevision === null) throw new Error("Host revision unavailable before P4 injection.");
    const induced = await dispatch("comp.motion.set", { comp: { stableId: motionCompStable }, state: motionContrast }, hostRevision, "M3_MARKER_MOTION_P4_FAILURE_INJECTION");
    checks.p4_induced_failure_reported = induced.outcome === "FAILED" && induced.error?.category === "PROOF_INJECTION" && induced.error?.code === "M3_MARKER_MOTION_P4_INDUCED_FAILURE";
    checks.p4_rollback_note = induced.diagnostics.notes.includes("Composition motion mutation failed after a verified write and the exact prior motion/shutter state was restored by structural rollback.");
    checks.p4_response_readback_restored = equal(compMotionState(induced), motionBaseline);
    const afterFailure = await client.observe(projectId);
    state = afterFailure.observed;
    project = afterFailure.project;
    hostRevision = afterFailure.hostRevision;
    checks.p4_fingerprint_restored = afterFailure.observed.projectFingerprint === beforeFailure.observed.projectFingerprint;
    checks.p4_item_count_unchanged = afterFailure.project.itemCount === beforeFailure.project.itemCount;
    const afterRead = await dispatch("comp.motion.readback", { comp: { stableId: motionCompStable } }, null);
    checks.p4_structural_state_restored = equal(compMotionState(afterRead), motionBaseline);
    const recoveryRender = await renderComp(motionCompStable, postRollbackPath, 1);
    checks.p4_recovery_visual_artifact = await nonEmpty(recoveryRender.outputPath);
    checks.p4 = checks.p4_baseline_exact === true && checks.p4_induced_failure_reported === true && checks.p4_rollback_note === true && checks.p4_response_readback_restored === true && checks.p4_fingerprint_restored === true && checks.p4_item_count_unchanged === true && checks.p4_structural_state_restored === true && checks.p4_recovery_visual_artifact === true;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    if (client) {
      try {
        await restoreBaseline();
        const finalState = await client.observe(projectId);
        checks.cleanup_temp_items_absent = ![...temporaryStableIds].some((stableId) => finalState.project.items.some((item) => item.stableId === stableId));
        checks.cleanup_item_count_restored = baselineItemCount !== null && finalState.project.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint !== null && finalState.observed.projectFingerprint === baselineFingerprint;
        cleanupComplete = checks.cleanup_temp_items_absent === true && checks.cleanup_item_count_restored === true && checks.cleanup_fingerprint_restored === true;
      } catch (error) { cleanupErrors.push(error instanceof Error ? error.message : String(error)); }
    }
    if (broker) { try { await broker.stop(); } catch (error) { cleanupErrors.push(`broker-stop: ${error instanceof Error ? error.message : String(error)}`); } }

    const ok = failureError === null && cleanupErrors.length === 0 && cleanupComplete && checks.p3 === true && checks.p4 === true;
    const classification = ok ? "PASS" : mutationStarted ? "PRODUCT_FAILURE" : "INFRASTRUCTURE_FAILURE";
    await writeJson(resultPath, {
      proofId: "M3_MARKER_MOTION_P3_P4_REAL_AE",
      status: ok ? "PASS" : "FAILURE",
      classification,
      ok,
      message: ok ? "Marker/motion P3/P4 proof passed with warm-process AE reuse." : (failureError ?? (cleanupErrors.length > 0 ? cleanupErrors.join("; ") : "Marker/motion P3/P4 proof failed.")),
      startedAt,
      completedAt: new Date().toISOString(),
      mutationStarted,
      cleanupComplete,
      proofLevels: { P1_validation_rejection: true, P2_structural_readback: true, P3_visual_proof: checks.p3 === true, P4_failure_injection_rollback: checks.p4 === true, P5_save_reopen_reconnect_transfer: false },
      panel,
      environment,
      fixture: { movingSourceStable, motionCompStable, motionLayerStable, sequenceStable, frameCompStable, frameLayerStable },
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
