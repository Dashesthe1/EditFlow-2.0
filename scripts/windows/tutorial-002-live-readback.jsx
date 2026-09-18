(function () {
  "use strict";
  var root = new File($.fileName).parent.parent.parent;
  var dir = new Folder(root.fsName + "/proofs/artifacts/tutorial-002-live");dir.create();
  var out = new File(dir.fsName + "/readback.json");
  var png = new File(dir.fsName + "/final-5000ms.png");
  var loader = new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v23.jsx");
  function write(v){out.open("w");out.encoding="UTF-8";out.write(JSON.stringify(v));out.close();}
  function stable(item,id){return item && String(item.comment||"").indexOf("[[EDITFLOW2_STABLE:"+id+"]]")>=0;}
  function findComp(id){for(var i=1;i<=app.project.numItems;i+=1){var x=app.project.item(i);if(x instanceof CompItem&&stable(x,id))return x;}return null;}
  function val(p){try{return p.value;}catch(_){return null;}}
  var r={proof:"M5_TUTORIAL_002_LIVE_READBACK_V1",ok:false};
  try{
    if(!loader.exists)throw new Error("protocol 2.3 loader missing");$.evalFile(loader);
    var comp=findComp("T002_STAB_COMP");if(!comp)throw new Error("Tutorial 002 proof comp missing.");
    var layer=null,i;for(i=1;i<=comp.numLayers;i+=1){if(stable(comp.layer(i),"T002_STAB_LAYER")){layer=comp.layer(i);break;}}
    if(!layer)throw new Error("Tutorial 002 proof layer missing.");
    var req={protocolVersion:"2.3.0",requestId:"T002_LIVE_READBACK",transactionId:"T002_LIVE_READBACK",operationId:"T002_LIVE_READBACK",capabilityId:"ae.stabilization.readback",command:"stabilization.readback",expectedHostProjectRevision:null,payload:{comp:{hostId:comp.id},layer:{hostId:layer.id}},readbackProfile:"T002_LIVE"};
    var response=$.global.EditFlow2_JSON.parse($.global.EditFlow2_dispatch($.global.EditFlow2_JSON.stringify(req)));
    var rb=response.readback,trackerMax=0;for(i=0;rb&&rb.trackers&&i<rb.trackers.length;i+=1){var t=rb.trackers[i];trackerMax=Math.max(trackerMax,t.featureCenterKeyCount,t.confidenceKeyCount,t.attachPointKeyCount);}
    var parade=layer.property("ADBE Effect Parade"),tile=null;if(parade){for(i=1;i<=parade.numProperties;i+=1){if(parade.property(i).matchName==="ADBE Tile"){tile=parade.property(i);break;}}}
    var tr=layer.property("ADBE Transform Group"),position=tr?val(tr.property("ADBE Position")):null,scale=tr?val(tr.property("ADBE Scale")):null;
    r.structural={trackerMaxKeyCount:trackerMax,anchorKeyCount:rb&&rb.transform&&rb.transform.anchorPoint?rb.transform.anchorPoint.keyCount:0,tile:tile?{outputWidth:val(tile.property("ADBE Tile-0004")),outputHeight:val(tile.property("ADBE Tile-0005")),mirrorEdges:val(tile.property("ADBE Tile-0006"))}:null,position:position,scale:scale,compMotionBlur:comp.motionBlur,layerMotionBlur:layer.motionBlur};
    if(png.exists&&!png.remove())throw new Error("Unable to remove stale Tutorial 002 proof frame.");
    comp.time=5.0;comp.openInViewer();try{comp.saveFrameToPng(comp.time,png);}catch(frameError){r.frameError=String(frameError);}
    r.finalFrame=png.fsName;
    r.ok=response.outcome==="NO_OP"&&trackerMax>=2&&r.structural.anchorKeyCount>=2&&!!r.structural.tile&&r.structural.tile.outputWidth>=120&&r.structural.tile.outputHeight>=116&&!!r.structural.compMotionBlur&&!!r.structural.layerMotionBlur;
    r.response=response;
  }catch(e){r.failure=String(e);}finally{write(r);}
}());
