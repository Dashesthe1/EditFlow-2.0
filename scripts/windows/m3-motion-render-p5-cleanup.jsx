/* EditFlow 2.0 M3 motion-render P5 proof-only cleanup. */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_MOTION_RENDER_P5_PROOF";
  var ITEM_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var proofFile = new File($.fileName);
  var repoRoot = proofFile.parent.parent.parent;
  var artifactDir = new Folder(repoRoot.fsName + "/proofs/artifacts/m3-motion-render-p5-transfer");
  var projectFile = new File(artifactDir.fsName + "/m3-motion-render-p5-transfer.aep");
  var markerFile = new File(artifactDir.fsName + "/cleanup-result.json");

  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function samePath(left, right) { return asString(left).replace(/\//g, "\\").toLowerCase() === asString(right).replace(/\//g, "\\").toLowerCase(); }
  function stableIdFromText(text) {
    var source = asString(text), start = source.indexOf(ITEM_PREFIX), end;
    if (start < 0) return null;
    start += ITEM_PREFIX.length;
    end = source.indexOf(MARKER_SUFFIX, start);
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
    var text = asString(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
    return "\"" + text + "\"";
  }
  function stringify(value) {
    if ($.global.EditFlow2_JSON && typeof $.global.EditFlow2_JSON.stringify === "function") return $.global.EditFlow2_JSON.stringify(value);
    return "{" + "\"proofId\":" + quote(value.proofId) + "," + "\"ok\":" + (value.ok ? "true" : "false") + "," + "\"error\":" + (value.error === null ? "null" : quote(value.error)) + "}";
  }
  function writeMarker(value) {
    if (!artifactDir.exists && !artifactDir.create()) throw new Error("Unable to create motion-render P5 artifact directory.");
    markerFile.encoding = "UTF-8";
    if (!markerFile.open("w")) throw new Error("Unable to open motion-render P5 cleanup marker: " + markerFile.fsName);
    try { markerFile.write(stringify(value)); } finally { markerFile.close(); }
  }
  function closeNumber(left, right) { return Math.abs(Number(left) - Number(right)) <= 0.000001; }

  var payload = {
    proofId: "M3_MOTION_RENDER_P5_CLEANUP",
    ok: false,
    error: null,
    proofPrefix: null,
    retainedProjectPath: projectFile.fsName,
    blankItemCount: null,
    verifiedFinalProjectItemCount: null,
    nativeLayerId: null,
    completedAtMs: (new Date()).getTime()
  };

  try {
    if ($.getenv(PROOF_ENV) !== "1") throw new Error("REFUSED: motion-render P5 cleanup requires the isolated proof environment.");
    if (!app.project) throw new Error("Motion-render P5 cleanup requires an open project.");
    if (!app.project.file || !samePath(app.project.file.fsName, projectFile.fsName)) throw new Error("Motion-render P5 cleanup refuses to discard a project other than the fixed saved proof artifact.");
    if (app.project.numItems !== 2) throw new Error("Motion-render P5 cleanup requires exactly two proof compositions; found " + app.project.numItems + ".");

    var sourceComp = null, targetComp = null, proofPrefix = null, i;
    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (!(item instanceof CompItem)) throw new Error("Motion-render P5 cleanup found a non-composition project item.");
      var stableId = itemStableId(item);
      if (!stableId) throw new Error("Motion-render P5 cleanup found a project item without an EditFlow stableId.");
      var candidate = prefixForSuffix(stableId, "_SOURCE_COMP");
      if (candidate !== null) {
        if (sourceComp !== null) throw new Error("Motion-render P5 cleanup found duplicate source compositions.");
        sourceComp = item;
      } else {
        candidate = prefixForSuffix(stableId, "_TARGET_COMP");
        if (candidate !== null) {
          if (targetComp !== null) throw new Error("Motion-render P5 cleanup found duplicate target compositions.");
          targetComp = item;
        } else throw new Error("Motion-render P5 cleanup found an item outside the fixed fixture: " + stableId);
      }
      if (candidate === null || candidate.indexOf("M3_MOTION_RENDER_P5_") !== 0) throw new Error("Motion-render P5 cleanup found a stableId outside the fixed proof namespace: " + stableId);
      if (proofPrefix === null) proofPrefix = candidate;
      else if (proofPrefix !== candidate) throw new Error("Motion-render P5 cleanup found mixed proof fixture generations.");
    }

    if (!sourceComp || !targetComp || !proofPrefix) throw new Error("Motion-render P5 cleanup could not resolve the complete two-composition fixture.");
    if (sourceComp.numLayers !== 0) throw new Error("Motion-render P5 source composition must remain layer-empty.");
    if (targetComp.numLayers !== 1) throw new Error("Motion-render P5 target composition must contain exactly one proof layer.");

    var layer = targetComp.layer(1);
    if (!(layer instanceof AVLayer)) throw new Error("Motion-render P5 target layer must be an AVLayer.");
    if (layerStableId(layer) !== proofPrefix + "_LAYER") throw new Error("Motion-render P5 target layer stableId is not exact.");
    if (!layer.source || itemStableId(layer.source) !== proofPrefix + "_SOURCE_COMP") throw new Error("Motion-render P5 target layer source is not the proof-owned source composition.");

    if (targetComp.motionBlur !== false) throw new Error("Motion-render P5 cleanup requires post-reconnect composition motionBlur=false.");
    if (targetComp.frameBlending !== true) throw new Error("Motion-render P5 cleanup requires post-reconnect composition frameBlending=true.");
    if (!closeNumber(targetComp.shutterAngle, 180)) throw new Error("Motion-render P5 cleanup shutterAngle is not 180.");
    if (!closeNumber(targetComp.shutterPhase, -45)) throw new Error("Motion-render P5 cleanup shutterPhase is not -45.");
    if (!closeNumber(targetComp.motionBlurSamplesPerFrame, 32)) throw new Error("Motion-render P5 cleanup samplesPerFrame is not 32.");
    if (!closeNumber(targetComp.motionBlurAdaptiveSampleLimit, 128)) throw new Error("Motion-render P5 cleanup adaptiveSampleLimit is not 128.");
    if (layer.motionBlur !== false) throw new Error("Motion-render P5 cleanup requires post-reconnect layer motionBlur=false.");
    if (layer.frameBlendingType !== FrameBlendingType.PIXEL_MOTION) throw new Error("Motion-render P5 cleanup requires post-reconnect PIXEL_MOTION.");
    if (layer.frameBlending !== true) throw new Error("Motion-render P5 cleanup requires derived frameBlending=true.");

    payload.verifiedFinalProjectItemCount = app.project.numItems;
    try { payload.nativeLayerId = typeof layer.id === "number" ? layer.id : null; } catch (_) { payload.nativeLayerId = null; }
    var project = app.project;
    var closed = project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    if (closed === false) throw new Error("Motion-render P5 cleanup could not close the disposable saved project.");
    app.newProject();
    if (!app.project || app.project.file || app.project.numItems !== 0) throw new Error("Motion-render P5 cleanup did not produce a fresh blank unsaved project.");

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
