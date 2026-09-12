/* EditFlow 2.0 M4 Detailed Face Tracking readback host layer.
 * Protocol 2.2 is read-only: it never creates masks/effects or starts analysis.
 */
(function () {
  "use strict";
  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("M4 face tracking requires the existing dispatcher.");

  var PROTOCOL = "2.2.0";
  var BUILD = "0.5.0-dev.1";
  var CAPABILITY = "ae.face.readback";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MASK_PREFIX = "[[EDITFLOW2_MASK:";
  var MARKER_SUFFIX = "]]";
  var FACE_EFFECT_NAME = "Face Track Points";
  var FACE_EFFECT_MATCH = "Pseudo/ADBE Animal Head66";

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
  function itemStableId(item) { try { return markerValue(item.comment, STABLE_PREFIX); } catch (_) { return null; } }
  function layerStableId(layer) { try { return markerValue(layer.comment, STABLE_PREFIX); } catch (_) { return null; } }
  function maskStableId(mask) { try { return markerValue(mask.name, MASK_PREFIX); } catch (_) { return null; } }
  function cleanMaskName(mask) {
    var source = asString(mask.name), start = source.indexOf(MASK_PREFIX);
    return start < 0 ? source : source.substring(0, start).replace(/\s+$/, "");
  }
  function hostIdOf(object) { try { return typeof object.id === "number" ? object.id : null; } catch (_) { return null; } }
  function findItem(ref) {
    if (!ref || typeof ref !== "object") reject("OBJECT_REF_REQUIRED", "Object reference is required.");
    var project = app.project, i, item;
    if (!project) reject("PROJECT_REQUIRED", "An open project is required.");
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
  function findMask(layer, ref) {
    if (!ref || typeof ref.stableId !== "string" || !ref.stableId) reject("MASK_REF_REQUIRED", "mask.stableId is required.");
    var masks = null, i, mask;
    try { masks = layer.property("ADBE Mask Parade"); } catch (_) { masks = null; }
    if (!masks) reject("MASKS_UNAVAILABLE", "Layer does not expose masks.");
    for (i = 1; i <= masks.numProperties; i += 1) {
      mask = masks.property(i);
      if (maskStableId(mask) === ref.stableId) return mask;
    }
    reject("MASK_NOT_FOUND", "Face tracking mask stableId did not resolve.");
  }
  function numericValue(value) {
    var i, result;
    if (typeof value === "number" && isFinite(value)) return Number(value);
    if (!value || typeof value.length !== "number" || typeof value === "string") return null;
    result = [];
    for (i = 0; i < value.length; i += 1) {
      if (typeof value[i] !== "number" || !isFinite(value[i])) return null;
      result.push(Number(value[i]));
    }
    return result;
  }
  function valueDimensions(value) { return value && typeof value.length === "number" && typeof value !== "string" ? value.length : 1; }
  function readFaceEffect(layer) {
    var effects = null, effect = null, i, candidate, p, j, value, samples, props = [], keyed = 0, maxKeys = 0;
    try { effects = layer.property("ADBE Effect Parade"); } catch (_) { effects = null; }
    if (!effects) return null;
    for (i = 1; i <= effects.numProperties; i += 1) {
      candidate = effects.property(i);
      if (candidate && candidate.name === FACE_EFFECT_NAME && candidate.matchName === FACE_EFFECT_MATCH) { effect = candidate; break; }
    }
    if (!effect) return null;
    for (i = 1; i <= effect.numProperties; i += 1) {
      p = effect.property(i);
      if (!p || typeof p.numKeys !== "number") continue;
      samples = [];
      for (j = 1; j <= p.numKeys; j += 1) {
        try { value = numericValue(p.keyValue(j)); } catch (_) { value = null; }
        if (value !== null) samples.push({ time: p.keyTime(j), value: value });
      }
      if (samples.length > 0) {
        keyed += 1; if (samples.length > maxKeys) maxKeys = samples.length;
        props.push({
          propertyIndex: i,
          name: p.name,
          matchName: p.matchName,
          valueDimensions: valueDimensions(samples[0].value),
          keyedSampleCount: samples.length,
          samples: samples
        });
      }
    }
    return { effectIndex: effect.propertyIndex || 1, name: FACE_EFFECT_NAME, matchName: FACE_EFFECT_MATCH, keyedPropertyCount: keyed, maxKeyCount: maxKeys, properties: props };
  }
  function readback(comp, layer, mask) {
    var path = null, count = 0, last = null, i;
    try { path = mask.property("ADBE Mask Shape"); } catch (_) { path = null; }
    if (path) {
      count = path.numKeys;
      for (i = 1; i <= count; i += 1) last = last === null ? path.keyTime(i) : Math.max(last, path.keyTime(i));
    }
    return {
      comp: { stableId: itemStableId(comp), hostId: hostIdOf(comp), name: comp.name, width: comp.width, height: comp.height },
      layer: { stableId: layerStableId(layer), hostId: hostIdOf(layer), name: layer.name, index: layer.index },
      mask: { stableId: maskStableId(mask), name: cleanMaskName(mask), pathKeyCount: count, lastPathKeyTime: last },
      faceTrackPoints: readFaceEffect(layer)
    };
  }
  function response(request, outcome, error, value, started, notes) {
    return $.global.EditFlow2_JSON.stringify({
      protocolVersion: PROTOCOL, requestId: request.requestId, transactionId: request.transactionId,
      operationId: request.operationId, capabilityId: request.capabilityId, command: request.command,
      outcome: outcome, error: error, affectedObjects: [], readback: value || null,
      hostProjectRevision: app.project ? app.project.revision : null,
      diagnostics: { adapterProtocolVersion: PROTOCOL, adapterBuild: BUILD, command: request.command, durationMs: nowMs() - started, notes: notes || [] }
    });
  }
  function errorPayload(error) {
    return { category: error.editflowCategory || "HOST_FAILURE", code: error.editflowCode || "FACE_TRACKING_HOST_FAILURE", message: asString(error.message || error), details: error.editflowDetails === undefined ? null : error.editflowDetails };
  }
  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) { return previousDispatch(requestJson); }
    if (!request || request.protocolVersion !== PROTOCOL || request.command !== "face.readback") return previousDispatch(requestJson);
    var started = nowMs(), payload = request.payload || {}, comp, layer, mask;
    try {
      if (request.capabilityId !== CAPABILITY) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match face.readback.");
      comp = findComp(payload.comp); layer = findLayer(comp, payload.layer); mask = findMask(layer, payload.mask);
      return response(request, "NO_OP", null, readback(comp, layer, mask), started, [
        "Read-only Detailed Face Tracking structural/keyframe readback.",
        "Protocol 2.2 does not create Face Track Points or initiate image analysis."
      ]);
    } catch (error) {
      return response(request, error.editflowCategory === "VALIDATION" ? "REJECTED" : "FAILED", errorPayload(error), null, started, ["Face tracking readback failed closed without host mutation."]);
    }
  };

  $.global.EditFlow2_HOST_PROTOCOL_22 = true;
}());
