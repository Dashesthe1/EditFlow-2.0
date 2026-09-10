/* EditFlow 2.0 marker/motion P5 proof-only cleanup. Retains the saved .aep. */
(function () {
  "use strict";
  var PROOF_ENV="EDITFLOW_M3_MARKER_MOTION_P5_PROOF", STABLE_PREFIX="[[EDITFLOW2_STABLE:", SUFFIX="]]";
  var proofFile=new File($.fileName), repoRoot=proofFile.parent.parent.parent;
  var artifactDir=new Folder(repoRoot.fsName+"/proofs/artifacts/m3-marker-motion-p5-transfer");
  var projectFile=new File(artifactDir.fsName+"/m3-marker-motion-p5-transfer.aep");
  var markerFile=new File(artifactDir.fsName+"/cleanup-result.json");
  function s(v){return v===null||v===undefined?"":String(v);} function samePath(a,b){return s(a).replace(/\//g,"\\").toLowerCase()===s(b).replace(/\//g,"\\").toLowerCase();}
  function stable(text){var t=s(text),a=t.indexOf(STABLE_PREFIX),b;if(a<0)return null;a+=STABLE_PREFIX.length;b=t.indexOf(SUFFIX,a);return b<0?null:t.substring(a,b);} 
  function prefixFor(v,suffix){var t=s(v);return t.length>suffix.length&&t.substring(t.length-suffix.length)===suffix?t.substring(0,t.length-suffix.length):null;}
  function q(v){return '"'+s(v).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\r/g,"\\r").replace(/\n/g,"\\n")+'"';}
  function json(v){if($.global.EditFlow2_JSON&&typeof $.global.EditFlow2_JSON.stringify==="function")return $.global.EditFlow2_JSON.stringify(v);return '{"proofId":'+q(v.proofId)+',"ok":'+(v.ok?'true':'false')+',"error":'+(v.error===null?'null':q(v.error))+',"proofPrefix":'+(v.proofPrefix===null?'null':q(v.proofPrefix))+',"blankItemCount":'+(v.blankItemCount===null?'null':v.blankItemCount)+'}';}
  function write(v){if(!artifactDir.exists&&!artifactDir.create())throw new Error("Cannot create artifact dir.");markerFile.encoding="UTF-8";if(!markerFile.open("w"))throw new Error("Cannot open cleanup marker.");try{markerFile.write(json(v));}finally{markerFile.close();}}
  var out={proofId:"M3_MARKER_MOTION_P5_CLEANUP",ok:false,error:null,proofPrefix:null,blankItemCount:null};
  try{
    if($.getenv(PROOF_ENV)!=="1")throw new Error("REFUSED: marker-motion P5 cleanup proof gate is not armed.");
    if(!app.project||!app.project.file||!samePath(app.project.file.fsName,projectFile.fsName))throw new Error("Refusing to discard a project other than the fixed marker-motion P5 project.");
    if(app.project.numItems!==2)throw new Error("Marker-motion P5 cleanup requires exactly two proof compositions; found "+app.project.numItems+".");
    var source=null,target=null,prefix=null,i,item,id,candidate;
    for(i=1;i<=app.project.numItems;i+=1){item=app.project.item(i);if(!(item instanceof CompItem))throw new Error("Non-composition found in proof project.");id=stable(item.comment);if(!id)throw new Error("Proof item lacks stable ID.");candidate=prefixFor(id,"_SOURCE_COMP");if(candidate!==null){if(source)throw new Error("Duplicate source comp.");source=item;}else{candidate=prefixFor(id,"_TARGET_COMP");if(candidate!==null){if(target)throw new Error("Duplicate target comp.");target=item;}else throw new Error("Item outside fixed P5 fixture: "+id);}if(candidate.indexOf("M3_MARKER_MOTION_P5_")!==0)throw new Error("Stable ID outside marker-motion P5 namespace.");if(prefix===null)prefix=candidate;else if(prefix!==candidate)throw new Error("Mixed P5 generations.");}
    if(!source||!target||!prefix)throw new Error("Incomplete P5 fixture.");if(source.numLayers!==0)throw new Error("Source comp must be layer-empty.");if(target.numLayers!==1)throw new Error("Target comp must contain one proof layer.");
    var layer=target.layer(1);if(stable(layer.comment)!==prefix+"_LAYER")throw new Error("Target layer is not proof-owned.");if(!layer.source||stable(layer.source.comment)!==prefix+"_SOURCE_COMP")throw new Error("Target layer source is not proof-owned.");
    var project=app.project;if(project.close(CloseOptions.DO_NOT_SAVE_CHANGES)===false)throw new Error("Could not close disposable P5 project.");app.newProject();if(!app.project||app.project.file||app.project.numItems!==0)throw new Error("Cleanup did not restore blank unsaved project.");
    out.ok=true;out.proofPrefix=prefix;out.blankItemCount=app.project.numItems;
  }catch(e){out.error=s(e);}write(out);
}());
