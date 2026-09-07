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
  type AeLayerControlsCommandV16,
  type AeLayerControlsResponseV16,
  type AeLayerSwitchPatchV16,
  type AeLayerQualityV16,
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

const SWITCH_KEYS = [
  "enabled",
  "solo",
  "shy",
  "locked",
  "quality",
  "adjustmentLayer",
  "guideLayer",
  "threeDLayer",
  "effectsActive",
  "collapseTransformation",
  "preserveTransparency",
] as const;

type SwitchKey = typeof SWITCH_KEYS[number];

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

const layerSwitchesRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null =>
  nestedRecord(response.readback, "layerSwitches");

const switchesRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null =>
  nestedRecord(layerSwitchesRecord(response), "switches");

const applicabilityRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null =>
  nestedRecord(layerSwitchesRecord(response), "applicability");

const layerRefRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null =>
  nestedRecord(layerSwitchesRecord(response), "layer");

const requireBoolean = (record: Record<string, unknown>, key: Exclude<SwitchKey, "quality">): boolean => {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`Expected boolean layer-switch readback for ${key}.`);
  return value;
};

const requireQuality = (record: Record<string, unknown>): AeLayerQualityV16 => {
  const value = record["quality"];
  if (value !== "BEST" && value !== "DRAFT" && value !== "WIREFRAME") {
    throw new Error("Expected BEST, DRAFT, or WIREFRAME layer quality readback.");
  }
  return value;
};

const patchMatches = (record: Record<string, unknown> | null, patch: AeLayerSwitchPatchV16): boolean => {
  if (record === null) return false;
  return SWITCH_KEYS.every((key) => !Object.prototype.hasOwnProperty.call(patch, key) || record[key] === patch[key]);
};

const allApplicabilityTrue = (record: Record<string, unknown> | null): boolean =>
  record !== null && SWITCH_KEYS.every((key) => record[key] === true);

