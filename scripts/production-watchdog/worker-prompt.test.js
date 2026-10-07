'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prompt } = require('./worker-prompt.js');
const fs = require('node:fs');
const path = require('node:path');

test('continuations use one-call resume and direct batches in both modes', () => {
  for (const mode of ['PRACTICE', 'PRO_CREATION']) {
    const text = prompt({ mode, assignmentId: 'retained:1', sessionId: 'session:1' }, 'ef-worker:90:isolated-test');
    assert.match(text, /Resume existing assignment retained:1 and session session:1/);
    assert.match(text, /do not create or restart the assignment/);
    assert.match(text, /call claim_gpt_assignment once/);
    assert.doesNotMatch(text, /get_mcp_surface|before every write|Require connectorPreflight/);
    assert.match(text, /workflowContext and READY research plans are optional/);
    assert.match(text, /Research only an unfamiliar or changed component/);
    assert.match(text, /There is no separate tool-inventory\/preflight checklist/);
    assert.match(text, /up to 64 exact AE actions/);
    assert.match(text, /Completed previews do not require a separate resolve receipt/);
    assert.match(text, /Keep After Effects open/);
    assert.match(text, /ChatGPT alone decides/);
    assert.match(text, /Use the connected EditFlow - Current Shadow tools/);
    assert.match(text, /Keep working after research, web browsing, previews and progress reports/);
    assert.match(text, /No periodic research heartbeat is required/);
    assert.match(text, /successful assignment-completion receipt/);
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
  assert.match(text, /local.ready=true does not establish public availability/);
  assert.match(text, /public.ready=true and a successful Current Shadow read before dependent writes/);
  assert.match(text, /Do not treat a transport outage as an editing approval\/workflow gate or completion/);
});
test('historical shot tasks are not injected even when a legacy caller supplies them', () => {
  const task = { mode: 'PRACTICE', assignmentId: 'retained', sessionId: 'session' };
  const legacy = 'Worker 117: finish only shot-10 framing; redo completed typography; require WORKFLOW_PLAN';
  const current = prompt(task, 'ef-worker:118:isolated', legacy);
  assert.doesNotMatch(current, /Worker 117|finish only shot-10|redo completed typography|require WORKFLOW_PLAN/);
  assert.match(current, /Resume from the current actual edit, not an earlier worker's task list/);
  assert.match(current, /Do not repeat completed discovery, construction, research, corrections or review/);
  assert.match(current, /Do not revert later work to an older checkpoint/);
  assert.match(current, /Legacy stage labels and historical handoffs are context, not a current task backlog/);
  assert.match(current, /Reconcile partial\/unknown writes before resolving or replaying/);
  assert.match(current, /A SUCCEEDED job alone is not visual acceptance/);
  assert.match(current, /Reuse a suitable unchanged preview or final render/);
  assert.ok(current.length < 6000, 'Keep the resume contract concise');
});
test('supervisor uses only the goal and worker identity when constructing a continuation', () => {
  const source = fs.readFileSync(path.join(__dirname, 'supervisor.js'), 'utf8');
  assert.doesNotMatch(source, /readContinuationNotes|continuation-notes/);
  assert.match(source, /prompt\(snapshot.assignment, issued.credential\)/);
});
