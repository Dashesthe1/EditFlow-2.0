import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("default live proof measures one high-level intent through the standard continuous runner", async () => {
  const proof = await read("scripts/default-continuous-runner-live-proof.mjs");
  assert.match(proof, /createDesktopAeSessionV11/);
  assert.match(proof, /DEFAULT_AE_EXECUTION_MODE/);
  assert.match(proof, /kind: "IMPACT_PULSE"/);
  assert.match(proof, /threeMicroActionsCompleted/);
  assert.match(proof, /highLevelIntentToCompletionMs/);
  assert.match(proof, /intentWithinBudget/);
  assert.match(proof, /recoveredToBaseline/);
});
