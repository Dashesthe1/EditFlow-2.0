(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_PROOF__",sourceName="__EF2_M6_GENERIC_NATIVE_SOURCE__";
  for(var i=p.numItems;i>=1;i--){var x=p.item(i);if(x instanceof CompItem&&(x.name===name||x.name===sourceName))x.remove();}
}());
