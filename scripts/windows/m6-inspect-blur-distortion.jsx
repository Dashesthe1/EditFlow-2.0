(function(){
var out=new File("C:/Users/Shadow/EditFlow-2.0/.tmp/m6-blur-distortion-properties.txt");
var lines=[];
function walk(group,prefix){
  for(var i=1;i<=group.numProperties;i++){
    var p=group.property(i);
    lines.push(prefix+i+"\t"+p.name+"\t"+p.matchName+"\t"+p.propertyValueType);
    if(p.numProperties&&p.numProperties>0) walk(p,prefix+i+".");
  }
}
var c=app.project.items.addComp("__EF2_M6_EFFECT_INSPECT__",640,360,1,1,30);
var l=c.layers.addSolid([0.5,0.5,0.5],"probe",640,360,1,1);
var names=["ADBE Motion Blur","ADBE Turbulent Displace","ADBE Displacement Map"];
for(var n=0;n<names.length;n++){
  var m=names[n];
  try{
    var e=l.property("ADBE Effect Parade").addProperty(m);
    lines.push("EFFECT\t"+e.name+"\t"+e.matchName);
    walk(e,"P.");
  }catch(err){lines.push("ERROR\t"+m+"\t"+err.toString());}
}
out.open("w");out.write(lines.join("\n"));out.close();
c.remove();
return "OK";
})();