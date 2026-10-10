import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PracticePanelServerV1 } from "../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js";

const token = "empty-workflow-ui-test-token-0123456789abcdef";
const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };
test("Practice and Pro Creation retain input UI and empty sessions without any AE or production execution", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-empty-ui-"));
  let aeCalls = 0;
  const broker = new Proxy({ panelSession: null }, { get(target, key) {
    if (key in target) return target[key];
    return () => { aeCalls++; throw new Error("Session UI must never contact AE"); };
  } });
  const raw = path.join(root, "raw.mp4"), audio = path.join(root, "song.wav");
  await writeFile(raw, "unanalysed raw fixture"); await writeFile(audio, "raw song fixture");
  const registry = path.join(root, "edit-types.json"), oldStore = path.join(root, "gpt-orchestration.json");
  await writeFile(registry, JSON.stringify({schema:"editflow.edit-type-registry.v1", profiles:[{
    editTypeId:"cinematic", title:"Cinematic", gptLearning:{workedExamples:[{steps:["old workflow"]}]}
  }]}));
  await writeFile(oldStore, JSON.stringify({assignments:[{status:"RUNNING",assignmentId:"gpt-assignment:old"}]}));
  const config = { port:0, token, repositoryRoot:process.cwd(), artifactDir:root, learningMemoryFilePath:path.join(root,"memory.json"), editTypeRegistryFilePath:registry, gptOrchestrationFilePath:oldStore, broker,
    practiceSourceMatchOnly:false, practiceSourceAssemblyEnabled:true, productionSupervision:true };
  let service = new PracticePanelServerV1(config);
  let base = "http://127.0.0.1:" + await service.start();
  t.after(async () => { await service.stop(); await rm(root,{recursive:true,force:true}); });
  const get = async route => (await fetch(base+route,{headers})).json();
  const post = async (route, body={}) => fetch(base+route,{method:"POST",headers,body:JSON.stringify(body)});
  assert.equal((await fetch(base+"/v1/product/status")).status,401);
  const status = await get("/v1/product/status");
  assert.deepEqual(status.availableWorkflows,[]); assert.equal(status.activeRunId,null);
  assert.equal(status.primaryWorkflow,null); assert.equal(status.productionSupervisor,null);
  const presets=await get("/v1/product/edit-types");
  assert.equal(presets.editTypes[0].title,"Cinematic");
  assert.deepEqual(presets.editTypes[0].gptLearning.workedExamples,[]);
  assert.equal((await post("/v1/product/edit-types",{editTypeId:"new",title:"New Edit"})).status,201);
  const input={editTypeId:"cinematic",finishPath:raw,videoPaths:[raw],audioPaths:[audio]};
  let started=await post("/v1/product/practice",input); assert.equal(started.status,202);
  const run=(await started.json()).run;
  assert.equal(run.state,"SESSION_READY"); assert.equal(run.workflow,null); assert.deepEqual(run.steps,[]);
  assert.deepEqual(run.videoPaths,[raw]); assert.deepEqual(run.audioPaths,[audio]); assert.equal(run.finishPath,raw);
  assert.equal((await post("/v1/product/pro-creation",input)).status,409);
  assert.equal((await get("/v1/product/gpt/assignments/next")).assignment,null);
  assert.equal((await get("/v1/product/practice/resume-or-start")).nextOperation,"NONE");
  for(const route of ["/v1/product/source-match","/v1/product/production/supervision",
    "/v1/product/gpt/assignments/old/claim","/v1/product/gpt/assignments/old/production-jobs",
    "/v1/product/gpt/assignments/old/events","/v1/product/gpt/assignments/old/practice-notebook",
    "/v1/product/control/run-batch"]) assert.equal((await post(route,{action:"SUBMIT"})).status,410,route);
  await service.stop(); service=new PracticePanelServerV1(config); base="http://127.0.0.1:"+await service.start();
  assert.equal((await get("/v1/product/status")).activeRunId,run.sessionId);
  const restored=(await get("/v1/product/runs/"+encodeURIComponent(run.sessionId))).run;
  assert.equal(restored.state,"SESSION_READY"); assert.deepEqual(restored.steps,[]);
  assert.equal((await post("/v1/product/runs/"+encodeURIComponent(run.sessionId)+"/cancel")).status,200);
  const pro=(await (await post("/v1/product/pro-creation",input)).json()).run;
  assert.equal(pro.state,"SESSION_READY"); assert.equal(pro.finishPath,null); assert.deepEqual(pro.steps,[]);
  assert.equal(aeCalls,0);
  assert.equal(await readFile(raw,"utf8"),"unanalysed raw fixture");
  assert.equal((await get("/v1/product/status")).workflowConfigured,false);
});
