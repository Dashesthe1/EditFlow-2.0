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
  AE_PARENTING_PROTOCOL_VERSION_V14,
  type AeParentingCommandV14,
  type AeParentingResponseV14,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_4.js";
import { buildParentingRequestV14 } from "../../../packages/adapters/ae-cep/src/m3-parenting.js";
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

type PointMap = Readonly<Record<"topLeft" | "topRight" | "bottomRight" | "bottomLeft" | "center", readonly number[]>>;

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
      || !supported.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise both required parenting 1.4 and baseline 1.1 protocols.");
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

const parentingRecord = (response: AeParentingResponseV14): Record<string, unknown> | null =>
  nestedRecord(response.readback, "parenting");

const objectRef = (record: Record<string, unknown> | null, key: string): Record<string, unknown> | null =>
  record === null ? null : asRecord(record[key]);

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

const numericPoint = (value: unknown): readonly number[] | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  if (value.some((item) => typeof item !== "number" || !Number.isFinite(item))) return null;
  return value as number[];
};

const geometryPoints = (parenting: Record<string, unknown> | null): PointMap | null => {
  if (parenting === null) return null;
  const geometry = asRecord(parenting["compSpaceGeometry"]);
  if (geometry?.["supported"] !== true) return null;
  const points = asRecord(geometry["points"]);
  if (points === null) return null;
  const topLeft = numericPoint(points["topLeft"]);
  const topRight = numericPoint(points["topRight"]);
  const bottomRight = numericPoint(points["bottomRight"]);
  const bottomLeft = numericPoint(points["bottomLeft"]);
  const center = numericPoint(points["center"]);
  if (!topLeft || !topRight || !bottomRight || !bottomLeft || !center) return null;
  return { topLeft, topRight, bottomRight, bottomLeft, center };
};

const pointsClose = (left: readonly number[], right: readonly number[], tolerance = 0.05): boolean =>
  left.length === right.length && left.every((value, index) => Math.abs(value - right[index]!) <= tolerance);

const geometryClose = (left: PointMap | null, right: PointMap | null, tolerance = 0.05): boolean => {
  if (left === null || right === null) return false;
  return (Object.keys(left) as Array<keyof PointMap>).every((key) => pointsClose(left[key], right[key], tolerance));
};

