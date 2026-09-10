/* Bounded M3 marker-motion P4 proof gate disarming helper. */
(function () {
  "use strict";
  var flag = "EDITFLOW_M3_MARKER_MOTION_P4_PROOF";
  var evidence = new File(Folder.temp.fsName + "/EditFlow2-m3-marker-motion-p4-disarm.txt");
  try {
    $.setenv(flag, "0");
    evidence.encoding = "UTF-8";
    evidence.open("w");
    evidence.write($.getenv(flag) === "0" ? "DISARMED" : ("FAILED:" + String($.getenv(flag))));
    evidence.close();
  } catch (error) {
    try {
      evidence.encoding = "UTF-8";
      evidence.open("w");
      evidence.write("ERROR:" + String(error));
      evidence.close();
    } catch (_) {}
    throw error;
  }
}());
