/* EditFlow 2.0 M4 host loader: accepted M3 v20 + typed tracking frame evidence. */
(function () {
  "use strict";
  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current_v20.jsx");
  var trackingRender = new File(hostDir.fsName + "/editflow_host_m4_tracking_render.jsx");
  if (!acceptedLoader.exists) throw new Error("EditFlow accepted protocol 2.0 host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function" || $.global.EditFlow2_HOST_PROTOCOL_20 !== true) throw new Error("EditFlow accepted protocol 2.0 dispatcher failed before M4 load.");
  if (!trackingRender.exists) throw new Error("EditFlow M4 tracking render wrapper is missing: " + trackingRender.fsName);
  $.evalFile(trackingRender);
  if (typeof $.global.EditFlow2_dispatch !== "function" || $.global.EditFlow2_M4_TRACKING_RENDER_PROFILE !== "TRACKING_TIFF_SEQUENCE_V1") throw new Error("EditFlow M4 tracking render profile failed to register.");
  $.global.EditFlow2_HOST_M4 = true;
}());
