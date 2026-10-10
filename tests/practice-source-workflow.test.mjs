import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {PracticeSourceWorkflowV1} from '../.tmp/runtime/apps/desktop-host/src/practice-source-workflow.js';
import {PracticePanelServerV1} from '../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js';
import {officialSourceTimestampsV1,sourceAssemblyCommandsV1} from '../.tmp/runtime/apps/desktop-host/src/source-match-assembly.js';
import {startSupervisor} from '../scripts/production-watchdog/supervisor.js';

const token='scoped-source-workflow-test-token-0123456789abcdef';
const headers={'content-type':'application/json','x-editflow-token':token};
const input={sessionId:'practice:11111111-1111-4111-8111-111111111111',assignmentId:'gpt-assignment:22222222-2222-4222-8222-222222222222',finishPath:'/fixture/finished.mp4',videoPaths:['/fixture/raw.mp4'],editTypeId:'test'};
function report(){return {schema:'editflow.source-match-report.v1',status:'COMPLETE',alternativeReviewComplete:true,
  reference:{path:input.finishPath,duration:6,fingerprint:'finished'},sources:[{path:input.videoPaths[0],duration:40,fingerprint:'raw',width:320,height:240,fps:12}],
  shots:[20,3,12].map((start,i)=>({shotId:'shot-'+i,referenceStart:i*2,referenceEnd:(i+1)*2,status:'VERIFIED',boundaryStatus:'MEASURED_ENDPOINT_CORRESPONDENCES',sourcePath:input.videoPaths[0],sourceStart:start,sourceEndExclusive:start+2}))};}
const body={jobId:'source-match-33333333-3333-4333-8333-333333333333',encoder:'CPU',output:{stableId:'test-comp',name:'Test',width:320,height:240,pixelAspect:1,frameRate:12}};

