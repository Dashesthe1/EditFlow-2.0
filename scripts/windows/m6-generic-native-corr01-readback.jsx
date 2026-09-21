(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_CORR01_PROOF__",c=null;
  for(var i=1;i<=p.numItems;i++){var x=p.item(i);if(x instanceof CompItem&&x.name===name){c=x;break;}}
  if(!c)throw new Error("M6_GENERIC_PROOF_COMP_MISSING");
  var scriptFile=new File($.fileName),root=scriptFile.parent.parent.parent;
  var f=new File(root.fsName+"/.tmp/m6-generic-native-corr01-readback.txt");
  if(!f.open("w"))throw new Error("M6_GENERIC_READBACK_OPEN_FAILED");
  f.writeln("COMP\t"+c.name+"\t"+c.numLayers+"\t"+c.width+"\t"+c.height+"\t"+c.frameRate);
  for(var j=1;j<=c.numLayers;j++){var l=c.layer(j),t=l.property("ADBE Transform Group");
    var ppos=t.property("ADBE Position"),op=t.property("ADBE Opacity"),ap=t.property("ADBE Anchor Point");
    var tr=l.property("ADBE Time Remapping"),trExpr=(tr&&tr.expressionEnabled)?tr.expression:"";
    f.writeln("LAYER\t"+j+"\t"+l.name+"\t"+l.comment+"\t"+l.startTime+"\t"+l.inPoint+"\t"+l.outPoint);
    f.writeln("TIME_REMAP\t"+((l instanceof AVLayer&&l.timeRemapEnabled)?"1":"0")+"\t"+trExpr);
    f.writeln("POSITION_EXPR\t"+(ppos.expressionEnabled?ppos.expression:""));
    f.writeln("OPACITY_EXPR\t"+(op.expressionEnabled?op.expression:""));
    f.writeln("ANCHOR_EXPR\t"+(ap.expressionEnabled?ap.expression:""));
    var fx=l.property("ADBE Effect Parade");
    for(var e=1;e<=fx.numProperties;e++){
      var effect=fx.property(e);f.writeln("EFFECT\t"+e+"\t"+effect.name+"\t"+effect.matchName+"\t"+(effect.enabled?"1":"0"));
      for(var q=1;q<=effect.numProperties;q++){var ep=effect.property(q);if(ep&&ep.propertyType===PropertyType.PROPERTY){f.writeln("EFFECT_PROP\t"+e+"\t"+q+"\t"+ep.matchName+"\tTYPE="+ep.propertyValueType);}}
    }
  }
  f.close();
}());
