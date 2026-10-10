// Isolated acceptance lab for the normal production queue, with a real CEP host.
// Stop the idle canonical daemon first. A nonempty project requires --preserve-project and is saved/restored around the lab.
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
import { sourceAssemblyCommandsV1 } from '../.tmp/runtime/apps/desktop-host/src/source-match-assembly.js';

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
let originalProject = null;
let labOpened = false;
let recoverLab = null;
try {
  await broker.start();
  await broker.waitForPanel(15000);
  const initial = await observed.observe();
  if (initial.project.itemCount > 0 && !process.argv.includes("--discard-previous-lab")) {
    assert.ok(process.argv.includes('--preserve-project'), 'Nonempty project requires explicit preservation');
    const projectPath = initial.project.filePath || path.join(root, 'retained-production-project.aep');
    const saver = new AeCepAdapterClientV11(broker, () => 'lab-preserve-' + (++readCounter), new AeFilesystemPolicyV11([path.dirname(projectPath)]));
    const saved = await saver.executePublicAtKnownHostRevision('project.save', { transactionId:'lab-preserve',operationId:'save-before-lab',payload:{path:projectPath},expectedHostProjectRevision:initial.hostRevision });
    assert.ok(['APPLIED','NO_OP'].includes(saved.outcome),JSON.stringify(saved));
    const retained = await observed.observe();
    originalProject = { projectPath, fingerprint:retained.observed.projectFingerprint,itemCount:retained.project.itemCount };
    report.originalProject = originalProject;
    await writeFile(path.join(root,'original-project-readback.json'),JSON.stringify(retained,null,2));
    const beginPath = path.join(root,'begin-lab.jsx');
    await writeFile(beginPath, '(function(){if(!app.project.file || app.project.file.fsName !== new File('+JSON.stringify(projectPath)+').fsName ) throw new Error("Retained project path mismatch");app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);app.newProject();}());');
    originalProject.beginScript = path.relative(repo,beginPath).replace(/\\/g,'/');
    const restorePath = path.join(root,'restore-project.jsx');
    await writeFile(restorePath,'(function(){if(app.project.numItems !== 0) throw new Error("Lab must be cleaned before restoration"); app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); app.open(new File('+JSON.stringify(projectPath)+'));}());');
    originalProject.restoreScript = path.relative(repo,restorePath).replace(/\\/g,'/');
  }
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
    recoverLab = async () => {
      if (!labOpened || report.checks.originalProjectRestored || report.checks.emptyProjectRestored) return;
      const actual = await observed.observe();
      if (originalProject && actual.observed.projectFingerprint === originalProject.fingerprint) { report.checks.originalProjectRestored = true; return; }
      const evidencePath=path.join(root,'failed-lab-readback.json');await writeFile(evidencePath,JSON.stringify(actual,null,2));
      const retained=await http(endpoint+'/production-jobs?includeHistory=true');
      for(const job of retained.jobs) if(['REVIEW_REQUIRED','RECONCILE_REQUIRED','FAILED'].includes(job.status)) {
        await http(endpoint+'/production-jobs',{action:'RESOLVE',jobId:job.jobId,claimedBy:owner,reviewEvidenceRef:evidencePath,result:{discardedIsolatedLab:true}});
      }
      if(actual.project.itemCount) {
        const cleanupPath='scripts/windows/direct-editing-lab-cleanup.jsx';
        const cleanup=await queue(packet('PROOF_SCRIPT','discard-failed-lab',{scriptPath:cleanupPath,scriptSha256:createHash('sha256').update(await readFile(path.join(repo,cleanupPath))).digest('hex')}));
        const cleaned=await wait(cleanup.jobId);assert.equal(cleaned.status,'REVIEW_REQUIRED',JSON.stringify(cleaned));
        const empty=await observed.observe();assert.equal(empty.project.itemCount,0);
        const emptyPath=path.join(root,'failed-lab-empty-readback.json');await writeFile(emptyPath,JSON.stringify(empty,null,2));
        await http(endpoint+'/production-jobs',{action:'RESOLVE',jobId:cleanup.jobId,claimedBy:owner,reviewEvidenceRef:emptyPath});
      }
      if (!originalProject) { report.checks.emptyProjectRestored = true; return; }
      const restore=await queue(packet('PROOF_SCRIPT','restore-after-failed-lab',{scriptPath:originalProject.restoreScript,scriptSha256:createHash('sha256').update(await readFile(path.join(repo,originalProject.restoreScript))).digest('hex')}));
      const restored=await wait(restore.jobId);assert.equal(restored.status,'REVIEW_REQUIRED',JSON.stringify(restored));
      const current=await observed.observe();assert.equal(current.observed.projectFingerprint,originalProject.fingerprint);
      const restoredPath=path.join(root,'recovery-restored-project.json');await writeFile(restoredPath,JSON.stringify(current,null,2));
      await http(endpoint+'/production-jobs',{action:'RESOLVE',jobId:restore.jobId,claimedBy:owner,reviewEvidenceRef:restoredPath});
      report.checks.originalProjectRestored=true;
    };
    if (initial.project.itemCount > 0 && process.argv.includes('--discard-previous-lab') && !labOpened) {
      const cleanupPath='scripts/windows/direct-editing-lab-cleanup.jsx';
      const cleanup=await queue(packet('PROOF_SCRIPT','discard-previous-isolated-lab',{scriptPath:cleanupPath,scriptSha256:createHash('sha256').update(await readFile(path.join(repo,cleanupPath))).digest('hex')}));
      const cleaned=await wait(cleanup.jobId);assert.equal(cleaned.status,'REVIEW_REQUIRED',JSON.stringify(cleaned));
      const empty=await observed.observe();assert.equal(empty.project.itemCount,0);labOpened=true;
      const emptyPath=path.join(root,'previous-lab-empty.json');await writeFile(emptyPath,JSON.stringify(empty,null,2));
      await http(endpoint+'/production-jobs',{action:'RESOLVE',jobId:cleanup.jobId,claimedBy:owner,reviewEvidenceRef:emptyPath});
    }
    if (originalProject && !labOpened) {
      const job = await queue(packet('PROOF_SCRIPT','save-and-enter-isolated-lab',{scriptPath:originalProject.beginScript,
        scriptSha256:createHash('sha256').update(await readFile(path.join(repo,originalProject.beginScript))).digest('hex')}));
      const entered = await wait(job.jobId);assert.equal(entered.status,'REVIEW_REQUIRED',JSON.stringify(entered));
      const empty=await observed.observe();assert.equal(empty.project.itemCount,0);labOpened=true;
      const evidencePath=path.join(root,'lab-empty-readback.json');await writeFile(evidencePath,JSON.stringify(empty,null,2));
      await http(endpoint+'/production-jobs',{action:'RESOLVE',jobId:job.jobId,claimedBy:owner,reviewEvidenceRef:evidencePath});
    }
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
    labOpened = true;
    const edit = await run(packet('AE_TRANSACTION', 'create-footage-audio-keys-effect', { plan }));
    assert.equal(edit.result.checkpoint.saved, true, JSON.stringify(edit.result));
    assert.ok((await stat(edit.result.checkpoint.projectPath)).size > 0);
    const actual = await observed.observe();
    await writeFile(path.join(modeRoot, 'constructed-readback.json'), JSON.stringify(actual, null, 2));
    const item = actual.project.items.find(item => item.stableId === comp.stableId);
    assert.equal(item.composition.layers.length, 2);
    let sourceAssemblyCheck = null;
    if (process.argv.includes('--assembly-fixture')) {
      // Diagnostic fixture only: production official-timestamp admission is
      // independently tested. Never promote these test ranges into a real edit.
      const fixture = JSON.parse((await readFile(arg('--assembly-fixture'),'utf8')).replace(/^\uFEFF/,''));
      const official=process.argv.includes('--official-assembly-fixture');
      if(!official)fixture.manifest.output.stableId = prefix + '-ordered-raw';
      const {commands,batchCount,totalDuration} = sourceAssemblyCommandsV1(fixture.manifest,fixture.media,0);
      assert.equal(batchCount,1);
      const before = await observed.observe();
      const boundary = 'assembly-live-boundary';
      const exactPlan = {planId:prefix+'-assembly',planRevision:1,projectRevision:before.projectRevision,
        projectFingerprint:before.projectFingerprint,environmentFingerprint:before.environmentFingerprint,
        requiredCapabilities:[...new Set(commands.map(([command])=>capabilityForCommandV11(command)))],bindings:[],checkpoints:[],
        invariants:{structural:[],visual:[]},rollbackBoundaries:[{id:boundary,strategy:'RESTORE_SNAPSHOT'}],
        operations:commands.map(([command,payload],i)=>({operationId:prefix+'-assembly-op-'+i,
          capabilityId:capabilityForCommandV11(command),routeId:'ae-cep.v1_1',dependsOn:i?[prefix+'-assembly-op-'+(i-1)]:[],
          idempotency:'CHECK_THEN_APPLY',riskClass:'R1_REVERSIBLE',input:{command,payload},rollbackBoundaryId:boundary}))};
      const assemblyStarted=Date.now();
      const officialPlan=official?await http('/v1/product/source-match',{action:'ASSEMBLY_PLAN',assemblyId:fixture.assemblyId,
        assignmentId:assignment.assignmentId,batchIndex:0}):null;
      if(officialPlan)assert.deepEqual(officialPlan.payload.plan.operations.map(o=>[o.input.command,o.input.payload]),commands);
      const assembled=await run(officialPlan?{kind:officialPlan.kind,payload:{...officialPlan.payload,
        researchContext:{assignmentId:assignment.assignmentId,claimedBy:owner,clipIds:[mode==='PRACTICE'?input.selection.shotId:'lab-clip']}}}:
        packet('AE_TRANSACTION','ordered-source-assembly',{plan:exactPlan}));
      const state=await observed.observe();
      const raw=state.project.items.find(x=>x.stableId===fixture.manifest.output.stableId);
      await writeFile(path.join(modeRoot,'source-assembly-readback.json'),JSON.stringify(raw,null,2));
      assert.equal(raw.composition.layers.length,fixture.manifest.shots.length);
      const chronological=[...raw.composition.layers].sort((a,b)=>a.inPoint-b.inPoint);
      let cursor=0,maxReadbackTimingErrorSeconds=0;
      for(let i=0;i<chronological.length;i++) {
        const layer=chronological[i],shot=fixture.manifest.shots[i];
        assert.equal(layer.stableId,fixture.manifest.output.stableId+'-shot-'+i);
        maxReadbackTimingErrorSeconds=Math.max(maxReadbackTimingErrorSeconds,Math.abs(layer.inPoint-cursor));
        cursor+=shot.sourceEndExclusive-shot.sourceStart;
        maxReadbackTimingErrorSeconds=Math.max(maxReadbackTimingErrorSeconds,Math.abs(layer.outPoint-cursor));
        // AE's rational clock quantizes sub-frame seconds. Require the same
        // whole-frame span, plus <=100 microseconds error (0.0024 frames here).
        assert.equal(Math.round((layer.outPoint-layer.inPoint)*fixture.manifest.output.frameRate),
          Math.round((shot.sourceEndExclusive-shot.sourceStart)*fixture.manifest.output.frameRate));
      }
      assert.ok(maxReadbackTimingErrorSeconds<.0001);
      assert.ok(Math.abs(raw.composition.duration-totalDuration)<1/fixture.manifest.output.frameRate);
      assert.equal(assembled.result.checkpoint.saved,true);
      sourceAssemblyCheck={shotCount:chronological.length,operations:commands.length,elapsedMs:Date.now()-assemblyStarted,
        originalOrderAndTrims:true,checkpointSaved:true,maxReadbackTimingErrorSeconds,
        officialServiceHandoff:official,
        scope:official?'Native queue handoff from actual saved matching/project-evidence/extraction services; known-frame fixture':
          'Native CFR assembly diagnostic with unchanged frame spans; not full-edit timestamp acceptance'};
    }
    const batchPacket = packet('AE_BATCH', 'cross-comp-batch', { transactionId: prefix + '-batch', intents: [
      { kind: 'CREATE_COMP', stableId: prefix + '-second', name: 'EditFlow isolated second target', width: 320, height: 320, pixelAspect: 1, duration: 1, frameRate: 24 },
      { kind: 'UPDATE_COMP_SETTINGS', comp, settings: { width: 321 } },
      { kind: 'UPDATE_COMP_SETTINGS', comp: { stableId: prefix + '-second' }, settings: { width: 322 } },
    ] });
    const firstReceipt = await queue(batchPacket), duplicate = await queue(batchPacket);
    assert.equal(duplicate.jobId, firstReceipt.jobId, 'identical submission reuses durable receipt');
    const batch = await wait(firstReceipt.jobId); assert.equal(batch.status, 'SUCCEEDED', JSON.stringify(batch));
    assert.equal(batch.result.completedActions, 3); assert.equal(batch.result.checkpoint.saved, true);
    const native = await run(packet('AE_BATCH','native-text-solid-properties', {transactionId:prefix+'-native',intents:[
      {kind:'ADD_SOLID_LAYER',comp,stableId:prefix+'-matte',sourceStableId:prefix+'-matte-source',name:'Lab matte',color:[0,0,0],width:320,height:320,pixelAspect:1,duration:1},
      {kind:'SET_PROPERTY_VALUE',comp,layer:{stableId:prefix+'-matte'},propertyPath:['ADBE Transform Group','ADBE Opacity'],value:6},
      {kind:'ADD_TEXT_LAYER',comp,stableId:prefix+'-text',text:'EditFlow',document:{fontSize:24,fillColor:[1,0.8,0.2],applyFill:true,justification:'CENTER'}},
      {kind:'SET_TEXT_DOCUMENT',comp,layer:{stableId:prefix+'-text'},document:{text:'Direct AE',tracking:20}},
      {kind:'SET_LAYER_TRANSFORM',comp,layer:{stableId:prefix+'-text'},values:{position:[160,70]}},
      {kind:'SET_PROPERTY_KEYFRAMES',comp,layer:{stableId:prefix+'-text'},propertyPath:['ADBE Transform Group','ADBE Opacity'],keyframes:[{time:0,value:50},{time:0.5,value:100},{time:0.9,value:60}]},
      {kind:'SET_PROPERTY_EXPRESSION',comp,layer:{stableId:prefix+'-text'},propertyPath:['ADBE Transform Group','ADBE Rotate Z'],expression:'0'},
      {kind:'SET_EFFECT_PROPERTY',comp,layer,effectIndex:1,propertyPath:[1],value:2},
      {kind:'READ_PROPERTY',comp,layer:{stableId:prefix+'-text'},propertyPath:['ADBE Transform Group','ADBE Opacity']},
    ]}));
    assert.equal(native.result.completedActions,9);assert.equal(native.result.checkpoint.saved,true);
    assert.equal(native.result.readbacks.at(-1).readback.property.numKeys,3);
    assert.deepEqual(native.result.readbacks.at(-1).readback.property.keyframes.map(k=>k.value),[50,100,60]);
    assert.equal(native.result.readbacks[3].readback.document.text,'Direct AE');
    assert.ok(native.result.currentState.projectRevision);
    const beforeReject=await observed.observe();
    const rejectedJob=await queue(packet('AE_BATCH','reject-before-writing',{transactionId:prefix+'-rejected',intents:[
      {kind:'SET_LAYER_TRANSFORM',comp,layer,values:{opacity:55}},
      {kind:'SET_PROPERTY_VALUE',comp,layer,propertyPath:['Definitely missing property'],value:1},
    ]}));
    const rejected=await wait(rejectedJob.jobId);assert.equal(rejected.status,'REJECTED',JSON.stringify(rejected));
    const afterReject=await observed.observe();assert.equal(afterReject.observed.projectFingerprint,beforeReject.observed.projectFingerprint);
    assert.equal(afterReject.hostRevision,beforeReject.hostRevision);
    const preview = await queue(packet('LOCAL_RENDER', 'full-resolution-preview', { compStableId: comp.stableId, startMs: 0, endMs: 1000 }));
    const next = await queue(packet('AE_BATCH', 'continue-after-preview', { transactionId: prefix + '-after-preview', intents: [
      { kind: 'UPDATE_COMP_SETTINGS', comp, settings: { width: 320 } },
    ] }));
    const rendered = await wait(preview.jobId); assert.equal(rendered.status, 'SUCCEEDED', JSON.stringify(rendered));
    assert.ok((await stat(rendered.result.renderPath)).size > 0);
    const continued = await wait(next.jobId); assert.equal(continued.status, 'SUCCEEDED', JSON.stringify(continued));
    const cachedPacket=packet('LOCAL_RENDER','cached-preview',{compStableId:comp.stableId,startMs:0,endMs:1000});
    const freshPreview=await run(cachedPacket);
    const reusedPreview=await run(packet('LOCAL_RENDER','reuse-same-preview',{compStableId:comp.stableId,startMs:0,endMs:1000}));
    assert.equal(reusedPreview.result.reused,true);assert.equal(reusedPreview.result.renderPath,freshPreview.result.renderPath);
    const frames=await run(packet('LOCAL_RENDER','exact-frame-question',{compStableId:comp.stableId,frameTimesMs:[500],resolutionScale:1}));
    assert.ok((await stat(frames.result.frames[0].framePath)).size>0);
    const compact=await http(endpoint+'/production-jobs');assert.equal(compact.detail,'SUMMARY');assert.ok(compact.jobs.every(job=>!job.payload));
    const full=await http(endpoint+'/production-jobs?includeHistory=true');assert.ok(full.jobs.some(job=>job.payload));
    const modeReport = { mode, elapsedMs: Date.now() - started, assignmentId: assignment.assignmentId,
      ...(sourceAssemblyCheck ? {sourceAssemblyCheck} : {}),
      checks: { oneCallResume: true, directTransactionNoResearchOrWorkflowPlan: true, realFootageAudioKeysAndEffect: true,
        automaticCheckpoint: true, crossCompositionBatch: true, duplicateReceiptReused: true,
        nativeTextSolidPropertyAndKeyframes:true, exactPropertyReadback:true, preflightRejectsBeforeAnyWrite:true, rejectedReadOnlyRequestDoesNotBlockNextEdit:true,
        responseContainsCurrentState:true, unchangedPreviewReused:true, exactStillFrameReturned:true, compactDefaultAndFullAudit:true,
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
    if (mode === 'PRO_CREATION' && originalProject) {
      const restore=await queue(packet('PROOF_SCRIPT','restore-retained-production-project',{scriptPath:originalProject.restoreScript,
        scriptSha256:createHash('sha256').update(await readFile(path.join(repo,originalProject.restoreScript))).digest('hex')}));
      const restored=await wait(restore.jobId);assert.equal(restored.status,'REVIEW_REQUIRED',JSON.stringify(restored));
      const actual=await observed.observe();assert.equal(actual.project.itemCount,originalProject.itemCount);
      assert.equal(actual.observed.projectFingerprint,originalProject.fingerprint);
      const evidencePath=path.join(root,'restored-project-readback.json');await writeFile(evidencePath,JSON.stringify(actual,null,2));
      await http(endpoint+'/production-jobs',{action:'RESOLVE',jobId:restore.jobId,claimedBy:owner,reviewEvidenceRef:evidencePath});
      report.checks.originalProjectRestored=true;
    }
    report.modes.push(modeReport);
    console.log(JSON.stringify(modeReport));
    await service.stop(); service = null;
  }
  report.ok = report.modes.length === 2 && report.modes.every(mode => Object.values(mode.checks).every(Boolean));
} catch (error) { report.error = error.stack ?? String(error);
  try { await recoverLab?.(); } catch (restoreError) { report.restoreError=restoreError.stack ?? String(restoreError); }
}
finally {
  await service?.stop().catch(() => {});
  await broker.stop().catch(() => {});
  report.completedAt = new Date().toISOString();
  await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: report.ok, checks: report.modes.map(mode => ({ mode: mode.mode, checks: mode.checks })), error: report.error }));
process.exitCode = report.ok ? 0 : 1;
