import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
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
});let cleanupAttempted = false;
let createdStableId = null;
const result = { ok: false, budgetMs, timings: {}, checks: {}, error: null };
try {
  await broker.start();
  const panel = await broker.waitForPanel(5000);
  result.panel = { protocolVersion: panel.protocolVersion, extensionVersion: panel.extensionVersion };
  let requestCounter = 0;
  const client = new AeCepAdapterClientV11(
    broker,
    () => `fast-loop-${++requestCounter}`,
    new AeFilesystemPolicyV11([path.dirname(resultPath)]),
  );
  const projectId = "fast-loop-subsecond-proof";
  const baseline = await client.observe(projectId);
  let state = baseline.observed;
  const transactionId = `FAST_LOOP_${Date.now()}`;
  createdStableId = `${transactionId}_COMP`;
  const started = performance.now();
  const response = await client.executePublic("comp.create", {
    transactionId,
    operationId: `${transactionId}_CREATE`,
    payload: { stableId: createdStableId, name: "EditFlow Fast Loop Proof", width: 320, height: 320, pixelAspect: 1, duration: 1, frameRate: 24 },
    expectedState: state,
    readbackProfile: "FAST_LOOP_SUBSECOND_V1",
  });
  const elapsedMs = performance.now() - started;  result.timings.decisionToAeResponseMs = Number(elapsedMs.toFixed(3));
  result.checks.commandApplied = response.outcome === "APPLIED";
  result.checks.withinOneSecond = elapsedMs <= budgetMs;
  const afterCreate = await client.observe(projectId);
  state = afterCreate.observed;
  result.checks.visibleInProject = afterCreate.project.items.some((item) => item.stableId === createdStableId);

  cleanupAttempted = true;
  const cleanupStarted = performance.now();
  const cleanup = await client.executePublic("comp.remove", {
    transactionId,
    operationId: `${transactionId}_REMOVE`,
    payload: { comp: { stableId: createdStableId } },
    expectedState: state,
    readbackProfile: "FAST_LOOP_SUBSECOND_V1",
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