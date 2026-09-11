import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { RoutineDecisionEngine } from "../.tmp/runtime/packages/routine-decision-engine/src/index.js";
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
const budgetMs = Number(arg("--budget-ms") ?? "1000");
const config = JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
await mkdir(path.dirname(resultPath), { recursive: true });
const broker = new LoopbackCepBroker({
  port: config.port,
  token: config.token,
  commandTimeoutMs: 5000,
  commandLeaseMs: 1000,
  expectedExtensionId: config.extensionId,
  supportedProtocolVersions: config.supportedProtocolVersions,
});
const result = { ok: false, budgetMs, timings: {}, checks: {}, error: null };
let client = null;
let createdStableId = null;
try {
  await broker.start();
  const panel = await broker.waitForPanel(30000);
  result.panel = { protocolVersion: panel.protocolVersion, extensionVersion: panel.extensionVersion };
  let requestCounter = 0;
  client = new AeCepAdapterClientV11(
    broker,
    () => `routine-live-${++requestCounter}`,
    new AeFilesystemPolicyV11([path.dirname(resultPath)]),
  );
  const projectId = "routine-fast-loop-subsecond-proof";
  const baseline = await client.observe(projectId);
  const engine = new RoutineDecisionEngine(client, baseline, { budgetMs, leaseTtlMs: 30_000 });
  const transactionId = `ROUTINE_FAST_${Date.now()}`;
  createdStableId = `${transactionId}_COMP`;

  const sequenceStarted = performance.now();
  const create = await engine.execute({
    kind: "CREATE_COMP",
    stableId: createdStableId,
    name: "EditFlow Routine Fast Path Proof",
    width: 320,
    height: 320,
    pixelAspect: 1,
    duration: 1,
    frameRate: 24,
  }, transactionId);
  const update = await engine.execute({
    kind: "UPDATE_COMP_SETTINGS",
    comp: { stableId: createdStableId },
    settings: { width: 321 },
  }, transactionId);
  const sequenceMs = performance.now() - sequenceStarted;

  result.timings.createIntentToAeResponseMs = Number(create.timings.totalMs.toFixed(3));
  result.timings.createLocalDecisionMs = Number(create.timings.decisionMs.toFixed(3));
  result.timings.updateIntentToAeResponseMs = Number(update.timings.totalMs.toFixed(3));
  result.timings.updateLocalDecisionMs = Number(update.timings.decisionMs.toFixed(3));
  result.timings.twoDecisionSequenceMs = Number(sequenceMs.toFixed(3));
  result.checks.createLocal = create.route === "LOCAL" && create.response?.outcome === "APPLIED";
  result.checks.updateLocal = update.route === "LOCAL" && update.response?.outcome === "APPLIED";
  result.checks.createWithinOneSecond = create.withinBudget;
  result.checks.updateWithinOneSecond = update.withinBudget;
  result.checks.twoDecisionSequenceWithinOneSecond = sequenceMs <= budgetMs;
  result.checks.leaseAdvancedWithoutRefresh = create.hostRevision + 1 === update.hostRevision;

  const after = await client.observe(projectId);
  const created = after.project.items.find((item) => item.stableId === createdStableId);
  result.checks.visibleInProject = created?.kind === "COMPOSITION";
  result.checks.secondDecisionVisible = created?.composition?.width === 321;

  const cleanupStarted = performance.now();
  const cleanup = await client.executePublic("comp.remove", {
    transactionId,
    operationId: `${transactionId}_CLEANUP`,
    payload: { comp: { stableId: createdStableId } },
    expectedState: after.observed,
    readbackProfile: "ROUTINE_FASTPATH_V1",
  });
  result.timings.cleanupMs = Number((performance.now() - cleanupStarted).toFixed(3));
  result.checks.cleanupApplied = cleanup.outcome === "APPLIED";
  const finalState = await client.observe(projectId);
  result.checks.cleanupVerified = !finalState.project.items.some((item) => item.stableId === createdStableId);
  result.ok = Object.values(result.checks).every(Boolean);
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  await broker.stop().catch(() => {});
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 2;
