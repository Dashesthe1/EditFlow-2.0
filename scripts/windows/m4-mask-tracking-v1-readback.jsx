(function () {
  "use strict";
  var root = new Folder("C:/Users/Shadow/EditFlow-2.0");
  var fixtureFile = new File(root.fsName + "/proofs/artifacts/m4-mask-tracking-v1-fixture.json");
  var out = new File(root.fsName + "/proofs/artifacts/m4-mask-tracking-v1-protocol12-readback.json");
  function readText(file) { file.open("r"); var text = file.read(); file.close(); return text; }
  function writeText(file, text) { file.parent.create(); file.open("w"); file.encoding = "UTF-8"; file.write(text); file.close(); }
  try {
    $.evalFile(new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_host_current.jsx"));
    var fixture = $.global.EditFlow2_JSON.parse(readText(fixtureFile));
    var request = {
      protocolVersion: "1.2.0",
      requestId: "M4_MASK_TRACK_READBACK",
      transactionId: "M4_MASK_TRACK_READBACK",
      operationId: "M4_MASK_TRACK_READBACK",
      capabilityId: "ae.mask.readback",
      command: "mask.readback",
      expectedHostProjectRevision: null,
      payload: {
        comp: { hostId: fixture.compHostId },
        layer: { hostId: fixture.layerHostId },
        mask: { stableId: fixture.maskStableId }
      },
      readbackProfile: "M4_MASK_TRACKING_VERIFY"
    };
    var raw = $.global.EditFlow2_dispatch($.global.EditFlow2_JSON.stringify(request));
    writeText(out, raw);
  } catch (caught) {
    writeText(out, '{"outcome":"FAILED","proofFailure":' + $.global.EditFlow2_JSON.stringify(String(caught)) + '}');
  }
}());
