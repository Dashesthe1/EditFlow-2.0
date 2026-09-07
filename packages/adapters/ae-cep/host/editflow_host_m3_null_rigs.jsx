/* EditFlow 2.0 M3 null-rig host layer.
 * Fixed typed protocol 1.5 commands only. No arbitrary code execution.
 *
 * This first null-rig tranche is deliberately 2D/AVLayer-only. It creates true
 * After Effects null layers and provides atomic multi-child bind/unbind operations
 * using direct Layer.parent assignment. Every relationship mutation captures and
 * verifies five-point comp-space child geometry. If any child cannot preserve the
 * visible geometry, the complete undo group fails closed and self-rolls back.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") {
    throw new Error("EditFlow M3 null-rig layer requires the existing dispatcher.");
  }

  var PROTOCOL = "1.5.0";
  var BUILD = "0.5.0-dev.1";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MARKER_SUFFIX = "]]";
  var GEOMETRY_TOLERANCE = 0.05;
  var MAX_CHILDREN = 128;

  var CAPABILITIES = {
    "layer.null_create": "ae.layer.null.create",
    "layer.null_readback": "ae.layer.null.readback",
    "rig.bind_children_to_null_preserve_transform": "ae.rig.null.bind_children_preserve_transform",
    "rig.unbind_children_from_null_preserve_transform": "ae.rig.null.unbind_children_preserve_transform",
    "rig.relationship_readback": "ae.rig.relationship.readback"
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

  function limitation(code, message, details) {
    fail("HOST_LIMITATION", code, message, details);
  }

  function stableIdFromText(text) {
    var source = asString(text);
    var start = source.indexOf(STABLE_PREFIX);
    if (start < 0) return null;
    start += STABLE_PREFIX.length;
    var end = source.indexOf(MARKER_SUFFIX, start);
    return end < 0 ? null : source.substring(start, end);
  }

  function itemStableId(item) {
    try { return stableIdFromText(item.comment); } catch (_) { return null; }
  }

  function layerStableId(layer) {
    try { return stableIdFromText(layer.comment); } catch (_) { return null; }
  }

  function stableMarker(stableId) {
    return STABLE_PREFIX + stableId + MARKER_SUFFIX;
  }

  function requireStableId(value, code) {
    if (typeof value !== "string" || value.length === 0 || value.length > 240) {
      reject(code || "STABLE_ID_REQUIRED", "A non-empty stableId of at most 240 characters is required.");
    }
    if (value.indexOf(MARKER_SUFFIX) >= 0) {
      reject(code || "STABLE_ID_INVALID", "stableId cannot contain the EditFlow marker terminator.");
    }
    return value;
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

  function findLayerByStableIdAnywhere(stableId) {
    var project = app.project;
    var i, j, item, layer;
    for (i = 1; i <= project.numItems; i += 1) {
      item = project.item(i);
      if (!(item instanceof CompItem)) continue;
      for (j = 1; j <= item.numLayers; j += 1) {
        layer = item.layer(j);
        if (layerStableId(layer) === stableId) return layer;
      }
    }
    return null;
  }

  function hostIdOf(layer) {
    try { return typeof layer.id === "number" ? layer.id : null; } catch (_) { return null; }
  }

  function layerRefSnapshot(layer) {
    if (!layer) return null;
    return {
      stableId: layerStableId(layer),
      hostId: hostIdOf(layer),
      index: layer.index,
      name: layer.name
    };
  }

  function affected(layer) {
    var ref = layerRefSnapshot(layer);
    return {
      kind: "LAYER",
      stableId: ref ? ref.stableId : null,
      hostId: ref ? ref.hostId : null
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
      if (!isFinite(coordinate)) return null;
      result.push(coordinate);
    }
    return result;
  }

  function sourcePointToCompSnapshot(layer, sourcePoint) {
    if (typeof layer.sourcePointToComp !== "function") return null;
    try { return plainPoint(layer.sourcePointToComp(sourcePoint)); } catch (_) { return null; }
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
      return { supported: false, reason: "SOURCE_POINT_TO_COMP_FAILED", sourceRect: { left: left, top: top, width: width, height: height }, points: mapped };
    }
    return { supported: true, reason: null, sourceRect: { left: left, top: top, width: width, height: height }, points: mapped };
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

  function transformPositionSnapshot(layer, compTime) {
    var transform = null;
    try { transform = layer.property("ADBE Transform Group"); } catch (_) { transform = null; }
    if (!transform) return null;
    return plainPoint(propertyValueAtCompTime(transform, "ADBE Position", compTime));
  }

  function isTrueNullLayer(layer) {
    try { return layer instanceof AVLayer && layer.nullLayer === true; } catch (_) { return false; }
  }

  function ensureTwoD(layer, role) {
    if (!(layer instanceof AVLayer)) limitation("NULL_RIG_LAYER_TYPE_UNSUPPORTED", role + " must be an AVLayer in protocol 1.5.");
    try {
      if (layer.threeDLayer === true) limitation("NULL_RIG_3D_UNSUPPORTED", role + " is 3D; protocol 1.5 null rigs are deliberately 2D-only.");
    } catch (_) {}
  }

  function nullReadback(comp, layer) {
    var compTime = 0;
    try { compTime = comp.time; } catch (_) {}
    var parent = null;
    try { parent = layer.parent; } catch (_) { parent = null; }
    return {
      nullLayer: {
        layer: layerRefSnapshot(layer),
        isNull: isTrueNullLayer(layer),
        threeDLayer: (function () { try { return layer.threeDLayer === true; } catch (_) { return null; } }()),
        position: transformPositionSnapshot(layer, compTime),
        hasParent: parent !== null,
        parentLayer: layerRefSnapshot(parent),
        compTime: compTime
      }
    };
  }

  function childRelationshipSnapshot(comp, layer) {
    var compTime = 0;
    try { compTime = comp.time; } catch (_) {}
    var parent = null;
    try { parent = layer.parent; } catch (_) { parent = null; }
    return {
      layer: layerRefSnapshot(layer),
      hasParent: parent !== null,
      parentLayer: layerRefSnapshot(parent),
      compSpaceGeometry: sourceGeometrySnapshot(layer, compTime)
    };
  }

  function relationshipReadback(comp, controller) {
    var directChildren = [];
    var i, layer, parent;
    for (i = 1; i <= comp.numLayers; i += 1) {
      layer = comp.layer(i);
      parent = null;
      try { parent = layer.parent; } catch (_) { parent = null; }
      if (parent === controller) directChildren.push(childRelationshipSnapshot(comp, layer));
    }
    return {
      relationship: {
        controller: nullReadback(comp, controller).nullLayer,
        childCount: directChildren.length,
        directChildren: directChildren
      }
    };
  }

  function assertNoCycle(layer, parentLayer) {
    if (layer === parentLayer) reject("NULL_RIG_SELF_REFERENCE", "A null controller cannot be one of its own children.");
    var cursor = parentLayer;
    var guard = 0;
    while (cursor && guard <= 10000) {
      if (cursor === layer) reject("NULL_RIG_PARENT_CYCLE", "Rig binding would create a parenting cycle.");
      try { cursor = cursor.parent; } catch (_) { cursor = null; }
      guard += 1;
    }
    if (guard > 10000) reject("NULL_RIG_PARENT_CHAIN_INVALID", "Parent chain exceeded the safety traversal limit.");
  }

  function requireExpectedRevision(request) {
    if (typeof request.expectedHostProjectRevision !== "number") {
      reject("EXPECTED_HOST_REVISION_REQUIRED", "Mutating null-rig commands require expectedHostProjectRevision.");
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
      code: error && error.editflowCode ? error.editflowCode : "M3_NULL_RIG_HOST_FAILURE",
      message: error && error.message ? String(error.message) : String(error),
      details: error && own(error, "editflowDetails") ? error.editflowDetails : null
    };
  }

  function resolveChildren(comp, refs, controller, requireDirectParent) {
    if (!(refs instanceof Array) || refs.length === 0) reject("NULL_RIG_CHILDREN_REQUIRED", "Rig relationship payload requires at least one child layer reference.");
    if (refs.length > MAX_CHILDREN) reject("NULL_RIG_CHILD_LIMIT", "Rig relationship payload exceeds the protocol 1.5 child limit of " + MAX_CHILDREN + ".");
    var result = [];
    var i, j, child, existingParent;
    for (i = 0; i < refs.length; i += 1) {
      child = findLayer(comp, refs[i]);
      ensureTwoD(child, "Rig child");
      if (child === controller) reject("NULL_RIG_SELF_REFERENCE", "A null controller cannot be one of its own children.");
      for (j = 0; j < result.length; j += 1) {
        if (result[j] === child) reject("NULL_RIG_DUPLICATE_CHILD", "Rig relationship payload cannot reference the same child layer more than once.");
      }
      if (requireDirectParent) {
        existingParent = null;
        try { existingParent = child.parent; } catch (_) { existingParent = null; }
        if (existingParent !== controller) reject("NULL_RIG_CHILD_NOT_BOUND", "Every unbind target must currently be a direct child of the requested null controller.", { child: layerRefSnapshot(child) });
      } else {
        assertNoCycle(child, controller);
      }
      result.push(child);
    }
    return result;
  }

  function preflightRelationship(request) {
    if (!request.payload.comp || !request.payload.controller) reject("NULL_RIG_TARGET_REQUIRED", "Rig relationship payload requires comp and controller references.");
    var comp = findComp(request.payload.comp);
    var controller = findLayer(comp, request.payload.controller);
    if (!isTrueNullLayer(controller)) reject("NULL_CONTROLLER_REQUIRED", "Rig controller must resolve to a true After Effects null layer (nullLayer === true).");
    ensureTwoD(controller, "Null controller");
    var children = resolveChildren(comp, request.payload.children, controller, request.command === "rig.unbind_children_from_null_preserve_transform");
    return { comp: comp, controller: controller, children: children };
  }

  function executeNullCreate(request, startedAt) {
    var comp;
    var stableId;
    try {
      if (!request.payload.comp) reject("COMP_REF_REQUIRED", "Null creation requires a composition reference.");
      comp = findComp(request.payload.comp);
      stableId = requireStableId(request.payload.stableId, "NULL_STABLE_ID_REQUIRED");
      if (own(request.payload, "name") && (typeof request.payload.name !== "string" || request.payload.name.length === 0 || request.payload.name.length > 255)) {
        reject("NULL_NAME_INVALID", "Null name must be a non-empty string of at most 255 characters when provided.");
      }
      if (own(request.payload, "position")) {
        if (!(request.payload.position instanceof Array) || request.payload.position.length !== 2
            || typeof request.payload.position[0] !== "number" || typeof request.payload.position[1] !== "number"
            || !isFinite(request.payload.position[0]) || !isFinite(request.payload.position[1])) {
          reject("NULL_POSITION_INVALID", "Null position must be a finite [x, y] pair when provided.");
        }
      }
    } catch (preflightError) {
      return responseFor(request, "REJECTED", errorPayload(preflightError), [], null, startedAt, ["Null creation rejected before mutation."]);
    }

    var existing = findLayerByStableIdAnywhere(stableId);
    if (existing) {
      if (existing.containingComp === comp && isTrueNullLayer(existing)) {
        return responseFor(request, "NO_OP", null, [], nullReadback(comp, existing), startedAt, ["True null with the requested stableId already exists in the target composition."]);
      }
      return responseFor(request, "REJECTED", {
        category: "CONFLICT",
        code: "NULL_STABLE_ID_COLLISION",
        message: "Requested null stableId is already owned by another layer.",
        details: { existingLayer: layerRefSnapshot(existing) }
      }, [], null, startedAt, ["Null creation rejected before mutation due to stable identity collision."]);
    }

    try { requireExpectedRevision(request); } catch (revisionError) {
      return responseFor(request, "REJECTED", errorPayload(revisionError), [], null, startedAt, ["Null creation rejected before mutation."]);
    }

    var beforeRevision = app.project ? app.project.revision : null;
    var mutationStarted = false;
    app.beginUndoGroup("EditFlow M3 create null controller");
    try {
      mutationStarted = true;
      var layer = comp.layers.addNull(comp.duration);
      layer.comment = stableMarker(stableId);
      if (own(request.payload, "name")) layer.name = request.payload.name;
      if (own(request.payload, "position")) {
        var transform = layer.property("ADBE Transform Group");
        var positionProperty = transform ? transform.property("ADBE Position") : null;
        if (!positionProperty) fail("ADAPTER_FAILURE", "NULL_POSITION_PROPERTY_MISSING", "Created null layer does not expose Position.");
        positionProperty.setValue([request.payload.position[0], request.payload.position[1]]);
      }
      if (!isTrueNullLayer(layer)) fail("ADAPTER_FAILURE", "NULL_CREATE_READBACK_MISMATCH", "After Effects did not create a true null layer.");
      ensureTwoD(layer, "Created null controller");
      if (layerStableId(layer) !== stableId) fail("ADAPTER_FAILURE", "NULL_STABLE_ID_READBACK_MISMATCH", "Created null stableId did not survive exact readback.");
      app.endUndoGroup();
      return responseFor(request, "APPLIED", null, [affected(layer)], nullReadback(comp, layer), startedAt, ["Created a true After Effects null layer via CompItem.layers.addNull()."]);
    } catch (mutationError) {
      try { app.endUndoGroup(); } catch (_) {}
      var notes = ["Null creation failed."];
      var afterFailureRevision = app.project ? app.project.revision : null;
      if (mutationStarted && beforeRevision !== null && afterFailureRevision !== beforeRevision) {
        try { app.executeCommand(16); notes.push("Failed null creation self-rolled back with AE Undo."); }
        catch (rollbackError) { notes.push("Null creation self-rollback attempt failed: " + asString(rollbackError)); }
      }
      return responseFor(request, "FAILED", errorPayload(mutationError), [], null, startedAt, notes);
    }
  }

  function executeRelationshipMutation(request, startedAt) {
    var prepared;
    try { prepared = preflightRelationship(request); }
    catch (preflightError) {
      return responseFor(request, "REJECTED", errorPayload(preflightError), [], null, startedAt, ["Null-rig relationship request rejected before mutation."]);
    }

    try { requireExpectedRevision(request); } catch (revisionError) {
      return responseFor(request, "REJECTED", errorPayload(revisionError), [], relationshipReadback(prepared.comp, prepared.controller), startedAt, ["Null-rig relationship mutation rejected before mutation."]);
    }

    var beforeGeometries = [];
    var anyMutation = false;
    var i, child, parent, geometry;
    for (i = 0; i < prepared.children.length; i += 1) {
      child = prepared.children[i];
      geometry = sourceGeometrySnapshot(child, prepared.comp.time);
      if (!geometry || geometry.supported !== true) {
        return responseFor(request, "REJECTED", {
          category: "HOST_LIMITATION",
          code: "NULL_RIG_PRESERVE_GEOMETRY_UNVERIFIABLE",
          message: "Null-rig preserve-transform mutation requires verifiable five-point comp-space geometry for every child.",
          details: { child: layerRefSnapshot(child), geometry: geometry || null }
        }, [], relationshipReadback(prepared.comp, prepared.controller), startedAt, ["Null-rig mutation refused because at least one child cannot be visually verified."]);
      }
      beforeGeometries.push(geometry);
      parent = null;
      try { parent = child.parent; } catch (_) { parent = null; }
      if (request.command === "rig.bind_children_to_null_preserve_transform") {
        if (parent !== prepared.controller) anyMutation = true;
      } else if (parent !== null) {
        anyMutation = true;
      }
    }

    if (!anyMutation) {
      return responseFor(request, "NO_OP", null, [], relationshipReadback(prepared.comp, prepared.controller), startedAt, ["Requested null-rig relationship already exists."]);
    }

    var beforeRevision = app.project ? app.project.revision : null;
    var mutationStarted = false;
    app.beginUndoGroup("EditFlow M3 null-rig relationship");
    try {
      mutationStarted = true;
      for (i = 0; i < prepared.children.length; i += 1) {
        child = prepared.children[i];
        if (request.command === "rig.bind_children_to_null_preserve_transform") child.parent = prepared.controller;
        else child.parent = null;
      }

      var affectedObjects = [affected(prepared.controller)];
      for (i = 0; i < prepared.children.length; i += 1) {
        child = prepared.children[i];
        parent = null;
        try { parent = child.parent; } catch (_) { parent = null; }
        if (request.command === "rig.bind_children_to_null_preserve_transform" && parent !== prepared.controller) {
          fail("ADAPTER_FAILURE", "NULL_RIG_BIND_READBACK_MISMATCH", "A child did not read back as a direct child of the null controller.", { child: layerRefSnapshot(child) });
        }
        if (request.command === "rig.unbind_children_from_null_preserve_transform" && parent !== null) {
          fail("ADAPTER_FAILURE", "NULL_RIG_UNBIND_READBACK_MISMATCH", "A child did not read back as unparented.", { child: layerRefSnapshot(child) });
        }
        var afterGeometry = sourceGeometrySnapshot(child, prepared.comp.time);
        if (!geometryEquivalent(beforeGeometries[i], afterGeometry, GEOMETRY_TOLERANCE)) {
          fail("HOST_LIMITATION", "NULL_RIG_PRESERVE_VISUAL_UNREPRESENTABLE", "After Effects could not represent the requested null-rig relationship while preserving a child's five-point comp-space geometry.", {
            child: layerRefSnapshot(child),
            tolerance: GEOMETRY_TOLERANCE,
            beforeGeometry: beforeGeometries[i],
            afterGeometry: afterGeometry
          });
        }
        affectedObjects.push(affected(child));
      }
      app.endUndoGroup();
      return responseFor(request, "APPLIED", null, affectedObjects, relationshipReadback(prepared.comp, prepared.controller), startedAt, ["Applied one atomic multi-child null-rig relationship mutation using direct Layer.parent assignment.", "Verified five-point comp-space geometry for every requested child."]);
    } catch (mutationError) {
      try { app.endUndoGroup(); } catch (_) {}
      var notes = ["Null-rig relationship mutation failed."];
      var afterFailureRevision = app.project ? app.project.revision : null;
      if (mutationStarted && beforeRevision !== null && afterFailureRevision !== beforeRevision) {
        try { app.executeCommand(16); notes.push("Failed null-rig mutation self-rolled back with AE Undo."); }
        catch (rollbackError) { notes.push("Null-rig self-rollback attempt failed: " + asString(rollbackError)); }
      }
      return responseFor(request, "FAILED", errorPayload(mutationError), [], relationshipReadback(prepared.comp, prepared.controller), startedAt, notes);
    }
  }

  function execute(request) {
    var startedAt = nowMs();
    if (!request || typeof request !== "object") return responseFor(request || {}, "REJECTED", { category: "VALIDATION", code: "REQUEST_REQUIRED", message: "Protocol 1.5 request object is required.", details: null }, [], null, startedAt, []);
    if (!own(CAPABILITIES, request.command)) return responseFor(request, "REJECTED", { category: "VALIDATION", code: "NULL_RIG_COMMAND_UNSUPPORTED", message: "Unsupported protocol 1.5 null-rig command: " + asString(request.command), details: null }, [], null, startedAt, []);
    if (request.capabilityId !== CAPABILITIES[request.command]) return responseFor(request, "REJECTED", { category: "VALIDATION", code: "CAPABILITY_COMMAND_MISMATCH", message: "capabilityId does not match the null-rig command.", details: null }, [], null, startedAt, []);
    if (!request.payload || typeof request.payload !== "object") return responseFor(request, "REJECTED", { category: "VALIDATION", code: "PAYLOAD_REQUIRED", message: "Null-rig payload object is required.", details: null }, [], null, startedAt, []);

    if (request.command === "layer.null_create") return executeNullCreate(request, startedAt);

    if (request.command === "layer.null_readback") {
      try {
        if (!request.payload.comp || !request.payload.layer) reject("NULL_TARGET_REQUIRED", "Null readback requires comp and layer references.");
        var readComp = findComp(request.payload.comp);
        var readLayer = findLayer(readComp, request.payload.layer);
        if (!isTrueNullLayer(readLayer)) reject("NULL_LAYER_REQUIRED", "Null readback target is not a true After Effects null layer.");
        return responseFor(request, "NO_OP", null, [], nullReadback(readComp, readLayer), startedAt, ["Read-only true-null structural readback."]);
      } catch (readError) {
        return responseFor(request, "REJECTED", errorPayload(readError), [], null, startedAt, ["Null readback rejected without mutation."]);
      }
    }

    if (request.command === "rig.relationship_readback") {
      try {
        if (!request.payload.comp || !request.payload.controller) reject("NULL_RIG_TARGET_REQUIRED", "Relationship readback requires comp and controller references.");
        var relComp = findComp(request.payload.comp);
        var controller = findLayer(relComp, request.payload.controller);
        if (!isTrueNullLayer(controller)) reject("NULL_CONTROLLER_REQUIRED", "Relationship controller must be a true After Effects null layer.");
        return responseFor(request, "NO_OP", null, [], relationshipReadback(relComp, controller), startedAt, ["Read-only direct-child null-rig relationship readback."]);
      } catch (relationshipError) {
        return responseFor(request, "REJECTED", errorPayload(relationshipError), [], null, startedAt, ["Relationship readback rejected without mutation."]);
      }
    }

    return executeRelationshipMutation(request, startedAt);
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
