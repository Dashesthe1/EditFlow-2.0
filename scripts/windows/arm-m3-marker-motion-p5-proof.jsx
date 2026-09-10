/* Proof-only P5 gate arming inside the already-running AE process. */
(function () {
  "use strict";
  var evidence = new File(Folder.temp.fsName + "/EditFlow2-m3-marker-motion-p5-arm.txt");
  var value = "ERROR";
  try {
    $.setenv("EDITFLOW_M3_MARKER_MOTION_P5_PROOF", "1");
    value = $.getenv("EDITFLOW_M3_MARKER_MOTION_P5_PROOF") === "1" ? "ARMED" : "ERROR";
  } catch (_) {}
  try { evidence.open("w"); evidence.write(value); evidence.close(); } catch (_) {}
}());
