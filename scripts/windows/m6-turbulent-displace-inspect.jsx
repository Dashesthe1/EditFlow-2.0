(function(){
  var out=new File("C:/Users/Shadow/EditFlow-2.0/.tmp/m6-turbulent-displace-inspect.txt");
  out.encoding="UTF-8"; out.open("w");
  var comp=app.project.items.addComp("__M6_TURBULENT_INSPECT__",320,180,1,1,30);
  var layer=comp.layers.addSolid([0.5,0.5,0.5],"probe",320,180,1,1);
  try{
    var fx=layer.property("ADBE Effect Parade").addProperty("ADBE Turbulent Displace");
    out.writeln("EFFECT\t"+fx.name+"\t"+fx.matchName+"\t"+fx.numProperties);
    for(var i=1;i<=fx.numProperties;i++){
      try{
        var prop=fx.property(i);
        out.writeln("PROP\t"+i+"\t"+prop.name+"\t"+prop.matchName);
      }catch(pe){out.writeln("PROP_ERROR\t"+i+"\t"+pe.toString());}
    }
  }catch(e){out.writeln("ERROR\t"+e.toString());}
  comp.remove(); out.close();
})();
