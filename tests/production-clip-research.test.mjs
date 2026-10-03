import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { ClipResearchStoreV1 } from '../.tmp/runtime/packages/practice-homework/src/clip-research.js';
import { LoopbackCepBroker } from '../.tmp/runtime/apps/desktop-host/src/loopback-cep.js';
import { PracticePanelServerV1 } from '../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js';
import { GptOrchestrationStoreV1 } from '../.tmp/runtime/packages/practice-homework/src/index.js';

async function fixture(t, mode = 'PRACTICE') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clip-research-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new ClipResearchStoreV1(path.join(dir, 'ledger'), [dir]);
  const assignment = { assignmentId: 'assignment:1', sessionId: 'practice:1', status: 'RUNNING', mode,
    start: [{ mediaId: 'raw:1', mediaKind: 'VIDEO', uri: 'raw.mp4' }], finish: { mediaId: 'finish:1', uri: 'reference.mp4' },
    practiceSceneMatches: ['shot:1', 'shot:2'].map(shotId => ({ shotId, sourceId: 'raw:1',
      selectionMode: 'CHATGPT_DIRECT', chatgptSelection: { authority: 'CHATGPT_DIRECT', decisionId: 'fixture:' + shotId,
        rationale: 'Direct visual comparison', reviewedAt: new Date().toISOString(),
        anchors: [0, 400, 900].map(time => ({ referenceTimeMs: time, sourceTimeMs: 1000 + time,
          referenceEvidenceId: 'a'.repeat(24), sourceEvidenceId: 'b'.repeat(24), observation: 'Same visible action' })) } })),
    controllerLease: { owner: 'controller', expiresAt: new Date(Date.now() + 120000).toISOString() } };
  const artifact = async (name, data) => { const file = path.join(dir, name + '.json'); await writeFile(file, JSON.stringify(data)); return file; };
  const scan = async (clipId = 'shot:1', extra = {}) => store.record(assignment, { action: 'SCAN', claimedBy: 'controller', clipId,
    sourceMediaId: 'raw:1', sourceRangeMs: [1000, 2000], referenceRangeMs: [0, 1000], observations: 'Reference shows a zoom with a shutter trail and a reverse exit.',
    effects: [{ effectId: 'zoom', behavior: 'zoom 1x to 1.5x then rebound' }, { effectId: 'trail', behavior: 'three offset shutter copies' }],
    evidencePath: await artifact('scan-' + clipId.replace(':', '-'), { clipId, sourceMediaId: 'raw:1', sourceRangeMs: [1000, 2000], referenceRangeMs: [0, 1000], observations: 'Observed raw and reference frames.' }), ...extra });
  const source = async (tier, outcome, effects = [], extra = {}) => {
    const uri = tier === 'TUTORIAL' ? 'https://drive.google.com/file/d/tutorial/view' : tier === 'ADOBE' ? 'https://helpx.adobe.com/after-effects/using/echo.html' : 'https://example.org/method';
    const input = { action: 'SOURCE', authority:'CHATGPT_DIRECT', claimedBy: 'controller', clipId: 'shot:1', tier, outcome, query: 'zoom shutter reverse', uri,
      title: tier + ' source', locator: '00:12-00:30', limitation: 'Missing the three-copy trail construction.',
      evidencePath: await artifact(tier, { query: 'zoom shutter reverse', uri, locator: '00:12-00:30', observations: 'Inspected method section and extracted the actual tool sequence.', results: [] }),
      compiledResearchSourceId: 'compiled:1', steps: effects.length ? [{ stepId: 'step:1', tool: 'Transform/Echo', action: 'Animate scale; time-offset copies and ease reverse exit.', effectIds: effects }] : [], ...extra };
    const compiled = [{ sourceId: 'compiled:1', uri, tutorialCompilation: { schema: 'editflow.gpt-tutorial-causal-compilation.v1', compilerVersion: 1, evidenceRefs: ['deep-analysis:1'] } }];
    return store.record(assignment, input, compiled);
  };
  const plan = async () => {
    const saved = await store.snapshot(assignment);
    const bindings = ['zoom', 'trail'].map(effectId => { const source = saved.clips['shot:1'].sources.find(source => source.steps.some(step => step.effectIds.includes(effectId))); return { effectId, sourceId: source.sourceId, stepIds: ['step:1'], adaptation: 'Match the reference window timing; adjust trail distance to raw subject motion.' }; });
    return store.record(assignment, { action: 'PLAN', claimedBy: 'controller', clipId: 'shot:1', bindings, comparisonChecks: ['Compare peak zoom, three-copy trail, duration and reverse exit on rendered frames.'] });
  };
  const context = saved => ({ researchContext: { assignmentId: assignment.assignmentId, claimedBy: 'controller', plans: [{ clipId: 'shot:1', planId: saved.clips['shot:1'].plan.planId }] } });
  return { store, assignment, artifact, scan, source, plan, context, dir };
}

