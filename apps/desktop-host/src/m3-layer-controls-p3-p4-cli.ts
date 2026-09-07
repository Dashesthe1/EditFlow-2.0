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

const layerRefStableId = (value: unknown): string | null => {
  const ref = asRecord(value);
  return ref !== null && typeof ref["stableId"] === "string" ? ref["stableId"] : null;
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

const projectHasStableItem = (project: AeProjectSnapshot | null, stableId: string): boolean =>
  project?.items.some((item) => item.stableId === stableId) ?? false;

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "180000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const backSourcePath = path.join(artifactDir, "p3-back-source.bmp");
  const frontSourcePath = path.join(artifactDir, "p3-front-source.bmp");
  const initialFrontRenderPath = path.join(artifactDir, "p3-initial-front.avi");
  const disabledBackRenderPath = path.join(artifactDir, "p3-disabled-back.avi");
  const restoredFrontRenderPath = path.join(artifactDir, "p3-restored-front.avi");
  const orderBackRenderPath = path.join(artifactDir, "p3-order-back.avi");
  const orderRestoredFrontRenderPath = path.join(artifactDir, "p3-order-restored-front.avi");
  const postRollbackRenderPath = path.join(artifactDir, "p4-post-rollback-front.avi");

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

  const projectId = "m3-layer-controls-p3-p4-real-ae";
  const prefix = `M3_LAYER_CONTROLS_P34_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const backSourceStable = `${prefix}_BACK_SOURCE`;
  const frontSourceStable = `${prefix}_FRONT_SOURCE`;
  const targetCompStable = `${prefix}_TARGET_COMP`;
  const backLayerStable = `${prefix}_BACK_LAYER`;
  const frontLayerStable = `${prefix}_FRONT_LAYER`;
  const temporaryItemStableIds = new Set([backSourceStable, frontSourceStable, targetCompStable]);
  let operationCounter = 0;
  let requestCounter = 0;

  const recordV11 = (command: string, response: AeAdapterResponseV11): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command,
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
    projectSnapshot = observed.project;
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
    recordV11(command, response);
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
    if (typeof jobId !== "string" || typeof completionPath !== "string") throw new Error("render.capture did not return a jobId and completionPath.");
    if (typeof requestedOutputPath !== "string" || !sameFilesystemPath(requestedOutputPath, outputPath)) {
      throw new Error("render.capture requested output-path readback does not match the layer-controls proof request.");
    }
    if (typeof canonicalOutputPath !== "string" || canonicalOutputPath.length === 0) throw new Error("render.capture did not return After Effects' canonical OutputModule.file path.");
    const relativeArtifactPath = path.relative(artifactDir, canonicalOutputPath);
    if (relativeArtifactPath.startsWith("..") || path.isAbsolute(relativeArtifactPath)) {
      throw new Error(`render.capture canonical output escaped the layer-controls artifact directory: ${canonicalOutputPath}`);
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

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(backSourcePath, createBmp24(320, 320, (x, y) => {
      if (x < 160 && y < 160) return [32, 96, 224];
      if (x >= 160 && y < 160) return [24, 176, 196];
      if (x < 160) return [48, 72, 152];
      return [48, 192, 112];
    }));
    await writeFile(frontSourcePath, createBmp24(320, 320, (x, y) => {
      if (x < 160 && y < 160) return [232, 56, 48];
      if (x >= 160 && y < 160) return [244, 148, 36];
      if (x < 160) return [184, 48, 176];
      return [236, 208, 48];
    }));
    checks.fixture_back_image_written = (await stat(backSourcePath)).size > 54;
    checks.fixture_front_image_written = (await stat(frontSourcePath)).size > 54;

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

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v16 = panel.protocolVersion === AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16;
    checks.panel_supports_v11_v16 = panel.supportedProtocolVersions.includes(AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v16 || !checks.panel_supports_v11_v16) {
      throw new Error(`Layer-controls P3/P4 proof requires negotiated protocol ${AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16} with baseline 1.1 fixture compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) throw new Error("Registered CEP panel version does not match installed config.");

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-layer-controls-p34-setup-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects"
      && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    projectSnapshot = baseline.project;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;
    checks.baseline_blank = baseline.project.itemCount === 0;

    const backImport = await executeV11("media.import", { path: backSourcePath, stableId: backSourceStable, sequence: false });
    checks.back_source_import = backImport.affectedObjects.some((item) => item.stableId === backSourceStable && item.kind === "FOOTAGE");
    const frontImport = await executeV11("media.import", { path: frontSourcePath, stableId: frontSourceStable, sequence: false });
    checks.front_source_import = frontImport.affectedObjects.some((item) => item.stableId === frontSourceStable && item.kind === "FOOTAGE");
    const target = await executeV11("comp.create", {
      stableId: targetCompStable,
      name: `${prefix} Layer Controls Visual`,
      width: 320,
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    checks.target_comp_create = target.affectedObjects.some((item) => item.stableId === targetCompStable);
    const backLayer = await executeV11("layer.add_media", {
      stableId: backLayerStable,
      comp: { stableId: targetCompStable },
      item: { stableId: backSourceStable },
    });
    checks.back_layer_create = nestedRecord(backLayer.readback, "layer")?.["stableId"] === backLayerStable;
    const frontLayer = await executeV11("layer.add_media", {
      stableId: frontLayerStable,
      comp: { stableId: targetCompStable },
      item: { stableId: frontSourceStable },
    });
    checks.front_layer_create = nestedRecord(frontLayer.readback, "layer")?.["stableId"] === frontLayerStable;

    const initialFront = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
    }, null);
    const initialBack = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: backLayerStable },
    }, null);
    checks.p3_initial_front_structural = initialFront.outcome === "NO_OP"
      && switchValues(initialFront)?.["enabled"] === true
      && orderRecord(initialFront)?.["index"] === 1
      && orderRecord(initialFront)?.["totalLayers"] === 2
      && layerRefStableId(orderRecord(initialFront)?.["nextLayer"]) === backLayerStable;
    checks.p3_initial_back_structural = initialBack.outcome === "NO_OP"
      && switchValues(initialBack)?.["enabled"] === true
      && orderRecord(initialBack)?.["index"] === 2
      && orderRecord(initialBack)?.["totalLayers"] === 2
      && layerRefStableId(orderRecord(initialBack)?.["previousLayer"]) === frontLayerStable;

    const initialFrontCompletion = await renderComp(initialFrontRenderPath);
    checks.p3_initial_front_artifact = await fileExistsNonEmpty(initialFrontCompletion.outputPath);

    const disableFront = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
      switches: { enabled: false },
    }, hostRevision);
    checks.p3_disable_front_applied = disableFront.outcome === "APPLIED"
      && switchValues(disableFront)?.["enabled"] === false
      && orderRecord(disableFront)?.["index"] === 1;
    await refreshState();
    const disabledBackCompletion = await renderComp(disabledBackRenderPath);
    checks.p3_disabled_back_artifact = await fileExistsNonEmpty(disabledBackCompletion.outputPath);

    const restoreFront = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
      switches: { enabled: true },
    }, hostRevision);
    checks.p3_restore_front_applied = restoreFront.outcome === "APPLIED"
      && switchValues(restoreFront)?.["enabled"] === true
      && orderRecord(restoreFront)?.["index"] === 1;
    await refreshState();
    const restoredFrontCompletion = await renderComp(restoredFrontRenderPath);
    checks.p3_restored_front_artifact = await fileExistsNonEmpty(restoredFrontCompletion.outputPath);

    const moveFrontEnd = await dispatchV16("layer.order.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
      placement: { kind: "END" },
    }, hostRevision);
    checks.p3_order_end_applied = moveFrontEnd.outcome === "APPLIED"
      && orderRecord(moveFrontEnd)?.["index"] === 2
      && layerRefStableId(orderRecord(moveFrontEnd)?.["previousLayer"]) === backLayerStable
      && switchValues(moveFrontEnd)?.["enabled"] === true;
    await refreshState();
    const orderBackCompletion = await renderComp(orderBackRenderPath);
    checks.p3_order_back_artifact = await fileExistsNonEmpty(orderBackCompletion.outputPath);

    const moveFrontBeginning = await dispatchV16("layer.order.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
      placement: { kind: "BEGINNING" },
    }, hostRevision);
    checks.p3_order_restore_applied = moveFrontBeginning.outcome === "APPLIED"
      && orderRecord(moveFrontBeginning)?.["index"] === 1
      && layerRefStableId(orderRecord(moveFrontBeginning)?.["nextLayer"]) === backLayerStable
      && switchValues(moveFrontBeginning)?.["enabled"] === true;
    await refreshState();
    const orderRestoredCompletion = await renderComp(orderRestoredFrontRenderPath);
    checks.p3_order_restored_front_artifact = await fileExistsNonEmpty(orderRestoredCompletion.outputPath);

    checks.p3_visual_artifact_emitted = checks.p3_initial_front_artifact
      && checks.p3_disabled_back_artifact
      && checks.p3_restored_front_artifact
      && checks.p3_order_back_artifact
      && checks.p3_order_restored_front_artifact;

    const beforeFailure = await client.observe(projectId);
    state = beforeFailure.observed;
    hostRevision = beforeFailure.hostRevision;
    projectSnapshot = beforeFailure.project;
    const beforeFailureReadback = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
    }, null);
    checks.p4_baseline_front_exact = beforeFailureReadback.outcome === "NO_OP"
      && switchValues(beforeFailureReadback)?.["enabled"] === true
      && switchValues(beforeFailureReadback)?.["locked"] === false
      && orderRecord(beforeFailureReadback)?.["index"] === 1
      && layerRefStableId(orderRecord(beforeFailureReadback)?.["nextLayer"]) === backLayerStable;

    const inducedFailure = await dispatchV16("layer.order.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
      placement: { kind: "END" },
    }, hostRevision, "M3_LAYER_CONTROLS_P4_FAILURE_INJECTION");
    checks.p4_induced_failure_reported = inducedFailure.outcome === "FAILED"
      && inducedFailure.error?.category === "PROOF_INJECTION"
      && inducedFailure.error?.code === "M3_LAYER_CONTROLS_P4_INDUCED_FAILURE";
    checks.p4_rollback_note = inducedFailure.diagnostics.notes.includes("Layer-controls mutation failed and was rolled back through the transaction undo boundary.");
    checks.p4_response_readback_restored = orderRecord(inducedFailure)?.["index"] === 1
      && layerRefStableId(orderRecord(inducedFailure)?.["nextLayer"]) === backLayerStable
      && switchValues(inducedFailure)?.["enabled"] === true;

    const afterFailure = await client.observe(projectId);
    state = afterFailure.observed;
    hostRevision = afterFailure.hostRevision;
    projectSnapshot = afterFailure.project;
    checks.p4_fingerprint_restored = afterFailure.observed.projectFingerprint === beforeFailure.observed.projectFingerprint;
    checks.p4_item_count_unchanged = afterFailure.project.itemCount === beforeFailure.project.itemCount;

    const afterFailureReadback = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
    }, null);
    checks.p4_structural_state_restored = afterFailureReadback.outcome === "NO_OP"
      && switchValues(afterFailureReadback)?.["enabled"] === true
      && switchValues(afterFailureReadback)?.["locked"] === false
      && orderRecord(afterFailureReadback)?.["index"] === 1
      && orderRecord(afterFailureReadback)?.["totalLayers"] === 2
      && layerRefStableId(orderRecord(afterFailureReadback)?.["nextLayer"]) === backLayerStable;

    const recoveryCompletion = await renderComp(postRollbackRenderPath);
    checks.p4_recovery_visual_artifact_emitted = await fileExistsNonEmpty(recoveryCompletion.outputPath);
    checks.p4_cleanup_trigger_restored_baseline = baselineFingerprint !== null
      && baselineItemCount !== null
      && state?.projectFingerprint === baselineFingerprint
      && projectSnapshot?.itemCount === baselineItemCount;

    checks.p4 = checks.p4_baseline_front_exact
      && checks.p4_induced_failure_reported
      && checks.p4_rollback_note
      && checks.p4_response_readback_restored
      && checks.p4_fingerprint_restored
      && checks.p4_item_count_unchanged
      && checks.p4_structural_state_restored
      && checks.p4_recovery_visual_artifact_emitted
      && checks.p4_cleanup_trigger_restored_baseline;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    if (client !== null) {
      try {
        const final = await client.observe(projectId);
        state = final.observed;
        hostRevision = final.hostRevision;
        projectSnapshot = final.project;
        const temporaryPresent = [...temporaryItemStableIds].some((stableId) => projectHasStableItem(final.project, stableId));
        checks.cleanup_temp_items_absent = !temporaryPresent;
        checks.cleanup_item_count_restored = baselineItemCount !== null && final.project.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint !== null && final.observed.projectFingerprint === baselineFingerprint;
        cleanupComplete = checks.cleanup_temp_items_absent
          && checks.cleanup_item_count_restored
          && checks.cleanup_fingerprint_restored;
      } catch (error) {
        cleanupErrors.push(`final-inspect: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (broker !== null) {
      try { await broker.stop(); }
      catch (error) { cleanupErrors.push(`broker-stop: ${error instanceof Error ? error.message : String(error)}`); }
    }

    const ok = failureError === null
      && cleanupErrors.length === 0
      && cleanupComplete
      && checks.fixture_back_image_written === true
      && checks.fixture_front_image_written === true
      && checks.panel_negotiated_v16 === true
      && checks.panel_supports_v11_v16 === true
      && checks.host_probe === true
      && checks.baseline_blank === true
      && checks.back_source_import === true
      && checks.front_source_import === true
      && checks.target_comp_create === true
      && checks.back_layer_create === true
      && checks.front_layer_create === true
      && checks.p3_initial_front_structural === true
      && checks.p3_initial_back_structural === true
      && checks.p3_disable_front_applied === true
      && checks.p3_restore_front_applied === true
      && checks.p3_order_end_applied === true
      && checks.p3_order_restore_applied === true
      && checks.p3_visual_artifact_emitted === true
      && checks.p4 === true;

    await writeJson(resultPath, {
      proofId: "M3_LAYER_CONTROLS_P3_P4_REAL_AE",
      status: ok ? "VISUAL_REVIEW_REQUIRED" : "FAILURE",
      ok,
      visualReviewRequired: true,
      startedAt,
      completedAt: new Date().toISOString(),
      acceptedBaseline: {
        P1_P2_source_commit: "bf26b3a4351a947d130f792ca7a1a26aa6091a2c",
        P1_P2_acceptance_commit: "48055f15bd7856f3aad8cde762c58b521324f187",
        P1_P2_merge_commit: "fc6c7954e2bd8f8e166d9b0387408142b628afc6",
        P1_P2_run: 34156910741,
        P1_P2_job: 101850542487,
        P1_P2_artifact: 10031293005,
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
        backSourceStable,
        frontSourceStable,
        targetCompStable,
        backLayerStable,
        frontLayerStable,
      },
      visualReviewSpec: {
        initialFrontRender: initialFrontRenderPath,
        disabledBackRender: disabledBackRenderPath,
        restoredFrontRender: restoredFrontRenderPath,
        orderBackRender: orderBackRenderPath,
        orderRestoredFrontRender: orderRestoredFrontRenderPath,
        postRollbackRender: postRollbackRenderPath,
        expected: [
          "initialFrontRender must show the warm front fixture at full frame",
          "disabledBackRender must switch visibly to the cool back fixture while front remains index 1 but disabled",
          "restoredFrontRender must return to the same warm front fixture",
          "orderBackRender must switch visibly to the cool back fixture because enabled front moved beneath back",
          "orderRestoredFrontRender must return to the warm front fixture after front returns to index 1",
          "postRollbackRender must match the warm restored-front state after induced END mutation self-rolls back",
        ],
      },
      cleanupComplete,
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
