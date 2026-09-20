(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_PROOF__",c=null;
  for(var i=1;i<=p.numItems;i++){var x=p.item(i);if(x instanceof CompItem&&x.name===name){c=x;break;}}
  if(!c)throw new Error("M6_ECHO_PROOF_COMP_MISSING");
  var hero=null,echo=null;
  for(var j=1;j<=c.numLayers;j++){var candidate=c.layer(j),fx=candidate.property("ADBE Effect Parade");
    for(var e=1;e<=fx.numProperties;e++)if(fx.property(e).matchName==="ADBE Echo"){hero=candidate;echo=fx.property(e);break;}
    if(hero)break;
  }
  if(!hero||!echo)throw new Error("M6_ECHO_EFFECT_MISSING");
  echo.enabled=true;
  var rq=app.project.renderQueue.items.add(c);rq.applyTemplate("Draft Settings");rq.timeSpanStart=0.25;rq.timeSpanDuration=0.5;
  var om=rq.outputModule(1);om.applyTemplate("H.264 - Match Render Settings -  5 Mbps");
  var out=new File(Folder.temp.fsName+"/M6_native_echo_case01.mp4");if(out.exists)out.remove();om.file=out;
  app.project.renderQueue.render();
  if(!out.exists||out.length<=0)throw new Error("M6_ECHO_RENDER_EMPTY");
  rq.remove();
}());