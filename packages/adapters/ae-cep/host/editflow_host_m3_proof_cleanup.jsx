/* EditFlow 2.0 M3 P3/P4 proof-only disposable-project cleanup.
 *
 * This layer is loaded only when the isolated self-hosted AE runner explicitly
 * inherits EDITFLOW_M3_MASK_P4_PROOF=1. It does not add a protocol command or a
 * production capability. After the exact post-rollback recovery render reaches
 * terminal DONE, it verifies that the open project is unsaved and contains only
 * the three proof-owned project items plus their exact proof-owned layers/mask.
 * Only then may it discard that disposable project without saving and create a
 * fresh blank project. The Node harness re-observes the new project and must still
 * prove the original blank structural fingerprint before cleanup is accepted.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_MASK_P4_PROOF";
  var RECOVERY_REQUEST_NAME = "p4-post-rollback.avi";
  var ITEM_PREFIX = "[[EDITFLOW2_STABLE:";
  var MASK_PREFIX = "[[EDITFLOW2_MASK:";
  var MARKER_SUFFIX = "]]";
  var innerReconcile = $.global.EditFlow2_reconcileAsyncRender;

  if ($.getenv(PROOF_ENV) !== "1") return;
  if (typeof innerReconcile !== "function") {
    throw new Error("EditFlow M3 proof cleanup requires async-render reconciliation.");
  }

  function asString(value) { return value === null || value === undefined ? "" : String(value); }

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

  function maskStableId(mask) {
    try { return stableIdFromText(mask.name, MASK_PREFIX); } catch (_) { return null; }
  }

  function prefixForSuffix(stableId, suffix) {
    var value = asString(stableId);
    if (value.length <= suffix.length || value.substring(value.length - suffix.length) !== suffix) return null;
    return value.substring(0, value.length - suffix.length);
  }

  function assertRecoveryJob(job) {
    if (!job || !job.requestedOutputPath) return false;
    var requested = new File(job.requestedOutputPath);
    return asString(requested.name).toLowerCase() === RECOVERY_REQUEST_NAME;
  }

  function assertDisposableProofProject(job) {
    if (!app.project) throw new Error("M3 proof cleanup requires an open project.");
    if (app.project.file) throw new Error("M3 proof cleanup refuses to discard a saved project.");
    if (app.project.numItems !== 3) {
      throw new Error("M3 proof cleanup requires exactly three proof-owned project items; found " + app.project.numItems + ".");
    }

    var target = null;
    var background = null;
    var foreground = null;
    var proofPrefix = null;
    var i;
    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      var stableId = itemStableId(item);
      if (!stableId) throw new Error("M3 proof cleanup found a project item without a proof stableId.");

      var candidate = prefixForSuffix(stableId, "_TARGET_COMP");
      if (candidate !== null) {
        if (!(item instanceof CompItem) || target !== null) throw new Error("M3 proof cleanup found an invalid target composition fixture.");
        target = item;
      } else {
        candidate = prefixForSuffix(stableId, "_BG_MEDIA");
        if (candidate !== null) {
          if (background !== null) throw new Error("M3 proof cleanup found duplicate background fixture media.");
          background = item;
        } else {
          candidate = prefixForSuffix(stableId, "_FG_MEDIA");
          if (candidate !== null) {
            if (foreground !== null) throw new Error("M3 proof cleanup found duplicate foreground fixture media.");
            foreground = item;
          } else {
            throw new Error("M3 proof cleanup found an item outside the fixed proof-owned fixture set: " + stableId);
          }
        }
      }

      if (candidate === null || candidate.indexOf("M3_MASK_P34_") !== 0) {
        throw new Error("M3 proof cleanup found a stableId outside the fixed M3 P3/P4 proof namespace: " + stableId);
      }
      if (proofPrefix === null) proofPrefix = candidate;
      else if (proofPrefix !== candidate) throw new Error("M3 proof cleanup found mixed proof fixture generations.");
    }

    if (!target || !background || !foreground || !proofPrefix) {
      throw new Error("M3 proof cleanup could not resolve the complete fixed disposable fixture.");
    }
    if (target.numLayers !== 2) throw new Error("M3 proof cleanup target must contain exactly two proof-owned layers.");

    var seenBackgroundLayer = false;
    var seenForegroundLayer = false;
    var foregroundLayer = null;
    for (i = 1; i <= target.numLayers; i += 1) {
      var layer = target.layer(i);
      var layerId = layerStableId(layer);
      if (layerId === proofPrefix + "_BG_LAYER") seenBackgroundLayer = true;
      else if (layerId === proofPrefix + "_FG_LAYER") {
        seenForegroundLayer = true;
        foregroundLayer = layer;
      } else {
        throw new Error("M3 proof cleanup found a layer outside the fixed proof-owned fixture set: " + asString(layerId));
      }
    }
    if (!seenBackgroundLayer || !seenForegroundLayer || !foregroundLayer) {
      throw new Error("M3 proof cleanup could not resolve both fixed proof-owned layers.");
    }

    var masks = foregroundLayer.property("ADBE Mask Parade");
    if (!masks || masks.numProperties !== 1) throw new Error("M3 proof cleanup requires exactly one proof-owned foreground mask.");
    if (maskStableId(masks.property(1)) !== proofPrefix + "_MASK") {
      throw new Error("M3 proof cleanup foreground mask is not the fixed proof-owned mask.");
    }

    if (!job.jobId) throw new Error("M3 proof cleanup requires the completed render job identity.");
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
    if (closed === false) throw new Error("M3 proof cleanup could not close the disposable project without saving.");
    app.newProject();
    if (!app.project || app.project.file || app.project.numItems !== 0) {
      throw new Error("M3 proof cleanup did not produce the required fresh blank unsaved project.");
    }

    job.proofCleanupCompleted = true;
    $.global.EditFlow2_lastProofCleanup = {
      proofId: "M3_MASK_P3_P4_REAL_AE",
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
