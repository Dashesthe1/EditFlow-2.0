/* EditFlow 2.0 M4 point-tracking readback host layer.
 * Protocol 2.1 is read-only: it never creates trackers or starts analysis.
 */
(function () {
  "use strict";
  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("M4 point tracking requires the existing dispatcher.");

  var PROTOCOL = "2.1.0";
  var BUILD = "0.5.0-dev.1";
  var CAPABILITY = "ae.tracker.readback";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";

  function nowMs() { return (new Date()).getTime(); }
  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function fail(category, code, message, details) {
    var error = new Error(message);
    error.editflowCategory = category; error.editflowCode = code; error.editflowDetails = details === undefined ? null : details;
    throw error;
  }
  function reject(code, message, details) { fail("VALIDATION", code, message, details); }
  function markerValue(text, prefix) {
    var source = asString(text), start = source.indexOf(prefix), end;
    if (start < 0) return null;
    start += prefix.length; end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }
  function stableIdFromText(text) { return markerValue(text, STABLE_PREFIX); }
  function itemStableId(item) { try { return stableIdFromText(item.comment); } catch (_) { return null; } }
  function layerStableId(layer) { try { return stableIdFromText(layer.comment); } catch (_) { return null; } }
  function hostIdOf(object) { try { return typeof object.id === "number" ? object.id : null; } catch (_) { return null; } }
  function findItem(ref) {
    if (!ref || typeof ref !== "object") reject("OBJECT_REF_REQUIRED", "Object reference is required.");
    var project = app.project, i, item;
    if (typeof ref.hostId === "number" && project.itemByID) {
      try { item = project.itemByID(ref.hostId); if (item) return item; } catch (_) {}
    }
    for (i = 1; i <= project.numItems; i += 1) {
      item = project.item(i);
      if (ref.stableId && itemStableId(item) === ref.stableId) return item;
      try { if (typeof ref.hostId === "number" && item.id === ref.hostId) return item; } catch (_) {}
    }
    return null;
  }
  function findComp(ref) {
    var item = findItem(ref);
    if (!item || !(item instanceof CompItem)) reject("COMP_NOT_FOUND", "Composition reference did not resolve.");
    return item;
  }
  function findLayer(comp, ref) {
    if (!ref || typeof ref !== "object") reject("LAYER_REF_REQUIRED", "Layer reference is required.");
    var i, layer;
    if (typeof ref.hostId === "number" && app.project.layerByID) {
      try { layer = app.project.layerByID(ref.hostId); if (layer && layer.containingComp === comp) return layer; } catch (_) {}
    }
    for (i = 1; i <= comp.numLayers; i += 1) {
      layer = comp.layer(i);
      if (ref.stableId && layerStableId(layer) === ref.stableId) return layer;
      try { if (typeof ref.hostId === "number" && layer.id === ref.hostId) return layer; } catch (_) {}
    }
    reject("LAYER_NOT_FOUND", "Layer reference did not resolve in the target composition.");
  }

  function vector(value) {
    if (!value || typeof value.length !== "number" || value.length < 2) return [];
    return [Number(value[0]), Number(value[1])];
  }
  function propertyValue(property, time) {
    if (!property) return null;
    try { return property.valueAtTime(time, false); } catch (_) {
      try { return property.value; } catch (_) { return null; }
    }
  }
  function addKeyTimes(property, times) {
    if (!property) return;
    var i, time, j, exists;
    for (i = 1; i <= property.numKeys; i += 1) {
      time = property.keyTime(i); exists = false;
      for (j = 0; j < times.length; j += 1) if (Math.abs(times[j] - time) < 0.000001) { exists = true; break; }
      if (!exists) times.push(time);
    }
  }
  function child(point, matchName) { try { return point.property(matchName); } catch (_) { return null; } }
  function readPoint(comp, layer, point, pointIndex) {
    var center = child(point, "ADBE MTracker Pt Feature Center");
    var featureSize = child(point, "ADBE MTracker Pt Feature Size");
    var searchOffset = child(point, "ADBE MTracker Pt Search Ofst");
    var searchSize = child(point, "ADBE MTracker Pt Search Size");
    var confidence = child(point, "ADBE MTracker Pt Confidence");
    var attach = child(point, "ADBE MTracker Pt Attach Pt");
    var attachOffset = child(point, "ADBE MTracker Pt Attach Pt Ofst");
    var times = [], samples = [], oldTime = comp.time, i, time, attachValue, compPoint, normalized, conf;
    addKeyTimes(center, times); addKeyTimes(attach, times); addKeyTimes(confidence, times);
    times.sort(function (a, b) { return a - b; });
    var keyedSampleCount = times.length;
    if (times.length === 0) times.push(comp.time);
    try {
      for (i = 0; i < times.length; i += 1) {
        time = times[i]; attachValue = vector(propertyValue(attach, time)); compPoint = null; normalized = null;
        if (attachValue.length >= 2 && layer instanceof AVLayer && typeof layer.sourcePointToComp === "function") {
          try {
            comp.time = time; compPoint = vector(layer.sourcePointToComp(attachValue));
            if (compPoint.length >= 2 && comp.width > 0 && comp.height > 0) normalized = [compPoint[0] / comp.width, compPoint[1] / comp.height];
          } catch (_) { compPoint = null; normalized = null; }
        }
        conf = Number(propertyValue(confidence, time)); if (!isFinite(conf)) conf = 0;
        samples.push({ time: time, featureCenter: vector(propertyValue(center, time)), featureSize: vector(propertyValue(featureSize, time)), searchOffset: vector(propertyValue(searchOffset, time)), searchSize: vector(propertyValue(searchSize, time)), confidence: Math.max(0, Math.min(1, conf / 100)), attachPoint: attachValue, attachPointOffset: vector(propertyValue(attachOffset, time)), compPoint: compPoint, compNormalized: normalized });
      }
    } finally { try { comp.time = oldTime; } catch (_) {} }
    return { pointIndex: pointIndex, name: point.name, matchName: point.matchName, keyedSampleCount: keyedSampleCount, samples: samples };
  }
  function readTrackers(comp, layer) {
    var motion = null, trackers = [], i, tracker, j, point, points;
    try { motion = layer.property("ADBE MTrackers"); } catch (_) { motion = null; }
    if (motion) {
      for (i = 1; i <= motion.numProperties; i += 1) {
        tracker = motion.property(i); if (!tracker || tracker.matchName !== "ADBE MTracker") continue;
        points = [];
        for (j = 1; j <= tracker.numProperties; j += 1) {
          point = tracker.property(j); if (!point || point.matchName !== "ADBE MTracker Pt") continue;
          points.push(readPoint(comp, layer, point, j));
        }
        trackers.push({ trackerIndex: i, name: tracker.name, matchName: tracker.matchName, points: points });
      }
    }
    return {
      comp: { stableId: itemStableId(comp), hostId: hostIdOf(comp), name: comp.name, width: comp.width, height: comp.height },
      layer: { stableId: layerStableId(layer), hostId: hostIdOf(layer), name: layer.name, index: layer.index },
      trackers: trackers
    };
  }

  function response(request, outcome, error, readbackValue, started, notes) {
    return $.global.EditFlow2_JSON.stringify({ protocolVersion: PROTOCOL, requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId, capabilityId: request.capabilityId, command: request.command, outcome: outcome, error: error, affectedObjects: [], readback: readbackValue || null, hostProjectRevision: app.project ? app.project.revision : null, diagnostics: { adapterProtocolVersion: PROTOCOL, adapterBuild: BUILD, command: request.command, durationMs: nowMs() - started, notes: notes || [] } });
  }
  function errorPayload(error) { return { category: error.editflowCategory || "HOST_FAILURE", code: error.editflowCode || "POINT_TRACKING_HOST_FAILURE", message: asString(error.message || error), details: error.editflowDetails === undefined ? null : error.editflowDetails }; }
  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) { return previousDispatch(requestJson); }
    if (!request || request.protocolVersion !== PROTOCOL || request.command !== "tracker.readback") return previousDispatch(requestJson);
    var started = nowMs(), payload = request.payload || {}, comp, layer;
    try {
      if (request.capabilityId !== CAPABILITY) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match tracker.readback.");
      comp = findComp(payload.comp); layer = findLayer(comp, payload.layer);
      return response(request, "NO_OP", null, readTrackers(comp, layer), started, ["Read-only Motion Trackers structural/keyframe readback.", "Protocol 2.1 does not create trackers or initiate image analysis."]);
    } catch (error) {
      return response(request, error.editflowCategory === "VALIDATION" ? "REJECTED" : "FAILED", errorPayload(error), null, started, ["Point-tracking readback failed closed without host mutation."]);
    }
  };

  $.global.EditFlow2_HOST_PROTOCOL_21 = true;
}());
