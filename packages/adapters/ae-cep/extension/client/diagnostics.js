(function () {
  "use strict";

  var LOG_NAME = "EditFlow2-cep-panel-diagnostics.log";
  var cep = window.__adobe_cep__;
  var lastSnapshot = null;

  function clean(value) {
    return String(value === undefined || value === null ? "" : value).replace(/[\r\n\t]+/g, " ").slice(0, 2000);
  }

  function append(stage, detail) {
    if (!cep || typeof cep.evalScript !== "function") return;
    var line = (new Date()).toISOString() + "\t" + clean(stage) + "\t" + clean(detail);
    var literal = JSON.stringify(line);
    var script = "(function(){try{" +
      "var marker=new File(Folder.temp.fsName+/" + JSON.stringify("/" + LOG_NAME) + ".slice(1));" +
      "marker.encoding=\"UTF-8\";" +
      "if(!marker.open(\"a\"))return;" +
      "try{marker.writeln(" + literal + ");}finally{marker.close();}" +
      "}catch(_){}}())";
    try { cep.evalScript(script, function () {}); } catch (_) {}
  }

  function text(id) {
    var element = document.getElementById(id);
    return element ? clean(element.textContent) : "<missing>";
  }

  function snapshot(reason) {
    var detail = "status=" + text("status") + ";protocol=" + text("protocol") + ";broker=" + text("broker");
    if (detail === lastSnapshot && reason === "STATUS_MUTATION") return;
    lastSnapshot = detail;
    append(reason, detail);
  }

  append("DIAGNOSTICS_SCRIPT_STARTED", "cepEvalScript=" + Boolean(cep && typeof cep.evalScript === "function"));
  snapshot("INITIAL_PANEL_STATE");

  window.addEventListener("error", function (event) {
    var source = event && event.filename ? clean(event.filename) : "";
    var line = event && event.lineno ? event.lineno : 0;
    append("WINDOW_ERROR", clean(event && event.message) + ";source=" + source + ";line=" + line);
  });

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    append("UNHANDLED_REJECTION", reason && reason.message ? reason.message : reason);
  });

  var status = document.getElementById("status");
  var protocol = document.getElementById("protocol");
  var broker = document.getElementById("broker");
  if (typeof MutationObserver === "function") {
    var observer = new MutationObserver(function () { snapshot("STATUS_MUTATION"); });
    [status, protocol, broker].forEach(function (element) {
      if (element) observer.observe(element, { childList: true, characterData: true, subtree: true, attributes: true });
    });
  } else {
    append("MUTATION_OBSERVER_UNAVAILABLE", "Panel status transitions will not be observed.");
  }

  window.addEventListener("beforeunload", function () { snapshot("PANEL_BEFORE_UNLOAD"); });
}());
