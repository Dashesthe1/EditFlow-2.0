import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatgptEditorialDecisionFileV1, editorialPayloadHashV1, validateChatgptEditorialJobV1,
  EditTypeRegistryV1, EditTypeRegistryFileV1, practiceNotebookViewV1, GptOrchestrationStoreV1,
  PracticeProductionWorkerV1, validateChatgptSourceImportsV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";
import { runPracticeScratchSearchV1 } from "../.tmp/runtime/apps/desktop-host/src/practice-scratch-search.js";

const temp = async t => { const dir = await mkdtemp(path.join(os.tmpdir(), "editorial-authority-")); t.after(() => rm(dir, { recursive:true,force:true })); return dir; };
const payload = () => ({ intents: [{kind:"explicit"}], editorialDecision: {authority:"CHATGPT_DIRECT",decisionId:"decision:1",
  rationale:"Directly reviewed the shot and chose these operations.",steps:["Set the chosen keyframes"],evidenceRefs:["actual-pixels:1"]} });
const lesson = (id, outcome="WORKED") => ({authority:"CHATGPT_DIRECT",lessonId:id,title:"Reverse ending",problem:"Match the backward replay",
  steps:[{action:"Set time-remap keys",settings:{timesMs:[800,1000],values:[3,2.8]},reason:"Finish visibly rewinds",check:"Inspect both endpoints and middle"}],
  outcome,observation:"The reviewed render reproduces the backward action",explanation:"Reversing source time preserves the performance",
  whenToUse:["Observed temporal rewind"],adaptation:["Choose the new source-time span"],mistakesToAvoid:["Do not reverse effect animation only"],evidenceRefs:["issued-render:1"]});

test("queue decisions bind exact plans across handoffs and concurrent submissions", async t => {
  const dir=await temp(t), file=new ChatgptEditorialDecisionFileV1(dir), p=payload();
  await assert.rejects(file.retain("a","AE_BATCH",{}),/DECISION_REQUIRED/);
  const saved=await Promise.all(Array.from({length:12},()=>new ChatgptEditorialDecisionFileV1(dir).retain("a","AE_BATCH",p)));
  assert.equal(new Set(saved.map(d=>d.payloadHash)).size,1);
  await new ChatgptEditorialDecisionFileV1(dir).verify("a","AE_BATCH",{...p,editorialDecision:saved[0],researchContext:{claimedBy:"next-worker"}});
  const changed={...p,intents:[{kind:"changed"}]};
  await assert.rejects(file.retain("a","AE_BATCH",changed),/REUSED/);
  await assert.rejects(file.verify("a","AE_BATCH",{...changed,editorialDecision:saved[0]}),/PLAN_CHANGED/);
  assert.equal(editorialPayloadHashV1({a:1,b:2}),editorialPayloadHashV1({b:2,a:1}));
  assert.throws(()=>validateChatgptEditorialJobV1("AE_GOAL",{...p,goal:{kind:"IMPACT_PULSE"}}),/FORMULA_EDITING_RETIRED/);
  assert.throws(()=>validateChatgptEditorialJobV1("BUILD_BASELINE",p),/BASELINE_PLAN_REQUIRED/);
  assert.throws(()=>validateChatgptEditorialJobV1("PROOF_SCRIPT",p),/SCRIPT_REVIEW_REQUIRED/);
  assert.throws(()=>validateChatgptEditorialJobV1("AE_BATCH",{...p,autoCorrect:true}),/AUTOMATIC_EDITORIAL/);
  const policy={mode:"PRACTICE",finishPath:"/media/finish.mp4",rawVideoPaths:["/media/full-raw.mp4"]};
  assert.throws(()=>validateChatgptSourceImportsV1(policy,{plan:{operations:[{input:{command:"media.import",payload:{path:"/media/finish.mp4"}}}]}}),/WORKING_MEDIA_REQUIRED/);
  assert.throws(()=>validateChatgptSourceImportsV1(policy,{command:"media.import",payload:{path:"/media/full-raw.mp4"}}),/WORKING_MEDIA_REQUIRED/);
  validateChatgptSourceImportsV1(policy,{command:"media.import",payload:{path:"/working/selected.mp4"}});
});

