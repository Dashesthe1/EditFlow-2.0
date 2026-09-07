/* EditFlow 2.0 M3 layer-controls P1/P2 proof-only fixture completion.
 * Fixed script, executed only on the isolated self-hosted runner. Accepted
 * protocol 1.1 creates the source/target/audio/precomp setup first; this script
 * adds only the AE-only solid/camera objects needed by the layer-controls matrix.
 *
 * Failures are written into the already proof-owned target composition comment
 * instead of being thrown through After Effects' -r command path. That keeps a
 * host error observable through authenticated project.inspect without opening a
 * modal script-error dialog that can deadlock the self-hosted proof.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF";
  var PREFIX_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var READY_PREFIX = "[[EDITFLOW2_P12_FIXTURE_READY:";
  var ERROR_PREFIX = "[[EDITFLOW2_P12_FIXTURE_ERROR:";

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
  function setStableId(target, value) {
    if (!target || target.comment === undefined) throw new Error("Fixture target cannot carry stable identity: " + value);
    target.comment = STABLE_PREFIX + value + STABLE_SUFFIX;
  }
  function findComp(value) {
    if (!app.project) return null;
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (item instanceof CompItem && stableId(item) === value) return item;
    }
    return null;
  }
  function cleanDiagnostic(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\]\]/g, ")")
      .substring(0, 1200);
  }
  function appendProofComment(target, marker, detail) {
    if (!target || target.comment === undefined) return;
    var existing = String(target.comment || "");
    target.comment = existing + (existing.length ? "\n" : "") + marker + cleanDiagnostic(detail) + STABLE_SUFFIX;
  }

  /* A proof-gate violation must fail closed without mutating AE and without
   * surfacing a modal -r script error. The caller will observe the unchanged
   * baseline and report the fixture as not ready.
   */
  if ($.getenv(PROOF_ENV) !== "1") return;
  var prefix = $.getenv(PREFIX_ENV);
  if (!prefix || prefix.indexOf("M3_LAYER_CONTROLS_P12_") !== 0) return;
  if (!app.project || app.project.file) return;

  var targetStable = prefix + "_TARGET_COMP";
  var precompLayerStable = prefix + "_PRECOMP_LAYER";
  var audioLayerStable = prefix + "_AUDIO_LAYER";
  var solidMediaStable = prefix + "_SOLID_MEDIA";
  var solidLayerStable = prefix + "_SOLID_LAYER";
  var cameraLayerStable = prefix + "_CAMERA_LAYER";
  var target = findComp(targetStable);
  if (!target) return;

  var stage = "preflight";
  var undoOpen = false;
  try {
    if (app.project.numItems !== 3) throw new Error("Fixture completion expected exactly three typed-setup project items before solid creation.");
    if (target.numLayers !== 2) throw new Error("Fixture completion expected exactly two typed-setup target layers.");
    if (stableId(target.layer(1)) !== audioLayerStable || stableId(target.layer(2)) !== precompLayerStable) {
      throw new Error("Fixture completion typed-setup layer order is not deterministic.");
    }

    app.beginUndoGroup("EditFlow M3 layer-controls P1/P2 fixture completion");
    undoOpen = true;

    stage = "add_solid";
    var solidLayer = target.layers.addSolid([0.15, 0.35, 0.75], prefix + " Solid", 160, 90, 1, 2);
    setStableId(solidLayer, solidLayerStable);
    if (!solidLayer.source) throw new Error("Fixture solid layer has no source FootageItem.");
    setStableId(solidLayer.source, solidMediaStable);

    stage = "add_camera";
    var cameraLayer = target.layers.addCamera(prefix + " Camera", [target.width / 2, target.height / 2]);
    setStableId(cameraLayer, cameraLayerStable);

    app.endUndoGroup();
    undoOpen = false;

    stage = "verify_shape";
    if (app.project.numItems !== 4) throw new Error("Layer-controls fixture expected exactly four project items after completion.");
    if (target.numLayers !== 4) throw new Error("Layer-controls fixture expected exactly four target layers after completion.");
    if (stableId(target.layer(1)) !== cameraLayerStable
        || stableId(target.layer(2)) !== solidLayerStable
        || stableId(target.layer(3)) !== audioLayerStable
        || stableId(target.layer(4)) !== precompLayerStable) {
      throw new Error("Layer-controls fixture layer order is not deterministic after completion.");
    }

    appendProofComment(target, READY_PREFIX, prefix);
  } catch (error) {
    if (undoOpen) {
      try { app.endUndoGroup(); } catch (_) {}
      undoOpen = false;
    }
    appendProofComment(target, ERROR_PREFIX, stage + ": " + String(error));
  }
}());
