/* EditFlow 2.0 M3 layer switches / controls host layer.
 * Fixed typed protocol 1.6 commands only. No arbitrary code execution.
 * Ordering intentionally remains on accepted protocol 1.1 layer.reorder.
 * Blend modes/mattes remain on protocol 1.3. Motion blur/frame blending are
 * intentionally deferred to the later timing/render-controls roadmap tranche.
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
    "layer.switches.set": "ae.layer.switches.set",
    "layer.switches_readback": "ae.layer.switches.readback"
  };
  var SWITCH_KEYS = [
    "enabled",
    "solo",
    "shy",
    "locked",
    "quality",
    "adjustmentLayer",
    "guideLayer",
    "threeDLayer",
    "effectsActive",
    "collapseTransformation",
    "preserveTransparency"
  ];

  function nowMs() { return (new Date()).getTime(); }
  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function own(object, key) { return object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key); }
  function isKnownSwitchKey(key) {
    var i;
    for (i = 0; i < SWITCH_KEYS.length; i += 1) if (SWITCH_KEYS[i] === key) return true;
    return false;
  }
  function fail(category, code, message, details) {
    var error = new Error(message);
    error.editflowCategory = category;
    error.editflowCode = code;
    error.editflowDetails = details === undefined ? null : details;
    throw error;
  }
  function reject(code, message, details) { fail("VALIDATION", code, message, details); }
  function conflict(code, message, details) { fail("CONFLICT", code, message, details); }
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
  function layerRef(layer) {
    return { stableId: layerStableId(layer), hostId: layerHostId(layer), index: layer.index, name: layer.name };
  }

  function booleanProperty(layer, key) {
    try {
      var value = layer[key];
      if (typeof value === "boolean") return { supported: true, value: value };
    } catch (_) {}
    return { supported: false, value: null };
  }
  function qualityProperty(layer) {
    try {
      var value = layer.quality;
      if (typeof LayerQuality !== "undefined") {
        if (value === LayerQuality.BEST) return { supported: true, value: "BEST" };
        if (value === LayerQuality.DRAFT) return { supported: true, value: "DRAFT" };
        if (value === LayerQuality.WIREFRAME) return { supported: true, value: "WIREFRAME" };
      }
    } catch (_) {}
    return { supported: false, value: null };
  }
  function layerSwitchReadback(comp, layer) {
    var enabled = booleanProperty(layer, "enabled");
    var solo = booleanProperty(layer, "solo");
    var shy = booleanProperty(layer, "shy");
    var locked = booleanProperty(layer, "locked");
    var quality = qualityProperty(layer);
    var adjustmentLayer = booleanProperty(layer, "adjustmentLayer");
    var guideLayer = booleanProperty(layer, "guideLayer");
    var threeDLayer = booleanProperty(layer, "threeDLayer");
    var effectsActive = booleanProperty(layer, "effectsActive");
    var collapseTransformation = booleanProperty(layer, "collapseTransformation");
    var preserveTransparency = booleanProperty(layer, "preserveTransparency");
    return {
      layerSwitches: {
        comp: { stableId: itemStableId(comp), hostId: itemHostId(comp), name: comp.name },
        layer: layerRef(layer),
        switches: {
          enabled: enabled.value,
          solo: solo.value,
          shy: shy.value,
          locked: locked.value,
          quality: quality.value,
          adjustmentLayer: adjustmentLayer.value,
          guideLayer: guideLayer.value,
          threeDLayer: threeDLayer.value,
          effectsActive: effectsActive.value,
          collapseTransformation: collapseTransformation.value,
          preserveTransparency: preserveTransparency.value
        },
        applicability: {
          enabled: enabled.supported,
          solo: solo.supported,
          shy: shy.supported,
          locked: locked.supported,
          quality: quality.supported,
          adjustmentLayer: adjustmentLayer.supported,
          guideLayer: guideLayer.supported,
          threeDLayer: threeDLayer.supported,
          effectsActive: effectsActive.supported,
          collapseTransformation: collapseTransformation.supported,
          preserveTransparency: preserveTransparency.supported
        }
      }
    };
  }
  function affected(layer) { return { kind: "LAYER", stableId: layerStableId(layer), hostId: layerHostId(layer) }; }
  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") reject("EXPECTED_HOST_REVISION_REQUIRED", "Mutating layer-switch commands require expectedHostProjectRevision.");
    var actual = app.project ? app.project.revision : null;
    if (actual !== request.expectedHostProjectRevision) conflict("HOST_REVISION_CONFLICT", "Host project revision does not match the expected revision.", { expectedHostProjectRevision: request.expectedHostProjectRevision, actualHostProjectRevision: actual });
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
      diagnostics: { adapterProtocolVersion: PROTOCOL, adapterBuild: BUILD, command: request.command, durationMs: nowMs() - startedAt, notes: notes || [] }
    };
  }

  function validateSwitchPatch(patch) {
    if (!patch || typeof patch !== "object") reject("LAYER_SWITCH_PATCH_REQUIRED", "layer.switches.set requires a switches object.");
    var count = 0;
    var key;
    for (key in patch) {
      if (!own(patch, key)) continue;
      if (!isKnownSwitchKey(key)) reject("LAYER_SWITCH_UNKNOWN", "Unsupported layer switch key: " + key, { key: key });
      count += 1;
      if (key === "quality") {
        if (patch[key] !== "BEST" && patch[key] !== "DRAFT" && patch[key] !== "WIREFRAME") reject("LAYER_QUALITY_INVALID", "quality must be BEST, DRAFT, or WIREFRAME.");
      } else if (typeof patch[key] !== "boolean") {
        reject("LAYER_SWITCH_VALUE_INVALID", "Layer switch values must be booleans.", { key: key });
      }
    }
    if (count === 0) reject("LAYER_SWITCH_PATCH_EMPTY", "layer.switches.set requires at least one switch change.");
  }
  function parseAndPrepare(request) {
    if (!request || typeof request !== "object") reject("REQUEST_REQUIRED", "Protocol 1.6 request object is required.");
    if (!own(CAPABILITIES, request.command)) reject("LAYER_CONTROLS_COMMAND_UNSUPPORTED", "Unsupported protocol 1.6 layer-controls command: " + asString(request.command));
    if (request.capabilityId !== CAPABILITIES[request.command]) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match the layer-controls command.");
    if (!request.payload || typeof request.payload !== "object") reject("PAYLOAD_REQUIRED", "Layer-controls payload object is required.");
    if (!request.payload.comp) reject("LAYER_CONTROLS_COMP_REQUIRED", "Layer-controls payload requires a comp reference.");
    if (!request.payload.layer) reject("LAYER_CONTROLS_LAYER_REQUIRED", "Layer-controls payload requires a layer reference.");
    var comp = findComp(request.payload.comp);
    var layer = findLayer(comp, request.payload.layer);
    if (request.command === "layer.switches.set") validateSwitchPatch(request.payload.switches);
    return { comp: comp, layer: layer, patch: request.payload.switches || null };
  }
  function requestedKeys(patch) {
    var result = [];
    var i, key;
    for (i = 0; i < SWITCH_KEYS.length; i += 1) {
      key = SWITCH_KEYS[i];
      if (own(patch, key)) result.push(key);
    }
    return result;
  }
  function patchAlreadyMatches(readback, patch) {
    var switches = readback.layerSwitches.switches;
    var keys = requestedKeys(patch);
    var i, key;
    for (i = 0; i < keys.length; i += 1) {
      key = keys[i];
      if (switches[key] !== patch[key]) return false;
    }
    return true;
  }
  function requirePatchApplicability(readback, patch) {
    var applicability = readback.layerSwitches.applicability;
    var keys = requestedKeys(patch);
    var i, key;
    for (i = 0; i < keys.length; i += 1) {
      key = keys[i];
      if (applicability[key] !== true) reject("LAYER_SWITCH_UNSUPPORTED_FOR_TARGET", "Requested switch is not supported by the resolved AE layer.", { key: key, layer: readback.layerSwitches.layer });
    }
  }
  function hasNonLockChange(patch) {
    var keys = requestedKeys(patch);
    var i;
    for (i = 0; i < keys.length; i += 1) if (keys[i] !== "locked") return true;
    return false;
  }
  function requireRepresentableSwitchState(readback, patch) {
    var switches = readback.layerSwitches.switches;
    var finalEnabled = own(patch, "enabled") ? patch.enabled : switches.enabled;
    var finalSolo = own(patch, "solo") ? patch.solo : switches.solo;
    if (finalEnabled === false && finalSolo === true) {
      conflict(
        "LAYER_SOLO_REQUIRES_ENABLED",
        "After Effects cannot retain solo:true when enabled:false; request enabled:true or solo:false in the same atomic patch.",
        { enabled: finalEnabled, solo: finalSolo, layer: readback.layerSwitches.layer }
      );
    }
  }
  function setQuality(layer, value) {
    if (typeof LayerQuality === "undefined") reject("LAYER_QUALITY_UNAVAILABLE", "AE LayerQuality enum is unavailable on this host.");
    if (value === "BEST") layer.quality = LayerQuality.BEST;
    else if (value === "DRAFT") layer.quality = LayerQuality.DRAFT;
    else if (value === "WIREFRAME") layer.quality = LayerQuality.WIREFRAME;
    else reject("LAYER_QUALITY_INVALID", "quality must be BEST, DRAFT, or WIREFRAME.");
  }
  function setBoolean(layer, key, value) { layer[key] = value === true; }
  function applyPatch(layer, patch) {
    /* Unlock first so an atomic request cannot deadlock itself. AE 25.6.6 refuses
     * a Solo write while the layer is disabled, so Solo is dependency-aware: if
     * necessary we temporarily enable the layer, write Solo, apply all remaining
     * switches, then commit the requested final enabled state. Lock remains last.
     * Unrepresentable disabled+solo final states are rejected before this point. */
    var enabledBeforeSolo = null;
    var temporarilyEnabledForSolo = false;
    if (own(patch, "locked") && patch.locked === false) setBoolean(layer, "locked", false);
    if (own(patch, "solo")) {
      try { enabledBeforeSolo = layer.enabled === true; } catch (_) { enabledBeforeSolo = null; }
      if (enabledBeforeSolo === false) {
        setBoolean(layer, "enabled", true);
        temporarilyEnabledForSolo = true;
      }
      setBoolean(layer, "solo", patch.solo);
    }
    if (own(patch, "shy")) setBoolean(layer, "shy", patch.shy);
    if (own(patch, "quality")) setQuality(layer, patch.quality);
    if (own(patch, "adjustmentLayer")) setBoolean(layer, "adjustmentLayer", patch.adjustmentLayer);
    if (own(patch, "guideLayer")) setBoolean(layer, "guideLayer", patch.guideLayer);
    if (own(patch, "threeDLayer")) setBoolean(layer, "threeDLayer", patch.threeDLayer);
    if (own(patch, "effectsActive")) setBoolean(layer, "effectsActive", patch.effectsActive);
    if (own(patch, "collapseTransformation")) setBoolean(layer, "collapseTransformation", patch.collapseTransformation);
    if (own(patch, "preserveTransparency")) setBoolean(layer, "preserveTransparency", patch.preserveTransparency);
    if (own(patch, "enabled")) setBoolean(layer, "enabled", patch.enabled);
    else if (temporarilyEnabledForSolo) setBoolean(layer, "enabled", false);
    if (own(patch, "locked") && patch.locked === true) setBoolean(layer, "locked", true);
  }

  function execute(request) {
    var startedAt = nowMs();
    var prepared;
    try { prepared = parseAndPrepare(request); }
    catch (preflightError) { return responseFor(request, "REJECTED", errorPayload(preflightError), [], null, startedAt, ["Layer-controls request rejected before mutation."]); }

    if (request.command === "layer.switches_readback") {
      try { return responseFor(request, "NO_OP", null, [], layerSwitchReadback(prepared.comp, prepared.layer), startedAt, ["Read-only exact layer switch/applicability readback."]); }
      catch (readbackError) { return responseFor(request, "FAILED", errorPayload(readbackError), [], null, startedAt, ["Layer-controls readback failed without mutation."]); }
    }

    var beforeReadback;
    try {
      requireExpectedRevision(request);
      beforeReadback = layerSwitchReadback(prepared.comp, prepared.layer);
      requirePatchApplicability(beforeReadback, prepared.patch);
      requireRepresentableSwitchState(beforeReadback, prepared.patch);
      if (patchAlreadyMatches(beforeReadback, prepared.patch)) {
        return responseFor(request, "NO_OP", null, [], beforeReadback, startedAt, ["Requested layer-switch patch already matches exact host readback."]);
      }
      if (beforeReadback.layerSwitches.switches.locked === true
          && hasNonLockChange(prepared.patch)
          && prepared.patch.locked !== false) {
        conflict("LAYER_LOCKED_REQUIRES_EXPLICIT_UNLOCK", "The target layer is locked; changing other switches requires locked:false in the same atomic patch.", { layer: beforeReadback.layerSwitches.layer });
      }
    } catch (guardError) {
      return responseFor(request, "REJECTED", errorPayload(guardError), [], beforeReadback || null, startedAt, ["Layer-switch mutation rejected before mutation."]);
    }

    var beforeRevision = app.project ? app.project.revision : null;
    var mutationStarted = false;
    app.beginUndoGroup("EditFlow M3 layer switches");
    try {
      mutationStarted = true;
      applyPatch(prepared.layer, prepared.patch);
      app.endUndoGroup();
      var afterReadback = layerSwitchReadback(prepared.comp, prepared.layer);
      if (!patchAlreadyMatches(afterReadback, prepared.patch)) {
        fail("ADAPTER_FAILURE", "LAYER_SWITCH_READBACK_MISMATCH", "Applied layer-switch patch did not survive exact host readback.", { requested: prepared.patch, observed: afterReadback.layerSwitches.switches });
      }
      return responseFor(request, "APPLIED", null, [affected(prepared.layer)], afterReadback, startedAt, ["Applied typed layer-switch patch with exact readback verification.", "Ordering remains delegated to protocol 1.1 layer.reorder."]);
    } catch (mutationError) {
      try { app.endUndoGroup(); } catch (_) {}
      var notes = ["Layer-switch mutation failed."];
      var afterFailureRevision = app.project ? app.project.revision : null;
      if (mutationStarted && beforeRevision !== null && afterFailureRevision !== beforeRevision) {
        try { app.executeCommand(16); notes.push("Failed layer-switch mutation self-rolled back with AE Undo."); }
        catch (rollbackError) { notes.push("Layer-switch self-rollback attempt failed: " + asString(rollbackError)); }
      }
      return responseFor(request, "FAILED", errorPayload(mutationError), [], null, startedAt, notes);
    }
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) { return previousDispatch(requestJson); }
    if (!request || request.protocolVersion !== PROTOCOL) return previousDispatch(requestJson);
    return $.global.EditFlow2_JSON.stringify(execute(request));
  };
}());