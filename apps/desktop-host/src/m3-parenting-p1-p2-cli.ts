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
  if (!Array.isArray(supported) || !supported.includes(AE_PARENTING_PROTOCOL_VERSION_V14) || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise both required parenting 1.4 and baseline 1.1 protocols.");
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

const parentingRecord = (response: AeParentingResponseV14): Record<string, unknown> | null =>
  nestedRecord(response.readback, "parenting");

const objectRef = (record: Record<string, unknown> | null, key: string): Record<string, unknown> | null =>
  record === null ? null : asRecord(record[key]);

const compSpacePoint = (parenting: Record<string, unknown> | null): readonly number[] | null => {
  if (parenting === null) return null;
  const geometry = asRecord(parenting["compSpaceAnchor"]);
  if (geometry?.["supported"] !== true || !Array.isArray(geometry["point"])) return null;
  const point = geometry["point"] as unknown[];
  if (point.length < 2 || point.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
  return point as number[];
};

const pointsClose = (left: readonly number[] | null, right: readonly number[] | null, tolerance = 0.05): boolean => {
  if (left === null || right === null || left.length !== right.length) return false;
  return left.every((value, index) => Math.abs(value - right[index]!) <= tolerance);
};

const localTransform = (parenting: Record<string, unknown> | null): Record<string, unknown> | null =>
  parenting === null ? null : asRecord(parenting["localTransform"]);

const localTransformChanged = (before: Record<string, unknown> | null, after: Record<string, unknown> | null): boolean => {
  if (before === null || after === null) return false;
  return JSON.stringify(before) !== JSON.stringify(after);
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
  let initialReadback: Record<string, unknown> | null = null;
  let parentedReadback: Record<string, unknown> | null = null;
  let clearedReadback: Record<string, unknown> | null = null;

  const projectId = "m3-parenting-p1-p2-real-ae";
  const prefix = `M3_PARENTING_P12_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const parentLayerStable = `${prefix}_PARENT_LAYER`;
  const childLayerStable = `${prefix}_CHILD_LAYER`;
  const parentTransform = Object.freeze({ position: [430, 210], scale: [135, 80], rotation: 27 });
  const childTransform = Object.freeze({ position: [220, 120], scale: [75, 125], rotation: -12 });
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
      readbackProfile: "M3_PARENTING_P1_P2_SETUP",
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
    if (broker === null) throw new Error("M3 parenting broker is not initialized.");
    operationCounter += 1;
    const request = buildParentingRequestV14({
      requestId: `m3-parenting-p12-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V14_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_PARENTING_P1_P2_STRUCTURAL",
    });
    const response = await broker.dispatch(request);
    recordV14(response);
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
      supportedProtocolVersions: [AE_PARENTING_PROTOCOL_VERSION_V14, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v14 = panel.protocolVersion === AE_PARENTING_PROTOCOL_VERSION_V14;
    checks.panel_supports_v11_v14 = panel.supportedProtocolVersions.includes(AE_PARENTING_PROTOCOL_VERSION_V14)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v14 || !checks.panel_supports_v11_v14) {
      throw new Error(`Parenting proof requires negotiated protocol ${AE_PARENTING_PROTOCOL_VERSION_V14} with 1.1 compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-parenting-setup-${++requestCounter}`,
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
      stableId: parentLayerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    await executeV11("layer.add_media", {
      stableId: childLayerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    await executeV11("layer.set_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: parentLayerStable },
      values: parentTransform,
    });
    await executeV11("layer.set_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
      values: childTransform,
    });

    if (projectSnapshot === null) throw new Error("Project snapshot unavailable after parenting fixture setup.");
    const setupParent = findLayer(projectSnapshot, targetStable, parentLayerStable);
    const setupChild = findLayer(projectSnapshot, targetStable, childLayerStable);
    checks.setup_two_av_layers = setupParent?.kind === "LAYER_AV" && setupChild?.kind === "LAYER_AV";
    checks.setup_transformed_parent = JSON.stringify(setupParent?.transform?.position) === JSON.stringify(parentTransform.position)
      && JSON.stringify(setupParent?.transform?.scale) === JSON.stringify(parentTransform.scale)
      && setupParent?.transform?.rotation === parentTransform.rotation;
    checks.setup_transformed_child = JSON.stringify(setupChild?.transform?.position) === JSON.stringify(childTransform.position)
      && JSON.stringify(setupChild?.transform?.scale) === JSON.stringify(childTransform.scale)
      && setupChild?.transform?.rotation === childTransform.rotation;
    if (!checks.setup_two_av_layers || !checks.setup_transformed_parent || !checks.setup_transformed_child) {
      throw new Error("Parenting fixture did not produce the intended transformed AV parent/child layers.");
    }

    const firstRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, null);
    initialReadback = parentingRecord(firstRead);
    const initialPoint = compSpacePoint(initialReadback);
    checks.p2_initial_readback = firstRead.outcome === "NO_OP"
      && objectRef(initialReadback, "layer")?.["stableId"] === childLayerStable
      && initialReadback?.["hasParent"] === false
      && initialReadback?.["parentLayer"] === null;
    checks.p2_initial_geometry_available = initialPoint !== null;

    const beforeSelf = await client.observe(projectId);
    state = beforeSelf.observed;
    hostRevision = beforeSelf.hostRevision;
    projectSnapshot = beforeSelf.project;
    const selfParent = await dispatchV14("layer.set_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
      parentLayer: { stableId: childLayerStable },
    }, beforeSelf.hostRevision);
    const afterSelf = await client.observe(projectId);
    state = afterSelf.observed;
    hostRevision = afterSelf.hostRevision;
    projectSnapshot = afterSelf.project;
    checks.p1_self_parent_rejected = selfParent.outcome === "REJECTED" && selfParent.error?.code === "PARENT_SELF_REFERENCE";
    checks.p1_self_parent_revision_unchanged = selfParent.hostProjectRevision === beforeSelf.hostRevision
      && afterSelf.hostRevision === beforeSelf.hostRevision;
    checks.p1_self_parent_fingerprint_unchanged = afterSelf.observed.projectFingerprint === beforeSelf.observed.projectFingerprint;

    if (hostRevision === null) throw new Error("Host revision unavailable before stale-revision proof.");
    const beforeStale = await client.observe(projectId);
    state = beforeStale.observed;
    hostRevision = beforeStale.hostRevision;
    projectSnapshot = beforeStale.project;
    const staleRevision = Math.max(0, beforeStale.hostRevision - 1);
    const stale = await dispatchV14("layer.set_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
      parentLayer: { stableId: parentLayerStable },
    }, staleRevision);
    const afterStale = await client.observe(projectId);
    state = afterStale.observed;
    hostRevision = afterStale.hostRevision;
    projectSnapshot = afterStale.project;
    checks.p1_stale_revision_rejected = stale.outcome === "REJECTED" && stale.error?.code === "HOST_REVISION_CONFLICT";
    checks.p1_stale_revision_unchanged = stale.hostProjectRevision === beforeStale.hostRevision
      && afterStale.hostRevision === beforeStale.hostRevision;
    checks.p1_stale_fingerprint_unchanged = afterStale.observed.projectFingerprint === beforeStale.observed.projectFingerprint;

    const setParent = await dispatchV14("layer.set_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
      parentLayer: { stableId: parentLayerStable },
    }, hostRevision);
    parentedReadback = parentingRecord(setParent);
    const parentedPoint = compSpacePoint(parentedReadback);
    checks.p2_set_parent_applied = setParent.outcome === "APPLIED"
      && parentedReadback?.["hasParent"] === true
      && objectRef(parentedReadback, "layer")?.["stableId"] === childLayerStable
      && objectRef(parentedReadback, "parentLayer")?.["stableId"] === parentLayerStable;
    checks.p2_set_parent_comp_space_preserved = pointsClose(initialPoint, parentedPoint);
    checks.p2_set_parent_local_transform_compensated = localTransformChanged(localTransform(initialReadback), localTransform(parentedReadback));
    await refreshState();
    const childAfterSet = projectSnapshot === null ? null : findLayer(projectSnapshot, targetStable, childLayerStable);
    checks.p2_project_snapshot_parent_matches = childAfterSet?.parentStableId === parentLayerStable;

    const repeatSet = await dispatchV14("layer.set_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
      parentLayer: { stableId: parentLayerStable },
    }, hostRevision);
    checks.p2_repeat_set_no_op = repeatSet.outcome === "NO_OP"
      && parentingRecord(repeatSet)?.["hasParent"] === true
      && objectRef(parentingRecord(repeatSet), "parentLayer")?.["stableId"] === parentLayerStable;

    const beforeCycle = await client.observe(projectId);
    state = beforeCycle.observed;
    hostRevision = beforeCycle.hostRevision;
    projectSnapshot = beforeCycle.project;
    const cycle = await dispatchV14("layer.set_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: parentLayerStable },
      parentLayer: { stableId: childLayerStable },
    }, beforeCycle.hostRevision);
    const afterCycle = await client.observe(projectId);
    state = afterCycle.observed;
    hostRevision = afterCycle.hostRevision;
    projectSnapshot = afterCycle.project;
    checks.p1_cycle_rejected = cycle.outcome === "REJECTED" && cycle.error?.code === "PARENT_CYCLE";
    checks.p1_cycle_revision_unchanged = cycle.hostProjectRevision === beforeCycle.hostRevision
      && afterCycle.hostRevision === beforeCycle.hostRevision;
    checks.p1_cycle_fingerprint_unchanged = afterCycle.observed.projectFingerprint === beforeCycle.observed.projectFingerprint;

    const clearParent = await dispatchV14("layer.clear_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, hostRevision);
    clearedReadback = parentingRecord(clearParent);
    const clearedPoint = compSpacePoint(clearedReadback);
    checks.p2_clear_parent_applied = clearParent.outcome === "APPLIED"
      && clearedReadback?.["hasParent"] === false
      && clearedReadback?.["parentLayer"] === null;
    checks.p2_clear_parent_comp_space_preserved = pointsClose(parentedPoint, clearedPoint) && pointsClose(initialPoint, clearedPoint);
    await refreshState();
    const childAfterClear = projectSnapshot === null ? null : findLayer(projectSnapshot, targetStable, childLayerStable);
    checks.p2_project_snapshot_parent_cleared = childAfterClear?.parentStableId === null;

    const repeatClear = await dispatchV14("layer.clear_parent_preserve_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, hostRevision);
    checks.p2_repeat_clear_no_op = repeatClear.outcome === "NO_OP"
      && parentingRecord(repeatClear)?.["hasParent"] === false
      && parentingRecord(repeatClear)?.["parentLayer"] === null;

    const finalRead = await dispatchV14("layer.parenting_readback", {
      comp: { stableId: targetStable },
      layer: { stableId: childLayerStable },
    }, null);
    const finalParenting = parentingRecord(finalRead);
    checks.p2_final_readback = finalRead.outcome === "NO_OP"
      && finalParenting?.["hasParent"] === false
      && finalParenting?.["parentLayer"] === null
      && pointsClose(initialPoint, compSpacePoint(finalParenting));

    checks.p1 = checks.p1_self_parent_rejected
      && checks.p1_self_parent_revision_unchanged
      && checks.p1_self_parent_fingerprint_unchanged
      && checks.p1_stale_revision_rejected
      && checks.p1_stale_revision_unchanged
      && checks.p1_stale_fingerprint_unchanged
      && checks.p1_cycle_rejected
      && checks.p1_cycle_revision_unchanged
      && checks.p1_cycle_fingerprint_unchanged;
    checks.p2 = checks.p2_initial_readback
      && checks.p2_initial_geometry_available
      && checks.p2_set_parent_applied
      && checks.p2_set_parent_comp_space_preserved
      && checks.p2_set_parent_local_transform_compensated
      && checks.p2_project_snapshot_parent_matches
      && checks.p2_repeat_set_no_op
      && checks.p2_clear_parent_applied
      && checks.p2_clear_parent_comp_space_preserved
      && checks.p2_project_snapshot_parent_cleared
      && checks.p2_repeat_clear_no_op
      && checks.p2_final_readback;

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
      proofId: "M3_PARENTING_P1_P2_REAL_AE",
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
        parentLayerStable,
        childLayerStable,
        parentTransform,
        childTransform,
      },
      geometryEvidence: {
        initial: initialReadback,
        parented: parentedReadback,
        cleared: clearedReadback,
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
