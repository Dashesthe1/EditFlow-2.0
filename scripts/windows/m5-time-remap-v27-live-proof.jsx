(function () {
  "use strict";

  var rootPath = "__EDITFLOW_REPO_ROOT__";
  var out = new File("__EDITFLOW_HOST_RESULT__");
  var loader = new File(rootPath + "/packages/adapters/ae-cep/host/editflow_host_current_v27.jsx");
  var result = {
    proof: "M5_TIME_REMAP_V27_LIVE",
    ok: false,
    mutationStarted: false,
    cleanupComplete: false,
    checks: {}
  };

  var parentComp = null;
  var sourceComp = null;
  var solidSource = null;
  var baselineItems = app.project ? app.project.numItems : null;

  function write(value) {
    out.parent.create();
    out.open("w");
    out.encoding = "UTF-8";
    var codec = $.global.EditFlow2_JSON || $.global.JSON;
    out.write(codec ? codec.stringify(value) : String(value));
    out.close();
  }

  function request(command, capability, layer, expectedRevision, profile, suffix) {
    return {
      protocolVersion: "2.7.0",
      requestId: "M5_TIME_REMAP_" + suffix,
      transactionId: "M5_TIME_REMAP_TX_" + suffix,
      operationId: "M5_TIME_REMAP_OP_" + suffix,
      capabilityId: capability,
      command: command,
      expectedHostProjectRevision: expectedRevision,
      payload: {
        comp: { stableId: "", hostId: parentComp.id },
        layer: { stableId: "", hostId: layer.id }
      },
      readbackProfile: profile || null
    };
  }

  function dispatch(value) {
    return $.global.EditFlow2_JSON.parse(
      $.global.EditFlow2_dispatch($.global.EditFlow2_JSON.stringify(value))
    );
  }

  function disabledState(readback) {
    return !!readback
      && readback.canSetTimeRemapEnabled === true
      && readback.timeRemapEnabled === false
      && readback.numKeys === 0
      && readback.keys.length === 0;
  }

  function enabledState(readback) {
    return !!readback
      && readback.canSetTimeRemapEnabled === true
      && readback.timeRemapEnabled === true
      && readback.propertyAvailable === true
      && readback.propertyMatchName === "ADBE Time Remapping"
      && readback.numKeys >= 2
      && readback.keys.length === readback.numKeys;
  }

  function sameKeys(left, right) {
    if (!left || !right || left.numKeys !== right.numKeys || left.keys.length !== right.keys.length) return false;
    for (var i = 0; i < left.keys.length; i += 1) {
      if (left.keys[i].index !== right.keys[i].index) return false;
      if (Math.abs(Number(left.keys[i].time) - Number(right.keys[i].time)) > 0.000001) return false;
      if (Math.abs(Number(left.keys[i].value) - Number(right.keys[i].value)) > 0.000001) return false;
    }
    return true;
  }

  try {
    if (!app.project) throw new Error("No After Effects project is open.");
    if (!loader.exists) throw new Error("Protocol 2.7 loader is missing.");

    baselineItems = app.project.numItems;

    sourceComp = app.project.items.addComp(
      "EDITFLOW_TIME_REMAP_SOURCE_" + (new Date()).getTime(),
      64,
      64,
      1,
      2,
      24
    );
    var solidLayer = sourceComp.layers.addSolid([1, 0, 0], "SOURCE_SOLID", 64, 64, 1, 2);
    solidSource = solidLayer.source;

    parentComp = app.project.items.addComp(
      "EDITFLOW_TIME_REMAP_PARENT_" + (new Date()).getTime(),
      64,
      64,
      1,
      2,
      24
    );
    var successLayer = parentComp.layers.add(sourceComp);
    successLayer.name = "TIME_REMAP_SUCCESS";
    var rollbackLayer = parentComp.layers.add(sourceComp);
    rollbackLayer.name = "TIME_REMAP_ROLLBACK";
    var unsupportedLayer = parentComp.layers.addText("TIME_REMAP_UNSUPPORTED");

    $.evalFile(loader);
    if (!$.global.EditFlow2_HOST_PROTOCOL_27) throw new Error("Protocol 2.7 did not load.");

    var initial = dispatch(request(
      "layer.time_remap.readback",
      "ae.layer.time_remap.readback",
      successLayer,
      null,
      null,
      "INITIAL"
    ));
    result.initial = initial;
    result.checks.initialDisabled = initial.outcome === "NO_OP" && disabledState(initial.readback);

    var revisionBeforeUnsupported = app.project.revision;
    var unsupported = dispatch(request(
      "layer.time_remap.enable",
      "ae.layer.time_remap.enable",
      unsupportedLayer,
      revisionBeforeUnsupported,
      null,
      "UNSUPPORTED"
    ));
    result.unsupported = unsupported;
    result.checks.unsupportedRejectedWithoutMutation =
      unsupported.outcome === "REJECTED"
      && unsupported.error
      && unsupported.error.code === "TIME_REMAP_NOT_SUPPORTED"
      && app.project.revision === revisionBeforeUnsupported;

    var revisionBeforeEnable = app.project.revision;
    result.mutationStarted = true;
    var applied = dispatch(request(
      "layer.time_remap.enable",
      "ae.layer.time_remap.enable",
      successLayer,
      revisionBeforeEnable,
      null,
      "APPLY"
    ));
    result.applied = applied;
    result.checks.applied = applied.outcome === "APPLIED" && enabledState(applied.readback);

    var verify = dispatch(request(
      "layer.time_remap.readback",
      "ae.layer.time_remap.readback",
      successLayer,
      null,
      null,
      "VERIFY"
    ));
    result.verify = verify;
    result.checks.independentReadback =
      verify.outcome === "NO_OP"
      && enabledState(verify.readback)
      && sameKeys(applied.readback, verify.readback);

    var idempotent = dispatch(request(
      "layer.time_remap.enable",
      "ae.layer.time_remap.enable",
      successLayer,
      app.project.revision,
      null,
      "IDEMPOTENT"
    ));
    result.idempotent = idempotent;
    result.checks.idempotent =
      idempotent.outcome === "NO_OP"
      && enabledState(idempotent.readback)
      && sameKeys(verify.readback, idempotent.readback);

    var stale = dispatch(request(
      "layer.time_remap.enable",
      "ae.layer.time_remap.enable",
      successLayer,
      revisionBeforeEnable,
      null,
      "STALE"
    ));
    result.stale = stale;
    result.checks.staleRejected =
      stale.outcome === "REJECTED"
      && stale.error
      && stale.error.code === "HOST_REVISION_CONFLICT";

    var rollbackInitial = dispatch(request(
      "layer.time_remap.readback",
      "ae.layer.time_remap.readback",
      rollbackLayer,
      null,
      null,
      "ROLLBACK_INITIAL"
    ));
    result.rollbackInitial = rollbackInitial;
    result.checks.rollbackStartedDisabled =
      rollbackInitial.outcome === "NO_OP" && disabledState(rollbackInitial.readback);

    $.setenv("EDITFLOW_M5_TIME_REMAP_P4_PROOF", "1");
    var rollback = dispatch(request(
      "layer.time_remap.enable",
      "ae.layer.time_remap.enable",
      rollbackLayer,
      app.project.revision,
      "M5_TIME_REMAP_P4_FAILURE_INJECTION",
      "ROLLBACK"
    ));
    $.setenv("EDITFLOW_M5_TIME_REMAP_P4_PROOF", "");
    result.rollback = rollback;
    result.checks.rollbackFailedAsInjected =
      rollback.outcome === "FAILED"
      && rollback.error
      && rollback.error.code === "M5_TIME_REMAP_P4_INDUCED_FAILURE"
      && disabledState(rollback.readback);

    var rollbackVerify = dispatch(request(
      "layer.time_remap.readback",
      "ae.layer.time_remap.readback",
      rollbackLayer,
      null,
      null,
      "ROLLBACK_VERIFY"
    ));
    result.rollbackVerify = rollbackVerify;
    result.checks.rollbackRestoredExact =
      rollbackVerify.outcome === "NO_OP"
      && disabledState(rollbackVerify.readback);

    result.ok =
      result.checks.initialDisabled
      && result.checks.unsupportedRejectedWithoutMutation
      && result.checks.applied
      && result.checks.independentReadback
      && result.checks.idempotent
      && result.checks.staleRejected
      && result.checks.rollbackStartedDisabled
      && result.checks.rollbackFailedAsInjected
      && result.checks.rollbackRestoredExact;
  } catch (error) {
    result.error = String(error);
    try { $.setenv("EDITFLOW_M5_TIME_REMAP_P4_PROOF", ""); } catch (_) {}
  } finally {
    try {
      if (parentComp) parentComp.remove();
    } catch (cleanupParent) {
      result.cleanupError = String(cleanupParent);
    }
    try {
      if (sourceComp) sourceComp.remove();
    } catch (cleanupSource) {
      result.cleanupError = String(cleanupSource);
    }
    try {
      if (solidSource) solidSource.remove();
    } catch (cleanupSolidSource) {
      result.cleanupError = String(cleanupSolidSource);
    }

    result.after = {
      itemCount: app.project ? app.project.numItems : null,
      baselineItemCount: baselineItems
    };
    result.checks.itemCountRestored = result.after.itemCount === baselineItems;
    result.cleanupComplete = result.checks.itemCountRestored;
    result.ok = result.ok && result.cleanupComplete;
    write(result);
  }
}());
