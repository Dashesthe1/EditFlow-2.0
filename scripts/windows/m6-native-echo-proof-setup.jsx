(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_PROOF__",sourceName="__EF2_M6_GENERIC_NATIVE_SOURCE__";
  for(var i=p.numItems;i>=1;i--){var old=p.item(i);if(old instanceof CompItem&&(old.name===name||old.name===sourceName||old.name.indexOf("echo-history-precompose")>=0))old.remove();}
  var source=p.items.addComp(sourceName,640,360,1,1,30);
  source.comment="[[EDITFLOW2_STABLE:m6-proof-source-comp]]";
  var bg=source.layers.addSolid([0.025,0.025,0.03],"M6 Echo Background",640,360,1,1);
  bg.startTime=0;bg.inPoint=0;bg.outPoint=1;
  for(var g=0;g<8;g++){
    var shade=0.08+g*0.018;
    var stripe=source.layers.addSolid([shade,shade,shade],"M6 Echo Grid V "+g,6,360,1,1);
    stripe.startTime=0;stripe.inPoint=0;stripe.outPoint=1;
    stripe.property("ADBE Transform Group").property("ADBE Position").setValue([40+g*80,180]);
  }
  for(var h=0;h<5;h++){
    var hshade=0.075+h*0.02;
    var row=source.layers.addSolid([hshade,hshade,hshade],"M6 Echo Grid H "+h,640,4,1,1);
    row.startTime=0;row.inPoint=0;row.outPoint=1;
    row.property("ADBE Transform Group").property("ADBE Position").setValue([320,45+h*68]);
  }
  var subject=source.layers.addSolid([0.92,0.92,0.92],"M6 Echo Subject",120,120,1,1);
  subject.startTime=0;subject.inPoint=0;subject.outPoint=1;
  subject.property("ADBE Transform Group").property("ADBE Position").setValue([330,180]);
  var accent=source.layers.addSolid([0.18,0.18,0.18],"M6 Echo Accent",20,170,1,1);
  accent.startTime=0;accent.inPoint=0;accent.outPoint=1;
  accent.property("ADBE Transform Group").property("ADBE Position").setValue([260,180]);
  var c=p.items.addComp(name,640,360,1,1,30);
  c.comment="[[EDITFLOW2_STABLE:m6-proof-comp]]";
  var hero=c.layers.add(source);hero.name="M6 Generic Hero";
  hero.comment="[[EDITFLOW2_STABLE:m6-proof-hero]]";hero.startTime=0;hero.inPoint=0;hero.outPoint=1;
  c.openInViewer();
}());