test('edits cannot skip inspection or research, even with policy/ET knowledge', async t => {
  const f = await fixture(t);
  await assert.rejects(f.store.admit(f.assignment, { tutorialPolicy: true }), /researchContext/);
  await assert.rejects(f.source('TUTORIAL', 'SUFFICIENT', ['zoom', 'trail']), /SCAN/);
  await f.scan();
  await assert.rejects(f.store.admit(f.assignment, { researchContext: { assignmentId: 'assignment:1', claimedBy: 'controller', plans: [{ clipId: 'shot:1', planId: 'invented' }] } }), /READY/);
});

test('compiled tutorial methods unlock only their scanned clip and survive restart', async t => {
  const f = await fixture(t); await f.scan(); await f.source('TUTORIAL', 'SUFFICIENT', ['zoom', 'trail']);
  const saved = await f.plan(); const body = f.context(saved);
  const fresh = new ClipResearchStoreV1(path.join(f.dir, 'ledger'), [f.dir]);
  const admission = await fresh.admit(f.assignment, body);
  assert.equal(admission.plans[0].bindings[0].methods[0].tool, 'Transform/Echo');
  await fresh.audit(f.assignment, admission, 'HTTP_COMPLETED', ['render:1']);
  assert.equal((await fresh.snapshot(f.assignment)).audit.at(-1).evidenceRefs[0], 'render:1');
  const unrelated = structuredClone(body); unrelated.researchContext.plans[0].clipId = 'shot:2';
  await assert.rejects(fresh.admit(f.assignment, unrelated), /READY/);
  await assert.rejects(fresh.admit(f.assignment, { ...body, goal: { shotId: 'shot:2' } }), /Every declared mutation/);
});

test('fallback cannot skip tutorials or Adobe, or escalate when already sufficient', async t => {
  const f = await fixture(t); await f.scan();
  await assert.rejects(f.source('ADOBE', 'SUFFICIENT', ['zoom', 'trail']), /tutorials first/);
  await f.source('TUTORIAL', 'PARTIAL', ['zoom']);
  await assert.rejects(f.source('WEB', 'SUFFICIENT', ['zoom', 'trail']), /without skipping/);
  await f.source('ADOBE', 'PARTIAL', ['zoom']);
  await f.source('WEB', 'PARTIAL', ['trail']);
  const saved = await f.plan(); await f.store.admit(f.assignment, f.context(saved));
  const other = await fixture(t); await other.scan(); await other.source('TUTORIAL', 'SUFFICIENT', ['zoom', 'trail']);
  await assert.rejects(other.source('ADOBE', 'SUFFICIENT', ['zoom', 'trail']), /insufficient coverage/);
});

