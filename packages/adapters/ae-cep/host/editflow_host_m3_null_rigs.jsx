/* EditFlow 2.0 M3 managed null-rig host layer.
 * Fixed typed protocol 1.5 commands only. No arbitrary code execution.
 * Relationship mutation composes with protocol 1.4 preserve-transform parenting.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("EditFlow M3 null-rig layer requires the existing dispatcher.");

  var PROTOCOL = "1.5.0";
  var BUILD = "0.4.0-dev.5";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var CAPABILITIES = {
    "rig.null.create": "ae.rig.null.create",
    "rig.null.remove": "ae.rig.null.remove",
    "rig.null.readback": "ae.rig.null.readback"
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

  function stableIdFromText(text) {
    var source = asString(text);
    var start = source.indexOf(STABLE_PREFIX);
    if (start < 0) return null;
    start += STABLE_PREFIX.length;
    var end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }
  function layerStableId(layer) { try { return stableIdFromText(layer.comment); } catch (_) { return null; } }
  function stableMarker(stableId) { return STABLE_PREFIX + stableId + MARKER_SUFFIX; }

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
  function findLayer(comp, ref, allowMissing) {
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
    if (allowMissing) return null;
    reject("NULL_RIG_NOT_FOUND", "Null-rig layer reference did not resolve in the target composition.");
  }
  function hostIdOf(layer) { try { return typeof layer.id === "number" ? layer.id : null; } catch (_) { return null; } }
  function layerRef(layer) {
    if (!layer) return null;
    return { stableId: layerStableId(layer), hostId: hostIdOf(layer), index: layer.index, name: layer.name };
  }
  function isNullLayer(layer) { try { return layer && layer.nullLayer === true; } catch (_) { return false; } }
  function childrenOf(comp, rig) {
    var children = [];
    var i, layer, parent;
    for (i = 1; i <= comp.numLayers; i += 1) {
      layer = comp.layer(i);
      parent = null;
      try { parent = layer.parent; } catch (_) {}
      if (parent === rig) children.push(layerRef(layer));
    }
    return children;
  }
  function transformSnapshot(layer) {
    var group = null;
    try { group = layer.property("ADBE Transform Group"); } catch (_) {}
    if (!group) return null;
    function value(matchName) {
      try { var property = group.property(matchName); return property ? property.value : null; } catch (_) { return null; }
    }
    return {
      anchorPoint: value("ADBE Anchor Point"),
      position: value("ADBE Position"),
      scale: value("ADBE Scale"),
      rotation: value("ADBE Rotate Z"),
      opacity: value("ADBE Opacity")
    };
  }
  function rigReadback(comp, rig) {
    var parent = null;
    try { parent = rig.parent; } catch (_) {}
    return {
      nullRig: {
        layer: layerRef(rig),
        isNull: isNullLayer(rig),
        threeDLayer: rig.threeDLayer === true,
        enabled: rig.enabled === true,
        parentLayer: layerRef(parent),
        children: childrenOf(comp, rig),
        transform: transformSnapshot(rig)
      }
    };
  }
  function affected(layer) { return { kind: "LAYER", stableId: layerStableId(layer), hostId: hostIdOf(layer) }; }
  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") reject("EXPECTED_HOST_REVISION_REQUIRED", "Mutating null-rig commands require expectedHostProjectRevision.");
    var actual = app.project ? app.project.revision : null;
    if (actual !== request.expectedHostProjectRevision) conflict("HOST_REVISION_CONFLICT", "Host project revision does not match the expected revision.", { expectedHostProjectRevision: request.expectedHostProjectRevision, actualHostProjectRevision: actual });
  }
  function errorPayload(error) {
    return {
      category: error && error.editflowCategory ? error.editflowCategory : "ADAPTER_FAILURE",
      code: error && error.editflowCode ? error.editflowCode : "M3_NULL_RIG_HOST_FAILURE",
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
    if (!request || typeof request !== "object") reject("REQUEST_REQUIRED", "Protocol 1.5 request object is required.");
    if (!own(CAPABILITIES, request.command)) reject("NULL_RIG_COMMAND_UNSUPPORTED", "Unsupported protocol 1.5 null-rig command: " + asString(request.command));
    if (request.capabilityId !== CAPABILITIES[request.command]) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match the null-rig command.");
    if (!request.payload || typeof request.payload !== "object") reject("PAYLOAD_REQUIRED", "Null-rig payload object is required.");
    if (!request.payload.comp) reject("NULL_RIG_COMP_REQUIRED", "Null-rig payload requires a comp reference.");
    var comp = findComp(request.payload.comp);
    if (request.command === "rig.null.create") {
      if (!request.payload.rig || typeof request.payload.rig.stableId !== "string" || request.payload.rig.stableId.length === 0) reject("NULL_RIG_STABLE_ID_REQUIRED", "rig.null.create requires a non-empty caller-owned stableId.");
      return { comp: comp, rig: findLayer(comp, request.payload.rig, true), createSpec: request.payload.rig };
    }
    if (!request.payload.rig) reject("NULL_RIG_REF_REQUIRED", "Null-rig target command requires rig reference.");
    var rig = findLayer(comp, request.payload.rig, false);
    if (!isNullLayer(rig)) reject("TARGET_NOT_NULL_RIG", "Resolved layer is not an After Effects null object.");
    return { comp: comp, rig: rig, createSpec: null };
  }
  function execute(request) {
    var startedAt = nowMs();
    var prepared;
    try { prepared = parseAndPrepare(request); }
    catch (preflightError) { return responseFor(request, "REJECTED", errorPayload(preflightError), [], null, startedAt, ["Null-rig request rejected before mutation."]); }

    if (request.command === "rig.null.readback") {
      try { return responseFor(request, "NO_OP", null, [], rigReadback(prepared.comp, prepared.rig), startedAt, ["Read-only managed null and relationship-topology readback."]); }
      catch (readbackError) { return responseFor(request, "FAILED", errorPayload(readbackError), [], null, startedAt, ["Null-rig readback failed without mutation."]); }
    }

    try { requireExpectedRevision(request); }
    catch (revisionError) { return responseFor(request, "REJECTED", errorPayload(revisionError), [], prepared.rig ? rigReadback(prepared.comp, prepared.rig) : null, startedAt, ["Null-rig mutation rejected before mutation."]); }

    if (request.command === "rig.null.create" && prepared.rig) {
      if (!isNullLayer(prepared.rig)) return responseFor(request, "REJECTED", { category: "CONFLICT", code: "NULL_RIG_STABLE_ID_COLLISION", message: "Requested null-rig stableId is already owned by a non-null layer.", details: { stableId: prepared.createSpec.stableId } }, [], null, startedAt, ["Stable identity collision prevented creation."]);
      return responseFor(request, "NO_OP", null, [], rigReadback(prepared.comp, prepared.rig), startedAt, ["Managed null with the requested stable identity already exists."]);
    }
    if (request.command === "rig.null.remove") {
      var children = childrenOf(prepared.comp, prepared.rig);
      if (children.length > 0) return responseFor(request, "REJECTED", { category: "CONFLICT", code: "NULL_RIG_HAS_CHILDREN", message: "Null rig cannot be removed while child relationships still target it.", details: { children: children, guidance: "Clear child parenting explicitly through protocol 1.4 before removing the rig." } }, [], rigReadback(prepared.comp, prepared.rig), startedAt, ["Removal refused to prevent implicit relationship destruction."]);
    }

    var beforeRevision = app.project ? app.project.revision : null;
    var mutationStarted = false;
    app.beginUndoGroup("EditFlow M3 managed null rig");
    try {
      mutationStarted = true;
      if (request.command === "rig.null.create") {
        var duration = null;
        if (typeof request.payload.duration === "number" && isFinite(request.payload.duration) && request.payload.duration > 0) duration = request.payload.duration;
        var rig = duration === null ? prepared.comp.layers.addNull() : prepared.comp.layers.addNull(duration);
        rig.name = typeof prepared.createSpec.name === "string" && prepared.createSpec.name.length > 0 ? prepared.createSpec.name : "EditFlow Null Rig";
        rig.comment = stableMarker(prepared.createSpec.stableId);
        if (request.payload.threeDLayer === true) rig.threeDLayer = true;
        prepared.rig = rig;
      } else {
        prepared.rig.remove();
      }
      app.endUndoGroup();

      if (request.command === "rig.null.create") {
        var readback = rigReadback(prepared.comp, prepared.rig);
        if (!readback.nullRig.isNull || !readback.nullRig.layer || readback.nullRig.layer.stableId !== prepared.createSpec.stableId) fail("ADAPTER_FAILURE", "NULL_RIG_CREATE_READBACK_MISMATCH", "Created null rig did not survive exact structural readback.");
        return responseFor(request, "APPLIED", null, [affected(prepared.rig)], readback, startedAt, ["Created managed AE null with caller-owned stable identity.", "Child attachment remains explicitly delegated to protocol 1.4 preserve-transform parenting."]);
      }
      var removedStableId = request.payload.rig.stableId || null;
      var after = findLayer(prepared.comp, request.payload.rig, true);
      if (after) fail("ADAPTER_FAILURE", "NULL_RIG_REMOVE_READBACK_MISMATCH", "Removed null rig still resolves after host mutation.");
      return responseFor(request, "APPLIED", null, [{ kind: "LAYER", stableId: removedStableId, hostId: null }], { nullRig: { removed: true, stableId: removedStableId } }, startedAt, ["Removed child-free managed null after exact absence readback."]);
    } catch (mutationError) {
      try { app.endUndoGroup(); } catch (_) {}
      var notes = ["Null-rig mutation failed."];
      var afterFailureRevision = app.project ? app.project.revision : null;
      if (mutationStarted && beforeRevision !== null && afterFailureRevision !== beforeRevision) {
        try { app.executeCommand(16); notes.push("Failed null-rig mutation self-rolled back with AE Undo."); }
        catch (rollbackError) { notes.push("Null-rig self-rollback attempt failed: " + asString(rollbackError)); }
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
