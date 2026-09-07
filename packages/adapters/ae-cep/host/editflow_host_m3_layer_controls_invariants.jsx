/* EditFlow 2.0 M3 protocol-1.6 host invariants discovered by real-AE evidence.
 * Loaded after the typed layer-controls dispatcher. This wrapper performs only
 * fixed readback/preflight and never mutates After Effects.
 */
(function () {
  "use strict";

  var priorDispatch = $.global.EditFlow2_dispatch;
  if (typeof priorDispatch !== "function") throw new Error("EditFlow layer-controls invariant guard requires protocol 1.6 dispatch.");
  if (!$.global.EditFlow2_JSON || typeof $.global.EditFlow2_JSON.parse !== "function" || typeof $.global.EditFlow2_JSON.stringify !== "function") {
    throw new Error("EditFlow JSON codec is unavailable for layer-controls invariant guard.");
  }

  var PROTOCOL = "1.6.0";
  var BUILD = "0.4.0-dev.6";

  function own(object, key) {
    return object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key);
  }

  function readCurrentLayerControls(request) {
    var readRequest = {
      protocolVersion: PROTOCOL,
      requestId: String(request.requestId) + ":invariant-read",
      transactionId: request.transactionId,
      operationId: String(request.operationId) + ":invariant-read",
      capabilityId: "ae.layer.controls.readback",
      command: "layer.controls.readback",
      expectedHostProjectRevision: null,
      payload: {
        comp: request.payload.comp,
        layer: request.payload.layer
      },
      readbackProfile: "M3_LAYER_CONTROLS_INVARIANT_READBACK"
    };
    var raw = priorDispatch($.global.EditFlow2_JSON.stringify(readRequest));
    var response = $.global.EditFlow2_JSON.parse(raw);
    if (!response || response.outcome !== "NO_OP" || !response.readback || !response.readback.layerControls || !response.readback.layerControls.controls) {
      throw new Error("Layer-controls invariant guard could not obtain exact current switch readback.");
    }
    return response.readback;
  }

  function rejectedResponse(request, readback) {
    return {
      protocolVersion: PROTOCOL,
      requestId: request.requestId,
      transactionId: request.transactionId,
      operationId: request.operationId,
      capabilityId: request.capabilityId,
      command: request.command,
      outcome: "REJECTED",
      error: {
        category: "VALIDATION",
        code: "LAYER_SOLO_REQUIRES_ENABLED",
        message: "After Effects cannot represent a final layer state with solo:true while enabled:false.",
        details: {
          requestedControls: request.payload.controls
        }
      },
      affectedObjects: [],
      readback: readback,
      hostProjectRevision: app.project ? app.project.revision : null,
      diagnostics: {
        adapterProtocolVersion: PROTOCOL,
        adapterBuild: BUILD,
        command: request.command,
        notes: [
          "Protocol 1.6 rejected an unrepresentable enabled/solo final state before mutation.",
          "Invariant is grounded in prior real-After-Effects negative evidence."
        ]
      }
    };
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); }
    catch (_) { return priorDispatch(requestJson); }

    if (!request || request.protocolVersion !== PROTOCOL || request.command !== "layer.controls.set") {
      return priorDispatch(requestJson);
    }
    if (!request.payload || !request.payload.controls || typeof request.payload.controls !== "object") {
      return priorDispatch(requestJson);
    }

    var controls = request.payload.controls;
    if (!own(controls, "enabled") && !own(controls, "solo")) return priorDispatch(requestJson);

    try {
      var readback = readCurrentLayerControls(request);
      var current = readback.layerControls.controls;
      var finalEnabled = own(controls, "enabled") ? controls.enabled : current.enabled;
      var finalSolo = own(controls, "solo") ? controls.solo : current.solo;
      if (finalEnabled === false && finalSolo === true) {
        return $.global.EditFlow2_JSON.stringify(rejectedResponse(request, readback));
      }
    } catch (error) {
      return $.global.EditFlow2_JSON.stringify({
        protocolVersion: PROTOCOL,
        requestId: request.requestId,
        transactionId: request.transactionId,
        operationId: request.operationId,
        capabilityId: request.capabilityId,
        command: request.command,
        outcome: "FAILED",
        error: {
          category: "ADAPTER_FAILURE",
          code: "LAYER_CONTROLS_INVARIANT_READBACK_FAILED",
          message: String(error),
          details: null
        },
        affectedObjects: [],
        readback: null,
        hostProjectRevision: app.project ? app.project.revision : null,
        diagnostics: {
          adapterProtocolVersion: PROTOCOL,
          adapterBuild: BUILD,
          command: request.command,
          notes: ["Layer-controls invariant guard failed closed before mutation."]
        }
      });
    }

    return priorDispatch(requestJson);
  };
}());
