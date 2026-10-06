'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prompt } = require('./worker-prompt.js');

test('continuations use one-call resume and direct batches in both modes', () => {
  for (const mode of ['PRACTICE', 'PRO_CREATION']) {
    const text = prompt({ mode, assignmentId: 'retained:1', sessionId: 'session:1' }, 'ef-worker:90:isolated-test');
    assert.match(text, /Resume existing assignment retained:1 and session session:1/);
    assert.match(text, /do not create or restart the assignment/);
    assert.match(text, /call claim_gpt_assignment once/);
    assert.doesNotMatch(text, /get_mcp_surface|before every write|Require connectorPreflight/);
    assert.match(text, /workflowContext and READY research plans are optional/);
    assert.match(text, /Research only an unfamiliar or changed component/);
    assert.match(text, /No new SCAN\/SOURCE\/PLAN is required/);
    assert.match(text, /up to 64 exact AE actions/);
    assert.match(text, /Completed previews do not require a separate resolve receipt/);
    assert.match(text, /Keep After Effects open/);
    assert.match(text, /ChatGPT alone decides/);
    assert.equal(text.includes('Finished is visual reference only.'), mode === 'PRACTICE');
  }
});
test('host denials and retired workers remain fenced without a routine approval checklist', () => {
  const text = prompt({mode:'PRACTICE',assignmentId:'a',sessionId:'s'},'ef-worker:90:isolated-test');
  assert.match(text, /never retry a host-denied request through another path/);
  assert.match(text, /A STALE_WORKER response means stop dependent writes/);
  assert.match(text, /No parallel controllers or native-script bypasses/);
  assert.equal(text.split('ef-worker:90:isolated-test').length - 1, 1);
});
test('transport recovery preserves receipts and does not replay uncertain writes', () => {
  const text = prompt({mode:'PRACTICE',assignmentId:'retained',sessionId:'s'},'ef-worker:95:isolated-test');
  assert.match(text, /retry only that read after 2, 5 and 15 seconds/);
  assert.match(text, /repair-transport.ps1/);
  assert.match(text, /-AssignmentId "retained"/);
  assert.match(text, /Do not retry a timed-out write/);
  assert.match(text, /Missing optional research\/workflow records are not a blocker/);
});
