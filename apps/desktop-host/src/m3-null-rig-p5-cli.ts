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
import {
  AE_NULL_RIG_PROTOCOL_VERSION_V15,
  type AeNullRigCommandV15,
  type AeNullRigResponseV15,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_5.js";
import { buildNullRigRequestV15 } from "../../../packages/adapters/ae-cep/src/m3-null-rig.js";
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
      || !supported.includes(AE_NULL_RIG_PROTOCOL_VERSION_V15)
      || !supported.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise null-rig 1.5, parenting 1.4, and baseline 1.1 protocols.");
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

const nullRigRecord = (response: AeNullRigResponseV15): Record<string, unknown> | null =>
  nestedRecord(response.readback, "nullRig");

const parentingRecord = (response: AeParentingResponseV14): Record<string, unknown> | null =>
  nestedRecord(response.readback, "parenting");

const objectRef = (record: Record<string, unknown> | null, key: string): Record<string, unknown> | null =>
  record === null ? null : asRecord(record[key]);

const childStableIds = (rig: Record<string, unknown> | null): readonly string[] => {
  if (rig === null || !Array.isArray(rig["children"])) return [];
  return (rig["children"] as unknown[])
    .map((child) => asRecord(child)?.["stableId"])
    .filter((stableId): stableId is string => typeof stableId === "string");
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

const geometryMoved = (left: PointMap | null, right: PointMap | null, threshold = 24): boolean => {
  if (left === null || right === null) return false;
  let maximum = 0;
  for (const key of Object.keys(left) as Array<keyof PointMap>) {
    const a = left[key];
    const b = right[key];
    const dx = (a[0] ?? 0) - (b[0] ?? 0);
    const dy = (a[1] ?? 0) - (b[1] ?? 0);
    maximum = Math.max(maximum, Math.sqrt(dx * dx + dy * dy));
  }
  return maximum >= threshold;
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

const rigSemanticSnapshot = (rig: Record<string, unknown> | null): Readonly<Record<string, unknown>> | null => {
  if (rig === null) return null;
  const layer = objectRef(rig, "layer");
  const parentLayer = objectRef(rig, "parentLayer");
  const transform = asRecord(rig["transform"]);
  return {
    stableId: layer?.["stableId"] ?? null,
    name: layer?.["name"] ?? null,
    index: layer?.["index"] ?? null,
    isNull: rig["isNull"] ?? null,
    threeDLayer: rig["threeDLayer"] ?? null,
    enabled: rig["enabled"] ?? null,
    parentStableId: parentLayer?.["stableId"] ?? null,
    children: [...childStableIds(rig)],
    transform,
  };
};

const stableJson = (value: unknown): string => JSON.stringify(value);

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const afterFxPath = requireArgument("--afterfx-path");
  const reopenScriptPath = requireArgument("--reopen-script");
  const cleanupScriptPath = requireArgument("--cleanup-script");
  const timeoutMs = Number(argument("--timeout-ms") ?? "120000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const artifactDir = path.dirname(resultPath);
  const projectPath = path.join(artifactDir, "m3-null-rig-p5-transfer.aep");
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
  let coreFingerprintAfterTransferredRemove: string | null = null;
  let initialSession: SessionEvidence | null = null;
  let reconnectedSession: SessionEvidence | null = null;
  let panelHostName: string | null = null;
  let panelHostVersion: string | null = null;
  let panelHostBuild: string | null = null;
  let panelExtensionVersion: string | null = null;
  let preSaveRigReadback: Record<string, unknown> | null = null;
  let afterReconnectRigReadback: Record<string, unknown> | null = null;
  let preSaveParenting: Record<string, unknown> | null = null;
  let afterReconnectParenting: Record<string, unknown> | null = null;
  let afterDetachParenting: Record<string, unknown> | null = null;
  let freshRigReadback: Record<string, unknown> | null = null;
  let reopenMarker: ProofMarker | null = null;
  let cleanupMarker: ProofMarker | null = null;
  let operationCounter = 0;
  let requestCounter = 0;

  const projectId = "m3-null-rig-p5-real-ae";
  const prefix = `M3_NULL_RIG_P5_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const childLayerStable = `${prefix}_CHILD_LAYER`;
  const rigStable = `${prefix}_RIG_MAIN`;
  const freshRigStable = `${prefix}_RIG_POST_RECONNECT`;
  const rigName = `${prefix} Transfer Control`;
  const freshRigName = `${prefix} Fresh Reconnect Control`;
  const childTransform = Object.freeze({ position: [590, 170], scale: [115, 75], rotation: 14, opacity: 100 });
  const drivenRigTransform = Object.freeze({ position: [410, 290], scale: [88, 88], rotation: -19, opacity: 0 });

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

  const recordV15 = (response: AeNullRigResponseV15): void => {
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
    if (client === null) throw new Error("M3 null-rig P5 client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
  };

  const executeV11 = async (
    command: AeAdapterPublicCommandV11,
    payload: Readonly<Record<string, unknown>>,
    readbackProfile = "M3_NULL_RIG_P5_TRANSFER",
  ): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M3 null-rig P5 client state is not initialized.");
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
    readbackProfile = "M3_NULL_RIG_P5_PARENTING",
  ): Promise<AeParentingResponseV14> => {
    if (broker === null) throw new Error("M3 null-rig P5 broker is not initialized.");
    operationCounter += 1;
    const response = await broker.dispatch(buildParentingRequestV14({
      requestId: `m3-null-rig-p5-parent-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V14_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    }));
    recordV14(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const dispatchV15 = async (
    command: AeNullRigCommandV15,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_NULL_RIG_P5_TRANSFER",
  ): Promise<AeNullRigResponseV15> => {
    if (broker === null) throw new Error("M3 null-rig P5 broker is not initialized.");
    operationCounter += 1;
    const response = await broker.dispatch(buildNullRigRequestV15({
      requestId: `m3-null-rig-p5-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V15_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    }));
    recordV15(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const createClient = (): AeCepAdapterClientV11 => {
    if (broker === null) throw new Error("M3 null-rig P5 broker is not initialized.");
    return new AeCepAdapterClientV11(
      broker,
      () => `m3-null-rig-p5-v11-${++requestCounter}`,
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
      supportedProtocolVersions: [AE_NULL_RIG_PROTOCOL_VERSION_V15, AE_PARENTING_PROTOCOL_VERSION_V14, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    const firstPanel = await broker.waitForPanel(timeoutMs);
    initialSession = sessionEvidence(firstPanel);
    checks.initial_panel_negotiated_v15 = firstPanel.protocolVersion === AE_NULL_RIG_PROTOCOL_VERSION_V15;
    checks.initial_panel_supports_v11_v14_v15 = firstPanel.supportedProtocolVersions.includes(AE_NULL_RIG_PROTOCOL_VERSION_V15)
      && firstPanel.supportedProtocolVersions.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      && firstPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.initial_panel_negotiated_v15 || !checks.initial_panel_supports_v11_v14_v15) {
      throw new Error("M3 null-rig P5 requires an authenticated panel session negotiated at protocol 1.5 with 1.4 and 1.1 compatibility.");
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
    if (!checks.blank_baseline) throw new Error("M3 null-rig P5 requires the isolated runner-owned AE process to begin with a blank unsaved project.");

    const sourceComp = await executeV11("comp.create", {
      stableId: sourceStable,
      name: `${prefix} Source 420x220`,
      width: 420,
      height: 220,
      pixelAspect: 1,
      duration: 2,
      frameRate: 30,
    });
    checks.source_comp_created = sourceComp.affectedObjects.some((item) => item.stableId === sourceStable);

    const targetComp = await executeV11("comp.create", {
      stableId: targetStable,
      name: `${prefix} Target 900x500`,
      width: 900,
      height: 500,
      pixelAspect: 1,
      duration: 2,
      frameRate: 30,
    });
    checks.target_comp_created = targetComp.affectedObjects.some((item) => item.stableId === targetStable);

    await executeV11("layer.add_media", {
      stableId: childLayerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    await executeV11("layer.set_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
      values: childTransform,
    });

    const createRig = await dispatchV15("rig.null.create", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable, name: rigName },
      threeDLayer: false,
    }, hostRevision, "M3_NULL_RIG_P5_CREATE_BEFORE_SAVE");
    const createdRig = nullRigRecord(createRig);
    checks.main_true_null_created = createRig.outcome === "APPLIED"
      && objectRef(createdRig, "layer")?.["stableId"] === rigStable
      && objectRef(createdRig, "layer")?.["name"] === rigName
      && createdRig?.["isNull"] === true
      && createdRig?.["threeDLayer"] === false
      && childStableIds(createdRig).length === 0;
    if (!checks.main_true_null_created) throw new Error("M3 null-rig P5 could not create the pre-save managed true null.");

    await refreshState();
    const initialParentRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, null, "M3_NULL_RIG_P5_INITIAL_PARENTING");
    const initialParenting = parentingRecord(initialParentRead);
    const initialGeometry = geometryPoints(initialParenting);
    checks.initial_unparented_geometry = initialParentRead.outcome === "NO_OP"
      && parentingMatches(initialParenting, childLayerStable, null)
      && initialGeometry !== null;
    if (!checks.initial_unparented_geometry) throw new Error("M3 null-rig P5 initial child geometry is unavailable.");

    const attach = await dispatchV14("layer.set_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
      parentLayer: { stableId: rigStable },
    }, hostRevision, "M3_NULL_RIG_P5_ATTACH_BEFORE_SAVE");
    const attachedParenting = parentingRecord(attach);
    checks.initial_attach_applied = attach.outcome === "APPLIED"
      && parentingMatches(attachedParenting, childLayerStable, rigStable);
    checks.initial_attach_no_jump = geometryClose(initialGeometry, geometryPoints(attachedParenting));
    if (!checks.initial_attach_applied || !checks.initial_attach_no_jump) {
      throw new Error("M3 null-rig P5 initial preserve-transform attachment failed.");
    }

    await refreshState();
    await executeV11("layer.set_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: rigStable },
      values: drivenRigTransform,
    }, "M3_NULL_RIG_P5_DRIVE_BEFORE_SAVE");

    const drivenParentRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, null, "M3_NULL_RIG_P5_DRIVEN_PARENTING");
    preSaveParenting = parentingRecord(drivenParentRead);
    const drivenGeometry = geometryPoints(preSaveParenting);
    checks.pre_save_controller_geometry_moved = drivenParentRead.outcome === "NO_OP"
      && parentingMatches(preSaveParenting, childLayerStable, rigStable)
      && geometryMoved(initialGeometry, drivenGeometry);
    if (!checks.pre_save_controller_geometry_moved) {
      throw new Error("M3 null-rig P5 controller transform did not materially drive the visible child before save.");
    }

    const preSaveRigRead = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable },
    }, null, "M3_NULL_RIG_P5_READ_BEFORE_SAVE");
    preSaveRigReadback = nullRigRecord(preSaveRigRead);
    checks.pre_save_true_null_topology = preSaveRigRead.outcome === "NO_OP"
      && preSaveRigReadback?.["isNull"] === true
      && objectRef(preSaveRigReadback, "layer")?.["stableId"] === rigStable
      && childStableIds(preSaveRigReadback).length === 1
      && childStableIds(preSaveRigReadback)[0] === childLayerStable;
    if (!checks.pre_save_true_null_topology) throw new Error("M3 null-rig P5 pre-save true-null topology readback is not exact.");

    if (client === null) throw new Error("M3 null-rig P5 client disappeared before save.");
    const preSave = await client.observe(projectId);
    state = preSave.observed;
    hostRevision = preSave.hostRevision;
    const preSaveRigIndex = findLayerIndex(preSave.project, targetStable, rigStable);
    const preSaveChildIndex = findLayerIndex(preSave.project, targetStable, childLayerStable);
    checks.pre_save_stable_layers_present = preSaveRigIndex !== null && preSaveChildIndex !== null && preSaveRigIndex !== preSaveChildIndex;

    const saveResponse = await executeV11("project.save", { path: projectPath }, "M3_NULL_RIG_P5_SAVE");
    checks.project_save_applied = saveResponse.outcome === "APPLIED" || saveResponse.outcome === "NO_OP";
    checks.saved_project_artifact = await fileExistsNonEmpty(projectPath);
    if (!checks.saved_project_artifact) throw new Error("M3 null-rig P5 project.save did not produce a non-empty .aep artifact.");

    if (client === null) throw new Error("M3 null-rig P5 client disappeared after save.");
    const saved = await client.observe(projectId);
    state = saved.observed;
    hostRevision = saved.hostRevision;
    savedFingerprint = saved.observed.projectFingerprint;
    savedItemCount = saved.project.itemCount;
    checks.saved_project_path_readback = saved.project.filePath !== null && sameFilesystemPath(saved.project.filePath, projectPath);
    checks.saved_fixture_shape = saved.project.itemCount > 2
      && saved.project.items.some((item) => item.stableId === sourceStable && item.kind === "COMPOSITION")
      && saved.project.items.some((item) => item.stableId === targetStable && item.kind === "COMPOSITION")
      && findLayerIndex(saved.project, targetStable, rigStable) === preSaveRigIndex
      && findLayerIndex(saved.project, targetStable, childLayerStable) === preSaveChildIndex;
    if (!checks.saved_project_path_readback || !checks.saved_fixture_shape) {
      throw new Error("M3 null-rig P5 saved-project structural readback is incomplete or missing the managed null backing project item.");
    }

    await launchAfterFxScript(afterFxPath, reopenScriptPath);
    reopenMarker = await waitForMarker(reopenMarkerPath, "M3_NULL_RIG_P5_REOPEN", timeoutMs);
    checks.reopen_script_passed = reopenMarker.ok === true
      && reopenMarker["dispatcherReady"] === true
      && typeof reopenMarker["projectPath"] === "string"
      && sameFilesystemPath(reopenMarker["projectPath"], projectPath)
      && reopenMarker["itemCount"] === savedItemCount;
    if (!checks.reopen_script_passed) throw new Error(`M3 null-rig P5 reopen proof failed: ${reopenMarker.error ?? "invalid marker"}`);

    const firstSessionId = initialSession.sessionId;
    await broker.stop();
    await sleep(300);
    const reboundPort = await broker.start();
    if (reboundPort !== config.port) throw new Error(`CEP broker rebound unexpected port ${reboundPort}.`);
    const secondPanel = await broker.waitForPanel(timeoutMs);
    reconnectedSession = sessionEvidence(secondPanel);
    checks.authenticated_reconnect = secondPanel.sessionId !== firstSessionId
      && secondPanel.protocolVersion === AE_NULL_RIG_PROTOCOL_VERSION_V15
      && secondPanel.supportedProtocolVersions.includes(AE_NULL_RIG_PROTOCOL_VERSION_V15)
      && secondPanel.supportedProtocolVersions.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      && secondPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)
      && secondPanel.extensionId === config.extensionId
      && secondPanel.extensionVersion === config.extensionVersion;
    if (!checks.authenticated_reconnect) throw new Error("M3 null-rig P5 did not establish a distinct authenticated protocol 1.5 CEP session after reopen.");

    client = createClient();
    const reconnectedEnvironment = await client.probe();
    checks.post_reconnect_host_probe = reconnectedEnvironment.hostName === "Adobe After Effects"
      && reconnectedEnvironment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;
    const reopened = await client.observe(projectId);
    state = reopened.observed;
    hostRevision = reopened.hostRevision;
    checks.reopened_project_path = reopened.project.filePath !== null && sameFilesystemPath(reopened.project.filePath, projectPath);
    checks.reopened_item_count_preserved = savedItemCount !== null && reopened.project.itemCount === savedItemCount;
    checks.reopened_stable_layers = findLayerIndex(reopened.project, targetStable, rigStable) === preSaveRigIndex
      && findLayerIndex(reopened.project, targetStable, childLayerStable) === preSaveChildIndex;
    checks.saved_structural_fingerprint_preserved = savedFingerprint !== null
      && reopened.observed.projectFingerprint === savedFingerprint;

    const postReconnectRigRead = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable },
    }, null, "M3_NULL_RIG_P5_POST_RECONNECT_READ");
    afterReconnectRigReadback = nullRigRecord(postReconnectRigRead);
    checks.null_rig_exact_after_reopen_reconnect = postReconnectRigRead.outcome === "NO_OP"
      && afterReconnectRigReadback?.["isNull"] === true
      && stableJson(rigSemanticSnapshot(afterReconnectRigReadback)) === stableJson(rigSemanticSnapshot(preSaveRigReadback));
    if (!checks.null_rig_exact_after_reopen_reconnect) {
      throw new Error("M3 null-rig P5 managed true-null identity, transform, or topology changed across save/reopen/reconnect.");
    }

    const postReconnectParentRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, null, "M3_NULL_RIG_P5_POST_RECONNECT_PARENTING");
    afterReconnectParenting = parentingRecord(postReconnectParentRead);
    checks.parenting_exact_after_reopen_reconnect = postReconnectParentRead.outcome === "NO_OP"
      && parentingMatches(afterReconnectParenting, childLayerStable, rigStable)
      && geometryClose(drivenGeometry, geometryPoints(afterReconnectParenting));
    if (!checks.parenting_exact_after_reopen_reconnect) {
      throw new Error("M3 null-rig P5 child topology or visible geometry changed across save/reopen/reconnect.");
    }

    await refreshState();
    const detach = await dispatchV14("layer.clear_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, hostRevision, "M3_NULL_RIG_P5_POST_RECONNECT_DETACH");
    afterDetachParenting = parentingRecord(detach);
    checks.post_reconnect_detach_applied = detach.outcome === "APPLIED"
      && parentingMatches(afterDetachParenting, childLayerStable, null)
      && geometryClose(drivenGeometry, geometryPoints(afterDetachParenting));
    if (!checks.post_reconnect_detach_applied) {
      throw new Error(`M3 null-rig P5 post-reconnect preserve-transform detach failed: ${detach.error?.code ?? detach.outcome}`);
    }

    await refreshState();
    const removeTransferredRig = await dispatchV15("rig.null.remove", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable },
    }, hostRevision, "M3_NULL_RIG_P5_POST_RECONNECT_REMOVE_TRANSFERRED");
    const transferredRemoval = nullRigRecord(removeTransferredRig);
    checks.post_reconnect_transferred_remove_applied = removeTransferredRig.outcome === "APPLIED"
      && transferredRemoval?.["removed"] === true
      && transferredRemoval?.["stableId"] === rigStable;
    if (!checks.post_reconnect_transferred_remove_applied) {
      throw new Error(`M3 null-rig P5 could not remove the transferred rig after reconnect: ${removeTransferredRig.error?.code ?? removeTransferredRig.outcome}`);
    }

    await refreshState();
    const afterTransferredRemove = await client.observe(projectId);
    state = afterTransferredRemove.observed;
    hostRevision = afterTransferredRemove.hostRevision;
    coreFingerprintAfterTransferredRemove = afterTransferredRemove.observed.projectFingerprint;
    checks.transferred_remove_reclaims_owned_source = afterTransferredRemove.project.itemCount === 2
      && findLayerIndex(afterTransferredRemove.project, targetStable, rigStable) === null
      && findLayerIndex(afterTransferredRemove.project, targetStable, childLayerStable) !== null;
    if (!checks.transferred_remove_reclaims_owned_source) {
      throw new Error("M3 null-rig P5 transferred remove left the rig layer, owned SolidSource/support item, or lost the core child fixture.");
    }

    const transferredAbsentRead = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable },
    }, null, "M3_NULL_RIG_P5_POST_REMOVE_ABSENCE");
    checks.transferred_rig_absent_readback = transferredAbsentRead.outcome === "REJECTED"
      && transferredAbsentRead.error?.code === "NULL_RIG_NOT_FOUND";

    const freshCreate = await dispatchV15("rig.null.create", {
      comp: { stableId: targetStable },
      rig: { stableId: freshRigStable, name: freshRigName },
      threeDLayer: false,
    }, hostRevision, "M3_NULL_RIG_P5_FRESH_POST_RECONNECT_CREATE");
    const freshCreatedRig = nullRigRecord(freshCreate);
    checks.fresh_post_reconnect_create_applied = freshCreate.outcome === "APPLIED"
      && objectRef(freshCreatedRig, "layer")?.["stableId"] === freshRigStable
      && objectRef(freshCreatedRig, "layer")?.["name"] === freshRigName
      && freshCreatedRig?.["isNull"] === true
      && childStableIds(freshCreatedRig).length === 0;
    if (!checks.fresh_post_reconnect_create_applied) {
      throw new Error(`M3 null-rig P5 fresh post-reconnect create failed: ${freshCreate.error?.code ?? freshCreate.outcome}`);
    }

    const freshRead = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetStable },
      rig: { stableId: freshRigStable },
    }, null, "M3_NULL_RIG_P5_FRESH_POST_RECONNECT_READ");
    freshRigReadback = nullRigRecord(freshRead);
    checks.fresh_post_reconnect_readback_exact = freshRead.outcome === "NO_OP"
      && freshRigReadback?.["isNull"] === true
      && objectRef(freshRigReadback, "layer")?.["stableId"] === freshRigStable
      && childStableIds(freshRigReadback).length === 0;

    await refreshState();
    const freshRemove = await dispatchV15("rig.null.remove", {
      comp: { stableId: targetStable },
      rig: { stableId: freshRigStable },
    }, hostRevision, "M3_NULL_RIG_P5_FRESH_POST_RECONNECT_REMOVE");
    const freshRemoval = nullRigRecord(freshRemove);
    checks.fresh_post_reconnect_remove_applied = freshRemove.outcome === "APPLIED"
      && freshRemoval?.["removed"] === true
      && freshRemoval?.["stableId"] === freshRigStable;

    await refreshState();
    const freshAbsentRead = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetStable },
      rig: { stableId: freshRigStable },
    }, null, "M3_NULL_RIG_P5_FRESH_POST_REMOVE_ABSENCE");
    checks.fresh_post_reconnect_absent_readback = freshAbsentRead.outcome === "REJECTED"
      && freshAbsentRead.error?.code === "NULL_RIG_NOT_FOUND";

    const postMutationState = await client.observe(projectId);
    state = postMutationState.observed;
    hostRevision = postMutationState.hostRevision;
    checks.post_reconnect_mutation_readback = checks.fresh_post_reconnect_create_applied === true
      && checks.fresh_post_reconnect_readback_exact === true
      && checks.fresh_post_reconnect_remove_applied === true
      && checks.fresh_post_reconnect_absent_readback === true
      && postMutationState.project.itemCount === 2
      && findLayerIndex(postMutationState.project, targetStable, rigStable) === null
      && findLayerIndex(postMutationState.project, targetStable, freshRigStable) === null
      && findLayerIndex(postMutationState.project, targetStable, childLayerStable) !== null
      && coreFingerprintAfterTransferredRemove !== null
      && postMutationState.observed.projectFingerprint === coreFingerprintAfterTransferredRemove;
    if (!checks.post_reconnect_mutation_readback) {
      throw new Error("M3 null-rig P5 fresh post-reconnect create/readback/remove did not restore the exact two-composition core fingerprint.");
    }

    await rm(cleanupMarkerPath, { force: true });
    await launchAfterFxScript(afterFxPath, cleanupScriptPath);
    cleanupMarker = await waitForMarker(cleanupMarkerPath, "M3_NULL_RIG_P5_CLEANUP", timeoutMs);
    checks.proof_cleanup_script_passed = cleanupMarker.ok === true
      && cleanupMarker["proofPrefix"] === prefix
      && cleanupMarker["blankItemCount"] === 0
      && cleanupMarker["verifiedFinalProjectItemCount"] === 2
      && typeof cleanupMarker["retainedProjectPath"] === "string"
      && sameFilesystemPath(cleanupMarker["retainedProjectPath"], projectPath);
    checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);

    if (client === null) throw new Error("M3 null-rig P5 client disappeared before final cleanup verification.");
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
        const recoveryCleanup = await waitForMarker(cleanupMarkerPath, "M3_NULL_RIG_P5_CLEANUP", Math.min(timeoutMs, 30_000));
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
      && checks.initial_panel_negotiated_v15 === true
      && checks.initial_panel_supports_v11_v14_v15 === true
      && checks.host_probe === true
      && checks.blank_baseline === true
      && checks.source_comp_created === true
      && checks.target_comp_created === true
      && checks.main_true_null_created === true
      && checks.initial_unparented_geometry === true
      && checks.initial_attach_applied === true
      && checks.initial_attach_no_jump === true
      && checks.pre_save_controller_geometry_moved === true
      && checks.pre_save_true_null_topology === true
      && checks.pre_save_stable_layers_present === true
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
      && checks.null_rig_exact_after_reopen_reconnect === true
      && checks.parenting_exact_after_reopen_reconnect === true
      && checks.post_reconnect_detach_applied === true
      && checks.post_reconnect_transferred_remove_applied === true
      && checks.transferred_remove_reclaims_owned_source === true
      && checks.transferred_rig_absent_readback === true
      && checks.fresh_post_reconnect_create_applied === true
      && checks.fresh_post_reconnect_readback_exact === true
      && checks.fresh_post_reconnect_remove_applied === true
      && checks.fresh_post_reconnect_absent_readback === true
      && checks.post_reconnect_mutation_readback === true
      && checks.proof_cleanup_script_passed === true
      && checks.saved_project_retained_after_cleanup === true
      && checks.cleanup_blank_project === true
      && checks.cleanup_fingerprint_restored === true;

    await writeJson(resultPath, {
      proofId: "M3_NULL_RIG_P5_REAL_AE",
      status: ok ? "ACCEPTED" : "FAILURE",
      ok,
      startedAt,
      completedAt: new Date().toISOString(),
      acceptedBaseline: {
        nullRigParentCommit: "09cb3e88eaba3dfbb365f3341e8a847b0f147dc1",
        p3p4RealAeRun: 34140788458,
        p3p4Acceptance: "proofs/diagnostics/m3-null-rig-p3-p4-run1-acceptance.md",
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
        sourceComp: { stableId: sourceStable, width: 420, height: 220 },
        targetComp: { stableId: targetStable, width: 900, height: 500 },
        childLayer: { stableId: childLayerStable, transform: childTransform },
        mainRig: { stableId: rigStable, name: rigName, drivenTransform: drivenRigTransform },
        freshReconnectRig: { stableId: freshRigStable, name: freshRigName },
      },
      artifacts: {
        savedProject: projectPath,
        reopenMarker: reopenMarkerPath,
        cleanupMarker: cleanupMarkerPath,
      },
      readback: {
        preSaveRig: preSaveRigReadback,
        afterReconnectRig: afterReconnectRigReadback,
        preSaveParenting,
        afterReconnectParenting,
        afterDetachParenting,
        freshRig: freshRigReadback,
      },
      savedItemCount,
      responses,
      reopenMarker,
      cleanupMarker,
      failureError,
      cleanupErrors,
      cleanupComplete,
      notes: [
        "P5 starts from the accepted managed null-rig P1-P4 parent commit and deliberately does not replay earlier maturity evidence.",
        "The P5 fixture is materially different from P3: a 420x220 source composition drives a 900x500 target at 30 fps with a new child transform and a different null-controller transform.",
        "The visible child is attached to a true managed null before save, the invisible controller is materially transformed, and exact true-null identity/topology plus five-point child geometry are checked after save/reopen/reconnect.",
        "The saved project is reopened through a fixed proof-only script that reloads the additive protocol-1.5 host dispatcher; the broker is stopped/restarted so the panel must establish a distinct authenticated protocol 1.5 session.",
        "Fresh post-reconnect authority detaches the transferred child, removes the transferred null, proves its owned SolidSource/support project items are reclaimed, then creates/readbacks/removes a second managed null and restores the exact two-composition core fingerprint.",
        "The saved .aep is retained as transfer evidence; proof-only cleanup refuses broad disposal unless no managed null layer/source/support item remains and then restores a blank unsaved baseline.",
      ],
    });
    if (!ok) process.exitCode = 1;
  }
};

main().catch(async (error) => {
  const resultPath = argument("--result");
  if (resultPath) {
    try {
      await writeJson(resultPath, {
        proofId: "M3_NULL_RIG_P5_REAL_AE",
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
