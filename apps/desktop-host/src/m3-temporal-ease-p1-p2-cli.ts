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
  AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17,
  type AeTemporalInterpolationCommandV17,
  type AeTemporalInterpolationResponseV17,
  type AeTemporalInterpolationStateV17,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_7.js";
import { buildTemporalInterpolationRequestV17 } from "../../../packages/adapters/ae-cep/src/m3-temporal-interpolation.js";
import {
  AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18,
  type AeTemporalEaseCommandV18,
  type AeTemporalEaseResponseV18,
  type AeTemporalEaseStateV18,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_8.js";
import { buildTemporalEaseRequestV18 } from "../../../packages/adapters/ae-cep/src/m3-temporal-ease.js";
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

interface EaseEvidence {
  readonly label: string;
  readonly propertyPath: readonly (string | number)[];
  readonly requested: AeTemporalEaseStateV18;
  readonly setOutcome: string;
  readonly setObserved: Record<string, unknown> | null;
  readonly readbackOutcome: string;
  readonly readbackObserved: Record<string, unknown> | null;
  readonly cardinality: number | null;
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
      || !supported.includes(AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18)
      || !supported.includes(AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise required temporal-ease 1.8, interpolation 1.7, and baseline 1.1 protocols.");
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

const temporalEaseRecord = (response: AeTemporalEaseResponseV18): Record<string, unknown> | null =>
  nestedRecord(response.readback, "temporalEase");

const temporalEaseState = (response: AeTemporalEaseResponseV18): Record<string, unknown> | null => {
  const temporal = temporalEaseRecord(response);
  return temporal === null ? null : asRecord(temporal["state"]);
};

const closeNumber = (left: unknown, right: number): boolean =>
  typeof left === "number" && Number.isFinite(left) && Math.abs(left - right) <= 0.000001;

const easeArrayMatches = (actual: unknown, expected: readonly { readonly speed: number; readonly influence: number }[]): boolean => {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return actual.every((value, index) => {
    const record = asRecord(value);
    const target = expected[index];
    return record !== null && target !== undefined
      && closeNumber(record["speed"], target.speed)
      && closeNumber(record["influence"], target.influence);
  });
};

const easeStateMatches = (response: AeTemporalEaseResponseV18, expected: AeTemporalEaseStateV18): boolean => {
  const state = temporalEaseState(response);
  return state !== null
    && easeArrayMatches(state["inEase"], expected.inEase)
    && easeArrayMatches(state["outEase"], expected.outEase);
};

const propertyCardinality = (response: AeTemporalEaseResponseV18): number | null => {
  const temporal = temporalEaseRecord(response);
  const property = temporal === null ? null : asRecord(temporal["property"]);
  return property !== null && typeof property["easeCardinality"] === "number" ? property["easeCardinality"] : null;
};

const interpolationIsManualBezier = (response: AeTemporalEaseResponseV18): boolean => {
  const temporal = temporalEaseRecord(response);
  const interpolation = temporal === null ? null : asRecord(temporal["interpolation"]);
  return interpolation !== null
    && interpolation["inType"] === "BEZIER"
    && interpolation["outType"] === "BEZIER"
    && interpolation["temporalAutoBezier"] === false;
};

const keyIdentityMatches = (response: AeTemporalEaseResponseV18, keyIndex: number, keyTime: number): boolean => {
  const temporal = temporalEaseRecord(response);
  return temporal !== null
    && temporal["keyIndex"] === keyIndex
    && closeNumber(temporal["keyTime"], keyTime);
};

const projectHasComp = (project: AeProjectSnapshot | null, stableId: string): boolean =>
  project?.items.some((item) => item.kind === "COMPOSITION" && item.stableId === stableId) ?? false;

const allChecksTrue = (...values: readonly (boolean | undefined)[]): boolean => values.every((value) => value === true);

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "120000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error("--timeout-ms must be at least 10000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const checks: Record<string, boolean> = {};
  const responses: RecordedResponse[] = [];
  const easeEvidence: EaseEvidence[] = [];
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
  let finalFingerprint: string | null = null;
  let finalItemCount: number | null = null;

  const projectId = "m3-temporal-ease-p1-p2-real-ae";
  const prefix = `M3_TEMPORAL_EASE_P12_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layerStable = `${prefix}_LAYER`;
  const opacityPath = ["ADBE Transform Group", "ADBE Opacity"] as const;
  const scalePath = ["ADBE Transform Group", "ADBE Scale"] as const;
  const keyIndex = 2;
  const keyTime = 0.5;
  let operationCounter = 0;
  let requestCounter = 0;

  const manualBezier: AeTemporalInterpolationStateV17 = {
    inType: "BEZIER",
    outType: "BEZIER",
    temporalContinuous: false,
    temporalAutoBezier: false,
  };
  const autoBezier: AeTemporalInterpolationStateV17 = {
    inType: "BEZIER",
    outType: "BEZIER",
    temporalContinuous: true,
    temporalAutoBezier: true,
  };
  const scalarEase: AeTemporalEaseStateV18 = {
    inEase: [{ speed: 40, influence: 28.5 }],
    outEase: [{ speed: 120, influence: 72.25 }],
  };
  const scaleEase: AeTemporalEaseStateV18 = {
    inEase: [
      { speed: 20, influence: 31.25 },
      { speed: 35, influence: 44.5 },
    ],
    outEase: [
      { speed: 90, influence: 68.75 },
      { speed: 60, influence: 52.5 },
    ],
  };

  const recordResponse = (response: AeAdapterResponseV11 | AeTemporalInterpolationResponseV17 | AeTemporalEaseResponseV18): void => {
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
      readbackProfile: "M3_TEMPORAL_EASE_P1_P2_SETUP",
    });
    recordResponse(response);
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
  ): Promise<AeTemporalInterpolationResponseV17> => {
    if (broker === null) throw new Error("M3 broker is not initialized.");
    operationCounter += 1;
    const request = buildTemporalInterpolationRequestV17({
      requestId: `m3-temporal-ease-p12-v17-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V17_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_TEMPORAL_EASE_P1_P2_INTERPOLATION_SETUP",
    });
    const response = await broker.dispatch(request);
    recordResponse(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const dispatchV18 = async (
    command: AeTemporalEaseCommandV18,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
  ): Promise<AeTemporalEaseResponseV18> => {
    if (broker === null) throw new Error("M3 broker is not initialized.");
    operationCounter += 1;
    const request = buildTemporalEaseRequestV18({
      requestId: `m3-temporal-ease-p12-v18-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V18_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_TEMPORAL_EASE_P1_P2_STRUCTURAL",
    });
    const response = await broker.dispatch(request);
    recordResponse(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const targetPayload = (propertyPath: readonly (string | number)[]): Readonly<Record<string, unknown>> => ({
    comp: { stableId: targetStable },
    layer: { stableId: layerStable },
    propertyPath,
    keyIndex,
  });

  const setInterpolation = async (
    propertyPath: readonly (string | number)[],
    desired: AeTemporalInterpolationStateV17,
  ): Promise<void> => {
    if (hostRevision === null) throw new Error("Host revision unavailable before protocol 1.7 interpolation setup.");
    const response = await dispatchV17("property.temporal_interpolation.set", {
      ...targetPayload(propertyPath),
      interpolation: desired,
    }, hostRevision);
    if (response.outcome !== "APPLIED" && response.outcome !== "NO_OP") {
      throw new Error(`Protocol 1.7 interpolation setup failed: ${response.error?.code ?? response.outcome}`);
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
    action: () => Promise<AeTemporalEaseResponseV18>,
    expectedCode: string,
  ): Promise<void> => {
    if (client === null) throw new Error("M2 setup client is not initialized.");
    const before = await client.observe(projectId);
    state = before.observed;
    hostRevision = before.hostRevision;
    projectSnapshot = before.project;
    const response = await action();
    const after = await client.observe(projectId);
    state = after.observed;
    hostRevision = after.hostRevision;
    projectSnapshot = after.project;
    checks[`${checkPrefix}_rejected`] = response.outcome === "REJECTED" && response.error?.code === expectedCode;
    checks[`${checkPrefix}_revision_unchanged`] = response.hostProjectRevision === before.hostRevision
      && after.hostRevision === before.hostRevision;
    checks[`${checkPrefix}_fingerprint_unchanged`] = after.observed.projectFingerprint === before.observed.projectFingerprint;
  };

  const proveEase = async (
    label: string,
    propertyPath: readonly (string | number)[],
    desired: AeTemporalEaseStateV18,
    expectedCardinality: number,
  ): Promise<void> => {
    if (hostRevision === null) throw new Error("Host revision unavailable before temporal-ease mutation.");
    const beforeRevision = hostRevision;
    const setResponse = await dispatchV18("property.temporal_ease.set", {
      ...targetPayload(propertyPath),
      ease: desired,
    }, beforeRevision);
    checks[`p2_${label}_set_exact`] = setResponse.outcome === "APPLIED" && easeStateMatches(setResponse, desired);
    checks[`p2_${label}_set_cardinality_exact`] = propertyCardinality(setResponse) === expectedCardinality;
    checks[`p2_${label}_set_manual_bezier`] = interpolationIsManualBezier(setResponse);
    checks[`p2_${label}_revision_advanced`] = typeof setResponse.hostProjectRevision === "number"
      && setResponse.hostProjectRevision >= beforeRevision;

    const readResponse = await dispatchV18("property.temporal_ease.readback", targetPayload(propertyPath), null);
    checks[`p2_${label}_readback_exact`] = readResponse.outcome === "NO_OP" && easeStateMatches(readResponse, desired);
    checks[`p2_${label}_readback_cardinality_exact`] = propertyCardinality(readResponse) === expectedCardinality;
    checks[`p2_${label}_readback_manual_bezier`] = interpolationIsManualBezier(readResponse);
    checks[`p2_${label}_key_identity_exact`] = keyIdentityMatches(readResponse, keyIndex, keyTime);

    easeEvidence.push({
      label,
      propertyPath,
      requested: desired,
      setOutcome: setResponse.outcome,
      setObserved: temporalEaseState(setResponse),
      readbackOutcome: readResponse.outcome,
      readbackObserved: temporalEaseState(readResponse),
      cardinality: propertyCardinality(readResponse),
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
        AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18,
        AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17,
        AE_ADAPTER_PROTOCOL_VERSION_V11,
      ],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v18 = panel.protocolVersion === AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18;
    checks.panel_supports_v11_v17_v18 = panel.supportedProtocolVersions.includes(AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18)
      && panel.supportedProtocolVersions.includes(AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v18 || !checks.panel_supports_v11_v17_v18) {
      throw new Error(`Temporal-ease proof requires negotiated protocol ${AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18} with accepted 1.7 interpolation and baseline 1.1 fixture compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-temporal-ease-setup-${++requestCounter}`,
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
      stableId: sourceStable,
      name: `${prefix} Source`,
      width: 320,
      height: 180,
      pixelAspect: 1,
      duration: 2,
      frameRate: 24,
    });
    await executeV11("comp.create", {
      stableId: targetStable,
      name: `${prefix} Target`,
      width: 640,
      height: 360,
      pixelAspect: 1,
      duration: 2,
      frameRate: 24,
    });
    await executeV11("layer.add_media", {
      stableId: layerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    await executeV11("property.set_keyframes", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      propertyPath: opacityPath,
      keyframes: [
        { time: 0, value: 10 },
        { time: keyTime, value: 90 },
        { time: 1, value: 30 },
      ],
    });
    await executeV11("property.set_keyframes", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      propertyPath: scalePath,
      keyframes: [
        { time: 0, value: [100, 100] },
        { time: keyTime, value: [150, 75] },
        { time: 1, value: [80, 130] },
      ],
    });

    await proveRejectedWithoutMutation("p1_bad_key", async () => dispatchV18(
      "property.temporal_ease.readback",
      { ...targetPayload(opacityPath), keyIndex: 99 },
      null,
    ), "KEY_INDEX_OUT_OF_RANGE");

    await proveRejectedWithoutMutation("p1_bad_path", async () => dispatchV18(
      "property.temporal_ease.readback",
      { ...targetPayload(opacityPath), propertyPath: ["ADBE Transform Group", "ADBE DOES NOT EXIST"] },
      null,
    ), "PROPERTY_PATH_NOT_FOUND");

    await proveRejectedWithoutMutation("p1_requires_bezier", async () => dispatchV18(
      "property.temporal_ease.set",
      { ...targetPayload(opacityPath), ease: scalarEase },
      hostRevision,
    ), "TEMPORAL_EASE_REQUIRES_BEZIER_INTERPOLATION");

    await setInterpolation(opacityPath, manualBezier);

    await proveRejectedWithoutMutation("p1_bad_cardinality", async () => dispatchV18(
      "property.temporal_ease.set",
      {
        ...targetPayload(opacityPath),
        ease: {
          inEase: [{ speed: 10, influence: 25 }, { speed: 20, influence: 30 }],
          outEase: [{ speed: 30, influence: 40 }, { speed: 40, influence: 50 }],
        },
      },
      hostRevision,
    ), "TEMPORAL_EASE_CARDINALITY_MISMATCH");

    await proveRejectedWithoutMutation("p1_bad_influence", async () => dispatchV18(
      "property.temporal_ease.set",
      {
        ...targetPayload(opacityPath),
        ease: {
          inEase: [{ speed: 10, influence: 0 }],
          outEase: [{ speed: 30, influence: 40 }],
        },
      },
      hostRevision,
    ), "KEYFRAME_EASE_INFLUENCE_INVALID");

    await setInterpolation(opacityPath, autoBezier);
    await proveRejectedWithoutMutation("p1_requires_manual_bezier", async () => dispatchV18(
      "property.temporal_ease.set",
      { ...targetPayload(opacityPath), ease: scalarEase },
      hostRevision,
    ), "TEMPORAL_EASE_REQUIRES_MANUAL_BEZIER");
    await setInterpolation(opacityPath, manualBezier);

    await proveRejectedWithoutMutation("p1_stale_revision", async () => dispatchV18(
      "property.temporal_ease.set",
      { ...targetPayload(opacityPath), ease: scalarEase },
      (hostRevision ?? 0) + 1000,
    ), "HOST_REVISION_CONFLICT");

    await proveEase("opacity_scalar", opacityPath, scalarEase, 1);

    if (hostRevision === null) throw new Error("Host revision unavailable before scalar no-op proof.");
    const noOpRevision = hostRevision;
    const noOp = await dispatchV18("property.temporal_ease.set", {
      ...targetPayload(opacityPath),
      ease: scalarEase,
    }, noOpRevision);
    checks.p2_scalar_exact_noop = noOp.outcome === "NO_OP" && easeStateMatches(noOp, scalarEase);
    checks.p2_scalar_noop_revision_unchanged = noOp.hostProjectRevision === noOpRevision;

    await setInterpolation(scalePath, manualBezier);
    await proveEase("scale_twod", scalePath, scaleEase, 2);
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await cleanupComp(targetStable);
    await cleanupComp(sourceStable);
    if (client !== null) {
      try {
        const finalState = await client.observe(projectId);
        finalFingerprint = finalState.observed.projectFingerprint;
        finalItemCount = finalState.project.itemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint !== null && finalFingerprint === baselineFingerprint;
        checks.cleanup_item_count_restored = baselineItemCount !== null && finalItemCount === baselineItemCount;
      } catch (error) {
        cleanupErrors.push(`final observe: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    cleanupComplete = cleanupErrors.length === 0
      && checks.cleanup_fingerprint_restored === true
      && checks.cleanup_item_count_restored === true;
    if (broker !== null) {
      try { await broker.stop(); }
      catch (error) { cleanupErrors.push(`broker stop: ${error instanceof Error ? error.message : String(error)}`); }
    }

    const p1 = allChecksTrue(
      checks.p1_bad_key_rejected,
      checks.p1_bad_key_revision_unchanged,
      checks.p1_bad_key_fingerprint_unchanged,
      checks.p1_bad_path_rejected,
      checks.p1_bad_path_revision_unchanged,
      checks.p1_bad_path_fingerprint_unchanged,
      checks.p1_requires_bezier_rejected,
      checks.p1_requires_bezier_revision_unchanged,
      checks.p1_requires_bezier_fingerprint_unchanged,
      checks.p1_bad_cardinality_rejected,
      checks.p1_bad_cardinality_revision_unchanged,
      checks.p1_bad_cardinality_fingerprint_unchanged,
      checks.p1_bad_influence_rejected,
      checks.p1_bad_influence_revision_unchanged,
      checks.p1_bad_influence_fingerprint_unchanged,
      checks.p1_requires_manual_bezier_rejected,
      checks.p1_requires_manual_bezier_revision_unchanged,
      checks.p1_requires_manual_bezier_fingerprint_unchanged,
      checks.p1_stale_revision_rejected,
      checks.p1_stale_revision_revision_unchanged,
      checks.p1_stale_revision_fingerprint_unchanged,
    );
    const p2 = allChecksTrue(
      checks.p2_opacity_scalar_set_exact,
      checks.p2_opacity_scalar_set_cardinality_exact,
      checks.p2_opacity_scalar_set_manual_bezier,
      checks.p2_opacity_scalar_revision_advanced,
      checks.p2_opacity_scalar_readback_exact,
      checks.p2_opacity_scalar_readback_cardinality_exact,
      checks.p2_opacity_scalar_readback_manual_bezier,
      checks.p2_opacity_scalar_key_identity_exact,
      checks.p2_scalar_exact_noop,
      checks.p2_scalar_noop_revision_unchanged,
      checks.p2_scale_twod_set_exact,
      checks.p2_scale_twod_set_cardinality_exact,
      checks.p2_scale_twod_set_manual_bezier,
      checks.p2_scale_twod_revision_advanced,
      checks.p2_scale_twod_readback_exact,
      checks.p2_scale_twod_readback_cardinality_exact,
      checks.p2_scale_twod_readback_manual_bezier,
      checks.p2_scale_twod_key_identity_exact,
    );
    const proofLevels = {
      P1_validation_rejection: p1,
      P2_structural_readback: p2,
      P3_visual_proof: false,
      P4_failure_injection_rollback: false,
      P5_save_reopen_reconnect_transfer: false,
    };
    const ok = failureError === null
      && checks.panel_negotiated_v18 === true
      && checks.panel_supports_v11_v17_v18 === true
      && checks.host_probe === true
      && p1
      && p2
      && cleanupComplete;

    await writeJson(resultPath, {
      schemaVersion: 1,
      proof: "M3_TEMPORAL_EASE_P1_P2_REAL_AE",
      protocolVersion: AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18,
      status: ok ? "PASS" : "FAIL",
      ok,
      startedAt,
      completedAt: new Date().toISOString(),
      proofLevels,
      checks,
      panel,
      environment,
      fixture: {
        sourceStable,
        targetStable,
        layerStable,
        opacityPath,
        scalePath,
        keyIndex,
        keyTime,
      },
      baseline: { projectFingerprint: baselineFingerprint, itemCount: baselineItemCount },
      final: { projectFingerprint: finalFingerprint, itemCount: finalItemCount },
      easeEvidence,
      responses,
      cleanupComplete,
      cleanupErrors,
      failureError,
      limitations: [
        "This artifact proves only P1 deterministic rejection and P2 exact structural temporal-ease readback on disposable Opacity and Scale keyframes.",
        "Protocol 1.7 is used only to establish the manual-BEZIER precondition; protocol 1.8 exclusively owns numeric KeyframeEase speed/influence mutation and readback.",
        "P3 viewer-visible proof, P4 induced-failure rollback, P5 save/reopen/reconnect transfer, spatial tangents/roving, and motion-blur/frame-blending controls are not claimed.",
      ],
    });

    if (!ok) process.exitCode = 1;
  }
};

await main();
