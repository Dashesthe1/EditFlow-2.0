import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseProductionWorkflowPlanV1, parseProductionMethodV1, validateMethodApplicationV1, validateWorkflowJobV1,
  PracticeProductionCoordinatorV1, PracticeProductionCoordinatorFileV1, practiceTelemetrySpanV1, parsePracticeWorkedExampleV1,
  GptOrchestrationStoreV1, PRIMARY_PRODUCTION_WORKFLOW_V1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { PracticePanelServerV1 } from "../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js";
import { STUDIED_PRODUCTION_METHODS_V1 } from "../.tmp/runtime/packages/practice-homework/src/studied-methods.js";
import { ChatgptAeRenderDriverV1 } from "../.tmp/runtime/apps/desktop-host/src/chatgpt-ae-render-driver.js";

const choice = (id) => ({ authority:"CHATGPT_DIRECT",decisionId:id,rationale:"GPT chose the inspected action and timing",evidenceRefs:["inspected:raw"] });
const plan = () => ({ ...choice("workflow:1"), mode:"REPEAT_PRODUCTION",scope:"14s prepared two-shot velocity",
  output:{width:1080,height:1450,fps:60,durationMs:14000},passOrder:["structure","motion","finish"],
  sources:[{clipId:"shot:1",mediaId:"raw",fingerprint:"sha:raw",fps:50,startMs:1000,endMs:6000,availableStartMs:500,availableEndMs:7000,
    actionAnchors:[{id:"kick",sourceMs:3200,observation:"Ball contact"}]}],audio:{mediaId:"music",songOffsetMs:800,policy:"provided raw song preserved"},
  anchors:[{id:"impact",role:"action",outputMs:4000,rationale:"Kick on chosen accent"}],
  events:[{id:"phrase",clipIds:["shot:1"],anchorIds:["impact"],treatment:"Repeated velocity and 2D parent path",acceptedDimensions:[],unresolvedIssues:["Preview retiming"]}],
  finishing:["Native grade below editable text"],nextAction:"Build explicit whole structure" });
const method = () => ({schema:"editflow.production-method.v1",family:"Repeated velocity",
  sourceBindings:[{id:"source",mediaId:"raw",fingerprint:"sha:raw",fps:50,availableStartMs:500,availableEndMs:7000,
    traversal:[{outputMs:0,sourceMs:1000},{outputMs:4000,sourceMs:3200},{outputMs:7000,sourceMs:5000}]}],
  containers:[{id:"shot",width:1080,height:1450,fps:60,timeOriginMs:0,space:"2D",parentId:"null"},
    {id:"null",width:1080,height:1450,fps:60,timeOriginMs:0,space:"2D",parentId:null}],
  anchors:[{id:"impact",outputMs:4000}],
  channels:[{id:"speed",containerId:"shot",property:"Speed %",role:"retime",coordinateSpace:"shot time",
    keys:[{timeMs:3800,anchorId:"impact",value:75,interpolation:{type:"BEZIER",curve:[.52,.01,.99,.56]}},
      {timeMs:4200,anchorId:"impact",value:10,interpolation:{type:"BEZIER",curve:[.15,0,.85,1]}}]}],
  effects:[{id:"twix",containerId:"shot",matchName:"Twixtor Pro",version:"installed-verified-version",order:0,settings:{inputFps:50}}],
  dependencies:[{ownerId:"twix",property:"Color Source",targetId:"source",kind:"EFFECT_SOURCE",check:"Read current binding and inspect kick"}],
  adaptationChecks:["Verify source traversal, crop, handles, binding and curves in playback"],failureSymptoms:["Black image after copy"] });

