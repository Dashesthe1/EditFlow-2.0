/* EditFlow 2.0 M3 marker/motion structural atomicity and P4 proof layer.
 *
 * This additive wrapper sits above the already-proven protocol 2.0 marker/motion
 * dispatcher. It independently captures exact pre-mutation state, verifies the
 * post-mutation structural state, and restores the prior state if verification
 * fails. A proof-only failure can be injected after a verified real write when
 * both the fixed readback profile and process environment flag are present.
 */
(function () {
  "use strict";

  var previousDispatch = $.global.EditFlow2_dispatch;
  if (typeof previousDispatch !== "function") throw new Error("EditFlow marker-motion atomicity requires the protocol 2.0 dispatcher.");

  var PROTOCOL = "2.0.0";
  var BUILD = "0.4.0-dev.10.2-atomicity";
  var P4_PROFILE = "M3_MARKER_MOTION_P4_FAILURE_INJECTION";
  var P4_ENV = "EDITFLOW_M3_MARKER_MOTION_P4_PROOF";
  var INTERNAL_PROFILE = "M3_MARKER_MOTION_ATOMICITY_INTERNAL";
  var MUTATIONS = {
    "marker.set": true,
    "marker.remove": true,
    "comp.motion.set": true,
    "layer.motion.set": true
  };
  var CAPABILITIES = {
    "marker.set": "ae.marker.set",
    "marker.remove": "ae.marker.remove",
    "marker.readback": "ae.marker.readback",
    "comp.motion.set": "ae.comp.motion.set",
    "comp.motion.readback": "ae.comp.motion.readback",
    "layer.motion.set": "ae.layer.motion.set",
    "layer.motion.readback": "ae.layer.motion.readback"
  };

  function own(object, key) { return object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key); }
  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function isObject(value) { return value !== null && typeof value === "object" && !(value instanceof Array); }
  function clone(value) { return $.global.EditFlow2_JSON.parse($.global.EditFlow2_JSON.stringify(value)); }
  function currentRevision() { return app.project ? app.project.revision : null; }

  function dispatchObject(request) {
    var raw = previousDispatch($.global.EditFlow2_JSON.stringify(request));
    return $.global.EditFlow2_JSON.parse(raw);
  }

  function internalRequest(original, command, payload, suffix) {
    return {
      protocolVersion: PROTOCOL,
      requestId: asString(original.requestId) + "_atomic_" + suffix,
      transactionId: original.transactionId,
      operationId: asString(original.operationId) + "_atomic_" + suffix,
      capabilityId: CAPABILITIES[command],
      command: command,
      expectedHostProjectRevision: command.indexOf(".readback") >= 0 ? null : currentRevision(),
      payload: payload,
      readbackProfile: INTERNAL_PROFILE
    };
  }

  function readCommandAndPayload(request) {
    var payload = request.payload || {};
    if (request.command === "marker.set" || request.command === "marker.remove") {
      return { command: "marker.readback", payload: { target: payload.target } };
    }
    if (request.command === "comp.motion.set") {
      return { command: "comp.motion.readback", payload: { comp: payload.comp } };
    }
    if (request.command === "layer.motion.set") {
      return { command: "layer.motion.readback", payload: { comp: payload.comp, layer: payload.layer } };
    }
    throw new Error("Unsupported marker-motion mutation for atomicity wrapper: " + request.command);
  }

  function readState(request, suffix) {
    var read = readCommandAndPayload(request);
    var response = dispatchObject(internalRequest(request, read.command, read.payload, suffix));
    if (response.outcome !== "NO_OP" || response.error) throw new Error("Atomicity structural readback failed for " + request.command + ": " + (response.error ? response.error.code : response.outcome));
    return { response: response, state: normalizedState(request.command, response.readback) };
  }

  function normalizeParameters(value) {
    var source = isObject(value) ? value : {};
    var result = {}, key;
    for (key in source) if (own(source, key)) result[key] = asString(source[key]);
    return result;
  }

  function normalizeMarker(value) {
    var marker = isObject(value) ? value : {};
    return {
      comment: asString(marker.comment),
      chapter: asString(marker.chapter),
      url: asString(marker.url),
      frameTarget: asString(marker.frameTarget),
      cuePointName: asString(marker.cuePointName),
      duration: typeof marker.duration === "number" ? marker.duration : 0,
      eventCuePoint: marker.eventCuePoint === true,
      label: typeof marker.label === "number" ? marker.label : 0,
      protectedRegion: marker.protectedRegion === true,
      parameters: normalizeParameters(marker.parameters)
    };
  }

  function sameParameters(left, right) {
    var key;
    for (key in left) if (own(left, key) && left[key] !== right[key]) return false;
    for (key in right) if (own(right, key) && left[key] !== right[key]) return false;
    return true;
  }

  function sameMarker(left, right) {
    return left.comment === right.comment
      && left.chapter === right.chapter
      && left.url === right.url
      && left.frameTarget === right.frameTarget
      && left.cuePointName === right.cuePointName
      && left.duration === right.duration
      && left.eventCuePoint === right.eventCuePoint
      && left.label === right.label
      && left.protectedRegion === right.protectedRegion
      && sameParameters(left.parameters, right.parameters);
  }

  function markerSnapshot(readback) {
    var root = isObject(readback) ? readback : {};
    var raw = root.markers instanceof Array ? root.markers : [];
    var result = [], i, entry;
    for (i = 0; i < raw.length; i += 1) {
      entry = isObject(raw[i]) ? raw[i] : {};
      result.push({
        time: typeof entry.time === "number" ? entry.time : 0,
        marker: normalizeMarker(entry.marker)
      });
    }
    return result;
  }

  function compMotionState(readback) {
    var root = isObject(readback) ? readback : {};
    var compMotion = isObject(root.compMotion) ? root.compMotion : {};
    var state = isObject(compMotion.state) ? compMotion.state : {};
    return {
      motionBlur: state.motionBlur === true,
      frameBlending: state.frameBlending === true,
      shutterAngle: state.shutterAngle,
      shutterPhase: state.shutterPhase,
      samplesPerFrame: state.samplesPerFrame,
      adaptiveSampleLimit: state.adaptiveSampleLimit
    };
  }

  function layerMotionState(readback) {
    var root = isObject(readback) ? readback : {};
    var layerMotion = isObject(root.layerMotion) ? root.layerMotion : {};
    var state = isObject(layerMotion.state) ? layerMotion.state : {};
    return {
      motionBlur: state.motionBlur === true,
      frameBlendingType: asString(state.frameBlendingType)
    };
  }

  function normalizedState(command, readback) {
    if (command === "marker.set" || command === "marker.remove") return markerSnapshot(readback);
    if (command === "comp.motion.set") return compMotionState(readback);
    if (command === "layer.motion.set") return layerMotionState(readback);
    throw new Error("No atomicity state normalizer for " + command);
  }

  function sameCompMotion(left, right) {
    return left.motionBlur === right.motionBlur
      && left.frameBlending === right.frameBlending
      && left.shutterAngle === right.shutterAngle
      && left.shutterPhase === right.shutterPhase
      && left.samplesPerFrame === right.samplesPerFrame
      && left.adaptiveSampleLimit === right.adaptiveSampleLimit;
  }

  function sameLayerMotion(left, right) {
    return left.motionBlur === right.motionBlur && left.frameBlendingType === right.frameBlendingType;
  }

  function sameMarkerSnapshot(left, right) {
    var i;
    if (left.length !== right.length) return false;
    for (i = 0; i < left.length; i += 1) {
      if (Math.abs(left[i].time - right[i].time) >= 0.000001) return false;
      if (!sameMarker(left[i].marker, right[i].marker)) return false;
    }
    return true;
  }

  function statesEqual(command, left, right) {
    if (command === "marker.set" || command === "marker.remove") return sameMarkerSnapshot(left, right);
    if (command === "comp.motion.set") return sameCompMotion(left, right);
    if (command === "layer.motion.set") return sameLayerMotion(left, right);
    return false;
  }

  function expectedMarkerState(request, before) {
    var expected = clone(before);
    var payload = request.payload || {}, i, found = -1;
    if (request.command === "marker.remove") {
      if (typeof payload.keyIndex !== "number" || payload.keyIndex < 1 || payload.keyIndex > expected.length) return expected;
      expected.splice(payload.keyIndex - 1, 1);
      return expected;
    }
    for (i = 0; i < expected.length; i += 1) {
      if (Math.abs(expected[i].time - payload.time) < 0.000001) { found = i; break; }
    }
    var replacement = { time: payload.time, marker: normalizeMarker(payload.marker) };
    if (found >= 0) expected[found] = replacement;
    else expected.push(replacement);
    expected.sort(function (a, b) { return a.time - b.time; });
    return expected;
  }

  function expectedState(request, before) {
    var payload = request.payload || {};
    if (request.command === "marker.set" || request.command === "marker.remove") return expectedMarkerState(request, before);
    if (request.command === "comp.motion.set") return {
      motionBlur: payload.state.motionBlur === true,
      frameBlending: payload.state.frameBlending === true,
      shutterAngle: payload.state.shutterAngle,
      shutterPhase: payload.state.shutterPhase,
      samplesPerFrame: payload.state.samplesPerFrame,
      adaptiveSampleLimit: payload.state.adaptiveSampleLimit
    };
    if (request.command === "layer.motion.set") return {
      motionBlur: payload.state.motionBlur === true,
      frameBlendingType: asString(payload.state.frameBlendingType)
    };
    return clone(before);
  }

  function ensureApplied(response, label) {
    if (!response || (response.outcome !== "APPLIED" && response.outcome !== "NO_OP")) {
      throw new Error(label + " failed: " + (response && response.error ? response.error.code : response ? response.outcome : "NO_RESPONSE"));
    }
  }

  function restoreMarkers(request, before) {
    var payload = request.payload || {};
    var target = payload.target;
    var read = dispatchObject(internalRequest(request, "marker.readback", { target: target }, "restore_read_current"));
    ensureApplied(read, "marker rollback readback");
    var current = markerSnapshot(read.readback), i, removal, insertion;
    for (i = current.length; i >= 1; i -= 1) {
      removal = dispatchObject(internalRequest(request, "marker.remove", { target: target, keyIndex: i }, "restore_remove_" + i));
      ensureApplied(removal, "marker rollback remove");
    }
    for (i = 0; i < before.length; i += 1) {
      insertion = dispatchObject(internalRequest(request, "marker.set", { target: target, time: before[i].time, marker: before[i].marker }, "restore_set_" + (i + 1)));
      ensureApplied(insertion, "marker rollback set");
    }
  }

  function restoreState(request, before) {
    var payload = request.payload || {}, response;
    if (request.command === "marker.set" || request.command === "marker.remove") {
      restoreMarkers(request, before);
      return;
    }
    if (request.command === "comp.motion.set") {
      response = dispatchObject(internalRequest(request, "comp.motion.set", { comp: payload.comp, state: before }, "restore_comp"));
      ensureApplied(response, "composition motion rollback");
      return;
    }
    if (request.command === "layer.motion.set") {
      response = dispatchObject(internalRequest(request, "layer.motion.set", { comp: payload.comp, layer: payload.layer, state: before }, "restore_layer"));
      ensureApplied(response, "layer motion rollback");
      return;
    }
    throw new Error("Unsupported rollback command: " + request.command);
  }

  function failureResponse(request, errorCategory, errorCode, errorMessage, readback, notes, details) {
    return $.global.EditFlow2_JSON.stringify({
      protocolVersion: PROTOCOL,
      requestId: request.requestId,
      transactionId: request.transactionId,
      operationId: request.operationId,
      capabilityId: request.capabilityId,
      command: request.command,
      outcome: "FAILED",
      error: { category: errorCategory, code: errorCode, message: errorMessage, details: details === undefined ? null : details },
      affectedObjects: [],
      readback: readback,
      hostProjectRevision: currentRevision(),
      diagnostics: { adapterProtocolVersion: PROTOCOL, adapterBuild: BUILD, command: request.command, notes: notes }
    });
  }

  function proofInjectionRequested(request) {
    return request.readbackProfile === P4_PROFILE && $.getenv(P4_ENV) === "1";
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) { return previousDispatch(requestJson); }
    if (!request || request.protocolVersion !== PROTOCOL || !MUTATIONS[request.command] || request.readbackProfile === INTERNAL_PROFILE) {
      return previousDispatch(requestJson);
    }

    var beforeRead, before, originalRaw, original, afterRead, after, expected, rollbackRead;
    try {
      beforeRead = readState(request, "before");
      before = beforeRead.state;
      originalRaw = previousDispatch(requestJson);
      original = $.global.EditFlow2_JSON.parse(originalRaw);
      if (!original || original.outcome === "REJECTED" || original.outcome === "FAILED") return originalRaw;

      afterRead = readState(request, "after");
      after = afterRead.state;
      expected = expectedState(request, before);
      if (!statesEqual(request.command, after, expected)) {
        try {
          restoreState(request, before);
          rollbackRead = readState(request, "readback_mismatch_rollback");
          if (!statesEqual(request.command, rollbackRead.state, before)) {
            return failureResponse(request, "ROLLBACK_FAILURE", "M3_MARKER_MOTION_ROLLBACK_READBACK_MISMATCH", "Marker/motion rollback completed but exact prior structural state was not restored.", rollbackRead.response.readback, ["Post-write structural verification failed and rollback readback also mismatched the exact prior state."], { expectedPrior: before, actual: rollbackRead.state });
          }
        } catch (rollbackError) {
          return failureResponse(request, "ROLLBACK_FAILURE", "M3_MARKER_MOTION_ROLLBACK_FAILED", "Marker/motion post-write verification failed and rollback also failed.", null, ["Post-write structural verification failed and rollback raised an additional host error."], { rollbackError: asString(rollbackError) });
        }
        return failureResponse(request, "READBACK", "M3_MARKER_MOTION_POST_WRITE_READBACK_MISMATCH", "Marker/motion mutation did not match exact structural readback; exact prior state was restored.", rollbackRead.response.readback, ["Marker/motion write failed independent structural verification and the exact prior state was restored."], { expected: expected, actual: after });
      }

      if (proofInjectionRequested(request) && original.outcome === "APPLIED") {
        try {
          restoreState(request, before);
          rollbackRead = readState(request, "p4_rollback");
          if (!statesEqual(request.command, rollbackRead.state, before)) {
            return failureResponse(request, "ROLLBACK_FAILURE", "M3_MARKER_MOTION_P4_ROLLBACK_READBACK_MISMATCH", "Proof-induced marker/motion failure could not restore the exact prior state.", rollbackRead.response.readback, ["P4 failure injection occurred only after verified mutation, but rollback readback mismatched."], { expectedPrior: before, actual: rollbackRead.state });
          }
        } catch (proofRollbackError) {
          return failureResponse(request, "ROLLBACK_FAILURE", "M3_MARKER_MOTION_P4_ROLLBACK_FAILED", "Proof-induced marker/motion failure was followed by rollback failure.", null, ["P4 failure injection occurred only after verified mutation; rollback then raised an additional host error."], { rollbackError: asString(proofRollbackError) });
        }
        return failureResponse(request, "PROOF_INJECTION", "M3_MARKER_MOTION_P4_INDUCED_FAILURE", "Induced protocol 2.0 P4 failure after verified marker/motion mutation; exact prior structural state was restored.", rollbackRead.response.readback, ["Protocol 2.0 mutation passed independent post-write structural verification, proof failure was induced, and exact prior state was restored by structural rollback."], { verifiedPostWriteState: after });
      }

      return originalRaw;
    } catch (atomicityError) {
      return failureResponse(request, "ATOMICITY_GUARD", "M3_MARKER_MOTION_ATOMICITY_GUARD_FAILED", "Marker/motion atomicity guard failed closed before proof acceptance.", null, ["Atomicity guard could not complete its independent structural verification path."], { error: asString(atomicityError) });
    }
  };

  $.global.EditFlow2_M3_MARKER_MOTION_ATOMICITY = true;
}());
