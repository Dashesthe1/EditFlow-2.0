/* EditFlow 2.0 M3 layer-controls P1/P2 proof-only cleanup.
 * Verifies the exact prefix-owned disposable fixture before discarding the
 * unsaved project and restoring a fresh blank unsaved project.
 *
 * Cleanup never rethrows through After Effects' -r route. Success or the exact
 * failing stage is written to the proof marker so unattended runs cannot be
 * blocked by a modal script-error dialog.
 *
 * Direct -r scripts can execute outside the CEP panel's ExtendScript engine, so
 * cleanup-marker serialization is self-contained and does not depend on a
 * panel-populated JSON global.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF";
  var PREFIX_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX";
  var ARTIFACT_DIR_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_ARTIFACT_DIR";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var stage = "preflight";

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
  function cleanDiagnostic(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/[\r\n\t]+/g, " ")
      .substring(0, 1600);
  }
  function jsonQuote(value) {
    return '"' + String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t") + '"';
  }
  function markerStringify(value) {
    if (value === null || value === undefined) return "null";
    var kind = typeof value;
    if (kind === "string") return jsonQuote(value);
    if (kind === "boolean") return value ? "true" : "false";
    if (kind === "number") return isFinite(value) ? String(value) : "null";
    if (value instanceof Array) {
      var arrayParts = [];
      for (var i = 0; i < value.length; i += 1) arrayParts.push(markerStringify(value[i]));
      return "[" + arrayParts.join(",") + "]";
    }
    if (kind === "object") {
      var objectParts = [];
      for (var key in value) {
        if (value.hasOwnProperty(key)) objectParts.push(jsonQuote(key) + ":" + markerStringify(value[key]));
      }
      return "{" + objectParts.join(",") + "}";
    }
    return "null";
  }
  function writeJson(file, value) {
    try {
      file.encoding = "UTF-8";
      if (!file.open("w")) return false;
      try { file.write(markerStringify(value)); }
      finally { file.close(); }
      return true;
    } catch (_) {
      try { file.close(); } catch (__) {}
      return false;
    }
  }

  if ($.getenv(PROOF_ENV) !== "1") return;
  var prefix = $.getenv(PREFIX_ENV);
  if (!prefix || prefix.indexOf("M3_LAYER_CONTROLS_P12_") !== 0) return;
  if (!app.project || app.project.file) return;

  var artifactDirPath = $.getenv(ARTIFACT_DIR_ENV);
  if (!artifactDirPath) return;
  var artifactDir = new Folder(artifactDirPath);
  try { if (!artifactDir.exists) artifactDir.create(); } catch (_) {}
  var markerFile = new File(artifactDir.fsName + "/cleanup-result.json");
  var target = null;

  try {
    stage = "validate_fixture_shape";
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

    stage = "discard_fixture_project";
    var closed = app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    if (closed === false) throw new Error("Layer-controls cleanup could not close the disposable project without saving.");

    stage = "restore_blank_project";
    app.newProject();
    if (!app.project || app.project.file || app.project.numItems !== 0) throw new Error("Layer-controls cleanup did not restore a fresh blank unsaved project.");

    stage = "write_success_marker";
    writeJson(markerFile, {
      proofId: "M3_LAYER_CONTROLS_P1_P2_CLEANUP",
      ok: true,
      prefix: prefix,
      stage: "complete",
      itemCount: app.project.numItems,
      filePath: null,
      hostProjectRevision: app.project.revision
    });
  } catch (error) {
    writeJson(markerFile, {
      proofId: "M3_LAYER_CONTROLS_P1_P2_CLEANUP",
      ok: false,
      prefix: prefix,
      stage: stage,
      error: cleanDiagnostic(error),
      hostProjectRevision: app.project ? app.project.revision : null,
      itemCount: app.project ? app.project.numItems : null
    });
    return;
  }
}());
