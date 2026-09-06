/* EditFlow 2.0 AE transform readback hardening.
 * Re-reads successful layer.set_transform values from AE and normalizes
 * array-like host vectors into plain JavaScript arrays for protocol JSON.
 * Requires the protocol 1.1 hardening layer to be loaded first.
 */
(function () {
  "use strict";

  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var previousDispatch = $.global.EditFlow2_dispatch;

  if (typeof previousDispatch !== "function") {
    throw new Error("EditFlow transform readback hardening requires an existing dispatcher.");
  }

  function asString(value) {
    return value === null || value === undefined ? "" : String(value);
  }

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
      try {
        item = project.itemByID(ref.hostId);
        if (item) return item;
      } catch (_) {}
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
    if (!item || !(item instanceof CompItem)) throw new Error("Transform readback could not resolve composition.");
    return item;
  }

  function findLayer(comp, ref) {
    var i, layer;
    if (ref && typeof ref.hostId === "number" && app.project.layerByID) {
      try {
        layer = app.project.layerByID(ref.hostId);
        if (layer && layer.containingComp === comp) return layer;
      } catch (_) {}
    }
    for (i = 1; i <= comp.numLayers; i += 1) {
      layer = comp.layer(i);
      if (ref && ref.stableId && getStableId(layer.comment) === ref.stableId) return layer;
      if (ref && typeof ref.hostId === "number" && hostId(layer) === ref.hostId) return layer;
    }
    throw new Error("Transform readback could not resolve layer.");
  }

  function scalarValue(property) {
    try {
      var value = property ? property.value : null;
      return typeof value === "number" ? value : null;
    } catch (_) {
      return null;
    }
  }

  function vectorValue(property, dimensions) {
    try {
      var value = property ? property.value : null;
      if (value === null || value === undefined) return null;

      var length = null;
      try { length = value.length; } catch (_) { length = null; }
      if (typeof length !== "number" || length < dimensions) return null;

      var out = [];
      var i;
      for (i = 0; i < dimensions; i += 1) {
        if (typeof value[i] !== "number") return null;
        out.push(value[i]);
      }
      return out;
    } catch (_) {
      return null;
    }
  }

  function transformSnapshot(layer) {
    var group = layer.property("ADBE Transform Group");
    if (!group) return {};
    var dimensions = layer.threeDLayer ? 3 : 2;
    return {
      anchorPoint: vectorValue(group.property("ADBE Anchor Point"), dimensions),
      position: vectorValue(group.property("ADBE Position"), dimensions),
      scale: vectorValue(group.property("ADBE Scale"), dimensions),
      rotation: scalarValue(group.property("ADBE Rotate Z")),
      opacity: scalarValue(group.property("ADBE Opacity"))
    };
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = JSON.parse(requestJson);
    var raw = previousDispatch(requestJson);
    var response = JSON.parse(raw);

    if (request.command === "layer.set_transform"
        && response.outcome !== "FAILED"
        && response.outcome !== "REJECTED") {
      var comp = findComp(request.payload.comp);
      var layer = findLayer(comp, request.payload.layer);
      response.readback = response.readback || {};
      response.readback.transform = transformSnapshot(layer);
      if (response.diagnostics) {
        response.diagnostics.notes = response.diagnostics.notes || [];
        response.diagnostics.notes.push("Transform vector readback normalized from AE array-like property values.");
      }
    }

    return JSON.stringify(response);
  };
}());
