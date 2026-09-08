import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  type AeAdapterPublicCommandV11,
  type AeAdapterResponseV11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  AE_MOTION_RENDER_PROTOCOL_VERSION_V110,
  type AeCompMotionRenderSettingsV110,
  type AeLayerMotionRenderSettingsV110,
  type AeMotionRenderCommandV110,
  type AeMotionRenderResponseV110,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_10.js";
import { buildMotionRenderRequestV110 } from "../../../packages/adapters/ae-cep/src/m3-motion-render.js";
import type { ObservedProjectState } from "../../../packages/core-contracts/src/index.js";
import type { AeProjectSnapshot } from "../../../packages/ae-object-model/src/index.js";
import { LoopbackCepBroker, type LoopbackCepPanelSession } from "./loopback-cep.js";

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

interface EnvironmentEvidence {
  readonly hostName: string;
  readonly hostVersion: string;
  readonly hostBuild: string | null;
  readonly adapterProtocolVersion: string;
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
const sameFilesystemPath = (left: string, right: string): boolean => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

const parseConfig = (value: unknown): BridgeConfigFile => {
  const candidate = asRecord(value);
  if (candidate === null || candidate["schemaVersion"] !== 1 || candidate["host"] !== "127.0.0.1") throw new Error("Bridge config schema/host is invalid.");
  if (!Number.isInteger(candidate["port"]) || (candidate["port"] as number) < 1 || (candidate["port"] as number) > 65535) throw new Error("Bridge config port is invalid.");
  if (typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("Bridge token is invalid.");
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("Bridge legacy protocolVersion mismatch.");
  const supported = candidate["supportedProtocolVersions"];
  if (!Array.isArray(supported)
      || !supported.includes(AE_MOTION_RENDER_PROTOCOL_VERSION_V110)
      || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("Bridge config does not advertise required 1.10 and 1.1 protocols.");
  }
  if (typeof candidate["extensionId"] !== "string" || candidate["extensionId"].length === 0) throw new Error("Bridge extensionId is missing.");
  if (typeof candidate["extensionVersion"] !== "string" || candidate["extensionVersion"].length === 0) throw new Error("Bridge extensionVersion is missing.");
  return candidate as unknown as BridgeConfigFile;
};

const parseAcceptedP1P2 = (value: unknown): void => {
  const candidate = asRecord(value);
  const provenance = candidate === null ? null : asRecord(candidate["provenance"]);
  const levels = candidate === null ? null : asRecord(candidate["proofLevels"]);
  if (candidate === null
      || candidate["proofId"] !== "M3_MOTION_RENDER_P1_P2_ACCEPTANCE"
      || candidate["protocolVersion"] !== AE_MOTION_RENDER_PROTOCOL_VERSION_V110
      || candidate["accepted"] !== true
      || provenance === null
      || provenance["acceptedSourceCommit"] !== "70b1549c56179689fb033db36f13fc4b6dbb5998"
      || provenance["workflowRunId"] !== 34275036819
      || provenance["artifactId"] !== 10075375705
      || levels === null
      || levels["P1_validation_rejection"] !== true
      || levels["P2_structural_readback"] !== true
      || levels["P3_visual_proof"] !== false
      || levels["P4_failure_injection_rollback"] !== false
      || levels["P5_save_reopen_reconnect_transfer"] !== false) {
    throw new Error("Motion-render P5 requires the accepted protocol-1.10 P1/P2 provenance record.");
  }
};

const parseAcceptedP3P4 = (value: string): void => {
  const required = [
    "Exact CI-green source commit under proof: `042a54b63a73dc3fcbcd77d5cb9d6f981492713e`",
    "GitHub Actions real-AE run: `34279808693`",
    "artifact id `10077191111`",
    "**P3 is accepted by independent retained-artifact review",
    "**P4 is accepted for both composition and layer motion-render mutation families.",
    "P5 save/reopen/reconnect transfer is the next separate tranche",
  ];
  for (const token of required) if (!value.includes(token)) throw new Error(`Motion-render P5 P3/P4 acceptance record is missing required provenance: ${token}`);
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const sleep = async (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
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
      if (marker === null || marker["proofId"] !== proofId || typeof marker["ok"] !== "boolean") throw new Error("proof marker identity is invalid");
      if (marker["error"] !== null && typeof marker["error"] !== "string") throw new Error("proof marker error is invalid");
      return marker as unknown as ProofMarker;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await sleep(150);
  }
  throw new Error(`PROOF_MARKER_TIMEOUT: ${proofId}${lastError ? ` (${lastError})` : ""}`);
};

const launchAfterFxScript = async (afterFxPath: string, scriptPath: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(afterFxPath, ["-r", scriptPath], { stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
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

const motionRenderRecord = (response: AeMotionRenderResponseV110): Record<string, unknown> | null => nestedRecord(response.readback, "motionRender");
const compositionRecord = (response: AeMotionRenderResponseV110): Record<string, unknown> | null => {
  const motion = motionRenderRecord(response);
  return motion === null ? null : asRecord(motion["composition"]);
};
const layerRecord = (response: AeMotionRenderResponseV110): Record<string, unknown> | null => {
  const motion = motionRenderRecord(response);
  return motion === null ? null : asRecord(motion["layer"]);
};
const valuesMatch = (actual: Record<string, unknown> | null, expected: Readonly<Record<string, unknown>>): boolean => {
  if (actual === null) return false;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
};
const compSettingsMatch = (response: AeMotionRenderResponseV110, expected: AeCompMotionRenderSettingsV110): boolean =>
  valuesMatch(asRecord(compositionRecord(response)?.["values"]), expected as Readonly<Record<string, unknown>>);
const layerSettingsMatch = (response: AeMotionRenderResponseV110, expected: AeLayerMotionRenderSettingsV110): boolean => {
  const actual = asRecord(layerRecord(response)?.["values"]);
  if (!valuesMatch(actual, expected as Readonly<Record<string, unknown>>)) return false;
  if (expected.frameBlendingType !== undefined) {
    const expectedDerived = expected.frameBlendingType !== "NO_FRAME_BLEND";
    if (actual?.["frameBlending"] !== expectedDerived) return false;
  }
  return true;
};
const layerHostIdFromResponse = (response: AeMotionRenderResponseV110): number | null => {
  const value = asRecord(layerRecord(response)?.["layer"])?.["hostId"];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
};

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const afterFxPath = requireArgument("--afterfx-path");
  const reopenScriptPath = requireArgument("--reopen-script");
  const cleanupScriptPath = requireArgument("--cleanup-script");
  const acceptedP1P2Path = argument("--accepted-p1-p2") ?? path.resolve("proofs/diagnostics/m3-motion-render-p1-p2-acceptance.json");
  const acceptedP3P4Path = argument("--accepted-p3-p4") ?? path.resolve("proofs/diagnostics/m3-motion-render-p3-p4-run4-acceptance.md");
  const timeoutMs = Number(argument("--timeout-ms") ?? "240000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const startedAt = new Date().toISOString();
  const artifactDir = path.dirname(resultPath);
  const projectPath = path.join(artifactDir, "m3-motion-render-p5-transfer.aep");
  const reopenMarkerPath = path.join(artifactDir, "reopen-result.json");
  const cleanupMarkerPath = path.join(artifactDir, "cleanup-result.json");
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
  let savedItemCount: number | null = null;
  let savedNativeLayerId: number | null = null;
  let reopenedNativeLayerId: number | null = null;
  let initialSession: SessionEvidence | null = null;
  let reconnectedSession: SessionEvidence | null = null;
  let reopenMarker: ProofMarker | null = null;
  let cleanupMarker: ProofMarker | null = null;
  let environment: EnvironmentEvidence | null = null;
  let panelExtensionVersion: string | null = null;
  let operationCounter = 0;
  let requestCounter = 0;
  let fixtureTouched = false;

  const projectId = "m3-motion-render-p5-real-ae";
  const prefix = `M3_MOTION_RENDER_P5_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layerStable = `${prefix}_LAYER`;
  const preSaveCompSettings: AeCompMotionRenderSettingsV110 = {
    motionBlur: true,
    frameBlending: true,
    shutterAngle: 315,
    shutterPhase: -105,
    samplesPerFrame: 24,
    adaptiveSampleLimit: 96,
  };
  const preSaveLayerSettings: AeLayerMotionRenderSettingsV110 = {
    motionBlur: true,
    frameBlendingType: "FRAME_MIX",
  };
  const postReconnectCompSettings: AeCompMotionRenderSettingsV110 = {
    motionBlur: false,
    frameBlending: true,
    shutterAngle: 180,
    shutterPhase: -45,
    samplesPerFrame: 32,
    adaptiveSampleLimit: 128,
  };
  const postReconnectLayerSettings: AeLayerMotionRenderSettingsV110 = {
    motionBlur: false,
    frameBlendingType: "PIXEL_MOTION",
  };

  const recordResponse = (response: AeAdapterResponseV11 | AeMotionRenderResponseV110): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command: response.command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
      notes: response.diagnostics.notes ?? [],
    });
  };
  const refreshState = async (): Promise<void> => {
    if (client === null) throw new Error("M3 motion-render P5 client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
  };
  const executeV11 = async (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>, readbackProfile = "M3_MOTION_RENDER_P5_TRANSFER"): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("M3 motion-render P5 V11 state is not initialized.");
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_OP_${++operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile,
    });
    recordResponse(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`${command} failed: ${response.error?.code ?? response.outcome}`);
    await refreshState();
    return response;
  };
  const dispatchV110 = async (command: AeMotionRenderCommandV110, payload: Readonly<Record<string, unknown>>, expectedRevision: number | null, readbackProfile = "M3_MOTION_RENDER_P5_TRANSFER"): Promise<AeMotionRenderResponseV110> => {
    if (broker === null) throw new Error("M3 motion-render P5 broker is not initialized.");
    const response = await broker.dispatch(buildMotionRenderRequestV110({
      requestId: `m3-motion-render-p5-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V110_OP_${++operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile,
    }));
    recordResponse(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };
  const createClient = (): AeCepAdapterClientV11 => {
    if (broker === null) throw new Error("M3 motion-render P5 broker is not initialized.");
    return new AeCepAdapterClientV11(broker, () => `m3-motion-render-p5-v11-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
  };
  const readbackPayload = (): Readonly<Record<string, unknown>> => ({ comp: { stableId: targetStable }, layer: { stableId: layerStable } });

  try {
    await mkdir(artifactDir, { recursive: true });
    await Promise.all([rm(resultPath, { force: true }), rm(projectPath, { force: true }), rm(reopenMarkerPath, { force: true }), rm(cleanupMarkerPath, { force: true })]);
    parseAcceptedP1P2(JSON.parse(stripUtf8Bom(await readFile(acceptedP1P2Path, "utf8"))) as unknown);
    parseAcceptedP3P4(await readFile(acceptedP3P4Path, "utf8"));
    if (!(await stat(reopenScriptPath)).isFile() || !(await stat(cleanupScriptPath)).isFile()) throw new Error("Motion-render P5 proof scripts are missing.");
    if (!(await stat(afterFxPath)).isFile()) throw new Error("AfterFX executable is missing.");

    const config = parseConfig(JSON.parse(stripUtf8Bom(await readFile(configPath, "utf8"))) as unknown);
    panelExtensionVersion = config.extensionVersion;
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 30_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
      supportedProtocolVersions: [AE_MOTION_RENDER_PROTOCOL_VERSION_V110, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);
    const firstPanel = await broker.waitForPanel(timeoutMs);
    initialSession = sessionEvidence(firstPanel);
    checks.accepted_p1_p2_record = true;
    checks.accepted_p3_p4_record = true;
    checks.proof_scripts_present = true;
    checks.afterfx_present = true;
    checks.initial_panel_negotiated_v110 = firstPanel.protocolVersion === AE_MOTION_RENDER_PROTOCOL_VERSION_V110;
    checks.initial_panel_supports_v11_v110 = firstPanel.supportedProtocolVersions.includes(AE_MOTION_RENDER_PROTOCOL_VERSION_V110)
      && firstPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.initial_panel_negotiated_v110 || !checks.initial_panel_supports_v11_v110) throw new Error("Motion-render P5 requires authenticated protocol 1.10 with baseline 1.1 compatibility.");

    client = createClient();
    const probed = await client.probe();
    environment = {
      hostName: probed.hostName,
      hostVersion: probed.hostVersion,
      hostBuild: probed.hostBuild,
      adapterProtocolVersion: probed.adapterProtocolVersion,
    };
    checks.host_probe = probed.hostName === "Adobe After Effects" && probed.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;
    baselineFilePath = baseline.project.filePath;
    checks.blank_baseline = baseline.project.itemCount === 0 && baseline.project.filePath === null;
    if (!checks.blank_baseline) throw new Error("Motion-render P5 requires a blank unsaved runner-owned project baseline.");

    const source = await executeV11("comp.create", { stableId: sourceStable, name: `${prefix} Source`, width: 320, height: 180, pixelAspect: 1, duration: 2, frameRate: 24 });
    fixtureTouched = true;
    checks.source_created = source.affectedObjects.some((item) => item.stableId === sourceStable);
    const target = await executeV11("comp.create", { stableId: targetStable, name: `${prefix} Transfer Target`, width: 640, height: 360, pixelAspect: 1, duration: 2, frameRate: 24 });
    checks.target_created = target.affectedObjects.some((item) => item.stableId === targetStable);
    await executeV11("layer.add_media", { stableId: layerStable, comp: { stableId: targetStable }, item: { stableId: sourceStable } });

    if (hostRevision === null) throw new Error("Host revision unavailable before P5 pre-save composition mutation.");
    const preComp = await dispatchV110("comp.motion_render.set", { comp: { stableId: targetStable }, settings: preSaveCompSettings }, hostRevision, "M3_MOTION_RENDER_P5_COMP_BEFORE_SAVE");
    checks.pre_save_comp_applied = (preComp.outcome === "APPLIED" || preComp.outcome === "NO_OP") && compSettingsMatch(preComp, preSaveCompSettings);
    if (!checks.pre_save_comp_applied) throw new Error(`Motion-render P5 could not establish distinctive pre-save composition state: ${preComp.error?.code ?? preComp.outcome}`);

    if (hostRevision === null) throw new Error("Host revision unavailable before P5 pre-save layer mutation.");
    const preLayer = await dispatchV110("layer.motion_render.set", { comp: { stableId: targetStable }, layer: { stableId: layerStable }, settings: preSaveLayerSettings }, hostRevision, "M3_MOTION_RENDER_P5_LAYER_BEFORE_SAVE");
    checks.pre_save_layer_applied = (preLayer.outcome === "APPLIED" || preLayer.outcome === "NO_OP") && layerSettingsMatch(preLayer, preSaveLayerSettings);
    if (!checks.pre_save_layer_applied) throw new Error(`Motion-render P5 could not establish distinctive pre-save layer state: ${preLayer.error?.code ?? preLayer.outcome}`);

    const preSaveRead = await dispatchV110("motion_render.readback", readbackPayload(), null, "M3_MOTION_RENDER_P5_READ_BEFORE_SAVE");
    savedNativeLayerId = layerHostIdFromResponse(preSaveRead);
    checks.pre_save_motion_render_exact = preSaveRead.outcome === "NO_OP"
      && compSettingsMatch(preSaveRead, preSaveCompSettings)
      && layerSettingsMatch(preSaveRead, preSaveLayerSettings);
    checks.pre_save_native_layer_id = savedNativeLayerId !== null;
    if (!checks.pre_save_motion_render_exact || !checks.pre_save_native_layer_id) throw new Error("Motion-render P5 pre-save readback or native layer identity is incomplete.");

    if (client === null) throw new Error("Motion-render P5 client disappeared before save.");
    const preSaveObserved = await client.observe(projectId);
    state = preSaveObserved.observed;
    hostRevision = preSaveObserved.hostRevision;
    checks.pre_save_fixture_shape = preSaveObserved.project.itemCount === 2
      && preSaveObserved.project.items.some((item) => item.stableId === sourceStable && item.kind === "COMPOSITION")
      && preSaveObserved.project.items.some((item) => item.stableId === targetStable && item.kind === "COMPOSITION")
      && findLayerIndex(preSaveObserved.project, targetStable, layerStable) === 1;
    if (!checks.pre_save_fixture_shape) throw new Error("Motion-render P5 fixture shape is not exact before save.");

    const saveResponse = await executeV11("project.save", { path: projectPath }, "M3_MOTION_RENDER_P5_SAVE");
    checks.project_save_applied = saveResponse.outcome === "APPLIED" || saveResponse.outcome === "NO_OP";
    checks.saved_project_artifact = await fileExistsNonEmpty(projectPath);
    if (!checks.saved_project_artifact) throw new Error("Motion-render P5 project.save did not produce a non-empty .aep artifact.");

    if (client === null) throw new Error("Motion-render P5 client disappeared after save.");
    const saved = await client.observe(projectId);
    state = saved.observed;
    hostRevision = saved.hostRevision;
    savedFingerprint = saved.observed.projectFingerprint;
    savedItemCount = saved.project.itemCount;
    checks.saved_project_path_readback = saved.project.filePath !== null && sameFilesystemPath(saved.project.filePath, projectPath);
    checks.saved_fixture_shape = saved.project.itemCount === 2 && findLayerIndex(saved.project, targetStable, layerStable) === 1;
    if (!checks.saved_project_path_readback || !checks.saved_fixture_shape) throw new Error("Motion-render P5 saved-project structural readback is incomplete.");

    await launchAfterFxScript(afterFxPath, reopenScriptPath);
    reopenMarker = await waitForMarker(reopenMarkerPath, "M3_MOTION_RENDER_P5_REOPEN", timeoutMs);
    checks.reopen_script_passed = reopenMarker.ok === true
      && reopenMarker["dispatcherReady"] === true
      && typeof reopenMarker["projectPath"] === "string"
      && sameFilesystemPath(reopenMarker["projectPath"] as string, projectPath)
      && reopenMarker["itemCount"] === savedItemCount;
    if (!checks.reopen_script_passed) throw new Error(`Motion-render P5 reopen proof failed: ${reopenMarker.error ?? "invalid marker"}`);

    if (initialSession === null) throw new Error("Motion-render P5 initial session evidence is missing.");
    const firstSessionId = initialSession.sessionId;
    await broker.stop();
    await sleep(300);
    const reboundPort = await broker.start();
    if (reboundPort !== config.port) throw new Error(`CEP broker rebound unexpected port ${reboundPort}.`);
    const secondPanel = await broker.waitForPanel(timeoutMs);
    reconnectedSession = sessionEvidence(secondPanel);
    checks.authenticated_reconnect = secondPanel.sessionId !== firstSessionId
      && secondPanel.protocolVersion === AE_MOTION_RENDER_PROTOCOL_VERSION_V110
      && secondPanel.supportedProtocolVersions.includes(AE_MOTION_RENDER_PROTOCOL_VERSION_V110)
      && secondPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)
      && secondPanel.extensionId === config.extensionId
      && secondPanel.extensionVersion === config.extensionVersion;
    if (!checks.authenticated_reconnect) throw new Error("Motion-render P5 did not establish a distinct authenticated protocol-1.10 CEP session after reopen.");

    client = createClient();
    const reconnectedEnvironment = await client.probe();
    checks.post_reconnect_host_probe = reconnectedEnvironment.hostName === "Adobe After Effects" && reconnectedEnvironment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;
    const reopened = await client.observe(projectId);
    state = reopened.observed;
    hostRevision = reopened.hostRevision;
    checks.reopened_project_path = reopened.project.filePath !== null && sameFilesystemPath(reopened.project.filePath, projectPath);
    checks.reopened_item_count_preserved = savedItemCount !== null && reopened.project.itemCount === savedItemCount;
    checks.reopened_stable_fixture = reopened.project.items.some((item) => item.stableId === sourceStable && item.kind === "COMPOSITION")
      && reopened.project.items.some((item) => item.stableId === targetStable && item.kind === "COMPOSITION")
      && findLayerIndex(reopened.project, targetStable, layerStable) === 1;
    checks.saved_structural_fingerprint_preserved = savedFingerprint !== null && reopened.observed.projectFingerprint === savedFingerprint;

    const postReconnectRead = await dispatchV110("motion_render.readback", readbackPayload(), null, "M3_MOTION_RENDER_P5_POST_RECONNECT_READ");
    reopenedNativeLayerId = layerHostIdFromResponse(postReconnectRead);
    checks.native_layer_id_preserved = savedNativeLayerId !== null && reopenedNativeLayerId === savedNativeLayerId;
    checks.motion_render_exact_after_reopen_reconnect = postReconnectRead.outcome === "NO_OP"
      && compSettingsMatch(postReconnectRead, preSaveCompSettings)
      && layerSettingsMatch(postReconnectRead, preSaveLayerSettings)
      && checks.native_layer_id_preserved === true;
    if (!checks.motion_render_exact_after_reopen_reconnect) throw new Error("Motion-render P5 state or native layer identity changed across save/reopen/reconnect.");

    if (hostRevision === null) throw new Error("Host revision unavailable before P5 post-reconnect composition mutation.");
    const postComp = await dispatchV110("comp.motion_render.set", { comp: { stableId: targetStable }, settings: postReconnectCompSettings }, hostRevision, "M3_MOTION_RENDER_P5_POST_RECONNECT_COMP_MUTATION");
    checks.post_reconnect_comp_mutation_readback = (postComp.outcome === "APPLIED" || postComp.outcome === "NO_OP")
      && compSettingsMatch(postComp, postReconnectCompSettings)
      && layerHostIdFromResponse(postComp) === null;
    if (!checks.post_reconnect_comp_mutation_readback) throw new Error(`Motion-render P5 post-reconnect composition mutation failed: ${postComp.error?.code ?? postComp.outcome}`);

    if (hostRevision === null) throw new Error("Host revision unavailable before P5 post-reconnect layer mutation.");
    const postLayer = await dispatchV110("layer.motion_render.set", { comp: { stableId: targetStable }, layer: { stableId: layerStable }, settings: postReconnectLayerSettings }, hostRevision, "M3_MOTION_RENDER_P5_POST_RECONNECT_LAYER_MUTATION");
    checks.post_reconnect_layer_mutation_readback = (postLayer.outcome === "APPLIED" || postLayer.outcome === "NO_OP")
      && layerSettingsMatch(postLayer, postReconnectLayerSettings)
      && layerHostIdFromResponse(postLayer) === savedNativeLayerId;
    if (!checks.post_reconnect_layer_mutation_readback) throw new Error(`Motion-render P5 post-reconnect layer mutation failed: ${postLayer.error?.code ?? postLayer.outcome}`);

    const finalRead = await dispatchV110("motion_render.readback", readbackPayload(), null, "M3_MOTION_RENDER_P5_POST_RECONNECT_FINAL_READ");
    checks.post_reconnect_combined_exact = finalRead.outcome === "NO_OP"
      && compSettingsMatch(finalRead, postReconnectCompSettings)
      && layerSettingsMatch(finalRead, postReconnectLayerSettings)
      && layerHostIdFromResponse(finalRead) === savedNativeLayerId;
    if (!checks.post_reconnect_combined_exact) throw new Error("Motion-render P5 final post-reconnect combined readback is not exact.");

    await launchAfterFxScript(afterFxPath, cleanupScriptPath);
    cleanupMarker = await waitForMarker(cleanupMarkerPath, "M3_MOTION_RENDER_P5_CLEANUP", timeoutMs);
    checks.proof_cleanup_script_passed = cleanupMarker.ok === true
      && cleanupMarker["proofPrefix"] === prefix
      && cleanupMarker["blankItemCount"] === 0
      && typeof cleanupMarker["retainedProjectPath"] === "string"
      && sameFilesystemPath(cleanupMarker["retainedProjectPath"] as string, projectPath);
    checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);

    if (client === null) throw new Error("Motion-render P5 client disappeared before final cleanup verification.");
    const final = await client.observe(projectId);
    checks.cleanup_blank_project = final.project.itemCount === (baselineItemCount ?? 0) && final.project.filePath === baselineFilePath;
    checks.cleanup_fingerprint_restored = baselineFingerprint !== null && final.observed.projectFingerprint === baselineFingerprint;
    cleanupComplete = checks.proof_cleanup_script_passed === true
      && checks.saved_project_retained_after_cleanup === true
      && checks.cleanup_blank_project === true
      && checks.cleanup_fingerprint_restored === true;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    if (!cleanupComplete && fixtureTouched && broker !== null) {
      try {
        await launchAfterFxScript(afterFxPath, cleanupScriptPath);
        const recovery = await waitForMarker(cleanupMarkerPath, "M3_MOTION_RENDER_P5_CLEANUP", Math.min(timeoutMs, 30_000));
        if (recovery.ok) {
          cleanupMarker = recovery;
          checks.proof_cleanup_script_passed = true;
          checks.saved_project_retained_after_cleanup = await fileExistsNonEmpty(projectPath);
          if (client !== null && broker.isStarted) {
            try {
              const final = await client.observe(projectId);
              checks.cleanup_blank_project = final.project.itemCount === (baselineItemCount ?? 0) && final.project.filePath === baselineFilePath;
              checks.cleanup_fingerprint_restored = baselineFingerprint !== null && final.observed.projectFingerprint === baselineFingerprint;
              cleanupComplete = checks.proof_cleanup_script_passed === true
                && checks.saved_project_retained_after_cleanup === true
                && checks.cleanup_blank_project === true
                && checks.cleanup_fingerprint_restored === true;
            } catch (error) { cleanupErrors.push(`cleanup final observe: ${error instanceof Error ? error.message : String(error)}`); }
          }
        } else cleanupErrors.push(`proof cleanup: ${recovery.error ?? "cleanup marker reported failure"}`);
      } catch (error) { cleanupErrors.push(`proof cleanup: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (broker !== null) {
      try { await broker.stop(); } catch (error) { cleanupErrors.push(`broker stop: ${error instanceof Error ? error.message : String(error)}`); }
    }

    const ok = failureError === null
      && checks.accepted_p1_p2_record === true
      && checks.accepted_p3_p4_record === true
      && checks.proof_scripts_present === true
      && checks.afterfx_present === true
      && checks.initial_panel_negotiated_v110 === true
      && checks.initial_panel_supports_v11_v110 === true
      && checks.host_probe === true
      && checks.blank_baseline === true
      && checks.source_created === true
      && checks.target_created === true
      && checks.pre_save_comp_applied === true
      && checks.pre_save_layer_applied === true
      && checks.pre_save_motion_render_exact === true
      && checks.pre_save_native_layer_id === true
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
      && checks.native_layer_id_preserved === true
      && checks.motion_render_exact_after_reopen_reconnect === true
      && checks.post_reconnect_comp_mutation_readback === true
      && checks.post_reconnect_layer_mutation_readback === true
      && checks.post_reconnect_combined_exact === true
      && checks.proof_cleanup_script_passed === true
      && checks.saved_project_retained_after_cleanup === true
      && checks.cleanup_blank_project === true
      && checks.cleanup_fingerprint_restored === true
      && cleanupComplete;

    await writeJson(resultPath, {
      schemaVersion: 1,
      proofId: "M3_MOTION_RENDER_P5_REAL_AE",
      protocolVersion: AE_MOTION_RENDER_PROTOCOL_VERSION_V110,
      status: ok ? "ACCEPTED" : "FAILURE",
      ok,
      startedAt,
      completedAt: new Date().toISOString(),
      provenance: {
        P1_P2_acceptance: "proofs/diagnostics/m3-motion-render-p1-p2-acceptance.json",
        P1_P2_source: "70b1549c56179689fb033db36f13fc4b6dbb5998",
        P1_P2_run: 34275036819,
        P1_P2_artifact: 10075375705,
        P3_P4_acceptance: "proofs/diagnostics/m3-motion-render-p3-p4-run4-acceptance.md",
        P3_P4_source: "042a54b63a73dc3fcbcd77d5cb9d6f981492713e",
        P3_P4_run: 34279808693,
        P3_P4_artifact: 10077191111,
      },
      proofLevels: {
        P1_validation_rejection: "accepted-baseline-not-replayed",
        P2_structural_readback: "accepted-baseline-not-replayed",
        P3_visual_proof: "accepted-baseline-not-replayed",
        P4_failure_injection_rollback: "accepted-baseline-not-replayed",
        P5_save_reopen_reconnect_transfer: ok,
      },
      checks,
      panel: initialSession === null ? null : { extensionVersion: panelExtensionVersion, initialSession, reconnectedSession },
      environment,
      fixture: { prefix, sourceStable, targetStable, layerStable, preSaveCompSettings, preSaveLayerSettings, postReconnectCompSettings, postReconnectLayerSettings, savedNativeLayerId, reopenedNativeLayerId },
      baseline: { projectFingerprint: baselineFingerprint, itemCount: baselineItemCount, filePath: baselineFilePath },
      saved: { projectFingerprint: savedFingerprint, itemCount: savedItemCount, projectPath },
      artifacts: { savedProject: projectPath, reopenMarker: reopenMarkerPath, cleanupMarker: cleanupMarkerPath },
      reopenMarker,
      cleanupMarker,
      evidence: [],
      responses,
      cleanupComplete,
      cleanupErrors,
      failureError,
      notes: [
        "P5 is gated by the independently accepted protocol-1.10 P1/P2 and P3/P4 records and deliberately does not replay those earlier maturity tranches.",
        "The proof saves distinctive composition motion-render settings plus FRAME_MIX on a proof-owned AVLayer, then requires exact protocol-1.10 readback after fixed-path reopen and a distinct authenticated CEP reconnect.",
        "Fresh post-reconnect protocol-1.10 composition and layer writes switch to a second distinctive state including PIXEL_MOTION and must read back exactly.",
        "Proof-only cleanup discards only unsaved post-reconnect mutations, retains the saved .aep evidence containing the pre-save state, and restores the live runner to its original blank unsaved fingerprint.",
      ],
      limitations: [
        "This P5 tranche proves save/reopen/reconnect transfer for the accepted protocol-1.10 motion-render structural envelope on the exercised composition and AVLayer fixture.",
        "It does not expand the accepted visual-quality envelope beyond the independently reviewed P3 evidence and does not claim artifact-free Pixel Motion for arbitrary footage.",
      ],
    });
    if (!ok) process.exitCode = 1;
  }
};

await main();
