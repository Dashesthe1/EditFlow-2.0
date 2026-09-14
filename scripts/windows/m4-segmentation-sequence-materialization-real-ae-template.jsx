(function () {
  "use strict";
  var planFile = new File("__EDITFLOW_PLAN_PATH__");
  var hostLoader = new File("__EDITFLOW_HOST_LOADER__");
  var resultFile = new File("__EDITFLOW_HOST_RESULT__");
  var reviewFiles = [
    new File("__EDITFLOW_REVIEW_FRAME_0__"),
    new File("__EDITFLOW_REVIEW_FRAME_1__"),
    new File("__EDITFLOW_REVIEW_FRAME_2__")
  ];
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var responses = [];
  var checks = {};
  var failure = null;
  var mutationStarted = false;
  var plan = null;
  var proofComp = null;
  var requestCounter = 0;
  var hostRevision = null;

  function readText(file) {
    if (!file.exists || !file.open("r")) throw new Error("Cannot read " + file.fsName);
    var text = file.read(); file.close(); return text;
  }
  function writeJson(file, value) {
    if (!file.parent.exists) file.parent.create();    if (!file.open("w")) throw new Error("Cannot write " + file.fsName);
    file.encoding = "UTF-8"; file.write(JSON.stringify(value, null, 2)); file.close();
  }
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
  function near(a, b) { return Math.abs(Number(a) - Number(b)) <= 0.0001; }
  function responseOk(response) {
    return response && response.outcome !== "FAILED" && response.outcome !== "REJECTED";
  }  function dispatchRaw(protocolVersion, capabilityId, command, payload) {
    requestCounter += 1;
    var expectedRevision = null;
    if (protocolVersion === "2.5.0" && command === "media.sequence.import") expectedRevision = hostRevision;
    if (protocolVersion === "1.3.0" && command !== "layer.composite_readback") expectedRevision = hostRevision;
    var request = {
      protocolVersion: protocolVersion,
      requestId: "m4-sequence-materialization-" + requestCounter,
      transactionId: "M4_SEGMENTATION_SEQUENCE_MATERIALIZATION_REAL_AE",
      operationId: "M4_SEGMENTATION_SEQUENCE_MATERIALIZATION_REAL_AE_" + requestCounter,
      capabilityId: capabilityId,
      command: command,
      payload: payload,
      expectedHostProjectRevision: expectedRevision,
      readbackProfile: "M4_SEGMENTATION_SEQUENCE_MATTE_MATERIALIZATION_REAL_AE"
    };
    var response = JSON.parse($.global.EditFlow2_dispatch(JSON.stringify(request)));
    responses.push(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  }
  function dispatch(protocolVersion, capabilityId, command, payload) {
    var response = dispatchRaw(protocolVersion, capabilityId, command, payload);
    if (!responseOk(response)) {
      throw new Error(command + " failed: " + (response.error ? response.error.code : response.outcome));
    }
    return response;
  }

  var baselineItems = app.project ? app.project.numItems : -1;  var baselineRenderItems = app.project ? app.project.renderQueue.numItems : -1;
  var baselineFile = app.project && app.project.file ? app.project.file.fsName : null;
  try {
    if (!app.project) throw new Error("No After Effects project is open");
    if (!planFile.exists) throw new Error("Temporal materialization plan is missing");
    if (!hostLoader.exists) throw new Error("Protocol 2.5 host loader is missing");
    $.evalFile(hostLoader);
    if (typeof $.global.EditFlow2_dispatch !== "function" || !$.global.EditFlow2_HOST_PROTOCOL_25) {
      throw new Error("Protocol 2.5 EditFlow host did not load");
    }
    hostRevision = app.project.revision;
    plan = JSON.parse(readText(planFile));

    var reserved = [
      "M4_SEQUENCE_BG_MEDIA", "M4_SEQUENCE_SUBJECT_MEDIA", "M4_SEQUENCE_COMP",
      plan.plan.importItemStableId
    ];
    for (var r = 0; r < reserved.length; r += 1) {
      if (findItem(reserved[r])) throw new Error("Proof stable-id collision: " + reserved[r]);
    }

    mutationStarted = true;
    dispatch("1.1.0", "ae.media.import", "media.import", {
      path: plan.fixtures.backgroundPath, stableId: "M4_SEQUENCE_BG_MEDIA", sequence: false
    });
    dispatch("1.1.0", "ae.media.import", "media.import", {
      path: plan.fixtures.subjectPath, stableId: "M4_SEQUENCE_SUBJECT_MEDIA", sequence: false
    });
    dispatch("1.1.0", "ae.comp.create", "comp.create", {      stableId: "M4_SEQUENCE_COMP", name: "M4 Dynamic Segmentation Matte Proof",
      width: plan.fixtures.width, height: plan.fixtures.height, pixelAspect: 1,
      duration: plan.fixtures.duration, frameRate: plan.fixtures.frameRate
    });
    dispatch("1.1.0", "ae.layer.create", "layer.add_media", {
      stableId: "M4_SEQUENCE_BG_LAYER", comp: { stableId: "M4_SEQUENCE_COMP" },
      item: { stableId: "M4_SEQUENCE_BG_MEDIA" }
    });
    dispatch("1.1.0", "ae.layer.create", "layer.add_media", {
      stableId: plan.targetState.stableId, comp: { stableId: "M4_SEQUENCE_COMP" },
      item: { stableId: "M4_SEQUENCE_SUBJECT_MEDIA" }
    });
    dispatch("1.1.0", "ae.layer.transform.set", "layer.set_transform", {
      comp: { stableId: "M4_SEQUENCE_COMP" }, layer: { stableId: plan.targetState.stableId },
      values: plan.targetState.transform
    });
    dispatch("1.1.0", "ae.layer.timing.set", "layer.set_timing", {
      comp: { stableId: "M4_SEQUENCE_COMP" }, layer: { stableId: plan.targetState.stableId },
      timing: plan.targetState.timing
    });

    for (var o = 0; o < plan.plan.operations.length; o += 1) {
      var operation = plan.plan.operations[o];
      dispatch(operation.protocolVersion, operation.capabilityId, operation.command, operation.payload);
    }

    proofComp = findItem("M4_SEQUENCE_COMP");
    if (!proofComp || !(proofComp instanceof CompItem)) throw new Error("Proof comp did not materialize");    var sequenceReadback = dispatch("2.5.0", "ae.media.sequence.readback", "media.sequence.readback", {
      item: { stableId: plan.plan.importItemStableId }
    });
    var matteReadback = dispatch("1.1.0", "ae.object.readback", "readback.object", {
      kind: "LAYER", comp: { stableId: "M4_SEQUENCE_COMP" },
      target: { stableId: plan.plan.matteLayerStableId }
    });
    var compositeReadback = dispatch("1.3.0", "ae.layer.composite.readback", "layer.composite_readback", {
      comp: { stableId: "M4_SEQUENCE_COMP" }, layer: { stableId: plan.targetState.stableId }
    });
    var sequenceState = sequenceReadback.readback;
    var matteState = matteReadback.readback.layer;
    var compositeState = compositeReadback.readback.composite;
    var expectedTiming = plan.plan.matteTiming;
    var firstFramePath = new File(plan.plan.firstFramePath).fsName;

    checks.sequence_temporal = sequenceState.isStill === false;
    checks.sequence_frame_count = sequenceState.frameCount === plan.plan.frameCount;
    checks.sequence_frame_rate = near(sequenceState.frameRate, plan.plan.frameRate)
      && near(sequenceState.displayFrameRate, plan.plan.frameRate);
    checks.sequence_first_path = new File(sequenceState.path).fsName === firstFramePath;
    checks.matte_source_exact = matteState.sourceStableId === plan.plan.importItemStableId;
    checks.matte_timing_exact = near(matteState.startTime, expectedTiming.startTime)
      && near(matteState.inPoint, expectedTiming.inPoint)
      && near(matteState.outPoint, expectedTiming.outPoint)
      && near(matteState.stretch, expectedTiming.stretch);
    checks.track_matte_bound = compositeState.hasTrackMatte === true
      && compositeState.trackMatteLayer && compositeState.trackMatteLayer.stableId === plan.plan.matteLayerStableId;
    var liveMatte = findLayer(proofComp, plan.plan.matteLayerStableId);    var liveSource = liveMatte ? liveMatte.source : null;
    checks.live_matte_is_sequence = !!liveSource && liveSource.mainSource && liveSource.mainSource.isStill === false;
    checks.plan_operation_sequence = plan.plan.operations.length === 5
      && plan.plan.operations[0].command === "media.sequence.import"
      && plan.plan.operations[1].command === "layer.add_media"
      && plan.plan.operations[2].command === "layer.set_transform"
      && plan.plan.operations[3].command === "layer.set_timing"
      && plan.plan.operations[4].command === "layer.set_track_matte";

    for (var f = 0; f < reviewFiles.length; f += 1) {
      proofComp.saveFrameToPng(plan.visualExpectations.frameTimes[f], reviewFiles[f]);
    }
    checks.review_frames_requested = true;
  } catch (error) {
    failure = String(error) + (error.line ? " @line " + error.line : "");
  } finally {
    try {
      var ownedComp = findItem("M4_SEQUENCE_COMP");
      if (ownedComp) ownedComp.remove();
    } catch (_) {}
    var ownedItems = [
      plan && plan.plan ? plan.plan.importItemStableId : "M4_SEQUENCE_MASK_MEDIA",
      "M4_SEQUENCE_SUBJECT_MEDIA", "M4_SEQUENCE_BG_MEDIA"
    ];
    for (var c = 0; c < ownedItems.length; c += 1) {
      try {
        var owned = findItem(ownedItems[c]);
        if (owned) owned.remove();
      } catch (_) {}
    }
  }

  var afterFile = app.project && app.project.file ? app.project.file.fsName : null;  var cleanupComplete = app.project && app.project.numItems === baselineItems
    && app.project.renderQueue.numItems === baselineRenderItems && afterFile === baselineFile;
  checks.project_baseline_restored = cleanupComplete;
  var allChecks = true;
  var checkCount = 0;
  for (var key in checks) {
    if (checks.hasOwnProperty(key)) {
      checkCount += 1;
      if (checks[key] !== true) allChecks = false;
    }
  }
  var ok = failure === null && allChecks && cleanupComplete;
  writeJson(resultFile, {
    schemaVersion: 1,
    proofId: "M4_SEGMENTATION_SEQUENCE_MATTE_MATERIALIZATION_REAL_AE",
    ok: ok,
    mutationStarted: mutationStarted,
    cleanupComplete: cleanupComplete,
    checkCount: checkCount,
    checks: checks,
    responses: responses,
    failure: failure,
    baseline: { itemCount: baselineItems, renderQueueCount: baselineRenderItems, projectFile: baselineFile },
    after: { itemCount: app.project.numItems, renderQueueCount: app.project.renderQueue.numItems, projectFile: afterFile },
    artifacts: {
      plan: planFile.fsName,
      reviewFrames: [reviewFiles[0].fsName, reviewFiles[1].fsName, reviewFiles[2].fsName]
    }
  });
}());