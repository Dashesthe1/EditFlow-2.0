(function(){
  var out=new File("C:/Users/Shadow/EditFlow-2.0/.tmp/m6-distortion-candidate-inspect.txt");
  out.encoding="UTF-8"; out.open("w");
  var comp=app.project.items.addComp("__M6_DISTORTION_CANDIDATE_INSPECT__",320,180,1,1,30);
  var layer=comp.layers.addSolid([0.5,0.5,0.5],"probe",320,180,1,1);
  var names=["CC Smear","ADBE Wave Warp","Wave Warp","ADBE MESH WARP","Mesh Warp","ADBE BEZMESH","Bezier Warp"];
  for(var n=0;n<names.length;n++){
    try{
      var fx=layer.property("ADBE Effect Parade").addProperty(names[n]);
      out.writeln("EFFECT\t"+names[n]+"\t"+fx.name+"\t"+fx.matchName+"\t"+fx.numProperties);
      for(var i=1;i<=fx.numProperties;i++){
        try{
          var prop=fx.property(i); var value="";
          try{value=prop.value instanceof Array?prop.value.join(","):String(prop.value);}catch(ve){value="<NO_VALUE>";}
          out.writeln("PROP\t"+i+"\t"+prop.name+"\t"+prop.matchName+"\t"+value);
        }catch(pe){out.writeln("PROP_ERROR\t"+i+"\t"+pe.toString());}
      }
      fx.remove();
    }catch(e){out.writeln("ERROR\t"+names[n]+"\t"+e.toString());}
  }
  comp.remove(); out.close();
})();
