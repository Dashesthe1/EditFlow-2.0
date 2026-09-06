import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const clientPath = "packages/adapters/ae-cep/extension/client/bridge.js";

test("CEP panel liveness and broker re-registration are independent of an in-flight host command", async () => {
  const source = await readFile(clientPath, "utf8");

  assert.match(source, /var connectionGeneration = 0/);
  assert.match(source, /requestJson\("\/v1\/status"/);
  assert.match(source, /scheduleLiveness\(\)/);
  assert.match(source, /scheduleReconnect\(0\)/);
  assert.match(source, /connectionGeneration \+= 1/);
  assert.match(source, /schedulePoll\(generation\)/);
  assert.match(source, /generation !== connectionGeneration/);
  assert.match(source, /postResponse\(response, leasedSessionId\)/);
  assert.match(source, /postTransportFailure\(result\.value, error, leasedSessionId\)/);
});

test("each successful broker registration reloads the current checked-in AE host before polling", async () => {
  const source = await readFile(clientPath, "utf8");

  const bootstrapStart = source.indexOf("function ensureHostDispatcher()");
  const bootstrapEnd = source.indexOf("function register()", bootstrapStart);
  assert.ok(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart);
  const bootstrap = source.slice(bootstrapStart, bootstrapEnd);
  assert.match(bootstrap, /\$\.evalFile\(hostFile\)/);
  assert.doesNotMatch(bootstrap, /if\(typeof \$\.global\.EditFlow2_dispatch===/);

  const connectStart = source.indexOf("function connect()");
  const connectEnd = source.indexOf("function start()", connectStart);
  assert.ok(connectStart >= 0 && connectEnd > connectStart);
  const connect = source.slice(connectStart, connectEnd);
  const registerIndex = connect.indexOf("register()");
  const loadIndex = connect.indexOf("ensureHostDispatcher()", registerIndex);
  const pollIndex = connect.indexOf("schedulePoll(generation)", loadIndex);
  assert.ok(registerIndex >= 0 && loadIndex > registerIndex && pollIndex > loadIndex,
    "broker registration must precede host reload and polling must wait for reload completion");
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
