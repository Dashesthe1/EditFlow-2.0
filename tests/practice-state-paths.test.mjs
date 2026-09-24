import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  defaultPracticeStateDirectoryV1,
  resolvePracticeStatePathsV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-state-paths.js";

const restoreEnv = (name, value) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

test("Practice defaults to one worktree-independent persistent state root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-practice-state-"));
  const oldLocal = process.env.LOCALAPPDATA;
  const oldConfigured = process.env.EDITFLOW_PRACTICE_STATE_DIR;
  try {
    process.env.LOCALAPPDATA = root;
    delete process.env.EDITFLOW_PRACTICE_STATE_DIR;
    const expected = path.resolve(root, "EditFlow2", "practice-state");
    assert.equal(defaultPracticeStateDirectoryV1(), expected);
    assert.deepEqual(resolvePracticeStatePathsV1(null), {      stateDir: expected,
      learningMemoryFilePath: path.join(expected, "practice-learning-memory.json"),
      editTypeRegistryFilePath: path.join(expected, "edit-types.json"),
    });
  } finally {
    restoreEnv("LOCALAPPDATA", oldLocal);
    restoreEnv("EDITFLOW_PRACTICE_STATE_DIR", oldConfigured);
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit state override isolates a proof run without changing the canonical root", () => {
  const explicit = path.resolve("tmp", "isolated-practice-state");
  const resolved = resolvePracticeStatePathsV1(explicit);
  assert.equal(resolved.stateDir, explicit);
  assert.equal(
    resolved.learningMemoryFilePath,
    path.join(explicit, "practice-learning-memory.json"),
  );
  assert.equal(
    resolved.editTypeRegistryFilePath,
    path.join(explicit, "edit-types.json"),
  );
});
