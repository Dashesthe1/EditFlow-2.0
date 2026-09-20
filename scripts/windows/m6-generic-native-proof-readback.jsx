(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_PROOF__",c=null;
  for(var i=1;i<=p.numItems;i++){var x=p.item(i);if(x instanceof CompItem&&x.name===name){c=x;break;}}
  if(!c)throw new Error("M6_GENERIC_PROOF_COMP_MISSING");
  var scriptFile=new File($.fileName),root=scriptFile.parent.parent.parent;
  var f=new File(root.fsName+"/.tmp/m6-generic-native-readback.txt");
  if(!f.open("w"))throw new Error("M6_GENERIC_READBACK_OPEN_FAILED");
  f.writeln("COMP\t"+c.name+"\t"+c.numLayers);
  function fmt(v){if(v instanceof Array)return v.join(",");return String(v);}
  for(var j=1;j<=c.numLayers;j++){var l=c.layer(j),t=l.property("ADBE Transform Group");
    var ppos=t.property("ADBE Position"),op=t.property("ADBE Opacity"),ap=t.property("ADBE Anchor Point"),sc=t.property("ADBE Scale");
    var tr=l.property("ADBE Time Remapping"),trExpr=(tr&&tr.expressionEnabled)?tr.expression:"";
    f.writeln("LAYER\t"+j+"\t"+l.name+"\t"+l.comment+"\t"+l.startTime+"\t"+l.inPoint+"\t"+l.outPoint+"\t"+l.blendingMode);
    f.writeln("TIME_REMAP\t"+((l instanceof AVLayer&&l.timeRemapEnabled)?"1":"0")+"\t"+trExpr);
    f.writeln("POSITION_EXPR\t"+(ppos.expressionEnabled?ppos.expression:""));
    f.writeln("OPACITY_EXPR\t"+(op.expressionEnabled?op.expression:""));
    f.writeln("SCALE_EXPR\t"+(sc.expressionEnabled?sc.expression:""));
    f.writeln("ANCHOR_EXPR\t"+(ap.expressionEnabled?ap.expression:""));
    f.writeln("SAMPLE\t0.400\tPOS="+fmt(ppos.valueAtTime(0.4,false))+"\tSCALE="+fmt(sc.valueAtTime(0.4,false))+"\tOPACITY="+fmt(op.valueAtTime(0.4,false)));
    f.writeln("SAMPLE\t0.500\tPOS="+fmt(ppos.valueAtTime(0.5,false))+"\tSCALE="+fmt(sc.valueAtTime(0.5,false))+"\tOPACITY="+fmt(op.valueAtTime(0.5,false)));
    f.writeln("SAMPLE\t0.533\tPOS="+fmt(ppos.valueAtTime(0.5333333333,false))+"\tSCALE="+fmt(sc.valueAtTime(0.5333333333,false))+"\tOPACITY="+fmt(op.valueAtTime(0.5333333333,false)));
    var fx=l.property("ADBE Effect Parade");
    for(var e=1;e<=fx.numProperties;e++){
      var effect=fx.property(e);f.writeln("EFFECT\t"+e+"\t"+effect.name+"\t"+effect.matchName+"\t"+(effect.enabled?"1":"0"));
      for(var q=1;q<=effect.numProperties;q++){var ep=effect.property(q);if(ep&&ep.propertyType===PropertyType.PROPERTY){var ev="<UNREADABLE>";try{ev=ep.value;}catch(readErr){ev="<NO_VALUE>";}f.writeln("EFFECT_PROP\t"+e+"\t"+q+"\t"+ep.matchName+"\t"+ev);}}
    }
  }
  f.close();
}());
