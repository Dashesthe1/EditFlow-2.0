import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("default live proof measures editor-brain decision through the continuous AE runner", async () => {
  const proof = await read("scripts/editor-brain-live-proof.mjs");
  assert.match(proof, /createDesktopAeSessionV11/);
  assert.match(proof, /DEFAULT_AE_EXECUTION_MODE/);
  assert.match(proof, /session\.editorRunner\.run/);
  assert.match(proof, /compileEditorStyleProfileV0/);
  assert.match(proof, /editorBrainSelectedImpact/);
  assert.match(proof, /learnedEvidenceBound/);
  assert.match(proof, /editorDecisionMs/);
  assert.match(proof, /threeMicroActionsCompleted/);
  assert.match(proof, /highLevelIntentToCompletionMs/);
  assert.match(proof, /intentWithinBudget/);
  assert.match(proof, /recoveredToBaseline/);
});
