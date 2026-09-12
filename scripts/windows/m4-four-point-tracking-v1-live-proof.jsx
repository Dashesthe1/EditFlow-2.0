(function () {
  "use strict";
  var root = new Folder("C:/Users/Shadow/EditFlow-2.0");
  var out = new File(root.fsName + "/proofs/artifacts/m4-four-point-tracking-v1-live.json");
  var loader = new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v21.jsx");
  function write(value) { out.parent.create(); out.open("w"); out.encoding = "UTF-8"; out.write(JSON.stringify(value)); out.close(); }
  function findItemByName(name) {
    for (var i = 1; i <= app.project.numItems; i += 1) if (app.project.item(i).name === name) return app.project.item(i);
    return null;
  }
  function near(a, b, epsilon) { return Math.abs(a - b) <= epsilon; }
  function nearPoint(a, b, epsilon) {
    return !!a && !!b && a.length >= 2 && b.length >= 2 && near(a[0], b[0], epsilon) && near(a[1], b[1], epsilon);
  }
  function seed(point, startPoint, endPoint) {
    var center = point.property("ADBE MTracker Pt Feature Center");
    var feature = point.property("ADBE MTracker Pt Feature Size");
    var search = point.property("ADBE MTracker Pt Search Size");
    var confidence = point.property("ADBE MTracker Pt Confidence");
    var attach = point.property("ADBE MTracker Pt Attach Pt");
    center.setValueAtTime(0, startPoint); center.setValueAtTime(0.5, endPoint);
    attach.setValueAtTime(0, startPoint); attach.setValueAtTime(0.5, endPoint);
    feature.setValue([60, 60]); search.setValue([140, 140]);
    try { confidence.setValueAtTime(0, 97); confidence.setValueAtTime(0.5, 91); } catch (_) {}
  }
  function sampleAt(points, pointOffset, sampleOffset) {
    return points[pointOffset] && points[pointOffset].samples ? points[pointOffset].samples[sampleOffset] : null;
  }
  function vector(a, b) { return [b[0] - a[0], b[1] - a[1]]; }
  function vectorDistance(a, b) { return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2)); }

  var result = { proof: "M4_FOUR_POINT_TRACKING_V1_LIVE", ok: false, checks: {} };
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

    var baseline = {
      upperLeft: [200, 200], upperRight: [800, 200],
      lowerLeft: [200, 800], lowerRight: [800, 800]
    };
    var destination = {
      upperLeft: [250, 250], upperRight: [760, 170],
      lowerLeft: [180, 780], lowerRight: [850, 820]
    };

    app.beginUndoGroup("EditFlow M4 four-point perspective live proof"); undoOpen = true;
    var comp = app.project.items.addComp("EF2_M4_FOUR_POINT_FIXTURE", 1000, 1000, 1, 1, original.frameRate);
    mutationStarted = true;
    var layer = comp.layers.add(source); layer.name = "EF2_M4_FOUR_POINT_TARGET";
    var transform = layer.property("ADBE Transform Group");
    transform.property("ADBE Anchor Point").setValue([0, 0]);
    transform.property("ADBE Position").setValue([0, 0]);
    var motion = layer.property("ADBE MTrackers");
    var tracker = motion.addProperty("ADBE MTracker");
    seed(tracker.addProperty("ADBE MTracker Pt"), baseline.upperLeft, destination.upperLeft);
    seed(tracker.addProperty("ADBE MTracker Pt"), baseline.upperRight, destination.upperRight);
    seed(tracker.addProperty("ADBE MTracker Pt"), baseline.lowerLeft, destination.lowerLeft);
    seed(tracker.addProperty("ADBE MTracker Pt"), baseline.lowerRight, destination.lowerRight);

    var request = {
      protocolVersion: "2.1.0", requestId: "M4_FOUR_POINT_REQ", transactionId: "M4_FOUR_POINT_TX",
      operationId: "M4_FOUR_POINT_READ", capabilityId: "ae.tracker.readback", command: "tracker.readback",
      expectedHostProjectRevision: null,
      payload: { comp: { stableId: "", hostId: comp.id }, layer: { stableId: "", hostId: layer.id } },
      readbackProfile: "M4_FOUR_POINT_TRACKING_LIVE"
    };
    var response = JSON.parse($.global.EditFlow2_dispatch(JSON.stringify(request)));
    result.response = response;
    result.fixture = { compHostId: comp.id, layerHostId: layer.id, compName: comp.name, layerName: layer.name };
    var trackers = response && response.readback ? response.readback.trackers : [];
    var points = trackers.length === 1 ? trackers[0].points : [];
    result.checks.protocol21 = response.protocolVersion === "2.1.0" && response.outcome === "NO_OP";
    result.checks.oneTrackerFourPoints = trackers.length === 1 && points.length === 4;
    var syncOk = result.checks.oneTrackerFourPoints;
    for (var p = 0; p < points.length && syncOk; p += 1) {
      syncOk = points[p].keyedSampleCount >= 2 && points[p].samples.length >= 2
        && near(points[p].samples[0].time, 0, 0.000001) && near(points[p].samples[1].time, 0.5, 0.000001);
    }
    result.checks.synchronizedSamples = syncOk;
    var expectedStart = [baseline.upperLeft, baseline.upperRight, baseline.lowerLeft, baseline.lowerRight];
    var expectedEnd = [destination.upperLeft, destination.upperRight, destination.lowerLeft, destination.lowerRight];
    var exactAttachPoints = syncOk;
    var usableCompCorners = syncOk;
    var compStart = [];
    var compEnd = [];
    for (var c = 0; c < 4 && exactAttachPoints; c += 1) {
      var startSample = sampleAt(points, c, 0);
      var endSample = sampleAt(points, c, 1);
      exactAttachPoints = nearPoint(startSample.attachPoint, expectedStart[c], 0.0001)
        && nearPoint(endSample.attachPoint, expectedEnd[c], 0.0001);
      usableCompCorners = usableCompCorners && startSample.compPoint && startSample.compPoint.length >= 2
        && endSample.compPoint && endSample.compPoint.length >= 2;
      if (usableCompCorners) { compStart.push(startSample.compPoint); compEnd.push(endSample.compPoint); }
    }
    result.checks.exactNativeAttachPoints = exactAttachPoints;
    result.checks.usableCompCorners = usableCompCorners && compStart.length === 4 && compEnd.length === 4;
    if (result.checks.usableCompCorners) {
      var finalTop = vector(compEnd[0], compEnd[1]);
      var finalBottom = vector(compEnd[2], compEnd[3]);
      var finalLeft = vector(compEnd[0], compEnd[2]);
      var finalRight = vector(compEnd[1], compEnd[3]);
      result.geometry = {
        baselineCompCorners: compStart,
        destinationCompCorners: compEnd,
        oppositeEdgeDeltaPx: {
          horizontal: vectorDistance(finalTop, finalBottom),
          vertical: vectorDistance(finalLeft, finalRight)
        }
      };
      result.checks.nonAffinePerspectiveGeometry = result.geometry.oppositeEdgeDeltaPx.horizontal > 1
        && result.geometry.oppositeEdgeDeltaPx.vertical > 1;
    }

    app.endUndoGroup(); undoOpen = false;
    app.executeCommand(16);
    try { original.openInViewer(); } catch (_) {}
    result.checks.itemCountRestored = app.project.numItems === baselineItems;
    result.checks.fixtureRemoved = findItemByName("EF2_M4_FOUR_POINT_FIXTURE") === null;
    result.checks.originalCompRestored = app.project.activeItem && app.project.activeItem.id === original.id;
    result.after = { itemCount: app.project.numItems, activeCompName: app.project.activeItem ? app.project.activeItem.name : null };
    result.ok = result.checks.protocol21 && result.checks.oneTrackerFourPoints && result.checks.synchronizedSamples
      && result.checks.exactNativeAttachPoints && result.checks.usableCompCorners && result.checks.nonAffinePerspectiveGeometry
      && result.checks.itemCountRestored && result.checks.fixtureRemoved && result.checks.originalCompRestored;
  } catch (caught) {
    result.failure = String(caught);
    if (undoOpen) { try { app.endUndoGroup(); } catch (_) {} undoOpen = false; }
    if (mutationStarted) { try { app.executeCommand(16); result.recoveryUndoAttempted = true; } catch (undoCaught) { result.recoveryUndoFailure = String(undoCaught); } }
    if (original) { try { original.openInViewer(); } catch (_) {} }
    if (app.project && baselineItems !== null) result.recoveryItemCount = app.project.numItems;
  } finally {
    write(result);
  }
}());
