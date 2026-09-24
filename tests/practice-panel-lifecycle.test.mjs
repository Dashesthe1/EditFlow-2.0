import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePracticeRunRoleV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js";

test("Practice AUTO lifecycle learns before transfer verification", () => {
  assert.equal(resolvePracticeRunRoleV1(null, false), "LEARNING");
});

test("Practice AUTO lifecycle certifies after transfer verification", () => {
  assert.equal(
    resolvePracticeRunRoleV1(null, true),
    "HELD_OUT_CERTIFICATION",
  );
});

test("explicit Practice lifecycle overrides remain deliberate", () => {
  assert.equal(resolvePracticeRunRoleV1("LEARNING", true), "LEARNING");
  assert.equal(
    resolvePracticeRunRoleV1("HELD_OUT_CERTIFICATION", false),
    "HELD_OUT_CERTIFICATION",
  );
});
