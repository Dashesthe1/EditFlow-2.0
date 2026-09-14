/* EditFlow 2.0 M4 media-sequence host layer.
 * Fixed typed protocol 2.5 commands only. No arbitrary code execution.
 */
(function () {
  "use strict";
  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("M4 media sequence requires the existing dispatcher.");
  var PROTOCOL = "2.5.0", BUILD = "0.5.0-dev.2";
  var CAP_IMPORT = "ae.media.sequence.import", CAP_READ = "ae.media.sequence.readback";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:", MARKER_SUFFIX = "]]";

  function nowMs(){return (new Date()).getTime();}
  function asString(v){return v===null||v===undefined?"":String(v);}
  function fail(category,code,message,details){var e=new Error(message);e.editflowCategory=category;e.editflowCode=code;e.editflowDetails=details===undefined?null:details;throw e;}
  function reject(code,message,details){fail("VALIDATION",code,message,details);}
  function conflict(code,message,details){fail("CONFLICT",code,message,details);}
  function finite(v){return typeof v==="number"&&isFinite(v);}
  function positiveInt(v){return finite(v)&&Math.floor(v)===v&&v>0;}
  function markerValue(text,prefix){var s=asString(text),start=s.indexOf(prefix),end;if(start<0)return null;start+=prefix.length;end=s.indexOf(MARKER_SUFFIX,start);return end<0?null:s.substring(start,end);}
  function itemStableId(item){try{return markerValue(item.comment,STABLE_PREFIX);}catch(_){return null;}}
  function hostIdOf(object){try{return typeof object.id==="number"?object.id:null;}catch(_){return null;}}
  function setStableId(item,stableId){var marker=STABLE_PREFIX+stableId+MARKER_SUFFIX;item.comment=marker;}
  function normalizePath(value){return asString(value).replace(/\//g,"\\").replace(/\\+$/g,"").toLowerCase();}

  function findItem(ref){
    if(!ref||typeof ref!=="object")reject("OBJECT_REF_REQUIRED","Object reference is required.");
    var project=app.project,i,item;if(!project)reject("PROJECT_REQUIRED","An open project is required.");
    if(typeof ref.hostId==="number"&&project.itemByID){try{item=project.itemByID(ref.hostId);if(item)return item;}catch(_){}}
    for(i=1;i<=project.numItems;i+=1){item=project.item(i);if(ref.stableId&&itemStableId(item)===ref.stableId)return item;try{if(typeof ref.hostId==="number"&&item.id===ref.hostId)return item;}catch(_){}}
    return null;
  }
  function requireExpectedRevision(request){
    if(typeof request.expectedHostProjectRevision!=="number")reject("EXPECTED_HOST_REVISION_REQUIRED","Mutating media-sequence commands require expectedHostProjectRevision.");
    var actual=app.project?app.project.revision:null;
    if(actual!==request.expectedHostProjectRevision)conflict("HOST_REVISION_CONFLICT","Host project revision does not match expected revision.",{expectedHostProjectRevision:request.expectedHostProjectRevision,actualHostProjectRevision:actual});
  }
  function sourcePath(item){try{return item.mainSource&&item.mainSource.file?item.mainSource.file.fsName:null;}catch(_){return null;}}
  function numeric(value){return finite(value)?Number(value):0;}
  function readItem(item){
    if(!item||!(item instanceof FootageItem))reject("SEQUENCE_ITEM_NOT_FOOTAGE","Media-sequence reference did not resolve to footage.");
    var source=item.mainSource;if(!source)reject("SEQUENCE_SOURCE_UNAVAILABLE","Footage mainSource is unavailable.");
    var frameRate=numeric(item.frameRate),frameDuration=numeric(item.frameDuration),duration=numeric(item.duration);
    var frameCount=frameRate>0&&duration>=0?Math.round(duration*frameRate):0;
    return{stableId:itemStableId(item),hostId:hostIdOf(item),name:item.name,path:sourcePath(item),width:item.width,height:item.height,duration:duration,frameRate:frameRate,frameDuration:frameDuration,nativeFrameRate:numeric(source.nativeFrameRate),conformFrameRate:numeric(source.conformFrameRate),displayFrameRate:numeric(source.displayFrameRate),isStill:!!source.isStill,frameCount:frameCount};
  }

  function sameNumber(a,b){return Math.abs(Number(a)-Number(b))<=0.0001;}
  function matchesExpected(readback,pathValue,frameRate,frameCount){
    return !!readback&&!readback.isStill&&normalizePath(readback.path)===normalizePath(pathValue)&&sameNumber(readback.frameRate,frameRate)&&sameNumber(readback.displayFrameRate,frameRate)&&readback.frameCount===frameCount;
  }
  function response(request,outcome,error,affected,readbackValue,started,notes){
    return $.global.EditFlow2_JSON.stringify({protocolVersion:PROTOCOL,requestId:request.requestId,transactionId:request.transactionId,operationId:request.operationId,capabilityId:request.capabilityId,command:request.command,outcome:outcome,error:error,affectedObjects:affected||[],readback:readbackValue||null,hostProjectRevision:app.project?app.project.revision:null,diagnostics:{adapterProtocolVersion:PROTOCOL,adapterBuild:BUILD,command:request.command,durationMs:nowMs()-started,notes:notes||[]}});
  }
  function errorPayload(error){return{category:error.editflowCategory||"HOST_FAILURE",code:error.editflowCode||"MEDIA_SEQUENCE_HOST_FAILURE",message:asString(error.message||error),details:error.editflowDetails===undefined?null:error.editflowDetails};}
  function validateImportPayload(payload){
    if(!payload||typeof payload!=="object")reject("MEDIA_SEQUENCE_PAYLOAD_REQUIRED","Import payload is required.");
    if(!payload.path||!asString(payload.path).length)reject("MEDIA_SEQUENCE_PATH_REQUIRED","Sequence import requires a path to the first frame.");
    if(!payload.stableId||!asString(payload.stableId).length)reject("MEDIA_SEQUENCE_STABLE_ID_REQUIRED","Sequence import requires stableId.");
    if(!finite(payload.frameRate)||payload.frameRate<=0||payload.frameRate>99)reject("MEDIA_SEQUENCE_FRAME_RATE_INVALID","frameRate must be finite and within (0, 99].");
    if(!positiveInt(payload.expectedFrameCount))reject("MEDIA_SEQUENCE_FRAME_COUNT_INVALID","expectedFrameCount must be a positive integer.");
    var file=new File(payload.path);if(!file.exists)reject("MEDIA_SEQUENCE_FILE_NOT_FOUND","Sequence first frame does not exist.",{path:payload.path});
    return file;
  }
  function maybeInjectFailure(request){if(request.readbackProfile==="M4_MEDIA_SEQUENCE_P4_FAILURE_INJECTION"&&$.getenv("EDITFLOW_M4_MEDIA_SEQUENCE_P4_PROOF")==="1")fail("PROOF_INJECTION","M4_MEDIA_SEQUENCE_P4_INDUCED_FAILURE","Induced media-sequence failure after import for rollback proof.");}

  $.global.EditFlow2_dispatch=function(requestJson){
    var request=null;try{request=$.global.EditFlow2_JSON.parse(requestJson);}catch(_){return previousDispatch(requestJson);}
    if(!request||request.protocolVersion!==PROTOCOL||(request.command!=="media.sequence.import"&&request.command!=="media.sequence.readback"))return previousDispatch(requestJson);
    var started=nowMs(),payload=request.payload||{},item=null,beforeExisting=null,mutationStarted=false,undoOpen=false;
    try{
      var expectedCapability=request.command==="media.sequence.import"?CAP_IMPORT:CAP_READ;
      if(request.capabilityId!==expectedCapability)reject("CAPABILITY_COMMAND_MISMATCH","capabilityId does not match media-sequence command.");
      if(request.command==="media.sequence.readback"){
        item=findItem(payload.item);if(!item)reject("MEDIA_SEQUENCE_ITEM_NOT_FOUND","Sequence item reference did not resolve.");
        var readOnly=readItem(item);if(readOnly.isStill)reject("MEDIA_SEQUENCE_ITEM_IS_STILL","Referenced footage is not a temporal sequence.");
        return response(request,"NO_OP",null,[],readOnly,started,["Read-only image-sequence footage readback."]);
      }
      requireExpectedRevision(request);
      var firstFrame=validateImportPayload(payload);
      beforeExisting=findItem({stableId:payload.stableId});
      if(beforeExisting){
        var existingReadback=readItem(beforeExisting);
        if(matchesExpected(existingReadback,payload.path,Number(payload.frameRate),payload.expectedFrameCount))return response(request,"NO_OP",null,[],existingReadback,started,["Requested image sequence is already imported with matching stable identity and interpretation."]);
        conflict("MEDIA_SEQUENCE_STABLE_ID_CONFLICT","stableId already resolves to different footage state.",{stableId:payload.stableId,actual:existingReadback});
      }
      var options=new ImportOptions(firstFrame);options.sequence=true;options.forceAlphabetical=false;
      app.beginUndoGroup("EditFlow M4 media sequence import");undoOpen=true;mutationStarted=true;
      item=app.project.importFile(options);if(!item||!(item instanceof FootageItem))fail("HOST_FAILURE","MEDIA_SEQUENCE_IMPORT_NOT_FOOTAGE","After Effects did not create a FootageItem for the sequence.");
      setStableId(item,payload.stableId);
      if(item.mainSource&&item.mainSource.isStill)fail("READBACK","MEDIA_SEQUENCE_IMPORTED_AS_STILL","After Effects imported the requested sequence as a still image.");
      item.mainSource.conformFrameRate=Number(payload.frameRate);
      var after=readItem(item);
      if(!matchesExpected(after,payload.path,Number(payload.frameRate),payload.expectedFrameCount))fail("READBACK","MEDIA_SEQUENCE_READBACK_MISMATCH","Imported sequence did not match exact path, frame rate, or frame count readback.",{expected:{path:payload.path,frameRate:Number(payload.frameRate),frameCount:payload.expectedFrameCount},actual:after});
      maybeInjectFailure(request);
      app.endUndoGroup();undoOpen=false;
      return response(request,"APPLIED",null,[{kind:"FOOTAGE",stableId:payload.stableId,hostId:hostIdOf(item)}],after,started,["Native After Effects image sequence imported, conformed, and read back exactly."]);
    }catch(error){
      var closeError=null;if(undoOpen){try{app.endUndoGroup();}catch(e){closeError=e;}undoOpen=false;}
      if(mutationStarted){
        var rollbackError=closeError;if(!rollbackError){try{app.executeCommand(16);}catch(undoError){rollbackError=undoError;}}
        if(rollbackError)return response(request,"FAILED",{category:"ROLLBACK_FAILURE",code:"MEDIA_SEQUENCE_ROLLBACK_FAILED",message:asString(rollbackError),details:{mutationError:errorPayload(error)}},[],null,started,["Sequence import failed and transaction undo also failed."]);
        var surviving=findItem({stableId:payload.stableId});
        if(surviving)return response(request,"FAILED",{category:"ROLLBACK_FAILURE",code:"MEDIA_SEQUENCE_ROLLBACK_READBACK_MISMATCH",message:"Sequence import undo completed but the proof-owned stable item still resolves.",details:{mutationError:errorPayload(error),actual:readItem(surviving)}},[],readItem(surviving),started,["Sequence import rollback failed stable-identity verification."]);
        return response(request,"FAILED",errorPayload(error),[],null,started,["Sequence import mutation failed and was rolled back with stable item removal verified."]);
      }
      return response(request,error.editflowCategory==="VALIDATION"||error.editflowCategory==="CONFLICT"?"REJECTED":"FAILED",errorPayload(error),[],null,started,["Protocol 2.5 media-sequence command failed closed before host mutation."]);
    }
  };
  $.global.EditFlow2_HOST_PROTOCOL_25=true;
}());
