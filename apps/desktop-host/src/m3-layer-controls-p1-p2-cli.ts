import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AeCepAdapterClientV11,
  AeFilesystemPolicyV11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  type AeAdapterResponseV11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16,
  type AeLayerControlsCommandV16,
  type AeLayerControlsResponseV16,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_6.js";
import { buildLayerControlsRequestV16 } from "../../../packages/adapters/ae-cep/src/m3-layer-controls.js";
import type { ObservedProjectState } from "../../../packages/core-contracts/src/index.js";
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

interface ProofMarker {
  readonly proofId: string;
  readonly ok: boolean;
  readonly prefix: string;
  readonly itemCount?: number;
  readonly targetLayerCount?: number;
  readonly stableIds?: Readonly<Record<string, string>>;
  readonly layerIndices?: Readonly<Record<string, number>>;
  readonly hostProjectRevision?: number;
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
const stableJson = (value: unknown): string => JSON.stringify(value);

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

const waitForMarker = async (filePath: string, proofId: string, timeoutMs: number): Promise<ProofMarker> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const text = stripUtf8Bom(await readFile(filePath, "utf8"));
      const parsed = JSON.parse(text) as unknown;
      const record = asRecord(parsed);
      if (record === null) throw new Error("proof marker must be an object");
      if (record["proofId"] !== proofId) throw new Error(`unexpected proofId '${String(record["proofId"])}'`);
      if (record["ok"] !== true) throw new Error("proof marker did not report ok:true");
      return record as unknown as ProofMarker;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
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

const createMonoPcmWav = (sampleRate = 48_000, seconds = 1): Buffer => {
  const sampleCount = Math.floor(sampleRate * seconds);
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < sampleCount; i += 1) {
    const envelope = Math.min(1, i / 800) * Math.min(1, (sampleCount - i) / 800);
    const sample = Math.round(Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 0.25 * envelope * 32767);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  return buffer;
};

const layerControlsRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null =>
  nestedRecord(response.readback, "layerControls");
const compControlsRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null =>
  nestedRecord(response.readback, "compLayerControls");
const controlsRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null =>
  nestedRecord(layerControlsRecord(response), "controls");
const avControlsRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null =>
  nestedRecord(controlsRecord(response), "av");
const layerRecord = (response: AeLayerControlsResponseV16): Record<string, unknown> | null =>
  nestedRecord(layerControlsRecord(response), "layer");

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const afterFxPath = requireArgument("--afterfx-path");
  const setupScriptPath = requireArgument("--setup-script");
  const cleanupScriptPath = requireArgument("--cleanup-script");
  const timeoutMs = Number(argument("--timeout-ms") ?? "120000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

  const prefix = process.env["EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX"] ?? "";
  if (!prefix.startsWith("M3_LAYER_CONTROLS_P12_")) throw new Error("EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX is missing or invalid.");
  if (process.env["EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF"] !== "1") throw new Error("Layer-controls P1/P2 CLI requires proof-gated runner environment.");

  const artifactDir = path.dirname(resultPath);
  const audioPath = path.join(artifactDir, "p12-audio.wav");
  const fixtureMarkerPath = path.join(artifactDir, "fixture-result.json");
  const cleanupMarkerPath = path.join(artifactDir, "cleanup-result.json");
  const checks: Record<string, boolean> = {};
  const responses: RecordedResponse[] = [];
  const cleanupErrors: string[] = [];
  const startedAt = new Date().toISOString();
  let failureError: string | null = null;
  let cleanupComplete = false;
  let fixtureCreated = false;
  let broker: LoopbackCepBroker | null = null;
  let client: AeCepAdapterClientV11 | null = null;
  let state: ObservedProjectState | null = null;
  let hostRevision: number | null = null;
  let baselineFingerprint: string | null = null;
  let baselineItemCount: number | null = null;
  let fixtureMarker: ProofMarker | null = null;
  let cleanupMarker: ProofMarker | null = null;
  let operationCounter = 0;
  let requestCounter = 0;

  const targetStable = `${prefix}_TARGET_COMP`;
  const precompLayerStable = `${prefix}_PRECOMP_LAYER`;
  const audioLayerStable = `${prefix}_AUDIO_LAYER`;
  const solidLayerStable = `${prefix}_SOLID_LAYER`;
  const cameraLayerStable = `${prefix}_CAMERA_LAYER`;
  const transactionId = `${prefix}_TX`;
  const projectId = "m3-layer-controls-p1-p2-real-ae";

  const recordV11 = (command: string, response: AeAdapterResponseV11): void => {
    responses.push({ protocolVersion: response.protocolVersion, command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision });
  };
  const recordV16 = (response: AeLayerControlsResponseV16): void => {
    responses.push({ protocolVersion: response.protocolVersion, command: response.command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision });
  };
  const refreshState = async (): Promise<void> => {
    if (client === null) throw new Error("M2 observation client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    hostRevision = observed.hostRevision;
  };
  const currentFingerprint = async (): Promise<string> => {
    if (client === null) throw new Error("M2 observation client is not initialized.");
    return String((await client.observe(projectId)).observed.projectFingerprint);
  };
  const dispatchV16 = async (
    command: AeLayerControlsCommandV16,
    payload: Readonly<Record<string, unknown>>,
    expectedRevision: number | null = command.endsWith(".set") ? hostRevision : null,
  ): Promise<AeLayerControlsResponseV16> => {
    if (broker === null) throw new Error("Layer-controls broker is not initialized.");
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
  const expectRejected = async (
    command: AeLayerControlsCommandV16,
    payload: Readonly<Record<string, unknown>>,
    code: string,
    expectedRevision: number | null,
  ): Promise<AeLayerControlsResponseV16> => {
    const before = await currentFingerprint();
    const response = await dispatchV16(command, payload, expectedRevision);
    const after = await currentFingerprint();
    if (response.outcome !== "REJECTED" || response.error?.code !== code) {
      throw new Error(`Expected ${code} rejection from ${command}; got ${response.outcome}/${response.error?.code ?? "none"}.`);
    }
    if (before !== after) throw new Error(`${command}/${code} rejection changed the project fingerprint.`);
    return response;
  };
  const expectApplied = async (
    command: AeLayerControlsCommandV16,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<AeLayerControlsResponseV16> => {
    const response = await dispatchV16(command, payload, hostRevision);
    if (response.outcome !== "APPLIED") throw new Error(`${command} expected APPLIED, got ${response.outcome}/${response.error?.code ?? "none"}.`);
    return response;
  };
  const readLayer = async (stableId: string): Promise<AeLayerControlsResponseV16> => {
    const response = await dispatchV16("layer.controls.readback", { comp: { stableId: targetStable }, layer: { stableId } }, null);
    if (response.outcome !== "NO_OP" || layerControlsRecord(response) === null) throw new Error(`Layer controls readback failed for ${stableId}.`);
    return response;
  };
  const layerIndex = (response: AeLayerControlsResponseV16): number | null => {
    const value = layerRecord(response)?.["index"];
    return typeof value === "number" ? value : null;
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await Promise.all([
      rm(fixtureMarkerPath, { force: true }),
      rm(cleanupMarkerPath, { force: true }),
      rm(audioPath, { force: true }),
    ]);
    await writeFile(audioPath, createMonoPcmWav(), { flag: "w" });
    checks.generated_audio_nonempty = (await stat(audioPath)).size > 44;
    checks.setup_script_present = (await stat(setupScriptPath)).isFile();
    checks.cleanup_script_present = (await stat(cleanupScriptPath)).isFile();
    checks.afterfx_present = (await stat(afterFxPath)).isFile();

    const config = parseConfig(JSON.parse(stripUtf8Bom(await readFile(configPath, "utf8"))) as unknown);
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

    const panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v16 = panel.protocolVersion === AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16;
    checks.panel_supports_v16_v11 = panel.supportedProtocolVersions.includes(AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    checks.panel_version_matches_config = panel.extensionVersion === config.extensionVersion;
    if (!checks.panel_negotiated_v16 || !checks.panel_supports_v16_v11 || !checks.panel_version_matches_config) {
      throw new Error("Layer-controls proof requires authenticated protocol 1.6 negotiation with protocol 1.1 compatibility and exact installed panel version.");
    }

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-layer-controls-setup-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );
    const environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects" && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const baseline = await client.observe(projectId);
    state = baseline.observed;
    hostRevision = baseline.hostRevision;
    baselineFingerprint = String(baseline.observed.projectFingerprint);
    baselineItemCount = baseline.project.itemCount;
    checks.blank_unsaved_baseline = baseline.project.itemCount === 0 && baseline.project.filePath === null;
    if (!checks.blank_unsaved_baseline) throw new Error("Layer-controls P1/P2 proof requires a blank unsaved After Effects project baseline.");

    await launchAfterFxScript(afterFxPath, setupScriptPath);
    fixtureMarker = await waitForMarker(fixtureMarkerPath, "M3_LAYER_CONTROLS_P1_P2_FIXTURE", timeoutMs);
    fixtureCreated = true;
    checks.fixture_prefix_exact = fixtureMarker.prefix === prefix;
    checks.fixture_shape_exact = fixtureMarker.itemCount === 4 && fixtureMarker.targetLayerCount === 4;
    await refreshState();

    const precompInitial = await readLayer(precompLayerStable);
    const audioInitial = await readLayer(audioLayerStable);
    const solidInitial = await readLayer(solidLayerStable);
    const cameraInitial = await readLayer(cameraLayerStable);
    const compInitial = await dispatchV16("comp.layer_controls.readback", { comp: { stableId: targetStable } }, null);
    if (compInitial.outcome !== "NO_OP") throw new Error("Initial composition layer-controls readback failed.");

    const expectedIndices = fixtureMarker.layerIndices ?? {};
    checks.p2_initial_order_exact = layerIndex(cameraInitial) === expectedIndices["camera"]
      && layerIndex(solidInitial) === expectedIndices["solid"]
      && layerIndex(audioInitial) === expectedIndices["audio"]
      && layerIndex(precompInitial) === expectedIndices["precomp"];
    checks.p2_precomp_is_av = layerControlsRecord(precompInitial)?.["isAVLayer"] === true;
    checks.p2_camera_is_non_av = layerControlsRecord(cameraInitial)?.["isAVLayer"] === false;
    checks.p2_audio_has_audio = avControlsRecord(audioInitial)?.["hasAudio"] === true;
    checks.p2_solid_has_no_audio = avControlsRecord(solidInitial)?.["hasAudio"] === false;
    checks.p2_precomp_collapse_settable = avControlsRecord(precompInitial)?.["canSetCollapseTransformation"] === true;
    checks.p2_comp_hide_shy_initial = compControlsRecord(compInitial)?.["hideShyLayers"] === false;

    await expectRejected("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { frameBlending: true },
    }, "LAYER_CONTROL_UNKNOWN", hostRevision);
    checks.p1_unknown_control_rejected = true;

    await expectRejected("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: cameraLayerStable }, controls: { quality: "BEST" },
    }, "LAYER_CONTROL_REQUIRES_AV_LAYER", hostRevision);
    checks.p1_av_only_camera_rejected = true;

    await expectRejected("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: solidLayerStable }, controls: { audioEnabled: true },
    }, "LAYER_AUDIO_SWITCH_UNAVAILABLE", hostRevision);
    checks.p1_no_audio_rejected = true;

    const collapseCandidate = avControlsRecord(solidInitial)?.["canSetCollapseTransformation"] === false
      ? solidLayerStable
      : avControlsRecord(audioInitial)?.["canSetCollapseTransformation"] === false
        ? audioLayerStable
        : null;
    if (collapseCandidate === null) throw new Error("Proof fixture did not expose an AV layer with canSetCollapseTransformation:false.");
    await expectRejected("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: collapseCandidate }, controls: { collapseTransformation: true },
    }, "LAYER_COLLAPSE_TRANSFORMATION_NOT_SETTABLE", hostRevision);
    checks.p1_unsettable_collapse_rejected = true;

    const collapseApplied = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { collapseTransformation: true },
    });
    checks.p2_collapse_exact = avControlsRecord(collapseApplied)?.["collapseTransformation"] === true;

    const genericApplied = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable },
      layer: { stableId: precompLayerStable },
      controls: { enabled: false, solo: true, shy: true },
    });
    const genericControls = controlsRecord(genericApplied);
    checks.p2_generic_switches_exact = genericControls?.["enabled"] === false
      && genericControls?.["solo"] === true
      && genericControls?.["shy"] === true;

    const flagsApplied = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable },
      layer: { stableId: precompLayerStable },
      controls: { effectsActive: false, guideLayer: true, preserveTransparency: true },
    });
    const flags = avControlsRecord(flagsApplied);
    checks.p2_av_flags_exact = flags?.["effectsActive"] === false
      && flags?.["guideLayer"] === true
      && flags?.["preserveTransparency"] === true;

    const adjustmentApplied = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { adjustmentLayer: true },
    });
    checks.p2_adjustment_exact = avControlsRecord(adjustmentApplied)?.["adjustmentLayer"] === true;

    const threeDApplied = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { threeDLayer: true },
    });
    checks.p2_3d_exact = avControlsRecord(threeDApplied)?.["threeDLayer"] === true;

    const draftApplied = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { quality: "DRAFT", samplingQuality: "BICUBIC" },
    });
    checks.p2_quality_draft_bicubic = avControlsRecord(draftApplied)?.["quality"] === "DRAFT"
      && avControlsRecord(draftApplied)?.["samplingQuality"] === "BICUBIC";

    const idempotentQuality = await dispatchV16("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { quality: "DRAFT", samplingQuality: "BICUBIC" },
    }, hostRevision);
    checks.p2_idempotent_noop = idempotentQuality.outcome === "NO_OP";

    const wireframeApplied = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { quality: "WIREFRAME", samplingQuality: "BILINEAR" },
    });
    checks.p2_quality_wireframe_bilinear = avControlsRecord(wireframeApplied)?.["quality"] === "WIREFRAME"
      && avControlsRecord(wireframeApplied)?.["samplingQuality"] === "BILINEAR";

    const bestApplied = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { quality: "BEST" },
    });
    checks.p2_quality_best = avControlsRecord(bestApplied)?.["quality"] === "BEST";

    const audioOff = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: audioLayerStable }, controls: { audioEnabled: false },
    });
    checks.p2_audio_disable_exact = avControlsRecord(audioOff)?.["audioEnabled"] === false;
    const audioOn = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: audioLayerStable }, controls: { audioEnabled: true },
    });
    checks.p2_audio_enable_exact = avControlsRecord(audioOn)?.["audioEnabled"] === true;

    const locked = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { locked: true },
    });
    checks.p2_lock_exact = controlsRecord(locked)?.["locked"] === true;

    await expectRejected("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { solo: false },
    }, "LAYER_LOCKED", hostRevision);
    checks.p1_locked_conflict_rejected = true;

    const unlockFirst = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { locked: false, solo: false },
    });
    checks.p2_unlock_first_exact = controlsRecord(unlockFirst)?.["locked"] === false && controlsRecord(unlockFirst)?.["solo"] === false;

    const lockLast = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { shy: false, locked: true },
    });
    checks.p2_lock_last_exact = controlsRecord(lockLast)?.["shy"] === false && controlsRecord(lockLast)?.["locked"] === true;

    const unlockedAgain = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { locked: false },
    });
    checks.p2_unlock_final_exact = controlsRecord(unlockedAgain)?.["locked"] === false;

    const compShyOn = await expectApplied("comp.layer_controls.set", {
      comp: { stableId: targetStable }, controls: { hideShyLayers: true },
    });
    checks.p2_comp_hide_shy_on = compControlsRecord(compShyOn)?.["hideShyLayers"] === true;
    const staleRevision = hostRevision;
    const compShyOff = await expectApplied("comp.layer_controls.set", {
      comp: { stableId: targetStable }, controls: { hideShyLayers: false },
    });
    checks.p2_comp_hide_shy_off = compControlsRecord(compShyOff)?.["hideShyLayers"] === false;

    await expectRejected("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { enabled: true },
    }, "HOST_REVISION_CONFLICT", staleRevision);
    checks.p1_stale_revision_rejected = true;

    const finalEnabled = await expectApplied("layer.controls.set", {
      comp: { stableId: targetStable }, layer: { stableId: precompLayerStable }, controls: { enabled: true },
    });
    checks.p2_enabled_restore_exact = controlsRecord(finalEnabled)?.["enabled"] === true;

    const [cameraFinal, solidFinal, audioFinal, precompFinal] = await Promise.all([
      readLayer(cameraLayerStable), readLayer(solidLayerStable), readLayer(audioLayerStable), readLayer(precompLayerStable),
    ]);
    checks.p2_order_preserved = layerIndex(cameraFinal) === expectedIndices["camera"]
      && layerIndex(solidFinal) === expectedIndices["solid"]
      && layerIndex(audioFinal) === expectedIndices["audio"]
      && layerIndex(precompFinal) === expectedIndices["precomp"];
    checks.p2_final_precomp_readback_exact = avControlsRecord(precompFinal)?.["collapseTransformation"] === true
      && avControlsRecord(precompFinal)?.["adjustmentLayer"] === true
      && avControlsRecord(precompFinal)?.["threeDLayer"] === true
      && avControlsRecord(precompFinal)?.["quality"] === "BEST"
      && controlsRecord(precompFinal)?.["enabled"] === true
      && controlsRecord(precompFinal)?.["locked"] === false;

    const requiredBeforeCleanup = [
      "generated_audio_nonempty", "setup_script_present", "cleanup_script_present", "afterfx_present",
      "panel_negotiated_v16", "panel_supports_v16_v11", "panel_version_matches_config", "host_probe",
      "blank_unsaved_baseline", "fixture_prefix_exact", "fixture_shape_exact", "p2_initial_order_exact",
      "p2_precomp_is_av", "p2_camera_is_non_av", "p2_audio_has_audio", "p2_solid_has_no_audio",
      "p2_precomp_collapse_settable", "p2_comp_hide_shy_initial", "p1_unknown_control_rejected",
      "p1_av_only_camera_rejected", "p1_no_audio_rejected", "p1_unsettable_collapse_rejected",
      "p2_collapse_exact", "p2_generic_switches_exact", "p2_av_flags_exact", "p2_adjustment_exact",
      "p2_3d_exact", "p2_quality_draft_bicubic", "p2_idempotent_noop", "p2_quality_wireframe_bilinear",
      "p2_quality_best", "p2_audio_disable_exact", "p2_audio_enable_exact", "p2_lock_exact",
      "p1_locked_conflict_rejected", "p2_unlock_first_exact", "p2_lock_last_exact", "p2_unlock_final_exact",
      "p2_comp_hide_shy_on", "p2_comp_hide_shy_off", "p1_stale_revision_rejected", "p2_enabled_restore_exact",
      "p2_order_preserved", "p2_final_precomp_readback_exact",
    ];
    const missing = requiredBeforeCleanup.filter((key) => checks[key] !== true);
    if (missing.length > 0) throw new Error(`Required layer-controls checks did not pass: ${missing.join(", ")}`);
  } catch (error) {
    failureError = error instanceof Error ? error.message : String(error);
  } finally {
    if (fixtureCreated) {
      try {
        await launchAfterFxScript(afterFxPath, cleanupScriptPath);
        cleanupMarker = await waitForMarker(cleanupMarkerPath, "M3_LAYER_CONTROLS_P1_P2_CLEANUP", timeoutMs);
        checks.cleanup_marker_exact = cleanupMarker.prefix === prefix && cleanupMarker.itemCount === 0;
        if (client !== null) {
          const restored = await client.observe(projectId);
          checks.cleanup_item_count_restored = restored.project.itemCount === baselineItemCount;
          checks.cleanup_unsaved_restored = restored.project.filePath === null;
          checks.cleanup_fingerprint_restored = String(restored.observed.projectFingerprint) === baselineFingerprint;
        }
        cleanupComplete = checks.cleanup_marker_exact === true
          && checks.cleanup_item_count_restored === true
          && checks.cleanup_unsaved_restored === true
          && checks.cleanup_fingerprint_restored === true;
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
      }
    } else if (baselineItemCount === 0) {
      try {
        if (client !== null) {
          const restored = await client.observe(projectId);
          cleanupComplete = restored.project.itemCount === 0 && restored.project.filePath === null
            && String(restored.observed.projectFingerprint) === baselineFingerprint;
          checks.cleanup_fingerprint_restored = cleanupComplete;
        }
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
      }
    }

    if (broker !== null) {
      try { await broker.stop(); }
      catch (brokerError) { cleanupErrors.push(`broker: ${brokerError instanceof Error ? brokerError.message : String(brokerError)}`); }
    }
  }

  const p1Checks = [
    "p1_unknown_control_rejected", "p1_av_only_camera_rejected", "p1_no_audio_rejected",
    "p1_unsettable_collapse_rejected", "p1_locked_conflict_rejected", "p1_stale_revision_rejected",
  ];
  const p2Checks = [
    "p2_initial_order_exact", "p2_precomp_is_av", "p2_camera_is_non_av", "p2_audio_has_audio",
    "p2_solid_has_no_audio", "p2_precomp_collapse_settable", "p2_comp_hide_shy_initial", "p2_collapse_exact",
    "p2_generic_switches_exact", "p2_av_flags_exact", "p2_adjustment_exact", "p2_3d_exact",
    "p2_quality_draft_bicubic", "p2_idempotent_noop", "p2_quality_wireframe_bilinear", "p2_quality_best",
    "p2_audio_disable_exact", "p2_audio_enable_exact", "p2_lock_exact", "p2_unlock_first_exact",
    "p2_lock_last_exact", "p2_unlock_final_exact", "p2_comp_hide_shy_on", "p2_comp_hide_shy_off",
    "p2_enabled_restore_exact", "p2_order_preserved", "p2_final_precomp_readback_exact",
  ];
  const p1 = p1Checks.every((key) => checks[key] === true);
  const p2 = p2Checks.every((key) => checks[key] === true);
  const ok = failureError === null && cleanupErrors.length === 0 && cleanupComplete && p1 && p2;
  const result = {
    proofId: "M3_LAYER_CONTROLS_P1_P2_REAL_AE",
    status: ok ? "STRUCTURAL_PASS" : "FAILED",
    ok,
    startedAt,
    completedAt: new Date().toISOString(),
    proofPrefix: prefix,
    proofLevels: {
      P1_validation_rejection: p1,
      P2_structural_readback: p2,
      P3_visual_proof: false,
      P4_failure_injection_rollback: false,
      P5_save_reopen_reconnect_transfer: false,
    },
    checks,
    cleanupComplete,
    cleanupErrors,
    failureError,
    baseline: {
      projectFingerprint: baselineFingerprint,
      itemCount: baselineItemCount,
    },
    fixtureMarker,
    cleanupMarker,
    responses,
    evidenceScope: {
      protocol: AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16,
      layerControls: [
        "enabled", "solo", "shy", "locked", "audioEnabled", "adjustmentLayer",
        "collapseTransformation", "effectsActive", "guideLayer", "preserveTransparency",
        "quality", "samplingQuality", "threeDLayer",
      ],
      compControls: ["hideShyLayers"],
      orderWriteRoute: "ae.layer.order.set (accepted protocol 1.1; not mutated by protocol 1.6 proof)",
      excluded: ["frameBlending", "motionBlur", "shutterAngle", "shutterPhase", "markers"],
    },
    deterministicSummary: stableJson({ p1, p2, cleanupComplete }),
  };
  await writeJson(resultPath, result);
  if (!ok) throw new Error(`M3 layer-controls P1/P2 real-AE proof failed: ${failureError ?? cleanupErrors.join("; ") ?? "unknown"}`);
};

await main();
