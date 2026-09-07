/* EditFlow 2.0 M3 layer-controls P1/P2 proof-only fixture builder.
 * Fixed script, executed only on the isolated self-hosted runner. It adds no
 * public protocol command and is not loaded by the production dispatcher.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF";
  var PREFIX_ENV = "EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX";
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";

  if ($.getenv(PROOF_ENV) !== "1") throw new Error("M3 layer-controls P1/P2 fixture script is proof-gated.");
  var prefix = $.getenv(PREFIX_ENV);
  if (!prefix || prefix.indexOf("M3_LAYER_CONTROLS_P12_") !== 0) throw new Error("M3 layer-controls proof prefix is missing or invalid.");
  if (!app.project) throw new Error("M3 layer-controls fixture requires an open After Effects project.");
  if (app.project.file) throw new Error("M3 layer-controls fixture refuses to modify a saved project.");
  if (app.project.numItems !== 0) throw new Error("M3 layer-controls fixture requires the isolated blank project baseline.");
  if (!$.global.EditFlow2_JSON || typeof $.global.EditFlow2_JSON.stringify !== "function") throw new Error("EditFlow JSON codec is unavailable for fixture evidence.");

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
  function writeJson(file, value) {
    file.encoding = "UTF-8";
    if (!file.open("w")) throw new Error("Could not open fixture marker for writing: " + file.fsName);
    try { file.write($.global.EditFlow2_JSON.stringify(value)); }
    finally { file.close(); }
  }

  var currentFile = new File($.fileName);
  var repoRoot = currentFile.parent.parent.parent.parent;
  var artifactDir = new Folder(repoRoot.fsName + "/proofs/artifacts/m3-layer-controls-p1-p2");
  if (!artifactDir.exists && !artifactDir.create()) throw new Error("Could not create layer-controls proof artifact directory.");
  var audioFile = new File(artifactDir.fsName + "/p12-audio.wav");
  var markerFile = new File(artifactDir.fsName + "/fixture-result.json");
  if (!audioFile.exists || audioFile.length <= 44) throw new Error("Generated proof WAV is missing or empty: " + audioFile.fsName);

  var sourceStable = prefix + "_SOURCE_COMP";
  var targetStable = prefix + "_TARGET_COMP";
  var precompLayerStable = prefix + "_PRECOMP_LAYER";
  var audioMediaStable = prefix + "_AUDIO_MEDIA";
  var audioLayerStable = prefix + "_AUDIO_LAYER";
  var solidMediaStable = prefix + "_SOLID_MEDIA";
  var solidLayerStable = prefix + "_SOLID_LAYER";
  var cameraLayerStable = prefix + "_CAMERA_LAYER";

  app.beginUndoGroup("EditFlow M3 layer-controls P1/P2 fixture");
  try {
    var source = app.project.items.addComp(prefix + " Source", 320, 180, 1, 2, 24);
    setStableId(source, sourceStable);

    var target = app.project.items.addComp(prefix + " Target", 640, 360, 1, 2, 24);
    setStableId(target, targetStable);

    var precompLayer = target.layers.add(source);
    precompLayer.name = prefix + " Precomp";
    setStableId(precompLayer, precompLayerStable);

    var importOptions = new ImportOptions(audioFile);
    var audioItem = app.project.importFile(importOptions);
    setStableId(audioItem, audioMediaStable);
    var audioLayer = target.layers.add(audioItem);
    audioLayer.name = prefix + " Audio";
    setStableId(audioLayer, audioLayerStable);

    var solidLayer = target.layers.addSolid([0.15, 0.35, 0.75], prefix + " Solid", 160, 90, 1, 2);
    setStableId(solidLayer, solidLayerStable);
    if (!solidLayer.source) throw new Error("Fixture solid layer has no source FootageItem.");
    setStableId(solidLayer.source, solidMediaStable);

    var cameraLayer = target.layers.addCamera(prefix + " Camera", [target.width / 2, target.height / 2]);
    setStableId(cameraLayer, cameraLayerStable);

    app.endUndoGroup();

    if (app.project.numItems !== 4) throw new Error("Layer-controls fixture expected exactly four project items.");
    if (target.numLayers !== 4) throw new Error("Layer-controls fixture expected exactly four target layers.");
    if (stableId(target.layer(1)) !== cameraLayerStable
        || stableId(target.layer(2)) !== solidLayerStable
        || stableId(target.layer(3)) !== audioLayerStable
        || stableId(target.layer(4)) !== precompLayerStable) {
      throw new Error("Layer-controls fixture layer order is not deterministic.");
    }

    writeJson(markerFile, {
      proofId: "M3_LAYER_CONTROLS_P1_P2_FIXTURE",
      ok: true,
      prefix: prefix,
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
    try { app.endUndoGroup(); } catch (_) {}
    throw error;
  }
}());
