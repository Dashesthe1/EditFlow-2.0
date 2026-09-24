(function () {
  "use strict";

  var requestFile = new File(
    Folder.temp.fsName + "/EditFlow2-practice-tracked-mask-target-request.json"
  );
  var responseFile = new File(
    Folder.temp.fsName + "/EditFlow2-practice-tracked-mask-target-response.json"
  );

  function read(file) {
    if (!file.exists || !file.open("r")) {
      throw new Error("Cannot read " + file.fsName);
    }
    file.encoding = "UTF-8";
    var text = file.read();
    file.close();
    return text;
  }

  function write(value) {
    if (!responseFile.open("w")) {
      throw new Error("Cannot write " + responseFile.fsName);
    }
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
    if (!isFinite(number) || number < 0) {
      throw new Error(label + " must be finite and non-negative.");
    }
    return number;
  }

  function findComp(project, hostId) {
    for (var i = 1; i <= project.numItems; i += 1) {
      var item = project.item(i);
      if (item instanceof CompItem && Number(item.id) === hostId) return item;
    }
    return null;
  }

  function findLayer(comp, hostId) {
    for (var i = 1; i <= comp.numLayers; i += 1) {
      var layer = comp.layer(i);
      if (Number(layer.id) === hostId) return layer;
    }
    return null;
  }
  function stableIdFromMaskName(name) {
    var marker = "[[EDITFLOW2_MASK:";
    var start = String(name).indexOf(marker);
    if (start < 0) return null;
    start += marker.length;
    var end = String(name).indexOf("]]", start);
    if (end < 0) return null;
    return String(name).substring(start, end);
  }

  function cleanMaskName(name) {
    return String(name)
      .replace(/\s*\[\[EDITFLOW2_MASK:[^\]]+\]\]\s*/g, " ")
      .replace(/^\s+|\s+$/g, "")
      .replace(/\s{2,}/g, " ");
  }

  function findMask(layer, stableId) {
    var parade = layer.property("ADBE Mask Parade");
    if (!parade) return null;
    for (var i = 1; i <= parade.numProperties; i += 1) {
      var mask = parade.property(i);
      if (stableIdFromMaskName(mask.name) === stableId) return mask;
    }
    return null;
  }

  var response = {
    schema: "editflow.practice-tracked-mask-target-prepare.v1",
    requestId: null,
    ok: false,
    failure: null
  };

  try {
    var request = JSON.parse(read(requestFile));
    if (!request || request.schema !== response.schema || !request.requestId) {
      throw new Error("Invalid Practice tracked-mask target request.");
    }
    response.requestId = String(request.requestId);

    var project = app.project;
    if (!project) throw new Error("No After Effects project is open.");

    var compHostId = positiveInteger(request.compHostId, "compHostId");
    var layerHostId = positiveInteger(request.layerHostId, "layerHostId");
    var atTime = finiteNonNegative(request.atTime, "atTime");
    var expectedCompName = String(request.expectedCompName || "");
    var expectedLayerName = String(request.expectedLayerName || "");
    var maskStableId = String(request.maskStableId || "");
    var expectedMaskName = String(request.expectedMaskName || "");
    if (!expectedCompName || !expectedLayerName || !maskStableId || !expectedMaskName) {
      throw new Error("Exact comp/layer/mask identity is required.");
    }

    var comp = findComp(project, compHostId);
    if (!comp || comp.name !== expectedCompName) {
      throw new Error("Exact Practice composition target was not found.");
    }
    var layer = findLayer(comp, layerHostId);
    if (!layer || layer.name !== expectedLayerName) {
      throw new Error("Exact Practice layer target was not found.");
    }
    var mask = findMask(layer, maskStableId);
    if (!mask || cleanMaskName(mask.name) !== expectedMaskName) {
      throw new Error("Exact Practice tracked mask was not found.");
    }
    var pathProperty = mask.property("ADBE Mask Shape");
    if (!pathProperty) throw new Error("Tracked mask has no Mask Path property.");

    var frameDuration = Number(comp.frameDuration);
    if (!isFinite(frameDuration) || frameDuration <= 0) {
      throw new Error("Target composition frame duration is invalid.");
    }
    var maxTime = Math.max(0, Number(comp.duration) - frameDuration);
    if (atTime > maxTime + frameDuration * 0.1) {
      throw new Error("Requested tracked-mask time exceeds composition bounds.");
    }
    var quantizedFrame = Math.round(atTime / frameDuration);
    var quantizedTime = Math.min(
      maxTime,
      Math.max(0, quantizedFrame * frameDuration)
    );

    for (var layerIndex = 1; layerIndex <= comp.numLayers; layerIndex += 1) {
      comp.layer(layerIndex).selected = false;
    }
    layer.selected = true;
    pathProperty.selected = true;
    comp.time = quantizedTime;
    var viewer = comp.openInViewer();
    if (!viewer) {
      throw new Error("After Effects did not open the exact Practice composition.");
    }
    comp.time = quantizedTime;

    response.ok = true;
    response.compHostId = Number(comp.id);
    response.layerHostId = Number(layer.id);
    response.compName = comp.name;
    response.layerName = layer.name;
    response.maskStableId = stableIdFromMaskName(mask.name);
    response.maskName = cleanMaskName(mask.name);
    response.frameDuration = Number(comp.frameDuration);
    response.duration = Number(comp.duration);
    response.atTime = Number(comp.time);
    response.layerSelected = layer.selected === true;
    response.pathSelected = pathProperty.selected === true;
    response.viewerOpened = true;
    response.projectRevision = Number(project.revision);
  } catch (error) {
    response.failure = String(error)
      + (error && error.line ? " @line " + error.line : "");
  }

  try {
    write(response);
  } catch (emitError) {
    alert(
      "Practice tracked-mask target prepare result write failed: "
      + String(emitError)
    );
  }
}());
