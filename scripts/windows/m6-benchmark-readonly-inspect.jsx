(function(){
  var p=app.project;
  var out=new File("C:/Users/Shadow/EditFlow-2.0-m6/.tmp/m6-benchmark-ae-inspect.txt");
  out.encoding="UTF-8";out.open("w");
  out.writeln("PROJECT_FILE\t"+(p.file?p.file.fsName:"<UNSAVED>"));
  out.writeln("DIRTY\t"+(typeof p.dirty!=="undefined"?p.dirty:"<UNKNOWN>"));
  out.writeln("ITEMS\t"+p.numItems);
  out.writeln("ACTIVE\t"+(p.activeItem?p.activeItem.name:"<NONE>"));
  var target="spidy try 3 - MICROWAVE PRO",found=0;
  for(var i=1;i<=p.numItems;i++){
    var x=p.item(i);
    if(x instanceof CompItem){
      if(x.name===target){
        found++;
        out.writeln("TARGET_COMP\t"+x.name+"\t"+x.numLayers+"\t"+x.duration+"\t"+x.frameRate);
        for(var j=1;j<=x.numLayers;j++){
          var l=x.layer(j);
          out.writeln("TARGET_LAYER\t"+j+"\t"+l.name+"\t"+l.inPoint+"\t"+l.outPoint);
        }
      }
    }
  }
  out.writeln("TARGET_COUNT\t"+found);
  out.close();
}());