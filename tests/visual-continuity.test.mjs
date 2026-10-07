import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseVisualReviewV1, emptyVisualContinuityV1, retainVisualReviewV1, invalidateVisualDecisionsV1, visualContinuityViewV1, visualMutationDimensionsV1, validateVisualComparisonTimesV1 } from '../.tmp/runtime/packages/practice-homework/src/visual-continuity.js';
import { PracticeProductionCoordinatorV1, PracticeProductionCoordinatorFileV1 } from '../.tmp/runtime/packages/practice-homework/src/production-coordinator.js';
import { assignmentViewV1, productionJobsViewV1 } from '../.tmp/runtime/apps/desktop-host/src/direct-editing-views.js';

const observation = (clipId='shot10',verdict='PASS',dimensions=['framing']) => ({clipId,verdict,dimensions,observation:'Subject matches the reviewed reference occupancy.',settings:{scale:88,position:[300,1020]},comparisons:[{renderTimeMs:27100,renderEvidenceId:'r',referenceTimeMs:27100,referenceEvidenceId:'f'}]});
const review = (id,revision=10,observations=[observation()])=>parseVisualReviewV1({authority:'CHATGPT_DIRECT',reviewId:id,renderJobId:'render-'+id,observations},revision);
test('accepted decisions survive disk reload and a local correction preserves unrelated shots and dimensions',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'visual-continuity-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const c=new PracticeProductionCoordinatorV1('s',['shot10','shot15']);
  c.retainVisualReview(review('r',10,[observation(),observation('shot15'),observation('shot10','PASS',['color'])]));
  const file=new PracticeProductionCoordinatorFileV1(path.join(root,'state.json'));await file.save(c);
  const next=await file.load();next.invalidateVisualDecisions(['shot10'],['framing'],11,'edit');await file.save(next);
  const view=visualContinuityViewV1((await file.load()).snapshot().visualContinuity);
  assert.equal(view.accepted.length,2);assert.equal(view.unfinished.length,1);assert.equal(view.unfinished[0].changedBy,'edit');
  assert.equal(view.accepted.find(d=>d.clipId==='shot15').settings.scale,88);
});
test('repeated failed distinct renders are diagnostic; rejected alternatives never erase an acceptance',()=>{
  let state=retainVisualReviewV1(emptyVisualContinuityV1(),review('pass'));
  state=retainVisualReviewV1(state,review('reject',10,[observation('shot10','REJECTED')]));
  assert.equal(visualContinuityViewV1(state).accepted.length,1);
  assert.equal(visualContinuityViewV1(state).rejectedAlternatives.length,1);
  state=retainVisualReviewV1(state,review('fail1',10,[observation('shot10','REVISE')]));
  state=retainVisualReviewV1(state,review('fail2',11,[observation('shot10','REVISE')]));
  assert.equal(visualContinuityViewV1(state).repeatedIssues[0].failedReviewCount,2);
  const again=review('same-pixels',11,[observation('shot10','REVISE')]);again.renderJobId='render-fail2';
  state=retainVisualReviewV1(state,again);assert.equal(visualContinuityViewV1(state).repeatedIssues[0].failedReviewCount,2);
});
test('stale reviews cannot overrule newer accepted pixels; unknown writes require review',()=>{
  let state=retainVisualReviewV1(emptyVisualContinuityV1(),review('new',20));
  state=retainVisualReviewV1(state,review('old',10,[observation('shot10','REVISE')]));
  assert.equal(state.decisions['shot10:framing'].sourceRevision,20);
  state=invalidateVisualDecisionsV1(state,['shot10'],['framing'],null,'partial');
  state=retainVisualReviewV1(state,review('old-pass',20));assert.equal(state.decisions['shot10:framing'].status,'NEEDS_REVIEW');
  state=invalidateVisualDecisionsV1(state,['shot10'],['framing'],21,'reconciled');
  state=retainVisualReviewV1(state,review('fresh',21));assert.equal(state.decisions['shot10:framing'].status,'ACCEPTED');
});
test('temporal PASS needs several timestamps and review identities are immutable',()=>{
  assert.throws(()=>review('single',10,[observation('shot10','PASS',['timing'])]),/THREE_TIMESTAMPS/);
  const o=observation('shot10','PASS',['timing']);o.comparisons=[0,100,200].map(t=>({renderTimeMs:t,renderEvidenceId:'r',referenceTimeMs:t,referenceEvidenceId:'f'}));
  const first=review('motion',10,[o]);let state=retainVisualReviewV1(emptyVisualContinuityV1(),first);
  assert.equal(retainVisualReviewV1(state,{...first,reviewedAt:'later'}),state);
  assert.throws(()=>retainVisualReviewV1(state,{...first,sourceRevision:11}),/ID_REUSED/);
  assert.deepEqual(visualMutationDimensionsV1({intents:[{kind:'READ_PROPERTY'}]}),[]);
});
test('routine context omits historical briefs and jobs while retaining unfinished receipts and latest whole render',()=>{
  const a={assignmentId:'a',chatMessage:'historical'.repeat(5000),practiceSceneMatches:[{shotId:'s',evidenceRefs:Array(1000).fill('old'),workingMedia:{sourcePath:'raw.mp4',originalStartMs:100}}]};
  assert.equal(assignmentViewV1(a).chatMessage,undefined);assert.equal(assignmentViewV1(a).practiceSceneMatches[0].workingMedia.originalStartMs,100);
  assert.equal(assignmentViewV1(a,true),a);
  const jobs=Array.from({length:100},(_,i)=>({jobId:String(i),kind:'AE_BATCH',status:i===3?'RECONCILE_REQUIRED':'SUCCEEDED',payload:{},createdAt:'a',updatedAt:'b'}));
  jobs[4]={...jobs[4],kind:'LOCAL_RENDER',payload:{startMs:0,endMs:1000,resolutionScale:1}};
  const v=productionJobsViewV1(jobs);assert.equal(v.jobs.length,10);assert.equal(v.totalJobs,100);
  assert.ok(v.jobs.some(j=>j.jobId==='3'));assert.equal(v.latestWholeRenderJobId,'4');assert.equal(productionJobsViewV1(jobs,true).jobs.length,100);
});

