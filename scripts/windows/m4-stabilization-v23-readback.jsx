(function () {
  "use strict";
  var root = new File($.fileName).parent.parent.parent;
  var out = new File(root.fsName + "/proofs/artifacts/m4-stabilization-v23-readback.json");
  var loader = new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v23.jsx");
  function write(v){out.parent.create();out.open("w");out.encoding="UTF-8";out.write(JSON.stringify(v));out.close();}
  function findComp(name){for(var i=1;i<=app.project.numItems;i+=1){var item=app.project.item(i);if(item instanceof CompItem&&item.name===name)return item;}return null;}
  var result={proof:"M4_STABILIZATION_V23_READBACK",ok:false};
  try{
    if(!loader.exists)throw new Error("protocol 2.3 loader missing");
    $.evalFile(loader);
    if(!$.global.EditFlow2_HOST_PROTOCOL_23||typeof $.global.EditFlow2_dispatch!=="function")throw new Error("protocol 2.3 dispatcher unavailable");
    var comp=findComp("EF2_M4_STABILIZE_FIXTURE");if(!comp||comp.numLayers<1)throw new Error("stabilization fixture unavailable");
    var layer=comp.layer(1);
    var request={protocolVersion:"2.3.0",requestId:"M4_STABILIZE_V23_LIVE",transactionId:"M4_STABILIZE_V23_LIVE",operationId:"M4_STABILIZE_V23_LIVE",capabilityId:"ae.stabilization.readback",command:"stabilization.readback",expectedHostProjectRevision:null,payload:{comp:{hostId:comp.id},layer:{hostId:layer.id}},readbackProfile:"M4_STABILIZATION_STRUCTURAL"};
    var response=$.global.EditFlow2_JSON.parse($.global.EditFlow2_dispatch($.global.EditFlow2_JSON.stringify(request)));
    var rb=response.readback,trackerMax=0,i,t;
    if(rb&&rb.trackers){for(i=0;i<rb.trackers.length;i+=1){t=rb.trackers[i];trackerMax=Math.max(trackerMax,t.featureCenterKeyCount,t.confidenceKeyCount,t.attachPointKeyCount);}}
    var anchor=rb?rb.transform.anchorPoint:null;
    result.ok=response.outcome==="NO_OP"&&!!rb&&rb.comp.hostId===comp.id&&rb.layer.hostId===layer.id&&trackerMax>=2&&!!anchor&&anchor.keyCount>=2&&anchor.samples.length>=2;
    result.hostProtocol23=!!$.global.EditFlow2_HOST_PROTOCOL_23;result.compHostId=comp.id;result.layerHostId=layer.id;result.trackerCount=rb?rb.trackers.length:0;result.trackerMaxKeyCount=trackerMax;result.anchorPointKeyCount=anchor?anchor.keyCount:0;result.positionKeyCount=rb?rb.transform.position.keyCount:-1;result.scaleKeyCount=rb?rb.transform.scale.keyCount:-1;result.rotationKeyCount=rb?rb.transform.rotation.keyCount:-1;result.hostProjectRevision=response.hostProjectRevision;result.response=response;
  }catch(e){result.failure=String(e);}finally{write(result);}
}());
