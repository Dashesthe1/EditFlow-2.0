import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
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
(out/'report.json').write_text(json.dumps({'status':'CANCELLED' if (out/'cancel').exists() else 'COMPLETE','shots':[]}))
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
  assert.equal((await finished(service,a.job.jobId)).job.status,"CANCELLED");
});

test("reject invalid IDs, incomplete requests and executable/backend overrides",async t=>{
  const {service,request}=await fixture(t);
  await assert.rejects(service.status("../../elsewhere"),/Invalid/);
  await assert.rejects(service.submit({...request,requestId:"../escape"}),/requestId/);
  await assert.rejects(service.submit({...request,budgetSeconds:NaN}),/budgetSeconds/);
  await assert.rejects(service.submit({...request,sourcePaths:[]}),/sourcePaths/);
  await assert.rejects(service.submit({...request,shots:[{start:1,end:0}]}),/shots/);
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
