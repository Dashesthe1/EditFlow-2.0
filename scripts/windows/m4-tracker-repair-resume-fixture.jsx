(function () {
  "use strict";
  var root = new File($.fileName).parent.parent.parent;
  var out = new File(root.fsName + "/proofs/artifacts/m4-tracker-repair-resume-fixture.json");
  var loader = new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v24.jsx");
  function write(v){out.parent.create();out.open("w");out.encoding="UTF-8";out.write(JSON.stringify(v));out.close();}
  function find(name){for(var i=1;i<=app.project.numItems;i+=1){if(app.project.item(i).name===name)return app.project.item(i);}return null;}
  function request(command,cap,payload,expected,suffix){return{protocolVersion:"2.4.0",requestId:"M4_RR_"+suffix,transactionId:"M4_RR_TX_"+suffix,operationId:"M4_RR_OP_"+suffix,capabilityId:cap,command:command,expectedHostProjectRevision:expected,payload:payload,readbackProfile:null};}
  function dispatch(v){return $.global.EditFlow2_JSON.parse($.global.EditFlow2_dispatch($.global.EditFlow2_JSON.stringify(v)));}
  var r={ok:false},owned=null;
  try{
    if(!app.project)throw new Error("No project open.");
    var old=find("EF2_M4_REPAIR_RESUME_OWNED");if(old)old.remove();
    var baselineItems=app.project.numItems;
    owned=app.project.items.addFolder("EF2_M4_REPAIR_RESUME_OWNED");
    var source=app.project.items.addComp("RR_SOURCE",720,720,1,3,30);source.parentFolder=owned;
    var black=source.layers.addSolid([0,0,0],"RR_BLACK",720,720,1,3);black.source.parentFolder=owned;
    var feature=source.layers.addSolid([1,1,1],"RR_FEATURE",70,70,1,3);feature.source.parentFolder=owned;
    feature.property("ADBE Transform Group").property("ADBE Position").setValueAtTime(0,[220,360]);
    feature.property("ADBE Transform Group").property("ADBE Position").setValueAtTime(2.5,[500,360]);
    var fixture=app.project.items.addComp("RR_FIXTURE",720,720,1,3,30);fixture.parentFolder=owned;fixture.comment="[[EDITFLOW2_STABLE:M4_REPAIR_RESUME_COMP]]";
    var layer=fixture.layers.add(source);layer.name="RR_TARGET";layer.comment="[[EDITFLOW2_STABLE:M4_REPAIR_RESUME_LAYER]]";layer.startTime=0;layer.inPoint=0;layer.outPoint=2.6;
    var motion=layer.property("ADBE MTrackers"),tracker=motion.addProperty("ADBE MTracker");tracker.name="Tracker 1";
    var point=tracker.addProperty("ADBE MTracker Pt");point.name="Track Point 1";
    var center=point.property("ADBE MTracker Pt Feature Center"),attach=point.property("ADBE MTracker Pt Attach Pt"),featureSize=point.property("ADBE MTracker Pt Feature Size"),searchSize=point.property("ADBE MTracker Pt Search Size"),confidence=point.property("ADBE MTracker Pt Confidence");
    center.setValueAtTime(0,[220,360]);center.setValueAtTime(0.5,[250,330]);
    attach.setValueAtTime(0,[220,360]);attach.setValueAtTime(0.5,[276,360]);
    featureSize.setValue([90,90]);searchSize.setValue([220,220]);
    try{confidence.setValueAtTime(0,96);confidence.setValueAtTime(0.5,45);}catch(_){}
    fixture.workAreaStart=0.5;fixture.workAreaDuration=1.5;fixture.time=0.5;
    for(var li=1;li<=fixture.numLayers;li+=1)fixture.layer(li).selected=false;layer.selected=true;
    try{tracker.selected=true;point.selected=true;}catch(_){}
    fixture.openInViewer();try{layer.openInViewer();}catch(_){}fixture.time=0.5;
    var trackerPanelId=app.findMenuCommandId("Tracker");if(trackerPanelId>0)app.executeCommand(trackerPanelId);
    if(!loader.exists)throw new Error("Protocol 2.4 loader missing.");$.evalFile(loader);if(!$.global.EditFlow2_HOST_PROTOCOL_24)throw new Error("Protocol 2.4 failed to load.");
    var payload={comp:{hostId:fixture.id},layer:{hostId:layer.id},trackerIndex:1,pointIndex:1,time:0.5,featureCenter:[276,360]};
    var repair=dispatch(request("tracker.repair.set_feature_center","ae.tracker.repair.feature_center.set",payload,app.project.revision,"REPAIR"));
    if(repair.outcome!=="APPLIED"&&repair.outcome!=="NO_OP")throw new Error("Protocol 2.4 repair failed: "+JSON.stringify(repair.error));
    fixture.time=0.5;
    r={ok:true,baselineItems:baselineItems,ownedFolderId:owned.id,sourceCompId:source.id,fixtureCompId:fixture.id,layerId:layer.id,compName:fixture.name,layerName:layer.name,trackerName:tracker.name,pointIndex:1,repairTime:0.5,desiredRepairCenter:[276,360],preResumeFeatureCenterKeyCount:center.numKeys,preResumeAttachKeyCount:attach.numKeys,repairResponse:repair,trackerPanelId:trackerPanelId,frameRate:fixture.frameRate,duration:fixture.duration};
  }catch(error){r.error=String(error);}
  write(r);
}());
