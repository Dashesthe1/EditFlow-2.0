/* EditFlow 2.0 AE host protocol 1.1 hardening layer. Requires editflow_host.jsx first. */
(function () {
  var PROTOCOL = "1.1.0";
  var BUILD = "0.1.0-dev.3";
  var LEGACY_PROTOCOL = "1.0.0";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var legacyDispatch = $.global.EditFlow2_dispatch;

  if (typeof legacyDispatch !== "function") {
    throw new Error("EditFlow 2.0 v1.1 hardening requires the v1.0 host dispatcher to be loaded first.");
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
    if (!item || !(item instanceof CompItem)) throw new Error("v1.1 could not resolve parent composition.");
    return item;
  }
  function findLayerBySource(comp, source) {
    var i;
    for (i = 1; i <= comp.numLayers; i += 1) {
      var layer = comp.layer(i);
      try { if (layer.source === source) return layer; } catch (_) {}
    }
    return null;
  }
  function layerSnapshot(layer) {
    var source = null;
    try { source = layer.source || null; } catch (_) {}
    return {
      hostId: hostId(layer),
      stableId: getStableId(layer.comment),
      index: layer.index,
      name: layer.name,
      kind: "LAYER_AV",
      sourceHostId: source ? hostId(source) : null,
      sourceStableId: source ? getStableId(source.comment) : null,
      startTime: layer.startTime,
      inPoint: layer.inPoint,
      outPoint: layer.outPoint,
      stretch: layer.stretch
    };
  }
  function failResponse(request, code, message, category) {
    return {
      protocolVersion: PROTOCOL,
      requestId: request && request.requestId ? request.requestId : "unknown",
      transactionId: request && request.transactionId ? request.transactionId : "unknown",
      operationId: request && request.operationId ? request.operationId : "unknown",
      capabilityId: request && request.capabilityId ? request.capabilityId : "unknown",
      command: request && request.command ? request.command : "project.inspect",
      outcome: "REJECTED",
      error: { category: category || "VALIDATION_ERROR", code: code, message: message },
      affectedObjects: [],
      readback: null,
      projectSnapshot: null,
      environmentProbe: null,
      hostProjectRevision: app.project ? app.project.revision : null,
      diagnostics: {
        adapterProtocolVersion: PROTOCOL,
        adapterBuild: BUILD,
        command: request && request.command ? request.command : "project.inspect",
        hostRevisionBefore: app.project ? app.project.revision : null,
        hostRevisionAfter: app.project ? app.project.revision : null,
        notes: []
      },
      proofArtifactRefs: []
    };
  }
  function promoteResponse(response, request, started) {
    response.protocolVersion = PROTOCOL;
    response.command = request.command;
    if (response.diagnostics) {
      response.diagnostics.adapterProtocolVersion = PROTOCOL;
      response.diagnostics.adapterBuild = BUILD;
      response.diagnostics.command = request.command;
      response.diagnostics.durationMs = nowMs() - started;
      response.diagnostics.hostRevisionAfter = app.project ? app.project.revision : null;
    }
    if (response.environmentProbe) {
      response.environmentProbe.adapterProtocolVersion = PROTOCOL;
      response.environmentProbe.adapterBuild = BUILD;
    }
    response.hostProjectRevision = app.project ? app.project.revision : null;
    return response;
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var started = nowMs();
    var request = null;
    try {
      request = JSON.parse(requestJson);
      if (request.protocolVersion !== PROTOCOL) {
        return JSON.stringify(failResponse(request, "PROTOCOL_VERSION_MISMATCH", "Protocol 1.1.0 is required."));
      }

      if (request.command === "transaction.undo_last") {
        if (request.expectedHostProjectRevision !== null && request.expectedHostProjectRevision !== undefined
            && app.project.revision !== request.expectedHostProjectRevision) {
          return JSON.stringify(failResponse(request, "HOST_REVISION_MISMATCH", "After Effects revision changed before undo.", "STALE_PROJECT_STATE"));
        }
        var beforeUndo = app.project.revision;
        app.executeCommand(16);
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
          readback: { undone: true },
          projectSnapshot: null,
          environmentProbe: null,
          hostProjectRevision: app.project.revision,
          diagnostics: {
            adapterProtocolVersion: PROTOCOL,
            adapterBuild: BUILD,
            command: request.command,
            durationMs: nowMs() - started,
            hostRevisionBefore: beforeUndo,
            hostRevisionAfter: app.project.revision,
            notes: ["Fixed AE Undo command ID 16; not wrapped in a new undo group."]
          },
          proofArtifactRefs: []
        });
      }

      if (request.command === "layers.precompose" && !request.payload.replacementStableId) {
        return JSON.stringify(failResponse(request, "REPLACEMENT_STABLE_ID_REQUIRED", "Protocol 1.1 precompose requires replacementStableId."));
      }

      var legacyRequest = JSON.parse(JSON.stringify(request));
      legacyRequest.protocolVersion = LEGACY_PROTOCOL;
      var legacyRaw = legacyDispatch(JSON.stringify(legacyRequest));
      var response = JSON.parse(legacyRaw);

      if (request.command === "layers.precompose" && response.outcome !== "FAILED" && response.outcome !== "REJECTED") {
        var child = findItem({ stableId: request.payload.stableId });
        var parent = findComp(request.payload.comp);
        if (!child || !(child instanceof CompItem)) throw new Error("v1.1 precompose child stable identity was not found after legacy operation.");
        var replacement = findLayerBySource(parent, child);
        if (!replacement) throw new Error("v1.1 precompose replacement layer could not be resolved by child source identity.");
        setStableId(replacement, request.payload.replacementStableId);
        response.affectedObjects = response.affectedObjects || [];
        response.affectedObjects.push({
          stableId: request.payload.replacementStableId,
          hostId: hostId(replacement),
          kind: "LAYER_AV"
        });
        response.readback = response.readback || {};
        response.readback.replacementLayer = layerSnapshot(replacement);
      }

      return JSON.stringify(promoteResponse(response, request, started));
    } catch (error) {
      var failed = failResponse(request, "V11_HARDENING_FAILED", asString(error), "ADAPTER_FAILURE");
      failed.outcome = "FAILED";
      failed.diagnostics.durationMs = nowMs() - started;
      return JSON.stringify(failed);
    }
  };
}());
