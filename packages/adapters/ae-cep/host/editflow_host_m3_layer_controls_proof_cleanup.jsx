/* EditFlow 2.0 M3 layer-controls P3/P4 proof-only disposable-project cleanup.
 *
 * Loaded only for the isolated runner-owned AE process when
 * EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF=1. It adds no public protocol command.
 * After the exact post-rollback recovery render reaches DONE, this wrapper
 * verifies that the unsaved project contains exactly one proof generation:
 * two imported full-frame sources, one target comp, and exactly two source-backed
 * target layers in the restored baseline order/state. Only then may it discard
 * the disposable project without saving and create a fresh blank project.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF";
  var RECOVERY_REQUEST_NAME = "p4-post-rollback-front.avi";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var innerReconcile = $.global.EditFlow2_reconcileAsyncRender;

  if ($.getenv(PROOF_ENV) !== "1") return;
  if (typeof innerReconcile !== "function") {
    throw new Error("EditFlow M3 layer-controls proof cleanup requires async-render reconciliation.");
  }

  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function stableIdFromText(text) {
    var source = asString(text);
    var start = source.indexOf(STABLE_PREFIX);
    if (start < 0) return null;
    start += STABLE_PREFIX.length;
    var end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }
  function itemStableId(item) { try { return stableIdFromText(item.comment); } catch (_) { return null; } }
  function layerStableId(layer) { try { return stableIdFromText(layer.comment); } catch (_) { return null; } }
  function prefixForSuffix(stableId, suffix) {
    var value = asString(stableId);
    if (value.length <= suffix.length || value.substring(value.length - suffix.length) !== suffix) return null;
    return value.substring(0, value.length - suffix.length);
  }
  function assertRecoveryJob(job) {
    if (!job || !job.requestedOutputPath) return false;
    return asString((new File(job.requestedOutputPath)).name).toLowerCase() === RECOVERY_REQUEST_NAME;
  }

  function assertLayer(layer, expectedStableId, expectedSource, expectedIndex) {
    if (!layer) throw new Error("M3 layer-controls proof cleanup could not resolve expected target layer.");
    if (layerStableId(layer) !== expectedStableId) {
      throw new Error("M3 layer-controls proof cleanup found unexpected layer stableId at index " + expectedIndex + ".");
    }
    if (layer.index !== expectedIndex) throw new Error("M3 layer-controls proof cleanup found unexpected layer order.");
    try {
      if (layer.source !== expectedSource) throw new Error("Layer source identity does not match proof fixture source media.");
      if (layer.enabled !== true) throw new Error("Restored proof layer must be enabled before cleanup.");
      if (layer.solo !== false) throw new Error("Restored proof layer must not be soloed before cleanup.");
      if (layer.locked !== false) throw new Error("Restored proof layer must be unlocked before cleanup.");
    } catch (stateError) {
      throw new Error("M3 layer-controls proof cleanup layer-state check failed: " + asString(stateError));
    }
  }

  function assertDisposableProofProject(job) {
    if (!app.project) throw new Error("M3 layer-controls proof cleanup requires an open project.");
    if (app.project.file) throw new Error("M3 layer-controls proof cleanup refuses to discard a saved project.");
    if (app.project.numItems !== 3) {
      throw new Error("M3 layer-controls proof cleanup requires exactly three proof-owned project items; found " + app.project.numItems + ".");
    }

    var target = null;
    var backSource = null;
    var frontSource = null;
    var proofPrefix = null;
    var i;

    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      var stableId = itemStableId(item);
      if (!stableId) throw new Error("M3 layer-controls proof cleanup found a project item without a proof stableId.");

      var candidate = prefixForSuffix(stableId, "_TARGET_COMP");
      if (candidate !== null) {
        if (!(item instanceof CompItem) || target !== null) throw new Error("M3 layer-controls proof cleanup found an invalid target comp.");
        target = item;
      } else {
        candidate = prefixForSuffix(stableId, "_BACK_SOURCE");
        if (candidate !== null) {
          if (backSource !== null || !(item instanceof FootageItem)) throw new Error("M3 layer-controls proof cleanup found an invalid back source.");
          backSource = item;
        } else {
          candidate = prefixForSuffix(stableId, "_FRONT_SOURCE");
          if (candidate === null || frontSource !== null || !(item instanceof FootageItem)) {
            throw new Error("M3 layer-controls proof cleanup found an invalid proof item: " + stableId);
          }
          frontSource = item;
        }
      }

      if (candidate === null || candidate.indexOf("M3_LAYER_CONTROLS_P34_") !== 0) {
        throw new Error("M3 layer-controls proof cleanup found an item outside the fixed P3/P4 proof namespace: " + stableId);
      }
      if (proofPrefix === null) proofPrefix = candidate;
      else if (proofPrefix !== candidate) throw new Error("M3 layer-controls proof cleanup found mixed proof fixture generations.");
    }

    if (!target || !backSource || !frontSource || !proofPrefix) throw new Error("M3 layer-controls proof cleanup could not resolve the complete fixture.");
    if (target.numLayers !== 2) throw new Error("M3 layer-controls proof cleanup target must contain exactly two proof-owned layers.");

    assertLayer(target.layer(1), proofPrefix + "_FRONT_LAYER", frontSource, 1);
    assertLayer(target.layer(2), proofPrefix + "_BACK_LAYER", backSource, 2);

    if (!job.jobId) throw new Error("M3 layer-controls proof cleanup requires completed render job identity.");
    return proofPrefix;
  }

  $.global.EditFlow2_reconcileAsyncRender = function () {
    var state = innerReconcile();
    if (state !== "DONE") return state;

    var job = $.global.EditFlow2_lastRenderJob;
    if (!assertRecoveryJob(job)) return state;
    if (job.proofCleanupCompleted === true) return state;

    var proofPrefix = assertDisposableProofProject(job);
    var project = app.project;
    var closed = project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    if (closed === false) throw new Error("M3 layer-controls proof cleanup could not close the disposable project without saving.");
    app.newProject();
    if (!app.project || app.project.file || app.project.numItems !== 0) {
      throw new Error("M3 layer-controls proof cleanup did not produce the required fresh blank unsaved project.");
    }

    job.proofCleanupCompleted = true;
    $.global.EditFlow2_lastProofCleanup = {
      proofId: "M3_LAYER_CONTROLS_P3_P4_REAL_AE",
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
