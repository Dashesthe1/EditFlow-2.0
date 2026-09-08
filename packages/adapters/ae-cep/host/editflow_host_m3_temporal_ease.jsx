/* EditFlow 2.0 M3 Graph Editor temporal ease host layer.
 * Fixed typed protocol 1.8 commands only. No arbitrary code execution.
 *
 * Scope boundary:
 * - INCLUDED: exact per-key KeyframeEase incoming/outgoing speed and influence.
 * - INCLUDED: structural readback, dimension/cardinality validation, transaction rollback.
 * - EXCLUDED: changing keyframe values, interpolation type/auto-Bezier/continuity,
 *   spatial tangents/roving, markers, motion blur, frame blending, and shutter controls.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("EditFlow M3 temporal-ease layer requires the existing dispatcher.");

  var PROTOCOL = "1.8.0";
  var BUILD = "0.4.0-dev.8";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var CAPABILITIES = {
    "property.temporal_ease.set": "ae.property.temporal_ease.set",
    "property.temporal_ease.readback": "ae.property.temporal_ease.readback"
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
    var source = asString(text);
    var start = source.indexOf(prefix);
    if (start < 0) return null;
    start += prefix.length;
    var end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }
  function stableIdFromText(text) { return markerValue(text, STABLE_PREFIX); }
  function layerStableId(layer) { try { return stableIdFromText(layer.comment); } catch (_) { return null; } }
  function hostIdOf(layer) { try { return typeof layer.id === "number" ? layer.id : null; } catch (_) { return null; } }

  function findItem(ref) {
    if (!ref || typeof ref !== "object") reject("OBJECT_REF_REQUIRED", "Object reference is required.");
    var project = app.project;
    var i, item;
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
  function layerRef(layer) {
    return { stableId: layerStableId(layer), hostId: hostIdOf(layer), index: layer.index, name: layer.name };
  }

  function validatePropertyPath(path) {
    if (!(path instanceof Array) || path.length === 0) reject("PROPERTY_PATH_REQUIRED", "propertyPath must be a non-empty array.");
    var i, segment;
    for (i = 0; i < path.length; i += 1) {
      segment = path[i];
      if (typeof segment === "string") {
        if (segment.length === 0) reject("PROPERTY_PATH_SEGMENT_INVALID", "String propertyPath segments must not be empty.", { index: i });
      } else if (typeof segment === "number") {
        if (segment !== Math.floor(segment) || segment < 1) reject("PROPERTY_PATH_SEGMENT_INVALID", "Numeric propertyPath segments must be positive integers.", { index: i });
      } else {
        reject("PROPERTY_PATH_SEGMENT_INVALID", "propertyPath segments must be non-empty strings or positive integers.", { index: i });
      }
    }
  }
  function resolveProperty(root, path) {
    validatePropertyPath(path);
    var current = root;
    var i;
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
  function easeCardinality(property) {
    if (property.propertyValueType === PropertyValueType.TwoD) return 2;
    if (property.propertyValueType === PropertyValueType.ThreeD) return 3;
    return 1;
  }
  function supportsTemporalEase(property) {
    return typeof property.keyInTemporalEase === "function"
      && typeof property.keyOutTemporalEase === "function"
      && typeof property.setTemporalEaseAtKey === "function"
      && typeof property.keyInInterpolationType === "function"
      && typeof property.keyOutInterpolationType === "function"
      && typeof property.keyTemporalAutoBezier === "function";
  }
  function requireManualBezier(property, keyIndex) {
    if (property.keyInInterpolationType(keyIndex) !== KeyframeInterpolationType.BEZIER
        || property.keyOutInterpolationType(keyIndex) !== KeyframeInterpolationType.BEZIER) {
      fail("CAPABILITY_PRECONDITION", "TEMPORAL_EASE_REQUIRES_BEZIER_INTERPOLATION", "Numeric temporal ease requires BEZIER incoming and outgoing interpolation. Use protocol 1.7 temporal_interpolation.set first.", { keyIndex: keyIndex });
    }
    if (property.keyTemporalAutoBezier(keyIndex) === true) {
      fail("CAPABILITY_PRECONDITION", "TEMPORAL_EASE_REQUIRES_MANUAL_BEZIER", "Numeric temporal ease requires temporalAutoBezier=false. Use protocol 1.7 temporal_interpolation.set first.", { keyIndex: keyIndex });
    }
  }
  function validateEaseObject(value, direction, index) {
    if (!value || typeof value !== "object" || value instanceof Array) reject("KEYFRAME_EASE_INVALID", "Each KeyframeEase entry must be an object.", { direction: direction, index: index });
    var key;
    var count = 0;
    for (key in value) if (own(value, key)) {
      count += 1;
      if (key !== "speed" && key !== "influence") reject("KEYFRAME_EASE_UNKNOWN_FIELD", "Unknown KeyframeEase field: " + key, { direction: direction, index: index, field: key });
    }
    if (count !== 2 || !own(value, "speed") || !own(value, "influence")) reject("KEYFRAME_EASE_INCOMPLETE", "Each KeyframeEase entry must specify exactly speed and influence.", { direction: direction, index: index });
    if (!finiteNumber(value.speed)) reject("KEYFRAME_EASE_SPEED_INVALID", "KeyframeEase speed must be a finite number.", { direction: direction, index: index, speed: value.speed });
    if (!finiteNumber(value.influence) || value.influence < 0.1 || value.influence > 100.0) reject("KEYFRAME_EASE_INFLUENCE_INVALID", "KeyframeEase influence must be a finite number from 0.1 through 100.0.", { direction: direction, index: index, influence: value.influence });
  }
  function validateEaseArray(value, direction, cardinality) {
    if (!(value instanceof Array)) reject("TEMPORAL_EASE_ARRAY_REQUIRED", direction + "Ease must be an array.", { direction: direction });
    if (value.length !== cardinality) reject("TEMPORAL_EASE_CARDINALITY_MISMATCH", direction + "Ease must contain exactly " + cardinality + " KeyframeEase object(s) for this property value type.", { direction: direction, expected: cardinality, actual: value.length });
    var i;
    for (i = 0; i < value.length; i += 1) validateEaseObject(value[i], direction, i);
  }
  function validateEaseState(property, ease) {
    if (!ease || typeof ease !== "object" || ease instanceof Array) reject("TEMPORAL_EASE_STATE_REQUIRED", "ease must be an object.");
    var key;
    var count = 0;
    for (key in ease) if (own(ease, key)) {
      count += 1;
      if (key !== "inEase" && key !== "outEase") reject("TEMPORAL_EASE_STATE_UNKNOWN_FIELD", "Unknown temporal ease field: " + key, { field: key });
    }
    if (count !== 2 || !own(ease, "inEase") || !own(ease, "outEase")) reject("TEMPORAL_EASE_STATE_INCOMPLETE", "ease must specify exactly inEase and outEase.");
    var cardinality = easeCardinality(property);
    validateEaseArray(ease.inEase, "in", cardinality);
    validateEaseArray(ease.outEase, "out", cardinality);
  }

  function easeToPlain(value) { return { speed: value.speed, influence: value.influence }; }
  function easeArrayToPlain(values) {
    var result = [];
    var i;
    for (i = 0; i < values.length; i += 1) result.push(easeToPlain(values[i]));
    return result;
  }
  function easeStateReadback(property, keyIndex) {
    if (!supportsTemporalEase(property)) fail("CAPABILITY_UNAVAILABLE", "TEMPORAL_EASE_UNAVAILABLE", "The resolved property does not expose the required temporal-ease readback surface.");
    return {
      inEase: easeArrayToPlain(property.keyInTemporalEase(keyIndex)),
      outEase: easeArrayToPlain(property.keyOutTemporalEase(keyIndex))
    };
  }
  function interpolationName(value) {
    if (value === KeyframeInterpolationType.LINEAR) return "LINEAR";
    if (value === KeyframeInterpolationType.BEZIER) return "BEZIER";
    if (value === KeyframeInterpolationType.HOLD) return "HOLD";
    return "UNKNOWN";
  }
  function propertyMetadata(property, path) {
    var name = null;
    var matchName = null;
    var isSpatial = null;
    try { name = asString(property.name); } catch (_) {}
    try { matchName = asString(property.matchName); } catch (_) {}
    try { isSpatial = typeof property.isSpatial === "boolean" ? property.isSpatial : null; } catch (_) {}
    return { name: name, matchName: matchName, propertyPath: path, numKeys: property.numKeys, isSpatial: isSpatial, easeCardinality: easeCardinality(property) };
  }
  function temporalEaseReadback(layer, property, path, keyIndex) {
    return {
      temporalEase: {
        layer: layerRef(layer),
        property: propertyMetadata(property, path),
        keyIndex: keyIndex,
        keyTime: property.keyTime(keyIndex),
        interpolation: {
          inType: interpolationName(property.keyInInterpolationType(keyIndex)),
          outType: interpolationName(property.keyOutInterpolationType(keyIndex)),
          temporalAutoBezier: property.keyTemporalAutoBezier(keyIndex) === true
        },
        state: easeStateReadback(property, keyIndex)
      }
    };
  }
  function affected(layer) { return { kind: "LAYER", stableId: layerStableId(layer), hostId: hostIdOf(layer) }; }

  function closeNumber(left, right) { return Math.abs(left - right) <= 0.0000001; }
  function sameEaseArray(actual, expected) {
    if (!actual || !expected || actual.length !== expected.length) return false;
    var i;
    for (i = 0; i < actual.length; i += 1) {
      if (!closeNumber(actual[i].speed, expected[i].speed) || !closeNumber(actual[i].influence, expected[i].influence)) return false;
    }
    return true;
  }
  function sameEaseState(actual, expected) {
    return sameEaseArray(actual.inEase, expected.inEase) && sameEaseArray(actual.outEase, expected.outEase);
  }
  function toKeyframeEaseArray(values) {
    var result = [];
    var i;
    for (i = 0; i < values.length; i += 1) result.push(new KeyframeEase(values[i].speed, values[i].influence));
    return result;
  }
  function applyEaseState(property, keyIndex, ease) {
    property.setTemporalEaseAtKey(keyIndex, toKeyframeEaseArray(ease.inEase), toKeyframeEaseArray(ease.outEase));
  }
  function verifyEaseState(property, keyIndex, expected) {
    var actual = easeStateReadback(property, keyIndex);
    if (!sameEaseState(actual, expected)) fail("READBACK", "TEMPORAL_EASE_READBACK_MISMATCH", "Applied temporal ease did not match structural readback.", { expected: expected, actual: actual });
  }

  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") reject("EXPECTED_HOST_REVISION_REQUIRED", "Mutating temporal-ease commands require expectedHostProjectRevision.");
    var actual = app.project ? app.project.revision : null;
    if (actual !== request.expectedHostProjectRevision) conflict("HOST_REVISION_CONFLICT", "Host project revision does not match the expected revision.", { expectedHostProjectRevision: request.expectedHostProjectRevision, actualHostProjectRevision: actual });
  }
  function errorPayload(error) {
    return {
      category: error && error.editflowCategory ? error.editflowCategory : "ADAPTER_FAILURE",
      code: error && error.editflowCode ? error.editflowCode : "M3_TEMPORAL_EASE_HOST_FAILURE",
      message: error && error.message ? String(error.message) : String(error),
      details: error && own(error, "editflowDetails") ? error.editflowDetails : null
    };
  }
  function responseFor(request, outcome, error, affectedObjects, readback, startedAt, notes) {
    return {
      protocolVersion: PROTOCOL,
      requestId: request.requestId,
      transactionId: request.transactionId,
      operationId: request.operationId,
      capabilityId: request.capabilityId,
      command: request.command,
      outcome: outcome,
      error: error,
      affectedObjects: affectedObjects || [],
      readback: readback || null,
      hostProjectRevision: app.project ? app.project.revision : null,
      diagnostics: { adapterProtocolVersion: PROTOCOL, adapterBuild: BUILD, command: request.command, durationMs: nowMs() - startedAt, notes: notes || [] }
    };
  }

  function parseAndPrepare(request) {
    if (!request || typeof request !== "object") reject("REQUEST_REQUIRED", "Protocol 1.8 request object is required.");
    if (!own(CAPABILITIES, request.command)) reject("TEMPORAL_EASE_COMMAND_UNSUPPORTED", "Unsupported protocol 1.8 temporal-ease command: " + asString(request.command));
    if (request.capabilityId !== CAPABILITIES[request.command]) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match the temporal-ease command.");
    if (!request.payload || typeof request.payload !== "object") reject("PAYLOAD_REQUIRED", "Temporal-ease payload object is required.");
    if (!request.payload.comp || !request.payload.layer) reject("TEMPORAL_EASE_TARGET_REQUIRED", "Temporal-ease payload requires comp and layer references.");
    var comp = findComp(request.payload.comp);
    var layer = findLayer(comp, request.payload.layer);
    var property = resolveProperty(layer, request.payload.propertyPath);
    validateKeyIndex(property, request.payload.keyIndex);
    if (!supportsTemporalEase(property)) fail("CAPABILITY_UNAVAILABLE", "TEMPORAL_EASE_UNAVAILABLE", "The resolved property does not expose the required temporal-ease surface.");
    if (request.command === "property.temporal_ease.set") {
      requireManualBezier(property, request.payload.keyIndex);
      validateEaseState(property, request.payload.ease);
    }
    return { comp: comp, layer: layer, property: property, propertyPath: request.payload.propertyPath, keyIndex: request.payload.keyIndex };
  }

  function execute(request) {
    var startedAt = nowMs();
    var prepared;
    try { prepared = parseAndPrepare(request); }
    catch (preflightError) { return responseFor(request, "REJECTED", errorPayload(preflightError), [], null, startedAt, ["Temporal-ease request rejected before mutation."]); }

    if (request.command === "property.temporal_ease.readback") {
      try {
        return responseFor(request, "NO_OP", null, [], temporalEaseReadback(prepared.layer, prepared.property, prepared.propertyPath, prepared.keyIndex), startedAt, ["Read-only exact temporal-ease readback."]);
      } catch (readbackError) {
        return responseFor(request, "FAILED", errorPayload(readbackError), [], null, startedAt, ["Temporal-ease readback failed without mutation."]);
      }
    }

    try { requireExpectedRevision(request); }
    catch (revisionError) {
      return responseFor(request, "REJECTED", errorPayload(revisionError), [], temporalEaseReadback(prepared.layer, prepared.property, prepared.propertyPath, prepared.keyIndex), startedAt, ["Temporal-ease mutation rejected before mutation."]);
    }

    var beforeState = easeStateReadback(prepared.property, prepared.keyIndex);
    if (sameEaseState(beforeState, request.payload.ease)) {
      return responseFor(request, "NO_OP", null, [], temporalEaseReadback(prepared.layer, prepared.property, prepared.propertyPath, prepared.keyIndex), startedAt, ["Requested temporal ease already matches host state."]);
    }

    var mutationStarted = false;
    app.beginUndoGroup("EditFlow M3 temporal ease");
    try {
      mutationStarted = true;
      applyEaseState(prepared.property, prepared.keyIndex, request.payload.ease);
      verifyEaseState(prepared.property, prepared.keyIndex, request.payload.ease);

      /* Proof-only P4 injection. Ordinary product requests cannot arm this path:
       * the isolated self-hosted runner must launch its owned AE process with the
       * exact proof environment flag and the typed protocol-1.8 mutation must carry
       * the fixed failure-injection readback profile. Injection occurs only after a
       * real KeyframeEase mutation passes structural verification while the normal
       * AE Undo group remains open, exercising the exact production rollback path. */
      if (request.readbackProfile === "M3_TEMPORAL_EASE_P4_FAILURE_INJECTION"
          && $.getenv("EDITFLOW_M3_TEMPORAL_EASE_P4_PROOF") === "1") {
        fail("PROOF_INJECTION", "M3_TEMPORAL_EASE_P4_INDUCED_FAILURE", "Induced M3 temporal-ease P4 failure after verified KeyframeEase mutation.", null);
      }

      app.endUndoGroup();
      return responseFor(request, "APPLIED", null, [affected(prepared.layer)], temporalEaseReadback(prepared.layer, prepared.property, prepared.propertyPath, prepared.keyIndex), startedAt, ["Temporal-ease mutation applied and structurally verified."]);
    } catch (mutationError) {
      try { app.endUndoGroup(); } catch (_) {}
      var rollbackError = null;
      if (mutationStarted) {
        try { app.executeCommand(16); } catch (undoError) { rollbackError = undoError; }
      }
      if (rollbackError) {
        return responseFor(request, "FAILED", { category: "ROLLBACK_FAILURE", code: "TEMPORAL_EASE_ROLLBACK_FAILED", message: asString(rollbackError), details: { mutationError: errorPayload(mutationError) } }, [], null, startedAt, ["Temporal-ease mutation failed and undo rollback also failed."]);
      }
      return responseFor(request, "FAILED", errorPayload(mutationError), [], temporalEaseReadback(prepared.layer, prepared.property, prepared.propertyPath, prepared.keyIndex), startedAt, ["Temporal-ease mutation failed and was rolled back through the transaction undo boundary."]);
    }
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); }
    catch (_) { return previousDispatch(requestJson); }
    if (!request || request.protocolVersion !== PROTOCOL) return previousDispatch(requestJson);
    return $.global.EditFlow2_JSON.stringify(execute(request));
  };
}());
