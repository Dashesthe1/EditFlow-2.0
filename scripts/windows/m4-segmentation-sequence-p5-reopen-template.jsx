(function () {
  "use strict";
  var projectFile = new File("__EDITFLOW_LIFECYCLE_PROJECT_PATH__");
  var planFile = new File("__EDITFLOW_PLAN_PATH__");
  var hostLoader = new File("__EDITFLOW_HOST_LOADER__");
  var resultFile = new File("__EDITFLOW_REOPEN_RESULT__");
  var reviewFiles = [
    new File("__EDITFLOW_REOPEN_FRAME_0__"),
    new File("__EDITFLOW_REOPEN_FRAME_1__"),
    new File("__EDITFLOW_REOPEN_FRAME_2__")
  ];
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var responses = [];
  var checks = {};
  var failure = null;
  var requestCounter = 0;
  var hostRevision = null;

  function readText(file) {
    if (!file.exists || !file.open("r")) throw new Error("Cannot read " + file.fsName);
    var text = file.read(); file.close(); return text;
  }
  function writeJson(file, value) {
    if (!file.parent.exists) file.parent.create();
    if (!file.open("w")) throw new Error("Cannot write " + file.fsName);
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
  function responseOk(response) { return response && response.outcome !== "FAILED" && response.outcome !== "REJECTED"; }
  function dispatchRaw(protocolVersion, capabilityId, command, payload) {
    requestCounter += 1;
    var expectedRevision = null;
    if (protocolVersion === "2.5.0" && command === "media.sequence.import") expectedRevision = hostRevision;
    if (protocolVersion === "1.3.0" && command !== "layer.composite_readback") expectedRevision = hostRevision;
    var request = {
      protocolVersion: protocolVersion,
      requestId: "m4-sequence-p5-reopen-" + requestCounter,
      transactionId: "M4_SEGMENTATION_SEQUENCE_P5_REOPEN",
      operationId: "M4_SEGMENTATION_SEQUENCE_P5_REOPEN_" + requestCounter,
      capabilityId: capabilityId,
      command: command,
      payload: payload,
      expectedHostProjectRevision: expectedRevision,
      readbackProfile: "M4_SEGMENTATION_SEQUENCE_P5_REOPEN"
    };
    var response = JSON.parse($.global.EditFlow2_dispatch(JSON.stringify(request)));
    responses.push(response);
    if (typeof response.hostProjectRevision === "number") hostRevision = response.hostProjectRevision;
    return response;
  }
  function dispatch(protocolVersion, capabilityId, command, payload) {
    var response = dispatchRaw(protocolVersion, capabilityId, command, payload);
    if (!responseOk(response)) throw new Error(command + " failed: " + (response.error ? response.error.code : response.outcome));
    return response;
  }

  try {
    if (!projectFile.exists) throw new Error("Lifecycle project is missing: " + projectFile.fsName);
    if (!planFile.exists) throw new Error("Lifecycle plan is missing");
    if (!hostLoader.exists) throw new Error("Protocol 2.5 host loader is missing");
    app.open(projectFile);
    checks.project_reopened_exact = !!app.project && !!app.project.file && app.project.file.fsName === projectFile.fsName;
    if (!checks.project_reopened_exact) throw new Error("Lifecycle project did not reopen exactly");
    $.evalFile(hostLoader);
    checks.dispatcher_reloaded = typeof $.global.EditFlow2_dispatch === "function" && !!$.global.EditFlow2_HOST_PROTOCOL_25;
    if (!checks.dispatcher_reloaded) throw new Error("Protocol 2.5 dispatcher did not reload after reopen");
    hostRevision = app.project.revision;
    var plan = JSON.parse(readText(planFile));
    var proofComp = findItem("M4_TRANSFER_SEQUENCE_COMP");
    var sequenceItem = findItem(plan.plan.importItemStableId);
    var targetLayer = findLayer(proofComp, plan.targetState.stableId);
    var matteLayer = findLayer(proofComp, plan.plan.matteLayerStableId);
    checks.stable_objects_rebound = !!proofComp && !!sequenceItem && !!targetLayer && !!matteLayer;
    if (!checks.stable_objects_rebound) throw new Error("Lifecycle stable objects did not survive reopen");

    var importOperation = plan.plan.operations[0];
    var idempotentImport = dispatch(importOperation.protocolVersion, importOperation.capabilityId, importOperation.command, importOperation.payload);
    checks.sequence_import_idempotent_after_reopen = idempotentImport.outcome === "NO_OP";

    var sequenceReadback = dispatch("2.5.0", "ae.media.sequence.readback", "media.sequence.readback", { item: { stableId: plan.plan.importItemStableId } });
    var matteReadback = dispatch("1.1.0", "ae.object.readback", "readback.object", {
      kind: "LAYER", comp: { stableId: "M4_TRANSFER_SEQUENCE_COMP" }, target: { stableId: plan.plan.matteLayerStableId }
    });
    var compositeReadback = dispatch("1.3.0", "ae.layer.composite.readback", "layer.composite_readback", {
      comp: { stableId: "M4_TRANSFER_SEQUENCE_COMP" }, layer: { stableId: plan.targetState.stableId }
    });
    var sequenceState = sequenceReadback.readback;
    var matteState = matteReadback.readback.layer;
    var compositeState = compositeReadback.readback.composite;
    var expectedTiming = plan.plan.matteTiming;
    var firstFramePath = new File(plan.plan.firstFramePath).fsName;
    checks.sequence_temporal = sequenceState.isStill === false;
    checks.sequence_frame_count = sequenceState.frameCount === plan.plan.frameCount;
    checks.sequence_frame_rate = near(sequenceState.frameRate, plan.plan.frameRate) && near(sequenceState.displayFrameRate, plan.plan.frameRate);
    checks.sequence_first_path = new File(sequenceState.path).fsName === firstFramePath;
    checks.matte_source_exact = matteState.sourceStableId === plan.plan.importItemStableId;
    checks.matte_timing_exact = near(matteState.startTime, expectedTiming.startTime) && near(matteState.inPoint, expectedTiming.inPoint)
      && near(matteState.outPoint, expectedTiming.outPoint) && near(matteState.stretch, expectedTiming.stretch);
    checks.track_matte_exact = compositeState.hasTrackMatte === true && compositeState.trackMatteLayer
      && compositeState.trackMatteLayer.stableId === plan.plan.matteLayerStableId && compositeState.trackMatteType === "LUMA";
    checks.live_matte_is_sequence = !!matteLayer.source && !!matteLayer.source.mainSource && matteLayer.source.mainSource.isStill === false;
    for (var i = 0; i < reviewFiles.length; i += 1) proofComp.saveFrameToPng(plan.visualExpectations.frameTimes[i], reviewFiles[i]);
    checks.reopen_frames_requested = true;
  } catch (error) {
    failure = String(error) + (error.line ? " @line " + error.line : "");
  }

  var allChecks = true;
  var checkCount = 0;
  for (var key in checks) if (checks.hasOwnProperty(key)) { checkCount += 1; if (checks[key] !== true) allChecks = false; }
  writeJson(resultFile, {
    schemaVersion: 1,
    proofId: "M4_SEGMENTATION_SEQUENCE_P5_REOPEN",
    ok: failure === null && allChecks,
    checkCount: checkCount,
    checks: checks,
    responses: responses,
    failure: failure,
    projectFile: app.project && app.project.file ? app.project.file.fsName : null,
    projectItemCount: app.project ? app.project.numItems : null,
    hostProjectRevision: app.project ? app.project.revision : null,
    reviewFrames: [reviewFiles[0].fsName, reviewFiles[1].fsName, reviewFiles[2].fsName]
  });
}());
