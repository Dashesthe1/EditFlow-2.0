(function () {
  "use strict";
  var root = new Folder("C:/Users/Shadow/EditFlow-2.0");
  var loader = new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v21.jsx");
  function write(path, value) {
    var file = new File(path);
    file.parent.create();
    file.open("w");
    file.encoding = "UTF-8";
    file.write(JSON.stringify(value));
    file.close();
  }
  function findComp() {
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (item instanceof CompItem && item.name === "TP_FIXTURE") return item;
    }
    return null;
  }
  var r = { ok: false };
  try {
    var comp = findComp();
    if (!comp || comp.numLayers !== 1) throw new Error("Exact two-point analysis fixture missing");
    var layer = comp.layer(1);
    if (layer.name !== "TP_TARGET") throw new Error("Target layer mismatch");
    if (!loader.exists) throw new Error("Protocol 2.1 loader missing");
    $.evalFile(loader);
    if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("Protocol 2.1 dispatcher unavailable");
    var request = {
      protocolVersion: "2.1.0",
      requestId: "M4_TP_ANALYSIS_READBACK",
      transactionId: "M4_TP_ANALYSIS_READBACK",
      operationId: "M4_TP_ANALYSIS_READBACK",
      capabilityId: "ae.tracker.readback",
      command: "tracker.readback",
      expectedHostProjectRevision: null,
      payload: { comp: { stableId: "", hostId: comp.id }, layer: { stableId: "", hostId: layer.id } },
      readbackProfile: "M4_TWO_POINT_ANALYSIS_VERIFY"
    };
    var response = JSON.parse($.global.EditFlow2_dispatch(JSON.stringify(request)));
    var trackers = response && response.readback ? response.readback.trackers : [];
    var points = trackers.length === 1 ? trackers[0].points : [];
    if (points.length !== 2) throw new Error("Expected exactly two tracker points");
    var totalKeys = points[0].keyedSampleCount + points[1].keyedSampleCount;
    r = {
      ok: response.protocolVersion === "2.1.0" && response.outcome === "NO_OP",
      compId: comp.id,
      layerId: layer.id,
      trackerCount: trackers.length,
      pointCount: points.length,
      point1KeyedSampleCount: points[0].keyedSampleCount,
      point2KeyedSampleCount: points[1].keyedSampleCount,
      point1SampleCount: points[0].samples.length,
      point2SampleCount: points[1].samples.length,
      point1Samples: points[0].samples,
      point2Samples: points[1].samples,
      response: response
    };
    var label = totalKeys === 0 ? "before" : "after";
    write(root.fsName + "/proofs/artifacts/m4-two-point-analysis-readback-" + label + ".json", r);
  } catch (error) {
    r.error = String(error);
    write(root.fsName + "/proofs/artifacts/m4-two-point-analysis-readback-error.json", r);
  }
}());
