import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const clientPath = "packages/adapters/ae-cep/extension/client/bridge.js";

test("CEP panel liveness and broker re-registration are independent of an in-flight host command", async () => {
  const source = await readFile(clientPath, "utf8");

  assert.match(source, /var connectionGeneration = 0/);
  assert.match(source, /var hostReady = false/);
  assert.match(source, /requestJson\("\/v1\/status"/);
  assert.match(source, /scheduleLiveness\(\)/);
  assert.match(source, /scheduleReconnect\(0\)/);
  assert.match(source, /hostReady\s*\?\s*Promise\.resolve\(\)/);
  assert.match(source, /connectionGeneration \+= 1/);
  assert.match(source, /schedulePoll\(generation\)/);
  assert.match(source, /generation !== connectionGeneration/);
  assert.match(source, /postResponse\(response, leasedSessionId\)/);
  assert.match(source, /postTransportFailure\(result\.value, error, leasedSessionId\)/);
});

test("stale host responses are generation-gated instead of corrupting a newly registered broker session", async () => {
  const source = await readFile(clientPath, "utf8");

  const pollStart = source.indexOf("function pollOnce(generation)");
  const pollEnd = source.indexOf("function scheduleReconnect", pollStart);
  assert.ok(pollStart >= 0 && pollEnd > pollStart);
  const pollSource = source.slice(pollStart, pollEnd);

  assert.match(pollSource, /var leasedSessionId = sessionId/);
  assert.match(pollSource, /if \(generation !== connectionGeneration\) return null/);
  assert.doesNotMatch(pollSource, /postResponse\(response\)\s*;/);
});
