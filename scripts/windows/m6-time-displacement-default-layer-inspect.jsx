(function(){
  var out=new File("C:/Users/Shadow/EditFlow-2.0-m6/.tmp/m6-time-displacement-default-layer.txt");
  out.encoding="UTF-8";out.open("w");
  var c=app.project.items.addComp("__M6_TD_DEFAULT__",320,180,1,1,30);
  var probe=c.layers.addSolid([0.25,0.25,0.25],"probe",320,180,1,1);
  var map=c.layers.addSolid([0.75,0.75,0.75],"map",320,180,1,1);
  var fx=probe.property("ADBE Effect Parade").addProperty("ADBE Time Displacement");
  out.writeln("probeIndex\t"+probe.index+"\tmapIndex\t"+map.index+"\tselector\t"+fx.property("ADBE Time Displacement-0001").value);
  c.remove();out.close();
})();