const findLayer = (project: AeProjectSnapshot, compStableId: string, layerStableId: string): boolean => {
  const item = project.items.find((candidate) => candidate.kind === "COMPOSITION" && candidate.stableId === compStableId);
  return item?.composition?.layers.some((layer) => layer.stableId === layerStableId) ?? false;
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
  let initialReadback: Record<string, unknown> | null = null;
  let fullPatchEvidence: AeLayerSwitchPatchV16 | null = null;
  let fullPatchReadback: Record<string, unknown> | null = null;
  let lockedRejectionReadback: Record<string, unknown> | null = null;
  let restoredReadback: Record<string, unknown> | null = null;

  const projectId = "m3-layer-controls-p1-p2-real-ae";
  const prefix = `M3_LAYER_CONTROLS_P12_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layerStable = `${prefix}_LAYER`;
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
    await executeV11("layer.add_media", {
      stableId: layerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });

    const initial = await dispatchV16("layer.switches_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
    }, null);
    initialReadback = layerSwitchesRecord(initial);
    const initialSwitches = switchesRecord(initial);
    if (initialSwitches === null) throw new Error("Initial layer-switch readback did not contain a switches object.");
    checks.p2_initial_readback = initial.outcome === "NO_OP"
      && layerRefRecord(initial)?.["stableId"] === layerStable
      && allApplicabilityTrue(applicabilityRecord(initial));
    checks.p2_fixture_initially_unlocked = requireBoolean(initialSwitches, "locked") === false;
    await refreshState();
    checks.p2_project_snapshot_contains_layer = projectSnapshot !== null && findLayer(projectSnapshot, targetStable, layerStable);

    const beforeUnknown = await client.observe(projectId);
    state = beforeUnknown.observed;
    hostRevision = beforeUnknown.hostRevision;
    projectSnapshot = beforeUnknown.project;
    const unknown = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      switches: { motionBlur: true },
    }, beforeUnknown.hostRevision);
    const afterUnknown = await client.observe(projectId);
    state = afterUnknown.observed;
    hostRevision = afterUnknown.hostRevision;
    projectSnapshot = afterUnknown.project;
    checks.p1_unknown_switch_rejected = unknown.outcome === "REJECTED" && unknown.error?.code === "LAYER_SWITCH_UNKNOWN";
    checks.p1_unknown_revision_unchanged = unknown.hostProjectRevision === beforeUnknown.hostRevision
      && afterUnknown.hostRevision === beforeUnknown.hostRevision;
    checks.p1_unknown_fingerprint_unchanged = afterUnknown.observed.projectFingerprint === beforeUnknown.observed.projectFingerprint;

    const beforeStale = await client.observe(projectId);
    state = beforeStale.observed;
    hostRevision = beforeStale.hostRevision;
    projectSnapshot = beforeStale.project;
    const stale = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      switches: { solo: !requireBoolean(initialSwitches, "solo") },
    }, beforeStale.hostRevision + 1000);
    const afterStale = await client.observe(projectId);
    state = afterStale.observed;
    hostRevision = afterStale.hostRevision;
    projectSnapshot = afterStale.project;
    checks.p1_stale_revision_rejected = stale.outcome === "REJECTED" && stale.error?.code === "HOST_REVISION_CONFLICT";
    checks.p1_stale_revision_unchanged = stale.hostProjectRevision === beforeStale.hostRevision
      && afterStale.hostRevision === beforeStale.hostRevision;
    checks.p1_stale_fingerprint_unchanged = afterStale.observed.projectFingerprint === beforeStale.observed.projectFingerprint;

    const baselinePatch: AeLayerSwitchPatchV16 = {
      enabled: requireBoolean(initialSwitches, "enabled"),
      solo: requireBoolean(initialSwitches, "solo"),
      shy: requireBoolean(initialSwitches, "shy"),
      locked: requireBoolean(initialSwitches, "locked"),
      quality: requireQuality(initialSwitches),
      adjustmentLayer: requireBoolean(initialSwitches, "adjustmentLayer"),
      guideLayer: requireBoolean(initialSwitches, "guideLayer"),
      threeDLayer: requireBoolean(initialSwitches, "threeDLayer"),
      effectsActive: requireBoolean(initialSwitches, "effectsActive"),
      collapseTransformation: requireBoolean(initialSwitches, "collapseTransformation"),
      preserveTransparency: requireBoolean(initialSwitches, "preserveTransparency"),
    };
    const fullPatch: AeLayerSwitchPatchV16 = {
      enabled: !baselinePatch.enabled,
      solo: !baselinePatch.solo,
      shy: !baselinePatch.shy,
      locked: true,
      quality: baselinePatch.quality === "DRAFT" ? "BEST" : "DRAFT",
      adjustmentLayer: !baselinePatch.adjustmentLayer,
      guideLayer: !baselinePatch.guideLayer,
      threeDLayer: !baselinePatch.threeDLayer,
      effectsActive: !baselinePatch.effectsActive,
      collapseTransformation: !baselinePatch.collapseTransformation,
      preserveTransparency: !baselinePatch.preserveTransparency,
    };
    fullPatchEvidence = fullPatch;

    const full = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      switches: fullPatch,
    }, hostRevision);
    fullPatchReadback = layerSwitchesRecord(full);
    checks.p2_full_patch_applied = full.outcome === "APPLIED";
    checks.p2_full_patch_exact = patchMatches(switchesRecord(full), fullPatch)
      && allApplicabilityTrue(applicabilityRecord(full))
      && full.affectedObjects.length === 1
      && full.affectedObjects[0]?.stableId === layerStable;
    await refreshState();

    const repeat = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      switches: fullPatch,
    }, hostRevision);
    checks.p2_repeat_patch_no_op = repeat.outcome === "NO_OP" && patchMatches(switchesRecord(repeat), fullPatch);

    const beforeLocked = await client.observe(projectId);
    state = beforeLocked.observed;
    hostRevision = beforeLocked.hostRevision;
    projectSnapshot = beforeLocked.project;
    const lockedReject = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      switches: { solo: !fullPatch.solo },
    }, beforeLocked.hostRevision);
    lockedRejectionReadback = layerSwitchesRecord(lockedReject);
    const afterLocked = await client.observe(projectId);
    state = afterLocked.observed;
    hostRevision = afterLocked.hostRevision;
    projectSnapshot = afterLocked.project;
    checks.p1_locked_change_rejected = lockedReject.outcome === "REJECTED"
      && lockedReject.error?.code === "LAYER_LOCKED_REQUIRES_EXPLICIT_UNLOCK";
    checks.p1_locked_readback_intact = patchMatches(switchesRecord(lockedReject), fullPatch);
    checks.p1_locked_revision_unchanged = lockedReject.hostProjectRevision === beforeLocked.hostRevision
      && afterLocked.hostRevision === beforeLocked.hostRevision;
    checks.p1_locked_fingerprint_unchanged = afterLocked.observed.projectFingerprint === beforeLocked.observed.projectFingerprint;

    const restorePatch: AeLayerSwitchPatchV16 = { ...baselinePatch, locked: false };
    const restored = await dispatchV16("layer.switches.set", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      switches: restorePatch,
    }, hostRevision);
    restoredReadback = layerSwitchesRecord(restored);
    checks.p2_atomic_unlock_restore_applied = restored.outcome === "APPLIED";
    checks.p2_atomic_unlock_restore_exact = patchMatches(switchesRecord(restored), restorePatch);
    await refreshState();

    const finalRead = await dispatchV16("layer.switches_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
    }, null);
    checks.p2_final_readback_matches_baseline = finalRead.outcome === "NO_OP" && patchMatches(switchesRecord(finalRead), baselinePatch);

    checks.p1 = checks.p1_unknown_switch_rejected
      && checks.p1_unknown_revision_unchanged
      && checks.p1_unknown_fingerprint_unchanged
      && checks.p1_stale_revision_rejected
      && checks.p1_stale_revision_unchanged
      && checks.p1_stale_fingerprint_unchanged
      && checks.p1_locked_change_rejected
      && checks.p1_locked_readback_intact
      && checks.p1_locked_revision_unchanged
      && checks.p1_locked_fingerprint_unchanged;
    checks.p2 = checks.p2_initial_readback
      && checks.p2_fixture_initially_unlocked
      && checks.p2_project_snapshot_contains_layer
      && checks.p2_full_patch_applied
      && checks.p2_full_patch_exact
      && checks.p2_repeat_patch_no_op
      && checks.p2_atomic_unlock_restore_applied
      && checks.p2_atomic_unlock_restore_exact
      && checks.p2_final_readback_matches_baseline;
    checks.baseline_captured = baselineFingerprint.length > 0 && baselineItemCount >= 0;
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
      sourceCommit: process.env["GITHUB_SHA"] ?? null,
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
        layerStable,
      },
      switchEvidence: {
        initial: initialReadback,
        fullPatch: fullPatchEvidence,
        fullPatchReadback,
        lockedRejection: lockedRejectionReadback,
        restored: restoredReadback,
      },
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