test("complete method preserves distinct source/master timebases and all curves; invalid topology/traversal rejects", () => {
  const m=method();assert.deepEqual(parseProductionMethodV1(m),m);
  assert.equal(parseProductionMethodV1(m).sourceBindings[0].fps,50);
  const bad=method();bad.sourceBindings[0].traversal[1].sourceMs=9000;assert.throws(()=>parseProductionMethodV1(bad),/exceeds handles/);
  const cycle=method();cycle.containers[1].parentId="shot";assert.throws(()=>parseProductionMethodV1(cycle),/cyclic/);
  const wrong=method();wrong.dependencies[0].targetId="old-source";assert.throws(()=>parseProductionMethodV1(wrong),/Unresolved/);
  const duplicate=method();duplicate.effects.push({...duplicate.effects[0],id:"twix2"});assert.throws(()=>parseProductionMethodV1(duplicate),/stack positions/);
  const auto=method();auto.autoAdapt=true;assert.throws(()=>parseProductionMethodV1(auto),/AUTOMATIC_EDITORIAL/);
  const ambiguous=method();ambiguous.sourceBindings[0].id="shot";assert.throws(()=>parseProductionMethodV1(ambiguous),/method identities/);
});

test("method transfer requires explicit WORKED choice and complete rebinding; wrong copied source cannot pass", () => {
  const original=method(), adapted=JSON.parse(JSON.stringify(original).replaceAll('"source"','"source2"').replaceAll('"shot"','"shot2"').replaceAll('"null"','"null2"').replaceAll('"twix"','"twix2"'));
  const example={lessonId:"worked",outcome:"WORKED",method:original,supersedesLessonIds:[]};
  const app={...choice("copy:1"),lessonId:"worked",bindings:[{fromId:"source",toId:"source2"},{fromId:"shot",toId:"shot2"},{fromId:"null",toId:"null2"},{fromId:"twix",toId:"twix2"}],adaptationChecks:["Read source and local playback"],adaptedMethod:adapted};
  validateMethodApplicationV1([example],[app]);
  assert.throws(()=>validateMethodApplicationV1([{...example,outcome:"UNVERIFIED"}],[app]),/WORKED/);
  assert.throws(()=>validateMethodApplicationV1([example,{lessonId:"new",supersedesLessonIds:["worked"]}],[app]),/WORKED/);
  assert.throws(()=>validateMethodApplicationV1([example],[{...app,bindings:app.bindings.slice(1)}]),/Rebind every/);
  const wrong=structuredClone(app);wrong.adaptedMethod.dependencies[0].targetId="null2";
  assert.throws(()=>validateMethodApplicationV1([example],[wrong]),/not rebound/);
});

test("existing notebook accepts complete method without discarding legacy examples", () => {
  const lesson={authority:"CHATGPT_DIRECT",lessonId:"method:1",title:"Velocity",problem:"Copy source went black",steps:[{action:"Rebind Color Source",settings:{source:"source"},reason:"Old reference",check:"Read binding and play"}],
    outcome:"WORKED",observation:"Playback restores the action",explanation:"Correct dependency",whenToUse:["GPT-chosen velocity"],adaptation:["New fps and source handles"],mistakesToAvoid:["Blind layer-index copy"],evidenceRefs:["render:1"],method:method()};
  assert.deepEqual(parsePracticeWorkedExampleV1("preset","session",lesson).method,method());
  const old={...lesson};delete old.method;assert.equal(parsePracticeWorkedExampleV1("preset","session",old).method,undefined);
});

