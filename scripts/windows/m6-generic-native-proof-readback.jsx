(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_PROOF__",c=null;
  for(var i=1;i<=p.numItems;i++){var x=p.item(i);if(x instanceof CompItem&&x.name===name){c=x;break;}}
  if(!c)throw new Error("M6_GENERIC_PROOF_COMP_MISSING");
  var f=new File("C:/Users/Shadow/EditFlow-2.0-m6/.tmp/m6-generic-native-readback.txt");
  if(!f.open("w"))throw new Error("M6_GENERIC_READBACK_OPEN_FAILED");
  f.writeln("COMP\t"+c.name+"\t"+c.numLayers);
  for(var j=1;j<=c.numLayers;j++){var l=c.layer(j),t=l.property("ADBE Transform Group");
    var ppos=t.property("ADBE Position"),op=t.property("ADBE Opacity"),ap=t.property("ADBE Anchor Point");
    f.writeln("LAYER\t"+j+"\t"+l.name+"\t"+l.comment+"\t"+l.startTime+"\t"+l.inPoint+"\t"+l.outPoint);
    f.writeln("POSITION_EXPR\t"+(ppos.expressionEnabled?ppos.expression:""));
    f.writeln("OPACITY_EXPR\t"+(op.expressionEnabled?op.expression:""));
    f.writeln("ANCHOR_EXPR\t"+(ap.expressionEnabled?ap.expression:""));
  }
  f.close();
}());