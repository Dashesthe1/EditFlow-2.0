import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {officialSourceTimestampsV1,sourceAssemblyCommandsV1,sourceAssemblyProgressV1,SourceMatchAssemblyV1} from '../.tmp/runtime/apps/desktop-host/src/source-match-assembly.js';

function report(count=3) {
  return {schema:'editflow.source-match-report.v1',status:'COMPLETE',alternativeReviewComplete:true,
    reference:{path:'/ref.mp4',fingerprint:'ref-hash',duration:count},sources:[{path:'/raw.mp4',fingerprint:'raw-hash',duration:100}],
    shots:Array.from({length:count},(_,i)=>({shotId:'shot-'+i,status:'VERIFIED',boundaryStatus:'MEASURED_ENDPOINT_CORRESPONDENCES',
      referenceStart:i,referenceEnd:i+1,sourcePath:'/raw.mp4',sourceStart:50-i*2,sourceEndExclusive:51-i*2}))};
}
function body(r=report()) {
  return {requestId:'prepare',jobId:'source-match-00000000-0000-0000-0000-000000000000',encoder:'CPU',
    output:{stableId:'ordered-raw',name:'Ordered source ranges',width:3840,height:1600,pixelAspect:1,frameRate:24},
    review:{authority:'CHATGPT_DIRECT',decisionId:'review-complete',rationale:'All saved source ranges directly reviewed.',
      shots:r.shots.map(s=>({shotId:s.shotId,verdict:'PASS',observation:'Matched source endpoints and interior.',evidenceRefs:['issued-frame-pairs']}))}};
}
function media(manifest) { return {shots:manifest.shots.map(s=>({...s,workingPath:'/clips/'+s.shotId+'.mp4'}))}; }

test('requires all endpoints, full competing-match review and full reference coverage',()=>{
  for(const status of ['LOCATED','UNRESOLVED']) {
    const r=report();r.shots[1].status=status;
    assert.throws(()=>officialSourceTimestampsV1(r,body(r)),/ALL_SHOT_ENDPOINTS/);
  }
  const r=report();r.alternativeReviewComplete=false;
  assert.throws(()=>officialSourceTimestampsV1(r,body(r)),/ALL_SHOT_ENDPOINTS/);
  const gap=report();gap.shots[1].referenceStart+=.1;
  assert.throws(()=>officialSourceTimestampsV1(gap,body(gap)),/COVERAGE/);
  const partial=report();partial.shots.pop();
  assert.throws(()=>officialSourceTimestampsV1(partial,body(partial)),/COVERAGE/);
});

test('machine verification cannot replace direct GPT review',()=>{
  const r=report(),request=body(r);request.review.shots.pop();
  assert.throws(()=>officialSourceTimestampsV1(r,request),/GPT_REVIEW/);
  request.review=body(r).review;request.review.shots[1].verdict='REVISE';
  assert.throws(()=>officialSourceTimestampsV1(r,request),/GPT_REVIEW/);
});

test('Finished order survives reverse source chronology, exact ranges and repeated footage',()=>{
  const r=report();r.shots[2].sourceStart=50;r.shots[2].sourceEndExclusive=51;
  const manifest=officialSourceTimestampsV1(r,body(r)),cuts=media(manifest);
  const result=sourceAssemblyCommandsV1(manifest,cuts,0);
  assert.deepEqual(manifest.shots.map(s=>s.sourceStart),[50,48,50]);
  assert.deepEqual(result.commands.filter(c=>c[0]==='media.import').map(c=>c[1].path),['/clips/shot-0.mp4','/clips/shot-1.mp4','/clips/shot-2.mp4']);
  assert.deepEqual(result.commands.filter(c=>c[0]==='layer.set_timing').map(c=>c[1].timing),[
    {startTime:0,inPoint:0,outPoint:1,stretch:100},{startTime:1,inPoint:1,outPoint:2,stretch:100},{startTime:2,inPoint:2,outPoint:3,stretch:100}]);
  assert.equal(result.totalDuration,3);
});

test('bounded transaction batches preserve sequence offsets and reject incomplete media',()=>{
  const r=report(40);r.shots.forEach((s,i)=>{s.sourceStart=i;s.sourceEndExclusive=i+1;});
  const manifest=officialSourceTimestampsV1(r,body(r)),cuts=media(manifest);
  assert.equal(sourceAssemblyCommandsV1(manifest,cuts,0).commands.length,64);
  const next=sourceAssemblyCommandsV1(manifest,cuts,1);
  assert.equal(next.batchCount,2);assert.equal(next.commands.length,57);
  assert.equal(next.commands.find(c=>c[0]==='layer.set_timing')[1].timing.inPoint,21);
  assert.ok(!next.commands.some(c=>c[0]==='comp.create'));
  cuts.shots.pop();assert.throws(()=>sourceAssemblyCommandsV1(manifest,cuts,0),/INCOMPLETE/);
});

