/* EditFlow 2.0 M3 spatial-graph P3/P4 proof-only disposable-project cleanup.
 *
 * Loaded only for the isolated runner-owned AE process when
 * EDITFLOW_M3_SPATIAL_GRAPH_P4_PROOF=1. It adds no public protocol command.
 * After the exact post-rollback recovery render reaches DONE, this wrapper
 * verifies the unsaved project contains exactly one spatial-graph proof fixture
 * in its restored straight-baseline state. Only then may it discard the
 * disposable project without saving and create a fresh blank project.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_SPATIAL_GRAPH_P4_PROOF";
  var RECOVERY_REQUEST_NAME = "p4-post-rollback-straight-baseline.avi";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var innerReconcile = $.global.EditFlow2_reconcileAsyncRender;

  if ($.getenv(PROOF_ENV) !== "1") return;
  if (typeof innerReconcile !== "function") {
    throw new Error("EditFlow M3 spatial-graph proof cleanup requires async-render reconciliation.");
  }

  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function closeNumber(a, b) { return Math.abs(a - b) <= 0.000001; }
  function zeroVector(value) {
    if (!value || value.length !== 3) return false;
    return closeNumber(value[0], 0) && closeNumber(value[1], 0) && closeNumber(value[2], 0);
  }
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
  function assertPositionBaseline(layer) {
    if (!layer) throw new Error("M3 spatial-graph proof cleanup could not resolve foreground layer.");
    var property = layer.property("ADBE Transform Group").property("ADBE Position");
    if (!property || property.numKeys !== 3) throw new Error("M3 spatial-graph proof cleanup requires exactly three Position keys.");
    var expectedTimes = [0, 0.5, 1];
    var expectedValues = [[96, 180], [320, 180], [544, 180]];
    var i;
    for (i = 1; i <= 3; i += 1) {
      if (!closeNumber(property.keyTime(i), expectedTimes[i - 1])) throw new Error("M3 spatial-graph proof cleanup found unexpected Position key time.");
      var value = property.keyValue(i);
      if (!value || value.length < 2 || !closeNumber(value[0], expectedValues[i - 1][0]) || !closeNumber(value[1], expectedValues[i - 1][1])) {
        throw new Error("M3 spatial-graph proof cleanup found unexpected Position key value.");
      }
      if (!zeroVector(property.keyInSpatialTangent(i)) || !zeroVector(property.keyOutSpatialTangent(i))) {
        throw new Error("M3 spatial-graph proof cleanup requires restored zero spatial tangents on all keys.");
      }
      if (property.keySpatialContinuous(i) === true || property.keySpatialAutoBezier(i) === true || property.keyRoving(i) === true) {
        throw new Error("M3 spatial-graph proof cleanup requires restored manual non-continuous non-roving baseline state.");
      }
    }
  }

  function assertDisposableProofProject(job) {
    if (!app.project) throw new Error("M3 spatial-graph proof cleanup requires an open project.");
    if (app.project.file) throw new Error("M3 spatial-graph proof cleanup refuses to discard a saved project.");
    if (app.project.numItems !== 3) {
      throw new Error("M3 spatial-graph proof cleanup requires exactly three proof-owned project items; found " + app.project.numItems + ".");
    }

    var target = null;
    var backgroundSource = null;
    var foregroundSource = null;
    var proofPrefix = null;
    var i;
    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      var stableId = itemStableId(item);
      if (!stableId) throw new Error("M3 spatial-graph proof cleanup found a project item without a proof stableId.");
      var candidate = prefixForSuffix(stableId, "_TARGET_COMP");
      if (candidate !== null) {
        if (!(item instanceof CompItem) || target !== null) throw new Error("M3 spatial-graph proof cleanup found an invalid target comp.");
        target = item;
      } else {
        candidate = prefixForSuffix(stableId, "_BACKGROUND_SOURCE");
        if (candidate !== null) {
          if (!(item instanceof FootageItem) || backgroundSource !== null) throw new Error("M3 spatial-graph proof cleanup found an invalid background source.");
          backgroundSource = item;
        } else {
          candidate = prefixForSuffix(stableId, "_FOREGROUND_SOURCE");
          if (candidate === null || !(item instanceof FootageItem) || foregroundSource !== null) {
            throw new Error("M3 spatial-graph proof cleanup found an invalid proof item: " + stableId);
          }
          foregroundSource = item;
        }
      }
      if (candidate === null || candidate.indexOf("M3_SPATIAL_GRAPH_P34_") !== 0) {
        throw new Error("M3 spatial-graph proof cleanup found an item outside the fixed P3/P4 proof namespace: " + stableId);
      }
      if (proofPrefix === null) proofPrefix = candidate;
      else if (proofPrefix !== candidate) throw new Error("M3 spatial-graph proof cleanup found mixed proof fixture generations.");
    }

    if (!target || !backgroundSource || !foregroundSource || !proofPrefix) throw new Error("M3 spatial-graph proof cleanup could not resolve the complete fixture.");
    if (target.numLayers !== 2) throw new Error("M3 spatial-graph proof cleanup target must contain exactly two proof-owned layers.");
    var foregroundLayer = null;
    var backgroundLayer = null;
    for (i = 1; i <= target.numLayers; i += 1) {
      var layer = target.layer(i);
      var layerStable = layerStableId(layer);
      if (layerStable === proofPrefix + "_FOREGROUND_LAYER") foregroundLayer = layer;
      else if (layerStable === proofPrefix + "_BACKGROUND_LAYER") backgroundLayer = layer;
      else throw new Error("M3 spatial-graph proof cleanup found a foreign target layer: " + layerStable);
    }
    if (!foregroundLayer || !backgroundLayer) throw new Error("M3 spatial-graph proof cleanup could not resolve both proof layers.");
    if (foregroundLayer.source !== foregroundSource || backgroundLayer.source !== backgroundSource) throw new Error("M3 spatial-graph proof cleanup layer source identity mismatch.");
    assertPositionBaseline(foregroundLayer);
    if (!job.jobId) throw new Error("M3 spatial-graph proof cleanup requires completed render job identity.");
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
    if (closed === false) throw new Error("M3 spatial-graph proof cleanup could not close the disposable project without saving.");
    app.newProject();
    if (!app.project || app.project.file || app.project.numItems !== 0) {
      throw new Error("M3 spatial-graph proof cleanup did not produce the required fresh blank unsaved project.");
    }

    job.proofCleanupCompleted = true;
    $.global.EditFlow2_lastProofCleanup = {
      proofId: "M3_SPATIAL_GRAPH_P3_P4_REAL_AE",
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
