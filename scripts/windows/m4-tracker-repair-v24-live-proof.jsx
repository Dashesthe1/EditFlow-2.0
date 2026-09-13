(function () {
  "use strict";
  var root = new File($.fileName).parent.parent.parent;
  var out = new File(root.fsName + "/proofs/artifacts/m4-tracker-repair-v24-live.json");
  var loader = new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v24.jsx");
  function write(v){out.parent.create();out.open("w");out.encoding="UTF-8";out.write(JSON.stringify(v));out.close();}
  function find(name){for(var i=1;i<=app.project.numItems;i+=1){if(app.project.item(i).name===name)return app.project.item(i);}return null;}
  function request(command,cap,payload,expected,profile,suffix){return{protocolVersion:"2.4.0",requestId:"M4_REPAIR_"+suffix,transactionId:"M4_REPAIR_TX_"+suffix,operationId:"M4_REPAIR_OP_"+suffix,capabilityId:cap,command:command,expectedHostProjectRevision:expected,payload:payload,readbackProfile:profile||null};}
  function dispatch(value){return $.global.EditFlow2_JSON.parse($.global.EditFlow2_dispatch($.global.EditFlow2_JSON.stringify(value)));}
  function same2(a,b){return a&&b&&Math.abs(a[0]-b[0])<0.000001&&Math.abs(a[1]-b[1])<0.000001;}
  function sameKeys(a,b){if(!a||!b||a.length!==b.length)return false;for(var i=0;i<a.length;i+=1){if(Math.abs(a[i].time-b[i].time)>0.000001||!same2(a[i].value,b[i].value))return false;}return true;}
  var result={proof:"M4_TRACKER_REPAIR_V24_LIVE",ok:false,checks:{}};
  var fixture=null,baselineItems=app.project?app.project.numItems:null;
  try{
    if(!app.project)throw new Error("No project open.");
    if(!loader.exists)throw new Error("Protocol 2.4 loader missing.");
    var old=find("EF2_M4_REPAIR_FIXTURE");if(old)old.remove();
    var source=null;for(var i=1;i<=app.project.numItems;i+=1){var item=app.project.item(i);if(item instanceof FootageItem&&item.duration>0){source=item;break;}}
    if(!source)throw new Error("Time-based footage source required.");
    var fps=source.frameRate||29.9700012207031;
    fixture=app.project.items.addComp("EF2_M4_REPAIR_FIXTURE",1080,1080,1,2,fps);
    fixture.comment="[[EDITFLOW2_STABLE:M4_REPAIR_COMP]]";
    var layer=fixture.layers.add(source);layer.name="EF2_M4_REPAIR_TARGET";layer.comment="[[EDITFLOW2_STABLE:M4_REPAIR_LAYER]]";layer.startTime=0;layer.inPoint=0;layer.outPoint=Math.min(1.9,source.duration||1.9);
    var motion=layer.property("ADBE MTrackers"),tracker=motion.addProperty("ADBE MTracker"),point=tracker.addProperty("ADBE MTracker Pt");
    tracker.name="EF2 Repair Tracker";point.name="EF2 Repair Point";
    var center=point.property("ADBE MTracker Pt Feature Center"),attach=point.property("ADBE MTracker Pt Attach Pt"),confidence=point.property("ADBE MTracker Pt Confidence");
    center.setValueAtTime(0,[420,520]);center.setValueAtTime(0.5,[540,520]);center.setValueAtTime(1,[660,520]);
    attach.setValueAtTime(0,[420,520]);attach.setValueAtTime(0.5,[540,520]);attach.setValueAtTime(1,[660,520]);
    try{confidence.setValueAtTime(0,95);confidence.setValueAtTime(0.5,72);confidence.setValueAtTime(1,93);}catch(_){}
    fixture.time=0.5;fixture.openInViewer();try{layer.openInViewer();}catch(_){}
    $.evalFile(loader);if(!$.global.EditFlow2_HOST_PROTOCOL_24)throw new Error("Protocol 2.4 did not load.");
    var target={comp:{hostId:fixture.id},layer:{hostId:layer.id},trackerIndex:1,pointIndex:1,time:0.5};
    var baseline=dispatch(request("tracker.repair.readback","ae.tracker.repair.readback",target,null,null,"BASE"));
    result.baseline=baseline;var baselineKeys=baseline.readback.featureCenter.keys;
    var revisionBefore=app.project.revision,desired=[600,500];
    var applied=dispatch(request("tracker.repair.set_feature_center","ae.tracker.repair.feature_center.set",{comp:target.comp,layer:target.layer,trackerIndex:1,pointIndex:1,time:0.5,featureCenter:desired},revisionBefore,null,"APPLY"));
    result.applied=applied;
    result.checks.applied=applied.outcome==="APPLIED";
    result.checks.exactRepairKey=!!applied.readback&&applied.readback.featureCenter.exactKeyAtTime&&same2(applied.readback.featureCenter.valueAtTime,desired);
    result.checks.keyCountPreserved=!!applied.readback&&applied.readback.featureCenter.keyCount===baseline.readback.featureCenter.keyCount;
    var verify=dispatch(request("tracker.repair.readback","ae.tracker.repair.readback",target,null,null,"VERIFY"));result.verify=verify;
    result.checks.independentReadback=verify.outcome==="NO_OP"&&same2(verify.readback.featureCenter.valueAtTime,desired);
    var idempotent=dispatch(request("tracker.repair.set_feature_center","ae.tracker.repair.feature_center.set",{comp:target.comp,layer:target.layer,trackerIndex:1,pointIndex:1,time:0.5,featureCenter:desired},app.project.revision,null,"IDEMPOTENT"));result.idempotent=idempotent;
    result.checks.idempotent=idempotent.outcome==="NO_OP"&&sameKeys(idempotent.readback.featureCenter.keys,verify.readback.featureCenter.keys);
    var stale=dispatch(request("tracker.repair.set_feature_center","ae.tracker.repair.feature_center.set",{comp:target.comp,layer:target.layer,trackerIndex:1,pointIndex:1,time:0.5,featureCenter:[610,490]},revisionBefore,null,"STALE"));result.stale=stale;
    result.checks.staleRejected=stale.outcome==="REJECTED"&&stale.error&&stale.error.code==="HOST_REVISION_CONFLICT";
    var beforeRollback=dispatch(request("tracker.repair.readback","ae.tracker.repair.readback",{comp:target.comp,layer:target.layer,trackerIndex:1,pointIndex:1,time:0.75},null,null,"RB_BASE"));
    $.setenv("EDITFLOW_M4_TRACKER_REPAIR_P4_PROOF","1");
    var injected=dispatch(request("tracker.repair.set_feature_center","ae.tracker.repair.feature_center.set",{comp:target.comp,layer:target.layer,trackerIndex:1,pointIndex:1,time:0.75,featureCenter:[720,470]},app.project.revision,"M4_TRACKER_REPAIR_P4_FAILURE_INJECTION","RB_FAIL"));
    $.setenv("EDITFLOW_M4_TRACKER_REPAIR_P4_PROOF","");result.rollback=injected;
    result.checks.rollbackFailedAsInjected=injected.outcome==="FAILED"&&injected.error&&injected.error.code==="M4_TRACKER_REPAIR_P4_INDUCED_FAILURE";
    result.checks.rollbackRestored=!!injected.readback&&sameKeys(beforeRollback.readback.featureCenter.keys,injected.readback.featureCenter.keys)&&beforeRollback.readback.featureCenter.exactKeyAtTime===injected.readback.featureCenter.exactKeyAtTime&&same2(beforeRollback.readback.featureCenter.valueAtTime,injected.readback.featureCenter.valueAtTime);
    result.checks.baselineChangedOnlyAtRepair=baselineKeys.length===verify.readback.featureCenter.keys.length&&same2(verify.readback.featureCenter.keys[0].value,baselineKeys[0].value)&&same2(verify.readback.featureCenter.keys[2].value,baselineKeys[2].value)&&same2(verify.readback.featureCenter.keys[1].value,desired);
    result.ok=result.checks.applied&&result.checks.exactRepairKey&&result.checks.keyCountPreserved&&result.checks.independentReadback&&result.checks.idempotent&&result.checks.staleRejected&&result.checks.rollbackFailedAsInjected&&result.checks.rollbackRestored&&result.checks.baselineChangedOnlyAtRepair;
  }catch(error){result.error=String(error);try{$.setenv("EDITFLOW_M4_TRACKER_REPAIR_P4_PROOF","");}catch(_){} }
  finally{
    try{if(fixture)fixture.remove();}catch(cleanupError){result.cleanupError=String(cleanupError);}
    result.after={itemCount:app.project?app.project.numItems:null,baselineItemCount:baselineItems};
    result.checks.itemCountRestored=result.after.itemCount===baselineItems;
    result.ok=result.ok&&result.checks.itemCountRestored;
    write(result);
  }
}());
