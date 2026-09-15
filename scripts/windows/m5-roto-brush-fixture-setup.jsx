/* M5 Roto Brush live proof fixture setup. Runs only inside the proof-owned blank isolation project. */
(function () {
  "use strict";
  var PREFIX = "EF2_M5_ROTO_";
  var inputFile = new File(Folder.temp.fsName + "/EditFlow2-m5-roto-brush-fixture-input.json");
  var resultFile = new File(Folder.temp.fsName + "/EditFlow2-m5-roto-brush-fixture-result.json");
  function read(file) {
    if (!file.exists || !file.open("r")) throw new Error("Cannot read " + file.fsName);
    var text = file.read(); file.close(); return text;
  }
  function write(value) {
    if (!resultFile.open("w")) throw new Error("Cannot write " + resultFile.fsName);
    resultFile.encoding = "UTF-8"; resultFile.write(JSON.stringify(value, null, 2)); resultFile.close();
  }
  function positiveInt(value, fallback) {
    var number = Number(value); return isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  }
  var result = { proofId: "M5_ROTO_BRUSH_FIXTURE_V1", ok: false, failure: null };
  try {
    var input = JSON.parse(read(inputFile));
    var project = app.project;
    if (!project || project.file !== null || project.numItems !== 0) throw new Error("Fixture setup requires the empty unsaved M5 isolation project.");
    var sourceFile = new File(String(input.sourcePath || ""));
    if (!sourceFile.exists) throw new Error("Roto Brush proof source file does not exist.");
    var compName = String(input.compName || (PREFIX + "PROOF_COMP"));
    var layerName = String(input.layerName || (PREFIX + "SUBJECT"));
    if (compName.indexOf(PREFIX) !== 0 || layerName.indexOf(PREFIX) !== 0) throw new Error("Fixture names must stay inside the M5 proof-owned namespace.");
    var imported = project.importFile(new ImportOptions(sourceFile));
    if (!imported) throw new Error("After Effects did not import the M5 proof source.");
    imported.name = PREFIX + "SOURCE";
    imported.comment = "[[EDITFLOW2_STABLE:M5_ROTO_SOURCE]]";
    var width = positiveInt(imported.width, 1920);
    var height = positiveInt(imported.height, 1080);
    var frameRate = Number(imported.frameRate);
    if (!isFinite(frameRate) || frameRate <= 0) frameRate = 30;
    var sourceDuration = Number(imported.duration);
    if (!isFinite(sourceDuration) || sourceDuration <= 0) sourceDuration = 2;
    var duration = Math.min(Math.max(sourceDuration, 1), 3);
    var comp = project.items.addComp(compName, width, height, 1, duration, frameRate);
    comp.comment = "[[EDITFLOW2_STABLE:M5_ROTO_COMP]]";
    var layer = comp.layers.add(imported);
    layer.name = layerName;
    layer.comment = "[[EDITFLOW2_STABLE:M5_ROTO_LAYER]]";
    var requestedTime = Number(input.atTime);
    if (!isFinite(requestedTime) || requestedTime < 0) requestedTime = Math.min(0.5, duration / 2);
    var maxTime = Math.max(0, duration - (1 / frameRate));
    comp.time = Math.min(requestedTime, maxTime);
    for (var i = 1; i <= comp.numLayers; i += 1) comp.layer(i).selected = false;
    layer.selected = true;
    var viewer = layer.openInViewer();
    if (!viewer) throw new Error("After Effects did not open the proof target in a Layer viewer.");
    result.viewerOpened = true;
    result.ok = true;
    result.compHostId = Number(comp.id);
    result.layerHostId = Number(layer.id);
    result.compName = comp.name;
    result.layerName = layer.name;
    result.width = Number(comp.width);
    result.height = Number(comp.height);
    result.frameRate = Number(comp.frameRate);
    result.duration = Number(comp.duration);
    result.atTime = Number(comp.time);
    result.projectRevision = Number(project.revision);
    result.itemCount = Number(project.numItems);
    result.sourceItemName = imported.name;
    if (result.compHostId <= 0 || result.layerHostId <= 0) throw new Error("Fixture host IDs were not available.");
    for (var itemIndex = 1; itemIndex <= project.numItems; itemIndex += 1) {
      if (String(project.item(itemIndex).name).indexOf(PREFIX) !== 0) throw new Error("Fixture created a non-owned project item.");
    }
  } catch (error) {
    result.failure = String(error) + (error.line ? " @line " + error.line : "");
  }
  try { write(result); }
  catch (emitError) { alert("M5 Roto Brush fixture result write failed: " + String(emitError)); }
}());
