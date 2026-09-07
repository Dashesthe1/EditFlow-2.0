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

interface StateEvidence {
  readonly label: string;
  readonly requested: AeTemporalInterpolationStateV17;
  readonly setOutcome: string;
  readonly setObserved: Record<string, unknown> | null;
  readonly readbackOutcome: string;
  readonly readbackObserved: Record<string, unknown> | null;
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
  const stateEvidence: StateEvidence[] = [];
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

  const projectId = "m3-temporal-interpolation-p1-p2-real-ae";
  const prefix = `M3_TEMPORAL_P12_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layerStable = `${prefix}_LAYER`;
  const propertyPath = ["ADBE Transform Group", "ADBE Opacity"] as const;
  const keyIndex = 2;
  let operationCounter = 0;
  let requestCounter = 0;

  const recordV11 = (command: string, response: AeAdapterResponseV11): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
    });
  };

  const recordV17 = (response: AeTemporalInterpolationResponseV17): void => {
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
      readbackProfile: "M3_TEMPORAL_INTERPOLATION_P1_P2_SETUP",
    });
    recordV11(command, response);
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
    if (broker === null) throw new Error("M3 temporal-interpolation broker is not initialized.");
    operationCounter += 1;
    const request = buildTemporalInterpolationRequestV17({
      requestId: `m3-temporal-p12-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V17_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_TEMPORAL_INTERPOLATION_P1_P2_STRUCTURAL",
    });
    const response = await broker.dispatch(request);
    recordV17(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const targetPayload = (): Readonly<Record<string, unknown>> => ({
    comp: { stableId: targetStable },
    layer: { stableId: layerStable },
    propertyPath,
    keyIndex,
  });

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
    action: () => Promise<AeTemporalInterpolationResponseV17>,
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

  const proveState = async (label: string, desired: AeTemporalInterpolationStateV17): Promise<void> => {
    if (hostRevision === null) throw new Error("Host revision is unavailable before temporal interpolation mutation.");
    const beforeRevision = hostRevision;
    const setResponse = await dispatchV17("property.temporal_interpolation.set", {
      ...targetPayload(),
      interpolation: desired,
    }, beforeRevision);
    const setExact = setResponse.outcome === "APPLIED" && stateMatches(setResponse, desired);
    checks[`p2_${label}_set_exact`] = setExact;
    checks[`p2_${label}_revision_advanced`] = typeof setResponse.hostProjectRevision === "number"
      && setResponse.hostProjectRevision >= beforeRevision;

    const readResponse = await dispatchV17("property.temporal_interpolation.readback", targetPayload(), null);
    checks[`p2_${label}_readback_exact`] = readResponse.outcome === "NO_OP" && stateMatches(readResponse, desired);
    const temporal = temporalRecord(readResponse);
    checks[`p2_${label}_key_identity_exact`] = temporal?.["keyIndex"] === keyIndex
      && typeof temporal["keyTime"] === "number"
      && Math.abs((temporal["keyTime"] as number) - 0.5) < 0.000001;

    stateEvidence.push({
      label,
      requested: desired,
      setOutcome: setResponse.outcome,
      setObserved: temporalState(setResponse),
      readbackOutcome: readResponse.outcome,
      readbackObserved: temporalState(readResponse),
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
      supportedProtocolVersions: [AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v17 = panel.protocolVersion === AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17;
    checks.panel_supports_v11_v17 = panel.supportedProtocolVersions.includes(AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v17 || !checks.panel_supports_v11_v17) {
      throw new Error(`Temporal-interpolation proof requires negotiated protocol ${AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17} with baseline 1.1 fixture compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-temporal-setup-${++requestCounter}`,
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
      propertyPath,
      keyframes: [
        { time: 0, value: 10 },
        { time: 0.5, value: 90 },
        { time: 1, value: 30 },
      ],
    });

    const initialRead = await dispatchV17("property.temporal_interpolation.readback", targetPayload(), null);
    const support = supportedTypes(initialRead);
    const initialTemporal = temporalRecord(initialRead);
    checks.p2_initial_readback = initialRead.outcome === "NO_OP"
      && initialTemporal?.["keyIndex"] === keyIndex
      && typeof initialTemporal["keyTime"] === "number"
      && Math.abs((initialTemporal["keyTime"] as number) - 0.5) < 0.000001;
    checks.p2_opacity_supports_linear = support?.["LINEAR"] === true;
    checks.p2_opacity_supports_bezier = support?.["BEZIER"] === true;
    checks.p2_opacity_supports_hold = support?.["HOLD"] === true;

    await proveRejectedWithoutMutation("p1_bad_key", async () => dispatchV17(
      "property.temporal_interpolation.readback",
      { ...targetPayload(), keyIndex: 99 },
      null,
    ), "KEY_INDEX_OUT_OF_RANGE");

    await proveRejectedWithoutMutation("p1_bad_path", async () => dispatchV17(
      "property.temporal_interpolation.readback",
      { ...targetPayload(), propertyPath: ["ADBE Transform Group", "ADBE DOES NOT EXIST"] },
      null,
    ), "PROPERTY_PATH_NOT_FOUND");

    await proveRejectedWithoutMutation("p1_non_bezier_flag", async () => dispatchV17(
      "property.temporal_interpolation.set",
      {
        ...targetPayload(),
        interpolation: {
          inType: "LINEAR",
          outType: "LINEAR",
          temporalContinuous: true,
          temporalAutoBezier: false,
        },
      },
      hostRevision,
    ), "TEMPORAL_BEZIER_FLAG_REQUIRES_BEZIER");

    await proveRejectedWithoutMutation("p1_stale_revision", async () => dispatchV17(
      "property.temporal_interpolation.set",
      {
        ...targetPayload(),
        interpolation: {
          inType: "LINEAR",
          outType: "LINEAR",
          temporalContinuous: false,
          temporalAutoBezier: false,
        },
      },
      (hostRevision ?? 0) + 1000,
    ), "HOST_REVISION_CONFLICT");

    await proveState("mixed_bezier_linear", {
      inType: "BEZIER",
      outType: "LINEAR",
      temporalContinuous: false,
      temporalAutoBezier: false,
    });
    await proveState("bezier_continuous", {
      inType: "BEZIER",
      outType: "BEZIER",
      temporalContinuous: true,
      temporalAutoBezier: false,
    });
    await proveState("bezier_auto", {
      inType: "BEZIER",
      outType: "BEZIER",
      temporalContinuous: true,
      temporalAutoBezier: true,
    });
    await proveState("hold", {
      inType: "HOLD",
      outType: "HOLD",
      temporalContinuous: false,
      temporalAutoBezier: false,
    });
    await proveState("linear", {
      inType: "LINEAR",
      outType: "LINEAR",
      temporalContinuous: false,
      temporalAutoBezier: false,
    });

    if (hostRevision === null) throw new Error("Host revision unavailable before no-op proof.");
    const noOpRevision = hostRevision;
    const noOp = await dispatchV17("property.temporal_interpolation.set", {
      ...targetPayload(),
      interpolation: {
        inType: "LINEAR",
        outType: "LINEAR",
        temporalContinuous: false,
        temporalAutoBezier: false,
      },
    }, noOpRevision);
    checks.p2_exact_noop = noOp.outcome === "NO_OP" && stateMatches(noOp, {
      inType: "LINEAR",
      outType: "LINEAR",
      temporalContinuous: false,
      temporalAutoBezier: false,
    });
    checks.p2_noop_revision_unchanged = noOp.hostProjectRevision === noOpRevision;
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
      checks.p1_non_bezier_flag_rejected,
      checks.p1_non_bezier_flag_revision_unchanged,
      checks.p1_non_bezier_flag_fingerprint_unchanged,
      checks.p1_stale_revision_rejected,
      checks.p1_stale_revision_revision_unchanged,
      checks.p1_stale_revision_fingerprint_unchanged,
    );
    const p2 = allChecksTrue(
      checks.p2_initial_readback,
      checks.p2_opacity_supports_linear,
      checks.p2_opacity_supports_bezier,
      checks.p2_opacity_supports_hold,
      checks.p2_mixed_bezier_linear_set_exact,
      checks.p2_mixed_bezier_linear_readback_exact,
      checks.p2_mixed_bezier_linear_key_identity_exact,
      checks.p2_bezier_continuous_set_exact,
      checks.p2_bezier_continuous_readback_exact,
      checks.p2_bezier_continuous_key_identity_exact,
      checks.p2_bezier_auto_set_exact,
      checks.p2_bezier_auto_readback_exact,
      checks.p2_bezier_auto_key_identity_exact,
      checks.p2_hold_set_exact,
      checks.p2_hold_readback_exact,
      checks.p2_hold_key_identity_exact,
      checks.p2_linear_set_exact,
      checks.p2_linear_readback_exact,
      checks.p2_linear_key_identity_exact,
      checks.p2_exact_noop,
      checks.p2_noop_revision_unchanged,
    );
    const proofLevels = {
      P1_validation_rejection: p1,
      P2_structural_readback: p2,
      P3_visual_proof: false,
      P4_failure_injection_rollback: false,
      P5_save_reopen_reconnect_transfer: false,
    };
    const ok = failureError === null
      && checks.panel_negotiated_v17 === true
      && checks.panel_supports_v11_v17 === true
      && checks.host_probe === true
      && p1
      && p2
      && cleanupComplete;

    await writeJson(resultPath, {
      schemaVersion: 1,
      proof: "M3_TEMPORAL_INTERPOLATION_P1_P2_REAL_AE",
      protocolVersion: AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17,
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
        propertyPath,
        keyIndex,
        keyTime: 0.5,
      },
      baseline: { projectFingerprint: baselineFingerprint, itemCount: baselineItemCount },
      final: { projectFingerprint: finalFingerprint, itemCount: finalItemCount },
      stateEvidence,
      responses,
      cleanupComplete,
      cleanupErrors,
      failureError,
      limitations: [
        "This artifact proves only P1 deterministic rejection and P2 exact structural readback on a disposable Opacity keyframe fixture.",
        "P3 visual proof, P4 induced-failure rollback, P5 save/reopen/reconnect transfer, numeric temporal ease/influence, spatial tangents/roving, and motion-blur/frame-blending controls are not claimed.",
      ],
    });

    if (!ok) process.exitCode = 1;
  }
};

await main();
