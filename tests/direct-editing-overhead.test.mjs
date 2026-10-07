import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateRoutineBatchV1 } from '../.tmp/runtime/apps/desktop-host/src/local-fast-runtime.js';
import { productionJobsViewV1, productionSnapshotViewV1 } from '../.tmp/runtime/apps/desktop-host/src/direct-editing-views.js';
import { PracticeProductionWorkerV1, ProductionNoWriteErrorV1 } from '../.tmp/runtime/packages/practice-homework/src/production-worker.js';
import { ChatgptAeRenderDriverV1 } from '../.tmp/runtime/apps/desktop-host/src/chatgpt-ae-render-driver.js';

test('batch validation rejects a bad late action before any early action can run', () => {
  const comp = { stableId: 'c' }, layer = { stableId: 'l' };
  assert.throws(() => validateRoutineBatchV1([
    {kind:'SET_LAYER_TRANSFORM',comp,layer,values:{opacity:50}},
    {kind:'SET_PROPERTY_KEYFRAMES',comp,layer,propertyPath:['ADBE Transform Group','ADBE Opacity'],keyframes:[{time:1,value:50},{time:0,value:100}]},
  ]), /BATCH_ACTION_1/);
  assert.throws(() => validateRoutineBatchV1([{kind:'SET_TEXT_DOCUMENT',comp,layer,document:{arbitraryCode:'run()'}}]), /supported exact text/);
  assert.throws(() => validateRoutineBatchV1([{kind:'RUN_SCRIPT',script:'app.newProject()'}]), /allow-listed/);
});

test('compact receipts remove duplicate snapshots while complete decisions remain available', () => {
  const job = {jobId:'j',kind:'PROOF_SCRIPT',status:'SUCCEEDED',createdAt:'a',updatedAt:'b',payload:{scriptPath:'retained.jsx',editorialDecision:{decisionId:'d'}},result:{projectSnapshot:{hostRevision:2,items:Array(1000).fill('large')},readback:{value:25}}};
  const view = productionJobsViewV1([job]);
  assert.equal(view.jobs[0].payload, undefined);
  assert.equal(view.jobs[0].result.projectSnapshot, undefined);
  assert.deepEqual(view.jobs[0].result.readback, {value:25});
  assert.deepEqual(productionJobsViewV1([job], true).jobs[0],job);
  const snapshot = {stageElapsedMs:{LOCAL_PROOF:5000000},workflow:{activeDecisionId:'current',plans:[{plan:{decisionId:'old'}},{plan:{decisionId:'current'}}],reviews:[{id:'old'},{id:'current'}],milestones:[]}};
  assert.equal(productionSnapshotViewV1(snapshot).workflow.plans.length,1);
  assert.equal(productionSnapshotViewV1(snapshot).stageElapsedMs,undefined);
  assert.equal(productionSnapshotViewV1(snapshot,true).workflow.plans.length,2);
});

test('a known read-only preflight rejection permits the corrected next edit; unknown failures still hold work', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'direct-rejected-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const executed=[];
  const worker=new PracticeProductionWorkerV1(path.join(root,'jobs.jsonl'),async job=>{
    executed.push(job.payload.label);
    if(job.payload.label==='invalid')throw new ProductionNoWriteErrorV1('BATCH_NOT_APPLIED');
    if(job.payload.label==='unknown')throw Error('Partial write');
    return {result:{state:'COMMITTED'}};
  },async()=>true);
  const enqueue=label=>worker.enqueue({assignmentId:'a',kind:'AE_BATCH',payload:{label},dependencyIds:[]});
  const invalid=await enqueue('invalid');await worker.runOnce();
  assert.equal(worker.list()[0].status,'REJECTED');
  await enqueue('corrected');await worker.runOnce();
  assert.equal(worker.list()[1].status,'SUCCEEDED');
  await enqueue('unknown');await worker.runOnce();await enqueue('held');await worker.runOnce();
  assert.deepEqual(executed,['invalid','corrected','unknown']);
  const reopened=new PracticeProductionWorkerV1(path.join(root,'jobs.jsonl'),async()=>({result:{}}),async()=>true);await reopened.load();
  assert.equal(reopened.list().find(j=>j.jobId===invalid.jobId).status,'REJECTED');
});

test('preview reuse survives driver restart, rejects changed output and invalidates after an AE edit', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'direct-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let revision=1,renders=0;
  const make=()=>{
    const driver=new ChatgptAeRenderDriverV1({transport:{},projectId:'p',artifactDir:root});
    driver.client.observe=async()=>({hostRevision:revision,observed:{projectFingerprint:'picture',environmentFingerprint:'env'}});
    driver.client.executePublicAtKnownHostRevision=async(command,request)=>{
      assert.equal(request.expectedHostProjectRevision,revision);
      renders++;revision++;
      const completionPath=path.join(root,'done.json');
      await writeFile(request.payload.outputPath,'render-'+renders);
      await writeFile(completionPath,JSON.stringify({schemaVersion:1,jobId:'r',status:'DONE',ok:true,outputPath:request.payload.outputPath,error:null,queueItemRemoved:true}));
      return {outcome:'APPLIED',readback:{jobId:'r',completionPath}};
    };return driver;
  };
  const input={sessionId:'s',attempt:0,compStableId:'c',windowId:'w',startMs:0,endMs:1000};
  const first=await make().renderWindow(input);
  const cached=await make().renderWindow(input);
  assert.equal(cached.reused,true);assert.equal(cached.renderPath,first.renderPath);assert.equal(renders,1);
  await make().renderWindow({...input,windowId:'other',startMs:1000,endMs:2000});
  assert.equal((await make().renderWindow(input)).reused,true);
  await writeFile(first.renderPath,'changed output bytes');
  assert.equal((await make().renderWindow(input)).reused,false);
  revision++;assert.equal((await make().renderWindow(input)).reused,false);
  assert.equal((await make().renderWindow({...input,forceRender:true})).reused,false);
  assert.equal(renders,5);
});
