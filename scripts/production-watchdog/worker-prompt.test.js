'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prompt } = require('./worker-prompt.js');

test('continuations verify actual callable tools before work and use retained MCP production operations', () => {
  for (const mode of ['PRACTICE', 'PRO_CREATION']) {
    const text = prompt({ mode, assignmentId: 'retained:1', sessionId: 'session:1' }, 'ef-worker:90:isolated-test');
    assert.ok(text.indexOf('get_mcp_surface') < text.indexOf('Read get_production_state'));
    assert.match(text, /available_tools_json/);
    assert.match(text, /connectorPreflight.status READY/);
    assert.match(text, /record_production_update with action HEARTBEAT/);
    assert.match(text, /enqueue_production_job\/get_production_jobs\/resolve_production_job/);
    assert.match(text, /Resume existing assignment retained:1 and session session:1/);
    assert.match(text, /do not create or restart the assignment/);
    assert.match(text, /Keep After Effects open/);
    assert.match(text, /ChatGPT alone decides/);
    assert.equal(text.includes('Finished is visual reference only.'), mode === 'PRACTICE');
  }
});

test('host denial is a connector block with no credential concealment or denied-path retry', () => {
  const text = prompt({ mode: 'PRACTICE', assignmentId: 'a', sessionId: 's' }, 'ef-worker:90:isolated-test');
  assert.match(text, /BLOCKED_CONNECTOR with the exact action and rejection reason/);
  assert.match(text, /never retry a host-denied request through it/);
  assert.match(text, /Do not repeatedly retry, hide credentials, switch to scripts, disable authentication, change app permissions/);
  assert.equal(text.split('ef-worker:90:isolated-test').length - 1, 1);
  assert.match(text, /A STALE_WORKER response means stop immediately/);
});

test('transport recovery retries reads only and completes missing domain material without bypasses', () => {
  const text = prompt({ mode: 'PRACTICE', assignmentId: 'retained', sessionId: 's' }, 'ef-worker:95:isolated-test');
  assert.match(text, /retry only that read after 2, 5 and 15 seconds/);
  assert.match(text, /repair-transport.ps1/);
  assert.match(text, /-AssignmentId "retained"/);
  assert.match(text, /Do not retry a timed-out write/);
  assert.match(text, /complete the missing scans\/tutorial research\/issued proof or fields/);
  assert.match(text, /must not claim, submit\/replay AE work, alter production\/supervision/);
  assert.match(text, /A STALE_WORKER response means stop immediately/);
});
