import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProductionSupervisionV1, redactWorkerCredentialsV1 } from '../.tmp/runtime/apps/desktop-host/src/production-supervision.js';
import { GptOrchestrationStoreV1 } from '../.tmp/runtime/packages/practice-homework/src/index.js';
import { LoopbackCepBroker } from '../.tmp/runtime/apps/desktop-host/src/loopback-cep.js';
import { PracticePanelServerV1 } from '../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js';
import { PracticeProductionWorkerV1 } from '../.tmp/runtime/packages/practice-homework/src/production-worker.js';

test('durable generation fencing rejects a late old worker, serializes revoke and does not leak its credential', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worker-fence-')); t.after(() => rm(root, { recursive: true, force: true }));
  const a = new ProductionSupervisionV1(root);
  a.acquireGateway();
  assert.throws(() => new ProductionSupervisionV1(root).acquireGateway(), /ALREADY_RUNNING/);
  a.releaseGateway();
  await a.bind({ assignmentId: 'assignment', sessionId: 'session', mode: 'PRO_CREATION' });
  const first = await a.issue('assignment', 'launch-1');
  assert.equal(await a.issue('assignment', 'launch-1'), first);
  let release; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const op = a.authorized('assignment', first, { effect: 'smear' }, async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  await started;
  let revoked = false;
  const revoke = a.revoke('assignment', 1, 'stall').then(() => { revoked = true; });
  await Promise.resolve(); assert.equal(revoked, false);
  release(); await op; await revoke;
  const second = await a.issue('assignment', 'launch-2');
  await assert.rejects(a.authorized('assignment', first, {}, async () => {}), /STALE_WORKER/);
  const restarted = new ProductionSupervisionV1(root);
  await restarted.authorized('assignment', second, {}, async () => {});
  assert.equal(restarted.publicState().generation, 2);
  assert.ok(!JSON.stringify(restarted.publicState()).includes(second));
  assert.ok(!redactWorkerCredentialsV1({ message: second, nested: { owner: second } }).includes(second));
  await restarted.revoke('assignment', 2, 'user_pause', true);
  await assert.rejects(restarted.issue('assignment', 'launch-3'), /NOT_ARMED/);
  await restarted.resume('assignment'); assert.equal(restarted.publicState().state, 'HANDOFF');
});

test('current-worker assignment typo is correctable but missing, retired and paused credentials remain fenced', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worker-assignment-')); t.after(() => rm(root, { recursive: true, force: true }));
  const authority = new ProductionSupervisionV1(root);
  await authority.bind({ assignmentId: 'retained-assignment', sessionId: 'retained-session', mode: 'PRACTICE' });
  const credential = await authority.issue('retained-assignment', 'launch');
  const before = authority.publicState();
  let writes = 0;
  const write = async () => { writes++; return 200; };
  await assert.rejects(authority.authorized('retained-assignment-typo', credential, {}, write),
    error => error.status === 400 && error.message.startsWith('ASSIGNMENT_ID_MISMATCH:') && !error.message.includes(credential));
  assert.equal(writes, 0);
  assert.deepEqual(authority.publicState(), before);
  await authority.authorized('retained-assignment', credential, {}, write);
  assert.equal(writes, 1);
  assert.equal(authority.publicState().generation, before.generation);
  await assert.rejects(authority.authorized('retained-assignment-typo', null, {}, write), /STALE_WORKER/);
  await authority.revoke('retained-assignment', before.generation, 'pause', true);
  await assert.rejects(authority.authorized('retained-assignment-typo', credential, {}, write), /STALE_WORKER/);
  assert.equal(writes, 1);
});

