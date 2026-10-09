import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {officialSourceTimestampsV1,sourceAssemblyCommandsV1,SourceMatchAssemblyV1} from '../.tmp/runtime/apps/desktop-host/src/source-match-assembly.js';

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
