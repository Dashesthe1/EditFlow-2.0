(function () {
  "use strict";
  var requestFile = new File(Folder.temp.fsName + "/EditFlow2-practice-roto-target-request.json");
  var responseFile = new File(Folder.temp.fsName + "/EditFlow2-practice-roto-target-response.json");

  function read(file) {
    if (!file.exists || !file.open("r")) throw new Error("Cannot read " + file.fsName);
    file.encoding = "UTF-8";
    var text = file.read();
    file.close();
    return text;
  }

  function write(value) {
    if (!responseFile.open("w")) throw new Error("Cannot write " + responseFile.fsName);
    responseFile.encoding = "UTF-8";
    responseFile.write(JSON.stringify(value, null, 2));
    responseFile.close();
  }

  function positiveInteger(value, label) {
    var number = Number(value);
    if (!isFinite(number) || number <= 0 || Math.floor(number) !== number) {
      throw new Error(label + " must be a positive integer.");
    }
    return number;
  }

  function finiteNonNegative(value, label) {
    var number = Number(value);
    if (!isFinite(number) || number < 0) throw new Error(label + " must be finite and non-negative.");
    return number;
  }

  function findComp(project, hostId) {
    for (var itemIndex = 1; itemIndex <= project.numItems; itemIndex += 1) {
      var item = project.item(itemIndex);
      if (item instanceof CompItem && Number(item.id) === hostId) return item;
    }
    return null;
  }

  function findLayer(comp, hostId) {
    for (var layerIndex = 1; layerIndex <= comp.numLayers; layerIndex += 1) {
      var layer = comp.layer(layerIndex);
      if (Number(layer.id) === hostId) return layer;
    }
    return null;
  }

  var response = {
    schema: "editflow.practice-roto-target-prepare.v1",
    requestId: null,
    ok: false,
    failure: null
  };

  try {
    var request = JSON.parse(read(requestFile));
    if (!request || request.schema !== response.schema || !request.requestId) {
      throw new Error("Invalid Practice Roto target request.");
    }
    response.requestId = String(request.requestId);
    var project = app.project;
    if (!project) throw new Error("No After Effects project is open.");

    var compHostId = positiveInteger(request.compHostId, "compHostId");
    var layerHostId = positiveInteger(request.layerHostId, "layerHostId");
    var atTime = finiteNonNegative(request.atTime, "atTime");
    var expectedCompName = String(request.expectedCompName || "");
    var expectedLayerName = String(request.expectedLayerName || "");
    if (!expectedCompName || !expectedLayerName) throw new Error("Expected comp/layer names are required.");

    var comp = findComp(project, compHostId);
    if (!comp || comp.name !== expectedCompName) throw new Error("Exact Practice composition target was not found.");
    var layer = findLayer(comp, layerHostId);
    if (!layer || layer.name !== expectedLayerName) throw new Error("Exact Practice layer target was not found.");

    var frameDuration = Number(comp.frameDuration);
    if (!isFinite(frameDuration) || frameDuration <= 0) throw new Error("Target composition frame duration is invalid.");
    var maxTime = Math.max(0, Number(comp.duration) - frameDuration);
    if (atTime > maxTime + frameDuration * 0.1) throw new Error("Requested Practice Roto time exceeds composition bounds.");
    var quantizedFrame = Math.round(atTime / frameDuration);
    var quantizedTime = Math.min(maxTime, Math.max(0, quantizedFrame * frameDuration));

    for (var i = 1; i <= comp.numLayers; i += 1) comp.layer(i).selected = false;
    layer.selected = true;
    comp.openInViewer();
    comp.time = quantizedTime;
    var viewer = layer.openInViewer();
    if (!viewer) throw new Error("After Effects did not open the exact Practice layer in a Layer viewer.");
    comp.time = quantizedTime;

    response.ok = true;
    response.compHostId = Number(comp.id);
    response.layerHostId = Number(layer.id);
    response.compName = comp.name;
    response.layerName = layer.name;
    response.frameRate = Number(comp.frameRate);
    response.frameDuration = Number(comp.frameDuration);
    response.duration = Number(comp.duration);
    response.atTime = Number(comp.time);
    response.layerSelected = layer.selected === true;
    response.viewerOpened = true;
    response.projectRevision = Number(project.revision);
  } catch (error) {
    response.failure = String(error) + (error && error.line ? " @line " + error.line : "");
  }

  try {
    write(response);
  } catch (emitError) {
    alert("Practice Roto target prepare result write failed: " + String(emitError));
  }
}());
