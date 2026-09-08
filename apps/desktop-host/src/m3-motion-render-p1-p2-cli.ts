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
  AE_MOTION_RENDER_PROTOCOL_VERSION_V110,
  type AeMotionRenderCommandV110,
  type AeMotionRenderResponseV110,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_10.js";
import { buildMotionRenderRequestV110 } from "../../../packages/adapters/ae-cep/src/m3-motion-render.js";
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
  if (!value) throw new Error(`Missing required argument ${name}.`);
  return value;
};
const stripUtf8Bom = (value: string): string => value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nested = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = asRecord(value);
  return record === null ? null : asRecord(record[key]);
};
const motionRecord = (response: AeMotionRenderResponseV110): Record<string, unknown> | null => nested(response.readback, "motionRender");
const compRecord = (response: AeMotionRenderResponseV110): Record<string, unknown> | null => {
  const motion = motionRecord(response);
  return motion === null ? null : asRecord(motion["composition"]);
};
const layerRecord = (response: AeMotionRenderResponseV110): Record<string, unknown> | null => {
  const motion = motionRecord(response);
  return motion === null ? null : asRecord(motion["layer"]);
};
const valuesOf = (record: Record<string, unknown> | null): Record<string, unknown> | null => record === null ? null : asRecord(record["values"]);
const supportedOf = (record: Record<string, unknown> | null): Record<string, unknown> | null => record === null ? null : asRecord(record["supported"]);
const exactSubset = (actual: Record<string, unknown> | null, expected: Readonly<Record<string, unknown>>): boolean =>
  actual !== null && Object.entries(expected).every(([key, value]) => actual[key] === value);
const sameRecord = (left: Record<string, unknown> | null, right: Record<string, unknown> | null): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
const projectHasComp = (project: AeProjectSnapshot | null, stableId: string): boolean =>
  project?.items.some((item) => item.kind === "COMPOSITION" && item.stableId === stableId) ?? false;
const allTrue = (checks: Record<string, boolean>, keys: readonly string[]): boolean => keys.every((key) => checks[key] === true);

