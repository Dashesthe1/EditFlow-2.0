/* EditFlow 2.0 M2 bounded real-After-Effects proof. */
(function () {
  var startedAt = (new Date()).toISOString();
  var proofFile = new File($.fileName);
  var repoRoot = proofFile.parent.parent.parent;
  var hostScript = new File(repoRoot.fsName + "/packages/adapters/ae-cep/host/editflow_host_current.jsx");
  var artifactDir = new Folder(repoRoot.fsName + "/proofs/artifacts/m2-real-host");
  if (!artifactDir.exists) artifactDir.create();
  var resultFile = new File(artifactDir.fsName + "/result.json");
  var renderFile = new File(artifactDir.fsName + "/m2-proof.avi");
  if (renderFile.exists) { try { renderFile.remove(); } catch (_) {} }

  var prefix = "M2_PROOF_" + (new Date()).getTime();
  var sourceStable = prefix + "_SOURCE_COMP";
  var targetStable = prefix + "_TARGET_COMP";
  var layerStable = prefix + "_LAYER";
  var precompStable = prefix + "_PRECOMP";
  var replacementStable = prefix + "_PRECOMP_REPLACEMENT";
  var checks = {};
  var responses = [];
  var errorText = null;
  var baselineCount = app.project ? app.project.numItems : 0;

  function writeResult(payload) {
    resultFile.encoding = "UTF-8";
    if (!resultFile.open("w")) throw new Error("Unable to open M2 result file for writing.");
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

  function removeItemIfPresent(stableId) {
    var item = findItemByStable(stableId);
    if (item) { try { item.remove(); } catch (_) {} }
  }

  function capabilityFor(command) {
    var map = {
      "host.probe": "ae.host.probe",
      "project.inspect": "ae.project.inspect",
      "comp.create": "ae.comp.create",
      "comp.remove": "ae.comp.remove",
      "layer.add_media": "ae.layer.create",
      "layer.set_transform": "ae.layer.transform.set",
      "layer.set_timing": "ae.layer.timing.set",
      "effect.add": "ae.effect.add",
      "effect.set_property": "ae.effect.property.set",
      "property.set_keyframes": "ae.keyframe.set",
      "property.set_expression": "ae.expression.set",
      "layers.precompose": "ae.precompose.layers",
      "render.capture": "ae.render.capture",
      "readback.object": "ae.object.readback"
    };
    return map[command] || "ae.proof.unknown";
  }

  function isMutation(command) {
    return command !== "host.probe" && command !== "project.inspect" && command !== "readback.object";
  }

  var requestCounter = 0;
  function call(command, payload) {
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
      readbackProfile: "M2_REAL_AE_PROOF"
    };
    var raw = $.global.EditFlow2_dispatch(JSON.stringify(request));
    var response = JSON.parse(raw);
    responses.push({ command: command, outcome: response.outcome, error: response.error, hostProjectRevision: response.hostProjectRevision });
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(command + " failed: " + (response.error ? response.error.code + " " + response.error.message : response.outcome));
    }
    return response;
  }

  function itemRef(stableId) { return { stableId: stableId }; }
  function layerRef(stableId) { return { stableId: stableId }; }

  try {
    if (!hostScript.exists) throw new Error("EditFlow current host script not found: " + hostScript.fsName);
    $.evalFile(hostScript);
    if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow2_dispatch was not registered.");

    var probe = call("host.probe", {});
    checks.host_probe = probe.environmentProbe
      && probe.environmentProbe.hostName === "Adobe After Effects"
      && probe.environmentProbe.adapterProtocolVersion === "1.1.0";
    var baseline = call("project.inspect", {});
    checks.project_inspect = baseline.projectSnapshot && baseline.projectSnapshot.itemCount === baselineCount;

    var source = call("comp.create", {
      stableId: sourceStable,
      name: prefix + " Source",
      width: 320,
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24
    });
    checks.source_comp_create = source.affectedObjects && source.affectedObjects.length === 1;
    var sourceItem = findItemByStable(sourceStable);
    if (!sourceItem) throw new Error("Created source comp was not resolvable by stable ID.");
    sourceItem.bgColor = [0.85, 0.08, 0.08];

    var target = call("comp.create", {
      stableId: targetStable,
      name: prefix + " Target",
      width: 320,
      height: 320,
      pixelAspect: 1,
      duration: 1,
      frameRate: 24
    });
    checks.target_comp_create = target.affectedObjects && target.affectedObjects.length === 1;

    var layer = call("layer.add_media", {
      stableId: layerStable,
      comp: itemRef(targetStable),
      item: itemRef(sourceStable)
    });
    checks.layer_add = layer.readback && layer.readback.layer && layer.readback.layer.stableId === layerStable;

    var transform = call("layer.set_transform", {
      comp: itemRef(targetStable),
      layer: layerRef(layerStable),
      values: { position: [160, 160], scale: [92, 92], rotation: 3, opacity: 100 }
    });
    checks.transform = transform.readback && transform.readback.transform;

    var timing = call("layer.set_timing", {
      comp: itemRef(targetStable),
      layer: layerRef(layerStable),
      timing: { startTime: 0, inPoint: 0, outPoint: 1, stretch: 100 }
    });
    checks.timing = timing.readback && timing.readback.layer && timing.readback.layer.outPoint === 1;

    var effect = call("effect.add", {
      comp: itemRef(targetStable),
      layer: layerRef(layerStable),
      matchName: "ADBE Gaussian Blur 2",
      name: prefix + " Blur"
    });
    checks.effect_add = effect.readback && typeof effect.readback.propertyIndex === "number";
    var effectIndex = effect.readback.propertyIndex;

    var effectProperty = call("effect.set_property", {
      comp: itemRef(targetStable),
      layer: layerRef(layerStable),
      effectIndex: effectIndex,
      propertyPath: [1],
      value: 6
    });
    checks.effect_property = effectProperty.readback !== null;

    var keys = call("property.set_keyframes", {
      comp: itemRef(targetStable),
      layer: layerRef(layerStable),
      propertyPath: ["ADBE Transform Group", "ADBE Position"],
      keyframes: [
        { time: 0, value: [150, 160] },
        { time: 0.5, value: [170, 160] },
        { time: 1, value: [160, 160] }
      ]
    });
    checks.keyframes = keys.readback && keys.readback.numKeys === 3;

    var expression = call("property.set_expression", {
      comp: itemRef(targetStable),
      layer: layerRef(layerStable),
      propertyPath: ["ADBE Transform Group", "ADBE Opacity"],
      expression: "value",
      enabled: true
    });
    checks.expression = expression.readback && expression.readback.enabled === true;

    var render = call("render.capture", {
      comp: itemRef(targetStable),
      outputPath: renderFile.fsName,
      timeSpanStart: 0,
      timeSpanDuration: 1
    });
    checks.render_capture = renderFile.exists && renderFile.length > 0;

    var precompose = call("layers.precompose", {
      comp: itemRef(targetStable),
      layers: [layerRef(layerStable)],
      name: prefix + " Precomp",
      stableId: precompStable,
      replacementStableId: replacementStable,
      moveAllAttributes: true
    });
    checks.precompose = precompose.readback
      && precompose.readback.composition
      && precompose.readback.composition.stableId === precompStable;
    checks.precompose_replacement_identity = precompose.readback
      && precompose.readback.replacementLayer
      && precompose.readback.replacementLayer.stableId === replacementStable;

    var inspectAfter = call("project.inspect", {});
    var stableSeen = {};
    var replacementSeen = false;
    var i, j;
    for (i = 0; i < inspectAfter.projectSnapshot.items.length; i += 1) {
      var itemSnapshot = inspectAfter.projectSnapshot.items[i];
      var s = itemSnapshot.stableId;
      if (s) stableSeen[s] = true;
      if (itemSnapshot.composition && itemSnapshot.composition.layers) {
        for (j = 0; j < itemSnapshot.composition.layers.length; j += 1) {
          if (itemSnapshot.composition.layers[j].stableId === replacementStable) replacementSeen = true;
        }
      }
    }
    checks.stable_id_readback = stableSeen[sourceStable] && stableSeen[targetStable] && stableSeen[precompStable] && replacementSeen;
  } catch (error) {
    errorText = String(error);
  } finally {
    removeItemIfPresent(targetStable);
    removeItemIfPresent(precompStable);
    removeItemIfPresent(sourceStable);
  }

  checks.cleanup_restored_item_count = app.project.numItems === baselineCount;
  var allCore = true;
  var key;
  for (key in checks) if (checks.hasOwnProperty(key) && checks[key] !== true) allCore = false;

  var payload = {
    proofId: "M2_REAL_AE_HOST_BOUNDED",
    status: errorText ? "FAILED" : (allCore ? "PARTIAL_PASS" : "PARTIAL_FAILURE"),
    ok: !errorText && allCore,
    startedAt: startedAt,
    completedAt: (new Date()).toISOString(),
    adapterProtocolVersion: "1.1.0",
    hostVersion: app.version,
    hostBuild: app.buildNumber !== undefined ? String(app.buildNumber) : null,
    checks: checks,
    proofLevels: {
      P1_validation: true,
      P2_structural_readback: !errorText,
      P3_render_artifact: checks.render_capture === true,
      P4_bounded_cleanup: checks.cleanup_restored_item_count === true,
      P4_failure_injection_rollback: false,
      P5_save_reopen_reconnect_transfer: false
    },
    renderArtifact: renderFile.exists ? renderFile.fsName : null,
    responses: responses,
    error: errorText,
    note: "Bounded current-project proof only. It deliberately does not save/reopen the user's project. P4 failure injection and P5 remain gated."
  };
  writeResult(payload);
}());
