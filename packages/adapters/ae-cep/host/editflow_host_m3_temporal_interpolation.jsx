/* EditFlow 2.0 M3 exact temporal interpolation host layer.
 * Fixed typed protocol 1.7 commands only. No arbitrary code execution.
 *
 * Scope boundary:
 * - INCLUDED: per-key in/out interpolation type, temporal continuity, temporal auto-Bezier.
 * - EXCLUDED: KeyframeEase speed/influence, value/speed Graph Editor controls,
 *   spatial tangents/continuity/auto-Bezier, roving, and compound rendering controls.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("EditFlow M3 temporal-interpolation layer requires the existing dispatcher.");

  var PROTOCOL = "1.7.0";
  var BUILD = "0.4.0-dev.7";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var CAPABILITIES = {
    "property.temporal_interpolation.set": "ae.property.temporal_interpolation.set",
    "property.temporal_interpolation.readback": "ae.property.temporal_interpolation.readback"
  };
  var INTERPOLATION_TYPES = { LINEAR: true, BEZIER: true, HOLD: true };
  var STATE_KEYS = { inType: true, outType: true, temporalContinuous: true, temporalAutoBezier: true };

  function nowMs() { return (new Date()).getTime(); }
  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function own(object, key) { return object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key); }
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

  function interpolationEnum(name) {
    if (name === "LINEAR") return KeyframeInterpolationType.LINEAR;
    if (name === "BEZIER") return KeyframeInterpolationType.BEZIER;
    if (name === "HOLD") return KeyframeInterpolationType.HOLD;
    reject("INTERPOLATION_TYPE_INVALID", "Interpolation type must be LINEAR, BEZIER, or HOLD.", { value: name });
  }
  function interpolationName(value) {
    if (value === KeyframeInterpolationType.LINEAR) return "LINEAR";
    if (value === KeyframeInterpolationType.BEZIER) return "BEZIER";
    if (value === KeyframeInterpolationType.HOLD) return "HOLD";
    fail("READBACK", "INTERPOLATION_TYPE_UNKNOWN", "After Effects returned an unknown keyframe interpolation type.", { value: asString(value) });
  }
  function validateKeyIndex(property, keyIndex) {
    if (typeof keyIndex !== "number" || keyIndex !== Math.floor(keyIndex) || keyIndex < 1) {
      reject("KEY_INDEX_INVALID", "keyIndex must be a positive integer.");
    }
    if (typeof property.numKeys !== "number" || keyIndex > property.numKeys) {
      reject("KEY_INDEX_OUT_OF_RANGE", "keyIndex exceeds the current keyframe count.", { keyIndex: keyIndex, numKeys: property.numKeys });
    }
  }
  function propertySupportsInterpolation(property) {
    return typeof property.isInterpolationTypeValid === "function"
      && typeof property.keyInInterpolationType === "function"
      && typeof property.keyOutInterpolationType === "function"
      && typeof property.keyTemporalContinuous === "function"
      && typeof property.keyTemporalAutoBezier === "function";
  }
  function interpolationSupport(property) {
    if (typeof property.isInterpolationTypeValid !== "function") {
      fail("CAPABILITY_UNAVAILABLE", "TEMPORAL_INTERPOLATION_UNAVAILABLE", "The resolved property does not expose interpolation capability checks.");
    }
    return {
      LINEAR: property.isInterpolationTypeValid(KeyframeInterpolationType.LINEAR) === true,
      BEZIER: property.isInterpolationTypeValid(KeyframeInterpolationType.BEZIER) === true,
      HOLD: property.isInterpolationTypeValid(KeyframeInterpolationType.HOLD) === true
    };
  }
  function validateState(property, state) {
    if (!state || typeof state !== "object" || state instanceof Array) reject("TEMPORAL_INTERPOLATION_STATE_REQUIRED", "interpolation must be an object.");
    var key;
    var count = 0;
    for (key in state) if (own(state, key)) {
      count += 1;
      if (!own(STATE_KEYS, key)) reject("TEMPORAL_INTERPOLATION_STATE_UNKNOWN_FIELD", "Unknown temporal interpolation field: " + key, { field: key });
    }
    if (count !== 4 || !own(state, "inType") || !own(state, "outType") || !own(state, "temporalContinuous") || !own(state, "temporalAutoBezier")) {
      reject("TEMPORAL_INTERPOLATION_STATE_INCOMPLETE", "interpolation must specify exactly inType, outType, temporalContinuous, and temporalAutoBezier.");
    }
    if (!own(INTERPOLATION_TYPES, state.inType) || !own(INTERPOLATION_TYPES, state.outType)) {
      reject("INTERPOLATION_TYPE_INVALID", "inType and outType must be LINEAR, BEZIER, or HOLD.");
    }
    if (typeof state.temporalContinuous !== "boolean" || typeof state.temporalAutoBezier !== "boolean") {
      reject("TEMPORAL_BEZIER_FLAG_INVALID", "temporalContinuous and temporalAutoBezier must be booleans.");
    }

    var support = interpolationSupport(property);
    if (support[state.inType] !== true) fail("CAPABILITY_UNAVAILABLE", "INTERPOLATION_TYPE_NOT_SUPPORTED", "The target property does not support the requested incoming interpolation type.", { direction: "IN", type: state.inType });
    if (support[state.outType] !== true) fail("CAPABILITY_UNAVAILABLE", "INTERPOLATION_TYPE_NOT_SUPPORTED", "The target property does not support the requested outgoing interpolation type.", { direction: "OUT", type: state.outType });

    if ((state.temporalContinuous === true || state.temporalAutoBezier === true)
        && (state.inType !== "BEZIER" || state.outType !== "BEZIER")) {
      reject("TEMPORAL_BEZIER_FLAG_REQUIRES_BEZIER", "temporalContinuous/temporalAutoBezier may be true only when both inType and outType are BEZIER.");
    }
  }

  function propertyMetadata(property, path) {
    var name = null;
    var matchName = null;
    var isSpatial = null;
    try { name = asString(property.name); } catch (_) {}
    try { matchName = asString(property.matchName); } catch (_) {}
    try { isSpatial = typeof property.isSpatial === "boolean" ? property.isSpatial : null; } catch (_) {}
    return { name: name, matchName: matchName, propertyPath: path, numKeys: property.numKeys, isSpatial: isSpatial };
  }
  function stateReadback(property, keyIndex) {
    if (!propertySupportsInterpolation(property)) {
      fail("CAPABILITY_UNAVAILABLE", "TEMPORAL_INTERPOLATION_UNAVAILABLE", "The resolved property does not expose the required temporal interpolation readback surface.");
    }
    return {
      inType: interpolationName(property.keyInInterpolationType(keyIndex)),
      outType: interpolationName(property.keyOutInterpolationType(keyIndex)),
      temporalContinuous: property.keyTemporalContinuous(keyIndex) === true,
      temporalAutoBezier: property.keyTemporalAutoBezier(keyIndex) === true
    };
  }
  function temporalReadback(layer, property, path, keyIndex) {
    return {
      temporalInterpolation: {
        layer: layerRef(layer),
        property: propertyMetadata(property, path),
        keyIndex: keyIndex,
        keyTime: property.keyTime(keyIndex),
        supportedInterpolationTypes: interpolationSupport(property),
        state: stateReadback(property, keyIndex)
      }
    };
  }
  function affected(layer) { return { kind: "LAYER", stableId: layerStableId(layer), hostId: hostIdOf(layer) }; }

  function sameState(actual, expected) {
    return actual.inType === expected.inType
      && actual.outType === expected.outType
      && actual.temporalContinuous === expected.temporalContinuous
      && actual.temporalAutoBezier === expected.temporalAutoBezier;
  }
  function applyState(property, keyIndex, state) {
    if (typeof property.setInterpolationTypeAtKey !== "function"
        || typeof property.setTemporalContinuousAtKey !== "function"
        || typeof property.setTemporalAutoBezierAtKey !== "function") {
      fail("CAPABILITY_UNAVAILABLE", "TEMPORAL_INTERPOLATION_WRITE_UNAVAILABLE", "The resolved property does not expose the required temporal interpolation mutation methods.");
    }
    property.setInterpolationTypeAtKey(keyIndex, interpolationEnum(state.inType), interpolationEnum(state.outType));
    property.setTemporalContinuousAtKey(keyIndex, state.temporalContinuous === true);
    property.setTemporalAutoBezierAtKey(keyIndex, state.temporalAutoBezier === true);
  }
  function verifyState(property, keyIndex, expected) {
    var actual = stateReadback(property, keyIndex);
    if (!sameState(actual, expected)) {
      fail("READBACK", "TEMPORAL_INTERPOLATION_READBACK_MISMATCH", "Applied temporal interpolation did not match structural readback.", { expected: expected, actual: actual });
    }
  }

  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") reject("EXPECTED_HOST_REVISION_REQUIRED", "Mutating temporal-interpolation commands require expectedHostProjectRevision.");
    var actual = app.project ? app.project.revision : null;
    if (actual !== request.expectedHostProjectRevision) conflict("HOST_REVISION_CONFLICT", "Host project revision does not match the expected revision.", { expectedHostProjectRevision: request.expectedHostProjectRevision, actualHostProjectRevision: actual });
  }
  function errorPayload(error) {
    return {
      category: error && error.editflowCategory ? error.editflowCategory : "ADAPTER_FAILURE",
      code: error && error.editflowCode ? error.editflowCode : "M3_TEMPORAL_INTERPOLATION_HOST_FAILURE",
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
    if (!request || typeof request !== "object") reject("REQUEST_REQUIRED", "Protocol 1.7 request object is required.");
    if (!own(CAPABILITIES, request.command)) reject("TEMPORAL_INTERPOLATION_COMMAND_UNSUPPORTED", "Unsupported protocol 1.7 temporal-interpolation command: " + asString(request.command));
    if (request.capabilityId !== CAPABILITIES[request.command]) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match the temporal-interpolation command.");
    if (!request.payload || typeof request.payload !== "object") reject("PAYLOAD_REQUIRED", "Temporal-interpolation payload object is required.");
    if (!request.payload.comp || !request.payload.layer) reject("TEMPORAL_INTERPOLATION_TARGET_REQUIRED", "Temporal-interpolation payload requires comp and layer references.");
    var comp = findComp(request.payload.comp);
    var layer = findLayer(comp, request.payload.layer);
    var property = resolveProperty(layer, request.payload.propertyPath);
    validateKeyIndex(property, request.payload.keyIndex);
    if (!propertySupportsInterpolation(property)) fail("CAPABILITY_UNAVAILABLE", "TEMPORAL_INTERPOLATION_UNAVAILABLE", "The resolved property does not expose the required temporal interpolation surface.");
    if (request.command === "property.temporal_interpolation.set") validateState(property, request.payload.interpolation);
    return { comp: comp, layer: layer, property: property, propertyPath: request.payload.propertyPath, keyIndex: request.payload.keyIndex };
  }

  function execute(request) {
    var startedAt = nowMs();
    var prepared;
    try { prepared = parseAndPrepare(request); }
    catch (preflightError) { return responseFor(request, "REJECTED", errorPayload(preflightError), [], null, startedAt, ["Temporal-interpolation request rejected before mutation."]); }

    if (request.command === "property.temporal_interpolation.readback") {
      try {
        return responseFor(request, "NO_OP", null, [], temporalReadback(prepared.layer, prepared.property, prepared.propertyPath, prepared.keyIndex), startedAt, ["Read-only exact temporal interpolation readback."]);
      } catch (readbackError) {
        return responseFor(request, "FAILED", errorPayload(readbackError), [], null, startedAt, ["Temporal-interpolation readback failed without mutation."]);
      }
    }

    try { requireExpectedRevision(request); }
    catch (revisionError) {
      return responseFor(request, "REJECTED", errorPayload(revisionError), [], temporalReadback(prepared.layer, prepared.property, prepared.propertyPath, prepared.keyIndex), startedAt, ["Temporal-interpolation mutation rejected before mutation."]);
    }

    var beforeState = stateReadback(prepared.property, prepared.keyIndex);
    if (sameState(beforeState, request.payload.interpolation)) {
      return responseFor(request, "NO_OP", null, [], temporalReadback(prepared.layer, prepared.property, prepared.propertyPath, prepared.keyIndex), startedAt, ["Requested temporal interpolation already matches host state."]);
    }

    var mutationStarted = false;
    app.beginUndoGroup("EditFlow M3 temporal interpolation");
    try {
      mutationStarted = true;
      applyState(prepared.property, prepared.keyIndex, request.payload.interpolation);
      verifyState(prepared.property, prepared.keyIndex, request.payload.interpolation);

      /* Proof-only P4 injection. Ordinary product requests cannot arm this path:
       * the isolated self-hosted runner must launch its owned AE process with the
       * exact proof environment flag and the typed protocol-1.7 mutation must carry
       * the fixed failure-injection readback profile. Injection happens only after a
       * real temporal-interpolation mutation has passed structural verification while
       * the normal AE Undo group remains open, so the production rollback path must
       * recover the exact pre-mutation key state. */
      if (request.readbackProfile === "M3_TEMPORAL_INTERPOLATION_P4_FAILURE_INJECTION"
          && $.getenv("EDITFLOW_M3_TEMPORAL_INTERPOLATION_P4_PROOF") === "1") {
        fail("PROOF_INJECTION", "M3_TEMPORAL_INTERPOLATION_P4_INDUCED_FAILURE", "Induced M3 temporal-interpolation P4 failure after verified interpolation mutation.", null);
      }

      app.endUndoGroup();
      return responseFor(request, "APPLIED", null, [affected(prepared.layer)], temporalReadback(prepared.layer, prepared.property, prepared.propertyPath, prepared.keyIndex), startedAt, ["Temporal interpolation mutation applied and structurally verified."]);
    } catch (mutationError) {
      try { app.endUndoGroup(); } catch (_) {}
      var rollbackError = null;
      if (mutationStarted) {
        try { app.executeCommand(16); } catch (undoError) { rollbackError = undoError; }
      }
      if (rollbackError) {
        return responseFor(request, "FAILED", { category: "ROLLBACK_FAILURE", code: "TEMPORAL_INTERPOLATION_ROLLBACK_FAILED", message: asString(rollbackError), details: { mutationError: errorPayload(mutationError) } }, [], null, startedAt, ["Temporal-interpolation mutation failed and undo rollback also failed."]);
      }
      return responseFor(request, "FAILED", errorPayload(mutationError), [], temporalReadback(prepared.layer, prepared.property, prepared.propertyPath, prepared.keyIndex), startedAt, ["Temporal-interpolation mutation failed and was rolled back through the transaction undo boundary."]);
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
