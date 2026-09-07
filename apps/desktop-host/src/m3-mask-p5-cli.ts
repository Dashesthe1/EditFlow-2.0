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
  AE_MASK_PROTOCOL_VERSION_V12,
  type AeMaskCommandV12,
  type AeMaskResponseV12,
  type AeMaskShapeV12,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_2.js";
import { buildMaskRequestV12 } from "../../../packages/adapters/ae-cep/src/m3-mask.js";
import type { ObservedProjectState } from "../../../packages/core-contracts/src/index.js";
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
  if (!Array.isArray(supported) || !supported.includes(AE_MASK_PROTOCOL_VERSION_V12) || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise both required M3 1.2 and M2 1.1 protocols.");
  }
  if (typeof candidate["extensionId"] !== "string" || candidate["extensionId"].length === 0) throw new Error("CEP extensionId is missing.");
  if (typeof candidate["extensionVersion"] !== "string" || candidate["extensionVersion"].length === 0) throw new Error("CEP extensionVersion is missing.");
  return candidate as unknown as BridgeConfigFile;
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const nestedRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = asRecord(value);
  return record === null ? null : asRecord(record[key]);
};

const maskRecord = (response: AeMaskResponseV12): Record<string, unknown> | null => nestedRecord(response.readback, "mask");
const stableJson = (value: unknown): string => JSON.stringify(value);

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
      const text = stripUtf8Bom(await readFile(filePath, "utf8"));
      const parsed = JSON.parse(text) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("proof marker must be an object");
      }
      const marker = parsed as Record<string, unknown>;
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
    const child = spawn(afterFxPath, ["-r", scriptPath], {
      stdio: "ignore",
      windowsHide: false,
    });
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

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const afterFxPath = requireArgument("--afterfx-path");
  const reopenScriptPath = requireArgument("--reopen-script");
  const cleanupScriptPath = requireArgument("--cleanup-script");
  const timeoutMs = Number(argument("--timeout-ms") ?? "120000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const artifactDir = path.dirname(resultPath);
  const projectPath = path.join(artifactDir, "m3-mask-p5-transfer.aep");
  const reopenMarkerPath = path.join(artifactDir, "reopen-result.json");
  const cleanupMarkerPath = path.join(artifactDir, "cleanup-result.json");
  const startedAt = new Date().toISOString();

  const checks: Record<string, boolean> = {};
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
  let initialSession: SessionEvidence | null = null;
  let reconnectedSession: SessionEvidence | null = null;
  let panelHostName: string | null = null;
  let panelHostVersion: string | null = null;
  let panelHostBuild: string | null = null;
  let panelExtensionVersion: string | null = null;
  let beforeSaveMask: Record<string, unknown> | null = null;
  let afterReconnectMask: Record<string, unknown> | null = null;
  let afterMutationMask: Record<string, unknown> | null = null;
  let reopenMarker: ProofMarker | null = null;
  let cleanupMarker: ProofMarker | null = null;
  let operationCounter = 0;
  let requestCounter = 0;

  const projectId = "m3-mask-p5-real-ae";
  const prefix = `M3_MASK_P5_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layerStable = `${prefix}_LAYER`;
  const maskStable = `${prefix}_MASK`;

  const smallShape: AeMaskShapeV12 = {
    closed: true,
    vertices: [[160, 54], [266, 160], [160, 266], [54, 160]],
    inTangents: [[-58, 0], [0, -58], [58, 0], [0, 58]],
    outTangents: [[58, 0], [0, 58], [-58, 0], [0, -58]],
  };
  const mediumShape: AeMaskShapeV12 = {
    closed: true,
    vertices: [[160, 28], [292, 160], [160, 292], [28, 160]],
    inTangents: [[-73, 0], [0, -73], [73, 0], [0, 73]],
    outTangents: [[73, 0], [0, 73], [-73, 0], [0, -73]],
  };
  const largeShape: AeMaskShapeV12 = {
    closed: true,
    vertices: [[160, 12], [308, 160], [160, 308], [12, 160]],
    inTangents: [[-82, 0], [0, -82], [82, 0], [0, 82]],
    outTangents: [[82, 0], [0, 82], [-82, 0], [0, -82]],
  };

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

  const recordV12 = (response: AeMaskResponseV12): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command: response.command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
      notes: response.diagnostics.notes,
    });
  };

  const refreshState = async (): Promise<void> => {
    if (client === null) throw new Error("M3 P5 client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
  };

  const executeV11 = async (
    command: AeAdapterPublicCommandV11,
    payload: Readonly<Record<string, unknown>>,
    readbackProfile = "M3_MASK_P5_TRANSFER",
  ): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M3 P5 client state is not initialized.");
    operationCounter += 1;
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_OP_${operationCounter}`,
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

  const dispatchV12 = async (
    command: AeMaskCommandV12,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
    readbackProfile = "M3_MASK_P5_TRANSFER",
  ): Promise<AeMaskResponseV12> => {
    if (broker === null) throw new Error("M3 P5 broker is not initialized.");
    operationCounter += 1;
    const request = buildMaskRequestV12({
      requestId: `m3-mask-p5-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V12_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    });
    const response = await broker.dispatch(request);
    recordV12(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const createClient = (): AeCepAdapterClientV11 => {
    if (broker === null) throw new Error("M3 P5 broker is not initialized.");
    return new AeCepAdapterClientV11(
      broker,
      () => `m3-mask-p5-v11-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );
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

    const configText = stripUtf8Bom(await readFile(configPath, "utf8"));
    const config = parseConfig(JSON.parse(configText) as unknown);
    panelExtensionVersion = config.extensionVersion;

    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 30_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_MASK_PROTOCOL_VERSION_V12, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    const firstPanel = await broker.waitForPanel(timeoutMs);
    initialSession = sessionEvidence(firstPanel);
    checks.initial_panel_negotiated_v12 = firstPanel.protocolVersion === AE_MASK_PROTOCOL_VERSION_V12;
    checks.initial_panel_supports_v11_v12 = firstPanel.supportedProtocolVersions.includes(AE_MASK_PROTOCOL_VERSION_V12)
      && firstPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.initial_panel_negotiated_v12 || !checks.initial_panel_supports_v11_v12) {
      throw new Error("M3 P5 requires an authenticated panel session negotiated at protocol 1.2 with 1.1 compatibility.");
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
    if (!checks.blank_baseline) throw new Error("M3 P5 requires the isolated runner-owned AE process to begin with a blank unsaved project.");

    const sourceComp = await executeV11("comp.create", {
      stableId: sourceStable,
      name: `${prefix} Source`,
      width: 320,
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    checks.source_comp_created = sourceComp.affectedObjects.some((item) => item.stableId === sourceStable);

    const targetComp = await executeV11("comp.create", {
      stableId: targetStable,
      name: `${prefix} Target`,
      width: 320,
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    checks.target_comp_created = targetComp.affectedObjects.some((item) => item.stableId === targetStable);

    const layer = await executeV11("layer.add_media", {
      stableId: layerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    checks.layer_created = nestedRecord(layer.readback, "layer")?.["stableId"] === layerStable;

    const createMask = await dispatchV12("mask.create", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      stableId: maskStable,
      name: "P5 Transfer Mask",
      shape: smallShape,
      properties: {
        feather: [7, 9],
        expansion: 4,
        opacity: 91,
        mode: "ADD",
        inverted: false,
      },
    }, hostRevision);
    if (createMask.outcome !== "APPLIED") throw new Error(`mask.create failed: ${createMask.error?.code ?? createMask.outcome}`);
    checks.mask_created = maskRecord(createMask)?.["stableId"] === maskStable;

    const animateMask = await dispatchV12("mask.set_path", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: maskStable },
      keyframes: [
        { time: 0, shape: smallShape },
        { time: 0.5, shape: mediumShape },
        { time: 1, shape: largeShape },
      ],
    }, hostRevision);
    if (animateMask.outcome !== "APPLIED") throw new Error(`mask.set_path failed: ${animateMask.error?.code ?? animateMask.outcome}`);
    checks.mask_animated = Array.isArray(maskRecord(animateMask)?.["pathKeyframes"])
      && (maskRecord(animateMask)?.["pathKeyframes"] as unknown[]).length === 3;

    await refreshState();
    const preSaveReadback = await dispatchV12("mask.readback", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: maskStable },
    }, null);
    if (preSaveReadback.outcome !== "NO_OP") throw new Error("mask.readback failed before P5 save.");
    beforeSaveMask = maskRecord(preSaveReadback);
    if (beforeSaveMask === null) throw new Error("M3 P5 pre-save mask readback is missing.");
    checks.pre_save_mask_exact = beforeSaveMask["stableId"] === maskStable
      && Array.isArray(beforeSaveMask["pathKeyframes"])
      && (beforeSaveMask["pathKeyframes"] as unknown[]).length === 3
      && beforeSaveMask["mode"] === "ADD"
      && beforeSaveMask["inverted"] === false
      && beforeSaveMask["expansion"] === 4
      && beforeSaveMask["opacity"] === 91;

    await refreshState();
    const saveResponse = await executeV11("project.save", { path: projectPath }, "M3_MASK_P5_SAVE");
    checks.project_save_applied = saveResponse.outcome === "APPLIED" || saveResponse.outcome === "NO_OP";
    checks.saved_project_artifact = await fileExistsNonEmpty(projectPath);
    if (!checks.saved_project_artifact) throw new Error("M3 P5 project.save did not produce a non-empty .aep artifact.");

    if (client === null) throw new Error("M3 P5 client disappeared after save.");
    const saved = await client.observe(projectId);
    state = saved.observed;
    hostRevision = saved.hostRevision;
    savedFingerprint = saved.observed.projectFingerprint;
    checks.saved_project_path_readback = saved.project.filePath !== null && sameFilesystemPath(saved.project.filePath, projectPath);
    checks.saved_fixture_shape = saved.project.itemCount === 2
      && saved.project.items.some((item) => item.stableId === sourceStable && item.kind === "COMPOSITION")
      && saved.project.items.some((item) => item.stableId === targetStable && item.kind === "COMPOSITION");
    if (!checks.saved_project_path_readback || !checks.saved_fixture_shape) {
      throw new Error("M3 P5 saved-project structural readback is incomplete.");
    }

    await launchAfterFxScript(afterFxPath, reopenScriptPath);
    reopenMarker = await waitForMarker(reopenMarkerPath, "M3_MASK_P5_REOPEN", timeoutMs);
    checks.reopen_script_passed = reopenMarker.ok === true
      && reopenMarker["dispatcherReady"] === true
      && typeof reopenMarker["projectPath"] === "string"
      && sameFilesystemPath(reopenMarker["projectPath"], projectPath)
      && reopenMarker["itemCount"] === 2;
    if (!checks.reopen_script_passed) throw new Error(`M3 P5 reopen proof failed: ${reopenMarker.error ?? "invalid marker"}`);

    const firstSessionId = initialSession.sessionId;
    await broker.stop();
    await sleep(300);
    const reboundPort = await broker.start();
    if (reboundPort !== config.port) throw new Error(`CEP broker rebound unexpected port ${reboundPort}.`);
    const secondPanel = await broker.waitForPanel(timeoutMs);
    reconnectedSession = sessionEvidence(secondPanel);
    checks.authenticated_reconnect = secondPanel.sessionId !== firstSessionId
      && secondPanel.protocolVersion === AE_MASK_PROTOCOL_VERSION_V12
      && secondPanel.supportedProtocolVersions.includes(AE_MASK_PROTOCOL_VERSION_V12)
      && secondPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)
      && secondPanel.extensionId === config.extensionId
      && secondPanel.extensionVersion === config.extensionVersion;
    if (!checks.authenticated_reconnect) throw new Error("M3 P5 did not establish a distinct authenticated CEP session after reopen.");

    client = createClient();
    const reconnectedEnvironment = await client.probe();
    checks.post_reconnect_host_probe = reconnectedEnvironment.hostName === "Adobe After Effects"
      && reconnectedEnvironment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;
    const reopened = await client.observe(projectId);
    state = reopened.observed;
    hostRevision = reopened.hostRevision;
    checks.reopened_project_path = reopened.project.filePath !== null && sameFilesystemPath(reopened.project.filePath, projectPath);
    checks.reopened_stable_ids = reopened.project.itemCount === 2
      && reopened.project.items.some((item) => item.stableId === sourceStable)
      && reopened.project.items.some((item) => item.stableId === targetStable)
      && reopened.project.items.some((item) => item.composition?.layers.some((candidate) => candidate.stableId === layerStable) === true);
    checks.saved_structural_fingerprint_preserved = savedFingerprint !== null
      && reopened.observed.projectFingerprint === savedFingerprint;

    const postReconnectReadback = await dispatchV12("mask.readback", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: maskStable },
    }, null);
    if (postReconnectReadback.outcome !== "NO_OP") throw new Error("mask.readback failed after P5 reconnect.");
    afterReconnectMask = maskRecord(postReconnectReadback);
    checks.mask_exact_after_reopen_reconnect = afterReconnectMask !== null
      && beforeSaveMask !== null
      && stableJson(afterReconnectMask) === stableJson(beforeSaveMask);
    if (!checks.mask_exact_after_reopen_reconnect) {
      throw new Error("M3 P5 mask readback changed across save/reopen/reconnect.");
    }

    await refreshState();
    const postReconnectMutation = await dispatchV12("mask.set_properties", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: maskStable },
      properties: {
        feather: [16, 12],
        expansion: 9,
        opacity: 73,
        mode: "SUBTRACT",
        inverted: true,
      },
    }, hostRevision, "M3_MASK_P5_POST_RECONNECT_MUTATION");
    checks.post_reconnect_mutation_applied = postReconnectMutation.outcome === "APPLIED";
    if (!checks.post_reconnect_mutation_applied) {
      throw new Error(`M3 P5 post-reconnect mask mutation failed: ${postReconnectMutation.error?.code ?? postReconnectMutation.outcome}`);
    }

    const postMutationReadback = await dispatchV12("mask.readback", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: maskStable },
    }, null);
    afterMutationMask = maskRecord(postMutationReadback);
    checks.post_reconnect_mutation_readback = postMutationReadback.outcome === "NO_OP"
      && afterMutationMask !== null
      && afterMutationMask["stableId"] === maskStable
      && afterMutationMask["mode"] === "SUBTRACT"
      && afterMutationMask["inverted"] === true
      && afterMutationMask["expansion"] === 9
      && afterMutationMask["opacity"] === 73
      && stableJson(afterMutationMask["feather"]) === stableJson([16, 12]);
    checks.path_animation_survived_post_reconnect_mutation = afterMutationMask !== null
      && beforeSaveMask !== null
      && stableJson(afterMutationMask["pathKeyframes"]) === stableJson(beforeSaveMask["pathKeyframes"]);
    if (!checks.post_reconnect_mutation_readback || !checks.path_animation_survived_post_reconnect_mutation) {
      throw new Error("M3 P5 post-reconnect mutation/readback did not preserve the transferred animated path.");
    }

    await rm(cleanupMarkerPath, { force: true });
    await launchAfterFxScript(afterFxPath, cleanupScriptPath);
    cleanupMarker = await waitForMarker(cleanupMarkerPath, "M3_MASK_P5_CLEANUP", timeoutMs);
    checks.proof_cleanup_script_passed = cleanupMarker.ok === true
      && cleanupMarker["proofPrefix"] === prefix
      && cleanupMarker["blankItemCount"] === 0
      && typeof cleanupMarker["retainedProjectPath"] === "string"
      && sameFilesystemPath(cleanupMarker["retainedProjectPath"], projectPath);
    checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);

    if (client === null) throw new Error("M3 P5 client disappeared before final cleanup verification.");
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
    if (!cleanupComplete && await fileExistsNonEmpty(projectPath)) {
      try {
        await rm(cleanupMarkerPath, { force: true });
        await launchAfterFxScript(afterFxPath, cleanupScriptPath);
        const recoveryCleanup = await waitForMarker(cleanupMarkerPath, "M3_MASK_P5_CLEANUP", Math.min(timeoutMs, 30_000));
        if (recoveryCleanup.ok) {
          cleanupMarker = recoveryCleanup;
          checks.proof_cleanup_script_passed = true;
          checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);
          if (client !== null && broker !== null && broker.isStarted) {
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
          cleanupErrors.push(`proof cleanup marker: ${recoveryCleanup.error ?? "reported failure"}`);
        }
      } catch (error) {
        cleanupErrors.push(`proof cleanup recovery: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (broker !== null && broker.isStarted) {
      try { await broker.stop(); } catch (error) {
        cleanupErrors.push(`broker stop: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const ok = failureError === null
      && cleanupErrors.length === 0
      && cleanupComplete
      && checks.proof_scripts_present === true
      && checks.afterfx_present === true
      && checks.initial_panel_negotiated_v12 === true
      && checks.initial_panel_supports_v11_v12 === true
      && checks.host_probe === true
      && checks.blank_baseline === true
      && checks.source_comp_created === true
      && checks.target_comp_created === true
      && checks.layer_created === true
      && checks.mask_created === true
      && checks.mask_animated === true
      && checks.pre_save_mask_exact === true
      && checks.project_save_applied === true
      && checks.saved_project_artifact === true
      && checks.saved_project_path_readback === true
      && checks.saved_fixture_shape === true
      && checks.reopen_script_passed === true
      && checks.authenticated_reconnect === true
      && checks.post_reconnect_host_probe === true
      && checks.reopened_project_path === true
      && checks.reopened_stable_ids === true
      && checks.saved_structural_fingerprint_preserved === true
      && checks.mask_exact_after_reopen_reconnect === true
      && checks.post_reconnect_mutation_applied === true
      && checks.post_reconnect_mutation_readback === true
      && checks.path_animation_survived_post_reconnect_mutation === true
      && checks.proof_cleanup_script_passed === true
      && checks.saved_project_retained_after_cleanup === true
      && checks.cleanup_blank_project === true
      && checks.cleanup_fingerprint_restored === true;

    await writeJson(resultPath, {
      proofId: "M3_MASK_P5_REAL_AE",
      status: ok ? "ACCEPTED" : "FAILURE",
      ok,
      startedAt,
      completedAt: new Date().toISOString(),
      acceptedBaseline: {
        mainMergeCommit: "2f7af5fba1fe67d663ff84b17c59ca8c5c551ebb",
        p3p4RealAeRun: 34073726432,
        p3p4Acceptance: "proofs/diagnostics/m3-mask-p3-p4-run5-acceptance.md",
      },
      proofLevels: {
        P1_validation_rejection: "accepted-baseline-not-replayed",
        P2_structural_readback: "accepted-baseline-not-replayed",
        P3_visual_proof: "accepted-baseline-not-replayed",
        P4_failure_injection_rollback: "accepted-baseline-not-replayed",
        P5_save_reopen_reconnect_transfer: ok,
      },
      checks,
      sessions: {
        initial: initialSession,
        reconnected: reconnectedSession,
      },
      environment: {
        host: panelHostName,
        hostVersion: panelHostVersion,
        hostBuild: panelHostBuild,
        extensionVersion: panelExtensionVersion,
      },
      stableIds: {
        sourceComp: sourceStable,
        targetComp: targetStable,
        layer: layerStable,
        mask: maskStable,
      },
      artifacts: {
        savedProject: projectPath,
        reopenMarker: reopenMarkerPath,
        cleanupMarker: cleanupMarkerPath,
      },
      readback: {
        beforeSaveMask,
        afterReconnectMask,
        afterMutationMask,
      },
      responses,
      reopenMarker,
      cleanupMarker,
      failureError,
      cleanupErrors,
      cleanupComplete,
      notes: [
        "P5 starts from the merged M3 P3/P4 accepted baseline and deliberately does not replay P1-P4 maturity evidence.",
        "The project is saved through the public v1.1 project.save capability under the artifact-directory filesystem policy.",
        "After Effects closes and reopens the fixed runner-owned .aep, reloads the current dispatcher, and the loopback broker is stopped/restarted so the CEP panel must establish a distinct authenticated session.",
        "Exact mask identity, properties, shape/path animation, and structural fingerprint are checked after reopen/reconnect before a fresh mask.set_properties mutation proves transferred write authority.",
        "The saved .aep is retained as P5 evidence; proof-only cleanup discards only the verified disposable project and the harness re-observes the original blank structural fingerprint.",
      ],
    });
  }
};

main().catch(async (error) => {
  const resultPath = argument("--result");
  if (resultPath) {
    try {
      await writeJson(resultPath, {
        proofId: "M3_MASK_P5_REAL_AE",
        status: "HARNESS_FAILURE",
        ok: false,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
        cleanupComplete: false,
      });
    } catch (_) {}
  }
  console.error(error);
  process.exitCode = 1;
});
