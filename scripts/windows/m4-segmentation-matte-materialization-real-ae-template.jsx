(function () {
  var planFile = new File("__EDITFLOW_PLAN_PATH__");
  var hostLoader = new File("__EDITFLOW_HOST_LOADER__");
  var resultFile = new File("__EDITFLOW_HOST_RESULT__");
  var renderFile = new File("__EDITFLOW_RENDER_PATH__");
  var reviewFrameFile = new File("__EDITFLOW_REVIEW_FRAME_PATH__");
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var responses = [];
  var checks = {};
  var failure = null;
  var renderItem = null;
  var mutationStarted = false;

  function readText(file) {
    if (!file.exists || !file.open("r")) throw new Error("Cannot read " + file.fsName);
    var text = file.read();
    file.close();
    return text;
  }
  function writeJson(file, value) {
    if (!file.parent.exists) file.parent.create();
    if (!file.open("w")) throw new Error("Cannot write " + file.fsName);
    file.encoding = "UTF-8";
    file.write(JSON.stringify(value, null, 2));
    file.close();
  }
  function stableId(target) {    var text = String(target && target.comment !== undefined ? target.comment : "");
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
  function vecNear(a, b) {
    if (!a || !b || a.length < b.length) return false;
    for (var i = 0; i < b.length; i += 1) {
      if (!near(a[i], b[i])) return false;
    }
    return true;
  }
  function responseOk(response) {    return response && response.outcome !== "FAILED" && response.outcome !== "REJECTED";
  }
  var requestCounter = 0;
  var hostRevision = null;
  function dispatchRaw(protocolVersion, capabilityId, command, payload) {
    requestCounter += 1;
    var request = {
      protocolVersion: protocolVersion,
      requestId: "m4-materialization-" + requestCounter,
      transactionId: "M4_SEGMENTATION_MATERIALIZATION_REAL_AE",
      operationId: "M4_SEGMENTATION_MATERIALIZATION_REAL_AE_" + requestCounter,
      capabilityId: capabilityId,
      command: command,
      payload: payload,
      expectedHostProjectRevision: (protocolVersion === "1.3.0" && command !== "layer.composite_readback") ? hostRevision : null,
      readbackProfile: "M4_SEGMENTATION_MATTE_MATERIALIZATION_REAL_AE"
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
  var baselineItems = app.project ? app.project.numItems : -1;
  var baselineRenderItems = app.project ? app.project.renderQueue.numItems : -1;
  var baselineFile = app.project && app.project.file ? app.project.file.fsName : null;
  var plan = null;
  var proofComp = null;
  try {    if (!planFile.exists) throw new Error("Materialization plan is missing");
    if (!hostLoader.exists) throw new Error("EditFlow current host loader is missing");
    $.evalFile(hostLoader);
    if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow host dispatcher did not load");
    plan = JSON.parse(readText(planFile));

    var reserved = [
      "M4_MATERIALIZATION_BG_MEDIA",
      "M4_MATERIALIZATION_SUBJECT_MEDIA",
      "M4_MATERIALIZATION_COMP",
      plan.plan.importItemStableId
    ];
    for (var r = 0; r < reserved.length; r += 1) {
      if (findItem(reserved[r])) throw new Error("Proof stable-id collision: " + reserved[r]);
    }

    mutationStarted = true;
    dispatch("1.1.0", "ae.media.import", "media.import", {
      path: plan.fixtures.backgroundPath, stableId: "M4_MATERIALIZATION_BG_MEDIA", sequence: false
    });
    dispatch("1.1.0", "ae.media.import", "media.import", {
      path: plan.fixtures.subjectPath, stableId: "M4_MATERIALIZATION_SUBJECT_MEDIA", sequence: false
    });
    dispatch("1.1.0", "ae.comp.create", "comp.create", {
      stableId: "M4_MATERIALIZATION_COMP", name: "M4 Segmentation Matte Materialization Proof",
      width: plan.fixtures.width, height: plan.fixtures.height, pixelAspect: 1,
      duration: plan.fixtures.duration, frameRate: plan.fixtures.frameRate
    });    dispatch("1.1.0", "ae.layer.create", "layer.add_media", {
      stableId: "M4_MATERIALIZATION_BG_LAYER",
      comp: { stableId: "M4_MATERIALIZATION_COMP" },
      item: { stableId: "M4_MATERIALIZATION_BG_MEDIA" }
    });
    dispatch("1.1.0", "ae.layer.create", "layer.add_media", {
      stableId: plan.targetState.stableId,
      comp: { stableId: "M4_MATERIALIZATION_COMP" },
      item: { stableId: "M4_MATERIALIZATION_SUBJECT_MEDIA" }
    });
    dispatch("1.1.0", "ae.layer.transform.set", "layer.set_transform", {
      comp: { stableId: "M4_MATERIALIZATION_COMP" },
      layer: { stableId: plan.targetState.stableId },
      values: plan.targetState.transform
    });
    dispatch("1.1.0", "ae.layer.timing.set", "layer.set_timing", {
      comp: { stableId: "M4_MATERIALIZATION_COMP" },
      layer: { stableId: plan.targetState.stableId },
      timing: plan.targetState.timing
    });

    for (var o = 0; o < plan.plan.operations.length; o += 1) {
      var operation = plan.plan.operations[o];
      dispatch(operation.protocolVersion, operation.capabilityId, operation.command, operation.payload);
    }
    proofComp = findItem("M4_MATERIALIZATION_COMP");
    if (!proofComp || !(proofComp instanceof CompItem)) throw new Error("Proof comp did not materialize");
    var matteReadback = dispatch("1.1.0", "ae.object.readback", "readback.object", {
      kind: "LAYER", comp: { stableId: "M4_MATERIALIZATION_COMP" },
      target: { stableId: plan.plan.matteLayerStableId }
    });
    var targetReadback = dispatch("1.1.0", "ae.object.readback", "readback.object", {
      kind: "LAYER", comp: { stableId: "M4_MATERIALIZATION_COMP" },
      target: { stableId: plan.targetState.stableId }
    });
    var compositeReadback = dispatch("1.3.0", "ae.layer.composite.readback", "layer.composite_readback", {
      comp: { stableId: "M4_MATERIALIZATION_COMP" }, layer: { stableId: plan.targetState.stableId }
    });
    var matteState = matteReadback.readback.layer;
    var targetState = targetReadback.readback.layer;
    var compositeState = compositeReadback.readback.composite;
    var expectedTransform = plan.plan.matteTransform;
    var expectedTiming = plan.plan.matteTiming;

    checks.exact_matte_stable_id = matteState.stableId === plan.plan.matteLayerStableId;
    checks.exact_matte_source = matteState.sourceStableId === plan.plan.importItemStableId;
    checks.transform_anchor = vecNear(matteState.transform.anchorPoint, expectedTransform.anchorPoint);
    checks.transform_position = vecNear(matteState.transform.position, expectedTransform.position);
    checks.transform_scale = vecNear(matteState.transform.scale, expectedTransform.scale);
    checks.transform_rotation = near(matteState.transform.rotation, expectedTransform.rotation);
    checks.transform_opacity = near(matteState.transform.opacity, expectedTransform.opacity);
    checks.timing_exact = near(matteState.startTime, expectedTiming.startTime)
      && near(matteState.inPoint, expectedTiming.inPoint)
      && near(matteState.outPoint, expectedTiming.outPoint) && near(matteState.stretch, expectedTiming.stretch);
    checks.target_transform_preserved = vecNear(targetState.transform.anchorPoint, plan.targetState.transform.anchorPoint)
      && vecNear(targetState.transform.position, plan.targetState.transform.position)
      && vecNear(targetState.transform.scale, plan.targetState.transform.scale)
      && near(targetState.transform.rotation, plan.targetState.transform.rotation);
    checks.target_timing_preserved = near(targetState.startTime, plan.targetState.timing.startTime)
      && near(targetState.inPoint, plan.targetState.timing.inPoint)
      && near(targetState.outPoint, plan.targetState.timing.outPoint)
      && near(targetState.stretch, plan.targetState.timing.stretch);
    checks.track_matte_bound = compositeState.hasTrackMatte === true
      && compositeState.trackMatteType === plan.plan.trackMatteType
      && compositeState.trackMatteLayer && compositeState.trackMatteLayer.stableId === plan.plan.matteLayerStableId;

    var matteLayer = findLayer(proofComp, plan.plan.matteLayerStableId);
    var liveSource = matteLayer ? matteLayer.source : null;
    var livePath = liveSource && liveSource.file ? liveSource.file.fsName : null;
    checks.artifact_path_exact = livePath === new File(plan.fixtures.mattePath).fsName;
    checks.artifact_dimensions_exact = liveSource && liveSource.width === plan.segmentation.mask.width
      && liveSource.height === plan.segmentation.mask.height;
    checks.plan_operation_sequence = plan.plan.operations.length === 5
      && plan.plan.operations[0].command === "media.import"
      && plan.plan.operations[1].command === "layer.add_media"
      && plan.plan.operations[2].command === "layer.set_transform"
      && plan.plan.operations[3].command === "layer.set_timing"
      && plan.plan.operations[4].command === "layer.set_track_matte";

    var injectedFailure = dispatchRaw("1.1.0", "ae.comp.settings.set", "comp.update_settings", {
      comp: { stableId: "M4_MATERIALIZATION_MISSING_COMP" }, settings: { width: 999 }
    });
    checks.failure_injected = injectedFailure.outcome === "FAILED" || injectedFailure.outcome === "REJECTED";
    var undo = dispatch("1.1.0", "ae.transaction.undo_last", "transaction.undo_last", {});
    checks.rollback_undo_applied = undo.outcome === "APPLIED";
    var rollbackReadback = dispatch("1.3.0", "ae.layer.composite.readback", "layer.composite_readback", {
      comp: { stableId: "M4_MATERIALIZATION_COMP" }, layer: { stableId: plan.targetState.stableId }
    });
    checks.rollback_cleared_track_matte = rollbackReadback.readback.composite.hasTrackMatte === false;

    var matteOperation = plan.plan.operations[4];
    dispatch(matteOperation.protocolVersion, matteOperation.capabilityId, matteOperation.command, matteOperation.payload);
    var reappliedReadback = dispatch("1.3.0", "ae.layer.composite.readback", "layer.composite_readback", {
      comp: { stableId: "M4_MATERIALIZATION_COMP" }, layer: { stableId: plan.targetState.stableId }
    });
    var reappliedComposite = reappliedReadback.readback.composite;
    checks.rollback_reapply_restored_matte = reappliedComposite.hasTrackMatte === true
      && reappliedComposite.trackMatteType === plan.plan.trackMatteType
      && reappliedComposite.trackMatteLayer && reappliedComposite.trackMatteLayer.stableId === plan.plan.matteLayerStableId;

    proofComp.saveFrameToPng(0.5, reviewFrameFile);
    checks.review_frame_requested = true;

    renderItem = app.project.renderQueue.items.add(proofComp);
    renderItem.timeSpanStart = 0.5;
    renderItem.timeSpanDuration = 1 / plan.fixtures.frameRate;
    var outputModule = renderItem.outputModule(1);
    outputModule.file = renderFile;
    app.project.renderQueue.render();
    var retainedRender = new File(renderFile.fsName);
    checks.visual_artifact_emitted = retainedRender.exists && retainedRender.length > 0;
  } catch (error) {
    failure = String(error) + (error.line ? " @line " + error.line : "");
  } finally {
    try { if (renderItem) renderItem.remove(); } catch (_) {}
    try {
      var ownedComp = findItem("M4_MATERIALIZATION_COMP");
      if (ownedComp) ownedComp.remove();
    } catch (_) {}
    var ownedItems = [
      plan && plan.plan ? plan.plan.importItemStableId : "M4_MATERIALIZATION_MATTE_MEDIA",
      "M4_MATERIALIZATION_SUBJECT_MEDIA",
      "M4_MATERIALIZATION_BG_MEDIA"
    ];
    for (var c = 0; c < ownedItems.length; c += 1) {
      try {
        var owned = findItem(ownedItems[c]);
        if (owned) owned.remove();
      } catch (_) {}
    }
  }

  var afterFile = app.project && app.project.file ? app.project.file.fsName : null;
  var cleanupComplete = app.project && app.project.numItems === baselineItems
    && app.project.renderQueue.numItems === baselineRenderItems
    && afterFile === baselineFile;
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
    proofId: "M4_SEGMENTATION_MATTE_MATERIALIZATION_REAL_AE",
    ok: ok,
    mutationStarted: mutationStarted,
    cleanupComplete: cleanupComplete,
    checkCount: checkCount,
    checks: checks,
    responses: responses,
    failure: failure,
    baseline: { itemCount: baselineItems, renderQueueCount: baselineRenderItems, projectFile: baselineFile },
    after: { itemCount: app.project.numItems, renderQueueCount: app.project.renderQueue.numItems, projectFile: afterFile },
    artifacts: { render: renderFile.fsName, reviewFrame: reviewFrameFile.fsName, plan: planFile.fsName }
  });
}());
