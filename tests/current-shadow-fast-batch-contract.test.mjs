import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("current Shadow control daemon exposes the persistent local routine batch endpoint", async () => {
  const source = await read("scripts/current-shadow-control-daemon.mjs");
  assert.match(source, /LocalFastRuntimeV1\.create/);
  assert.match(source, /url\.pathname === "\/run-batch"/);
  assert.match(source, /runtime\.runRoutineBatch/);
  assert.match(source, /maxBatchActions: 64/);
  assert.match(source, /actionBudgetMs: 1_000/);
  assert.match(source, /panel: broker\.panelSession \?\? panel/);
  assert.doesNotMatch(source, /\n  panel,\n/);
});

test("current Shadow MCP gateway exposes one-call local AE batching", async () => {
  const source = await read("scripts/current_shadow_gateway_v3.py");
  assert.match(source, /def apply_edit_plan\(/);
  assert.match(source, /isinstance\(parsed, list\)/);
  assert.match(source, /execution_path = "LOCAL_BATCH_RUNTIME"/);
  assert.match(source, /def fast_ae_batch\(/);
  assert.match(source, /"POST", "\/run-batch"/);
  assert.match(source, /LOCAL_BATCH_RUNTIME/);
});

test("MCP status advertises coarse-grained local execution instead of per-action model orchestration", async () => {
  const source = await read("apps/mcp-server/src/index.ts");
  assert.match(source, /PERSISTENT_BATCH_RUNTIME_V1/);
  assert.match(source, /COARSE_GRAINED_BATCHES/);
  assert.match(source, /routineBatchMaxActions: 64/);
});
