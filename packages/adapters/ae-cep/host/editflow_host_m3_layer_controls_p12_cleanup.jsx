/* EditFlow 2.0 M3 layer-controls P1/P2 proof-only cleanup.
 * The self-hosted proof first verifies a blank unsaved project baseline and then
 * creates only prefix-owned disposable objects. Cleanup therefore validates that
 * every remaining project item is proof-owned before discarding the unsaved
 * project and restoring a fresh blank project.
 *
 * This script never throws through After Effects' -r command path. A cleanup
 * failure is left observable in the proof-owned target comment, avoiding a modal
 * script-error dialog that could deadlock the isolated runner.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF";
  var PREFIX_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var ERROR_PREFIX = "[[EDITFLOW2_P12_CLEANUP_ERROR:";

  function stableId(target) {
    try {
      var text = String(target.comment || "");
      var start = text.indexOf(STABLE_PREFIX);
      if (start < 0) return null;
      start += STABLE_PREFIX.length;
      var end = text.indexOf(STABLE_SUFFIX, start);
      return end < 0 ? null : text.substring(start, end);
    } catch (_) { return null; }
  }
  function cleanDiagnostic(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\]\]/g, ")")
      .substring(0, 1200);
  }
  function appendError(target, detail) {
    if (!target || target.comment === undefined) return;
    var existing = String(target.comment || "");
    target.comment = existing + (existing.length ? "\n" : "") + ERROR_PREFIX + cleanDiagnostic(detail) + STABLE_SUFFIX;
  }
  function findTarget(prefix) {
    if (!app.project) return null;
    var targetStable = prefix + "_TARGET_COMP";
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (item instanceof CompItem && stableId(item) === targetStable) return item;
    }
    return null;
  }
  function isProofOwnedItem(item, prefix) {
    var id = stableId(item);
    if (id && id.indexOf(prefix + "_") === 0) return true;
    try { if (String(item.name || "").indexOf(prefix + " ") === 0) return true; } catch (_) {}
    return false;
  }

  if ($.getenv(PROOF_ENV) !== "1") return;
  var prefix = $.getenv(PREFIX_ENV);
  if (!prefix || prefix.indexOf("M3_LAYER_CONTROLS_P12_") !== 0) return;
  if (!app.project || app.project.file) return;

  var target = findTarget(prefix);
  try {
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (!isProofOwnedItem(item, prefix)) {
        appendError(target, "Cleanup refused non-proof project item: " + String(item.name || "<unnamed>"));
        return;
      }
    }

    var closed = app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    if (closed === false) {
      appendError(target, "Cleanup could not close the disposable unsaved project.");
      return;
    }
    app.newProject();
    if (!app.project || app.project.file || app.project.numItems !== 0) return;
  } catch (error) {
    appendError(target, String(error));
  }
}());