test('resume distinguishes prepared media from committed AE batches and never skips uncertain writes',()=>{
  const assembly={assemblyId:'a',status:'READY',batchCount:2};
  const job=(batchIndex,status)=>({jobId:'job-'+batchIndex,status,payload:{sourceAssembly:{assemblyId:'a',batchIndex}}});
  assert.equal(sourceAssemblyProgressV1(assembly,[]).nextBatchIndex,0);
  assert.equal(sourceAssemblyProgressV1(assembly,[job(0,'SUCCEEDED'),job(1,'RECONCILE_REQUIRED')]).nextBatchIndex,1);
  const complete=sourceAssemblyProgressV1(assembly,[job(0,'SUCCEEDED'),job(1,'SUCCEEDED')]);
  assert.equal(complete.status,'ASSEMBLED');assert.equal(complete.nextBatchIndex,null);
  assert.equal(sourceAssemblyProgressV1({...assembly,status:'FAILED'},[job(0,'SUCCEEDED'),job(1,'SUCCEEDED')]).status,'FAILED');
});

async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'source-assembly-test-'));
  await mkdir(path.join(root,'scripts','source-match'),{recursive:true});
  await writeFile(path.join(root,'scripts','source-match','assemble_ranges.py'),`
import json,sys,time
from pathlib import Path
p=Path(sys.argv[sys.argv.index('--manifest')+1]);m=json.loads(p.read_text())
assert p.exists()
time.sleep(.15)
shots=[]
for s in m['shots']:
 cut=p.parent/(s['shotId']+'.mp4');cut.write_text('cut-fixture')
 shots.append(dict(**s,workingPath=str(cut)))
(p.parent/'materialized.json').write_text(json.dumps(dict(shots=shots,extractionSeconds=.15)))
`);
  const r=report();r.reference.path=path.join(root,'ref.mp4');r.sources[0].path=path.join(root,'raw.mp4');
  r.shots.forEach(s=>{s.sourcePath=r.sources[0].path;});
  for(const file of [r.reference.path,r.sources[0].path]) await writeFile(file,'source-fixture');
  const python=execFileSync(process.platform==='win32'?'py':'python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
  const config={repositoryRoot:root,artifactDir:path.join(root,'jobs'),cacheDir:path.join(root,'cache'),configPath:path.join(root,'config.json')};
  await writeFile(config.configPath,JSON.stringify({python,ffmpeg:'fixture-only'}));
  const matcher={async status(){return {job:{status:r.status},report:r};}};
  const service=new SourceMatchAssemblyV1(config,matcher);
  t.after(async()=>{await service.stop();await rm(root,{recursive:true,force:true});});
  return {root,r,request:body(r),service,allowed:{rawPaths:[r.sources[0].path],referencePath:r.reference.path}};
}
async function ready(service,id) {
  for(let i=0;i<100;i++) {const r=await service.status(id);if(r.assembly.status!=='PREPARING')return r;
    await new Promise(r=>setTimeout(r,20));}
  throw Error('Fixture timeout');
}

test('partial report cannot create an official receipt or begin extraction',async t=>{
  const f=await fixture(t);f.r.status='PARTIAL';
  await assert.rejects(f.service.prepare(f.request),/ALL_SHOT_ENDPOINTS/);
  await assert.rejects(stat(path.join(f.root,'jobs')),e=>e.code==='ENOENT');
});

test('assembly cancellation retains official timestamps without preparing an AE plan',async t=>{
  const f=await fixture(t),a=await f.service.prepare(f.request);
  assert.equal((await f.service.forMatch(f.request.jobId)).assemblyId,a.assembly.assemblyId);
  assert.equal((await f.service.cancel(a.assembly.assemblyId)).cancellationRequested,true);
  const cancelled=await ready(f.service,a.assembly.assemblyId);
  assert.equal(cancelled.assembly.status,'CANCELLED');
  assert.equal(JSON.parse(await readFile(a.assembly.manifestPath,'utf8')).review.decisionId,f.request.review.decisionId);
  await assert.rejects(f.service.plan(a.assembly.assemblyId,0,{},f.allowed),/NOT_READY/);
});

test('cancelled extraction resumes the same official receipt and concurrent retries start one worker',async t=>{
  const f=await fixture(t),a=await f.service.prepare(f.request);
  const original=await readFile(a.assembly.manifestPath);
  await f.service.cancel(a.assembly.assemblyId);
  assert.equal((await ready(f.service,a.assembly.assemblyId)).assembly.status,'CANCELLED');
  const [first,second]=await Promise.all([f.service.resume(a.assembly.assemblyId),f.service.resume(a.assembly.assemblyId)]);
  assert.equal(first.assembly.assemblyId,a.assembly.assemblyId);assert.equal(second.assembly.assemblyId,a.assembly.assemblyId);
  const result=await ready(f.service,a.assembly.assemblyId);assert.equal(result.assembly.status,'READY');assert.equal(result.assembly.resumeCount,1);
  assert.deepEqual(await readFile(a.assembly.manifestPath),original);
  assert.equal((await f.service.resume(a.assembly.assemblyId)).assembly.resumeCount,1);
});

