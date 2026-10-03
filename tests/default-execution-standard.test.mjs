import test from "node:test";
import assert from "node:assert/strict";
import { EDITFLOW_DEFAULT_EXECUTION_RUNNER, getMcpServerStatus } from "../.tmp/runtime/apps/mcp-server/src/index.js";

test("runtime status declares the durable production queue as the canonical execution path", () => {
  const status = getMcpServerStatus();
  assert.equal(EDITFLOW_DEFAULT_EXECUTION_RUNNER, "DURABLE_PRODUCTION_QUEUE_V1");
  assert.equal(status.defaultExecutionRunner, EDITFLOW_DEFAULT_EXECUTION_RUNNER);
  assert.equal(status.editorBrain, "CHATGPT_DIRECT");
  assert.equal(status.editorBrainDecisionBudgetMs, 0);
  assert.equal(status.editorBrainKnowledgeMode, "GPT_RETAINED_PRESET_EXAMPLES");
  assert.equal(status.editorBrainFailureMode, "REQUIRE_CHATGPT_DECISION");
  assert.equal(status.ordinaryIntentBudgetMs, 2000);
  assert.equal(status.routineMicroActionBudgetMs, 1000);
  assert.equal(status.slowReasoningPolicy, "CHATGPT_FOR_ALL_EDITORIAL_DECISIONS");
});
