(function () {
  var planFile = new File("__EDITFLOW_PLAN_PATH__");
  var hostLoader = new File("__EDITFLOW_HOST_LOADER__");
  var resultFile = new File("__EDITFLOW_HOST_RESULT__");
  var wrongFrameFile = new File("__EDITFLOW_WRONG_FRAME_PATH__");
  var repairedFrameFile = new File("__EDITFLOW_REPAIRED_FRAME_PATH__");
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var responses = [];
  var checks = {};
  var failure = null;
  var mutationStarted = false;
  var plan = null;
  var proofComp = null;

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
  function pointNear(a, b) { return a && b && near(a[0], b[0]) && near(a[1], b[1]); }
  function pointsNear(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i += 1) if (!pointNear(a[i], b[i])) return false;
    return true;
  }
  function shapeNear(actual, expected) {
    return actual && expected && Boolean(actual.closed) === Boolean(expected.closed)
      && pointsNear(actual.vertices, expected.vertices)
      && pointsNear(actual.inTangents, expected.inTangents)
      && pointsNear(actual.outTangents, expected.outTangents);
  }
  function responseOk(response) {
    return response && response.outcome !== "FAILED" && response.outcome !== "REJECTED";
  }
  var requestCounter = 0;
  var hostRevision = null;
  function dispatchRaw(protocolVersion, capabilityId, command, payload) {
    requestCounter += 1;
    var isMaskReadback = protocolVersion === "1.2.0" && command === "mask.readback";
    var request = {
      protocolVersion: protocolVersion,
      requestId: "m4-mask-repair-" + requestCounter,
      transactionId: "M4_MASK_POINT_REPAIR_REAL_AE",
      operationId: "M4_MASK_POINT_REPAIR_REAL_AE_" + requestCounter,
      capabilityId: capabilityId,
      command: command,
      payload: payload,
      expectedHostProjectRevision: protocolVersion === "1.2.0" && !isMaskReadback ? hostRevision : null,
      readbackProfile: "M4_MASK_POINT_REPAIR_REAL_AE"
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
  try {
    if (!planFile.exists) throw new Error("Mask-point repair proof plan is missing");
    if (!hostLoader.exists) throw new Error("EditFlow current host loader is missing");
    $.evalFile(hostLoader);
    if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow host dispatcher did not load");
    hostRevision = app.project.revision;
    plan = JSON.parse(readText(planFile));

    var reserved = [
      "M4_MASK_REPAIR_BG_MEDIA",
      "M4_MASK_REPAIR_FG_MEDIA",
      "M4_MASK_REPAIR_COMP"
    ];
    for (var r = 0; r < reserved.length; r += 1) {
      if (findItem(reserved[r])) throw new Error("Proof stable-id collision: " + reserved[r]);
    }

    mutationStarted = true;
    dispatch("1.1.0", "ae.media.import", "media.import", {
      path: plan.fixture.backgroundPath, stableId: "M4_MASK_REPAIR_BG_MEDIA", sequence: false
    });
    dispatch("1.1.0", "ae.media.import", "media.import", {
      path: plan.fixture.foregroundPath, stableId: "M4_MASK_REPAIR_FG_MEDIA", sequence: false
    });
    dispatch("1.1.0", "ae.comp.create", "comp.create", {
      stableId: "M4_MASK_REPAIR_COMP", name: "M4 Mask Point Repair Proof",
      width: plan.fixture.width, height: plan.fixture.height, pixelAspect: 1,
      duration: plan.fixture.duration, frameRate: plan.fixture.frameRate
    });
    dispatch("1.1.0", "ae.layer.create", "layer.add_media", {
      stableId: "M4_MASK_REPAIR_BACKGROUND_LAYER",
      comp: { stableId: "M4_MASK_REPAIR_COMP" },
      item: { stableId: "M4_MASK_REPAIR_BG_MEDIA" }
    });
    dispatch("1.1.0", "ae.layer.create", "layer.add_media", {
      stableId: "M4_MASK_REPAIR_FOREGROUND_LAYER",
      comp: { stableId: "M4_MASK_REPAIR_COMP" },
      item: { stableId: "M4_MASK_REPAIR_FG_MEDIA" }
    });
    var createMask = dispatch("1.2.0", "ae.mask.create", "mask.create", {
      comp: { stableId: "M4_MASK_REPAIR_COMP" },
      layer: { stableId: "M4_MASK_REPAIR_FOREGROUND_LAYER" },
      stableId: "M4_MASK_REPAIR_MASK", name: "Known Bad Tracked Mask",
      shape: plan.fixture.wrongShape, properties: plan.fixture.maskProperties
    });
    checks.mask_created_with_wrong_shape = shapeNear(createMask.readback.mask.path, plan.fixture.wrongShape);
    var initialReadback = dispatch("1.2.0", "ae.mask.readback", "mask.readback", {
      comp: { stableId: "M4_MASK_REPAIR_COMP" },
      layer: { stableId: "M4_MASK_REPAIR_FOREGROUND_LAYER" },
      mask: { stableId: "M4_MASK_REPAIR_MASK" }
    });
    var initialMask = initialReadback.readback.mask;
    checks.trusted_initial_readback_exact = shapeNear(initialMask.path, plan.fixture.wrongShape);
    checks.plan_before_matches_readback = pointNear(
      plan.plan.before.vertex,
      initialMask.path.vertices[plan.plan.pointIndex]
    );
    checks.plan_payload_preserves_untouched_geometry =
      pointNear(plan.plan.payload.shape.vertices[0], initialMask.path.vertices[0])
      && pointNear(plan.plan.payload.shape.vertices[1], initialMask.path.vertices[1])
      && pointNear(plan.plan.payload.shape.vertices[3], initialMask.path.vertices[3]);

    proofComp = findItem("M4_MASK_REPAIR_COMP");
    if (!proofComp || !(proofComp instanceof CompItem)) throw new Error("Proof comp did not materialize");
    proofComp.saveFrameToPng(plan.visualExpectations.frameTime, wrongFrameFile);
    checks.wrong_frame_requested = true;

    var repair = dispatch("1.2.0", plan.plan.hostCapabilityId, plan.plan.command, plan.plan.payload);
    checks.repair_applied = repair.outcome === "APPLIED";
    checks.repair_response_exact = shapeNear(repair.readback.mask.path, plan.fixture.expectedShape);
    var repairedReadback = dispatch("1.2.0", "ae.mask.readback", "mask.readback", {
      comp: { stableId: "M4_MASK_REPAIR_COMP" },
      layer: { stableId: "M4_MASK_REPAIR_FOREGROUND_LAYER" },
      mask: { stableId: "M4_MASK_REPAIR_MASK" }
    });
    checks.post_write_readback_exact = shapeNear(repairedReadback.readback.mask.path, plan.fixture.expectedShape);

    var injectedFailure = dispatchRaw("1.1.0", "ae.comp.settings.set", "comp.update_settings", {
      comp: { stableId: "M4_MASK_REPAIR_MISSING_COMP" }, settings: { width: 999 }
    });
    checks.failure_injected_after_repair = injectedFailure.outcome === "FAILED" || injectedFailure.outcome === "REJECTED";
    var undo = dispatch("1.1.0", "ae.transaction.undo_last", "transaction.undo_last", {});
    checks.rollback_undo_applied = undo.outcome === "APPLIED";

    var rollbackReadback = dispatch("1.2.0", "ae.mask.readback", "mask.readback", {
      comp: { stableId: "M4_MASK_REPAIR_COMP" },
      layer: { stableId: "M4_MASK_REPAIR_FOREGROUND_LAYER" },
      mask: { stableId: "M4_MASK_REPAIR_MASK" }
    });
    checks.rollback_restored_wrong_shape = shapeNear(rollbackReadback.readback.mask.path, plan.fixture.wrongShape);

    var reapply = dispatch("1.2.0", plan.plan.hostCapabilityId, plan.plan.command, plan.plan.payload);
    checks.reapply_applied = reapply.outcome === "APPLIED";
    var finalReadback = dispatch("1.2.0", "ae.mask.readback", "mask.readback", {
      comp: { stableId: "M4_MASK_REPAIR_COMP" },
      layer: { stableId: "M4_MASK_REPAIR_FOREGROUND_LAYER" },
      mask: { stableId: "M4_MASK_REPAIR_MASK" }
    });
    checks.reapply_readback_exact = shapeNear(finalReadback.readback.mask.path, plan.fixture.expectedShape);
    checks.repaired_point_exact = pointNear(
      finalReadback.readback.mask.path.vertices[plan.plan.pointIndex],
      plan.plan.after.vertex
    );
    checks.mask_properties_preserved = finalReadback.readback.mask.mode === plan.fixture.maskProperties.mode
      && near(finalReadback.readback.mask.opacity, plan.fixture.maskProperties.opacity)
      && near(finalReadback.readback.mask.expansion, plan.fixture.maskProperties.expansion)
      && Boolean(finalReadback.readback.mask.inverted) === Boolean(plan.fixture.maskProperties.inverted);

    proofComp.saveFrameToPng(plan.visualExpectations.frameTime, repairedFrameFile);
    checks.repaired_frame_requested = true;
  } catch (error) {
    failure = String(error) + (error.line ? " @line " + error.line : "");
  } finally {
    try {
      var ownedComp = findItem("M4_MASK_REPAIR_COMP");
      if (ownedComp) ownedComp.remove();
    } catch (_) {}
    var ownedItems = ["M4_MASK_REPAIR_FG_MEDIA", "M4_MASK_REPAIR_BG_MEDIA"];
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
    proofId: "M4_MASK_POINT_REPAIR_REAL_AE",
    ok: ok,
    mutationStarted: mutationStarted,
    cleanupComplete: cleanupComplete,
    checkCount: checkCount,
    checks: checks,
    responses: responses,
    failure: failure,
    baseline: {
      itemCount: baselineItems,
      renderQueueCount: baselineRenderItems,
      projectFile: baselineFile
    },
    after: {
      itemCount: app.project.numItems,
      renderQueueCount: app.project.renderQueue.numItems,
      projectFile: afterFile
    },
    artifacts: {
      wrongFrame: wrongFrameFile.fsName,
      repairedFrame: repairedFrameFile.fsName,
      plan: planFile.fsName
    }
  });
}());
