(function () {
  "use strict";
  var planFile = new File("__EDITFLOW_PLAN_PATH__");
  var hostLoader = new File("__EDITFLOW_HOST_LOADER__");
  var resultFile = new File("__EDITFLOW_HOST_RESULT__");
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var responses = [];
  var dispatchTimingsMs = [];
  var checks = {};
  var fixtureResults = [];
  var reviewFiles = [];
  var failure = null;
  var plan = null;
  var requestCounter = 0;
  var hostRevision = null;
  var lastDispatchEndMs = null;

  function readText(file) {
    if (!file.exists || !file.open("r")) throw new Error("Cannot read " + file.fsName);
    var text = file.read(); file.close(); return text;
  }
  function writeJson(file, value) {
    if (!file.parent.exists) file.parent.create();
    if (!file.open("w")) throw new Error("Cannot write " + file.fsName);
    file.encoding = "UTF-8"; file.write(JSON.stringify(value, null, 2)); file.close();
  }
  function tag(target, id) { target.comment = STABLE_PREFIX + id + STABLE_SUFFIX; }
  function stableId(target) {
    var text = String(target && target.comment !== undefined ? target.comment : "");
    var start = text.indexOf(STABLE_PREFIX);
    if (start < 0) return null;
    start += STABLE_PREFIX.length;
    var end = text.indexOf(STABLE_SUFFIX, start);
    return end < 0 ? null : text.substring(start, end);
  }
  function findItem(id) {
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (stableId(item) === id) return item;
    }
    return null;
  }
  function findLayer(comp, id) {
    if (!comp) return null;
    for (var i = 1; i <= comp.numLayers; i += 1) {
      var layer = comp.layer(i);
      if (stableId(layer) === id) return layer;
    }
    return null;
  }
  function near(a, b, eps) { return Math.abs(Number(a) - Number(b)) <= (eps || 0.001); }
  function responseOk(response) { return response && response.outcome !== "FAILED" && response.outcome !== "REJECTED"; }
  function nowMs() { return (new Date()).getTime(); }
  function dispatchRaw(protocolVersion, capabilityId, command, payload) {
    requestCounter += 1;
    var expectedRevision = null;
    if (protocolVersion === "2.5.0" && command === "media.sequence.import") expectedRevision = hostRevision;
    if (protocolVersion === "1.3.0" && command !== "layer.composite_readback") expectedRevision = hostRevision;
    var startedMs = nowMs();
    var gapMs = lastDispatchEndMs === null ? null : startedMs - lastDispatchEndMs;
    var request = {
      protocolVersion: protocolVersion,
      requestId: "m4-exit-gate-" + requestCounter,
      transactionId: "M4_EXIT_GATE_SEMANTIC_ATTACH_REAL_AE",
      operationId: "M4_EXIT_GATE_SEMANTIC_ATTACH_REAL_AE_" + requestCounter,
      capabilityId: capabilityId, command: command, payload: payload,
      expectedHostProjectRevision: expectedRevision,
      readbackProfile: "M4_EXIT_GATE_SEMANTIC_ATTACH_REAL_AE"
    };
    var response = JSON.parse($.global.EditFlow2_dispatch(JSON.stringify(request)));
    var endedMs = nowMs();
    dispatchTimingsMs.push({ command: command, durationMs: endedMs - startedMs, gapFromPreviousMs: gapMs });
    lastDispatchEndMs = endedMs;
    responses.push(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  }
  function dispatch(protocolVersion, capabilityId, command, payload) {
    var response = dispatchRaw(protocolVersion, capabilityId, command, payload);
    if (!responseOk(response)) throw new Error(command + " failed: " + (response.error ? response.error.code : response.outcome));
    return response;
  }
  function makeBackground(comp, fixtureIndex, duration) {
    var id = "M4_EXIT_" + fixtureIndex + "_BG_LAYER";
    var layer = comp.layers.addShape();
    layer.name = "M4 Exit Gate Background";
    tag(layer, id);
    var root = layer.property("ADBE Root Vectors Group");
    var group = root.addProperty("ADBE Vector Group");
    var contents = group.property("ADBE Vectors Group");
    var rect = contents.addProperty("ADBE Vector Shape - Rect");
    rect.property("ADBE Vector Rect Size").setValue([comp.width, comp.height]);
    var fill = contents.addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue([0.02, 0.08, 0.72]);
    layer.moveToEnd();
    return layer;
  }
  function makeMarker(comp, fixtureIndex) {
    var id = "M4_EXIT_" + fixtureIndex + "_MARKER_LAYER";
    var layer = comp.layers.addShape();
    layer.name = "M4 Semantic Attach Ring";
    tag(layer, id);
    var size = Math.max(64, Math.min(112, Math.round(Math.min(comp.width, comp.height) * 0.06)));
    var root = layer.property("ADBE Root Vectors Group");
    var group = root.addProperty("ADBE Vector Group");
    var contents = group.property("ADBE Vectors Group");
    var ellipse = contents.addProperty("ADBE Vector Shape - Ellipse");
    ellipse.property("ADBE Vector Ellipse Size").setValue([size, size]);
    var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
    stroke.property("ADBE Vector Stroke Color").setValue([1, 0, 1]);
    stroke.property("ADBE Vector Stroke Width").setValue(Math.max(10, Math.round(size * 0.16)));
    return { layer: layer, radius: size / 2 };
  }
  function frameTime(fixture, frameIndex) {
    return (Number(frameIndex) + 0.5) / Number(fixture.frameRate);
  }
  function saveFrame(comp, name, timeSeconds) {
    var file = new File(resultFile.parent.fsName + "/" + name);
    if (file.exists) file.remove();
    comp.saveFrameToPng(timeSeconds, file);
    reviewFiles.push(file.fsName);
    return file.fsName;
  }
  function removeOwnedItem(id) {
    try {
      var item = findItem(id);
      if (item) item.remove();
    } catch (_) {}
  }

  var baselineItems = app.project ? app.project.numItems : -1;
  var baselineRenderItems = app.project ? app.project.renderQueue.numItems : -1;
  var baselineFile = app.project && app.project.file ? app.project.file.fsName : null;
  try {
    if (!app.project) throw new Error("No After Effects project is open");
    if (!planFile.exists) throw new Error("M4 exit-gate plan is missing");
    if (!hostLoader.exists) throw new Error("Protocol 2.5 host loader is missing");
    $.evalFile(hostLoader);
    if (typeof $.global.EditFlow2_dispatch !== "function" || !$.global.EditFlow2_HOST_PROTOCOL_25) {
      throw new Error("Protocol 2.5 EditFlow host did not load");
    }
    hostRevision = app.project.revision;
    plan = JSON.parse(readText(planFile));
    if (plan.proofId !== "M4_EXIT_GATE_SEMANTIC_ATTACH_REAL_AE" || plan.fixtures.length !== 2) {
      throw new Error("Unexpected M4 exit-gate plan identity");
    }

    for (var fi = 0; fi < plan.fixtures.length; fi += 1) {
      var fixture = plan.fixtures[fi];
      var ids = fixture.stableIds;
      var markerId = "M4_EXIT_" + fi + "_MARKER_LAYER";
      var bgMediaId = "M4_EXIT_" + fi + "_BG_MEDIA";
      var reserved = [ids.sourceMedia, ids.maskMedia, ids.comp, markerId, bgMediaId];
      for (var ri = 0; ri < reserved.length; ri += 1) {
        if (findItem(reserved[ri])) throw new Error("Proof stable-id collision: " + reserved[ri]);
      }
      dispatch("2.5.0", "ae.media.sequence.import", "media.sequence.import", {
        path: fixture.sourceFirstFramePath, stableId: ids.sourceMedia,
        frameRate: fixture.frameRate, expectedFrameCount: fixture.frameCount
      });
      dispatch("1.1.0", "ae.comp.create", "comp.create", {
        stableId: ids.comp, name: "M4 Exit Gate - " + fixture.fixtureId,
        width: fixture.width, height: fixture.height, pixelAspect: 1,
        duration: fixture.duration, frameRate: fixture.frameRate
      });
      dispatch("1.1.0", "ae.layer.create", "layer.add_media", {
        stableId: ids.sourceLayer, comp: { stableId: ids.comp }, item: { stableId: ids.sourceMedia }
      });
      dispatch("2.5.0", "ae.media.sequence.import", "media.sequence.import", {
        path: fixture.maskFirstFramePath, stableId: ids.maskMedia,
        frameRate: fixture.frameRate, expectedFrameCount: fixture.frameCount
      });
      dispatch("1.1.0", "ae.layer.create", "layer.add_media", {
        stableId: ids.maskLayer, comp: { stableId: ids.comp }, item: { stableId: ids.maskMedia }
      });
      var timing = { startTime: 0, inPoint: 0, outPoint: fixture.duration, stretch: 100 };
      dispatch("1.1.0", "ae.layer.timing.set", "layer.set_timing", {
        comp: { stableId: ids.comp }, layer: { stableId: ids.sourceLayer }, timing: timing
      });
      dispatch("1.1.0", "ae.layer.timing.set", "layer.set_timing", {
        comp: { stableId: ids.comp }, layer: { stableId: ids.maskLayer }, timing: timing
      });
      dispatch("1.3.0", "ae.layer.track_matte.set", "layer.set_track_matte", {
        comp: { stableId: ids.comp }, layer: { stableId: ids.sourceLayer },
        matteLayer: { stableId: ids.maskLayer }, trackMatteType: "LUMA"
      });

      var comp = findItem(ids.comp);
      if (!comp || !(comp instanceof CompItem)) throw new Error("Proof comp did not materialize: " + fixture.fixtureId);
      var sourceLayer = findLayer(comp, ids.sourceLayer);
      var maskLayer = findLayer(comp, ids.maskLayer);
      if (!sourceLayer || !maskLayer) throw new Error("Proof layers did not materialize: " + fixture.fixtureId);
      var background = makeBackground(comp, fi, fixture.duration);
      var markerInfo = makeMarker(comp, fi);
      var marker = markerInfo.layer;
      var position = marker.property("ADBE Transform Group").property("ADBE Position");
      for (var ai = 0; ai < fixture.attachFrames.length; ai += 1) {
        var attach = fixture.attachFrames[ai];
        var point = attach.resolution.pointCompPx;
        if (fixture.repair && ai === fixture.repair.frameIndex) point = fixture.repair.wrongPointPx;
        position.setValueAtTime(Number(attach.timestampMs) / 1000, [Number(point[0]), Number(point[1])]);
      }
      for (var ki = 1; ki <= position.numKeys; ki += 1) {
        position.setInterpolationTypeAtKey(ki, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
      }

      var driftFramePath = null;
      var repairedFramePath = null;
      if (fixture.repair) {
        driftFramePath = saveFrame(comp, fixture.fixtureId + "-drift.png", frameTime(fixture, fixture.repair.frameIndex));
        position.setValueAtTime(Number(fixture.repair.timestampMs) / 1000, [
          Number(fixture.repair.correctPointPx[0]), Number(fixture.repair.correctPointPx[1])
        ]);
        var repairKey = position.nearestKeyIndex(Number(fixture.repair.timestampMs) / 1000);
        position.setInterpolationTypeAtKey(repairKey, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
        repairedFramePath = saveFrame(comp, fixture.fixtureId + "-repaired.png", frameTime(fixture, fixture.repair.frameIndex));
      }

      var finalFramePaths = [];
      for (var si = 0; si < fixture.sampleIndices.length; si += 1) {
        var sampleIndex = Number(fixture.sampleIndices[si]);
        finalFramePaths.push(saveFrame(comp, fixture.fixtureId + "-review-" + si + ".png", frameTime(fixture, sampleIndex)));
      }
      var sequenceReadback = dispatch("2.5.0", "ae.media.sequence.readback", "media.sequence.readback", {
        item: { stableId: ids.maskMedia }
      });
      var compositeReadback = dispatch("1.3.0", "ae.layer.composite.readback", "layer.composite_readback", {
        comp: { stableId: ids.comp }, layer: { stableId: ids.sourceLayer }
      });
      var sequenceState = sequenceReadback.readback;
      var compositeState = compositeReadback.readback.composite;
      var fixturePrefix = fixture.fixtureId + ":";
      checks[fixturePrefix + "sequence_temporal"] = sequenceState.isStill === false;
      checks[fixturePrefix + "sequence_frame_count"] = sequenceState.frameCount === fixture.frameCount;
      checks[fixturePrefix + "sequence_frame_rate"] = near(sequenceState.frameRate, fixture.frameRate)
        && near(sequenceState.displayFrameRate, fixture.frameRate);
      checks[fixturePrefix + "mask_source_exact"] = new File(sequenceState.path).fsName === new File(fixture.maskFirstFramePath).fsName;
      checks[fixturePrefix + "track_matte_bound"] = compositeState.hasTrackMatte === true
        && compositeState.trackMatteLayer && compositeState.trackMatteLayer.stableId === ids.maskLayer;
      checks[fixturePrefix + "source_exact"] = !!sourceLayer.source && !!sourceLayer.source.file
        && sourceLayer.source.file.fsName === new File(fixture.sourceFirstFramePath).fsName;
      checks[fixturePrefix + "source_temporal"] = !!sourceLayer.source.mainSource && sourceLayer.source.mainSource.isStill === false;
      checks[fixturePrefix + "comp_geometry_exact"] = comp.width === fixture.width && comp.height === fixture.height
        && near(comp.frameRate, fixture.frameRate) && near(comp.duration, fixture.duration, 0.01);
      checks[fixturePrefix + "marker_key_count"] = position.numKeys === fixture.frameCount;
      var markerExact = true;
      for (var vi = 0; vi < fixture.attachFrames.length; vi += 1) {
        var expected = fixture.attachFrames[vi].resolution.pointCompPx;
        var actual = position.valueAtTime(Number(fixture.attachFrames[vi].timestampMs) / 1000, false);
        if (!near(actual[0], expected[0], 0.01) || !near(actual[1], expected[1], 0.01)) markerExact = false;
      }
      checks[fixturePrefix + "semantic_marker_exact"] = markerExact;
      checks[fixturePrefix + "semantic_marker_dynamic"] = fixture.distinctAttachPoints >= 2;
      checks[fixturePrefix + "review_frames_emitted"] = finalFramePaths.length === 3;
      if (fixture.repair) {
        checks[fixturePrefix + "repair_state_resumed"] = fixture.repair.state.status === "RESUMED";
        checks[fixturePrefix + "drift_and_repair_frames_emitted"] = !!driftFramePath && !!repairedFramePath;
      }
      fixtureResults.push({
        fixtureId: fixture.fixtureId,
        compStableId: ids.comp,
        markerStableId: markerId,
        markerRadius: markerInfo.radius,
        backgroundSample: fixture.backgroundSample,
        sampleIndices: fixture.sampleIndices,
        finalFramePaths: finalFramePaths,
        driftFramePath: driftFramePath,
        repairedFramePath: repairedFramePath,
        repair: fixture.repair,
        attachFrames: fixture.attachFrames
      });
      removeOwnedItem(ids.comp);
      removeOwnedItem(ids.maskMedia);
      removeOwnedItem(ids.sourceMedia);
      removeOwnedItem(bgMediaId);
      checks[fixturePrefix + "scoped_cleanup"] = !findItem(ids.comp) && !findItem(ids.maskMedia)
        && !findItem(ids.sourceMedia) && !findItem(bgMediaId);
      hostRevision = app.project.revision;
    }
  } catch (error) {
    failure = String(error) + (error.line ? " @line " + error.line : "");
  } finally {
    if (plan && plan.fixtures) {
      for (var ci = 0; ci < plan.fixtures.length; ci += 1) {
        try {
          var cleanupIds = plan.fixtures[ci].stableIds;
          removeOwnedItem(cleanupIds.comp);
          removeOwnedItem(cleanupIds.maskMedia);
          removeOwnedItem(cleanupIds.sourceMedia);
          removeOwnedItem("M4_EXIT_" + ci + "_BG_MEDIA");
        } catch (_) {}
      }
    }
  }

  var afterFile = app.project && app.project.file ? app.project.file.fsName : null;
  var cleanupComplete = app.project && app.project.numItems === baselineItems
    && app.project.renderQueue.numItems === baselineRenderItems && afterFile === baselineFile;
  checks.project_baseline_restored = cleanupComplete;
  checks.retained_plan_gates = !!plan && plan.gates
    && plan.gates.retainedTemporalIsolationAccepted === true
    && plan.gates.materiallyDifferentTransferAccepted === true
    && plan.gates.semanticAttachExactIdAccepted === true
    && plan.gates.semanticAttachLandmarkAccepted === true
    && plan.gates.dynamicAttachmentAccepted === true
    && plan.gates.visibleRepairStateResumed === true;
  var allChecks = true;
  var checkCount = 0;
  for (var key in checks) {
    if (checks.hasOwnProperty(key)) {
      checkCount += 1;
      if (checks[key] !== true) allChecks = false;
    }
  }
  var ok = failure === null && allChecks && cleanupComplete && fixtureResults.length === 2;
  writeJson(resultFile, {
    schemaVersion: 1,
    proofId: "M4_EXIT_GATE_SEMANTIC_ATTACH_REAL_AE",
    ok: ok,
    cleanupComplete: cleanupComplete,
    checkCount: checkCount,
    checks: checks,
    failure: failure,
    fixtureResults: fixtureResults,
    responses: responses,
    dispatchTimingsMs: dispatchTimingsMs,
    reviewFiles: reviewFiles,
    baseline: { itemCount: baselineItems, renderQueueCount: baselineRenderItems, projectFile: baselineFile },
    after: { itemCount: app.project.numItems, renderQueueCount: app.project.renderQueue.numItems, projectFile: afterFile }
  });
}());
