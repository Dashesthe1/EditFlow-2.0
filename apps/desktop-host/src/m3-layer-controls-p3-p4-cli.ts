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
  AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16,
  type AeLayerControlsCommandV16,
  type AeLayerControlsResponseV16,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_6.js";
import { buildLayerControlsRequestV16 } from "../../../packages/adapters/ae-cep/src/m3-layer-controls.js";
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
  if (!Array.isArray(supported)
      || !supported.includes(AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise required layer-controls 1.6 and baseline 1.1 protocols.");
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

const controlsRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null =>
  nestedRecord(response.readback, "layerControls");

const switchValues = (response: AeLayerControlsResponseV16): Record<string, unknown> | null => {
  const controls = controlsRecord(response);
  const switches = controls === null ? null : asRecord(controls["switches"]);
  return switches === null ? null : asRecord(switches["values"]);
};

const orderRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null => {
  const controls = controlsRecord(response);
  return controls === null ? null : asRecord(controls["order"]);
};

const layerStableId = (value: unknown): string | null => {
  const record = asRecord(value);
  return record !== null && typeof record["stableId"] === "string" ? record["stableId"] : null;
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
  rgb: readonly [number, number, number],
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
      const offset = rowOffset + x * 3;
      buffer[offset] = rgb[2];
      buffer[offset + 1] = rgb[1];
      buffer[offset + 2] = rgb[0];
    }
  }
  return buffer;
};