test('live HTTP gateway automatically binds both modes and rejects revoked/missing/wrong-assignment writes before dispatch', async t => {
  for (const mode of ['PRACTICE', 'PRO_CREATION']) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'supervisor-http-'));
    const token = 'supervisor-http-test-token-0123456789abcdef';
    const broker = new LoopbackCepBroker({ port: 0, token }); await broker.start();
    t.after(async () => { await broker.stop(); await rm(root, { recursive: true, force: true }); });
    const config = { port: 0, token, broker, repositoryRoot: process.cwd(), artifactDir: path.join(root, 'artifacts'),
      learningMemoryFilePath: path.join(root, 'memory.json'), editTypeRegistryFilePath: path.join(root, 'types.json'), gptOrchestrationFilePath: path.join(root, 'gpt.json') };
    const store = new GptOrchestrationStoreV1(config.gptOrchestrationFilePath);
    const assignment = await store.createAssignment({ sessionId: 'session:' + mode, mode, editTypeId: 'test', artifactDir: root, knowledge: null,
      ...(mode === 'PRACTICE' ? { finish: { mediaId: 'finish', role: 'FINISH_REFERENCE', mediaKind: 'VIDEO', uri: 'ref.mp4' } } : { finish: null }),
      start: [{ mediaId: 'raw', role: 'START_SOURCE', mediaKind: 'VIDEO', uri: 'raw.mp4' }],
      preflight: { stage: 'READY', updatedAt: new Date().toISOString(), requireTransferNovelty: false, completedShotIds: [], unresolvedShotIds: [], reasons: [], evidenceRefs: [] } });
    await store.claim(assignment.assignmentId, 'old-legacy-controller');
    let service = new PracticePanelServerV1(config); await service.start();
    try {
      const headers = { 'x-editflow-token': token, 'content-type': 'application/json' };
      const call = (route, body, extra = {}) => fetch(`http://127.0.0.1:${service.port}${route}`, { headers: { ...headers, ...extra }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
      const supervision = '/v1/product/production/supervision';
      const key = (await readFile(path.join(root, 'production-supervision', 'supervisor.key'), 'utf8')).trim();
      const admin = { 'x-editflow-supervisor-key': key };
      assert.equal((await call(supervision)).status, 403);
      const bound = await (await call(supervision, null, admin)).json(); assert.equal(bound.authority.mode, mode);
      const issue = await (await call(supervision, { action: 'ISSUE', assignmentId: assignment.assignmentId, launchId: 'first' }, admin)).json();
      const base = '/v1/product/gpt/assignments/' + encodeURIComponent(assignment.assignmentId);
      assert.equal((await call(base + '/claim', { claimedBy: 'old-legacy-controller' })).status, 409);
      const claim = await call(base + '/claim', { claimedBy: issue.credential }); assert.equal(claim.status, 200);
      assert.ok(!(await claim.text()).includes(issue.credential));
      const typoBase = '/v1/product/gpt/assignments/' + encodeURIComponent(assignment.assignmentId + '-typo');
      const rejected = await call(typoBase + '/claim', { claimedBy: issue.credential });
      assert.equal(rejected.status, 400);
      const mismatch = await rejected.json();
      assert.match(mismatch.error, /ASSIGNMENT_ID_MISMATCH/);
      assert.ok(!JSON.stringify(mismatch).includes(issue.credential));
      assert.equal((await store.listAssignments()).length, 1);
      assert.equal((await call(base + '/claim', { claimedBy: issue.credential })).status, 200);
      assert.equal((await call(base + '/production-jobs', { kind: 'AE_BATCH', payload: { researchContext: { assignmentId: assignment.assignmentId } } })).status, 409);
      await call(supervision, { action: 'REVOKE', assignmentId: assignment.assignmentId, generation: issue.authority.generation, reason: 'test-stall' }, admin);
      assert.equal((await call(base + '/claim', { claimedBy: issue.credential })).status, 409);
      const publicAssignment = await (await call(base)).text(); assert.ok(!publicAssignment.includes(issue.credential));
      await service.stop(); service = new PracticePanelServerV1(config); await service.start();
      const restored = await (await call(supervision, null, admin)).json();
      assert.equal(restored.authority.state, 'HANDOFF'); assert.equal(restored.assignment.assignmentId, assignment.assignmentId);
      assert.equal((await store.listAssignments()).length, 1);
    } finally { await service.stop(); await broker.stop(); await rm(root, { recursive: true, force: true }); }
  }
});

test('accepted job identity survives a chat replacement and pause defers pending work without deleting it', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'job-handoff-')); t.after(() => rm(root, { recursive: true, force: true }));
  let runnable = false, executions = 0;
  const worker = new PracticeProductionWorkerV1(path.join(root, 'jobs.jsonl'), async () => { executions++; return { result: 'done' }; }, async () => true, async () => runnable);
  const input = { assignmentId: 'a', kind: 'AE_BATCH', dependencyIds: [], payload: { researchContext: { claimedBy: 'ef-worker:1:' + 'a'.repeat(64) }, intents: ['smear'] } };
  const first = await worker.enqueue(input);
  const duplicate = await worker.enqueue({ ...input, payload: { ...input.payload, researchContext: { claimedBy: 'ef-worker:2:' + 'b'.repeat(64) } } });
  assert.equal(duplicate.jobId, first.jobId);
  await worker.runOnce(); assert.equal(executions, 0); assert.equal(worker.list()[0].status, 'PENDING');
  runnable = true; await worker.runOnce(); assert.equal(executions, 1); assert.equal(worker.list()[0].status, 'SUCCEEDED');
});
