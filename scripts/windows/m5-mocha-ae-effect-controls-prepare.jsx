/* Prepare exact proof-owned Mocha AE Effect Controls context without launching Mocha. */
(function () {
  "use strict";
  var PREFIX = "EF2_M5_MOCHA_";
  var out = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-effect-controls.json");
  function write(v) { if (!out.open("w")) throw new Error("Cannot write Effect Controls result"); out.encoding="UTF-8"; out.write(JSON.stringify(v,null,2)); out.close(); }
  var result = { proofId:"M5_MOCHA_AE_EFFECT_CONTROLS_PREPARE_V1", ok:false, failure:null };
  try {
    var project=app.project, comp=null, layer=null;
    if (!project || project.file !== null) throw new Error("Mocha Effect Controls preparation requires proof-owned unsaved project.");
    for (var i=1;i<=project.numItems;i+=1) if (String(project.item(i).name)===PREFIX+"PROOF_COMP") { comp=project.item(i); break; }
    if (!comp || !comp.layers || comp.numLayers<1) throw new Error("Proof-owned Mocha comp missing.");
    layer=comp.layer(1);
    if (String(layer.name)!==PREFIX+"SUBJECT") throw new Error("Proof-owned Mocha layer identity mismatch.");
    var parade=layer.property("ADBE Effect Parade");
    if (!parade || parade.numProperties!==1 || String(parade.property(1).matchName)!=="mochaAECC") throw new Error("Exact single mochaAECC effect required.");
    for (var j=1;j<=comp.numLayers;j+=1) comp.layer(j).selected=false;
    layer.selected=true;
    comp.openInViewer();
    result.ok=true; result.selectionPrepared=true; result.compHostId=Number(comp.id); result.layerHostId=Number(layer.id);
    result.effectName=String(parade.property(1).name); result.effectMatchName=String(parade.property(1).matchName); result.projectRevision=Number(project.revision);
  } catch(e) { result.failure=String(e)+(e.line?" @line "+e.line:""); }
  write(result);
}());
