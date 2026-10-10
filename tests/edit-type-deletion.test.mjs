import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {PracticePanelServerV1} from '../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js';

const sessionId='practice:11111111-1111-4111-8111-111111111111';
const assignmentId='gpt-assignment:22222222-2222-4222-8222-222222222222';
const jobId='source-match-33333333-3333-4333-8333-333333333333';
const assemblyId='source-assembly-44444444-4444-4444-8444-444444444444';
const token='edit-type-deletion-test-token-0123456789abcdef';
const headers={'content-type':'application/json','x-editflow-token':token};
const profile={schema:'editflow.edit-type-profile.v1',editTypeId:'delete-me',title:'Delete Me',revision:8,
  sessionIds:[sessionId],behaviorEvidence:[{private:'evidence'}],gptLearning:{learnedSkills:[{private:'lesson'}],workedExamples:[{private:'example'}]},attachments:[{private:'attachment'}]};
const survivor={...profile,editTypeId:'keep-me',title:'Keep Me',sessionIds:[],gptLearning:{workedExamples:[{private:'keep this'}]}};
async function fixture(t,{pendingDeletion=false}={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'editflow-delete-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const stateDir=path.join(root,'state'),artifactDir=path.join(root,'artifacts');
  await mkdir(stateDir,{recursive:true});
  const registry=path.join(stateDir,'edit-types.json'),memory=path.join(stateDir,'practice-learning-memory.json');
  const raw=path.join(root,'raw.mp4'),finished=path.join(root,'finished.mp4');
  await writeFile(raw,'original raw');await writeFile(finished,'original Finished');
  await writeFile(registry,JSON.stringify({schema:'editflow.edit-type-registry.v1',profiles:[profile,survivor],history:[{editTypeId:'delete-me',private:'old version'},{editTypeId:'keep-me',private:'keep version'}]}));
  await writeFile(memory,JSON.stringify({schema:'memory',profiles:{'delete-me':{private:'forget'},'keep-me':{private:'retain'}},events:[{editTypeId:'delete-me',private:'forget event'},{editTypeId:'keep-me',private:'retain event'}],bySession:{[sessionId]:{private:'forget session'}}}));
  const workflowDir=path.join(artifactDir,'source-workflow',sessionId.replace(':','-'));
  const jobDir=path.join(artifactDir,'source-match',jobId),assemblyDir=path.join(artifactDir,'source-match','assemblies',assemblyId);
  const matchReceipt=path.join(artifactDir,'source-match','requests','practice-'+sessionId.split(':')[1]+'.json');
  const assemblyReceipt=path.join(artifactDir,'source-match','assemblies','requests','practice-assembly-'+sessionId.split(':')[1]+'.json');
  for(const dir of [workflowDir,jobDir,assemblyDir,path.dirname(matchReceipt),path.dirname(assemblyReceipt)])await mkdir(dir,{recursive:true});
  await writeFile(path.join(workflowDir,'workflow.json'),JSON.stringify({sessionId,assignmentId,editTypeId:'delete-me',state:'CANCELLED',stage:'SOURCE_MATCH',finishPath:finished,videoPaths:[raw],jobId,assemblyId,inFlightBatch:null,supervisor:{},completedBatches:[]}));
  await writeFile(path.join(workflowDir,'raw-assembly.aep'),'generated checkpoint');
  await writeFile(path.join(jobDir,'job.json'),JSON.stringify({jobId,assignmentId,status:'COMPLETE'}));
  await writeFile(path.join(jobDir,'report.json'),JSON.stringify({private:'matching evidence',reference:{path:finished}}));
  await writeFile(path.join(assemblyDir,'official-timestamps.json'),JSON.stringify({jobId,shots:[{sourcePath:raw}]}));
  await writeFile(path.join(assemblyDir,'shot.mov'),'generated clip');
  await writeFile(matchReceipt,JSON.stringify({jobId}));await writeFile(assemblyReceipt,JSON.stringify({assemblyId}));
  const keptArtifact=path.join(artifactDir,'source-match','keep-results.txt');await writeFile(keptArtifact,'retain unrelated result');
  const ownRun={sessionId,assignmentId,editTypeId:'delete-me',mode:'PRACTICE',state:'CANCELLED',videoPaths:[raw],finishPath:finished};
  const keptRun={sessionId:'pro:55555555-5555-4555-8555-555555555555',assignmentId:'ui-session:66666666-6666-4666-8666-666666666666',editTypeId:'keep-me',mode:'PRO_CREATION',state:'CANCELLED'};
  await writeFile(path.join(stateDir,'ui-sessions.json'),JSON.stringify({schema:'editflow.empty-workflow-sessions.v1',activeRunId:null,runs:[ownRun,keptRun],controls:{own:{sessionId,assignmentId},keep:{sessionId:keptRun.sessionId}}}));
  if(pendingDeletion)await writeFile(path.join(stateDir,'edit-type-deletion.json'),JSON.stringify({editTypeId:'delete-me'}));
  const config={port:0,token,repositoryRoot:process.cwd(),artifactDir,learningMemoryFilePath:memory,editTypeRegistryFilePath:registry,broker:{panelSession:null}};
  const panel=new PracticePanelServerV1(config),base='http://127.0.0.1:'+await panel.start();t.after(()=>panel.stop());
  async function request(route,body,auth=headers) {
    const response=await fetch(base+route,{method:body?'POST':'GET',headers:auth,...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  }
  const preview=async()=>request('/v1/product/edit-types/delete-preview',{editTypeId:'delete-me'});
  const remove=async confirmationToken=>request('/v1/product/edit-types/delete',{editTypeId:'delete-me',confirmationToken,confirmed:true});
  return {panel,config,root,stateDir,registry,memory,raw,finished,workflowDir,jobDir,assemblyDir,matchReceipt,assemblyReceipt,keptArtifact,keptRun,request,preview,remove};
}
async function assertPurged(f) {
  const registry=JSON.parse(await readFile(f.registry));
  assert.deepEqual(registry.profiles,[survivor]);assert.deepEqual(registry.history,[{editTypeId:'keep-me',private:'keep version'}]);
  const memory=JSON.parse(await readFile(f.memory));
  assert.deepEqual(memory.profiles,{'keep-me':{private:'retain'}});
  assert.deepEqual(memory.events,[{editTypeId:'keep-me',private:'retain event'}]);assert.deepEqual(memory.bySession,{});
  const state=JSON.parse(await readFile(path.join(f.stateDir,'ui-sessions.json')));
  assert.deepEqual(state.runs,[f.keptRun]);assert.deepEqual(state.controls,{keep:{sessionId:f.keptRun.sessionId}});
  for(const file of [f.workflowDir,f.jobDir,f.assemblyDir,f.matchReceipt,f.assemblyReceipt,path.join(f.stateDir,'edit-type-deletion.json')])await assert.rejects(access(file));
  assert.equal(await readFile(f.raw,'utf8'),'original raw');assert.equal(await readFile(f.finished,'utf8'),'original Finished');
  assert.equal(await readFile(f.keptArtifact,'utf8'),'retain unrelated result');
}
test('preview changes no preset data; only a bound confirmation purges all owned data',async t=>{
  const f=await fixture(t),before=await readFile(f.registry,'utf8');
  assert.equal((await f.request('/v1/product/edit-types/delete',{editTypeId:'delete-me',confirmationToken:'forged',confirmed:true})).status,409);
  assert.equal((await f.request('/v1/product/edit-types/delete',{editTypeId:'delete-me',confirmationToken:'forged',confirmed:true},{})).status,401);
  const preview=await f.preview();assert.equal(preview.status,200);assert.equal(preview.body.sessionCount,1);
  assert.match(preview.body.consequences,/cannot be undone/);assert.match(preview.body.consequences,/missing footage/);
  assert.equal(await readFile(f.registry,'utf8'),before);await access(f.jobDir);await access(f.assemblyDir);
  const deleted=await f.remove(preview.body.confirmationToken);assert.equal(deleted.status,200);assert.equal(deleted.body.deletedEditTypeId,'delete-me');
  await assertPurged(f);assert.equal((await f.request('/v1/product/runs/'+encodeURIComponent(sessionId))).status,404);
  assert.equal((await f.remove(preview.body.confirmationToken)).status,409);
  // An old start request must not implicitly re-create a deleted preset.
  assert.equal((await f.request('/v1/product/practice',{editTypeId:'delete-me',editTypeTitle:'Delete Me',finishPath:f.finished,videoPaths:[f.raw]})).status,400);
});
test('changed preset data and active sessions invalidate deletion without erasing anything',async t=>{
  const f=await fixture(t),preview=await f.preview();
  const registry=JSON.parse(await readFile(f.registry));registry.profiles[0].gptLearning.workedExamples.push({private:'new evidence'});
  await writeFile(f.registry,JSON.stringify(registry));
  const changed=await f.remove(preview.body.confirmationToken);assert.equal(changed.status,409);assert.match(changed.body.error,/changed/);await access(f.jobDir);
  const started=await f.request('/v1/product/pro-creation',{editTypeId:'keep-me',videoPaths:[f.raw]});assert.equal(started.status,202);
  assert.equal((await f.preview()).status,409);assert.equal((await f.remove(preview.body.confirmationToken)).status,409);
  assert.deepEqual(JSON.parse(await readFile(f.registry)),registry);await access(f.assemblyDir);
});
test('a previously confirmed deletion finishes on runtime restart without a backup of learning',async t=>{
  const f=await fixture(t,{pendingDeletion:true});await assertPurged(f);
  assert.deepEqual((await f.request('/v1/product/edit-types')).body.editTypes.map(p=>p.editTypeId),['keep-me']);
});
test('artifact ownership conflicts fail before deleting files or preset memory',async t=>{
  const f=await fixture(t),preview=await f.preview();
  const memoryBefore=await readFile(f.memory,'utf8');
  await writeFile(path.join(f.jobDir,'job.json'),JSON.stringify({jobId,assignmentId:'gpt-assignment:99999999-9999-4999-8999-999999999999'}));
  assert.equal((await f.remove(preview.body.confirmationToken)).status,400);
  await access(f.jobDir);await access(f.assemblyDir);await access(f.workflowDir);
  assert.ok(JSON.parse(await readFile(f.registry)).profiles.some(p=>p.editTypeId==='delete-me'));
  assert.equal(await readFile(f.memory,'utf8'),memoryBefore);
  await assert.rejects(access(path.join(f.stateDir,'edit-type-deletion.json')));
});

async function panelUi() {
  const elements=new Map(),intervals=[],storage=new Map();let active=null;let deleted=0;let previewed=0;let listHold=null;
  const confirmed=[{editTypeId:'delete-me',title:'Delete Me'},{editTypeId:'keep-me',title:'Keep Me'}];
  class Element {
    constructor(id=''){this.id=id;this.value='';this.disabled=false;this.hidden=false;this.textContent='';this.handlers={};this.attributes={};this.children=[];this.classList={add(){},remove(){},toggle(){}};this.elements={namedItem(){return null;}};}
    set innerHTML(v){this.children=[];if(this.id==='edit-type')this.value='';}get innerHTML(){return '';}
    addEventListener(name,fn){(this.handlers[name]??=[]).push(fn);}setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}
    appendChild(el){this.children.push(el);}focus(){active=this;}
    fire(name,event={}){for(const fn of this.handlers[name]||[])fn({target:this,preventDefault(){},stopPropagation(){},...event});}
  }
  const html=await readFile('packages/adapters/ae-cep/extension/html/index.html','utf8');
  for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements.set(id,new Element(id));
  elements.get('edit-type-delete-modal').hidden=true;
  const tabs=[new Element(),new Element()];tabs[0].attributes['data-mode']='PRACTICE';tabs[1].attributes['data-mode']='PRO_CREATION';
  const document={getElementById:id=>{assert.ok(elements.has(id),id);return elements.get(id);},createElement:()=>new Element(),querySelectorAll:s=>s==='.mode-tab'?tabs:[],get activeElement(){return active;}};
  const window={EDITFLOW2_BRIDGE_CONFIG:{port:32145,productPort:32146,token},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},addEventListener(){}};
  async function fetchMock(url,options) {
    const route=new URL(url).pathname;let result;
    if(route==='/v1/product/status')result={service:'READY',panelConnected:true,activeRunId:null,latestRunId:null};
    else if(route==='/v1/product/edit-types') {
      if(listHold){const wait=listHold;listHold=null;result=await wait;}else result={editTypes:structuredClone(confirmed)};
    } else if(route.endsWith('/delete-preview')) {previewed++;result={editTypeId:'delete-me',title:'Delete Me',confirmationToken:'bound-token',sessionCount:3,consequences:'Permanently removes memories, lessons and attachments. This cannot be undone.'};}
    else if(route.endsWith('/delete')) {
      const body=JSON.parse(options.body);assert.equal(body.confirmationToken,'bound-token');assert.equal(body.confirmed,true);assert.equal(body.editTypeId,'delete-me');
      deleted++;confirmed.splice(confirmed.findIndex(p=>p.editTypeId==='delete-me'),1);result={deletedEditTypeId:'delete-me',editTypes:structuredClone(confirmed)};
    } else throw new Error('Unexpected request '+route);
    return {ok:true,status:200,text:async()=>JSON.stringify(result)};
  }
  runInNewContext(await readFile('packages/adapters/ae-cep/extension/client/practice-panel.js','utf8'),{window,document,fetch:fetchMock,console,Number,Promise,setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){},setTimeout(){return 1;},clearTimeout(){}});
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};await flush();
  const select=elements.get('edit-type');select.value='delete-me';select.focus();select.fire('change');
  return {elements,select,storage,flush,intervals,get deleted(){return deleted;},get previewed(){return previewed;},holdList(){let resolve;listHold=new Promise(r=>resolve=r);return resolve;}};
}
test('No at either confirmation leaves everything intact; Delete key and button share the two-stage dialog',async()=>{
  const u=await panelUi(),get=id=>u.elements.get(id),modal=get('edit-type-delete-modal');
  get('edit-type-controls').fire('keydown',{target:u.select,key:'Delete',keyCode:46});
  assert.equal(modal.hidden,false);assert.match(get('edit-type-delete-title').textContent,/Delete Me/);assert.equal(u.previewed,0);
  get('edit-type-delete-no').fire('click');assert.equal(modal.hidden,true);assert.equal(u.deleted,0);assert.equal(u.select.value,'delete-me');
  get('delete-edit-type').fire('click');get('edit-type-delete-yes').fire('click');await u.flush();
  assert.match(get('edit-type-delete-title').textContent,/REALLY/);assert.match(get('edit-type-delete-message').textContent,/memories, lessons and attachments/);
  get('edit-type-delete-no').fire('click');assert.equal(modal.hidden,true);assert.equal(u.deleted,0);assert.equal(u.select.value,'delete-me');
  const cached=JSON.parse(u.storage.get('editflow2.practice.empty-edit-types-cache.v1'));assert.ok(cached.some(p=>p.editTypeId==='delete-me'));
});
test('both Yes clicks purge the UI cache; stale list replies cannot resurrect the preset',async()=>{
  const u=await panelUi(),get=id=>u.elements.get(id);
  const release=u.holdList();u.intervals[0]();await u.flush();
  get('delete-edit-type').fire('click');get('edit-type-delete-yes').fire('click');await u.flush();assert.equal(u.deleted,0);
  get('edit-type-delete-yes').fire('click');get('edit-type-delete-yes').fire('click');await u.flush();assert.equal(u.deleted,1);
  release({editTypes:[{editTypeId:'delete-me',title:'Delete Me'}]});await u.flush();
  assert.equal(get('edit-type-delete-modal').hidden,true);assert.equal(u.select.value,'');assert.equal(get('delete-edit-type').disabled,true);
  assert.equal(u.storage.has('editflow2.practice.selected-edit-type.v1'),false);
  assert.deepEqual(JSON.parse(u.storage.get('editflow2.practice.empty-edit-types-cache.v1')).map(p=>p.editTypeId),['keep-me']);
});
test('Escape cancels; repeated Delete, modified shortcuts and text fields cannot start deletion',async()=>{
  const u=await panelUi(),get=id=>u.elements.get(id),controls=get('edit-type-controls');
  for(const extra of [{repeat:true},{ctrlKey:true},{target:get('new-edit-type')}])controls.fire('keydown',{target:u.select,key:'Delete',...extra});
  assert.equal(get('edit-type-delete-modal').hidden,true);assert.equal(u.deleted,0);
  get('delete-edit-type').fire('click');get('edit-type-delete-modal').fire('keydown',{key:'Escape'});
  assert.equal(get('edit-type-delete-modal').hidden,true);assert.equal(u.deleted,0);assert.equal(u.previewed,0);
});
