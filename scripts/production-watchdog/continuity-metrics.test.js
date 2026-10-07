'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { recordContinuitySample, activityBucket } = require('./continuity-metrics');
const snapshot = now => ({assignment:{assignmentId:'a',sessionId:'s',status:'RUNNING'},authority:{generation:7,state:'ARMED'},activeTabId:1,jobs:[],chatExecution:{tabId:1,generation:7,assignmentId:'a',sessionId:'s',checkedAt:now,state:'PROCESSING',observation:{ownerVerified:true,observerHealthy:true}}});
test('observed processing, render waits and handoffs are separated without inventing thinking time',()=>{
  let s=snapshot(1000), m=recordContinuitySample(null,s,{},1000);
  s=snapshot(3000);s.jobs=[{status:'RUNNING',kind:'LOCAL_RENDER'}];m=recordContinuitySample(m,s,{},3000);
  m=recordContinuitySample(m,snapshot(5000),{handoff:{id:'h'}},5000);
  m=recordContinuitySample(m,snapshot(7000),{handoff:{id:'h'}},7000);
  assert.equal(m.milliseconds.CHAT_PROCESSING_UNCLASSIFIED,2000);
  assert.equal(m.milliseconds.RENDER_WAIT,2000);assert.equal(m.milliseconds.HANDOFF,2000);assert.equal(m.handoffs,1);
});
test('restarts, foreign or stale observations stay unobserved; explicit pause is preserved',()=>{
  let s=snapshot(1000),m=recordContinuitySample(null,s,{},1000);
  m=recordContinuitySample(m,snapshot(70000),{},70000);assert.equal(m.milliseconds.UNOBSERVED,69000);
  s=snapshot(70000);s.chatExecution.generation=6;assert.equal(activityBucket(s,{},70000),'UNOBSERVED');
  s.authority.state='PAUSED';assert.equal(activityBucket(s,{},70000),'USER_PAUSED');
  assert.equal(recordContinuitySample(m,{assignment:{sessionId:'other'}},{},72000).milliseconds.UNOBSERVED,undefined);
});
