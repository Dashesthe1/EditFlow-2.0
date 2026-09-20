(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_PROOF__",c=null;
  for(var i=1;i<=p.numItems;i++){var x=p.item(i);if(x instanceof CompItem&&x.name===name){c=x;break;}}
  if(!c)throw new Error("M6_ECHO_PROOF_COMP_MISSING");
  var echoLayer=null,echo=null;
  for(var j=1;j<=c.numLayers;j++){var l=c.layer(j),fx=l.property("ADBE Effect Parade");
    for(var e=1;e<=fx.numProperties;e++)if(fx.property(e).matchName==="ADBE Echo"){echoLayer=l;echo=fx.property(e);break;}
    if(echoLayer)break;
  }
  if(!echoLayer||!echo)throw new Error("M6_ECHO_EFFECT_MISSING");
  var source=echoLayer.source;
  if(!(source instanceof CompItem))throw new Error("M6_ECHO_SOURCE_NOT_PRECOMP");
  var inner=null;
  for(var q=1;q<=source.numLayers;q++)if(source.layer(q).comment.indexOf("[[EDITFLOW2_STABLE:m6-proof-hero]]")>=0){inner=source.layer(q);break;}
  if(!inner)throw new Error("M6_ECHO_INNER_HERO_MISSING");
  var pos=inner.property("ADBE Transform Group").property("ADBE Position");
  var scriptFile=new File($.fileName),root=scriptFile.parent.parent.parent;
  var f=new File(root.fsName+"/.tmp/m6-native-echo-causal-readback.txt");
  if(!f.open("w"))throw new Error("M6_ECHO_CAUSAL_READBACK_OPEN_FAILED");
  f.writeln("OUTER_LAYER\t"+echoLayer.name+"\t"+echoLayer.comment);
  f.writeln("INNER_COMP\t"+source.name+"\t"+source.comment);
  f.writeln("INNER_LAYER\t"+inner.name+"\t"+inner.comment);
  f.writeln("INNER_POSITION_EXPR\t"+(pos.expressionEnabled?pos.expression:""));
  f.writeln("INNER_TIMING\t"+inner.startTime+"\t"+inner.inPoint+"\t"+inner.outPoint+"\t"+inner.stretch);
  var sampleTimes=[0.35,0.4,0.4333333333333333,0.4666666666666667,0.5,0.55];
  for(var s=0;s<sampleTimes.length;s++){var pv=pos.valueAtTime(sampleTimes[s],false);f.writeln("POS_AT\t"+sampleTimes[s]+"\t"+pv[0]+"\t"+pv[1]);}
  f.writeln("EFFECT\t1\t"+echo.name+"\t"+echo.matchName+"\t"+(echo.enabled?"1":"0"));
  for(var z=1;z<=echo.numProperties;z++){var ep=echo.property(z);if(ep&&ep.propertyType===PropertyType.PROPERTY)f.writeln("EFFECT_PROP\t1\t"+z+"\t"+ep.matchName+"\t"+ep.value);}
  f.close();
}());
