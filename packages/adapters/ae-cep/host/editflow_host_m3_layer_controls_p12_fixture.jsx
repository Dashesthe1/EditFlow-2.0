/* EditFlow 2.0 M3 layer-controls P1/P2 proof-only fixture builder.
 * Fixed script, executed only on the isolated self-hosted runner. It adds no
 * public protocol command and is not loaded by the production dispatcher.
 *
 * The -r route must never rethrow a fixture error into After Effects because AE
 * presents script failures modally and can deadlock the unattended proof. This
 * script records either success or the exact failing stage into the proof marker
 * and returns normally.
 *
 * Direct -r scripts can execute in a different ExtendScript engine from the CEP
 * panel. Proof-marker serialization is therefore self-contained and must not
 * depend on any panel-populated JSON global.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF";
  var PREFIX_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var stage = "preflight";
  var undoOpen = false;

  function cleanDiagnostic(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/[\r\n\t]+/g, " ")
      .substring(0, 1600);
  }
  function setStableId(target, stableId) {
    if (!target || target.comment === undefined) throw new Error("Fixture target cannot carry stable identity: " + stableId);
    target.comment = STABLE_PREFIX + stableId + STABLE_SUFFIX;
  }
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
  function jsonQuote(value) {
    return '"' + String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t") + '"';
  }
  function markerStringify(value) {
    if (value === null || value === undefined) return "null";
    var kind = typeof value;
    if (kind === "string") return jsonQuote(value);
    if (kind === "boolean") return value ? "true" : "false";
    if (kind === "number") return isFinite(value) ? String(value) : "null";
    if (value instanceof Array) {
      var arrayParts = [];
      for (var i = 0; i < value.length; i += 1) arrayParts.push(markerStringify(value[i]));
      return "[" + arrayParts.join(",") + "]";
    }
    if (kind === "object") {
      var objectParts = [];
      for (var key in value) {
        if (value.hasOwnProperty(key)) objectParts.push(jsonQuote(key) + ":" + markerStringify(value[key]));
      }
      return "{" + objectParts.join(",") + "}";
    }
    return "null";
  }
  function writeJson(file, value) {
    try {
      file.encoding = "UTF-8";
      if (!file.open("w")) return false;
      try { file.write(markerStringify(value)); }
      finally { file.close(); }
      return true;
    } catch (_) {
      try { file.close(); } catch (__) {}
      return false;
    }
  }

  if ($.getenv(PROOF_ENV) !== "1") return;
  var prefix = $.getenv(PREFIX_ENV);
  if (!prefix || prefix.indexOf("M3_LAYER_CONTROLS_P12_") !== 0) return;
  if (!app.project || app.project.file) return;

  var currentFile = new File($.fileName);
  /* host -> ae-cep -> adapters -> packages -> repository root */
  var repoRoot = currentFile.parent.parent.parent.parent.parent;
  var artifactDir = new Folder(repoRoot.fsName + "/proofs/artifacts/m3-layer-controls-p1-p2");
  try { if (!artifactDir.exists) artifactDir.create(); } catch (_) {}
  var audioFile = new File(artifactDir.fsName + "/p12-audio.wav");
  var markerFile = new File(artifactDir.fsName + "/fixture-result.json");

  var sourceStable = prefix + "_SOURCE_COMP";
  var targetStable = prefix + "_TARGET_COMP";
  var precompLayerStable = prefix + "_PRECOMP_LAYER";
  var audioMediaStable = prefix + "_AUDIO_MEDIA";
  var audioLayerStable = prefix + "_AUDIO_LAYER";
  var solidMediaStable = prefix + "_SOLID_MEDIA";
  var solidLayerStable = prefix + "_SOLID_LAYER";
  var cameraLayerStable = prefix + "_CAMERA_LAYER";
  var target = null;

  try {
    stage = "validate_blank_baseline";
    if (app.project.numItems !== 0) throw new Error("M3 layer-controls fixture requires the isolated blank project baseline.");
    if (!audioFile.exists || audioFile.length <= 44) throw new Error("Generated proof WAV is missing or empty: " + audioFile.fsName);

    app.beginUndoGroup("EditFlow M3 layer-controls P1/P2 fixture");
    undoOpen = true;

    stage = "create_source_comp";
    var source = app.project.items.addComp(prefix + " Source", 320, 180, 1, 2, 24);
    setStableId(source, sourceStable);

    stage = "create_target_comp";
    target = app.project.items.addComp(prefix + " Target", 640, 360, 1, 2, 24);
    setStableId(target, targetStable);

    stage = "add_precomp_layer";
    var precompLayer = target.layers.add(source);
    precompLayer.name = prefix + " Precomp";
    setStableId(precompLayer, precompLayerStable);

    stage = "import_audio";
    var importOptions = new ImportOptions(audioFile);
    var audioItem = app.project.importFile(importOptions);
    setStableId(audioItem, audioMediaStable);

    stage = "add_audio_layer";
    var audioLayer = target.layers.add(audioItem);
    audioLayer.name = prefix + " Audio";
    setStableId(audioLayer, audioLayerStable);

    stage = "add_solid_layer";
    var solidLayer = target.layers.addSolid([0.15, 0.35, 0.75], prefix + " Solid", 160, 90, 1, 2);
    setStableId(solidLayer, solidLayerStable);
    if (!solidLayer.source) throw new Error("Fixture solid layer has no source FootageItem.");
    setStableId(solidLayer.source, solidMediaStable);

    stage = "add_camera_layer";
    var cameraLayer = target.layers.addCamera(prefix + " Camera", [target.width / 2, target.height / 2]);
    setStableId(cameraLayer, cameraLayerStable);

    app.endUndoGroup();
    undoOpen = false;

    stage = "verify_shape";
    if (app.project.numItems !== 4) throw new Error("Layer-controls fixture expected exactly four project items.");
    if (target.numLayers !== 4) throw new Error("Layer-controls fixture expected exactly four target layers.");
    if (stableId(target.layer(1)) !== cameraLayerStable
        || stableId(target.layer(2)) !== solidLayerStable
        || stableId(target.layer(3)) !== audioLayerStable
        || stableId(target.layer(4)) !== precompLayerStable) {
      throw new Error("Layer-controls fixture layer order is not deterministic.");
    }

    stage = "write_success_marker";
    writeJson(markerFile, {
      proofId: "M3_LAYER_CONTROLS_P1_P2_FIXTURE",
      ok: true,
      prefix: prefix,
      stage: "complete",
      hostProjectRevision: app.project.revision,
      itemCount: app.project.numItems,
      targetLayerCount: target.numLayers,
      stableIds: {
        sourceComp: sourceStable,
        targetComp: targetStable,
        precompLayer: precompLayerStable,
        audioMedia: audioMediaStable,
        audioLayer: audioLayerStable,
        solidMedia: solidMediaStable,
        solidLayer: solidLayerStable,
        cameraLayer: cameraLayerStable
      },
      layerIndices: {
        camera: cameraLayer.index,
        solid: solidLayer.index,
        audio: audioLayer.index,
        precomp: precompLayer.index
      }
    });
  } catch (error) {
    if (undoOpen) {
      try { app.endUndoGroup(); } catch (_) {}
      undoOpen = false;
    }
    writeJson(markerFile, {
      proofId: "M3_LAYER_CONTROLS_P1_P2_FIXTURE",
      ok: false,
      prefix: prefix,
      stage: stage,
      error: cleanDiagnostic(error),
      hostProjectRevision: app.project ? app.project.revision : null,
      itemCount: app.project ? app.project.numItems : null,
      targetLayerCount: target ? target.numLayers : null
    });
    return;
  }
}());
