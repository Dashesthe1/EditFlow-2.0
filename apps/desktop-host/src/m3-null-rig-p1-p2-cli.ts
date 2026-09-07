import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  type AeParentingResponseV14,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_4.js";
import { buildParentingRequestV14 } from "../../../packages/adapters/ae-cep/src/m3-parenting.js";
import {
  AE_NULL_RIG_PROTOCOL_VERSION_V15,
  type AeNullRigCommandV15,
  type AeNullRigResponseV15,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_5.js";
import { buildNullRigRequestV15 } from "../../../packages/adapters/ae-cep/src/m3-null-rigs.js";
import type { ObservedProjectState } from "../../../packages/core-contracts/src/index.js";
import type { AeLayerSnapshot, AeProjectSnapshot } from "../../../packages/ae-object-model/src/index.js";
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

interface RecordedResponse {
  readonly protocolVersion: string;
  readonly command: string;
  readonly outcome: string;
  readonly error: unknown;
  readonly hostProjectRevision: number | null;
  readonly notes: readonly string[];
}

interface TransformSpec {
  readonly position: readonly number[];
  readonly scale: readonly number[];
  readonly rotation: number;
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
    throw new Error("CEP bridge config does not advertise required null-rig 1.5, geometry-witness 1.4, and baseline 1.1 protocols.");
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

const nullRecord = (response: AeNullRigResponseV15): Record<string, unknown> | null =>
  nestedRecord(response.readback, "nullLayer");

const relationshipRecord = (response: AeNullRigResponseV15): Record<string, unknown> | null =>
  nestedRecord(response.readback, "relationship");

const parentingRecord = (response: AeParentingResponseV14): Record<string, unknown> | null =>
  nestedRecord(response.readback, "parenting");

const transformReadback = (response: AeAdapterResponseV11): Record<string, unknown> | null =>
  nestedRecord(response.readback, "transform");

const objectRef = (record: Record<string, unknown> | null, key: string): Record<string, unknown> | null =>
  record === null ? null : asRecord(record[key]);

const numericVector = (record: Record<string, unknown> | null, key: string): readonly number[] | null => {
  if (record === null || !Array.isArray(record[key])) return null;
  const values = record[key] as unknown[];
  if (values.length === 0 || values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
  return values as number[];
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

const pointsClose = (left: readonly number[] | null, right: readonly number[] | null, tolerance = 0.05): boolean => {
  if (left === null || right === null || left.length !== right.length) return false;
  return left.every((value, index) => Math.abs(value - right[index]!) <= tolerance);
};

const geometryClose = (left: PointMap | null, right: PointMap | null, tolerance = 0.05): boolean => {
  if (left === null || right === null) return false;
  return (Object.keys(left) as Array<keyof PointMap>).every((key) => pointsClose(left[key], right[key], tolerance));
};

const transformMatches = (readback: Record<string, unknown> | null, expected: TransformSpec, tolerance = 0.001): boolean =>
  readback !== null
  && pointsClose(numericVector(readback, "position"), expected.position, tolerance)
  && pointsClose(numericVector(readback, "scale"), expected.scale, tolerance)
  && typeof readback["rotation"] === "number"
  && Math.abs((readback["rotation"] as number) - expected.rotation) <= tolerance;

const findLayer = (project: AeProjectSnapshot, compStableId: string, layerStableId: string): AeLayerSnapshot | null => {
  const item = project.items.find((candidate) => candidate.kind === "COMPOSITION" && candidate.stableId === compStableId);
  return item?.composition?.layers.find((layer) => layer.stableId === layerStableId) ?? null;
};

const relationshipChildStableIds = (relationship: Record<string, unknown> | null): string[] => {
  if (relationship === null || !Array.isArray(relationship["directChildren"])) return [];
  const ids: string[] = [];
  for (const child of relationship["directChildren"] as unknown[]) {
    const layer = objectRef(asRecord(child), "layer");
    if (typeof layer?.["stableId"] === "string") ids.push(layer["stableId"] as string);
  }
  return ids;
};

const sameStableIdSet = (actual: readonly string[], expected: readonly string[]): boolean => {
  if (actual.length !== expected.length) return false;
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.every((value, index) => value === right[index]);
};

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "120000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error("--timeout-ms must be at least 10000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
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
  let baselineFilePath: string | null = null;
  let nullCreateReadback: Record<string, unknown> | null = null;
  let nullTransformReadback: Record<string, unknown> | null = null;
  let boundRelationship: Record<string, unknown> | null = null;
  let unboundRelationship: Record<string, unknown> | null = null;
  const initialGeometry: Record<string, PointMap | null> = {};
  const boundGeometry: Record<string, PointMap | null> = {};
  const unboundGeometry: Record<string, PointMap | null> = {};

  const projectId = "m3-null-rig-p1-p2-real-ae";
  const prefix = `M3_NULL_RIG_P12_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const controllerStable = `${prefix}_NULL_CONTROLLER`;
  const childAStable = `${prefix}_CHILD_A`;
  const childBStable = `${prefix}_CHILD_B`;
  const childCStable = `${prefix}_CHILD_C`;
  const childStables = [childAStable, childBStable, childCStable] as const;
  const nullPosition = [365, 205] as const;
  const nullTransform: TransformSpec = Object.freeze({ position: nullPosition, scale: [118, 118], rotation: 24 });
  const childTransforms: Readonly<Record<string, TransformSpec>> = Object.freeze({
    [childAStable]: Object.freeze({ position: [170, 115], scale: [80, 120], rotation: -14 }),
    [childBStable]: Object.freeze({ position: [405, 215], scale: [130, 70], rotation: 19 }),
    [childCStable]: Object.freeze({ position: [640, 325], scale: [92, 92], rotation: 33 }),
  });
  const childTransformFor = (stableId: string): TransformSpec => {
    const transform = childTransforms[stableId];
    if (transform === undefined) throw new Error(`Missing fixed child transform for ${stableId}.`);
    return transform;
  };
  let operationCounter = 0;
  let requestCounter = 0;

  const recordV11 = (command: string, response: AeAdapterResponseV11): void => {
    responses.push({ protocolVersion: response.protocolVersion, command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision, notes: response.diagnostics.notes ?? [] });
  };
  const recordV14 = (response: AeParentingResponseV14): void => {
    responses.push({ protocolVersion: response.protocolVersion, command: response.command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision, notes: response.diagnostics.notes ?? [] });
  };
  const recordV15 = (response: AeNullRigResponseV15): void => {
    responses.push({ protocolVersion: response.protocolVersion, command: response.command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision, notes: response.diagnostics.notes });
  };

  const refreshState = async (): Promise<void> => {
    if (client === null) throw new Error("M3 null-rig setup client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
    projectSnapshot = observed.project;
  };

  const executeV11 = async (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M3 null-rig setup state is not initialized.");
    operationCounter += 1;
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_OP_${operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M3_NULL_RIG_P1_P2_SETUP",
    });
    recordV11(command, response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    }
    await refreshState();
    return response;
  };

  const dispatchV14Read = async (layerStableId: string): Promise<AeParentingResponseV14> => {
    if (broker === null) throw new Error("M3 null-rig broker is not initialized.");
    operationCounter += 1;
    const request = buildParentingRequestV14({
      requestId: `m3-null-rig-p12-v14-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V14_OP_${operationCounter}`,
      command: "layer.parenting_readback",
      expectedHostProjectRevision: null,
      payload: { comp: { stableId: targetStable }, layer: { stableId: layerStableId } },
      readbackProfile: "M3_NULL_RIG_P1_P2_GEOMETRY_WITNESS",
    });
    const response = await broker.dispatch(request);
    recordV14(response);
    return response;
  };

  const dispatchV15 = async (command: AeNullRigCommandV15, payload: Readonly<Record<string, unknown>>, expectedRevision: number | null): Promise<AeNullRigResponseV15> => {
    if (broker === null) throw new Error("M3 null-rig broker is not initialized.");
    operationCounter += 1;
    const request = buildNullRigRequestV15({
      requestId: `m3-null-rig-p12-v15-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V15_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_NULL_RIG_P1_P2_STRUCTURAL",
    });
    const response = await broker.dispatch(request);
    recordV15(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const captureChildGeometry = async (destination: Record<string, PointMap | null>): Promise<boolean> => {
    let allAvailable = true;
    for (const stableId of childStables) {
      const response = await dispatchV14Read(stableId);
      destination[stableId] = geometryPoints(parentingRecord(response));
      if (response.outcome !== "NO_OP" || destination[stableId] === null) allAvailable = false;
    }
    return allAvailable;
  };

  const cleanupComp = async (stableId: string): Promise<void> => {
    if (client === null) return;
    try {
      await refreshState();
      if (projectSnapshot === null) return;
      if (projectSnapshot.items.some((item) => item.kind === "COMPOSITION" && item.stableId === stableId)) {
        await executeV11("comp.remove", { comp: { stableId } });
      }
    } catch (error) {
      cleanupErrors.push(`${stableId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const verifyRejectedWithoutMutation = async (
    checkPrefix: string,
    invoke: (beforeRevision: number) => Promise<AeNullRigResponseV15>,
    expectedCode: string,
  ): Promise<void> => {
    if (client === null) throw new Error("M3 null-rig client is unavailable for rejection proof.");
    const before = await client.observe(projectId);
    state = before.observed;
    hostRevision = before.hostRevision;
    projectSnapshot = before.project;
    const response = await invoke(before.hostRevision);
    const after = await client.observe(projectId);
    state = after.observed;
    hostRevision = after.hostRevision;
    projectSnapshot = after.project;
    checks[`${checkPrefix}_rejected`] = response.outcome === "REJECTED" && response.error?.code === expectedCode;
    checks[`${checkPrefix}_revision_unchanged`] = response.hostProjectRevision === before.hostRevision && after.hostRevision === before.hostRevision;
    checks[`${checkPrefix}_fingerprint_unchanged`] = after.observed.projectFingerprint === before.observed.projectFingerprint;
  };

  try {
    const configText = stripUtf8Bom(await readFile(configPath, "utf8"));
    const config = parseConfig(JSON.parse(configText) as unknown);
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

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v15 = panel.protocolVersion === AE_NULL_RIG_PROTOCOL_VERSION_V15;
    checks.panel_supports_v11_v14_v15 = panel.supportedProtocolVersions.includes(AE_NULL_RIG_PROTOCOL_VERSION_V15)
      && panel.supportedProtocolVersions.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v15 || !checks.panel_supports_v11_v14_v15) throw new Error("Null-rig proof did not negotiate required protocols.");
    if (panel.extensionVersion !== config.extensionVersion) throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);

    client = new AeCepAdapterClientV11(broker, () => `m3-null-rig-setup-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects" && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    projectSnapshot = baseline.project;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;
    baselineFilePath = baseline.project.filePath;
    checks.blank_unsaved_baseline = baseline.project.itemCount === 0 && baseline.project.filePath === null;
    if (!checks.blank_unsaved_baseline) throw new Error("M3 null-rig P1/P2 proof requires the isolated self-hosted AE process to begin with a blank unsaved project.");

    await executeV11("comp.create", { stableId: sourceStable, name: `${prefix} Source 300x180`, width: 300, height: 180, pixelAspect: 1, duration: 2, frameRate: 30 });
    await executeV11("comp.create", { stableId: targetStable, name: `${prefix} Target 800x450`, width: 800, height: 450, pixelAspect: 1, duration: 2, frameRate: 30 });

    for (const stableId of childStables) {
      const childTransform = childTransformFor(stableId);
      await executeV11("layer.add_media", { stableId, comp: { stableId: targetStable }, item: { stableId: sourceStable } });
      const transformResponse = await executeV11("layer.set_transform", { comp: { stableId: targetStable }, layer: { stableId }, values: childTransform });
      checks[`setup_${stableId}_transform`] = transformMatches(transformReadback(transformResponse), childTransform);
    }

    await verifyRejectedWithoutMutation(
      "p1_stale_null_create",
      async (beforeRevision) => dispatchV15("layer.null_create", { comp: { stableId: targetStable }, stableId: `${prefix}_STALE_NULL`, name: `${prefix} stale null`, position: [90, 90] }, Math.max(0, beforeRevision - 1)),
      "HOST_REVISION_CONFLICT",
    );

    const createNull = await dispatchV15("layer.null_create", { comp: { stableId: targetStable }, stableId: controllerStable, name: `${prefix} Controller`, position: nullPosition }, hostRevision);
    nullCreateReadback = nullRecord(createNull);
    checks.p2_null_create_applied = createNull.outcome === "APPLIED"
      && nullCreateReadback?.["isNull"] === true
      && objectRef(nullCreateReadback, "layer")?.["stableId"] === controllerStable
      && pointsClose(numericVector(nullCreateReadback, "position"), nullPosition, 0.001);
    if (!checks.p2_null_create_applied) throw new Error("Protocol 1.5 did not create/read back an exact true After Effects null controller.");

    await refreshState();
    const nullTransformResponse = await executeV11("layer.set_transform", { comp: { stableId: targetStable }, layer: { stableId: controllerStable }, values: nullTransform });
    nullTransformReadback = transformReadback(nullTransformResponse);
    checks.p2_null_transform_setup = transformMatches(nullTransformReadback, nullTransform);

    const repeatCreate = await dispatchV15("layer.null_create", { comp: { stableId: targetStable }, stableId: controllerStable, name: `${prefix} Controller`, position: nullPosition }, hostRevision);
    checks.p2_repeat_null_create_no_op = repeatCreate.outcome === "NO_OP"
      && nullRecord(repeatCreate)?.["isNull"] === true
      && objectRef(nullRecord(repeatCreate), "layer")?.["stableId"] === controllerStable;

    const nullRead = await dispatchV15("layer.null_readback", { comp: { stableId: targetStable }, layer: { stableId: controllerStable } }, null);
    checks.p2_null_readback_exact = nullRead.outcome === "NO_OP"
      && nullRecord(nullRead)?.["isNull"] === true
      && nullRecord(nullRead)?.["threeDLayer"] === false
      && objectRef(nullRecord(nullRead), "layer")?.["stableId"] === controllerStable
      && pointsClose(numericVector(nullRecord(nullRead), "position"), nullPosition, 0.001);

    await verifyRejectedWithoutMutation(
      "p1_null_stable_collision",
      async (beforeRevision) => dispatchV15("layer.null_create", { comp: { stableId: sourceStable }, stableId: controllerStable, name: `${prefix} Collision`, position: [30, 30] }, beforeRevision),
      "NULL_STABLE_ID_COLLISION",
    );
    await verifyRejectedWithoutMutation(
      "p1_non_null_controller",
      async (beforeRevision) => dispatchV15("rig.bind_children_to_null_preserve_transform", { comp: { stableId: targetStable }, controller: { stableId: childAStable }, children: [{ stableId: childBStable }] }, beforeRevision),
      "NULL_CONTROLLER_REQUIRED",
    );
    await verifyRejectedWithoutMutation(
      "p1_duplicate_child",
      async (beforeRevision) => dispatchV15("rig.bind_children_to_null_preserve_transform", { comp: { stableId: targetStable }, controller: { stableId: controllerStable }, children: [{ stableId: childAStable }, { stableId: childAStable }] }, beforeRevision),
      "NULL_RIG_DUPLICATE_CHILD",
    );
    await verifyRejectedWithoutMutation(
      "p1_self_child",
      async (beforeRevision) => dispatchV15("rig.bind_children_to_null_preserve_transform", { comp: { stableId: targetStable }, controller: { stableId: controllerStable }, children: [{ stableId: controllerStable }] }, beforeRevision),
      "NULL_RIG_SELF_REFERENCE",
    );
    await verifyRejectedWithoutMutation(
      "p1_unbind_not_bound",
      async (beforeRevision) => dispatchV15("rig.unbind_children_from_null_preserve_transform", { comp: { stableId: targetStable }, controller: { stableId: controllerStable }, children: [{ stableId: childAStable }] }, beforeRevision),
      "NULL_RIG_CHILD_NOT_BOUND",
    );
    await verifyRejectedWithoutMutation(
      "p1_missing_revision",
      async () => dispatchV15("rig.bind_children_to_null_preserve_transform", { comp: { stableId: targetStable }, controller: { stableId: controllerStable }, children: childStables.map((stableId) => ({ stableId })) }, null),
      "EXPECTED_HOST_REVISION_REQUIRED",
    );

    checks.p2_initial_geometry_available = await captureChildGeometry(initialGeometry);
    if (!checks.p2_initial_geometry_available) throw new Error("Accepted protocol 1.4 could not independently witness all initial child geometry.");

    await refreshState();
    if (projectSnapshot === null) throw new Error("Project snapshot unavailable before null-rig binding.");
    const preBindIndices: Record<string, number | null> = {};
    for (const stableId of childStables) preBindIndices[stableId] = findLayer(projectSnapshot, targetStable, stableId)?.index ?? null;
    const preBindControllerIndex = findLayer(projectSnapshot, targetStable, controllerStable)?.index ?? null;

    const bind = await dispatchV15("rig.bind_children_to_null_preserve_transform", { comp: { stableId: targetStable }, controller: { stableId: controllerStable }, children: childStables.map((stableId) => ({ stableId })) }, hostRevision);
    boundRelationship = relationshipRecord(bind);
    checks.p2_bind_applied = bind.outcome === "APPLIED"
      && objectRef(boundRelationship, "controller")?.["isNull"] === true
      && boundRelationship?.["childCount"] === childStables.length
      && sameStableIdSet(relationshipChildStableIds(boundRelationship), childStables);

    await refreshState();
    checks.p2_project_snapshot_all_bound = projectSnapshot !== null && childStables.every((stableId) => findLayer(projectSnapshot!, targetStable, stableId)?.parentStableId === controllerStable);
    checks.p2_layer_order_preserved_after_bind = projectSnapshot !== null
      && childStables.every((stableId) => findLayer(projectSnapshot!, targetStable, stableId)?.index === preBindIndices[stableId])
      && findLayer(projectSnapshot!, targetStable, controllerStable)?.index === preBindControllerIndex;

    checks.p2_bound_geometry_available = await captureChildGeometry(boundGeometry);
    checks.p2_bind_geometry_preserved = checks.p2_bound_geometry_available && childStables.every((stableId) => geometryClose(initialGeometry[stableId] ?? null, boundGeometry[stableId] ?? null));

    const repeatBind = await dispatchV15("rig.bind_children_to_null_preserve_transform", { comp: { stableId: targetStable }, controller: { stableId: controllerStable }, children: childStables.map((stableId) => ({ stableId })) }, hostRevision);
    checks.p2_repeat_bind_no_op = repeatBind.outcome === "NO_OP"
      && relationshipRecord(repeatBind)?.["childCount"] === childStables.length
      && sameStableIdSet(relationshipChildStableIds(relationshipRecord(repeatBind)), childStables);

    const boundRead = await dispatchV15("rig.relationship_readback", { comp: { stableId: targetStable }, controller: { stableId: controllerStable } }, null);
    checks.p2_bound_relationship_readback = boundRead.outcome === "NO_OP"
      && relationshipRecord(boundRead)?.["childCount"] === childStables.length
      && sameStableIdSet(relationshipChildStableIds(relationshipRecord(boundRead)), childStables);

    await refreshState();
    const unbind = await dispatchV15("rig.unbind_children_from_null_preserve_transform", { comp: { stableId: targetStable }, controller: { stableId: controllerStable }, children: childStables.map((stableId) => ({ stableId })) }, hostRevision);
    unboundRelationship = relationshipRecord(unbind);
    checks.p2_unbind_applied = unbind.outcome === "APPLIED" && unboundRelationship?.["childCount"] === 0 && relationshipChildStableIds(unboundRelationship).length === 0;

    await refreshState();
    checks.p2_project_snapshot_all_unbound = projectSnapshot !== null && childStables.every((stableId) => findLayer(projectSnapshot!, targetStable, stableId)?.parentStableId === null);
    checks.p2_layer_order_preserved_after_unbind = projectSnapshot !== null
      && childStables.every((stableId) => findLayer(projectSnapshot!, targetStable, stableId)?.index === preBindIndices[stableId])
      && findLayer(projectSnapshot!, targetStable, controllerStable)?.index === preBindControllerIndex;

    checks.p2_unbound_geometry_available = await captureChildGeometry(unboundGeometry);
    checks.p2_unbind_geometry_preserved = checks.p2_unbound_geometry_available && childStables.every((stableId) => geometryClose(initialGeometry[stableId] ?? null, unboundGeometry[stableId] ?? null));

    const finalRelationship = await dispatchV15("rig.relationship_readback", { comp: { stableId: targetStable }, controller: { stableId: controllerStable } }, null);
    checks.p2_final_relationship_empty = finalRelationship.outcome === "NO_OP"
      && relationshipRecord(finalRelationship)?.["childCount"] === 0
      && relationshipChildStableIds(relationshipRecord(finalRelationship)).length === 0;

    const p1Prefixes = ["p1_stale_null_create", "p1_null_stable_collision", "p1_non_null_controller", "p1_duplicate_child", "p1_self_child", "p1_unbind_not_bound", "p1_missing_revision"];
    checks.p1 = p1Prefixes.every((checkPrefix) => checks[`${checkPrefix}_rejected`] === true
      && checks[`${checkPrefix}_revision_unchanged`] === true
      && checks[`${checkPrefix}_fingerprint_unchanged`] === true);

    checks.p2 = checks.p2_null_create_applied === true
      && checks.p2_null_transform_setup === true
      && checks.p2_repeat_null_create_no_op === true
      && checks.p2_null_readback_exact === true
      && checks.p2_initial_geometry_available === true
      && checks.p2_bind_applied === true
      && checks.p2_project_snapshot_all_bound === true
      && checks.p2_layer_order_preserved_after_bind === true
      && checks.p2_bound_geometry_available === true
      && checks.p2_bind_geometry_preserved === true
      && checks.p2_repeat_bind_no_op === true
      && checks.p2_bound_relationship_readback === true
      && checks.p2_unbind_applied === true
      && checks.p2_project_snapshot_all_unbound === true
      && checks.p2_layer_order_preserved_after_unbind === true
      && checks.p2_unbound_geometry_available === true
      && checks.p2_unbind_geometry_preserved === true
      && checks.p2_final_relationship_empty === true;

    checks.baseline_captured = baselineFingerprint.length > 0 && baselineItemCount === 0 && baselineFilePath === null;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    try {
      if (client !== null) {
        await refreshState();
        if (projectSnapshot !== null) {
          const target = projectSnapshot.items.find((item) => item.kind === "COMPOSITION" && item.stableId === targetStable);
          if (target?.composition) {
            const stableIds = target.composition.layers.map((layer) => layer.stableId).filter((stableId): stableId is string => stableId !== null);
            const expectedIds = [controllerStable, ...childStables];
            checks.cleanup_target_fixture_owned = target.composition.layers.length === expectedIds.length && sameStableIdSet(stableIds, expectedIds);
            if (!checks.cleanup_target_fixture_owned) cleanupErrors.push("Target composition contains layers outside the exact null-rig proof fixture; refusing broad cleanup.");
          }
        }
      }
    } catch (error) {
      cleanupErrors.push(`pre-cleanup-inspect: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (cleanupErrors.length === 0) {
      await cleanupComp(targetStable);
      await cleanupComp(sourceStable);
    }

    try {
      if (client !== null) {
        await refreshState();
        checks.cleanup_item_count_restored = baselineItemCount !== null && projectSnapshot?.itemCount === baselineItemCount;
        checks.cleanup_file_path_restored = projectSnapshot?.filePath === baselineFilePath;
        checks.cleanup_fingerprint_restored = baselineFingerprint !== null && state?.projectFingerprint === baselineFingerprint;
      }
    } catch (error) {
      cleanupErrors.push(`final-inspect: ${error instanceof Error ? error.message : String(error)}`);
    }
    cleanupComplete = cleanupErrors.length === 0
      && checks.cleanup_target_fixture_owned === true
      && checks.cleanup_item_count_restored === true
      && checks.cleanup_file_path_restored === true
      && checks.cleanup_fingerprint_restored === true;
    if (broker !== null) await broker.stop();

    const ok = failureError === null && cleanupComplete && checks.p1 === true && checks.p2 === true;
    await writeJson(resultPath, {
      proofId: "M3_NULL_RIG_P1_P2_REAL_AE",
      status: ok ? "PASS" : "FAILURE",
      ok,
      startedAt,
      completedAt: new Date().toISOString(),
      cleanupComplete,
      proofLevels: {
        P1_validation_rejection: checks.p1 === true,
        P2_structural_readback: checks.p2 === true,
        P3_visual_proof: false,
        P4_failure_injection_rollback: false,
        P5_save_reopen_reconnect_transfer: false,
      },
      panel,
      environment,
      fixture: { sourceStable, targetStable, controllerStable, childStables, nullPosition, nullTransform, childTransforms },
      nullEvidence: { create: nullCreateReadback, transform: nullTransformReadback },
      relationshipEvidence: { bound: boundRelationship, unbound: unboundRelationship },
      geometryWitness: { protocolVersion: AE_PARENTING_PROTOCOL_VERSION_V14, initial: initialGeometry, bound: boundGeometry, unbound: unboundGeometry },
      checks,
      responses,
      failureError,
      cleanupErrors,
      notes: [
        "Protocol 1.5 owns true-null creation and every null-rig relationship mutation in this proof.",
        "Accepted protocol 1.4 is used read-only as an independent five-point child geometry witness before bind, after bind, and after unbind.",
        "The P2 bind/unbind success path is one multi-child protocol 1.5 operation per direction; P4 induced partial-failure atomic rollback is deliberately not claimed here.",
        "Cleanup removes only the exact stable-ID target/source fixture after first verifying target-layer ownership, then requires the original blank unsaved structural fingerprint.",
      ],
    });
    if (!ok) process.exitCode = 1;
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
