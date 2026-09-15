/* EditFlow M5 protocol 2.6: read-only Roto Brush / Refine Edge structural session discovery. */
(function () {
  "use strict";
  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("M5 Roto Brush readback requires the existing dispatcher.");

  var PROTOCOL = "2.6.0";
  var BUILD = "0.6.0-dev.2";
  var CAPABILITY = "ae.roto_brush.session.inspect";
  var COMMAND = "roto_brush.readback";
  var ROTO_MATCH = "ADBE Samurai";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var MAX_DEPTH = 5;
  var MAX_NODES = 512;

  function nowMs() { return (new Date()).getTime(); }
  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function fail(category, code, message, details) { var error = new Error(message); error.editflowCategory = category; error.editflowCode = code; error.editflowDetails = details === undefined ? null : details; throw error; }
  function reject(code, message, details) { fail("VALIDATION", code, message, details); }
  function markerValue(text, prefix) { var source = asString(text), start = source.indexOf(prefix), end; if (start < 0) return null; start += prefix.length; end = source.indexOf(MARKER_SUFFIX, start); return end < 0 ? null : source.substring(start, end); }
  function stableIdFromText(text) { return markerValue(text, STABLE_PREFIX); }
  function itemStableId(item) { try { return stableIdFromText(item.comment); } catch (_) { return null; } }
  function layerStableId(layer) { try { return stableIdFromText(layer.comment); } catch (_) { return null; } }
  function hostIdOf(object) { try { return typeof object.id === "number" ? object.id : null; } catch (_) { return null; } }
  function findItem(ref) {
    if (!ref || typeof ref !== "object") reject("OBJECT_REF_REQUIRED", "Object reference is required.");
    var project = app.project, i, item;
    if (typeof ref.hostId === "number" && project.itemByID) { try { item = project.itemByID(ref.hostId); if (item) return item; } catch (_) {} }
    for (i = 1; i <= project.numItems; i += 1) { item = project.item(i); if (ref.stableId && itemStableId(item) === ref.stableId) return item; try { if (typeof ref.hostId === "number" && item.id === ref.hostId) return item; } catch (_) {} }
    return null;
  }
  function findComp(ref) { var item = findItem(ref); if (!item || !(item instanceof CompItem)) reject("COMP_NOT_FOUND", "Composition reference did not resolve."); return item; }
  function findLayer(comp, ref) {
    if (!ref || typeof ref !== "object") reject("LAYER_REF_REQUIRED", "Layer reference is required.");
    var i, layer;
    if (typeof ref.hostId === "number" && app.project.layerByID) { try { layer = app.project.layerByID(ref.hostId); if (layer && layer.containingComp === comp) return layer; } catch (_) {} }
    for (i = 1; i <= comp.numLayers; i += 1) { layer = comp.layer(i); if (ref.stableId && layerStableId(layer) === ref.stableId) return layer; try { if (typeof ref.hostId === "number" && layer.id === ref.hostId) return layer; } catch (_) {} }
    reject("LAYER_NOT_FOUND", "Layer reference did not resolve in the target composition.");
  }
  function finiteNumber(value) { var number = Number(value); return isFinite(number) ? number : null; }
  function safeValue(property) {
    var value, out, i, primitive;
    try { value = property.value; } catch (_) { return null; }
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return finiteNumber(value);
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value.length === "number" && value.length >= 0 && value.length <= 16) {
      out = [];
      for (i = 0; i < value.length; i += 1) {
        primitive = value[i];
        if (typeof primitive === "number") primitive = finiteNumber(primitive);
        else if (typeof primitive !== "string" && typeof primitive !== "boolean") return null;
        if (primitive === null) return null;
        out.push(primitive);
      }
      return out;
    }
    return null;
  }
  function enumNumber(value) { var number; try { number = Number(value); } catch (_) { return null; } return isFinite(number) ? number : null; }
  function propertyNode(property, index, depth, state) {
    var node = { index: index, name: "", matchName: "", propertyType: null, propertyValueType: null, numProperties: 0, numKeys: 0, canSetExpression: false, expressionEnabled: null, value: null, children: [] }, i, child;
    state.count += 1;
    try { node.name = asString(property.name); } catch (_) {}
    try { node.matchName = asString(property.matchName); } catch (_) {}
    try { node.propertyType = enumNumber(property.propertyType); } catch (_) {}
    try { node.propertyValueType = enumNumber(property.propertyValueType); } catch (_) {}
    try { node.numProperties = Number(property.numProperties) || 0; } catch (_) {}
    try { node.numKeys = Number(property.numKeys) || 0; } catch (_) {}
    try { node.canSetExpression = property.canSetExpression === true; } catch (_) {}
    if (node.canSetExpression) { try { node.expressionEnabled = property.expressionEnabled === true; } catch (_) { node.expressionEnabled = null; } }
    if (node.numProperties === 0) node.value = safeValue(property);
    if (node.numProperties > 0) {
      if (depth >= MAX_DEPTH) state.truncated = true;
      else {
        for (i = 1; i <= node.numProperties; i += 1) {
          if (state.count >= MAX_NODES) { state.truncated = true; break; }
          try { child = property.property(i); } catch (_) { child = null; }
          if (child) node.children.push(propertyNode(child, i, depth + 1, state));
        }
      }
    }
    return node;
  }
  function findRotoEffects(layer) {
    var effects = null, matches = [], i, effect;
    try { effects = layer.property("ADBE Effect Parade"); } catch (_) { effects = null; }
    if (!effects) return matches;
    for (i = 1; i <= effects.numProperties; i += 1) { effect = effects.property(i); if (effect && effect.matchName === ROTO_MATCH) matches.push(effect); }
    return matches;
  }
  function chooseEffect(matches, requestedIndex) {
    var i, effect;
    if (requestedIndex !== null && requestedIndex !== undefined) {
      if (typeof requestedIndex !== "number" || !isFinite(requestedIndex) || Math.floor(requestedIndex) !== requestedIndex || requestedIndex <= 0) reject("INVALID_EFFECT_INDEX", "effectIndex must be a positive integer when supplied.");
      for (i = 0; i < matches.length; i += 1) { effect = matches[i]; if (effect.propertyIndex === requestedIndex) return effect; }
      reject("ROTO_BRUSH_EFFECT_NOT_FOUND", "Requested effectIndex is not an ADBE Samurai Roto Brush effect.");
    }
    if (matches.length === 0) return null;
    if (matches.length !== 1) reject("AMBIGUOUS_ROTO_BRUSH_EFFECT", "Multiple Roto Brush effects exist; explicit effectIndex is required.");
    return matches[0];
  }
  function readback(comp, layer, requestedIndex) {
    var matches = findRotoEffects(layer), effect = chooseEffect(matches, requestedIndex), state = { count: 0, truncated: false }, properties = [], i, child, enabled = true, effectReadback = null;
    if (effect) {
      try { enabled = effect.enabled !== false; } catch (_) { enabled = true; }
      for (i = 1; i <= effect.numProperties; i += 1) {
        if (state.count >= MAX_NODES) { state.truncated = true; break; }
        try { child = effect.property(i); } catch (_) { child = null; }
        if (child) properties.push(propertyNode(child, i, 1, state));
      }
      effectReadback = { effectIndex: effect.propertyIndex || 1, name: asString(effect.name), matchName: ROTO_MATCH, enabled: enabled, numProperties: Number(effect.numProperties) || 0, properties: properties };
    }
    return {
      comp: { stableId: itemStableId(comp), hostId: hostIdOf(comp), name: comp.name, width: comp.width, height: comp.height, duration: comp.duration, frameRate: comp.frameRate, frameDuration: comp.frameDuration, time: comp.time },
      layer: { stableId: layerStableId(layer), hostId: hostIdOf(layer), name: layer.name, index: layer.index, time: layer.time },
      rotoBrushMatchName: ROTO_MATCH,
      effectMatchCount: matches.length,
      effect: effectReadback,
      propertyNodeCount: state.count,
      propertyTreeTruncated: state.truncated
    };
  }
  function response(request, outcome, error, readbackValue, started, notes) { return $.global.EditFlow2_JSON.stringify({ protocolVersion: PROTOCOL, requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId, capabilityId: request.capabilityId, command: request.command, outcome: outcome, error: error, affectedObjects: [], readback: readbackValue || null, hostProjectRevision: app.project ? app.project.revision : null, diagnostics: { adapterProtocolVersion: PROTOCOL, adapterBuild: BUILD, command: request.command, durationMs: nowMs() - started, notes: notes || [] } }); }
  function errorPayload(error) { return { category: error.editflowCategory || "HOST_FAILURE", code: error.editflowCode || "ROTO_BRUSH_HOST_FAILURE", message: asString(error.message || error), details: error.editflowDetails === undefined ? null : error.editflowDetails }; }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) { return previousDispatch(requestJson); }
    if (!request || request.protocolVersion !== PROTOCOL || request.command !== COMMAND) return previousDispatch(requestJson);
    var started = nowMs(), payload = request.payload || {}, comp, layer;
    try {
      if (request.capabilityId !== CAPABILITY) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match roto_brush.readback.");
      comp = findComp(payload.comp); layer = findLayer(comp, payload.layer);
      return response(request, "NO_OP", null, readback(comp, layer, payload.effectIndex), started, ["Read-only bounded Roto Brush / Refine Edge property-tree discovery.", "Protocol 2.6 does not draw strokes, propagate, freeze, refine, export, or mutate host state."]);
    } catch (error) {
      return response(request, error.editflowCategory === "VALIDATION" ? "REJECTED" : "FAILED", errorPayload(error), null, started, ["Roto Brush readback failed closed without host mutation."]);
    }
  };
  $.global.EditFlow2_HOST_PROTOCOL_26 = true;
}());