import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  type AeAdapterPublicCommandV11,
  type AeAdapterResponseV11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19,
  type AeSpatialGraphCommandV19,
  type AeSpatialGraphObservedStateV19,
  type AeSpatialGraphResponseV19,
  type AeSpatialGraphSetStateV19,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_9.js";
import { buildSpatialGraphRequestV19 } from "../../../packages/adapters/ae-cep/src/m3-spatial-graph.js";
import type { ObservedProjectState } from "../../../packages/core-contracts/src/index.js";
import type { AeProjectSnapshot } from "../../../packages/ae-object-model/src/index.js";
import { LoopbackCepBroker, type LoopbackCepPanelSession } from "./loopback-cep.js";

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
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nestedRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = asRecord(value);
  return record === null ? null : asRecord(record[key]);
};
const closeNumber = (left: number, right: number): boolean => Math.abs(left - right) <= 0.000001;
const vectorMatches = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value, index) => right[index] !== undefined && closeNumber(value, right[index] as number));
const sameFilesystemPath = (left: string, right: string): boolean => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

const parseConfig = (value: unknown): BridgeConfigFile => {
  const candidate = asRecord(value);
  if (candidate === null || candidate["schemaVersion"] !== 1 || candidate["host"] !== "127.0.0.1") throw new Error("Bridge config schema/host is invalid.");
  if (!Number.isInteger(candidate["port"]) || (candidate["port"] as number) < 1 || (candidate["port"] as number) > 65535) throw new Error("Bridge config port is invalid.");
  if (typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("Bridge token is invalid.");
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("Bridge legacy protocolVersion mismatch.");
  const supported = candidate["supportedProtocolVersions"];
  if (!Array.isArray(supported)
      || !supported.includes(AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("Bridge config does not advertise required 1.9 and 1.1 protocols.");
  }
  if (typeof candidate["extensionId"] !== "string" || candidate["extensionId"].length === 0) throw new Error("Bridge extensionId is missing.");
  if (typeof candidate["extensionVersion"] !== "string" || candidate["extensionVersion"].length === 0) throw new Error("Bridge extensionVersion is missing.");
  return candidate as unknown as BridgeConfigFile;
};

const parseAcceptedP1P4 = (value: unknown): void => {
  const candidate = asRecord(value);
  const levels = candidate === null ? null : asRecord(candidate["proofLevels"]);
  if (candidate === null
      || candidate["proofId"] !== "M3_SPATIAL_GRAPH_P1_P4_ACCEPTANCE"
      || candidate["protocolVersion"] !== AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19
      || candidate["accepted"] !== true
      || levels === null
      || levels["P1_validation_rejection"] !== true
      || levels["P2_structural_readback"] !== true
      || levels["P3_visual_proof"] !== true
      || levels["P4_failure_injection_rollback"] !== true
      || levels["P5_save_reopen_reconnect_transfer"] !== false) {
    throw new Error("Spatial P5 requires the independently accepted protocol-1.9 P1-P4 provenance record.");
  }
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const sleep = async (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
const fileExistsNonEmpty = async (filePath: string): Promise<boolean> => {
  try { return (await stat(filePath)).size > 0; } catch { return false; }
};

const waitForMarker = async (filePath: string, proofId: string, timeoutMs: number): Promise<ProofMarker> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(stripUtf8Bom(await readFile(filePath, "utf8"))) as unknown;
      const marker = asRecord(parsed);
      if (marker === null || marker["proofId"] !== proofId || typeof marker["ok"] !== "boolean") throw new Error("proof marker identity is invalid");
      if (marker["error"] !== null && typeof marker["error"] !== "string") throw new Error("proof marker error is invalid");
      return marker as unknown as ProofMarker;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await sleep(150);
  }
  throw new Error(`PROOF_MARKER_TIMEOUT: ${proofId}${lastError ? ` (${lastError})` : ""}`);
};

const launchAfterFxScript = async (afterFxPath: string, scriptPath: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(afterFxPath, ["-r", scriptPath], { stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
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

const spatialStateFromResponse = (response: AeSpatialGraphResponseV19): AeSpatialGraphObservedStateV19 | null => {
  const spatial = nestedRecord(response.readback, "spatialGraph");
  const state = spatial === null ? null : asRecord(spatial["state"]);
  if (state === null || !Array.isArray(state["inTangent"]) || !Array.isArray(state["outTangent"])) return null;
  if (typeof state["continuous"] !== "boolean" || typeof state["autoBezier"] !== "boolean" || typeof state["roving"] !== "boolean") return null;
  if (!(state["inTangent"] as unknown[]).every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  if (!(state["outTangent"] as unknown[]).every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return state as unknown as AeSpatialGraphObservedStateV19;
};
const spatialStatesEqual = (left: AeSpatialGraphObservedStateV19, right: AeSpatialGraphObservedStateV19): boolean =>
  left.continuous === right.continuous
  && left.autoBezier === right.autoBezier
  && left.roving === right.roving
  && vectorMatches(left.inTangent, right.inTangent)
  && vectorMatches(left.outTangent, right.outTangent);
const manualStateMatches = (response: AeSpatialGraphResponseV19, expected: Extract<AeSpatialGraphSetStateV19, { readonly mode: "MANUAL" }>): boolean => {
  const actual = spatialStateFromResponse(response);
  return actual !== null
    && actual.autoBezier === false
    && actual.continuous === expected.continuous
    && actual.roving === expected.roving
    && vectorMatches(actual.inTangent, expected.inTangent)
    && vectorMatches(actual.outTangent, expected.outTangent);
};
const autoStateMatches = (response: AeSpatialGraphResponseV19, expected: Extract<AeSpatialGraphSetStateV19, { readonly mode: "AUTO_BEZIER" }>): boolean => {
  const actual = spatialStateFromResponse(response);
  return actual !== null && actual.autoBezier === true && actual.continuous === expected.continuous && actual.roving === expected.roving;
};
const spatialRecord = (response: AeSpatialGraphResponseV19): Record<string, unknown> | null => nestedRecord(response.readback, "spatialGraph");
const keyTimeFromResponse = (response: AeSpatialGraphResponseV19): number | null => {
  const value = spatialRecord(response)?.["keyTime"];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
const layerHostIdFromResponse = (response: AeSpatialGraphResponseV19): number | null => {
  const value = asRecord(spatialRecord(response)?.["layer"])?.["hostId"];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
};

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const afterFxPath = requireArgument("--afterfx-path");
  const reopenScriptPath = requireArgument("--reopen-script");
  const cleanupScriptPath = requireArgument("--cleanup-script");
  const acceptedP1P4Path = argument("--accepted-p1-p4") ?? path.resolve("proofs/diagnostics/m3-spatial-graph-p1-p4-acceptance.json");
  const timeoutMs = Number(argument("--timeout-ms") ?? "180000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  parseAcceptedP1P4(JSON.parse(stripUtf8Bom(await readFile(acceptedP1P4Path, "utf8"))) as unknown);

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const projectPath = path.join(artifactDir, "m3-spatial-graph-p5-transfer.aep");
  const reopenMarkerPath = path.join(artifactDir, "reopen-result.json");
  const cleanupMarkerPath = path.join(artifactDir, "cleanup-result.json");
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
  let reopenMarker: ProofMarker | null = null;
  let cleanupMarker: ProofMarker | null = null;
  let panelHostName: string | null = null;
  let panelHostVersion: string | null = null;
  let panelHostBuild: string | null = null;
  let panelExtensionVersion: string | null = null;
  let savedSpatialState: AeSpatialGraphObservedStateV19 | null = null;
  let savedSpatialKeyTime: number | null = null;
  let savedNativeLayerId: number | null = null;
  let reopenedNativeLayerId: number | null = null;
  let operationCounter = 0;
  let requestCounter = 0;

  const projectId = "m3-spatial-graph-p5-real-ae";
  const prefix = `M3_SPATIAL_GRAPH_P5_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layerStable = `${prefix}_LAYER`;
  const propertyPath = ["ADBE Transform Group", "ADBE Position"] as const;
  const keyIndex = 2;
  const preSaveState: Extract<AeSpatialGraphSetStateV19, { readonly mode: "AUTO_BEZIER" }> = {
    mode: "AUTO_BEZIER",
    continuous: true,
    roving: true,
  };
  const postReconnectState: Extract<AeSpatialGraphSetStateV19, { readonly mode: "MANUAL" }> = {
    mode: "MANUAL",
    inTangent: [-96, 132, 0],
    outTangent: [156, -84, 0],
    continuous: false,
    roving: false,
  };

  const recordResponse = (response: AeAdapterResponseV11 | AeSpatialGraphResponseV19): void => {
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
    if (client === null) throw new Error("M3 spatial P5 client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
  };
  const executeV11 = async (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>, readbackProfile = "M3_SPATIAL_GRAPH_P5_TRANSFER"): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M3 spatial P5 V11 state is not initialized.");
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_OP_${++operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile,
    });
    recordResponse(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`${command} failed: ${response.error?.code ?? response.outcome}`);
    await refreshState();
    return response;
  };
  const dispatchV19 = async (command: AeSpatialGraphCommandV19, payload: Readonly<Record<string, unknown>>, expectedRevision: number | null, readbackProfile = "M3_SPATIAL_GRAPH_P5_TRANSFER"): Promise<AeSpatialGraphResponseV19> => {
    if (broker === null) throw new Error("M3 spatial P5 broker is not initialized.");
    const response = await broker.dispatch(buildSpatialGraphRequestV19({
      requestId: `m3-spatial-p5-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V19_OP_${++operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    }));
    recordResponse(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };
  const createClient = (): AeCepAdapterClientV11 => {
    if (broker === null) throw new Error("M3 spatial P5 broker is not initialized.");
    return new AeCepAdapterClientV11(broker, () => `m3-spatial-p5-v11-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
  };
  const targetPayload = (): Readonly<Record<string, unknown>> => ({
    comp: { stableId: targetStable }, layer: { stableId: layerStable }, propertyPath, keyIndex,
  });

  try {
    await mkdir(artifactDir, { recursive: true });
    await Promise.all([rm(resultPath, { force: true }), rm(projectPath, { force: true }), rm(reopenMarkerPath, { force: true }), rm(cleanupMarkerPath, { force: true })]);
    checks.accepted_p1_p4_record = (await stat(acceptedP1P4Path)).isFile();
    checks.proof_scripts_present = (await stat(reopenScriptPath)).isFile() && (await stat(cleanupScriptPath)).isFile();
    checks.afterfx_present = (await stat(afterFxPath)).isFile();

    const config = parseConfig(JSON.parse(stripUtf8Bom(await readFile(configPath, "utf8"))) as unknown);
    panelExtensionVersion = config.extensionVersion;
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 30_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);
    const firstPanel = await broker.waitForPanel(timeoutMs);
    initialSession = sessionEvidence(firstPanel);
    checks.initial_panel_negotiated_v19 = firstPanel.protocolVersion === AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19;
    checks.initial_panel_supports_v11_v19 = firstPanel.supportedProtocolVersions.includes(AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19)
      && firstPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.initial_panel_negotiated_v19 || !checks.initial_panel_supports_v11_v19) throw new Error("Spatial P5 requires authenticated protocol 1.9 with baseline 1.1 compatibility.");

    client = createClient();
    const environment = await client.probe();
    panelHostName = environment.hostName;
    panelHostVersion = environment.hostVersion;
    panelHostBuild = environment.hostBuild;
    checks.host_probe = environment.hostName === "Adobe After Effects" && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;
    baselineFilePath = baseline.project.filePath;
    checks.blank_baseline = baseline.project.itemCount === 0 && baseline.project.filePath === null;
    if (!checks.blank_baseline) throw new Error("Spatial P5 requires a blank unsaved runner-owned project baseline.");

    const source = await executeV11("comp.create", { stableId: sourceStable, name: `${prefix} Source`, width: 320, height: 180, pixelAspect: 1, duration: 2, frameRate: 24 });
    checks.source_created = source.affectedObjects.some((item) => item.stableId === sourceStable);
    const target = await executeV11("comp.create", { stableId: targetStable, name: `${prefix} Transfer Target`, width: 640, height: 360, pixelAspect: 1, duration: 2, frameRate: 24 });
    checks.target_created = target.affectedObjects.some((item) => item.stableId === targetStable);
    await executeV11("layer.add_media", { stableId: layerStable, comp: { stableId: targetStable }, item: { stableId: sourceStable } });
    await executeV11("property.set_keyframes", {
      comp: { stableId: targetStable }, layer: { stableId: layerStable }, propertyPath,
      keyframes: [
        { time: 0, value: [96, 180] },
        { time: 0.5, value: [320, 180] },
        { time: 1, value: [544, 180] },
      ],
    });

    const initialRead = await dispatchV19("property.spatial_graph.readback", targetPayload(), null, "M3_SPATIAL_GRAPH_P5_INITIAL_READ");
    const initialProperty = asRecord(spatialRecord(initialRead)?.["property"]);
    checks.initial_spatial_surface_supported = initialRead.outcome === "NO_OP" && initialProperty?.["dimensions"] === 3 && keyTimeFromResponse(initialRead) !== null;
    if (!checks.initial_spatial_surface_supported) throw new Error("Spatial P5 fixture does not expose the accepted protocol-1.9 spatial surface.");

    if (hostRevision === null) throw new Error("Host revision unavailable before P5 pre-save spatial mutation.");
    const preSaveSet = await dispatchV19("property.spatial_graph.set", { ...targetPayload(), state: preSaveState }, hostRevision, "M3_SPATIAL_GRAPH_P5_STATE_BEFORE_SAVE");
    checks.pre_save_auto_bezier_applied = (preSaveSet.outcome === "APPLIED" || preSaveSet.outcome === "NO_OP") && autoStateMatches(preSaveSet, preSaveState);
    if (!checks.pre_save_auto_bezier_applied) throw new Error(`Spatial P5 could not establish distinctive auto-Bezier/roving pre-save state: ${preSaveSet.error?.code ?? preSaveSet.outcome}`);
    savedSpatialState = spatialStateFromResponse(preSaveSet);
    savedSpatialKeyTime = keyTimeFromResponse(preSaveSet);
    savedNativeLayerId = layerHostIdFromResponse(preSaveSet);
    checks.pre_save_native_layer_id = savedNativeLayerId !== null;
    checks.pre_save_state_captured = savedSpatialState !== null && savedSpatialKeyTime !== null;

    const preSaveRead = await dispatchV19("property.spatial_graph.readback", targetPayload(), null, "M3_SPATIAL_GRAPH_P5_READ_BEFORE_SAVE");
    const preSaveReadState = spatialStateFromResponse(preSaveRead);
    checks.pre_save_spatial_exact = preSaveRead.outcome === "NO_OP"
      && savedSpatialState !== null && preSaveReadState !== null && spatialStatesEqual(preSaveReadState, savedSpatialState)
      && savedSpatialKeyTime !== null && keyTimeFromResponse(preSaveRead) !== null && closeNumber(keyTimeFromResponse(preSaveRead) as number, savedSpatialKeyTime)
      && layerHostIdFromResponse(preSaveRead) === savedNativeLayerId;
    if (!checks.pre_save_spatial_exact) throw new Error("Spatial P5 pre-save spatial readback is not exact.");

    if (client === null) throw new Error("Spatial P5 client disappeared before save.");
    const preSaveObserved = await client.observe(projectId);
    state = preSaveObserved.observed;
    hostRevision = preSaveObserved.hostRevision;
    checks.pre_save_fixture_shape = preSaveObserved.project.itemCount === 2
      && preSaveObserved.project.items.some((item) => item.stableId === sourceStable && item.kind === "COMPOSITION")
      && preSaveObserved.project.items.some((item) => item.stableId === targetStable && item.kind === "COMPOSITION")
      && findLayerIndex(preSaveObserved.project, targetStable, layerStable) === 1;

    const saveResponse = await executeV11("project.save", { path: projectPath }, "M3_SPATIAL_GRAPH_P5_SAVE");
    checks.project_save_applied = saveResponse.outcome === "APPLIED" || saveResponse.outcome === "NO_OP";
    checks.saved_project_artifact = await fileExistsNonEmpty(projectPath);
    if (!checks.saved_project_artifact) throw new Error("Spatial P5 project.save did not produce a non-empty .aep artifact.");

    if (client === null) throw new Error("Spatial P5 client disappeared after save.");
    const saved = await client.observe(projectId);
    state = saved.observed;
    hostRevision = saved.hostRevision;
    savedFingerprint = saved.observed.projectFingerprint;
    savedItemCount = saved.project.itemCount;
    checks.saved_project_path_readback = saved.project.filePath !== null && sameFilesystemPath(saved.project.filePath, projectPath);
    checks.saved_fixture_shape = saved.project.itemCount === 2 && findLayerIndex(saved.project, targetStable, layerStable) === 1;
    if (!checks.saved_project_path_readback || !checks.saved_fixture_shape) throw new Error("Spatial P5 saved-project structural readback is incomplete.");

    await launchAfterFxScript(afterFxPath, reopenScriptPath);
    reopenMarker = await waitForMarker(reopenMarkerPath, "M3_SPATIAL_GRAPH_P5_REOPEN", timeoutMs);
    checks.reopen_script_passed = reopenMarker.ok === true
      && reopenMarker["dispatcherReady"] === true
      && typeof reopenMarker["projectPath"] === "string"
      && sameFilesystemPath(reopenMarker["projectPath"] as string, projectPath)
      && reopenMarker["itemCount"] === savedItemCount;
    if (!checks.reopen_script_passed) throw new Error(`Spatial P5 reopen proof failed: ${reopenMarker.error ?? "invalid marker"}`);

    if (initialSession === null) throw new Error("Spatial P5 initial session evidence is missing.");
    const firstSessionId = initialSession.sessionId;
    await broker.stop();
    await sleep(300);
    const reboundPort = await broker.start();
    if (reboundPort !== config.port) throw new Error(`CEP broker rebound unexpected port ${reboundPort}.`);
    const secondPanel = await broker.waitForPanel(timeoutMs);
    reconnectedSession = sessionEvidence(secondPanel);
    checks.authenticated_reconnect = secondPanel.sessionId !== firstSessionId
      && secondPanel.protocolVersion === AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19
      && secondPanel.supportedProtocolVersions.includes(AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19)
      && secondPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)
      && secondPanel.extensionId === config.extensionId
      && secondPanel.extensionVersion === config.extensionVersion;
    if (!checks.authenticated_reconnect) throw new Error("Spatial P5 did not establish a distinct authenticated protocol-1.9 CEP session after reopen.");

    client = createClient();
    const reconnectedEnvironment = await client.probe();
    checks.post_reconnect_host_probe = reconnectedEnvironment.hostName === "Adobe After Effects" && reconnectedEnvironment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;
    const reopened = await client.observe(projectId);
    state = reopened.observed;
    hostRevision = reopened.hostRevision;
    checks.reopened_project_path = reopened.project.filePath !== null && sameFilesystemPath(reopened.project.filePath, projectPath);
    checks.reopened_item_count_preserved = savedItemCount !== null && reopened.project.itemCount === savedItemCount;
    checks.reopened_stable_fixture = reopened.project.items.some((item) => item.stableId === sourceStable && item.kind === "COMPOSITION")
      && reopened.project.items.some((item) => item.stableId === targetStable && item.kind === "COMPOSITION")
      && findLayerIndex(reopened.project, targetStable, layerStable) === 1;
    checks.saved_structural_fingerprint_preserved = savedFingerprint !== null && reopened.observed.projectFingerprint === savedFingerprint;

    const postReconnectRead = await dispatchV19("property.spatial_graph.readback", targetPayload(), null, "M3_SPATIAL_GRAPH_P5_POST_RECONNECT_READ");
    const postReconnectObserved = spatialStateFromResponse(postReconnectRead);
    reopenedNativeLayerId = layerHostIdFromResponse(postReconnectRead);
    checks.native_layer_id_preserved = savedNativeLayerId !== null && reopenedNativeLayerId === savedNativeLayerId;
    checks.spatial_exact_after_reopen_reconnect = postReconnectRead.outcome === "NO_OP"
      && savedSpatialState !== null && postReconnectObserved !== null && spatialStatesEqual(postReconnectObserved, savedSpatialState)
      && savedSpatialKeyTime !== null && keyTimeFromResponse(postReconnectRead) !== null && closeNumber(keyTimeFromResponse(postReconnectRead) as number, savedSpatialKeyTime)
      && checks.native_layer_id_preserved === true;
    if (!checks.spatial_exact_after_reopen_reconnect) throw new Error("Spatial P5 spatial state or native layer identity changed across save/reopen/reconnect.");

    if (hostRevision === null) throw new Error("Host revision unavailable before P5 post-reconnect spatial mutation.");
    const postReconnectSet = await dispatchV19("property.spatial_graph.set", { ...targetPayload(), state: postReconnectState }, hostRevision, "M3_SPATIAL_GRAPH_P5_POST_RECONNECT_MUTATION");
    checks.post_reconnect_mutation_applied = (postReconnectSet.outcome === "APPLIED" || postReconnectSet.outcome === "NO_OP") && manualStateMatches(postReconnectSet, postReconnectState);
    if (!checks.post_reconnect_mutation_applied) throw new Error(`Spatial P5 post-reconnect mutation failed: ${postReconnectSet.error?.code ?? postReconnectSet.outcome}`);
    const postMutationRead = await dispatchV19("property.spatial_graph.readback", targetPayload(), null, "M3_SPATIAL_GRAPH_P5_POST_RECONNECT_READBACK");
    checks.post_reconnect_mutation_readback = postMutationRead.outcome === "NO_OP"
      && manualStateMatches(postMutationRead, postReconnectState)
      && layerHostIdFromResponse(postMutationRead) === savedNativeLayerId;
    if (!checks.post_reconnect_mutation_readback) throw new Error("Spatial P5 fresh post-reconnect write/readback authority was not exact.");

    await launchAfterFxScript(afterFxPath, cleanupScriptPath);
    cleanupMarker = await waitForMarker(cleanupMarkerPath, "M3_SPATIAL_GRAPH_P5_CLEANUP", timeoutMs);
    checks.proof_cleanup_script_passed = cleanupMarker.ok === true
      && cleanupMarker["proofPrefix"] === prefix
      && cleanupMarker["blankItemCount"] === 0
      && typeof cleanupMarker["retainedProjectPath"] === "string"
      && sameFilesystemPath(cleanupMarker["retainedProjectPath"] as string, projectPath);
    checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);

    if (client === null) throw new Error("Spatial P5 client disappeared before final cleanup verification.");
    const final = await client.observe(projectId);
    checks.cleanup_blank_project = final.project.itemCount === (baselineItemCount ?? 0) && final.project.filePath === baselineFilePath;
    checks.cleanup_fingerprint_restored = baselineFingerprint !== null && final.observed.projectFingerprint === baselineFingerprint;
    cleanupComplete = checks.proof_cleanup_script_passed === true
      && checks.saved_project_retained_after_cleanup === true
      && checks.cleanup_blank_project === true
      && checks.cleanup_fingerprint_restored === true;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    if (!cleanupComplete && broker !== null) {
      try {
        await launchAfterFxScript(afterFxPath, cleanupScriptPath);
        const recovery = await waitForMarker(cleanupMarkerPath, "M3_SPATIAL_GRAPH_P5_CLEANUP", Math.min(timeoutMs, 30_000));
        if (recovery.ok) {
          cleanupMarker = recovery;
          checks.proof_cleanup_script_passed = true;
          checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);
          if (client !== null && broker.isStarted) {
            try {
              const final = await client.observe(projectId);
              checks.cleanup_blank_project = final.project.itemCount === (baselineItemCount ?? 0) && final.project.filePath === baselineFilePath;
              checks.cleanup_fingerprint_restored = baselineFingerprint !== null && final.observed.projectFingerprint === baselineFingerprint;
              cleanupComplete = checks.proof_cleanup_script_passed === true
                && checks.saved_project_retained_after_cleanup === true
                && checks.cleanup_blank_project === true
                && checks.cleanup_fingerprint_restored === true;
            } catch (error) { cleanupErrors.push(`cleanup final observe: ${error instanceof Error ? error.message : String(error)}`); }
          }
        } else cleanupErrors.push(`proof cleanup: ${recovery.error ?? "cleanup marker reported failure"}`);
      } catch (error) { cleanupErrors.push(`proof cleanup: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (broker !== null) {
      try { await broker.stop(); } catch (error) { cleanupErrors.push(`broker stop: ${error instanceof Error ? error.message : String(error)}`); }
    }

    const ok = failureError === null
      && checks.accepted_p1_p4_record === true
      && checks.proof_scripts_present === true
      && checks.afterfx_present === true
      && checks.initial_panel_negotiated_v19 === true
      && checks.initial_panel_supports_v11_v19 === true
      && checks.host_probe === true
      && checks.blank_baseline === true
      && checks.source_created === true
      && checks.target_created === true
      && checks.initial_spatial_surface_supported === true
      && checks.pre_save_auto_bezier_applied === true
      && checks.pre_save_native_layer_id === true
      && checks.pre_save_state_captured === true
      && checks.pre_save_spatial_exact === true
      && checks.pre_save_fixture_shape === true
      && checks.project_save_applied === true
      && checks.saved_project_artifact === true
      && checks.saved_project_path_readback === true
      && checks.saved_fixture_shape === true
      && checks.reopen_script_passed === true
      && checks.authenticated_reconnect === true
      && checks.post_reconnect_host_probe === true
      && checks.reopened_project_path === true
      && checks.reopened_item_count_preserved === true
      && checks.reopened_stable_fixture === true
      && checks.saved_structural_fingerprint_preserved === true
      && checks.native_layer_id_preserved === true
      && checks.spatial_exact_after_reopen_reconnect === true
      && checks.post_reconnect_mutation_applied === true
      && checks.post_reconnect_mutation_readback === true
      && checks.proof_cleanup_script_passed === true
      && checks.saved_project_retained_after_cleanup === true
      && checks.cleanup_blank_project === true
      && checks.cleanup_fingerprint_restored === true
      && cleanupComplete;

    await writeJson(resultPath, {
      schemaVersion: 1,
      proofId: "M3_SPATIAL_GRAPH_P5_REAL_AE",
      protocolVersion: AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19,
      status: ok ? "ACCEPTED" : "FAILURE",
      ok,
      startedAt,
      completedAt: new Date().toISOString(),
      provenance: {
        P1_P4_acceptance: "proofs/diagnostics/m3-spatial-graph-p1-p4-acceptance.json",
        P1_P2_run: 34182897797,
        P1_P2_artifact: 10039524832,
        P3_P4_source: "0c297200af3563d2f714d61a2df718af81cd1d4c",
        P3_P4_run: 34184591197,
        P3_P4_artifact: 10070526495,
        P3_P4_acceptance: "proofs/diagnostics/m3-spatial-graph-p3-p4-run1-acceptance.md",
      },
      proofLevels: {
        P1_validation_rejection: "accepted-baseline-not-replayed",
        P2_structural_readback: "accepted-baseline-not-replayed",
        P3_visual_proof: "accepted-baseline-not-replayed",
        P4_failure_injection_rollback: "accepted-baseline-not-replayed",
        P5_save_reopen_reconnect_transfer: ok,
      },
      checks,
      panel: { hostName: panelHostName, hostVersion: panelHostVersion, hostBuild: panelHostBuild, extensionVersion: panelExtensionVersion, initialSession, reconnectedSession },
      fixture: { prefix, sourceStable, targetStable, layerStable, propertyPath, keyIndex, preSaveState, postReconnectState, savedSpatialKeyTime, savedNativeLayerId, reopenedNativeLayerId },
      baseline: { projectFingerprint: baselineFingerprint, itemCount: baselineItemCount, filePath: baselineFilePath },
      saved: { projectFingerprint: savedFingerprint, itemCount: savedItemCount, projectPath, spatialState: savedSpatialState },
      artifacts: { savedProject: projectPath, reopenMarker: reopenMarkerPath, cleanupMarker: cleanupMarkerPath },
      reopenMarker,
      cleanupMarker,
      responses,
      cleanupComplete,
      cleanupErrors,
      failureError,
      notes: [
        "P5 is gated by the independent protocol-1.9 P1-P4 acceptance record and deliberately does not replay those earlier maturity tranches.",
        "The disposable Position fixture saves a distinctive AUTO_BEZIER + Continuous + Roving spatial state and captures the host-shaped tangents and native After Effects Layer.id before save.",
        "After Effects reopens only the fixed runner-owned .aep, reloads the additive protocol-1.9 dispatcher, and the broker restarts so a distinct authenticated CEP session is mandatory.",
        "Post-reconnect readback must preserve the exact spatial state, key time, stable fixture identity, structural fingerprint, and native Layer.id before any new mutation.",
        "A fresh post-reconnect manual tangent mutation plus exact readback proves transferred protocol-1.9 spatial write/readback authority.",
        "The saved .aep remains as retained P5 evidence while proof-only cleanup returns the live runner to the original blank unsaved fingerprint.",
      ],
      limitations: [
        "This P5 tranche proves transfer for the accepted protocol-1.9 spatial Graph Editor envelope on the exercised Position fixture.",
        "It does not extend the protocol to arbitrary custom plugin curve editors or non-spatial properties.",
      ],
    });
    if (!ok) process.exitCode = 1;
  }
};

await main();