test("workflow history resumes unchanged, keeps GPT-chosen pass order, scopes jobs and does not infer review", async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),"workflow-resume-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const c=new PracticeProductionCoordinatorV1("session",["shot:1"]),file=new PracticeProductionCoordinatorFileV1(path.join(dir,"production.json"));
  c.retainWorkflowPlan(plan());c.retainWorkflowPlan(plan());assert.equal(c.snapshot().workflow.plans.length,1);
  assert.throws(()=>c.retainWorkflowPlan({...plan(),nextAction:"Changed without new decision"}),/DECISION_CHANGED/);
  const next={...plan(),decisionId:"workflow:2",passOrder:["critical intro prototype","structure","finish"]};c.retainWorkflowPlan(next);
  await file.save(c);const restored=await file.load();assert.deepEqual(restored.snapshot().workflow,c.snapshot().workflow);
  assert.equal(restored.snapshot().wholeEditCovered,false);assert.deepEqual(restored.snapshot().workflow.reviews,[]);
  const selected=c.snapshot().workflow.plans[1],payload={workflowContext:{workflowId:PRIMARY_PRODUCTION_WORKFLOW_V1,planDecisionId:"workflow:2",planHash:selected.hash,eventIds:["phrase"]},researchContext:{plans:[{clipId:"shot:1"}]}};
  validateWorkflowJobV1(c.snapshot().workflow,payload);
  validateWorkflowJobV1(c.snapshot().workflow,{});
  validateWorkflowJobV1(c.snapshot().workflow,{workflowContext:{workflowId:PRIMARY_PRODUCTION_WORKFLOW_V1,phase:"DIRECT"}});
  validateWorkflowJobV1(c.snapshot().workflow,{}, {acceptedReceipt:true,acceptedLegacyReceipt:true});
  const previous={...payload,workflowContext:{...payload.workflowContext,planDecisionId:"workflow:1",planHash:c.snapshot().workflow.plans[0].hash}};
  assert.throws(()=>validateWorkflowJobV1(c.snapshot().workflow,previous),/SUPERSEDED/);
  validateWorkflowJobV1(c.snapshot().workflow,previous,{acceptedReceipt:true});
  assert.throws(()=>validateWorkflowJobV1(c.snapshot().workflow,{...payload,researchContext:{plans:[{clipId:"other"}]}}),/event scope/);
  assert.throws(()=>validateWorkflowJobV1(c.snapshot().workflow,{...payload,workflowContext:{...payload.workflowContext,planHash:"stale"}}),/MISMATCH/);
  assert.throws(()=>parseProductionWorkflowPlanV1({...plan(),authority:"MACHINE"}),/CHATGPT_DIRECT/);
});

test("only the primary workflow admits new jobs; preparation cannot authorize production or client legacy flags", () => {
  const state={plans:[],activeDecisionId:null,reviews:[],milestones:[]};
  const preparation={workflowContext:{workflowId:PRIMARY_PRODUCTION_WORKFLOW_V1,phase:"PREPARATION"}};
  validateWorkflowJobV1(state,preparation,{kind:"REFERENCE_ANALYSIS"});
  for(const kind of ["AE_BATCH","AE_TRANSACTION","PROOF_SCRIPT","LOCAL_RENDER","SAVE_CHECKPOINT"]) {
    assert.throws(()=>validateWorkflowJobV1(state,preparation,{kind}),/PREPARATION_ONLY/);
    assert.throws(()=>validateWorkflowJobV1(state,{legacy:true,acceptedLegacyReceipt:true},{kind}),/PRIMARY_WORKFLOW_REQUIRED/);
  }
  assert.throws(()=>validateWorkflowJobV1(state,{workflowContext:{workflowId:"OLD_WORKFLOW",phase:"PREPARATION"}},
    {kind:"REFERENCE_ANALYSIS",acceptedLegacyReceipt:true}),/PRIMARY_WORKFLOW_REQUIRED/);
});

test("telemetry separates active/wait/idle, unions overlaps, retains learning/export, leaves unknown gaps unattributed", async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),"workflow-time-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=new PracticeProductionCoordinatorFileV1(path.join(dir,"state.json"));
  const span=(id,start,end,activity,purpose)=>practiceTelemetrySpanV1({spanId:id,sessionId:"s",category:"GPT_REVIEW",stage:"LOCAL_PROOF",startedAtMs:start,endedAtMs:end,activity,purpose});
  const a=span("a",1000,4000,"ACTIVE","LEARNING");await file.appendTelemetry(a);await file.appendTelemetry(a);
  await file.appendTelemetry(span("b",2000,5000,"ACTIVE","PRODUCTION"));
  await file.appendTelemetry(span("c",5000,7000,"MACHINE_WAIT","EXPORT"));await file.appendTelemetry(span("d",7000,8000,"IDLE","REVIEW"));
  const summary=await file.telemetrySummary(1000,10000);
  assert.equal(summary.activeWallClockMs,4000);assert.equal(summary.machineWaitWallClockMs,2000);assert.equal(summary.idleWallClockMs,1000);
  assert.equal(summary.observedWallClockMs,7000);assert.equal(summary.unattributedMs,2000);assert.equal(summary.wallClockElapsedMs,9000);
  assert.equal(summary.byPurpose.LEARNING,3000);assert.equal(summary.byPurpose.EXPORT,2000);assert.equal(summary.spanCount,4);
  assert.throws(()=>span("bad",10,5,"ACTIVE","REVIEW"),/interval/);
});

