/* EditFlow 2.0 M3 temporal-interpolation P5 proof-only cleanup.
 *
 * Runs only on the isolated Windows runner with
 * EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF=1. It refuses to discard anything
 * unless the currently open saved project is the fixed P5 artifact and contains
 * exactly the proof-owned two-composition/one-layer/keyframed-Opacity fixture in
 * the known post-reconnect temporal state. The saved .aep is retained as P5 evidence.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF";
  var ITEM_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var proofFile = new File($.fileName);
  var repoRoot = proofFile.parent.parent.parent;
  var artifactDir = new Folder(repoRoot.fsName + "/proofs/artifacts/m3-temporal-interpolation-p5-transfer");
  var projectFile = new File(artifactDir.fsName + "/m3-temporal-interpolation-p5-transfer.aep");
  var markerFile = new File(artifactDir.fsName + "/cleanup-result.json");

  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function samePath(left, right) {
    return asString(left).replace(/\//g, "\\").toLowerCase() === asString(right).replace(/\//g, "\\").toLowerCase();
  }
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
    if ($.global.EditFlow2_JSON && typeof $.global.EditFlow2_JSON.stringify === "function") {
      return $.global.EditFlow2_JSON.stringify(value);
    }
    return "{" +
      "\"proofId\":" + quote(value.proofId) + "," +
      "\"ok\":" + (value.ok ? "true" : "false") + "," +
      "\"error\":" + (value.error === null ? "null" : quote(value.error)) +
      "}";
  }
  function writeMarker(value) {
    if (!artifactDir.exists && !artifactDir.create()) throw new Error("Unable to create temporal P5 artifact directory.");
    markerFile.encoding = "UTF-8";
    if (!markerFile.open("w")) throw new Error("Unable to open temporal P5 cleanup marker: " + markerFile.fsName);
    try { markerFile.write(stringify(value)); } finally { markerFile.close(); }
  }

  var payload = {
    proofId: "M3_TEMPORAL_INTERPOLATION_P5_CLEANUP",
    ok: false,
    error: null,
    proofPrefix: null,
    retainedProjectPath: projectFile.fsName,
    blankItemCount: null,
    verifiedFinalProjectItemCount: null,
    completedAtMs: (new Date()).getTime()
  };

  try {
    if ($.getenv(PROOF_ENV) !== "1") throw new Error("REFUSED: temporal P5 cleanup requires the isolated proof environment.");
    if (!app.project) throw new Error("Temporal P5 cleanup requires an open project.");
    if (!app.project.file || !samePath(app.project.file.fsName, projectFile.fsName)) {
      throw new Error("Temporal P5 cleanup refuses to discard a project other than the fixed saved proof artifact.");
    }
    if (app.project.numItems !== 2) {
      throw new Error("Temporal P5 cleanup requires exactly two proof compositions; found " + app.project.numItems + ".");
    }

    var sourceComp = null;
    var targetComp = null;
    var proofPrefix = null;
    var i;
    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (!(item instanceof CompItem)) throw new Error("Temporal P5 cleanup found a non-composition project item.");
      var stableId = itemStableId(item);
      if (!stableId) throw new Error("Temporal P5 cleanup found a project item without an EditFlow stableId.");
      var candidate = prefixForSuffix(stableId, "_SOURCE_COMP");
      if (candidate !== null) {
        if (sourceComp !== null) throw new Error("Temporal P5 cleanup found duplicate source compositions.");
        sourceComp = item;
      } else {
        candidate = prefixForSuffix(stableId, "_TARGET_COMP");
        if (candidate !== null) {
          if (targetComp !== null) throw new Error("Temporal P5 cleanup found duplicate target compositions.");
          targetComp = item;
        } else {
          throw new Error("Temporal P5 cleanup found an item outside the fixed fixture: " + stableId);
        }
      }
      if (candidate === null || candidate.indexOf("M3_TEMPORAL_P5_") !== 0) {
        throw new Error("Temporal P5 cleanup found a stableId outside the fixed proof namespace: " + stableId);
      }
      if (proofPrefix === null) proofPrefix = candidate;
      else if (proofPrefix !== candidate) throw new Error("Temporal P5 cleanup found mixed proof fixture generations.");
    }

    if (!sourceComp || !targetComp || !proofPrefix) {
      throw new Error("Temporal P5 cleanup could not resolve the complete two-composition fixture.");
    }
    if (sourceComp.numLayers !== 0) throw new Error("Temporal P5 source composition must remain layer-empty.");
    if (targetComp.numLayers !== 1) throw new Error("Temporal P5 target composition must contain exactly one proof layer.");

    var layer = targetComp.layer(1);
    if (!(layer instanceof AVLayer)) throw new Error("Temporal P5 target layer must be an AVLayer.");
    if (layerStableId(layer) !== proofPrefix + "_LAYER") throw new Error("Temporal P5 target layer stableId is not exact.");
    if (!layer.source || itemStableId(layer.source) !== proofPrefix + "_SOURCE_COMP") {
      throw new Error("Temporal P5 target layer source is not the proof-owned source composition.");
    }

    var transform = layer.property("ADBE Transform Group");
    var opacity = transform ? transform.property("ADBE Opacity") : null;
    if (!opacity || opacity.numKeys !== 3) throw new Error("Temporal P5 Opacity fixture must contain exactly three keyframes.");
    if (Math.abs(opacity.keyTime(2) - 0.5) > 0.000001) throw new Error("Temporal P5 middle Opacity key time is not exact.");
    if (Math.abs(Number(opacity.keyValue(2)) - 90) > 0.000001) throw new Error("Temporal P5 middle Opacity key value is not exact.");
    if (opacity.keyInInterpolationType(2) !== KeyframeInterpolationType.HOLD) {
      throw new Error("Temporal P5 cleanup requires incoming HOLD at the post-reconnect key.");
    }
    if (opacity.keyOutInterpolationType(2) !== KeyframeInterpolationType.LINEAR) {
      throw new Error("Temporal P5 cleanup requires outgoing LINEAR at the post-reconnect key.");
    }
    if (opacity.keyTemporalContinuous(2) !== false || opacity.keyTemporalAutoBezier(2) !== false) {
      throw new Error("Temporal P5 cleanup requires both temporal flags disabled in the post-reconnect state.");
    }

    payload.verifiedFinalProjectItemCount = app.project.numItems;
    var project = app.project;
    var closed = project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    if (closed === false) throw new Error("Temporal P5 cleanup could not close the disposable saved project.");
    app.newProject();
    if (!app.project || app.project.file || app.project.numItems !== 0) {
      throw new Error("Temporal P5 cleanup did not produce a fresh blank unsaved project.");
    }

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