test("candidate execution returns every requested alternative in input order without machine selection", async () => {
  const calls=[];
  const result=await runPracticeScratchSearchV1({body:{compStableId:"comp",clipId:"shot",startMs:0,endMs:1000,
    candidates:[{candidateId:"first",patches:[],resolutionScale:.25},{candidateId:"second",patches:[]}]},sessionId:"session",referencePath:"unused",
    signal:new AbortController().signal,media:{analyze(){throw Error("analysis is retired")}},
    renderDriver:{async renderSearchCandidate(p){calls.push(p);return {renderPath:p.candidateId+".mp4",evidenceRefs:[]}}}});
  assert.deepEqual(result.candidates.map(c=>c.candidateId),["first","second"]);
  assert.deepEqual(calls.map(c=>c.resolutionScale),[.25,1]); assert.equal(result.winner,null);
  assert.equal(result.candidates.some(c=>"score" in c),false);
});

test("worked examples extend existing per-preset learning, survive concurrent writes/restart, and expose failures", async t => {
  const dir=await temp(t), file=new EditTypeRegistryFileV1(path.join(dir,"existing-types.json")), registry=new EditTypeRegistryV1();
  registry.create({editTypeId:"chosen",title:"Chosen",choiceWords:["chosen"]}); registry.create({editTypeId:"other",title:"Other",choiceWords:["other"]});
  const original=registry.get("chosen"); registry.register({...original,gptLearning:{...original.gptLearning,successLessons:["Existing lesson"],failureAvoidanceLessons:["Existing mistake"]}});
  await file.save(registry);
  await Promise.all([file.update(r=>r.recordPracticeWorkedExample("chosen","session",lesson("worked"))),
    new EditTypeRegistryFileV1(file.filePath).update(r=>r.recordPracticeWorkedExample("chosen","session",lesson("failed","FAILED")))]);
  const reopened=await file.load(), learning=reopened.knowledge("chosen").gptLearning;
  assert.deepEqual(learning.successLessons,["Existing lesson"]); assert.deepEqual(learning.failureAvoidanceLessons,["Existing mistake"]);
  assert.equal(learning.workedExamples.length,2); assert.deepEqual(reopened.knowledge("other").gptLearning.workedExamples,[]);
  assert.equal(practiceNotebookViewV1("chosen",learning.workedExamples,"time-remap").examples.length,2);
  assert.equal(practiceNotebookViewV1("chosen",learning.workedExamples).failedCount,1);
  assert.deepEqual(learning.workedExamples[0].steps[0].settings,{timesMs:[800,1000],values:[3,2.8]});
  await file.update(r=>r.recordPracticeWorkedExample("chosen","session",lesson("worked")));
  await assert.rejects(file.update(r=>r.recordPracticeWorkedExample("chosen","session",{...lesson("worked"),explanation:"Changed history"})),/immutable/i);
  await file.update(r=>r.recordPracticeWorkedExample("chosen","session",{...lesson("improved"),supersedesLessonIds:["worked"]}));
  const latest=(await file.load()).knowledge("chosen");
  assert.equal(practiceNotebookViewV1("chosen",latest.gptLearning.workedExamples).examples.find(e=>e.lessonId==="worked").superseded,true);
  const store=new GptOrchestrationStoreV1(path.join(dir,"assignments.json"));
  const assignment=await store.createAssignment({sessionId:"next",mode:"PRACTICE",editTypeId:"chosen",artifactDir:dir,
    finish:{mediaId:"finish",role:"FINISH_REFERENCE",mediaKind:"VIDEO",uri:"finish.mp4"},start:[{mediaId:"raw",role:"START_SOURCE",mediaKind:"VIDEO",uri:"raw.mp4"}],knowledge:latest});
  assert.match(assignment.chatMessage,/CHATGPT_DIRECT_EDITORIAL_AUTHORITY_V1/); assert.match(assignment.chatMessage,/compact index/);
  assert.doesNotMatch(assignment.chatMessage,/Reverse ending|"mistakesToAvoid":/);
  assert.match(JSON.stringify(practiceNotebookViewV1("chosen",latest.gptLearning.workedExamples).examples),/Reverse ending|mistakesToAvoid/); assert.doesNotMatch(assignment.chatMessage,/machine-passing|strongest 3|32 coarse/);
});

test("reviewing a render job preserves the worker-issued artifact instead of accepting a replacement", async t => {
  const dir=await temp(t), worker=new PracticeProductionWorkerV1(path.join(dir,"jobs.jsonl"),async()=>({result:{renderPath:"actual.mp4"},reviewRequired:true}),async()=>true);
  const j=await worker.enqueue({assignmentId:"a",kind:"LOCAL_RENDER",payload:{},dependencyIds:[]}); await worker.runOnce();
  await worker.resolve(j.jobId,{renderPath:"invented.mp4",reviewEvidenceRef:"reviewed"});
  assert.equal(worker.list()[0].result.renderPath,"actual.mp4"); assert.equal(worker.list()[0].review.renderPath,"invented.mp4");
});
