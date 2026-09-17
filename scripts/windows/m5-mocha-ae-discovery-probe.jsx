(function () {
  "use strict";
  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/\r/g, " ").replace(/\n/g, " ").replace(/\t/g, " ");
  }
  var p = app.project;
  var revBefore = p ? p.revision : null;
  var itemCountBefore = p ? p.numItems : 0;
  var effects = [];
  var all = app.effects || [];
  for (var i = 0; i < all.length; i++) {
    var e = all[i];
    var displayName = String(e.displayName || "");
    var matchName = String(e.matchName || "");
    var category = String(e.category || "");
    if (/mocha/i.test(displayName) || /mocha/i.test(matchName) || /mocha/i.test(category)) effects.push(e);
  }
  var exact = null;
  for (var j = 0; j < effects.length; j++) {
    if (/^mocha ae$/i.test(String(effects[j].displayName || ""))) { exact = effects[j]; break; }
  }
  if (!exact && effects.length) exact = effects[0];
  var activeItem = p ? p.activeItem : null;
  var targetLayer = (activeItem && activeItem.layers && activeItem.numLayers > 0) ? activeItem.layer(1) : null;
  var canAdd = "";
  if (targetLayer && exact) {
    var parade = targetLayer.property("ADBE Effect Parade");
    if (parade && typeof parade.canAddProperty === "function") canAdd = String(parade.canAddProperty(exact.matchName || exact.displayName));
  }
  var out = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-discovery.txt");
  if (!out.open("w")) throw new Error("EDITFLOW_M5_MOCHA_DISCOVERY_OPEN_FAILED");
  out.writeln("HOST_VERSION\t" + esc(app.version));
  out.writeln("PROJECT_PATH\t" + esc((p && p.file) ? p.file.fsName : ""));
  out.writeln("REVISION_BEFORE\t" + esc(revBefore));
  out.writeln("REVISION_AFTER\t" + esc(p ? p.revision : null));
  out.writeln("ITEMS_BEFORE\t" + esc(itemCountBefore));
  out.writeln("ITEMS_AFTER\t" + esc(p ? p.numItems : 0));
  out.writeln("ACTIVE_ITEM\t" + esc(activeItem ? activeItem.name : ""));
  out.writeln("TARGET_LAYER\t" + esc(targetLayer ? targetLayer.name : ""));
  out.writeln("CAN_ADD\t" + esc(canAdd));
  out.writeln("EXACT\t" + esc(exact ? exact.displayName : "") + "\t" + esc(exact ? exact.matchName : "") + "\t" + esc(exact ? exact.category : "") + "\t" + esc(exact ? exact.version : ""));
  for (var k = 0; k < effects.length; k++) {
    out.writeln("EFFECT\t" + esc(effects[k].displayName) + "\t" + esc(effects[k].matchName) + "\t" + esc(effects[k].category) + "\t" + esc(effects[k].version));
  }
  out.close();
}());
