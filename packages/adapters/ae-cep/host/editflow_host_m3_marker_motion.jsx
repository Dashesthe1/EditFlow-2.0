/* EditFlow 2.0 M3 marker + motion host layer.
 * Fixed typed protocol 2.0 commands only. No arbitrary code execution.
 * Covers composition/layer markers, motion blur, frame blending and shutter sampling controls.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("EditFlow M3 marker-motion layer requires the existing dispatcher.");

  var PROTOCOL = "2.0.0";
  var BUILD = "0.4.0-dev.10.2";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var CAPABILITIES = {
    "marker.set": "ae.marker.set",
    "marker.remove": "ae.marker.remove",
    "marker.readback": "ae.marker.readback",
    "comp.motion.set": "ae.comp.motion.set",
    "comp.motion.readback": "ae.comp.motion.readback",
    "layer.motion.set": "ae.layer.motion.set",
    "layer.motion.readback": "ae.layer.motion.readback"
  };

  function nowMs() { return (new Date()).getTime(); }
  function own(object, key) { return object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key); }
  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function finiteNumber(value) { return typeof value === "number" && isFinite(value); }
  function integer(value) { return finiteNumber(value) && value === Math.floor(value); }
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
  function itemStableId(item) { try { return stableIdFromText(item.comment); } catch (_) { return null; } }
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

  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") reject("EXPECTED_HOST_REVISION_REQUIRED", "Mutating marker-motion commands require expectedHostProjectRevision.");
    var actual = app.project ? app.project.revision : null;
    if (actual !== request.expectedHostProjectRevision) conflict("HOST_REVISION_CONFLICT", "Host project revision does not match the expected revision.", { expectedHostProjectRevision: request.expectedHostProjectRevision, actualHostProjectRevision: actual });
  }

  function resolveMarkerTarget(target) {
    if (!target || typeof target !== "object") reject("MARKER_TARGET_REQUIRED", "Marker target is required.");
    if (target.kind === "COMP") {
      var comp = findComp(target.comp);
      if (!comp.markerProperty) fail("CAPABILITY_UNAVAILABLE", "COMP_MARKERS_UNAVAILABLE", "Composition markerProperty is unavailable.");
      return { kind: "COMP", comp: comp, layer: null, property: comp.markerProperty };
    }
    if (target.kind === "LAYER") {
      var containingComp = findComp(target.comp), layer = findLayer(containingComp, target.layer);
      if (!layer.marker) fail("CAPABILITY_UNAVAILABLE", "LAYER_MARKERS_UNAVAILABLE", "Layer marker property is unavailable.");
      return { kind: "LAYER", comp: containingComp, layer: layer, property: layer.marker };
    }
    reject("MARKER_TARGET_KIND_INVALID", "Marker target.kind must be COMP or LAYER.");
  }

  function validateMarkerState(marker, targetKind) {
    if (!marker || typeof marker !== "object" || marker instanceof Array) reject("MARKER_STATE_REQUIRED", "marker must be an object.");
    if (typeof marker.comment !== "string") reject("MARKER_COMMENT_REQUIRED", "marker.comment must be a string.");
    var optionalStrings = ["chapter", "url", "frameTarget", "cuePointName"], i, key;
    for (i = 0; i < optionalStrings.length; i += 1) {
      key = optionalStrings[i];
      if (own(marker, key) && typeof marker[key] !== "string") reject("MARKER_STRING_FIELD_INVALID", key + " must be a string.", { field: key });
    }
    if (own(marker, "duration") && (!finiteNumber(marker.duration) || marker.duration < 0)) reject("MARKER_DURATION_INVALID", "marker.duration must be a finite non-negative number.");
    if (own(marker, "eventCuePoint") && typeof marker.eventCuePoint !== "boolean") reject("MARKER_EVENT_FLAG_INVALID", "marker.eventCuePoint must be boolean.");
    if (own(marker, "label") && (!integer(marker.label) || marker.label < 0 || marker.label > 16)) reject("MARKER_LABEL_INVALID", "marker.label must be an integer from 0 through 16.");
    if (own(marker, "protectedRegion")) {
      if (typeof marker.protectedRegion !== "boolean") reject("MARKER_PROTECTED_REGION_INVALID", "marker.protectedRegion must be boolean.");
      if (targetKind !== "COMP" && marker.protectedRegion) reject("LAYER_PROTECTED_REGION_FORBIDDEN", "Protected-region markers are composition-only.");
    }
    if (own(marker, "parameters")) {
      if (!marker.parameters || typeof marker.parameters !== "object" || marker.parameters instanceof Array) reject("MARKER_PARAMETERS_INVALID", "marker.parameters must be an object of string values.");
      for (key in marker.parameters) if (own(marker.parameters, key) && typeof marker.parameters[key] !== "string") reject("MARKER_PARAMETER_VALUE_INVALID", "Marker parameter values must be strings.", { key: key });
    }
  }

  function makeMarker(marker, targetKind) {
    validateMarkerState(marker, targetKind);
    var value = new MarkerValue(marker.comment, marker.chapter || "", marker.url || "", marker.frameTarget || "", marker.cuePointName || "");
    if (own(marker, "duration")) value.duration = marker.duration;
    if (own(marker, "eventCuePoint")) value.eventCuePoint = marker.eventCuePoint;
    if (own(marker, "label")) value.label = marker.label;
    if (own(marker, "protectedRegion") && targetKind === "COMP") value.protectedRegion = marker.protectedRegion;
    if (own(marker, "parameters")) value.setParameters(marker.parameters);
    return value;
  }

  function markerState(value) {
    var params = {}, raw = null, key;
    try { raw = value.getParameters(); } catch (_) { raw = null; }
    if (raw) for (key in raw) if (own(raw, key)) params[key] = asString(raw[key]);
    return {
      comment: asString(value.comment), chapter: asString(value.chapter), url: asString(value.url), frameTarget: asString(value.frameTarget),
      cuePointName: asString(value.cuePointName), duration: Number(value.duration || 0), eventCuePoint: value.eventCuePoint === true,
      label: typeof value.label === "number" ? value.label : 0, protectedRegion: value.protectedRegion === true, parameters: params
    };
  }
  function readMarkers(resolved) {
    var property = resolved.property, result = [], i;
    for (i = 1; i <= property.numKeys; i += 1) result.push({ keyIndex: i, time: property.keyTime(i), marker: markerState(property.keyValue(i)) });
    return { markerTarget: { kind: resolved.kind, comp: { stableId: itemStableId(resolved.comp), hostId: hostIdOf(resolved.comp) }, layer: resolved.layer ? { stableId: layerStableId(resolved.layer), hostId: hostIdOf(resolved.layer), index: resolved.layer.index, name: resolved.layer.name } : null }, markers: result };
  }
  function sameMarkerState(a, b) {
    var fields = ["comment", "chapter", "url", "frameTarget", "cuePointName", "duration", "eventCuePoint", "label", "protectedRegion"], i, key;
    for (i = 0; i < fields.length; i += 1) { key = fields[i]; if (a[key] !== b[key]) return false; }
    for (key in a.parameters) if (own(a.parameters, key) && a.parameters[key] !== b.parameters[key]) return false;
    for (key in b.parameters) if (own(b.parameters, key) && a.parameters[key] !== b.parameters[key]) return false;
    return true;
  }

  function validateCompMotionState(state) {
    if (!state || typeof state !== "object" || state instanceof Array) reject("COMP_MOTION_STATE_REQUIRED", "state must be an object.");
    if (typeof state.motionBlur !== "boolean" || typeof state.frameBlending !== "boolean") reject("COMP_MOTION_FLAG_INVALID", "motionBlur and frameBlending must be booleans.");
    if (!integer(state.shutterAngle) || state.shutterAngle < 0 || state.shutterAngle > 720) reject("SHUTTER_ANGLE_INVALID", "shutterAngle must be an integer from 0 through 720.");
    if (!integer(state.shutterPhase) || state.shutterPhase < -360 || state.shutterPhase > 360) reject("SHUTTER_PHASE_INVALID", "shutterPhase must be an integer from -360 through 360.");
    if (!integer(state.samplesPerFrame) || state.samplesPerFrame < 2 || state.samplesPerFrame > 64) reject("MOTION_SAMPLES_INVALID", "samplesPerFrame must be an integer from 2 through 64.");
    if (!integer(state.adaptiveSampleLimit) || state.adaptiveSampleLimit < 16 || state.adaptiveSampleLimit > 256) reject("MOTION_ADAPTIVE_LIMIT_INVALID", "adaptiveSampleLimit must be an integer from 16 through 256.");
  }
  function readCompMotion(comp) {
    return { compMotion: { comp: { stableId: itemStableId(comp), hostId: hostIdOf(comp), name: comp.name }, state: { motionBlur: comp.motionBlur === true, frameBlending: comp.frameBlending === true, shutterAngle: comp.shutterAngle, shutterPhase: comp.shutterPhase, samplesPerFrame: comp.motionBlurSamplesPerFrame, adaptiveSampleLimit: comp.motionBlurAdaptiveSampleLimit } } };
  }
  function sameCompMotion(a, b) {
    return a.motionBlur === b.motionBlur && a.frameBlending === b.frameBlending && a.shutterAngle === b.shutterAngle && a.shutterPhase === b.shutterPhase && a.samplesPerFrame === b.samplesPerFrame && a.adaptiveSampleLimit === b.adaptiveSampleLimit;
  }
  function setCompMotion(comp, state) {
    comp.motionBlur = state.motionBlur;
    comp.frameBlending = state.frameBlending;
    comp.shutterAngle = state.shutterAngle;
    comp.shutterPhase = state.shutterPhase;
    comp.motionBlurSamplesPerFrame = state.samplesPerFrame;
    comp.motionBlurAdaptiveSampleLimit = state.adaptiveSampleLimit;
  }

  function frameBlendingName(value) {
    if (value === FrameBlendingType.FRAME_MIX) return "FRAME_MIX";
    if (value === FrameBlendingType.PIXEL_MOTION) return "PIXEL_MOTION";
    return "NO_FRAME_BLEND";
  }
  function frameBlendingEnum(name) {
    if (name === "FRAME_MIX") return FrameBlendingType.FRAME_MIX;
    if (name === "PIXEL_MOTION") return FrameBlendingType.PIXEL_MOTION;
    if (name === "NO_FRAME_BLEND") return FrameBlendingType.NO_FRAME_BLEND;
    reject("FRAME_BLENDING_TYPE_INVALID", "frameBlendingType must be NO_FRAME_BLEND, FRAME_MIX, or PIXEL_MOTION.");
  }
  function validateLayerMotionState(state) {
    if (!state || typeof state !== "object" || state instanceof Array) reject("LAYER_MOTION_STATE_REQUIRED", "state must be an object.");
    if (typeof state.motionBlur !== "boolean") reject("LAYER_MOTION_BLUR_INVALID", "motionBlur must be boolean.");
    frameBlendingEnum(state.frameBlendingType);
  }
  function requireAvLayer(layer) {
    if (!(layer instanceof AVLayer)) fail("CAPABILITY_PRECONDITION", "AV_LAYER_REQUIRED", "Layer motion/frame blending controls require an AVLayer.");
  }
  function readLayerMotion(layer) {
    requireAvLayer(layer);
    return { layerMotion: { layer: { stableId: layerStableId(layer), hostId: hostIdOf(layer), index: layer.index, name: layer.name }, state: { motionBlur: layer.motionBlur === true, frameBlendingType: frameBlendingName(layer.frameBlendingType), frameBlending: layer.frameBlending === true } } };
  }
  function sameLayerMotion(a, b) { return a.motionBlur === b.motionBlur && a.frameBlendingType === b.frameBlendingType; }
  function setLayerMotion(layer, state) { layer.motionBlur = state.motionBlur; layer.frameBlendingType = frameBlendingEnum(state.frameBlendingType); }

  function response(request, outcome, error, affected, readbackValue, started, notes) {
    return $.global.EditFlow2_JSON.stringify({ protocolVersion: PROTOCOL, requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId, capabilityId: request.capabilityId, command: request.command, outcome: outcome, error: error, affectedObjects: affected || [], readback: readbackValue || null, hostProjectRevision: app.project ? app.project.revision : null, diagnostics: { adapterProtocolVersion: PROTOCOL, adapterBuild: BUILD, command: request.command, durationMs: nowMs() - started, notes: notes || [] } });
  }
  function errorPayload(error) { return { category: error.editflowCategory || "HOST_FAILURE", code: error.editflowCode || "MARKER_MOTION_HOST_FAILURE", message: asString(error.message || error), details: error.editflowDetails === undefined ? null : error.editflowDetails }; }

  function maybeInjectP4Failure(request) {
    if (request.readbackProfile === "M3_MARKER_MOTION_P4_FAILURE_INJECTION"
        && $.getenv("EDITFLOW_M3_MARKER_MOTION_P4_PROOF") === "1") {
      fail("PROOF_INJECTION", "M3_MARKER_MOTION_P4_INDUCED_FAILURE", "Induced M3 marker-motion P4 failure after verified host mutation.", null);
    }
  }

  function mutationReadback(request, payload) {
    if (request.command === "marker.set" || request.command === "marker.remove") return readMarkers(resolveMarkerTarget(payload.target));
    if (request.command === "comp.motion.set") return readCompMotion(findComp(payload.comp));
    if (request.command === "layer.motion.set") {
      var comp = findComp(payload.comp), layer = findLayer(comp, payload.layer);
      return readLayerMotion(layer);
    }
    return null;
  }

  function success(request, affected, readbackValue, started, note) {
    app.endUndoGroup();
    return response(request, "APPLIED", null, affected, readbackValue, started, [note]);
  }

  function noOp(request, readbackValue, started, note) {
    app.endUndoGroup();
    return response(request, "NO_OP", null, [], readbackValue, started, [note]);
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) { return previousDispatch(requestJson); }
    if (!request || request.protocolVersion !== PROTOCOL || !CAPABILITIES[request.command]) return previousDispatch(requestJson);
    var started = nowMs(), payload = request.payload || {}, before, after, comp, layer, resolved, affected;
    var mutationStarted = false, undoOpen = false;
    try {
      if (request.capabilityId !== CAPABILITIES[request.command]) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match the marker-motion command.");

      if (request.command === "marker.readback") {
        resolved = resolveMarkerTarget(payload.target);
        return response(request, "NO_OP", null, [], readMarkers(resolved), started, ["Read-only marker structural readback."]);
      }
      if (request.command === "comp.motion.readback") {
        comp = findComp(payload.comp);
        return response(request, "NO_OP", null, [], readCompMotion(comp), started, ["Read-only composition motion/shutter readback."]);
      }
      if (request.command === "layer.motion.readback") {
        comp = findComp(payload.comp); layer = findLayer(comp, payload.layer);
        return response(request, "NO_OP", null, [], readLayerMotion(layer), started, ["Read-only layer motion/frame-blending readback."]);
      }

      requireExpectedRevision(request);
      app.beginUndoGroup("EditFlow marker-motion controls");
      undoOpen = true;

      if (request.command === "marker.set") {
        if (!finiteNumber(payload.time)) reject("MARKER_TIME_INVALID", "Marker time must be a finite number.");
        resolved = resolveMarkerTarget(payload.target);
        before = readMarkers(resolved);
        var requestedMarker = makeMarker(payload.marker, resolved.kind), existingIndex = resolved.property.numKeys > 0 ? resolved.property.nearestKeyIndex(payload.time) : 0;
        if (existingIndex >= 1 && Math.abs(resolved.property.keyTime(existingIndex) - payload.time) < 0.000001
            && sameMarkerState(markerState(resolved.property.keyValue(existingIndex)), markerState(requestedMarker))) {
          undoOpen = false;
          return noOp(request, before, started, "Requested marker already matched host state at the target time.");
        }
        mutationStarted = true;
        resolved.property.setValueAtTime(payload.time, requestedMarker);
        after = readMarkers(resolved);
        affected = resolved.layer ? [{ kind: "LAYER", stableId: layerStableId(resolved.layer), hostId: hostIdOf(resolved.layer) }] : [{ kind: "COMP", stableId: itemStableId(resolved.comp), hostId: hostIdOf(resolved.comp) }];
        if (after.markers.length < 1) fail("READBACK", "MARKER_SET_READBACK_MISMATCH", "Marker write did not produce marker readback.");
        maybeInjectP4Failure(request);
        undoOpen = false;
        return success(request, affected, after, started, "Marker set and structurally read back.");
      }
      if (request.command === "marker.remove") {
        resolved = resolveMarkerTarget(payload.target);
        if (!integer(payload.keyIndex) || payload.keyIndex < 1 || payload.keyIndex > resolved.property.numKeys) reject("MARKER_KEY_INDEX_INVALID", "keyIndex must address an existing marker.");
        mutationStarted = true;
        resolved.property.removeKey(payload.keyIndex);
        after = readMarkers(resolved);
        affected = resolved.layer ? [{ kind: "LAYER", stableId: layerStableId(resolved.layer), hostId: hostIdOf(resolved.layer) }] : [{ kind: "COMP", stableId: itemStableId(resolved.comp), hostId: hostIdOf(resolved.comp) }];
        maybeInjectP4Failure(request);
        undoOpen = false;
        return success(request, affected, after, started, "Marker removed and structurally read back.");
      }
      if (request.command === "comp.motion.set") {
        comp = findComp(payload.comp); validateCompMotionState(payload.state);
        before = readCompMotion(comp).compMotion.state;
        if (sameCompMotion(before, payload.state)) {
          undoOpen = false;
          return noOp(request, readCompMotion(comp), started, "Requested composition motion state already matched host state.");
        }
        mutationStarted = true;
        setCompMotion(comp, payload.state); after = readCompMotion(comp).compMotion.state;
        if (!sameCompMotion(after, payload.state)) fail("READBACK", "COMP_MOTION_READBACK_MISMATCH", "Composition motion write did not match readback.", { expected: payload.state, actual: after });
        maybeInjectP4Failure(request);
        undoOpen = false;
        return success(request, [{ kind: "COMP", stableId: itemStableId(comp), hostId: hostIdOf(comp) }], readCompMotion(comp), started, "Composition motion/frame-blending/shutter state applied and read back.");
      }
      if (request.command === "layer.motion.set") {
        comp = findComp(payload.comp); layer = findLayer(comp, payload.layer); requireAvLayer(layer); validateLayerMotionState(payload.state);
        before = readLayerMotion(layer).layerMotion.state;
        if (sameLayerMotion(before, payload.state)) {
          undoOpen = false;
          return noOp(request, readLayerMotion(layer), started, "Requested layer motion state already matched host state.");
        }
        mutationStarted = true;
        setLayerMotion(layer, payload.state); after = readLayerMotion(layer).layerMotion.state;
        if (!sameLayerMotion(after, payload.state)) fail("READBACK", "LAYER_MOTION_READBACK_MISMATCH", "Layer motion write did not match readback.", { expected: payload.state, actual: after });
        maybeInjectP4Failure(request);
        undoOpen = false;
        return success(request, [{ kind: "LAYER", stableId: layerStableId(layer), hostId: hostIdOf(layer) }], readLayerMotion(layer), started, "Layer motion blur/frame-blending state applied and read back.");
      }
      reject("COMMAND_NOT_IMPLEMENTED", "Marker-motion command is not implemented.");
    } catch (error) {
      if (undoOpen) {
        try { app.endUndoGroup(); } catch (_) {}
        undoOpen = false;
      }
      if (mutationStarted) {
        var rollbackError = null, restoredReadback = null;
        try { app.executeCommand(16); } catch (undoError) { rollbackError = undoError; }
        if (rollbackError) {
          return response(request, "FAILED", { category: "ROLLBACK_FAILURE", code: "MARKER_MOTION_ROLLBACK_FAILED", message: asString(rollbackError), details: { mutationError: errorPayload(error) } }, [], null, started, ["Marker-motion mutation failed and transaction undo rollback also failed."]);
        }
        try { restoredReadback = mutationReadback(request, payload); } catch (_) { restoredReadback = null; }
        return response(request, "FAILED", errorPayload(error), [], restoredReadback, started, ["Marker-motion mutation failed after a host write and was rolled back through the transaction undo boundary."]);
      }
      return response(request, error.editflowCategory === "VALIDATION" || error.editflowCategory === "CONFLICT" || error.editflowCategory === "CAPABILITY_PRECONDITION" ? "REJECTED" : "FAILED", errorPayload(error), [], null, started, ["Protocol 2.0 marker-motion command failed closed before a host mutation began."]);
    }
  };

  $.global.EditFlow2_HOST_PROTOCOL_20 = true;
}());