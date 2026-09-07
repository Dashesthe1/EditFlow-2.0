/* EditFlow 2.0 M3 managed null-rig P5 proof-only cleanup.
 *
 * Runs only on the isolated Windows runner with EDITFLOW_M3_NULL_RIG_P5_PROOF=1.
 * It refuses to discard anything unless the currently open saved project is the
 * fixed P5 artifact and the post-reconnect null-removal proof has left exactly
 * the two proof-owned compositions plus one detached visible child. In particular,
 * no managed null layer, managed null backing source, or proof-created support
 * folder may remain. The saved .aep is retained as transfer evidence.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_NULL_RIG_P5_PROOF";
  var ITEM_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var proofFile = new File($.fileName);
  var repoRoot = proofFile.parent.parent.parent;
  var artifactDir = new Folder(repoRoot.fsName + "/proofs/artifacts/m3-null-rig-p5-transfer");
  var projectFile = new File(artifactDir.fsName + "/m3-null-rig-p5-transfer.aep");
  var markerFile = new File(artifactDir.fsName + "/cleanup-result.json");

  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function samePath(left, right) {
    return asString(left).replace(/\//g, "\\").toLowerCase() === asString(right).replace(/\//g, "\\").toLowerCase();
  }
  function stableIdFromText(text, prefix) {
    var source = asString(text);
    var start = source.indexOf(prefix);
    if (start < 0) return null;
    start += prefix.length;
    var end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }
  function itemStableId(item) {
    try { return stableIdFromText(item.comment, ITEM_PREFIX); } catch (_) { return null; }
  }
  function layerStableId(layer) {
    try { return stableIdFromText(layer.comment, ITEM_PREFIX); } catch (_) { return null; }
  }
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
    if (!artifactDir.exists && !artifactDir.create()) throw new Error("Unable to create M3 null-rig P5 artifact directory.");
    markerFile.encoding = "UTF-8";
    if (!markerFile.open("w")) throw new Error("Unable to open M3 null-rig P5 cleanup marker: " + markerFile.fsName);
    try { markerFile.write(stringify(value)); } finally { markerFile.close(); }
  }

  var payload = {
    proofId: "M3_NULL_RIG_P5_CLEANUP",
    ok: false,
    error: null,
    proofPrefix: null,
    retainedProjectPath: projectFile.fsName,
    blankItemCount: null,
    verifiedFinalProjectItemCount: null,
    completedAtMs: (new Date()).getTime()
  };

  try {
    if ($.getenv(PROOF_ENV) !== "1") throw new Error("REFUSED: M3 null-rig P5 cleanup requires the isolated proof environment.");
    if (!app.project) throw new Error("M3 null-rig P5 cleanup requires an open project.");
    if (!app.project.file || !samePath(app.project.file.fsName, projectFile.fsName)) {
      throw new Error("M3 null-rig P5 cleanup refuses to discard a project other than the fixed saved proof artifact.");
    }
    if (app.project.numItems !== 2) {
      throw new Error("M3 null-rig P5 cleanup requires exactly the two core proof compositions after managed-null removal; found " + app.project.numItems + ".");
    }

    var sourceComp = null;
    var targetComp = null;
    var proofPrefix = null;
    var i;
    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (!(item instanceof CompItem)) throw new Error("M3 null-rig P5 cleanup found a non-composition project item after null removal.");
      var stableId = itemStableId(item);
      if (!stableId) throw new Error("M3 null-rig P5 cleanup found a core item without an EditFlow stableId.");
      var candidate = prefixForSuffix(stableId, "_SOURCE_COMP");
      if (candidate !== null) {
        if (sourceComp !== null) throw new Error("M3 null-rig P5 cleanup found duplicate source compositions.");
        sourceComp = item;
      } else {
        candidate = prefixForSuffix(stableId, "_TARGET_COMP");
        if (candidate !== null) {
          if (targetComp !== null) throw new Error("M3 null-rig P5 cleanup found duplicate target compositions.");
          targetComp = item;
        } else {
          throw new Error("M3 null-rig P5 cleanup found an item outside the fixed core fixture: " + stableId);
        }
      }
      if (candidate === null || candidate.indexOf("M3_NULL_RIG_P5_") !== 0) {
        throw new Error("M3 null-rig P5 cleanup found a stableId outside the fixed proof namespace: " + stableId);
      }
      if (proofPrefix === null) proofPrefix = candidate;
      else if (proofPrefix !== candidate) throw new Error("M3 null-rig P5 cleanup found mixed proof fixture generations.");
    }

    if (!sourceComp || !targetComp || !proofPrefix) throw new Error("M3 null-rig P5 cleanup could not resolve the complete core proof fixture.");
    if (sourceComp.numLayers !== 0) throw new Error("M3 null-rig P5 source composition must remain layer-empty.");
    if (targetComp.numLayers !== 1) {
      throw new Error("M3 null-rig P5 target composition must contain exactly one detached visible child after transferred null removal.");
    }

    var childLayer = targetComp.layer(1);
    var childId = layerStableId(childLayer);
    if (childId !== proofPrefix + "_CHILD_LAYER") {
      throw new Error("M3 null-rig P5 cleanup found an unexpected final target layer: " + asString(childId));
    }
    if (!(childLayer instanceof AVLayer)) throw new Error("M3 null-rig P5 final child must be an AVLayer.");
    if (!childLayer.source || itemStableId(childLayer.source) !== proofPrefix + "_SOURCE_COMP") {
      throw new Error("M3 null-rig P5 final child source is not the fixed proof source composition.");
    }
    if (childLayer.parent !== null) {
      throw new Error("M3 null-rig P5 final child must be detached after transferred null removal.");
    }

    payload.verifiedFinalProjectItemCount = app.project.numItems;
    var project = app.project;
    var closed = project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    if (closed === false) throw new Error("M3 null-rig P5 cleanup could not close the disposable saved project.");
    app.newProject();
    if (!app.project || app.project.file || app.project.numItems !== 0) {
      throw new Error("M3 null-rig P5 cleanup did not produce a fresh blank unsaved project.");
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
