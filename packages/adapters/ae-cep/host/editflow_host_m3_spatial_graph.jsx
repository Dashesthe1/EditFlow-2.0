/* EditFlow 2.0 M3 spatial Graph Editor host layer.
 * Fixed typed protocol 1.9 commands only. No arbitrary code execution.
 * Covers spatial tangents, continuity, auto-Bezier, roving, readback and rollback.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("EditFlow M3 spatial-graph layer requires the existing dispatcher.");

  var PROTOCOL = "1.9.0";
  var BUILD = "0.4.0-dev.9";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var CAPABILITIES = {
    "property.spatial_graph.set": "ae.property.spatial_graph.set",
    "property.spatial_graph.readback": "ae.property.spatial_graph.readback"
  };

  function nowMs() { return (new Date()).getTime(); }
  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function own(object, key) { return object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key); }
  function finiteNumber(value) { return typeof value === "number" && isFinite(value); }
  function fail(category, code, message, details) {
    var error = new Error(message);
    error.editflowCategory = category;
    error.editflowCode = code;
    error.editflowDetails = details === undefined ? null : details;
    throw error;
  }
  function reject(code, message, details) { fail("VALIDATION", code, message, details); }
  function conflict(code, message, details) { fail("CONFLICT", code, message, details); }

  function markerValue(text, prefix) {
    var source = asString(text), start = source.indexOf(prefix), end;
    if (start < 0) return null;
    start += prefix.length;
    end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }
  function stableIdFromText(text) { return markerValue(text, STABLE_PREFIX); }
  function layerStableId(layer) { try { return stableIdFromText(layer.comment); } catch (_) { return null; } }
  function hostIdOf(layer) { try { return typeof layer.id === "number" ? layer.id : null; } catch (_) { return null; } }

  function findItem(ref) {
    if (!ref || typeof ref !== "object") reject("OBJECT_REF_REQUIRED", "Object reference is required.");
    var project = app.project, i, item;
    if (typeof ref.hostId === "number" && project.itemByID) {
      try { item = project.itemByID(ref.hostId); if (item) return item; } catch (_) {}
    }
    for (i = 1; i <= project.numItems; i += 1) {
      item = project.item(i);
      if (ref.stableId && stableIdFromText(item.comment) === ref.stableId) return item;
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
  function validatePropertyPath(path) {
    if (!(path instanceof Array) || path.length === 0) reject("PROPERTY_PATH_REQUIRED", "propertyPath must be a non-empty array.");
    var i, segment;
    for (i = 0; i < path.length; i += 1) {
      segment = path[i];
      if (typeof segment === "string") {
        if (!segment.length) reject("PROPERTY_PATH_SEGMENT_INVALID", "String propertyPath segments must not be empty.", { index: i });
      } else if (typeof segment === "number") {
        if (segment !== Math.floor(segment) || segment < 1) reject("PROPERTY_PATH_SEGMENT_INVALID", "Numeric propertyPath segments must be positive integers.", { index: i });
      } else reject("PROPERTY_PATH_SEGMENT_INVALID", "propertyPath segments must be non-empty strings or positive integers.", { index: i });
    }
  }
  function resolveProperty(root, path) {
    validatePropertyPath(path);
    var current = root, i;
    for (i = 0; i < path.length; i += 1) {
      if (!current || typeof current.property !== "function") reject("PROPERTY_PATH_NOT_RESOLVABLE", "propertyPath traversed a non-property group.", { index: i });
      current = current.property(path[i]);
      if (!current) reject("PROPERTY_PATH_NOT_FOUND", "propertyPath segment could not be resolved.", { index: i, segment: path[i] });
    }
    return current;
  }
  function validateKeyIndex(property, keyIndex) {
    if (typeof keyIndex !== "number" || keyIndex !== Math.floor(keyIndex) || keyIndex < 1) reject("KEY_INDEX_INVALID", "keyIndex must be a positive integer.");
    if (typeof property.numKeys !== "number" || keyIndex > property.numKeys) reject("KEY_INDEX_OUT_OF_RANGE", "keyIndex exceeds the current keyframe count.", { keyIndex: keyIndex, numKeys: property.numKeys });
  }
  function spatialDimensions(property) {
    if (property.propertyValueType === PropertyValueType.TwoD_SPATIAL) return 2;
    if (property.propertyValueType === PropertyValueType.ThreeD_SPATIAL) return 3;
    fail("CAPABILITY_PRECONDITION", "SPATIAL_PROPERTY_REQUIRED", "Spatial Graph Editor control requires a TwoD_SPATIAL or ThreeD_SPATIAL property.");
  }
  function requireSpatialSurface(property) {
    spatialDimensions(property);
    if (typeof property.keyInSpatialTangent !== "function"
        || typeof property.keyOutSpatialTangent !== "function"
        || typeof property.keySpatialContinuous !== "function"
        || typeof property.keySpatialAutoBezier !== "function"
        || typeof property.keyRoving !== "function"
        || typeof property.setSpatialTangentsAtKey !== "function"
        || typeof property.setSpatialContinuousAtKey !== "function"
        || typeof property.setSpatialAutoBezierAtKey !== "function"
        || typeof property.setRovingAtKey !== "function") {
      fail("CAPABILITY_UNAVAILABLE", "SPATIAL_GRAPH_UNAVAILABLE", "The resolved property does not expose the required spatial Graph Editor surface.");
    }
  }
  function validateVector(value, name, dimensions) {
    if (!(value instanceof Array) || value.length !== dimensions) reject("SPATIAL_TANGENT_DIMENSION_MISMATCH", name + " must contain exactly " + dimensions + " finite values.", { expected: dimensions, actual: value && value.length });
    var i;
    for (i = 0; i < value.length; i += 1) if (!finiteNumber(value[i])) reject("SPATIAL_TANGENT_VALUE_INVALID", name + " values must be finite numbers.", { index: i, value: value[i] });
  }
  function validateState(property, keyIndex, state) {
    requireSpatialSurface(property);
    if (!state || typeof state !== "object" || state instanceof Array) reject("SPATIAL_GRAPH_STATE_REQUIRED", "state must be an object.");
    var allowed = { inTangent: true, outTangent: true, continuous: true, autoBezier: true, roving: true }, key, count = 0;
    for (key in state) if (own(state, key)) { count += 1; if (!allowed[key]) reject("SPATIAL_GRAPH_STATE_UNKNOWN_FIELD", "Unknown spatial graph field: " + key, { field: key }); }
    if (count !== 5) reject("SPATIAL_GRAPH_STATE_INCOMPLETE", "state must specify exactly inTangent, outTangent, continuous, autoBezier, and roving.");
    var dimensions = spatialDimensions(property);
    validateVector(state.inTangent, "inTangent", dimensions);
    validateVector(state.outTangent, "outTangent", dimensions);
    if (typeof state.continuous !== "boolean" || typeof state.autoBezier !== "boolean" || typeof state.roving !== "boolean") reject("SPATIAL_GRAPH_FLAG_INVALID", "continuous, autoBezier, and roving must be booleans.");
    if (state.roving === true && (keyIndex === 1 || keyIndex === property.numKeys)) reject("ROVING_ENDPOINT_FORBIDDEN", "After Effects cannot enable roving on the first or last keyframe.", { keyIndex: keyIndex, numKeys: property.numKeys });
  }
  function copyVector(value) { var result = [], i; for (i = 0; i < value.length; i += 1) result.push(value[i]); return result; }
  function readState(property, keyIndex) {
    requireSpatialSurface(property);
    return {
      inTangent: copyVector(property.keyInSpatialTangent(keyIndex)),
      outTangent: copyVector(property.keyOutSpatialTangent(keyIndex)),
      continuous: property.keySpatialContinuous(keyIndex) === true,
      autoBezier: property.keySpatialAutoBezier(keyIndex) === true,
      roving: property.keyRoving(keyIndex) === true
    };
  }
  function closeNumber(a, b) { return Math.abs(a - b) <= 0.0000001; }
  function sameVector(a, b) { if (!a || !b || a.length !== b.length) return false; var i; for (i = 0; i < a.length; i += 1) if (!closeNumber(a[i], b[i])) return false; return true; }
  function sameState(a, b) { return sameVector(a.inTangent, b.inTangent) && sameVector(a.outTangent, b.outTangent) && a.continuous === b.continuous && a.autoBezier === b.autoBezier && a.roving === b.roving; }
  function applyState(property, keyIndex, state) {
    property.setSpatialAutoBezierAtKey(keyIndex, false);
    property.setSpatialContinuousAtKey(keyIndex, false);
    property.setSpatialTangentsAtKey(keyIndex, state.inTangent, state.outTangent);
    property.setSpatialContinuousAtKey(keyIndex, state.continuous);
    property.setSpatialAutoBezierAtKey(keyIndex, state.autoBezier);
    property.setRovingAtKey(keyIndex, state.roving);
  }
  function readback(layer, property, path, keyIndex) {
    return { spatialGraph: { layer: { stableId: layerStableId(layer), hostId: hostIdOf(layer), index: layer.index, name: layer.name }, property: { name: asString(property.name), matchName: asString(property.matchName), propertyPath: path, numKeys: property.numKeys, dimensions: spatialDimensions(property) }, keyIndex: keyIndex, keyTime: property.keyTime(keyIndex), state: readState(property, keyIndex) } };
  }
  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") reject("EXPECTED_HOST_REVISION_REQUIRED", "Mutating spatial-graph commands require expectedHostProjectRevision.");
    var actual = app.project ? app.project.revision : null;
    if (actual !== request.expectedHostProjectRevision) conflict("HOST_REVISION_CONFLICT", "Host project revision does not match the expected revision.", { expectedHostProjectRevision: request.expectedHostProjectRevision, actualHostProjectRevision: actual });
  }
  function response(request, outcome, error, affected, readbackValue, started, notes) {
    return $.global.EditFlow2_JSON.stringify({ protocolVersion: PROTOCOL, requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId, capabilityId: request.capabilityId, command: request.command, outcome: outcome, error: error, affectedObjects: affected || [], readback: readbackValue || null, hostProjectRevision: app.project ? app.project.revision : null, diagnostics: { adapterProtocolVersion: PROTOCOL, adapterBuild: BUILD, command: request.command, durationMs: nowMs() - started, notes: notes || [] } });
  }
  function errorPayload(error) { return { category: error.editflowCategory || "HOST_FAILURE", code: error.editflowCode || "SPATIAL_GRAPH_HOST_FAILURE", message: asString(error.message || error), details: error.editflowDetails === undefined ? null : error.editflowDetails }; }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) { return previousDispatch(requestJson); }
    if (!request || request.protocolVersion !== PROTOCOL || !CAPABILITIES[request.command]) return previousDispatch(requestJson);
    var started = nowMs();
    try {
      if (request.capabilityId !== CAPABILITIES[request.command]) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match the spatial-graph command.");
      var payload = request.payload || {}, comp = findComp(payload.comp), layer = findLayer(comp, payload.layer), property = resolveProperty(layer, payload.propertyPath);
      validateKeyIndex(property, payload.keyIndex);
      requireSpatialSurface(property);
      if (request.command === "property.spatial_graph.readback") return response(request, "NO_OP", null, [], readback(layer, property, payload.propertyPath, payload.keyIndex), started, ["Read-only spatial Graph Editor structural readback."]);

      requireExpectedRevision(request);
      validateState(property, payload.keyIndex, payload.state);
      var before = readState(property, payload.keyIndex), applied = false;
      app.beginUndoGroup("EditFlow spatial Graph Editor");
      try {
        if (sameState(before, payload.state)) return response(request, "NO_OP", null, [], readback(layer, property, payload.propertyPath, payload.keyIndex), started, ["Requested spatial Graph Editor state already matched host state."]);
        applyState(property, payload.keyIndex, payload.state);
        applied = true;
        var after = readState(property, payload.keyIndex);
        if (!sameState(after, payload.state)) fail("READBACK", "SPATIAL_GRAPH_READBACK_MISMATCH", "Applied spatial Graph Editor state did not match structural readback.", { expected: payload.state, actual: after });
        return response(request, "APPLIED", null, [{ kind: "LAYER", stableId: layerStableId(layer), hostId: hostIdOf(layer) }], readback(layer, property, payload.propertyPath, payload.keyIndex), started, ["Spatial Graph Editor state applied and verified by structural readback."]);
      } catch (mutationError) {
        if (applied) {
          try { applyState(property, payload.keyIndex, before); } catch (rollbackError) { fail("ROLLBACK", "SPATIAL_GRAPH_ROLLBACK_FAILED", "Spatial Graph Editor mutation failed and rollback also failed.", { mutationError: asString(mutationError), rollbackError: asString(rollbackError) }); }
        }
        throw mutationError;
      } finally { app.endUndoGroup(); }
    } catch (error) {
      var category = error.editflowCategory || "HOST_FAILURE";
      var outcome = category === "VALIDATION" || category === "CONFLICT" || category === "CAPABILITY_PRECONDITION" ? "REJECTED" : "FAILED";
      return response(request, outcome, errorPayload(error), [], null, started, []);
    }
  };
}());