test('tutorial title alone, missing methods, and fake Adobe host cannot pass', async t => {
  const f = await fixture(t); await f.scan();
  await assert.rejects(f.source('TUTORIAL', 'SUFFICIENT', ['zoom', 'trail'], { compiledResearchSourceId: 'title-only' }), /historical compiled source/);
  await assert.rejects(f.source('TUTORIAL', 'SUFFICIENT', ['zoom']), /every scanned effect/);
  await f.source('TUTORIAL', 'NO_MATCH');
  const badUri = 'https://adobe.com.example.org/help';
  const evidencePath = await f.artifact('bad-adobe', { query: 'zoom shutter reverse', uri: badUri, locator: '00:12-00:30', observations: 'Read it.' });
  await assert.rejects(f.source('ADOBE', 'SUFFICIENT', ['zoom', 'trail'], { uri: badUri, evidencePath }), /official Adobe/);
});

test('scan/evidence/media changes invalidate plans; identical scan remains resumable', async t => {
  const f = await fixture(t); await f.scan(); await f.source('TUTORIAL', 'SUFFICIENT', ['zoom', 'trail']);
  const saved = await f.plan(); const body = f.context(saved);
  await f.scan(); await f.store.admit(f.assignment, body);
  const changed = structuredClone(f.assignment); changed.start[0].uri = 'changed.mp4';
  await assert.rejects(f.store.admit(changed, body), /Media\/scene matches changed/);
  await writeFile(saved.clips['shot:1'].sources[0].evidence.path, JSON.stringify({ query: 'changed' }));
  await assert.rejects(f.store.admit(f.assignment, body), /evidence changed/);
  await f.scan('shot:1', { observations: 'New reference diagnosis: stronger trails.' });
  await assert.rejects(f.store.admit(f.assignment, body), /READY/);
});

test('raw-only input, controller ownership and cancellation are enforced', async t => {
  const f = await fixture(t);
  await assert.rejects(f.scan('shot:1', { sourceMediaId: 'finish:1' }), /provided raw video/);
  await assert.rejects(f.scan('shot:1', { claimedBy: 'other-chat' }), /Claim\/heartbeat/);
  await f.scan(); await f.source('TUTORIAL', 'SUFFICIENT', ['zoom', 'trail']); const saved = await f.plan();
  await assert.rejects(f.store.admit({ ...f.assignment, status: 'CANCEL_REQUESTED' }, f.context(saved)), /Cancelled/);
  const stale = f.context(saved); stale.researchContext.claimedBy = 'other-chat';
  await assert.rejects(f.store.admit(f.assignment, stale), /current live controller/);
});

test('Pro Creation requires the same clip research and supports a designed target without Finish', async t => {
  const f = await fixture(t, 'PRO_CREATION'); f.assignment.finish = null;
  await f.scan(); await f.source('TUTORIAL', 'SUFFICIENT', ['zoom', 'trail']); const saved = await f.plan();
  await f.store.admit(f.assignment, f.context(saved));
  assert.equal(saved.clips['shot:1'].scan.referenceMediaId, null);
});

test('Practice research cannot admit a machine choice or reuse plans after direct selection changes', async t => {
  const f = await fixture(t);
  await f.scan(); await f.source('TUTORIAL', 'SUFFICIENT', ['zoom', 'trail']);
  const saved = await f.plan(), body = f.context(saved);
  const legacy = structuredClone(f.assignment);
  legacy.practiceSceneMatches[0].selectionMode = 'VISUAL_BEST';
  await assert.rejects(f.store.record(legacy, { action: 'SCAN', claimedBy: 'controller', clipId: 'shot:1' }), /direct ChatGPT/);
  await assert.rejects(f.store.admit(legacy, body), /direct ChatGPT/);
  const relabeled = structuredClone(f.assignment);
  delete relabeled.practiceSceneMatches[0].chatgptSelection;
  await assert.rejects(f.store.record(relabeled, { action: 'SCAN', claimedBy: 'controller', clipId: 'shot:1' }), /direct ChatGPT/);
  const reselected = structuredClone(f.assignment);
  reselected.practiceSceneMatches[0].chatgptSelection.decisionId = 'reviewed:replacement';
  await assert.rejects(f.store.admit(reselected, body), /READY/);
  await f.store.admit(f.assignment, body);
});

