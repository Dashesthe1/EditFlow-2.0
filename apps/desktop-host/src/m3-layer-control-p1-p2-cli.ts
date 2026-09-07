import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  type AeAdapterPublicCommandV11,
  type AeAdapterResponseV11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  AE_LAYER_CONTROL_PROTOCOL_VERSION_V16,
  type AeLayerControlCommandV16,
  type AeLayerControlResponseV16,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_6.js";
import { buildLayerControlRequestV16 } from "../../../packages/adapters/ae-cep/src/m3-layer-control.js";
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
const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const parseConfig = (value: unknown): BridgeConfigFile => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Bridge config must be an object.");
  const candidate = value as Record<string, unknown>;
  if (candidate["schemaVersion"] !== 1) throw new Error("Unsupported bridge config schemaVersion.");
  if (candidate["host"] !== "127.0.0.1") throw new Error("CEP bridge config host must be 127.0.0.1.");
  if (!Number.isInteger(candidate["port"]) || (candidate["port"] as number) < 1 || (candidate["port"] as number) > 65535) throw new Error("CEP bridge config port is invalid.");
  if (typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("CEP bridge token is invalid.");
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("CEP bridge legacy protocolVersion mismatch.");
  const supported = candidate["supportedProtocolVersions"];
  if (!Array.isArray(supported) || !supported.includes(AE_LAYER_CONTROL_PROTOCOL_VERSION_V16) || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise required layer-control 1.6 and baseline 1.1 protocols.");
  }
  if (typeof candidate["extensionId"] !== "string" || candidate["extensionId"].length === 0) throw new Error("CEP extensionId is missing.");
  if (typeof candidate["extensionVersion"] !== "string" || candidate["extensionVersion"].length === 0) throw new Error("CEP extensionVersion is missing.");
  return candidate as unknown as BridgeConfigFile;
};

const layerControls = (response: AeLayerControlResponseV16): Record<string, unknown> | null =>
  nestedRecord(response.readback, "layerControls");
const switchValues = (response: AeLayerControlResponseV16): Record<string, unknown> | null =>
  nestedRecord(layerControls(response), "switches") === null ? null : nestedRecord(nestedRecord(layerControls(response), "switches"), "values");
const orderRecord = (response: AeLayerControlResponseV16): Record<string, unknown> | null =>
  nestedRecord(layerControls(response), "order");
