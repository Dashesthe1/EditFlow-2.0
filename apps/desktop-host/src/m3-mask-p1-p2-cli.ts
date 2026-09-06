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
  AE_MASK_PROTOCOL_VERSION_V12,
  type AeMaskCommandV12,
  type AeMaskResponseV12,
  type AeMaskShapeV12,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_2.js";
import { buildMaskRequestV12 } from "../../../packages/adapters/ae-cep/src/m3-mask.js";
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

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const nestedRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = asRecord(value);
  return record === null ? null : asRecord(record[key]);
};

const nearlyEqual = (left: unknown, right: number, tolerance = 0.0001): boolean =>
  typeof left === "number" && Math.abs(left - right) <= tolerance;

const pointEquals = (value: unknown, expected: readonly [number, number]): boolean =>
  Array.isArray(value) && value.length === 2 && nearlyEqual(value[0], expected[0]) && nearlyEqual(value[1], expected[1]);

const pointArrayEquals = (value: unknown, expected: readonly (readonly [number, number])[]): boolean =>
  Array.isArray(value) && value.length === expected.length && value.every((point, index) => pointEquals(point, expected[index]!));

const shapeEquals = (value: unknown, expected: AeMaskShapeV12): boolean => {
  const record = asRecord(value);
  if (record === null || record["closed"] !== expected.closed) return false;
  return pointArrayEquals(record["vertices"], expected.vertices)
    && pointArrayEquals(record["inTangents"], expected.inTangents)
    && pointArrayEquals(record["outTangents"], expected.outTangents);
};

