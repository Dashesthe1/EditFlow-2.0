import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("CEP broker keeps ordinary command timeout short but gives synchronous render.capture a bounded render window", async () => {
  const source = await readFile("apps/desktop-host/src/loopback-cep.ts", "utf8");

  assert.match(source, /RENDER_CAPTURE_TIMEOUT_FLOOR_MS\s*=\s*180_000/);
  assert.match(source, /request\.command === "render\.capture"/);
  assert.match(source, /Math\.max\(this\.options\.commandTimeoutMs, RENDER_CAPTURE_TIMEOUT_FLOOR_MS\)/);
  assert.match(source, /:\s*this\.options\.commandTimeoutMs/);
  assert.match(source, /setTimeout\([\s\S]*commandTimeoutMs\)/);
});
