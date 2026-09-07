/* EditFlow 2.0 M3 layer switches and stacking-order host layer.
 * Fixed typed protocol 1.6 commands only. No arbitrary code execution.
 * Motion blur and frame blending remain in the later compound rendering-controls tranche.
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
    "layer.order.set": "ae.layer.order.set",
    "layer.controls.readback": "ae.layer.controls.readback"
  };
  var SWITCH_KEYS = {
    enabled: true,
    audioEnabled: true,
    solo: true,
    locked: true,
    shy: true,
    collapseTransformation: true,
    quality: true,
    effectsActive: true,
    adjustmentLayer: true,
    threeDLayer: true,
    preserveTransparency: true,
    samplingQuality: true
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
  function layerStableId(layer) { try { return stableIdFromText(layer.comment); } catch (_) { return null; } }
  function hostIdOf(layer) { try { return typeof layer.id === "number" ? layer.id : null; } catch (_) { return null; } }
  function itemHostId(item) { try { return typeof item.id === "number" ? item.id : null; } catch (_) { return null; } }

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
    if (!layer) return null;
    return { stableId: layerStableId(layer), hostId: hostIdOf(layer), index: layer.index, name: layer.name };
  }

  function readBooleanProperty(layer, key) {
    try { return typeof layer[key] === "boolean" ? layer[key] === true : null; } catch (_) { return null; }
  }
  function qualityName(value) {
    try {
      if (value === LayerQuality.BEST) return "BEST";
      if (value === LayerQuality.DRAFT) return "DRAFT";
      if (value === LayerQuality.WIREFRAME) return "WIREFRAME";
    } catch (_) {}
    return null;
  }
  function samplingQualityName(value) {
    try {
      if (value === LayerSamplingQuality.BILINEAR) return "BILINEAR";
      if (value === LayerSamplingQuality.BICUBIC) return "BICUBIC";
    } catch (_) {}
    return null;
  }
  function readQuality(layer) { try { return qualityName(layer.quality); } catch (_) { return null; } }
  function readSamplingQuality(layer) { try { return samplingQualityName(layer.samplingQuality); } catch (_) { return null; } }

  function supportsSwitch(layer, key) {
    try {
      if (key === "enabled" || key === "solo" || key === "locked" || key === "shy") return typeof layer[key] === "boolean";
      if (key === "collapseTransformation") return typeof layer.collapseTransformation === "boolean" && layer.canSetCollapseTransformation === true;
      if (key === "quality") return readQuality(layer) !== null;
      if (key === "samplingQuality") return readSamplingQuality(layer) !== null;
      return typeof layer[key] === "boolean";
    } catch (_) { return false; }
  }
  function switchReadback(layer) {
    var supported = {};
    var key;
    for (key in SWITCH_KEYS) if (own(SWITCH_KEYS, key)) supported[key] = supportsSwitch(layer, key);
    return {
      supported: supported,
      values: {
        enabled: readBooleanProperty(layer, "enabled"),
        audioEnabled: readBooleanProperty(layer, "audioEnabled"),
        solo: readBooleanProperty(layer, "solo"),
        locked: readBooleanProperty(layer, "locked"),
        shy: readBooleanProperty(layer, "shy"),
        collapseTransformation: readBooleanProperty(layer, "collapseTransformation"),
        quality: readQuality(layer),
        effectsActive: readBooleanProperty(layer, "effectsActive"),
        adjustmentLayer: readBooleanProperty(layer, "adjustmentLayer"),
        threeDLayer: readBooleanProperty(layer, "threeDLayer"),
        preserveTransparency: readBooleanProperty(layer, "preserveTransparency"),
        samplingQuality: readSamplingQuality(layer)
      }
    };
  }
  function orderReadback(comp, layer) {
    var index = layer.index;
    return {
      index: index,
      totalLayers: comp.numLayers,
      previousLayer: index > 1 ? layerRef(comp.layer(index - 1)) : null,
      nextLayer: index < comp.numLayers ? layerRef(comp.layer(index + 1)) : null
    };
  }
  function controlsReadback(comp, layer) {
    return { layerControls: { layer: layerRef(layer), switches: switchReadback(layer), order: orderReadback(comp, layer) } };
  }
  function affected(layer) { return { kind: "LAYER", stableId: layerStableId(layer), hostId: hostIdOf(layer) }; }

  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") reject("EXPECTED_HOST_REVISION_REQUIRED", "Mutating layer-controls commands require expectedHostProjectRevision.");
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

  function validateSwitches(layer, switches) {
    if (!switches || typeof switches !== "object") reject("LAYER_SWITCHES_REQUIRED", "layer.switches.set requires a switches object.");
    var count = 0;
    var key;
    for (key in switches) if (own(switches, key)) {
      count += 1;
      if (!own(SWITCH_KEYS, key)) reject("LAYER_SWITCH_UNKNOWN", "Unknown layer switch: " + key, { switchKey: key });
      if (key === "quality") {
        if (switches[key] !== "BEST" && switches[key] !== "DRAFT" && switches[key] !== "WIREFRAME") reject("LAYER_QUALITY_INVALID", "quality must be BEST, DRAFT, or WIREFRAME.");
      } else if (key === "samplingQuality") {
        if (switches[key] !== "BILINEAR" && switches[key] !== "BICUBIC") reject("LAYER_SAMPLING_QUALITY_INVALID", "samplingQuality must be BILINEAR or BICUBIC.");
      } else if (typeof switches[key] !== "boolean") {
        reject("LAYER_SWITCH_VALUE_INVALID", "Layer switch values must be booleans.", { switchKey: key });
      }
      if (!supportsSwitch(layer, key)) fail("CAPABILITY_UNAVAILABLE", "LAYER_SWITCH_NOT_SUPPORTED", "Requested layer switch is not settable on the target layer.", { switchKey: key, layer: layerRef(layer) });
    }
    if (count === 0) reject("LAYER_SWITCHES_EMPTY", "layer.switches.set requires at least one switch value.");
  }
  function validatePlacement(comp, layer, placement) {
    if (!placement || typeof placement !== "object") reject("LAYER_PLACEMENT_REQUIRED", "layer.order.set requires a placement object.");
    if (placement.kind !== "BEGINNING" && placement.kind !== "END" && placement.kind !== "BEFORE" && placement.kind !== "AFTER") reject("LAYER_PLACEMENT_INVALID", "Unsupported layer placement kind.");
    if (placement.kind === "BEFORE" || placement.kind === "AFTER") {
      if (!placement.relativeTo) reject("LAYER_RELATIVE_REF_REQUIRED", "Relative layer placement requires relativeTo.");
      var relative = findLayer(comp, placement.relativeTo);
      if (relative === layer) reject("LAYER_RELATIVE_SELF", "A layer cannot be ordered relative to itself.");
      return relative;
    }
    return null;
  }
  function parseAndPrepare(request) {
    if (!request || typeof request !== "object") reject("REQUEST_REQUIRED", "Protocol 1.6 request object is required.");
    if (!own(CAPABILITIES, request.command)) reject("LAYER_CONTROLS_COMMAND_UNSUPPORTED", "Unsupported protocol 1.6 layer-controls command: " + asString(request.command));
    if (request.capabilityId !== CAPABILITIES[request.command]) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match the layer-controls command.");
    if (!request.payload || typeof request.payload !== "object") reject("PAYLOAD_REQUIRED", "Layer-controls payload object is required.");
    if (!request.payload.comp || !request.payload.layer) reject("LAYER_CONTROLS_TARGET_REQUIRED", "Layer-controls payload requires comp and layer references.");
    var comp = findComp(request.payload.comp);
    var layer = findLayer(comp, request.payload.layer);
    var relative = null;
    if (request.command === "layer.switches.set") validateSwitches(layer, request.payload.switches);
    if (request.command === "layer.order.set") relative = validatePlacement(comp, layer, request.payload.placement);
    return { comp: comp, layer: layer, relative: relative };
  }

  function requestedValueEquals(actual, expected) { return actual === expected; }
  function switchesAlreadyMatch(layer, switches) {
    var values = switchReadback(layer).values;
    var key;
    for (key in switches) if (own(switches, key) && !requestedValueEquals(values[key], switches[key])) return false;
    return true;
  }
  function placementAlreadyMatches(comp, layer, placement, relative) {
    if (placement.kind === "BEGINNING") return layer.index === 1;
    if (placement.kind === "END") return layer.index === comp.numLayers;
    if (placement.kind === "BEFORE") return layer.index + 1 === relative.index;
    return layer.index === relative.index + 1;
  }
  function setQuality(layer, value) {
    if (value === "BEST") layer.quality = LayerQuality.BEST;
    else if (value === "DRAFT") layer.quality = LayerQuality.DRAFT;
    else layer.quality = LayerQuality.WIREFRAME;
  }
  function setSamplingQuality(layer, value) {
    layer.samplingQuality = value === "BICUBIC" ? LayerSamplingQuality.BICUBIC : LayerSamplingQuality.BILINEAR;
  }
  function setSwitch(layer, key, value) {
    if (key === "quality") setQuality(layer, value);
    else if (key === "samplingQuality") setSamplingQuality(layer, value);
    else layer[key] = value;
  }
  function hasNonLockSwitch(switches) {
    var key;
    for (key in switches) if (own(switches, key) && key !== "locked") return true;
    return false;
  }
  function applySwitches(layer, switches) {
    var wasLocked = layer.locked === true;
    var finalLocked = own(switches, "locked") ? switches.locked === true : wasLocked;
    var key;
    if (wasLocked && hasNonLockSwitch(switches)) layer.locked = false;
    for (key in switches) if (own(switches, key) && key !== "locked") setSwitch(layer, key, switches[key]);
    layer.locked = finalLocked;
  }
  function applyPlacement(layer, placement, relative) {
    var wasLocked = layer.locked === true;
    if (wasLocked) layer.locked = false;
    if (placement.kind === "BEGINNING") layer.moveToBeginning();
    else if (placement.kind === "END") layer.moveToEnd();
    else if (placement.kind === "BEFORE") layer.moveBefore(relative);
    else layer.moveAfter(relative);
    if (wasLocked) layer.locked = true;
  }
  function verifySwitches(layer, switches) {
    if (!switchesAlreadyMatch(layer, switches)) fail("READBACK", "LAYER_SWITCH_READBACK_MISMATCH", "Applied layer switches did not match structural readback.", { expected: switches, actual: switchReadback(layer).values });
  }
  function verifyPlacement(comp, layer, placement, relative) {
    if (!placementAlreadyMatches(comp, layer, placement, relative)) fail("READBACK", "LAYER_ORDER_READBACK_MISMATCH", "Applied layer order did not match structural readback.", { placement: placement, order: orderReadback(comp, layer) });
  }

  function execute(request) {
    var startedAt = nowMs();
    var prepared;
    try { prepared = parseAndPrepare(request); }
    catch (preflightError) { return responseFor(request, "REJECTED", errorPayload(preflightError), [], null, startedAt, ["Layer-controls request rejected before mutation."]); }

    if (request.command === "layer.controls.readback") {
      try { return responseFor(request, "NO_OP", null, [], controlsReadback(prepared.comp, prepared.layer), startedAt, ["Read-only layer switch and stacking-order readback."]); }
      catch (readbackError) { return responseFor(request, "FAILED", errorPayload(readbackError), [], null, startedAt, ["Layer-controls readback failed without mutation."]); }
    }

    try { requireExpectedRevision(request); }
    catch (revisionError) { return responseFor(request, "REJECTED", errorPayload(revisionError), [], controlsReadback(prepared.comp, prepared.layer), startedAt, ["Layer-controls mutation rejected before mutation."]); }

    if (request.command === "layer.switches.set" && switchesAlreadyMatch(prepared.layer, request.payload.switches)) {
      return responseFor(request, "NO_OP", null, [], controlsReadback(prepared.comp, prepared.layer), startedAt, ["Requested layer switches already match host state."]);
    }
    if (request.command === "layer.order.set" && placementAlreadyMatches(prepared.comp, prepared.layer, request.payload.placement, prepared.relative)) {
      return responseFor(request, "NO_OP", null, [], controlsReadback(prepared.comp, prepared.layer), startedAt, ["Requested layer placement already matches host state."]);
    }

    var mutationStarted = false;
    app.beginUndoGroup("EditFlow M3 layer controls");
    try {
      mutationStarted = true;
      if (request.command === "layer.switches.set") {
        applySwitches(prepared.layer, request.payload.switches);
        verifySwitches(prepared.layer, request.payload.switches);
      } else {
        applyPlacement(prepared.layer, request.payload.placement, prepared.relative);
        verifyPlacement(prepared.comp, prepared.layer, request.payload.placement, prepared.relative);
      }

      /* Proof-only P4 injection. Ordinary product requests cannot arm this path:
       * the isolated self-hosted runner must launch its owned AE process with the
       * exact proof environment flag and the typed protocol-1.6 order request must
       * carry the fixed readback profile. Injection happens only after a real order
       * mutation has passed structural verification, while the AE Undo group is
       * still open, so the normal rollback path is what must recover the fixture. */
      if (request.command === "layer.order.set"
          && request.readbackProfile === "M3_LAYER_CONTROLS_P4_FAILURE_INJECTION"
          && $.getenv("EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF") === "1") {
        fail("PROOF_INJECTION", "M3_LAYER_CONTROLS_P4_INDUCED_FAILURE", "Induced M3 layer-controls P4 failure after verified order mutation.", null);
      }

      app.endUndoGroup();
      return responseFor(request, "APPLIED", null, [affected(prepared.layer)], controlsReadback(prepared.comp, prepared.layer), startedAt, ["Layer-controls mutation applied and structurally verified."]);
    } catch (mutationError) {
      try { app.endUndoGroup(); } catch (_) {}
      var rollbackError = null;
      if (mutationStarted) {
        try { app.executeCommand(16); } catch (undoError) { rollbackError = undoError; }
      }
      if (rollbackError) {
        return responseFor(request, "FAILED", { category: "ROLLBACK_FAILURE", code: "LAYER_CONTROLS_ROLLBACK_FAILED", message: asString(rollbackError), details: { mutationError: errorPayload(mutationError) } }, [], null, startedAt, ["Layer-controls mutation failed and undo rollback also failed."]);
      }
      return responseFor(request, "FAILED", errorPayload(mutationError), [], controlsReadback(prepared.comp, prepared.layer), startedAt, ["Layer-controls mutation failed and was rolled back through the transaction undo boundary."]);
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
