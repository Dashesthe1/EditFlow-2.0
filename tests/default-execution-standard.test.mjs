import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITFLOW_DEFAULT_EXECUTION_RUNNER, getMcpServerStatus } from '../.tmp/runtime/apps/mcp-server/src/index.js';
test('Only scoped Source Match and raw assembly exists, with no default editing runner', () => {
  const status = getMcpServerStatus();
  assert.equal(EDITFLOW_DEFAULT_EXECUTION_RUNNER, null);
  assert.equal(status.defaultExecutionRunner, null);
  assert.equal(status.primaryProductionSystem, null);
  assert.equal(status.adobeWritesEnabled, 'VERIFIED_RAW_ASSEMBLY_ONLY');
  assert.equal(status.editorBrain, null);
  assert.deepEqual(status.availableWorkflows, ['SOURCE_MATCH_THEN_RAW_ASSEMBLY_V1']);
});
