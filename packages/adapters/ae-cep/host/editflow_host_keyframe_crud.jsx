/* EditFlow 2.0 keyframe CRUD extension for protocol 1.1.
 * Adds a typed removal mode to the existing property.set_keyframes command so M2
 * supports create/update/delete without introducing an arbitrary property script route.
 */
(function () {
  "use strict";

  var PROTOCOL = "1.1.0";
  var BUILD = "0.1.0-dev.5-keyframe-crud";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var innerDispatch = $.global.EditFlow2_dispatch;

  if (typeof innerDispatch !== "function") {
    throw new Error("EditFlow keyframe CRUD extension requires the protocol 1.1 dispatcher.");
  }

  function nowMs() { return (new Date()).getTime(); }
  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function getStableId(commentText) {
    var text = asString(commentText);
    var start = text.indexOf(STABLE_PREFIX);
    if (start < 0) return null;
    start += STABLE_PREFIX.length;
    var end = text.indexOf(STABLE_SUFFIX, start);
    return end < 0 ? null : text.substring(start, end);
  }
  function hostId(target) {
    try { return typeof target.id === "number" ? target.id : null; } catch (_) { return null; }
  }
  function findItem(ref) {
    var project = app.project;
    var i, item;
    if (ref && typeof ref.hostId === "number" && project.itemByID) {
      try { item = project.itemByID(ref.hostId); if (item) return item; } catch (_) {}
    }
    for (i = 1; i <= project.numItems; i += 1) {
      item = project.item(i);
      if (ref && ref.stableId && getStableId(item.comment) === ref.stableId) return item;
      if (ref && typeof ref.hostId === "number" && hostId(item) === ref.hostId) return item;
    }
    return null;
  }
  function findComp(ref) {
    var item = findItem(ref);
    if (!item || !(item instanceof CompItem)) throw new Error("Keyframe CRUD composition target could not be resolved.");
    return item;
  }
  function findLayer(comp, ref) {
    var i, layer;
    for (i = 1; i <= comp.numLayers; i += 1) {
      layer = comp.layer(i);
      if (ref && ref.stableId && getStableId(layer.comment) === ref.stableId) return layer;
      if (ref && typeof ref.hostId === "number" && hostId(layer) === ref.hostId) return layer;
    }
    throw new Error("Keyframe CRUD layer target could not be resolved.");
  }
  function resolveProperty(root, path) {
    var current = root;
    var i;
    if (!(path instanceof Array) || path.length === 0) throw new Error("propertyPath must be a non-empty array.");
    for (i = 0; i < path.length; i += 1) {
      if (!current || typeof current.property !== "function") throw new Error("propertyPath traversed a non-property group.");
      current = current.property(path[i]);
      if (!current) throw new Error("propertyPath segment could not be resolved: " + path[i]);
    }
    return current;
  }
  function failResponse(request, outcome, category, code, message, started, beforeRevision) {
    return {
      protocolVersion: PROTOCOL,
      requestId: request && request.requestId ? request.requestId : "unknown",
      transactionId: request && request.transactionId ? request.transactionId : "unknown",
      operationId: request && request.operationId ? request.operationId : "unknown",
      capabilityId: request && request.capabilityId ? request.capabilityId : "unknown",
      command: request && request.command ? request.command : "property.set_keyframes",
      outcome: outcome,
      error: { category: category, code: code, message: message },
      affectedObjects: [],
      readback: null,
      projectSnapshot: null,
      environmentProbe: null,
      hostProjectRevision: app.project ? app.project.revision : null,
      diagnostics: {
        adapterProtocolVersion: PROTOCOL,
        adapterBuild: BUILD,
        command: request && request.command ? request.command : "property.set_keyframes",
        durationMs: nowMs() - started,
        hostRevisionBefore: beforeRevision,
        hostRevisionAfter: app.project ? app.project.revision : null,
        notes: []
      },
      proofArtifactRefs: []
    };
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    var started = nowMs();
    var beforeRevision = app.project ? app.project.revision : null;
    try { request = JSON.parse(requestJson); } catch (_) { return innerDispatch(requestJson); }

    if (!request || request.command !== "property.set_keyframes"
        || !request.payload || request.payload.removeKeyIndices === undefined) {
      return innerDispatch(requestJson);
    }

    try {
      if (request.protocolVersion !== PROTOCOL) {
        return JSON.stringify(failResponse(request, "REJECTED", "VALIDATION_ERROR", "PROTOCOL_VERSION_MISMATCH",
          "Protocol 1.1.0 is required for typed keyframe removal.", started, beforeRevision));
      }
      if (!app.project) {
        return JSON.stringify(failResponse(request, "REJECTED", "VALIDATION_ERROR", "PROJECT_NOT_OPEN",
          "Typed keyframe removal requires an open After Effects project.", started, beforeRevision));
      }
      if (request.expectedHostProjectRevision !== null && request.expectedHostProjectRevision !== undefined
          && app.project.revision !== request.expectedHostProjectRevision) {
        return JSON.stringify(failResponse(request, "REJECTED", "STALE_PROJECT_STATE", "HOST_REVISION_MISMATCH",
          "After Effects revision changed before typed keyframe removal.", started, beforeRevision));
      }
      if (request.payload.keyframes !== undefined) {
        return JSON.stringify(failResponse(request, "REJECTED", "VALIDATION_ERROR", "KEYFRAME_MODE_CONFLICT",
          "property.set_keyframes accepts either keyframes or removeKeyIndices in one operation, not both.", started, beforeRevision));
      }

      var indices = request.payload.removeKeyIndices;
      if (!(indices instanceof Array) || indices.length === 0) {
        return JSON.stringify(failResponse(request, "REJECTED", "VALIDATION_ERROR", "REMOVE_KEY_INDICES_REQUIRED",
          "removeKeyIndices must be a non-empty array of positive integer key indices.", started, beforeRevision));
      }

      var comp = findComp(request.payload.comp);
      var layer = findLayer(comp, request.payload.layer);
      var property = resolveProperty(layer, request.payload.propertyPath);
      if (typeof property.removeKey !== "function") {
        return JSON.stringify(failResponse(request, "REJECTED", "CAPABILITY_UNAVAILABLE", "KEYFRAME_REMOVE_UNAVAILABLE",
          "The resolved After Effects property does not support removeKey().", started, beforeRevision));
      }

      var validated = [];
      var seen = {};
      var i, index;
      for (i = 0; i < indices.length; i += 1) {
        index = indices[i];
        if (typeof index !== "number" || index !== Math.floor(index) || index < 1) {
          return JSON.stringify(failResponse(request, "REJECTED", "VALIDATION_ERROR", "INVALID_KEY_INDEX",
            "Every removeKeyIndices entry must be a positive integer.", started, beforeRevision));
        }
        if (index > property.numKeys) {
          return JSON.stringify(failResponse(request, "REJECTED", "VALIDATION_ERROR", "KEY_INDEX_OUT_OF_RANGE",
            "Key index " + index + " exceeds current key count " + property.numKeys + ".", started, beforeRevision));
        }
        if (seen[String(index)]) {
          return JSON.stringify(failResponse(request, "REJECTED", "VALIDATION_ERROR", "DUPLICATE_KEY_INDEX",
            "removeKeyIndices must not contain duplicate indices.", started, beforeRevision));
        }
        seen[String(index)] = true;
        validated.push(index);
      }

      validated.sort(function (left, right) { return right - left; });
      var removedTimes = [];
      for (i = 0; i < validated.length; i += 1) {
        index = validated[i];
        try { removedTimes.push(property.keyTime(index)); } catch (_) { removedTimes.push(null); }
      }
      for (i = 0; i < validated.length; i += 1) property.removeKey(validated[i]);

      return JSON.stringify({
        protocolVersion: PROTOCOL,
        requestId: request.requestId,
        transactionId: request.transactionId,
        operationId: request.operationId,
        capabilityId: request.capabilityId,
        command: request.command,
        outcome: "APPLIED",
        error: null,
        affectedObjects: [],
        readback: {
          mode: "REMOVE_KEY_INDICES",
          removedCount: validated.length,
          removedKeyIndices: validated,
          removedKeyTimes: removedTimes,
          numKeys: property.numKeys
        },
        projectSnapshot: null,
        environmentProbe: null,
        hostProjectRevision: app.project.revision,
        diagnostics: {
          adapterProtocolVersion: PROTOCOL,
          adapterBuild: BUILD,
          command: request.command,
          durationMs: nowMs() - started,
          hostRevisionBefore: beforeRevision,
          hostRevisionAfter: app.project.revision,
          notes: ["Typed keyframe deletion validated all indices before mutation and removed them in descending index order."]
        },
        proofArtifactRefs: []
      });
    } catch (error) {
      return JSON.stringify(failResponse(request, "FAILED", "ADAPTER_FAILURE", "KEYFRAME_REMOVE_FAILED",
        asString(error), started, beforeRevision));
    }
  };
}());