test('assembly requires all complete exact ranges and Finished coverage, with no GPT footage review',()=>{
  const manifest=officialSourceTimestampsV1(report(),body);
  assert.equal(manifest.authority,'EDITFLOW_SOURCE_MATCH_SERVICE');assert.equal('review' in manifest,false);
  assert.deepEqual(manifest.shots.map(s=>s.sourceStart),[20,3,12]);
  for(const edit of [r=>r.status='PARTIAL',r=>r.alternativeReviewComplete=false,r=>r.shots[1].status='LOCATED',r=>r.shots[1].boundaryStatus='UNRESOLVED',r=>r.shots[1].sourceStart=null,r=>r.shots[1].sourceEndExclusive=41,r=>r.shots[1].sourcePath=input.finishPath,r=>r.shots[1].referenceStart=2.1,r=>r.shots[1].shotId=r.shots[0].shotId]){
    const bad=report();edit(bad);assert.throws(()=>officialSourceTimestampsV1(bad,body));
  }
  const media={shots:manifest.shots.map(s=>({...s,workingPath:'/cuts/'+s.shotId+'.mov'}))};
  const commands=sourceAssemblyCommandsV1(manifest,media,0).commands;
  assert.deepEqual(commands.filter(([c])=>c==='media.import').map(([,p])=>p.path),['/cuts/shot-0.mov','/cuts/shot-1.mov','/cuts/shot-2.mov']);
  assert.deepEqual(commands.filter(([c])=>c==='layer.set_timing').map(([,p])=>p.timing.inPoint),[0,2,4]);
  assert.ok(commands.every(([c])=>['comp.create','media.import','layer.add_media','layer.set_timing'].includes(c)));
});
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'editflow-source-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const calls=[];let matchStatus='RUNNING';let currentReport=report();let pauseExecute=null;
  const manifestPath=path.join(root,'official-timestamps.json');
  const services={matcher:{submit:async()=>{calls.push('match');return {job:{jobId:body.jobId}};},status:async()=>({job:{status:matchStatus},report:currentReport,csvPath:root+'/timestamps.csv',remaining:currentReport.shots.filter(s=>s.status!=='VERIFIED')}),cancel:async()=>calls.push('cancel-match'),stop:async()=>{}},
    assembler:{prepare:async packet=>{calls.push('save-timestamps');const m=officialSourceTimestampsV1(currentReport,packet);await writeFile(manifestPath,JSON.stringify(m));return {assembly:{assemblyId:'source-assembly-44444444-4444-4444-8444-444444444444',batchCount:1,manifestPath}};},status:async()=>({assembly:{status:'READY'}}),plan:async()=>{calls.push('assembly-plan');assert.equal(JSON.parse(await readFile(manifestPath)).shots.length,3);return {payload:{plan:{operations:[{input:{command:'media.import'}}]}}};},verifyPayload:async()=>{},cancel:async()=>calls.push('cancel-assembly'),stop:async()=>{}},
    runtime:{observe:async()=>{calls.push('AE-observe');return {projectRevision:'1',projectFingerprint:'p',environmentFingerprint:'e'};},execute:async plan=>{calls.push(plan.operations[0].input.command==='project.save'?'checkpoint':'AE-import');if(pauseExecute)await pauseExecute;return {state:'COMMITTED'};}}};
  const flow=new PracticeSourceWorkflowV1({repositoryRoot:process.cwd(),artifactDir:root,broker:{panelSession:null},services});
  await flow.start();t.after(()=>flow.stop());await flow.create(input);
  const deliver=async()=>{const task=flow.supervisorTask();await flow.supervisorAck({launchId:task.launchId,type:'CREATED',tabId:7});await flow.supervisorAck({launchId:task.launchId,type:'SENT',tabId:7,conversationUrl:'https://chatgpt.com/c/test'});};
  return {flow,root,calls,services,deliver,setStatus:v=>matchStatus=v,setReport:v=>currentReport=v,pause:()=>{let resolve;pauseExecute=new Promise(r=>resolve=r);return resolve;}};
}
test('first chat delivery precedes matching; saved timestamps precede any AE import; assembly ends the process',async t=>{
  const f=await fixture(t);await f.flow.advance();assert.deepEqual(f.calls,[]);
  await assert.rejects(f.flow.request(input.sessionId),/INSTRUCTIONS_MUST_BE_DELIVERED_FIRST/);
  const task=f.flow.supervisorTask();assert.match(task.prompt,/Source Match Service/);assert.match(task.prompt,/Do not view, analyze or compare footage/);
  await f.deliver();await f.flow.advance();assert.deepEqual(f.calls,['match']);
  await f.flow.advance();assert.deepEqual(f.calls,['match']);
  f.setStatus('COMPLETE');await f.flow.advance();assert.deepEqual(f.calls,['match','save-timestamps']);
  await f.flow.advance();await f.flow.advance();assert.deepEqual(f.calls,['match','save-timestamps','AE-observe','assembly-plan','AE-import','AE-observe','checkpoint']);
  assert.equal(f.flow.snapshot(input.sessionId).state,'COMPLETED');
  await f.flow.request(input.sessionId);assert.equal(f.calls.length,7);assert.equal(f.flow.supervisorTask(),null);
});
test('partial matches block AE entirely and never request GPT pixel analysis',async t=>{
  const f=await fixture(t);await f.deliver();await f.flow.advance();f.setStatus('PARTIAL');const r=report();r.status='PARTIAL';r.shots[1].status='LOCATED';f.setReport(r);
  await f.flow.advance();assert.equal(f.flow.snapshot(input.sessionId).state,'BLOCKED');assert.deepEqual(f.calls,['match']);
  await f.flow.request(input.sessionId);assert.deepEqual(f.calls,['match']);
});
test('cancel during an AE batch prevents every subsequent batch and checkpoint',async t=>{
  const f=await fixture(t);await f.deliver();await f.flow.advance();f.setStatus('COMPLETE');await f.flow.advance();
  const release=f.pause();const pending=f.flow.advance();
  while(!f.calls.includes('AE-import'))await new Promise(r=>setTimeout(r,5));
  const cancelled=f.flow.cancel(input.sessionId);release();await pending;await cancelled;await f.flow.advance();
  assert.equal(f.flow.snapshot(input.sessionId).state,'CANCELLED');assert.ok(!f.calls.includes('checkpoint'));
});
test('panel retains inputs and Edit Types, Supervisor sends the scoped first chat, Pro stays empty',async t=>{
  const f=await fixture(t);await f.flow.cancel(input.sessionId);f.calls.length=0;
  const raw=path.join(f.root,'raw.mp4'),finished=path.join(f.root,'finished.mp4'),registry=path.join(f.root,'edit-types.json');
  await writeFile(raw,'raw');await writeFile(finished,'finished');await writeFile(registry,JSON.stringify({schema:'editflow.edit-type-registry.v1',profiles:[{editTypeId:'test',title:'Test',gptLearning:{workedExamples:[{old:true}]}}]}));
  const panel=new PracticePanelServerV1({port:0,token,repositoryRoot:process.cwd(),artifactDir:f.root,learningMemoryFilePath:f.root+'/unused.json',editTypeRegistryFilePath:registry,broker:{panelSession:null},sourceWorkflow:f.flow});
  const base='http://127.0.0.1:'+await panel.start();t.after(()=>panel.stop());
  const request=async(route,value)=>(await fetch(base+route,{method:value?'POST':'GET',headers,...(value?{body:JSON.stringify(value)}:{})}));
  const started=await (await request('/v1/product/practice',{editTypeId:'test',videoPaths:[raw],finishPath:finished})).json();
  assert.equal(started.run.stage,'SUPERVISOR_HANDOFF');assert.deepEqual(f.calls,[]);
  assert.equal((await request('/v1/product/practice/source-match',{sessionId:started.run.sessionId})).status,400);
  const supervisor=await startSupervisor({backend:base,token,port:0,browserLaunchEnabled:false});t.after(()=>supervisor.stop());
  const task=(await (await request('/v1/product/practice/supervisor')).json()).task;
  assert.equal(task.sessionId,started.run.sessionId);assert.match(task.prompt,/raw footage's original speed/);
  const extHeaders={'content-type':'application/json','x-editflow-actuator-id':'ljjjjjoghmheifakiiahgoonhhmoebog'};
  const actuator=async(value)=>(await fetch('http://127.0.0.1:'+supervisor.port+(value?'/actuator/ack':'/actuator'),{method:value?'POST':'GET',headers:extHeaders,...(value?{body:JSON.stringify(value)}:{})})).json();
  assert.equal((await actuator()).command,'CREATE');
  await actuator({id:task.launchId,type:'CREATED',tabId:77});
  const send=await actuator();assert.equal(send.command,'SEND');assert.equal(send.prompt,task.prompt);assert.deepEqual(f.calls,[]);
  await actuator({id:task.launchId,type:'SENT',tabId:77,observedUrl:'https://chatgpt.com/c/test'});
  assert.equal((await actuator()).command,'NONE');
  assert.deepEqual((await (await request('/v1/product/edit-types')).json()).editTypes[0].gptLearning.workedExamples,[]);
  await request('/v1/product/runs/'+encodeURIComponent(started.run.sessionId)+'/cancel',{});
  f.calls.length=0;
  const pro=(await (await request('/v1/product/pro-creation',{editTypeId:'test',videoPaths:[raw]})).json()).run;
  assert.equal(pro.state,'SESSION_READY');assert.equal(pro.workflow,null);assert.deepEqual(pro.steps,[]);assert.deepEqual(f.calls,[]);
  assert.equal((await request('/v1/product/practice/source-match',{sessionId:pro.sessionId})).status,409);
  assert.equal((await request('/v1/product/gpt/assignments/old/production-jobs',{})).status,410);
});

test('browser delivery recognizes formatted instructions for this session and rejects a foreign session',async t=>{
  const {runInNewContext}=await import('node:vm');
  const f=await fixture(t);const prompt=f.flow.supervisorTask().prompt+'\nWindows input: "C:\\\\Movies\\\\raw.mp4"';
  const script=await readFile('scripts/production-watchdog/content.js','utf8');
  async function send(text){
    let listener;const messages=[{innerText:text,textContent:text}];
    const context={location:{href:'https://chatgpt.com/c/test',pathname:'/c/test'},
      document:{querySelectorAll:selector=>selector.startsWith('[data-message')?messages:[]},
      chrome:{runtime:{onMessage:{hasListener:()=>false,addListener:value=>listener=value}}},setTimeout};
    runInNewContext(script,context);
    return new Promise(resolve=>listener({type:'EDITFLOW_ACTUATOR_SEND',prompt,id:'test'},null,resolve));
  }
  const rendered=prompt.replaceAll('\\\\','\\');
  assert.equal((await send(rendered)).sent,true);
  assert.equal((await send(rendered.replaceAll(input.sessionId,'practice:99999999-9999-4999-8999-999999999999'))).sent,false);
});
