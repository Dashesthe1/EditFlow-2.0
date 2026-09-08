import { createHash } from "node:crypto";
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
  type AeTemporalInterpolationResponseV17,
  type AeTemporalInterpolationStateV17,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_7.js";
import { buildTemporalInterpolationRequestV17 } from "../../../packages/adapters/ae-cep/src/m3-temporal-interpolation.js";
import {
  AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18,
  type AeTemporalEaseResponseV18,
  type AeTemporalEaseStateV18,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_8.js";
import { buildTemporalEaseRequestV18 } from "../../../packages/adapters/ae-cep/src/m3-temporal-ease.js";
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

interface AcceptedP1P4 {
  readonly schemaVersion: 1;
  readonly proofId: "M3_TEMPORAL_EASE_P1_P4_ACCEPTANCE";
  readonly protocolVersion: "1.8.0";
  readonly accepted: true;
  readonly proofLevels: {
    readonly P1_validation_rejection: true;
    readonly P2_structural_readback: true;
    readonly P3_visual_proof: true;
    readonly P4_failure_injection_rollback: true;
  };
  readonly [key: string]: unknown;
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

const parseConfig = (value: unknown): BridgeConfigFile => {
  const candidate = asRecord(value);
  if (candidate === null) throw new Error("Bridge config must be an object.");
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
    throw new Error("CEP bridge config does not advertise required 1.8, 1.7, and 1.1 protocols.");
  }
  if (typeof candidate["extensionId"] !== "string" || candidate["extensionId"].length === 0) throw new Error("CEP extensionId is missing.");
  if (typeof candidate["extensionVersion"] !== "string" || candidate["extensionVersion"].length === 0) throw new Error("CEP extensionVersion is missing.");
  return candidate as unknown as BridgeConfigFile;
};

const parseAcceptedP1P4 = (value: unknown): AcceptedP1P4 => {
  const candidate = asRecord(value);
  if (candidate === null) throw new Error("Accepted P1-P4 record must be an object.");
  if (candidate["schemaVersion"] !== 1
      || candidate["proofId"] !== "M3_TEMPORAL_EASE_P1_P4_ACCEPTANCE"
      || candidate["protocolVersion"] !== AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18
      || candidate["accepted"] !== true) {
    throw new Error("Accepted P1-P4 record identity is invalid or not accepted.");
  }
  const levels = asRecord(candidate["proofLevels"]);
  if (levels === null
      || levels["P1_validation_rejection"] !== true
      || levels["P2_structural_readback"] !== true
      || levels["P3_visual_proof"] !== true
      || levels["P4_failure_injection_rollback"] !== true) {
    throw new Error("Accepted P1-P4 record does not truthfully bind all prerequisite proof levels.");
  }
  return candidate as unknown as AcceptedP1P4;
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const nestedRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = asRecord(value);
  return record === null ? null : asRecord(record[key]);
};

const closeNumber = (left: unknown, right: number): boolean =>
  typeof left === "number" && Math.abs(left - right) <= 0.0000001;

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
  const temporal = nestedRecord(response.readback, "temporalEase");
  const state = temporal === null ? null : asRecord(temporal["state"]);
  return state !== null
    && easeArrayMatches(state["inEase"], expected.inEase)
    && easeArrayMatches(state["outEase"], expected.outEase);
};

const easeCardinality = (response: AeTemporalEaseResponseV18): number | null => {
  const temporal = nestedRecord(response.readback, "temporalEase");
  const property = temporal === null ? null : asRecord(temporal["property"]);
  return property !== null && typeof property["easeCardinality"] === "number" ? property["easeCardinality"] : null;
};

const easeKeyIdentityMatches = (response: AeTemporalEaseResponseV18, keyIndex: number, keyTime: number): boolean => {
  const temporal = nestedRecord(response.readback, "temporalEase");
  return temporal !== null && temporal["keyIndex"] === keyIndex && closeNumber(temporal["keyTime"], keyTime);
};

