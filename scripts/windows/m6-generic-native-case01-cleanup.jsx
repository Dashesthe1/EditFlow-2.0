(function () {
  "use strict";
  var p=app.project,name="__EF2_M6_GENERIC_NATIVE_CASE01_PROOF__",sourceName="__EF2_M6_GENERIC_NATIVE_CASE01_SOURCE__";
  for(var i=p.numItems;i>=1;i--){var x=p.item(i);if(x instanceof CompItem&&(x.name===name||x.name===sourceName||x.name.indexOf("echo-history-precompose")>=0))x.remove();}
  for(var j=p.numItems;j>=1;j--){var y=p.item(j);if(y instanceof FootageItem&&(y.name==="M6 Echo Background"||y.name==="M6 Echo Subject"))y.remove();}
}());
