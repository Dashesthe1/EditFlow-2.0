import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const output = execFileSync(process.execPath, ["scripts/validate-schemas.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

test("all contract fixtures match their expected validity", () => {
  assert.match(output, /Validated 12 contract fixtures successfully\./);
});
