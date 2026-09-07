/* EditFlow 2.0 M3 layer switches and quality controls host layer.
 * Fixed typed protocol 1.6 commands only. No arbitrary code execution.
 * Layer ordering remains owned by the already-proven protocol 1.1 layer.reorder route.
 * Motion blur and frame blending remain separate roadmap capabilities.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("EditFlow M3 layer-controls layer requires the existing dispatcher.");

  var PROTOCOL = "1.6.0";
  var BUILD = "0.4.0-dev.6";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var CAPABILITIES = {
    "layer.controls.set": "ae.layer.controls.set",
    "layer.controls.readback": "ae.layer.controls.readback",
    "comp.layer_controls.set": "ae.comp.layer_controls.set",
    "comp.layer_controls.readback": "ae.comp.layer_controls.readback"
  };
  var LAYER_CONTROL_KEYS = {
    enabled: true,
    solo: true,
    shy: true,
    locked: true,
    audioEnabled: true,
    adjustmentLayer: true,
    collapseTransformation: true,
    effectsActive: true,
    guideLayer: true,
    preserveTransparency: true,
    quality: true,
    samplingQuality: true,
    threeDLayer: true
  };
  var AV_ONLY_KEYS = {
    audioEnabled: true,
    adjustmentLayer: true,
    collapseTransformation: true,
    effectsActive: true,
    guideLayer: true,
    preserveTransparency: true,
    quality: true,
    samplingQuality: true,
    threeDLayer: true
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
  function itemHostId(item) { try { return typeof item.id === "number" ? item.id : null; } catch (_) { return null; } }
  function layerHostId(layer) { try { return typeof layer.id === "number" ? layer.id : null; } catch (_) { return null; } }

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

  function isAvLayer(layer) {
    try {
      var ignored = layer.quality;
      return ignored !== undefined;
    } catch (_) {
      return false;
    }
  }
  function layerRef(layer) {
    return {
      stableId: layerStableId(layer),
      hostId: layerHostId(layer),
      index: layer.index,
      name: layer.name
    };
  }
  function compRef(comp) {
    return {
      stableId: itemStableId(comp),
      hostId: itemHostId(comp),
      name: comp.name
    };
  }

  function qualityName(value) {
    try {
      if (value === LayerQuality.BEST) return "BEST";
      if (value === LayerQuality.DRAFT) return "DRAFT";
      if (value === LayerQuality.WIREFRAME) return "WIREFRAME";
    } catch (_) {}
    return null;
  }
  function qualityValue(name) {
    if (name === "BEST") return LayerQuality.BEST;
    if (name === "DRAFT") return LayerQuality.DRAFT;
    if (name === "WIREFRAME") return LayerQuality.WIREFRAME;
    reject("LAYER_QUALITY_INVALID", "quality must be BEST, DRAFT, or WIREFRAME.");
  }
  function samplingQualityName(value) {
    try {
      if (value === LayerSamplingQuality.BICUBIC) return "BICUBIC";
      if (value === LayerSamplingQuality.BILINEAR) return "BILINEAR";
    } catch (_) {}
    return null;
  }
  function samplingQualityValue(name) {
    if (typeof LayerSamplingQuality === "undefined") {
      reject("LAYER_SAMPLING_QUALITY_UNAVAILABLE", "LayerSamplingQuality is unavailable in this After Effects host.");
    }
    if (name === "BICUBIC") return LayerSamplingQuality.BICUBIC;
    if (name === "BILINEAR") return LayerSamplingQuality.BILINEAR;
    reject("LAYER_SAMPLING_QUALITY_INVALID", "samplingQuality must be BILINEAR or BICUBIC.");
  }

  function safeBooleanRead(layer, key) {
    try { return layer[key] === true; } catch (_) { return null; }
  }
  function avReadback(layer) {
    var av = isAvLayer(layer);
    if (!av) return null;
    var hasAudio = false;
    var canSetCollapseTransformation = false;
    try { hasAudio = layer.hasAudio === true; } catch (_) {}
    try { canSetCollapseTransformation = layer.canSetCollapseTransformation === true; } catch (_) {}
    return {
      audioEnabled: safeBooleanRead(layer, "audioEnabled"),
      adjustmentLayer: safeBooleanRead(layer, "adjustmentLayer"),
      collapseTransformation: safeBooleanRead(layer, "collapseTransformation"),
      effectsActive: safeBooleanRead(layer, "effectsActive"),
      guideLayer: safeBooleanRead(layer, "guideLayer"),
      preserveTransparency: safeBooleanRead(layer, "preserveTransparency"),
      quality: qualityName(layer.quality),
      samplingQuality: samplingQualityName(layer.samplingQuality),
      threeDLayer: safeBooleanRead(layer, "threeDLayer"),
      hasAudio: hasAudio,
      canSetCollapseTransformation: canSetCollapseTransformation
    };
  }
  function layerControlsReadback(comp, layer) {
    var canSetEnabled = true;
    try { canSetEnabled = layer.canSetEnabled === true; } catch (_) { canSetEnabled = true; }
    return {
      layerControls: {
        comp: compRef(comp),
        layer: layerRef(layer),
        isAVLayer: isAvLayer(layer),
        controls: {
          enabled: safeBooleanRead(layer, "enabled"),
          solo: safeBooleanRead(layer, "solo"),
          shy: safeBooleanRead(layer, "shy"),
          locked: safeBooleanRead(layer, "locked"),
          av: avReadback(layer)
        },
        availability: {
          canSetEnabled: canSetEnabled
        }
      }
    };
  }
  function compLayerControlsReadback(comp) {
    return {
      compLayerControls: {
        comp: compRef(comp),
        hideShyLayers: comp.hideShyLayers === true
      }
    };
  }

  function errorPayload(error) {
    return {
      category: error && error.editflowCategory ? error.editflowCategory : "ADAPTER_FAILURE",
      code: error && error.editflowCode ? error.editflowCode : "M3_LAYER_CONTROLS_HOST_FAILURE",
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
      diagnostics: {
        adapterProtocolVersion: PROTOCOL,
        adapterBuild: BUILD,
        command: request.command,
        durationMs: nowMs() - startedAt,
        notes: notes || []
      }
    };
  }
  function affectedLayer(layer) { return { kind: "LAYER", stableId: layerStableId(layer), hostId: layerHostId(layer) }; }
  function affectedComp(comp) { return { kind: "COMP", stableId: itemStableId(comp), hostId: itemHostId(comp) }; }

  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") reject("EXPECTED_HOST_REVISION_REQUIRED", "Mutating layer-control commands require expectedHostProjectRevision.");
    var actual = app.project ? app.project.revision : null;
    if (actual !== request.expectedHostProjectRevision) {
      conflict("HOST_REVISION_CONFLICT", "Host project revision does not match the expected revision.", {
        expectedHostProjectRevision: request.expectedHostProjectRevision,
        actualHostProjectRevision: actual
      });
    }
  }
  function requirePayloadObject(request) {
    if (!request.payload || typeof request.payload !== "object") reject("PAYLOAD_REQUIRED", "Layer-controls payload object is required.");
  }
  function validateRequestEnvelope(request) {
    if (!request || typeof request !== "object") reject("REQUEST_REQUIRED", "Protocol 1.6 request object is required.");
    if (!own(CAPABILITIES, request.command)) reject("LAYER_CONTROLS_COMMAND_UNSUPPORTED", "Unsupported protocol 1.6 layer-controls command: " + asString(request.command));
    if (request.capabilityId !== CAPABILITIES[request.command]) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match the layer-controls command.");
    requirePayloadObject(request);
    if (!request.payload.comp) reject("LAYER_CONTROLS_COMP_REQUIRED", "Layer-controls payload requires a comp reference.");
  }

  function validateLayerControlsPatch(controls) {
    if (!controls || typeof controls !== "object") reject("LAYER_CONTROLS_PATCH_REQUIRED", "layer.controls.set requires a controls object.");
    var count = 0;
    var key;
    for (key in controls) {
      if (!own(controls, key)) continue;
      count += 1;
      if (!own(LAYER_CONTROL_KEYS, key)) reject("LAYER_CONTROL_UNKNOWN", "Unsupported layer control: " + key, { key: key });
      if (key === "quality") {
        if (controls[key] !== "BEST" && controls[key] !== "DRAFT" && controls[key] !== "WIREFRAME") reject("LAYER_QUALITY_INVALID", "quality must be BEST, DRAFT, or WIREFRAME.");
      } else if (key === "samplingQuality") {
        if (controls[key] !== "BILINEAR" && controls[key] !== "BICUBIC") reject("LAYER_SAMPLING_QUALITY_INVALID", "samplingQuality must be BILINEAR or BICUBIC.");
      } else if (typeof controls[key] !== "boolean") {
        reject("LAYER_CONTROL_TYPE_INVALID", key + " must be a boolean.", { key: key });
      }
    }
    if (count === 0) reject("LAYER_CONTROLS_PATCH_EMPTY", "layer.controls.set requires at least one requested control.");
  }
  function validateCompControlsPatch(controls) {
    if (!controls || typeof controls !== "object") reject("COMP_LAYER_CONTROLS_PATCH_REQUIRED", "comp.layer_controls.set requires a controls object.");
    var count = 0;
    var key;
    for (key in controls) {
      if (!own(controls, key)) continue;
      count += 1;
      if (key !== "hideShyLayers") reject("COMP_LAYER_CONTROL_UNKNOWN", "Unsupported comp layer control: " + key, { key: key });
      if (typeof controls[key] !== "boolean") reject("COMP_LAYER_CONTROL_TYPE_INVALID", key + " must be a boolean.", { key: key });
    }
    if (count === 0) reject("COMP_LAYER_CONTROLS_PATCH_EMPTY", "comp.layer_controls.set requires at least one requested control.");
  }
  function hasAvOnlyRequest(controls) {
    var key;
    for (key in controls) if (own(controls, key) && own(AV_ONLY_KEYS, key)) return true;
    return false;
  }
  function hasNonLockRequest(controls) {
    var key;
    for (key in controls) if (own(controls, key) && key !== "locked") return true;
    return false;
  }

  function flatControlValue(readback, key) {
    var record = readback.layerControls.controls;
    if (key === "enabled" || key === "solo" || key === "shy" || key === "locked") return record[key];
    return record.av ? record.av[key] : null;
  }
  function layerPatchMatches(readback, controls) {
    var key;
    for (key in controls) {
      if (!own(controls, key)) continue;
      if (flatControlValue(readback, key) !== controls[key]) return false;
    }
    return true;
  }
  function compPatchMatches(readback, controls) {
    return !own(controls, "hideShyLayers") || readback.compLayerControls.hideShyLayers === controls.hideShyLayers;
  }

  function preflightLayerMutation(layer, controls) {
    var before = layerControlsReadback(layer.containingComp, layer);
    if (layerPatchMatches(before, controls)) return before;
    if (!isAvLayer(layer) && hasAvOnlyRequest(controls)) reject("LAYER_CONTROL_REQUIRES_AV_LAYER", "One or more requested controls apply only to AV layers.");

    if (before.layerControls.controls.locked === true && hasNonLockRequest(controls)) {
      if (!own(controls, "locked") || controls.locked !== false) {
        conflict("LAYER_LOCKED", "The layer is locked. Explicitly request locked:false in the same patch before changing other controls.");
      }
    }
    if (own(controls, "enabled") && before.layerControls.controls.enabled !== controls.enabled && before.layerControls.availability.canSetEnabled !== true) {
      reject("LAYER_ENABLED_NOT_SETTABLE", "This layer does not allow its enabled switch to be changed.");
    }
    if (own(controls, "audioEnabled") && before.layerControls.controls.av.audioEnabled !== controls.audioEnabled && before.layerControls.controls.av.hasAudio !== true) {
      reject("LAYER_AUDIO_SWITCH_UNAVAILABLE", "audioEnabled cannot be changed because this layer has no audio.");
    }
    if (own(controls, "collapseTransformation") && before.layerControls.controls.av.collapseTransformation !== controls.collapseTransformation && before.layerControls.controls.av.canSetCollapseTransformation !== true) {
      reject("LAYER_COLLAPSE_TRANSFORMATION_NOT_SETTABLE", "This layer does not allow collapseTransformation to be changed.");
    }
    if (own(controls, "quality")) qualityValue(controls.quality);
    if (own(controls, "samplingQuality")) samplingQualityValue(controls.samplingQuality);
    return before;
  }

  function applyLayerControls(layer, controls) {
    if (layer.locked === true && own(controls, "locked") && controls.locked === false) layer.locked = false;

    if (own(controls, "enabled")) layer.enabled = controls.enabled;
    if (own(controls, "solo")) layer.solo = controls.solo;
    if (own(controls, "shy")) layer.shy = controls.shy;

    if (isAvLayer(layer)) {
      if (own(controls, "audioEnabled")) layer.audioEnabled = controls.audioEnabled;
      if (own(controls, "adjustmentLayer")) layer.adjustmentLayer = controls.adjustmentLayer;
      if (own(controls, "collapseTransformation")) layer.collapseTransformation = controls.collapseTransformation;
      if (own(controls, "effectsActive")) layer.effectsActive = controls.effectsActive;
      if (own(controls, "guideLayer")) layer.guideLayer = controls.guideLayer;
      if (own(controls, "preserveTransparency")) layer.preserveTransparency = controls.preserveTransparency;
      if (own(controls, "quality")) layer.quality = qualityValue(controls.quality);
      if (own(controls, "samplingQuality")) layer.samplingQuality = samplingQualityValue(controls.samplingQuality);
      if (own(controls, "threeDLayer")) layer.threeDLayer = controls.threeDLayer;
    }

    if (own(controls, "locked")) layer.locked = controls.locked;
  }

  function execute(request) {
    var startedAt = nowMs();
    try { validateRequestEnvelope(request); }
    catch (envelopeError) { return responseFor(request, "REJECTED", errorPayload(envelopeError), [], null, startedAt, ["Layer-controls request rejected before target resolution."]); }

    var comp;
    var layer = null;
    try {
      comp = findComp(request.payload.comp);
      if (request.command.indexOf("layer.controls.") === 0) {
        if (!request.payload.layer) reject("LAYER_CONTROLS_LAYER_REQUIRED", "Layer command requires a layer reference.");
        layer = findLayer(comp, request.payload.layer);
      }
    } catch (targetError) {
      return responseFor(request, "REJECTED", errorPayload(targetError), [], null, startedAt, ["Layer-controls target resolution failed before mutation."]);
    }

    if (request.command === "layer.controls.readback") {
      try { return responseFor(request, "NO_OP", null, [], layerControlsReadback(comp, layer), startedAt, ["Read-only layer switch, quality, availability, and order-index readback."]); }
      catch (readbackError) { return responseFor(request, "FAILED", errorPayload(readbackError), [], null, startedAt, ["Layer-controls readback failed without mutation."]); }
    }
    if (request.command === "comp.layer_controls.readback") {
      try { return responseFor(request, "NO_OP", null, [], compLayerControlsReadback(comp), startedAt, ["Read-only composition master layer-controls readback."]); }
      catch (compReadbackError) { return responseFor(request, "FAILED", errorPayload(compReadbackError), [], null, startedAt, ["Composition layer-controls readback failed without mutation."]); }
    }

    try { requireExpectedRevision(request); }
    catch (revisionError) {
      return responseFor(request, "REJECTED", errorPayload(revisionError), [], layer ? layerControlsReadback(comp, layer) : compLayerControlsReadback(comp), startedAt, ["Layer-controls mutation rejected on stale or missing host revision."]);
    }

    var controls;
    var before;
    try {
      controls = request.payload.controls;
      if (request.command === "layer.controls.set") {
        validateLayerControlsPatch(controls);
        before = preflightLayerMutation(layer, controls);
        if (layerPatchMatches(before, controls)) return responseFor(request, "NO_OP", null, [], before, startedAt, ["Requested layer-control state already matches exact host readback."]);
      } else {
        validateCompControlsPatch(controls);
        before = compLayerControlsReadback(comp);
        if (compPatchMatches(before, controls)) return responseFor(request, "NO_OP", null, [], before, startedAt, ["Requested composition layer-control state already matches exact host readback."]);
      }
    } catch (preflightError) {
      return responseFor(request, "REJECTED", errorPayload(preflightError), [], before || (layer ? layerControlsReadback(comp, layer) : compLayerControlsReadback(comp)), startedAt, ["Layer-controls mutation rejected during complete preflight."]);
    }

    var groupOpen = false;
    var mutationAttempted = false;
    try {
      app.beginUndoGroup("EditFlow M3 layer controls");
      groupOpen = true;
      mutationAttempted = true;
      if (request.command === "layer.controls.set") applyLayerControls(layer, controls);
      else comp.hideShyLayers = controls.hideShyLayers;

      var after = layer ? layerControlsReadback(comp, layer) : compLayerControlsReadback(comp);
      var matched = layer ? layerPatchMatches(after, controls) : compPatchMatches(after, controls);
      if (!matched) fail("ADAPTER_FAILURE", "LAYER_CONTROLS_READBACK_MISMATCH", "Layer-controls mutation did not read back exactly as requested.", { requested: controls, actual: after });

      app.endUndoGroup();
      groupOpen = false;
      return responseFor(request, "APPLIED", null, [layer ? affectedLayer(layer) : affectedComp(comp)], after, startedAt, ["Typed layer-controls mutation applied and exact readback verified. Layer ordering was not changed by protocol 1.6."]);
    } catch (mutationError) {
      if (groupOpen) {
        try { app.endUndoGroup(); } catch (_) {}
        groupOpen = false;
      }
      var rollbackNotes = [];
      if (mutationAttempted) {
        try {
          app.executeCommand(16);
          rollbackNotes.push("Failed layer-controls mutation self-rolled back with AE Undo.");
        } catch (undoError) {
          rollbackNotes.push("AE Undo rollback failed: " + asString(undoError));
        }
      }
      var restored = null;
      try { restored = layer ? layerControlsReadback(comp, layer) : compLayerControlsReadback(comp); } catch (_) {}
      return responseFor(request, "FAILED", errorPayload(mutationError), [], restored, startedAt, rollbackNotes);
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
