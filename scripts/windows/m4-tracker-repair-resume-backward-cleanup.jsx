(function () {
  "use strict";
  var root = new File($.fileName).parent.parent.parent;
  var setupFile = new File(root.fsName + "/proofs/artifacts/m4-tracker-repair-resume-backward-fixture.json");
  var out = new File(root.fsName + "/proofs/artifacts/m4-tracker-repair-resume-backward-cleanup.json");
  function write(v){out.parent.create();out.open("w");out.encoding="UTF-8";out.write(JSON.stringify(v));out.close();}
  function readJson(file){file.open("r");var text=file.read();file.close();return JSON.parse(text);}
  function find(name){for(var i=1;i<=app.project.numItems;i+=1){if(app.project.item(i).name===name)return app.project.item(i);}return null;}
  var r={ok:false};
  try{
    if(!setupFile.exists)throw new Error("Backward setup evidence missing.");
    var setup=readJson(setupFile),folder=find("EF2_M4_REPAIR_RESUME_BACKWARD_OWNED"),fixture=find("RRB_FIXTURE"),source=find("RRB_SOURCE"),black=find("RRB_BLACK"),feature=find("RRB_FEATURE");
    if(!setup.ok)throw new Error("Backward setup evidence not accepted.");
    if(folder){
      if(!(folder instanceof FolderItem))throw new Error("Owned folder type mismatch.");
      if(!fixture||fixture.parentFolder.id!==folder.id)throw new Error("Fixture ownership mismatch.");
      if(!source||source.parentFolder.id!==folder.id)throw new Error("Source ownership mismatch.");
      if(!black||black.parentFolder.id!==folder.id)throw new Error("Black source ownership mismatch.");
      if(!feature||feature.parentFolder.id!==folder.id)throw new Error("Feature source ownership mismatch.");
      fixture.remove();source.remove();black.remove();feature.remove();
      if(folder.numItems!==0)throw new Error("Owned folder still contains unexpected items.");folder.remove();
    }else if(fixture||source||black||feature){throw new Error("Owned folder is absent but owned fixture items remain.");}
    var autoSolids=find("Solids"),autoSolidsRemoved=false;
    if(app.project.numItems===setup.baselineItems+1&&autoSolids&&autoSolids instanceof FolderItem&&autoSolids.numItems===0){autoSolids.remove();autoSolidsRemoved=true;}
    r={ok:app.project.numItems===setup.baselineItems,itemCountAfter:app.project.numItems,baselineItems:setup.baselineItems,autoSolidsRemoved:autoSolidsRemoved,folderRemoved:find("EF2_M4_REPAIR_RESUME_BACKWARD_OWNED")===null,fixtureRemoved:find("RRB_FIXTURE")===null,sourceRemoved:find("RRB_SOURCE")===null};
    r.ok=r.ok&&r.folderRemoved&&r.fixtureRemoved&&r.sourceRemoved;
  }catch(error){r.error=String(error);}
  write(r);
}());
