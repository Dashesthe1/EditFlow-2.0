/* EditFlow 2.0 M4 tracker repair host layer. Protocol 2.4 owns exact Feature Center repair writes. */
(function () {
  "use strict";
  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("M4 tracker repair requires the existing dispatcher.");
  var PROTOCOL = "2.4.0", BUILD = "0.5.0-dev.1";
  var CAP_READ = "ae.tracker.repair.readback", CAP_SET = "ae.tracker.repair.feature_center.set";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:", MARKER_SUFFIX = "]]", EPSILON = 0.000001;

  function nowMs(){return (new Date()).getTime();}
  function asString(v){return v===null||v===undefined?"":String(v);}
  function fail(category,code,message,details){var e=new Error(message);e.editflowCategory=category;e.editflowCode=code;e.editflowDetails=details===undefined?null:details;throw e;}
  function reject(code,message,details){fail("VALIDATION",code,message,details);}
  function conflict(code,message,details){fail("CONFLICT",code,message,details);}
  function markerValue(text,prefix){var s=asString(text),start=s.indexOf(prefix),end;if(start<0)return null;start+=prefix.length;end=s.indexOf(MARKER_SUFFIX,start);return end<0?null:s.substring(start,end);}
  function itemStableId(item){try{return markerValue(item.comment,STABLE_PREFIX);}catch(_){return null;}}
  function layerStableId(layer){try{return markerValue(layer.comment,STABLE_PREFIX);}catch(_){return null;}}
  function hostIdOf(object){try{return typeof object.id==="number"?object.id:null;}catch(_){return null;}}
  function finite(v){return typeof v==="number"&&isFinite(v);}
  function positiveInt(v){return typeof v==="number"&&isFinite(v)&&Math.floor(v)===v&&v>0;}
  function vector2(value,label){
    if(!value||typeof value.length!=="number"||value.length<2||!finite(Number(value[0]))||!finite(Number(value[1]))) reject("TRACKER_REPAIR_VECTOR_INVALID",label+" must be a finite 2D vector.");
    return [Number(value[0]),Number(value[1])];
  }
  function findItem(ref){
    if(!ref||typeof ref!=="object")reject("OBJECT_REF_REQUIRED","Object reference is required.");
    var project=app.project,i,item;if(!project)reject("PROJECT_REQUIRED","An open project is required.");
    if(typeof ref.hostId==="number"&&project.itemByID){try{item=project.itemByID(ref.hostId);if(item)return item;}catch(_){}}
    for(i=1;i<=project.numItems;i+=1){item=project.item(i);if(ref.stableId&&itemStableId(item)===ref.stableId)return item;try{if(typeof ref.hostId==="number"&&item.id===ref.hostId)return item;}catch(_){}}
    return null;
  }
  function findComp(ref){var item=findItem(ref);if(!item||!(item instanceof CompItem))reject("COMP_NOT_FOUND","Composition reference did not resolve.");return item;}
  function findLayer(comp,ref){
    if(!ref||typeof ref!=="object")reject("LAYER_REF_REQUIRED","Layer reference is required.");
    var i,layer;if(typeof ref.hostId==="number"&&app.project.layerByID){try{layer=app.project.layerByID(ref.hostId);if(layer&&layer.containingComp===comp)return layer;}catch(_){}}
    for(i=1;i<=comp.numLayers;i+=1){layer=comp.layer(i);if(ref.stableId&&layerStableId(layer)===ref.stableId)return layer;try{if(typeof ref.hostId==="number"&&layer.id===ref.hostId)return layer;}catch(_){}}
    reject("LAYER_NOT_FOUND","Layer reference did not resolve in target composition.");
  }
  function requireExpectedRevision(request){
    if(typeof request.expectedHostProjectRevision!=="number")reject("EXPECTED_HOST_REVISION_REQUIRED","Mutating tracker-repair commands require expectedHostProjectRevision.");
    var actual=app.project?app.project.revision:null;if(actual!==request.expectedHostProjectRevision)conflict("HOST_REVISION_CONFLICT","Host project revision does not match expected revision.",{expectedHostProjectRevision:request.expectedHostProjectRevision,actualHostProjectRevision:actual});
  }
  function resolveTarget(payload){
    if(!positiveInt(payload.trackerIndex)||!positiveInt(payload.pointIndex))reject("TRACKER_REPAIR_INDEX_INVALID","trackerIndex and pointIndex must be positive integers.");
    if(!finite(payload.time)||payload.time<0)reject("TRACKER_REPAIR_TIME_INVALID","time must be a finite non-negative number.");
    var comp=findComp(payload.comp),layer=findLayer(comp,payload.layer),motion=null,tracker=null,point=null;
    try{motion=layer.property("ADBE MTrackers");}catch(_){motion=null;}
    if(!motion||payload.trackerIndex>motion.numProperties)reject("TRACKER_NOT_FOUND","trackerIndex does not address an existing tracker.");
    tracker=motion.property(payload.trackerIndex);if(!tracker||tracker.matchName!=="ADBE MTracker")reject("TRACKER_NOT_FOUND","trackerIndex did not resolve an ADBE MTracker.");
    if(payload.pointIndex>tracker.numProperties)reject("TRACK_POINT_NOT_FOUND","pointIndex does not address an existing tracker point.");
    point=tracker.property(payload.pointIndex);if(!point||point.matchName!=="ADBE MTracker Pt")reject("TRACK_POINT_NOT_FOUND","pointIndex did not resolve an ADBE MTracker Pt.");
    var center=point.property("ADBE MTracker Pt Feature Center");if(!center)fail("CAPABILITY_UNAVAILABLE","FEATURE_CENTER_UNAVAILABLE","Feature Center property is unavailable.");
    return{comp:comp,layer:layer,tracker:tracker,point:point,center:center,trackerIndex:payload.trackerIndex,pointIndex:payload.pointIndex,time:Number(payload.time)};
  }
  function readKeys(property){var out=[],i,v;for(i=1;i<=property.numKeys;i+=1){v=vector2(property.keyValue(i),"Feature Center key");out.push({time:Number(property.keyTime(i)),value:v});}return out;}
  function exactKeyAt(property,time,comp){if(property.numKeys<1)return 0;var index=property.nearestKeyIndex(time),tolerance=Math.max(EPSILON,comp&&finite(comp.frameDuration)?comp.frameDuration/1000:EPSILON);return index>=1&&Math.abs(property.keyTime(index)-time)<=tolerance?index:0;}
  function readTarget(target){
    var exact=exactKeyAt(target.center,target.time,target.comp),value=vector2(target.center.valueAtTime(target.time,false),"Feature Center readback");
    return{comp:{stableId:itemStableId(target.comp),hostId:hostIdOf(target.comp),name:target.comp.name},layer:{stableId:layerStableId(target.layer),hostId:hostIdOf(target.layer),name:target.layer.name,index:target.layer.index},trackerIndex:target.trackerIndex,trackerName:target.tracker.name,pointIndex:target.pointIndex,pointName:target.point.name,time:target.time,featureCenter:{keyCount:target.center.numKeys,exactKeyAtTime:exact>0,valueAtTime:value,keys:readKeys(target.center)}};
  }
  function sameVector(a,b){return a&&b&&a.length>=2&&b.length>=2&&Math.abs(a[0]-b[0])<=0.000001&&Math.abs(a[1]-b[1])<=0.000001;}
  function sameKeys(a,b){if(!a||!b||a.length!==b.length)return false;var i;for(i=0;i<a.length;i+=1){if(Math.abs(a[i].time-b[i].time)>EPSILON||!sameVector(a[i].value,b[i].value))return false;}return true;}
  function sameReadback(a,b){return !!a&&!!b&&a.trackerIndex===b.trackerIndex&&a.pointIndex===b.pointIndex&&Math.abs(a.time-b.time)<=EPSILON&&a.featureCenter.keyCount===b.featureCenter.keyCount&&a.featureCenter.exactKeyAtTime===b.featureCenter.exactKeyAtTime&&sameVector(a.featureCenter.valueAtTime,b.featureCenter.valueAtTime)&&sameKeys(a.featureCenter.keys,b.featureCenter.keys);}
  function response(request,outcome,error,affected,readbackValue,started,notes){return $.global.EditFlow2_JSON.stringify({protocolVersion:PROTOCOL,requestId:request.requestId,transactionId:request.transactionId,operationId:request.operationId,capabilityId:request.capabilityId,command:request.command,outcome:outcome,error:error,affectedObjects:affected||[],readback:readbackValue||null,hostProjectRevision:app.project?app.project.revision:null,diagnostics:{adapterProtocolVersion:PROTOCOL,adapterBuild:BUILD,command:request.command,durationMs:nowMs()-started,notes:notes||[]}});}
  function errorPayload(error){return{category:error.editflowCategory||"HOST_FAILURE",code:error.editflowCode||"TRACKER_REPAIR_HOST_FAILURE",message:asString(error.message||error),details:error.editflowDetails===undefined?null:error.editflowDetails};}
  function maybeInjectP4Failure(request){if(request.readbackProfile==="M4_TRACKER_REPAIR_P4_FAILURE_INJECTION"&&$.getenv("EDITFLOW_M4_TRACKER_REPAIR_P4_PROOF")==="1")fail("PROOF_INJECTION","M4_TRACKER_REPAIR_P4_INDUCED_FAILURE","Induced tracker-repair failure after host mutation for rollback proof.");}

  $.global.EditFlow2_dispatch=function(requestJson){
    var request=null;try{request=$.global.EditFlow2_JSON.parse(requestJson);}catch(_){return previousDispatch(requestJson);}
    if(!request||request.protocolVersion!==PROTOCOL||(request.command!=="tracker.repair.readback"&&request.command!=="tracker.repair.set_feature_center"))return previousDispatch(requestJson);
    var started=nowMs(),payload=request.payload||{},target,before,after,desired,mutationStarted=false,undoOpen=false;
    try{
      var expectedCapability=request.command==="tracker.repair.readback"?CAP_READ:CAP_SET;
      if(request.capabilityId!==expectedCapability)reject("CAPABILITY_COMMAND_MISMATCH","capabilityId does not match tracker-repair command.");
      target=resolveTarget(payload);
      if(request.command==="tracker.repair.readback")return response(request,"NO_OP",null,[],readTarget(target),started,["Read-only exact tracker Feature Center readback."]);
      requireExpectedRevision(request);desired=vector2(payload.featureCenter,"featureCenter");before=readTarget(target);
      if(before.featureCenter.exactKeyAtTime&&sameVector(before.featureCenter.valueAtTime,desired))return response(request,"NO_OP",null,[],before,started,["Requested repair key already matches host state."]);
      app.beginUndoGroup("EditFlow M4 tracker repair");undoOpen=true;mutationStarted=true;
      target.center.setValueAtTime(target.time,desired);after=readTarget(target);
      if(!after.featureCenter.exactKeyAtTime||!sameVector(after.featureCenter.valueAtTime,desired))fail("READBACK","TRACKER_REPAIR_READBACK_MISMATCH","Feature Center repair did not match exact host readback.",{expected:desired,actual:after.featureCenter.valueAtTime});
      maybeInjectP4Failure(request);app.endUndoGroup();undoOpen=false;
      return response(request,"APPLIED",null,[{kind:"LAYER",stableId:layerStableId(target.layer),hostId:hostIdOf(target.layer)}],after,started,["Feature Center repair key applied at exact time and read back."]);
    }catch(error){
      var closeError=null;if(undoOpen){try{app.endUndoGroup();}catch(e){closeError=e;}undoOpen=false;}
      if(mutationStarted){
        var rollbackError=closeError,restored=null;if(!rollbackError){try{app.executeCommand(16);}catch(undoError){rollbackError=undoError;}}
        if(rollbackError)return response(request,"FAILED",{category:"ROLLBACK_FAILURE",code:"TRACKER_REPAIR_ROLLBACK_FAILED",message:asString(rollbackError),details:{mutationError:errorPayload(error)}},[],null,started,["Tracker repair failed and transaction undo also failed."]);
        try{target=resolveTarget(payload);restored=readTarget(target);}catch(_){restored=null;}
        if(!sameReadback(before,restored))return response(request,"FAILED",{category:"ROLLBACK_FAILURE",code:"TRACKER_REPAIR_ROLLBACK_READBACK_MISMATCH",message:"Tracker repair undo completed but exact Feature Center keys were not restored.",details:{mutationError:errorPayload(error),expected:before,actual:restored}},[],restored,started,["Tracker repair rollback failed exact readback verification."]);
        return response(request,"FAILED",errorPayload(error),[],restored,started,["Tracker repair mutation failed and was rolled back with exact Feature Center key restoration."]);
      }
      return response(request,error.editflowCategory==="VALIDATION"||error.editflowCategory==="CONFLICT"?"REJECTED":"FAILED",errorPayload(error),[],null,started,["Protocol 2.4 tracker-repair command failed closed before host mutation."]);
    }
  };
  $.global.EditFlow2_HOST_PROTOCOL_24=true;
}());
