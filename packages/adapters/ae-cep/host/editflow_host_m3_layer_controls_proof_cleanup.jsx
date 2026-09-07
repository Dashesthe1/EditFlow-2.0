/* EditFlow 2.0 M3 layer-controls P3/P4 proof-only disposable-project cleanup.
 *
 * Loaded only for the isolated runner-owned AE process when
 * EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF=1. It adds no public protocol command.
 * After the exact post-rollback recovery render reaches DONE, this layer verifies
 * the unsaved project is exactly one layer-controls proof fixture generation:
 * one imported source, one target comp, and exactly one source-backed target
 * layer with the P3/P4-mutated enabled/shy switches restored to baseline. Only
 * then may it discard the disposable project without saving and create a fresh
 * blank project. The Node harness re-observes that project and must prove the
 * original blank structural fingerprint before cleanup is accepted.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF";
  var RECOVERY_REQUEST_NAME = "p4-post-rollback.avi";
  var ITEM_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var innerReconcile = $.global.EditFlow2_reconcileAsyncRender;

  if ($.getenv(PROOF_ENV) !== "1") return;
  if (typeof innerReconcile !== "function") {
    throw new Error("EditFlow M3 layer-controls proof cleanup requires async-render reconciliation.");
  }

  function asString(value) { return value === null || value === undefined ? "" : String(value); }

  function stableIdFromText(text) {
    var source = asString(text);
    var start = source.indexOf(ITEM_PREFIX);
    if (start < 0) return null;
    start += ITEM_PREFIX.length;
    var end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }

  function itemStableId(item) {
    try { return stableIdFromText(item.comment); } catch (_) { return null; }
  }

  function layerStableId(layer) {
    try { return stableIdFromText(layer.comment); } catch (_) { return null; }
  }

  function prefixForSuffix(stableId, suffix) {
    var value = asString(stableId);
    if (value.length <= suffix.length || value.substring(value.length - suffix.length) !== suffix) return null;
    return value.substring(0, value.length - suffix.length);
  }

  function assertRecoveryJob(job) {
    if (!job || !job.requestedOutputPath) return false;
    return asString((new File(job.requestedOutputPath)).name).toLowerCase() === RECOVERY_REQUEST_NAME;
  }

  function assertDisposableProofProject(job) {
    if (!app.project) throw new Error("M3 layer-controls proof cleanup requires an open project.");
    if (app.project.file) throw new Error("M3 layer-controls proof cleanup refuses to discard a saved project.");
    if (app.project.numItems !== 2) {
      throw new Error("M3 layer-controls proof cleanup requires exactly two proof-owned project items; found " + app.project.numItems + ".");
    }

    var target = null;
    var sourceMedia = null;
    var proofPrefix = null;
    var i;

    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      var stableId = itemStableId(item);
      if (!stableId) throw new Error("M3 layer-controls proof cleanup found a project item without a proof stableId.");

      var candidate = prefixForSuffix(stableId, "_TARGET_COMP");
      if (candidate !== null) {
        if (!(item instanceof CompItem) || target !== null) {
          throw new Error("M3 layer-controls proof cleanup found an invalid target composition fixture.");
        }
        target = item;
      } else {
        candidate = prefixForSuffix(stableId, "_SOURCE");
        if (candidate === null || sourceMedia !== null || !(item instanceof FootageItem)) {
          throw new Error("M3 layer-controls proof cleanup found an invalid source footage fixture: " + stableId);
        }
        sourceMedia = item;
      }

      if (candidate === null || candidate.indexOf("M3_LAYER_CONTROLS_P34_") !== 0) {
        throw new Error("M3 layer-controls proof cleanup found an item outside the fixed P3/P4 proof namespace: " + stableId);
      }
      if (proofPrefix === null) proofPrefix = candidate;
      else if (proofPrefix !== candidate) throw new Error("M3 layer-controls proof cleanup found mixed proof fixture generations.");
    }

    if (!target || !sourceMedia || !proofPrefix) {
      throw new Error("M3 layer-controls proof cleanup could not resolve the complete disposable fixture.");
    }
    if (target.numLayers !== 1) {
      throw new Error("M3 layer-controls proof cleanup target must contain exactly one proof-owned layer.");
    }

    var layer = target.layer(1);
    if (layerStableId(layer) !== proofPrefix + "_LAYER") {
      throw new Error("M3 layer-controls proof cleanup found an unexpected target layer stableId.");
    }
    try {
      if (layer.source !== sourceMedia) throw new Error("Target layer source identity does not match fixture source media.");
      if (layer.enabled !== true) throw new Error("P3-restored target layer must be enabled before cleanup.");
      if (layer.solo !== false) throw new Error("Proof target layer must not be soloed before cleanup.");
      if (layer.shy !== false) throw new Error("P4-restored target layer must not be shy before cleanup.");
      if (layer.locked !== false) throw new Error("Proof target layer must be unlocked before cleanup.");
    } catch (switchError) {
      throw new Error("M3 layer-controls proof cleanup fixture state check failed: " + asString(switchError));
    }

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