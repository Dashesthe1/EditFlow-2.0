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
  AE_NULL_RIG_PROTOCOL_VERSION_V15,
  type AeNullRigCommandV15,
  type AeNullRigResponseV15,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_5.js";
import { buildNullRigRequestV15 } from "../../../packages/adapters/ae-cep/src/m3-null-rig.js";
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
}

interface SpatialEvidence {
  readonly label: string;
  readonly propertyPath: readonly (string | number)[];
  readonly keyIndex: number;
  readonly requested: AeSpatialGraphSetStateV19;
  readonly setOutcome: string;
  readonly setObserved: AeSpatialGraphObservedStateV19 | null;
  readonly readbackOutcome: string;
  readonly readbackObserved: AeSpatialGraphObservedStateV19 | null;
  readonly dimensions: number | null;
  readonly keyTime: number | null;
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
      || !supported.includes(AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19)
      || !supported.includes(AE_NULL_RIG_PROTOCOL_VERSION_V15)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise required spatial-graph 1.9, null-rig 1.5, and baseline 1.1 protocols.");
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

const spatialGraphRecord = (response: AeSpatialGraphResponseV19): Record<string, unknown> | null =>
  nestedRecord(response.readback, "spatialGraph");

const spatialGraphState = (response: AeSpatialGraphResponseV19): AeSpatialGraphObservedStateV19 | null => {
  const graph = spatialGraphRecord(response);
  const state = graph === null ? null : asRecord(graph["state"]);
  if (state === null) return null;
  if (!Array.isArray(state["inTangent"]) || !Array.isArray(state["outTangent"])) return null;
  if (typeof state["continuous"] !== "boolean" || typeof state["autoBezier"] !== "boolean" || typeof state["roving"] !== "boolean") return null;
  return state as unknown as AeSpatialGraphObservedStateV19;
};

const spatialGraphDimensions = (response: AeSpatialGraphResponseV19): number | null => {
  const graph = spatialGraphRecord(response);
  const property = graph === null ? null : asRecord(graph["property"]);
  return property !== null && typeof property["dimensions"] === "number" ? property["dimensions"] : null;
};

const spatialGraphKeyTime = (response: AeSpatialGraphResponseV19): number | null => {
  const graph = spatialGraphRecord(response);
  return graph !== null && typeof graph["keyTime"] === "number" ? graph["keyTime"] : null;
};

const closeNumber = (left: unknown, right: number): boolean =>
  typeof left === "number" && Number.isFinite(left) && Math.abs(left - right) <= 0.000001;

const vectorMatches = (actual: unknown, expected: readonly number[]): boolean =>
  Array.isArray(actual)
  && actual.length === expected.length
  && actual.every((value, index) => closeNumber(value, expected[index] ?? Number.NaN));

const vectorIsFiniteDimension = (actual: unknown, dimensions: number): boolean =>
  Array.isArray(actual)
  && actual.length === dimensions
  && actual.every((value) => typeof value === "number" && Number.isFinite(value));

const manualStateMatches = (
  response: AeSpatialGraphResponseV19,
  expected: Extract<AeSpatialGraphSetStateV19, { readonly mode: "MANUAL" }>,
): boolean => {
  const state = spatialGraphState(response);
  return state !== null
    && state.autoBezier === false
    && state.continuous === expected.continuous
    && state.roving === expected.roving
    && vectorMatches(state.inTangent, expected.inTangent)
    && vectorMatches(state.outTangent, expected.outTangent);
};

const autoStateMatches = (response: AeSpatialGraphResponseV19, dimensions: number, roving: boolean): boolean => {
  const state = spatialGraphState(response);
  return state !== null
    && state.autoBezier === true
    && state.continuous === true
    && state.roving === roving
    && vectorIsFiniteDimension(state.inTangent, dimensions)
    && vectorIsFiniteDimension(state.outTangent, dimensions);
};

const observedStateEqual = (left: AeSpatialGraphObservedStateV19 | null, right: AeSpatialGraphObservedStateV19 | null): boolean => {
  if (left === null || right === null) return left === right;
  return left.continuous === right.continuous
    && left.autoBezier === right.autoBezier
    && left.roving === right.roving
    && vectorMatches(left.inTangent, right.inTangent)
    && vectorMatches(left.outTangent, right.outTangent);
};

const projectHasComp = (project: AeProjectSnapshot | null, stableId: string): boolean =>
  project?.items.some((item) => item.kind === "COMPOSITION" && item.stableId === stableId) ?? false;

const allChecksTrue = (checks: Record<string, boolean>, names: readonly string[]): boolean =>
  names.every((name) => checks[name] === true);

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "120000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error("--timeout-ms must be at least 10000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const checks: Record<string, boolean> = {};
  const responses: RecordedResponse[] = [];
  const evidence: SpatialEvidence[] = [];
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
  let targetCreated = false;
  let layer2dCreated = false;
  let layer3dCreated = false;

