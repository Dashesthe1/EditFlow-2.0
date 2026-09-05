/*
 * EditFlow 2.0 clean-room After Effects host adapter.
 * Fixed typed dispatcher only. No caller-supplied code execution.
 */
(function () {
  var PROTOCOL = "1.0.0";
  var BUILD = "0.1.0-dev.2";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";

  function nowMs() { return (new Date()).getTime(); }
  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function isObject(value) { return value !== null && typeof value === "object"; }

  function fail(category, code, message, details) {
    return { category: category, code: code, message: message, details: details || null };
  }

  function getStableId(commentText) {
    var text = asString(commentText);
    var start = text.indexOf(STABLE_PREFIX);
    if (start < 0) return null;
    start += STABLE_PREFIX.length;
    var end = text.indexOf(STABLE_SUFFIX, start);
    if (end < 0) return null;
    return text.substring(start, end);
  }

  function setStableId(target, stableId) {
    if (!target || !stableId || target.comment === undefined) return;
    var text = asString(target.comment);
    var start = text.indexOf(STABLE_PREFIX);
    if (start >= 0) {
      var end = text.indexOf(STABLE_SUFFIX, start + STABLE_PREFIX.length);
      if (end >= 0) text = text.substring(0, start) + text.substring(end + STABLE_SUFFIX.length);
    }
    target.comment = text + (text.length ? "\n" : "") + STABLE_PREFIX + stableId + STABLE_SUFFIX;
  }

  function hostId(target) {
    try { return typeof target.id === "number" ? target.id : null; } catch (_) { return null; }
  }

  function itemKind(item) {
    if (item instanceof CompItem) return "COMPOSITION";
    if (item instanceof FolderItem) return "FOLDER";
    return "FOOTAGE";
  }

  function layerKind(layer) {
    try {
      if (layer instanceof CameraLayer) return "LAYER_CAMERA";
      if (layer instanceof LightLayer) return "LAYER_LIGHT";
      if (layer instanceof TextLayer) return "LAYER_TEXT";
      if (layer instanceof ShapeLayer) return "LAYER_SHAPE";
      if (layer.nullLayer) return "LAYER_NULL";
      if (layer instanceof AVLayer) return "LAYER_AV";
    } catch (_) {}
    return "LAYER_UNKNOWN";
  }

  function safePropertyValue(property) {
    try {
      var value = property.value;
      if (value instanceof Array) return value.slice(0);
      if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
    } catch (_) {}
    return null;
  }

  function transformSnapshot(layer) {
    var group = layer.property("ADBE Transform Group");
    if (!group) return {};
    return {
      anchorPoint: safePropertyValue(group.property("ADBE Anchor Point")),
      position: safePropertyValue(group.property("ADBE Position")),
      scale: safePropertyValue(group.property("ADBE Scale")),
      rotation: safePropertyValue(group.property("ADBE Rotate Z")),
      opacity: safePropertyValue(group.property("ADBE Opacity"))
    };
  }

  function layerSnapshot(layer) {
    var source = null;
    try { source = layer.source || null; } catch (_) {}
    var parent = null;
    try { parent = layer.parent || null; } catch (_) {}
    return {
      hostId: hostId(layer),
      stableId: getStableId(layer.comment),
      index: layer.index,
      name: layer.name,
      kind: layerKind(layer),
      sourceHostId: source ? hostId(source) : null,
      sourceStableId: source ? getStableId(source.comment) : null,
      startTime: layer.startTime,
      inPoint: layer.inPoint,
      outPoint: layer.outPoint,
      stretch: layer.stretch,
      parentStableId: parent ? getStableId(parent.comment) : null,
      transform: transformSnapshot(layer),
      enabled: layer.enabled,
      locked: layer.locked,
      shy: layer.shy,
      solo: layer.solo,
      threeDLayer: layer.threeDLayer,
      adjustmentLayer: layer.adjustmentLayer
    };
  }

  function compSnapshot(comp) {
    var layers = [];
    var i;
    for (i = 1; i <= comp.numLayers; i += 1) layers.push(layerSnapshot(comp.layer(i)));
    return {
      hostId: hostId(comp),
      stableId: getStableId(comp.comment),
      name: comp.name,
      width: comp.width,
      height: comp.height,
      pixelAspect: comp.pixelAspect,
      duration: comp.duration,
      frameRate: comp.frameRate,
      displayStartTime: comp.displayStartTime,
      layers: layers
    };
  }

  function projectSnapshot() {
    var project = app.project;
    var items = [];
    var i;
    for (i = 1; i <= project.numItems; i += 1) {
      var item = project.item(i);
      var parent = null;
      try { parent = item.parentFolder || null; } catch (_) {}
      var snapshot = {
        hostId: hostId(item),
        stableId: getStableId(item.comment),
        kind: itemKind(item),
        name: item.name,
        parentHostId: parent ? hostId(parent) : null,
        comment: asString(item.comment)
      };
      if (item instanceof CompItem) snapshot.composition = compSnapshot(item);
      items.push(snapshot);
    }
    var active = project.activeItem;
    return {
      hostRevision: project.revision,
      filePath: project.file ? project.file.fsName : null,
      activeItemHostId: active ? hostId(active) : null,
      itemCount: project.numItems,
      items: items
    };
  }

  function environmentProbe() {
    return {
      adapterProtocolVersion: PROTOCOL,
      adapterBuild: BUILD,
      hostName: "Adobe After Effects",
      hostVersion: app.version,
      hostBuild: app.buildNumber !== undefined ? asString(app.buildNumber) : null,
      os: $.os ? asString($.os) : null,
      projectOpen: app.project !== null
    };
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
    if (!item || !(item instanceof CompItem)) throw new Error("Composition target could not be resolved.");
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
    throw new Error("Layer target could not be resolved unambiguously.");
  }

  function resolveProperty(root, path) {
    var current = root;
    var i;
    if (!(path instanceof Array) || path.length === 0) throw new Error("Property path must be a non-empty array.");
    for (i = 0; i < path.length; i += 1) {
      if (!current || !current.property) throw new Error("Property path traversed a non-property group.");
      current = current.property(path[i]);
      if (!current) throw new Error("Property path segment could not be resolved: " + path[i]);
    }
    return current;
  }

  function result(outcome, readback, affected) {
    return { outcome: outcome, readback: readback || null, affectedObjects: affected || [] };
  }

  var handlers = {};

  handlers["host.probe"] = function () {
    return { outcome: "NO_OP", environmentProbe: environmentProbe(), readback: null, affectedObjects: [] };
  };

  handlers["project.inspect"] = function () {
    return { outcome: "NO_OP", projectSnapshot: projectSnapshot(), readback: null, affectedObjects: [] };
  };

  handlers["project.save"] = function (payload) {
    var file = null;
    if (payload.path) file = new File(payload.path);
    else if (app.project.file) file = app.project.file;
    else throw new Error("project.save requires an explicit path for an unsaved project.");
    app.project.save(file);
    return result("APPLIED", { filePath: app.project.file ? app.project.file.fsName : null }, []);
  };

  handlers["comp.create"] = function (payload) {
    if (!payload.stableId) throw new Error("comp.create requires stableId.");
    var comp = app.project.items.addComp(
      payload.name,
      payload.width,
      payload.height,
      payload.pixelAspect,
      payload.duration,
      payload.frameRate
    );
    setStableId(comp, payload.stableId);
    if (payload.displayStartTime !== undefined) comp.displayStartTime = payload.displayStartTime;
    return result("APPLIED", { composition: compSnapshot(comp) }, [{ stableId: payload.stableId, hostId: hostId(comp), kind: "COMPOSITION" }]);
  };

  handlers["comp.update_settings"] = function (payload) {
    var comp = findComp(payload.comp);
    var settings = payload.settings || {};
    if (settings.width !== undefined) comp.width = settings.width;
    if (settings.height !== undefined) comp.height = settings.height;
    if (settings.pixelAspect !== undefined) comp.pixelAspect = settings.pixelAspect;
    if (settings.duration !== undefined) comp.duration = settings.duration;
    if (settings.frameRate !== undefined) comp.frameRate = settings.frameRate;
    if (settings.displayStartTime !== undefined) comp.displayStartTime = settings.displayStartTime;
    return result("APPLIED", { composition: compSnapshot(comp) }, []);
  };

  handlers["comp.remove"] = function (payload) {
    var comp = findComp(payload.comp);
    var stableId = getStableId(comp.comment);
    var id = hostId(comp);
    comp.remove();
    return result("APPLIED", { removed: true }, stableId ? [{ stableId: stableId, hostId: id, kind: "COMPOSITION" }] : []);
  };

  handlers["media.import"] = function (payload) {
    if (!payload.path || !payload.stableId) throw new Error("media.import requires path and stableId.");
    var options = new ImportOptions(new File(payload.path));
    if (payload.sequence !== undefined) options.sequence = Boolean(payload.sequence);
    var item = app.project.importFile(options);
    setStableId(item, payload.stableId);
    return result("APPLIED", { itemHostId: hostId(item), name: item.name }, [{ stableId: payload.stableId, hostId: hostId(item), kind: itemKind(item) }]);
  };

  handlers["layer.add_media"] = function (payload) {
    if (!payload.stableId) throw new Error("layer.add_media requires stableId.");
    var comp = findComp(payload.comp);
    var item = findItem(payload.item);
    if (!item) throw new Error("Source project item could not be resolved.");
    var layer = comp.layers.add(item);
    setStableId(layer, payload.stableId);
    if (payload.duration !== undefined) layer.outPoint = layer.inPoint + payload.duration;
    return result("APPLIED", { layer: layerSnapshot(layer) }, [{ stableId: payload.stableId, hostId: hostId(layer), kind: layerKind(layer) }]);
  };

  handlers["layer.duplicate"] = function (payload) {
    if (!payload.stableId) throw new Error("layer.duplicate requires new stableId.");
    var comp = findComp(payload.comp);
    var source = findLayer(comp, payload.layer);
    var copy = source.duplicate();
    setStableId(copy, payload.stableId);
    return result("APPLIED", { layer: layerSnapshot(copy) }, [{ stableId: payload.stableId, hostId: hostId(copy), kind: layerKind(copy) }]);
  };

  handlers["layer.remove"] = function (payload) {
    var comp = findComp(payload.comp);
    var layer = findLayer(comp, payload.layer);
    var stableId = getStableId(layer.comment);
    var id = hostId(layer);
    var kind = layerKind(layer);
    layer.remove();
    return result("APPLIED", { removed: true }, stableId ? [{ stableId: stableId, hostId: id, kind: kind }] : []);
  };

  handlers["layer.reorder"] = function (payload) {
    var comp = findComp(payload.comp);
    var layer = findLayer(comp, payload.layer);
    if (payload.position === "BEGINNING") layer.moveToBeginning();
    else if (payload.position === "END") layer.moveToEnd();
    else if (payload.position === "BEFORE") layer.moveBefore(findLayer(comp, payload.relativeTo));
    else if (payload.position === "AFTER") layer.moveAfter(findLayer(comp, payload.relativeTo));
    else throw new Error("Unsupported layer.reorder position.");
    return result("APPLIED", { layer: layerSnapshot(layer) }, []);
  };

  handlers["layer.set_transform"] = function (payload) {
    var comp = findComp(payload.comp);
    var layer = findLayer(comp, payload.layer);
    var group = layer.property("ADBE Transform Group");
    var values = payload.values || {};
    var map = {
      anchorPoint: "ADBE Anchor Point",
      position: "ADBE Position",
      scale: "ADBE Scale",
      rotation: "ADBE Rotate Z",
      opacity: "ADBE Opacity"
    };
    var key;
    for (key in map) if (map.hasOwnProperty(key) && values[key] !== undefined) {
      var property = group.property(map[key]);
      if (!property) throw new Error("Transform property unavailable: " + key);
      property.setValue(values[key]);
    }
    return result("APPLIED", { transform: transformSnapshot(layer) }, []);
  };

  handlers["layer.set_timing"] = function (payload) {
    var comp = findComp(payload.comp);
    var layer = findLayer(comp, payload.layer);
    var timing = payload.timing || {};
    if (timing.startTime !== undefined) layer.startTime = timing.startTime;
    if (timing.inPoint !== undefined) layer.inPoint = timing.inPoint;
    if (timing.outPoint !== undefined) layer.outPoint = timing.outPoint;
    if (timing.stretch !== undefined) layer.stretch = timing.stretch;
    return result("APPLIED", { layer: layerSnapshot(layer) }, []);
  };

  handlers["effect.add"] = function (payload) {
    if (!payload.matchName) throw new Error("effect.add requires matchName.");
    var comp = findComp(payload.comp);
    var layer = findLayer(comp, payload.layer);
    var effects = layer.property("ADBE Effect Parade");
    if (!effects || !effects.canAddProperty(payload.matchName)) throw new Error("Effect cannot be added: " + payload.matchName);
    var effect = effects.addProperty(payload.matchName);
    if (payload.name) effect.name = payload.name;
    return result("APPLIED", { propertyIndex: effect.propertyIndex, matchName: effect.matchName, name: effect.name }, []);
  };

  handlers["effect.remove"] = function (payload) {
    var comp = findComp(payload.comp);
    var layer = findLayer(comp, payload.layer);
    var effects = layer.property("ADBE Effect Parade");
    var effect = effects.property(payload.effectIndex);
    if (!effect) throw new Error("Effect index could not be resolved.");
    effect.remove();
    return result("APPLIED", { removed: true }, []);
  };

  handlers["effect.set_property"] = function (payload) {
    var comp = findComp(payload.comp);
    var layer = findLayer(comp, payload.layer);
    var effects = layer.property("ADBE Effect Parade");
    var effect = effects.property(payload.effectIndex);
    if (!effect) throw new Error("Effect index could not be resolved.");
    var property = resolveProperty(effect, payload.propertyPath);
    property.setValue(payload.value);
    return result("APPLIED", { value: safePropertyValue(property) }, []);
  };

  function resolveLayerProperty(payload) {
    var comp = findComp(payload.comp);
    var layer = findLayer(comp, payload.layer);
    return resolveProperty(layer, payload.propertyPath);
  }

  handlers["property.set_keyframes"] = function (payload) {
    var property = resolveLayerProperty(payload);
    var keyframes = payload.keyframes;
    if (!(keyframes instanceof Array) || keyframes.length === 0) throw new Error("property.set_keyframes requires keyframes.");
    var times = [], values = [], i;
    for (i = 0; i < keyframes.length; i += 1) {
      times.push(keyframes[i].time);
      values.push(keyframes[i].value);
    }
    property.setValuesAtTimes(times, values);
    return result("APPLIED", { numKeys: property.numKeys }, []);
  };

  handlers["property.set_expression"] = function (payload) {
    var property = resolveLayerProperty(payload);
    if (!property.canSetExpression) throw new Error("Target property cannot accept expressions.");
    property.expression = asString(payload.expression);
    property.expressionEnabled = payload.enabled === undefined ? true : Boolean(payload.enabled);
    return result("APPLIED", { expression: property.expression, enabled: property.expressionEnabled }, []);
  };

  handlers["layers.precompose"] = function (payload) {
    if (!payload.stableId) throw new Error("layers.precompose requires child comp stableId.");
    var comp = findComp(payload.comp);
    if (!(payload.layers instanceof Array) || payload.layers.length === 0) throw new Error("layers.precompose requires layers.");
    var indices = [], i;
    for (i = 0; i < payload.layers.length; i += 1) indices.push(findLayer(comp, payload.layers[i]).index);
    var child = comp.layers.precompose(indices, payload.name, payload.moveAllAttributes !== false);
    setStableId(child, payload.stableId);
    return result("APPLIED", { composition: compSnapshot(child) }, [{ stableId: payload.stableId, hostId: hostId(child), kind: "COMPOSITION" }]);
  };

  handlers["render.capture"] = function (payload) {
    var comp = findComp(payload.comp);
    if (!payload.outputPath) throw new Error("render.capture requires outputPath.");
    var rqItem = app.project.renderQueue.items.add(comp);
    if (payload.timeSpanStart !== undefined) rqItem.timeSpanStart = payload.timeSpanStart;
    if (payload.timeSpanDuration !== undefined) rqItem.timeSpanDuration = payload.timeSpanDuration;
    var module = rqItem.outputModule(1);
    module.file = new File(payload.outputPath);
    app.project.renderQueue.render();
    var path = module.file ? module.file.fsName : payload.outputPath;
    try { rqItem.remove(); } catch (_) {}
    return result("APPLIED", { outputPath: path }, []);
  };

  handlers["readback.object"] = function (payload) {
    if (payload.kind === "PROJECT") return result("NO_OP", { project: projectSnapshot() }, []);
    if (payload.kind === "COMPOSITION") return result("NO_OP", { composition: compSnapshot(findComp(payload.target)) }, []);
    if (payload.kind === "LAYER") {
      var comp = findComp(payload.comp);
      return result("NO_OP", { layer: layerSnapshot(findLayer(comp, payload.target)) }, []);
    }
    throw new Error("Unsupported readback.object kind.");
  };

  function responseBase(request, started) {
    return {
      protocolVersion: PROTOCOL,
      requestId: request.requestId,
      transactionId: request.transactionId,
      operationId: request.operationId,
      capabilityId: request.capabilityId,
      command: request.command,
      outcome: "FAILED",
      error: null,
      affectedObjects: [],
      readback: null,
      projectSnapshot: null,
      environmentProbe: null,
      hostProjectRevision: app.project ? app.project.revision : null,
      diagnostics: {
        adapterProtocolVersion: PROTOCOL,
        adapterBuild: BUILD,
        command: request.command,
        durationMs: nowMs() - started,
        hostRevisionBefore: app.project ? app.project.revision : null,
        hostRevisionAfter: app.project ? app.project.revision : null,
        notes: []
      },
      proofArtifactRefs: []
    };
  }

  function isMutation(command) {
    return command !== "host.probe" && command !== "project.inspect" && command !== "readback.object";
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var started = nowMs();
    var request = null;
    var response = null;
    var undoOpen = false;
    try {
      request = JSON.parse(requestJson);
      response = responseBase(request, started);
      if (request.protocolVersion !== PROTOCOL) {
        response.outcome = "REJECTED";
        response.error = fail("VALIDATION_ERROR", "PROTOCOL_VERSION_MISMATCH", "Unsupported AE adapter protocol version.");
        return JSON.stringify(response);
      }
      var handler = handlers[request.command];
      if (!handler) {
        response.outcome = "REJECTED";
        response.error = fail("VALIDATION_ERROR", "COMMAND_NOT_REGISTERED", "Command is not in the fixed adapter table.");
        return JSON.stringify(response);
      }
      if (isMutation(request.command) && request.expectedHostProjectRevision !== null && request.expectedHostProjectRevision !== undefined) {
        if (app.project.revision !== request.expectedHostProjectRevision) {
          response.outcome = "REJECTED";
          response.error = fail("STALE_PROJECT_STATE", "HOST_REVISION_MISMATCH", "After Effects project revision changed before mutation.", {
            expected: request.expectedHostProjectRevision,
            actual: app.project.revision
          });
          return JSON.stringify(response);
        }
      }
      var beforeRevision = app.project ? app.project.revision : null;
      if (isMutation(request.command)) {
        app.beginUndoGroup("EditFlow 2.0: " + request.command);
        undoOpen = true;
      }
      var handled = handler(request.payload || {}, request);
      if (undoOpen) {
        app.endUndoGroup();
        undoOpen = false;
      }
      response.outcome = handled.outcome || "APPLIED";
      response.readback = handled.readback || null;
      response.affectedObjects = handled.affectedObjects || [];
      response.projectSnapshot = handled.projectSnapshot || null;
      response.environmentProbe = handled.environmentProbe || null;
      response.hostProjectRevision = app.project ? app.project.revision : null;
      response.diagnostics.hostRevisionBefore = beforeRevision;
      response.diagnostics.hostRevisionAfter = app.project ? app.project.revision : null;
      response.diagnostics.durationMs = nowMs() - started;
      return JSON.stringify(response);
    } catch (error) {
      if (undoOpen) {
        try { app.endUndoGroup(); } catch (_) {}
      }
      if (!request) {
        return JSON.stringify({
          protocolVersion: PROTOCOL,
          requestId: "unknown",
          transactionId: "unknown",
          operationId: "unknown",
          capabilityId: "unknown",
          command: "project.inspect",
          outcome: "FAILED",
          error: fail("VALIDATION_ERROR", "INVALID_REQUEST_JSON", asString(error)),
          affectedObjects: [],
          readback: null,
          projectSnapshot: null,
          environmentProbe: null,
          hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: { adapterProtocolVersion: PROTOCOL, adapterBuild: BUILD, command: "project.inspect", durationMs: nowMs() - started },
          proofArtifactRefs: []
        });
      }
      response = response || responseBase(request, started);
      response.outcome = "FAILED";
      response.error = fail("ADAPTER_FAILURE", "HOST_COMMAND_FAILED", asString(error));
      response.hostProjectRevision = app.project ? app.project.revision : null;
      response.diagnostics.durationMs = nowMs() - started;
      response.diagnostics.hostRevisionAfter = app.project ? app.project.revision : null;
      return JSON.stringify(response);
    }
  };
}());
