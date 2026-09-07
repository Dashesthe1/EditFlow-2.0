/* EditFlow 2.0 M3 null-rig P3/P4 proof-only disposable-project cleanup.
 *
 * Loaded only for the isolated runner-owned AE process when
 * EDITFLOW_M3_NULL_RIG_P4_PROOF=1. It adds no public protocol command.
 * After the exact post-rollback recovery render reaches DONE, this layer verifies
 * the unsaved project is exactly one null-rig proof fixture generation: one
 * imported source, one target comp, one managed-null backing source, an optional
 * EditFlow-marked support folder, and exactly the visible child + managed null
 * layers. The child must be detached and the null must retain exact managed-source
 * ownership. Only then may the disposable project be discarded without saving.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_NULL_RIG_P4_PROOF";
  var RECOVERY_REQUEST_NAME = "p4-post-rollback.avi";
  var ITEM_PREFIX = "[[EDITFLOW2_STABLE:";
  var NULL_SOURCE_PREFIX = "[[EDITFLOW2_NULL_SOURCE:";
  var SUPPORT_FOLDER_MARKER = "[[EDITFLOW2_NULL_SUPPORT_FOLDER]]";
  var MARKER_SUFFIX = "]]";
  var innerReconcile = $.global.EditFlow2_reconcileAsyncRender;

  if ($.getenv(PROOF_ENV) !== "1") return;
  if (typeof innerReconcile !== "function") {
    throw new Error("EditFlow M3 null-rig proof cleanup requires async-render reconciliation.");
  }

  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function markerValue(text, prefix) {
    var source = asString(text);
    var start = source.indexOf(prefix);
    if (start < 0) return null;
    start += prefix.length;
    var end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }
  function itemStableId(item) { try { return markerValue(item.comment, ITEM_PREFIX); } catch (_) { return null; } }
  function nullSourceStableId(item) { try { return markerValue(item.comment, NULL_SOURCE_PREFIX); } catch (_) { return null; } }
  function layerStableId(layer) { try { return markerValue(layer.comment, ITEM_PREFIX); } catch (_) { return null; } }
  function prefixForSuffix(stableId, suffix) {
    var value = asString(stableId);
    if (value.length <= suffix.length || value.substring(value.length - suffix.length) !== suffix) return null;
    return value.substring(0, value.length - suffix.length);
  }
  function assertRecoveryJob(job) {
    if (!job || !job.requestedOutputPath) return false;
    return asString((new File(job.requestedOutputPath)).name).toLowerCase() === RECOVERY_REQUEST_NAME;
  }
  function isManagedNullSource(item) {
    try { return item instanceof FootageItem && item.mainSource instanceof SolidSource; } catch (_) { return false; }
  }

  function assertDisposableProofProject(job) {
    if (!app.project) throw new Error("M3 null-rig proof cleanup requires an open project.");
    if (app.project.file) throw new Error("M3 null-rig proof cleanup refuses to discard a saved project.");

    var target = null;
    var sourceMedia = null;
    var nullSource = null;
    var supportFolder = null;
    var proofPrefix = null;
    var i;

    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      var stableId = itemStableId(item);
      var nullStable = nullSourceStableId(item);
      var candidate = null;

      if (stableId) {
        candidate = prefixForSuffix(stableId, "_TARGET_COMP");
        if (candidate !== null) {
          if (!(item instanceof CompItem) || target !== null) throw new Error("M3 null-rig proof cleanup found an invalid target composition.");
          target = item;
        } else {
          candidate = prefixForSuffix(stableId, "_SOURCE_MEDIA");
          if (candidate === null || sourceMedia !== null) throw new Error("M3 null-rig proof cleanup found an unexpected stable project item: " + stableId);
          sourceMedia = item;
        }
      } else if (nullStable) {
        candidate = prefixForSuffix(nullStable, "_RIG_MAIN");
        if (candidate === null || nullSource !== null || !isManagedNullSource(item)) {
          throw new Error("M3 null-rig proof cleanup found an invalid managed-null backing source: " + asString(nullStable));
        }
        nullSource = item;
      } else {
        var isSupport = false;
        try { isSupport = item instanceof FolderItem && asString(item.comment) === SUPPORT_FOLDER_MARKER; } catch (_) { isSupport = false; }
        if (!isSupport || supportFolder !== null) {
          throw new Error("M3 null-rig proof cleanup found an item outside the fixed proof-owned fixture set.");
        }
        supportFolder = item;
        continue;
      }

      if (candidate === null || candidate.indexOf("M3_NULL_RIG_P34_") !== 0) {
        throw new Error("M3 null-rig proof cleanup found an item outside the fixed P3/P4 namespace.");
      }
      if (proofPrefix === null) proofPrefix = candidate;
      else if (proofPrefix !== candidate) throw new Error("M3 null-rig proof cleanup found mixed fixture generations.");
    }

    if (!target || !sourceMedia || !nullSource || !proofPrefix) {
      throw new Error("M3 null-rig proof cleanup could not resolve the complete disposable fixture.");
    }
    if (supportFolder && supportFolder.numItems !== 1) {
      throw new Error("M3 null-rig proof cleanup support folder must contain only the managed null source.");
    }
    try {
      if (nullSource.parentFolder && supportFolder && nullSource.parentFolder !== supportFolder) {
        throw new Error("Managed null source is not inside the marked support folder.");
      }
    } catch (folderError) {
      throw new Error("M3 null-rig proof cleanup could not verify support-folder ownership: " + asString(folderError));
    }

    if (target.numLayers !== 2) throw new Error("M3 null-rig proof cleanup target must contain exactly child + managed null layers.");
    var childLayer = null;
    var rigLayer = null;
    for (i = 1; i <= target.numLayers; i += 1) {
      var layer = target.layer(i);
      var layerId = layerStableId(layer);
      if (layerId === proofPrefix + "_CHILD_LAYER") childLayer = layer;
      else if (layerId === proofPrefix + "_RIG_MAIN") rigLayer = layer;
      else throw new Error("M3 null-rig proof cleanup found an unexpected target layer: " + asString(layerId));
    }
    if (!childLayer || !rigLayer) throw new Error("M3 null-rig proof cleanup could not resolve child and rig layers.");

    try {
      if (childLayer.source !== sourceMedia) throw new Error("Visible child source identity does not match fixture source media.");
      if (rigLayer.nullLayer !== true) throw new Error("Managed rig layer is no longer a true After Effects null.");
      if (rigLayer.source !== nullSource) throw new Error("Managed rig backing-source identity drifted.");
      if (childLayer.parent !== null) throw new Error("P4-restored visible child must be detached before cleanup.");
    } catch (identityError) {
      throw new Error("M3 null-rig proof cleanup fixture identity check failed: " + asString(identityError));
    }

    if (!job.jobId) throw new Error("M3 null-rig proof cleanup requires completed render job identity.");
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
    if (closed === false) throw new Error("M3 null-rig proof cleanup could not close the disposable project without saving.");
    app.newProject();
    if (!app.project || app.project.file || app.project.numItems !== 0) {
      throw new Error("M3 null-rig proof cleanup did not produce the required fresh blank unsaved project.");
    }

    job.proofCleanupCompleted = true;
    $.global.EditFlow2_lastProofCleanup = {
      proofId: "M3_NULL_RIG_P3_P4_REAL_AE",
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
