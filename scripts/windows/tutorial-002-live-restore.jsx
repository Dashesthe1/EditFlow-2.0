(function () {
  "use strict";
  var root = new File($.fileName).parent.parent.parent;
  var stateFile = new File(root.fsName + "/proofs/artifacts/tutorial-002-live/original.json");
  var out = new File(root.fsName + "/proofs/artifacts/tutorial-002-live/restore.json");
  function write(v){out.parent.create();out.open("w");out.encoding="UTF-8";out.write(JSON.stringify(v));out.close();}
  function readJson(f){f.open("r");f.encoding="UTF-8";var s=f.read();f.close();return JSON.parse(s);}
  var r={proof:"M5_TUTORIAL_002_LIVE_RESTORE_V1",ok:false};
  try{
    if(!stateFile.exists)throw new Error("original state file missing");
    var saved=readJson(stateFile),target=null;
    for(var i=1;i<=app.project.numItems;i+=1){if(app.project.item(i).id===saved.activeItemHostId){target=app.project.item(i);break;}}
    if(saved.activeItemHostId===null||saved.activeItemHostId===undefined){r.ok=!app.project.activeItem;}
    else if(target){try{target.openInViewer();}catch(_){}r.ok=!!app.project.activeItem&&app.project.activeItem.id===saved.activeItemHostId;}
    else throw new Error("original active item no longer exists");
    r.activeItemHostId=app.project.activeItem?app.project.activeItem.id:null;r.activeItemName=app.project.activeItem?app.project.activeItem.name:null;
  }catch(e){r.failure=String(e);}finally{write(r);}
}());
