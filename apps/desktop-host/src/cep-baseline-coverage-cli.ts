import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
import type { ObservedProjectState } from "../../../packages/core-contracts/src/index.js";
import { LoopbackCepBroker } from "./loopback-cep.js";

interface BridgeConfigFile {
  readonly schemaVersion: 1;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
  readonly protocolVersion: "1.1.0";
  readonly extensionId: string;
  readonly extensionVersion: string;
}

interface RecordedResponse {
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
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) throw new Error("CEP bridge protocolVersion mismatch.");
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

const numberArrayEquals = (value: unknown, expected: readonly number[]): boolean =>
  Array.isArray(value)
  && value.length === expected.length
  && value.every((item, index) => typeof item === "number" && Math.abs(item - expected[index]!) < 0.0001);

const createSilentWav = (): Buffer => {
  const sampleRate = 8_000;
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = 800;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = sampleCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, 4, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, 4, "ascii");
  buffer.write("fmt ", 12, 4, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, 4, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
};

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "90000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error("--timeout-ms must be at least 10000.");

  const artifactDir = path.dirname(resultPath);
  const mediaPath = path.join(artifactDir, "m2-baseline-media-proof.wav");
  const startedAt = new Date().toISOString();
  const checks: Record<string, boolean> = {};
  const responses: RecordedResponse[] = [];
  const cleanupErrors: string[] = [];
  let broker: LoopbackCepBroker | null = null;
  let client: AeCepAdapterClientV11 | null = null;
  let state: ObservedProjectState | null = null;
  let baselineItemCount: number | null = null;
  let failureError: string | null = null;
  let mediaImported = false;

  const projectId = "m2-final-baseline-coverage";
  const transactionId = `M2_FINAL_BASELINE_TX_${Date.now()}`;
  const prefix = `M2_FINAL_BASELINE_${Date.now()}`;
  const sourceStable = `${prefix}_SOURCE`;
  const targetStable = `${prefix}_TARGET`;
  const layerStable = `${prefix}_LAYER`;
  const duplicateStable = `${prefix}_DUPLICATE`;
  const mediaStable = `${prefix}_MEDIA`;
  let operationCounter = 0;

  const record = (response: AeAdapterResponseV11): void => {
    responses.push({
      command: response.command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
    });
  };

  const refreshState = async (): Promise<void> => {
    if (client === null) throw new Error("CEP client is not initialized.");
    state = (await client.observe(projectId)).observed;
  };

  const execute = async (
    command: AeAdapterPublicCommandV11,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("CEP baseline state is not initialized.");
    operationCounter += 1;
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_OP_${operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M2_FINAL_BASELINE_REAL_AE",
    });
    record(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    }
    await refreshState();
    return response;
  };

  const undoLast = async (): Promise<void> => {
    if (client === null || state === null) throw new Error("CEP baseline state is not initialized for Undo.");
    operationCounter += 1;
    const response = await client.undoLast({
      transactionId,
      operationId: `${transactionId}_UNDO_${operationCounter}`,
      expectedState: state,
    });
    record(response);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`transaction.undo_last failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    }
    await refreshState();
  };

  const itemPresent = async (stableId: string): Promise<boolean> => {
    if (client === null) return false;
    return (await client.inspectProject()).items.some((item) => item.stableId === stableId);
  };

  const cleanupComp = async (stableId: string): Promise<void> => {
    if (client === null) return;
    try {
      const observed = await client.observe(projectId);
      state = observed.observed;
      if (!observed.project.items.some((item) => item.stableId === stableId && item.kind === "COMPOSITION")) return;
      await execute("comp.remove", { comp: { stableId } });
    } catch (error) {
      cleanupErrors.push(`${stableId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(mediaPath, createSilentWav());
    checks.media_source_written = (await stat(mediaPath)).size > 44;

    const configText = stripUtf8Bom(await readFile(configPath, "utf8"));
    const config = parseConfig(JSON.parse(configText) as unknown);
    broker = new LoopbackCepBroker({
      port: config.port,
      token: config.token,
      commandTimeoutMs: Math.min(timeoutMs, 30_000),
      commandLeaseMs: 2_000,
      expectedExtensionId: config.extensionId,
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    const panel = await broker.waitForPanel(timeoutMs);
    if (panel.protocolVersion !== config.protocolVersion || panel.extensionVersion !== config.extensionVersion) {
      throw new Error("Registered CEP panel does not match installed protocol/version config.");
    }
    checks.cep_panel_registered = true;

    let requestCounter = 0;
    client = new AeCepAdapterClientV11(
      broker,
      () => `m2-final-baseline-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );

    const environment = await client.probe();
    const baseline = await client.observe(projectId);
    state = baseline.observed;
    baselineItemCount = baseline.project.itemCount;
    checks.host_probe = environment.hostName === "Adobe After Effects"
      && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    const source = await execute("comp.create", {
      stableId: sourceStable,
      name: `${prefix} Source`,
      width: 320,
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    checks.source_comp_create = source.affectedObjects.some((item) => item.stableId === sourceStable);

    const target = await execute("comp.create", {
      stableId: targetStable,
      name: `${prefix} Target`,
      width: 320,
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24,
    });
    checks.target_comp_create = target.affectedObjects.some((item) => item.stableId === targetStable);

    const settings = await execute("comp.update_settings", {
      comp: { stableId: targetStable },
      settings: { width: 360, height: 340, displayStartTime: 0.125 },
    });
    const settingsReadback = nestedRecord(settings.readback, "composition");
    checks.comp_update_settings = settingsReadback?.["width"] === 360
      && settingsReadback?.["height"] === 340
      && settingsReadback?.["displayStartTime"] === 0.125;

    const layer = await execute("layer.add_media", {
      stableId: layerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    checks.layer_add = nestedRecord(layer.readback, "layer")?.["stableId"] === layerStable;

    const transform = await execute("layer.set_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      values: { anchorPoint: [150, 155], position: [180, 170], scale: [95, 95], rotation: 2, opacity: 98 },
    });
    const transformReadback = nestedRecord(transform.readback, "transform");
    checks.transform_anchor_point = numberArrayEquals(transformReadback?.["anchorPoint"], [150, 155]);
    checks.transform_other_2d = numberArrayEquals(transformReadback?.["position"], [180, 170])
      && numberArrayEquals(transformReadback?.["scale"], [95, 95])
      && transformReadback?.["rotation"] === 2
      && transformReadback?.["opacity"] === 98;

    const duplicate = await execute("layer.duplicate", {
      stableId: duplicateStable,
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
    });
    checks.layer_duplicate = nestedRecord(duplicate.readback, "layer")?.["stableId"] === duplicateStable;

    const reorder = await execute("layer.reorder", {
      comp: { stableId: targetStable },
      layer: { stableId: duplicateStable },
      position: "END",
    });
    checks.layer_reorder = nestedRecord(reorder.readback, "layer")?.["stableId"] === duplicateStable;

    const layerRemove = await execute("layer.remove", {
      comp: { stableId: targetStable },
      layer: { stableId: duplicateStable },
    });
    checks.layer_remove = asRecord(layerRemove.readback)?.["removed"] === true;
    const afterLayerRemove = await client.inspectProject();
    checks.layer_remove_structural = !afterLayerRemove.items.some(
      (item) => item.composition?.layers.some((candidate) => candidate.stableId === duplicateStable) === true,
    );

    const effect = await execute("effect.add", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      matchName: "ADBE Gaussian Blur 2",
      name: `${prefix} Blur`,
    });
    const effectIndex = asRecord(effect.readback)?.["propertyIndex"];
    if (typeof effectIndex !== "number") throw new Error("effect.add did not return propertyIndex.");
    checks.effect_add = true;

    const effectProperty = await execute("effect.set_property", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      effectIndex,
      propertyPath: [1],
      value: 5,
    });
    checks.effect_property = effectProperty.readback !== null;

    const effectRemove = await execute("effect.remove", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      effectIndex,
    });
    checks.effect_remove = asRecord(effectRemove.readback)?.["removed"] === true;

    const keyframeCreate = await execute("property.set_keyframes", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      propertyPath: ["ADBE Transform Group", "ADBE Position"],
      keyframes: [
        { time: 0, value: [170, 170] },
        { time: 0.5, value: [180, 170] },
        { time: 1, value: [190, 170] },
      ],
    });
    checks.keyframe_create = asRecord(keyframeCreate.readback)?.["numKeys"] === 3;

    const keyframeUpdate = await execute("property.set_keyframes", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      propertyPath: ["ADBE Transform Group", "ADBE Position"],
      keyframes: [{ time: 0.5, value: [184, 168] }],
    });
    checks.keyframe_update_existing_time = asRecord(keyframeUpdate.readback)?.["numKeys"] === 3;

    const keyframeDelete = await execute("property.set_keyframes", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      propertyPath: ["ADBE Transform Group", "ADBE Position"],
      removeKeyIndices: [2],
    });
    const deleteReadback = asRecord(keyframeDelete.readback);
    checks.keyframe_delete = deleteReadback?.["mode"] === "REMOVE_KEY_INDICES"
      && deleteReadback?.["removedCount"] === 1
      && deleteReadback?.["numKeys"] === 2
      && numberArrayEquals(deleteReadback?.["removedKeyTimes"], [0.5]);

    const targetRemove = await execute("comp.remove", { comp: { stableId: targetStable } });
    checks.comp_remove_target = asRecord(targetRemove.readback)?.["removed"] === true;
    const sourceRemove = await execute("comp.remove", { comp: { stableId: sourceStable } });
    checks.comp_remove_source = asRecord(sourceRemove.readback)?.["removed"] === true;
    const afterCompRemove = await client.inspectProject();
    checks.comp_remove_structural = !afterCompRemove.items.some(
      (item) => item.stableId === targetStable || item.stableId === sourceStable,
    );
    checks.comp_cleanup_restored_count = baselineItemCount !== null && afterCompRemove.itemCount === baselineItemCount;

    await refreshState();
    const mediaImport = await execute("media.import", {
      path: mediaPath,
      stableId: mediaStable,
      sequence: false,
    });
    mediaImported = true;
    checks.media_import_applied = mediaImport.affectedObjects.some(
      (item) => item.stableId === mediaStable && item.kind === "FOOTAGE",
    );
    const afterImport = await client.inspectProject();
    checks.media_import_structural = afterImport.items.some(
      (item) => item.stableId === mediaStable && item.kind === "FOOTAGE",
    );
    checks.media_import_increased_count = baselineItemCount !== null && afterImport.itemCount === baselineItemCount + 1;

    await undoLast();
    mediaImported = false;
    const afterMediaUndo = await client.inspectProject();
    checks.media_import_undo_removed = !afterMediaUndo.items.some((item) => item.stableId === mediaStable);
    checks.media_import_undo_restored_count = baselineItemCount !== null && afterMediaUndo.itemCount === baselineItemCount;
  } catch (error) {
    failureError = error instanceof Error ? error.message : String(error);
  } finally {
    if (mediaImported && client !== null) {
      try {
        const observed = await client.observe(projectId);
        state = observed.observed;
        if (observed.project.items.some((item) => item.stableId === mediaStable)) {
          await undoLast();
        }
      } catch (error) {
        cleanupErrors.push(`media cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await cleanupComp(targetStable);
    await cleanupComp(sourceStable);

    let finalItemCount: number | null = null;
    let finalMediaAbsent = true;
    if (client !== null) {
      try {
        const finalProject = await client.inspectProject();
        finalItemCount = finalProject.itemCount;
        finalMediaAbsent = !finalProject.items.some((item) => item.stableId === mediaStable);
      } catch (error) {
        cleanupErrors.push(`final inspect: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    checks.final_media_absent = finalMediaAbsent;
    checks.final_item_count_restored = baselineItemCount === null || finalItemCount === baselineItemCount;

    const cleanupComplete = cleanupErrors.length === 0
      && checks.final_media_absent === true
      && checks.final_item_count_restored === true;
    const allChecks = Object.values(checks).every((value) => value === true);
    const ok = failureError === null && cleanupComplete && allChecks;

    await writeJson(resultPath, {
      proofId: "M2_REAL_AE_FINAL_BASELINE_COVERAGE",
      status: ok ? "PASS" : "FAILED",
      ok,
      cleanupComplete,
      startedAt,
      completedAt: new Date().toISOString(),
      protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
      baselineItemCount,
      finalItemCount,
      mediaArtifact: mediaPath,
      checks,
      proofLevels: {
        P2_comp_settings: checks.comp_update_settings === true,
        P2_anchor_point: checks.transform_anchor_point === true,
        P2_layer_remove: checks.layer_remove === true && checks.layer_remove_structural === true,
        P2_effect_remove: checks.effect_remove === true,
        P2_keyframe_crud: checks.keyframe_create === true
          && checks.keyframe_update_existing_time === true
          && checks.keyframe_delete === true,
        P2_media_import: checks.media_import_structural === true,
        P4_media_import_cleanup: checks.media_import_undo_removed === true
          && checks.media_import_undo_restored_count === true,
      },
      responses,
      error: failureError,
      cleanupErrors,
      safety: {
        boundedFilesystemRoot: artifactDir,
        projectSavePerformed: false,
        projectOpenReplacePerformed: false,
        mediaCleanupUsesFixedUndo: true,
      },
    });

    if (broker !== null) await broker.stop();
    if (!ok) process.exitCode = 1;
  }
};

await main();
