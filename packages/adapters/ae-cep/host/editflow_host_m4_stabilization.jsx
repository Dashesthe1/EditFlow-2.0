/* EditFlow 2.0 M4 native stabilization readback host layer.
 * Protocol 2.3 is read-only: it never creates trackers, starts analysis, or applies stabilization.
 */
(function () {
  "use strict";
  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("M4 stabilization requires the existing dispatcher.");
  var PROTOCOL = "2.3.0";
  var BUILD = "0.5.0-dev.1";
  var CAPABILITY = "ae.stabilization.readback";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  function nowMs(){return (new Date()).getTime();}
  function asString(v){return v===null||v===undefined?"":String(v);}
  function fail(category,code,message,details){var e=new Error(message);e.editflowCategory=category;e.editflowCode=code;e.editflowDetails=details===undefined?null:details;throw e;}
  function reject(code,message,details){fail("VALIDATION",code,message,details);}
  function markerValue(text,prefix){var s=asString(text),start=s.indexOf(prefix),end;if(start<0)return null;start+=prefix.length;end=s.indexOf(MARKER_SUFFIX,start);return end<0?null:s.substring(start,end);}
  function itemStableId(item){try{return markerValue(item.comment,STABLE_PREFIX);}catch(_){return null;}}
  function layerStableId(layer){try{return markerValue(layer.comment,STABLE_PREFIX);}catch(_){return null;}}
  function hostIdOf(object){try{return typeof object.id==="number"?object.id:null;}catch(_){return null;}}
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
  function numericValue(value){var i,r;if(typeof value==="number"&&isFinite(value))return Number(value);if(!value||typeof value.length!=="number"||typeof value==="string")return null;r=[];for(i=0;i<value.length;i+=1){if(typeof value[i]!=="number"||!isFinite(value[i]))return null;r.push(Number(value[i]));}return r;}
  function propertyReadback(property){var samples=[],i,value;if(!property)return{name:"",matchName:"",keyCount:0,samples:[]};for(i=1;i<=property.numKeys;i+=1){try{value=numericValue(property.keyValue(i));}catch(_){value=null;}if(value!==null)samples.push({time:property.keyTime(i),value:value});}return{name:property.name,matchName:property.matchName,keyCount:property.numKeys,samples:samples};}
  function keyCount(point,matchName){var p=null;try{p=point.property(matchName);}catch(_){p=null;}return p&&typeof p.numKeys==="number"?p.numKeys:0;}
  function readTrackers(layer){
    var motion=null,result=[],i,tracker,j,point;try{motion=layer.property("ADBE MTrackers");}catch(_){motion=null;}if(!motion)return result;
    for(i=1;i<=motion.numProperties;i+=1){tracker=motion.property(i);if(!tracker||tracker.matchName!=="ADBE MTracker")continue;for(j=1;j<=tracker.numProperties;j+=1){point=tracker.property(j);if(!point||point.matchName!=="ADBE MTracker Pt")continue;result.push({trackerIndex:i,name:tracker.name,matchName:tracker.matchName,pointIndex:j,pointName:point.name,featureCenterKeyCount:keyCount(point,"ADBE MTracker Pt Feature Center"),confidenceKeyCount:keyCount(point,"ADBE MTracker Pt Confidence"),attachPointKeyCount:keyCount(point,"ADBE MTracker Pt Attach Pt")});}}
    return result;
  }
  function readback(comp,layer){
    var transform=layer.property("ADBE Transform Group");
    return{
      comp:{stableId:itemStableId(comp),hostId:hostIdOf(comp),name:comp.name,width:comp.width,height:comp.height},
      layer:{stableId:layerStableId(layer),hostId:hostIdOf(layer),name:layer.name,index:layer.index},
      trackers:readTrackers(layer),
      transform:{
        anchorPoint:propertyReadback(transform.property("ADBE Anchor Point")),
        position:propertyReadback(transform.property("ADBE Position")),
        scale:propertyReadback(transform.property("ADBE Scale")),
        rotation:propertyReadback(transform.property("ADBE Rotate Z"))
      }
    };
  }
  function response(request,outcome,error,value,started,notes){return $.global.EditFlow2_JSON.stringify({protocolVersion:PROTOCOL,requestId:request.requestId,transactionId:request.transactionId,operationId:request.operationId,capabilityId:request.capabilityId,command:request.command,outcome:outcome,error:error,affectedObjects:[],readback:value||null,hostProjectRevision:app.project?app.project.revision:null,diagnostics:{adapterProtocolVersion:PROTOCOL,adapterBuild:BUILD,command:request.command,durationMs:nowMs()-started,notes:notes||[]}});}
  function errorPayload(error){return{category:error.editflowCategory||"HOST_FAILURE",code:error.editflowCode||"STABILIZATION_HOST_FAILURE",message:asString(error.message||error),details:error.editflowDetails===undefined?null:error.editflowDetails};}
  $.global.EditFlow2_dispatch=function(requestJson){
    var request=null;try{request=$.global.EditFlow2_JSON.parse(requestJson);}catch(_){return previousDispatch(requestJson);}
    if(!request||request.protocolVersion!==PROTOCOL||request.command!=="stabilization.readback")return previousDispatch(requestJson);
    var started=nowMs(),payload=request.payload||{},comp,layer;
    try{
      if(request.capabilityId!==CAPABILITY)reject("CAPABILITY_COMMAND_MISMATCH","capabilityId does not match stabilization.readback.");
      comp=findComp(payload.comp);layer=findLayer(comp,payload.layer);
      return response(request,"NO_OP",null,readback(comp,layer),started,["Read-only native stabilization tracker and transform-keyframe readback.","Protocol 2.3 never starts analysis or applies stabilization."]);
    }catch(error){return response(request,error.editflowCategory==="VALIDATION"?"REJECTED":"FAILED",errorPayload(error),null,started,["Stabilization readback failed closed without host mutation."]);}
  };
  $.global.EditFlow2_HOST_PROTOCOL_23=true;
}());
