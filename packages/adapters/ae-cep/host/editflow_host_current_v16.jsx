/* EditFlow 2.0 additive host loader through protocol 1.6.
 * Loads accepted protocol 1.5 first, then layers M3 layer-controls 1.6 on top.
 * A 1.6 module-load failure restores the accepted prior dispatcher instead of
 * taking protocols 1.1-1.5 offline.
 */
(function () {
  "use strict";

  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var priorHost = new File(hostDir.fsName + "/editflow_host_current_v15.jsx");
  var layerControlsHost = new File(hostDir.fsName + "/editflow_host_m3_layer_controls.jsx");

  if (!priorHost.exists) throw new Error("EditFlow protocol 1.5 host loader is missing: " + priorHost.fsName);
  $.evalFile(priorHost);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 1.5 host dispatcher did not register.");

  var acceptedDispatch = $.global.EditFlow2_dispatch;
  if (!layerControlsHost.exists) throw new Error("EditFlow protocol 1.6 layer-controls host module is missing: " + layerControlsHost.fsName);
  try {
    $.evalFile(layerControlsHost);
    if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 1.6 layer-controls dispatcher did not register.");
  } catch (error) {
    $.global.EditFlow2_dispatch = acceptedDispatch;
    throw error;
  }
}());
