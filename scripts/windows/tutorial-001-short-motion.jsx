/* Tutorial 001 Level-4 short-motion fixture + capture.
 * Uses source-space landmarks so temporal motion can be measured independently
 * from the simultaneous camera push/position compensation.
 */
(function () {
  "use strict";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var SUFFIX = "]]";
  var TARGET = "EF2_T001_LIVE_TRANSITION";
  var SOURCE_OUT = "EF2_T001_LIVE_SOURCE_OUT";
  var SOURCE_IN = "EF2_T001_LIVE_SOURCE_IN";
  var LAYER_OUT = "EF2_T001_LIVE_LAYER_OUT";
  var LAYER_IN = "EF2_T001_LIVE_LAYER_IN";
  var scriptFile = new File($.fileName);
  var repoRoot = scriptFile.parent.parent.parent;
  var outputDir = new Folder(repoRoot.fsName + "/proofs/artifacts/tutorial-001-short-motion");
  if (!outputDir.exists && !outputDir.create()) throw new Error("T001_MOTION_OUTPUT_CREATE_FAILED");

  function stableValue(text) {
    var source = String(text || "");
    var start = source.indexOf(STABLE_PREFIX);
    if (start < 0) return null;
    start += STABLE_PREFIX.length;
    var end = source.indexOf(SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }
  function findItem(id) {
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
    for (var i = 1; i <= comp.numLayers; i += 1) if (comp.layer(i).name === name) return true;
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
  }
  function populate(comp, outgoing) {
    var prefix = outgoing ? "EF2 T001 MOTION OUT " : "EF2 T001 MOTION IN ";
    if (hasLayerNamed(comp, prefix + "BG")) return;
    addRect(comp, prefix + "BG", [comp.width, comp.height], [0.08, 0.08, 0.08],
      [comp.width / 2, comp.height / 2], true);
    addRect(comp, prefix + "REF_LEFT", [48, 48], [0, 1, 0],
      [comp.width * 0.30, comp.height * 0.88], false);
    addRect(comp, prefix + "REF_RIGHT", [48, 48], [1, 0, 1],
      [comp.width * 0.70, comp.height * 0.88], false);
    var moving = addRect(comp, prefix + "MOTION", [54, 180], [1, 0.5, 0],
      [outgoing ? comp.width * 0.18 : comp.width * 0.82, comp.height * 0.68], false);
    var position = moving.property("ADBE Transform Group").property("ADBE Position");
    position.setValueAtTime(0,
      [outgoing ? comp.width * 0.18 : comp.width * 0.82, comp.height * 0.68]);
    position.setValueAtTime(comp.duration,
      [outgoing ? comp.width * 0.82 : comp.width * 0.18, comp.height * 0.68]);
  }
  function setHardCut(outLayer, inLayer) {
    outLayer.inPoint = 0;
    outLayer.outPoint = 2.0;
    inLayer.inPoint = 2.0;
    inLayer.outPoint = Math.min(inLayer.containingComp.duration, 5.0);
  }
  function saveFrame(comp, ms) {
    var file = new File(outputDir.fsName + "/edited_" + ms + "ms.png");
    if (file.exists) file.remove();
    comp.saveFrameToPng(ms / 1000.0, file);
    return file.fsName;
  }
  function writeJson(file, value) {
    file.encoding = "UTF-8";
    if (!file.open("w")) throw new Error("T001_MOTION_RESULT_OPEN_FAILED:" + file.fsName);
    file.write(JSON.stringify(value, null, 2));
    file.close();
  }

  if (!app.project) throw new Error("T001_MOTION_PROJECT_REQUIRED");
  var target = findItem(TARGET);
  var sourceOut = findItem(SOURCE_OUT);
  var sourceIn = findItem(SOURCE_IN);
  if (!target || !sourceOut || !sourceIn) throw new Error("T001_MOTION_FIXTURE_ITEMS_REQUIRED");
  if (!(target instanceof CompItem) || !(sourceOut instanceof CompItem) || !(sourceIn instanceof CompItem)) {
    throw new Error("T001_MOTION_FIXTURE_COMPS_REQUIRED");
  }

  var originalOut = findLayer(target, LAYER_OUT);
  var originalIn = findLayer(target, LAYER_IN);
  if (originalOut && originalIn) {
    populate(sourceOut, true);
    populate(sourceIn, false);
    setHardCut(originalOut, originalIn);
    writeJson(new File(outputDir.fsName + "/prepared.json"), {
      proof: "M5_TUTORIAL_001_SHORT_MOTION_V1",
      phase: "prepared",
      targetLayers: target.numLayers,
      preparedAtMs: (new Date()).getTime()
    });
    return;
  }

  var times = [1600, 1700, 1800, 1900, 2100, 2200, 2300, 2400];
  var files = [];
  for (var i = 0; i < times.length; i += 1) files.push(saveFrame(target, times[i]));
  writeJson(new File(outputDir.fsName + "/motion.json"), {
    proof: "M5_TUTORIAL_001_SHORT_MOTION_V1",
    phase: "edited",
    timesMs: times,
    files: files,
    targetLayers: target.numLayers,
    capturedAtMs: (new Date()).getTime()
  });
}());
