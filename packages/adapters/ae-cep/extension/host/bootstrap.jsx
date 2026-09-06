/* EditFlow 2.0 CEP first-loaded host marker.
 * IMPORTANT: Adobe CEP documents that $.fileName is unreliable in the FIRST JSX file
 * loaded through manifest <ScriptPath>. Do not resolve sibling files from this script.
 * The CEP client obtains the extension root and loads editflow_host_current.jsx by
 * absolute path through $.evalFile; in that second-loaded file $.fileName is reliable.
 */
(function () {
  $.global.EditFlow2_CEP_SCRIPT_PATH_LOADED = true;
}());
