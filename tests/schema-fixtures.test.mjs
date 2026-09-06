import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("spec/fixtures/manifest.json", "utf8"));
const output = execFileSync(process.execPath, ["scripts/validate-schemas.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

test("all contract fixtures match their expected validity", () => {
  assert.equal(Array.isArray(manifest), true);
  assert.match(output, new RegExp(`Validated ${manifest.length} contract fixtures successfully\\.`));
});
