import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  AE_LAYER_SWITCH_KEYS_V16,
  type AeLayerControlsCommandV16,
  type AeLayerControlsResponseV16,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_6.js";
import { buildLayerControlsRequestV16 } from "../../../packages/adapters/ae-cep/src/m3-layer-controls.js";
import type { ObservedProjectState } from "../../../packages/core-contracts/src/index.js";
import type { AeProjectSnapshot } from "../../../packages/ae-object-model/src/index.js";
import {
  LoopbackCepBroker,
  type LoopbackCepPanelSession,
} from "./loopback-cep.js";

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

interface ProofMarker {
  readonly proofId: string;
  readonly ok: boolean;
  readonly error: string | null;
  readonly [key: string]: unknown;
}

interface RecordedResponse {
  readonly protocolVersion: string;
  readonly command: string;
  readonly outcome: string;
  readonly error: unknown;
  readonly hostProjectRevision: number | null;
  readonly notes: readonly string[];
}

interface SessionEvidence {
  readonly sessionId: string;
  readonly protocolVersion: string;
  readonly supportedProtocolVersions: readonly string[];
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly registeredAt: string;
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

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const nestedRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = asRecord(value);
  return record === null ? null : asRecord(record[key]);
};

const controlsRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null =>
  nestedRecord(response.readback, "layerControls");

const switchValuesFromControls = (controls: Record<string, unknown> | null): Record<string, unknown> | null => {
  const switches = controls === null ? null : asRecord(controls["switches"]);
  return switches === null ? null : asRecord(switches["values"]);
};

const switchSupportFromControls = (controls: Record<string, unknown> | null): Record<string, unknown> | null => {
  const switches = controls === null ? null : asRecord(controls["switches"]);
  return switches === null ? null : asRecord(switches["supported"]);
};

const orderFromControls = (controls: Record<string, unknown> | null): Record<string, unknown> | null =>
  controls === null ? null : asRecord(controls["order"]);

const layerRefStableId = (value: unknown): string | null => {
  const ref = asRecord(value);
  return ref !== null && typeof ref["stableId"] === "string" ? ref["stableId"] : null;
};

const layerRefHostId = (value: unknown): number | null => {
  const ref = asRecord(value);
  return ref !== null && typeof ref["hostId"] === "number" ? ref["hostId"] : null;
};

const stableJson = (value: unknown): string => JSON.stringify(value);

const semanticControlsSnapshot = (controls: Record<string, unknown> | null): Readonly<Record<string, unknown>> | null => {
  if (controls === null) return null;
  const layer = asRecord(controls["layer"]);
  const values = switchValuesFromControls(controls);
  const supported = switchSupportFromControls(controls);
  const order = orderFromControls(controls);
  if (layer === null || values === null || supported === null || order === null) return null;

  const valueSnapshot: Record<string, unknown> = {};
  const supportSnapshot: Record<string, unknown> = {};
  for (const key of AE_LAYER_SWITCH_KEYS_V16) {
    valueSnapshot[key] = values[key] ?? null;
    supportSnapshot[key] = supported[key] ?? null;
  }

  return {
    layer: {
      stableId: typeof layer["stableId"] === "string" ? layer["stableId"] : null,
      hostId: typeof layer["hostId"] === "number" ? layer["hostId"] : null,
    },
    switches: {
      supported: supportSnapshot,
      values: valueSnapshot,
    },
    order: {
      index: typeof order["index"] === "number" ? order["index"] : null,
      totalLayers: typeof order["totalLayers"] === "number" ? order["totalLayers"] : null,
      previousStableId: layerRefStableId(order["previousLayer"]),
      previousHostId: layerRefHostId(order["previousLayer"]),
      nextStableId: layerRefStableId(order["nextLayer"]),
      nextHostId: layerRefHostId(order["nextLayer"]),
    },
  };
};

const sameFilesystemPath = (left: string, right: string): boolean =>
  path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

const fileExistsNonEmpty = async (filePath: string): Promise<boolean> => {
  try { return (await stat(filePath)).size > 0; } catch { return false; }
};

