/* EditFlow 2.0 M2 P4/P5 proof. RUN ONLY FROM A BLANK UNSAVED PROJECT. */
(function () {
  var startedAt = (new Date()).toISOString();
  var proofFile = new File($.fileName);
  var repoRoot = proofFile.parent.parent.parent;
  var hostScript = new File(repoRoot.fsName + "/packages/adapters/ae-cep/host/editflow_host_current.jsx");
  var artifactDir = new Folder(repoRoot.fsName + "/proofs/artifacts/m2-disposable-p4-p5");
  if (!artifactDir.exists) artifactDir.create();
  var resultFile = new File(artifactDir.fsName + "/result.json");
  var projectFile = new File(artifactDir.fsName + "/m2-disposable-proof.aep");
  if (projectFile.exists) { try { projectFile.remove(); } catch (_) {} }

  var prefix = "M2_P45_" + (new Date()).getTime();
  var sourceStable = prefix + "_SOURCE";
  var parentStable = prefix + "_PARENT";
  var layerStable = prefix + "_LAYER_ORIGINAL";
  var duplicateStable = prefix + "_LAYER_DUPLICATE";
  var childStable = prefix + "_CHILD_PRECOMP";
  var replacementStable = prefix + "_REPLACEMENT";
  var rollbackStable = prefix + "_ROLLBACK_SHOULD_DISAPPEAR";
  var transferStable = prefix + "_TRANSFER_AFTER_RECONNECT";
  var checks = {};
  var responses = [];
  var errorText = null;
  var refused = false;
  var requestCounter = 0;
  var initialWasBlankUnsaved = app.project && app.project.file === null && app.project.numItems === 0;

  function writeResult(payload) {
    resultFile.encoding = "UTF-8";
    if (!resultFile.open("w")) throw new Error("Unable to write P4/P5 result file.");
    resultFile.write(JSON.stringify(payload, null, 2));
    resultFile.close();
  }

  function stableIdFromComment(text) {
    var marker = "[[EDITFLOW2_STABLE:";
    var source = String(text || "");
    var start = source.indexOf(marker);
    if (start < 0) return null;
    start += marker.length;
    var end = source.indexOf("]]", start);
    return end < 0 ? null : source.substring(start, end);
  }

  function findItemByStable(stableId) {
    var i;
    for (i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (stableIdFromComment(item.comment) === stableId) return item;
    }
    return null;
  }

  function findLayerByStable(comp, stableId) {
    var i;
    for (i = 1; i <= comp.numLayers; i += 1) {
      if (stableIdFromComment(comp.layer(i).comment) === stableId) return comp.layer(i);
    }
    return null;
  }

  function collectStableIds(snapshot) {
    var found = {};
    var i, j;
    for (i = 0; i < snapshot.items.length; i += 1) {
      var item = snapshot.items[i];
      if (item.stableId) found[item.stableId] = { kind: item.kind, hostId: item.hostId };
      if (item.composition && item.composition.layers) {
        for (j = 0; j < item.composition.layers.length; j += 1) {
          var layer = item.composition.layers[j];
          if (layer.stableId) found[layer.stableId] = { kind: layer.kind, hostId: layer.hostId, ownerStableId: item.stableId };
        }
      }
    }
    return found;
  }

  function capabilityFor(command) {
    var map = {
      "host.probe": "ae.host.probe",
      "project.inspect": "ae.project.inspect",
      "project.save": "ae.project.save",
      "comp.create": "ae.comp.create",
      "comp.update_settings": "ae.comp.settings.set",
      "comp.remove": "ae.comp.remove",
      "layer.add_media": "ae.layer.create",
      "layer.duplicate": "ae.layer.duplicate",
      "layer.reorder": "ae.layer.order.set",
      "layers.precompose": "ae.precompose.layers",
      "readback.object": "ae.object.readback",
      "transaction.undo_last": "ae.transaction.undo_last"
    };
    return map[command] || "ae.proof.unknown";
  }

  function isMutation(command) {
    return command !== "host.probe" && command !== "project.inspect" && command !== "readback.object";
  }

  function callRaw(command, payload) {
    requestCounter += 1;
    var revision = app.project.revision;
    var request = {
      protocolVersion: "1.1.0",
      requestId: prefix + "_REQ_" + requestCounter,
      transactionId: prefix + "_TX",
      operationId: prefix + "_OP_" + requestCounter,
      capabilityId: capabilityFor(command),
      command: command,
      expectedProjectRevision: "ae-revision:" + revision,
      expectedProjectFingerprint: null,
      expectedHostProjectRevision: isMutation(command) ? revision : null,
      payload: payload || {},
      readbackProfile: "M2_P4_P5_PROOF"
    };
    var response = JSON.parse($.global.EditFlow2_dispatch(JSON.stringify(request)));
    responses.push({
      command: command,
      outcome: response.outcome,
      error: response.error,
      hostProjectRevision: response.hostProjectRevision,
      notes: response.diagnostics && response.diagnostics.notes ? response.diagnostics.notes : []
    });
    return response;
  }

  function call(command, payload) {
    var response = callRaw(command, payload);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(command + " failed: " + (response.error ? response.error.code + " " + response.error.message : response.outcome));
    }
    return response;
  }

  function itemRef(stableId) { return { stableId: stableId }; }
  function layerRef(stableId) { return { stableId: stableId }; }

  function reloadDispatcher() {
    try { $.global.EditFlow2_dispatch = undefined; } catch (_) {}
    $.evalFile(hostScript);
    if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("Current EditFlow dispatcher failed to register.");
  }

  try {
    if (!initialWasBlankUnsaved) {
      refused = true;
      throw new Error("REFUSED: P4/P5 proof requires a blank unsaved project (zero project items and no project file). No writes were performed.");
    }
    if (!hostScript.exists) throw new Error("Current EditFlow host loader is missing: " + hostScript.fsName);
    reloadDispatcher();

    var probe = call("host.probe", {});
    checks.protocol_1_1 = probe.environmentProbe && probe.environmentProbe.adapterProtocolVersion === "1.1.0";

    var source = call("comp.create", {
      stableId: sourceStable,
      name: "Source Before Rename",
      width: 240, height: 240, pixelAspect: 1, duration: 1, frameRate: 24
    });
    var parent = call("comp.create", {
      stableId: parentStable,
      name: "Parent Before Rename",
      width: 240, height: 240, pixelAspect: 1, duration: 1, frameRate: 24
    });
    checks.comps_created = source.outcome === "APPLIED" && parent.outcome === "APPLIED";

    var added = call("layer.add_media", {
      stableId: layerStable,
      comp: itemRef(parentStable),
      item: itemRef(sourceStable)
    });
    checks.layer_created = added.readback && added.readback.layer && added.readback.layer.stableId === layerStable;

    var sourceItem = findItemByStable(sourceStable);
    var parentItem = findItemByStable(parentStable);
    var originalLayer = parentItem ? findLayerByStable(parentItem, layerStable) : null;
    if (!sourceItem || !parentItem || !originalLayer) throw new Error("Stable targets could not be resolved before rename.");
    sourceItem.name = "Source Renamed Externally";
    parentItem.name = "Parent Renamed Externally";
    originalLayer.name = "Layer Renamed Externally";

    var renamedLayerReadback = call("readback.object", {
      kind: "LAYER",
      comp: itemRef(parentStable),
      target: layerRef(layerStable)
    });
    checks.rename_identity = renamedLayerReadback.readback
      && renamedLayerReadback.readback.layer
      && renamedLayerReadback.readback.layer.name === "Layer Renamed Externally";

    var duplicate = call("layer.duplicate", {
      stableId: duplicateStable,
      comp: itemRef(parentStable),
      layer: layerRef(layerStable)
    });
    checks.duplicate_identity = duplicate.readback && duplicate.readback.layer && duplicate.readback.layer.stableId === duplicateStable;

    var reorder = call("layer.reorder", {
      comp: itemRef(parentStable),
      layer: layerRef(duplicateStable),
      position: "END"
    });
    checks.reorder_identity = reorder.outcome === "APPLIED";

    var precompose = call("layers.precompose", {
      comp: itemRef(parentStable),
      layers: [layerRef(layerStable)],
      name: "Child Precomp",
      stableId: childStable,
      replacementStableId: replacementStable,
      moveAllAttributes: true
    });
    checks.precompose_child_identity = precompose.readback
      && precompose.readback.composition
      && precompose.readback.composition.stableId === childStable;
    checks.precompose_replacement_identity = precompose.readback
      && precompose.readback.replacementLayer
      && precompose.readback.replacementLayer.stableId === replacementStable;

    var beforeRollbackCount = app.project.numItems;
    var rollbackCreate = call("comp.create", {
      stableId: rollbackStable,
      name: "Rollback Candidate",
      width: 80, height: 80, pixelAspect: 1, duration: 1, frameRate: 24
    });
    checks.rollback_setup_applied = rollbackCreate.outcome === "APPLIED" && findItemByStable(rollbackStable) !== null;

    var expectedFailure = callRaw("comp.update_settings", {
      comp: itemRef(prefix + "_MISSING_COMP"),
      settings: { width: 999 }
    });
    checks.failure_injected = expectedFailure.outcome === "FAILED";

    var undo = call("transaction.undo_last", {});
    checks.undo_command_applied = undo.outcome === "APPLIED";
    checks.p4_failure_group_rollback = findItemByStable(rollbackStable) === null && app.project.numItems === beforeRollbackCount;

    var beforeSave = call("project.inspect", {});
    var stableBeforeSave = collectStableIds(beforeSave.projectSnapshot);
    checks.pre_save_all_ids = !!stableBeforeSave[sourceStable]
      && !!stableBeforeSave[parentStable]
      && !!stableBeforeSave[layerStable]
      && !!stableBeforeSave[duplicateStable]
      && !!stableBeforeSave[childStable]
      && !!stableBeforeSave[replacementStable];

    var save = call("project.save", { path: projectFile.fsName });
    checks.saved_disposable_project = projectFile.exists && save.readback && save.readback.filePath;

    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    app.open(projectFile);
    checks.reopened_project = app.project.file && app.project.file.fsName === projectFile.fsName;

    reloadDispatcher();
    var reconnectProbe = call("host.probe", {});
    checks.reconnected_dispatcher = reconnectProbe.environmentProbe
      && reconnectProbe.environmentProbe.adapterProtocolVersion === "1.1.0";

    var afterReopen = call("project.inspect", {});
    var stableAfterReopen = collectStableIds(afterReopen.projectSnapshot);
    checks.p5_ids_after_reopen = !!stableAfterReopen[sourceStable]
      && !!stableAfterReopen[parentStable]
      && !!stableAfterReopen[layerStable]
      && !!stableAfterReopen[duplicateStable]
      && !!stableAfterReopen[childStable]
      && !!stableAfterReopen[replacementStable];

    var childLayerReadback = call("readback.object", {
      kind: "LAYER",
      comp: itemRef(childStable),
      target: layerRef(layerStable)
    });
    checks.renamed_layer_after_reopen = childLayerReadback.readback
      && childLayerReadback.readback.layer
      && childLayerReadback.readback.layer.name === "Layer Renamed Externally";

    var transfer = call("comp.create", {
      stableId: transferStable,
      name: "Transfer After Reconnect",
      width: 64, height: 64, pixelAspect: 1, duration: 0.5, frameRate: 24
    });
    checks.transfer_after_reconnect = transfer.outcome === "APPLIED" && findItemByStable(transferStable) !== null;
    call("comp.remove", { comp: itemRef(transferStable) });
    checks.transfer_cleanup = findItemByStable(transferStable) === null;
  } catch (error) {
    errorText = String(error);
  } finally {
    if (!refused && initialWasBlankUnsaved) {
      try {
        if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
      } catch (_) {}
      try { app.newProject(); } catch (_) {}
    }
  }

  var p4 = checks.failure_injected === true
    && checks.undo_command_applied === true
    && checks.p4_failure_group_rollback === true;
  var p5 = checks.rename_identity === true
    && checks.duplicate_identity === true
    && checks.reorder_identity === true
    && checks.precompose_child_identity === true
    && checks.precompose_replacement_identity === true
    && checks.saved_disposable_project === true
    && checks.reopened_project === true
    && checks.reconnected_dispatcher === true
    && checks.p5_ids_after_reopen === true
    && checks.renamed_layer_after_reopen === true
    && checks.transfer_after_reconnect === true
    && checks.transfer_cleanup === true;

  var payload = {
    proofId: "M2_REAL_AE_P4_P5_DISPOSABLE",
    status: refused ? "REFUSED" : (errorText ? "FAILED" : (p4 && p5 ? "PASS" : "FAILURE")),
    ok: !refused && !errorText && p4 && p5,
    startedAt: startedAt,
    completedAt: (new Date()).toISOString(),
    adapterProtocolVersion: "1.1.0",
    hostVersion: app.version,
    hostBuild: app.buildNumber !== undefined ? String(app.buildNumber) : null,
    projectArtifact: projectFile.exists ? projectFile.fsName : null,
    checks: checks,
    proofLevels: {
      P4_failure_injection_rollback: p4,
      P5_rename_reorder_duplicate_precompose_save_reopen_reconnect_transfer: p5
    },
    responses: responses,
    error: errorText,
    safety: {
      requiredBlankUnsavedProject: true,
      initialWasBlankUnsaved: initialWasBlankUnsaved,
      refusedWithoutWritingIfUnsafe: refused,
      leavesNewBlankProject: !refused && initialWasBlankUnsaved
    }
  };
  writeResult(payload);
}());
