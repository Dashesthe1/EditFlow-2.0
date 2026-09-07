/* EditFlow 2.0 current AE host loader: accepted M2 protocol 1.1 baseline + M3 protocol 1.2 masks + protocol 1.3 composite foundation. */
(function () {
  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var jsonRuntime = new File(hostDir.fsName + "/editflow_json.jsx");
  var base = new File(hostDir.fsName + "/editflow_host.jsx");
  var hardening = new File(hostDir.fsName + "/editflow_host_hardening.jsx");
  var transformReadback = new File(hostDir.fsName + "/editflow_host_transform_readback.jsx");
  var keyframeCrud = new File(hostDir.fsName + "/editflow_host_keyframe_crud.jsx");
  var atomicity = new File(hostDir.fsName + "/editflow_host_atomicity.jsx");
  var renderJobs = new File(hostDir.fsName + "/editflow_host_render_jobs.jsx");
  var renderAsync = new File(hostDir.fsName + "/editflow_host_render_async.jsx");
  var renderOutputPath = new File(hostDir.fsName + "/editflow_host_render_output_path.jsx");
  var m3Masks = new File(hostDir.fsName + "/editflow_host_m3_masks.jsx");
  var m3Composite = new File(hostDir.fsName + "/editflow_host_m3_composite.jsx");
  var m3ProofCleanup = new File(hostDir.fsName + "/editflow_host_m3_proof_cleanup.jsx");
  var m3CompositeProofCleanup = new File(hostDir.fsName + "/editflow_host_m3_composite_proof_cleanup.jsx");
  var m3ProofMode = $.getenv("EDITFLOW_M3_MASK_P4_PROOF") === "1";
  var m3CompositeProofMode = $.getenv("EDITFLOW_M3_COMPOSITE_P4_PROOF") === "1";
  if (m3ProofMode && m3CompositeProofMode) throw new Error("EditFlow M3 proof cleanup modes are mutually exclusive.");
  if (!jsonRuntime.exists) throw new Error("EditFlow JSON runtime is missing: " + jsonRuntime.fsName);
  if (!base.exists) throw new Error("EditFlow base AE host script is missing: " + base.fsName);
  if (!hardening.exists) throw new Error("EditFlow AE host hardening script is missing: " + hardening.fsName);
  if (!transformReadback.exists) throw new Error("EditFlow AE transform readback hardening script is missing: " + transformReadback.fsName);
  if (!keyframeCrud.exists) throw new Error("EditFlow AE keyframe CRUD script is missing: " + keyframeCrud.fsName);
  if (!atomicity.exists) throw new Error("EditFlow AE host atomicity script is missing: " + atomicity.fsName);
  if (!renderJobs.exists) throw new Error("EditFlow AE render-job script is missing: " + renderJobs.fsName);
  if (!renderAsync.exists) throw new Error("EditFlow AE async-render script is missing: " + renderAsync.fsName);
  if (!renderOutputPath.exists) throw new Error("EditFlow AE render output-path script is missing: " + renderOutputPath.fsName);
  if (!m3Masks.exists) throw new Error("EditFlow M3 mask/Bezier host script is missing: " + m3Masks.fsName);
  if (m3ProofMode && !m3ProofCleanup.exists) throw new Error("EditFlow M3 proof cleanup script is missing: " + m3ProofCleanup.fsName);
  if (m3CompositeProofMode && !m3CompositeProofCleanup.exists) throw new Error("EditFlow M3 composite proof cleanup script is missing: " + m3CompositeProofCleanup.fsName);

  $.evalFile(jsonRuntime);
  if (!$.global.EditFlow2_JSON || typeof $.global.EditFlow2_JSON.parse !== "function" || typeof $.global.EditFlow2_JSON.stringify !== "function") {
    throw new Error("EditFlow JSON runtime failed to register.");
  }

  /* After Effects ExtendScript does not guarantee a native JSON object. Install our
   * standards-shaped codec only when JSON is absent so checked-in proof scripts and
   * other EditFlow host code do not depend on another Adobe panel having polyfilled it.
   * Never overwrite a JSON implementation that already exists in the shared host.
   */
  if (typeof $.global.JSON === "undefined") $.global.JSON = $.global.EditFlow2_JSON;

  $.evalFile(base);
  $.evalFile(hardening);
  $.evalFile(transformReadback);
  $.evalFile(keyframeCrud);
  $.evalFile(atomicity);
  $.evalFile(renderJobs);
  $.evalFile(renderAsync);
  $.evalFile(renderOutputPath);
  $.evalFile(m3Masks);

  /* Protocol 1.3 is an additive M3 tranche. A load defect in the new optional module
   * must not take the already accepted 1.1/1.2 dispatcher offline. Preserve that
   * dispatcher and install a typed 1.3-only diagnostic fallback so the CEP transport
   * can remain authenticated and report the exact module-load failure to proof/runtime
   * callers instead of degrading into an opaque panel-registration timeout.
   */
  var compositeLoadError = null;
  if (!m3Composite.exists) {
    compositeLoadError = "EditFlow M3 composite host script is missing: " + m3Composite.fsName;
  } else {
    try {
      $.evalFile(m3Composite);
    } catch (compositeError) {
      compositeLoadError = String(compositeError);
    }
  }

  if (compositeLoadError !== null) {
    var dispatchBeforeCompositeFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M3_COMPOSITE_LOAD_ERROR = compositeLoadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "1.3.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "1.3.0",
          requestId: request.requestId,
          transactionId: request.transactionId,
          operationId: request.operationId,
          capabilityId: request.capabilityId,
          command: request.command,
          outcome: "FAILED",
          error: {
            category: "ADAPTER_FAILURE",
            code: "M3_COMPOSITE_MODULE_LOAD_FAILED",
            message: compositeLoadError,
            details: null
          },
          affectedObjects: [],
          readback: null,
          hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: {
            adapterProtocolVersion: "1.3.0",
            adapterBuild: "0.4.0-dev.3",
            command: request.command,
            notes: ["Protocol 1.3 composite host module failed to load; accepted earlier protocol dispatch remains available."]
          }
        });
      }
      return dispatchBeforeCompositeFailure(requestJson);
    };
  }

  if (m3ProofMode) $.evalFile(m3ProofCleanup);
  if (m3CompositeProofMode) $.evalFile(m3CompositeProofCleanup);
  if (typeof $.global.EditFlow2_dispatch !== "function") {
    throw new Error("EditFlow current AE dispatcher failed to register.");
  }

  /* The host layers use JSON.parse/stringify internally. Other Adobe panels can
   * replace/remove the shared JSON object after EditFlow loads, so bind our codec for the
   * duration of every EditFlow dispatch and restore the prior global afterward.
   */
  var dispatchWithAmbientJson = $.global.EditFlow2_dispatch;
  $.global.EditFlow2_dispatch = function (requestJson) {
    var hadJson = typeof $.global.JSON !== "undefined";
    var previousJson = hadJson ? $.global.JSON : null;
    $.global.JSON = $.global.EditFlow2_JSON;
    try {
      return dispatchWithAmbientJson(requestJson);
    } finally {
      if (hadJson) $.global.JSON = previousJson;
      else {
        try { delete $.global.JSON; } catch (_) { $.global.JSON = undefined; }
      }
    }
  };
}());
