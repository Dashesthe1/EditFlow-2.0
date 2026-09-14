import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_COMPOSITE_PROTOCOL_VERSION_V13 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_3.js";
import { buildCompositeRequestV13 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-composite.js";

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const required = (name) => {
  const value = argument(name);
  if (!value) throw new Error(`Missing required argument ${name}.`);
  return value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const samePath = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const existsNonEmpty = async (filePath) => {
  try { return (await stat(filePath)).size > 0; } catch { return false; }
};
const stripBom = (value) => value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
const writeJson = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const launchAfterFxScript = async (afterFxPath, scriptPath) => {
  await new Promise((resolve, reject) => {
    const child = spawn(afterFxPath, ["-r", scriptPath], { stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
};
const waitJson = async (filePath, proofId, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(stripBom(await readFile(filePath, "utf8")));
      if (parsed?.proofId !== proofId) throw new Error(`unexpected proofId ${String(parsed?.proofId)}`);
      if (typeof parsed.ok !== "boolean") throw new Error("marker missing boolean ok");
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(100);
  }
  throw new Error(`PROOF_MARKER_TIMEOUT: ${proofId}${lastError ? ` (${lastError})` : ""}`);
};
const sessionEvidence = (session) => ({
  sessionId: session.sessionId,
  protocolVersion: session.protocolVersion,
  supportedProtocolVersions: [...session.supportedProtocolVersions],
  extensionId: session.extensionId,
  extensionVersion: session.extensionVersion,
  registeredAt: session.registeredAt,
});
const parseConfig = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Bridge config must be an object.");
  if (value.schemaVersion !== 1 || value.host !== "127.0.0.1") throw new Error("Bridge config identity is invalid.");
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error("Bridge config port is invalid.");
  if (typeof value.token !== "string" || value.token.length < 32) throw new Error("Bridge config token is invalid.");
  if (!Array.isArray(value.supportedProtocolVersions)
      || !value.supportedProtocolVersions.includes(AE_COMPOSITE_PROTOCOL_VERSION_V13)
      || !value.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)) {
    throw new Error("Bridge config does not advertise required 1.3/1.1 protocols.");
  }
  if (typeof value.extensionId !== "string" || typeof value.extensionVersion !== "string") throw new Error("Bridge extension identity is missing.");
  return value;
};
const jsxPath = (value) => path.resolve(value).replaceAll("\\", "/").replaceAll('"', '\\"');
const renderTemplate = async (templatePath, outputPath, replacements) => {
  let text = await readFile(templatePath, "utf8");
  for (const [token, value] of Object.entries(replacements)) {
    if (!text.includes(token)) throw new Error(`Template ${path.basename(templatePath)} is missing ${token}.`);
    text = text.replaceAll(token, jsxPath(value));
  }
  await writeFile(outputPath, text, "utf8");
};
const compositeState = (response) => response?.readback?.composite ?? null;
const compositeMatches = (response, targetStable, matteStable) => {
  const composite = compositeState(response);
  return composite?.layer?.stableId === targetStable
    && composite?.hasTrackMatte === true
    && composite?.trackMatteType === "LUMA"
    && composite?.trackMatteLayer?.stableId === matteStable;
};

const configPath = required("--config");
const resultPath = required("--result");
const afterFxPath = required("--afterfx-path");
const bootstrapScript = required("--bootstrap-script");
const stage1Template = required("--stage1-template");
const reopenTemplate = required("--reopen-template");
const cleanupTemplate = required("--cleanup-template");
const planPath = required("--plan");
const hostLoader = required("--host-loader");
const timeoutMs = Number(argument("--timeout-ms") ?? "90000");
if (!Number.isFinite(timeoutMs) || timeoutMs < 20_000) throw new Error("--timeout-ms must be at least 20000.");

const artifactDir = path.dirname(resultPath);
const lifecycleProjectPath = path.join(artifactDir, "m4-segmentation-sequence-p5-lifecycle.aep");
const retainedProjectPath = path.join(artifactDir, "m4-segmentation-sequence-p5-retained.aep");
const originalDiskBackupPath = path.join(artifactDir, "user-project-pre-proof-disk-backup.aep");
const userSnapshotPath = path.join(artifactDir, "user-project-saved-snapshot.aep");
const stage1ResultPath = path.join(artifactDir, "stage1-result.json");
const reopenResultPath = path.join(artifactDir, "reopen-result.json");
const cleanupResultPath = path.join(artifactDir, "cleanup-result.json");
const stage1ScriptPath = path.join(artifactDir, "stage1.jsx");
const reopenScriptPath = path.join(artifactDir, "reopen.jsx");
const cleanupScriptPath = path.join(artifactDir, "cleanup.jsx");
const baselineFrames = [0, 1, 2].map((index) => path.join(artifactDir, `baseline-${index}.png`));
const preSaveFrames = [0, 1, 2].map((index) => path.join(artifactDir, `pre-save-${index}.png`));
const reopenFrames = [0, 1, 2].map((index) => path.join(artifactDir, `post-reopen-${index}.png`));

const startedAt = new Date().toISOString();
const checks = {};
const responses = [];
const cleanupErrors = [];
let broker = null;
let client = null;
let state = null;
let hostRevision = null;
let operationCounter = 0;
let requestCounter = 0;
let originalProjectPath = null;
let baselineItemCount = null;
let baselineFingerprint = null;
let lifecycleFingerprint = null;
let initialSession = null;
let reconnectedSession = null;
let stage1Result = null;
let reopenResult = null;
let cleanupResult = null;
let failure = null;
let cleanupComplete = false;

const record = (response) => responses.push({
  protocolVersion: response.protocolVersion,
  command: response.command,
  outcome: response.outcome,
  error: response.error,
  hostProjectRevision: response.hostProjectRevision,
  notes: response.diagnostics?.notes ?? [],
});
const createClient = (roots) => new AeCepAdapterClientV11(
  broker,
  () => `m4-sequence-p5-v11-${++requestCounter}`,
  new AeFilesystemPolicyV11(roots),
);
const refreshState = async () => {
  const observed = await client.observe("m4-segmentation-sequence-p5");
  state = observed.observed;
  hostRevision = observed.hostRevision;
  return observed;
};
const executeV11 = async (command, payload, readbackProfile = "M4_SEGMENTATION_SEQUENCE_P5") => {
  operationCounter += 1;
  const response = await client.executePublic(command, {
    transactionId: "M4_SEGMENTATION_SEQUENCE_P5",
    operationId: `M4_SEGMENTATION_SEQUENCE_P5_V11_${operationCounter}`,
    payload,
    expectedState: state,
    readbackProfile,
  });
  record(response);
  if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
    throw new Error(`${command} failed: ${response.error?.code ?? response.outcome} ${response.error?.message ?? ""}`.trim());
  }
  await refreshState();
  return response;
};
const dispatchV13 = async (command, payload, expectedRevision, profile) => {
  operationCounter += 1;
  const request = buildCompositeRequestV13({
    requestId: `m4-sequence-p5-v13-${++requestCounter}`,
    transactionId: "M4_SEGMENTATION_SEQUENCE_P5",
    operationId: `M4_SEGMENTATION_SEQUENCE_P5_V13_${operationCounter}`,
    command,
    expectedHostProjectRevision: expectedRevision,
    payload,
    readbackProfile: profile ?? "M4_SEGMENTATION_SEQUENCE_P5",
  });
  const response = await broker.dispatch(request);
  record(response);
  if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
  return response;
};
const waitForInitialPanel = async () => {
  try { return await broker.waitForPanel(1_500); }
  catch {
    await launchAfterFxScript(afterFxPath, bootstrapScript);
    return await broker.waitForPanel(timeoutMs);
  }
};

try {
  await mkdir(artifactDir, { recursive: true });
  await Promise.all([
    resultPath, lifecycleProjectPath, retainedProjectPath, originalDiskBackupPath, userSnapshotPath,
    stage1ResultPath, reopenResultPath, cleanupResultPath, stage1ScriptPath, reopenScriptPath, cleanupScriptPath,
    ...baselineFrames, ...preSaveFrames, ...reopenFrames,
  ].map((filePath) => rm(filePath, { force: true })));
  for (const requiredPath of [configPath, afterFxPath, bootstrapScript, stage1Template, reopenTemplate, cleanupTemplate, planPath, hostLoader]) {
    checks[`present_${path.basename(requiredPath)}`] = (await stat(requiredPath)).isFile();
  }
  const config = parseConfig(JSON.parse(stripBom(await readFile(configPath, "utf8"))));
  const plan = JSON.parse(stripBom(await readFile(planPath, "utf8")));
  const targetStable = plan?.targetState?.stableId;
  const matteStable = plan?.plan?.matteLayerStableId;
  if (typeof targetStable !== "string" || typeof matteStable !== "string") throw new Error("Lifecycle plan stable IDs are invalid.");

  broker = new LoopbackCepBroker({
    port: config.port,
    token: config.token,
    commandTimeoutMs: Math.min(timeoutMs, 30_000),
    commandLeaseMs: 2_000,
    expectedExtensionId: config.extensionId,
    supportedProtocolVersions: [AE_COMPOSITE_PROTOCOL_VERSION_V13, AE_ADAPTER_PROTOCOL_VERSION_V11],
  });
  const boundPort = await broker.start();
  checks.broker_bound_expected_port = boundPort === config.port;
  if (!checks.broker_bound_expected_port) throw new Error(`CEP broker bound unexpected port ${boundPort}.`);

  const firstPanel = await waitForInitialPanel();
  initialSession = sessionEvidence(firstPanel);
  checks.initial_authenticated_panel = firstPanel.protocolVersion === AE_COMPOSITE_PROTOCOL_VERSION_V13
    && firstPanel.supportedProtocolVersions.includes(AE_COMPOSITE_PROTOCOL_VERSION_V13)
    && firstPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)
    && firstPanel.extensionId === config.extensionId
    && firstPanel.extensionVersion === config.extensionVersion;
  if (!checks.initial_authenticated_panel) throw new Error("Initial authenticated CEP session did not negotiate required 1.3/1.1 protocols.");

  client = createClient([artifactDir]);
  const environment = await client.probe();
  checks.initial_host_probe = environment.hostName === "Adobe After Effects"
    && environment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;
  const baselineObserved = await client.observe("m4-segmentation-sequence-p5");
  originalProjectPath = baselineObserved.project.filePath;
  baselineItemCount = baselineObserved.project.itemCount;
  if (typeof originalProjectPath !== "string" || originalProjectPath.length === 0) throw new Error("P5 requires the current user project to already have a filesystem path.");
  if (!await existsNonEmpty(originalProjectPath)) throw new Error(`Current user project file is missing: ${originalProjectPath}`);

  await copyFile(originalProjectPath, originalDiskBackupPath);
  checks.pre_proof_disk_backup_created = await existsNonEmpty(originalDiskBackupPath);
  client = createClient([artifactDir, path.dirname(originalProjectPath)]);
  state = baselineObserved.observed;
  hostRevision = baselineObserved.hostRevision;
  await executeV11("project.save", { path: originalProjectPath }, "M4_SEGMENTATION_SEQUENCE_P5_USER_SAVE");
  const savedUser = await refreshState();
  baselineFingerprint = savedUser.observed.projectFingerprint;
  baselineItemCount = savedUser.project.itemCount;
  checks.user_project_saved_in_place = savedUser.project.filePath !== null && samePath(savedUser.project.filePath, originalProjectPath);
  await copyFile(originalProjectPath, userSnapshotPath);
  await copyFile(originalProjectPath, lifecycleProjectPath);
  checks.user_snapshot_created = await existsNonEmpty(userSnapshotPath);
  checks.lifecycle_copy_created = await existsNonEmpty(lifecycleProjectPath);

  await renderTemplate(stage1Template, stage1ScriptPath, {
    "__EDITFLOW_PLAN_PATH__": planPath,
    "__EDITFLOW_HOST_LOADER__": hostLoader,
    "__EDITFLOW_HOST_RESULT__": stage1ResultPath,
    "__EDITFLOW_LIFECYCLE_PROJECT_PATH__": lifecycleProjectPath,
    "__EDITFLOW_BASELINE_FRAME_0__": baselineFrames[0],
    "__EDITFLOW_BASELINE_FRAME_1__": baselineFrames[1],
    "__EDITFLOW_BASELINE_FRAME_2__": baselineFrames[2],
    "__EDITFLOW_REVIEW_FRAME_0__": preSaveFrames[0],
    "__EDITFLOW_REVIEW_FRAME_1__": preSaveFrames[1],
    "__EDITFLOW_REVIEW_FRAME_2__": preSaveFrames[2],
  });
  await renderTemplate(reopenTemplate, reopenScriptPath, {
    "__EDITFLOW_LIFECYCLE_PROJECT_PATH__": lifecycleProjectPath,
    "__EDITFLOW_PLAN_PATH__": planPath,
    "__EDITFLOW_HOST_LOADER__": hostLoader,
    "__EDITFLOW_REOPEN_RESULT__": reopenResultPath,
    "__EDITFLOW_REOPEN_FRAME_0__": reopenFrames[0],
    "__EDITFLOW_REOPEN_FRAME_1__": reopenFrames[1],
    "__EDITFLOW_REOPEN_FRAME_2__": reopenFrames[2],
  });
  await renderTemplate(cleanupTemplate, cleanupScriptPath, {
    "__EDITFLOW_ORIGINAL_PROJECT_PATH__": originalProjectPath,
    "__EDITFLOW_LIFECYCLE_PROJECT_PATH__": lifecycleProjectPath,
    "__EDITFLOW_PLAN_PATH__": planPath,
    "__EDITFLOW_CLEANUP_RESULT__": cleanupResultPath,
  });

  await launchAfterFxScript(afterFxPath, stage1ScriptPath);
  stage1Result = await waitJson(stage1ResultPath, "M4_SEGMENTATION_SEQUENCE_P5_STAGE1", timeoutMs);
  checks.stage1_materialization_saved = stage1Result.ok === true && stage1Result.lifecycleSaved === true;
  if (!checks.stage1_materialization_saved) throw new Error(`P5 stage1 failed: ${stage1Result.failure ?? "unknown failure"}`);
  const savedLifecycle = await refreshState();
  lifecycleFingerprint = savedLifecycle.observed.projectFingerprint;
  checks.stage1_project_path = savedLifecycle.project.filePath !== null && samePath(savedLifecycle.project.filePath, lifecycleProjectPath);
  const lifecycleItemCount = savedLifecycle.project.itemCount;

  await launchAfterFxScript(afterFxPath, reopenScriptPath);
  reopenResult = await waitJson(reopenResultPath, "M4_SEGMENTATION_SEQUENCE_P5_REOPEN", timeoutMs);
  checks.direct_reopen_readback_passed = reopenResult.ok === true;
  if (!checks.direct_reopen_readback_passed) throw new Error(`P5 reopen direct readback failed: ${reopenResult.failure ?? "unknown failure"}`);

  const firstSessionId = initialSession.sessionId;
  await broker.stop();
  await sleep(300);
  const reboundPort = await broker.start();
  checks.broker_rebound_same_port = reboundPort === config.port;
  if (!checks.broker_rebound_same_port) throw new Error(`CEP broker rebound unexpected port ${reboundPort}.`);
  const secondPanel = await broker.waitForPanel(timeoutMs);
  reconnectedSession = sessionEvidence(secondPanel);
  checks.authenticated_reconnect = secondPanel.sessionId !== firstSessionId
    && secondPanel.protocolVersion === AE_COMPOSITE_PROTOCOL_VERSION_V13
    && secondPanel.supportedProtocolVersions.includes(AE_COMPOSITE_PROTOCOL_VERSION_V13)
    && secondPanel.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11)
    && secondPanel.extensionId === config.extensionId
    && secondPanel.extensionVersion === config.extensionVersion;
  if (!checks.authenticated_reconnect) throw new Error("P5 did not establish a distinct authenticated CEP session after reopen.");

  client = createClient([artifactDir, path.dirname(originalProjectPath)]);
  const reconnectedEnvironment = await client.probe();
  checks.post_reconnect_host_probe = reconnectedEnvironment.hostName === "Adobe After Effects"
    && reconnectedEnvironment.adapterProtocolVersion === AE_ADAPTER_PROTOCOL_VERSION_V11;
  const reopenedObserved = await refreshState();
  checks.reopened_project_path = reopenedObserved.project.filePath !== null && samePath(reopenedObserved.project.filePath, lifecycleProjectPath);
  checks.reopened_item_count_preserved = reopenedObserved.project.itemCount === lifecycleItemCount;
  checks.reopened_fingerprint_preserved = lifecycleFingerprint !== null
    && reopenedObserved.observed.projectFingerprint === lifecycleFingerprint;

  const readback = await dispatchV13("layer.composite_readback", {
    comp: { stableId: "M4_TRANSFER_SEQUENCE_COMP" },
    layer: { stableId: targetStable },
  }, null, "M4_SEGMENTATION_SEQUENCE_P5_POST_RECONNECT_READ");
  checks.composite_exact_after_reconnect = readback.outcome === "NO_OP" && compositeMatches(readback, targetStable, matteStable);
  if (!checks.composite_exact_after_reconnect) throw new Error("Track-matte state changed across save/reopen/reconnect.");

  await refreshState();
  const clear = await dispatchV13("layer.clear_track_matte", {
    comp: { stableId: "M4_TRANSFER_SEQUENCE_COMP" },
    layer: { stableId: targetStable },
  }, hostRevision, "M4_SEGMENTATION_SEQUENCE_P5_POST_RECONNECT_CLEAR");
  checks.post_reconnect_clear_applied = clear.outcome === "APPLIED" && compositeState(clear)?.hasTrackMatte === false;
  if (!checks.post_reconnect_clear_applied) throw new Error(`Post-reconnect matte clear failed: ${clear.error?.code ?? clear.outcome}`);

  await refreshState();
  const reassign = await dispatchV13("layer.set_track_matte", {
    comp: { stableId: "M4_TRANSFER_SEQUENCE_COMP" },
    layer: { stableId: targetStable },
    matteLayer: { stableId: matteStable },
    trackMatteType: "LUMA",
  }, hostRevision, "M4_SEGMENTATION_SEQUENCE_P5_POST_RECONNECT_REASSIGN");
  checks.post_reconnect_reassign_applied = (reassign.outcome === "APPLIED" || reassign.outcome === "NO_OP")
    && compositeMatches(reassign, targetStable, matteStable);
  if (!checks.post_reconnect_reassign_applied) throw new Error(`Post-reconnect matte reassignment failed: ${reassign.error?.code ?? reassign.outcome}`);

  const finalComposite = await dispatchV13("layer.composite_readback", {
    comp: { stableId: "M4_TRANSFER_SEQUENCE_COMP" },
    layer: { stableId: targetStable },
  }, null, "M4_SEGMENTATION_SEQUENCE_P5_POST_RECONNECT_FINAL_READ");
  checks.post_reconnect_mutation_readback = finalComposite.outcome === "NO_OP" && compositeMatches(finalComposite, targetStable, matteStable);
  if (!checks.post_reconnect_mutation_readback) throw new Error("Fresh post-reconnect matte mutation did not read back exactly.");

  await refreshState();
  await executeV11("project.save", { path: lifecycleProjectPath }, "M4_SEGMENTATION_SEQUENCE_P5_SAVE_AFTER_RECONNECT");
  await rm(reopenResultPath, { force: true });
  for (const frame of reopenFrames) await rm(frame, { force: true });
  await launchAfterFxScript(afterFxPath, reopenScriptPath);
  reopenResult = await waitJson(reopenResultPath, "M4_SEGMENTATION_SEQUENCE_P5_REOPEN", timeoutMs);
  checks.post_reconnect_saved_state_reopens = reopenResult.ok === true;
  if (!checks.post_reconnect_saved_state_reopens) throw new Error(`Post-reconnect saved state failed direct protocol-2.5 verification: ${reopenResult.failure ?? "unknown failure"}`);

  await copyFile(lifecycleProjectPath, retainedProjectPath);
  checks.retained_proof_project_created = await existsNonEmpty(retainedProjectPath);
  await launchAfterFxScript(afterFxPath, cleanupScriptPath);
  cleanupResult = await waitJson(cleanupResultPath, "M4_SEGMENTATION_SEQUENCE_P5_CLEANUP", timeoutMs);
  checks.cleanup_script_passed = cleanupResult.ok === true;
  if (!checks.cleanup_script_passed) throw new Error(`P5 cleanup failed: ${cleanupResult.failure ?? "unknown failure"}`);
  const restored = await refreshState();
  checks.original_project_restored = restored.project.filePath !== null && samePath(restored.project.filePath, originalProjectPath)
    && restored.project.itemCount === baselineItemCount
    && restored.observed.projectFingerprint === baselineFingerprint;
  cleanupComplete = checks.original_project_restored === true;
  if (!cleanupComplete) throw new Error("P5 cleanup did not restore the saved user-project baseline exactly.");
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
} finally {
  if (!cleanupComplete && originalProjectPath && await existsNonEmpty(cleanupScriptPath)) {
    try {
      await rm(cleanupResultPath, { force: true });
      await launchAfterFxScript(afterFxPath, cleanupScriptPath);
      cleanupResult = await waitJson(cleanupResultPath, "M4_SEGMENTATION_SEQUENCE_P5_CLEANUP", Math.min(timeoutMs, 30_000));
      checks.recovery_cleanup_script_passed = cleanupResult.ok === true;
      if (checks.recovery_cleanup_script_passed && broker?.isStarted && client) {
        const restored = await refreshState();
        checks.original_project_restored = restored.project.filePath !== null && samePath(restored.project.filePath, originalProjectPath)
          && restored.project.itemCount === baselineItemCount
          && restored.observed.projectFingerprint === baselineFingerprint;
        cleanupComplete = checks.original_project_restored === true;
      }
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (broker?.isStarted) {
    try { await broker.stop(); } catch (error) { cleanupErrors.push(`broker stop: ${error instanceof Error ? error.message : String(error)}`); }
  }

  const critical = [
    "initial_authenticated_panel",
    "stage1_materialization_saved",
    "direct_reopen_readback_passed",
    "authenticated_reconnect",
    "reopened_fingerprint_preserved",
    "composite_exact_after_reconnect",
    "post_reconnect_clear_applied",
    "post_reconnect_reassign_applied",
    "post_reconnect_mutation_readback",
    "post_reconnect_saved_state_reopens",
    "retained_proof_project_created",
    "original_project_restored",
  ];
  const ok = failure === null && cleanupComplete && critical.every((key) => checks[key] === true);
  await writeJson(resultPath, {
    schemaVersion: 1,
    proofId: "M4_SEGMENTATION_SEQUENCE_P5_SAVE_REOPEN_RECONNECT",
    status: ok ? "ACCEPTED" : "FAILED",
    ok,
    startedAt,
    completedAt: new Date().toISOString(),
    cleanupComplete,
    checks,
    sessions: { initial: initialSession, reconnected: reconnectedSession },
    baseline: { projectPath: originalProjectPath, itemCount: baselineItemCount, fingerprint: baselineFingerprint },
    lifecycle: { projectPath: lifecycleProjectPath, fingerprint: lifecycleFingerprint },
    responses,
    stage1Result,
    reopenResult,
    cleanupResult,
    failure,
    cleanupErrors,
    artifacts: {
      plan: planPath,
      originalDiskBackup: originalDiskBackupPath,
      userSavedSnapshot: userSnapshotPath,
      retainedProofProject: retainedProjectPath,
      lifecycleProject: lifecycleProjectPath,
      stage1Result: stage1ResultPath,
      reopenResult: reopenResultPath,
      cleanupResult: cleanupResultPath,
      baselineFrames,
      preSaveFrames,
      reopenFrames,
    },
  });
  if (!ok) process.exitCode = 1;
}
