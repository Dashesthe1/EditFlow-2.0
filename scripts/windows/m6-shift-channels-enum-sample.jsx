(function(){
  var out=new File("C:/Users/Shadow/EditFlow-2.0/.tmp/m6-shift-enum-sample.txt");
  out.encoding="UTF-8"; out.open("w");
  var comp=app.project.items.addComp("__M6_SHIFT_ENUM_SAMPLE__",100,100,1,1,30);
  var probe=comp.layers.addSolid([0.25,0.5,0.75],"probe",100,100,1,1);
  var fx=probe.property("ADBE Effect Parade").addProperty("ADBE Shift Channels");
  var text=comp.layers.addText("");
  var source=text.property("ADBE Text Properties").property("ADBE Text Document");
  source.expression='var c=thisComp.layer("probe").sampleImage([50,50],[0.5,0.5],true,time); [c[0],c[1],c[2],c[3]].join(",");';
  for(var v=1;v<=10;v++){
    fx.property("ADBE Shift Channels-0002").setValue(v);
    try{
      var td=source.valueAtTime(0,false);
      out.writeln("VALUE\t"+v+"\t"+td.text);
    }catch(e){out.writeln("ERROR\t"+v+"\t"+e.toString());}
  }
  comp.remove(); out.close();
})();