const parentingMatches = (
  parenting: Record<string, unknown> | null,
  childStableId: string,
  parentStableId: string | null,
): boolean => parenting !== null
  && objectRef(parenting, "layer")?.["stableId"] === childStableId
  && parenting["hasParent"] === (parentStableId !== null)
  && (parentStableId === null
    ? parenting["parentLayer"] === null
    : objectRef(parenting, "parentLayer")?.["stableId"] === parentStableId);

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const afterFxPath = requireArgument("--afterfx-path");
  const reopenScriptPath = requireArgument("--reopen-script");
  const cleanupScriptPath = requireArgument("--cleanup-script");
  const timeoutMs = Number(argument("--timeout-ms") ?? "120000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const artifactDir = path.dirname(resultPath);
  const projectPath = path.join(artifactDir, "m3-parenting-p5-transfer.aep");
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
  let initialSession: SessionEvidence | null = null;
  let reconnectedSession: SessionEvidence | null = null;
  let panelHostName: string | null = null;
  let panelHostVersion: string | null = null;
  let panelHostBuild: string | null = null;
  let panelExtensionVersion: string | null = null;
  let preSaveParenting: Record<string, unknown> | null = null;
  let afterReconnectParenting: Record<string, unknown> | null = null;
  let afterClearParenting: Record<string, unknown> | null = null;
  let afterReparentParenting: Record<string, unknown> | null = null;
  let reopenMarker: ProofMarker | null = null;
  let cleanupMarker: ProofMarker | null = null;
  let operationCounter = 0;
  let requestCounter = 0;

  const projectId = "m3-parenting-p5-real-ae";
  const prefix = `M3_PARENTING_P5_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const parentLayerStable = `${prefix}_PARENT_LAYER`;
  const childLayerStable = `${prefix}_CHILD_LAYER`;
  const parentTransform = Object.freeze({ position: [205, 355], scale: [82, 82], rotation: -31, opacity: 0 });
  const childTransform = Object.freeze({ position: [610, 165], scale: [130, 65], rotation: 18, opacity: 100 });

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

  const recordV14 = (response: AeParentingResponseV14): void => {
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
    if (client === null) throw new Error("M3 parenting P5 client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
  };

  const executeV11 = async (
    command: AeAdapterPublicCommandV11,
    payload: Readonly<Record<string, unknown>>,
    readbackProfile = "M3_PARENTING_P5_TRANSFER",
  ): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M3 parenting P5 client state is not initialized.");
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

  const dispatchV14 = async (
    command: AeParentingCommandV14,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_PARENTING_P5_TRANSFER",
  ): Promise<AeParentingResponseV14> => {
    if (broker === null) throw new Error("M3 parenting P5 broker is not initialized.");
    operationCounter += 1;
    const request = buildParentingRequestV14({
      requestId: `m3-parenting-p5-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V14_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    });
    const response = await broker.dispatch(request);
    recordV14(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const createClient = (): AeCepAdapterClientV11 => {
    if (broker === null) throw new Error("M3 parenting P5 broker is not initialized.");
    return new AeCepAdapterClientV11(
      broker,
      () => `m3-parenting-p5-v11-${++requestCounter}`,
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
      supportedProtocolVersions: [AE_PARENTING_PROTOCOL_VERSION_V14, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    const firstPanel = await broker.waitForPanel(timeoutMs);
    initialSession = sessionEvidence(firstPanel);
    checks.initial_panel_negotiated_v14 = firstPanel.protocolVersion === AE_PARENTING_PROTOCOL_VERSION_V14;
    checks.initial_panel_supports_v11_v14 = firstPanel.supportedProtocolVersions.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      && firstPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.initial_panel_negotiated_v14 || !checks.initial_panel_supports_v11_v14) {
      throw new Error("M3 parenting P5 requires an authenticated panel session negotiated at protocol 1.4 with 1.1 compatibility.");
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
    if (!checks.blank_baseline) throw new Error("M3 parenting P5 requires the isolated runner-owned AE process to begin with a blank unsaved project.");

    const sourceComp = await executeV11("comp.create", {
      stableId: sourceStable,
      name: `${prefix} Source 480x240`,
      width: 480,
      height: 240,
      pixelAspect: 1,
      duration: 2,
      frameRate: 30,
    });
    checks.source_comp_created = sourceComp.affectedObjects.some((item) => item.stableId === sourceStable);

    const targetComp = await executeV11("comp.create", {
      stableId: targetStable,
      name: `${prefix} Target 960x540`,
      width: 960,
      height: 540,
      pixelAspect: 1,
      duration: 2,
      frameRate: 30,
    });
    checks.target_comp_created = targetComp.affectedObjects.some((item) => item.stableId === targetStable);

    await executeV11("layer.add_media", {
      stableId: parentLayerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    await executeV11("layer.add_media", {
      stableId: childLayerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    await executeV11("layer.set_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: parentLayerStable },
      values: parentTransform,
    });
    await executeV11("layer.set_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
      values: childTransform,
    });

    if (client === null) throw new Error("M3 parenting P5 client disappeared after fixture creation.");
    const fixture = await client.observe(projectId);
    state = fixture.observed;
    hostRevision = fixture.hostRevision;
    const parentIndex = findLayerIndex(fixture.project, targetStable, parentLayerStable);
    const childIndex = findLayerIndex(fixture.project, targetStable, childLayerStable);
    checks.two_layers_created = parentIndex !== null && childIndex !== null && parentIndex !== childIndex;
    if (!checks.two_layers_created) throw new Error("M3 parenting P5 fixture did not create two distinct stable layers.");

    const initialRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, null);
    const initialParenting = parentingRecord(initialRead);
    const initialGeometry = geometryPoints(initialParenting);
    checks.initial_unparented_geometry = initialRead.outcome === "NO_OP"
      && parentingMatches(initialParenting, childLayerStable, null)
      && initialGeometry !== null;
    if (!checks.initial_unparented_geometry) throw new Error("M3 parenting P5 initial unparented geometry is unavailable.");

    const initialSet = await dispatchV14("layer.set_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
      parentLayer: { stableId: parentLayerStable },
    }, hostRevision);
    preSaveParenting = parentingRecord(initialSet);
    checks.initial_parent_applied = initialSet.outcome === "APPLIED"
      && parentingMatches(preSaveParenting, childLayerStable, parentLayerStable);
    checks.initial_parent_geometry_preserved = geometryClose(initialGeometry, geometryPoints(preSaveParenting));
    if (!checks.initial_parent_applied || !checks.initial_parent_geometry_preserved) {
      throw new Error("M3 parenting P5 initial preserve-transform parenting failed before save.");
    }

    await refreshState();
    const preSaveRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, null);
    preSaveParenting = parentingRecord(preSaveRead);
    checks.pre_save_parenting_exact = preSaveRead.outcome === "NO_OP"
      && parentingMatches(preSaveParenting, childLayerStable, parentLayerStable)
      && geometryClose(initialGeometry, geometryPoints(preSaveParenting));
    if (!checks.pre_save_parenting_exact) throw new Error("M3 parenting P5 pre-save parenting readback is not exact.");

    await refreshState();
    const saveResponse = await executeV11("project.save", { path: projectPath }, "M3_PARENTING_P5_SAVE");
    checks.project_save_applied = saveResponse.outcome === "APPLIED" || saveResponse.outcome === "NO_OP";
    checks.saved_project_artifact = await fileExistsNonEmpty(projectPath);
    if (!checks.saved_project_artifact) throw new Error("M3 parenting P5 project.save did not produce a non-empty .aep artifact.");

    if (client === null) throw new Error("M3 parenting P5 client disappeared after save.");
    const saved = await client.observe(projectId);
    state = saved.observed;
    hostRevision = saved.hostRevision;
    savedFingerprint = saved.observed.projectFingerprint;
    checks.saved_project_path_readback = saved.project.filePath !== null && sameFilesystemPath(saved.project.filePath, projectPath);
    checks.saved_fixture_shape = saved.project.itemCount === 2
      && saved.project.items.some((item) => item.stableId === sourceStable && item.kind === "COMPOSITION")
      && saved.project.items.some((item) => item.stableId === targetStable && item.kind === "COMPOSITION")
      && findLayerIndex(saved.project, targetStable, parentLayerStable) === parentIndex
      && findLayerIndex(saved.project, targetStable, childLayerStable) === childIndex;
    if (!checks.saved_project_path_readback || !checks.saved_fixture_shape) {
      throw new Error("M3 parenting P5 saved-project structural readback is incomplete.");
    }

    await launchAfterFxScript(afterFxPath, reopenScriptPath);
    reopenMarker = await waitForMarker(reopenMarkerPath, "M3_PARENTING_P5_REOPEN", timeoutMs);
    checks.reopen_script_passed = reopenMarker.ok === true
      && reopenMarker["dispatcherReady"] === true
      && typeof reopenMarker["projectPath"] === "string"
      && sameFilesystemPath(reopenMarker["projectPath"], projectPath)
      && reopenMarker["itemCount"] === 2;
    if (!checks.reopen_script_passed) throw new Error(`M3 parenting P5 reopen proof failed: ${reopenMarker.error ?? "invalid marker"}`);

    const firstSessionId = initialSession.sessionId;
    await broker.stop();
    await sleep(300);
    const reboundPort = await broker.start();
    if (reboundPort !== config.port) throw new Error(`CEP broker rebound unexpected port ${reboundPort}.`);
    const secondPanel = await broker.waitForPanel(timeoutMs);
    reconnectedSession = sessionEvidence(secondPanel);
    checks.authenticated_reconnect = secondPanel.sessionId !== firstSessionId
      && secondPanel.protocolVersion === AE_PARENTING_PROTOCOL_VERSION_V14
      && secondPanel.supportedProtocolVersions.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      && secondPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)
      && secondPanel.extensionId === config.extensionId
      && secondPanel.extensionVersion === config.extensionVersion;
    if (!checks.authenticated_reconnect) throw new Error("M3 parenting P5 did not establish a distinct authenticated CEP session after reopen.");

    client = createClient();
    const reconnectedEnvironment = await client.probe();
    checks.post_reconnect_host_probe = reconnectedEnvironment.hostName === "Adobe After Effects"
      && reconnectedEnvironment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;
    const reopened = await client.observe(projectId);
    state = reopened.observed;
    hostRevision = reopened.hostRevision;
    checks.reopened_project_path = reopened.project.filePath !== null && sameFilesystemPath(reopened.project.filePath, projectPath);
    const reopenedParentIndex = findLayerIndex(reopened.project, targetStable, parentLayerStable);
    const reopenedChildIndex = findLayerIndex(reopened.project, targetStable, childLayerStable);
    checks.reopened_stable_ids = reopened.project.itemCount === 2
      && reopened.project.items.some((item) => item.stableId === sourceStable)
      && reopened.project.items.some((item) => item.stableId === targetStable)
      && reopenedParentIndex !== null
      && reopenedChildIndex !== null;
    checks.reopened_layer_order_preserved = reopenedParentIndex === parentIndex && reopenedChildIndex === childIndex;
    checks.saved_structural_fingerprint_preserved = savedFingerprint !== null
      && reopened.observed.projectFingerprint === savedFingerprint;

    const postReconnectRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, null);
    afterReconnectParenting = parentingRecord(postReconnectRead);
    checks.parenting_exact_after_reopen_reconnect = postReconnectRead.outcome === "NO_OP"
      && parentingMatches(afterReconnectParenting, childLayerStable, parentLayerStable)
      && geometryClose(initialGeometry, geometryPoints(afterReconnectParenting));
    if (!checks.parenting_exact_after_reopen_reconnect) {
      throw new Error("M3 parenting P5 parent relationship or visible geometry changed across save/reopen/reconnect.");
    }

    await refreshState();
    const clearParent = await dispatchV14("layer.clear_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, hostRevision, "M3_PARENTING_P5_POST_RECONNECT_CLEAR");
    afterClearParenting = parentingRecord(clearParent);
    checks.post_reconnect_clear_applied = clearParent.outcome === "APPLIED"
      && parentingMatches(afterClearParenting, childLayerStable, null)
      && geometryClose(initialGeometry, geometryPoints(afterClearParenting));
    if (!checks.post_reconnect_clear_applied) {
      throw new Error(`M3 parenting P5 post-reconnect clear failed: ${clearParent.error?.code ?? clearParent.outcome}`);
    }

    await refreshState();
    const reparent = await dispatchV14("layer.set_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
      parentLayer: { stableId: parentLayerStable },
    }, hostRevision, "M3_PARENTING_P5_POST_RECONNECT_REPARENT");
    afterReparentParenting = parentingRecord(reparent);
    checks.post_reconnect_reparent_applied = reparent.outcome === "APPLIED"
      && parentingMatches(afterReparentParenting, childLayerStable, parentLayerStable)
      && geometryClose(initialGeometry, geometryPoints(afterReparentParenting));
    if (!checks.post_reconnect_reparent_applied) {
      throw new Error(`M3 parenting P5 post-reconnect re-parent failed: ${reparent.error?.code ?? reparent.outcome}`);
    }

    const postMutationRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, null);
    afterReparentParenting = parentingRecord(postMutationRead);
    checks.post_reconnect_mutation_readback = postMutationRead.outcome === "NO_OP"
      && parentingMatches(afterReparentParenting, childLayerStable, parentLayerStable)
      && geometryClose(initialGeometry, geometryPoints(afterReparentParenting));
    if (!checks.post_reconnect_mutation_readback) {
      throw new Error("M3 parenting P5 post-reconnect parenting mutations did not read back exactly.");
    }

    const postMutationState = await client.observe(projectId);
    checks.layer_order_survived_post_reconnect_mutations = findLayerIndex(postMutationState.project, targetStable, parentLayerStable) === parentIndex
      && findLayerIndex(postMutationState.project, targetStable, childLayerStable) === childIndex;

    await rm(cleanupMarkerPath, { force: true });
    await launchAfterFxScript(afterFxPath, cleanupScriptPath);
    cleanupMarker = await waitForMarker(cleanupMarkerPath, "M3_PARENTING_P5_CLEANUP", timeoutMs);
    checks.proof_cleanup_script_passed = cleanupMarker.ok === true
      && cleanupMarker["proofPrefix"] === prefix
      && cleanupMarker["blankItemCount"] === 0
      && typeof cleanupMarker["retainedProjectPath"] === "string"
      && sameFilesystemPath(cleanupMarker["retainedProjectPath"], projectPath);
    checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);

    if (client === null) throw new Error("M3 parenting P5 client disappeared before final cleanup verification.");
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
        const recoveryCleanup = await waitForMarker(cleanupMarkerPath, "M3_PARENTING_P5_CLEANUP", Math.min(timeoutMs, 30_000));
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
      && checks.initial_panel_negotiated_v14 === true
      && checks.initial_panel_supports_v11_v14 === true
      && checks.host_probe === true
      && checks.blank_baseline === true
      && checks.source_comp_created === true
      && checks.target_comp_created === true
      && checks.two_layers_created === true
      && checks.initial_unparented_geometry === true
      && checks.initial_parent_applied === true
      && checks.initial_parent_geometry_preserved === true
      && checks.pre_save_parenting_exact === true
      && checks.project_save_applied === true
      && checks.saved_project_artifact === true
      && checks.saved_project_path_readback === true
      && checks.saved_fixture_shape === true
      && checks.reopen_script_passed === true
      && checks.authenticated_reconnect === true
      && checks.post_reconnect_host_probe === true
      && checks.reopened_project_path === true
      && checks.reopened_stable_ids === true
      && checks.reopened_layer_order_preserved === true
      && checks.saved_structural_fingerprint_preserved === true
      && checks.parenting_exact_after_reopen_reconnect === true
      && checks.post_reconnect_clear_applied === true
      && checks.post_reconnect_reparent_applied === true
      && checks.post_reconnect_mutation_readback === true
      && checks.layer_order_survived_post_reconnect_mutations === true
      && checks.proof_cleanup_script_passed === true
      && checks.saved_project_retained_after_cleanup === true
      && checks.cleanup_blank_project === true
      && checks.cleanup_fingerprint_restored === true;

    await writeJson(resultPath, {
      proofId: "M3_PARENTING_P5_REAL_AE",
      status: ok ? "ACCEPTED" : "FAILURE",
      ok,
      startedAt,
      completedAt: new Date().toISOString(),
      acceptedBaseline: {
        mainMergeCommit: "a2d4acf47668f47d18fce86ccce60ed52674cab2",
        p3p4RealAeRun: 34084958343,
        p3p4Acceptance: "proofs/diagnostics/m3-parenting-p3-p4-run7-acceptance.md",
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
      transferFixture: {
        sourceComp: { stableId: sourceStable, width: 480, height: 240 },
        targetComp: { stableId: targetStable, width: 960, height: 540 },
        parentLayer: { stableId: parentLayerStable, transform: parentTransform },
        childLayer: { stableId: childLayerStable, transform: childTransform },
      },
      artifacts: {
        savedProject: projectPath,
        reopenMarker: reopenMarkerPath,
        cleanupMarker: cleanupMarkerPath,
      },
      readback: {
        preSaveParenting,
        afterReconnectParenting,
        afterClearParenting,
        afterReparentParenting,
      },
      responses,
      reopenMarker,
      cleanupMarker,
      failureError,
      cleanupErrors,
      cleanupComplete,
      notes: [
        "P5 starts from the merged M3 parenting P3/P4 accepted baseline and deliberately does not replay P1-P4 maturity evidence.",
        "The P5 fixture is materially different from P3: 480x240 source into a 960x540 target at 30 fps with different parent/child transforms and a different geometry envelope.",
        "The project is saved through the public v1.1 project.save capability under the artifact-directory filesystem policy.",
        "After Effects closes and reopens the fixed runner-owned .aep, reloads the current dispatcher, and the loopback broker is stopped/restarted so the CEP panel must establish a distinct authenticated protocol 1.4 session.",
        "Stable parent/child identities, layer order, structural fingerprint, exact child->parent relationship, and five-point visible geometry are checked after reopen/reconnect.",
        "Fresh post-reconnect clear, re-parent, and readback prove transferred authority for all three protocol 1.4 parenting commands while preserving five-point geometry.",
        "The saved .aep is retained as P5 evidence; proof-only cleanup discards only the verified disposable project and the harness re-observes the original blank structural fingerprint.",
      ],
    });
  }
};

main().catch(async (error) => {
  const resultPath = argument("--result");
  if (resultPath) {
    try {
      await writeJson(resultPath, {
        proofId: "M3_PARENTING_P5_REAL_AE",
        status: "HARNESS_FAILURE",
        ok: false,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
        cleanupComplete: false,
      });
    } catch (_) {}
  }
  console.error(error);
  process.exitCode = 1;
});
