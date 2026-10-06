// Isolated acceptance lab for the normal production queue, with a real CEP host.
// Stop the idle canonical daemon first. This lab refuses a nonempty AE project.
// It never loads production credentials or changes production state files.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { LoopbackCepBroker } from '../.tmp/runtime/apps/desktop-host/src/loopback-cep.js';
import { PracticePanelServerV1 } from '../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js';
import { GptOrchestrationStoreV1 } from '../.tmp/runtime/packages/practice-homework/src/index.js';
import { AeCepAdapterClientV11, AeFilesystemPolicyV11, capabilityForCommandV11 } from '../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js';

const arg = name => process.argv[process.argv.indexOf(name) + 1];
for (const name of ['--config', '--inputs', '--result']) assert.ok(process.argv.includes(name), name);
const config = JSON.parse((await readFile(arg('--config'), 'utf8')).replace(/^\uFEFF/, ''));
const input = JSON.parse((await readFile(arg('--inputs'), 'utf8')).replace(/^\uFEFF/, ''));
const resultPath = path.resolve(arg('--result'));
const root = path.dirname(resultPath);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(root, { recursive: true });
const broker = new LoopbackCepBroker({ port: config.port, token: config.token, commandTimeoutMs: 30000,
  commandLeaseMs: 1000, expectedExtensionId: config.extensionId, supportedProtocolVersions: config.supportedProtocolVersions });
let readCounter = 0;
const client = new AeCepAdapterClientV11(broker, () => 'live-lab-read-' + (++readCounter), new AeFilesystemPolicyV11([root]));
const observed = { async observe() { const state = await client.observe('practice-gpt-controller'); return { ...state, ...state.observed }; } };
const report = { schema: 'editflow.direct-editing-live-proof.v1', startedAt: new Date().toISOString(),
  realAfterEffects: true, modes: [], ok: false, checks: {}, error: null };
