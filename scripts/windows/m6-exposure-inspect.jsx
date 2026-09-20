(function(){
  var out=new File("C:/Users/Shadow/EditFlow-2.0/.tmp/m6-exposure-inspect.txt");
  out.encoding="UTF-8"; out.open("w");
  var comp=app.project.items.addComp("__M6_EXPOSURE_INSPECT__",320,180,1,1,30);
  var layer=comp.layers.addSolid([0.5,0.5,0.5],"probe",320,180,1,1);
  var parade=layer.property("ADBE Effect Parade");
  var names=["ADBE Exposure2","ADBE Exposure","Exposure"];
  for(var n=0;n<names.length;n++){
    try{
      var fx=parade.addProperty(names[n]); if(!fx) continue;
      out.writeln("EFFECT\t"+names[n]+"\t"+fx.name+"\t"+fx.matchName+"\t"+fx.numProperties);
      for(var i=1;i<=fx.numProperties;i++){
        var prop=fx.property(i); var val="";
        try{val=prop.value;}catch(e){val="<NO_VALUE>";}
        out.writeln("PROP\t"+i+"\t"+prop.name+"\t"+prop.matchName+"\t"+prop.propertyValueType+"\t"+val);
      }
      fx.remove();
    }catch(e){out.writeln("ERROR\t"+names[n]+"\t"+e.toString());}
  }
  comp.remove(); out.close();
})();