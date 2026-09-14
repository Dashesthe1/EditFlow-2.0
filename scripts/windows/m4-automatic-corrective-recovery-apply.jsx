(function () {
  "use strict";
  var root = new File($.fileName).parent.parent.parent;
  var jsonRuntime = new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_json.jsx");
  if(!jsonRuntime.exists)throw new Error("EditFlow JSON runtime missing.");$.evalFile(jsonRuntime);
  var JSONX=$.global.EditFlow2_JSON;if(!JSONX)throw new Error("EditFlow JSON runtime failed to load.");
  var fixtureFile = new File(root.fsName + "/proofs/artifacts/m4-automatic-corrective-recovery-fixture.json");
  var planFile = new File(root.fsName + "/proofs/artifacts/m4-automatic-corrective-recovery-plan.json");
  var out = new File(root.fsName + "/proofs/artifacts/m4-automatic-corrective-recovery-apply.json");
  var loader = new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v24.jsx");
  function write(v){out.parent.create();out.open("w");out.encoding="UTF-8";out.write(JSONX.stringify(v));out.close();}
  function readJson(file){file.open("r");var text=file.read();file.close();return JSONX.parse(text);}
  function same2(a,b,tol){return a&&b&&a.length>=2&&b.length>=2&&Math.abs(Number(a[0])-Number(b[0]))<=tol&&Math.abs(Number(a[1])-Number(b[1]))<=tol;}
  function dispatch(op,suffix,expected){var request={protocolVersion:op.protocolVersion,requestId:"M4_ACR_"+suffix,transactionId:"M4_ACR_TX_"+suffix,operationId:"M4_ACR_OP_"+suffix,capabilityId:op.capabilityId,command:op.command,expectedHostProjectRevision:expected,payload:op.payload,readbackProfile:"M4_AUTOMATIC_CORRECTIVE_RECOVERY_REAL_AE"};return $.global.EditFlow2_JSON.parse($.global.EditFlow2_dispatch($.global.EditFlow2_JSON.stringify(request)));}
  function bindingMatches(readback,fixture){return !!readback&&readback.comp&&readback.layer&&readback.comp.hostId===fixture.fixtureCompId&&readback.layer.hostId===fixture.layerId&&readback.comp.stableId===fixture.compStableId&&readback.layer.stableId===fixture.layerStableId&&readback.trackerIndex===1&&readback.pointIndex===fixture.pointIndex;}
  var r={ok:false,checks:{}};
  try{
    if(!fixtureFile.exists||!planFile.exists)throw new Error("Automatic corrective fixture or plan evidence is missing.");
    var fixture=readJson(fixtureFile),planned=readJson(planFile),plan=planned.plan;
    if(!fixture.ok||!planned.ok||!plan)throw new Error("Automatic corrective fixture or plan was not accepted.");
    if(!loader.exists)throw new Error("Protocol 2.4 loader missing.");
    $.evalFile(loader);if(!$.global.EditFlow2_HOST_PROTOCOL_24)throw new Error("Protocol 2.4 failed to load.");
    if(!plan.operations||plan.operations.length!==3)throw new Error("Automatic corrective plan must contain exactly three operations.");
    if(plan.operations[0].phase!=="PRE_READBACK"||plan.operations[1].phase!=="CORRECT"||plan.operations[2].phase!=="POST_READBACK")throw new Error("Automatic corrective plan phase order mismatch.");
    var before=dispatch(plan.operations[0],"PRE",null);r.before=before;
    r.checks.preReadbackAccepted=before.outcome==="NO_OP"&&bindingMatches(before.readback,fixture);
    r.checks.wrongStateObserved=r.checks.preReadbackAccepted&&before.readback.featureCenter.exactKeyAtTime===true&&same2(before.readback.featureCenter.valueAtTime,fixture.wrongFeatureCenter,0.000001);
    if(!r.checks.wrongStateObserved)throw new Error("Pre-readback did not observe the deliberately wrong Feature Center on the exact bound target.");
    var applied=dispatch(plan.operations[1],"CORRECT",app.project.revision);r.applied=applied;
    r.checks.correctionApplied=applied.outcome==="APPLIED"&&bindingMatches(applied.readback,fixture);
    r.checks.applyReadbackExact=r.checks.correctionApplied&&applied.readback.featureCenter.exactKeyAtTime===true&&same2(applied.readback.featureCenter.valueAtTime,fixture.desiredRepairCenter,0.000001);
    if(!r.checks.applyReadbackExact)throw new Error("Composer-emitted correction did not match exact protocol 2.4 readback.");
    var after=dispatch(plan.operations[2],"POST",null);r.after=after;
    r.checks.postReadbackAccepted=after.outcome==="NO_OP"&&bindingMatches(after.readback,fixture);
    r.checks.postReadbackExact=r.checks.postReadbackAccepted&&after.readback.featureCenter.exactKeyAtTime===true&&same2(after.readback.featureCenter.valueAtTime,fixture.desiredRepairCenter,0.000001);
    var comp=null,layer=null;try{comp=app.project.itemByID(fixture.fixtureCompId);}catch(_){}try{layer=app.project.layerByID(fixture.layerId);}catch(_){}
    if(!comp||!layer||layer.containingComp!==comp)throw new Error("Exact automatic-corrective target could not be rebound for guarded visual resume.");
    comp.time=fixture.repairTime;for(var li=1;li<=comp.numLayers;li+=1)comp.layer(li).selected=false;layer.selected=true;comp.openInViewer();try{layer.openInViewer();}catch(_){}comp.time=fixture.repairTime;
    var tracker=layer.property("ADBE MTrackers").property(1),point=tracker.property(fixture.pointIndex);try{tracker.selected=true;point.selected=true;}catch(_){}
    var trackerPanelId=app.findMenuCommandId("Tracker");if(trackerPanelId>0)app.executeCommand(trackerPanelId);
    r.checks.visualTargetPrepared=true;
    r.ok=r.checks.preReadbackAccepted&&r.checks.wrongStateObserved&&r.checks.correctionApplied&&r.checks.applyReadbackExact&&r.checks.postReadbackAccepted&&r.checks.postReadbackExact&&r.checks.visualTargetPrepared;
  }catch(error){r.error=String(error);}
  write(r);
}());
