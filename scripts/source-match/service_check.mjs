// Exercise the actual service processes and saved official handoff end to end.
// Review the retained pixels before running; this fixture is never an assignment.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import {SourceMatchServiceV1} from '../../.tmp/runtime/apps/desktop-host/src/source-match-service.js';
import {SourceMatchAssemblyV1} from '../../.tmp/runtime/apps/desktop-host/src/source-match-assembly.js';
const [fixtureFile,configFile]=process.argv.slice(2);
if(!fixtureFile||!configFile)throw Error('Usage: node service_check.mjs <reviewed-fixture.json> <runtime-config.json>');
const fixture=JSON.parse(await readFile(fixtureFile,'utf8')),runtime=JSON.parse(await readFile(configFile,'utf8'));
const root=path.dirname(path.resolve(fixtureFile));
const native=process.argv.includes('--native-handoff');
const matchRoot=native?path.join(process.env.LOCALAPPDATA,'EditFlow2'):root;
const config={repositoryRoot:process.cwd(),artifactDir:path.join(matchRoot,native?'source-match-jobs':'jobs'),cacheDir:path.join(root,'cache'),configPath:configFile,runtime};
const service=new SourceMatchServiceV1(config),assembler=new SourceMatchAssemblyV1(config,service);
const started=performance.now();
async function wait(read,done){for(let n=0;n<2400;n++){const r=await read();if(done(r))return r;await new Promise(r=>setTimeout(r,250));}throw Error('Handoff check timed out');}
try{
  const submitted=await service.submit({...fixture,requestId:'known-original-edit',budgetSeconds:480,candidateLimit:4});
  const parent=await wait(()=>service.status(submitted.job.jobId),r=>r.job.status!=='RUNNING');
  assert.equal(parent.job.status,'PARTIAL',JSON.stringify(parent.job));
  assert.equal(parent.report.shots.at(-1).status,'LOCATED');
  assert.equal(parent.report.shots.filter(s=>s.status==='VERIFIED').length,fixture.shots.length-1);
  const imported=await service.importTimeline({requestId:'original-project-evidence',jobId:parent.job.jobId,timelinePath:fixture.timelinePath,budgetSeconds:90});
  const complete=await wait(()=>service.status(imported.job.jobId),r=>r.job.status!=='RUNNING');
  assert.equal(complete.job.status,'COMPLETE',JSON.stringify(complete.job));
  complete.report.shots.forEach((s,i)=>{assert.equal(s.sourceStart,fixture.expected[i].start);assert.equal(s.sourceEndExclusive,fixture.expected[i].end);});
  assert.deepEqual((await service.status(parent.job.jobId)).report,parent.report);
  const handoffStarted=performance.now();
  const prepared=await assembler.prepare({requestId:'official-fixture-handoff',jobId:complete.job.jobId,encoder:'CPU',
    output:{stableId:'ef-live-lab-source-assembly',name:'Known original source assembly',width:320,height:240,pixelAspect:1,frameRate:12},
    review:{authority:'CHATGPT_DIRECT',decisionId:'known-original-frame-fixture-review',rationale:fixture.scope,
      shots:complete.report.shots.map(s=>({shotId:s.shotId,verdict:'PASS',observation:'Known original-frame fixture, reviewed pictures and exact measured/project frame map agree.',evidenceRefs:s.anchors.map(a=>a.sourceEvidencePath??a.sourcePath).filter(Boolean).concat([fixtureFile])}))}});
  let resumeChecked=false;
  if(process.argv.includes('--exercise-resume')) {
    const saved=await readFile(prepared.assembly.manifestPath);
    const dir=path.dirname(prepared.assembly.manifestPath);
    for(let n=0;n<2000;n++) {
      const names=await readdir(dir);
      if(names.some(name=>name.endsWith('.receipt.json')))break;
      assert.equal((await assembler.status(prepared.assembly.assemblyId)).assembly.status,'PREPARING');
      await new Promise(r=>setTimeout(r,20));
    }
    assert.equal((await assembler.cancel(prepared.assembly.assemblyId)).cancellationRequested,true);
    const cancelled=await wait(()=>assembler.status(prepared.assembly.assemblyId),r=>r.assembly.status!=='PREPARING');
    assert.equal(cancelled.assembly.status,'CANCELLED');
    await assembler.resume(prepared.assembly.assemblyId);resumeChecked=true;
    assert.deepEqual(await readFile(prepared.assembly.manifestPath),saved);
  }
  const ready=await wait(()=>assembler.status(prepared.assembly.assemblyId),r=>r.assembly.status!=='PREPARING');
  assert.equal(ready.assembly.status,'READY',JSON.stringify(ready.assembly));
  if(resumeChecked)assert.ok(ready.assembly.reusedVerifiedClips>=1);
  const manifest=JSON.parse(await readFile(ready.assembly.manifestPath,'utf8'));
  assert.equal(manifest.shots.length,fixture.shots.length);
  const baseline={projectRevision:'fixture:1',projectFingerprint:'fixture',environmentFingerprint:'fixture'};
  const allowed={rawPaths:fixture.sourcePaths,referencePath:fixture.referencePath};
  const plan=await assembler.plan(ready.assembly.assemblyId,0,baseline,allowed);
  await assembler.verifyPayload(plan.payload,allowed);
  const timings=plan.payload.plan.operations.filter(o=>o.input.command==='layer.set_timing').map(o=>o.input.payload.timing);
  timings.forEach((t,i)=>{assert.equal(t.inPoint,i*2);assert.equal(t.outPoint,(i+1)*2);});
  // Retain the exact service output for the real native-queue lab; no re-created
  // official timestamp table or decoder benchmark is substituted for this plan.
  const media=JSON.parse(await readFile(path.join(path.dirname(ready.assembly.manifestPath),'materialized.json'),'utf8'));
  await mkdir(path.join(root,'native'),{recursive:true});
  await writeFile(path.join(root,'assembly-fixture.json'),JSON.stringify({assemblyId:ready.assembly.assemblyId,manifest,media},null,2));
  const result={ok:true,engine:complete.report.engine,scope:fixture.scope,shotCount:fixture.shots.length,
    parentJobId:parent.job.jobId,completeJobId:complete.job.jobId,assemblyId:ready.assembly.assemblyId,
    officialToReadySeconds:(performance.now()-handoffStarted)/1000,totalSeconds:(performance.now()-started)/1000,
    operations:plan.payload.plan.operations.length,resumeChecked,reusedVerifiedClips:ready.assembly.reusedVerifiedClips,
    checks:{originalHiddenTrimEvidence:true,parentImmutable:true,
      actualWorkerExtraction:true,finishedOrder:true,exactKnownRanges:true,officialPlanIntegrity:true},nativeAeExecuted:false};
  await writeFile(path.join(root,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await assembler.stop();await service.stop();}
