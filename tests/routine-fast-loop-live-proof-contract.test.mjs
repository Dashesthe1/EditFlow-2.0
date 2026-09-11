import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("routine live proof separates startup allowance from the one-second action budget", async () => {
  const proof = await read("scripts/routine-fast-loop-subsecond-proof.mjs");
  assert.match(proof, /--budget-ms/);
  assert.match(proof, /broker\.waitForPanel\(30000\)/);
  assert.match(proof, /new RoutineDecisionEngine/);
  assert.match(proof, /kind: "CREATE_COMP"/);
  assert.match(proof, /kind: "UPDATE_COMP_SETTINGS"/);
  assert.match(proof, /twoDecisionSequenceWithinOneSecond/);
  assert.match(proof, /leaseAdvancedWithoutRefresh/);
  assert.match(proof, /secondDecisionVisible/);
  assert.match(proof, /cleanupVerified/);
});
