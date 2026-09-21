(function () {
  "use strict";
  var cfgFile=new File(Folder.temp.fsName+"/M6_generic_native_case01_canvas.json"),width=640,height=360,fps=30;
  if(cfgFile.exists){
    try{
      cfgFile.open("r");var cfg=eval("("+cfgFile.read()+")");cfgFile.close();
      if(cfg&&typeof cfg.width==="number"&&isFinite(cfg.width))width=Math.max(64,Math.min(4096,Math.round(cfg.width)));
      if(cfg&&typeof cfg.height==="number"&&isFinite(cfg.height))height=Math.max(64,Math.min(4096,Math.round(cfg.height)));
      if(cfg&&typeof cfg.frameRate==="number"&&isFinite(cfg.frameRate))fps=Math.max(12,Math.min(120,cfg.frameRate));
    }catch(ignore){try{cfgFile.close();}catch(ignore2){}}
  }
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_CASE01_PROOF__",sourceName="__EF2_M6_GENERIC_NATIVE_CASE01_SOURCE__";
  for(var i=p.numItems;i>=1;i--){var x=p.item(i);if(x instanceof CompItem&&(x.name===name||x.name===sourceName||x.name.indexOf("echo-history-precompose")>=0))x.remove();}
  for(var j=p.numItems;j>=1;j--){var y=p.item(j);if(y instanceof FootageItem&&(y.name==="M6 Echo Background"||y.name==="M6 Echo Subject"))y.remove();}
  var source=p.items.addComp(sourceName,width,height,1,1,fps);
  source.comment="[[EDITFLOW2_STABLE:m6-proof-case01-source-comp]]";
  var background=source.layers.addSolid([0.02,0.02,0.02],"M6 Echo Background",width,height,1,1);
  background.startTime=0;background.inPoint=0;background.outPoint=1;
  var subjectSize=Math.max(32,Math.round(Math.min(width,height)*(64/360)));
  var content=source.layers.addSolid([0.95,0.95,0.95],"M6 Echo Subject",subjectSize,subjectSize,1,1);
  content.startTime=0;content.inPoint=0;content.outPoint=1;
  var margin=Math.max(subjectSize/2+4,width*(50/640)),contentPosition=content.property("ADBE Transform Group").property("ADBE Position");
  contentPosition.setValueAtTime(0,[margin,height/2]);
  contentPosition.setValueAtTime(1,[width-margin,height/2]);
  var c=p.items.addComp(name,width,height,1,1,fps);
  c.comment="[[EDITFLOW2_STABLE:m6-proof-case01-comp]]";
  var l=c.layers.add(source);
  l.name="M6 Generic Hero";
  l.comment="[[EDITFLOW2_STABLE:m6-proof-case01-hero]]";
  l.startTime=0;l.inPoint=0;l.outPoint=1;
  c.openInViewer();
}());
