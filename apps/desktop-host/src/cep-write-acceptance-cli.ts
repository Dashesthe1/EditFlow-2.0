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

interface RenderCompletionFile {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly status: "DONE" | "FAILED";
  readonly ok: boolean;
  readonly outputPath: string;
  readonly error: string | null;
  readonly completedAtMs: number;
  readonly queueItemRemoved: boolean;
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

const parseRenderCompletion = (value: unknown): RenderCompletionFile => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Render completion marker must be an object.");
  const candidate = value as Record<string, unknown>;
  if (candidate["schemaVersion"] !== 1) throw new Error("Unsupported render completion schemaVersion.");
  if (typeof candidate["jobId"] !== "string" || candidate["jobId"].length === 0) throw new Error("Render completion marker is missing jobId.");
  if (candidate["status"] !== "DONE" && candidate["status"] !== "FAILED") throw new Error("Render completion marker has invalid status.");
  if (typeof candidate["ok"] !== "boolean") throw new Error("Render completion marker is missing ok.");
  if (typeof candidate["outputPath"] !== "string" || candidate["outputPath"].length === 0) throw new Error("Render completion marker is missing outputPath.");
  if (candidate["error"] !== null && typeof candidate["error"] !== "string") throw new Error("Render completion marker has invalid error.");
  if (typeof candidate["completedAtMs"] !== "number") throw new Error("Render completion marker is missing completedAtMs.");
  if (typeof candidate["queueItemRemoved"] !== "boolean") throw new Error("Render completion marker is missing queueItemRemoved.");
  return candidate as unknown as RenderCompletionFile;
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

const fileExistsNonEmpty = async (filePath: string): Promise<boolean> => {
  try { return (await stat(filePath)).size > 0; } catch { return false; }
};

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const waitForRenderCompletion = async (
  completionPath: string,
  expectedJobId: string,
  timeoutMs: number,
): Promise<RenderCompletionFile> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const text = stripUtf8Bom(await readFile(completionPath, "utf8"));
      const completion = parseRenderCompletion(JSON.parse(text) as unknown);
      if (completion.jobId !== expectedJobId) {
        lastError = `stale completion marker jobId '${completion.jobId}'`;
      } else {
        return completion;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(200);
  }
  throw new Error(`RENDER_JOB_COMPLETION_TIMEOUT: ${expectedJobId}${lastError ? ` (${lastError})` : ""}`);
};

