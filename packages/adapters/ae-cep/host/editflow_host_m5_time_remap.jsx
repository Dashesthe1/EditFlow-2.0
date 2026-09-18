/*
 * EditFlow 2.0 tutorial-derived native Time Remap activation.
 * Fixed typed protocol 2.7 commands only. No arbitrary code execution.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("M5 Time Remap requires the existing dispatcher.");

  var PROTOCOL = "2.7.0";
  var BUILD = "0.7.0-dev.1";
  var CAP_ENABLE = "ae.layer.time_remap.enable";
  var CAP_READ = "ae.layer.time_remap.readback";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";

  function nowMs() { return (new Date()).getTime(); }
  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function finite(value) { return typeof value === "number" && isFinite(value); }
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
    var end;
    if (start < 0) return null;
    start += prefix.length;
    end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }
  function stableIdFromText(text) { return markerValue(text, STABLE_PREFIX); }
  function itemStableId(item) { try { return stableIdFromText(item.comment); } catch (_) { return null; } }
  function layerStableId(layer) { try { return stableIdFromText(layer.comment); } catch (_) { return null; } }
  function hostIdOf(object) { try { return typeof object.id === "number" ? object.id : null; } catch (_) { return null; } }

  function findItem(ref) {
    if (!ref || typeof ref !== "object") reject("OBJECT_REF_REQUIRED", "Object reference is required.");
    var project = app.project;
    var i;
    var item;
    if (!project) reject("PROJECT_REQUIRED", "An open project is required.");
    if (typeof ref.hostId === "number" && project.itemByID) {
      try {
        item = project.itemByID(ref.hostId);
        if (item) return item;
      } catch (_) {}
    }
    for (i = 1; i <= project.numItems; i += 1) {
      item = project.item(i);
      if (ref.stableId && itemStableId(item) === ref.stableId) return item;
      try {
        if (typeof ref.hostId === "number" && item.id === ref.hostId) return item;
      } catch (_) {}
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
    var i;
    var layer;
    if (typeof ref.hostId === "number" && app.project.layerByID) {
      try {
        layer = app.project.layerByID(ref.hostId);
        if (layer && layer.containingComp === comp) return layer;
      } catch (_) {}
    }
    for (i = 1; i <= comp.numLayers; i += 1) {
      layer = comp.layer(i);
      if (ref.stableId && layerStableId(layer) === ref.stableId) return layer;
      try {
        if (typeof ref.hostId === "number" && layer.id === ref.hostId) return layer;
      } catch (_) {}
    }
    reject("LAYER_NOT_FOUND", "Layer reference did not resolve in the target composition.");
  }

  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") {
      reject("EXPECTED_HOST_REVISION_REQUIRED", "Time Remap enable requires expectedHostProjectRevision.");
    }
    var actual = app.project ? app.project.revision : null;
    if (actual !== request.expectedHostProjectRevision) {
      conflict(
        "HOST_REVISION_CONFLICT",
        "Host project revision does not match expected revision.",
        { expectedHostProjectRevision: request.expectedHostProjectRevision, actualHostProjectRevision: actual }
      );
    }
  }

  function readTimeRemap(layer) {
    var canSet = false;
    var enabled = false;
    var property = null;
    var keys = [];
    var i;
    try { canSet = layer.canSetTimeRemapEnabled === true; } catch (_) {}
    try { enabled = layer.timeRemapEnabled === true; } catch (_) {}
    try { property = layer.property("ADBE Time Remapping"); } catch (_) { property = null; }
    if (property) {
      for (i = 1; i <= property.numKeys; i += 1) {
        keys.push({
          index: i,
          time: Number(property.keyTime(i)),
          value: Number(property.keyValue(i))
        });
      }
    }
    return {
      layer: {
        stableId: layerStableId(layer),
        hostId: hostIdOf(layer),
        name: asString(layer.name),
        index: layer.index
      },
      canSetTimeRemapEnabled: canSet,
      timeRemapEnabled: enabled,
      propertyAvailable: property !== null,
      propertyMatchName: property ? asString(property.matchName) : null,
      numKeys: property ? property.numKeys : 0,
      keys: keys
    };
  }

  function sameNumber(left, right) {
    return finite(left) && finite(right) && Math.abs(Number(left) - Number(right)) <= 0.000001;
  }

  function sameReadback(left, right) {
    if (!left || !right) return false;
    if (left.layer.stableId !== right.layer.stableId
      || left.layer.hostId !== right.layer.hostId
      || left.canSetTimeRemapEnabled !== right.canSetTimeRemapEnabled
      || left.timeRemapEnabled !== right.timeRemapEnabled
      || left.propertyAvailable !== right.propertyAvailable
      || left.propertyMatchName !== right.propertyMatchName
      || left.numKeys !== right.numKeys
      || left.keys.length !== right.keys.length) return false;
    var i;
    for (i = 0; i < left.keys.length; i += 1) {
      if (left.keys[i].index !== right.keys[i].index
        || !sameNumber(left.keys[i].time, right.keys[i].time)
        || !sameNumber(left.keys[i].value, right.keys[i].value)) return false;
    }
    return true;
  }

  function affected(layer) {
    return [{ kind: "LAYER", stableId: layerStableId(layer), hostId: hostIdOf(layer) }];
  }

  function response(request, outcome, error, affectedObjects, readback, started, notes) {
    return $.global.EditFlow2_JSON.stringify({
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
        durationMs: nowMs() - started,
        notes: notes || []
      }
    });
  }

  function errorPayload(error) {
    return {
      category: error.editflowCategory || "HOST_FAILURE",
      code: error.editflowCode || "TIME_REMAP_HOST_FAILURE",
      message: asString(error.message || error),
      details: error.editflowDetails === undefined ? null : error.editflowDetails
    };
  }

  function maybeInjectFailure(request) {
    if (request.readbackProfile === "M5_TIME_REMAP_P4_FAILURE_INJECTION"
      && $.getenv("EDITFLOW_M5_TIME_REMAP_P4_PROOF") === "1") {
      fail(
        "PROOF_INJECTION",
        "M5_TIME_REMAP_P4_INDUCED_FAILURE",
        "Induced failure after Time Remap activation for rollback proof."
      );
    }
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) { return previousDispatch(requestJson); }
    if (!request || request.protocolVersion !== PROTOCOL
      || (request.command !== "layer.time_remap.enable"
        && request.command !== "layer.time_remap.readback")) return previousDispatch(requestJson);

    var started = nowMs();
    var payload = request.payload || {};
    var comp = null;
    var layer = null;
    var baseline = null;
    var mutationStarted = false;
    var undoOpen = false;

    try {
      var expectedCapability = request.command === "layer.time_remap.enable" ? CAP_ENABLE : CAP_READ;
      if (request.capabilityId !== expectedCapability) {
        reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match Time Remap command.");
      }

      comp = findComp(payload.comp);
      layer = findLayer(comp, payload.layer);
      baseline = readTimeRemap(layer);

      if (request.command === "layer.time_remap.readback") {
        return response(
          request,
          "NO_OP",
          null,
          [],
          baseline,
          started,
          ["Read-only native Time Remap availability and key-structure readback."]
        );
      }

      requireExpectedRevision(request);

      if (baseline.timeRemapEnabled) {
        return response(
          request,
          "NO_OP",
          null,
          [],
          baseline,
          started,
          ["Native Time Remap was already enabled; existing curve state was preserved."]
        );
      }
      if (!baseline.canSetTimeRemapEnabled) {
        reject(
          "TIME_REMAP_NOT_SUPPORTED",
          "The target layer does not allow native Time Remapping.",
          { actual: baseline }
        );
      }

      app.beginUndoGroup("EditFlow M5 Time Remap enable");
      undoOpen = true;
      mutationStarted = true;
      layer.timeRemapEnabled = true;

      var after = readTimeRemap(layer);
      if (!after.timeRemapEnabled
        || !after.propertyAvailable
        || after.propertyMatchName !== "ADBE Time Remapping"
        || after.numKeys < 2) {
        fail(
          "READBACK",
          "TIME_REMAP_ENABLE_READBACK_MISMATCH",
          "After Effects did not expose a usable native Time Remap property after enable.",
          { actual: after }
        );
      }

      maybeInjectFailure(request);

      app.endUndoGroup();
      undoOpen = false;
      return response(
        request,
        "APPLIED",
        null,
        affected(layer),
        after,
        started,
        ["Native Time Remapping enabled and generated key structure read back exactly."]
      );
    } catch (error) {
      var closeError = null;
      if (undoOpen) {
        try { app.endUndoGroup(); } catch (endError) { closeError = endError; }
        undoOpen = false;
      }

      if (mutationStarted) {
        var rollbackError = closeError;
        if (!rollbackError) {
          try { app.executeCommand(16); } catch (undoError) { rollbackError = undoError; }
        }
        if (rollbackError) {
          return response(
            request,
            "FAILED",
            {
              category: "ROLLBACK_FAILURE",
              code: "TIME_REMAP_ROLLBACK_FAILED",
              message: asString(rollbackError),
              details: { mutationError: errorPayload(error) }
            },
            [],
            null,
            started,
            ["Time Remap activation failed and transaction undo also failed."]
          );
        }

        var restored = readTimeRemap(layer);
        if (!sameReadback(restored, baseline)) {
          return response(
            request,
            "FAILED",
            {
              category: "ROLLBACK_FAILURE",
              code: "TIME_REMAP_ROLLBACK_READBACK_MISMATCH",
              message: "Time Remap undo completed but exact baseline readback was not restored.",
              details: { mutationError: errorPayload(error), expected: baseline, actual: restored }
            },
            [],
            restored,
            started,
            ["Time Remap rollback failed exact structural verification."]
          );
        }
        return response(
          request,
          "FAILED",
          errorPayload(error),
          [],
          restored,
          started,
          ["Time Remap activation failed and exact baseline state was restored through AE Undo."]
        );
      }

      return response(
        request,
        error.editflowCategory === "VALIDATION" || error.editflowCategory === "CONFLICT"
          ? "REJECTED"
          : "FAILED",
        errorPayload(error),
        [],
        baseline,
        started,
        ["Protocol 2.7 Time Remap command failed closed before host mutation."]
      );
    }
  };

  $.global.EditFlow2_HOST_PROTOCOL_27 = true;
}());
