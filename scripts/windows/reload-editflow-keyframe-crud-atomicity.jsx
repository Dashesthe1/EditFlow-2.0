/* Warm development reload for the protocol-1.1 typed keyframe CRUD + atomicity layers.
 * Reuses the running AE process and existing EditFlow host dispatcher.
 */
(function () {
  "use strict";
  var scriptFile = new File($.fileName);
  var repoRoot = scriptFile.parent.parent.parent;
  var hostDir = new Folder(repoRoot.fsName + "/packages/adapters/ae-cep/host");
  var keyframeCrud = new File(hostDir.fsName + "/editflow_host_keyframe_crud.jsx");
  var atomicity = new File(hostDir.fsName + "/editflow_host_atomicity.jsx");
  if (typeof $.global.EditFlow2_dispatch !== "function") {
    throw new Error("EDITFLOW_CURRENT_DISPATCHER_REQUIRED");
  }
  if (!keyframeCrud.exists) throw new Error("KEYFRAME_CRUD_SOURCE_MISSING:" + keyframeCrud.fsName);
  if (!atomicity.exists) throw new Error("ATOMICITY_SOURCE_MISSING:" + atomicity.fsName);
  $.evalFile(keyframeCrud);
  $.evalFile(atomicity);
  $.global.EditFlow2_KEYFRAME_CRUD_WARM_RELOAD = "UNDO_GROUP_V1";
}());