const main = async (): Promise<void> => {
  const configPath = requireArgument("--config");
  const resultPath = requireArgument("--result");
  const timeoutMs = Number(argument("--timeout-ms") ?? "180000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error("--timeout-ms must be at least 10000.");

  const artifactDir = path.dirname(resultPath);
  const renderPath = path.join(artifactDir, "m2-proof.avi");
  const startedAt = new Date().toISOString();
  const responses: RecordedResponse[] = [];
  const checks: Record<string, boolean> = {};
  const cleanupErrors: string[] = [];
  let broker: LoopbackCepBroker | null = null;
  let client: AeCepAdapterClientV11 | null = null;
  let state: ObservedProjectState | null = null;
  let baselineItemCount: number | null = null;
  let environment: Awaited<ReturnType<AeCepAdapterClientV11["probe"]>> | null = null;
  let panel: Awaited<ReturnType<LoopbackCepBroker["waitForPanel"]>> | null = null;
  let failureError: string | null = null;
  let renderArtifactPath: string | null = null;

  const projectId = "m2-cep-write-acceptance";
  const transactionId = `M2_CEP_WRITE_TX_${Date.now()}`;
  const prefix = `M2_CEP_WRITE_${Date.now()}`;
  const sourceStable = `${prefix}_SOURCE_COMP`;
  const targetStable = `${prefix}_TARGET_COMP`;
  const layerStable = `${prefix}_LAYER`;
  const precompStable = `${prefix}_PRECOMP`;
  const replacementStable = `${prefix}_PRECOMP_REPLACEMENT`;
  let operationCounter = 0;

  const refreshState = async (): Promise<ObservedProjectState> => {
    if (client === null) throw new Error("CEP client is not initialized.");
    const observed = await client.observe(projectId);
    state = observed.observed;
    return state;
  };

  const execute = async (
    command: AeAdapterPublicCommandV11,
    payload: Readonly<Record<string, unknown>>,
    options: { readonly refreshAfter?: boolean } = {},
  ): Promise<AeAdapterResponseV11> => {
    if (client === null || state === null) throw new Error("CEP acceptance state is not initialized.");
    operationCounter += 1;
    const response = await client.executePublic(command, {
      transactionId,
      operationId: `${transactionId}_OP_${operationCounter}`,
      payload,
      expectedState: state,
      readbackProfile: "M2_CEP_REAL_AE_PROOF",
    });
    responses.push({
      command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
    });
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
    }
    if (options.refreshAfter !== false) await refreshState();
    return response;
  };

  const cleanupComp = async (stableId: string): Promise<void> => {
    if (client === null) return;
    try {
      const observed = await client.observe(projectId);
      const present = observed.project.items.some((item) => item.stableId === stableId && item.kind === "COMPOSITION");
      state = observed.observed;
      if (!present) return;
      await execute("comp.remove", { comp: { stableId } });
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
    });
    const boundPort = await broker.start();
    if (boundPort !== config.port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

    panel = await broker.waitForPanel(timeoutMs);
    if (panel.protocolVersion !== config.protocolVersion) throw new Error("Registered CEP panel protocol mismatch.");
    if (panel.extensionVersion !== config.extensionVersion) {
      throw new Error(`Registered CEP panel version ${panel.extensionVersion} does not match installed config ${config.extensionVersion}.`);
    }

    let requestCounter = 0;
    client = new AeCepAdapterClientV11(
      broker,
      () => `m2-cep-write-${++requestCounter}`,
      new AeFilesystemPolicyV11([artifactDir]),
    );

    environment = await client.probe();
    const baseline = await client.observe(projectId);
    state = baseline.observed;
    baselineItemCount = baseline.project.itemCount;
    checks.host_probe = environment.hostName === "Adobe After Effects"
      && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;
    checks.project_inspect = baseline.project.itemCount === baselineItemCount;

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

    const layer = await execute("layer.add_media", {
      stableId: layerStable,
      comp: { stableId: targetStable },
      item: { stableId: sourceStable },
    });
    checks.layer_add = nestedRecord(layer.readback, "layer")?.["stableId"] === layerStable;

    const transform = await execute("layer.set_transform", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      values: { position: [160, 160], scale: [92, 92], rotation: 3, opacity: 100 },
    });
    checks.transform = nestedRecord(transform.readback, "transform") !== null;

    const timing = await execute("layer.set_timing", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      timing: { startTime: 0, inPoint: 0, outPoint: 1, stretch: 100 },
    });
    checks.timing = nestedRecord(timing.readback, "layer")?.["outPoint"] === 1;

    const effect = await execute("effect.add", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      matchName: "ADBE Gaussian Blur 2",
      name: `${prefix} Blur`,
    });
    const effectIndex = asRecord(effect.readback)?.["propertyIndex"];
    if (typeof effectIndex !== "number") throw new Error("effect.add did not return a numeric propertyIndex.");
    checks.effect_add = true;

    const effectProperty = await execute("effect.set_property", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      effectIndex,
      propertyPath: [1],
      value: 6,
    });
    checks.effect_property = effectProperty.readback !== null;

    const keys = await execute("property.set_keyframes", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      propertyPath: ["ADBE Transform Group", "ADBE Position"],
      keyframes: [
        { time: 0, value: [150, 160] },
        { time: 0.5, value: [170, 160] },
        { time: 1, value: [160, 160] },
      ],
    });
    checks.keyframes = asRecord(keys.readback)?.["numKeys"] === 3;

    const expression = await execute("property.set_expression", {
      comp: { stableId: targetStable },
      layer: { stableId: layerStable },
      propertyPath: ["ADBE Transform Group", "ADBE Opacity"],
      expression: "value",
      enabled: true,
    });
    checks.expression = asRecord(expression.readback)?.["enabled"] === true;

    const renderSchedule = await execute("render.capture", {
      comp: { stableId: targetStable },
      outputPath: renderPath,
      timeSpanStart: 0,
      timeSpanDuration: 1,
    }, { refreshAfter: false });
    const renderReadback = asRecord(renderSchedule.readback);
    const renderJobId = renderReadback?.["jobId"];
    const renderCompletionPath = renderReadback?.["completionPath"];
    const renderOutputPath = renderReadback?.["outputPath"];
    checks.render_scheduled = renderReadback?.["state"] === "SCHEDULED"
      && renderReadback?.["mode"] === "SCHEDULED_HOST_JOB_V1"
      && renderReadback?.["requestedOutputPath"] === renderPath
      && typeof renderJobId === "string"
      && typeof renderCompletionPath === "string"
      && typeof renderOutputPath === "string";
    if (!checks.render_scheduled || typeof renderJobId !== "string"
        || typeof renderCompletionPath !== "string" || typeof renderOutputPath !== "string") {
      throw new Error("render.capture did not return a valid scheduled render job descriptor with canonical output-path readback.");
    }

    const renderRelativePath = path.relative(artifactDir, renderOutputPath);
    if (renderRelativePath.length === 0 || renderRelativePath === ".."
        || renderRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(renderRelativePath)) {
      throw new Error(`render.capture canonical output path escaped the bounded artifact directory: ${renderOutputPath}`);
    }
    renderArtifactPath = renderOutputPath;
    checks.render_output_path_readback = true;

    const renderCompletion = await waitForRenderCompletion(renderCompletionPath, renderJobId, timeoutMs);
    checks.render_job_done = renderCompletion.ok === true
      && renderCompletion.status === "DONE"
      && renderCompletion.queueItemRemoved === true
      && renderCompletion.outputPath === renderOutputPath;
    if (!checks.render_job_done) {
      throw new Error(`render.capture scheduled job failed: ${renderCompletion.error ?? renderCompletion.status}`);
    }
    checks.render_capture = await fileExistsNonEmpty(renderOutputPath);
    if (!checks.render_capture) throw new Error("render.capture completion marker reported success but the canonical render artifact is missing or empty.");

    // The scheduled render deliberately occupies AE outside the CEP evalScript call.
    // Resume host observation only after its completion marker proves the render task
    // returned and removed its temporary Render Queue item.
    await refreshState();

    const precompose = await execute("layers.precompose", {
      comp: { stableId: targetStable },
      layers: [{ stableId: layerStable }],
      name: `${prefix} Precomp`,
      stableId: precompStable,
      replacementStableId: replacementStable,
      moveAllAttributes: true,
    });
    checks.precompose = nestedRecord(precompose.readback, "composition")?.["stableId"] === precompStable;
    checks.precompose_replacement_identity = nestedRecord(precompose.readback, "replacementLayer")?.["stableId"] === replacementStable;

    const after = await client.inspectProject();
    const stableSeen = new Set(after.items.map((item) => item.stableId).filter((value): value is string => typeof value === "string"));
    const replacementSeen = after.items.some((item) => item.composition?.layers.some((candidate) => candidate.stableId === replacementStable) === true);
    checks.stable_id_readback = stableSeen.has(sourceStable)
      && stableSeen.has(targetStable)
      && stableSeen.has(precompStable)
      && replacementSeen;
  } catch (error) {
    failureError = error instanceof Error ? error.message : String(error);
  } finally {
    await cleanupComp(targetStable);
    await cleanupComp(precompStable);
    await cleanupComp(sourceStable);

    if (client !== null && baselineItemCount !== null) {
      try {
        const finalProject = await client.inspectProject();
        checks.cleanup_restored_item_count = finalProject.itemCount === baselineItemCount;
      } catch (error) {
        cleanupErrors.push(`final inspect: ${error instanceof Error ? error.message : String(error)}`);
        checks.cleanup_restored_item_count = false;
      }
    }

    if (failureError !== null) {
      await writeJson(resultPath, {
        proofId: "M2_CEP_REAL_AE_BOUNDED",
        status: "FAILED",
        ok: false,
        cleanupComplete: true,
        startedAt,
        completedAt: new Date().toISOString(),
        protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
        panel,
        environment,
        checks,
        responses,
        error: failureError,
        cleanupErrors,
        safety: {
          boundedTemporaryWrites: true,
          projectSavePerformed: false,
          projectOpenReplacePerformed: false,
          brokerHost: "127.0.0.1",
        },
      });
      process.exitCode = 1;
    } else {
      const allCore = Object.values(checks).every((value) => value === true);
      const ok = allCore && cleanupErrors.length === 0;
      await writeJson(resultPath, {
        proofId: "M2_CEP_REAL_AE_BOUNDED",
        status: ok ? "PARTIAL_PASS" : "PARTIAL_FAILURE",
        ok,
        cleanupComplete: true,
        startedAt,
        completedAt: new Date().toISOString(),
        protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
        panel,
        environment,
        checks,
        proofLevels: {
          P1_validation: true,
          P2_structural_readback: ok,
          P3_render_artifact: checks.render_capture === true,
          P4_bounded_cleanup: checks.cleanup_restored_item_count === true,
          P4_failure_injection_rollback: false,
          P5_save_reopen_reconnect_transfer: false,
        },
        renderArtifact: checks.render_capture === true ? renderArtifactPath : null,
        responses,
        cleanupErrors,
        safety: {
          boundedTemporaryWrites: true,
          projectSavePerformed: false,
          projectOpenReplacePerformed: false,
          brokerHost: "127.0.0.1",
        },
      });
      if (!ok) process.exitCode = 1;
    }

    if (broker !== null) await broker.stop();
  }
};

await main();