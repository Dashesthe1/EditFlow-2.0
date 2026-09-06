import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AeCepAdapterClientV11,
  AeFilesystemPolicyV11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
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
  const timeoutMs = Number(argument("--timeout-ms") ?? "60000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error("--timeout-ms must be at least 10000.");

  const artifactDir = path.dirname(resultPath);
  const sourcePath = path.join(artifactDir, "m2-media-import-proof.wav");
  const startedAt = new Date().toISOString();
  const responses: RecordedResponse[] = [];
  const checks: Record<string, boolean> = {};
  const cleanupErrors: string[] = [];
  let broker: LoopbackCepBroker | null = null;
  let client: AeCepAdapterClientV11 | null = null;
  let state: ObservedProjectState | null = null;
  let baselineItemCount: number | null = null;
  let failureError: string | null = null;

  const projectId = "m2-real-media-import";
  const transactionId = `M2_MEDIA_IMPORT_TX_${Date.now()}`;
  const mediaStableId = `M2_MEDIA_IMPORT_${Date.now()}`;
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

  const mediaIsPresent = async (): Promise<boolean> => {
    if (client === null) return false;
    return (await client.inspectProject()).items.some((item) => item.stableId === mediaStableId);
  };

  const undoImport = async (): Promise<void> => {
    if (client === null || state === null) throw new Error("CEP media import state is not initialized.");
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

  const cleanupImportedMedia = async (): Promise<void> => {
    if (client === null) return;
    try {
      const observed = await client.observe(projectId);
      state = observed.observed;
      const present = observed.project.items.some((item) => item.stableId === mediaStableId);
      if (!present) return;
      await undoImport();
      if (await mediaIsPresent()) cleanupErrors.push("Imported media remained after fixed Undo cleanup.");
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(sourcePath, createSilentWav());
    checks.source_wav_written = (await stat(sourcePath)).size > 44;

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
    if (panel.protocolVersion !== config.protocolVersion) throw new Error("Registered CEP panel protocol mismatch.");
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }
    checks.cep_panel_registered = true;

    let requestCounter = 0;
    client = new AeCepAdapterClientV11(
      broker,
      () => `m2-media-import-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );

    const environment = await client.probe();
    const baseline = await client.observe(projectId);
    state = baseline.observed;
    baselineItemCount = baseline.project.itemCount;
    checks.host_probe = environment.hostName === "Adobe After Effects"
      && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;

    operationCounter += 1;
    const imported = await client.executePublic("media.import", {
      transactionId,
      operationId: `${transactionId}_OP_${operationCounter}`,
      payload: { path: sourcePath, stableId: mediaStableId, sequence: false },
      expectedState: state,
      readbackProfile: "M2_REAL_MEDIA_IMPORT",
    });
    record(imported);
    if (imported.outcome === "FAILED" || imported.outcome === "REJECTED") {
      throw new Error(`media.import failed: ${imported.error?.code ?? imported.outcome} ${imported.error?.message ?? ""}`.trim());
    }
    checks.media_import_applied = imported.affectedObjects.some((item) => item.stableId === mediaStableId && item.kind === "FOOTAGE");
    await refreshState();

    const importedProject = await client.inspectProject();
    checks.media_import_structural_readback = importedProject.items.some(
      (item) => item.stableId === mediaStableId && item.kind === "FOOTAGE",
    );
    checks.media_import_increased_item_count = baselineItemCount !== null
      && importedProject.itemCount === baselineItemCount + 1;

    await undoImport();
    const restoredProject = await client.inspectProject();
    checks.media_import_undo_removed = !restoredProject.items.some((item) => item.stableId === mediaStableId);
    checks.media_import_undo_restored_count = baselineItemCount !== null
      && restoredProject.itemCount === baselineItemCount;
  } catch (error) {
    failureError = error instanceof Error ? error.message : String(error);
  } finally {
    await cleanupImportedMedia();

    let cleanupComplete = cleanupErrors.length === 0;
    if (client !== null) {
      try {
        const finalProject = await client.inspectProject();
        const mediaGone = !finalProject.items.some((item) => item.stableId === mediaStableId);
        checks.final_media_absent = mediaGone;
        checks.final_item_count_restored = baselineItemCount === null || finalProject.itemCount === baselineItemCount;
        cleanupComplete = cleanupComplete && mediaGone && checks.final_item_count_restored === true;
      } catch (error) {
        cleanupErrors.push(`final inspect: ${error instanceof Error ? error.message : String(error)}`);
        cleanupComplete = false;
      }
    }

    const allChecks = Object.values(checks).every((value) => value === true);
    const ok = failureError === null && cleanupComplete && allChecks;
    await writeJson(resultPath, {
      proofId: "M2_REAL_AE_MEDIA_IMPORT",
      status: ok ? "PASS" : "FAILED",
      ok,
      cleanupComplete,
      startedAt,
      completedAt: new Date().toISOString(),
      protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
      sourceArtifact: sourcePath,
      mediaStableId,
      baselineItemCount,
      checks,
      proofLevels: {
        P2_structural_media_import: checks.media_import_structural_readback === true,
        P4_fixed_undo_cleanup: checks.media_import_undo_removed === true
          && checks.media_import_undo_restored_count === true,
      },
      responses,
      error: failureError,
      cleanupErrors,
      safety: {
        boundedFilesystemRoot: artifactDir,
        projectSavePerformed: false,
        projectOpenReplacePerformed: false,
        cleanupUsesFixedUndoCommand: true,
      },
    });

    if (broker !== null) await broker.stop();
    if (!ok) process.exitCode = 1;
  }
};

await main();
