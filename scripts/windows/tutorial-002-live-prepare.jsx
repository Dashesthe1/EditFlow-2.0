(function () {
  "use strict";
  var root = new File($.fileName).parent.parent.parent;
  var out = new File(root.fsName + "/proofs/artifacts/tutorial-002-live/prepare.json");
  function write(v){out.parent.create();out.open("w");out.encoding="UTF-8";out.write(JSON.stringify(v));out.close();}
  function stable(item,id){return item && String(item.comment||"").indexOf("[[EDITFLOW2_STABLE:"+id+"]]")>=0;}
  function findComp(id){for(var i=1;i<=app.project.numItems;i+=1){var x=app.project.item(i);if(x instanceof CompItem&&stable(x,id))return x;}return null;}
  var result={proof:"M5_TUTORIAL_002_LIVE_PREPARE_V1",ok:false};
  try{
    if(!app.project)throw new Error("No project open.");
    var comp=findComp("T002_STAB_COMP");if(!comp)throw new Error("Tutorial 002 proof comp missing.");
    var layer=null;for(var i=1;i<=comp.numLayers;i+=1){if(stable(comp.layer(i),"T002_STAB_LAYER")){layer=comp.layer(i);break;}}
    if(!layer)throw new Error("Tutorial 002 proof layer missing.");
    for(i=1;i<=comp.numLayers;i+=1)comp.layer(i).selected=false;
    layer.selected=true;comp.workAreaStart=5.0;comp.workAreaDuration=0.8;comp.time=5.0;
    comp.openInViewer();try{layer.openInViewer();}catch(_){}
    var trackerPanelId=app.findMenuCommandId("Tracker");
    result.ok=true;result.compHostId=comp.id;result.layerHostId=layer.id;result.compName=comp.name;result.layerName=layer.name;result.time=comp.time;result.trackerPanelCommandId=trackerPanelId;result.trackerPanelMutated=false;
  }catch(e){result.failure=String(e);}finally{write(result);}
}());