const stableJson = (value: unknown): string => JSON.stringify(value);

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "180000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const backgroundPath = path.join(artifactDir, "p3-background-blue.bmp");
  const foregroundPath = path.join(artifactDir, "p3-foreground-red.bmp");
  const switchDisabledRenderPath = path.join(artifactDir, "p3-switch-disabled-blue.avi");
  const switchEnabledRenderPath = path.join(artifactDir, "p3-switch-enabled-red.avi");
  const orderBottomRenderPath = path.join(artifactDir, "p3-order-bottom-blue.avi");
  const orderTopRenderPath = path.join(artifactDir, "p3-order-top-red.avi");
  const recoveryRenderPath = path.join(artifactDir, "p4-post-rollback-red.avi");

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
  let switchDisabledArtifact: string | null = null;
  let switchEnabledArtifact: string | null = null;
  let orderBottomArtifact: string | null = null;
  let orderTopArtifact: string | null = null;
  let recoveryArtifact: string | null = null;

  const projectId = "m3-layer-controls-p3-p4-real-ae";
  const prefix = `M3_LAYER_CONTROLS_P34_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const targetCompStable = `${prefix}_TARGET_COMP`;
  const backgroundMediaStable = `${prefix}_BG_MEDIA`;
  const foregroundMediaStable = `${prefix}_FG_MEDIA`;
  const backgroundLayerStable = `${prefix}_BG_LAYER`;
  const foregroundLayerStable = `${prefix}_FG_LAYER`;
  const temporaryItemStableIds = new Set([
    targetCompStable,
    backgroundMediaStable,
    foregroundMediaStable,
  ]);
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

  const recordV16 = (response: AeLayerControlsResponseV16): void => {
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
      readbackProfile: "M3_LAYER_CONTROLS_P3_P4_SETUP",
    });
    recordV11(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    }
    if (options.refreshAfter !== false) await refreshState();
    return response;
  };

  const dispatchV16 = async (
    command: AeLayerControlsCommandV16,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_LAYER_CONTROLS_P3_P4_STRUCTURAL",
  ): Promise<AeLayerControlsResponseV16> => {
    if (broker === null) throw new Error("M3 layer-controls broker is not initialized.");
    operationCounter += 1;
    const request = buildLayerControlsRequestV16({
      requestId: `m3-layer-controls-p34-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V16_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    });
    const response = await broker.dispatch(request);
    recordV16(response);
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
      throw new Error("render.capture requested output-path readback does not match the M3 layer-controls proof request.");
    }
    if (typeof canonicalOutputPath !== "string" || canonicalOutputPath.length === 0) {
      throw new Error("render.capture did not return After Effects' canonical OutputModule.file path.");
    }
    const relativeArtifactPath = path.relative(artifactDir, canonicalOutputPath);
    if (relativeArtifactPath.startsWith("..") || path.isAbsolute(relativeArtifactPath)) {
      throw new Error(`render.capture canonical output escaped the M3 layer-controls artifact directory: ${canonicalOutputPath}`);
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
    for (let attempt = 0; attempt < 20; attempt += 1) {
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
    throw new Error("Cleanup did not return the temporary M3 layer-controls P3/P4 fixture to baseline within 20 Undo operations.");
  };

  try {
    await mkdir(artifactDir, { recursive: true });

    const backgroundRgb = [32, 64, 220] as const;
    const foregroundRgb = [220, 32, 32] as const;
    await writeFile(backgroundPath, createBmp24(320, 320, backgroundRgb));
    await writeFile(foregroundPath, createBmp24(320, 320, foregroundRgb));
    checks.fixture_images_written = (await stat(backgroundPath)).size > 54
      && (await stat(foregroundPath)).size > 54;

    const configText = stripUtf8Bom(await readFile(configPath, "utf8"));
    const config = parseConfig(JSON.parse(configText) as unknown);
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 30_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    const panel = await broker.waitForPanel(timeoutMs);
    panelExtensionVersion = panel.extensionVersion;
    panelSelectedProtocolVersion = panel.protocolVersion;
    panelSupportedProtocolVersions = [...panel.supportedProtocolVersions];
    checks.panel_negotiated_v16 = panel.protocolVersion === AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16;
    checks.panel_supports_v11_v16 = panel.supportedProtocolVersions.includes(AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v16 || !checks.panel_supports_v11_v16) {
      throw new Error(`M3 layer-controls P3/P4 proof requires negotiated protocol ${AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16} with 1.1 compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-layer-controls-p34-setup-${++requestCounter}`,
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
      stableId: targetCompStable,
      name: `${prefix} Layer Controls Visual Proof`,
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
      item: { stableId: backgroundMediaStable },
    });
    checks.background_layer = nestedRecord(backgroundLayer.readback, "layer")?.["stableId"] === backgroundLayerStable;

    const foregroundLayer = await executeV11("layer.add_media", {
      stableId: foregroundLayerStable,
      comp: { stableId: targetCompStable },
      item: { stableId: foregroundMediaStable },
    });
    checks.foreground_layer = nestedRecord(foregroundLayer.readback, "layer")?.["stableId"] === foregroundLayerStable;

    const initialRead = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: foregroundLayerStable },
    }, null);
    const initialOrder = orderRecord(initialRead);
    checks.p3_initial_top_enabled = initialRead.outcome === "NO_OP"
      && switchValues(initialRead)?.["enabled"] === true
      && initialOrder?.["index"] === 1
      && layerStableId(initialOrder?.["nextLayer"]) === backgroundLayerStable;

    const disableForeground = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: foregroundLayerStable },
      switches: { enabled: false },
    }, hostRevision);
    checks.p3_switch_disable_structural = disableForeground.outcome === "APPLIED"
      && switchValues(disableForeground)?.["enabled"] === false;
    const switchDisabledCompletion = await renderComp(switchDisabledRenderPath);
    switchDisabledArtifact = switchDisabledCompletion.outputPath;
    checks.p3_switch_disabled_visual_artifact = await fileExistsNonEmpty(switchDisabledArtifact);

    const enableForeground = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: foregroundLayerStable },
      switches: { enabled: true },
    }, hostRevision);
    checks.p3_switch_enable_structural = enableForeground.outcome === "APPLIED"
      && switchValues(enableForeground)?.["enabled"] === true;
    const switchEnabledCompletion = await renderComp(switchEnabledRenderPath);
    switchEnabledArtifact = switchEnabledCompletion.outputPath;
    checks.p3_switch_enabled_visual_artifact = await fileExistsNonEmpty(switchEnabledArtifact);

    const moveForegroundBottom = await dispatchV16("layer.order.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: foregroundLayerStable },
      placement: { kind: "END" },
    }, hostRevision);
    const bottomOrder = orderRecord(moveForegroundBottom);
    checks.p3_order_bottom_structural = moveForegroundBottom.outcome === "APPLIED"
      && bottomOrder?.["index"] === 2
      && layerStableId(bottomOrder?.["previousLayer"]) === backgroundLayerStable;
    const orderBottomCompletion = await renderComp(orderBottomRenderPath);
    orderBottomArtifact = orderBottomCompletion.outputPath;
    checks.p3_order_bottom_visual_artifact = await fileExistsNonEmpty(orderBottomArtifact);

    const moveForegroundTop = await dispatchV16("layer.order.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: foregroundLayerStable },
      placement: { kind: "BEGINNING" },
    }, hostRevision);
    const topOrder = orderRecord(moveForegroundTop);
    checks.p3_order_top_structural = moveForegroundTop.outcome === "APPLIED"
      && topOrder?.["index"] === 1
      && layerStableId(topOrder?.["nextLayer"]) === backgroundLayerStable;
    const orderTopCompletion = await renderComp(orderTopRenderPath);
    orderTopArtifact = orderTopCompletion.outputPath;
    checks.p3_order_top_visual_artifact = await fileExistsNonEmpty(orderTopArtifact);

    checks.p3_visual_artifacts_emitted = checks.p3_switch_disabled_visual_artifact === true
      && checks.p3_switch_enabled_visual_artifact === true
      && checks.p3_order_bottom_visual_artifact === true
      && checks.p3_order_top_visual_artifact === true;

    const beforeFailureReadback = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: foregroundLayerStable },
    }, null);
    if (beforeFailureReadback.outcome !== "NO_OP") throw new Error("Layer-controls readback failed before P4 injection.");
    const beforeFailureControls = controlsRecord(beforeFailureReadback);
    if (beforeFailureControls === null) throw new Error("P4 baseline layer-controls readback is missing.");
    const beforeFailureControlsJson = stableJson(beforeFailureControls);

    const beforeFailure = await client.observe(projectId);
    state = beforeFailure.observed;
    hostRevision = beforeFailure.hostRevision;

    const inducedFailure = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: foregroundLayerStable },
      switches: { enabled: false },
    }, hostRevision, "M3_LAYER_CONTROLS_P4_FAILURE_INJECTION");

    checks.p4_induced_failure_reported = inducedFailure.outcome === "FAILED"
      && inducedFailure.error?.code === "M3_LAYER_CONTROLS_P4_INDUCED_FAILURE";
    checks.p4_self_rollback_note = inducedFailure.diagnostics.notes.includes(
      "Layer-controls mutation failed and was rolled back through the transaction undo boundary.",
    );
    checks.p4_response_readback_restored = switchValues(inducedFailure)?.["enabled"] === true
      && orderRecord(inducedFailure)?.["index"] === 1;

    const afterFailure = await client.observe(projectId);
    state = afterFailure.observed;
    hostRevision = afterFailure.hostRevision;
    checks.p4_fingerprint_restored = afterFailure.observed.projectFingerprint === beforeFailure.observed.projectFingerprint;

    const afterFailureReadback = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: foregroundLayerStable },
    }, null);
    const afterFailureControls = controlsRecord(afterFailureReadback);
    checks.p4_layer_controls_state_restored = afterFailureReadback.outcome === "NO_OP"
      && afterFailureControls !== null
      && stableJson(afterFailureControls) === beforeFailureControlsJson;

    const recoveryCompletion = await renderComp(recoveryRenderPath);
    recoveryArtifact = recoveryCompletion.outputPath;
    checks.p4_recovery_visual_artifact_emitted = await fileExistsNonEmpty(recoveryArtifact);
    checks.p4 = checks.p4_induced_failure_reported === true
      && checks.p4_self_rollback_note === true
      && checks.p4_response_readback_restored === true
      && checks.p4_fingerprint_restored === true
      && checks.p4_layer_controls_state_restored === true
      && checks.p4_recovery_visual_artifact_emitted === true;
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

    if (broker !== null) {
      try { await broker.stop(); } catch (error) {
        cleanupErrors.push(`broker stop: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const ok = failureError === null
      && cleanupErrors.length === 0
      && cleanupComplete
      && checks.fixture_images_written === true
      && checks.panel_negotiated_v16 === true
      && checks.panel_supports_v11_v16 === true
      && checks.host_probe === true
      && checks.background_import === true
      && checks.foreground_import === true
      && checks.target_comp_create === true
      && checks.background_layer === true
      && checks.foreground_layer === true
      && checks.p3_initial_top_enabled === true
      && checks.p3_switch_disable_structural === true
      && checks.p3_switch_enable_structural === true
      && checks.p3_order_bottom_structural === true
      && checks.p3_order_top_structural === true
      && checks.p3_visual_artifacts_emitted === true
      && checks.p4 === true;

    await writeJson(resultPath, {
      proofId: "M3_LAYER_CONTROLS_P3_P4_REAL_AE",
      status: ok ? "VISUAL_REVIEW_REQUIRED" : "FAILURE",
      ok,
      visualReviewRequired: true,
      startedAt,
      completedAt: new Date().toISOString(),
      acceptedBaseline: {
        P1_P2_main_commit: "fc6c7954e2bd8f8e166d9b0387408142b628afc6",
        P1_P2_run: 34156910741,
        P1_P2_attempt: 1,
        P1_P2_artifact: 10031293005,
      },
      proofLevels: {
        P1_validation_rejection: true,
        P2_structural_readback: true,
        P3_visual_artifact_emitted: checks.p3_visual_artifacts_emitted === true,
        P3_visual_proof: false,
        P4_failure_injection_rollback: checks.p4 === true,
        P5_save_reopen_reconnect_transfer: false,
      },
      checks,
      visualReviewSpec: {
        sourceForeground: foregroundPath,
        sourceBackground: backgroundPath,
        switchDisabledRender: switchDisabledArtifact,
        switchEnabledRender: switchEnabledArtifact,
        orderBottomRender: orderBottomArtifact,
        orderTopRender: orderTopArtifact,
        postRollbackRender: recoveryArtifact,
        requestedSwitchDisabledRender: switchDisabledRenderPath,
        requestedSwitchEnabledRender: switchEnabledRenderPath,
        requestedOrderBottomRender: orderBottomRenderPath,
        requestedOrderTopRender: orderTopRenderPath,
        requestedPostRollbackRender: recoveryRenderPath,
        expected: [
          "p3-switch-disabled-blue must be uniformly blue because the top red layer has enabled=false and Adobe's Video switch excludes its visuals from render.",
          "p3-switch-enabled-red must be uniformly red because the foreground layer is re-enabled while still topmost.",
          "p3-order-bottom-blue must be uniformly blue because the red foreground has moved to the bottom and the opaque blue layer is above it.",
          "p3-order-top-red must be uniformly red because the red foreground has returned to the topmost stack position.",
          "p4-post-rollback-red must be visually equivalent to p3-order-top-red because the induced enabled=false mutation is undone before the failure response returns.",
          "No mixed color, transparency, stale prior frame, or inverted red/blue expectation is acceptable.",
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
        "P1/P2 are accepted baseline evidence from main and are not replayed in this P3/P4 tranche.",
        "P3 uses two opaque full-frame bitmap layers so enabled state and stacking order have deterministic viewer-visible red/blue outcomes with no effect, alpha, camera, or 3D ambiguity.",
        "P3 emits deterministic real-AE artifacts but does not self-claim visual acceptance; retained render evidence must be reviewed before P3 is accepted.",
        "P4 is induced only when the runner-owned AE process inherits EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF=1 and the typed layer.switches.set request uses the exact fixed M3_LAYER_CONTROLS_P4_FAILURE_INJECTION profile.",
        "The induced error occurs after a real enabled=false mutation and structural verification inside the existing M3 undo group; the existing catch path must execute AE Undo, restore the project fingerprint, restore exact layer-controls readback, and restore the red render.",
        "P5 remains explicitly unclaimed and is a separate save/reopen/reconnect transfer tranche.",
      ],
    });
  }
};

void main().catch(async (error) => {
  const resultPath = argument("--result");
  if (resultPath) {
    try {
      await writeJson(resultPath, {
        proofId: "M3_LAYER_CONTROLS_P3_P4_REAL_AE",
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