test('integrated HTTP edits reject before dispatch; restart preserves the same assignment and new instructions', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clip-research-http-'));
  const token = 'clip-research-http-token-0123456789abcdef';
  const broker = new LoopbackCepBroker({ port: 0, token }); await broker.start();
  const config = { port: 0, token, broker, repositoryRoot: process.cwd(), artifactDir: path.join(root, 'artifacts'),
    learningMemoryFilePath: path.join(root, 'memory.json'), editTypeRegistryFilePath: path.join(root, 'types.json'), gptOrchestrationFilePath: path.join(root, 'gpt.json') };
  const store = new GptOrchestrationStoreV1(config.gptOrchestrationFilePath);
  const assignment = await store.createAssignment({ sessionId: 'practice:http', mode: 'PRACTICE', editTypeId: 'test', artifactDir: root, knowledge: null,
    finish: { mediaId: 'finish', role: 'FINISH_REFERENCE', mediaKind: 'VIDEO', uri: 'reference.mp4' },
    start: [{ mediaId: 'raw', role: 'START_SOURCE', mediaKind: 'VIDEO', uri: 'raw.mp4' }],
    preflight: { stage: 'READY', updatedAt: new Date().toISOString(), requireTransferNovelty: false, completedShotIds: [], unresolvedShotIds: [], reasons: [], evidenceRefs: [] } });
  await store.claim(assignment.assignmentId, 'controller');
  let service = new PracticePanelServerV1({ ...config, productionSupervision: false }); await service.start();
  t.after(async () => { await service.stop(); await broker.stop(); await rm(root, { recursive: true, force: true }); });
  const headers = { 'X-EditFlow-Token': token, 'Content-Type': 'application/json' };
  const get = async route => (await fetch(`http://127.0.0.1:${service.port}${route}`, { headers })).json();
  assert.equal((await get('/v1/product/gpt/clip-research-contract')).schema, 'editflow.clip-research-contract.v1');
  for (const route of ['run', 'run-batch', 'execute', 'correction', 'build-baseline']) {
    const response = await fetch(`http://127.0.0.1:${service.port}/v1/product/control/${route}`, { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 410, route);
    assert.equal((await response.json()).error, "EDIT_EXECUTION_PATH_REMOVED", route);
  }
  await service.stop(); service = new PracticePanelServerV1({ ...config, productionSupervision: false }); await service.start();
  const resumed = await get('/v1/product/practice/resume-or-start');
  assert.equal(resumed.assignment.assignmentId, assignment.assignmentId);
  assert.match(resumed.assignment.chatMessage, /MANDATORY PER-CLIP RESEARCH GATE V1/);
  assert.equal(resumed.preflight.stage, 'READY');
  assert.equal((await store.listAssignments()).length, 1);
  assert.deepEqual(resumed.clipResearch.clips, {});
});

test('compiled research source can be reused across clips with identical effect coverage', async t => {
  const f = await fixture(t);
  await f.scan('shot:1');
  await f.source('TUTORIAL', 'SUFFICIENT', ['zoom', 'trail']);
  const first = await f.store.snapshot(f.assignment);
  const sourceId = first.clips['shot:1'].sources[0].sourceId;
  await f.scan('shot:2');
  const reused = await f.store.record(f.assignment, {
    action: 'SOURCE',
    claimedBy: 'controller',
    clipId: 'shot:2',
    reuseSourceId: sourceId,
  });
  assert.equal(reused.clips['shot:2'].sources[0].sourceId, sourceId);
  assert.equal(reused.audit.at(-1).kind, 'RESEARCH_REUSED');
});


