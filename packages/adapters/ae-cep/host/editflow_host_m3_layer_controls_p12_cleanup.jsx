/* EditFlow 2.0 M3 layer-controls P1/P2 proof-only cleanup.
 * Verifies the exact prefix-owned disposable fixture before discarding the
 * unsaved project and restoring a fresh blank unsaved project.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF";
  var PREFIX_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";

  if ($.getenv(PROOF_ENV) !== "1") throw new Error("M3 layer-controls P1/P2 cleanup is proof-gated.");
  var prefix = $.getenv(PREFIX_ENV);
  if (!prefix || prefix.indexOf("M3_LAYER_CONTROLS_P12_") !== 0) throw new Error("M3 layer-controls cleanup prefix is missing or invalid.");
  if (!app.project) throw new Error("M3 layer-controls cleanup requires an open project.");
  if (app.project.file) throw new Error("M3 layer-controls cleanup refuses to discard a saved project.");
  if (!$.global.EditFlow2_JSON || typeof $.global.EditFlow2_JSON.stringify !== "function") throw new Error("EditFlow JSON codec is unavailable for cleanup evidence.");

  function stableId(target) {
    try {
      var text = String(target.comment || "");
      var start = text.indexOf(STABLE_PREFIX);
      if (start < 0) return null;
      start += STABLE_PREFIX.length;
      var end = text.indexOf(STABLE_SUFFIX, start);
      return end < 0 ? null : text.substring(start, end);
    } catch (_) { return null; }
  }
  function writeJson(file, value) {
    file.encoding = "UTF-8";
    if (!file.open("w")) throw new Error("Could not open cleanup marker for writing: " + file.fsName);
    try { file.write($.global.EditFlow2_JSON.stringify(value)); }
    finally { file.close(); }
  }

  var expectedItems = {};
  expectedItems[prefix + "_SOURCE_COMP"] = "COMPOSITION";
  expectedItems[prefix + "_TARGET_COMP"] = "COMPOSITION";
  expectedItems[prefix + "_AUDIO_MEDIA"] = "FOOTAGE";
  expectedItems[prefix + "_SOLID_MEDIA"] = "FOOTAGE";
  var expectedLayers = {};
  expectedLayers[prefix + "_CAMERA_LAYER"] = true;
  expectedLayers[prefix + "_SOLID_LAYER"] = true;
  expectedLayers[prefix + "_AUDIO_LAYER"] = true;
  expectedLayers[prefix + "_PRECOMP_LAYER"] = true;

  if (app.project.numItems !== 4) throw new Error("Layer-controls cleanup expected exactly four proof-owned project items.");
  var target = null;
  var seenItems = {};
  var i;
  for (i = 1; i <= app.project.numItems; i += 1) {
    var item = app.project.item(i);
    var id = stableId(item);
    if (!id || !expectedItems[id]) throw new Error("Layer-controls cleanup found an item outside the fixed proof fixture: " + String(id));
    if (seenItems[id]) throw new Error("Layer-controls cleanup found duplicate stable project identity: " + id);
    seenItems[id] = true;
    if (id === prefix + "_TARGET_COMP") target = item;
    if (expectedItems[id] === "COMPOSITION" && !(item instanceof CompItem)) throw new Error("Expected proof composition is not a CompItem: " + id);
    if (expectedItems[id] === "FOOTAGE" && !(item instanceof FootageItem)) throw new Error("Expected proof media is not a FootageItem: " + id);
  }
  for (var itemId in expectedItems) if (expectedItems.hasOwnProperty(itemId) && !seenItems[itemId]) throw new Error("Layer-controls cleanup is missing expected proof item: " + itemId);
  if (!target || !(target instanceof CompItem) || target.numLayers !== 4) throw new Error("Layer-controls cleanup target composition is incomplete.");

  var seenLayers = {};
  for (i = 1; i <= target.numLayers; i += 1) {
    var layer = target.layer(i);
    var layerId = stableId(layer);
    if (!layerId || !expectedLayers[layerId]) throw new Error("Layer-controls cleanup found a target layer outside the fixed proof fixture: " + String(layerId));
    if (seenLayers[layerId]) throw new Error("Layer-controls cleanup found duplicate stable layer identity: " + layerId);
    seenLayers[layerId] = true;
  }
  for (var layerIdExpected in expectedLayers) if (expectedLayers.hasOwnProperty(layerIdExpected) && !seenLayers[layerIdExpected]) throw new Error("Layer-controls cleanup is missing expected proof layer: " + layerIdExpected);

  var currentFile = new File($.fileName);
  var repoRoot = currentFile.parent.parent.parent.parent;
  var artifactDir = new Folder(repoRoot.fsName + "/proofs/artifacts/m3-layer-controls-p1-p2");
  if (!artifactDir.exists && !artifactDir.create()) throw new Error("Could not create layer-controls proof artifact directory for cleanup marker.");
  var markerFile = new File(artifactDir.fsName + "/cleanup-result.json");

  var closed = app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  if (closed === false) throw new Error("Layer-controls cleanup could not close the disposable project without saving.");
  app.newProject();
  if (!app.project || app.project.file || app.project.numItems !== 0) throw new Error("Layer-controls cleanup did not restore a fresh blank unsaved project.");

  writeJson(markerFile, {
    proofId: "M3_LAYER_CONTROLS_P1_P2_CLEANUP",
    ok: true,
    prefix: prefix,
    itemCount: app.project.numItems,
    filePath: null,
    hostProjectRevision: app.project.revision
  });
}());
