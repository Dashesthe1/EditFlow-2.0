(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_CORR01_PROOF__",sourceName="__EF2_M6_GENERIC_NATIVE_CORR01_SOURCE__";
  for(var i=p.numItems;i>=1;i--){var x=p.item(i);if(x instanceof CompItem&&(x.name===name||x.name===sourceName))x.remove();}
  var source=p.items.addComp(sourceName,640,360,1,1,30);
  source.comment="[[EDITFLOW2_STABLE:m6-proof-corr01-source-comp]]";
  var background=source.layers.addSolid([0.02,0.02,0.02],"M6 Echo Background",640,360,1,1);
  background.source.comment="[[EDITFLOW2_STABLE:m6-proof-corr01-solid-background]]";
  background.startTime=0;background.inPoint=0;background.outPoint=1;
  var content=source.layers.addSolid([0.95,0.95,0.95],"M6 Echo Subject",64,64,1,1);
  content.source.comment="[[EDITFLOW2_STABLE:m6-proof-corr01-solid-subject]]";
  content.startTime=0;content.inPoint=0;content.outPoint=1;
  var contentPosition=content.property("ADBE Transform Group").property("ADBE Position");
  contentPosition.setValueAtTime(0,[50,180]);
  contentPosition.setValueAtTime(1,[590,180]);
  var c=p.items.addComp(name,640,360,1,1,30);
  c.comment="[[EDITFLOW2_STABLE:m6-proof-corr01-comp]]";
  var l=c.layers.add(source);
  l.name="M6 Generic Hero";
  l.comment="[[EDITFLOW2_STABLE:m6-proof-corr01-hero]]";
  l.startTime=0;l.inPoint=0;l.outPoint=1;
  c.openInViewer();
}());
