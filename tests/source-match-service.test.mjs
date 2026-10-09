import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { SourceMatchServiceV1 } from "../.tmp/runtime/apps/desktop-host/src/source-match-service.js";

async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),"source-match-test-"));
  await mkdir(path.join(root,"scripts","source-match"),{recursive:true});
  await writeFile(path.join(root,"scripts","source-match","engine.py"),`
import sys,json,time
from pathlib import Path
out=Path(sys.argv[sys.argv.index('--output')+1])
for i in range(30):
 if (out/'cancel').exists():break
 time.sleep(.01)
temp=out/'report.tmp'
temp.write_text(json.dumps({'status':'CANCELLED' if (out/'cancel').exists() else 'COMPLETE','shots':[], 'backend':sys.argv[sys.argv.index('--backend')+1], 'device':sys.argv[sys.argv.index('--device')+1]}))
temp.replace(out/'report.json')
`);
  const ref=path.join(root,"ref.mp4"),source=path.join(root,"source.mp4"),model=path.join(root,"model.pt");
  for(const p of [ref,source,model]) await writeFile(p,"fixture");
  const python=execFileSync(process.platform==="win32"?"py":"python3",["-c","import sys;print(sys.executable)"],{encoding:"utf8"}).trim();
  const config={repositoryRoot:root,artifactDir:path.join(root,"jobs"),cacheDir:path.join(root,"cache"),configPath:path.join(root,"missing.json"),runtime:{python,model,backend:"diagnostic"}};
  const service=new SourceMatchServiceV1(config);
  t.after(async()=>{ await service.stop();await rm(root,{recursive:true,force:true}); });
  return {service,config,request:{requestId:"same-request",referencePath:ref,sourcePaths:[source],budgetSeconds:10},root};
}
async function finished(service,id) {
  for(let n=0;n<100;n++) {
    const r=await service.status(id);
    if(r.job.status!=="RUNNING")return r;
    await new Promise(r=>setTimeout(r,20));
  }
  throw Error("Fixture did not finish");
}

test("source match is idempotent, bounded and retains completed evidence",async t=>{
  const {service,request}=await fixture(t);
  const a=await service.submit(request);
  const b=await service.submit(request);
  assert.equal(a.job.jobId,b.job.jobId);
  await assert.rejects(service.submit({...request,requestId:"another"}),/BUSY/);
  await assert.rejects(service.submit({...request,budgetSeconds:11}),/CONFLICT/);
  const result=await finished(service,a.job.jobId);
  assert.equal(result.job.status,"COMPLETE");assert.equal(result.report.status,"COMPLETE");
  assert.equal((await service.submit(request)).job.jobId,a.job.jobId);
});

test("cancellation preserves the job and never alters production state",async t=>{
  const {service,request}=await fixture(t);
  const a=await service.submit(request);
  assert.equal((await service.cancel(a.job.jobId)).cancellationRequested,true);
  const result=await finished(service,a.job.jobId);
  assert.equal(result.job.status,"CANCELLED",JSON.stringify(result.job));
});

test("reject invalid IDs, incomplete requests and executable/backend overrides",async t=>{
  const {service,request}=await fixture(t);
  await assert.rejects(service.status("../../elsewhere"),/Invalid/);
  await assert.rejects(service.submit({...request,requestId:"../escape"}),/requestId/);
  await assert.rejects(service.submit({...request,budgetSeconds:NaN}),/budgetSeconds/);
  await assert.rejects(service.submit({...request,sourcePaths:[]}),/sourcePaths/);
  await assert.rejects(service.submit({...request,shots:[{start:1,end:0}]}),/shots/);
  const submitted=await service.submit({...request,python:"untrusted-executable",backend:"untrusted-backend",device:"untrusted-device"});
  const result=await finished(service,submitted.job.jobId);
  assert.equal(result.job.status,"COMPLETE");
  assert.equal(result.report.backend,"diagnostic");assert.equal(result.report.device,"cpu");
});

test("interrupted receipts survive service restart without replay",async t=>{
  const {service,config,root}=await fixture(t);
  const id="source-match-00000000-0000-0000-0000-000000000000";
  await mkdir(path.join(root,"jobs",id),{recursive:true});
  await writeFile(path.join(root,"jobs",id,"job.json"),JSON.stringify({jobId:id,status:"RUNNING"}));
  const restarted=new SourceMatchServiceV1(config);
  assert.equal((await restarted.status(id)).job.status,"INTERRUPTED");
  assert.equal((await service.status()).activeJobId,null);
});

test("corroborated movie origin remains separate from unresolved exact trims",async t=>{
  const {service,request}=await fixture(t);const initial=await service.submit(request);
  const prior=await finished(service,initial.job.jobId);
  const origin={status:'CONFIRMED',scope:'MOVIE_SECTION_ORIGIN_ONLY',independentFrameCount:6,gradientPassCount:5,temporalChangePassCount:2,evidencePath:'proof.json',frames:[{large:'full evidence'}]};
  await writeFile(path.join(prior.job.outputDir,'report.json'),JSON.stringify({status:'PARTIAL',shots:[{shotId:'shot-001',status:'LOCATED'}],originVerifications:{'shot-001':origin}}));
  const result=await service.status(initial.job.jobId);
  assert.equal(result.nextAction,'REFINE_OR_INSPECT_UNRESOLVED_SHOTS');
  assert.equal(result.remaining[0].status,'LOCATED');
  assert.equal(result.remaining[0].originVerification.status,'CONFIRMED');
  assert.equal(result.remaining[0].originVerification.frames,undefined);
  assert.doesNotMatch(result.remaining[0].requiredEvidence,/original.project/i);
});