test('bounded render times align with reference composition and temporal acceptance spans the shot',()=>{
  const o=observation('shot10','PASS',['timing']);
  o.comparisons=[50,400,750].map(t=>({renderTimeMs:t,renderEvidenceId:'r',referenceTimeMs:27100+t,referenceEvidenceId:'f'}));
  const bounds={referenceStartMs:27100,referenceEndMs:27900};
  validateVisualComparisonTimesV1(o,27100,27900,bounds);
  assert.throws(()=>validateVisualComparisonTimesV1(o,0,800,bounds),/MISMATCH/);
  const clustered={...o,comparisons:o.comparisons.map((c,i)=>({...c,renderTimeMs:50+i,referenceTimeMs:27150+i}))};
  assert.throws(()=>validateVisualComparisonTimesV1(clustered,27100,27900,bounds),/SPAN_SHOT/);
  assert.throws(()=>validateVisualComparisonTimesV1(o,NaN,NaN),/VIDEO_INTERVAL/);
});
test('compact dimensions group identical evidence; cached render receipts do not count twice',()=>{
  let state=emptyVisualContinuityV1();
  const input={authority:'CHATGPT_DIRECT',reviewId:'a',renderJobId:'job1',observations:[observation('shot10','PASS',['framing','color','effects'])]};
  state=retainVisualReviewV1(state,parseVisualReviewV1(input,10,'same-pixels'));
  assert.equal(visualContinuityViewV1(state).accepted.length,1);
  assert.deepEqual(visualContinuityViewV1(state).accepted[0].dimensions,['framing','color','effects']);
  input.observations=[observation('shot10','REVISE')];
  for(const id of ['b','c'])state=retainVisualReviewV1(state,parseVisualReviewV1({...input,reviewId:id,renderJobId:id},10,'same-pixels'));
  assert.equal(visualContinuityViewV1(state).repeatedIssues.length,0);
});
