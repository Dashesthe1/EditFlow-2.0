(function () {
  "use strict";
  function findComp(name) {
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item instanceof CompItem && item.name === name) return item;
    }
    return null;
  }
  function render(comp, fileName) {
    var rq = app.project.renderQueue.items.add(comp);
    rq.applyTemplate("Draft Settings");
    rq.timeSpanStart = 0;
    rq.timeSpanDuration = comp.duration;
    var om = rq.outputModule(1);
    om.applyTemplate("H.264 - Match Render Settings -  5 Mbps");
    var out = new File(Folder.temp.fsName + "/" + fileName);
    if (out.exists) out.remove();
    om.file = out;
    app.project.renderQueue.render();
    if (!out.exists || out.length <= 0) throw new Error("M6_DIRECTIONAL_BLUR_RENDER_EMPTY:" + fileName);
    rq.remove();
  }
  var comp = findComp("__EF2_M6_GENERIC_NATIVE_PROOF__");
  if (!comp) throw new Error("M6_DIRECTIONAL_BLUR_PROOF_COMP_MISSING");
  var hero = comp.layer("M6 Generic Hero");
  if (!hero) throw new Error("M6_DIRECTIONAL_BLUR_PROOF_HERO_MISSING");
  var blur = null;
  var blurLayer = null;
  for (var l = 1; l <= comp.numLayers; l++) {
    var candidateLayer = comp.layer(l);
    var parade = candidateLayer.property("ADBE Effect Parade");
    if (!parade) continue;
    for (var e = 1; e <= parade.numProperties; e++) {
      if (parade.property(e).matchName === "ADBE Motion Blur") {
        if (blur) throw new Error("M6_DIRECTIONAL_BLUR_EFFECT_AMBIGUOUS");
        blur = parade.property(e);
        blurLayer = candidateLayer;
      }
    }
  }
  if (!blur || !blurLayer) throw new Error("M6_DIRECTIONAL_BLUR_EFFECT_MISSING");
  var priorEnabled = blur.enabled;
  blur.enabled = false;
  render(comp, "M6_native_directional_blur_baseline.mp4");
  blur.enabled = true;
  render(comp, "M6_native_directional_blur_effected.mp4");
  blur.enabled = priorEnabled;
}());
