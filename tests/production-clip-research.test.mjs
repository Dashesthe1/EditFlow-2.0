import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
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
    practiceSceneMatches: [{ shotId: 'shot:1', sourceId: 'raw:1' }, { shotId: 'shot:2', sourceId: 'raw:1' }],
    controllerLease: { owner: 'controller', expiresAt: new Date(Date.now() + 120000).toISOString() } };
  const artifact = async (name, data) => { const file = path.join(dir, name + '.json'); await writeFile(file, JSON.stringify(data)); return file; };
  const scan = async (clipId = 'shot:1', extra = {}) => store.record(assignment, { action: 'SCAN', claimedBy: 'controller', clipId,
    sourceMediaId: 'raw:1', sourceRangeMs: [1000, 2000], referenceRangeMs: [0, 1000], observations: 'Reference shows a zoom with a shutter trail and a reverse exit.',
    effects: [{ effectId: 'zoom', behavior: 'zoom 1x to 1.5x then rebound' }, { effectId: 'trail', behavior: 'three offset shutter copies' }],
    evidencePath: await artifact('scan-' + clipId.replace(':', '-'), { clipId, sourceMediaId: 'raw:1', sourceRangeMs: [1000, 2000], referenceRangeMs: [0, 1000], observations: 'Observed raw and reference frames.' }), ...extra });
  const source = async (tier, outcome, effects = [], extra = {}) => {
    const uri = tier === 'TUTORIAL' ? 'https://drive.google.com/file/d/tutorial/view' : tier === 'ADOBE' ? 'https://helpx.adobe.com/after-effects/using/echo.html' : 'https://example.org/method';
    const input = { action: 'SOURCE', claimedBy: 'controller', clipId: 'shot:1', tier, outcome, query: 'zoom shutter reverse', uri,
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
  await assert.rejects(f.source('TUTORIAL', 'SUFFICIENT', ['zoom', 'trail'], { compiledResearchSourceId: 'title-only' }), /compiler-backed/);
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
  let service = new PracticePanelServerV1(config); await service.start();
  t.after(async () => { await service.stop(); await broker.stop(); await rm(root, { recursive: true, force: true }); });
  const headers = { 'X-EditFlow-Token': token, 'Content-Type': 'application/json' };
  const get = async route => (await fetch(`http://127.0.0.1:${service.port}${route}`, { headers })).json();
  assert.equal((await get('/v1/product/gpt/clip-research-contract')).schema, 'editflow.clip-research-contract.v1');
  for (const route of ['run', 'run-batch', 'execute', 'correction', 'build-baseline']) {
    const response = await fetch(`http://127.0.0.1:${service.port}/v1/product/control/${route}`, { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 409, route);
    assert.match((await response.json()).error, /CLIP_RESEARCH_REQUIRED/, route);
  }
  await service.stop(); service = new PracticePanelServerV1(config); await service.start();
  const resumed = await get('/v1/product/practice/resume-or-start');
  assert.equal(resumed.assignment.assignmentId, assignment.assignmentId);
  assert.match(resumed.assignment.chatMessage, /MANDATORY PER-CLIP RESEARCH GATE V1/);
  assert.equal(resumed.preflight.stage, 'READY');
  assert.equal((await store.listAssignments()).length, 1);
  assert.deepEqual(resumed.clipResearch.clips, {});
});
