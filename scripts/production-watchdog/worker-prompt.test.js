'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prompt } = require('./worker-prompt.js');
const { readContinuationNotes } = require('./continuation-notes.js');
const fs = require('node:fs');
const os = require('node:os');
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
    assert.match(text, /No new SCAN\/SOURCE\/PLAN is required/);
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
test('handoff notes are scoped to the exact assignment/session and do not supersede later receipts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editflow-notes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = { mode: 'PRACTICE', assignmentId: 'retained', sessionId: 'session' };
  const file = path.join(root, 'continuation-notes.json');
  fs.writeFileSync(file, JSON.stringify({ assignmentId: 'retained', sessionId: 'session', text: 'Correct text visibility; retain shot-10 receipt.' }));
  const text = prompt(task, 'ef-worker:118:isolated', readContinuationNotes(root, task));
  assert.match(text, /Correct text visibility; retain shot-10 receipt/);
  assert.match(text, /Preserve any corrections committed since this note/);
  assert.equal(readContinuationNotes(root, { ...task, assignmentId: 'foreign' }), null);
  assert.equal(readContinuationNotes(root, { ...task, sessionId: 'foreign' }), null);
  fs.writeFileSync(file, 'invalid JSON'); assert.equal(readContinuationNotes(root, task), null);
  fs.writeFileSync(file, JSON.stringify({ ...task, text: 'x'.repeat(16001) })); assert.equal(readContinuationNotes(root, task), null);
});