test('resuming interrupted preparation rejects changed original identities',async t=>{
  const f=await fixture(t),a=await f.service.prepare(f.request);await ready(f.service,a.assembly.assemblyId);
  const statePath=path.join(path.dirname(a.assembly.manifestPath),'state.json'),state=JSON.parse(await readFile(statePath,'utf8'));
  state.status='PREPARING';await writeFile(statePath,JSON.stringify(state));
  assert.equal((await f.service.status(a.assembly.assemblyId)).assembly.status,'INTERRUPTED');
  await writeFile(f.r.sources[0].path,'changed input');
  await assert.rejects(f.service.resume(a.assembly.assemblyId),/SOURCE_CHANGED/);
});

test('original timeline endpoints require explicit proof and unchanged project/export before AE planning',async t=>{
  const f=await fixture(t),project=path.join(f.root,'original.project'),timeline=path.join(f.root,'frame-map.json');
  await writeFile(project,'original project');await writeFile(timeline,'original export');
  const hash=b=>createHash('sha256').update(b).digest('hex'),s=f.r.shots[0];
  s.boundaryStatus='ORIGINAL_TIMELINE_FRAME_MAP';
  assert.throws(()=>officialSourceTimestampsV1(f.r,f.request),/FRAME_PROOF/);
  s.originalTimelineFrameMap=[{referencePts:0,sourcePts:1},{referencePts:1,sourcePts:2},{referencePts:2,sourcePts:3}];
  s.originalTimelineEvidence={kind:'ORIGINAL_EDIT_PROJECT_EXPORT',projectPath:project,projectSha256:hash(await readFile(project)),
    timelinePath:timeline,timelineSha256:hash(await readFile(timeline)),referenceFrameCount:3,recheckedPixelAnchors:3};
  const a=await f.service.prepare(f.request);assert.equal((await ready(f.service,a.assembly.assemblyId)).assembly.status,'READY');
  await writeFile(project,'changed project');
  await assert.rejects(f.service.plan(a.assembly.assemblyId,0,{},f.allowed),/TIMELINE_EVIDENCE_CHANGED/);
});

test('concurrent status polling cannot overwrite a newly completed preparation as interrupted',async t=>{
  const f=await fixture(t),a=await f.service.prepare(f.request),observed=[];
  for(let i=0;i<50;i++) {
    const reads=await Promise.all(Array.from({length:8},()=>f.service.status(a.assembly.assemblyId)));
    observed.push(...reads.map(r=>r.assembly.status));
    await new Promise(r=>setTimeout(r,5));
  }
  assert.ok(!observed.includes('INTERRUPTED'));
  assert.equal((await f.service.status(a.assembly.assemblyId)).assembly.status,'READY');
});

test('official timestamps precede extraction; idempotent prepare and unchanged queue plans',async t=>{
  const f=await fixture(t),a=await f.service.prepare(f.request);
  const saved=JSON.parse(await readFile(a.assembly.manifestPath,'utf8'));
  assert.equal(saved.shots.length,3);
  assert.equal((await f.service.prepare(f.request)).assembly.assemblyId,a.assembly.assemblyId);
  await assert.rejects(f.service.prepare({...f.request,encoder:'NVENC'}),/CONFLICT/);
  assert.equal((await ready(f.service,a.assembly.assemblyId)).assembly.status,'READY');
  const plan=await f.service.plan(a.assembly.assemblyId,0,{projectRevision:'ae-revision:1',projectFingerprint:'a',environmentFingerprint:'b'},f.allowed);
  assert.equal(plan.kind,'AE_TRANSACTION');assert.equal(plan.payload.plan.operations.length,10);
  await f.service.verifyPayload(plan.payload,f.allowed);
  const changed=structuredClone(plan.payload);changed.plan.operations[3].input.payload.timing.inPoint=.5;
  await assert.rejects(f.service.verifyPayload(changed,f.allowed),/PLAN_CHANGED/);
  await assert.rejects(f.service.verifyPayload(plan.payload,{rawPaths:['/foreign.mp4']}),/RAW_SOURCES/);
  f.r.shots[0].sourceStart+=.01;
  await assert.rejects(f.service.verifyPayload(plan.payload,f.allowed),/REPORT_CHANGED/);
});

test('modified sources or clips invalidate the prepared assembly before AE writes',async t=>{
  const f=await fixture(t),a=await f.service.prepare(f.request);await ready(f.service,a.assembly.assemblyId);
  await writeFile(f.r.sources[0].path,'changed-original-source');
  await assert.rejects(f.service.plan(a.assembly.assemblyId,0,{},f.allowed),/SOURCE_CHANGED/);
});

test('modified bounded clips invalidate assembly',async t=>{
  const f=await fixture(t),a=await f.service.prepare(f.request);await ready(f.service,a.assembly.assemblyId);
  await writeFile(path.join(path.dirname(a.assembly.manifestPath),'shot-0.mp4'),'modified-clip');
  await assert.rejects(f.service.plan(a.assembly.assemblyId,0,{},f.allowed),/CLIP_CHANGED/);
});
