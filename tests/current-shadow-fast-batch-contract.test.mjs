import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("daemon delegates every edit to the persistent production worker", async () => {
  const source = await read("scripts/current-shadow-control-daemon.mjs");
  const panel = await read("apps/desktop-host/src/practice-panel-server.ts");
  assert.match(source, /RETIRED_EDIT_EXECUTION_PATHS_V1/);
  assert.doesNotMatch(source, /LocalFastRuntimeV1\.create|runtime\.runRoutineBatch|url\.pathname === "\/run-batch"/);
  assert.match(panel, /runtime\.runRoutineBatch\(body\.intents/);
  assert.match(panel, /maxBatchActions: 64/);
});
test("gateway batching submits durable jobs and never retries an old URL", async () => {
  const source = await read("scripts/current_shadow_gateway_v3.py");
  assert.match(source, /def fast_ae_batch\(/);
  assert.match(source, /_execute_queued\("AE_BATCH"/);
  assert.match(source, /endpoint \+ "\?jobId="/);
  assert.match(source, /DURABLE_PRODUCTION_QUEUE_V1/);
  assert.doesNotMatch(source, /"POST", "\/run(?:-batch)?"|current_routes =|LOCAL_BATCH_RUNTIME/);
});
test("MCP batch capability remains available inside the worker", async () => {
  const source = await read("apps/mcp-server/src/index.ts");
  assert.match(source, /routineBatchMaxActions: 64/);
});
