(function () {
  "use strict";
  var cfgFile=new File(Folder.temp.fsName+"/M6_generic_native_corr01_window.json"),duration=1;
  if(cfgFile.exists){
    try{
      cfgFile.open("r");var cfg=eval("("+cfgFile.read()+")");cfgFile.close();
      if(cfg&&typeof cfg.durationSeconds==="number"&&isFinite(cfg.durationSeconds)){
        duration=Math.max(0.5,Math.min(5,cfg.durationSeconds));
      }
    }catch(ignore){try{cfgFile.close();}catch(ignore2){}}
  }
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_CORR01_PROOF__",c=null;
  for(var i=1;i<=p.numItems;i++){var x=p.item(i);if(x instanceof CompItem&&x.name===name){c=x;break;}}
  if(!c)throw new Error("M6_GENERIC_RENDER_COMP_MISSING");
  var rq=app.project.renderQueue.items.add(c);rq.applyTemplate("Draft Settings");
  rq.timeSpanStart=0;rq.timeSpanDuration=Math.min(duration,c.duration);
  var om=rq.outputModule(1);om.applyTemplate("H.264 - Match Render Settings -  5 Mbps");
  var out=new File(Folder.temp.fsName+"/M6_generic_native_corr01_candidate.mp4");
  if(out.exists)out.remove();om.file=out;app.project.renderQueue.render();
  if(!out.exists||out.length<=0)throw new Error("M6_GENERIC_RENDER_EMPTY");
  rq.remove();
}());
