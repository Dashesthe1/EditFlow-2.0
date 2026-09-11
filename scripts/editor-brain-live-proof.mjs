import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { createDesktopAeSessionV11, DEFAULT_AE_EXECUTION_MODE } from "../.tmp/runtime/apps/desktop-host/src/v1_1.js";
import { compileEditorStyleProfileV0 } from "../.tmp/runtime/packages/editor-brain/src/index.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const required = (name) => {
  const value = arg(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const configPath = required("--config");
const resultPath = required("--result");
const budgetMs = Number(arg("--budget-ms") ?? "2000");
const config = JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
await mkdir(path.dirname(resultPath), { recursive: true });
const broker = new LoopbackCepBroker({
  port: config.port,
  token: config.token,
  commandTimeoutMs: 5000,
  commandLeaseMs: 1000,  expectedExtensionId: config.extensionId,
  supportedProtocolVersions: config.supportedProtocolVersions,
});
const result = { ok: false, budgetMs, checks: {}, timings: {}, error: null };
try {
  await broker.start();
  const panel = await broker.waitForPanel(30000);
  result.panel = { protocolVersion: panel.protocolVersion, extensionVersion: panel.extensionVersion };
  let requestCounter = 0;
  const client = new AeCepAdapterClientV11(
    broker,
    () => `default-live-${++requestCounter}`,
    new AeFilesystemPolicyV11([path.dirname(resultPath)]),
  );
  const session = await createDesktopAeSessionV11(client, "default-continuous-runner-live-proof");
  const activeHostId = session.state.project.activeItemHostId;
  const activeItem = session.state.project.items.find((item) => item.hostId === activeHostId && item.kind === "COMPOSITION");
  const layer = activeItem?.composition?.layers.find((candidate) => !candidate.locked && candidate.hostId !== null);
  if (!activeItem?.composition || !layer || layer.hostId === null) throw new Error("No active unlocked AE layer is available for reflex proof.");
  const baseline = structuredClone(layer.transform);
  const style = compileEditorStyleProfileV0("STYLE_LIVE_PROOF", "Learned Pro Edit Proof", [
    { evidenceId: "REF_LIVE_01", kind: "REFERENCE", technique: "IMPACT_PULSE", confidence: 0.98, frequency: 0.9, meanIntensity: 0.78 },
    { evidenceId: "TUT_LIVE_01", kind: "TUTORIAL", technique: "IMPACT_PULSE", confidence: 0.96, frequency: 0.84, meanIntensity: 0.74 },
    { evidenceId: "REF_LIVE_HOLD", kind: "REFERENCE", technique: "HOLD", confidence: 0.9, frequency: 0.15 },
  ]);
  const highLevelIntentStarted = performance.now();
  const run = await session.editorRunner.run({
    comp: { hostId: activeItem.hostId },
    layer: { hostId: layer.hostId },
    style,
    desiredEnergy: 0.92,
    readability: 0.9,
    dialogueImportance: 0.05,
    transitionPressure: 0.85,
    motionMagnitude: 0.8,
    motionDirection: "RIGHT",
    beatStrength: "STRONG",
    beatEtaMs: 70,
    shotAgeMs: 720,
    subjectX: 0.5,
    subjectY: 0.5,
  }, "EDITOR_BRAIN_LIVE");
  const highLevelIntentToCompletionMs = performance.now() - highLevelIntentStarted;
  result.executionMode = session.executionMode;
  result.decision = {
    technique: run.decision.technique,
    confidence: Number(run.decision.confidence.toFixed(4)),
    rationaleCodes: run.decision.rationaleCodes,
    evidenceIds: run.decision.evidenceIds,
  };
  result.timings.highLevelIntentToCompletionMs = Number(highLevelIntentToCompletionMs.toFixed(3));
  result.timings.editorDecisionMs = Number(run.decisionMs.toFixed(3));
  result.timings.executionMs = Number(run.executionMs.toFixed(3));
  result.timings.runnerPlanningMs = Number((run.reflexResult?.planningMs ?? 0).toFixed(3));
  result.timings.runnerActionMs = Number((run.reflexResult?.actionMs ?? 0).toFixed(3));
  result.timings.perActionMs = (run.reflexResult?.actions ?? []).map((action) => Number(action.timings.totalMs.toFixed(3)));
  result.checks.defaultRunnerSelected = session.executionMode === DEFAULT_AE_EXECUTION_MODE;
  result.checks.editorBrainSelectedImpact = run.decision.technique === "IMPACT_PULSE";
  result.checks.learnedEvidenceBound = run.decision.evidenceIds.includes("REF_LIVE_01") && run.decision.evidenceIds.includes("TUT_LIVE_01");
  result.checks.localRoute = run.route === "LOCAL";
  result.checks.threeMicroActionsCompleted = run.reflexResult?.completedActions === 3;
  result.checks.intentWithinBudget = highLevelIntentToCompletionMs <= budgetMs && run.reflexResult?.withinBudget === true;
  result.checks.noEscalation = run.decision.escalationReason === null && run.reflexResult?.escalationReason === null;

  const after = await client.observe("editor-brain-live-proof");
  const finalItem = after.project.items.find((item) => item.hostId === activeItem.hostId);
  const finalLayer = finalItem?.composition?.layers.find((candidate) => candidate.hostId === layer.hostId);
  result.checks.recoveredToBaseline = JSON.stringify(finalLayer?.transform ?? null) === JSON.stringify(baseline);
  result.checks.liveAeRevisionAdvanced = after.hostRevision >= (run.reflexResult?.hostRevision ?? 0);
  result.ok = Object.values(result.checks).every(Boolean);
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  await broker.stop().catch(() => {});
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 2;
