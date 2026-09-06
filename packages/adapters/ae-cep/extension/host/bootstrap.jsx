/* EditFlow 2.0 CEP first-loaded host marker.
 * Adobe CEP documents that the first manifest ScriptPath file cannot safely derive
 * sibling paths from its current-script filename. Keep this file path-agnostic.
 * The CEP client obtains the extension root and loads the second-stage host by
 * absolute path through the host scripting bridge.
 */
(function () {
  $.global.EditFlow2_CEP_SCRIPT_PATH_LOADED = true;
}());
