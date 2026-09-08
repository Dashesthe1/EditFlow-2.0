/* EditFlow 2.0 M3 motion blur + frame blending rendering-controls host layer.
 * Fixed typed protocol 1.10 commands only. No arbitrary code execution.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("EditFlow M3 motion-render layer requires the existing dispatcher.");

  var PROTOCOL = "1.10.0";
  var BUILD = "0.4.0-dev.10";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var CAPABILITIES = {
    "comp.motion_render.set": "ae.comp.motion_render.set",
    "layer.motion_render.set": "ae.layer.motion_render.set",
    "motion_render.readback": "ae.motion_render.readback"
  };
  var COMP_KEYS = {
    motionBlur: true,
    frameBlending: true,
    shutterAngle: true,
    shutterPhase: true,
    samplesPerFrame: true,
    adaptiveSampleLimit: true
  };
  var LAYER_KEYS = {
    motionBlur: true,
    frameBlendingType: true
  };

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
  function itemStableId(item) { try { return stableIdFromText(item.comment); } catch (_) { return null; } }
  function layerStableId(layer) { try { return stableIdFromText(layer.comment); } catch (_) { return null; } }
  function hostIdOf(object) { try { return typeof object.id === "number" ? object.id : null; } catch (_) { return null; } }

  function findItem(ref) {
    if (!ref || typeof ref !== "object") reject("OBJECT_REF_REQUIRED", "Object reference is required.");
    var project = app.project;
    var i, item;
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
  function compRef(comp) { return { stableId: itemStableId(comp), hostId: hostIdOf(comp), name: comp.name }; }
  function layerRef(layer) { return { stableId: layerStableId(layer), hostId: hostIdOf(layer), index: layer.index, name: layer.name }; }

  function frameBlendingTypeName(value) {
    try {
      if (value === FrameBlendingType.NO_FRAME_BLEND) return "NO_FRAME_BLEND";
      if (value === FrameBlendingType.FRAME_MIX) return "FRAME_MIX";
      if (value === FrameBlendingType.PIXEL_MOTION) return "PIXEL_MOTION";
    } catch (_) {}
    return null;
  }
  function frameBlendingTypeValue(name) {
    if (name === "NO_FRAME_BLEND") return FrameBlendingType.NO_FRAME_BLEND;
    if (name === "FRAME_MIX") return FrameBlendingType.FRAME_MIX;
    return FrameBlendingType.PIXEL_MOTION;
  }
  function readBoolean(object, key) { try { return typeof object[key] === "boolean" ? object[key] === true : null; } catch (_) { return null; } }
  function readNumber(object, key) { try { return typeof object[key] === "number" ? Number(object[key]) : null; } catch (_) { return null; } }
  function readFrameBlendingType(layer) { try { return frameBlendingTypeName(layer.frameBlendingType); } catch (_) { return null; } }

  function compReadback(comp) {
    return {
      comp: compRef(comp),
      supported: {
        motionBlur: readBoolean(comp, "motionBlur") !== null,
        frameBlending: readBoolean(comp, "frameBlending") !== null,
        shutterAngle: readNumber(comp, "shutterAngle") !== null,
        shutterPhase: readNumber(comp, "shutterPhase") !== null,
        samplesPerFrame: readNumber(comp, "motionBlurSamplesPerFrame") !== null,
        adaptiveSampleLimit: readNumber(comp, "motionBlurAdaptiveSampleLimit") !== null
      },
      values: {
        motionBlur: readBoolean(comp, "motionBlur"),
        frameBlending: readBoolean(comp, "frameBlending"),
        shutterAngle: readNumber(comp, "shutterAngle"),
        shutterPhase: readNumber(comp, "shutterPhase"),
        samplesPerFrame: readNumber(comp, "motionBlurSamplesPerFrame"),
        adaptiveSampleLimit: readNumber(comp, "motionBlurAdaptiveSampleLimit")
      }
    };
  }
  function layerReadback(layer) {
    var type = readFrameBlendingType(layer);
    return {
      layer: layerRef(layer),
      supported: {
        motionBlur: readBoolean(layer, "motionBlur") !== null,
        frameBlendingType: type !== null
      },
      values: {
        motionBlur: readBoolean(layer, "motionBlur"),
        frameBlending: readBoolean(layer, "frameBlending"),
        frameBlendingType: type
      }
    };
  }
  function combinedReadback(comp, layer) {
    return { motionRender: { composition: compReadback(comp), layer: layer ? layerReadback(layer) : null } };
  }

  function affectedComp(comp) { return { kind: "COMP", stableId: itemStableId(comp), hostId: hostIdOf(comp) }; }
  function affectedLayer(layer) { return { kind: "LAYER", stableId: layerStableId(layer), hostId: hostIdOf(layer) }; }
  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") reject("EXPECTED_HOST_REVISION_REQUIRED", "Mutating protocol 1.10 commands require expectedHostProjectRevision.");
    var actual = app.project ? app.project.revision : null;
    if (actual !== request.expectedHostProjectRevision) conflict("HOST_REVISION_CONFLICT", "Host project revision does not match the expected revision.", { expectedHostProjectRevision: request.expectedHostProjectRevision, actualHostProjectRevision: actual });
  }
  function errorPayload(error) {
    return {
      category: error && error.editflowCategory ? error.editflowCategory : "ADAPTER_FAILURE",
      code: error && error.editflowCode ? error.editflowCode : "M3_MOTION_RENDER_HOST_FAILURE",
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

  function requireSettings(settings, command) {
    if (!settings || typeof settings !== "object") reject("MOTION_RENDER_SETTINGS_REQUIRED", command + " requires a settings object.");
    var count = 0;
    var key;
    for (key in settings) if (own(settings, key)) count += 1;
    if (count === 0) reject("MOTION_RENDER_SETTINGS_EMPTY", command + " requires at least one setting.");
  }
  function requireIntegerInRange(value, min, max, code, label) {
    if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value || value < min || value > max) {
      reject(code, label + " must be an integer in the range [" + min + ".." + max + "].", { value: value });
    }
  }
  function validateCompSettings(comp, settings) {
    requireSettings(settings, "comp.motion_render.set");
    var supported = compReadback(comp).supported;
    var key;
    for (key in settings) if (own(settings, key)) {
      if (!own(COMP_KEYS, key)) reject("COMP_MOTION_RENDER_SETTING_UNKNOWN", "Unknown composition motion-render setting: " + key, { setting: key });
      if (!supported[key]) fail("CAPABILITY_UNAVAILABLE", "COMP_MOTION_RENDER_SETTING_UNSUPPORTED", "Requested composition motion-render setting is unavailable.", { setting: key });
      if (key === "motionBlur" || key === "frameBlending") {
        if (typeof settings[key] !== "boolean") reject("COMP_MOTION_RENDER_BOOLEAN_REQUIRED", key + " must be boolean.");
      } else if (key === "shutterAngle") requireIntegerInRange(settings[key], 0, 720, "SHUTTER_ANGLE_INVALID", "shutterAngle");
      else if (key === "shutterPhase") requireIntegerInRange(settings[key], -360, 360, "SHUTTER_PHASE_INVALID", "shutterPhase");
      else if (key === "samplesPerFrame") requireIntegerInRange(settings[key], 2, 64, "MOTION_BLUR_SAMPLES_INVALID", "samplesPerFrame");
      else if (key === "adaptiveSampleLimit") requireIntegerInRange(settings[key], 16, 256, "MOTION_BLUR_ADAPTIVE_LIMIT_INVALID", "adaptiveSampleLimit");
    }
  }
  function validateLayerSettings(layer, settings) {
    requireSettings(settings, "layer.motion_render.set");
    var supported = layerReadback(layer).supported;
    var key;
    for (key in settings) if (own(settings, key)) {
      if (!own(LAYER_KEYS, key)) reject("LAYER_MOTION_RENDER_SETTING_UNKNOWN", "Unknown layer motion-render setting: " + key, { setting: key });
      if (!supported[key]) fail("CAPABILITY_UNAVAILABLE", "LAYER_MOTION_RENDER_SETTING_UNSUPPORTED", "Requested layer motion-render setting is unavailable on the target layer.", { setting: key, layer: layerRef(layer) });
      if (key === "motionBlur" && typeof settings[key] !== "boolean") reject("LAYER_MOTION_BLUR_BOOLEAN_REQUIRED", "motionBlur must be boolean.");
      if (key === "frameBlendingType" && settings[key] !== "NO_FRAME_BLEND" && settings[key] !== "FRAME_MIX" && settings[key] !== "PIXEL_MOTION") {
        reject("FRAME_BLENDING_TYPE_INVALID", "frameBlendingType must be NO_FRAME_BLEND, FRAME_MIX, or PIXEL_MOTION.");
      }
    }
  }

  function compValuesMatch(comp, settings) {
    var values = compReadback(comp).values;
    var key;
    for (key in settings) if (own(settings, key) && values[key] !== settings[key]) return false;
    return true;
  }
  function layerValuesMatch(layer, settings) {
    var values = layerReadback(layer).values;
    var key;
    for (key in settings) if (own(settings, key) && values[key] !== settings[key]) return false;
    return true;
  }
  function applyCompSettings(comp, settings) {
    if (own(settings, "motionBlur")) comp.motionBlur = settings.motionBlur;
    if (own(settings, "frameBlending")) comp.frameBlending = settings.frameBlending;
    if (own(settings, "shutterAngle")) comp.shutterAngle = settings.shutterAngle;
    if (own(settings, "shutterPhase")) comp.shutterPhase = settings.shutterPhase;
    if (own(settings, "samplesPerFrame")) comp.motionBlurSamplesPerFrame = settings.samplesPerFrame;
    if (own(settings, "adaptiveSampleLimit")) comp.motionBlurAdaptiveSampleLimit = settings.adaptiveSampleLimit;
  }
  function restoreComp(comp, values) {
    comp.motionBlur = values.motionBlur;
    comp.frameBlending = values.frameBlending;
    comp.shutterAngle = values.shutterAngle;
    comp.shutterPhase = values.shutterPhase;
    comp.motionBlurSamplesPerFrame = values.samplesPerFrame;
    comp.motionBlurAdaptiveSampleLimit = values.adaptiveSampleLimit;
  }
  function applyLayerSettings(layer, settings) {
    var wasLocked = layer.locked === true;
    if (wasLocked) layer.locked = false;
    try {
      if (own(settings, "motionBlur")) layer.motionBlur = settings.motionBlur;
      if (own(settings, "frameBlendingType")) layer.frameBlendingType = frameBlendingTypeValue(settings.frameBlendingType);
    } finally {
      if (wasLocked) layer.locked = true;
    }
  }
  function restoreLayer(layer, values) {
    var wasLocked = layer.locked === true;
    if (wasLocked) layer.locked = false;
    try {
      if (values.motionBlur !== null) layer.motionBlur = values.motionBlur;
      if (values.frameBlendingType !== null) layer.frameBlendingType = frameBlendingTypeValue(values.frameBlendingType);
    } finally {
      if (wasLocked) layer.locked = true;
    }
  }
  function verifyComp(comp, settings) {
    if (!compValuesMatch(comp, settings)) fail("READBACK", "COMP_MOTION_RENDER_READBACK_MISMATCH", "Applied composition motion-render state did not match structural readback.", { expected: settings, actual: compReadback(comp).values });
  }
  function verifyLayer(layer, settings) {
    if (!layerValuesMatch(layer, settings)) fail("READBACK", "LAYER_MOTION_RENDER_READBACK_MISMATCH", "Applied layer motion-render state did not match structural readback.", { expected: settings, actual: layerReadback(layer).values });
    if (own(settings, "frameBlendingType")) {
      var expectedEnabled = settings.frameBlendingType !== "NO_FRAME_BLEND";
      var actualEnabled = layerReadback(layer).values.frameBlending;
      if (actualEnabled !== expectedEnabled) fail("READBACK", "LAYER_FRAME_BLENDING_DERIVED_STATE_MISMATCH", "AE derived frameBlending state did not match frameBlendingType.", { frameBlendingType: settings.frameBlendingType, expectedFrameBlending: expectedEnabled, actualFrameBlending: actualEnabled });
    }
  }

  function parseAndPrepare(request) {
    if (!request || typeof request !== "object") reject("REQUEST_REQUIRED", "Protocol 1.10 request object is required.");
    if (!own(CAPABILITIES, request.command)) reject("MOTION_RENDER_COMMAND_UNSUPPORTED", "Unsupported protocol 1.10 motion-render command: " + asString(request.command));
    if (request.capabilityId !== CAPABILITIES[request.command]) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match the motion-render command.");
    if (!request.payload || typeof request.payload !== "object") reject("PAYLOAD_REQUIRED", "Motion-render payload object is required.");
    if (!request.payload.comp) reject("COMP_REF_REQUIRED", "Motion-render payload requires a comp reference.");
    var comp = findComp(request.payload.comp);
    var layer = request.payload.layer ? findLayer(comp, request.payload.layer) : null;
    if (request.command === "layer.motion_render.set" && !layer) reject("LAYER_REF_REQUIRED", "layer.motion_render.set requires a layer reference.");
    if (request.command === "comp.motion_render.set") validateCompSettings(comp, request.payload.settings);
    if (request.command === "layer.motion_render.set") validateLayerSettings(layer, request.payload.settings);
    return { comp: comp, layer: layer };
  }

  function shouldInjectP4(request, command) {
    return request.readbackProfile === "M3_MOTION_RENDER_P4_FAILURE_INJECTION"
      && $.getenv("EDITFLOW_M3_MOTION_RENDER_P4_PROOF") === "1"
      && request.command === command;
  }

  function dispatchV110(request) {
    var startedAt = nowMs();
    var prepared = null;
    try {
      prepared = parseAndPrepare(request);
      if (request.command === "motion_render.readback") {
        return responseFor(request, "NO_OP", null, prepared.layer ? [affectedComp(prepared.comp), affectedLayer(prepared.layer)] : [affectedComp(prepared.comp)], combinedReadback(prepared.comp, prepared.layer), startedAt, ["Read-only composition/layer motion-render structural readback."]);
      }

      requireExpectedRevision(request);
      if (request.command === "comp.motion_render.set") {
        var beforeComp = compReadback(prepared.comp).values;
        if (compValuesMatch(prepared.comp, request.payload.settings)) return responseFor(request, "NO_OP", null, [affectedComp(prepared.comp)], combinedReadback(prepared.comp, null), startedAt, ["Requested composition motion-render state already matched."]);
        try {
          applyCompSettings(prepared.comp, request.payload.settings);
          verifyComp(prepared.comp, request.payload.settings);
          if (shouldInjectP4(request, "comp.motion_render.set")) {
            fail("PROOF_INJECTION", "M3_MOTION_RENDER_P4_COMP_INDUCED_FAILURE", "Induced M3 motion-render P4 failure after verified composition mutation.", null);
          }
        } catch (compError) {
          try {
            restoreComp(prepared.comp, beforeComp);
            if (!compValuesMatch(prepared.comp, beforeComp)) fail("ROLLBACK", "COMP_MOTION_RENDER_ROLLBACK_MISMATCH", "Composition motion-render rollback did not restore exact prior state.");
          } catch (rollbackCompError) {
            return responseFor(request, "FAILED", errorPayload(rollbackCompError), [affectedComp(prepared.comp)], combinedReadback(prepared.comp, null), startedAt, ["Composition mutation failed and exact rollback could not be verified."]);
          }
          return responseFor(request, "FAILED", errorPayload(compError), [affectedComp(prepared.comp)], combinedReadback(prepared.comp, null), startedAt, ["Composition mutation failed after write; exact prior state was restored."]);
        }
        return responseFor(request, "APPLIED", null, [affectedComp(prepared.comp)], combinedReadback(prepared.comp, null), startedAt, ["Composition motion-render settings applied and verified by structural readback."]);
      }

      var beforeLayer = layerReadback(prepared.layer).values;
      if (layerValuesMatch(prepared.layer, request.payload.settings)) return responseFor(request, "NO_OP", null, [affectedLayer(prepared.layer)], combinedReadback(prepared.comp, prepared.layer), startedAt, ["Requested layer motion-render state already matched."]);
      try {
        applyLayerSettings(prepared.layer, request.payload.settings);
        verifyLayer(prepared.layer, request.payload.settings);
        if (shouldInjectP4(request, "layer.motion_render.set")) {
          fail("PROOF_INJECTION", "M3_MOTION_RENDER_P4_LAYER_INDUCED_FAILURE", "Induced M3 motion-render P4 failure after verified layer mutation.", null);
        }
      } catch (layerError) {
        try {
          restoreLayer(prepared.layer, beforeLayer);
          if (!layerValuesMatch(prepared.layer, { motionBlur: beforeLayer.motionBlur, frameBlendingType: beforeLayer.frameBlendingType })) fail("ROLLBACK", "LAYER_MOTION_RENDER_ROLLBACK_MISMATCH", "Layer motion-render rollback did not restore exact prior state.");
        } catch (rollbackLayerError) {
          return responseFor(request, "FAILED", errorPayload(rollbackLayerError), [affectedLayer(prepared.layer)], combinedReadback(prepared.comp, prepared.layer), startedAt, ["Layer mutation failed and exact rollback could not be verified."]);
        }
        return responseFor(request, "FAILED", errorPayload(layerError), [affectedLayer(prepared.layer)], combinedReadback(prepared.comp, prepared.layer), startedAt, ["Layer mutation failed after write; exact prior state was restored."]);
      }
      return responseFor(request, "APPLIED", null, [affectedLayer(prepared.layer)], combinedReadback(prepared.comp, prepared.layer), startedAt, ["Layer motion blur/frame blending settings applied and verified; frameBlending is read as AE-derived state from frameBlendingType."]);
    } catch (error) {
      var affectedObjects = [];
      try { if (prepared && prepared.comp) affectedObjects.push(affectedComp(prepared.comp)); } catch (_) {}
      try { if (prepared && prepared.layer) affectedObjects.push(affectedLayer(prepared.layer)); } catch (_) {}
      return responseFor(request, error && (error.editflowCategory === "VALIDATION" || error.editflowCategory === "CONFLICT" || error.editflowCategory === "CAPABILITY_UNAVAILABLE") ? "REJECTED" : "FAILED", errorPayload(error), affectedObjects, prepared && prepared.comp ? combinedReadback(prepared.comp, prepared.layer) : null, startedAt, []);
    }
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) { return previousDispatch(requestJson); }
    if (!request || request.protocolVersion !== PROTOCOL) return previousDispatch(requestJson);
    return $.global.EditFlow2_JSON.stringify(dispatchV110(request));
  };
  $.global.EditFlow2_M3_MOTION_RENDER = { protocolVersion: PROTOCOL, build: BUILD };
}());
