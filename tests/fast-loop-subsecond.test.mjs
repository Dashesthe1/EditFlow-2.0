import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("CEP bridge uses a sub-frame active polling cadence", async () => {
  const bridge = await read("packages/adapters/ae-cep/extension/client/bridge.js");
  assert.match(bridge, /var pollDelayMs = 16;/);
  assert.doesNotMatch(bridge, /var pollDelayMs = 125;/);
});

test("real-AE fast-loop proof enforces a one-second decision-to-host gate", async () => {
  const proof = await read("scripts/fast-loop-subsecond-proof.mjs");
  assert.match(proof, /--budget-ms/);
  assert.match(proof, /decisionToAeResponseMs/);
  assert.match(proof, /elapsedMs <= budgetMs/);
  assert.match(proof, /visibleInProject/);
  assert.match(proof, /cleanupVerified/);
});