const parseConfig = (value: unknown): BridgeConfigFile => {
  const candidate = asRecord(value);
  if (candidate === null || candidate["schemaVersion"] !== 1 || candidate["host"] !== "127.0.0.1") throw new Error("Bridge config is invalid.");
  if (!Number.isInteger(candidate["port"]) || (candidate["port"] as number) < 1 || (candidate["port"] as number) > 65535) throw new Error("CEP bridge port is invalid.");
  if (typeof candidate["token"] !== "string" || candidate["token"].length < 32) throw new Error("CEP bridge token is invalid.");
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("CEP baseline protocolVersion mismatch.");
  const supported = candidate["supportedProtocolVersions"];
  if (!Array.isArray(supported) || !supported.includes(AE_MOTION_RENDER_PROTOCOL_VERSION_V110) || !supported.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("CEP bridge config does not advertise required protocol 1.10 and baseline 1.1.");
  }
  if (typeof candidate["extensionId"] !== "string" || typeof candidate["extensionVersion"] !== "string") throw new Error("CEP extension identity is missing.");
  return candidate as unknown as BridgeConfigFile;
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
  const evidence: Record<string, unknown>[] = [];
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
  let environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null;

  const projectId = "m3-motion-render-p1-p2-real-ae";
  const prefix = `M3_MOTION_RENDER_P12_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layerStable = `${prefix}_PRECOMP_LAYER`;
  let operationCounter = 0;
  let requestCounter = 0;

  const refreshState = async (): Promise<void> => {
    if (client === null) throw new Error("Baseline AE client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
    projectSnapshot = observed.project;
  };
  const recordV11 = (command: string, response: AeAdapterResponseV11): void => {
    responses.push({ protocolVersion: response.protocolVersion, command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision });
  };
  const recordV110 = (response: AeMotionRenderResponseV110): void => {
    responses.push({ protocolVersion: response.protocolVersion, command: response.command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision });
  };
  const executeV11 = async (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("Baseline AE client/state is not initialized.");
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_V11_OP_${++operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M3_MOTION_RENDER_P1_P2_SETUP",
    });
    recordV11(command, response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") throw new Error(`${command} failed: ${response.error?.code ?? response.outcome}`);
    await refreshState();
    return response;
  };
  const dispatchV110 = async (
    command: AeMotionRenderCommandV110,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null,
  ): Promise<AeMotionRenderResponseV110> => {
    if (broker === null) throw new Error("Protocol 1.10 broker is not initialized.");
    const request = buildMotionRenderRequestV110({
      requestId: `m3-motion-render-p12-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V110_OP_${++operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_MOTION_RENDER_P1_P2_STRUCTURAL",
    });
    const response = await broker.dispatch(request);
    recordV110(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };
  const readMotion = async (): Promise<AeMotionRenderResponseV110> => dispatchV110("motion_render.readback", {
    comp: { stableId: targetStable },
    layer: { stableId: layerStable },
  }, null);
  const cleanupComp = async (stableId: string): Promise<void> => {
    if (client === null) return;
    try {
      await refreshState();
      if (projectHasComp(projectSnapshot, stableId)) await executeV11("comp.remove", { comp: { stableId } });
    } catch (error) {
      cleanupErrors.push(`${stableId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  try {
    const config = parseConfig(JSON.parse(stripUtf8Bom(await readFile(configPath, "utf8"))) as unknown);
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
    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v110 = panel.protocolVersion === AE_MOTION_RENDER_PROTOCOL_VERSION_V110;
    checks.panel_supports_v110_v11 = panel.supportedProtocolVersions.includes(AE_MOTION_RENDER_PROTOCOL_VERSION_V110)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v110 || !checks.panel_supports_v110_v11) throw new Error("Motion-render proof did not negotiate protocol 1.10 with baseline 1.1.");

    client = new AeCepAdapterClientV11(broker, () => `m3-motion-render-setup-${++requestCounter}`, new AeFilesystemPolicyV11([artifactDir]));
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects" && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    projectSnapshot = baseline.project;
    baselineFingerprint = baseline.observed.projectFingerprint;
    baselineItemCount = baseline.project.itemCount;

    await executeV11("comp.create", { stableId: sourceStable, name: `${prefix} Source 12fps`, width: 320, height: 180, pixelAspect: 1, duration: 2, frameRate: 12 });
    await executeV11("comp.create", { stableId: targetStable, name: `${prefix} Target 24fps`, width: 640, height: 360, pixelAspect: 1, duration: 2, frameRate: 24 });
    await executeV11("layer.add_media", { stableId: layerStable, comp: { stableId: targetStable }, item: { stableId: sourceStable } });

    const initial = await readMotion();
    const initialComp = valuesOf(compRecord(initial));
    const initialLayer = valuesOf(layerRecord(initial));
    const compSupported = supportedOf(compRecord(initial));
    const layerSupported = supportedOf(layerRecord(initial));
    checks.p2_initial_readback = initial.outcome === "NO_OP" && initialComp !== null && initialLayer !== null;
    checks.p2_comp_surface_supported = compSupported !== null && ["motionBlur", "frameBlending", "shutterAngle", "shutterPhase", "samplesPerFrame", "adaptiveSampleLimit"].every((key) => compSupported[key] === true);
    checks.p2_layer_surface_supported = layerSupported?.["motionBlur"] === true && layerSupported?.["frameBlendingType"] === true;
    if (initialComp === null || initialLayer === null) throw new Error("Initial protocol 1.10 readback is incomplete.");

    const revisionBeforeInvalidComp = hostRevision;
    const invalidComp = await dispatchV110("comp.motion_render.set", { comp: { stableId: targetStable }, settings: { shutterAngle: 721 } }, hostRevision);
    const afterInvalidComp = await readMotion();
    checks.p1_invalid_comp_rejected = invalidComp.outcome === "REJECTED" && invalidComp.error?.code === "SHUTTER_ANGLE_INVALID";
    checks.p1_invalid_comp_revision_unchanged = invalidComp.hostProjectRevision === revisionBeforeInvalidComp;
    checks.p1_invalid_comp_state_unchanged = sameRecord(valuesOf(compRecord(afterInvalidComp)), initialComp);

    const revisionBeforeInvalidLayer = hostRevision;
    const invalidLayer = await dispatchV110("layer.motion_render.set", { comp: { stableId: targetStable }, layer: { stableId: layerStable }, settings: { frameBlendingType: "OPTICAL_MAGIC" } }, hostRevision);
    const afterInvalidLayer = await readMotion();
    checks.p1_invalid_layer_rejected = invalidLayer.outcome === "REJECTED" && invalidLayer.error?.code === "FRAME_BLENDING_TYPE_INVALID";
    checks.p1_invalid_layer_revision_unchanged = invalidLayer.hostProjectRevision === revisionBeforeInvalidLayer;
    checks.p1_invalid_layer_state_unchanged = sameRecord(valuesOf(layerRecord(afterInvalidLayer)), initialLayer);

    const compTarget = { motionBlur: true, frameBlending: true, shutterAngle: 270, shutterPhase: -90, samplesPerFrame: 16, adaptiveSampleLimit: 64 };
    const compSet = await dispatchV110("comp.motion_render.set", { comp: { stableId: targetStable }, settings: compTarget }, hostRevision);
    const compObserved = valuesOf(compRecord(compSet));
    checks.p2_comp_settings_applied = compSet.outcome === "APPLIED" && exactSubset(compObserved, compTarget);
    evidence.push({ step: "composition-settings", expected: compTarget, observed: compObserved });

    for (const frameBlendingType of ["FRAME_MIX", "PIXEL_MOTION", "NO_FRAME_BLEND"] as const) {
      const expected = { motionBlur: frameBlendingType !== "NO_FRAME_BLEND", frameBlendingType };
      const response = await dispatchV110("layer.motion_render.set", { comp: { stableId: targetStable }, layer: { stableId: layerStable }, settings: expected }, hostRevision);
      const observed = valuesOf(layerRecord(response));
      const derivedEnabled = frameBlendingType !== "NO_FRAME_BLEND";
      checks[`p2_layer_${frameBlendingType.toLowerCase()}`] = (response.outcome === "APPLIED" || response.outcome === "NO_OP")
        && exactSubset(observed, expected)
        && observed?.["frameBlending"] === derivedEnabled;
      evidence.push({ step: `layer-${frameBlendingType}`, expected: { ...expected, frameBlending: derivedEnabled }, observed });
    }

    const beforeStale = await readMotion();
    const beforeStaleComp = valuesOf(compRecord(beforeStale));
    const staleRevision = typeof hostRevision === "number" ? hostRevision - 1 : -1;
    const stale = await dispatchV110("comp.motion_render.set", { comp: { stableId: targetStable }, settings: { shutterAngle: 180 } }, staleRevision);
    const afterStale = await readMotion();
    checks.p1_stale_revision_rejected = stale.outcome === "REJECTED" && stale.error?.code === "HOST_REVISION_CONFLICT";
    checks.p1_stale_revision_state_unchanged = sameRecord(valuesOf(compRecord(afterStale)), beforeStaleComp);

    const restoreLayerSettings = {
      motionBlur: initialLayer["motionBlur"],
      frameBlendingType: initialLayer["frameBlendingType"],
    };
    const restoreCompSettings = {
      motionBlur: initialComp["motionBlur"],
      frameBlending: initialComp["frameBlending"],
      shutterAngle: initialComp["shutterAngle"],
      shutterPhase: initialComp["shutterPhase"],
      samplesPerFrame: initialComp["samplesPerFrame"],
      adaptiveSampleLimit: initialComp["adaptiveSampleLimit"],
    };
    const layerRestore = await dispatchV110("layer.motion_render.set", { comp: { stableId: targetStable }, layer: { stableId: layerStable }, settings: restoreLayerSettings }, hostRevision);
    const compRestore = await dispatchV110("comp.motion_render.set", { comp: { stableId: targetStable }, settings: restoreCompSettings }, hostRevision);
    checks.p2_layer_restored = exactSubset(valuesOf(layerRecord(layerRestore)), restoreLayerSettings);
    checks.p2_comp_restored = exactSubset(valuesOf(compRecord(compRestore)), restoreCompSettings);
  } catch (error) {
    failureError = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
  } finally {
    await cleanupComp(targetStable);
    await cleanupComp(sourceStable);
    if (client !== null) {
      try {
        const cleaned = await client.observe(projectId);
        checks.cleanup_item_count_restored = baselineItemCount !== null && cleaned.project.itemCount === baselineItemCount;
        checks.cleanup_fingerprint_restored = baselineFingerprint !== null && cleaned.observed.projectFingerprint === baselineFingerprint;
        cleanupComplete = checks.cleanup_item_count_restored === true && checks.cleanup_fingerprint_restored === true && cleanupErrors.length === 0;
      } catch (error) {
        cleanupErrors.push(`final observe: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (broker !== null) await broker.stop().catch((error: unknown) => cleanupErrors.push(`broker stop: ${error instanceof Error ? error.message : String(error)}`));
  }

  const p1Keys = [
    "p1_invalid_comp_rejected", "p1_invalid_comp_revision_unchanged", "p1_invalid_comp_state_unchanged",
    "p1_invalid_layer_rejected", "p1_invalid_layer_revision_unchanged", "p1_invalid_layer_state_unchanged",
    "p1_stale_revision_rejected", "p1_stale_revision_state_unchanged",
  ];
  const p2Keys = [
    "p2_initial_readback", "p2_comp_surface_supported", "p2_layer_surface_supported", "p2_comp_settings_applied",
    "p2_layer_frame_mix", "p2_layer_pixel_motion", "p2_layer_no_frame_blend", "p2_layer_restored", "p2_comp_restored",
  ];
  const p1 = allTrue(checks, p1Keys);
  const p2 = allTrue(checks, p2Keys);
  const ok = failureError === null && p1 && p2 && cleanupComplete;

  await mkdir(artifactDir, { recursive: true });
  await writeFile(resultPath, `${JSON.stringify({
    proofId: "M3_MOTION_RENDER_P1_P2_REAL_AE",
    startedAt,
    completedAt: new Date().toISOString(),
    status: ok ? "PASS" : "FAILURE",
    ok,
    protocolVersion: AE_MOTION_RENDER_PROTOCOL_VERSION_V110,
    proofLevels: { P1_validation_rejection: p1, P2_structural_readback: p2, P3_visual_proof: false, P4_failure_injection_rollback: false, P5_save_reopen_reconnect_transfer: false },
    checks,
    panel,
    environment,
    evidence,
    responses,
    baseline: { projectFingerprint: baselineFingerprint, itemCount: baselineItemCount },
    cleanupComplete,
    cleanupErrors,
    failureError,
  }, null, 2)}\n`, "utf8");
  if (!ok) process.exitCode = 1;
};

await main();
