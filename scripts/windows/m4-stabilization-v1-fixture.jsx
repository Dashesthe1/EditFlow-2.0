(function () {
  "use strict";
  var root = new File($.fileName).parent.parent.parent;
  var out = new File(root.fsName + "/proofs/artifacts/m4-stabilization-v1-fixture.json");
  function write(v){out.parent.create();out.open("w");out.encoding="UTF-8";out.write(JSON.stringify(v));out.close();}
  function findByName(name){for(var i=1;i<=app.project.numItems;i+=1){if(app.project.item(i).name===name)return app.project.item(i);}return null;}
  var r={proof:"M4_STABILIZATION_V1_FIXTURE",ok:false};
  try {
    if(!app.project) throw new Error("No project open.");
    var original=findByName("Comp 1"),source=null,i,item;
    if(original && original instanceof CompItem && original.numLayers>0) source=original.layer(1).source;
    if(!source){for(i=1;i<=app.project.numItems;i+=1){item=app.project.item(i);if(item instanceof FootageItem && item.duration>0){source=item;break;}}}
    if(!source) throw new Error("A time-based footage source is required.");
    var old=findByName("EF2_M4_STABILIZE_FIXTURE"); if(old) old.remove();
    var fps=(original && original instanceof CompItem)?original.frameRate:(source.frameRate||29.9700012207031);
    var comp=app.project.items.addComp("EF2_M4_STABILIZE_FIXTURE",1080,1080,1,6,fps);
    var layer=comp.layers.add(source); layer.name="EF2_M4_STABILIZE_TARGET"; layer.comment="[[EDITFLOW2_STABLE:M4_STABILIZE_LAYER]]";
    layer.startTime=0; layer.inPoint=0; layer.outPoint=Math.min(5.8,source.duration||5.8); comp.workAreaStart=5.0; comp.workAreaDuration=0.8; comp.time=5.0;
    for(i=1;i<=comp.numLayers;i+=1) comp.layer(i).selected=false; layer.selected=true; comp.openInViewer(); try{layer.openInViewer();}catch(_){} comp.time=5.0;
    var trackerPanelId=app.findMenuCommandId("Tracker"); if(trackerPanelId>0) app.executeCommand(trackerPanelId);
    var trackers=layer.property("ADBE MTrackers"); r.ok=true; r.compHostId=comp.id; r.layerHostId=layer.id; r.sourceHostId=source.id; r.sourceName=source.name;
    r.trackerPanelCommandId=trackerPanelId; r.trackerCount=trackers?trackers.numProperties:-1; r.time=comp.time; r.frameRate=comp.frameRate;
  } catch(e){r.failure=String(e);} finally {write(r);}
}());
