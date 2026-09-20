(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_PROOF__",sourceName="__EF2_M6_GENERIC_NATIVE_SOURCE__";
  for(var i=p.numItems;i>=1;i--){var x=p.item(i);if(x instanceof CompItem&&(x.name===name||x.name===sourceName))x.remove();}
  var source=p.items.addComp(sourceName,640,360,1,1,30);
  source.comment="[[EDITFLOW2_STABLE:m6-proof-source-comp]]";
  var content=source.layers.addText("EditFlow M6 generic native materializer");
  content.startTime=0;content.inPoint=0;content.outPoint=1;
  var contentPosition=content.property("ADBE Transform Group").property("ADBE Position");
  contentPosition.setValueAtTime(0,[90,180]);
  contentPosition.setValueAtTime(1,[550,180]);
  var c=p.items.addComp(name,640,360,1,1,30);
  c.comment="[[EDITFLOW2_STABLE:m6-proof-comp]]";
  var l=c.layers.add(source);
  l.name="M6 Generic Hero";
  l.comment="[[EDITFLOW2_STABLE:m6-proof-hero]]";
  l.startTime=0;l.inPoint=0;l.outPoint=1;
  c.openInViewer();
}());