let service;
try {
  await broker.start();
  await broker.waitForPanel(15000);
  const initial = await observed.observe();
  assert.equal(initial.project.itemCount, 0, 'Open an empty test project; production project will not be touched');
  report.host = initial.environment;
  for (const mode of ['PRACTICE', 'PRO_CREATION']) {
    const modeRoot = path.join(root, mode.toLowerCase());
    await mkdir(modeRoot, { recursive: true });
    const settings = { port: 0, token: config.token, broker, repositoryRoot: repo, artifactDir: modeRoot,
      learningMemoryFilePath: path.join(modeRoot, 'memory.json'), editTypeRegistryFilePath: path.join(modeRoot, 'types.json'),
      gptOrchestrationFilePath: path.join(modeRoot, 'assignments.json'), productionSupervision: false, renderTimeoutMs: 120000 };
    const store = new GptOrchestrationStoreV1(settings.gptOrchestrationFilePath);
    const assignment = await store.createAssignment({ mode, sessionId: 'live-lab:' + mode, editTypeId: 'acceptance-lab',
      artifactDir: modeRoot, knowledge: null, finish: mode === 'PRACTICE' ? input.finish : null, start: input.start,
      practiceSceneMatches: mode === 'PRACTICE' ? [input.selection] : [],
      preflight: { stage: 'READY', updatedAt: new Date().toISOString(), requireTransferNovelty: false,
        completedShotIds: [], unresolvedShotIds: [], reasons: [], evidenceRefs: [] } });
    service = new PracticePanelServerV1(settings); await service.start();
    const endpoint = '/v1/product/gpt/assignments/' + encodeURIComponent(assignment.assignmentId);
    const http = async (route, body) => {
      const response = await fetch('http://127.0.0.1:' + service.port + route, { headers: { 'X-EditFlow-Token': config.token,
        'Content-Type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
      const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
    };
    const owner = 'isolated-acceptance-lab';
    const resume = await http(endpoint + '/claim', { claimedBy: owner });
    assert.ok(resume.resume && resume.aeState, 'one-call resume includes actual AE state');
    const evidence = ['acceptance-lab:explicit-test-values', ...input.selection.evidenceRefs];
    const packet = (kind, label, payload) => ({ kind, payload: { ...payload,
      researchContext: { assignmentId: assignment.assignmentId, claimedBy: owner,
        clipIds: [mode === 'PRACTICE' ? input.selection.shotId : 'lab-clip'] },
      editorialDecision: { authority: 'CHATGPT_DIRECT', decisionId: mode + ':' + label,
        rationale: 'User-authorized live acceptance test with exact fixed test values; no visual-match claim.',
        evidenceRefs: evidence, steps: [label] } } });
    const wait = async id => {
      const deadline = Date.now() + 150000;
      while (Date.now() < deadline) {
        const job = (await http(endpoint + '/production-jobs?jobId=' + encodeURIComponent(id))).job;
        if (!['PENDING', 'RUNNING'].includes(job.status)) return job;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      throw Error('Live production job timed out: ' + id);
    };
    const queue = async body => (await http(endpoint + '/production-jobs', body)).job;
    const run = async body => { const job = await queue(body); const done = await wait(job.jobId);
      assert.equal(done.status, 'SUCCEEDED', JSON.stringify(done)); return done; };
    const prefix = 'ef-live-lab-' + mode.toLowerCase();
    const comp = { stableId: prefix + '-comp' };
    const layer = { stableId: prefix + '-layer' };
    const source = { stableId: prefix + '-source' };
    const audio = { stableId: prefix + '-audio' };
    const audioLayer = { stableId: prefix + '-audio-layer' };
    const baseline = await observed.observe();
    const commands = [
      ['comp.create', { ...comp, name: 'EditFlow isolated ' + mode + ' test', width: 320, height: 320, pixelAspect: 1, duration: 1, frameRate: 24 }],
      ['media.import', { path: input.selection.workingMedia.sourcePath, ...source }],
      ['layer.add_media', { comp, item: source, ...layer, duration: 1 }],
      ['layer.set_transform', { comp, layer, values: { position: [160, 160], scale: [20, 20] } }],
      ['property.set_keyframes', { comp, layer, propertyPath: ['ADBE Transform Group', 'ADBE Scale'],
        keyframes: [{ time: 0, value: [20, 20] }, { time: .5, value: [25, 25] }, { time: .9, value: [20, 20] }] }],
      ['effect.add', { comp, layer, matchName: 'ADBE Gaussian Blur 2', name: 'Live proof blur' }],
      ['effect.set_property', { comp, layer, effectIndex: 1, propertyPath: [1], value: 3 }],
      ['media.import', { path: input.start.find(item => item.mediaKind === 'AUDIO').uri, ...audio }],
      ['layer.add_media', { comp, item: audio, ...audioLayer, duration: 1 }],
    ];
    const plan = { planId: prefix, planRevision: 1, projectRevision: baseline.projectRevision,
      projectFingerprint: baseline.projectFingerprint, environmentFingerprint: baseline.environmentFingerprint,
      requiredCapabilities: [...new Set(commands.map(([command]) => capabilityForCommandV11(command)))], bindings: [], checkpoints: [],
      invariants: { structural: [], visual: [] }, rollbackBoundaries: [{ id: 'lab-boundary', strategy: 'RESTORE_SNAPSHOT' }],
      operations: commands.map(([command, payload], index) => ({ operationId: 'lab-op-' + index,
        capabilityId: capabilityForCommandV11(command), routeId: 'ae-cep.v1_1', dependsOn: index ? ['lab-op-' + (index - 1)] : [],
        idempotency: 'CHECK_THEN_APPLY', riskClass: 'R1_REVERSIBLE', input: { command, payload }, rollbackBoundaryId: 'lab-boundary' })) };
    const started = Date.now();
    const edit = await run(packet('AE_TRANSACTION', 'create-footage-audio-keys-effect', { plan }));
    assert.equal(edit.result.checkpoint.saved, true, JSON.stringify(edit.result));
    assert.ok((await stat(edit.result.checkpoint.projectPath)).size > 0);
    const actual = await observed.observe();
    await writeFile(path.join(modeRoot, 'constructed-readback.json'), JSON.stringify(actual, null, 2));
    const item = actual.project.items.find(item => item.stableId === comp.stableId);
    assert.equal(item.composition.layers.length, 2);
    const batchPacket = packet('AE_BATCH', 'cross-comp-batch', { transactionId: prefix + '-batch', intents: [
      { kind: 'CREATE_COMP', stableId: prefix + '-second', name: 'EditFlow isolated second target', width: 320, height: 320, pixelAspect: 1, duration: 1, frameRate: 24 },
      { kind: 'UPDATE_COMP_SETTINGS', comp, settings: { width: 321 } },
      { kind: 'UPDATE_COMP_SETTINGS', comp: { stableId: prefix + '-second' }, settings: { width: 322 } },
    ] });
    const firstReceipt = await queue(batchPacket), duplicate = await queue(batchPacket);
    assert.equal(duplicate.jobId, firstReceipt.jobId, 'identical submission reuses durable receipt');
    const batch = await wait(firstReceipt.jobId); assert.equal(batch.status, 'SUCCEEDED', JSON.stringify(batch));
    assert.equal(batch.result.completedActions, 3); assert.equal(batch.result.checkpoint.saved, true);
    const preview = await queue(packet('LOCAL_RENDER', 'full-resolution-preview', { compStableId: comp.stableId, startMs: 0, endMs: 1000 }));
    const next = await queue(packet('AE_BATCH', 'continue-after-preview', { transactionId: prefix + '-after-preview', intents: [
      { kind: 'UPDATE_COMP_SETTINGS', comp, settings: { width: 320 } },
    ] }));
    const rendered = await wait(preview.jobId); assert.equal(rendered.status, 'SUCCEEDED', JSON.stringify(rendered));
    assert.ok((await stat(rendered.result.renderPath)).size > 0);
    const continued = await wait(next.jobId); assert.equal(continued.status, 'SUCCEEDED', JSON.stringify(continued));
    const modeReport = { mode, elapsedMs: Date.now() - started, assignmentId: assignment.assignmentId,
      checks: { oneCallResume: true, directTransactionNoResearchOrWorkflowPlan: true, realFootageAudioKeysAndEffect: true,
        automaticCheckpoint: true, crossCompositionBatch: true, duplicateReceiptReused: true,
        realFullResolutionRender: true, nextEditAfterPreviewWithoutResolve: true },
      renderPath: rendered.result.renderPath, jobs: [edit, batch, rendered, continued].map(job => ({ jobId: job.jobId, kind: job.kind, status: job.status })) };
    await service.stop(); service = new PracticePanelServerV1(settings); await service.start();
    const resumed = await http(endpoint + '/claim', { claimedBy: owner });
    assert.equal(resumed.assignment.assignmentId, assignment.assignmentId);
    assert.equal((await wait(next.jobId)).status, 'SUCCEEDED');
    modeReport.checks.retainedAssignmentAndJobsAfterServiceRestart = true;
    const cleanupPath = 'scripts/windows/direct-editing-lab-cleanup.jsx';
    const cleanup = await queue(packet('PROOF_SCRIPT', 'restore-empty-test-project', { scriptPath: cleanupPath,
      scriptSha256: createHash('sha256').update(await readFile(path.join(repo, cleanupPath))).digest('hex') }));
    const cleaned = await wait(cleanup.jobId); assert.equal(cleaned.status, 'REVIEW_REQUIRED', JSON.stringify(cleaned));
    const final = await observed.observe(); assert.equal(final.project.itemCount, 0);
    const cleanupEvidence = path.join(modeRoot, 'cleanup-readback.json');
    await writeFile(cleanupEvidence, JSON.stringify(final, null, 2));
    await http(endpoint + '/production-jobs', { action: 'RESOLVE', jobId: cleanup.jobId, claimedBy: owner, reviewEvidenceRef: cleanupEvidence });
    modeReport.checks.emptyProjectRestored = true;
    report.modes.push(modeReport);
    console.log(JSON.stringify(modeReport));
    await service.stop(); service = null;
  }
  report.ok = report.modes.length === 2 && report.modes.every(mode => Object.values(mode.checks).every(Boolean));
} catch (error) { report.error = error.stack ?? String(error); }
finally {
  await service?.stop().catch(() => {});
  await broker.stop().catch(() => {});
  report.completedAt = new Date().toISOString();
  await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: report.ok, checks: report.modes.map(mode => ({ mode: mode.mode, checks: mode.checks })), error: report.error }));
process.exitCode = report.ok ? 0 : 1;
