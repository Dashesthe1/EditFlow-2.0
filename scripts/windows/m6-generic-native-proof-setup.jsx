(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_PROOF__";
  for(var i=p.numItems;i>=1;i--){var x=p.item(i);if(x instanceof CompItem&&x.name===name)x.remove();}
  var c=p.items.addComp(name,640,360,1,1,30);
  c.comment="[[EDITFLOW2_STABLE:m6-proof-comp]]";
  var l=c.layers.addText("EditFlow M6 generic native materializer");
  l.name="M6 Generic Hero";
  l.comment="[[EDITFLOW2_STABLE:m6-proof-hero]]";
  l.startTime=0;l.inPoint=0;l.outPoint=1;
  c.openInViewer();
}());