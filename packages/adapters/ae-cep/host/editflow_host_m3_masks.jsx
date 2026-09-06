/* EditFlow 2.0 M3 mask/Bezier host layer.
 * Fixed typed protocol 1.2 commands only. No arbitrary code execution.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") {
    throw new Error("EditFlow M3 mask layer requires the existing dispatcher.");
  }

  var PROTOCOL = "1.2.0";
  var BUILD = "0.4.0-dev.1";
  var LAYER_STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var MASK_STABLE_PREFIX = "[[EDITFLOW2_MASK:";
  var MARKER_SUFFIX = "]]";

  var CAPABILITIES = {
    "mask.create": "ae.mask.create",
    "mask.remove": "ae.mask.remove",
    "mask.duplicate": "ae.mask.duplicate",
    "mask.reorder": "ae.mask.order.set",
    "mask.set_path": "ae.mask.path.set",
    "mask.set_properties": "ae.mask.properties.set",
    "mask.readback": "ae.mask.readback"
  };

  function nowMs() { return (new Date()).getTime(); }

  function asString(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function isArrayLike(value) {
    if (value === null || value === undefined || typeof value === "string") return false;
    try { return typeof value.length === "number" && value.length >= 0; } catch (_) { return false; }
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

  function finiteNumber(value, label) {
    if (typeof value !== "number" || !isFinite(value)) reject("INVALID_NUMBER", label + " must be a finite number.");
    return value;
  }

  function positiveInteger(value, label) {
    if (typeof value !== "number" || value < 1 || value !== Math.floor(value)) {
      reject("INVALID_INTEGER", label + " must be an integer >= 1.");
    }
    return value;
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

  function maskStableId(mask) {
    try { return stableIdFromText(mask.name, MASK_STABLE_PREFIX); } catch (_) { return null; }
  }

  function cleanMaskName(mask) {
    var source = asString(mask.name);
    var start = source.indexOf(MASK_STABLE_PREFIX);
    if (start < 0) return source;
    return source.substring(0, start).replace(/\s+$/, "");
  }

  function setMaskIdentity(mask, stableId, displayName) {
    var id = asString(stableId);
    if (!id) reject("MASK_STABLE_ID_REQUIRED", "Mask stableId is required.");
    if (id.indexOf(MARKER_SUFFIX) >= 0) reject("INVALID_MASK_STABLE_ID", "Mask stableId contains a reserved marker terminator.");
    var name = asString(displayName).replace(/^\s+|\s+$/g, "");
    if (!name) name = "Mask";
    mask.name = name + " " + MASK_STABLE_PREFIX + id + MARKER_SUFFIX;
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

  function maskParade(layer) {
    var parade = layer.property("ADBE Mask Parade");
    if (!parade) reject("MASKS_UNAVAILABLE", "Target layer does not expose the AE mask group.");
    return parade;
  }

  function findMask(layer, ref) {
    if (!ref || typeof ref !== "object" || !ref.stableId) reject("MASK_REF_REQUIRED", "Mask stableId reference is required.");
    var parade = maskParade(layer);
    var i, mask;
    for (i = 1; i <= parade.numProperties; i += 1) {
      mask = parade.property(i);
      if (maskStableId(mask) === ref.stableId) return mask;
    }
    reject("MASK_NOT_FOUND", "Mask stableId did not resolve on the target layer: " + ref.stableId);
  }

  function copyPoint(raw, label) {
    if (!isArrayLike(raw) || raw.length !== 2) reject("INVALID_POINT", label + " must contain exactly two numbers.");
    return [finiteNumber(raw[0], label + "[0]"), finiteNumber(raw[1], label + "[1]")];
  }

  function copyPoints(raw, label) {
    if (!isArrayLike(raw)) reject("INVALID_POINT_ARRAY", label + " must be an array of 2D points.");
    var out = [], i;
    for (i = 0; i < raw.length; i += 1) out.push(copyPoint(raw[i], label + "[" + i + "]"));
    return out;
  }

  function copyNumbers(raw, label) {
    if (!isArrayLike(raw)) reject("INVALID_NUMBER_ARRAY", label + " must be an array of numbers.");
    var out = [], i;
    for (i = 0; i < raw.length; i += 1) out.push(finiteNumber(raw[i], label + "[" + i + "]"));
    return out;
  }

  function validateVariableFeather(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "object") reject("INVALID_VARIABLE_FEATHER", "variableFeather must be an object or null.");
    var result = {
      segLocs: copyNumbers(raw.segLocs, "variableFeather.segLocs"),
      relSegLocs: copyNumbers(raw.relSegLocs, "variableFeather.relSegLocs"),
      radii: copyNumbers(raw.radii, "variableFeather.radii"),
      interps: copyNumbers(raw.interps, "variableFeather.interps"),
      tensions: copyNumbers(raw.tensions, "variableFeather.tensions"),
      types: copyNumbers(raw.types, "variableFeather.types"),
      relCornerAngles: copyNumbers(raw.relCornerAngles, "variableFeather.relCornerAngles")
    };
    var count = result.segLocs.length;
    if (result.relSegLocs.length !== count || result.radii.length !== count || result.interps.length !== count
        || result.tensions.length !== count || result.types.length !== count || result.relCornerAngles.length !== count) {
      reject("VARIABLE_FEATHER_LENGTH_MISMATCH", "All variable-feather arrays must have identical lengths.");
    }
    return result;
  }

  function validateShape(raw) {
    if (!raw || typeof raw !== "object") reject("MASK_SHAPE_REQUIRED", "Mask shape must be an object.");
    if (typeof raw.closed !== "boolean") reject("MASK_CLOSED_REQUIRED", "Mask shape.closed must be boolean.");
    var vertices = copyPoints(raw.vertices, "shape.vertices");
    var inTangents = copyPoints(raw.inTangents, "shape.inTangents");
    var outTangents = copyPoints(raw.outTangents, "shape.outTangents");
    if (vertices.length < 2) reject("MASK_VERTEX_COUNT", "Mask shape requires at least two vertices.");
    if (inTangents.length !== vertices.length || outTangents.length !== vertices.length) {
      reject("MASK_TANGENT_LENGTH_MISMATCH", "Mask vertices, inTangents, and outTangents must have identical lengths.");
    }
    return {
      closed: raw.closed,
      vertices: vertices,
      inTangents: inTangents,
      outTangents: outTangents,
      variableFeather: validateVariableFeather(raw.variableFeather)
    };
  }

  function buildShape(validated) {
    var shape = new Shape();
    shape.closed = validated.closed;
    shape.vertices = validated.vertices;
    shape.inTangents = validated.inTangents;
    shape.outTangents = validated.outTangents;
    if (validated.variableFeather) {
      shape.featherSegLocs = validated.variableFeather.segLocs;
      shape.featherRelSegLocs = validated.variableFeather.relSegLocs;
      shape.featherRadii = validated.variableFeather.radii;
      shape.featherInterps = validated.variableFeather.interps;
      shape.featherTensions = validated.variableFeather.tensions;
      shape.featherTypes = validated.variableFeather.types;
      shape.featherRelCornerAngles = validated.variableFeather.relCornerAngles;
    }
    return shape;
  }

  function arrayFromHost(raw) {
    if (!isArrayLike(raw)) return [];
    var out = [], i;
    for (i = 0; i < raw.length; i += 1) out.push(raw[i]);
    return out;
  }

  function pointsFromHost(raw) {
    if (!isArrayLike(raw)) return [];
    var out = [], i;
    for (i = 0; i < raw.length; i += 1) out.push([Number(raw[i][0]), Number(raw[i][1])]);
    return out;
  }

  function snapshotShape(shape) {
    if (!shape) return null;
    var feather = null;
    try {
      var segLocs = arrayFromHost(shape.featherSegLocs);
      var relSegLocs = arrayFromHost(shape.featherRelSegLocs);
      var radii = arrayFromHost(shape.featherRadii);
      var interps = arrayFromHost(shape.featherInterps);
      var tensions = arrayFromHost(shape.featherTensions);
      var types = arrayFromHost(shape.featherTypes);
      var relCornerAngles = arrayFromHost(shape.featherRelCornerAngles);
      if (segLocs.length || relSegLocs.length || radii.length || interps.length || tensions.length || types.length || relCornerAngles.length) {
        feather = {
          segLocs: segLocs,
          relSegLocs: relSegLocs,
          radii: radii,
          interps: interps,
          tensions: tensions,
          types: types,
          relCornerAngles: relCornerAngles
        };
      }
    } catch (_) { feather = null; }
    return {
      closed: Boolean(shape.closed),
      vertices: pointsFromHost(shape.vertices),
      inTangents: pointsFromHost(shape.inTangents),
      outTangents: pointsFromHost(shape.outTangents),
      variableFeather: feather
    };
  }

  function maskModeFromString(value) {
    switch (value) {
      case "NONE": return MaskMode.NONE;
      case "ADD": return MaskMode.ADD;
      case "SUBTRACT": return MaskMode.SUBTRACT;
      case "INTERSECT": return MaskMode.INTERSECT;
      case "LIGHTEN": return MaskMode.LIGHTEN;
      case "DARKEN": return MaskMode.DARKEN;
      case "DIFFERENCE": return MaskMode.DIFFERENCE;
      default: reject("INVALID_MASK_MODE", "Unsupported mask mode: " + asString(value));
    }
  }

  function maskModeToString(value) {
    if (value === MaskMode.NONE) return "NONE";
    if (value === MaskMode.ADD) return "ADD";
    if (value === MaskMode.SUBTRACT) return "SUBTRACT";
    if (value === MaskMode.INTERSECT) return "INTERSECT";
    if (value === MaskMode.LIGHTEN) return "LIGHTEN";
    if (value === MaskMode.DARKEN) return "DARKEN";
    if (value === MaskMode.DIFFERENCE) return "DIFFERENCE";
    return "UNKNOWN";
  }

  function validateProperties(raw) {
    if (raw === null || raw === undefined) return {};
    if (typeof raw !== "object") reject("INVALID_MASK_PROPERTIES", "Mask properties must be an object.");
    var result = {};
    if (own(raw, "feather")) result.feather = copyPoint(raw.feather, "properties.feather");
    if (own(raw, "expansion")) result.expansion = finiteNumber(raw.expansion, "properties.expansion");
    if (own(raw, "opacity")) {
      result.opacity = finiteNumber(raw.opacity, "properties.opacity");
      if (result.opacity < 0 || result.opacity > 100) reject("MASK_OPACITY_RANGE", "Mask opacity must be between 0 and 100.");
    }
    if (own(raw, "mode")) {
      if (typeof raw.mode !== "string") reject("INVALID_MASK_MODE", "Mask mode must be a string enum.");
      result.mode = raw.mode;
      maskModeFromString(raw.mode);
    }
    if (own(raw, "inverted")) {
      if (typeof raw.inverted !== "boolean") reject("INVALID_MASK_INVERTED", "Mask inverted must be boolean.");
      result.inverted = raw.inverted;
    }
    return result;
  }

  function applyProperties(mask, properties) {
    if (own(properties, "feather")) mask.property("ADBE Mask Feather").setValue(properties.feather);
    if (own(properties, "expansion")) mask.property("ADBE Mask Offset").setValue(properties.expansion);
    if (own(properties, "opacity")) mask.property("ADBE Mask Opacity").setValue(properties.opacity);
    if (own(properties, "mode")) mask.maskMode = maskModeFromString(properties.mode);
    if (own(properties, "inverted")) mask.inverted = properties.inverted;
  }

  function snapshotMask(mask) {
    var path = mask.property("ADBE Mask Shape");
    var featherValue = null;
    try {
      var rawFeather = mask.property("ADBE Mask Feather").value;
      featherValue = [Number(rawFeather[0]), Number(rawFeather[1])];
    } catch (_) {}
    var keyframes = [], i;
    if (path) {
      for (i = 1; i <= path.numKeys; i += 1) {
        keyframes.push({ time: path.keyTime(i), shape: snapshotShape(path.keyValue(i)) });
      }
    }
    return {
      stableId: maskStableId(mask),
      name: cleanMaskName(mask),
      index: mask.propertyIndex,
      mode: maskModeToString(mask.maskMode),
      inverted: Boolean(mask.inverted),
      feather: featherValue,
      expansion: mask.property("ADBE Mask Offset").value,
      opacity: mask.property("ADBE Mask Opacity").value,
      path: path ? snapshotShape(path.value) : null,
      pathKeyframes: keyframes
    };
  }

  function validateCreate(payload) {
    if (!payload || typeof payload !== "object") reject("PAYLOAD_REQUIRED", "mask.create payload is required.");
    if (!payload.stableId) reject("MASK_STABLE_ID_REQUIRED", "mask.create stableId is required.");
    return {
      comp: payload.comp,
      layer: payload.layer,
      stableId: asString(payload.stableId),
      name: own(payload, "name") ? asString(payload.name) : "Mask",
      shape: own(payload, "shape") ? validateShape(payload.shape) : null,
      properties: validateProperties(payload.properties)
    };
  }

  function validateTargetPayload(payload) {
    if (!payload || typeof payload !== "object") reject("PAYLOAD_REQUIRED", "Mask target payload is required.");
    if (!payload.mask || !payload.mask.stableId) reject("MASK_REF_REQUIRED", "payload.mask.stableId is required.");
    return { comp: payload.comp, layer: payload.layer, mask: payload.mask };
  }

  function validateSetPath(payload) {
    var target = validateTargetPayload(payload);
    var hasShape = own(payload, "shape") && payload.shape !== null && payload.shape !== undefined;
    var hasKeys = own(payload, "keyframes") && payload.keyframes !== null && payload.keyframes !== undefined;
    if (hasShape === hasKeys) reject("MASK_PATH_EXACTLY_ONE", "mask.set_path requires exactly one of shape or keyframes.");
    target.shape = hasShape ? validateShape(payload.shape) : null;
    target.keyframes = null;
    if (hasKeys) {
      if (!isArrayLike(payload.keyframes) || payload.keyframes.length < 1) reject("MASK_PATH_KEYS_REQUIRED", "keyframes must be a non-empty array.");
      var keys = [], previousTime = null, i, item, time;
      for (i = 0; i < payload.keyframes.length; i += 1) {
        item = payload.keyframes[i];
        if (!item || typeof item !== "object") reject("INVALID_MASK_PATH_KEY", "Each mask path keyframe must be an object.");
        time = finiteNumber(item.time, "keyframes[" + i + "].time");
        if (previousTime !== null && time <= previousTime) reject("MASK_PATH_KEY_ORDER", "Mask path keyframe times must be strictly increasing.");
        previousTime = time;
        keys.push({ time: time, shape: validateShape(item.shape) });
      }
      target.keyframes = keys;
    }
    return target;
  }

  function removeAllPathKeys(path) {
    var i;
    for (i = path.numKeys; i >= 1; i -= 1) path.removeKey(i);
  }

  function setPath(mask, validated) {
    var path = mask.property("ADBE Mask Shape");
    if (!path) reject("MASK_PATH_UNAVAILABLE", "Target mask has no path property.");
    if (validated.shape) {
      if (path.numKeys > 0) reject("MASK_PATH_IS_ANIMATED", "Static mask path write refuses to erase existing animation; provide keyframes instead.");
      path.setValue(buildShape(validated.shape));
      return;
    }
    removeAllPathKeys(path);
    var i;
    for (i = 0; i < validated.keyframes.length; i += 1) {
      path.setValueAtTime(validated.keyframes[i].time, buildShape(validated.keyframes[i].shape));
    }
  }

  function cloneMask(source, parade, stableId, name) {
    var target = parade.addProperty("ADBE Mask Atom");
    setMaskIdentity(target, stableId, name || (cleanMaskName(source) + " Copy"));
    target.maskMode = source.maskMode;
    target.inverted = source.inverted;
    target.property("ADBE Mask Feather").setValue(source.property("ADBE Mask Feather").value);
    target.property("ADBE Mask Offset").setValue(source.property("ADBE Mask Offset").value);
    target.property("ADBE Mask Opacity").setValue(source.property("ADBE Mask Opacity").value);
    var sourcePath = source.property("ADBE Mask Shape");
    var targetPath = target.property("ADBE Mask Shape");
    var i;
    if (sourcePath.numKeys > 0) {
      for (i = 1; i <= sourcePath.numKeys; i += 1) targetPath.setValueAtTime(sourcePath.keyTime(i), sourcePath.keyValue(i));
    } else {
      targetPath.setValue(sourcePath.value);
    }
    return target;
  }

  function affected(kind, stableId, hostId) {
    return { kind: kind, stableId: stableId || null, hostId: typeof hostId === "number" ? hostId : null };
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
      code: error.editflowCode || "M3_MASK_OPERATION_FAILED",
      message: asString(error.message || error),
      details: null
    };
  }

  function prepare(request) {
    if (request.protocolVersion !== PROTOCOL) reject("PROTOCOL_MISMATCH", "M3 mask commands require protocol 1.2.0.");
    if (!CAPABILITIES[request.command]) reject("UNKNOWN_MASK_COMMAND", "Unknown M3 mask command.");
    if (request.capabilityId !== CAPABILITIES[request.command]) reject("CAPABILITY_COMMAND_MISMATCH", "Capability ID does not match the mask command.");
    if (!app.project) reject("PROJECT_REQUIRED", "After Effects project is not available.");

    var isReadback = request.command === "mask.readback";
    if (!isReadback) {
      if (typeof request.expectedHostProjectRevision !== "number") reject("HOST_REVISION_REQUIRED", "Mask mutations require expectedHostProjectRevision.");
      if (request.expectedHostProjectRevision !== app.project.revision) {
        conflict("HOST_REVISION_CONFLICT", "Expected host project revision does not match the live AE project revision.");
      }
    }

    if (request.command === "mask.create") return validateCreate(request.payload);
    if (request.command === "mask.set_path") return validateSetPath(request.payload);
    if (request.command === "mask.set_properties") {
      var propertiesTarget = validateTargetPayload(request.payload);
      propertiesTarget.properties = validateProperties(request.payload.properties);
      return propertiesTarget;
    }
    if (request.command === "mask.duplicate") {
      var duplicateTarget = validateTargetPayload(request.payload);
      if (!request.payload.stableId) reject("MASK_STABLE_ID_REQUIRED", "mask.duplicate stableId is required.");
      duplicateTarget.stableId = asString(request.payload.stableId);
      duplicateTarget.name = own(request.payload, "name") ? asString(request.payload.name) : null;
      return duplicateTarget;
    }
    if (request.command === "mask.reorder") {
      var reorderTarget = validateTargetPayload(request.payload);
      reorderTarget.index = positiveInteger(request.payload.index, "mask.reorder index");
      return reorderTarget;
    }
    return validateTargetPayload(request.payload);
  }

  function executePrepared(request, payload) {
    var comp = findComp(payload.comp);
    var layer = findLayer(comp, payload.layer);
    var mask, parade;

    if (request.command === "mask.create") {
      parade = maskParade(layer);
      var i;
      for (i = 1; i <= parade.numProperties; i += 1) {
        if (maskStableId(parade.property(i)) === payload.stableId) reject("MASK_STABLE_ID_EXISTS", "Mask stableId already exists on the target layer.");
      }
      mask = parade.addProperty("ADBE Mask Atom");
      setMaskIdentity(mask, payload.stableId, payload.name);
      if (payload.shape) mask.property("ADBE Mask Shape").setValue(buildShape(payload.shape));
      applyProperties(mask, payload.properties);
      return { mask: mask, readback: snapshotMask(mask), stableId: payload.stableId };
    }

    mask = findMask(layer, payload.mask);

    if (request.command === "mask.readback") {
      return { mask: mask, readback: snapshotMask(mask), stableId: maskStableId(mask) };
    }
    if (request.command === "mask.remove") {
      var removedStableId = maskStableId(mask);
      mask.remove();
      return { mask: null, readback: { removedStableId: removedStableId }, stableId: removedStableId };
    }
    if (request.command === "mask.duplicate") {
      parade = maskParade(layer);
      var copy = cloneMask(mask, parade, payload.stableId, payload.name);
      return { mask: copy, readback: snapshotMask(copy), stableId: payload.stableId };
    }
    if (request.command === "mask.reorder") {
      parade = maskParade(layer);
      if (payload.index > parade.numProperties) reject("MASK_ORDER_RANGE", "mask.reorder index exceeds the mask count.");
      mask.moveTo(payload.index);
      mask = findMask(layer, payload.mask);
      return { mask: mask, readback: snapshotMask(mask), stableId: maskStableId(mask) };
    }
    if (request.command === "mask.set_path") {
      setPath(mask, payload);
      return { mask: mask, readback: snapshotMask(mask), stableId: maskStableId(mask) };
    }
    if (request.command === "mask.set_properties") {
      applyProperties(mask, payload.properties);
      return { mask: mask, readback: snapshotMask(mask), stableId: maskStableId(mask) };
    }
    reject("UNKNOWN_MASK_COMMAND", "Unknown M3 mask command.");
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
        app.project ? app.project.revision : null, startedAt, ["Rejected before AE mutation."]));
    }

    if (request.command === "mask.readback") {
      try {
        var readOnlyResult = executePrepared(request, prepared);
        return JSON.stringify(responseFor(request, "NO_OP", null,
          [affected("MASK", readOnlyResult.stableId, null)], { mask: readOnlyResult.readback },
          app.project.revision, startedAt, ["Read-only M3 mask structural readback."]));
      } catch (readError) {
        return JSON.stringify(responseFor(request, "FAILED", errorPayload(readError), [], null,
          app.project ? app.project.revision : null, startedAt, ["Mask readback failed without mutation."]));
      }
    }

    var groupOpen = false;
    try {
      app.beginUndoGroup("EditFlow 2.0 M3 " + request.command);
      groupOpen = true;
      var result = executePrepared(request, prepared);
      app.endUndoGroup();
      groupOpen = false;
      return JSON.stringify(responseFor(request, "APPLIED", null,
        [affected("MASK", result.stableId, null)], { mask: result.readback }, app.project.revision, startedAt,
        ["M3 mask operation applied through typed protocol 1.2."]));
    } catch (operationError) {
      try { if (groupOpen) app.endUndoGroup(); } catch (_) {}
      var notes = ["M3 mask operation failed."];
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
