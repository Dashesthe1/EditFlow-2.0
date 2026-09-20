(function(){
  var out=new File("C:/Users/Shadow/EditFlow-2.0/.tmp/m6-shift-channels-values.txt");
  out.encoding="UTF-8"; out.open("w");
  var comp=app.project.items.addComp("__M6_SHIFT_VALUES__",320,180,1,1,30);
  var layer=comp.layers.addSolid([1,1,1],"probe",320,180,1,1);
  var fx=layer.property("ADBE Effect Parade").addProperty("ADBE Shift Channels");
  for(var i=1;i<=4;i++){
    var prop=fx.property(i);
    out.writeln("DEFAULT\t"+i+"\t"+prop.value+"\t"+prop.minValue+"\t"+prop.maxValue);
    for(var v=1;v<=10;v++){
      try{prop.setValue(v);out.writeln("SET\t"+i+"\t"+v+"\t"+prop.value);}catch(e){}
    }
  }
  comp.remove(); out.close();
})();