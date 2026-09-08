/* EditFlow 2.0 M3 marker/motion P3/P4 proof-only disposable-project cleanup.
 * Loaded only for the isolated protocol 2.0 P4 process. After the final recovery
 * render reaches DONE, this guard verifies the exact proof-owned fixture topology
 * before discarding the unsaved disposable project and creating a fresh blank one.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_MARKER_MOTION_P4_PROOF";
  var RECOVERY_REQUEST_NAME = "p4-post-rollback.avi";
  var ITEM_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var innerReconcile = $.global.EditFlow2_reconcileAsyncRender;

  if ($.getenv(PROOF_ENV) !== "1") return;
  if (typeof innerReconcile !== "function") throw new Error("EditFlow marker-motion proof cleanup requires async-render reconciliation.");

  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function stableIdFromText(text) {
    var source = asString(text), start = source.indexOf(ITEM_PREFIX), end;
    if (start < 0) return null;
    start += ITEM_PREFIX.length;
    end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }
  function itemStableId(item) { try { return stableIdFromText(item.comment); } catch (_) { return null; } }
  function layerStableId(layer) { try { return stableIdFromText(layer.comment); } catch (_) { return null; } }
  function prefixForSuffix(stableId, suffix) {
    var value = asString(stableId);
    if (value.length <= suffix.length || value.substring(value.length - suffix.length) !== suffix) return null;
    return value.substring(0, value.length - suffix.length);
  }
  function isRecoveryJob(job) {
    if (!job || !job.requestedOutputPath) return false;
    return asString((new File(job.requestedOutputPath)).name).toLowerCase() === RECOVERY_REQUEST_NAME;
  }
  function requireLayer(comp, stableId, source) {
    var i, found = null;
    if (!comp || !(comp instanceof CompItem) || comp.numLayers !== 1) throw new Error("Marker-motion proof cleanup expected a one-layer proof composition.");
    for (i = 1; i <= comp.numLayers; i += 1) {
      var layer = comp.layer(i);
      if (layerStableId(layer) === stableId) found = layer;
    }
    if (!found) throw new Error("Marker-motion proof cleanup could not resolve proof layer " + stableId + ".");
    try {
      if (found.source !== source) throw new Error("Marker-motion proof layer source did not match its proof-owned footage item.");
    } catch (sourceError) { throw sourceError; }
    return found;
  }

  function assertDisposableProofProject(job) {
    if (!app.project) throw new Error("Marker-motion proof cleanup requires an open project.");
    if (app.project.file) throw new Error("Marker-motion proof cleanup refuses to discard a saved project.");
    if (app.project.numItems !== 4) throw new Error("Marker-motion proof cleanup requires exactly four proof-owned project items; found " + app.project.numItems + ".");

    var motionComp = null, blendComp = null, motionMedia = null, sequenceMedia = null;
    var proofPrefix = null, i;
    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i), stableId = itemStableId(item), candidate = null;
      if (!stableId) throw new Error("Marker-motion proof cleanup found a project item without a proof stableId.");
      candidate = prefixForSuffix(stableId, "_MOTION_COMP");
      if (candidate !== null) {
        if (!(item instanceof CompItem) || motionComp !== null) throw new Error("Marker-motion proof cleanup found an invalid motion composition fixture.");
        motionComp = item;
      } else {
        candidate = prefixForSuffix(stableId, "_BLEND_COMP");
        if (candidate !== null) {
          if (!(item instanceof CompItem) || blendComp !== null) throw new Error("Marker-motion proof cleanup found an invalid blend composition fixture.");
          blendComp = item;
        } else {
          candidate = prefixForSuffix(stableId, "_MOTION_MEDIA");
          if (candidate !== null) {
            if (motionMedia !== null || item instanceof CompItem) throw new Error("Marker-motion proof cleanup found an invalid motion media fixture.");
            motionMedia = item;
          } else {
            candidate = prefixForSuffix(stableId, "_SEQUENCE_MEDIA");
            if (candidate !== null) {
              if (sequenceMedia !== null || item instanceof CompItem) throw new Error("Marker-motion proof cleanup found an invalid sequence media fixture.");
              sequenceMedia = item;
            } else throw new Error("Marker-motion proof cleanup found an item outside the fixed proof fixture set: " + stableId);
          }
        }
      }
      if (candidate === null || candidate.indexOf("M3_MARKER_MOTION_P34_") !== 0) throw new Error("Marker-motion proof cleanup found a stableId outside the fixed proof namespace: " + stableId);
      if (proofPrefix === null) proofPrefix = candidate;
      else if (proofPrefix !== candidate) throw new Error("Marker-motion proof cleanup found mixed proof fixture generations.");
    }

    if (!motionComp || !blendComp || !motionMedia || !sequenceMedia || !proofPrefix) throw new Error("Marker-motion proof cleanup could not resolve the complete fixed fixture.");
    requireLayer(motionComp, proofPrefix + "_MOTION_LAYER", motionMedia);
    requireLayer(blendComp, proofPrefix + "_BLEND_LAYER", sequenceMedia);
    if (!job.jobId) throw new Error("Marker-motion proof cleanup requires completed render job identity.");
    return proofPrefix;
  }

  $.global.EditFlow2_reconcileAsyncRender = function () {
    var state = innerReconcile();
    if (state !== "DONE") return state;
    var job = $.global.EditFlow2_lastRenderJob;
    if (!isRecoveryJob(job)) return state;
    if (job.proofCleanupCompleted === true) return state;

    var proofPrefix = assertDisposableProofProject(job);
    var project = app.project;
    var closed = project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    if (closed === false) throw new Error("Marker-motion proof cleanup could not close the disposable project without saving.");
    app.newProject();
    if (!app.project || app.project.file || app.project.numItems !== 0) throw new Error("Marker-motion proof cleanup did not produce the required fresh blank unsaved project.");

    job.proofCleanupCompleted = true;
    $.global.EditFlow2_lastProofCleanup = {
      proofId: "M3_MARKER_MOTION_P3_P4_REAL_AE",
      jobId: job.jobId,
      proofPrefix: proofPrefix,
      ok: true,
      itemCount: app.project.numItems,
      filePath: null,
      completedAtMs: (new Date()).getTime()
    };
    return state;
  };
}());
