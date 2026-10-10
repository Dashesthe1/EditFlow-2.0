import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITFLOW_DEFAULT_EXECUTION_RUNNER, getMcpServerStatus } from '../.tmp/runtime/apps/mcp-server/src/index.js';
test('No default editing runner survives the Practice and Pro Creation reset', () => {
  const status = getMcpServerStatus();
  assert.equal(EDITFLOW_DEFAULT_EXECUTION_RUNNER, null);
  assert.equal(status.defaultExecutionRunner, null);
  assert.equal(status.primaryProductionSystem, null);
  assert.equal(status.adobeWritesEnabled, false);
  assert.equal(status.editorBrain, null);
  assert.deepEqual(status.availableWorkflows, []);
});
