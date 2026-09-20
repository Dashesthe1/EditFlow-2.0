(function(){
  var p=app.project,c=null,n="__EF2_M6_GENERIC_NATIVE_PROOF__";
  for(var i=1;i<=p.numItems;i++){var x=p.item(i);if(x instanceof CompItem&&x.name===n){c=x;break;}}
  if(!c)throw new Error("M6_CORRECTION_COMP_MISSING");
  var out=new File("C:/Users/Shadow/EditFlow-2.0/.tmp/m6-correction-live-readback.txt");
  out.encoding="UTF-8";out.open("w");out.writeln("COMP\t"+c.numLayers);
  for(var j=1;j<=c.numLayers;j++){
    var l=c.layer(j),t=l.property("ADBE Transform Group"),sc=t.property("ADBE Scale"),po=t.property("ADBE Position"),op=t.property("ADBE Opacity");
    out.writeln("LAYER\t"+j+"\t"+l.name+"\t"+l.comment);
    out.writeln("SCALE_EXPR\t"+(sc.expressionEnabled?sc.expression:""));
    out.writeln("SCALE_SAMPLE\t"+sc.valueAtTime(0.4,false)+"\t"+sc.valueAtTime(0.5,false)+"\t"+sc.valueAtTime(0.55,false));
    out.writeln("POSITION_EXPR\t"+(po.expressionEnabled?po.expression:""));
    out.writeln("OPACITY_EXPR\t"+(op.expressionEnabled?op.expression:""));
    var fx=l.property("ADBE Effect Parade");
    for(var e=1;e<=fx.numProperties;e++){var f=fx.property(e);out.writeln("EFFECT\t"+f.name+"\t"+f.matchName);
      for(var q=1;q<=f.numProperties;q++){var ep=f.property(q);if(ep&&ep.propertyType===PropertyType.PROPERTY){var v="";try{v=ep.value;}catch(z){v="<NA>";}out.writeln("PROP\t"+ep.matchName+"\t"+v);}}
    }
  }
  out.close();
})();