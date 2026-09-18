/* Tutorial 001 Level-6 transfer fixture + capture.
 * Uses retained real media with proof-only source-space landmarks.
 * Product construction remains on the normal EditFlow transaction path.
 */
(function () {
  "use strict";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var SUFFIX = "]]";
  var TARGET = "EF2_T001_TRANSFER_TARGET";
  var SOURCE_OUT = "EF2_T001_TRANSFER_SOURCE_OUT";
  var SOURCE_IN = "EF2_T001_TRANSFER_SOURCE_IN";
  var LAYER_OUT = "EF2_T001_TRANSFER_LAYER_OUT";
  var LAYER_IN = "EF2_T001_TRANSFER_LAYER_IN";
  var REAL_OUT = "EF2_T001_TRANSFER_REAL_OUT_LAYER";
  var REAL_IN = "EF2_T001_TRANSFER_REAL_IN_LAYER";
  var scriptFile = new File($.fileName);
  var repoRoot = scriptFile.parent.parent.parent;
  var outputDir = new Folder(repoRoot.fsName + "/proofs/artifacts/tutorial-001-transfer");
  if (!outputDir.exists && !outputDir.create()) {
    throw new Error("T001_TRANSFER_OUTPUT_CREATE_FAILED");
  }

  function stableValue(text) {
    var source = String(text || "");
    var start = source.indexOf(STABLE_PREFIX);
    if (start < 0) return null;
    start += STABLE_PREFIX.length;
    var end = source.indexOf(SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }  function findItem(id) {
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (stableValue(item.comment) === id) return item;
    }
    return null;
  }
  function findLayer(comp, id) {
    for (var i = 1; i <= comp.numLayers; i += 1) {
      var layer = comp.layer(i);
      if (stableValue(layer.comment) === id) return layer;
    }
    return null;
  }
  function hasLayerNamed(comp, name) {
    for (var i = 1; i <= comp.numLayers; i += 1) {
      if (comp.layer(i).name === name) return true;
    }
    return false;
  }
  function addRect(comp, name, size, color, position, toEnd) {
    var layer = comp.layers.addShape();
    layer.name = name;
    var root = layer.property("ADBE Root Vectors Group");
    var group = root.addProperty("ADBE Vector Group");
    var contents = group.property("ADBE Vectors Group");
    var rect = contents.addProperty("ADBE Vector Shape - Rect");
    rect.property("ADBE Vector Rect Size").setValue(size);
    var fill = contents.addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue(color);
    layer.property("ADBE Transform Group").property("ADBE Position").setValue(position);
    if (toEnd) layer.moveToEnd();
    return layer;
  }  function populate(comp, outgoing) {
    var prefix = outgoing ? "EF2 T001 TRANSFER OUT " : "EF2 T001 TRANSFER IN ";
    if (hasLayerNamed(comp, prefix + "REF_LEFT")) return;
    addRect(comp, prefix + "REF_LEFT", [42, 42], [0, 1, 0], [288, 950], false);
    addRect(comp, prefix + "REF_RIGHT", [42, 42], [1, 0, 1], [1632, 950], false);
    var moving = addRect(
      comp,
      prefix + "MOTION",
      [72, 216],
      [1, 0.5, 0],
      [outgoing ? 1248 : 96, 626],
      false
    );
    var position = moving.property("ADBE Transform Group").property("ADBE Position");
    position.setValueAtTime(0, [outgoing ? 1248 : 96, 626]);
    position.setValueAtTime(comp.duration, [outgoing ? 96 : 1248, 626]);
  }
  function saveFrame(comp, prefix, ms) {
    var file = new File(outputDir.fsName + "/" + prefix + "_" + ms + "ms.png");
    if (file.exists) file.remove();
    comp.saveFrameToPng(ms / 1000.0, file);
    return file.fsName;
  }
  function saveFrames(comp, prefix, times) {
    var files = [];
    for (var i = 0; i < times.length; i += 1) {
      files.push(saveFrame(comp, prefix, times[i]));
    }
    return files;
  }  function writeJson(file, value) {
    file.encoding = "UTF-8";
    if (!file.open("w")) throw new Error("T001_TRANSFER_RESULT_OPEN_FAILED:" + file.fsName);
    file.write(JSON.stringify(value, null, 2));
    file.close();
  }

  if (!app.project) throw new Error("T001_TRANSFER_PROJECT_REQUIRED");
  var target = findItem(TARGET);
  var sourceOut = findItem(SOURCE_OUT);
  var sourceIn = findItem(SOURCE_IN);
  if (!target || !sourceOut || !sourceIn) {
    throw new Error("T001_TRANSFER_FIXTURE_ITEMS_REQUIRED");
  }
  if (!(target instanceof CompItem) || !(sourceOut instanceof CompItem) || !(sourceIn instanceof CompItem)) {
    throw new Error("T001_TRANSFER_FIXTURE_COMPS_REQUIRED");
  }
  if (!findLayer(sourceOut, REAL_OUT) || !findLayer(sourceIn, REAL_IN)) {
    throw new Error("T001_TRANSFER_REAL_MEDIA_LAYERS_REQUIRED");
  }

  var originalOut = findLayer(target, LAYER_OUT);
  var originalIn = findLayer(target, LAYER_IN);
  var phase = originalOut && originalIn ? "baseline" : "edited";
  populate(sourceOut, true);
  populate(sourceIn, false);

  var visualTimes = [2400, 3100, 3200, 3300, 4000];
  var visualFiles = saveFrames(target, phase, visualTimes);
  var visual = {
    proof: "M5_TUTORIAL_001_TRANSFER_VISUAL_V1",
    phase: phase,
    timesMs: visualTimes,
    files: visualFiles,
    targetLayers: target.numLayers,
    capturedAtMs: (new Date()).getTime()
  };  writeJson(new File(outputDir.fsName + "/" + phase + ".json"), visual);

  if (phase === "baseline") {
    writeJson(new File(outputDir.fsName + "/prepared.json"), {
      proof: "M5_TUTORIAL_001_TRANSFER_V1",
      phase: "prepared",
      realMediaLayers: [REAL_OUT, REAL_IN],
      sourceComps: [SOURCE_OUT, SOURCE_IN],
      targetLayers: [LAYER_OUT, LAYER_IN],
      preparedAtMs: (new Date()).getTime()
    });
    return;
  }

  var motionTimes = [
    2700, 2800, 2900, 3000, 3100,
    3300, 3400, 3500, 3600, 3700
  ];
  var motionFiles = saveFrames(target, "motion", motionTimes);
  writeJson(new File(outputDir.fsName + "/motion.json"), {
    proof: "M5_TUTORIAL_001_TRANSFER_MOTION_V1",
    phase: "edited",
    timesMs: motionTimes,
    files: motionFiles,
    targetLayers: target.numLayers,
    capturedAtMs: (new Date()).getTime()
  });
}());
