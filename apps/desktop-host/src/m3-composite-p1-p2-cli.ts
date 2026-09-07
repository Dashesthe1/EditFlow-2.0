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
  AE_BLEND_MODES_V13,
  AE_COMPOSITE_PROTOCOL_VERSION_V13,
  AE_TRACK_MATTE_TYPES_V13,
  type AeCompositeCommandV13,
  type AeCompositeResponseV13,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_3.js";
import { buildCompositeRequestV13 } from "../../../packages/adapters/ae-cep/src/m3-composite.js";
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
  if (!Array.isArray(supported) || !supported.includes(AE_COMPOSITE_PROTOCOL_VERSION_V13) || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise both required composite 1.3 and baseline 1.1 protocols.");
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

const compositeRecord = (response: AeCompositeResponseV13): Record<string, unknown> | null =>
  nestedRecord(response.readback, "composite");

const layerRef = (composite: Record<string, unknown> | null, key: string): Record<string, unknown> | null =>
  composite === null ? null : asRecord(composite[key]);

const findLayer = (project: AeProjectSnapshot, compStableId: string, layerStableId: string): AeLayerSnapshot | null => {
  const item = project.items.find((candidate) => candidate.kind === "COMPOSITION" && candidate.stableId === compStableId);
  return item?.composition?.layers.find((layer) => layer.stableId === layerStableId) ?? null;
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
  const matteModeResults: Record<string, boolean> = {};
  const blendModeResults: Record<string, boolean> = {};
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

  const projectId = "m3-composite-p1-p2-real-ae";
  const prefix = `M3_COMPOSITE_P12_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const targetLayerStable = `${prefix}_TARGET_LAYER`;
  const spacerLayerStable = `${prefix}_SPACER_LAYER`;
  const matteLayerStable = `${prefix}_MATTE_LAYER`;
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

  const recordV13 = (response: AeCompositeResponseV13): void => {
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
      readbackProfile: "M3_COMPOSITE_P1_P2_SETUP",
    });
    recordV11(command, response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    }
    await refreshState();
    return response;
  };

  const dispatchV13 = async (
    command: AeCompositeCommandV13,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
  ): Promise<AeCompositeResponseV13> => {
    if (broker === null) throw new Error("M3 composite broker is not initialized.");
    operationCounter += 1;
    const request = buildCompositeRequestV13({
      requestId: `m3-composite-p12-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V13_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_COMPOSITE_P1_P2_STRUCTURAL",
    });
    const response = await broker.dispatch(request);
    recordV13(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const cleanupComp = async (stableId: string): Promise<void> => {
    if (client === null) return;
    try {
      await refreshState();
      if (projectSnapshot === null) return;
      const present = projectSnapshot.items.some((item) => item.kind === "COMPOSITION" && item.stableId === stableId);
      if (present) await executeV11("comp.remove", { comp: { stableId } });
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
      supportedProtocolVersions: [AE_COMPOSITE_PROTOCOL_VERSION_V13, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v13 = panel.protocolVersion === AE_COMPOSITE_PROTOCOL_VERSION_V13;
    checks.panel_supports_v11_v13 = panel.supportedProtocolVersions.includes(AE_COMPOSITE_PROTOCOL_VERSION_V13)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v13 || !checks.panel_supports_v11_v13) {
      throw new Error(`Composite proof requires negotiated protocol ${AE_COMPOSITE_PROTOCOL_VERSION_V13} with 1.1 compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-composite-setup-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects"
      && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    projectSnapshot = baseline.project;
    const baselineFingerprint = baseline.observed.projectFingerprint;
    const baselineItemCount = baseline.project.itemCount;

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
      width: 320,
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });

    await executeV11("layer.add_media", {
      stableId: targetLayerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    await executeV11("layer.add_media", {
      stableId: spacerLayerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    await executeV11("layer.add_media", {
      stableId: matteLayerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });

    if (projectSnapshot === null) throw new Error("Project snapshot unavailable after fixture setup.");
    const initialTarget = findLayer(projectSnapshot, targetStable, targetLayerStable);
    const initialSpacer = findLayer(projectSnapshot, targetStable, spacerLayerStable);
    const initialMatte = findLayer(projectSnapshot, targetStable, matteLayerStable);
    checks.setup_three_av_layers = initialTarget?.kind === "LAYER_AV" && initialSpacer?.kind === "LAYER_AV" && initialMatte?.kind === "LAYER_AV";
    checks.setup_non_adjacent = initialTarget !== null && initialMatte !== null && Math.abs(initialTarget.index - initialMatte.index) > 1;
    checks.setup_spacer_between = initialTarget !== null && initialSpacer !== null && initialMatte !== null
      && Math.min(initialTarget.index, initialMatte.index) < initialSpacer.index
      && initialSpacer.index < Math.max(initialTarget.index, initialMatte.index);
    if (!checks.setup_three_av_layers || !checks.setup_non_adjacent || !checks.setup_spacer_between) {
      throw new Error("Composite fixture did not produce target/spacer/matte as non-adjacent AV layers.");
    }

    const beforeSelf = await client.observe(projectId);
    state = beforeSelf.observed;
    hostRevision = beforeSelf.hostRevision;
    projectSnapshot = beforeSelf.project;
    const selfMatte = await dispatchV13("layer.set_track_matte", {
      comp: { stableId: targetStable },
      layer: { stableId: targetLayerStable },
      matteLayer: { stableId: targetLayerStable },
      trackMatteType: "ALPHA",
    }, beforeSelf.hostRevision);
    const afterSelf = await client.observe(projectId);
    state = afterSelf.observed;
    hostRevision = afterSelf.hostRevision;
    projectSnapshot = afterSelf.project;
    checks.p1_self_matte_deterministic_rejection = (selfMatte.outcome === "REJECTED" || selfMatte.outcome === "FAILED")
      && selfMatte.error?.code === "TRACK_MATTE_SELF_REFERENCE";
    checks.p1_self_matte_revision_unchanged = selfMatte.hostProjectRevision === beforeSelf.hostRevision
      && afterSelf.hostRevision === beforeSelf.hostRevision;
    checks.p1_self_matte_fingerprint_unchanged = afterSelf.observed.projectFingerprint === beforeSelf.observed.projectFingerprint;

    if (hostRevision === null) throw new Error("Host revision unavailable before stale-revision proof.");
    const staleRevision = Math.max(0, hostRevision - 1);
    const beforeStale = await client.observe(projectId);
    state = beforeStale.observed;
    hostRevision = beforeStale.hostRevision;
    projectSnapshot = beforeStale.project;
    const stale = await dispatchV13("layer.set_blend_mode", {
      comp: { stableId: targetStable },
      layer: { stableId: targetLayerStable },
      blendMode: "MULTIPLY",
    }, staleRevision);
    const afterStale = await client.observe(projectId);
    state = afterStale.observed;
    hostRevision = afterStale.hostRevision;
    projectSnapshot = afterStale.project;
    checks.p1_stale_revision_rejected = stale.outcome === "REJECTED" && stale.error?.code === "HOST_REVISION_CONFLICT";
    checks.p1_stale_revision_unchanged = stale.hostProjectRevision === beforeStale.hostRevision
      && afterStale.hostRevision === beforeStale.hostRevision;
    checks.p1_stale_fingerprint_unchanged = afterStale.observed.projectFingerprint === beforeStale.observed.projectFingerprint;

    const initialComposite = await dispatchV13("layer.composite_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: targetLayerStable },
    }, null);
    const initialCompositeValue = compositeRecord(initialComposite);
    checks.p2_initial_readback = initialComposite.outcome === "NO_OP"
      && layerRef(initialCompositeValue, "layer")?.["stableId"] === targetLayerStable
      && initialCompositeValue?.["hasTrackMatte"] === false
      && initialCompositeValue?.["trackMatteType"] === "NO_TRACK_MATTE"
      && initialCompositeValue?.["trackMatteLayer"] === null
      && initialCompositeValue?.["blendMode"] === "NORMAL";

    for (const matteType of AE_TRACK_MATTE_TYPES_V13) {
      const before = projectSnapshot;
      const beforeTarget = before === null ? null : findLayer(before, targetStable, targetLayerStable);
      const beforeSpacer = before === null ? null : findLayer(before, targetStable, spacerLayerStable);
      const beforeMatte = before === null ? null : findLayer(before, targetStable, matteLayerStable);
      const response = await dispatchV13("layer.set_track_matte", {
        comp: { stableId: targetStable },
        layer: { stableId: targetLayerStable },
        matteLayer: { stableId: matteLayerStable },
        trackMatteType: matteType,
      }, hostRevision);
      const composite = compositeRecord(response);
      await refreshState();
      const afterTarget = projectSnapshot === null ? null : findLayer(projectSnapshot, targetStable, targetLayerStable);
      const afterSpacer = projectSnapshot === null ? null : findLayer(projectSnapshot, targetStable, spacerLayerStable);
      const afterMatte = projectSnapshot === null ? null : findLayer(projectSnapshot, targetStable, matteLayerStable);
      matteModeResults[matteType] = (response.outcome === "APPLIED" || response.outcome === "NO_OP")
        && composite?.["hasTrackMatte"] === true
        && composite?.["trackMatteType"] === matteType
        && layerRef(composite, "trackMatteLayer")?.["stableId"] === matteLayerStable
        && layerRef(composite, "layer")?.["stableId"] === targetLayerStable
        && beforeTarget?.index === afterTarget?.index
        && beforeSpacer?.index === afterSpacer?.index
        && beforeMatte?.index === afterMatte?.index
        && afterTarget !== null && afterMatte !== null && Math.abs(afterTarget.index - afterMatte.index) > 1;
    }
    checks.p2_all_four_matte_modes = AE_TRACK_MATTE_TYPES_V13.every((mode) => matteModeResults[mode] === true);
    checks.p2_arbitrary_matte_source_without_reorder = checks.p2_all_four_matte_modes;

    const clear = await dispatchV13("layer.clear_track_matte", {
      comp: { stableId: targetStable },
      layer: { stableId: targetLayerStable },
    }, hostRevision);
    const clearComposite = compositeRecord(clear);
    checks.p2_clear_matte = clear.outcome === "APPLIED"
      && clearComposite?.["hasTrackMatte"] === false
      && clearComposite?.["trackMatteType"] === "NO_TRACK_MATTE"
      && clearComposite?.["trackMatteLayer"] === null;
    await refreshState();

    for (const blendMode of AE_BLEND_MODES_V13) {
      const response = await dispatchV13("layer.set_blend_mode", {
        comp: { stableId: targetStable },
        layer: { stableId: targetLayerStable },
        blendMode,
      }, hostRevision);
      const composite = compositeRecord(response);
      blendModeResults[blendMode] = (response.outcome === "APPLIED" || response.outcome === "NO_OP")
        && composite?.["blendMode"] === blendMode
        && layerRef(composite, "layer")?.["stableId"] === targetLayerStable;
      await refreshState();
    }
    checks.p2_all_documented_blend_modes = AE_BLEND_MODES_V13.every((mode) => blendModeResults[mode] === true);

    const restoreNormal = await dispatchV13("layer.set_blend_mode", {
      comp: { stableId: targetStable },
      layer: { stableId: targetLayerStable },
      blendMode: "NORMAL",
    }, hostRevision);
    checks.p2_restore_normal = (restoreNormal.outcome === "APPLIED" || restoreNormal.outcome === "NO_OP")
      && compositeRecord(restoreNormal)?.["blendMode"] === "NORMAL";
    await refreshState();

    const finalComposite = await dispatchV13("layer.composite_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: targetLayerStable },
    }, null);
    const finalCompositeValue = compositeRecord(finalComposite);
    const finalTarget = projectSnapshot === null ? null : findLayer(projectSnapshot, targetStable, targetLayerStable);
    const finalSpacer = projectSnapshot === null ? null : findLayer(projectSnapshot, targetStable, spacerLayerStable);
    const finalMatte = projectSnapshot === null ? null : findLayer(projectSnapshot, targetStable, matteLayerStable);
    checks.p2_final_readback = finalComposite.outcome === "NO_OP"
      && finalCompositeValue?.["hasTrackMatte"] === false
      && finalCompositeValue?.["trackMatteType"] === "NO_TRACK_MATTE"
      && finalCompositeValue?.["trackMatteLayer"] === null
      && finalCompositeValue?.["blendMode"] === "NORMAL";
    checks.p2_final_layer_order_preserved = finalTarget?.index === initialTarget?.index
      && finalSpacer?.index === initialSpacer?.index
      && finalMatte?.index === initialMatte?.index;

    checks.p1 = checks.p1_self_matte_deterministic_rejection
      && checks.p1_self_matte_revision_unchanged
      && checks.p1_self_matte_fingerprint_unchanged
      && checks.p1_stale_revision_rejected
      && checks.p1_stale_revision_unchanged
      && checks.p1_stale_fingerprint_unchanged;
    checks.p2 = checks.p2_initial_readback
      && checks.p2_all_four_matte_modes
      && checks.p2_arbitrary_matte_source_without_reorder
      && checks.p2_clear_matte
      && checks.p2_all_documented_blend_modes
      && checks.p2_restore_normal
      && checks.p2_final_readback
      && checks.p2_final_layer_order_preserved;

    checks.baseline_captured = baselineFingerprint.length > 0 && baselineItemCount >= 0;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await cleanupComp(targetStable);
    await cleanupComp(sourceStable);
    try {
      if (client !== null) {
        await refreshState();
        checks.cleanup_blank_item_count = projectSnapshot?.itemCount === 0;
      }
    } catch (error) {
      cleanupErrors.push(`final-inspect: ${error instanceof Error ? error.message : String(error)}`);
    }
    cleanupComplete = cleanupErrors.length === 0 && checks.cleanup_blank_item_count === true;
    if (broker !== null) await broker.stop();

    const ok = failureError === null
      && cleanupComplete
      && checks.p1 === true
      && checks.p2 === true;
    await writeJson(resultPath, {
      proofId: "M3_COMPOSITE_P1_P2_REAL_AE",
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
      checks,
      matteModeResults,
      blendModeResults,
      blendModesAttempted: [...AE_BLEND_MODES_V13],
      matteModesAttempted: [...AE_TRACK_MATTE_TYPES_V13],
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
