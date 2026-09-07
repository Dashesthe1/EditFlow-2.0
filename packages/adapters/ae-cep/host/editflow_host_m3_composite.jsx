/* EditFlow 2.0 M3 composite host layer.
 * Fixed typed protocol 1.3 commands only. No arbitrary code execution.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") {
    throw new Error("EditFlow M3 composite layer requires the existing dispatcher.");
  }

  var PROTOCOL = "1.3.0";
  var BUILD = "0.4.0-dev.3";
  var LAYER_STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";

  var CAPABILITIES = {
    "layer.set_track_matte": "ae.layer.track_matte.set",
    "layer.clear_track_matte": "ae.layer.track_matte.clear",
    "layer.set_blend_mode": "ae.layer.blend_mode.set",
    "layer.composite_readback": "ae.layer.composite.readback"
  };

  function nowMs() { return (new Date()).getTime(); }

  function asString(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function own(object, key) {
    return object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key);
  }

  function reject(code, message) {
    var error = new Error(message);
    error.editflowCategory = "VALIDATION";
    error.editflowCode = code;
    throw error;
  }

  function conflict(code, message) {
    var error = new Error(message);
    error.editflowCategory = "CONFLICT";
    error.editflowCode = code;
    throw error;
  }

  function unsupported(code, message) {
    var error = new Error(message);
    error.editflowCategory = "HOST_UNSUPPORTED";
    error.editflowCode = code;
    throw error;
  }

  function stableIdFromText(text, prefix) {
    var source = asString(text);
    var start = source.indexOf(prefix);
    if (start < 0) return null;
    start += prefix.length;
    var end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }

  function layerStableId(layer) {
    try { return stableIdFromText(layer.comment, LAYER_STABLE_PREFIX); } catch (_) { return null; }
  }

  function findItem(ref) {
    if (!ref || typeof ref !== "object") reject("OBJECT_REF_REQUIRED", "Object reference is required.");
    var project = app.project;
    var i, item;
    if (typeof ref.hostId === "number" && project.itemByID) {
      try {
        item = project.itemByID(ref.hostId);
        if (item) return item;
      } catch (_) {}
    }
    for (i = 1; i <= project.numItems; i += 1) {
      item = project.item(i);
      if (ref.stableId && stableIdFromText(item.comment, LAYER_STABLE_PREFIX) === ref.stableId) return item;
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
      try {
        layer = app.project.layerByID(ref.hostId);
        if (layer && layer.containingComp === comp) return layer;
      } catch (_) {}
    }
    for (i = 1; i <= comp.numLayers; i += 1) {
      layer = comp.layer(i);
      if (ref.stableId && layerStableId(layer) === ref.stableId) return layer;
      try { if (typeof ref.hostId === "number" && layer.id === ref.hostId) return layer; } catch (_) {}
    }
    reject("LAYER_NOT_FOUND", "Layer reference did not resolve in the target composition.");
  }

  function requireAvLayer(layer, label) {
    if (!(layer instanceof AVLayer)) reject("AV_LAYER_REQUIRED", label + " must resolve to an AVLayer.");
    return layer;
  }

  function trackMatteTypeFromString(value) {
    switch (value) {
      case "ALPHA": return TrackMatteType.ALPHA;
      case "ALPHA_INVERTED": return TrackMatteType.ALPHA_INVERTED;
      case "LUMA": return TrackMatteType.LUMA;
      case "LUMA_INVERTED": return TrackMatteType.LUMA_INVERTED;
      default: reject("INVALID_TRACK_MATTE_TYPE", "Unsupported track matte type: " + asString(value));
    }
  }

  function trackMatteTypeToString(value) {
    if (value === TrackMatteType.ALPHA) return "ALPHA";
    if (value === TrackMatteType.ALPHA_INVERTED) return "ALPHA_INVERTED";
    if (value === TrackMatteType.LUMA) return "LUMA";
    if (value === TrackMatteType.LUMA_INVERTED) return "LUMA_INVERTED";
    if (value === TrackMatteType.NO_TRACK_MATTE) return "NO_TRACK_MATTE";
    return "UNKNOWN";
  }

  function blendModeFromString(value) {
    switch (value) {
      case "ADD": return BlendingMode.ADD;
      case "ALPHA_ADD": return BlendingMode.ALPHA_ADD;
      case "CLASSIC_COLOR_BURN": return BlendingMode.CLASSIC_COLOR_BURN;
      case "CLASSIC_COLOR_DODGE": return BlendingMode.CLASSIC_COLOR_DODGE;
      case "CLASSIC_DIFFERENCE": return BlendingMode.CLASSIC_DIFFERENCE;
      case "COLOR": return BlendingMode.COLOR;
      case "COLOR_BURN": return BlendingMode.COLOR_BURN;
      case "COLOR_DODGE": return BlendingMode.COLOR_DODGE;
      case "DANCING_DISSOLVE": return BlendingMode.DANCING_DISSOLVE;
      case "DARKEN": return BlendingMode.DARKEN;
      case "DARKER_COLOR": return BlendingMode.DARKER_COLOR;
      case "DIFFERENCE": return BlendingMode.DIFFERENCE;
      case "DISSOLVE": return BlendingMode.DISSOLVE;
      case "DIVIDE": return BlendingMode.DIVIDE;
      case "EXCLUSION": return BlendingMode.EXCLUSION;
      case "HARD_LIGHT": return BlendingMode.HARD_LIGHT;
      case "HARD_MIX": return BlendingMode.HARD_MIX;
      case "HUE": return BlendingMode.HUE;
      case "LIGHTEN": return BlendingMode.LIGHTEN;
      case "LIGHTER_COLOR": return BlendingMode.LIGHTER_COLOR;
      case "LINEAR_BURN": return BlendingMode.LINEAR_BURN;
      case "LINEAR_DODGE": return BlendingMode.LINEAR_DODGE;
      case "LINEAR_LIGHT": return BlendingMode.LINEAR_LIGHT;
      case "LUMINESCENT_PREMUL": return BlendingMode.LUMINESCENT_PREMUL;
      case "LUMINOSITY": return BlendingMode.LUMINOSITY;
      case "MULTIPLY": return BlendingMode.MULTIPLY;
      case "NORMAL": return BlendingMode.NORMAL;
      case "OVERLAY": return BlendingMode.OVERLAY;
      case "PIN_LIGHT": return BlendingMode.PIN_LIGHT;
      case "SATURATION": return BlendingMode.SATURATION;
      case "SCREEN": return BlendingMode.SCREEN;
      case "SILHOUETTE_ALPHA": return BlendingMode.SILHOUETE_ALPHA;
      case "SILHOUETTE_LUMA": return BlendingMode.SILHOUETTE_LUMA;
      case "SOFT_LIGHT": return BlendingMode.SOFT_LIGHT;
      case "STENCIL_ALPHA": return BlendingMode.STENCIL_ALPHA;
      case "STENCIL_LUMA": return BlendingMode.STENCIL_LUMA;
      case "SUBTRACT": return BlendingMode.SUBTRACT;
      case "VIVID_LIGHT": return BlendingMode.VIVID_LIGHT;
      default: reject("INVALID_BLEND_MODE", "Unsupported blend mode: " + asString(value));
    }
  }

  function blendModeToString(value) {
    if (value === BlendingMode.ADD) return "ADD";
    if (value === BlendingMode.ALPHA_ADD) return "ALPHA_ADD";
    if (value === BlendingMode.CLASSIC_COLOR_BURN) return "CLASSIC_COLOR_BURN";
    if (value === BlendingMode.CLASSIC_COLOR_DODGE) return "CLASSIC_COLOR_DODGE";
    if (value === BlendingMode.CLASSIC_DIFFERENCE) return "CLASSIC_DIFFERENCE";
    if (value === BlendingMode.COLOR) return "COLOR";
    if (value === BlendingMode.COLOR_BURN) return "COLOR_BURN";
    if (value === BlendingMode.COLOR_DODGE) return "COLOR_DODGE";
    if (value === BlendingMode.DANCING_DISSOLVE) return "DANCING_DISSOLVE";
    if (value === BlendingMode.DARKEN) return "DARKEN";
    if (value === BlendingMode.DARKER_COLOR) return "DARKER_COLOR";
    if (value === BlendingMode.DIFFERENCE) return "DIFFERENCE";
    if (value === BlendingMode.DISSOLVE) return "DISSOLVE";
    if (value === BlendingMode.DIVIDE) return "DIVIDE";
    if (value === BlendingMode.EXCLUSION) return "EXCLUSION";
    if (value === BlendingMode.HARD_LIGHT) return "HARD_LIGHT";
    if (value === BlendingMode.HARD_MIX) return "HARD_MIX";
    if (value === BlendingMode.HUE) return "HUE";
    if (value === BlendingMode.LIGHTEN) return "LIGHTEN";
    if (value === BlendingMode.LIGHTER_COLOR) return "LIGHTER_COLOR";
    if (value === BlendingMode.LINEAR_BURN) return "LINEAR_BURN";
    if (value === BlendingMode.LINEAR_DODGE) return "LINEAR_DODGE";
    if (value === BlendingMode.LINEAR_LIGHT) return "LINEAR_LIGHT";
    if (value === BlendingMode.LUMINESCENT_PREMUL) return "LUMINESCENT_PREMUL";
    if (value === BlendingMode.LUMINOSITY) return "LUMINOSITY";
    if (value === BlendingMode.MULTIPLY) return "MULTIPLY";
    if (value === BlendingMode.NORMAL) return "NORMAL";
    if (value === BlendingMode.OVERLAY) return "OVERLAY";
    if (value === BlendingMode.PIN_LIGHT) return "PIN_LIGHT";
    if (value === BlendingMode.SATURATION) return "SATURATION";
    if (value === BlendingMode.SCREEN) return "SCREEN";
    if (value === BlendingMode.SILHOUETE_ALPHA) return "SILHOUETTE_ALPHA";
    if (value === BlendingMode.SILHOUETTE_LUMA) return "SILHOUETTE_LUMA";
    if (value === BlendingMode.SOFT_LIGHT) return "SOFT_LIGHT";
    if (value === BlendingMode.STENCIL_ALPHA) return "STENCIL_ALPHA";
    if (value === BlendingMode.STENCIL_LUMA) return "STENCIL_LUMA";
    if (value === BlendingMode.SUBTRACT) return "SUBTRACT";
    if (value === BlendingMode.VIVID_LIGHT) return "VIVID_LIGHT";
    return "UNKNOWN";
  }

  function layerRefSnapshot(layer) {
    if (!layer) return null;
    var hostId = null;
    try { if (typeof layer.id === "number") hostId = layer.id; } catch (_) {}
    return {
      stableId: layerStableId(layer),
      hostId: hostId,
      index: layer.index,
      name: asString(layer.name)
    };
  }

  function snapshotComposite(layer) {
    var matteLayer = null;
    var hasTrackMatte = false;
    var type = "NO_TRACK_MATTE";
    try { hasTrackMatte = Boolean(layer.hasTrackMatte); } catch (_) {}
    try { matteLayer = layer.trackMatteLayer; } catch (_) { matteLayer = null; }
    try { type = trackMatteTypeToString(layer.trackMatteType); } catch (_) { type = "UNKNOWN"; }
    return {
      layer: layerRefSnapshot(layer),
      hasTrackMatte: hasTrackMatte,
      trackMatteType: type,
      trackMatteLayer: layerRefSnapshot(matteLayer),
      blendMode: blendModeToString(layer.blendingMode)
    };
  }

  function validateTargetPayload(payload) {
    if (!payload || typeof payload !== "object") reject("PAYLOAD_REQUIRED", "Composite payload is required.");
    if (!payload.comp || typeof payload.comp !== "object") reject("COMP_REF_REQUIRED", "payload.comp is required.");
    if (!payload.layer || typeof payload.layer !== "object") reject("LAYER_REF_REQUIRED", "payload.layer is required.");
    return { comp: payload.comp, layer: payload.layer };
  }

  function validateSetTrackMatte(payload) {
    var target = validateTargetPayload(payload);
    if (!payload.matteLayer || typeof payload.matteLayer !== "object") {
      reject("MATTE_LAYER_REF_REQUIRED", "layer.set_track_matte requires payload.matteLayer.");
    }
    if (typeof payload.trackMatteType !== "string") {
      reject("TRACK_MATTE_TYPE_REQUIRED", "layer.set_track_matte requires a string trackMatteType.");
    }
    trackMatteTypeFromString(payload.trackMatteType);
    target.matteLayer = payload.matteLayer;
    target.trackMatteType = payload.trackMatteType;
    return target;
  }

  function validateSetBlendMode(payload) {
    var target = validateTargetPayload(payload);
    if (typeof payload.blendMode !== "string") reject("BLEND_MODE_REQUIRED", "layer.set_blend_mode requires a string blendMode.");
    blendModeFromString(payload.blendMode);
    target.blendMode = payload.blendMode;
    return target;
  }

  function affectedLayer(layer) {
    var hostId = null;
    try { if (typeof layer.id === "number") hostId = layer.id; } catch (_) {}
    return { kind: "LAYER", stableId: layerStableId(layer), hostId: hostId };
  }

  function responseFor(request, outcome, error, affectedObjects, readback, revision, startedAt, notes) {
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
      hostProjectRevision: revision,
      diagnostics: {
        adapterProtocolVersion: PROTOCOL,
        adapterBuild: BUILD,
        command: request.command,
        durationMs: nowMs() - startedAt,
        notes: notes || []
      }
    };
  }

  function errorPayload(error) {
    return {
      category: error.editflowCategory || "HOST_OPERATION",
      code: error.editflowCode || "M3_COMPOSITE_OPERATION_FAILED",
      message: asString(error.message || error),
      details: null
    };
  }

  function prepare(request) {
    if (request.protocolVersion !== PROTOCOL) reject("PROTOCOL_MISMATCH", "M3 composite commands require protocol 1.3.0.");
    if (!CAPABILITIES[request.command]) reject("UNKNOWN_COMPOSITE_COMMAND", "Unknown M3 composite command.");
    if (request.capabilityId !== CAPABILITIES[request.command]) {
      reject("CAPABILITY_COMMAND_MISMATCH", "Capability ID does not match the composite command.");
    }
    if (!app.project) reject("PROJECT_REQUIRED", "After Effects project is not available.");

    var isReadback = request.command === "layer.composite_readback";
    if (!isReadback) {
      if (typeof request.expectedHostProjectRevision !== "number") {
        reject("HOST_REVISION_REQUIRED", "Composite mutations require expectedHostProjectRevision.");
      }
      if (request.expectedHostProjectRevision !== app.project.revision) {
        conflict("HOST_REVISION_CONFLICT", "Expected host project revision does not match the live AE project revision.");
      }
    }

    if (request.command === "layer.set_track_matte") return validateSetTrackMatte(request.payload);
    if (request.command === "layer.set_blend_mode") return validateSetBlendMode(request.payload);
    return validateTargetPayload(request.payload);
  }

  function executePrepared(request, payload) {
    var comp = findComp(payload.comp);
    var layer = requireAvLayer(findLayer(comp, payload.layer), "Target layer");
    var matte, desired, changed;

    if (request.command === "layer.composite_readback") {
      return { layer: layer, matte: null, changed: false, readback: snapshotComposite(layer) };
    }

    if (request.command === "layer.set_track_matte") {
      if (typeof layer.setTrackMatte !== "function") {
        unsupported("TRACK_MATTE_API_UNAVAILABLE", "The host does not expose AVLayer.setTrackMatte; After Effects 23.0 or newer is required.");
      }
      matte = requireAvLayer(findLayer(comp, payload.matteLayer), "Matte source layer");
      if (matte === layer) reject("TRACK_MATTE_SELF_REFERENCE", "A layer cannot use itself as its track matte source.");
      desired = trackMatteTypeFromString(payload.trackMatteType);
      changed = true;
      try { changed = !(Boolean(layer.hasTrackMatte) && layer.trackMatteLayer === matte && layer.trackMatteType === desired); } catch (_) {}
      if (changed) layer.setTrackMatte(matte, desired);
      return { layer: layer, matte: matte, changed: changed, readback: snapshotComposite(layer) };
    }

    if (request.command === "layer.clear_track_matte") {
      if (typeof layer.removeTrackMatte !== "function") {
        unsupported("TRACK_MATTE_API_UNAVAILABLE", "The host does not expose AVLayer.removeTrackMatte; After Effects 23.0 or newer is required.");
      }
      changed = false;
      try { changed = Boolean(layer.hasTrackMatte); } catch (_) {}
      if (changed) layer.removeTrackMatte();
      return { layer: layer, matte: null, changed: changed, readback: snapshotComposite(layer) };
    }

    if (request.command === "layer.set_blend_mode") {
      desired = blendModeFromString(payload.blendMode);
      changed = layer.blendingMode !== desired;
      if (changed) layer.blendingMode = desired;
      return { layer: layer, matte: null, changed: changed, readback: snapshotComposite(layer) };
    }

    reject("UNKNOWN_COMPOSITE_COMMAND", "Unknown M3 composite command.");
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request;
    try { request = JSON.parse(requestJson); } catch (_) { return previousDispatch(requestJson); }

    if (!request || request.protocolVersion !== PROTOCOL || !CAPABILITIES[request.command]) {
      return previousDispatch(requestJson);
    }

    var startedAt = nowMs();
    var revisionBefore = app.project ? app.project.revision : null;
    var prepared;
    try {
      prepared = prepare(request);
    } catch (validationError) {
      var validationOutcome = validationError.editflowCategory === "VALIDATION" || validationError.editflowCategory === "CONFLICT"
        ? "REJECTED" : "FAILED";
      return JSON.stringify(responseFor(request, validationOutcome, errorPayload(validationError), [], null,
        app.project ? app.project.revision : null, startedAt, ["Rejected before AE composite mutation."]));
    }

    if (request.command === "layer.composite_readback") {
      try {
        var readOnlyResult = executePrepared(request, prepared);
        return JSON.stringify(responseFor(request, "NO_OP", null,
          [affectedLayer(readOnlyResult.layer)], { composite: readOnlyResult.readback },
          app.project.revision, startedAt, ["Read-only M3 composite structural readback."]));
      } catch (readError) {
        return JSON.stringify(responseFor(request, "FAILED", errorPayload(readError), [], null,
          app.project ? app.project.revision : null, startedAt, ["Composite readback failed without mutation."]));
      }
    }

    var groupOpen = false;
    try {
      app.beginUndoGroup("EditFlow 2.0 M3 " + request.command);
      groupOpen = true;
      var result = executePrepared(request, prepared);
      app.endUndoGroup();
      groupOpen = false;

      var affected = [affectedLayer(result.layer)];
      if (result.matte) affected.push(affectedLayer(result.matte));
      return JSON.stringify(responseFor(request, result.changed ? "APPLIED" : "NO_OP", null,
        affected, { composite: result.readback }, app.project.revision, startedAt,
        [result.changed ? "M3 composite operation applied through typed protocol 1.3." : "M3 composite request already matched live host state."]));
    } catch (operationError) {
      try { if (groupOpen) app.endUndoGroup(); } catch (_) {}
      var notes = ["M3 composite operation failed."];
      try {
        if (app.project && revisionBefore !== null && app.project.revision !== revisionBefore) {
          app.executeCommand(16);
          notes.push("Failed mutation self-rolled back with AE Undo.");
        }
      } catch (rollbackError) {
        notes.push("Self-rollback attempt failed: " + asString(rollbackError));
      }
      return JSON.stringify(responseFor(request, "FAILED", errorPayload(operationError), [], null,
        app.project ? app.project.revision : null, startedAt, notes));
    }
  };
}());