test("refinement retains its parent, targets, evidence and assignment across restart",async t=>{
  const {service,config,request}=await fixture(t);
  const assignmentId="gpt-assignment:00000000-0000-0000-0000-000000000001";
  const initial=await service.submit({...request,assignmentId});
  const prior=await finished(service,initial.job.jobId);
  const report={status:"PARTIAL",reference:{path:request.referencePath},sources:[{path:request.sourcePaths[0],duration:20}],
    shots:[{shotId:"shot-001",status:"VERIFIED",referenceStart:0,referenceEnd:1,anchors:[{sourceEvidencePath:"retained.jpg"}]},
      {shotId:"shot-002",status:"LOCATED",referenceStart:1,referenceEnd:2}]};
  await writeFile(path.join(prior.job.outputDir,"report.json"),JSON.stringify(report));
  await writeFile(path.join(prior.job.outputDir,"job.json"),JSON.stringify({...prior.job,status:"PARTIAL"}));
  const body={requestId:"refine-one",jobId:prior.job.jobId,windows:[{shotId:"shot-002",sourceIndex:0,start:10,end:12}],budgetSeconds:10};
  const refined=await service.refine(body);
  assert.equal(refined.job.parentJobId,prior.job.jobId);
  assert.equal(refined.job.assignmentId,assignmentId);
  assert.equal((await service.refine(body)).job.jobId,refined.job.jobId);
  const retained=await readFile(path.join(refined.job.outputDir,"resume-report.json"));
  assert.deepEqual(JSON.parse(retained),report);
  const stored=JSON.parse(await readFile(path.join(refined.job.outputDir,"request.json"),"utf8"));
  assert.deepEqual(stored.refinement.shotIds,["shot-002"]);
  assert.equal(stored.refinement.reportSha256,createHash("sha256").update(retained).digest("hex"));
  await finished(service,refined.job.jobId);
  assert.deepEqual(JSON.parse(await readFile(path.join(prior.job.outputDir,"report.json"),"utf8")),report);
  const resumed=await new SourceMatchServiceV1(config).forAssignment(assignmentId);
  assert.equal(resumed.job.jobId,refined.job.jobId);
});

test("refinement rejects unknown shots, windows and changed idempotent requests",async t=>{
  const {service,request}=await fixture(t);
  const initial=await service.submit(request);const prior=await finished(service,initial.job.jobId);
  await writeFile(path.join(prior.job.outputDir,"report.json"),JSON.stringify({status:"PARTIAL",reference:{path:request.referencePath},sources:[{duration:20}],shots:[{shotId:"shot-001",status:"LOCATED",referenceStart:0,referenceEnd:1}]}));
  const body={requestId:"refine-one",jobId:prior.job.jobId,budgetSeconds:10};
  await assert.rejects(service.refine({...body,shotIds:["missing"]}),/SHOT_IDS/);
  await assert.rejects(service.refine({...body,windows:[{shotId:"shot-001",sourceIndex:0,start:19,end:21}]}),/WINDOWS/);
  await assert.rejects(service.refine({...body,windows:[{shotId:"shot-001",sourceIndex:0,start:10,end:10}]}),/WINDOWS/);
  await service.refine(body);
  await assert.rejects(service.refine({...body,budgetSeconds:11}),/CONFLICT/);
});

test("timeline import snapshots its parent, binds export bytes and retains assignment without replay",async t=>{
  const f=await fixture(t);
  await writeFile(path.join(f.root,'scripts','source-match','timeline_evidence.py'),`
import json,sys
from pathlib import Path
out=Path(sys.argv[sys.argv.index('--output')+1]);r=json.loads((out/'resume-report.json').read_text())
r['status']='COMPLETE';(out/'report.json').write_text(json.dumps(r))
`);
  const assignmentId='gpt-assignment:00000000-0000-0000-0000-000000000001';
  const a=await f.service.submit({...f.request,assignmentId});const prior=await finished(f.service,a.job.jobId);
  const parent={status:'PARTIAL',reference:{path:f.request.referencePath},shots:[{shotId:'shot-001',status:'LOCATED',referenceStart:0,referenceEnd:1}],sources:[]};
  await writeFile(path.join(prior.job.outputDir,'report.json'),JSON.stringify(parent));
  const timelinePath=path.join(f.root,'timeline.json');await writeFile(timelinePath,'{}');
  const request={requestId:'timeline-import',jobId:a.job.jobId,timelinePath,budgetSeconds:10};
  const imported=await f.service.importTimeline(request);await finished(f.service,imported.job.jobId);
  assert.equal(imported.job.parentJobId,a.job.jobId);assert.equal(imported.job.assignmentId,assignmentId);
  assert.deepEqual(JSON.parse(await readFile(path.join(imported.job.outputDir,'resume-report.json'),'utf8')),parent);
  assert.equal((await f.service.importTimeline(request)).job.jobId,imported.job.jobId);
  await writeFile(timelinePath,'changed export');await assert.rejects(f.service.importTimeline(request),/CONFLICT/);
  assert.deepEqual(JSON.parse(await readFile(path.join(prior.job.outputDir,'report.json'),'utf8')),parent);
});
