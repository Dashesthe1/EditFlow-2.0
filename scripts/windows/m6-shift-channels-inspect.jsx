(function(){
  var out=new File("C:/Users/Shadow/EditFlow-2.0/.tmp/m6-shift-channels-inspect.txt");
  out.encoding="UTF-8"; out.open("w");
  var comp=app.project.items.addComp("__M6_SHIFT_INSPECT__",320,180,1,1,30);
  var layer=comp.layers.addSolid([1,1,1],"probe",320,180,1,1);
  var parade=layer.property("ADBE Effect Parade");
  var names=["ADBE Shift Channels","Shift Channels"];
  for(var n=0;n<names.length;n++){
    try{
      var fx=parade.addProperty(names[n]);
      if(fx){
        out.writeln("EFFECT\t"+names[n]+"\t"+fx.name+"\t"+fx.matchName+"\t"+fx.numProperties);
        for(var i=1;i<=fx.numProperties;i++){
          var prop=fx.property(i);
          out.writeln("PROP\t"+i+"\t"+prop.name+"\t"+prop.matchName+"\t"+prop.propertyValueType+"\t"+(prop.canSetExpression?"expr":""));
        }
        fx.remove();
      }
    }catch(e){out.writeln("ERROR\t"+names[n]+"\t"+e.toString());}
  }
  comp.remove(); out.close();
})();