/* EditFlow diagnostic only: dump the in-memory async-render stage trace from the
 * already-running self-hosted After Effects instance. No caller data is executed. */
(function () {
  "use strict";
  function text(value) {
    var source = value === null || value === undefined ? "" : String(value);
    return source.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  }
  var marker = new File(Folder.temp.fsName + "/EditFlow2-render-driver-trace-dump.txt");
  marker.encoding = "UTF-8";
  if (!marker.open("w")) return;
  try {
    var active = $.global.EditFlow2_activeRenderJob;
    var last = $.global.EditFlow2_lastRenderJob;
    marker.writeln("trace=" + text($.global.EditFlow2_asyncRenderTrace));
    marker.writeln("active_state=" + text(active ? active.state : null));
    marker.writeln("active_mode=" + text(active ? active.mode : null));
    marker.writeln("active_job=" + text(active ? active.jobId : null));
    marker.writeln("last_state=" + text(last ? last.state : null));
    marker.writeln("last_job=" + text(last ? last.jobId : null));
    marker.writeln("rendering=" + text(app.project && app.project.renderQueue ? app.project.renderQueue.rendering : null));
    marker.writeln("queue_items=" + text(app.project && app.project.renderQueue ? app.project.renderQueue.numItems : null));
  } finally {
    marker.close();
  }
}());