  const projectId = "m3-spatial-graph-p1-p2-real-ae";
  const prefix = `M3_SPATIAL_GRAPH_P12_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layer2dStable = `${prefix}_2D_POINT_NULL`;
  const layer3dStable = `${prefix}_3D_POSITION_NULL`;
  const point2dPath = ["ADBE Effect Parade", "ADBE Point Control", "ADBE Point Control-0001"] as const;
  const positionPath = ["ADBE Transform Group", "ADBE Position"] as const;
  const opacityPath = ["ADBE Transform Group", "ADBE Opacity"] as const;
  const interiorKey = 2;
  const interiorTime = 0.5;
  let operationCounter = 0;
  let requestCounter = 0;

  const manual2d: Extract<AeSpatialGraphSetStateV19, { readonly mode: "MANUAL" }> = {
    mode: "MANUAL",
    inTangent: [-42.5, 18.25],
    outTangent: [63.75, -21.5],
    continuous: false,
    roving: false,
  };
  const manual3d: Extract<AeSpatialGraphSetStateV19, { readonly mode: "MANUAL" }> = {
    mode: "MANUAL",
    inTangent: [-31.5, 16.25, 9.75],
    outTangent: [58.5, -27.25, 22.5],
    continuous: false,
    roving: false,
  };
  const auto3d: Extract<AeSpatialGraphSetStateV19, { readonly mode: "AUTO_BEZIER" }> = {
    mode: "AUTO_BEZIER",
    continuous: true,
    roving: false,
  };

  const recordResponse = (response: AeAdapterResponseV11 | AeNullRigResponseV15 | AeSpatialGraphResponseV19): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command: response.command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
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
  ): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M2 setup state is not initialized.");
    operationCounter += 1;
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_OP_${operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M3_SPATIAL_GRAPH_P1_P2_SETUP",
    });
    recordResponse(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    }
    await refreshState();
    return response;
  };

  const dispatchV15 = async (
    command: AeNullRigCommandV15,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
  ): Promise<AeNullRigResponseV15> => {
    if (broker === null) throw new Error("M3 broker is not initialized.");
    operationCounter += 1;
    const request = buildNullRigRequestV15({
      requestId: `m3-spatial-graph-p12-v15-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V15_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_SPATIAL_GRAPH_P1_P2_FIXTURE",
    });
    const response = await broker.dispatch(request);
    recordResponse(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const dispatchV19 = async (
    command: AeSpatialGraphCommandV19,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
  ): Promise<AeSpatialGraphResponseV19> => {
    if (broker === null) throw new Error("M3 broker is not initialized.");
    operationCounter += 1;
    const request = buildSpatialGraphRequestV19({
      requestId: `m3-spatial-graph-p12-v19-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V19_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_SPATIAL_GRAPH_P1_P2_STRUCTURAL",
    });
    const response = await broker.dispatch(request);
    recordResponse(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const targetPayload = (
    layerStableId: string,
    keyIndex = interiorKey,
    propertyPath: readonly (string | number)[] = positionPath,
  ): Readonly<Record<string, unknown>> => ({
    comp: { stableId: targetStable },
    layer: { stableId: layerStableId },
    propertyPath,
    keyIndex,
  });

  const readSpatial = async (
    layerStableId: string,
    propertyPath: readonly (string | number)[] = positionPath,
    keyIndex = interiorKey,
  ): Promise<AeSpatialGraphResponseV19> =>
    dispatchV19("property.spatial_graph.readback", targetPayload(layerStableId, keyIndex, propertyPath), null);

  const cleanupRig = async (stableId: string, created: boolean): Promise<void> => {
    if (!created || broker === null || client === null) return;
    try {
      await refreshState();
      const response = await dispatchV15("rig.null.remove", {
        comp: { stableId: targetStable },
        rig: { stableId },
      }, hostRevision);
      if (response.outcome !== "APPLIED" && response.outcome !== "NO_OP") {
        throw new Error(`rig.null.remove ${stableId} failed: ${response.error?.code ?? response.outcome}`);
      }
      await refreshState();
    } catch (error) {
      cleanupErrors.push(`${stableId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const cleanupComp = async (stableId: string): Promise<void> => {
    if (client === null) return;
    try {
      await refreshState();
      if (projectSnapshot !== null && projectHasComp(projectSnapshot, stableId)) {
        await executeV11("comp.remove", { comp: { stableId } });
      }
    } catch (error) {
      cleanupErrors.push(`${stableId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const proveRejectedWithoutMutation = async (
    checkPrefix: string,
    action: () => Promise<AeSpatialGraphResponseV19>,
    expectedCode: string,
    stateTarget?: {
      readonly layerStableId: string;
      readonly propertyPath: readonly (string | number)[];
      readonly keyIndex: number;
    },
  ): Promise<void> => {
    if (client === null) throw new Error("M2 setup client is not initialized.");
    const before = await client.observe(projectId);
    state = before.observed;
    hostRevision = before.hostRevision;
    projectSnapshot = before.project;
    const spatialBefore = stateTarget === undefined
      ? null
      : spatialGraphState(await readSpatial(stateTarget.layerStableId, stateTarget.propertyPath, stateTarget.keyIndex));
    const response = await action();
    const after = await client.observe(projectId);
    state = after.observed;
    hostRevision = after.hostRevision;
    projectSnapshot = after.project;
    const spatialAfter = stateTarget === undefined
      ? null
      : spatialGraphState(await readSpatial(stateTarget.layerStableId, stateTarget.propertyPath, stateTarget.keyIndex));
    checks[`${checkPrefix}_rejected`] = response.outcome === "REJECTED" && response.error?.code === expectedCode;
    checks[`${checkPrefix}_revision_unchanged`] = response.hostProjectRevision === before.hostRevision
      && after.hostRevision === before.hostRevision;
    checks[`${checkPrefix}_fingerprint_unchanged`] = after.observed.projectFingerprint === before.observed.projectFingerprint;
    checks[`${checkPrefix}_spatial_state_unchanged`] = stateTarget === undefined || observedStateEqual(spatialBefore, spatialAfter);
  };

  const proveManual = async (
    label: string,
    layerStableId: string,
    propertyPath: readonly (string | number)[],
    desired: Extract<AeSpatialGraphSetStateV19, { readonly mode: "MANUAL" }>,
    dimensions: number,
  ): Promise<void> => {
    if (hostRevision === null) throw new Error("Host revision unavailable before spatial graph mutation.");
    const setResponse = await dispatchV19("property.spatial_graph.set", {
      ...targetPayload(layerStableId, interiorKey, propertyPath),
      state: desired,
    }, hostRevision);
    checks[`p2_${label}_set_exact`] = setResponse.outcome === "APPLIED" && manualStateMatches(setResponse, desired);
    checks[`p2_${label}_dimensions_exact`] = spatialGraphDimensions(setResponse) === dimensions;
    checks[`p2_${label}_key_time_exact`] = closeNumber(spatialGraphKeyTime(setResponse), interiorTime);

    const readResponse = await readSpatial(layerStableId, propertyPath);
    checks[`p2_${label}_readback_exact`] = readResponse.outcome === "NO_OP" && manualStateMatches(readResponse, desired);
    checks[`p2_${label}_readback_dimensions_exact`] = spatialGraphDimensions(readResponse) === dimensions;

    const revisionBeforeNoOp = hostRevision;
    const repeat = await dispatchV19("property.spatial_graph.set", {
      ...targetPayload(layerStableId, interiorKey, propertyPath),
      state: desired,
    }, revisionBeforeNoOp);
    checks[`p2_${label}_repeat_no_op`] = repeat.outcome === "NO_OP" && manualStateMatches(repeat, desired);
    checks[`p2_${label}_no_op_revision_unchanged`] = repeat.hostProjectRevision === revisionBeforeNoOp;

    evidence.push({
      label,
      propertyPath,
      keyIndex: interiorKey,
      requested: desired,
      setOutcome: setResponse.outcome,
      setObserved: spatialGraphState(setResponse),
      readbackOutcome: readResponse.outcome,
      readbackObserved: spatialGraphState(readResponse),
      dimensions: spatialGraphDimensions(readResponse),
      keyTime: spatialGraphKeyTime(readResponse),
    });
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
      supportedProtocolVersions: [
        AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19,
        AE_NULL_RIG_PROTOCOL_VERSION_V15,
        AE_ADAPTER_PROTOCOL_VERSION_V11,
      ],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v19 = panel.protocolVersion === AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19;
    checks.panel_supports_v11_v15_v19 = panel.supportedProtocolVersions.includes(AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19)
      && panel.supportedProtocolVersions.includes(AE_NULL_RIG_PROTOCOL_VERSION_V15)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v19 || !checks.panel_supports_v11_v15_v19) {
      throw new Error(`Spatial-graph proof requires negotiated protocol ${AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19} with null-rig 1.5 and baseline 1.1 fixture compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-spatial-graph-setup-${++requestCounter}`,
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

    await executeV11("comp.create", {
      stableId: targetStable,
      name: `${prefix} Target`,
      width: 640,
      height: 360,
      pixelAspect: 1,
      duration: 2,
      frameRate: 24,
    });
    targetCreated = true;

    const create2d = await dispatchV15("rig.null.create", {
      comp: { stableId: targetStable },
      rig: { stableId: layer2dStable, name: `${prefix} 2D Point Spatial` },
      threeDLayer: false,
    }, hostRevision);
    if (create2d.outcome !== "APPLIED" && create2d.outcome !== "NO_OP") throw new Error(`2D point null fixture failed: ${create2d.error?.code ?? create2d.outcome}`);
    layer2dCreated = true;
    await refreshState();

    await executeV11("effect.add", {
      comp: { stableId: targetStable },
      layer: { stableId: layer2dStable },
      matchName: "ADBE Point Control",
    });
    checks.fixture_2d_point_control_added = true;

    const create3d = await dispatchV15("rig.null.create", {
      comp: { stableId: targetStable },
      rig: { stableId: layer3dStable, name: `${prefix} 3D Position Spatial` },
      threeDLayer: true,
    }, hostRevision);
    if (create3d.outcome !== "APPLIED" && create3d.outcome !== "NO_OP") throw new Error(`3D null fixture failed: ${create3d.error?.code ?? create3d.outcome}`);
    layer3dCreated = true;
    await refreshState();

    await executeV11("property.set_keyframes", {
      comp: { stableId: targetStable },
      layer: { stableId: layer2dStable },
      propertyPath: point2dPath,
      keyframes: [
        { time: 0, value: [80, 280] },
        { time: interiorTime, value: [315, 70] },
        { time: 1, value: [560, 260] },
      ],
    });
    await executeV11("property.set_keyframes", {
      comp: { stableId: targetStable },
      layer: { stableId: layer3dStable },
      propertyPath: positionPath,
      keyframes: [
        { time: 0, value: [90, 270, 0] },
        { time: interiorTime, value: [320, 85, 140] },
        { time: 1, value: [550, 250, -80] },
      ],
    });
    await executeV11("property.set_keyframes", {
      comp: { stableId: targetStable },
      layer: { stableId: layer2dStable },
      propertyPath: opacityPath,
      keyframes: [
        { time: 0, value: 100 },
        { time: interiorTime, value: 60 },
        { time: 1, value: 100 },
      ],
    });

    const initial2d = await readSpatial(layer2dStable, point2dPath);
    const initial3d = await readSpatial(layer3dStable, positionPath);
    checks.p2_fixture_2d_spatial = initial2d.outcome === "NO_OP" && spatialGraphDimensions(initial2d) === 2;
    checks.p2_fixture_3d_spatial = initial3d.outcome === "NO_OP" && spatialGraphDimensions(initial3d) === 3;

    await proveRejectedWithoutMutation("p1_non_spatial", async () => dispatchV19(
      "property.spatial_graph.set",
      {
        ...targetPayload(layer2dStable, interiorKey, opacityPath),
        state: manual2d,
      },
      hostRevision,
    ), "SPATIAL_PROPERTY_REQUIRED");

    await proveRejectedWithoutMutation("p1_bad_2d_dimension", async () => dispatchV19(
      "property.spatial_graph.set",
      {
        ...targetPayload(layer2dStable, interiorKey, point2dPath),
        state: { ...manual2d, inTangent: [-10, 20, 30] },
      },
      hostRevision,
    ), "SPATIAL_TANGENT_DIMENSION_MISMATCH", {
      layerStableId: layer2dStable,
      propertyPath: point2dPath,
      keyIndex: interiorKey,
    });

    await proveRejectedWithoutMutation("p1_roving_endpoint", async () => dispatchV19(
      "property.spatial_graph.set",
      {
        ...targetPayload(layer2dStable, 1, point2dPath),
        state: { ...manual2d, roving: true },
      },
      hostRevision,
    ), "ROVING_ENDPOINT_FORBIDDEN", {
      layerStableId: layer2dStable,
      propertyPath: point2dPath,
      keyIndex: 1,
    });

    await proveRejectedWithoutMutation("p1_auto_manual_tangent_forbidden", async () => dispatchV19(
      "property.spatial_graph.set",
      {
        ...targetPayload(layer3dStable, interiorKey, positionPath),
        state: { ...auto3d, inTangent: [-1, 2, 3] },
      },
      hostRevision,
    ), "AUTO_BEZIER_TANGENTS_FORBIDDEN", {
      layerStableId: layer3dStable,
      propertyPath: positionPath,
      keyIndex: interiorKey,
    });

    const beforeStale = await client.observe(projectId);
    state = beforeStale.observed;
    hostRevision = beforeStale.hostRevision;
    projectSnapshot = beforeStale.project;
    await proveRejectedWithoutMutation("p1_stale_revision", async () => dispatchV19(
      "property.spatial_graph.set",
      { ...targetPayload(layer2dStable, interiorKey, point2dPath), state: manual2d },
      beforeStale.hostRevision + 1000,
    ), "HOST_REVISION_CONFLICT", {
      layerStableId: layer2dStable,
      propertyPath: point2dPath,
      keyIndex: interiorKey,
    });

    await proveManual("2d_manual", layer2dStable, point2dPath, manual2d, 2);
    await proveManual("3d_manual", layer3dStable, positionPath, manual3d, 3);

    if (hostRevision === null) throw new Error("Host revision unavailable before roving proof.");
    const roving2d: Extract<AeSpatialGraphSetStateV19, { readonly mode: "MANUAL" }> = { ...manual2d, roving: true };
    const rovingSet = await dispatchV19("property.spatial_graph.set", {
      ...targetPayload(layer2dStable, interiorKey, point2dPath),
      state: roving2d,
    }, hostRevision);
    checks.p2_interior_roving_applied = rovingSet.outcome === "APPLIED" && manualStateMatches(rovingSet, roving2d);
    const rovingRead = await readSpatial(layer2dStable, point2dPath);
    checks.p2_interior_roving_readback = rovingRead.outcome === "NO_OP"
      && spatialGraphState(rovingRead)?.roving === true
      && spatialGraphState(rovingRead)?.autoBezier === false;

    if (hostRevision === null) throw new Error("Host revision unavailable before roving reset.");
    const rovingReset = await dispatchV19("property.spatial_graph.set", {
      ...targetPayload(layer2dStable, interiorKey, point2dPath),
      state: manual2d,
    }, hostRevision);
    checks.p2_interior_roving_reset = (rovingReset.outcome === "APPLIED" || rovingReset.outcome === "NO_OP")
      && manualStateMatches(rovingReset, manual2d);

    if (hostRevision === null) throw new Error("Host revision unavailable before auto-Bezier proof.");
    const autoSet = await dispatchV19("property.spatial_graph.set", {
      ...targetPayload(layer3dStable, interiorKey, positionPath),
      state: auto3d,
    }, hostRevision);
    checks.p2_auto_3d_applied = autoSet.outcome === "APPLIED" && autoStateMatches(autoSet, 3, false);
    const autoRead = await readSpatial(layer3dStable, positionPath);
    checks.p2_auto_3d_readback_host_shaped = autoRead.outcome === "NO_OP" && autoStateMatches(autoRead, 3, false);
    const autoObserved = spatialGraphState(autoRead);

    const revisionBeforeAutoNoOp = hostRevision;
    const autoRepeat = await dispatchV19("property.spatial_graph.set", {
      ...targetPayload(layer3dStable, interiorKey, positionPath),
      state: auto3d,
    }, revisionBeforeAutoNoOp);
    checks.p2_auto_3d_repeat_no_op = autoRepeat.outcome === "NO_OP" && autoStateMatches(autoRepeat, 3, false);
    checks.p2_auto_3d_no_op_revision_unchanged = autoRepeat.hostProjectRevision === revisionBeforeAutoNoOp;
    checks.p2_auto_3d_host_tangents_stable_on_noop = observedStateEqual(autoObserved, spatialGraphState(autoRepeat));

    evidence.push({
      label: "3d_auto_bezier_host_shaped",
      propertyPath: positionPath,
      keyIndex: interiorKey,
      requested: auto3d,
      setOutcome: autoSet.outcome,
      setObserved: spatialGraphState(autoSet),
      readbackOutcome: autoRead.outcome,
      readbackObserved: autoObserved,
      dimensions: spatialGraphDimensions(autoRead),
      keyTime: spatialGraphKeyTime(autoRead),
    });

    checks.p1 = allChecksTrue(checks, [
      "p1_non_spatial_rejected",
      "p1_non_spatial_revision_unchanged",
      "p1_non_spatial_fingerprint_unchanged",
      "p1_bad_2d_dimension_rejected",
      "p1_bad_2d_dimension_revision_unchanged",
      "p1_bad_2d_dimension_fingerprint_unchanged",
      "p1_bad_2d_dimension_spatial_state_unchanged",
      "p1_roving_endpoint_rejected",
      "p1_roving_endpoint_revision_unchanged",
      "p1_roving_endpoint_fingerprint_unchanged",
      "p1_roving_endpoint_spatial_state_unchanged",
      "p1_auto_manual_tangent_forbidden_rejected",
      "p1_auto_manual_tangent_forbidden_revision_unchanged",
      "p1_auto_manual_tangent_forbidden_fingerprint_unchanged",
      "p1_auto_manual_tangent_forbidden_spatial_state_unchanged",
      "p1_stale_revision_rejected",
      "p1_stale_revision_revision_unchanged",
      "p1_stale_revision_fingerprint_unchanged",
      "p1_stale_revision_spatial_state_unchanged",
    ]);
    checks.p2 = allChecksTrue(checks, [
      "fixture_2d_point_control_added",
      "p2_fixture_2d_spatial",
      "p2_fixture_3d_spatial",
      "p2_2d_manual_set_exact",
      "p2_2d_manual_dimensions_exact",
      "p2_2d_manual_key_time_exact",
      "p2_2d_manual_readback_exact",
      "p2_2d_manual_readback_dimensions_exact",
      "p2_2d_manual_repeat_no_op",
      "p2_2d_manual_no_op_revision_unchanged",
      "p2_3d_manual_set_exact",
      "p2_3d_manual_dimensions_exact",
      "p2_3d_manual_key_time_exact",
      "p2_3d_manual_readback_exact",
      "p2_3d_manual_readback_dimensions_exact",
      "p2_3d_manual_repeat_no_op",
      "p2_3d_manual_no_op_revision_unchanged",
      "p2_interior_roving_applied",
      "p2_interior_roving_readback",
      "p2_interior_roving_reset",
      "p2_auto_3d_applied",
      "p2_auto_3d_readback_host_shaped",
      "p2_auto_3d_repeat_no_op",
      "p2_auto_3d_no_op_revision_unchanged",
      "p2_auto_3d_host_tangents_stable_on_noop",
    ]);
    checks.baseline_captured = baselineFingerprint.length > 0 && baselineItemCount >= 0;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await cleanupRig(layer3dStable, layer3dCreated);
    await cleanupRig(layer2dStable, layer2dCreated);
    await cleanupComp(targetStable);
    try {
      if (client !== null) {
        await refreshState();
        checks.cleanup_target_removed = !targetCreated || (projectSnapshot !== null && !projectHasComp(projectSnapshot, targetStable));
        checks.cleanup_item_count_restored = baselineItemCount !== null && projectSnapshot?.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint !== null && state?.projectFingerprint === baselineFingerprint;
      }
    } catch (error) {
      cleanupErrors.push(`final-inspect: ${error instanceof Error ? error.message : String(error)}`);
    }
    cleanupComplete = cleanupErrors.length === 0
      && checks.cleanup_target_removed === true
      && checks.cleanup_item_count_restored === true
      && checks.cleanup_fingerprint_restored === true;
    if (broker !== null) await broker.stop();

    const ok = failureError === null
      && cleanupComplete
      && checks.p1 === true
      && checks.p2 === true;
    await writeJson(resultPath, {
      proofId: "M3_SPATIAL_GRAPH_P1_P2_REAL_AE",
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
      fixture: {
        targetStable,
        layer2dStable,
        layer3dStable,
        point2dPath,
        positionPath,
        opacityPath,
        interiorKey,
        interiorTime,
      },
      evidence,
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
