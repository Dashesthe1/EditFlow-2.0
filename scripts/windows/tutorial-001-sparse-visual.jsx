/* Tutorial 001 sparse visual fixture + capture.
 * Proof-only setup: deterministic source graphics and hard-cut timing.
 * Product construction remains on the normal EditFlow transaction path.
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
  var outputDir = new Folder(repoRoot.fsName + "/proofs/artifacts/tutorial-001-sparse-visual");
  if (!outputDir.exists && !outputDir.create()) throw new Error("T001_VISUAL_OUTPUT_CREATE_FAILED");

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
  function addRing(comp, name, color, position) {
    var layer = comp.layers.addShape();
    layer.name = name;
    var root = layer.property("ADBE Root Vectors Group");
    var group = root.addProperty("ADBE Vector Group");
    var contents = group.property("ADBE Vectors Group");
    var ellipse = contents.addProperty("ADBE Vector Shape - Ellipse");
    ellipse.property("ADBE Vector Ellipse Size").setValue([190, 190]);
    var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
    stroke.property("ADBE Vector Stroke Color").setValue(color);
    stroke.property("ADBE Vector Stroke Width").setValue(24);
    layer.property("ADBE Transform Group").property("ADBE Position").setValue(position);
    return layer;
  }
  function populate(comp, outgoing) {
    var prefix = outgoing ? "EF2 T001 OUT " : "EF2 T001 IN ";
    if (hasLayerNamed(comp, prefix + "BG")) return;
    var bg = outgoing ? [0.04, 0.12, 0.78] : [0.82, 0.08, 0.06];
    var accent = outgoing ? [1, 0.86, 0.05] : [0.05, 0.95, 0.88];
    var center = [comp.width * 0.62, comp.height * 0.44];
    addRect(comp, prefix + "BG", [comp.width, comp.height], bg, [comp.width / 2, comp.height / 2], true);
    addRing(comp, prefix + "ANCHOR", [1, 1, 1], center);
    addRect(comp, prefix + "CENTER", [44, 44], accent, center, false);
    addRect(comp, prefix + "CORNER", [180, 180], accent,
      outgoing ? [comp.width * 0.20, comp.height * 0.18] : [comp.width * 0.82, comp.height * 0.76], false);
    var bar = addRect(comp, prefix + "MOTION", [86, 520], [1, 1, 1],
      [outgoing ? comp.width * 0.18 : comp.width * 0.82, comp.height * 0.72], false);
    var position = bar.property("ADBE Transform Group").property("ADBE Position");
    position.setValueAtTime(0, [outgoing ? comp.width * 0.18 : comp.width * 0.82, comp.height * 0.72]);
    position.setValueAtTime(comp.duration, [outgoing ? comp.width * 0.82 : comp.width * 0.18, comp.height * 0.72]);
  }
  function setHardCut(outLayer, inLayer) {
    outLayer.inPoint = 0;
    outLayer.outPoint = 2.0;
    inLayer.inPoint = 2.0;
    inLayer.outPoint = Math.min(inLayer.containingComp.duration, 5.0);
  }
  function saveFrame(comp, prefix, ms) {
    var file = new File(outputDir.fsName + "/" + prefix + "_" + ms + "ms.png");
    if (file.exists) file.remove();
    comp.saveFrameToPng(ms / 1000.0, file);
    return file.fsName;
  }
  function writeJson(file, value) {
    file.encoding = "UTF-8";
    if (!file.open("w")) throw new Error("T001_VISUAL_RESULT_OPEN_FAILED:" + file.fsName);
    file.write(JSON.stringify(value, null, 2));
    file.close();
  }

  if (!app.project) throw new Error("T001_VISUAL_PROJECT_REQUIRED");
  var target = findItem(TARGET);
  var sourceOut = findItem(SOURCE_OUT);
  var sourceIn = findItem(SOURCE_IN);
  if (!target || !sourceOut || !sourceIn) throw new Error("T001_VISUAL_FIXTURE_ITEMS_REQUIRED");
  if (!(target instanceof CompItem) || !(sourceOut instanceof CompItem) || !(sourceIn instanceof CompItem)) {
    throw new Error("T001_VISUAL_FIXTURE_COMPS_REQUIRED");
  }

  var originalOut = findLayer(target, LAYER_OUT);
  var originalIn = findLayer(target, LAYER_IN);
  var phase = originalOut && originalIn ? "baseline" : "edited";
  if (phase === "baseline") {
    populate(sourceOut, true);
    populate(sourceIn, false);
    setHardCut(originalOut, originalIn);
  }

  var times = [1800, 1950, 2000, 2050, 2200];
  var files = [];
  for (var i = 0; i < times.length; i += 1) files.push(saveFrame(target, phase, times[i]));
  var result = {
    proof: "M5_TUTORIAL_001_SPARSE_VISUAL_V1",
    phase: phase,
    timesMs: times,
    files: files,
    targetLayers: target.numLayers,
    capturedAt: (new Date()).toISOString()
  };
  writeJson(new File(outputDir.fsName + "/" + phase + ".json"), result);
}());
