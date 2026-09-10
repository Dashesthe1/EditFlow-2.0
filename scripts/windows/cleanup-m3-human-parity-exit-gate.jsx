/* Removes only M3 human-parity exit-gate proof-owned AE objects. */
(function () {
  "use strict";
  var prefix = "M3_EXIT_";
  var stablePrefix = "[[EDITFLOW2_STABLE:";
  var stableSuffix = "]]";
  var evidence = new File(Folder.temp.fsName + "/EditFlow2-m3-exit-gate-cleanup.txt");
  function stableId(text) {
    var value = text === null || text === undefined ? "" : String(text);
    var start = value.indexOf(stablePrefix), end;
    if (start < 0) return null;
    start += stablePrefix.length;
    end = value.indexOf(stableSuffix, start);
    return end < 0 ? null : value.substring(start, end);
  }
  function owned(item) {
    try { var id = stableId(item.comment); return typeof id === "string" && id.indexOf(prefix) === 0; }
    catch (_) { return false; }
  }
  var queueRemoved = 0, itemsRemoved = 0, i, rq, comp, item;
  try {
    for (i = app.project.renderQueue.numItems; i >= 1; i -= 1) {
      rq = app.project.renderQueue.item(i); comp = null;
      try { comp = rq.comp; } catch (_) {}
      if (comp && owned(comp)) { rq.remove(); queueRemoved += 1; }
    }
    for (i = app.project.numItems; i >= 1; i -= 1) {
      item = app.project.item(i);
      if (owned(item)) { item.remove(); itemsRemoved += 1; }
    }
    evidence.open("w"); evidence.write("CLEANED queue=" + queueRemoved + " items=" + itemsRemoved); evidence.close();
  } catch (error) {
    try { evidence.open("w"); evidence.write("ERROR " + String(error)); evidence.close(); } catch (_) {}
  }
}());