test('public research view bounds audit payload while preserving complete retained history', async t => {
  const f = await fixture(t);
  const ledger = { clips: { 'shot:1': { plan: { status:'READY' } } }, journaledAudit:['hash'],
    audit: Array.from({length:30}, (_,i) => ({kind:'METHOD_EXECUTION', plans:[{clipId:'shot:1',planId:'plan:'+i,methods:'x'.repeat(10000)}]})) };
  const view = f.store.publicView(ledger);
  assert.equal(view.audit.length,20); assert.equal(view.auditCount,30); assert.equal(view.auditTruncated,true);
  assert.equal(view.audit[0].plans[0].methods,undefined); assert.equal(view.journaledAudit,undefined);
  assert.equal(f.store.publicView(ledger,true).audit.length,30);
  assert.equal(ledger.audit[0].plans[0].methods.length,10000);
});

for (const mode of ['PRACTICE', 'PRO_CREATION']) test(`${mode} executes only authorized durable jobs and resumes review receipts`, async t => {
  const f = await fixture(t, mode);
  const token = 'production-authority-test-token-0123456789abcdef';
  const config = { port: 0, token, repositoryRoot: f.dir, artifactDir: f.dir,
    learningMemoryFilePath: path.join(f.dir, 'memory.json'), editTypeRegistryFilePath: path.join(f.dir, 'types.json'),
    gptOrchestrationFilePath: path.join(f.dir, 'gpt.json') };
  const store = new GptOrchestrationStoreV1(config.gptOrchestrationFilePath);
  const assignment = await store.createAssignment({ sessionId: 'production:' + mode, mode, editTypeId: 'test', artifactDir: f.dir, knowledge: null,
    finish: mode === 'PRACTICE' ? { mediaId: 'finish:1', role: 'FINISH_REFERENCE', mediaKind: 'VIDEO', uri: 'reference.mp4' } : null,
    start: [{ mediaId: 'raw:1', role: 'START_SOURCE', mediaKind: 'VIDEO', uri: path.join(f.dir, 'raw.mp4') }],
    practiceSceneMatches: mode === 'PRACTICE' ? [{ shotId: 'shot:1', sourceId: 'raw:1', sourceStartMs: 1000, sourceEndMs: 2000, confidence: 1, playbackRate: 1, direction: 'FORWARD', selectionMode: 'CHATGPT_DIRECT',
      chatgptSelection: { authority: 'CHATGPT_DIRECT', decisionId: 'test-selection', rationale: 'Fixture direct review', reviewedAt: new Date().toISOString(),
        anchors: [0, 400, 900].map(time => ({ referenceTimeMs: time, sourceTimeMs: 1000 + time, referenceEvidenceId: 'a'.repeat(24), sourceEvidenceId: 'b'.repeat(24), observation: 'Fixture comparison' })) } }] : [],
    preflight: { stage: 'READY', updatedAt: new Date().toISOString(), requireTransferNovelty: false, totalShotIds: ['shot:1'], completedShotIds: ['shot:1'], unresolvedShotIds: [], reasons: [], evidenceRefs: [] } });
  Object.assign(f.assignment, await store.claim(assignment.assignmentId, 'controller'));
  f.store.directory = path.join(f.dir, 'clip-research');
  await writeFile(f.assignment.start[0].uri, 'raw media');
  await f.scan(); await f.source('TUTORIAL', 'SUFFICIENT', ['zoom', 'trail']);
  const saved = await f.plan();
  await mkdir(path.join(f.dir,'scripts','windows'), {recursive:true});
  const scriptPath=path.join(f.dir,'scripts','windows','test.jsx'); await writeFile(scriptPath,'// scoped native capability helper');
  const { productionJobScopeV1 } = await import('../.tmp/runtime/packages/adapters/ae-cep/src/production-job-scope.js');
  let borrowedScope = null;
  let revision = 1;
  const dispatched = [];
  const broker = { panelSession: { protocolVersion: '2.7.0' }, async dispatch(request) {
    dispatched.push(request);
    if (request.command === 'property.set_keyframes') {
      borrowedScope = productionJobScopeV1.getStore();
      assert.ok(borrowedScope);
      const child = await fetch(borrowedScope.EDITFLOW_WORKER_PROOF_URL, {method:'POST',headers:{'Content-Type':'application/json',
        'X-EditFlow-Token':borrowedScope.EDITFLOW_WORKER_PRODUCT_TOKEN,'X-EditFlow-Worker-Key':borrowedScope.EDITFLOW_WORKER_PROOF_KEY},body:JSON.stringify({scriptPath})});
      assert.equal(child.status,200); assert.ok((await child.json()).productionJobId);
    }
    const observational = request.command === 'host.probe' || request.command === 'project.inspect';
    if (!observational) revision++;
    return { protocolVersion: request.protocolVersion, requestId: request.requestId, transactionId: request.transactionId,
      operationId: request.operationId, capabilityId: request.capabilityId, command: request.command, outcome: observational ? 'NO_OP' : 'APPLIED',
      error: null, affectedObjects: [], readback: {}, hostProjectRevision: revision, proofArtifactRefs: [],
      diagnostics: { adapterProtocolVersion: request.protocolVersion, adapterBuild: 'test', command: request.command, notes: [] },
      environmentProbe: request.command === 'host.probe' ? { adapterProtocolVersion: '1.1.0', adapterBuild: 'test', hostName: 'Adobe After Effects', hostVersion: 'test', hostBuild: 'test', os: 'test', projectOpen: true } : null,
      projectSnapshot: request.command === 'project.inspect' ? { hostRevision: revision, filePath: null, activeItemHostId: null, itemCount: 0, items: [] } : null };
  }};
  const makeService=()=>{ const s=new PracticePanelServerV1({productionSupervision:false,...config,broker});
    // Unit fixture isolates queue behavior; actual reference/pixel admission is tested by chatgpt-footage-browser-real.
    if(mode==='PRACTICE') s.assertPracticeReconstructionReady=async()=>{}; return s; };
  let service=makeService(); await service.start();
  t.after(async () => service.stop());
  const headers = { 'X-EditFlow-Token': token, 'Content-Type': 'application/json' };
  const request = (route, body) => fetch(`http://127.0.0.1:${service.port}${route}`, { headers, ...(body ? { method:'POST', body:JSON.stringify(body) } : {}) });
  const endpoint = '/v1/product/gpt/assignments/' + encodeURIComponent(assignment.assignmentId) + '/production-jobs';
  for (const route of ['/run', '/run-batch', '/run-transaction', '/run-correction-transaction', '/proof-script', '/mutation-lease/acquire', '/v1/product/control/execute']) {
    const response = await request(route, {}); assert.equal(response.status, 410, route);
    assert.equal((await response.json()).error, 'EDIT_EXECUTION_PATH_REMOVED');
  }
  assert.equal(dispatched.length, 0);
  const unscoped = await request('/v1/product/production/worker-proof', {scriptPath:'scripts/windows/test.jsx'});
  assert.equal(unscoped.status,409); assert.equal(dispatched.length,0);
  const invalid = await request(endpoint, {kind:'AE_TRANSACTION',payload:{researchContext:{assignmentId:assignment.assignmentId,claimedBy:'controller',plans:[]}}});
  assert.equal(invalid.status, 409); assert.equal(dispatched.length, 0);
  const { CurrentAeTransactionRuntimeV1 } = await import('../.tmp/runtime/apps/desktop-host/src/current-ae-transaction-runtime.js');
  const observed = await new CurrentAeTransactionRuntimeV1(broker, 'practice-gpt-controller').observe();
  const plan = { planId:'authority-edit',planRevision:1,projectRevision:observed.projectRevision,projectFingerprint:observed.projectFingerprint,
    environmentFingerprint:observed.environmentFingerprint,requiredCapabilities:['ae.keyframe.set'],bindings:[],checkpoints:[],invariants:{structural:[],visual:[]},
    rollbackBoundaries:[{id:'boundary',strategy:'RESTORE_SNAPSHOT'}], operations:[{operationId:'keys',capabilityId:'ae.keyframe.set',routeId:'ae-cep.v1_1',dependsOn:[],
      idempotency:'CHECK_THEN_APPLY',riskClass:'R1_REVERSIBLE',input:{command:'property.set_keyframes',payload:{},readbackProfile:'test'},rollbackBoundaryId:'boundary'}] };
  const editorialDecision={authority:'CHATGPT_DIRECT',decisionId:'explicit-keys',rationale:'Reviewed fixture pixels and chose exact keys',evidenceRefs:['fixture-render'],steps:['Set explicit keys']};
  const accepted = await request(endpoint, {kind:'AE_TRANSACTION',payload:{...f.context(saved),plan,editorialDecision}});
  assert.equal(accepted.status, 202); const receipt = (await accepted.json()).job;
  const wait = async id => { for(let i=0;i<200;i++) { const job = (await (await request(endpoint+'?jobId='+encodeURIComponent(id))).json()).job;
    if(!['RUNNING','PENDING'].includes(job.status)) return job; await new Promise(r=>setTimeout(r,10)); } throw new Error('queued job timeout'); };
  const complete = await wait(receipt.jobId); assert.equal(complete.status, 'SUCCEEDED', complete.error);
  const state = await (await request(endpoint.replace('/production-jobs','/production'))).json();
  assert.equal(state.production.phases[0].state, 'CONSTRUCTED');
  const expired = await fetch(borrowedScope.EDITFLOW_WORKER_PROOF_URL,{method:'POST',headers:{'Content-Type':'application/json',
    'X-EditFlow-Token':token,'X-EditFlow-Worker-Key':borrowedScope.EDITFLOW_WORKER_PROOF_KEY},body:JSON.stringify({scriptPath})});
  assert.equal(expired.status,409);
  const proof = await request(endpoint,{kind:'PROOF_SCRIPT',payload:{...f.context(saved),scriptPath,scriptSha256:createHash('sha256').update(await readFile(scriptPath)).digest('hex'),editorialDecision:{...editorialDecision,decisionId:'explicit-proof'}}});
  const review = await wait((await proof.json()).job.jobId); assert.equal(review.status,'REVIEW_REQUIRED');
  await service.stop(); service = makeService(); await service.start();
  const resumed = (await (await request(endpoint+'?jobId='+encodeURIComponent(review.jobId))).json()).job;
  assert.equal(resumed.status,'REVIEW_REQUIRED');
  const noEvidence = await request(endpoint,{action:'RESOLVE',jobId:review.jobId,claimedBy:'controller'}); assert.equal(noEvidence.status,400);
  const resolved = await request(endpoint,{action:'RESOLVE',jobId:review.jobId,claimedBy:'controller',reviewEvidenceRef:'actual-ae-readback.json'}); assert.equal(resolved.status,200);
  if(mode === 'PRO_CREATION') {
    await writeFile(f.assignment.start[0].uri,'changed raw media requires a fresh scan');
    const changed = await (await request(endpoint.replace('/production-jobs','/production'))).json();
    assert.equal(changed.production.phases[0].sourceValidationRequired,true);
    const stale = await request(endpoint,{kind:'PROOF_SCRIPT',payload:{...f.context(saved),scriptPath,scriptSha256:createHash('sha256').update(await readFile(scriptPath)).digest('hex'),editorialDecision:{...editorialDecision,decisionId:'explicit-proof'}}}); assert.equal(stale.status,409);
    await f.scan(); await f.source('TUTORIAL','SUFFICIENT',['zoom','trail']); const renewed = await f.plan();
    assert.notEqual(renewed.clips['shot:1'].scanHash,saved.clips['shot:1'].scanHash);
    const fresh = await (await request(endpoint.replace('/production-jobs','/production'))).json();
    assert.equal(fresh.production.phases[0].sourceValidationRequired,false);
    const unsupported = await request(endpoint,{kind:'BUILD_BASELINE',payload:f.context(saved)}); assert.equal(unsupported.status,400);
  }
});