const maskRecord = (response: AeMaskResponseV12): Record<string, unknown> | null => nestedRecord(response.readback, "mask");

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
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null;
  let environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;

  const projectId = "m3-mask-p1-p2-real-ae";
  const prefix = `M3_MASK_P12_${Date.now()}`;
  const transactionId = `${prefix}_TX`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layerStable = `${prefix}_LAYER`;
  const invalidMaskStable = `${prefix}_INVALID_MASK`;
  const maskStable = `${prefix}_MASK_A`;
  const duplicateStable = `${prefix}_MASK_B`;
  let operationCounter = 0;
  let requestCounter = 0;

  const staticShape: AeMaskShapeV12 = {
    closed: true,
    vertices: [[40, 40], [280, 40], [280, 280], [40, 280]],
    inTangents: [[0, -20], [-30, 0], [0, -30], [30, 0]],
    outTangents: [[30, 0], [0, 30], [-30, 0], [0, -30]],
  };
  const animatedShapeA: AeMaskShapeV12 = {
    closed: true,
    vertices: [[50, 50], [270, 55], [265, 270], [55, 265]],
    inTangents: [[0, -18], [-24, 0], [0, -24], [24, 0]],
    outTangents: [[24, 0], [0, 24], [-24, 0], [0, -24]],
  };
  const animatedShapeB: AeMaskShapeV12 = {
    closed: true,
    vertices: [[70, 35], [285, 70], [250, 285], [35, 250]],
    inTangents: [[-8, -22], [-32, -6], [6, -32], [32, 6]],
    outTangents: [[32, 6], [6, 32], [-32, -6], [-6, -32]],
  };

  const recordV11 = (command: string, response: AeAdapterResponseV11): void => {
    responses.push({
      protocolVersion: response.protocolVersion,
      command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
    });
  };

  const recordV12 = (response: AeMaskResponseV12): void => {
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
      readbackProfile: "M3_MASK_P1_P2_SETUP",
    });
    recordV11(command, response);
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
  ): Promise<AeMaskResponseV12> => {
    if (broker === null) throw new Error("M3 broker is not initialized.");
    operationCounter += 1;
    const request = buildMaskRequestV12({
      requestId: `m3-mask-p12-${++requestCounter}`,
      transactionId,
      operationId: `${transactionId}_V12_OP_${operationCounter}`,
      command,
      expectedHostProjectRevision: expectedRevision,
      payload,
      readbackProfile: "M3_MASK_P1_P2_STRUCTURAL",
    });
    const response = await broker.dispatch(request);
    recordV12(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  };

  const cleanupComp = async (stableId: string): Promise<void> => {
    if (client === null) return;
    try {
      await refreshState();
      const observed = await client.observe(projectId);
      state = observed.observed;
      hostRevision = observed.hostRevision;
      const present = observed.project.items.some((item) => item.kind === "COMPOSITION" && item.stableId === stableId);
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
      supportedProtocolVersions: [AE_MASK_PROTOCOL_VERSION_V12, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    checks.panel_negotiated_v12 = panel.protocolVersion === AE_MASK_PROTOCOL_VERSION_V12;
    checks.panel_supports_v11_v12 = panel.supportedProtocolVersions.includes(AE_MASK_PROTOCOL_VERSION_V12)
      && panel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11);
    if (!checks.panel_negotiated_v12 || !checks.panel_supports_v11_v12) {
      throw new Error(`M3 proof requires negotiated protocol ${AE_MASK_PROTOCOL_VERSION_V12} with 1.1 compatibility.`);
    }
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    client = new AeCepAdapterClientV11(
      broker,
      () => `m3-mask-setup-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );
    environment = await client.probe();
    checks.host_probe = environment.hostName === "Adobe After Effects"
      && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;
    await refreshState();

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
    const layerResponse = await executeV11("layer.add_media", {
      stableId: layerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    checks.setup_layer = nestedRecord(layerResponse.readback, "layer")?.["stableId"] === layerStable;

    const beforeInvalid = await client.observe(projectId);
    state = beforeInvalid.observed;
    hostRevision = beforeInvalid.hostRevision;
    const malformed = await dispatchV12("mask.create", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      stableId: invalidMaskStable,
      name: "Rejected Geometry",
      shape: {
        closed: true,
        vertices: [[20, 20], [300, 20], [160, 300]],
        inTangents: [[0, 0], [0, 0]],
        outTangents: [[0, 0], [0, 0], [0, 0]],
      },
    }, beforeInvalid.hostRevision);
    const afterInvalid = await client.observe(projectId);
    state = afterInvalid.observed;
    hostRevision = afterInvalid.hostRevision;
    checks.p1_rejected_before_mutation = malformed.outcome === "REJECTED"
      && malformed.error?.code === "MASK_TANGENT_LENGTH_MISMATCH";
    checks.p1_revision_unchanged = malformed.hostProjectRevision === beforeInvalid.hostRevision
      && afterInvalid.hostRevision === beforeInvalid.hostRevision;
    checks.p1_fingerprint_unchanged = afterInvalid.observed.projectFingerprint === beforeInvalid.observed.projectFingerprint;

    const create = await dispatchV12("mask.create", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      stableId: maskStable,
      name: "Primary Curved Mask",
      shape: staticShape,
      properties: {
        feather: [8, 12],
        expansion: 3,
        opacity: 87,
        mode: "ADD",
        inverted: false,
      },
    }, hostRevision);
    const createdMask = maskRecord(create);
    checks.p2_create = create.outcome === "APPLIED"
      && createdMask?.["stableId"] === maskStable
      && createdMask?.["name"] === "Primary Curved Mask"
      && shapeEquals(createdMask?.["path"], staticShape)
      && pointEquals(createdMask?.["feather"], [8, 12])
      && nearlyEqual(createdMask?.["expansion"], 3)
      && nearlyEqual(createdMask?.["opacity"], 87)
      && createdMask?.["mode"] === "ADD"
      && createdMask?.["inverted"] === false;

    const readStatic = await dispatchV12("mask.readback", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: maskStable },
    }, null);
    const staticMask = maskRecord(readStatic);
    checks.p2_static_readback = readStatic.outcome === "NO_OP"
      && staticMask?.["stableId"] === maskStable
      && shapeEquals(staticMask?.["path"], staticShape);

    const animated = await dispatchV12("mask.set_path", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: maskStable },
      keyframes: [
        { time: 0, shape: animatedShapeA },
        { time: 0.5, shape: animatedShapeB },
      ],
    }, hostRevision);
    const animatedMask = maskRecord(animated);
    const keyframes = animatedMask?.["pathKeyframes"];
    checks.p2_animated_path = animated.outcome === "APPLIED"
      && Array.isArray(keyframes)
      && keyframes.length === 2
      && nearlyEqual(asRecord(keyframes[0])?.["time"], 0)
      && shapeEquals(asRecord(keyframes[0])?.["shape"], animatedShapeA)
      && nearlyEqual(asRecord(keyframes[1])?.["time"], 0.5)
      && shapeEquals(asRecord(keyframes[1])?.["shape"], animatedShapeB);

    const properties = await dispatchV12("mask.set_properties", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: maskStable },
      properties: {
        feather: [14, 6],
        expansion: -4,
        opacity: 64,
        mode: "SUBTRACT",
        inverted: true,
      },
    }, hostRevision);
    const propertyMask = maskRecord(properties);
    checks.p2_properties = properties.outcome === "APPLIED"
      && pointEquals(propertyMask?.["feather"], [14, 6])
      && nearlyEqual(propertyMask?.["expansion"], -4)
      && nearlyEqual(propertyMask?.["opacity"], 64)
      && propertyMask?.["mode"] === "SUBTRACT"
      && propertyMask?.["inverted"] === true;

    const duplicate = await dispatchV12("mask.duplicate", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: maskStable },
      stableId: duplicateStable,
      name: "Duplicated Curved Mask",
    }, hostRevision);
    const duplicateMask = maskRecord(duplicate);
    checks.p2_duplicate = duplicate.outcome === "APPLIED"
      && duplicateMask?.["stableId"] === duplicateStable
      && duplicateMask?.["name"] === "Duplicated Curved Mask"
      && duplicateMask?.["mode"] === "SUBTRACT"
      && duplicateMask?.["inverted"] === true;

    const reorder = await dispatchV12("mask.reorder", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: duplicateStable },
      index: 1,
    }, hostRevision);
    checks.p2_reorder = reorder.outcome === "APPLIED" && maskRecord(reorder)?.["index"] === 1;

    const readFinal = await dispatchV12("mask.readback", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: duplicateStable },
    }, null);
    const finalMask = maskRecord(readFinal);
    const finalKeys = finalMask?.["pathKeyframes"];
    checks.p2_final_readback = readFinal.outcome === "NO_OP"
      && finalMask?.["stableId"] === duplicateStable
      && finalMask?.["index"] === 1
      && Array.isArray(finalKeys)
      && finalKeys.length === 2
      && shapeEquals(asRecord(finalKeys[0])?.["shape"], animatedShapeA)
      && shapeEquals(asRecord(finalKeys[1])?.["shape"], animatedShapeB)
      && pointEquals(finalMask?.["feather"], [14, 6])
      && nearlyEqual(finalMask?.["expansion"], -4)
      && nearlyEqual(finalMask?.["opacity"], 64)
      && finalMask?.["mode"] === "SUBTRACT"
      && finalMask?.["inverted"] === true;

    const removeDuplicate = await dispatchV12("mask.remove", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: duplicateStable },
    }, hostRevision);
    checks.p2_remove_duplicate = removeDuplicate.outcome === "APPLIED"
      && asRecord(maskRecord(removeDuplicate))?.["removedStableId"] === duplicateStable;

    const removePrimary = await dispatchV12("mask.remove", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      mask: { stableId: maskStable },
    }, hostRevision);
    checks.p2_remove_primary = removePrimary.outcome === "APPLIED"
      && asRecord(maskRecord(removePrimary))?.["removedStableId"] === maskStable;

    checks.p1 = checks.p1_rejected_before_mutation && checks.p1_revision_unchanged && checks.p1_fingerprint_unchanged;
    checks.p2 = checks.p2_create && checks.p2_static_readback && checks.p2_animated_path && checks.p2_properties
      && checks.p2_duplicate && checks.p2_reorder && checks.p2_final_readback
      && checks.p2_remove_duplicate && checks.p2_remove_primary;
  } catch (error) {
    failureError = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await cleanupComp(targetStable);
    await cleanupComp(sourceStable);
    cleanupComplete = cleanupErrors.length === 0;
    if (broker !== null) await broker.stop();

    const ok = failureError === null
      && cleanupComplete
      && checks.p1 === true
      && checks.p2 === true;
    await writeJson(resultPath, {
      proofId: "M3_MASK_P1_P2_REAL_AE",
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
