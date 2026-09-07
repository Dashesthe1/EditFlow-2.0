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
  if (!Array.isArray(supported)
      || !supported.includes(AE_NULL_RIG_PROTOCOL_VERSION_V15)
      || !supported.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise required null-rig 1.5, parenting 1.4, and baseline 1.1 protocols.");
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
  let createdRigReadback: Record<string, unknown> | null = null;
  let attachedRigReadback: Record<string, unknown> | null = null;
  let detachedRigReadback: Record<string, unknown> | null = null;
  let blockedRemovalReadback: Record<string, unknown> | null = null;

  const projectId = "m3-null-rig-p1-p2-real-ae";
  const prefix = `M3_NULL_RIG_P12_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const childLayerStable = `${prefix}_CHILD_LAYER`;
  const rigStable = `${prefix}_RIG_MAIN`;
  const staleRigStable = `${prefix}_RIG_STALE`;
  const rigName = `${prefix} Main Control`;
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

  const recordV14 = (response: AeParentingResponseV14): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command: response.command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
    });
  };

  const recordV15 = (response: AeNullRigResponseV15): void => {
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
      readbackProfile: "M3_NULL_RIG_P1_P2_SETUP",
    });
    recordV11(command, response);
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
  ): Promise<AeParentingResponseV14> => {
    if (broker === null) throw new Error("M3 null-rig broker is not initialized.");
    operationCounter += 1;
    const request = buildParentingRequestV14({
      requestId: `m3-null-rig-p12-parent-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V14_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_NULL_RIG_P1_P2_PARENTING",
    });
    const response = await broker.dispatch(request);
    recordV14(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const dispatchV15 = async (
    command: AeNullRigCommandV15,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
  ): Promise<AeNullRigResponseV15> => {
    if (broker === null) throw new Error("M3 null-rig broker is not initialized.");
    operationCounter += 1;
    const request = buildNullRigRequestV15({
      requestId: `m3-null-rig-p12-${++requestCounter}`,
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
      supportedProtocolVersions: [AE_NULL_RIG_PROTOCOL_VERSION_V15, AE_PARENTING_PROTOCOL_VERSION_V14, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v15 = panel.protocolVersion === AE_NULL_RIG_PROTOCOL_VERSION_V15;
    checks.panel_supports_v11_v14_v15 = panel.supportedProtocolVersions.includes(AE_NULL_RIG_PROTOCOL_VERSION_V15)
      && panel.supportedProtocolVersions.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v15 || !checks.panel_supports_v11_v14_v15) {
      throw new Error(`Null-rig proof requires negotiated protocol ${AE_NULL_RIG_PROTOCOL_VERSION_V15} with 1.4 parenting and 1.1 fixture compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-null-rig-setup-${++requestCounter}`,
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
      stableId: childLayerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });

    const createRig = await dispatchV15("rig.null.create", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable, name: rigName },
      threeDLayer: false,
    }, hostRevision);
    createdRigReadback = nullRigRecord(createRig);
    checks.p2_create_applied = createRig.outcome === "APPLIED";
    checks.p2_create_exact_identity = objectRef(createdRigReadback, "layer")?.["stableId"] === rigStable
      && objectRef(createdRigReadback, "layer")?.["name"] === rigName
      && createdRigReadback?.["isNull"] === true
      && createdRigReadback?.["threeDLayer"] === false
      && childStableIds(createdRigReadback).length === 0;
    await refreshState();
    checks.p2_project_snapshot_contains_rig = projectSnapshot !== null && findLayer(projectSnapshot, targetStable, rigStable) !== null;

    const repeatCreate = await dispatchV15("rig.null.create", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable, name: rigName },
      threeDLayer: false,
    }, hostRevision);
    checks.p2_repeat_create_no_op = repeatCreate.outcome === "NO_OP"
      && objectRef(nullRigRecord(repeatCreate), "layer")?.["stableId"] === rigStable
      && nullRigRecord(repeatCreate)?.["isNull"] === true;

    const directRead = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable },
    }, null);
    const directRig = nullRigRecord(directRead);
    checks.p2_direct_readback = directRead.outcome === "NO_OP"
      && objectRef(directRig, "layer")?.["stableId"] === rigStable
      && directRig?.["isNull"] === true
      && childStableIds(directRig).length === 0;

    const beforeStale = await client.observe(projectId);
    state = beforeStale.observed;
    hostRevision = beforeStale.hostRevision;
    projectSnapshot = beforeStale.project;
    const stale = await dispatchV15("rig.null.create", {
      comp: { stableId: targetStable },
      rig: { stableId: staleRigStable, name: `${prefix} Stale Control` },
    }, beforeStale.hostRevision + 1000);
    const afterStale = await client.observe(projectId);
    state = afterStale.observed;
    hostRevision = afterStale.hostRevision;
    projectSnapshot = afterStale.project;
    checks.p1_stale_revision_rejected = stale.outcome === "REJECTED" && stale.error?.code === "HOST_REVISION_CONFLICT";
    checks.p1_stale_revision_unchanged = stale.hostProjectRevision === beforeStale.hostRevision
      && afterStale.hostRevision === beforeStale.hostRevision;
    checks.p1_stale_fingerprint_unchanged = afterStale.observed.projectFingerprint === beforeStale.observed.projectFingerprint;
    checks.p1_stale_rig_absent = findLayer(afterStale.project, targetStable, staleRigStable) === null;

    const parentChild = await dispatchV14("layer.set_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
      parentLayer: { stableId: rigStable },
    }, hostRevision);
    const parented = parentingRecord(parentChild);
    checks.p2_parent_child_applied = parentChild.outcome === "APPLIED"
      && parented?.["hasParent"] === true
      && objectRef(parented, "parentLayer")?.["stableId"] === rigStable;
    await refreshState();
    const childAfterParent = projectSnapshot === null ? null : findLayer(projectSnapshot, targetStable, childLayerStable);
    checks.p2_project_snapshot_parent_matches = childAfterParent?.parentStableId === rigStable;

    const attachedRead = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable },
    }, null);
    attachedRigReadback = nullRigRecord(attachedRead);
    const attachedChildren = childStableIds(attachedRigReadback);
    checks.p2_topology_reports_child = attachedRead.outcome === "NO_OP"
      && attachedChildren.length === 1
      && attachedChildren[0] === childLayerStable;

    const beforeBlocked = await client.observe(projectId);
    state = beforeBlocked.observed;
    hostRevision = beforeBlocked.hostRevision;
    projectSnapshot = beforeBlocked.project;
    const blockedRemove = await dispatchV15("rig.null.remove", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable },
    }, beforeBlocked.hostRevision);
    blockedRemovalReadback = nullRigRecord(blockedRemove);
    const afterBlocked = await client.observe(projectId);
    state = afterBlocked.observed;
    hostRevision = afterBlocked.hostRevision;
    projectSnapshot = afterBlocked.project;
    checks.p1_child_protected_remove_rejected = blockedRemove.outcome === "REJECTED"
      && blockedRemove.error?.code === "NULL_RIG_HAS_CHILDREN";
    checks.p1_child_protected_revision_unchanged = blockedRemove.hostProjectRevision === beforeBlocked.hostRevision
      && afterBlocked.hostRevision === beforeBlocked.hostRevision;
    checks.p1_child_protected_fingerprint_unchanged = afterBlocked.observed.projectFingerprint === beforeBlocked.observed.projectFingerprint;
    checks.p1_child_protected_topology_intact = childStableIds(blockedRemovalReadback).includes(childLayerStable)
      && findLayer(afterBlocked.project, targetStable, rigStable) !== null
      && findLayer(afterBlocked.project, targetStable, childLayerStable)?.parentStableId === rigStable;

    const clearParent = await dispatchV14("layer.clear_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, hostRevision);
    const clearedParenting = parentingRecord(clearParent);
    checks.p2_clear_parent_applied = clearParent.outcome === "APPLIED"
      && clearedParenting?.["hasParent"] === false
      && clearedParenting?.["parentLayer"] === null;
    await refreshState();

    const detachedRead = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable },
    }, null);
    detachedRigReadback = nullRigRecord(detachedRead);
    checks.p2_topology_empty_after_detach = detachedRead.outcome === "NO_OP"
      && childStableIds(detachedRigReadback).length === 0;

    const removeRig = await dispatchV15("rig.null.remove", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable },
    }, hostRevision);
    checks.p2_remove_applied = removeRig.outcome === "APPLIED"
      && nullRigRecord(removeRig)?.["removed"] === true
      && nullRigRecord(removeRig)?.["stableId"] === rigStable;
    await refreshState();
    checks.p2_project_snapshot_rig_absent = projectSnapshot !== null && findLayer(projectSnapshot, targetStable, rigStable) === null;

    const absentRead = await dispatchV15("rig.null.readback", {
      comp: { stableId: targetStable },
      rig: { stableId: rigStable },
    }, null);
    checks.p2_absent_readback_rejected = absentRead.outcome === "REJECTED" && absentRead.error?.code === "NULL_RIG_NOT_FOUND";

    checks.p1 = checks.p1_stale_revision_rejected
      && checks.p1_stale_revision_unchanged
      && checks.p1_stale_fingerprint_unchanged
      && checks.p1_stale_rig_absent
      && checks.p1_child_protected_remove_rejected
      && checks.p1_child_protected_revision_unchanged
      && checks.p1_child_protected_fingerprint_unchanged
      && checks.p1_child_protected_topology_intact;
    checks.p2 = checks.p2_create_applied
      && checks.p2_create_exact_identity
      && checks.p2_project_snapshot_contains_rig
      && checks.p2_repeat_create_no_op
      && checks.p2_direct_readback
      && checks.p2_parent_child_applied
      && checks.p2_project_snapshot_parent_matches
      && checks.p2_topology_reports_child
      && checks.p2_clear_parent_applied
      && checks.p2_topology_empty_after_detach
      && checks.p2_remove_applied
      && checks.p2_project_snapshot_rig_absent
      && checks.p2_absent_readback_rejected;

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
      fixture: {
        sourceStable,
        targetStable,
        childLayerStable,
        rigStable,
        staleRigStable,
        rigName,
      },
      topologyEvidence: {
        created: createdRigReadback,
        attached: attachedRigReadback,
        blockedRemoval: blockedRemovalReadback,
        detached: detachedRigReadback,
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
