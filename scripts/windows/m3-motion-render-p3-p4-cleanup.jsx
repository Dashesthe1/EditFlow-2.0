/* EditFlow 2.0 protocol 1.10 motion-render P3/P4 proof-only cleanup. */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_MOTION_RENDER_P4_PROOF";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var PROOF_NAMESPACE = "M3_MOTION_RENDER_P34_";
  var ITEM_SUFFIXES = ["_BLEND_TARGET_COMP", "_MOTION_COMP", "_BLEND_MEDIA", "_MEDIA"];
  var LAYER_SUFFIXES = ["_BLEND_TARGET_LAYER", "_MOTION_LAYER"];
  var proofFile = new File($.fileName);
  var repoRoot = proofFile.parent.parent.parent;
  var artifactDir = new Folder(repoRoot.fsName + "/proofs/artifacts/m3-motion-render-p3-p4");
  var markerFile = new File(artifactDir.fsName + "/cleanup-result.json");

  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function stableIdFromText(text) {
    var source = asString(text), start = source.indexOf(STABLE_PREFIX), end;
    if (start < 0) return null;
    start += STABLE_PREFIX.length;
    end = source.indexOf(STABLE_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }
  function stableIdOf(target) { try { return stableIdFromText(target.comment); } catch (_) { return null; } }
  function prefixForAllowedSuffix(stableId, suffixes) {
    var text = asString(stableId), i, suffix;
    for (i = 0; i < suffixes.length; i += 1) {
      suffix = suffixes[i];
      if (text.length > suffix.length && text.substring(text.length - suffix.length) === suffix) {
        return text.substring(0, text.length - suffix.length);
      }
    }
    return null;
  }
  function quote(value) {
    var text = asString(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
    return "\"" + text + "\"";
  }
  function stringify(value) {
    if ($.global.EditFlow2_JSON && typeof $.global.EditFlow2_JSON.stringify === "function") return $.global.EditFlow2_JSON.stringify(value);
    return "{" +
      "\"proofId\":" + quote(value.proofId) + "," +
      "\"ok\":" + (value.ok ? "true" : "false") + "," +
      "\"error\":" + (value.error === null ? "null" : quote(value.error)) + "," +
      "\"proofPrefix\":" + (value.proofPrefix === null ? "null" : quote(value.proofPrefix)) + "," +
      "\"verifiedItemCount\":" + String(value.verifiedItemCount) + "," +
      "\"blankItemCount\":" + String(value.blankItemCount) +
      "}";
  }
  function writeMarker(value) {
    if (!artifactDir.exists && !artifactDir.create()) throw new Error("Unable to create motion-render P3/P4 artifact directory.");
    markerFile.encoding = "UTF-8";
    if (!markerFile.open("w")) throw new Error("Unable to open motion-render P3/P4 cleanup marker: " + markerFile.fsName);
    try { markerFile.write(stringify(value)); } finally { markerFile.close(); }
  }

  var payload = {
    proofId: "M3_MOTION_RENDER_P3_P4_CLEANUP",
    ok: false,
    error: null,
    proofPrefix: null,
    verifiedItemCount: null,
    blankItemCount: null,
    completedAtMs: (new Date()).getTime()
  };

  try {
    if ($.getenv(PROOF_ENV) !== "1") throw new Error("REFUSED: motion-render P3/P4 cleanup requires the isolated proof environment.");
    if (!app.project) throw new Error("Motion-render P3/P4 cleanup requires an open project.");
    if (app.project.file) throw new Error("Motion-render P3/P4 cleanup refuses to discard a saved project.");

    var project = app.project;
    var proofPrefix = null;
    var i, j, item, itemStable, itemPrefix, layer, layerStable, layerPrefix, sourceStable;
    for (i = 1; i <= project.numItems; i += 1) {
      item = project.item(i);
      itemStable = stableIdOf(item);
      itemPrefix = prefixForAllowedSuffix(itemStable, ITEM_SUFFIXES);
      if (!itemPrefix || itemPrefix.indexOf(PROOF_NAMESPACE) !== 0) {
        throw new Error("Motion-render P3/P4 cleanup found a foreign or unmarked project item: " + asString(itemStable || item.name));
      }
      if (proofPrefix === null) proofPrefix = itemPrefix;
      else if (proofPrefix !== itemPrefix) throw new Error("Motion-render P3/P4 cleanup found mixed proof fixture generations.");

      if (item instanceof CompItem) {
        for (j = 1; j <= item.numLayers; j += 1) {
          layer = item.layer(j);
          layerStable = stableIdOf(layer);
          layerPrefix = prefixForAllowedSuffix(layerStable, LAYER_SUFFIXES);
          if (!layerPrefix || layerPrefix !== proofPrefix) {
            throw new Error("Motion-render P3/P4 cleanup found a foreign or unmarked layer: " + asString(layerStable || layer.name));
          }
          try {
            if (layer.source) {
              sourceStable = stableIdOf(layer.source);
              if (!sourceStable || prefixForAllowedSuffix(sourceStable, ITEM_SUFFIXES) !== proofPrefix) {
                throw new Error("Motion-render P3/P4 cleanup found a layer with a foreign source item.");
              }
            }
          } catch (sourceError) {
            throw sourceError;
          }
        }
      }
    }

    payload.proofPrefix = proofPrefix;
    payload.verifiedItemCount = project.numItems;
    if (project.numItems > 0 && proofPrefix === null) throw new Error("Motion-render P3/P4 cleanup could not resolve the proof fixture namespace.");

    var closed = project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    if (closed === false) throw new Error("Motion-render P3/P4 cleanup could not close the disposable proof project.");
    app.newProject();
    if (!app.project || app.project.file || app.project.numItems !== 0) throw new Error("Motion-render P3/P4 cleanup did not produce a fresh blank unsaved project.");

    payload.ok = true;
    payload.blankItemCount = app.project.numItems;
    payload.completedAtMs = (new Date()).getTime();
  } catch (error) {
    payload.error = asString(error);
    payload.completedAtMs = (new Date()).getTime();
  }

  writeMarker(payload);
}());