const interpolationStateMatches = (response: AeTemporalInterpolationResponseV17, expected: AeTemporalInterpolationStateV17): boolean => {
  const temporal = nestedRecord(response.readback, "temporalInterpolation");
  const state = temporal === null ? null : asRecord(temporal["state"]);
  return state !== null
    && state["inType"] === expected.inType
    && state["outType"] === expected.outType
    && state["temporalContinuous"] === expected.temporalContinuous
    && state["temporalAutoBezier"] === expected.temporalAutoBezier;
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
      const parsed = JSON.parse(stripUtf8Bom(await readFile(filePath, "utf8"))) as unknown;
      const marker = asRecord(parsed);
      if (marker === null) throw new Error("proof marker must be an object");
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
  const acceptedP1P4Path = requireArgument("--accepted-p1-p4");
  const timeoutMs = Number(argument("--timeout-ms") ?? "180000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const acceptedP1P4Bytes = await readFile(acceptedP1P4Path);
  const acceptedP1P4 = parseAcceptedP1P4(JSON.parse(stripUtf8Bom(acceptedP1P4Bytes.toString("utf8"))) as unknown);
  const acceptedP1P4Sha256 = createHash("sha256").update(acceptedP1P4Bytes).digest("hex");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const projectPath = path.join(artifactDir, "m3-temporal-ease-p5-transfer.aep");
  const reopenMarkerPath = path.join(artifactDir, "reopen-result.json");
  const cleanupMarkerPath = path.join(artifactDir, "cleanup-result.json");
  const checks: Record<string, boolean> = { accepted_p1_p4_verified: true };
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

  const projectId = "m3-temporal-ease-p5-real-ae";
  const prefix = `M3_TEMPORAL_EASE_P5_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layerStable = `${prefix}_LAYER`;
  const opacityPath = ["ADBE Transform Group", "ADBE Opacity"] as const;
  const scalePath = ["ADBE Transform Group", "ADBE Scale"] as const;
  const keyIndex = 2;
  const keyTime = 0.5;
  const manualBezier: AeTemporalInterpolationStateV17 = Object.freeze({
    inType: "BEZIER",
    outType: "BEZIER",
    temporalContinuous: false,
    temporalAutoBezier: false,
  });
  const savedOpacityEase: AeTemporalEaseStateV18 = Object.freeze({
    inEase: Object.freeze([{ speed: 37.5, influence: 26.25 }]),
    outEase: Object.freeze([{ speed: 142.75, influence: 73.5 }]),
  });
  const transferredScaleEase: AeTemporalEaseStateV18 = Object.freeze({
    inEase: Object.freeze([
      { speed: 18.25, influence: 32.5 },
      { speed: 41.5, influence: 47.25 },
      { speed: 72.25, influence: 58.75 },
    ]),
    outEase: Object.freeze([
      { speed: 95.75, influence: 69.5 },
      { speed: 63.25, influence: 54.75 },
      { speed: 128.5, influence: 61.25 },
    ]),
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

  const recordV18 = (response: AeTemporalEaseResponseV18): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command: response.command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
      notes: response.diagnostics.notes,
    });
  };

  const refreshState = async (): Promise<AeProjectSnapshot> => {
    if (client === null) throw new Error("M3 temporal-ease P5 client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
    return observed.project;
  };

  const executeV11 = async (
    command: AeAdapterPublicCommandV11,
    payload: Readonly<Record<string, unknown>>,
    readbackProfile = "M3_TEMPORAL_EASE_P5_TRANSFER",
  ): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M3 temporal-ease P5 client state is not initialized.");
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_OP_${++operationCounter}`,
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
    command: "property.temporal_interpolation.set" | "property.temporal_interpolation.readback",
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile: string,
  ): Promise<AeTemporalInterpolationResponseV17> => {
    if (broker === null) throw new Error("M3 temporal-ease P5 broker is not initialized.");
    const response = await broker.dispatch(buildTemporalInterpolationRequestV17({
      requestId: `m3-temporal-ease-p5-v17-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V17_OP_${++operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    }));
    recordV17(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const dispatchV18 = async (
    command: "property.temporal_ease.set" | "property.temporal_ease.readback",
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile: string,
  ): Promise<AeTemporalEaseResponseV18> => {
    if (broker === null) throw new Error("M3 temporal-ease P5 broker is not initialized.");
    const response = await broker.dispatch(buildTemporalEaseRequestV18({
      requestId: `m3-temporal-ease-p5-v18-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V18_OP_${++operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    }));
    recordV18(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const createClient = (): AeCepAdapterClientV11 => {
    if (broker === null) throw new Error("M3 temporal-ease P5 broker is not initialized.");
    return new AeCepAdapterClientV11(
      broker,
      () => `m3-temporal-ease-p5-v11-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );
  };

  const targetPayload = (propertyPath: readonly (string | number)[]): Readonly<Record<string, unknown>> => ({
    comp: { stableId: targetStable },
    layer: { stableId: layerStable },
    propertyPath,
    keyIndex,
  });

  const establishManualBezier = async (propertyPath: readonly (string | number)[], label: string): Promise<void> => {
    if (hostRevision === null) throw new Error(`Host revision unavailable before ${label} manual-BEZIER setup.`);
    const set = await dispatchV17("property.temporal_interpolation.set", {
      ...targetPayload(propertyPath),
      interpolation: manualBezier,
    }, hostRevision, `M3_TEMPORAL_EASE_P5_${label}_INTERPOLATION_SET`);
    if ((set.outcome !== "APPLIED" && set.outcome !== "NO_OP") || !interpolationStateMatches(set, manualBezier)) {
      throw new Error(`${label} manual-BEZIER setup failed: ${set.error?.code ?? set.outcome}`);
    }
    const read = await dispatchV17(
      "property.temporal_interpolation.readback",
      targetPayload(propertyPath),
      null,
      `M3_TEMPORAL_EASE_P5_${label}_INTERPOLATION_READ`,
    );
    if (read.outcome !== "NO_OP" || !interpolationStateMatches(read, manualBezier)) {
      throw new Error(`${label} manual-BEZIER readback is not exact.`);
    }
  };

  const setEaseExact = async (
    propertyPath: readonly (string | number)[],
    desired: AeTemporalEaseStateV18,
    cardinality: number,
    label: string,
  ): Promise<void> => {
    if (hostRevision === null) throw new Error(`Host revision unavailable before ${label} temporal-ease mutation.`);
    const set = await dispatchV18("property.temporal_ease.set", {
      ...targetPayload(propertyPath),
      ease: desired,
    }, hostRevision, `M3_TEMPORAL_EASE_P5_${label}_SET`);
    if (set.outcome !== "APPLIED" || !easeStateMatches(set, desired) || easeCardinality(set) !== cardinality || !easeKeyIdentityMatches(set, keyIndex, keyTime)) {
      throw new Error(`${label} temporal-ease mutation did not apply exactly: ${set.error?.code ?? set.outcome}`);
    }
    const read = await dispatchV18(
      "property.temporal_ease.readback",
      targetPayload(propertyPath),
      null,
      `M3_TEMPORAL_EASE_P5_${label}_READ`,
    );
    if (read.outcome !== "NO_OP" || !easeStateMatches(read, desired) || easeCardinality(read) !== cardinality || !easeKeyIdentityMatches(read, keyIndex, keyTime)) {
      throw new Error(`${label} temporal-ease readback is not exact.`);
    }
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

    const config = parseConfig(JSON.parse(stripUtf8Bom(await readFile(configPath, "utf8"))) as unknown);
    panelExtensionVersion = config.extensionVersion;

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

    const firstPanel = await broker.waitForPanel(timeoutMs);
    initialSession = sessionEvidence(firstPanel);
    checks.initial_panel_negotiated_v18 = firstPanel.protocolVersion === AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18;
    checks.initial_panel_supports_v11_v17_v18 = firstPanel.supportedProtocolVersions.includes(AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18)
      && firstPanel.supportedProtocolVersions.includes(AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17)
      && firstPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.initial_panel_negotiated_v18 || !checks.initial_panel_supports_v11_v17_v18) {
      throw new Error("M3 temporal-ease P5 requires authenticated protocol 1.8 with accepted 1.7 and baseline 1.1 compatibility.");
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
    if (!checks.blank_baseline) throw new Error("M3 temporal-ease P5 requires a blank unsaved runner-owned project baseline.");

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
      propertyPath: opacityPath,
      keyframes: [
        { time: 0, value: 10 },
        { time: keyTime, value: 90 },
        { time: 1, value: 30 },
      ],
    });

    await establishManualBezier(opacityPath, "OPACITY_SAVED");
    await setEaseExact(opacityPath, savedOpacityEase, 1, "OPACITY_SAVED");
    checks.pre_save_opacity_ease_exact = true;

    if (client === null) throw new Error("M3 temporal-ease P5 client disappeared before save.");
    const preSaveObserved = await client.observe(projectId);
    state = preSaveObserved.observed;
    hostRevision = preSaveObserved.hostRevision;
    checks.pre_save_fixture_shape = preSaveObserved.project.itemCount === 2
      && preSaveObserved.project.items.some((item) => item.stableId === sourceStable && item.kind === "COMPOSITION")
      && preSaveObserved.project.items.some((item) => item.stableId === targetStable && item.kind === "COMPOSITION")
      && findLayerIndex(preSaveObserved.project, targetStable, layerStable) === 1;

    const saveResponse = await executeV11("project.save", { path: projectPath }, "M3_TEMPORAL_EASE_P5_SAVE");
    checks.project_save_applied = saveResponse.outcome === "APPLIED" || saveResponse.outcome === "NO_OP";
    checks.saved_project_artifact = await fileExistsNonEmpty(projectPath);
    if (!checks.saved_project_artifact) throw new Error("M3 temporal-ease P5 project.save did not produce a non-empty .aep artifact.");

    if (client === null) throw new Error("M3 temporal-ease P5 client disappeared after save.");
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
      throw new Error("M3 temporal-ease P5 saved-project structural readback is incomplete.");
    }

    await launchAfterFxScript(afterFxPath, reopenScriptPath);
    reopenMarker = await waitForMarker(reopenMarkerPath, "M3_TEMPORAL_EASE_P5_REOPEN", timeoutMs);
    checks.reopen_script_passed = reopenMarker.ok === true
      && reopenMarker["dispatcherReady"] === true
      && typeof reopenMarker["projectPath"] === "string"
      && sameFilesystemPath(reopenMarker["projectPath"] as string, projectPath)
      && reopenMarker["itemCount"] === savedItemCount;
    if (!checks.reopen_script_passed) {
      throw new Error(`M3 temporal-ease P5 reopen proof failed: ${reopenMarker.error ?? "invalid marker"}`);
    }

    if (initialSession === null) throw new Error("M3 temporal-ease P5 initial CEP session evidence is missing.");
    const firstSessionId = initialSession.sessionId;
    await broker.stop();
    await sleep(300);
    const reboundPort = await broker.start();
    if (reboundPort !== config.port) throw new Error(`CEP broker rebound unexpected port ${reboundPort}.`);
    const secondPanel = await broker.waitForPanel(timeoutMs);
    reconnectedSession = sessionEvidence(secondPanel);
    checks.authenticated_reconnect = secondPanel.sessionId !== firstSessionId
      && secondPanel.protocolVersion === AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18
      && secondPanel.supportedProtocolVersions.includes(AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18)
      && secondPanel.supportedProtocolVersions.includes(AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17)
      && secondPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)
      && secondPanel.extensionId === config.extensionId
      && secondPanel.extensionVersion === config.extensionVersion;
    if (!checks.authenticated_reconnect) {
      throw new Error("M3 temporal-ease P5 did not establish a distinct authenticated protocol-1.8 CEP session after reopen.");
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

    const reopenedEase = await dispatchV18(
      "property.temporal_ease.readback",
      targetPayload(opacityPath),
      null,
      "M3_TEMPORAL_EASE_P5_OPACITY_AFTER_REOPEN",
    );
    checks.opacity_ease_exact_after_reopen_reconnect = reopenedEase.outcome === "NO_OP"
      && easeStateMatches(reopenedEase, savedOpacityEase)
      && easeCardinality(reopenedEase) === 1
      && easeKeyIdentityMatches(reopenedEase, keyIndex, keyTime);
    if (!checks.opacity_ease_exact_after_reopen_reconnect) {
      throw new Error("M3 temporal-ease P5 saved Opacity ease changed across save/reopen/reconnect.");
    }

    await executeV11("property.set_keyframes", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      propertyPath: scalePath,
      keyframes: [
        { time: 0, value: [100, 100, 100] },
        { time: keyTime, value: [140, 80, 115] },
        { time: 1, value: [75, 135, 90] },
      ],
    });
    await establishManualBezier(scalePath, "SCALE_TRANSFERRED");
    const scaleCardinalityProbe = await dispatchV18(
      "property.temporal_ease.readback",
      targetPayload(scalePath),
      null,
      "M3_TEMPORAL_EASE_P5_SCALE_CARDINALITY_PROBE",
    );
    checks.scale_live_cardinality_three = scaleCardinalityProbe.outcome === "NO_OP"
      && easeCardinality(scaleCardinalityProbe) === 3
      && easeKeyIdentityMatches(scaleCardinalityProbe, keyIndex, keyTime);
    if (!checks.scale_live_cardinality_three) {
      throw new Error(`M3 temporal-ease P5 live Scale property did not expose the expected three-component ease surface: ${scaleCardinalityProbe.error?.code ?? scaleCardinalityProbe.outcome}`);
    }
    await setEaseExact(scalePath, transferredScaleEase, 3, "SCALE_TRANSFERRED");
    checks.post_reconnect_scale_mutation_readback = true;

    await launchAfterFxScript(afterFxPath, cleanupScriptPath);
    cleanupMarker = await waitForMarker(cleanupMarkerPath, "M3_TEMPORAL_EASE_P5_CLEANUP", timeoutMs);
    checks.proof_cleanup_script_passed = cleanupMarker.ok === true
      && cleanupMarker["proofPrefix"] === prefix
      && cleanupMarker["blankItemCount"] === 0
      && typeof cleanupMarker["retainedProjectPath"] === "string"
      && sameFilesystemPath(cleanupMarker["retainedProjectPath"] as string, projectPath);
    checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);

    if (client === null) throw new Error("M3 temporal-ease P5 client disappeared before final cleanup verification.");
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
        const recoveryCleanup = await waitForMarker(cleanupMarkerPath, "M3_TEMPORAL_EASE_P5_CLEANUP", Math.min(timeoutMs, 30_000));
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
      && checks.accepted_p1_p4_verified === true
      && checks.proof_scripts_present === true
      && checks.afterfx_present === true
      && checks.initial_panel_negotiated_v18 === true
      && checks.initial_panel_supports_v11_v17_v18 === true
      && checks.host_probe === true
      && checks.blank_baseline === true
      && checks.source_created === true
      && checks.target_created === true
      && checks.pre_save_opacity_ease_exact === true
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
      && checks.opacity_ease_exact_after_reopen_reconnect === true
      && checks.scale_live_cardinality_three === true
      && checks.post_reconnect_scale_mutation_readback === true
      && checks.proof_cleanup_script_passed === true
      && checks.saved_project_retained_after_cleanup === true
      && checks.cleanup_blank_project === true
      && checks.cleanup_fingerprint_restored === true
      && cleanupComplete;

    await writeJson(resultPath, {
      schemaVersion: 1,
      proofId: "M3_TEMPORAL_EASE_P5_REAL_AE",
      protocolVersion: AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18,
      status: ok ? "PASS" : "FAILURE",
      ok,
      startedAt,
      completedAt: new Date().toISOString(),
      acceptedP1P4: {
        path: acceptedP1P4Path,
        sha256: acceptedP1P4Sha256,
        record: acceptedP1P4,
      },
      proofLevels: {
        P1_validation_rejection: "accepted-prerequisite",
        P2_structural_readback: "accepted-prerequisite",
        P3_visual_proof: "accepted-prerequisite",
        P4_failure_injection_rollback: "accepted-prerequisite",
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
        opacityPath,
        scalePath,
        keyIndex,
        keyTime,
        manualBezier,
        savedOpacityEase,
        transferredScaleEase,
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
        "P5 refuses to start unless a retained acceptance record explicitly binds protocol-1.8 P1 validation, P2 structural readback, independently reviewed P3 visual proof, and P4 rollback.",
        "The saved fixture uses a scalar Opacity KeyframeEase state under explicit protocol-1.7 manual-BEZIER/continuity preconditions, then saves through the accepted public v1.1 project.save route.",
        "After Effects closes and reopens only the fixed runner-owned .aep, reloads the additive protocol-1.8 dispatcher, and the loopback broker is restarted so the panel must establish a distinct authenticated 1.8 session.",
        "Post-reconnect readback must recover the exact saved scalar Opacity ease before any new mutation.",
        "Fresh-session transfer is then exercised on the live Scale property. The proof first reads and asserts its three-component temporal-ease cardinality, then writes three independent incoming and outgoing KeyframeEase objects and requires exact readback.",
        "The saved .aep is retained as evidence; proof-only cleanup discards only the exact verified disposable project and restores the original blank structural fingerprint.",
      ],
      limitations: [
        "This draft P5 harness is not itself acceptance evidence until executed on the declared real-AE runner with a valid retained P1-P4 acceptance record.",
        "Spatial tangents, roving keyframes, markers, motion blur, frame blending, and shutter controls remain later roadmap tranches.",
      ],
    });

    if (!ok) process.exitCode = 1;
  }
};

await main();
