(function(){
var out=new File("C:/Users/Shadow/EditFlow-2.0/.tmp/m6-alternate-distortion-properties.txt");
var lines=[];
function scalar(v){try{return v instanceof Array?"["+v.join(",")+"]":String(v);}catch(e){return "<ERR>";}}
function walk(group,prefix){
  for(var i=1;i<=group.numProperties;i++){
    var p=group.property(i),v="<GROUP>",mn="",mx="";
    try{v=scalar(p.value);}catch(e){}
    try{if(p.hasMin)mn=scalar(p.minValue);}catch(e){}
    try{if(p.hasMax)mx=scalar(p.maxValue);}catch(e){}
    lines.push(prefix+i+"\t"+p.name+"\t"+p.matchName+"\t"+p.propertyValueType+"\t"+v+"\t"+mn+"\t"+mx);
    if(p.numProperties&&p.numProperties>0) walk(p,prefix+i+".");
  }
}
var c=app.project.items.addComp("__EF2_M6_ALT_DISTORT_INSPECT__",640,360,1,1,30);
var l=c.layers.addSolid([0.5,0.5,0.5],"probe",640,360,1,1);
var names=["ADBE Wave Warp","CC Smear","ADBE Displacement Map"];
for(var n=0;n<names.length;n++){try{var e=l.property("ADBE Effect Parade").addProperty(names[n]);lines.push("EFFECT\t"+e.name+"\t"+e.matchName);walk(e,"P.");}catch(err){lines.push("ERROR\t"+names[n]+"\t"+err.toString());}}
out.open("w");out.write(lines.join("\n"));out.close();c.remove();return "OK";
})();