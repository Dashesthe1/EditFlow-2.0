/* Proof-only P5 gate disarming inside the already-running AE process. */
(function () {
  "use strict";
  var evidence = new File(Folder.temp.fsName + "/EditFlow2-m3-marker-motion-p5-disarm.txt");
  var value = "ERROR";
  try {
    $.setenv("EDITFLOW_M3_MARKER_MOTION_P5_PROOF", "");
    value = $.getenv("EDITFLOW_M3_MARKER_MOTION_P5_PROOF") !== "1" ? "DISARMED" : "ERROR";
  } catch (_) {}
  try { evidence.open("w"); evidence.write(value); evidence.close(); } catch (_) {}
}());
