/* EditFlow 2.0 M3 layer switch/order host layer.
 * Fixed typed protocol 1.6 commands only. No arbitrary code execution.
 * Motion blur and frame blending remain reserved for their dedicated later M3 tranche.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("EditFlow M3 layer-control layer requires the existing dispatcher.");

  var PROTOCOL = "1.6.0";
  var BUILD = "0.4.0-dev.6";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var CAPABILITIES = {
    "layer.switches.set": "ae.layer.switches.set",
    "layer.order.set": "ae.layer.order.set",
    "layer.controls.readback": "ae.layer.controls.readback"
  };
  var SWITCH_KEYS = ["enabled", "solo", "shy", "locked", "guideLayer", "adjustmentLayer", "threeDLayer", "collapseTransformation", "audioEnabled"];
  /* Apply locked last so a multi-switch patch cannot make its own remaining writes harder to complete. */
  var SWITCH_MUTATION_ORDER = ["enabled", "solo", "shy", "guideLayer", "adjustmentLayer", "threeDLayer", "collapseTransformation", "audioEnabled", "locked"];

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
    if (!layer) return null;
    return { stableId: layerStableId(layer), hostId: hostIdOf(layer), index: layer.index, name: layer.name };
  }
  function affected(layer) { return { kind: "LAYER", stableId: layerStableId(layer), hostId: hostIdOf(layer) }; }

  function safeBooleanRead(layer, key) {
    try {
      var value = layer[key];
      return typeof value === "boolean" ? value : null;
    } catch (_) { return null; }
  }
  function switchReadback(layer) {
    var values = {};
    var supported = {};
    var i, key, value;
    for (i = 0; i < SWITCH_KEYS.length; i += 1) {
      key = SWITCH_KEYS[i];
      value = safeBooleanRead(layer, key);
      supported[key] = value !== null;
      values[key] = value;
    }
    return { values: values, supported: supported };
  }
  function neighboringRef(comp, index) {
    if (index < 1 || index > comp.numLayers) return null;
    return layerRef(comp.layer(index));
  }
  function controlsReadback(comp, layer) {
    return {
      layerControls: {
        layer: layerRef(layer),
        switches: switchReadback(layer),
        order: {
          index: layer.index,
          layerCount: comp.numLayers,
          previousLayer: neighboringRef(comp, layer.index - 1),
          nextLayer: neighboringRef(comp, layer.index + 1)
        }
      }
    };
  }

  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") reject("EXPECTED_HOST_REVISION_REQUIRED", "Mutating layer-control commands require expectedHostProjectRevision.");
    var actual = app.project ? app.project.revision : null;
    if (actual !== request.expectedHostProjectRevision) conflict("HOST_REVISION_CONFLICT", "Host project revision does not match the expected revision.", { expectedHostProjectRevision: request.expectedHostProjectRevision, actualHostProjectRevision: actual });
  }
  function errorPayload(error) {
    return {
      category: error && error.editflowCategory ? error.editflowCategory : "ADAPTER_FAILURE",
      code: error && error.editflowCode ? error.editflowCode : "M3_LAYER_CONTROL_HOST_FAILURE",
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

  function isKnownSwitch(key) {
    var i;
    for (i = 0; i < SWITCH_KEYS.length; i += 1) if (SWITCH_KEYS[i] === key) return true;
    return false;
  }
  function validateSwitchPatch(layer, switches) {
    if (!switches || typeof switches !== "object") reject("LAYER_SWITCH_PATCH_REQUIRED", "layer.switches.set requires a switches object.");
    var seen = 0;
    var key, current;
    for (key in switches) {
      if (!own(switches, key)) continue;
      if (!isKnownSwitch(key)) reject("LAYER_SWITCH_UNSUPPORTED", "Unsupported layer switch: " + key);
      if (typeof switches[key] !== "boolean") reject("LAYER_SWITCH_BOOLEAN_REQUIRED", "Layer switch values must be boolean.", { key: key });
      current = safeBooleanRead(layer, key);
      if (current === null) reject("LAYER_SWITCH_NOT_SUPPORTED_BY_LAYER", "Requested switch is not supported by the resolved layer.", { key: key, layer: layerRef(layer) });
      seen += 1;
    }
    if (seen === 0) reject("LAYER_SWITCH_PATCH_EMPTY", "layer.switches.set requires at least one switch.");
  }

  function parseAndPrepare(request) {
    if (!request || typeof request !== "object") reject("REQUEST_REQUIRED", "Protocol 1.6 request object is required.");
    if (!own(CAPABILITIES, request.command)) reject("LAYER_CONTROL_COMMAND_UNSUPPORTED", "Unsupported protocol 1.6 layer-control command: " + asString(request.command));
    if (request.capabilityId !== CAPABILITIES[request.command]) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match the layer-control command.");
    if (!request.payload || typeof request.payload !== "object") reject("PAYLOAD_REQUIRED", "Layer-control payload object is required.");
    if (!request.payload.comp) reject("LAYER_CONTROL_COMP_REQUIRED", "Layer-control payload requires a comp reference.");
    if (!request.payload.layer) reject("LAYER_CONTROL_LAYER_REQUIRED", "Layer-control payload requires a layer reference.");
    var comp = findComp(request.payload.comp);
    var layer = findLayer(comp, request.payload.layer);
    var referenceLayer = null;
    if (request.command === "layer.switches.set") validateSwitchPatch(layer, request.payload.switches);
    if (request.command === "layer.order.set") {
      var placement = request.payload.placement;
      if (!placement || typeof placement !== "object") reject("LAYER_ORDER_PLACEMENT_REQUIRED", "layer.order.set requires placement.");
      if (placement.position !== "BEGINNING" && placement.position !== "END" && placement.position !== "BEFORE" && placement.position !== "AFTER") reject("LAYER_ORDER_POSITION_INVALID", "Unsupported layer order position.");
      if (placement.position === "BEFORE" || placement.position === "AFTER") {
        if (!placement.referenceLayer) reject("LAYER_ORDER_REFERENCE_REQUIRED", "Relative layer placement requires referenceLayer.");
        referenceLayer = findLayer(comp, placement.referenceLayer);
        if (referenceLayer === layer) reject("LAYER_ORDER_SELF_REFERENCE", "Layer cannot be ordered relative to itself.");
      }
    }
    return { comp: comp, layer: layer, referenceLayer: referenceLayer };
  }

  function setSwitches(layer, switches) {
    var changed = false;
    var i, key;
    for (i = 0; i < SWITCH_MUTATION_ORDER.length; i += 1) {
      key = SWITCH_MUTATION_ORDER[i];
      if (!own(switches, key)) continue;
      if (safeBooleanRead(layer, key) !== switches[key]) {
        try { layer[key] = switches[key]; }
        catch (error) { fail("ADAPTER_FAILURE", "LAYER_SWITCH_SET_FAILED", "After Effects refused layer switch mutation.", { key: key, message: String(error) }); }
        if (safeBooleanRead(layer, key) !== switches[key]) fail("ADAPTER_FAILURE", "LAYER_SWITCH_READBACK_MISMATCH", "Layer switch mutation did not survive immediate host readback.", { key: key });
        changed = true;
      }
    }
    return changed;
  }

  function orderMatches(comp, layer, placement, referenceLayer) {
    if (placement.position === "BEGINNING") return layer.index === 1;
    if (placement.position === "END") return layer.index === comp.numLayers;
    if (placement.position === "BEFORE") return layer.index + 1 === referenceLayer.index;
    if (placement.position === "AFTER") return layer.index === referenceLayer.index + 1;
    return false;
  }
  function setOrder(comp, layer, placement, referenceLayer) {
    if (orderMatches(comp, layer, placement, referenceLayer)) return false;
    if (placement.position === "BEGINNING") layer.moveToBeginning();
    else if (placement.position === "END") layer.moveToEnd();
    else if (placement.position === "BEFORE") layer.moveBefore(referenceLayer);
    else if (placement.position === "AFTER") layer.moveAfter(referenceLayer);
    if (!orderMatches(comp, layer, placement, referenceLayer)) {
      fail("ADAPTER_FAILURE", "LAYER_ORDER_READBACK_MISMATCH", "Layer order mutation did not survive immediate host readback.", { layer: layerRef(layer), referenceLayer: layerRef(referenceLayer), placement: placement.position });
    }
    return true;
  }

  function execute(request) {
    var startedAt = nowMs();
    var prepared;
    try { prepared = parseAndPrepare(request); }
    catch (preflightError) { return responseFor(request, "REJECTED", errorPayload(preflightError), [], null, startedAt, ["Layer-control request rejected before mutation."]); }

    if (request.command === "layer.controls.readback") {
      try { return responseFor(request, "NO_OP", null, [], controlsReadback(prepared.comp, prepared.layer), startedAt, ["Read-only layer switch and order readback."]); }
      catch (readbackError) { return responseFor(request, "FAILED", errorPayload(readbackError), [], null, startedAt, ["Layer-control readback failed without mutation."]); }
    }

    try { requireExpectedRevision(request); }
    catch (revisionError) { return responseFor(request, "REJECTED", errorPayload(revisionError), [], controlsReadback(prepared.comp, prepared.layer), startedAt, ["Layer-control mutation rejected before mutation."]); }

    var changed = false;
    app.beginUndoGroup("EditFlow M3 layer controls");
    try {
      if (request.command === "layer.switches.set") changed = setSwitches(prepared.layer, request.payload.switches);
      else if (request.command === "layer.order.set") changed = setOrder(prepared.comp, prepared.layer, request.payload.placement, prepared.referenceLayer);
      app.endUndoGroup();
      return responseFor(request, changed ? "APPLIED" : "NO_OP", null, changed ? [affected(prepared.layer)] : [], controlsReadback(prepared.comp, prepared.layer), startedAt, [changed ? "Layer controls changed and were read back from After Effects." : "Requested layer controls already matched host state."]);
    } catch (mutationError) {
      try { app.endUndoGroup(); } catch (_) {}
      try { app.executeCommand(16); } catch (_) {}
      return responseFor(request, "FAILED", errorPayload(mutationError), [], controlsReadback(prepared.comp, prepared.layer), startedAt, ["Layer-control mutation failed; host undo compensation was requested."]);
    }
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
    if (!request || request.protocolVersion !== PROTOCOL) return previousDispatch(requestJson);
    return $.global.EditFlow2_JSON.stringify(execute(request));
  };
}());
