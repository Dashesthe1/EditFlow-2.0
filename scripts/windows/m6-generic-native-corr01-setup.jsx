(function () {
  "use strict";
  var cfgFile=new File(Folder.temp.fsName+"/M6_generic_native_corr01_window.json"),duration=1,width=640,height=360,fps=30;
  if(cfgFile.exists){
    try{
      cfgFile.open("r");var cfg=eval("("+cfgFile.read()+")");cfgFile.close();
      if(cfg&&typeof cfg.durationSeconds==="number"&&isFinite(cfg.durationSeconds))duration=Math.max(0.5,Math.min(5,cfg.durationSeconds));
      if(cfg&&typeof cfg.width==="number"&&isFinite(cfg.width))width=Math.max(64,Math.min(4096,Math.round(cfg.width)));
      if(cfg&&typeof cfg.height==="number"&&isFinite(cfg.height))height=Math.max(64,Math.min(4096,Math.round(cfg.height)));
      if(cfg&&typeof cfg.frameRate==="number"&&isFinite(cfg.frameRate))fps=Math.max(12,Math.min(120,cfg.frameRate));
    }catch(ignore){try{cfgFile.close();}catch(ignore2){}}
  }
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_CORR01_PROOF__",sourceName="__EF2_M6_GENERIC_NATIVE_CORR01_SOURCE__";
  for(var i=p.numItems;i>=1;i--){var x=p.item(i);if(x instanceof CompItem&&(x.name===name||x.name===sourceName))x.remove();}
  var source=p.items.addComp(sourceName,width,height,1,duration,fps);
  source.comment="[[EDITFLOW2_STABLE:m6-proof-corr01-source-comp]]";
  var background=source.layers.addSolid([0.02,0.02,0.02],"M6 Echo Background",width,height,1,duration);
  background.source.comment="[[EDITFLOW2_STABLE:m6-proof-corr01-solid-background]]";
  background.startTime=0;background.inPoint=0;background.outPoint=duration;
  var subjectSize=Math.max(32,Math.round(Math.min(width,height)*0.18));
  var content=source.layers.addSolid([0.95,0.95,0.95],"M6 Echo Subject",subjectSize,subjectSize,1,duration);
  content.source.comment="[[EDITFLOW2_STABLE:m6-proof-corr01-solid-subject]]";
  content.startTime=0;content.inPoint=0;content.outPoint=duration;
  var margin=Math.max(subjectSize/2+4,width*0.08),contentPosition=content.property("ADBE Transform Group").property("ADBE Position");
  contentPosition.setValueAtTime(0,[margin,height/2]);
  contentPosition.setValueAtTime(duration,[width-margin,height/2]);
  var c=p.items.addComp(name,width,height,1,duration,fps);
  c.comment="[[EDITFLOW2_STABLE:m6-proof-corr01-comp]]";
  var l=c.layers.add(source);
  l.name="M6 Generic Hero";
  l.comment="[[EDITFLOW2_STABLE:m6-proof-corr01-hero]]";
  l.startTime=0;l.inPoint=0;l.outPoint=duration;
  c.openInViewer();
}());
