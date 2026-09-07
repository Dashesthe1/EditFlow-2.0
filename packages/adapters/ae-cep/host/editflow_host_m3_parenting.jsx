/* EditFlow 2.0 M3 parenting host layer.
 * Fixed typed protocol 1.4 commands only. No arbitrary code execution.
 *
 * Preserve-transform parenting uses direct Layer.parent assignment; setParentWithJump()
 * is intentionally forbidden. After Effects can compensate ordinary 2D transform
 * cases, but a rotated non-uniformly-scaled parent can require shear that a normal
 * AVLayer local Transform cannot represent. This host therefore verifies five-point
 * comp-space geometry after every set/clear mutation. If AE cannot preserve that
 * geometry, the mutation fails closed and the existing AE Undo recovery restores the
 * original relationship instead of returning a false APPLIED result.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") {
    throw new Error("EditFlow M3 parenting layer requires the existing dispatcher.");
  }

  var PROTOCOL = "1.4.0";
  var BUILD = "0.4.0-dev.4";
  var LAYER_STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var GEOMETRY_TOLERANCE = 0.05;

  var CAPABILITIES = {
    "layer.set_parent_preserve_transform": "ae.layer.parent.set_preserve_transform",
    "layer.clear_parent_preserve_transform": "ae.layer.parent.clear_preserve_transform",
    "layer.parenting_readback": "ae.layer.parenting.readback"
  };

  function nowMs() { return (new Date()).getTime(); }

  function asString(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function own(object, key) {
    return object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key);
  }

  function fail(category, code, message, details) {
    var error = new Error(message);
    error.editflowCategory = category;
    error.editflowCode = code;
    error.editflowDetails = details === undefined ? null : details;
    throw error;
  }

  function reject(code, message, details) {
    fail("VALIDATION", code, message, details);
  }

  function conflict(code, message, details) {
    fail("CONFLICT", code, message, details);
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

  function layerRefSnapshot(layer) {
    if (!layer) return null;
    var hostId = null;
    try { hostId = typeof layer.id === "number" ? layer.id : null; } catch (_) {}
    return {
      stableId: layerStableId(layer),
      hostId: hostId,
      index: layer.index,
      name: layer.name
    };
  }

  function propertyValueAtCompTime(group, matchName, compTime) {
    if (!group) return null;
    var property = null;
    try { property = group.property(matchName); } catch (_) { property = null; }
    if (!property) return null;
    try { return property.valueAtTime(compTime, false); } catch (_) {}
    try { return property.value; } catch (_) { return null; }
  }

  function plainPoint(value) {
    if (!value || typeof value.length !== "number" || value.length < 2) return null;
    var result = [];
    var i, coordinate;
    for (i = 0; i < value.length; i += 1) {
      coordinate = Number(value[i]);
      if (typeof coordinate !== "number" || !isFinite(coordinate)) return null;
      result.push(coordinate);
    }
    return result;
  }

  function transformSnapshot(layer, compTime) {
    var transform = null;
    try { transform = layer.property("ADBE Transform Group"); } catch (_) { transform = null; }
    if (!transform) return null;
    return {
      anchorPoint: plainPoint(propertyValueAtCompTime(transform, "ADBE Anchor Point", compTime)),
      position: plainPoint(propertyValueAtCompTime(transform, "ADBE Position", compTime)),
      scale: plainPoint(propertyValueAtCompTime(transform, "ADBE Scale", compTime)),
      orientation: plainPoint(propertyValueAtCompTime(transform, "ADBE Orientation", compTime)),
      xRotation: propertyValueAtCompTime(transform, "ADBE Rotate X", compTime),
      yRotation: propertyValueAtCompTime(transform, "ADBE Rotate Y", compTime),
      zRotation: propertyValueAtCompTime(transform, "ADBE Rotate Z", compTime),
      skew: propertyValueAtCompTime(transform, "ADBE Skew", compTime),
      skewAxis: propertyValueAtCompTime(transform, "ADBE Skew Axis", compTime)
    };
  }

  function sourcePointToCompSnapshot(layer, sourcePoint) {
    if (typeof layer.sourcePointToComp !== "function") return null;
    try { return plainPoint(layer.sourcePointToComp(sourcePoint)); } catch (_) { return null; }
  }

  function compSpaceAnchorSnapshot(layer, compTime) {
    var transform = null;
    var anchor = null;
    try { transform = layer.property("ADBE Transform Group"); } catch (_) { transform = null; }
    if (!transform) return { supported: false, point: null, reason: "TRANSFORM_GROUP_UNAVAILABLE" };
    anchor = plainPoint(propertyValueAtCompTime(transform, "ADBE Anchor Point", compTime));
    if (!anchor || anchor.length < 2 || typeof layer.sourcePointToComp !== "function") {
      return { supported: false, point: null, reason: "SOURCE_POINT_TO_COMP_UNAVAILABLE" };
    }
    var mapped = sourcePointToCompSnapshot(layer, [anchor[0], anchor[1]]);
    if (!mapped) return { supported: false, point: null, reason: "SOURCE_POINT_TO_COMP_FAILED" };
    return { supported: true, point: mapped, reason: null };
  }

  function sourceGeometrySnapshot(layer, compTime) {
    if (typeof layer.sourcePointToComp !== "function") {
      return { supported: false, reason: "SOURCE_POINT_TO_COMP_UNAVAILABLE", sourceRect: null, points: null };
    }

    var left = 0;
    var top = 0;
    var width = null;
    var height = null;
    var rect = null;
    try {
      if (typeof layer.sourceRectAtTime === "function") rect = layer.sourceRectAtTime(compTime, false);
    } catch (_) { rect = null; }
    if (rect && typeof rect.left === "number" && typeof rect.top === "number"
        && typeof rect.width === "number" && typeof rect.height === "number"
        && isFinite(rect.left) && isFinite(rect.top) && isFinite(rect.width) && isFinite(rect.height)
        && rect.width > 0 && rect.height > 0) {
      left = rect.left;
      top = rect.top;
      width = rect.width;
      height = rect.height;
    }

    if (width === null || height === null) {
      try {
        if (layer.source && typeof layer.source.width === "number" && typeof layer.source.height === "number"
            && isFinite(layer.source.width) && isFinite(layer.source.height)
            && layer.source.width > 0 && layer.source.height > 0) {
          width = layer.source.width;
          height = layer.source.height;
        }
      } catch (_) {}
    }

    if (width === null || height === null) {
      return { supported: false, reason: "SOURCE_BOUNDS_UNAVAILABLE", sourceRect: null, points: null };
    }

    var sourcePoints = {
      topLeft: [left, top],
      topRight: [left + width, top],
      bottomRight: [left + width, top + height],
      bottomLeft: [left, top + height],
      center: [left + width / 2, top + height / 2]
    };
    var mapped = {
      topLeft: sourcePointToCompSnapshot(layer, sourcePoints.topLeft),
      topRight: sourcePointToCompSnapshot(layer, sourcePoints.topRight),
      bottomRight: sourcePointToCompSnapshot(layer, sourcePoints.bottomRight),
      bottomLeft: sourcePointToCompSnapshot(layer, sourcePoints.bottomLeft),
      center: sourcePointToCompSnapshot(layer, sourcePoints.center)
    };
    if (!mapped.topLeft || !mapped.topRight || !mapped.bottomRight || !mapped.bottomLeft || !mapped.center) {
      return {
        supported: false,
        reason: "SOURCE_POINT_TO_COMP_FAILED",
        sourceRect: { left: left, top: top, width: width, height: height },
        points: mapped
      };
    }

    return {
      supported: true,
      reason: null,
      sourceRect: { left: left, top: top, width: width, height: height },
      points: mapped
    };
  }

  function pointNearlyEqual(left, right, tolerance) {
    if (!left || !right || typeof left.length !== "number" || typeof right.length !== "number" || left.length !== right.length) return false;
    var i;
    for (i = 0; i < left.length; i += 1) {
      if (Math.abs(Number(left[i]) - Number(right[i])) > tolerance) return false;
    }
    return true;
  }

  function geometryEquivalent(beforeGeometry, afterGeometry, tolerance) {
    if (!beforeGeometry || !afterGeometry || beforeGeometry.supported !== true || afterGeometry.supported !== true) return false;
    if (!beforeGeometry.points || !afterGeometry.points) return false;
    var keys = ["topLeft", "topRight", "bottomRight", "bottomLeft", "center"];
    var i, key;
    for (i = 0; i < keys.length; i += 1) {
      key = keys[i];
      if (!pointNearlyEqual(beforeGeometry.points[key], afterGeometry.points[key], tolerance)) return false;
    }
    return true;
  }

  function parentingReadback(comp, layer) {
    var parent = null;
    try { parent = layer.parent; } catch (_) { parent = null; }
    var compTime = 0;
    try { compTime = comp.time; } catch (_) {}
    return {
      parenting: {
        layer: layerRefSnapshot(layer),
        hasParent: parent !== null,
        parentLayer: layerRefSnapshot(parent),
        compTime: compTime,
        localTransform: transformSnapshot(layer, compTime),
        compSpaceAnchor: compSpaceAnchorSnapshot(layer, compTime),
        compSpaceGeometry: sourceGeometrySnapshot(layer, compTime)
      }
    };
  }

  function assertNoCycle(layer, parentLayer) {
    if (layer === parentLayer) reject("PARENT_SELF_REFERENCE", "A layer cannot parent itself.");
    var cursor = parentLayer;
    var guard = 0;
    while (cursor && guard <= 10000) {
      if (cursor === layer) reject("PARENT_CYCLE", "Parent assignment would create a parenting cycle.");
      try { cursor = cursor.parent; } catch (_) { cursor = null; }
      guard += 1;
    }
    if (guard > 10000) reject("PARENT_CHAIN_INVALID", "Parent chain exceeded the safety traversal limit.");
  }

  function affected(layer) {
    var ref = layerRefSnapshot(layer);
    return {
      kind: "LAYER",
      stableId: ref ? ref.stableId : null,
      hostId: ref ? ref.hostId : null
    };
  }

  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") {
      reject("EXPECTED_HOST_REVISION_REQUIRED", "Mutating parenting commands require expectedHostProjectRevision.");
    }
    var actual = app.project ? app.project.revision : null;
    if (actual !== request.expectedHostProjectRevision) {
      conflict("HOST_REVISION_CONFLICT", "Host project revision does not match the expected revision.", {
        expectedHostProjectRevision: request.expectedHostProjectRevision,
        actualHostProjectRevision: actual
      });
    }
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

  function errorPayload(error) {
    return {
      category: error && error.editflowCategory ? error.editflowCategory : "ADAPTER_FAILURE",
      code: error && error.editflowCode ? error.editflowCode : "M3_PARENTING_HOST_FAILURE",
      message: error && error.message ? String(error.message) : String(error),
      details: error && own(error, "editflowDetails") ? error.editflowDetails : null
    };
  }

  function parseAndPrepare(request) {
    if (!request || typeof request !== "object") reject("REQUEST_REQUIRED", "Protocol 1.4 request object is required.");
    if (!own(CAPABILITIES, request.command)) reject("PARENTING_COMMAND_UNSUPPORTED", "Unsupported protocol 1.4 parenting command: " + asString(request.command));
    if (request.capabilityId !== CAPABILITIES[request.command]) reject("CAPABILITY_COMMAND_MISMATCH", "capabilityId does not match the parenting command.");
    if (!request.payload || typeof request.payload !== "object") reject("PAYLOAD_REQUIRED", "Parenting payload object is required.");
    if (!request.payload.comp || !request.payload.layer) reject("PARENTING_TARGET_REQUIRED", "Parenting payload requires comp and layer references.");

    var comp = findComp(request.payload.comp);
    var layer = findLayer(comp, request.payload.layer);
    var parentLayer = null;
    if (request.command === "layer.set_parent_preserve_transform") {
      if (!request.payload.parentLayer) reject("PARENT_LAYER_REQUIRED", "set_parent_preserve_transform requires parentLayer.");
      parentLayer = findLayer(comp, request.payload.parentLayer);
      assertNoCycle(layer, parentLayer);
    }
    return { comp: comp, layer: layer, parentLayer: parentLayer };
  }

  function execute(request) {
    var startedAt = nowMs();
    var prepared;
    try {
      prepared = parseAndPrepare(request);
    } catch (preflightError) {
      return responseFor(request, "REJECTED", errorPayload(preflightError), [], null, startedAt, ["Parenting request rejected before mutation."]);
    }

    if (request.command === "layer.parenting_readback") {
      try {
        return responseFor(request, "NO_OP", null, [], parentingReadback(prepared.comp, prepared.layer), startedAt, ["Read-only parenting structural/geometry readback."]);
      } catch (readbackError) {
        return responseFor(request, "FAILED", errorPayload(readbackError), [], null, startedAt, ["Parenting readback failed without mutation."]);
      }
    }

    try {
      requireExpectedRevision(request);
    } catch (revisionError) {
      return responseFor(request, "REJECTED", errorPayload(revisionError), [], parentingReadback(prepared.comp, prepared.layer), startedAt, ["Parenting mutation rejected before mutation."]);
    }

    var currentParent = null;
    try { currentParent = prepared.layer.parent; } catch (_) { currentParent = null; }
    if (request.command === "layer.set_parent_preserve_transform" && currentParent === prepared.parentLayer) {
      return responseFor(request, "NO_OP", null, [], parentingReadback(prepared.comp, prepared.layer), startedAt, ["Requested parent relationship already exists."]);
    }
    if (request.command === "layer.clear_parent_preserve_transform" && currentParent === null) {
      return responseFor(request, "NO_OP", null, [], parentingReadback(prepared.comp, prepared.layer), startedAt, ["Layer is already unparented."]);
    }

    var beforeReadback = parentingReadback(prepared.comp, prepared.layer);
    var beforeGeometry = beforeReadback.parenting.compSpaceGeometry;
    if (!beforeGeometry || beforeGeometry.supported !== true) {
      return responseFor(request, "REJECTED", {
        category: "HOST_LIMITATION",
        code: "PARENT_PRESERVE_GEOMETRY_UNVERIFIABLE",
        message: "Preserve-transform parenting requires verifiable five-point comp-space source geometry for this direct-parent route.",
        details: { geometry: beforeGeometry || null }
      }, [], beforeReadback, startedAt, ["Parenting mutation refused because visual no-jump geometry cannot be verified for this layer type."]);
    }

    var beforeRevision = app.project ? app.project.revision : null;
    var mutationStarted = false;
    app.beginUndoGroup("EditFlow M3 preserve-transform parenting");
    try {
      mutationStarted = true;
      if (request.command === "layer.set_parent_preserve_transform") prepared.layer.parent = prepared.parentLayer;
      else prepared.layer.parent = null;

      if (request.command === "layer.set_parent_preserve_transform"
          && request.readbackProfile === "M3_PARENTING_P4_FAILURE_INJECTION"
          && $.getenv("EDITFLOW_M3_PARENTING_P4_PROOF") === "1") {
        var proofFailure = new Error("Induced M3 parenting P4 host failure after parent mutation.");
        proofFailure.editflowCategory = "PROOF_INJECTION";
        proofFailure.editflowCode = "M3_PARENTING_P4_INDUCED_FAILURE";
        throw proofFailure;
      }

      var readback = parentingReadback(prepared.comp, prepared.layer);
      if (request.command === "layer.set_parent_preserve_transform") {
        if (!readback.parenting.hasParent || !readback.parenting.parentLayer || readback.parenting.parentLayer.index !== prepared.parentLayer.index) {
          fail("ADAPTER_FAILURE", "PARENT_SET_READBACK_MISMATCH", "Parent assignment did not survive exact host readback.");
        }
      } else if (readback.parenting.hasParent) {
        fail("ADAPTER_FAILURE", "PARENT_CLEAR_READBACK_MISMATCH", "Parent clear did not survive exact host readback.");
      }

      if (!geometryEquivalent(beforeGeometry, readback.parenting.compSpaceGeometry, GEOMETRY_TOLERANCE)) {
        fail(
          "HOST_LIMITATION",
          "PARENT_PRESERVE_VISUAL_UNREPRESENTABLE",
          "After Effects could not represent the requested direct parent relationship while preserving the layer's five-point comp-space geometry.",
          {
            tolerance: GEOMETRY_TOLERANCE,
            beforeGeometry: beforeGeometry,
            afterGeometry: readback.parenting.compSpaceGeometry,
            guidance: "Use a representable direct-parent transform or a future managed rig/shim route for affine cases that require shear."
          }
        );
      }

      app.endUndoGroup();
      var affectedObjects = [affected(prepared.layer)];
      if (prepared.parentLayer) affectedObjects.push(affected(prepared.parentLayer));
      return responseFor(
        request,
        "APPLIED",
        null,
        affectedObjects,
        readback,
        startedAt,
        ["Applied direct Layer.parent assignment; setParentWithJump() was not used.", "Verified five-point comp-space geometry remained within the preserve-transform tolerance."]
      );
    } catch (mutationError) {
      try { app.endUndoGroup(); } catch (_) {}
      var notes = ["Parenting mutation failed."];
      var afterFailureRevision = app.project ? app.project.revision : null;
      if (mutationStarted && beforeRevision !== null && afterFailureRevision !== beforeRevision) {
        try {
          app.executeCommand(16);
          notes.push("Failed parenting mutation self-rolled back with AE Undo.");
        } catch (rollbackError) {
          notes.push("Parenting self-rollback attempt failed: " + asString(rollbackError));
        }
      }
      return responseFor(request, "FAILED", errorPayload(mutationError), [], parentingReadback(prepared.comp, prepared.layer), startedAt, notes);
    }
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {
      return previousDispatch(requestJson);
    }
    if (!request || request.protocolVersion !== PROTOCOL) return previousDispatch(requestJson);
    return $.global.EditFlow2_JSON.stringify(execute(request));
  };
}());
