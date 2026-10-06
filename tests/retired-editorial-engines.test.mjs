import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AeCepCurrentTransactionalHostV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/current-transactional-host.js";
import { GptOrchestrationStoreV1, validateChatgptEditorialJobV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";

const decision = { authority: "CHATGPT_DIRECT", decisionId: "chosen", rationale: "Reviewed exact values", evidenceRefs: ["pixels:1"], steps: ["Apply explicit keys"] };

test("nested formula directives are refused at admission and host before any AE read or write", async () => {
  for (const field of ["liveCurveIntent", "liveCurveEaseIntent"]) {
    const payload = { comp: { stableId: "comp" }, layer: { stableId: "layer" }, [field]: { kind: "TIME_REMAP_PULSE" } };
    assert.throws(() => validateChatgptEditorialJobV1("AE_TRANSACTION", { editorialDecision: decision,
      plan: { operations: [{ input: { command: "property.set_keyframes", payload } }] } }), /FORMULA_EDITING_RETIRED/);
    let calls = 0;
    const host = new AeCepCurrentTransactionalHostV1({ async dispatch() { calls++; throw Error("AE must not be contacted"); } }, "project");
    await assert.rejects(host.apply({ operationId: "op", input: { command: "property.set_keyframes", payload } }), /FORMULA_EDITING_RETIRED/);
    assert.equal(calls, 0);
  }
  assert.throws(() => validateChatgptEditorialJobV1("AE_BATCH", { editorialDecision: decision,
    intents: [{ payload: { autoCorrect: true } }] }), /AUTOMATIC_EDITORIAL/);
  validateChatgptEditorialJobV1("AE_TRANSACTION", { editorialDecision: decision,
    plan: { operations: [{ input: { payload: { keyframes: [{ time: 0, value: 100 }, { time: 1, value: 130 }], ease: { inEase: [{ speed: 4, influence: 60 }], outEase: [{ speed: 4, influence: 60 }] } } } }] } });
});

test("retired decision engines and generated entry points are physically absent", async () => {
  for (const file of [
    "packages/editor-brain/src/index.ts", "packages/visual-effects-intelligence/src/brain.ts",
    "packages/recipe-compiler/src/index.ts", "packages/tutorial-learning/src/compiler.ts",
    "packages/practice-homework/src/engine.ts", "packages/practice-homework/src/mastery.ts",
    "packages/adapters/ae-cep/src/native-curve-materialization.ts", "packages/tracking-state/src/automatic-repair.ts",
    "scripts/practice/practice-media-match.py", "scripts/practice/practice-resumable-match.py",
    "scripts/practice/practice-candidate-ranker.py", "apps/desktop-host/src/practice-training-runtime.ts",
    "packages/adapters/ae-cep/runtime/editgpt_stabilization_visual_driver.py",
    "scripts/windows/run-practice-held-out-isolation-proof.ps1", "apps/desktop-host/src/practice-live-proof-assertions.ts",
    "scripts/default-continuous-runner-live-proof.mjs", "scripts/routine-fast-loop-subsecond-proof.mjs",
    ".tmp/runtime/packages/editor-brain/src/index.js", ".tmp/runtime/packages/visual-effects-intelligence/src/brain.js",
    ".tmp/runtime/apps/desktop-host/src/practice-training-runtime.js",
    ".tmp/runtime/apps/desktop-host/src/practice-live-proof-assertions.js",
  ]) await assert.rejects(access(file), { code: "ENOENT" }, file);
});

test("old cached briefs are replaced idempotently while preset context and assignment state survive", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "retired-brief-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new GptOrchestrationStoreV1(path.join(dir, "assignments.json"));
  const a = await store.createAssignment({ sessionId: "retained", mode: "PRACTICE", editTypeId: "preset", artifactDir: dir,
    finish: { uri: "finish.mp4", mediaId: "finish", role: "FINISH_REFERENCE", mediaKind: "VIDEO" },
    start: [{ uri: "raw.mp4", mediaId: "raw", role: "START_SOURCE", mediaKind: "VIDEO" }], knowledge: null });
  await store.claim(a.assignmentId, "owner");
  const disk = JSON.parse(await readFile(store.filePath, "utf8"));
  delete disk.assignments[0].primaryWorkflow;
  disk.assignments[0].chatMessage = "Session: retained\nExisting preset successes: [\"Keep the reviewed source range\"]\n- invoke the M6 reference-fidelity engine\n- Run machine-verified certification\n- ACCELERATED_REFERENCE_FIRST_V1\n- Optional workflowContext\n";
  await writeFile(store.filePath, JSON.stringify(disk));
  assert.equal(await store.refreshActiveProductionInstructions(), 1);
  const first = await store.getAssignment(a.assignmentId);
  assert.equal(await store.refreshActiveProductionInstructions(), 0);
  const second = await store.getAssignment(a.assignmentId);
  assert.equal(first.chatMessage, second.chatMessage);
  assert.equal(second.assignmentId, a.assignmentId); assert.equal(second.sessionId, "retained");
  assert.equal(second.controllerLease.owner, "owner"); assert.equal(second.status, "RUNNING");
  assert.equal(second.primaryWorkflow,"CHATGPT_PRODUCTION_WORKFLOW_V1");
  assert.match(second.chatMessage, /Keep the reviewed source range/);
  assert.match(second.chatMessage, /RETIRED_EDIT_ENGINES_REMOVED_V1/);
  assert.doesNotMatch(second.chatMessage, /invoke the M6|Run machine-verified|ACCELERATED_REFERENCE_FIRST_V1|Optional workflowContext/);
});
