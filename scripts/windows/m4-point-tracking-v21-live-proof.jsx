(function () {
  "use strict";
  var repoRoot = new Folder("C:/Users/Shadow/EditFlow-2.0");
  var resultFile = new File(repoRoot.fsName + "/proofs/artifacts/m4-point-tracking-v21-live.json");
  var loader = new File(repoRoot.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v21.jsx");
  function write(value) {
    resultFile.parent.create(); resultFile.open("w"); resultFile.encoding = "UTF-8";
    resultFile.write(JSON.stringify(value)); resultFile.close();
  }
  function vector(value) { return value && value.length >= 2 ? [Number(value[0]), Number(value[1])] : []; }
  var result = { proof: "M4_POINT_TRACKING_V21_LIVE", ok: false, checks: {}, response: null };
  var undoOpen = false, mutationStarted = false, baselineTrackers = null, baselineItems = null;
  var comp = null, layer = null, motion = null;
  try {
    if (!app.project) throw new Error("No After Effects project is open.");
    comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) throw new Error("Active item must be a composition.");
    if (comp.numLayers < 1) throw new Error("Active composition must contain at least one layer.");
    layer = comp.layer(1);
    motion = layer.property("ADBE MTrackers");
    if (!motion) throw new Error("Target layer has no Motion Trackers property group.");
    baselineTrackers = motion.numProperties; baselineItems = app.project.numItems;
    result.baseline = { compName: comp.name, layerName: layer.name, compHostId: comp.id, layerHostId: layer.id, trackerCount: baselineTrackers, itemCount: baselineItems };
    if (baselineTrackers !== 0) throw new Error("Live proof requires target layer to start with zero Motion Trackers.");
    if (!loader.exists) throw new Error("Protocol 2.1 host loader missing: " + loader.fsName);
    $.evalFile(loader);
    if (typeof $.global.EditFlow2_dispatch !== "function" || $.global.EditFlow2_HOST_PROTOCOL_21 !== true) throw new Error("Protocol 2.1 dispatcher did not register.");
    app.beginUndoGroup("EditFlow M4 point-tracking live proof"); undoOpen = true;
    var tracker = motion.addProperty("ADBE MTracker"); mutationStarted = true;
    var point = tracker.addProperty("ADBE MTracker Pt");
    var center = point.property("ADBE MTracker Pt Feature Center");
    var featureSize = point.property("ADBE MTracker Pt Feature Size");
    var searchSize = point.property("ADBE MTracker Pt Search Size");
    var confidence = point.property("ADBE MTracker Pt Confidence");
    var attach = point.property("ADBE MTracker Pt Attach Pt");
    center.setValueAtTime(0, [360, 500]); center.setValueAtTime(0.5, [620, 500]);
    attach.setValueAtTime(0, [360, 500]); attach.setValueAtTime(0.5, [620, 500]);
    featureSize.setValue([100, 80]); searchSize.setValue([180, 160]);
    try { confidence.setValueAtTime(0, 96); confidence.setValueAtTime(0.5, 91); } catch (_) {}
    var request = {
      protocolVersion: "2.1.0", requestId: "M4_TRACK_LIVE_REQ", transactionId: "M4_TRACK_LIVE_TX",
      operationId: "M4_TRACK_LIVE_READ", capabilityId: "ae.tracker.readback", command: "tracker.readback",
      expectedHostProjectRevision: null,
      payload: { comp: { stableId: "", hostId: comp.id }, layer: { stableId: "", hostId: layer.id } },
      readbackProfile: "M4_POINT_TRACKING_LIVE"
    };
    var response = JSON.parse($.global.EditFlow2_dispatch(JSON.stringify(request)));
    result.response = response;
    var trackers = response && response.readback ? response.readback.trackers : [];
    var samples = trackers.length > 0 && trackers[0].points.length > 0 ? trackers[0].points[0].samples : [];
    result.checks.protocol21 = response.protocolVersion === "2.1.0";
    result.checks.noOpReadback = response.outcome === "NO_OP";
    result.checks.oneTracker = trackers.length === 1;
    result.checks.onePoint = result.checks.oneTracker && trackers[0].points.length === 1;
    result.checks.twoOrMoreKeyedSamples = result.checks.onePoint && trackers[0].points[0].keyedSampleCount >= 2 && samples.length >= 2;
    result.checks.compCoordinatesPresent = result.checks.twoOrMoreKeyedSamples && samples[0].compNormalized !== null && samples[1].compNormalized !== null;
    result.checks.motionVisibleInReadback = result.checks.compCoordinatesPresent && Math.abs(samples[1].compNormalized[0] - samples[0].compNormalized[0]) > 0.01;
    result.sampleSummary = samples.length >= 2 ? {
      first: { time: samples[0].time, confidence: samples[0].confidence, attachPoint: vector(samples[0].attachPoint), compNormalized: vector(samples[0].compNormalized) },
      second: { time: samples[1].time, confidence: samples[1].confidence, attachPoint: vector(samples[1].attachPoint), compNormalized: vector(samples[1].compNormalized) }
    } : null;
    app.endUndoGroup(); undoOpen = false;
    app.executeCommand(16);
    result.checks.trackerRollbackExact = motion.numProperties === baselineTrackers;
    result.checks.itemCountRestored = app.project.numItems === baselineItems;
    result.after = { trackerCount: motion.numProperties, itemCount: app.project.numItems, compHostId: comp.id, layerHostId: layer.id };
    result.ok = result.checks.protocol21 && result.checks.noOpReadback && result.checks.oneTracker && result.checks.onePoint
      && result.checks.twoOrMoreKeyedSamples && result.checks.compCoordinatesPresent && result.checks.motionVisibleInReadback
      && result.checks.trackerRollbackExact && result.checks.itemCountRestored;
  } catch (error) {
    result.error = String(error);
    if (undoOpen) { try { app.endUndoGroup(); } catch (_) {} undoOpen = false; }
    if (mutationStarted) {
      try { app.executeCommand(16); result.recoveryUndoAttempted = true; }
      catch (undoError) { result.recoveryUndoError = String(undoError); }
    }
    if (motion && baselineTrackers !== null) result.recoveryTrackerCount = motion.numProperties;
    if (app.project && baselineItems !== null) result.recoveryItemCount = app.project.numItems;
  } finally {
    write(result);
  }
}());
