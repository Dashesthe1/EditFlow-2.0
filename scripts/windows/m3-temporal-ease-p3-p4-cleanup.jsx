/* EditFlow 2.0 M3 temporal-ease P3/P4 proof-only cleanup.
 *
 * Runs only on the isolated Windows runner with
 * EDITFLOW_M3_TEMPORAL_EASE_P4_PROOF=1. It refuses to discard the
 * current unsaved project unless every project item/layer belongs to one exact
 * M3_TEMPORAL_EASE_P34_* fixture generation. Retained render artifacts live on
 * disk outside the AE project and are not removed.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_TEMPORAL_EASE_P4_PROOF";
  var ITEM_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var proofFile = new File($.fileName);
  var repoRoot = proofFile.parent.parent.parent;
  var artifactDir = new Folder(repoRoot.fsName + "/proofs/artifacts/m3-temporal-ease-p3-p4");
  var markerFile = new File(artifactDir.fsName + "/cleanup-result.json");

  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function stableIdFromText(text) {
    var source = asString(text);
    var start = source.indexOf(ITEM_PREFIX);
    if (start < 0) return null;
    start += ITEM_PREFIX.length;
    var end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }
  function itemStableId(item) { try { return stableIdFromText(item.comment); } catch (_) { return null; } }
  function layerStableId(layer) { try { return stableIdFromText(layer.comment); } catch (_) { return null; } }
  function prefixForSuffix(value, suffix) {
    var text = asString(value);
    if (text.length <= suffix.length || text.substring(text.length - suffix.length) !== suffix) return null;
    return text.substring(0, text.length - suffix.length);
  }
  function quote(value) {
    var text = asString(value);
    text = text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
    return "\"" + text + "\"";
  }
  function stringify(value) {
    if ($.global.EditFlow2_JSON && typeof $.global.EditFlow2_JSON.stringify === "function") return $.global.EditFlow2_JSON.stringify(value);
    return "{" +
      "\"proofId\":" + quote(value.proofId) + "," +
      "\"ok\":" + (value.ok ? "true" : "false") + "," +
      "\"error\":" + (value.error === null ? "null" : quote(value.error)) + "," +
      "\"proofPrefix\":" + (value.proofPrefix === null ? "null" : quote(value.proofPrefix)) + "," +
      "\"blankItemCount\":" + (value.blankItemCount === null ? "null" : String(value.blankItemCount)) + "," +
      "\"completedAtMs\":" + String(value.completedAtMs) +
      "}";
  }
  function writeMarker(value) {
    if (!artifactDir.exists && !artifactDir.create()) throw new Error("Unable to create temporal-ease P3/P4 artifact directory.");
    markerFile.encoding = "UTF-8";
    if (!markerFile.open("w")) throw new Error("Unable to open temporal-ease P3/P4 cleanup marker: " + markerFile.fsName);
    try { markerFile.write(stringify(value)); } finally { markerFile.close(); }
  }

  var payload = {
    proofId: "M3_TEMPORAL_EASE_P3_P4_CLEANUP",
    ok: false,
    error: null,
    proofPrefix: null,
    blankItemCount: null,
    completedAtMs: (new Date()).getTime()
  };

  try {
    if ($.getenv(PROOF_ENV) !== "1") throw new Error("REFUSED: temporal-ease P3/P4 cleanup requires the isolated proof environment.");
    if (!app.project) throw new Error("Temporal-ease P3/P4 cleanup requires an open project.");
    if (app.project.file) throw new Error("Temporal-ease P3/P4 cleanup refuses to discard a saved project.");
    if (app.project.numItems < 1 || app.project.numItems > 3) {
      throw new Error("Temporal-ease P3/P4 cleanup requires one to three proof-owned project items; found " + app.project.numItems + ".");
    }

    var proofPrefix = null;
    var backgroundSource = null;
    var foregroundSource = null;
    var targetComp = null;
    var i;
    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      var stableId = itemStableId(item);
      if (!stableId) throw new Error("Temporal-ease P3/P4 cleanup found an item without an EditFlow stableId.");
      var candidate = prefixForSuffix(stableId, "_BACKGROUND_SOURCE");
      if (candidate !== null) {
        if (backgroundSource !== null) throw new Error("Temporal-ease P3/P4 cleanup found duplicate background sources.");
        backgroundSource = item;
      } else {
        candidate = prefixForSuffix(stableId, "_FOREGROUND_SOURCE");
        if (candidate !== null) {
          if (foregroundSource !== null) throw new Error("Temporal-ease P3/P4 cleanup found duplicate foreground sources.");
          foregroundSource = item;
        } else {
          candidate = prefixForSuffix(stableId, "_TARGET_COMP");
          if (candidate !== null) {
            if (!(item instanceof CompItem)) throw new Error("Temporal-ease P3/P4 target stableId is not a composition.");
            if (targetComp !== null) throw new Error("Temporal-ease P3/P4 cleanup found duplicate target compositions.");
            targetComp = item;
          } else {
            throw new Error("Temporal-ease P3/P4 cleanup found an item outside the fixed proof fixture: " + stableId);
          }
        }
      }
      if (candidate === null || candidate.indexOf("M3_TEMPORAL_EASE_P34_") !== 0) {
        throw new Error("Temporal-ease P3/P4 cleanup found a stableId outside the fixed proof namespace: " + stableId);
      }
      if (proofPrefix === null) proofPrefix = candidate;
      else if (proofPrefix !== candidate) throw new Error("Temporal-ease P3/P4 cleanup found mixed proof fixture generations.");
    }

    if (!proofPrefix) throw new Error("Temporal-ease P3/P4 cleanup could not resolve the proof generation prefix.");
    if (targetComp) {
      if (!backgroundSource || !foregroundSource) throw new Error("Temporal-ease P3/P4 cleanup found a target composition without both proof-owned source items.");
      if (targetComp.numLayers !== 2) throw new Error("Temporal-ease P3/P4 target composition must contain exactly two proof-owned layers.");
      var expectedBackgroundLayer = proofPrefix + "_BACKGROUND_LAYER";
      var expectedForegroundLayer = proofPrefix + "_FOREGROUND_LAYER";
      var foundBackground = false;
      var foundForeground = false;
      for (i = 1; i <= targetComp.numLayers; i += 1) {
        var layer = targetComp.layer(i);
        var layerId = layerStableId(layer);
        if (layerId === expectedBackgroundLayer) {
          if (foundBackground) throw new Error("Temporal-ease P3/P4 cleanup found duplicate background layers.");
          if (!layer.source || itemStableId(layer.source) !== proofPrefix + "_BACKGROUND_SOURCE") throw new Error("Temporal-ease P3/P4 background layer does not use the proof-owned background source.");
          foundBackground = true;
        } else if (layerId === expectedForegroundLayer) {
          if (foundForeground) throw new Error("Temporal-ease P3/P4 cleanup found duplicate foreground layers.");
          if (!layer.source || itemStableId(layer.source) !== proofPrefix + "_FOREGROUND_SOURCE") throw new Error("Temporal-ease P3/P4 foreground layer does not use the proof-owned foreground source.");
          foundForeground = true;
        } else {
          throw new Error("Temporal-ease P3/P4 cleanup found a layer outside the fixed proof fixture: " + asString(layerId));
        }
      }
      if (!foundBackground || !foundForeground) throw new Error("Temporal-ease P3/P4 cleanup could not resolve both proof-owned layers.");
    }

    var project = app.project;
    var closed = project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    if (closed === false) throw new Error("Temporal-ease P3/P4 cleanup could not close the disposable unsaved project.");
    app.newProject();
    if (!app.project || app.project.file || app.project.numItems !== 0) throw new Error("Temporal-ease P3/P4 cleanup did not produce a fresh blank unsaved project.");

    payload.ok = true;
    payload.proofPrefix = proofPrefix;
    payload.blankItemCount = app.project.numItems;
    payload.completedAtMs = (new Date()).getTime();
  } catch (error) {
    payload.error = asString(error);
    payload.completedAtMs = (new Date()).getTime();
  }

  writeMarker(payload);
}());
