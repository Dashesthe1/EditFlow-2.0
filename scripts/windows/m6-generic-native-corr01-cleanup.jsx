(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_CORR01_PROOF__",sourceName="__EF2_M6_GENERIC_NATIVE_CORR01_SOURCE__";
  function hasProofIdentity(value) {
    return String(value || "").indexOf("m6-proof-corr01-") >= 0;
  }
  function isOwnedComp(comp) {
    if (!(comp instanceof CompItem)) return false;
    if (comp.name === name || comp.name === sourceName) return true;
    if (hasProofIdentity(comp.comment)) return true;
    for (var li=1;li<=comp.numLayers;li++) {
      if (hasProofIdentity(comp.layer(li).comment)) return true;
    }
    return false;
  }
  function isLegacyOwnedSolid(item) {
    try {
      if (!(item instanceof FootageItem) || !(item.mainSource instanceof SolidSource)) return false;
      if (item.name === "M6 Echo Background") return item.width === 640 && item.height === 360;
      if (item.name === "M6 Echo Subject") return item.width === 64 && item.height === 64;
    } catch (_) {}
    return false;
  }
  for(var i=p.numItems;i>=1;i--){var x=p.item(i);if(isOwnedComp(x))x.remove();}
  for(var j=p.numItems;j>=1;j--){var y=p.item(j);if(!(y instanceof CompItem)&&(hasProofIdentity(y.comment)||isLegacyOwnedSolid(y)))y.remove();}
}());
