(function () {
  "use strict";
  var root = new File($.fileName).parent.parent.parent;
  var jsonRuntime = new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_json.jsx");
  if(!jsonRuntime.exists)throw new Error("EditFlow JSON runtime missing.");$.evalFile(jsonRuntime);
  var JSONX=$.global.EditFlow2_JSON;if(!JSONX)throw new Error("EditFlow JSON runtime failed to load.");
  var out = new File(root.fsName + "/proofs/artifacts/m4-automatic-corrective-recovery-fixture.json");
  function write(v){out.parent.create();out.open("w");out.encoding="UTF-8";out.write(JSONX.stringify(v));out.close();}
  function find(name){for(var i=1;i<=app.project.numItems;i+=1){if(app.project.item(i).name===name)return app.project.item(i);}return null;}
  var r={ok:false},owned=null;
  try{
    if(!app.project)throw new Error("No project open.");
    if(find("EF2_M4_AUTO_CORRECT_OWNED"))throw new Error("Previous automatic-corrective fixture still exists; cleanup is required first.");
    var baselineItems=app.project.numItems;
    owned=app.project.items.addFolder("EF2_M4_AUTO_CORRECT_OWNED");
    var source=app.project.items.addComp("ACR_SOURCE",720,720,1,3,30);source.parentFolder=owned;
    var black=source.layers.addSolid([0,0,0],"ACR_BLACK",720,720,1,3);black.source.parentFolder=owned;
    var feature=source.layers.addSolid([1,1,1],"ACR_FEATURE",70,70,1,3);feature.source.parentFolder=owned;
    feature.property("ADBE Transform Group").property("ADBE Position").setValueAtTime(0,[220,360]);
    feature.property("ADBE Transform Group").property("ADBE Position").setValueAtTime(2.5,[500,360]);
    var fixture=app.project.items.addComp("ACR_FIXTURE",720,720,1,3,30);fixture.parentFolder=owned;fixture.comment="[[EDITFLOW2_STABLE:M4_AUTO_CORRECT_COMP]]";
    var layer=fixture.layers.add(source);layer.name="ACR_TARGET";layer.comment="[[EDITFLOW2_STABLE:M4_AUTO_CORRECT_LAYER]]";layer.startTime=0;layer.inPoint=0;layer.outPoint=2.6;
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
    r={ok:true,baselineItems:baselineItems,ownedFolderId:owned.id,sourceCompId:source.id,fixtureCompId:fixture.id,layerId:layer.id,compStableId:"M4_AUTO_CORRECT_COMP",layerStableId:"M4_AUTO_CORRECT_LAYER",compName:fixture.name,layerName:layer.name,trackerName:tracker.name,pointIndex:1,repairTime:0.5,wrongFeatureCenter:[250,330],desiredRepairCenter:[276,360],preResumeFeatureCenterKeyCount:center.numKeys,preResumeAttachKeyCount:attach.numKeys,trackerPanelId:trackerPanelId,frameRate:fixture.frameRate,duration:fixture.duration,semanticId:"M4_AUTO_CORRECT_SUBJECT"};
  }catch(error){r.error=String(error);}
  write(r);
}());
