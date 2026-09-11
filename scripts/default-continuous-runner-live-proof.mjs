import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { createDesktopAeSessionV11, DEFAULT_AE_EXECUTION_MODE } from "../.tmp/runtime/apps/desktop-host/src/v1_1.js";
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
  const highLevelIntentStarted = performance.now();
  const run = await session.runner.run({
    kind: "IMPACT_PULSE",
    comp: { hostId: activeItem.hostId },
    layer: { hostId: layer.hostId },
    intensity: 0.72,
    direction: "RIGHT",
  }, "DEFAULT_REFLEX_LIVE");  const highLevelIntentToCompletionMs = performance.now() - highLevelIntentStarted;
  result.executionMode = session.executionMode;
  result.timings.highLevelIntentToCompletionMs = Number(highLevelIntentToCompletionMs.toFixed(3));
  result.timings.runnerPlanningMs = Number(run.planningMs.toFixed(3));
  result.timings.runnerActionMs = Number(run.actionMs.toFixed(3));
  result.timings.perActionMs = run.actions.map((action) => Number(action.timings.totalMs.toFixed(3)));
  result.checks.defaultRunnerSelected = session.executionMode === DEFAULT_AE_EXECUTION_MODE;
  result.checks.localRoute = run.route === "LOCAL";
  result.checks.threeMicroActionsCompleted = run.completedActions === 3;
  result.checks.intentWithinBudget = highLevelIntentToCompletionMs <= budgetMs && run.withinBudget;
  result.checks.noEscalation = run.escalationReason === null;

  const after = await client.observe("default-continuous-runner-live-proof");
  const finalItem = after.project.items.find((item) => item.hostId === activeItem.hostId);
  const finalLayer = finalItem?.composition?.layers.find((candidate) => candidate.hostId === layer.hostId);
  result.checks.recoveredToBaseline = JSON.stringify(finalLayer?.transform ?? null) === JSON.stringify(baseline);
  result.checks.liveAeRevisionAdvanced = after.hostRevision >= run.hostRevision;
  result.ok = Object.values(result.checks).every(Boolean);
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  await broker.stop().catch(() => {});
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 2;