const waitForMarker = async (filePath: string, proofId: string, timeoutMs: number): Promise<ProofMarker> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const text = stripUtf8Bom(await readFile(filePath, "utf8"));
      const parsed = JSON.parse(text) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("proof marker must be an object");
      const marker = parsed as Record<string, unknown>;
      if (marker["proofId"] !== proofId) throw new Error(`unexpected proofId '${String(marker["proofId"])}'`);
      if (typeof marker["ok"] !== "boolean") throw new Error("proof marker is missing boolean ok");
      if (marker["error"] !== null && typeof marker["error"] !== "string") throw new Error("proof marker has invalid error");
      return marker as unknown as ProofMarker;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(150);
  }
  throw new Error(`PROOF_MARKER_TIMEOUT: ${proofId}${lastError ? ` (${lastError})` : ""}`);
};

const launchAfterFxScript = async (afterFxPath: string, scriptPath: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(afterFxPath, ["-r", scriptPath], { stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
};

const sessionEvidence = (session: LoopbackCepPanelSession): SessionEvidence => ({
  sessionId: session.sessionId,
  protocolVersion: session.protocolVersion,
  supportedProtocolVersions: [...session.supportedProtocolVersions],
  extensionId: session.extensionId,
  extensionVersion: session.extensionVersion,
  registeredAt: session.registeredAt,
});

const findLayerIndex = (project: AeProjectSnapshot, compStableId: string, layerStableId: string): number | null => {
  const comp = project.items.find((item) => item.kind === "COMPOSITION" && item.stableId === compStableId);
  return comp?.composition?.layers.find((layer) => layer.stableId === layerStableId)?.index ?? null;
};

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const afterFxPath = requireArgument("--afterfx-path");
  const reopenScriptPath = requireArgument("--reopen-script");
  const cleanupScriptPath = requireArgument("--cleanup-script");
  const timeoutMs = Number(argument("--timeout-ms") ?? "180000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const artifactDir = path.dirname(resultPath);
  const projectPath = path.join(artifactDir, "m3-layer-controls-p5-transfer.aep");
  const reopenMarkerPath = path.join(artifactDir, "reopen-result.json");
  const cleanupMarkerPath = path.join(artifactDir, "cleanup-result.json");
  const startedAt = new Date().toISOString();

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
  let baselineFilePath: string | null = null;
  let savedFingerprint: string | null = null;
  let savedItemCount: number | null = null;
  let initialSession: SessionEvidence | null = null;
  let reconnectedSession: SessionEvidence | null = null;
  let panelHostName: string | null = null;
  let panelHostVersion: string | null = null;
  let panelHostBuild: string | null = null;
  let panelExtensionVersion: string | null = null;
  let beforeSaveControls: Record<string, unknown> | null = null;
  let afterReconnectControls: Record<string, unknown> | null = null;
  let afterMutationControls: Record<string, unknown> | null = null;
  let beforeSaveSemantic: Readonly<Record<string, unknown>> | null = null;
  let afterReconnectSemantic: Readonly<Record<string, unknown>> | null = null;
  let afterMutationSemantic: Readonly<Record<string, unknown>> | null = null;
  let reopenMarker: ProofMarker | null = null;
  let cleanupMarker: ProofMarker | null = null;
  let operationCounter = 0;
  let requestCounter = 0;

  const projectId = "m3-layer-controls-p5-real-ae";
  const prefix = `M3_LAYER_CONTROLS_P5_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const backSourceStable = `${prefix}_BACK_SOURCE_COMP`;
  const frontSourceStable = `${prefix}_FRONT_SOURCE_COMP`;
  const targetCompStable = `${prefix}_TARGET_COMP`;
  const backLayerStable = `${prefix}_BACK_LAYER`;
  const frontLayerStable = `${prefix}_FRONT_LAYER`;

  const preSaveSwitchPatch = Object.freeze({
    audioEnabled: false,
    locked: true,
    shy: true,
    quality: "DRAFT",
    effectsActive: false,
    preserveTransparency: true,
    samplingQuality: "BICUBIC",
  });
  const postReconnectSwitchPatch = Object.freeze({
    audioEnabled: true,
    locked: false,
    shy: false,
    quality: "BEST",
    effectsActive: true,
    preserveTransparency: false,
    samplingQuality: "BILINEAR",
  });
  const changedSwitchKeys = new Set<string>(Object.keys(postReconnectSwitchPatch));

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
    if (client === null) throw new Error("M3 layer-controls P5 client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
  };

  const executeV11 = async (
    command: AeAdapterPublicCommandV11,
    payload: Readonly<Record<string, unknown>>,
    readbackProfile = "M3_LAYER_CONTROLS_P5_TRANSFER",
  ): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M3 layer-controls P5 client state is not initialized.");
    operationCounter += 1;
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_OP_${operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile,
    });
    recordV11(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    }
    await refreshState();
    return response;
  };

  const dispatchV16 = async (
    command: AeLayerControlsCommandV16,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_LAYER_CONTROLS_P5_TRANSFER",
  ): Promise<AeLayerControlsResponseV16> => {
    if (broker === null) throw new Error("M3 layer-controls P5 broker is not initialized.");
    operationCounter += 1;
    const response = await broker.dispatch(buildLayerControlsRequestV16({
      requestId: `m3-layer-controls-p5-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V16_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    }));
    recordV16(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const createClient = (): AeCepAdapterClientV11 => {
    if (broker === null) throw new Error("M3 layer-controls P5 broker is not initialized.");
    return new AeCepAdapterClientV11(
      broker,
      () => `m3-layer-controls-p5-v11-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await Promise.all([
      rm(resultPath, { force: true }),
      rm(projectPath, { force: true }),
      rm(reopenMarkerPath, { force: true }),
      rm(cleanupMarkerPath, { force: true }),
    ]);
    checks.proof_scripts_present = (await stat(reopenScriptPath)).isFile() && (await stat(cleanupScriptPath)).isFile();
    checks.afterfx_present = (await stat(afterFxPath)).isFile();

    const configText = stripUtf8Bom(await readFile(configPath, "utf8"));
    const config = parseConfig(JSON.parse(configText) as unknown);
    panelExtensionVersion = config.extensionVersion;

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

    const firstPanel = await broker.waitForPanel(timeoutMs);
    initialSession = sessionEvidence(firstPanel);
    checks.initial_panel_negotiated_v16 = firstPanel.protocolVersion === AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16;
    checks.initial_panel_supports_v11_v16 = firstPanel.supportedProtocolVersions.includes(AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16)
      && firstPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.initial_panel_negotiated_v16 || !checks.initial_panel_supports_v11_v16) {
      throw new Error("M3 layer-controls P5 requires an authenticated panel session negotiated at protocol 1.6 with baseline 1.1 compatibility.");
    }

    client = createClient();
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
    baselineFilePath = baseline.project.filePath;
    checks.blank_baseline = baseline.project.itemCount === 0 && baseline.project.filePath === null;
    if (!checks.blank_baseline) throw new Error("M3 layer-controls P5 requires a blank unsaved runner-owned project baseline.");

    const backSource = await executeV11("comp.create", {
      stableId: backSourceStable,
      name: `${prefix} Back Source`,
      width: 320,
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    checks.back_source_created = backSource.affectedObjects.some((item) => item.stableId === backSourceStable);

    const frontSource = await executeV11("comp.create", {
      stableId: frontSourceStable,
      name: `${prefix} Front Source`,
      width: 320,
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    checks.front_source_created = frontSource.affectedObjects.some((item) => item.stableId === frontSourceStable);

    const target = await executeV11("comp.create", {
      stableId: targetCompStable,
      name: `${prefix} Transfer Target`,
      width: 640,
      height: 360,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    checks.target_created = target.affectedObjects.some((item) => item.stableId === targetCompStable);

    await executeV11("layer.add_media", {
      stableId: backLayerStable,
      comp: { stableId: targetCompStable },
      item: { stableId: backSourceStable },
    });
    await executeV11("layer.add_media", {
      stableId: frontLayerStable,
      comp: { stableId: targetCompStable },
      item: { stableId: frontSourceStable },
    });

    const initialFront = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
    }, null, "M3_LAYER_CONTROLS_P5_INITIAL_READ");
    const initialControls = controlsRecord(initialFront);
    const initialSupport = switchSupportFromControls(initialControls);
    checks.initial_all_switches_supported = initialFront.outcome === "NO_OP"
      && initialSupport !== null
      && AE_LAYER_SWITCH_KEYS_V16.every((key) => initialSupport[key] === true)
      && orderFromControls(initialControls)?.["index"] === 1
      && layerRefStableId(orderFromControls(initialControls)?.["nextLayer"]) === backLayerStable;
    if (!checks.initial_all_switches_supported) {
      throw new Error("M3 layer-controls P5 fixture does not expose the complete accepted protocol-1.6 switch surface.");
    }

    const switchState = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
      switches: preSaveSwitchPatch,
    }, hostRevision, "M3_LAYER_CONTROLS_P5_SWITCH_STATE_BEFORE_SAVE");
    const switchStateControls = controlsRecord(switchState);
    const switchStateValues = switchValuesFromControls(switchStateControls);
    checks.pre_save_switch_patch_applied = switchState.outcome === "APPLIED"
      && switchStateValues?.["audioEnabled"] === false
      && switchStateValues?.["locked"] === true
      && switchStateValues?.["shy"] === true
      && switchStateValues?.["quality"] === "DRAFT"
      && switchStateValues?.["effectsActive"] === false
      && switchStateValues?.["preserveTransparency"] === true
      && switchStateValues?.["samplingQuality"] === "BICUBIC";
    if (!checks.pre_save_switch_patch_applied) throw new Error("M3 layer-controls P5 could not establish the distinctive pre-save switch state.");

    await refreshState();
    const moveEnd = await dispatchV16("layer.order.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
      placement: { kind: "END" },
    }, hostRevision, "M3_LAYER_CONTROLS_P5_ORDER_BEFORE_SAVE");
    const movedControls = controlsRecord(moveEnd);
    checks.pre_save_locked_order_applied = moveEnd.outcome === "APPLIED"
      && switchValuesFromControls(movedControls)?.["locked"] === true
      && orderFromControls(movedControls)?.["index"] === 2
      && orderFromControls(movedControls)?.["totalLayers"] === 2
      && layerRefStableId(orderFromControls(movedControls)?.["previousLayer"]) === backLayerStable;
    if (!checks.pre_save_locked_order_applied) throw new Error("M3 layer-controls P5 could not establish the distinctive pre-save stacking order while preserving lock state.");

    const preSaveRead = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
    }, null, "M3_LAYER_CONTROLS_P5_READ_BEFORE_SAVE");
    beforeSaveControls = controlsRecord(preSaveRead);
    beforeSaveSemantic = semanticControlsSnapshot(beforeSaveControls);
    const preSaveValues = switchValuesFromControls(beforeSaveControls);
    const preSaveSupport = switchSupportFromControls(beforeSaveControls);
    const preSaveOrder = orderFromControls(beforeSaveControls);
    checks.pre_save_controls_exact = preSaveRead.outcome === "NO_OP"
      && beforeSaveSemantic !== null
      && layerRefStableId(beforeSaveControls?.["layer"]) === frontLayerStable
      && layerRefHostId(beforeSaveControls?.["layer"]) !== null
      && preSaveSupport !== null
      && AE_LAYER_SWITCH_KEYS_V16.every((key) => preSaveSupport[key] === true)
      && preSaveValues?.["enabled"] === true
      && preSaveValues?.["audioEnabled"] === false
      && preSaveValues?.["locked"] === true
      && preSaveValues?.["shy"] === true
      && preSaveValues?.["quality"] === "DRAFT"
      && preSaveValues?.["effectsActive"] === false
      && preSaveValues?.["preserveTransparency"] === true
      && preSaveValues?.["samplingQuality"] === "BICUBIC"
      && preSaveOrder?.["index"] === 2
      && preSaveOrder?.["totalLayers"] === 2
      && layerRefStableId(preSaveOrder?.["previousLayer"]) === backLayerStable;
    if (!checks.pre_save_controls_exact) throw new Error("M3 layer-controls P5 pre-save semantic readback is not exact.");

    if (client === null) throw new Error("M3 layer-controls P5 client disappeared before save.");
    const preSaveObserved = await client.observe(projectId);
    state = preSaveObserved.observed;
    hostRevision = preSaveObserved.hostRevision;
    checks.pre_save_snapshot_order = findLayerIndex(preSaveObserved.project, targetCompStable, backLayerStable) === 1
      && findLayerIndex(preSaveObserved.project, targetCompStable, frontLayerStable) === 2;

    const saveResponse = await executeV11("project.save", { path: projectPath }, "M3_LAYER_CONTROLS_P5_SAVE");
    checks.project_save_applied = saveResponse.outcome === "APPLIED" || saveResponse.outcome === "NO_OP";
    checks.saved_project_artifact = await fileExistsNonEmpty(projectPath);
    if (!checks.saved_project_artifact) throw new Error("M3 layer-controls P5 project.save did not produce a non-empty .aep artifact.");

    if (client === null) throw new Error("M3 layer-controls P5 client disappeared after save.");
    const saved = await client.observe(projectId);
    state = saved.observed;
    hostRevision = saved.hostRevision;
    savedFingerprint = saved.observed.projectFingerprint;
    savedItemCount = saved.project.itemCount;
    checks.saved_project_path_readback = saved.project.filePath !== null && sameFilesystemPath(saved.project.filePath, projectPath);
    checks.saved_fixture_shape = saved.project.itemCount === 3
      && saved.project.items.some((item) => item.stableId === backSourceStable && item.kind === "COMPOSITION")
      && saved.project.items.some((item) => item.stableId === frontSourceStable && item.kind === "COMPOSITION")
      && saved.project.items.some((item) => item.stableId === targetCompStable && item.kind === "COMPOSITION")
      && findLayerIndex(saved.project, targetCompStable, backLayerStable) === 1
      && findLayerIndex(saved.project, targetCompStable, frontLayerStable) === 2;
    if (!checks.saved_project_path_readback || !checks.saved_fixture_shape) {
      throw new Error("M3 layer-controls P5 saved-project structural readback is incomplete.");
    }

    await launchAfterFxScript(afterFxPath, reopenScriptPath);
    reopenMarker = await waitForMarker(reopenMarkerPath, "M3_LAYER_CONTROLS_P5_REOPEN", timeoutMs);
    checks.reopen_script_passed = reopenMarker.ok === true
      && reopenMarker["dispatcherReady"] === true
      && typeof reopenMarker["projectPath"] === "string"
      && sameFilesystemPath(reopenMarker["projectPath"], projectPath)
      && reopenMarker["itemCount"] === savedItemCount;
    if (!checks.reopen_script_passed) throw new Error(`M3 layer-controls P5 reopen proof failed: ${reopenMarker.error ?? "invalid marker"}`);

    if (initialSession === null) throw new Error("M3 layer-controls P5 initial CEP session evidence is missing.");
    const firstSessionId = initialSession.sessionId;
    await broker.stop();
    await sleep(300);
    const reboundPort = await broker.start();
    if (reboundPort !== config.port) throw new Error(`CEP broker rebound unexpected port ${reboundPort}.`);
    const secondPanel = await broker.waitForPanel(timeoutMs);
    reconnectedSession = sessionEvidence(secondPanel);
    checks.authenticated_reconnect = secondPanel.sessionId !== firstSessionId
      && secondPanel.protocolVersion === AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16
      && secondPanel.supportedProtocolVersions.includes(AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16)
      && secondPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)
      && secondPanel.extensionId === config.extensionId
      && secondPanel.extensionVersion === config.extensionVersion;
    if (!checks.authenticated_reconnect) throw new Error("M3 layer-controls P5 did not establish a distinct authenticated protocol-1.6 CEP session after reopen.");

    client = createClient();
    const reconnectedEnvironment = await client.probe();
    checks.post_reconnect_host_probe = reconnectedEnvironment.hostName === "Adobe After Effects"
      && reconnectedEnvironment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const reopened = await client.observe(projectId);
    state = reopened.observed;
    hostRevision = reopened.hostRevision;
    checks.reopened_project_path = reopened.project.filePath !== null && sameFilesystemPath(reopened.project.filePath, projectPath);
    checks.reopened_item_count_preserved = savedItemCount !== null && reopened.project.itemCount === savedItemCount;
    checks.reopened_stable_layers = findLayerIndex(reopened.project, targetCompStable, backLayerStable) === 1
      && findLayerIndex(reopened.project, targetCompStable, frontLayerStable) === 2;
    checks.saved_structural_fingerprint_preserved = savedFingerprint !== null
      && reopened.observed.projectFingerprint === savedFingerprint;

    const postReconnectRead = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
    }, null, "M3_LAYER_CONTROLS_P5_POST_RECONNECT_READ");
    afterReconnectControls = controlsRecord(postReconnectRead);
    afterReconnectSemantic = semanticControlsSnapshot(afterReconnectControls);
    checks.layer_controls_exact_after_reopen_reconnect = postReconnectRead.outcome === "NO_OP"
      && beforeSaveSemantic !== null
      && afterReconnectSemantic !== null
      && stableJson(afterReconnectSemantic) === stableJson(beforeSaveSemantic);
    checks.native_layer_id_persisted = beforeSaveSemantic !== null
      && afterReconnectSemantic !== null
      && asRecord(beforeSaveSemantic["layer"])?.["hostId"] !== null
      && asRecord(afterReconnectSemantic["layer"])?.["hostId"] === asRecord(beforeSaveSemantic["layer"])?.["hostId"];
    if (!checks.layer_controls_exact_after_reopen_reconnect || !checks.native_layer_id_persisted) {
      throw new Error("M3 layer-controls P5 switch/order semantics or native layer identity changed across save/reopen/reconnect.");
    }

    await refreshState();
    const postReconnectSwitch = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
      switches: postReconnectSwitchPatch,
    }, hostRevision, "M3_LAYER_CONTROLS_P5_POST_RECONNECT_SWITCH_MUTATION");
    const postSwitchControls = controlsRecord(postReconnectSwitch);
    const postSwitchValues = switchValuesFromControls(postSwitchControls);
    checks.post_reconnect_switch_mutation_applied = postReconnectSwitch.outcome === "APPLIED"
      && postSwitchValues?.["audioEnabled"] === true
      && postSwitchValues?.["locked"] === false
      && postSwitchValues?.["shy"] === false
      && postSwitchValues?.["quality"] === "BEST"
      && postSwitchValues?.["effectsActive"] === true
      && postSwitchValues?.["preserveTransparency"] === false
      && postSwitchValues?.["samplingQuality"] === "BILINEAR";
    if (!checks.post_reconnect_switch_mutation_applied) {
      throw new Error(`M3 layer-controls P5 post-reconnect switch mutation failed: ${postReconnectSwitch.error?.code ?? postReconnectSwitch.outcome}`);
    }

    await refreshState();
    const postReconnectOrder = await dispatchV16("layer.order.set", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
      placement: { kind: "BEGINNING" },
    }, hostRevision, "M3_LAYER_CONTROLS_P5_POST_RECONNECT_ORDER_MUTATION");
    const postOrderControls = controlsRecord(postReconnectOrder);
    checks.post_reconnect_order_mutation_applied = postReconnectOrder.outcome === "APPLIED"
      && orderFromControls(postOrderControls)?.["index"] === 1
      && orderFromControls(postOrderControls)?.["totalLayers"] === 2
      && layerRefStableId(orderFromControls(postOrderControls)?.["nextLayer"]) === backLayerStable
      && switchValuesFromControls(postOrderControls)?.["locked"] === false;
    if (!checks.post_reconnect_order_mutation_applied) {
      throw new Error(`M3 layer-controls P5 post-reconnect order mutation failed: ${postReconnectOrder.error?.code ?? postReconnectOrder.outcome}`);
    }

    const postMutationRead = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetCompStable },
      layer: { stableId: frontLayerStable },
    }, null, "M3_LAYER_CONTROLS_P5_POST_RECONNECT_READBACK");
    afterMutationControls = controlsRecord(postMutationRead);
    afterMutationSemantic = semanticControlsSnapshot(afterMutationControls);
    const postMutationValues = switchValuesFromControls(afterMutationControls);
    const beforeSaveValues = switchValuesFromControls(beforeSaveControls);
    checks.post_reconnect_mutation_readback = postMutationRead.outcome === "NO_OP"
      && afterMutationSemantic !== null
      && layerRefStableId(afterMutationControls?.["layer"]) === frontLayerStable
      && postMutationValues?.["audioEnabled"] === true
      && postMutationValues?.["locked"] === false
      && postMutationValues?.["shy"] === false
      && postMutationValues?.["quality"] === "BEST"
      && postMutationValues?.["effectsActive"] === true
      && postMutationValues?.["preserveTransparency"] === false
      && postMutationValues?.["samplingQuality"] === "BILINEAR"
      && orderFromControls(afterMutationControls)?.["index"] === 1
      && layerRefStableId(orderFromControls(afterMutationControls)?.["nextLayer"]) === backLayerStable;
    checks.post_reconnect_untouched_switches_preserved = beforeSaveValues !== null
      && postMutationValues !== null
      && AE_LAYER_SWITCH_KEYS_V16
        .filter((key) => !changedSwitchKeys.has(key))
        .every((key) => postMutationValues[key] === beforeSaveValues[key]);
    if (!checks.post_reconnect_mutation_readback || !checks.post_reconnect_untouched_switches_preserved) {
      throw new Error("M3 layer-controls P5 fresh post-reconnect switch/order authority did not read back exactly or disturbed untouched switches.");
    }

    await rm(cleanupMarkerPath, { force: true });
    await launchAfterFxScript(afterFxPath, cleanupScriptPath);
    cleanupMarker = await waitForMarker(cleanupMarkerPath, "M3_LAYER_CONTROLS_P5_CLEANUP", timeoutMs);
    checks.proof_cleanup_script_passed = cleanupMarker.ok === true
      && cleanupMarker["proofPrefix"] === prefix
      && cleanupMarker["blankItemCount"] === 0
      && typeof cleanupMarker["retainedProjectPath"] === "string"
      && sameFilesystemPath(cleanupMarker["retainedProjectPath"], projectPath);
    checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);

    if (client === null) throw new Error("M3 layer-controls P5 client disappeared before final cleanup verification.");
    const final = await client.observe(projectId);
    checks.cleanup_blank_project = final.project.itemCount === (baselineItemCount ?? 0)
      && final.project.filePath === baselineFilePath;
    checks.cleanup_fingerprint_restored = baselineFingerprint !== null
      && final.observed.projectFingerprint === baselineFingerprint;
    cleanupComplete = checks.proof_cleanup_script_passed === true
      && checks.saved_project_retained_after_cleanup === true
      && checks.cleanup_blank_project === true
      && checks.cleanup_fingerprint_restored === true;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    if (!cleanupComplete && await fileExistsNonEmpty(projectPath)) {
      try {
        await rm(cleanupMarkerPath, { force: true });
        await launchAfterFxScript(afterFxPath, cleanupScriptPath);
        const recoveryCleanup = await waitForMarker(cleanupMarkerPath, "M3_LAYER_CONTROLS_P5_CLEANUP", Math.min(timeoutMs, 30_000));
        if (recoveryCleanup.ok) {
          cleanupMarker = recoveryCleanup;
          checks.proof_cleanup_script_passed = true;
          checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);
          if (client !== null && broker !== null && broker.isStarted) {
            try {
              const final = await client.observe(projectId);
              checks.cleanup_blank_project = final.project.itemCount === (baselineItemCount ?? 0)
                && final.project.filePath === baselineFilePath;
              checks.cleanup_fingerprint_restored = baselineFingerprint !== null
                && final.observed.projectFingerprint === baselineFingerprint;
              cleanupComplete = checks.proof_cleanup_script_passed === true
                && checks.saved_project_retained_after_cleanup === true
                && checks.cleanup_blank_project === true
                && checks.cleanup_fingerprint_restored === true;
            } catch (error) {
              cleanupErrors.push(`cleanup final observe: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } else {
          cleanupErrors.push(`proof cleanup marker: ${recoveryCleanup.error ?? "reported failure"}`);
        }
      } catch (error) {
        cleanupErrors.push(`proof cleanup recovery: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (broker !== null && broker.isStarted) {
      try { await broker.stop(); } catch (error) {
        cleanupErrors.push(`broker stop: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const ok = failureError === null
      && cleanupErrors.length === 0
      && cleanupComplete
      && checks.proof_scripts_present === true
      && checks.afterfx_present === true
      && checks.initial_panel_negotiated_v16 === true
      && checks.initial_panel_supports_v11_v16 === true
      && checks.host_probe === true
      && checks.blank_baseline === true
      && checks.back_source_created === true
      && checks.front_source_created === true
      && checks.target_created === true
      && checks.initial_all_switches_supported === true
      && checks.pre_save_switch_patch_applied === true
      && checks.pre_save_locked_order_applied === true
      && checks.pre_save_controls_exact === true
      && checks.pre_save_snapshot_order === true
      && checks.project_save_applied === true
      && checks.saved_project_artifact === true
      && checks.saved_project_path_readback === true
      && checks.saved_fixture_shape === true
      && checks.reopen_script_passed === true
      && checks.authenticated_reconnect === true
      && checks.post_reconnect_host_probe === true
      && checks.reopened_project_path === true
      && checks.reopened_item_count_preserved === true
      && checks.reopened_stable_layers === true
      && checks.saved_structural_fingerprint_preserved === true
      && checks.layer_controls_exact_after_reopen_reconnect === true
      && checks.native_layer_id_persisted === true
      && checks.post_reconnect_switch_mutation_applied === true
      && checks.post_reconnect_order_mutation_applied === true
      && checks.post_reconnect_mutation_readback === true
      && checks.post_reconnect_untouched_switches_preserved === true
      && checks.proof_cleanup_script_passed === true
      && checks.saved_project_retained_after_cleanup === true
      && checks.cleanup_blank_project === true
      && checks.cleanup_fingerprint_restored === true;

    await writeJson(resultPath, {
      proofId: "M3_LAYER_CONTROLS_P5_REAL_AE",
      status: ok ? "ACCEPTED" : "FAILURE",
      ok,
      startedAt,
      completedAt: new Date().toISOString(),
      acceptedBaseline: {
        P1_P2_merge_commit: "fc6c7954e2bd8f8e166d9b0387408142b628afc6",
        P1_P2_run: 34156910741,
        P1_P2_acceptance: "proofs/diagnostics/m3-layer-controls-p1-p2-run7-acceptance.md",
        P3_P4_merge_commit: "7dc3558b932995dba078030089226b894cf95d85",
        P3_P4_run: 34159635705,
        P3_P4_job: 101858554842,
        P3_P4_artifact: 10032176111,
        P3_P4_acceptance: "proofs/diagnostics/m3-layer-controls-p3-p4-run9-acceptance.md",
      },
      proofLevels: {
        P1_validation_rejection: "accepted-baseline-not-replayed",
        P2_structural_readback: "accepted-baseline-not-replayed",
        P3_visual_proof: "accepted-baseline-not-replayed",
        P4_failure_injection_rollback: "accepted-baseline-not-replayed",
        P5_save_reopen_reconnect_transfer: ok,
      },
      checks,
      sessions: {
        initial: initialSession,
        reconnected: reconnectedSession,
      },
      environment: {
        host: panelHostName,
        hostVersion: panelHostVersion,
        hostBuild: panelHostBuild,
        extensionVersion: panelExtensionVersion,
      },
      stableIds: {
        backSourceComp: backSourceStable,
        frontSourceComp: frontSourceStable,
        targetComp: targetCompStable,
        backLayer: backLayerStable,
        frontLayer: frontLayerStable,
      },
      artifacts: {
        savedProject: projectPath,
        reopenMarker: reopenMarkerPath,
        cleanupMarker: cleanupMarkerPath,
      },
      switchPatches: {
        preSave: preSaveSwitchPatch,
        postReconnect: postReconnectSwitchPatch,
      },
      readback: {
        beforeSaveControls,
        afterReconnectControls,
        afterMutationControls,
        beforeSaveSemantic,
        afterReconnectSemantic,
        afterMutationSemantic,
      },
      responses,
      reopenMarker,
      cleanupMarker,
      failureError,
      cleanupErrors,
      cleanupComplete,
      notes: [
        "P5 starts from the merged accepted protocol-1.6 P1-P4 baseline and deliberately does not replay earlier maturity evidence.",
        "The disposable nested-composition AVLayer fixture first proves all twelve accepted protocol-1.6 switch keys are supported, then saves a distinctive multi-switch state with the front layer locked at END.",
        "The project is saved through the public v1.1 project.save capability under the artifact-directory filesystem policy.",
        "After Effects closes and reopens only the fixed runner-owned .aep, reloads the protocol-1.6 dispatcher, and the loopback broker is stopped/restarted so the CEP panel must establish a distinct authenticated session.",
        "Post-reconnect semantic readback compares every declared switch support/value plus exact stacking order and native AE Layer.id continuity before any new mutation.",
        "A fresh post-reconnect switch patch and BEGINNING order mutation prove transferred protocol-1.6 write/readback authority without disturbing untouched switches.",
        "The saved .aep is retained as P5 evidence; proof-only cleanup discards only the exact verified disposable project and the harness re-observes the original blank structural fingerprint.",
      ],
    });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