const stableIdOf = (value: unknown): string | null => {
  const record = asRecord(value);
  return record !== null && typeof record["stableId"] === "string" ? record["stableId"] as string : null;
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
  let baselineFingerprint: string | null = null;
  let baselineItemCount: number | null = null;
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null;
  let environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;
  let staleResponse: AeLayerControlResponseV16 | null = null;
  let switchResponse: AeLayerControlResponseV16 | null = null;
  let absoluteOrderResponse: AeLayerControlResponseV16 | null = null;
  let relativeOrderResponse: AeLayerControlResponseV16 | null = null;
  let finalReadbackResponse: AeLayerControlResponseV16 | null = null;

  const projectId = "m3-layer-control-p1-p2-real-ae";
  const prefix = `M3_LAYER_CONTROL_P12_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceA = `${prefix}_SOURCE_A`;
  const sourceB = `${prefix}_SOURCE_B`;
  const sourceC = `${prefix}_SOURCE_C`;
  const target = `${prefix}_TARGET`;
  const layerA = `${prefix}_LAYER_A`;
  const layerB = `${prefix}_LAYER_B`;
  const layerC = `${prefix}_LAYER_C`;
  let operationCounter = 0;
  let requestCounter = 0;

  const recordV11 = (command: string, response: AeAdapterResponseV11): void => {
    responses.push({ protocolVersion: response.protocolVersion, command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision });
  };
  const recordV16 = (response: AeLayerControlResponseV16): void => {
    responses.push({ protocolVersion: response.protocolVersion, command: response.command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision });
  };
  const refreshState = async (): Promise<void> => {
    if (client === null) throw new Error("M2 setup client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
    projectSnapshot = observed.project;
  };
  const executeV11 = async (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M2 setup state is not initialized.");
    operationCounter += 1;
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_OP_${operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M3_LAYER_CONTROL_P1_P2_SETUP",
    });
    recordV11(command, response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    await refreshState();
    return response;
  };
  const dispatchV16 = async (
    command: AeLayerControlCommandV16,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
  ): Promise<AeLayerControlResponseV16> => {
    if (broker === null) throw new Error("M3 layer-control broker is not initialized.");
    operationCounter += 1;
    const request = buildLayerControlRequestV16({
      requestId: `m3-layer-control-p12-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V16_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_LAYER_CONTROL_P1_P2_STRUCTURAL",
    });
    const response = await broker.dispatch(request);
    recordV16(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };
  const cleanupComp = async (stableId: string): Promise<void> => {
    if (client === null) return;
    try {
      await refreshState();
      if (projectSnapshot === null) return;
      if (projectSnapshot.items.some((item) => item.kind === "COMPOSITION" && item.stableId === stableId)) await executeV11("comp.remove", { comp: { stableId } });
    } catch (error) {
      cleanupErrors.push(`${stableId}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
      supportedProtocolVersions: [AE_LAYER_CONTROL_PROTOCOL_VERSION_V16, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v16 = panel.protocolVersion === AE_LAYER_CONTROL_PROTOCOL_VERSION_V16;
    checks.panel_supports_v11_v16 = panel.supportedProtocolVersions.includes(AE_LAYER_CONTROL_PROTOCOL_VERSION_V16)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v16 || !checks.panel_supports_v11_v16) throw new Error("Layer-control proof requires negotiated protocol 1.6 with baseline 1.1 fixture compatibility.");
    if (panel.extensionVersion !== config.extensionVersion) throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);

    client = new AeCepAdapterClientV11(broker, () => `m3-layer-control-setup-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects" && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    projectSnapshot = baseline.project;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;

    for (const [stableId, label] of [[sourceA, "A"], [sourceB, "B"], [sourceC, "C"]] as const) {
      await executeV11("comp.create", { stableId, name: `${prefix} Source ${label}`, width: 320, height: 180, pixelAspect: 1, duration: 1, frameRate: 24 });
    }
    await executeV11("comp.create", { stableId: target, name: `${prefix} Target`, width: 640, height: 360, pixelAspect: 1, duration: 1, frameRate: 24 });
    await executeV11("layer.add_media", { stableId: layerA, comp: { stableId: target }, item: { stableId: sourceA } });
    await executeV11("layer.add_media", { stableId: layerB, comp: { stableId: target }, item: { stableId: sourceB } });
    await executeV11("layer.add_media", { stableId: layerC, comp: { stableId: target }, item: { stableId: sourceC } });

    if (hostRevision === null) throw new Error("Host revision unavailable after fixture setup.");
    const beforeP1 = await client.observe(projectId);
    const staleExpectedRevision = hostRevision + 1000;
    staleResponse = await dispatchV16("layer.switches.set", {
      comp: { stableId: target }, layer: { stableId: layerA }, switches: { solo: true },
    }, staleExpectedRevision);
    const afterP1 = await client.observe(projectId);
    checks.p1_stale_switch_rejected = staleResponse.outcome === "REJECTED" && staleResponse.error?.code === "HOST_REVISION_CONFLICT";
    checks.p1_stale_switch_fingerprint_unchanged = beforeP1.observed.projectFingerprint === afterP1.observed.projectFingerprint;
    if (!checks.p1_stale_switch_rejected || !checks.p1_stale_switch_fingerprint_unchanged) throw new Error("P1 stale-revision layer switch rejection was not mutation-free.");
    hostRevision = afterP1.hostRevision;
    state = afterP1.observed;
    projectSnapshot = afterP1.project;

    if (hostRevision === null) throw new Error("Host revision unavailable before P2 switch mutation.");
    switchResponse = await dispatchV16("layer.switches.set", {
      comp: { stableId: target },
      layer: { stableId: layerA },
      switches: { enabled: false, solo: true, shy: true, locked: false, threeDLayer: true },
    }, hostRevision);
    const switches = switchValues(switchResponse);
    checks.p2_switch_apply = switchResponse.outcome === "APPLIED";
    checks.p2_switch_exact_readback = switches?.["enabled"] === false
      && switches?.["solo"] === true
      && switches?.["shy"] === true
      && switches?.["locked"] === false
      && switches?.["threeDLayer"] === true;
    if (!checks.p2_switch_apply || !checks.p2_switch_exact_readback) throw new Error("P2 switch mutation did not return exact AE readback.");

    if (hostRevision === null) throw new Error("Host revision unavailable before P2 absolute ordering.");
    absoluteOrderResponse = await dispatchV16("layer.order.set", {
      comp: { stableId: target }, layer: { stableId: layerA }, placement: { position: "BEGINNING" },
    }, hostRevision);
    const absoluteOrder = orderRecord(absoluteOrderResponse);
    checks.p2_absolute_order_apply = absoluteOrderResponse.outcome === "APPLIED";
    checks.p2_absolute_order_exact_readback = absoluteOrder?.["index"] === 1;
    if (!checks.p2_absolute_order_apply || !checks.p2_absolute_order_exact_readback) throw new Error("P2 absolute ordering was not proven by exact AE readback.");

    if (hostRevision === null) throw new Error("Host revision unavailable before P2 relative ordering.");
    relativeOrderResponse = await dispatchV16("layer.order.set", {
      comp: { stableId: target },
      layer: { stableId: layerC },
      placement: { position: "AFTER", referenceLayer: { stableId: layerA } },
    }, hostRevision);
    const relativeOrder = orderRecord(relativeOrderResponse);
    checks.p2_relative_order_apply = relativeOrderResponse.outcome === "APPLIED";
    checks.p2_relative_order_exact_readback = relativeOrder?.["index"] === 2
      && stableIdOf(relativeOrder?.["previousLayer"]) === layerA;
    if (!checks.p2_relative_order_apply || !checks.p2_relative_order_exact_readback) throw new Error("P2 relative ordering was not proven by exact AE readback.");

    finalReadbackResponse = await dispatchV16("layer.controls.readback", { comp: { stableId: target }, layer: { stableId: layerA } }, null);
    const finalOrder = orderRecord(finalReadbackResponse);
    const finalSwitches = switchValues(finalReadbackResponse);
    checks.p2_read_only_readback = finalReadbackResponse.outcome === "NO_OP" && finalOrder?.["index"] === 1 && finalSwitches?.["solo"] === true;
    if (!checks.p2_read_only_readback) throw new Error("P2 read-only layer-control readback did not preserve the proven host state.");
  } catch (error) {
    failureError = error instanceof Error ? error.message : String(error);
  } finally {
    await cleanupComp(target);
    await cleanupComp(sourceA);
    await cleanupComp(sourceB);
    await cleanupComp(sourceC);
    try {
      if (client !== null && baselineFingerprint !== null && baselineItemCount !== null) {
        const cleanup = await client.observe(projectId);
        checks.cleanup_fingerprint_restored = cleanup.observed.projectFingerprint === baselineFingerprint;
        checks.cleanup_item_count_restored = cleanup.project.itemCount === baselineItemCount;
        cleanupComplete = checks.cleanup_fingerprint_restored === true && checks.cleanup_item_count_restored === true && cleanupErrors.length === 0;
      }
    } catch (error) {
      cleanupErrors.push(`final observe: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (broker !== null) await broker.stop().catch((error) => cleanupErrors.push(`broker stop: ${error instanceof Error ? error.message : String(error)}`));
  }

  const ok = failureError === null
    && cleanupComplete
    && checks.p1_stale_switch_rejected === true
    && checks.p1_stale_switch_fingerprint_unchanged === true
    && checks.p2_switch_apply === true
    && checks.p2_switch_exact_readback === true
    && checks.p2_absolute_order_apply === true
    && checks.p2_absolute_order_exact_readback === true
    && checks.p2_relative_order_apply === true
    && checks.p2_relative_order_exact_readback === true
    && checks.p2_read_only_readback === true;

  await writeJson(resultPath, {
    ok,
    status: ok ? "M3_LAYER_CONTROL_P1_P2_ACCEPTED" : "M3_LAYER_CONTROL_P1_P2_FAILED",
    startedAt,
    completedAt: new Date().toISOString(),
    proofLevels: {
      P1_validation_rejection: checks.p1_stale_switch_rejected === true && checks.p1_stale_switch_fingerprint_unchanged === true,
      P2_structural_readback: checks.p2_switch_exact_readback === true && checks.p2_absolute_order_exact_readback === true && checks.p2_relative_order_exact_readback === true,
      P3_visual_proof: false,
      P4_failure_injection_rollback: false,
      P5_save_reopen_reconnect_transfer: false,
    },
    checks,
    cleanupComplete,
    cleanupErrors,
    failureError,
    environment,
    panel,
    baseline: { projectFingerprint: baselineFingerprint, itemCount: baselineItemCount },
    responses,
    evidence: {
      staleResponse,
      switchResponse,
      absoluteOrderResponse,
      relativeOrderResponse,
      finalReadbackResponse,
    },
  });

  if (!ok) process.exitCode = 1;
};

void main().catch(async (error) => {
  const resultPath = argument("--result");
  if (resultPath !== null) await writeJson(resultPath, { ok: false, status: "M3_LAYER_CONTROL_P1_P2_CRASHED", cleanupComplete: false, failureError: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
