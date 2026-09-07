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
  AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16,
  AE_LAYER_SWITCH_KEYS_V16,
  type AeLayerControlsCommandV16,
  type AeLayerControlsResponseV16,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_6.js";
import { buildLayerControlsRequestV16 } from "../../../packages/adapters/ae-cep/src/m3-layer-controls.js";
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

interface SwitchProbeEvidence {
  readonly key: string;
  readonly setValue: unknown;
  readonly setOutcome: string;
  readonly observedValue: unknown;
  readonly restoreValue: unknown;
  readonly restoreOutcome: string;
  readonly restoredValue: unknown;
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
      || !supported.includes(AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise required layer-controls 1.6 and baseline 1.1 protocols.");
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

const layerControlsRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null =>
  nestedRecord(response.readback, "layerControls");

const switchValues = (response: AeLayerControlsResponseV16): Record<string, unknown> | null => {
  const controls = layerControlsRecord(response);
  const switches = controls === null ? null : asRecord(controls["switches"]);
  return switches === null ? null : asRecord(switches["values"]);
};

const switchSupported = (response: AeLayerControlsResponseV16): Record<string, unknown> | null => {
  const controls = layerControlsRecord(response);
  const switches = controls === null ? null : asRecord(controls["switches"]);
  return switches === null ? null : asRecord(switches["supported"]);
};

const orderRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null => {
  const controls = layerControlsRecord(response);
  return controls === null ? null : asRecord(controls["order"]);
};

const layerRefStableId = (value: unknown): string | null => {
  const ref = asRecord(value);
  return ref !== null && typeof ref["stableId"] === "string" ? ref["stableId"] : null;
};

const projectHasComp = (project: AeProjectSnapshot | null, stableId: string): boolean =>
  project?.items.some((item) => item.kind === "COMPOSITION" && item.stableId === stableId) ?? false;

const allChecksTrue = (...values: readonly (boolean | undefined)[]): boolean =>
  values.every((value) => value === true);

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "120000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error("--timeout-ms must be at least 10000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const checks: Record<string, boolean> = {};
  const responses: RecordedResponse[] = [];
  const switchEvidence: SwitchProbeEvidence[] = [];
  const orderEvidence: Record<string, unknown>[] = [];
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

  const projectId = "m3-layer-controls-p1-p2-real-ae";
  const prefix = `M3_LAYER_CONTROLS_P12_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layerA = `${prefix}_LAYER_A`;
  const layerB = `${prefix}_LAYER_B`;
  const layerC = `${prefix}_LAYER_C`;
  const staleLayer = `${prefix}_STALE_LAYER`;
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

  const recordV16 = (response: AeLayerControlsResponseV16): void => {
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
      readbackProfile: "M3_LAYER_CONTROLS_P1_P2_SETUP",
    });
    recordV11(command, response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    }
    await refreshState();
    return response;
  };

  const dispatchV16 = async (
    command: AeLayerControlsCommandV16,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
  ): Promise<AeLayerControlsResponseV16> => {
    if (broker === null) throw new Error("M3 layer-controls broker is not initialized.");
    operationCounter += 1;
    const request = buildLayerControlsRequestV16({
      requestId: `m3-layer-controls-p12-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V16_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_LAYER_CONTROLS_P1_P2_STRUCTURAL",
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
      if (projectSnapshot !== null && projectHasComp(projectSnapshot, stableId)) {
        await executeV11("comp.remove", { comp: { stableId } });
      }
    } catch (error) {
      cleanupErrors.push(`${stableId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const proveRejectedWithoutMutation = async (
    checkPrefix: string,
    action: () => Promise<AeLayerControlsResponseV16>,
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

  try {
    const configText = stripUtf8Bom(await readFile(configPath, "utf8"));
    const config = parseConfig(JSON.parse(configText) as unknown);
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 30_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v16 = panel.protocolVersion === AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16;
    checks.panel_supports_v11_v16 = panel.supportedProtocolVersions.includes(AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v16 || !checks.panel_supports_v11_v16) {
      throw new Error(`Layer-controls proof requires negotiated protocol ${AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16} with baseline 1.1 fixture compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-layer-controls-setup-${++requestCounter}`,
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
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    await executeV11("comp.create", {
      stableId: targetStable,
      name: `${prefix} Target`,
      width: 640,
      height: 360,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    for (const stableId of [layerC, layerB, layerA]) {
      await executeV11("layer.add_media", {
        stableId,
        comp: { stableId: targetStable },
        item: { stableId: sourceStable },
      });
    }

    const initialRead = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetStable },
      layer: { stableId: layerA },
    }, null);
    const supported = switchSupported(initialRead);
    checks.p2_initial_readback = initialRead.outcome === "NO_OP"
      && layerRefStableId(layerControlsRecord(initialRead)?.["layer"]) === layerA;
    checks.p2_all_switches_report_supported = supported !== null
      && AE_LAYER_SWITCH_KEYS_V16.every((key) => supported[key] === true);

    await proveRejectedWithoutMutation("p1_stale_revision", async () => {
      if (hostRevision === null) throw new Error("Host revision is unavailable for stale-revision proof.");
      return await dispatchV16("layer.switches.set", {
        comp: { stableId: targetStable },
        layer: { stableId: layerA },
        switches: { enabled: false },
      }, hostRevision + 1000);
    }, "HOST_REVISION_CONFLICT");

    await proveRejectedWithoutMutation("p1_empty_switches", async () => await dispatchV16("layer.switches.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerA },
      switches: {},
    }, hostRevision), "LAYER_SWITCHES_EMPTY");

    await proveRejectedWithoutMutation("p1_self_relative_order", async () => await dispatchV16("layer.order.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerA },
      placement: { kind: "BEFORE", relativeTo: { stableId: layerA } },
    }, hostRevision), "LAYER_RELATIVE_SELF");

    const switchProbes: ReadonlyArray<readonly [string, unknown, unknown]> = [
      ["enabled", false, true],
      ["audioEnabled", false, true],
      ["solo", true, false],
      ["shy", true, false],
      ["collapseTransformation", true, false],
      ["quality", "DRAFT", "BEST"],
      ["effectsActive", false, true],
      ["adjustmentLayer", true, false],
      ["threeDLayer", true, false],
      ["preserveTransparency", true, false],
      ["samplingQuality", "BICUBIC", "BILINEAR"],
    ];
    let allSwitchWritesExact = true;
    for (const [key, setValue, restoreValue] of switchProbes) {
      const setResponse = await dispatchV16("layer.switches.set", {
        comp: { stableId: targetStable },
        layer: { stableId: layerA },
        switches: { [key]: setValue },
      }, hostRevision);
      const observedValue = switchValues(setResponse)?.[key];
      const setExact = setResponse.outcome === "APPLIED" && observedValue === setValue;

      const restoreResponse = await dispatchV16("layer.switches.set", {
        comp: { stableId: targetStable },
        layer: { stableId: layerA },
        switches: { [key]: restoreValue },
      }, hostRevision);
      const restoredValue = switchValues(restoreResponse)?.[key];
      const restoreExact = (restoreResponse.outcome === "APPLIED" || restoreResponse.outcome === "NO_OP")
        && restoredValue === restoreValue;
      allSwitchWritesExact = allSwitchWritesExact && setExact && restoreExact;
      switchEvidence.push({
        key,
        setValue,
        setOutcome: setResponse.outcome,
        observedValue,
        restoreValue,
        restoreOutcome: restoreResponse.outcome,
        restoredValue,
      });
    }
    checks.p2_all_switch_writes_exact = allSwitchWritesExact;

    const lockResponse = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerA },
      switches: { locked: true },
    }, hostRevision);
    checks.p2_lock_applied = lockResponse.outcome === "APPLIED" && switchValues(lockResponse)?.["locked"] === true;
    const repeatLock = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerA },
      switches: { locked: true },
    }, hostRevision);
    checks.p2_repeat_switch_no_op = repeatLock.outcome === "NO_OP" && switchValues(repeatLock)?.["locked"] === true;

    const moveEnd = await dispatchV16("layer.order.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerA },
      placement: { kind: "END" },
    }, hostRevision);
    const endOrder = orderRecord(moveEnd);
    checks.p2_locked_move_end_exact = moveEnd.outcome === "APPLIED"
      && endOrder?.["index"] === 3
      && endOrder?.["totalLayers"] === 3
      && switchValues(moveEnd)?.["locked"] === true;
    orderEvidence.push({ step: "END", outcome: moveEnd.outcome, readback: layerControlsRecord(moveEnd) });

    const repeatEnd = await dispatchV16("layer.order.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerA },
      placement: { kind: "END" },
    }, hostRevision);
    checks.p2_repeat_order_no_op = repeatEnd.outcome === "NO_OP"
      && orderRecord(repeatEnd)?.["index"] === 3
      && switchValues(repeatEnd)?.["locked"] === true;

    const moveBeforeB = await dispatchV16("layer.order.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerA },
      placement: { kind: "BEFORE", relativeTo: { stableId: layerB } },
    }, hostRevision);
    checks.p2_move_before_exact = moveBeforeB.outcome === "APPLIED"
      && layerRefStableId(orderRecord(moveBeforeB)?.["nextLayer"]) === layerB
      && switchValues(moveBeforeB)?.["locked"] === true;
    orderEvidence.push({ step: "BEFORE_B", outcome: moveBeforeB.outcome, readback: layerControlsRecord(moveBeforeB) });

    const moveAfterC = await dispatchV16("layer.order.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerA },
      placement: { kind: "AFTER", relativeTo: { stableId: layerC } },
    }, hostRevision);
    checks.p2_move_after_exact = moveAfterC.outcome === "APPLIED"
      && layerRefStableId(orderRecord(moveAfterC)?.["previousLayer"]) === layerC
      && switchValues(moveAfterC)?.["locked"] === true;
    orderEvidence.push({ step: "AFTER_C", outcome: moveAfterC.outcome, readback: layerControlsRecord(moveAfterC) });

    const moveBeginning = await dispatchV16("layer.order.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerA },
      placement: { kind: "BEGINNING" },
    }, hostRevision);
    checks.p2_move_beginning_exact = moveBeginning.outcome === "APPLIED"
      && orderRecord(moveBeginning)?.["index"] === 1
      && orderRecord(moveBeginning)?.["totalLayers"] === 3
      && switchValues(moveBeginning)?.["locked"] === true;
    orderEvidence.push({ step: "BEGINNING", outcome: moveBeginning.outcome, readback: layerControlsRecord(moveBeginning) });

    const unlock = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerA },
      switches: { locked: false },
    }, hostRevision);
    checks.p2_unlock_applied = unlock.outcome === "APPLIED" && switchValues(unlock)?.["locked"] === false;

    const finalRead = await dispatchV16("layer.controls.readback", {
      comp: { stableId: targetStable },
      layer: { stableId: layerA },
    }, null);
    checks.p2_final_readback_exact = finalRead.outcome === "NO_OP"
      && orderRecord(finalRead)?.["index"] === 1
      && orderRecord(finalRead)?.["totalLayers"] === 3
      && switchValues(finalRead)?.["locked"] === false;

    checks.p1 = allChecksTrue(
      checks.p1_stale_revision_rejected,
      checks.p1_stale_revision_revision_unchanged,
      checks.p1_stale_revision_fingerprint_unchanged,
      checks.p1_empty_switches_rejected,
      checks.p1_empty_switches_revision_unchanged,
      checks.p1_empty_switches_fingerprint_unchanged,
      checks.p1_self_relative_order_rejected,
      checks.p1_self_relative_order_revision_unchanged,
      checks.p1_self_relative_order_fingerprint_unchanged,
    );

    checks.p2 = allChecksTrue(
      checks.p2_initial_readback,
      checks.p2_all_switches_report_supported,
      checks.p2_all_switch_writes_exact,
      checks.p2_lock_applied,
      checks.p2_repeat_switch_no_op,
      checks.p2_locked_move_end_exact,
      checks.p2_repeat_order_no_op,
      checks.p2_move_before_exact,
      checks.p2_move_after_exact,
      checks.p2_move_beginning_exact,
      checks.p2_unlock_applied,
      checks.p2_final_readback_exact,
    );

    checks.baseline_captured = baselineFingerprint.length > 0 && baselineItemCount >= 0;
    checks.fixture_comp_present_before_cleanup = projectSnapshot !== null
      && projectHasComp(projectSnapshot, sourceStable)
      && projectHasComp(projectSnapshot, targetStable);
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await cleanupComp(targetStable);
    await cleanupComp(sourceStable);
    try {
      if (client !== null) {
        await refreshState();
        checks.cleanup_item_count_restored = baselineItemCount !== null && projectSnapshot?.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint !== null && state?.projectFingerprint === baselineFingerprint;
      }
    } catch (error) {
      cleanupErrors.push(`final-inspect: ${error instanceof Error ? error.message : String(error)}`);
    }
    cleanupComplete = cleanupErrors.length === 0
      && checks.cleanup_item_count_restored === true
      && checks.cleanup_fingerprint_restored === true;
    if (broker !== null) await broker.stop();

    const ok = failureError === null
      && cleanupComplete
      && checks.p1 === true
      && checks.p2 === true;
    await writeJson(resultPath, {
      proofId: "M3_LAYER_CONTROLS_P1_P2_REAL_AE",
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
        sourceStable,
        targetStable,
        layerA,
        layerB,
        layerC,
        staleLayer,
      },
      switchEvidence,
      orderEvidence,
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