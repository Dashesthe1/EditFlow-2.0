(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_PROOF__",c=null;
  for(var i=1;i<=p.numItems;i++){var x=p.item(i);if(x instanceof CompItem&&x.name===name){c=x;break;}}
  if(!c)throw new Error("M6_GENERIC_RENDER_COMP_MISSING");
  var rq=app.project.renderQueue.items.add(c);rq.applyTemplate("Draft Settings");
  rq.timeSpanStart=0;rq.timeSpanDuration=1;
  var om=rq.outputModule(1);om.applyTemplate("H.264 - Match Render Settings -  5 Mbps");
  var out=new File(Folder.temp.fsName+"/M6_generic_native_case01.mp4");
  if(out.exists)out.remove();om.file=out;app.project.renderQueue.render();
  if(!out.exists||out.length<=0)throw new Error("M6_GENERIC_RENDER_EMPTY");
  rq.remove();
}());
