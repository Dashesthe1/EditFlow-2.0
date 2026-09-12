(function () {
  "use strict";
  var root = new Folder("C:/Users/Shadow/EditFlow-2.0");
  var out = new File(root.fsName + "/proofs/artifacts/m4-two-point-tracking-v1-live.json");
  var loader = new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v21.jsx");
  function write(value) { out.parent.create(); out.open("w"); out.encoding = "UTF-8"; out.write(JSON.stringify(value)); out.close(); }
  function distance(a, b) { return Math.sqrt(Math.pow(b[0] - a[0], 2) + Math.pow(b[1] - a[1], 2)); }
  function angle(a, b) { return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; }
  function findItemByName(name) {
    for (var i = 1; i <= app.project.numItems; i += 1) if (app.project.item(i).name === name) return app.project.item(i);
    return null;
  }
  function seed(point, startPoint, endPoint) {
    var center = point.property("ADBE MTracker Pt Feature Center");
    var feature = point.property("ADBE MTracker Pt Feature Size");
    var search = point.property("ADBE MTracker Pt Search Size");
    var confidence = point.property("ADBE MTracker Pt Confidence");
    var attach = point.property("ADBE MTracker Pt Attach Pt");
    center.setValueAtTime(0, startPoint); center.setValueAtTime(0.5, endPoint);
    attach.setValueAtTime(0, startPoint); attach.setValueAtTime(0.5, endPoint);
    feature.setValue([80, 80]); search.setValue([160, 160]);
    try { confidence.setValueAtTime(0, 96); confidence.setValueAtTime(0.5, 92); } catch (_) {}
  }
  var result = { proof: "M4_TWO_POINT_TRACKING_V1_LIVE", ok: false, checks: {} };
  var undoOpen = false, mutationStarted = false, baselineItems = null, original = null;
  try {
    if (!app.project) throw new Error("No After Effects project is open.");
    original = app.project.activeItem;
    if (!original || !(original instanceof CompItem) || original.numLayers < 1) throw new Error("Active composition with source layer required.");
    var source = original.layer(1).source;
    if (!source) throw new Error("Active layer has no reusable source.");
    baselineItems = app.project.numItems;
    if (!loader.exists) throw new Error("Protocol 2.1 loader missing.");
    $.evalFile(loader);
    if (typeof $.global.EditFlow2_dispatch !== "function" || $.global.EditFlow2_HOST_PROTOCOL_21 !== true) throw new Error("Protocol 2.1 dispatcher unavailable.");

    app.beginUndoGroup("EditFlow M4 two-point tracking live proof"); undoOpen = true;
    var comp = app.project.items.addComp("EF2_M4_TWO_POINT_FIXTURE", original.width, original.height, original.pixelAspect, 1, original.frameRate);
    mutationStarted = true;
    var layer = comp.layers.add(source); layer.name = "EF2_M4_TWO_POINT_TARGET";
    var motion = layer.property("ADBE MTrackers");
    var tracker = motion.addProperty("ADBE MTracker");
    var pointA = tracker.addProperty("ADBE MTracker Pt");
    seed(pointA, [400, 400], [500, 300]);
    var pointB = tracker.addProperty("ADBE MTracker Pt");
    seed(pointB, [600, 400], [500, 600]);
    var request = {
      protocolVersion: "2.1.0", requestId: "M4_TWO_POINT_REQ", transactionId: "M4_TWO_POINT_TX",
      operationId: "M4_TWO_POINT_READ", capabilityId: "ae.tracker.readback", command: "tracker.readback",
      expectedHostProjectRevision: null,
      payload: { comp: { stableId: "", hostId: comp.id }, layer: { stableId: "", hostId: layer.id } },
      readbackProfile: "M4_TWO_POINT_TRACKING_LIVE"
    };
    var response = JSON.parse($.global.EditFlow2_dispatch(JSON.stringify(request)));
    result.response = response;
    var trackers = response && response.readback ? response.readback.trackers : [];
    var points = trackers.length === 1 ? trackers[0].points : [];
    var a = points.length >= 2 ? points[0].samples : [];
    var b = points.length >= 2 ? points[1].samples : [];
    result.checks.protocol21 = response.protocolVersion === "2.1.0" && response.outcome === "NO_OP";
    result.checks.oneTrackerTwoPoints = trackers.length === 1 && points.length === 2;
    result.checks.synchronizedSamples = a.length >= 2 && b.length >= 2 && Math.abs(a[0].time - b[0].time) < 0.000001 && Math.abs(a[1].time - b[1].time) < 0.000001;
    result.checks.compPointsPresent = !!(result.checks.synchronizedSamples && a[0].compPoint && a[1].compPoint && b[0].compPoint && b[1].compPoint);
    if (result.checks.compPointsPresent) {
      var baseDistance = distance(a[0].compPoint, b[0].compPoint);
      var endDistance = distance(a[1].compPoint, b[1].compPoint);
      var rotation = angle(a[1].compPoint, b[1].compPoint) - angle(a[0].compPoint, b[0].compPoint);
      result.geometry = { baselineDistancePx: baseDistance, finalDistancePx: endDistance, scaleRatio: endDistance / baseDistance, rotationDeltaDegrees: rotation };
      result.checks.nativeScaleGeometry = Math.abs(result.geometry.scaleRatio - 1.5) < 0.0001;
      result.checks.nativeRotationGeometry = Math.abs(result.geometry.rotationDeltaDegrees - 90) < 0.0001;
    }
    app.endUndoGroup(); undoOpen = false;
    app.executeCommand(16);
    try { original.openInViewer(); } catch (_) {}
    result.checks.itemCountRestored = app.project.numItems === baselineItems;
    result.checks.fixtureRemoved = findItemByName("EF2_M4_TWO_POINT_FIXTURE") === null;
    result.checks.originalCompRestored = app.project.activeItem && app.project.activeItem.id === original.id;
    result.after = { itemCount: app.project.numItems, activeCompName: app.project.activeItem ? app.project.activeItem.name : null };
    result.ok = result.checks.protocol21 && result.checks.oneTrackerTwoPoints && result.checks.synchronizedSamples
      && result.checks.compPointsPresent && result.checks.nativeScaleGeometry && result.checks.nativeRotationGeometry
      && result.checks.itemCountRestored && result.checks.fixtureRemoved && result.checks.originalCompRestored;
  } catch (error) {
    result.error = String(error);
    if (undoOpen) { try { app.endUndoGroup(); } catch (_) {} undoOpen = false; }
    if (mutationStarted) { try { app.executeCommand(16); result.recoveryUndoAttempted = true; } catch (undoError) { result.recoveryUndoError = String(undoError); } }
    if (original) { try { original.openInViewer(); } catch (_) {} }
    if (app.project && baselineItems !== null) result.recoveryItemCount = app.project.numItems;
  } finally {
    write(result);
  }
}());