test("studied methods cover all six recordings and remain UNVERIFIED without automatic application", () => {
  assert.equal(new Set(STUDIED_PRODUCTION_METHODS_V1.map(m=>m.source)).size,6);
  assert.ok(STUDIED_PRODUCTION_METHODS_V1.every(m=>m.outcome==="UNVERIFIED" && m.automaticApplication===false));
});

test("local draft preview uses an unpatched isolated copy; full review uses canonical picture", async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),"workflow-preview-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const driver=new ChatgptAeRenderDriverV1({transport:{dispatch(){throw Error("unexpected transport")}},projectId:"p",artifactDir:dir}),calls=[];
  driver.client.observe=async()=>({hostRevision:1,observed:{projectFingerprint:"stable",environmentFingerprint:"env"}});
  driver.client.executePublicAtKnownHostRevision=async(command,request)=>{
    calls.push(request.payload);const completionPath=path.join(dir,"completion.json");
    await writeFile(request.payload.outputPath,"render bytes");await writeFile(completionPath,JSON.stringify({schemaVersion:1,jobId:"job",status:"DONE",ok:true,outputPath:request.payload.outputPath,error:null,queueItemRemoved:true}));
    return {outcome:"APPLIED",readback:{jobId:"job",completionPath}};
  };
  const input={sessionId:"s",attempt:0,compStableId:"canonical",windowId:"cut",startMs:3500,endMs:4500};
  await driver.renderWindow({...input,resolutionScale:.25});await driver.renderWindow(input);
  assert.equal(calls[0].resolutionFactor,4);assert.deepEqual(calls[0].scratchCandidate.patches,[]);assert.equal(calls[0].timeSpanStart,3.5);assert.equal(calls[0].timeSpanDuration,1);
  assert.equal(calls[1].scratchCandidate,undefined);assert.equal(calls[1].resolutionFactor,undefined);
  await assert.rejects(driver.renderWindow({...input,resolutionScale:.5}),/Unsupported/);
});

test("HTTP workflow uses existing controller/coordinator, rejects outside media, survives restart and cannot mutate AE", async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),"workflow-http-")),token="workflow-test-token-0123456789abcdef",broker=new LoopbackCepBroker({port:0,token});await broker.start();
  const config={port:0,token,broker,repositoryRoot:process.cwd(),artifactDir:path.join(root,"artifacts"),learningMemoryFilePath:path.join(root,"memory.json"),editTypeRegistryFilePath:path.join(root,"types.json"),gptOrchestrationFilePath:path.join(root,"gpt.json"),productionSupervision:false};
  const store=new GptOrchestrationStoreV1(config.gptOrchestrationFilePath);
  const assignment=await store.createAssignment({sessionId:"s",mode:"PRO_CREATION",editTypeId:"preset",artifactDir:root,knowledge:null,finish:null,start:[{mediaId:"raw",role:"START_SOURCE",mediaKind:"VIDEO",uri:"raw.mp4"},{mediaId:"music",role:"START_SOURCE",mediaKind:"AUDIO",uri:"music.wav"}]});
  await store.claim(assignment.assignmentId,"controller");let service=new PracticePanelServerV1(config);await service.start();
  t.after(async()=>{await service.stop();await broker.stop();await rm(root,{recursive:true,force:true});});
  const headers={"X-EditFlow-Token":token,"Content-Type":"application/json"};
  const request=(route,body)=>fetch(`http://127.0.0.1:${service.port}${route}`,{headers,...(body?{method:"POST",body:JSON.stringify(body)}:{})});
  const contract=await (await request("/v1/product/gpt/production-workflow-contract")).json();assert.equal(contract.automaticDecisions,false);assert.equal(contract.studiedMethods.length,10);
  assert.equal(contract.exclusive,true);assert.deepEqual(contract.modes,["PRACTICE","PRO_CREATION"]);
  assert.deepEqual(contract.availableWorkflows,[PRIMARY_PRODUCTION_WORKFLOW_V1]);assert.equal(contract.workflowFallback,false);
  const route=`/v1/product/gpt/assignments/${encodeURIComponent(assignment.assignmentId)}/production`;
  assert.equal((await request(route,{action:"WORKFLOW_PLAN",claimedBy:"other",plan:plan()})).status,409);
  const bad=plan();bad.sources[0].mediaId="finished";assert.equal((await request(route,{action:"WORKFLOW_PLAN",claimedBy:"controller",plan:bad})).status,400);
  const response=await request(route,{action:"WORKFLOW_PLAN",claimedBy:"controller",plan:plan()});assert.equal(response.status,200);assert.equal((await response.json()).production.workflow.plans.length,1);
  await service.stop();service=new PracticePanelServerV1(config);await service.start();
  const resumed=await (await request(route)).json();assert.equal(resumed.production.workflow.activeDecisionId,"workflow:1");assert.equal(resumed.nextAction.kind,"CHATGPT_DECIDES");assert.equal(resumed.production.wholeEditCovered,false);
  assert.match((await store.getAssignment(assignment.assignmentId)).chatMessage,/CHATGPT_PRODUCTION_WORKFLOW_V1/);
});

