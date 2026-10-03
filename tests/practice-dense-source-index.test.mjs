import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  LocalPracticeMediaMatcherV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";

test("Practice source indexing defaults to 250 ms coverage", () => {
  const matcher = new LocalPracticeMediaMatcherV1({ shotSelectionAuthority: "ISOLATED_LEGACY_TEST",
    artifactDir: path.resolve(".tmp", "practice-dense-source-index"),
    scriptPath: path.resolve("scripts", "practice", "practice-media-match.py"),
  });
  assert.equal(matcher.config.sampleStepMs, 250);
  assert.equal(matcher.config.materializeWorkingMedia, false);
  assert.equal(matcher.config.workingMediaHandleMs, 2500);
  assert.equal(matcher.config.workingMediaMergeGapMs, 1000);
});
