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
  AE_MASK_PROTOCOL_VERSION_V12,
  type AeMaskCommandV12,
  type AeMaskResponseV12,
  type AeMaskShapeV12,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_2.js";
import { buildMaskRequestV12 } from "../../../packages/adapters/ae-cep/src/m3-mask.js";
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
  if (!Array.isArray(supported) || !supported.includes(AE_MASK_PROTOCOL_VERSION_V12) || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise both required M3 1.2 and M2 1.1 protocols.");
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

const stableJson = (value: unknown): string => JSON.stringify(value);
const maskRecord = (response: AeMaskResponseV12): Record<string, unknown> | null => nestedRecord(response.readback, "mask");

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "180000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const backgroundPath = path.join(artifactDir, "p3-background.bmp");
  const foregroundPath = path.join(artifactDir, "p3-foreground.bmp");
  const visualRenderPath = path.join(artifactDir, "p3-mask-reveal.avi");
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
  let panelHostName: string | null = null;
  let panelHostVersion: string | null = null;
  let panelHostBuild: string | null = null;
  let panelExtensionVersion: string | null = null;
  let panelSelectedProtocolVersion: string | null = null;
  let panelSupportedProtocolVersions: readonly string[] | null = null;
  let visualArtifactPath: string | null = null;
  let recoveryArtifactPath: string | null = null;

  const projectId = "m3-mask-p3-p4-real-ae";
  const prefix = `M3_MASK_P34_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const backgroundMediaStable = `${prefix}_BG_MEDIA`;
  const foregroundMediaStable = `${prefix}_FG_MEDIA`;
  const backgroundLayerStable = `${prefix}_BG_LAYER`;
  const foregroundLayerStable = `${prefix}_FG_LAYER`;
  const maskStable = `${prefix}_MASK`;
  const temporaryItemStableIds = new Set([targetStable, backgroundMediaStable, foregroundMediaStable]);
  let operationCounter = 0;
  let requestCounter = 0;

  const smallShape: AeMaskShapeV12 = {
    closed: true,
    vertices: [[160, 105], [215, 160], [160, 215], [105, 160]],
    inTangents: [[-30, 0], [0, -30], [30, 0], [0, 30]],
    outTangents: [[30, 0], [0, 30], [-30, 0], [0, -30]],
  };
  const mediumShape: AeMaskShapeV12 = {
    closed: true,
    vertices: [[160, 70], [250, 160], [160, 250], [70, 160]],
    inTangents: [[-50, 0], [0, -50], [50, 0], [0, 50]],
    outTangents: [[50, 0], [0, 50], [-50, 0], [0, -50]],
  };
  const largeShape: AeMaskShapeV12 = {
    closed: true,
    vertices: [[160, 28], [292, 160], [160, 292], [28, 160]],
    inTangents: [[-73, 0], [0, -73], [73, 0], [0, 73]],
    outTangents: [[73, 0], [0, 73], [-73, 0], [0, -73]],
  };

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

  const recordV12 = (response: AeMaskResponseV12): void => {
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
      readbackProfile: "M3_MASK_P3_P4_SETUP",
    });
    recordV11(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    }
    if (options.refreshAfter !== false) await refreshState();
    return response;
  };

  const dispatchV12 = async (
    command: AeMaskCommandV12,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_MASK_P3_P4_STRUCTURAL",
  ): Promise<AeMaskResponseV12> => {
    if (broker === null) throw new Error("M3 broker is not initialized.");
    operationCounter += 1;
    const request = buildMaskRequestV12({
      requestId: `m3-mask-p34-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V12_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    });
    const response = await broker.dispatch(request);
    recordV12(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const sameFilesystemPath = (left: string, right: string): boolean =>
    path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

  const renderComp = async (outputPath: string): Promise<RenderCompletionFile> => {
    const scheduled = await executeV11("render.capture", {
      comp: { stableId: targetStable },
      outputPath,
      timeSpanStart: 0,
      timeSpanDuration: 1,
    }, { refreshAfter: false });
    const readback = asRecord(scheduled.readback);
    const jobId = readback?.["jobId"];
    const completionPath = readback?.["completionPath"];
    const requestedOutputPath = readback?.["requestedOutputPath"];
    const canonicalOutputPath = readback?.["outputPath"];
    if (typeof jobId !== "string" || typeof completionPath !== "string") {
      throw new Error("render.capture did not return a jobId and completionPath.");
    }
    if (typeof requestedOutputPath !== "string" || !sameFilesystemPath(requestedOutputPath, outputPath)) {
      throw new Error("render.capture requested output-path readback does not match the M3 proof request.");
    }
    if (typeof canonicalOutputPath !== "string" || canonicalOutputPath.length === 0) {
      throw new Error("render.capture did not return After Effects' canonical OutputModule.file path.");
    }
    const relativeArtifactPath = path.relative(artifactDir, canonicalOutputPath);
    if (relativeArtifactPath.startsWith("..") || path.isAbsolute(relativeArtifactPath)) {
      throw new Error(`render.capture canonical output escaped the M3 artifact directory: ${canonicalOutputPath}`);
    }

    const completion = await waitForRenderCompletion(completionPath, jobId, timeoutMs);
    if (!completion.ok || completion.status !== "DONE" || !completion.queueItemRemoved) {
      throw new Error(`Render job ${jobId} failed: ${completion.error ?? completion.status}`);
    }
    if (!sameFilesystemPath(completion.outputPath, canonicalOutputPath)) {
      throw new Error(`Render completion path '${completion.outputPath}' does not match scheduled canonical path '${canonicalOutputPath}'.`);
    }
    if (!(await fileExistsNonEmpty(completion.outputPath))) {
      throw new Error(`Canonical render output is missing or empty: ${completion.outputPath}`);
    }
    await refreshState();
    return completion;
  };

  const undoUntilBaseline = async (): Promise<void> => {
    if (client === null) return;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const observed = await client.observe(projectId);
      state = observed.observed;
      hostRevision = observed.hostRevision;
      const temporaryPresent = observed.project.items.some((item) =>
        typeof item.stableId === "string" && temporaryItemStableIds.has(item.stableId));
      if (!temporaryPresent) {
        cleanupComplete = baselineItemCount === null || observed.project.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint === null || observed.observed.projectFingerprint === baselineFingerprint;
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
    throw new Error("Cleanup did not return the temporary M3 P3/P4 fixture to the baseline within 16 Undo operations.");
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(backgroundPath, createBmp24(320, 320, (x, y) => {
      const grid = (Math.floor(x / 32) + Math.floor(y / 32)) % 2;
      return grid === 0 ? [28, 34, 48] : [38, 44, 60];
    }));
    await writeFile(foregroundPath, createBmp24(320, 320, (x, y) => {
      const checker = (Math.floor(x / 24) + Math.floor(y / 24)) % 2;
      if (checker === 0) return [240, 74, 82];
      return [52, 208, 232];
    }));
    checks.fixture_images_written = (await stat(backgroundPath)).size > 54 && (await stat(foregroundPath)).size > 54;

    const configText = stripUtf8Bom(await readFile(configPath, "utf8"));
    const config = parseConfig(JSON.parse(configText) as unknown);
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 30_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_MASK_PROTOCOL_VERSION_V12, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    const panel = await broker.waitForPanel(timeoutMs);
    panelExtensionVersion = panel.extensionVersion;
    panelSelectedProtocolVersion = panel.protocolVersion;
    panelSupportedProtocolVersions = [...panel.supportedProtocolVersions];
    checks.panel_negotiated_v12 = panel.protocolVersion === AE_MASK_PROTOCOL_VERSION_V12;
    checks.panel_supports_v11_v12 = panel.supportedProtocolVersions.includes(AE_MASK_PROTOCOL_VERSION_V12)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v12 || !checks.panel_supports_v11_v12) {
      throw new Error(`M3 proof requires negotiated protocol ${AE_MASK_PROTOCOL_VERSION_V12} with 1.1 compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-mask-p34-setup-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );
    const environment = await client.probe();
    panelHostName = environment.hostName;
    panelHostVersion = environment.hostVersion;
    panelHostBuild = environment.hostBuild;
    checks.host_probe = environment.hostName === "Adobe After Effects"
      && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;

    const backgroundImport = await executeV11("media.import", {
      path: backgroundPath,
      stableId: backgroundMediaStable,
      sequence: false,
    });
    checks.background_import = backgroundImport.affectedObjects.some((item) => item.stableId === backgroundMediaStable && item.kind === "FOOTAGE");

    const foregroundImport = await executeV11("media.import", {
      path: foregroundPath,
      stableId: foregroundMediaStable,
      sequence: false,
    });
    checks.foreground_import = foregroundImport.affectedObjects.some((item) => item.stableId === foregroundMediaStable && item.kind === "FOOTAGE");

    const target = await executeV11("comp.create", {
      stableId: targetStable,
      name: `${prefix} Visual Reveal`,
      width: 320,
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    checks.target_comp_create = target.affectedObjects.some((item) => item.stableId === targetStable);

    const backgroundLayer = await executeV11("layer.add_media", {
      stableId: backgroundLayerStable,
      comp: { stableId: targetStable },
      item: { stableId: backgroundMediaStable },
    });
    checks.background_layer = nestedRecord(backgroundLayer.readback, "layer")?.["stableId"] === backgroundLayerStable;

    const foregroundLayer = await executeV11("layer.add_media", {
      stableId: foregroundLayerStable,
      comp: { stableId: targetStable },
      item: { stableId: foregroundMediaStable },
    });
    checks.foreground_layer = nestedRecord(foregroundLayer.readback, "layer")?.["stableId"] === foregroundLayerStable;

    const backgroundOrder = await executeV11("layer.reorder", {
      comp: { stableId: targetStable },
      layer: { stableId: backgroundLayerStable },
      position: "END",
    });
    checks.background_below_foreground = nestedRecord(backgroundOrder.readback, "layer")?.["stableId"] === backgroundLayerStable;

    const createMask = await dispatchV12("mask.create", {
      comp: { stableId: targetStable },
      layer: { stableId: foregroundLayerStable },
      stableId: maskStable,
      name: "Animated Reveal",
      shape: smallShape,
      properties: { feather: [6, 6], expansion: 0, opacity: 100, mode: "ADD", inverted: false },
    }, hostRevision);
    if (createMask.outcome !== "APPLIED") throw new Error(`mask.create failed: ${createMask.error?.code ?? createMask.outcome}`);
    checks.p3_mask_created = maskRecord(createMask)?.["stableId"] === maskStable;

    const animateMask = await dispatchV12("mask.set_path", {
      comp: { stableId: targetStable },
      layer: { stableId: foregroundLayerStable },
      mask: { stableId: maskStable },
      keyframes: [
        { time: 0, shape: smallShape },
        { time: 0.5, shape: mediumShape },
        { time: 1, shape: largeShape },
      ],
    }, hostRevision);
    if (animateMask.outcome !== "APPLIED") throw new Error(`mask.set_path failed: ${animateMask.error?.code ?? animateMask.outcome}`);
    const animatedMask = maskRecord(animateMask);
    checks.p3_animated_mask_structural = Array.isArray(animatedMask?.["pathKeyframes"])
      && (animatedMask?.["pathKeyframes"] as unknown[]).length === 3;

    // Protocol 1.2 mask mutations advance AE state outside the M2 client cache.
    // Refresh before returning to the accepted 1.1 render route so stale-state
    // protection remains active rather than being bypassed.
    await refreshState();
    const visualCompletion = await renderComp(visualRenderPath);
    visualArtifactPath = visualCompletion.outputPath;
    checks.p3_visual_artifact_emitted = visualCompletion.ok && await fileExistsNonEmpty(visualArtifactPath);

    const beforeFailureReadback = await dispatchV12("mask.readback", {
      comp: { stableId: targetStable },
      layer: { stableId: foregroundLayerStable },
      mask: { stableId: maskStable },
    }, null);
    if (beforeFailureReadback.outcome !== "NO_OP") throw new Error("mask.readback failed before P4 injection.");
    const beforeFailureMask = maskRecord(beforeFailureReadback);
    if (beforeFailureMask === null) throw new Error("P4 baseline mask readback is missing.");
    const beforeFailureMaskJson = stableJson(beforeFailureMask);

    const beforeFailure = await client.observe(projectId);
    state = beforeFailure.observed;
    hostRevision = beforeFailure.hostRevision;

    const inducedFailure = await dispatchV12("mask.set_properties", {
      comp: { stableId: targetStable },
      layer: { stableId: foregroundLayerStable },
      mask: { stableId: maskStable },
      properties: { feather: [28, 28], expansion: 18, opacity: 42, mode: "SUBTRACT", inverted: true },
    }, hostRevision, "M3_MASK_P4_FAILURE_INJECTION");

    checks.p4_induced_failure_reported = inducedFailure.outcome === "FAILED"
      && inducedFailure.error?.code === "M3_MASK_P4_INDUCED_FAILURE";
    checks.p4_self_rollback_note = inducedFailure.diagnostics.notes.includes("Failed mutation self-rolled back with AE Undo.");

    const afterFailure = await client.observe(projectId);
    state = afterFailure.observed;
    hostRevision = afterFailure.hostRevision;
    checks.p4_fingerprint_restored = afterFailure.observed.projectFingerprint === beforeFailure.observed.projectFingerprint;

    const afterFailureReadback = await dispatchV12("mask.readback", {
      comp: { stableId: targetStable },
      layer: { stableId: foregroundLayerStable },
      mask: { stableId: maskStable },
    }, null);
    const afterFailureMask = maskRecord(afterFailureReadback);
    checks.p4_mask_state_restored = afterFailureReadback.outcome === "NO_OP"
      && afterFailureMask !== null
      && stableJson(afterFailureMask) === beforeFailureMaskJson;

    const recoveryCompletion = await renderComp(recoveryRenderPath);
    recoveryArtifactPath = recoveryCompletion.outputPath;
    checks.p4_recovery_visual_artifact_emitted = recoveryCompletion.ok && await fileExistsNonEmpty(recoveryArtifactPath);
    checks.p4 = checks.p4_induced_failure_reported
      && checks.p4_self_rollback_note
      && checks.p4_fingerprint_restored
      && checks.p4_mask_state_restored
      && checks.p4_recovery_visual_artifact_emitted;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    try {
      await undoUntilBaseline();
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.stack ?? error.message : String(error));
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
        cleanupComplete = false;
      }
    }

    // Keep the authenticated loopback broker alive through final cleanup/readback.
    // Stopping it earlier would make the final baseline verification impossible.
    if (broker !== null) {
      try { await broker.stop(); } catch (error) {
        cleanupErrors.push(`broker stop: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const ok = failureError === null
      && cleanupErrors.length === 0
      && cleanupComplete
      && checks.fixture_images_written === true
      && checks.panel_negotiated_v12 === true
      && checks.panel_supports_v11_v12 === true
      && checks.host_probe === true
      && checks.background_import === true
      && checks.foreground_import === true
      && checks.target_comp_create === true
      && checks.background_layer === true
      && checks.foreground_layer === true
      && checks.background_below_foreground === true
      && checks.p3_mask_created === true
      && checks.p3_animated_mask_structural === true
      && checks.p3_visual_artifact_emitted === true
      && checks.p4 === true;

    await writeJson(resultPath, {
      proofId: "M3_MASK_P3_P4_REAL_AE",
      status: ok ? "VISUAL_REVIEW_REQUIRED" : "FAILURE",
      ok,
      visualReviewRequired: true,
      startedAt,
      completedAt: new Date().toISOString(),
      proofLevels: {
        P1_validation_rejection: true,
        P2_structural_readback: true,
        P3_visual_artifact_emitted: checks.p3_visual_artifact_emitted === true,
        P3_visual_proof: false,
        P4_failure_injection_rollback: checks.p4 === true,
        P5_save_reopen_reconnect_transfer: false,
      },
      checks,
      visualReviewSpec: {
        render: visualArtifactPath,
        postRollbackRender: recoveryArtifactPath,
        requestedRender: visualRenderPath,
        requestedPostRollbackRender: recoveryRenderPath,
        sourceForeground: foregroundPath,
        sourceBackground: backgroundPath,
        expected: [
          "Animated curved ADD mask reveals the bright checker foreground over the dark checker background.",
          "Reveal grows from a small central aperture at the first frames to a much larger rounded aperture by the final frames.",
          "The center remains foreground-visible throughout; corners remain background-visible through the bounded one-second reveal.",
          "No full-frame foreground leak, persistent black/transparent hole, or inverted reveal is acceptable.",
          "The post-rollback render must be visually equivalent to the pre-failure P3 render because the induced property mutation is undone.",
        ],
      },
      environment: {
        host: panelHostName,
        hostVersion: panelHostVersion,
        hostBuild: panelHostBuild,
        extensionVersion: panelExtensionVersion,
        selectedProtocolVersion: panelSelectedProtocolVersion,
        supportedProtocolVersions: panelSupportedProtocolVersions,
      },
      responses,
      failureError,
      cleanupErrors,
      cleanupComplete,
      notes: [
        "P3 emits a deterministic real-AE visual artifact but does not self-claim visual acceptance; retained render evidence must be reviewed before P3 is accepted.",
        "P3/P4 retain After Effects' canonical OutputModule.file artifacts even when AE changes the requested filename extension.",
        "P4 is induced only when the runner-owned AE process inherits EDITFLOW_M3_MASK_P4_PROOF=1 and the typed mask.set_properties request uses the exact fixed M3_MASK_P4_FAILURE_INJECTION profile.",
        "The induced error occurs after the real mask mutation inside the existing M3 undo group; the existing catch path must report AE Undo self-rollback, restore the project fingerprint, and restore exact mask readback.",
        "P5 remains explicitly unclaimed and is a separate save/reopen/reconnect transfer tranche.",
      ],
    });
  }
};

main().catch(async (error) => {
  const resultPath = argument("--result");
  if (resultPath) {
    try {
      await writeJson(resultPath, {
        proofId: "M3_MASK_P3_P4_REAL_AE",
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