for(const mode of ["PRACTICE","PRO_CREATION"]) test(`${mode} starts and resumes with one mandatory workflow and refuses alternate new jobs`, async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),"exclusive-workflow-")),token="sole-workflow-token-0123456789abcdef";
  const broker=new LoopbackCepBroker({port:0,token});await broker.start();
  const store=new GptOrchestrationStoreV1(path.join(root,"gpt.json"));
  const assignment=await store.createAssignment({sessionId:`exclusive:${mode}`,mode,editTypeId:"preset",artifactDir:root,knowledge:null,
    finish:mode==="PRACTICE"?{mediaId:"finish",role:"FINISH_REFERENCE",mediaKind:"VIDEO",uri:"finish.mp4"}:null,
    start:[{mediaId:"raw",role:"START_SOURCE",mediaKind:"VIDEO",uri:"raw.mp4"}]});
  assert.equal(assignment.primaryWorkflow,PRIMARY_PRODUCTION_WORKFLOW_V1);await store.claim(assignment.assignmentId,"controller");
  const service=new PracticePanelServerV1({port:0,token,broker,productionSupervision:false,repositoryRoot:process.cwd(),artifactDir:root,
    learningMemoryFilePath:path.join(root,"memory.json"),editTypeRegistryFilePath:path.join(root,"types.json"),gptOrchestrationFilePath:store.filePath});
  await service.start();t.after(async()=>{await service.stop();await broker.stop();await rm(root,{recursive:true,force:true});});
  const headers={"X-EditFlow-Token":token,"Content-Type":"application/json"};
  const call=(route,body)=>fetch(`http://127.0.0.1:${service.port}/v1/product/${route}`,{headers,...(body?{method:"POST",body:JSON.stringify(body)}:{})});
  for(const route of ["status","practice/resume-or-start","gpt/assignments/next",`gpt/assignments/${encodeURIComponent(assignment.assignmentId)}`]) {
    const response=await call(route);assert.equal(response.status,200,route);const body=await response.json();
    assert.equal(body.primaryWorkflow,PRIMARY_PRODUCTION_WORKFLOW_V1,route);assert.deepEqual(body.availableWorkflows,[PRIMARY_PRODUCTION_WORKFLOW_V1]);
    assert.equal(body.workflowSelectionAllowed,false);assert.equal(body.workflowFallback,false);
  }
  const jobs=`gpt/assignments/${encodeURIComponent(assignment.assignmentId)}/production-jobs`;
  for(const workflowContext of [{workflowId:"OLD_WORKFLOW"},{workflowId:PRIMARY_PRODUCTION_WORKFLOW_V1,phase:"PREPARATION"}]) {
    const response=await call(jobs,{kind:"AE_BATCH",payload:{legacy:true,acceptedLegacyReceipt:true,workflowContext,
      researchContext:{assignmentId:assignment.assignmentId,claimedBy:"controller",plans:[]}}});
    assert.equal(response.status,409);assert.match((await response.json()).error,/PRIMARY_WORKFLOW_REQUIRED|PREPARATION_ONLY/);
  }
  assert.deepEqual((await (await call(jobs)).json()).jobs,[]);
});
