import test from "node:test";
import assert from "node:assert/strict";
import { EDITFLOW_DEFAULT_EXECUTION_RUNNER, getMcpServerStatus } from "../.tmp/runtime/apps/mcp-server/src/index.js";

test("runtime status declares the continuous reflex loop as the canonical default execution runner", () => {
  const status = getMcpServerStatus();
  assert.equal(EDITFLOW_DEFAULT_EXECUTION_RUNNER, "REFLEX_CONTINUOUS_FAST_LOOP_V1");
  assert.equal(status.defaultExecutionRunner, EDITFLOW_DEFAULT_EXECUTION_RUNNER);
  assert.equal(status.ordinaryIntentBudgetMs, 2000);
  assert.equal(status.routineMicroActionBudgetMs, 1000);
  assert.equal(status.slowReasoningPolicy, "ESCALATION_ONLY_FOR_AMBIGUOUS_NOVEL_OR_UNSAFE");
});
