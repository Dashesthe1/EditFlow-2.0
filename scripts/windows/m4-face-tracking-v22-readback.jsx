(function () {
  "use strict";
  var root = new Folder("C:/Users/Shadow/EditFlow-2.0");
  var out = new File(root.fsName + "/proofs/artifacts/m4-face-tracking-v22-readback.json");
  var loader = new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v22.jsx");
  function write(value) { out.parent.create(); out.open("w"); out.encoding = "UTF-8"; out.write(JSON.stringify(value)); out.close(); }
  function findComp(name) {
    var i, item;
    for (i = 1; i <= app.project.numItems; i += 1) {
      item = app.project.item(i);
      if (item instanceof CompItem && item.name === name) return item;
    }
    return null;
  }
  var result = { proof: "M4_FACE_TRACKING_V22_READBACK", ok: false };
  try {
    if (!loader.exists) throw new Error("protocol 2.2 loader missing");
    $.evalFile(loader);
    if (!$.global.EditFlow2_HOST_PROTOCOL_22 || typeof $.global.EditFlow2_dispatch !== "function") throw new Error("protocol 2.2 dispatcher unavailable");
    var comp = findComp("EF2_M4_FACE_TRACK_FIXTURE");
    if (!comp || comp.numLayers < 1) throw new Error("face fixture unavailable");
    var layer = comp.layer(1);
    var request = {
      protocolVersion: "2.2.0",
      requestId: "M4_FACE_V22_LIVE",
      transactionId: "M4_FACE_V22_LIVE",
      operationId: "M4_FACE_V22_LIVE",
      capabilityId: "ae.face.readback",
      command: "face.readback",
      expectedHostProjectRevision: null,
      payload: {
        comp: { hostId: comp.id },
        layer: { hostId: layer.id },
        mask: { stableId: "M4_FACE_TRACK_1" }
      },
      readbackProfile: "M4_FACE_TRACKING_STRUCTURAL"
    };
    var response = $.global.EditFlow2_JSON.parse($.global.EditFlow2_dispatch($.global.EditFlow2_JSON.stringify(request)));
    var face = response.readback ? response.readback.faceTrackPoints : null;
    var mask = response.readback ? response.readback.mask : null;
    var landmarkCount = 0, i, property;
    if (face && face.properties) {
      for (i = 0; i < face.properties.length; i += 1) {
        property = face.properties[i];
        if (property.keyedSampleCount >= 2 && /(eye|eyebrow|pupil|nose|mouth|lip|cheek|chin|forehead|jaw)/i.test(property.name)) landmarkCount += 1;
      }
    }
    result.ok = response.outcome === "NO_OP"
      && !!mask && mask.stableId === "M4_FACE_TRACK_1" && mask.pathKeyCount >= 2
      && !!face && face.name === "Face Track Points" && face.matchName === "Pseudo/ADBE Animal Head66"
      && face.keyedPropertyCount >= 4 && face.maxKeyCount >= 2 && landmarkCount >= 4;
    result.hostProtocol22 = !!$.global.EditFlow2_HOST_PROTOCOL_22;
    result.compHostId = comp.id;
    result.layerHostId = layer.id;
    result.maskPathKeyCount = mask ? mask.pathKeyCount : -1;
    result.faceEffectName = face ? face.name : null;
    result.faceEffectMatchName = face ? face.matchName : null;
    result.keyedPropertyCount = face ? face.keyedPropertyCount : 0;
    result.maxKeyCount = face ? face.maxKeyCount : 0;
    result.landmarkKeyedPropertyCount = landmarkCount;
    result.hostProjectRevision = response.hostProjectRevision;
    result.response = response;
  } catch (caught) {
    result.failure = String(caught);
  } finally {
    write(result);
  }
}());
