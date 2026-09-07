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
  AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17,
  type AeTemporalInterpolationCommandV17,
  type AeTemporalInterpolationResponseV17,
  type AeTemporalInterpolationStateV17,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_7.js";
import { buildTemporalInterpolationRequestV17 } from "../../../packages/adapters/ae-cep/src/m3-temporal-interpolation.js";
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
      || !supported.includes(AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise required temporal-interpolation 1.7 and baseline 1.1 protocols.");
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

const temporalRecord = (response: AeTemporalInterpolationResponseV17): Record<string, unknown> | null =>
  nestedRecord(response.readback, "temporalInterpolation");

const temporalState = (response: AeTemporalInterpolationResponseV17): Record<string, unknown> | null => {
  const temporal = temporalRecord(response);
  return temporal === null ? null : asRecord(temporal["state"]);
};

const supportedTypes = (response: AeTemporalInterpolationResponseV17): Record<string, unknown> | null => {
  const temporal = temporalRecord(response);
  return temporal === null ? null : asRecord(temporal["supportedInterpolationTypes"]);
};

const stateMatches = (response: AeTemporalInterpolationResponseV17, expected: AeTemporalInterpolationStateV17): boolean => {
  const state = temporalState(response);
  return state !== null
    && state["inType"] === expected.inType
    && state["outType"] === expected.outType
    && state["temporalContinuous"] === expected.temporalContinuous
    && state["temporalAutoBezier"] === expected.temporalAutoBezier;
};

const keyIdentityMatches = (response: AeTemporalInterpolationResponseV17, keyIndex: number, keyTime: number): boolean => {
  const temporal = temporalRecord(response);
  return temporal?.["keyIndex"] === keyIndex
    && typeof temporal["keyTime"] === "number"
    && Math.abs((temporal["keyTime"] as number) - keyTime) < 0.000001;
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

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const projectPath = path.join(artifactDir, "m3-temporal-interpolation-p5-transfer.aep");
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
  let operationCounter = 0;
  let requestCounter = 0;

  const projectId = "m3-temporal-interpolation-p5-real-ae";
  const prefix = `M3_TEMPORAL_P5_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layerStable = `${prefix}_LAYER`;
  const propertyPath = ["ADBE Transform Group", "ADBE Opacity"] as const;
  const keyIndex = 2;
  const keyTime = 0.5;
  const preSaveState: AeTemporalInterpolationStateV17 = Object.freeze({
    inType: "BEZIER",
    outType: "BEZIER",
    temporalContinuous: true,
    temporalAutoBezier: true,
  });
  const postReconnectState: AeTemporalInterpolationStateV17 = Object.freeze({
    inType: "HOLD",
    outType: "LINEAR",
    temporalContinuous: false,
    temporalAutoBezier: false,
  });

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

  const recordV17 = (response: AeTemporalInterpolationResponseV17): void => {
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
    if (client === null) throw new Error("M3 temporal-interpolation P5 client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
  };

  const executeV11 = async (
    command: AeAdapterPublicCommandV11,
    payload: Readonly<Record<string, unknown>>,
    readbackProfile = "M3_TEMPORAL_INTERPOLATION_P5_TRANSFER",
  ): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M3 temporal-interpolation P5 client state is not initialized.");
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

  const dispatchV17 = async (
    command: AeTemporalInterpolationCommandV17,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_TEMPORAL_INTERPOLATION_P5_TRANSFER",
  ): Promise<AeTemporalInterpolationResponseV17> => {
    if (broker === null) throw new Error("M3 temporal-interpolation P5 broker is not initialized.");
    operationCounter += 1;
    const response = await broker.dispatch(buildTemporalInterpolationRequestV17({
      requestId: `m3-temporal-p5-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V17_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    }));
    recordV17(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const createClient = (): AeCepAdapterClientV11 => {
    if (broker === null) throw new Error("M3 temporal-interpolation P5 broker is not initialized.");
    return new AeCepAdapterClientV11(
      broker,
      () => `m3-temporal-p5-v11-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );
  };

  const targetPayload = (): Readonly<Record<string, unknown>> => ({
    comp: { stableId: targetStable },
    layer: { stableId: layerStable },
    propertyPath,
    keyIndex,
  });

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
      supportedProtocolVersions: [AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    const firstPanel = await broker.waitForPanel(timeoutMs);
    initialSession = sessionEvidence(firstPanel);
    checks.initial_panel_negotiated_v17 = firstPanel.protocolVersion === AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17;
    checks.initial_panel_supports_v11_v17 = firstPanel.supportedProtocolVersions.includes(AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17)
      && firstPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.initial_panel_negotiated_v17 || !checks.initial_panel_supports_v11_v17) {
      throw new Error("M3 temporal-interpolation P5 requires an authenticated panel session negotiated at protocol 1.7 with baseline 1.1 compatibility.");
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
    if (!checks.blank_baseline) throw new Error("M3 temporal-interpolation P5 requires a blank unsaved runner-owned project baseline.");

    const source = await executeV11("comp.create", {
      stableId: sourceStable,
      name: `${prefix} Source`,
      width: 320,
      height: 180,
      pixelAspect: 1,
      duration: 2,
      frameRate: 24,
    });
    checks.source_created = source.affectedObjects.some((item) => item.stableId === sourceStable);

    const target = await executeV11("comp.create", {
      stableId: targetStable,
      name: `${prefix} Transfer Target`,
      width: 640,
      height: 360,
      pixelAspect: 1,
      duration: 2,
      frameRate: 24,
    });
    checks.target_created = target.affectedObjects.some((item) => item.stableId === targetStable);

    await executeV11("layer.add_media", {
      stableId: layerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    await executeV11("property.set_keyframes", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      propertyPath,
      keyframes: [
        { time: 0, value: 10 },
        { time: keyTime, value: 90 },
        { time: 1, value: 30 },
      ],
    });

    const initialRead = await dispatchV17("property.temporal_interpolation.readback", targetPayload(), null, "M3_TEMPORAL_INTERPOLATION_P5_INITIAL_READ");
    const support = supportedTypes(initialRead);
    checks.initial_temporal_surface_supported = initialRead.outcome === "NO_OP"
      && keyIdentityMatches(initialRead, keyIndex, keyTime)
      && support?.["LINEAR"] === true
      && support?.["BEZIER"] === true
      && support?.["HOLD"] === true;
    if (!checks.initial_temporal_surface_supported) {
      throw new Error("M3 temporal-interpolation P5 fixture does not expose the complete accepted protocol-1.7 temporal surface.");
    }

    if (hostRevision === null) throw new Error("Host revision unavailable before P5 pre-save temporal mutation.");
    const preSaveSet = await dispatchV17("property.temporal_interpolation.set", {
      ...targetPayload(),
      interpolation: preSaveState,
    }, hostRevision, "M3_TEMPORAL_INTERPOLATION_P5_STATE_BEFORE_SAVE");
    checks.pre_save_temporal_state_applied = preSaveSet.outcome === "APPLIED"
      && stateMatches(preSaveSet, preSaveState)
      && keyIdentityMatches(preSaveSet, keyIndex, keyTime);
    if (!checks.pre_save_temporal_state_applied) {
      throw new Error(`M3 temporal-interpolation P5 could not establish the distinctive pre-save state: ${preSaveSet.error?.code ?? preSaveSet.outcome}`);
    }

    const preSaveRead = await dispatchV17("property.temporal_interpolation.readback", targetPayload(), null, "M3_TEMPORAL_INTERPOLATION_P5_READ_BEFORE_SAVE");
    checks.pre_save_temporal_exact = preSaveRead.outcome === "NO_OP"
      && stateMatches(preSaveRead, preSaveState)
      && keyIdentityMatches(preSaveRead, keyIndex, keyTime);
    if (!checks.pre_save_temporal_exact) throw new Error("M3 temporal-interpolation P5 pre-save temporal readback is not exact.");

    if (client === null) throw new Error("M3 temporal-interpolation P5 client disappeared before save.");
    const preSaveObserved = await client.observe(projectId);
    state = preSaveObserved.observed;
    hostRevision = preSaveObserved.hostRevision;
    checks.pre_save_fixture_shape = preSaveObserved.project.itemCount === 2
      && preSaveObserved.project.items.some((item) => item.stableId === sourceStable && item.kind === "COMPOSITION")
      && preSaveObserved.project.items.some((item) => item.stableId === targetStable && item.kind === "COMPOSITION")
      && findLayerIndex(preSaveObserved.project, targetStable, layerStable) === 1;

    const saveResponse = await executeV11("project.save", { path: projectPath }, "M3_TEMPORAL_INTERPOLATION_P5_SAVE");
    checks.project_save_applied = saveResponse.outcome === "APPLIED" || saveResponse.outcome === "NO_OP";
    checks.saved_project_artifact = await fileExistsNonEmpty(projectPath);
    if (!checks.saved_project_artifact) throw new Error("M3 temporal-interpolation P5 project.save did not produce a non-empty .aep artifact.");

    if (client === null) throw new Error("M3 temporal-interpolation P5 client disappeared after save.");
    const saved = await client.observe(projectId);
    state = saved.observed;
    hostRevision = saved.hostRevision;
    savedFingerprint = saved.observed.projectFingerprint;
    savedItemCount = saved.project.itemCount;
    checks.saved_project_path_readback = saved.project.filePath !== null && sameFilesystemPath(saved.project.filePath, projectPath);
    checks.saved_fixture_shape = saved.project.itemCount === 2
      && saved.project.items.some((item) => item.stableId === sourceStable && item.kind === "COMPOSITION")
      && saved.project.items.some((item) => item.stableId === targetStable && item.kind === "COMPOSITION")
      && findLayerIndex(saved.project, targetStable, layerStable) === 1;
    if (!checks.saved_project_path_readback || !checks.saved_fixture_shape) {
      throw new Error("M3 temporal-interpolation P5 saved-project structural readback is incomplete.");
    }

    await launchAfterFxScript(afterFxPath, reopenScriptPath);
    reopenMarker = await waitForMarker(reopenMarkerPath, "M3_TEMPORAL_INTERPOLATION_P5_REOPEN", timeoutMs);
    checks.reopen_script_passed = reopenMarker.ok === true
      && reopenMarker["dispatcherReady"] === true
      && typeof reopenMarker["projectPath"] === "string"
      && sameFilesystemPath(reopenMarker["projectPath"] as string, projectPath)
      && reopenMarker["itemCount"] === savedItemCount;
    if (!checks.reopen_script_passed) {
      throw new Error(`M3 temporal-interpolation P5 reopen proof failed: ${reopenMarker.error ?? "invalid marker"}`);
    }

    if (initialSession === null) throw new Error("M3 temporal-interpolation P5 initial CEP session evidence is missing.");
    const firstSessionId = initialSession.sessionId;
    await broker.stop();
    await sleep(300);
    const reboundPort = await broker.start();
    if (reboundPort !== config.port) throw new Error(`CEP broker rebound unexpected port ${reboundPort}.`);
    const secondPanel = await broker.waitForPanel(timeoutMs);
    reconnectedSession = sessionEvidence(secondPanel);
    checks.authenticated_reconnect = secondPanel.sessionId !== firstSessionId
      && secondPanel.protocolVersion === AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17
      && secondPanel.supportedProtocolVersions.includes(AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17)
      && secondPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)
      && secondPanel.extensionId === config.extensionId
      && secondPanel.extensionVersion === config.extensionVersion;
    if (!checks.authenticated_reconnect) {
      throw new Error("M3 temporal-interpolation P5 did not establish a distinct authenticated protocol-1.7 CEP session after reopen.");
    }

    client = createClient();
    const reconnectedEnvironment = await client.probe();
    checks.post_reconnect_host_probe = reconnectedEnvironment.hostName === "Adobe After Effects"
      && reconnectedEnvironment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const reopened = await client.observe(projectId);
    state = reopened.observed;
    hostRevision = reopened.hostRevision;
    checks.reopened_project_path = reopened.project.filePath !== null && sameFilesystemPath(reopened.project.filePath, projectPath);
    checks.reopened_item_count_preserved = savedItemCount !== null && reopened.project.itemCount === savedItemCount;
    checks.reopened_stable_fixture = reopened.project.items.some((item) => item.stableId === sourceStable && item.kind === "COMPOSITION")
      && reopened.project.items.some((item) => item.stableId === targetStable && item.kind === "COMPOSITION")
      && findLayerIndex(reopened.project, targetStable, layerStable) === 1;
    checks.saved_structural_fingerprint_preserved = savedFingerprint !== null
      && reopened.observed.projectFingerprint === savedFingerprint;

    const postReconnectRead = await dispatchV17("property.temporal_interpolation.readback", targetPayload(), null, "M3_TEMPORAL_INTERPOLATION_P5_POST_RECONNECT_READ");
    checks.temporal_exact_after_reopen_reconnect = postReconnectRead.outcome === "NO_OP"
      && stateMatches(postReconnectRead, preSaveState)
      && keyIdentityMatches(postReconnectRead, keyIndex, keyTime);
    if (!checks.temporal_exact_after_reopen_reconnect) {
      throw new Error("M3 temporal-interpolation P5 temporal state changed across save/reopen/reconnect.");
    }

    if (hostRevision === null) throw new Error("Host revision unavailable before P5 post-reconnect temporal mutation.");
    const postReconnectSet = await dispatchV17("property.temporal_interpolation.set", {
      ...targetPayload(),
      interpolation: postReconnectState,
    }, hostRevision, "M3_TEMPORAL_INTERPOLATION_P5_POST_RECONNECT_MUTATION");
    checks.post_reconnect_mutation_applied = postReconnectSet.outcome === "APPLIED"
      && stateMatches(postReconnectSet, postReconnectState)
      && keyIdentityMatches(postReconnectSet, keyIndex, keyTime);
    if (!checks.post_reconnect_mutation_applied) {
      throw new Error(`M3 temporal-interpolation P5 post-reconnect mutation failed: ${postReconnectSet.error?.code ?? postReconnectSet.outcome}`);
    }

    const postMutationRead = await dispatchV17("property.temporal_interpolation.readback", targetPayload(), null, "M3_TEMPORAL_INTERPOLATION_P5_POST_RECONNECT_READBACK");
    checks.post_reconnect_mutation_readback = postMutationRead.outcome === "NO_OP"
      && stateMatches(postMutationRead, postReconnectState)
      && keyIdentityMatches(postMutationRead, keyIndex, keyTime);
    if (!checks.post_reconnect_mutation_readback) {
      throw new Error("M3 temporal-interpolation P5 fresh post-reconnect write/readback authority was not exact.");
    }

    await launchAfterFxScript(afterFxPath, cleanupScriptPath);
    cleanupMarker = await waitForMarker(cleanupMarkerPath, "M3_TEMPORAL_INTERPOLATION_P5_CLEANUP", timeoutMs);
    checks.proof_cleanup_script_passed = cleanupMarker.ok === true
      && cleanupMarker["proofPrefix"] === prefix
      && cleanupMarker["blankItemCount"] === 0
      && typeof cleanupMarker["retainedProjectPath"] === "string"
      && sameFilesystemPath(cleanupMarker["retainedProjectPath"] as string, projectPath);
    checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);

    if (client === null) throw new Error("M3 temporal-interpolation P5 client disappeared before final cleanup verification.");
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
    if (!cleanupComplete && broker !== null) {
      try {
        await launchAfterFxScript(afterFxPath, cleanupScriptPath);
        const recoveryCleanup = await waitForMarker(cleanupMarkerPath, "M3_TEMPORAL_INTERPOLATION_P5_CLEANUP", Math.min(timeoutMs, 30_000));
        if (recoveryCleanup.ok) {
          cleanupMarker = recoveryCleanup;
          checks.proof_cleanup_script_passed = true;
          checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);
          if (client !== null && broker.isStarted) {
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
          cleanupErrors.push(`proof cleanup: ${recoveryCleanup.error ?? "cleanup marker reported failure"}`);
        }
      } catch (error) {
        cleanupErrors.push(`proof cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (broker !== null) {
      try { await broker.stop(); }
      catch (error) { cleanupErrors.push(`broker stop: ${error instanceof Error ? error.message : String(error)}`); }
    }

    const ok = failureError === null
      && checks.proof_scripts_present === true
      && checks.afterfx_present === true
      && checks.initial_panel_negotiated_v17 === true
      && checks.initial_panel_supports_v11_v17 === true
      && checks.host_probe === true
      && checks.blank_baseline === true
      && checks.source_created === true
      && checks.target_created === true
      && checks.initial_temporal_surface_supported === true
      && checks.pre_save_temporal_state_applied === true
      && checks.pre_save_temporal_exact === true
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
      && checks.temporal_exact_after_reopen_reconnect === true
      && checks.post_reconnect_mutation_applied === true
      && checks.post_reconnect_mutation_readback === true
      && checks.proof_cleanup_script_passed === true
      && checks.saved_project_retained_after_cleanup === true
      && checks.cleanup_blank_project === true
      && checks.cleanup_fingerprint_restored === true
      && cleanupComplete;

    await writeJson(resultPath, {
      schemaVersion: 1,
      proofId: "M3_TEMPORAL_INTERPOLATION_P5_REAL_AE",
      protocolVersion: AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17,
      status: ok ? "ACCEPTED" : "FAILURE",
      ok,
      startedAt,
      completedAt: new Date().toISOString(),
      provenance: {
        baseMain: "051659452bf7d907b395fe7bc843abc9251358a3",
        P1_P2_source: "9b660195c265f35fff79616b1ae345c01aeaec78",
        P1_P2_control: "bfa22a7f6f7254325899e6b3d3b07d14b2fdadd7",
        P1_P2_run: 34163522485,
        P1_P2_job: 101869972996,
        P1_P2_artifact: 10033403065,
        P3_P4_source: "6b218bf3f6ba0014a6a78fa33769f170dc300fa3",
        P3_P4_control: "5cb3e7bd9fd1fc5cf0d6ff5c17ff7946566c9e45",
        P3_P4_run: 34166441340,
        P3_P4_job: 101878333951,
        P3_P4_artifact: 10034335983,
        P3_P4_acceptance: "proofs/diagnostics/m3-temporal-interpolation-p3-p4-run9-acceptance.md",
      },
      proofLevels: {
        P1_validation_rejection: "accepted-baseline-not-replayed",
        P2_structural_readback: "accepted-baseline-not-replayed",
        P3_visual_proof: "accepted-baseline-not-replayed",
        P4_failure_injection_rollback: "accepted-baseline-not-replayed",
        P5_save_reopen_reconnect_transfer: ok,
      },
      checks,
      panel: {
        hostName: panelHostName,
        hostVersion: panelHostVersion,
        hostBuild: panelHostBuild,
        extensionVersion: panelExtensionVersion,
        initialSession,
        reconnectedSession,
      },
      fixture: {
        prefix,
        sourceStable,
        targetStable,
        layerStable,
        propertyPath,
        keyIndex,
        keyTime,
        preSaveState,
        postReconnectState,
      },
      baseline: {
        projectFingerprint: baselineFingerprint,
        itemCount: baselineItemCount,
        filePath: baselineFilePath,
      },
      saved: {
        projectFingerprint: savedFingerprint,
        itemCount: savedItemCount,
        projectPath,
      },
      artifacts: {
        savedProject: projectPath,
        reopenMarker: reopenMarkerPath,
        cleanupMarker: cleanupMarkerPath,
      },
      reopenMarker,
      cleanupMarker,
      responses,
      cleanupComplete,
      cleanupErrors,
      failureError,
      notes: [
        "P5 starts from the accepted protocol-1.7 P1-P4 evidence and deliberately does not replay those earlier maturity tranches.",
        "The disposable Opacity fixture saves a distinctive BEZIER/BEZIER continuous auto-Bezier state through the public v1.1 project.save capability.",
        "After Effects closes and reopens only the fixed runner-owned .aep, reloads the additive protocol-1.7 dispatcher, and the loopback broker is stopped/restarted so the CEP panel must establish a distinct authenticated session.",
        "Post-reconnect readback must recover the exact saved temporal state and key identity before any new mutation.",
        "A fresh post-reconnect incoming-HOLD/outgoing-LINEAR mutation plus exact readback proves transferred protocol-1.7 write/readback authority.",
        "The saved .aep is retained as P5 evidence; proof-only cleanup discards only the exact verified disposable project and the harness re-observes the original blank structural fingerprint.",
      ],
      limitations: [
        "This P5 tranche proves transfer only for the accepted protocol-1.7 exact temporal-interpolation envelope.",
        "Numeric Graph Editor ease/influence, spatial interpolation/tangents/roving, and motion blur/frame blending remain separate roadmap tranches.",
      ],
    });

    if (!ok) process.exitCode = 1;
  }
};

await main();
